import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ValidationError, unsafeCreateTenantContext } from '@finance-os/core';
import { prisma } from '../src/client.js';
import {
  createPr,
  decidePrApproval,
  listMyPendingApprovals,
  submitPr,
  transitionPr,
} from '../src/services/purchaseRequests.js';

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

// суммы в тийинах: 5 млн UZS = 500_000_000
const T1 = 300_000_000n; // 3 млн UZS → Tier 1
const T2 = 800_000_000n; // 8 млн UZS → Tier 2

beforeAll(async () => {
  const ts = Date.now();
  tenantId = (
    await prisma.tenant.create({ data: { slug: `t-b06-${ts}`, legalName: 'B06', taxId: '300000016' } })
  ).id;
  ccId = (await prisma.costCenter.create({ data: { tenantId, code: 'RH-K', name: 'Кухня', ownerId: ccOwnerId } })).id;
  catId = (
    await prisma.category.create({ data: { tenantId, code: 'FNB', name: 'FNB', group: 'FNB', budgetRequired: false } })
  ).id;
  vendorId = (
    await prisma.vendor.create({
      data: { tenantId, taxId: '311110001', legalName: 'Vendor', displayName: 'Vendor', status: 'ACTIVE' },
    })
  ).id;
});

afterAll(async () => prisma.$disconnect());

const basePr = () => ({
  what: 'Лосось 20 кг',
  purpose: 'Банкет',
  totalMinor: T1,
  costCenterId: ccId,
  categoryId: catId,
  vendorId,
});

