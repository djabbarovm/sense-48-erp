# 09 — Acceptance Tests

Каждый критерий = один или несколько автоматизированных сценариев (`tests/acceptance/AC-xx.spec.ts`). Система принята, когда все зелёные. Формат: Given / When / Then. Роли — из seed (`owner@rooftop`, `lead@fos`, `junior@fos`, `doc@fos`, `acct@fos`, `chef@rooftop`, `admin@fos`).

## AC-01 PR с полным контекстом
Given chef@rooftop. When создаёт PR «Лосось 20 кг» для event EVT-2026-0003, cc=RH, category=FNB, сумма 8 000 000, attachment КП. Then PR SUBMITTED, budget_status WITHIN, required approvals = [business_owner] (Tier 1), Task у approver. Negative: без cost_center → 400 `cost_center_id required`.

## AC-02 Invoice import и match
Given реестр Didox XLSX с 5 СФ, одна на vendor без записи. When doc@fos импортирует. Then 4 Invoice RECEIVED, 1 Vendor PENDING_VERIFICATION создан + Task, отчёт errors=0. Для СФ vendor FOOD SUPPLY на 8 000 000 → suggestion к PR из AC-01 (confidence ≥ 0.8).

## AC-03 Contract balance
Given contract 12/2026 limit 50 000 000, paid 20 000 000, pending PAY 5 000 000. When открыть Contract 360. Then committed/paid/outstanding/requested = 25/20/30/5 (в млн). API `GET /contracts/:id/balance` совпадает.

## AC-04 Duplicate blocked
Given Invoice #118 от 10.09 vendor X 12 500 000 MATCHED. When импорт того же (vendor, number, date). Then вторая → DUPLICATE_SUSPECT, duplicate_of = первая, Task REVIEW_EXCEPTION lead@fos; попытка создать PaymentRequest на неё → 400 `INVOICE_DUPLICATE_SUSPECT`. When lead mark_not_duplicate reason «корректировочная» → RECEIVED.

## AC-05 Missing doc → не в green batch
Given PaymentRequest postpay services без ACT. When submit. Then controls_result содержит `MISSING_DOC:ACT = FAIL`, status ON_HOLD, Task MISSING_DOC у doc@fos с next_action «Загрузить акт по …». When doc загружает ACT + mark_received → status READY_FOR_BATCH.

## AC-06 Batch summary
Given 6 READY items (3 FNB, 1 TAX, 1 MARKETING, 1 urgent), баланс счёта 100 млн, committed next 7d 30 млн. When junior собирает и freeze. Then summary: total, count=6, by_category 3 группы, by_urgency {standard:5, urgent:1}, cash_after = 100 − total − 30, exceptions пусто. Negative: второй STANDARD batch на ту же дату → 409.

## AC-07 Approve/reject items
Given FROZEN→REVIEWED batch. When owner reject item #3 с comment. Then batch PARTIALLY_APPROVED, item #3 REJECTED и выведен, остальные APPROVED. Reject без comment → 400.

## AC-08 Bank match → PAID
Given batch EXPORTED/SENT, items SENT_TO_BANK. When junior импортирует выписку с транзакциями по tax_id и суммам. Then items → PAID с bank_transaction_id, batch SETTLED. Negative: `PATCH /payments/:id {status:'PAID'}` → 405/400 `PAID_REQUIRES_BANK_CONFIRMATION`; прямой SQL UPDATE status='PAID' без bank_transaction_id → trigger error.

## AC-09 Prepayment → closing task
Given PaymentRequest is_prepayment, category SERVICES (SLA 10 раб. дней), service date 20.09. When PAID через AC-08. Then Advance VENDOR_PREPAYMENT OPEN, Task CLOSING_DOCS owner doc@fos, due_at = 20.09 + 10 раб. дней (праздники учтены), escalate_to lead@fos. When due прошёл без docs → Advance OVERDUE, Task OVERDUE, Telegram lead.

## AC-10 Dashboard drill-down
Given owner@rooftop. When открывает Dashboard → AP overdue (3) → клик → список → клик → PaymentRequest карточка → linked Invoice → Document. Then каждая ссылка резолвится, 200, данные согласованы с агрегатом.

