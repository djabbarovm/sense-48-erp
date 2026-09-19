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
  // Owner Portal (docs/20 §11.6): собственник видит только свои юниты
  'PROPERTY_OWNER',
] as const;

export type RoleCode = (typeof ROLE_CODES)[number];

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
  return ctx.roles.some((r) => roles.includes(r));
}
