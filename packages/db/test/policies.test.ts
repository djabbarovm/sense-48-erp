import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unsafeCreateTenantContext } from '@finance-os/core';
import { prisma } from '../src/client.js';
import { createPolicyVersion, getActivePolicy } from '../src/services/policies.js';

let tenantId: string;
const adminOwner = () =>
  unsafeCreateTenantContext({ tenantId, tenantSlug: 'x', userId: crypto.randomUUID(), roles: ['ADMIN'] });

beforeAll(async () => {
  tenantId = (
    await prisma.tenant.create({ data: { slug: `t-b05-${Date.now()}`, legalName: 'B05', taxId: '300000015' } })
  ).id;
});

afterAll(async () => prisma.$disconnect());

describe('B-05 ApprovalPolicy storage', () => {
  it('без настроек возвращает дефолты D-12', async () => {
    const p = await getActivePolicy(tenantId);
    expect(p.tier1MaxMinor).toBe(500_000_000n);
    expect(p.tier2MaxMinor).toBe(2_500_000_000n);
  });

  it('версионирование: новая версия действует c effectiveFrom, старая — до неё (BR-041)', async () => {
    await createPolicyVersion(adminOwner(), {
      tier1MaxMinor: 300_000_000n,
      tier2MaxMinor: 1_000_000_000n,
      effectiveFrom: new Date('2026-01-01'),
    });
    await createPolicyVersion(adminOwner(), {
      tier1MaxMinor: 700_000_000n,
      tier2MaxMinor: 3_000_000_000n,
      effectiveFrom: new Date('2026-09-01'),
    });
    const early = await getActivePolicy(tenantId, new Date('2026-05-01'));
    expect(early.tier1MaxMinor).toBe(300_000_000n);
    const later = await getActivePolicy(tenantId, new Date('2026-09-14'));
    expect(later.tier1MaxMinor).toBe(700_000_000n);
  });

  it('невалидные пороги отклоняются', async () => {
    await expect(
      createPolicyVersion(adminOwner(), { tier1MaxMinor: 100n, tier2MaxMinor: 100n }),
    ).rejects.toThrow(/tier2/);
  });
});
