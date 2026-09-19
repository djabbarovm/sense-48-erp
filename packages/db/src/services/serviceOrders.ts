/**
 * Wave 5: Services marketplace (docs/20 §11.8, blueprint §12).
 * Каталог услуг (партнёр / собственная эксплуатация) → заказ → статус → QA → GMV и атрибуция выручки.
 * BR-P35: цена/комиссия фиксируются в заказе на момент создания. BR-P36: в GMV/выручку попадают только DONE/VERIFIED.
 * BR-P32: QA не исполнителем и только c подтверждением. BR-P33: собственник заказывает только по своим юнитам.
 */
import type { ServiceChannel, ServiceCustomerKind, ServiceInvolvement, ServiceOrderTrigger, ServiceTerms, TenantContext } from '@finance-os/core';
import { NotFoundError, REVENUE_SERVICE_ORDER_STATUSES, ValidationError, applyClientDiscount, can, isServiceOrderOverdue, requirePermission, serviceOrderMachine, serviceRevenueSplit, serviceRevenueSplit3, slaCompliance, validateRating } from '@finance-os/core';
import type { ChangeSource, Prisma, ServiceCatalogItem, ServiceCategory, ServiceOrder, ServiceProviderKind } from '@prisma/client';
import { withAudit } from '../audit.js';
import { prisma } from '../client.js';
import { findScopedOr404, whereTenant } from '../repository.js';
import { nextNumber } from '../sequence.js';
import { emitDomainEvent } from './domainEvents.js';

// ── Каталог ──

export interface CatalogItemInput {
  code: string;
  name: string;
  category: ServiceCategory;
  providerKind: ServiceProviderKind;
  partnerName?: string | null;
  priceMinor: bigint;
  currency?: string;
  commissionBp?: number;
  slaHours?: number;
  description?: string | null;
  active?: boolean;
  /** Services v1.0: условия направления, вовлечение, скидка клиенту, внутренняя ставка за свою эксплуатацию (null = OPEN), доступность для Mall. */
  terms?: ServiceTerms;
  involvement?: ServiceInvolvement;
  clientDiscountBp?: number;
  ownOpsFeeBp?: number | null;
  forMall?: boolean;
}

const pickItem = (i: ServiceCatalogItem) => ({ code: i.code, name: i.name, category: i.category, providerKind: i.providerKind, partnerName: i.partnerName, priceMinor: i.priceMinor, currency: i.currency, commissionBp: i.commissionBp, slaHours: i.slaHours, active: i.active, terms: i.terms, involvement: i.involvement, clientDiscountBp: i.clientDiscountBp, ownOpsFeeBp: i.ownOpsFeeBp, forMall: i.forMall });

function validateItem(input: Partial<CatalogItemInput>): void {
  if (input.code !== undefined && !/^[A-Z0-9][A-Z0-9-]{1,30}$/.test(input.code)) throw new ValidationError('CODE_INVALID', 'CODE_INVALID: код A–Z, 0–9, дефис');
  if (input.name !== undefined && !input.name.trim()) throw new ValidationError('NAME_REQUIRED');
  if (input.priceMinor !== undefined && input.priceMinor < 0n) throw new ValidationError('PRICE_INVALID');
  if (input.commissionBp !== undefined && (input.commissionBp < 0 || input.commissionBp > 10_000)) throw new ValidationError('COMMISSION_INVALID');
  if (input.slaHours !== undefined && (!Number.isInteger(input.slaHours) || input.slaHours < 1)) throw new ValidationError('SLA_INVALID');
  if (input.providerKind === 'PARTNER' && input.partnerName !== undefined && !input.partnerName?.trim()) throw new ValidationError('PARTNER_REQUIRED', 'PARTNER_REQUIRED: для партнёрской услуги укажите партнёра');
  if (input.currency !== undefined && !/^[A-Z]{3}$/.test(input.currency)) throw new ValidationError('CURRENCY_INVALID');
  if (input.clientDiscountBp !== undefined && (input.clientDiscountBp < 0 || input.clientDiscountBp > 10_000)) throw new ValidationError('DISCOUNT_INVALID');
  if (input.ownOpsFeeBp != null && (input.ownOpsFeeBp < 0 || input.ownOpsFeeBp > 10_000)) throw new ValidationError('COMMISSION_INVALID');
}

