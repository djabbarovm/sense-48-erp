-- CreateTable
CREATE TABLE "counterparty_match_rule" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "pattern" TEXT NOT NULL,
    "purpose_pattern" TEXT,
    "counterparty_name" TEXT NOT NULL,
    "operation_type" TEXT,
    "expense_article" TEXT,
    "vendor_id" UUID,
    "source" TEXT NOT NULL DEFAULT 'ksp',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "counterparty_match_rule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "counterparty_match_rule_tenant_id_idx" ON "counterparty_match_rule"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "counterparty_match_rule_tenant_id_pattern_key" ON "counterparty_match_rule"("tenant_id", "pattern");
