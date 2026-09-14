/**
 * B-09: Document + DocumentRequirement (docs/02 §7, BR-023, D-04).
 * Файл — в S3 (adapter), метаданные + sha256 + версия — в БД.
 */
import { createHash } from 'node:crypto';
import type { TenantContext } from '@finance-os/core';
import { ValidationError, requirePermission } from '@finance-os/core';
import type { StorageAdapter } from '@finance-os/adapters';
import type { CategoryGroup, DocPhase, DocType, PaymentKind } from '@prisma/client';
import { withAudit } from '../audit.js';
import { prisma } from '../client.js';
import { findScopedOr404, whereTenant } from '../repository.js';

const MAX_FILE_SIZE = 25 * 1024 * 1024; // docs/11: 25 МБ

export interface UploadInput {
  objectType: string;
  objectId: string;
  docType: DocType;
  fileName: string;
  mime: string;
  body: Buffer;
  isRequired?: boolean;
}

export async function uploadDocument(ctx: TenantContext, storage: StorageAdapter, input: UploadInput) {
  requirePermission(ctx, 'document.upload');
  if (input.body.length === 0) throw new ValidationError('FILE_EMPTY');
  if (input.body.length > MAX_FILE_SIZE) throw new ValidationError('FILE_TOO_LARGE', 'Максимум 25 МБ');
  const sha256 = createHash('sha256').update(input.body).digest('hex');

  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const prevVersion = await tx.document.findFirst({
      where: {
        tenantId: ctx.tenantId,
        objectType: input.objectType,
        objectId: input.objectId,
        docType: input.docType,
        fileName: input.fileName,
      },
      orderBy: { version: 'desc' },
    });
    const version = (prevVersion?.version ?? 0) + 1;
    const fileKey = `${ctx.tenantId}/${input.objectType}/${input.objectId}/${input.docType}/${version}-${input.fileName}`;
    await storage.put(fileKey, input.body, input.mime);
    const created = await tx.document.create({
      data: {
        tenantId: ctx.tenantId,
        objectType: input.objectType,
        objectId: input.objectId,
        docType: input.docType,
        fileKey,
        fileName: input.fileName,
        mime: input.mime,
        size: input.body.length,
        sha256,
        version,
        uploadedBy: ctx.userId,
        isRequired: input.isRequired ?? false,
        status: 'PENDING',
      },
    });
    return {
      result: created,
      audit: {
        action: 'document.upload',
        objectType: 'document',
        objectId: created.id,
        after: { docType: input.docType, fileName: input.fileName, sha256, version, target: `${input.objectType}:${input.objectId}` },
      },
    };
  });
}

/** document.mark_received: документ проверен и принят (участвует в BR-023). */
export async function markDocumentReceived(ctx: TenantContext, documentId: string) {
  requirePermission(ctx, 'document.mark_received');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const doc = await findScopedOr404(tx.document, ctx, documentId);
    if (doc.status === 'RECEIVED') throw new ValidationError('ALREADY_RECEIVED');
    const after = await tx.document.update({
      where: { id: documentId },
      data: { status: 'RECEIVED' },
    });
    return {
      result: after,
      audit: {
        action: 'document.mark_received',
        objectType: 'document',
        objectId: documentId,
        before: { status: doc.status },
        after: { status: 'RECEIVED' },
      },
    };
  });
}

export async function rejectDocument(ctx: TenantContext, documentId: string, reason: string) {
  requirePermission(ctx, 'document.mark_received');
  if (!reason.trim()) throw new ValidationError('REASON_REQUIRED');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const doc = await findScopedOr404(tx.document, ctx, documentId);
    const after = await tx.document.update({ where: { id: documentId }, data: { status: 'REJECTED' } });
    return {
      result: after,
      audit: {
        action: 'document.reject',
        objectType: 'document',
        objectId: documentId,
        before: { status: doc.status },
        after: { status: 'REJECTED', reason },
      },
    };
  });
}

export async function listDocumentsFor(ctx: TenantContext, objectType: string, objectId: string) {
  return prisma.document.findMany({
    where: whereTenant(ctx, { objectType, objectId }),
    orderBy: [{ docType: 'asc' }, { version: 'desc' }],
  });
}

export async function getDocumentUrl(ctx: TenantContext, storage: StorageAdapter, documentId: string) {
  const doc = await findScopedOr404(prisma.document, ctx, documentId);
  return storage.getSignedUrl(doc.fileKey);
}

// ── DocumentRequirement (BR-023) ──

