import { exportPostingsCsv } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';

/** E-04: экспорт проводок периода для загрузки в 1С. */
export async function POST(request: Request) {
  const ctx = await requireTenantContext();
  const form = await request.formData();
  const period = String(form.get('period') ?? '');
  const csv = await exportPostingsCsv(ctx, period);
  return new Response(new Uint8Array(csv), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="postings-${period}.csv"`,
    },
  });
}
