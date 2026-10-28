> **Naming update (2026-10-28, owner).** The visual layer (earlier "theme": token overlay, presets)
> is now the **style**; the installable sector unit (earlier "sector pack"/"pack") is now the
> **theme**. Code paths stay unchanged (`packages/kybernos-theme`, `theme-presets.json`) until the
> product-rename batch (kybernos-theme → kybernos-style) lands.

# A1-kit-wizard — test strategy (written before any code)

| | |
|---|---|
| Batch | `A1-kit-wizard` — *onboarding Kit step applies the pack's style preset through the seam* |
| Campaign | Phase A of `docs/etudes/2026-10-27-sector-packs-strategy.md` (sections 3, 4, 8 → `:44-106`, `:146-168`) |
| Lane | **B** (no file of this batch touches auth, billing, RLS, migrations or secrets) |
| Author role | `redacteur-spec` — this file only; no code, no test module, no pack edited here |
| Binding contract | skill `contrat-pack-vertical` (primitives first, custom UI in Settings, theme = token overlay, cited or labelled) |
| Verdict on disk | `docs/tests/triage.md:1-3` (`chemin: complet`, sensitive files: `client.js`, `registry.mjs`, `preset-store.mjs`) |
| Status | spec; every `file:line` below was read in this repo on 2026-10-27 |
| Revision | corrected after the gate's `AMEND` (2026-10-27): I2 now **consumes** the frozen seam of `A1-theme-seam` instead of minting a second wire, AMBIGUITY 1 is re-scoped to the display only, the `pack.kit` boundary is stated, and one wrong sha256 pin is fixed by measurement |

## What the batch ships, and what each file is for

| File | Role |
|---|---|
| `packages/kybernos-plugin/client.js` | the wizard's theme step: three pure helpers in `KB-OB-CORE` (`:35343-36001`), one note line and the apply inside `KB-OB-UI` (`:36003-37833`), one row in `T()` after `k.note` (the `k.*` block `:35560-35579`) |
| `scripts/test-onboarding.mjs` | the extraction harness already used for this block (`:15-21`); gains the new names (`:17`) and four labelled assertions |
| `scripts/check-onboarding-live.mjs` | plays the Kit step today (`:244`, `:247`, `:505`); gains the stubbed-seam check and its absence check |
| `scripts/check-onboarding-phone-live.mjs` | **unchanged** — measured: it never reaches the Kit step (no `starter kit`, no `Not now` in that file) |

**Write perimeter, measured.** `KB-OB-CORE-BEGIN` `:35343` / `KB-OB-CORE-END` `:36001`; `KB-OB-UI-BEGIN` `:36003` / `KB-OB-UI-END` `:37833`. The `T()` table is *inside* the core block (`KB_OB_T` at `:35361`; the `k.*` rows at `:35560-35579`), so the two perimeters named by the batch are one. **`KB_OB_CSS` starts at `:37959`, outside the perimeter**: this batch cannot add a CSS class, which makes "no free CSS" structural rather than a promise. The Kit screen reuses the existing `note(text, 'info')` line (`:37301`, `:37305`) for the theme line — no new class, no new layout.

**Two facts that shape the whole batch, both measured.**

1. `validatePack` refuses any unknown pack key (`only(raw, [...] , 'pack', errors)`, `domain-pack.mjs:68-72`; the whitelist is `:71`). A pack carrying `theme` today is **rejected**, not loaded — so `sante.json` cannot carry it before batch `A2-pack-format` widens the list. This batch therefore tests the *pure core* with a fixture object (`{...sante, theme: 'cabinet-medical'}`), never with a file it does not own.
2. `onboardingComplete` rebuilds the record from a fixed key list (`onboarding-state.mjs:124-144`): an unknown `theme` in the POST body is **dropped silently, with no error** — `complete()` rebuilds the record key by key (`:124-144`) and the route has no unknown-key guard (`index.js:10772-10778`), so nothing refuses the extra key and nothing keeps it. So this batch cannot prove *persistence* — it proves the **send** (DoD 4) and A2 proves the store. Nothing here may claim the file was written.

## Interpretations (the request admits several)

**Label hygiene, first.** The labels I1-I7 below are **local to this document**. The campaign's letter labels are not a stable schedule and are not re-minted here: the delegation calls the seam "interface I1/I2" and the pack shapes "interfaces I2/I3" in the same breath, `docs/tests/A2-pack-format-strategy.md:93` calls the kit slices "I1", and `docs/tests/A3-vertical-content-strategy.md:43` calls the accent invariant "interface I3". One letter therefore names several wires, so a letter cannot identify a contract. Every cross-batch wire is cited by its **on-disk definition** — the seam by `docs/tests/A1-theme-seam-strategy.md:24-53`, the pack `theme` key and the `theme` body field by `A2-pack-format` — and the human arbitrates the letter list separately (see the `AMBIGUITY:` on the campaign's letters, below).

**I1 — where the theme step lives.** (a) inside `kitApply` (`client.js:36664-36720`), as one more step of the same apply; (b) a new button on the Kit screen; (c) on entering the Kit screen.
**Chosen: (a).** (b) is forbidden (interdit 1, "the Kit keeps its two actions", `:37314-37324`), and (c) would apply a look before any consent and would fire on every `render(false)`.

