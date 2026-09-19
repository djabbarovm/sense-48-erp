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
- [ ] H-02 Обогащение поставщиков ИНН/счетами из справочника 1С — инструмент готов (H-09: `/migration` → «1С: справочник контрагентов»); ждём выгрузку по Rooftop/Sense48 (по ORDO проверено на реальной выгрузке)
- [ ] H-03 Выписки банка с 01.09 + Didox-реестр + налоговый календарь по данным бухгалтерии — импорт реестра Didox готов (H-09), налоговый календарь ORDO заведён (H-10); ждём выписки банка
- [ ] H-04 Разбор переплат поставщикам (10 шт.) и авансов клиентов (16 шт.) из отчёта импорта — авансы/дебиторка/кредиторка теперь грузятся из ОСВ 1С (H-09); разбор по Rooftop ждёт ОСВ

- [~] H-05 Реальные учётки по ADR-012 созданы в `rooftop-real` c placeholder-email (@palym.test, врем. пароль): Мурад OWNER+ADMIN, Лайло OWNER, Арай OWNER, Дильфуза LEAD+ACCT, Зухра JUNIOR+ACCT, Нарина REQUESTER. Осталось: настоящие email, решение по KSP (VIEWER-роль или не заводить), владельческий P&L в разрезах книги KSP

- [x] H-06 Деплой на сервер DigitalOcean: workflow `.github/workflows/deploy.yml` (workflow_dispatch, sshpass), `scripts/bootstrap-prod.ts`, оверлей `docker-compose.deploy.yml`, книга KSP в репо шифрованной (`data/ksp-book.xlsx.enc`). Сервер арендован владельцем, деплои №3–6 успешны (15.09)
- [x] H-11 Публичный HTTPS без домена + демо Tower на сервере: Caddy c сертификатом Let's Encrypt на `<ip>.sslip.io` (`deploy/Caddyfile`), `AUTH_COOKIE_SECURE=true`, `APP_URL`, `.env.prod` дополняется идемпотентно (PUBLIC_HOST, TELEGRAM_WEBHOOK_SECRET, токен/username бота из секретов), `setWebhook` в workflow, bootstrap сидит демо-тенант «Piramit Tower (демо)» один раз и даёт владельцу OWNER+ADMIN в нём, ротация паролей охватывает `@piramit.test`; ADR-031. Осталось владельцу: секреты `TELEGRAM_BOT_TOKEN`/`TELEGRAM_BOT_USERNAME` → повторный деплой

- [~] H-07 CEO-контур (ADR-013): «Утро» v1 готово — модели FixedCost/CostNorm/SenseDailyStat + Event.riskNote (миграция ceo_path), сервис ceo.ts (break-even факт/прогноз c датой прохождения, загрузка 30/60/90, решения, итог одной строкой — детерминированные правила), экраны /ceo и /ceo/settings, тесты ceo.test.ts. Ответы владельца: одно юрлицо (направления ROOFTOP/SENSE48), Sense — Altegio (адаптер — этап 2), события ведёт продажник. Дальше: окно «Сегодня», Altegio-адаптер, Telegram-алерты

