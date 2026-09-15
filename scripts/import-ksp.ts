/**
 * H-01 (ADR-011): CLI-импорт управленческой книги KSP в тенант.
 *
 *   DATABASE_URL=... pnpm exec tsx scripts/import-ksp.ts \
 *     --file /path/to/ksp.xlsx --tenant rooftop-real \
 *     [--create "Rooftop Hall (PALYM)"] [--copy-users-from rooftop]
 *
 * Файл книги в репозиторий не коммитится (реальные данные компании).
 */
import { readFileSync } from 'node:fs';
import { parseKspWorkbook } from '@finance-os/adapters';
import { unsafeCreateTenantContext } from '@finance-os/core';
import { prisma, importKspBook } from '@finance-os/db';

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};
const fmt = (m: bigint) => (m / 100n).toLocaleString('ru-RU') + ' сум';

async function main() {
  const file = arg('file');
  const slug = arg('tenant');
  if (!file || !slug) {
    console.error('Использование: --file <ksp.xlsx> --tenant <slug> [--create "Имя"] [--copy-users-from <slug>]');
    process.exit(1);
  }

  let tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) {
    const name = arg('create');
    if (!name) throw new Error(`Тенант «${slug}» не найден. Передайте --create "Название" для создания.`);
    tenant = await prisma.tenant.create({ data: { slug, legalName: name, taxId: '' } });
    console.log(`Создан тенант ${name} (${slug})`);
  }

  const copyFrom = arg('copy-users-from');
  if (copyFrom) {
    const src = await prisma.tenant.findFirstOrThrow({ where: { slug: { contains: copyFrom } } });
    const roles = await prisma.userTenantRole.findMany({ where: { tenantId: src.id } });
    let granted = 0;
    for (const r of roles) {
      await prisma.userTenantRole.upsert({
        where: { userId_tenantId_role: { userId: r.userId, tenantId: tenant.id, role: r.role } },
        create: { userId: r.userId, tenantId: tenant.id, role: r.role },
        update: {},
      });
      granted++;
    }
    console.log(`Доступы: скопировано ${granted} ролей из «${copyFrom}»`);
  }

  const admin = await prisma.userTenantRole.findFirst({ where: { tenantId: tenant.id, role: 'FINANCE_OPS_LEAD' } });
  const ctx = unsafeCreateTenantContext({
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    userId: admin?.userId ?? crypto.randomUUID(),
    roles: ['FINANCE_OPS_LEAD', 'JUNIOR_FINANCE', 'ACCOUNTANT'],
  });

  const book = parseKspWorkbook(readFileSync(file));
  console.log(`Книга разобрана: срез AP на ${book.apAsOf.toISOString().slice(0, 10)}; ` +
    `${book.vendors.length} поставщиков, ${book.customers.length} покупателей, ` +
    `${book.categories.length} статей, ${book.matchRules.length} правил, ${book.cashTx.length} кассовых операций`);

  const r = await importKspBook(ctx, book);
  console.log('— Поставщики: создано', r.vendorsCreated, '(уже были:', r.vendorsExisting + ')');
  console.log('— Клиенты: создано', r.customersCreated);
  console.log('— Категории (статьи KSP): создано', r.categoriesCreated);
  console.log('— Кредиторка: документов-сальдо', r.apInvoicesCreated, 'на', fmt(r.apTotalMinor));
  if (r.vendorAdvances.length) {
    console.log('  Переплаты поставщикам (на ручной разбор):');
    for (const a of r.vendorAdvances) console.log(`    ${a.vendorName}: ${fmt(a.amountMinor)}`);
  }
  console.log('— Дебиторка: счетов-сальдо', r.arInvoicesCreated, 'на', fmt(r.arTotalMinor));
  if (r.customerAdvances.length) {
    console.log('  Полученные авансы клиентов (на ручной разбор):');
    for (const a of r.customerAdvances) console.log(`    ${a.customerName}: ${fmt(a.amountMinor)}`);
  }
  console.log('— Правил маппинга выписки:', r.matchRulesUpserted);
  console.log('— Касса: операций загружено', r.cashTxCreated, '; остаток по книге:', fmt(r.cashBalanceMinor));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
