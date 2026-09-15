import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unsafeCreateTenantContext, type TenantContext } from '@finance-os/core';
import { prisma } from '../src/client.js';
import { getBreakEven, getMorning, upsertCostNorm, upsertFixedCost } from '../src/services/ceo.js';

/** H-07 (docs/15): формулы точки безубыточности и «итог одной строкой». */

let ctx: TenantContext;
const NOW = new Date('2026-09-15T06:00:00Z');
const PERIOD = '2026-09';

describe('H-07: CEO break-even', () => {
  beforeAll(async () => {
    const t = await prisma.tenant.create({ data: { slug: `t-ceo-${Date.now()}`, legalName: 'CEO T', taxId: '300000906' } });
    ctx = unsafeCreateTenantContext({ tenantId: t.id, tenantSlug: t.slug, userId: crypto.randomUUID(), roles: ['OWNER', 'FINANCE_OPS_LEAD'] });
    await upsertFixedCost(ctx, { unit: 'ROOFTOP', period: PERIOD, name: 'Аренда', amountMinor: 30_000_000_00n });
    await upsertFixedCost(ctx, { unit: 'ROOFTOP', period: PERIOD, name: 'ФОТ', amountMinor: 30_000_000_00n });
    await upsertCostNorm(ctx, 'BANQUET', 40); // маржа 60%
    // состоявшийся банкет: выручка 50 млн → маржа 30 млн (половина fixed)
    await prisma.event.create({ data: { tenantId: t.id, number: 'EVT-C1', name: 'Прошёл', eventDate: new Date('2026-09-05'), format: 'BANQUET', revenueBudgetMinor: 50_000_000_00n, status: 'HELD' } });
    // подтверждённый будущий: ещё 60 млн → маржа 36 млн, кумулятивно 66 ≥ 60 — проходим 22.09
    await prisma.event.create({ data: { tenantId: t.id, number: 'EVT-C2', name: 'Будет', eventDate: new Date('2026-09-22'), format: 'BANQUET', revenueBudgetMinor: 60_000_000_00n, status: 'CONFIRMED' } });
    // предварительная бронь не считается в прогноз
    await prisma.event.create({ data: { tenantId: t.id, number: 'EVT-C3', name: 'Бронь', eventDate: new Date('2026-09-28'), format: 'BANQUET', revenueBudgetMinor: 500_000_000_00n, status: 'QUOTED' } });
  });
  afterAll(async () => prisma.$disconnect());

  it('факт не прошли, по прогнозу пройдём — с датой события, закрывающего фикс', async () => {
    const be = await getBreakEven(ctx, 'ROOFTOP', PERIOD, NOW);
    expect(be.fixedMinor).toBe(60_000_000_00n);
    expect(be.revenueActualMinor).toBe(50_000_000_00n);
    expect(be.marginActualMinor).toBe(30_000_000_00n); // 50 × (1−0.40)
    expect(be.passedFact).toBe(false);
    expect(be.passedForecast).toBe(true);
    expect(be.passDateForecast?.toISOString().slice(0, 10)).toBe('2026-09-22');
    expect(be.revenueConfirmedFutureMinor).toBe(60_000_000_00n); // QUOTED не входит
    expect(be.profitForecastMinor).toBe(6_000_000_00n); // 66 − 60 млн маржи
  });

  it('итог одной строкой: дата прохождения и число решений', async () => {
    const m = await getMorning(ctx, NOW);
    expect(m.summary.join(' ')).toMatch(/пройдёт 22 сентября/);
    expect(m.summary.join(' ')).toMatch(/Sense: заполните постоянные расходы/);
    expect(m.occupancy.confirmed30).toBe(1);
    expect(m.occupancy.prelim30).toBe(1);
  });

  it('без права dashboard.owner — 403', async () => {
    const junior = unsafeCreateTenantContext({ tenantId: ctx.tenantId, tenantSlug: 'x', userId: crypto.randomUUID(), roles: ['JUNIOR_FINANCE'] });
    await expect(getBreakEven(junior, 'ROOFTOP', PERIOD, NOW)).rejects.toThrow();
  });
});
