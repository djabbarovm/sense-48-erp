/**
 * CRM Tower — контакты (docs/20 §11.14, P-22a). Один клиент — много сделок; сделка и лид автоматически
 * привязываются к контакту по каноническому телефону (BR-P55), затем по email; собственник c тем же
 * телефоном — тот же человек (contact.ownerId). PII отдаётся только c deal.contact.view, иначе маскируется.
 */
import type { TenantContext } from '@finance-os/core';
import { NotFoundError, ValidationError, can, matchContact, maskEmail, maskPhone, normalizeEmail, normalizePhone, requirePermission, type ContactKind } from '@finance-os/core';
import type { Contact, DealSource, Prisma } from '@prisma/client';
import { withAudit } from '../audit.js';
import { prisma } from '../client.js';
import { findScopedOr404 } from '../repository.js';
import type { MigrationReport } from './migration.js';

type Tx = Prisma.TransactionClient;

export interface ContactInput { displayName: string; kind?: ContactKind; phone?: string | null; phoneAlt?: string | null; email?: string | null; company?: string | null; position?: string | null; source?: DealSource | null; tags?: string[]; notes?: string | null; managerId?: string | null }

const pick = (c: Contact) => ({ kind: c.kind, displayName: c.displayName, company: c.company, source: c.source, tags: c.tags, ownerId: c.ownerId, managerId: c.managerId, hasPhone: !!c.phone, hasEmail: !!c.email }); // PII в audit не пишем

/** Найти или создать контакт внутри транзакции (createDeal / intakeLead / импорт). Возвращает id и признак создания. */
export async function resolveContact(tx: Tx, tenantId: string, input: { name: string; phone?: string | null | undefined; email?: string | null | undefined; company?: string | null | undefined; source?: DealSource | null | undefined; managerId?: string | null | undefined; actorId?: string | null | undefined }, now = new Date()): Promise<{ id: string; created: boolean }> {
  const phone = normalizePhone(input.phone);
  const email = normalizeEmail(input.email);
  const cands = phone || email ? await tx.contact.findMany({ where: { tenantId, OR: [...(phone ? [{ phone }, { phoneAlt: phone }] : []), ...(email ? [{ email }] : [])] } }) : [];
  const hit = matchContact(cands, phone, email);
  if (hit) {
    await tx.contact.update({ where: { id: hit.id }, data: { lastTouchAt: now, ...(!hit.email && email ? { email } : {}), ...(!hit.company && input.company ? { company: input.company } : {}) } });
    return { id: hit.id, created: false };
  }
  const owner = phone ? await tx.propertyOwner.findFirst({ where: { tenantId, contactPhone: { not: null } }, select: { id: true, contactPhone: true } }).then(async () => {
    const owners = await tx.propertyOwner.findMany({ where: { tenantId, contactPhone: { not: null } }, select: { id: true, contactPhone: true } });
    return owners.find((o) => { try { return normalizePhone(o.contactPhone) === phone; } catch { return false; } }) ?? null;
  }) : null;
  const created = await tx.contact.create({ data: { tenantId, displayName: input.name.trim(), phone, email, company: input.company?.trim() || null, source: input.source ?? null, managerId: input.managerId ?? null, ownerId: owner?.id ?? null, lastTouchAt: now, createdBy: input.actorId ?? null } });
  return { id: created.id, created: true };
}

export async function createContact(ctx: TenantContext, input: ContactInput): Promise<Contact> {
  requirePermission(ctx, 'deal.manage');
  if (!input.displayName.trim()) throw new ValidationError('NAME_REQUIRED');
  const phone = normalizePhone(input.phone); const email = normalizeEmail(input.email);
  if (!phone && !email) throw new ValidationError('CONTACT_CHANNEL_REQUIRED', 'CONTACT_CHANNEL_REQUIRED: нужен телефон или email');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    if (phone && (await tx.contact.findFirst({ where: { tenantId: ctx.tenantId, OR: [{ phone }, { phoneAlt: phone }] } }))) throw new ValidationError('CONTACT_DUPLICATE', 'CONTACT_DUPLICATE: контакт c таким телефоном уже есть');
    const created = await tx.contact.create({ data: { tenantId: ctx.tenantId, kind: input.kind ?? 'PERSON', displayName: input.displayName.trim(), phone, phoneAlt: normalizePhone(input.phoneAlt), email, company: input.company?.trim() || null, position: input.position?.trim() || null, source: input.source ?? null, tags: input.tags ?? [], notes: input.notes?.trim() || null, managerId: input.managerId ?? ctx.userId, lastTouchAt: new Date(), createdBy: ctx.userId } });
    return { result: created, audit: { action: 'contact.create', objectType: 'contact', objectId: created.id, after: pick(created) } };
  });
}

