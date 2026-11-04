#!/usr/bin/env bash
# A disposable server replica for ONE user-journey case or agent, on its own ports, with every switch a journey needs and no proxy in front.
# It is what scripts/user-journey-acceptance.sh starts, without the acceptance plan: the replica stays up until you stop it.
#
#   KB_SERVER_DIR=<server checkout> bash scripts/user-journey-replica.sh up <port> <out folder>     prints the lines to `eval`; the control port is <port>+1
#   bash scripts/user-journey-replica.sh down <port> <out folder>                                   stops it (the evidence stays in the folder)
#
# `eval "$(... up 8851 ~/x)"` sets KB_E2E_API, KB_E2E_WEB (the same address: nothing sits in front), KB_E2E_CONTROL, KB_E2E_DIR and KB_E2E_STATE, which is what
# scripts/lib-e2e-server.mjs and the check-*/audit-* scripts read. The replica seeds the catalogue and a made-up platform owner; accounts are made by the caller
# (makeServer() of lib-e2e-server.mjs). It refuses the owner's own ports (3080, 8791, 8792) and a port that already answers.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE="${1:-}"; PORT="${2:-}"; OUT="${3:-}"
[ -n "$MODE" ] && [ -n "$PORT" ] && [ -n "$OUT" ] || { echo "usage: user-journey-replica.sh up|down <port> <out folder>" >&2; exit 2; }
CONTROL=$((PORT + 1))
case "$PORT:$CONTROL" in
  3080:*|*:3080|8791:*|*:8791|8792:*|*:8792) echo "user-journey-replica: refusing a port of the real DSH" >&2; exit 2 ;;
esac
mkdir -p "$OUT"; chmod 700 "$OUT"
STATE="$OUT/replica-state.json"
PIDF="$OUT/replica.pid"

if [ "$MODE" = down ]; then
  if [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null; then kill "$(cat "$PIDF")" 2>/dev/null || true; fi
  rm -f "$PIDF"; exit 0
fi
[ "$MODE" = up ] || { echo "usage: user-journey-replica.sh up|down <port> <out folder>" >&2; exit 2; }

SERVER="${KB_SERVER_DIR:?KB_SERVER_DIR must point to a kybernos-server checkout}"
[ -f "$SERVER/scripts/replica.ts" ] || { echo "user-journey-replica: $SERVER is not a server checkout with scripts/replica.ts" >&2; exit 2; }
if curl -fsS "http://127.0.0.1:$CONTROL/__/state" >/dev/null 2>&1; then echo "user-journey-replica: something already answers on $CONTROL; choose another port" >&2; exit 2; fi

# The owner settings that make the Free plan usable and the optional modules answer (same list as scripts/user-journey-acceptance.sh).
SETTINGS="${KB_ACC_SETTINGS:-welcome_credit_cents=2000 hosted_runs_enabled=1 computers_enabled=1 teamspace_enabled=1 mcp_kaby_enabled=1}"
( cd "$SERVER" && REPLICA_PORT="$PORT" REPLICA_STATE="$STATE" REPLICA_SEED="${KB_ACC_SEED:-catalogue}" LOG_LEVEL=info \
    REPLICA_COMPOSIO=1 REPLICA_COMPUTERS=1 REPLICA_INBOUND=1 REPLICA_SOCIAL=1 \
    REMOTE_PHONE_URL=https://phone.replica.example.com \
    WHATSAPP_BRIDGE_TOKEN="journey_$(date +%s)_bridge_token_0123456789" \
    exec perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV' -- node scripts/replica.ts >"$OUT/replica.log" 2>&1 < /dev/null ) &
echo $! > "$PIDF"
for _ in $(seq 1 90); do
  curl -fsS "http://127.0.0.1:$CONTROL/__/state" >/dev/null 2>&1 && break
  kill -0 "$(cat "$PIDF")" 2>/dev/null || { echo "user-journey-replica: the replica stopped; see $OUT/replica.log" >&2; exit 1; }
  sleep 1
done
curl -fsS "http://127.0.0.1:$CONTROL/__/state" >/dev/null 2>&1 || { echo "user-journey-replica: the replica did not answer in 90 s" >&2; exit 1; }
# shellcheck disable=SC2086
node "$HERE/replica-owner-settings.mjs" --api "http://localhost:$PORT" --state "$STATE" $SETTINGS >&2
echo "export KB_E2E_API=http://localhost:$PORT KB_E2E_WEB=http://localhost:$PORT KB_E2E_CONTROL=http://127.0.0.1:$CONTROL KB_E2E_DIR=\"$OUT\" KB_E2E_STATE=\"$STATE\" KB_SERVER_DIR=\"$SERVER\""
