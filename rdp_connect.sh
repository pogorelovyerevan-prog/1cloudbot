#!/bin/bash

# RDP подключение к Windows Server для запуска сессии CloudAdmin
# После подключения создаётся RDP сессия, запускается Chrome через startup скрипт

LOG_FILE="/root/1cloudbot/logs/rdp_connect.log"
mkdir -p /root/1cloudbot/logs

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Параметры подключения
RDP_HOST="80.251.156.22"
RDP_PORT="48337"
RDP_USER="CloudAdmin"
RDP_PASS="d32jk8cAHTwW4eX8"

log "Начинаю RDP подключение к $RDP_HOST:$RDP_PORT"

# Запускаем xfreerdp в фоне
# /cert:ignore - игнорировать сертификат
# /sec:tls - использовать TLS
# /timeout:15000 - таймаут подключения 15 сек
# Подключение создаст RDP сессию, после чего мы отключимся через timeout

timeout 30 xfreerdp /v:$RDP_HOST:$RDP_PORT     /u:$RDP_USER     /p:$RDP_PASS     /cert:ignore     /sec:tls     /size:800x600     /drive:temp,/tmp     /timeout:15000     > "$LOG_FILE" 2>&1 &

RDP_PID=$!
log "RDP процесс запущен (PID: $RDP_PID)"

# Ждём 10 секунд чтобы подключение установилось
sleep 10

# Убиваем RDP подключение (сессия останется активной на Windows)
if kill $RDP_PID 2>/dev/null; then
    log "RDP подключение завершено, сессия CloudAdmin создана"
else
    log "RDP процесс уже завершился"
fi

log "Готово. Chrome должен запуститься автоматически в RDP сессии."
