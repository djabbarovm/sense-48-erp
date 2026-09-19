/**
 * H-09: импорт родных выгрузок 1С и Didox без переформатирования (adapters/onec/exports, adapters/edo/didoxExport).
 *  - Справочник контрагентов → обогащение поставщиков (H-02): заглушки KSP-nnnn получают ИНН и реквизиты, новые создаются
 *    через importVendorsXlsx (all-or-nothing), второй счёт того же ИНН → UNVERIFIED (BR: смена реквизитов — только через верификацию).
 *  - ОСВ 4010 → открытая дебиторка (importOpenArXlsx); ОСВ 43xx → авансы поставщикам c задачей CLOSING_DOCS (non-negotiable #7);
 *    ОСВ 6xxx → открытая кредиторка (importOpenApXlsx). Контрагент ищется по ИНН/имени среди поставщиков (сначала загрузите справочник).
 *  - Штат → importEmployeesXlsx (только ФИО/должность; оклады не читаются адаптером).
 *  - Реестр Didox → подписанные договоры (importContractsXlsx); остальные документы — в заметки отчёта.
 */
import type { TenantContext } from '@finance-os/core';
import { encryptSecret, maskAccount, requirePermission } from '@finance-os/core';
import type { DidoxExportRow, OnecCounterparty, OnecOsv, OnecStaffRow } from '@finance-os/adapters';
import { normalizeCounterpartyName } from '@finance-os/adapters';
import { withAudit } from '../audit.js';
import { prisma } from '../client.js';
import { addBusinessDays } from './advances.js';
import { importContractsXlsx, importEmployeesXlsx, importOpenApXlsx, importOpenArXlsx, importVendorsXlsx, type MigrationReport } from './migration.js';

export interface NativeImportReport extends MigrationReport { notes: string[] }

const minorToStr = (m: bigint) => `${m / 100n}.${String(m % 100n).padStart(2, '0')}`;
const bankDataKey = () => process.env.BANK_DATA_KEY ?? '';

async function vendorIndex(tenantId: string) {
  const vendors = await prisma.vendor.findMany({ where: { tenantId }, include: { bankAccounts: { select: { accountMasked: true } } } });
  const byTax = new Map(vendors.map((v) => [v.taxId, v]));
  const byName = new Map<string, (typeof vendors)[number]>();
  for (const v of vendors) { byName.set(normalizeCounterpartyName(v.legalName), v); byName.set(normalizeCounterpartyName(v.displayName), v); }
  return { vendors, byTax, byName };
}

