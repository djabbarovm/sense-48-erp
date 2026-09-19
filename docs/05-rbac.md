# 05 — RBAC

## Принципы

- Права привязаны к паре (user, tenant, role). Сервисная команда (Lead, Junior, Doc Controller, Accountant) обычно имеет роли в нескольких tenant — «портфель».
- Каждый запрос выполняется в `TenantContext {tenant_id, user_id, roles[]}`. Смена tenant — явный переключатель в UI; API никогда не принимает tenant_id из body без проверки против контекста.
- Cross-tenant запрос → 404 (не 403, чтобы не раскрывать существование).
- Отсутствие права → 403 с кодом `PERMISSION_DENIED:<permission>`.
- Owner видит все данные своего tenant, но **не может** готовить платежи и не может быть единственным approver своего же PaymentRequest (BR-040).
- Admin настраивает, но не участвует в финансовом workflow (нет `payment.*` прав).

## Роли

| Код | Описание | MFA |
|---|---|---|
| OWNER | Собственник / CEO tenant | обязателен |
| FINANCE_OPS_LEAD | Старший финансист сервисной компании | обязателен |
| JUNIOR_FINANCE | Оператор рутины | рекомендован |
| DOCUMENT_CONTROLLER | Документы, Didox, договоры | — |
| ACCOUNTANT | Бухгалтер 1С (внешний) | — |
| REQUESTER | Инициатор закупок / sales | — |
| ADMIN | Настройка tenant | обязателен |
| COMMERCIAL_MANAGER | MDS Property: коммерция, сделки, цены, статусы занятости (docs/20 §6) | рекомендован |
| BROKER | MDS Property: назначенный inventory, показы, стадии до договора | — |
| OPERATIONS_MANAGER | MDS Property: готовность, эксплуатация, заявки | — |
| MARKETING | MDS Property: публикация approved inventory, без PII собственников | — |
| PROPERTY_OWNER | MDS Property: кабинет собственника — только свои помещения, договоры, документы, выплаты, заявки, услуги, согласия (docs/20 §11.6, §11.8) | рекомендован |

## Матрица прав

Обозначения: ✓ = есть, — = нет, R = только чтение, T1/T2/T3 = по tier.