export async function createCatalogItem(ctx: TenantContext, input: CatalogItemInput): Promise<ServiceCatalogItem> {
  requirePermission(ctx, 'service.catalog');
  validateItem({ ...input, partnerName: input.partnerName ?? null });
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const dup = await tx.serviceCatalogItem.findFirst({ where: { tenantId: ctx.tenantId, code: input.code } });
    if (dup) throw new ValidationError('CODE_TAKEN');
    const created = await tx.serviceCatalogItem.create({
      data: {
        tenantId: ctx.tenantId, code: input.code, name: input.name.trim(), category: input.category, providerKind: input.providerKind,
        partnerName: input.providerKind === 'PARTNER' ? (input.partnerName?.trim() ?? null) : null, priceMinor: input.priceMinor, currency: input.currency ?? 'UZS',
        commissionBp: input.providerKind === 'PARTNER' ? (input.commissionBp ?? 0) : 0, slaHours: input.slaHours ?? 48, description: input.description ?? null, active: input.active ?? true,
        terms: input.terms ?? 'COMMISSION_PER_ORDER', involvement: input.involvement ?? 'MANAGED', clientDiscountBp: input.clientDiscountBp ?? 0, ownOpsFeeBp: input.providerKind === 'OWN_OPS' ? (input.ownOpsFeeBp ?? null) : null, forMall: input.forMall ?? false,
      },
    });
    return { result: created, audit: { action: 'service_catalog.create', objectType: 'service_catalog_item', objectId: created.id, after: pickItem(created) } };
  });
}

export async function updateCatalogItem(ctx: TenantContext, id: string, input: Partial<CatalogItemInput>): Promise<ServiceCatalogItem> {
  requirePermission(ctx, 'service.catalog');
  validateItem(input);
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const before = await findScopedOr404(tx.serviceCatalogItem, ctx, id);
    const providerKind = input.providerKind ?? before.providerKind;
    const after = await tx.serviceCatalogItem.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        providerKind,
        partnerName: providerKind === 'PARTNER' ? (input.partnerName !== undefined ? input.partnerName?.trim() ?? null : before.partnerName) : null,
        ...(input.priceMinor !== undefined ? { priceMinor: input.priceMinor } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        commissionBp: providerKind === 'PARTNER' ? (input.commissionBp ?? before.commissionBp) : 0,
        ...(input.slaHours !== undefined ? { slaHours: input.slaHours } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(input.terms !== undefined ? { terms: input.terms } : {}),
        ...(input.involvement !== undefined ? { involvement: input.involvement } : {}),
        ...(input.clientDiscountBp !== undefined ? { clientDiscountBp: input.clientDiscountBp } : {}),
        ...(input.ownOpsFeeBp !== undefined ? { ownOpsFeeBp: input.ownOpsFeeBp } : {}),
        ...(input.forMall !== undefined ? { forMall: input.forMall } : {}),
      },
    });
    return { result: after, audit: { action: 'service_catalog.update', objectType: 'service_catalog_item', objectId: id, before: pickItem(before), after: pickItem(after) } };
  });
}

export async function listCatalog(ctx: TenantContext, opts: { includeInactive?: boolean } = {}): Promise<ServiceCatalogItem[]> {
  if (!can(ctx, 'service.view')) requirePermission(ctx, 'owner.portal');
  return prisma.serviceCatalogItem.findMany({ where: whereTenant(ctx, opts.includeInactive ? {} : { active: true }), orderBy: [{ category: 'asc' }, { name: 'asc' }] });
}

// ── Заказы ──

export interface ServiceOrderInput {
  catalogItemId: string;
  unitId?: string | null;
  buildingId?: string | null;
  quantity?: number;
  customerName?: string | null;
  notes?: string | null;
  scheduledAt?: Date | null;
  assigneeId?: string | null;
  source?: ChangeSource;
  channel?: ServiceChannel;
  customerKind?: ServiceCustomerKind | null;
  packageId?: string | null;
}

