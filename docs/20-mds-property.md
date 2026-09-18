# 20 — MDS Property: Property Core и Живое здание

Зафиксировано 18.09.2026 по blueprint владельца «Piramit Digital Platform v1.0» (исходный документ — у владельца; здесь — переработанная спецификация продукта). Источник истины для модуля MDS Property. Piramit — первый объект-тенант; имя клиента в коде продукта не используется.

## 1. Назначение

Единый визуальный ответ на вопрос «что происходит c каждым помещением»: свободно, заселено, ремонт, STR, использует собственник. Карта здания связана c реальными объектами Property Core, статусы рассчитываются системой из полей, а не «раскрашиваются» вручную. Building View — одновременно управленческий экран, коммерческий инструмент и точка входа в карточку юнита.

## 2. Принципы

1. **Один Core, много интерфейсов.** Website, Building View, Telegram, Owner Portal и приложение — интерфейсы к одному Property Core; отдельных баз «для маркетинга» нет.
2. **Unit ID неизменяем** и является ключом связи c внешними системами (BR-P15).
3. **Цвет не хранится** — выводится из нормализованных полей по правилу приоритета (BR-P01).
4. **Противоречия подсвечиваются, а не чинятся** автоматически (BR-P03…P07).
5. **RBAC на сервисе**, не на кнопках; PII собственников — только по праву (BR-P13).
6. **Один предикат фильтра** для карты, этажа, списка и KPI (BR-P12).
7. Каждое изменение критичного поля — в immutable audit c актором, временем, before/after и причиной (BR-P08).

## 3. Нормализованные статусы

| Поле | Значения | Кто владеет |
|---|---|---|
| readiness | READY · RENOVATION · FITOUT · FURNISHING · BLOCKED | Operations / Commercial |
| occupancy | VACANT · OCCUPIED · OWNER_USE · UNAVAILABLE | Commercial (из договоров) |
| rentalMode | NONE · LTR · STR | Commercial |
| leaseStatus | NONE · DRAFT · ACTIVE · EXPIRING · TERMINATED | Contracts (v1 — поле юнита, см. ADR-017) |
| commercialStatus | OFF_MARKET · AVAILABLE · RESERVED · VIEWING · NEGOTIATION · LOI · CONTRACTED | CRM / Commercial |
| operationalStatus | NORMAL · ISSUE · CRITICAL · BLOCKED | Operations |

### Цветовая логика v1 (правило приоритета Readiness → Occupancy → Rental → Contract → Overlay)

| Цвет | Смысл | Правило |
|---|---|---|
| RED | Свободно / простаивает | readiness=READY AND occupancy=VACANT |
| GREY | Ремонт / подготовка | readiness ≠ READY (перекрывает всё остальное) |
| GREEN | Заселено LTR | occupancy=OCCUPIED AND rentalMode≠STR (alert, если договор не ACTIVE/EXPIRING) |
| YELLOW | STR / Airbnb | occupancy=OCCUPIED AND rentalMode=STR |
| BLUE | Использует собственник | occupancy=OWNER_USE |
| NEUTRAL | Общая зона / техническое / недоступно | type ∈ {COMMON, TECHNICAL} или occupancy=UNAVAILABLE |
| ORANGE overlay | Переговоры / резерв | commercialStatus ∈ {RESERVED, NEGOTIATION, LOI}; не заменяет базовый цвет |

Реализация: `packages/core/src/property/status.ts` → `deriveUnitView()`.

## 4. Data model (v1)

`Building` (code, name, kind, geometryVersion) → `Floor` (floorNo, planViewBox) → `Unit` (unitNo immutable, type, areaM2, geometry polygon, ownerId, occupantName, 6 статусов, statusEffectiveAt, vacantSince, leaseEndsAt, askingRate/minApprovedRate/monthlyRent/salePrice в minor units, managedByPlatform, publishedAt). `PropertyOwner` (kind, displayName, контакты — PII, managementConsent). `UnitActivity` (kind, note, expectedRate, followUpAt, source, actor). История статусов — `AuditLog` (objectType=unit).

Схема: `packages/db/prisma/schema.prisma` §P. Деньги — BIGINT minor (центы USD по умолчанию, D-09).

## 5. Бизнес-правила модуля

