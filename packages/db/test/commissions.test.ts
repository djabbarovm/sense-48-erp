import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotFoundError, PermissionDeniedError, unsafeCreateTenantContext, type RoleCode } from '@finance-os/core';
import { prisma } from '../src/client.js';
import { closeSale, confirmKpi, getBonusReport, getDealCommission, listBonuses, listCommissions, markBonusesPaid, markChecklistItem, matchCommissionReceipt, withholdExpiredKpi } from '../src/services/commissions.js';
import { createDeal, moveDeal } from '../src/services/deals.js';
import { createBuilding, createFloor, createUnit } from '../src/services/property.js';
import { activateLease, createLease, terminateLease } from '../src/services/leases.js';

let tenantId: string;
let salesId: string; // брокер-продажник
let cmId: string; // коммерческий менеджер
let financeId: string;
let unitA: string;
let unitB: string;
let unitS: string;
let accountId: string;
const ctx = (roles: RoleCode[], userId?: string) => unsafeCreateTenantContext({ tenantId, tenantSlug: 'cm', userId: userId ?? crypto.randomUUID(), roles });
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const tx = (externalId: string, amountMinor: bigint, currency = 'USD') => prisma.bankTransaction.create({ data: { tenantId, bankAccountId: accountId, externalId, bookingDate: d('2026-09-10'), valueDate: d('2026-09-10'), amountMinor, currency, counterpartyName: 'Payer', purposeText: 'комиссия' } });

beforeAll(async () => {
  const ts = Date.now();
  tenantId = (await prisma.tenant.create({ data: { slug: `t-cm-${ts}`, legalName: 'CM', taxId: '300000111' } })).id;
  salesId = (await prisma.user.create({ data: { email: `cm-sales-${ts}@t.test`, fullName: 'Бекзод' } })).id;
  cmId = (await prisma.user.create({ data: { email: `cm-cm-${ts}@t.test`, fullName: 'Алия' } })).id;
  financeId = (await prisma.user.create({ data: { email: `cm-fin-${ts}@t.test`, fullName: 'Нилуфар' } })).id;
  await prisma.userTenantRole.createMany({ data: [{ tenantId, userId: salesId, role: 'BROKER' }, { tenantId, userId: cmId, role: 'COMMERCIAL_MANAGER' }, { tenantId, userId: financeId, role: 'FINANCE_OPS_LEAD' }] });
  accountId = (await prisma.bankAccount.create({ data: { tenantId, bankName: 'Bank', mfo: '00000', accountMasked: '****0002', accountEncrypted: 'enc', currency: 'USD' } })).id;
  const b = await createBuilding(ctx(['ADMIN']), { code: 'TOWER', name: 'Tower', kind: 'TOWER' });
  const f = await createFloor(ctx(['ADMIN']), { buildingId: b.id, floorNo: 12 });
  unitA = (await createUnit(ctx(['COMMERCIAL_MANAGER']), { floorId: f.id, unitNo: '1201', type: 'APARTMENT', areaM2: 80 })).id;
  unitB = (await createUnit(ctx(['COMMERCIAL_MANAGER']), { floorId: f.id, unitNo: '1202', type: 'APARTMENT', areaM2: 80 })).id;
  unitS = (await createUnit(ctx(['COMMERCIAL_MANAGER']), { floorId: f.id, unitNo: '1203', type: 'APARTMENT', areaM2: 80 })).id;
});
afterAll(async () => prisma.$disconnect());

