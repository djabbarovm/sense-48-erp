/**
 * CRM Tower — воронка собственников (docs/20 §11.15, P-22b; бизнес-модель Tower H4).
 * Стадии и переходы — core/property/ownerPipeline; SIGNED синхронизирует статус договора управления (ст. 28),
 * HANDED_OVER требует хотя бы одно помещение под управлением. Расчёт STR / mid-term / LTR — всегда три сценария,
 * рекомендация по чистому доходу собственника (BR-P58); показ расчёта фиксируется (calcShownAt → CALC_SHOWN).
 */
import type { TenantContext } from '@finance-os/core';
import { NotFoundError, OWNER_ACTIVE_STAGES, ValidationError, assertOwnerStageMove, can, maskEmail, maskPhone, normalizePhone, ownerConversion, ownerScenarios, ownerSegment, requirePermission, type OwnerCalcInput, type OwnerLostReason, type OwnerStage } from '@finance-os/core';
import type { Prisma, PropertyOwner, UnitActivityKind } from '@prisma/client';
import { withAudit } from '../audit.js';
import { prisma } from '../client.js';
import { findScopedOr404 } from '../repository.js';
import { emitDomainEvent } from './domainEvents.js';

const pick = (o: PropertyOwner) => ({ stage: o.pipelineStage, nextAction: o.nextAction, nextActionAt: o.nextActionAt, managerId: o.managerId, contractStatus: o.managementContractStatus, lostReason: o.lostReason, calcShownAt: o.calcShownAt }); // PII не пишем

async function ownerUnits(tenantId: string, ownerId: string) {
  return prisma.unit.findMany({ where: { tenantId, ownerId }, select: { id: true, unitNo: true, type: true, areaM2: true, managedByPlatform: true, occupancy: true, rentalMode: true, askingRateMinor: true, askingCurrency: true, monthlyRentMinor: true, leaseStatus: true, building: { select: { name: true, kind: true } } }, orderBy: { unitNo: 'asc' } });
}

/** Переход по воронке (BR-P57): проверка перехода, синхронизация договора управления, событие, активность. */
export async function moveOwnerStage(ctx: TenantContext, ownerId: string, to: OwnerStage, opts: { reason?: OwnerLostReason | null; note?: string | null; signedAt?: Date | null } = {}, now = new Date()): Promise<PropertyOwner> {
  requirePermission(ctx, 'property.manage');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const before = await findScopedOr404(tx.propertyOwner, ctx, ownerId);
    assertOwnerStageMove(before.pipelineStage as OwnerStage, to);
    if (to === 'LOST' && !opts.reason) throw new ValidationError('LOST_REASON_REQUIRED');
    if (to === 'HANDED_OVER') {
      const managed = await tx.unit.count({ where: { tenantId: ctx.tenantId, ownerId, managedByPlatform: true } });
      if (!managed) throw new ValidationError('NO_MANAGED_UNIT', 'NO_MANAGED_UNIT: сначала переведите хотя бы одно помещение под управление (карточка юнита)');
    }
    const contract = to === 'SIGNED' || to === 'HANDED_OVER' ? { managementContractStatus: 'SIGNED' as const, managementContractSignedAt: before.managementContractSignedAt ?? opts.signedAt ?? now } : to === 'CONTRACT_SENT' && before.managementContractStatus === 'NONE' ? { managementContractStatus: 'SENT' as const } : {};
    const after = await tx.propertyOwner.update({ where: { id: ownerId }, data: { pipelineStage: to, stageChangedAt: now, lostReason: to === 'LOST' ? (opts.reason ?? null) : to === 'CONTACTED' && before.pipelineStage === 'LOST' ? null : before.lostReason, ...(to === 'CALC_SHOWN' && !before.calcShownAt ? { calcShownAt: now } : {}), ...(to === 'CONSENT' ? { managementConsent: true, consentUpdatedAt: now } : {}), ...contract, ...(before.managerId ? {} : { managerId: ctx.userId }) } });
    await tx.unitActivity.create({ data: { tenantId: ctx.tenantId, ownerId, kind: 'NOTE', note: `Стадия ${before.pipelineStage} → ${to}${opts.reason ? ` (${opts.reason})` : ''}${opts.note ? `: ${opts.note}` : ''}`, source: 'UI', actorId: ctx.userId, happenedAt: now } });
    await emitDomainEvent(tx, ctx.tenantId, 'owner.stage.changed', 'property_owner', ownerId, { from: before.pipelineStage, to, deepLink: `/property/owners/${ownerId}` });
    return { result: after, audit: { action: 'property_owner.stage', objectType: 'property_owner', objectId: ownerId, before: pick(before), after: pick(after), ...(opts.note ? { reason: opts.note } : {}) } };
  });
}

