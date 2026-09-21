import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { can } from '@finance-os/core';
import { hasAmoLongToken } from '@finance-os/adapters';
import { summarizeExternalRefs } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Card, PageHeader, Table, Td, Th } from '@/components/ui';

/**
 * Админ-экран «Интеграции → amoCRM» (READ-ONLY статус). Секреты не показываем:
 * только факт наличия токена в ENV сервера + поддомен. Импортированные ссылки —
 * из ExternalReference. Сам dry-run/импорт запускается серверно (GitHub Actions).
 */
export default async function IntegrationsPage() {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'tenant.settings')) notFound();
  const t = await getTranslations('integrations');

  const configured = hasAmoLongToken();
  const subdomain = process.env.AMOCRM_SUBDOMAIN?.trim() ?? null;
  const summary = await summarizeExternalRefs(ctx, 'AMOCRM');
  const fmt = (d: Date | null) => (d ? d.toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' }) : '—');

  return (
    <div className="space-y-5">
      <PageHeader title={t('title')} />
      <p className="-mt-3 max-w-3xl text-sm text-gray-500">{t('intro')}</p>

      <Card>
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-medium">amoCRM</h2>
          {configured
            ? <Badge tone="green" dot>{t('connected')}</Badge>
            : <Badge tone="gray">{t('notConfigured')}</Badge>}
        </div>
        <dl className="mt-3 grid max-w-xl grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <dt className="text-gray-500">{t('mode')}</dt><dd>{t('readonly')}</dd>
          <dt className="text-gray-500">{t('subdomain')}</dt><dd className="font-mono">{subdomain ?? '—'}</dd>
          <dt className="text-gray-500">{t('tokenStatus')}</dt>
          <dd>{configured ? t('tokenPresent') : t('tokenMissing')}</dd>
          <dt className="text-gray-500">{t('lastSync')}</dt><dd>{fmt(summary.lastSyncedAt)}</dd>
        </dl>
        {!configured
          ? <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">{t('setupHint')}</p>
          : null}
      </Card>

      <Card>
        <h2 className="mb-1 font-medium">{t('importedTitle')}</h2>
        <p className="mb-3 text-sm text-gray-600">{t('importedIntro', { total: summary.total })}</p>
        {summary.total === 0
          ? <p className="text-sm text-gray-400">{t('importedEmpty')}</p>
          : (
            <div className="grid gap-4 md:grid-cols-2">
              <Table>
                <thead><tr><Th>{t('entity')}</Th><Th>{t('count')}</Th></tr></thead>
                <tbody>
                  {summary.byEntity.map((r) => (
                    <tr key={r.entityType}><Td>{r.entityType}</Td><Td className="tabular-nums">{r.count}</Td></tr>
                  ))}
                </tbody>
              </Table>
              <Table>
                <thead><tr><Th>{t('status')}</Th><Th>{t('count')}</Th></tr></thead>
                <tbody>
                  {summary.byStatus.map((r) => (
                    <tr key={r.status}><Td><Badge tone={r.status === 'CONFLICT' || r.status === 'NEEDS_REVIEW' ? 'yellow' : 'blue'}>{r.status}</Badge></Td><Td className="tabular-nums">{r.count}</Td></tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
      </Card>

      <Card>
        <h2 className="mb-1 font-medium">{t('dryRunTitle')}</h2>
        <p className="text-sm text-gray-600">{t('dryRunIntro')}</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-gray-600">
          <li>{t('dryRunStep1')}</li>
          <li>{t('dryRunStep2')}</li>
          <li>{t('dryRunStep3')}</li>
        </ol>
      </Card>
    </div>
  );
}
