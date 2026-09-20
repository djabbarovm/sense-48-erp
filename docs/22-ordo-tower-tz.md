# ORDO Tower — Техническое задание на коммерческий контур

> Единый источник правды по контуру Tower (заменяет прежний SPEC.md). Дополняется `22a-ordo-tower-tz-dop1.md`.
> Язык — русский; идентификаторы (enum, роли, поля) — английские, как в репозитории. Решения на 20.09.2026.

## 0. Назначение и контекст
Коммерческий контур бизнес-юнита **Tower** — агентство недвижимости, которое **ещё и управляет** частью активов башни Piramit. Tower — часть экосистемы **ORDO** (не путать с ORDO FM — эксплуатация здания, отдельный контур). Веб + мобайл.

**Периметр Tower — коммерция:** от входящего сигнала до подписанного договора и полученной комиссии, плюс сопутствующие документы и онбординг. Дальше клиента ведёт **Services**, физическое исполнение — **Operations** (вне контура, но с передачами/handoff).

**Команда — 4 человека:** `CALL_CENTER` (Умар, маршрутизатор), `BROKER` (Азиз, полный цикл сделки + подключение собственников + документы сделки), `COMMERCIAL_DIRECTOR` (Камила, РОП: контроль, распределение, деньги-подтверждение, аналитика), `CEO` (Мурад, оверсайт/утверждения/периметр). Функции-на-вырост (`PortfolioManager, ProductSpecialist, DataSteward, Finance, Documents`) — моделируются в данных, исполняет один из четверых; штатные роли не заводить.

**Главный принцип.** У каждого активного объекта — один accountable-владелец, одно NextAction, срок, проверяемый результат. Передача состоялась только после принятия принимающей стороной. Состояние не переписывает историю — создаёт Timeline Event.

## 1. Текущее состояние и поправки
Сделано на ветке `claude/own-it-product-w1ij9b` (не в main): Phase 1 (алиас CM→BROKER, фиче-флаги, config), Phase 2a (селективный SoD-мёрж).
**Поправить перед 2c:** (1) убрать у `BROKER` право `rent.view` — у брокериджа аренды/дебиторки у ORDO нет; брокер видит только свою комиссию. (2) rent-charges/receivables — только на паркинг-пуле, на LTR не запускать. (3) блок дебиторки в control-room — только director/finance. Миграции M1 (DUE_DILIGENCE), M2 (tower_setting) — применять.

## 2. Роли и доступ
`CALL_CENTER`: today, inbox(full), deals(create+route), contacts(leads). Без PII собственников/чужих, без денег/договоров.
`BROKER`: today, deals(own), contacts(own), building/units/listing(full), intent.capture, lease.manage, lease.view, unit.publish, contract.documents, commission.view(own). НЕ имеет: rent.view, mall.manage, commission.manage(подтверждение), unit.pricing.edit(утв.цены/%), owner.onboarding.approve, bonus.confirm, rent.match, property.manage.
`COMMERCIAL_DIRECTOR`: всё коммерческое + распределение лидов + утв.цены/% + подтверждение оплаты комиссий (PAID) + дебиторка (комиссии+пул) + пул-операции + аналитика + бонусы(confirm/payable).
`CEO`: оверсайт + Exception + утв.выплаты бонусов + периметр(флаги) + крупные решения.
Approval — аудируемое действие (actor/time/reason), не редактируемое поле. Чувствительные данные — need-to-know + лог доступа.

### 2.2 Маршрутизация входящих (CALL_CENTER)
снять/купить → BROKER (сделка); собственник сдать/продать → BROKER (листинг); собственник паркинг-пул → COMMERCIAL_DIRECTOR; действующий клиент/сервис → Services.

## 3. Объектная модель
Party; OwnerRelationship; Unit (мульти-осевой статус, §4); OwnershipInterest (temporal, hard-delete запрещён); Intent (версионируемая цель + reviewDate; намерение НЕ даёт прав); Mandate (полномочие действовать, сейчас устное — §6.4); CommercializationCase; Opportunity (сделка, §5.1); Contract (+пакет документов, §6.3); Listing; ParkingPool/PoolSpace/PoolRental (§5.3); NextAction; Handoff; Exception (S1|S2|S3, заменяет attention-флажки); FinancialEvent (единственный источник статуса оплаты; слепой Paid запрещён); TimelineEvent (неизменяемая история).