export async function setOwnerNextAction(ctx: TenantContext, ownerId: string, input: { nextAction: string | null; nextActionAt: Date | null; managerId?: string | null }): Promise<PropertyOwner> {
  requirePermission(ctx, 'property.manage');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const before = await findScopedOr404(tx.propertyOwner, ctx, ownerId);
    const after = await tx.propertyOwner.update({ where: { id: ownerId }, data: { nextAction: input.nextAction?.trim() || null, nextActionAt: input.nextActionAt, ...(input.managerId !== undefined ? { managerId: input.managerId } : {}) } });
    return { result: after, audit: { action: 'property_owner.next_action', objectType: 'property_owner', objectId: ownerId, before: pick(before), after: pick(after) } };
  });
}

export async function addOwnerActivity(ctx: TenantContext, ownerId: string, input: { kind: UnitActivityKind; note: string; followUpAt?: Date | null; unitId?: string | null }, now = new Date()) {
  requirePermission(ctx, 'property.manage');
  if (!input.note.trim()) throw new ValidationError('NOTE_REQUIRED');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const owner = await findScopedOr404(tx.propertyOwner, ctx, ownerId);
    const a = await tx.unitActivity.create({ data: { tenantId: ctx.tenantId, ownerId, unitId: input.unitId ?? null, kind: input.kind, note: input.note.trim(), followUpAt: input.followUpAt ?? null, source: 'UI', actorId: ctx.userId, happenedAt: now } });
    const data: Prisma.PropertyOwnerUpdateInput = { ...(input.followUpAt ? { nextActionAt: input.followUpAt, nextAction: owner.nextAction ?? input.note.trim().slice(0, 120) } : {}), ...(owner.pipelineStage === 'LEAD' ? { pipelineStage: 'CONTACTED', stageChangedAt: now } : {}), ...(owner.managerId ? {} : { managerId: ctx.userId }) };
    if (Object.keys(data).length) await tx.propertyOwner.update({ where: { id: ownerId }, data });
    return { result: a, audit: { action: 'property_owner.activity', objectType: 'property_owner', objectId: ownerId, after: { kind: input.kind, followUpAt: input.followUpAt ?? null } } };
  });
}

/** Настройки расчёта из tenant.settings.owner_calc (str_fee_bp null → OPEN). */
async function calcDefaults(tenantId: string): Promise<Partial<OwnerCalcInput>> {
  const t = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } });
  const s = ((t.settings as Record<string, unknown>).owner_calc ?? {}) as Record<string, number | null | undefined>;
  return { strFeeBp: s.str_fee_bp ?? null, ...(s.str_occupancy_pct != null ? { strOccupancyPct: s.str_occupancy_pct } : {}), ...(s.str_opex_pct != null ? { strOpexPct: s.str_opex_pct } : {}), ...(s.str_adr_multiplier != null ? { strAdrMultiplier: s.str_adr_multiplier } : {}), ...(s.mid_multiplier != null ? { midMultiplier: s.mid_multiplier } : {}), ...(s.ltr_vacancy_months != null ? { ltrVacancyMonths: s.ltr_vacancy_months } : {}), ...(s.mid_vacancy_months != null ? { midVacancyMonths: s.mid_vacancy_months } : {}), ...(s.assumed_str_fee_bp != null ? { assumedStrFeeBp: s.assumed_str_fee_bp } : {}) };
}

