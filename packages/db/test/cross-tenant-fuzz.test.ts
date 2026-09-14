import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { NotFoundError, unsafeCreateTenantContext, type TenantContext } from '@finance-os/core';
import { prisma } from '../src/client.js';
import { getPayment, submitPaymentRequest } from '../src/services/payments.js';
import { freezeBatch, getBatch } from '../src/services/batches.js';
import { getContract360, transitionContract } from '../src/services/contracts.js';
import { getEvent, transitionEvent } from '../src/services/events.js';
import { issueCustomerInvoice, promiseToPay } from '../src/services/arInvoices.js';
import { closeAdvance, writeOffAdvance } from '../src/services/advances.js';
import { calculateTaxObligation } from '../src/services/tax.js';
import { approvePayrollRun } from '../src/services/payroll.js';
import { setEdoMockStatus } from '../src/services/edo.js';
import { getApAging } from '../src/services/aging.js';
import { getDocumentHealth, HEALTH_ZONES } from '../src/services/documentHealth.js';

process.env.BANK_DATA_KEY ??= randomBytes(32).toString('base64');

/**
 * G-02: cross-tenant fuzz (BR-073 / AC-11).
 * Все object-адресуемые сервисы при чужом tenant-контексте обязаны отвечать
 * NotFound (404), а не 500 и не данными. Плюс случайные UUID → тоже 404.
 */

let victimCtx: TenantContext;
let attackerCtx: TenantContext;
const ids: Record<string, string> = {};

const mk = (tenantId: string): TenantContext =>
  unsafeCreateTenantContext({ tenantId, tenantSlug: 'x', userId: crypto.randomUUID(), roles: ['OWNER', 'FINANCE_OPS_LEAD', 'ACCOUNTANT', 'ADMIN'] });

