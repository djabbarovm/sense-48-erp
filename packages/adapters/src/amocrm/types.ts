/**
 * amoCRM API v4 — минимальные типы (docs официальные: /oauth2/access_token, /api/v4/*).
 * Только то, что реально читаем на первом READ-ONLY этапе. Секреты в типах не храним.
 */

export interface AmoTokens {
  tokenType: string;
  accessToken: string;
  refreshToken: string;
  /** epoch ms, когда access_token истекает (вычисляется из expires_in при получении). */
  expiresAt: number;
}

export interface AmoOAuthConfig {
  subdomain: string; // rooftophall
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** Долгосрочный токен (long-lived): Bearer без refresh. */
export interface AmoLongToken {
  subdomain: string;
  accessToken: string;
}

export interface AmoPage<T> {
  items: T[];
  /** есть ли следующая страница (по _links.next). */
  hasNext: boolean;
  nextPage: number | null;
}

// ── сущности (сырые поля, только используемые; остальное сохраняем raw в БД) ──
export interface AmoUser { id: number; name: string; email?: string; }
export interface AmoPipelineStatus { id: number; name: string; sort: number; is_editable?: boolean; type?: number; }
export interface AmoPipeline { id: number; name: string; sort: number; is_main?: boolean; _embedded?: { statuses?: AmoPipelineStatus[] }; }
export interface AmoCustomFieldValue { field_id: number; field_name?: string; field_code?: string | null; field_type?: string; values?: { value: unknown; enum_id?: number; enum_code?: string }[]; }
export interface AmoContact { id: number; name?: string; responsible_user_id?: number; created_at?: number; updated_at?: number; custom_fields_values?: AmoCustomFieldValue[] | null; _embedded?: { companies?: { id: number }[]; tags?: { id: number; name: string }[] }; }
export interface AmoCompany { id: number; name?: string; responsible_user_id?: number; created_at?: number; updated_at?: number; custom_fields_values?: AmoCustomFieldValue[] | null; }
export interface AmoLead {
  id: number; name?: string; price?: number; responsible_user_id?: number;
  status_id?: number; pipeline_id?: number; created_at?: number; updated_at?: number; closed_at?: number | null;
  loss_reason_id?: number | null; custom_fields_values?: AmoCustomFieldValue[] | null;
  _embedded?: { contacts?: { id: number }[]; companies?: { id: number }[]; tags?: { id: number; name: string }[]; loss_reason?: { id: number; name: string }[] };
}
export interface AmoTask { id: number; entity_id?: number; entity_type?: string; responsible_user_id?: number; is_completed?: boolean; task_type_id?: number; text?: string; complete_till?: number; created_at?: number; updated_at?: number; }
export interface AmoNote { id: number; entity_id?: number; note_type?: string; created_at?: number; created_by?: number; params?: Record<string, unknown>; }
export interface AmoEvent { id: string; type?: string; entity_id?: number; entity_type?: string; created_at?: number; created_by?: number; value_before?: unknown; value_after?: unknown; }
export interface AmoCustomField { id: number; name: string; type: string; code?: string | null; entity_type?: string; enums?: { id: number; value: string; sort?: number }[] | null; }
