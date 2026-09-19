-- CreateEnum
CREATE TYPE "ServiceTerms" AS ENUM ('COMMISSION_PER_ORDER', 'REFERRAL_RECURRING', 'PACKAGE');

-- CreateEnum
CREATE TYPE "ServiceInvolvement" AS ENUM ('REFERRAL', 'MANAGED');

-- CreateEnum
CREATE TYPE "ServiceChannel" AS ENUM ('PORTAL', 'TELEGRAM', 'PHONE', 'APP', 'WALK_IN', 'STAFF');

-- CreateEnum
CREATE TYPE "ServiceCustomerKind" AS ENUM ('OWNER', 'RESIDENT', 'STR_GUEST', 'OFFICE_TENANT');

-- CreateEnum
CREATE TYPE "PackageStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CANCELLED');

-- AlterTable
ALTER TABLE "service_catalog_item" ADD COLUMN     "client_discount_bp" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "for_mall" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "involvement" "ServiceInvolvement" NOT NULL DEFAULT 'MANAGED',
ADD COLUMN     "own_ops_fee_bp" INTEGER,
ADD COLUMN     "terms" "ServiceTerms" NOT NULL DEFAULT 'COMMISSION_PER_ORDER';

-- AlterTable
ALTER TABLE "service_order" ADD COLUMN     "channel" "ServiceChannel" NOT NULL DEFAULT 'STAFF',
ADD COLUMN     "complaint" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "complaint_note" TEXT,
ADD COLUMN     "customer_kind" "ServiceCustomerKind",
ADD COLUMN     "executor_revenue_minor" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "handling_minutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "list_price_minor" BIGINT,
ADD COLUMN     "package_id" UUID,
ADD COLUMN     "services_revenue_minor" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "service_package" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "catalog_item_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "owner_id" UUID,
    "customer_name" TEXT,
    "customer_kind" "ServiceCustomerKind" NOT NULL DEFAULT 'RESIDENT',
    "channel" "ServiceChannel" NOT NULL DEFAULT 'STAFF',
    "runs_per_month" INTEGER NOT NULL,
    "monthly_price_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "PackageStatus" NOT NULL DEFAULT 'ACTIVE',
    "start_at" TIMESTAMP(3) NOT NULL,
    "next_run_at" TIMESTAMP(3) NOT NULL,
    "last_run_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_package_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_statement_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "partner_name" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "customer_ref" TEXT NOT NULL,
    "base_minor" BIGINT NOT NULL,
    "fee_bp" INTEGER NOT NULL,
    "fee_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'UZS',
    "imported_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_statement_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "service_package_tenant_id_status_next_run_at_idx" ON "service_package"("tenant_id", "status", "next_run_at");

-- CreateIndex
CREATE INDEX "partner_statement_line_tenant_id_period_idx" ON "partner_statement_line"("tenant_id", "period");

-- CreateIndex
CREATE UNIQUE INDEX "partner_statement_line_tenant_id_partner_name_period_custom_key" ON "partner_statement_line"("tenant_id", "partner_name", "period", "customer_ref");

-- AddForeignKey
ALTER TABLE "service_order" ADD CONSTRAINT "service_order_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "service_package"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_package" ADD CONSTRAINT "service_package_catalog_item_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "service_catalog_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

