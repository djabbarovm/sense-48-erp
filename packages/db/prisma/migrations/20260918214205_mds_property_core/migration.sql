-- CreateEnum
CREATE TYPE "BuildingKind" AS ENUM ('TOWER', 'OFFICES', 'MALL', 'MIXED');

-- CreateEnum
CREATE TYPE "UnitType" AS ENUM ('APARTMENT', 'OFFICE', 'RETAIL', 'PARKING', 'STORAGE', 'COMMON', 'TECHNICAL');

-- CreateEnum
CREATE TYPE "ReadinessStatus" AS ENUM ('READY', 'RENOVATION', 'FITOUT', 'FURNISHING', 'BLOCKED');

-- CreateEnum
CREATE TYPE "OccupancyStatus" AS ENUM ('VACANT', 'OCCUPIED', 'OWNER_USE', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "RentalMode" AS ENUM ('NONE', 'LTR', 'STR');

-- CreateEnum
CREATE TYPE "LeaseStatus" AS ENUM ('NONE', 'DRAFT', 'ACTIVE', 'EXPIRING', 'TERMINATED');

-- CreateEnum
CREATE TYPE "CommercialStatus" AS ENUM ('OFF_MARKET', 'AVAILABLE', 'RESERVED', 'VIEWING', 'NEGOTIATION', 'LOI', 'CONTRACTED');

-- CreateEnum
CREATE TYPE "OperationalStatus" AS ENUM ('NORMAL', 'ISSUE', 'CRITICAL', 'BLOCKED');

-- CreateEnum
CREATE TYPE "PropertyOwnerKind" AS ENUM ('PERSON', 'COMPANY');

-- CreateEnum
CREATE TYPE "UnitActivityKind" AS ENUM ('VIEWING', 'CALL', 'NOTE', 'FOLLOW_UP', 'OFFER');

-- CreateEnum
CREATE TYPE "ChangeSource" AS ENUM ('UI', 'API', 'IMPORT', 'AI');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RoleCode" ADD VALUE 'COMMERCIAL_MANAGER';
ALTER TYPE "RoleCode" ADD VALUE 'BROKER';
ALTER TYPE "RoleCode" ADD VALUE 'OPERATIONS_MANAGER';
ALTER TYPE "RoleCode" ADD VALUE 'MARKETING';

-- CreateTable
CREATE TABLE "building" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "BuildingKind" NOT NULL,
    "address" TEXT,
    "geometry_version" INTEGER NOT NULL DEFAULT 1,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "building_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "floor" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "building_id" UUID NOT NULL,
    "floor_no" INTEGER NOT NULL,
    "name" TEXT,
    "plan_view_box" TEXT NOT NULL DEFAULT '0 0 1000 600',
    "geometry_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "floor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_owner" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kind" "PropertyOwnerKind" NOT NULL,
    "display_name" TEXT NOT NULL,
    "contact_phone" TEXT,
    "contact_email" TEXT,
    "management_consent" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "property_owner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "building_id" UUID NOT NULL,
    "floor_id" UUID NOT NULL,
    "unit_no" TEXT NOT NULL,
    "type" "UnitType" NOT NULL,
    "area_m2" DECIMAL(10,2) NOT NULL,
    "geometry" JSONB,
    "owner_id" UUID,
    "occupant_name" TEXT,
    "readiness" "ReadinessStatus" NOT NULL DEFAULT 'READY',
    "occupancy" "OccupancyStatus" NOT NULL DEFAULT 'VACANT',
    "rental_mode" "RentalMode" NOT NULL DEFAULT 'NONE',
    "lease_status" "LeaseStatus" NOT NULL DEFAULT 'NONE',
    "commercial_status" "CommercialStatus" NOT NULL DEFAULT 'OFF_MARKET',
    "operational_status" "OperationalStatus" NOT NULL DEFAULT 'NORMAL',
    "status_effective_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vacant_since" DATE,
    "lease_ends_at" DATE,
    "asking_currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "asking_rate_minor" BIGINT,
    "min_approved_rate_minor" BIGINT,
    "monthly_rent_minor" BIGINT,
    "sale_price_minor" BIGINT,
    "managed_by_platform" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit_activity" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "kind" "UnitActivityKind" NOT NULL,
    "note" TEXT NOT NULL,
    "expected_rate_minor" BIGINT,
    "follow_up_at" DATE,
    "source" "ChangeSource" NOT NULL DEFAULT 'UI',
    "actor_id" UUID NOT NULL,
    "happened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unit_activity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "building_tenant_id_code_key" ON "building"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "floor_tenant_id_building_id_idx" ON "floor"("tenant_id", "building_id");

-- CreateIndex
CREATE UNIQUE INDEX "floor_building_id_floor_no_key" ON "floor"("building_id", "floor_no");

-- CreateIndex
CREATE INDEX "property_owner_tenant_id_display_name_idx" ON "property_owner"("tenant_id", "display_name");

-- CreateIndex
CREATE INDEX "unit_tenant_id_building_id_idx" ON "unit"("tenant_id", "building_id");

-- CreateIndex
CREATE INDEX "unit_tenant_id_occupancy_readiness_idx" ON "unit"("tenant_id", "occupancy", "readiness");

-- CreateIndex
CREATE INDEX "unit_tenant_id_owner_id_idx" ON "unit"("tenant_id", "owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "unit_building_id_unit_no_key" ON "unit"("building_id", "unit_no");

-- CreateIndex
CREATE INDEX "unit_activity_tenant_id_unit_id_happened_at_idx" ON "unit_activity"("tenant_id", "unit_id", "happened_at");

-- AddForeignKey
ALTER TABLE "floor" ADD CONSTRAINT "floor_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit" ADD CONSTRAINT "unit_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit" ADD CONSTRAINT "unit_floor_id_fkey" FOREIGN KEY ("floor_id") REFERENCES "floor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit" ADD CONSTRAINT "unit_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "property_owner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_activity" ADD CONSTRAINT "unit_activity_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
