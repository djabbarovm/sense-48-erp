# Finance OS

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
7. Мониторинг здоровья: экран «KPI и контроли» + джоб `audit-verify` (падение = SECURITY_ALERT владельцу); логи — `docker compose logs -f web workers`.
