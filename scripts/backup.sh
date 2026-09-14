#!/usr/bin/env bash
# G-05: ручной бэкап БД (compose-сервис backup делает то же ежедневно).
# Использование: ./scripts/backup.sh [каталог]
set -euo pipefail
DIR="${1:-./backups}"
mkdir -p "$DIR"
FILE="$DIR/finance_os_$(date +%F_%H%M).dump"
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-finance}" -Fc finance_os > "$FILE"
echo "Бэкап: $FILE ($(du -h "$FILE" | cut -f1))"
