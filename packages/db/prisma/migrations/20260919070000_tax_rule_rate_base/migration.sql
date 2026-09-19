-- CreateEnum
CREATE TYPE "TaxBase" AS ENUM ('TURNOVER', 'PAYROLL');

-- AlterTable
ALTER TABLE "tax_calendar_rule" ADD COLUMN     "base_kind" "TaxBase",
ADD COLUMN     "note" TEXT,
ADD COLUMN     "rate_bp" INTEGER;

-- AlterTable
ALTER TABLE "tax_obligation" ADD COLUMN     "base_minor" BIGINT;

