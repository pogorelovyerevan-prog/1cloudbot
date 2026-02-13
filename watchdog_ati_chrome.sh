#!/usr/bin/env bash
set -euo pipefail

# Watchdog: следит за "нашим" Chrome (с --user-data-dir=C:\ChromeParser\UserData) на Windows.
# Если процессов нет или память превышает порог, перезапускает через Scheduled Task.

WIN_HOST="${WIN_HOST:-80.251.156.22}"
WIN_PORT="${WIN_PORT:-22}"
WIN_USER="${WIN_USER:-CloudAdmin}"

TASK_NAME="${ATI_TASK_NAME:-ATI Parser AtLogon}"
MAX_MB="${CHROME_MAX_MB:-3500}"

WIN_SSH_KEY="${WIN_SSH_KEY:-/root/.ssh/id_ed25519_windows_server}"

ssh_base=(ssh -i "$WIN_SSH_KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new -p "$WIN_PORT" "${WIN_USER}@${WIN_HOST}")

STATUS_B64="JABwAHIAbwBjAHMAPQBHAGUAdAAtAFcAbQBpAE8AYgBqAGUAYwB0ACAAVwBpAG4AMwAyAF8AUAByAG8AYwBlAHMAcwAgAHwAIABXAGgAZQByAGUALQBPAGIAagBlAGMAdAAgAHsAIAAkAF8ALgBOAGEAbQBlACAALQBlAHEAIAAnAGMAaAByAG8AbQBlAC4AZQB4AGUAJwAgAC0AYQBuAGQAIAAkAF8ALgBDAG8AbQBtAGEAbgBkAEwAaQBuAGUAIAAtAGwAaQBrAGUAIAAnACoAQwA6AFwAXABDAGgAcgBvAG0AZQBQAGEAcgBzAGUAcgBcAFwAVQBzAGUAcgBEAGEAdABhACoAJwAgAH0AOwAgACQAYwBuAHQAPQAwADsAIABpAGYAKAAkAHAAcgBvAGMAcwApAHsAIAAkAGMAbgB0AD0AQAAoACQAcAByAG8AYwBzACkALgBDAG8AdQBuAHQAIAB9ADsAIAAkAHMAdQBtAD0AMAA7ACAAaQBmACgAJABwAHIAbwBjAHMAKQB7ACAAJABzAHUAbQA9ACgAQAAoACQAcAByAG8AYwBzACkAIAB8ACAATQBlAGEAcwB1AHIAZQAtAE8AYgBqAGUAYwB0ACAALQBQAHIAbwBwAGUAcgB0AHkAIABXAG8AcgBrAGkAbgBnAFMAZQB0AFMAaQB6AGUAIAAtAFMAdQBtACkALgBTAHUAbQAgAH0AOwAgACQAbQBiAD0AWwBtAGEAdABoAF0AOgA6AFIAbwB1AG4AZAAoACgAJABzAHUAbQAvADEATQBCACkALAAwACkAOwAgAFcAcgBpAHQAZQAtAE8AdQB0AHAAdQB0ACAAKAAnAEMATwBVAE4AVAA9ACcAKwAkAGMAbgB0ACsAJwAgAE0AQgA9ACcAKwAkAG0AYgApAA=="

status="$(${ssh_base[@]} "powershell -NoProfile -EncodedCommand $STATUS_B64" 2>/dev/null || true)"

cnt="$(echo "$status" | sed -n 's/.*COUNT=\([0-9]*\).*/\1/p')"
mb="$(echo "$status" | sed -n 's/.*MB=\([0-9]*\).*/\1/p')"

# Если не смогли получить метрики — выходим с ошибкой, но не ломаем работу.
if [[ -z "${cnt:-}" || -z "${mb:-}" ]]; then
  echo "[watchdog] WARN: could not read status from windows. raw=[$status]" >&2
  exit 0
fi

echo "[watchdog] windows chrome status: COUNT=$cnt MB=$mb (limit=$MAX_MB)"

if [[ "$cnt" -eq 0 ]]; then
  echo "[watchdog] chrome not running → starting task: $TASK_NAME"
  ${ssh_base[@]} "schtasks /run /tn \"$TASK_NAME\"" >/dev/null 2>&1 || true
  exit 0
fi

if [[ "$mb" -ge "$MAX_MB" ]]; then
  echo "[watchdog] chrome memory high → restarting ONLY our chrome instance + task"
  KILL_B64="JABwAHIAbwBjAHMAPQBHAGUAdAAtAFcAbQBpAE8AYgBqAGUAYwB0ACAAVwBpAG4AMwAyAF8AUAByAG8AYwBlAHMAcwAgAHwAIABXAGgAZQByAGUALQBPAGIAagBlAGMAdAAgAHsAIAAkAF8ALgBOAGEAbQBlACAALQBlAHEAIAAnAGMAaAByAG8AbQBlAC4AZQB4AGUAJwAgAC0AYQBuAGQAIAAkAF8ALgBDAG8AbQBtAGEAbgBkAEwAaQBuAGUAIAAtAGwAaQBrAGUAIAAnACoAQwA6AFwAXABDAGgAcgBvAG0AZQBQAGEAcgBzAGUAcgBcAFwAVQBzAGUAcgBEAGEAdABhACoAJwAgAH0AOwAgAGkAZgAoACQAcAByAG8AYwBzACkAewAgAEAAKAAkAHAAcgBvAGMAcwApACAAfAAgAEYAbwByAEUAYQBjAGgALQBPAGIAagBlAGMAdAAgAHsAIABTAHQAbwBwAC0AUAByAG8AYwBlAHMAcwAgAC0ASQBkACAAJABfAC4AUAByAG8AYwBlAHMAcwBJAGQAIAAtAEYAbwByAGMAZQAgAH0AIAB9AA=="
  ${ssh_base[@]} "powershell -NoProfile -EncodedCommand $KILL_B64" >/dev/null 2>&1 || true
  ${ssh_base[@]} "schtasks /run /tn \"$TASK_NAME\"" >/dev/null 2>&1 || true
  exit 0
fi

exit 0
