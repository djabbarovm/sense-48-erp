/**
 * Геймификация (docs/21, этап DMS core daily experience) — тонкий слой поверх бизнес-фактов.
 *
 * Принцип: XP не начисляется за «клики» (создать задачу, переключить статус, открыть карточку),
 * а выводится из зафиксированных полезных событий (звонок, follow-up, показ, оффер, закрытие сделки).
 * Идемпотентность — по id факта: одно бизнес-событие даёт XP один раз (см. db/services/gamification).
 * Все пороги, XP и миссии — здесь, единым конфигом, чтобы менять без правки CRM-логики (ТЗ §20).
 *
 * Уровни — recognition-слой, НЕ права (ТЗ §17): доступ определяет только RBAC.
 */

export type GameEvent =
  | 'CALL_LOGGED' // состоявшийся звонок (капается по дню — защита от накрутки)
  | 'FOLLOW_UP_DONE' // выполненный follow-up
  | 'VIEWING_SCHEDULED' // назначен реальный показ
  | 'VIEWING_CONDUCTED' // показ проведён (есть результат)
  | 'OFFER_SENT' // клиент получил предложение
  | 'LEAD_QUALIFIED' // лид квалифицирован и передан дальше
  | 'DEAL_WON'; // сделка закрыта

export interface XpRule {
  xp: number;
  /** Максимум засчитываемых событий этого типа за день (защита от накрутки). Без ограничения, если не задан. */
  dailyCap?: number;
}

/** Провизорные значения (ТЗ §14): меняются конфигом, не кодом CRM. */
export const XP_RULES: Record<GameEvent, XpRule> = {
  CALL_LOGGED: { xp: 3, dailyCap: 15 },
  FOLLOW_UP_DONE: { xp: 10 },
  VIEWING_SCHEDULED: { xp: 8 },
  VIEWING_CONDUCTED: { xp: 20 },
  OFFER_SENT: { xp: 25 },
  LEAD_QUALIFIED: { xp: 15 },
  DEAL_WON: { xp: 100 },
};

export interface GameLevel {
  level: number;
  name: string;
  minXp: number;
}

/** Взрослые названия (ТЗ §17): без детских RPG. Пороги — накопительный XP за всё время. */
export const LEVELS: readonly GameLevel[] = [
  { level: 1, name: 'Новичок', minXp: 0 },
  { level: 2, name: 'Специалист', minXp: 300 },
  { level: 3, name: 'Профессионал', minXp: 900 },
  { level: 4, name: 'Эксперт', minXp: 2000 },
  { level: 5, name: 'Мастер', minXp: 4000 },
  { level: 6, name: 'Лидер', minXp: 7500 },
] as const;

export interface LevelProgress {
  current: GameLevel;
  next: GameLevel | null;
  xpIntoLevel: number;
  xpForNext: number | null; // XP до следующего уровня; null на максимуме
  pctToNext: number; // 0..100
}

export function levelFor(totalXp: number): LevelProgress {
  const xp = Math.max(0, Math.floor(totalXp));
  let current = LEVELS[0]!;
  for (const l of LEVELS) if (xp >= l.minXp) current = l;
  const next = LEVELS.find((l) => l.minXp > current.minXp) ?? null;
  const xpIntoLevel = xp - current.minXp;
  const span = next ? next.minXp - current.minXp : 0;
  return {
    current,
    next,
    xpIntoLevel,
    xpForNext: next ? next.minXp - xp : null,
    pctToNext: next && span > 0 ? Math.min(100, Math.round((xpIntoLevel / span) * 100)) : 100,
  };
}

/** День засчитан в streak, если набрано минимум полезного XP (ТЗ §16 — не «открыл приложение»). */
export const STREAK_MIN_XP = 30;

/** Метрика миссии — что db-слой умеет посчитать за день по фактам роли. */
export type MissionMetric =
  | 'leads_handled' // лиды с касанием сегодня (КЦ)
  | 'followups_done' // выполненные follow-up сегодня
  | 'handoffs' // переданные квалифицированные лиды (КЦ → менеджер)
  | 'viewings_conducted' // проведённые показы (менеджер)
  | 'deals_touched' // сделки, по которым было действие сегодня
  | 'offers_sent'; // отправленные предложения

export interface MissionDef {
  key: string;
  title: string;
  metric: MissionMetric;
  target: number;
}

const CALL_CENTER_MISSIONS: readonly MissionDef[] = [
  { key: 'cc_leads', title: 'Обработать новые лиды', metric: 'leads_handled', target: 5 },
  { key: 'cc_followups', title: 'Закрыть follow-up на сегодня', metric: 'followups_done', target: 3 },
  { key: 'cc_handoff', title: 'Передать 3 квалифицированных лида', metric: 'handoffs', target: 3 },
] as const;

const COMMERCIAL_MISSIONS: readonly MissionDef[] = [
  { key: 'cm_viewings', title: 'Провести показы', metric: 'viewings_conducted', target: 3 },
  { key: 'cm_followups', title: 'Follow-up по активным сделкам', metric: 'followups_done', target: 3 },
  { key: 'cm_deals', title: 'Обновить сделки без активности', metric: 'deals_touched', target: 3 },
] as const;

/** ≤3 миссии, role-aware (ТЗ §15). Роль без своих миссий — пустой список (геймификация не мешает). */
export function missionsForRole(roles: readonly string[]): readonly MissionDef[] {
  if (roles.includes('CALL_CENTER')) return CALL_CENTER_MISSIONS;
  if (roles.includes('COMMERCIAL_MANAGER') || roles.includes('BROKER')) return COMMERCIAL_MISSIONS;
  return [];
}

export interface MissionProgress extends MissionDef {
  done: number;
  complete: boolean;
}

export interface GamificationState {
  totalXp: number;
  todayXp: number;
  level: LevelProgress;
  streakDays: number;
  streakDoneToday: boolean;
  missions: MissionProgress[];
  missionsComplete: number;
}
