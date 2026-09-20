import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotFoundError, PermissionDeniedError, unsafeCreateTenantContext, type RoleCode } from '@finance-os/core';
import { prisma } from '../src/client.js';
import { generateRentCharges, getReceivablesSummary, getUnitFinance, listRentCharges, listUnmatchedIncoming, markOverdueRentCharges, matchRentReceipt } from '../src/services/rent.js';
import { createBuilding, createFloor, createPropertyOwner, createUnit, listUnits } from '../src/services/property.js';
import { activateLease, createLease, terminateLease } from '../src/services/leases.js';
import { getControlRoom } from '../src/services/controlRoom.js';
import { getOwnerPortal } from '../src/services/ownerPortal.js';

let tenantId: string;
let unitId: string;
let unit2Id: string;
let leaseId: string;
let accountId: string;
let ownerUserId: string;
const ctx = (roles: RoleCode[], userId?: string) => unsafeCreateTenantContext({ tenantId, tenantSlug: 'rc', userId: userId ?? crypto.randomUUID(), roles });
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const tx = (externalId: string, amountMinor: bigint, currency = 'USD', date = d('2026-09-03')) => prisma.bankTransaction.create({ data: { tenantId, bankAccountId: accountId, externalId, bookingDate: date, valueDate: date, amountMinor, currency, counterpartyName: 'CityNet LLC', purposeText: 'аренда 901' } });

beforeAll(async () => {
  const ts = Date.now();
  tenantId = (await prisma.tenant.create({ data: { slug: `t-rc-${ts}`, legalName: 'RC', taxId: '300000101', settings: { management_fee_bp: 1000, rent_grace_days: 5 } } })).id;
  ownerUserId = (await prisma.user.create({ data: { email: `rc-owner-${ts}@t.test`, fullName: 'Собственник' } })).id;
  await prisma.userTenantRole.create({ data: { tenantId, userId: ownerUserId, role: 'PROPERTY_OWNER' } });
  accountId = (await prisma.bankAccount.create({ data: { tenantId, bankName: 'Bank', mfo: '00000', accountMasked: '****0001', accountEncrypted: 'enc', currency: 'USD' } })).id;
  const b = await createBuilding(ctx(['ADMIN']), { code: 'TOWER', name: 'Tower', kind: 'TOWER' });
  const f = await createFloor(ctx(['ADMIN']), { buildingId: b.id, floorNo: 9 });
  const ownerId = (await createPropertyOwner(ctx(['COMMERCIAL_MANAGER']), { kind: 'PERSON', displayName: 'Собственник', managementConsent: true })).id;
  await prisma.propertyOwner.update({ where: { id: ownerId }, data: { userId: ownerUserId } });
  unitId = (await createUnit(ctx(['COMMERCIAL_MANAGER']), { floorId: f.id, unitNo: '901', type: 'APARTMENT', areaM2: 80, ownerId, managedByPlatform: true })).id;
  unit2Id = (await createUnit(ctx(['COMMERCIAL_MANAGER']), { floorId: f.id, unitNo: '902', type: 'APARTMENT', areaM2: 80 })).id;
  // брокеридж: юнит НЕ под управлением — аренда идёт собственнику напрямую, ORDO не начисляет (BR-P40)
  const brokered = (await createUnit(ctx(['COMMERCIAL_MANAGER']), { floorId: f.id, unitNo: '903', type: 'APARTMENT', areaM2: 80, managedByPlatform: false })).id;
  const bl = await createLease(ctx(['COMMERCIAL_MANAGER']), { unitId: brokered, type: 'LTR', occupantName: 'Direct Tenant', startAt: d('2026-01-01'), endAt: null, rentMinor: 500_000n });
  await activateLease(ctx(['COMMERCIAL_MANAGER']), bl.id, d('2026-01-01'));
  // договор c 16 июля 2026 по 15 октября 2026, $3 000/мес
  const lease = await createLease(ctx(['COMMERCIAL_MANAGER']), { unitId, type: 'LTR', occupantName: 'CityNet', startAt: d('2026-07-16'), endAt: d('2026-10-15'), rentMinor: 300_000n, currency: 'USD' } as never);
  await activateLease(ctx(['COMMERCIAL_MANAGER']), lease.id, d('2026-07-16'));
  leaseId = lease.id;
  // юнит собственника без аренды — для OWNER_USE не начисляется
  const own = await createLease(ctx(['COMMERCIAL_MANAGER']), { unitId: unit2Id, type: 'OWNER_USE', occupantName: 'Owner', startAt: d('2026-01-01'), endAt: null, rentMinor: 0n });
  await activateLease(ctx(['COMMERCIAL_MANAGER']), own.id, d('2026-01-01'));
});
afterAll(async () => prisma.$disconnect());

