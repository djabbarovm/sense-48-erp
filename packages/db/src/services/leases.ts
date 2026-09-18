/**
 * Wave 2: договор аренды (docs/20 §11.1, ADR-018). Источник истины для occupancy/rentalMode/leaseStatus юнита.
 * Активация/расторжение проставляют поля юнита; ручная смена этих полей при действующем договоре запрещена (LEASE_IS_SOURCE).
 */
import type { AuditEntry, LeaseType, TenantContext } from '@finance-os/core';
import { EXPIRING_WINDOW_DAYS, ValidationError, can, leaseMachine, requirePermission, unitPatchFromLease } from '@finance-os/core';
import type { LeaseContract, Prisma } from '@prisma/client';
import { withAudit } from '../audit.js';
import { prisma } from '../client.js';
import { findScopedOr404, whereTenant } from '../repository.js';
import { emitDomainEvent } from './domainEvents.js';

export interface LeaseInput {
  unitId: string;
  type: LeaseType;
  occupantName: string;
  occupantContact?: string | null;
  startAt: Date;
  endAt?: Date | null;
  rentMinor: bigint;
  depositMinor?: bigint | null;
  depositReceived?: boolean;
  currency?: string;
  dealId?: string | null;
  notes?: string | null;
}

const pick = (l: LeaseContract) => ({ status: l.status, type: l.type, unitId: l.unitId, startAt: l.startAt, endAt: l.endAt, rentMinor: l.rentMinor.toString(), depositReceived: l.depositReceived });

export async function createLease(ctx: TenantContext, input: LeaseInput): Promise<LeaseContract> {
  requirePermission(ctx, 'lease.manage');
  if (!input.occupantName.trim() && input.type !== 'OWNER_USE') throw new ValidationError('OCCUPANT_REQUIRED');
  if (input.rentMinor < 0n) throw new ValidationError('NEGATIVE_AMOUNT');
  if (input.endAt && input.endAt <= input.startAt) throw new ValidationError('LEASE_DATES_INVALID');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const unit = await findScopedOr404(tx.unit, ctx, input.unitId);
    if (input.dealId) await findScopedOr404(tx.deal, ctx, input.dealId);
    const created = await tx.leaseContract.create({
      data: {
        tenantId: ctx.tenantId, unitId: unit.id, ownerId: unit.ownerId, dealId: input.dealId ?? null, type: input.type,
        occupantName: input.type === 'OWNER_USE' ? (input.occupantName.trim() || 'Собственник') : input.occupantName.trim(),
        occupantContact: input.occupantContact ?? null, startAt: input.startAt, endAt: input.endAt ?? null,
        rentMinor: input.rentMinor, depositMinor: input.depositMinor ?? null, depositReceived: input.depositReceived ?? false,
        currency: input.currency ?? unit.askingCurrency, notes: input.notes ?? null, createdBy: ctx.userId,
      },
    });
    // контакт арендатора (PII) в audit не пишем
    return { result: created, audit: { action: 'lease.create', objectType: 'lease_contract', objectId: created.id, after: pick(created) } };
  });
}

async function applyLeaseToUnit(tx: Prisma.TransactionClient, ctx: TenantContext, lease: LeaseContract, now: Date) {
  const patch = unitPatchFromLease({ type: lease.type, status: lease.status, occupantName: lease.occupantName, endAt: lease.endAt, rentMinor: lease.rentMinor });
  const before = await findScopedOr404(tx.unit, ctx, lease.unitId);
  const vacant = patch.occupancy === 'VACANT';
  const after = await tx.unit.update({
    where: { id: lease.unitId },
    data: {
      ...patch,
      commercialStatus: vacant ? 'AVAILABLE' : 'CONTRACTED',
      vacantSince: vacant ? now : null,
      publishedAt: null,
      statusEffectiveAt: now,
      updatedBy: ctx.userId,
    },
  });
  await emitDomainEvent(tx, ctx.tenantId, 'unit.status.changed', 'unit', after.id, { unitNo: after.unitNo, occupancy: after.occupancy, leaseStatus: after.leaseStatus, detail: `lease ${lease.status}`, deepLink: `/property/units/${after.id}` });
  return { before, after };
}

