/**
 * Seed Phase A (docs/10): tenants, users+roles, cost centers, categories,
 * holidays 2026, permissions. Идемпотентен (upsert), синтетические данные.
 */
import { hashPassword } from '@finance-os/core';
import type { CategoryGroup, PrismaClient, RoleCode } from '@prisma/client';
import { syncPermissions } from '../src/permissions.js';

export const DEV_PASSWORD = 'Passw0rd!';

const TENANTS = [
  { slug: 'rooftop-hall', legalName: 'ООО «Rooftop Hall»', taxId: '301234501' },
  { slug: 'sense48', legalName: 'ООО «Sense 48»', taxId: '301234502' },
  { slug: 'ordo', legalName: 'ООО «ORDO Management»', taxId: '311234503' },
] as const;

type TenantSlug = (typeof TENANTS)[number]['slug'];

const USERS: { email: string; fullName: string; roles: [TenantSlug, RoleCode][] }[] = [
  {
    email: 'owner@rooftop.test',
    fullName: 'Азиз Каримов',
    roles: [
      ['rooftop-hall', 'OWNER'],
      ['sense48', 'OWNER'],
    ],
  },
  { email: 'owner@ordo.test', fullName: 'Джамшид Умаров', roles: [['ordo', 'OWNER']] },
  {
    email: 'lead@fos.test',
    fullName: 'Нилуфар Рашидова',
    roles: [
      ['rooftop-hall', 'FINANCE_OPS_LEAD'],
      ['sense48', 'FINANCE_OPS_LEAD'],
      ['ordo', 'FINANCE_OPS_LEAD'],
    ],
  },
  {
    email: 'junior@fos.test',
    fullName: 'Тимур Алиев',
    roles: [
      ['rooftop-hall', 'JUNIOR_FINANCE'],
      ['sense48', 'JUNIOR_FINANCE'],
      ['ordo', 'JUNIOR_FINANCE'],
    ],
  },
  {
    email: 'doc@fos.test',
    fullName: 'Мадина Юсупова',
    roles: [
      ['rooftop-hall', 'DOCUMENT_CONTROLLER'],
      ['sense48', 'DOCUMENT_CONTROLLER'],
      ['ordo', 'DOCUMENT_CONTROLLER'],
    ],
  },
  {
    email: 'acct@fos.test',
    fullName: 'Гульнора Саидова',
    roles: [
      ['rooftop-hall', 'ACCOUNTANT'],
      ['sense48', 'ACCOUNTANT'],
      ['ordo', 'ACCOUNTANT'],
    ],
  },
  {
    email: 'admin@fos.test',
    fullName: 'Санжар Ибрагимов',
    roles: [
      ['rooftop-hall', 'ADMIN'],
      ['sense48', 'ADMIN'],
      ['ordo', 'ADMIN'],
    ],
  },
  { email: 'chef@rooftop.test', fullName: 'Богдан Ли', roles: [['rooftop-hall', 'REQUESTER']] },
  { email: 'sales@rooftop.test', fullName: 'Камила Назарова', roles: [['rooftop-hall', 'REQUESTER']] },
  { email: 'spa@sense48.test', fullName: 'Дильдора Хамидова', roles: [['sense48', 'REQUESTER']] },
  { email: 'pm@ordo.test', fullName: 'Отабек Рахимов', roles: [['ordo', 'REQUESTER']] },
];

const COST_CENTERS: Record<TenantSlug, { code: string; name: string; parent?: string; ownerEmail?: string }[]> = {
  'rooftop-hall': [
    { code: 'RH', name: 'Rooftop Hall' },
    { code: 'RH-KITCHEN', name: 'Кухня', parent: 'RH', ownerEmail: 'chef@rooftop.test' },
    { code: 'RH-BAR', name: 'Бар', parent: 'RH' },
    { code: 'RH-EVENTS', name: 'Мероприятия', parent: 'RH', ownerEmail: 'sales@rooftop.test' },
    { code: 'RH-ADMIN', name: 'Администрация', parent: 'RH' },
    { code: 'SHARED', name: 'Общие расходы' },
  ],
  sense48: [
    { code: 'S48', name: 'Sense 48' },
    { code: 'S48-RETAIL', name: 'Розница SPA', parent: 'S48' },
    { code: 'S48-TREATMENT', name: 'Процедуры', parent: 'S48' },
  ],
  ordo: [
    { code: 'ORDO-HQ', name: 'Головной офис' },
    { code: 'ORDO-TOWER', name: 'Объект Tower' },
    { code: 'ORDO-MALL', name: 'Объект Mall' },
  ],
};

