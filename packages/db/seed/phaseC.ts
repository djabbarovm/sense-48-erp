/**
 * Seed Phase C (docs/10): счета компании, PaymentRequest во всех статусах
 * (exceptions, prepayments), batches по всему циклу, банковские транзакции
 * (matched/suggested/unmatched), advances (включая OVERDUE), выписка-файл
 * seed/bank/2026-09-12.csv (не импортирована — для демо AC-08).
 * Все данные синтетические. Идемпотентен (маркер — PAY-2026-000901).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encryptSecret, maskAccount } from '@finance-os/core';
import type { PrismaClient } from '@prisma/client';

const DEV_BANK_KEY = process.env.BANK_DATA_KEY ?? 'DHqPbmDW3nUOytHplLmVMkP2mSVJlRlXWLh2GYYx4hg='; // только dev

type ControlSnap = { code: string; result: 'PASS' | 'WARN' | 'FAIL'; detail?: string };

const PASS_CONTROLS: ControlSnap[] = [
  { code: 'NO_SOURCE', result: 'PASS' },
  { code: 'UNVERIFIED_BANK', result: 'PASS' },
  { code: 'DUP_PAYMENT_SUSPECT', result: 'PASS' },
  { code: 'OVER_OUTSTANDING', result: 'PASS' },
];

export async function seedPhaseC(prisma: PrismaClient): Promise<void> {
  const rooftop = (await prisma.tenant.findFirst({ where: { slug: 'rooftop-hall' } }))!;
  const sense = (await prisma.tenant.findFirst({ where: { slug: 'sense48' } }))!;
  const ordo = (await prisma.tenant.findFirst({ where: { slug: 'ordo' } }))!;

  const marker = await prisma.paymentRequest.findFirst({
    where: { tenantId: rooftop.id, number: 'PAY-2026-000901' },
  });

  // 1. Счета компании (docs/10: rooftop UZS+USD, sense48, ordo)
  const mkBankAccount = async (tenantId: string, bankName: string, mfo: string, full: string, currency: string, openingMinor: bigint) => {
    const masked = maskAccount(full);
    const existing = await prisma.bankAccount.findFirst({ where: { tenantId, accountMasked: masked } });
    if (existing) return existing;
    return prisma.bankAccount.create({
      data: {
        tenantId,
        bankName,
        mfo,
        accountMasked: masked,
        accountEncrypted: encryptSecret(full, DEV_BANK_KEY),
        currency,
        openingBalanceMinor: openingMinor,
        openingBalanceDate: new Date('2026-08-01'),
      },
    });
  };
  const rhUzs = await mkBankAccount(rooftop.id, 'Трастбанк', '00491', '20208000900000900101', 'UZS', 85_000_000_000n);
  await mkBankAccount(rooftop.id, 'Трастбанк', '00491', '20208840900000900102', 'USD', 1_500_000n);
  const s48Uzs = await mkBankAccount(sense.id, 'Ипак Йули', '00421', '20208000900000480101', 'UZS', 22_000_000_000n);
  await mkBankAccount(ordo.id, 'Капиталбанк', '01088', '20208000900000110101', 'UZS', 40_000_000_000n);
  console.log('  bank accounts: 4');

  if (marker) {
    console.log('  phase C уже насеяна — пропускаю');
    return;
  }

  const users = new Map((await prisma.user.findMany({ select: { id: true, email: true } })).map((u) => [u.email, u.id]));
  const junior = users.get('junior@fos.test')!;
  const lead = users.get('lead@fos.test')!;
  const owner = users.get('owner@rooftop.test')!;
  const docCtrl = users.get('doc@fos.test')!;

  const vendors = new Map(
    (await prisma.vendor.findMany({ where: { tenantId: rooftop.id }, select: { id: true, taxId: true } })).map((v) => [v.taxId, v.id]),
  );
  const accountOf = async (vendorTax: string) =>
    (await prisma.vendorBankAccount.findFirst({ where: { vendorId: vendors.get(vendorTax)!, isDefault: true } }))?.id ?? null;
  const cats = new Map((await prisma.category.findMany({ where: { tenantId: rooftop.id } })).map((c) => [c.code, c.id]));
  const ccs = new Map((await prisma.costCenter.findMany({ where: { tenantId: rooftop.id } })).map((c) => [c.code, c.id]));

  // Источники из Phase B
  const inv118 = (await prisma.invoice.findFirst({ where: { tenantId: rooftop.id, number: '118', status: 'MATCHED' } }))!;
  const inv204 = (await prisma.invoice.findFirst({ where: { tenantId: rooftop.id, number: '204' } }))!;
  const inv88 = (await prisma.invoice.findFirst({ where: { tenantId: rooftop.id, number: '88' } }))!;
  const pr108 = (await prisma.purchaseRequest.findFirst({ where: { tenantId: rooftop.id, number: 'PR-2026-000108' } }))!;
  const contracts = await prisma.contract.findMany({ where: { tenantId: rooftop.id } });
  const contractOf = (vendorTax: string) => contracts.find((c) => c.vendorId === vendors.get(vendorTax));
  const rentContract = contractOf('301000040') ?? contracts[0]!;
  const relatedContract = contractOf('301000041') ?? contracts[0]!;
  const laundryContract = contractOf('301000031') ?? contracts[0]!;

  // 2. PaymentRequests: каждый статус ≥2, exceptions, prepayments
  interface PaySeed {
    n: number;
    source: { type: 'INVOICE' | 'PR' | 'CONTRACT'; id: string };
    vendorTax: string;
    amount: bigint;
    status: string;
    purpose: string;
    controls?: ControlSnap[];
    exception?: { type: string; reason: string };
    prepayment?: boolean;
    urgent?: boolean;
    due?: string;
    cat?: string;
    cc?: string;
  }
  const failUnverified: ControlSnap[] = [
    { code: 'NO_SOURCE', result: 'PASS' },
    { code: 'UNVERIFIED_BANK', result: 'FAIL', detail: 'Счёт получателя не VERIFIED (BR-031)' },
    { code: 'OVER_OUTSTANDING', result: 'PASS' },
  ];
  const failOver: ControlSnap[] = [
    { code: 'NO_SOURCE', result: 'PASS' },
    { code: 'UNVERIFIED_BANK', result: 'PASS' },
    { code: 'OVER_OUTSTANDING', result: 'FAIL', detail: 'Запрошено больше остатка (BR-010)' },
  ];
  const warnRelated: ControlSnap[] = [...PASS_CONTROLS, { code: 'RELATED_PARTY', result: 'WARN', detail: 'Связанная сторона (BR-036)' }];

  const seeds: PaySeed[] = [
    // DRAFT ×2
    { n: 901, source: { type: 'INVOICE', id: inv88.id }, vendorTax: '301000002', amount: 900_000_000n, status: 'DRAFT', purpose: 'Оплата СФ 88 — мясо премиум' },
    { n: 902, source: { type: 'CONTRACT', id: laundryContract.id }, vendorTax: '301000031', amount: 220_000_000n, status: 'DRAFT', purpose: 'Прачечная, сентябрь' },
    // ON_HOLD ×2 (+1 exception уже approved → READY ниже)
    { n: 903, source: { type: 'CONTRACT', id: contractOf('301000010')?.id ?? rentContract.id }, vendorTax: '301000010', amount: 340_000_000n, status: 'ON_HOLD', purpose: 'Бар: поставка сиропов', controls: failUnverified },
    { n: 904, source: { type: 'INVOICE', id: inv204.id }, vendorTax: '301000031', amount: 500_000_000n, status: 'ON_HOLD', purpose: 'Прачечная, доплата сверх остатка', controls: failOver },
    // READY_FOR_BATCH ×3 (905 — exception OVER_OUTSTANDING approved, 907 — urgent)
    { n: 905, source: { type: 'INVOICE', id: inv118.id }, vendorTax: '301000006', amount: 1_250_000_000n, status: 'READY_FOR_BATCH', purpose: 'Оплата СФ 118 — фуд-сервис', exception: { type: 'OVER_OUTSTANDING', reason: 'Согласованная доплата за срочность поставки' } },
    { n: 906, source: { type: 'PR', id: pr108.id }, vendorTax: '301000031', amount: 220_000_000n, status: 'READY_FOR_BATCH', purpose: 'Прачечная за август (PR-108)' },
    { n: 907, source: { type: 'CONTRACT', id: rentContract.id }, vendorTax: '301000040', amount: 150_000_000n, status: 'READY_FOR_BATCH', purpose: 'Срочно: доступ на паркинг для монтажа', urgent: true },
    // REVIEWED batch: IN_BATCH ×2 (одна related party)
    { n: 908, source: { type: 'CONTRACT', id: rentContract.id }, vendorTax: '301000040', amount: 4_500_000_000n, status: 'IN_BATCH', purpose: 'Аренда зала, сентябрь', due: '2026-09-15' },
    { n: 909, source: { type: 'CONTRACT', id: relatedContract.id }, vendorTax: '301000041', amount: 1_800_000_000n, status: 'IN_BATCH', purpose: 'Аренда склада (related party)', controls: warnRelated, due: '2026-09-15' },
    // SENT batch: SENT_TO_BANK ×2 + FAILED ×1
    { n: 910, source: { type: 'CONTRACT', id: contractOf('301000050')?.id ?? rentContract.id }, vendorTax: '301000050', amount: 620_000_000n, status: 'SENT_TO_BANK', purpose: 'Электроэнергия, август' },
    { n: 911, source: { type: 'CONTRACT', id: contractOf('301000030')?.id ?? rentContract.id }, vendorTax: '301000030', amount: 260_000_000n, status: 'SENT_TO_BANK', purpose: 'Клининг, август' },
    { n: 912, source: { type: 'CONTRACT', id: laundryContract.id }, vendorTax: '301000031', amount: 90_000_000n, status: 'FAILED', purpose: 'Возврат: неверный счёт получателя' },
    // SETTLED batch: PAID + RECONCILED (BR-054: создаются SENT, PAID ставится ниже вместе с bank tx)
    { n: 913, source: { type: 'CONTRACT', id: contractOf('301000007')?.id ?? rentContract.id }, vendorTax: '301000007', amount: 2_400_000_000n, status: 'SENT_TO_BANK', purpose: 'Предоплата 50% вино для банкета', prepayment: true },
    { n: 914, source: { type: 'INVOICE', id: inv204.id }, vendorTax: '301000031', amount: 110_000_000n, status: 'SENT_TO_BANK', purpose: 'Прачечная, июль (остаток)' },
    { n: 915, source: { type: 'CONTRACT', id: contractOf('301000050')?.id ?? rentContract.id }, vendorTax: '301000050', amount: 480_000_000n, status: 'SENT_TO_BANK', purpose: 'Водоснабжение, август' },
    // Отклонён и отменён
    { n: 916, source: { type: 'INVOICE', id: inv88.id }, vendorTax: '301000002', amount: 900_000_000n, status: 'REJECTED', purpose: 'Дубль заявки на оплату СФ 88' },
    { n: 917, source: { type: 'CONTRACT', id: laundryContract.id }, vendorTax: '301000031', amount: 45_000_000n, status: 'CANCELLED', purpose: 'Отменено: услуга не оказана' },
    // UNBUDGETED exception ON_HOLD
    { n: 918, source: { type: 'CONTRACT', id: contractOf('301000020')?.id ?? rentContract.id }, vendorTax: '301000020', amount: 700_000_000n, status: 'ON_HOLD', purpose: 'Реклама вне бюджета: коллаборация', controls: [...PASS_CONTROLS, { code: 'UNBUDGETED', result: 'FAIL', detail: 'Нет строки бюджета (BR-014)' }] },
    // Второй prepayment (SENT, ещё не оплачен)
    { n: 919, source: { type: 'CONTRACT', id: contractOf('301000060')?.id ?? rentContract.id }, vendorTax: '301000060', amount: 1_000_000_000n, status: 'SENT_TO_BANK', purpose: 'Предоплата 30% барное оборудование', prepayment: true },
  ];

  const payments = new Map<number, string>();
  for (const s of seeds) {
    const created = await prisma.paymentRequest.create({
      data: {
        tenantId: rooftop.id,
        number: `PAY-2026-${String(s.n).padStart(6, '0')}`,
        sourceType: s.source.type,
        sourceId: s.source.id,
        vendorId: vendors.get(s.vendorTax) ?? null,
        vendorBankAccountId: await accountOf(s.vendorTax),
        requestedMinor: s.amount,
        purposeNote: s.purpose,
        categoryId: s.cat ? (cats.get(s.cat) ?? null) : null,
        costCenterId: s.cc ? (ccs.get(s.cc) ?? null) : null,
        dueDate: s.due ? new Date(s.due) : null,
        isPrepayment: s.prepayment ?? false,
        isUrgent: s.urgent ?? false,
        urgencyReason: s.urgent ? 'EVENT_72H' : null,
        status: s.status as never,
        controlsResult: (s.controls ?? (s.status === 'DRAFT' ? [] : PASS_CONTROLS)) as never,
        ...(s.exception
          ? { exceptionType: s.exception.type as never, exceptionReason: s.exception.reason, exceptionApprovedBy: lead }
          : {}),
        preparedBy: junior,
        createdBy: junior,
        createdAt: new Date('2026-09-08'),
      },
    });
    payments.set(s.n, created.id);
  }
  // Task для заблокированных (как делает submit)
  for (const n of [903, 904, 918]) {
    await prisma.task.create({
      data: {
        tenantId: rooftop.id,
        type: 'REVIEW_EXCEPTION',
        objectType: 'payment_request',
        objectId: payments.get(n)!,
        nextAction: `Платёж PAY-2026-${String(n).padStart(6, '0')} заблокирован контролями. Эскалация: FINANCE_OPS_LEAD`,
        createdBy: junior,
      },
    });
  }
  // Sequence PAY: чтобы новые платежи не пересеклись с сидом
  await prisma.$executeRaw`
    INSERT INTO "sequence" (id, tenant_id, key, year, next_value)
    VALUES (gen_random_uuid(), ${rooftop.id}::uuid, 'PAY', 2026, 1000)
    ON CONFLICT (tenant_id, key, year) DO UPDATE SET next_value = GREATEST("sequence".next_value, 1000)
  `;
  console.log(`  payment requests: ${seeds.length}`);

  // 3. Batches по циклу
  const mkBatch = async (
    number: string,
    date: string | Date,
    status: string,
    itemNs: number[],
    over: Partial<{ type: 'STANDARD' | 'URGENT'; frozenBy: string; reviewedBy: string; summary: object }> = {},
  ) => {
    const items = await prisma.paymentRequest.findMany({ where: { id: { in: itemNs.map((n) => payments.get(n)!) } } });
    const total = items.reduce((sum, i) => sum + i.requestedMinor, 0n);
    const batch = await prisma.paymentBatch.create({
      data: {
        tenantId: rooftop.id,
        number,
        type: over.type ?? 'STANDARD',
        batchDate: typeof date === 'string' ? new Date(date) : date,
        bankAccountId: rhUzs.id,
        status: status as never,
        totalMinor: total,
        count: items.length,
        frozenBy: over.frozenBy ?? null,
        reviewedBy: over.reviewedBy ?? null,
        summary: (over.summary ?? {}) as never,
        createdBy: junior,
      },
    });
    await prisma.paymentRequest.updateMany({ where: { id: { in: items.map((i) => i.id) } }, data: { batchId: batch.id } });
    return batch;
  };
  const summaryFor = (totalMinor: bigint, count: number, extra: Partial<Record<string, unknown>> = {}) => ({
    totalMinor: totalMinor.toString(),
    count,
    byCategory: { '—': totalMinor.toString() },
    byUrgency: { standard: count, urgent: 0 },
    byControl: {},
    cashBeforeMinor: '85000000000',
    cashAfterMinor: (85_000_000_000n - totalMinor).toString(),
    committedNext7dMinor: '0',
    cashWarning: false,
    exceptions: [],
    relatedParty: [],
    ...extra,
  });

  const settled = await mkBatch('BATCH-2026-09-10', '2026-09-10', 'SETTLED', [913, 914, 915], {
    frozenBy: junior,
    reviewedBy: lead,
    summary: summaryFor(2_990_000_000n, 3),
  });
  const sent = await mkBatch('BATCH-2026-09-12', '2026-09-12', 'SENT', [910, 911, 912, 919], {
    frozenBy: junior,
    reviewedBy: lead,
    summary: summaryFor(1_970_000_000n, 4),
  });
  const reviewed = await mkBatch('BATCH-2026-09-13', '2026-09-13', 'REVIEWED', [908, 909], {
    frozenBy: junior,
    reviewedBy: lead,
    summary: summaryFor(6_300_000_000n, 2, {
      byControl: { 'RELATED_PARTY:WARN': 1 },
      relatedParty: ['PAY-2026-000909 → Family Holdings'],
    }),
  });
  await mkBatch(`BATCH-${new Date().toISOString().slice(0, 10)}`, new Date(), 'OPEN', []);
  // approvals история
  await prisma.batchApproval.createMany({
    data: [
      { tenantId: rooftop.id, batchId: settled.id, approverId: lead, role: 'FINANCE_OPS_LEAD', scope: 'BATCH', decision: 'APPROVED', comment: 'review (4-eyes)' },
      ...[913, 914, 915].map((n) => ({ tenantId: rooftop.id, batchId: settled.id, approverId: owner, role: 'OWNER', scope: 'ITEM' as const, paymentRequestId: payments.get(n)!, decision: 'APPROVED' as const })),
      { tenantId: rooftop.id, batchId: sent.id, approverId: lead, role: 'FINANCE_OPS_LEAD', scope: 'BATCH', decision: 'APPROVED', comment: 'review (4-eyes)' },
      ...[910, 911, 912, 919].map((n) => ({ tenantId: rooftop.id, batchId: sent.id, approverId: owner, role: 'OWNER', scope: 'ITEM' as const, paymentRequestId: payments.get(n)!, decision: 'APPROVED' as const })),
      { tenantId: rooftop.id, batchId: reviewed.id, approverId: lead, role: 'FINANCE_OPS_LEAD', scope: 'BATCH', decision: 'APPROVED', comment: 'review (4-eyes)' },
    ],
  });
  console.log('  batches: 4 (SETTLED / SENT / REVIEWED / OPEN)');

  // 4. Банковские транзакции rooftop UZS: дебеты по PAID/RECONCILED + приходы + unmatched/suggested
  const vendorName = new Map(
    (await prisma.vendor.findMany({ where: { tenantId: rooftop.id }, select: { taxId: true, legalName: true } })).map((v) => [v.taxId, v.legalName]),
  );
  const mkTx = async (
    externalId: string,
    date: string,
    amountMinor: bigint,
    name: string,
    purpose: string,
    matchStatus: 'UNMATCHED' | 'AUTO_MATCHED' | 'MANUAL_MATCHED' | 'SUGGESTED' | 'IGNORED',
    taxId?: string,
  ) => {
    return prisma.bankTransaction.create({
      data: {
        tenantId: rooftop.id,
        bankAccountId: rhUzs.id,
        externalId,
        bookingDate: new Date(date),
        valueDate: new Date(date),
        amountMinor,
        counterpartyName: name,
        counterpartyTaxId: taxId ?? null,
        purposeText: purpose,
        matchStatus,
      },
    });
  };
  // Дебеты, закрывающие SETTLED batch: только здесь SENT → PAID/RECONCILED (BR-054)
  const paidPairs: [number, string, string, 'PAID' | 'RECONCILED'][] = [
    [913, 'TB-2026-09-11-101', '301000007', 'PAID'],
    [914, 'TB-2026-09-11-102', '301000031', 'RECONCILED'],
    [915, 'TB-2026-09-11-103', '301000050', 'RECONCILED'],
  ];
  for (const [n, ext, tax, target] of paidPairs) {
    const payment = (await prisma.paymentRequest.findUnique({ where: { id: payments.get(n)! } }))!;
    const tx = await mkTx(ext, '2026-09-11', -payment.requestedMinor, vendorName.get(tax) ?? 'Vendor', `Оплата ${payment.number}`, 'AUTO_MATCHED', tax);
    await prisma.reconciliationMatch.create({
      data: {
        tenantId: rooftop.id,
        bankTransactionId: tx.id,
        objectType: 'PAYMENT_REQUEST',
        objectId: payment.id,
        amountMinor: payment.requestedMinor,
        method: 'AUTO',
        confidence: '0.980',
      },
    });
    await prisma.paymentRequest.update({
      where: { id: payment.id },
      data: { status: target, bankTransactionId: tx.id, paidAt: new Date('2026-09-11') },
    });
  }
  // Приходы (выручка мероприятий) и прочее
  let i = 0;
  for (const [amount, name, purpose] of [
    [5_200_000_000n, 'ООО «Milliy Bank Events»', 'Оплата за корпоратив 06.09'],
    [3_800_000_000n, 'ООО «Digital Hub»', 'Предоплата 50% конференция 20.09'],
    [2_100_000_000n, 'ИП Свадебное агентство «Оқ Кабутар»', 'Доплата банкет 08.09'],
    [1_450_000_000n, 'ООО «PALYM RETAIL»', 'Внутренний перевод'],
  ] as [bigint, string, string][]) {
    await mkTx(`TB-2026-09-0${(i % 8) + 1}-C${i + 1}`, `2026-09-0${(i % 8) + 1}`, amount, name, purpose, 'UNMATCHED');
    i++;
  }
  // SUGGESTED: дебет похож на SENT платёж 910
  const p910 = (await prisma.paymentRequest.findUnique({ where: { id: payments.get(910)! } }))!;
  const suggestedTx = await mkTx('TB-2026-09-13-201', '2026-09-13', -p910.requestedMinor, vendorName.get('301000050') ?? 'Энергосбыт', 'Оплата эл/энергии август', 'SUGGESTED', '301000050');
  await prisma.reconciliationMatch.create({
    data: {
      tenantId: rooftop.id,
      bankTransactionId: suggestedTx.id,
      objectType: 'PAYMENT_REQUEST',
      objectId: p910.id,
      amountMinor: p910.requestedMinor,
      method: 'AUTO',
      confidence: '0.610',
    },
  });
  // Ещё UNMATCHED дебеты (комиссии, эквайринг)
  await mkTx('TB-2026-09-05-301', '2026-09-05', -3_500_000n, 'Трастбанк', 'Комиссия за РКО', 'UNMATCHED');
  await mkTx('TB-2026-09-09-302', '2026-09-09', -18_200_000n, 'UZCARD', 'Комиссия эквайринг', 'UNMATCHED');
  console.log('  bank transactions: 10 (3 matched / 1 suggested / 6 unmatched)');

  // 5. Advances: vendor prepayment (по 913) + 3 employee advance (1 OVERDUE)
  const employees = [] as { id: string; fullName: string }[];
  for (const [name, role] of [
    ['Сотрудник Закупки-1', 'Закупщик'],
    ['Сотрудник Хозчасть-1', 'Завхоз'],
    ['Сотрудник Ивенты-1', 'Координатор мероприятий'],
  ]) {
    const existing = await prisma.employee.findFirst({ where: { tenantId: rooftop.id, fullName: name! } });
    employees.push(existing ?? (await prisma.employee.create({ data: { tenantId: rooftop.id, fullName: name!, roleTitle: role! } })));
  }
  const prepayment = (await prisma.paymentRequest.findUnique({ where: { id: payments.get(913)! } }))!;
  const vendorAdvance = await prisma.advance.create({
    data: {
      tenantId: rooftop.id,
      type: 'VENDOR_PREPAYMENT',
      vendorId: prepayment.vendorId,
      paymentRequestId: prepayment.id,
      amountMinor: prepayment.requestedMinor,
      purpose: prepayment.purposeNote,
      dueDocsDate: new Date('2026-09-25'),
      status: 'OPEN',
      createdBy: junior,
    },
  });
  await prisma.task.create({
    data: {
      tenantId: rooftop.id,
      type: 'CLOSING_DOCS',
      objectType: 'advance',
      objectId: vendorAdvance.id,
      ownerId: docCtrl,
      escalateToId: lead,
      dueAt: new Date('2026-09-25'),
      nextAction: `Получить закрывающие документы по предоплате ${prepayment.number} до 2026-09-25`,
    },
  });
  await prisma.advance.createMany({
    data: [
      { tenantId: rooftop.id, type: 'EMPLOYEE_ADVANCE', employeeId: employees[0]!.id, amountMinor: 500_000_000n, purpose: 'Закупка расходников на рынке', dueDocsDate: new Date('2026-09-20'), status: 'OPEN', createdBy: junior },
      { tenantId: rooftop.id, type: 'EMPLOYEE_ADVANCE', employeeId: employees[1]!.id, amountMinor: 200_000_000n, purpose: 'Хозтовары', dueDocsDate: new Date('2026-09-01'), status: 'OVERDUE', createdBy: junior },
      { tenantId: rooftop.id, type: 'EMPLOYEE_ADVANCE', employeeId: employees[2]!.id, amountMinor: 300_000_000n, purpose: 'Декор для мероприятия 20.09', dueDocsDate: new Date('2026-09-18'), status: 'PARTIALLY_CLOSED', closedMinor: 180_000_000n, createdBy: junior },
    ],
  });
  console.log('  advances: 1 vendor prepayment + 3 employee (1 OVERDUE)');

  // 6. Sense48: пара платежей, чтобы tenant не был пустым
  const senseVendor = await prisma.vendor.findFirst({ where: { tenantId: sense.id } });
  if (senseVendor) {
    const senseContract = await prisma.contract.findFirst({ where: { tenantId: sense.id, vendorId: senseVendor.id } });
    if (senseContract) {
      await prisma.paymentRequest.create({
        data: {
          tenantId: sense.id,
          number: 'PAY-2026-000901',
          sourceType: 'CONTRACT',
          sourceId: senseContract.id,
          vendorId: senseVendor.id,
          requestedMinor: 320_000_000n,
          purposeNote: 'Косметика для SPA, сентябрь',
          status: 'READY_FOR_BATCH',
          controlsResult: PASS_CONTROLS as never,
          preparedBy: junior,
          createdBy: junior,
        },
      });
      void s48Uzs;
    }
  }

  // 7. Выписка-файл (Unified CSV, docs/07 §1) — НЕ импортирована, для демо
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'bank');
  mkdirSync(dir, { recursive: true });
  const csv = [
    'external_id;booking_date;value_date;amount;currency;direction;counterparty_name;counterparty_tax_id;counterparty_account;counterparty_mfo;purpose',
    'TB-2026-09-14-401;2026-09-14;2026-09-14;6200000.00;UZS;OUT;ООО «Ташкент Энергосбыт»;301000050;20208000900000050001;00444;Оплата PAY-2026-000910 эл/энергия август',
    'TB-2026-09-14-402;2026-09-14;2026-09-14;2600000.00;UZS;OUT;ООО «Чистый Город Клининг»;301000030;20208000900000030001;00444;Оплата PAY-2026-000911 клининг август',
    'TB-2026-09-14-403;2026-09-14;2026-09-14;900000.00;UZS;OUT;ООО «Laundry Express»;301000031;20208000900000310001;00444;Возврат PAY-2026-000912 неверные реквизиты',
    'TB-2026-09-14-404;2026-09-14;2026-09-14;10000000.00;UZS;OUT;ООО «Equipment Global»;301000060;20208000900000600001;00555;Предоплата PAY-2026-000919 оборудование',
    'TB-2026-09-14-405;2026-09-14;2026-09-14;4750000.00;UZS;IN;ООО «Event Horizon»;301999999;20208000900009990001;00444;Предоплата корпоратив 28.09',
  ].join('\n');
  writeFileSync(join(dir, '2026-09-12.csv'), csv, 'utf8');
  console.log('  bank statement file: seed/bank/2026-09-12.csv (не импортирована)');
}
