# 10 — Seed Data (синтетические)

Никаких реальных ИНН, счетов, имён сотрудников. ИНН — 9 цифр, начинаются с 30/31 и проходят простой checksum-заглушку. Счета — 20 цифр, генерируются. Имена вендоров — вымышленные, но правдоподобные для Ташкента.

## Tenants
| slug | legal_name | tax_id | cutoff | vat |
|---|---|---|---|---|
| rooftop-hall | ООО «Rooftop Hall» | 30xxxxxxx | 14:00 | 12% |
| sense48 | ООО «Sense 48» | 30xxxxxxx | 14:00 | 12% |
| ordo | ООО «ORDO Management» | 31xxxxxxx | 14:00 | 12% |

## Users (пароль dev: `Passw0rd!`, MFA off в dev)
| email | роли |
|---|---|
| owner@rooftop.test | OWNER (rooftop-hall, sense48) |
| owner@ordo.test | OWNER (ordo) |
| lead@fos.test | FINANCE_OPS_LEAD (все 3) |
| junior@fos.test | JUNIOR_FINANCE (все 3) |
| doc@fos.test | DOCUMENT_CONTROLLER (все 3) |
| acct@fos.test | ACCOUNTANT (все 3) |
| admin@fos.test | ADMIN (все 3) |
| chef@rooftop.test | REQUESTER (rooftop-hall), cost_center_owner RH-KITCHEN |
| sales@rooftop.test | REQUESTER (rooftop-hall) с event.confirm |
| spa@sense48.test | REQUESTER (sense48) |
| pm@ordo.test | REQUESTER (ordo) |

## Cost centers
rooftop-hall: RH (root), RH-KITCHEN, RH-BAR, RH-EVENTS, RH-ADMIN, SHARED. sense48: S48, S48-RETAIL, S48-TREATMENT. ordo: ORDO-HQ, ORDO-TOWER, ORDO-MALL.

## Categories (общие, с closing_doc_sla_days и account_code)
FNB_FOOD(5) · FNB_BEVERAGE(5) · SPA_CONSUMABLES(5) · SPA_RETAIL(5) · LINEN_LAUNDRY(10) · CLEANING(10) · MARKETING(10) · DECOR_AV(5) · STAFF_GPH(10) · PAYROLL(0) · UTILITIES(10) · RENT(10) · CAPEX(15) · TAX(0) · ADMIN(10) · SECURITY(10) · FM_SERVICES(10) · REPAIR(10).

## Vendors (~30)
Распределение: 12 FNB, 4 SPA, 3 marketing, 3 cleaning/laundry, 2 rent (один RELATED_PARTY), 2 utilities, 2 FM (ordo), 2 NEW (< 90 дней), 1 BLOCKED, 1 PENDING_VERIFICATION, 1 с BANK_CHANGED_RECENTLY. У 3 vendors — 2 bank accounts (один RETIRED). 2 vendors в USD.

## Contracts (~12)
- 6 supply (FNB) с лимитами и POSTPAY 7/14 дней
- 2 rent: «Аренда 48 этажа» (registration_required, ACTIVE), «Smart Teams Rent» (EXPIRING, end_date +20 дней)
- 1 marketing PREPAY 50%
- 1 laundry SCHEDULE monthly
- 1 USD equipment CAPEX PREPAY 30/70
- 1 ordo FM service

## Budgets
2026-08 и 2026-09 по всем cc × основным category. Одна строка намеренно перерасходована (RH-BAR / FNB_BEVERAGE сентябрь).

## Events (rooftop-hall)
| number | дата | формат | guests | revenue budget | deposits | статус |
|---|---|---|---|---|---|---|
| EVT-2026-0001 | 2026-08-25 | BANQUET | 192 | 85 млн | 30/70 both received | SETTLING |
| EVT-2026-0002 | 2026-09-05 | CONFERENCE | 120 | 40 млн | 30% received | HELD |
| EVT-2026-0003 | 2026-09-27 | BANQUET | 150 | 60 млн | 30% received | CONFIRMED |
| EVT-2026-0004 | 2026-10-11 | PRIVATE | 40 | 18 млн | none | QUOTED |

EventBudgetLine для 0003 с approved_vendor_ids для fast lane.

## P2P объекты (август–сентябрь 2026)
- 40 PR: все статусы, включая 2 REJECTED, 3 fast lane, 4 urgent (reasons разные), 2 UNBUDGETED.
- 15 PO, 25 Receipt (2 PARTIAL, 1 REJECTED).
- 45 Invoice: 3 DUPLICATE_SUSPECT, 2 CORRECTED, 1 CANCELLED, 2 DISPUTED (ИНН mismatch), остальные MATCHED/PAID.
- 50 PaymentRequest: покрыть каждый статус ≥2 раза; 6 с exception (OVER_OUTSTANDING ×2, NO_RECEIPT, NO_CONTRACT, UNBUDGETED, UNVERIFIED_BANK); 8 prepayments; 4 tax; 2 payroll; 3 employee advance.
- Batches: 20 рабочих дней августа SETTLED; сентябрь до 11.09 SETTLED; 14.09 OPEN с 6 READY items (для AC-06); 1 URGENT SETTLED; 1 CANCELLED.
- BankTransaction: 2 счёта rooftop (UZS, USD), 1 sense48, 1 ordo; ~300 транзакций; 5 UNMATCHED, 3 SUGGESTED; выписка-файл `seed/bank/2026-09-12.csv` не импортирована (для AC-08).
- Advance: 5 OPEN, 2 OVERDUE, 3 CLOSED, 1 WRITTEN_OFF, 2 EMPLOYEE_ADVANCE, 1 CORP_CARD.
- CustomerInvoice: по events + 6 sense48 corporate SPA + 4 ordo tenant fees; 3 OVERDUE, 1 DISPUTED.
- TaxObligation: VAT/PAYROLL_TAX/SOCIAL за июль–сентябрь; сентябрьские PLANNED.
- PayrollRun: июль, август PAID/POSTED; сентябрь DRAFT с одним TERMINATED employee в реестре (для BR-047).
- Employees: 25 rooftop (3 GPH, 1 TERMINATED, 2 card MISSING), 8 sense48, 6 ordo.
- Tasks: ~30 OPEN разных типов, 5 OVERDUE.
- Documents: для каждого PAID — SF/ACT где положено; намеренно 4 «paid without SF», 2 «paid without act > SLA», 1 missing POA.
- CashPlanLine: loan repayment 15 млн ежемесячно, capex 40 млн октябрь.
- FxRate: ежедневно с 01.07.2026, USD ~12 800, EUR ~14 900 (синтетический drift).
- Holidays 2026 UZ: 01.01, 08.03, 21.03, 09.05, 01.09, 01.10, 08.12 + плавающие религиозные как placeholder.

## ORDO специфика
Cost centers по объектам; vendors FM/REPAIR/SECURITY; customers = арендаторы (4) с monthly fees; contracts FM. Демонстрирует, что core одинаковый, dimensions отличаются.

## Файлы seed
`packages/db/seed/*.ts` (детерминированный faker с seed=42), `seed/bank/*.csv`, `seed/edo/registry-2026-09.xlsx`, `seed/pos/*.csv`, `seed/fx.csv`. `pnpm seed` — с нуля за < 60 сек. `pnpm seed:reset` — drop + migrate + seed.
