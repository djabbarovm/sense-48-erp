# 03 — Business Rules

Каждое правило имеет ID, формулировку, поведение системы, роль, которая может сделать exception, и минимальный тест. Тесты в репо называются `BR-xxx_<short>.test.ts`. Уровень: **HARD** = блокировка, **SOFT** = warning + флаг в controls_result, **TASK** = создаёт Task.

## A. Source & duplicates

| ID | Правило | Поведение | Exception | Тест |
|---|---|---|---|---|
| BR-001 | Нет платежа без source object | `PaymentRequest.create` без `source_type+source_id` → ValidationError. Source должен существовать в tenant и быть в статусе, допускающем оплату. | нет | HARD: create без source → 400; с чужим tenant source → 404 |
| BR-002 | Duplicate invoice | При создании/импорте Invoice с (vendor, number, date) существующим → status `DUPLICATE_SUSPECT`, `duplicate_of` заполнен, Task REVIEW_EXCEPTION Lead. Не может быть привязан к PaymentRequest до resolve. | Lead: mark as NOT_DUPLICATE с reason | HARD |
| BR-003 | Duplicate payment по эвристике | PaymentRequest с (vendor, amount ±0, due ±3 дня) и существующим non-cancelled PR → control `DUP_PAYMENT_SUSPECT` = FAIL. | Lead | HARD |
| BR-004 | Один Invoice — одна оплата | Invoice может быть в нескольких PaymentRequest только если `sum(requested non-cancelled) <= gross` (partial). Иначе FAIL. | нет | HARD |
| BR-005 | Один BankTransaction — один match на полную сумму | Сумма matches ≤ abs(amount). | нет | HARD |

## B. Amounts & outstanding

| ID | Правило | Поведение | Exception | Тест |
|---|---|---|---|---|
| BR-010 | `requested <= outstanding` | outstanding берётся из source: contract → v_contract_balance; invoice → v_invoice_balance; PR без invoice → PR.total − paid. Превышение → control `OVER_OUTSTANDING` FAIL. | Owner или Lead с `exception_type=OVER_OUTSTANDING` + reason; фиксируется в audit | HARD |
| BR-011 | Outstanding считает pending | В outstanding вычитаются и PAID, и pending PaymentRequests (status ∈ SUBMITTED…SENT_TO_BANK). Два параллельных PR на один остаток невозможны. | нет | HARD |
| BR-012 | Contract limit | Сумма committed (approved PR + pending PAY + PAID) по договору ≤ `limit_minor`, если задан. | Owner, с amendment task | HARD |
| BR-013 | FX фиксируется на дату документа | Invoice/PaymentRequest в валюте ≠ base обязаны иметь `fx_rate`; берётся из FxRate на дату, иначе ValidationError с подсказкой ввести курс. | Lead вводит вручную с source=MANUAL | HARD |
| BR-014 | Budget check | При submit PR: `remaining = planned − committed − actual` по (period, cc, category). `remaining >= total` → WITHIN; `< total` → OVER (SOFT, требует Owner на любой сумме); нет строки бюджета и `category.budget_required` → UNBUDGETED (HARD → Tier 3). | Owner | HARD/SOFT |

## C. Matching & documents

