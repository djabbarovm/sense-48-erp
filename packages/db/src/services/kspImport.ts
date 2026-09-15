import type { KspBook } from '@finance-os/adapters';
import { requirePermission, type TenantContext } from '@finance-os/core';
import { prisma } from '../client.js';
import { withAudit } from '../audit.js';

/**
 * H-01 (ADR-011): загрузка книги KSP в тенант. Идемпотентна: повторный запуск
 * ничего не дублирует (upsert по естественным ключам). Открытые сальдо
 * создаются сводными документами «САЛЬДО-KSP-<дата>»; переплаты/авансы не
 * превращаются в документы, а возвращаются списком на ручной разбор.
 * Кассовые операции до cutoff помечаются IGNORED (разобраны вне системы),
 * начиная с cutoff — UNMATCHED, чтобы попасть в текущую сверку.
 */

export interface KspImportReport {
  vendorsCreated: number;
  vendorsExisting: number;
  customersCreated: number;
  categoriesCreated: number;
  apInvoicesCreated: number;
  apTotalMinor: bigint;
  vendorAdvances: { vendorName: string; amountMinor: bigint }[];
  arInvoicesCreated: number;
  arTotalMinor: bigint;
  customerAdvances: { customerName: string; amountMinor: bigint }[];
  matchRulesUpserted: number;
  cashTxCreated: number;
  cashBalanceMinor: bigint;
}

const CAT_GROUP_RULES: [RegExp, string][] = [
  [/аренд/i, 'RENT'],
  [/зарплат|зп |персонал|официант|повар|хостес/i, 'PAYROLL'],
  [/коммун|электр|вода|газ|интернет|связь/i, 'UTILITIES'],
  [/налог|инпс|ндс/i, 'TAX'],
  [/маркет|реклам|smm|таргет/i, 'MARKETING'],
  [/клининг|чист|уборк|прачеч/i, 'CLEANING'],
  [/продукт|кухн|бар|посуд|кейтер|напитк|алко/i, 'FNB'],
];
const guessGroup = (name: string): string => CAT_GROUP_RULES.find(([re]) => re.test(name))?.[1] ?? 'OTHER';