/** Справочник контрагентов 1С → поставщики. */
export async function importOnecCounterparties(ctx: TenantContext, rows: OnecCounterparty[], opts: { categoryCode: string; businessOwnerEmail: string }): Promise<NativeImportReport> {
  requirePermission(ctx, 'vendor.create');
  const notes: string[] = [];
  const { byTax, byName } = await vendorIndex(ctx.tenantId);
  // один ИНН может встречаться несколько раз (несколько счетов): первый — основной, остальные — дополнительные
  const primary = new Map<string, OnecCounterparty>();
  const extra: OnecCounterparty[] = [];
  for (const r of rows) { if (primary.has(r.taxId)) extra.push(r); else primary.set(r.taxId, r); }
  const toEnrich: { vendorId: string; cp: OnecCounterparty; stub: boolean }[] = [];
  const toCreate: OnecCounterparty[] = [];
  for (const cp of primary.values()) {
    const byTaxHit = byTax.get(cp.taxId);
    const stub = byTaxHit ? null : byName.get(normalizeCounterpartyName(cp.name)) ?? byName.get(normalizeCounterpartyName(cp.legalName));
    if (byTaxHit) toEnrich.push({ vendorId: byTaxHit.id, cp, stub: false });
    else if (stub && stub.taxId.startsWith('KSP-')) toEnrich.push({ vendorId: stub.id, cp, stub: true });
    else toCreate.push(cp);
  }
  const report: NativeImportReport = { total: rows.length, imported: 0, skipped: 0, errors: [], notes };
  if (toCreate.length) {
    const created = await importVendorsXlsx(ctx, toCreate.map((cp) => ({ tax_id: cp.taxId, legal_name: cp.legalName, display_name: cp.name, category_code: opts.categoryCode, vat_payer: '', bank_name: cp.bankName, mfo: cp.mfo, account: cp.account, currency: 'UZS', contact_name: '', contact_phone: '', contact_email: '', requires_contract: '', related_party: '', business_owner_email: opts.businessOwnerEmail })));
    report.errors = created.errors; report.imported += created.imported; report.skipped += created.skipped;
    if (created.errors.length) return report;
  }
  await withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const enriched: string[] = [];
    for (const { vendorId, cp, stub } of toEnrich) {
      const v = await tx.vendor.findUniqueOrThrow({ where: { id: vendorId }, include: { bankAccounts: true } });
      const hasAccount = v.bankAccounts.some((a) => a.accountMasked === maskAccount(cp.account));
      if (stub) {
        await tx.vendor.update({ where: { id: vendorId }, data: { taxId: cp.taxId, legalName: cp.legalName, status: 'ACTIVE', updatedBy: ctx.userId } });
        enriched.push(`${v.displayName}: ${v.taxId} → ИНН ${cp.taxId}`);
      }
      if (!hasAccount) {
        const first = v.bankAccounts.length === 0;
        // первые реквизиты из учётной системы — как файл миграции (DOCUMENT); ещё один счёт при существующих — UNVERIFIED до верификации
        await tx.vendorBankAccount.create({ data: { tenantId: ctx.tenantId, vendorId, bankName: cp.bankName, mfo: cp.mfo, accountMasked: maskAccount(cp.account), accountEncrypted: encryptSecret(cp.account, bankDataKey()), currency: 'UZS', status: first ? 'VERIFIED' : 'UNVERIFIED', isDefault: first, ...(first ? { verifiedAt: new Date(), verifiedBy: ctx.userId, verificationMethod: 'DOCUMENT' as const } : {}) } });
        if (!first) notes.push(`${v.displayName}: новый счёт ${maskAccount(cp.account)} добавлен как UNVERIFIED — нужна верификация`);
        report.imported++;
      } else report.skipped++;
      if (stub && hasAccount) report.imported++;
    }
    for (const cp of extra) {
      const v = byTax.get(cp.taxId) ?? (await tx.vendor.findFirst({ where: { tenantId: ctx.tenantId, taxId: cp.taxId } }));
      if (!v) continue;
      const exists = await tx.vendorBankAccount.count({ where: { vendorId: v.id, accountMasked: maskAccount(cp.account) } });
      if (exists) { report.skipped++; continue; }
      await tx.vendorBankAccount.create({ data: { tenantId: ctx.tenantId, vendorId: v.id, bankName: cp.bankName, mfo: cp.mfo, accountMasked: maskAccount(cp.account), accountEncrypted: encryptSecret(cp.account, bankDataKey()), currency: 'UZS', status: 'UNVERIFIED', isDefault: false } });
      notes.push(`${cp.name}: второй счёт ${maskAccount(cp.account)} добавлен как UNVERIFIED — нужна верификация`);
      report.imported++;
    }
    const persons = rows.filter((r) => r.isPerson).map((r) => r.name);
    if (persons.length) notes.push(`Физлица (ГПХ/подотчёт) заведены как поставщики: ${persons.join(', ')}`);
    return { result: report, audit: { action: 'migration.onec_counterparties', objectType: 'tenant', objectId: ctx.tenantId, after: { imported: report.imported, skipped: report.skipped, enriched, extraAccounts: extra.length } } };
  });
  return report;
}

