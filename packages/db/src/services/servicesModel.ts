/**
 * Services v1.0 (docs/20 §11.12): пакеты (recurring), referral-отчёты партнёров, аналитика валидации
 * (penetration, attach rate, повторные покупки, contribution по направлениям, каналы). GMV ≠ Revenue.
 */
import type { ServiceChannel, ServiceCustomerKind, TenantContext } from '@finance-os/core';
import { NotFoundError, ValidationError, can, costToServe, nextPackageRun, parsePartnerStatementCsv, referralFee, requirePermission } from '@finance-os/core';
import type { PartnerStatementLine, ServicePackage } from '@prisma/client';
import { withAudit } from '../audit.js';
import { prisma } from '../client.js';
import { findScopedOr404 } from '../repository.js';
import { createServiceOrder } from './serviceOrders.js';

const DEFAULT_HOUR_COST_MINOR = 4_000_000n; // 40 000 сум/час клиентского слоя — гипотеза до валидации (tenant.settings.services_hour_cost_minor)

// ── Пакеты ──

export interface PackageInput { catalogItemId: string; unitId: string; customerName?: string | null; customerKind?: ServiceCustomerKind; channel?: ServiceChannel; runsPerMonth: number; monthlyPriceMinor: bigint; startAt?: Date }

export async function createServicePackage(ctx: TenantContext, input: PackageInput, now = new Date()): Promise<ServicePackage> {
  const asOwner = !can(ctx, 'service.order');
  if (asOwner) requirePermission(ctx, 'owner.request');
  if (input.monthlyPriceMinor <= 0n) throw new ValidationError('PRICE_INVALID');
  const startAt = input.startAt ?? now;
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const item = await findScopedOr404(tx.serviceCatalogItem, ctx, input.catalogItemId);
    if (!item.active) throw new ValidationError('SERVICE_INACTIVE');
    const unit = await findScopedOr404(tx.unit, ctx, input.unitId);
    let ownerId: string | null = null;
    if (asOwner) {
      const owner = await tx.propertyOwner.findFirst({ where: { tenantId: ctx.tenantId, userId: ctx.userId }, select: { id: true } });
      if (!owner || unit.ownerId !== owner.id) throw new NotFoundError();
      ownerId = owner.id;
    }
    const created = await tx.servicePackage.create({ data: { tenantId: ctx.tenantId, catalogItemId: item.id, unitId: unit.id, ownerId, customerName: input.customerName?.trim() || null, customerKind: input.customerKind ?? (asOwner ? 'OWNER' : 'RESIDENT'), channel: input.channel ?? (asOwner ? 'PORTAL' : 'STAFF'), runsPerMonth: (nextPackageRun(startAt, input.runsPerMonth), input.runsPerMonth), monthlyPriceMinor: input.monthlyPriceMinor, currency: item.currency, startAt, nextRunAt: startAt, createdBy: ctx.userId } });
    return { result: created, audit: { action: 'service_package.create', objectType: 'service_package', objectId: created.id, after: { catalogItemId: item.id, unitId: unit.id, runsPerMonth: created.runsPerMonth, monthlyPriceMinor: created.monthlyPriceMinor.toString() } } };
  });
}

export async function cancelServicePackage(ctx: TenantContext, id: string, reason: string, now = new Date()): Promise<ServicePackage> {
  if (!reason.trim()) throw new ValidationError('REASON_REQUIRED');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const before = await findScopedOr404(tx.servicePackage, ctx, id);
    if (!can(ctx, 'service.manage')) {
      const owner = await tx.propertyOwner.findFirst({ where: { tenantId: ctx.tenantId, userId: ctx.userId }, select: { id: true } });
      if (!owner || before.ownerId !== owner.id) throw new NotFoundError();
    }
    if (before.status === 'CANCELLED') throw new ValidationError('PACKAGE_CANCELLED');
    const after = await tx.servicePackage.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: now, cancelReason: reason.trim() } });
    return { result: after, audit: { action: 'service_package.cancel', objectType: 'service_package', objectId: id, before: { status: before.status }, after: { status: 'CANCELLED', reason: reason.trim() } } };
  });
}

