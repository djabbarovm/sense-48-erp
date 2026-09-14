import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unsafeCreateTenantContext } from '@finance-os/core';
import { prisma } from '../src/client.js';
import { getDocumentHealth } from '../src/services/documentHealth.js';

let tenantId: string;
let vendorId: string;
let contractId: string;

const ctx = () =>
  unsafeCreateTenantContext({ tenantId, tenantSlug: 'x', userId: crypto.randomUUID(), roles: ['ACCOUNTANT'] });

const NOW = new Date('2026-09-14T12:00:00Z');
const days = (n: number) => new Date(NOW.getTime() + n * 86400_000);

describe('E-01 Document Health — красные зоны', () => {
  beforeAll(async () => {
    const ts = Date.now();
    tenantId = (await prisma.tenant.create({ data: { slug: `t-e01-${ts}`, legalName: 'E01', taxId: '300000088' } })).id;
    vendorId = (
      await prisma.vendor.create({
        data: {
          tenantId,
          taxId: '311110030',
          legalName: 'HV',
          displayName: 'HealthVendor',
          status: 'ACTIVE',
          riskFlags: ['BANK_CHANGED_RECENTLY'],
        },
      })
    ).id;
    contractId = (
      await prisma.contract.create({
        data: {
          tenantId,
          number: 'CTR-E01',
          counterpartyType: 'VENDOR',
          vendorId,
          subject: 'x',
          startDate: days(-300),
          endDate: days(-5),
          status: 'ACTIVE',
        },
      })
    ).id;
  });
  afterAll(async () => prisma.$disconnect());

  it('оплачен без СФ и без акта дольше SLA; истёкший договор; ДС без подписи; смена реквизитов', async () => {
    const account = await prisma.bankAccount.create({
      data: { tenantId, bankName: 'TB', mfo: '00444', accountMasked: '****8888', accountEncrypted: 'enc' },
    });
    const tx = await prisma.bankTransaction.create({
      data: {
        tenantId,
        bankAccountId: account.id,
        externalId: 'E01-1',
        bookingDate: days(-20),
        valueDate: days(-20),
        amountMinor: -100n,
        counterpartyName: 'HV',
        matchStatus: 'AUTO_MATCHED',
      },
    });
    const category = await prisma.category.create({
      data: { tenantId, code: 'E01', name: 'E01', group: 'OTHER', closingDocSlaDays: 5 },
    });
    const payment = await prisma.paymentRequest.create({
      data: {
        tenantId,
        number: 'PAY-E01-1',
        sourceType: 'CONTRACT',
        sourceId: contractId,
        vendorId,
        requestedMinor: 100n,
        purposeNote: 'x',
        categoryId: category.id,
        status: 'PAID',
        bankTransactionId: tx.id,
        paidAt: days(-20), // 20 дней назад, SLA 5 → в красной зоне
      },
    });
    await prisma.contractAmendment.create({
      data: { tenantId, contractId, number: '1', date: NOW, status: 'DRAFT' },
    });

    const health = await getDocumentHealth(ctx(), NOW);
    expect(health.PAID_WITHOUT_SF.map((i) => i.label)).toContain('PAY-E01-1');
    expect(health.PAID_WITHOUT_ACT_SLA.map((i) => i.label)).toContain('PAY-E01-1');
    expect(health.EXPIRED_CONTRACTS.map((i) => i.label)).toContain('CTR-E01');
    expect(health.UNSIGNED_AMENDMENTS.length).toBeGreaterThanOrEqual(1);
    expect(health.VENDOR_BANK_CHANGED.map((i) => i.label)).toContain('HealthVendor');

    // СФ-документ снимает зону PAID_WITHOUT_SF
    await prisma.document.create({
      data: {
        tenantId,
        objectType: 'payment_request',
        objectId: payment.id,
        docType: 'SF',
        fileKey: 'k',
        fileName: 'sf.pdf',
        mime: 'application/pdf',
        size: 1,
        sha256: 'h',
        status: 'RECEIVED',
      },
    });
    const after = await getDocumentHealth(ctx(), NOW);
    expect(after.PAID_WITHOUT_SF.map((i) => i.label)).not.toContain('PAY-E01-1');
  });

  it('tenant isolation: чужой tenant видит пустые зоны', async () => {
    const foreign = unsafeCreateTenantContext({
      tenantId: (await prisma.tenant.create({ data: { slug: `t-e01b-${Date.now()}`, legalName: 'B', taxId: '300000089' } })).id,
      tenantSlug: 'y',
      userId: crypto.randomUUID(),
      roles: ['ACCOUNTANT'],
    });
    const health = await getDocumentHealth(foreign, NOW);
    expect(Object.values(health).every((zone) => zone.length === 0)).toBe(true);
  });
});
