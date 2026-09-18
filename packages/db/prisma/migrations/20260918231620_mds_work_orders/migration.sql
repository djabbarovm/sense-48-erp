-- CreateEnum
CREATE TYPE "WorkOrderCategory" AS ENUM ('PLUMBING', 'ELECTRICAL', 'HVAC', 'CLEANING', 'DAMAGE', 'ACCESS', 'OTHER');

-- CreateEnum
CREATE TYPE "WorkOrderPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "WorkOrderStatus" AS ENUM ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'DONE', 'VERIFIED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "TaskType" ADD VALUE 'WORKORDER_OVERDUE';

-- CreateTable
CREATE TABLE "work_order" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "unit_id" UUID,
    "building_id" UUID,
    "category" "WorkOrderCategory" NOT NULL,
    "priority" "WorkOrderPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "WorkOrderStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "reporter_id" UUID NOT NULL,
    "assignee_id" UUID,
    "contractor_name" TEXT,
    "source" "ChangeSource" NOT NULL DEFAULT 'UI',
    "sla_due_at" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3),
    "done_at" TIMESTAMP(3),
    "verified_at" TIMESTAMP(3),
    "verified_by" UUID,
    "cancel_reason" TEXT,
    "overdue_notified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "work_order_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_order_tenant_id_status_priority_idx" ON "work_order"("tenant_id", "status", "priority");

-- CreateIndex
CREATE INDEX "work_order_tenant_id_unit_id_status_idx" ON "work_order"("tenant_id", "unit_id", "status");

-- CreateIndex
CREATE INDEX "work_order_tenant_id_assignee_id_status_idx" ON "work_order"("tenant_id", "assignee_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "work_order_tenant_id_number_key" ON "work_order"("tenant_id", "number");

-- AddForeignKey
ALTER TABLE "work_order" ADD CONSTRAINT "work_order_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
