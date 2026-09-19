/**
 * ORDO Mall — коммерческая часть (docs/20 §11.11; бизнес-модель Mall v1.1).
 * BR-P45: активный мандат (ДДУ) делает помещение управляемым (аренда собирается ORDO → дебиторка P-18), один на помещение.
 * BR-P46: проценты вознаграждения видны собственнику только после утверждения (feePublished); fee считается только при feeBp ≠ null.
 * Линии актива (медиа, островки, паркинг, партнёрства) — выручка ORDO по конструкции C, отдельно от денег собственников.
 */
import type { AssetKind, MandateTrigger, RateScenario, TenantContext, TenantCategory } from '@finance-os/core';
import { NotFoundError, ValidationError, assetManagementFee, can, deriveUnitView, mallKpi, mandateMachine, potentialRentByScenario, requirePermission, tenantMix, type MallUnitInput } from '@finance-os/core';
import type { AssetContract, CommercialAsset, MallMandate, Prisma } from '@prisma/client';
import { Prisma as P } from '@prisma/client';
import { withAudit } from '../audit.js';
import { prisma } from '../client.js';
import { findScopedOr404, whereTenant } from '../repository.js';
import { emitDomainEvent } from './domainEvents.js';

const pickM = (m: MallMandate) => ({ status: m.status, unitId: m.unitId, ownerId: m.ownerId, feeBp: m.feeBp, successFeeMonths: m.successFeeMonths?.toString() ?? null, feePublished: m.feePublished, startAt: m.startAt, endAt: m.endAt });

export interface MandateInput {
  unitId: string;
  ownerId?: string | null; // по умолчанию — собственник помещения
  feeBp?: number | null;
  successFeeMonths?: number | null;
  pricingDelegated?: boolean;
  startAt?: Date | null;
  endAt?: Date | null;
  notes?: string | null;
}

function validateFee(feeBp?: number | null, successFeeMonths?: number | null) {
  if (feeBp != null && (!Number.isInteger(feeBp) || feeBp < 0 || feeBp > 10_000)) throw new ValidationError('FEE_INVALID', 'FEE_INVALID: ставка 0–100%');
  if (successFeeMonths != null && (successFeeMonths < 0 || successFeeMonths > 12)) throw new ValidationError('SUCCESS_FEE_INVALID');
}

export async function createMandate(ctx: TenantContext, input: MandateInput): Promise<MallMandate> {
  requirePermission(ctx, 'mall.manage');
  validateFee(input.feeBp, input.successFeeMonths);
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const unit = await findScopedOr404(tx.unit, ctx, input.unitId);
    const building = await tx.building.findUniqueOrThrow({ where: { id: unit.buildingId }, select: { kind: true } });
    if (building.kind !== 'MALL' && unit.type !== 'RETAIL') throw new ValidationError('NOT_MALL_UNIT', 'NOT_MALL_UNIT: мандат ДДУ — для помещений ТРЦ');
    const ownerId = input.ownerId ?? unit.ownerId;
    if (!ownerId) throw new ValidationError('MANDATE_OWNER_REQUIRED');
    await findScopedOr404(tx.propertyOwner, ctx, ownerId);
    const open = await tx.mallMandate.count({ where: { tenantId: ctx.tenantId, unitId: unit.id, status: { in: ['DRAFT', 'SIGNED', 'ACTIVE'] } } });
    if (open) throw new ValidationError('MANDATE_EXISTS', 'MANDATE_EXISTS: по помещению уже есть незакрытый мандат');
    const created = await tx.mallMandate.create({ data: { tenantId: ctx.tenantId, unitId: unit.id, ownerId, feeBp: input.feeBp ?? null, successFeeMonths: input.successFeeMonths != null ? new P.Decimal(input.successFeeMonths) : null, pricingDelegated: input.pricingDelegated ?? true, startAt: input.startAt ?? null, endAt: input.endAt ?? null, notes: input.notes ?? null, createdBy: ctx.userId } });
    return { result: created, audit: { action: 'mall_mandate.create', objectType: 'mall_mandate', objectId: created.id, after: { ...pickM(created), unitNo: unit.unitNo } } };
  });
}

