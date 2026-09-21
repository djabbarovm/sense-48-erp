import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotFoundError, PermissionDeniedError, unsafeCreateTenantContext, type RoleCode } from '@finance-os/core';
import { prisma } from '../src/client.js';
import { confirmActionDraft, createActionDraft, listActionDrafts, rejectActionDraft, resolveBotUser } from '../src/services/actionDrafts.js';
import { createBuilding, createFloor, createUnit, changeUnitStatus, getUnitCard } from '../src/services/property.js';
import { activateLease, createLease } from '../src/services/leases.js';
import { getDeal, listDeals } from '../src/services/deals.js';

let tenantId: string;
let cmId: string;
let unitId: string;
const ctx = (roles: RoleCode[], userId?: string) => unsafeCreateTenantContext({ tenantId, tenantSlug: 'wb', userId: userId ?? crypto.randomUUID(), roles });

beforeAll(async () => {
  const ts = Date.now();
  tenantId = (await prisma.tenant.create({ data: { slug: `t-wb-${ts}`, legalName: 'WB', taxId: '300000051' } })).id;
  cmId = (await prisma.user.create({ data: { email: `wb-${ts}@t.test`, fullName: 'Алия', telegramChatId: `tg-${ts}` } })).id;
  await prisma.userTenantRole.create({ data: { tenantId, userId: cmId, role: 'COMMERCIAL_MANAGER' } });
  const b = await createBuilding(ctx(['ADMIN']), { code: 'TOWER', name: 'Tower', kind: 'TOWER' });
  const f = await createFloor(ctx(['ADMIN']), { buildingId: b.id, floorNo: 17 });
  unitId = (await createUnit(ctx(['COMMERCIAL_MANAGER']), { floorId: f.id, unitNo: '1704', type: 'APARTMENT', areaM2: 80, askingRateMinor: 120_000n })).id;
  const lease = await createLease(ctx(['COMMERCIAL_MANAGER'], cmId), { unitId, type: 'LTR', occupantName: 'CityNet', startAt: new Date('2026-01-01'), endAt: new Date('2027-01-01'), rentMinor: 110_000n });
  await activateLease(ctx(['COMMERCIAL_MANAGER'], cmId), lease.id);
});
afterAll(async () => prisma.$disconnect());

