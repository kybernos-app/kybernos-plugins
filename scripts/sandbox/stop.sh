#!/usr/bin/env bash
# Stops ONLY the process recorded in sandbox.pid (and its descendants), after checking that it
# really is the sandbox's dsh (command line carries `--profile web` and our `--port`, port != 3080).
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/paths.sh"
PIDFILE="$KB_SANDBOX_STATE/sandbox.pid"
[ -f "$PIDFILE" ] || { echo "no sandbox.pid: nothing to stop"; exit 0; }
pid="$(cat "$PIDFILE")"
port="$(cat "$KB_SANDBOX_STATE/sandbox.port" 2>/dev/null || echo '')"

if ! kill -0 "$pid" 2>/dev/null; then echo "pid $pid is not running (stale pid file removed)"; rm -f "$PIDFILE"; exit 0; fi
[ -n "$port" ] && [ "$port" != 3080 ] || { echo "refusing: no sandbox.port or port 3080" >&2; exit 1; }
cmd="$(ps -p "$pid" -o command= 2>/dev/null || true)"
case "$cmd" in
  *"--profile web"*"--port $port"*) ;;
  *) echo "refusing: pid $pid does not look like the sandbox dsh (--port $port): $cmd" >&2; exit 1 ;;
esac

descendants() { local c; for c in $(pgrep -P "$1" 2>/dev/null); do descendants "$c"; echo "$c"; done; }
kids="$(descendants "$pid")"
kill -TERM "$pid" $kids 2>/dev/null
for i in $(seq 1 40); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
if kill -0 "$pid" 2>/dev/null; then kill -KILL "$pid" 2>/dev/null; fi
for k in $kids; do kill -0 "$k" 2>/dev/null && kill -KILL "$k" 2>/dev/null; done
rm -f "$PIDFILE"
echo "stopped pid $pid (port $port)"
