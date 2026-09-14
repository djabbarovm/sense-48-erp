#!/usr/bin/env bash
# G-05: восстановление БД из дампа. ОСТАНОВИТЕ web/workers перед восстановлением.
# Использование: ./scripts/restore.sh backups/finance_os_2026-09-14.dump
set -euo pipefail
DUMP="${1:?Укажите файл дампа}"
read -r -p "Восстановление ПЕРЕЗАПИШЕТ базу finance_os. Продолжить? [yes/N] " answer
[ "$answer" = "yes" ] || { echo "Отменено"; exit 1; }
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_restore -U "${POSTGRES_USER:-finance}" --clean --if-exists -d finance_os < "$DUMP"
echo "Восстановлено из $DUMP. Проверьте verifyAuditChain перед запуском."