export async function updateMandate(ctx: TenantContext, id: string, patch: { feeBp?: number | null; successFeeMonths?: number | null; feePublished?: boolean; pricingDelegated?: boolean; endAt?: Date | null; notes?: string | null }): Promise<MallMandate> {
  requirePermission(ctx, 'mall.manage');
  validateFee(patch.feeBp, patch.successFeeMonths);
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const before = await findScopedOr404(tx.mallMandate, ctx, id);
    if (before.status === 'TERMINATED') throw new ValidationError('MANDATE_CLOSED');
    if (patch.feePublished && (patch.feeBp ?? before.feeBp) == null) throw new ValidationError('FEE_NOT_APPROVED', 'FEE_NOT_APPROVED: нельзя опубликовать неутверждённую ставку');
    const after = await tx.mallMandate.update({ where: { id }, data: { ...(patch.feeBp !== undefined ? { feeBp: patch.feeBp } : {}), ...(patch.successFeeMonths !== undefined ? { successFeeMonths: patch.successFeeMonths != null ? new P.Decimal(patch.successFeeMonths) : null } : {}), ...(patch.feePublished !== undefined ? { feePublished: patch.feePublished } : {}), ...(patch.pricingDelegated !== undefined ? { pricingDelegated: patch.pricingDelegated } : {}), ...(patch.endAt !== undefined ? { endAt: patch.endAt } : {}), ...(patch.notes !== undefined ? { notes: patch.notes } : {}), updatedBy: ctx.userId } });
    return { result: after, audit: { action: 'mall_mandate.update', objectType: 'mall_mandate', objectId: id, before: pickM(before), after: pickM(after) } };
  });
}

/** BR-P45: ACTIVE → помещение под управлением (managedByPlatform, аренда собирается ORDO); TERMINATED → снимается, если нет другого. */
export async function transitionMandate(ctx: TenantContext, id: string, trigger: MandateTrigger, input: { reason?: string; signedAt?: Date; startAt?: Date } = {}, now = new Date()): Promise<MallMandate> {
  requirePermission(ctx, 'mall.manage');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const before = await findScopedOr404(tx.mallMandate, ctx, id);
    const otherActive = await tx.mallMandate.count({ where: { tenantId: ctx.tenantId, unitId: before.unitId, status: 'ACTIVE', id: { not: id } } });
    const to = mandateMachine.assert(ctx, before.status, trigger, { hasOwner: !!before.ownerId, otherActiveOnUnit: otherActive > 0, reason: input.reason });
    const after = await tx.mallMandate.update({ where: { id }, data: { status: to, updatedBy: ctx.userId, ...(trigger === 'sign' ? { signedAt: input.signedAt ?? now } : {}), ...(trigger === 'activate' ? { startAt: before.startAt ?? input.startAt ?? now } : {}), ...(trigger === 'terminate' ? { terminatedAt: now, terminatedReason: input.reason?.trim() ?? null } : {}) } });
    const unit = await tx.unit.findUniqueOrThrow({ where: { id: before.unitId }, select: { unitNo: true, managedByPlatform: true } });
    if (to === 'ACTIVE' && !unit.managedByPlatform) await tx.unit.update({ where: { id: before.unitId }, data: { managedByPlatform: true, updatedBy: ctx.userId } });
    if (to === 'TERMINATED' && before.status === 'ACTIVE' && unit.managedByPlatform) await tx.unit.update({ where: { id: before.unitId }, data: { managedByPlatform: false, updatedBy: ctx.userId } });
    await emitDomainEvent(tx, ctx.tenantId, 'mall.mandate.changed', 'mall_mandate', id, { unitNo: unit.unitNo, status: to, detail: trigger, deepLink: `/mall?view=mandates` });
    return { result: after, audit: { action: `mall_mandate.${trigger}`, objectType: 'mall_mandate', objectId: id, before: pickM(before), after: { ...pickM(after), reason: input.reason ?? null, managedByPlatform: to === 'ACTIVE' } } };
  });
}

