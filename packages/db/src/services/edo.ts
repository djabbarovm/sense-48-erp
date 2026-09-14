/**
 * E-02: mock-панель ЭДО (docs/07 §2). Статусы Didox-документов живут в
 * edo_mock_document; смена статуса прогоняет BR-024 (applyEdoStatus) по
 * связанной СФ — так тестируются сценарии CORRECTED/CANCELLED без реального API.
 */
import type { TenantContext } from '@finance-os/core';
import { NotFoundError, requirePermission } from '@finance-os/core';
import type { EdoStatus } from '@prisma/client';
import { prisma } from '../client.js';
import { whereTenant } from '../repository.js';
import { applyEdoStatus } from './invoices.js';

/** Регистрирует/обновляет документы mock-хранилища (вызывается при импорте реестра). */
export async function syncEdoMockDocuments(
  tenantId: string,
  docs: { edoDocumentId: string; status: EdoStatus }[],
): Promise<void> {
  for (const doc of docs) {
    if (!doc.edoDocumentId) continue;
    await prisma.edoMockDocument.upsert({
      where: { tenantId_edoDocumentId: { tenantId, edoDocumentId: doc.edoDocumentId } },
      create: { tenantId, edoDocumentId: doc.edoDocumentId, status: doc.status },
      update: { status: doc.status },
    });
  }
}

export async function listEdoMockDocuments(ctx: TenantContext) {
  requirePermission(ctx, 'invoice.create');
  const docs = await prisma.edoMockDocument.findMany({ where: whereTenant(ctx), orderBy: { updatedAt: 'desc' }, take: 50 });
  const invoices = await prisma.invoice.findMany({
    where: { tenantId: ctx.tenantId, edoDocumentId: { in: docs.map((d) => d.edoDocumentId) } },
    select: { number: true, edoDocumentId: true, status: true },
  });
  const byEdoId = new Map(invoices.map((i) => [i.edoDocumentId, i]));
  return docs.map((doc) => ({ ...doc, invoice: byEdoId.get(doc.edoDocumentId) ?? null }));
}

/** Dev-панель: смена статуса документа → BR-024 по связанной СФ. */
export async function setEdoMockStatus(ctx: TenantContext, edoDocumentId: string, status: EdoStatus) {
  requirePermission(ctx, 'invoice.create');
  const doc = await prisma.edoMockDocument.findUnique({
    where: { tenantId_edoDocumentId: { tenantId: ctx.tenantId, edoDocumentId } },
  });
  if (!doc) throw new NotFoundError('EDO document not found');
  await prisma.edoMockDocument.update({ where: { id: doc.id }, data: { status } });
  const invoice = await prisma.invoice.findFirst({ where: { tenantId: ctx.tenantId, edoDocumentId } });
  if (invoice) await applyEdoStatus(ctx, invoice.id, status);
  return { edoDocumentId, status, invoiceId: invoice?.id ?? null };
}
