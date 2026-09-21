/**
 * amoCRM DRY-RUN (READ-ONLY) — запуск в GitHub Actions runner (amocrm.ru доступен оттуда,
 * из dev-песочницы — нет). Ничего не пишет: ни в amoCRM, ни в БД DMS. Только GET.
 *
 * ENV: AMOCRM_SUBDOMAIN, AMOCRM_LONG_TOKEN (из GitHub Secrets).
 * Вывод: человекочитаемый отчёт в stdout + JSON в scripts/out/amocrm-dryrun.json (артефакт).
 * Секреты в лог/вывод НЕ попадают (клиент их не печатает, отчёт их не содержит).
 *
 * Импортируем изолированный amocrm-модуль напрямую (без @prisma/client и сборки монорепо).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AmoCrmClient, runAmoDryRun, formatAmoDryRun, readAmoLongToken, describeTokenShape } from '../packages/adapters/src/amocrm/index.js';

// вывод — рядом со скриптом (scripts/out), независимо от cwd (pnpm --filter меняет cwd на пакет)
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'out');

async function main() {
  let cfg;
  try {
    cfg = readAmoLongToken();
  } catch (e) {
    console.error(`✗ ${(e as Error).message}`);
    console.error('  Добавьте секреты AMOCRM_SUBDOMAIN и AMOCRM_LONG_TOKEN в GitHub → Settings → Secrets.');
    process.exit(1);
    return;
  }

  // Префлайт-диагностика (без раскрытия секрета): форма токена + реальный базовый хост.
  const shape = describeTokenShape(process.env.AMOCRM_LONG_TOKEN);
  const client = new AmoCrmClient({ subdomain: cfg.subdomain, domain: cfg.domain });
  console.log(`amoCRM dry-run · поддомен ${cfg.subdomain} · домен ${cfg.domain} · только чтение`);
  console.log(`  базовый хост: ${client.baseHost()}`);
  console.log(`  форма токена: ${shape.kind} (длина ${shape.length}) — ${shape.hint}`);
  if (!shape.ok) console.log('  ⚠ форма токена выглядит неверной (см. подсказку выше). Если это ложная тревога — игнорируй.');
  console.log('');

  const report = await runAmoDryRun(client, cfg.accessToken);
  console.log(formatAmoDryRun(report));

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, 'amocrm-dryrun.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log('\nJSON-отчёт: scripts/out/amocrm-dryrun.json');
}

main().catch((e) => {
  // печатаем тип/сообщение ошибки, но не тело запроса и не токен
  console.error(`✗ dry-run упал: ${(e as Error).name}: ${(e as Error).message}`);
  process.exit(1);
});
