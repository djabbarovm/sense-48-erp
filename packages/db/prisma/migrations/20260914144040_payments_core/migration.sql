-- CreateEnum
CREATE TYPE "PaymentSourceType" AS ENUM ('PR', 'CONTRACT', 'INVOICE', 'TAX_OBLIGATION', 'PAYROLL_RUN', 'ADVANCE', 'LOAN', 'BANK_FEE');

-- CreateEnum
CREATE TYPE "PaymentRequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'DOCS_CHECK', 'ON_HOLD', 'READY_FOR_BATCH', 'IN_BATCH', 'APPROVED', 'REJECTED', 'SENT_TO_BANK', 'PAID', 'FAILED', 'RECONCILED', 'CLOSED', 'CANCELLED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "PaymentExceptionType" AS ENUM ('OVER_OUTSTANDING', 'NO_CONTRACT', 'NO_RECEIPT', 'UNVERIFIED_BANK', 'UNBUDGETED');

-- CreateEnum
CREATE TYPE "BatchType" AS ENUM ('STANDARD', 'URGENT');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('OPEN', 'FROZEN', 'REVIEWED', 'APPROVED', 'PARTIALLY_APPROVED', 'EXPORTED', 'SENT', 'SETTLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BatchApprovalScope" AS ENUM ('BATCH', 'ITEM');

-- CreateEnum
CREATE TYPE "TxMatchStatus" AS ENUM ('UNMATCHED', 'AUTO_MATCHED', 'MANUAL_MATCHED', 'SUGGESTED', 'IGNORED');

-- CreateEnum
CREATE TYPE "ReconObjectType" AS ENUM ('PAYMENT_REQUEST', 'AR_INVOICE', 'ADVANCE', 'TAX', 'PAYROLL', 'OTHER');

-- CreateEnum
CREATE TYPE "ReconMethod" AS ENUM ('AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "AdvanceType" AS ENUM ('EMPLOYEE_ADVANCE', 'VENDOR_PREPAYMENT', 'CORP_CARD');

-- CreateEnum
CREATE TYPE "AdvanceStatus" AS ENUM ('OPEN', 'PARTIALLY_CLOSED', 'CLOSED', 'OVERDUE', 'WRITTEN_OFF');

-- CreateTable
CREATE TABLE "payment_request" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "source_type" "PaymentSourceType" NOT NULL,
    "source_id" UUID NOT NULL,
    "vendor_id" UUID,
    "vendor_bank_account_id" UUID,
    "requested_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'UZS',
    "fx_rate" DECIMAL(18,6),
    "purpose_category" TEXT,
    "purpose_note" TEXT NOT NULL DEFAULT '',
    "cost_center_id" UUID,
    "category_id" UUID,
    "event_id" UUID,
    "due_date" DATE,
    "is_prepayment" BOOLEAN NOT NULL DEFAULT false,
    "is_urgent" BOOLEAN NOT NULL DEFAULT false,
    "urgency_reason" "UrgencyReason",
    "exception_type" "PaymentExceptionType",
    "exception_reason" TEXT,
    "exception_approved_by" UUID,
    "controls_result" JSONB NOT NULL DEFAULT '[]',
    "tier" INTEGER,
    "batch_id" UUID,
    "bank_transaction_id" UUID,
    "paid_at" TIMESTAMP(3),
    "status" "PaymentRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "prepared_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "payment_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_batch" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "type" "BatchType" NOT NULL DEFAULT 'STANDARD',
    "batch_date" DATE NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "total_minor" BIGINT NOT NULL DEFAULT 0,
    "count" INTEGER NOT NULL DEFAULT 0,
    "cutoff_at" TIMESTAMP(3),
    "frozen_by" UUID,
    "reviewed_by" UUID,
    "status" "BatchStatus" NOT NULL DEFAULT 'OPEN',
    "summary" JSONB NOT NULL DEFAULT '{}',
    "export_file_document_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "payment_batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch_approval" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "approver_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "scope" "BatchApprovalScope" NOT NULL DEFAULT 'BATCH',
    "payment_request_id" UUID,
    "decision" "ApprovalDecision" NOT NULL,
    "comment" TEXT,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "batch_approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_transaction" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "external_id" TEXT NOT NULL,
    "booking_date" DATE NOT NULL,
    "value_date" DATE NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'UZS',
    "counterparty_name" TEXT NOT NULL,
    "counterparty_tax_id" TEXT,
    "counterparty_account_masked" TEXT,
    "purpose_text" TEXT NOT NULL DEFAULT '',
    "import_batch_id" UUID,
    "match_status" "TxMatchStatus" NOT NULL DEFAULT 'UNMATCHED',
    "raw" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_match" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "bank_transaction_id" UUID NOT NULL,
    "object_type" "ReconObjectType" NOT NULL,
    "object_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "matched_by" UUID,
    "method" "ReconMethod" NOT NULL,
    "confidence" DECIMAL(4,3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advance" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" "AdvanceType" NOT NULL,
    "employee_id" UUID,
    "vendor_id" UUID,
    "payment_request_id" UUID,
    "amount_minor" BIGINT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT '',
    "event_id" UUID,
    "cost_center_id" UUID,
    "due_docs_date" DATE,
    "closed_minor" BIGINT NOT NULL DEFAULT 0,
    "returned_minor" BIGINT NOT NULL DEFAULT 0,
    "status" "AdvanceStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "advance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_request_tenant_id_status_idx" ON "payment_request"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "payment_request_tenant_id_source_type_source_id_idx" ON "payment_request"("tenant_id", "source_type", "source_id");

-- CreateIndex
CREATE INDEX "payment_request_tenant_id_vendor_id_idx" ON "payment_request"("tenant_id", "vendor_id");

-- CreateIndex
CREATE INDEX "payment_request_tenant_id_batch_id_idx" ON "payment_request"("tenant_id", "batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_request_tenant_id_number_key" ON "payment_request"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "payment_batch_tenant_id_status_idx" ON "payment_batch"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_batch_tenant_id_number_key" ON "payment_batch"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "batch_approval_tenant_id_batch_id_idx" ON "batch_approval"("tenant_id", "batch_id");

-- CreateIndex
CREATE INDEX "bank_transaction_tenant_id_match_status_idx" ON "bank_transaction"("tenant_id", "match_status");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transaction_bank_account_id_external_id_key" ON "bank_transaction"("bank_account_id", "external_id");

-- CreateIndex
CREATE INDEX "reconciliation_match_tenant_id_object_type_object_id_idx" ON "reconciliation_match"("tenant_id", "object_type", "object_id");

-- CreateIndex
CREATE INDEX "advance_tenant_id_status_idx" ON "advance"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "advance_tenant_id_employee_id_idx" ON "advance"("tenant_id", "employee_id");

-- AddForeignKey
ALTER TABLE "payment_request" ADD CONSTRAINT "payment_request_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "payment_batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_approval" ADD CONSTRAINT "batch_approval_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "payment_batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_match" ADD CONSTRAINT "reconciliation_match_bank_transaction_id_fkey" FOREIGN KEY ("bank_transaction_id") REFERENCES "bank_transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- BR-054 / docs/02 §8: PAID/RECONCILED/CLOSED невозможны без bank_transaction_id (DB-триггер)
CREATE OR REPLACE FUNCTION payment_request_paid_requires_bank() RETURNS trigger AS $$
BEGIN
  IF NEW.status IN ('PAID', 'RECONCILED', 'CLOSED') AND NEW.bank_transaction_id IS NULL THEN
    RAISE EXCEPTION 'PAID_REQUIRES_BANK_CONFIRMATION (BR-054): status % without bank_transaction_id', NEW.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payment_request_paid_guard
  BEFORE INSERT OR UPDATE ON "payment_request"
  FOR EACH ROW EXECUTE FUNCTION payment_request_paid_requires_bank();

-- BR-005: сумма matches по транзакции ≤ |amount| — проверяется в core; здесь базовый CHECK
ALTER TABLE "reconciliation_match" ADD CONSTRAINT "recon_amount_positive" CHECK ("amount_minor" > 0);

-- Advance: closed + returned <= amount (docs/02 §8)
ALTER TABLE "advance" ADD CONSTRAINT "advance_closed_within_amount"
  CHECK ("closed_minor" + "returned_minor" <= "amount_minor");
