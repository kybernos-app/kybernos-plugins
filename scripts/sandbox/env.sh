# Source me:   source scripts/sandbox/env.sh
# Points HOME / DSH_HOME at the sandbox instance (never at the real ~/.dsh) and exports the
# variables the dev scripts read (KB_HOST for scripts/live-page.mjs, DSH_WEB_PORT for the bundles).
# `kb_sandbox_leave` puts your shell back. Safe to source twice.

if [ -n "${BASH_VERSION:-}" ]; then _kb_sb_src="${BASH_SOURCE[0]}"
elif [ -n "${ZSH_VERSION:-}" ]; then _kb_sb_src="$(eval 'echo ${(%):-%x}')"
else _kb_sb_src="$0"; fi
# shellcheck disable=SC1091
source "$(cd "$(dirname "$_kb_sb_src")" && pwd)/paths.sh"

# The port: KB_SANDBOX_PORT, else the one start.sh settled on (sandbox.port), else 3098.
if [ -z "${KB_SANDBOX_PORT:-}" ]; then
  if [ -r "$KB_SANDBOX_STATE/sandbox.port" ]; then KB_SANDBOX_PORT="$(cat "$KB_SANDBOX_STATE/sandbox.port")"; else KB_SANDBOX_PORT=3098; fi
fi
export KB_SANDBOX_PORT

export KB_SANDBOX_HOME="$KB_SANDBOX_STATE/home"
export HOME="$KB_SANDBOX_HOME"
export DSH_HOME="$KB_SANDBOX_HOME/.dsh"
export DSH_WEB_PORT="$KB_SANDBOX_PORT"
export KB_HOST="127.0.0.1:$KB_SANDBOX_PORT"

kb_sandbox_leave() {
  HOME="$KB_REAL_HOME"; export HOME
  unset DSH_HOME DSH_WEB_PORT KB_HOST KB_SANDBOX_PORT KB_SANDBOX_HOME
  echo "back on the real HOME ($HOME)"
}
