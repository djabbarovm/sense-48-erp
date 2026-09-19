/**
 * Родные выгрузки 1С:Бухгалтерии (без переформатирования в наши шаблоны):
 *  - справочник контрагентов («Контрагент | ИНН | ПИНФЛ | Полное наименование | Номер счета | Банк | МФО»);
 *  - оборотно-сальдовая ведомость по счёту в разрезе контрагент → договор (4010 дебиторка, 43xx авансы, 6xxx кредиторка);
 *  - штатные сотрудники (ФИО, табельный номер, должность, дата приёма; оклады НЕ читаются).
 * Парсеры чистые: только структура файла → объекты. ПИНФЛ и оклады в результат не попадают (docs/11).
 */
import * as XLSX from 'xlsx';

type Cell = string | number | Date | null;

export function readFirstSheet(file: Buffer): Cell[][] {
  const wb = XLSX.read(file, { type: 'buffer', cellDates: true });
  const name = wb.SheetNames[0];
  if (!name) return [];
  return XLSX.utils.sheet_to_json<Cell[]>(wb.Sheets[name]!, { header: 1, raw: true, defval: null });
}

export const cellStr = (v: Cell | undefined): string => (v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim());

/** Сумма из ячейки 1С/Didox → тийины: число (может быть c дробью) или строка «10 140 818,06». */
export function cellMinor(v: Cell | undefined): bigint | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return BigInt(Math.round(v * 100));
  const s = String(v).replace(/\s/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const neg = s.startsWith('-');
  const [i, f = ''] = s.replace('-', '').split('.') as [string, string?];
  const minor = BigInt(i) * 100n + BigInt((f ?? '').padEnd(2, '0').slice(0, 2));
  return neg ? -minor : minor;
}

/** «01.07.2026» / «2026-07-01» / Date → ISO-дата или null. */
export function cellDate(v: Cell | undefined): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v).trim();
  const dot = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (dot) return `${dot[3]}-${dot[2]!.padStart(2, '0')}-${dot[1]!.padStart(2, '0')}`;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