export async function upsertRequirement(
  ctx: TenantContext,
  input: { categoryGroup: CategoryGroup; paymentType: PaymentKind; phase: DocPhase; docTypes: DocType[] },
) {
  requirePermission(ctx, 'tenant.settings');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const row = await tx.documentRequirement.upsert({
      where: {
        tenantId_categoryGroup_paymentType_phase: {
          tenantId: ctx.tenantId,
          categoryGroup: input.categoryGroup,
          paymentType: input.paymentType,
          phase: input.phase,
        },
      },
      create: { tenantId: ctx.tenantId, ...input },
      update: { docTypes: input.docTypes },
    });
    return {
      result: row,
      audit: {
        action: 'document_requirement.upsert',
        objectType: 'document_requirement',
        objectId: row.id,
        after: { ...input },
      },
    };
  });
}

export interface MissingDoc {
  docType: DocType;
  control: string; // MISSING_DOC:<type>
}

/**
 * BR-023: какие обязательные документы фазы отсутствуют (нет Document со status
 * RECEIVED нужного типа) для объекта. Используется run_controls() в Phase C.
 */
export async function checkRequiredDocs(
  ctx: TenantContext,
  input: {
    categoryGroup: CategoryGroup;
    paymentType: PaymentKind;
    phase: DocPhase;
    objectType: string;
    objectId: string;
    /** дополнительные объекты, чьи документы тоже засчитываются (invoice, PR) */
    alsoObjects?: { objectType: string; objectId: string }[];
  },
): Promise<MissingDoc[]> {
  const requirement = await prisma.documentRequirement.findUnique({
    where: {
      tenantId_categoryGroup_paymentType_phase: {
        tenantId: ctx.tenantId,
        categoryGroup: input.categoryGroup,
        paymentType: input.paymentType,
        phase: input.phase,
      },
    },
  });
  if (!requirement || requirement.docTypes.length === 0) return [];
  const targets = [{ objectType: input.objectType, objectId: input.objectId }, ...(input.alsoObjects ?? [])];
  const received = await prisma.document.findMany({
    where: {
      tenantId: ctx.tenantId,
      status: 'RECEIVED',
      OR: targets.map((t) => ({ objectType: t.objectType, objectId: t.objectId })),
    },
    select: { docType: true },
  });
  const have = new Set(received.map((d) => d.docType));
  return requirement.docTypes
    .filter((dt) => !have.has(dt))
    .map((docType) => ({ docType, control: `MISSING_DOC:${docType}` }));
}

/** Дефолтные требования (blueprint §10.2) — вызывается из seed. */
export async function seedDefaultRequirements(tenantId: string): Promise<number> {
  const defaults: { categoryGroup: CategoryGroup; paymentType: PaymentKind; phase: DocPhase; docTypes: DocType[] }[] = [
    // Товары postpay: до оплаты — счёт и накладная; после — СФ
    { categoryGroup: 'FNB', paymentType: 'POSTPAY', phase: 'BEFORE_PAYMENT', docTypes: ['INVOICE', 'WAYBILL'] },
    { categoryGroup: 'FNB', paymentType: 'POSTPAY', phase: 'AFTER_PAYMENT', docTypes: ['SF'] },
    { categoryGroup: 'FNB', paymentType: 'PREPAY', phase: 'BEFORE_PAYMENT', docTypes: ['INVOICE'] },
    { categoryGroup: 'FNB', paymentType: 'PREPAY', phase: 'AFTER_PAYMENT', docTypes: ['SF', 'WAYBILL'] },
    // Услуги postpay: до оплаты — счёт и акт
    { categoryGroup: 'MARKETING', paymentType: 'POSTPAY', phase: 'BEFORE_PAYMENT', docTypes: ['INVOICE', 'ACT'] },
    { categoryGroup: 'MARKETING', paymentType: 'PREPAY', phase: 'AFTER_PAYMENT', docTypes: ['ACT', 'SF'] },
    { categoryGroup: 'CLEANING', paymentType: 'POSTPAY', phase: 'BEFORE_PAYMENT', docTypes: ['INVOICE', 'ACT'] },
    { categoryGroup: 'RENT', paymentType: 'POSTPAY', phase: 'BEFORE_PAYMENT', docTypes: ['INVOICE', 'CONTRACT'] },
    { categoryGroup: 'CAPEX', paymentType: 'PREPAY', phase: 'BEFORE_PAYMENT', docTypes: ['INVOICE', 'CONTRACT', 'KP'] },
  ];
  let count = 0;
  for (const d of defaults) {
    await prisma.documentRequirement.upsert({
      where: {
        tenantId_categoryGroup_paymentType_phase: {
          tenantId,
          categoryGroup: d.categoryGroup,
          paymentType: d.paymentType,
          phase: d.phase,
        },
      },
      create: { tenantId, ...d },
      update: { docTypes: d.docTypes },
    });
    count++;
  }
  return count;
}
