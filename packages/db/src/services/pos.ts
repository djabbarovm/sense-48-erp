/**
 * E-03: POS/iiko — запись импортов в PosDailySales / PosInventorySnapshot /
 * PosBanquetCost. Идемпотентно (upsert по бизнес-ключам). Banquet mapping
 * связывает затраты iiko c событием (учитываются в Event P&L как POS food cost).
 */
import type { TenantContext } from '@finance-os/core';
import { parseDecimalToMinor, requirePermission } from '@finance-os/core';
import type { PosBanquetRow, PosDailySalesRow, PosInventoryRow } from '@finance-os/adapters';
import { withAudit } from '../audit.js';
import { prisma } from '../client.js';
import { whereTenant } from '../repository.js';

export interface PosImportReport {
  total: number;
  imported: number;
  updated: number;
  errors: { row: number; field: string; message: string }[];
}

const money = (value: string): bigint | null => {
  try {
    return parseDecimalToMinor(value.replace(/[\s\u00a0]/g, '') || '0');
  } catch {
    return null;
  }
};
const dateOf = (value: string): Date | null => (/^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value) : null);

export async function importPosDailySales(ctx: TenantContext, rows: PosDailySalesRow[]): Promise<PosImportReport> {
  requirePermission(ctx, 'invoice.import');
  const report: PosImportReport = { total: rows.length, imported: 0, updated: 0, errors: [] };
  await withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const date = dateOf(row.date);
      const revenue = money(row.revenueGross);
      if (!date || revenue === null || !row.outlet || !row.category) {
        report.errors.push({ row: i + 2, field: !date ? 'date' : 'revenue_gross', message: 'Неверная дата/сумма/пустое поле' });
        continue;
      }
      const key = { tenantId: ctx.tenantId, date, outlet: row.outlet, category: row.category };
      const data = {
        revenueGrossMinor: revenue,
        vatMinor: money(row.vat) ?? 0n,
        discountsMinor: money(row.discounts) ?? 0n,
        costOfSalesMinor: money(row.costOfSales) ?? 0n,
        covers: Number(row.covers) || 0,
      };
      const existing = await tx.posDailySales.findUnique({
        where: { tenantId_date_outlet_category: key },
      });
      if (existing) {
        await tx.posDailySales.update({ where: { id: existing.id }, data });
        report.updated++;
      } else {
        await tx.posDailySales.create({ data: { ...key, ...data } });
        report.imported++;
      }
    }
    return {
      result: report,
      audit: {
        action: 'pos.daily_sales_import',
        objectType: 'tenant',
        objectId: ctx.tenantId,
        after: { imported: report.imported, updated: report.updated, errors: report.errors.length },
      },
    };
  });
  return report;
}

export async function importPosInventory(ctx: TenantContext, rows: PosInventoryRow[]): Promise<PosImportReport> {
  requirePermission(ctx, 'invoice.import');
  const report: PosImportReport = { total: rows.length, imported: 0, updated: 0, errors: [] };
  await withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const date = dateOf(row.date);
      const stock = money(row.stockValue);
      if (!date || stock === null || !row.outlet) {
        report.errors.push({ row: i + 2, field: !date ? 'date' : 'stock_value', message: 'Неверная дата/сумма/пустое поле' });
        continue;
      }
      const key = { tenantId: ctx.tenantId, date, outlet: row.outlet };
      const data = {
        stockValueMinor: stock,
        purchasesMinor: money(row.purchases) ?? 0n,
        consumptionMinor: money(row.consumption) ?? 0n,
        wasteMinor: money(row.waste) ?? 0n,
        transfersMinor: money(row.transfers) ?? 0n,
        theoreticalFoodCostMinor: money(row.theoreticalFoodCost) ?? 0n,
        actualFoodCostMinor: money(row.actualFoodCost) ?? 0n,
      };
      const existing = await tx.posInventorySnapshot.findUnique({ where: { tenantId_date_outlet: key } });
      if (existing) {
        await tx.posInventorySnapshot.update({ where: { id: existing.id }, data });
        report.updated++;
      } else {
        await tx.posInventorySnapshot.create({ data: { ...key, ...data } });
        report.imported++;
      }
    }
    return {
      result: report,
      audit: {
        action: 'pos.inventory_import',
        objectType: 'tenant',
        objectId: ctx.tenantId,
        after: { imported: report.imported, updated: report.updated, errors: report.errors.length },
      },
    };
  });
  return report;
}

/** iiko banquet → event: затраты банкета привязываются к событию (P&L). */
export async function importPosBanquetMapping(ctx: TenantContext, rows: PosBanquetRow[]): Promise<PosImportReport> {
  requirePermission(ctx, 'invoice.import');
  const report: PosImportReport = { total: rows.length, imported: 0, updated: 0, errors: [] };
  const events = new Map(
    (await prisma.event.findMany({ where: { tenantId: ctx.tenantId } })).map((e) => [e.number, e.id]),
  );
  await withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const eventId = events.get(row.eventNumber);
      if (!row.iikoOrderId) {
        report.errors.push({ row: i + 2, field: 'iiko_order_id', message: 'Пустой id заказа' });
        continue;
      }
      if (!eventId) {
        report.errors.push({ row: i + 2, field: 'event_number', message: `Событие «${row.eventNumber}» не найдено` });
        continue;
      }
      const data = { eventId, foodCostMinor: money(row.foodCost) ?? 0n, beverageCostMinor: money(row.beverageCost) ?? 0n };
      const existing = await tx.posBanquetCost.findUnique({
        where: { tenantId_iikoOrderId: { tenantId: ctx.tenantId, iikoOrderId: row.iikoOrderId } },
      });
      if (existing) {
        await tx.posBanquetCost.update({ where: { id: existing.id }, data });
        report.updated++;
      } else {
        await tx.posBanquetCost.create({ data: { tenantId: ctx.tenantId, iikoOrderId: row.iikoOrderId, ...data } });
        report.imported++;
      }
    }
    return {
      result: report,
      audit: {
        action: 'pos.banquet_import',
        objectType: 'tenant',
        objectId: ctx.tenantId,
        after: { imported: report.imported, updated: report.updated, errors: report.errors.length },
      },
    };
  });
  return report;
}

export async function listPosDailySales(ctx: TenantContext, filter?: { from?: Date; to?: Date }) {
  requirePermission(ctx, 'payment.view');
  return prisma.posDailySales.findMany({
    where: whereTenant(ctx, {
      ...(filter?.from || filter?.to
        ? { date: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lte: filter.to } : {}) } }
        : {}),
    }),
    orderBy: [{ date: 'desc' }, { outlet: 'asc' }],
    take: 300,
  });
}

/** POS-затраты события (для Event P&L). */
export async function getEventPosCost(tenantId: string, eventId: string) {
  const agg = await prisma.posBanquetCost.aggregate({
    where: { tenantId, eventId },
    _sum: { foodCostMinor: true, beverageCostMinor: true },
  });
  return {
    foodCostMinor: agg._sum.foodCostMinor ?? 0n,
    beverageCostMinor: agg._sum.beverageCostMinor ?? 0n,
  };
}
