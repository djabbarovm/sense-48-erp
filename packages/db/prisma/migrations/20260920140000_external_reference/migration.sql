-- amoCRM/внешние интеграции: стабильные ссылки + идемпотентность (READ-ONLY sync). Аддитивно.
-- Откат: DROP TABLE "external_reference"; DROP TYPE "ExternalRefStatus"; DROP TYPE "ExternalProvider";
CREATE TYPE "ExternalProvider" AS ENUM ('AMOCRM');
CREATE TYPE "ExternalRefStatus" AS ENUM ('LINKED', 'IMPORTED', 'CONFLICT', 'NEEDS_REVIEW');

CREATE TABLE "external_reference" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "provider" "ExternalProvider" NOT NULL,
    "account" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "dms_type" TEXT,
    "dms_id" UUID,
    "status" "ExternalRefStatus" NOT NULL DEFAULT 'IMPORTED',
    "raw" JSONB,
    "note" TEXT,
    "source_created_at" TIMESTAMP(3),
    "source_updated_at" TIMESTAMP(3),
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "external_reference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "external_reference_tenant_id_provider_entity_type_external_id_key" ON "external_reference"("tenant_id", "provider", "entity_type", "external_id");
CREATE INDEX "external_reference_tenant_id_provider_entity_type_idx" ON "external_reference"("tenant_id", "provider", "entity_type");
CREATE INDEX "external_reference_tenant_id_dms_type_dms_id_idx" ON "external_reference"("tenant_id", "dms_type", "dms_id");
CREATE INDEX "external_reference_tenant_id_status_idx" ON "external_reference"("tenant_id", "status");
