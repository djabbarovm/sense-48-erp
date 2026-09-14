'use client';

/** Живой обратный отсчёт до cutoff (14:00) — главный ритм игрового дня. */
import { useEffect, useState } from 'react';
import { cn } from '@/components/ui';

export function CutoffCountdown({ cutoff, label, doneLabel }: { cutoff: string; label: string; doneLabel: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const [h, m] = cutoff.split(':').map(Number) as [number, number];
  const target = new Date();
  target.setHours(h, m, 0, 0);
  const diff = target.getTime() - now;
  const passed = diff <= 0;
  const hours = Math.floor(diff / 3600_000);
  const minutes = Math.floor((diff % 3600_000) / 60_000);
  const seconds = Math.floor((diff % 60_000) / 1000);
  const critical = !passed && diff < 3600_000;

  return (
    <div
      className={cn(
        'pixel-grid relative overflow-hidden rounded-lg border p-5 transition-colors',
        passed
          ? 'border-ink-700 bg-ink-900'
          : critical
            ? 'animate-pulse-slow border-red-500/40 bg-ink-900 shadow-[0_0_24px_-6px_rgba(239,68,68,0.5)]'
            : 'border-volt-700/40 bg-ink-900 shadow-volt',
      )}
    >
      <p className="text-[11px] font-semibold tracking-[0.14em] text-slate-400 uppercase">{label}</p>
      {passed ? (
        <p className="tnum mt-2 text-3xl font-bold text-slate-500">{doneLabel}</p>
      ) : (
        <p className={cn('tnum mt-2 text-4xl font-bold', critical ? 'text-red-400' : 'text-volt-500')}>
          {String(hours).padStart(2, '0')}:{String(minutes).padStart(2, '0')}
          <span className="text-xl opacity-60">:{String(seconds).padStart(2, '0')}</span>
        </p>
      )}
    </div>
  );
}