| ID | Правило | Поведение | Exception | Тест |
|---|---|---|---|---|
| BR-020 | 4-way match для postpay | PaymentRequest source=INVOICE postpay → READY_FOR_BATCH только если: PR approved, Contract active (если requires_contract), Receipt FULL/PARTIAL с value ≥ requested, Invoice MATCHED. Каждый отсутствующий → control FAIL с кодом NO_PR / NO_CONTRACT / NO_RECEIPT / INVOICE_UNMATCHED. | Lead: NO_CONTRACT если vendor.requires_contract=false; NO_RECEIPT только через exception | HARD |
| BR-021 | Prepayment без receipt разрешён | Если `is_prepayment=true`: Receipt не требуется, но требуется Contract с payment_terms PREPAY или approved exception NO_CONTRACT. | Lead/Owner | HARD |
| BR-022 | Prepayment порождает closing task | При переходе PaymentRequest в PAID с `is_prepayment=true` → Advance(VENDOR_PREPAYMENT) + Task CLOSING_DOCS с `due_at` = expected date + `category.closing_doc_sla_days` раб. дней, owner = Document Controller, escalate_to = Lead. | нет | TASK, обязателен |
| BR-023 | Required docs before payment | `DocumentRequirement` для (category_group, payment_type, BEFORE_PAYMENT) должны иметь Document со status RECEIVED. Иначе control `MISSING_DOC:<type>` FAIL. | Lead с reason | HARD |
| BR-024 | Corrective СФ | Invoice.edo_status=CORRECTED или CANCELLED → все связанные не-PAID PaymentRequest → ON_HOLD + Task. PAID → Task REVIEW_EXCEPTION. | — | TASK |
| BR-025 | Backdated documents | Document/Invoice с `date` < today − 30 дней при создании → `backdated_reason` обязателен + reviewer (Lead). | — | HARD |
| BR-026 | Contract expiry | За 30 дней до end_date → Task CONTRACT_EXPIRY owner. PaymentRequest на expired contract → control CONTRACT_EXPIRED FAIL. | Owner | HARD+TASK |

## D. Vendor & bank details

| ID | Правило | Поведение | Exception | Тест |
|---|---|---|---|---|
| BR-030 | Смена реквизитов = UNVERIFIED | Любое создание/изменение VendorBankAccount → status UNVERIFIED, `vendor.risk_flags += BANK_CHANGED_RECENTLY` (снимается через 30 дней), Task VERIFY_BANK. | нет | HARD |
| BR-031 | Платёж только на VERIFIED | PaymentRequest.vendor_bank_account_id должен быть VERIFIED, иначе control UNVERIFIED_BANK FAIL. Нельзя approve-нуть. | нет (только verify) | HARD |
| BR-032 | Verification = dual | VERIFIED ставит один пользователь с `verification_method`, подтверждает второй (≠ первый). Один и тот же user не может сделать оба шага. | — | HARD |
| BR-033 | Bank change + high value | Если реквизиты изменены < 7 дней назад и requested > tier1_max → дополнительный approval Owner даже в Tier 1. | — | HARD |
| BR-034 | Vendor tax_id уникален | Активный vendor с тем же ИНН в tenant → ошибка + ссылка на существующего. | Admin: merge | HARD |
| BR-035 | New vendor threshold | Первый платёж новому vendor (risk_flag NEW, < 90 дней) > `new_vendor_owner_threshold` → Owner approval. | — | HARD |
| BR-036 | Related party | vendor.risk_flags ∋ RELATED_PARTY → любой PaymentRequest требует Owner approval + disclosure note; в batch summary выделяется. | — | HARD |
| BR-037 | ИНН в СФ = ИНН vendor | Invoice.vendor tax_id ≠ tax_id в импорте ЭДО → match_status DISPUTED + Task. | Doc Controller resolve | TASK |

## E. Approvals & segregation

| ID | Правило | Поведение | Exception | Тест |
|---|---|---|---|---|
| BR-040 | Four-eyes | `PaymentRequest.created_by` ≠ финальный approver (BatchApproval с ролью Owner/Lead на этот item). При попытке → 403 `SOD_VIOLATION`. | нет | HARD |
| BR-041 | Policy engine | Tier по `ApprovalPolicy` на дату submit; список requiredApprovals вычисляется один раз и хранится; изменение policy не меняет уже submitted. | — | unit |
| BR-042 | Requester ≠ Receiver (Tier 2+) | Receipt.receiver_id ≠ PR.requester_id если PR.total > tier1_max. | Owner | HARD |
| BR-043 | Urgent | `is_urgent=true` ⇒ `urgency_reason` обязателен; PaymentRequest может попасть в batch после cutoff или в отдельный `URGENT` batch только с approval роли из `urgent_approver_roles`. Пост-review Task Lead. | — | HARD |
| BR-044 | Approve только SUBMITTED/IN_BATCH | Нельзя approve DRAFT/REJECTED/CANCELLED. | — | HARD |
| BR-045 | Reject требует комментарий | Любой REJECTED → comment ≥ 10 символов. | — | HARD |
| BR-046 | Employee advance при overdue | Новый Advance(EMPLOYEE_ADVANCE) при существующем OVERDUE у того же employee → блок. | Owner с reason | HARD |
| BR-047 | Payroll vs active list | PayrollRun → CHECKED только если все employee_id в register имеют status ACTIVE или terminated_at внутри периода. Иначе список расхождений + Task. | — | HARD |

