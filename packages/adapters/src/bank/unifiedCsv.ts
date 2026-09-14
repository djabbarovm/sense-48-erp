/** Unified statement CSV (docs/07 §1): UTF-8, `;`, header обязателен. */
import type { BankStatementParser, ParsedBankRow } from './types.js';

const HEADER =
  'external_id;booking_date;value_date;amount;currency;direction;counterparty_name;counterparty_tax_id;counterparty_account;counterparty_mfo;purpose';

function toMinor(decimal: string): bigint {
  const normalized = decimal.trim().replace(/\s/g, '').replace(',', '.');
  const [int = '0', frac = ''] = normalized.split('.');
  return BigInt(int) * 100n + BigInt(frac.slice(0, 2).padEnd(2, '0') || '0');
}

const mask = (account: string) => (account ? `****${account.replace(/\D/g, '').slice(-4)}` : '');

export class UnifiedCsvParser implements BankStatementParser {
  readonly format = 'UNIFIED_CSV';

  parse(file: Buffer): ParsedBankRow[] {
    const lines = file.toString('utf8').split(/\r?\n/).filter((l) => l.trim());
    if (!lines[0] || lines[0].trim() !== HEADER) {
      throw new Error(`UNIFIED_CSV: ожидается заголовок "${HEADER}"`);
    }
    return lines.slice(1).map((line, i) => {
      const cols = line.split(';');
      if (cols.length < 11) throw new Error(`UNIFIED_CSV: строка ${i + 2} — мало колонок`);
      const [externalId, bookingDate, valueDate, amount, currency, direction, name, taxId, account, mfo, ...purpose] =
        cols as [string, string, string, string, string, string, string, string, string, string, ...string[]];
      const minor = toMinor(amount);
      const row: ParsedBankRow = {
        externalId,
        bookingDate,
        valueDate,
        amountMinor: direction === 'OUT' ? -minor : minor,
        currency: currency || 'UZS',
        counterpartyName: name,
        purpose: purpose.join(';'),
        raw: { line },
      };
      if (taxId) row.counterpartyTaxId = taxId;
      if (account) row.counterpartyAccountMasked = mask(account);
      if (mfo) row.counterpartyMfo = mfo;
      return row;
    });
  }
}
