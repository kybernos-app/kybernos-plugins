#!/bin/sh
# Container entrypoint: DSH on loopback (restarted if it stops), then the gate as the main process.
set -eu

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
DSH_PORT="${DSH_PORT:-3081}"
# The repository this script lives in (<repo>/packages/kybernos-gate/docker): works wherever the image put it, so an
# older image (repo in the home folder) and a new one (repo in /opt) run the same script.
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"

# A volume mounted over ~/.dsh starts empty: seed it with the profile installed at build time.
if [ ! -d "$DSH_HOME/profiles/web" ]; then
  echo "[entrypoint] empty $DSH_HOME: seeding it from the installed profile"
  mkdir -p "$DSH_HOME"
  cp -a /opt/dsh-seed/. "$DSH_HOME"/
fi

# One folder for the agent to work in, offered as the first workspace so the first screen is the chat and not a
# folder picker. Only done while DSH has no workspace yet (a no-op afterwards, and on a volume with workspaces).
WORKSPACE="${KYBERNOS_WORKSPACE:-$HOME/workspace}"
mkdir -p "$WORKSPACE"
node "$REPO/packages/kybernos-gate/docker/seed-workspace.mjs" "$DSH_HOME/storages/workspace.json" "$WORKSPACE"

# The public host name lets DSH's own fence and the Kybernos route guards accept the proxy's address.
TRUSTED=""
if [ -n "${KYBERNOS_PUBLIC_HOST:-}" ]; then TRUSTED="--trusted-host $KYBERNOS_PUBLIC_HOST"; fi

# Keep DSH up. If something already answers on its port (for example an approved restart started a new one by
# itself), leave it alone instead of fighting over the port.
(
  while true; do
    if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$DSH_PORT/"; then
      sleep 5
    else
      # shellcheck disable=SC2086
      dsh web --no-open --host 127.0.0.1 --port "$DSH_PORT" $TRUSTED || true
      echo "[entrypoint] dsh stopped, restarting in 2 s"
      sleep 2
    fi
  done
) &

# The gate refuses to start without a password: the container then stops with its message.
exec node "$REPO/packages/kybernos-gate/bin/kybernos-gate.mjs"
