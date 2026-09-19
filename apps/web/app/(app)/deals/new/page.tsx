import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AlertTriangle } from 'lucide-react';
import { DEAL_PRODUCTS, DEAL_SOURCES, can } from '@finance-os/core';
import { listDealManagers, listUnits } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Button, Card, Input, Label, PageHeader, Select } from '@/components/ui';
import { createDealAction } from '../actions';

export default async function NewDealPage({ searchParams }: { searchParams: Promise<{ unit?: string; error?: string }> }) {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'deal.manage')) notFound();
  const sp = await searchParams;
  const t = await getTranslations('deals');
  const [managers, units] = await Promise.all([listDealManagers(ctx), listUnits(ctx)]);
  const sellable = units.filter((u) => u.view.isSellable || u.id === sp.unit);
  const brokerOnly = ctx.roles.includes('BROKER') && !ctx.roles.some((r) => r === 'OWNER' || r === 'COMMERCIAL_MANAGER');

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title={t('newDeal')} />
      {sp.error ? <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{t.has(`error.${sp.error}`) ? t(`error.${sp.error}`) : t('error.GENERIC')}</div> : null}
      <Card>
        <form action={createDealAction} className="grid gap-3 sm:grid-cols-2">
          <div><Label htmlFor="d-contact">{t('contactName')} *</Label><Input id="d-contact" name="contactName" required /></div>
          <div><Label htmlFor="d-company">{t('company')}</Label><Input id="d-company" name="company" /></div>
          <div><Label htmlFor="d-phone">{t('phone')}</Label><Input id="d-phone" name="contactPhone" type="tel" /></div>
          <div><Label htmlFor="d-email">{t('email')}</Label><Input id="d-email" name="contactEmail" type="email" /></div>
          <div><Label htmlFor="d-product">{t('productLabel')}</Label><Select id="d-product" name="product" defaultValue="LEASE_LTR">{DEAL_PRODUCTS.map((p) => (<option key={p} value={p}>{t(`product.${p}`)}</option>))}</Select></div>
          <div><Label htmlFor="d-source">{t('sourceLabel')}</Label><Select id="d-source" name="source" defaultValue="OTHER">{DEAL_SOURCES.map((s) => (<option key={s} value={s}>{t(`source.${s}`)}</option>))}</Select></div>
          <div><Label htmlFor="d-manager">{t('manager')}</Label><Select id="d-manager" name="managerId" defaultValue={ctx.userId} disabled={brokerOnly}>{managers.map((m) => (<option key={m.id} value={m.id}>{m.fullName}</option>))}</Select></div>
          <div className="sm:col-span-2"><Label htmlFor="d-unit">{t('unit')}</Label>
            <Select id="d-unit" name="unitId" defaultValue={sp.unit ?? ''}>
              <option value="">{t('noUnitYet')}</option>
              {sellable.map((u) => (<option key={u.id} value={u.id}>{u.unitNo} · {u.areaM2} {t('sqm')} · {u.askingRateMinor ? `$${Number(u.askingRateMinor) / 100}` : '—'}</option>))}
            </Select>
          </div>
          <div><Label htmlFor="d-budget">{t('budgetUsd')}</Label><Input id="d-budget" name="budget" type="number" min="0" step="0.01" /></div>
          <div><Label htmlFor="d-rate">{t('expectedRateUsd')}</Label><Input id="d-rate" name="expectedRate" type="number" min="0" step="0.01" /></div>
          <div><Label htmlFor="d-amin">{t('areaMin')}</Label><Input id="d-amin" name="areaMin" type="number" min="0" step="0.1" /></div>
          <div><Label htmlFor="d-amax">{t('areaMax')}</Label><Input id="d-amax" name="areaMax" type="number" min="0" step="0.1" /></div>
          <div><Label htmlFor="d-purpose">{t('purpose')}</Label><Input id="d-purpose" name="purpose" placeholder={t('purposePlaceholder')} /></div>
          <div><Label htmlFor="d-timing">{t('timing')}</Label><Input id="d-timing" name="timing" placeholder={t('timingPlaceholder')} /></div>
          <div><Label htmlFor="d-next">{t('nextAction')}</Label><Input id="d-next" name="nextAction" /></div>
          <div><Label htmlFor="d-nextAt">{t('nextActionAt')}</Label><Input id="d-nextAt" name="nextActionAt" type="date" /></div>
          <div className="sm:col-span-2"><Button type="submit">{t('create')}</Button></div>
        </form>
      </Card>
    </div>
  );
}
