# 01 — PRD: Finance OS

## 1. Контекст

Год эксплуатации Rooftop Hall (сентябрь 2025 – сентябрь 2026) показал типовой набор проблем финансового бэк-офиса малого бизнеса в Узбекистане:

- Telegram используется как ERP: запрос → обсуждение → договор → «оплатить» → скрин → уточнение — в одном чате. Нет audit trail, нет статуса.
- Повторные платежи: 11.08.2026 оплачена полная сумма вместо доплаты, потому что никто не считал contract value / paid / outstanding автоматически.
- OTP bottleneck: платежи ждут владельца, коды истекают, платёж создаётся заново. CEO — human OTP device.
- Нет единого cutoff: срочные платежи возникают весь день.
- СФ приходят не вовремя, красные, дублированные, исправленные — оплата идёт без 3/4-way match.
- Договоры аренды висят месяцами без owner и deadline.
- Налоги считаются, но не встроены в cash plan.
- Операционные расходы выводятся через займы на карту физлица.
- Размытые роли: бухгалтерия делает accounting + treasury + HR docs + supplier checks.
- Нет owner cockpit: «что купили и сколько осталось платить?» требует чтения переписки.

**Корневая причина** — не люди, а отсутствие формализованных workflow, master data, controls и ownership.

## 2. Что строим

Finance OS — программная платформа + операционная модель, которую использует отдельная сервисная компания (Finance Operations as a Service). Клиенты — Rooftop Hall / Sense48 (Pilot 1), ORDO (Pilot 2), далее внешние компании.

Система должна позволить **junior finance manager без знания бизнеса «наизусть» выполнять 80–90% рутины по зелёному потоку**, эскалируя только красные кейсы.

## 3. Пользователи

| Роль | Кто это | Главная задача в системе | Устройство |
|---|---|---|---|
| Owner | Собственник/CEO | 1 consolidated approval в день за 15–30 секунд; cockpit | Телефон |
| Finance Ops Lead | Старший финансист сервисной компании | Review красных кейсов, 4-eyes на batch, close | Desktop |
| Junior Finance | Оператор рутины | PR review, docs, batch prep, reconciliation | Desktop |
| Document Controller | Документовед | Didox, договоры, СФ, акты, доверенности | Desktop |
| Accountant | Бухгалтер 1С (внешний/внутренний) | Видит согласованные данные, отмечает posting | Desktop |
| Requester | Менеджер/шеф/маркетолог | Создать PR с телефона за 1 минуту | Телефон |
| Admin | Настройка tenant, роли, пороги | Редко | Desktop |

## 4. Главный workflow

```
Need → Purchase Request → Budget Check → Vendor/Contract → (PO) → Delivery/Acceptance
→ Invoice/СФ → Match → Payment Request → Payment Batch → Approval → Bank Execution
→ Bank Confirmation → Reconciliation → Closing Docs → Accounting Posted → Management Reporting
```

Специальный контур для Rooftop — **Event-to-Pay**: мероприятие = мини-P&L с revenue, депозитами, cost budget; все PR привязаны к `event_id`; fast lane внутри утверждённого бюджета события.

## 5. Scope MVP (P0 + P1)

**P0** — Tenant/RBAC · Vendor · Contract · Purchase Request · Invoice · Payment Request · Payment Batch · Audit · Bank import/reconciliation · Duplicate/overpayment controls · Document tasks · Prepayment/Advance.

**P1** — AP/AR aging · Event P&L · 13-week cash forecast · Budget vs actual · Tax/payroll calendar · Close center · Telegram alerts · Excel migration · Vendor statement reconciliation · Owner dashboard.

## 6. Non-goals MVP (P2, не делать)

Didox API live · 1С двусторонняя синхронизация · iiko live API · Bank API execution · Client portal · OCR · AI anomaly detection · Multi-country · Собственный план счетов · Payroll calculation (только payroll run как объект для оплаты).

## 7. Источники истины

| Контур | Source of truth | Роль Finance OS |
|---|---|---|
| Управленческий workflow | Finance OS | Статусы, approvals, остатки, задачи |
| Регламентированный учёт | 1С | Получает данные, возвращает posted-статус |
| Юридически значимые документы | Didox/ЭДО | Ссылки, метаданные, статусы, комплектность |
| Банк | Trustbank / DIBank / др. | Исполнение; Finance OS готовит batch и делает reconciliation |
| F&B / inventory | iiko | Агрегаты для управленческого учёта |
| Коммуникации | Telegram / email | Только уведомления и deep links |
| Файлы | S3 | Версии, права, hash |

## 8. Успех пилота (30 дней Rooftop)

- 0 дублирующих платежей
- ≥95% стандартных платежей проходят через один daily batch
- Urgent вне батча < 10%
- 100% prepayments имеют closing-doc task
- Owner тратит < 5 минут в день на approvals
- Junior закрывает зелёный поток без консультации senior
- Month close D+5

## 9. Operating Charter (10 правил)

1. Всё начинается с объекта/заявки. 2. Один supplier master. 3. Один contract register. 4. Один daily payment batch. 5. Нельзя платить больше outstanding. 6. Duplicate = block. 7. Банк подтверждает факт оплаты. 8. Prepayment всегда порождает closing task. 9. Telegram только уведомляет. 10. Owner управляет через cockpit, junior работает по green-flow.
