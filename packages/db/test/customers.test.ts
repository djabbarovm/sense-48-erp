import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PermissionDeniedError, unsafeCreateTenantContext } from '@finance-os/core';
import { prisma } from '../src/client.js';
import { createCustomer, listCustomers, updateCustomer } from '../src/services/customers.js';

let tenantId: string;
const junior = () =>
  unsafeCreateTenantContext({ tenantId, tenantSlug: 'x', userId: crypto.randomUUID(), roles: ['JUNIOR_FINANCE'] });
const acct = () =>
  unsafeCreateTenantContext({ tenantId, tenantSlug: 'x', userId: crypto.randomUUID(), roles: ['ACCOUNTANT'] });

beforeAll(async () => {
  tenantId = (
    await prisma.tenant.create({
      data: { slug: `t-b03-${Date.now()}`, legalName: 'B03', taxId: '300000013' },
    })
  ).id;
});

afterAll(async () => prisma.$disconnect());

describe('B-03 Customer', () => {
  it('create/update c audit, ACCOUNTANT только читает', async () => {
    const c = await createCustomer(junior(), { legalName: 'ООО «Ивент Клиент»', taxId: '312345678', paymentTermsDays: 14 });
    expect(c.paymentTermsDays).toBe(14);
    await expect(createCustomer(acct(), { legalName: 'X' })).rejects.toThrow(PermissionDeniedError);
    await updateCustomer(junior(), c.id, { creditLimitMinor: 100_000_000n });
    expect(await listCustomers(acct())).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { tenantId, objectId: c.id } })).toBe(2);
  });

  it('невалидный ИНН отклоняется', async () => {
    await expect(createCustomer(junior(), { legalName: 'Y', taxId: '12' })).rejects.toThrow(/TAX_ID/);
  });
});
