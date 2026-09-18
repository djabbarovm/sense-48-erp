/**
 * P-12 WorkBot (blueprint §1.9, §7; docs/20 §11.4): извлечение намерения из свободного текста сотрудника.
 * Интерфейс — единственное, от чего зависит core/db. Реализации: rule-based mock (здесь) и, позже, LLM-адаптер.
 * Извлекатель НИКОГДА не меняет данные: он только предлагает structured draft; commit — после подтверждения человеком.
 */

export type IntentKind = 'UNIT_VACATE' | 'DEAL_VIEWING_NOTE' | 'UNIT_ISSUE' | 'QUERY_UNITS';

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

export type Intent = UnitVacateIntent | DealViewingNoteIntent | UnitIssueIntent | QueryUnitsIntent;

export interface IntentExtraction {
  intent: Intent | null;
  /** 0..1 — уверенность; ниже порога UI просит уточнить. */
  confidence: number;
  /** Что именно распознано — для preview человеку. */
  entities: Record<string, string | number | boolean | null>;
}

export interface IntentExtractor {
  extract(input: { text: string }): Promise<IntentExtraction>;
}
