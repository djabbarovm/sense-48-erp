import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { CheckCircle2, Download, XCircle } from 'lucide-react';
import { can } from '@finance-os/core';
import { getCloseChecklist } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Button, Card, Input, PageHeader, StatCard } from '@/components/ui';

export default async function ClosePage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'close.run')) notFound();
  const t = await getTranslations('close');
  const { period: raw } = await searchParams;
  const period = raw && /^\d{4}-\d{2}$/.test(raw) ? raw : new Date().toISOString().slice(0, 7);

  const checklist = await getCloseChecklist(ctx, period);
  const done = checklist.filter((row) => row.ok).length;
  const progress = Math.round((done / checklist.length) * 100);

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('title', { period })}
        actions={
          <form className="flex items-center gap-2">
            <Input name="period" type="month" defaultValue={period} className="w-auto" />
            <Button type="submit" variant="outline" size="sm">
              OK
            </Button>
          </form>
        }
      />

      <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label={t('progress')} value={`${progress}%`} tone={progress === 100 ? 'success' : 'warning'} />
        <StatCard label={t('done')} value={`${done} / ${checklist.length}`} />
        <Card className="flex items-center justify-center">
          <form method="post" action={`/close/pack?period=${period}`}>
            <Button type="submit" variant="dark">
              <Download className="h-4 w-4" /> {t('pack')}
            </Button>
          </form>
        </Card>
      </div>

      <Card className="card-lift">
        <ul className="stagger space-y-2">
          {checklist.map((row) => (
            <li key={row.key} className={`flex items-center gap-3 rounded-md border px-3 py-2.5 ${row.ok ? 'border-gray-100 bg-gray-50/50' : 'border-red-100 bg-red-50/50'}`}>
              {row.ok ? (
                <CheckCircle2 className="h-5 w-5 shrink-0 text-volt-600" />
              ) : (
                <XCircle className="h-5 w-5 shrink-0 text-red-500" />
              )}
              <span className="flex-1 text-sm font-medium">{t(`item.${row.key}`)}</span>
              {!row.ok ? <Badge tone="red">{row.count}</Badge> : null}
              <Link href={row.href} className="text-sm text-brand-700 hover:underline">
                {t('open')}
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-gray-400">{t('hint')}</p>
      </Card>
    </div>
  );
}
