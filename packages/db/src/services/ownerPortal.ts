/**
 * Wave 4b: Owner Portal (blueprint §10, docs/20 §11.6). Собственник видит ТОЛЬКО свои юниты (BR-P33):
 * роль PROPERTY_OWNER не имеет property.view; все выборки идут через PropertyOwner.userId = ctx.userId.
 */
import type { TenantContext } from '@finance-os/core';
import { NotFoundError, ValidationError, deriveUnitView, requirePermission } from '@finance-os/core';
import type { StorageAdapter } from '@finance-os/adapters';
import type { DocType, PropertyOwner, WorkOrderCategory } from '@prisma/client';
import { withAudit } from '../audit.js';
import { prisma } from '../client.js';
import { findScopedOr404, whereTenant } from '../repository.js';
import { storeDocument } from './documents.js';
import { createServiceOrder, listCatalog, listServiceOrders, rateServiceOrder } from './serviceOrders.js';
import { createWorkOrder } from './workOrders.js';

export const DEFAULT_MANAGEMENT_FEE_BP = 1000; // 10% — переопределяется tenant.settings.management_fee_bp

async function ownerOf(ctx: TenantContext): Promise<PropertyOwner> {
  requirePermission(ctx, 'owner.portal');
  const owner = await prisma.propertyOwner.findFirst({ where: { tenantId: ctx.tenantId, userId: ctx.userId } });
  if (!owner) throw new NotFoundError('OWNER_NOT_LINKED');
  return owner;
}

export interface OwnerUnitView {
  id: string;
  unitNo: string;
  building: string;
  floorNo: number;
  type: string;
  areaM2: number;
  color: string;
  labelKey: string;
  managedByPlatform: boolean;
  occupantName: string | null;
  lease: { id: string; type: string; status: string; startAt: Date; endAt: Date | null; rentMinor: bigint; depositMinor: bigint | null; depositReceived: boolean; currency: string } | null;
  openWorkOrders: number;
  publishedAt: Date | null;
  askingRateMinor: bigint | null;
  askingCurrency: string;
}

export interface OwnerStatementLine {
  unitNo: string;
  rentMinor: bigint;
  feeMinor: bigint;
  payoutMinor: bigint;
  currency: string;
  managed: boolean;
}

