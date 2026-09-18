/* MDS Property — визуальные примитивы Live Building. Цвет никогда не единственный носитель смысла (blueprint §1.5). */
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { UnitColor, UnitKpi } from '@finance-os/core';
import type { UnitRow } from '@finance-os/db';
import { formatMoney, money } from '@finance-os/core';
import { cn } from '@/components/ui';

export const COLOR_BG: Record<UnitColor, string> = {
  RED: 'bg-red-500 text-white',
  GREY: 'bg-gray-400 text-white',
  GREEN: 'bg-emerald-500 text-white',
  YELLOW: 'bg-amber-400 text-ink-950',
  BLUE: 'bg-sky-500 text-white',
  NEUTRAL: 'bg-gray-200 text-gray-500',
};

export const COLOR_FILL: Record<UnitColor, string> = {
  RED: '#ef4444',
  GREY: '#9ca3af',
  GREEN: '#10b981',
  YELLOW: '#fbbf24',
  BLUE: '#0ea5e9',
  NEUTRAL: '#e5e7eb',
};

export const COLOR_ORDER: UnitColor[] = ['RED', 'GREY', 'GREEN', 'YELLOW', 'BLUE', 'NEUTRAL'];

export const fmtRate = (minor: bigint | null, currency: string): string => {
  if (minor == null) return '—';
  if (currency === 'UZS') return formatMoney(money(minor, currency));
  const major = minor / 100n;
  return `${currency === 'USD' ? '$' : `${currency} `}${major.toLocaleString('ru-RU')}`;
};

export const fmtDate = (d: Date | string | null | undefined): string => (d ? new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

/** Ячейка юнита в Building View: цвет + номер + маркеры overlay/alert + title c деталями. */
export function UnitCell({ u, title, href, size = 'md' }: { u: UnitRow; title: string; href: string; size?: 'sm' | 'md' }) {
  return (
    <Link
      href={href}
      title={title}
      aria-label={title}
      className={cn(
        'relative flex items-center justify-center rounded-[3px] font-mono font-semibold tracking-tight shadow-sm transition-transform hover:z-10 hover:scale-110 hover:shadow-md',
        size === 'sm' ? 'h-5 min-w-8 px-1 text-[9px]' : 'h-7 min-w-11 px-1.5 text-[11px]',
        COLOR_BG[u.view.color],
        u.view.overlay ? 'ring-2 ring-orange-500 ring-offset-1' : '',
      )}
    >
      {u.unitNo}
      {u.view.alerts.length > 0 ? <span className="absolute -top-1 -right-1 flex h-3 w-3 items-center justify-center rounded-full bg-white text-[8px] font-black text-red-600 ring-1 ring-red-600">!</span> : null}
      {u.publishedAt ? <span className="absolute -bottom-0.5 left-1/2 h-0.5 w-3 -translate-x-1/2 rounded-full bg-white/90" aria-hidden /> : null}
    </Link>
  );
}

export function Legend({ labels, counts }: { labels: Record<UnitColor, string> & { overlay: string; alert: string; published: string }; counts?: Record<UnitColor, number> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-gray-600">
      {COLOR_ORDER.map((c) => (
        <span key={c} className="inline-flex items-center gap-1.5">
          <span className={cn('h-3 w-3 rounded-[2px]', COLOR_BG[c])} aria-hidden />
          {labels[c]}
          {counts ? <span className="font-mono text-gray-400">{counts[c]}</span> : null}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-[2px] bg-white ring-2 ring-orange-500" aria-hidden />{labels.overlay}</span>
      <span className="inline-flex items-center gap-1.5"><span className="flex h-3 w-3 items-center justify-center rounded-full bg-white text-[8px] font-black text-red-600 ring-1 ring-red-600" aria-hidden>!</span>{labels.alert}</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-3 rounded-full bg-gray-800" aria-hidden />{labels.published}</span>
    </div>
  );
}

export function KpiStrip({ kpi, labels, currency }: { kpi: UnitKpi; labels: Record<string, string>; currency: string }) {
  const gla = (kpi.availableGlaCm2 / 100).toLocaleString('ru-RU', { maximumFractionDigits: 0 });
  const items: { key: string; value: ReactNode; tone?: string | undefined }[] = [
    { key: 'total', value: kpi.commercial },
    { key: 'occupancy', value: `${kpi.occupancyPct}%`, tone: kpi.occupancyPct >= 85 ? 'text-emerald-600' : kpi.occupancyPct >= 70 ? 'text-amber-600' : 'text-red-600' },
    { key: 'occupied', value: kpi.occupied, tone: 'text-emerald-600' },
    { key: 'vacant', value: kpi.vacant, tone: 'text-red-600' },
    { key: 'renovation', value: kpi.renovation, tone: 'text-gray-500' },
    { key: 'ltr', value: kpi.ltr },
    { key: 'str', value: kpi.str, tone: 'text-amber-600' },
    { key: 'ownerUse', value: kpi.ownerUse, tone: 'text-sky-600' },
    { key: 'gla', value: `${gla} м²` },
    { key: 'potential', value: `${fmtRate(kpi.potentialIncomeMinor, currency)}/${labels.perMonth}` },
    { key: 'current', value: `${fmtRate(kpi.currentIncomeMinor, currency)}/${labels.perMonth}`, tone: 'text-emerald-600' },
    { key: 'alerts', value: kpi.withAlerts, tone: kpi.withAlerts ? 'text-red-600' : undefined },
  ];
  return (
    <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-gray-200 bg-gray-200 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-12">
      {items.map((it) => (
        <div key={it.key} className="bg-white px-3 py-2.5">
          <p className="truncate text-[10px] font-semibold tracking-wider text-gray-500 uppercase">{labels[it.key]}</p>
          <p className={cn('tnum mt-0.5 truncate font-mono text-lg font-bold text-gray-900', it.tone)}>{it.value}</p>
        </div>
      ))}
    </div>
  );
}

/** План этажа: полигоны из Unit.geometry в системе координат Floor.planViewBox. */
export function FloorPlan({ viewBox, units, hrefFor, titleFor }: { viewBox: string; units: UnitRow[]; hrefFor: (u: UnitRow) => string; titleFor: (u: UnitRow) => string }) {
  const withGeometry = units.filter((u) => u.geometry?.points?.length);
  return (
    <svg viewBox={viewBox} className="h-auto w-full rounded-lg border border-gray-200 bg-gray-50" role="img">
      {withGeometry.map((u) => {
        const pts = u.geometry!.points;
        const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
        const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
        return (
          <Link key={u.id} href={hrefFor(u)}>
            <g className="cursor-pointer transition-opacity hover:opacity-80">
              <title>{titleFor(u)}</title>
              <polygon points={pts.map((p) => p.join(',')).join(' ')} fill={COLOR_FILL[u.view.color]} stroke={u.view.overlay ? '#f97316' : '#ffffff'} strokeWidth={u.view.overlay ? 6 : 3} />
              <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fontSize={u.view.color === 'NEUTRAL' ? 18 : 26} fontFamily="ui-monospace, monospace" fontWeight={700} fill={u.view.color === 'YELLOW' || u.view.color === 'NEUTRAL' ? '#0b0e14' : '#ffffff'}>
                {u.unitNo}
              </text>
              {u.view.alerts.length > 0 ? <text x={pts[1]![0] - 18} y={pts[0]![1] + 26} textAnchor="middle" fontSize={24} fontWeight={900} fill="#dc2626">!</text> : null}
            </g>
          </Link>
        );
      })}
    </svg>
  );
}
