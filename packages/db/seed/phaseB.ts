/**
 * Seed Phase B (docs/10): vendors (~30), contracts (~12), budgets 2026-08/09
 * (одна строка перерасходована), PR/PO/Receipt/Invoice в разных статусах,
 * DocumentRequirement, ApprovalPolicy. Идемпотентен (upsert по бизнес-ключам).
 * Все данные синтетические.
 */
import { encryptSecret, maskAccount } from '@finance-os/core';
import type { CounterpartyType, PrismaClient, VendorStatus } from '@prisma/client';
import { seedDefaultRequirements } from '../src/services/documents.js';

const DEV_BANK_KEY = process.env.BANK_DATA_KEY ?? 'DHqPbmDW3nUOytHplLmVMkP2mSVJlRlXWLh2GYYx4hg='; // только dev

interface VendorSeed {
  tax: string;
  name: string;
  status?: VendorStatus;
  flags?: string[];
  currency?: string;
  requiresContract?: boolean;
  secondAccount?: boolean; // вторая запись RETIRED
  category?: string;
}

// rooftop-hall: 12 FNB, 3 marketing, 3 cleaning/laundry, 2 rent (1 related), 2 utilities,
// 2 NEW, 1 BLOCKED, 1 PENDING, 1 BANK_CHANGED; 2 USD
const ROOFTOP_VENDORS: VendorSeed[] = [
  { tax: '301000001', name: 'ООО «Fresh Fruits Tashkent»', category: 'FNB_FOOD' },
  { tax: '301000002', name: 'ООО «Мясной Дом Чорсу»', category: 'FNB_FOOD' },
  { tax: '301000003', name: 'ООО «Sea Product Import»', category: 'FNB_FOOD', currency: 'USD' },
  { tax: '301000004', name: 'ООО «Молочная Ферма Зангиата»', category: 'FNB_FOOD' },
  { tax: '301000005', name: 'ООО «Bakery Craft»', category: 'FNB_FOOD' },
  { tax: '301000006', name: 'ООО «Ташкент Фуд Сервис»', category: 'FNB_FOOD', secondAccount: true },
  { tax: '301000007', name: 'ООО «Wine & Spirits UZ»', category: 'FNB_BEVERAGE', requiresContract: true },
  { tax: '301000008', name: 'ООО «Coffee Roasters Sila»', category: 'FNB_BEVERAGE' },
  { tax: '301000009', name: 'ООО «Aqua Premium»', category: 'FNB_BEVERAGE' },
  { tax: '301000010', name: 'ООО «Bar Supply Pro»', category: 'FNB_BEVERAGE', flags: ['BANK_CHANGED_RECENTLY'], secondAccount: true },
  { tax: '301000011', name: 'ООО «Спец Продукт»', category: 'FNB_FOOD', status: 'BLOCKED' },
  { tax: '301000012', name: 'ООО «Новый Кейтеринг»', category: 'FNB_FOOD', flags: ['NEW'], status: 'PENDING_VERIFICATION' },
  { tax: '301000020', name: 'ООО «Digital Reklama»', category: 'MARKETING' },
  { tax: '301000021', name: 'ООО «Event Media Group»', category: 'MARKETING', flags: ['NEW'] },
  { tax: '301000022', name: 'ИП Каримова PR Studio', category: 'MARKETING' },
  { tax: '301000030', name: 'ООО «Чистый Город Клининг»', category: 'CLEANING' },
  { tax: '301000031', name: 'ООО «Laundry Express»', category: 'LINEN_LAUNDRY', requiresContract: true },
  { tax: '301000032', name: 'ООО «Химчистка Люкс»', category: 'LINEN_LAUNDRY' },
  { tax: '301000040', name: 'ООО «Tower Property»', category: 'RENT', requiresContract: true },
  { tax: '301000041', name: 'ООО «Family Holdings»', category: 'RENT', flags: ['RELATED_PARTY'], requiresContract: true },
  { tax: '301000050', name: 'АО «Ташкент Энергосбыт»', category: 'UTILITIES' },
  { tax: '301000051', name: 'ООО «Сувсоз Сервис»', category: 'UTILITIES' },
  { tax: '301000060', name: 'ООО «Equipment Global»', category: 'CAPEX', currency: 'USD', requiresContract: true, secondAccount: true },
];

