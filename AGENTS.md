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

Before pushing: `node scripts/garde-depot.mjs && node scripts/test-lifecycle-engine.mjs && node scripts/test-paquet.mjs`.

Testing what a user sees (a page, a translation, a layout) needs the real GUI: `docs/dev/live-testing.md` explains the sign-in (signed session cookie, not the stale token URL) and the helpers (`scripts/live-page.mjs`, `scripts/audit-i18n-live.mjs`).
