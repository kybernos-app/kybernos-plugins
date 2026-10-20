#!/bin/sh
# What a cloud computer does once it is somebody's, as the unprivileged user: the model route, the account link, the platform's door for the person, the reporter and the
# runner, then the image's own entrypoint (DSH on loopback, restarted if it stops, then the gate). Run by entrypoint.sh for a machine made the old way and for a pool slot
# that was claimed. Idempotent: a restart, a cold start and a wake run it again.
set -eu

LIB=/usr/local/lib/kybernos-computer
# A claimed pool slot has its identity on the volume, not in its environment: give this shell what the environment lacks (a machine made the old way gets nothing).
eval "$(node "$LIB/identity.mjs" env)"

# The model route of the computer, from the environment: the block between two markers is replaced at every start (a hot reload when DSH is already up).
sh "$LIB/render-profile.sh"

# The suite's cloud plugin talks to the platform this computer belongs to, as its owner (the token is the computer's own, restricted).
if [ -n "${KYBERNOS_API:-}" ] && [ -n "${KYBERNOS_COMPUTER_TOKEN:-}" ]; then
  export KYBERNOS_CLOUD_API="${KYBERNOS_API%/}"
  node "$LIB/link-account.mjs"
fi

# The way into the page is the platform's link: the gate asks the platform, with the computer's own token, whether it is good.
if [ -n "${KYBERNOS_API:-}" ] && [ -n "${KYBERNOS_COMPUTER_TOKEN:-}" ] && [ -z "${KYBERNOS_GATE_TICKET_URL:-}" ]; then
  export KYBERNOS_GATE_TICKET_URL="${KYBERNOS_API%/}/v1/computer/tickets/redeem"
  export KYBERNOS_GATE_TICKET_TOKEN="$KYBERNOS_COMPUTER_TOKEN"
fi

# A claimed pool slot's DSH is already up: the route rendered above reaches it by a hot reload (about two seconds). Nothing says « ready » and no turn is taken before it is live
# (a turn would find no model to call); a route that never comes up is a DSH that is restarted, and it then reads the identity at its start.
if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:${DSH_PORT:-3081}/"; then
  node "$LIB/claimer.mjs" route || {
    echo "[computer] the model route did not come up by hot reload: restarting DSH"
    pkill -f -- "web --no-open --host 127.0.0.1 --port ${DSH_PORT:-3081}" 2>/dev/null || true
  }
fi

# The reporter: says to the platform that the computer is up, that it is busy, what it runs and which runs ended.
node "$LIB/reporter.mjs" &

# The turn runner: takes the turns the platform addressed to THIS computer (a message the person wrote in a chat on their phone), has DSH answer them with its own tools, and hands
# the answer back. It claims nothing else: the platform pins the token to its own turns (ADR 0053 § 13.4).
node "$LIB/runner.mjs" &

# The image's own entrypoint: DSH on loopback (left alone when a pooled slot already runs one), restarted if it stops, then the gate.
exec sh /opt/kybernos-plugins/packages/kybernos-gate/docker/entrypoint.sh
