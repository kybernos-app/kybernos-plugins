> **This batch is the rename the six other notes announce.** `A1-kit-wizard`, `A1-theme-seam`,
> `A2-pack-format`, `A2-registry-points`, `A3-vertical-content` and `A4-starter-docs` each carry the
> line « code paths stay unchanged (`packages/kybernos-theme`, `theme-presets.json`) until the
> product-rename batch (kybernos-theme → kybernos-style) lands ». A5-style-rename **is** that batch:
> it lands LAST, after those six, and it deletes their six notes as part of its own perimeter.
> After A5 the visual layer is the **style** everywhere a person can read it, and the installable
> sector unit stays the **theme** (owner naming decision, 2026-10-28, authoritative).

# A5-style-rename — test strategy, written before the code

Batch: **A5-style-rename** — *the visual-layer package and every user-facing label become "style"*.
No behaviour change: same tokens, same 37 settings keys (`SETTINGS_KEYS`, node-counted at
`preset-store.mjs:43-52`), same library, same routes, same data.

**baseline: `2ac67fb4`** (`dev`-lineage branch `feature/vertical-bundles-phase-a`, 2026-10-28). Every
number, path and `file:line` below is read **at that commit** (`git show 2ac67fb4:<path>`), never in
the moving worktree; nothing is quoted from memory, and every command in `DoD:` was run today and
fails for the reason stated. **Worktree drift, measured 2026-10-28:** three files this document
mentions carry uncommitted edits, and exactly one anchor moves among them —
`packages/kybernos-plugin/client.js` (+133/−7) puts `KB_NAV_KEYS` at `:3021` where the base has
`:3005-3006`, which is why the anchor below is written against the base; the other two
(`docs/tests/A2-pack-format-strategy.md` and `docs/etudes/2026-10-27-sector-packs-strategy.md`) move no
line anchored here, but they are what makes `git grep -w kybernos-theme` return **350** occurrences in
the worktree against **348** at the base. Re-pin those two numbers when the implementation starts.

**Lane: B — standard.** The lane rule is « A as soon as a single file of the batch touches auth,
billing, RLS, migrations or secrets ». Nothing here does: the batch renames a directory, strings and
list entries; it writes no schema, no permission, no secret, no money path. `dsh-compat.json` is not
touched, `scripts/patches.json` is not touched, no engine file is touched. **Escalation clause:**
the batch becomes lane A the moment the owner arbitrates AMBIGUITY A5-1 or A5-4 in favour of
the alternative — both of those alternatives are a *migration of an installed profile or of the
person's on-disk library*, which is exactly the "migrations" word of the lane rule. The default
readings of A5-1 and A5-4 are chosen so that the batch stays lane B; that is not an accident, it is
the reason the defaults are those ones.

## The ordering constraint — A5 runs LAST, and this is not a preference

The write perimeter overlaps `A1-theme-seam` on `packages/kybernos-theme/preset-store.mjs`: A1
rewrites that file's contents (`applyPreset`, the `{ import }` branch) while A5 *moves* it. Two
consequences, both mechanical:

1. a rename merged before A1 makes A1's diff unmergeable (its hunks address a path that no longer
   exists), so one of the two batches is re-done by hand;
2. A1, A2, A3 and A4 all cite `file:line` anchors inside `packages/kybernos-theme/`
   (`A1-theme-seam-strategy.md` alone cites `preset-store.mjs:26`, `:43-52`, `:104`, `:136-175`,
   `:194-210`). A move silently invalidates all of them — the anchors are not wrong, they are
   *elsewhere*, which is worse for a reader.

So the sequencing is enforced, not documented: **the branch does not start** until this returns 0,
and it fails today (measured: exit 1, no `applyPreset`, no `THEME_POINT`, no `provides`):

```bash
grep -q 'export function applyPreset' packages/kybernos-theme/preset-store.mjs && \
grep -q 'THEME_POINT' packages/kybernos-theme/themes-catalogue.mjs && \
grep -q '"provides"' packages/kybernos-theme/plugin.json
```

The same three markers are checked again on the **new** path by D6: a rename that loses a file
(the class of accident a `git mv` plus a stale `.gitignore` produces) is caught there, not by a
reviewer's eye.

## What the rename is, exactly — the frozen contract of this batch

Two lists. The first is renamed, the second is deliberately **not** renamed, and that split *is* the
batch: **rename identity, keep state**.

### Renamed (identity — every string that names the module)

