import * as XLSX from 'xlsx';

/**
 * H-01 (ADR-011): парсер управленческой книги KSP Consulting (Rooftop).
 * Книга — текущий Excel-процесс, который заменяет Finance OS. Отсюда берём:
 * справочники контрагентов, срез долгов (AP/AR), статьи расходов, правила
 * маппинга выписки и кассовые операции. Историю расчётного счёта НЕ берём —
 * источником банковских транзакций остаётся выписка банка (BR-054/056).
 */

export interface KspApBalance {
  vendorName: string;
  /** отрицательное — мы должны поставщику; положительное — переплата/аванс */
  netMinor: bigint;
  asOf: Date;
}
export interface KspArBalance {
  customerName: string;
  /** положительное — клиент должен нам; отрицательное — получен аванс */
  netMinor: bigint;
}
export interface KspMatchRule {
  pattern: string;
  purposePattern: string | null;
  operationType: string | null;
  counterpartyName: string;
  expenseArticle: string | null;
}
export interface KspCashTx {
  date: Date;
  counterpartyName: string;
  article: string | null;
  /** знак = направление, в тийинах, уже в UZS (пересчёт валюты сделан KSP) */
  amountMinor: bigint;
  currency: string;
  note: string | null;
  rowIndex: number;
}
export interface KspBook {
  vendors: string[];
  apBalances: KspApBalance[];
  apAsOf: Date;
  customers: string[];
  arBalances: KspArBalance[];
  categories: string[];
  matchRules: KspMatchRule[];
  cashTx: KspCashTx[];
}

const toMinor = (v: unknown): bigint => {
  if (v === null || v === undefined || v === '') return 0n;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[\s\u00a0]/gu, '').replace(',', '.'));
  if (!Number.isFinite(n)) return 0n;
  return BigInt(Math.round(n * 100));
};
const toDate = (v: unknown): Date | null => {
  if (v instanceof Date) return v;
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    return d ? new Date(Date.UTC(d.y, d.m - 1, d.d)) : null;
  }
  if (typeof v === 'string') {
    const m = v.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    if (m) return new Date(Date.UTC(+m[3]!, +m[2]! - 1, +m[1]!));
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
};
const clean = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();

type Row = unknown[];
const sheetRows = (wb: XLSX.WorkBook, name: string): Row[] => {
  const ws = wb.Sheets[name];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json<Row>(ws, { header: 1, raw: true, defval: null });
};

export function parseKspWorkbook(data: Buffer | Uint8Array): KspBook {
  const wb = XLSX.read(data, { type: 'buffer', cellDates: true });

  // ── Баланс по контрагентам: срезы долгов поставщикам, берём последний ──
  // Колонка «ИТОГО» в книге битая (съезжает на строку), поэтому сальдо считаем
  // сами: авансы (C) + задолженность (D).
  const bal = sheetRows(wb, 'Баланс по контрагентам');
  const balRows = bal
    .slice(1)
    .map((r) => ({ date: toDate(r[0]), name: clean(r[1]), net: toMinor(r[2]) + toMinor(r[3]) }))
    .filter((r) => r.date && r.name);
  const apAsOf = balRows.reduce((mx, r) => (r.date! > mx ? r.date! : mx), new Date(0));
  const apBalances: KspApBalance[] = balRows
    .filter((r) => r.date!.getTime() === apAsOf.getTime() && r.net !== 0n)
    .map((r) => ({ vendorName: r.name, netMinor: r.net, asOf: apAsOf }));
  const vendors = [...new Set(balRows.map((r) => r.name))].sort((a, b) => a.localeCompare(b, 'ru'));

  // ── Контрагенты: покупатели сверху до маркера «Поставщики» ──
  // Остаток клиента = самый правый столбец «Остаток на конец периода».
  // Индексы колонок берём из строки заголовка: SheetJS отбрасывает пустые
  // ведущие столбцы, поэтому фиксированные смещения ненадёжны.
  const kontr = sheetRows(wb, 'Контрагенты');
  const headerIdx = kontr.findIndex((r) => r.some((c) => clean(c) === 'Контрагент'));
  const header = headerIdx >= 0 ? kontr[headerIdx]! : [];
  const nameCol = header.findIndex((c) => clean(c) === 'Контрагент');
  const closingCols = header.map((c, i) => (clean(c).startsWith('Остаток на конец') ? i : -1)).filter((i) => i >= 0);
  const arBalances: KspArBalance[] = [];
  const customers: string[] = [];
  for (let i = headerIdx + 1; i < kontr.length; i++) {
    const row = kontr[i]!;
    if (row.some((c) => ['Поставщики', 'Прочие'].includes(clean(c)))) break;
    const name = clean(row[nameCol]);
    if (!name || /^[\d\s.,-]+$/.test(name)) continue;
    customers.push(name);
    let net = 0n;
    for (let c = closingCols.length - 1; c >= 0; c--) {
      const v = row[closingCols[c]!];
      if (v !== null && v !== undefined && v !== '') {
        net = toMinor(v);
        break;
      }
    }
    if (net !== 0n) arBalances.push({ customerName: name, netMinor: net });
  }

  // ── Маппинг: правила «имя из выписки → контрагент/статья» ──
  const map = sheetRows(wb, 'Маппинг');
  const mapHeader = map.findIndex((r) => clean(r[0]).startsWith('Наименование'));
  const matchRules: KspMatchRule[] = [];
  const seen = new Set<string>();
  for (const r of map.slice(mapHeader + 1)) {
    const pattern = clean(r[0]);
    const counterpartyName = clean(r[3]) || pattern;
    if (!pattern || seen.has(pattern)) continue;
    seen.add(pattern);
    matchRules.push({
      pattern,
      purposePattern: clean(r[1]) || null,
      operationType: clean(r[2]) || null,
      counterpartyName,
      expenseArticle: clean(r[5]) || null,
    });
  }

  // ── Статьи расходов: Справочник (кол. «Статья») + статьи из правил ──
  const spr = sheetRows(wb, 'Справочник');
  const sprHeader = spr.findIndex((r) => r.some((c) => clean(c) === 'Статья'));
  const articleCol = sprHeader >= 0 ? spr[sprHeader]!.findIndex((c, i) => clean(c) === 'Статья' && i > 8) : -1;
  const categories = [
    ...new Set(
      [
        ...(articleCol >= 0 ? spr.slice(sprHeader + 1).map((r) => clean(r[articleCol])) : []),
        ...matchRules.map((r) => r.expenseArticle ?? ''),
      ].filter((s) => s && s.length > 1),
    ),
  ].sort((a, b) => a.localeCompare(b, 'ru'));

  // ── Касса: операции в основной валюте (KSP уже пересчитал USD → UZS) ──
  const kassa = sheetRows(wb, 'Касса');
  const kHeader = kassa.findIndex((r) => clean(r[1]) === 'Дата операции');
  const cashTx: KspCashTx[] = [];
  for (let i = kHeader + 1; i < kassa.length; i++) {
    const r = kassa[i]!;
    const date = toDate(r[1]);
    if (!date) continue;
    const amount = toMinor(r[10]) - toMinor(r[11]);
    if (amount === 0n) continue;
    cashTx.push({
      date,
      counterpartyName: clean(r[3]) || clean(r[2]) || 'Касса',
      article: clean(r[4]) || null,
      amountMinor: amount,
      currency: clean(r[8]) || 'UZS',
      note: clean(r[12]) || null,
      rowIndex: i + 1,
    });
  }

  return { vendors, apBalances, apAsOf, customers, arBalances, categories, matchRules, cashTx };
}