describe('Комиссии ORDO и бонусы (BR-P41…P44)', () => {
  let dealA: string;
  let commissionA: string;
  it('BR-P41: WON аренды → комиссия 50% месяца c арендатора; бонус DEAL 20% CONFIRMED, KPI 10% POTENTIAL; чек-лист создан', async () => {
    const deal = await createDeal(ctx(['BROKER'], salesId), { contactName: 'Дилноза', company: 'CityNet', unitId: unitA, expectedRateMinor: 300_000n, product: 'LEASE_LTR' });
    dealA = deal.id;
    const lease = await createLease(ctx(['COMMERCIAL_MANAGER'], cmId), { unitId: unitA, dealId: deal.id, type: 'LTR', occupantName: 'CityNet', startAt: d('2026-09-01'), endAt: d('2027-09-01'), rentMinor: 300_000n });
    await activateLease(ctx(['COMMERCIAL_MANAGER'], cmId), lease.id, d('2026-09-01'));
    const [c] = await listCommissions(ctx(['FINANCE_OPS_LEAD'], financeId), { dealId: deal.id });
    commissionA = c!.id;
    expect(c).toMatchObject({ product: 'LEASE_LTR', payer: 'TENANT', payerName: 'CityNet', baseMinor: 300_000n, rateBp: 5000, amountMinor: 150_000n, netMinor: 150_000n, status: 'ACCRUED', currency: 'USD' });
    expect(c!.number).toMatch(/^CM-\d{4}-\d{6}$/);
    const bonuses = await listBonuses(ctx(['OWNER']), {});
    expect(bonuses.filter((b) => b.dealId === deal.id).map((b) => [b.kind, b.status, b.amountMinor, b.employeeId])).toEqual(expect.arrayContaining([['DEAL', 'CONFIRMED', 30_000n, salesId], ['KPI', 'POTENTIAL', 15_000n, salesId]]));
    const own = await listBonuses(ctx(['BROKER'], salesId), {});
    expect(own.every((b) => b.employeeId === salesId)).toBe(true);
    await expect(listBonuses(ctx(['ACCOUNTANT']), {})).rejects.toThrow(PermissionDeniedError);
    const block = await getDealCommission(ctx(['COMMERCIAL_MANAGER'], cmId), deal.id);
    expect(block.checklist.map((i) => i.item)).toHaveLength(5);
    expect(block.kpi?.deadline?.toISOString().slice(0, 10)).toBe('2026-09-15');
    await expect(listCommissions(ctx(['BROKER'], salesId))).rejects.toThrow(PermissionDeniedError);
  });

  it('BR-P43: KPI — все пункты, не продажник, в срок; BR-P42: комиссия PAID только по банку → бонусы PAYABLE; выплата финансами', async () => {
    for (const item of ['ONBOARDING', 'ACCESS_KEYS', 'INTERNET', 'CLEANING'] as const) await markChecklistItem(ctx(['OPERATIONS_MANAGER']), dealA, item, true, null, d('2026-09-05'));
    await expect(confirmKpi(ctx(['COMMERCIAL_MANAGER'], cmId), dealA, d('2026-09-06'))).rejects.toThrow(/KPI_INCOMPLETE/);
    await markChecklistItem(ctx(['BROKER'], salesId), dealA, 'HANDOVER_SERVICES', true, 'передан в Services', d('2026-09-06'));
    await expect(confirmKpi(ctx(['COMMERCIAL_MANAGER'], salesId), dealA, d('2026-09-06'))).rejects.toThrow(/KPI_SELF_CONFIRM/);
    await expect(confirmKpi(ctx(['BROKER'], salesId), dealA)).rejects.toThrow(PermissionDeniedError);
    await expect(confirmKpi(ctx(['COMMERCIAL_MANAGER'], cmId), dealA, d('2026-09-20'))).rejects.toThrow(/KPI_DEADLINE_PASSED/);
    const kpi = await confirmKpi(ctx(['COMMERCIAL_MANAGER'], cmId), dealA, d('2026-09-06'));
    expect(kpi.status).toBe('CONFIRMED'); // комиссия ещё не получена
    // оплата комиссии: 100 000 + 50 000 двумя транзакциями
    const t1 = await tx('CM-1', 100_000n);
    await expect(matchCommissionReceipt(ctx(['ACCOUNTANT']), { bankTransactionId: t1.id, commissionId: commissionA })).rejects.toThrow(PermissionDeniedError);
    const part = await matchCommissionReceipt(ctx(['FINANCE_OPS_LEAD'], financeId), { bankTransactionId: t1.id, commissionId: commissionA }, d('2026-09-10'));
    expect(part.status).toBe('PARTIAL');
    expect((await listBonuses(ctx(['OWNER']), {})).filter((b) => b.dealId === dealA).every((b) => b.status === 'CONFIRMED')).toBe(true);
    const t2 = await tx('CM-2', 60_000n);
    await expect(matchCommissionReceipt(ctx(['FINANCE_OPS_LEAD'], financeId), { bankTransactionId: t2.id, commissionId: commissionA })).rejects.toThrow(/OVERPAYMENT/);
    const paid = await matchCommissionReceipt(ctx(['FINANCE_OPS_LEAD'], financeId), { bankTransactionId: t2.id, commissionId: commissionA, amountMinor: 50_000n }, d('2026-09-11'));
    expect(paid.status).toBe('PAID');
    const payable = (await listBonuses(ctx(['OWNER']), { status: ['PAYABLE'] })).filter((b) => b.dealId === dealA);
    expect(payable.map((b) => [b.kind, b.amountMinor])).toEqual(expect.arrayContaining([['DEAL', 30_000n], ['KPI', 15_000n]]));
    await expect(markBonusesPaid(ctx(['COMMERCIAL_MANAGER'], cmId), payable.map((b) => b.id), '2026-09')).rejects.toThrow(PermissionDeniedError);
    await expect(markBonusesPaid(ctx(['FINANCE_OPS_LEAD'], financeId), payable.map((b) => b.id), '09/2026')).rejects.toThrow(/PERIOD_INVALID/);
    expect(await markBonusesPaid(ctx(['FINANCE_OPS_LEAD'], financeId), payable.map((b) => b.id), '2026-09', 'Ведомость №9')).toBe(2);
    const report = await getBonusReport(ctx(['OWNER']), '2026-09');
    expect(report.lines.find((l) => l.employeeId === salesId)?.paidMinor).toBe(45_000n);
    const actions = (await prisma.auditLog.findMany({ where: { tenantId, objectType: { in: ['commission', 'sales_bonus'] } }, select: { action: true } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['commission.accrue', 'sales_bonus.kpi_confirm', 'commission.receipt', 'sales_bonus.status', 'sales_bonus.pay']));
  });

  it('BR-P44: расторжение до поступления → комиссия CANCELLED, бонусы WITHHELD; KPI без подтверждения после срока → WITHHELD (джоб)', async () => {
    const deal = await createDeal(ctx(['COMMERCIAL_MANAGER'], cmId), { contactName: 'Фаррух', unitId: unitB, product: 'LEASE_OFFICE', managerId: salesId, externalBrokerName: 'UzFranchise', externalShareBp: 2000 });
    const lease = await createLease(ctx(['COMMERCIAL_MANAGER'], cmId), { unitId: unitB, dealId: deal.id, type: 'LTR', occupantName: 'Delta', startAt: d('2026-08-01'), endAt: null, rentMinor: 1_000_000n });
    await activateLease(ctx(['COMMERCIAL_MANAGER'], cmId), lease.id, d('2026-08-01'));
    const [c] = await listCommissions(ctx(['OWNER']), { dealId: deal.id });
    expect(c).toMatchObject({ amountMinor: 500_000n, externalShareBp: 2000, netMinor: 400_000n }); // доля внешнего брокера снижает базу бонуса
    expect((await listBonuses(ctx(['OWNER']), {})).find((b) => b.dealId === deal.id && b.kind === 'DEAL')?.amountMinor).toBe(80_000n);
    expect(await withholdExpiredKpi(tenantId, d('2026-08-20'))).toBe(1); // дедлайн 15.08 прошёл
    await terminateLease(ctx(['COMMERCIAL_MANAGER'], cmId), lease.id, 'арендатор съехал, не заплатив', d('2026-08-25'));
    expect((await listCommissions(ctx(['OWNER']), { dealId: deal.id }))[0]?.status).toBe('CANCELLED');
    const bs = (await listBonuses(ctx(['OWNER']), {})).filter((b) => b.dealId === deal.id);
    expect(bs.map((b) => [b.kind, b.status])).toEqual(expect.arrayContaining([['DEAL', 'WITHHELD'], ['KPI', 'WITHHELD']]));
    expect(bs.find((b) => b.kind === 'KPI')?.withheldReason).toBe('KPI_DEADLINE_PASSED');
  });

  it('продажа: закрытие ценой → WON, комиссия 3% c продавца (коридор), бонус треть комиссии; STR — комиссия ждёт решения; 404 чужой tenant', async () => {
    const sale = await createDeal(ctx(['COMMERCIAL_MANAGER'], cmId), { contactName: 'Продавец', unitId: unitS, product: 'SALE', commissionRateBp: 200 });
    await expect(closeSale(ctx(['COMMERCIAL_MANAGER'], cmId), sale.id, { salePriceMinor: 35_000_000n })).rejects.toThrow(/Illegal transition/); // из PROPERTY_SELECTED нельзя
    for (let i = 0; i < 5; i++) await moveDeal(ctx(['COMMERCIAL_MANAGER'], cmId), sale.id, 'advance'); // → CONTRACT
    await expect(closeSale(ctx(['BROKER'], salesId), sale.id, { salePriceMinor: 35_000_000n })).rejects.toThrow(NotFoundError); // не своя сделка (BR-P21)
    const won = await closeSale(ctx(['COMMERCIAL_MANAGER'], cmId), sale.id, { salePriceMinor: 35_000_000n }, d('2026-09-12'));
    expect(won.stage).toBe('WON');
    const [c] = await listCommissions(ctx(['OWNER']), { dealId: sale.id });
    expect(c).toMatchObject({ product: 'SALE', payer: 'SELLER', rateBp: 200, amountMinor: 700_000n });
    expect((await listBonuses(ctx(['OWNER']), {})).find((b) => b.dealId === sale.id)?.amountMinor).toBe(233_310n); // 3333 б.п. от 700 000
    await expect(createDeal(ctx(['COMMERCIAL_MANAGER'], cmId), { contactName: 'x', product: 'SALE', externalShareBp: 12_000 })).rejects.toThrow(/SHARE_INVALID/);
    // STR: ставка не утверждена — WON без комиссии
    const strUnit = (await createUnit(ctx(['COMMERCIAL_MANAGER']), { floorId: (await prisma.unit.findUniqueOrThrow({ where: { id: unitS } })).floorId, unitNo: '1204', type: 'APARTMENT', areaM2: 50 })).id;
    const strDeal = await createDeal(ctx(['COMMERCIAL_MANAGER'], cmId), { contactName: 'Собственник STR', unitId: strUnit, product: 'STR_MANDATE' });
    const strLease = await createLease(ctx(['COMMERCIAL_MANAGER'], cmId), { unitId: strUnit, dealId: strDeal.id, type: 'STR', occupantName: 'Гость', startAt: d('2026-09-01'), endAt: null, rentMinor: 100_000n });
    await activateLease(ctx(['COMMERCIAL_MANAGER'], cmId), strLease.id, d('2026-09-01'));
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: strDeal.id } })).stage).toBe('WON');
    expect(await listCommissions(ctx(['OWNER']), { dealId: strDeal.id })).toHaveLength(0);
    const other = (await prisma.tenant.create({ data: { slug: `t-cmo-${Date.now()}`, legalName: 'O', taxId: '300000112' } })).id;
    await expect(confirmKpi(unsafeCreateTenantContext({ tenantId: other, tenantSlug: 'o', userId: 'u', roles: ['OWNER'] }), dealA)).rejects.toThrow(NotFoundError);
  });
});
