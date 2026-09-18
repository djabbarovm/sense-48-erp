-- CreateEnum
CREATE TYPE "LeaseType" AS ENUM ('LTR', 'STR', 'OWNER_USE');

-- CreateEnum
CREATE TYPE "LeaseContractStatus" AS ENUM ('DRAFT', 'ACTIVE', 'EXPIRING', 'TERMINATED');

-- CreateEnum
CREATE TYPE "DealStage" AS ENUM ('NEW', 'QUALIFIED', 'PROPERTY_SELECTED', 'VIEWING', 'OFFER', 'NEGOTIATION', 'LOI', 'CONTRACT', 'MOVE_IN', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "DealSource" AS ENUM ('WEBSITE', 'TELEGRAM', 'INSTAGRAM', 'REFERRAL', 'BROKER', 'WALK_IN', 'OTHER');

-- CreateEnum
CREATE TYPE "DealLostReason" AS ENUM ('PRICE', 'TIMING', 'LOCATION', 'COMPETITOR', 'NO_RESPONSE', 'OTHER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TaskType" ADD VALUE 'LEASE_EXPIRY';
ALTER TYPE "TaskType" ADD VALUE 'DEAL_FOLLOWUP';

-- DropForeignKey
ALTER TABLE "unit_activity" DROP CONSTRAINT "unit_activity_unit_id_fkey";

-- AlterTable
ALTER TABLE "unit_activity" ADD COLUMN     "deal_id" UUID,
ALTER COLUMN "unit_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "lease_contract" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "owner_id" UUID,
    "deal_id" UUID,
    "type" "LeaseType" NOT NULL,
    "occupant_name" TEXT NOT NULL,
    "occupant_contact" TEXT,
    "start_at" DATE NOT NULL,
    "end_at" DATE,
    "rent_minor" BIGINT NOT NULL,
    "deposit_minor" BIGINT,
    "deposit_received" BOOLEAN NOT NULL DEFAULT false,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "status" "LeaseContractStatus" NOT NULL DEFAULT 'DRAFT',
    "terminated_at" TIMESTAMP(3),
    "terminated_reason" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "lease_contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "contact_name" TEXT NOT NULL,
    "contact_phone" TEXT,
    "contact_email" TEXT,
    "company" TEXT,
    "source" "DealSource" NOT NULL DEFAULT 'OTHER',
    "utm" JSONB,
    "budget_minor" BIGINT,
    "area_min_m2" DECIMAL(10,2),
    "area_max_m2" DECIMAL(10,2),
    "purpose" TEXT,
    "timing" TEXT,
    "unit_id" UUID,
    "alternative_unit_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "manager_id" UUID NOT NULL,
    "stage" "DealStage" NOT NULL DEFAULT 'NEW',
    "stage_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "next_action" TEXT,
    "next_action_at" DATE,
    "expected_rate_minor" BIGINT,
    "reserved_until" DATE,
    "deposit_received" BOOLEAN NOT NULL DEFAULT false,
    "lost_reason" "DealLostReason",
    "lost_note" TEXT,
    "won_lease_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "deal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "domain_event" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "object_type" TEXT NOT NULL,
    "object_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "domain_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_key" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "api_key_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lease_contract_tenant_id_unit_id_status_idx" ON "lease_contract"("tenant_id", "unit_id", "status");

-- CreateIndex
CREATE INDEX "lease_contract_tenant_id_status_end_at_idx" ON "lease_contract"("tenant_id", "status", "end_at");

-- CreateIndex
CREATE INDEX "deal_tenant_id_stage_idx" ON "deal"("tenant_id", "stage");

-- CreateIndex
CREATE INDEX "deal_tenant_id_manager_id_stage_idx" ON "deal"("tenant_id", "manager_id", "stage");

-- CreateIndex
CREATE INDEX "deal_tenant_id_unit_id_idx" ON "deal"("tenant_id", "unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "deal_tenant_id_number_key" ON "deal"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "domain_event_tenant_id_delivered_at_created_at_idx" ON "domain_event"("tenant_id", "delivered_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "api_key_key_hash_key" ON "api_key"("key_hash");

-- CreateIndex
CREATE INDEX "api_key_tenant_id_revoked_at_idx" ON "api_key"("tenant_id", "revoked_at");

-- CreateIndex
CREATE INDEX "unit_activity_tenant_id_deal_id_happened_at_idx" ON "unit_activity"("tenant_id", "deal_id", "happened_at");

-- AddForeignKey
ALTER TABLE "unit_activity" ADD CONSTRAINT "unit_activity_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_activity" ADD CONSTRAINT "unit_activity_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lease_contract" ADD CONSTRAINT "lease_contract_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal" ADD CONSTRAINT "deal_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Один действующий договор на юнит (docs/20 §11.1)
CREATE UNIQUE INDEX "lease_contract_one_active_per_unit" ON "lease_contract"("unit_id") WHERE "status" IN ('ACTIVE', 'EXPIRING');