export interface MandateRow extends MallMandate {
  unitNo: string;
  floorNo: number;
  areaM2: number;
  ownerName: string;
  occupantName: string | null;
  monthlyRentMinor: bigint | null;
  successFee: number | null;
}

export async function listMandates(ctx: TenantContext, filter: { buildingId?: string; status?: MallMandate['status'][]; ownerId?: string; unitId?: string } = {}): Promise<MandateRow[]> {
  if (!filter.ownerId) requirePermission(ctx, 'mall.view');
  const where: Prisma.MallMandateWhereInput = { tenantId: ctx.tenantId, ...(filter.status ? { status: { in: filter.status } } : {}), ...(filter.ownerId ? { ownerId: filter.ownerId } : {}), ...(filter.unitId ? { unitId: filter.unitId } : {}), ...(filter.buildingId ? { unit: { buildingId: filter.buildingId } } : {}) };
  const rows = await prisma.mallMandate.findMany({ where, include: { unit: { select: { unitNo: true, areaM2: true, occupantName: true, monthlyRentMinor: true, floor: { select: { floorNo: true } } } }, owner: { select: { displayName: true } } }, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }] });
  const showFinance = can(ctx, 'unit.finance.view');
  return rows.map(({ unit, owner, ...m }) => ({ ...m, unitNo: unit.unitNo, floorNo: unit.floor.floorNo, areaM2: Number(unit.areaM2), ownerName: owner.displayName, occupantName: unit.occupantName, monthlyRentMinor: showFinance ? unit.monthlyRentMinor : null, successFee: m.successFeeMonths ? Number(m.successFeeMonths) : null }));
}

// ── Категория арендатора (tenant mix) ──

export async function setLeaseTenantCategory(ctx: TenantContext, leaseId: string, category: TenantCategory | null) {
  requirePermission(ctx, 'lease.manage');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const before = await findScopedOr404(tx.leaseContract, ctx, leaseId);
    const after = await tx.leaseContract.update({ where: { id: leaseId }, data: { tenantCategory: category, updatedBy: ctx.userId } });
    return { result: after, audit: { action: 'lease.update', objectType: 'lease_contract', objectId: leaseId, before: { tenantCategory: before.tenantCategory }, after: { tenantCategory: category } } };
  });
}

// ── Линии актива (конструкция C) ──

export interface AssetInput { buildingId: string; kind: AssetKind; code: string; name: string; location?: string | null; tariffMinor?: bigint | null; currency?: string }

export async function createAsset(ctx: TenantContext, input: AssetInput): Promise<CommercialAsset> {
  requirePermission(ctx, 'mall.manage');
  if (!/^[A-Z0-9][A-Z0-9-]{1,30}$/.test(input.code)) throw new ValidationError('CODE_INVALID');
  if (!input.name.trim()) throw new ValidationError('NAME_REQUIRED');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    await findScopedOr404(tx.building, ctx, input.buildingId);
    if (await tx.commercialAsset.findFirst({ where: { tenantId: ctx.tenantId, code: input.code } })) throw new ValidationError('CODE_TAKEN');
    const created = await tx.commercialAsset.create({ data: { tenantId: ctx.tenantId, buildingId: input.buildingId, kind: input.kind, code: input.code, name: input.name.trim(), location: input.location ?? null, tariffMinor: input.tariffMinor ?? null, currency: input.currency ?? 'USD' } });
    return { result: created, audit: { action: 'commercial_asset.create', objectType: 'commercial_asset', objectId: created.id, after: { code: created.code, kind: created.kind, tariffMinor: created.tariffMinor?.toString() ?? null } } };
  });
}

