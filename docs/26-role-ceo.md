# Профиль должности №4 — CEO (`CEO`, Мурад) · CEO Operating Profile

> **Статус:** источник истины по роли `CEO`. Уровень — **портфель ORDO** (Tower — один из блоков). Дополняет `docs/22-ordo-tower-tz.md`, профили №1–№3 (`docs/23`–`docs/25`).
> Это **не exception-only** профиль: полноценный CEO-опыт `MONEY → PERFORMANCE → RISKS → DECISIONS`.
> Backend/permissions здесь **намеренно не углубляем** — фиксируем Operating Profile + структуру CEO Home + drill-down logic.
> **Не строить** сущности/миграции из профиля. Реальность кода сверена с `docs/SYSTEM_MAP.md` — см. раздел **R**. Нет цифры в backend → **`GAP`**, не симулировать как `REAL`.
> **`CEO` vs `OWNER` не фиксируем навсегда** (§10). Гардрейлы: миграции с откатом; в `main` без полного диффа не вливать.

---

## 0. Тест профиля — 5 вопросов, на которые DMS отвечает каждый день
За **30–60 секунд** Мурад должен понимать: 1) **Сколько зарабатываем?** 2) **Лучше или хуже плана / прошлого периода?** 3) **Почему?** 4) **Где риски и возможности?** 5) **Какие решения нужны лично от меня?** Не отвечает — экран сделан неправильно. Это критерий приёмки всего профиля.

## 1. Роль и границы
Мурад — **CEO над портфелем** (Tower + блоки ORDO + Sense48/48-й этаж; далее Rooftop, Mall, Services, Operations). Не живёт в ежедневной операционке. По Tower **Камила остаётся фильтром** шума. Но CEO **всегда видит Health / Money / Performance** портфеля — не дожидаясь эскалации.
- **Operating noise** — не показываем (Умар→Азиз→Камила разбирают сами).
- **Health / Money / Performance** — видно всегда.
- **Critical decisions** — приходят через Камилу (по Tower) в единый CEO-блок решений.

## 2. CEO Home — структура (4 полосы, строго по приоритету)
1. **MONEY (портфель).** Revenue MTD vs Plan MTD · Forecast EOM · динамика MoM · cash position · ожидаемые поступления · обязательные выплаты. Итог по портфелю + строка на бизнес.
2. **PERFORMANCE (по бизнесам).** Компактная карточка на контур (Tower, Rooftop, Sense48, [Mall/Services/Operations — когда OM подтверждены]): 3–4 цифры, реально двигающие экономику, стрелка MoM, статус-цвет. Без vanity.
3. **RISKS.** Топ-риски портфеля (owner-риск, всплеск vacancy, churn, просроченные комиссии, критические инциденты) — каждый **объяснимый** (§4).
4. **DECISIONS.** Единый блок «Требуют моего решения» из всех бизнесов (§7).
Любая существенная цифра — **кликабельна до причины** (§8), без смены профиля.

## 3. Portfolio view — что вижу по портфелю (минимум)
Revenue MTD · Plan MTD · Forecast EOM · динамика MoM · contribution / operating profit (где корректно) · cash position · ожидаемые поступления · обязательные выплаты · major commercial pipeline · основные риски · что требует решения.
> **GAP-честность:** нет цифры в backend → помечаем **`GAP`**, не симулируем. Портфельный rollup сейчас — преимущественно GAP: Tower-DMS держит только Tower; Rooftop/Sense48/прочее нужно подать (интеграция или периодический ввод). Это отдельная работа, не «уже есть».

## 4. KPI должен быть actionable и explainable
Не «Vacancy 13%», а цепочка: `13% vacancy → X объектов → Y стоят >60 дней → lost income / lost commission → причины → ответственные → next actions.` Так по любой крупной цифре. Цифра объясняет бизнес и ведёт к действию, а не табло.

## 5. Tower rollup (для CEO — драйверы, не лиды)
Бизнес-драйверы Tower: объектов всего · с актуальным owner/status · в коммерческом фонде · vacancy · простаивающие · days on market · активные сделки · закрытые · commission accrued / received / expected · просроченные комиссии · pipeline 30 дней · major owner risks · эффективность команды.
**Drill-down (по запросу):** `Tower → Камила → сотрудник → сделка/объект → история / звонки / договор / деньги`.

## 6. Остальные бизнесы (те же принципы — бизнес-цифры)
- **Rooftop:** events booked · utilization · revenue · pipeline · средний чек · contribution / Event P&L · deposits / expected cash · ближайшие крупные события · проблемные/закрывающие документы · forecast.
- **Sense48:** visits / utilization · memberships · renewals · expiring / churn · revenue · contribution · bookings · capacity · service issues · forecast.
- **Mall (когда OM готова):** occupancy / GLA · vacancy · leasing pipeline · renewals · commercial revenue lines · owner/tenant risks.
- **Services (когда OM готова):** GMV · ORDO revenue · contribution · penetration · repeat · service quality · demand.
- **Operations (когда OM готова):** **не смешивать деньги дома с деньгами ORDO** — collections / house funds · plan vs fact · major issues · contractor performance · critical incidents · budget deviations · **management economics ORDO отдельно**.
Подключаются в **тот же CEO-слой** по мере подтверждения их OM.