export async function updateContact(ctx: TenantContext, id: string, patch: Partial<ContactInput>): Promise<Contact> {
  requirePermission(ctx, 'deal.manage');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const before = await findScopedOr404(tx.contact, ctx, id);
    const phone = patch.phone !== undefined ? normalizePhone(patch.phone) : undefined;
    if (phone && phone !== before.phone && (await tx.contact.findFirst({ where: { tenantId: ctx.tenantId, id: { not: id }, OR: [{ phone }, { phoneAlt: phone }] } }))) throw new ValidationError('CONTACT_DUPLICATE');
    const after = await tx.contact.update({ where: { id }, data: { ...(patch.displayName !== undefined ? { displayName: patch.displayName.trim() } : {}), ...(patch.kind !== undefined ? { kind: patch.kind } : {}), ...(phone !== undefined ? { phone } : {}), ...(patch.phoneAlt !== undefined ? { phoneAlt: normalizePhone(patch.phoneAlt) } : {}), ...(patch.email !== undefined ? { email: normalizeEmail(patch.email) } : {}), ...(patch.company !== undefined ? { company: patch.company?.trim() || null } : {}), ...(patch.position !== undefined ? { position: patch.position?.trim() || null } : {}), ...(patch.source !== undefined ? { source: patch.source } : {}), ...(patch.tags !== undefined ? { tags: patch.tags } : {}), ...(patch.notes !== undefined ? { notes: patch.notes?.trim() || null } : {}), ...(patch.managerId !== undefined ? { managerId: patch.managerId } : {}), updatedBy: ctx.userId } });
    return { result: after, audit: { action: 'contact.update', objectType: 'contact', objectId: id, before: pick(before), after: pick(after) } };
  });
}

/** Слияние дублей: сделки и доп. телефон переходят в keep, merge удаляется. contact.merge (OWNER, COMMERCIAL_MANAGER). */
export async function mergeContacts(ctx: TenantContext, keepId: string, mergeId: string): Promise<Contact> {
  requirePermission(ctx, 'contact.merge');
  if (keepId === mergeId) throw new ValidationError('SAME_CONTACT');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const keep = await findScopedOr404(tx.contact, ctx, keepId);
    const merge = await findScopedOr404(tx.contact, ctx, mergeId);
    const moved = await tx.deal.updateMany({ where: { tenantId: ctx.tenantId, contactId: mergeId }, data: { contactId: keepId } });
    await tx.contact.delete({ where: { id: mergeId } });
    const after = await tx.contact.update({ where: { id: keepId }, data: { phoneAlt: keep.phoneAlt ?? (merge.phone !== keep.phone ? merge.phone : null), email: keep.email ?? merge.email, company: keep.company ?? merge.company, ownerId: keep.ownerId ?? merge.ownerId, tags: [...new Set([...keep.tags, ...merge.tags])], notes: [keep.notes, merge.notes].filter(Boolean).join('\n') || null, updatedBy: ctx.userId } });
    return { result: after, audit: { action: 'contact.merge', objectType: 'contact', objectId: keepId, before: { mergedId: mergeId, mergedName: merge.displayName }, after: { ...pick(after), dealsMoved: moved.count } } };
  });
}

export interface ContactRow { id: string; kind: ContactKind; displayName: string; phone: string | null; email: string | null; company: string | null; source: DealSource | null; tags: string[]; ownerId: string | null; managerId: string | null; lastTouchAt: Date | null; dealsTotal: number; dealsActive: number; lastStage: string | null }

