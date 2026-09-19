import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotFoundError, PermissionDeniedError, unsafeCreateTenantContext } from '@finance-os/core';
import { prisma } from '../src/client.js';
import {
  grantRole,
  listTenantUsers,
  revokeRole,
  updateTenantSettings,
  upsertCategory,
  upsertCostCenter,
} from '../src/services/admin.js';

let tenantId: string;
let otherTenantId: string;
let adminId: string;
let juniorId: string;

const adminCtx = () =>
  unsafeCreateTenantContext({ tenantId, tenantSlug: 's', userId: adminId, roles: ['ADMIN'] });
const juniorCtx = () =>
  unsafeCreateTenantContext({ tenantId, tenantSlug: 's', userId: juniorId, roles: ['JUNIOR_FINANCE'] });

beforeAll(async () => {
  const ts = Date.now();
  tenantId = (
    await prisma.tenant.create({ data: { slug: `t-a12-${ts}`, legalName: 'T', taxId: '300000006' } })
  ).id;
  otherTenantId = (
    await prisma.tenant.create({ data: { slug: `t-a12b-${ts}`, legalName: 'T2', taxId: '300000007' } })
  ).id;
  adminId = (await prisma.user.create({ data: { email: `adm-${ts}@t.local`, fullName: 'Adm' } })).id;
  juniorId = (await prisma.user.create({ data: { email: `jun-${ts}@t.local`, fullName: 'Jun' } })).id;
  await prisma.userTenantRole.create({ data: { userId: adminId, tenantId, role: 'ADMIN' } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('A-12 admin service', () => {
  it('без права — 403 PERMISSION_DENIED', async () => {
    await expect(updateTenantSettings(juniorCtx(), { legalName: 'X' })).rejects.toThrow(PermissionDeniedError);
    await expect(upsertCostCenter(juniorCtx(), { code: 'X', name: 'X' })).rejects.toThrow(PermissionDeniedError);
    await expect(upsertCategory(juniorCtx(), { code: 'X', name: 'X', group: 'OTHER' })).rejects.toThrow(
      PermissionDeniedError,
    );
  });

  it('tenant settings обновляются с audit-записью', async () => {
    const updated = await updateTenantSettings(adminCtx(), { vatRateBp: 1500, cutoffTime: '13:30' });
    expect(updated.vatRateBp).toBe(1500);
    expect((updated.settings as Record<string, unknown>).cutoff_time).toBe('13:30');
    const audit = await prisma.auditLog.findFirst({
      where: { tenantId, action: 'tenant.settings.update' },
    });
    expect(audit).not.toBeNull();
    expect(audit!.actorId).toBe(adminId);
  });

  it('grant/revoke роли с audit; список пользователей агрегирует роли', async () => {
    const jun = await prisma.user.findUniqueOrThrow({ where: { id: juniorId } });
    await grantRole(adminCtx(), jun.email!, 'JUNIOR_FINANCE');
    await grantRole(adminCtx(), jun.email!, 'REQUESTER');
    let users = await listTenantUsers(adminCtx());
    const entry = users.find((u) => u.user.id === juniorId);
    expect(entry?.roles.sort()).toEqual(['JUNIOR_FINANCE', 'REQUESTER']);
    await revokeRole(adminCtx(), juniorId, 'REQUESTER');
    users = await listTenantUsers(adminCtx());
    expect(users.find((u) => u.user.id === juniorId)?.roles).toEqual(['JUNIOR_FINANCE']);
    expect(
      await prisma.auditLog.count({ where: { tenantId, action: { in: ['user.role.grant', 'user.role.revoke'] } } }),
    ).toBe(3);
  });

  it('cost center и category: create/update, cross-tenant update → 404', async () => {
    const cc = await upsertCostCenter(adminCtx(), { code: 'CC1', name: 'Центр' });
    const cat = await upsertCategory(adminCtx(), { code: 'CAT1', name: 'Категория', group: 'OTHER' });
    // объект другого tenant
    const foreign = await prisma.costCenter.create({
      data: { tenantId: otherTenantId, code: 'F', name: 'F' },
    });
    await expect(
      upsertCostCenter(adminCtx(), { id: foreign.id, code: 'F2', name: 'F2' }),
    ).rejects.toThrow(NotFoundError);
    const ccUpd = await upsertCostCenter(adminCtx(), { id: cc.id, code: 'CC1', name: 'Центр 2', isActive: false });
    expect(ccUpd.isActive).toBe(false);
    const catUpd = await upsertCategory(adminCtx(), {
      id: cat.id,
      code: 'CAT1',
      name: 'Категория 2',
      group: 'ADMIN',
      closingDocSlaDays: 7,
    });
    expect(catUpd.closingDocSlaDays).toBe(7);
  });
});
