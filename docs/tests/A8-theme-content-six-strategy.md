> **Naming update (2026-10-28, owner).** The visual layer (earlier "theme": token overlay, presets)
> is now the **style**; the installable sector unit (earlier "sector pack"/"pack") is now the
> **theme**. Code paths stay unchanged (`packages/kybernos-theme`, `theme-presets.json`) until the
> product-rename batch (kybernos-theme → kybernos-style) lands. Read this document with that
> vocabulary: a **theme** composes a **style**, a **configuration** and a **kit**; the four new files
> this batch adds are the **style** halves of four themes, and the four one-line edits are the
> **configuration** links. Where the delegation says "theme file", this document says which half it
> means, because the two halves have two different shapes and only one of them is A2's pack format.

> **Baseline: `2ac67fb4`.** Every `file:line` anchor below was verified on 2026-10-28 with
> `git show 2ac67fb4:<path>`, never against the moving worktree. **This tree was being written while
> this spec was being written**: the campaign's four GO batches landed and were committed as
> `3efbdfdb` during the session (see *Ground measured while writing*, below), so the worktree numbers
> quoted here are ordered observations, not anchors. The anchors are the baseline lines; the
> implementer re-pins at opening.

# A8-theme-content-six — test strategy (written before any code)

| | |
|---|---|
| Batch | `A8-theme-content-six` — four more sector themes, so the field catalogue holds six complete themes |
| Campaign | Phase A of `docs/etudes/2026-10-27-sector-packs-strategy.md` (sections 3, 4 and 8 → lines `:53-96`, `:98-114`, `:155-176`), after A3-vertical-content |
| Lane | **B (standard)** — ten data files, no auth, no billing, no RLS, no migration, no secret, no code |
| Author role | `redacteur-spec` — this file only; no code, no test module, no pack and no catalogue entry is written here |
| Binding contract | skill `contrat-pack-vertical` (primitives first, custom UI in Settings, style = token overlay, cited or labelled) |
| Verdict on disk | `docs/tests/triage.md` (`chemin: complet`) and the campaign artifact `docs/tests/gate-verdicts-final.md` |
| Status | spec — every DoD command was run on this tree and fails there (measured, quoted verbatim under `DoD:`) |

## What the batch ships, and the one thing it must not create

Six sector themes, of which A3 already shipped two:

| # | Sector | Configuration + kit (the pack, **cited**, untouched) | Style (the token overlay) | Accent |
|---|---|---|---|---|
| 1 | Medical practice | `domains/sante.json` (A3, linked) | `catalog/themes/cabinet-medical.json` (A3) | `#1B7F76` (`sante.json:5`) |
| 2 | IT recruitment | `domains/recrutement.json` (A3, linked) | `catalog/themes/recrutement-ssii.json` (A3) | `#4F5BD5` (`recrutement.json:6`, mockup `:23`) |
| 3 | Rental real estate | `domains/immo.json` (`:2-6`) | **`catalog/themes/immobilier-locatif.json`** (new) | `#B4532A` (`immo.json:5`) |
| 4 | E-commerce | `domains/com.json` (`:2-6`) | **`catalog/themes/e-commerce.json`** (new) | `#C25E0A` (`com.json:5`) |
| 5 | Law firm | `domains/droit.json` (`:2-6`) | **`catalog/themes/cabinet-avocats.json`** (new) | `#7A2236` (`droit.json:5`) |
| 6 | Education | `domains/edu.json` (`:2-6`) | **`catalog/themes/education.json`** (new) | `#6C4DF6` (`edu.json:5`) |

**Write perimeter — ten files, two of them written by one command.**

| File | What changes |
|---|---|
| `catalog/themes/immobilier-locatif.json` | new — the rental real-estate style |
| `catalog/themes/e-commerce.json` | new — the e-commerce style |
| `catalog/themes/cabinet-avocats.json` | new — the law-firm style |
| `catalog/themes/education.json` | new — the education style |
| `catalog/themes/_catalogue.json` | `{ seq, publishedAt }`, written only by `node scripts/themes-catalogue.mjs build --bump` (`scripts/themes-catalogue.mjs:66-70`) |
| `packages/kybernos-theme/gallery.json` | **generated** by the same command (`:27`, `:71-73`); never hand-edited |
| `packages/kybernos-plugin/domains/immo.json` | **one line**: `"theme": "immobilier-locatif"` |
| `packages/kybernos-plugin/domains/com.json` | **one line**: `"theme": "e-commerce"` |
| `packages/kybernos-plugin/domains/droit.json` | **one line**: `"theme": "cabinet-avocats"` |
| `packages/kybernos-plugin/domains/edu.json` | **one line**: `"theme": "education"` |

That is ten files; the four pack files receive one added key each and **no other byte changes**, which
DoD 4 proves against the baseline commit. **The batch creates no pack file**: the catalogue keeps its
nine shipped fields plus A3's `recrutement` (`domains/` holds ten `.json` files, measured), and no
keyword, icon, goal, starter or automation of the four packs is rewritten. A new pack file for a
sector whose pack already exists is what this batch must not create, and *Interpretation 1* is why.

## The interpretation that decides the batch

The delegation says two things that cannot both be literal inside this repository:

1. "The four new theme files are **DATA (A2-pack-format shape)**";
2. "**Derive each new theme from the shipped domain pack** (CITED data: menu labels, goals, kit,
   starters — `packages/kybernos-plugin/domains/<id>.json`)" — and the catalogue is to hold **six**
   themes.

A pack-shaped duplicate of `immo.json`/`com.json`/`droit.json`/`edu.json` cannot pass the guards the
suite already enforces on that folder, and would not give six themes:

- **one colour per field** — `test-domain-pack.mjs:253` asserts every pack accent is distinct; a
  derived pack must invent a second hex for the same sector, which is the *opposite* of one style
  accent per sector;
- **one keyword per field** — `:248-250` refuses any keyword two packs share; a derived pack must
  rewrite the very vocabulary the delegation asks to cite;
- **the catalogue would hold thirteen packs, not six** — the field catalogue is
  `loadPacks(domains)` (`:181`), so "four more packs" means ten + four tiles, with two tiles per
  sector;
- **`home`, `menu`, `legacyJobs` are per-pack, not per-theme** — `:251`, `:319`, `:311-313`.

A *style* file, by contrast, is exactly the missing half: the gap that stops `immo`, `com`, `droit`
and `edu` from being **themes** today is that no style exists for them and no pack names one. Measured
at the last reading, the tree holds **two themes out of six** (`sante -> cabinet-medical`,
`recrutement -> recrutement-ssii`; DoD 3 prints that line). Four style files + four one-line links is
therefore the only reading that yields six complete themes, rewrites nothing, and passes every guard.

**Chosen: the four new files are the style halves (`catalog/themes/<id>.json`, the shape A3 already
established for its two) and the four one-line edits name them.** The A2 pack format is what the
*link* uses — A2's `theme` key on the pack — not what the new files are. The style file's own shape is
frozen by `sanitizeTheme` (`packages/kybernos-theme/themes-catalogue.mjs:44-62`) and by the page's
own normaliser (`client.js:929-950`), and no third shape exists.

The consequence, stated plainly: the delegation's phrase "A2-pack-format shape" is not met to the
letter, and an implementer who writes pack-shaped duplicates instead will redden
`test-domain-pack.mjs:253` and `:248-250` and still not have six themes. **AMBIGUITY 1** records the
choice for the human rather than settling it in silence.

