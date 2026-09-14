# Finance OS — Master Prompt для Claude Code

Скопируй текст ниже целиком в первое сообщение Claude Code, запущенного в корне репозитория, где уже лежат `CLAUDE.md`, `docs/`, `templates/`, `TASKS.md`, `DECISIONS.md`, `CHANGELOG.md`.

---

PROJECT: Finance OS — multi-tenant Finance Operations platform для бизнесов Узбекистана.

Ты — единственный разработчик. Полная спецификация уже в репозитории: начни с `CLAUDE.md`, затем прочитай все файлы в `docs/` в порядке нумерации (00 → 12). Не начинай писать код, пока не прочитал `docs/00-decisions.md`, `docs/02-data-model.md`, `docs/03-business-rules.md`, `docs/04-state-machines.md` и `docs/08-phases-tasks.md`.

**Контекст.** Мы строим 100%-контролируемую сервисную компанию Finance Operations as a Service. Rooftop Hall + Sense48 — Pilot #1, ORDO — Pilot #2. Продукт заменяет Telegram/Excel-финансы управляемым workflow, оставляя регламентированный учёт в 1С и юридически значимые документы в Didox. Telegram — только уведомления и deep links.

**Цель.** Production-oriented modular monolith: Purchase-to-Pay, Treasury, AP/AR, Contracts/Documents, Payment Batches, Bank Reconciliation, Event P&L, Budget, Tax/Payroll Calendar, Month Close, Owner Dashboard. Junior finance manager должен выполнять 80–90% рутины по системе и SOP, эскалируя только исключения.

**Non-negotiable controls** (полный список — `CLAUDE.md`): нет платежа без source object; нет дубликатов; requested ≤ outstanding без approved exception; four-eyes; смена реквизитов → verification + audit; PAID только по bank confirmation; prepayment → closing-doc task; immutable audit log с hash chain; никаких OTP/PIN/ЭЦП/карт в БД, логах, seed; никаких функций для фиктивных расходов и ухода от налогов; строгая tenant isolation.

**Стек зафиксирован** (`docs/00-decisions.md` D-01…D-06): Next.js 15 App Router + TS strict, Prisma + PostgreSQL 16, Supabase Auth, Tailwind + shadcn/ui, BullMQ + Redis, MinIO, Vitest + Playwright, Docker Compose, pnpm. Бизнес-логика — в `packages/core`, не в React и не в очередях. Все внешние системы — через adapter interfaces из `docs/07-integrations.md` с mock-реализациями и файловыми импортёрами; реальных API нет, не выдумывай их.

**Порядок работы.**
1. Скопируй задачи из `docs/08-phases-tasks.md` в `TASKS.md` со статусами `[ ]`.
2. Выполняй фазы A → G строго последовательно, задачи внутри фазы — в указанном порядке. Не переходи к следующей фазе, пока текущая не соответствует «Definition of Done фазы».
3. Не жди подтверждения. Если задача заблокирована (нет credentials, невозможно технически) — пометь `[!blocked]` с причиной и иди дальше.
4. Каждое решение, не покрытое `docs/00-decisions.md`, записывай в `DECISIONS.md` в формате ADR (контекст / решение / последствия). Принимай разумное решение сам — не спрашивай.
5. После каждой задачи: тесты зелёные, `TASKS.md` и `CHANGELOG.md` обновлены, commit `[Phase X] TASK-nnn: описание`.
6. Каждое business rule `BR-xxx` из `docs/03` — отдельный тест с этим ID в названии. Каждый control code — тест. Каждая строка RBAC-матрицы — permission test. Каждый AC из `docs/09` — acceptance-тест.
7. Seed — строго по `docs/10-seed-data.md`, синтетический, детерминированный, покрывающий все статусы всех state machines.
8. UI: русский по умолчанию через i18n, mobile-first для Owner/Requester экранов, суммы в тийинах в БД. Красный кейс всегда объясняет «почему заблокировано» и «кому эскалировать»; зелёный — «что делать дальше» одной строкой.
9. В конце каждой фазы обнови README (как запустить, что работает) и demo script.

**Acceptance standard.** Система не готова, если пользователь может: оплатить один invoice дважды; заплатить больше outstanding без approved exception; молча сменить реквизиты vendor; пометить платёж PAID без bank evidence; потерять трассу от платежа к business purpose и документам; увидеть данные другого tenant; найти OTP или номер карты в БД/логах/seed. Всё это должно быть доказано автоматическими тестами из `docs/09-acceptance-tests.md`.

Начинай с Phase A, задача A-01.
