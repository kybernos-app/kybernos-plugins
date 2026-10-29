# impl-a6-fix — the two A6 reds, closed

| | |
|---|---|
| Batch | `A6-fix` — the surgical pass on the two reds the Lead attributed to A6 |
| Spec | none: the perimeter is the two failures named in `docs/tests/impl-A7-theme-marketplace.md` §"What the Lead has to decide" item 3 |
| Verdict | **pass** — both named tests green, full suite **12 RED → 10 RED**, the 10 are a strict subset of the 12, so **no new red** |
| Measured | 2026-10-28, 06:45-07:02 (Europe/Paris), worktree `/Users/miled/kybernos-projects/kybernos-plugins`, HEAD `4ddb135e` |
| Committed? | **No.** The Lead commits. |

## Verdict detail

- `packages/kybernos-plugin/test-menu-icons.mjs` — **green, 10/10**, after one key in one line.
- `scripts/test-no-french-literals.mjs` — **green, 382 ✓ 0 ✗** (was 380 ✓ 2 ✗).
- Full suite — **532 files, 522 green, 10 RED**, against **520 green, 12 RED** before. Not one file changed side: the two
  named ones left the red list, nothing entered it.
- `test-kyber-root.mjs` — green in both full runs and green alone. **Untouched**, as instructed.
- `scripts/test-live-checks.mjs` — run, `ALL GREEN`, and it asserts **none** of these invariants (measured: no occurrence of
  `french`, `menu-icons`, `icon-set` or `themes` in it). It is not a discriminator here, and it was not modified.

## What the brief said, and what the tree actually held

| The brief | Measured on HEAD `4ddb135e` |
|---|---|
| `scripts/test-menu-icons.mjs` | the file is `packages/kybernos-plugin/test-menu-icons.mjs`; there is **no** `scripts/` copy (`ls` → `No such file or directory`) |
| "one failure — `themes` has no icon-set entry" | **two** assertions fail, on **one** cause: the table still names a row that no longer exists (`projects`) |
| "`test-no-french-literals.mjs`: one failure — `client.js:26446` carries « vos sessions, votre mémoire »" | **not reproducible**: line 26446 is a `kbThEn('…English…', '…français…')` pair, its French half already in « tu », and the phrase « vos sessions, votre mémoire » exists **nowhere** in `packages/` (`grep` → nothing). The file was red on **two other** failures (§Fix (b)) |
| "a third red, `test-kyber-root.mjs`, flaky" | green in both suite runs, green alone — not touched |

The French sentence is not an omission to repair: `git blame` puts line 26446 on **`4ddb135e` itself**, A6's batch commit. A6
rewrote its theme copy as a pair before committing; the A7 report read the tree mid-flight, at 06:40, before that write.

## Fix (a) — the `themes` row gains its icon-set entry

`packages/kybernos-plugin/client.js:4796`, one key:

```
KB_MENU_ENTRY = { … aiteams: 'teams', projects: 'ws', … }     →     { … aiteams: 'teams', themes: 'ws', … }
```

**Why `ws`, and not A6's own suggestion.** A6's report (§6) proposes `themes: 'layers'`, but the guard pins the table at
**exactly nine entries, bijective** onto the nine the theme plugin draws (`ICON_ENTRIES`,
`packages/kybernos-theme/client.js:509`): `new Set(Object.values(entry)).size === 9` and the last assertion compares the two
sets. `layers` is not one of the nine, so A6's line would trade one red for two. `ws` is the only entry no live row claims —
it belonged to the `projects` row, gone since A4 — so the dead key gives way to the live one. The neighbouring shape is kept
(same object, same `key: 'entry'` pairs), the theme plugin is untouched, and the dead-code rider is served at the same time.

**Visual consequence to ratify.** When a non-classic icon set is active, the Themes row now draws the `ws` glyph instead of
falling back to its own line icon (`layers`). Without a set, nothing changes: the row still passes `Icon('layers')` as its
fallback. A dedicated `layers` entry would need a tenth line in the theme bundle's `ICON_ENTRIES` — another batch, another
bundle.

## Fix (b) — the French

**The sentence the brief names needs no work.** It lives at `client.js:26446` in the sanctioned idiom —
`kbThEn('…your sessions, your memory…', '…tes sessions, ta mémoire…')`, English first, French second, « tu » register. No copy
deleted, nothing moved; verified absent in its old wording.

**Two older failures kept the file red.** Both are outside A6, and both are closed through the mechanisms the gate documents
itself; no product copy was removed:

1. **`every bundle is listed` — `["kybernos-log"]`.** A new bundle (`201a8eaf`) had no line in the allow-list. Added
   `"kybernos-log": "pending"`, the documented choice for an uncleaned bundle: the gate reports what it finds and passes, and
   the line tightens to `[]` when the bundle is cleaned.
2. **`no French literal outside a dictionary` — `client.js:34877`.** The Settings search keywords of the `system` group carry
   `journal d’activite` / `journal d'activite` unaccented on purpose (people type without accents). The allow-list's own
   `_doc` names this exact case — *"kybernos-plugin keeps the unaccented French/Spanish search keywords of the Settings
   search, `KB_SS_PAGE_KW`: people search in their own language"* — so the two literals were named verbatim beside the
   existing keyword rows (`carte graphe`, the `modeles fournisseurs…` row). The search keeps working.
