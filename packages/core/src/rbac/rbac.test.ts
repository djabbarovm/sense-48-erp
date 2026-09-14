import { describe, expect, it } from 'vitest';
import { ROLE_CODES, unsafeCreateTenantContext, type RoleCode } from '../context/index.js';
import { PermissionDeniedError } from '../errors/index.js';
import { PERMISSION_CODES, PERMISSION_MATRIX, can, requirePermission } from './index.js';

const ctxWith = (...roles: RoleCode[]) =>
  unsafeCreateTenantContext({ tenantId: 't', tenantSlug: 't', userId: 'u', roles });

describe('A-06 RBAC matrix (docs/05)', () => {
  it('в матрице только валидные роли и нет пустых строк', () => {
    for (const [code, roles] of Object.entries(PERMISSION_MATRIX)) {
      expect(roles.length, code).toBeGreaterThan(0);
      for (const r of roles) expect(ROLE_CODES).toContain(r);
      expect(new Set(roles).size, `${code} duplicates`).toBe(roles.length);
    }
  });

  // 100% permission codes × 7 ролей — параметризованная проверка соответствия матрице
  it.each(PERMISSION_CODES.map((code) => [code] as const))('%s: allow/deny по матрице', (code) => {
    const allowed = PERMISSION_MATRIX[code] as readonly string[];
    for (const role of ROLE_CODES) {
      const ctx = ctxWith(role);
      expect(can(ctx, code), `${role} → ${code}`).toBe(allowed.includes(role));
      if (allowed.includes(role)) {
        expect(() => requirePermission(ctx, code)).not.toThrow();
      } else {
        expect(() => requirePermission(ctx, code)).toThrow(PermissionDeniedError);
        try {
          requirePermission(ctx, code);
        } catch (e) {
          expect((e as PermissionDeniedError).code).toBe(`PERMISSION_DENIED:${code}`);
        }
      }
    }
  });

  it('несколько ролей: право есть, если есть хотя бы у одной', () => {
    const ctx = ctxWith('REQUESTER', 'ACCOUNTANT');
    expect(can(ctx, 'tax.file')).toBe(true); // от ACCOUNTANT
    expect(can(ctx, 'pr.create')).toBe(true); // от REQUESTER
    expect(can(ctx, 'batch.approve')).toBe(false);
  });

  it('инварианты docs/05: Admin вне финансового workflow, Owner не готовит платежи', () => {
    const admin = ctxWith('ADMIN');
    for (const code of PERMISSION_CODES.filter((c) => c.startsWith('payment.') && c !== 'payment.view')) {
      expect(can(admin, code), `ADMIN → ${code}`).toBe(false);
    }
    const owner = ctxWith('OWNER');
    expect(can(owner, 'payment.create')).toBe(false);
    expect(can(owner, 'batch.create')).toBe(false);
  });
});
