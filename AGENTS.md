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
10. **Answer short, summarise the output.** What the maintainer reads after a task is a few lines: the result first, what was checked (and what was skipped), and the one decision or action that is theirs. Command output, test logs and long reports are summarised, never pasted or recapped step by step; the detail lives in the commit message, the docs or memory, and is given on request. A maintainer who has to ask twice for this was not listened to the first time.

Before pushing: `node scripts/garde-depot.mjs && node scripts/test-lifecycle-engine.mjs && node scripts/test-paquet.mjs`.

**Before a merge into `dev`: `node scripts/run-all-tests.mjs`** (every test file CI runs, four at a time, under two minutes; `--only <text>` for a subset while you work, never as the final word). It must end with 0 red. CI only runs on a push to `main` or a pull request, and `dev` is merged here, so without this the suite never ran before a merge and four files sat red for a day (2026-10-23). There is no « known red »: a red file you did not break is still red on your merge, so it is fixed in the same session or ticketed that day, and the merge message says which.

Testing what a user sees (a page, a translation, a layout) needs the real GUI: `docs/dev/live-testing.md` explains the sign-in (signed session cookie, not the stale token URL) and the helpers (`scripts/live-page.mjs`, `scripts/audit-i18n-live.mjs`).
