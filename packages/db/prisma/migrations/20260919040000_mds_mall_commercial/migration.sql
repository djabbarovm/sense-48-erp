-- CreateEnum
CREATE TYPE "TenantCategory" AS ENUM ('FASHION', 'FOOD_BEVERAGE', 'GROCERY', 'SERVICES', 'BEAUTY_HEALTH', 'ELECTRONICS', 'KIDS', 'SPORTS', 'ENTERTAINMENT', 'HOME', 'OTHER');

-- CreateEnum
CREATE TYPE "MandateStatus" AS ENUM ('DRAFT', 'SIGNED', 'ACTIVE', 'TERMINATED');

-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('MEDIA', 'ISLAND', 'PARKING', 'PARTNERSHIP');

-- CreateEnum
CREATE TYPE "AssetContractStatus" AS ENUM ('ACTIVE', 'ENDED');

-- AlterTable
ALTER TABLE "deal" ADD COLUMN     "tenant_category" "TenantCategory";

-- AlterTable
ALTER TABLE "lease_contract" ADD COLUMN     "tenant_category" "TenantCategory";

-- CreateTable
CREATE TABLE "mall_mandate" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "status" "MandateStatus" NOT NULL DEFAULT 'DRAFT',
    "fee_bp" INTEGER,
    "success_fee_months" DECIMAL(4,2),
    "fee_published" BOOLEAN NOT NULL DEFAULT false,
    "pricing_delegated" BOOLEAN NOT NULL DEFAULT true,
    "signed_at" DATE,
    "start_at" DATE,
    "end_at" DATE,
    "terminated_at" TIMESTAMP(3),
    "terminated_reason" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "mall_mandate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commercial_asset" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "building_id" UUID NOT NULL,
    "kind" "AssetKind" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "tariff_minor" BIGINT,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commercial_asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_contract" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "counterparty_name" TEXT NOT NULL,
    "monthly_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "start_at" DATE NOT NULL,
    "end_at" DATE,
    "status" "AssetContractStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_contract_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mall_mandate_tenant_id_status_idx" ON "mall_mandate"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "mall_mandate_tenant_id_unit_id_status_idx" ON "mall_mandate"("tenant_id", "unit_id", "status");

-- CreateIndex
CREATE INDEX "commercial_asset_tenant_id_building_id_kind_idx" ON "commercial_asset"("tenant_id", "building_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "commercial_asset_tenant_id_code_key" ON "commercial_asset"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "asset_contract_tenant_id_asset_id_status_idx" ON "asset_contract"("tenant_id", "asset_id", "status");

-- AddForeignKey
ALTER TABLE "mall_mandate" ADD CONSTRAINT "mall_mandate_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mall_mandate" ADD CONSTRAINT "mall_mandate_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "property_owner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_contract" ADD CONSTRAINT "asset_contract_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "commercial_asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

