# CHANGELOG

Формат: `## [Phase X] YYYY-MM-DD` → список `- TASK-nnn: что сделано`.

## [Unreleased]

## [Phase A] 2026-09-14
- A-01: pnpm monorepo — apps/web (Next.js 15 + TS strict), packages/{core,db,adapters,workers}; eslint 9 (flat) + prettier + vitest 3 + Playwright + husky pre-commit (lint+typecheck). `pnpm install && pnpm build && pnpm test` зелёные.
- A-02: docker-compose.yml (postgres 16, redis 7, minio, mailhog), Makefile (`make dev`), `.env.example`, `scripts/dev-db.sh` (локальный PG для песочниц), ADR-001…004, README «Как запустить».
- A-03: Prisma 6 schema (17 таблиц §1–2 data model), миграция `init_master_data` + partial unique (vendor tax_id active, verified default bank account) и CHECK (contract counterparty, sequence), клиент-синглтон, интеграционные тесты constraints.
- A-04: audit_log (append-only DB-триггер + revoke), core: canonicalJson/computeDiffHash/verifyChain, db: writeAudit c advisory-lock per tenant, withAudit (атомарная мутация+аудит), verifyAuditChain; 7 тестов.
- A-05: core: TenantContext (branded) + доменные ошибки + HS256 JWT + scrypt-пароли; db: buildTenantContext/listUserTenants/findScopedOr404/whereTenant; web: login-страница, session cookie (8h), tenant switcher action. Cross-tenant → 404, 9 тестов.
- A-06: core PERMISSION_MATRIX (docs/05, 77 permission codes) + can/requirePermission; db syncPermissions (идемпотентный upsert Permission/RolePermission); 100% кодов покрыты параметризованными тестами allow/deny по всем 7 ролям.