const CLOSED = ['WON', 'LOST'];

export async function listContacts(ctx: TenantContext, filter: { q?: string; managerId?: string; ownersOnly?: boolean; take?: number; skip?: number } = {}): Promise<ContactRow[]> {
  requirePermission(ctx, 'deal.view');
  const pii = can(ctx, 'deal.contact.view');
  const q = filter.q?.trim();
  let qPhone: string | null = null; try { qPhone = q && /\d{4,}/.test(q) ? normalizePhone(q) : null; } catch { qPhone = null; }
  const where: Prisma.ContactWhereInput = { tenantId: ctx.tenantId, ...(filter.managerId ? { managerId: filter.managerId } : {}), ...(filter.ownersOnly ? { ownerId: { not: null } } : {}), ...(q ? { OR: [{ displayName: { contains: q, mode: 'insensitive' } }, { company: { contains: q, mode: 'insensitive' } }, { email: { contains: q.toLowerCase() } }, ...(qPhone ? [{ phone: { contains: qPhone.slice(1) } }, { phoneAlt: { contains: qPhone.slice(1) } }] : [])] } : {}) };
  const rows = await prisma.contact.findMany({ where, include: { deals: { select: { stage: true, updatedAt: true }, orderBy: { updatedAt: 'desc' } } }, orderBy: [{ lastTouchAt: 'desc' }, { displayName: 'asc' }], ...(filter.take ? { take: filter.take } : {}), ...(filter.skip ? { skip: filter.skip } : {}) });
  return rows.map(({ deals, ...c }) => ({ id: c.id, kind: c.kind, displayName: c.displayName, phone: pii ? c.phone : maskPhone(c.phone), email: pii ? c.email : maskEmail(c.email), company: c.company, source: c.source, tags: c.tags, ownerId: c.ownerId, managerId: c.managerId, lastTouchAt: c.lastTouchAt, dealsTotal: deals.length, dealsActive: deals.filter((d) => !CLOSED.includes(d.stage)).length, lastStage: deals[0]?.stage ?? null }));
}

export async function getContact(ctx: TenantContext, id: string) {
  requirePermission(ctx, 'deal.view');
  const pii = can(ctx, 'deal.contact.view');
  const c = await prisma.contact.findFirst({ where: { tenantId: ctx.tenantId, id }, include: { deals: { include: { unit: { select: { unitNo: true } } }, orderBy: { updatedAt: 'desc' } } } });
  if (!c) throw new NotFoundError('CONTACT_NOT_FOUND');
  const owner = c.ownerId ? await prisma.propertyOwner.findFirst({ where: { id: c.ownerId }, select: { id: true, displayName: true, managementContractStatus: true, units: { select: { id: true, unitNo: true } } } }) : null;
  const activities = await prisma.unitActivity.findMany({ where: { tenantId: ctx.tenantId, dealId: { in: c.deals.map((d) => d.id) } }, orderBy: { happenedAt: 'desc' }, take: 30, include: { deal: { select: { number: true } }, unit: { select: { unitNo: true } } } });
  const managers = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set([c.managerId, ...c.deals.map((d) => d.managerId)].filter((x): x is string => !!x))] } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  return {
    contact: { ...c, phone: pii ? c.phone : maskPhone(c.phone), phoneAlt: pii ? c.phoneAlt : maskPhone(c.phoneAlt), email: pii ? c.email : maskEmail(c.email), managerName: c.managerId ? (managers.get(c.managerId) ?? null) : null, deals: undefined },
    deals: c.deals.map((d) => ({ id: d.id, number: d.number, stage: d.stage, product: d.product, unitNo: d.unit?.unitNo ?? null, managerName: managers.get(d.managerId) ?? '—', nextAction: d.nextAction, nextActionAt: d.nextActionAt, updatedAt: d.updatedAt, expectedRateMinor: d.expectedRateMinor, salePriceMinor: d.salePriceMinor })),
    activities: activities.map((a) => ({ id: a.id, kind: a.kind, note: a.note, happenedAt: a.happenedAt, followUpAt: a.followUpAt, dealNumber: a.deal?.number ?? null, unitNo: a.unit?.unitNo ?? null })),
    owner,
    canEdit: can(ctx, 'deal.manage'), canMerge: can(ctx, 'contact.merge'), pii,
  };
}

