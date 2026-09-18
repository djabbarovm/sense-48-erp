'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Radio } from 'lucide-react';

/**
 * P-13: подписка на SSE /api/property/events/stream; любое событие юнита/договора/сделки → router.refresh()
 * (server components перечитывают данные). Троттлинг 1.5 с, авто-переподключение — средствами EventSource.
 */
export function LiveRefresh({ types }: { types?: string[] }) {
  const router = useRouter();
  const t = useTranslations('property');
  const [state, setState] = useState<'connecting' | 'live' | 'off'>('connecting');
  const [lastAt, setLastAt] = useState<Date | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof EventSource === 'undefined') { setState('off'); return; }
    const es = new EventSource('/api/property/events/stream');
    const wanted = types ?? ['unit.status.changed', 'lease.activated', 'lease.expiring', 'lease.terminated', 'deal.stage.changed'];
    const onEvent = () => {
      setLastAt(new Date());
      if (timer.current) return;
      timer.current = setTimeout(() => { timer.current = null; router.refresh(); }, 1500);
    };
    es.addEventListener('hello', () => setState('live'));
    for (const type of wanted) es.addEventListener(type, onEvent);
    es.onerror = () => setState('connecting');
    return () => { es.close(); if (timer.current) clearTimeout(timer.current); };
  }, [router, types]);

  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-500" title={t('liveHint')}>
      <Radio className={state === 'live' ? 'h-3.5 w-3.5 text-emerald-500' : 'h-3.5 w-3.5 text-gray-400'} />
      {state === 'live' ? t('live') : state === 'connecting' ? t('liveConnecting') : t('liveOff')}
      {lastAt ? <span className="font-mono text-gray-400">{lastAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span> : null}
    </span>
  );
}
