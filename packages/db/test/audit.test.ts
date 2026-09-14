import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GENESIS_HASH, computeDiffHash, verifyChain } from '@finance-os/core';
import { prisma } from '../src/client.js';
import { verifyAuditChain, withAudit } from '../src/audit.js';

let tenantId: string;

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug: `t-a04-${Date.now()}`, legalName: 'Audit test', taxId: '300000002' },
  });
  tenantId = tenant.id;
});

afterAll(async () => {
  // audit_log append-only — тестовый tenant остаётся, чистим только master data
  await prisma.customer.deleteMany({ where: { tenantId } });
  await prisma.$disconnect();
});

describe('A-04 AuditLog (BR-070/071)', () => {
  it('withAudit пишет мутацию и audit-запись атомарно, цепочка стартует с GENESIS', async () => {
    const customer = await withAudit({ tenantId, userId: undefined, role: 'TEST' }, async (tx) => {
      const created = await tx.customer.create({
        data: { tenantId, legalName: 'ООО Клиент' },
      });
      return {
        result: created,
        audit: {
          action: 'customer.create',
          objectType: 'customer',
          objectId: created.id,
          after: { legalName: created.legalName },
        },
      };
    });
    const records = await prisma.auditLog.findMany({ where: { tenantId }, orderBy: { seq: 'asc' } });
    expect(records).toHaveLength(1);
    expect(records[0]!.prevHash).toBe(GENESIS_HASH);
    expect(records[0]!.action).toBe('customer.create');
    expect(records[0]!.objectId).toBe(customer.id);
  });

  it('вторая запись ссылается на hash первой; verifyAuditChain = valid', async () => {
    await withAudit({ tenantId }, async (tx) => {
      const c = await tx.customer.findFirstOrThrow({ where: { tenantId } });
      const updated = await tx.customer.update({
        where: { id: c.id },
        data: { legalName: 'ООО Клиент 2' },
      });
      return {
        result: updated,
        audit: {
          action: 'customer.update',
          objectType: 'customer',
          objectId: c.id,
          before: { legalName: c.legalName },
          after: { legalName: updated.legalName },
        },
      };
    });
    const records = await prisma.auditLog.findMany({ where: { tenantId }, orderBy: { seq: 'asc' } });
    expect(records).toHaveLength(2);
    expect(records[1]!.prevHash).toBe(records[0]!.diffHash);
    expect(records[1]!.diffHash).toBe(
      computeDiffHash(records[0]!.diffHash, records[1]!.before, records[1]!.after),
    );
    await expect(verifyAuditChain(tenantId)).resolves.toEqual({ valid: true });
  });

  it('ошибка внутри withAudit откатывает и мутацию, и audit (атомарность)', async () => {
    const before = await prisma.auditLog.count({ where: { tenantId } });
    await expect(
      withAudit({ tenantId }, async (tx) => {
        await tx.customer.create({ data: { tenantId, legalName: 'Откат' } });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await prisma.auditLog.count({ where: { tenantId } })).toBe(before);
    expect(await prisma.customer.count({ where: { tenantId, legalName: 'Откат' } })).toBe(0);
  });

  it('пустой список audit-записей отклоняется (BR-070)', async () => {
    await expect(
      withAudit({ tenantId }, async (tx) => {
        await tx.customer.create({ data: { tenantId, legalName: 'Без аудита' } });
        return { result: null, audit: [] };
      }),
    ).rejects.toThrow(/audit entry/);
  });

  it('append-only: UPDATE и DELETE по audit_log отклоняются триггером', async () => {
    await expect(
      prisma.$executeRawUnsafe(`UPDATE audit_log SET action = 'hacked' WHERE tenant_id = '${tenantId}'`),
    ).rejects.toThrow(/append-only/);
    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM audit_log WHERE tenant_id = '${tenantId}'`),
    ).rejects.toThrow(/append-only/);
  });

  it('verifyChain ловит подмену данных', () => {
    const h1 = computeDiffHash(GENESIS_HASH, null, { a: 1 });
    const good = [
      { prevHash: GENESIS_HASH, diffHash: h1, before: null, after: { a: 1 } },
      { prevHash: h1, diffHash: computeDiffHash(h1, { a: 1 }, { a: 2 }), before: { a: 1 }, after: { a: 2 } },
    ];
    expect(verifyChain(good).valid).toBe(true);
    const tampered = [good[0]!, { ...good[1]!, after: { a: 999 } }];
    expect(verifyChain(tampered).valid).toBe(false);
  });

  it('canonical hash не зависит от порядка ключей', () => {
    expect(computeDiffHash(GENESIS_HASH, null, { a: 1, b: { c: 2, d: 3 } })).toBe(
      computeDiffHash(GENESIS_HASH, null, { b: { d: 3, c: 2 }, a: 1 }),
    );
  });
});
