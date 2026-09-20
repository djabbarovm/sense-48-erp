import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { PhoneCall, UserSearch, AlertCircle, ArrowRight } from 'lucide-react';
import { can } from '@finance-os/core';
import { listDeals, getOwnerPipeline, type DealRow } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Button, Card, PageHeader, cn } from '@/components/ui';
import { fmtDate } from '@/components/property';
import { handoffAction } from './actions';

/*
 * Инбокс колл-центра (профиль CALL_CENTER, docs/23). REUSE-first: собран из существующих
 * сервисов listDeals + getOwnerPipeline поверх ОБЩИХ данных Tower — не отдельное демо.
 * Задача Умара: принять входящий → квалифицировать → передать (карточка сделки/собственника).
 * Авто-handoff + Telegram push + return-to-qualification (§9) — отдельный slice (пока переход
 * в карточку сделки, где назначается менеджер). Собственная intake-воронка — OPEN A (Intake vs Deal).
 */

function DealLine({ d, t, canHandoff }: { d: DealRow; t: Awaited<ReturnType<typeof getTranslations>>; canHandoff: boolean }) {
  return (
    <div className="flex items-center gap-3 border-t border-gray-100 px-3 py-2.5 first:border-t-0 hover:bg-gray-50">
      <Link href={`/deals/${d.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-gray-100 text-gray-500"><PhoneCall className="h-4 w-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[13.5px] font-semibold text-gray-900">{d.company ?? d.contactName}</span>
            {d.attention.length ? <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-500" aria-label={t('inbox.attention')} /> : null}
          </span>
          <span className="block truncate text-[11px] text-gray-500">
            {t(`deals.source.${d.source}`)} · {t(`deals.stage.${d.stage}`)}
            {d.nextAction ? ` · ${fmtDate(d.nextActionAt)}: ${d.nextAction}` : ` · ${t('inbox.noNextAction')}`}
          </span>
        </span>
      </Link>
      {canHandoff ? (
        <form action={handoffAction}>
          <input type="hidden" name="dealId" value={d.id} />
          <input type="hidden" name="back" value="/inbox" />
          <Button type="submit" size="sm" variant="outline">{t('inbox.handoff')}</Button>
        </form>
      ) : (
        <ArrowRight className="h-4 w-4 shrink-0 text-gray-300" />
      )}
    </div>
  );
}

export default async function InboxPage() {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'deal.manage')) notFound();
  const canHandoff = can(ctx, 'deal.manage');
  const t = await getTranslations();

  const [deals, ownerPipe] = await Promise.all([
    listDeals(ctx, {}),
    can(ctx, 'owner.pipeline') ? getOwnerPipeline(ctx) : Promise.resolve(null),
  ]);

  // Новые входящие — требуют первого контакта/квалификации (КЦ ведёт не дальше показа, BR-P62).
  const incoming = deals.filter((d) => d.stage === 'NEW');
  // Без движения на ранних стадиях — требуют внимания Умара.
  const attention = deals.filter((d) => ['NEW', 'QUALIFIED'].includes(d.stage) && d.attention.length);
  // Discovery-обзвон собственников: ранние стадии воронки собственника.
  const ownersToCall = (ownerPipe?.rows ?? []).filter((o) => o.stage === 'LEAD' || o.stage === 'CONTACTED');
  const ownersOverdue = ownersToCall.filter((o) => o.overdue).length;

  const kpis = [
    { k: 'incoming', v: incoming.length, tone: incoming.length ? 'text-amber-600' : 'text-gray-900' },
    { k: 'attention', v: attention.length, tone: attention.length ? 'text-red-600' : 'text-gray-900' },
    { k: 'ownersToCall', v: ownersToCall.length, tone: 'text-gray-900' },
    { k: 'ownersOverdue', v: ownersOverdue, tone: ownersOverdue ? 'text-red-600' : 'text-gray-900' },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('inbox.title')}
        meta={<Badge tone={incoming.length ? 'yellow' : 'gray'} dot>{t('inbox.slaHint')}</Badge>}
      />
      <p className="-mt-3 text-[13px] text-gray-500">{t('inbox.subtitle')}</p>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-gray-200 bg-gray-200 lg:grid-cols-4">
        {kpis.map((it) => (
          <div key={it.k} className="bg-white px-3 py-2.5">
            <p className="truncate text-[10px] font-semibold tracking-wider text-gray-500 uppercase">{t(`inbox.kpi.${it.k}`)}</p>
            <p className={cn('tnum mt-0.5 font-mono text-lg font-bold', it.tone)}>{it.v}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-0">
          <div className="flex items-center justify-between px-3 py-2.5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-800"><PhoneCall className="h-4 w-4 text-gray-400" />{t('inbox.incomingTitle')}</h2>
            <Link href="/deals" className="text-xs text-brand-600 hover:underline">{t('inbox.openBoard')}</Link>
          </div>
          <div>
            {incoming.length === 0 ? <p className="px-3 py-6 text-center text-[12px] text-gray-400">{t('inbox.empty')}</p> : incoming.map((d) => <DealLine key={d.id} d={d} t={t} canHandoff={canHandoff} />)}
          </div>
        </Card>

        <Card className="p-0">
          <div className="px-3 py-2.5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-800"><AlertCircle className="h-4 w-4 text-gray-400" />{t('inbox.attentionTitle')}</h2>
          </div>
          <div>
            {attention.length === 0 ? <p className="px-3 py-6 text-center text-[12px] text-gray-400">{t('inbox.empty')}</p> : attention.map((d) => <DealLine key={d.id} d={d} t={t} canHandoff={canHandoff} />)}
          </div>
        </Card>
      </div>

      {ownerPipe ? (
        <Card className="p-0">
          <div className="flex items-center justify-between px-3 py-2.5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-800"><UserSearch className="h-4 w-4 text-gray-400" />{t('inbox.discoveryTitle')}</h2>
            <span className="text-[11px] text-gray-400">{t('inbox.discoveryHint')}</span>
          </div>
          <div>
            {ownersToCall.length === 0 ? (
              <p className="px-3 py-6 text-center text-[12px] text-gray-400">{t('inbox.empty')}</p>
            ) : (
              ownersToCall.slice(0, 20).map((o) => (
                <div key={o.id} className="flex items-center gap-3 border-t border-gray-100 px-3 py-2.5 first:border-t-0">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-gray-100 text-gray-500"><UserSearch className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="truncate text-[13.5px] font-semibold text-gray-900">{o.displayName}</span>
                    <span className="block truncate text-[11px] text-gray-500">
                      {t(`owners.stage.${o.stage}`)}{o.unitNos.length ? ` · ${o.unitNos.slice(0, 3).join(', ')}` : ` · ${t('inbox.ownerUnknown')}`}
                      {o.nextAction ? ` · ${o.nextAction}` : ''}
                    </span>
                  </span>
                  {o.overdue ? <Badge tone="red">{t('inbox.overdueTag')}</Badge> : null}
                </div>
              ))
            )}
          </div>
        </Card>
      ) : null}

      <p className="text-[11px] text-gray-400">{t('inbox.footNote')}</p>
    </div>
  );
}
