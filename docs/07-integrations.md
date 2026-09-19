# 07 — Интеграции: adapter interfaces и mock-форматы

Реальных API в MVP нет. Каждая интеграция = TypeScript interface в `packages/adapters/<name>/types.ts` + `Mock<Name>Adapter` + файловый импортёр/экспортёр. Core зависит только от interface. Реальные адаптеры (Trustbank, DIBank, Didox API, iiko API, 1С HTTP) — отдельные пакеты позже, без изменения core.

Все импорты: идемпотентны, all-or-nothing на уровне файла для master data, построчный отчёт для транзакций, файл сохраняется как Document с sha256.

## 1. Bank

```ts
interface BankAdapter {
  importStatement(input: { bankAccountId: string; file: Buffer; format: 'UNIFIED_CSV'|'UNIFIED_XLSX' }): Promise<ImportReport>;
  exportBatch(batchId: string): Promise<{ file: Buffer; fileName: string; format: 'UNIFIED_CSV' }>;
  // Реальные адаптеры добавят: fetchStatement(dateRange), submitBatch() — не в MVP
}
```

### Unified statement CSV (импорт)
UTF-8, `;`, header обязателен:
```
external_id;booking_date;value_date;amount;currency;direction;counterparty_name;counterparty_tax_id;counterparty_account;counterparty_mfo;purpose
TB-2026-09-14-000123;2026-09-14;2026-09-14;12500000.00;UZS;OUT;OOO "FOOD SUPPLY";301234567;20208000900123456789;00444;Оплата по СФ 118 от 10.09.2026
```
- `direction`: IN/OUT; `amount` положительный decimal → в БД `amount_minor` со знаком.
- `counterparty_account` маскируется при сохранении (`raw` хранит полный в зашифрованном виде — нет: raw хранит только маску; полный номер контрагента не нужен).
- Дубликат `external_id` → skip.

### Unified batch CSV (экспорт)
```
payment_request_number;vendor_legal_name;vendor_tax_id;vendor_account;vendor_mfo;amount;currency;purpose;due_date
PAY-2026-000045;OOO "FOOD SUPPLY";301234567;<полный номер>;00444;12500000.00;UZS;Оплата по СФ 118 от 10.09.2026 по договору 12/2026;2026-09-15
```
Полный номер счёта в экспорт попадает (это единственное место); файл — Document с ограниченным доступом (`batch.export`).

### Auto-match алгоритм
1. Точный: `counterparty_tax_id = vendor.tax_id && amount = requested && PaymentRequest.status=SENT_TO_BANK && batch_date within ±3d` → AUTO_MATCHED.
2. Suggested (confidence 0.5–0.9): совпадение суммы и один из: tax_id / номер PAY в purpose / номер СФ в purpose.
3. IN-транзакции: match на CustomerInvoice по customer.tax_id + amount, иначе Suggested.
4. Остальное → Task UNMATCHED_TX.

## 2. EDO / Didox

```ts
interface EdoAdapter {
  importRegistry(input: { tenantId: string; file: Buffer }): Promise<ImportReport>;   // Excel-реестр СФ из Didox
  getDocumentStatus(edoDocumentId: string): Promise<EdoStatus>;                        // mock: из таблицы
  attachToObject(edoDocumentId: string, objectType, objectId): Promise<void>;
}
type EdoStatus = 'DRAFT'|'SENT'|'SIGNED'|'REJECTED'|'CANCELLED'|'CORRECTED';
```

### Registry XLSX (импорт), лист `Invoices`
| edo_document_id | type | number | date | seller_tax_id | seller_name | buyer_tax_id | amount_net | vat | amount_gross | currency | status | corrective_of |
Маппинг: seller_tax_id → Vendor (если нет → создаётся PENDING_VERIFICATION + Task), buyer_tax_id должен = tenant.tax_id (иначе строка в errors). `status` → edo_status. `corrective_of` → BR-024.