export async function importKspBook(ctx: TenantContext, book: KspBook, cutoff = new Date('2026-09-01')): Promise<KspImportReport> {
  requirePermission(ctx, 'vendor.create');
  requirePermission(ctx, 'invoice.create');
  requirePermission(ctx, 'ar.invoice.manage');

  const t = ctx.tenantId;
  const asOfLabel = book.apAsOf.toISOString().slice(0, 10);
  const report: KspImportReport = {
    vendorsCreated: 0, vendorsExisting: 0, customersCreated: 0, categoriesCreated: 0,
    apInvoicesCreated: 0, apTotalMinor: 0n, vendorAdvances: [],
    arInvoicesCreated: 0, arTotalMinor: 0n, customerAdvances: [],
    matchRulesUpserted: 0, cashTxCreated: 0, cashBalanceMinor: 0n,
  };

  await withAudit({ tenantId: t, userId: ctx.userId }, async (tx) => {
    // ── поставщики (ИНН и счета придут из 1С — до тех пор PENDING_VERIFICATION) ──
    const existingVendors = new Map(
      (await tx.vendor.findMany({ where: { tenantId: t } })).map((v) => [v.displayName.toLowerCase(), v]),
    );
    const vendorIds = new Map<string, string>();
    // ИНН в книге KSP нет; в БД частичный unique (tenant, taxId), поэтому до
    // прихода реальных ИНН из 1С ставим заглушку KSP-nnnn (видно на экране).
    let taxSeq = (await tx.vendor.count({ where: { tenantId: t, taxId: { startsWith: 'KSP-' } } })) + 1;
    for (const name of book.vendors) {
      const found = existingVendors.get(name.toLowerCase());
      if (found) {
        vendorIds.set(name, found.id);
        report.vendorsExisting++;
        continue;
      }
      const v = await tx.vendor.create({
        data: { tenantId: t, taxId: `KSP-${String(taxSeq++).padStart(4, '0')}`, legalName: name, displayName: name, status: 'PENDING_VERIFICATION' },
      });
      vendorIds.set(name, v.id);
      report.vendorsCreated++;
    }

    // ── клиенты ──
    const existingCustomers = new Map(
      (await tx.customer.findMany({ where: { tenantId: t } })).map((c) => [c.legalName.toLowerCase(), c]),
    );
    const customerIds = new Map<string, string>();
    for (const name of book.customers) {
      const found = existingCustomers.get(name.toLowerCase());
      if (found) {
        customerIds.set(name, found.id);
        continue;
      }
      const c = await tx.customer.create({ data: { tenantId: t, legalName: name } });
      customerIds.set(name, c.id);
      report.customersCreated++;
    }

    // ── статьи расходов → категории (код KSP-nn, группа эвристикой) ──
    const existingCats = new Set((await tx.category.findMany({ where: { tenantId: t } })).map((c) => c.name.toLowerCase()));
    const usedCodes = new Set((await tx.category.findMany({ where: { tenantId: t } })).map((c) => c.code));
    let catSeq = 1;
    for (const name of book.categories) {
      if (existingCats.has(name.toLowerCase())) continue;
      let code: string;
      do code = `KSP-${String(catSeq++).padStart(2, '0')}`;
      while (usedCodes.has(code));
      usedCodes.add(code);
      await tx.category.create({
        data: { tenantId: t, code, name, group: guessGroup(name) as never, budgetRequired: false },
      });
      report.categoriesCreated++;
    }

    // ── открытая кредиторка: сводный документ-сальдо на дату среза ──
    const invNumber = `САЛЬДО-KSP-${asOfLabel}`;
    const existingSaldo = new Set(
      (await tx.invoice.findMany({ where: { tenantId: t, number: invNumber }, select: { vendorId: true } })).map((i) => i.vendorId),
    );
    for (const b of book.apBalances) {
      if (b.netMinor > 0n) {
        report.vendorAdvances.push({ vendorName: b.vendorName, amountMinor: b.netMinor });
        continue;
      }
      const vendorId = vendorIds.get(b.vendorName);
      if (!vendorId || existingSaldo.has(vendorId)) continue;
      const gross = -b.netMinor;
      await tx.invoice.create({
        data: {
          tenantId: t, vendorId, number: invNumber, date: b.asOf, type: 'ACT',
          amountGrossMinor: gross, vatMinor: 0n, amountNetMinor: gross,
          status: 'RECEIVED', matchStatus: 'UNMATCHED',
        },
      });
      report.apInvoicesCreated++;
      report.apTotalMinor += gross;
    }

    // ── открытая дебиторка ──
    const existingCinv = new Set((await tx.customerInvoice.findMany({ where: { tenantId: t }, select: { number: true } })).map((c) => c.number));
    let arSeq = 1;
    for (const b of book.arBalances) {
      if (b.netMinor < 0n) {
        report.customerAdvances.push({ customerName: b.customerName, amountMinor: -b.netMinor });
        continue;
      }
      const customerId = customerIds.get(b.customerName);
      if (!customerId) continue;
      const number = `AR-САЛЬДО-KSP-${asOfLabel}-${String(arSeq++).padStart(2, '0')}`;
      if (existingCinv.has(number)) continue;
      await tx.customerInvoice.create({
        data: {
          tenantId: t, number, customerId, date: book.apAsOf, dueDate: book.apAsOf,
          amountGrossMinor: b.netMinor, vatMinor: 0n, status: 'ISSUED',
        },
      });
      report.arInvoicesCreated++;
      report.arTotalMinor += b.netMinor;
    }

    // ── правила маппинга выписки ──
    for (const r of book.matchRules) {
      await tx.counterpartyMatchRule.upsert({
        where: { tenantId_pattern: { tenantId: t, pattern: r.pattern } },
        create: {
          tenantId: t, pattern: r.pattern, purposePattern: r.purposePattern,
          counterpartyName: r.counterpartyName, operationType: r.operationType,
          expenseArticle: r.expenseArticle, vendorId: vendorIds.get(r.counterpartyName) ?? null,
        },
        update: {
          counterpartyName: r.counterpartyName, operationType: r.operationType,
          expenseArticle: r.expenseArticle, vendorId: vendorIds.get(r.counterpartyName) ?? null,
        },
      });
      report.matchRulesUpserted++;
    }

    // ── касса как счёт CASH; история до cutoff — IGNORED, дальше — UNMATCHED ──
    let cashAccount = await tx.bankAccount.findFirst({ where: { tenantId: t, accountMasked: 'КАССА' } });
    cashAccount ??= await tx.bankAccount.create({
      data: { tenantId: t, bankName: 'Касса (наличные)', mfo: '00000', accountMasked: 'КАССА', accountEncrypted: 'CASH' },
    });
    if (book.cashTx.length > 0) {
      const res = await tx.bankTransaction.createMany({
        data: book.cashTx.map((c) => ({
          tenantId: t,
          bankAccountId: cashAccount.id,
          externalId: `KASSA-${c.rowIndex}`,
          bookingDate: c.date,
          valueDate: c.date,
          amountMinor: c.amountMinor,
          counterpartyName: c.counterpartyName,
          purposeText: [c.article, c.note, c.currency !== 'UZS' ? `(${c.currency} по курсу KSP)` : null].filter(Boolean).join(' · '),
          matchStatus: c.date < cutoff ? ('IGNORED' as const) : ('UNMATCHED' as const),
        })),
        skipDuplicates: true,
      });
      report.cashTxCreated = res.count;
    }
    report.cashBalanceMinor = book.cashTx.reduce((s, c) => s + c.amountMinor, 0n);

    return {
      result: undefined,
      audit: {
        action: 'ksp.import',
        objectType: 'tenant',
        objectId: t,
        before: null,
        after: {
          asOf: asOfLabel,
          vendorsCreated: report.vendorsCreated,
          customersCreated: report.customersCreated,
          categoriesCreated: report.categoriesCreated,
          apInvoicesCreated: report.apInvoicesCreated,
          apTotal: report.apTotalMinor.toString(),
          arInvoicesCreated: report.arInvoicesCreated,
          arTotal: report.arTotalMinor.toString(),
          matchRules: report.matchRulesUpserted,
          cashTx: report.cashTxCreated,
        },
      },
    };
  });

  return report;
}

/** Возвращает открытые проблемы после импорта: поставщики без ИНН/счёта. */
export async function kspImportGaps(ctx: TenantContext) {
  requirePermission(ctx, 'vendor.view');
  return prisma.vendor.count({ where: { tenantId: ctx.tenantId, taxId: { startsWith: 'KSP-' } } });
}
