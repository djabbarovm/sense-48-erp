# 02 — Data Model

Все таблицы (кроме глобальных `User`, `Holiday`, `FxRate`, `Permission`) содержат `tenant_id UUID NOT NULL` с индексом и FK на `Tenant`. Все таблицы: `id UUID v7 PK`, `created_at`, `updated_at`, `created_by`, `updated_by`. Мягкое удаление только через `status`, физического `DELETE` финансовых объектов нет.

Денежные поля: `BIGINT`, суффикс `_minor` (тийины/центы). Валюта — `currency CHAR(3)`.

## 1. Tenant & доступ

### Tenant
| Поле | Тип | Примечание |
|---|---|---|
| slug | text unique | `rooftop-hall` |
| legal_name | text | |
| tax_id | text | ИНН |
| base_currency | char(3) | UZS |
| vat_rate_bp | int | базисные пункты, 1200 = 12% |
| timezone | text | Asia/Tashkent |
| status | enum ACTIVE/SUSPENDED | |
| settings | jsonb | cutoff_time, sequences, feature flags |

### User (глобальная)
`email unique`, `full_name`, `auth_provider_id`, `mfa_enabled`, `status`, `telegram_chat_id nullable` (хранится только id чата, не токен), `last_login_at`.

### UserTenantRole
`user_id`, `tenant_id`, `role` (enum из D-14), `is_primary`. Unique (user_id, tenant_id, role). Портфельный доступ сервисной команды — набор записей по нескольким tenant.

### Permission / RolePermission
Справочник прав `code` (`pr.create`, `payment.approve.tier2` …) и матрица `role → permission[]`. Заполняется миграцией из `docs/05-rbac.md`.

## 2. Master Data

### Vendor
| Поле | Тип | Примечание |
|---|---|---|
| tax_id | text | ИНН; unique (tenant_id, tax_id) для активных |
| legal_name, display_name | text | |
| category_default_id | FK Category | |
| vat_payer | bool | |
| status | enum ACTIVE/BLOCKED/PENDING_VERIFICATION | |
| risk_flags | text[] | `RELATED_PARTY`, `NEW`, `BANK_CHANGED_RECENTLY`, `CROSS_BORDER` |
| business_owner_id | FK User | |
| contact_name, contact_phone, contact_email | text | |
| verified_callback_channel | text | как подтверждаем реквизиты |
| requires_contract | bool | политика |
| notes | text | |

### VendorBankAccount
`vendor_id`, `bank_name`, `mfo`, `account_masked` (последние 4), `account_encrypted` (AES-GCM, ключ в env), `currency`, `status` enum UNVERIFIED/VERIFIED/RETIRED, `verified_at`, `verified_by`, `verification_method` enum CALLBACK/DOCUMENT/DUAL_APPROVAL, `is_default`. Только одна VERIFIED default на валюту.

### Customer
`tax_id`, `legal_name`, `credit_limit_minor`, `payment_terms_days`, `ar_owner_id`, `status`.

### Contract
| Поле | Тип | Примечание |
|---|---|---|
| number | text | номер договора |
| counterparty_type | enum VENDOR/CUSTOMER | |
| vendor_id / customer_id | FK nullable | ровно одно заполнено |
| subject | text | предмет |
| currency | char(3) | |
| fx_rate | numeric(18,6) nullable | если ≠ base |
| limit_minor | bigint nullable | лимит договора |
| start_date, end_date | date | |
| auto_renew | bool | |
| payment_terms | jsonb | `{type: PREPAY_PCT|POSTPAY_DAYS|SCHEDULE, value}` |
| required_docs | text[] | из checklist |
| registration_required | bool | E-ijara и т.п. |
| registered_at | date nullable | |
| owner_id | FK User | |
| status | enum | см. state machine |
| **computed** | | `value_committed`, `paid_minor`, `outstanding_minor` — через view/функцию, не денормализуется |

### ContractAmendment
`contract_id`, `number`, `date`, `changes jsonb`, `document_id`, `status` DRAFT/SIGNED.

### CostCenter
`code`, `name`, `parent_id nullable`, `is_active`. Rooftop: `RH`, `S48`, `SHARED`. ORDO: по объектам.

