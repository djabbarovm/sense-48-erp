/**
 * P-12 WorkBot (docs/20 §11.4, blueprint §1.9/§7): structured draft → preview → confirm → commit → audit.
 * Извлекатель намерения — адаптер (rule-based mock по docs/07); commit выполняется ТОЛЬКО существующими сервисами
 * c их правами и guard'ами, поэтому бот не может обойти ни одно правило (BR-P30).
 */
import type { TenantContext } from '@finance-os/core';
import { PermissionDeniedError, ValidationError, can, requirePermission, stageIndex } from '@finance-os/core';
import type { Intent, IntentExtractor } from '@finance-os/adapters';
import { RuleBasedIntentExtractor } from '@finance-os/adapters';
import type { ActionDraft, ActionSource, Prisma, Unit } from '@prisma/client';
import { withAudit } from '../audit.js';
import { prisma } from '../client.js';
import { findScopedOr404, whereTenant } from '../repository.js';
import { addDealActivity, createDeal, moveDeal } from './deals.js';
import { terminateLease } from './leases.js';
import { addUnitActivity, changeUnitStatus, setUnitPublished } from './property.js';
import { createWorkOrder } from './workOrders.js';

let defaultExtractor: IntentExtractor = new RuleBasedIntentExtractor();
/** Подмена извлекателя (LLM-адаптер в проде, mock в тестах). */
export function setIntentExtractor(x: IntentExtractor): void {
  defaultExtractor = x;
}

const serialize = (intent: Intent): Prisma.InputJsonValue => JSON.parse(JSON.stringify(intent, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))) as Prisma.InputJsonValue;
const parse = (payload: unknown): Intent => {
  const p = payload as Record<string, unknown>;
  if (p.kind === 'DEAL_VIEWING_NOTE' && typeof p.expectedRateMinor === 'string') return { ...(p as object), expectedRateMinor: BigInt(p.expectedRateMinor) } as Intent;
  return p as unknown as Intent;
};

/** Право, необходимое для подтверждения каждого вида действия (BR-P30). */
export const CONFIRM_PERMISSION = {
  UNIT_VACATE: 'lease.manage',
  DEAL_VIEWING_NOTE: 'deal.manage',
  UNIT_ISSUE: 'workorder.create',
  QUERY_UNITS: 'property.view',
} as const;

function queryLink(i: Extract<Intent, { kind: 'QUERY_UNITS' }>): string {
  const q = new URLSearchParams();
  if (i.color) q.set('color', i.color);
  if (i.vacantOverDays) q.set('vacant', String([30, 60, 90].find((d) => d >= i.vacantOverDays!) ?? 90));
  if (i.leaseEndsWithinDays) q.set('expiring', String([30, 60, 90].find((d) => d >= i.leaseEndsWithinDays!) ?? 90));
  if (i.rentalMode) q.set('mode', i.rentalMode);
  const s = q.toString();
  return `/property${s ? `?${s}` : ''}`;
}

function buildPreview(intent: Intent | null, unit: Unit | null, activeLease: boolean, activeDeal: { number: string } | null): string {
  if (!intent) return 'Не удалось распознать действие. Примеры: «1704 освободился, можно выставлять», «1103 показали X Company, хотят 35 долларов», «2804 жалоба на ванную», «покажи все красные больше 90 дней».';
  if (intent.kind === 'QUERY_UNITS') {
    const parts = [intent.color ? `цвет ${intent.color}` : null, intent.vacantOverDays ? `простой > ${intent.vacantOverDays} дн.` : null, intent.leaseEndsWithinDays ? `договор истекает ≤ ${intent.leaseEndsWithinDays} дн.` : null, intent.rentalMode].filter(Boolean);
    return `Показать юниты: ${parts.join(', ') || 'все'} → ссылка на карту c фильтром. Данные не меняются.`;
  }
  if (!unit) return `Юнит «${intent.unitNo}» не найден в этом здании. Уточните номер.`;
  switch (intent.kind) {
    case 'UNIT_VACATE':
      return `${unit.unitNo}: ${activeLease ? 'расторгнуть действующий договор аренды (причина: выезд), ' : ''}отметить свободным${intent.publish ? ', выставить на рынок и опубликовать' : ''}. Цвет станет красным.`;
    case 'DEAL_VIEWING_NOTE':
      return `${unit.unitNo}: ${activeDeal ? `записать показ в сделку ${activeDeal.number}` : `создать сделку «${intent.company ?? 'клиент c показа'}» на стадии «Показ»`}${intent.expectedRateMinor != null ? `, ожидаемая ставка $${Number(intent.expectedRateMinor) / 100}${intent.perSqm ? '/м² (пересчёт на площадь)' : '/мес'}` : ''}. Стадия юнита обновится из сделки.`;
    case 'UNIT_ISSUE':
      return `${unit.unitNo}: создать заявку (${intent.category}, приоритет ${intent.severity === 'CRITICAL' ? 'КРИТИЧНЫЙ, SLA 4 ч' : 'высокий, SLA 24 ч'}); статус эксплуатации юнита пересчитается из заявки. Ответственный — эксплуатация.`;
  }
}