export async function getOwnerPortal(ctx: TenantContext, today = new Date()) {
  const owner = await ownerOf(ctx);
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { settings: true, legalName: true } });
  const feeBp = Number((tenant.settings as Record<string, unknown>).management_fee_bp ?? DEFAULT_MANAGEMENT_FEE_BP);
  const units = await prisma.unit.findMany({
    where: { tenantId: ctx.tenantId, ownerId: owner.id },
    include: { building: { select: { name: true } }, floor: { select: { floorNo: true } }, leases: { where: { status: { in: ['ACTIVE', 'EXPIRING'] } }, take: 1 }, workOrders: { where: { status: { in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'DONE'] } }, select: { id: true } } },
    orderBy: { unitNo: 'asc' },
  });
  const views: OwnerUnitView[] = units.map((u) => {
    const v = deriveUnitView(u, today);
    const l = u.leases[0] ?? null;
    return {
      id: u.id, unitNo: u.unitNo, building: u.building.name, floorNo: u.floor.floorNo, type: u.type, areaM2: Number(u.areaM2), color: v.color, labelKey: v.labelKey,
      managedByPlatform: u.managedByPlatform, occupantName: u.occupantName, publishedAt: u.publishedAt, askingRateMinor: u.askingRateMinor, askingCurrency: u.askingCurrency,
      lease: l ? { id: l.id, type: l.type, status: l.status, startAt: l.startAt, endAt: l.endAt, rentMinor: l.rentMinor, depositMinor: l.depositMinor, depositReceived: l.depositReceived, currency: l.currency } : null,
      openWorkOrders: u.workOrders.length,
    };
  });
  // Выписка за текущий месяц: аренда по действующим договорам; комиссия управления — только для юнитов под управлением
  const statement: OwnerStatementLine[] = views.filter((v) => v.lease && v.lease.type !== 'OWNER_USE').map((v) => {
    const rent = v.lease!.rentMinor;
    const fee = v.managedByPlatform ? (rent * BigInt(feeBp)) / 10_000n : 0n;
    return { unitNo: v.unitNo, rentMinor: rent, feeMinor: fee, payoutMinor: rent - fee, currency: v.lease!.currency, managed: v.managedByPlatform };
  });
  const totals = statement.reduce((a, l) => ({ rent: a.rent + l.rentMinor, fee: a.fee + l.feeMinor, payout: a.payout + l.payoutMinor }), { rent: 0n, fee: 0n, payout: 0n });
  const requests = await prisma.workOrder.findMany({ where: { tenantId: ctx.tenantId, unitId: { in: units.map((u) => u.id) } }, orderBy: { createdAt: 'desc' }, take: 20, include: { unit: { select: { unitNo: true } } } });
  const documents = await listOwnerDocuments(ctx);
  const [catalog, serviceOrders] = await Promise.all([listCatalog(ctx), listServiceOrders(ctx, { ownerId: owner.id }, today)]);
  return {
    owner: { id: owner.id, displayName: owner.displayName, kind: owner.kind, managementConsent: owner.managementConsent, listingConsent: owner.listingConsent, marketingConsent: owner.marketingConsent, consentUpdatedAt: owner.consentUpdatedAt },
    company: tenant.legalName,
    feeBp,
    units: views,
    statement,
    totals,
    requests: requests.map((r) => ({ id: r.id, number: r.number, unitNo: r.unit?.unitNo ?? null, title: r.title, status: r.status, priority: r.priority, createdAt: r.createdAt, slaDueAt: r.slaDueAt, doneAt: r.doneAt })),
    documents,
    catalog: catalog.map((c) => ({ id: c.id, code: c.code, name: c.name, category: c.category, providerKind: c.providerKind, partnerName: c.partnerName, priceMinor: c.priceMinor, currency: c.currency, slaHours: c.slaHours, description: c.description })),
    serviceOrders: serviceOrders.slice(0, 20).map((o) => ({ id: o.id, number: o.number, unitNo: o.unitNo, serviceName: o.serviceName, status: o.status, priceMinor: o.priceMinor, currency: o.currency, scheduledAt: o.scheduledAt, doneAt: o.doneAt, rating: o.rating, canRate: ['DONE', 'VERIFIED'].includes(o.status) && o.rating == null })),
  };
}

// ── Документы собственника (blueprint §13: document registry; BR-P33 — только по своим договорам/юнитам) ──

export interface OwnerDocumentRow {
  id: string;
  objectType: string;
  objectId: string;
  unitNo: string;
  docType: DocType;
  fileName: string;
  mime: string;
  size: number;
  version: number;
  status: string;
  createdAt: Date;
  /** true — загрузил сам собственник */
  mine: boolean;
}

/** Объекты собственника, документы по которым ему видны: его юниты и все договоры по ним (включая завершённые). */
async function ownerScope(ctx: TenantContext, owner: PropertyOwner) {
  const units = await prisma.unit.findMany({ where: { tenantId: ctx.tenantId, ownerId: owner.id }, select: { id: true, unitNo: true } });
  const leases = await prisma.leaseContract.findMany({ where: { tenantId: ctx.tenantId, unitId: { in: units.map((u) => u.id) } }, select: { id: true, unitId: true } });
  const unitNo = new Map(units.map((u) => [u.id, u.unitNo]));
  const objects = new Map<string, string>(); // `${type}:${id}` → unitNo
  for (const u of units) objects.set(`unit:${u.id}`, u.unitNo);
  for (const l of leases) objects.set(`lease_contract:${l.id}`, unitNo.get(l.unitId) ?? '—');
  return { units, leases, objects };
}

