import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { normalizeCounterpartyName, parseOnecCounterparties, parseOnecOsv, parseOnecStaff } from './exports.js';
import { parseDidoxRegistryExport } from '../edo/didoxExport.js';

const xlsx = (aoa: unknown[][]): Buffer => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Лист_1'); return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer); };

describe('1С: справочник контрагентов', () => {
  it('читает ИНН/счёт/МФО, чистит банк от МФО и кавычек, физлицо по ПИНФЛ без самого ПИНФЛ, битые строки — в warnings', () => {
    const file = xlsx([
      ['Контрагент', 'ИНН', 'ПИНФЛ', 'Полное наименование контрагента', 'Номер счета', 'Банк', 'МФО'],
      ['Demo Clean Mchj', '300000001', null, 'Demo Clean Mchj', '20208000000000000001', '01158 "Kapitalbank" ATB \'\'Kapital 24\'\' filiali', '01158'],
      ['TESTOV TEST TESTOVICH', '500000002', '31205940240046', 'TESTOV TEST TESTOVICH', '20218000000000000002', '01196 "APEX BANK" AJ', 1196],
      ['Broken', '12', null, 'Broken', '123', 'Bank', '00001'],
    ]);
    const { rows, warnings } = parseOnecCounterparties(file);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ taxId: '300000001', account: '20208000000000000001', mfo: '01158', bankName: 'Kapitalbank ATB Kapital 24 filiali', isPerson: false });
    expect(rows[1]).toMatchObject({ taxId: '500000002', mfo: '01196', isPerson: true });
    expect(JSON.stringify(rows)).not.toContain('31205940240046');
    expect(warnings).toHaveLength(1);
    expect(normalizeCounterpartyName('"DEMO CLEAN" MCHJ')).toBe('demo clean');
    expect(normalizeCounterpartyName('Demo Clean Mchj')).toBe('demo clean');
  });
});

describe('1С: оборотно-сальдовая ведомость', () => {
  const osv = (account: string) => xlsx([
    ['"Demo Mgmt" Mas\'uliyati Cheklangan Jamiyati'],
    [`Оборотно-сальдовая ведомость по счету ${account} за 9 месяцев 2026 г.`],
    [],
    ['Выводимые данные:', 'БУ (данные бухгалтерского учета)'],
    [],
    ['Счет', null, 'Сальдо на начало периода', null, 'Обороты за период', null, null, 'Сальдо на конец периода'],
    ['Контрагенты', null, 'Дебет', 'Кредит', 'Дебет', 'Кредит', null, 'Дебет', 'Кредит'],
    ['Договоры'],
    [account, null, null, null, 30000000, 12000000, null, 18000000],
    ['Alpha Law Mchj', null, null, null, 25000000, 12000000, null, 13000000],
    ['№2026-01 от 26.06.2026', null, null, null, 12000000, 12000000],
    ['№2026-02 от 28.08.2026', null, null, null, 13000000, null, null, 13000000],
    ['Beta Telecom Mchj', null, null, null, 5000000, null, null, 5000000],
    ['Итого', null, null, null, 30000000, 12000000, null, 18000000],
  ]);
  it('счёт и период из заголовка, строки контрагент → договор, контрагент без договоров — одной строкой, суммы в тийинах', () => {
    const r = parseOnecOsv(osv('4310'));
    expect([r.account, r.periodText, r.company]).toEqual(['4310', '9 месяцев 2026 г.', '"Demo Mgmt" Mas\'uliyati Cheklangan Jamiyati']);
    expect(r.lines.map((l) => [l.counterparty, l.contract?.number ?? null, l.contract?.date ?? null, l.turnoverDebit, l.turnoverCredit, l.closingDebit])).toEqual([
      ['Alpha Law Mchj', '2026-01', '2026-06-26', 1_200_000_000n, 1_200_000_000n, 0n],
      ['Alpha Law Mchj', '2026-02', '2026-08-28', 1_300_000_000n, 0n, 1_300_000_000n],
      ['Beta Telecom Mchj', null, null, 500_000_000n, 0n, 500_000_000n],
    ]);
    expect(r.totals).toEqual({ closingDebit: 1_800_000_000n, closingCredit: 0n });
  });
  it('не ОСВ → ошибка формата', () => {
    expect(() => parseOnecOsv(xlsx([['Что-то другое'], ['Счет', 'Дебет']]))).toThrow(/ONEC_FORMAT/);
  });
});

