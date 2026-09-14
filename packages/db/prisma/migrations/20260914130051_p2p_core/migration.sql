-- CreateEnum
CREATE TYPE "EventFormat" AS ENUM ('BANQUET', 'CONFERENCE', 'PRIVATE', 'PUBLIC');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'QUOTED', 'CONFIRMED', 'IN_PROGRESS', 'HELD', 'SETTLING', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PurchaseRequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ORDERED', 'RECEIVED', 'INVOICED', 'PAID', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BudgetCheckStatus" AS ENUM ('WITHIN', 'OVER', 'UNBUDGETED');

-- CreateEnum
CREATE TYPE "UrgencyReason" AS ENUM ('EVENT_72H', 'TAX_DEADLINE', 'SUPPLIER_STOP', 'SAFETY', 'OTHER');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PoStatus" AS ENUM ('DRAFT', 'SENT', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('PARTIAL', 'FULL', 'REJECTED');

-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('SF', 'INVOICE', 'ACT', 'WAYBILL');

-- CreateEnum
CREATE TYPE "EdoStatus" AS ENUM ('NONE', 'DRAFT', 'SENT', 'SIGNED', 'REJECTED', 'CANCELLED', 'CORRECTED');

-- CreateEnum
CREATE TYPE "InvoiceMatchStatus" AS ENUM ('UNMATCHED', 'SUGGESTED', 'MATCHED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('RECEIVED', 'DUPLICATE_SUSPECT', 'MATCHED', 'DISPUTED', 'PARTIALLY_PAID', 'PAID', 'CORRECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DocType" AS ENUM ('CONTRACT', 'AMENDMENT', 'SF', 'INVOICE', 'ACT', 'WAYBILL', 'POA', 'RECEIPT', 'KP', 'SPEC', 'MENU', 'BANK_CONFIRMATION', 'PAYROLL_REGISTER', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'RECEIVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('PREPAY', 'POSTPAY');

-- CreateEnum
CREATE TYPE "DocPhase" AS ENUM ('BEFORE_PAYMENT', 'AFTER_PAYMENT');

-- CreateTable
CREATE TABLE "budget" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "cost_center_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "planned_minor" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_policy" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "tier1_max_minor" BIGINT NOT NULL,
    "tier2_max_minor" BIGINT NOT NULL,
    "unbudgeted_requires_owner" BOOLEAN NOT NULL DEFAULT true,
    "urgent_approver_roles" TEXT[] DEFAULT ARRAY['OWNER', 'FINANCE_OPS_LEAD']::TEXT[],
    "new_vendor_owner_threshold_minor" BIGINT NOT NULL DEFAULT 0,
    "sod_min_tier" INTEGER NOT NULL DEFAULT 2,
    "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "approval_policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "customer_id" UUID,
    "name" TEXT NOT NULL,
    "event_date" DATE NOT NULL,
    "start_time" TEXT,
    "end_time" TEXT,
    "format" "EventFormat" NOT NULL DEFAULT 'PRIVATE',
    "guests_planned" INTEGER,
    "guests_actual" INTEGER,
    "revenue_budget_minor" BIGINT NOT NULL DEFAULT 0,
    "cost_budget_minor" BIGINT NOT NULL DEFAULT 0,
    "revenue_lines" JSONB NOT NULL DEFAULT '{}',
    "deposit_schedule" JSONB NOT NULL DEFAULT '[]',
    "cost_center_id" UUID,
    "owner_id" UUID,
    "status" "EventStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_budget_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "planned_minor" BIGINT NOT NULL,
    "approved_vendor_ids" UUID[] DEFAULT ARRAY[]::UUID[],

    CONSTRAINT "event_budget_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_request" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "requester_id" UUID NOT NULL,
    "what" TEXT NOT NULL,
    "quantity" DECIMAL(18,3),
    "unit" TEXT,
    "price_minor" BIGINT,
    "vat_minor" BIGINT NOT NULL DEFAULT 0,
    "total_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'UZS',
    "purpose" TEXT NOT NULL,
    "cost_center_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "event_id" UUID,
    "needed_by" TIMESTAMP(3),
    "vendor_id" UUID,
    "contract_id" UUID,
    "budget_status" "BudgetCheckStatus",
    "is_urgent" BOOLEAN NOT NULL DEFAULT false,
    "urgency_reason" "UrgencyReason",
    "urgency_note" TEXT,
    "is_fast_lane" BOOLEAN NOT NULL DEFAULT false,
    "status" "PurchaseRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "purchase_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_approval" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "pr_id" UUID NOT NULL,
    "approver_id" UUID,
    "role" TEXT NOT NULL,
    "decision" "ApprovalDecision",
    "comment" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "pr_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "contract_id" UUID,
    "lines" JSONB NOT NULL DEFAULT '[]',
    "total_minor" BIGINT NOT NULL,
    "status" "PoStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "purchase_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "po_id" UUID,
    "pr_id" UUID,
    "receiver_id" UUID NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lines" JSONB NOT NULL DEFAULT '[]',
    "evidence_document_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "status" "ReceiptStatus" NOT NULL DEFAULT 'FULL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "type" "InvoiceType" NOT NULL DEFAULT 'INVOICE',
    "amount_net_minor" BIGINT NOT NULL,
    "vat_minor" BIGINT NOT NULL DEFAULT 0,
    "amount_gross_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'UZS',
    "fx_rate" DECIMAL(18,6),
    "edo_document_id" TEXT,
    "edo_status" "EdoStatus" NOT NULL DEFAULT 'NONE',
    "is_corrective_of" UUID,
    "contract_id" UUID,
    "pr_id" UUID,
    "po_id" UUID,
    "receipt_id" UUID,
    "match_status" "InvoiceMatchStatus" NOT NULL DEFAULT 'UNMATCHED',
    "duplicate_of" UUID,
    "backdated_reason" TEXT,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'RECEIVED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "object_type" TEXT NOT NULL,
    "object_id" UUID NOT NULL,
    "doc_type" "DocType" NOT NULL,
    "file_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "edo_ref" TEXT,
    "edo_status" "EdoStatus",
    "uploaded_by" UUID,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_requirement" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "category_group" "CategoryGroup" NOT NULL,
    "payment_type" "PaymentKind" NOT NULL,
    "phase" "DocPhase" NOT NULL,
    "doc_types" "DocType"[],

    CONSTRAINT "document_requirement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "budget_tenant_id_period_cost_center_id_category_id_key" ON "budget"("tenant_id", "period", "cost_center_id", "category_id");

-- CreateIndex
CREATE INDEX "approval_policy_tenant_id_effective_from_idx" ON "approval_policy"("tenant_id", "effective_from");

-- CreateIndex
CREATE INDEX "event_tenant_id_status_idx" ON "event"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "event_tenant_id_number_key" ON "event"("tenant_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "event_budget_line_event_id_category_id_key" ON "event_budget_line"("event_id", "category_id");

-- CreateIndex
CREATE INDEX "purchase_request_tenant_id_status_idx" ON "purchase_request"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "purchase_request_tenant_id_requester_id_idx" ON "purchase_request"("tenant_id", "requester_id");

-- CreateIndex
CREATE INDEX "purchase_request_tenant_id_event_id_idx" ON "purchase_request"("tenant_id", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_request_tenant_id_number_key" ON "purchase_request"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "purchase_approval_tenant_id_pr_id_idx" ON "purchase_approval"("tenant_id", "pr_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_tenant_id_number_key" ON "purchase_order"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "receipt_tenant_id_pr_id_idx" ON "receipt"("tenant_id", "pr_id");

-- CreateIndex
CREATE INDEX "invoice_tenant_id_status_idx" ON "invoice"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "invoice_tenant_id_vendor_id_idx" ON "invoice"("tenant_id", "vendor_id");

-- CreateIndex
CREATE INDEX "document_tenant_id_object_type_object_id_idx" ON "document"("tenant_id", "object_type", "object_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_requirement_tenant_id_category_group_payment_type__key" ON "document_requirement"("tenant_id", "category_group", "payment_type", "phase");

-- AddForeignKey
ALTER TABLE "budget" ADD CONSTRAINT "budget_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget" ADD CONSTRAINT "budget_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_budget_line" ADD CONSTRAINT "event_budget_line_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_approval" ADD CONSTRAINT "purchase_approval_pr_id_fkey" FOREIGN KEY ("pr_id") REFERENCES "purchase_request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- BR-002/§8: дубликат Invoice по (tenant, vendor, number, date) блокируется, CANCELLED/DUPLICATE_SUSPECT вне индекса
CREATE UNIQUE INDEX "invoice_dedup_unique"
  ON "invoice" ("tenant_id", "vendor_id", "number", "date")
  WHERE status <> 'CANCELLED' AND status <> 'DUPLICATE_SUSPECT';
