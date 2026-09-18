# CLAUDE.md — Finance OS

Ты — единственный разработчик этого репозитория. Работай автономно, последовательно и по спецификации в `docs/`. Этот файл — точка входа. Прочитай его целиком, затем `docs/00-decisions.md` и `docs/08-phases-tasks.md`, и начинай с первой незакрытой задачи в `TASKS.md`.

## Что мы строим

Finance OS — multi-tenant платформа Finance Operations для бизнесов Узбекистана. Заменяет Telegram/Excel-процесс финансов на управляемый workflow: Purchase-to-Pay, Treasury, AP/AR, Contracts/Documents, Payment Batches, Bank Reconciliation, Event P&L, Budget, Tax/Payroll Calendar, Month Close, Owner Dashboard.

Пилот №1 — Rooftop Hall + Sense48 (event venue + SPA). Пилот №2 — ORDO (property management / FM).

Принцип: **Telegram — уведомления. Система — источник истины. Банк — исполнение. 1С — регламентированный учёт.**

## Non-negotiable controls (нарушение = система не принята)

1. Нет платежа без source object (PR / contract / tax obligation / payroll run / advance).
2. Нет дубликатов: одинаковые vendor + invoice number + amount + date блокируются до review.
3. `payment_request.amount <= source.outstanding`, кроме approved exception с reason code.
4. Four-eyes: создатель payment request ≠ финальный approver. Проверяется на уровне сервиса и в тестах.
5. Смена банковских реквизитов vendor → статус UNVERIFIED, платежи на новый счёт блокируются до verification + dual approval + audit.
6. Статус PAID ставится только из bank confirmation (импорт/webhook), никогда из UI-кнопки.
7. Prepayment автоматически создаёт closing-document task с SLA.
8. Все изменения финансовых объектов пишутся в immutable AuditLog (before/after, actor, timestamp, hash).
9. Никогда не хранить OTP, PIN, пароли ЭЦП, private keys, полные номера карт — ни в БД, ни в логах, ни в seed.
10. Не реализовывать функции, облегчающие фиктивные расходы, фальшивые СФ, уход от налогов. Каждый расход имеет business purpose и evidence.
11. Tenant isolation: любой запрос к финансовым данным фильтруется по `tenant_id` из контекста пользователя. Тесты на cross-tenant leak обязательны.

## Как работать

- **Не жди подтверждения** между фазами. Останавливайся только если задача физически невыполнима (например, нет credentials) — тогда запиши блокер в `TASKS.md` и переходи к следующей задаче.
- Перед каждой фазой перечитай соответствующий раздел `docs/08-phases-tasks.md` и `docs/09-acceptance-tests.md`.
- Каждое архитектурное или продуктовое решение, не описанное в `docs/00-decisions.md`, фиксируй в `DECISIONS.md` (формат ADR: контекст, решение, последствия). Не переспрашивай — принимай разумное решение и записывай его.
- После каждой завершённой задачи: обновить `TASKS.md` (статус), `CHANGELOG.md`, при необходимости README.
- Тесты — обязательны для каждого business rule из `docs/03-business-rules.md`. Идентификатор правила (BR-xxx) указывается в названии теста.
- Все внешние системы — через adapter interfaces из `docs/07-integrations.md`. Реальных API нет; реализуй mock-адаптеры + file importers. Никаких hardcoded предположений о форматах реальных банков.
- UI на русском по умолчанию, все строки через i18n-словарь. Суммы — в тийинах (integer) в БД, форматирование в UZS в UI.
- Commit после каждой логически завершённой задачи. Сообщение: `[Phase X] TASK-nnn: краткое описание`.

## Стек (зафиксирован, не менять без ADR)

Next.js 15 App Router + TypeScript strict · Prisma + PostgreSQL 16 · Supabase Auth (self-hosted в docker-compose или локальный mock) · Tailwind + shadcn/ui · BullMQ + Redis · MinIO (S3) · Vitest + Playwright · Docker Compose · pnpm.

## Структура репозитория (целевая)

```
/apps/web            Next.js приложение (UI + API routes / server actions)
/packages/core       Domain: entities, state machines, business rules, policy engine
/packages/db         Prisma schema, migrations, seed
/packages/adapters   bank/ didox/ iiko/ onec/ telegram/ — interfaces + mocks + importers
/packages/workers    BullMQ jobs: bank import, reminders, aging refresh, calendar alerts
/docs                Спецификация (source of truth для требований)
/templates           Excel-шаблоны миграции
DECISIONS.md TASKS.md CHANGELOG.md README.md
```

Правило: бизнес-логика живёт в `packages/core`, а не в React-компонентах и не в n8n. UI и workers — тонкие клиенты core.

## Индекс документации

| Файл | Что внутри |
|---|---|
| `docs/00-decisions.md` | 20 зафиксированных решений: стек, валюты, пороги, роли, интеграции |
| `docs/01-prd.md` | Контекст, цели, scope/non-goals, пользователи, главный workflow |
| `docs/02-data-model.md` | Все сущности, поля, связи, индексы, инварианты |
| `docs/03-business-rules.md` | BR-001…BR-060 — правила с ожидаемым поведением и тестом |
| `docs/04-state-machines.md` | Состояния и переходы: PR, PaymentRequest, Batch, Invoice, Contract, Advance, Event, Vendor |
| `docs/05-rbac.md` | Роли × права, tenant scoping, portfolio access |
| `docs/06-screens.md` | 17 MVP-экранов: назначение, данные, действия, exception-состояния |
| `docs/07-integrations.md` | Adapter interfaces + mock/file форматы для bank, Didox, iiko, 1С, Telegram |
| `docs/08-phases-tasks.md` | Phase A–G, задачи с Definition of Done |
| `docs/09-acceptance-tests.md` | Acceptance criteria → конкретные тест-сценарии |
| `docs/10-seed-data.md` | Спецификация синтетических данных Rooftop/Sense48/ORDO |
| `docs/11-security.md` | Threat model, секреты, маскирование, permission tests |
| `docs/12-domain-glossary.md` | Термины: СФ, Didox, ЭЦП, подотчёт, GPH и т.д. |
| `docs/20-mds-property.md` | MDS Property: Property Core, статусная модель, BR-P01…P15, роли, экраны, этапы Wave 0–5 |
| `docs/17-ip-ownership.md` | Правообладатель, состав продукта, что продукту не принадлежит, передача в компанию, задачи юристу |

## Definition of Done (для любой задачи)

- Код + миграции + UI (если есть экран)
- Unit-тесты на business rules, integration-тест на happy path и на ≥1 exception path
- Permission-тест: роль без права получает 403, другой tenant получает 404
- Audit log пишется и проверен в тесте
- `TASKS.md`, `CHANGELOG.md` обновлены
- `pnpm lint && pnpm typecheck && pnpm test` проходят

## Чего НЕ делать

- Не заменять 1С; не писать собственный бухгалтерский план счетов сверх маппинга category → account code.
- Не реализовывать выполнение платежа в банке. Система готовит batch-файл и принимает confirmation.
- Не хранить статусы workflow только в очередях/n8n.
- Не использовать free-text там, где возможны структурированные выборы.
- Не добавлять OCR, AI anomaly detection, client portal, multi-country — это P2, вне MVP.
