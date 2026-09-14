/**
 * E-05: Excel-миграция (templates/README.md).
 * parseMigrationSheet — первый лист, первая строка = заголовки, строки → объекты.
 * buildTemplateXlsx — генерация шаблона: лист «Данные» (заголовки) + «Пример» + «Инструкция».
 */
import * as XLSX from 'xlsx';

export interface MigrationSheet {
  headers: string[];
  rows: Record<string, string>[]; // все значения строками; пустые ячейки → ''
}

export function parseMigrationSheet(file: Buffer): MigrationSheet {
  const workbook = XLSX.read(file, { type: 'buffer' });
  const name = workbook.SheetNames[0];
  if (!name) return { headers: [], rows: [] };
  const table = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[name]!, { header: 1, raw: false, defval: '' });
  const headers = (table[0] ?? []).map((h) => String(h).trim());
  const rows: Record<string, string>[] = [];
  for (const line of table.slice(1)) {
    if (line.every((cell) => !String(cell).trim())) continue; // пустые строки пропускаем
    const row: Record<string, string> = {};
    headers.forEach((header, i) => {
      row[header] = String(line[i] ?? '').trim();
    });
    rows.push(row);
  }
  return { headers, rows };
}

export interface TemplateSpec {
  fileName: string;
  headers: string[];
  example: string[][];
  instructions: string[]; // строки листа «Инструкция»
}

export function buildTemplateXlsx(spec: TemplateSpec): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([spec.headers]), 'Данные');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([spec.headers, ...spec.example]), 'Пример');
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(spec.instructions.map((line) => [line])),
    'Инструкция',
  );
  return Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
}