export async function listOwnerDocuments(ctx: TenantContext): Promise<OwnerDocumentRow[]> {
  const owner = await ownerOf(ctx);
  const { units, leases, objects } = await ownerScope(ctx, owner);
  const docs = await prisma.document.findMany({
    where: { tenantId: ctx.tenantId, OR: [{ objectType: 'lease_contract', objectId: { in: leases.map((l) => l.id) } }, { objectType: 'unit', objectId: { in: units.map((u) => u.id) } }] },
    orderBy: [{ createdAt: 'desc' }],
  });
  return docs.map((d) => ({ id: d.id, objectType: d.objectType, objectId: d.objectId, unitNo: objects.get(`${d.objectType}:${d.objectId}`) ?? '—', docType: d.docType, fileName: d.fileName, mime: d.mime, size: d.size, version: d.version, status: d.status, createdAt: d.createdAt, mine: d.uploadedBy === ctx.userId }));
}

/** Ссылка на скачивание: только документ по своему договору/юниту, иначе 404 (BR-P33). */
export async function getOwnerDocumentUrl(ctx: TenantContext, storage: StorageAdapter, documentId: string): Promise<string> {
  const owner = await ownerOf(ctx);
  const doc = await prisma.document.findFirst({ where: whereTenant(ctx, { id: documentId }) });
  if (!doc) throw new NotFoundError();
  const { objects } = await ownerScope(ctx, owner);
  if (!objects.has(`${doc.objectType}:${doc.objectId}`)) throw new NotFoundError();
  return storage.getSignedUrl(doc.fileKey);
}

const OWNER_DOC_TYPES: readonly DocType[] = ['CONTRACT', 'ACT', 'POA', 'OTHER'];
const OWNER_DOC_MIMES = /^(application\/pdf|image\/(jpeg|png|webp)|application\/(msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document))$/;

/** Собственник загружает документ по своему юниту (правоустанавливающие, доверенность) или договору. Право document.upload не нужно — проверяется владение. */
export async function uploadOwnerDocument(ctx: TenantContext, storage: StorageAdapter, input: { objectType: 'unit' | 'lease_contract'; objectId: string; docType: DocType; fileName: string; mime: string; body: Buffer }) {
  const owner = await ownerOf(ctx);
  if (!OWNER_DOC_TYPES.includes(input.docType)) throw new ValidationError('DOC_TYPE_NOT_ALLOWED');
  if (!OWNER_DOC_MIMES.test(input.mime)) throw new ValidationError('FILE_TYPE_NOT_ALLOWED', 'FILE_TYPE_NOT_ALLOWED: PDF, JPEG, PNG, WebP, DOC/DOCX');
  const { objects } = await ownerScope(ctx, owner);
  if (!objects.has(`${input.objectType}:${input.objectId}`)) throw new NotFoundError();
  return storeDocument(ctx, storage, { objectType: input.objectType, objectId: input.objectId, docType: input.docType, fileName: input.fileName.replace(/[^\w.\-\u0400-\u04FF ]+/g, '_'), mime: input.mime, body: input.body });
}

// ── Услуги собственника (blueprint §10/§12): заказ по своему юниту, оценка ──

export async function createOwnerServiceOrder(ctx: TenantContext, input: { catalogItemId: string; unitId: string; quantity?: number; notes?: string | null; scheduledAt?: Date | null }) {
  await ownerOf(ctx);
  return createServiceOrder(ctx, { catalogItemId: input.catalogItemId, unitId: input.unitId, quantity: input.quantity ?? 1, notes: input.notes ?? null, scheduledAt: input.scheduledAt ?? null });
}

export async function rateOwnerServiceOrder(ctx: TenantContext, orderId: string, rating: number, comment?: string | null) {
  await ownerOf(ctx);
  return rateServiceOrder(ctx, orderId, rating, comment ?? null);
}

