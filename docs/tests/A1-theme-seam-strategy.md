> **Naming update (2026-10-28, owner).** The visual layer (earlier "theme": token overlay, presets)
> is now the **style**; the installable sector unit (earlier "sector pack"/"pack") is now the
> **theme**. Code paths stay unchanged (`packages/kybernos-theme`, `theme-presets.json`) until the
> product-rename batch (kybernos-theme → kybernos-style) lands.

> **Baseline: `2ac67fb4` (bound decision D1).** Every `file:line` anchor below is verified against that commit
> (`git show 2ac67fb4:<path>`), never against the moving worktree, and must be re-pinned when
> implementation starts. Worktree drift, measured 2026-10-28: `packages/kybernos-theme/` is
> **byte-identical** to the baseline (30 files; `git diff --numstat 2ac67fb4 -- packages/kybernos-theme/`
> is empty), so every anchor in this batch's own files reads the same in both trees. The only two
> anchored files that have moved are `packages/kybernos-plugin/index.js` (+205/−11: the registry-global
> comment and seam sit at `:10728-10730` and the boot tell at `:10740`, against `:10716-10728` at the
> baseline) and `packages/kybernos-plugin/client.js` (+133/−7: the `__KB__.provide` idiom sits at
> `:26242-26244`, against `:26226-26228` at the baseline). The baseline numbers are the anchors; the
> worktree pairs are given so a reader in either tree finds the code. A line number carried across a
> commit is a guess, not an anchor.

# A1-theme-seam — test strategy (written before the code)

**Batch:** `A1-theme-seam` — one public "apply a style preset" seam, end to end inside `kybernos-theme`, plus the
`kybernos/theme#theme` data point (validator + manifest `provides` + `definePoint`), so a data plugin's `themes/`
folder is read the way `domains/` already is.

**Status:** strategy. Nothing here is a result: it is the contract the implementation of this batch is judged by, and
every command in the `DoD` section is proven to FAIL on the code as it stands today — re-measured 2026-10-28 in this
worktree, whose `packages/kybernos-theme/` is byte-identical to the baseline `2ac67fb4` (the earlier reading of
2026-10-27, `fc0005e3`, is superseded by that measurement, not by a claim).

**Lane: B — standard.** The lane rule is "A as soon as a single file of the batch touches auth, billing, RLS,
migrations or secrets". None of the nine files does: the route already exists behind the same-origin guard
(`packages/kybernos-theme/preset-store.mjs:194-210`), the manifest already declares
`host.routes:/kybernos-theme:write` and `claims.routePrefixes` (`plugin.json:30-41`), and no new permission, secret,
schema migration or money path is added. It becomes lane A the day the import needs the signed session cookie —
`session-guard.mjs` is **copied per bundle**, not one shared door: 28 copies under `packages/` at the baseline
(`git ls-tree -r --name-only 2ac67fb4 | grep 'session-guard'` → 29 files, the 29th being
`scripts/test-session-guard.mjs`), and `docs/dev/plugin-contract.md:317` already records the intent to make that
shared code a versioned service — or writes anything outside `<DSH home>/kybernos`.

**Sources read (binding, in this order):** `docs/etudes/2026-10-27-sector-packs-strategy.md` sections 3, 4 and 8;
`docs/dev/domain-packs.md` (the « Theme per field » row, line 108, marked **next**); `docs/dev/plugin-contract.md`
sections on `provides` (93, 131, 197, 251-265) and the two seams (302-317); `docs/tests/triage.md`; the wizard's
frozen wire (`docs/tests/A1-kit-wizard-strategy.md:42-47`, the `theme` string only at `:49`); the starter's theme-file
shape (`docs/tests/A4-starter-docs-strategy.md:251` — `:241` is the install/preview loop, not it); the skill
`contrat-pack-vertical`; `AGENTS.md`.

## The seam wire this batch builds — `kybernos/theme#theme`

Frozen by the orchestrator, completed by the correction below.

**Label hygiene (bound decision D3).** The campaign's `I1`..`I5` letters are **retired** (`docs/tests/porte-go-verdicts.md:40-43`:
three specs reported them independently as overloaded — one letter named several wires, so a letter cannot identify a
contract). This batch opens exactly one point, `kybernos/theme#theme`, and every wire below is named rather than
lettered. The two numbers `I6` and `I7` survive on purpose: `docs/tests/porte-go-verdicts.md:37` and the bound
decision D2 cite them by number, so renaming them would orphan the arbitration trail — they are defined here and
nowhere else, and they are not the campaign's letters. **Two different `D` series also meet in this file:** the bare
`D1`..`D9` of the `DoD` section are this document's own commands, while « bound decision Dn » means the arbitration
report's decision `n` (`docs/tests/porte-go-verdicts.md`); where a sentence could be read either way, it says which.

Host, `packages/kybernos-theme/preset-store.mjs`:

```js
export function applyPreset(store, input) // store = createPresetStore({ dir })
// input  = { name, settings, source?, id?, gid?, v?, author? }
// return = { ok: true, id, preset } | { ok: false, error }   — never throws
```

Route, same family, same handler (`handlePresetStore`), extra body branch:

```http
POST /kybernos-theme/preset-store
{ "import": { "name": "…", "settings": { … }, "source": "file" } }   → 200 { ok, preset } | 400 { ok:false, error }
{ "library": { … } }                                                  → unchanged (today's whole-document write)
both keys, or neither                                                → 400 { ok:false, error: "invalid body" }
```

The `import` object's frozen minimum is `name`, `settings`, `source?`. The browser also sends the catalogue link a
gallery theme carries (`gid`, `v`, `author`), which `sanitizePreset` already preserves (`preset-store.mjs:111-113`),
so the disk copy keeps its « installed » link; a host that ignored those three keys would lose only the link, and
unknown keys are dropped by the store (`preset-store.mjs:104`).

Exact browser answer, published by `apply(ctx)` (not by a Settings mount):

```js
window.__KB_THEME_APPLY__(input) // input = a preset id (string) | a settings bag (plain object)
// → Promise<{ ok: true, id } | { ok: false, reason }>   — never throws; its absence degrades the caller
```

Manifest point (`plugin.json`) — the exact existing shape of `packages/kybernos-plugin/plugin.json:30-40`:

```json
"provides": [
  { "name": "theme", "version": "1.0", "kind": "data", "class": "inert", "validator": "builtin",
    "summary": { "en": "A style preset: an accent, a font, corners, colours — tokens only, never CSS." } }
]
```

Point definition, read by `packages/kybernos-registry/registry.mjs:199-210`: owner `kybernos/theme`, `ownerVersion`
`1.0.0`, name `theme`, version `1.0`, `kind: 'data'`, `class: 'inert'`,
`validate(raw, fileId) → { ok, value } | { ok: false, errors }`. `ownerVersion` is the point API's version, not the
bundle's release: a data pack's `requires.plugins: { "kybernos/theme": "^1.0" }` is judged against it
(`registry.mjs:217-220`), which is why it is `1.0.0` like every point owner in the repo (`test-registry.mjs:36-37`).
The bundle's `plugin.json`/`package.json` version stays `0.1.0`: this batch bumps no release.