/** BR-P23: активация договора = выигрыш сделки (WON + wonLeaseId). */
export async function activateLease(ctx: TenantContext, leaseId: string, now = new Date()): Promise<LeaseContract> {
  requirePermission(ctx, 'lease.manage');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const before = await findScopedOr404(tx.leaseContract, ctx, leaseId);
    const unit = await findScopedOr404(tx.unit, ctx, before.unitId);
    const other = await tx.leaseContract.count({ where: { tenantId: ctx.tenantId, unitId: before.unitId, status: { in: ['ACTIVE', 'EXPIRING'] }, id: { not: leaseId } } });
    leaseMachine.assert(ctx, before.status, 'activate', { unitReady: unit.readiness === 'READY', otherActiveOnUnit: other > 0, startAt: before.startAt, endAt: before.endAt });
    const after = await tx.leaseContract.update({ where: { id: leaseId }, data: { status: 'ACTIVE', updatedBy: ctx.userId } });
    const unitChange = await applyLeaseToUnit(tx, ctx, after, now);
    const audit: AuditEntry[] = [
      { action: 'lease.activate', objectType: 'lease_contract', objectId: leaseId, before: pick(before), after: pick(after) },
      { action: 'unit.status.change', objectType: 'unit', objectId: unit.id, before: { occupancy: unitChange.before.occupancy, leaseStatus: unitChange.before.leaseStatus, occupantName: unitChange.before.occupantName }, after: { occupancy: unitChange.after.occupancy, leaseStatus: unitChange.after.leaseStatus, occupantName: unitChange.after.occupantName, reason: `lease ${leaseId} activated`, source: 'UI' } },
    ];
    if (after.dealId) {
      const deal = await tx.deal.findFirst({ where: { id: after.dealId, tenantId: ctx.tenantId } });
      if (deal && deal.stage !== 'WON') {
        await tx.deal.update({ where: { id: deal.id }, data: { stage: 'WON', stageChangedAt: now, wonLeaseId: leaseId, unitId: after.unitId, updatedBy: ctx.userId } });
        audit.push({ action: 'deal.stage.change', objectType: 'deal', objectId: deal.id, before: { stage: deal.stage }, after: { stage: 'WON', wonLeaseId: leaseId } });
        await emitDomainEvent(tx, ctx.tenantId, 'deal.stage.changed', 'deal', deal.id, { number: deal.number, stage: 'WON', detail: `unit ${unit.unitNo}`, deepLink: `/deals/${deal.id}` });
      }
    }
    await emitDomainEvent(tx, ctx.tenantId, 'lease.activated', 'lease_contract', leaseId, { unitNo: unit.unitNo, type: after.type, detail: after.endAt ? `до ${after.endAt.toISOString().slice(0, 10)}` : 'бессрочно', deepLink: `/property/units/${unit.id}` });
    return { result: after, audit };
  });
}

export async function terminateLease(ctx: TenantContext, leaseId: string, reason: string, now = new Date()): Promise<LeaseContract> {
  requirePermission(ctx, 'lease.manage');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const before = await findScopedOr404(tx.leaseContract, ctx, leaseId);
    leaseMachine.assert(ctx, before.status, 'terminate', { unitReady: true, otherActiveOnUnit: false, startAt: before.startAt, endAt: before.endAt, reason });
    const wasLive = before.status === 'ACTIVE' || before.status === 'EXPIRING';
    const after = await tx.leaseContract.update({ where: { id: leaseId }, data: { status: 'TERMINATED', terminatedAt: now, terminatedReason: reason.trim() || null, updatedBy: ctx.userId } });
    const audit: AuditEntry[] = [{ action: 'lease.terminate', objectType: 'lease_contract', objectId: leaseId, before: pick(before), after: { ...pick(after), reason: reason.trim() } }];
    if (wasLive) {
      const unitChange = await applyLeaseToUnit(tx, ctx, after, now);
      audit.push({ action: 'unit.status.change', objectType: 'unit', objectId: after.unitId, before: { occupancy: unitChange.before.occupancy, leaseStatus: unitChange.before.leaseStatus, occupantName: unitChange.before.occupantName }, after: { occupancy: unitChange.after.occupancy, leaseStatus: unitChange.after.leaseStatus, occupantName: null, reason: `lease ${leaseId} terminated: ${reason.trim()}`, source: 'UI' } });
      await emitDomainEvent(tx, ctx.tenantId, 'lease.terminated', 'lease_contract', leaseId, { unitNo: unitChange.after.unitNo, detail: reason.trim(), deepLink: `/property/units/${after.unitId}` });
    }
    return { result: after, audit };
  });
}

export async function updateLease(ctx: TenantContext, leaseId: string, patch: { depositReceived?: boolean; notes?: string | null; occupantContact?: string | null; endAt?: Date | null }): Promise<LeaseContract> {
  requirePermission(ctx, 'lease.manage');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const before = await findScopedOr404(tx.leaseContract, ctx, leaseId);
    if (patch.endAt !== undefined && patch.endAt && patch.endAt <= before.startAt) throw new ValidationError('LEASE_DATES_INVALID');
    const after = await tx.leaseContract.update({
      where: { id: leaseId },
      data: {
        ...(patch.depositReceived !== undefined ? { depositReceived: patch.depositReceived } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        ...(patch.occupantContact !== undefined ? { occupantContact: patch.occupantContact } : {}),
        ...(patch.endAt !== undefined ? { endAt: patch.endAt } : {}),
        updatedBy: ctx.userId,
      },
    });
    if (patch.endAt !== undefined && (after.status === 'ACTIVE' || after.status === 'EXPIRING')) {
      await tx.unit.update({ where: { id: after.unitId }, data: { leaseEndsAt: after.endAt, updatedBy: ctx.userId } });
    }
    return { result: after, audit: { action: 'lease.update', objectType: 'lease_contract', objectId: leaseId, before: pick(before), after: pick(after) } };
  });
}