| What | Today | After | Anchors |
|---|---|---|---|
| Directory | `packages/kybernos-theme/` | `packages/kybernos-style/` | the tree itself (17 tracked files mention the name) |
| `package.json` `name` | `@local/kybernos-theme` | `@local/kybernos-style` | `packages/kybernos-theme/package.json:2` |
| Manifest `id` | `kybernos/theme` | `kybernos/style` | `packages/kybernos-theme/plugin.json:3` |
| Manifest `package` | `@local/kybernos-theme` | `@local/kybernos-style` | `plugin.json:22` |
| Route permission | `host.routes:/kybernos-theme:write` | `host.routes:/kybernos-style:write` | `plugin.json:33` |
| Route claim | `/kybernos-theme` | `/kybernos-style` | `plugin.json:38-40` |
| Cordis entry | `id: kybernos-theme`, `name: '@local/kybernos-theme'` | same with `style` | `cordis.patch.yml:2-3` |
| Route table | `ROUTES` under `/kybernos-theme/*` | `/kybernos-style/*` | `index.js:81` |
| Log prefix | `[kybernos-theme] …` | `[kybernos-style] …` | `index.js:83` |
| Client manifest in page | `id: '@local/kybernos-theme'`, `dataset.plugin` | same with `style` | `client.js:20`, `:61` |
| Settings section id | `id: 'kybernos-theme'` | `id: 'kybernos-style'` | `client.js:4897-4899` |
| Settings tab label | `kbthLabel('Thème', 'Theme')` | `kbthLabel('Style', 'Style')` | `client.js:4898` |
| Library label | `say('Mes thèmes', 'My looks')` | `say('Mes styles', 'My styles')` | `client.js:3774` |
| Library sentences | « saved in My themes » | « saved in My styles » | `client.js:3759`, `:4030` |
| Help id | `{ id: 'kybernos-theme' }` (must equal the dir) | `{ id: 'kybernos-style' }` | enforced by `scripts/test-help.mjs:120` |
| Suite catalogue row | `id` / `nom` / `titre: "Theme"` | `kybernos-style` / `@local/kybernos-style` / `"Style"` | derived into `packages/kybernos-hub/catalog.json:450` |
| Suite page map | `'kybernos-theme': 'kybernos-theme'` | `'kybernos-style': 'kybernos-style'` | `packages/kybernos-hub/client.js:1000`, icon key `:972` |
| Nav key map | `'kybernos-theme': 'theme'` | `'kybernos-style': 'style'` | `packages/kybernos-plugin/client.js:3006` (table opens `:3005`) |
| The four lists | `lifecycle-packages.json`, `satellites.json` (bundle + `ordre_montage`), `i18n-french-allow.json`, `consistency-baseline.json` | `style` in all four | `scripts/lifecycle-packages.json:17-18`; `docs/beta/satellites.json:32-33`, `:477`; `scripts/i18n-french-allow.json:90`; `scripts/consistency-baseline.json:9`, `:88` |
| Route guard exceptions | `bundle: 'kybernos-theme'`, `/kybernos-theme/*` | `style` | `scripts/route-guard-exceptions.mjs:66` |
| Hot-file reservation list | `packages/kybernos-theme/client.js` | new path | `packages/kybernos-sessions/garde.mjs:111` |
| Catalogue builder | `SHIPPED` / `KEYS_FILE` paths | new path | `scripts/themes-catalogue.mjs:27-28` |
| Docs | README row, licence notice, 3 dev pages, 6 sibling naming notes | `style` | `README.md:59`; `THIRD_PARTY_LICENSES:7`; `docs/dev/theme-gallery.md:6,12,15,61,84-85`; `docs/dev/live-testing.md:628,659,685,687`; `docs/dev/skeleton-screens.md:55`; `docs/etudes/2026-10-27-sector-packs-strategy.md:15`; the note at line 4 of the six sibling specs |

### Kept (state and public wire — the reason this is not a migration)

| What | Where | Why it stays |
|---|---|---|
| `localStorage` keys `kybernos.theme.v1`, `kybernos.theme.loader.v1`, `kybernos.theme.presets.v1` | `client.js:884`, `:1397-1398`, `:1873` | renaming them silently wipes the person's look, loaders and style library |
| `<DSH home>/kybernos/theme-presets.json` | `preset-store.mjs:25` (`FILE_NAME`) | the person's saved styles on disk; renaming it = a data migration |
| `loader-settings.json`, `loading-text.json`, `loaders/` | `loader-store.mjs:335-337` | idem |
| `gallery.json`, `themes-pubkey.json`, catalogue kind `kybernos-themes`, `DEFAULT_URL` | `themes-catalogue.mjs:21`, `themes-gallery.mjs`, `scripts/themes-catalogue.mjs:27-28` | the kind is covered by the Ed25519 signature of a published document; renaming it invalidates every signed artefact |
| `catalog/themes/**` bytes, `packages/kybernos-theme/gallery.json` bytes | derived, signed | not this batch's to regenerate (nothing in the rename changes a style) |
| Browser globals `__KB_THEME_*` (incl. `__KB_THEME_APPLY__`) and `window.__KB_THEME_HOST_STORE__` | frozen by `A1-theme-seam` (`docs/tests/A1-theme-seam-strategy.md:29-53`: the `applyPreset` / `{ import }` host seam, the `__KB_THEME_APPLY__` browser answer, the `kybernos/theme#theme` point it declares) | a public seam frozen by a sibling batch; renaming it *is* a behaviour change |
| CSS class prefix `kbth`, the 37 `SETTINGS_KEYS`, every token | `client.js` CSS, `preset-store.mjs:43-52` | `kbth` is a stylesheet prefix, not the module name; renaming it would redraw nothing and break `consistency-baseline.json`'s keys |

## The perimeter is 81 files, and it is honest to say so

Measured with `git grep` on tracked files only (worktrees under `.claude/worktrees/` are not in the
tree and are not counted):

| Area | Files mentioning `kybernos-theme` |
|---|---|
| `packages/kybernos-theme/**` (the moved tree) | 17 |
| `packages/**` outside the tree | 20 |
| `scripts/**` | 30 |
| `docs/**` | 12 |
| `README.md`, `THIRD_PARTY_LICENSES` | 2 |
| **Total** | **81 files, 351 raw occurrences** |

Word-anchored (`git grep -w`), which is the only honest unit here because `kybernos-themes` — the
signed catalogue **kind** at `themes-catalogue.mjs:21` and `gallery.json:3` — contains the old name
as a prefix and must NOT change: **79 files, 348 occurrences**. That is the number D5 must drive to
zero, and the three files (`gallery.json`, `themes-catalogue.mjs`, `themes-gallery.mjs`) where
`kybernos-themes` survives are the exact reason the gate is word-anchored rather than a substring
match. A substring gate would force a rename of the signed catalogue kind and break the trust chain
— an example of the gate itself being the bug.

## Interpretations (the request admits several; each choice is argued, none is silent)

**Label hygiene, first.** `I1`-`I7` below are **local to this document** — readings of this batch's
request, not the campaign's interface letters, which are retired campaign-wide (bound decision D3,
`docs/tests/porte-go-verdicts.md:40-43`): they were overloaded, three specs said so independently, and
no file under `docs/` defined one list. No cross-batch wire is cited by a letter here; where this
document used to write « `A1-theme-seam` I1/I5 », it now cites the seam on disk
(`docs/tests/A1-theme-seam-strategy.md:29-53`) and the point id `kybernos/theme#theme`, which is
checkable in `plugin.json`.

**I1 — Rename identity, keep state.** The split table above. The argument is not aesthetic: a
rename that also rewrites `kybernos.theme.v1`, `theme-presets.json` and the catalogue kind is a
*migration* of data the person owns, which (a) makes the batch lane A, (b) cannot be proven by the
unit layer alone, and (c) can lose a library when it goes wrong. The owner asked for a rename, not a
migration; anything that moves stored bytes is therefore out unless the owner says so (A5-1, A5-4).

