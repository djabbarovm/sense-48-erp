/**
 * E-04+: выгрузка платёжных поручений в формате «1CClientBankExchange» —
 * де-факто стандарт обмена 1С ↔ Клиент-Банк (v8.1c.ru, «Стандарт обмена с
 * системами "Клиент банка"», версия формата 1.02). Файл понимают и
 * 1С:Бухгалтерия (загрузка платёжек), и банковские Клиент-Банки.
 * Узбекская специфика: в поле БИК передаётся МФО банка (5 цифр).
 * Кодировка Windows-1251 (ключ «Кодировка=Windows»).
 */
import iconv from 'iconv-lite';

export interface ClientBankPayer {
  name: string;
  taxId: string;
  account: string; // полный счёт (20 цифр)
  bankName: string;
  mfo: string;
}

export interface ClientBankPaymentOrder {
  number: string; // номер платёжки (цифры)
  date: Date;
  amountMinor: bigint; // тийины
  payee: ClientBankPayer;
  purpose: string;
}

export interface ClientBankExportInput {
  sender?: string;
  payer: ClientBankPayer;
  orders: ClientBankPaymentOrder[];
  createdAt?: Date;
}

const dmy = (date: Date) => {
  const d = String(date.getUTCDate()).padStart(2, '0');
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${d}.${m}.${date.getUTCFullYear()}`;
};
const hms = (date: Date) => date.toISOString().slice(11, 19);
const soum = (minor: bigint) => `${minor / 100n}.${String(minor % 100n).padStart(2, '0')}`;
/** Формат строчный: перевод строки внутри значения запрещён. */
const clean = (value: string) => value.replace(/[\r\n]+/g, ' ').trim();

export function buildClientBankExchange(input: ClientBankExportInput): Buffer {
  const now = input.createdAt ?? new Date();
  const dates = input.orders.map((o) => o.date.getTime());
  const from = new Date(Math.min(...(dates.length ? dates : [now.getTime()])));
  const to = new Date(Math.max(...(dates.length ? dates : [now.getTime()])));

  const lines: string[] = [
    '1CClientBankExchange',
    'ВерсияФормата=1.02',
    'Кодировка=Windows',
    `Отправитель=${clean(input.sender ?? 'Finance OS')}`,
    'Получатель=',
    `ДатаСоздания=${dmy(now)}`,
    `ВремяСоздания=${hms(now)}`,
    `ДатаНачала=${dmy(from)}`,
    `ДатаКонца=${dmy(to)}`,
    `РасчСчет=${input.payer.account}`,
  ];
  for (const order of input.orders) {
    lines.push(
      'СекцияДокумент=Платежное поручение',
      `Номер=${clean(order.number).replace(/\D/g, '') || '1'}`,
      `Дата=${dmy(order.date)}`,
      `Сумма=${soum(order.amountMinor)}`,
      `ПлательщикСчет=${input.payer.account}`,
      `Плательщик=${clean(input.payer.name)}`,
      `ПлательщикИНН=${input.payer.taxId}`,
      `Плательщик1=${clean(input.payer.name)}`,
      `ПлательщикРасчСчет=${input.payer.account}`,
      `ПлательщикБанк1=${clean(input.payer.bankName)}`,
      `ПлательщикБИК=${input.payer.mfo}`,
      `ПолучательСчет=${order.payee.account}`,
      `Получатель=${clean(order.payee.name)}`,
      `ПолучательИНН=${order.payee.taxId}`,
      `Получатель1=${clean(order.payee.name)}`,
      `ПолучательРасчСчет=${order.payee.account}`,
      `ПолучательБанк1=${clean(order.payee.bankName)}`,
      `ПолучательБИК=${order.payee.mfo}`,
      'ВидОплаты=01',
      `НазначениеПлатежа=${clean(order.purpose)}`,
      'КонецДокумента',
    );
  }
  lines.push('КонецФайла', '');
  return iconv.encode(lines.join('\r\n'), 'win1251');
}

/** Обратное чтение (для тестов и проверки файла перед отправкой). */
export function parseClientBankExchange(file: Buffer): { header: Record<string, string>; orders: Record<string, string>[] } {
  const text = iconv.decode(file, 'win1251');
  const header: Record<string, string> = {};
  const orders: Record<string, string>[] = [];
  let current: Record<string, string> | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (line === 'СекцияДокумент=Платежное поручение') {
      current = {};
      continue;
    }
    if (line === 'КонецДокумента') {
      if (current) orders.push(current);
      current = null;
      continue;
    }
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq);
    const value = line.slice(eq + 1);
    if (current) current[key] = value;
    else header[key] = value;
  }
  return { header, orders };
}