// docs/10: category(closing_doc_sla_days), синтетические счета 1С
const CATEGORIES: { code: string; name: string; group: CategoryGroup; sla: number; account: string; budgetRequired?: boolean }[] = [
  { code: 'FNB_FOOD', name: 'Продукты (F&B)', group: 'FNB', sla: 5, account: '2910', budgetRequired: true },
  { code: 'FNB_BEVERAGE', name: 'Напитки (F&B)', group: 'FNB', sla: 5, account: '2911', budgetRequired: true },
  { code: 'SPA_CONSUMABLES', name: 'Расходники SPA', group: 'SPA', sla: 5, account: '2920', budgetRequired: true },
  { code: 'SPA_RETAIL', name: 'Товары для продажи SPA', group: 'SPA', sla: 5, account: '2921' },
  { code: 'LINEN_LAUNDRY', name: 'Бельё и прачечная', group: 'CLEANING', sla: 10, account: '9430' },
  { code: 'CLEANING', name: 'Клининг', group: 'CLEANING', sla: 10, account: '9431' },
  { code: 'MARKETING', name: 'Маркетинг', group: 'MARKETING', sla: 10, account: '9440', budgetRequired: true },
  { code: 'DECOR_AV', name: 'Декор и аппаратура', group: 'OTHER', sla: 5, account: '9441' },
  { code: 'STAFF_GPH', name: 'Персонал ГПХ', group: 'PAYROLL', sla: 10, account: '6710' },
  { code: 'PAYROLL', name: 'Зарплата', group: 'PAYROLL', sla: 0, account: '6700' },
  { code: 'UTILITIES', name: 'Коммунальные услуги', group: 'UTILITIES', sla: 10, account: '9450' },
  { code: 'RENT', name: 'Аренда', group: 'RENT', sla: 10, account: '9451', budgetRequired: true },
  { code: 'CAPEX', name: 'Капитальные затраты', group: 'CAPEX', sla: 15, account: '0820', budgetRequired: true },
  { code: 'TAX', name: 'Налоги', group: 'TAX', sla: 0, account: '6400' },
  { code: 'ADMIN', name: 'Административные', group: 'ADMIN', sla: 10, account: '9460' },
  { code: 'SECURITY', name: 'Охрана', group: 'OTHER', sla: 10, account: '9461' },
  { code: 'FM_SERVICES', name: 'FM-услуги', group: 'OTHER', sla: 10, account: '9470' },
  { code: 'REPAIR', name: 'Ремонт', group: 'OTHER', sla: 10, account: '9471' },
];

// Праздники РУз 2026; религиозные — placeholder-даты
const HOLIDAYS_2026 = [
  ['2026-01-01', 'Новый год'],
  ['2026-03-08', 'Международный женский день'],
  ['2026-03-20', 'Рамазан хайит (placeholder)'],
  ['2026-03-21', 'Навруз'],
  ['2026-05-09', 'День памяти и почестей'],
  ['2026-05-27', 'Курбан хайит (placeholder)'],
  ['2026-09-01', 'День независимости'],
  ['2026-10-01', 'День учителя'],
  ['2026-12-08', 'День Конституции'],
] as const;

export async function seedPhaseA(prisma: PrismaClient): Promise<void> {
  // 1. Permissions из матрицы docs/05
  const perms = await syncPermissions();
  console.log(`  permissions: ${perms.permissions} codes, ${perms.grants} grants`);

  // 2. Tenants
  const tenantIds = new Map<TenantSlug, string>();
  for (const t of TENANTS) {
    const tenant = await prisma.tenant.upsert({
      where: { slug: t.slug },
      create: {
        slug: t.slug,
        legalName: t.legalName,
        taxId: t.taxId,
        settings: { cutoff_time: '14:00' },
      },
      update: { legalName: t.legalName, taxId: t.taxId },
    });
    tenantIds.set(t.slug, tenant.id);
  }
  console.log(`  tenants: ${tenantIds.size}`);

  // 3. Users + roles (dev-пароль одинаковый, MFA off — docs/10)
  const passwordHash = await hashPassword(DEV_PASSWORD);
  const userIds = new Map<string, string>();
  for (const u of USERS) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      create: { email: u.email, fullName: u.fullName, passwordHash },
      update: { fullName: u.fullName, passwordHash },
    });
    userIds.set(u.email, user.id);
    for (const [slug, role] of u.roles) {
      const tenantId = tenantIds.get(slug)!;
      await prisma.userTenantRole.upsert({
        where: { userId_tenantId_role: { userId: user.id, tenantId, role } },
        create: { userId: user.id, tenantId, role },
        update: {},
      });
    }
  }
  console.log(`  users: ${userIds.size}`);

  // 4. Cost centers (два прохода: сначала без parent, потом связи)
  for (const [slug, centers] of Object.entries(COST_CENTERS) as [TenantSlug, (typeof COST_CENTERS)[TenantSlug]][]) {
    const tenantId = tenantIds.get(slug)!;
    const idsByCode = new Map<string, string>();
    for (const c of centers) {
      const row = await prisma.costCenter.upsert({
        where: { tenantId_code: { tenantId, code: c.code } },
        create: {
          tenantId,
          code: c.code,
          name: c.name,
          ownerId: c.ownerEmail ? (userIds.get(c.ownerEmail) ?? null) : null,
        },
        update: { name: c.name, ownerId: c.ownerEmail ? (userIds.get(c.ownerEmail) ?? null) : null },
      });
      idsByCode.set(c.code, row.id);
    }
    for (const c of centers) {
      if (c.parent) {
        await prisma.costCenter.update({
          where: { tenantId_code: { tenantId, code: c.code } },
          data: { parentId: idsByCode.get(c.parent) ?? null },
        });
      }
    }
  }

  // 5. Categories — общие справочники в каждом tenant
  for (const tenantId of tenantIds.values()) {
    for (const c of CATEGORIES) {
      await prisma.category.upsert({
        where: { tenantId_code: { tenantId, code: c.code } },
        create: {
          tenantId,
          code: c.code,
          name: c.name,
          group: c.group,
          closingDocSlaDays: c.sla,
          accountCode: c.account,
          budgetRequired: c.budgetRequired ?? false,
        },
        update: {
          name: c.name,
          group: c.group,
          closingDocSlaDays: c.sla,
          accountCode: c.account,
          budgetRequired: c.budgetRequired ?? false,
        },
      });
    }
  }
  console.log(`  cost centers + categories seeded`);

  // 6. Holidays 2026
  for (const [date, name] of HOLIDAYS_2026) {
    await prisma.holiday.upsert({
      where: { date_country: { date: new Date(date), country: 'UZ' } },
      create: { date: new Date(date), name, country: 'UZ' },
      update: { name },
    });
  }
  console.log(`  holidays: ${HOLIDAYS_2026.length}`);
}
