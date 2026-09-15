-- CreateEnum
CREATE TYPE "BusinessUnit" AS ENUM ('ROOFTOP', 'SENSE48');

-- AlterTable
ALTER TABLE "event" ADD COLUMN     "risk_note" TEXT;

-- CreateTable
CREATE TABLE "fixed_cost" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "unit" "BusinessUnit" NOT NULL,
    "period" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "fixed_cost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_norm" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "format" "EventFormat" NOT NULL,
    "cost_pct" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cost_norm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sense_daily_stat" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "visits_planned" INTEGER,
    "visits_actual" INTEGER,
    "revenue_minor" BIGINT NOT NULL DEFAULT 0,
    "load_pct" INTEGER,
    "cancellations" INTEGER NOT NULL DEFAULT 0,
    "memberships_sold" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "sense_daily_stat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fixed_cost_tenant_id_unit_period_name_key" ON "fixed_cost"("tenant_id", "unit", "period", "name");

-- CreateIndex
CREATE UNIQUE INDEX "cost_norm_tenant_id_format_key" ON "cost_norm"("tenant_id", "format");

-- CreateIndex
CREATE UNIQUE INDEX "sense_daily_stat_tenant_id_date_key" ON "sense_daily_stat"("tenant_id", "date");
