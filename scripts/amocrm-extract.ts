/**
 * amoCRM HISTORICAL EXTRACT (READ-ONLY) — запуск в GitHub Actions (amocrm.ru/.com доступен оттуда).
 * Строит скачиваемый файловый пакет для НЕЗАВИСИМОГО анализа (в т.ч. загрузки в ChatGPT):
 *   scripts/out/amocrm-extract/
 *     amocrm-extract.json     — полный машиночитаемый экстракт + аналитика (RAW+normalized+provenance)
 *     csv/<Лист>.csv          — по одной таблице на лист (Deals, Funnel, StageHistory, … , AnalyticsReadiness)
 *     README.md               — что в файлах, что надёжно / частично / отсутствует, допущения, модель времени
 * Далее workflow собирает из csv/ единый XLSX (лист = таблица) через Python/openpyxl и грузит артефактом.
 *
 * Ничего не пишет ни в amoCRM, ни в БД DMS. Только GET. Секреты в лог/вывод НЕ попадают.
 * Данные НЕ выдумываются: где API не отдаёт — помечено AVAILABLE / PARTIAL / NOT_AVAILABLE.
 * ENV: AMOCRM_SUBDOMAIN, AMOCRM_LONG_TOKEN, [AMOCRM_DOMAIN=amocrm.ru|amocrm.com|kommo.com].
 */
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AmoCrmClient, readAmoLongToken, describeTokenShape, runAmoExtract, buildAmoTables,
  type AmoExtract, type AmoTable,
} from '../packages/adapters/src/amocrm/index.js';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'out', 'amocrm-extract');
const CSV_DIR = join(OUT_DIR, 'csv');

/** RFC4180 CSV: экранируем ", перевод строки, ; . Разделитель — запятая, кодировка UTF-8 (+BOM для Excel). */
function toCsv(table: AmoTable): string {
  const esc = (v: string | number | null): string => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = table.columns.map(esc).join(',');
  const lines = table.rows.map((r) => table.columns.map((c) => esc(r[c] ?? null)).join(','));
  return '﻿' + [header, ...lines].join('\r\n') + '\r\n';
}

function readme(x: AmoExtract, tables: AmoTable[]): string {
  const L: string[] = [];
  L.push('# amoCRM — исторический экстракт для независимого анализа', '');
  L.push('READ-ONLY выгрузка из amoCRM. Ничего не импортировано в рабочие сущности DMS.', '');
  L.push(`- Аккаунт: ${x.account ? `${x.account.name} (${x.account.subdomain})` : '—'}`);
  L.push(`- Сформировано: ${x.generatedAt}`);
  L.push(`- Сделок: ${x.summary['deals_total']} · контактов: ${x.summary['contacts_total']} · компаний: ${x.summary['companies_total']}`);
  L.push(`- Усечение лимитом страниц: ${x.summary['any_truncated']}`, '');
  L.push('## Модель времени', '', x.timeNote, '');
  L.push('## Провенанс', '', 'Каждая сделка помечена provenance_source=AMOCRM, несёт внешние id (lead_id, pipeline_id, source_stage_id), source-время (created_at/updated_at/closed_at) и synced_at (время этой выгрузки). Исходные стадии amoCRM сохранены как source_stage_*; normalized_stage — ОТДЕЛЬНАЯ аналитическая нормализация в стадии DMS, старую историю не переписывает.', '');
  L.push('## Файлы', '');
  L.push('- `amocrm-extract.json` — полный машиночитаемый экстракт (все таблицы + аналитика). Это надёжный источник для загрузки в ChatGPT.');
  L.push('- `amocrm-extract.xlsx` — та же аналитика одной книгой (лист = таблица).');
  L.push('- `csv/*.csv` — по одной таблице на файл (UTF-8 с BOM, разделитель `,`):');
  for (const t of tables) L.push(`  - \`csv/${t.sheet}.csv\` — ${t.rows.length} строк`);
  L.push('');
  L.push('## Что надёжно / частично / отсутствует', '');
  L.push('Лист `AnalyticsReadiness` — матрица: МЕТРИКА → ИСТОЧНИК → ПОКРЫТИЕ% → НАДЁЖНОСТЬ → AVAILABLE/PARTIAL/NOT_AVAILABLE → что DMS обязан собирать с сегодняшнего дня. Ключевое:');
  for (const r of x.readiness) L.push(`- **${r.metric}** — ${r.availability} (${r.reliability}${r.coverage_pct != null ? `, покрытие ${r.coverage_pct}%` : ''}). DMS: ${r.dms_must_collect}`);
  L.push('');
  L.push('## Важные оговорки', '');
  L.push('- История стадий восстановлена из `/events` — amoCRM хранит события ограниченный срок, поэтому ранние переходы могут отсутствовать (PARTIAL). Мы НЕ симулируем недостающие переходы. DMS должен фиксировать каждый переход как событие с этого момента.');
  L.push('- Суммы сделок берутся из amoCRM (намерение), а НЕ подтверждённый финфакт. Источник истины по деньгам — DMS/Finance.');
  L.push('- Кастом-поля не удалялись до ревью: см. лист `CustomFields` (fill-rate, примеры значений, решение KEEP_RAW/MAP/IGNORE/NEEDS_DECISION).');
  L.push('- Привязка сделок к объектам (Unit) НЕ восстанавливалась авто-матчингом по имени — это отдельный маппинг-репорт (сейчас NOT_AVAILABLE).');
  if (x.notes.length) { L.push('', '## Примечания выгрузки', ''); for (const n of x.notes) L.push(`- ${n}`); }
  L.push('');
  return L.join('\n');
}

