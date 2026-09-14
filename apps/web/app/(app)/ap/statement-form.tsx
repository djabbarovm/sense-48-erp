'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Badge, Button, Card, Input, Select } from '@/components/ui';
import { reconcileStatementAction, type StatementDiffState } from './actions';

function soum(minorStr: string): string {
  return `${(BigInt(minorStr) / 100n).toLocaleString('ru-RU')} сум`;
}

export function StatementForm({ vendors }: { vendors: { id: string; name: string }[] }) {
  const t = useTranslations('ap');
  const [state, formAction, pending] = useActionState<StatementDiffState, FormData>(reconcileStatementAction, {});
  return (
    <Card title={t('statementTitle')}>
      <form action={formAction} className="flex flex-wrap items-center gap-2">
        <Select name="vendorId" required className="w-auto">
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </Select>
        <Input type="file" name="file" accept=".csv" required className="w-auto flex-1" />
        <Button type="submit" disabled={pending}>
          {pending ? t('comparing') : t('compare')}
        </Button>
      </form>
      <p className="mt-2 text-xs text-gray-500">{t('statementHint')}</p>
      {state.error ? <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p> : null}
      {state.diff ? (
        <div className="animate-rise mt-3 space-y-2 text-sm">
          <p>
            <Badge tone="green">{t('matched')}</Badge> {state.diff.matched.length}
          </p>
          {state.diff.amountMismatch.length > 0 ? (
            <div>
              <Badge tone="red">{t('mismatch')}</Badge>
              <ul className="mt-1 space-y-0.5">
                {state.diff.amountMismatch.map((m) => (
                  <li key={m.number}>
                    <span className="font-mono font-semibold">{m.number}</span>: {t('theirAmount')}{' '}
                    <span className="money">{soum(m.statement)}</span> · {t('ourAmount')}{' '}
                    <span className="money">{soum(m.system)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {state.diff.missingInSystem.length > 0 ? (
            <div>
              <Badge tone="yellow">{t('missingInSystem')}</Badge>
              <ul className="mt-1 space-y-0.5">
                {state.diff.missingInSystem.map((m) => (
                  <li key={m.number}>
                    <span className="font-mono font-semibold">{m.number}</span> — <span className="money">{soum(m.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {state.diff.missingInStatement.length > 0 ? (
            <div>
              <Badge tone="yellow">{t('missingInStatement')}</Badge>
              <ul className="mt-1 space-y-0.5">
                {state.diff.missingInStatement.map((m) => (
                  <li key={m.number}>
                    <span className="font-mono font-semibold">{m.number}</span> — <span className="money">{soum(m.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