**I2 — the seam wire this batch consumes is FROZEN elsewhere; nothing is minted here.** The authority is the campaign's I1, already written on disk and published by batch `A1-theme-seam` — `docs/tests/A1-theme-seam-strategy.md:48-53` (the browser answer), inside the section that starts at `:24`:

```js
window.__KB_THEME_APPLY__(input) // input = a preset id (string) | a settings bag (plain object)
// → Promise<{ ok: true, id } | { ok: false, reason }>   — never throws; its absence degrades the caller
```

The wizard passes **the pack's `theme` string only**, never a settings bag: a pack carries one preset id (build contract 3: one data hex per sector, tokens not CSS), and the settings-bag branch of the frozen wire belongs to the theme batch and its Settings surface. The caller reads **only** `ok` — a stub answering `{ok:true}` without `id` is therefore accepted, and the id saved is the one the pack declares (the pack/theme invariant `theme` = the preset's own id, `sante` + `cabinet-medical`), not the id the store echoes: if a store normalises ids, the mismatch is an `A3` data bug, not a fallback invented here.

Read **only** through `kbObThemeSeam(win)` → the function or `null` (absent, not a function, or a throwing getter), inside `try/catch`; applied **only** through `kbObThemeApplied(win, id)` → `true` only when the resolved answer is `{ok:true}`. The helper is `async` and awaits: the frozen wire is a Promise, and awaiting a plain object is a no-op, so a synchronous stub still passes. Every other answer — missing seam, `{ok:false}`, `{ok:false, reason}`, `undefined`, a throw, no window — is `false` (I4). The token `__KB_THEME_APPLY__` therefore appears **exactly once in the 38k-line file**, in the core block (DoD 4). This document adds nothing to the wire: a shape change is made in `A1-theme-seam` and re-read here, never widened locally.

**I3 — what "shows it in the miniature and the tint" means.** (a) the preview model gains `theme` (the preset id or `null`) and the miniature keeps its accent from the pack (`kbObPreviewOf` `:35791-35804`, fed to `buildMini` `:36536`); (b) the wizard re-tints itself from the preset's own tokens.
**Chosen: (a).** (b) would need a colour the wizard does not have (the seam returns no tokens), would add a hex literal to the blocks, and contradicts "one data hex per sector" (build contract 3): the pack's `accent` **is** the theme's `acc` (the pack/style accent invariant, `docs/tests/A3-vertical-content-strategy.md` I6; `sante.json:5` = `#1B7F76`), and the tint already reads it (`--ta` `:36474`, `applyTint` `:36515-36521`). The visible proof is that the miniature's swatch equals the theme's `acc`, not a second colour path.

**I4 — the degradation rule, case by case.** `window.__KB_THEME_APPLY__` absent / not a function / throwing on read / answering `{ok:false}` / answering garbage / the pack carrying no `theme` / no pack at all → **today's screen exactly**: no theme line, no seam call, the accent tint unchanged, the step completes, `theme: null` is sent. Never an exception, never a blocked step, never a new window global from the wizard.

**I5 — consent model.** (a) applied as part of `kitApply` when the person adds at least one item, announced beforehand by one non-interactive note line; (b) a tickable kit row, counted in the summary; (c) always applied at the end of the wizard.
**Chosen: (a).** It cannot desynchronise `S.kitAdded`/`S.kitFailed` (`:36713-36714`) nor the summary row (`:37243`), needs no new selection state, and keeps "a theme is never imposed" (contract 6) true: "Not now" (`:37318`) leaves today's look. Consequence to accept: a person who adds nothing gets no theme — and `kitApply` returns before doing anything at all when nothing is ticked (`:36672`), which is exactly today's behaviour. (b) is a product decision → `AMBIGUITY:` 2.

**I6 — what is saved.** `theme` = the preset id **when the seam accepted**, else `null`; sent in the same `complete` body (`:36159`, next to `profil`, `goals`, `agents`). Not sent in `{action:'domain'}` (`saveDomain` `:36637`): changing the field later from Settings does not move the theme in this batch (out of scope, follow-up).

**I7 — the texts.** **One** new key, `k.theme.note`, no preset name displayed: the frozen wire (I2) carries an id in and `{ok, id}` out, never a display name, so any name written here would be invented and refused by contract 4. The richer display is arbitrated as the first `AMBIGUITY:` below. The English source is pinned; the three translations are **proposals** the implementer may polish, and the unit test checks their structure (four non-empty, none left in English, no HTML), not their wording:

```
'k.theme.note': [
  "This field's look is applied with the kit. Settings › Style keeps the last word.",
  "L’apparence de ce domaine s’applique avec le kit. Réglages › Thème garde le dernier mot.",
  "La apariencia de este ámbito se aplica con el kit. Ajustes › Tema tiene la última palabra.",
  "يُطبَّق مظهر هذا المجال مع المجموعة. الإعدادات ← السمة لها الكلمة الأخيرة.",
],
```

## AMBIGUITY — needs a human, not a silent choice

