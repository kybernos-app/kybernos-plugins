#!/usr/bin/env bash
# Plays step 10 of the teams plan: two made-up accounts on a LOCAL server replica, driven through two sandbox DSH instances, with a recording proxy in between.
#   KB_E2E_DIR=<private folder, outside git>  KB_SERVER_DIR=<kybernos-server checkout>  bash scripts/e2e-teams-run.sh up
#   bash scripts/e2e-teams-run.sh run [j1 j2 ... ]     (default: every journey)
#   bash scripts/e2e-teams-run.sh down                  stops everything it started and deletes the sandbox homes and the replica state
# What it starts: the replica (REPLICA_SEED=catalogue, its own ports, its own state file, a database that is recreated at each launch), the recording proxy (the address the
# server advertises and DSH uses), two sandbox DSH instances (scripts/sandbox/*: own HOME, own port; the second one has its own state folder), then the setup
# (scripts/e2e-teams-setup.mjs) and the two device-flow connections (scripts/e2e-connect.mjs). Credentials are generated into $KB_E2E_DIR/accounts.json (0600).
# It never touches ports 8791/8792/3080 (the owner's own replica and DSH): it refuses them. Needs ~1 GB of APFS clone per sandbox: check `df` first.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
: "${KB_E2E_DIR:?set KB_E2E_DIR to a private folder outside git}"
: "${KB_SERVER_DIR:?set KB_SERVER_DIR to the kybernos-server checkout}"
mkdir -p "$KB_E2E_DIR" && chmod 700 "$KB_E2E_DIR"
API_PORT="${KB_E2E_API_PORT:-8821}"        # the replica itself (its mailbox/control port is +1)
WEB_PORT="${KB_E2E_WEB_PORT:-8820}"        # the recording proxy: the address the server advertises and DSH uses
CTRL_PORT=$((API_PORT + 1))
PORT_A="${KB_E2E_PORT_A:-3098}"; PORT_B="${KB_E2E_PORT_B:-3110}"
for p in "$API_PORT" "$WEB_PORT" "$CTRL_PORT" "$PORT_A" "$PORT_B"; do
  case "$p" in 8791|8792|3080) echo "refusing port $p: it belongs to the owner's own replica / DSH" >&2; exit 2 ;; esac
done
ENVF="$KB_E2E_DIR/env.sh"
SB_NAME="$(basename "$ROOT")"
SB_A="$HOME/.kybernos-sandbox/$SB_NAME"
SB_B="$HOME/.kybernos-sandbox/$SB_NAME-b"
detach() { perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV' -- "$@"; }
alive() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }

write_env() {
  cat > "$ENVF" <<EOF
export KB_E2E_API=http://localhost:$API_PORT KB_E2E_WEB=http://localhost:$WEB_PORT KB_E2E_CONTROL=http://127.0.0.1:$CTRL_PORT
export KB_E2E_DIR="$KB_E2E_DIR" KB_SERVER_DIR="$KB_SERVER_DIR" KB_PROXY_LOG="$KB_E2E_DIR/proxy.jsonl"
export KB_E2E_HOME_A="$SB_A/home" KB_E2E_HOME_B="$SB_B/home" KB_E2E_HOST_A=127.0.0.1:$PORT_A KB_E2E_HOST_B=127.0.0.1:$PORT_B
export KB_WORKTREE="$ROOT"
EOF
}

