'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Input, Label } from '@/components/ui';
import { createApiKeyAction, type ApiKeyState } from './actions';

export function CreateApiKeyForm({ scopes }: { scopes: readonly string[] }) {
  const t = useTranslations('apikeys');
  const [state, action, pending] = useActionState<ApiKeyState, FormData>(createApiKeyAction, {});
  return (
    <div>
      <form action={action} className="flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1"><Label htmlFor="k-name">{t('name')}</Label><Input id="k-name" name="name" placeholder={t('namePlaceholder')} required /></div>
        <fieldset className="flex items-center gap-3 text-sm text-gray-700">
          {scopes.map((s) => (<label key={s} className="flex items-center gap-1.5"><input type="checkbox" name="scopes" value={s} defaultChecked className="h-4 w-4" />{t(`scope.${s}`)}</label>))}
        </fieldset>
        <Button type="submit" size="sm" disabled={pending}>{pending ? t('creating') : t('create')}</Button>
      </form>
      {state.error ? <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{state.error}</p> : null}
      {state.plaintext ? (
        <div className="animate-rise mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="font-semibold text-amber-900">{t('showOnce')}</p>
          <code className="mt-1 block break-all rounded bg-white px-2 py-1 font-mono text-[13px] text-gray-900">{state.plaintext}</code>
          <p className="mt-1 text-xs text-amber-800">{t('usage')}</p>
        </div>
      ) : null}
    </div>
  );
}
