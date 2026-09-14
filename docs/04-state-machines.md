# 04 — State Machines

Формат: `FROM → TO : trigger [роль] (guard)`. Все переходы идут через `packages/core/workflows/*.ts`, никаких прямых `UPDATE status`. Каждый переход пишет AuditLog. Недопустимый переход → `IllegalTransitionError`.

## PurchaseRequest

```
DRAFT → SUBMITTED        : submit [REQUESTER] (все обязательные поля; budget_status вычислен)
SUBMITTED → APPROVED     : approve [BUSINESS_OWNER/FINANCE/OWNER по policy] (все required approvals = APPROVED)
SUBMITTED → REJECTED     : reject [любой approver] (comment)
SUBMITTED → DRAFT        : return_for_edit [FINANCE]
DRAFT → SUBMITTED → APPROVED : fast_lane [система] (is_fast_lane && event.status=CONFIRMED && vendor ∈ EventBudgetLine.approved_vendor_ids && total <= line remaining)
APPROVED → ORDERED       : create_po [JUNIOR]
APPROVED|ORDERED → RECEIVED : receipt_full [receiver]
APPROVED|ORDERED|RECEIVED → INVOICED : link_invoice [JUNIOR/DOC_CONTROLLER]
INVOICED → PAID          : (авто) все PaymentRequest по source PAID
PAID → CLOSED            : (авто) closing docs RECEIVED
любой (кроме PAID/CLOSED) → CANCELLED : cancel [REQUESTER до APPROVED; FINANCE после] (comment)
```

## Invoice (входящая)

```
RECEIVED → DUPLICATE_SUSPECT : (авто) BR-002
DUPLICATE_SUSPECT → RECEIVED : mark_not_duplicate [LEAD] (reason)
DUPLICATE_SUSPECT → CANCELLED: confirm_duplicate [LEAD]
RECEIVED → MATCHED         : match [JUNIOR/DOC_CONTROLLER] (contract или pr привязан; ИНН совпадает)
RECEIVED → DISPUTED        : dispute [JUNIOR/DOC_CONTROLLER] (reason)
DISPUTED → MATCHED | CANCELLED
MATCHED → PARTIALLY_PAID → PAID : (авто) по PaymentRequest PAID
MATCHED|PAID → CORRECTED   : edo_corrected [EdoAdapter] → BR-024
любой → CANCELLED          : edo_cancelled [EdoAdapter] или cancel [LEAD]
```

## PaymentRequest

```
DRAFT → SUBMITTED          : submit [JUNIOR/REQUESTER] (source valid, bank VERIFIED, amount<=outstanding или exception_type задан)
SUBMITTED → DOCS_CHECK     : (авто) run_controls → controls_result
DOCS_CHECK → READY_FOR_BATCH : (авто) all PASS || FAIL closed by exception (BR-050)
DOCS_CHECK → ON_HOLD       : (авто) есть FAIL без exception → Task с next_action
ON_HOLD → DOCS_CHECK       : resolve [JUNIOR/DOC_CONTROLLER/LEAD] (после загрузки doc / approve exception)
READY_FOR_BATCH → IN_BATCH : add_to_batch [JUNIOR] (batch.status=OPEN)
IN_BATCH → READY_FOR_BATCH : remove_from_batch [JUNIOR/LEAD] (batch не FROZEN)
IN_BATCH → APPROVED        : (авто) batch APPROVED или item approved
IN_BATCH → REJECTED        : reject_item [OWNER/LEAD] (comment)
APPROVED → SENT_TO_BANK    : mark_sent [JUNIOR/LEAD] (batch export создан)
SENT_TO_BANK → PAID        : (авто) ReconciliationMatch (BR-054)
SENT_TO_BANK → FAILED      : bank_reject [JUNIOR] (reason из выписки) → Task
FAILED → DRAFT             : recreate [JUNIOR]
PAID → RECONCILED          : (авто) match confirmed && docs after-payment не требуются
PAID → RECONCILED          : (авто) closing docs RECEIVED (если is_prepayment)
RECONCILED → CLOSED        : (авто) accounting posted (1С import) || manual [ACCOUNTANT]
DRAFT|SUBMITTED|DOCS_CHECK|ON_HOLD|READY_FOR_BATCH → CANCELLED : cancel [creator/LEAD]
любой до SENT_TO_BANK → DISPUTED : dispute [LEAD] (reason)
```

Инвариант: PAID/RECONCILED/CLOSED ⇒ `bank_transaction_id NOT NULL` (DB trigger).

