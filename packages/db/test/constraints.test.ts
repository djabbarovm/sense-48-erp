import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/client.js';

// A-03 DoD: unique/check constraints из docs/02 §8 действуют на уровне БД.

let tenantId: string;

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug: `t-a03-${Date.now()}`, legalName: 'Test A03', taxId: '300000001' },
  });
  tenantId = tenant.id;
});

afterAll(async () => {
  await prisma.contract.deleteMany({ where: { tenantId } });
  await prisma.vendorBankAccount.deleteMany({ where: { tenantId } });
  await prisma.vendor.deleteMany({ where: { tenantId } });
  await prisma.customer.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe('A-03 DB constraints (docs/02 §8)', () => {
  it('BR-034: активный vendor с тем же ИНН в tenant отклоняется, BLOCKED не мешает', async () => {
    await prisma.vendor.create({
      data: { tenantId, taxId: '301111111', legalName: 'V1', displayName: 'V1', status: 'ACTIVE' },
    });
    await expect(
      prisma.vendor.create({
        data: { tenantId, taxId: '301111111', legalName: 'V2', displayName: 'V2', status: 'ACTIVE' },
      }),
    ).rejects.toThrow();
    // BLOCKED — вне partial unique
    await expect(
      prisma.vendor.create({
        data: { tenantId, taxId: '301111111', legalName: 'V3', displayName: 'V3', status: 'BLOCKED' },
      }),
    ).resolves.toBeTruthy();
  });

  it('только одна VERIFIED default на (vendor, currency)', async () => {
    const vendor = await prisma.vendor.create({
      data: { tenantId, taxId: '302222222', legalName: 'V', displayName: 'V', status: 'ACTIVE' },
    });
    const base = {
      tenantId,
      vendorId: vendor.id,
      bankName: 'Bank',
      mfo: '00444',
      accountMasked: '****1234',
      accountEncrypted: 'enc',
      currency: 'UZS',
      isDefault: true,
    } as const;
    await prisma.vendorBankAccount.create({ data: { ...base, status: 'VERIFIED' } });
    await expect(
      prisma.vendorBankAccount.create({ data: { ...base, status: 'VERIFIED' } }),
    ).rejects.toThrow();
    // UNVERIFIED default допускается (станет default после verify + retire старой)
    await expect(
      prisma.vendorBankAccount.create({ data: { ...base, status: 'UNVERIFIED' } }),
    ).resolves.toBeTruthy();
  });

  it('contract: counterparty_type должен соответствовать заполненной стороне', async () => {
    const vendor = await prisma.vendor.create({
      data: { tenantId, taxId: '303333333', legalName: 'V', displayName: 'V', status: 'ACTIVE' },
    });
    // VENDOR-контракт без vendor_id → CHECK violation
    await expect(
      prisma.contract.create({
        data: {
          tenantId,
          number: 'C-1',
          counterpartyType: 'VENDOR',
          subject: 'x',
          startDate: new Date('2026-01-01'),
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.contract.create({
        data: {
          tenantId,
          number: 'C-1',
          counterpartyType: 'VENDOR',
          vendorId: vendor.id,
          subject: 'x',
          startDate: new Date('2026-01-01'),
        },
      }),
    ).resolves.toBeTruthy();
    // Дубликат номера в tenant
    await expect(
      prisma.contract.create({
        data: {
          tenantId,
          number: 'C-1',
          counterpartyType: 'VENDOR',
          vendorId: vendor.id,
          subject: 'y',
          startDate: new Date('2026-01-01'),
        },
      }),
    ).rejects.toThrow();
  });

  it('sequence: unique (tenant, key, year) и next_value >= 1', async () => {
    await prisma.sequence.create({ data: { tenantId, key: 'PR', year: 2026 } });
    await expect(
      prisma.sequence.create({ data: { tenantId, key: 'PR', year: 2026 } }),
    ).rejects.toThrow();
    await expect(
      prisma.sequence.create({ data: { tenantId, key: 'PAY', year: 2026, nextValue: 0 } }),
    ).rejects.toThrow();
    await prisma.sequence.deleteMany({ where: { tenantId } });
  });
});