**I2 — The id derives from the directory by the table of `plugin-contract.md` §4.3, so it is
`kybernos/style`, not `kybernos/kybernos-style`.** `docs/dev/plugin-contract.md:180` maps
`dir kybernos-<x>` → `id kybernos/<x>`; the manifest today already follows it (`id: kybernos/theme`
for `packages/kybernos-theme`, `plugin.json:3`). The same line also says « Directory names are kept,
French ones included … no rename in this contract » — A5 does not contradict it: §4.3 forbids
renaming the *other 41* modules, and this one rename is the owner's 2026-10-28 decision recorded in
`docs/etudes/2026-10-27-sector-packs-strategy.md:9-15`. The spec states it because a reviewer will
otherwise read the rename as a contract violation.

**I3 — The route prefix and the Settings section id are renamed with the package.** Both are derived
from the module's name today (`plugin.json:33,38-40`; `client.js:4897-4899`), and both sides of
every route live in this repository (the client builds its URLs from `document.baseURI` with
hard-coded fallbacks, `client.js:1108`, `:1574`, `:1647`, `:1926`). Keeping `/kybernos-theme/*` under
a package called `kybernos-style` would make the DoD grep impossible to state (see the perimeter
table) and would leave the Suite's page map reading `'kybernos-style': 'kybernos-theme'`
(`kybernos-hub/client.js:1000`). Accepted cost, stated so nobody discovers it later: a browser tab
running the pre-rename client posts its boot sheet to `/kybernos-theme/boot` after the upgrade and
gets a 404 until the page is reloaded; the look is one F5 away, never lost (the disk copy is intact).
The alternative — rename only the package — is A5-2.

**I4 — "Style" is the label in both languages.** The page helper is a `[fr, en]` pair
(`client.js:4898`, `kbthLabel` at `:4811`); French « Style » is the same word, so the pair is
`('Style', 'Style')`. This does not need a French-literal exemption: a pair helper is a dictionary
by the rule the gate itself asserts (`scripts/test-no-french-literals.mjs:159`), and the allow-list
key only has to follow the directory rename (`:131-137`, `i18n-french-allow.json:90`).

