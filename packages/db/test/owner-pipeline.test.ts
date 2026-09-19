import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotFoundError, PermissionDeniedError, ValidationError, unsafeCreateTenantContext, type RoleCode } from '@finance-os/core';
import { prisma } from '../src/client.js';
import { addOwnerActivity, getOwnerCard, getOwnerPipeline, markCalcShown, markOverdueOwnerFollowups, moveOwnerStage, ownerCalc, setOwnerNextAction } from '../src/services/ownerPipeline.js';
import { createBuilding, createFloor, createPropertyOwner, createUnit } from '../src/services/property.js';
import { createDeal } from '../src/services/deals.js';

let tenantId: string; let otherTenantId: string; let cmId: string; let ownerId: string; let unitId: string;
const ctx = (roles: RoleCode[] = ['COMMERCIAL_MANAGER'], userId = cmId) => unsafeCreateTenantContext({ tenantId, tenantSlug: 'op', userId, roles });
const d = (s: string) => new Date(`${s}T10:00:00Z`);

beforeAll(async () => {
  const ts = Date.now();
  tenantId = (await prisma.tenant.create({ data: { slug: `t-op-${ts}`, legalName: 'OP', taxId: '300000401', settings: { owner_calc: { str_fee_bp: null, str_occupancy_pct: 60 } } } })).id;
  otherTenantId = (await prisma.tenant.create({ data: { slug: `t-op2-${ts}`, legalName: 'OP2', taxId: '300000402', settings: {} } })).id;
  cmId = (await prisma.user.create({ data: { email: `op-cm-${ts}@t.test`, fullName: 'Менеджер' } })).id;
  await prisma.userTenantRole.create({ data: { tenantId, userId: cmId, role: 'COMMERCIAL_MANAGER' } });
  const b = await createBuilding(ctx(['ADMIN']), { code: 'OP', name: 'OP Tower', kind: 'TOWER' });
  const f = await createFloor(ctx(['ADMIN']), { buildingId: b.id, floorNo: 7 });
  ownerId = (await createPropertyOwner(ctx(), { kind: 'PERSON', displayName: 'Рустам Каримов', contactPhone: '+998 (90) 555-11-22' })).id;
  unitId = (await createUnit(ctx(), { floorId: f.id, unitNo: '701', type: 'APARTMENT', areaM2: 62, ownerId, askingRateMinor: 1_200_00n, askingCurrency: 'USD' } as never)).id;
});
afterAll(async () => prisma.$disconnect());

