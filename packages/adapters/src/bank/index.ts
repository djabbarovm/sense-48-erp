export * from './types.js';
export * from './unifiedCsv.js';
export * from './trustbank.js';

import { TrustbankXlsxParser } from './trustbank.js';
import { UnifiedCsvParser } from './unifiedCsv.js';
import type { BankStatementParser } from './types.js';

export function createStatementParser(format: 'UNIFIED_CSV' | 'TRUSTBANK_XLSX'): BankStatementParser {
  return format === 'TRUSTBANK_XLSX' ? new TrustbankXlsxParser() : new UnifiedCsvParser();
}
