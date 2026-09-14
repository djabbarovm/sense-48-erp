-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "RoleCode" AS ENUM ('OWNER', 'FINANCE_OPS_LEAD', 'JUNIOR_FINANCE', 'DOCUMENT_CONTROLLER', 'ACCOUNTANT', 'REQUESTER', 'ADMIN');

-- CreateEnum
CREATE TYPE "VendorStatus" AS ENUM ('ACTIVE', 'BLOCKED', 'PENDING_VERIFICATION');

-- CreateEnum
CREATE TYPE "VendorBankAccountStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'RETIRED');

-- CreateEnum
CREATE TYPE "VerificationMethod" AS ENUM ('CALLBACK', 'DOCUMENT', 'DUAL_APPROVAL');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "CounterpartyType" AS ENUM ('VENDOR', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'SIGNED', 'REGISTERED', 'ACTIVE', 'AMENDING', 'EXPIRING', 'EXPIRED', 'TERMINATING', 'CLOSED');

-- CreateEnum
CREATE TYPE "AmendmentStatus" AS ENUM ('DRAFT', 'SIGNED');

-- CreateEnum
CREATE TYPE "CategoryGroup" AS ENUM ('FNB', 'SPA', 'CLEANING', 'MARKETING', 'PAYROLL', 'UTILITIES', 'RENT', 'CAPEX', 'TAX', 'ADMIN', 'OTHER');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('STAFF', 'GPH');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'TERMINATED');

-- CreateEnum
CREATE TYPE "DocFlagStatus" AS ENUM ('OK', 'MISSING', 'EXPIRED');

-- CreateEnum
CREATE TYPE "FxSource" AS ENUM ('CBU', 'MANUAL');

-- CreateTable
CREATE TABLE "tenant" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "legal_name" TEXT NOT NULL,
    "tax_id" TEXT NOT NULL,
    "base_currency" CHAR(3) NOT NULL DEFAULT 'UZS',
    "vat_rate_bp" INTEGER NOT NULL DEFAULT 1200,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Tashkent',
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_user" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "auth_provider_id" TEXT,
    "password_hash" TEXT,
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "telegram_chat_id" TEXT,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_tenant_role" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "role" "RoleCode" NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_tenant_role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permission" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permission" (
    "id" UUID NOT NULL,
    "role" "RoleCode" NOT NULL,
    "permission_id" UUID NOT NULL,

    CONSTRAINT "role_permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "tax_id" TEXT NOT NULL,
    "legal_name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "category_default_id" UUID,
    "vat_payer" BOOLEAN NOT NULL DEFAULT false,
    "status" "VendorStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "risk_flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "business_owner_id" UUID,
    "contact_name" TEXT,
    "contact_phone" TEXT,
    "contact_email" TEXT,
    "verified_callback_channel" TEXT,
    "requires_contract" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_bank_account" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "bank_name" TEXT NOT NULL,
    "mfo" TEXT NOT NULL,
    "account_masked" TEXT NOT NULL,
    "account_encrypted" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'UZS',
    "status" "VendorBankAccountStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "verified_at" TIMESTAMP(3),
    "verified_by" UUID,
    "verify_step1_by" UUID,
    "verify_step1_at" TIMESTAMP(3),
    "verification_method" "VerificationMethod",
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "vendor_bank_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "tax_id" TEXT,
    "legal_name" TEXT NOT NULL,
    "credit_limit_minor" BIGINT,
    "payment_terms_days" INTEGER NOT NULL DEFAULT 0,
    "ar_owner_id" UUID,
    "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "counterparty_type" "CounterpartyType" NOT NULL,
    "vendor_id" UUID,
    "customer_id" UUID,
    "subject" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'UZS',
    "fx_rate" DECIMAL(18,6),
    "limit_minor" BIGINT,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "auto_renew" BOOLEAN NOT NULL DEFAULT false,
    "payment_terms" JSONB NOT NULL DEFAULT '{}',
    "required_docs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "registration_required" BOOLEAN NOT NULL DEFAULT false,
    "registered_at" DATE,
    "owner_id" UUID,
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_amendment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "changes" JSONB NOT NULL DEFAULT '{}',
    "document_id" UUID,
    "status" "AmendmentStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "contract_amendment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_center" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parent_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "owner_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "cost_center_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "group" "CategoryGroup" NOT NULL,
    "budget_required" BOOLEAN NOT NULL DEFAULT false,
    "closing_doc_sla_days" INTEGER NOT NULL DEFAULT 10,
    "account_code" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "role_title" TEXT NOT NULL,
    "cost_center_id" UUID,
    "employment_type" "EmploymentType" NOT NULL DEFAULT 'STAFF',
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "terminated_at" DATE,
    "bank_card_status" "DocFlagStatus" NOT NULL DEFAULT 'OK',
    "passport_status" "DocFlagStatus" NOT NULL DEFAULT 'OK',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_account" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "bank_name" TEXT NOT NULL,
    "mfo" TEXT NOT NULL,
    "account_masked" TEXT NOT NULL,
    "account_encrypted" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'UZS',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "opening_balance_minor" BIGINT NOT NULL DEFAULT 0,
    "opening_balance_date" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "bank_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fx_rate" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "rate_to_uzs" DECIMAL(18,6) NOT NULL,
    "source" "FxSource" NOT NULL DEFAULT 'MANUAL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fx_rate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holiday" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "country" CHAR(2) NOT NULL DEFAULT 'UZ',

    CONSTRAINT "holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sequence" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "sequence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_slug_key" ON "tenant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user"("email");

