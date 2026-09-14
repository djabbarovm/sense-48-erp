-- CreateEnum
CREATE TYPE "TaxType" AS ENUM ('VAT', 'PROFIT', 'PAYROLL_TAX', 'SOCIAL', 'PROPERTY', 'OTHER');

-- CreateEnum
CREATE TYPE "TaxObligationStatus" AS ENUM ('PLANNED', 'CALCULATED', 'APPROVED', 'PAID', 'FILED', 'OVERDUE');

-- CreateEnum
CREATE TYPE "PayrollRunStatus" AS ENUM ('DRAFT', 'CHECKED', 'APPROVED', 'PAID', 'POSTED');

-- AlterTable
ALTER TABLE "payment_request" ADD COLUMN     "onec_ref" TEXT;

-- CreateTable
CREATE TABLE "edo_mock_document" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "edo_document_id" TEXT NOT NULL,
    "status" "EdoStatus" NOT NULL DEFAULT 'SENT',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "edo_mock_document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_daily_sales" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "outlet" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "revenue_gross_minor" BIGINT NOT NULL,
    "vat_minor" BIGINT NOT NULL DEFAULT 0,
    "discounts_minor" BIGINT NOT NULL DEFAULT 0,
    "cost_of_sales_minor" BIGINT NOT NULL DEFAULT 0,
    "covers" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pos_daily_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_inventory_snapshot" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "outlet" TEXT NOT NULL,
    "stock_value_minor" BIGINT NOT NULL,
    "purchases_minor" BIGINT NOT NULL DEFAULT 0,
    "consumption_minor" BIGINT NOT NULL DEFAULT 0,
    "waste_minor" BIGINT NOT NULL DEFAULT 0,
    "transfers_minor" BIGINT NOT NULL DEFAULT 0,
    "theoretical_food_cost_minor" BIGINT NOT NULL DEFAULT 0,
    "actual_food_cost_minor" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pos_inventory_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_banquet_cost" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "iiko_order_id" TEXT NOT NULL,
    "event_id" UUID NOT NULL,
    "food_cost_minor" BIGINT NOT NULL DEFAULT 0,
    "beverage_cost_minor" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pos_banquet_cost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_mapping" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "account_code" TEXT NOT NULL,
    "vat_account_code" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_mapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_calendar_rule" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" "TaxType" NOT NULL,
    "name" TEXT NOT NULL,
    "recurrence" TEXT NOT NULL DEFAULT 'MONTHLY',
    "due_day" INTEGER NOT NULL,
    "expected_min_minor" BIGINT,
    "expected_max_minor" BIGINT,
    "owner_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_calendar_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_obligation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" "TaxType" NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "period" TEXT NOT NULL,
    "due_date" DATE NOT NULL,
    "expected_min_minor" BIGINT,
    "expected_max_minor" BIGINT,
    "calculated_minor" BIGINT,
    "owner_id" UUID,
    "payment_request_id" UUID,
    "filed_at" TIMESTAMP(3),
    "status" "TaxObligationStatus" NOT NULL DEFAULT 'PLANNED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "tax_obligation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_run" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "employee_count" INTEGER NOT NULL,
    "gross_minor" BIGINT NOT NULL,
    "net_minor" BIGINT NOT NULL,
    "taxes_minor" BIGINT NOT NULL,
    "register_document_id" UUID,
    "status" "PayrollRunStatus" NOT NULL DEFAULT 'DRAFT',
    "checked_against_active_list_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "payroll_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_snapshot" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kpi_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "edo_mock_document_tenant_id_edo_document_id_key" ON "edo_mock_document"("tenant_id", "edo_document_id");

-- CreateIndex
CREATE UNIQUE INDEX "pos_daily_sales_tenant_id_date_outlet_category_key" ON "pos_daily_sales"("tenant_id", "date", "outlet", "category");

-- CreateIndex
CREATE UNIQUE INDEX "pos_inventory_snapshot_tenant_id_date_outlet_key" ON "pos_inventory_snapshot"("tenant_id", "date", "outlet");

-- CreateIndex
CREATE INDEX "pos_banquet_cost_tenant_id_event_id_idx" ON "pos_banquet_cost"("tenant_id", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "pos_banquet_cost_tenant_id_iiko_order_id_key" ON "pos_banquet_cost"("tenant_id", "iiko_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "account_mapping_tenant_id_category_id_key" ON "account_mapping"("tenant_id", "category_id");

-- CreateIndex
CREATE INDEX "tax_obligation_tenant_id_status_idx" ON "tax_obligation"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tax_obligation_tenant_id_type_period_key" ON "tax_obligation"("tenant_id", "type", "period");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_run_tenant_id_period_key" ON "payroll_run"("tenant_id", "period");

-- CreateIndex
CREATE UNIQUE INDEX "kpi_snapshot_tenant_id_date_key" ON "kpi_snapshot"("tenant_id", "date");