/** Расчёт трёх сценариев по помещениям собственника: база LTR — asking rate / текущая аренда юнитов (USD), overrides — из формы. */
export async function ownerCalc(ctx: TenantContext, ownerId: string, overrides: Partial<OwnerCalcInput> & { unitId?: string | null } = {}) {
  requirePermission(ctx, 'owner.pipeline');
  await findScopedOr404(prisma.propertyOwner, ctx, ownerId);
  const units = await ownerUnits(ctx.tenantId, ownerId);
  const residential = units.filter((u) => u.type === 'APARTMENT' && (!overrides.unitId || u.id === overrides.unitId));
  let base = overrides.ltrMonthlyMinor ?? residential.reduce((a, u) => a + (u.monthlyRentMinor ?? u.askingRateMinor ?? 0n), 0n);
  let baseSource: 'FORM' | 'UNITS' | 'BUILDING_AVG' | 'NONE' = overrides.ltrMonthlyMinor ? 'FORM' : base > 0n ? 'UNITS' : 'NONE';
  if (base <= 0n && residential.length) {
    // нет ставки у квартир собственника — оценка по средней asking-ставке за м² квартир здания (рыночный ориентир)
    const peers = await prisma.unit.findMany({ where: { tenantId: ctx.tenantId, type: 'APARTMENT', askingRateMinor: { not: null }, buildingId: { in: [...new Set((await prisma.unit.findMany({ where: { id: { in: residential.map((u) => u.id) } }, select: { buildingId: true } })).map((x) => x.buildingId))] } }, select: { askingRateMinor: true, areaM2: true } });
    const totalRate = peers.reduce((a, u) => a + (u.askingRateMinor ?? 0n), 0n); const totalArea = peers.reduce((a, u) => a + Number(u.areaM2), 0);
    if (totalArea > 0) { const perM2 = Number(totalRate) / totalArea; base = BigInt(Math.round(perM2 * residential.reduce((a, u) => a + Number(u.areaM2), 0))); baseSource = 'BUILDING_AVG'; }
  }
  if (base <= 0n) return { calc: null, units: residential.map((u) => u.unitNo), baseMonthlyMinor: 0n, baseSource, currency: 'USD' };
  const defaults = await calcDefaults(ctx.tenantId);
  const { unitId: _u, ...rest } = overrides;
  const calc = ownerScenarios({ ...defaults, ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)), ltrMonthlyMinor: base });
  if (baseSource === 'BUILDING_AVG') for (const sc of calc.scenarios) sc.assumptions.unshift('база — средняя ставка за м² по зданию');
  return { calc, units: residential.map((u) => u.unitNo), baseMonthlyMinor: base, baseSource, currency: residential[0]?.askingCurrency ?? 'USD' };
}

/** «Показал собственнику расчёт»: фиксирует calcShownAt и переводит в CALC_SHOWN (если раньше). */
export async function markCalcShown(ctx: TenantContext, ownerId: string, summary: string, now = new Date()) {
  requirePermission(ctx, 'property.manage');
  const owner = await findScopedOr404(prisma.propertyOwner, ctx, ownerId);
  await addOwnerActivity(ctx, ownerId, { kind: 'OFFER', note: `Показан расчёт STR / mid-term / LTR: ${summary}` }, now);
  if (['LEAD', 'CONTACTED'].includes(owner.pipelineStage)) return moveOwnerStage(ctx, ownerId, 'CALC_SHOWN', {}, now);
  return prisma.propertyOwner.update({ where: { id: ownerId }, data: { calcShownAt: owner.calcShownAt ?? now } });
}