### Category
`code`, `name`, `group` enum FNB/SPA/CLEANING/MARKETING/PAYROLL/UTILITIES/RENT/CAPEX/TAX/ADMIN/OTHER, `budget_required bool`, `closing_doc_sla_days int`, `account_code` (для 1С экспорта), `is_active`.

### Employee
`full_name`, `role_title`, `cost_center_id`, `employment_type` enum STAFF/GPH, `status` ACTIVE/TERMINATED, `terminated_at`, `bank_card_status` enum OK/MISSING/EXPIRED, `passport_status` enum OK/MISSING/EXPIRED. **Не хранить** номер паспорта, карты, адрес. Персональные данные — только в 1С/HR.

### BankAccount (свои счета)
`bank_name`, `mfo`, `account_masked`, `account_encrypted`, `currency`, `is_active`, `opening_balance_minor`, `opening_balance_date`.

### FxRate (глобальная)
`date`, `currency`, `rate_to_uzs numeric(18,6)`, `source` CBU/MANUAL.

### Holiday (глобальная)
`date`, `name`, `country` = UZ.

## 3. Планирование

### Event
| Поле | Примечание |
|---|---|
| number | `EVT-2026-0012` |
| customer_id | FK |
| name, event_date, start_time, end_time | |
| format | enum BANQUET/CONFERENCE/PRIVATE/PUBLIC |
| guests_planned, guests_actual | |
| revenue_budget_minor, cost_budget_minor | |
| revenue_lines | jsonb: venue_fee, catering, bar, extras, vat |
| deposit_schedule | jsonb: `[{pct, due_date, received_minor, received_at}]` |
| cost_center_id | |
| owner_id | |
| status | см. state machine |
| **computed** | committed_cost, actual_cost, revenue_actual, ar_outstanding, contribution_margin |

### EventBudgetLine
`event_id`, `category_id`, `planned_minor`, `approved_vendor_ids uuid[]` (для fast lane).

### Budget
`period` (YYYY-MM), `cost_center_id`, `category_id`, `planned_minor`. Unique per (tenant, period, cc, category). `committed`/`actual` — computed.

### ApprovalPolicy
`tenant_id`, `tier1_max_minor`, `tier2_max_minor`, `unbudgeted_requires_owner bool`, `urgent_approver_roles text[]`, `new_vendor_owner_threshold_minor`, `sod_min_tier int`. Версионируется: `effective_from`, `created_by`.

## 4. Purchase-to-Pay

### PurchaseRequest
| Поле | Примечание |
|---|---|
| number | `PR-2026-000123` |
| requester_id | |
| what | text — что покупаем (не «оплатить поставщику») |
| quantity, unit | |
| price_minor, vat_minor, total_minor, currency | |
| purpose | text |
| cost_center_id, category_id | обязательны |
| event_id | nullable; обязателен если category.group ∈ FNB/… и cost_center=RH и есть флаг event_expense |
| needed_by | timestamptz |
| vendor_id | nullable — NEW vendor создаётся отдельно |
| contract_id | nullable |
| budget_status | enum WITHIN/OVER/UNBUDGETED — computed при submit |
| is_urgent, urgency_reason | enum: EVENT_72H / TAX_DEADLINE / SUPPLIER_STOP / SAFETY / OTHER + note |
| is_fast_lane | bool — auto-approved внутри event budget |
| status | см. state machine |
| approvals | → PurchaseApproval[] |

### PurchaseApproval
`pr_id`, `approver_id`, `role`, `decision` APPROVED/REJECTED, `comment`, `decided_at`. Policy engine создаёт «ожидаемые» записи с `decision null`.

### PurchaseOrder
`number`, `pr_id`, `vendor_id`, `contract_id`, `lines jsonb`, `total_minor`, `status` DRAFT/SENT/CONFIRMED/CANCELLED. Опционален для услуг.

### Receipt
`po_id` или `pr_id`, `receiver_id`, `received_at`, `lines jsonb [{desc, qty, value_minor}]`, `evidence_document_ids`, `status` PARTIAL/FULL/REJECTED. Receiver ≠ requester для Tier 2+.

