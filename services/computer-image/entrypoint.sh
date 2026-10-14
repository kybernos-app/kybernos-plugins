#!/bin/sh
# A cloud computer's entrypoint. It runs as root for one thing: the volume Fly mounts at /data belongs to root and DSH runs as the
# unprivileged `node` user, never as root (the agent runs model-written code with the permissions of its user).
set -eu

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

# The image's own entrypoint (DSH on loopback, restarted if it stops, then the gate) as `node`.
exec runuser -u node -- sh /opt/kybernos-plugins/packages/kybernos-gate/docker/entrypoint.sh
