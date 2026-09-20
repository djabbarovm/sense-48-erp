import { expandRoles, type TenantContext } from '../context/index.js';
import { PermissionDeniedError } from '../errors/index.js';
import { PERMISSION_MATRIX, type PermissionCode } from './matrix.js';

export * from './matrix.js';

/**
 * true, если хотя бы одна роль контекста (с учётом deprecated-алиасов, ADR-040)
 * имеет право. Алиасы раскрываются через expandRoles: COMMERCIAL_MANAGER ≡ BROKER.
 */
export function can(ctx: TenantContext, permission: PermissionCode): boolean {
  const allowed = PERMISSION_MATRIX[permission] as readonly string[];
  return expandRoles(ctx.roles).some((role) => allowed.includes(role));
}

/** Бросает PermissionDeniedError (→403 PERMISSION_DENIED:<code>), если права нет. */
export function requirePermission(ctx: TenantContext, permission: PermissionCode): void {
  if (!can(ctx, permission)) throw new PermissionDeniedError(permission);
}