/** Джоб service-packages: по активным пакетам c наступившим nextRunAt создаёт заказ (цена за визит = месячная / частота) и сдвигает срок (BR-P50). */
export async function runServicePackages(tenantId: string, now = new Date()): Promise<number> {
  const due = await prisma.servicePackage.findMany({ where: { tenantId, status: 'ACTIVE', nextRunAt: { lte: now } }, include: { catalogItem: true } });
  let n = 0;
  for (const p of due) {
    const perVisit = p.monthlyPriceMinor / BigInt(p.runsPerMonth);
    const ordererId = p.createdBy ?? (await prisma.userTenantRole.findFirst({ where: { tenantId, role: 'OPERATIONS_MANAGER' }, select: { userId: true } }))?.userId;
    if (!ordererId) continue;
    const { unsafeCreateTenantContext } = await import('@finance-os/core');
    const ctx = unsafeCreateTenantContext({ tenantId, tenantSlug: 'job', userId: ordererId, roles: ['OPERATIONS_MANAGER'] });
    const order = await createServiceOrder(ctx, { catalogItemId: p.catalogItemId, unitId: p.unitId, customerName: p.customerName, customerKind: p.customerKind, channel: p.channel, packageId: p.id, scheduledAt: p.nextRunAt, source: 'API', notes: `пакет ${p.runsPerMonth}/мес` }, now);
    // цена по пакету: фиксированная месячная / частота (переписывает цену каталога)
    await prisma.serviceOrder.update({ where: { id: order.id }, data: { priceMinor: perVisit, listPriceMinor: perVisit, servicesRevenueMinor: (perVisit * BigInt(p.catalogItem.providerKind === 'PARTNER' ? p.catalogItem.commissionBp : (p.catalogItem.ownOpsFeeBp ?? 0))) / 10_000n, executorRevenueMinor: perVisit - (perVisit * BigInt(p.catalogItem.providerKind === 'PARTNER' ? p.catalogItem.commissionBp : (p.catalogItem.ownOpsFeeBp ?? 0))) / 10_000n } });
    await prisma.servicePackage.update({ where: { id: p.id }, data: { lastRunAt: now, nextRunAt: nextPackageRun(p.nextRunAt, p.runsPerMonth) } });
    n++;
  }
  return n;
}

export async function listServicePackages(ctx: TenantContext, filter: { ownerId?: string; status?: ServicePackage['status'][] } = {}) {
  if (!filter.ownerId) requirePermission(ctx, 'service.view');
  const rows = await prisma.servicePackage.findMany({ where: { tenantId: ctx.tenantId, ...(filter.ownerId ? { ownerId: filter.ownerId } : {}), ...(filter.status ? { status: { in: filter.status } } : {}) }, include: { catalogItem: { select: { name: true, category: true, providerKind: true, partnerName: true } }, orders: { select: { id: true, status: true } } }, orderBy: [{ status: 'asc' }, { nextRunAt: 'asc' }] });
  const units = new Map((await prisma.unit.findMany({ where: { id: { in: rows.map((r) => r.unitId) } }, select: { id: true, unitNo: true } })).map((u) => [u.id, u.unitNo]));
  return rows.map(({ catalogItem, orders, ...p }) => ({ ...p, serviceName: catalogItem.name, category: catalogItem.category, providerKind: catalogItem.providerKind, partnerName: catalogItem.partnerName, unitNo: units.get(p.unitId) ?? '—', ordersCount: orders.length }));
}

// ── Referral-отчёты партнёров ──

export interface StatementImportReport { partnerName: string; period: string; imported: number; skipped: number; feeMinor: bigint; baseMinor: bigint }