export interface OwnerPipelineRow { id: string; displayName: string; kind: PropertyOwner['kind']; stage: OwnerStage; stageChangedAt: Date | null; daysInStage: number; nextAction: string | null; nextActionAt: Date | null; overdue: boolean; managerId: string | null; managerName: string | null; unitNos: string[]; segment: ReturnType<typeof ownerSegment>; contractStatus: PropertyOwner['managementContractStatus']; managedUnits: number; calcShown: boolean; lostReason: string | null; source: PropertyOwner['source'] }

export async function getOwnerPipeline(ctx: TenantContext, filter: { managerId?: string; stage?: OwnerStage; q?: string } = {}, now = new Date()) {
  requirePermission(ctx, 'owner.pipeline');
  const showName = can(ctx, 'unit.owner.view');
  const owners = await prisma.propertyOwner.findMany({ where: { tenantId: ctx.tenantId, ...(filter.managerId ? { managerId: filter.managerId } : {}), ...(filter.stage ? { pipelineStage: filter.stage } : {}), ...(filter.q ? { displayName: { contains: filter.q, mode: 'insensitive' } } : {}) }, include: { units: { select: { unitNo: true, type: true, areaM2: true, managedByPlatform: true } } }, orderBy: [{ nextActionAt: 'asc' }, { displayName: 'asc' }] });
  const managers = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(owners.map((o) => o.managerId).filter((x): x is string => !!x))] } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  const rows: OwnerPipelineRow[] = owners.map((o) => ({ id: o.id, displayName: showName ? o.displayName : `${o.displayName.split(/\s+/)[0]} ${o.displayName.split(/\s+/)[1]?.[0] ?? ''}.`.trim(), kind: o.kind, stage: o.pipelineStage as OwnerStage, stageChangedAt: o.stageChangedAt, daysInStage: o.stageChangedAt ? Math.floor((now.getTime() - o.stageChangedAt.getTime()) / 86_400_000) : 0, nextAction: o.nextAction, nextActionAt: o.nextActionAt, overdue: !!o.nextActionAt && o.nextActionAt < now && OWNER_ACTIVE_STAGES.includes(o.pipelineStage as OwnerStage), managerId: o.managerId, managerName: o.managerId ? (managers.get(o.managerId) ?? null) : null, unitNos: o.units.map((u) => u.unitNo), segment: ownerSegment(o.units.map((u) => ({ type: u.type, areaM2: Number(u.areaM2) }))), contractStatus: o.managementContractStatus, managedUnits: o.units.filter((u) => u.managedByPlatform).length, calcShown: !!o.calcShownAt, lostReason: o.lostReason, source: o.source }));
  const byStage = (['LEAD', 'CONTACTED', 'CALC_SHOWN', 'CONSENT', 'CONTRACT_SENT', 'SIGNED', 'HANDED_OVER', 'LOST'] as OwnerStage[]).map((stage) => ({ stage, rows: rows.filter((r) => r.stage === stage) }));
  const conversion = ownerConversion(rows.map((r) => ({ stage: r.stage, segment: r.segment })));
  const lostReasons = [...rows.filter((r) => r.stage === 'LOST').reduce((m, r) => m.set(r.lostReason ?? 'OTHER', (m.get(r.lostReason ?? 'OTHER') ?? 0) + 1), new Map<string, number>())].map(([reason, count]) => ({ reason, count }));
  return { rows, byStage, conversion, lostReasons, overdue: rows.filter((r) => r.overdue).length, noNextAction: rows.filter((r) => OWNER_ACTIVE_STAGES.includes(r.stage) && !r.nextAction).length, calcNotShown: rows.filter((r) => ['CONTACTED', 'CONSENT', 'CONTRACT_SENT'].includes(r.stage) && !r.calcShown).length, managers: [...managers].map(([id, fullName]) => ({ id, fullName })) };
}

