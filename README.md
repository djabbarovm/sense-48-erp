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
