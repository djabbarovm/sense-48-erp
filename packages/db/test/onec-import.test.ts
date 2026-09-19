import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { PermissionDeniedError, unsafeCreateTenantContext, type RoleCode } from '@finance-os/core';
import type { DidoxExportRow, OnecCounterparty, OnecOsv, OnecStaffRow } from '@finance-os/adapters';
import { prisma } from '../src/client.js';
import { importDidoxExport, importOnecCounterparties, importOnecOsv, importOnecStaff } from '../src/services/onecImport.js';

process.env.BANK_DATA_KEY ??= randomBytes(32).toString('base64');

let tenantId: string;
let ownerEmail: string;
const ctx = (roles: RoleCode[] = ['FINANCE_OPS_LEAD']) => unsafeCreateTenantContext({ tenantId, tenantSlug: 'x', userId: crypto.randomUUID(), roles });
const cp = (name: string, taxId: string, acc: string, isPerson = false): OnecCounterparty => ({ name, legalName: name, taxId, isPerson, account: acc, bankName: 'Kapitalbank ATB', mfo: '01158' });
const osv = (account: string, lines: { c: string; n?: string; d?: string; cd?: bigint; cc?: bigint }[]): OnecOsv => ({ company: 'Demo', account, periodText: '9 месяцев 2026 г.', lines: lines.map((l) => ({ counterparty: l.c, contract: l.n ? { number: l.n, date: l.d ?? '2026-07-01', raw: `№${l.n} от 01.07.2026` } : null, openingDebit: 0n, openingCredit: 0n, turnoverDebit: l.cd ?? 0n, turnoverCredit: l.cc ?? 0n, closingDebit: l.cd ?? 0n, closingCredit: l.cc ?? 0n })), totals: { closingDebit: lines.reduce((a, l) => a + (l.cd ?? 0n), 0n), closingCredit: lines.reduce((a, l) => a + (l.cc ?? 0n), 0n) } });

beforeAll(async () => {
  const ts = Date.now();
  tenantId = (await prisma.tenant.create({ data: { slug: `t-onec-${ts}`, legalName: 'ONEC', taxId: '300000098' } })).id;
  await prisma.category.create({ data: { tenantId, code: 'ADMIN', name: 'Админ', group: 'ADMIN' as never } });
  ownerEmail = `onec-${ts}@t.test`;
  const user = await prisma.user.create({ data: { email: ownerEmail, fullName: 'Lead' } });
  await prisma.userTenantRole.create({ data: { tenantId, userId: user.id, role: 'FINANCE_OPS_LEAD' } });
  // заглушка из KSP-импорта без ИНН и реквизитов (H-02)
  await prisma.vendor.create({ data: { tenantId, taxId: 'KSP-0001', legalName: 'Demo Clean Mchj', displayName: 'Demo Clean Mchj', status: 'PENDING_VERIFICATION' } });
});
afterAll(async () => prisma.$disconnect());

