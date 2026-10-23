#!/bin/sh
# A cloud computer's entrypoint. It runs as root for three things: the volume Fly mounts at /data belongs to root, the outbound policy
# is a firewall, and DSH runs as the unprivileged `node` user, never as root (the agent runs model-written code with its permissions).
#
# Two ways to be a computer. Made for one person, a machine is given its identity in its environment (KYBERNOS_COMPUTER_ID / _TOKEN) and goes
# straight to post-claim.sh. Made AHEAD of need (a pool slot), it is given the platform's address and a pool token only: pool-hold.sh boots DSH,
# says that the slot is up, and waits to be claimed (the platform puts it to sleep meanwhile); the identity then lands on the volume and the
# machine goes on to post-claim.sh, which reads it from there. Root never reads the identity: the volume is the agent's to write.
set -eu

LIB=/usr/local/lib/kybernos-computer
DATA="${KYBERNOS_DATA:-/data}"
mkdir -p "$DATA/dsh" "$DATA/work"
# Once: a volume that big is not walked at every boot. The volume is the agent's to write, so root never follows a link it finds there: a `.owned` that is a link (a dangling one would
# make `touch` create, and `chown` hand to `node`, a file anywhere, /etc/ld.so.preload for one) is removed first, and the marker is made without following anything.
if [ -L "$DATA/.owned" ]; then rm -f "$DATA/.owned"; fi
if [ ! -f "$DATA/.owned" ]; then
  chown -R -h node:node "$DATA"
  : > "$DATA/.owned"
  chown -h node:node "$DATA/.owned"
fi

# The profile and the workspace live on the volume. HOME stays the image's: DSH's own caches belong with the image.
export HOME=/home/node
export DSH_HOME="${DSH_HOME:-$DATA/dsh}"
export KYBERNOS_WORKSPACE="${KYBERNOS_WORKSPACE:-$DATA/work}"
export DSH_PORT="${DSH_PORT:-3081}"

# 1. The outbound policy, before anything of the agent runs.
sh "$LIB/egress.sh"

# 2. The profile: seeded from the image's copy on the first boot (as `node`, so that it is node's).
runuser -u node -- sh -c '[ -d "$DSH_HOME/profiles/web" ] || { mkdir -p "$DSH_HOME"; cp -a /opt/dsh-seed/. "$DSH_HOME"/; }'

# 3. A pool slot with no identity yet waits here, with DSH already up, until it is claimed (or returns at once when a claim is already on the volume). The slot's id is not secret:
#    it is what lets the plugin honour the identity on the volume (computer-identity.mjs), so it stays in the environment of everything that runs.
if [ -z "${KYBERNOS_COMPUTER_TOKEN:-}" ] && [ -n "${KYBERNOS_POOL_TOKEN:-}" ] && [ -n "${KYBERNOS_POOL_SLOT:-}" ]; then
  runuser -u node -- sh "$LIB/pool-hold.sh"
fi

# 4. Everything that needs the identity. The pool token goes no further: nothing the agent runs can read it.
exec env -u KYBERNOS_POOL_TOKEN runuser -u node -- sh "$LIB/post-claim.sh"