- [x] H-09 Родные выгрузки 1С и Didox без переформатирования: парсеры справочника контрагентов, ОСВ по счёту (контрагент → договор), штатных сотрудников, экспорта реестра Didox (adapters); импорт — обогащение поставщиков (KSP-заглушки → ИНН/реквизиты, второй счёт UNVERIFIED, физлица без ПИНФЛ), ОСВ 40xx → дебиторка, 43xx → авансы c задачами CLOSING_DOCS, 6xxx → кредиторка, штат без окладов, подписанные договоры Didox; блок «Родные выгрузки» на `/migration` c заметками отчёта; 5 unit + 5 интеграционных тестов; проверено на реальных выгрузках ORDO (27 контрагентов, ОСВ 4010/4310/6910, 7 сотрудников, 21 документ Didox); ADR-026
- [x] H-10 Налоговый профиль по ответам бухгалтерии: ставка и база в правилах календаря (`rate_bp`, `base_kind`, `note`), пресет `UZ_TURNOVER_4` (налог c оборота 4% от выручки, ЕСП 12% и НДФЛ 12% от ФОТ, ИНПС 0,1% внутри НДФЛ, срок 15 число) в core c тестами, оценка ожидаемой суммы из ФОТ ведомости и счетов клиентам периода (коридор ±10%, база в обязательстве), кнопка «Применить пресет» и поля ставка/база/пояснение на `/tax`, seed ORDO; ADR-027 (1С в облаке Clobus, подписка у Palym Group до декабря — риск)
- [ ] H-08 ТЗ CEO-дашборда (docs/16, ADR-014): переключатель Группа/Rooftop/Sense48, «Нет данных»≠0 + источник/свежесть на показателях, решения CEO как сущность (6 действий + аудит), сделки в работе (потенц./ожид./подтв.), физическая и денежная загрузка, условия автоподтверждения (п.15), адаптеры amoCRM → Altegio → iiko. Блокеры: доступы amoCRM/Altegio, ответы на вопросы 9–15 ТЗ

## Порядок внедрения (ADR-033, решение владельца 19.09)

1. **ORDO — коммерческая команда** (продажник + колл-центр): P-30 реальный тенант → P-27 учётки → бот и OnlinePBX → обкатка «Мой день», сделки, КП, воронка собственников.
2. **ORDO — сервис**: маркетплейс услуг (P-16/P-20), заявки и инциденты (P-15a), портал собственника (P-15b) на реальных собственниках.
3. **ORDO — операции**: деньги дома (P-21), аренда и дебиторка (P-18), Mall (P-19), финансы ORDO из 1С/Didox (H-09) в тенанте `ordo`.
4. **Адаптация под Rooftop и Sense48**: H-02…H-05, H-07, H-08 — после ORDO.

- [ ] P-30 Реальный тенант ORDO на сервере: bootstrap создаёт `ordo` («ООО «ORDO Management»») без демо-данных, владелец OWNER+ADMIN; загрузка реального реестра помещений и собственников через `inventory.xlsx` (шаблон есть, P-07) и контактов (`contacts.xlsx`, P-22a); финансы ORDO — родными выгрузками 1С/Didox (H-09). Демо-тенант `piramit` остаётся синтетическим для показов. Блокер: реестр помещений/собственников и выгрузки 1С по ORDO от владельца