| ID | Правило | Поведение | Тест |
|---|---|---|---|
| BR-P01 | Цвет выводится, не хранится | `deriveUnitView` детерминирована; поля color в БД нет | status.test, property.test |
| BR-P02 | Технические зоны вне коммерческой статистики | COMMON/TECHNICAL → NEUTRAL, не входят в KPI | status.test |
| BR-P03 | Ремонт c активным договором → alert | GREY + `RENOVATION_WITH_ACTIVE_LEASE` | status.test |
| BR-P04 | Неготовый юнит нельзя выставить на рынок | ValidationError `NOT_READY_FOR_MARKET`; override только c правом `unit.status.override` + reason, пишется в audit | property.test |
| BR-P05 | Занят без режима аренды → alert | `OCCUPIED_WITHOUT_RENTAL_MODE` | status.test |
| BR-P06 | LTR без действующего договора → alert | `LTR_WITHOUT_ACTIVE_LEASE` | status.test |
| BR-P07 | Свободен при активном договоре → alert | `VACANT_WITH_ACTIVE_LEASE` | status.test |
| BR-P08 | Всякое изменение статуса/цены/публикации — в audit | before/after, actor, reason, override, source | property.test |
| BR-P09 | vacant_since ставит система | При переходе в VACANT — now(); при выходе — null; occupant очищается | property.test |
| BR-P10 | Owner use несовместим c режимом аренды | ValidationError `OWNER_USE_WITH_RENTAL_MODE` | status.test, property.test |
| BR-P11 | Брокер двигает сделку только до договорных стадий | AVAILABLE/VIEWING/NEGOTIATION/RESERVED; иначе `BROKER_STAGE_LIMIT` | property.test |
| BR-P12 | Единый фильтр | map/list/floor возвращают один набор; KPI считается по нему же | property.test |
| BR-P13 | PII собственника по праву | Без `unit.owner.view` — инициалы, контакты null; контакты не пишутся в audit | property.test |
| BR-P14 | Публикуется только sellable | READY + VACANT + на рынке; заселение/снятие c рынка снимает публикацию | property.test |
| BR-P15 | Unit ID неизменяем | `UNIT_NO_IMMUTABLE`; уникален в здании | property.test |

## 6. Роли и права

Новые роли платформы: `COMMERCIAL_MANAGER`, `BROKER`, `OPERATIONS_MANAGER`, `MARKETING`. Права `property.*`/`unit.*` — в `PERMISSION_MATRIX` (`packages/core/src/rbac/matrix.ts`), синхронизируются в БД `syncPermissions`.

| Право | OWNER | COMMERCIAL | BROKER | OPS | MARKETING | ADMIN | Финансовые роли |
|---|---|---|---|---|---|---|---|
| property.view | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (все) |
| property.manage (здания/этажи/юниты/собственники) | ✓ | ✓ | — | — | — | ✓ | — |
| unit.status.readiness | ✓ | ✓ | — | ✓ | — | — | — |
| unit.status.occupancy (+ rentalMode, leaseStatus) | ✓ | ✓ | — | — | — | — | — |
| unit.status.commercial | ✓ | ✓ | ✓ (BR-P11) | — | — | — | — |
| unit.status.operational | ✓ | — | — | ✓ | — | — | — |
| unit.status.override | ✓ | ✓ | — | — | — | — | — |
| unit.publish | ✓ | ✓ | — | — | ✓ | — | — |
| unit.pricing.edit | ✓ | ✓ | — | — | — | — | — |
| unit.owner.view (PII) | ✓ | ✓ | — | — | — | ✓ | LEAD |
| unit.finance.view | ✓ | ✓ | — | — | — | — | LEAD, JUNIOR, ACCT |
| unit.activity.create | ✓ | ✓ | ✓ | ✓ | — | — | — |

Роль «Owner» (собственник видит только свои юниты) — Wave 4 (Owner Portal), в v1 отсутствует.

## 7. Экраны v1

### 7.1 Building View `/property`
KPI strip (коммерческих · загрузка % · занято · свободно · ремонт · LTR · STR · собственник · свободная GLA · потенциальный доход · текущий доход · противоречия) · переключатель зданий · smart-фильтры (GET-параметры: поиск, цвет, режим, простой 30/60/90, договор заканчивается 30/60/90, стадия сделки, под управлением, c противоречиями) · легенда (всегда видна; цвет + подпись + маркеры) · 2.5D фасад: этажи сверху вниз, ячейка = юнит (номер, overlay-кольцо, «!» противоречия, черта «опубликован»), hover — подсказка c деталями, клик по этажу → план, по ячейке → карточка.

