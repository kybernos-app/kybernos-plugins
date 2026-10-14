#!/bin/sh
# A cloud computer's entrypoint. It runs as root for three things: the volume Fly mounts at /data belongs to root, the outbound policy
# is a firewall, and DSH runs as the unprivileged `node` user, never as root (the agent runs model-written code with its permissions).
set -eu

LIB=/usr/local/lib/kybernos-computer
DATA="${KYBERNOS_DATA:-/data}"
mkdir -p "$DATA/dsh" "$DATA/work"
# Once: a volume that big is not walked at every boot.
if [ ! -f "$DATA/.owned" ]; then
  chown -R node:node "$DATA"
  touch "$DATA/.owned"
  chown node:node "$DATA/.owned"
fi

# The profile and the workspace live on the volume. HOME stays the image's: DSH's own caches belong with the image.
export HOME=/home/node
export DSH_HOME="${DSH_HOME:-$DATA/dsh}"
export KYBERNOS_WORKSPACE="${KYBERNOS_WORKSPACE:-$DATA/work}"
export DSH_PORT="${DSH_PORT:-3081}"

# 1. The outbound policy, before anything of the agent runs.
sh "$LIB/egress.sh"

# 2. The profile: seeded from the image's copy on the first boot (as `node`, so that it is node's), then the model route rendered.
runuser -u node -- sh -c '[ -d "$DSH_HOME/profiles/web" ] || { mkdir -p "$DSH_HOME"; cp -a /opt/dsh-seed/. "$DSH_HOME"/; }'
runuser -u node -- sh "$LIB/render-profile.sh"

# The suite's cloud plugin talks to the platform this computer belongs to, as its owner (the token is the computer's own, restricted).
if [ -n "${KYBERNOS_API:-}" ] && [ -n "${KYBERNOS_COMPUTER_TOKEN:-}" ]; then
  export KYBERNOS_CLOUD_API="${KYBERNOS_API%/}"
  runuser -u node -- node "$LIB/link-account.mjs"
fi

# 3. The way into the page is the platform's link: the gate asks the platform, with the computer's own token, whether it is good.
if [ -n "${KYBERNOS_API:-}" ] && [ -n "${KYBERNOS_COMPUTER_TOKEN:-}" ] && [ -z "${KYBERNOS_GATE_TICKET_URL:-}" ]; then
  export KYBERNOS_GATE_TICKET_URL="${KYBERNOS_API%/}/v1/computer/tickets/redeem"
  export KYBERNOS_GATE_TICKET_TOKEN="$KYBERNOS_COMPUTER_TOKEN"
fi

# 4. The reporter: says to the platform that the computer is up, that it is busy, what it runs and which runs ended.
runuser -u node -- node "$LIB/reporter.mjs" &

# 4b. The turn runner: takes the turns the platform addressed to THIS computer (a message the person wrote in a chat on their phone), has DSH answer them with its own tools, and hands
# the answer back. It claims nothing else: the platform pins the token to its own turns (ADR 0053 § 13.4).
runuser -u node -- node "$LIB/runner.mjs" &

# 5. The image's own entrypoint (DSH on loopback, restarted if it stops, then the gate) as `node`.
exec runuser -u node -- sh /opt/kybernos-plugins/packages/kybernos-gate/docker/entrypoint.sh