## PaymentBatch

```
OPEN → FROZEN      : freeze [JUNIOR/LEAD] (обычно в 14:00 по cron; items > 0; summary сгенерирован)
FROZEN → OPEN      : unfreeze [LEAD] (до REVIEWED; audit)
FROZEN → REVIEWED  : review [LEAD] (4-eyes: reviewer ≠ любой prepared_by внутри? нет — reviewer ≠ freeze actor)
REVIEWED → APPROVED: approve [OWNER] (все items approved или rejected; BR-040 на каждом item)
REVIEWED → PARTIALLY_APPROVED : approve с rejected items → rejected items выходят из batch
APPROVED → EXPORTED: export [JUNIOR/LEAD] (CSV Document создан, BR-057)
EXPORTED → SENT    : mark_sent [JUNIOR] (все items SENT_TO_BANK)
SENT → SETTLED     : (авто) все items PAID или FAILED
любой до APPROVED → CANCELLED : cancel [LEAD]
```

Тип batch: `STANDARD` (один в день, BR-051) или `URGENT` (несколько; каждый item BR-043).

## Contract

```
DRAFT → IN_REVIEW → APPROVED → SIGNED → (REGISTERED если registration_required) → ACTIVE
ACTIVE → AMENDING → ACTIVE          : amendment signed
ACTIVE → EXPIRING                   : (авто) end_date − 30d → Task
EXPIRING → ACTIVE                   : renew [OWNER] (новый end_date / auto_renew)
EXPIRING|ACTIVE → EXPIRED           : (авто) end_date < today
ACTIVE|EXPIRED → TERMINATING → CLOSED : terminate [OWNER] → CLOSED когда outstanding=0 && нет OPEN task
```

## Vendor

```
PENDING_VERIFICATION → ACTIVE : verify [LEAD, второй = ≠ создатель] (bank account VERIFIED, tax_id проверен)
ACTIVE → BLOCKED               : block [LEAD/OWNER] (reason) → все pending PaymentRequest → ON_HOLD
BLOCKED → ACTIVE               : unblock [OWNER]
```

## VendorBankAccount

```
UNVERIFIED → VERIFIED : verify_step1 [JUNIOR/LEAD] + verify_step2 [другой LEAD/OWNER] (BR-032)
VERIFIED → RETIRED    : retire [LEAD]
любое изменение поля account → новая запись UNVERIFIED, старая RETIRED (не редактируется in-place)
```

## Advance

```
OPEN → PARTIALLY_CLOSED → CLOSED : add_closing_doc / add_return [DOC_CONTROLLER/JUNIOR]
OPEN|PARTIALLY_CLOSED → OVERDUE  : (авто) due_docs_date < today → Task escalate
OVERDUE → CLOSED                 : как выше
OVERDUE → WRITTEN_OFF            : write_off [OWNER] (reason; Accountant notified)
```

## Event

```
DRAFT → QUOTED       : quote [REQUESTER/sales] (revenue_lines заполнены)
QUOTED → CONFIRMED   : confirm [OWNER/sales] (BR-062 deposit; cost_budget lines заданы)
CONFIRMED → IN_PROGRESS : (авто) event_date = today
IN_PROGRESS → HELD   : mark_held [sales] (guests_actual)
HELD → SETTLING      : (авто) — ожидание invoices/acts/AR
SETTLING → CLOSED    : close [LEAD] (BR-061)
DRAFT|QUOTED|CONFIRMED → CANCELLED : cancel (refund tasks если deposits received)
```

## CustomerInvoice

```
DRAFT → ISSUED → PARTIALLY_PAID → PAID
ISSUED|PARTIALLY_PAID → OVERDUE : (авто) due_date < today
OVERDUE → PARTIALLY_PAID|PAID    : reconciliation
ISSUED|OVERDUE → DISPUTED → ISSUED|CANCELLED
```

## TaxObligation

```
PLANNED → CALCULATED [ACCOUNTANT] → APPROVED [LEAD/OWNER] → (PaymentRequest source=TAX_OBLIGATION) → PAID (авто) → FILED [ACCOUNTANT]
любой до PAID → OVERDUE (авто) → escalation OWNER
```

## Task

```
OPEN → IN_PROGRESS → DONE
OPEN|IN_PROGRESS → OVERDUE (авто) → escalated_at, escalate_to получает уведомление
любой → CANCELLED (с reason, если объект закрыт иначе)
```