describe('G-02 cross-tenant fuzz (BR-073)', () => {
  beforeAll(async () => {
    const ts = Date.now();
    const victim = await prisma.tenant.create({ data: { slug: `t-g02v-${ts}`, legalName: 'Victim', taxId: '300000901' } });
    const attacker = await prisma.tenant.create({ data: { slug: `t-g02a-${ts}`, legalName: 'Attacker', taxId: '300000902' } });
    victimCtx = mk(victim.id);
    attackerCtx = mk(attacker.id);

    // объекты жертвы по одному на тип
    const vendor = await prisma.vendor.create({
      data: { tenantId: victim.id, taxId: '311110900', legalName: 'V', displayName: 'V', status: 'ACTIVE' },
    });
    const contract = await prisma.contract.create({
      data: { tenantId: victim.id, number: 'CTR-G02', counterpartyType: 'VENDOR', vendorId: vendor.id, subject: 'x', startDate: new Date(), status: 'DRAFT' },
    });
    ids.contract = contract.id;
    const payment = await prisma.paymentRequest.create({
      data: { tenantId: victim.id, number: 'PAY-G02-1', sourceType: 'CONTRACT', sourceId: contract.id, requestedMinor: 100n, purposeNote: 'x', status: 'DRAFT' },
    });
    ids.payment = payment.id;
    const account = await prisma.bankAccount.create({
      data: { tenantId: victim.id, bankName: 'TB', mfo: '00444', accountMasked: '****G002', accountEncrypted: 'enc' },
    });
    const batch = await prisma.paymentBatch.create({
      data: { tenantId: victim.id, number: 'BATCH-G02', batchDate: new Date(), bankAccountId: account.id, status: 'OPEN' },
    });
    ids.batch = batch.id;
    const event = await prisma.event.create({
      data: { tenantId: victim.id, number: 'EVT-G02', name: 'E', eventDate: new Date(), status: 'DRAFT' },
    });
    ids.event = event.id;
    const customer = await prisma.customer.create({ data: { tenantId: victim.id, legalName: 'C' } });
    const cinv = await prisma.customerInvoice.create({
      data: { tenantId: victim.id, number: 'CINV-G02', customerId: customer.id, date: new Date(), dueDate: new Date(), amountGrossMinor: 100n, status: 'DRAFT' },
    });
    ids.cinv = cinv.id;
    const advance = await prisma.advance.create({
      data: { tenantId: victim.id, type: 'EMPLOYEE_ADVANCE', amountMinor: 100n, purpose: 'x', status: 'OPEN' },
    });
    ids.advance = advance.id;
    const tax = await prisma.taxObligation.create({
      data: { tenantId: victim.id, type: 'VAT', name: 'НДС', period: '2026-08', dueDate: new Date(), status: 'PLANNED' },
    });
    ids.tax = tax.id;
    const payroll = await prisma.payrollRun.create({
      data: { tenantId: victim.id, period: '2026-09', employeeCount: 1, grossMinor: 100n, netMinor: 90n, taxesMinor: 10n, status: 'CHECKED' },
    });
    ids.payroll = payroll.id;
    await prisma.edoMockDocument.create({ data: { tenantId: victim.id, edoDocumentId: 'didox-g02', status: 'SIGNED' } });
  });
  afterAll(async () => prisma.$disconnect());

  const attacks: [string, () => Promise<unknown>][] = [
    ['getPayment', () => getPayment(attackerCtx, ids.payment!)],
    ['submitPaymentRequest', () => submitPaymentRequest(attackerCtx, ids.payment!)],
    ['getBatch', () => getBatch(attackerCtx, ids.batch!)],
    ['freezeBatch', () => freezeBatch(attackerCtx, ids.batch!)],
    ['getContract360', () => getContract360(attackerCtx, ids.contract!)],
    ['transitionContract', () => transitionContract(attackerCtx, ids.contract!, 'submit_review')],
    ['getEvent', () => getEvent(attackerCtx, ids.event!)],
    ['transitionEvent', () => transitionEvent(attackerCtx, ids.event!, 'quote')],
    ['issueCustomerInvoice', () => issueCustomerInvoice(attackerCtx, ids.cinv!)],
    ['promiseToPay', () => promiseToPay(attackerCtx, ids.cinv!, new Date())],
    ['closeAdvance', () => closeAdvance(attackerCtx, ids.advance!, { closedMinor: 1n })],
    ['writeOffAdvance', () => writeOffAdvance(attackerCtx, ids.advance!, 'reason')],
    ['calculateTaxObligation', () => calculateTaxObligation(attackerCtx, ids.tax!, 1n)],
    ['approvePayrollRun', () => approvePayrollRun(attackerCtx, ids.payroll!)],
    ['setEdoMockStatus', () => setEdoMockStatus(attackerCtx, 'didox-g02', 'CANCELLED')],
  ];

  it.each(attacks)('%s: чужой tenant получает 404, данные не утекают и не меняются', async (_name, attack) => {
    await expect(attack()).rejects.toSatisfy((error: unknown) => error instanceof NotFoundError);
  });

  it('victim-контекст объекты видит (санити)', async () => {
    const payment = await getPayment(victimCtx, ids.payment!);
    expect(payment.payment.number).toBe('PAY-G02-1');
  });

  it('fuzz: 25 случайных UUID по всем сервисам → 404, ни одного 500', async () => {
    const targets = [
      (id: string) => getPayment(attackerCtx, id),
      (id: string) => getBatch(attackerCtx, id),
      (id: string) => getContract360(attackerCtx, id),
      (id: string) => getEvent(attackerCtx, id),
      (id: string) => issueCustomerInvoice(attackerCtx, id),
    ];
    for (let i = 0; i < 25; i++) {
      const target = targets[i % targets.length]!;
      await expect(target(crypto.randomUUID())).rejects.toSatisfy((error: unknown) => error instanceof NotFoundError);
    }
  });

  it('агрегаты чужого tenant пустые (aging, document health)', async () => {
    expect(await getApAging(attackerCtx)).toEqual([]);
    const health = await getDocumentHealth(attackerCtx);
    expect(HEALTH_ZONES.every((zone) => health[zone].length === 0)).toBe(true);
  });
});
