/** BankAdapter (docs/07 §1, D-17): интерфейс не зависит от банка. */

export interface ParsedBankRow {
  externalId: string;
  bookingDate: string; // YYYY-MM-DD
  valueDate: string;
  /** знак: OUT — отрицательный, IN — положительный */
  amountMinor: bigint;
  currency: string;
  counterpartyName: string;
  counterpartyTaxId?: string;
  counterpartyAccountMasked?: string;
  counterpartyMfo?: string;
  purpose: string;
  raw: Record<string, string>;
}

export interface BankStatementParser {
  /** Формат, который парсер понимает (для выбора в UI). */
  readonly format: string;
  parse(file: Buffer): ParsedBankRow[];
}
