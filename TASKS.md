# TASKS

Статусы: `[ ]` не начата · `[~]` в работе · `[x]` готова · `[!blocked]` заблокирована (причина обязательна).

## Phase A — Foundation
- [x] A-01 Monorepo: pnpm workspaces, apps/web, packages/{core,db,adapters,workers}, tsconfig strict, eslint, prettier, vitest, playwright, husky pre-commit
- [x] A-02 Docker Compose: postgres 16, redis, minio, mailhog; auth-mock по ADR-002; `make dev`; `scripts/dev-db.sh` для песочниц
- [x] A-03 Prisma schema §1–2 (Tenant … Sequence) + миграция с partial unique/CHECK из §8
- [x] A-04 AuditLog: append-only (DB-триггер), `withAudit()`, hash chain, `verifyAuditChain()` (BR-070/071)
- [~] A-05 Auth + TenantContext, middleware, tenant switcher, Repository c контекстом (BR-073)
- [ ] A-06 RBAC: Permission/RolePermission миграция, `requirePermission()`, permission test-генератор
- [ ] A-07 Sequences `PR-YYYY-NNNNNN` (D-24), конкурентный тест
- [ ] A-08 Money utils: `Money {minor, currency}`, UZS formatting, FX (D-08/09)
- [ ] A-09 i18n: next-intl, `ru.json` полный для Phase A экранов
- [ ] A-10 Базовый UI shell: layout, навигация по роли, tenant switcher, таблица/форма компоненты
- [ ] A-11 Seed Phase A (tenants, users, roles, cost centers, categories, holidays 2026)
- [ ] A-12 Admin экран для tenant settings, users, roles, cc/categories

## Phase B — Master data & P2P core
- [ ] B-01 Vendor CRUD + Vendor 360, bank accounts state machine, dual verify (BR-030–034)
- [ ] B-02 Contract CRUD + state machine + Contract 360 + `v_contract_balance` (BR-012, BR-026)
- [ ] B-03 Customer CRUD (минимум)
- [ ] B-04 Budget + `v_budget_status` + Budget экран (BR-014)
- [ ] B-05 ApprovalPolicy + policy engine (BR-041, D-12, BR-035/036/033)
- [ ] B-06 PurchaseRequest: форма, state machine, approvals, budget check, urgency (BR-042/043/044/045)
- [ ] B-07 PurchaseOrder + Receipt (BR-042)
- [ ] B-08 Invoice: create, Excel import, duplicate detection, match, Invoice Inbox (BR-002/004/024/025/037)
- [ ] B-09 Document + DocumentRequirement + S3 upload (BR-023)
- [ ] B-10 Task: модель, «Мои задачи», next_action, escalation
- [ ] B-11 Seed Phase B

## Phase C — Payments, batch, bank
- [ ] C-01 PaymentRequest + `run_controls()` + state machine (BR-001/003/010/011/013/020/021/050)
- [ ] C-02 Exceptions approve workflow
- [ ] C-03 Payment Desk экран
- [ ] C-04 PaymentBatch полный цикл + summary + cron freeze (BR-040/051/052/053/057)
- [ ] C-05 My Approvals экран (mobile)
- [ ] C-06 Bank import, auto-match, ReconciliationMatch, PAID только через match (BR-054/055/056)
- [ ] C-07 Advance: prepayment→closing task (BR-022/046), employee advance, corp card
- [ ] C-08 Urgent batch flow (BR-043)
- [ ] C-09 Seed Phase C
- [ ] C-10 Demo script `scripts/demo-p2p.md`

## Phase D — AP/AR, events, forecast, jobs
- [ ] D-01 `v_ap_aging`, AP экран, vendor statement reconciliation
- [ ] D-02 CustomerInvoice + AR aging + reminders job (BR-060)
- [ ] D-03 Event + fast lane + `v_event_pl` + Event P&L экран (BR-061/062)
- [ ] D-04 13-week cash forecast
- [ ] D-05 Workers: все repeatable jobs
- [ ] D-06 Telegram bot + NotificationAdapter + email fallback (BR-072)
- [ ] D-07 Budget vs actual отчёт
- [ ] D-08 Seed Phase D

## Phase E — Documents & adapters
- [ ] E-01 Document Health экран
- [ ] E-02 EdoAdapter mock полностью (BR-024 e2e)
- [ ] E-03 PosAdapter: три импортёра
- [ ] E-04 AccountingAdapter: export/import 1С
- [ ] E-05 Excel migration templates + импортёры
- [ ] E-06 Backdated/BR-025, POA, contract registration UI

## Phase F — Compliance, close, dashboards
- [ ] F-01 TaxCalendarRule + TaxObligation + Tax Calendar
- [ ] F-02 PayrollRun + BR-047
- [ ] F-03 Close Center + month-end pack
- [ ] F-04 Owner Dashboard (9 виджетов)
- [ ] F-05 Ops dashboard / Portfolio
- [ ] F-06 KPI + Controls экран
- [ ] F-07 Audit viewer с diff

## Phase G — Hardening
- [ ] G-01 Security review, secret scan CI, rate limiting, CSP
- [ ] G-02 Permission test suite + cross-tenant fuzz
- [ ] G-03 Acceptance tests AC-01…AC-22
- [ ] G-04 Performance 10k/50k seed, p95 < 500ms
- [ ] G-05 Backup/restore, docker-compose.prod, runbook
- [ ] G-06 Полный demo script
- [ ] G-07 Финальная сверка BR/экраны/controls/DECISIONS

## Блокеры
(пусто)