describe('P-12 WorkBot: draft → preview → confirm → commit → audit (BR-P30)', () => {
  it('«1704 освободился, можно выставлять»: черновик c preview; подтверждение расторгает договор, освобождает и публикует', async () => {
    const d = await createActionDraft(ctx(['BROKER']), { text: '1704 освободился, можно выставлять', source: 'TELEGRAM' });
    expect(d.status).toBe('DRAFT');
    expect(d.kind).toBe('UNIT_VACATE');
    expect(d.preview).toMatch(/расторгнуть действующий договор/);
    expect(d.unitId).toBe(unitId);
    // ADR-041 (Tower SPEC §2.2/§3.2): BROKER владеет договором (lease.manage) и листингом
    // (unit.publish) — расторгает договор и публикует сам (роль без права — 403, см. тест ниже c ACCOUNTANT).
    const ok = await confirmActionDraft(ctx(['BROKER']), d.id);
    expect(ok.status).toBe('CONFIRMED');
    expect(ok.resultRef).toBe(`/property/units/${unitId}`);
    const card = await getUnitCard(ctx(['BROKER']), unitId);
    expect(card.unit).toMatchObject({ occupancy: 'VACANT', leaseStatus: 'TERMINATED', commercialStatus: 'AVAILABLE' });
    expect(card.unit.publishedAt).not.toBeNull();
    expect(card.unit.view.color).toBe('RED');
    const actions = (await prisma.auditLog.findMany({ where: { tenantId, objectId: d.id }, orderBy: { seq: 'asc' }, select: { action: true } })).map((a) => a.action);
    expect(actions).toEqual(['action_draft.create', 'action_draft.confirm']);
    // rawText не попадает в audit
    expect(JSON.stringify((await prisma.auditLog.findMany({ where: { tenantId, objectType: 'action_draft' }, select: { before: true, after: true } })))).not.toContain('можно выставлять');
    await expect(confirmActionDraft(ctx(['BROKER']), d.id)).rejects.toThrow(/DRAFT_NOT_CONFIRMABLE/);
  });

  it('«1704 показали X Company, хотят 35 долларов за метр» → сделка на стадии «Показ», ставка × площадь, стадия юнита VIEWING', async () => {
    const d = await createActionDraft(ctx(['COMMERCIAL_MANAGER'], cmId), { text: '1704 показали X Company, хотят 35 долларов за метр' });
    expect(d.preview).toMatch(/создать сделку «X Company»/);
    const ok = await confirmActionDraft(ctx(['COMMERCIAL_MANAGER'], cmId), d.id);
    expect(ok.status).toBe('CONFIRMED');
    expect(ok.resultRef).toMatch(/^\/deals\//);
    const deal = await getDeal(ctx(['COMMERCIAL_MANAGER'], cmId), ok.resultRef!.split('/').pop()!);
    expect(deal.deal.stage).toBe('VIEWING');
    expect(deal.deal.company).toBe('X Company');
    expect(deal.deal.expectedRateMinor).toBe(3_500n * 80n); // 35$/м² × 80 м²
    expect(deal.deal.activities[0]?.kind).toBe('VIEWING');
    expect((await getUnitCard(ctx(['COMMERCIAL_MANAGER'], cmId), unitId)).unit.commercialStatus).toBe('VIEWING');
    // повторный показ → активность в ту же сделку, новой не создаётся
    const d2 = await createActionDraft(ctx(['COMMERCIAL_MANAGER'], cmId), { text: '1704 показали ещё раз, интересно' });
    expect(d2.preview).toMatch(/записать показ в сделку DEAL-/);
    await confirmActionDraft(ctx(['COMMERCIAL_MANAGER'], cmId), d2.id);
    expect((await listDeals(ctx(['COMMERCIAL_MANAGER'], cmId), { unitId })).length).toBe(1);
  });

  it('«1704 после клининга, жалоба на ванную» → заявка (HIGH), статус эксплуатации юнита из заявки (BR-P31), активность', async () => {
    const d = await createActionDraft(ctx(['OPERATIONS_MANAGER']), { text: '1704 после клининга, жалоба на ванную' });
    expect(d.kind).toBe('UNIT_ISSUE');
    expect(d.preview).toMatch(/создать заявку/);
    await expect(confirmActionDraft(ctx(['ACCOUNTANT']), d.id)).rejects.toThrow(PermissionDeniedError);
    const ok = await confirmActionDraft(ctx(['OPERATIONS_MANAGER']), d.id);
    expect(ok.status).toBe('CONFIRMED');
    expect(ok.resultRef).toMatch(/^\/workorders\//);
    const card = await getUnitCard(ctx(['OPERATIONS_MANAGER']), unitId);
    expect(card.unit.operationalStatus).toBe('ISSUE');
    expect(card.activities.some((a) => a.note.startsWith('[PLUMBING]'))).toBe(true);
    await expect(changeUnitStatus(ctx(['OPERATIONS_MANAGER']), unitId, { operationalStatus: 'NORMAL' })).rejects.toThrow(/WORKORDER_IS_SOURCE/);
  });

  it('запрос «покажи все красные больше 90 дней» → ссылка c фильтром, данные не меняются; нераспознанное → NEEDS_INFO; reject; 404 чужой tenant', async () => {
    const q = await createActionDraft(ctx(['MARKETING']), { text: 'Покажи все красные больше 90 дней' });
    const ok = await confirmActionDraft(ctx(['MARKETING']), q.id);
    expect(ok.resultRef).toBe('/property?color=RED&vacant=90');
    const bad = await createActionDraft(ctx(['BROKER']), { text: '9999 освободился' });
    expect(bad.status).toBe('NEEDS_INFO');
    expect(bad.preview).toMatch(/не найден/);
    const none = await createActionDraft(ctx(['BROKER']), { text: 'привет' });
    expect(none.status).toBe('NEEDS_INFO');
    expect(none.kind).toBeNull();
    const rej = await rejectActionDraft(ctx(['BROKER']), bad.id, 'опечатка');
    expect(rej.status).toBe('REJECTED');
    const list = await listActionDrafts(ctx(['COMMERCIAL_MANAGER'], cmId));
    expect(list.length).toBeGreaterThanOrEqual(6);
    const otherTenant = (await prisma.tenant.create({ data: { slug: `t-wbo-${Date.now()}`, legalName: 'O', taxId: '300000052' } })).id;
    await expect(confirmActionDraft(unsafeCreateTenantContext({ tenantId: otherTenant, tenantSlug: 'o', userId: 'u', roles: ['OWNER'] }), q.id)).rejects.toThrow(NotFoundError);
    await expect(createActionDraft(unsafeCreateTenantContext({ tenantId, tenantSlug: 'x', userId: 'u', roles: ['ACCOUNTANT'] }), { text: 'x' })).rejects.toThrow(PermissionDeniedError);
  });

  it('бот: пользователь по telegramChatId c ролью в тенанте ключа', async () => {
    const u = await resolveBotUser(tenantId, (await prisma.user.findUniqueOrThrow({ where: { id: cmId } })).telegramChatId!);
    expect(u?.userId).toBe(cmId);
    expect(await resolveBotUser(tenantId, 'nope')).toBeNull();
  });

  it('BR-P30: guard сервисов действует и через бота — неготовый юнит нельзя вывести на рынок, черновик → FAILED c кодом', async () => {
    await prisma.deal.updateMany({ where: { tenantId, unitId }, data: { stage: 'LOST', lostReason: 'OTHER' } });
    await changeUnitStatus(ctx(['OPERATIONS_MANAGER']), unitId, { readiness: 'RENOVATION' });
    await changeUnitStatus(ctx(['COMMERCIAL_MANAGER'], cmId), unitId, { commercialStatus: 'OFF_MARKET' });
    const d = await createActionDraft(ctx(['COMMERCIAL_MANAGER'], cmId), { text: '1704 освободился, можно выставлять' });
    const r = await confirmActionDraft(ctx(['COMMERCIAL_MANAGER'], cmId), d.id);
    expect(r.status).toBe('FAILED');
    expect(r.error).toBe('NOT_READY_FOR_MARKET');
  });
});