const pick = (o: ServiceOrder) => ({ status: o.status, catalogItemId: o.catalogItemId, unitId: o.unitId, providerKind: o.providerKind, priceMinor: o.priceMinor, commissionBp: o.commissionBp, quantity: o.quantity, assigneeId: o.assigneeId, dueAt: o.dueAt, ownerId: o.ownerId });

export async function createServiceOrder(ctx: TenantContext, input: ServiceOrderInput, now = new Date()): Promise<ServiceOrder> {
  // Собственник (owner.request) заказывает только по своему юниту (BR-P33); персоналу нужен service.order
  const asOwner = !can(ctx, 'service.order');
  if (asOwner) requirePermission(ctx, 'owner.request');
  const quantity = input.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) throw new ValidationError('QUANTITY_INVALID');
  if (!input.unitId && !input.buildingId) throw new ValidationError('LOCATION_REQUIRED', 'LOCATION_REQUIRED: укажите юнит или здание');
  if (asOwner && !input.unitId) throw new ValidationError('LOCATION_REQUIRED');
  const scheduledAt = input.scheduledAt ?? now;
  if (scheduledAt.getTime() < now.getTime() - 86_400_000) throw new ValidationError('SCHEDULE_IN_PAST');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const item = await findScopedOr404(tx.serviceCatalogItem, ctx, input.catalogItemId);
    if (!item.active) throw new ValidationError('SERVICE_INACTIVE');
    const unit = input.unitId ? await findScopedOr404(tx.unit, ctx, input.unitId) : null;
    // BR-P48: арендаторы Mall — не клиенты Services (их запросы ведёт команда ТРЦ), кроме услуг, явно открытых для Mall
    if (unit && !item.forMall) {
      const b = await tx.building.findUnique({ where: { id: unit.buildingId }, select: { kind: true } });
      if (b?.kind === 'MALL') throw new ValidationError('SERVICE_NOT_FOR_MALL', 'SERVICE_NOT_FOR_MALL: арендаторы ТРЦ обслуживаются командой Mall');
    }
    let ownerId: string | null = null;
    if (asOwner) {
      const owner = await tx.propertyOwner.findFirst({ where: { tenantId: ctx.tenantId, userId: ctx.userId }, select: { id: true } });
      if (!owner || unit?.ownerId !== owner.id) throw new NotFoundError();
      ownerId = owner.id;
    }
    if (input.buildingId) await findScopedOr404(tx.building, ctx, input.buildingId);
    const number = await nextNumber(tx, ctx.tenantId, 'SO', now);
    const assigneeId = can(ctx, 'service.manage') ? (input.assigneeId ?? null) : null;
    const listPriceMinor = item.priceMinor * BigInt(quantity);
    const priceMinor = applyClientDiscount(listPriceMinor, item.clientDiscountBp); // скидка — выгода клиента, не выручка
    const split = serviceRevenueSplit3(priceMinor, item.providerKind, item.commissionBp, item.ownOpsFeeBp); // BR-P47
    const created = await tx.serviceOrder.create({
      data: {
        tenantId: ctx.tenantId, number, catalogItemId: item.id, unitId: unit?.id ?? null, buildingId: unit?.buildingId ?? input.buildingId ?? null,
        status: assigneeId ? 'ACCEPTED' : 'NEW', providerKind: item.providerKind, partnerName: item.partnerName, priceMinor, listPriceMinor, currency: item.currency, commissionBp: item.commissionBp, quantity,
        servicesRevenueMinor: split.servicesRevenueMinor, executorRevenueMinor: split.executorRevenueMinor,
        channel: input.channel ?? (asOwner ? 'PORTAL' : 'STAFF'), customerKind: input.customerKind ?? (asOwner ? 'OWNER' : null), packageId: input.packageId ?? null,
        customerName: input.customerName?.trim() || null, ordererId: ctx.userId, ownerId, assigneeId, notes: input.notes?.trim() || null, source: asOwner ? 'API' : (input.source ?? 'UI'),
        scheduledAt, dueAt: new Date(scheduledAt.getTime() + item.slaHours * 3_600_000), acceptedAt: assigneeId ? now : null, createdAt: now,
      },
    });
    await emitDomainEvent(tx, ctx.tenantId, 'service_order.created', 'service_order', created.id, { number, unitNo: unit?.unitNo ?? null, service: item.name, providerKind: item.providerKind, detail: `${item.name} × ${quantity}`, deepLink: `/services/${created.id}` });
    return { result: created, audit: { action: 'service_order.create', objectType: 'service_order', objectId: created.id, after: { number, ...pick(created), service: item.code } } };
  });
}