/** Импорт отчёта партнёра (CSV `customerRef;base;fee%`): строки идемпотентны по (партнёр, период, клиент); ставка по умолчанию — из направления REFERRAL_RECURRING этого партнёра. */
export async function importPartnerStatement(ctx: TenantContext, input: { partnerName: string; period: string; csv: string; defaultFeeBp?: number | null }): Promise<StatementImportReport> {
  requirePermission(ctx, 'service.catalog');
  if (!/^\d{4}-\d{2}$/.test(input.period)) throw new ValidationError('PERIOD_INVALID');
  const partner = input.partnerName.trim();
  if (!partner) throw new ValidationError('PARTNER_REQUIRED');
  const rows = parsePartnerStatementCsv(input.csv);
  if (rows.length === 0) throw new ValidationError('STATEMENT_EMPTY');
  const direction = await prisma.serviceCatalogItem.findFirst({ where: { tenantId: ctx.tenantId, partnerName: partner, terms: 'REFERRAL_RECURRING' } });
  const fallbackBp = input.defaultFeeBp ?? direction?.commissionBp ?? null;
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    let imported = 0; let skipped = 0; let fee = 0n; let base = 0n;
    for (const r of rows) {
      const bp = r.feeBp ?? fallbackBp;
      if (bp == null) throw new ValidationError('FEE_REQUIRED', `FEE_REQUIRED: нет ставки для ${r.customerRef} и нет referral-направления партнёра`);
      const exists = await tx.partnerStatementLine.findUnique({ where: { tenantId_partnerName_period_customerRef: { tenantId: ctx.tenantId, partnerName: partner, period: input.period, customerRef: r.customerRef } } });
      if (exists) { skipped++; continue; }
      const f = referralFee(r.baseMinor, bp);
      await tx.partnerStatementLine.create({ data: { tenantId: ctx.tenantId, partnerName: partner, period: input.period, customerRef: r.customerRef, baseMinor: r.baseMinor, feeBp: bp, feeMinor: f, currency: direction?.currency ?? 'UZS', importedBy: ctx.userId } });
      imported++; fee += f; base += r.baseMinor;
    }
    const report = { partnerName: partner, period: input.period, imported, skipped, feeMinor: fee, baseMinor: base };
    return { result: report, audit: { action: 'partner_statement.import', objectType: 'partner_statement', objectId: ctx.tenantId, after: { partner, period: input.period, imported, skipped, feeMinor: fee.toString() } } };
  });
}

export async function listPartnerStatements(ctx: TenantContext, filter: { period?: string; partnerName?: string } = {}): Promise<PartnerStatementLine[]> {
  requirePermission(ctx, 'service.view');
  return prisma.partnerStatementLine.findMany({ where: { tenantId: ctx.tenantId, ...(filter.period ? { period: filter.period } : {}), ...(filter.partnerName ? { partnerName: filter.partnerName } : {}) }, orderBy: [{ period: 'desc' }, { partnerName: 'asc' }, { customerRef: 'asc' }] });
}

// ── Аналитика валидации (Services §7–8) ──

export interface DirectionLine {
  key: string; category: string; providerKind: string; partnerName: string | null; involvement: string; terms: string;
  orders: number; gmvMinor: bigint; servicesRevenueMinor: bigint; executorRevenueMinor: bigint; costToServeMinor: bigint; contributionMinor: bigint;
  complaints: number; avgRating: number | null; avgHandlingMinutes: number; slaPct: number | null;
}