### Экспорт реестра Didox (родной формат, лист `Registry`) — H-09
Колонки как в выгрузке Didox: `№ | Вх/Исх | Статус | Документ (тип) | Уровень риска | Договор (№ от) | Наименование контрагента | ИНН контрагента | Номер документа | Дата документа | Сумма без НДС | Сумма НДС | Сумма с НДС | … | ID у роуминга`; вторая строка — подзаголовки табличной части, строка «Итого» — конец. Парсер `parseDidoxRegistryExport` (adapters/edo/didoxExport): статус → `SIGNED / SENT / REJECTED / CANCELLED / DRAFT / CORRECTED`, тип → `CONTRACT / SF / ACT / OTHER`, договор «№… от дд.мм.гггг» → номер + дата, 14-значный ИНН → физлицо (ПИНФЛ не сохраняется). Импорт `importDidoxExport`: подписанные договоры (НК) c юрлицами → реестр договоров (`importContractsXlsx`, all-or-nothing, поставщик по ИНН обязателен), ожидающие подписи и договоры c физлицами — в заметки отчёта.

Mock: `MockEdoAdapter` хранит статусы в таблице `edo_mock_documents`; админ-экран в dev позволяет менять статус, чтобы прогонять сценарии CORRECTED/CANCELLED.

## 3. POS / iiko

```ts
interface PosAdapter {
  importDailySales(input: { tenantId; file: Buffer; date }): Promise<ImportReport>;
  importInventorySnapshot(input: { tenantId; file: Buffer; date }): Promise<ImportReport>;
  importBanquetMapping(input: { tenantId; file: Buffer }): Promise<ImportReport>; // iiko banquet id → event_id
}
```

CSV `daily_sales`: `date;outlet;category;revenue_gross;vat;discounts;cost_of_sales;covers`.
CSV `inventory_snapshot`: `date;outlet;stock_value;purchases;consumption;waste;transfers;theoretical_food_cost;actual_food_cost`.
CSV `banquet_mapping`: `iiko_order_id;event_number;food_cost;beverage_cost`.
Данные → таблицы `PosDailySales`, `PosInventorySnapshot`; Event.actual_cost учитывает food/beverage из mapping.

## 4. Accounting / 1С

```ts
interface AccountingAdapter {
  exportPostings(input: { tenantId; period: 'YYYY-MM' }): Promise<{ file: Buffer }>;
  importPostedStatus(input: { tenantId; file: Buffer }): Promise<ImportReport>;
}
```

Export CSV: `payment_request_number;paid_at;vendor_tax_id;vendor_name;amount;vat;currency;account_code;vat_account_code;cost_center;category;purpose;invoice_number;invoice_date;contract_number`.
Import posted CSV: `payment_request_number;posted_at;onec_document_ref` → PaymentRequest RECONCILED → CLOSED.

