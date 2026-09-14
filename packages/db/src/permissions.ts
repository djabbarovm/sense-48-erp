import { PERMISSION_MATRIX, PERMISSION_CODES } from '@finance-os/core';
import type { RoleCode as PrismaRoleCode } from '@prisma/client';
import { prisma } from './client.js';

/**
 * A-06: синхронизация таблиц Permission/RolePermission с матрицей docs/05
 * (PERMISSION_MATRIX в core). Идемпотентна; вызывается из seed и при деплое.
 */
export async function syncPermissions(): Promise<{ permissions: number; grants: number }> {
  let grants = 0;
  await prisma.$transaction(async (tx) => {
    for (const code of PERMISSION_CODES) {
      const permission = await tx.permission.upsert({
        where: { code },
        create: { code },
        update: {},
      });
      const roles = PERMISSION_MATRIX[code] as readonly string[];
      for (const role of roles) {
        await tx.rolePermission.upsert({
          where: { role_permissionId: { role: role as PrismaRoleCode, permissionId: permission.id } },
          create: { role: role as PrismaRoleCode, permissionId: permission.id },
          update: {},
        });
        grants++;
      }
      // Убираем гранты, которых больше нет в матрице
      await tx.rolePermission.deleteMany({
        where: { permissionId: permission.id, role: { notIn: roles as PrismaRoleCode[] } },
      });
    }
    // Убираем права, которых больше нет в матрице
    await tx.permission.deleteMany({ where: { code: { notIn: [...PERMISSION_CODES] } } });
  });
  return { permissions: PERMISSION_CODES.length, grants };
}
