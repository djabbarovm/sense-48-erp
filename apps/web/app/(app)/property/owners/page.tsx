import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AlertTriangle, Users } from 'lucide-react';
import { can } from '@finance-os/core';
import { listOwnersAdmin } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { MANAGEMENT_CONTRACT_STATUSES } from '@finance-os/core';
import { Badge, Button, EmptyState, Input, PageHeader, Select, Table, Td, Th } from '@/components/ui';
import { fmtDate } from '@/components/property';
import { linkOwnerUserAction } from './actions';
import { setManagementContractStatusAction } from '../../house/actions';
import { CONTRACT_TONE } from '../../house/tones';

/* Wave 4b — реестр собственников и привязка учёток Owner Portal (property.manage). */

export default async function OwnersAdminPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'property.manage')) notFound();
  const { error } = await searchParams;
  const t = await getTranslations('owners');
  const owners = await listOwnersAdmin(ctx);
  return (
    <div className="space-y-5">
      <PageHeader title={t('title')} meta={<Badge tone="gray">{t('count', { n: owners.length })}</Badge>} />
      <p className="-mt-3 max-w-3xl text-sm text-gray-500">{t('intro')}</p>
      {error ? <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{t.has(`error.${error}`) ? t(`error.${error}`) : t('error.GENERIC')}</div> : null}
      {owners.length === 0 ? <EmptyState icon={<Users />} text={t('empty')} /> : (
        <Table>
          <thead><tr><Th>{t('owner')}</Th><Th>{t('units')}</Th><Th>{t('consents')}</Th><Th>{t('contact')}</Th><Th>{t('contract.title')}</Th><Th>{t('portalUser')}</Th></tr></thead>
          <tbody>
            {owners.map((o) => (
              <tr key={o.id} className="group align-top">
                <Td><span className="font-medium text-gray-900">{o.displayName}</span><span className="ml-2 text-xs text-gray-500">{t(`kind.${o.kind}`)}</span></Td>
                <Td className="font-mono text-xs">{o.units.join(', ') || '—'}</Td>
                <Td className="text-xs"><span className={o.managementConsent ? 'text-emerald-600' : 'text-gray-400'}>{t('c.management')}</span> · <span className={o.listingConsent ? 'text-emerald-600' : 'text-gray-400'}>{t('c.listing')}</span> · <span className={o.marketingConsent ? 'text-emerald-600' : 'text-gray-400'}>{t('c.marketing')}</span></Td>
                <Td className="font-mono text-xs text-gray-600">{o.contactPhone ?? '—'}{o.contactEmail ? <><br />{o.contactEmail}</> : null}</Td>
                <Td>
                  <div className="flex items-center gap-1.5"><Badge tone={CONTRACT_TONE[o.managementContractStatus]} dot>{t(`contract.${o.managementContractStatus}`)}</Badge>{o.managementContractSignedAt ? <span className="font-mono text-[10px] text-gray-400">{fmtDate(o.managementContractSignedAt)}</span> : null}</div>
                  <form action={setManagementContractStatusAction} className="mt-1 flex items-center gap-1"><input type="hidden" name="ownerId" value={o.id} /><Select name="status" defaultValue={o.managementContractStatus} aria-label={t('contract.title')} className="w-32">{MANAGEMENT_CONTRACT_STATUSES.map((st) => (<option key={st} value={st}>{t(`contract.${st}`)}</option>))}</Select><Input name="signedAt" type="date" aria-label={t('contract.signedAt')} className="w-36" /><Button type="submit" size="sm" variant="outline">{t('contract.set')}</Button></form>
                </Td>
                <Td>
                  {o.userEmail ? (
                    <form action={linkOwnerUserAction} className="flex items-center gap-2"><input type="hidden" name="ownerId" value={o.id} /><input type="hidden" name="unlink" value="1" /><Badge tone="green" dot>{o.userEmail}</Badge><button className="text-xs text-red-600 hover:underline">{t('unlink')}</button></form>
                  ) : (
                    <form action={linkOwnerUserAction} className="flex items-center gap-1.5"><input type="hidden" name="ownerId" value={o.id} /><Input name="email" type="email" placeholder={t('emailPlaceholder')} className="w-56" aria-label={t('emailPlaceholder')} required /><Button type="submit" size="sm" variant="outline">{t('link')}</Button></form>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
