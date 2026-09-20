-- Tower ТЗ §8/§10 (M2): редактируемые настройки per-tenant (пороги §7, ставки §4). Аддитивно.
-- Откат: DROP TABLE "tower_setting";
CREATE TABLE "tower_setting" (
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    CONSTRAINT "tower_setting_pkey" PRIMARY KEY ("tenant_id","key")
);