### Родные выгрузки 1С:Бухгалтерии (импорт без переформатирования) — H-09
Парсеры `adapters/onec/exports.ts`, импорт `db/services/onecImport.ts`, экран `/migration` → «Родные выгрузки 1С и Didox»:
| Выгрузка | Формат | Что делает импорт |
|---|---|---|
| Справочник контрагентов | `Контрагент \| ИНН \| ПИНФЛ \| Полное наименование \| Номер счета \| Банк \| МФО` | поставщик по ИНН → добавить недостающий счёт; заглушка `KSP-nnnn` по имени → ИНН + реквизиты + ACTIVE; новый → `importVendorsXlsx` c категорией по умолчанию; второй счёт того же ИНН → `UNVERIFIED` (BR-018); ПИНФЛ не сохраняется, физлица помечаются в заметках |
| ОСВ по счёту (контрагент → договор) | заголовок «Оборотно-сальдовая ведомость по счету NNNN за …», строка `Дебет \| Кредит` × 3, строки договоров «№… от дд.мм.гггг» | 40xx → открытая дебиторка (`importOpenArXlsx`, срок = дата импорта); 43xx → `Advance VENDOR_PREPAYMENT` + Task `CLOSING_DOCS` на 10 рабочих дней (non-negotiable #7), идемпотентно по назначению; 6xxx → открытая кредиторка (`importOpenApXlsx`); контрагент ищется по имени среди поставщиков — all-or-nothing |
| Штатные сотрудники | `Сотрудник \| Табельный номер \| Должность \| Дата приема \| Тарифная ставка \| На руки` | только ФИО и должность → `importEmployeesXlsx` (STAFF, ACTIVE, документы MISSING); оклады и табельные номера не читаются |
Суммы 1С — сумы c дробью → тийины; имена контрагентов нормализуются (`normalizeCounterpartyName`: регистр, кавычки, орг-формы MCHJ/ООО/XK/AJ/…).

## 5. Telegram

```ts
interface NotificationAdapter {
  send(input: { userId: string; template: NotificationTemplate; params: Record<string,string|number>; deepLink: string }): Promise<void>;
}
```
Реализация: grammY бот. Пользователь линкует chat_id командой `/start <one-time-code>` из профиля. Шаблоны (без сумм, без названий контрагентов):
- `APPROVALS_PENDING`: «У вас {count} платежей на approval. Batch {batch_number}.» + кнопка-ссылка.
- `TASK_ASSIGNED`: «Новая задача: {task_type}. Срок {due}.» + ссылка.
- `TASK_OVERDUE_ESCALATION`: «Просрочена задача {task_type} у {owner_name}.» + ссылка.
- `BATCH_STATUS`: «Batch {batch_number}: {status}.»
- `AR_REMINDER`: «Счёт {invoice_number} клиенту: {offset}.» + ссылка.
- `BANK_IMPORT_DONE`: «Выписка импортирована: {matched}/{total} сопоставлено.»
- `SECURITY_ALERT`: «Изменены реквизиты vendor {vendor_display_name}. Требуется верификация.»

Бот **не принимает** команд, меняющих финансовые данные. Только `/start`, `/help`, `/mute`.

### 5b. CRM-бот сотрудника (P-24, docs/21 §6)
`TelegramBotApi` (adapters/telegram/bot): `sendMessage(chatId, text, {keyboard})`, `answerCallback`, `setWebhook(url, secret)`; реализации Http (fetch к api.telegram.org), Mock (тесты), Console (dev). Вход — `POST /api/telegram/webhook` c заголовком `X-Telegram-Bot-Api-Secret-Token` = `TELEGRAM_WEBHOOK_SECRET`; апдейты `message` и `callback_query`. Установка webhook: `setWebhook(\`${APP_URL}/api/telegram/webhook\`, secret)` один раз при деплое. Env: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_BOT_USERNAME`, `APP_URL`. Callback-данные: `d:c:<draft>` / `d:r:<draft>` (подтвердить/отменить черновик), `v:<deal>:<OFFER|THINKING|RESCHEDULE|LOST>`, `vl:<deal>:<причина>`, `t:<task>`.

## 5a. WorkBot / IntentExtractor (MDS Property, docs/20 §11.4)

```ts
interface IntentExtractor {
  extract(input: { text: string }): Promise<{ intent: Intent | null; confidence: number; entities: Record<string, unknown> }>;
}
```
Mock: `RuleBasedIntentExtractor` (регулярные выражения, детерминирован). Реальный LLM-адаптер — отдельный пакет позже; core/db зависят только от интерфейса. Извлекатель никогда не меняет данные: commit — после подтверждения человеком через сервисы (BR-P30). Telegram-бот вызывает `POST /api/property/actions/draft` и `/{id}/confirm` c API-ключом тенанта (scope WORKBOT) и `telegramChatId` сотрудника.

## 6. Email (fallback)
Тот же `NotificationAdapter`, реализация через SMTP (nodemailer), те же шаблоны.

## 7. FX
`FxRateImporter`: CSV `date;currency;rate` (курс ЦБ РУз). Job раз в день проверяет наличие курса на сегодня, если нет — Task Lead.

## ImportReport (общий)
```ts
{ file_document_id, total, imported, skipped, errors: [{row, field, message}], created_tasks: string[] }
```
