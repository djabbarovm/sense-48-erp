import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unsafeCreateTenantContext } from '@finance-os/core';
import { prisma } from '../src/client.js';
import {
  approveTaxObligation,
  calculateTaxObligation,
  createTaxPayment,
  fileTaxObligation,
  generateTaxObligations,
  markOverdueTaxObligations,
  upsertTaxRule,
} from '../src/services/tax.js';
import {
  approvePayrollRun,
  checkPayrollRun,
  createPayrollPayment,
  createPayrollRun,
} from '../src/services/payroll.js';

let tenantId: string;

const lead = () =>
  unsafeCreateTenantContext({ tenantId, tenantSlug: 'x', userId: crypto.randomUUID(), roles: ['FINANCE_OPS_LEAD'] });
const acct = () =>
  unsafeCreateTenantContext({ tenantId, tenantSlug: 'x', userId: crypto.randomUUID(), roles: ['ACCOUNTANT'] });

const NOW = new Date('2026-09-14T12:00:00Z');

describe('F-01/F-02 налоги и payroll', () => {
  beforeAll(async () => {
    const ts = Date.now();
    tenantId = (await prisma.tenant.create({ data: { slug: `t-f12-${ts}`, legalName: 'F12', taxId: '300000222' } })).id;
  });
  afterAll(async () => prisma.$disconnect());

  it('F-01: правило → generate (идемпотентен) → calculate (вне коридора → Task) → approve → платёж source=TAX', async () => {
    await upsertTaxRule(lead(), {
      type: 'VAT',
      name: 'НДС',
      recurrence: 'MONTHLY',
      dueDay: 20,
      expectedMinMinor: 100_000_000n,
      expectedMaxMinor: 500_000_000n,
    });
    const created = await generateTaxObligations(tenantId, NOW);
    expect(created).toBeGreaterThanOrEqual(2); // сентябрь (за август) + вперёд
    expect(await generateTaxObligations(tenantId, NOW)).toBe(0); // идемпотентен

    const obligation = (await prisma.taxObligation.findFirst({
      where: { tenantId, type: 'VAT', period: '2026-08' },
    }))!;
    expect(obligation.dueDate.toISOString().slice(0, 10)).toBe('2026-09-20');

    // вне коридора → Task
    await calculateTaxObligation(acct(), obligation.id, 900_000_000n);
    const warn = await prisma.task.findFirst({ where: { tenantId, objectType: 'tax_obligation', objectId: obligation.id } });
    expect(warn?.nextAction).toMatch(/коридора/);
    // пересчёт в коридор
    await calculateTaxObligation(acct(), obligation.id, 300_000_000n);
    await approveTaxObligation(lead(), obligation.id);

    const payment = await createTaxPayment(lead(), obligation.id);
    expect(payment.sourceType).toBe('TAX_OBLIGATION');
    expect(payment.requestedMinor).toBe(300_000_000n);
    await expect(createTaxPayment(lead(), obligation.id)).rejects.toThrow(/уже создан/);
    // FILED только после PAID
    await expect(fileTaxObligation(acct(), obligation.id)).rejects.toThrow(/после оплаты/);
  });

  it('F-01: просрочка → OVERDUE + эскалация; FILED после PAID', async () => {
    await upsertTaxRule(lead(), { type: 'PROPERTY', name: 'Налог на имущество', dueDay: 10 });
    await generateTaxObligations(tenantId, NOW);
    const overdueCount = await markOverdueTaxObligations(tenantId, NOW); // due 10.09 < 14.09
    expect(overdueCount).toBeGreaterThanOrEqual(1);
    const overdue = await prisma.taxObligation.findFirst({ where: { tenantId, type: 'PROPERTY', status: 'OVERDUE' } });
    expect(overdue).not.toBeNull();
    // PAID вручную (симуляция сверки) → FILED
    await prisma.taxObligation.update({ where: { id: overdue!.id }, data: { status: 'PAID' } });
    const filed = await fileTaxObligation(acct(), overdue!.id);
    expect(filed.status).toBe('FILED');
    expect(filed.filedAt).not.toBeNull();
  });

  it('F-02 BR-047: расхождение блокирует CHECKED + Task; чистый реестр → APPROVED → платёж net', async () => {
    await prisma.employee.createMany({
      data: [
        { tenantId, fullName: 'Активный Сотрудник', roleTitle: 'Повар', status: 'ACTIVE' },
        { tenantId, fullName: 'Уволенный Вне Периода', roleTitle: 'Бармен', status: 'TERMINATED', terminatedAt: new Date('2026-07-01') },
        { tenantId, fullName: 'Уволенный В Периоде', roleTitle: 'Официант', status: 'TERMINATED', terminatedAt: new Date('2026-09-05') },
      ],
    });
    const run = await createPayrollRun(lead(), {
      period: '2026-09',
      employeeCount: 3,
      grossMinor: 90_000_000_00n,
      netMinor: 78_000_000_00n,
      taxesMinor: 12_000_000_00n,
    });
    // «мёртвая душа» + уволенный вне периода → fail
    const bad = await checkPayrollRun(lead(), run.id, ['Активный Сотрудник', 'Уволенный Вне Периода', 'Мёртвая Душа']);
    expect(bad.ok).toBe(false);
    expect(bad.discrepancies).toHaveLength(2);
    expect((await prisma.payrollRun.findUnique({ where: { id: run.id } }))!.status).toBe('DRAFT');
    const task = await prisma.task.findFirst({ where: { tenantId, objectType: 'payroll_run', objectId: run.id } });
    expect(task?.nextAction).toMatch(/BR-047/);
    // approve до проверки запрещён
    await expect(approvePayrollRun(lead(), run.id)).rejects.toThrow(/BR-047/);

    const good = await checkPayrollRun(lead(), run.id, ['Активный Сотрудник', 'Уволенный В Периоде']);
    expect(good.ok).toBe(true);
    await approvePayrollRun(lead(), run.id);
    const payment = await createPayrollPayment(lead(), run.id);
    expect(payment.sourceType).toBe('PAYROLL_RUN');
    expect(payment.requestedMinor).toBe(78_000_000_00n);
  });
});
