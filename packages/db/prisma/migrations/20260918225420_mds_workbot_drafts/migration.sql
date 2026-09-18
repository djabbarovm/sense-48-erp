-- CreateEnum
CREATE TYPE "ActionDraftStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'REJECTED', 'FAILED', 'NEEDS_INFO');

-- CreateEnum
CREATE TYPE "ActionSource" AS ENUM ('WEB', 'TELEGRAM', 'API');

-- CreateTable
CREATE TABLE "action_draft" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "source" "ActionSource" NOT NULL DEFAULT 'WEB',
    "raw_text" TEXT NOT NULL,
    "kind" TEXT,
    "payload" JSONB NOT NULL,
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "unit_id" UUID,
    "status" "ActionDraftStatus" NOT NULL DEFAULT 'DRAFT',
    "preview" TEXT NOT NULL,
    "result_ref" TEXT,
    "error" TEXT,
    "created_by" UUID NOT NULL,
    "confirmed_by" UUID,
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "action_draft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "action_draft_tenant_id_status_created_at_idx" ON "action_draft"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "action_draft_tenant_id_created_by_idx" ON "action_draft"("tenant_id", "created_by");