const SENSE48_VENDORS: VendorSeed[] = [
  { tax: '302000001', name: 'ООО «SPA Cosmetics Asia»', category: 'SPA_CONSUMABLES' },
  { tax: '302000002', name: 'ООО «Thai Oils Import»', category: 'SPA_CONSUMABLES' },
  { tax: '302000003', name: 'ООО «Beauty Retail Group»', category: 'SPA_RETAIL' },
  { tax: '302000004', name: 'ООО «Wellness Equipment»', category: 'SPA_CONSUMABLES' },
];

const ORDO_VENDORS: VendorSeed[] = [
  { tax: '311000001', name: 'ООО «FM Solutions»', category: 'FM_SERVICES', requiresContract: true },
  { tax: '311000002', name: 'ООО «Лифт Сервис Групп»', category: 'REPAIR' },
  { tax: '311000003', name: 'ООО «Секьюрити Профи»', category: 'SECURITY' },
];

function accountFor(tax: string, suffix: string): string {
  return `2020800090${tax.slice(-6)}${suffix}`.slice(0, 20).padEnd(20, '0');
}

async function seedVendors(prisma: PrismaClient, tenantId: string, vendors: VendorSeed[], categories: Map<string, string>) {
  const ids = new Map<string, string>();
  for (const v of vendors) {
    const vendor = await prisma.vendor.upsert({
      where: { id: (await prisma.vendor.findFirst({ where: { tenantId, taxId: v.tax } }))?.id ?? '00000000-0000-7000-8000-000000000000' },
      create: {
        tenantId,
        taxId: v.tax,
        legalName: v.name,
        displayName: v.name.replace(/^ООО «|»$/g, '').replace(/^АО «|^ИП /g, ''),
        status: v.status ?? 'ACTIVE',
        riskFlags: v.flags ?? [],
        requiresContract: v.requiresContract ?? false,
        categoryDefaultId: v.category ? (categories.get(v.category) ?? null) : null,
        vatPayer: true,
      },
      update: { riskFlags: v.flags ?? [], status: v.status ?? 'ACTIVE' },
    });
    ids.set(v.tax, vendor.id);
    const currency = v.currency ?? 'UZS';
    const mainAcc = accountFor(v.tax, '01');
    const existingAccounts = await prisma.vendorBankAccount.count({ where: { vendorId: vendor.id } });
    if (existingAccounts === 0) {
      if (v.secondAccount) {
        await prisma.vendorBankAccount.create({
          data: {
            tenantId,
            vendorId: vendor.id,
            bankName: 'Trustbank',
            mfo: '00444',
            accountMasked: maskAccount(accountFor(v.tax, '00')),
            accountEncrypted: encryptSecret(accountFor(v.tax, '00'), DEV_BANK_KEY),
            currency,
            status: 'RETIRED',
          },
        });
      }
      await prisma.vendorBankAccount.create({
        data: {
          tenantId,
          vendorId: vendor.id,
          bankName: v.secondAccount ? 'DIBank' : 'Trustbank',
          mfo: v.secondAccount ? '00555' : '00444',
          accountMasked: maskAccount(mainAcc),
          accountEncrypted: encryptSecret(mainAcc, DEV_BANK_KEY),
          currency,
          status: v.status === 'PENDING_VERIFICATION' || v.flags?.includes('BANK_CHANGED_RECENTLY') ? 'UNVERIFIED' : 'VERIFIED',
          isDefault: !(v.status === 'PENDING_VERIFICATION' || v.flags?.includes('BANK_CHANGED_RECENTLY')),
          ...(v.status !== 'PENDING_VERIFICATION' && !v.flags?.includes('BANK_CHANGED_RECENTLY')
            ? { verifiedAt: new Date('2026-07-01'), verificationMethod: 'CALLBACK' as const }
            : {}),
        },
      });
    }
  }
  return ids;
}

