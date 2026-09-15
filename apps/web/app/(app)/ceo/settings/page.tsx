import { notFound } from 'next/navigation';
import { can, formatMoney, money } from '@finance-os/core';
import { getTranslations } from 'next-intl/server';
import { listCostNorms, listFixedCosts } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Button, Card, Input, Label, PageHeader, Select, Table, Td, Th } from '@/components/ui';
import { deleteFixedCostAction, upsertCostNormAction, upsertFixedCostAction, upsertSenseDayAction } from '../actions';

/* H-07: справочники CEO-контура — постоянные расходы, нормативы, дневная сводка Sense. */

const fmt = (v: bigint) => formatMoney(money(v, 'UZS'));
const UNIT_RU = { ROOFTOP: 'Rooftop Hall', SENSE48: 'Sense 48' } as const;
const FORMAT_RU = { BANQUET: 'Банкет', CONFERENCE: 'Конференция', PRIVATE: 'Частное/SPA', PUBLIC: 'Открытое' } as const;

export default async function CeoSettingsPage() {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'budget.manage')) notFound();
  const t = await getTranslations('ceo');
  const period = new Date().toISOString().slice(0, 7);
  const [costs, norms] = await Promise.all([listFixedCosts(ctx, period), listCostNorms(ctx)]);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <PageHeader title={t('settingsTitle')} meta={`${t('settingsMeta')} · ${period}`} />

      <Card>
        <h3 className="font-display text-sm font-semibold">{t('fixedTitle')} · {period}</h3>
        <p className="mt-1 text-xs text-gray-500">{t('fixedHint')}</p>
        {costs.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <Table>
              <thead><tr><Th>{t('unit')}</Th><Th>{t('name')}</Th><Th className="text-right">{t('sum')}</Th><Th /></tr></thead>
              <tbody>
                {costs.map((c) => (
                  <tr key={c.id}>
                    <Td>{UNIT_RU[c.unit]}</Td>
                    <Td>{c.name}</Td>
                    <Td className="text-right font-mono">{fmt(c.amountMinor)}</Td>
                    <Td className="text-right">
                      <form action={deleteFixedCostAction}><input type="hidden" name="id" value={c.id} /><button className="text-xs text-red-600">{t('delete')}</button></form>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
        <form action={upsertFixedCostAction} className="mt-4 grid gap-3 sm:grid-cols-[1fr_1.4fr_1fr_auto]">
          <input type="hidden" name="period" value={period} />
          <div><Label htmlFor="fc-unit">{t('unit')}</Label><Select id="fc-unit" name="unit" defaultValue="ROOFTOP"><option value="ROOFTOP">Rooftop Hall</option><option value="SENSE48">Sense 48</option></Select></div>
          <div><Label htmlFor="fc-name">{t('name')}</Label><Input id="fc-name" name="name" placeholder={t('fixedPlaceholder')} required /></div>
          <div><Label htmlFor="fc-amount">{t('amount')}</Label><Input id="fc-amount" name="amount" type="number" min="0" required /></div>
          <div className="self-end"><Button type="submit">{t('add')}</Button></div>
        </form>
      </Card>

      <Card>
        <h3 className="font-display text-sm font-semibold">{t('normsTitle')}</h3>
        <p className="mt-1 text-xs text-gray-500">{t('normsHint')}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {norms.map((n) => (
            <form key={n.format} action={upsertCostNormAction} className="flex items-end gap-2">
              <input type="hidden" name="format" value={n.format} />
              <div className="flex-1">
                <Label htmlFor={`norm-${n.format}`}>{FORMAT_RU[n.format]}{n.isDefault ? ' *' : ''}</Label>
                <Input id={`norm-${n.format}`} name="costPct" type="number" min="0" max="95" defaultValue={n.costPct} />
              </div>
              <Button type="submit" variant="outline" size="sm">{t('ok')}</Button>
            </form>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-gray-400">{t('normsDefault')}</p>
      </Card>

      <Card>
        <h3 className="font-display text-sm font-semibold">{t('senseFormTitle')}</h3>
        <p className="mt-1 text-xs text-gray-500">{t('senseFormHint')}</p>
        <form action={upsertSenseDayAction} className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div><Label htmlFor="sd-date">{t('date')}</Label><Input id="sd-date" name="date" type="date" defaultValue={today} required /></div>
          <div><Label htmlFor="sd-visits">{t('visits')}</Label><Input id="sd-visits" name="visitsPlanned" type="number" min="0" /></div>
          <div><Label htmlFor="sd-load">{t('loadPct')}</Label><Input id="sd-load" name="loadPct" type="number" min="0" max="100" /></div>
          <div><Label htmlFor="sd-rev">{t('revenue')}</Label><Input id="sd-rev" name="revenue" type="number" min="0" /></div>
          <div><Label htmlFor="sd-canc">{t('cancellations')}</Label><Input id="sd-canc" name="cancellations" type="number" min="0" /></div>
          <div><Label htmlFor="sd-memb">{t('memberships')}</Label><Input id="sd-memb" name="membershipsSold" type="number" min="0" /></div>
          <div className="sm:col-span-3 lg:col-span-5"><Label htmlFor="sd-notes">{t('notes')}</Label><Input id="sd-notes" name="notes" /></div>
          <div className="self-end"><Button type="submit">{t('saveDay')}</Button></div>
        </form>
      </Card>
    </div>
  );
}
