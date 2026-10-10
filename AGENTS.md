# Working rules (humans and agents)

Kybernos plugins for DSH. Open core: this repo is Apache-2.0; paid modules live in a private repo.

1. **Zero new engine patches.** Everything goes through plugin seams (`ctx.inject`, slots, `systemPrompt.context`).
   The patches in `scripts/patches.json` are legacy: each PR touching them must say how it gets them closer to removal.
2. **A bundle must never stop DSH from starting.** Guard every client factory with try/catch; declare `remote.*` as narrowly as possible.
3. **Dead-code rider.** Every PR deletes at least as much dead code as it can prove dead (grep, tests), or says why not.
4. **No media or personal paths in git.** No screenshots, videos or fonts; no `/Users/<name>` paths. `node scripts/garde-depot.mjs` enforces it (media = error, paths = warning to burn down).
5. **Compat gate.** DSH range lives in `dsh-compat.json`. A bump is only valid if the lifecycle tests pass and the range is updated in the same PR.
6. **Language.** New code, comments and docs in English. Existing French files are translated when touched.
7. **No secrets.** Never commit `.env`, tokens, tester codes.
8. **A branch does not outlive its merge by more than a day.** After a merge into `dev`: `bash scripts/worktree-clean.sh --base dev` (dry run; `--apply` to do it) removes the worktrees and local branches whose work is in `dev`, after a verified bundle of every ref, and never anything that holds work `dev` does not have. A branch worth keeping becomes a tag (`git tag archive/<name> <branch>`), not a branch.
9. **The shared tree's `dev` has two copies.** `origin` is public, so the integration branch is also pushed to the private `backup` remote after every commit or merge on it (a `post-commit` and `post-merge` hook in `.git/hooks`, not versioned: reinstall them with the same two lines on a new machine). On GitHub, `dev` cannot be deleted or force-pushed (ruleset `protect-dev-light`).

Before pushing: `node scripts/garde-depot.mjs && node scripts/test-lifecycle-engine.mjs && node scripts/test-paquet.mjs`.

Testing what a user sees (a page, a translation, a layout) needs the real GUI: `docs/dev/live-testing.md` explains the sign-in (signed session cookie, not the stale token URL) and the helpers (`scripts/live-page.mjs`, `scripts/audit-i18n-live.mjs`).
