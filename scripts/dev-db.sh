#!/usr/bin/env bash
# Локальный PostgreSQL без Docker — для песочниц/CI, где docker-демон недоступен (ADR-003).
# Использование: scripts/dev-db.sh start|stop|status
set -euo pipefail

PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
PGDATA=${PGDATA:-/var/lib/finance-os-pg}
PGPORT=${PGPORT:-5432}
DB=${DB:-finance_os}
DBUSER=${DBUSER:-finance}

run_pg() {
  # postgres не запускается под root — при необходимости деградируем к системному пользователю postgres
  if [ "$(id -u)" = "0" ]; then
    su postgres -s /bin/bash -c "$*"
  else
    bash -c "$*"
  fi
}

case "${1:-start}" in
  start)
    if [ ! -d "$PGDATA" ]; then
      mkdir -p "$PGDATA"
      [ "$(id -u)" = "0" ] && chown postgres:postgres "$PGDATA"
      run_pg "'$PGBIN/initdb' -D '$PGDATA' -U '$DBUSER' --auth=trust -E UTF8 >/dev/null"
      run_pg "echo \"unix_socket_directories = '$PGDATA'\" >> '$PGDATA/postgresql.conf'"
    fi
    run_pg "'$PGBIN/pg_ctl' -D '$PGDATA' -o '-p $PGPORT' -l '$PGDATA/log' start"
    run_pg "'$PGBIN/createdb' -h localhost -p '$PGPORT' -U '$DBUSER' '$DB' 2>/dev/null" || true
    echo "postgres ready: postgresql://$DBUSER:finance@localhost:$PGPORT/$DB"
    ;;
  stop)
    run_pg "'$PGBIN/pg_ctl' -D '$PGDATA' stop"
    ;;
  status)
    run_pg "'$PGBIN/pg_ctl' -D '$PGDATA' status"
    ;;
esac
