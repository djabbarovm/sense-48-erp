/** F-03: month-end pack XLSX (данные готовит db/close, здесь — только сборка книги). */
import * as XLSX from 'xlsx';

export interface MonthEndPackInput {
  period: string;
  tenantName: string;
  checklist: { key: string; ok: boolean; count: number }[];
  budget: Record<string, string>[];
  apAging: Record<string, string>[];
  arAging: Record<string, string>[];
  taxes: Record<string, string>[];
  events: Record<string, string>[];
  exceptions: Record<string, string>[];
  cashWeeks: Record<string, string>[];
}

function sheetOf(rows: Record<string, string>[], emptyNote: string): XLSX.WorkSheet {
  if (rows.length === 0) return XLSX.utils.aoa_to_sheet([[emptyNote]]);
  return XLSX.utils.json_to_sheet(rows);
}

export function buildMonthEndPackXlsx(input: MonthEndPackInput): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      [`Month-end pack — ${input.tenantName}`],
      [`Период: ${input.period}`],
      [],
      ['Чеклист', 'Статус', 'Открытых'],
      ...input.checklist.map((row) => [row.key, row.ok ? 'OK' : 'ОТКРЫТО', row.count]),
    ]),
    'Summary',
  );
  XLSX.utils.book_append_sheet(workbook, sheetOf(input.budget, 'Бюджет пуст'), 'Budget vs actual');
  XLSX.utils.book_append_sheet(workbook, sheetOf(input.apAging, 'Кредиторки нет'), 'AP aging');
  XLSX.utils.book_append_sheet(workbook, sheetOf(input.arAging, 'Дебиторки нет'), 'AR aging');
  XLSX.utils.book_append_sheet(workbook, sheetOf(input.taxes, 'Налогов за период нет'), 'Taxes');
  XLSX.utils.book_append_sheet(workbook, sheetOf(input.events, 'Событий за период нет'), 'Events');
  XLSX.utils.book_append_sheet(workbook, sheetOf(input.exceptions, 'Exceptions не было'), 'Exceptions');
  XLSX.utils.book_append_sheet(workbook, sheetOf(input.cashWeeks, '—'), 'Cash 13w');
  return Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
}
