# 06 — Экраны MVP

Общие правила UI:
- Mobile-first для Owner и Requester экранов (My Approvals, Purchase Request, Owner Dashboard). Desktop-first для операционных.
- Каждый объект имеет карточку `/t/[tenant]/[type]/[number]` — deep link из Telegram ведёт туда.
- Красный кейс всегда показывает **почему заблокировано** (control code + human text) и **кому эскалировать** (role + кнопка «Эскалировать»).
- Зелёный кейс показывает **next_action** одной строкой.
- Free-text только там, где перечислено; остальное — селекты/enum.
- Суммы: `12 500 000 сум`; валюта договора + эквивалент в UZS.
- Все таблицы: сортировка, фильтр по статусу, экспорт CSV (если есть `report.export`).

## 1. Owner Dashboard (`/dashboard`)
**Роли:** OWNER, LEAD. **Mobile-first.**
Виджеты (каждый — drill-down до объекта):
- Cash: остаток по счетам сейчас; обязательства 7 дней; 13-week forecast (спарклайн); runway.
- Today's batch: сумма, кол-во, статус, кнопка «Открыть approvals».
- AP: due this week / overdue / advances without docs.
- AR: overdue / expected 7 & 30 days / top-3 debtors.
- Taxes: ближайшие 3 дедлайна с expected.
- Events: ближайшие 5 — revenue, committed, margin.
- Documents: missing / expired / rejected — счётчики.
- Controls: urgent % (30d), duplicates prevented, open exceptions.
- Budget: actual vs plan текущего месяца по cost center (bar).

## 2. My Approvals (`/approvals`)
**Роли:** все, у кого есть pending approvals. **Mobile-first, решение за 15–30 сек.**
Карточка item: сумма; vendor (+ флаги NEW/RELATED/BANK_CHANGED); «что покупаем»; purpose; event; contract outstanding до/после; budget status; docs status (✓/✗ списком); cash impact; exception flags с текстом. Кнопки: Approve / Reject (обязателен comment) / Ask (создаёт Task requester'у).
Batch-режим: заголовок summary (total, count, by category, exceptions), «Approve all green», отдельные toggle на красных.

## 3. Purchase Request (`/pr/new`, `/pr/[n]`)
**Роли:** REQUESTER+. **Mobile form.**
Поля по `docs/02` PurchaseRequest. Vendor — поиск по имени/ИНН; «Новый vendor» → мини-форма (имя, ИНН, контакт) → PENDING. Event — селект из CONFIRMED/IN_PROGRESS. Budget status показывается сразу после выбора cc+category+сумма. Attachments — камера/файл. При `needed_by` < 72h — предлагает fast lane если применимо, иначе urgency_reason.
Карточка PR: timeline статусов, approvals, linked PO/Receipt/Invoice/PaymentRequest, документы, аудит.

## 4. Vendor 360 (`/vendors/[id]`)
Табы: Профиль (flags, owner, статус, requires_contract) · Bank accounts (masked, статус, verify actions) · Contracts (с балансами) · Invoices · Payments · AP (aging) · Documents · Audit.
Действия: block/unblock, change bank (→ UNVERIFIED workflow), merge (Admin).

## 5. Contract 360 (`/contracts/[id]`)
Шапка: limit / committed / paid / outstanding / requested pending, expiry, статус. Табы: Условия · Amendments · Payments · Invoices · Required docs (✓/✗) · Audit. Действия по state machine.

## 6. Invoice Inbox (`/invoices`)
Очередь: RECEIVED / DUPLICATE_SUSPECT / DISPUTED. Импорт Excel-реестра (Didox mock). Для каждой — match suggestions (contract/PR по vendor + сумма ±5% + дата), кнопки Match / Dispute / Mark duplicate. Показ edo_status.

## 7. Payment Desk (`/payments`)
Три колонки/фильтра: Ready (READY_FOR_BATCH), Blocked (ON_HOLD с причинами), Pending docs. Действие «Собрать batch» → выбирает все Ready на выбранном счёте. Создание PaymentRequest из PR/Invoice/Contract/Tax/Payroll — визард, показывающий outstanding и результат controls до submit.

## 8. Payment Batch (`/batches/[n]`)
Summary (по D-13 / blueprint §8.2): total, count, by category, by urgency, by control status, cash after, next 7 days commitments, exceptions list. Items с чекбоксами (до FROZEN). Кнопки по роли: Freeze / Review / Approve / Export CSV / Mark sent. История approvals. Статус каждого item после отправки.

## 9. Bank Reconciliation (`/bank`)
Импорт файла (drag&drop, отчёт: imported/skipped/errors). Таблица транзакций: Matched / Suggested / Unmatched. Для suggested — accept/reject; для unmatched — manual match (поиск объекта) или Ignore с reason. Cash position по счетам.

## 10. AP Aging (`/ap`) / 11. AR Aging (`/ar`)
Buckets, по vendor/customer, drill-down. AR: reminders log, promise-to-pay, dispute. Vendor statement reconciliation: загрузка statement → сравнение с системой → расхождения.

## 12. Event P&L (`/events/[n]`)
Шапка: дата, клиент, гости, статус. Revenue: budget / invoiced / received (deposits timeline). Cost: budget lines vs committed vs actual по category. Margin: plan / current / final. Linked PR/Payments/Advances/AR/Tasks. Кнопка Close (показывает блокеры BR-061).

## 13. Budget (`/budget`)
Матрица period × cc × category: plan / committed / actual / remaining. Редактирование plan (Owner/Lead). Импорт из Excel.

## 14. Document Health (`/documents/health`)
Красные зоны из blueprint §10.3 как отдельные списки: paid without SF; paid without act > SLA; expired contracts; unmatched invoices; missing POA; unsigned amendments; advances > X days; termination not closed; vendor bank changed. Каждый — список объектов с owner и Task.

## 15. Tax Calendar (`/tax`)
Календарь + список: тип, период, due, expected range, calculated, статус, owner. Создать PaymentRequest из obligation. Настройка правил (Admin/Lead).

## 16. Close Center (`/close/[period]`)
Чеклист из blueprint §27.3, каждая строка: owner, статус, ссылка на экран. Прогресс. Кнопка «Сформировать month-end pack» (PDF/XLSX: P&L, cash flow, AP/AR aging, tax, events, payroll aggregate, variances, forecast, exceptions).

## 17. Admin (`/admin`)
Tenant settings (cutoff, VAT, currency, timezone) · Users & roles · Approval policy (versioned) · Cost centers / Categories / Account mapping · Document requirements · Tax calendar rules · Bank accounts · Sequences · Feature flags.

## Служебные
- Tasks (`/tasks`): мои / портфель, фильтр по type/status, next_action, escalate.
- Audit (`/audit`): фильтр по object, actor, action; diff viewer.
- Portfolio (`/portfolio`): для сервисной команды — сводка по всем tenant: batches today, blocked, overdue tasks.