describe('Воронка собственников (BR-P57/P58)', () => {
  it('новый собственник — LEAD; активность переводит в CONTACTED и ставит follow-up; следующее действие', async () => {
    expect((await prisma.propertyOwner.findUniqueOrThrow({ where: { id: ownerId } })).pipelineStage).toBe('LEAD');
    await addOwnerActivity(ctx(), ownerId, { kind: 'CALL', note: 'Позвонил, интересуется управлением', followUpAt: d('2026-09-25') });
    const o = await prisma.propertyOwner.findUniqueOrThrow({ where: { id: ownerId } });
    expect([o.pipelineStage, o.nextActionAt?.toISOString().slice(0, 10), o.managerId]).toEqual(['CONTACTED', '2026-09-25', cmId]);
    await setOwnerNextAction(ctx(), ownerId, { nextAction: 'Отправить расчёт', nextActionAt: d('2026-09-20') });
    await expect(addOwnerActivity(ctx(['BROKER']), ownerId, { kind: 'NOTE', note: 'x' })).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('расчёт трёх сценариев по asking rate юнита c настройками тенанта (STR fee OPEN); показ фиксируется → CALC_SHOWN', async () => {
    const r = await ownerCalc(ctx(['BROKER']), ownerId);
    expect(r.baseMonthlyMinor).toBe(1_200_00n);
    expect(r.calc?.scenarios.map((s) => s.key)).toEqual(['LTR', 'MID', 'STR']);
    expect(r.calc?.scenarios[2]?.feeOpen).toBe(true);
    expect(r.calc?.scenarios[2]?.assumptions.some((a) => a.includes('60%'))).toBe(true); // из settings
    const withAdr = await ownerCalc(ctx(), ownerId, { strAdrMinor: 150_00n, strFeeBp: 1500 });
    expect([withAdr.calc?.recommended, withAdr.calc?.provisional]).toEqual(['STR', false]);
    await markCalcShown(ctx(), ownerId, 'LTR $1 100 / MID $1 312 / STR ~$1 200 в мес');
    const o = await prisma.propertyOwner.findUniqueOrThrow({ where: { id: ownerId } });
    expect([o.pipelineStage, !!o.calcShownAt]).toEqual(['CALC_SHOWN', true]);
    // квартира без ставки → база по средней ставке за м² здания (701: $1 200 / 62 м²)
    const noRateOwner = (await createPropertyOwner(ctx(), { kind: 'PERSON', displayName: 'Без ставки' })).id;
    const floor7 = await prisma.floor.findFirstOrThrow({ where: { tenantId } });
    await createUnit(ctx(), { floorId: floor7.id, unitNo: '702', type: 'APARTMENT', areaM2: 31, ownerId: noRateOwner });
    const avg = await ownerCalc(ctx(), noRateOwner);
    expect([avg.baseSource, avg.baseMonthlyMinor]).toEqual(['BUILDING_AVG', 600_00n]);
    expect(avg.calc?.scenarios[0]?.assumptions[0]).toMatch(/средняя ставка/);
    await expect(ownerCalc(unsafeCreateTenantContext({ tenantId: otherTenantId, tenantSlug: 'o', userId: cmId, roles: ['COMMERCIAL_MANAGER'] }), ownerId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('переходы: CONSENT ставит согласие, CONTRACT_SENT/SIGNED синхронизируют договор (ст. 28), HANDED_OVER требует юнит под управлением, LOST требует причину; audit и событие', async () => {
    await expect(moveOwnerStage(ctx(), ownerId, 'LOST')).rejects.toBeInstanceOf(ValidationError);
    await expect(moveOwnerStage(ctx(), ownerId, 'LEAD')).rejects.toBeInstanceOf(ValidationError); // назад больше чем на шаг
    await moveOwnerStage(ctx(), ownerId, 'CONSENT');
    expect((await prisma.propertyOwner.findUniqueOrThrow({ where: { id: ownerId } })).managementConsent).toBe(true);
    await moveOwnerStage(ctx(), ownerId, 'CONTRACT_SENT');
    expect((await prisma.propertyOwner.findUniqueOrThrow({ where: { id: ownerId } })).managementContractStatus).toBe('SENT');
    await moveOwnerStage(ctx(), ownerId, 'SIGNED', { signedAt: d('2026-09-18') });
    const signed = await prisma.propertyOwner.findUniqueOrThrow({ where: { id: ownerId } });
    expect([signed.managementContractStatus, signed.managementContractSignedAt?.toISOString().slice(0, 10)]).toEqual(['SIGNED', '2026-09-18']);
    await expect(moveOwnerStage(ctx(), ownerId, 'HANDED_OVER')).rejects.toThrow(/NO_MANAGED_UNIT/);
    await prisma.unit.update({ where: { id: unitId }, data: { managedByPlatform: true } });
    await moveOwnerStage(ctx(), ownerId, 'HANDED_OVER');
    await expect(moveOwnerStage(ctx(), ownerId, 'LOST', { reason: 'FEE' })).rejects.toBeInstanceOf(ValidationError);
    expect(await prisma.auditLog.count({ where: { tenantId, objectId: ownerId, action: 'property_owner.stage' } })).toBe(5);
    expect(await prisma.domainEvent.count({ where: { tenantId, type: 'owner.stage.changed', objectId: ownerId } })).toBe(5);
    await expect(moveOwnerStage(ctx(['MARKETING']), ownerId, 'LOST', { reason: 'FEE' })).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('воронка и карточка: сегмент, конверсия, просрочка follow-up → задача OWNER_FOLLOWUP (дедуп); контакт по телефону виден в карточке', async () => {
    const lost = (await createPropertyOwner(ctx(), { kind: 'PERSON', displayName: 'Отказник', contactPhone: '+998901000001' })).id;
    await moveOwnerStage(ctx(), lost, 'CONTACTED'); await moveOwnerStage(ctx(), lost, 'LOST', { reason: 'SELF_MANAGES' });
    const late = (await createPropertyOwner(ctx(), { kind: 'PERSON', displayName: 'Медленный', contactPhone: '+998901000002' })).id;
    await setOwnerNextAction(ctx(), late, { nextAction: 'Перезвонить', nextActionAt: d('2026-09-01') });
    const p = await getOwnerPipeline(ctx(), {}, d('2026-09-19'));
    expect(p.rows.find((r) => r.id === ownerId)).toMatchObject({ stage: 'HANDED_OVER', segment: 'ONE_BED', managedUnits: 1, calcShown: true });
    expect(p.conversion.find((c) => c.segment === 'ALL')).toMatchObject({ total: 4, reached: 1, lost: 1 }); // + собственник «Без ставки» из расчёта
    expect(p.lostReasons).toEqual([{ reason: 'SELF_MANAGES', count: 1 }]);
    expect(p.overdue).toBe(1);
    expect(await markOverdueOwnerFollowups(tenantId, d('2026-09-19'))).toBe(1);
    expect(await markOverdueOwnerFollowups(tenantId, d('2026-09-19'))).toBe(0);
    expect(await prisma.task.count({ where: { tenantId, type: 'OWNER_FOLLOWUP', objectId: late } })).toBe(1);
    await createDeal(ctx(), { contactName: 'Рустам', contactPhone: '90 555 11 22' }); // тот же телефон → контакт связан c собственником
    const card = await getOwnerCard(ctx(), ownerId, d('2026-09-19'));
    expect([card.owner.contactPhone, card.units.length, card.contact?.deals.length, card.activities.length > 3]).toEqual(['+998905551122', 1, 1, true]);
    const masked = await getOwnerCard(ctx(['BROKER']), ownerId);
    expect(masked.owner.contactPhone).toBe('+99890***1122');
    await expect(getOwnerCard(ctx(['ACCOUNTANT']), ownerId)).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});
