# 08 — Фазы и задачи

Каждая задача: ID, описание, DoD. Claude Code копирует список в `TASKS.md` при старте и ведёт статусы `[ ] / [~] / [x] / [!blocked]`. Порядок внутри фазы — рекомендуемый; фазы — строго последовательно.

## Phase A — Foundation

- **A-01** Monorepo: pnpm workspaces, `apps/web`, `packages/{core,db,adapters,workers}`, tsconfig strict, eslint, prettier, vitest, playwright, husky pre-commit (lint+typecheck). DoD: `pnpm install && pnpm build && pnpm test` зелёные на пустом проекте.
- **A-02** Docker Compose: postgres 16, redis, minio, supabase-auth (или `packages/auth-mock` с JWT для dev — решить и записать ADR), mailhog. `make dev` поднимает всё. DoD: README с командами.
- **A-03** Prisma schema по `docs/02` §1–2 (Tenant, User, UserTenantRole, Permission, RolePermission, Vendor, VendorBankAccount, Customer, Contract, ContractAmendment, CostCenter, Category, Employee, BankAccount, FxRate, Holiday, Sequence). Миграция. DoD: миграция применяется с нуля; unique/check constraints из §8.
- **A-04** AuditLog: таблица, append-only grants, `withAudit()` helper в core, hash chain (BR-070/071). DoD: тест — мутация без audit невозможна через core; тест цепочки.
- **A-05** Auth + TenantContext: login, MFA-ready, middleware строит `TenantContext`, переключатель tenant, `Repository<T>` требует context (BR-073). DoD: cross-tenant тест 404.
- **A-06** RBAC: миграция Permission/RolePermission из `docs/05`; `requirePermission()`; permission test-генератор по матрице. DoD: 100% permission codes покрыты.
- **A-07** Sequences `PR-YYYY-NNNNNN` и др. (D-24). DoD: конкурентный тест без дублей.
- **A-08** Money utils: `Money {minor, currency}`, форматирование UZS, FX conversion (D-08/09). DoD: unit-тесты, запрет float.
- **A-09** i18n: next-intl, `ru.json` полный для Phase A экранов. DoD: нет hardcoded строк (lint rule).
- **A-10** Базовый UI shell: layout, навигация по роли, tenant switcher, таблица/форма компоненты (shadcn). DoD: Playwright smoke.
- **A-11** Seed Phase A (tenants, users, roles, cost centers, categories, holidays 2026) по `docs/10`. DoD: `pnpm seed`.
- **A-12** Admin экран (§17 screens) для tenant settings, users, roles, cc/categories.

## Phase B — Master data & P2P core

- **B-01** Vendor CRUD + Vendor 360 (без payments-таба). BR-034, BR-030/031/032 (bank accounts state machine, dual verify). Task VERIFY_BANK. DoD: тесты BR-030–034.
- **B-02** Contract CRUD + state machine + Contract 360 + `v_contract_balance`. BR-012, BR-026 (expiry job в Phase D — здесь Task-заглушка). DoD: тесты.
- **B-03** Customer CRUD (минимум).
- **B-04** Budget таблица + `v_budget_status` + Budget экран (plan edit, Excel import). BR-014.
- **B-05** ApprovalPolicy + policy engine (`computeRequiredApprovals(pr|payment) → Approval[]`). BR-041, tiers D-12, BR-035/036/033. DoD: table-driven unit tests на все ветки.
- **B-06** PurchaseRequest: форма (mobile), state machine, approvals, budget check, urgency, Task. Экран PR + карточка. BR-042/043/044/045. DoD: e2e create→submit→approve.
- **B-07** PurchaseOrder + Receipt (BR-042).
- **B-08** Invoice: create, Excel-реестр import (EdoAdapter mock), duplicate detection (BR-002), match suggestions, Invoice Inbox, `v_invoice_balance`. BR-004/024/025/037. DoD: тесты дубликатов и corrective.
- **B-09** Document + DocumentRequirement + upload в S3 (signed URL, sha256, версии) + `document.mark_received`. BR-023 базовая проверка.
- **B-10** Task: модель, «Мои задачи», next_action, escalation поле (job — Phase D).
- **B-11** Seed Phase B: vendors, contracts, budgets, PR/PO/Receipt/Invoice в разных статусах.

## Phase C — Payments, batch, bank

