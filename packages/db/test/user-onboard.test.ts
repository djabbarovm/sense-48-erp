import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unsafeCreateTenantContext, PermissionDeniedError, ValidationError, verifyPassword, type RoleCode } from '@finance-os/core';
import { prisma } from '../src/client.js';
import { createUser } from '../src/services/admin.js';

let tenantId: string; let adminId: string; let uname: string;
const ctx = (roles: RoleCode[], uid = adminId) => unsafeCreateTenantContext({ tenantId, tenantSlug: 'onb', userId: uid, roles });

beforeAll(async () => {
  const ts = Date.now();
  tenantId = (await prisma.tenant.create({ data: { slug: `t-onb-${ts}`, legalName: 'ONB', taxId: '300000901', settings: {} } })).id;
  adminId = (await prisma.user.create({ data: { email: `onb-admin-${ts}@t.test`, fullName: 'Админ' } })).id;
  uname = `umar${ts}`;
  await prisma.userTenantRole.create({ data: { tenantId, userId: adminId, role: 'ADMIN' } });
});
afterAll(async () => prisma.$disconnect());

describe('P-31: создание сотрудника без email (системный логин)', () => {
  it('ADMIN создаёт сотрудника только по логину; пароль хэшируется; роль в тенанте; email null; аудит', async () => {
    const r = await createUser(ctx(['ADMIN']), { fullName: 'Umar Nazarov', username: uname, role: 'CALL_CENTER', tempPassword: 'Ordo2026!' });
    expect([r.username, r.email, r.role]).toEqual([uname, null, 'CALL_CENTER']);
    const u = await prisma.user.findFirstOrThrow({ where: { username: uname } });
    expect(u.email).toBeNull();
    expect(await verifyPassword('Ordo2026!', u.passwordHash!)).toBe(true);
    expect(await prisma.userTenantRole.findFirst({ where: { userId: u.id, tenantId, role: 'CALL_CENTER' } })).not.toBeNull();
    expect(await prisma.auditLog.findFirst({ where: { tenantId, action: 'user.create', objectId: u.id } })).not.toBeNull();
  });
  it('роль без user.manage → PermissionDenied; дубль логина и короткий пароль → ValidationError', async () => {
    await expect(createUser(ctx(['CALL_CENTER']), { fullName: 'X', username: 'x1', role: 'CALL_CENTER', tempPassword: 'Ordo2026!' })).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(createUser(ctx(['ADMIN']), { fullName: 'Dup', username: uname, role: 'CALL_CENTER', tempPassword: 'Ordo2026!' })).rejects.toBeInstanceOf(ValidationError);
    await expect(createUser(ctx(['ADMIN']), { fullName: 'Short', username: 'shorty', role: 'CALL_CENTER', tempPassword: '123' })).rejects.toBeInstanceOf(ValidationError);
    await expect(createUser(ctx(['ADMIN']), { fullName: 'NoLogin', role: 'CALL_CENTER', tempPassword: 'Ordo2026!' })).rejects.toBeInstanceOf(ValidationError);
  });
});
