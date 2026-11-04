#!/usr/bin/env bash
# Case J06-08 of docs/tests/user-journey: the server's own acceptance plan (scripts/acceptance/run.ts of the server repo) against a DISPOSABLE replica started here.
# The replica is the server's own stand-in (embedded Postgres, payments, mailbox, model engine stand-in); no third party is called and nothing of the owner's is read.
# It is started with the switches a full run needs (connections, cloud computers, mail in, social sign-in, phone link, WhatsApp door) and with the owner settings that make the
# Free plan usable: Free has no monthly budget, only a welcome credit, so without one every model call is a 402 « budget used up ».
#
#   KB_SERVER_DIR=<server checkout, built from origin/dev> bash scripts/user-journey-acceptance.sh [--only A,B,matrix] [--keep]
#   KB_ACC_PORT (default 8841; the control port is the next one)  KB_ACC_OUT (default a new folder under $TMPDIR)  KB_ACC_SETTINGS (name=value ..., replaces the default list)
#
# KB_ACC_SEED (default traffic: the catalogue plus the made-up month the failover and health checks read). The replica logs at info: the log checks need its request lines.
# Exit code: the acceptance run's (0 when nothing failed). The report is $KB_ACC_OUT/acceptance.out and the replica's log $KB_ACC_OUT/replica.log (both hold made-up data only).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER="${KB_SERVER_DIR:?KB_SERVER_DIR must point to a kybernos-server checkout}"
PORT="${KB_ACC_PORT:-8841}"
CONTROL=$((PORT + 1))
case "$PORT:$CONTROL" in
  3080:*|*:3080|8791:*|*:8791|8792:*|*:8792) echo "user-journey-acceptance: refusing a port of the real DSH" >&2; exit 2 ;;
esac
[ -f "$SERVER/scripts/replica.ts" ] && [ -f "$SERVER/scripts/acceptance/run.ts" ] || { echo "user-journey-acceptance: $SERVER is not a server checkout with scripts/replica.ts" >&2; exit 2; }

KEEP=0
ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --keep) KEEP=1 ;;
    --only) ONLY="${2:-}"; shift ;;
    *) echo "user-journey-acceptance: unknown option $1" >&2; exit 2 ;;
  esac
  shift
done

OUT="${KB_ACC_OUT:-$(mktemp -d "${TMPDIR:-/tmp}/user-journey-acceptance.XXXXXX")}"
mkdir -p "$OUT"
STATE="$OUT/state.json"
SETTINGS="${KB_ACC_SETTINGS:-welcome_credit_cents=2000 hosted_runs_enabled=1 computers_enabled=1 teamspace_enabled=1 mcp_kaby_enabled=1}"

if curl -fsS "http://127.0.0.1:$CONTROL/__/state" >/dev/null 2>&1; then
  echo "user-journey-acceptance: something already answers on $CONTROL; choose another KB_ACC_PORT" >&2
  exit 2
fi

cleanup () {
  if [ "$KEEP" = 0 ] && [ -n "${PID:-}" ]; then kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; fi
}
trap cleanup EXIT

(
  cd "$SERVER"
  REPLICA_PORT="$PORT" REPLICA_STATE="$STATE" REPLICA_SEED="${KB_ACC_SEED:-traffic}" LOG_LEVEL=info \
  REPLICA_COMPOSIO=1 REPLICA_COMPUTERS=1 REPLICA_INBOUND=1 REPLICA_SOCIAL=1 \
  REMOTE_PHONE_URL=https://phone.replica.example.com \
  WHATSAPP_BRIDGE_TOKEN="journey_$(date +%s)_bridge_token_0123456789" \
  exec node scripts/replica.ts >"$OUT/replica.log" 2>&1
) &
PID=$!

for _ in $(seq 1 90); do
  curl -fsS "http://127.0.0.1:$CONTROL/__/state" >/dev/null 2>&1 && break
  kill -0 "$PID" 2>/dev/null || { echo "user-journey-acceptance: the replica stopped; see $OUT/replica.log" >&2; exit 1; }
  sleep 1
done
curl -fsS "http://127.0.0.1:$CONTROL/__/state" >/dev/null 2>&1 || { echo "user-journey-acceptance: the replica did not answer in 90 s" >&2; exit 1; }
echo "replica up on $PORT (control $CONTROL), evidence in $OUT"

# shellcheck disable=SC2086
node "$HERE/replica-owner-settings.mjs" --api "http://localhost:$PORT" --state "$STATE" $SETTINGS

ARGS=(--api "http://localhost:$PORT" --control "http://127.0.0.1:$CONTROL" --state "$STATE" --log "$OUT/replica.log" --out "$OUT/acceptance.json")
[ -n "$ONLY" ] && ARGS+=(--only "$ONLY")
set +e
(cd "$SERVER" && node scripts/acceptance/run.ts "${ARGS[@]}") >"$OUT/acceptance.out" 2>&1
CODE=$?
set -e
grep -E '^(FAIL|matrix:)|[0-9]+ ok, [0-9]+ fail' "$OUT/acceptance.out" | cut -c1-200 || true
echo "report: $OUT/acceptance.out"
exit "$CODE"
