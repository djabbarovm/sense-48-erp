/**
 * Tower ТЗ §8/§10 (M2): редактируемые пороги Tower (§7) в таблице tower_setting.
 * Дефолты — в core (towerThresholdsFrom / TOWER_THRESHOLD_DEFAULTS). Строка здесь
 * переопределяет дефолт по ключу; отсутствует — берётся дефолт. ОТДЕЛЬНО от ApprovalPolicy.
 * Значения меняются без деплоя (live-edit), тюнинг — позже.
 */
import type { TenantContext, TowerThresholds } from '@finance-os/core';
import { ValidationError, requirePermission, towerThresholdsFrom } from '@finance-os/core';
import { withAudit } from '../audit.js';
import { prisma } from '../client.js';

const PREFIX = 'threshold.';

/** Пороги Tower: строки tower_setting поверх дефолтов core. Read — для алертов/дашбордов. */
export async function getTowerThresholds(tenantId: string): Promise<TowerThresholds> {
  const rows = await prisma.towerSetting.findMany({ where: { tenantId, key: { startsWith: PREFIX } } });
  const overrides: Record<string, unknown> = {};
  for (const r of rows) overrides[r.key.slice(PREFIX.length)] = r.value;
  return towerThresholdsFrom(overrides);
}

/** Установить один порог (live-edit). Право — policy.manage (владелец/админ); аудируется. */
export async function setTowerThreshold(ctx: TenantContext, key: keyof TowerThresholds, value: number) {
  requirePermission(ctx, 'policy.manage');
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new ValidationError('THRESHOLD_INVALID', `THRESHOLD_INVALID: ${String(key)} должен быть числом ≥ 0`);
  }
  const settingKey = `${PREFIX}${String(key)}`;
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const row = await tx.towerSetting.upsert({
      where: { tenantId_key: { tenantId: ctx.tenantId, key: settingKey } },
      create: { tenantId: ctx.tenantId, key: settingKey, value, updatedBy: ctx.userId },
      update: { value, updatedBy: ctx.userId },
    });
    // objectId — UUID тенанта (у tower_setting составной ключ, не UUID); конкретный порог — в after.key
    return { result: row, audit: { action: 'tower_setting.set', objectType: 'tower_setting', objectId: ctx.tenantId, after: { key: settingKey, value } } };
  });
}
