/** E-05: генерация /templates/*.xlsx по спекам templates/README.md. `pnpm --filter @finance-os/adapters build:templates` */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildTemplateXlsx, type TemplateSpec } from '../src/migration/index.js';

const COMMON = [
  'Заполняйте лист «Данные». Первая строка — заголовки, не меняйте их.',
  'Поля со * обязательны. Даты — ГГГГ-ММ-ДД или ДД.ММ.ГГГГ. Суммы — в сумах (можно с копейками через запятую).',
  'Импорт «всё или ничего»: при любой ошибке файл не грузится, вы получите список ошибок с номерами строк.',
  'Повторная загрузка безопасна: уже существующие записи пропускаются.',
];

const SPECS: TemplateSpec[] = [
  {
    fileName: 'vendors.xlsx',
    headers: ['tax_id', 'legal_name', 'display_name', 'category_code', 'vat_payer', 'bank_name', 'mfo', 'account', 'currency', 'contact_name', 'contact_phone', 'contact_email', 'requires_contract', 'related_party', 'business_owner_email'],
    example: [
      ['301234567', 'ООО «Fresh Fruits Tashkent»', 'Fresh Fruits', 'FNB_FOOD', 'Y', 'Трастбанк', '00491', '20208000900001234001', 'UZS', 'Азиз', '+998901234567', 'aziz@ff.uz', 'N', 'N', 'chef@rooftop.test'],
    ],
    instructions: [
      'Справочник поставщиков.',
      ...COMMON,
      'tax_id — ИНН, ровно 9 цифр, уникален. account — расчётный счёт, 20 цифр.',
      'category_code — код категории из системы (Администрирование → Категории).',
      'business_owner_email — email ответственного за поставщика пользователя системы.',
      'related_party = Y для связанных сторон (аренда у учредителя и т.п.) — платежи будут помечаться.',
    ],
  },
  {
    fileName: 'contracts.xlsx',
    headers: ['number', 'vendor_tax_id', 'subject', 'currency', 'limit', 'start_date', 'end_date', 'auto_renew', 'payment_terms_type', 'payment_terms_value', 'registration_required', 'owner_email', 'status'],
    example: [
      ['ДП-2026-014', '301234567', 'Поставка продуктов', 'UZS', '250000000', '2026-01-15', '2026-12-31', 'Y', 'POSTPAY_DAYS', '14', 'N', 'lead@fos.test', 'ACTIVE'],
    ],
    instructions: [
      'Реестр договоров. Сначала импортируйте vendors.xlsx.',
      ...COMMON,
      'payment_terms_type: POSTPAY_DAYS (оплата через N дней) / PREPAY_PCT (предоплата N%) / SCHEDULE (график).',
      'limit — годовой лимит договора в сумах, пусто = без лимита.',
      'registration_required = Y для договоров c обязательной регистрацией (E-ijara и т.п.).',
    ],
  },
  {
    fileName: 'open_ap.xlsx',
    headers: ['vendor_tax_id', 'invoice_number', 'invoice_date', 'invoice_type', 'amount_gross', 'vat', 'currency', 'contract_number', 'paid_to_date', 'due_date', 'cost_center_code', 'category_code', 'edo_document_id'],
    example: [
      ['301234567', '118', '2026-08-28', 'SF', '12500000', '1339285,71', 'UZS', 'ДП-2026-014', '5000000', '2026-09-15', 'RH-KITCHEN', 'FNB_FOOD', ''],
    ],
    instructions: [
      'Открытая кредиторка: неоплаченные (или частично оплаченные) счета поставщиков на дату миграции.',
      ...COMMON,
      'invoice_type: SF (счёт-фактура) / INVOICE (счёт) / ACT (акт).',
      'paid_to_date — сколько уже оплачено по счёту до внедрения; остаток к оплате система посчитает сама.',
      'contract_number — номер договора из contracts.xlsx (по нему счёт сопоставляется автоматически).',
    ],
  },
  {
    fileName: 'open_ar.xlsx',
    headers: ['customer_tax_id', 'customer_name', 'invoice_number', 'invoice_date', 'amount_gross', 'vat', 'currency', 'due_date', 'received_to_date', 'event_number', 'contract_number'],
    example: [
      ['201234567', 'ООО «Milliy Bank Events»', 'СЧ-2026-041', '2026-09-06', '52000000', '', 'UZS', '2026-09-20', '26000000', '', ''],
    ],
    instructions: [
      'Открытая дебиторка: счета клиентам, не оплаченные полностью на дату миграции.',
      ...COMMON,
      'Клиент создаётся автоматически по ИНН/названию, если его ещё нет.',
      'received_to_date — сколько клиент уже оплатил; просроченные счета сразу попадут в AR aging.',
    ],
  },
  {
    fileName: 'employees.xlsx',
    headers: ['full_name', 'role_title', 'cost_center_code', 'employment_type', 'status', 'terminated_at', 'bank_card_status', 'passport_status'],
    example: [['Иванов И.И.', 'Повар', 'RH-KITCHEN', 'STAFF', 'ACTIVE', '', 'OK', 'OK']],
    instructions: [
      'Сотрудники — ТОЛЬКО для подотчётов и контроля документов.',
      'НЕ вносите: номера паспортов, карт, адреса, зарплаты — эти данные живут в 1С/HR (политика безопасности).',
      ...COMMON,
      'employment_type: STAFF (штат) / GPH (ГПХ). bank_card_status/passport_status: OK / MISSING / EXPIRED.',
    ],
  },
  {
    fileName: 'budgets.xlsx',
    headers: ['period', 'cost_center_code', 'category_code', 'planned'],
    example: [['2026-10', 'RH-KITCHEN', 'FNB_FOOD', '95000000']],
    instructions: [
      'Бюджеты: план по месяцам × cost center × категория.',
      ...COMMON,
      'period — ГГГГ-ММ. planned — план в сумах. Существующие строки бюджета не перезаписываются.',
    ],
  },
  {
    fileName: 'inventory.xlsx',
    headers: ['building_code', 'building_name', 'building_kind', 'floor_no', 'unit_no', 'unit_type', 'area_m2', 'owner_name', 'owner_kind', 'owner_phone', 'owner_email', 'management_consent', 'managed_by_platform', 'readiness', 'occupancy', 'rental_mode', 'lease_status', 'commercial_status', 'occupant_name', 'lease_ends_at', 'asking_rate', 'currency', 'monthly_rent'],
    example: [
      ['TOWER', 'Residence Tower', 'TOWER', '12', '1201', 'APARTMENT', '126.6', 'Рустам Каримов', 'PERSON', '+998901234567', 'owner@example.test', 'Y', 'Y', 'READY', 'OCCUPIED', 'LTR', 'ACTIVE', 'CONTRACTED', 'CityNet LLC', '2027-03-01', '1350', 'USD', '1200'],
      ['TOWER', '', '', '12', '1202', 'APARTMENT', '128.5', '', '', '', '', '', 'N', 'READY', 'VACANT', 'NONE', 'NONE', 'AVAILABLE', '', '', '1400', 'USD', ''],
      ['OFFICES', 'Business Center', 'OFFICES', '3', 'B3-1', 'OFFICE', '84', 'Silk Road Logistics', 'COMPANY', '', '', 'N', 'N', 'FITOUT', 'VACANT', 'NONE', 'NONE', 'OFF_MARKET', '', '', '2500', 'USD', ''],
    ],
    instructions: [
      'MDS Property: инвентарь здания — юниты c собственниками и статусами (docs/20 §4).',
      ...COMMON,
      'unit_no — неизменяемый Unit ID (BR-P15): существующие юниты НЕ перезаписываются, а пропускаются. Уникален в пределах здания.',
      'building_code — стабильный код здания (TOWER/OFFICES/MALL/…); building_name и building_kind обязательны только при первом появлении кода в файле или системе.',
      'unit_type: APARTMENT / OFFICE / RETAIL / PARKING / STORAGE / COMMON / TECHNICAL. COMMON и TECHNICAL не входят в коммерческую статистику.',
      'readiness: READY / RENOVATION / FITOUT / FURNISHING / BLOCKED. occupancy: VACANT / OCCUPIED / OWNER_USE / UNAVAILABLE. rental_mode: NONE / LTR / STR.',
      'lease_status: NONE / DRAFT / ACTIVE / EXPIRING / TERMINATED. commercial_status: OFF_MARKET / AVAILABLE / RESERVED / VIEWING / NEGOTIATION / LOI / CONTRACTED.',
      'Жёсткие правила: неготовый юнит нельзя выставить AVAILABLE (BR-P04); OWNER_USE несовместим c rental_mode (BR-P10). Прочие противоречия импортируются и подсвечиваются как alert.',
      'owner_name — собственник ищется по имени в tenant, при отсутствии создаётся. Контакты — только c согласия собственника.',
      'asking_rate / monthly_rent — в месяц, в валюте currency (по умолчанию USD), можно c копейками.',
    ],
  },
];

const root = join(import.meta.dirname, '..', '..', '..');
// /templates — канонический каталог; apps/web/public/templates — для скачивания c экрана миграции
for (const outDir of [join(root, 'templates'), join(root, 'apps', 'web', 'public', 'templates')]) {
  mkdirSync(outDir, { recursive: true });
  for (const spec of SPECS) {
    writeFileSync(join(outDir, spec.fileName), buildTemplateXlsx(spec));
  }
}
for (const spec of SPECS) console.log(`  ${spec.fileName}`);
