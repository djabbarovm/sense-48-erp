import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PermissionDeniedError, TOWER_THRESHOLD_DEFAULTS, ValidationError, unsafeCreateTenantContext, type RoleCode } from '@finance-os/core';
import { prisma } from '../src/client.js';
import { getTowerThresholds, setTowerThreshold } from '../src/services/towerSettings.js';

let tenantId: string; let ownerId: string;
const ctx = (roles: RoleCode[], userId = ownerId) => unsafeCreateTenantContext({ tenantId, tenantSlug: 'ts', userId, roles });

beforeAll(async () => {
  const ts = Date.now();
  tenantId = (await prisma.tenant.create({ data: { slug: `t-ts-${ts}`, legalName: 'TS', taxId: '300000777', settings: {} } })).id;
  ownerId = (await prisma.user.create({ data: { email: `ts-o-${ts}@t.test`, fullName: 'Владелец' } })).id;
  await prisma.userTenantRole.create({ data: { tenantId, userId: ownerId, role: 'OWNER' } });
});
afterAll(async () => prisma.$disconnect());

describe('Tower settings — пороги (ТЗ §7/§8, M2)', () => {
  it('без строк — дефолты из core', async () => {
    const t = await getTowerThresholds(tenantId);
    expect(t.leadNormWeek).toBe(TOWER_THRESHOLD_DEFAULTS.leadNormWeek);
    expect(t.staleDays).toBe(TOWER_THRESHOLD_DEFAULTS.staleDays);
  });

  it('live-edit порога: policy.manage меняет, чтение отражает, остальные — дефолт; аудит пишется', async () => {
    await setTowerThreshold(ctx(['OWNER']), 'leadNormWeek', 20);
    const t = await getTowerThresholds(tenantId);
    expect(t.leadNormWeek).toBe(20); // переопределено
    expect(t.staleDays).toBe(TOWER_THRESHOLD_DEFAULTS.staleDays); // не трогали → дефолт
    // повторная установка — upsert, не дубль
    await setTowerThreshold(ctx(['OWNER']), 'leadNormWeek', 25);
    expect((await getTowerThresholds(tenantId)).leadNormWeek).toBe(25);
    expect(await prisma.towerSetting.count({ where: { tenantId } })).toBe(1);
    const audit = await prisma.auditLog.findFirst({ where: { tenantId, objectType: 'tower_setting', action: 'tower_setting.set' } });
    expect(audit).not.toBeNull();
  });

  it('SoD: без policy.manage — 403 (BROKER не меняет пороги); невалидное значение — ошибка', async () => {
    await expect(setTowerThreshold(ctx(['BROKER']), 'leadNormWeek', 10)).rejects.toThrow(PermissionDeniedError);
    await expect(setTowerThreshold(ctx(['COMMERCIAL_DIRECTOR']), 'leadNormWeek', 10)).rejects.toThrow(PermissionDeniedError);
    await expect(setTowerThreshold(ctx(['OWNER']), 'leadNormWeek', -1)).rejects.toThrow(ValidationError);
  });

  it('изоляция тенанта: настройка одного тенанта не видна другому', async () => {
    const other = (await prisma.tenant.create({ data: { slug: `t-ts2-${Date.now()}`, legalName: 'TS2', taxId: '300000778', settings: {} } })).id;
    expect((await getTowerThresholds(other)).leadNormWeek).toBe(TOWER_THRESHOLD_DEFAULTS.leadNormWeek);
  });
});
