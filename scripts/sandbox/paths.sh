# Where the sandbox lives. Sourced by env.sh, start.sh and stop.sh; it changes no HOME and freezes no port.
# Sets: KB_SANDBOX_DIR (this folder), KB_REAL_HOME, KB_WORKTREE (the checkout whose packages/* are served),
# KB_SANDBOX_STATE (HOME, pid, port, log of the sandbox).
if [ -n "${BASH_VERSION:-}" ]; then _kb_sb_src="${BASH_SOURCE[0]}"
elif [ -n "${ZSH_VERSION:-}" ]; then _kb_sb_src="$(eval 'echo ${(%):-%x}')"
else _kb_sb_src="$0"; fi
KB_SANDBOX_DIR="$(cd "$(dirname "$_kb_sb_src")" && pwd)"
export KB_SANDBOX_DIR

# The real home is remembered the first time only (scripts and shells that already sourced this keep it).
[ -n "${KB_REAL_HOME:-}" ] || export KB_REAL_HOME="$HOME"

# The worktree whose packages/* the sandbox serves: this checkout (override with KB_WORKTREE before sourcing).
export KB_WORKTREE="${KB_WORKTREE:-$(cd "$KB_SANDBOX_DIR/../.." && pwd)}"

# Where the sandbox keeps its state (HOME, pid, port, log), outside the repo and with a SHORT path (a unix
# socket path is limited to about 100 characters): ~/.kybernos-sandbox/<worktree name>, or KB_SANDBOX_ROOT.
export KB_SANDBOX_STATE="${KB_SANDBOX_ROOT:-$KB_REAL_HOME/.kybernos-sandbox/$(basename "$KB_WORKTREE")}"
mkdir -p "$KB_SANDBOX_STATE"

