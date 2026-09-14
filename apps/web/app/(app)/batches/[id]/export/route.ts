import { createStorageFromEnv } from '@finance-os/adapters';
import { exportBatch } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';

/** BR-057: экспорт batch CSV — единственное место с полными реквизитами. POST, т.к. меняет статус. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireTenantContext();
  const { id } = await params;
  const { batch, csv, sha256 } = await exportBatch(ctx, id, createStorageFromEnv());
  return new Response(new Uint8Array(csv), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${batch.number}.csv"`,
      'X-Content-Sha256': sha256,
    },
  });
}
