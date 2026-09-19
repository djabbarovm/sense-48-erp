-- CreateEnum
CREATE TYPE "ManagementContractStatus" AS ENUM ('NONE', 'SENT', 'SIGNED', 'DECLINED');

-- CreateEnum
CREATE TYPE "HouseFundKind" AS ENUM ('OPERATIONS', 'MARKETING', 'CAPEX');

-- CreateEnum
CREATE TYPE "HouseBudgetCategory" AS ENUM ('ENGINEERING', 'LIFTS', 'FIRE_SAFETY', 'SECURITY', 'CLEANING', 'UTILITIES_COMMON', 'REPAIRS', 'MATERIALS', 'INSURANCE_LICENSES', 'ADMIN', 'OTHER');

-- AlterEnum
ALTER TYPE "ReconObjectType" ADD VALUE 'HOUSE_CHARGE';

-- AlterEnum
ALTER TYPE "TaskType" ADD VALUE 'HOUSE_CHARGE_OVERDUE';

-- AlterTable
ALTER TABLE "property_owner" ADD COLUMN     "management_contract_signed_at" DATE,
ADD COLUMN     "management_contract_status" "ManagementContractStatus" NOT NULL DEFAULT 'NONE';

-- AlterTable
ALTER TABLE "unit" ADD COLUMN     "cadastral_area_m2" DECIMAL(10,2),
ADD COLUMN     "cadastral_number" TEXT;

-- CreateTable
CREATE TABLE "house_fund" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "building_id" UUID,
    "kind" "HouseFundKind" NOT NULL DEFAULT 'OPERATIONS',
    "name" TEXT NOT NULL,
    "bank_account_id" UUID,
    "tariff_per_m2_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'UZS',
    "management_fee_bp" INTEGER,
    "due_day" INTEGER NOT NULL DEFAULT 15,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "tariff_approved_at" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "house_fund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "house_budget_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "fund_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "category" "HouseBudgetCategory" NOT NULL,
    "planned_minor" BIGINT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "house_budget_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "house_expense" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "fund_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "category" "HouseBudgetCategory" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'UZS',
    "contractor_name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "document_id" UUID,
    "payment_request_id" UUID,
    "work_order_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "house_expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "house_charge" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "fund_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "due_at" DATE NOT NULL,
    "area_m2" DECIMAL(10,2) NOT NULL,
    "pre_cadastre" BOOLEAN NOT NULL DEFAULT false,
    "tariff_minor" BIGINT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "received_minor" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "status" "RentChargeStatus" NOT NULL DEFAULT 'DUE',
    "paid_at" TIMESTAMP(3),
    "overdue_notified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "house_charge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "house_fund_tenant_id_active_idx" ON "house_fund"("tenant_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "house_budget_line_fund_id_year_category_key" ON "house_budget_line"("fund_id", "year", "category");

-- CreateIndex
CREATE INDEX "house_expense_tenant_id_fund_id_date_idx" ON "house_expense"("tenant_id", "fund_id", "date");

-- CreateIndex
CREATE INDEX "house_charge_tenant_id_status_due_at_idx" ON "house_charge"("tenant_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "house_charge_tenant_id_owner_id_status_idx" ON "house_charge"("tenant_id", "owner_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "house_charge_tenant_id_number_key" ON "house_charge"("tenant_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "house_charge_fund_id_unit_id_period_start_key" ON "house_charge"("fund_id", "unit_id", "period_start");

-- AddForeignKey
ALTER TABLE "house_budget_line" ADD CONSTRAINT "house_budget_line_fund_id_fkey" FOREIGN KEY ("fund_id") REFERENCES "house_fund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "house_expense" ADD CONSTRAINT "house_expense_fund_id_fkey" FOREIGN KEY ("fund_id") REFERENCES "house_fund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "house_charge" ADD CONSTRAINT "house_charge_fund_id_fkey" FOREIGN KEY ("fund_id") REFERENCES "house_fund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "house_charge" ADD CONSTRAINT "house_charge_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

