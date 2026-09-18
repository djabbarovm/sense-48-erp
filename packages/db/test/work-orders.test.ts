import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotFoundError, PermissionDeniedError, unsafeCreateTenantContext, type RoleCode } from '@finance-os/core';
import { LocalFsStorage } from '@finance-os/adapters';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prisma } from '../src/client.js';
import { createWorkOrder, escalateOverdueWorkOrders, getWorkOrder, listWorkOrders, transitionWorkOrder } from '../src/services/workOrders.js';
import { createBuilding, createFloor, createUnit, changeUnitStatus, getUnitCard } from '../src/services/property.js';
import { uploadDocument } from '../src/services/documents.js';

let tenantId: string;
let opsId: string;
let ops2Id: string;
let unitId: string;
const ctx = (roles: RoleCode[], userId?: string) => unsafeCreateTenantContext({ tenantId, tenantSlug: 'wo', userId: userId ?? crypto.randomUUID(), roles });

beforeAll(async () => {
  const ts = Date.now();
  tenantId = (await prisma.tenant.create({ data: { slug: `t-wo-${ts}`, legalName: 'WO', taxId: '300000061' } })).id;
  opsId = (await prisma.user.create({ data: { email: `ops1-${ts}@t.test`, fullName: 'Шерзод' } })).id;
  ops2Id = (await prisma.user.create({ data: { email: `ops2-${ts}@t.test`, fullName: 'Рустам' } })).id;
  await prisma.userTenantRole.createMany({ data: [{ tenantId, userId: opsId, role: 'OPERATIONS_MANAGER' }, { tenantId, userId: ops2Id, role: 'OPERATIONS_MANAGER' }] });
  const b = await createBuilding(ctx(['ADMIN']), { code: 'TOWER', name: 'Tower', kind: 'TOWER' });
  const f = await createFloor(ctx(['ADMIN']), { buildingId: b.id, floorNo: 28 });
  unitId = (await createUnit(ctx(['COMMERCIAL_MANAGER']), { floorId: f.id, unitNo: '2804', type: 'APARTMENT', areaM2: 70 })).id;
});
afterAll(async () => prisma.$disconnect());

