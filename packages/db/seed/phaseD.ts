/**
 * Seed Phase D (docs/10): клиенты и события Rooftop (депозиты, budget lines для
 * fast lane), дебиторка (issued/partially/overdue/disputed/paid), cash plan
 * (кредит 15 млн ежемесячно, capex 40 млн в октябре). Синтетика, идемпотентен.
 */
import type { PrismaClient } from '@prisma/client';

export async function seedPhaseD(prisma: PrismaClient): Promise<void> {
  const rooftop = (await prisma.tenant.findFirst({ where: { slug: 'rooftop-hall' } }))!;
  const t = rooftop.id;

  const marker = await prisma.event.findFirst({ where: { tenantId: t, number: 'EVT-2026-0901' } });
  if (marker) {
    console.log('  phase D уже насеяна — пропускаю');
    return;
  }

  const users = new Map((await prisma.user.findMany({ select: { id: true, email: true } })).map((u) => [u.email, u.id]));
  const sales = users.get('sales@rooftop.test')!;
  const junior = users.get('junior@fos.test')!;
  const cats = new Map((await prisma.category.findMany({ where: { tenantId: t } })).map((c) => [c.code, c.id]));
  const ccs = new Map((await prisma.costCenter.findMany({ where: { tenantId: t } })).map((c) => [c.code, c.id]));
  const vendors = new Map((await prisma.vendor.findMany({ where: { tenantId: t } })).map((v) => [v.taxId, v.id]));

  // 1. Клиенты
  const customerSeeds = [
    { tax: '201000001', name: 'ООО «Milliy Bank Events»', terms: 5, limit: 100_000_000_00n },
    { tax: '201000002', name: 'ООО «Digital Hub»', terms: 10, limit: 80_000_000_00n },
    { tax: '201000003', name: 'ИП Свадебное агентство «Оқ Кабутар»', terms: 0, limit: null },
    { tax: '201000004', name: 'ООО «Event Horizon»', terms: 7, limit: 60_000_000_00n },
    { tax: '201000005', name: 'ООО «Corporate Travel UZ»', terms: 14, limit: 50_000_000_00n },
  ];
  const customers = new Map<string, string>();
  for (const c of customerSeeds) {
    const existing = await prisma.customer.findFirst({ where: { tenantId: t, taxId: c.tax } });
    const row =
      existing ??
      (await prisma.customer.create({
        data: {
          tenantId: t,
          taxId: c.tax,
          legalName: c.name,
          paymentTermsDays: c.terms,
          creditLimitMinor: c.limit,
          arOwnerId: sales,
        },
      }));
    customers.set(c.tax, row.id);
  }
  console.log(`  customers: ${customerSeeds.length}`);

  // 2. События (EVT-2026-09xx)
  const evCc = ccs.get('RH-EVENTS') ?? null;
  const mkEvent = async (
    n: number,
    name: string,
    date: string,
    status: string,
    customerTax: string,
    revenue: bigint,
    deposit: { pct: number; received?: bigint },
    over: Partial<{ guestsPlanned: number; guestsActual: number }> = {},
  ) => {
    return prisma.event.create({
      data: {
        tenantId: t,
        number: `EVT-2026-0${n}`,
        name,
        eventDate: new Date(date),
        format: 'BANQUET',
        customerId: customers.get(customerTax)!,
        revenueBudgetMinor: revenue,
        revenueLines: { venue_fee: (revenue / 3n).toString(), catering: (revenue / 2n).toString(), bar: (revenue / 6n).toString() },
        depositSchedule: [
          {
            pct: deposit.pct,
            due_date: date,
            ...(deposit.received ? { received_minor: deposit.received.toString(), received_at: new Date().toISOString() } : {}),
          },
        ],
        costCenterId: evCc,
        ownerId: sales,
        status: status as never,
        guestsPlanned: over.guestsPlanned ?? 100,
        guestsActual: over.guestsActual ?? null,
        createdBy: sales,
      },
    });
  };
  const closed = await mkEvent(901, 'Корпоратив Milliy Bank', '2026-09-06', 'CLOSED', '201000001', 52_000_000_00n, { pct: 50, received: 26_000_000_00n }, { guestsActual: 180 });
  const settling = await mkEvent(902, 'Банкет «Оқ Кабутар»', '2026-09-08', 'SETTLING', '201000003', 42_000_000_00n, { pct: 30, received: 12_600_000_00n }, { guestsActual: 140 });
  const confirmed = await mkEvent(903, 'Конференция Digital Hub', '2026-09-20', 'CONFIRMED', '201000002', 76_000_000_00n, { pct: 50, received: 38_000_000_00n }, { guestsPlanned: 250 });
  const quoted = await mkEvent(904, 'Свадьба 04.10', '2026-10-04', 'QUOTED', '201000004', 65_000_000_00n, { pct: 30 });
  // budget lines (fast lane): approved vendors для CONFIRMED события
  const lineSpecs: [string, string, bigint, string[]][] = [
    [confirmed.id, 'FNB_FOOD', 18_000_000_00n, ['301000001', '301000002']],
    [confirmed.id, 'FNB_BEVERAGE', 9_000_000_00n, ['301000007', '301000008']],
    [confirmed.id, 'DECOR_AV', 7_000_000_00n, []],
    [settling.id, 'FNB_FOOD', 14_000_000_00n, ['301000001']],
    [quoted.id, 'FNB_FOOD', 16_000_000_00n, []],
  ];
  for (const [eventId, cat, planned, vendorTaxes] of lineSpecs) {
    const categoryId = cats.get(cat);
    if (!categoryId) continue;
    await prisma.eventBudgetLine.create({
      data: {
        tenantId: t,
        eventId,
        categoryId,
        plannedMinor: planned,
        approvedVendorIds: vendorTaxes.map((tax) => vendors.get(tax)).filter((v): v is string => !!v),
      },
    });
  }
  await prisma.event.update({ where: { id: confirmed.id }, data: { costBudgetMinor: 34_000_000_00n } });
  await prisma.event.update({ where: { id: settling.id }, data: { costBudgetMinor: 14_000_000_00n } });
  console.log('  events: 4 (CLOSED / SETTLING / CONFIRMED / QUOTED) + budget lines');

  // 3. Дебиторка (CINV-2026-09xx)
  const mkCinv = async (
    n: number,
    customerTax: string,
    date: string,
    due: string,
    gross: bigint,
    status: string,
    over: Partial<{ received: bigint; eventId: string; promise: string; dispute: string }> = {},
  ) => {
    return prisma.customerInvoice.create({
      data: {
        tenantId: t,
        number: `CINV-2026-0009${n}`,
        customerId: customers.get(customerTax)!,
        date: new Date(date),
        dueDate: new Date(due),
        amountGrossMinor: gross,
        receivedMinor: over.received ?? 0n,
        status: status as never,
        eventId: over.eventId ?? null,
        promiseToPayDate: over.promise ? new Date(over.promise) : null,
        disputeReason: over.dispute ?? null,
        createdBy: junior,
      },
    });
  };
  await mkCinv(1, '201000001', '2026-09-06', '2026-09-11', 26_000_000_00n, 'PAID', { received: 26_000_000_00n, eventId: closed.id });
  await mkCinv(2, '201000003', '2026-09-08', '2026-09-08', 29_400_000_00n, 'PARTIALLY_PAID', { received: 21_000_000_00n, eventId: settling.id, promise: '2026-09-18' });
  await mkCinv(3, '201000002', '2026-09-20', '2026-09-30', 38_000_000_00n, 'ISSUED', { eventId: confirmed.id });
  await mkCinv(4, '201000005', '2026-08-10', '2026-08-24', 18_500_000_00n, 'OVERDUE', { promise: '2026-09-19' });
  await mkCinv(5, '201000004', '2026-08-20', '2026-08-27', 9_800_000_00n, 'DISPUTED', { dispute: 'Клиент оспаривает количество гостей' });
  // sequence CINV за сидом
  await prisma.$executeRaw`
    INSERT INTO "sequence" (id, tenant_id, key, year, next_value)
    VALUES (gen_random_uuid(), ${t}::uuid, 'CINV', 2026, 9100)
    ON CONFLICT (tenant_id, key, year) DO UPDATE SET next_value = GREATEST("sequence".next_value, 9100)
  `;
  await prisma.$executeRaw`
    INSERT INTO "sequence" (id, tenant_id, key, year, next_value)
    VALUES (gen_random_uuid(), ${t}::uuid, 'EVT', 2026, 950)
    ON CONFLICT (tenant_id, key, year) DO UPDATE SET next_value = GREATEST("sequence".next_value, 950)
  `;
  console.log('  customer invoices: 5 (PAID/PARTIAL/ISSUED/OVERDUE/DISPUTED)');

  // 4. Cash plan (docs/10: кредит 15 млн ежемесячно, capex 40 млн октябрь)
  await prisma.cashPlanLine.createMany({
    data: [
      { tenantId: t, name: 'Погашение кредита Трастбанк', type: 'LOAN_REPAYMENT', amountMinor: -15_000_000_00n, dueDate: new Date('2026-09-15'), recurrence: 'MONTHLY', createdBy: junior },
      { tenantId: t, name: 'Capex: барное оборудование (70%)', type: 'CAPEX', amountMinor: -40_000_000_00n, dueDate: new Date('2026-10-10'), createdBy: junior },
    ],
  });
  console.log('  cash plan: кредит monthly + capex октябрь');
}