describe('1С: штатные сотрудники', () => {
  it('подразделения по строкам без табельного, оклады не читаются', () => {
    const file = xlsx([
      [], ['Штатные сотрудники'], [], ['Отбор:', 'Организация Равно "Demo Mgmt" Mchj'], [], ['"Demo Mgmt" Mchj'], ['Подразделение'],
      ['Сотрудник', null, null, null, 'Табельный номер', null, 'Должность', null, 'Дата приема', 'Тарифная ставка', 'На руки'],
      ['АУП'],
      ['Тестов Тест Тестович', null, null, null, '0000001', null, 'Директор', null, new Date('2026-06-01T00:00:00Z'), 15000000, 13050000],
      ['Основное подразделение'],
      ['Примерова Прима Примеровна', null, null, null, '0000002', null, 'Операционный менеджер', null, '15.07.2026', 9000000, 7830000],
    ]);
    const r = parseOnecStaff(file);
    expect(r.company).toBe('"Demo Mgmt" Mchj');
    expect(r.rows).toEqual([
      { fullName: 'Тестов Тест Тестович', tabNo: '0000001', position: 'Директор', hiredAt: '2026-06-01', department: 'АУП' },
      { fullName: 'Примерова Прима Примеровна', tabNo: '0000002', position: 'Операционный менеджер', hiredAt: '2026-07-15', department: 'Основное подразделение' },
    ]);
    expect(JSON.stringify(r)).not.toContain('15000000');
  });
});

describe('Didox: экспорт реестра документов', () => {
  it('заголовки по именам, подзаголовок и «Итого» пропускаются, статус/тип/договор/суммы/ПИНФЛ', () => {
    const file = xlsx([
      ['№', 'Вх/Исх', 'Статус', 'Документ (тип)', 'Уровень риска', 'Договор (№ от)', 'Наименование контрагента', 'ИНН контрагента', 'Номер документа', 'Дата документа', 'Сумма без НДС', 'Сумма НДС', 'Сумма с НДС', 'Льготы', 'Комиссионер', 'Односторонний документ', 'ID у роуминга', 'Дов. лицо', 'Перечень товаров'],
      [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, 'Наименование товаров, услуг', 'Ед. изм.', 'Кол-во'],
      [1, 'Вх.', 'Подписан', 'Произвольный документ', null, '№77 от 08.09.2026', '"DEMO TELECOM" AJ', '300000003', '1', '2026-09-09', null, 'без НДС', null, null, 'Нет', 'Нет', null],
      [2, 'Вх.', 'Ожидает вашей подписи', 'Договор (НК)', null, 'MPA-1 от 29.07.2026', '"DEMO MALL" MCHJ', '300000004', 'Договор', '2026-07-29', 6642857.14, 797142.86, 7440000, null, 'Нет', 'Нет', 'abc123'],
      [3, 'Исх.', 'Подписан', 'Счет-фактура', null, null, 'IVANOV IVAN', '31205940240046', 'СФ-1', '2026-08-01', '1 000 000,50', '120 000,06', '1 120 000,56', null, 'Нет', 'Нет', 'def456'],
      ['Итого', null, null, null, null, null, null, null, null, null, '7 642 857,64'],
    ]);
    const { rows, warnings } = parseDidoxRegistryExport(file);
    expect(warnings).toEqual([]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ no: 1, direction: 'IN', status: 'SIGNED', docType: 'OTHER', contractNumber: '77', contractDate: '2026-09-08', counterpartyName: 'DEMO TELECOM AJ', counterpartyTaxId: '300000003', vatExempt: true, amountGross: null, edoDocumentId: null });
    expect(rows[1]).toMatchObject({ status: 'SENT', docType: 'CONTRACT', contractNumber: 'MPA-1', amountGross: 744_000_000n, vat: 79_714_286n, edoDocumentId: 'abc123' });
    expect(rows[2]).toMatchObject({ direction: 'OUT', docType: 'SF', isPerson: true, amountNet: 100_000_050n, amountGross: 112_000_056n, contractNumber: null });
  });
});