/** ОСВ по счёту → дебиторка (4010) / авансы (43xx) / кредиторка (6xxx). */
export async function importOnecOsv(ctx: TenantContext, osv: OnecOsv, now = new Date()): Promise<NativeImportReport> {
  const notes: string[] = [`ОСВ по счёту ${osv.account} за ${osv.periodText || '—'}: строк ${osv.lines.length}`];
  const { byName } = await vendorIndex(ctx.tenantId);
  const resolve = (name: string) => byName.get(normalizeCounterpartyName(name)) ?? null;
  const refOf = (l: OnecOsv['lines'][number]) => (l.contract ? `${l.contract.number}` : `ОСВ-${osv.account}`);
  const dateOf = (l: OnecOsv['lines'][number]) => l.contract?.date ?? now.toISOString().slice(0, 10);
  const empty = (): NativeImportReport => ({ total: osv.lines.length, imported: 0, skipped: 0, errors: [], notes });

  if (osv.account.startsWith('40')) {
    const open = osv.lines.filter((l) => l.closingDebit > 0n);
    const rows = open.map((l) => ({ customer_tax_id: resolve(l.counterparty)?.taxId ?? '', customer_name: l.counterparty, invoice_number: `${refOf(l)}/${l.counterparty}`.slice(0, 120), invoice_date: dateOf(l), amount_gross: minorToStr(l.closingDebit), vat: '', currency: 'UZS', due_date: now.toISOString().slice(0, 10), received_to_date: '', event_number: '', contract_number: '' }));
    const r = await importOpenArXlsx(ctx, rows);
    notes.push(`Открытая дебиторка: ${open.length} контрагентов на ${minorToStr(osv.totals.closingDebit)} UZS; срок — сегодня (просрочка считается c даты импорта)`);
    return { ...r, total: osv.lines.length, notes };
  }
  if (osv.account.startsWith('43')) {
    requirePermission(ctx, 'invoice.create');
    const report = empty();
    const open = osv.lines.filter((l) => l.closingDebit > 0n);
    const unresolved = open.filter((l) => !resolve(l.counterparty));
    unresolved.forEach((l) => report.errors.push({ row: osv.lines.indexOf(l) + 1, field: 'counterparty', message: `Поставщик «${l.counterparty}» не найден — сначала загрузите справочник контрагентов` }));
    if (report.errors.length) return report;
    await withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
      const docController = await tx.userTenantRole.findFirst({ where: { tenantId: ctx.tenantId, role: 'DOCUMENT_CONTROLLER' } });
      const lead = await tx.userTenantRole.findFirst({ where: { tenantId: ctx.tenantId, role: 'FINANCE_OPS_LEAD' } });
      const created: string[] = [];
      for (const l of open) {
        const vendor = resolve(l.counterparty)!;
        const purpose = `Аванс по договору ${l.contract?.raw ?? 'б/н'} (ОСВ ${osv.account}, ${osv.periodText})`;
        const dup = await tx.advance.findFirst({ where: { tenantId: ctx.tenantId, vendorId: vendor.id, type: 'VENDOR_PREPAYMENT', purpose, status: { in: ['OPEN', 'OVERDUE'] } } });
        if (dup) { report.skipped++; continue; }
        const dueDocsDate = await addBusinessDays(tx, now, 10);
        const adv = await tx.advance.create({ data: { tenantId: ctx.tenantId, type: 'VENDOR_PREPAYMENT', vendorId: vendor.id, amountMinor: l.closingDebit, purpose, dueDocsDate, createdBy: ctx.userId } });
        await tx.task.create({ data: { tenantId: ctx.tenantId, type: 'CLOSING_DOCS', objectType: 'advance', objectId: adv.id, ownerId: docController?.userId ?? null, escalateToId: lead?.userId ?? null, dueAt: dueDocsDate, nextAction: `Получить закрывающие документы от ${vendor.displayName} по авансу ${minorToStr(l.closingDebit)} UZS (${l.contract?.raw ?? 'договор б/н'}) до ${dueDocsDate.toISOString().slice(0, 10)}` } });
        created.push(adv.id);
        report.imported++;
      }
      notes.push(`Авансы поставщикам: ${report.imported} на ${minorToStr(open.reduce((a, l) => a + l.closingDebit, 0n))} UZS, задачи на закрывающие документы (10 рабочих дней)`);
      return { result: report, audit: { action: 'migration.onec_advances', objectType: 'tenant', objectId: ctx.tenantId, after: { account: osv.account, period: osv.periodText, imported: report.imported, skipped: report.skipped, advanceIds: created } } };
    });
    return report;
  }
  if (osv.account.startsWith('6')) {
    const open = osv.lines.filter((l) => l.closingCredit > 0n);
    const report = empty();
    open.filter((l) => !resolve(l.counterparty)).forEach((l) => report.errors.push({ row: osv.lines.indexOf(l) + 1, field: 'counterparty', message: `Поставщик «${l.counterparty}» не найден — сначала загрузите справочник контрагентов` }));
    if (report.errors.length) return report;
    const rows = open.map((l) => ({ vendor_tax_id: resolve(l.counterparty)!.taxId, invoice_number: `${refOf(l)} (ОСВ ${osv.account})`, invoice_date: dateOf(l), invoice_type: 'INVOICE', amount_gross: minorToStr(l.closingCredit), vat: '', currency: 'UZS', contract_number: '', paid_to_date: '', due_date: now.toISOString().slice(0, 10), cost_center_code: '', category_code: '', edo_document_id: '' }));
    const r = await importOpenApXlsx(ctx, rows);
    notes.push(`Открытая кредиторка (счёт ${osv.account}): ${open.length} строк на ${minorToStr(osv.totals.closingCredit)} UZS`);
    return { ...r, total: osv.lines.length, notes };
  }
  const report = empty();
  report.errors.push({ row: 1, field: 'account', message: `Счёт ${osv.account} не поддерживается: 40xx (дебиторка), 43xx (авансы), 6xxx (кредиторка)` });
  return report;
}

