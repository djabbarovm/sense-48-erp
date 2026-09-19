-- CreateEnum
CREATE TYPE "ServiceCategory" AS ENUM ('CLEANING', 'LAUNDRY', 'REPAIR', 'CONCIERGE', 'MOVING', 'DESIGN', 'IT', 'OTHER');

-- CreateEnum
CREATE TYPE "ServiceProviderKind" AS ENUM ('OWN_OPS', 'PARTNER');

-- CreateEnum
CREATE TYPE "ServiceOrderStatus" AS ENUM ('NEW', 'ACCEPTED', 'IN_PROGRESS', 'DONE', 'VERIFIED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "TaskType" ADD VALUE 'SERVICE_ORDER_OVERDUE';

-- CreateTable
CREATE TABLE "service_catalog_item" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "ServiceCategory" NOT NULL,
    "provider_kind" "ServiceProviderKind" NOT NULL,
    "partner_name" TEXT,
    "price_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'UZS',
    "commission_bp" INTEGER NOT NULL DEFAULT 0,
    "sla_hours" INTEGER NOT NULL DEFAULT 48,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_catalog_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_order" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "catalog_item_id" UUID NOT NULL,
    "unit_id" UUID,
    "building_id" UUID,
    "status" "ServiceOrderStatus" NOT NULL DEFAULT 'NEW',
    "provider_kind" "ServiceProviderKind" NOT NULL,
    "partner_name" TEXT,
    "price_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "commission_bp" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "customer_name" TEXT,
    "orderer_id" UUID NOT NULL,
    "owner_id" UUID,
    "assignee_id" UUID,
    "notes" TEXT,
    "source" "ChangeSource" NOT NULL DEFAULT 'UI',
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "due_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "done_at" TIMESTAMP(3),
    "verified_at" TIMESTAMP(3),
    "verified_by" UUID,
    "rating" INTEGER,
    "rating_comment" TEXT,
    "cancel_reason" TEXT,
    "overdue_notified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "service_order_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "service_catalog_item_tenant_id_active_category_idx" ON "service_catalog_item"("tenant_id", "active", "category");

-- CreateIndex
CREATE UNIQUE INDEX "service_catalog_item_tenant_id_code_key" ON "service_catalog_item"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "service_order_tenant_id_status_due_at_idx" ON "service_order"("tenant_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "service_order_tenant_id_unit_id_status_idx" ON "service_order"("tenant_id", "unit_id", "status");

-- CreateIndex
CREATE INDEX "service_order_tenant_id_owner_id_status_idx" ON "service_order"("tenant_id", "owner_id", "status");

-- CreateIndex
CREATE INDEX "service_order_tenant_id_catalog_item_id_idx" ON "service_order"("tenant_id", "catalog_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_order_tenant_id_number_key" ON "service_order"("tenant_id", "number");

-- AddForeignKey
ALTER TABLE "service_order" ADD CONSTRAINT "service_order_catalog_item_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "service_catalog_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_order" ADD CONSTRAINT "service_order_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

