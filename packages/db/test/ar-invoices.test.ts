import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unsafeCreateTenantContext } from '@finance-os/core';
import { prisma } from '../src/client.js';
import {
  createCustomerInvoice,
  disputeCustomerInvoice,
  getArAging,
  issueCustomerInvoice,
  markOverdueCustomerInvoices,
  matchArReceipt,
  promiseToPay,
  runArReminders,
} from '../src/services/arInvoices.js';

let tenantId: string;
let customerId: string;
let arOwnerId: string;
let bankAccountId: string;

const ctx = () =>
  unsafeCreateTenantContext({ tenantId, tenantSlug: 'x', userId: crypto.randomUUID(), roles: ['FINANCE_OPS_LEAD'] });

const NOW = new Date('2026-09-14T12:00:00Z');
const days = (n: number) => new Date(NOW.getTime() + n * 86400_000);

async function mkInTx(externalId: string, amountMinor: bigint) {
  return prisma.bankTransaction.create({
    data: {
      tenantId,
      bankAccountId,
      externalId,
      bookingDate: NOW,
      valueDate: NOW,
      amountMinor,
      counterpartyName: 'Client',
      matchStatus: 'UNMATCHED',
    },
  });
}

describe('D-02 CustomerInvoice / AR', () => {
  beforeAll(async () => {
    const ts = Date.now();
    tenantId = (await prisma.tenant.create({ data: { slug: `t-d02-${ts}`, legalName: 'D02', taxId: '300000044' } })).id;
    arOwnerId = (await prisma.user.create({ data: { email: `ar-${ts}@t.test`, fullName: 'AR Owner' } })).id;
    customerId = (
      await prisma.customer.create({
        data: { tenantId, legalName: 'ООО «Client Events»', paymentTermsDays: 5, arOwnerId },
      })
    ).id;
    bankAccountId = (
      await prisma.bankAccount.create({
        data: { tenantId, bankName: 'TB', mfo: '00444', accountMasked: '****2222', accountEncrypted: 'enc' },
      })
    ).id;
  });
  afterAll(async () => prisma.$disconnect());

  it('create → ISSUED: due = date + terms; audit пишется', async () => {
    const invoice = await createCustomerInvoice(ctx(), {
      customerId,
      date: NOW,
      amountGrossMinor: 10_000_000_00n,
    });
    expect(invoice.number).toMatch(/^CINV-2026-\d{6}$/);
    expect(invoice.dueDate.toISOString().slice(0, 10)).toBe(days(5).toISOString().slice(0, 10));
    const issued = await issueCustomerInvoice(ctx(), invoice.id);
    expect(issued.status).toBe('ISSUED');
    const audit = await prisma.auditLog.findMany({
      where: { tenantId, objectType: 'customer_invoice', objectId: invoice.id },
    });
    expect(audit.map((a) => a.action)).toEqual(['customer_invoice.create', 'customer_invoice.issue']);
  });

  it('поступления через банк: PARTIALLY_PAID → PAID; overpay отклоняется', async () => {
    const invoice = await createCustomerInvoice(ctx(), { customerId, date: NOW, amountGrossMinor: 5_000_000_00n });
    await issueCustomerInvoice(ctx(), invoice.id);
    const tx1 = await mkInTx('AR-1', 2_000_000_00n);
    const part = await matchArReceipt(ctx(), tx1.id, invoice.id);
    expect(part.status).toBe('PARTIALLY_PAID');
    expect(part.receivedMinor).toBe(2_000_000_00n);
    // переплата
    const txOver = await mkInTx('AR-2', 4_000_000_00n);
    await expect(matchArReceipt(ctx(), txOver.id, invoice.id)).rejects.toThrow(/OVERPAID|больше остатка/);
    // добор до полной
    const tx2 = await mkInTx('AR-3', 3_000_000_00n);
    const paid = await matchArReceipt(ctx(), tx2.id, invoice.id);
    expect(paid.status).toBe('PAID');
    const matched = await prisma.bankTransaction.findUnique({ where: { id: tx2.id } });
    expect(matched!.matchStatus).toBe('MANUAL_MATCHED');
  });

  it('BR-060: reminders T−3/T0/+1 идемпотентны', async () => {
    // due через 2 дня → к NOW сработал только offset −3
    const invoice = await createCustomerInvoice(ctx(), {
      customerId,
      date: days(-3),
      dueDate: days(2),
      amountGrossMinor: 1_000_000_00n,
    });
    await issueCustomerInvoice(ctx(), invoice.id);
    const first = await runArReminders(tenantId, NOW);
    const mine = first.filter((r) => r.customerInvoiceId === invoice.id);
    expect(mine.map((r) => r.offsetDays)).toEqual([-3]);
    expect(mine[0]!.arOwnerId).toBe(arOwnerId);
    // повторный запуск ничего не шлёт
    const second = await runArReminders(tenantId, NOW);
    expect(second.filter((r) => r.customerInvoiceId === invoice.id)).toEqual([]);
    // через 10 дней — добавляются 0/+1/+3/+7
    const later = await runArReminders(tenantId, days(10));
    expect(later.filter((r) => r.customerInvoiceId === invoice.id).map((r) => r.offsetDays)).toEqual([0, 1, 3, 7]);
  });

  it('overdue job → OVERDUE + Task AR_FOLLOWUP владельцу AR; aging по buckets', async () => {
    const invoice = await createCustomerInvoice(ctx(), {
      customerId,
      date: days(-20),
      dueDate: days(-10),
      amountGrossMinor: 3_000_000_00n,
    });
    await issueCustomerInvoice(ctx(), invoice.id);
    const count = await markOverdueCustomerInvoices(tenantId, NOW);
    expect(count).toBeGreaterThanOrEqual(1);
    const task = await prisma.task.findFirst({
      where: { tenantId, type: 'AR_FOLLOWUP', objectType: 'customer_invoice', objectId: invoice.id },
    });
    expect(task?.ownerId).toBe(arOwnerId);
    const aging = await getArAging(ctx(), NOW);
    const row = aging.find((r) => r.customerId === customerId)!;
    const inv = row.invoices.find((i) => i.invoiceId === invoice.id)!;
    expect(inv.bucket).toBe('D8_30');
    expect(inv.status).toBe('OVERDUE');
  });

  it('dispute требует причину; promise-to-pay сохраняется', async () => {
    const invoice = await createCustomerInvoice(ctx(), { customerId, date: NOW, amountGrossMinor: 500_000_00n });
    await issueCustomerInvoice(ctx(), invoice.id);
    await expect(disputeCustomerInvoice(ctx(), invoice.id, ' ')).rejects.toThrow(/REASON_REQUIRED/);
    const promised = await promiseToPay(ctx(), invoice.id, days(4));
    expect(promised.promiseToPayDate?.toISOString().slice(0, 10)).toBe(days(4).toISOString().slice(0, 10));
    const disputed = await disputeCustomerInvoice(ctx(), invoice.id, 'Клиент оспаривает количество гостей');
    expect(disputed.status).toBe('DISPUTED');
  });

  it('permission: REQUESTER не может выставлять от чужого tenant (404)', async () => {
    const foreignTenant = await prisma.tenant.create({
      data: { slug: `t-d02b-${Date.now()}`, legalName: 'B', taxId: '300000045' },
    });
    const foreign = unsafeCreateTenantContext({
      tenantId: foreignTenant.id,
      tenantSlug: 'y',
      userId: crypto.randomUUID(),
      roles: ['FINANCE_OPS_LEAD'],
    });
    const invoice = await createCustomerInvoice(ctx(), { customerId, date: NOW, amountGrossMinor: 100_000_00n });
    await expect(issueCustomerInvoice(foreign, invoice.id)).rejects.toThrow(/not found|Not found/i);
  });
});
