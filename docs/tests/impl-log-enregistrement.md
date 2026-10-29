# impl-log-enregistrement — the unregistered `kybernos-log` bundle, registered

| | |
|---|---|
| Batch | D8, ground 4 — register the `@local/kybernos-log` bundle the way its siblings are registered |
| Spec | `docs/tests/revue-adversariale.md` §"The suite at HEAD" and F-6 (six of the ten reds are this bundle) |
| Verdict | **pass** — the six log reds are green, `run-all-tests.mjs` goes **10 RED → 4 RED**, the four left are the pre-existing / cloud ones this batch does not own, and **no new red** entered the list |
| Measured | 2026-10-28, 08:04–08:25 (Europe/Paris), worktree `/Users/miled/kybernos-projects/kybernos-plugins`, HEAD `a0b2cb5c` |
| Committed? | **No.** The Lead commits. |

## Verdict detail

The six failing lines were captured **before** any edit, on HEAD `a0b2cb5c`:

```
test-layout.mjs        ✗ every DSH bundle is declared to the robot with a name — kybernos-log
                       ✗ every DSH bundle is in satellites.json — kybernos-log
test-readmes.mjs       ✗ each one is linked from README.md … — ["kybernos-log"]
test-help-mounts.mjs   ✗ kybernos-log: help.json is shipped, client.js never mounts __KB_HELP__.Help
test-settings-nav.mjs  ✗ every registered settings page has a key in KB_NAV_KEYS … — ["kybernos-log"]
test-consistency-guards  AssertionError: ["kybernos-log 1 (allowed 0)"]
```

After the registration (measured, alone):

| Guard | Before | After |
|---|---|---|
| `scripts/test-layout.mjs` | 21 checks, **2 failures** | 21 checks, **0 failure** |
| `scripts/test-readmes.mjs` | 4 ✓ **1 ✗** | 5 ✓ **0 ✗** |
| `scripts/test-help-mounts.mjs` | 1 offender (`kybernos-log`) | OK — 35 bundles mount gated, 7 exempt, 7 data-only |
| `packages/kybernos-plugin/test-settings-nav.mjs` | 44 verifications, **1 failure** | 45 verifications, **0 failure** |
| `scripts/test-consistency-guards.mjs` | assertion (A1-16) | **12 tests passed** |

Full suite: **532 files, 528 green, 4 RED** (`scripts/run-all-tests.mjs`, 134 s). The four left are named in the
comparison below; none of them is the log, and none was red before because of this batch.

## What was registered, and in what shape

Each entry copies the shape of `kybernos-pulse` / `kybernos-maintenance`, the two smallest siblings.

