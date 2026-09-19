-- CreateTable
CREATE TABLE "deal_proposal" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "unit_ids" UUID[],
    "note" TEXT,
    "valid_until" TIMESTAMP(3),
    "views_count" INTEGER NOT NULL DEFAULT 0,
    "viewed_at" TIMESTAMP(3),
    "view_notified_at" TIMESTAMP(3),
    "viewing_requested_at" TIMESTAMP(3),
    "request_note" TEXT,
    "request_notified_at" TIMESTAMP(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_proposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "deal_proposal_token_key" ON "deal_proposal"("token");

-- CreateIndex
CREATE INDEX "deal_proposal_tenant_id_deal_id_idx" ON "deal_proposal"("tenant_id", "deal_id");

-- AddForeignKey
ALTER TABLE "deal_proposal" ADD CONSTRAINT "deal_proposal_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