export async function seedPhaseB(prisma: PrismaClient): Promise<void> {
  const tenants = await prisma.tenant.findMany({ where: { slug: { in: ['rooftop-hall', 'sense48', 'ordo'] } } });
  const bySlug = new Map(tenants.map((t) => [t.slug, t]));
  const rooftop = bySlug.get('rooftop-hall')!;
  const sense = bySlug.get('sense48')!;
  const ordo = bySlug.get('ordo')!;

  // Справочники per tenant
  const catMap = async (tenantId: string) =>
    new Map((await prisma.category.findMany({ where: { tenantId } })).map((c) => [c.code, c.id]));
  const ccMap = async (tenantId: string) =>
    new Map((await prisma.costCenter.findMany({ where: { tenantId } })).map((c) => [c.code, c.id]));

  const rooftopCats = await catMap(rooftop.id);
  const rooftopCcs = await ccMap(rooftop.id);

  // 1. ApprovalPolicy (D-12 default) + DocumentRequirements
  for (const t of tenants) {
    const hasPolicy = await prisma.approvalPolicy.count({ where: { tenantId: t.id } });
    if (hasPolicy === 0) {
      await prisma.approvalPolicy.create({
        data: {
          tenantId: t.id,
          tier1MaxMinor: 500_000_000n,
          tier2MaxMinor: 2_500_000_000n,
          newVendorOwnerThresholdMinor: 100_000_000n,
          effectiveFrom: new Date('2026-07-01'),
        },
      });
    }
    await seedDefaultRequirements(t.id);
  }
  console.log('  policies + document requirements');

  // 2. Vendors
  const rooftopVendorIds = await seedVendors(prisma, rooftop.id, ROOFTOP_VENDORS, rooftopCats);
  await seedVendors(prisma, sense.id, SENSE48_VENDORS, await catMap(sense.id));
  const ordoVendorIds = await seedVendors(prisma, ordo.id, ORDO_VENDORS, await catMap(ordo.id));
  console.log(`  vendors: ${ROOFTOP_VENDORS.length + SENSE48_VENDORS.length + ORDO_VENDORS.length}`);

  // 3. Contracts (~12)
  const mkContract = async (
    tenantId: string,
    number: string,
    vendorId: string,
    subject: string,
    opts: Partial<{
      limit: bigint;
      currency: string;
      status: string;
      endDate: string;
      registrationRequired: boolean;
      terms: { type: string; value: number };
      fxRate: string;
    }> = {},
  ) => {
    const existing = await prisma.contract.findFirst({ where: { tenantId, number } });
    if (existing) return existing;
    return prisma.contract.create({
      data: {
        tenantId,
        number,
        counterpartyType: 'VENDOR' as CounterpartyType,
        vendorId,
        subject,
        currency: opts.currency ?? 'UZS',
        fxRate: opts.fxRate ?? null,
        limitMinor: opts.limit ?? null,
        startDate: new Date('2026-01-15'),
        endDate: opts.endDate ? new Date(opts.endDate) : new Date('2026-12-31'),
        registrationRequired: opts.registrationRequired ?? false,
        registeredAt: opts.registrationRequired ? new Date('2026-02-01') : null,
        paymentTerms: opts.terms ?? { type: 'POSTPAY_DAYS', value: 14 },
        status: (opts.status ?? 'ACTIVE') as never,
      },
    });
  };

  const expiring = new Date();
  expiring.setDate(expiring.getDate() + 20);

  await mkContract(rooftop.id, '12/2026', rooftopVendorIds.get('301000006')!, 'Поставка продуктов', {
    limit: 5_000_000_000n,
    terms: { type: 'POSTPAY_DAYS', value: 14 },
  });
  await mkContract(rooftop.id, '14/2026', rooftopVendorIds.get('301000001')!, 'Поставка фруктов и овощей', {
    limit: 2_000_000_000n,
    terms: { type: 'POSTPAY_DAYS', value: 7 },
  });
  await mkContract(rooftop.id, '15/2026', rooftopVendorIds.get('301000002')!, 'Поставка мяса', {
    limit: 3_000_000_000n,
    terms: { type: 'POSTPAY_DAYS', value: 7 },
  });
  await mkContract(rooftop.id, '17/2026', rooftopVendorIds.get('301000007')!, 'Поставка алкогольной продукции', {
    limit: 4_000_000_000n,
    terms: { type: 'POSTPAY_DAYS', value: 14 },
  });
  await mkContract(rooftop.id, '19/2026', rooftopVendorIds.get('301000004')!, 'Молочная продукция', {
    limit: 800_000_000n,
    terms: { type: 'POSTPAY_DAYS', value: 7 },
  });
  await mkContract(rooftop.id, '21/2026', rooftopVendorIds.get('301000008')!, 'Кофе и чай', {
    limit: 500_000_000n,
    terms: { type: 'POSTPAY_DAYS', value: 14 },
  });
  await mkContract(rooftop.id, 'АР-48/2025', rooftopVendorIds.get('301000040')!, 'Аренда 48 этажа', {
    registrationRequired: true,
    terms: { type: 'SCHEDULE', value: 0 },
  });
  await mkContract(rooftop.id, 'АР-СТ/2026', rooftopVendorIds.get('301000041')!, 'Smart Teams Rent', {
    status: 'EXPIRING',
    endDate: expiring.toISOString().slice(0, 10),
    terms: { type: 'SCHEDULE', value: 0 },
  });
  await mkContract(rooftop.id, 'М-07/2026', rooftopVendorIds.get('301000020')!, 'Маркетинговое сопровождение', {
    terms: { type: 'PREPAY_PCT', value: 50 },
  });
  await mkContract(rooftop.id, 'ПР-03/2026', rooftopVendorIds.get('301000031')!, 'Прачечные услуги', {
    terms: { type: 'SCHEDULE', value: 0 },
  });
  await mkContract(rooftop.id, 'CAPEX-USD-01', rooftopVendorIds.get('301000060')!, 'Кухонное оборудование (USD)', {
    currency: 'USD',
    fxRate: '12800.000000',
    limit: 12_000_000n, // 120 000 USD в центах
    terms: { type: 'PREPAY_PCT', value: 30 },
  });
  await mkContract(ordo.id, 'FM-01/2026', ordoVendorIds.get('311000001')!, 'FM-обслуживание Tower', {
    limit: 6_000_000_000n,
    terms: { type: 'POSTPAY_DAYS', value: 30 },
  });
  console.log('  contracts: 12');

  // 4. Budgets 2026-08 и 2026-09 (RH-BAR/FNB_BEVERAGE сентябрь — перерасход)
  const budgetLines: [string, string, bigint][] = [
    ['RH-KITCHEN', 'FNB_FOOD', 25_000_000_00n * 100n],
    ['RH-BAR', 'FNB_BEVERAGE', 8_000_000_00n * 100n],
    ['RH-EVENTS', 'DECOR_AV', 5_000_000_00n * 100n],
    ['RH-ADMIN', 'ADMIN', 3_000_000_00n * 100n],
    ['SHARED', 'MARKETING', 10_000_000_00n * 100n],
    ['SHARED', 'RENT', 40_000_000_00n * 100n],
    ['SHARED', 'UTILITIES', 6_000_000_00n * 100n],
    ['SHARED', 'CLEANING', 4_000_000_00n * 100n],
  ];
  for (const period of ['2026-08', '2026-09']) {
    for (const [cc, cat, planned] of budgetLines) {
      const costCenterId = rooftopCcs.get(cc);
      const categoryId = rooftopCats.get(cat);
      if (!costCenterId || !categoryId) continue;
      await prisma.budget.upsert({
        where: {
          tenantId_period_costCenterId_categoryId: { tenantId: rooftop.id, period, costCenterId, categoryId },
        },
        create: { tenantId: rooftop.id, period, costCenterId, categoryId, plannedMinor: planned },
        update: {},
      });
    }
  }
  console.log('  budgets: 2026-08, 2026-09');

  // 5. P2P объекты (представительный набор статусов)
  const users = new Map(
    (await prisma.user.findMany({ select: { id: true, email: true } })).map((u) => [u.email, u.id]),
  );
  const chef = users.get('chef@rooftop.test')!;
  const junior = users.get('junior@fos.test')!;

  interface PrSeed {
    n: number;
    what: string;
    cc: string;
    cat: string;
    total: bigint;
    status: string;
    vendorTax?: string;
    urgent?: boolean;
    tier?: number;
    budget?: string;
  }
  const prSeeds: PrSeed[] = [
    { n: 101, what: 'Лосось охлаждённый 40 кг', cc: 'RH-KITCHEN', cat: 'FNB_FOOD', total: 800_000_000n, status: 'DRAFT', vendorTax: '301000003' },
    { n: 102, what: 'Овощи и зелень на неделю', cc: 'RH-KITCHEN', cat: 'FNB_FOOD', total: 350_000_000n, status: 'SUBMITTED', vendorTax: '301000001', tier: 1, budget: 'WITHIN' },
    { n: 103, what: 'Вино для банкета 27.09', cc: 'RH-BAR', cat: 'FNB_BEVERAGE', total: 1_200_000_000n, status: 'SUBMITTED', vendorTax: '301000007', tier: 2, budget: 'OVER' },
    { n: 104, what: 'Мясо премиум 60 кг', cc: 'RH-KITCHEN', cat: 'FNB_FOOD', total: 900_000_000n, status: 'APPROVED', vendorTax: '301000002', tier: 2, budget: 'WITHIN' },
    { n: 105, what: 'Кофе зерновой 30 кг', cc: 'RH-BAR', cat: 'FNB_BEVERAGE', total: 150_000_000n, status: 'APPROVED', vendorTax: '301000008', tier: 1, budget: 'WITHIN' },
    { n: 106, what: 'SMM-кампания сентябрь', cc: 'SHARED', cat: 'MARKETING', total: 600_000_000n, status: 'ORDERED', vendorTax: '301000020', tier: 2, budget: 'WITHIN' },
    { n: 107, what: 'Молочная продукция', cc: 'RH-KITCHEN', cat: 'FNB_FOOD', total: 120_000_000n, status: 'RECEIVED', vendorTax: '301000004', tier: 1, budget: 'WITHIN' },
    { n: 108, what: 'Прачечная за август', cc: 'SHARED', cat: 'CLEANING', total: 220_000_000n, status: 'INVOICED', vendorTax: '301000031', tier: 1, budget: 'WITHIN' },
    { n: 109, what: 'Декор сцены', cc: 'RH-EVENTS', cat: 'DECOR_AV', total: 450_000_000n, status: 'REJECTED', vendorTax: '301000021', tier: 1 },
    { n: 110, what: 'Канцтовары офис', cc: 'RH-ADMIN', cat: 'ADMIN', total: 80_000_000n, status: 'REJECTED' },
    { n: 111, what: 'Срочный ремонт холодильника', cc: 'RH-KITCHEN', cat: 'REPAIR', total: 300_000_000n, status: 'SUBMITTED', urgent: true, tier: 1, budget: 'WITHIN' },
    { n: 112, what: 'Срочная закупка льда (жара)', cc: 'RH-BAR', cat: 'FNB_BEVERAGE', total: 50_000_000n, status: 'APPROVED', vendorTax: '301000009', urgent: true, tier: 1, budget: 'WITHIN' },
    { n: 113, what: 'Новое оборудование бара', cc: 'RH-BAR', cat: 'CAPEX', total: 3_000_000_000n, status: 'SUBMITTED', vendorTax: '301000060', tier: 3, budget: 'UNBUDGETED' },
    { n: 114, what: 'Уборка после мероприятия', cc: 'RH-EVENTS', cat: 'CLEANING', total: 90_000_000n, status: 'CANCELLED', vendorTax: '301000030' },
  ];

  for (const p of prSeeds) {
    const number = `PR-2026-${String(p.n).padStart(6, '0')}`;
    const exists = await prisma.purchaseRequest.findFirst({ where: { tenantId: rooftop.id, number } });
    if (exists) continue;
    const vendorId = p.vendorTax ? (rooftopVendorIds.get(p.vendorTax) ?? null) : null;
    const pr = await prisma.purchaseRequest.create({
      data: {
        tenantId: rooftop.id,
        number,
        requesterId: chef,
        what: p.what,
        purpose: 'Операционная деятельность Rooftop Hall',
        totalMinor: p.total,
        costCenterId: rooftopCcs.get(p.cc)!,
        categoryId: rooftopCats.get(p.cat)!,
        vendorId,
        status: p.status as never,
        isUrgent: p.urgent ?? false,
        urgencyReason: p.urgent ? 'SUPPLIER_STOP' : null,
        tier: p.tier ?? null,
        budgetStatus: (p.budget as never) ?? null,
        varianceReason: p.tier === 3 ? 'Замена вышедшего из строя оборудования' : null,
        createdAt: new Date('2026-09-05'),
      },
    });
    // approvals для SUBMITTED
    if (p.status === 'SUBMITTED') {
      await prisma.purchaseApproval.createMany({
        data: [
          { tenantId: rooftop.id, prId: pr.id, role: 'BUSINESS_OWNER' },
          { tenantId: rooftop.id, prId: pr.id, role: 'FINANCE' },
          ...(p.tier && p.tier >= 2 ? [{ tenantId: rooftop.id, prId: pr.id, role: 'OWNER' }] : []),
        ],
      });
    }
    // PO для ORDERED+, receipt для RECEIVED/INVOICED
    if (['ORDERED', 'RECEIVED', 'INVOICED'].includes(p.status) && vendorId) {
      await prisma.purchaseOrder.create({
        data: {
          tenantId: rooftop.id,
          number: `PO-2026-${String(p.n).padStart(6, '0')}`,
          prId: pr.id,
          vendorId,
          totalMinor: p.total,
          status: 'CONFIRMED',
        },
      });
    }
    if (['RECEIVED', 'INVOICED'].includes(p.status)) {
      await prisma.receipt.create({
        data: { tenantId: rooftop.id, prId: pr.id, receiverId: junior, status: 'FULL' },
      });
    }
  }
  console.log(`  purchase requests: ${prSeeds.length}`);

  // 6. Invoices в разных статусах
  interface InvSeed {
    num: string;
    vendorTax: string;
    gross: bigint;
    status: string;
    date?: string;
    edo?: string;
  }
  const invSeeds: InvSeed[] = [
    { num: '118', vendorTax: '301000006', gross: 1_250_000_000n, status: 'MATCHED', edo: 'SIGNED' },
    { num: '119', vendorTax: '301000001', gross: 350_000_000n, status: 'RECEIVED', edo: 'SIGNED' },
    { num: '204', vendorTax: '301000031', gross: 220_000_000n, status: 'MATCHED', edo: 'SIGNED' },
    { num: '88', vendorTax: '301000002', gross: 900_000_000n, status: 'RECEIVED' },
    { num: '89', vendorTax: '301000004', gross: 120_000_000n, status: 'DISPUTED' },
    { num: '90', vendorTax: '301000020', gross: 300_000_000n, status: 'CORRECTED', edo: 'CORRECTED' },
    { num: '91', vendorTax: '301000008', gross: 150_000_000n, status: 'CANCELLED', edo: 'CANCELLED' },
  ];
  for (const inv of invSeeds) {
    const vendorId = rooftopVendorIds.get(inv.vendorTax)!;
    const exists = await prisma.invoice.findFirst({
      where: { tenantId: rooftop.id, vendorId, number: inv.num },
    });
    if (exists) continue;
    const gross = inv.gross;
    const vat = (gross * 1200n) / 11200n;
    await prisma.invoice.create({
      data: {
        tenantId: rooftop.id,
        vendorId,
        number: inv.num,
        date: new Date(inv.date ?? '2026-09-08'),
        type: 'SF',
        amountGrossMinor: gross,
        vatMinor: vat,
        amountNetMinor: gross - vat,
        status: inv.status as never,
        matchStatus: inv.status === 'MATCHED' ? 'MATCHED' : inv.status === 'DISPUTED' ? 'DISPUTED' : 'UNMATCHED',
        edoStatus: (inv.edo as never) ?? 'NONE',
        edoDocumentId: inv.edo ? `DX-SEED-${inv.num}` : null,
      },
    });
  }
  // дубликат для AC-04: тот же vendor+number+date
  const dupVendor = rooftopVendorIds.get('301000006')!;
  const original = await prisma.invoice.findFirst({
    where: { tenantId: rooftop.id, vendorId: dupVendor, number: '118', duplicateOfId: null },
  });
  const dupExists = await prisma.invoice.findFirst({
    where: { tenantId: rooftop.id, vendorId: dupVendor, number: '118', status: 'DUPLICATE_SUSPECT' },
  });
  if (original && !dupExists) {
    const dup = await prisma.invoice.create({
      data: {
        tenantId: rooftop.id,
        vendorId: dupVendor,
        number: '118',
        date: original.date,
        type: 'SF',
        amountGrossMinor: original.amountGrossMinor,
        vatMinor: original.vatMinor,
        amountNetMinor: original.amountNetMinor,
        status: 'DUPLICATE_SUSPECT',
        duplicateOfId: original.id,
      },
    });
    await prisma.task.create({
      data: {
        tenantId: rooftop.id,
        type: 'REVIEW_EXCEPTION',
        objectType: 'invoice',
        objectId: dup.id,
        nextAction: 'Проверить дубликат СФ 118: возможно повторная выставка',
      },
    });
  }
  console.log(`  invoices: ${invSeeds.length} + 1 duplicate`);
}
