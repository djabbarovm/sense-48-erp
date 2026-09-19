import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotFoundError, PermissionDeniedError, ValidationError, unsafeCreateTenantContext, type RoleCode } from '@finance-os/core';
import { prisma } from '../src/client.js';
import { addHouseExpense, createHouseFund, generateHouseCharges, getHouseDashboard, getTransparencyReport, listHouseCharges, managementContractCoverage, markOverdueHouseCharges, matchHouseReceipt, ownerHouseReport, setManagementContractStatus, setUnitCadastre, updateHouseFund, upsertHouseBudgetLine } from '../src/services/house.js';
import { createBuilding, createFloor, createPropertyOwner, createUnit } from '../src/services/property.js';
import { getOwnerPortal } from '../src/services/ownerPortal.js';

let tenantId: string;
let otherTenantId: string;
let buildingId: string;
let fundId: string;
let ownerId: string;
let owner2Id: string;
let ownerUserId: string;
let unitId: string; // 100 м² договорных, кадастр 98.5

let houseAccountId: string;
let otherAccountId: string;
const ctx = (roles: RoleCode[], userId?: string) => unsafeCreateTenantContext({ tenantId, tenantSlug: 'hs', userId: userId ?? crypto.randomUUID(), roles });
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const T = 12_000_00n; // тариф 12 000 сум/м² (в тийинах)
const tx = (accountId: string, externalId: string, amountMinor: bigint, date = d('2026-09-10')) => prisma.bankTransaction.create({ data: { tenantId, bankAccountId: accountId, externalId, bookingDate: date, valueDate: date, amountMinor, currency: 'UZS', counterpartyName: 'Собственник', purposeText: 'взнос на содержание' } });

beforeAll(async () => {
  const ts = Date.now();
  tenantId = (await prisma.tenant.create({ data: { slug: `t-hs-${ts}`, legalName: 'HS', taxId: '300000102', settings: {} } })).id;
  otherTenantId = (await prisma.tenant.create({ data: { slug: `t-hs2-${ts}`, legalName: 'HS2', taxId: '300000103', settings: {} } })).id;
  ownerUserId = (await prisma.user.create({ data: { email: `hs-owner-${ts}@t.test`, fullName: 'Собственник' } })).id;
  await prisma.userTenantRole.create({ data: { tenantId, userId: ownerUserId, role: 'PROPERTY_OWNER' } });
  const opsUser = (await prisma.user.create({ data: { email: `hs-ops-${ts}@t.test`, fullName: 'Ops' } })).id;
  await prisma.userTenantRole.create({ data: { tenantId, userId: opsUser, role: 'OPERATIONS_MANAGER' } });
  houseAccountId = (await prisma.bankAccount.create({ data: { tenantId, bankName: 'Bank', mfo: '00000', accountMasked: '****HOUSE', accountEncrypted: 'enc', currency: 'UZS' } })).id;
  otherAccountId = (await prisma.bankAccount.create({ data: { tenantId, bankName: 'Bank', mfo: '00000', accountMasked: '****ORDO', accountEncrypted: 'enc', currency: 'UZS' } })).id;
  const b = await createBuilding(ctx(['ADMIN']), { code: 'RT', name: 'Residence Tower', kind: 'TOWER' });
  buildingId = b.id;
  const f = await createFloor(ctx(['ADMIN']), { buildingId, floorNo: 5 });
  ownerId = (await createPropertyOwner(ctx(['COMMERCIAL_MANAGER']), { kind: 'PERSON', displayName: 'Собственник', managementConsent: true })).id;
  await prisma.propertyOwner.update({ where: { id: ownerId }, data: { userId: ownerUserId } });
  owner2Id = (await createPropertyOwner(ctx(['COMMERCIAL_MANAGER']), { kind: 'PERSON', displayName: 'Сосед' })).id;
  unitId = (await createUnit(ctx(['COMMERCIAL_MANAGER']), { floorId: f.id, unitNo: '501', type: 'APARTMENT', areaM2: 100, ownerId })).id;
  await createUnit(ctx(['COMMERCIAL_MANAGER']), { floorId: f.id, unitNo: '502', type: 'APARTMENT', areaM2: 60, ownerId: owner2Id }); // 60 м², без кадастра (preCadastre)
  await createUnit(ctx(['COMMERCIAL_MANAGER']), { floorId: f.id, unitNo: '503', type: 'APARTMENT', areaM2: 60 }); // без собственника
  await createUnit(ctx(['COMMERCIAL_MANAGER']), { floorId: f.id, unitNo: 'TECH-5', type: 'TECHNICAL', areaM2: 20, ownerId }); // не начисляется
});
afterAll(async () => prisma.$disconnect());

