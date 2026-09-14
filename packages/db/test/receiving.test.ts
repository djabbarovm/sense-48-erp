import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unsafeCreateTenantContext } from '@finance-os/core';
import { prisma } from '../src/client.js';
import { createPr, decidePrApproval, submitPr } from '../src/services/purchaseRequests.js';
import { createPo, createReceipt, setPoStatus } from '../src/services/receiving.js';

let tenantId: string;
let ccId: string;
let catId: string;
let vendorId: string;
const requesterId = crypto.randomUUID();
const ccOwnerId = crypto.randomUUID();
const leadId = crypto.randomUUID();
const juniorId = crypto.randomUUID();
const ownerId = crypto.randomUUID();

const mk = (userId: string, ...roles: Parameters<typeof unsafeCreateTenantContext>[0]['roles']) =>
  unsafeCreateTenantContext({ tenantId, tenantSlug: 'x', userId, roles });
const requester = () => mk(requesterId, 'REQUESTER');
const ccOwner = () => mk(ccOwnerId, 'REQUESTER');
const lead = () => mk(leadId, 'FINANCE_OPS_LEAD');
const junior = () => mk(juniorId, 'JUNIOR_FINANCE');
const owner = () => mk(ownerId, 'OWNER');

beforeAll(async () => {
  const ts = Date.now();
  tenantId = (
    await prisma.tenant.create({ data: { slug: `t-b07-${ts}`, legalName: 'B07', taxId: '300000017' } })
  ).id;
  ccId = (await prisma.costCenter.create({ data: { tenantId, code: 'CC', name: 'CC', ownerId: ccOwnerId } })).id;
  catId = (
    await prisma.category.create({ data: { tenantId, code: 'C', name: 'C', group: 'FNB', budgetRequired: false } })
  ).id;
  vendorId = (
    await prisma.vendor.create({
      data: { tenantId, taxId: '311110002', legalName: 'V', displayName: 'V', status: 'ACTIVE' },
    })
  ).id;
});

afterAll(async () => prisma.$disconnect());

async function approvedPr(totalMinor: bigint) {
  const pr = await createPr(requester(), {
    what: 'Товар',
    purpose: 'Тест',
    totalMinor,
    costCenterId: ccId,
    categoryId: catId,
    vendorId,
  });
  await submitPr(requester(), pr.id);
  await decidePrApproval(ccOwner(), pr.id, 'BUSINESS_OWNER', 'APPROVED');
  if (totalMinor > 500_000_000n) {
    await decidePrApproval(lead(), pr.id, 'FINANCE', 'APPROVED');
    await decidePrApproval(owner(), pr.id, 'OWNER', 'APPROVED');
  } else {
    await decidePrApproval(junior(), pr.id, 'FINANCE', 'APPROVED');
  }
  return prisma.purchaseRequest.findUniqueOrThrow({ where: { id: pr.id } });
}

describe('B-07 PO + Receipt (BR-042)', () => {
  it('PO из APPROVED PR: номер PO-…, PR → ORDERED; статусы PO', async () => {
    const pr = await approvedPr(300_000_000n);
    const po = await createPo(junior(), pr.id);
    expect(po.number).toMatch(/^PO-\d{4}-\d{6}$/);
    expect(po.status).toBe('SENT');
    expect((await prisma.purchaseRequest.findUniqueOrThrow({ where: { id: pr.id } })).status).toBe('ORDERED');
    const confirmed = await setPoStatus(junior(), po.id, 'CONFIRMED');
    expect(confirmed.status).toBe('CONFIRMED');
    await expect(setPoStatus(junior(), po.id, 'SENT')).rejects.toThrow(/CONFIRMED → SENT/);
  });

  it('Tier 1: requester может принять сам; FULL receipt → PR RECEIVED', async () => {
    const pr = await approvedPr(300_000_000n);
    const { receipt, pr: updated } = await createReceipt(requester(), { prId: pr.id });
    expect(receipt.status).toBe('FULL');
    expect(updated.status).toBe('RECEIVED');
  });

  it('BR-042: Tier 2+ requester ≠ receiver — блок; другой сотрудник может', async () => {
    const pr = await approvedPr(800_000_000n); // tier 2
    await expect(createReceipt(requester(), { prId: pr.id })).rejects.toThrow(/BR-042|не инициатор/);
    const { pr: updated } = await createReceipt(junior(), { prId: pr.id });
    expect(updated.status).toBe('RECEIVED');
  });

  it('PARTIAL receipt не переводит PR в RECEIVED', async () => {
    const pr = await approvedPr(300_000_000n);
    const { pr: same } = await createReceipt(junior(), { prId: pr.id, status: 'PARTIAL' });
    expect(same.status).toBe('APPROVED');
  });

  it('receipt по не-APPROVED PR отклоняется', async () => {
    const draft = await createPr(requester(), {
      what: 'x',
      purpose: 'p',
      totalMinor: 1000n,
      costCenterId: ccId,
      categoryId: catId,
      vendorId,
    });
    await expect(createReceipt(junior(), { prId: draft.id })).rejects.toThrow(/невозможен/);
  });
});
