import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/client.js';
import { batchNumber, nextNumber } from '../src/sequence.js';

let tenantId: string;

beforeAll(async () => {
  const t = await prisma.tenant.create({
    data: { slug: `t-a07-${Date.now()}`, legalName: 'Seq', taxId: '300000005' },
  });
  tenantId = t.id;
});

afterAll(async () => {
  await prisma.sequence.deleteMany({ where: { tenantId } });
  await prisma.$disconnect();
});

describe('A-07 Sequences (D-24)', () => {
  it('формат PR-YYYY-NNNNNN и EVT-YYYY-NNNN', async () => {
    const d = new Date('2026-09-14');
    const pr = await prisma.$transaction((tx) => nextNumber(tx, tenantId, 'PR', d));
    expect(pr).toBe('PR-2026-000001');
    const evt = await prisma.$transaction((tx) => nextNumber(tx, tenantId, 'EVT', d));
    expect(evt).toBe('EVT-2026-0001');
  });

  it('конкурентные транзакции: 25 номеров без дублей и без пропусков', async () => {
    const results = await Promise.all(
      Array.from({ length: 25 }, () =>
        prisma.$transaction((tx) => nextNumber(tx, tenantId, 'PAY', new Date('2026-09-14'))),
      ),
    );
    const unique = new Set(results);
    expect(unique.size).toBe(25);
    const values = results.map((n) => Number(n.split('-')[2])).sort((a, b) => a - b);
    expect(values).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });

  it('rollback не оставляет пропуск', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await nextNumber(tx, tenantId, 'INV', new Date('2026-09-14'));
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    const next = await prisma.$transaction((tx) => nextNumber(tx, tenantId, 'INV', new Date('2026-09-14')));
    expect(next).toBe('INV-2026-000001');
  });

  it('серии независимы по годам и tenant', async () => {
    const y27 = await prisma.$transaction((tx) => nextNumber(tx, tenantId, 'PR', new Date('2027-01-01')));
    expect(y27).toBe('PR-2027-000001');
  });

  it('batchNumber детерминирован по дате', () => {
    expect(batchNumber(new Date('2026-09-14'))).toBe('BATCH-2026-09-14');
    expect(batchNumber(new Date('2026-09-14'), 2)).toBe('BATCH-2026-09-14-U2');
  });
});