describe('Аренда и дебиторка (BR-P37/P38/P39/P40)', () => {
  it('BR-P38: начисления по месяцам c пропорцией, идемпотентно; OWNER_USE не начисляется; RC-номера и audit', async () => {
    expect(await generateRentCharges(tenantId, d('2026-09-10'))).toBe(3); // июль (16 дн), август, сентябрь
    expect(await generateRentCharges(tenantId, d('2026-09-10'))).toBe(0);
    const rows = await listRentCharges(ctx(['ACCOUNTANT']), { leaseId });
    expect(rows.map((r) => [r.periodStart.toISOString().slice(0, 10), r.amountMinor, r.prorated, r.status])).toEqual([
      ['2026-07-16', 154_838n, true, 'DUE'], // период c даты заезда
      ['2026-08-01', 300_000n, false, 'DUE'],
      ['2026-09-01', 300_000n, false, 'DUE'],
    ]);
    expect(rows[0]!.number).toMatch(/^RC-\d{4}-\d{6}$/);
    expect(rows[0]!.dueAt.toISOString().slice(0, 10)).toBe('2026-07-21'); // старт периода + 5 дней льготы
    expect(await prisma.rentCharge.count({ where: { tenantId, unitId: unit2Id } })).toBe(0);
    expect(await prisma.rentCharge.count({ where: { tenantId, lease: { occupantName: 'Direct Tenant' } } })).toBe(0); // BR-P40
    expect(await generateRentCharges(tenantId, d('2026-09-10'), { fromMonth: d('2026-09-01') })).toBe(0); // fromMonth не даёт дублей
    // ADR-041 (Tower SPEC §1.1): BROKER видит дебиторку (receivables full); роль без rent.view (колл-центр) — отказ
    expect(Array.isArray(await listRentCharges(ctx(['BROKER'])))).toBe(true);
    await expect(listRentCharges(ctx(['CALL_CENTER']))).rejects.toThrow(PermissionDeniedError);
    expect(await prisma.auditLog.count({ where: { tenantId, objectType: 'rent_charge', action: 'rent_charge.create' } })).toBe(3);
  });

  it('просрочка → OVERDUE + Task RENT_OVERDUE (дедуп) + событие; фильтр «c задолженностью» и debtMinor только c правом', async () => {
    expect(await markOverdueRentCharges(tenantId, d('2026-09-10'))).toBe(3);
    expect(await markOverdueRentCharges(tenantId, d('2026-09-11'))).toBe(0);
    expect(await prisma.task.count({ where: { tenantId, type: 'RENT_OVERDUE' } })).toBe(3);
    expect((await prisma.domainEvent.findMany({ where: { tenantId, type: 'rent.overdue' } })).length).toBe(3);
    const debtors = await listUnits(ctx(['FINANCE_OPS_LEAD']), { withDebt: true }, d('2026-09-10'));
    expect(debtors.map((u) => [u.unitNo, u.debtMinor])).toEqual([['901', 754_838n]]);
    expect((await listUnits(ctx(['BROKER']), { withDebt: true }, d('2026-09-10'))).length).toBe(0); // без права — данных о долге нет
    expect((await listUnits(ctx(['BROKER']), {}, d('2026-09-10'))).find((u) => u.unitNo === '901')!.debtMinor).toBeNull();
  });

  it('BR-P37: PAID только зачётом входящей транзакции; частичная оплата; переплата и исходящие запрещены; чужой tenant 404', async () => {
    const [july, aug] = await listRentCharges(ctx(['FINANCE_OPS_LEAD']), { leaseId });
    const out = await tx('RC-OUT', -100_000n);
    await expect(matchRentReceipt(ctx(['FINANCE_OPS_LEAD']), { bankTransactionId: out.id, rentChargeId: july!.id })).rejects.toThrow(/TX_NOT_INCOMING/);
    const big = await tx('RC-IN-1', 200_000n);
    await expect(matchRentReceipt(ctx(['FINANCE_OPS_LEAD']), { bankTransactionId: big.id, rentChargeId: july!.id })).rejects.toThrow(/OVERPAYMENT/);
    await expect(matchRentReceipt(ctx(['ACCOUNTANT']), { bankTransactionId: big.id, rentChargeId: july!.id, amountMinor: 154_838n })).rejects.toThrow(PermissionDeniedError);
    const paidJuly = await matchRentReceipt(ctx(['FINANCE_OPS_LEAD']), { bankTransactionId: big.id, rentChargeId: july!.id, amountMinor: 154_838n }, d('2026-09-12'));
    expect(paidJuly.status).toBe('PAID');
    expect(paidJuly.paidAt).not.toBeNull();
    // остаток той же транзакции (45 162) — частично в август
    const partAug = await matchRentReceipt(ctx(['FINANCE_OPS_LEAD']), { bankTransactionId: big.id, rentChargeId: aug!.id }, d('2026-09-12'));
    expect(partAug.receivedMinor).toBe(45_162n);
    expect(partAug.status).toBe('OVERDUE'); // срок прошёл, остаток есть
    await expect(matchRentReceipt(ctx(['FINANCE_OPS_LEAD']), { bankTransactionId: big.id, rentChargeId: aug!.id, amountMinor: 1n })).rejects.toThrow(/TX_EXHAUSTED/);
    const uzs = await tx('RC-IN-UZS', 3_000_000_000n, 'UZS');
    await expect(matchRentReceipt(ctx(['FINANCE_OPS_LEAD']), { bankTransactionId: uzs.id, rentChargeId: aug!.id })).rejects.toThrow(/AMOUNT_REQUIRED/);
    const rest = await matchRentReceipt(ctx(['FINANCE_OPS_LEAD']), { bankTransactionId: uzs.id, rentChargeId: aug!.id, amountMinor: 254_838n }, d('2026-09-12'));
    expect(rest.status).toBe('PAID');
    expect((await prisma.bankTransaction.findUnique({ where: { id: big.id } }))!.matchStatus).toBe('MANUAL_MATCHED');
    expect((await prisma.reconciliationMatch.findMany({ where: { tenantId, objectType: 'RENT_CHARGE' } })).length).toBe(3);
    expect((await listUnmatchedIncoming(ctx(['FINANCE_OPS_LEAD']))).map((t) => t.id)).not.toContain(big.id);
    expect((await prisma.domainEvent.findMany({ where: { tenantId, type: 'rent.paid' } })).length).toBe(2);
    const other = (await prisma.tenant.create({ data: { slug: `t-rco-${Date.now()}`, legalName: 'O', taxId: '300000102' } })).id;
    await expect(matchRentReceipt(unsafeCreateTenantContext({ tenantId: other, tenantSlug: 'o', userId: 'u', roles: ['FINANCE_OPS_LEAD'] }), { bankTransactionId: big.id, rentChargeId: july!.id })).rejects.toThrow(NotFoundError);
  });

  it('карточка юнита Finance, пульт Finance и выписка собственника — из начислений; BR-P39: прекращение списывает будущие периоды', async () => {
    const fin = await getUnitFinance(ctx(['COMMERCIAL_MANAGER']), unitId, d('2026-09-12'));
    expect(fin.chargedMinor).toBe(754_838n);
    expect(fin.receivedMinor).toBe(454_838n);
    expect(fin.outstandingMinor).toBe(300_000n);
    expect(fin.overdueCount).toBe(1);
    expect(fin.ownerPayoutMinor).toBe(270_000n); // $3 000 − 10%
    await expect(getUnitFinance(ctx(['BROKER']), unitId)).rejects.toThrow(PermissionDeniedError);
    const cr = await getControlRoom(ctx(['OWNER']), d('2026-09-12'));
    expect(cr.finance?.outstandingMinor).toBe(300_000n);
    expect(cr.finance?.topDebtors[0]?.unitNo).toBe('901');
    expect(cr.finance?.collectionPct).toBe(0);
    // ADR-041: BROKER имеет rent.view → видит сводку дебиторки (read-only); роль без rent.view — null
    expect((await getControlRoom(ctx(['BROKER']), d('2026-09-12'))).finance).not.toBeNull();
    expect((await getControlRoom(ctx(['CALL_CENTER']), d('2026-09-12'))).finance).toBeNull();
    const portal = await getOwnerPortal(ctx(['PROPERTY_OWNER'], ownerUserId), d('2026-09-12'));
    expect(portal.statement[0]).toMatchObject({ unitNo: '901', receivedMinor: 0n, outstandingMinor: 300_000n, chargeStatus: 'OVERDUE' });
    // октябрь начислен (1–15) и списан при прекращении 20 сентября
    expect(await generateRentCharges(tenantId, d('2026-10-01'))).toBe(1);
    await terminateLease(ctx(['COMMERCIAL_MANAGER']), leaseId, 'выезд арендатора', d('2026-09-20'));
    const after = await listRentCharges(ctx(['FINANCE_OPS_LEAD']), { leaseId });
    expect(after.map((r) => [r.periodStart.toISOString().slice(0, 7), r.status])).toEqual([['2026-07', 'PAID'], ['2026-08', 'PAID'], ['2026-09', 'OVERDUE'], ['2026-10', 'WAIVED']]);
    expect((await getReceivablesSummary(ctx(['OWNER']), d('2026-09-21'))).outstandingMinor).toBe(300_000n);
  });
});
