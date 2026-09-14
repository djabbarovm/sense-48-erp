/**
 * G-04: performance-проверка. Создаёт perf-tenant (10k PaymentRequest,
 * 50k BankTransaction, 500 vendors, 2k invoices) и меряет p95 листингов.
 * Запуск: DATABASE_URL=... pnpm exec tsx scripts/perf.ts (из packages/db)
 * Цель: p95 < 500ms на списках.
 */
import { performance } from 'node:perf_hooks';
import { unsafeCreateTenantContext, type TenantContext } from '@finance-os/core';
import { prisma } from '../packages/db/src/client.js';
import { listPayments } from '../packages/db/src/services/payments.js';
import { listBankTransactions } from '../packages/db/src/services/bank.js';
import { getApAging } from '../packages/db/src/services/aging.js';
import { listBatches } from '../packages/db/src/services/batches.js';
import { getCashForecast } from '../packages/db/src/services/forecast.js';
import { computeKpis } from '../packages/db/src/services/kpi.js';

const SLUG = 'perf-10k';

async function ensurePerfTenant(): Promise<string> {
  const existing = await prisma.tenant.findUnique({ where: { slug: SLUG } });
  if (existing) {
    const count = await prisma.paymentRequest.count({ where: { tenantId: existing.id } });
    if (count >= 10_000) {
      console.log(`perf tenant готов (${count} платежей)`);
      return existing.id;
    }
  }
  const tenant = existing ?? (await prisma.tenant.create({ data: { slug: SLUG, legalName: 'PERF', taxId: '399999999' } }));
  const t = tenant.id;
  console.log('Наполняю perf tenant…');

  // 500 vendors
  const vendorRows = Array.from({ length: 500 }, (_, i) => ({
    tenantId: t,
    taxId: String(320_000_000 + i),
    legalName: `PerfVendor ${i}`,
    displayName: `PerfVendor ${i}`,
    status: 'ACTIVE' as const,
  }));
  await prisma.vendor.createMany({ data: vendorRows, skipDuplicates: true });
  const vendors = await prisma.vendor.findMany({ where: { tenantId: t }, select: { id: true } });

  const account = await prisma.bankAccount.upsert({
    where: { id: (await prisma.bankAccount.findFirst({ where: { tenantId: t } }))?.id ?? '00000000-0000-7000-8000-000000000000' },
    create: { tenantId: t, bankName: 'TB', mfo: '00444', accountMasked: '****PERF', accountEncrypted: 'enc', openingBalanceMinor: 1_000_000_000_000n },
    update: {},
  });

  // договор-источник (BR-001)
  const contract = await prisma.contract.create({
    data: { tenantId: t, number: `PERF-${Date.now()}`, counterpartyType: 'VENDOR', vendorId: vendors[0]!.id, subject: 'perf', startDate: new Date('2026-01-01'), status: 'ACTIVE' },
  });

  // 2k invoices
  const existingInvoices = await prisma.invoice.count({ where: { tenantId: t } });
  if (existingInvoices < 2000) {
    for (let chunk = 0; chunk < 4; chunk++) {
      await prisma.invoice.createMany({
        data: Array.from({ length: 500 }, (_, i) => {
          const n = chunk * 500 + i;
          return {
            tenantId: t,
            vendorId: vendors[n % vendors.length]!.id,
            number: `PERF-${n}`,
            date: new Date(Date.UTC(2026, 5 + (n % 4), (n % 27) + 1)),
            type: 'SF' as const,
            amountGrossMinor: BigInt(1_000_000 + n * 1000),
            vatMinor: 0n,
            amountNetMinor: BigInt(1_000_000 + n * 1000),
            status: 'MATCHED' as const,
            matchStatus: 'MATCHED' as const,
          };
        }),
        skipDuplicates: true,
      });
    }
  }

  // 10k payments (батчами по 1000)
  const statuses = ['READY_FOR_BATCH', 'ON_HOLD', 'SUBMITTED', 'SENT_TO_BANK', 'REJECTED', 'CANCELLED'] as const;
  const paymentsNow = await prisma.paymentRequest.count({ where: { tenantId: t } });
  for (let chunk = paymentsNow; chunk < 10_000; chunk += 1000) {
    await prisma.paymentRequest.createMany({
      data: Array.from({ length: 1000 }, (_, i) => {
        const n = chunk + i;
        return {
          tenantId: t,
          number: `PAY-PERF-${String(n).padStart(6, '0')}`,
          sourceType: 'CONTRACT' as const,
          sourceId: contract.id,
          vendorId: vendors[n % vendors.length]!.id,
          requestedMinor: BigInt(100_000 + (n % 997) * 1000),
          purposeNote: `perf payment ${n}`,
          status: statuses[n % statuses.length]!,
          controlsResult: [{ code: 'NO_SOURCE', result: 'PASS' }],
        };
      }),
      skipDuplicates: true,
    });
    process.stdout.write(`\r  payments: ${Math.min(chunk + 1000, 10_000)}/10000`);
  }
  console.log();

  // 50k bank transactions
  const txNow = await prisma.bankTransaction.count({ where: { tenantId: t } });
  for (let chunk = txNow; chunk < 50_000; chunk += 2500) {
    await prisma.bankTransaction.createMany({
      data: Array.from({ length: 2500 }, (_, i) => {
        const n = chunk + i;
        return {
          tenantId: t,
          bankAccountId: account.id,
          externalId: `PERF-TX-${n}`,
          bookingDate: new Date(Date.UTC(2026, n % 9, (n % 27) + 1)),
          valueDate: new Date(Date.UTC(2026, n % 9, (n % 27) + 1)),
          amountMinor: BigInt((n % 2 === 0 ? -1 : 1) * (500_000 + (n % 991) * 100)),
          counterpartyName: `Counterparty ${n % 700}`,
          matchStatus: (n % 10 === 0 ? 'UNMATCHED' : 'AUTO_MATCHED') as never,
        };
      }),
      skipDuplicates: true,
    });
    process.stdout.write(`\r  bank tx: ${Math.min(chunk + 2500, 50_000)}/50000`);
  }
  console.log();
  return t;
}

async function measure(name: string, runs: number, fn: () => Promise<unknown>): Promise<void> {
  const times: number[] = [];
  await fn(); // прогрев
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(runs * 0.5)]!;
  const p95 = times[Math.min(runs - 1, Math.floor(runs * 0.95))]!;
  const verdict = p95 < 500 ? 'OK' : 'SLOW';
  console.log(`  ${name.padEnd(28)} p50 ${p50.toFixed(0).padStart(4)}ms  p95 ${p95.toFixed(0).padStart(4)}ms  ${verdict}`);
}

async function main() {
  const tenantId = await ensurePerfTenant();
  const ctx: TenantContext = unsafeCreateTenantContext({
    tenantId,
    tenantSlug: SLUG,
    userId: crypto.randomUUID(),
    roles: ['OWNER', 'FINANCE_OPS_LEAD'],
  });
  console.log('\nЗамеры (20 прогонов, цель p95 < 500ms):');
  await measure('listPayments (200)', 20, () => listPayments(ctx));
  await measure('listBankTransactions (300)', 20, () => listBankTransactions(ctx));
  await measure('listBatches', 20, () => listBatches(ctx));
  await measure('getApAging', 20, () => getApAging(ctx));
  await measure('getCashForecast (13w)', 20, () => getCashForecast(ctx));
  await measure('computeKpis', 20, () => computeKpis(ctx));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