/** Кандидаты в дубли: одинаковое имя (без регистра) или один email при разных телефонах. */
export async function findDuplicateContacts(ctx: TenantContext) {
  requirePermission(ctx, 'deal.view');
  const rows = await prisma.contact.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, displayName: true, phone: true, email: true } });
  const groups = new Map<string, typeof rows>();
  for (const r of rows) { const k = r.displayName.trim().toLowerCase(); groups.set(k, [...(groups.get(k) ?? []), r]); }
  return [...groups.values()].filter((g) => g.length > 1).slice(0, 50);
}

/** Импорт клиентской базы contacts.xlsx: full_name*, phone, email, company, position, source, tags (через ;), note, manager_email. Дубли по телефону/email — skipped. */
export async function importContactsXlsx(ctx: TenantContext, rows: Record<string, string>[]): Promise<MigrationReport> {
  requirePermission(ctx, 'deal.manage');
  const report: MigrationReport = { total: rows.length, imported: 0, skipped: 0, errors: [] };
  const users = new Map((await prisma.userTenantRole.findMany({ where: { tenantId: ctx.tenantId }, include: { user: { select: { email: true } } } })).map((r) => [r.user.email.toLowerCase(), r.userId]));
  const SOURCES = ['WEBSITE', 'TELEGRAM', 'INSTAGRAM', 'REFERRAL', 'BROKER', 'WALK_IN', 'OTHER'];
  const prepared: { name: string; phone: string | null; email: string | null; company: string | null; position: string | null; source: DealSource | null; tags: string[]; notes: string | null; managerId: string | null }[] = [];
  rows.forEach((row, i) => {
    const line = i + 2;
    if (!row.full_name?.trim()) report.errors.push({ row: line, field: 'full_name', message: 'Обязательное поле' });
    let phone: string | null = null; let email: string | null = null;
    try { phone = normalizePhone(row.phone); } catch { report.errors.push({ row: line, field: 'phone', message: 'Телефон 7–15 цифр' }); }
    try { email = normalizeEmail(row.email); } catch { report.errors.push({ row: line, field: 'email', message: 'Неверный email' }); }
    if (!phone && !email) report.errors.push({ row: line, field: 'phone', message: 'Нужен телефон или email' });
    if (row.source && !SOURCES.includes(row.source)) report.errors.push({ row: line, field: 'source', message: SOURCES.join(' / ') });
    if (row.manager_email && !users.has(row.manager_email.toLowerCase())) report.errors.push({ row: line, field: 'manager_email', message: `Пользователь «${row.manager_email}» не найден` });
    prepared.push({ name: row.full_name?.trim() ?? '', phone, email, company: row.company?.trim() || null, position: row.position?.trim() || null, source: (row.source as DealSource) || null, tags: (row.tags ?? '').split(/[;,]/).map((t) => t.trim()).filter(Boolean), notes: row.note?.trim() || null, managerId: row.manager_email ? (users.get(row.manager_email.toLowerCase()) ?? null) : null });
  });
  if (report.errors.length) return report;
  await withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    for (const p of prepared) {
      const exists = await tx.contact.findFirst({ where: { tenantId: ctx.tenantId, OR: [...(p.phone ? [{ phone: p.phone }, { phoneAlt: p.phone }] : []), ...(p.email ? [{ email: p.email }] : [])] } });
      if (exists) { report.skipped++; continue; }
      await tx.contact.create({ data: { tenantId: ctx.tenantId, displayName: p.name, phone: p.phone, email: p.email, company: p.company, position: p.position, source: p.source, tags: p.tags, notes: p.notes, managerId: p.managerId ?? ctx.userId, createdBy: ctx.userId } });
      report.imported++;
    }
    return { result: report, audit: { action: 'migration.contacts', objectType: 'tenant', objectId: ctx.tenantId, after: { imported: report.imported, skipped: report.skipped } } };
  });
  return report;
}
