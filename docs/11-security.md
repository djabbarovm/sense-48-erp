# 11 — Security

## Threat model (STRIDE, кратко)

| Угроза | Вектор | Контроль |
|---|---|---|
| Подмена реквизитов vendor (BEC) | Сотрудник/атакующий меняет счёт перед оплатой | BR-030–033: UNVERIFIED, dual verify, SECURITY_ALERT, 7-day high-value rule, append-only history |
| Дублирующая оплата | Ошибка/умысел | BR-002–004, unique constraints |
| Переплата | Умысел | BR-010/011, exception только Owner/Lead с audit |
| Фиктивный платёж | Insider создаёт и утверждает | BR-040 SOD, BR-001 source, BR-023 docs |
| Cross-tenant утечка | Ошибка scoping | BR-073 типизированный TenantContext, 404 policy, fuzz tests |
| Утечка секретов | OTP/карты в комментариях, логах | BR-072 фильтр, log redaction, no secrets in DB/seed |
| Подделка audit | Insider с DB-доступом | Append-only grants, hash chain, daily verify job, off-site export |
| Компрометация аккаунта | Фишинг | MFA обязателен для Owner/Lead/Admin, session 8h, re-auth на batch.approve и vendor.bank.reveal |
| Telegram spoof | Фейковый бот/чат | Бот ничего не принимает, только deep links; linking по one-time code |
| Массовый экспорт данных | Роль с report.export | Rate limit, audit каждой выгрузки, watermark tenant/user |

## Секреты
- Только env / secret store. `.env.example` без значений. CI secret scan (gitleaks).
- `account_encrypted`: AES-256-GCM, ключ `BANK_DATA_KEY` в env, ротация через re-encrypt скрипт.
- Bot token, SMTP, S3 keys — env.
- В коде запрещено логировать объекты целиком; logger с redact-списком полей.

## Маскирование
Всё, что похоже на банковский счёт (20 цифр) или карту (16 цифр), при выводе в UI/лог маскируется, кроме экспорта batch и `vendor.bank.reveal` (audit).

## Доступ и сессии
Supabase JWT + server-side session check на каждом Server Action. RBAC — на уровне core, не middleware. Re-auth (пароль или TOTP) для: batch.approve, vendor.bank.reveal, policy.manage, user.manage.

## Файлы
Signed URL 15 мин; проверка MIME по magic bytes; лимит 25 МБ; антивирус — ClamAV в compose (опционально, флаг).

## Инциденты (runbook в README)
OTP в чате → security review, ротация. Bank change → freeze + callback. Duplicate → recovery workflow + root cause в DECISIONS. Suspected fraud → block vendor, preserve audit export, escalate.

## Тесты безопасности (Phase G)
Permission matrix 100%; cross-tenant fuzz; audit immutability; secret pattern scan на всё дерево; dependency audit в CI; ZAP baseline на dev-стенд.

## Compliance by design
Система не содержит функций: генерация СФ без основания, «закрытие базы», массовое backdating, удаление финансовых объектов. Любая попытка реализовать такое — нарушение CLAUDE.md §10.