## Ground measured while writing (dated, not pinned)

- **First measurement** — `packages/kybernos-plugin/domain-pack.mjs` still had the 14-key allowlist and no
  `theme`; `test-domain-pack.mjs` still asserted the exact nine ids. **Second measurement, minutes
  later** — A2-pack-format has landed in the worktree: `theme` is in the allowlist, `packsOf`/`KIT_POINTS` exist,
  `test-domain-pack.mjs` passes **52 checks** and its exact-set assertions are now tolerant
  (relative order kept, extras allowed, the nine file names no longer hardcoded). The delegation's
  "already widened by A2-pack-format (GO)" is **true at the second measurement and was false at the
  first**: the widening arrived during this writing, so the implementer should re-run it before
  relying on it.
- **Before this document was finished — the four GO batches are committed** as `3efbdfdb` ("themes: implement the four GO
  batches (seam, pack format, registry points, two themes)"). The catalogue manifest is now
  `{ seq: 5 }` at HEAD, so A8's `build --bump` produces **seq 6**, and `2ac67fb4` remains the only
  baseline this spec pins. Order matters more than clock time here: the commit landed after this
  spec's first readings, so below, *first reading* and *last reading* mean what they say.
- `loadPacks('packages/kybernos-plugin/domains')` returns **ten** packs, `rejected: []`, `sante` and
  `recrutement` carrying their theme. A3's two themes are in `gallery.json` (16 entries, seq 5).
- **First reading — A3's two themes were red on the page's own round-trip**; **last reading — they are
  green**.
  `packages/kybernos-theme/test-client.mjs` printed
  `✗ every theme comes through the page's own check unchanged (nothing is silently dropped or
  rewritten) — ["cabinet-medical","recrutement-ssii"]` (`test-client.mjs:1304`), then A3's owner
  rewrote its two files (hexes lower-cased, settings re-ordered) and the file now prints
  `✓ 450 passed, 0 failed`. Both halves of the cause were measured, and they are the two rules this
  batch's four files must respect:
  1. **lower case** — the page canonicalises every hex through `toHex` (`client.js:83`, `:935`, `:945`)
     and compares JSON strings, so `#1B7F76` comes back `#1b7f76` and differs;
  2. **key order** — `presetSettings` rebuilds the settings object in `PRESET_KEYS` order
     (`client.js:1867`, `:1877-1882`), i.e. `mode, acc, ov, sideTone, fontText, …, radius`, while the
     host keeps the file's own order (`preset-store.mjs:104-108`); a file written
     `mode, acc, fontText, radius, ov` therefore round-trips to a different string even with identical
     content. Both A3 files now use the canonical order, and so must the four new ones.
  This is the single most useful measurement of the batch: it is why DoD 5 exists and why the JSON in
  *unit:* is given in one exact order.

## Interpretations (the request admits several; chosen + why)

1. **What a "theme file" is** — see the section above. Chosen: the style half; the link is A2's
   `theme` key. Rejected: four pack-shaped duplicates (breaks `:253`, `:248-250`, gives thirteen
   packs, not six) and four theme *bundles* (that is Phase B's catalogue and installer, explicitly
   out of scope).
2. **Where the accent hex comes from.** (a) cite the shipped pack's own `accent` — `immo.json:5`,
   `com.json:5`, `droit.json:5`, `edu.json:5`; (b) invent a fresh hex per sector, labelled PROPOSAL.
   **Chosen: (a), lower-cased to the form the page keeps** (`client.js:935`), and still **marked
   PROPOSAL** in the sortie because none of those four hexes has a métier source: each is the pack
   author's design choice, in the same situation as A3's `#4F5BD5`. This keeps A3's bidirectional
   invariant (`theme.settings.acc` = `pack.accent`, A3 interpretation 6) true for all six themes, and
   it keeps the delegation's "one accent hex per sector, marked PROPOSAL" — the accent is one hex, the
   PROPOSAL label lives in prose, exactly where A3 put it (A3 interpretation 2).
3. **The non-accent tokens are design choices, deliberately not pinned by the DoD.** `mode`,
   `fontText`, `radius` and the five `ov` hexes are PROPOSAL. The DoD checks their *legality*
   (`mode` ∈ `{light,dark}`; `radius` ∈ `{sharp,standard,soft}`, `client.js:910`; `fontText` one of
   a small allowlist taken from the `FONTS` table (`client.js:416-450`: `inter`, `poppins`,
   `georgia`, `merriweather` — the batch uses the first three); `ov` keys
   `light:|dark:` + a `TOKMAP` token, `client.js:367-380`) and never their taste. A number the human
   does not like can change without changing a test's intent.
4. **Which sector gets which mode.** PROPOSAL: rental, e-commerce and education are `light`; the law
   firm is `dark` (`#7A2236` as an accent reads best on a dark ground, as A3 did for recruitment).
   The author may move any of them inside the vocabulary; only `acc` is bounded by the pack.
5. **The theme ids are pinned here so the tests are deterministic.** `immobilier-locatif`,
   `e-commerce`, `cabinet-avocats`, `education` (all ≤ 40 characters, matching both
   `THEME_ID_RE` — `themes-catalogue.mjs:25`, `{0,39}` — and A2's pack-side regex `{0,40}`;
   `preset-store.mjs:26` allows 63, the narrowest wins). They are PROPOSAL as words, but a rename
   after this spec is a rename of four files, four links and the DoD expectations.
6. **"Each theme must pass the points' validators (bounded keys, en required, automations
   draft-only)"** is mapped to the file that actually owns each rule, because the three do not live
   in one validator:
   - *bounded keys, `en` required* → the **catalogue** rule, `sanitizeTheme`
     (`themes-catalogue.mjs:44-62`: id regex, `name` ≤ 40, `author` ≤ 60, `description.fr` **and**
     `.en` ≤ 200, `v` an integer ≥ 1, an accessibility key **refused, not trimmed** `:57-58`), plus
     `sanitizePreset` (`preset-store.mjs:92-115`) which **drops** an unknown settings key silently
     (`:104`) — the trap of this batch, DoD 1 compares the raw and cleaned key sets;
   - *bounded keys, `en` required* on the pack side → `validatePack` (`domain-pack.mjs:68-188`,
     `textOf` `:47-58`); A8 adds one key to four packs and rewrites nothing, DoD 4 proves it;
   - *automations draft-only* → **no validator covers a pack's inline `goal.automations` prompts**.
     The `guard` requirement lives in A2's contributed-template validator
     (`kybernos/core#automation-template`), and the four packs carry their automations inline. So
     this is a **citation check**, not a machine check: `immo.json:112-113` ("Never send"),
     `:211-212`, `com.json:106-107`, `droit.json:158-159` (returns a list, sends nothing),
     `edu.json:126-127` ("Only edit the plan file, nothing else"). A8 creates no automation and
     changes no prompt, so the rule is satisfied by leaving the cited text alone.
