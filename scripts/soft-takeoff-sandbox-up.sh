#!/usr/bin/env bash
# Makes sure the recette sandboxes answer. The leftovers sweeper (scripts/restes-de-tests.mjs) stops a sandbox that has no client and no log activity for ten minutes,
# and anything else can stop one too: this starts it again on the same profile (frozen, connected, state kept). It is the `--before` command of the runner and the
# watcher loop beside a walkthrough tester.
#
#   bash scripts/soft-takeoff-sandbox-up.sh [--keep SECONDS] [--dry-run] <sandbox root>:<port> [<sandbox root>:<port> ...]
#
#   --keep N    check again every 15 seconds for N seconds (a watcher), instead of once
#   --dry-run   say what would be done and start nothing
#
# A pair is « folder:port »: the folder is inside ~/.kybernos-sandbox, the port is the sandbox's own (A 3098, B 3110, C 3120). Exit 0 when every sandbox answers (401: the
# DSH is up and wants its cookie), 2 on a refusal, 3 when one did not come back. Refuses the owner's own ports (3080, 8791, 8792) and any folder outside ~/.kybernos-sandbox.
# It never runs `sandbox/setup.sh` (that clones the profile again and loses the sandbox's state) and never the replica harness's `up` or `down`.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REAL_HOME="${KB_REAL_HOME:-$HOME}"   # a shell that sourced the sandbox env has HOME on the sandbox: the folders live under the real one
KEEP=0; DRY=0; PAIRS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --keep) KEEP="${2:-}"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    --*) echo "unknown option $1" >&2; exit 2 ;;
    *) PAIRS+=("$1"); shift ;;
  esac
done
case "$KEEP" in ''|*[!0-9]*) echo "--keep takes a number of seconds" >&2; exit 2 ;; esac
[ "${#PAIRS[@]}" -gt 0 ] || { echo "usage: soft-takeoff-sandbox-up.sh [--keep SECONDS] [--dry-run] <sandbox root>:<port> ..." >&2; exit 2; }
for pair in "${PAIRS[@]}"; do
  root="${pair%:*}"; port="${pair##*:}"
  case "$port" in ''|*[!0-9]*) echo "bad pair « $pair »: the port after the colon is not a number" >&2; exit 2 ;; esac
  case "$port" in 3080|8791|8792) echo "refusing port $port: it belongs to the owner's own DSH / replica" >&2; exit 2 ;; esac
  case "$root" in "$REAL_HOME/.kybernos-sandbox/"?*) ;; *) echo "refusing « $root »: not a folder inside $REAL_HOME/.kybernos-sandbox" >&2; exit 2 ;; esac
  case "$root" in *"/../"*|*"/..") echo "refusing « $root »: a .. in the path" >&2; exit 2 ;; esac
  case "$root" in *" "*) echo "refusing « $root »: a space in the folder name" >&2; exit 2 ;; esac
done

code() { curl -s -o /dev/null -m 3 -w '%{http_code}' "http://127.0.0.1:$1/" 2>/dev/null; }
one() {
  local root="$1" port="$2"
  [ "$(code "$port")" = "401" ] && return 0
  if [ "$DRY" = "1" ]; then echo "would restart $root on :$port"; return 0; fi
  (
    export KYBERNOS_CLOUD_API="${KYBERNOS_CLOUD_API:-http://localhost:8820}" KB_SANDBOX_TTL="${KB_SANDBOX_TTL:-14400}" KB_SANDBOX_ROOT="$root" KB_SANDBOX_PORT="$port"
    bash "$HERE/sandbox/stop.sh" >/dev/null 2>&1
    bash "$HERE/sandbox/start.sh" >/dev/null 2>&1
  )
  sleep 2
  [ "$(code "$port")" = "401" ] || { echo "soft-takeoff-sandbox-up: :$port did not come back" >&2; return 3; }
  echo "soft-takeoff-sandbox-up: restarted :$port" >&2
}
sweep() { local bad=0; for pair in "${PAIRS[@]}"; do one "${pair%:*}" "${pair##*:}" || bad=3; done; return $bad; }

if [ "$KEEP" = "0" ]; then sweep; exit $?; fi
end=$(( $(date +%s) + KEEP ))
while [ "$(date +%s)" -lt "$end" ]; do sweep >/dev/null; left=$(( end - $(date +%s) )); [ "$left" -gt 0 ] && sleep $(( left < 15 ? left : 15 )); done
sweep