describe('B-06 PurchaseRequest', () => {
  it('create → submit: номер PR-YYYY-NNNNNN, budget_status, tier, слоты approvals', async () => {
    const pr = await createPr(requester(), basePr());
    expect(pr.number).toMatch(/^PR-\d{4}-\d{6}$/);
    expect(pr.status).toBe('DRAFT');
    const { pr: submitted, decision } = await submitPr(requester(), pr.id);
    expect(submitted.status).toBe('SUBMITTED');
    expect(submitted.budgetStatus).toBe('WITHIN'); // budget_required=false, строки нет
    expect(submitted.tier).toBe(1);
    expect(decision.approvals.map((a) => a.role)).toEqual(['BUSINESS_OWNER', 'FINANCE']);
  });

  it('Tier 1: business owner (владелец cc) + junior finance → APPROVED', async () => {
    const pr = await createPr(requester(), basePr());
    await submitPr(requester(), pr.id);
    // обычный requester не может голосовать за BUSINESS_OWNER
    await expect(decidePrApproval(requester(), pr.id, 'BUSINESS_OWNER', 'APPROVED')).rejects.toThrow(/pr.approve.business/);
    await decidePrApproval(ccOwner(), pr.id, 'BUSINESS_OWNER', 'APPROVED');
    const done = await decidePrApproval(junior(), pr.id, 'FINANCE', 'APPROVED');
    expect(done.status).toBe('APPROVED');
  });

  it('Tier 2: junior не может FINANCE-слот, нужен owner; полный цикл до APPROVED', async () => {
    const pr = await createPr(requester(), { ...basePr(), totalMinor: T2 });
    const { decision } = await submitPr(requester(), pr.id);
    expect(decision.tier).toBe(2);
    expect(decision.approvals.map((a) => a.role)).toContain('OWNER');
    await expect(decidePrApproval(junior(), pr.id, 'FINANCE', 'APPROVED')).rejects.toThrow(/pr.approve.finance/);
    await decidePrApproval(ccOwner(), pr.id, 'BUSINESS_OWNER', 'APPROVED');
    await decidePrApproval(lead(), pr.id, 'FINANCE', 'APPROVED');
    const done = await decidePrApproval(owner(), pr.id, 'OWNER', 'APPROVED');
    expect(done.status).toBe('APPROVED');
  });

  it('BR-045: reject без комментария (≥10 символов) отклоняется; с комментарием → REJECTED', async () => {
    const pr = await createPr(requester(), basePr());
    await submitPr(requester(), pr.id);
    await expect(decidePrApproval(ccOwner(), pr.id, 'BUSINESS_OWNER', 'REJECTED', 'нет')).rejects.toThrow(/BR-045|минимум 10/);
    const rejected = await decidePrApproval(ccOwner(), pr.id, 'BUSINESS_OWNER', 'REJECTED', 'Слишком дорого, найдите другого поставщика');
    expect(rejected.status).toBe('REJECTED');
  });

  it('BR-044: решение по DRAFT/REJECTED невозможно', async () => {
    const pr = await createPr(requester(), basePr());
    await expect(decidePrApproval(ccOwner(), pr.id, 'BUSINESS_OWNER', 'APPROVED')).rejects.toThrow(/BR-044/);
  });

  it('BR-043: urgent без reason не сабмитится', async () => {
    const pr = await createPr(requester(), { ...basePr(), isUrgent: true });
    await expect(submitPr(requester(), pr.id)).rejects.toThrow(/BR-043|urgency/);
  });

  it('без cost_center — ошибка cost_center_id required (AC-01 negative)', async () => {
    await expect(
      createPr(requester(), { ...basePr(), costCenterId: crypto.randomUUID() }),
    ).rejects.toThrow(/cost_center_id required/);
  });

  it('cancel: requester до APPROVED, finance после; комментарий обязателен', async () => {
    const pr = await createPr(requester(), basePr());
    await expect(transitionPr(requester(), pr.id, 'cancel', {})).rejects.toThrow(ValidationError);
    const cancelled = await transitionPr(requester(), pr.id, 'cancel', { comment: 'передумали' });
    expect(cancelled.status).toBe('CANCELLED');

    const pr2 = await createPr(requester(), basePr());
    await submitPr(requester(), pr2.id);
    await decidePrApproval(ccOwner(), pr2.id, 'BUSINESS_OWNER', 'APPROVED');
    await decidePrApproval(lead(), pr2.id, 'FINANCE', 'APPROVED');
    // APPROVED: requester не может, finance может
    await expect(transitionPr(requester(), pr2.id, 'cancel', { comment: 'x' })).rejects.toThrow(/финанс/i);
    const c2 = await transitionPr(lead(), pr2.id, 'cancel', { comment: 'отмена закупки' });
    expect(c2.status).toBe('CANCELLED');
  });

  it('return_for_edit: SUBMITTED → DRAFT финансовой ролью', async () => {
    const pr = await createPr(requester(), basePr());
    await submitPr(requester(), pr.id);
    const back = await transitionPr(lead(), pr.id, 'return_for_edit');
    expect(back.status).toBe('DRAFT');
  });

  it('fast lane: PR внутри бюджета CONFIRMED события авто-APPROVED без слотов', async () => {
    const event = await prisma.event.create({
      data: {
        tenantId,
        number: `EVT-B06-${Date.now()}`,
        name: 'Банкет',
        eventDate: new Date('2026-09-27'),
        status: 'CONFIRMED',
      },
    });
    await prisma.eventBudgetLine.create({
      data: { tenantId, eventId: event.id, categoryId: catId, plannedMinor: 1_000_000_000n, approvedVendorIds: [vendorId] },
    });
    const pr = await createPr(requester(), { ...basePr(), eventId: event.id, totalMinor: 400_000_000n });
    const { pr: submitted, decision } = await submitPr(requester(), pr.id);
    expect(decision.fastLane).toBe(true);
    expect(submitted.status).toBe('APPROVED');
    expect(submitted.isFastLane).toBe(true);
    expect(await prisma.purchaseApproval.count({ where: { prId: pr.id } })).toBe(0);
    // второй PR, превышающий остаток линии → обычный маршрут
    const pr2 = await createPr(requester(), { ...basePr(), eventId: event.id, totalMinor: 700_000_000n });
    const { decision: d2 } = await submitPr(requester(), pr2.id);
    expect(d2.fastLane).toBe(false);
  });

  it('listMyPendingApprovals отдаёт слоты по правам', async () => {
    const pr = await createPr(requester(), { ...basePr(), totalMinor: T2 });
    await submitPr(requester(), pr.id);
    const forOwner = await listMyPendingApprovals(owner());
    expect(forOwner.some((x) => x.pr.id === pr.id && x.slot.role === 'OWNER')).toBe(true);
    const forJunior = await listMyPendingApprovals(junior());
    expect(forJunior.some((x) => x.pr.id === pr.id && x.slot.role === 'FINANCE')).toBe(false); // tier 2
  });
});
