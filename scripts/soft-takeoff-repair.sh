#!/usr/bin/env bash
# Pairs the two recette sandboxes with their replica accounts again, restarts them, pins the model and runs the harness preflight. The replica's session of an account lasts about
# two hours, and a DSH keeps saying « connected » after its GUI asks « Sign in again »: when a replica case says « no agent request got a 200 », or a chat says « not signed in
# to it any more », run this once (about two minutes). It does NOT run the harness's `up` or `down` (they clone the sandboxes again / delete their homes).
#
#   source "$KB_E2E_DIR/env.sh" && bash scripts/soft-takeoff-repair.sh <A sandbox root>:<A port> <B sandbox root>:<B port>
#
# Both roots must be inside ~/.kybernos-sandbox (soft-takeoff-sandbox-up.sh refuses anything else). Exit 0 when the preflight is green for A and B.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ $# -eq 2 ] || { echo "usage: soft-takeoff-repair.sh <A root>:<A port> <B root>:<B port>   (with KB_E2E_DIR/env.sh sourced)" >&2; exit 2; }
[ -n "${KB_E2E_HOME_A:-}" ] && [ -n "${KB_E2E_HOME_B:-}" ] || { echo "source \"\$KB_E2E_DIR/env.sh\" first" >&2; exit 2; }
account=a
for pair in "$1" "$2"; do
  root="${pair%:*}"; port="${pair##*:}"
  bash "$HERE/soft-takeoff-sandbox-up.sh" --dry-run "$pair" >/dev/null || exit 2   # the refusals of the keeper apply here too
  ( export KB_SANDBOX_ROOT="$root" KB_SANDBOX_PORT="$port" KYBERNOS_CLOUD_API="${KYBERNOS_CLOUD_API:-${KB_E2E_WEB:-http://localhost:8820}}" KB_SANDBOX_TTL=14400
    # shellcheck disable=SC1091
    source "$HERE/sandbox/env.sh"
    # a pairing started right after a restart can be refused once (« Unknown or expired request »): try up to three times
    for try in 1 2 3; do
      out="$(node "$HERE/e2e-connect.mjs" --dsh "127.0.0.1:$port" --account "$account" --force 2>&1 | tail -1)"
      case "$out" in connected:*) break ;; esac
      sleep 3
    done
    echo "$out"
    bash "$HERE/sandbox/stop.sh" >/dev/null 2>&1; bash "$HERE/sandbox/start.sh" >/dev/null 2>&1 )
  account=b
done
for home in "$KB_E2E_HOME_A" "$KB_E2E_HOME_B"; do node "$HERE/pin-model.mjs" --home "$home" "${KB_E2E_MODEL_PROVIDER:-kybernos}" "${KB_E2E_MODEL:-glm}" | tail -1; node "$HERE/pin-model.mjs" --home "$home" --preset "${KB_E2E_PRESET:-standard}" | tail -1; done
sleep 6
bash "$HERE/e2e-teams-run.sh" preflight 2>&1 | tail -3