### Invoice (входящая СФ / счёт)
| Поле | Примечание |
|---|---|
| vendor_id | |
| number | номер СФ/счёта |
| date | |
| type | enum SF (счёт-фактура) / INVOICE (счёт на оплату) / ACT / WAYBILL |
| amount_net_minor, vat_minor, amount_gross_minor, currency, fx_rate | |
| edo_document_id | внешний id Didox |
| edo_status | enum NONE/DRAFT/SENT/SIGNED/REJECTED/CANCELLED/CORRECTED |
| is_corrective_of | FK Invoice nullable |
| contract_id, pr_id, po_id, receipt_id | nullable — match |
| match_status | enum UNMATCHED/SUGGESTED/MATCHED/DISPUTED |
| duplicate_of | FK nullable |
| status | см. state machine |
| **unique** | (tenant_id, vendor_id, number, date) — дубликат по этому ключу блокируется |

### PaymentRequest
| Поле | Примечание |
|---|---|
| number | `PAY-2026-000045` |
| source_type | enum PR/CONTRACT/INVOICE/TAX_OBLIGATION/PAYROLL_RUN/ADVANCE/LOAN/BANK_FEE |
| source_id | UUID — обязателен (BR-001) |
| vendor_id | nullable для tax/payroll |
| vendor_bank_account_id | должен быть VERIFIED |
| requested_minor, currency, fx_rate | |
| purpose | structured: category + note |
| cost_center_id, category_id, event_id | |
| due_date | |
| is_prepayment | bool |
| is_urgent, urgency_reason | |
| exception_type | enum nullable OVER_OUTSTANDING/NO_CONTRACT/NO_RECEIPT/UNVERIFIED_BANK/UNBUDGETED |
| exception_reason, exception_approved_by | |
| controls_result | jsonb: `[{code, result: PASS/WARN/FAIL, detail}]` — снимок на момент submit |
| batch_id | FK nullable |
| bank_transaction_id | FK nullable — заполняется при reconciliation |
| paid_at | заполняется только из BankTransaction |
| status | см. state machine |
| prepared_by | = created_by |

### PaymentBatch
`number` `BATCH-2026-09-14`, `batch_date`, `bank_account_id`, `total_minor`, `count`, `cutoff_at`, `status`, `summary jsonb` (by_category, by_urgency, by_control, cash_after, next_7d_commitments, exceptions[]), `export_file_document_id`, `approvals → BatchApproval[]`.

### BatchApproval
`batch_id`, `approver_id`, `role`, `scope` BATCH/ITEM, `payment_request_id nullable`, `decision`, `comment`, `decided_at`.

### BankTransaction
`bank_account_id`, `external_id` (из выписки), `booking_date`, `value_date`, `amount_minor` (знак = направление), `currency`, `counterparty_name`, `counterparty_tax_id`, `counterparty_account_masked`, `purpose_text`, `import_batch_id`, `match_status` UNMATCHED/AUTO_MATCHED/MANUAL_MATCHED/IGNORED, `raw jsonb`. Unique (bank_account_id, external_id).

### ReconciliationMatch
`bank_transaction_id`, `object_type` PAYMENT_REQUEST/AR_INVOICE/ADVANCE/TAX/PAYROLL/OTHER, `object_id`, `amount_minor`, `matched_by`, `method` AUTO/MANUAL, `confidence`.

### Advance (подотчёт / prepayment tracking)
`type` EMPLOYEE_ADVANCE/VENDOR_PREPAYMENT/CORP_CARD, `employee_id / vendor_id`, `payment_request_id`, `amount_minor`, `purpose`, `event_id`, `cost_center_id`, `due_docs_date`, `closed_minor`, `returned_minor`, `status` OPEN/PARTIALLY_CLOSED/CLOSED/OVERDUE/WRITTEN_OFF. Правило: новый employee advance при OVERDUE — блок (BR-040).

## 5. AR

### CustomerInvoice
`number`, `customer_id`, `contract_id`, `event_id`, `date`, `due_date`, `amount_gross_minor`, `vat_minor`, `currency`, `edo_status`, `received_minor` (computed из matches), `status` DRAFT/ISSUED/PARTIALLY_PAID/PAID/OVERDUE/DISPUTED/CANCELLED, `promise_to_pay_date`, `dispute_reason`.

### ArReminderLog
`customer_invoice_id`, `offset_days` (-3/0/+1/+3/+7), `sent_at`, `channel`.

