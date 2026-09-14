/**
 * E-01: Document Health — красные зоны (docs/06 §14 / blueprint §10.3).
 * Каждая зона — список объектов c owner и открытой задачей (если есть).
 */
import type { TenantContext } from '@finance-os/core';
import { requirePermission } from '@finance-os/core';
import { prisma } from '../client.js';
import { whereTenant } from '../repository.js';

export const HEALTH_ZONES = [
  'PAID_WITHOUT_SF',
  'PAID_WITHOUT_ACT_SLA',
  'EXPIRED_CONTRACTS',
  'UNMATCHED_INVOICES',
  'MISSING_POA',
  'UNSIGNED_AMENDMENTS',
  'ADVANCES_OVERDUE',
  'TERMINATION_NOT_CLOSED',
  'VENDOR_BANK_CHANGED',
] as const;
export type HealthZone = (typeof HEALTH_ZONES)[number];

export interface HealthItem {
  objectType: string;
  objectId: string;
  label: string; // номер/имя объекта
  detail: string; // что не так, по-русски
  ownerName: string | null;
  openTaskId: string | null;
}

export type DocumentHealth = Record<HealthZone, HealthItem[]>;

const PAID_STATUSES = ['PAID', 'RECONCILED', 'CLOSED'] as const;

export async function getDocumentHealth(ctx: TenantContext, now = new Date()): Promise<DocumentHealth> {
  requirePermission(ctx, 'payment.view');

  const [paidPayments, documents, contracts, invoices, amendments, advances, vendors, prs, openTasks, users, categories] =
    await Promise.all([
      prisma.paymentRequest.findMany({ where: whereTenant(ctx, { status: { in: [...PAID_STATUSES] } }) }),
      prisma.document.findMany({ where: whereTenant(ctx, { status: { not: 'REJECTED' as const } }), select: { objectType: true, objectId: true, docType: true } }),
      prisma.contract.findMany({ where: whereTenant(ctx) }),
      prisma.invoice.findMany({ where: whereTenant(ctx, { matchStatus: 'UNMATCHED' as const, status: 'RECEIVED' as const }) }),
      prisma.contractAmendment.findMany({ where: whereTenant(ctx, { status: { not: 'SIGNED' as const } }) }),
      prisma.advance.findMany({ where: whereTenant(ctx, { status: { in: ['OPEN' as const, 'PARTIALLY_CLOSED' as const, 'OVERDUE' as const] } }) }),
      prisma.vendor.findMany({ where: whereTenant(ctx) }),
      prisma.purchaseRequest.findMany({ where: whereTenant(ctx, { status: { in: ['RECEIVED' as const, 'INVOICED' as const] } }) }),
      prisma.task.findMany({
        where: whereTenant(ctx, { status: { in: ['OPEN' as const, 'IN_PROGRESS' as const, 'OVERDUE' as const] } }),
        select: { id: true, objectType: true, objectId: true, ownerId: true },
      }),
      prisma.user.findMany({ select: { id: true, fullName: true } }),
      prisma.category.findMany({ where: whereTenant(ctx), select: { id: true, closingDocSlaDays: true } }),
    ]);

  const userName = new Map(users.map((u) => [u.id, u.fullName]));
  const vendorName = new Map(vendors.map((v) => [v.id, v.displayName]));
  const slaByCat = new Map(categories.map((c) => [c.id, c.closingDocSlaDays]));
  const docsByObject = new Map<string, Set<string>>();
  for (const doc of documents) {
    const key = `${doc.objectType}:${doc.objectId}`;
    if (!docsByObject.has(key)) docsByObject.set(key, new Set());
    docsByObject.get(key)!.add(doc.docType);
  }
  const hasDoc = (objectType: string, objectId: string, docType: string) =>
    docsByObject.get(`${objectType}:${objectId}`)?.has(docType) ?? false;
  const taskFor = (objectType: string, objectId: string) =>
    openTasks.find((task) => task.objectType === objectType && task.objectId === objectId);
  const item = (objectType: string, objectId: string, label: string, detail: string, ownerId?: string | null): HealthItem => {
    const task = taskFor(objectType, objectId);
    return {
      objectType,
      objectId,
      label,
      detail,
      ownerName: ownerId ? (userName.get(ownerId) ?? null) : task?.ownerId ? (userName.get(task.ownerId) ?? null) : null,
      openTaskId: task?.id ?? null,
    };
  };

  const health: DocumentHealth = {
    PAID_WITHOUT_SF: [],
    PAID_WITHOUT_ACT_SLA: [],
    EXPIRED_CONTRACTS: [],
    UNMATCHED_INVOICES: [],
    MISSING_POA: [],
    UNSIGNED_AMENDMENTS: [],
    ADVANCES_OVERDUE: [],
    TERMINATION_NOT_CLOSED: [],
    VENDOR_BANK_CHANGED: [],
  };

  // 1–2. Оплаченные платежи без СФ / без акта дольше SLA
  for (const payment of paidPayments) {
    if (!payment.vendorId) continue; // налоги/комиссии — СФ не предполагается
    const objects: [string, string][] = [
      ['payment_request', payment.id],
      [payment.sourceType === 'INVOICE' ? 'invoice' : payment.sourceType === 'PR' ? 'purchase_request' : 'contract', payment.sourceId],
    ];
    const anySf = payment.sourceType === 'INVOICE' || objects.some(([type, id]) => hasDoc(type, id, 'SF'));
    const vendor = vendorName.get(payment.vendorId) ?? '—';
    if (!anySf) {
      health.PAID_WITHOUT_SF.push(item('payment_request', payment.id, payment.number, `Оплачен, СФ не получен (${vendor})`, payment.preparedBy));
    }
    const anyAct = objects.some(([type, id]) => hasDoc(type, id, 'ACT'));
    if (!anyAct && payment.paidAt && !payment.isPrepayment) {
      const sla = payment.categoryId ? (slaByCat.get(payment.categoryId) ?? 10) : 10;
      const deadline = new Date(payment.paidAt.getTime() + sla * 86400_000);
      if (now > deadline) {
        health.PAID_WITHOUT_ACT_SLA.push(
          item('payment_request', payment.id, payment.number, `Акта нет ${Math.floor((now.getTime() - payment.paidAt.getTime()) / 86400_000)} дн. после оплаты (SLA ${sla}) — ${vendor}`, payment.preparedBy),
        );
      }
    }
  }

  // 3. Истёкшие договоры (и активные c прошедшим end_date)
  for (const contract of contracts) {
    const expired = contract.status === 'EXPIRED' || (contract.endDate && contract.endDate < now && ['ACTIVE', 'EXPIRING'].includes(contract.status));
    if (expired) {
      health.EXPIRED_CONTRACTS.push(
        item('contract', contract.id, contract.number, `Истёк ${contract.endDate?.toISOString().slice(0, 10) ?? ''} — ${contract.vendorId ? (vendorName.get(contract.vendorId) ?? '') : ''}`),
      );
    }
    if (contract.status === 'TERMINATING') {
      health.TERMINATION_NOT_CLOSED.push(item('contract', contract.id, contract.number, 'Расторжение начато, но не закрыто (сверка/остатки)'));
    }
  }

  // 4. Несопоставленные счета
  for (const invoice of invoices) {
    health.UNMATCHED_INVOICES.push(
      item('invoice', invoice.id, `СФ ${invoice.number}`, `Не сопоставлен c заявкой/договором — ${vendorName.get(invoice.vendorId) ?? ''}`),
    );
  }

  // 5. Приёмка без доверенности (POA)
  for (const pr of prs) {
    if (!hasDoc('purchase_request', pr.id, 'POA')) {
      health.MISSING_POA.push(item('purchase_request', pr.id, pr.number, `Приёмка без доверенности — ${pr.what}`, pr.requesterId));
    }
  }

  // 6. Неподписанные допсоглашения
  const contractNumber = new Map(contracts.map((c) => [c.id, c.number]));
  for (const amendment of amendments) {
    health.UNSIGNED_AMENDMENTS.push(
      item('contract', amendment.contractId, `${contractNumber.get(amendment.contractId) ?? ''} / ДС ${amendment.number}`, `Допсоглашение в статусе ${amendment.status}`),
    );
  }

  // 7. Просроченные подотчёты/предоплаты
  for (const advance of advances) {
    if (advance.status === 'OVERDUE' || (advance.dueDocsDate && advance.dueDocsDate < now)) {
      const who = advance.vendorId ? (vendorName.get(advance.vendorId) ?? '') : 'сотрудник';
      health.ADVANCES_OVERDUE.push(
        item('advance', advance.id, advance.purpose || advance.id.slice(0, 8), `Закрывающие документы просрочены (${who}, срок ${advance.dueDocsDate?.toISOString().slice(0, 10) ?? '—'})`, advance.createdBy),
      );
    }
  }

  // 8. (TERMINATION_NOT_CLOSED — собрано выше вместе c договорами)

  // 9. Смена банковских реквизитов vendor
  for (const vendor of vendors) {
    if (vendor.riskFlags.includes('BANK_CHANGED_RECENTLY')) {
      health.VENDOR_BANK_CHANGED.push(
        item('vendor', vendor.id, vendor.displayName, 'Реквизиты изменены — платежи на новый счёт заблокированы до верификации (BR-030)'),
      );
    }
  }

  return health;
}
