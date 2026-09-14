/**
 * MockEdoAdapter (D-18): реестр — XLSX лист `Invoices` c колонками docs/07 §2.
 * Статусы документов хранит вызывающая сторона (E-02 добавит dev-панель).
 */
import * as XLSX from 'xlsx';
import type { EdoAdapter, EdoDocumentStatus, EdoRegistryParsedRow } from './types.js';

const _COLUMNS = [
  'edo_document_id',
  'type',
  'number',
  'date',
  'seller_tax_id',
  'seller_name',
  'buyer_tax_id',
  'amount_net',
  'vat',
  'amount_gross',
  'currency',
  'status',
  'corrective_of',
] as const;

export class MockEdoAdapter implements EdoAdapter {
  private statuses = new Map<string, EdoDocumentStatus>();

  parseRegistry(file: Buffer): EdoRegistryParsedRow[] {
    const workbook = XLSX.read(file, { type: 'buffer', cellDates: false });
    const sheetName = workbook.SheetNames.includes('Invoices') ? 'Invoices' : workbook.SheetNames[0];
    if (!sheetName) return [];
    const sheet = workbook.Sheets[sheetName]!;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: false, defval: '' });
    return rows.map((raw) => {
      const value = (key: (typeof _COLUMNS)[number]) => String(raw[key] ?? '').trim();
      const row: EdoRegistryParsedRow = {
        edoDocumentId: value('edo_document_id'),
        type: value('type'),
        number: value('number'),
        date: value('date'),
        sellerTaxId: value('seller_tax_id'),
        sellerName: value('seller_name'),
        buyerTaxId: value('buyer_tax_id'),
        amountNet: value('amount_net'),
        vat: value('vat'),
        amountGross: value('amount_gross'),
        currency: value('currency') || 'UZS',
        status: value('status'),
      };
      const corrective = value('corrective_of');
      if (corrective) row.correctiveOf = corrective;
      return row;
    });
  }

  async getDocumentStatus(edoDocumentId: string): Promise<EdoDocumentStatus> {
    return this.statuses.get(edoDocumentId) ?? 'SIGNED';
  }

  /** Для dev-панели и тестов сценариев CORRECTED/CANCELLED. */
  setDocumentStatus(edoDocumentId: string, status: EdoDocumentStatus): void {
    this.statuses.set(edoDocumentId, status);
  }
}

/** Генерация XLSX-реестра (для seed и тестов). */
export function buildRegistryXlsx(rows: EdoRegistryParsedRow[]): Buffer {
  const data = rows.map((r) => ({
    edo_document_id: r.edoDocumentId,
    type: r.type,
    number: r.number,
    date: r.date,
    seller_tax_id: r.sellerTaxId,
    seller_name: r.sellerName,
    buyer_tax_id: r.buyerTaxId,
    amount_net: r.amountNet,
    vat: r.vat,
    amount_gross: r.amountGross,
    currency: r.currency,
    status: r.status,
    corrective_of: r.correctiveOf ?? '',
  }));
  const sheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Invoices');
  return Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
}