export async function createAssetContract(ctx: TenantContext, input: { assetId: string; counterpartyName: string; monthlyMinor: bigint; startAt: Date; endAt?: Date | null; notes?: string | null }): Promise<AssetContract> {
  requirePermission(ctx, 'mall.manage');
  if (!input.counterpartyName.trim()) throw new ValidationError('COUNTERPARTY_REQUIRED');
  if (input.monthlyMinor <= 0n) throw new ValidationError('AMOUNT_INVALID');
  if (input.endAt && input.endAt <= input.startAt) throw new ValidationError('DATES_INVALID');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const asset = await findScopedOr404(tx.commercialAsset, ctx, input.assetId);
    if (!asset.active) throw new ValidationError('ASSET_INACTIVE');
    const created = await tx.assetContract.create({ data: { tenantId: ctx.tenantId, assetId: asset.id, counterpartyName: input.counterpartyName.trim(), monthlyMinor: input.monthlyMinor, currency: asset.currency, startAt: input.startAt, endAt: input.endAt ?? null, notes: input.notes ?? null } });
    return { result: created, audit: { action: 'asset_contract.create', objectType: 'asset_contract', objectId: created.id, after: { assetId: asset.id, monthlyMinor: created.monthlyMinor.toString(), startAt: created.startAt, endAt: created.endAt } } };
  });
}

export async function endAssetContract(ctx: TenantContext, id: string, endAt = new Date()): Promise<AssetContract> {
  requirePermission(ctx, 'mall.manage');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const before = await findScopedOr404(tx.assetContract, ctx, id);
    if (before.status === 'ENDED') throw new ValidationError('CONTRACT_ENDED');
    const after = await tx.assetContract.update({ where: { id }, data: { status: 'ENDED', endAt } });
    return { result: after, audit: { action: 'asset_contract.end', objectType: 'asset_contract', objectId: id, before: { status: before.status }, after: { status: 'ENDED', endAt } } };
  });
}

export interface AssetRow extends CommercialAsset { contracts: AssetContract[]; monthlyMinor: bigint }

export async function listAssets(ctx: TenantContext, buildingId?: string, today = new Date()): Promise<AssetRow[]> {
  requirePermission(ctx, 'mall.view');
  const rows = await prisma.commercialAsset.findMany({ where: whereTenant(ctx, buildingId ? { buildingId } : {}), include: { contracts: { orderBy: { startAt: 'desc' } } }, orderBy: [{ kind: 'asc' }, { code: 'asc' }] });
  return rows.map((a) => ({ ...a, monthlyMinor: a.contracts.filter((c) => c.status === 'ACTIVE' && c.startAt <= today && (!c.endAt || c.endAt >= today)).reduce((s, c) => s + c.monthlyMinor, 0n) }));
}

// ── Дашборд ТРЦ ──

const DEFAULT_RATES: RateScenario = { conservative: 3_000n, base: 4_000n, optimistic: 5_000n }; // $30 / $40 / $50 за м² (Mall §9 A)

