#!/usr/bin/env bash
# Starts the isolated `dsh web` in the background (own session, survives this shell), writes its
# pid to sandbox.pid and the port it settled on to sandbox.port, logs to sandbox.log, and waits
# until the port answers. Port: KB_SANDBOX_PORT, else 3098; if busy the next free one is used.
# sandbox.log (0600) contains DSH's token URL: never print or paste it, sign in with the cookie
# (scripts/live-page.mjs) instead.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/paths.sh"
# Decide the port BEFORE sourcing the env (which freezes it into KB_HOST / DSH_WEB_PORT).
REAL_PORT_FILE="$KB_SANDBOX_STATE/sandbox.port"
if [ -f "$KB_SANDBOX_STATE/sandbox.pid" ] && kill -0 "$(cat "$KB_SANDBOX_STATE/sandbox.pid")" 2>/dev/null; then
  echo "already running: pid $(cat "$KB_SANDBOX_STATE/sandbox.pid") on port $(cat "$REAL_PORT_FILE" 2>/dev/null || echo '?')"
  exit 0
fi
rm -f "$KB_SANDBOX_STATE/sandbox.pid"

want="${KB_SANDBOX_PORT:-3098}"
busy() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
port="$want"
while busy "$port" || [ "$port" = 3080 ]; do port=$((port + 1)); done
[ "$port" = "$want" ] || echo "port $want is busy, using $port"
echo "$port" > "$REAL_PORT_FILE"
unset KB_SANDBOX_PORT
# shellcheck disable=SC1091
source "$HERE/env.sh"

[ "$HOME" != "$KB_REAL_HOME" ] || { echo "HOME is the real home; refusing" >&2; exit 1; }
[ -d "$DSH_HOME/profiles/web/node_modules/@local" ] || "$HERE/setup.sh"
[ -f "$DSH_HOME/kybernos/onboarding.json" ] || "$HERE/setup.sh"

umask 077
LOG="$KB_SANDBOX_STATE/sandbox.log"
: > "$LOG"
# perl setsid: its own session/process group, so killing the sandbox never touches this shell's group
# and closing this shell does not kill the sandbox.
nohup perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV' -- \
  env HOME="$HOME" DSH_HOME="$DSH_HOME" DSH_WEB_PORT="$port" \
  dsh --profile web --host 127.0.0.1 --port "$port" --no-open \
  >> "$LOG" 2>&1 < /dev/null &
pid=$!
echo "$pid" > "$KB_SANDBOX_STATE/sandbox.pid"
disown "$pid" 2>/dev/null || true

echo "started pid $pid on 127.0.0.1:$port, waiting for it to answer..."
for i in $(seq 1 240); do
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "dsh exited early; last log lines:" >&2
    tail -n 25 "$LOG" | sed -E 's#(token=)[A-Za-z0-9_.~-]+#\1[hidden]#g' >&2
    rm -f "$KB_SANDBOX_STATE/sandbox.pid"; exit 1
  fi
  code="$(curl -s -o /dev/null -m 2 -w '%{http_code}' "http://127.0.0.1:$port/" || true)"
  case "$code" in
    2??|3??|401|403)
      # The port answers before every bundle has mounted its routes: DSH prints `dsh web: http://...` last.
      if grep -q '^dsh web: http' "$LOG"; then echo "up after ~$((i / 2))s, bundles mounted (HTTP $code without a session is expected)"; exit 0; fi ;;
  esac
  sleep 0.5
done
echo "timeout: port $port never answered; see $LOG (do not paste its token URL)" >&2
exit 1