/** Штатные сотрудники 1С → сотрудники (только для подотчётов и контроля документов; статусы документов — «не проверены»). */
export async function importOnecStaff(ctx: TenantContext, rows: OnecStaffRow[]): Promise<NativeImportReport> {
  const r = await importEmployeesXlsx(ctx, rows.map((e) => ({ full_name: e.fullName, role_title: e.position || 'Сотрудник', cost_center_code: '', employment_type: 'STAFF', status: 'ACTIVE', terminated_at: '', bank_card_status: 'MISSING', passport_status: 'MISSING' })));
  return { ...r, notes: ['Оклады и ПИНФЛ не импортируются. Статусы паспорта/карты выставлены «отсутствует» — проверьте и отметьте в карточках сотрудников.'] };
}

/** Реестр Didox → подписанные договоры; остальное — в заметки. */
export async function importDidoxExport(ctx: TenantContext, rows: DidoxExportRow[], opts: { ownerEmail: string }): Promise<NativeImportReport> {
  const notes: string[] = [];
  const { byTax } = await vendorIndex(ctx.tenantId);
  const contracts = rows.filter((r) => r.docType === 'CONTRACT');
  const signed = contracts.filter((r) => r.status === 'SIGNED');
  const awaiting = rows.filter((r) => r.status === 'SENT');
  const missingVendor = signed.filter((r) => !r.isPerson && !byTax.has(r.counterpartyTaxId));
  const report: NativeImportReport = { total: rows.length, imported: 0, skipped: 0, errors: [], notes };
  missingVendor.forEach((r) => report.errors.push({ row: r.no, field: 'counterpartyTaxId', message: `Поставщик c ИНН ${r.counterpartyTaxId} («${r.counterpartyName}») не найден — сначала загрузите справочник контрагентов` }));
  if (report.errors.length) return report;
  const importable = signed.filter((r) => !r.isPerson);
  if (importable.length) {
    const r = await importContractsXlsx(ctx, importable.map((d) => ({ number: d.contractNumber ?? d.number, vendor_tax_id: d.counterpartyTaxId, subject: `${d.docTypeRaw} c ${d.counterpartyName} (Didox)`, currency: 'UZS', limit: d.amountGross != null ? minorToStr(d.amountGross) : '', start_date: d.contractDate ?? d.date ?? '', end_date: '', auto_renew: '', payment_terms_type: 'POSTPAY_DAYS', payment_terms_value: '0', registration_required: '', owner_email: opts.ownerEmail, status: 'SIGNED' })));
    report.errors = r.errors; report.imported = r.imported; report.skipped = r.skipped;
    if (r.errors.length) return report;
  }
  const byType = new Map<string, number>();
  for (const r of rows) byType.set(r.docTypeRaw, (byType.get(r.docTypeRaw) ?? 0) + 1);
  notes.push(`Документов в реестре: ${rows.length} (${[...byType].map(([k, v]) => `${k}: ${v}`).join(', ')}); договоров подписано ${signed.length}, импортировано как договоры ${report.imported}`);
  if (awaiting.length) notes.push(`Ожидают вашей подписи: ${awaiting.map((r) => `${r.docTypeRaw} ${r.contractNumber ?? r.number} c ${r.counterpartyName}${r.amountGross != null ? ` на ${minorToStr(r.amountGross)} UZS` : ''}`).join('; ')}`);
  const personContracts = signed.filter((r) => r.isPerson);
  if (personContracts.length) notes.push(`Договоры c физлицами (ПИНФЛ) не импортируются как договоры поставщиков: ${personContracts.map((r) => r.counterpartyName).join(', ')}`);
  notes.push('Условия оплаты договоров выставлены «постоплата 0 дней» — уточните в карточках договоров.');
  return report;
}
