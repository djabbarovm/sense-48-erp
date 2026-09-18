/**
 * D-06: NotificationAdapter (docs/07 §5–6).
 * Шаблоны сознательно НЕ содержат сумм и полных названий контрагентов (BR-072):
 * параметры — только номера объектов, счётчики и даты.
 */
export type NotificationTemplate =
  | 'APPROVALS_PENDING'
  | 'TASK_ASSIGNED'
  | 'TASK_OVERDUE_ESCALATION'
  | 'BATCH_STATUS'
  | 'AR_REMINDER'
  | 'BANK_IMPORT_DONE'
  | 'SECURITY_ALERT'
  | 'PROPERTY_EVENT';

export interface NotificationInput {
  userId: string;
  template: NotificationTemplate;
  params: Record<string, string | number>;
  deepLink: string;
}

export interface NotificationAdapter {
  send(input: NotificationInput): Promise<void>;
}

/** Тексты шаблонов (ru). Без сумм и контрагентов — см. docs/07 §5. */
export const NOTIFICATION_TEXTS: Record<NotificationTemplate, (p: Record<string, string | number>) => string> = {
  APPROVALS_PENDING: (p) => `У вас ${p.count} платежей на approval. Batch ${p.batch_number}.`,
  TASK_ASSIGNED: (p) => `Новая задача: ${p.task_type}. Срок ${p.due}.`,
  TASK_OVERDUE_ESCALATION: (p) => `Просрочена задача ${p.task_type} у ${p.owner_name}.`,
  BATCH_STATUS: (p) => `Batch ${p.batch_number}: ${p.status}.`,
  AR_REMINDER: (p) => `Счёт ${p.invoice_number} клиенту: ${p.offset}.`,
  BANK_IMPORT_DONE: (p) => `Выписка импортирована: ${p.matched}/${p.total} сопоставлено.`,
  SECURITY_ALERT: (p) => `Изменены реквизиты vendor ${p.vendor_display_name}. Требуется верификация.`,
  PROPERTY_EVENT: (p) => `MDS Property: ${p.event} — ${p.object}${p.detail ? ` (${p.detail})` : ''}.`,
};