- **C-01** PaymentRequest: визард создания из PR/Invoice/Contract, `run_controls()` возвращающий `controls_result` (все коды: NO_SOURCE, DUP_PAYMENT_SUSPECT, OVER_OUTSTANDING, CONTRACT_LIMIT, CONTRACT_EXPIRED, NO_PR, NO_CONTRACT, NO_RECEIPT, INVOICE_UNMATCHED, MISSING_DOC:*, UNVERIFIED_BANK, UNBUDGETED, SOD_VIOLATION, RELATED_PARTY, NEW_VENDOR, BANK_CHANGED_RECENTLY, BACKDATED). State machine до READY_FOR_BATCH/ON_HOLD. BR-001/003/010/011/013/020/021/050. DoD: тест на каждый control code.
- **C-02** Exceptions: approve exception (OVER_OUTSTANDING и др.) роли Owner/Lead с reason → ON_HOLD→DOCS_CHECK→READY. Audit.
- **C-03** Payment Desk экран.
- **C-04** PaymentBatch: create/add/remove/freeze/unfreeze/review/approve/partial/export/mark_sent; summary generator (cash_after, next_7d, by_*); BR-040 на approve, BR-051/052/053/057. Cron freeze в cutoff. DoD: e2e полного цикла; SOD-тест.
- **C-05** My Approvals экран (mobile) — item и batch режимы.
- **C-06** Bank statement import (Unified CSV/XLSX), BankTransaction, idempotency (BR-056), auto-match (§1 алгоритм), ReconciliationMatch, PAID только через match (BR-054, DB trigger), FAILED path. Bank Reconciliation экран. DoD: тест «PAID без bank_transaction невозможен».
- **C-07** Advance: создание при PAID prepayment (BR-022), CLOSING_DOCS Task, закрытие документами, OVERDUE job-заглушка, BR-046, Employee advance flow, corp card expense report (минимально: Advance type CORP_CARD + документы).
- **C-08** Urgent batch flow (BR-043).
- **C-09** Seed Phase C: batches в разных статусах, выписка-образец, matched/unmatched.
- **C-10** Demo script `scripts/demo-p2p.md`: пошагово от PR до RECONCILED на seed.

## Phase D — AP/AR, events, forecast, jobs

- **D-01** `v_ap_aging`, AP экран, vendor statement reconciliation (загрузка CSV statement vendor → diff).
- **D-02** CustomerInvoice + AR aging + reminders job (BR-060) + dispute/promise.
- **D-03** Event: модель, state machine, EventBudgetLine, fast lane в PR (B-06 хук), `v_event_pl`, Event P&L экран, close с BR-061/062, refund tasks.
- **D-04** 13-week cash forecast: opening + expected AR + committed (batches, READY, approved PR без invoice по due) + tax obligations + payroll runs + capex/loan schedule (ручной ввод `CashPlanLine`) → weekly table; forecast vs actual accuracy хранится в `CashForecastSnapshot`.
- **D-05** Workers: contract expiry (BR-026), advance overdue, task escalation, aging refresh, FX check, AR reminders, batch cutoff freeze, audit hash verify. Все — BullMQ repeatable, идемпотентные.
- **D-06** Telegram bot (grammY) + NotificationAdapter + шаблоны + email fallback. Linking chat_id. BR-072 фильтр.
- **D-07** Budget vs actual отчёт с committed.
- **D-08** Seed Phase D: события Rooftop, AR, cash plan.

## Phase E — Documents & adapters

- **E-01** Document Health экран (все 9 красных зон).
- **E-02** EdoAdapter mock полностью: статус-панель dev, CORRECTED/CANCELLED сценарии (BR-024) e2e.
- **E-03** PosAdapter: три импортёра, таблицы, связь с Event actual.
- **E-04** AccountingAdapter: AccountMapping admin, export postings CSV, import posted → CLOSED.
- **E-05** Excel migration templates (`/templates/*.xlsx`) + импортёры vendors/contracts/open_ap/open_ar/employees с валидацией all-or-nothing и отчётом.
- **E-06** Backdated/BR-025, POA doc type, contract registration flag UI.

## Phase F — Compliance, close, dashboards

- **F-01** TaxCalendarRule + TaxObligation + Tax Calendar экран + PaymentRequest source TAX_OBLIGATION + overdue escalation.
- **F-02** PayrollRun + BR-047 + source PAYROLL_RUN + Employee status/card/passport flags + Tasks.
- **F-03** Close Center: чеклист, статусы, month-end pack генератор (XLSX + PDF summary).
- **F-04** Owner Dashboard (все 9 виджетов, drill-down).
- **F-05** Ops dashboard / Portfolio экран для сервисной команды.
- **F-06** KPI: расчёт всех KPI из blueprint §21 (`KpiSnapshot` daily), экран Controls.
- **F-07** Audit viewer с diff.

## Phase G — Hardening

- **G-01** Security review по `docs/11`: threat model doc, secret scan в CI, dependency audit, rate limiting на auth/import, CSP headers.
- **G-02** Permission test suite полное покрытие; cross-tenant fuzz.
- **G-03** Acceptance tests `docs/09` — все сценарии автоматизированы (Playwright + API).
- **G-04** Performance: 10k PaymentRequest / 50k BankTransaction seed, p95 < 500ms на списках.
- **G-05** Backup/restore скрипты, `docker-compose.prod.yml`, deployment runbook в README.
- **G-06** Полный demo script `scripts/demo-full.md` (PR → batch → bank → close → 1С export) + видео-скрипт текстом.
- **G-07** Финальная сверка: каждый BR имеет тест; каждый экран есть; каждый control code покрыт; `DECISIONS.md` актуален.

## Definition of Done фазы

Все задачи `[x]` или `[!blocked]` с описанием блокера; `pnpm test` зелёный; CHANGELOG содержит запись фазы; README обновлён; seed прогоняется с нуля; demo script выполним вручную.