export async function getMallDashboard(ctx: TenantContext, buildingId?: string, today = new Date()) {
  requirePermission(ctx, 'mall.view');
  const building = buildingId ? await findScopedOr404(prisma.building, ctx, buildingId) : await prisma.building.findFirst({ where: { tenantId: ctx.tenantId, kind: 'MALL' }, orderBy: { sortOrder: 'asc' } });
  if (!building) throw new NotFoundError('MALL_NOT_FOUND');
  const [units, mandates, leases, deals, assets, tenant] = await Promise.all([
    prisma.unit.findMany({ where: whereTenant(ctx, { buildingId: building.id }), include: { floor: { select: { floorNo: true } }, owner: { select: { id: true, displayName: true } } }, orderBy: { unitNo: 'asc' } }),
    prisma.mallMandate.findMany({ where: { tenantId: ctx.tenantId, unit: { buildingId: building.id }, status: { in: ['SIGNED', 'ACTIVE', 'DRAFT'] } } }),
    prisma.leaseContract.findMany({ where: { tenantId: ctx.tenantId, unit: { buildingId: building.id }, status: { in: ['ACTIVE', 'EXPIRING'] } }, select: { unitId: true, tenantCategory: true, endAt: true } }),
    can(ctx, 'deal.view') ? prisma.deal.findMany({ where: { tenantId: ctx.tenantId, product: 'MALL_LEASE', stage: { notIn: ['WON', 'LOST'] } }, select: { stage: true, tenantCategory: true, expectedRateMinor: true } }) : Promise.resolve([]),
    listAssets(ctx, building.id, today),
    prisma.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { settings: true } }),
  ]);
  const mandateByUnit = new Map<string, MallMandate>();
  for (const m of mandates) { const cur = mandateByUnit.get(m.unitId); if (!cur || m.status === 'ACTIVE') mandateByUnit.set(m.unitId, m); }
  const leaseByUnit = new Map(leases.map((l) => [l.unitId, l]));
  const showFinance = can(ctx, 'unit.finance.view');
  const inputs: MallUnitInput[] = units.map((u) => {
    const v = deriveUnitView(u, today);
    return { id: u.id, floorNo: u.floor.floorNo, areaM2: Number(u.areaM2), isCommercial: v.isCommercial, readiness: u.readiness, occupied: v.color === 'GREEN' || v.color === 'YELLOW' || v.color === 'BLUE', monthlyRentMinor: u.monthlyRentMinor, askingRateMinor: u.askingRateMinor, tenantCategory: leaseByUnit.get(u.id)?.tenantCategory ?? null, mandateStatus: mandateByUnit.get(u.id)?.status ?? null, vacantDays: v.vacantDays, leaseEndsInDays: v.leaseEndsInDays };
  });
  const kpi = mallKpi(inputs);
  const settings = tenant.settings as Record<string, unknown>;
  const rawRates = (settings.mall_rate_scenarios as Record<string, { conservative: number; base: number; optimistic: number }> | undefined) ?? {};
  const ratesByFloor = Object.fromEntries(Object.entries(rawRates).map(([f, r]) => [f, { conservative: BigInt(r.conservative), base: BigInt(r.base), optimistic: BigInt(r.optimistic) }]));
  const byFloor = [...new Set(inputs.map((u) => u.floorNo))].sort((a, b) => a - b).map((floorNo) => ({ floorNo, kpi: mallKpi(inputs.filter((u) => u.floorNo === floorNo)) }));
  // Контролируемая база: собранная аренда по управляемым помещениям ТРЦ за текущий месяц (P-18) и вознаграждение по мандатам c утверждённой ставкой
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const nextMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
  const activeUnitIds = [...mandateByUnit.entries()].filter(([, m]) => m.status === 'ACTIVE').map(([id]) => id);
  const charges = await prisma.rentCharge.findMany({ where: { tenantId: ctx.tenantId, unitId: { in: activeUnitIds }, periodStart: { gte: monthStart, lt: nextMonth }, status: { not: 'WAIVED' } }, select: { unitId: true, amountMinor: true, receivedMinor: true } });
  let collected = 0n; let charged = 0n; let fee: bigint | null = 0n; let feeOpen = 0;
  for (const c of charges) {
    charged += c.amountMinor; collected += c.receivedMinor;
    const m = mandateByUnit.get(c.unitId);
    const f = assetManagementFee(c.receivedMinor, m?.feeBp ?? null);
    if (f == null) feeOpen++; else if (fee != null) fee += f;
  }
  const assetsMonthly = assets.reduce((s, a) => s + a.monthlyMinor, 0n);
  const byKind = (['MEDIA', 'ISLAND', 'PARKING', 'PARTNERSHIP'] as const).map((kind) => ({ kind, assets: assets.filter((a) => a.kind === kind).length, monthlyMinor: assets.filter((a) => a.kind === kind).reduce((s, a) => s + a.monthlyMinor, 0n) }));
  const owners = new Set(units.filter((u) => u.owner).map((u) => u.owner!.id));
  return {
    building: { id: building.id, name: building.name },
    kpi, byFloor, tenantMix: tenantMix(inputs),
    scenarios: potentialRentByScenario(inputs, ratesByFloor, DEFAULT_RATES), ratesByFloor: Object.keys(ratesByFloor).length ? ratesByFloor : { default: DEFAULT_RATES },
    mandates: { owners: owners.size, withMandate: new Set(mandates.map((m) => m.ownerId)).size, active: kpi.mandateActive, signed: kpi.mandateSigned, draft: mandates.filter((m) => m.status === 'DRAFT').length, coverageGlaPct: kpi.mandateCoverageGlaPct },
    controlled: showFinance && can(ctx, 'mall.fee.view') ? { chargedMinor: charged, collectedMinor: collected, feeMinor: fee, feeOpenUnits: feeOpen, currency: 'USD' } : null,
    pipeline: { deals: deals.length, byStage: Object.entries(deals.reduce<Record<string, number>>((a, d) => ({ ...a, [d.stage]: (a[d.stage] ?? 0) + 1 }), {})), byCategory: Object.entries(deals.reduce<Record<string, number>>((a, d) => ({ ...a, [d.tenantCategory ?? 'OTHER']: (a[d.tenantCategory ?? 'OTHER'] ?? 0) + 1 }), {})) },
    assets: { monthlyMinor: assetsMonthly, byKind, list: assets },
    units: inputs.map((u) => ({ ...u, unitNo: units.find((x) => x.id === u.id)!.unitNo, ownerName: units.find((x) => x.id === u.id)!.owner?.displayName ?? null })),
  };
}

