'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import type { ImportReport } from '@finance-os/db';
import { Button, Card, Input } from '@/components/ui';
import { importRegistryAction } from './actions';

export function ImportRegistryForm() {
  const t = useTranslations('invoices');
  const [report, formAction, pending] = useActionState<ImportReport | null, FormData>(
    importRegistryAction,
    null,
  );
  return (
    <Card title={t('importRegistry')}>
      <form action={formAction} className="flex flex-wrap items-center gap-2">
        <Input type="file" name="file" accept=".xlsx" required className="w-auto flex-1" />
        <Button type="submit" disabled={pending}>
          {t('importBtn')}
        </Button>
      </form>
      {report ? (
        <div className="mt-3 space-y-1 text-sm">
          <p>
            {t('importResult', {
              imported: report.imported,
              skipped: report.skipped,
              errors: report.errors.length,
            })}
          </p>
          {report.errors.slice(0, 10).map((e, i) => (
            <p key={i} className="text-red-600">
              #{e.row} {e.field}: {e.message}
            </p>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
