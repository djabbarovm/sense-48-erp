# Шаблоны миграции (Phase E-05 генерирует .xlsx по этим спекам)

## vendors.xlsx
`tax_id* | legal_name* | display_name | category_code* | vat_payer* (Y/N) | bank_name* | mfo* | account* | currency* | contact_name | contact_phone | contact_email | requires_contract (Y/N) | related_party (Y/N) | business_owner_email*`
Валидация: ИНН 9 цифр, уникален в файле и в tenant; account 20 цифр; category_code существует; email существует в tenant.

## contracts.xlsx
`number* | vendor_tax_id* | subject* | currency* | limit | start_date* | end_date | auto_renew (Y/N) | payment_terms_type* (PREPAY_PCT/POSTPAY_DAYS/SCHEDULE) | payment_terms_value* | registration_required (Y/N) | owner_email* | status* (ACTIVE/SIGNED/EXPIRED)`

## open_ap.xlsx
`vendor_tax_id* | invoice_number* | invoice_date* | invoice_type* (SF/INVOICE/ACT) | amount_gross* | vat | currency* | contract_number | paid_to_date | due_date* | cost_center_code* | category_code* | edo_document_id`
Создаёт Invoice MATCHED (если contract найден) с outstanding = gross − paid_to_date.

## open_ar.xlsx
`customer_tax_id* | customer_name* | invoice_number* | invoice_date* | amount_gross* | vat | currency* | due_date* | received_to_date | event_number | contract_number`

## employees.xlsx
`full_name* | role_title* | cost_center_code* | employment_type* (STAFF/GPH) | status* (ACTIVE/TERMINATED) | terminated_at | bank_card_status* (OK/MISSING/EXPIRED) | passport_status* (OK/MISSING/EXPIRED)`
**Не содержит** номера паспорта, карты, адреса, зарплаты.

## budgets.xlsx
`period* (YYYY-MM) | cost_center_code* | category_code* | planned*`

## inventory.xlsx (MDS Property, P-07)
`building_code* | building_name | building_kind | floor_no* | unit_no* | unit_type* | area_m2* | owner_name | owner_kind | owner_phone | owner_email | management_consent (Y/N) | managed_by_platform (Y/N) | readiness | occupancy | rental_mode | lease_status | commercial_status | occupant_name | lease_ends_at | asking_rate | currency | monthly_rent`
Unit ID неизменяем: существующие юниты пропускаются (BR-P15). Здание создаётся по коду (name/kind обязательны при первом появлении), этаж — по номеру, собственник — по имени. Жёсткие правила BR-P04/P10 — ошибка строки; остальные противоречия → alert на карточке.

## План этажа (P-08, не xlsx)
JSON `{ "building_code", "floor_no", "view_box", "units": { "1201": [[x,y],…] } }` или SVG c `<polygon|rect|path id="1201">` (или `data-unit`). Неизвестный unit_no → ошибка, all-or-nothing; `Floor.geometryVersion` увеличивается.

Общие правила: первая строка — заголовки, `*` — обязательное; all-or-nothing на файл; отчёт ошибок с номером строки и полем; файл сохраняется как Document.

## Родные выгрузки 1С и Didox (без шаблона)
На экране «Миграция» есть отдельный блок для файлов как есть: справочник контрагентов 1С, ОСВ по счёту (4010 / 4310 / 6xxx), штатные сотрудники, экспорт реестра Didox. Порядок: контрагенты → ОСВ и Didox. Форматы и правила — `docs/07-integrations.md` (§2, §4).
