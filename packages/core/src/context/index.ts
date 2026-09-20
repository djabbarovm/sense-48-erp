/**
 * BR-073: любой repository-метод принимает TenantContext. Тип брендирован —
 * получить его можно только через buildTenantContext (db-слой), что делает
 * запрос без контекста ошибкой компиляции.
 */

export const ROLE_CODES = [
  'OWNER',
  'FINANCE_OPS_LEAD',
  'JUNIOR_FINANCE',
  'DOCUMENT_CONTROLLER',
  'ACCOUNTANT',
  'REQUESTER',
  'ADMIN',
  // MDS Property (docs/20 §6): коммерция и эксплуатация недвижимости
  'COMMERCIAL_MANAGER',
  'BROKER',
  'OPERATIONS_MANAGER',
  'MARKETING',
  // CRM Tower (docs/21 §1): колл-центр — заводит и квалифицирует лиды, назначает показы, обзвон собственников; сделку ведёт не дальше показа (BR-P62)
  'CALL_CENTER',
  // Коммерческий директор (ADR-038): надзор над коммерцией. На уровне матрицы = права менеджера;
  // «видит всю команду» — это область видимости, решается доменной логикой, не матрицей.
  'COMMERCIAL_DIRECTOR',
  // CEO как операционный профиль (ADR-038): широкая ВИДИМОСТЬ (все *.view + дашборды + аудит),
  // но НИ ОДНОГО права на создание/изменение/согласование — не может нарушить four-eyes и контроли.
  'CEO',
  // Owner Portal (docs/20 §11.6): собственник видит только свои юниты
  'PROPERTY_OWNER',
] as const;

export type RoleCode = (typeof ROLE_CODES)[number];

/**
 * ADR-040 (Tower SPEC §1): COMMERCIAL_MANAGER — deprecated-алиас BROKER.
 * По SPEC отдельного «менеджера аренды» больше нет: он слит в BROKER. В Phase 1
 * это ОБРАТИМЫЙ, ОДНОНАПРАВЛЕННЫЙ алиас без миграции: контекст с COMMERCIAL_MANAGER
 * дополнительно распознаётся как BROKER (CM ⇒ BROKER). Права BROKER при этом НЕ
 * расширяются (BROKER ⊆ CM, поэтому для can() это no-op) — расширение BROKER до
 * полного цикла и жёсткий мёрж (переназначение ролей в БД) идут отдельной задачей
 * позже (Phase 2, §3.1/§2.2). Откат алиаса — очистить ROLE_ALIASES.
 * Живых пользователей-CM нет (только сид).
 */
export const ROLE_ALIASES: Partial<Record<RoleCode, readonly RoleCode[]>> = {
  COMMERCIAL_MANAGER: ['BROKER'],
};

/** Расширяет набор ролей их deprecated-алиасами (однонаправленно) для проверок доступа. */
export function expandRoles(roles: readonly RoleCode[]): readonly RoleCode[] {
  if (roles.length === 0) return roles;
  let extra: RoleCode[] | null = null;
  for (const r of roles) {
    const targets = ROLE_ALIASES[r];
    if (targets) for (const t of targets) if (!roles.includes(t)) (extra ??= []).push(t);
  }
  return extra ? [...new Set([...roles, ...extra])] : roles;
}

declare const tenantContextBrand: unique symbol;

export interface TenantContext {
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly userId: string;
  readonly roles: readonly RoleCode[];
  readonly [tenantContextBrand]: true;
}

/** Только для фабрики контекста и тестов — не использовать в бизнес-коде напрямую. */
export function unsafeCreateTenantContext(input: {
  tenantId: string;
  tenantSlug: string;
  userId: string;
  roles: readonly RoleCode[];
}): TenantContext {
  return input as TenantContext;
}

export function hasRole(ctx: TenantContext, ...roles: RoleCode[]): boolean {
  const effective = expandRoles(ctx.roles);
  return effective.some((r) => roles.includes(r));
}
