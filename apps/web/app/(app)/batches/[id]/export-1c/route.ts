import { exportBatchClientBank } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';

/** Платёжки батча в 1CClientBankExchange (для Клиент-Банка / 1С). */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireTenantContext();
  const { id } = await params;
  const { file, fileName } = await exportBatchClientBank(ctx, id);
  return new Response(new Uint8Array(file), {
    headers: {
      'Content-Type': 'text/plain; charset=windows-1251',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    },
  });
}