/** Заявка собственника по своему юниту → WorkOrder (source API, приоритет ≤ HIGH). Проверка владения — в createWorkOrder (BR-P33). */
export async function createOwnerRequest(ctx: TenantContext, input: { unitId: string; category: WorkOrderCategory; title: string; description?: string | null }) {
  await ownerOf(ctx);
  return createWorkOrder(ctx, { unitId: input.unitId, category: input.category, priority: 'NORMAL', title: input.title, description: input.description ?? null });
}

export async function updateOwnerConsents(ctx: TenantContext, input: { managementConsent?: boolean; listingConsent?: boolean; marketingConsent?: boolean }) {
  const owner = await ownerOf(ctx);
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const after = await tx.propertyOwner.update({
      where: { id: owner.id },
      data: {
        ...(input.managementConsent !== undefined ? { managementConsent: input.managementConsent } : {}),
        ...(input.listingConsent !== undefined ? { listingConsent: input.listingConsent } : {}),
        ...(input.marketingConsent !== undefined ? { marketingConsent: input.marketingConsent } : {}),
        consentUpdatedAt: new Date(),
      },
    });
    const pick = (o: PropertyOwner) => ({ managementConsent: o.managementConsent, listingConsent: o.listingConsent, marketingConsent: o.marketingConsent });
    return { result: after, audit: { action: 'property_owner.consents', objectType: 'property_owner', objectId: owner.id, before: pick(owner), after: { ...pick(after), byOwner: true } } };
  });
}

// ── Управление собственниками (property.manage): реестр и привязка учётки ──

export async function listOwnersAdmin(ctx: TenantContext) {
  requirePermission(ctx, 'property.manage');
  const rows = await prisma.propertyOwner.findMany({ where: whereTenant(ctx), include: { units: { select: { unitNo: true } } }, orderBy: { displayName: 'asc' } });
  const users = new Map((await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId).filter((x): x is string => !!x) } }, select: { id: true, email: true } })).map((u) => [u.id, u.email]));
  return rows.map((o) => ({ id: o.id, displayName: o.displayName, kind: o.kind, contactPhone: o.contactPhone, contactEmail: o.contactEmail, managementConsent: o.managementConsent, listingConsent: o.listingConsent, marketingConsent: o.marketingConsent, units: o.units.map((u) => u.unitNo), userEmail: o.userId ? (users.get(o.userId) ?? null) : null }));
}

/** Привязка/отвязка учётки собственника: пользователь получает роль PROPERTY_OWNER в тенанте (одна учётка — один собственник). */
export async function linkOwnerUser(ctx: TenantContext, ownerId: string, email: string | null) {
  requirePermission(ctx, 'property.manage');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const owner = await findScopedOr404(tx.propertyOwner, ctx, ownerId);
    if (!email) {
      const after = await tx.propertyOwner.update({ where: { id: ownerId }, data: { userId: null } });
      if (owner.userId) await tx.userTenantRole.deleteMany({ where: { tenantId: ctx.tenantId, userId: owner.userId, role: 'PROPERTY_OWNER' } });
      return { result: after, audit: { action: 'property_owner.unlink_user', objectType: 'property_owner', objectId: ownerId, before: { userId: owner.userId }, after: { userId: null } } };
    }
    const user = await tx.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (!user) throw new ValidationError('USER_NOT_FOUND', 'USER_NOT_FOUND: пользователь c таким email не зарегистрирован');
    const taken = await tx.propertyOwner.findFirst({ where: { tenantId: ctx.tenantId, userId: user.id, id: { not: ownerId } } });
    if (taken) throw new ValidationError('USER_ALREADY_LINKED');
    const after = await tx.propertyOwner.update({ where: { id: ownerId }, data: { userId: user.id } });
    await tx.userTenantRole.upsert({ where: { userId_tenantId_role: { userId: user.id, tenantId: ctx.tenantId, role: 'PROPERTY_OWNER' } }, create: { userId: user.id, tenantId: ctx.tenantId, role: 'PROPERTY_OWNER' }, update: {} });
    return { result: after, audit: { action: 'property_owner.link_user', objectType: 'property_owner', objectId: ownerId, before: { userId: owner.userId }, after: { userId: user.id } } };
  });
}
