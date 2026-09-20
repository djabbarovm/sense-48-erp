import { describe, expect, it } from 'vitest';
import { hasRole, ROLE_ALIASES, ROLE_CODES, unsafeCreateTenantContext, type RoleCode } from '../context/index.js';
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

  // 100% permission codes × роли — параметризованная проверка соответствия матрице.
  // ADR-040: CM ⇒ BROKER — однонаправленный алиас; т.к. BROKER ⊆ CM, для can() это no-op.
  it.each(PERMISSION_CODES.map((code) => [code] as const))('%s: allow/deny по матрице', (code) => {
    const allowed = PERMISSION_MATRIX[code] as readonly string[];
    for (const role of ROLE_CODES) {
      const ctx = ctxWith(role);
      const expected = allowed.includes(role);
      expect(can(ctx, code), `${role} → ${code}`).toBe(expected);
      if (expected) {
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

  it('ADR-038: COMMERCIAL_DIRECTOR = права COMMERCIAL_MANAGER (надзор; область видимости — в домене)', () => {
    for (const code of PERMISSION_CODES) {
      expect(can(ctxWith('COMMERCIAL_DIRECTOR'), code), code).toBe(can(ctxWith('COMMERCIAL_MANAGER'), code));
    }
  });

  it('ADR-038: CEO — только видимость, ни одного права на изменение/согласование (four-eyes цел)', () => {
    const ceo = ctxWith('CEO');
    // Разрешено CEO может быть только из набора «чтение/дашборд/аудит»
    const READ_OK = new Set(PERMISSION_CODES.filter((c) => c.endsWith('.view')));
    for (const c of ['dashboard.owner', 'dashboard.ops', 'audit.view', 'owner.pipeline'] as const) READ_OK.add(c);
    for (const code of PERMISSION_CODES) {
      if (can(ceo, code)) expect(READ_OK.has(code), `CEO не должен иметь ${code}`).toBe(true);
    }
    // Явные контроли — CEO закрыт (нельзя нарушить four-eyes / контроли)
    for (const code of ['payment.create', 'batch.approve', 'batch.create', 'contract.approve', 'pr.approve.owner', 'tax.approve', 'payroll.approve', 'user.manage', 'tenant.settings', 'advance.write_off'] as const) {
      expect(can(ceo, code), `CEO → ${code}`).toBe(false);
    }
  });

  it('ADR-040 (Tower SPEC §1): COMMERCIAL_MANAGER — однонаправленный deprecated-алиас BROKER', () => {
    // CM-контекст распознаётся как BROKER (CM ⇒ BROKER) — forward-compat для домена
    expect(hasRole(ctxWith('COMMERCIAL_MANAGER'), 'BROKER')).toBe(true);
    // но не наоборот: BROKER не становится COMMERCIAL_MANAGER (расширение прав BROKER — Phase 2)
    expect(hasRole(ctxWith('BROKER'), 'COMMERCIAL_MANAGER')).toBe(false);
    // алиас однонаправленный и не трогает права: для can() это no-op (BROKER ⊆ CM)
    for (const code of PERMISSION_CODES) {
      expect(can(ctxWith('BROKER'), code), code).toBe((PERMISSION_MATRIX[code] as readonly string[]).includes('BROKER'));
      expect(can(ctxWith('COMMERCIAL_MANAGER'), code), code).toBe((PERMISSION_MATRIX[code] as readonly string[]).includes('COMMERCIAL_MANAGER'));
    }
    // ключевое: BROKER в Phase 1 НЕ получает CM-специфичное право (расширение — Phase 2)
    expect(can(ctxWith('BROKER'), 'property.manage')).toBe(false);
    expect(can(ctxWith('COMMERCIAL_MANAGER'), 'property.manage')).toBe(true);
    // обратимость: единственный алиас — CM ⇒ BROKER
    expect(ROLE_ALIASES).toEqual({ COMMERCIAL_MANAGER: ['BROKER'] });
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
