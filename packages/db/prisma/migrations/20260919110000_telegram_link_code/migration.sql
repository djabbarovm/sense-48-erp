-- AlterTable
ALTER TABLE "app_user" ADD COLUMN     "telegram_link_code" TEXT,
ADD COLUMN     "telegram_linked_at" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "app_user_telegram_link_code_key" ON "app_user"("telegram_link_code");

