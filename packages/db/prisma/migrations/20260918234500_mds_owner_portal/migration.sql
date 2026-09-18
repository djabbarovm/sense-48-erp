-- P-15b Owner Portal: роль PROPERTY_OWNER, согласия и привязка учётки собственника (docs/20 §11.6)
-- AlterEnum
ALTER TYPE "RoleCode" ADD VALUE 'PROPERTY_OWNER';

-- AlterTable
ALTER TABLE "property_owner" ADD COLUMN     "consent_updated_at" TIMESTAMP(3),
ADD COLUMN     "listing_consent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "marketing_consent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "user_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "property_owner_tenant_id_user_id_key" ON "property_owner"("tenant_id", "user_id");

