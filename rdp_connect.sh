#!/bin/bash

# RDP подключение к Windows Server для запуска сессии CloudAdmin
# После подключения создаётся RDP сессия, запускается Chrome через startup скрипт

set -euo pipefail

LOG_FILE="/root/1cloudbot/logs/rdp_connect.log"
RDP_STDOUT_LOG="/root/1cloudbot/logs/rdp_connect.xfreerdp.log"

mkdir -p /root/1cloudbot/logs

echo "" >> "$LOG_FILE" || true

timestamp() {
  date '+%Y-%m-%d %H:%M:%S'
}

log() {
  echo "[$(timestamp)] $1" | tee -a "$LOG_FILE"
}

# Параметры подключения
RDP_HOST="80.251.156.22"
RDP_PORT="48337"
RDP_USER="CloudAdmin"
RDP_PASS="d32jk8cAHTwW4eX8"

log "Начинаю RDP подключение к $RDP_HOST:$RDP_PORT"

# Запускаем xfreerdp с retry.
# Важно: не пишем stdout/stderr xfreerdp в LOG_FILE, чтобы не затирать наши логи.
# timeout вернёт 124, если процесс был прерван по времени — это нормальный сценарий.

attempt=1
max_attempts=3

while [[ $attempt -le $max_attempts ]]; do
  log "Попытка $attempt/$max_attempts: запускаю xfreerdp (держу соединение 25 сек, затем выхожу)"

  set +e
  timeout 25 xfreerdp \
    /v:$RDP_HOST:$RDP_PORT \
    /u:$RDP_USER \
    /p:$RDP_PASS \
    /cert:ignore \
    /sec:tls \
    /size:800x600 \
    /drive:temp,/tmp \
    /timeout:15000 \
    >> "$RDP_STDOUT_LOG" 2>&1
  rc=$?
  set -e

  if [[ $rc -eq 124 ]]; then
    log "✅ timeout сработал (rc=124) — сессия должна быть создана."
    log "Готово. Chrome должен запуститься автоматически в RDP сессии."
    exit 0
  fi

  log "⚠️ xfreerdp завершился раньше времени (rc=$rc). Смотрю лог и пробую ещё раз."
  tail -n 30 "$RDP_STDOUT_LOG" | sed 's/^/[xfreerdp] /' | tee -a "$LOG_FILE" || true

  attempt=$((attempt+1))
  sleep 5

done

log "❌ Не удалось стабильно создать RDP сессию после $max_attempts попыток."
exit 1
