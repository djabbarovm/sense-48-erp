-- Геймификация: заявки на награды (XP/уровни/миссии вычисляются из фактов, таблиц не требуют)
CREATE TYPE "RewardStatus" AS ENUM ('REQUESTED', 'APPROVED', 'FULFILLED', 'DECLINED');

CREATE TABLE "reward_redemption" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "reward_key" TEXT NOT NULL,
  "reward_name" TEXT NOT NULL,
  "cost_xp" INTEGER NOT NULL,
  "status" "RewardStatus" NOT NULL DEFAULT 'REQUESTED',
  "note" TEXT,
  "decided_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "reward_redemption_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "reward_redemption_tenant_id_user_id_created_at_idx" ON "reward_redemption"("tenant_id", "user_id", "created_at");
CREATE INDEX "reward_redemption_tenant_id_status_idx" ON "reward_redemption"("tenant_id", "status");
