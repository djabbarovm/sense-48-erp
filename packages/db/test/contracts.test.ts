import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IllegalTransitionError, PermissionDeniedError, unsafeCreateTenantContext } from '@finance-os/core';
import { prisma } from '../src/client.js';
import {
  createAmendment,
  createContract,
  createExpiryTasksForTenant,
  getContract360,
  signAmendment,
  transitionContract,
  updateContract,
} from '../src/services/contracts.js';

let tenantId: string;
let vendorId: string;
const uid = () => crypto.randomUUID();
const leadId = uid();
const ownerId = uid();
const docId = uid();

const ctx = (userId: string, ...roles: Parameters<typeof unsafeCreateTenantContext>[0]['roles']) =>
  unsafeCreateTenantContext({ tenantId, tenantSlug: 'x', userId, roles });
const lead = () => ctx(leadId, 'FINANCE_OPS_LEAD');
const owner = () => ctx(ownerId, 'OWNER');
const doc = () => ctx(docId, 'DOCUMENT_CONTROLLER');

let n = 0;
const num = () => `TEST-${Date.now()}-${n++}`;

beforeAll(async () => {
  const ts = Date.now();
  tenantId = (
    await prisma.tenant.create({ data: { slug: `t-b02-${ts}`, legalName: 'B02', taxId: '300000012' } })
  ).id;
  vendorId = (
    await prisma.vendor.create({
      data: { tenantId, taxId: '311111100', legalName: 'V', displayName: 'V', status: 'ACTIVE' },
    })
  ).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('B-02 Contract (docs/04 state machine)', () => {
  it('happy path: DRAFT→IN_REVIEW→APPROVED→SIGNED→ACTIVE (без регистрации)', async () => {
    const c = await createContract(doc(), {
      number: num(),
      counterpartyType: 'VENDOR',
      vendorId,
      subject: 'Поставка продуктов',
      limitMinor: 5_000_000_000n,
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
      paymentTerms: { type: 'POSTPAY_DAYS', value: 14 },
    });
    expect(c.status).toBe('DRAFT');
    await transitionContract(doc(), c.id, 'submit_review');
    // approve прав нет у DOC_CONTROLLER
    await expect(transitionContract(doc(), c.id, 'approve')).rejects.toThrow(PermissionDeniedError);
    await transitionContract(lead(), c.id, 'approve');
    await transitionContract(doc(), c.id, 'sign');
    const active = await transitionContract(doc(), c.id, 'activate');
    expect(active.status).toBe('ACTIVE');
    // audit по каждому переходу
    const audits = await prisma.auditLog.findMany({ where: { tenantId, objectId: c.id } });
    expect(audits.map((a) => a.action)).toEqual(
      expect.arrayContaining(['contract.create', 'contract.submit_review', 'contract.approve', 'contract.sign', 'contract.activate']),
    );
  });

  it('registration_required: activate из SIGNED запрещён, только через REGISTERED', async () => {
    const c = await createContract(doc(), {
      number: num(),
      counterpartyType: 'VENDOR',
      vendorId,
      subject: 'Аренда 48 этажа',
      startDate: new Date('2026-01-01'),
      registrationRequired: true,
    });
    await transitionContract(doc(), c.id, 'submit_review');
    await transitionContract(lead(), c.id, 'approve');
    await transitionContract(doc(), c.id, 'sign');
    await expect(transitionContract(doc(), c.id, 'activate')).rejects.toThrow(/регистрации/);
    const reg = await transitionContract(doc(), c.id, 'register');
    expect(reg.registeredAt).not.toBeNull();
    const active = await transitionContract(doc(), c.id, 'activate');
    expect(active.status).toBe('ACTIVE');
  });

  it('недопустимый переход → IllegalTransitionError', async () => {
    const c = await createContract(doc(), {
      number: num(),
      counterpartyType: 'VENDOR',
      vendorId,
      subject: 'x',
      startDate: new Date('2026-01-01'),
    });
    await expect(transitionContract(lead(), c.id, 'approve')).rejects.toThrow(IllegalTransitionError);
    await expect(transitionContract(doc(), c.id, 'terminate')).rejects.toThrow(IllegalTransitionError);
  });

  it('edit после SIGNED запрещён; amendment: start_amend → sign применяет changes', async () => {
    const c = await createContract(doc(), {
      number: num(),
      counterpartyType: 'VENDOR',
      vendorId,
      subject: 'Лимит',
      limitMinor: 1_000_000_00n,
      startDate: new Date('2026-01-01'),
    });
    await transitionContract(doc(), c.id, 'submit_review');
    await transitionContract(lead(), c.id, 'approve');
    await transitionContract(doc(), c.id, 'sign');
    await expect(updateContract(doc(), c.id, { subject: 'nope' })).rejects.toThrow(/amendment/);
    await transitionContract(doc(), c.id, 'activate');
    await transitionContract(doc(), c.id, 'start_amend');
    const amendment = await createAmendment(doc(), c.id, {
      number: 'ДС-1',
      date: new Date('2026-06-01'),
      changes: { limitMinor: '20000000000', endDate: '2027-06-30' },
    });
    const after = await signAmendment(lead(), amendment.id);
    expect(after.status).toBe('ACTIVE');
    expect(after.limitMinor).toBe(20000000000n);
    expect(after.endDate?.toISOString().slice(0, 10)).toBe('2027-06-30');
  });

  it('terminate [OWNER] → TERMINATING → close (outstanding=0, задач нет)', async () => {
    const c = await createContract(doc(), {
      number: num(),
      counterpartyType: 'VENDOR',
      vendorId,
      subject: 'Закрытие',
      startDate: new Date('2026-01-01'),
    });
    await transitionContract(doc(), c.id, 'submit_review');
    await transitionContract(lead(), c.id, 'approve');
    await transitionContract(doc(), c.id, 'sign');
    await transitionContract(doc(), c.id, 'activate');
    await expect(transitionContract(doc(), c.id, 'terminate')).rejects.toThrow(PermissionDeniedError);
    const term = await transitionContract(owner(), c.id, 'terminate');
    expect(term.status).toBe('TERMINATING');
    const closed = await transitionContract(owner(), c.id, 'close');
    expect(closed.status).toBe('CLOSED');
  });

  it('BR-026 stub: contract с end_date < 30 дней получает Task CONTRACT_EXPIRY один раз', async () => {
    const soon = new Date();
    soon.setDate(soon.getDate() + 20);
    const c = await createContract(doc(), {
      number: num(),
      counterpartyType: 'VENDOR',
      vendorId,
      subject: 'Smart Teams Rent',
      startDate: new Date('2026-01-01'),
      endDate: soon,
    });
    await transitionContract(doc(), c.id, 'submit_review');
    await transitionContract(lead(), c.id, 'approve');
    await transitionContract(doc(), c.id, 'sign');
    await transitionContract(doc(), c.id, 'activate');
    expect(await createExpiryTasksForTenant(tenantId)).toBe(1);
    expect(await createExpiryTasksForTenant(tenantId)).toBe(0); // идемпотентно
    const task = await prisma.task.findFirstOrThrow({
      where: { tenantId, type: 'CONTRACT_EXPIRY', objectId: c.id },
    });
    expect(task.nextAction).toContain(c.number);
  });

  it('getContract360 возвращает баланс и amendments', async () => {
    const c = await createContract(doc(), {
      number: num(),
      counterpartyType: 'VENDOR',
      vendorId,
      subject: '360',
      limitMinor: 42n,
      startDate: new Date('2026-01-01'),
    });
    const dto = await getContract360(lead(), c.id);
    expect(dto.balance.outstandingMinor).toBe(42n);
    expect(dto.vendor?.displayName).toBe('V');
  });
});
