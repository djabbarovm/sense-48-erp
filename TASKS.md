# TASKS

Статусы: `[ ]` не начата · `[~]` в работе · `[x]` готова · `[!blocked]` заблокирована (причина обязательна).

## Phase A — Foundation
- [x] A-01 Monorepo: pnpm workspaces, apps/web, packages/{core,db,adapters,workers}, tsconfig strict, eslint, prettier, vitest, playwright, husky pre-commit
- [x] A-02 Docker Compose: postgres 16, redis, minio, mailhog; auth-mock по ADR-002; `make dev`; `scripts/dev-db.sh` для песочниц
- [x] A-03 Prisma schema §1–2 (Tenant … Sequence) + миграция с partial unique/CHECK из §8
- [x] A-04 AuditLog: append-only (DB-триггер), `withAudit()`, hash chain, `verifyAuditChain()` (BR-070/071)
- [x] A-05 Auth (dev JWT, ADR-002) + TenantContext (брендированный тип, фабрика из UserTenantRole), login/logout/switch tenant, findScopedOr404 (BR-073)
- [x] A-06 RBAC: PERMISSION_MATRIX (77 кодов из docs/05), `requirePermission()`, syncPermissions в БД, параметризованные тесты 100% кодов × 7 ролей
- [x] A-07 Sequences `PR-YYYY-NNNNNN` без gaps (row lock, инкремент в транзакции объекта), конкурентный тест 25 параллельных
- [x] A-08 Money utils: bigint minor, formatMoney UZS, FX convert, splitGrossVat, parseDecimalToMinor; запрет float
- [x] A-09 i18n: next-intl, ru.json полный, uz/en fallback на ru, ESLint-правило против hardcoded строк в JSX
- [x] A-10 UI shell: Tailwind 4, базовые компоненты (Button/Input/Select/Table/Card/Badge), sidebar-навигация по правам, tenant switcher, Playwright smoke
- [x] A-11 Seed Phase A: 3 tenant, 11 users+roles, cost centers, 18 категорий, праздники 2026, permissions; идемпотентен
- [x] A-12 Admin экран: tenant settings, users+roles (grant/revoke), cost centers, categories; audit на каждую мутацию; e2e admin/404

## Phase B — Master data & P2P core
- [x] B-01 Vendor CRUD + Vendor 360, bank accounts state machine, dual verify (BR-030–034), reveal c audit (BR-074) Vendor CRUD + Vendor 360, bank accounts state machine, dual verify (BR-030–034)
- [x] B-02 Contract CRUD + state machine + Contract 360 + баланс (интерфейс v_contract_balance; paid/pending достраивается в C-01) + BR-026 Task-заглушка
- [x] B-03 Customer CRUD (минимум)
- [x] B-04 Budget + budget status + экран (BR-014; Excel-импорт бюджета — в E-05 вместе с остальными импортёрами)
- [x] B-05 ApprovalPolicy (версионируется) + policy engine computeRequiredApprovals (D-12 tiers, BR-033/035/036/041), table-driven тесты всех веток
- [x] B-06 PurchaseRequest: форма, state machine, approvals по слотам, budget check, urgency, fast lane (BR-042-045); экраны /pr, /approvals; e2e
- [x] B-07 PurchaseOrder + Receipt (BR-042: Tier 2+ приёмщик ≠ инициатор), PR → ORDERED/RECEIVED, UI на карточке PR
- [x] B-08 Invoice: create, XLSX-реестр импорт (EdoAdapter mock), дубликаты BR-002, match+suggestions, Invoice Inbox, BR-024/025/037
- [x] B-09 Document + DocumentRequirement + S3 upload (sha256, версии, signed URL; LocalFs-fallback ADR-005), mark_received, BR-023 checkRequiredDocs
- [x] B-10 Task: модель, переходы (cancel c причиной), «Мои задачи» c next_action, escalateOverdueTasks-заглушка
- [x] B-11 Seed Phase B: 30 vendors (флаги, RETIRED-счета, USD), 12 contracts, budgets 08-09 (перерасход RH-BAR), 14 PR всех статусов, 7 invoices + дубликат

## Phase C — Payments, batch, bank
- [x] C-01 PaymentRequest + run_controls() (17 control codes) + state machine до READY/ON_HOLD + балансы contract/invoice достроены
- [x] C-02 Exceptions: approve exception Owner/Lead c reason → re-run controls → READY; audit
- [x] C-03 Payment Desk экран (3 колонки, «Собрать batch», визард c preview контролей до submit) + экраны /batches и /batches/[id]
- [x] C-04 PaymentBatch полный цикл + summary (cash_after, by_*, exceptions, related party) + BR-040/051/052/053/057; cron freeze — в D-05
- [x] C-05 My Approvals экран (mobile): item-режим PR + batch-режим (summary, «Approve all green», toggle на красных)
- [x] C-06 Bank import (Unified CSV + Trustbank XLSX по реальной выписке), idempotency BR-056, auto-match BR-055, PAID только через match BR-054 (+DB-триггер), FAILED path, cash position + экран /bank (импорт, сверка, manual match/ignore, отказ банка)
- [x] C-07 Advance: BR-022 prepayment→Advance+CLOSING_DOCS (SLA раб. дни), BR-046 блок при OVERDUE (Owner override), закрытие частями, write-off Owner, overdue-job
- [x] C-08 Urgent batch flow (BR-043: только urgent, approve Owner/Lead, ITEM-approval, пост-review Task, U-нумерация)
- [x] C-09 Seed Phase C (счета, 20 платежей во всех статусах, 4 batch, транзакции matched/suggested/unmatched, advances, файл выписки)
- [x] C-10 Demo script `scripts/demo-p2p.md` — сквозной прогон PR → RECONCILED на seed. **Phase C завершена.**

## Phase D — AP/AR, events, forecast, jobs
- [x] D-01 `v_ap_aging`, AP экран, vendor statement reconciliation
- [x] D-02 CustomerInvoice + AR aging + reminders job (BR-060)
- [x] D-03 Event + fast lane + `v_event_pl` + Event P&L экран (BR-061/062)
- [x] D-04 13-week cash forecast
- [x] D-05 Workers: реестр из 9 идемпотентных джобов + BullMQ Job Scheduler (runTenantJobs для dev без Redis)
- [x] D-06 NotificationAdapter (Telegram HTTP + email fallback + mock/console, ADR-007), BR-072 secret-фильтр в core и сервисах
- [x] D-07 Budget vs actual отчёт (committed = PR без платежей + pending-платежи; actual = PAID по paid_at)
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
