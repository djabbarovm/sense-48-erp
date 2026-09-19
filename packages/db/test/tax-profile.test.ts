import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PermissionDeniedError, ValidationError, unsafeCreateTenantContext, type RoleCode } from '@finance-os/core';
import { prisma } from '../src/client.js';
import { applyTaxPreset, estimateTaxBase, generateTaxObligations, listTaxRules, upsertTaxRule } from '../src/services/tax.js';
import { approvePayrollRun, checkPayrollRun, createPayrollRun } from '../src/services/payroll.js';
import { importOpenArXlsx } from '../src/services/migration.js';

let tenantId: string;
const ctx = (roles: RoleCode[] = ['FINANCE_OPS_LEAD']) => unsafeCreateTenantContext({ tenantId, tenantSlug: 'x', userId: crypto.randomUUID(), roles });
const NOW = new Date('2026-09-19T12:00:00Z'); // дедлайны 15.09 (за август) и 15.10 (за сентябрь)

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { slug: `t-tax-${Date.now()}`, legalName: 'TAX', taxId: '300000223' } })).id;
  await prisma.employee.create({ data: { tenantId, fullName: 'Тестов Тест', roleTitle: 'Директор' } });
});
afterAll(async () => prisma.$disconnect());

describe('H-10: налоговый профиль (налог c оборота 4%, ЕСП 12%, НДФЛ 12% c ИНПС внутри)', () => {
  it('пресет заводит три правила до 15 числа co ставками; повтор не дублирует; только tax.approve', async () => {
    await expect(applyTaxPreset(ctx(['ACCOUNTANT']), 'UZ_TURNOVER_4')).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(applyTaxPreset(ctx(), 'NOPE')).rejects.toBeInstanceOf(ValidationError);
    expect(await applyTaxPreset(ctx(), 'UZ_TURNOVER_4')).toEqual({ created: 3, skipped: 0 });
    expect(await applyTaxPreset(ctx(), 'UZ_TURNOVER_4')).toEqual({ created: 0, skipped: 3 });
    const rules = await listTaxRules(ctx());
    expect(rules.map((r) => [r.type, r.rateBp, r.baseKind, r.dueDay])).toEqual(expect.arrayContaining([['OTHER', 400, 'TURNOVER', 15], ['SOCIAL', 1200, 'PAYROLL', 15], ['PAYROLL_TAX', 1200, 'PAYROLL', 15]]));
    expect(rules.find((r) => r.type === 'PAYROLL_TAX')?.note).toMatch(/ИНПС/);
    await expect(upsertTaxRule(ctx(), { type: 'VAT', name: 'x', dueDay: 15, rateBp: 1500 })).rejects.toBeInstanceOf(ValidationError); // ставка без базы
    expect(await prisma.auditLog.count({ where: { tenantId, action: 'tax_rule.upsert' } })).toBe(3);
  });

  it('оценка из базы: ФОТ ведомости августа × 12% и выручка августа × 4% → коридор ±10%; без данных — коридор пуст', async () => {
    const run = await createPayrollRun(ctx(), { period: '2026-08', employeeCount: 1, grossMinor: 50_000_000_00n, netMinor: 43_950_000_00n, taxesMinor: 6_050_000_00n });
    await checkPayrollRun(ctx(), run.id, ['Тестов Тест']);
    await approvePayrollRun(ctx(), run.id);
    const ar = await importOpenArXlsx(ctx(), [{ customer_tax_id: '', customer_name: 'Client A', invoice_number: 'A-1', invoice_date: '2026-08-10', amount_gross: '120000000', vat: '', currency: 'UZS', due_date: '2026-08-20', received_to_date: '120000000', event_number: '', contract_number: '' }]);
    expect(ar.errors).toEqual([]);
    expect(await estimateTaxBase(tenantId, 'PAYROLL', '2026-08')).toBe(50_000_000_00n);
    expect(await estimateTaxBase(tenantId, 'TURNOVER', '2026-08')).toBe(120_000_000_00n);
    expect(await estimateTaxBase(tenantId, 'PAYROLL', '2026-07')).toBeNull();
    expect(await generateTaxObligations(tenantId, NOW, 1)).toBe(6); // 3 правила × периоды август и сентябрь
    const aug = await prisma.taxObligation.findMany({ where: { tenantId, period: '2026-08' }, orderBy: { type: 'asc' } });
    const esp = aug.find((o) => o.type === 'SOCIAL')!; const ndfl = aug.find((o) => o.type === 'PAYROLL_TAX')!; const turnover = aug.find((o) => o.type === 'OTHER')!;
    expect([esp.baseMinor, esp.expectedMinMinor, esp.expectedMaxMinor]).toEqual([50_000_000_00n, 5_400_000_00n, 6_600_000_00n]);
    expect([ndfl.expectedMinMinor, ndfl.expectedMaxMinor]).toEqual([5_400_000_00n, 6_600_000_00n]);
    expect(ndfl.name).toMatch(/ИНПС/);
    expect([turnover.baseMinor, turnover.expectedMinMinor, turnover.expectedMaxMinor]).toEqual([120_000_000_00n, 4_320_000_00n, 5_280_000_00n]);
    expect(esp.dueDate.toISOString().slice(0, 10)).toBe('2026-09-15');
    const sep = await prisma.taxObligation.findFirst({ where: { tenantId, period: '2026-09', type: 'SOCIAL' } });
    expect([sep?.baseMinor, sep?.expectedMinMinor, sep?.dueDate.toISOString().slice(0, 10)]).toEqual([null, null, '2026-10-15']);
    expect(await generateTaxObligations(tenantId, NOW, 1)).toBe(0); // идемпотентно
  });
});
