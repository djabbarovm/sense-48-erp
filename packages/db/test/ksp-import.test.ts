import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseKspWorkbook } from '@finance-os/adapters';
import { unsafeCreateTenantContext, type TenantContext } from '@finance-os/core';
import { prisma } from '../src/client.js';
import { importKspBook } from '../src/services/kspImport.js';
import { verifyAuditChain } from '../src/audit.js';

/** H-01: импорт книги KSP — парсер + идемпотентная загрузка. Fixture синтетический. */

function buildFixture(): Buffer {
  const wb = XLSX.utils.book_new();
  const sheet = (name: string, rows: unknown[][]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);

  sheet('Баланс по контрагентам', [
    ['Дата', 'Поставщик', 'Авансы поставщиков', 'Задолженность перед поставщиками', 'Задолженность перед поставщиками', 'ИТОГО', 'Период'],
    [new Date('2026-07-31'), 'ООО Тест Фуд', 0, -1000000, -1000000, '-1 000 000,00', '72026'],
    [new Date('2026-08-31'), 'ООО Тест Фуд', -500, -2000000.5, -2000500.5, 'x', '82026'],
    [new Date('2026-08-31'), 'ООО Переплата', 300000, 0, 300000, 'x', '82026'],
  ]);
  sheet('Контрагенты', [
    [],
    [null, 'Покупатели'],
    [null, '№', 'Контрагент', 'Остаток на начало периода', 'Продажа', 'Оплата', 'Начисления', 'Остаток на конец периода', 'Продажа', 'Оплата', 'Начисления', 'Остаток на конец периода'],
    [null, 1, 'ООО Клиент Один', null, 100, -50, 0, 5000000, 0, 0, 0, 5000000],
    [null, 2, 'ООО Клиент Аванс', null, 0, -70, 0, -700000, null, null, null, null],
    [null, 'Поставщики'],
    [null, 1, 'Хостес', null, 0, 10, -10, 0],
  ]);
  sheet('Маппинг', [
    ['Маппинг операций'],
    ['Наименование из выписки', 'Назначение (паттерн)', 'Тип операции', 'Контрагент', 'ИНН', 'Статья расхода', 'Дата добавления', 'Источник'],
    ['TEST FOOD LLC', null, 'Операции с поставщиками', 'ООО Тест Фуд', null, 'Продукты для кухни', new Date('2026-06-06'), 'справочник'],
    ['MOBIUZ', 'связь', 'Текущие расходы', 'Mobiuz', null, 'Связь и интернет', new Date('2026-06-06'), 'вручную'],
  ]);
  sheet('Справочник', [
    [],
    [null, 'Услуги', null, 'Приход', 'Расход', null, 'Статья', null, 'Контрагенты', 'Тип контрагента', 'Описание', null, 'Статья', 'Признак'],
    [null, 'Аренда локации', null, 'x', 'y', null, 'z', null, 'KSP', 'Прочий', null, null, 'Аренда посуды', 'Начисление'],
    [null, 'Кейтеринг', null, null, null, null, null, null, null, null, null, null, 'Зарплата официантов', 'Начисление'],
  ]);
  sheet('Касса', [
    [null, 'Касса'],
    [null, 'Дата операции', 'Приход/Расход', 'Контрагент', 'Текущие расходы', 'Приход', 'Расход', 'Способ оплаты', 'Валюта', 'Курс валюты', 'Приход в основной валюте', 'Расход в основной валюте', 'Комментарии'],
    [null, new Date('2026-08-20'), null, 'Продукты', 'Закуп', null, 250000, 'Наличные', 'UZS', null, 0, 250000, 'рынок'],
    [null, new Date('2026-09-05'), null, 'Google', null, null, 7, 'Наличные', 'USD', 12000, 0, 84000, null],
    [null, new Date('2026-09-06'), null, 'Выручка', null, 1000000, null, 'Наличные', 'UZS', null, 1000000, 0, null],
  ]);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

let ctx: TenantContext;

describe('H-01: импорт книги KSP', () => {
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({ data: { slug: `t-ksp-${Date.now()}`, legalName: 'KSP T', taxId: '300000905' } });
    ctx = unsafeCreateTenantContext({
      tenantId: tenant.id, tenantSlug: tenant.slug, userId: crypto.randomUUID(),
      roles: ['FINANCE_OPS_LEAD', 'JUNIOR_FINANCE', 'ACCOUNTANT'],
    });
  });
  afterAll(async () => prisma.$disconnect());

  it('парсер: последний срез AP, знаки, правая колонка AR, статьи, касса в тийинах', () => {
    const book = parseKspWorkbook(buildFixture());
    expect(book.apAsOf.toISOString().slice(0, 10)).toBe('2026-08-31');
    expect(book.vendors).toContain('ООО Тест Фуд');
    const debt = book.apBalances.find((b) => b.vendorName === 'ООО Тест Фуд');
    expect(debt?.netMinor).toBe(-200050050n); // (-500 + -2000000.5) * 100
    expect(book.apBalances.find((b) => b.vendorName === 'ООО Переплата')?.netMinor).toBe(30000000n);
    expect(book.arBalances).toEqual([
      { customerName: 'ООО Клиент Один', netMinor: 500000000n },
      { customerName: 'ООО Клиент Аванс', netMinor: -70000000n }, // правая непустая колонка
    ]);
    expect(book.categories).toEqual(expect.arrayContaining(['Аренда посуды', 'Зарплата официантов', 'Продукты для кухни', 'Связь и интернет']));
    expect(book.matchRules).toHaveLength(2);
    expect(book.cashTx.map((c) => c.amountMinor)).toEqual([-25000000n, -8400000n, 100000000n]);
  });

  it('импорт: сальдо-документы, авансы в отчёт, касса IGNORED/UNMATCHED; идемпотентно (BR-070 аудит цел)', async () => {
    const book = parseKspWorkbook(buildFixture());
    const r1 = await importKspBook(ctx, book);
    expect(r1.vendorsCreated).toBe(2);
    expect(r1.apInvoicesCreated).toBe(1);
    expect(r1.apTotalMinor).toBe(200050050n);
    expect(r1.vendorAdvances).toEqual([{ vendorName: 'ООО Переплата', amountMinor: 30000000n }]);
    expect(r1.arInvoicesCreated).toBe(1);
    expect(r1.customerAdvances).toEqual([{ customerName: 'ООО Клиент Аванс', amountMinor: 70000000n }]);
    expect(r1.matchRulesUpserted).toBe(2);
    expect(r1.cashTxCreated).toBe(3);

    // импортированный поставщик требует верификации, платить на него нельзя
    const vendor = await prisma.vendor.findFirstOrThrow({ where: { tenantId: ctx.tenantId, displayName: 'ООО Тест Фуд' } });
    expect(vendor.status).toBe('PENDING_VERIFICATION');

    // касса: старое IGNORED, свежее UNMATCHED
    const cash = await prisma.bankTransaction.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { bookingDate: 'asc' } });
    expect(cash.map((c) => c.matchStatus)).toEqual(['IGNORED', 'UNMATCHED', 'UNMATCHED']);

    // повторный запуск ничего не дублирует
    const r2 = await importKspBook(ctx, book);
    expect(r2.vendorsCreated).toBe(0);
    expect(r2.apInvoicesCreated).toBe(0);
    expect(r2.arInvoicesCreated).toBe(0);
    expect(r2.cashTxCreated).toBe(0);

    expect((await verifyAuditChain(ctx.tenantId)).valid).toBe(true);
  });

  it('permission: роль без vendor.create получает 403', async () => {
    const viewer = unsafeCreateTenantContext({ tenantId: ctx.tenantId, tenantSlug: 'x', userId: crypto.randomUUID(), roles: ['OWNER'] });
    await expect(importKspBook(viewer, parseKspWorkbook(buildFixture()))).rejects.toThrow(/vendor.create|403|Forbidden/i);
  });
});
