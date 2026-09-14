-- CreateEnum
CREATE TYPE "CustomerInvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'DISPUTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CashPlanType" AS ENUM ('LOAN_REPAYMENT', 'CAPEX', 'TAX', 'PAYROLL', 'OTHER');

-- CreateTable
CREATE TABLE "customer_invoice" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "customer_id" UUID NOT NULL,
    "contract_id" UUID,
    "event_id" UUID,
    "date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "amount_gross_minor" BIGINT NOT NULL,
    "vat_minor" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'UZS',
    "edo_status" "EdoStatus" NOT NULL DEFAULT 'NONE',
    "received_minor" BIGINT NOT NULL DEFAULT 0,
    "status" "CustomerInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "promise_to_pay_date" DATE,
    "dispute_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "customer_invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ar_reminder_log" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "customer_invoice_id" UUID NOT NULL,
    "offset_days" INTEGER NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "channel" TEXT NOT NULL DEFAULT 'TELEGRAM',

    CONSTRAINT "ar_reminder_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_plan_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CashPlanType" NOT NULL DEFAULT 'OTHER',
    "amount_minor" BIGINT NOT NULL,
    "due_date" DATE NOT NULL,
    "recurrence" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "cash_plan_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_forecast_snapshot" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "week_start" DATE NOT NULL,
    "forecast_minor" BIGINT NOT NULL,
    "actual_minor" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_forecast_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_invoice_tenant_id_status_idx" ON "customer_invoice"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "customer_invoice_tenant_id_customer_id_idx" ON "customer_invoice"("tenant_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_invoice_tenant_id_number_key" ON "customer_invoice"("tenant_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "ar_reminder_log_customer_invoice_id_offset_days_key" ON "ar_reminder_log"("customer_invoice_id", "offset_days");

-- CreateIndex
CREATE INDEX "cash_plan_line_tenant_id_due_date_idx" ON "cash_plan_line"("tenant_id", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "cash_forecast_snapshot_tenant_id_week_start_key" ON "cash_forecast_snapshot"("tenant_id", "week_start");

-- AddForeignKey
ALTER TABLE "ar_reminder_log" ADD CONSTRAINT "ar_reminder_log_customer_invoice_id_fkey" FOREIGN KEY ("customer_invoice_id") REFERENCES "customer_invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
