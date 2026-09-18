import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { can } from '@finance-os/core';
import { API_SCOPES, listApiKeys } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Card, PageHeader, Table, Td, Th } from '@/components/ui';
import { fmtDate } from '@/components/property';
import { CreateApiKeyForm } from './create-form';
import { revokeApiKeyAction } from './actions';

/* Wave 2 — API-ключи тенанта для сайта/бота (docs/20 §11.3). Хранится только хэш. */

export default async function ApiKeysPage() {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'apikey.manage')) notFound();
  const t = await getTranslations('apikeys');
  const keys = await listApiKeys(ctx);
  return (
    <div className="space-y-5">
      <PageHeader title={t('title')} />
      <p className="-mt-3 max-w-3xl text-sm text-gray-500">{t('intro')}</p>
      <Card><CreateApiKeyForm scopes={API_SCOPES} /></Card>
      <Table>
        <thead><tr><Th>{t('name')}</Th><Th>{t('prefix')}</Th><Th>{t('scopes')}</Th><Th>{t('createdAt')}</Th><Th>{t('lastUsed')}</Th><Th>{t('status')}</Th><Th /></tr></thead>
        <tbody>
          {keys.length === 0 ? <tr><Td colSpan={7} className="text-center text-gray-400">{t('empty')}</Td></tr> : null}
          {keys.map((k) => (
            <tr key={k.id} className="group">
              <Td className="font-medium text-gray-900">{k.name}</Td>
              <Td className="font-mono text-xs">{k.prefix}…</Td>
              <Td className="text-xs">{k.scopes.map((s) => t(`scope.${s}`)).join(', ')}</Td>
              <Td className="text-xs">{fmtDate(k.createdAt)}</Td>
              <Td className="text-xs">{k.lastUsedAt ? fmtDate(k.lastUsedAt) : '—'}</Td>
              <Td>{k.revokedAt ? <Badge tone="red">{t('revoked')}</Badge> : <Badge tone="green" dot>{t('active')}</Badge>}</Td>
              <Td className="text-right">{k.revokedAt ? null : <form action={revokeApiKeyAction}><input type="hidden" name="id" value={k.id} /><button className="text-xs text-red-600 hover:underline">{t('revoke')}</button></form>}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