export async function getOwnerCard(ctx: TenantContext, ownerId: string, now = new Date()) {
  requirePermission(ctx, 'owner.pipeline');
  const o = await prisma.propertyOwner.findFirst({ where: { tenantId: ctx.tenantId, id: ownerId } });
  if (!o) throw new NotFoundError('OWNER_NOT_FOUND');
  const pii = can(ctx, 'unit.owner.view');
  const [units, activities, contact, manager] = await Promise.all([
    ownerUnits(ctx.tenantId, ownerId),
    prisma.unitActivity.findMany({ where: { tenantId: ctx.tenantId, ownerId }, orderBy: { happenedAt: 'desc' }, take: 40, include: { unit: { select: { unitNo: true } } } }),
    prisma.contact.findFirst({ where: { tenantId: ctx.tenantId, ownerId }, include: { deals: { select: { id: true, number: true, stage: true, product: true }, orderBy: { updatedAt: 'desc' }, take: 8 } } }),
    o.managerId ? prisma.user.findUnique({ where: { id: o.managerId }, select: { fullName: true } }) : null,
  ]);
  const actors = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(activities.map((a) => a.actorId))] } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  let phone: string | null = null; try { phone = normalizePhone(o.contactPhone); } catch { phone = o.contactPhone; }
  return {
    owner: { ...o, displayName: pii ? o.displayName : `${o.displayName.split(/\s+/)[0]}`, contactPhone: pii ? phone : maskPhone(phone), contactEmail: pii ? o.contactEmail : maskEmail(o.contactEmail), managerName: manager?.fullName ?? null, stage: o.pipelineStage as OwnerStage, daysInStage: o.stageChangedAt ? Math.floor((now.getTime() - o.stageChangedAt.getTime()) / 86_400_000) : 0, overdue: !!o.nextActionAt && o.nextActionAt < now },
    units: units.map((u) => ({ ...u, areaM2: Number(u.areaM2) })), segment: ownerSegment(units.map((u) => ({ type: u.type, areaM2: Number(u.areaM2) }))),
    activities: activities.map((a) => ({ id: a.id, kind: a.kind, note: a.note, happenedAt: a.happenedAt, followUpAt: a.followUpAt, unitNo: a.unit?.unitNo ?? null, actor: actors.get(a.actorId) ?? '—' })),
    contact: contact ? { id: contact.id, deals: contact.deals } : null,
    pii, canManage: can(ctx, 'property.manage'),
  };
}

/** Джоб owner-followup: просроченное следующее действие → Task OWNER_FOLLOWUP менеджеру (дедуп) + событие. */
export async function markOverdueOwnerFollowups(tenantId: string, now = new Date()): Promise<number> {
  const rows = await prisma.propertyOwner.findMany({ where: { tenantId, nextActionAt: { lt: now }, pipelineStage: { in: [...OWNER_ACTIVE_STAGES] } } });
  let n = 0;
  for (const o of rows) {
    const exists = await prisma.task.count({ where: { tenantId, type: 'OWNER_FOLLOWUP', objectId: o.id, status: { in: ['OPEN', 'IN_PROGRESS'] } } });
    if (exists) continue;
    await withAudit({ tenantId }, async (tx) => {
      const task = await tx.task.create({ data: { tenantId, type: 'OWNER_FOLLOWUP', objectType: 'property_owner', objectId: o.id, ownerId: o.managerId, dueAt: o.nextActionAt!, nextAction: `Собственник ${o.displayName}: ${o.nextAction ?? 'следующее действие'} — просрочено` } });
      await emitDomainEvent(tx, tenantId, 'owner.followup.overdue', 'property_owner', o.id, { stage: o.pipelineStage, deepLink: `/property/owners/${o.id}` });
      return { result: task, audit: { action: 'property_owner.followup_overdue', objectType: 'property_owner', objectId: o.id, after: { nextActionAt: o.nextActionAt } } };
    });
    n++;
  }
  return n;
}
