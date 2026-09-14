# 14 — Трассируемость (G-07)

BR в спецификации: 49 · покрыты тестами: 49 · только в коде: 0 · без упоминаний: 0

## BR → тесты
| BR | Тесты | Код |
|---|---|---|
| BR-001 | payments.test.ts | payments.ts, tax.ts |
| BR-002 | invoices.test.ts, payments.test.ts | invoices.ts, kpi.ts, payments.ts |
| BR-003 | payments.test.ts | payments.ts |
| BR-004 | br-gaps.test.ts | — |
| BR-005 | br-gaps.test.ts | bank.ts |
| BR-010 | payments.test.ts | payments.ts, phaseC.ts |
| BR-011 | br-gaps.test.ts | payments.ts |
| BR-012 | br-gaps.test.ts | payments.ts |
| BR-013 | br-gaps.test.ts | invoices.ts, payments.ts |
| BR-014 | budgets.test.ts, engine.test.ts | budgets.ts, engine.ts, payments.ts |
| BR-020 | payments.test.ts | payments.ts |
| BR-021 | br-gaps.test.ts | payments.ts |
| BR-022 | bank-reconciliation.test.ts | advances.ts, bank.ts |
| BR-023 | documents.test.ts, payments.test.ts | documents.ts, payments.ts |
| BR-024 | adapters-e.test.ts, invoices.test.ts | edo.ts, invoices.ts |
| BR-025 | invoices.test.ts | invoices.ts, payments.ts |
| BR-026 | contracts.test.ts | contracts.ts, payments.ts |
| BR-030 | vendors.test.ts | documentHealth.ts, payments.ts, vendors.ts |
| BR-031 | payments.test.ts | payments.ts, phaseC.ts |
| BR-032 | vendors.test.ts | vendors.ts |
| BR-033 | engine.test.ts | engine.ts, payments.ts |
| BR-034 | constraints.test.ts, vendors.test.ts | vendors.ts |
| BR-035 | engine.test.ts | engine.ts, payments.ts |
| BR-036 | engine.test.ts, payments.spec.ts | batches.ts, engine.ts, payments.ts |
| BR-037 | invoices.test.ts | invoices.ts |
| BR-040 | batches.test.ts | batches.ts, index.ts, paymentRequest.ts |
| BR-041 | engine.test.ts, policies.test.ts | engine.ts, policies.ts, purchaseRequests.ts |
| BR-042 | receiving.test.ts | receiving.ts |
| BR-043 | batches.test.ts, purchase-requests.test.ts | batches.ts, payments.ts, purchaseRequests.ts |
| BR-044 | purchase-requests.test.ts | purchaseRequests.ts |
| BR-045 | purchase-requests.test.ts | batches.ts, paymentRequest.ts, purchaseRequest.ts |
| BR-046 | bank-reconciliation.test.ts | advances.ts |
| BR-047 | tax-payroll.test.ts | actions.ts, payments.ts, payroll.ts |
| BR-050 | br-gaps.test.ts | kpi.ts, paymentRequest.ts, payments.ts |
| BR-051 | batches.test.ts | batches.ts, paymentBatch.ts |
| BR-052 | batches.test.ts | paymentRequest.ts |
| BR-053 | batches.test.ts | batches.ts, page.tsx |
| BR-054 | aging.test.ts, bank-reconciliation.test.ts, migration.test.ts, payments.test.ts | arInvoices.ts, bank.ts, migration.ts |
| BR-055 | bank-reconciliation.test.ts | bank.ts |
| BR-056 | bank-reconciliation.test.ts, bank.spec.ts | bank.ts |
| BR-057 | batches.test.ts | batches.ts, route.ts |
| BR-060 | ar-invoices.test.ts, jobs.test.ts | arInvoices.ts |
| BR-061 | events.test.ts | event.ts, events.ts |
| BR-062 | events.test.ts | event.ts, events.ts |
| BR-070 | audit.test.ts | audit.ts, types.ts |
| BR-071 | br-gaps.test.ts | audit.ts, canonical.ts, hash.ts |
| BR-072 | acceptance.test.ts, jobs.test.ts, security.test.ts | arInvoices.ts, index.ts, payments.ts |
| BR-073 | aging.test.ts, cross-tenant-fuzz.test.ts, tenant-context.test.ts | context.ts, index.ts, repository.ts |
| BR-074 | vendors.test.ts | index.ts, vendors.ts |

## AC → тесты
| AC | Файлы |
|---|---|
| AC-01 | acceptance.test.ts, purchase-requests.test.ts |
| AC-02 | acceptance.test.ts |
| AC-03 | acceptance.test.ts |
| AC-04 | acceptance.test.ts, payments.test.ts |
| AC-05 | acceptance.test.ts, payments.test.ts |
| AC-06 | acceptance.test.ts, batches.test.ts |
| AC-07 | batches.test.ts |
| AC-08 | acceptance.test.ts, bank-reconciliation.test.ts |
| AC-09 | bank-reconciliation.test.ts |
| AC-10 | acceptance.test.ts |
| AC-11 | acceptance.test.ts, cross-tenant-fuzz.test.ts |
| AC-12 | acceptance.test.ts |
| AC-13 | acceptance.test.ts |
| AC-14 | acceptance.test.ts |
| AC-15 | batches.test.ts |
| AC-16 | acceptance.test.ts, payments.test.ts |
| AC-17 | acceptance.test.ts |
| AC-18 | acceptance.test.ts |
| AC-19 | acceptance.test.ts |
| AC-20 | acceptance.test.ts |
| AC-21 | acceptance.test.ts |
| AC-22 | acceptance.test.ts |

## Экраны → роуты (33)
- `/`
- `/admin`
- `/ap`
- `/approvals`
- `/ar`
- `/audit`
- `/bank`
- `/batches`
- `/batches/[id]`
- `/budget`
- `/close`
- `/contracts`
- `/contracts/[id]`
- `/controls`
- `/dashboard`
- `/documents/health`
- `/events`
- `/events/[id]`
- `/forecast`
- `/invoices`
- `/migration`
- `/onec`
- `/payments`
- `/payments/new`
- `/payroll`
- `/portfolio`
- `/pr`
- `/pr/[id]`
- `/pr/new`
- `/tasks`
- `/tax`
- `/vendors`
- `/vendors/[id]`