/** Отчёт собственнику ТРЦ (Mall §3 «коммерческая отчётность»): по каждому помещению — ставка, арендатор, срок, собираемость, мандат; проценты — только если опубликованы (BR-P46). */
export async function ownerMallReport(ctx: TenantContext, ownerId: string, today = new Date()) {
  const units = await prisma.unit.findMany({ where: { tenantId: ctx.tenantId, ownerId, building: { kind: 'MALL' } }, include: { floor: { select: { floorNo: true } }, building: { select: { name: true } }, leases: { where: { status: { in: ['ACTIVE', 'EXPIRING'] } }, take: 1 }, mandates: { where: { status: { in: ['DRAFT', 'SIGNED', 'ACTIVE'] } }, take: 1 } }, orderBy: { unitNo: 'asc' } });
  if (units.length === 0) return null;
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const charges = await prisma.rentCharge.findMany({ where: { tenantId: ctx.tenantId, unitId: { in: units.map((u) => u.id) }, status: { not: 'WAIVED' } }, orderBy: { periodStart: 'desc' } });
  return units.map((u) => {
    const v = deriveUnitView(u, today);
    const l = u.leases[0] ?? null;
    const m = u.mandates[0] ?? null;
    const uc = charges.filter((c) => c.unitId === u.id);
    const collectedMinor = uc.reduce((s, c) => s + c.receivedMinor, 0n);
    const outstandingMinor = uc.filter((c) => c.status !== 'PAID').reduce((s, c) => s + c.amountMinor - c.receivedMinor, 0n);
    const month = uc.find((c) => c.periodStart >= monthStart) ?? null;
    return {
      id: u.id, unitNo: u.unitNo, building: u.building.name, floorNo: u.floor.floorNo, areaM2: Number(u.areaM2), color: v.color, labelKey: v.labelKey, vacantDays: v.vacantDays, leaseEndsInDays: v.leaseEndsInDays,
      occupantName: u.occupantName, tenantCategory: l?.tenantCategory ?? null, rentMinor: l?.rentMinor ?? null, currency: l?.currency ?? 'USD', leaseEndAt: l?.endAt ?? null,
      mandate: m ? { status: m.status, signedAt: m.signedAt, startAt: m.startAt, feeBp: m.feePublished ? m.feeBp : null, successFee: m.feePublished && m.successFeeMonths ? Number(m.successFeeMonths) : null, feePublished: m.feePublished } : null,
      collectedMinor, outstandingMinor, monthStatus: month?.status ?? null, ratePerM2Minor: l ? l.rentMinor / BigInt(Math.max(1, Math.round(Number(u.areaM2)))) : null,
      riskVacancy: (v.leaseEndsInDays != null && v.leaseEndsInDays <= 180) || (v.color === 'RED'),
    };
  });
}