async function main() {
  const cfg = readAmoLongToken();
  const shape = describeTokenShape(process.env.AMOCRM_LONG_TOKEN);
  const client = new AmoCrmClient({ subdomain: cfg.subdomain, domain: cfg.domain });
  console.log(`amoCRM extract · поддомен ${cfg.subdomain} · домен ${cfg.domain} · READ-ONLY`);
  console.log(`  базовый хост: ${client.baseHost()}`);
  console.log(`  форма токена: ${shape.kind} (длина ${shape.length}) — ${shape.hint}\n`);

  // Бюджет времени 20 мин: гарантированно оставляем ~10 мин от 30-мин лимита job на сборку XLSX и загрузку
  // артефакта. Если аккаунт огромный и раздел не успел — он помечается PARTIAL, пакет всё равно отдаётся.
  const extract = await runAmoExtract(client, cfg.accessToken, { budgetMs: 20 * 60 * 1000 });
  const tables = buildAmoTables(extract);

  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(CSV_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, 'amocrm-extract.json'), JSON.stringify(extract, null, 2), 'utf8');
  for (const t of tables) await writeFile(join(CSV_DIR, `${t.sheet}.csv`), toCsv(t), 'utf8');
  await writeFile(join(OUT_DIR, 'README.md'), readme(extract, tables), 'utf8');

  console.log('Готово. Пакет:');
  console.log(`  ${join('scripts', 'out', 'amocrm-extract')}/`);
  console.log(`  · amocrm-extract.json  · README.md  · csv/ (${tables.length} таблиц)`);
  console.log(`\nСделок: ${extract.summary['deals_total']} · воронок: ${extract.summary['pipelines']} · история стадий: ${extract.summary['stage_history_events']} событий`);
}

main().catch((e) => {
  console.error(`✗ extract упал: ${(e as Error).name}: ${(e as Error).message}`);
  if ((e as Error & { code?: string }).code === 'AMOCRM_UNAUTHORIZED' || /AMOCRM_UNAUTHORIZED/.test((e as Error).message)) {
    console.error('  Причина — amoCRM отклонил токен (401). Проверь по порядку:');
    console.error('   1) AMOCRM_SUBDOMAIN = точный поддомен аккаунта (без .amocrm.ru).');
    console.error('   2) AMOCRM_DOMAIN — если аккаунт на .com/Kommo, поставь amocrm.com или kommo.com.');
    console.error('   3) AMOCRM_LONG_TOKEN — это долгосрочный токен (eyJ...), не код авторизации (def502...), без префикса "Bearer" и пробелов.');
    console.error('   4) Токен не отозван и у интеграции есть доступ на чтение.');
  }
  process.exit(1);
});