### 7.2 Floor View `/property/floors/[id]`
SVG-план из `Unit.geometry` в `Floor.planViewBox`, hover-подсказка, клик → карточка; навигация этаж выше/ниже; список-таблица как 2D fallback и для мобильного; фильтры наследуются из URL.

### 7.3 Unit Card `/property/units/[id]`
Identity · статусы (6 измерений + дней простоя) · собственник (PII по праву) · арендатор и договор · коммерция (asking/min/аренда/продажа, sellable, публикация) · форма смены статуса (селекты только по правам, причина, override) · цены (по праву) · активности (форма + лента) · аудит (diff before/after + причина). Ошибки домена показываются баннером `?error=CODE`.

## 8. API (внутренний, сервисный слой `packages/db/src/services/property.ts`)

| Функция | Аналог blueprint | Право |
|---|---|---|
| getStatusMap(ctx, filter) | GET /buildings/{id}/status-map | property.view |
| getFloor(ctx, floorId, filter) | GET /floors/{id}/units | property.view |
| getUnitCard(ctx, unitId) | GET /units/{id} | property.view (+ маскирование) |
| changeUnitStatus(ctx, unitId, patch) | PATCH /units/{id}/status | по полю (§6) |
| addUnitActivity(ctx, unitId, input) | POST /units/{id}/activities | unit.activity.create |
| setUnitPublished / updateUnitPricing | — | unit.publish / unit.pricing.edit |
| createBuilding / createFloor / createUnit / updateUnit / createPropertyOwner | master data | property.manage |

HTTP-роуты и realtime-события (`unit.status.changed`) — Wave 2 (после стабилизации сервисного контракта). Сейчас UI обновляется через `revalidatePath`.

## 9. Seed (docs/10 дополнение)

Тенант `piramit` «Piramit Tower (демо)»: Residence Tower (этажи 2–20 × 8 апартаментов), Business Center (1–8 × 6 офисов), Piramit Mall (1–3 × 10 торговых) + common-ядро на каждом этаже; 60 вымышленных собственников; детерминированное распределение статусов (LCG по индексу); три намеренных противоречия (1203, 805, 1507) для демонстрации alert'ов. Пользователи: owner@/commercial@/broker@/ops@/marketing@piramit.test (пароль dev — как в docs/10). Идемпотентен.

## 10. Этапы (по blueprint §19)

| Wave | Что | Статус |
|---|---|---|
| 0 Foundation | IP/ownership (docs/17), роли, data dictionary, Unit ID | ✓ IP-01, P-01 |
| 1 Core MVP | Property Core + Building/Floor/Unit + фильтры + audit + seed | ✓ P-02…P-06 |
| 1b | Импорт инвентаря из XLSX (immutable Unit ID mapping), floor-plan geometry import, e2e | P-07, P-08 |
| 2 Commercial | CRM lead/deal/activity/viewing/offer, LeaseContract как сущность, public-safe inventory API, HTTP API + события | P-10… |
| 3 AI Operations | WorkBot: voice/text/photo → structured draft → confirm → commit → audit | после API |
| 4 Owner/Operations | Owner Portal, work orders/SLA, документы, services | после identity |
| 5 App/Advanced | Resident app adapters, 3D, BI, access/payment adapters | после ROI |

## 11. Acceptance (blueprint §1.15 → тесты)

| AC | Проверка | Где |
|---|---|---|
| Каждый юнит имеет уникальный unit_id и связан c Core | unique(buildingId, unitNo), FK floor/building | property.test BR-P15 |
| Смена статуса через workflow перекрашивает Building/Floor | цвет считается при чтении из полей | property.test BR-P01/P12 |
| Цвета рассчитываются, не хранятся | нет поля color | status.test BR-P01 |
| Найти юнит и открыть карточку ≤ 2 действия | поиск `q` → ячейка → карточка | UI |
| Фильтры работают одновременно и совпадают c backend | один предикат | property.test BR-P12 |
| Unit Card показывает только разрешённые поля | маскирование | property.test BR-P13 |
| Каждое изменение критичного поля — actor/timestamp/old/new | audit | property.test BR-P08 |
| Voice/AI change → draft → confirm | Wave 3 | — |
| Мобильная версия без horizontal overflow | responsive grid, список-fallback | UI |
| 2D fallback без WebGL | SVG/HTML, WebGL не используется | UI |