up() {
  [ "$(df -k "$HOME" | awk 'NR==2{print $4}')" -gt 3000000 ] || { echo "less than 3 GB free: clean up before starting two sandboxes" >&2; exit 1; }
  # 1. the replica: a copy of scripts/replica.ts whose imports are absolute and whose advertised address (PUBLIC_API_URL) is the proxy's, so that every link
  #    the server makes (invitation, console, activation) points at the address DSH uses.
  sed -e "s#from \"\\.\\./#from \"$KB_SERVER_DIR/#g" -e "s#from \"\\./lib/#from \"$KB_SERVER_DIR/scripts/lib/#g" -e "s#from \"\\./pg-server.ts\"#from \"$KB_SERVER_DIR/scripts/pg-server.ts\"#" \
    -e 's#^const api = `http://localhost:${port}`#const api = process.env.REPLICA_API_URL ?? `http://localhost:${port}`#' "$KB_SERVER_DIR/scripts/replica.ts" > "$KB_E2E_DIR/replica-e2e.ts"
  grep -q 'process.env.REPLICA_API_URL' "$KB_E2E_DIR/replica-e2e.ts" || { echo "scripts/replica.ts no longer has the line this script rewrites" >&2; exit 1; }
  ln -sfn "$KB_SERVER_DIR/node_modules" "$KB_E2E_DIR/node_modules"
  rm -f "$KB_E2E_DIR/replica-state.json" "$KB_E2E_DIR/accounts.json" "$KB_E2E_DIR/proxy.jsonl"
  if ! alive "$KB_E2E_DIR/replica.pid"; then
    ( cd "$KB_SERVER_DIR" && REPLICA_PORT="$API_PORT" REPLICA_API_URL="http://localhost:$WEB_PORT" REPLICA_WEB_ORIGIN="http://localhost:$WEB_PORT" REPLICA_SEED=catalogue \
        REPLICA_STATE="$KB_E2E_DIR/replica-state.json" detach node "$KB_E2E_DIR/replica-e2e.ts" >> "$KB_E2E_DIR/replica.log" 2>&1 < /dev/null & echo $! > "$KB_E2E_DIR/replica.pid" )
  fi
  for _ in $(seq 1 90); do curl -s -o /dev/null "http://localhost:$API_PORT/" && break; sleep 1; done
  curl -s -o /dev/null "http://localhost:$API_PORT/" || { echo "the replica does not answer (see $KB_E2E_DIR/replica.log)" >&2; exit 1; }
  # 2. the recording proxy
  if ! alive "$KB_E2E_DIR/proxy.pid"; then
    ( detach node "$ROOT/scripts/recording-proxy.mjs" --listen "$WEB_PORT" --to "http://127.0.0.1:$API_PORT" --log "$KB_E2E_DIR/proxy.jsonl" >> "$KB_E2E_DIR/proxy.out" 2>&1 < /dev/null & echo $! > "$KB_E2E_DIR/proxy.pid" )
    sleep 1
  fi
  write_env; set +u; source "$ENVF"; set -u
  # 3. accounts, teams, plans, the pending invitation
  node "$ROOT/scripts/e2e-teams-setup.mjs"
  # 4. two sandbox DSH instances pointed at the proxy
  export KYBERNOS_CLOUD_API="http://localhost:$WEB_PORT"
  ( export KB_SANDBOX_PORT="$PORT_A"; bash "$ROOT/scripts/sandbox/setup.sh" >/dev/null && bash "$ROOT/scripts/sandbox/start.sh" )
  ( export KB_SANDBOX_ROOT="$SB_B" KB_SANDBOX_PORT="$PORT_B"; bash "$ROOT/scripts/sandbox/setup.sh" >/dev/null && bash "$ROOT/scripts/sandbox/start.sh" )
  # 5. the device flow, once for each
  DSH_HOME="$SB_A/home/.dsh" node "$ROOT/scripts/e2e-connect.mjs" --dsh "127.0.0.1:$PORT_A" --account a
  DSH_HOME="$SB_B/home/.dsh" node "$ROOT/scripts/e2e-connect.mjs" --dsh "127.0.0.1:$PORT_B" --account b
  echo "up: replica :$API_PORT (control :$CTRL_PORT), proxy :$WEB_PORT, sandboxes :$PORT_A and :$PORT_B; env in $ENVF"
}

run() {
  [ -f "$ENVF" ] || { echo "run 'up' first" >&2; exit 1; }
  set +u; source "$ENVF"; set -u
  export KB_E2E_SHOTS="${KB_E2E_SHOTS:-$KB_E2E_DIR/shots}"
  node "$ROOT/scripts/check-teams-e2e.mjs" "$@"
}

down() {
  for f in proxy replica; do alive "$KB_E2E_DIR/$f.pid" && kill "$(cat "$KB_E2E_DIR/$f.pid")" 2>/dev/null || true; done
  ( bash "$ROOT/scripts/sandbox/stop.sh" ) 2>/dev/null || true
  ( export KB_SANDBOX_ROOT="$SB_B"; bash "$ROOT/scripts/sandbox/stop.sh" ) 2>/dev/null || true
  sleep 2
  for d in "$SB_A" "$SB_B"; do case "$d" in "$HOME/.kybernos-sandbox/"?*) rm -rf "$d" ;; esac; done
  rm -f "$KB_E2E_DIR/replica.pid" "$KB_E2E_DIR/proxy.pid" "$KB_E2E_DIR/env.sh"
  echo "down: processes stopped, sandbox homes removed; the replica's database is gone with its process (accounts.json and the logs stay in $KB_E2E_DIR)"
}

case "${1:-}" in
  up) up ;;
  run) shift; run "$@" ;;
  down) down ;;
  *) echo "usage: e2e-teams-run.sh up | run [j1 ...] | down" >&2; exit 2 ;;
esac
