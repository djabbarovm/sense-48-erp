-- CreateEnum
CREATE TYPE "RentChargeStatus" AS ENUM ('DUE', 'PARTIAL', 'OVERDUE', 'PAID', 'WAIVED');

-- AlterEnum
ALTER TYPE "ReconObjectType" ADD VALUE 'RENT_CHARGE';

-- AlterEnum
ALTER TYPE "TaskType" ADD VALUE 'RENT_OVERDUE';

-- CreateTable
CREATE TABLE "rent_charge" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "lease_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "owner_id" UUID,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "due_at" DATE NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "received_minor" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "prorated" BOOLEAN NOT NULL DEFAULT false,
    "status" "RentChargeStatus" NOT NULL DEFAULT 'DUE',
    "paid_at" TIMESTAMP(3),
    "waived_reason" TEXT,
    "overdue_notified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rent_charge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rent_charge_tenant_id_status_due_at_idx" ON "rent_charge"("tenant_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "rent_charge_tenant_id_unit_id_status_idx" ON "rent_charge"("tenant_id", "unit_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "rent_charge_tenant_id_number_key" ON "rent_charge"("tenant_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "rent_charge_lease_id_period_start_key" ON "rent_charge"("lease_id", "period_start");

-- AddForeignKey
ALTER TABLE "rent_charge" ADD CONSTRAINT "rent_charge_lease_id_fkey" FOREIGN KEY ("lease_id") REFERENCES "lease_contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rent_charge" ADD CONSTRAINT "rent_charge_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