## 6. Compliance & календарь

### TaxObligation
`type` enum VAT/PROFIT/PAYROLL_TAX/SOCIAL/PROPERTY/OTHER, `period`, `due_date`, `expected_min_minor`, `expected_max_minor`, `calculated_minor`, `owner_id`, `payment_request_id`, `filed_at`, `status` PLANNED/CALCULATED/APPROVED/PAID/FILED/OVERDUE. Recurrence из `TaxCalendarRule` (cron-like: `monthly day 20`).

### PayrollRun
`period`, `employee_count`, `gross_minor`, `net_minor`, `taxes_minor`, `register_document_id`, `status` DRAFT/CHECKED/APPROVED/PAID/POSTED, `checked_against_active_list_at`. Хранит только агрегаты; построчный реестр — в документе.

## 7. Документы и задачи

### Document
`object_type`, `object_id`, `doc_type` enum CONTRACT/AMENDMENT/SF/INVOICE/ACT/WAYBILL/POA/RECEIPT/KP/SPEC/MENU/BANK_CONFIRMATION/PAYROLL_REGISTER/OTHER, `file_key` (S3), `file_name`, `mime`, `size`, `sha256`, `version`, `edo_ref`, `edo_status`, `uploaded_by`, `is_required`, `status` PENDING/RECEIVED/REJECTED/EXPIRED.

### DocumentRequirement
Шаблон: `(category_group, payment_type PREPAY/POSTPAY, phase BEFORE_PAYMENT/AFTER_PAYMENT) → doc_type[]`. Из checklist blueprint §10.2.

### Task
`type` enum CLOSING_DOCS/MISSING_DOC/VERIFY_BANK/RECEIPT_PENDING/CONTRACT_EXPIRY/AR_FOLLOWUP/TAX_PREP/UNMATCHED_TX/ADVANCE_RETURN/REVIEW_EXCEPTION, `object_type`, `object_id`, `owner_id`, `due_at`, `escalate_to_id`, `escalated_at`, `status` OPEN/IN_PROGRESS/DONE/CANCELLED/OVERDUE, `next_action` text (обязательно — junior должен видеть, что делать).

### AuditLog (append-only)
`tenant_id`, `actor_id`, `actor_role`, `action` (`payment_request.submit`, `vendor.bank_account.change` …), `object_type`, `object_id`, `before jsonb`, `after jsonb`, `diff_hash` sha256(before||after||prev_hash), `prev_hash`, `ip`, `user_agent`, `at`. Таблица без UPDATE/DELETE grants; hash chain проверяется тестом.

### Sequence
`tenant_id`, `key` (PR/PAY/INV/EVT…), `year`, `next_value`. `SELECT … FOR UPDATE`.

### AccountMapping (1С)
`category_id`, `account_code`, `vat_account_code`, `effective_from`.

## 8. Инварианты (проверяются DB constraints + core)

- `PaymentRequest.source_id` NOT NULL; CHECK source_type valid.
- `PaymentRequest.status = PAID` ⇒ `bank_transaction_id IS NOT NULL` (trigger).
- `Invoice` unique (tenant, vendor, number, date) для status ≠ CANCELLED.
- `VendorBankAccount`: только один VERIFIED+is_default на (vendor, currency).
- `PurchaseRequest`: cost_center_id, category_id NOT NULL.
- `AuditLog`: no UPDATE/DELETE (revoke privileges для app-роли).
- `Sequence`: монотонно, без gaps.
- `Advance`: `closed_minor + returned_minor <= amount_minor`.

## 9. Computed views

`v_contract_balance(contract_id)` → committed / paid / outstanding / requested_pending.
`v_invoice_balance(invoice_id)` → gross / paid / requested_pending / outstanding.
`v_budget_status(period, cc, category)` → planned / committed (PR approved + PAY pending) / actual (PAID) / remaining.
`v_event_pl(event_id)` → revenue_budget / revenue_actual / deposits_received / cost_budget / committed / actual / ar_outstanding / margin.
`v_ap_aging`, `v_ar_aging` — buckets NOT_DUE / 1-7 / 8-30 / 31-60 / 60+.
`v_cash_position(bank_account_id, date)`.