## F. Batch & bank

| ID | Правило | Поведение | Exception | Тест |
|---|---|---|---|---|
| BR-050 | READY_FOR_BATCH только при PASS | Все controls в `controls_result` = PASS, либо FAIL закрыт approved exception. WARN допускается. | — | HARD |
| BR-051 | Один standard batch в день | Второй `STANDARD` batch на ту же дату/счёт → ошибка; используй URGENT. | — | HARD |
| BR-052 | Batch freeze | После `FREEZE` состав неизменен; добавить item → новый batch. | Lead: unfreeze до APPROVED с audit | HARD |
| BR-053 | Cash after ≥ 0 | `cash_after = balance − batch_total − committed_next_7d` < 0 → WARN в summary, Owner видит. | — | SOFT |
| BR-054 | PAID только из банка | Переход в PAID только через ReconciliationMatch на BankTransaction с amount = requested (±1% для FX). Любой другой путь → исключение в core. | — | HARD |
| BR-055 | Auto-match | BankTransaction auto-match если: counterparty_tax_id = vendor.tax_id AND amount совпадает AND есть PaymentRequest SENT_TO_BANK на этот vendor. Иначе SUGGESTED (confidence) + Task UNMATCHED_TX junior. | — | unit |
| BR-056 | Import idempotent | Повторный импорт выписки с теми же external_id → skip, отчёт. | — | HARD |
| BR-057 | Bank export = frozen batch | Экспорт CSV возможен только из APPROVED batch; файл сохраняется как Document с sha256. | — | HARD |

## G. AR

| ID | Правило | Поведение | Exception | Тест |
|---|---|---|---|---|
| BR-060 | Reminders | CustomerInvoice ISSUED → jobs на T−3, T0, +1, +3, +7 → ArReminderLog + Telegram AR owner (без сумм в чате). | — | worker test |
| BR-061 | Event close | Event → CLOSED только если: все PaymentRequest по event_id ∈ {PAID, CANCELLED}, все Advance CLOSED, все CustomerInvoice PAID, нет Task OPEN. | Owner с reason | HARD |
| BR-062 | Deposit gating | Event переход в CONFIRMED требует первый deposit received ≥ schedule[0].pct. | Owner | SOFT |

## H. Audit & security

| ID | Правило | Поведение | Тест |
|---|---|---|---|
| BR-070 | Audit на всё | Любая мутация сущностей из §3–7 data model → AuditLog запись в той же транзакции. | integration: 100% покрытие мутаций |
| BR-071 | Hash chain | `diff_hash = sha256(prev_hash + canonical(before) + canonical(after))`. Job проверяет цепочку ежедневно. | unit + job |
| BR-072 | Secret scan | Regex-фильтр на OTP-подобные строки (`\b\d{4,8}\b` в полях comment/purpose при наличии слов otp/код/пароль) → отказ сохранения с подсказкой. Логи не содержат `account_encrypted`, `bot_token`. | unit |
| BR-073 | Tenant scope | Каждый repository-метод принимает `TenantContext`; запрос без него — compile-time error (тип). | permission tests |
| BR-074 | Mask bank data | UI показывает только `account_masked`; полный номер — только роли с `vendor.bank.reveal` и с audit записью. | permission test |