export async function transitionServiceOrder(ctx: TenantContext, id: string, trigger: ServiceOrderTrigger, input: { assigneeId?: string | null; reason?: string } = {}, now = new Date()): Promise<ServiceOrder> {
  requirePermission(ctx, 'service.view');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const before = await findScopedOr404(tx.serviceOrder, ctx, id);
    const assigneeId = trigger === 'accept' || trigger === 'start' ? (input.assigneeId ?? before.assigneeId ?? (before.providerKind === 'OWN_OPS' ? ctx.userId : null)) : before.assigneeId;
    const proofs = await tx.document.count({ where: { tenantId: ctx.tenantId, objectType: 'service_order', objectId: id } });
    const to = serviceOrderMachine.assert(ctx, before.status, trigger, { hasAssignee: !!assigneeId, hasProof: proofs > 0, reason: input.reason, actorIsAssignee: before.assigneeId === ctx.userId });
    const after = await tx.serviceOrder.update({
      where: { id },
      data: {
        status: to, updatedBy: ctx.userId,
        ...(trigger === 'accept' ? { assigneeId, acceptedAt: now } : {}),
        ...(trigger === 'start' ? { assigneeId, startedAt: now, acceptedAt: before.acceptedAt ?? now } : {}),
        ...(trigger === 'done' ? { doneAt: now } : {}),
        ...(trigger === 'verify' ? { verifiedAt: now, verifiedBy: ctx.userId } : {}),
        ...(trigger === 'reopen' ? { doneAt: null, verifiedAt: null, verifiedBy: null } : {}),
        ...(trigger === 'cancel' ? { cancelReason: input.reason?.trim() ?? null } : {}),
      },
    });
    await emitDomainEvent(tx, ctx.tenantId, 'service_order.status.changed', 'service_order', id, { number: after.number, status: to, detail: trigger, deepLink: `/services/${id}` });
    return { result: after, audit: { action: `service_order.${trigger}`, objectType: 'service_order', objectId: id, before: pick(before), after: { ...pick(after), reason: input.reason ?? null } } };
  });
}

/** Оценка заказчика (1–5) после выполнения: заказчик, собственник-заказчик или service.manage. */
export async function rateServiceOrder(ctx: TenantContext, id: string, rating: number, comment?: string | null): Promise<ServiceOrder> {
  validateRating(rating);
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const before = await findScopedOr404(tx.serviceOrder, ctx, id);
    const owner = before.ownerId ? await tx.propertyOwner.findFirst({ where: { id: before.ownerId, userId: ctx.userId }, select: { id: true } }) : null;
    if (before.ordererId !== ctx.userId && !owner && !can(ctx, 'service.manage')) throw new NotFoundError();
    if (!REVENUE_SERVICE_ORDER_STATUSES.includes(before.status)) throw new ValidationError('NOT_DONE', 'NOT_DONE: оценить можно выполненный заказ');
    const after = await tx.serviceOrder.update({ where: { id }, data: { rating, ratingComment: comment?.trim() || null, updatedBy: ctx.userId } });
    return { result: after, audit: { action: 'service_order.rate', objectType: 'service_order', objectId: id, before: { rating: before.rating }, after: { rating, hasComment: !!comment?.trim() } } };
  });
}

