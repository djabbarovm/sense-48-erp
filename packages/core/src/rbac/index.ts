import type { TenantContext } from '../context/index.js';
import { PermissionDeniedError } from '../errors/index.js';
import { PERMISSION_MATRIX, type PermissionCode } from './matrix.js';

export * from './matrix.js';

/** true, если хотя бы одна роль контекста имеет право. */
export function can(ctx: TenantContext, permission: PermissionCode): boolean {
  const allowed = PERMISSION_MATRIX[permission];
  return ctx.roles.some((role) => (allowed as readonly string[]).includes(role));
}

/** Бросает PermissionDeniedError (→403 PERMISSION_DENIED:<code>), если права нет. */
export function requirePermission(ctx: TenantContext, permission: PermissionCode): void {
  if (!can(ctx, permission)) throw new PermissionDeniedError(permission);
}
