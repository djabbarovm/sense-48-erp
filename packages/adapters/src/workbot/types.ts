/**
 * P-12 WorkBot (blueprint §1.9, §7; docs/20 §11.4): извлечение намерения из свободного текста сотрудника.
 * Интерфейс — единственное, от чего зависит core/db. Реализации: rule-based mock (здесь) и, позже, LLM-адаптер.
 * Извлекатель НИКОГДА не меняет данные: он только предлагает structured draft; commit — после подтверждения человеком.
 */

export type IntentKind = 'UNIT_VACATE' | 'DEAL_VIEWING_NOTE' | 'UNIT_ISSUE' | 'QUERY_UNITS' | 'LEAD_CREATE' | 'ACTIVITY_LOG' | 'VIEWING_SCHEDULE' | 'VIEWING_RESULT' | 'OWNER_ACTIVITY' | 'QUERY_MY_DAY';

export interface UnitVacateIntent {
  kind: 'UNIT_VACATE';
  unitNo: string;
  /** Выставить на рынок сразу после освобождения. */
  publish: boolean;
}

export interface DealViewingNoteIntent {
  kind: 'DEAL_VIEWING_NOTE';
  unitNo: string;
  company: string | null;
  /** Ожидаемая ставка в минорных единицах валюты юнита (центы), если распознана. */
  expectedRateMinor: bigint | null;
  perSqm: boolean;
  note: string;
}

export interface UnitIssueIntent {
  kind: 'UNIT_ISSUE';
  unitNo: string;
  category: 'PLUMBING' | 'ELECTRICAL' | 'CLEANING' | 'DAMAGE' | 'OTHER';
  severity: 'ISSUE' | 'CRITICAL';
  note: string;
}

export interface QueryUnitsIntent {
  kind: 'QUERY_UNITS';
  color: 'RED' | 'GREY' | 'GREEN' | 'YELLOW' | 'BLUE' | null;
  vacantOverDays: number | null;
  leaseEndsWithinDays: number | null;
  rentalMode: 'LTR' | 'STR' | null;
}

/** CRM Tower (docs/21 §6): лид c телефона/имени/потребности. */
export interface LeadCreateIntent { kind: 'LEAD_CREATE'; contactName: string; contactPhone: string | null; unitNo: string | null; note: string }
/** Звонок/заметка по сделке (по юниту или имени клиента) c датой следующего шага. */
export interface ActivityLogIntent { kind: 'ACTIVITY_LOG'; activity: 'CALL' | 'NOTE'; unitNo: string | null; contactName: string | null; note: string; followUpAt: string | null }
/** Назначить показ: юнит + дата/время (+ клиент). */
export interface ViewingScheduleIntent { kind: 'VIEWING_SCHEDULE'; unitNo: string; at: string; contactName: string | null; note: string }
/** Результат показа по юниту. */
export interface ViewingResultIntent { kind: 'VIEWING_RESULT'; unitNo: string; result: 'OFFER' | 'THINKING' | 'RESCHEDULE' | 'LOST'; expectedRateMinor: bigint | null; at: string | null; note: string }
/** Активность по собственнику (юнит или имя): звонок / расчёт показан / follow-up. */
export interface OwnerActivityIntent { kind: 'OWNER_ACTIVITY'; unitNo: string | null; ownerName: string | null; calcShown: boolean; note: string; followUpAt: string | null }
export interface QueryMyDayIntent { kind: 'QUERY_MY_DAY' }

export type Intent = UnitVacateIntent | DealViewingNoteIntent | UnitIssueIntent | QueryUnitsIntent | LeadCreateIntent | ActivityLogIntent | ViewingScheduleIntent | ViewingResultIntent | OwnerActivityIntent | QueryMyDayIntent;

export interface IntentExtraction {
  intent: Intent | null;
  /** 0..1 — уверенность; ниже порога UI просит уточнить. */
  confidence: number;
  /** Что именно распознано — для preview человеку. */
  entities: Record<string, string | number | boolean | null>;
}

export interface IntentExtractor {
  extract(input: { text: string; now?: Date }): Promise<IntentExtraction>;
}
