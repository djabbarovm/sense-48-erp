-- CreateEnum
CREATE TYPE "DealProduct" AS ENUM ('LEASE_LTR', 'LEASE_OFFICE', 'SALE', 'STR_MANDATE', 'PARKING_LEASE', 'PARKING_SALE', 'MALL_LEASE');

-- CreateEnum
CREATE TYPE "CommissionPayer" AS ENUM ('TENANT', 'OWNER', 'SELLER', 'DEVELOPER');

-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('ACCRUED', 'PARTIAL', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BonusKind" AS ENUM ('DEAL', 'KPI');

-- CreateEnum
CREATE TYPE "BonusStatus" AS ENUM ('POTENTIAL', 'CONFIRMED', 'PAYABLE', 'PAID', 'WITHHELD');

-- CreateEnum
CREATE TYPE "KpiChecklistItem" AS ENUM ('ONBOARDING', 'ACCESS_KEYS', 'INTERNET', 'CLEANING', 'HANDOVER_SERVICES');

-- AlterEnum
ALTER TYPE "ReconObjectType" ADD VALUE 'COMMISSION';

-- AlterTable
ALTER TABLE "deal" ADD COLUMN     "commission_rate_bp" INTEGER,
ADD COLUMN     "external_broker_name" TEXT,
ADD COLUMN     "external_share_bp" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "product" "DealProduct" NOT NULL DEFAULT 'LEASE_LTR',
ADD COLUMN     "sale_price_minor" BIGINT,
ADD COLUMN     "won_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "commission" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "deal_id" UUID NOT NULL,
    "unit_id" UUID,
    "product" "DealProduct" NOT NULL,
    "payer" "CommissionPayer" NOT NULL,
    "payer_name" TEXT NOT NULL,
    "base_minor" BIGINT NOT NULL,
    "rate_bp" INTEGER NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "external_broker_name" TEXT,
    "external_share_bp" INTEGER NOT NULL DEFAULT 0,
    "net_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "CommissionStatus" NOT NULL DEFAULT 'ACCRUED',
    "received_minor" BIGINT NOT NULL DEFAULT 0,
    "due_at" DATE NOT NULL,
    "paid_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_bonus" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "commission_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "kind" "BonusKind" NOT NULL,
    "rate_bp" INTEGER NOT NULL,
    "base_minor" BIGINT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "BonusStatus" NOT NULL DEFAULT 'POTENTIAL',
    "kpi_deadline" TIMESTAMP(3),
    "kpi_confirmed_at" TIMESTAMP(3),
    "kpi_confirmed_by" UUID,
    "payable_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "payout_period" TEXT,
    "payout_ref" TEXT,
    "withheld_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_bonus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_checklist_item" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "item" "KpiChecklistItem" NOT NULL,
    "done_at" TIMESTAMP(3),
    "done_by" UUID,
    "note" TEXT,

    CONSTRAINT "deal_checklist_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "commission_deal_id_key" ON "commission"("deal_id");

-- CreateIndex
CREATE INDEX "commission_tenant_id_status_due_at_idx" ON "commission"("tenant_id", "status", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "commission_tenant_id_number_key" ON "commission"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "sales_bonus_tenant_id_employee_id_status_idx" ON "sales_bonus"("tenant_id", "employee_id", "status");

-- CreateIndex
CREATE INDEX "sales_bonus_tenant_id_status_idx" ON "sales_bonus"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sales_bonus_commission_id_employee_id_kind_key" ON "sales_bonus"("commission_id", "employee_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "deal_checklist_item_deal_id_item_key" ON "deal_checklist_item"("deal_id", "item");

-- AddForeignKey
ALTER TABLE "commission" ADD CONSTRAINT "commission_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_bonus" ADD CONSTRAINT "sales_bonus_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_bonus" ADD CONSTRAINT "sales_bonus_commission_id_fkey" FOREIGN KEY ("commission_id") REFERENCES "commission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_checklist_item" ADD CONSTRAINT "deal_checklist_item_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

