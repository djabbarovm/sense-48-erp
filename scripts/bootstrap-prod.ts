/**
 * H-06: первичная настройка продакшн-сервера (идемпотентно, без демо-данных).
 * Создаёт права, тенант «Rooftop Hall (PALYM)», команду по ADR-012 и, если
 * рядом лежит книга KSP (KSP_BOOK_PATH), загружает стартовые данные (H-01).
 *
 *   docker compose ... run --rm web pnpm exec tsx scripts/bootstrap-prod.ts
 */
// Относительные импорты: скрипт запускается tsx-ом из пакета db
// (pnpm --filter @finance-os/db exec tsx /app/scripts/bootstrap-prod.ts),
// и workspace-алиасы из корня в прод-образе не резолвятся.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { parseKspWorkbook } from '../packages/adapters/src/index.js';
import { hashPassword, unsafeCreateTenantContext } from '../packages/core/src/index.js';
import { prisma, syncPermissions, importKspBook } from '../packages/db/src/index.js';

const TENANT_SLUG = 'rooftop-real';
const TEMP_PASSWORD = process.env['BOOTSTRAP_TEMP_PASSWORD'] || 'Palym2026!';
const BOOK = process.env['KSP_BOOK_PATH'] || '/app/data/ksp.xlsx';

// ADR-012: команда пилота (placeholder-email до получения настоящих)
const TEAM: [string, string, string[]][] = [
  ['Мурад Джаббаров', 'murad@palym.test', ['OWNER', 'ADMIN']],
  ['Лайло Махмудова', 'laylo@palym.test', ['OWNER']],
  ['Арай Амирханова', 'aray@palym.test', ['OWNER']],
  ['Дильфуза', 'dilfuza@palym.test', ['FINANCE_OPS_LEAD', 'ACCOUNTANT']],
  ['Зухра', 'zukhra@palym.test', ['JUNIOR_FINANCE', 'ACCOUNTANT']],
  ['Нарина', 'narina@palym.test', ['REQUESTER']],
];

async function main() {
  const perms = await syncPermissions();
  console.log(`Права: ${perms.permissions} кодов, ${perms.grants} грантов`);

  let tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  tenant ??= await prisma.tenant.create({ data: { slug: TENANT_SLUG, legalName: 'Rooftop Hall (PALYM)', taxId: '' } });
  console.log(`Тенант: ${tenant.legalName}`);

  const hash = await hashPassword(TEMP_PASSWORD);
  let leadId: string | null = null;
  for (const [fullName, email, roles] of TEAM) {
    const user = await prisma.user.upsert({
      where: { email },
      create: { email, fullName, passwordHash: hash },
      update: {},
    });
    if (roles.includes('FINANCE_OPS_LEAD')) leadId = user.id;
    for (const role of roles) {
      await prisma.userTenantRole.upsert({
        where: { userId_tenantId_role: { userId: user.id, tenantId: tenant.id, role: role as never } },
        create: { userId: user.id, tenantId: tenant.id, role: role as never },
        update: {},
      });
    }
    console.log(`  ${email} → ${roles.join(' + ')}`);
  }

  if (existsSync(BOOK)) {
    const ctx = unsafeCreateTenantContext({
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      userId: leadId ?? crypto.randomUUID(),
      roles: ['FINANCE_OPS_LEAD', 'JUNIOR_FINANCE', 'ACCOUNTANT'],
    });
    const book = parseKspWorkbook(readFileSync(BOOK));
    const r = await importKspBook(ctx, book);
    console.log(`Книга KSP: поставщиков +${r.vendorsCreated}, клиентов +${r.customersCreated}, AP ${r.apInvoicesCreated} сальдо, AR ${r.arInvoicesCreated}, правил ${r.matchRulesUpserted}, касса +${r.cashTxCreated}`);
    try { rmSync(BOOK); console.log('Файл книги удалён с диска после импорта'); } catch { /* mounted read-only — ок */ }
  } else {
    console.log(`Книга KSP не найдена (${BOOK}) — пропускаю импорт данных`);
  }

  console.log('Bootstrap завершён.');
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
