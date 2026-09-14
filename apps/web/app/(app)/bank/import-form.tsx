'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Card, Input, Select } from '@/components/ui';
import { importStatementAction, type ImportState } from './actions';

export function BankImportForm({ accounts }: { accounts: { id: string; label: string }[] }) {
  const t = useTranslations('bank');
  const [state, formAction, pending] = useActionState<ImportState, FormData>(importStatementAction, {});
  return (
    <Card title={t('importTitle')}>
      <form action={formAction} className="flex flex-wrap items-center gap-2">
        <Select name="bankAccountId" required className="w-auto">
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </Select>
        <Input type="file" name="file" accept=".csv,.xlsx" required className="w-auto flex-1" />
        <Button type="submit" disabled={pending}>
          {pending ? t('importing') : t('importBtn')}
        </Button>
      </form>
      <p className="mt-2 text-xs text-gray-500">{t('importHint')}</p>
      {state.error ? <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p> : null}
      {state.report ? (
        <div className="animate-rise mt-3 text-sm">
          <p>
            {t('importReport', {
              imported: state.report.imported,
              skipped: state.report.skipped,
              autoMatched: state.report.autoMatched,
              suggested: state.report.suggested,
              unmatched: state.report.unmatched,
            })}
          </p>
          {state.report.errors.slice(0, 10).map((e, i) => (
            <p key={i} className="text-red-600">
              #{e.row}: {e.message}
            </p>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
