/* global process, console, fetch */
/**
 * H-10 (Altegio): read-only смоук-тест подключения. Только GET-запросы,
 * ничего не создаёт и не меняет. В вывод — только счётчики и статусы,
 * никаких персональных данных (условие владельца, docs/16 §условия).
 * Запуск: workflow altegio-smoke.yml (секреты из GitHub Actions).
 */
const PARTNER = process.env.ALTEGIO_PARTNER_TOKEN;
const USER = process.env.ALTEGIO_USER_TOKEN;
const COMPANY = process.env.ALTEGIO_COMPANY_ID || '1359437';

if (!PARTNER || !USER) {
  console.error('Нет ALTEGIO_PARTNER_TOKEN / ALTEGIO_USER_TOKEN');
  process.exit(1);
}

const BASE = 'https://api.alteg.io/api/v1';
const HEADERS = {
  Authorization: `Bearer ${PARTNER}, User ${USER}`,
  Accept: 'application/vnd.api.v2+json',
  'Content-Type': 'application/json',
};

async function get(path) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}${path}`, { headers: HEADERS });
  const ms = Date.now() - t0;
  let body = null;
  try { body = await res.json(); } catch { /* не json */ }
  return { status: res.status, ms, body };
}

const count = (b) => {
  const d = b?.data ?? b;
  return Array.isArray(d) ? d.length : d ? 1 : 0;
};

async function main() {
  console.log(`Смоук-тест Altegio · компания ${COMPANY} · только чтение\n`);
  let ok = 0, fail = 0;

  // 1. Филиал
  const company = await get(`/company/${COMPANY}`);
  if (company.status === 200) {
    const c = company.body?.data;
    console.log(`1. Филиал: HTTP 200 (${company.ms}ms) — «${c?.title ?? '?'}», город: ${c?.city ?? '?'}`);
    ok++;
  } else { console.log(`1. Филиал: HTTP ${company.status} — ${JSON.stringify(company.body?.meta ?? company.body).slice(0, 120)}`); fail++; }

  // 2. Сотрудники (пробуем оба известных пути v1)
  let staff = await get(`/company/${COMPANY}/staff`);
  if (staff.status === 404) staff = await get(`/staff/${COMPANY}`);
  if (staff.status === 200) { console.log(`2. Сотрудники: HTTP 200 (${staff.ms}ms) — ${count(staff.body)} чел.`); ok++; }
  else { console.log(`2. Сотрудники: HTTP ${staff.status}`); fail++; }

  // 3. Услуги
  let services = await get(`/company/${COMPANY}/services`);
  if (services.status === 404) services = await get(`/services/${COMPANY}`);
  if (services.status === 200) { console.log(`3. Услуги: HTTP 200 (${services.ms}ms) — ${count(services.body)} шт. (ожидалось ~17)`); ok++; }
  else { console.log(`3. Услуги: HTTP ${services.status}`); fail++; }

  // 4. Записи за 30 дней назад и 30 вперёд (только количество!)
  const d = (x) => x.toISOString().slice(0, 10);
  const now = new Date();
  const from = d(new Date(now.getTime() - 30 * 864e5));
  const to = d(new Date(now.getTime() + 30 * 864e5));
  const records = await get(`/records/${COMPANY}?start_date=${from}&end_date=${to}&count=300`);
  if (records.status === 200) {
    const rows = records.body?.data ?? [];
    const future = rows.filter((r) => (r.date ?? r.datetime ?? '') >= d(now)).length;
    console.log(`4. Записи ${from}…${to}: HTTP 200 (${records.ms}ms) — всего ${rows.length}, из них будущих: ${future}`);
    ok++;
  } else { console.log(`4. Записи: HTTP ${records.status} — ${JSON.stringify(records.body?.meta ?? '').slice(0, 120)}`); fail++; }

  console.log(`\nИтог: ${ok} ok, ${fail} fail. Режим: только GET, данные не изменялись.`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('Ошибка сети:', e.message); process.exit(1); });
