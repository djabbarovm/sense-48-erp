# MDS

Copyright (c) 2026 Murad Djabbarov. Проприетарное ПО, все права защищены — см. `LICENSE` и `docs/17-ip-ownership.md`.

Платформа владельца из двух модулей (ADR-016): **Finance OS** — Finance Operations для бизнесов; **MDS Property** — Property Core и «Живое здание» для управления недвижимостью (`docs/20-mds-property.md`).

## MDS Property (Phase P)

После `pnpm seed` доступен демо-тенант «Piramit Tower (демо)»: 3 здания, 30 этажей, 230 юнитов. Пользователи (пароль как в docs/10): `owner@piramit.test` (OWNER), `commercial@piramit.test` (COMMERCIAL_MANAGER), `broker@piramit.test` (BROKER), `ops@piramit.test` (OPERATIONS_MANAGER), `marketing@piramit.test` (MARKETING), `admin@piramit.test` (ADMIN), `finance@piramit.test` (FINANCE_OPS_LEAD). Экраны: `/property` (Building View: KPI, фильтры, 2.5D фасад) → `/property/floors/[id]` (план этажа) → `/property/units/[id]` (карточка юнита, смена статуса по правам, аудит). Цвет юнита вычисляется из полей (`packages/core/src/property`), не хранится. Wave 2: `/deals` (воронка сделок, стадия юнита — из сделок), `/leases` (договоры аренды — источник истины занятости), `/admin/api-keys` + `GET /api/property/public/inventory` (заголовок `X-Api-Key`, только опубликованные юниты без персональных данных). Импорт инвентаря и планов этажей — экран «Миграция данных».

## Finance OS

Multi-tenant Finance Operations platform. Спецификация — `CLAUDE.md` + `docs/`. Мастер-промпт для Claude Code — `MASTER_PROMPT.md`.

## Как запустить приложение (dev)

Требования: Node ≥ 22, pnpm 10, Docker (или локальный PostgreSQL 16 — см. ниже).

```bash
pnpm install
cp .env.example .env          # заполнить BANK_DATA_KEY, AUTH_JWT_SECRET (openssl rand -base64 32)
make dev                      # docker compose: postgres 16, redis, minio, mailhog
pnpm --filter @finance-os/db migrate:dev   # миграции (с Phase A-03)
pnpm seed                     # сид-данные (с Phase A-11)
pnpm --filter web dev         # http://localhost:3000
```

Без Docker (песочница/CI): `scripts/dev-db.sh start` поднимает локальный PostgreSQL 16 на :5432.

Проверки: `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm test:e2e`.

Сервисы dev-инфраструктуры: Postgres `localhost:5432` (finance/finance/finance_os) · Redis `:6379` · MinIO `:9000` (консоль `:9001`) · MailHog UI `:8025`.

## Как запустить разработку с Claude Code

1. `claude` в корне репозитория; спецификация читается из `CLAUDE.md` и `docs/`.
2. Продолжение работы после перерыва — «продолжай по TASKS.md».

## Структура

```
apps/web           Next.js 15 (UI + Server Actions + Route Handlers)
packages/core      Domain: entities, state machines, business rules, policy engine
packages/db        Prisma schema, migrations, seed
packages/adapters  bank/ didox/ iiko/ onec/ telegram/ — interfaces + mocks + importers
packages/workers   BullMQ jobs
docs/              Спецификация (source of truth)
templates/         Excel-шаблоны миграции
TASKS.md DECISIONS.md CHANGELOG.md   рабочие журналы
```

## Продакшн-развёртывание (G-05, runbook)

1. Сервер: Linux, Docker + docker compose, 2+ CPU / 4+ GB RAM. Домен + reverse proxy c TLS (nginx/caddy) на `127.0.0.1:3000`.
2. Секреты: скопируйте `.env.example` → `.env.prod`, заполните `POSTGRES_PASSWORD`, `AUTH_JWT_SECRET` (openssl rand -base64 48), `BANK_DATA_KEY` (openssl rand -base64 32), `MINIO_*`, при необходимости `TELEGRAM_BOT_TOKEN`. Файл не коммитится (secret-scan в CI это проверяет).
3. Запуск: `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build`. Миграции применяются автоматически при старте web (`prisma migrate deploy`).
4. Первичные данные: `docker compose -f docker-compose.prod.yml exec web pnpm --filter @finance-os/db seed` (синтетика для теста) — либо сразу «Миграция данных» в UI (шаблоны Excel).
5. Бэкапы: сервис `backup` делает ежедневный `pg_dump -Fc` в `./backups` c ротацией 30 дней; вручную — `./scripts/backup.sh`. Восстановление — `./scripts/restore.sh <dump>` (останавливайте web/workers). MinIO-том (`miniodata`) бэкапится средствами сервера.
6. Обновление версии: `git pull && docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build` — миграции применятся сами; откат — restore вчерашнего дампа + checkout предыдущего тега.
### CRM Tower: бот, телефония, мобильная версия (P-23…P-28)

- **Telegram-бот сотрудников.** В `.env.prod`: `TELEGRAM_BOT_TOKEN` (из @BotFather), `TELEGRAM_WEBHOOK_SECRET` (`openssl rand -hex 16`), `TELEGRAM_BOT_USERNAME` (без @), `APP_URL` (публичный https-адрес). После запуска один раз зарегистрируйте webhook: `curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" -d "url=$APP_URL/api/telegram/webhook" -d "secret_token=$TELEGRAM_WEBHOOK_SECRET" -d 'allowed_updates=["message","callback_query"]'`. Сотрудник подключает чат сам: «Мой день» → «Подключить Telegram». Дайджесты 08:30 / 19:00 и напоминания шлёт сервис `workers` — он должен работать вместе c web (в `docker-compose.prod.yml` уже есть).
- **Телефония.** Провайдер (Sipuni / OnlinePBX / Zadarma) шлёт события на `POST $APP_URL/api/telephony/webhook` c заголовком `X-Api-Key` (ключ co scope TELEPHONY создаётся в «Администрирование → API-ключи»); формат тела — docs/07 §8. Сопоставление внутренних номеров c сотрудниками — `tenant.settings.telephony_ext_map`.
- **Мобильная версия.** PWA: на телефоне откройте `$APP_URL/me` → «Добавить на экран „Домой“». Менеджеры и колл-центр стартуют c «Мой день».
- **Vercel + Neon (альтернатива VPS).** Web: импорт репозитория в Vercel, Root Directory `apps/web`, Build `pnpm -r build`, env как в `.env.prod` + `DATABASE_URL` из Neon (pooled) и `DIRECT_URL` при необходимости; миграции — `pnpm --filter @finance-os/db migrate:deploy` в Build Command перед `next build`. Workers (BullMQ + Redis) на Vercel не живут — их запускать отдельно (Railway / Fly / VPS) c теми же env и `REDIS_URL`. MinIO заменяется S3-совместимым хранилищем (`S3_*` в env). Публичные ссылки КП `/p/<token>` и webhooks не требуют входа.

7. Мониторинг здоровья: экран «KPI и контроли» + джоб `audit-verify` (падение = SECURITY_ALERT владельцу); логи — `docker compose logs -f web workers`.
