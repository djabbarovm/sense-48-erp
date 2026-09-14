import { describe, expect, it } from 'vitest';
import { PERMISSION_CODES, PERMISSION_MATRIX } from '@finance-os/core';
import { prisma } from '../src/client.js';
import { syncPermissions } from '../src/permissions.js';

describe('A-06 Permission/RolePermission sync (docs/05)', () => {
  it('syncPermissions приводит БД к матрице, повторный запуск идемпотентен', async () => {
    const first = await syncPermissions();
    expect(first.permissions).toBe(PERMISSION_CODES.length);
    await syncPermissions();

    const dbPermissions = await prisma.permission.findMany({
      include: { rolePermissions: true },
    });
    expect(dbPermissions).toHaveLength(PERMISSION_CODES.length);
    for (const p of dbPermissions) {
      const expectedRoles = [...(PERMISSION_MATRIX[p.code as keyof typeof PERMISSION_MATRIX] ?? [])].sort();
      const actualRoles = p.rolePermissions.map((rp) => rp.role).sort();
      expect(actualRoles, p.code).toEqual(expectedRoles);
    }
  });
});
