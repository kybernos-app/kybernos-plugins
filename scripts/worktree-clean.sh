#!/usr/bin/env bash
# Retires the worktrees and the local branches that hold nothing the base branch does not hold already. Dry run unless --apply.
#
#   bash scripts/worktree-clean.sh                 what would go, and what stays and why
#   bash scripts/worktree-clean.sh --apply         does it (after a bundle of every ref: ~/kybernos-archive/<repo>-refs-<date>.bundle)
#   bash scripts/worktree-clean.sh --base dev      the branch the proof is made against (default: origin's default branch; in this repository the
#                                                  integration branch is the local `dev`, so say `--base dev`)
#
# The rule is « no code lost »: a worktree goes only if its HEAD is an ancestor of the base, nothing tracked is modified, the only untracked things are caches, and no process has it as its
# working directory. A local branch goes only if its tip is an ancestor of the base and no worktree has it checked out. Nothing is ever forced (`git worktree remove`, never `--force`), and
# nothing is deleted on GitHub: a merged branch is deleted there by the repository's own setting (« automatically delete head branches »), an unmerged one is kept as a tag by a person (AGENTS.md).
set -uo pipefail

apply=0
base=""
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) apply=1 ;;
    --base) shift; base="${1:-}" ;;
    *) printf 'usage: %s [--apply] [--base <ref>]\n' "$0" >&2; exit 2 ;;
  esac
  shift
done

cd "$(git rev-parse --show-toplevel)"
main_wt="$(git worktree list --porcelain | awk '/^worktree /{print substr($0,10); exit}')"
git fetch -q origin 2>/dev/null || printf 'warning: could not fetch origin; the proof is made against what is already here\n' >&2
if [ -z "$base" ]; then
  base="$(git symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null || true)"
  [ -n "$base" ] || base="dev"
fi
git rev-parse --verify -q "$base" >/dev/null || { printf 'base %s not found\n' "$base" >&2; exit 2; }
here="$(pwd -P)"

printf 'base: %s (%s)\n' "$base" "$(git rev-parse --short "$base")"
removable=()
branches=()

printf '\nworktrees:\n'
while IFS=$'\t' read -r wt br; do
  [ -n "$wt" ] || continue
  [ "$wt" = "$main_wt" ] && continue
  name="$(basename "$wt")"
  if [ ! -d "$wt" ]; then printf '  keep   %-34s missing on disk (run: git worktree prune)\n' "$name"; continue; fi
  if [ "$(cd "$wt" && pwd -P)" = "$here" ]; then printf '  keep   %-34s this is the worktree you are in\n' "$name"; continue; fi
  tip="$(git -C "$wt" rev-parse HEAD)"
  if ! git merge-base --is-ancestor "$tip" "$base"; then
    printf '  keep   %-34s %s commit(s) not in %s\n' "$name" "$(git rev-list --count "$base..$tip")" "$base"; continue
  fi
  status="$(git -C "$wt" status --porcelain)"
  if [ -n "$(printf '%s\n' "$status" | grep -v '^??' | grep . || true)" ]; then
    printf '  keep   %-34s tracked files are modified\n' "$name"; continue
  fi
  other="$(printf '%s\n' "$status" | grep '^??' | sed 's/^?? //' | grep -vE '^(\.vitest/|node_modules/|dist/|coverage/|\.railway/)$' || true)"
  if [ -n "$other" ]; then printf '  keep   %-34s untracked files: %s\n' "$name" "$(echo "$other" | head -3 | tr '\n' ' ')"; continue; fi
  if lsof -a -d cwd 2>/dev/null | grep -q " $wt"; then printf '  keep   %-34s a process is working in it\n' "$name"; continue; fi
  printf '  REMOVE %-34s (%s) everything is in %s\n' "$name" "${br#refs/heads/}" "$base"
  removable+=("$wt")
done < <(git worktree list --porcelain | awk -v RS= -F'\n' '{w="";b="";for(i=1;i<=NF;i++){if($i~/^worktree /)w=substr($i,10);if($i~/^branch /)b=substr($i,8)} print w"\t"b}')

# Branches checked out in a worktree that stays are not touched; the ones of the worktrees to remove are free once those are gone.
checked_out() { git worktree list --porcelain | awk '/^branch /{print substr($0,19)}' | grep -qx "$1"; }
printf '\nlocal branches:\n'
for b in $(git for-each-ref --format='%(refname:short)' refs/heads); do
  default="${base#origin/}"
  [ "$b" = "$default" ] && continue
  tip="$(git rev-parse "$b")"
  if ! git merge-base --is-ancestor "$tip" "$base"; then
    printf '  keep   %-44s %s commit(s) not in %s\n' "$b" "$(git rev-list --count "$base..$tip")" "$base"; continue
  fi
  if checked_out "$b"; then
    wt_of="$(git worktree list --porcelain | awk -v b="refs/heads/$b" '/^worktree /{w=substr($0,10)} /^branch /{if(substr($0,8)==b)print w}')"
    free=0; for r in "${removable[@]:-}"; do [ "$r" = "$wt_of" ] && free=1; done
    if [ "$free" = 0 ]; then printf '  keep   %-44s checked out in a worktree that stays\n' "$b"; continue; fi
  fi
  printf '  DELETE %-44s tip is in %s\n' "$b" "$base"
  branches+=("$b")
done

printf '\n%d worktree(s) and %d branch(es) can go.\n' "${#removable[@]}" "${#branches[@]}"
[ "$apply" = 1 ] || { printf 'Dry run: nothing was changed. Run again with --apply.\n'; exit 0; }
[ "$(( ${#removable[@]} + ${#branches[@]} ))" -gt 0 ] || exit 0

mkdir -p "$HOME/kybernos-archive"
bundle="$HOME/kybernos-archive/$(basename "$main_wt")-refs-$(date +%F-%H%M).bundle"
git bundle create "$bundle" --all >/dev/null 2>&1 && git bundle verify "$bundle" >/dev/null 2>&1 || { printf 'could not make a verified bundle of every ref: nothing was removed\n' >&2; exit 1; }
printf 'every ref saved in %s\n' "$bundle"
for wt in "${removable[@]:-}"; do
  [ -n "$wt" ] || continue
  rm -rf "$wt/.vitest"
  git worktree remove "$wt" 2>&1 | tail -1
done
for b in "${branches[@]:-}"; do
  [ -n "$b" ] || continue
  git branch -D "$b" >/dev/null 2>&1 && printf 'deleted %s\n' "$b"
done
git worktree prune
printf 'done.\n'