describe('H-09: родные выгрузки 1С и Didox', () => {
  it('контрагенты: заглушка KSP получает ИНН и реквизиты, новые создаются, второй счёт — UNVERIFIED, физлица отмечены, audit; без права — 403', async () => {
    const rows = [cp('Demo Clean Mchj', '300000001', '20208000000000000001'), cp('Alpha Law Mchj', '300000002', '20208000000000000002'), cp('Alpha Law Mchj', '300000002', '20208000000000000003'), cp('TESTOV TEST', '500000003', '20218000000000000004', true)];
    await expect(importOnecCounterparties(ctx(['ACCOUNTANT']), rows, { categoryCode: 'ADMIN', businessOwnerEmail: ownerEmail })).rejects.toBeInstanceOf(PermissionDeniedError);
    const r = await importOnecCounterparties(ctx(), rows, { categoryCode: 'ADMIN', businessOwnerEmail: ownerEmail });
    expect(r.errors).toEqual([]);
    expect([r.imported, r.skipped]).toEqual([4, 0]); // 2 новых + обогащение заглушки + второй счёт
    const stub = await prisma.vendor.findFirstOrThrow({ where: { tenantId, legalName: 'Demo Clean Mchj' }, include: { bankAccounts: true } });
    expect([stub.taxId, stub.status, stub.bankAccounts[0]?.status, stub.bankAccounts[0]?.verificationMethod]).toEqual(['300000001', 'ACTIVE', 'VERIFIED', 'DOCUMENT']);
    const alpha = await prisma.vendor.findFirstOrThrow({ where: { tenantId, taxId: '300000002' }, include: { bankAccounts: { orderBy: { isDefault: 'desc' } } } });
    expect(alpha.bankAccounts.map((a) => [a.isDefault, a.status])).toEqual([[true, 'VERIFIED'], [false, 'UNVERIFIED']]);
    expect(r.notes.some((n) => /второй счёт .* UNVERIFIED/.test(n))).toBe(true);
    expect(r.notes.some((n) => /Физлица/.test(n) && n.includes('TESTOV TEST'))).toBe(true);
    expect(await prisma.auditLog.count({ where: { tenantId, action: 'migration.onec_counterparties' } })).toBe(1);
    // повтор — идемпотентен
    const again = await importOnecCounterparties(ctx(), rows, { categoryCode: 'ADMIN', businessOwnerEmail: ownerEmail });
    expect([again.imported, again.skipped, again.errors.length]).toEqual([0, 4, 0]);
  });

  it('ОСВ 4310: открытые авансы → Advance VENDOR_PREPAYMENT + задача CLOSING_DOCS (non-negotiable #7), закрытые строки пропускаются, идемпотентно; неизвестный контрагент — all-or-nothing', async () => {
    const bad = await importOnecOsv(ctx(), osv('4310', [{ c: 'Unknown Mchj', n: '1', cd: 100n }]));
    expect(bad.errors[0]?.field).toBe('counterparty');
    expect(await prisma.advance.count({ where: { tenantId } })).toBe(0);
    const r = await importOnecOsv(ctx(), osv('4310', [{ c: 'Alpha Law Mchj', n: '2026-01', cd: 0n }, { c: 'Alpha Law Mchj', n: '2026-02', cd: 5_750_000_000n }, { c: 'Demo Clean Mchj', cd: 320_000_000n }]));
    expect([r.imported, r.skipped, r.errors.length]).toEqual([2, 0, 0]);
    const adv = await prisma.advance.findMany({ where: { tenantId }, orderBy: { amountMinor: 'desc' } });
    expect(adv.map((a) => [a.type, a.amountMinor, a.status])).toEqual([['VENDOR_PREPAYMENT', 5_750_000_000n, 'OPEN'], ['VENDOR_PREPAYMENT', 320_000_000n, 'OPEN']]);
    expect(adv[0]!.dueDocsDate).not.toBeNull();
    expect(await prisma.task.count({ where: { tenantId, type: 'CLOSING_DOCS', objectType: 'advance' } })).toBe(2);
    expect(await prisma.auditLog.count({ where: { tenantId, action: 'migration.onec_advances' } })).toBe(1);
    const again = await importOnecOsv(ctx(), osv('4310', [{ c: 'Alpha Law Mchj', n: '2026-02', cd: 5_750_000_000n }]));
    expect([again.imported, again.skipped]).toEqual([0, 1]);
    await expect(importOnecOsv(ctx(['BROKER']), osv('4310', [{ c: 'Alpha Law Mchj', n: '9', cd: 1n }]))).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('ОСВ 4010 → открытая дебиторка (клиенты создаются), ОСВ 6910 → открытая кредиторка, прочие счета — ошибка', async () => {
    const ar = await importOnecOsv(ctx(), osv('4010', [{ c: 'Citynet Demo Mchj', n: 'Partnership-1', cd: 9_000_000n }, { c: 'Paid Client', n: 'X', cd: 0n }]));
    expect([ar.imported, ar.errors.length]).toEqual([1, 0]);
    const inv = await prisma.customerInvoice.findFirstOrThrow({ where: { tenantId } });
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: inv.customerId } });
    expect([customer.legalName, inv.amountGrossMinor]).toEqual(['Citynet Demo Mchj', 9_000_000n]);
    const ap = await importOnecOsv(ctx(), osv('6910', [{ c: 'Alpha Law Mchj', n: '9', d: '2026-06-04', cc: 601_441_508n }]));
    expect([ap.imported, ap.errors.length]).toEqual([1, 0]);
    const apInv = await prisma.invoice.findFirstOrThrow({ where: { tenantId } });
    expect([apInv.amountGrossMinor, apInv.number]).toEqual([601_441_508n, '9 (ОСВ 6910)']);
    const other = await importOnecOsv(ctx(), osv('1010', [{ c: 'x', cd: 1n }]));
    expect(other.errors[0]?.field).toBe('account');
  });

  it('штат: только ФИО/должность, статусы документов «не проверены»; только ADMIN', async () => {
    const rows: OnecStaffRow[] = [{ fullName: 'Тестов Тест', tabNo: '1', position: 'Директор', hiredAt: '2026-06-01', department: 'АУП' }];
    await expect(importOnecStaff(ctx(), rows)).rejects.toBeInstanceOf(PermissionDeniedError);
    const r = await importOnecStaff(ctx(['ADMIN']), rows);
    expect([r.imported, r.errors.length]).toEqual([1, 0]);
    const e = await prisma.employee.findFirstOrThrow({ where: { tenantId } });
    expect([e.roleTitle, e.employmentType, e.passportStatus]).toEqual(['Директор', 'STAFF', 'MISSING']);
  });

  it('Didox: подписанные договоры импортируются, ожидающие подписи и физлица — в заметках, неизвестный ИНН — all-or-nothing', async () => {
    const base = { direction: 'IN' as const, statusRaw: 'Подписан', docTypeRaw: 'Договор (НК)', docType: 'CONTRACT' as const, contractDate: '2026-07-28', isPerson: false, date: '2026-07-28', amountNet: 89_623_214n, vat: 10_754_786n, vatExempt: false, edoDocumentId: 'abc' };
    const rows: DidoxExportRow[] = [
      { ...base, no: 1, status: 'SIGNED', contractNumber: '3/134', counterpartyName: 'Alpha Law Mchj', counterpartyTaxId: '300000002', number: '3/134', amountGross: 100_378_000n },
      { ...base, no: 2, status: 'SENT', statusRaw: 'Ожидает вашей подписи', contractNumber: 'MPA-249', counterpartyName: 'Grand Mall', counterpartyTaxId: '300000077', number: 'Договор', amountGross: 744_000_000n },
      { ...base, no: 3, status: 'SIGNED', contractNumber: '117', counterpartyName: 'MANSUROV A', counterpartyTaxId: '51010036590033', isPerson: true, number: '117', amountGross: null },
      { ...base, no: 4, status: 'SIGNED', docTypeRaw: 'Произвольный документ', docType: 'OTHER', contractNumber: '81/07', counterpartyName: 'Academy', counterpartyTaxId: '300000078', number: '2', amountGross: null },
    ];
    const bad = await importDidoxExport(ctx(), [...rows, { ...base, no: 5, status: 'SIGNED', contractNumber: 'Z', counterpartyName: 'Nobody', counterpartyTaxId: '300000099', number: 'Z', amountGross: 1n }], { ownerEmail });
    expect(bad.errors[0]?.field).toBe('counterpartyTaxId');
    expect(await prisma.contract.count({ where: { tenantId } })).toBe(0);
    const r = await importDidoxExport(ctx(), rows, { ownerEmail });
    expect([r.imported, r.errors.length]).toEqual([1, 0]);
    const c = await prisma.contract.findFirstOrThrow({ where: { tenantId } });
    expect([c.number, c.status, c.limitMinor]).toEqual(['3/134', 'SIGNED', 100_378_000n]);
    expect(r.notes.some((n) => n.includes('Ожидают вашей подписи') && n.includes('MPA-249'))).toBe(true);
    expect(r.notes.some((n) => n.includes('физлицами') && n.includes('MANSUROV A'))).toBe(true);
  });
});
