# CHANGELOG

Формат: `## [Phase X] YYYY-MM-DD` → список `- TASK-nnn: что сделано`.

## [Unreleased]

## [Phase C] 2026-09-14
- C-01: payment-схема (PaymentRequest/PaymentBatch/BatchApproval/BankTransaction/ReconciliationMatch/Advance) + DB-триггер BR-054 (PAID только с bank_transaction_id); core paymentMachine + controlsSatisfied (BR-050); resolveSource c outstanding по BR-010/011 (paid+pending); run_controls: NO_SOURCE, INVOICE_DUPLICATE_SUSPECT, UNVERIFIED_BANK (BR-031), BANK_CHANGED_RECENTLY (BR-033), DUP_PAYMENT_SUSPECT (BR-003), OVER_OUTSTANDING, CONTRACT_LIMIT (BR-012), CONTRACT_EXPIRED (BR-026), 4-way match NO_PR/NO_CONTRACT/NO_RECEIPT/INVOICE_UNMATCHED (BR-020/021), MISSING_DOC:* (BR-023), UNBUDGETED, RELATED_PARTY/NEW_VENDOR (WARN), BACKDATED; submit → DOCS_CHECK → READY/ON_HOLD + Task c next_action; v_contract_balance и v_invoice_balance досчитаны из платежей; 10 тестов.
- C-04: batch-сервис — createBatch (BR-051 один STANDARD в день, URGENT c U-суффиксом), add/remove (BR-052 freeze-блок), freeze c summary (total/count/by_category/by_urgency/by_control/cash_after BR-053/exceptions/related party), unfreeze [Lead], review c 4-eyes (не freeze-автор), approveBatch [Owner] c BR-040 SOD per item и частичным утверждением (AC-07), export CSV c полным счётом и sha256 как Document (BR-057), mark_sent → SENT_TO_BANK, settleBatchIfDone; 5 сценарных тестов.
- C-08: urgent-контур внутри batch-сервиса (BR-043).
- C-02: approvePaymentException (Owner/Lead, reason ≥5, re-run контролей, Task закрывается), resolvePaymentHold после загрузки документов.

## [Phase B] 2026-09-14
- B-01: vendor-сервис (create PENDING+NEW, update, verify c SOD, block/unblock OWNER, BR-034 dup tax_id), bank accounts: change → новая UNVERIFIED + RETIRED старой + флаг BANK_CHANGED_RECENTLY + Task VERIFY_BANK (BR-030), dual verify c SOD (BR-032), AES-256-GCM шифрование счёта, reveal только по праву c audit (BR-074); экраны /vendors и Vendor 360; 10 интеграционных тестов + e2e полного цикла.
- B-02: core StateMachine каркас + contractMachine (11 статусов, guards: E-ijara регистрация, renew только Owner, close при outstanding=0); contract-сервис (CRUD, transitions c audit, amendments c применением changes, getContractBalance, BR-026 expiry-task stub); экраны /contracts и Contract 360 c кнопками доступных переходов; 7 тестов.
- B-03: customer-сервис (create/update/list c правами и audit), тесты.
- B-04: budget-сервис (upsert plan c audit, getBudgetStatus planned/committed/actual/remaining, checkBudget BR-014 все ветки), экран /budget (матрица + правка плана); 5 тестов. Excel-импорт перенесён в E-05.
- B-05: core policy engine (tier 1/2/3, Owner при OVER/UNBUDGETED/NEW_VENDOR/RELATED_PARTY/BANK_CHANGED_RECENTLY<7д, fast lane, variance_reason для Tier 3) + db getActivePolicy/createPolicyVersion (версии, дефолты D-12); 15 unit + 3 интеграционных теста.
- B-06: PR-сервис (create/submit c BR-014 budget check + policy snapshot BR-041 + fast lane, слоты согласований c ролевыми guard (junior только Tier1, cc-owner за BUSINESS_OWNER), BR-043/044/045, cancel/return_for_edit), экраны /pr, /pr/new (mobile), карточка PR c timeline, /approvals; 12 интеграционных тестов + e2e полного цикла.
- UI: дизайн-система «power» — Inter Variable, индиго-палитра, тёмный ink-sidebar с иконками lucide, стеклянный топбар, StatCard-дашборд на главной с живыми метриками, тёмный логин с glassmorphism, единые кнопки/поля/бейджи/таблицы (tabular-nums для сумм), PageHeader/EmptyState.
- B-07: createPo (PR APPROVED → ORDERED, номер PO-…), setPoStatus, createReceipt (FULL → PR RECEIVED, PARTIAL не переводит, BR-042 SOD для Tier 2+), блок PO/приёмки на карточке PR; 5 тестов.
- B-08: invoice-сервис (BR-002 duplicate→SUSPECT+Task+resolve, BR-025 backdated, match c vendor-guard → PR INVOICED, dispute, BR-024 edo CORRECTED/CANCELLED, suggestions ±5%, интерфейс v_invoice_balance), MockEdoAdapter (XLSX parse/build), importEdoRegistry (auto-vendor PENDING, buyer-mismatch errors, идемпотентность), экран /invoices c импортом и разбором дубликатов; 7 тестов.
- B-09: StorageAdapter (S3/MinIO + LocalFs ADR-005), documents-сервис (upload c sha256+версиями+25МБ лимит, mark_received/reject, checkRequiredDocs BR-023 c alsoObjects, seedDefaultRequirements), блок документов на карточке PR; 4 теста.
- B-11: seed Phase B — 30 vendors по распределению docs/10 (RELATED_PARTY, NEW, BLOCKED, PENDING, BANK_CHANGED, 2 USD, RETIRED-счета), 12 договоров (E-ijara, EXPIRING +20д, PREPAY 50%, USD CAPEX 30/70, ordo FM), бюджеты 2026-08/09, 14 PR (все статусы, urgent, Tier 3 unbudgeted), 7 СФ + DUPLICATE_SUSPECT c Task; идемпотентен. Phase B завершена.
- B-10: task-сервис (переходы OPEN/IN_PROGRESS/DONE/CANCELLED/OVERDUE, отмена только с причиной, createManualTask, escalateOverdueTasks для D-05), экран /tasks c next_action и действиями; 4 теста.

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