async function findActiveDeal(tenantId: string, unitId: string) {
  const deals = await prisma.deal.findMany({ where: { tenantId, unitId, stage: { notIn: ['WON', 'LOST'] } }, select: { id: true, number: true, stage: true, managerId: true } });
  return deals.sort((a, b) => stageIndex(b.stage) - stageIndex(a.stage))[0] ?? null;
}

export async function createActionDraft(ctx: TenantContext, input: { text: string; source?: ActionSource }, extractor: IntentExtractor = defaultExtractor): Promise<ActionDraft> {
  requirePermission(ctx, 'action.draft');
  const text = input.text.trim();
  if (!text) throw new ValidationError('TEXT_REQUIRED');
  if (text.length > 1000) throw new ValidationError('TEXT_TOO_LONG');
  const { intent, confidence } = await extractor.extract({ text });
  const unit = intent && intent.kind !== 'QUERY_UNITS' ? await prisma.unit.findFirst({ where: { tenantId: ctx.tenantId, unitNo: { equals: intent.unitNo, mode: 'insensitive' } } }) : null;
  const activeLease = unit ? (await prisma.leaseContract.count({ where: { tenantId: ctx.tenantId, unitId: unit.id, status: { in: ['ACTIVE', 'EXPIRING'] } } })) > 0 : false;
  const activeDeal = unit ? await findActiveDeal(ctx.tenantId, unit.id) : null;
  const needsInfo = !intent || (intent.kind !== 'QUERY_UNITS' && !unit);
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const created = await tx.actionDraft.create({
      data: {
        tenantId: ctx.tenantId, source: input.source ?? 'WEB', rawText: text, kind: intent?.kind ?? null, payload: intent ? serialize(intent) : {},
        confidence: Math.round(confidence * 100), unitId: unit?.id ?? null, status: needsInfo ? 'NEEDS_INFO' : 'DRAFT',
        preview: buildPreview(intent, unit, activeLease, activeDeal), createdBy: ctx.userId,
      },
    });
    // rawText может содержать имена/телефоны — в audit только вид действия и юнит (docs/11)
    return { result: created, audit: { action: 'action_draft.create', objectType: 'action_draft', objectId: created.id, after: { kind: created.kind, unitNo: unit?.unitNo ?? null, status: created.status, confidence: created.confidence, source: created.source } } };
  });
}