7. **The pack links are A2's, and A2's regex is the tighter one.** `theme` reads as `null` when
   absent (`domain-pack.mjs:187` at the baseline; the key itself is A2's, absent from the baseline
   allowlist `:71` and present in the worktree). If A2 lands with `{0,40}`, the four ids fit; if the
   human widens it to 63 (A2's open AMBIGUITY), nothing here changes.
8. **"Six themes" is a property of the loaded catalogue, not of a folder count.** DoD 3 counts the
   packs whose `theme` is a string (six) and resolves each id in `catalog/themes/`; a seventh themed
   pack later is not a breach, a sixth missing one is.

## AMBIGUITY (the human arbitrates; the batch must not settle these silently)

AMBIGUITY: **"the four new theme files are DATA (A2-pack-format shape)"**. Taken literally, each new
file is a pack-shaped document; taken with "derive from the shipped pack" and "the catalogue holds
six", it is the style half. **This batch implements the second** (see *The interpretation that
decides the batch*), because the first reddens `test-domain-pack.mjs:253` and `:248-250` and yields
thirteen tiles, not six. Arbitrate: (a) style halves + A2 links, as written — recommended; (b) real
pack-shaped duplicates, which then needs a decision on the duplicate tiles and on the per-field
uniqueness guards, i.e. a product change, not a data batch; (c) four theme *bundles* under a new
catalogue folder, which is Phase B and needs the installer this batch is told to leave alone.

AMBIGUITY: **the four accents are cited from the packs, so they are not PROPOSAL by origin.** The
delegation asks for "ONE style accent hex per sector **marked PROPOSAL** (design choice)". A cited hex
and a PROPOSAL hex are different provenance labels, and this spec keeps both by citing the pack and
labelling the result PROPOSAL (no métier owner has ratified `#B4532A`, `#C25E0A`, `#7A2236`,
`#6C4DF6`). Arbitrate only if a sector owner has an official hex: then it is cited, the label drops,
and — if it differs from `pack.accent` — A3's bidirectional invariant must be re-decided for all six
themes.