### 3.1 Инварианты
По юниту либо брокеридж, либо управление (нет двойной монетизации). У активного объекта ровно один open NextAction (или close/Exception). Противоречия статусов → Exception, владелец решения `CEO`.

## 4. Оси статуса Unit (независимые)
identity, ownership, readiness (факт — Operations), occupancy, productRoute, commercialActivation, color(derived GREEN|YELLOW|RED|GREY|BLUE|NEUTRAL — сохранить). Существующие enum репозитория сохранить. Новые: MandateLevel, HandoffState, ExceptionSeverity, IntentStatus; в KpiChecklistItem добавить DUE_DILIGENCE (гейт перед CONTRACT; исключён из бонус-чеклиста).

## 5. Воронки
### 5.1 Сделка (Opportunity) — BROKER владеет 2–10, CALL_CENTER — 1
NEW(1,CALL_CENTER) → QUALIFIED/PROPERTY_SELECTED(2) → VIEWING(3) → OFFER(4, продажа: цену/% утв. DIRECTOR) → NEGOTIATION(5) → RESERVED(6,+дедлайн) → LOI+DUE_DILIGENCE(7) → CONTRACT(8, +документы §6.3) → MOVE_IN(9, комиссия получена: BROKER собрал → DIRECTOR PAID) → WON(10, +handoff HANDOVER_SERVICES: акт, фото, данные квартиры, доступ, upsell клининга, передача в Services). Forward-only; откат — DIRECTOR. Терминальные WON/LOST(с причиной).
### 5.2 Листинг (brokerage) — BROKER
Входящий собственника → приём объекта (ставка/цена утв.DIRECTOR, фото, документы) → в фонде (commercialActivation=market_ready, published).
### 5.3 Паркинг девелопера — пул (приоритет, реальный продукт)
ORDO сдаёт ~300 мест девелопера, берёт 15% собранной аренды. Инвентарь → тарифы(BROKER→DIRECTOR) → сдача мест(BROKER) → сбор+дебиторка(DIRECTOR) → 15% → месячный отчёт/сеттлмент. Здесь живут RentStatus/дебиторка. Без договора управления и heavy-онбординга. Кладовые/депо — тем же паттерном.
### 5.4 Handoff/Mandate/смена собственника
Handoff: requested→accepted→completed (rejected+причина). Mandate: сейчас устный — гейт мягкий (WARN). Смена собственника: contain→verify→end old(temporal)→пересмотр→new relationship→re-confirm Intent. Без hard-delete.

## 6. Продукты и деньги
### 6.1 Комиссии (в конфиг): LEASE_LTR/LEASE_OFFICE 0.5*firstMonthRent; SALE tiered(3/2/1.5%, утв.DIRECTOR); PARKING_LEASE 0.5*месяц (successFee); PARKING_SALE tiered; DEV_PARKING_POOL 0.15*collectedRent (RECURRING, ACTIVE, ~300 мест); STORAGE_POOL 0.15 (TBD); STR_MANDATE/MALL_LEASE PAUSED.
### 6.2 Денежная модель — КРИТИЧНО. Брокеридж: собственник заключает договор с арендатором/покупателем напрямую; ORDO аренду НЕ ведёт и дебиторку арендатора НЕ трекает — единственный финобъект — своя комиссия. Сбор аренды только на паркинг-пуле (15%). RentStatus/дебиторка — только пул. Этап «первая оплата» = комиссия получена. Дебиторка у DIRECTOR = неоплаченные комиссии + сбор по пулу.
### 6.3 Договор и документы (часть комиссии). ORDO хранит `Contract`, выдаёт/адаптирует договор аренды из шаблона, готовит акт приёма-передачи, фиксирует фото состояния при заезде; артефакты идут в пакет передачи в Services. Ongoing-аренду/дебиторку по LTR не ведём.
### 6.4 Деньги — SoD. Сумма комиссии — только авторасчёт (6.1). Комиссия ACCRUED при подписании — BROKER двигает в MOVE_IN. Оплата (наличные): BROKER собирает кэш (custody), передаёт Камиле; `COMMERCIAL_DIRECTOR` подтверждает получение → PAID. (Р/с позже → PAID через bank-match.) Брокер свою комиссию не закрывает; слепой Paid запрещён. Между ACCRUED и PAID — дебиторка по комиссиям. Бонус: DIRECTOR→PAYABLE, CEO→PAID.
### 6.5 Mandate — уровни (тексты от бизнеса). Сейчас на брокеридже договор с собственником устный. Mandate — лёгкий объект (кто/юнит/продукт/ставка/срок), гейт WARN. MandateLevel: LISTING_AGREEMENT, SALE_MANDATE, MANAGEMENT_AGREEMENT(STR — пауза).

