/** Event state machine (docs/04, BR-061/062). */
import { ValidationError } from '../errors/index.js';
import { StateMachine } from './stateMachine.js';

export const EVENT_STATUSES = [
  'DRAFT',
  'QUOTED',
  'CONFIRMED',
  'IN_PROGRESS',
  'HELD',
  'SETTLING',
  'CLOSED',
  'CANCELLED',
] as const;
export type EventStatusCore = (typeof EVENT_STATUSES)[number];

export interface EventPayload {
  hasRevenueLines?: boolean;
  hasCostLines?: boolean;
  /** BR-062: первый депозит получен ≥ schedule[0].pct (SOFT — Owner может override) */
  depositOk?: boolean;
  ownerOverride?: boolean;
  guestsActual?: number | null;
  /** BR-061 (HARD): открытые препятствия закрытию */
  openPayments?: number;
  openAdvances?: number;
  openArInvoices?: number;
  openTasks?: number;
  closeOverrideReason?: string;
  isOwner?: boolean;
}

export type EventTrigger = 'quote' | 'confirm' | 'start' | 'mark_held' | 'settle' | 'close' | 'cancel';

export const eventMachine = new StateMachine<EventStatusCore, EventTrigger, EventPayload>('event', {
  quote: {
    from: ['DRAFT'],
    to: 'QUOTED',
    permission: 'event.edit',
    guard: ({ payload }) => {
      if (!payload.hasRevenueLines) throw new ValidationError('REVENUE_LINES_REQUIRED', 'Заполните revenue lines до квоты');
    },
  },
  confirm: {
    from: ['QUOTED'],
    to: 'CONFIRMED',
    permission: 'event.confirm',
    guard: ({ payload }) => {
      if (!payload.hasCostLines) throw new ValidationError('COST_LINES_REQUIRED', 'Задайте cost budget lines (fast lane) до подтверждения');
      // BR-062 SOFT: депозит по расписанию; Owner может подтвердить без него
      if (!payload.depositOk && !(payload.ownerOverride && payload.isOwner)) {
        throw new ValidationError('DEPOSIT_REQUIRED', 'Первый депозит не получен (BR-062); подтвердить может только Owner');
      }
    },
  },
  start: { from: ['CONFIRMED'], to: 'IN_PROGRESS' }, // авто: event_date = today
  mark_held: {
    from: ['IN_PROGRESS', 'CONFIRMED'],
    to: 'HELD',
    permission: 'event.edit',
    guard: ({ payload }) => {
      if (payload.guestsActual == null) throw new ValidationError('GUESTS_ACTUAL_REQUIRED', 'Укажите фактическое число гостей');
    },
  },
  settle: { from: ['HELD'], to: 'SETTLING' }, // авто: ждём invoices/acts/AR
  close: {
    from: ['SETTLING'],
    to: 'CLOSED',
    permission: 'event.close',
    guard: ({ payload }) => {
      const blockers: string[] = [];
      if (payload.openPayments) blockers.push(`платежи не PAID/CANCELLED: ${payload.openPayments}`);
      if (payload.openAdvances) blockers.push(`advance не закрыты: ${payload.openAdvances}`);
      if (payload.openArInvoices) blockers.push(`счета клиенту не оплачены: ${payload.openArInvoices}`);
      if (payload.openTasks) blockers.push(`открытые задачи: ${payload.openTasks}`);
      if (blockers.length === 0) return;
      // BR-061: Owner c reason может закрыть с блокерами
      if (payload.isOwner && payload.closeOverrideReason?.trim()) return;
      throw new ValidationError('EVENT_CLOSE_BLOCKED', `BR-061: ${blockers.join('; ')}`);
    },
  },
  cancel: { from: ['DRAFT', 'QUOTED', 'CONFIRMED'], to: 'CANCELLED', permission: 'event.edit' },
});
