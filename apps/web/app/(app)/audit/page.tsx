import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { can } from '@finance-os/core';
import { listAuditLog, listAuditObjectTypes } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Button, EmptyState, Input, PageHeader, Select } from '@/components/ui';

function DiffView({ before, after }: { before: unknown; after: unknown }) {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  if (keys.length === 0) return <span className="text-gray-400">—</span>;
  return (
    <table className="w-full text-xs">
      <tbody>
        {keys.map((key) => {
          const beforeVal = b[key] === undefined ? null : JSON.stringify(b[key]);
          const afterVal = a[key] === undefined ? null : JSON.stringify(a[key]);
          const changed = beforeVal !== afterVal;
          return (
            <tr key={key} className={changed ? 'bg-amber-50/70' : undefined}>
              <td className="w-40 py-0.5 pr-2 align-top font-mono font-semibold">{key}</td>
              <td className="py-0.5 pr-2 align-top text-red-700">{beforeVal ?? '·'}</td>
              <td className="py-0.5 align-top text-volt-700">{afterVal ?? '·'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ objectType?: string; objectId?: string; action?: string }>;
}) {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'audit.view')) notFound();
  const t = await getTranslations('audit');
  const params = await searchParams;

  const [records, objectTypes] = await Promise.all([
    listAuditLog(ctx, {
      ...(params.objectType ? { objectType: params.objectType } : {}),
      ...(params.objectId ? { objectId: params.objectId } : {}),
      ...(params.action ? { action: params.action } : {}),
      take: 100,
    }),
    listAuditObjectTypes(ctx),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader title={t('title')} />
      <form className="flex flex-wrap items-center gap-2">
        <Select name="objectType" defaultValue={params.objectType ?? ''} className="w-auto">
          <option value="">{t('allTypes')}</option>
          {objectTypes.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </Select>
        <Input name="action" placeholder={t('actionFilter')} defaultValue={params.action ?? ''} className="w-48" />
        <Input name="objectId" placeholder={t('objectIdFilter')} defaultValue={params.objectId ?? ''} className="w-72 font-mono text-xs" />
        <Button type="submit" variant="outline">
          {t('filter')}
        </Button>
      </form>

      <ul className="space-y-2">
        {records.map((record) => (
          <li key={record.id} className="rounded-xl border border-gray-200/80 bg-white p-3 shadow-card">
            <details>
              <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                <span className="tnum text-xs text-gray-400">#{String(record.seq)}</span>
                <Badge tone="blue">{record.action}</Badge>
                <span className="font-mono text-xs text-gray-500">
                  {record.objectType}/{record.objectId.slice(0, 8)}…
                </span>
                <span className="flex-1" />
                <span className="text-xs">{record.actorName ?? t('system')}</span>
                <span className="tnum text-xs text-gray-400">{record.at.toISOString().slice(0, 19).replace('T', ' ')}</span>
              </summary>
              <div className="mt-2 border-t border-gray-100 pt-2">
                <DiffView before={record.before} after={record.after} />
                <p className="mt-1.5 font-mono text-[10px] text-gray-300">hash {record.diffHash.slice(0, 16)}… ← {record.prevHash.slice(0, 16)}…</p>
              </div>
            </details>
          </li>
        ))}
      </ul>
      {records.length === 0 ? <EmptyState text={t('empty')} /> : null}
    </div>
  );
}
