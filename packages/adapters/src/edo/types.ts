/** EdoAdapter interface (docs/07 §2, D-18). Core/db зависят только от интерфейса. */

export type EdoDocumentStatus = 'DRAFT' | 'SENT' | 'SIGNED' | 'REJECTED' | 'CANCELLED' | 'CORRECTED';

export interface EdoRegistryParsedRow {
  edoDocumentId: string;
  type: string;
  number: string;
  date: string;
  sellerTaxId: string;
  sellerName: string;
  buyerTaxId: string;
  amountNet: string;
  vat: string;
  amountGross: string;
  currency: string;
  status: string;
  correctiveOf?: string;
}

export interface EdoAdapter {
  /** Парсит Excel-реестр СФ; запись в БД делает вызывающий сервис. */
  parseRegistry(file: Buffer): EdoRegistryParsedRow[];
  getDocumentStatus(edoDocumentId: string): Promise<EdoDocumentStatus>;
}
