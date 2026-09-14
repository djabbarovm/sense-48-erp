/**
 * Общий каркас state machine (docs/04): переходы только через явные триггеры,
 * каждый переход проверяет права и guard'ы; недопустимый переход →
 * IllegalTransitionError. Запись AuditLog делает вызывающий сервис.
 */
import type { TenantContext } from '../context/index.js';
import { IllegalTransitionError } from '../errors/index.js';
import type { PermissionCode } from '../rbac/matrix.js';
import { requirePermission } from '../rbac/index.js';

export interface TransitionDef<S extends string, Ctx = unknown> {
  from: readonly S[];
  to: S;
  /** Право, требуемое для ручного триггера; авто-переходы (job/system) — без права. */
  permission?: PermissionCode;
  /** Доп. guard: бросает доменную ошибку, если переход недопустим. */
  guard?: (input: { ctx: TenantContext | null; from: S; payload: Ctx }) => void;
}

export class StateMachine<S extends string, T extends string, Ctx = unknown> {
  constructor(
    private readonly objectType: string,
    private readonly transitions: Record<T, TransitionDef<S, Ctx>>,
  ) {}

  /**
   * Проверяет допустимость перехода и возвращает целевой статус.
   * ctx = null означает системный (авто) переход — права не проверяются.
   */
  assert(ctx: TenantContext | null, from: S, trigger: T, payload: Ctx): S {
    const def = this.transitions[trigger];
    if (!def) throw new IllegalTransitionError(this.objectType, from, String(trigger));
    if (!def.from.includes(from)) throw new IllegalTransitionError(this.objectType, from, def.to);
    if (def.permission && ctx) requirePermission(ctx, def.permission);
    def.guard?.({ ctx, from, payload });
    return def.to;
  }

  can(ctx: TenantContext | null, from: S, trigger: T, payload: Ctx): boolean {
    try {
      this.assert(ctx, from, trigger, payload);
      return true;
    } catch {
      return false;
    }
  }

  /** Триггеры, допустимые из статуса (для UI-кнопок). */
  availableTriggers(ctx: TenantContext | null, from: S, payload: Ctx): T[] {
    return (Object.keys(this.transitions) as T[]).filter((t) => this.can(ctx, from, t, payload));
  }
}
