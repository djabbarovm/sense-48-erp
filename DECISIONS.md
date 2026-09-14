# DECISIONS (ADR log)

Решения, принятые владельцем продукта, — в `docs/00-decisions.md` (D-01…D-24). Здесь Claude Code фиксирует свои решения по ходу разработки.

## ADR-001: Prisma 6 вместо Prisma 5
**Дата:** 2026-09-14 · **Фаза/задача:** A-01/A-03
**Контекст:** D-02 фиксирует «Prisma 5 + PostgreSQL 16». Prisma 5 — устаревшая major-версия; Prisma 6 — текущая стабильная с тем же API уровня schema/client и лучшей поддержкой Node 22.
**Решение:** Использовать Prisma 6.x. Schema-синтаксис и клиентский API совместимы с D-02 по существу (декларативная schema, миграции, PostgreSQL 16).
**Последствия:** Нет известных потерь функциональности; при возврате на 5.x достаточно даунгрейда зависимости.

## ADR-002: Dev-auth — собственный JWT-мок с интерфейсом под Supabase
**Дата:** 2026-09-14 · **Фаза/задача:** A-02/A-05
**Контекст:** D-03 требует Supabase Auth; A-02 допускает «supabase-auth или packages/auth-mock с JWT для dev — решить и записать ADR». Полный self-hosted Supabase (GoTrue+Kong+Studio) тяжёл для dev/CI и не добавляет ценности до продакшена.
**Решение:** Реализовать `AuthProvider` interface в core (verifyToken → {userId, email}) с двумя реализациями: `DevJwtAuthProvider` (HS256, секрет `AUTH_JWT_SECRET`, форма claims совместима с Supabase: `sub`, `email`) и заготовка `SupabaseAuthProvider` (проверка JWT Supabase по JWKS/секрету) для продакшена. Email+password логин в dev — против таблицы `User` с bcrypt-хэшем (только dev-пароли из seed). MFA-поля моделируются (`mfa_enabled`), enforcement — на уровне политики ролей.
**Последствия:** Переход на реальный Supabase = замена провайдера + миграция пользователей; RBAC и TenantContext не меняются, т.к. живут в собственных таблицах (D-03).

## ADR-003: Тестовая БД — локальный PostgreSQL, docker compose — канонический dev-контур
**Дата:** 2026-09-14 · **Фаза/задача:** A-02
**Контекст:** Разработка идёт в песочнице, где docker-демон может быть недоступен/медленен, а PostgreSQL 16 установлен нативно.
**Решение:** `docker-compose.yml` — канонический способ поднять dev-инфраструктуру (postgres, redis, minio, mailhog). Для интеграционных тестов и песочниц добавлен `scripts/dev-db.sh`, запускающий локальный кластер PostgreSQL 16 (initdb в `/var/lib/finance-os-pg`, trust auth, только localhost). Тесты берут `DATABASE_URL` из env и не зависят от способа запуска БД.
**Последствия:** Один и тот же тестовый код работает в compose-окружении и в песочнице. Trust-auth допустим только для localhost dev; в prod — только пароль/TLS.

## ADR-004: MailHog для dev SMTP
**Дата:** 2026-09-14 · **Фаза/задача:** A-02
**Контекст:** A-02 перечисляет mailhog; email fallback появится в Phase D.
**Решение:** MailHog в compose (SMTP 1025, UI 8025); nodemailer в Phase D шлёт туда в dev.
**Последствия:** Письма в dev видны в web-интерфейсе, реальный SMTP — только в prod env.

## ADR-005: StorageAdapter c LocalFs-fallback для dev
**Дата:** 2026-09-14 · **Фаза/задача:** B-09
**Контекст:** D-04 требует S3-совместимое хранилище (MinIO в compose). В песочнице/CI MinIO может быть недоступен.
**Решение:** `StorageAdapter` interface в packages/adapters: `S3Storage` (aws-sdk v3, forcePathStyle для MinIO, signed URL 15 мин) — прод/dev c compose; `LocalFsStorage` — фолбэк для песочниц и юнит-тестов (`createStorageFromEnv` выбирает по env S3_*). Метаданные, sha256 и версии — всегда в таблице Document.
**Последствия:** Тесты не требуют MinIO; смена бэкенда хранения не трогает домен.

## ADR-006: Кто закрывает событие при BR-061 override
**Дата:** 2026-09-14 · **Фаза/задача:** D-03
**Контекст:** docs/05 даёт `event.close` только FINANCE_OPS_LEAD, а BR-061 разрешает закрытие с блокерами «Owner с reason». Owner формально не имеет `event.close`.
**Решение:** Обычное закрытие (без блокеров) — только Lead. Owner допускается к триггеру close исключительно как носитель override: guard BR-061 пропускает блокеры только при `isOwner && reason`. Матрица прав не расширяется.
**Последствия:** Lead не может закрыть событие с блокерами даже с reason (эскалация Owner'у); аудит фиксирует reason в `event.close`.

## ADR-007: Telegram-уведомления — HTTP-адаптер + mock вместо grammY-бота в dev
**Дата:** 2026-09-14 · **Фаза/задача:** D-06
**Контекст:** docs/07 §5 описывает grammY-бот c линковкой chat_id через `/start <code>`. CLAUDE.md фиксирует: реальных API в разработке нет, все внешние системы — adapter interfaces + mock.
**Решение:** В packages/adapters: `NotificationAdapter` interface + тексты шаблонов (без сумм и контрагентов), `MockNotificationAdapter` (тесты), `ConsoleNotificationAdapter` (dev), `TelegramNotificationAdapter` (HTTP Bot API, токен из env, chat_id через резолвер → User.telegramChatId), `EmailNotificationAdapter` (инжектируемый SMTP-транспорт → MailHog/nodemailer) и `FallbackNotificationAdapter` (Telegram → email). Долгоживущий bot-процесс c `/start`-линковкой и командами `/help`/`/mute` подключается при внедрении на сервере клиента.
**Последствия:** Джобы и сервисы не знают о канале доставки; включение реального бота — конфигурация, не код. BR-072 соблюдён на уровне шаблонов (в параметрах нет сумм).
