import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Building2, CalendarClock, CheckCircle2, Printer } from 'lucide-react';
import { getPublicProposal } from '@finance-os/db';
import { fmtDate, fmtRate } from '@/components/property';
import { requestViewingAction } from './actions';

/* P-28 — публичная страница КП для клиента: без входа, только публичные поля помещений, кнопка «Записаться на показ», печать в PDF. */

export default async function ProposalPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ sent?: string }> }) {
  const { token } = await params; const sp = await searchParams;
  const p = await getPublicProposal(token);
  if (!p) notFound();
  const t = await getTranslations('proposal'); const tP = await getTranslations('property');
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-6 print:bg-white">
      <div className="mx-auto max-w-2xl space-y-4">
        <header className="rounded-xl bg-ink-950 px-5 py-5 text-white print:bg-white print:text-black print:ring-1 print:ring-gray-300">
          <p className="font-mono text-[11px] tracking-widest text-volt-500 uppercase print:text-gray-600">{t('from', { company: p.company })}</p>
          <h1 className="mt-1 font-display text-xl font-bold">{t('title', { name: p.clientFirstName })}</h1>
          <p className="mt-1 text-sm text-gray-300 print:text-gray-700">{t('manager', { name: p.managerName })}{p.validUntil ? ` · ${t('validUntil', { d: fmtDate(p.validUntil) })}` : ''}</p>
          {p.note ? <p className="mt-3 rounded-md bg-white/10 px-3 py-2 text-sm print:bg-gray-100">{p.note}</p> : null}
        </header>
        {p.expired ? <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{t('expired')}</p> : null}
        <ul className="space-y-3">
          {p.units.map((u) => (
            <li key={u.id} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-100 print:break-inside-avoid">
              <div className="flex items-start justify-between gap-3">
                <div><p className="font-mono text-2xl font-bold text-ink-900">{u.unitNo}</p><p className="mt-0.5 flex items-center gap-1 text-sm text-gray-600"><Building2 className="h-4 w-4" />{u.building} · {t('floor', { n: u.floorNo })} · {tP(`type.${u.type}`)}</p></div>
                <div className="text-right"><p className="font-mono text-lg font-semibold text-ink-900">{u.askingRateMinor != null ? fmtRate(u.askingRateMinor, u.currency) : t('rateOnRequest')}</p>{u.askingRateMinor != null ? <p className="text-[11px] text-gray-500">{t('rate')}</p> : null}</div>
              </div>
              <p className="mt-2 text-sm text-gray-700">{t('area', { a: u.areaM2 })} · {t(`readiness.${u.readiness}`)}</p>
            </li>
          ))}
        </ul>
        {!p.expired ? (
          <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-100 print:hidden">
            {sp.sent === '1' || p.requested ? <p className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="h-5 w-5" />{sp.sent === '1' ? t('requestSent') : t('requested')}</p> : (
              <form action={requestViewingAction} className="space-y-2">
                <input type="hidden" name="token" value={token} />
                <label className="block text-sm font-medium text-gray-800" htmlFor="rv-note">{t('requestHint')}</label>
                <input id="rv-note" name="note" maxLength={300} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
                <button type="submit" className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-ink-900 px-4 py-2.5 text-sm font-semibold text-white"><CalendarClock className="h-4 w-4" />{t('request')}</button>
              </form>
            )}
          </section>
        ) : null}
        <p className="flex items-center justify-between text-[11px] text-gray-400 print:hidden"><span>{t('footer')}</span><a href="javascript:window.print()" className="inline-flex items-center gap-1 text-gray-500 hover:text-gray-700"><Printer className="h-3.5 w-3.5" />{t('print')}</a></p>
      </div>
    </main>
  );
}
