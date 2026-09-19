/** Wave 2: outbox доменных событий (docs/20 §11.3). Payload без PII — только номера/статусы/id. */
import type { Prisma } from '@prisma/client';
import type { NotificationAdapter } from '@finance-os/adapters';
import { prisma } from '../client.js';

export type DomainEventType = 'unit.status.changed' | 'lease.activated' | 'lease.expiring' | 'lease.terminated' | 'deal.stage.changed' | 'work_order.created' | 'work_order.status.changed' | 'work_order.overdue' | 'service_order.created' | 'service_order.status.changed' | 'service_order.overdue' | 'rent.overdue' | 'rent.paid' | 'commission.accrued' | 'commission.paid' | 'mall.mandate.changed' | 'house.charge.overdue'
  | 'owner.stage.changed'
  | 'owner.followup.overdue';

export async function emitDomainEvent(
  tx: Prisma.TransactionClient,
  tenantId: string,
  type: DomainEventType,
  objectType: string,
  objectId: string,
  payload: Record<string, string | number | boolean | null>,
): Promise<void> {
  await tx.domainEvent.create({ data: { tenantId, type, objectType, objectId, payload } });
}

export async function listPendingEvents(tenantId: string, limit = 100) {
  return prisma.domainEvent.findMany({ where: { tenantId, deliveredAt: null }, orderBy: { createdAt: 'asc' }, take: limit });
}

/** Джоб domain-events: доставляет уведомления OWNER/COMMERCIAL_MANAGER и помечает deliveredAt. Идемпотентен. */
export async function deliverDomainEvents(tenantId: string, now = new Date(), notifier?: NotificationAdapter): Promise<number> {
  const events = await listPendingEvents(tenantId);
  if (events.length === 0) return 0;
  const recipients = notifier
    ? await prisma.userTenantRole.findMany({ where: { tenantId, role: { in: ['OWNER', 'COMMERCIAL_MANAGER'] } }, select: { userId: true }, distinct: ['userId'] })
    : [];
  let delivered = 0;
  for (const e of events) {
    const p = e.payload as Record<string, string | number>;
    if (notifier) {
      for (const r of recipients) {
        await notifier.send({
          userId: r.userId,
          template: 'PROPERTY_EVENT',
          params: { event: e.type, object: String(p.unitNo ?? p.number ?? e.objectId), detail: String(p.detail ?? '') },
          deepLink: typeof p.deepLink === 'string' ? p.deepLink : '/property',
        });
      }
    }
    await prisma.domainEvent.update({ where: { id: e.id }, data: { deliveredAt: now, attempts: { increment: 1 } } });
    delivered++;
  }
  return delivered;
}

/** P-13 realtime: события тенанта после курсора (для SSE-потока). Payload без PII по построению. */
export async function listDomainEventsSince(tenantId: string, since: Date, types?: string[], limit = 200) {
  return prisma.domainEvent.findMany({
    where: { tenantId, createdAt: { gt: since }, ...(types?.length ? { type: { in: types } } : {}) },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true, type: true, objectType: true, objectId: true, payload: true, createdAt: true },
  });
}
