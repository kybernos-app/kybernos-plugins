#!/usr/bin/env bash
# Builds / refreshes the isolated sandbox HOME from the real DSH profile, pointing every
# @local package at the WORKTREE. Idempotent: run it again after the worktree gains a package.
#   ./setup.sh              re-apply the rewrites (profile is cloned only when missing)
#   ./setup.sh --refresh    re-clone the profile from the real one (sandbox must be stopped)
# It only READS the real ~/.dsh (clone + copy) and never copies credentials.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/env.sh"   # sets KB_REAL_HOME, KB_WORKTREE, HOME/DSH_HOME of the sandbox

REAL_DSH="$KB_REAL_HOME/.dsh"
SB_DSH="$DSH_HOME"
SB_PROFILE="$SB_DSH/profiles/web"
REFRESH=0; [ "${1:-}" = "--refresh" ] && REFRESH=1

die() { echo "sandbox-setup: $*" >&2; exit 1; }

[ "$HOME" != "$KB_REAL_HOME" ] || die "HOME is the real home; refusing"
[ "$SB_DSH" != "$REAL_DSH" ] || die "DSH_HOME is the real ~/.dsh; refusing"
[ -d "$REAL_DSH/profiles/web" ] || die "no real profile at $REAL_DSH/profiles/web"
[ -d "$KB_WORKTREE/packages" ] || die "no packages/ in worktree $KB_WORKTREE"

if [ -f "$KB_SANDBOX_STATE/sandbox.pid" ] && kill -0 "$(cat "$KB_SANDBOX_STATE/sandbox.pid")" 2>/dev/null; then
  [ "$REFRESH" -eq 0 ] || die "sandbox is running (pid $(cat "$KB_SANDBOX_STATE/sandbox.pid")): scripts/sandbox/stop.sh first"
  echo "note: sandbox is running; links are re-applied in place, restart it to pick up host changes"
fi

mkdir -p "$SB_DSH/profiles" "$SB_DSH/kybernos"

# 1. Profile = APFS clone of the real one (copy-on-write: instant, no extra disk, real files untouched).
if [ "$REFRESH" -eq 1 ] && [ -d "$SB_PROFILE" ]; then rm -rf "$SB_PROFILE"; fi
if [ ! -d "$SB_PROFILE" ]; then
  echo "cloning profile web (APFS clone)..."
  cp -cR "$REAL_DSH/profiles/web" "$SB_PROFILE"
  # Backups of the real profile are noise here; the plugin-manager leftovers are temp operation dirs.
  find "$SB_PROFILE" -maxdepth 1 -name '*.bak*' -exec rm -rf {} +
  rm -rf "$SB_PROFILE/.plugin-manager"
fi

# 2. The MCP servers folder the cloned cordis.patch.yml points at (paths rewritten below).
if [ "$REFRESH" -eq 1 ] && [ -d "$SB_DSH/mcp" ]; then rm -rf "$SB_DSH/mcp"; fi
if [ ! -d "$SB_DSH/mcp" ]; then cp -cR "$REAL_DSH/mcp" "$SB_DSH/mcp"; fi

# 3. Re-point everything at the worktree.
node "$HERE/rewrite.mjs" "$SB_PROFILE" "$KB_WORKTREE" "$SB_DSH" "$KB_REAL_HOME"

# 4. Skip the onboarding wizard. The host (kybernos-plugin/index.js, /kybernos/onboarding) only treats it
#    as done when `completed` is true AND `version` is 1: `{"completed":true}` alone still shows the wizard.
printf '{"version":1,"completed":true,"installedAt":"2026-01-01T00:00:00.000Z","completedAt":"2026-01-01T00:00:00.000Z","profil":"produit","uiMode":null}\n' > "$SB_DSH/kybernos/onboarding.json"

# 5. Checks: nothing may still point at the shared tree; every @local link must land in the worktree
#    (except the paid kybernos-servers module, which has no copy in the worktree).
bad=0
if grep -rIl "$KB_REAL_HOME/kybernos-plugins/packages" "$SB_PROFILE/package.json" "$SB_PROFILE/pnpm-lock.yaml" "$SB_PROFILE/node_modules/.pnpm/lock.yaml" 2>/dev/null; then
  echo "FAIL: shared-tree links remain (above)"; bad=1
fi
for l in "$SB_PROFILE"/node_modules/@local/*; do
  t="$(readlink "$l")"
  case "$t" in
    "$KB_WORKTREE"/packages/*) ;;
    *kybernos-servers) echo "note: $(basename "$l") -> $t (paid module, not in the worktree)" ;;
    *) echo "FAIL: $(basename "$l") -> $t"; bad=1 ;;
  esac
  [ -d "$l" ] || { echo "FAIL: dangling link $(basename "$l")"; bad=1; }
done
grep -q 'kybernos-relance' <(node -e 'const p=require(process.argv[1]);console.log(p.dsh.profile.bundles.join("\n"))' "$SB_PROFILE/package.json") && { echo "FAIL: kybernos-relance still in bundles"; bad=1; }
if grep -q "$REAL_DSH/mcp" "$SB_PROFILE/cordis.patch.yml"; then echo "FAIL: real mcp path left in cordis.patch.yml"; bad=1; fi
[ "$bad" -eq 0 ] || die "checks failed"
echo "sandbox ready: HOME=$HOME  worktree=$KB_WORKTREE  (port $KB_SANDBOX_PORT unless start.sh finds it busy)"