## AC-11 Tenant isolation
Given junior@fos имеет роли в rooftop и ordo; chef@rooftop только rooftop. When chef запрашивает `/t/ordo/pr/PR-2026-000001` и API → 404. When junior под контекстом rooftop запрашивает объект ordo по id → 404. Fuzz: 200 случайных id из tenant B под контекстом A → все 404.

## AC-12 Audit lifecycle
Given PaymentRequest прошёл DRAFT→…→CLOSED. When `GET /audit?object=payment_request:<id>`. Then ≥ 9 записей, каждый переход с actor/role/before/after, hash chain валиден (`verifyChain()` = true). Попытка `DELETE FROM audit_log` под app-ролью → permission denied.

## AC-13 Secrets never stored
Given comment «код 483920 от банка» на PaymentRequest. When save. Then 400 `SECRET_LIKE_CONTENT`. Grep всех логов/seed/тестов на паттерны OTP/карт (16 цифр Luhn) → 0. `account_encrypted` не встречается в logs.

## AC-14 Junior green flow без senior
Given seed с 5 green PaymentRequest. When junior@fos: импорт выписки → match unmatched (1 manual) → Payment Desk → собрать batch → freeze → summary отправлена. Then ни один шаг не требует роли Lead; все Tasks junior имеют next_action; 0 exceptions создано.

## AC-15 Four-eyes
Given lead@fos создал PaymentRequest сам. When lead пытается approve этот item в batch (policy делегирует Lead approve). Then 403 `SOD_VIOLATION`. Owner approve → 200.

## AC-16 Overpayment blocked
Given invoice outstanding 4 000 000. When PaymentRequest 4 000 001. Then OVER_OUTSTANDING FAIL, ON_HOLD. When owner approve exception reason «доплата за доставку по согласованию». Then READY. Audit содержит exception.

## AC-17 Bank details change
Given vendor VERIFIED account. When junior меняет счёт. Then новая запись UNVERIFIED, старая RETIRED, vendor.risk_flags ∋ BANK_CHANGED_RECENTLY, Task VERIFY_BANK, Telegram SECURITY_ALERT owner. PaymentRequest на новый счёт → UNVERIFIED_BANK FAIL. verify_step1 junior + verify_step2 junior (тот же) → 403; verify_step2 lead → VERIFIED.

## AC-18 Event P&L и close
Given EVT с revenue budget 60 млн, deposit 30% received, 4 PR (2 PAID, 1 READY, 1 CANCELLED), 1 Advance OPEN, AR issued 42 млн not paid. When lead пытается close. Then 409 с блокерами: [PaymentRequest READY, Advance OPEN, AR unpaid]. После устранения → CLOSED; margin = revenue_actual − actual_cost.

## AC-19 Tax obligation flow
Given TaxCalendarRule VAT monthly day 20. When job на 1-е число. Then TaxObligation PLANNED due 20-го, owner acct. acct CALCULATED 15 млн → lead APPROVED → PaymentRequest source TAX → batch → PAID → acct FILED. Дедлайн −7/−3/−1 → уведомления.

## AC-20 Excel migration
Given `templates/vendors.xlsx` с 30 строками, 2 с дублирующимся ИНН. When импорт. Then all-or-nothing: 0 создано, отчёт 2 errors с row/field. После исправления → 30 создано, 30 audit записей.

## AC-21 13-week forecast
Given seed cash plan. When открыть forecast. Then 13 колонок, opening→ending непрерывны, суммы по строкам = источникам (batches, AR expected, tax, payroll, cash plan lines). Snapshot сохраняется; на следующей неделе accuracy = 1 − |forecast−actual|/actual.

## AC-22 Month close pack
Given period 2026-08 закрыт. When «Сформировать pack». Then XLSX с листами P&L, CashFlow, AP, AR, Tax, Events, Payroll, Variances, Forecast, Exceptions; PDF summary 2 стр. Числа P&L сходятся с `v_*` view.