| Permission | OWNER | LEAD | JUNIOR | DOC_CTRL | ACCT | REQ | ADMIN |
|---|---|---|---|---|---|---|---|
| **Master data** | | | | | | | |
| vendor.view | ✓ | ✓ | ✓ | ✓ | R | R (только имя) | ✓ |
| vendor.create | — | ✓ | ✓ | ✓ | — | ✓ (→ PENDING) | — |
| vendor.edit | — | ✓ | ✓ | ✓ | — | — | — |
| vendor.block | ✓ | ✓ | — | — | — | — | — |
| vendor.bank.reveal | ✓ | ✓ | — | — | ✓ | — | — |
| vendor.bank.change | — | ✓ | ✓ | ✓ | — | — | — |
| vendor.bank.verify_step1 | — | ✓ | ✓ | — | — | — | — |
| vendor.bank.verify_step2 | ✓ | ✓ | — | — | — | — | — |
| vendor.merge | — | — | — | — | — | — | ✓ |
| contract.view | ✓ | ✓ | ✓ | ✓ | R | R (свои) | ✓ |
| contract.create/edit | — | ✓ | ✓ | ✓ | — | — | — |
| contract.approve | ✓ | ✓ | — | — | — | — | — |
| contract.terminate | ✓ | — | — | — | — | — | — |
| customer.* | ✓ | ✓ | ✓ | ✓ | R | ✓ create | ✓ |
| costcenter/category.manage | — | — | — | — | — | — | ✓ |
| employee.view | ✓ | ✓ | R | R | ✓ | — | ✓ |
| employee.manage | — | ✓ | — | — | ✓ | — | ✓ |
| **P2P** | | | | | | | |
| pr.create | ✓ | ✓ | ✓ | — | — | ✓ | — |
| pr.view | ✓ | ✓ | ✓ | ✓ | R | свои + свой cc | ✓ |
| pr.approve.business | ✓ | ✓ | — | — | — | ✓ (если cost_center_owner) | — |
| pr.approve.finance | — | ✓ | ✓ (T1) | — | — | — | — |
| pr.approve.owner | ✓ | — | — | — | — | — | — |
| pr.cancel | ✓ | ✓ | — | — | — | свои до APPROVED | — |
| po.manage | — | ✓ | ✓ | — | — | — | — |
| receipt.create | ✓ | ✓ | ✓ | ✓ | — | ✓ | — |
| invoice.create/import | — | ✓ | ✓ | ✓ | ✓ | — | — |
| invoice.match | — | ✓ | ✓ | ✓ | — | — | — |
| invoice.resolve_duplicate | — | ✓ | — | — | — | — | — |
| document.upload | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (к своим PR) | — |
| document.mark_received | — | ✓ | ✓ | ✓ | — | — | — |
| **Payments** | | | | | | | |
| payment.create | — | ✓ | ✓ | — | — | — | — |
| payment.view | ✓ | ✓ | ✓ | ✓ | ✓ | свои PR | ✓ |
| payment.exception.approve | ✓ | ✓ | — | — | — | — | — |
| payment.urgent.approve | ✓ | ✓ | — | — | — | — | — |
| payment.cancel | ✓ | ✓ | свои DRAFT | — | — | — | — |
| batch.create/edit | — | ✓ | ✓ | — | — | — | — |
| batch.freeze | — | ✓ | ✓ | — | — | — | — |
| batch.unfreeze | — | ✓ | — | — | — | — | — |
| batch.review | — | ✓ | — | — | — | — | — |
| batch.approve | ✓ | ✓ (только если Owner делегировал в policy) | — | — | — | — | — |
| batch.export | — | ✓ | ✓ | — | — | — | — |
| batch.mark_sent | — | ✓ | ✓ | — | — | — | — |
| bank.import | — | ✓ | ✓ | — | ✓ | — | — |
| bank.reconcile.manual | — | ✓ | ✓ | — | ✓ | — | — |
| bank.account.manage | — | — | — | — | — | — | ✓ |
| advance.close | — | ✓ | ✓ | ✓ | ✓ | — | — |
| advance.write_off | ✓ | — | — | — | — | — | — |
| **AR / Events** | | | | | | | |
| event.create/edit | ✓ | ✓ | ✓ | — | — | ✓ | — |
| event.confirm | ✓ | ✓ | — | — | — | ✓ (если sales) | — |
| event.close | — | ✓ | — | — | — | — | — |
| ar.invoice.manage | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ create | — |
| ar.dispute | ✓ | ✓ | ✓ | — | — | ✓ | — |
| **Compliance / close** | | | | | | | |
| tax.calculate | — | ✓ | — | — | ✓ | — | — |
| tax.approve | ✓ | ✓ | — | — | — | — | — |
| tax.file | — | — | — | — | ✓ | — | — |
| payroll.prepare | — | ✓ | — | — | ✓ | — | — |
| payroll.approve | ✓ | ✓ | — | — | — | — | — |
| close.run | — | ✓ | ✓ (checklist items) | — | ✓ | — | — |
| accounting.export_1c | — | ✓ | — | — | ✓ | — | — |
| accounting.mark_posted | — | — | — | — | ✓ | — | — |
| **Reporting** | | | | | | | |
| dashboard.owner | ✓ | ✓ | — | — | — | — | — |
| dashboard.ops | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| report.export | ✓ | ✓ | — | — | ✓ | — | — |
| budget.manage | ✓ | ✓ | — | — | — | — | — |
| **Admin** | | | | | | | |
| tenant.settings | — | — | — | — | — | — | ✓ |
| policy.manage | ✓ (approve) | — | — | — | — | — | ✓ (edit) |
| user.manage | — | — | — | — | — | — | ✓ |
| audit.view | ✓ | ✓ | — | — | R | — | ✓ |

## MDS Property

Права `property.*` и `unit.*` и их матрица по ролям — в `docs/20-mds-property.md` §6 (source of truth — `PERMISSION_MATRIX`).

## Portfolio access

`UserTenantRole` может иметь несколько tenant для одного user. UI: переключатель tenant в шапке; «Портфель» — сводный экран по всем tenant с одинаковой ролью (только для LEAD/JUNIOR/DOC_CTRL/ACCT). Данные разных tenant никогда не смешиваются в одной таблице БД-запроса без явного `tenant_id IN (...)` из контекста.