## 7. Экраны по ролям (вайрфреймы в reference)
CALL_CENTER — «Очередь входящих» (Непринятые/Дольше всех ждёт/Принято/Направлено%; очередь + классификация/маршрутизация). BROKER — «Мой день/Доска сделок» (Показы/Новые лиды/Без шага/Резервы истекают; канбан 2–10 + карточка с документами; листинг+intake). DIRECTOR — «Пульт команды» (Лиды/нед · Конверсия · Заполняемость · Дебиторка(комиссии+пул) · Комиссии к подтв.; подтверждение оплат + распределение). CEO — «Пульт по исключениям» (Противоречия/Зависшие/Крупная дебиторка/Бонусы к утв./Результат фонда; только Exception + утверждения). Очереди — из состояния+SLA+NextAction.

## 8. Алерты и пороги
few_leads, conversion_drop, fund_emptying, pool_underloaded, inbound_no_contact(CRIT,CALL_CENTER), lead_no_first_step(CRIT,BROKER), deal_no_next_action, deal_stale, reservation_expiring(CRIT), offer_hanging, commission_unpaid(CRIT,DIRECTOR — наша комиссия), pool_rent_overdue(CRIT — только пул), commission_to_confirm(INFO,DIRECTOR), bonus_to_approve(INFO,CEO), data_contradiction(CRIT,CEO). Пороги в `tower_setting` (live-edit, дефолты в коде, НЕ ApprovalPolicy): lead_norm_week 15, sla_first_contact 15m, stale_days 7, reserve_hours 48, offer_days 3, mandate_warn_days 30, lease_warn_days 90, fund_alert .60, pool_alert .70, conv_alert .20.

## 9. Автоматизация и контроль
Автоматизировать: dedupe, gate-проверки, SLA/expiry/no-action, Timeline, черновики Handoff, генерация документов, контрольные очереди. Только человек: ownership, product route, утв.цены, разрешение Exception, переговоры, подтверждение оплаты (Камила). Никогда: подпись за собственника, замена собственника, приём цены, публикация до утверждения, авто-merge, Paid по факту загрузки файла, закрытие брокером своей комиссии.

## 10. Нефункциональные
Multi-tenant (tenant_id везде). Immutable timeline + reassignment history; hard-delete запрещён (temporal end). Аудит approvals и доступа к чувствительным данным. Фиче-флаги FEATURE_STR/FEATURE_MALL=false; паркинг-пул строим (не за заглушкой). DoD фазы: код+миграция+permission-тесты+аудит; lint/typecheck; 0 регрессий; миграции с планом отката; в main не вливать без ревью полного дифа.

## 11. План фаз
2a ✅ селективный SoD-мёрж. 2b/c: поправки §1; Intent + лёгкий Mandate (WARN); воронка §5.1 forward-only+откат=DIRECTOR; гейт DUE_DILIGENCE; экран CALL_CENTER; доска BROKER; виды фонда со ставкой/сроком/арендатором (доп.№1). 3: деньги §6.4 (accrued при подписании; кэш брокер→Камила=PAID; дебиторка комиссий); Contract+документы §6.3; Handoff+Exception; пульт DIRECTOR. 3.5: паркинг-пул §5.3 (инвентарь ~300, тарифы, сдача, сбор, дебиторка, 15%, отчёт). 4: движок алертов §8 из tower_setting; пульт CEO. 5: листинг §5.2; смена собственника; кладовые/депо.

## 12. Открытые вопросы (не блокируют)
Число мест (~300); кладовые/депо (TBD); механика сеттлмента (по умолчанию ORDO удерживает 15%); тексты договоров/pricing authority; бонусные суммы; значения порогов §8.

## 13. Anti-scope
8 штатных ролей; enterprise-DMS из 12 модулей сразу; обязательный полный мандат на каждую аренду; heavy «управление» (кроме STR, пауза); ORDO-трекинг аренды собственник↔арендатор на брокеридже; ручной/слепой Paid; закрытие брокером своей комиссии.