AMBIGUITY: **what the Kit step shows about the theme — the display only, because the seam is no longer negotiable.** `docs/tests/A1-theme-seam-strategy.md:51-52` freezes an id (or a settings bag) in and `{ok, id}` / `{ok:false, reason}` out: the wire carries **no display name**, and this batch may not widen it. Three readings remain, and only the human can pick: (a) one non-interactive line, no preset name (chosen) — "This field's look is applied with the kit. Settings › Style keeps the last word."; (b) the same line carrying the raw id the pack declares (`cabinet-medical`, cited to `sante.json` and the pack's `theme`, never invented) — honest but reads like a slug to a doctor; (c) nothing displayed, the theme applied silently inside the primary action — the shortest, and the one that strains "a theme is never imposed" (contract 6) because the look would change with no announcement. Arbitrate (a)/(b)/(c). A *pretty* name is off the table this phase: it needs the frozen wire to gain a `name`, which is a change in `A1-theme-seam` and a platform-evolution request, not a silent widening in the wizard.

AMBIGUITY: **consent model (I5).** Chosen: the theme rides on `kitApply` and "Not now" skips it. The alternative — a tickable kit row, default ticked, counted in the summary line — is a more literal reading of "never imposed" and of the batch's own phrase "plus the style preset" as kit *content*. It is a product decision, not a technical one: it changes what the person sees and counts. Arbitrate.

AMBIGUITY: **which two verticals ship.** `docs/etudes/2026-10-27-sector-packs-strategy.md:153-154` says "Health and Law"; the campaign brief and the batch's frozen pack/theme ids say `sante` + `recrutement`. Chosen: **the campaign** (`sante` + `recrutement`), because the delegation contract is the later and binding word, and because the strategy doc lists the choice itself as an open question to the owner (`:181`, question 1). Consequence for this batch: none — the wizard reads an id, never a sector list — but A3 ships the pack and the two documents must not disagree in the release note.

AMBIGUITY: **the campaign's interface letters are overloaded — a human must reconcile the list, not the wires.** Corrected reading (the earlier draft of this file wrongly said "nothing under `docs/` defines them"): the seam half **exists on disk and is frozen** (`docs/tests/A1-theme-seam-strategy.md:24-53`, browser answer `:48-53`), and the pack key plus the onboarding field are written by `docs/tests/A2-pack-format-strategy.md:92-93`. What does not exist is one consistent campaign-level letter list: this delegation calls the seam "interface I1/I2" **and** the pack shapes "interfaces I2/I3", while `A2:93` calls the kit slices "I1". Chosen here: no letter is used as an authority — the wizard consumes `A1-theme-seam`'s browser answer verbatim (I2 above) and `A2`'s `pack.theme` + `theme` body field by reference (I6), and the campaign owner publishes one I1-I4 list (fixing the briefs that disagree) before any release note quotes an interface number. Nothing in the code depends on this choice; only the documents do.

AMBIGUITY: **the mockups named by the campaign do not exist on this machine.** Measured on 2026-10-27: the campaign's app tree (`dyad-apps/dsh-kybernos`) does not exist at all (the `dyad-apps` tree holds `kybernos`, `kybernos-blog`, `kybernos-desktop`, … but no `dsh-kybernos`), so both `vertical-medecin/maquette-v1` and `vertical-recrutement-ssii/maquette-v1` are absent; this repo's own `docs/handoff/` holds only `desktop-electron`, `session-msg` and `webapp-creator`, and `kybernos-projects/kybernos-plugins/docs/handoff/` is the same three. `docs/tests/A3-vertical-content-strategy.md` records the same absence for the content. Consequence for this batch: **no external design reference for the Kit line** — the reference is the shipped screen (see `maquette:`). If the human holds the mockups elsewhere, the theme line's wording must be re-read against them before review.

## Cross-batch boundary: `pack.kit` is **not** consumed here

`docs/tests/A2-pack-format-strategy.md:90-91` (its AMBIGUITY 2) freezes `pack.kit = { themes?, skills?, teams?, automations? }` for a contributing plugin, and warns that "the wizard of batch A1-kit-wizard must read whichever is chosen; the two batches cannot merge with different answers". **The answer is: this batch reads neither shape.** Measured on 2026-10-27:

1. The wizard's kit is derived from the pack's **goals** today — `kbObKitOf` (`client.js:35732`, its goal loops `:35738` and `:35740`) — and `kitApply` (`:36664-36720`) installs item by item; `client.js` contains **no** occurrence of `pack.kit`, `.kit.teams`, `.kit.automations` or `kit.themes` (grep count 0). Nothing here needs a kit wire.
2. The only pack datum this batch adds is the **top-level `theme` string**, read by `kbObThemeOf(pack)` from `pack.theme`, never from `pack.kit.themes`: `A2:155` itself marks `kit.themes` "reference only", and the campaign's frozen pair (pack `sante` → theme `cabinet-medical`) is the single `theme` key `A2` freezes.
3. No shipped pack carries a `kit` key today (`A2:220` asserts the same), so a wizard reading it would be untestable until both `A2` and a contributed data plugin land.

Consequence, accepted and written down rather than discovered at merge: a contributed plugin's kit slices will **not** appear in the wizard's Kit screen this phase — the same recorded follow-up as the shipped `KB_MARKET_TEAMS` catalogue (`:23303-23361`) and the `KB-AUTOTPL` block, neither of which becomes point data in this phase. Rendering contributed kit rows in the wizard is a later platform-evolution request against the frozen `pack.kit` (a new wizard surface, new texts, new selection state), not something this batch smuggles in. A2's "cannot merge with different answers" therefore does not block A1: the wizard's answer is "no kit wire", and A2 keeps its own.

## Lane

**B — standard.** The four files are a browser bundle and three test/check scripts: no credential, billing, RLS, migration or signature surface. The only network shape touched is a POST body field already sent to `/kybernos/onboarding` (`:36159`, route `index.js:10772-10778`), which this batch extends by one key.
Falsifier that would flip this to **A**: any hunk in `packages/kybernos-theme/preset-store.mjs`, in a route (`packages/kybernos-plugin/index.js`), in a `cordis.patch.yml`, or in a signature file — all of them belong to `A1-theme-seam`, `A2-pack-format` or the maintainer.

e2e: the journey on the real GUI, and which batch owns each step.

Played with `scripts/check-onboarding-live.mjs` (sign-in per `docs/dev/live-testing.md`: signed session cookie, never the stale token URL). A fresh profile is what the script already builds; the Kit step it already reaches is `:505`, and `skipKit` is `:244-249`.

- [ ] **The theme is applied with the kit, through the seam (owned: A1).** Before pressing the primary, the script installs a recording stub in the page — `window.__KB_THEME_APPLY__ = (id) => { window.__kbThemeCalls = (window.__kbThemeCalls || []).concat([id]); return { ok: true } }` — then presses the primary action of `:37321` and asserts that `__kbThemeCalls` contains the id the field carries (`cabinet-medical` for Santé). This proves the wire end to end without the theme store being installed.
- [ ] **The line is announced before the press (owned: A1).** On the same screen, `[data-kb-ob="kit-theme"]` exists, its text is the `k.theme.note` string of the current language, and it is **not** a button and **not** a checkbox (it must not be clickable: the apply is the primary action's job).
- [ ] **The look really changed (owned: A1-theme-seam, observed here).** With the real seam installed, after the press, the page's own tokens differ from before the press (the store applied the preset). If the seam is absent, this check is **skipped with a printed reason** — never silently passed.
- [ ] **Degradation, seam absent (owned: A1).** Same screen with no stub: `[data-kb-ob="kit-theme"]` is absent, the primary action completes exactly as today, no console error, and the tint variables still read the pack accent. `skipKit` (`:247`) must keep passing unchanged.
- [ ] **Degradation, seam refusing (owned: A1).** Stub answering `{ok:false}` (then one answering a throw): the line is present, the press completes the step, `theme` is sent as `null`, and the wizard shows no error state (`S.kitFailed` untouched, `:36714`).
- [ ] **The field is sent (owned: A1), and stored (owned: A2).** A1 proves the request body of `POST /kybernos/onboarding` carries `theme` — captured by intercepting the request in the live script, not by reading `onboarding.json`. A2 proves the file and the `GET`.
- [ ] **A field without a theme is untouched (owned: A3 for the data).** A pack whose `theme` is absent (`edu`, today) shows no line and sends `theme: null` — the default path must stay byte-identical in behaviour.
- [ ] **Phone: regression only, and said so.** `check-onboarding-phone-live.mjs` never reaches the Kit step (measured), so no phone theme check is claimed. It must stay green untouched.

vision: what the eye must confirm, and how.

- [ ] Five captures, each read with the image reader (a capture not looked at is not a proof): Kit step **light** with the line, Kit step **dark** with the line, Kit step **narrow** (390 px, phone width) with the line, Kit step with the seam **absent** (no line), Kit step **Arabic** (RTL, `ar` is the only right-to-left language, `test-onboarding.mjs:29`).
- [ ] The line sits under the existing `k.note` line (`:37305`), above the sticky action row (`:37314`), and does **not** push the actions below the fold at 390 px — the sticky row exists for exactly that reason (`:37313` comment).
- [ ] The miniature is unchanged: same menu words, same accent swatch. The only difference allowed between "theme" and "no theme" is the one line.
- [ ] The Arabic capture: the line is right-aligned by the existing `dir` handling, no clipped glyph, no Latin word invented into the sentence.
- [ ] No new visual element anywhere: no icon, no badge, no second line, no colour. A reviewer who can spot the theme line *only* by reading it is looking at the right implementation.

capture: where the images live, and the one rule that matters.

- [ ] Captures go to an **untracked** folder (`campagne-recette-a1-kit/`), never `git add`ed: `scripts/garde-depot.mjs:3` fails on *tracked* media and `:50` is the rule (`media file tracked`), so an untracked PNG is allowed and a committed one is a red gate. No capture path is written into this repo or into the sortie as a repo path.
- [ ] The five vision states are named `kit-theme-light.png`, `kit-theme-dark.png`, `kit-theme-390.png`, `kit-theme-absent.png`, `kit-theme-ar.png`; the sortie lists those names only.
- [ ] Screenshots are taken from the live script's own `page.shot(...)` (`check-onboarding-live.mjs` already has that helper), so the state captured is the state asserted — not a hand-made one.

maquette: not applicable as an external mockup — with the reason, and what stands in for it.

- The campaign's two mockup folders (`vertical-medecin/maquette-v1`, `vertical-recrutement-ssii/maquette-v1`) are **absent from this machine** — measured 2026-10-27: the campaign's `dyad-apps/dsh-kybernos` tree does not exist, and no `maquette-v1` folder exists under this repo or `kybernos-projects`; `docs/tests/A3-vertical-content-strategy.md` records the same absence. There is therefore **no maquette to compare the Kit line against**, and this batch does not draw one: a mockup of a single text line inside an existing screen would be a fabrication of a design that already exists.
- What stands in for it, and is binding: the shipped Kit screen (`client.js:37207-37324`), its existing note lines (`:37301`, `:37305`), its sticky action row (`:37314-37324`), and the existing `.kb-ob-*` classes. **No new CSS is possible** (`KB_OB_CSS` at `:37959` is outside the write perimeter `:35343-37833`), so the line must be the `note(text, 'info')` primitive or nothing.
- The miniature has its own reference and it is already shipped: `kbObPreviewOf` (`:35791-35804`) → `buildMini` (`:36536`), asserted today by `scripts/test-onboarding.mjs:167-173`. This batch adds one field to that model and changes none of its drawing.

unit: the extraction harness, the four labels, and the fixtures.

The harness already exists: `scripts/test-onboarding.mjs:15-21` extracts `KB-OB-CORE` and `KB-OB-UI` by marker and imports the core as a `data:` module; `:17` is the **name list** — a `kbOb*` function the wizard needs must be inside the markers **and** in that list, or the test cannot see it. `:223` shows the accepted way to assert on the UI block: a regex over the extracted text.

- [ ] `:17` gains exactly `kbObThemeOf`, `kbObThemeSeam`, `kbObThemeApplied` — no other name, so the extraction test keeps failing on a function left outside the markers.
- [ ] The line carries `data-kb-ob="kit-theme"` (the marker the live check selects on, and the string DoD 4 looks for) and it is a plain note element, never a `button`, never an `input`.
- [ ] Four assertions, with **these labels** (pinned: DoD 5 greps `^ok   kit theme`):
  - `eq('kit theme: the pack theme id is read, an absent or invalid one answers null', ...)`
  - `eq('kit theme: the seam is read in try/catch and applied only when it accepts', ...)`
  - `eq('kit theme: the miniature carries the id and keeps the pack accent and menu', ...)`
  - `eq('kit theme: one note, four languages, and it cites Settings', ...)`
- [ ] **Fixture, not a file:** `{ ...loadPacks(...).packs.find((p) => p.id === 'sante'), theme: 'cabinet-medical' }` (`:114` already loads the real packs) and a bare `{ theme: 'recrutement-ssii' }` for the second frozen id. **No `recrutement.json` is assumed to exist** — it is A3's file and does not exist today (measured); a test that needs it would be red before A3 lands.
- [ ] The degradation table of I4 is asserted one case at a time: absent seam, non-function seam, throwing getter, `{ok:false}`, `undefined`, throw inside the call, no window, promised answer. Each answers `false` and none throws.
- [ ] `kbObPreviewOf` with the fixture: `.theme === 'cabinet-medical'`; without it: `.theme === null`; and `menu`/`skills`/`accent` byte-identical between the two (the theme changes nothing but the flag).
- [ ] Cross-batch risk to respect, not to "fix": `:157` pins the field list `['sante', 'droit', 'immo', 'edu', 'fin', 'mkt', 'dev']` read from the real `domains/` folder. A1 must not depend on that list growing, and A3 must update it in its own batch if `recrutement.json` changes the answer. A1 must not touch `:157`.
- [ ] The suite's own exit path stays as it is (`:435-436`: `all checks passed` / `N check(s) FAILED`, `process.exit(fails === 0 ? 0 : 1)`).

DoD: deterministic commands that **fail on the code as it is today** (each was run on 2026-10-27 and exited 1 with the message quoted). Relative paths only; no new file, no new script: they use the harness that exists.

**DoD 1 — the three pure helpers behave, in the extraction harness.**

```bash
node --input-type=module -e '
import{readFileSync}from"node:fs"
const s=readFileSync("packages/kybernos-plugin/client.js","utf8")
const i=s.indexOf("// KB-OB-CORE-BEGIN"),j=s.indexOf("// KB-OB-CORE-END")
let p
try{p=(await import("data:text/javascript,"+encodeURIComponent(s.slice(i,j)+"\nexport const __p = { kbObThemeOf, kbObThemeSeam, kbObThemeApplied }"))).__p}
catch(e){console.log("FAIL core: the theme helpers are not in the KB-OB-CORE block —",e.message);process.exit(1)}
const bad=[]
const isFn=(n)=>typeof p[n]==="function"||bad.push(n+" is not a function")
for(const n of ["kbObThemeOf","kbObThemeSeam","kbObThemeApplied"])isFn(n)
if(bad.length===0){
  const of=p.kbObThemeOf
  if(of({theme:"cabinet-medical"})!=="cabinet-medical")bad.push("kbObThemeOf does not read pack.theme")
  if(of({theme:"recrutement-ssii"})!=="recrutement-ssii")bad.push("kbObThemeOf does not accept recrutement-ssii")
  if(of({})!==null||of(null)!==null||of({theme:42})!==null||of({theme:""})!==null)bad.push("kbObThemeOf does not answer null for an absent or invalid theme")
  const seam=p.kbObThemeSeam
  const fn=()=>({ok:true})
  if(seam({__KB_THEME_APPLY__:fn})!==fn)bad.push("kbObThemeSeam does not find the seam")
  if(seam({})!==null||seam(null)!==null)bad.push("kbObThemeSeam does not answer null without a seam")
  const boom=Object.defineProperty({},"__KB_THEME_APPLY__",{get(){throw new Error("boom")}})
  if(seam(boom)!==null)bad.push("kbObThemeSeam does not survive a throwing getter")
  const ap=p.kbObThemeApplied
  if((await ap({__KB_THEME_APPLY__:()=>({ok:true})},"x"))!==true)bad.push("an accepting seam is not reported as applied")
  if((await ap({__KB_THEME_APPLY__:()=>({ok:false})},"x"))!==false)bad.push("{ok:false} is not reported as refused")
  if((await ap({__KB_THEME_APPLY__:()=>{throw new Error("no")}},"x"))!==false)bad.push("a throwing seam is not reported as refused")
  if((await ap({__KB_THEME_APPLY__:()=>undefined},"x"))!==false)bad.push("an undefined answer is not reported as refused")
  if((await ap({},"x"))!==false)bad.push("a missing seam is not reported as refused")
  if((await ap(null,"x"))!==false)bad.push("no window is not reported as refused")
  if((await ap({__KB_THEME_APPLY__:()=>Promise.resolve({ok:true})},"x"))!==true)bad.push("a promised answer is not awaited")
  if((await ap({__KB_THEME_APPLY__:(id)=>id==="cabinet-medical"?{ok:true}:{ok:false}},"recrutement-ssii"))!==false)bad.push("the preset id is not the argument of the seam")
}
if(bad.length>0){for(const b of bad)console.log("FAIL core theme:",b);process.exit(1)}
console.log("ok   core theme: kbObThemeOf / kbObThemeSeam / kbObThemeApplied behave")
'
```

Today: `FAIL core: the theme helpers are not in the KB-OB-CORE block — kbObThemeOf is not defined` (exit 1).

**DoD 2 — one note, four languages, and it cites Settings.**

```bash
node --input-type=module -e '
import{readFileSync}from"node:fs"
const s=readFileSync("packages/kybernos-plugin/client.js","utf8")
const i=s.indexOf("// KB-OB-CORE-BEGIN"),j=s.indexOf("// KB-OB-CORE-END")
const m=await import("data:text/javascript,"+encodeURIComponent(s.slice(i,j)+"\nexport { KB_OB_T }"))
const row=m.KB_OB_T["k.theme.note"],bad=[]
if(!Array.isArray(row))bad.push("k.theme.note is missing from KB_OB_T")
else{
  if(row.length!==4)bad.push("k.theme.note is not a four-language row")
  if(row.some((t)=>typeof t!=="string"||t.trim()===""))bad.push("k.theme.note has an empty language")
  if(row.slice(1).some((t)=>t===row[0]))bad.push("k.theme.note is left in English in at least one language")
  if(row.some((t)=>/<\/?[a-z]|javascript:|on[a-z]+=/i.test(t)))bad.push("k.theme.note carries HTML or a script marker")
  if(!/^This field.s look is applied with the kit\./.test(row[0]))bad.push("k.theme.note does not open on the English source sentence")
  if(!/Settings . Theme/.test(row[0]))bad.push("k.theme.note does not say that Settings keeps the last word")
}
if(bad.length>0){for(const b of bad)console.log("FAIL texts:",b);process.exit(1)}
console.log("ok   texts: k.theme.note exists in four languages and cites Settings")
'
```

Today: `FAIL texts: k.theme.note is missing from KB_OB_T` (exit 1).

**DoD 3 — the miniature carries the id and keeps the pack accent, menu and kit.**

```bash
node --input-type=module -e '
import{readFileSync}from"node:fs"
import{loadPacks}from"./packages/kybernos-plugin/domain-pack.mjs"
const s=readFileSync("packages/kybernos-plugin/client.js","utf8")
const i=s.indexOf("// KB-OB-CORE-BEGIN"),j=s.indexOf("// KB-OB-CORE-END")
const m=await import("data:text/javascript,"+encodeURIComponent(s.slice(i,j)+"\nexport { KB_OB_ROWS, kbObPreviewOf }"))
const packs=loadPacks("packages/kybernos-plugin/domains").packs
const sante=packs.find((p)=>p.id==="sante")
if(sante===undefined){console.log("FAIL preview: the shipped sante pack is not loaded");process.exit(1)}
const rows=m.KB_OB_ROWS.map((r)=>({id:r[0],label:r[0].toUpperCase()}))
const bad=[]
const withTheme=m.kbObPreviewOf({...sante,theme:"cabinet-medical"},["notes"],"en",rows)
const plain=m.kbObPreviewOf(sante,["notes"],"en",rows)
if(withTheme===null||plain===null)bad.push("no miniature for a pack")
else{
  if(withTheme.theme!=="cabinet-medical")bad.push("the miniature does not carry the pack theme id")
  if(plain.theme!==null)bad.push("a pack without a theme does not answer theme:null")
  if(withTheme.accent!=="#1B7F76")bad.push("the miniature accent is no longer the pack hex")
  if(JSON.stringify(withTheme.menu)!==JSON.stringify(plain.menu))bad.push("the theme changes the menu of the miniature")
  if(JSON.stringify(withTheme.skills)!==JSON.stringify(plain.skills))bad.push("the theme changes the kit of the miniature")
}
if(bad.length>0){for(const b of bad)console.log("FAIL preview:",b);process.exit(1)}
console.log("ok   preview: theme id carried, pack accent and menu untouched")
'
```

Today: `FAIL preview: the miniature does not carry the pack theme id` + `FAIL preview: a pack without a theme does not answer theme:null` (exit 1).

**DoD 4 — the wiring: one seam read in the core, applied by `kitApply`, sent as `theme`, shown by the Kit screen.**

```bash
node --input-type=module -e '
import{readFileSync}from"node:fs"
const s=readFileSync("packages/kybernos-plugin/client.js","utf8")
const cj=s.indexOf("// KB-OB-CORE-END")
const ui=s.slice(s.indexOf("// KB-OB-UI-BEGIN"),s.indexOf("// KB-OB-UI-END"))
const bad=[]
const hits=s.split("__KB_THEME_APPLY__").length-1
if(hits!==1)bad.push("__KB_THEME_APPLY__ appears "+hits+" time(s): exactly one, in the core helper")
else if(s.indexOf("__KB_THEME_APPLY__")>cj)bad.push("__KB_THEME_APPLY__ is read outside the KB-OB-CORE block")
const k0=ui.indexOf("const kitApply = async"),k1=ui.indexOf("const setupLoad")
if(k0<0||k1<=k0)bad.push("the kitApply block cannot be located")
else{
  const apply=ui.slice(k0,k1)
  if(!/kbObThemeApplied\s*\(/.test(apply))bad.push("kitApply does not apply the theme through kbObThemeApplied")
  if(!/theme\s*[:=]/.test(apply))bad.push("kitApply does not record the theme it applied (S.theme = … or theme: …)")
}
const post=ui.split("\n").find((l)=>/action: .complete/.test(l))
if(post===undefined)bad.push("the complete post line is not found")
else if(!/theme\s*:/.test(post))bad.push("the complete body carries no theme field")
if(!ui.includes("kit-theme"))bad.push("the kit screen has no theme row (data-kb-ob kit-theme)")
if(!/kbObThemeOf\s*\(/.test(ui))bad.push("the screen does not read the pack theme through kbObThemeOf")
if(!/kbObThemeSeam\s*\(/.test(ui))bad.push("the screen does not probe the seam through kbObThemeSeam")
if(!/T\(.k\.theme\.note.\)/.test(ui))bad.push("the theme line does not use the k.theme.note text")
if(bad.length>0){for(const b of bad)console.log("FAIL wiring:",b);process.exit(1)}
console.log("ok   wiring: one seam read in the core, applied by kitApply, sent as theme, shown by the kit screen")
'
```

Today: eight `FAIL wiring:` lines, starting with `__KB_THEME_APPLY__ appears 0 time(s)` (exit 1).

**DoD 5 — the extraction list and the four labels really run green.**

```bash
node scripts/test-onboarding.mjs > /tmp/a1-onboarding.log 2>&1 && grep -q '^ok   kit theme' /tmp/a1-onboarding.log
```

Today: exit 1 (`grep` finds nothing; the suite itself ends `all checks passed` — measured, so the red is the missing label, not a broken suite). The four labels are pinned by `unit:`; the name list is pinned at `scripts/test-onboarding.mjs:17`.

**DoD 6 — the live script carries the stubbed-seam proof and its absence twin.**

```bash
grep -q '__kbThemeCalls' scripts/check-onboarding-live.mjs && grep -q '__KB_THEME_APPLY__' scripts/check-onboarding-live.mjs && grep -q 'kit-theme' scripts/check-onboarding-live.mjs
```

Today: exit 1 (none of the three strings exists in that file).

### Guards — green today, and therefore **not** DoD (they must stay green)

The batch's own `dod` list mixes proof-of-change with proof-of-no-regression. The second kind passes on today's code by construction, so it cannot be a DoD; it is stated here so nobody "proves" the batch with a command that was already green.

- [ ] `node scripts/garde-depot.mjs` — measured today: `1868 tracked files — 0 error(s), 0 warning(s)`. This spec adds one Markdown file and no personal path and no media, so it must stay at 0/0.
- [ ] `node scripts/test-lifecycle-engine.mjs` — measured today: `82 assertions, 0 échec`. No engine, no `cordis.patch.yml`, no compat range in this batch: unchanged.
- [ ] `node scripts/test-paquet.mjs` — measured today: `111 assertions, 0 échec(s)`. Unchanged.
- [ ] `node scripts/run-all-tests.mjs --only onboarding` — runs `scripts/test-onboarding.mjs` and `packages/kybernos-plugin/test-onboarding-state.mjs` (measured with `--list`); must end 0 red, and the state test must be untouched by this batch (it is A2's file).
- [ ] `node scripts/run-all-tests.mjs --only test-automation-templates` — **corrected reading of the batch's `dod`:** the file it runs is `packages/kybernos-plugin/test-automation-templates.mjs` (not `scripts/`), it exists, and it is green today (`ALL PASS`). It is the proof that the `KB-AUTOTPL` block (`client.js:7799-8056`) did not move — a **guard**, since it passes now.
- [ ] The two out-of-scope blocks are byte-identical: `KB-AUTOTPL` (`:7799-8056`) and `KB_MARKET_TEAMS` (`:23303-23361`). **Pinned by measurement on 2026-10-27 (the previous pin of this file, `ee208156be19ec62`, was wrong and is corrected here):** sha256, first 16 hex, `047a8cf7270fc3d3` and `d230845c9e7f71d2`. The command recomputes both, cutting from the `// KB-AUTOTPL-BEGIN` marker through the end of `// KB-AUTOTPL-END` (17 chars), and from `const KB_MARKET_TEAMS = [` through the closing `\n    ]` (6 chars):

```bash
node --input-type=module -e 'import{readFileSync}from"node:fs";import{createHash}from"node:crypto";const s=readFileSync("packages/kybernos-plugin/client.js","utf8");const h=(x)=>createHash("sha256").update(x).digest("hex").slice(0,16);const a=s.indexOf("// KB-AUTOTPL-BEGIN"),b=s.indexOf("// KB-AUTOTPL-END")+17;const i=s.indexOf("const KB_MARKET_TEAMS = ["),j=s.indexOf("\n    ]",i)+6;const got=[h(s.slice(a,b)),h(s.slice(i,j))];console.log("AUTOTPL",got[0],"MARKET",got[1]);if(got[0]!=="047a8cf7270fc3d3"||got[1]!=="d230845c9e7f71d2"){console.log("FAIL frozen block moved");process.exit(1)}console.log("ok   both frozen blocks byte-identical")'
```
- [ ] The `KB-OB` blocks carry **4** colour literals today (`#ffffff` ×3, `#121214`) and must still carry 4: no hardcoded colour added (interdit 4).
- [ ] The UI block publishes **no** new window global: `window.__KB_<NAME>__ =` must not appear in `KB-OB-UI` (interdit 3).
- [ ] `scripts/check-onboarding-phone-live.mjs` stays green **untouched** — it does not reach the Kit step (measured), so it proves no phone regression and nothing about the theme.
- [ ] Before a merge into `dev`: `node scripts/run-all-tests.mjs` (0 red). Not run by this spec: a spec does not claim a suite result it did not produce.

## Out of scope (and who owns it)

- **Publishing the seam** `window.__KB_THEME_APPLY__`, writing `theme-presets.json`, applying tokens: batch **`A1-theme-seam`** (`packages/kybernos-theme/preset-store.mjs` is on the triage's sensitive list and is not writable here).
- **The pack's `theme` key**, its validation, the served payload, and the `theme` field in `onboarding.json` (`domain-pack.mjs`, `index.js`, `onboarding-state.mjs`): batch **`A2-pack-format`**. Consequence accepted here: this batch proves the **send**, never the store — measured: `onboardingComplete` (`:124-144`) drops an unknown key silently.
- **The `{action:'domain'}` body** (`:36637`) does **not** carry `theme` in this batch: changing the field later from Settings leaves the theme where it was. Recorded follow-up, not a silent gap.
- **The two packs and the theme sources** (`domains/sante.json` gaining `theme`, `domains/recrutement.json`, `catalog/themes/*`, `gallery.json`): batch **`A3-vertical-content`**.
- **The registry folder scans and the per-point validators** (`themes/`, `skills/`, `teams/`, `automations/`): batch **`A2-registry-points`**.
- **The starter template and the "Build a theme" page**: batch **`A4-starter-docs`**.
- **`pack.kit`** (A2's ambiguity 2, its `:90-91`): not read by the wizard at all — see the boundary section above. The wizard keeps deriving its kit from the pack's goals; contributed kit rows in the Kit screen are a follow-up against the frozen wire.
- **`KB_MARKET_TEAMS` (`:23303-23361`) and the `KB-AUTOTPL` block (`:7799-8056`)**: frozen this phase; their extraction into point data is a recorded follow-up.
- **The phone Kit step**: it does not exist in the live script today; adding one is a separate batch, and this batch must not invent it.
- **A second theme key, a preset name, an icon, a badge, a colour, a CSS class, a new route, a compat bump, a new script**: refused. A need that fits none of the existing primitives is a platform-evolution request, written as one — never a screen smuggled into the wizard.

## What the implementer must report in the sortie

The `k.*` key added with its four values, the exact apply order inside `kitApply`, the six degradation cases and their measured answers, the `theme` value sent in each path (`applied` / `refused` / `no pack` / `skipped`), the live-run result **or its stated absence** (`docs/dev/live-testing.md` needs a running GUI and a signed session; a live run never claimed without being run), and every failure met with its message — including the two cross-batch ones this spec already measured (the validator refusing `theme` today, and `onboardingComplete` dropping it silently).