## 7. Блок «Требуют моего решения» (из всех бизнесов)
Единая очередь решений (отдельно от цифр). Каждая карточка: что случилось · в каком бизнесе · **financial/business impact** · почему дошло до CEO · что уже сделала ответственная роль · **варианты решения** · рекомендация руководителя · deadline · **конкретное действие от меня**. Мелкие operational alerts сюда **не попадают**.

## 8. Drill-down logic (обязательно, не dashboard-only)
Любая существенная цифра — до причины, без смены профиля. Примеры: `Commission expected → сделки → сделка → клиент → объект → payment status → ответственный → история`; `Vacancy → объекты → days on market → цена → owner → broker → показы/офферы → причина`; `Rooftop margin → события → revenue / cost / contribution по каждому`.

## 9. Камила как фильтр (по Tower принцип не меняется)
Обычная операционка Tower остаётся у Камилы. CEO **всегда видит aggregate health и ключевые цифры Tower** без ожидания эскалации; наверх — только **critical decisions**, через Камилу, в блок §7.

## 10. CEO vs OWNER (не фиксируем «Мурад = OWNER навсегда»)
Сначала — нормальный **CEO experience**. Архитектурно разделяем:
- **CEO** = visibility + management decisions + strategy + exceptions.
- **Finance / OWNER** = операционные финансовые полномочия.
Даже если стартовый пользователь **технически** имеет OWNER-права, они **не определяют обычный UX**: elevated permissions допустимы, но интерфейс по умолчанию — **CEO**.

## 11. Cash / Bonus (CEO ≠ кассир)
- **Cash Desk actor — DECISION NEEDED** (не превращать CEO в кассира по умолчанию).
- **`bonus.pay`:** технически OWNER может, но сначала — полная картина финпроцесса. **Не строить ежедневный профиль вокруг ручного подтверждения каждого бонуса / кассовой операции.**

## 12. CEO-слой: что есть в коде vs GAP (высокоуровнево)
| Возможность | Статус |
|---|---|
| Роли `CEO` (обзор) / `OWNER` (суперправа) в RBAC | `РЕАЛЬНО` (право) |
| Tower-аналитика (`crmAnalytics`, control room «сегодня») | `РЕАЛЬНО` (частично — не CEO-уровень) |
| Комиссии accrued/received/expected | `РЕАЛЬНО` (данные есть) |
| CEO Home (MONEY→PERFORMANCE→RISKS→DECISIONS) | `GAP` |
| Portfolio rollup (Tower+Rooftop+Sense48+…) | `GAP` (данные др. бизнесов не сведены; примитивы есть — см. R2) |
| Plan / Forecast / contribution / cash position | `GAP` (примитивы Budget/CashForecast есть, план по контурам — нет) |
| Explainable KPI drill-down (§4, §8) | `GAP` |
| Единый блок «Требуют решения» | `GAP` |
| Разделение `CEO` / `Finance(OWNER)` в UX | `GAP` (архитектурно заложить) |

## 13. Открытые решения (под сборку / позже)
- **A.** Главный месячный KPI Камилы — задаёт Мурад (closed deals / ORDO commission / commercialized assets / occupancy / overall commercial result).
- **B.** Cash Desk actor + закрывающий документ — DECISION NEEDED.
- **C.** Точные пороги эскалации Камила→CEO (цифры).
- **D.** Когда/как подаём данные Rooftop/Sense48/др. в CEO-слой (интеграция vs периодический ввод).
- **E.** Когда выделяем отдельный Finance-контур (туда — `bonus.pay` + cash-confirm).

---

## R. Реконсиляция с кодом (проверено — деструктивно сейчас НЕ переделывать)

### R1. Роль `CEO` = visibility-only — **СОВПАДАЕТ**
Код/ADR-038: `CEO` = широкая видимость (все `*.view` + `dashboard.*` + `audit.view`), **ни одного** права create/modify/approve. Это ровно §10 «CEO = visibility + decisions + exceptions». `dashboard.owner` = OWNER/FINANCE_OPS_LEAD/CEO (`matrix.ts:85`). Разделение `CEO`↔`OWNER(Finance)` в правах уже заложено; **в UX (§10) — `GAP`**: нет отдельного CEO-дефолтного интерфейса поверх elevated-прав.

