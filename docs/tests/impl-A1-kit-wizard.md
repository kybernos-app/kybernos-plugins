# A1-kit-wizard — implementation report

Batch: `A1-kit-wizard` (*the onboarding Kit step applies the pack's style preset through the seam*).
Spec: `docs/tests/A1-kit-wizard-strategy.md` (verdict AMEND, burn-down applied in place this session).
Implementer lane: **B (standard)**.

## Verdict

**escalate.** The batch is implemented, the wizard is wired to the existing seam, and **four of the six DoD commands are green**
(1, 4, 5, 6) with every guard green and **no repository red of mine** (measured, attribution below). Two DoD commands are red on
**one assertion each**, and both are spec defects — not code defects — that only the Lead can settle:

| DoD | Red assertion | Why it cannot pass as written |
|---|---|---|
| **2** | `k.theme.note does not say that Settings keeps the last word` (`/Settings . Style/`) | « Style » is **not a page of the Settings menu today**: the page is labelled **Theme** (`packages/kybernos-theme/client.js:5026`, `kbthLabel('Thème', 'Theme')`). Writing « Settings › Style » makes the product point at a page that does not exist, which `scripts/test-signposts.mjs` refuses — **measured: 2 new red lines in `client.js`** (en + fr rows). The rename is A5's batch, as the spec's own head note says (« Code paths stay unchanged … until the product-rename batch lands »). |
| **3** | `a pack without a theme does not answer theme:null` | The `plain` fixture is the **real** `sante` pack, and `sante.json:5` carries `"theme": "cabinet-medical"` since A2/A3 landed (the spec's own re-check records the drift at `:40` — but not its consequence on this DoD). At the baseline `2ac67fb4:sante.json` had no `theme` (line 5 was `"accent"`), so the assertion was writable then and is not now: `kbObPreviewOf(sante)` cannot answer `null` without ignoring the pack's own `theme`, which would break the same DoD's first assertion and DoD 1. |

Both fixes are **one line, in the spec** (not in the code), and each is written out in *Spec defects* below with the measurement
that supports it. Nothing else needs a decision: the wire, the text, the degradation table and the perimeter are as specified.

## ROOT CAUSE (one line)

Not applicable — lane B: no auth, billing, RLS, migration or signature surface is touched. The only network shape extended is one
key in a POST body the wizard already sends (`/kybernos/onboarding`, `action:'complete'`); `client.js` is browser code, and no
host file, route, `cordis.patch.yml` or the theme store is modified.

## Files touched

| File | Change |
|---|---|
| `packages/kybernos-plugin/client.js` | `38642` → **`38692`** lines, **+55/−5** (git `--numstat`). `'k.theme.note'` in `KB_OB_T` after `k.note` (`:35778`); three pure helpers in `KB-OB-CORE`: `kbObThemeOf` (`:35952`), `kbObThemeSeam` (`:35957`), `kbObThemeApplied` (`:35968`); `theme: kbObThemeOf(pack)` in the miniature model (`:36031`); `theme: null` in the wizard state (`:36255`); `theme: S.theme` in the complete body (`:36392`); the apply at the end of `kitApply` (`:36957-36959`); `S.theme = null` when the field changes (`:36698` tiles, `:37458` kit-only chips); the announced line, `data-kb-ob="kit-theme"` (`:37546-37556`) |
| `scripts/test-onboarding.mjs` | the three names added to the extraction list (`:17`); 4 labelled assertions in a new §5b'' (`:176-217`) |
| `scripts/check-onboarding-live.mjs` | `completeBodies` on the fake host (`:119`, `:170-176`) + the `/kybernos/onboarding` intercept (`:212`); the no-style checks on the Education run (`:531-539`, `:584-588`); a new §6b — the style line, the seam call with `cabinet-medical`, the look check and its stated skip (`:854-886`) |
| `docs/tests/impl-A1-kit-wizard.md` | this report (the delegation's artifact, not a batch file: the three-file perimeter is unchanged) |

`scripts/check-onboarding-phone-live.mjs` is **untouched** (measured: it never reaches the Kit step, no `starter kit` / `Not now` in
its 235 lines — the spec's measurement still holds).

Dead-code rider (repo rule 3): nothing inside this perimeter is provably dead — the batch is additive (three helpers, one model
field, one state field, one note line, one body key); the five lines it removes are the ones it rewrites — two lines of an existing
doc comment, the complete-post line, and three anchor lines of the Kit screen. The two paths the spec freezes (`KB-AUTOTPL`, `KB_MARKET_TEAMS`) stay byte-identical (guard below), so nothing there is
this batch's to delete.

## The wire, as implemented

**Apply order inside `kitApply`** (the only place the look moves):

1. build `todo` from the ticked skills, teams and automations, plus « Learn my business »;
2. **`todo.length === 0` → return early** (`finish()` in kit-only, `afterKit()` otherwise): no seam read, no apply, `theme` stays `null`
   — this is the spec's accepted consequence of D7, unchanged from today's behaviour;
3. install every item in order (learn task → automation → skill → team), counting `S.kitAdded`/`S.kitFailed`;
4. clear `kitBusy`/`kitInstalled`/`kitSel`;
5. **the style step**: `themeId = kbObThemeOf(curPack())`, then
   `S.theme = themeId !== null && await kbObThemeApplied(win, themeId) ? themeId : null`;
6. `kitOnly` → `kitDone` + redraw + reload; else `afterKit()` → plan/done → `finish()`, which posts `theme: S.theme`.

The apply sits **after** the installs on purpose: a slow or refusing seam can never delay or fail an install, and the value is set
before `finish()` reads it. It is one expression, read for `ok` only — never `reason`, never `id`.

**The six degradation cases, measured** (throwaway script, current `client.js`, no browser):

```
  seam absent                        seam=null     applied=false
  seam not a function                seam=null     applied=false
  reading the seam throws            seam=null     applied=false
  seam answers {ok:false}            seam=function applied=false
  seam answers garbage ('ok')        seam=function applied=false
  seam answers undefined             seam=function applied=false
  seam throws in the call            seam=function applied=false
  no window                          seam=null     applied=false
  seam answers a promise {ok:true}   seam=function applied=true
  seam accepts ({ok:true})           seam=function applied=true

  pack without a theme: kbObThemeOf({}) = null | no pack: null | pack with one: cabinet-medical
```

**The `theme` value sent, per path:**

| Path | `theme` in the POST body |
|---|---|
| the seam accepted | the pack's id, as declared (`cabinet-medical` for Santé) |
| the seam refused, threw, was absent or answered garbage | `null` |
| the pack names no style (Education today) | `null` — and the seam is **never called** (short-circuit before the apply) |
| « Not now » / Skip | `null` — `kitApply` never runs |
| the kit opened on its own from Settings (`standalone`) | applied in the browser if the seam accepts; **nothing is sent** (a standalone run posts no `complete`) |
| `{action:'domain'}` | no `theme` key — out of scope, recorded follow-up in the spec |

`S.theme` is reset to `null` when the field changes (`pickDomain`, kit-only chips): a look applied for a field the person then left
must not be claimed in the body for the new one.

**The text** — one key, four values (`:35778`). The page is named as the Settings menu draws it today; the « Style » word arrives
with A5:

```
'k.theme.note': [
  'This field’s look is applied with the kit. Settings › Theme keeps the last word.',
  'L’apparence de ce domaine s’applique avec le kit. Réglages › Thème garde le dernier mot.',
  'La apariencia de este ámbito se aplica con el kit. Ajustes › Theme tiene la última palabra.',
  'يُطبَّق مظهر هذا المجال مع المجموعة. الإعدادات ← Theme لها الكلمة الأخيرة.',
]
```

`Theme` stays Latin in Spanish and Arabic because **that is what the page shows in those languages** (`kbthLabel` has fr/en only):
a signpost must name the label the person will read. The unit assertion accepts `Theme` **or** `Style`, so A5 can rename without
touching this batch's test (`test-onboarding.mjs:214`).

**No visual element was added**: the line is `note(text, 'info')` — the shipped primitive, no new class, no colour, no layout, no
control (`KB_OB_CSS` at `:38208` is outside the perimeter, so this is structural). The miniature keeps its accent, menu and kit and
gains one field (`theme`).

## DoD before → after

The six commands were extracted **verbatim** from the spec into `/tmp/a1-kit/dod/D1..D6.sh` (a `node --input-type=module` over the
markdown fences, nothing reformatted) and run from the repository root before any write and again after the last one.

| # | Before (exit, quoted) | After |
|---|---|---|
| D1 | `FAIL core: the theme helpers are not in the KB-OB-CORE block — kbObThemeOf is not defined` (exit 1) | **exit 0** — `ok   core theme: kbObThemeOf / kbObThemeSeam / kbObThemeApplied behave` |
| D2 | `FAIL texts: k.theme.note is missing from KB_OB_T` (exit 1) | **exit 1**, one line: `FAIL texts: k.theme.note does not say that Settings keeps the last word` — the four other assertions pass (four languages, none empty, none left in English, no HTML, opens on the English source) |
| D3 | `FAIL preview: the miniature does not carry the pack theme id` + `FAIL preview: a pack without a theme does not answer theme:null` (exit 1) | **exit 1**, one line: `FAIL preview: a pack without a theme does not answer theme:null` — the other four pass (id carried, accent `#1B7F76` kept, menu and kit byte-identical) |
| D4 | eight `FAIL wiring:` lines, first `__KB_THEME_APPLY__ appears 0 time(s): exactly one, in the core helper` (exit 1) | **exit 0** — `__KB_THEME_APPLY__` appears exactly once, at `:35959`, inside `KB-OB-CORE`; `kitApply` applies and records; the complete line carries `theme:`; the screen reads `kbObThemeOf`/`kbObThemeSeam` and uses `T('k.theme.note')` behind `data-kb-ob="kit-theme"` |
| D5 | exit 1 — the suite ended `all checks passed`, the label was missing | **exit 0** — `node scripts/test-onboarding.mjs` → `213 ok`, `all checks passed`, and the four pinned labels print |
| D6 | exit 1 — none of the three strings existed | **exit 0** — `__kbThemeCalls`, `__KB_THEME_APPLY__` and `kit-theme` are all in the live script |

No DoD command was already green before the batch: none was skipped, weakened or reformatted.

## Spec defects (measured, each with its one-line fix)

**1. DoD 2 pins « Style », which is not a Settings page yet** — this is the one I chose against the spec, in favour of the repository
guard, and the Lead must ratify it.

*Measured*: the Settings menu draws the page as **Theme** / **Thème** (`packages/kybernos-theme/client.js:5026`); the nav key is
`kybernos-theme → 'theme'` (`client.js:3022`). With the spec's wording in place, `node scripts/test-signposts.mjs` printed (exit 1):

```
packages/kybernos-plugin/client.js:35776 « Style keeps the last word.', 'L’apparenc » is not a page of the Settings menu
packages/kybernos-plugin/client.js:35776 « Style garde le dernier mot.', 'La aparie » is not a page of the Settings menu
```

i.e. **the spec's text adds a new repository red** (`test-signposts` is red at baseline for the neighbour's `kybernos-log/help.json`
only; adding `client.js` to its list would be a red of mine, which the repo rule forbids). With `Theme` in place, the same command
lists **only** the `kybernos-log` lines again — measured after the change.

*Fix (spec, one line)*: `DoD 2` — replace `/Settings . Style/` with `/Settings . (Theme|Style)/`, and let A5 move the four strings to
« Style » in the same batch that renames the Settings section. *(The unit test already accepts both, so no code change follows.)*

**2. DoD 3's `plain` fixture was a theme-less pack and no longer is.**

*Measured*:

```
baseline  git show 2ac67fb4:packages/kybernos-plugin/domains/sante.json  → line 5 = "accent": "#1B7F76"   (no theme)
today     packages/kybernos-plugin/domains/sante.json:5                    = "theme": "cabinet-medical"
today     loadPacks(...).packs.find(p => p.id === 'sante').theme           = "cabinet-medical"
```

With a theme-less copy of the same pack (`delete copy.theme`) the three other assertions of DoD 3 pass (`withTheme.theme =
"cabinet-medical"`, `plain.theme = null`, accent `#1B7F76`, menu and skills identical) — i.e. the implementation is what the DoD
wanted; only its fixture assumption died with A3.

*Fix (spec, one line)*: `DoD 3` — build `plain` from a copy without the key:
`const bare = { ...sante }; delete bare.theme; const plain = m.kbObPreviewOf(bare, ["notes"], "en", rows)`.

**Not a defect, recorded**: the spec's DoD blocks were re-pinned byte-identically in the last revision; both defects above are
*pre-existing in the pins*, invisible while `sante.json` had no `theme` and the Settings page was not about to be renamed.

## Guards (green, and still green)

| Guard | Measured before / after |
|---|---|
| `node scripts/test-lifecycle-engine.mjs` | `82 assertions, 0 échec` |
| `node scripts/test-paquet.mjs` | `111 assertions, 0 échec(s)` |
| `node scripts/run-all-tests.mjs --only onboarding` | `2 test files in 0 s: 2 green, 0 RED` |
| `node scripts/run-all-tests.mjs --only test-automation-templates` | `1 test files in 0 s: 1 green, 0 RED` |
| frozen blocks sha256 (first 16 hex) | `AUTOTPL 047a8cf7270fc3d3 MARKET d230845c9e7f71d2` — byte-identical |
| colour literals in the `KB-OB` blocks | **4** (`#ffffff`, `#ffffff`, `#121214`, `#ffffff`) — none added |
| new window global from the UI block | **0** (`window.__KB_*__ =` occurrences in `KB-OB-UI`) |
| `node scripts/garde-depot.mjs` | `1984 tracked files — 0 error(s), 1 warning(s)`; the warning is a hard-coded personal path in **`docs/tests/gate-verdicts-final.md`** (a campaign file tracked before this batch, not touched here). The spec's « 1922 files, 0 warning » was measured before the campaign added its files — drift, not regression |
| `node scripts/test-signposts.mjs` | my line removed from the failure list (the remaining one is `packages/kybernos-log/help.json`, the neighbour's untracked bundle) |

## Full suite, with attribution

`node scripts/run-all-tests.mjs` → **`530 test files in 177 s: 518 green, 12 RED`** (exit 1). The spec recorded **8** reds at its
baseline measurement; the four extra are **not** this batch's, and each was checked:

| Red | Attribution |
|---|---|
| `test-consistency-guards`, `test-help-mounts`, `test-help`, `test-layout`, `test-readmes`, `test-signposts` | the neighbour's **untracked `packages/kybernos-log`** bundle (`error`: « every DSH bundle is declared », « is in satellites.json », `help.json` signposts). Named in the spec's baseline as neighbour work |
| `test-no-legacy-hosts` | `index.js` `KB_FEEDBACK_API_DEFAULT` and `packages/kybernos-computers/template-dsh/settings.yaml` (`api.` vs `server.`) — **neither file is touched** by this batch |
| `test-plugin-scan` | `kybernos-pulse → exec` (in the spec's baseline list) |
| `packages/kybernos-servers/test-host.mjs` | neighbour bundle, not in the perimeter |
| `packages/kybernos-plugin/test-menu-icons.mjs` | **proven pre-existing**: run against a pristine copy of `HEAD`'s `client.js` in `/tmp/mi`, it fails identically (« every menu row that has an icon-set entry is in the table », `projects` vs `cloudcomputer`) |
| `packages/kybernos-plugin/test-settings-nav.mjs`, `test-no-french-literals` | in the spec's baseline list; the French literals are `client.js:33876` and `index.js:11628` — **not** this batch's `:35778` |

No red was caused by the three files this batch edits, and `test-onboarding.mjs` (the file this batch changes) is green.

## Perimeter proof

```
$ git diff --name-only
.claude/skills/ux-bug-hunter/probes.js          ← pre-existing, not mine
docs/tests/A1-kit-wizard-strategy.md            ← pre-existing (the gate's burn-down), not mine
packages/kybernos-composio/cordis.patch.yml     ← pre-existing, not mine
packages/kybernos-plugin/client.js              ← MINE
scripts/check-hit-targets-live.mjs              ← pre-existing, not mine
scripts/check-onboarding-live.mjs               ← MINE
scripts/check-ux-probes.mjs                     ← pre-existing, not mine
scripts/test-onboarding.mjs                     ← MINE
```

The five non-batch lines were already modified before this session's first read (the worktree at `a11942f1` carried them) and are
untouched by me. Nothing was written outside the perimeter; no CSS class, no route, no compat range, no new script, no pack.
`docs/tests/impl-A1-kit-wizard.md` is new and untracked, as a report must be before the batch's own commit.

## Drifted anchors (baseline `2ac67fb4` → worktree `a11942f1` + this batch)

- The two `KB-OB` markers are where the spec's drift note says: `KB-OB-CORE-BEGIN` `:35343` → **`:35542`** (+199), `KB-OB-CORE-END`
  `:36001` → **`:36200`**, `KB-OB-UI-BEGIN` `:36003` → **`:36202`**, `KB-OB-UI-END` `:37833` → **`:38032`**, `KB_OB_CSS` `:37959` →
  **`:38158`**. After this batch: `:35542` / **`:36232`** / **`:36234`** / **`:38082`**, and `KB_OB_CSS` **`:38208`** (my +50 lines land inside the
  two blocks, before the CSS), so any further `file:line` read of the wizard needs the marker, never the number.
- `sante.json:5` carries `"theme": "cabinet-medical"` (A2/A3), which is what breaks DoD 3's fixture — the spec's re-check notes the
  key but not its effect on the DoD.
- The Settings page is labelled **Theme/Thème**, not **Style**: the 2026-10-28 rename is vocabulary, not code, until A5.
- `garde-depot.mjs`: 1922 tracked files / 0 warning at the spec's measurement → **1984 / 1 warning** (a campaign file).
- `test-signposts`, `test-menu-icons`, `test-no-legacy-hosts` and `kybernos-servers/test-host` are red on `HEAD` independently of
  this batch (the first is red because of the neighbour's untracked bundle; the second was proven on a `HEAD` copy).
- The two mockups (`docs/handoff/theme-medecin/maquette-v1/`, `docs/handoff/theme-recrutement-ssii/maquette-v1/`) exist as the spec
  says; this batch reads no pixel from them (the line is the shipped `note` primitive).

## Live run, vision and captures — **stated absence**, and what the script now carries

**No live run was made, and no capture is claimed.** `scripts/check-onboarding-live.mjs` deliberately refuses `127.0.0.1:3080`
(it writes a key and a model into the instance) and needs a sandbox (`source scripts/sandbox/env.sh`, `KB_HOST` ≠ `:3080`) plus
Chrome; no sandbox instance exists in this session and starting one is not this batch's call. `vision:` and `capture:` are
therefore **not executed**: the five states (`kit-theme-light|dark|390|absent|ar.png`), the 390 px fold check and the Arabic
right-to-left read are the Lead's pass, and `campagne-recette-a1-kit/` is untouched (untracked by rule).

What the script now carries, so that pass is a run and not a rewrite:

| e2e bullet (spec) | Where in `check-onboarding-live.mjs` | State |
|---|---|---|
| a field **without** a style: no line, no call, `theme: null` sent | `:531-539` (Education, stub installed so a call would be seen), `:584-588` (body intercepted at the page) | written, **not run** |
| the line is announced, **not a control**, in the current language | `:875` (Health) | written, not run |
| the style is applied with the kit, **through the seam**, with the pack's id | `:854-880` — the seam is **chained** (records the call and still calls the bundle's own apply) | written, not run |
| the **look really changed** (owned by A1-theme-seam) | `:883-884` — if the seam is absent or refuses, it **prints `SKIP …` with the reason** and asserts nothing; it never passes silently | written, not run |
| the seam **refusing** → step completes, no error state, `theme: null` | the refusal's *no error state* is live (`:881`); the refusal's **sent `null`** is unit-proven only (the kit-only screen posts nothing), stated rather than claimed | partial |
| phone | untouched script, no claim | — |

## What the Lead should decide

1. **Ratify the wording** (DoD 2): keep `Settings › Theme` (green suite, A5 moves it to « Style » with the rename) **or** pin
   « Style » now and accept a new `test-signposts` red until A5 lands. I chose the first.
2. **Amend DoD 3's fixture** (one line, in the spec) so its plain case builds a theme-less copy — the code already answers what the
   DoD wanted.
3. Nothing else: with those two lines applied the batch is six-of-six, and the merge note should name the twelve pre-existing reds,
   none of which is this batch's.
