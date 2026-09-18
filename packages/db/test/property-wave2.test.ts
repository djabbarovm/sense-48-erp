import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotFoundError, PermissionDeniedError, unsafeCreateTenantContext, type RoleCode } from '@finance-os/core';
import { MockNotificationAdapter } from '@finance-os/adapters';
import { prisma } from '../src/client.js';
import { createBuilding, createFloor, createUnit, changeUnitStatus, getUnitCard } from '../src/services/property.js';
import { activateLease, createLease, listLeases, markExpiringLeases, terminateLease } from '../src/services/leases.js';
import { addDealActivity, createDeal, createDealFollowupTasks, getDeal, getPipelineSummary, listDeals, moveDeal, updateDeal } from '../src/services/deals.js';
import { deliverDomainEvents, listDomainEventsSince } from '../src/services/domainEvents.js';
import { createApiKey, listApiKeys, revokeApiKey, verifyApiKey } from '../src/services/apiKeys.js';
import { listPublicInventory } from '../src/services/publicInventory.js';

let tenantId: string;
let otherTenantId: string;
let cmId: string;
let brokerId: string;
let unitA: string;
let unitB: string;
const ctx = (roles: RoleCode[], userId?: string) => unsafeCreateTenantContext({ tenantId, tenantSlug: 'w2', userId: userId ?? crypto.randomUUID(), roles });
const cm = () => ctx(['COMMERCIAL_MANAGER'], cmId);
const broker = () => ctx(['BROKER'], brokerId);
const other = () => unsafeCreateTenantContext({ tenantId: otherTenantId, tenantSlug: 'o', userId: crypto.randomUUID(), roles: ['OWNER'] });

beforeAll(async () => {
  const ts = Date.now();
  tenantId = (await prisma.tenant.create({ data: { slug: `t-w2-${ts}`, legalName: 'W2', taxId: '300000031' } })).id;
  otherTenantId = (await prisma.tenant.create({ data: { slug: `t-w2o-${ts}`, legalName: 'W2O', taxId: '300000032' } })).id;
  cmId = (await prisma.user.create({ data: { email: `cm-${ts}@t.test`, fullName: 'Алия Сафарова' } })).id;
  brokerId = (await prisma.user.create({ data: { email: `br-${ts}@t.test`, fullName: 'Бекзод Тураев' } })).id;
  await prisma.userTenantRole.createMany({ data: [{ tenantId, userId: cmId, role: 'COMMERCIAL_MANAGER' }, { tenantId, userId: brokerId, role: 'BROKER' }] });
  const b = await createBuilding(ctx(['ADMIN']), { code: 'TOWER', name: 'Tower', kind: 'TOWER' });
  const f = await createFloor(ctx(['ADMIN']), { buildingId: b.id, floorNo: 5 });
  unitA = (await createUnit(cm(), { floorId: f.id, unitNo: '501', type: 'APARTMENT', areaM2: 80, askingRateMinor: 150_000n })).id;
  unitB = (await createUnit(cm(), { floorId: f.id, unitNo: '502', type: 'APARTMENT', areaM2: 90, askingRateMinor: 170_000n })).id;
  await changeUnitStatus(cm(), unitA, { commercialStatus: 'AVAILABLE' });
  await changeUnitStatus(cm(), unitB, { commercialStatus: 'AVAILABLE' });
});
afterAll(async () => prisma.$disconnect());

