import { describe, expect, it } from 'vitest';
import { RuleBasedIntentExtractor } from './ruleBased.js';
import { extractPhone, parseRuDateTime } from './dates.js';

const NOW = new Date('2026-09-19T05:00:00Z'); // пятница 10:00 Ташкент
const x = new RuleBasedIntentExtractor();

describe('CRM-намерения бота (docs/21 §6)', () => {
  it('даты: завтра 15:00, в понедельник, 25.09 14:30, сегодня в 18, через 2 дня', () => {
    expect(parseRuDateTime('показ 1204 завтра 15:00', NOW).at?.toISOString()).toBe('2026-09-20T10:00:00.000Z');
    expect(parseRuDateTime('перезвонить в понедельник', NOW).at?.toISOString()).toBe('2026-09-21T04:00:00.000Z'); // 09:00 по умолчанию
    expect(parseRuDateTime('25.09 14:30', NOW).at?.toISOString()).toBe('2026-09-25T09:30:00.000Z');
    expect(parseRuDateTime('сегодня в 18', NOW).at?.toISOString()).toBe('2026-09-19T13:00:00.000Z');
    expect(parseRuDateTime('через 2 дня', NOW).at?.toISOString()).toBe('2026-09-21T04:00:00.000Z');
    expect(parseRuDateTime('в 9:00', NOW).at?.toISOString()).toBe('2026-09-20T04:00:00.000Z'); // время уже прошло → завтра
    expect(parseRuDateTime('хотят 35 долларов', NOW).at).toBeNull();
    expect(extractPhone('лид +998 (90) 123-45-67 Алиев')).toEqual({ phone: '+998901234567', rest: 'лид Алиев' });
  });
  it('лид: имя, телефон, юнит, потребность', async () => {
    const r = await x.extract({ text: 'лид +998 90 123 45 67 Алиев Сардор, 2к до 1500, юнит 1204, заезд октябрь', now: NOW });
    expect(r.intent).toMatchObject({ kind: 'LEAD_CREATE', contactName: 'Алиев Сардор', contactPhone: '+998901234567', unitNo: '1204' });
    expect(r.confidence).toBeGreaterThan(0.8);
  });
  it('показ назначить vs результат показа', async () => {
    const s = await x.extract({ text: 'показ 1204 завтра 15:00 Алиев', now: NOW });
    expect(s.intent).toMatchObject({ kind: 'VIEWING_SCHEDULE', unitNo: '1204', at: '2026-09-20T10:00:00.000Z', contactName: 'Алиев' });
    const r = await x.extract({ text: 'показ 1204 прошёл, хотят оффер 1400 долларов', now: NOW });
    expect(r.intent).toMatchObject({ kind: 'VIEWING_RESULT', unitNo: '1204', result: 'OFFER', expectedRateMinor: 140000n });
    const l = await x.extract({ text: '1204 показ был, отказ — дорого', now: NOW });
    expect(l.intent).toMatchObject({ kind: 'VIEWING_RESULT', result: 'LOST' });
    const th = await x.extract({ text: 'показ 1507 состоялся, думают до понедельника', now: NOW });
    expect(th.intent).toMatchObject({ kind: 'VIEWING_RESULT', result: 'THINKING', at: '2026-09-21T04:00:00.000Z' });
  });
  it('звонок c follow-up, собственник c расчётом, мой день; старые намерения не сломаны', async () => {
    const c = await x.extract({ text: 'позвонил Каримову, перезвонить в пятницу', now: NOW });
    expect(c.intent).toMatchObject({ kind: 'ACTIVITY_LOG', activity: 'CALL', contactName: 'Каримову', followUpAt: '2026-09-25T04:00:00.000Z' }); // 19.09.2026 — суббота, ближайшая пятница 25.09
    const o = await x.extract({ text: 'собственник 1507 показал расчёт, думает до среды', now: NOW });
    expect(o.intent).toMatchObject({ kind: 'OWNER_ACTIVITY', unitNo: '1507', calcShown: true, followUpAt: '2026-09-23T04:00:00.000Z' });
    expect((await x.extract({ text: 'мой день', now: NOW })).intent).toEqual({ kind: 'QUERY_MY_DAY' });
    expect((await x.extract({ text: '1704 освободился, можно выставлять', now: NOW })).intent).toMatchObject({ kind: 'UNIT_VACATE', publish: true });
    expect((await x.extract({ text: '2804 после клининга, жалоба на ванную', now: NOW })).intent).toMatchObject({ kind: 'UNIT_ISSUE', category: 'PLUMBING' });
    expect((await x.extract({ text: '1103 показали X Company, хотят 35 долларов за метр', now: NOW })).intent?.kind).toBe('DEAL_VIEWING_NOTE'); // старое намерение сохранено
  });
});