/** BR-P49: cost-to-serve и жалобы фиксируются по заказу (координация, разбор) — база для Contribution направления. */
export async function recordHandling(ctx: TenantContext, id: string, input: { addMinutes?: number; complaint?: boolean; complaintNote?: string | null }): Promise<ServiceOrder> {
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const before = await findScopedOr404(tx.serviceOrder, ctx, id);
    if (!can(ctx, 'service.manage') && before.assigneeId !== ctx.userId && before.ordererId !== ctx.userId) throw new NotFoundError();
    const add = input.addMinutes ?? 0;
    if (!Number.isInteger(add) || add < 0 || add > 24 * 60) throw new ValidationError('MINUTES_INVALID');
    const after = await tx.serviceOrder.update({ where: { id }, data: { handlingMinutes: before.handlingMinutes + add, ...(input.complaint !== undefined ? { complaint: input.complaint, complaintNote: input.complaint ? (input.complaintNote?.trim() || null) : null } : {}), updatedBy: ctx.userId } });
    return { result: after, audit: { action: 'service_order.handling', objectType: 'service_order', objectId: id, before: { handlingMinutes: before.handlingMinutes, complaint: before.complaint }, after: { handlingMinutes: after.handlingMinutes, complaint: after.complaint, addMinutes: add } } };
  });
}

export interface ServiceOrderRow extends ServiceOrder {
  serviceName: string;
  serviceCode: string;
  category: ServiceCategory;
  unitNo: string | null;
  buildingName: string | null;
  ordererName: string;
  assigneeName: string | null;
  overdue: boolean;
  hoursLeft: number | null;
  proofs: number;
  platformRevenueMinor: bigint;
  partnerPayoutMinor: bigint;
}

