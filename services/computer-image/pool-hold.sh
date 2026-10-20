#!/bin/sh
# A pooled computer before its claim, as the unprivileged user: DSH is up and warm (so that the claim costs a wake, not a boot), nothing of any person is on the machine, and the
# claimer waits for the platform to hand it an identity. Returns when it has one on the volume.
#
# The DSH command is the one of the gate image's own entrypoint (packages/kybernos-gate/docker/entrypoint.sh), whose keeper loop leaves a DSH that already answers alone: after
# the claim it takes this one over. This DSH is started without the pool token, so that nothing it runs can read it.
set -eu

LIB=/usr/local/lib/kybernos-computer
REPO=/opt/kybernos-plugins
DSH_PORT="${DSH_PORT:-3081}"

# A machine claimed earlier (a stop, a cold start) has its identity on the volume: nothing to wait for.
if node "$LIB/identity.mjs" has; then exit 0; fi
# One that WAS claimed but whose identity is gone (the file lost): it must not sit here polling for a claim the platform will not make again, with the pool token in this process's
# environment next to a person's DSH. It goes on without an identity and fails where it can be seen (the gate does not start).
if node "$LIB/identity.mjs" claimed-before; then
  echo "[pool] this slot was claimed before and its identity is gone from the volume: not waiting for another claim"
  exit 0
fi

# The suite's cloud plugin follows this address (the same one post-claim.sh gives a machine made the old way).
if [ -n "${KYBERNOS_API:-}" ]; then export KYBERNOS_CLOUD_API="${KYBERNOS_API%/}"; fi

WORKSPACE="${KYBERNOS_WORKSPACE:-$HOME/workspace}"
mkdir -p "$WORKSPACE"
node "$REPO/packages/kybernos-gate/docker/seed-workspace.mjs" "$DSH_HOME/storages/workspace.json" "$WORKSPACE"
TRUSTED=""
if [ -n "${KYBERNOS_PUBLIC_HOST:-}" ]; then TRUSTED="--trusted-host $KYBERNOS_PUBLIC_HOST"; fi

(
  while true; do
    if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$DSH_PORT/"; then
      sleep 5
    else
      # shellcheck disable=SC2086
      env -u KYBERNOS_POOL_TOKEN dsh web --no-open --host 127.0.0.1 --port "$DSH_PORT" $TRUSTED || true
      echo "[pool] dsh stopped, restarting in 2 s"
      sleep 2
    fi
  done
) &
KEEPER=$!

rc=0
node "$LIB/claimer.mjs" || rc=$?
# The keeper goes (its DSH stays: the image's keeper takes it over), and a DSH that did not take the token is stopped so that it starts again with the identity in its environment.
kill "$KEEPER" 2>/dev/null || true
if [ "$rc" -eq 3 ]; then
  pkill -f -- "web --no-open --host 127.0.0.1 --port $DSH_PORT" 2>/dev/null || true
  # Until it is really gone (post-claim.sh would take a DSH that is still shutting down for a live one).
  n=0
  while curl -s -o /dev/null --max-time 1 "http://127.0.0.1:$DSH_PORT/" && [ "$n" -lt 20 ]; do n=$((n + 1)); sleep 0.5; done
  rc=0
fi
exit "$rc"