export interface LeaseRow {
  id: string;
  unitId: string;
  unitNo: string;
  buildingName: string;
  type: LeaseContract['type'];
  status: LeaseContract['status'];
  occupantName: string;
  occupantContact: string | null;
  startAt: Date;
  endAt: Date | null;
  rentMinor: bigint | null;
  depositMinor: bigint | null;
  depositReceived: boolean;
  currency: string;
  dealId: string | null;
  terminatedReason: string | null;
  endsInDays: number | null;
}

export async function listLeases(ctx: TenantContext, filter: { unitId?: string; status?: LeaseContract['status'][]; expiringWithinDays?: number } = {}, today = new Date()): Promise<LeaseRow[]> {
  requirePermission(ctx, 'lease.view');
  const showFinance = can(ctx, 'unit.finance.view');
  const showContact = can(ctx, 'unit.owner.view');
  const rows = await prisma.leaseContract.findMany({
    where: whereTenant(ctx, { ...(filter.unitId ? { unitId: filter.unitId } : {}), ...(filter.status ? { status: { in: filter.status } } : {}) }),
    include: { unit: { select: { unitNo: true, building: { select: { name: true } } } } },
    orderBy: [{ status: 'asc' }, { endAt: 'asc' }],
  });
  const out: LeaseRow[] = [];
  for (const l of rows) {
    const endsInDays = l.endAt ? Math.round((Date.UTC(l.endAt.getUTCFullYear(), l.endAt.getUTCMonth(), l.endAt.getUTCDate()) - Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) / 86_400_000) : null;
    if (filter.expiringWithinDays !== undefined && (endsInDays === null || endsInDays > filter.expiringWithinDays || !['ACTIVE', 'EXPIRING'].includes(l.status))) continue;
    out.push({
      id: l.id, unitId: l.unitId, unitNo: l.unit.unitNo, buildingName: l.unit.building.name, type: l.type, status: l.status,
      occupantName: l.occupantName, occupantContact: showContact ? l.occupantContact : null, startAt: l.startAt, endAt: l.endAt,
      rentMinor: showFinance ? l.rentMinor : null, depositMinor: showFinance ? l.depositMinor : null, depositReceived: l.depositReceived,
      currency: l.currency, dealId: l.dealId, terminatedReason: l.terminatedReason, endsInDays,
    });
  }
  return out;
}

/** Джоб lease-expiry: ACTIVE c endAt ≤ +30 дн → EXPIRING + Task LEASE_EXPIRY (дедуп) + событие. Системный переход. */
export async function markExpiringLeases(tenantId: string, now = new Date()): Promise<number> {
  const soon = new Date(now.getTime() + EXPIRING_WINDOW_DAYS * 86_400_000);
  const leases = await prisma.leaseContract.findMany({ where: { tenantId, status: 'ACTIVE', endAt: { not: null, lte: soon } }, include: { unit: { select: { unitNo: true } } } });
  let n = 0;
  for (const lease of leases) {
    leaseMachine.assert(null, lease.status, 'mark_expiring', { unitReady: true, otherActiveOnUnit: false, startAt: lease.startAt, endAt: lease.endAt });
    await withAudit({ tenantId }, async (tx) => {
      const after = await tx.leaseContract.update({ where: { id: lease.id }, data: { status: 'EXPIRING' } });
      await tx.unit.update({ where: { id: lease.unitId }, data: { leaseStatus: 'EXPIRING', statusEffectiveAt: now } });
      const owner = await tx.userTenantRole.findFirst({ where: { tenantId, role: 'COMMERCIAL_MANAGER' }, select: { userId: true } });
      const exists = await tx.task.count({ where: { tenantId, type: 'LEASE_EXPIRY', objectId: lease.id, status: { in: ['OPEN', 'IN_PROGRESS'] } } });
      if (exists === 0) {
        await tx.task.create({
          data: { tenantId, type: 'LEASE_EXPIRY', objectType: 'lease_contract', objectId: lease.id, ownerId: owner?.userId ?? null, dueAt: lease.endAt, nextAction: `Договор по юниту ${lease.unit.unitNo} истекает ${lease.endAt?.toISOString().slice(0, 10)}: продлить (новый договор) или подтвердить выезд` },
        });
      }
      await emitDomainEvent(tx, tenantId, 'lease.expiring', 'lease_contract', lease.id, { unitNo: lease.unit.unitNo, detail: `до ${lease.endAt?.toISOString().slice(0, 10)}`, deepLink: `/property/units/${lease.unitId}` });
      return { result: after, audit: { action: 'lease.mark_expiring', objectType: 'lease_contract', objectId: lease.id, before: { status: 'ACTIVE' }, after: { status: 'EXPIRING', endAt: lease.endAt } } };
    });
    n++;
  }
  return n;
}