export async function listServiceOrders(ctx: TenantContext, filter: { status?: ServiceOrder['status'][]; unitId?: string; mine?: boolean; overdueOnly?: boolean; providerKind?: ServiceProviderKind; ownerId?: string } = {}, now = new Date()): Promise<ServiceOrderRow[]> {
  if (!filter.ownerId) requirePermission(ctx, 'service.view');
  const where: Prisma.ServiceOrderWhereInput = { tenantId: ctx.tenantId };
  if (filter.status) where.status = { in: filter.status };
  if (filter.unitId) where.unitId = filter.unitId;
  if (filter.mine) where.OR = [{ assigneeId: ctx.userId }, { ordererId: ctx.userId }];
  if (filter.providerKind) where.providerKind = filter.providerKind;
  if (filter.ownerId) where.ownerId = filter.ownerId;
  const rows = await prisma.serviceOrder.findMany({ where, include: { catalogItem: { select: { name: true, code: true, category: true } }, unit: { select: { unitNo: true, building: { select: { name: true } } } } }, orderBy: [{ status: 'asc' }, { dueAt: 'asc' }] });
  const ids = [...new Set(rows.flatMap((r) => [r.ordererId, r.assigneeId].filter((x): x is string => !!x)))];
  const users = new Map((await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  const proofs = new Map<string, number>();
  if (rows.length) for (const g of await prisma.document.groupBy({ by: ['objectId'], where: { tenantId: ctx.tenantId, objectType: 'service_order', objectId: { in: rows.map((r) => r.id) } }, _count: { _all: true } })) proofs.set(g.objectId, g._count._all);
  const buildings = new Map((await prisma.building.findMany({ where: whereTenant(ctx), select: { id: true, name: true } })).map((b) => [b.id, b.name]));
  const out: ServiceOrderRow[] = [];
  for (const r of rows) {
    const overdue = isServiceOrderOverdue(r, now);
    if (filter.overdueOnly && !overdue) continue;
    const { catalogItem, unit, ...rest } = r;
    const split = serviceRevenueSplit(r.priceMinor, r.providerKind, r.commissionBp);
    out.push({
      ...rest, serviceName: catalogItem.name, serviceCode: catalogItem.code, category: catalogItem.category, unitNo: unit?.unitNo ?? null,
      buildingName: unit?.building.name ?? (r.buildingId ? (buildings.get(r.buildingId) ?? null) : null), ordererName: users.get(r.ordererId) ?? '—',
      assigneeName: r.assigneeId ? (users.get(r.assigneeId) ?? '—') : null, overdue,
      hoursLeft: ['NEW', 'ACCEPTED', 'IN_PROGRESS'].includes(r.status) ? Math.round((r.dueAt.getTime() - now.getTime()) / 360_000) / 10 : null,
      proofs: proofs.get(r.id) ?? 0, platformRevenueMinor: split.platformRevenueMinor, partnerPayoutMinor: split.partnerPayoutMinor,
    });
  }
  return out;
}

export async function getServiceOrder(ctx: TenantContext, id: string, now = new Date()) {
  requirePermission(ctx, 'service.view');
  const exists = await prisma.serviceOrder.findFirst({ where: whereTenant(ctx, { id }), select: { id: true } });
  if (!exists) throw new NotFoundError();
  const row = (await listServiceOrders(ctx, {}, now)).find((r) => r.id === id)!;
  const proofs = await prisma.document.findMany({ where: whereTenant(ctx, { objectType: 'service_order', objectId: id }), orderBy: { createdAt: 'desc' } });
  const audit = can(ctx, 'audit.view') || can(ctx, 'service.manage') ? await prisma.auditLog.findMany({ where: { tenantId: ctx.tenantId, objectType: 'service_order', objectId: id }, orderBy: { seq: 'desc' }, take: 30, select: { id: true, action: true, actorId: true, at: true, after: true } }) : [];
  const payload = { hasAssignee: !!row.assigneeId, hasProof: proofs.length > 0, actorIsAssignee: row.assigneeId === ctx.userId, reason: 'x' };
  const triggers = serviceOrderMachine.availableTriggers(ctx, row.status, payload);
  const canRate = REVENUE_SERVICE_ORDER_STATUSES.includes(row.status) && (row.ordererId === ctx.userId || can(ctx, 'service.manage'));
  return { order: row, proofs, audit, triggers, canRate, canUpload: can(ctx, 'document.upload') && ['ACCEPTED', 'IN_PROGRESS', 'DONE'].includes(row.status) };
}

export interface ServicesSummary {
  open: number;
  overdue: number;
  done: number; // за период
  gmvMinor: bigint;
  /** ORDO всего = выручка Services + выручка Operations (своя эксплуатация). */
  platformRevenueMinor: bigint;
  servicesRevenueMinor: bigint;
  operationsRevenueMinor: bigint;
  partnerPayoutMinor: bigint;
  currency: string;
  slaPct: number | null;
  avgRating: number | null;
  byProvider: { providerKind: ServiceProviderKind; partnerName: string | null; orders: number; gmvMinor: bigint; platformRevenueMinor: bigint; slaPct: number | null; avgRating: number | null }[];
  byCategory: { category: ServiceCategory; orders: number; gmvMinor: bigint }[];
}

/** Блок «Services» пульта (blueprint §9): заказы, GMV, монетизация, SLA партнёров за период (по умолчанию 30 дней). */
export async function getServicesSummary(ctx: TenantContext, opts: { days?: number } = {}, now = new Date()): Promise<ServicesSummary> {
  requirePermission(ctx, 'service.view');
  const since = new Date(now.getTime() - (opts.days ?? 30) * 86_400_000);
  const rows = await prisma.serviceOrder.findMany({ where: { tenantId: ctx.tenantId, OR: [{ status: { in: ['NEW', 'ACCEPTED', 'IN_PROGRESS'] } }, { createdAt: { gte: since } }] }, select: { status: true, dueAt: true, doneAt: true, priceMinor: true, providerKind: true, partnerName: true, commissionBp: true, rating: true, currency: true, servicesRevenueMinor: true, executorRevenueMinor: true, catalogItem: { select: { category: true } } } });
  const revenue = rows.filter((r) => REVENUE_SERVICE_ORDER_STATUSES.includes(r.status));
  const sum = (xs: typeof revenue, f: (r: (typeof revenue)[number]) => bigint) => xs.reduce((a, r) => a + f(r), 0n);
  const platform = (r: (typeof revenue)[number]) => serviceRevenueSplit(r.priceMinor, r.providerKind, r.commissionBp).platformRevenueMinor;
  const partner = (r: (typeof revenue)[number]) => serviceRevenueSplit(r.priceMinor, r.providerKind, r.commissionBp).partnerPayoutMinor;
  const avg = (xs: { rating: number | null }[]) => { const rated = xs.filter((x) => x.rating != null); return rated.length ? Math.round((rated.reduce((a, x) => a + x.rating!, 0) / rated.length) * 10) / 10 : null; };
  const providers = new Map<string, typeof rows>();
  for (const r of rows) { const k = `${r.providerKind}:${r.partnerName ?? ''}`; providers.set(k, [...(providers.get(k) ?? []), r]); }
  const cats = new Map<ServiceCategory, typeof revenue>();
  for (const r of revenue) cats.set(r.catalogItem.category, [...(cats.get(r.catalogItem.category) ?? []), r]);
  return {
    open: rows.filter((r) => ['NEW', 'ACCEPTED', 'IN_PROGRESS'].includes(r.status)).length,
    overdue: rows.filter((r) => isServiceOrderOverdue(r, now)).length,
    done: revenue.length,
    gmvMinor: sum(revenue, (r) => r.priceMinor), platformRevenueMinor: sum(revenue, platform), partnerPayoutMinor: sum(revenue, partner),
    servicesRevenueMinor: sum(revenue, (r) => r.servicesRevenueMinor), operationsRevenueMinor: sum(revenue.filter((r) => r.providerKind === 'OWN_OPS'), (r) => r.executorRevenueMinor),
    currency: rows[0]?.currency ?? 'UZS', slaPct: slaCompliance(rows), avgRating: avg(revenue),
    byProvider: [...providers.entries()].map(([, xs]) => { const rev = xs.filter((r) => REVENUE_SERVICE_ORDER_STATUSES.includes(r.status)); return { providerKind: xs[0]!.providerKind, partnerName: xs[0]!.partnerName, orders: xs.length, gmvMinor: sum(rev, (r) => r.priceMinor), platformRevenueMinor: sum(rev, platform), slaPct: slaCompliance(xs), avgRating: avg(rev) }; }).sort((a, b) => Number(b.gmvMinor - a.gmvMinor)),
    byCategory: [...cats.entries()].map(([category, xs]) => ({ category, orders: xs.length, gmvMinor: sum(xs, (r) => r.priceMinor) })).sort((a, b) => Number(b.gmvMinor - a.gmvMinor)),
  };
}

/** Джоб service-sla: просроченные открытые заказы → Task SERVICE_ORDER_OVERDUE (дедуп) + событие. */
export async function escalateOverdueServiceOrders(tenantId: string, now = new Date()): Promise<number> {
  const overdue = await prisma.serviceOrder.findMany({ where: { tenantId, status: { in: ['NEW', 'ACCEPTED', 'IN_PROGRESS'] }, dueAt: { lt: now }, overdueNotifiedAt: null } });
  let n = 0;
  for (const o of overdue) {
    await withAudit({ tenantId }, async (tx) => {
      const ops = o.assigneeId ?? (await tx.userTenantRole.findFirst({ where: { tenantId, role: 'OPERATIONS_MANAGER' }, select: { userId: true } }))?.userId ?? null;
      const exists = await tx.task.count({ where: { tenantId, type: 'SERVICE_ORDER_OVERDUE', objectId: o.id, status: { in: ['OPEN', 'IN_PROGRESS'] } } });
      if (!exists) await tx.task.create({ data: { tenantId, type: 'SERVICE_ORDER_OVERDUE', objectType: 'service_order', objectId: o.id, ownerId: ops, dueAt: o.dueAt, nextAction: `Заказ услуги ${o.number} просрочил SLA${o.partnerName ? ` (партнёр ${o.partnerName})` : ''}: выполнить или переназначить` } });
      const after = await tx.serviceOrder.update({ where: { id: o.id }, data: { overdueNotifiedAt: now } });
      await emitDomainEvent(tx, tenantId, 'service_order.overdue', 'service_order', o.id, { number: o.number, partnerName: o.partnerName, detail: `SLA ${o.dueAt.toISOString()}`, deepLink: `/services/${o.id}` });
      return { result: after, audit: { action: 'service_order.overdue', objectType: 'service_order', objectId: o.id, after: { dueAt: o.dueAt, ownerId: ops } } };
    });
    n++;
  }
  return n;
}
