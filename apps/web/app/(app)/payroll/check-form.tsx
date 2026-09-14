'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Badge, Button, Input } from '@/components/ui';
import { checkPayrollAction, type CheckState } from './actions';

export function PayrollCheckForm({ runId }: { runId: string }) {
  const t = useTranslations('payroll');
  const [state, formAction, pending] = useActionState<CheckState, FormData>(checkPayrollAction, {});
  return (
    <div>
      <form action={formAction} className="flex flex-wrap items-center gap-1.5">
        <input type="hidden" name="id" value={runId} />
        <Input type="file" name="file" accept=".csv,.txt" required className="w-auto text-xs" />
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          {pending ? t('checking') : t('check')}
        </Button>
      </form>
      {state.error ? <p className="mt-1 text-xs text-red-700">{state.error}</p> : null}
      {state.result ? (
        state.result.ok ? (
          <p className="mt-1 text-xs">
            <Badge tone="green">{t('checkOk')}</Badge>
          </p>
        ) : (
          <div className="mt-1 text-xs text-red-700">
            <Badge tone="red">{t('checkFail', { count: state.result.discrepancies.length })}</Badge>
            <ul className="mt-1 space-y-0.5">
              {state.result.discrepancies.slice(0, 5).map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </div>
        )
      ) : null}
    </div>
  );
}