AMBIGUITY: **who owns the canonical form of a catalogue theme's `settings`.** The host accepts any key
order and any hex case (`preset-store.mjs:104-108`); the page rejects a theme unless the order is
`PRESET_KEYS`'s and every hex is lower case (`client.js:1867`, `:935`, `:945`,
`test-client.mjs:1304`). Measured: A3 shipped exactly the refused combination, was red on the first
reading, and green after its two files were rewritten (last reading). A8 complies in data (DoD 1, DoD 5), but **the rule
is unowned**: arbitrate (a) `sanitizeTheme` canonicalises on the host side — one function, and every
future theme is safe; (b) the rule is documented for authors (A4's "Build a theme" page); (c) nothing,
and each author discovers it from a red test. The writer recommends (a); none of the three is A8's to
implement, and A8 must not be judged on the gap.

AMBIGUITY: **may A8 touch the four shipped pack files at all?** The delegation says "Perimeter: the
new data files only". Read strictly, the four `theme` links are cut, and the batch ships four style
entries that no pack names — six themes become two themes and four orphans. Read as A3's perimeter
was read (one line added to `sante.json`), the links are in. **This spec keeps the links**, because
without them the batch has no observable effect in the product; the four edits are additions of a
single key and DoD 4 proves no other byte moved.

## Lane

**B — standard.** All ten files are JSON data or generated JSON: four new catalogue entries, the
catalogue manifest, the generated gallery, and four one-line additions to pack data. No route, no
guard, no `cordis.patch.yml`, no key, no signature (`catalog/themes.catalog.json` and `.sig` are the
maintainer's, repo rule 7), no migration, no permission. **Falsifier that flips this to A:** any hunk
in `packages/kybernos-registry/**`, `packages/kybernos-plugin/index.js`, `preset-store.mjs`,
`session-guard.mjs`, or any write under `<DSH home>` — none of which this batch needs.

e2e: the journey the six themes must survive on the real GUI, and which batch owns each step. Written
against the existing surfaces only — no new screen is part of this batch.

- [ ] **Fresh profile → the field step offers the six sectors.** The tiles are rendered from the
  packs, unchanged: rental reads `immo.json:7-14` ("Real estate" / "Immobilier", tagline "Agents,
  agencies, property managers"), e-commerce `com.json:7-14`, law `droit.json:7-14`, education
  `edu.json:7-14`; medical and recruitment were A3's. Owning data: **A8** (it must not change a tile
  word). Rendering: A1/A2, unchanged.
- [ ] **Pick a field → its menu words and its home order, cited from the pack.** Rental:
  `immo.json:40-62` (dashboards "My activity", aiteams "Agency team", deliverables "Listings and
  documents", tasks "Follow-ups", `documents` hidden) and `:34-38` home (`doc, image, website`).
  E-commerce `com.json:45-58`, `:36-40`; law `droit.json:41-62`, `:33-37`; education `edu.json:48-69`,
  `:40-44`. Owning data: the packs, **cited, untouched by A8**; the wiring is
  `docs/dev/domain-packs.md:65-75`.
- [ ] **The goals step lists the packs' goals in pack order**, with their starters:
  `immo.json:70-321` (leads, listings, visits, valuation, tenants; starters at `:118`, `:169`,
  `:217`, `:258`, `:315`), `com.json:67-273` (four goals, starters `:118`, `:181`, `:215`, `:267`),
  `droit.json:71-303` (five goals, starters `:116`, `:164`, `:215`, `:263`, `:297`),
  `edu.json:78-339` (five goals, starters `:133`, `:187`, `:235`, `:285`, `:333`). A8 rewrites none
  of them (DoD 4).
- [ ] **Kit step: every automation created switched off.** The creation call is
  `POST /kybernos/tasks {action:"create"}` with `active:false` (`docs/dev/domain-packs.md:70`), and
  every prompt of the four packs drafts or reads only: `immo.json:112-113` and `:211-212`,
  `com.json:106-107`, `droit.json:158-159`, `edu.json:126-127`. A8 creates no automation and changes
  no prompt.
- [ ] **Kit step: the sector style is proposed and visible in the live miniature.** *Owned by
  A1-kit-wizard/A1-theme-seam*: A8 only guarantees that a catalogue entry exists under the id the
  pack names (DoD 3) and that it carries the pack's accent (DoD 1).
- [ ] **Settings › Style › Gallery: the six sector cards.** A8's four new cards must appear with
  name, author and a description in both languages, installable by the person's action only
  (`client.js:2142`), and installing one must copy it to "My styles" with `source: 'gallery'`,
  `gid`, `v`, `author` (`client.js:2142`; shape asserted live at `scripts/check-theme-live.mjs:1627`).
  *This is the one end-to-end path A8 owns.*
- [ ] **Reload: nothing is lost.** The installed style survives in `theme-presets.json`; the field
  choice and the theme id survive in `onboarding.json` (`onboarding-state.mjs`'s `theme` field,
  A2; `docs/dev/domain-packs.md:71` for the saved choice).
- [ ] **Negative journey: a pack naming an id no catalogue file provides stays a pack.** The loader
  validates shape, never existence (`domain-pack.mjs:68-188`; A2 interpretation 2), and the page
  drops an unreadable card (`client.js:2100-2107` returns `null`). So a future theme id that is
  missing is a greyed/absent card, never a boot failure (repo rule 2). Checked by inspection, no new
  test: A8 adds no logic.

vision: **applicable** — this batch changes what two existing surfaces *show* (four gallery cards,
the sector accent in the wizard's miniature). It is read, never used to judge data.

- [ ] `read_image` on the gallery captures and confirm: (1) each of the four new cards shows a
  readable name, author, description and a swatch, with no clipped or overflowing text in light
  **and** dark; (2) the six sector swatches are **visibly different from each other** — teal
  `#1B7F76`, indigo `#4F5BD5`, terracotta `#B4532A`, orange `#C25E0A`, burgundy `#7A2236`, violet
  `#6C4DF6`; (3) at 430 px width nothing overlaps and the grid still shows one card per theme;
  (4) the installed sector skin keeps labels legible in light and dark.
- [ ] **Vision must not be used for a hex, a radius or a font id.** Those are data and are proven by
  the files and by `getComputedStyle` on the `--dsw-*` tokens (the method
  `scripts/check-theme-live.mjs:13-16` uses), never sampled from a PNG.
- [ ] **Vision must not be used for a product claim.** If a card looks wrong while DoD 1 and DoD 2
  are green, the finding is a UI finding for the theme bundle's owner, recorded as such — never a
  catalogue edit made to please a screenshot.

capture: **required, conditional on the GUI and on A1's seam — never silently skipped.**

- [ ] Command: `node scripts/check-theme-live.mjs --only gallery,skins --shots <dir outside the
  repo>`. Its gallery section reads the expected card count **from `gallery.json` itself**
  (`check-theme-live.mjs:1543` reads the shipped document, `:1561` compares the cards, `:1573` the
  route's answer), so four added entries cannot make it stale. That section needs the **isolated
  sandbox**: with the real profile it prints its reason and **returns** (`:1541-1542` — skipped, not
  failed). Exit **3** means the page could not be opened (`:176`, no Chrome or no signed page) or the
  Theme page is unreachable (`:499`).
- [ ] Captures to keep, named in the sortie: `a8-gallery-light`, `a8-gallery-dark`,
  `a8-gallery-narrow` (430 px), `a8-skin-immobilier-light`, `a8-skin-ecommerce-light`,
  `a8-skin-avocats-dark`, `a8-skin-education-light`.
- [ ] These files live **outside** the repository: `node scripts/garde-depot.mjs` rejects media in git
  (repo rule 4); it prints 0 error and 1 pre-existing warning today. The sortie names the folder; git never sees a PNG.
- [ ] If the capture cannot be produced (exit 3): the sortie records the exact exit code and message,
  the item stays **open**, owned by A1's camera, and a skipped gallery section (`:1542`) is recorded
  as **skipped with its printed reason**, never as a pass.

maquette: **present, and the reason is a measured gap** — no mockup exists for these four sectors.
Measured at `2ac67fb4`: `docs/handoff/` holds exactly three folders, `theme-medecin`,
`theme-recrutement-ssii`, `webapp-creator`; there is no rental, e-commerce, law-firm or education
mockup, and this batch invents none. What plays the mockup's role, and what is therefore reviewed:

- [ ] The **pattern** of the two tracked mockups is the reference, not a picture: one accent hex per
  sector, drawn as `--vb-accent` (`docs/handoff/theme-medecin/maquette-v1/maquette.html:23` →
  `#1B7F76`, `docs/handoff/theme-recrutement-ssii/maquette-v1/maquette.html:23` → `#4F5BD5`), a light
  ground for the medical one and a dark ground for the recruitment one. The four new styles follow the
  same pattern and cite the same two lines as the design precedent.
- [ ] The **review surface is an existing primitive**, not a drawn screen: the gallery card
  (`client.js:2092-2107`, install at `:2142`) and the wizard's live miniature (A1's). A mockup of a
  custom screen would be the "custom screen smuggled into a pack" the build contract forbids, and it
  would be a *new* surface this campaign did not ask for.
- [ ] The **sector look is judged where it lands**: the gallery card (vision above) and the installed
  skin. If the métier read-back (contract 7) needs a designed reference per sector, that is a design
  deliverable (owner's), not this data batch — recorded as a platform-evolution request below, not
  smuggled into the perimeter.

unit: the deterministic levels the four data files must satisfy, and the traps that turn existing
suites red.

- [ ] **L1 — catalogue rules.** Each new `catalog/themes/<id>.json` goes through `sanitizeTheme`
  (`themes-catalogue.mjs:44-62`): id matches `THEME_ID_RE` (`:25`, ≤ 40), `name` ≤ 40 and `author` ≤
  60 required (`:33`, `:47-50`), **`description.fr` and `.en` both required** ≤ 200 (`:51-54`), `v` an
  integer ≥ 1 (`:55`), **an accessibility key is refused, not trimmed** (`:57-58`) — the batch adds
  none, ever — and `settings` must be non-empty and survive `sanitizePreset`
  (`preset-store.mjs:92-115`). File name must equal `<id>.json` (`scripts/themes-catalogue.mjs:43`).
- [ ] **L2 — the silent-drop trap (the one that bites).** `sanitizePreset` **drops** an unknown
  settings key (`preset-store.mjs:104`); the page drops what it does not know too
  (`client.js:933-948`). Two different silent failures follow: an **unknown** key is dropped on both
  sides (the file looks right, the screen never changes), and an **upper-case** hex survives the host
  but is rewritten by the page, so the entry no longer round-trips. DoD 1 compares the raw and cleaned
  key sets and requires lower-case hexes; DoD 5 requires the page's own normaliser (`galTheme`,
  `client.js:2100-2107`) to leave each new entry **unchanged**.
- [ ] **L2bis — the canonical form, measured on A3 (the trap that actually bit).** The page compares
  the round trip as a **JSON string** (`test-client.mjs:1304`), so two rules bind a file that the host
  happily accepts: **lower-case hexes** (`toHex`, `client.js:83`, applied to `acc` at `:935` and to
  every `ov` value at `:945`) and **`PRESET_KEYS` key order** (`client.js:1867`; `presetSettings`
  rebuilds the object in that order at `:1877-1882`, while the host keeps the file's order,
  `preset-store.mjs:104-108`). A3 shipped the refused combination (upper-case `#1B7F76`/`#4F5BD5`,
  `fontText`/`radius` before `ov`) and was red until its own owner rewrote the two files. The four new files therefore write
  `settings` in exactly this order and case — `mode`, `acc`, `ov`, `fontText`, `radius` — and the
  model file is:

  ```json
  {
    "id": "immobilier-locatif",
    "v": 1,
    "name": "Immobilier locatif",
    "author": "Kybernos",
    "description": {
      "fr": "Le terracotta d’une agence de location, sur fond clair.",
      "en": "A letting agency’s terracotta, on a light ground."
    },
    "settings": {
      "mode": "light",
      "acc": "#b4532a",
      "ov": {
        "light:base": "#faf6f3",
        "light:l1": "#ffffff",
        "light:l2": "#f4ece7",
        "light:side": "#f7f1ec",
        "light:input": "#ffffff"
      },
      "fontText": "inter",
      "radius": "standard"
    }
  }
  ```

  The other three follow the same template: `e-commerce` (light, `#c25e0a`, `inter`, `soft`),
  `cabinet-avocats` (dark, `#7a2236`, `georgia`, `sharp`, `dark:*` overrides), `education` (light,
  `#6c4df6`, `poppins`, `soft`). Their `ov` palettes are PROPOSAL design choices (interpretation 3);
  only `acc` is bounded (interpretation 2).
- [ ] **L3 — the token vocabulary.** `mode` ∈ `{system, light, dark}` (`client.js:933`; the batch uses
  `light`/`dark`), `radius` ∈ `{sharp, standard, soft}` (`client.js:910`), `fontText` one of the
  `FONTS` ids (`client.js:416-450`, the batch uses `inter`, `poppins`, `georgia`), `ov` keys
  `light:|dark:` + a `TOKMAP` token (`:367-380`, the batch uses `base, l1, l2, side, input`) with
  `#rrggbb` values, and the `ov` family must match `mode`.
- [ ] **L4 — gallery identity.** `packages/kybernos-theme/gallery.json` must be **exactly**
  `buildDocument()` (`scripts/test-themes-catalogue.mjs:34-37`) and stay readable by the host
  (`packages/kybernos-theme/test-themes-gallery.mjs:86-87`). It is written only by
  `node scripts/themes-catalogue.mjs build --bump`; a hand edit is red. `seq` comes from
  `catalog/themes/_catalogue.json` (`scripts/themes-catalogue.mjs:52-57`).
- [ ] **L5 — the pack side is untouched, and the link is A2's.** `immo/com/droit/edu` keep their
  keywords, accent, icon, home, menu, agents, goals and starters byte for byte (DoD 4, against
  `2ac67fb4`); the only added key is `theme`, read as `null` when absent; its value equals the
  catalogue file's id, which is the same string in three places (pack key, file name, entry `id`) —
  a mismatch is the classic silent orphan, and DoD 3 fails on it.
- [ ] **L6 — what must not move, and is therefore not patched here.** The shipped pack set is still
  the nine fields plus `recrutement` (`test-domain-pack.mjs:281-284` in the worktree; `:257` at the
  baseline), one colour per field (`:253`), one keyword per field (`:248-250`), the note
  "no path, no markup" sweep (`:322-327` at the baseline, `:352` in the worktree). A8 adds no pack,
  so all of them stay green — and A8 patches none of them.
- [ ] **L7 — the wizard-facing traps of the packs are not re-armed.** Field-from-sentence winners
  (`scripts/test-onboarding.mjs:156-159`), cron labels (`:164`), preview caps (`:173`): A8 adds no
  keyword, no cron and no goal, so the only way to red them is to rewrite a pack — which DoD 4
  forbids.
- [ ] **L8 — the catalogue's own count.** A2's spec calls the count "today 14"; after A3 it is 16 and
  after A8 it must be **20** (`gallery.json`), with the six sector ones present. A test that pins 20
  would be a trap for the next theme; the DoD therefore asserts the six by id and lets the count be
  whatever the folder builds.

DoD: deterministic boolean commands of this repo. **Every one was run on this tree and fails there**
(the observed message is quoted in the table below). Run them from the repository root; none needs a
port, a clock, a network or a write under `<DSH home>`. A box is ticked only when the command exits 0.

- [ ] **D1 — the four sector styles exist, pass the host's rules, carry their pack's accent in the
  page's own canonical form, and are real token overlays.**
  Fails today: `catalog/themes/immobilier-locatif.json: missing` (then the three others).
```bash
node --input-type=module <<'JS'
import { existsSync, readFileSync } from 'node:fs'
import { sanitizeTheme } from './packages/kybernos-theme/themes-catalogue.mjs'
import { SETTINGS_KEYS } from './packages/kybernos-theme/preset-store.mjs'
const PAIRS = [['immo', 'immobilier-locatif'], ['com', 'e-commerce'], ['droit', 'cabinet-avocats'], ['edu', 'education']]
const FONTS_OK = ['inter', 'poppins', 'georgia', 'merriweather']
const TOKENS_OK = ['base', 'l1', 'l2', 'l3', 'side', 'input', 'code', 't1', 't2', 't3', 't4', 'link']
const problems = []
for (const [pack, id] of PAIRS) {
  const pf = 'packages/kybernos-plugin/domains/' + pack + '.json'
  const tf = 'catalog/themes/' + id + '.json'
  if (!existsSync(tf)) { problems.push(tf + ': missing'); continue }
  const p = JSON.parse(readFileSync(pf, 'utf8'))
  const raw = JSON.parse(readFileSync(tf, 'utf8'))
  const v = sanitizeTheme(raw)
  if (!v.ok) { problems.push(tf + ': ' + v.error); continue }
  if (v.theme.id !== id) problems.push(tf + ': id ' + v.theme.id)
  if (v.theme.settings.acc !== String(p.accent).toLowerCase()) problems.push(tf + ': acc ' + v.theme.settings.acc + ' is not the pack accent in lower case ' + String(p.accent).toLowerCase())
  const unknown = Object.keys(raw.settings).filter((k) => SETTINGS_KEYS.indexOf(k) < 0)
  if (unknown.length) problems.push(tf + ': unknown settings ' + unknown.join(','))
  const dropped = Object.keys(raw.settings).filter((k) => !(k in v.theme.settings))
  if (dropped.length) problems.push(tf + ': settings dropped ' + dropped.join(','))
  const s = v.theme.settings
  if (s.mode !== 'light' && s.mode !== 'dark') problems.push(tf + ': mode ' + s.mode)
  if (['sharp', 'standard', 'soft'].indexOf(s.radius) < 0) problems.push(tf + ': radius ' + s.radius)
  if (FONTS_OK.indexOf(s.fontText) < 0) problems.push(tf + ': fontText ' + s.fontText)
  const ov = s.ov || {}
  const keys = Object.keys(ov)
  if (keys.length < 3) problems.push(tf + ': ov has ' + keys.length + ' keys')
  for (const k of keys) {
    const m = /^(light|dark):([a-z0-9]{1,12})$/.exec(k)
    if (m === null || !/^#[0-9a-f]{6}$/.test(ov[k])) problems.push(tf + ': ov ' + k + '=' + ov[k])
    else if (TOKENS_OK.indexOf(m[2]) < 0) problems.push(tf + ': ov token ' + m[2])
    else if (m[1] !== s.mode) problems.push(tf + ': ov key ' + k + ' does not match mode ' + s.mode)
  }
}
if (problems.length) { console.error(problems.join('\n')); process.exit(1) }
console.log('ok: ' + PAIRS.length + ' sector styles, accent = the pack accent in lower case, every token legal')
JS
```
  Why the lower case: the page canonicalises `acc` and `ov` through `toHex` (`client.js:83`, `:935`,
  `:945`) and `test-client.mjs:1304` compares the round trip as a JSON string, so `#1B7F76` comes back
  `#1b7f76`. A3 shipped exactly that, was red on the first reading and green on the last; the rule is
  recorded under *Ground measured while writing* and its ownership is **AMBIGUITY 3**.
- [ ] **D2 — the shipped gallery was rebuilt, never hand-edited, holds the six sector entries, and the
  sequence was bumped.**
  Must be preceded by `node scripts/themes-catalogue.mjs build --bump` — the only writer of
  `gallery.json` (`scripts/themes-catalogue.mjs:66-73`); `git diff --stat` then names **only**
  `catalog/themes/_catalogue.json` and `packages/kybernos-theme/gallery.json`.
  Fails today, two lines: `missing from the built catalogue: immobilier-locatif, e-commerce,
  cabinet-avocats, education` then `seq not bumped (HEAD 5, now 5)` — the manifest is at 5 before the
  batch, and `--bump` makes it 6.
```bash
node --input-type=module <<'JS'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { buildDocument } from './scripts/themes-catalogue.mjs'
const built = buildDocument()
const shipped = JSON.parse(readFileSync('packages/kybernos-theme/gallery.json', 'utf8'))
const ids = built.themes.map((t) => t.id)
const WANT = ['cabinet-medical', 'recrutement-ssii', 'immobilier-locatif', 'e-commerce', 'cabinet-avocats', 'education']
const missing = WANT.filter((id) => ids.indexOf(id) < 0)
const problems = []
if (missing.length) problems.push('missing from the built catalogue: ' + missing.join(', '))
if (JSON.stringify(shipped) !== JSON.stringify(built)) problems.push('gallery.json is not what the sources build (seq ' + shipped.seq + ' vs ' + built.seq + ')')
const head = JSON.parse(execFileSync('git', ['show', 'HEAD:catalog/themes/_catalogue.json'], { encoding: 'utf8' }))
if (!(built.seq > head.seq)) problems.push('seq not bumped (HEAD ' + head.seq + ', now ' + built.seq + ')')
if (problems.length) { console.error(problems.join('\n')); process.exit(1) }
console.log('ok: ' + ids.length + ' themes, seq ' + built.seq + ', the six sector themes present')
JS
```
- [ ] **D3 — the catalogue holds six themes: each of the six packs names its own entry, and each id
  resolves in `catalog/themes/`.** This is the batch's product sentence, expressed as one command.
  Fails today (measured): `immo: theme null (want immobilier-locatif)` … and
  `the catalogue holds 2 themes, six expected: sante->cabinet-medical, recrutement->recrutement-ssii`.
```bash
node --input-type=module <<'JS'
import { existsSync, readFileSync } from 'node:fs'
import { sanitizeTheme } from './packages/kybernos-theme/themes-catalogue.mjs'
import { loadPacks } from './packages/kybernos-plugin/domain-pack.mjs'
const WANT = [['sante', 'cabinet-medical'], ['recrutement', 'recrutement-ssii'], ['immo', 'immobilier-locatif'], ['com', 'e-commerce'], ['droit', 'cabinet-avocats'], ['edu', 'education']]
const r = loadPacks('packages/kybernos-plugin/domains')
const problems = []
for (const bad of r.rejected) problems.push('rejected ' + bad.file + ': ' + bad.errors.join(' | '))
for (const [id, theme] of WANT) {
  const p = r.packs.find((x) => x.id === id)
  if (p === undefined) { problems.push('pack not offered: ' + id); continue }
  if (p.theme !== theme) problems.push(id + ': theme ' + p.theme + ' (want ' + theme + ')')
  const tf = 'catalog/themes/' + theme + '.json'
  if (!existsSync(tf)) { problems.push(tf + ': missing'); continue }
  const v = sanitizeTheme(JSON.parse(readFileSync(tf, 'utf8')))
  if (!v.ok) problems.push(tf + ': ' + v.error)
}
const themed = r.packs.filter((p) => typeof p.theme === 'string')
if (themed.length !== 6) problems.push('the catalogue holds ' + themed.length + ' themes, six expected: ' + themed.map((p) => p.id + '->' + p.theme).join(', '))
if (problems.length) { console.error(problems.join('\n')); process.exit(1) }
console.log('ok: six themes, each named by its own pack, each resolvable in the catalogue')
JS
```
  **Cross-batch wire: A2-pack-format** (the `theme` key). Measured in this worktree (last reading): landed,
  `loadPacks` returns ten packs and reads `theme` as `null` when absent. At the baseline the key is
  absent from the allowlist (`domain-pack.mjs:71`), so a run at `2ac67fb4` answers
  `rejected immo.json: pack: unknown key "theme"` instead — same red, other reason.
- [ ] **D4 — the four packs changed by exactly one key, and nothing of the cited content was
  rewritten.** *Batch-time proof against the baseline commit: it is meant to pass at acceptance and
  to be re-pinned, not to outlive the campaign as a permanent test of those four files.*
  Fails today: `immo: no theme key` (then `com`, `droit`, `edu`).
```bash
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
const IDS = ['immo', 'com', 'droit', 'edu']
const problems = []
for (const id of IDS) {
  const file = 'packages/kybernos-plugin/domains/' + id + '.json'
  const now = JSON.parse(readFileSync(file, 'utf8'))
  const base = JSON.parse(execFileSync('git', ['show', '2ac67fb4:' + file], { encoding: 'utf8' }))
  const want = Object.keys(base).concat('theme').sort()
  if (JSON.stringify(Object.keys(now).sort()) !== JSON.stringify(want)) problems.push(id + ': keys ' + Object.keys(now).join(','))
  const { theme, ...rest } = now
  try { assert.deepStrictEqual(rest, base) } catch (e) { problems.push(id + ': its content is not the shipped pack any more (only a theme key may be added)') }
  if (typeof theme !== 'string') problems.push(id + ': no theme key')
}
if (problems.length) { console.error(problems.join('\n')); process.exit(1) }
console.log('ok: four packs, one added key each, no content rewritten')
JS
```
- [ ] **D5 — the four new entries are in the shipped gallery and the page's own check keeps every
  theme unchanged.** The first command must exit **0**: it is green on the last reading,
  `✓ 450 passed, 0 failed` and the batch may not redden it — the entry shapes of *unit:* L2bis are
  exactly what that check requires. The second reads its output for the record and asserts the four
  ids are present and that no theme is rewritten.
  Fails today: `missing from the shipped gallery: immobilier-locatif, e-commerce, cabinet-avocats, education`.
```bash
node packages/kybernos-theme/test-client.mjs > /tmp/kb-a8-client.out 2>&1 && node --input-type=module <<'JS'
import { readFileSync } from 'node:fs'
const NEW = ['immobilier-locatif', 'e-commerce', 'cabinet-avocats', 'education']
const gallery = JSON.parse(readFileSync('packages/kybernos-theme/gallery.json', 'utf8'))
const ids = gallery.themes.map((t) => t.id)
const out = readFileSync('/tmp/kb-a8-client.out', 'utf8')
const line = out.split('\n').find((l) => l.indexOf("every theme comes through the page's own check unchanged") >= 0) || ''
const at = line.indexOf('— ')
let offenders = []
try { offenders = at >= 0 ? JSON.parse(line.slice(at + 2).trim()) : [] } catch (e) { offenders = ['<unparsed>'] }
const problems = []
const missing = NEW.filter((id) => ids.indexOf(id) < 0)
if (missing.length) problems.push('missing from the shipped gallery: ' + missing.join(', '))
if (offenders.length) problems.push("rewritten by the page's own check: " + JSON.stringify(offenders))
if (problems.length) { console.error(problems.join('\n')); process.exit(1) }
console.log('ok: the four new entries are in the gallery and the page keeps every theme unchanged (' + ids.length + ' themes)')
JS
```

**Failures recorded on this tree (run 2026-10-28, during this writing, before any write to the
batch's files)**

| Command | Exit | Message (verbatim, first line) |
|---|---|---|
| D1 | 1 | `catalog/themes/immobilier-locatif.json: missing` |
| D2 | 1 | `missing from the built catalogue: immobilier-locatif, e-commerce, cabinet-avocats, education` |
| D3 | 1 | `immo: theme null (want immobilier-locatif)` / `the catalogue holds 2 themes, six expected: sante->cabinet-medical, recrutement->recrutement-ssii` |
| D4 | 1 | `immo: no theme key` (`com`, `droit`, `edu` the same) |
| D5 | 1 | `missing from the shipped gallery: immobilier-locatif, e-commerce, cabinet-avocats, education` |

**Regression gate — green today, therefore *not* a DoD (a red here blocks the merge anyway).**
Measured on this worktree, 2026-10-28 (last reading):
`node packages/kybernos-plugin/test-domain-pack.mjs` → **52 checks passed**, exit 0;
`node scripts/test-themes-catalogue.mjs` → `OK — themes catalogue publishing (30 checks)`, exit 0;
`node packages/kybernos-theme/test-themes-gallery.mjs` → `OK — themes gallery (56 checks)`, exit 0;
`node scripts/test-onboarding.mjs` → `all checks passed`, exit 0;
`node scripts/garde-depot.mjs` → `1951 tracked files — 0 error(s), 1 warning(s)`, exit 0 (the one
warning is a hard-coded personal path in `docs/tests/gate-verdicts-final.md`, the campaign artifact —
pre-existing, not this batch's, and **this batch's file adds none**; the count moves with the tree,
the verdict does not). After the batch, the pack suite must still print **52** and the
catalogue suite still **30** — the four added entries must not change the number of catalogue checks.

**Baseline honesty (D8 of the campaign's verdicts): the full suite is NOT green, and this document
does not claim it is.** Measured twice, because the tree moved between the two runs:
`node scripts/run-all-tests.mjs` → **529 test files in 191 s: 516 green, 13 RED** (first run) and
**529 test files in 180 s: 517 green, 12 RED** (last run, identical before and after the GO commit).
Exit 1 both times; the file that went green is `packages/kybernos-theme/test-client.mjs`, fixed by
A3's owner between the two runs — see *Ground measured while writing*. The 12 are attributed as
far as the messages allow — none of them a file of this batch, and A8 must not make it 13:

| red file | attributed to | the failing line, verbatim |
|---|---|---|
| `scripts/test-consistency-guards.mjs` | unattributed, pre-existing | `expected: [], operator: 'deepStrictEqual'` |
| `scripts/test-help-mounts.mjs` | untracked neighbour `kybernos-log` | `kybernos-log: help.json is shipped, client.js never mounts __KB_HELP__.Help` |
| `scripts/test-help.mjs` | docs gap, pre-existing | 11 bundles with no help article (`kybernos-hub`, `kybernos-plugin`, `kybernos-registry`…) |
| `scripts/test-layout.mjs` | `kybernos-log` | `LAYOUT — 21 checks, 2 failure(s)` |
| `scripts/test-no-french-literals.mjs` | `kybernos-log` + the uncommitted diff | `380 ✓ 2 ✗` |
| `scripts/test-no-legacy-hosts.mjs` | uncommitted diff (fallbacks vs `BUILTIN_API`) | `https://api.kybernos.app <> https://server.kybernos.app` |
| `scripts/test-plugin-scan.mjs` | `kybernos-pulse` | `kybernos-pulse → exec: helper/gen-icon.mjs:9` |
| `scripts/test-readmes.mjs` | `kybernos-log` | `each one is linked from README.md — ["kybernos-log"]` |
| `scripts/test-signposts.mjs` | `kybernos-log` (`help.json:8,9,21,22`) | `« Journal d’activité (groupe Système) » is not a page of the Settings menu` |
| `packages/kybernos-plugin/test-menu-icons.mjs` | neighbours' menu rows (`aiteams`/`deliverables`/`documents` vs `projects`) | `1 failed` |
| `packages/kybernos-plugin/test-settings-nav.mjs` | `kybernos-log` | `every registered settings page has a key in KB_NAV_KEYS — ["kybernos-log"]` |
| `packages/kybernos-servers/test-host.mjs` | neighbours' server work | `8 failed` |

The campaign artifact counted **10** RED at 03:35; this spec measured **13** on its first run and
**12** on its last — the number is measured each time, never quoted, and it moves under the
neighbours' hands. The merge gate is therefore read as **"0 red caused by this batch"**, and the
merge message names the 12 instead of pretending the suite is clean. None of the 12 belongs to this campaign as of the last
reading.

## Out of scope (what this batch must not do)

- **Any new pack file**, and any rewrite of `immo`, `com`, `droit`, `edu` beyond one added key: no new
  keyword, no new goal, no new starter, no new automation, no second accent, no `mode`/`agents` change.
- **New skills folders.** The four packs already name the skills they use (bundled `kybernos:*` names
  and verified third-party ones), and `test-domain-pack.mjs:209-225` reddens on a bundled folder no
  pack names; the delegation says to use the shipped ones, and this batch creates none.
- **The installer, the wizard, any `packages/kybernos-plugin/client.js` line**, the Kit step and the
  apply-seam call (A1-theme-seam / A1-kit-wizard), any `packages/kybernos-theme/client.js` line.
- **Any change to `domain-pack.mjs`, `index.js`, `onboarding-state.mjs`, `registry.mjs` or any test
  file** — A2-pack-format, A2-registry-points, A3 and A1 own them, and this batch writes no test.
- **UI**: no new page, no new panel, no dashboard, no listing, no miniapp, no Settings screen. The
  style is a token overlay and only the existing gallery card and wizard miniature display it.
- **Signing**: `catalog/themes.catalog.json` / `.sig` and `keygen --embed` are the maintainer's (repo
  rule 7). A8 touches no key and no signature.
- **Raising `seq` by more than the one `build --bump`** does, and hand-editing `gallery.json`.
- **`dsh-compat.json`** and every engine surface: data only, no surface, no engine patch.
- **Fixing the canonical form of a catalogue theme** (`sanitizeTheme`'s key order and hex case —
  AMBIGUITY 3) or any of the 12 pre-existing reds.
- **French prose in this repo's docs**: English only (repo rule 6) — the four `description.fr` fields
  are product data, which is a different thing.

## Cross-batch wires — recorded, never patched from here

| Wire | What A8 needs | State measured 2026-10-28 (last reading) | Evidence |
|---|---|---|---|
| A2-pack-format | the `theme` key on a pack, read as `null` when absent | **landed in the worktree** — `loadPacks` returns ten packs, `theme` present; absent at the baseline | `domain-pack.mjs:71` (baseline, no key), `:187` (baseline, cleaned pack); A2 interpretation 1-3 |
| A2-pack-format | the exact-set assertions of `test-domain-pack.mjs` made tolerant | **landed the same morning** (false at the first measurement, true at the second): 52 checks green | `test-domain-pack.mjs:257`, `:290`, `:322-327` (baseline); worktree `:281-284`, `:318`, `:352` |
| A3-vertical-content | `sante -> cabinet-medical`, `recrutement -> recrutement-ssii`, and their two style sources | **landed** | `catalog/themes/cabinet-medical.json`, `recrutement-ssii.json`; gallery 16, seq 5 |
| A1-theme-seam / A1-kit-wizard | the wizard applies the style the pack names, and shows it in the miniature | **not verified here** (A1's surface) | `docs/dev/domain-packs.md:108` still says « next » |
| A4-starter-docs | the "Build a theme" page and the PROPOSAL label in public docs | **absent** | strategy `:164` |
| A5-style-rename | the words: this document says *theme* for the unit and *style* for the overlay, never the reverse | **sequenced last** | naming banner of every campaign spec |

## Platform-evolution requests (a need no primitive covers — written, never smuggled)

1. **A per-sector design reference.** The campaign has two mockups (medical, recruitment) and none for
   rental, e-commerce, law or education. Reviewing four sector looks from a gallery swatch is honest
   but thin; a designed reference per sector would let the métier read-back (contract 7) happen — it
   is a design deliverable, not a data file, and it is not this batch.
2. **A first-class "proposal" provenance marker** for a cited-but-unratified datum (the four accents).
   Today the label lives in prose beside the file because the frozen catalogue shape has no free-text
   key and `sanitizeTheme` refuses unknown ones — the same gap A3 recorded.
3. **A validator for a pack's inline automations.** "Draft-only" is a content rule proven by citation
   (`immo.json:112-113`, `com.json:106-107`, `droit.json:158-159`, `edu.json:126-127`); only
   contributed `automations/` templates have a `guard` requirement (A2's
   `kybernos/core#automation-template`). One line in `validatePack` could require a guard sentence in
   every inline prompt — a product decision, not this batch's.

## Verified anchor ledger (read at `2ac67fb4`, never remembered)

| Claim | Anchor |
|---|---|
| rental identity: `v`, `id`, `order 30`, `accent #B4532A`, `icon house`, name, tagline | `packages/kybernos-plugin/domains/immo.json:2-14` |
| rental keywords, home `doc,image,website`, `legacyJobs: []`, menu labels, `documents` hidden, agents `balanced` + why | `immo.json:15-33`, `:34-38`, `:39`, `:40-62`, `:63-69` |
| rental goals (leads, listings, visits, valuation, tenants), starters, draft-only prompts | `immo.json:70-321`, `:118`, `:169`, `:217`, `:258`, `:315`, `:112-113`, `:211-212` |
| e-commerce identity `order 60`, `accent #C25E0A`, `icon bag`; home, menu, agents, goals, starters, draft-only | `com.json:2-6`, `:7-14`, `:36-40`, `:45-58`, `:60-66`, `:67-273`, `:118`, `:181`, `:215`, `:267`, `:106-107` |
| law-firm identity `order 40`, `accent #7A2236`, `icon scales`; home, menu, agents, goals, starters, read-only prompt | `droit.json:2-6`, `:7-14`, `:33-37`, `:41-62`, `:64-70`, `:71-303`, `:116`, `:164`, `:215`, `:263`, `:297`, `:158-159` |
| education identity `order 10`, `accent #6C4DF6`, `icon cap`; home, menu, agents, goals, starters, plan-only prompt | `edu.json:2-6`, `:7-14`, `:40-44`, `:48-69`, `:71-77`, `:78-339`, `:133`, `:187`, `:235`, `:285`, `:333`, `:126-127` |
| pack allowlist (14 keys, no `theme` at the baseline), `order` 1..99, accent `#rrggbb`, `ICONS`, `LIMITS`, cleaned pack | `packages/kybernos-plugin/domain-pack.mjs:71`, `:75`, `:76`, `:23`, `:28`, `:187` |
| `validatePack`, `en` required / `fr` optional, loader, the point, the contributed clamp | `domain-pack.mjs:68-188`, `:47-58`, `:202-219`, `:230`, `:233` |
| the shipped-set assertions and the hard content guards | `test-domain-pack.mjs:181`, `:248-250`, `:253`, `:251`, `:257`, `:263`, `:267`, `:271`, `:288-289`, `:290`, `:298-302`, `:304-306`, `:311-313`, `:319`, `:322-327`, `:401`, `:209-225` |
| catalogue rules: id ≤ 40, name/author/description bounds, two languages, a11y refused | `packages/kybernos-theme/themes-catalogue.mjs:25`, `:33`, `:44-62`, `:47-54`, `:57-58` |
| preset rules: `ID_RE` 64, `SETTINGS_KEYS` 37, `HEX6`, `OV_KEY`, `sanitizePreset`, silent drop | `packages/kybernos-theme/preset-store.mjs:26`, `:43-52`, `:63`, `:64`, `:92-115`, `:104` |
| the page's normaliser: `mode`, `acc` canonicalised, `fontText` legal only if in `FONTS`, `ov` | `packages/kybernos-theme/client.js:929-950`, `:933`, `:935`, `:937`, `:945` |
| `toHex` prints lower case (why A3's two reddened the round trip) | `client.js:83` |
| gallery card, page-side a11y strip, install call | `client.js:2092-2107`, `:2098`, `:2142` |
| `TOKMAP` tokens, `FONTS` ids, `radius` enum | `client.js:367-380`, `:416-450`, `:910` |
| the round-trip check (it caught A3's two; green on the last reading) | `packages/kybernos-theme/test-client.mjs:1304` |
| source scanning, file name = id, `--bump`, shipped path | `scripts/themes-catalogue.mjs:27`, `:38-49`, `:43`, `:52-57`, `:66-73` |
| gallery must equal what the sources build; host reads it | `scripts/test-themes-catalogue.mjs:34-37`, `packages/kybernos-theme/test-themes-gallery.mjs:86-87` |
| live gallery check reads its own count, needs the sandbox, exits 3, install shape | `scripts/check-theme-live.mjs:1543`, `:1561`, `:1573`, `:1541-1542`, `:176`, `:499`, `:1627`, `:13-16` |
| what applying a pack does: automations `active:false`, saved choice | `docs/dev/domain-packs.md:65-75`, `:70`, `:71` |
| "Theme per field" still « next » | `docs/dev/domain-packs.md:108` |
| the domain route seam (no new route in this batch) | `packages/kybernos-plugin/index.js:10719-10727` |
| the two design precedents and their accents | `docs/handoff/theme-medecin/maquette-v1/maquette.html:23`, `docs/handoff/theme-recrutement-ssii/maquette-v1/maquette.html:23` |
| Phase A's two verticals, then rental and e-commerce; token-overlay rule; cited-or-labelled | `docs/etudes/2026-10-27-sector-packs-strategy.md:162-164`, `:94`, `:95-96`, `:157-167` |
| the wizard-facing traps an added pack would arm | `scripts/test-onboarding.mjs:156-159`, `:164`, `:173` |
| baseline discipline, recruitment accent decision, mockups verified | `docs/tests/porte-go-verdicts.md:29-33`, `:50-57` |
| the campaign's gate artifact, 10 RED at 03:35 | `docs/tests/gate-verdicts-final.md:2-30` |

Every value this document could not cite is marked **PROPOSAL** above: the four theme ids and names,
the four `mode`/`fontText`/`radius` choices and their `ov` palettes, and the four theme names. The
four accents are **cited** from the packs (`immo.json:5`, `com.json:5`, `droit.json:5`, `edu.json:5`)
and stay **labelled PROPOSAL**, because a pack's colour is a design choice, not a métier's official
hex.

## What the PR must quote (short, per `AGENTS.md` rule 10)

The four new files' ids and accents with their pack lines; the one-line diff of the four packs; the
`build --bump` output (`20 themes, seq N`) and `git diff --stat` naming only the manifest and the
gallery; the D1-D5 commands and their green last lines; the six-theme line of D3; and the measured
red count of the day with the 12 attributed files — never a claim that the suite is clean.