## Phase P — MDS Property (docs/20, blueprint Wave 0–1)
- [x] P-01 Спецификация docs/20-mds-property.md (статусы, BR-P01…P15, роли, экраны, этапы) + ADR-016 (имя MDS, монорепо) + ADR-017 (статусная модель)
- [x] P-02 Prisma §P: Building/Floor/Unit/PropertyOwner/UnitActivity + enum'ы; роли COMMERCIAL_MANAGER/BROKER/OPERATIONS_MANAGER/MARKETING; 12 прав property.*/unit.* в матрице; миграция `mds_property_core`
- [x] P-03 Движок статусов в core (`deriveUnitView`, `validateStatusPatch`, `matchesUnitFilter`, `computeUnitKpi`) — 21 тест BR-P01…P12
- [x] P-04 Сервисы property.ts: status-map/floor/unit-card/list c единым фильтром, changeUnitStatus (право на поле, override c причиной, BR-P09/P14), pricing, publish, activities, master data; PII-маскирование — 10 интеграционных тестов (403/404/audit)
- [x] P-05 Экраны: /property (KPI strip, фильтры, легенда, 2.5D фасад), /property/floors/[id] (SVG-план + список), /property/units/[id] (карточка, формы по правам, аудит); i18n `property`; пункт меню
- [x] P-06 Seed Phase P: тенант `piramit` — 3 здания, 30 этажей, 230 юнитов + ядра, 60 собственников, 5 ролевых пользователей, 3 намеренных противоречия; идемпотентен
- [x] P-07 Импорт инвентаря `inventory.xlsx` (all-or-nothing, здание/этаж/собственник по ключам, существующие Unit ID пропускаются, BR-P04/P10 — ошибки строк) + шаблон templates/inventory.xlsx + карточка на /migration; 3 теста
- [x] P-08 Импорт плана этажа JSON/SVG (`adapters/property/floorplan`: polygon/rect/path; неизвестный юнит → отказ; geometryVersion++; audit) + карточка на /migration; Playwright e2e трёх экранов (property.spec: навигация ≤ 2 действия, PII брокера, стадии, cross-tenant 404); фикс входа — сброс чужой tenant-cookie
- [ ] P-09 Владелец: переименовать репозиторий и workspace-scope в нейтральное имя (git-история сохраняется)
- [x] P-10 Wave 2 (ADR-018): LeaseContract (DRAFT→ACTIVE→EXPIRING→TERMINATED, один действующий на юнит, юнит — зеркало, LEASE_IS_SOURCE), Deal (воронка 11 стадий, вероятности, BR-P20 commercialStatus из сделок, BR-P21 брокер видит своё, BR-P22 attention + Task DEAL_FOLLOWUP, BR-P23 WON через активацию договора), outbox DomainEvent + джоб domain-events → Telegram, ApiKey (sha256, scope) + `GET /api/property/public/inventory` без PII; экраны /deals (доска), /deals/[id], /deals/new, /leases, /admin/api-keys, секции договора и сделок в карточке юнита; джобы lease-expiry/deal-followup/domain-events; seed: 163 договора + 20 сделок; 8 unit + 9 интеграционных тестов, e2e deals.spec
- [x] P-11 Пульт управления `/property/today` (blueprint §9): сегодня (новые сделки, переходы, показы, внимание, просроченные задачи, противоречия, критичные), коммерция (KPI, по зданиям, воронка, истекающие 30/90), собственники (согласны без аренды — smart query §1.8), эксплуатация (ремонт/проблемы, противоречия, простой > 60 дн); стартовая страница для ролей недвижимости; сервис `controlRoom.ts` + тест
- [x] P-12 Wave 3: WorkBot — `IntentExtractor` (adapters/workbot: интерфейс + rule-based mock, 4 намерения blueprint §1.9), `ActionDraft` (DRAFT/NEEDS_INFO/CONFIRMED/REJECTED/FAILED), сервис `actionDrafts.ts` (preview → confirm через существующие сервисы c правом по виду действия, BR-P30), API `/api/property/actions/draft` + `/{id}/confirm` (X-Api-Key scope WORKBOT, пользователь по telegramChatId), экран `/property/actions`; 6 + 6 тестов
- [x] P-13 Realtime: `GET /api/property/events/stream` (SSE по DomainEvent, cookie-auth, опрос outbox 2 с, heartbeat, авто-переподключение) + клиент `LiveRefresh` (router.refresh c троттлингом) на /property, этаже, карточке юнита и пульте; индикатор live; проверено: перекраска у второго пользователя ≤ 5 с
- [x] P-14 Комиссии ORDO и бонусы продажников (blueprint §17; Tower §2; решения владельца): продукт сделки → правило комиссии (аренда 50% месяца c арендатора, продажа 3% коридор 1,5–3% c продавца, паркинг, STR/ТРЦ — OPEN), Commission на WON (активация договора / закрытие продажи ценой), доля внешнего брокера, PAID только зачётом банковской транзакции (BR-P41/P42); SalesBonus 20% + 10% KPI-чек-лист (5 пунктов, подтверждает не продажник, 14 дней) / треть комиссии при продаже, к выплате после поступления, выплата финансами по ведомости, удержание при отмене (BR-P43/P44); джоб bonus-kpi-deadline; экраны /commissions, /bonuses, блок в карточке сделки, продукт в формах; seed 3 выигранные сделки; 3 core + 4 db теста; ADR-022
- [x] P-15a Заявки и инциденты (blueprint §12): WorkOrder (WO-номера, категория, приоритет → SLA 4/24/72/168 ч, исполнитель/подрядчик, state machine OPEN→ASSIGNED→IN_PROGRESS→DONE→VERIFIED, cancel/reopen c причиной), фото-подтверждение через Document, QA не исполнителем (BR-P32), operationalStatus юнита из открытых заявок (BR-P31, WORKORDER_IS_SOURCE), джоб workorder-sla (Task WORKORDER_OVERDUE + событие), WorkBot UNIT_ISSUE → заявка; экраны /workorders, /workorders/[id], блок на карточке юнита; seed 10 заявок; 3 core + 3 db теста
- [x] P-15b Owner Portal (blueprint §10): роль PROPERTY_OWNER (без property.view), PropertyOwner.userId + согласия (управление/сдача/публикации, audit), `getOwnerPortal` (только свои юниты, договор, выписка c комиссией management_fee_bp, заявки, документы), заявка собственника только по своему юниту (BR-P33, приоритет ≤ HIGH), реестр `/property/owners` c привязкой учётки по email; экран `/owner` — стартовый для собственника; seed owner1@piramit.test; 4 теста. E-sign — по юридической готовности
- [x] P-16 Services marketplace (blueprint §12): каталог услуг (партнёр c комиссией / собственная эксплуатация, SLA), ServiceOrder (SO-номера, снимок цены/комиссии — BR-P35, NEW→ACCEPTED→IN_PROGRESS→DONE→VERIFIED, подтверждение + QA не исполнителем, оценка 1–5), GMV/выручка платформы/выплаты партнёрам/SLA/оценки по исполнителям и категориям (BR-P36), джоб service-sla; экраны `/services` (сводка, заказ, каталог), `/services/[id]`, блок на пульте; документы по договорам аренды (карточка юнита → Document lease_contract) и в Owner Portal (просмотр/скачивание/загрузка только своих — BR-P33), заказ и оценка услуг собственником; seed 8 услуг + 12 заказов; 3 core + 7 db тестов
- [x] P-18 Аренда и дебиторка (blueprint §1.7/§1.8/§9; Tower §2.1): RentCharge по месяцам c пропорцией (BR-P38) только для юнитов под управлением (BR-P40), PAID только зачётом банковской транзакции (BR-P37), списание будущих периодов при прекращении (BR-P39), просрочка → Task RENT_OVERDUE + событие, фильтр «c задолженностью», блок Finance в карточке юнита и на пульте, `/rent` c зачётом поступлений и пагинацией, выписка собственника из начислений; джобы rent-charges/rent-overdue; seed: счёт УК, 3 месяца начислений, оплаты по выписке, нераспределённые поступления; 2 core + 4 db теста; ADR-021
- [x] P-19 ORDO Mall — коммерческая часть (бизнес-модель Mall v1.1): MallMandate (ДДУ: DRAFT→SIGNED→ACTIVE→TERMINATED, только ТРЦ c собственником, один на помещение, ACTIVE → под управлением и начисление аренды — BR-P45), ставка вознаграждения OPEN до утверждения и публикация собственнику (BR-P46), категории арендаторов в договорах и сделках, CommercialAsset + AssetContract (медиа/островки/паркинг/партнёрства — 100% ORDO), дашборд `/mall` (GLA, загрузка по этажам, tenant mix, сценарии ставок, контролируемая база, воронка, линии актива), вкладки мандатов и активов, калькулятор экономики собственника 5 лет, блок мандата в карточке юнита, раздел ТРЦ в кабинете собственника; seed 27 мандатов / 11 линий актива / категории; 3 core + 3 db теста; ADR-023
- [x] P-20 Services v1.0 (бизнес-модель Services): условия направлений (комиссия / referral ежемесячно / пакет), вовлечение, скидка клиенту, внутренняя ставка за свою эксплуатацию (OPEN), трёхуровневый учёт GMV → Services → исполнитель (BR-P47), арендаторы Mall не клиенты (BR-P48), канал одного окна и профиль клиента, cost-to-serve и жалобы по заказу (BR-P49), регулярные пакеты c джобом service-packages (BR-P50), импорт referral-отчётов партнёров (CSV, идемпотентно), аналитика валидации H1A/H4/H5 (contribution по направлениям, penetration, attach rate, повторные, каналы, профили, referral, MRR); вкладки «Пакеты» и «Аналитика», форма cost-to-serve; seed; 2 core + 3 db теста; ADR-024
- [x] P-21 Operations — деньги дома (бизнес-модель Operations v1.0; ЗРУ-581 ст. 16/28/29): HouseFund c отдельным счётом дома, тариф за м² и дата утверждения, ставка вознаграждения ORDO (OPEN → null), кадастр юнита (номер, площадь), взносы HouseCharge по кадастровой площади джобом house-charges (BR-P51, preCadastre по договорной), просрочка house-overdue → задача/событие, PAID только зачётом на счёт дома (BR-P52/P53, WRONG_ACCOUNT), бюджет дома по статьям и расходы c основанием (compliance floor), дашборд `/house` (деньги, перерасчёт BR-P54, сценарии 70/85/95, должники, плательщики, договоры управления ст. 28), отчёт собственникам «деньги · работы · качество · дальше» (ст. 29), кабинет собственника — взносы и остаток, реестр собственников — статус договора управления, карточка юнита — кадастр; seed (фонд Residence Tower, 12 000 сум/м², кадастр 4/5 юнитов, договоры, бюджет, расходы, 3 месяца взносов, ≈75% оплачено банком); 1 core + 1 db тест (8 сценариев); ADR-025
- [x] P-22a CRM Tower — клиентская база: `Contact` (телефон канонический, доп. телефон, email, компания, источник, теги, собственник, менеджер), `Deal.contactId` c SQL-бэкфиллом, автопривязка сделок/лидов (BR-P55), PII по deal.contact.view c маскированием, слияние дублей (BR-P56, contact.merge), `/contacts` и `/contacts/[id]`, ссылка из карточки сделки, «Новая сделка» c предзаполнением, импорт `contacts.xlsx` (шаблон, блок CRM на /migration); 3 core + 5 db тестов; ADR-028
- [x] P-22b CRM Tower — воронка собственников (H4): стадии LEAD…HANDED_OVER/LOST c правилами синхронизации (BR-P57), сегменты, `ownerScenarios` STR / mid-term / LTR c OPEN-ставкой STR и рекомендацией по доходу собственника (BR-P58), активности и follow-up собственника, джоб `owner-followup` → Task OWNER_FOLLOWUP, события; `/property/owners` вкладки Воронка/Реестр/Аналитика (конверсия по сегментам, причины отказов), карточка `/property/owners/[id]` c калькулятором и «Показал расчёт»; бэкфилл стадий из фактов; seed; 4 core + 4 db тестов; ADR-029
- [x] P-23 CRM: «Мой день» `/me` mobile-first (показы сегодня c результатом одним действием, новые лиды, просрочено/без шага, сегодня по плану, собственники на связь, задачи, итог дня), быстрые действия (звонок + следующий шаг, назначить показ, результат показа OFFER/THINKING/RESCHEDULE/LOST, быстрый лид, звонок собственнику, задача сделана), PWA (manifest, иконка, standalone), нижняя навигация на телефоне, старт менеджера/брокера c `/me`; `nextActionAt`/`followUpAt` теперь c временем (миграция `crm_timestamps`); сервис `myDay.ts`, 4 теста
- [x] P-24 CRM: Telegram-бот сотрудника — привязка `/start <код>` из «Мой день», webhook `/api/telegram/webhook` (секрет заголовка), команды /today /leads /deal /owners /help, свободный текст → WorkBot-черновик → кнопки «Подтвердить/Отмена» → commit сервисами; CRM-намерения (лид, звонок, показ, результат показа, собственник, мой день) c разбором дат «завтра 15:00 / в пятницу / 25.09»; напоминания: показ за час, вопрос о результате через 2 ч c кнопками, SLA лида 15 мин → менеджер, 30 мин → руководитель (BR-P59/P60, дедуп через события, только рабочие часы); дайджесты 08:30 и 19:00; джобы crm-reminders / crm-digest-*; env TELEGRAM_BOT_TOKEN / TELEGRAM_WEBHOOK_SECRET / TELEGRAM_BOT_USERNAME / APP_URL; 4 unit + 4 интеграционных теста. Блокер для live: токен бота от владельца (до него — консольный адаптер)
- [x] P-25 CRM: роль CALL_CENTER (права deal.*, owner.pipeline, owner.activity, action.draft; лид → дежурный менеджер; «Мой день» — вся входящая очередь; SLA-предупреждения по лидам приходят и КЦ), BR-P62 стадия не дальше VIEWING (guard в dealMachine), новое право owner.activity; BR-P59…P61 реализованы в P-23/P-24; seed callcenter@piramit.test; тест call-center.test.ts
- [x] P-26 CRM: `/crm/analytics` (скорость первого касания по источникам и сотрудникам, SLA 15 мин, конверсия шагов, активности, качество ведения, звонки, собственники), `TelephonyAdapter` (Generic) + `POST /api/telephony/webhook` (scope TELEPHONY) → `ingestCallEvent` (контакт → сделка / собственник / новый лид, пропущенный → перезвонить, дедуп по externalRef, запись у провайдера), поля звонка в активности; тесты telephony.test.ts
- [x] P-28 CRM: коммерческое предложение — `DealProposal` (до 6 помещений, токен, срок), публичная страница `/p/<token>` без входа (только публичные поля юнитов, печать в PDF, «Записаться на показ»), учёт просмотров и запроса показа → активности, следующий шаг менеджеру и уведомления в бот (crm-reminders); блок КП в карточке сделки; тест proposals.test.ts
- [ ] P-27 CRM: учётки команды и профиль сотрудника c привязкой бота; блокер: email и роли от владельца
- [x] P-29 Телефония OnlinePBX (ADR-032): `OnlinePbxAdapter` (form/JSON, карта полей c умолчаниями FreeSWITCH-CDR, зона АТС, направление по внутреннему номеру, пропущенные по причине), `buildTelephonyAdapter`/`parseWebhookRawBody`, настройки `tenant.settings.telephony` (`getTelephonySettings`/`updateTelephonySettings` c аудитом, `noteTelephonyWebhook` — только ключи непонятого тела), webhook принимает `?key=`, экран «Администрирование → Телефония», источник лида WHATSAPP (миграция `deal_source_whatsapp`), vitest-конфиг adapters (тесты пакета теперь в `pnpm test`); 6 unit + 1 интеграционный тест; docs/07 §8, docs/21 §2/§7/§9, README. Осталось владельцу: ключ TELEPHONY + webhook в кабинете OnlinePBX, первый звонок → проверить «Последний webhook»
- [x] P-17 Лиды c сайта/бота и атрибуция (blueprint §3/§8/§14): `POST /api/property/public/leads` (X-Api-Key scope LEADS, rate limit), `intakeLead` → Deal c source/UTM/юнитом дежурному менеджеру, дедуп по телефону/email за 30 дней → активность в существующую сделку (BR-P34); `/deals/analytics` — воронка по стадиям, источники → конверсия, причины проигрыша, скорость, UTM-кампании; 3 теста

## IP — принадлежность продукта
- [x] IP-01 Правообладатель зафиксирован (ADR-015): LICENSE, docs/17-ip-ownership.md, package.json, README, git-идентичность владельца
- [ ] IP-02 Юрист: задачи 6.1–6.9 из docs/17 (сверка имени, договор отчуждения, форма передачи, регистрация ПО/ТЗ, депонирование, шаблоны договоров c клиентами и подрядчиками, ПДн, соглашение по книге KSP)
- [ ] IP-03 После регистрации компании: коммит «передача права» (LICENSE, docs/17 §1, package.json.author) + тег `ip-transfer-YYYY-MM-DD`, перенос репозитория в организацию

## Блокеры
(пусто)
