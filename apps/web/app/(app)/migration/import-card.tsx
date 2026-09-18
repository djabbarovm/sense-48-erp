'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Download } from 'lucide-react';
import { Badge, Button, Card, Input } from '@/components/ui';
import { importMigrationAction, type MigrationState, type MigrationType } from './actions';

export function ImportCard({ type, order }: { type: MigrationType; order: number }) {
  const t = useTranslations('migration');
  const [state, formAction, pending] = useActionState<MigrationState, FormData>(importMigrationAction, {});
  const report = state.report;
  return (
    <Card className="card-lift">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold">
          <span className="flex h-6 w-6 items-center justify-center rounded-sm bg-ink-900 font-mono text-xs text-volt-500">{order}</span>
          {t(`type.${type}`)}
        </h2>
        {type !== 'floorplan' ? (
          <a href={`/templates/${type}.xlsx`} download className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
            <Download className="h-3.5 w-3.5" /> {t('template')}
          </a>
        ) : null}
      </div>
      <p className="mb-3 text-xs text-gray-500">{t(`hint.${type}`)}</p>
      <form action={formAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="type" value={type} />
        {type === 'floorplan' ? (
          <>
            <Input name="buildingCode" placeholder={t('buildingCode')} aria-label={t('buildingCode')} className="w-32" />
            <Input name="floorNo" type="number" placeholder={t('floorNo')} aria-label={t('floorNo')} className="w-24" />
          </>
        ) : null}
        <Input type="file" name="file" accept={type === 'floorplan' ? '.json,.svg' : '.xlsx'} required className="w-auto flex-1" />
        <Button type="submit" disabled={pending} size="sm">
          {pending ? t('importing') : t('importBtn')}
        </Button>
      </form>
      {state.error ? <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{state.error}</p> : null}
      {state.floorPlan ? (
        <div className="animate-rise mt-3 text-sm">
          {state.floorPlan.errors.length === 0 ? (
            <p><Badge tone="green">OK</Badge> {t('floorPlanResult', { updated: state.floorPlan.updated, version: state.floorPlan.geometryVersion })}</p>
          ) : (
            <div>
              <p className="mb-1"><Badge tone="red">{t('rejected')}</Badge> {t('errorsCount', { count: state.floorPlan.errors.length })}</p>
              <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs text-red-700">{state.floorPlan.errors.map((e, i) => (<li key={i}><span className="font-mono font-semibold">{e.unitNo}</span>: {e.message}</li>))}</ul>
            </div>
          )}
          {state.floorPlan.warnings.length ? <ul className="mt-1 text-xs text-amber-700">{state.floorPlan.warnings.map((w, i) => (<li key={i}>{w}</li>))}</ul> : null}
        </div>
      ) : null}
      {report ? (
        <div className="animate-rise mt-3 text-sm">
          {report.errors.length === 0 ? (
            <p>
              <Badge tone="green">OK</Badge>{' '}
              {t('result', { imported: report.imported, skipped: report.skipped, total: report.total })}
            </p>
          ) : (
            <div>
              <p className="mb-1">
                <Badge tone="red">{t('rejected')}</Badge> {t('errorsCount', { count: report.errors.length })}
              </p>
              <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs text-red-700">
                {report.errors.slice(0, 20).map((e, i) => (
                  <li key={i}>
                    {t('row')} {e.row}, <span className="font-mono font-semibold">{e.field}</span>: {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : null}
    </Card>
  );
}