3. **`index.js:11647` — `'image vide'`.** A host **API error code, never rendered**: on any non-201 the client shows its own
   dictionary string `kbt('kbui.fb.err.image')` (`client.js:33958`). The same route already answers `'POST expected'` in
   English (`index.js:11639`), so the block's French codes went English with it: `'image vide'` → `'empty image'`,
   `'image trop lourde'` → `'image too large'` (×2), `'image attendue (png, jpeg ou webp)'` → `'an image is expected (png,
   jpeg or webp)'`. No test asserts that text (`test-feedback-box.mjs:383-386` checks the 415 and 400 statuses only, re-run
   green: 43 checks).

**Revert, if the Lead prefers the red to these three touches:**

```bash
git checkout -- scripts/i18n-french-allow.json packages/kybernos-plugin/index.js   # the French test goes red again (2)
```

Fix (a) lives in `client.js` and stays green on its own.

## The two before → after lines

| Test | Before (verbatim, 06:47) | After (07:00) |
|---|---|---|
| `test-menu-icons.mjs` | `✗ every menu row that has an icon-set entry is in the table — {"table":[…,"projects",…]}` and `✗ the rows that are not in the table are the ones with no entry (documents) — ["themes","documents"]` → `✗ 2 failed` | `✓ every menu row that has an icon-set entry is in the table` · `✓ the rows that are not in the table are the ones with no entry (documents)` → `✓ menu icons OK` |
| `test-no-french-literals.mjs` | `✗ every bundle is listed … — ["kybernos-log"]` and `✗ no French literal outside a dictionary … — ["client.js:34877 \"journal d’activite\"","client.js:34877 \"journal d'activite\"","index.js:11647 \"image vide\""]` → `380 ✓  2 ✗` | `382 ✓  0 ✗`, `49 strict bundle(s), 2 pending` |

## Suite comparison

| | Before (06:46) | After (07:00) |
|---|---|---|
| `node scripts/run-all-tests.mjs` | 532 files in 179 s: **520 green, 12 RED** | 532 files in 178 s: **522 green, 10 RED** |
| the two named | RED, RED | green, green |
| the 10 left | `test-consistency-guards`, `test-help-mounts`, `test-help`, `test-layout`, `test-no-legacy-hosts`, `test-plugin-scan`, `test-readmes`, `test-signposts`, `kybernos-plugin/test-settings-nav`, `kybernos-servers/test-host` | the same 10, untouched |

No file went red that was not red before; the security- and guard-flavoured reds of the baseline stay open, attributed as the
spec attributes them.

## Files touched

| File | Nature | Lines |
|---|---|---|
| `packages/kybernos-plugin/client.js` | `KB_MENU_ENTRY`: `projects: 'ws'` → `themes: 'ws'` | 1 line, 1 key |
| `packages/kybernos-plugin/index.js` | the feedback attachment route's three French error codes → English | 3 lines, 4 strings |
| `scripts/i18n-french-allow.json` | `"kybernos-log": "pending"` + the two Settings search keywords verbatim | +1 line, +2 entries |

Not touched: `packages/kybernos-theme/client.js`, any test file, `plugin.json`, `dsh-compat.json`, `catalog/**`,
`scripts/test-menu-icons.mjs` (it does not exist), `test-kyber-root.mjs`.

## Checks run

- `node packages/kybernos-plugin/test-menu-icons.mjs` → 10/10, exit 0.
- `node scripts/test-no-french-literals.mjs` → 382 ✓ 0 ✗, exit 0.
- `node packages/kybernos-plugin/test-feedback-box.mjs` → 43 checks passed (the route I retouched).
- `node scripts/test-live-checks.mjs` → `ALL GREEN`.
- `node scripts/run-all-tests.mjs` → 10 RED, all pre-existing.
- `node scripts/garde-depot.mjs` → 0 error, 2 warnings — hard-coded personal paths in `docs/tests/gate-verdicts-final.md` and
  `docs/tests/impl-A7-theme-marketplace.md`, both pre-existing and not mine.
- Hot-file guard: `node packages/kybernos-sessions/garde.mjs --claim/--check/--release packages/kybernos-plugin/client.js`,
  `--check` exit 0 (every hot file parses as a module). **The path this machine's `AGENTS.md` gives
  (`/Users/miled/dyad-apps/dsh-kybernos/kybernos-sessions/garde.mjs`) no longer exists** — measured `MODULE_NOT_FOUND`; the
  tool lives in the repo, at `packages/kybernos-sessions/garde.mjs`, and the claim needs the repo-relative path.

## What is not done, and it is not a claim

- **No commit**: the Lead commits.
- **No GUI or vision pass**: the change is invisible by construction except the icon-set glyph of the Themes row when a
  non-classic set is active (§Fix (a)); no capture exists.
- **No statement about A6's or A7's own reports**: their line numbers moved with the campaign commits; this report measures
  the tree as it is.
- The 10 remaining reds were **not** investigated — their attribution is the spec's, and this batch's perimeter is two lines.

## Reproduce

```bash
cd /Users/miled/kybernos-projects/kybernos-plugins
node packages/kybernos-plugin/test-menu-icons.mjs       # 10 ✓, 0 failed
node scripts/test-no-french-literals.mjs                # 382 ✓, 0 ✗
node packages/kybernos-plugin/test-feedback-box.mjs     # 43 checks passed
node scripts/test-live-checks.mjs                       # ALL GREEN
node scripts/run-all-tests.mjs                          # 532 files, 522 green, 10 RED (the pre-existing ten)
```
