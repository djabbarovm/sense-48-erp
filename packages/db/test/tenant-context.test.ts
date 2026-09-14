import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotFoundError, signSessionJwt, verifySessionJwt, hashPassword, verifyPassword } from '@finance-os/core';
import { prisma } from '../src/client.js';
import { buildTenantContext, listUserTenants } from '../src/context.js';
import { findScopedOr404, whereTenant } from '../src/repository.js';

let tenantA: { id: string; slug: string };
let tenantB: { id: string; slug: string };
let userAB: string; // роли в A и B
let userA: string; // роль только в A
let customerB: string; // объект tenant B

beforeAll(async () => {
  const ts = Date.now();
  tenantA = await prisma.tenant.create({
    data: { slug: `t-a05-a-${ts}`, legalName: 'A', taxId: '300000003' },
  });
  tenantB = await prisma.tenant.create({
    data: { slug: `t-a05-b-${ts}`, legalName: 'B', taxId: '300000004' },
  });
  const u1 = await prisma.user.create({
    data: { email: `ab-${ts}@test.local`, fullName: 'AB' },
  });
  const u2 = await prisma.user.create({
    data: { email: `a-${ts}@test.local`, fullName: 'A only' },
  });
  userAB = u1.id;
  userA = u2.id;
  await prisma.userTenantRole.createMany({
    data: [
      { userId: userAB, tenantId: tenantA.id, role: 'JUNIOR_FINANCE' },
      { userId: userAB, tenantId: tenantB.id, role: 'JUNIOR_FINANCE' },
      { userId: userA, tenantId: tenantA.id, role: 'REQUESTER' },
    ],
  });
  const c = await prisma.customer.create({ data: { tenantId: tenantB.id, legalName: 'Клиент B' } });
  customerB = c.id;
});

afterAll(async () => {
  await prisma.customer.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
  await prisma.userTenantRole.deleteMany({ where: { userId: { in: [userAB, userA] } } });
  await prisma.user.deleteMany({ where: { id: { in: [userAB, userA] } } });
  await prisma.$disconnect();
});

describe('A-05 TenantContext (BR-073, docs/05)', () => {
  it('строит контекст из UserTenantRole', async () => {
    const ctx = await buildTenantContext(userAB, tenantA.slug);
    expect(ctx.tenantId).toBe(tenantA.id);
    expect(ctx.roles).toContain('JUNIOR_FINANCE');
  });

  it('пользователь без роли в tenant получает 404 (не 403)', async () => {
    await expect(buildTenantContext(userA, tenantB.slug)).rejects.toThrow(NotFoundError);
  });

  it('несуществующий tenant → 404', async () => {
    await expect(buildTenantContext(userAB, 'no-such-tenant')).rejects.toThrow(NotFoundError);
  });

  it('cross-tenant: объект tenant B под контекстом A → 404', async () => {
    const ctxA = await buildTenantContext(userAB, tenantA.slug);
    await expect(findScopedOr404(prisma.customer, ctxA, customerB)).rejects.toThrow(NotFoundError);
    // под контекстом B — находится
    const ctxB = await buildTenantContext(userAB, tenantB.slug);
    await expect(findScopedOr404(prisma.customer, ctxB, customerB)).resolves.toMatchObject({
      id: customerB,
    });
  });

  it('whereTenant всегда добавляет tenant_id из контекста', async () => {
    const ctxA = await buildTenantContext(userAB, tenantA.slug);
    const rows = await prisma.customer.findMany({ where: whereTenant(ctxA) });
    expect(rows.every((r) => r.tenantId === tenantA.id)).toBe(true);
  });

  it('listUserTenants агрегирует роли по tenant', async () => {
    const tenants = await listUserTenants(userAB);
    const slugs = tenants.map((t) => t.slug);
    expect(slugs).toContain(tenantA.slug);
    expect(slugs).toContain(tenantB.slug);
  });
});

describe('A-05 dev auth (ADR-002)', () => {
  it('JWT roundtrip и отказ при подмене', () => {
    const token = signSessionJwt({ sub: 'u1', email: 'x@y.z' }, 'secret1');
    expect(verifySessionJwt(token, 'secret1')).toMatchObject({ sub: 'u1', email: 'x@y.z' });
    expect(verifySessionJwt(token, 'other-secret')).toBeNull();
    expect(verifySessionJwt(token.slice(0, -2) + 'xx', 'secret1')).toBeNull();
  });

  it('истёкший JWT отклоняется', () => {
    const token = signSessionJwt({ sub: 'u1', email: 'x@y.z' }, 's', -10);
    expect(verifySessionJwt(token, 's')).toBeNull();
  });

  it('scrypt пароль: verify true/false', async () => {
    const hash = await hashPassword('Passw0rd!');
    expect(await verifyPassword('Passw0rd!', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });
});