| File | Change |
|---|---|
| `scripts/lifecycle-packages.json` | `{ "dir": "kybernos-log", "nom": "@local/kybernos-log" }`, after `kybernos-pulse` |
| `docs/beta/satellites.json` | satellite entry (`tier 2`, `obligatoire: false`, `defaut: "actif"`, role, `poids_ko: 80`, `lib_vendor: null`) + `@local/kybernos-log` in `ordre_montage.satellites` |
| `README.md` | one Bundles-table row, after `kybernos-pulse` |
| `packages/kybernos-plugin/client.js` | `'kybernos-log': 'activity log'` in `KB_NAV_KEYS`; an `'activity log'` drawing in `ICONES`; two `KB_SS_INDEX` rows (Families, Live tail) + their `KB_SS_FR` twins + one `KB_SS_PAGE_KW` line (Settings search) |
| `packages/kybernos-log/client.js` | the help pill: gated `window.__KB_HELP__.Help`, `{ id: 'kybernos-log' }`, beside the page title |
| `packages/kybernos-hub/client.js` | a `list` glyph (the bundle's declared `icon`) — the hub had none |
| `packages/kybernos-hub/catalog.json` | rebuilt: **49 modules** (`node scripts/build-catalog.mjs`) |
| `scripts/test-consistency-guards.mjs` | `'kybernos-log': 1` in `SHOUTING_ALLOWED` (A1-16) |
| `scripts/test-signposts.mjs` | `'activity log': ['journal d’activité']` in `PLACES` |
| `scripts/test-settings-names.mjs` | `'kybernos-log': 'Activity log'` in `NAV` |
| `packages/kybernos-log/help.json` | `what.fr` shortened **210 → 172** characters (the catalogue's limit is 200) |

## Decisions (and why)

- **Help mount: mounted, not dropped.** `kybernos-log` owns a Settings page and ships a complete `help.json`
  (what / 3 steps / where / good); it is exactly the case rule 1 of `test-help-mounts` exists for, so the pill
  is mounted the way `kybernos-pulse` mounts it — same gated expression, `id` = the bundle folder. Dropping
  `help.json` was never on the table: it would have deleted written help to satisfy a test.
- **A1-16: the allowance, not a CSS rewrite.** The one `text-transform: uppercase` is `.kblg-table th`, a
  column-header row; it joins the table's design exceptions rather than changing the shipped look. The guard
  asks for a deliberate choice visible in the diff either way; this one is the smaller diff.
- **`defaut: "actif"` in `satellites.json`** because the bundle's own `plugin.json` declares
  `"suite": { "default": "on" }`; the manifest check (`test-layout` §8) requires the two to agree.
- **`poids_ko: 80`** — `du -sk packages/kybernos-log` (the folder ships no `node_modules`).

## Collateral reds the registration exposed — and fixed

Registering a page makes three other guards judge it for the first time. All three were made green in the
same pass, so the net is still a shrinking D8 list:

| Guard | Why it turned red | Fix |
|---|---|---|
| `scripts/test-signposts.mjs` | red at HEAD (in the 10): its `PLACES` did not know the page the help points at | `PLACES` entry → **15 ✓ 0 ✗** |
| `packages/kybernos-plugin/test-settings-search.mjs` | a page in `KB_NAV_KEYS` with no `KB_SS_INDEX` row | 2 rows + French twins + page keywords → **82 ✓ 0 ✗** |
| `scripts/test-settings-names.mjs` | its own `NAV` list must mirror `KB_NAV_KEYS` | one entry → **9 ✓ 0 ✗** |
| `scripts/test-no-french-literals.mjs` | my first keyword line tripped the unaccented-French detector | reworded to mixed French/English → **382 ✓ 0 ✗** |
| `packages/kybernos-plugin/test-settings-nav.mjs` | **fragility found**: `block` was `SRC.slice(start, start + 24000)`; one drawing line pushed `attributeFilter` past the window and failed an unrelated check | slice anchored on the effect's end marker (`'kybers: settings menu groups')`) instead of a magic length |

## Hot file: `packages/kybernos-plugin/client.js`

`KB_NAV_KEYS`, `ICONES` and the Settings-search index live in that one hot file, so the task's "do not touch
`kybernos-plugin/client.js`" cannot be honoured literally while also adding "the `KB_NAV_KEYS` key" the same
brief asks for. The file was taken with the session guard (`garde.mjs --claim`, exit 0 = mine), edited in small
additive hunks, parse-checked (`garde.mjs --check`, module mode, exit 0) and released each time.

The concurrent theme batch **did** write the same file during the session (two writes observed; my own reads
were refused twice with "file changed since it was read"). Its hunks (theme installer/marketplace) and mine are
distinct regions; the final `git diff` carries both. Nothing of theirs was reverted.

## `run-all-tests.mjs` comparison

| | HEAD `a0b2cb5c` (review, F-6) | This batch (measured) |
|---|---|---|
| Files | 532 | 532 |
| Green | 522 | **528** |
| RED | **10** | **4** |
| Log's six | 6 red | 0 red |
| Not ours | 4 red | 4 red (same files) |
| New red | — | **none** |

The four still red, none of them this batch's:

| File | Cause | Owner |
|---|---|---|
| `scripts/test-help.mjs` | `kybernos-webapp-creator` has no help article (`NO_ARTICLE_YET` count) | pre-existing, ticketed |
| `scripts/test-plugin-scan.mjs` | `kybernos-pulse → exec` (`helper/gen-icon.mjs:9`) undeclared | pre-existing, ticketed |
| `scripts/test-no-legacy-hosts.mjs` | `BUILTIN_API` moved, two consumers kept `api.kybernos.app` | cloud batch (`e52c7c72`), ticketed |
| `packages/kybernos-servers/test-host.mjs` (8 failures) | same rename, fixture pins the old address | cloud batch, ticketed |

## What was checked, what was skipped

- Checked: the five guard files carrying the six reds (green, measured alone), the four collateral guards
  (green, measured alone), `garde.mjs --check` for every hot file (37/37 parse), `run-all-tests.mjs` twice
  (intermediate and final), `build-catalog.mjs` (49 modules).
- Skipped: the live GUI checks — Playwright and jsdom are not installed here (`run-all-tests.mjs` reports them
  as SKIPPED). Nothing in this batch is visual beyond one icon, a pill and CSS-free rows; the drawing is
  covered by `test-settings-icons.mjs` (geometry uniqueness), the pill by `test-help-mounts.mjs` (presence and
  gating).
- Not touched, as instructed: `packages/kybernos-theme/`, `packages/kybernos-plugin/theme-installer.mjs`,
  `index.js`, `docs/tests/*-strategy.md`.