**I5 — "My styles" names the library; the skin gallery keeps its own wording for now.** The page
already says « les N styles » for the *skins* (`client.js:3478`) and « Plus de styles : la galerie »
(`:3479`), while the library says « Mes thèmes » (`:3774`). Renaming the library to « Mes styles »
puts two different objects under one word on one page. The default is to do exactly what the naming
decision names and leave the skins alone (renaming them is vocabulary work with no rename in it, and
it is not in the batch's objectif), but the collision is real and is A5-3 — the owner may prefer
« looks/ambiances » for the skins in a follow-up.

**I6 — The Suite catalogue is derived, so it is regenerated, never hand-edited.**
`scripts/build-catalog.mjs:1-8` says so in its own header, and `--check` (line 4) exits 1 on a stale
file. A5 therefore edits the three sources (`lifecycle-packages.json`, `satellites.json`, each
`plugin.json`) and runs `node scripts/build-catalog.mjs`; a hand-edited `catalog.json` would pass a
diff review and then be overwritten by the next build. D3 is that rule as a command.

**I7 — The 30 `scripts/**` references are path references, and the suite is their safety net.**
`packages/kybernos-plugin/test-menu-icons.mjs:32` reads `../kybernos-theme/client.js`;
`scripts/test-paquet.mjs:78` lists the twelve bundles; the live checks pause URLs matching
`*/kybernos-theme/*` (`docs/dev/live-testing.md:687` names the mechanism). None of them is a decision —
they are a mechanical consequence of I3, and `node scripts/run-all-tests.mjs` fails on each one that is
forgotten. That is why D10 (the suite) is the batch's real floor and D5 (the grep) is its map.

## Anchors verified in this repository (nothing below is quoted from memory)

| Claim | Verified at | Verdict |
|---|---|---|
| The manifest id follows `kybernos/<dir>` | `docs/dev/plugin-contract.md:180` | exact |
| The id today | `packages/kybernos-theme/plugin.json:3` (`"id": "kybernos/theme"`) | exact |
| The package name today | `packages/kybernos-theme/package.json:2` | exact |
| Route permission and claim | `plugin.json:33`, `:38-40` | exact |
| Cordis entry id and name | `packages/kybernos-theme/cordis.patch.yml:2-3` | exact |
| Route table, log prefix, mount labels | `index.js:81`, `:83`, `:205`, `:223-234` | exact |
| Settings section: id, order, label | `client.js:4897-4899` | exact |
| The label helper is a `[fr, en]` pair | `client.js:4811` (`kbthLabel`) | exact |
| Library label and its two sentences | `client.js:3774`, `:3759`, `:4030` | exact |
| The skins already use the word « styles » | `client.js:3478-3479` | exact — see A5-3 |
| The identity the page carries | `client.js:20`, `:61` | exact |
| Data file name is the store's own constant | `preset-store.mjs:25` (`FILE_NAME`) | exact |
| Storage keys | `client.js:884`, `:1397-1398`, `:1873` | exact |
| Loader file names | `loader-store.mjs:335-337` | exact |
| The signed catalogue kind | `themes-catalogue.mjs:21`, `packages/kybernos-theme/gallery.json:3` | exact — must NOT change |
| The published catalogue URL | `themes-catalogue.mjs:27` (`DEFAULT_URL`) | exact — must NOT change |
| The builder's two hard-coded paths | `scripts/themes-catalogue.mjs:27-28` | exact |
| The catalogue is derived, `--check` exists | `scripts/build-catalog.mjs:1-8` (flag at `:4`) | exact |
| The manifest validator used by the builder | `scripts/build-catalog.mjs:221` (`manifestErrors`) | exact — `[]` on the bundle today, measured |
| Suite page map keyed by directory | `packages/kybernos-hub/client.js:1000`, icon map `:972` | exact |
| Nav keys keyed by **section id** | `packages/kybernos-plugin/client.js:3005-3006` | exact at the base (the worktree's `:3021-3022` is the same table, shifted +16 lines) |
| The help id Must equal the directory | `scripts/test-help.mjs:108-120` (`m[1] !== d` is `wrong`) | exact |
| Nav label must equal the Suite card title | `scripts/test-settings-names.mjs:27`, `:64-78` | exact |
| Bundle/page/name lockstep over four structures | `scripts/test-layout.mjs:15`, `:47`, `:53-56` | exact |
| The four lists | `scripts/lifecycle-packages.json:17-18`; `docs/beta/satellites.json:32-33`, `:477`; `scripts/i18n-french-allow.json:90`; `scripts/consistency-baseline.json:9`, `:88` | exact |
| Route guard exceptions name the bundle and its paths | `scripts/route-guard-exceptions.mjs:66` | exact |
| The hot-file reservation list holds the client path | `packages/kybernos-sessions/garde.mjs:111` | exact |
| The i18n gate requires one key per bundle | `scripts/test-no-french-literals.mjs:131-137` | exact |
| A pair helper is a dictionary, not a literal | `scripts/test-no-french-literals.mjs:159` | exact |
| The profile reconciler keeps names it does not know | `scripts/lifecycle-engine.mjs:379-388` (`connus`/`actifsSet`) | exact — see A5-1 |
| A single failing entry shows the failure screen | `packages/kybernos-hub/test-host.mjs:139-152` (the captured screen) | exact |
| The six sibling notes announce this rename | line 4 of `docs/tests/A1-*.md`, `A2-*.md`, `A3-*.md`, `A4-*.md` (six files) | exact |
| The strategy's naming note | `docs/etudes/2026-10-27-sector-packs-strategy.md:9-15` | exact |
| The sandbox exists for a real profile test | `scripts/sandbox/setup.sh`, `start.sh` | exact |
| The fault gate takes `--only` and `--faults` | `scripts/check-bundle-faults.mjs:4` | exact |

**Correction to the delegation's brief.** The brief says the plugin id follows
`plugin-contract.md §4.3: kybernos/<dir>`; §4.3's table is at `:180` and maps `kybernos-<x>` →
`kybernos/<x>`, so the new id is `kybernos/style` — not `kybernos/kybernos-style`, which a literal
reading of "kybernos/<dir>" produces. One character of difference, one broken manifest if missed.

## AMBIGUITY lines (the owner must arbitrate these; the rest is settled)

AMBIGUITY: A5-1 — an **existing** installation keeps `@local/kybernos-theme` in its profile after
the rename, and the folder it points at is gone. Default reading: A5 ships **no** profile migration.
A fresh install and a `satellites` re-alignment are clean, because the reconciler's unknown-name
filter (`scripts/lifecycle-engine.mjs:379-388`) only ever removes names it knows — the old name
survives in `dsh.profile.bundles`, its `link:` dependency survives with it, and the next boot shows
the failure screen captured in `packages/kybernos-hub/test-host.mjs:139` (« 1 entry did not
activate »). The default therefore pairs the batch with a **release-note one-shot cleanup** (drop the
old name from `dsh.profile.bundles` and its dependency, or run the safe-mode repair) and states it
in the changelog. The alternative is a rename map inside `alignerLiens` — a migration of an installed
profile, which makes this batch **lane A** and adds a test to `scripts/test-lifecycle-engine.mjs`.
Both are defensible; only the owner can decide whether an installed base is a real population yet.
This is the single most important arbitration in this file.

AMBIGUITY: A5-2 — do the route prefix and the Settings section id rename with the package (I3's
default: yes), or does only the package move? Default: yes, for the three reasons in I3, with the
one-reload cost on an already-open tab. The alternative keeps `/kybernos-theme/*` and the section id,
which is strictly less risk and strictly more confusion — and it makes D5 impossible as written: the
gate would have to be scoped to paths and ids instead of word-zero, which is a weaker proof. The
owner may prefer the weak proof to the reload; if so, D5 changes and nothing else does.

AMBIGUITY: A5-3 — the skins already say « styles » (`client.js:3478-3479`) and the library becomes
« Mes styles » (I5). Default: do only what the naming decision names, and leave the skins' wording
for a follow-up. The alternative — renaming the skins to « looks »/« ambiances » in this batch —
reads better on the page but is vocabulary work that no rename requires, and it moves a surface the
batch's `interdits` puts out of scope ("no scope beyond the rename"). Product choice, not technical.

AMBIGUITY: A5-4 — the on-disk library `theme-presets.json` (`preset-store.mjs:25`). Default: keep
the name (no migration, lane B, the person's styles are untouched by definition). The alternative —
rename the file and migrate `<DSH home>/kybernos/theme-presets.json` → `style-presets.json` on first
read — makes the naming consistent down to the disk and is **lane A**: it moves the person's data,
and a half-failed migration loses a library with no undo. Note the blast radius: `preset-store.mjs`
is the file `A1-theme-seam` rewrites, so this decision also changes where A5's and A1's diffs touch.
Default is keep; the owner should say so out loud rather than by silence.

OUT OF SCOPE:

- **The six sibling batches.** `A1-theme-seam`, `A1-kit-wizard`, `A2-pack-format`,
  `A2-registry-points`, `A3-vertical-content`, `A4-starter-docs` are read here, never edited — except
  their six naming notes, which this batch deletes because A5 is the event they announce. A5 runs
  after them; it does not re-open their contracts.
- **The signed catalogue and its trust chain.** The kind `kybernos-themes`
  (`themes-catalogue.mjs:21`, `gallery.json:3`), `DEFAULT_URL` (`themes-catalogue.mjs:27`),
  `themes-pubkey.json`, `catalog/themes/**` and `gallery.json`'s bytes are frozen. Regenerating them
  is `scripts/themes-catalogue.mjs build --bump`'s job and no rename is a reason to bump a `seq`.
- **Any data migration.** Storage keys, disk file names and their contents (I1, A5-1, A5-4). The
  batch must be provable as a rename by reading a diff of *strings*, not by watching a migration.
- **The style vocabulary itself.** No new `SETTINGS_KEYS`, no token touched, no CSS class renamed
  (`kbth-*` is untouched), no font, no wallpaper, no `PRESET_GROUPS` change. Not one pixel moves.
- **The skins' wording** (`client.js:3478-3479`) — pending A5-3, and out of scope either way.
- **The sector-pack/theme vocabulary** of `docs/dev/*` and `docs/etudes/*` beyond the naming notes:
  A4-starter-docs owns the prose, and A5 only removes the "until the rename lands" sentence it makes
  false.
- **A release bump.** `plugin.json`/`package.json` stay `0.1.0` (the manifest rule keeps them equal;
  `manifest.mjs`), and `ownerVersion` of the style point, if A1 added one, is a point API version,
  not a release.
- **`dsh-compat.json`, `scripts/patches.json`, the engine.** Untouched; zero new patches.
- **The twelve-bundle archive and the mobile payload.** `scripts/test-paquet.mjs:78` names the twelve
  bundles inside the archive builder's fixture; the archive is rebuilt by its own release step, not
  by this batch.
- **Dead code.** Per `AGENTS.md` rule 3 this batch deletes at least as much as it can prove dead, and
  it can prove exactly one class dead: the six « until the product-rename batch lands » notes, which
  A5 makes false by landing. It deletes no source code and does not pretend otherwise; a rename is
  not an opportunity to refactor, and a reviewer who wants one gets a separate batch.
- **The wizard, the gallery, the Kit step, the pack format, the registry points.** Other batches.

e2e:

**End-to-end on the real surfaces — reported, not gated (a live server is needed).**

- [ ] **E1, the live GUI, signed page** (`scripts/live-page.mjs`, the signed cookie, never the stale
      token URL): the sidebar entry reads **Style**, the page's `h1` reads **Style**, the library
      header reads **Mes styles / My styles**, and the tab is at the same position (`order: 1`,
      `client.js:4898`). One saved style, applied before the reload, is still applied after it — the
      proof that the boot route followed the prefix (`/kybernos-style/boot`) and that the
      `localStorage` key did not move (I1). Then: the Suite's **Style** card opens the Style page
      (clicked, not eyeballed), and the « ? How it works » button opens *this* bundle's help (the
      id must equal the directory, `scripts/test-help.mjs:108-120`). Restore the look exactly as
      found and leave no toggled setting behind.
- [ ] **E2, the upgrade path on a real profile — the one thing that can actually break.** In the
      sandbox only (`scripts/sandbox/setup.sh`, `start.sh`; never `:3080`): install the pre-rename
      Suite, boot once (clean), switch the working copy to the renamed tree, boot again. Expect the
      failure screen of `test-host.mjs:139` with `@local/kybernos-theme` named (A5-1's default), then
      apply the documented cleanup and expect a clean boot with **Style** in the sidebar and the
      person's saved style still applied. A batch that "works" only on a fresh profile is not proven.
- [ ] **E3, the fault gate** (`AGENTS.md` rule 2):
      `node scripts/check-bundle-faults.mjs --only kybernos-style --faults throw-apply` — DSH starts,
      every other bundle mounts, only this bundle's routes are lost, and the log names the entry
      (`scripts/check-bundle-faults.mjs:4` for the flags).
- [ ] **E4, no drift inside the bundle**: `node scripts/run-all-tests.mjs --only kybernos-style` →
      0 red across the nine in-tree suites, and the token/look of the page unchanged before vs after
      (a screenshot pair, V1/V2). This is the "no behaviour change" evidence, not a formality.
- [ ] **E5, the merge gate**: `node scripts/run-all-tests.mjs` → 0 red, with any pre-existing red
      named in the merge message; plus `node scripts/garde-depot.mjs && node
      scripts/test-lifecycle-engine.mjs && node scripts/test-paquet.mjs` before the push
      (`AGENTS.md`).

vision:

**Applicable — five captures, each read with `read_image`. A rename's whole visible claim is that the
label changed and nothing else did, so the pair is the proof.**

- [ ] V1/V2 — Settings › Style, light and dark: the nav label, the page title, the same geometry as
      the pre-rename capture (same paddings, same card order, no reflow). The pair is compared to the
      `before/` capture of the same surface; "it looks the same" is a measurement here, not a mood.
- [ ] V3 — the library block: « Mes styles / My styles » with at least one saved style, and its
      « saved in My styles » confirmation after a save.
- [ ] V4 — the Suite page: the card titled **Style**, with its glyph unchanged (`palette`,
      `plugin.json`), opening the Style page on click.
- [ ] V5 — the failure screen of A5-1 (E2's second boot): the entry named is the old bundle, i.e. the
      screenshot that documents the arbitration's cost — and, after the cleanup, the clean boot.
- [ ] Judgement in one line per pair: what changed (a string), what did not (everything else). A
      capture nobody read is not a proof; a capture that shows a *layout* change is a regression and
      sends the batch back.

capture:

**Applicable. The artefacts live OUTSIDE the repository (`mktemp -d`), never in git.**

- [ ] `grep-before.txt` / `grep-after.txt` — `git grep -nw kybernos-theme` (79 files / 348 hits
      before; empty after), and the two exclusion verdicts: the spec itself and the strategy's naming
      note, with the « formerly `kybernos-theme` » sentence visible in the latter. The capture that
      proves D5 is the empty file, not the claim.
- [ ] `catalogue.diff` — `node scripts/build-catalog.mjs` output: the row's `id`/`nom`/`titre`
      changed, its `glyphe`/`famille`/`palier`/`poids_ko` unchanged.
- [ ] `lists.json` — the four structures after the rename (`lifecycle-packages.json`,
      `satellites.json` bundle + `ordre_montage`, `i18n-french-allow.json`,
      `consistency-baseline.json`), read as JSON, so nobody has to trust four diffs.
- [ ] `manifest.json` — `manifestErrors` verdict on the renamed bundle (`[]`), plus the three
      identity strings (`id`, `package`, `package.json` `name`).
- [ ] `network.txt` (E1) — the ordered requests of one load: the boot sheet on the **new** route, the
      gallery and preset-store on the new prefix, and no request to `/kybernos-theme/*`; plus the one
      deliberate 404 of the pre-rename tab (I3's cost), timestamped.
- [ ] `before/` and `after/` PNG pairs of the vision pass, in the same temp directory; the report
      quotes the paths and `git status` stays clean of media (`node scripts/garde-depot.mjs` green:
      media is an error, `scripts/garde-depot.mjs:11`).

maquette:

**Not applicable, and why.** The batch adds no screen, no section, no card and no pixel: it changes
strings and paths, and the CSS class prefix (`kbth-*`) is explicitly untouched. A maquette is the
proof of a *frame* — a layout, a spacing, a hierarchy — and there is no new frame here; the honest
proof is the before/after pair of the same surface (V1/V2), which is a capture, not a mockup. The
requirement comes back the day a batch changes what the Style page *shows* (a new section, a
reorganized library, the skins' vocabulary of A5-3 if it ever lands) — then a maquette at the real
CSS is due before the code, and a silent omission would be a NO-GO.

unit:

**The deterministic layer — this is where the batch is actually proven. Nothing below is a style
judgement.**

The renamed tree (`packages/kybernos-style/**`)

- [ ] `plugin.json` reads `id: kybernos/style`, `package: @local/kybernos-style`,
      `host.routes:/kybernos-style:write`, `claims.routePrefixes: ["/kybernos-style"]`; the version
      stays `0.1.0`, `name` becomes « Style » in both languages, `icon`, `family`, `suite`, `help`
      and every other permission are byte-identical.
- [ ] `package.json` `name` is `@local/kybernos-style`, version `0.1.0`, and the `dsh` block
      (`bundle.patch`, `client.immediately`, the two `inject` entries) is unchanged.
- [ ] `cordis.patch.yml` declares `id: kybernos-style` and `name: '@local/kybernos-style'`, and the
      patch still parses as YAML with one `insert`.
- [ ] `index.js`: `ROUTES` carries the five paths under `/kybernos-style`, the log prefix is
      `[kybernos-style]`, and no route answers on the old prefix (the reserved-prefix guard and the
      body caps are untouched — they belong to no rename).
- [ ] `client.js`: the module identity (`:20`, `:61`), the section `id` and label (`:4897-4899`), the
      library label and its two sentences (`:3774`, `:3759`, `:4030`) are renamed; `__KB_THEME_APPLY__`
      and the other `__KB_THEME_*` globals, `STORE_KEY`/`LD_KEY`/`LIB_KEY` (`:884`, `:1397-1398`,
      `:1873`) and every `kbth-*` selector are **not**.
- [ ] The help call carries the new id (`{ id: 'kybernos-style' }`), because `scripts/test-help.mjs:120`
      fails the page that asks for another bundle's help — the coupling is enforced, not trusted.
- [ ] `preset-store.mjs`, `loader-store.mjs`, `boot-store.mjs`, `themes-gallery.mjs`,
      `themes-catalogue.mjs` and `seed-skills.mjs`: only comments and path mentions change;
      `FILE_NAME` (`:25`), `KIND` (`themes-catalogue.mjs:21`) and every behaviour byte are identical.
      A diff on these files that touches logic is a NO-GO — `A1-theme-seam` owns their logic.
- [ ] The nine in-tree suites pass unchanged, which is the point: a rename that needs a test edited
      to stay green has changed behaviour.

The lists and the derived catalogue (one lockstep, four structures)

- [ ] `scripts/lifecycle-packages.json` (`dir`, `nom`), `docs/beta/satellites.json` (the bundle entry
      and its name in `ordre_montage.socle`, `:477`), `scripts/i18n-french-allow.json` (one key per
      bundle, `test-no-french-literals.mjs:131-137`), `scripts/consistency-baseline.json`
      (the two `cssPrefixes` values; the `kbth` **key** stays) — all four renamed, none half-renamed.
      D7 is this checkbox as a command.
- [ ] `packages/kybernos-hub/catalog.json` is **regenerated** (`node scripts/build-catalog.mjs`), and
      `--check` is clean; the row keeps its glyph, family, tier and weight, and its `titre` becomes
      « Style » so that `scripts/test-settings-names.mjs:64-78` (card title ≡ nav label) stays green.
- [ ] `packages/kybernos-hub/client.js:1000` maps the new directory to the new section id, and the
      icon key at `:972` follows (an unmapped module loses its Suite glyph silently).
- [ ] `packages/kybernos-plugin/client.js` `KB_NAV_KEYS` (`:3005-3006`) has the new key and the value
      `'style'`; `packages/kybernos-plugin/test-nav-titles.mjs:30,38` uses this key as its example and
      follows.
- [ ] `scripts/route-guard-exceptions.mjs:66` names the bundle and its four POST paths;
      `packages/kybernos-sessions/garde.mjs:111` reserves the new client path (a stale hot-file path
      is a reservation that never fires, i.e. silent).
- [ ] `scripts/themes-catalogue.mjs:27-28` points at the new directory while `DEFAULT_URL` (`:27` of
      the bundle copy) and the published artifact names stay exactly as they are.

The other 20 `packages/**` references and the 30 `scripts/**` references

- [ ] Every path reference is updated with the tree (`packages/kybernos-plugin/test-menu-icons.mjs:32`,
      `test-settings-frame.mjs:34-36`, `test-hit-areas.mjs:33-49`, `test-brand.mjs:125`,
      `test-help.mjs:121`, `test-trusted-guards.mjs:64-65`, `test-live-checks.mjs:141`,
      `test-seed-skills-drift.mjs:16`, `test-paquet.mjs:78`, `test-safe-mode.mjs:57`,
      `test-suite-gui.mjs:159`, the live checks' URL patterns): the suite is the only honest way to
      claim "all of them", and D10 is that claim.
- [ ] Fixtures that only *name* the bundle (`test-lifecycle-engine.mjs:199-232`, `test-host.mjs:139`,
      `packages/kybernos-maintenance/test-voulus.mjs:68`,
      `packages/kybernos-memory/test-client.mjs:158`) are renamed for coherence with D5 — they would
      pass either way, and that is precisely why leaving one behind is invisible without the grep.
- [ ] Comments that teach a pattern from this bundle (`kybernos-language/client.js:64-65`,
      `kybernos-memory/client.js:638`, `kybernos-composio/index.js:612`,
      `kybernos-refs/index.js:6`, `kybernos-sessions/client.js:3072`) name the new path, so the next
      reader does not grep a folder that no longer exists.

Docs

- [ ] `README.md:59`'s table row, `THIRD_PARTY_LICENSES:7`'s vendored path,
      `docs/dev/theme-gallery.md:6,12,15,61,84-85`, `docs/dev/live-testing.md:628,659,685,687`,
      `docs/dev/skeleton-screens.md:55` carry the new name.
- [ ] The six « until the product-rename batch lands » notes are **deleted** (the six sibling specs
      at line 4), and the strategy's naming note is rewritten to say the rename has
      landed — keeping « formerly `kybernos-theme` » in exactly one place, which is what D5's
      exclusion allows and asserts.
- [ ] `node scripts/garde-depot.mjs` reports 0 error (no media added, no personal path introduced by
      a moved file).

DoD:

**Commands of THIS repository, from its root. Each one was run today (2026-10-28) and fails for the
reason written next to it — a command that already passes is not a DoD on its own, so the ones that
are guards today are paired with the rename they guard.**

D1 — the tree moved, and the old one is gone (fails today: no `packages/kybernos-style`):

```bash
test -d packages/kybernos-style && test ! -e packages/kybernos-theme && test -f packages/kybernos-style/plugin.json && test -f packages/kybernos-style/client.js && test -f packages/kybernos-style/index.js
```

D2 — the identity is renamed, the release is not, and the manifest still passes its own validator
(fails today: `D2: packages/kybernos-style/ is not there (ENOENT)` — measured; the `manifestErrors`
path returns `[]` on the bundle as it stands, measured independently):

```bash
node --input-type=module -e "import{manifestErrors}from'./scripts/plugin-manifest.mjs';import{readFileSync,existsSync}from'node:fs';import{join}from'node:path';const R=(f)=>JSON.parse(readFileSync(f,'utf8'));const dir='kybernos-style';const d='packages/'+dir+'/';let m,p;try{m=R(d+'plugin.json');p=R(d+'package.json')}catch(e){console.error('D2: packages/kybernos-style/ is not there ('+e.code+')');process.exit(1)}const bad=[];if(m.id!=='kybernos/style')bad.push('id='+m.id);if(m.package!=='@local/kybernos-style')bad.push('manifest package='+m.package);if(p.name!=='@local/kybernos-style')bad.push('package.json name='+p.name);if(m.version!=='0.1.0'||p.version!=='0.1.0')bad.push('a release was bumped');if(!(m.permissions||[]).some((x)=>x==='host.routes:/kybernos-style:write'))bad.push('no host.routes:/kybernos-style:write');if(!((m.claims||{}).routePrefixes||[]).includes('/kybernos-style'))bad.push('claims.routePrefixes not renamed');const e=manifestErrors(m,{firstParty:true,dir,packageJson:p,suiteZone:R('dsh-compat.json').dsh,fileExists:(rel)=>existsSync(join(d,rel))});if(e.length>0)bad.push('manifestErrors: '+e.join('; '));if(bad.length>0){console.error('D2: '+bad.join('; '));process.exit(1)}console.log('D2 ok')"
```

D3 — the four source lists and the derived catalogue are in lockstep, and the catalogue was
regenerated rather than hand-edited (fails today: the `grep` exits 1; `build-catalog.mjs --check`
exits 0 on the untouched tree, measured, which is why the grep is the discriminating half):

```bash
grep -q '"id": "kybernos-style"' packages/kybernos-hub/catalog.json && ! git grep -qw kybernos-theme -- packages/kybernos-hub/ scripts/lifecycle-packages.json docs/beta/satellites.json scripts/i18n-french-allow.json scripts/consistency-baseline.json && node scripts/build-catalog.mjs --check
```

D4 — the two user-facing labels are the new words, in both languages, and the page-name contract
still holds (fails today: no such file; the two strings are unique in the file today, measured at
one occurrence each):

```bash
grep -q "kbthLabel('Style', 'Style')" packages/kybernos-style/client.js && grep -q "say('Mes styles', 'My styles')" packages/kybernos-style/client.js && node scripts/test-settings-names.mjs >/dev/null
```

D5 — the old name is gone from every tracked file except the two places that record it as history,
and the second of those still records it (fails today: 78 files match — measured — and the
« formerly » sentence does not exist yet):

```bash
test -z "$(git grep -nw kybernos-theme -- . ':!docs/tests/A5-style-rename-strategy.md' ':!docs/etudes/2026-10-27-sector-packs-strategy.md')" && grep -q 'formerly `kybernos-theme`' docs/etudes/2026-10-27-sector-packs-strategy.md
```

D6 — the rename did not lose the work it was sequenced after: A1's three markers are on the **new**
path (fails today at the first clause; the same three markers on the old path are the pre-start gate
of the "ordering constraint" section, also measured at exit 1):

```bash
grep -q 'export function applyPreset' packages/kybernos-style/preset-store.mjs && grep -q 'THEME_POINT' packages/kybernos-style/themes-catalogue.mjs && grep -q '"provides"' packages/kybernos-style/plugin.json
```

D7 — the four structures name the bundle exactly once, under the new name, in both the directory and
the package fields (fails today: eight failures, printed — measured):

```bash
node -e "const fs=require('node:fs');const R=(f)=>JSON.parse(fs.readFileSync(f,'utf8'));const a=R('scripts/i18n-french-allow.json').bundles;const l=R('scripts/lifecycle-packages.json').packages;const s=R('docs/beta/satellites.json');const all=[...s.socle.bundles,...s.satellites.bundles];const miss=[];if(a['kybernos-style']===undefined)miss.push('i18n-french-allow: no kybernos-style key');if(a['kybernos-theme']!==undefined)miss.push('i18n-french-allow: the old key is kept');if(!l.some(p=>p.dir==='kybernos-style'&&p.nom==='@local/kybernos-style'))miss.push('lifecycle-packages: not renamed');if(l.some(p=>p.dir==='kybernos-theme'))miss.push('lifecycle-packages: the old dir is kept');if(!all.some(b=>b.dir==='kybernos-style'&&b.nom==='@local/kybernos-style'))miss.push('satellites: not renamed');if(all.some(b=>b.dir==='kybernos-theme'))miss.push('satellites: the old dir is kept');if(!s.ordre_montage.socle.includes('@local/kybernos-style'))miss.push('ordre_montage: the new name is missing');if(s.ordre_montage.socle.includes('@local/kybernos-theme'))miss.push('ordre_montage: the old name is kept');if(miss.length>0){console.error(miss.join('; '));process.exit(1)}console.log('D7 ok')"
```

D8 — the layout lockstep passes with the renamed package (fails today at the first clause; the layout
test is green on any *consistent* tree — today it is red on the untracked `kybernos-log/` folder alone,
both failures naming it — so the rename is the half that makes it a proof):

```bash
test -d packages/kybernos-style && node scripts/test-layout.mjs
```

D9 — the repository guard reports 0 error (fails today at the first clause; `garde-depot` is green
today, measured, and a moved tree is exactly the kind of change that drags a stray media file in):

```bash
test -d packages/kybernos-style && node scripts/garde-depot.mjs
```

D10 — the whole suite ends 0 red (fails today at the first clause; this is the only command that can
honestly claim the 30 `scripts/**` and 20 `packages/**` references were all found — `--only` is for
the middle of the work, never for the merge, per `AGENTS.md`):

```bash
test -d packages/kybernos-style && node scripts/run-all-tests.mjs
```

Notes on how these are read. D1, D2, D3, D6 and D7 are behavioural on purpose: they cannot pass by
adding a string, they fail today, and each one names a different failure (the tree, the identity, the
derived catalogue, A1's surviving exports, the four lists). D4 is the label contract, paired with the
suite that owns it. D5 is the gate the delegation asked for, word-anchored so that the *signed*
catalogue kind `kybernos-themes` cannot make it lie, and with its two exclusions asserted rather than
assumed — an exclusion that stops being justified turns the last clause red. D8, D9 and D10 are the
repository's own guards, paired with the rename: D9 is green today and is therefore *not* evidence of a
rename by itself, while D8 and D10 are red today for the neighbour reasons measured in the next
paragraph — a guard that already passes proves nothing, and a guard kept red by someone else's folder is
named in the merge message, never quietly waited for. The four arbitrations (A5-1..A5-4) change no
command above except D5's second clause (A5-2: a scoped grep instead of a word-zero one) and possibly a
lane-A addition (A5-1/A5-4); each is a one-line change, not a rewrite.

**Measured state of the tree on 2026-10-28, so the implementer does not chase a ghost.** The guard
inside `D9` is green today (`garde-depot`: 1922 tracked files, 0 error, 0 warning — measured again
while writing this line; `D9` itself exits 1 only because its first clause asks for a directory that
does not exist yet). `node
scripts/run-all-tests.mjs` was run in **this** worktree today and ends **8 RED of 529 files** (521
green, 188 s) — and **not one of the eight is on `packages/kybernos-theme/**`**:

| Red file | What it says | Whose it is |
|---|---|---|
| `scripts/test-layout.mjs` (2) | « every DSH bundle is declared to the robot with a name » and « … is in satellites.json », both naming `kybernos-log` | the **untracked** bundle `packages/kybernos-log/` (0 files in the index) |
| `scripts/test-readmes.mjs` (1) | `kybernos-log` is not linked from `README.md` | same untracked bundle |
| `scripts/test-consistency-guards.mjs` (1) | `['kybernos-log 1 (allowed 0)']` against `[]` | same untracked bundle |
| `packages/kybernos-plugin/test-settings-nav.mjs` (1) | `kybernos-log` has no key in `KB_NAV_KEYS` | same untracked bundle |
| `scripts/test-help-mounts.mjs` (1) | `kybernos-log` ships `help.json` and never mounts `__KB_HELP__.Help` | same untracked bundle |
| `scripts/test-no-french-literals.mjs` (2) | « every bundle is listed » for `kybernos-log`, **and** three French literals: `client.js:33803` « journal d’activite » / « journal d'activite », `index.js:11635` « image vide » | the untracked bundle **and** an **uncommitted diff** of `packages/kybernos-plugin/` |
| `scripts/test-plugin-scan.mjs` (1) | `kybernos-pulse → exec: the host code starts processes (helper/gen-icon.mjs:9)` | a neighbour bundle's undeclared permission |
| `scripts/test-help.mjs` (1) | eleven modules with no help article: `kybernos-hub`, `kybernos-kaby-customisation`, `kybernos-no-process`, `kybernos-plugin`, `kybernos-pulse`, `kybernos-registry`, `kybernos-relance`, `kybernos-search`, `kybernos-servers`, `kybernos-session-msg`, `kybernos-webapp-creator` | pre-existing content debt, not a code defect |

So the path to 0 red is **not** « declare or remove `kybernos-log` »: removing that folder (or
declaring it properly) turns **D8** green — both of its failures are that folder — and takes
`test-readmes`, `test-consistency-guards`, `test-settings-nav`, `test-help-mounts` and one clause of
`test-no-french-literals` with it, but **three files stay red for reasons no rename touches**:
`test-no-french-literals` (the three French literals of the uncommitted neighbour diff),
`test-plugin-scan` (`kybernos-pulse`) and `test-help` (the eleven missing articles). **D10's « 0 red »
is therefore an owner decision, not a deliverable of this batch:** those three are fixed in their own
bundle or ticketed, the merge message names them and attributes them, per `AGENTS.md` (« there is no
known red »). No "all exit 0" is claimed anywhere in this document, and D10 keeps its first clause
(`test -d packages/kybernos-style`) so that it can never pass on the pre-rename tree.

## Acceptance note

The checkboxes are the review grid. A box is closed by a test or by a capture, never by a comment; a
closed box whose test lives only in a throw-away script is an open box. Two things must be said out
loud before this batch is queued: **it runs last** (the precondition command, then D6 to prove the
work survived), and **A5-1 is an owner decision, not an implementation detail** — an existing
installation sees a failure screen on the first boot after the rename unless the profile is cleaned,
and "no behaviour change" is true of the product, not automatically of the upgrade. A5-2, A5-3 and
A5-4 each change exactly one checkbox and are answered by one line each. Everything else in this
document is settled and proven against `2ac67fb4`.