export async function getServicesAnalytics(ctx: TenantContext, days = 90, now = new Date()) {
  requirePermission(ctx, 'service.view');
  const since = new Date(now.getTime() - days * 86_400_000);
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { settings: true } });
  const hourCost = BigInt(String((tenant.settings as Record<string, unknown>).services_hour_cost_minor ?? DEFAULT_HOUR_COST_MINOR));
  const orders = await prisma.serviceOrder.findMany({ where: { tenantId: ctx.tenantId, createdAt: { gte: since }, status: { not: 'CANCELLED' } }, include: { catalogItem: { select: { category: true, involvement: true, terms: true } } } });
  const done = orders.filter((o) => o.status === 'DONE' || o.status === 'VERIFIED');
  const by = new Map<string, DirectionLine & { ratings: number[]; minutes: number[]; onTime: number; closed: number }>();
  for (const o of orders) {
    const key = `${o.catalogItem.category}:${o.providerKind}:${o.partnerName ?? ''}`;
    const l = by.get(key) ?? { key, category: o.catalogItem.category, providerKind: o.providerKind, partnerName: o.partnerName, involvement: o.catalogItem.involvement, terms: o.catalogItem.terms, orders: 0, gmvMinor: 0n, servicesRevenueMinor: 0n, executorRevenueMinor: 0n, costToServeMinor: 0n, contributionMinor: 0n, complaints: 0, avgRating: null, avgHandlingMinutes: 0, slaPct: null, ratings: [], minutes: [], onTime: 0, closed: 0 };
    l.orders++;
    l.costToServeMinor += costToServe(o.handlingMinutes, hourCost);
    l.minutes.push(o.handlingMinutes);
    if (o.complaint) l.complaints++;
    if (o.status === 'DONE' || o.status === 'VERIFIED') {
      l.gmvMinor += o.priceMinor; l.servicesRevenueMinor += o.servicesRevenueMinor; l.executorRevenueMinor += o.executorRevenueMinor;
      l.closed++; if (o.doneAt && o.doneAt <= o.dueAt) l.onTime++;
      if (o.rating != null) l.ratings.push(o.rating);
    }
    by.set(key, l);
  }
  const directions: DirectionLine[] = [...by.values()].map(({ ratings, minutes, onTime, closed, ...l }) => ({ ...l, contributionMinor: l.servicesRevenueMinor - l.costToServeMinor, avgRating: ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null, avgHandlingMinutes: minutes.length ? Math.round(minutes.reduce((a, b) => a + b, 0) / minutes.length) : 0, slaPct: closed ? Math.round((onTime / closed) * 1000) / 10 : null })).sort((a, b) => Number(b.contributionMinor - a.contributionMinor));
  // клиентская база и penetration: активные договоры (жители/офисы) + собственники c юнитами; покупатель = ownerId | unitId
  const [activeLeases, ownersWithUnits] = await Promise.all([
    prisma.leaseContract.count({ where: { tenantId: ctx.tenantId, status: { in: ['ACTIVE', 'EXPIRING'] }, type: { not: 'OWNER_USE' }, unit: { building: { kind: { not: 'MALL' } } } } }),
    prisma.propertyOwner.count({ where: { tenantId: ctx.tenantId, units: { some: {} } } }),
  ]);
  const customerKey = (o: (typeof orders)[number]) => o.ownerId ?? o.unitId ?? o.customerName ?? o.id;
  const buyers = new Map<string, number>();
  for (const o of done) buyers.set(customerKey(o), (buyers.get(customerKey(o)) ?? 0) + 1);
  const base = activeLeases + ownersWithUnits;
  const repeat = [...buyers.values()].filter((n) => n > 1).length;
  const byChannel = (['PORTAL', 'TELEGRAM', 'PHONE', 'APP', 'WALK_IN', 'STAFF'] as const).map((channel) => ({ channel, orders: orders.filter((o) => o.channel === channel).length })).filter((c) => c.orders > 0);
  const byCustomerKind = (['OWNER', 'RESIDENT', 'STR_GUEST', 'OFFICE_TENANT'] as const).map((kind) => ({ kind, orders: orders.filter((o) => o.customerKind === kind).length, gmvMinor: done.filter((o) => o.customerKind === kind).reduce((s, o) => s + o.priceMinor, 0n) }));
  const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const statements = await prisma.partnerStatementLine.groupBy({ by: ['partnerName', 'period'], where: { tenantId: ctx.tenantId, createdAt: { gte: since } }, _sum: { feeMinor: true, baseMinor: true }, _count: { _all: true } });
  const packages = await prisma.servicePackage.findMany({ where: { tenantId: ctx.tenantId, status: 'ACTIVE' }, select: { monthlyPriceMinor: true } });
  const sum = (xs: DirectionLine[], f: (l: DirectionLine) => bigint) => xs.reduce((a, l) => a + f(l), 0n);
  const referralMinor = statements.reduce((a, s) => a + (s._sum.feeMinor ?? 0n), 0n);
  return {
    days, currency: orders[0]?.currency ?? 'UZS', hourCostMinor: hourCost,
    totals: { orders: orders.length, done: done.length, gmvMinor: sum(directions, (l) => l.gmvMinor), servicesRevenueMinor: sum(directions, (l) => l.servicesRevenueMinor) + referralMinor, executorRevenueMinor: sum(directions, (l) => l.executorRevenueMinor), costToServeMinor: sum(directions, (l) => l.costToServeMinor), contributionMinor: sum(directions, (l) => l.contributionMinor) + referralMinor, referralMinor, complaints: directions.reduce((a, l) => a + l.complaints, 0) },
    directions,
    demand: { customerBase: base, buyers: buyers.size, penetrationPct: base ? Math.round((buyers.size / base) * 1000) / 10 : null, attachRate: buyers.size ? Math.round(([...buyers.values()].reduce((a, b) => a + b, 0) / buyers.size) * 100) / 100 : null, repeatBuyers: repeat, repeatPct: buyers.size ? Math.round((repeat / buyers.size) * 1000) / 10 : null },
    byChannel, byCustomerKind,
    referral: statements.map((s) => ({ partnerName: s.partnerName, period: s.period, lines: s._count._all, baseMinor: s._sum.baseMinor ?? 0n, feeMinor: s._sum.feeMinor ?? 0n })).sort((a, b) => (a.period < b.period ? 1 : -1)),
    packages: { active: packages.length, mrrMinor: packages.reduce((a, p) => a + p.monthlyPriceMinor, 0n) },
    currentPeriod: period,
  };
}