-- CreateIndex
CREATE INDEX "user_tenant_role_tenant_id_idx" ON "user_tenant_role"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_tenant_role_user_id_tenant_id_role_key" ON "user_tenant_role"("user_id", "tenant_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "permission_code_key" ON "permission"("code");

-- CreateIndex
CREATE UNIQUE INDEX "role_permission_role_permission_id_key" ON "role_permission"("role", "permission_id");

-- CreateIndex
CREATE INDEX "vendor_tenant_id_tax_id_idx" ON "vendor"("tenant_id", "tax_id");

-- CreateIndex
CREATE INDEX "vendor_tenant_id_status_idx" ON "vendor"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "vendor_bank_account_tenant_id_idx" ON "vendor_bank_account"("tenant_id");

-- CreateIndex
CREATE INDEX "vendor_bank_account_vendor_id_status_idx" ON "vendor_bank_account"("vendor_id", "status");

-- CreateIndex
CREATE INDEX "customer_tenant_id_idx" ON "customer"("tenant_id");

-- CreateIndex
CREATE INDEX "contract_tenant_id_status_idx" ON "contract"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "contract_vendor_id_idx" ON "contract"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "contract_tenant_id_number_key" ON "contract"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "contract_amendment_tenant_id_idx" ON "contract_amendment"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "cost_center_tenant_id_code_key" ON "cost_center"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "category_tenant_id_code_key" ON "category"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "employee_tenant_id_status_idx" ON "employee"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "bank_account_tenant_id_idx" ON "bank_account"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "fx_rate_date_currency_key" ON "fx_rate"("date", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "holiday_date_country_key" ON "holiday"("date", "country");

-- CreateIndex
CREATE UNIQUE INDEX "sequence_tenant_id_key_year_key" ON "sequence"("tenant_id", "key", "year");

-- AddForeignKey
ALTER TABLE "user_tenant_role" ADD CONSTRAINT "user_tenant_role_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_tenant_role" ADD CONSTRAINT "user_tenant_role_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor" ADD CONSTRAINT "vendor_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor" ADD CONSTRAINT "vendor_category_default_id_fkey" FOREIGN KEY ("category_default_id") REFERENCES "category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bank_account" ADD CONSTRAINT "vendor_bank_account_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract" ADD CONSTRAINT "contract_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract" ADD CONSTRAINT "contract_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract" ADD CONSTRAINT "contract_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_amendment" ADD CONSTRAINT "contract_amendment_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_center" ADD CONSTRAINT "cost_center_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_center" ADD CONSTRAINT "cost_center_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "cost_center"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category" ADD CONSTRAINT "category_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_account" ADD CONSTRAINT "bank_account_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence" ADD CONSTRAINT "sequence_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Ограничения docs/02 §8, не выразимые в Prisma schema ──

-- BR-034: активный vendor с тем же ИНН в tenant запрещён (BLOCKED не мешает пере-созданию)
CREATE UNIQUE INDEX "vendor_tax_id_active_unique"
  ON "vendor" ("tenant_id", "tax_id")
  WHERE status <> 'BLOCKED';

-- Только одна VERIFIED default на (vendor, currency)
CREATE UNIQUE INDEX "vendor_bank_account_verified_default_unique"
  ON "vendor_bank_account" ("vendor_id", "currency")
  WHERE status = 'VERIFIED' AND "is_default";

-- Contract: ровно одна сторона, согласованная с counterparty_type
ALTER TABLE "contract" ADD CONSTRAINT "contract_counterparty_check" CHECK (
  ("counterparty_type" = 'VENDOR' AND "vendor_id" IS NOT NULL AND "customer_id" IS NULL) OR
  ("counterparty_type" = 'CUSTOMER' AND "customer_id" IS NOT NULL AND "vendor_id" IS NULL)
);

-- Sequence: значения строго положительные
ALTER TABLE "sequence" ADD CONSTRAINT "sequence_next_value_positive" CHECK ("next_value" >= 1);
