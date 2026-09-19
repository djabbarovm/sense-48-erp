-- P-31: системный логин без обязательного email (сотрудники Tower авторизуются по логину + временный пароль, привязка Telegram)
ALTER TABLE "app_user" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "app_user" ADD COLUMN "username" TEXT;
CREATE UNIQUE INDEX "app_user_username_key" ON "app_user"("username");