/** Нормализация имени контрагента для сопоставления между 1С, Didox и нашей базой: регистр, кавычки, орг-формы. */
export function normalizeCounterpartyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[«»"'`ʼ’“”]/g, ' ')
    .replace(/\b(mchj|мчж|ооо|xk|хк|qk|қк|aj|аж|оао|ao|ат|ntm|нтм|jamiyati|mas'uliyati|cheklangan|xususiy|aksiyadorlik|bank|banki|филиал|filiali)\b/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const findHeaderRow = (rows: Cell[][], must: string[]): number => rows.findIndex((r) => must.every((m) => r.some((c) => cellStr(c).toLowerCase().startsWith(m.toLowerCase()))));
const colIndex = (header: Cell[], label: string): number => header.findIndex((c) => cellStr(c).toLowerCase().startsWith(label.toLowerCase()));

// ── Справочник контрагентов ──

export interface OnecCounterparty {
  name: string;
  legalName: string;
  taxId: string;
  /** Физлицо (в выгрузке есть ПИНФЛ); сам ПИНФЛ не возвращается. */
  isPerson: boolean;
  account: string;
  bankName: string;
  mfo: string;
}

export function parseOnecCounterparties(file: Buffer): { rows: OnecCounterparty[]; warnings: string[] } {
  const rows = readFirstSheet(file);
  const h = findHeaderRow(rows, ['ИНН', 'Номер счета']);
  if (h < 0) throw new Error('ONEC_FORMAT: не найдена строка заголовков «Контрагент | ИНН | … | Номер счета | Банк | МФО»');
  const header = rows[h]!;
  const c = { name: colIndex(header, 'Контрагент'), inn: colIndex(header, 'ИНН'), pinfl: colIndex(header, 'ПИНФЛ'), legal: colIndex(header, 'Полное наименование'), account: colIndex(header, 'Номер счета'), bank: colIndex(header, 'Банк'), mfo: colIndex(header, 'МФО') };
  const out: OnecCounterparty[] = [];
  const warnings: string[] = [];
  rows.slice(h + 1).forEach((r, i) => {
    const name = cellStr(r[c.name]);
    if (!name) return;
    const taxId = cellStr(r[c.inn]).replace(/\D/g, '');
    const account = cellStr(r[c.account]).replace(/\D/g, '');
    const mfoRaw = cellStr(r[c.mfo]).replace(/\D/g, '');
    const bankRaw = cellStr(r[c.bank]);
    const line = h + i + 2;
    if (!/^\d{9}$/.test(taxId)) { warnings.push(`строка ${line}: «${name}» — ИНН не 9 цифр, пропущено`); return; }
    if (!/^\d{20}$/.test(account)) { warnings.push(`строка ${line}: «${name}» — счёт не 20 цифр, пропущено`); return; }
    out.push({
      name, legalName: cellStr(r[c.legal]) || name, taxId,
      isPerson: c.pinfl >= 0 && /^\d{14}$/.test(cellStr(r[c.pinfl])),
      account, mfo: mfoRaw.padStart(5, '0'),
      bankName: bankRaw.replace(/^\d{5}\s*/, '').replace(/["'«»]+/g, ' ').replace(/\s+/g, ' ').trim() || bankRaw,
    });
  });
  return { rows: out, warnings };
}

// ── ОСВ по счёту ──

export interface OnecOsvLine {
  counterparty: string;
  contract: { number: string; date: string | null; raw: string } | null;
  openingDebit: bigint; openingCredit: bigint;
  turnoverDebit: bigint; turnoverCredit: bigint;
  closingDebit: bigint; closingCredit: bigint;
}
export interface OnecOsv {
  company: string;
  account: string;
  periodText: string;
  lines: OnecOsvLine[];
  totals: { closingDebit: bigint; closingCredit: bigint };
}

const CONTRACT_RE = /^№\s*(.+?)\s+от\s+(\d{1,2}\.\d{1,2}\.\d{4})\s*$/;

export function parseOnecOsv(file: Buffer): OnecOsv {
  const rows = readFirstSheet(file);
  const titleIdx = rows.findIndex((r) => /оборотно-сальдовая ведомость/i.test(cellStr(r[0])));
  if (titleIdx < 0) throw new Error('ONEC_FORMAT: это не оборотно-сальдовая ведомость');
  const title = cellStr(rows[titleIdx]![0]);
  const account = title.match(/по сч[её]ту\s*(\d{4})/i)?.[1] ?? '';
  if (!account) throw new Error('ONEC_FORMAT: в заголовке ОСВ не найден номер счёта');
  const periodText = title.match(/за\s+(.+)$/i)?.[1]?.trim() ?? '';
  const h = rows.findIndex((r, i) => i > titleIdx && r.filter((c) => /^(дебет|кредит)$/i.test(cellStr(c))).length >= 6);
  if (h < 0) throw new Error('ONEC_FORMAT: не найдена строка «Дебет | Кредит» × 3');
  const cols = rows[h]!.map((c, i) => (/^(дебет|кредит)$/i.test(cellStr(c)) ? i : -1)).filter((i) => i >= 0);
  const [oD, oC, tD, tC, cD, cC] = cols as [number, number, number, number, number, number];
  const n = (r: Cell[], i: number) => cellMinor(r[i]) ?? 0n;
  const lines: OnecOsvLine[] = [];
  let totals = { closingDebit: 0n, closingCredit: 0n };
  let current: string | null = null;
  let currentHasContracts = false;
  let currentRow: Cell[] | null = null;
  const flushCounterpartyWithoutContracts = () => {
    if (current && !currentHasContracts && currentRow) lines.push({ counterparty: current, contract: null, openingDebit: n(currentRow, oD), openingCredit: n(currentRow, oC), turnoverDebit: n(currentRow, tD), turnoverCredit: n(currentRow, tC), closingDebit: n(currentRow, cD), closingCredit: n(currentRow, cC) });
  };
  for (const r of rows.slice(h + 1)) {
    const a = cellStr(r[0]);
    if (!a || a === account || /^договоры$/i.test(a)) continue;
    if (/^итого$/i.test(a)) { totals = { closingDebit: n(r, cD), closingCredit: n(r, cC) }; break; }
    const m = a.match(CONTRACT_RE);
    if (m && current) {
      currentHasContracts = true;
      lines.push({ counterparty: current, contract: { number: m[1]!.trim(), date: cellDate(m[2]), raw: a }, openingDebit: n(r, oD), openingCredit: n(r, oC), turnoverDebit: n(r, tD), turnoverCredit: n(r, tC), closingDebit: n(r, cD), closingCredit: n(r, cC) });
      continue;
    }
    flushCounterpartyWithoutContracts();
    current = a; currentHasContracts = false; currentRow = r;
  }
  flushCounterpartyWithoutContracts();
  return { company: cellStr(rows[0]?.[0]), account, periodText, lines, totals };
}

// ── Штатные сотрудники ──

export interface OnecStaffRow { fullName: string; tabNo: string; position: string; hiredAt: string | null; department: string | null }

export function parseOnecStaff(file: Buffer): { company: string; rows: OnecStaffRow[] } {
  const rows = readFirstSheet(file);
  const h = rows.findIndex((r) => /^сотрудник$/i.test(cellStr(r[0])) && r.some((c) => /табельный/i.test(cellStr(c))));
  if (h < 0) throw new Error('ONEC_FORMAT: не найдена строка «Сотрудник | Табельный номер | Должность | Дата приема»');
  const header = rows[h]!;
  const c = { tab: colIndex(header, 'Табельный'), pos: colIndex(header, 'Должность'), hired: colIndex(header, 'Дата приема') };
  const company = rows.slice(0, h).map((r) => cellStr(r[0])).filter((v) => v && !/^(штатные|отбор|подразделение)/i.test(v)).at(-1) ?? '';
  const out: OnecStaffRow[] = [];
  let department: string | null = null;
  for (const r of rows.slice(h + 1)) {
    const name = cellStr(r[0]);
    if (!name) continue;
    const tabNo = cellStr(r[c.tab]);
    if (!tabNo) { department = name; continue; } // строка подразделения — только первая колонка
    out.push({ fullName: name, tabNo, position: cellStr(r[c.pos]), hiredAt: cellDate(r[c.hired]), department });
  }
  return { company, rows: out };
}
