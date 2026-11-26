# A1-theme-seam — implementation report

**Batch:** `A1-theme-seam` (spec: `docs/tests/A1-theme-seam-strategy.md`, verdict GO).
**Lane:** B (standard) — no auth, billing, RLS, migration or secret is touched; the route already existed behind its
same-origin guard and the manifest already claimed `host.routes:/kybernos-theme:write`.

**Verdict: `escalate`.** The batch is implemented, and 8 of the 9 DoD commands are green. **D7 is red through its
precondition only**: `node packages/kybernos-theme/test-client.mjs` (the first half of D7's shell line) carries one
red that is **not this batch's**: a neighbouring, *uncommitted* catalogue regeneration (`gallery.json` +
`catalog/themes/_catalogue.json` + two untracked `catalog/themes/*.json`) makes the pre-existing check
« every theme comes through the page's own check unchanged » fail on two of its new themes. D7's own assertion
(the fake-fetch script) prints `D7 ok`. Details and the measured proof are in §DoD and §Pre-existing red below; the
one-line decision for the Lead is in §Decision.

## ROOT CAUSE (one line)

The seam had no writer: no exported `applyPreset` (so `{ import }` was a 400 `invalid body`), no `THEME_POINT`/manifest
`provides` (so a data pack's `themes/` folder had nothing to be validated against), and no published browser door — the
three halves of the same missing contract; plus, separately, a shipped-gallery content red in the worktree that is not
this batch's and is proven external below.

## Files touched (nine, all inside the spec's perimeter)

| File | What changed |
|---|---|
| `packages/kybernos-theme/preset-store.mjs` | `A11Y_KEYS` moved here (§49), `applyPreset(store, input)` (§200, the only writer of the disk library from an import), `handlePresetStore` now takes `{ import }` / `{ library }` / both-or-neither (§255) |
| `packages/kybernos-theme/themes-catalogue.mjs` | re-exports the same frozen `A11Y_KEYS` (§33), `OWNER_VERSION` (§67), `validateTheme` (§75), `THEME_POINT` (§89) |
| `packages/kybernos-theme/plugin.json` | `provides: [{ name: "theme", version: "1.0", kind: "data", class: "inert", validator: "builtin", summary }]` (§30) |
| `packages/kybernos-theme/index.js` | `registrySeam` + `tellThemePoint` (§159), told at boot (§265) and again on the preset-store (§235) and gallery (§241) routes |
| `packages/kybernos-theme/client.js` | §4e the seam (§2178-2290): `__KB_THEME_APPLY__`, single import path through `libHost({ import })`, `keepNativeMode`, `writeState` returns whether the page kept it, `libHost` carries the HTTP status, `publierSeam` in `apply(ctx)` (§5013) |
| `packages/kybernos-theme/test-preset-store.mjs` | 50 → 74 checks (+24): `applyPreset`, a11y refusal, idempotence, A1-1 collision, cap, `updatedAt`, the route branch |
| `packages/kybernos-theme/test-themes-catalogue.mjs` | 51 → 72 checks (+21): the point, the shared `A11Y_KEYS` identity, the shared refusal table, the registry-global guard |
| `packages/kybernos-theme/test-client.mjs` | 423 → 450 checks (+27): publication, alias, shipped id, library id, unknown id, bag, refusals, fallback, quota |
| `scripts/test-themes-catalogue.mjs` | 14 → 30 checks (+16): the same refusal table asserted on the publishing side, plus the shipped gallery through the point |

No file outside these nine was written by this batch (see §Perimeter proof). Nothing was committed.

## DoD — before → after (each command as written in the spec, extracted verbatim from the file)

Before = measured on the tree at the start of this job (bundle byte-identical to the baseline `2ac67fb4` at HEAD,
see §Anchors); after = same command, same shell, re-run once the code was in.

| # | Before (failing, exit 1) | After |
|---|---|---|
| D1 | `plugin.json: no kybernos/theme#theme 1.0 data/inert point with validator builtin` | `D1 ok` (exit 0) |
| D2 | `the theme point is not declared` | `D2 ok` (exit 0) |
| D3 | `applyPreset is not exported by preset-store.mjs` | `D3 ok` (exit 0) |
| D4 | `POST { import } not handled { status: 400, body: { ok: false, error: 'invalid body' } }` | `D4 ok` (exit 0) |
| D5 | `THEME_POINT is not exported by themes-catalogue.mjs` | `D5 ok` (exit 0) |
| D6 | `THEME_POINT is not exported by themes-catalogue.mjs` | `D6 ok` (exit 0), with the expected `[kybernos-registry] left out: @acme/vet:trop.json: accessibility setting: cbSafe` |
| D7 | `D7: window.__KB_THEME_APPLY__ is not published` | **exit 1, empty output** — the precondition `node packages/kybernos-theme/test-client.mjs` exits 1 on one red that is not this batch's (§Pre-existing red). D7's own script, run alone (`sed -n '570,598p'` of the spec → `node d7.mjs`), prints **`D7 ok`** |
| D8 | exit 1 (grep `THEME_POINT` finds nothing in either copy) | `2 test files in 1 s: 2 green, 0 RED` (exit 0) |
| D9 | exit 1 (grep `applyPreset` finds nothing) | `OK — preset store (74 checks)` (exit 0) |

Every command was proven to **fail for the reason its line states** before a line was written (the whole set was run
first). At that moment the client suite was still green (423 passed: the neighbouring catalogue edit landed later in
the session), so D7 reached its script and printed
`D7: window.__KB_THEME_APPLY__ is not published` — the captured before. After the work the same script prints
`D7 ok`.

Regression gate E4, measured after the work:
`node scripts/run-all-tests.mjs --only kybernos-theme` → **9 test files in 16 s: 8 green, 1 RED** — the RED is
`packages/kybernos-theme/test-client.mjs`, i.e. again the external content red. On the committed tree
(`git archive HEAD`) the same file is **423 passed, 0 failed**; with the two offending shipped entries canonicalised
in a throw-away copy, the suite is **450 passed, 0 failed** (my 27 new checks included).
The two pre-push gates also ran clean: `node scripts/test-paquet.mjs` → 111 assertions, 0 failure;
`node scripts/test-lifecycle-engine.mjs` → 82 assertions, 0 failure. `node scripts/garde-depot.mjs` → 0 error,
1 warning on `docs/tests/gate-verdicts-final.md` (pre-existing, not this batch).
The full E5 merge gate (`node scripts/run-all-tests.mjs`, ~183 s, other sessions' work in the tree) was **not** run
here: it is the Lead's integration measurement, and it would report the neighbours' uncommitted state as mine.

Not done in this job, on purpose: the e2e (E1/E2/E3) and vision/capture blocks of the spec need a live signed GUI and
an isolated sandbox; they are the Lead's live pass, and this report claims no capture.

## Pre-existing red — measured, attributed, not mine

At the start of the job the bundle was clean in git; mid-session a neighbouring session wrote, uncommitted:

```
 M packages/kybernos-theme/gallery.json        (+48/−2)
 M catalog/themes/_catalogue.json
?? catalog/themes/cabinet-medical.json
?? catalog/themes/recrutement-ssii.json
```

Those two new shipped themes fail the pre-existing check
« every theme comes through the page's own check unchanged (nothing is silently dropped or rewritten) » for two
independent reasons, both in **content**, not code:

1. their `acc` is uppercase (`#1B7F76`, `#4F5BD5`) while the page's own check (`galTheme` → `sanitiseImport` → `toHex`)
   lowercases it;
2. their `settings` keys are listed in a different order from `PRESET_KEYS`, and the check compares
   `JSON.stringify` of both. `sanitizePreset` preserves the source order on the host side, while the page rebuilds in
   `PRESET_KEYS` order (`mode, acc, ov, sideTone, fontText, …`) — which is exactly why the publishing-side test
   (« gallery.json is exactly what the sources build ») cannot see this: both sides keep the same order there.

Proof chain (all measured):
- `git archive HEAD` + `node packages/kybernos-theme/test-client.mjs` → **423 passed, 0 failed** (the committed tree is green);
- baseline `2ac67fb4` code + the *worktree's* `gallery.json` → the same single red on the same two ids (so it is content);
- worktree code + a copy whose two entries are lowercased and re-ordered → **450 passed, 0 failed**;
- `git diff 2ac67fb4 HEAD -- packages/kybernos-theme/` is **empty**: no committed drift, so this appeared after HEAD.

`gallery.json` and `catalog/**` are the spec's explicit NO-GO (derived files, `A3-vertical-content` regenerates them), so
this batch did not touch them.

## Perimeter proof

`git diff --name-only -- packages/kybernos-theme/ scripts/ docs/tests/`, verbatim:

```
packages/kybernos-theme/client.js
packages/kybernos-theme/gallery.json
packages/kybernos-theme/index.js
packages/kybernos-theme/plugin.json
packages/kybernos-theme/preset-store.mjs
packages/kybernos-theme/test-client.mjs
packages/kybernos-theme/test-preset-store.mjs
packages/kybernos-theme/test-themes-catalogue.mjs
packages/kybernos-theme/themes-catalogue.mjs
scripts/check-hit-targets-live.mjs
scripts/check-ux-probes.mjs
scripts/test-themes-catalogue.mjs
```

Of those twelve, **mine are nine**: `client.js`, `index.js`, `plugin.json`, `preset-store.mjs`, `test-client.mjs`,
`test-preset-store.mjs`, `test-themes-catalogue.mjs`, `themes-catalogue.mjs` and `scripts/test-themes-catalogue.mjs`,
plus this report (`?? docs/tests/impl-A1-theme-seam.md`; A2's and A3's reports are other sessions').
**Not mine:** `packages/kybernos-theme/gallery.json` (the neighbouring session's uncommitted catalogue regeneration —
seen above: the bundle was clean when this job started) and `scripts/check-hit-targets-live.mjs`,
`scripts/check-ux-probes.mjs` (already ` M` in the very first `git status` of this session, untouched since).
`git diff --quiet -- packages/kybernos-theme/gallery.json catalog/` is **1 (not quiet)** in the worktree, for that
same reason — the spec's OUT-OF-SCOPE proof cannot hold while another session is mid-edit, and it holds again once
they commit.

## Anchors — what drifted, what was verified instead

Measured `git diff --numstat 2ac67fb4 HEAD -- packages/kybernos-theme/` → **empty**, so at HEAD every `file:line`
anchor of the spec and of its head note holds for this bundle, and each was re-read in the current file before use:

| Anchor used | At HEAD | After my edit |
|---|---|---|
| `preset-store.mjs:43-52` `SETTINGS_KEYS` (37 keys, node-counted) | 43 | 50 (`A11Y_KEYS` at 49) |
| `preset-store.mjs:136-175` `createPresetStore` | 136 | 143 |
| `preset-store.mjs:178-186` `handlePresetStore` | 178 | 255 |
| `preset-store.mjs:194-210` `servePresetStore` | 194 | 278 (body unchanged) |
| `themes-catalogue.mjs:32` `A11Y_KEYS` | 32 | moved to `preset-store.mjs:49`, re-exported at `themes-catalogue.mjs:33` |
| `client.js:1846-1855` `PRESET_GROUPS` (doc comment 1846, const 1847) | 1846/1847 | unchanged |
| `client.js:1926-1934` `libHost` | 1926 | 1932 (now also returns the HTTP `status`) |
| `client.js:992-995` `writeState` | 992 | 993 (now returns whether the page kept it) |
| `client.js:1310-1318` `appliquerTout` | 1310 | 1315 (unchanged shape; honours `keepNativeMode`) |
| `client.js:3948-3957` `commit` (and `appliquerTout` inside it at `:3954`) | 3948 / 3954 | unchanged |
| `client.js:4793-4804` `__test` | 4793 | unchanged (+27 test checks use the public global, not `__test`) |
| `index.js` `apply` guard (`246-261` pattern) | 246 | 262 |

One anchor **did** drift, and it is outside this bundle: the spec's head note places the `__KB__.provide` idiom of the
neighbouring bundle at worktree `kybernos-plugin/client.js:26242-26244`. In the current worktree it sits at
**`:26266-26270`** (comment 26266, `kbProvideDomain` 26268, the `kybernos:registry` listener 26270). Verified against
the current file; the idiom was copied from there and not from a line number.

## Unit boxes — where each is closed

- `preset-store.mjs`: `test-preset-store.mjs` §« an import through the host entry (applyPreset) » — unknown keys dropped,
  the six a11y refusals naming the key and writing nothing, I6 identity, idempotence, the A1-1 collision (the person's
  record byte-identical, `Soigné (2)` / `soigne-2`, applied anyway), `library full`, `updatedAt` moving forward on a real
  clock, a throwing store, the route branch (200 / 400 a11y / `{library}` unchanged / both-or-neither `invalid body`).
- `themes-catalogue.mjs`: `test-themes-catalogue.mjs` and `scripts/test-themes-catalogue.mjs` — **the same `POINT_CASES`
  table in both copies**, the six a11y keys iterated from the shared `A11Y_KEYS`, the light A4 shape and the full
  catalogue superset, `id === fileId`, a deterministic `{ id, name, settings }` value, the registry-global guard
  (absent registry, throwing `definePoint`, version-1 only).
- `plugin.json` + manifest: D1, D2, D8.
- `client.js`: `test-client.mjs` §« the seam » — publication and identity across two activations, the versioned alias
  re-offered on `kybernos:registry`, one `{ import }` POST for a shipped id (gallery route asked once), no POST for a
  library id or an installed one, unknown id, a settings bag (localized row, merged look, no `{ library }` POST 800 ms
  later), the a11y refusal writing nothing, no `setTheme` without a `mode`, the 400 vs 5xx vs unreachable split, an
  invalid host preset, a full quota (`{ ok:false }`, look kept, no row adopted).
- The registry tell: `test-themes-catalogue.mjs` §« the point is told through the registry global » proves the calls,
  the guard, and the single tell on a version-1 registry. The re-tell on the two routes is code-reviewed, not
  asserted: it needs a fake `webServer` service the batch's files do not have.

## Decision for the Lead (one)

D7 needs `packages/kybernos-theme/gallery.json` to stop carrying non-canonical settings in `cabinet-medical` and
`recrutement-ssii` (lowercase `acc` **and** `PRESET_KEYS` key order, then `node scripts/themes-catalogue.mjs build
--bump`) — that file belongs to the neighbouring catalogue work / `A3-vertical-content`, not to this batch. Either let
that session finish (the committed tree is green: 423 passed), or ticket the two entries to A3; **no change to this
batch's code is needed** — with those two entries canonicalised the suite is 450 green and D7 goes green as written.