/** Подтверждение: право по виду действия, commit через сервисы, результат/ошибка в черновике, всё в audit. */
export async function confirmActionDraft(ctx: TenantContext, id: string): Promise<ActionDraft> {
  requirePermission(ctx, 'action.draft');
  const draft = await findScopedOr404(prisma.actionDraft, ctx, id);
  if (draft.status !== 'DRAFT') throw new ValidationError('DRAFT_NOT_CONFIRMABLE', `DRAFT_NOT_CONFIRMABLE: статус ${draft.status}`);
  const intent = parse(draft.payload);
  const permission = CONFIRM_PERMISSION[intent.kind];
  if (!can(ctx, permission)) throw new PermissionDeniedError(permission);
  const unit = draft.unitId ? await findScopedOr404(prisma.unit, ctx, draft.unitId) : null;

  let resultRef: string | null = null;
  let error: string | null = null;
  try {
    switch (intent.kind) {
      case 'QUERY_UNITS':
        resultRef = queryLink(intent);
        break;
      case 'UNIT_VACATE': {
        const lease = await prisma.leaseContract.findFirst({ where: { tenantId: ctx.tenantId, unitId: unit!.id, status: { in: ['ACTIVE', 'EXPIRING'] } } });
        if (lease) await terminateLease(ctx, lease.id, `Выезд (WorkBot: «${draft.rawText.slice(0, 80)}»)`);
        else if (unit!.occupancy !== 'VACANT' || unit!.commercialStatus !== 'AVAILABLE') {
          await changeUnitStatus(ctx, unit!.id, { ...(unit!.occupancy !== 'VACANT' ? { occupancy: 'VACANT', rentalMode: 'NONE', leaseStatus: unit!.leaseStatus === 'NONE' ? 'NONE' : 'TERMINATED' } : {}), ...(unit!.commercialStatus !== 'AVAILABLE' ? { commercialStatus: 'AVAILABLE' } : {}), reason: 'WorkBot: освобождение', source: 'AI' });
        }
        if (intent.publish && can(ctx, 'unit.publish')) await setUnitPublished(ctx, unit!.id, true);
        resultRef = `/property/units/${unit!.id}`;
        break;
      }
      case 'DEAL_VIEWING_NOTE': {
        const rate = intent.expectedRateMinor != null ? (intent.perSqm ? BigInt(Math.round(Number(intent.expectedRateMinor) * Number(unit!.areaM2))) : intent.expectedRateMinor) : null;
        let deal = await findActiveDeal(ctx.tenantId, unit!.id);
        if (!deal) {
          const created = await createDeal(ctx, { contactName: intent.company ?? 'Клиент c показа', company: intent.company, unitId: unit!.id, expectedRateMinor: rate, source: 'WALK_IN' });
          deal = { id: created.id, number: created.number, stage: created.stage, managerId: created.managerId };
        }
        await addDealActivity(ctx, deal.id, { kind: 'VIEWING', note: draft.rawText, expectedRateMinor: rate });
        if (stageIndex(deal.stage) < stageIndex('VIEWING')) {
          while (stageIndex((await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } })).stage) < stageIndex('VIEWING')) await moveDeal(ctx, deal.id, 'advance');
        }
        resultRef = `/deals/${deal.id}`;
        break;
      }
      case 'UNIT_ISSUE': {
        // Заявка — источник истины operationalStatus (BR-P31): статус юнита пересчитается из неё
        const wo = await createWorkOrder(ctx, { unitId: unit!.id, category: intent.category === 'CLEANING' ? 'CLEANING' : intent.category === 'DAMAGE' ? 'DAMAGE' : intent.category === 'ELECTRICAL' ? 'ELECTRICAL' : intent.category === 'PLUMBING' ? 'PLUMBING' : 'OTHER', priority: intent.severity === 'CRITICAL' ? 'CRITICAL' : 'HIGH', title: draft.rawText.slice(0, 120), description: draft.rawText, source: 'AI' });
        if (can(ctx, 'unit.activity.create')) await addUnitActivity(ctx, unit!.id, { kind: 'NOTE', note: `[${intent.category}] ${draft.rawText} → ${wo.number}`, source: 'AI' });
        resultRef = `/workorders/${wo.id}`;
        break;
      }
    }
  } catch (e) {
    if (e instanceof ValidationError) error = e.code;
    else throw e;
  }

  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const after = await tx.actionDraft.update({ where: { id }, data: { status: error ? 'FAILED' : 'CONFIRMED', resultRef, error, confirmedBy: ctx.userId, confirmedAt: new Date() } });
    return { result: after, audit: { action: error ? 'action_draft.fail' : 'action_draft.confirm', objectType: 'action_draft', objectId: id, before: { status: 'DRAFT' }, after: { status: after.status, kind: after.kind, resultRef, error } } };
  });
}

export async function rejectActionDraft(ctx: TenantContext, id: string, reason?: string): Promise<ActionDraft> {
  requirePermission(ctx, 'action.draft');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const before = await findScopedOr404(tx.actionDraft, ctx, id);
    if (before.status !== 'DRAFT' && before.status !== 'NEEDS_INFO') throw new ValidationError('DRAFT_NOT_REJECTABLE');
    const after = await tx.actionDraft.update({ where: { id }, data: { status: 'REJECTED', error: reason?.trim() || null, confirmedBy: ctx.userId, confirmedAt: new Date() } });
    return { result: after, audit: { action: 'action_draft.reject', objectType: 'action_draft', objectId: id, before: { status: before.status }, after: { status: 'REJECTED', reason: reason ?? null } } };
  });
}

export async function listActionDrafts(ctx: TenantContext, filter: { status?: ActionDraft['status'][]; mine?: boolean } = {}) {
  requirePermission(ctx, 'action.draft');
  const rows = await prisma.actionDraft.findMany({
    where: whereTenant(ctx, { ...(filter.status ? { status: { in: filter.status } } : {}), ...(filter.mine ? { createdBy: ctx.userId } : {}) }),
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  const users = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => [r.createdBy, r.confirmedBy].filter((x): x is string => !!x)))] } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  return rows.map((r) => ({
    ...r,
    createdByName: users.get(r.createdBy) ?? '—',
    confirmedByName: r.confirmedBy ? (users.get(r.confirmedBy) ?? '—') : null,
    canConfirm: r.status === 'DRAFT' && !!r.kind && can(ctx, CONFIRM_PERMISSION[r.kind as keyof typeof CONFIRM_PERMISSION]),
  }));
}

/** Для API бота: пользователь по Telegram chat id c ролью в тенанте ключа. */
export async function resolveBotUser(tenantId: string, telegramChatId: string): Promise<{ userId: string; tenantSlug: string } | null> {
  const user = await prisma.user.findFirst({ where: { telegramChatId, status: 'ACTIVE' }, select: { id: true } });
  if (!user) return null;
  const role = await prisma.userTenantRole.findFirst({ where: { userId: user.id, tenantId }, include: { tenant: { select: { slug: true } } } });
  if (!role) return null;
  return { userId: user.id, tenantSlug: role.tenant.slug };
}

