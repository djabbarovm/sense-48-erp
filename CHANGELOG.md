# CHANGELOG

Формат: `## [Phase X] YYYY-MM-DD` → список `- TASK-nnn: что сделано`.

## [Unreleased]

## [Phase B] 2026-09-14
- B-01: vendor-сервис (create PENDING+NEW, update, verify c SOD, block/unblock OWNER, BR-034 dup tax_id), bank accounts: change → новая UNVERIFIED + RETIRED старой + флаг BANK_CHANGED_RECENTLY + Task VERIFY_BANK (BR-030), dual verify c SOD (BR-032), AES-256-GCM шифрование счёта, reveal только по праву c audit (BR-074); экраны /vendors и Vendor 360; 10 интеграционных тестов + e2e полного цикла.

## [Phase A] 2026-09-14 — завершена: monorepo, инфраструктура, схема master data, audit, auth/RBAC/tenant isolation, sequences, money, i18n, UI shell, seed, admin
- A-01: pnpm monorepo — apps/web (Next.js 15 + TS strict), packages/{core,db,adapters,workers}; eslint 9 (flat) + prettier + vitest 3 + Playwright + husky pre-commit (lint+typecheck). `pnpm install && pnpm build && pnpm test` зелёные.
- A-02: docker-compose.yml (postgres 16, redis 7, minio, mailhog), Makefile (`make dev`), `.env.example`, `scripts/dev-db.sh` (локальный PG для песочниц), ADR-001…004, README «Как запустить».
- A-03: Prisma 6 schema (17 таблиц §1–2 data model), миграция `init_master_data` + partial unique (vendor tax_id active, verified default bank account) и CHECK (contract counterparty, sequence), клиент-синглтон, интеграционные тесты constraints.
- A-04: audit_log (append-only DB-триггер + revoke), core: canonicalJson/computeDiffHash/verifyChain, db: writeAudit c advisory-lock per tenant, withAudit (атомарная мутация+аудит), verifyAuditChain; 7 тестов.
- A-05: core: TenantContext (branded) + доменные ошибки + HS256 JWT + scrypt-пароли; db: buildTenantContext/listUserTenants/findScopedOr404/whereTenant; web: login-страница, session cookie (8h), tenant switcher action. Cross-tenant → 404, 9 тестов.
- A-06: core PERMISSION_MATRIX (docs/05, 77 permission codes) + can/requirePermission; db syncPermissions (идемпотентный upsert Permission/RolePermission); 100% кодов покрыты параметризованными тестами allow/deny по всем 7 ролям.
- A-07: nextNumber/nextSequenceValue (INSERT..ON CONFLICT row-lock, gapless в транзакции объекта), batchNumber по дате; тесты: 25 конкурентных без дублей/пропусков, rollback без gap.
- A-08: core Money (bigint minor units), addMoney/subtractMoney/compareMoney, divRoundHalfUp, convertToBase (курс 18,6), splitGrossVat (D-10), parseDecimalToMinor (CSV), formatMoney `12 500 000 сум`; float отклоняется.
- A-09: next-intl (locale из cookie, ru default, deep-merge fallback), словарь ru.json (common/auth/nav/home/admin), login и home переведены, lint-правило JSXText/JSXAttribute против кириллицы в коде.
- A-10: Tailwind 4 + components/ui (shadcn-стиль), authenticated layout (app) с sidebar по PERMISSION_MATRIX, header c tenant switcher и logout, home-страница, Playwright smoke (redirect на /login).
- A-11: seed Phase A (tenants rooftop-hall/sense48/ordo, 11 пользователей c ролями и dev-паролем, cost centers c owner, 18 категорий с SLA и счетами 1С, праздники УЗ 2026, syncPermissions); e2e login-тесты на seed-пользователях.
- A-12: admin-сервис (updateTenantSettings, grant/revokeRole, upsertCostCenter/Category — все через withAudit и requirePermission), экран /admin (4 секции), e2e: admin видит данные, не-admin получает 404. Phase A завершена.