describe('Wave 4 — заявки (BR-P31/P32)', () => {
  let woId: string;
  it('брокер создаёт заявку (без исполнителя), SLA по приоритету, юнит → ISSUE; ручная смена статуса заблокирована', async () => {
    const now = new Date('2026-09-18T10:00:00Z');
    const wo = await createWorkOrder(ctx(['BROKER']), { unitId, category: 'PLUMBING', priority: 'HIGH', title: 'Жалоба на ванную', assigneeId: opsId }, now);
    woId = wo.id;
    expect(wo.number).toMatch(/^WO-\d{4}-\d{6}$/);
    expect(wo.status).toBe('OPEN'); // брокер не назначает исполнителя
    expect(wo.assigneeId).toBeNull();
    expect(wo.slaDueAt.toISOString()).toBe('2026-09-19T10:00:00.000Z');
    expect((await getUnitCard(ctx(['OWNER']), unitId)).unit.operationalStatus).toBe('ISSUE');
    await expect(changeUnitStatus(ctx(['OPERATIONS_MANAGER'], opsId), unitId, { operationalStatus: 'NORMAL' })).rejects.toThrow(/WORKORDER_IS_SOURCE/);
    await expect(createWorkOrder(ctx(['ACCOUNTANT']), { unitId, category: 'OTHER', title: 'x' })).rejects.toThrow(PermissionDeniedError);
    await expect(createWorkOrder(ctx(['BROKER']), { category: 'OTHER', title: 'x' })).rejects.toThrow(/LOCATION_REQUIRED/);
  });

  it('assign → start → done; verify требует фото и другого человека (BR-P32); VERIFIED → юнит NORMAL', async () => {
    await expect(transitionWorkOrder(ctx(['BROKER']), woId, 'start')).rejects.toThrow(PermissionDeniedError);
    await expect(transitionWorkOrder(ctx(['OPERATIONS_MANAGER'], opsId), woId, 'assign', {})).rejects.toThrow(/ASSIGNEE_REQUIRED/);
    await transitionWorkOrder(ctx(['OPERATIONS_MANAGER'], opsId), woId, 'assign', { assigneeId: opsId, contractorName: 'Сантех-Сервис' });
    await transitionWorkOrder(ctx(['OPERATIONS_MANAGER'], opsId), woId, 'start');
    const done = await transitionWorkOrder(ctx(['OPERATIONS_MANAGER'], opsId), woId, 'done');
    expect(done.status).toBe('DONE');
    expect((await getUnitCard(ctx(['OWNER']), unitId)).unit.operationalStatus).toBe('NORMAL'); // DONE не считается открытой проблемой
    await expect(transitionWorkOrder(ctx(['OPERATIONS_MANAGER'], ops2Id), woId, 'verify')).rejects.toThrow(/PROOF_REQUIRED/);
    const storage = new LocalFsStorage(mkdtempSync(join(tmpdir(), 'wo-')));
    await uploadDocument(ctx(['OPERATIONS_MANAGER'], opsId), storage, { objectType: 'work_order', objectId: woId, docType: 'OTHER', fileName: 'proof.jpg', mime: 'image/jpeg', body: Buffer.from('jpeg-bytes') });
    await expect(transitionWorkOrder(ctx(['OPERATIONS_MANAGER'], opsId), woId, 'verify')).rejects.toThrow(/QA_SELF_VERIFY/);
    const verified = await transitionWorkOrder(ctx(['COMMERCIAL_MANAGER']), woId, 'verify');
    expect(verified.status).toBe('VERIFIED');
    expect(verified.verifiedAt).not.toBeNull();
    const card = await getWorkOrder(ctx(['OPERATIONS_MANAGER'], ops2Id), woId);
    expect(card.proofs).toHaveLength(1);
    expect(card.triggers).toEqual(['reopen']);
    const actions = (await prisma.auditLog.findMany({ where: { tenantId, objectType: 'work_order', objectId: woId }, select: { action: true } })).map((a) => a.action);
    expect(actions).toEqual(['work_order.create', 'work_order.assign', 'work_order.start', 'work_order.done', 'work_order.verify']);
  });

  it('CRITICAL → юнит CRITICAL; просрочка SLA → Task WORKORDER_OVERDUE (дедуп) и событие; cancel c причиной; 404 чужой tenant', async () => {
    const now = new Date('2026-09-18T10:00:00Z');
    const crit = await createWorkOrder(ctx(['OPERATIONS_MANAGER'], opsId), { unitId, category: 'ELECTRICAL', priority: 'CRITICAL', title: 'Нет света', assigneeId: ops2Id }, now);
    expect(crit.status).toBe('ASSIGNED');
    expect((await getUnitCard(ctx(['OWNER']), unitId)).unit.operationalStatus).toBe('CRITICAL');
    expect(await escalateOverdueWorkOrders(tenantId, new Date('2026-09-18T15:00:00Z'))).toBe(1);
    expect(await escalateOverdueWorkOrders(tenantId, new Date('2026-09-18T16:00:00Z'))).toBe(0);
    const task = await prisma.task.findFirst({ where: { tenantId, type: 'WORKORDER_OVERDUE', objectId: crit.id } });
    expect(task?.ownerId).toBe(ops2Id);
    const overdue = await listWorkOrders(ctx(['OWNER']), { overdueOnly: true }, new Date('2026-09-18T15:00:00Z'));
    expect(overdue.map((w) => w.id)).toEqual([crit.id]);
    await expect(transitionWorkOrder(ctx(['OPERATIONS_MANAGER'], opsId), crit.id, 'cancel')).rejects.toThrow(/REASON_REQUIRED/);
    await transitionWorkOrder(ctx(['OPERATIONS_MANAGER'], opsId), crit.id, 'cancel', { reason: 'дубликат' });
    expect((await getUnitCard(ctx(['OWNER']), unitId)).unit.operationalStatus).toBe('NORMAL');
    const other = (await prisma.tenant.create({ data: { slug: `t-woo-${Date.now()}`, legalName: 'O', taxId: '300000062' } })).id;
    await expect(getWorkOrder(unsafeCreateTenantContext({ tenantId: other, tenantSlug: 'o', userId: 'u', roles: ['OWNER'] }), crit.id)).rejects.toThrow(NotFoundError);
    expect((await prisma.domainEvent.findMany({ where: { tenantId, type: { startsWith: 'work_order.' } } })).length).toBeGreaterThanOrEqual(6);
  });
});
