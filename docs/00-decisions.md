# 00 — Зафиксированные решения

Эти решения приняты владельцем продукта и не подлежат пересмотру без записи в `DECISIONS.md` с обоснованием. Claude Code опирается на них как на данность.

## Стек и инфраструктура

| # | Решение | Детали |
|---|---|---|
| D-01 | Web: Next.js 15 App Router + TypeScript strict | Server Actions для мутаций, Route Handlers для webhooks/import. UI: Tailwind + shadcn/ui. Формы: react-hook-form + zod. |
| D-02 | Backend: modular monolith в том же репо | Никакого отдельного API-сервиса. `packages/core` — доменный слой без зависимостей от Next/Prisma; `packages/db` — Prisma 5 + PostgreSQL 16. |
| D-03 | Auth: Supabase Auth | Email+password, TOTP MFA обязателен для ролей Owner / Finance Ops Lead / Admin. В dev — локальный Supabase через docker-compose. RBAC — собственные таблицы `Role`, `Permission`, `UserTenantRole`. |
| D-04 | Файлы: S3-compatible | MinIO в docker-compose. Signed URLs (15 мин), версии, sha256 hash в `Document`. Никаких файлов на локальном диске. |
| D-05 | Очереди: BullMQ + Redis | Все scheduled jobs и адаптеры — в `packages/workers`. n8n НЕ входит в MVP; Telegram-уведомления отправляет worker напрямую. |
| D-06 | Деплой: Docker Compose на одном VPS | `docker-compose.yml` (dev) и `docker-compose.prod.yml`. Nginx + certbot. Бэкап Postgres — pg_dump cron в S3. |

## Локализация и деньги

| # | Решение | Детали |
|---|---|---|
| D-07 | UI язык: RU по умолчанию | Все строки через `next-intl`, словари `ru.json` (полный), `uz.json`, `en.json` (могут быть частичными — fallback на ru). |
| D-08 | Валюты | Базовая валюта tenant — UZS. Договор может быть в USD/EUR; при создании обязательства фиксируется курс ЦБ РУз на дату документа (поле `fx_rate`, источник — ручной ввод + таблица `FxRate` с импортом CSV). Все отчёты — в базовой валюте. |
| D-09 | Хранение сумм | `BIGINT` в тийинах (1 UZS = 100 тийин). Для USD/EUR — в центах. Никаких float/decimal в БД для денег. Форматирование в UI: `12 500 000 сум`. |
| D-10 | НДС | Ставка — параметр tenant (`vat_rate`, default 12%). Invoice хранит `amount_net`, `vat_amount`, `amount_gross`. Vendor имеет `vat_payer: boolean`. |
| D-11 | Часовой пояс и календарь | `Asia/Tashkent` для всех tenant пилота. Рабочие дни Пн–Пт; таблица `Holiday` с impor-том праздников РУз. SLA считаются в рабочих днях. |

## Политики и роли

| # | Решение | Детали |
|---|---|---|
| D-12 | Approval thresholds (стартовые, per-tenant параметры) | Tier 1: ≤ 5 000 000 UZS — Business Owner approve, Finance check, Owner не участвует. Tier 2: 5–25 млн — + Owner approve. Tier 3: > 25 млн или unbudgeted — + Owner approve + обязательный `variance_reason`. Хранятся в `ApprovalPolicy` и редактируются Admin. |
| D-13 | Payment batch | Cutoff standard 14:00 Asia/Tashkent. Один batch в день на tenant. Urgent вне батча — `urgency_reason` (enum) + отдельный approval Owner/Lead. Целевой KPI: urgent < 10% по количеству. |
| D-14 | Роли (7) | `OWNER`, `FINANCE_OPS_LEAD`, `JUNIOR_FINANCE`, `DOCUMENT_CONTROLLER`, `ACCOUNTANT`, `REQUESTER`, `ADMIN`. Детали — `docs/05-rbac.md`. Один пользователь может иметь разные роли в разных tenant. |
| D-15 | SLA закрывающих документов после prepayment | Goods: 5 рабочих дней после ожидаемой поставки. Services: 10 рабочих дней после даты оказания. Rent: до 10-го числа следующего месяца. Настраивается per category. |
| D-16 | Segregation of duties | Requester ≠ Receiver ≠ Payment preparer ≠ Final approver для сумм Tier 2+. Для Tier 1 допускается Requester = Receiver. Система блокирует, не предупреждает. |

## Интеграции (MVP = моки + файловые импортёры)

| # | Решение | Детали |
|---|---|---|
| D-17 | Банк | Импорт выписки: унифицированный CSV/XLSX (`docs/07-integrations.md` §1). Экспорт batch: CSV по унифицированной схеме. Реальные форматы Trustbank/DIBank — отдельные адаптеры позже; интерфейс `BankAdapter` не должен зависеть от банка. |
| D-18 | Didox / ЭДО | `EdoAdapter` interface + `MockEdoAdapter` + импорт Excel-реестра СФ. Статусы документов из Didox (draft/sent/signed/rejected/cancelled) маппятся в `Document.edo_status`. |
| D-19 | iiko | `PosAdapter` interface + mock, принимающий CSV агрегатов: daily sales, consumption, stock value, banquet mapping. Никакой построчной синхронизации рецептур в MVP. |
| D-20 | 1С | Односторонний экспорт проводок в CSV по маппингу `Category → account_code` (таблица `AccountMapping`). Импорт обратно — только статус «posted» по ключу `payment_request_id`. |
| D-21 | Telegram | Реальный бот (grammY). Отправляет только: счётчики («7 платежей ждут approval»), deep links, escalation. Никаких сумм, названий вендоров, реквизитов в сообщениях. Bot token — только в env. |

## Данные

| # | Решение | Детали |
|---|---|---|
| D-22 | Seed | 3 tenant: `rooftop-hall`, `sense48`, `ordo`. ~30 vendors, ~10 contracts, 3 events, 2 месяца операций, все статусы state machine представлены. Спека — `docs/10-seed-data.md`. |
| D-23 | Миграция | Excel-шаблоны в `/templates`: vendors, contracts, open_ap, open_ar, employees. Импортёр с валидацией и отчётом об ошибках, без частичной загрузки (all-or-nothing per file). |
| D-24 | Идентификаторы | Внутренние — UUID v7. Человекочитаемые номера per tenant: `PR-2026-000123`, `PAY-2026-000045`, `BATCH-2026-09-14`, `INV-…`, `EVT-…`. Последовательности в БД, без пропусков. |
