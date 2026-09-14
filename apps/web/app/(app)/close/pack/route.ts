import { buildMonthEndPackXlsx } from '@finance-os/adapters';
import { getMonthEndPackData } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';

/** F-03: month-end pack (XLSX). */
export async function POST(request: Request) {
  const ctx = await requireTenantContext();
  const period = new URL(request.url).searchParams.get('period') ?? new Date().toISOString().slice(0, 7);
  const data = await getMonthEndPackData(ctx, period);
  const xlsx = buildMonthEndPackXlsx(data);
  return new Response(new Uint8Array(xlsx), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="month-end-${period}.xlsx"`,
    },
  });
}
