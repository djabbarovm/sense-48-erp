'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Badge, Button, Card, Input } from '@/components/ui';
import { importPostedAction, type PostedState } from './actions';

export function PostedForm() {
  const t = useTranslations('onec');
  const [state, formAction, pending] = useActionState<PostedState, FormData>(importPostedAction, {});
  return (
    <Card title={t('postedTitle')}>
      <p className="mb-2 text-xs text-gray-500">{t('postedHint')}</p>
      <form action={formAction} className="flex flex-wrap items-center gap-2">
        <Input type="file" name="file" accept=".csv,.txt" required className="w-auto flex-1" />
        <Button type="submit" disabled={pending}>
          {pending ? t('importing') : t('importBtn')}
        </Button>
      </form>
      {state.error ? <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p> : null}
      {state.report ? (
        <div className="animate-rise mt-3 text-sm">
          <p>
            <Badge tone="green">OK</Badge> {t('postedResult', { closed: state.report.closed, skipped: state.report.skipped })}
          </p>
          {state.report.errors.slice(0, 10).map((e, i) => (
            <p key={i} className="text-xs text-red-700">
              #{e.row}: {e.message}
            </p>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