## Permission tests (обязательные)

Для каждой строки матрицы — параметризованный тест: роль × действие → ожидаемый код (200/403). Плюс для каждого endpoint: user tenant A запрашивает объект tenant B → 404. Генерируется из этого файла (парсер таблицы или ручной fixture) — покрытие 100% permission-кодов.

### Услуги (MDS Property, docs/20 §11.8)

| Право | Роли |
|---|---|
| service.view | OWNER, FINANCE_OPS_LEAD, JUNIOR_FINANCE, ACCOUNTANT, ADMIN, COMMERCIAL_MANAGER, BROKER, OPERATIONS_MANAGER, MARKETING |
| service.order | OWNER, COMMERCIAL_MANAGER, BROKER, OPERATIONS_MANAGER, MARKETING |
| service.manage | OWNER, OPERATIONS_MANAGER |
| service.verify | OWNER, OPERATIONS_MANAGER, COMMERCIAL_MANAGER |
| service.catalog | OWNER, ADMIN, OPERATIONS_MANAGER |
| owner.request (заказ услуг и заявки собственника по своим юнитам) | PROPERTY_OWNER |

### Аренда и дебиторка (MDS Property, docs/20 §11.9)

| Право | Роли |
|---|---|
| rent.view | OWNER, FINANCE_OPS_LEAD, JUNIOR_FINANCE, ACCOUNTANT, ADMIN, COMMERCIAL_MANAGER |
| rent.match (зачёт банковских поступлений — единственный путь к PAID) | OWNER, FINANCE_OPS_LEAD, JUNIOR_FINANCE |

### Комиссии и бонусы (MDS Property, docs/20 §11.10)

| Право | Роли |
|---|---|
| commission.view | OWNER, FINANCE_OPS_LEAD, JUNIOR_FINANCE, ACCOUNTANT, ADMIN, COMMERCIAL_MANAGER |
| commission.manage | OWNER, COMMERCIAL_MANAGER |
| bonus.view (все бонусы, отчёт) | OWNER, FINANCE_OPS_LEAD, ADMIN, COMMERCIAL_MANAGER |
| bonus.own (только свои) | COMMERCIAL_MANAGER, BROKER |
| bonus.confirm_kpi (подтверждение чек-листа, не продажник) | OWNER, COMMERCIAL_MANAGER |
| bonus.pay (отметка выплаты по ведомости) | OWNER, FINANCE_OPS_LEAD |
| deal.checklist (отметки пунктов чек-листа) | OWNER, COMMERCIAL_MANAGER, BROKER, OPERATIONS_MANAGER |

### ORDO Mall (docs/20 §11.11)

| Право | Роли |
|---|---|
| mall.view | OWNER, FINANCE_OPS_LEAD, JUNIOR_FINANCE, ACCOUNTANT, ADMIN, COMMERCIAL_MANAGER, BROKER, MARKETING, OPERATIONS_MANAGER |
| mall.manage (мандаты, ставки, линии актива) | OWNER, COMMERCIAL_MANAGER |
| mall.fee.view (контролируемая база и вознаграждение) | OWNER, FINANCE_OPS_LEAD, ADMIN, COMMERCIAL_MANAGER |
| contact.merge (слияние дублей клиентов) | OWNER, COMMERCIAL_MANAGER |
| owner.pipeline (воронка собственников, карточка, расчёт) | OWNER, COMMERCIAL_MANAGER, BROKER, MARKETING, FINANCE_OPS_LEAD, ADMIN; изменения — property.manage |
| house.view (деньги дома: взносы, бюджет, отчёт) | OWNER, FINANCE_OPS_LEAD, JUNIOR_FINANCE, ACCOUNTANT, ADMIN, OPERATIONS_MANAGER, COMMERCIAL_MANAGER |
| house.manage (фонд, тариф, бюджет, расходы) | OWNER, OPERATIONS_MANAGER, FINANCE_OPS_LEAD |
| зачёт взноса на счёт дома | rent.match (OWNER, FINANCE_OPS_LEAD, JUNIOR_FINANCE) |
| кадастр юнита, статус договора управления | property.manage |
