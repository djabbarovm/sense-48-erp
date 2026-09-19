/**
 * Родной экспорт реестра документов Didox (лист «Registry»): № | Вх/Исх | Статус | Документ (тип) | Уровень риска | Договор (№ от) |
 * Наименование контрагента | ИНН контрагента | Номер документа | Дата документа | Сумма без НДС | Сумма НДС | Сумма с НДС | … | ID у роуминга.
 * Вторая строка — подзаголовки табличной части (товары), строка «Итого» — конец.
 */
import { cellDate, cellMinor, cellStr, readFirstSheet } from '../onec/exports.js';
import type { EdoDocumentStatus } from './types.js';

export type DidoxDocKind = 'CONTRACT' | 'SF' | 'ACT' | 'OTHER';

export interface DidoxExportRow {
  no: number;
  direction: 'IN' | 'OUT';
  statusRaw: string;
  status: EdoDocumentStatus | null;
  docTypeRaw: string;
  docType: DidoxDocKind;
  contractNumber: string | null;
  contractDate: string | null;
  counterpartyName: string;
  counterpartyTaxId: string;
  /** ИНН из 14 цифр — ПИНФЛ физлица. */
  isPerson: boolean;
  number: string;
  date: string | null;
  amountNet: bigint | null;
  vat: bigint | null;
  amountGross: bigint | null;
  vatExempt: boolean;
  edoDocumentId: string | null;
}

export function mapDidoxStatus(raw: string): EdoDocumentStatus | null {
  const s = raw.toLowerCase();
  if (/подписан/.test(s)) return 'SIGNED';
  if (/ожида|отправлен/.test(s)) return 'SENT';
  if (/отклон/.test(s)) return 'REJECTED';
  if (/отмен|аннул/.test(s)) return 'CANCELLED';
  if (/чернов/.test(s)) return 'DRAFT';
  if (/исправ|корректир/.test(s)) return 'CORRECTED';
  return null;
}

export function mapDidoxDocType(raw: string): DidoxDocKind {
  const s = raw.toLowerCase();
  if (/договор/.test(s)) return 'CONTRACT';
  if (/сч[её]т-?фактур|сф\b/.test(s)) return 'SF';
  if (/\bакт/.test(s)) return 'ACT';
  return 'OTHER';
}

export function parseDidoxRegistryExport(file: Buffer): { rows: DidoxExportRow[]; warnings: string[] } {
  const rows = readFirstSheet(file);
  const h = rows.findIndex((r) => r.some((c) => /^статус$/i.test(cellStr(c))) && r.some((c) => /ИНН контрагента/i.test(cellStr(c))));
  if (h < 0) throw new Error('DIDOX_FORMAT: не найдены заголовки реестра Didox («Статус», «ИНН контрагента»)');
  const header = rows[h]!;
  const ci = (label: RegExp) => header.findIndex((c) => label.test(cellStr(c)));
  const c = { no: ci(/^№$/), dir: ci(/^вх\/исх/i), status: ci(/^статус$/i), type: ci(/^документ/i), contract: ci(/^договор/i), name: ci(/наименование контрагента/i), inn: ci(/ИНН контрагента/i), num: ci(/^номер документа/i), date: ci(/^дата документа/i), net: ci(/^сумма без ндс/i), vat: ci(/^сумма ндс/i), gross: ci(/^сумма с ндс/i), roaming: ci(/id у роуминга/i) };
  const out: DidoxExportRow[] = [];
  const warnings: string[] = [];
  for (const r of rows.slice(h + 1)) {
    const noRaw = cellStr(r[c.no]);
    if (/^итого/i.test(noRaw)) break;
    if (!/^\d+$/.test(noRaw)) continue; // подзаголовок табличной части и пустые строки
    const no = Number(noRaw);
    const contractRaw = cellStr(r[c.contract]);
    const cm = contractRaw.match(/^№?\s*(.+?)\s+от\s+(\d{1,2}\.\d{1,2}\.\d{4})\s*$/);
    const taxId = cellStr(r[c.inn]).replace(/\D/g, '');
    const gross = cellMinor(r[c.gross]); const net = cellMinor(r[c.net]); const vatCell = cellStr(r[c.vat]);
    const statusRaw = cellStr(r[c.status]); const docTypeRaw = cellStr(r[c.type]);
    const status = mapDidoxStatus(statusRaw);
    if (!status) warnings.push(`№${no}: неизвестный статус «${statusRaw}»`);
    out.push({
      no, direction: /исх/i.test(cellStr(r[c.dir])) ? 'OUT' : 'IN', statusRaw, status, docTypeRaw, docType: mapDidoxDocType(docTypeRaw),
      contractNumber: cm ? cm[1]!.trim() : contractRaw ? contractRaw.replace(/^№\s*/, '') : null, contractDate: cm ? cellDate(cm[2]) : null,
      counterpartyName: cellStr(r[c.name]).replace(/["«»`'’]+/g, ' ').replace(/\s+/g, ' ').trim(), counterpartyTaxId: taxId, isPerson: taxId.length === 14,
      number: cellStr(r[c.num]).replace(/\s+/g, ' '), date: cellDate(r[c.date]),
      amountNet: net, vat: cellMinor(r[c.vat]), amountGross: gross, vatExempt: /без ндс/i.test(vatCell), edoDocumentId: cellStr(r[c.roaming]) || null,
    });
  }
  return { rows: out, warnings };
}