describe('Деньги дома (BR-P51/P52/P53/P54)', () => {
  it('фонд: только house.manage, валидация, audit', async () => {
    await expect(createHouseFund(ctx(['JUNIOR_FINANCE']), { name: 'X', tariffPerM2Minor: T })).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(createHouseFund(ctx(['OPERATIONS_MANAGER']), { name: 'X', tariffPerM2Minor: -1n })).rejects.toBeInstanceOf(ValidationError);
    await expect(createHouseFund(ctx(['OPERATIONS_MANAGER']), { name: 'X', tariffPerM2Minor: T, dueDay: 31 })).rejects.toBeInstanceOf(ValidationError);
    const fund = await createHouseFund(ctx(['OPERATIONS_MANAGER']), { buildingId, name: 'Фонд содержания Residence Tower', tariffPerM2Minor: T, bankAccountId: houseAccountId, dueDay: 15, tariffApprovedAt: d('2026-02-05') });
    fundId = fund.id;
    expect(fund.managementFeeBp).toBeNull(); // ставка OPEN до заключения Quantum Law
    expect(await prisma.auditLog.count({ where: { tenantId, objectType: 'house_fund', objectId: fundId, action: 'house_fund.create' } })).toBe(1);
    await expect(updateHouseFund(ctx(['OPERATIONS_MANAGER']), fundId, { managementFeeBp: 20_000 })).rejects.toBeInstanceOf(ValidationError);
  });

  it('BR-P51: кадастровая площадь → взнос; без кадастра — договорная c пометкой; юниты без собственника и технические не начисляются; идемпотентно', async () => {
    await setUnitCadastre(ctx(['COMMERCIAL_MANAGER']), unitId, { cadastralNumber: '10:01:02:03:04:0501', cadastralAreaM2: 98.5 });
    await expect(setUnitCadastre(ctx(['COMMERCIAL_MANAGER']), unitId, { cadastralAreaM2: 0 })).rejects.toBeInstanceOf(ValidationError);
    await expect(setUnitCadastre(ctx(['JUNIOR_FINANCE']), unitId, { cadastralAreaM2: 1 })).rejects.toBeInstanceOf(PermissionDeniedError);
    const r = await generateHouseCharges(tenantId, d('2026-09-10'), { fromMonth: d('2026-07-01') });
    expect(r).toEqual({ created: 6, withoutOwner: 1 }); // 2 юнита × 3 месяца
    expect(await generateHouseCharges(tenantId, d('2026-09-10'), { fromMonth: d('2026-07-01') })).toEqual({ created: 0, withoutOwner: 1 });
    const rows = await listHouseCharges(ctx(['ACCOUNTANT']), { fundId, period: d('2026-09-01') });
    const c501 = rows.find((c) => c.unitNo === '501')!; const c502 = rows.find((c) => c.unitNo === '502')!;
    expect(c501.amountMinor).toBe(1_182_000_00n); // 98.5 × 12 000
    expect(c501.preCadastre).toBe(false);
    expect(c502.amountMinor).toBe(720_000_00n); // 60 × 12 000 по договорной
    expect(c502.preCadastre).toBe(true);
    expect(c501.number).toMatch(/^HC-\d{4}-\d{6}$/);
    expect(c501.dueAt.toISOString().slice(0, 10)).toBe('2026-09-15');
    expect(rows.some((c) => c.unitNo === 'TECH-5')).toBe(false);
    await expect(listHouseCharges(ctx(['BROKER']), { fundId })).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('BR-P52/P53: PAID только зачётом поступления на счёт дома; чужой счёт и чужой tenant блокируются', async () => {
    const [c] = await listHouseCharges(ctx(['ACCOUNTANT']), { fundId, period: d('2026-07-01'), ownerId });
    const wrong = await tx(otherAccountId, 'hs-wrong', 1_182_000_00n);
    await expect(matchHouseReceipt(ctx(['JUNIOR_FINANCE']), { bankTransactionId: wrong.id, houseChargeId: c!.id })).rejects.toThrow(/WRONG_ACCOUNT/);
    const partial = await tx(houseAccountId, 'hs-part', 500_000_00n);
    const p = await matchHouseReceipt(ctx(['JUNIOR_FINANCE']), { bankTransactionId: partial.id, houseChargeId: c!.id }, d('2026-07-10'));
    expect([p.status, p.receivedMinor]).toEqual(['PARTIAL', 500_000_00n]);
    const rest = await tx(houseAccountId, 'hs-rest', 682_000_00n);
    const paid = await matchHouseReceipt(ctx(['JUNIOR_FINANCE']), { bankTransactionId: rest.id, houseChargeId: c!.id }, d('2026-07-12'));
    expect([paid.status, paid.receivedMinor, paid.paidAt?.toISOString().slice(0, 10)]).toEqual(['PAID', 1_182_000_00n, '2026-07-12']);
    await expect(matchHouseReceipt(ctx(['JUNIOR_FINANCE']), { bankTransactionId: rest.id, houseChargeId: c!.id })).rejects.toBeInstanceOf(ValidationError); // уже закрыт
    await expect(matchHouseReceipt(ctx(['COMMERCIAL_MANAGER']), { bankTransactionId: rest.id, houseChargeId: c!.id })).rejects.toBeInstanceOf(PermissionDeniedError);
    const foreign = unsafeCreateTenantContext({ tenantId: otherTenantId, tenantSlug: 'o', userId: crypto.randomUUID(), roles: ['JUNIOR_FINANCE'] });
    await expect(matchHouseReceipt(foreign, { bankTransactionId: rest.id, houseChargeId: c!.id })).rejects.toBeInstanceOf(NotFoundError);
    expect(await prisma.reconciliationMatch.count({ where: { objectType: 'HOUSE_CHARGE', objectId: c!.id } })).toBe(2);
    expect(await prisma.auditLog.count({ where: { tenantId, objectType: 'house_charge', objectId: c!.id, action: 'house_charge.receipt' } })).toBe(2);
  });

  it('просрочка: OVERDUE + задача HOUSE_CHARGE_OVERDUE (дедуп по собственнику) + событие', async () => {
    expect(await markOverdueHouseCharges(tenantId, d('2026-09-20'))).toBe(5); // всё кроме оплаченного июля 501
    expect(await markOverdueHouseCharges(tenantId, d('2026-09-20'))).toBe(0);
    expect(await prisma.task.count({ where: { tenantId, type: 'HOUSE_CHARGE_OVERDUE', status: 'OPEN' } })).toBe(2); // по одному на собственника
    expect(await prisma.domainEvent.count({ where: { tenantId, type: 'house.charge.overdue' } })).toBe(5);
  });

  it('бюджет, расходы, дашборд: план/факт, перерасчёт BR-P54, вознаграждение строкой (OPEN → null), должники, без плательщика', async () => {
    await upsertHouseBudgetLine(ctx(['OPERATIONS_MANAGER']), { fundId, year: 2026, category: 'LIFTS', plannedMinor: 24_000_000_00n });
    await upsertHouseBudgetLine(ctx(['OPERATIONS_MANAGER']), { fundId, year: 2026, category: 'LIFTS', plannedMinor: 30_000_000_00n }); // upsert
    await upsertHouseBudgetLine(ctx(['OPERATIONS_MANAGER']), { fundId, year: 2026, category: 'CLEANING', plannedMinor: 12_000_000_00n });
    await expect(addHouseExpense(ctx(['OPERATIONS_MANAGER']), { fundId, date: d('2026-08-20'), category: 'LIFTS', amountMinor: 0n, contractorName: 'Lift', description: 'x' })).rejects.toBeInstanceOf(ValidationError);
    await expect(addHouseExpense(ctx(['ACCOUNTANT']), { fundId, date: d('2026-08-20'), category: 'LIFTS', amountMinor: 1n, contractorName: 'Lift', description: 'x' })).rejects.toBeInstanceOf(PermissionDeniedError);
    await addHouseExpense(ctx(['OPERATIONS_MANAGER']), { fundId, date: d('2026-08-20'), category: 'LIFTS', amountMinor: 900_000_00n, contractorName: 'LiftService', description: 'ТО лифтов, август' });
    await addHouseExpense(ctx(['OPERATIONS_MANAGER']), { fundId, date: d('2026-09-05'), category: 'OTHER', amountMinor: 100_000_00n, contractorName: 'Hoz', description: 'Расходники' });
    const dash = await getHouseDashboard(ctx(['OPERATIONS_MANAGER']), fundId, 2026, d('2026-09-20'));
    expect(dash.money.chargedMinor).toBe(3n * (1_182_000_00n + 720_000_00n));
    expect(dash.money.collectedMinor).toBe(1_182_000_00n);
    expect(dash.money.spentMinor).toBe(1_000_000_00n);
    expect(dash.money.managementFeeMinor).toBeNull(); // ставка OPEN
    expect(dash.money.feeOpen).toBe(true);
    expect(dash.recalc.carryForwardCreditMinor).toBe(182_000_00n); // собрано − потрачено > 0 → кредит собственникам, не прибыль
    expect(dash.recalc.shortfallMinor).toBe(0n);
    expect(dash.budget.find((l) => l.category === 'LIFTS')).toMatchObject({ plannedMinor: 30_000_000_00n, actualMinor: 900_000_00n, complianceFloor: true });
    expect(dash.budget.find((l) => l.category === 'OTHER')).toMatchObject({ plannedMinor: 0n, actualMinor: 100_000_00n });
    expect(dash.units).toMatchObject({ total: 3, withOwner: 2, withoutOwner: ['503'], preCadastre: 2, payableAreaM2: 218.5 });
    expect(dash.debtors.map((x) => [x.ownerName, x.unitNos])).toEqual([[ 'Собственник', ['501']], ['Сосед', ['502']]]);
    expect(dash.byMonth.map((m) => m.month)).toEqual([7, 8, 9]);
    // вознаграждение видит только house.manage / mall.fee.view; после фиксации ставки — отдельной строкой
    await updateHouseFund(ctx(['OWNER']), fundId, { managementFeeBp: 1000 });
    expect((await getHouseDashboard(ctx(['OWNER']), fundId, 2026, d('2026-09-20'))).money.managementFeeMinor).toBe(118_200_00n);
    expect((await getHouseDashboard(ctx(['ACCOUNTANT']), fundId, 2026, d('2026-09-20'))).money.managementFeeMinor).toBeNull();
    await expect(getHouseDashboard(ctx(['BROKER']), fundId)).rejects.toBeInstanceOf(PermissionDeniedError);
    const foreign = unsafeCreateTenantContext({ tenantId: otherTenantId, tenantSlug: 'o', userId: crypto.randomUUID(), roles: ['OWNER'] });
    await expect(getHouseDashboard(foreign, fundId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('отчёт прозрачности за месяц: деньги · работы · качество · дальше; собственник читает через owner.portal', async () => {
    const rep = await getTransparencyReport(ctx(['PROPERTY_OWNER'], ownerUserId), fundId, '2026-07', d('2026-09-20'));
    expect(rep.money).toMatchObject({ chargedMinor: 1_902_000_00n, collectedMinor: 1_182_000_00n, outstandingMinor: 720_000_00n, spentMinor: 0n, managementFeeMinor: 118_200_00n });
    expect(rep.money.budget.find((l) => l.category === 'LIFTS')?.plannedMinor).toBe(2_500_000_00n); // годовой план / 12
    expect(rep.quality.slaPct).toBeNull();
    expect(rep.next.tariffApproved).toBe(true);
    await expect(getTransparencyReport(ctx(['ACCOUNTANT']), fundId, '2026-7')).rejects.toBeInstanceOf(ValidationError);
    await expect(getTransparencyReport(ctx(['BROKER']), fundId, '2026-07')).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('кабинет собственника: свои взносы и остаток; чужие не видны', async () => {
    const mine = await ownerHouseReport(ctx(['PROPERTY_OWNER'], ownerUserId), ownerId, d('2026-09-20'));
    expect(mine?.charges.length).toBe(3);
    expect(mine?.outstandingMinor).toBe(2n * 1_182_000_00n);
    expect(mine?.overdue).toBe(2);
    const portal = await getOwnerPortal(ctx(['PROPERTY_OWNER'], ownerUserId), d('2026-09-20'));
    expect(portal.house?.outstandingMinor).toBe(2n * 1_182_000_00n);
    expect(portal.house?.charges.every((c) => c.unitNo === '501')).toBe(true);
  });

  it('ст. 28: статус договора управления и охват', async () => {
    await expect(setManagementContractStatus(ctx(['COMMERCIAL_MANAGER']), ownerId, 'SIGNED')).rejects.toBeInstanceOf(ValidationError); // нет даты
    await expect(setManagementContractStatus(ctx(['ACCOUNTANT']), ownerId, 'SENT')).rejects.toBeInstanceOf(PermissionDeniedError);
    await setManagementContractStatus(ctx(['COMMERCIAL_MANAGER']), owner2Id, 'SENT');
    const o = await setManagementContractStatus(ctx(['COMMERCIAL_MANAGER']), ownerId, 'SIGNED', d('2026-03-01'));
    expect(o.managementContractSignedAt?.toISOString().slice(0, 10)).toBe('2026-03-01');
    expect(await managementContractCoverage(ctx(['OPERATIONS_MANAGER']))).toMatchObject({ total: 2, signed: 1, sent: 1, none: 0, signedPct: 50 });
    expect(await prisma.auditLog.count({ where: { tenantId, objectType: 'property_owner', action: 'property_owner.contract_status' } })).toBe(2);
  });
});
