/**
 * Trustbank «ABS/Клиент-Банк» — парсер реальной выгрузки «Сведения о работе счета»
 * (XLSX). Формат по образцу выписки PALYM GROUP:
 *   [0] "00491 / ТОШКЕНТ Ш., "ТРАСТБАНК" XАБ | ABS/Клиент-Банк Изг: 07.09.2026"
 *   [1] "Сведения о работе счета c 01.08.2026 по 31.08.2026"
 *   [2] "Cчет: 2020...          "PALYM GROUP" ...          ИНН : 312425792"
 *   [3] "Остаток на начало периода: … | Остаток на конец периода: …"
 *   [4] Дата | Cчет/ИНН | № док | Оп | МФО | Оборот Дебет | Оборот Кредит | Назначение платежа
 *   [5+] строки; «Cчет/ИНН» = "<счёт>/<ИНН>/<наименование>"; дата "M/D/YY H:mm".
 * Дебет = списание (OUT), Кредит = зачисление (IN).
 */
import * as XLSX from 'xlsx';
import type { BankStatementParser, ParsedBankRow } from './types.js';

function toMinor(value: string): bigint {
  const normalized = value.replace(/[\s\u00a0]/g, '').replace(',', '.');
  if (!normalized) return 0n;
  const [int = '0', frac = ''] = normalized.split('.');
  return BigInt(int || '0') * 100n + BigInt(frac.slice(0, 2).padEnd(2, '0') || '0');
}

/** "8/1/26 11:18" | "01.08.2026" → YYYY-MM-DD */
function toIsoDate(value: string): string {
  const datePart = value.trim().split(/\s+/)[0] ?? '';
  const slash = datePart.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    const [, m, d, y] = slash;
    const year = y!.length === 2 ? `20${y}` : y!;
    return `${year}-${m!.padStart(2, '0')}-${d!.padStart(2, '0')}`;
  }
  const dot = datePart.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (dot) {
    const [, d, m, y] = dot;
    return `${y}-${m!.padStart(2, '0')}-${d!.padStart(2, '0')}`;
  }
  return datePart;
}

export interface TrustbankStatementMeta {
  accountNumber?: string;
  ownTaxId?: string;
  openingBalanceMinor?: bigint;
  closingBalanceMinor?: bigint;
  periodFrom?: string;
  periodTo?: string;
}

export class TrustbankXlsxParser implements BankStatementParser {
  readonly format = 'TRUSTBANK_XLSX';
  meta: TrustbankStatementMeta = {};

  parse(file: Buffer): ParsedBankRow[] {
    const workbook = XLSX.read(file, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return [];
    const rows = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[sheetName]!, {
      header: 1,
      raw: false,
      defval: '',
    });

    // метаданные из шапки
    for (const row of rows.slice(0, 6)) {
      const line = row.join(' ');
      const acc = line.match(/C?чет:\s*(\d{20})/i);
      if (acc) this.meta.accountNumber = acc[1]!;
      const inn = line.match(/ИНН\s*:\s*(\d{9})/);
      if (inn) this.meta.ownTaxId = inn[1]!;
      const period = line.match(/c\s+(\d{2}\.\d{2}\.\d{4})\s+по\s+(\d{2}\.\d{2}\.\d{4})/);
      if (period) {
        this.meta.periodFrom = toIsoDate(period[1]!);
        this.meta.periodTo = toIsoDate(period[2]!);
      }
      const opening = line.match(/начало периода:\s*([\d\s\u00a0.,]+)/);
      if (opening) this.meta.openingBalanceMinor = toMinor(opening[1]!);
      const closing = line.match(/конец периода:\s*([\d\s\u00a0.,]+)/);
      if (closing) this.meta.closingBalanceMinor = toMinor(closing[1]!);
    }

    const headerIdx = rows.findIndex((r) => r[0]?.trim() === 'Дата' && r.join(';').includes('Назначение'));
    if (headerIdx === -1) throw new Error('TRUSTBANK_XLSX: не найден заголовок таблицы («Дата … Назначение платежа»)');

    const out: ParsedBankRow[] = [];
    for (const row of rows.slice(headerIdx + 1)) {
      const [date, counterparty, docNo, , mfo, debit, credit, ...purposeCols] = row as [
        string, string, string, string, string, string, string, ...string[],
      ];
      // строка данных начинается с даты; повторные заголовки/итоги пропускаем
      if (!date?.trim() || !/^\d{1,2}[./]\d{1,2}[./]\d{2,4}/.test(date.trim())) continue;
      const debitMinor = toMinor(debit ?? '');
      const creditMinor = toMinor(credit ?? '');
      if (debitMinor === 0n && creditMinor === 0n) continue;
      const amountMinor = creditMinor > 0n ? creditMinor : -debitMinor;
      // "Cчет/ИНН/Наименование"
      const [account = '', taxId = '', ...nameParts] = (counterparty ?? '').split('/');
      const iso = toIsoDate(date);
      const purpose = purposeCols.join(' ').trim();
      const row_: ParsedBankRow = {
        // № док у банка не уникален (Payme шлёт "1") — добавляем дату, направление и сумму
        externalId: `TB-${iso}-${docNo || 'X'}-${amountMinor < 0n ? 'D' : 'C'}${(amountMinor < 0n ? -amountMinor : amountMinor).toString()}`,
        bookingDate: iso,
        valueDate: iso,
        amountMinor,
        currency: 'UZS',
        counterpartyName: nameParts.join('/').trim() || account,
        purpose,
        raw: { date, counterparty: counterparty ?? '', docNo: docNo ?? '', mfo: mfo ?? '' },
      };
      const cleanTaxId = taxId.trim();
      if (/^\d{9}$/.test(cleanTaxId) && cleanTaxId !== '000000000') row_.counterpartyTaxId = cleanTaxId;
      if (account) row_.counterpartyAccountMasked = `****${account.replace(/\D/g, '').slice(-4)}`;
      if (mfo?.trim()) row_.counterpartyMfo = mfo.trim();
      out.push(row_);
    }
    return out;
  }
}
