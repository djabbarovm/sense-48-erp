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
- [x] D-08 Seed Phase D (5 клиентов, 4 события c депозитами и budget lines, 5 CINV во всех статусах, cash plan). **Phase D завершена.**

## Phase E — Documents & adapters
- [x] E-01 Document Health экран (9 красных зон, owner+task, document score)
- [x] E-02 EdoAdapter mock полностью: статусы в БД, dev-панель, сценарии CORRECTED/CANCELLED (BR-024)
- [x] E-03 PosAdapter: три импортёра (daily sales / inventory / banquet→event), POS-затраты в Event P&L
- [x] E-04 AccountingAdapter: маппинг НСБУ-21 (админ+сид), export postings CSV, import posted→CLOSED, платёжки 1CClientBankExchange, экран /onec, docs/13-onec-guide.md
- [x] E-05 Excel migration templates (6 xlsx c примерами и инструкцией) + импортёры all-or-nothing + экран /migration
- [x] E-06 Backdated/BR-025 бейдж, POA в upload, бейдж регистрации договора. **Phase E завершена.**

## Phase F — Compliance, close, dashboards
- [x] F-01 TaxCalendarRule + TaxObligation + Tax Calendar (+джобы generate/overdue, PAID из сверки)
- [x] F-02 PayrollRun + BR-047 (реестр-сверка, платёж net, POSTED)
- [x] F-03 Close Center (9-пунктовый чеклист) + month-end pack XLSX (8 листов)
- [x] F-04 Owner Dashboard (9 виджетов c drill-down, спарклайн 13 недель, runway)
- [x] F-05 Portfolio: сводка по компаниям пользователя (батчи/блоки/задачи/сверка)
- [x] F-06 KPI (10 метрик, ADR-010) + KpiSnapshot-джоб + экран Controls c трендом
- [x] F-07 Audit viewer: фильтры + построчный diff before/after + hash chain. **Phase F завершена.**

## Phase G — Hardening
- [x] G-01 CI (lint+typecheck+tests+gitleaks+доменный secret-scan), rate limiting (логин 10/5мин, импорты 30/час), CSP+security headers
- [x] G-02 Permission suite (A-06, 100% матрицы) + cross-tenant fuzz (18 атак → 404, агрегаты пустые)
- [x] G-03 Acceptance: AC-01/03/14/22 сквозные + карта AC→тест (docs/14)
- [x] G-04 Performance: scripts/perf.ts, 10k платежей/50k транзакций — p95 26–262ms (цель 500)
- [x] G-05 Dockerfile + docker-compose.prod (web/workers/backup c ротацией 30д), backup/restore-скрипты, runbook в README
- [x] G-06 scripts/demo-full.md (3 акта, 25 мин) + видео-скрипт 90 сек
- [x] G-07 docs/14-traceability.md: 49/49 BR c тестами (закрыты пробелы BR-004/005/011/012/013/021/050/071, BR-013 FX дореализован), 22 AC, 33 экрана. **Phase G завершена. Все фазы A–G закрыты.**

## Phase H — Реальные данные PALYM
- [x] H-01 Импорт управленческой книги KSP (ADR-011): парсер (`adapters/ksp`), сервис `importKspBook`, CLI `scripts/import-ksp.ts`, модель CounterpartyMatchRule; загружен тенант `rooftop-real`: 93 поставщика, 31 клиент, 78 статей, AP 59 сальдо (408,7 млн), AR 15 сальдо (2,7 млрд), 173 правила маппинга, касса CASH 1673 операции
- [ ] H-02 Обогащение поставщиков ИНН/счетами из справочника 1С (ждём выгрузку; заглушки `KSP-nnnn`, статус PENDING_VERIFICATION)
- [ ] H-03 Выписки банка с 01.09 + Didox-реестр + налоговый календарь по данным бухгалтерии
- [ ] H-04 Разбор переплат поставщикам (10 шт.) и авансов клиентов (16 шт.) из отчёта импорта

- [~] H-05 Реальные учётки по ADR-012 созданы в `rooftop-real` c placeholder-email (@palym.test, врем. пароль): Мурад OWNER+ADMIN, Лайло OWNER, Арай OWNER, Дильфуза LEAD+ACCT, Зухра JUNIOR+ACCT, Нарина REQUESTER. Осталось: настоящие email, решение по KSP (VIEWER-роль или не заводить), владельческий P&L в разрезах книги KSP

- [~] H-06 Деплой на VPS: workflow `.github/workflows/deploy.yml` (workflow_dispatch, sshpass), `scripts/bootstrap-prod.ts` (права+тенант+команда+книга KSP, без демо), оверлей `docker-compose.deploy.yml` (:80 без домена), книга KSP в репо шифрованной (`data/ksp-book.xlsx.enc`, AES-256, ключ у владельца). Осталось: владелец арендует VPS и добавляет секреты DEPLOY_HOST/DEPLOY_PASSWORD/DEPLOY_DATA_KEY → запуск workflow

- [ ] H-07 CEO-контур по docs/15-ceo-path.md (ADR-013): BusinessUnit, справочники (fixed costs, нормативы, календарь дат), Event→мини-CRM, экран «Утро» v1, «Сегодня», алерты. Ждём от владельца: юрструктура (2 юрлица или направления), чем Sense ведёт записи, кто ведёт события

## Блокеры
(пусто)
