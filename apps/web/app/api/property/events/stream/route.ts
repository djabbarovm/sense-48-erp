import { can } from '@finance-os/core';
import { listDomainEventsSince } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';

/**
 * P-13 (blueprint §1.11/§1.13): Server-Sent Events по DomainEvent тенанта — Building/Floor/Unit перерисовываются ≤ 5 с.
 * Auth — cookie-сессия (как у страниц); tenant — из контекста. Опрос outbox каждые 2 с; без Redis (ADR-018: realtime позже через pub/sub).
 */
export const dynamic = 'force-dynamic';

const POLL_MS = 2000;
const HEARTBEAT_MS = 25_000;
const MAX_LIFETIME_MS = 10 * 60_000; // клиент переподключается сам

export async function GET(request: Request): Promise<Response> {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'property.view')) return new Response('forbidden', { status: 403 });
  const encoder = new TextEncoder();
  let since = new Date();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      send('hello', { tenant: ctx.tenantSlug, at: since.toISOString() });
      const startedAt = Date.now();
      const poll = setInterval(async () => {
        if (closed) return;
        try {
          const events = await listDomainEventsSince(ctx.tenantId, since);
          for (const e of events) {
            send(e.type, { id: e.id, objectType: e.objectType, objectId: e.objectId, payload: e.payload, at: e.createdAt.toISOString() });
            since = e.createdAt;
          }
          if (Date.now() - startedAt > MAX_LIFETIME_MS) { send('bye', { reason: 'lifetime' }); cleanup(); controller.close(); }
        } catch {
          cleanup();
          controller.close();
        }
      }, POLL_MS);
      const heartbeat = setInterval(() => { if (!closed) controller.enqueue(encoder.encode(': ping\n\n')); }, HEARTBEAT_MS);
      const cleanup = () => { closed = true; clearInterval(poll); clearInterval(heartbeat); };
      request.signal.addEventListener('abort', () => { cleanup(); try { controller.close(); } catch { /* уже закрыт */ } });
    },
    cancel() { closed = true; },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } });
}
