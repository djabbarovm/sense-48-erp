/**
 * Wave 2: Management Control Room (blueprint §9, docs/20 §7.4): сегодня · коммерция · собственники · эксплуатация.
 * Композиция существующих сервисов — без собственной бизнес-логики; только чтение.
 */
import type { TenantContext, UnitKpi } from '@finance-os/core';
import { can, computeUnitKpi, dealAttention, requirePermission } from '@finance-os/core';
import { prisma } from '../client.js';
import { whereTenant } from '../repository.js';
import { getPipelineSummary, listDeals, type DealRow, type PipelineSummary } from './deals.js';
import { listLeases, type LeaseRow } from './leases.js';
import { maskOwnerName, type UnitRow, listUnits } from './property.js';
import { getServicesSummary, type ServicesSummary } from './serviceOrders.js';
import { getReceivablesSummary, type ReceivablesSummary } from './rent.js';

export interface ControlRoom {
  today: {
    newDeals: number;
    stageMoves: number;
    viewingsPlanned: number;
    attentionDeals: number;
    overdueTasks: number;
    dataQualityAlerts: number;
    criticalUnits: number;
  };
  commercial: {
    kpi: UnitKpi;
    byBuilding: { id: string; name: string; kind: string; kpi: UnitKpi }[];
    pipeline: PipelineSummary | null;
    expiring30: number;
    expiring90: number;
  };
  owners: {
    total: number;
    consented: number;
    managedUnits: number;
    /** Собственники, согласные на управление, но без действующей аренды (blueprint §1.8). */
    consentedWithoutLease: { id: string; displayName: string; units: string[] }[];
  };
  operations: {
    renovation: number;
    issue: number;
    critical: number;
    blocked: number;
    issueUnits: UnitRow[];
  };
  /** Services marketplace (blueprint §9): заказы, GMV, монетизация, SLA партнёров за 30 дней; null — нет права service.view. */
  services: ServicesSummary | null;
  /** Finance (blueprint §9): дебиторка, просрочка, сбор за месяц; null — нет права rent.view. */
  finance: ReceivablesSummary | null;
  lists: {
    attentionDeals: DealRow[];
    expiringLeases: LeaseRow[];
    alertUnits: UnitRow[];
    idleUnits: UnitRow[];
  };
}

export async function getControlRoom(ctx: TenantContext, today = new Date()): Promise<ControlRoom> {
  requirePermission(ctx, 'property.view');
  const dayStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const [units, buildings, dealsRaw, tasksOverdue, viewingsPlanned, services, finance] = await Promise.all([
    listUnits(ctx, {}, today),
    prisma.building.findMany({ where: whereTenant(ctx), orderBy: { sortOrder: 'asc' } }),
    can(ctx, 'deal.view') ? prisma.deal.findMany({ where: whereTenant(ctx), select: { stage: true, createdAt: true, stageChangedAt: true, nextAction: true, nextActionAt: true, reservedUntil: true } }) : Promise.resolve([]),
    prisma.task.count({ where: { tenantId: ctx.tenantId, status: 'OVERDUE', type: { in: ['DEAL_FOLLOWUP', 'LEASE_EXPIRY'] } } }),
    can(ctx, 'deal.view') ? prisma.unitActivity.count({ where: { tenantId: ctx.tenantId, kind: 'VIEWING', followUpAt: { gte: dayStart, lt: new Date(dayStart.getTime() + 86_400_000) } } }) : Promise.resolve(0),
    can(ctx, 'service.view') ? getServicesSummary(ctx, { days: 30 }, today) : Promise.resolve(null),
    can(ctx, 'rent.view') ? getReceivablesSummary(ctx, today) : Promise.resolve(null),
  ]);
  const kpiInput = (rows: UnitRow[]) => rows.map((u) => ({ ...u, areaM2: u.areaM2 }));
  const kpi = computeUnitKpi(kpiInput(units), today);
  const byBuilding = buildings.map((b) => ({ id: b.id, name: b.name, kind: b.kind, kpi: computeUnitKpi(kpiInput(units.filter((u) => u.buildingId === b.id)), today) }));

  const [pipeline, attentionDeals, expiring90, allLeases] = await Promise.all([
    can(ctx, 'deal.view') ? getPipelineSummary(ctx, today) : Promise.resolve(null),
    can(ctx, 'deal.view') ? listDeals(ctx, { attentionOnly: true }, today) : Promise.resolve([] as DealRow[]),
    can(ctx, 'lease.view') ? listLeases(ctx, { status: ['ACTIVE', 'EXPIRING'], expiringWithinDays: 90 }, today) : Promise.resolve([] as LeaseRow[]),
    can(ctx, 'lease.view') ? listLeases(ctx, { status: ['ACTIVE', 'EXPIRING'] }, today) : Promise.resolve([] as LeaseRow[]),
  ]);

  // Собственники c согласием, но без действующей аренды на своих юнитах
  const owners = await prisma.propertyOwner.findMany({ where: whereTenant(ctx), include: { units: { select: { id: true, unitNo: true, type: true } } } });
  const leasedUnitIds = new Set(allLeases.map((l) => l.unitId));
  const showOwner = can(ctx, 'unit.owner.view');
  const consentedWithoutLease = owners
    .filter((o) => o.managementConsent && o.units.length > 0 && o.units.every((u) => !leasedUnitIds.has(u.id)))
    .map((o) => ({ id: o.id, displayName: showOwner ? o.displayName : maskOwnerName(o.displayName), units: o.units.map((u) => u.unitNo) }))
    .slice(0, 20);

  const alertUnits = units.filter((u) => u.view.alerts.length > 0);
  const idleUnits = units.filter((u) => u.view.isSellable && (u.view.vacantDays ?? 0) >= 60).sort((a, b) => (b.view.vacantDays ?? 0) - (a.view.vacantDays ?? 0));
  const issueUnits = units.filter((u) => u.operationalStatus === 'ISSUE' || u.operationalStatus === 'CRITICAL' || u.operationalStatus === 'BLOCKED');

  return {
    today: {
      newDeals: dealsRaw.filter((d) => d.createdAt >= dayStart).length,
      stageMoves: dealsRaw.filter((d) => d.stageChangedAt >= dayStart && d.createdAt < dayStart).length,
      viewingsPlanned,
      attentionDeals: dealsRaw.filter((d) => dealAttention(d, today).length > 0).length,
      overdueTasks: tasksOverdue,
      dataQualityAlerts: alertUnits.length,
      criticalUnits: units.filter((u) => u.operationalStatus === 'CRITICAL').length,
    },
    commercial: { kpi, byBuilding, pipeline, expiring30: expiring90.filter((l) => (l.endsInDays ?? 999) <= 30).length, expiring90: expiring90.length },
    owners: { total: owners.length, consented: owners.filter((o) => o.managementConsent).length, managedUnits: units.filter((u) => u.managedByPlatform).length, consentedWithoutLease },
    operations: {
      renovation: units.filter((u) => u.view.color === 'GREY').length,
      issue: units.filter((u) => u.operationalStatus === 'ISSUE').length,
      critical: units.filter((u) => u.operationalStatus === 'CRITICAL').length,
      blocked: units.filter((u) => u.operationalStatus === 'BLOCKED').length,
      issueUnits: issueUnits.slice(0, 8),
    },
    services,
    finance,
    lists: { attentionDeals: attentionDeals.slice(0, 6), expiringLeases: expiring90.slice(0, 6), alertUnits: alertUnits.slice(0, 6), idleUnits: idleUnits.slice(0, 6) },
  };
}

