-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('CLOSING_DOCS', 'MISSING_DOC', 'VERIFY_BANK', 'RECEIPT_PENDING', 'CONTRACT_EXPIRY', 'AR_FOLLOWUP', 'TAX_PREP', 'UNMATCHED_TX', 'ADVANCE_RETURN', 'REVIEW_EXCEPTION');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED', 'OVERDUE');

-- CreateTable
CREATE TABLE "task" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" "TaskType" NOT NULL,
    "object_type" TEXT NOT NULL,
    "object_id" UUID NOT NULL,
    "owner_id" UUID,
    "due_at" TIMESTAMP(3),
    "escalate_to_id" UUID,
    "escalated_at" TIMESTAMP(3),
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "next_action" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "task_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_tenant_id_status_idx" ON "task"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "task_tenant_id_owner_id_status_idx" ON "task"("tenant_id", "owner_id", "status");

-- CreateIndex
CREATE INDEX "task_tenant_id_object_type_object_id_idx" ON "task"("tenant_id", "object_type", "object_id");
