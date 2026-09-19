/**
 * P-17: приём лидов c сайта / бота (blueprint §3, §8, §14): форма → Deal (source WEBSITE/TELEGRAM) c UTM и выбранным юнитом.
 * Без сессии: API-ключ тенанта (scope LEADS). Менеджер — дежурный (tenant.settings.lead_default_manager) или первый COMMERCIAL_MANAGER.
 * Дедуп: тот же телефон/email c активной сделкой за 30 дней → активность в существующую сделку, а не дубликат (BR-P34).
 */
import type { DealSource } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { ValidationError, checkRateLimit } from '@finance-os/core';
import { prisma } from '../client.js';
import { nextNumber } from '../sequence.js';
import { withAudit } from '../audit.js';
import { resolveContact } from './contacts.js';
import { emitDomainEvent } from './domainEvents.js';
import { recomputeUnitCommercialStatus } from './deals.js';

export interface LeadInput {
  contactName: string;
  contactPhone?: string | null;
  contactEmail?: string | null;
  company?: string | null;
  message?: string | null;
  unitNo?: string | null;
  buildingCode?: string | null;
  purpose?: string | null;
  budgetMinor?: bigint | null;
  source?: DealSource;
  utm?: Record<string, string> | null;
  page?: string | null;
}

export interface LeadResult {
  dealId: string;
  number: string;
  created: boolean;
}

/** Только цифры c ведущим «+»: «+998 90 123-45-67» и «998901234567» — один и тот же контакт. */
const normPhone = (p?: string | null) => { const d = p ? p.replace(/\D/g, '') : ''; return d ? `+${d}` : null; };

/** Ключ дедупа: телефон (нормализованный) или email; проверяется по активным сделкам за 30 дней. */
export async function intakeLead(tenantId: string, input: LeadInput, now = new Date()): Promise<LeadResult> {
  if (!input.contactName?.trim()) throw new ValidationError('CONTACT_REQUIRED');
  const rawPhone = input.contactPhone?.trim() || null;
  const phone = rawPhone ? normPhone(rawPhone) : null;
  if (rawPhone && !/^\+?\d{7,15}$/.test(phone ?? '')) throw new ValidationError('PHONE_INVALID');
  const email = input.contactEmail?.trim().toLowerCase() || null;
  if (!phone && !email) throw new ValidationError('CONTACT_CHANNEL_REQUIRED', 'CONTACT_CHANNEL_REQUIRED: нужен телефон или email');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError('EMAIL_INVALID');
  const limit = checkRateLimit(`lead:${tenantId}:${phone ?? email}`, 5, 3600);
  if (!limit.allowed) throw new ValidationError('RATE_LIMITED');

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true, slug: true } });
  const settings = tenant.settings as Record<string, unknown>;
  const managerId = (typeof settings.lead_default_manager === 'string' ? settings.lead_default_manager : null) ?? (await prisma.userTenantRole.findFirst({ where: { tenantId, role: 'COMMERCIAL_MANAGER' }, orderBy: { createdAt: 'asc' }, select: { userId: true } }))?.userId ?? (await prisma.userTenantRole.findFirst({ where: { tenantId, role: 'OWNER' }, select: { userId: true } }))?.userId;
  if (!managerId) throw new ValidationError('NO_MANAGER', 'NO_MANAGER: в тенанте нет коммерческого менеджера для лидов');
  const unit = input.unitNo ? await prisma.unit.findFirst({ where: { tenantId, unitNo: { equals: input.unitNo.trim(), mode: 'insensitive' }, ...(input.buildingCode ? { building: { code: input.buildingCode.trim().toUpperCase() } } : {}) } }) : null;
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const existing = await prisma.deal.findFirst({
    where: { tenantId, stage: { notIn: ['WON', 'LOST'] }, createdAt: { gte: since }, OR: [...(phone ? [{ contactPhone: phone }] : []), ...(email ? [{ contactEmail: email }] : [])] },
    orderBy: { createdAt: 'desc' },
  });
  const note = [input.message?.trim(), input.page ? `страница: ${input.page}` : null, input.utm ? `utm: ${Object.entries(input.utm).map(([k, v]) => `${k}=${v}`).join(' ')}` : null].filter(Boolean).join(' · ');

  if (existing) {
    // BR-P34: повторное обращение → активность в существующую сделку, менеджеру — следующее действие
    return withAudit({ tenantId, userId: managerId }, async (tx) => {
      await tx.unitActivity.create({ data: { tenantId, dealId: existing.id, unitId: unit?.id ?? existing.unitId, kind: 'NOTE', note: `Повторное обращение c сайта${unit ? ` по ${unit.unitNo}` : ''}: ${note || '—'}`, source: 'API', actorId: managerId } });
      await tx.deal.update({ where: { id: existing.id }, data: { nextAction: 'Перезвонить: повторное обращение c сайта', nextActionAt: now, ...(unit && !existing.unitId ? { unitId: unit.id, stage: existing.stage === 'NEW' || existing.stage === 'QUALIFIED' ? 'PROPERTY_SELECTED' : existing.stage } : {}) } });
      if (unit) await recomputeUnitCommercialStatus(tx, tenantId, unit.id, now);
      await emitDomainEvent(tx, tenantId, 'deal.stage.changed', 'deal', existing.id, { number: existing.number, stage: existing.stage, detail: 'repeat lead', deepLink: `/deals/${existing.id}` });
      return { result: { dealId: existing.id, number: existing.number, created: false }, audit: { action: 'deal.lead.repeat', objectType: 'deal', objectId: existing.id, after: { source: input.source ?? 'WEBSITE', unitNo: unit?.unitNo ?? null } } };
    });
  }

  return withAudit({ tenantId, userId: managerId }, async (tx) => {
    const number = await nextNumber(tx, tenantId, 'DEAL', now);
    const contact = await resolveContact(tx, tenantId, { name: input.contactName, phone, email, company: input.company, source: input.source ?? 'WEBSITE', managerId, actorId: managerId }, now);
    const created = await tx.deal.create({
      data: {
        tenantId, number, contactName: input.contactName.trim(), contactPhone: phone, contactEmail: email, contactId: contact.id, company: input.company?.trim() || null,
        source: input.source ?? 'WEBSITE', utm: input.utm ? (input.utm as Prisma.InputJsonValue) : Prisma.DbNull, purpose: input.purpose?.trim() || null, budgetMinor: input.budgetMinor ?? null,
        unitId: unit?.id ?? null, managerId, stage: unit ? 'PROPERTY_SELECTED' : 'NEW', nextAction: 'Связаться c лидом c сайта', nextActionAt: now,
        expectedRateMinor: unit?.askingRateMinor ?? null, createdBy: managerId,
      },
    });
    if (note) await tx.unitActivity.create({ data: { tenantId, dealId: created.id, unitId: unit?.id ?? null, kind: 'NOTE', note, source: 'API', actorId: managerId } });
    if (unit) await recomputeUnitCommercialStatus(tx, tenantId, unit.id, now);
    await emitDomainEvent(tx, tenantId, 'deal.stage.changed', 'deal', created.id, { number, stage: created.stage, detail: `lead ${created.source}`, deepLink: `/deals/${created.id}` });
    // контакты (PII) — не в audit
    return { result: { dealId: created.id, number, created: true }, audit: { action: 'deal.lead.intake', objectType: 'deal', objectId: created.id, after: { number, source: created.source, unitNo: unit?.unitNo ?? null, utm: input.utm ?? null } } };
  });
}
