# 12 — Глоссарий

| Термин | Значение | В системе |
|---|---|---|
| СФ (счёт-фактура) | Юридически значимый налоговый документ поставщика, оформляется в ЭДО | `Invoice.type=SF`, edo_status |
| Счёт на оплату | Предварительный документ для платежа, не налоговый | `Invoice.type=INVOICE` |
| Акт | Подтверждение оказания услуг | `Invoice.type=ACT` / `Document.doc_type=ACT` |
| Накладная | Подтверждение передачи товара | `WAYBILL` |
| Доверенность (POA) | Право получить товар от имени компании | `Document.doc_type=POA`, DocumentRequirement для goods |
| Didox | Оператор ЭДО в Узбекистане | `EdoAdapter` |
| ЭДО | Электронный документооборот | edo_* поля |
| ЭЦП | Электронная цифровая подпись | Не хранится; только факт подписания через edo_status |
| OTP | Одноразовый код банка | Никогда не хранится (BR-072) |
| ИНН | Идентификационный номер налогоплательщика (9 цифр) | `tax_id` |
| МФО | Код банка | `mfo` |
| Красная СФ | СФ, отклонённая/некорректная в ЭДО | edo_status REJECTED |
| Корректировочная СФ | Заменяет ранее выставленную | `is_corrective_of`, BR-024 |
| Подотчёт | Деньги, выданные сотруднику под отчёт | `Advance.type=EMPLOYEE_ADVANCE` |
| ГПХ (GPH) | Договор гражданско-правового характера, не штат | `Employee.employment_type=GPH` |
| E-ijara | Гос. регистрация договоров аренды | `Contract.registration_required` |
| Единый QR | Обязательный QR для платежей с 01.07.2026 | Вне scope; заметка в README |
| 1С | Регламентированный бухучёт | `AccountingAdapter` |
| iiko | POS/inventory для F&B | `PosAdapter` |
| Cutoff | Время закрытия приёма стандартных платежей в batch | D-13, 14:00 |
| Fast lane | Ускоренный PR внутри утверждённого бюджета события | `PurchaseRequest.is_fast_lane` |
| 4-way match | PR/PO + Contract + Receipt + Invoice | BR-020 |
| Outstanding | Остаток к оплате по обязательству | `v_*_balance` |
| Committed | Утверждено, но не оплачено | budget/contract views |
| Green flow / red case | Кейс без исключений / кейс с FAIL control | controls_result |
| Tier 1/2/3 | Уровни approval по сумме | D-12 |
| Tenant | Компания-клиент в multi-tenant системе | `Tenant` |
| Portfolio | Набор tenant, обслуживаемых одним сотрудником сервисной компании | UserTenantRole |
| Month-end pack | Пакет управленческой отчётности D+5 | Close Center |
