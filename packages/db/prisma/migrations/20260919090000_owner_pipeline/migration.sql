-- CreateEnum
CREATE TYPE "OwnerStage" AS ENUM ('LEAD', 'CONTACTED', 'CALC_SHOWN', 'CONSENT', 'CONTRACT_SENT', 'SIGNED', 'HANDED_OVER', 'LOST');

-- AlterEnum
ALTER TYPE "TaskType" ADD VALUE 'OWNER_FOLLOWUP';

-- AlterTable
ALTER TABLE "property_owner" ADD COLUMN     "calc_shown_at" TIMESTAMP(3),
ADD COLUMN     "lost_reason" TEXT,
ADD COLUMN     "manager_id" UUID,
ADD COLUMN     "next_action" TEXT,
ADD COLUMN     "next_action_at" TIMESTAMP(3),
ADD COLUMN     "pipeline_stage" "OwnerStage" NOT NULL DEFAULT 'LEAD',
ADD COLUMN     "source" "DealSource",
ADD COLUMN     "stage_changed_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "unit_activity" ADD COLUMN     "owner_id" UUID;

-- CreateIndex
CREATE INDEX "property_owner_tenant_id_pipeline_stage_idx" ON "property_owner"("tenant_id", "pipeline_stage");

-- CreateIndex
CREATE INDEX "unit_activity_tenant_id_owner_id_happened_at_idx" ON "unit_activity"("tenant_id", "owner_id", "happened_at");

-- AddForeignKey
ALTER TABLE "unit_activity" ADD CONSTRAINT "unit_activity_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "property_owner"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill (P-22b): стадия воронки из уже известных фактов
UPDATE "property_owner" o SET pipeline_stage = 'HANDED_OVER', stage_changed_at = o.updated_at
WHERE EXISTS (SELECT 1 FROM "unit" u WHERE u.owner_id = o.id AND u.managed_by_platform = true);
UPDATE "property_owner" SET pipeline_stage = 'SIGNED', stage_changed_at = COALESCE(management_contract_signed_at::timestamp, updated_at) WHERE pipeline_stage = 'LEAD' AND management_contract_status = 'SIGNED';
UPDATE "property_owner" SET pipeline_stage = 'CONTRACT_SENT', stage_changed_at = updated_at WHERE pipeline_stage = 'LEAD' AND management_contract_status = 'SENT';
UPDATE "property_owner" SET pipeline_stage = 'LOST', lost_reason = 'OTHER', stage_changed_at = updated_at WHERE pipeline_stage = 'LEAD' AND management_contract_status = 'DECLINED';
UPDATE "property_owner" SET pipeline_stage = 'CONSENT', stage_changed_at = COALESCE(consent_updated_at, updated_at) WHERE pipeline_stage = 'LEAD' AND management_consent = true;
UPDATE "property_owner" SET pipeline_stage = 'CONTACTED', stage_changed_at = updated_at WHERE pipeline_stage = 'LEAD' AND (contact_phone IS NOT NULL OR contact_email IS NOT NULL);
