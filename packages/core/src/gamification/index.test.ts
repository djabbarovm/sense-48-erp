import { describe, expect, it } from 'vitest';
import { LEVELS, XP_RULES, levelFor, missionsForRole, STREAK_MIN_XP } from './index.js';

describe('Геймификация — ядро (ТЗ §13–20)', () => {
  it('levelFor: пороги, прогресс, максимум', () => {
    expect(levelFor(0).current.name).toBe('Новичок');
    expect(levelFor(0).next?.name).toBe('Специалист');
    expect(levelFor(299).current.level).toBe(1);
    expect(levelFor(300).current.level).toBe(2);
    const l = levelFor(600); // между 300 и 900
    expect(l.current.level).toBe(2);
    expect(l.xpIntoLevel).toBe(300);
    expect(l.xpForNext).toBe(300);
    expect(l.pctToNext).toBe(50);
    const top = levelFor(999999);
    expect(top.next).toBeNull();
    expect(top.xpForNext).toBeNull();
    expect(top.pctToNext).toBe(100);
  });
  it('levelFor устойчив к мусору', () => {
    expect(levelFor(-100).current.level).toBe(1);
    expect(levelFor(50.7).current.level).toBe(1);
  });
  it('миссии role-aware, ≤3, «передать лида» не миссия, у неизвестной роли пусто', () => {
    expect(missionsForRole(['CALL_CENTER']).map((m) => m.key)).toEqual(['cc_leads', 'cc_followups']);
    expect(missionsForRole(['COMMERCIAL_MANAGER'])[0]!.key).toBe('cm_viewings');
    expect(missionsForRole(['BROKER']).length).toBe(3);
    expect(missionsForRole(['ACCOUNTANT'])).toEqual([]);
    for (const r of [['CALL_CENTER'], ['COMMERCIAL_MANAGER']]) expect(missionsForRole(r).length).toBeLessThanOrEqual(3);
  });
  it('XP-правила: закрытие сделки дороже оффера; за звонок XP нет', () => {
    expect(XP_RULES.DEAL_WON.xp).toBeGreaterThan(XP_RULES.OFFER_SENT.xp);
    expect((XP_RULES as Record<string, unknown>)['CALL_LOGGED']).toBeUndefined(); // звонок не начисляет XP
    expect(STREAK_MIN_XP).toBeGreaterThan(XP_RULES.FOLLOW_UP_DONE.xp); // один follow-up streak не даёт
    expect(LEVELS[0]!.minXp).toBe(0);
  });
});