describe('Wave 2 — сделки (BR-P20/P21/P22/P23)', () => {
  let dealId: string;
  it('брокер создаёт сделку на себя; c юнитом стартует c PROPERTY_SELECTED; юнит → VIEWING при advance (BR-P20)', async () => {
    const d = await createDeal(broker(), { contactName: 'Рустам Каримов', contactPhone: '+998901112233', source: 'TELEGRAM', unitId: unitA, expectedRateMinor: 140_000n, managerId: cmId });
    dealId = d.id;
    expect(d.number).toMatch(/^DEAL-\d{4}-\d{6}$/);
    expect(d.managerId).toBe(brokerId); // брокер не может назначить другого
    expect(d.stage).toBe('PROPERTY_SELECTED');
    expect((await getUnitCard(cm(), unitA)).unit.commercialStatus).toBe('AVAILABLE');
    await moveDeal(broker(), dealId, 'advance'); // → VIEWING
    expect((await getUnitCard(cm(), unitA)).unit.commercialStatus).toBe('VIEWING');
    expect((await getUnitCard(cm(), unitA)).unit.view.overlay).toBeNull();
    await updateDeal(broker(), dealId, { reservedUntil: new Date(Date.now() + 5 * 86_400_000) });
    expect((await getUnitCard(cm(), unitA)).unit.commercialStatus).toBe('RESERVED');
  });

  it('ручная смена стадии юнита при активной сделке запрещена (DEAL_IS_SOURCE)', async () => {
    await expect(changeUnitStatus(cm(), unitA, { commercialStatus: 'OFF_MARKET' })).rejects.toThrow(/DEAL_IS_SOURCE/);
  });

  it('BR-P21: брокер видит только свои сделки, чужую — 404; контакты по праву', async () => {
    const cmDeal = await createDeal(cm(), { contactName: 'Дилноза Юсупова', contactPhone: '+998900000000', unitId: unitB });
    expect((await listDeals(broker())).map((d) => d.id)).toEqual([dealId]);
    expect((await listDeals(cm())).length).toBe(2);
    await expect(getDeal(broker(), cmDeal.id)).rejects.toThrow(NotFoundError);
    await expect(moveDeal(broker(), cmDeal.id, 'advance')).rejects.toThrow(NotFoundError);
    const marketing = await listDeals(ctx(['MARKETING']));
    expect(marketing.find((d) => d.id === dealId)?.contactName).toBe('Рустам К.');
    expect(marketing.find((d) => d.id === dealId)?.contactPhone).toBeNull();
    await expect(listDeals(ctx(['OPERATIONS_MANAGER']))).rejects.toThrow(PermissionDeniedError);
    await expect(getDeal(other(), dealId)).rejects.toThrow(NotFoundError);
  });

  it('BR-P11: брокер не выше LOI; lose требует причину; воронка и сводка', async () => {
    await moveDeal(broker(), dealId, 'advance'); // OFFER
    await moveDeal(broker(), dealId, 'advance'); // NEGOTIATION
    await moveDeal(broker(), dealId, 'advance'); // LOI
    expect((await getUnitCard(cm(), unitA)).unit.commercialStatus).toBe('LOI');
    await expect(moveDeal(broker(), dealId, 'advance')).rejects.toThrow(/BROKER_STAGE_LIMIT/);
    await moveDeal(cm(), dealId, 'advance'); // CONTRACT — коммерческий менеджер
    expect((await getUnitCard(cm(), unitA)).unit.commercialStatus).toBe('CONTRACTED');
    await expect(moveDeal(cm(), dealId, 'lose')).rejects.toThrow(/LOST_REASON_REQUIRED/);
    const summary = await getPipelineSummary(cm());
    expect(summary.totals.active).toBe(2);
    expect(summary.totals.potentialMinor).toBe(140_000n);
    expect(summary.totals.expectedMinor).toBe(126_000n); // CONTRACT 90%
    expect(summary.totals.confirmedMinor).toBe(0n); // депозита нет
    await updateDeal(cm(), dealId, { depositReceived: true });
    expect((await getPipelineSummary(cm())).totals.confirmedMinor).toBe(140_000n);
  });

  it('BR-P22: follow-up активности → следующее действие; просрочка → Task DEAL_FOLLOWUP менеджеру', async () => {
    await addDealActivity(broker(), dealId, { kind: 'CALL', note: 'Клиент просит скидку 5%', followUpAt: new Date('2026-09-01') });
    const d = await getDeal(broker(), dealId);
    expect(d.deal.nextActionAt).not.toBeNull();
    expect(d.attention).toContain('NEXT_ACTION_OVERDUE');
    expect((await listDeals(cm(), { attentionOnly: true })).some((x) => x.id === dealId)).toBe(true);
    expect(await createDealFollowupTasks(tenantId, new Date('2026-09-18'))).toBe(1);
    expect(await createDealFollowupTasks(tenantId, new Date('2026-09-18'))).toBe(0); // дедуп
    const task = await prisma.task.findFirst({ where: { tenantId, type: 'DEAL_FOLLOWUP', objectId: dealId } });
    expect(task?.ownerId).toBe(brokerId);
  });

  it('BR-P23: WON только через активацию договора; договор — источник истины юнита (LEASE_IS_SOURCE); 403/404', async () => {
    await expect(createLease(broker(), { unitId: unitA, type: 'LTR', occupantName: 'x', startAt: new Date('2026-10-01'), rentMinor: 1n })).rejects.toThrow(PermissionDeniedError);
    const lease = await createLease(cm(), { unitId: unitA, type: 'LTR', occupantName: 'Рустам Каримов', occupantContact: '+998901112233', startAt: new Date('2026-10-01'), endAt: new Date('2027-09-30'), rentMinor: 140_000n, depositMinor: 140_000n, depositReceived: true, dealId });
    expect(lease.status).toBe('DRAFT');
    await expect(activateLease(other(), lease.id)).rejects.toThrow(NotFoundError);
    const active = await activateLease(cm(), lease.id);
    expect(active.status).toBe('ACTIVE');
    const card = await getUnitCard(cm(), unitA);
    expect(card.unit).toMatchObject({ occupancy: 'OCCUPIED', rentalMode: 'LTR', leaseStatus: 'ACTIVE', occupantName: 'Рустам Каримов', commercialStatus: 'CONTRACTED', monthlyRentMinor: 140_000n });
    expect(card.unit.view.color).toBe('GREEN');
    expect(card.unit.view.alerts).toEqual([]);
    const deal = await getDeal(cm(), dealId);
    expect(deal.deal.stage).toBe('WON');
    expect(deal.deal.wonLeaseId).toBe(lease.id);
    // второй договор на тот же юнит — отказ
    const dup = await createLease(cm(), { unitId: unitA, type: 'STR', occupantName: 'Гость', startAt: new Date('2026-11-01'), rentMinor: 1n });
    await expect(activateLease(cm(), dup.id)).rejects.toThrow(/LEASE_ALREADY_ACTIVE/);
    // ручная смена занятости запрещена
    await expect(changeUnitStatus(cm(), unitA, { occupancy: 'VACANT' })).rejects.toThrow(/LEASE_IS_SOURCE/);
    // готовность менять можно (не поле договора)
    await changeUnitStatus(ctx(['OPERATIONS_MANAGER']), unitA, { operationalStatus: 'ISSUE' });
    // PII арендатора — только c правом
    expect((await listLeases(ctx(['OPERATIONS_MANAGER'])))[0]?.occupantContact).toBeNull();
    expect((await listLeases(cm(), { unitId: unitA, status: ['ACTIVE'] }))[0]?.occupantContact).toBe('+998901112233');
    await expect(listLeases(broker())).rejects.toThrow(PermissionDeniedError);
    const leaseAudit = await prisma.auditLog.findMany({ where: { tenantId, objectType: 'lease_contract', objectId: lease.id } });
    expect(JSON.stringify(leaseAudit.map((a) => a.after))).not.toContain('998901112233');
  });

  it('джоб lease-expiry: EXPIRING + Task; расторжение → юнит VACANT c vacantSince и AVAILABLE', async () => {
    const lease = (await listLeases(cm(), { unitId: unitA, status: ['ACTIVE'] }))[0]!;
    expect(await markExpiringLeases(tenantId, new Date('2027-09-15'))).toBe(1);
    expect(await markExpiringLeases(tenantId, new Date('2027-09-15'))).toBe(0);
    expect((await getUnitCard(cm(), unitA)).unit.leaseStatus).toBe('EXPIRING');
    expect(await prisma.task.count({ where: { tenantId, type: 'LEASE_EXPIRY', objectId: lease.id } })).toBe(1);
    await expect(terminateLease(cm(), lease.id, '')).rejects.toThrow(/TERMINATE_REASON_REQUIRED/);
    await terminateLease(cm(), lease.id, 'Выезд по окончании срока');
    const card = await getUnitCard(cm(), unitA);
    expect(card.unit).toMatchObject({ occupancy: 'VACANT', rentalMode: 'NONE', leaseStatus: 'TERMINATED', occupantName: null, commercialStatus: 'AVAILABLE' });
    expect(card.unit.vacantSince).not.toBeNull();
    expect(card.unit.view.color).toBe('RED');
  });

  it('outbox: события без PII доставляются один раз OWNER/COMMERCIAL_MANAGER', async () => {
    const pending = await prisma.domainEvent.count({ where: { tenantId, deliveredAt: null } });
    expect(pending).toBeGreaterThan(3);
    const types = new Set((await prisma.domainEvent.findMany({ where: { tenantId }, select: { type: true } })).map((e) => e.type));
    expect([...types]).toEqual(expect.arrayContaining(['unit.status.changed', 'deal.stage.changed', 'lease.activated', 'lease.expiring', 'lease.terminated']));
    expect(JSON.stringify(await prisma.domainEvent.findMany({ where: { tenantId }, select: { payload: true } }))).not.toContain('998901112233');
    // P-13: курсор для SSE — только события после метки, фильтр по типам
    const since = new Date(Date.now() - 60_000);
    const recent = await listDomainEventsSince(tenantId, since, ['lease.activated']);
    expect(recent.length).toBe(1);
    expect(await listDomainEventsSince(tenantId, new Date())).toEqual([]);
    const notifier = new MockNotificationAdapter();
    const delivered = await deliverDomainEvents(tenantId, new Date(), notifier);
    expect(delivered).toBe(pending);
    expect(notifier.sent.length).toBe(pending); // один получатель c ролью COMMERCIAL_MANAGER
    expect(notifier.sent[0]?.userId).toBe(cmId);
    expect(await deliverDomainEvents(tenantId, new Date(), notifier)).toBe(0);
  });
});