**The ONE import path (this is the gate's correction; the previous draft left `{ import }` unused).**
An import — a gallery id not yet in the library, or a settings bag — goes through the **host entry**:

1. the browser resolves the input to `{ name, settings, source }` (plus the optional `gid`/`v`/`author` link) and POSTs **exactly one**
   `{ import: … }` to `/kybernos-theme/preset-store` through the existing `libHost` helper
   (`client.js:1926-1934`);
2. the host's `applyPreset` is the **only writer of the disk library from an import**: it sanitizes, refuses accessibility keys,
   derives the id, dedupes and caps;
3. the browser **adopts the host's returned preset** into its own library with `libWrite()`/`libNotify()` — no
   `libSchedulePush()`, no `{ library }` POST from the seam — and applies the host-sanitized settings.

An id already in the browser library (by `id` or by `gid`, `client.js:2141`) is applied **without a POST**: it is not
an import. `libSet`/`libAdd` (`client.js:1964-1968`, `:1983-1989`) remain the Settings › « My styles » edit path and
are not the seam's import. Host off/unreachable/5xx falls back to a local-only record (A1-3): the apply still
succeeds, and the disk convergence is left to the existing `libPull` (`client.js:1947-1962`).

## Interpretations (the request admits several; each choice is argued)

**The registry is reached through `globalThis[Symbol.for('kybernos.registry')]`, not by importing the registry.**
A bundle cannot import another bundle's file: the rule is written in `packages/kybernos-registry/host.mjs:10-11`
(« the host halves of other bundles (they import nothing from each other) »), and the repo's own idiom is the global
(`kybernos-plugin/index.js:10716-10728` at the baseline: the comment, `registrySeam` at `:10718`, the boot-time
`definePoint` at `:10728`). "Read the registry via `registry.definePoint(def)`" is satisfied by that
global, guarded, and told again at each call because mount order is not guaranteed (`registry.mjs:206-209`).

**The a11y refusal applies to published documents, not to the person's own library.**
`contrastMode`, `cbSafe`, `reduceMotion`, `focusRing`, `largeTargets`, `underlineLinks` are the person's own business
(stated at `themes-catalogue.mjs:12-15` and `:57`), and `PRESET_GROUPS.a11y` is part of what a preset retains
(`client.js:1854`). So: the POST import and a settings bag are documents and are REFUSED; a library record applied
by id — the person's own theme, or a validated gallery one — is applied as it is. Refusing it would mean "apply my
own theme" cannot work.

**"Apply" means the non-transient Settings commit, not a trial and not a boot re-apply.**
Merge over the current stored look (`{ ...cur, ...patch }`), `writeState(next)` (which also posts the boot sheet,
`client.js:992-995`), then `appliquerTout(themeSvc, next)` (`client.js:1310-1318`). Not `transient:true` (a trial is
drawn and not stored), not `appliquerBoot` (that also (re)applies the boot transition of a fresh load). Cost,
accepted: an already open Settings page does not redraw live; it shows the applied look on its next mount.

**The seam is published by `apply(ctx)`, plus the versioned alias when the page seam exists.**
The wizard can run with Settings never opened, so a React effect of the Settings page would be too late. The frozen
global is the primary door; when `window.__KB__.version === 1` the same function is also offered as `kybernos/theme`
`1.0.0` (`{ apply }`), following `kybernos-plugin/client.js:26226-26228` and re-offered on the `kybernos:registry`
event. That alias is additive and MAY be omitted; the wizard never depends on it.

**I6 — The identity of an import is a preset id, not a name and not a gallery id.**
`input.id` when it matches `ID_RE` (`preset-store.mjs:26`), else the slug of the name; a gallery import keeps `gid`
for its catalogue link (`client.js:2142`). Ids are what the library dedupes on (`libClean`, `client.js:1906-1915`)
and what `{ ok: true, id }` can return.

**I7 — A pack's `themes/<id>.json` is the light preset document `{ id, name, settings }`, and a full catalogue entry
is accepted as a superset (the gate's reconciliation with A4, ratified by bound decision D2).**
A4's **body** froze the shape: `themes/vet-clinic.json` passes `sanitizePreset` with `{ id, name, settings }` and no
author/description (`A4-starter-docs-strategy.md:251`; `:241`, cited by the previous draft, is the install/preview
loop and never held this). A4's **revised head note** (`A4-starter-docs-strategy.md:12-15`) now says the opposite — a
full catalogue entry — and that reading is **superseded**: bound decision D2 settles it on the body plus this I7, and
`sanitizePreset` drops `description` anyway, so the full entry would lose data silently (the arbitration report's own
reason, `docs/tests/porte-go-verdicts.md:36-39`). The point therefore validates with the store's
`sanitizePreset` (the catalogue's own delegate, `themes-catalogue.mjs:59`) plus the two catalogue-only rules that
matter for a published document: the a11y refusal (`:57-58`) and `id === fileId` (`domain-pack.mjs:67-74`). The
catalogue's author / two-language description / `v` checks are NOT applied to a pack file — a full catalogue entry
still passes because `sanitizePreset` keeps `author`, `gid` and `v` (`preset-store.mjs:111-113`). One validator, one
refusal list for settings and accessibility; the card metadata is a gallery concern, not a pack requirement.

## Anchors verified in this repository (nothing below is quoted from memory)

| Claim | Verified at | Verdict |
|---|---|---|
| Settings vocabulary, **37 keys** (node-counted — the draft's "40" was never the file's) | `preset-store.mjs:43-52` (`SETTINGS_KEYS`) | corrected — see 9 |
| An unknown key is dropped, not obeyed | `preset-store.mjs:104` | exact |
| The store is pure and testable on a temp folder | `preset-store.mjs:136-175` (`createPresetStore` 136-138) | exact |
| The pure request handler | `preset-store.mjs:178-186` (`handlePresetStore`) | 177 is its doc comment |
| The route, the origin guards, the body cap | `preset-store.mjs:194-210` (`servePresetStore`) | exact |
| Route table, preset-store mount | `index.js:81` (`ROUTES`), `index.js:224-226` | exact |
| The host's `apply` is already fully guarded | `index.js:246-261` | exact |
| No extension point declared | `plugin.json` (1-47, no `provides` key) | exact |
| A data point has exactly one of schema and validator | `manifest.mjs:84` | exact |
| `provided` shape (validator must be `"builtin"`, no file) | `packages/kybernos-registry/plugin.schema.json:214-229`; identical copy `docs/dev/schemas/plugin.schema.json` (diff empty) | exact |
| The a11y refusal (refused, not trimmed) | `themes-catalogue.mjs:32` (`A11Y_KEYS`), `:57-58` | exact |
| The catalogue entry shape (for the online catalogue, not the point) | `themes-catalogue.mjs:44-62` (`sanitizeTheme`), `:65-82` (`sanitizeDocument`) | exact |
| A pack's id must be its file name | `packages/kybernos-plugin/domain-pack.mjs:67-74` | exact |
| The point idiom of this repo | `domain-pack.mjs:223-231` (`DOMAIN_POINT`, `validateContribution`) | exact |
| The registry is reached through a global, never an import | `packages/kybernos-registry/host.mjs:10-11`; `kybernos-plugin/index.js:10716-10728` (comment `:10716-10717`, `registrySeam` `:10718`, boot tell `:10728`) | corrected — see 6 |
| `requires.plugins` is judged against the point owner's `ownerVersion` | `registry.mjs:217-220` | exact |
| Every point owner declares `ownerVersion: '1.0.0'` | `packages/kybernos-registry/test-registry.mjs:36-37` | exact |
| `definePoint` shape and idempotence | `registry.mjs:199-210` | exact |
| The folder scan is already generic over points | `registry.mjs:233-253` (`readExtension`), `:277-283` | exact — proven by the probe behind DoD D6 |
| Consent is required for the `instruction` class only | `registry.mjs:274-276` | exact |
| What a preset carries | `client.js:1847-1855` (`PRESET_GROUPS`; its doc comment is `:1846`, not `:1847`) | corrected — see 10 |
| The library's disk door and deferred whole-library push | `client.js:1926-1934` (`libHost`), `:1935-1945` (`libSchedulePush`), `:1964-1968` (`libSet`), `:1983-1989` (`libAdd`) | exact |
| Closest existing "install a catalogue theme" | `client.js:2141-2142` (`galInstalled`, `galInstall`) | exact |
| A gallery theme's a11y keys are stripped on the way in | `client.js:2092-2099` (`galTheme`) | exact |
| A non-transient Settings commit (merge over state) | `client.js:3948-3957` (`commit`), the `appliquerTout` call **inside** it at `:3954` | see correction 3 |
| Applying to the page | `client.js:1310-1318` (`appliquerTout`), `:992-995` (`writeState` also posts the boot sheet) | see correction 3 |
| What `__test` exposes | `client.js:4793-4804` | exact |
| The optional-seam idiom (`__KB__.provide`, guarded, re-offered on an event) | `kybernos-plugin/client.js:26226-26228` (baseline; worktree `:26242-26244`, see the head note) | exact |
| The host-store off switch already exists | `client.js:1573` (`__KB_THEME_HOST_STORE__ !== false`) | exact |
| `gallery.json` is derived, never hand-edited | `scripts/test-themes-catalogue.mjs:6-7` | exact |
| The theme per-field row is marked **next** | `docs/dev/domain-packs.md:108` | exact |
| The starter's theme file is the light `{ id, name, settings }` | `docs/tests/A4-starter-docs-strategy.md:251` (`:241` is the install/preview loop) | corrected — see 8 and 12 |
| The wizard calls the seam with the pack's `theme` string | `docs/tests/A1-kit-wizard-strategy.md:42-47` (the frozen wire), `:49` (the `theme` string only) | corrected — see 12 |

**Corrections to the delegation's context and to the previous draft** (verified, so the spec does not propagate them):

1. `themes-catalogue.mjs:27` is `DEFAULT_URL` (the catalogue address), not the a11y refusal. The refusal is `:32` and
   `:57-58`.
2. `:57-58` is not "the checked-document shape": it is the a11y refusal inside one theme. The document shape is
   `sanitizeDocument` (`:65-82`) and `readDocument` (`:85-90`).
3. **`commit` + `appliquerTout`, corrected again (gate, cycle 2).** The previous draft claimed an implementer who
   greps `client.js:3951-3960` « finds no `appliquerTout` ». **That is false**: the call sits at **`:3954`, inside the
   range** (`if (themeSvc !== null) appliquerTout(themeSvc, next)`, verified at the baseline). What is wrong with
   `3951-3960` is something else: it straddles two functions and is the boundary of neither — `commit` is `:3948-3957`
   and `appliquerTout` is defined at `:1310-1318`. Pin those two, not a window over both.
4. `handlePresetStore` is `:178-186`; `:177` is its doc comment.
5. `test-client.mjs` imports `A11Y_KEYS` at `:27`, not `:26`.
6. **The registry global's citation, re-pinned (gate + bound decision D1).** The rule is `host.mjs:10-11`: the host
   halves of other bundles « import nothing from each other », and the seam is
   `globalThis[Symbol.for('kybernos.registry')]`. The
   repo's idiom is `kybernos-plugin/index.js:10716-10728` at the baseline — the comment at `:10716-10717`,
   `registrySeam` (the global read) at `:10718`, the boot-time `definePoint` at `:10728`. The draft's `10706-10716`
   covered the domain-pack loader and stopped one line short of the seam itself. The rest of the old correction stands:
   `themes-catalogue.mjs:5` is the Suite-archive/signature comment, never the cross-bundle rule.
7. **The import path, fixed (gate).** The previous draft wrote the record through `libSet` and left the `{ import }`
   route unused, contradicting the frozen wire. That wire and the unit criteria now make the host entry the single
   import path, and DoD D7 is a fake-fetch assertion that fails if the seam POSTs `{ library }` or skips the POST.
8. **The pack theme file's shape, reconciled (gate + bound decision D2).** The previous default ("a full catalogue
   entry") contradicted A4's body. I7 now takes the light shape of `A4-starter-docs-strategy.md:251` as the minimum and accepts
   a full entry as a superset; DoD D5 asserts both. Two corrections on top: the citation `:241` the draft used is the
   install/preview loop, not the shape; and A4's **revised head note** (`:12-15`) now argues the full entry, which is
   **superseded** by bound decision D2 (the body plus I7 win), not silently ignored.
9. **The settings vocabulary is 37 keys, not 40.** `SETTINGS_KEYS` (`preset-store.mjs:43-52`) counts **37** by node
   (count the frozen array's string literals); A4 cites the same range (`A4-starter-docs-strategy.md:235`) and never
   claims a count. The number was the draft's.
10. **`PRESET_GROUPS`' doc comment is at `client.js:1846`, not `:1847`** — `:1847` is the `const PRESET_GROUPS = {`
    line itself, `:1846` is « What a theme may retain ».
11. **`session-guard.mjs` is not « the only such door ».** It is copied per bundle: **28 copies** under `packages/`
    at the baseline (29 files match `session-guard`, the 29th being `scripts/test-session-guard.mjs`), and
    `docs/dev/plugin-contract.md:317` already records the plan to make that shared code a versioned service. The lane
    argument is unchanged — this batch adds no auth door — but the citation had to stop claiming a uniqueness that
    the tree contradicts.
12. **The wizard's frozen wire is at `A1-kit-wizard-strategy.md:42-47`, not `:34-40`.** `:42` is the « frozen
    elsewhere, nothing minted here » statement and `:44-47` is the fenced `window.__KB_THEME_APPLY__` block; `:49` is
    where the wizard promises to pass the pack's `theme` string only. `:34-40` holds two measured facts about
    `validatePack` and `onboardingComplete`, plus the interpretations header — it says nothing about the wire.
13. **The four seam defaults are ratified (bound decision D7), so they are no longer open.** See « Settled defaults »
    below: a name taken by the person's own record yields a free name and a suffixed id (the one idempotence
    exception), a settings bag writes a localized « My styles » row, an unreachable host still applies locally, and
    the `source` stays `gallery`/`file`.

None of these changes the intent of the batch; each one changes what a reader would grep, and 9, 11 and 12 change
what a reader would **measure or cite**.

## Settled defaults (bound decision D7 — ratified as written; the owner may veto one in a word)

Bound decision D7 ratifies the five seam defaults as written (`docs/tests/porte-go-verdicts.md:67-74`). Nothing below waits on the
owner any more: each item is an assertion the implementation must make true, and the ids `A1-1`..`A1-4` are kept so
the citations in `A1-kit-wizard` and in the arbitration report still resolve.

**A1-1 — a pack theme whose name is already a theme the person made ("Soigne"): free name, suffixed id, look applied.**
The `me` record is never touched (byte for byte), the import gets a free name ("Soigne (2)") and a suffixed id, and
the look is applied anyway — a wizard that silently fails to apply the sector's look is worse than a second row in
« My styles ». This is the idempotence rule's **one** exception, and the distinction matters to the implementer: the
*same* input applied twice is idempotent (same slug id, one record — DoD D3), while a name colliding with a record of
a **different** id gets the suffix. `{ ok: false, reason: 'name taken' }` stays the one-line fallback if the owner
vetoes.

**A1-2 — a settings bag (no id) does write a « My styles » entry, under a localized default name.**
`{ ok: true, id }` is therefore always meaningful and the person can edit or delete what was applied; the host entry
writes the record, which is what makes this the natural answer. On the Kit side the theme shows as **one
non-interactive note line without a preset name** (bound decision D7): the seam carries an id in and `{ ok, id }` out,
never a display name.

**A1-3 — a host store that cannot be reached is not a failure of applying.**
(a) a **400 refusal** from the host (accessibility key, invalid value, full library) is authoritative →
`{ ok: false, reason }`; (b) **host off/unreachable/5xx** → a local-only record (source `'file'`, no disk copy) and
the apply still succeeds, left to the existing `libPull` convergence (`client.js:1947-1962`); (c) a host answer whose
`preset` fails `presetRecord` → `{ ok: false, reason }`. An onboarding that fails offline would be a regression, which
is why (b) is the ratified reading rather than a question.

**A1-4 — the `source` recorded for a pack theme is the existing vocabulary: `'gallery'` or `'file'`.**
`'gallery'` for a shipped catalogue id, `'file'` for a settings bag and for the offline fallback; the row reads
« from the gallery » / « from a file ». No new value (`'pack'`, `'field'`) in this batch: `SOURCES`
(`preset-store.mjs:27`), `PRESET_SOURCES` (`client.js:1871`) and the gallery rows share that public vocabulary, and the
wording of « Mes styles » is a follow-up (`A5`).

OUT OF SCOPE:

- **The wizard.** Ticking a field, the live miniature, the confirm button and the decision to call the seam once
  belong to `A1-kit-wizard`. This batch exposes the door; it shows nothing and opens no step.
- **The registry's other points.** `skills/`, `teams/`, `automations/` and their per-point validators are
  `A2-registry-points`. `themes/` needs NO registry change: `readExtension` is already generic over points
  (`registry.mjs:233-253`), which DoD D6 proves with the real point — if a reviewer is tempted to patch the registry,
  DoD D6 is the answer.
- **Applying a pack theme that is not in the shipped gallery.** The frozen wire resolves an id from the gallery, the
  library and the preset store, nothing else. A third-party bundle's `themes/<id>.json` is *visible* through the
  point (registry) but this seam does not read the registry contributions to apply it; the two campaign verticals
  put their themes in the shipped gallery (`A3-vertical-content`), which is why the wizard's `theme` id resolves.
  Registry-resolved pack themes are a follow-up, and would add a network read the freeze does not name.
- **Sector content.** `packages/kybernos-plugin/domains/sante.json` is read-only here; the two vertical packs, their
  accent, their theme documents and the mockups validated for them are `A3-vertical-content`. The accent `#1B7F76`
  in the campaign is A3's proposed content, not a fact this batch asserts.
- **`gallery.json` and `catalog/**`.** Derived files (`scripts/test-themes-catalogue.mjs:6-7`), regenerated by
  `A3-vertical-content` with `node scripts/themes-catalogue.mjs build --bump`. Writing them here is a NO-GO, and the
  proof `git diff --quiet -- packages/kybernos-theme/gallery.json catalog/` must stay empty.
- **Docs prose.** `docs/dev/domain-packs.md:108` stays « next » and `docs/dev/plugin-contract.md:539` (« a module's
  manifest carries no `provides` ») becomes stale the day this batch lands: both are `A4-starter-docs`. The DoD does
  not depend on either sentence.
- **A release bump.** `plugin.json`/`package.json` stay `0.1.0` (manifest rule 2 keeps them equal,
  `manifest.mjs:63-66`); `ownerVersion: '1.0.0'` is the point API's version, not a release.
- **The online signed catalogue.** `themes-pubkey.json` has no key today; signing and `catalog/` publication are not
  tested here, and the seam must not depend on the internet to resolve a shipped id (the shipped gallery comes from
  the bundle's own route, `index.js:227-230`).
- **Settings › Thème UI.** No new section, no "from your field" row, no revert button, no change to the nine tabs.
- **New vocabulary.** No new `SETTINGS_KEYS`, no free CSS, no font or wallpaper from a URL, no engine patch
  (`scripts/patches.json` untouched), no `dsh-compat.json` bump (the seam uses `ctx.theme` and the existing route).
- **The field's `accent` override over the preset's accent** (strategy §4.2). The caller pre-merges it into the
  settings object; the seam transports tokens and never invents a colour.

e2e:

**End-to-end on the real surfaces — reported, not gated (a live server is needed).**

- [ ] **E1, the live GUI.** On the signed page (`scripts/live-page.mjs`, signed cookie, never the stale token URL),
      in this order: read `localStorage['kybernos.theme.v1']` and the native DSH mode; `await
      window.__KB_THEME_APPLY__('calcaire')` (a real id in `gallery.json`, accent `#4d7c0f`, mode light); the
      network panel (or the host log) shows **exactly one** POST to `/kybernos-theme/preset-store` whose body has
      `import` and no `library` (the only other POST is the boot sheet, `client.js:992-995`); the disk copy
      `<DSH home>/kybernos/theme-presets.json` gains the record (the host wrote it, not the browser); the accent
      token `--dsw-alias-brand-primary` is on `:root` and is NOT asserted equal to `#4d7c0f` (the engine walks the
      accent up to 3:1, `client.js:139-149` — assert the ratio bound, not the literal); the stored `acc` equals the
      hex case-insensitively; a reload keeps the look before Settings is opened; « Mes thèmes » in Settings › Thème ›
      Partager lists the imported row with the « gallery » source. Then restore the stored look and the native mode
      exactly as found.
- [ ] **E2, a real profile with a data plugin.** In the isolated sandbox only (`scripts/sandbox/setup.sh` then
      `start.sh`, never `:3080`): a fixture package `@acme/vet` (`plugin.json` kind `data`, empty patch,
      `extends: [{ point: "kybernos/theme#theme", dir: "themes" }]`, `requires.plugins: { "kybernos/theme": "^1.0" }`)
      with one good and one a11y theme file. Expect: the Plugins list shows it `ok` without consent, its card reads
      1 contribution / 1 rejected, and `GET /kybernos-registry/contributions?point=kybernos%2Ftheme%23theme` returns
      the good one. DSH started with the theme bundle on; a broken theme file is a line in a list, never a boot stop.
- [ ] **E3, the fault gate.** `node scripts/check-bundle-faults.mjs --only kybernos-theme --faults throw-apply`:
      DSH starts, every other bundle mounts, the theme's routes are the only ones lost, the log names the entry
      (`AGENTS.md` rule 2, extended to the new seam).
- [ ] **E4, no drift in the bundle.** `node scripts/run-all-tests.mjs --only kybernos-theme` → 0 red: `test-client`,
      `test-preset-store`, `test-themes-catalogue`, `test-themes-gallery`, `test-boot-store`, `test-theme-hold`,
      `test-seed-skills`, `test-icon-sets`, `test-loader-store`. These pass today — measured 2026-10-28:
      `--only kybernos-theme` → 9 test files, 9 green, 0 red — so they are a regression gate, not a DoD. Also
      `git diff --quiet -- packages/kybernos-theme/gallery.json catalog/` (derived, untouched here).
- [ ] **E5, the merge gate — with the baseline measured, never assumed (bound decision D8).** Measured 2026-10-28 from
      this worktree: `node scripts/run-all-tests.mjs` → **529 files in 183 s, 521 green, 8 RED**. The 8 are pre-existing,
      none of them is in this batch's perimeter, and each is attributed here rather than waved at, so the merge message
      can name them:
      (a) **`kybernos-log`**, the untracked bundle of the neighbouring session — `test-consistency-guards`
      (`kybernos-log 1 (allowed 0)`), `test-help-mounts`, `test-layout` (×2: no robot name, absent from
      `satellites.json`), `test-readmes`, `test-settings-nav`, plus one of the two `test-no-french-literals` failures;
      (b) **`kybernos-pulse`** declares no `exec` while its host code starts processes (`helper/gen-icon.mjs:9`) —
      `test-plugin-scan`;
      (c) **3 French literals from the uncommitted worktree diff** (`client.js:33803` twice, `index.js:11635`) — the
      other `test-no-french-literals` failure;
      (d) **`test-help`**: 11 modules still have no help-site article (a pre-existing docs gap, unattributed).
      Bound decision D8 counted 6 red and 2 literals when the gate measured it; the measured state today is 8 and 3, and
      this line is the one that has to be true at merge time. The gate itself stays « **0 red** at integration », with
      the 8 above listed as pre-existing and attributed to the owner's tracker — and no command in this document claims
      « all exit 0 » without a run behind it. Also `node scripts/garde-depot.mjs && node scripts/test-lifecycle-engine.mjs
      && node scripts/test-paquet.mjs` before the push.

vision:

**The seam has no screen, so the visible proof is its effect — six captures, each read with `read_image`.**

- [ ] V1/V2 — the app with a neutral look, light and dark, before anything is applied (the control pair).
- [ ] V3/V4 — after `window.__KB_THEME_APPLY__('calcaire')`, light and dark: the accent appears on the primary
      buttons and links, the surfaces take the theme's colours, no flash of the previous look inside one run, and the
      text stays legible (the client's contrast promise is not broken by a preset).
- [ ] V5 — Settings › Thème › Partager, « Mes thèmes »: the imported row with its name and its source label, the
      visual proof that the import landed in the library **and on disk** (the host entry wrote it), not only in the
      page.
- [ ] V6 — a settings bag applied on top (same page, after the id): the look follows the bag's tokens, the values the
      bag does not carry are unchanged (that is what "merge over current state" looks like).
- [ ] Judgement, not only capture: for each pair, say in one line what changed and confirm no element moved layout.
      A capture nobody looked at is not a proof.
- [ ] The native light/dark preference is never changed by an applied preset that carries no `mode`; a preset that
      carries one changes it, and that is stated in the report. Restore both afterwards.

capture:

**Applicable. The artefacts live OUTSIDE the repository (a `mktemp -d` directory), never in git.**

- [ ] `seam-answers.json` — the JSON returned by the global for each case: a shipped id, an unknown id, a settings
      bag, a bag with an a11y key, a library id, a broken local library.
- [ ] `http-import.json` — the exact POST body and the answer for `{ import: … }`, `{ library: … }`, and both
      (400 `invalid body`), plus the a11y refusal through the route.
- [ ] `network.txt` — the seam's own requests, in order: one POST `{ import }` to the preset-store, the boot-sheet
      POST from `writeState`, and **no** `{ library }` POST from the seam. This is the capture of the import path
      described above — the wire this batch builds, `kybernos/theme#theme`.
- [ ] `library-before.json` / `library-after.json` — the disk copy at `<DSH home>/kybernos/theme-presets.json`.
- [ ] `registry-preview.json` — for the E2 fixture: `plugins()` status/extends and `contributions('kybernos/theme#theme')`.
- [ ] `computed-tokens.txt` — `getComputedStyle(document.documentElement)` for `--dsw-alias-brand-primary`,
      `--dsw-alias-bg-base`, `--dsw-radius-md`, plus the measured contrast ratio against layer 1.
- [ ] `console.txt` — the theme bundle's own lines and the registry's `left out:` line for the refused fixture file.
- [ ] The six PNGs of the vision pass, in the same directory; the report quotes the paths, the diff is empty
      (`node scripts/garde-depot.mjs` must stay green: media is an error, `scripts/garde-depot.mjs:11`).

maquette:

**Not applicable, and why.** This batch ships no screen: the seam is a function, the effect is drawn by the existing
page, and Settings › Thème keeps its nine tabs. There is therefore no frame to mock up and no CSS to validate against
a real one. The two neighbouring surfaces have their own maquettes and their own batches: the wizard's Kit step and
its live miniature (`A1-kit-wizard`), and the sector look (`A3-vertical-content`, whose mockups were validated
outside this repository and are not committed — no media in git). If this batch ever grows a visible row, the
maquette requirement comes back with it, and a silent omission would be a NO-GO.

unit:

**The deterministic layer — this is where the batch is actually proven.**

`packages/kybernos-theme/preset-store.mjs`

- [ ] `applyPreset(store, input)` is exported, returns `{ ok: true, id, preset }` or `{ ok: false, error }`, and never
      throws (a throwing `read`/`write` becomes `{ ok: false, error }`).
- [ ] Accepted keys are exactly `SETTINGS_KEYS` (`:43-52`); an unknown key is dropped, not obeyed (`:104`), and the
      answer says nothing about it.
- [ ] Any of the six `A11Y_KEYS` present → `{ ok: false, error: 'accessibility setting: <key>' }`, nothing written,
      no partial import. The refusal happens here as well as in the point, because the host entry is reachable
      without the registry.
- [ ] Identity (I6): `input.id` when it matches `ID_RE` (`:26`), else the slug of the name; deterministic — the same
      input twice returns the same id and leaves exactly ONE record.
- [ ] **The single import path:** `applyPreset` is the only place the disk library grows from an import; the browser
      POSTs `{ import }` and never `{ library }` for it (asserted in the client suite and DoD D7). `libSet` is not
      called by the seam.
- [ ] The person's own work is never replaced, and the ratified exception is the only one (A1-1, bound decision D7):
      after importing a theme whose name is already one of the person's own (`source: 'me'`, a **different** id), that
      record is unchanged byte for byte, the import lands under a free name ("Soigne (2)") with a suffixed id, the look
      is still applied, and no two records share an id. The same input applied twice stays idempotent (same id, one
      record, previous box) — the suffix is not a second idempotence rule, it is the collision case. One assertion,
      because the owner has ratified it; `{ ok: false, reason: 'name taken' }` would replace it in one line if vetoed.
- [ ] A full library (`LIMITS.presets`, `:29`) → `{ ok: false, error: 'library full' }`, count unchanged: the import
      never evicts a theme the person kept.
- [ ] `updatedAt` moves forward on every import (`:131-133`), so the newer-wins rule between the browser copy and the
      disk copy (`:7-8`) still converges.
- [ ] `handlePresetStore` (`:178-186`): `POST { import }` → 200 `{ ok: true, preset }`; `POST { library }` unchanged;
      both keys, or neither, → 400 `invalid body`; `GET`, `DELETE` 405, the 403 origin guard and the 413 body cap
      unchanged (`:181`, `:195-196`, `:202`); the library document written by the route is still
      `sanitizeLibrary`-clean.
- [ ] `A11Y_KEYS` is defined once: it moves to `preset-store.mjs` (the settings vocabulary) and
      `themes-catalogue.mjs` re-exports it. `preset-store.mjs` must not import from `themes-catalogue.mjs`: that would
      be a module cycle, since the catalogue already imports `sanitizePreset` from the store (`themes-catalogue.mjs:19`).
      Criterion: the two imports are the same frozen array, and `node -e "import('./…/preset-store.mjs')"` works.

`packages/kybernos-theme/themes-catalogue.mjs`

- [ ] `THEME_POINT` = `{ owner: 'kybernos/theme', ownerVersion: '1.0.0', name: 'theme', version: '1.0',
      kind: 'data', class: 'inert', validate }`, the shape `registry.definePoint` accepts (`registry.mjs:200-210`) and
      the idiom of `DOMAIN_POINT` (`domain-pack.mjs:229-231`).
- [ ] `validate(raw, fileId)` = the a11y refusal (`A11Y_KEYS`) + `sanitizePreset(raw, () => 0)` + `raw.id === fileId`
      (the rule of `domain-pack.mjs:67-74`), returning `{ ok: true, value }` (a deterministic
      `{ id, name, settings }`, plus `author`/`gid`/`v` when present) or `{ ok: false, errors: [...] }` — never a
      throw, never a partial value.
- [ ] **I7:** a light `{ id, name, settings }` file passes — A4's **body** shape, `A4-starter-docs-strategy.md:251` —
      and a full catalogue entry (author, two-language description, `v`) passes as a superset, which is what bound
      decision D2 ratified against A4's revised head note. The point is NOT `sanitizeTheme`: it does not require card
      metadata, and the test table says so.
- [ ] Each of the six a11y keys is refused with an error naming it (`:58`), refused and not trimmed.
- [ ] The point's settings refusals ARE the catalogue's: one case table, asserted in BOTH copies
      (`packages/kybernos-theme/test-themes-catalogue.mjs` and `scripts/test-themes-catalogue.mjs`), including bad id,
      empty name, a bad value (`acc: 'blue'`), unknown settings dropped, an a11y key refused and `id !== fileId`. The
      catalogue's own card-metadata cases (author, description, `v`) stay in the catalogue's tests and are not
      duplicated as point rules.
- [ ] No second shape check: if a rule is added to `sanitizePreset` or `A11Y_KEYS`, the point inherits it by
      construction (the test table is the same list, not a copy of the code).

`packages/kybernos-theme/plugin.json` and the manifest

- [ ] The `provides` block above is present, with `validator: "builtin"` and NO `schema` (`manifest.mjs:84`); the
      summary is short text (`plugin.schema.json:226`).
- [ ] `manifestErrors(manifest, { firstParty: true, dir: 'kybernos-theme', packageJson, fileExists })` returns `[]`
      — the existing gate stays clean, and `plugin.json`/`package.json` keep the same `0.1.0` (`manifest.mjs:63-66`).
- [ ] No new permission and no new claim: the POST is under the prefix already claimed (`plugin.json:30-41`,
      `manifest.mjs:93-95`); `docs/dev/schemas/plugin.schema.json` untouched and still identical to the bundle's copy.
- [ ] The point is told to the registry at boot and again at each use, through
      `globalThis[Symbol.for('kybernos.registry')]` (`host.mjs:10-11`), guarded; an absent registry, or a `definePoint`
      that throws, leaves `apply(ctx)` succeeding (`index.js:246-261` is the pattern to follow). The re-tell is on
      the bundle's own host surfaces (the preset-store route mount and the gallery route), because the registry may
      mount after this bundle.

`packages/kybernos-theme/client.js`

- [ ] `window.__KB_THEME_APPLY__` exists after `apply(ctx)` and does not exist for a module that was only built —
      published inside `try/catch`, reusing one function so a second call does not replace it.
- [ ] A string id resolves in this order: library record id → library `gid` (`galInstalled`, `:2141`) → gallery theme
      id (`galTheme`, `:2092`, loading the existing gallery route at most once, `galLoad` `:2126`); an unknown id is
      `{ ok: false, reason }` with no throw and no unbounded wait; a shipped id never needs the internet.
- [ ] A settings bag: a11y key → `{ ok: false, reason: 'accessibility setting: …' }` and nothing written; unknown keys
      ignored; a bag with no known key → `{ ok: false, reason }`.
- [ ] **Import path (the single import path above):** a new import POSTs exactly one `{ import: { name, settings, source, [gid], [v], [author] } }`
      through `libHost` (`:1927-1934`) to `/kybernos-theme/preset-store`; the returned `preset` is adopted into the
      local library with `libWrite()`/`libNotify()` and **no** `libSchedulePush()` (no `{ library }` POST); an id
      already in the library (by `id` or `gid`) is applied without a POST. The fake-fetch test asserts the body has
      `import`, no `library`, exactly one preset-store POST (the boot-sheet POST from `writeState` is expected and
      filtered out).
- [ ] Apply semantics (the non-transient commit): merge over `readState()`, `writeState(next)` (which posts the
      boot sheet, `:992-995`), then `appliquerTout(themeSvc, next)` when `ctx.theme` exists (`:1310-1318`); a preset
      without `mode` never calls `setTheme` (the native preference is the person's).
- [ ] Idempotent and non-duplicating: the same id twice → one record, same id; a gallery theme already installed
      (`galInstalled`, `:2141`) is reused; the local adoption replaces by id, never appends a duplicate.
- [ ] A host **400** refusal (a11y, invalid, full) → `{ ok: false, reason }`, nothing adopted, nothing applied; a host
      **unreachable/5xx** → the local fallback applies (A1-3, ratified) and nothing throws; a host answer whose
      `preset` fails `presetRecord` → `{ ok: false, reason }`.
- [ ] A broken local library (`localStorage.setItem` throws, or the record fails `presetRecord`) → `{ ok: false,
      reason }`, no throw, no partial state; the page keeps the look it had.
- [ ] The seam never touches wallpapers, loader animations, menu icons beyond the tokens it carries, or any a11y key.
- [ ] The existing no-drift checks still hold: `PRESET_GROUPS.a11y` ≡ `A11Y_KEYS` (`test-client.mjs:1275`) and
      `PRESET_KEYS` ≡ `SETTINGS_KEYS` (`test-client.mjs:1089`).
- [ ] `test-client.mjs` covers all of the above with its fake `window` (`new Function('window', SOURCE)`), a fake
      theme service (`mkCtx`, `test-client.mjs:80`) and, for the store cases, a fake `fetch` (the pattern already in
      `test-client.mjs:680-757`, `:1193-1268`, `:1320-1418`).

DoD:

**Commands of THIS repository, to be run from its root. Every one of them FAILS today (re-measured 2026-10-28 on a
tree byte-identical to the baseline for this batch's files) — a command that already passes is not listed here; the gates that already pass are in E4/E5 instead.**

D1 — the point is declared, inert, data, validator builtin (fails today: `plugin.json` has no `provides`):

```bash
node -e "const m=require('./packages/kybernos-theme/plugin.json');const ps=Array.isArray(m.provides)?m.provides:[];const p=ps.find(function(x){return x.name==='theme'});if(p===undefined||p.version!=='1.0'||p.kind!=='data'||p.class!=='inert'||p.validator!=='builtin'){console.error('plugin.json: no kybernos/theme#theme 1.0 data/inert point with validator builtin');process.exit(1)}console.log('D1 ok')"
```

D2 — the manifest still passes its own validator with the new block (fails today: the point is not declared):

```bash
node --input-type=module -e "import{manifestErrors}from'./packages/kybernos-registry/manifest.mjs';import{readFileSync,existsSync}from'node:fs';const d='./packages/kybernos-theme/';const m=JSON.parse(readFileSync(d+'plugin.json','utf8'));const pkg=JSON.parse(readFileSync(d+'package.json','utf8'));const e=manifestErrors(m,{firstParty:true,dir:'kybernos-theme',packageJson:pkg,fileExists:function(r){return existsSync(d+r)}});if(e.length>0){console.error('manifestErrors: '+e.join('; '));process.exit(1)}if((m.provides||[]).some(function(p){return p.name==='theme'})===false){console.error('the theme point is not declared');process.exit(1)}console.log('D2 ok')"
```

D3 — the host entry: unknown keys dropped, a11y refused, idempotence, the cap, never throws (fails today:
`applyPreset` is not exported):

```bash
node --input-type=module -e "import*as M from'./packages/kybernos-theme/preset-store.mjs';import{mkdtempSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';if(typeof M.applyPreset!=='function'){console.error('applyPreset is not exported by preset-store.mjs');process.exit(1)}const dir=mkdtempSync(join(tmpdir(),'a1-dod-'));try{const s=M.createPresetStore({dir});const one=M.applyPreset(s,{name:'Soigne',settings:{acc:'#4d7c0f',evil:1}});if(one.ok!==true||one.preset.settings.evil!==undefined||one.preset.settings.acc!=='#4d7c0f'){console.error('unknown key not dropped or accent lost',one);process.exit(1)}const bad=M.applyPreset(s,{name:'A11y',settings:{acc:'#112233',cbSafe:true}});if(bad.ok!==false){console.error('an accessibility key was accepted');process.exit(1)}const again=M.applyPreset(s,{name:'Soigne',settings:{acc:'#4d7c0f'}});const l=s.read().library;if(again.ok!==true||again.id!==one.id||l.presets.filter(function(p){return p.id===one.id}).length!==1){console.error('the import is not idempotent',again);process.exit(1)}const boom={read:function(){throw new Error('boom')},write:function(){throw new Error('boom')}};const b=M.applyPreset(boom,{name:'X',settings:{acc:'#112233'}});if(b.ok!==false){console.error('a throwing store was not turned into {ok:false}',b);process.exit(1)}s.write({presets:Array.from({length:M.LIMITS.presets},function(_,i){return{id:'u-'+i,name:'n'+i,settings:{mode:'dark'}}}),updatedAt:1});const full=M.applyPreset(s,{name:'One too many',settings:{acc:'#112233'}});if(full.ok!==false||s.read().library.presets.length!==M.LIMITS.presets){console.error('a full library was accepted or evicted',full);process.exit(1)}}finally{rmSync(dir,{recursive:true,force:true})}console.log('D3 ok')"
```

D4 — the route branch, the a11y refusal and the old body still works (fails today: `{ import }` is a 400
`invalid body`):

```bash
node --input-type=module -e "import{mkdtempSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{createPresetStore,handlePresetStore}from'./packages/kybernos-theme/preset-store.mjs';const dir=mkdtempSync(join(tmpdir(),'a1-dod-'));try{const s=createPresetStore({dir});const i=handlePresetStore(s,{method:'POST',body:{import:{name:'Soigne',settings:{acc:'#4d7c0f'}}}});if(i.status!==200||i.body.ok!==true||i.body.preset.settings.acc!=='#4d7c0f'){console.error('POST { import } not handled',i);process.exit(1)}const a=handlePresetStore(s,{method:'POST',body:{import:{name:'A11y',settings:{acc:'#112233',cbSafe:true}}}});if(a.status!==400){console.error('POST { import } with an a11y key is not a 400',a);process.exit(1)}const legacy=handlePresetStore(s,{method:'POST',body:{library:{presets:[],updatedAt:2}}});if(legacy.status!==200){console.error('POST { library } broken',legacy);process.exit(1)}const both=handlePresetStore(s,{method:'POST',body:{library:{presets:[]},import:{name:'x',settings:{acc:'#112233'}}}});if(both.status!==400){console.error('library+import accepted',both);process.exit(1)}}finally{rmSync(dir,{recursive:true,force:true})}console.log('D4 ok')"
```

D5 — the point is the settings rules, `A11Y_KEYS` is one shared list, and the light A4 shape passes while a full
entry stays a superset (fails today: no `THEME_POINT`, no `A11Y_KEYS` in the store):

```bash
node --input-type=module -e "import*as M from'./packages/kybernos-theme/themes-catalogue.mjs';import*as S from'./packages/kybernos-theme/preset-store.mjs';const H=S.A11Y_KEYS,C=M.A11Y_KEYS,P=M.THEME_POINT;if(P===undefined||typeof P.validate!=='function'){console.error('THEME_POINT is not exported by themes-catalogue.mjs');process.exit(1)}if(H===undefined||C===undefined||H!==C){console.error('A11Y_KEYS is not one shared frozen list');process.exit(1)}if(P.owner!=='kybernos/theme'||P.name!=='theme'||P.version!=='1.0'||P.kind!=='data'||P.class!=='inert'||P.ownerVersion!=='1.0.0'){console.error('THEME_POINT has the wrong shape',P);process.exit(1)}const light={id:'soigne',name:'Soigne',settings:{mode:'light',acc:'#4d7c0f',evil:1}};const a=P.validate(light,'soigne');if(a.ok!==true||a.value.id!=='soigne'||a.value.settings.evil!==undefined||a.value.settings.acc!=='#4d7c0f'){console.error('a light theme file (A4 shape) was refused or not cleaned',a);process.exit(1)}const full={id:'soigne',v:1,name:'Soigne',author:'Acme',description:{fr:'Sobre.',en:'Plain.'},settings:{mode:'light',acc:'#4d7c0f'}};if(P.validate(full,'soigne').ok!==true){console.error('a full catalogue entry was refused by the point (it must be a superset)');process.exit(1)}for(const k of C){const r=P.validate({...light,id:'a11y',settings:{mode:'light',[k]:k==='contrastMode'?'max':true}},'a11y');if(r.ok!==false){console.error('accessibility key accepted: '+k);process.exit(1)}}if(P.validate(light,'autre').ok!==false){console.error('id not equal to the file name was accepted');process.exit(1)}if(P.validate({...light,settings:{acc:'blue'}},'soigne').ok!==false){console.error('an invalid setting value was accepted');process.exit(1)}if(P.validate({...light,name:' '},'soigne').ok!==false){console.error('an empty name was accepted');process.exit(1)}console.log('D5 ok')"
```

D6 — a data plugin's `themes/` folder is read through the real point, without consent, and a bad file is reported
(fails today: no `THEME_POINT`):

```bash
node --input-type=module -e "import*as M from'./packages/kybernos-theme/themes-catalogue.mjs';import{mkdtempSync,mkdirSync,writeFileSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{createRegistry}from'./packages/kybernos-registry/registry.mjs';if(M.THEME_POINT===undefined){console.error('THEME_POINT is not exported by themes-catalogue.mjs');process.exit(1)}const d=mkdtempSync(join(tmpdir(),'a1-chain-'));try{const pkg=join(d,'profile','node_modules','@acme','vet');mkdirSync(join(pkg,'themes'),{recursive:true});writeFileSync(join(d,'profile','package.json'),JSON.stringify({name:'profile',dependencies:{'@acme/vet':'file:'+pkg},dsh:{profile:{bundles:['@acme/vet']}}}));writeFileSync(join(pkg,'package.json'),JSON.stringify({name:'@acme/vet',version:'1.0.0',dsh:{bundle:{patch:'./cordis.patch.yml'}}}));writeFileSync(join(pkg,'cordis.patch.yml'),'[]\n');writeFileSync(join(pkg,'plugin.json'),JSON.stringify({contract:1,id:'acme/vet',kind:'data',version:'1.0.0',name:{en:'Vet'},description:{en:'A clinic'},author:{id:'acme',name:'Acme'},license:'CC-BY-4.0',pricing:'free',requires:{kybernos:'^0.1',plugins:{'kybernos/theme':'^1.0'}},extends:[{point:'kybernos/theme#theme',range:'^1.0',dir:'themes'}]}));writeFileSync(join(pkg,'themes','soigne.json'),JSON.stringify({id:'soigne',name:'Soigne',settings:{mode:'light',acc:'#4d7c0f'}}));writeFileSync(join(pkg,'themes','trop.json'),JSON.stringify({id:'trop',v:1,name:'Trop',author:'Acme',description:{fr:'Trop.',en:'Too much.'},settings:{mode:'dark',cbSafe:true}}));const r=createRegistry({profileDir:join(d,'profile'),stateFile:join(d,'state.json')});r.definePoint(M.THEME_POINT);const ps=r.plugins();const c=r.contributions('kybernos/theme#theme');const x=ps[0]===undefined?undefined:ps[0].extends[0];if(ps.length!==1||ps[0].status!=='ok'||ps[0].consented!==false){console.error('the data plugin is not ok without consent',JSON.stringify(ps));process.exit(1)}if(x===undefined||x.contributions!==1||x.rejected.length!==1){console.error('the good theme file was not read or the bad one not rejected',JSON.stringify(x));process.exit(1)}if(c.length!==1||c[0].value.id!=='soigne'||c[0].value.settings.acc!=='#4d7c0f'){console.error('the good contribution is not the cleaned preset',JSON.stringify(c));process.exit(1)}console.log('D6 ok')}finally{rmSync(d,{recursive:true,force:true})}"
```

D7 — the browser seam is imported through the host entry, with a fake fetch: one POST `{ import }` to the
preset-store, no `{ library }` POST, and the answer carries the host's id (fails today: the global is absent):

```bash
D=$(mktemp -d)
cat > "$D/d7.mjs" <<'JS'
import { readFileSync } from 'node:fs'
const SOURCE = readFileSync('./packages/kybernos-theme/client.js', 'utf8')
const store = new Map()
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) }
const el = () => ({ style: {}, dataset: {}, textContent: '', remove() {}, setAttribute() {}, getAttribute() { return null } })
globalThis.document = { readyState: 'complete', head: { append() {} }, body: { prepend() {}, contains() { return false } }, createElement: el, querySelectorAll: () => [], addEventListener() {} }
globalThis.MutationObserver = class { observe() {} }
let def
const win = { __ModuleLoader__: { load: (d) => { def = d } } }
new Function('window', SOURCE)(win)
const React = { createElement: (...a) => ({ a }), Fragment: 'F' }
const modele = def.factory(() => React)
const posts = []
globalThis.fetch = async (url, init) => {
  if (init && init.method === 'POST') { posts.push({ url: String(url), body: JSON.parse(init.body) }); return { ok: true, json: async () => ({ ok: true, preset: { id: 'host-id', name: 'Imported', settings: { acc: '#112233' } } }) } }
  return { ok: true, json: async () => ({ ok: true, library: null }) }
}
const ctx = { theme: { overrideTokens() { return () => {} }, setTheme() {}, getTheme: () => ({ preference: 'light' }) }, locale: { getLocale: () => ({ active: 'en' }), bind: () => (k) => k }, effect: (fn) => fn(), on: () => () => {}, slots: { inject: (s, fn) => { fn(); return () => {} }, register: () => ({}) } }
modele.apply(ctx)
if (typeof win.__KB_THEME_APPLY__ !== 'function') { console.error('D7: window.__KB_THEME_APPLY__ is not published'); process.exit(1) }
const r = await win.__KB_THEME_APPLY__({ acc: '#112233' })
const ps = posts.filter((p) => p.url.indexOf('/preset-store') >= 0)
const one = ps.length === 1
const isImport = one && ps[0].body !== null && typeof ps[0].body === 'object' && ps[0].body.import !== undefined && ps[0].body.library === undefined
const noLibrary = posts.every((p) => p.body === null || typeof p.body !== 'object' || p.body.library === undefined)
const ok = r !== null && typeof r === 'object' && r.ok === true && r.id === 'host-id' && one && isImport && noLibrary
if (!ok) { console.error('D7: the seam did not import through exactly one POST { import } to the preset-store route', JSON.stringify({ r, posts })); process.exit(1) }
console.log('D7 ok')
process.exit(0)
JS
node packages/kybernos-theme/test-client.mjs >/dev/null && node "$D/d7.mjs"
r=$?
rm -rf "$D"
[ "$r" -eq 0 ]
```

D8 — the catalogue rules are asserted in BOTH copies, and both stay green (fails today: no `THEME_POINT` in either):

```bash
grep -q "THEME_POINT" packages/kybernos-theme/test-themes-catalogue.mjs && grep -q "THEME_POINT" scripts/test-themes-catalogue.mjs && node scripts/run-all-tests.mjs --only test-themes-catalogue
```

D9 — the store's own suite covers the new entry (fails today: no `applyPreset` in the test file):

```bash
grep -q "applyPreset" packages/kybernos-theme/test-preset-store.mjs && node packages/kybernos-theme/test-preset-store.mjs
```

Notes on how these are read. DoD D3, D5 and D6 are behavioural on purpose: they fail today for the right reason (a
missing export), and they can only pass by implementing the contract, not by adding a string to a file. DoD D7 is the
gate's discriminator: it is a fake-fetch assertion, not a grep — it fails today because the global is absent, and it
would fail an implementation that wrote the disk copy through `{ library }` or skipped the host entry. DoD D8 and D9 pair
a presence check with the existing suite because the batch adds no test file (the nine files of the batch are fixed)
— the presence check is what fails today; the suite run is what keeps it honest afterwards. All nine were re-measured
on 2026-10-28 against a tree byte-identical to the baseline for this batch's files, and each fails for the reason its
line states. The four seam defaults are ratified (A1-1..A1-4, bound decision D7) and change no DoD command: each fixes
exactly one unit checkbox (a free name and a suffixed id; a stored « My styles » row; a local success when the host is
unreachable; the existing `gallery`/`file` vocabulary), so a veto lands as a one-line edit, not as a rewrite.

## Acceptance note

The checkboxes are the review grid. A box is closed by a test or by a capture, never by a comment; a closed box whose
test lives only in a throw-away script is an open box. The four seam defaults are **ratified** (A1-1..A1-4, bound
decision D7), so nothing in this document waits on a decision any more: they fix the wizard's failure path in
`A1-kit-wizard` and what the person sees in « Mes thèmes », and the owner may still veto one in a word. I7 is settled by
bound decision D2 on A4's **body** (`A4-starter-docs-strategy.md:251`) — the light shape is the minimum, a full entry
passes as a superset — so the implementation and the starter template agree in this cycle; A4's head note reading it the
other way is superseded and is A4's own correction to make.