### R2. Portfolio rollup — **GAP, но примитивы данных есть** (не с нуля)
- **Есть в схеме/коде (per-contour):** Rooftop — `Event`/`EventBudgetLine`/`EventStatus` (Event P&L примитивы); Sense48 — `SenseDailyStat`, `FixedCost`, `CostNorm`, экран `/ceo` «Утро CEO» (break-even, `ceo.ts`); финансы — `Budget`, `CashPlanLine`, `CashForecastSnapshot`, `KpiSnapshot`. Tower — комиссии accrued/received/expected (`Commission`), CRM-аналитика.
- **Чего нет:** **сведённого portfolio-rollup** через контуры в один CEO Home; данные Rooftop/Sense48 не подаются в единый слой Tower-DMS. Т.е. «CEO Home по портфелю» — `GAP`, но строить его придётся **поверх существующих примитивов**, а не на пустом месте. §13.D (как подаём данные) — блокер.

### R3. CEO Home (MONEY→PERFORMANCE→RISKS→DECISIONS) — **GAP**
`/ceo` сегодня = break-even «Утро CEO» (H-07), не 4-полосный портфельный Home. Control Room `/property/today` — Tower-уровень, не CEO-портфель. Нужен новый экран/агрегатор. Explainable drill-down (§4/§8) и единый блок DECISIONS (§7) — тоже `GAP`.

### R4. Plan / Forecast / contribution — **GAP** (частично примитивы)
`Budget`, `CashForecastSnapshot`, `CashPlanLine` есть в финконтуре; **плановых значений и P&L по коммерческим контурам (Tower/Rooftop/Sense48) в разрезе CEO Home нет**. «Revenue MTD vs Plan MTD», «Forecast EOM», «contribution по бизнесу» — собирать отдельно. Не симулировать план как REAL.

### R5. Tower rollup драйверы (§5) — **ТОНКО** (данные есть, CEO-агрегата нет)
Все перечисленные драйверы выводимы из существующих Tower-данных (`Unit`/`Deal`/`Commission`/`LeaseContract` + `crmAnalytics`/`controlRoom`), но **CEO-уровневого rollup-агрегата** (драйверы, а не лиды) нет. Drill-down `Tower → Камила → сотрудник → сделка/объект` завязан на директорский drill-down (профиль №3 R12), которого тоже пока нет.

### R6. Cash / `bonus.pay` (CEO ≠ кассир) — **СОВПАДАЕТ по намерению**
`bonus.pay` = OWNER/FINANCE_OPS_LEAD (`matrix.ts:143`); PAID комиссий = `rent.match` (финансы). Профиль (§11): не строить ежедневный CEO-профиль вокруг ручных подтверждений; Cash Desk actor — DECISION NEEDED (тот же открытый вопрос, что §15.B профиля Камилы). Ничего не менять; выделение Finance-контура (§13.E) — позже.

### R7. `Мурад = OWNER` в seed — **не фиксировать** (совпадает с §10)
Seed: `owner@piramit.test` = Мурад Джаббаров, роль `OWNER` (не `CEO`) — зафиксировано как расхождение в `SYSTEM_MAP §1.2`. Профиль (§10): elevated OWNER-права допустимы, но **дефолтный UX — CEO**. **Реконсиляция:** держать роль открытой; при сборке решить — дать Мураду роль `CEO` (или `CEO`+`OWNER`) и CEO-дефолтный интерфейс. Seed сейчас не менять.

### R8. Прочие контуры (Rooftop/Sense48/Mall/Services/Operations) — **вне Tower-scope**
Mall — есть частично (`MallMandate`/`mall.*`), но по решению профиля №3 (§9) Mall — отдельный контур, не смешивать с Tower. Rooftop/Services/Operations OM ещё не подтверждены. CEO-слой подключает их **по мере готовности их OM** — сейчас `GAP`, не строить.

---

## Итог по 4 профилям (готово к сборке)

Все 4 роли Tower описаны как Operating Model и сверены с кодом:
- №1 `CALL_CENTER` (Умар) — `docs/23-role-call-center.md`
- №2 `BROKER` (Азиз) — `docs/24-role-broker.md`
- №3 `COMMERCIAL_DIRECTOR` (Камила) — `docs/25-role-commercial-director.md` (Operating Model v1)
- №4 `CEO` (Мурад) — этот файл

**Следующий шаг** — сборка четырёх профилей в единую **Tower operating chain** (`Умар → Азиз → Камила → CEO-rollup`): CEO-слой берёт из неё Tower-rollup, drill-down и фильтр Камилы; портфельная часть (Rooftop/Sense48/…) — отдельный слой поверх, по мере подтверждения OM. При сборке синхронизировать `SYSTEM_MAP` и уточнить дизайн **M3** + план фаз под накопленные развилки (лимиты стадий КЦ/брокера · Intent/discovery-слой · цена собственника + история · CASH-settlement + Cash Desk · split-approval · пульт директора · CEO Home/portfolio rollup).

**Открытые решения, ждущие Мурада (сведены):** §13.A KPI Камилы · §13.B Cash Desk + документ · §13.C пороги эскалации · §13.D подача данных др. бизнесов · §13.E выделение Finance-контура · `CEO` vs `OWNER` для Мурада.