describe('Wave 2 — API-ключи и публичный inventory', () => {
  it('ключ показывается один раз, хранится хэш, scope и отзыв проверяются; inventory без PII и только sellable', async () => {
    await expect(createApiKey(cm(), { name: 'site', scopes: ['PUBLIC_INVENTORY'] })).rejects.toThrow(PermissionDeniedError);
    const key = await createApiKey(ctx(['ADMIN']), { name: 'piramit.uz', scopes: ['PUBLIC_INVENTORY'] });
    expect(key.plaintext).toMatch(/^mds_/);
    const rows = await listApiKeys(ctx(['OWNER']));
    expect(rows[0]?.prefix).toBe(key.plaintext.slice(0, 12));
    expect(JSON.stringify(rows)).not.toContain(key.plaintext);
    expect(await verifyApiKey('mds_nope', 'PUBLIC_INVENTORY')).toBeNull();
    const ok = await verifyApiKey(key.plaintext, 'PUBLIC_INVENTORY');
    expect(ok?.tenantId).toBe(tenantId);

    const { setUnitPublished } = await import('../src/services/property.js');
    await setUnitPublished(cm(), unitA, true);
    const inv = await listPublicInventory(tenantId);
    expect(inv.map((u) => u.unitNo)).toEqual(['501']);
    expect(JSON.stringify(inv)).not.toMatch(/Каримов|owner|occupant/i);
    expect(inv[0]?.askingRateMinor).toBe('150000');

    await revokeApiKey(ctx(['ADMIN']), key.id);
    expect(await verifyApiKey(key.plaintext, 'PUBLIC_INVENTORY')).toBeNull();
    expect(await listPublicInventory(otherTenantId)).toEqual([]);
  });
});
