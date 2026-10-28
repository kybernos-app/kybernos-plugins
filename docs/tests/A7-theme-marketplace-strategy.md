> **Naming (owner, 2026-10-28).** THEME = the installable sector unit (style + configuration + kit);
> STYLE = the visual layer (the token overlay; `packages/kybernos-theme` becomes the style layer at A5);
> PLUGIN = DSH code modules; KIT = the first-run selection. Code paths keep the old words until A5 lands.

> **Baseline: `2ac67fb4`.** Every `file:line` below was re-read with `git show 2ac67fb4:<path>` on 2026-10-28 and is
> pinned to that commit, never to the moving worktree (the GO batches are being implemented in it right now). Where a
> number could be read in either tree, this file says which one it means. Re-pin at the opening of the implementation.
> **Carve-out, campaign files:** four files postdate the baseline and are cited **as they stand on disk today**, not at
> `2ac67fb4` where they do not exist (measured 2026-10-28: `git cat-file -e 2ac67fb4:<path>` fails on each):
> `docs/tests/porte-go-verdicts.md`, `docs/tests/gate-verdicts-final.md`, `docs/tests/gate-verdicts-marche.md` and
> `docs/tests/A5-style-rename-strategy.md`. **Carve-out, the A6 wire:** `docs/tests/A6-theme-installer-strategy.md` is
> untracked today (not at `2ac67fb4` either). Its writer is amending it while this file is written (452 lines, then
> 455, measured in this session), so **A6 is cited by section, never by line**: `§file` (its file table), `§flow`
> ("The flow this batch freezes"), `§wire` (its cross-batch wires), `§GET` ("What the GET answers…"), `§yield`
> ("What A7 keeps, what it drops…"), `§owe` ("What this batch does not owe A7"), `§INT4`/`§INT5`/`§INT6`,
> `§AMB1`…`§AMB6`, `§venue` ("The venue grant (M2)"), `§unit`, `§scope`. A6 pins this file the same way it asks to be
> read — "no line pin, its revision is moving" (A6 `§yield`). **Carve-out, the seam adoption (M7):** A6 `§unit`'s line
> adopting `{ source: 'catalogue', id, version }` for both `__KB_THEME_INSTALL__` and `__KB_THEME_REMOVE__` is an
> owner adoption of **2026-10-28**, cited as "A6 `§unit`, adopted 2026-10-28"; A6's writer is still amending the
> section around it, so it carries no line pin either.
> The six other Phase A specs (A1-theme-seam, A1-kit-wizard, A2-pack-format, A2-registry-points, A3-vertical-content,
> A4-starter-docs) do exist at the base commit (measured) and are pinned there like any code file.

> **Revision 2 — the merge (M1).** Revision 1 froze its own catalogue wire, on the premise that A6 was not on disk.
> A6 is on disk and the owner ratified **A6's shape** (M1, `docs/tests/gate-verdicts-marche.md:79-100`, campaign file,
> post-baseline). This revision therefore **yields the source**: it drops its own catalogue document, reader, path and
> route, consumes A6's verifier and `GET /kybernos/themes`, and rewrites the fixtures that had baked the old shape
> (D1, D2, D4 and D8 of this file). Its page is no longer a page of its own: the listing is drawn inside **A6's ONE
> `Themes` page** (M4), and this batch keeps only the listing's Settings entrance, three granted table rows (M2). What
> did **not** change: the six sections, eight discriminative DoDs on real repo commands, the four level labels, the
> card/kit/state decomposition, the maquette-and-capture discipline, the honest state vocabulary, and the regression
> attribution. Everything M1 touched is listed in "Bound decisions, applied" and in the corrections.

> **Revision 3 — the gate's fixes (M6-M9, correction cycle 2 of 2).** One substantive fix, three non-flipping
> slips, nothing else. **M8:** D2's forbidden list drops the literal `sha256` **only** — `createHash`/`createPublicKey`
> already forbid hashing, and the pure block must carry `sha256` as a card field and check `entry.archive.sha256`
> (else no conforming implementation could make D2 exit 0). **M6:** the plugin README's sidebar sentence (`:15-18`)
> is this batch's own hunk, not A6's edit; A6's four-file perimeter stands unchanged. **M7:** both ends of the install
> seam are frozen — A6 `§unit` adopts `{ source: 'catalogue', id, version }` for `__KB_THEME_INSTALL__` and
> `__KB_THEME_REMOVE__` (2026-10-28), so the wires row is backed by a line instead of a promise. **M9:** D4's
> "registered once in the whole tree" narrows to its real grep, the `kybernos-models/client.js` cite keeps its
> `packages/` prefix, and correction 11 is refreshed to A6's current §owe sentence. What the gate praised is intact
> and untouched: the M1-M5 yield, the M2 line sets, and the INT6/E1/V8/D7 holds.

# A7-theme-marketplace — test strategy (written before the code)

| | |
|---|---|
| Batch | `A7-theme-marketplace` — *browse THEMES by sector inside the one Themes page, and hand one to A6's installer in one click* |
| Campaign | Phase B of `docs/etudes/2026-10-27-sector-packs-strategy.md` (§5 "from signed catalogue to marketplace", `:116-129`; §8 Phase B, `:169-176`) |
| Lane | **B — standard** (M1 removed the pre-auth route this batch used to add; see "Lane") |
| Author role | `redacteur-spec` — this file only; no code, no test module, no data file touched |
| Binding contract | skill `contrat-pack-vertical` (primitives first, custom UI in Settings, one data hex per sector, cited or labelled); `AGENTS.md` |
| Depends on | **A6-theme-installer** — its signed catalogue, its verifier, its `GET /kybernos/themes`, its one `Themes` page and its `__KB_THEME_INSTALL__` seam. **A7 lands after A6** and mints none of them (M1). |
| Verdict on disk | `docs/tests/gate-verdicts-marche.md:79-100` (AMEND, this revision is the answer) — campaign file, post-baseline |
| Status | spec; **baseline `2ac67fb4`**; the catalogue is **A6's** |

**Revision 2 consumes A6 instead of restating it**: the catalogue document and its signature rules
(`plugin-contract.md:460-467`), the five levels (`:415-421`), the verifier (A6 `§file`, `§unit`), the route and the
record (A6 `§wire`, `§unit`), the page and its seam (A6 `§file`), the plan (A6 `§unit`). It also consumes the pack format (`docs/tests/A2-pack-format-strategy.md:95-96`), the style
seam (`A1-theme-seam-strategy.md:56`), the registry's provenance rule (`packages/kybernos-registry/registry.mjs:47`) and the accent invariant
(`A3-vertical-content-strategy.md:48`).

## What the batch ships

The listing is a **view over A6's verified catalogue**, drawn in A6's `Themes` page — the page primitive of the core
plugin bundle (`view: 'themes'`, a `KybersMain` branch, one menu row, one `__KB_OPEN__.views` entry: A6's three venue
lines, `packages/kybernos-plugin/client.js:15849-15861`, `:26169`, `:26468-26469`). A7 owns two blocks of that same
file and exactly **three granted table rows**; it opens no page of its own, because M4 resolved the two "Thèmes" pages
into one.

| File | What changes |
|---|---|
| `packages/kybernos-plugin/client.js` | the listing, in two marked blocks: `KB-MARKET-PURE-BEGIN/END` (the pure helpers — cards from A6's answer, level labels, the kit sentence, the states, the install gate) and `KB-MARKET-UI-BEGIN/END` (the listing component, its Install action, and the `settings.section` `kybernos-themes-market` that registers the same component). **Three GRANTED lines**, nothing else outside the two blocks: `KB_NAV_KEYS` (`:3005-3016`) gains `'kybernos-themes-market': 'themes'`; the look group's `mots` (`:33675`) gains `themes` after `theme`; `ICONES` (`:33696`) gains a drawing under `'themes'` |
| `packages/kybernos-plugin/test-theme-market.mjs` | **new** — the unit layer: the pure block imported from `client.js` (the `KB-OB-CORE` idiom, `scripts/test-onboarding.mjs:14-18`), the cards, the levels, the states, the install gate against a fake seam |
| `packages/kybernos-plugin/README.md` | two hunks, **both this batch's own** (M6): the sidebar sentence (`:15-18`) gains the **Themes** page entry, and the Settings-sections sentence (`:23`) gains the new **Themes** section. A6's four-file perimeter is unchanged and touches no README, so this file carries no "A6's edit" |
| `docs/handoff/theme-market/maquette-v1/` | **new** — the validated mockup and its `maquette.json` (the `maquette:` section), **outside git** |

**Nothing else.** No new bundle, no new route, no reader, no catalogue path, no document `kind`, no new point, no new
permission, no route prefix, no engine patch, no `dsh-compat.json` bump, no data file, no `catalog/**`, no `gallery.json`,
no images in git.

## The shared source — A6's, consumed, never minted

The brief's non-negotiable is *the marketplace and the installer share one source, never two*. Frozen **once**, by A6:

| Artefact | A6's freeze | This batch's use |
|---|---|---|
| **One document** | `kind: "kybernos-plugin-catalogue"`, `schema: 1` (`plugin-contract.md:460-467`), signed as a whole — nothing is parsed before the signature verifies (`:442`) — `seq` only goes up (`:464`) | never read, never parsed, never written: the page sees its *effect* |
| **One verifier** | `packages/kybernos-plugin/theme-installer.mjs` — `verifyCatalogue`, `verifyEntry`, `verifyArchive` (A6 `§file`); the level is `verifyEntry`'s answer (A6 `§unit`) | imported by nothing here: A7 reads the verdict, never a key (`packages/kybernos-registry/host.mjs:10-11` forbids the import anyway) |
| **One route** | `GET /kybernos/themes` (A6 `§file`) under the claimed `/kybernos` prefix (`packages/kybernos-plugin/plugin.json:100-104`, `:103`) | the listing's only read (`D4`) |
| **One record** | `<DSH home>/kybernos/themes.json` — A6's install record and undo snapshot (A6 `§unit`) | the listing shows what is installed from it; it never writes it |
| **One page** | `view: 'themes'` in the Kybernos menu (A6 `§file`), drawn by A6's three lines (`client.js:15849-15861`, `:26169`, `:26468-26469`) | A7's listing block is drawn **inside** it (A6 `§file` declares the listing block as A7's, reading this route) and is also its Settings entrance |

**What the answer carries, and therefore what a card may say.** A6 froze the read's fields (A6 `§GET`): per catalogue
theme its `id` and `version`, the `level` the verifier computed, the embedded manifest's `name`, `description`, `author`,
`licence`, points and permissions (`plugin-contract.md:78`, `:81`, `:86`, `:88`), the archive's `url`/`sha256`/`size`
(`:465`), and the catalogue's own id as its `source`; plus the installed records, the bounded source list and `refused`
with the verifier's own error codes. **Nothing more.** The card draws the manifest's own words, labelled (build
contract 4: cited or labelled). No field is invented, no display record is minted.

**The consequence, stated once and drawn everywhere.** A theme's `accent`, its pack `tagline` and its kit counts live in
its `domains/*.json` and `themes/*.json`, i.e. **inside a package the person has not installed yet** — the signed
catalogue carries a manifest, not a pack. So a card **cannot** show them before the install, and this revision stops
pretending it can (the old D1 fixture invented them; it is gone). They appear **in the report**, from A6's plan
(`planTheme`, A6 `§unit`), the moment the package is staged — the style's accent, the field's words and the kit counts.
The accent invariant A3 froze (`A3-vertical-content-strategy.md:48`) is checked by the plan, and by whoever generates the
catalogue (A6), never recomputed here.

**What this batch does not do with the source.** It never fetches it, never verifies a signature, never writes a
catalogue, never adds or removes a source: the sources are A6's bounded Settings field row (A6 `§INT5`), and **no official
catalogue key exists today** (`themes-pubkey.json` is `{ "keys": [] }`, `packages/kybernos-theme/themes-pubkey.json:1-3`;
A6 `§AMB5` refuses what it cannot verify). The honest default state of the listing is therefore *no source configured
yet*, and A7 cannot pretend the journey is complete without A6 (`e2e` E1 is a report, not a gate).

**What M1 made this batch drop** (each one a claim of revision 1, now absent from the tree and greped by `D8`):
`packages/kybernos-hub/theme-market.mjs`; the path `<DSH home>/kybernos/themes/catalogue.json`; the route
`GET /kybernos-hub/themes`; the document `kind: "kybernos/theme-market"`; the frozen names (`readCatalogue`,
`readCatalogueBytes`, `readCatalogueFile`, `trustOf`, `KIND`, `SCHEMA`, `MAX_DOC_BYTES`, `MAX_THEMES`,
`CATALOGUE_PATH`, `LIMITS`); and `install.spec` — an archive address is `archive.url`, already hashed by the verifier.

## The levels come from A6's verifier — displayed, never computed

Four labels, four proofs, all of them produced **outside** the page. The brief names three; A6's verifier produces a
fourth (`Verified`), and the listing shows it rather than flattening it (`plugin-contract.md:415-421`, A6 `§unit`).

| Label | Shown when | Why the page cannot forge it |
|---|---|---|
| **Official** | `verifyEntry` answered `official`: namespace `kybernos` **and** a key of the official list | the page holds no key, hashes nothing, verifies nothing — `D2` asserts the block contains no `createPublicKey`, `createHash`, `verifyEntry`, `verifyCatalogue`, `officialKeys`. The literal `sha256` is **not** on that list (M8): hashing is what `createHash`/`createPublicKey` would need, while a card **cites** the archive's hash as a field (`marketCards`) and `marketInstallable` checks its presence |
| **Verified** | both signatures (author + reviewer) verified on the same archive hash | same: a countersignature is a fact of A6's answer, not a string a card can write |
| **Community** | the author's signature only | same |
| **Local development** | the entry is a folder of this computer (`file:`, `link:`, a path — the registry's own rule, `packages/kybernos-registry/registry.mjs:47`, stored level at `:98`) | the folder is a fact of the install, not of the document |

**`Unlisted` is not a marketplace level.** It is what DSH's own installer left behind without a catalogue entry
(`plugin-contract.md:415-421`), and A6 neither installs nor updates it (A6 `§INT4`); the listing does not show it. A level
never survives a change (`plugin-contract.md:423-424`): an update re-verifies and the card shows the new answer, never
the old one.

The position of the level in the card is the fourth line (`data-level` on the card, the label in both languages, the
help sentence as a `title`), and the **only** `level` the page reads is the one on the answer's entry (A6 `§GET`). A
manifest that carries its own `trust`, `level` or `official` key changes nothing: the block reads `entry.level` and
nothing else, which is what `D2` asserts on the imported source.

## Interpretations (the request admits several; each choice is argued)

**INT1 — the venue: A6's ONE page, plus the listing's Settings entrance, and nothing else.** M4 resolved the two pages
that shared a name and a job (A6's `Themes` page in the Kybernos menu, A7's `Thèmes` section in Settings) into **one
page**: A6's. A7 adds (a) the listing block inside it, (b) the `settings.section` `kybernos-themes-market` that draws the
same component, so a person who looks in Settings finds the listing there, and (c) the three table rows that make that
section legible (nav key, icon, group word — `packages/kybernos-plugin/test-settings-nav.mjs:117`, `:119`, `:120-121`).
*Rejected*: a hub Settings page of A7's own (revision 1 — it cost a second reader and a pre-auth route, the very things
M1 removes); a Suite segment (not a page); an A7 bundle (`docs/beta/satellites.json`, a glyph the hub can draw, a catalogue rebuild, a
README row, a help card, plus the three nav lines any Settings page needs — seven integration points for a listing).

**INT2 — the shell is the host's, and the component draws the same thing in both hosts.** In Settings the listing uses
the core's Settings template — `.kbm-page` (720 px cap), `.kbm-h1` (18/600), `.kbm-pagehead .kbm-sub` (13 at 6 px)
(`packages/kybernos-models/client.js:2756-2761`, drawn at `:4903-4908`; the cap rule at
`packages/kybernos-plugin/client.js:29311`). In the Kybernos panel the same component gets the panel's chrome. The page
never sets its own width, its own title size or its own radius — the host does — and its own classes use the fresh
prefix `kbtm-` (a class prefix belongs to one bundle, `scripts/audit-css-prefixes.mjs:1-15`); the controls are the
core's `kbm-btn`, `kbm-tag`, `kbm-pill` (the family the validated mockups demand,
`docs/handoff/theme-medecin/maquette-v1/maquette.json:17-23`).

**INT3 — one card per entry, in the answer's order; the sector's name IS the manifest's `name`.** No `sector` field is
invented: the card's first line is `manifest.name[lang]` (`plugin-contract.md:81`), its second the manifest's
`description[lang]` (the author's own sentence, labelled), its identity line the `manifest.id` and the `version`. The
order is the answer's order (the catalogue's `plugins[]`, `plugin-contract.md:465`); the listing does not re-sort, group
or paginate, and it has **no search field** (the brief rules external search out, and a local filter would need a
control the maquette would have to justify).

**INT4 — no swatch on a card, and the accent in the report.** Revision 1 painted the pack's accent on the card from a
catalogue field it had invented. Under M1 that field does not exist (A6 `§GET`), and the honest card carries no colour:
the sector's accent is inside the package. After the click, A6's plan carries the style (`{ id, name, settings }`,
A6 `§unit`), and the report shows one swatch from `settings.acc` — the value A3's invariant pins to the pack's
(`A3-vertical-content-strategy.md:48`, the shipped pack's `#1B7F76` at `sante.json:5`). One hex, one swatch, drawn from
the plan, never recomputed.

**INT5 — "what the kit adds" is A6's plan's counts, in the report.** The card before the click states what the manifest
declares (its `provides` points and its `permissions`, labelled, `plugin-contract.md:93`, `:95`); the kit sentence
("Adds 4 skills, 1 team,
2 automations and 1 connector") reads `plan.kit.skills|teams|automations` (A6 `§unit`), is pluralised per language, omits
an empty count, and says "Adds no kit yet" when all three are empty — never "0 skills". The marketplace is a list, not a
second preview screen: the pack's texts stay where they are read today.

**INT6 — the click is A6's installer, not a new backend.** A7 calls the seam A6 publishes — `window.__KB_THEME_INSTALL__`
(A6 `§file`) — with `{ source: 'catalogue', id, version }`; A6's page stages the inert package through DSH's
manager, verifies it, plans it and applies it (A6 `§flow`). The signature is frozen on **both** ends: A6 `§unit`
adopts the same shape for `__KB_THEME_INSTALL__` and `__KB_THEME_REMOVE__` (A6 `§unit`, adopted 2026-10-28, M7), so
this batch keeps the signature verbatim and neither side can drift alone. A7 never calls `installBundle`, never writes the profile,
never applies the style itself (A6 `§unit`). The one-click rule is M3: the click **is** the person's consent for the
**shell** (style + field); the **kit** keeps the wizard's ticks — everything ticked unless it already exists
(`docs/dev/domain-packs.md:62-63`), an un-ticked item skipped and reported — and an automation is always created
`active: false` with `approvals: "ask"` (`domain-packs.md:39`, `:135`). A7 draws one primary action and no confirmation
dialog.

**INT7 — pure helpers in the marked block, extracted by the tests; the UI block only wires.** The pure block names no
helper of the client factory and holds no React: every string is a `[fr, en]` pair, so `test-theme-market.mjs` imports it
alone from `client.js` (the `KB-OB-CORE` idiom, `scripts/test-onboarding.mjs:14-18`) and draws its results with no
browser. The UI block wires it to the route read, to `window.__KB_THEME_INSTALL__` and to the page's state — the drawing
is proven by the captures, the logic by the unit.

**INT8 — French inside `pair`/`kt`, English everywhere else.** Every user string is a `kt(fr, en)` pair
(`packages/kybernos-hub/client.js:102` — the idiom, the code lives in the plugin bundle); the pure block's pairs feed it,
so `ar` and `es` fall back to English — the repo's one language policy (`scripts/test-no-french-literals.mjs:2-5`). The
README stays English; the unit checks structure (both languages non-empty, no HTML, no French outside a pair), never
wording.

## Bound decisions, applied

| Decision | What it binds | Where this file applies it |
|---|---|---|
| **M1** — the catalogue wire | A6's shape wins: its document, verifier, route, record and page. A7 drops its own and consumes. | "The shared source" (dropped list), D1, D2, D4, D8 rewritten; "Depends on: A6 … lands after" |
| **M2** — the venue's price | both grants ratified, **three lines each, disjoint**; the reviewer reads the diff, not the promise | "Lane": A7's three rows cited (`:3005-3016`, `:33675`, `:33696`), A6's three cited (`:15849-15861`, `:26169`, `:26468-26469`), no shared line or range |
| **M3** — one click | the click is the consent for the **shell**; the **kit** keeps the wizard's ticks; automations off | INT6, `unit` (`marketInstall`), `e2e` E1, `vision` V8, D7 |
| **M4** — A6's defaults | staging order (inert package before the one ask); Remove keeps the kit; ONE `Themes` page; contributed `skills/` write deferred; the official key refuses unverifiable sources | INT1 and INT6 point at A6's `§AMB1`, `§AMB2`, `§AMB4`, `§AMB5` instead of restating them; "OUT OF SCOPE" repeats none of it as a choice |
| **M5** — the re-pins | the gate's non-flipping list, applied exactly; post-baseline cites carved out | corrections 1-9; the head note's three carve-outs (campaign files, the A6 wire, the M7 adoption) |
| **M6** — README ownership | the plugin README's sidebar sentence (`:15-18`) is **A7's** hunk; A7's file table drops the "A6's edit" attribution; A6's four-file perimeter stands unchanged | "What the batch ships" (the README row); anchors row for `:15-18`/`:23` |
| **M7** — the install seam signature | `{ source: 'catalogue', id, version }` is adopted on **both** ends (`__KB_THEME_INSTALL__` and `__KB_THEME_REMOVE__`); A7 keeps the signature | INT6 (both ends frozen); `unit` (`marketInstall`); the wires row, cited "A6 `§unit`, adopted 2026-10-28" |
| **M8** — D2's forbidden list | drop the literal `sha256` **only**; `createHash`/`createPublicKey` already forbid hashing, and the card fields keep `source`/`sha256`/`size` while `marketInstallable` keeps its `archive.sha256` presence check | the levels table's Official row, the `unit` layer (unchanged on purpose), the D2 block and its comment |
| **M9** — the slips | D4's "whole tree" narrows to its real grep (`index.js`, answer 0/1); `packages/` prefix kept on the `kybernos-models` cite; correction 11 re-quoted from A6 | D4 and its notes; V's judgement line; corrections 11 and 16-18 |

## No open ambiguity — four were open, each is now bound

**A7-1 (the catalogue wire) — closed by M1.** A6's shape wins; this batch yields its document/reader/path/route and the
four DoD fixtures that baked them. The veto is one word and costs the **larger** rewrite (it is A6 that would change its
verifiers, its route family and D2, A6 `§yield`): if the owner reverses M1, this spec's "shared source" section
returns as revision 1 wrote it and A6's becomes the consumer.

**A7-2 (what "Official" means) — closed by M1.** There is no A7 rule any more: the four levels are `verifyEntry`'s
verdict (`plugin-contract.md:415-421`, A6 `§unit`), and the page only displays one. The old "Official = a document shipped
inside the bundle" rule is gone with the document — a downloaded document no longer decides anything, because nothing is
read from a document here.

**A7-3 (the venue's price) — ratified by M2.** Three lines in `packages/kybernos-plugin/client.js`, named and cited
above, disjoint from A6's three. A veto is "no Settings entrance": then A7 keeps only the listing block inside A6's page
and drops `KB_NAV_KEYS`/`ICONES`/`GROUPES` and the section registration — a one-hunk deletion, no argument changes.

**A7-4 (one click or a dialog) — ratified by M3.** One click on the card's Install; the click is the shell's consent; the
kit is the wizard's ticks. A veto ("confirm first") adds a dialog that repeats the card, and `unit`'s install-gate title
becomes a dialog test — one test title, no architectural change.

Nothing else in this batch waits on a human: the only judgement left is the reviewer's diff read of the two disjoint
line sets (M2).

## OUT OF SCOPE

- **Ratings, reviews, payments, external search, ranking, categories, install counts, "featured"** — the brief's own
  exclusions and A6's (A6 `§scope`). No stars, no price chip, no search field, no sort, no network call.
- **The catalogue: fetching, signing, verifying, refreshing, updating, and its sources** — A6's (A6 `§wire`, `§INT5`,
  `§AMB5`). No URL is fetched by this batch, no key is read, no `pluginCatalogues` row is written.
- **The installer itself** — A6's: staging, the archive, `sha256`, the install log, the plan, the record, the route
  family, the one-ask screen for "From a folder" (A6 `§flow`). A7 calls the seam and draws the answer.
- **Uninstall / update / version pinning of an installed theme** — A6's card and the registry's Plugins segment
  (`packages/kybernos-hub/client.js:1094`'s "Lire et accepter"). The report offers A6's Remove, never its own.
- **The acceptance (consent) screen** of a plugin that ships instruction data — the registry's Plugins segment owns it
  (`packages/kybernos-hub/client.js:1094`); A6's flow sends it (A6 `§flow`), the listing shows the state it reports.
- **The wizard's Kit step** (`A1-kit-wizard`), **the style layer** (`A1-theme-seam`, `A5-style-rename`), **the pack
  format** (`A2-pack-format`), **the registry** (`A2-registry-points`), **the two verticals' content**
  (`A3-vertical-content`), **the docs page and the starter** (`A4-starter-docs`). Every one is consumed or cited, never
  edited.
- **A new bundle, a new point, a new permission, a new route, a route prefix, an engine patch, a `dsh-compat.json`
  bump.** The route is A6's; the page is A6's.
- **A second listing, a second page, a second reader, a second catalogue path, a second document `kind`** — the five
  shapes M1 removed, each greped by `D8`.
- **The Settings search index** (`KB_SS_INDEX`, `packages/kybernos-plugin/client.js:3054`): the listing is not indexed in
  this batch, stated so nobody reads its absence as a bug.
- **Media in git, personal paths.** The mockup's PNG captures stay outside the repository
  (`scripts/garde-depot.mjs:3`, `:11`).

## Lane

**B — standard.** Revision 1 was A because it added a route to the hub that was served **before DSH's own sign-in**.
M1 removed that route with the reader: this batch adds **no route, no guard, no read of its own**; it reads A6's public
`GET /kybernos/themes` from a page (A6's route, A6's `sameOriginStrict`/`writeRefused` family,
`packages/kybernos-plugin/index.js:10737-10752`), and its only writes are the three table rows and two marked blocks in
`client.js`. No credential, no billing, no RLS, no migration, no secret, no engine patch, no compat bump.

**Falsifier that would flip it to A:** any hunk in `packages/kybernos-plugin/index.js`'s route table or guards, in
`session-guard.mjs`, in `writeGuard`/`sameOriginStrict`, in `hub-host.mjs`, or in a `cordis.patch.yml`; any second
reader/path/route; or any write to the profile, `<DSH home>/kybernos/themes.json` or the style by this batch. If the diff
shows one, the batch is A on the spot.

**The venue grant (M2) — three lines each, disjoint, cited.** Both batches write
`packages/kybernos-plugin/client.js`, so the owner bounded each to its entry point. **A6's three are the install-flow
entry point** (A6 `§venue`): one branch in the page's view table (`client.js:15849-15861`), one entry in
`kbOpenPage.views` (`:26169` — the allowlist a Settings cell reads before it offers to open a Kybernos page,
`:26167-26168`), one `row(...)` in the menu block (`:26468-26469`). **A7's three are the listing entry point**:
`KB_NAV_KEYS` (`:3005-3016`), the look group's `mots` (`:33675`), `ICONES` (`:33696`). The two sets share no line and no
range. The reviewer's check is a diff read: A7's hunks in that file are exactly its three rows plus its two marked
blocks, A6's are exactly its three lines plus its one marked block, and a line of one batch inside the other's hunk is
the NO-GO. A marker line (`// KB-MARKET-PURE-BEGIN`) is not a venue line; it is the block's own boundary.

**A7's listing must not land inside a `KB-OB` block** (A1-kit-wizard's perimeter, `A1-kit-wizard-strategy.md:28`): its
two blocks sit in the page area, and the reviewer checks the diff's context lines.

## Anchors verified at `2ac67fb4` (nothing below is quoted from memory)

| Claim | Verified at | Verdict |
|---|---|---|
| The page primitive A6's page uses: one `view` branch chain, one `views` allowlist, the menu rows | `packages/kybernos-plugin/client.js:15849-15861` (the branch chain, `s.view === '…'`), `:26169` (`Object.defineProperty(kbOpenPage, 'views', …)`), `:26468-26469` (the `row('…')` block) | exact |
| The `views` allowlist is what a caller reads before offering to open a page | `packages/kybernos-plugin/client.js:26167-26168` | exact |
| A page's shell in the panel: `kbg-root` + `data-kb-page` | `client.js:25764` (dashboards), `:25781` (kyber), `:25796` (skills) | exact |
| A settings section is registered through the core slot | `client.js:29690-29692` (Tools), `:30286-30288` (Voice) | exact |
| `KB_NAV_KEYS`: the settings section id → the page's English title | `client.js:3005-3016`; the test builds its titles from it (`packages/kybernos-plugin/test-settings-nav.mjs:36-38`) | exact |
| The group table, and the look group's words in order | `client.js:33662` (`const GROUPES = [`), `:33675` (`{ id: 'look', …, mots: ['theme', 'langue', 'language'] }`) | exact |
| The Interface group holds Theme then Language | `test-settings-nav.mjs:52` (`inOrder(inGroup('look'), ['theme', 'language'])`) | exact |
| The one icon table, keyed by the page's normalised title | `client.js:33691-33696` (the audit comment, then `const ICONES = {`) | exact |
| A bundle's settings page must be in all three tables, or it falls to the tail | `test-settings-nav.mjs:95` (the comment), `:100-114` (the scan of every bundle's `client.js`), `:117`, `:119`, `:120-121` (the three checks) | exact |
| Every title in `KB_NAV_KEYS` sits in exactly one group (so a new key needs a word) | `test-settings-nav.mjs:39` (`where`), `:55` (the one-group check over `PAGE_TITLES`) | exact |
| An icon drawing may not be shared by two pages | `packages/kybernos-plugin/test-settings-icons.mjs` (present at the baseline; reads `ICONES`) | exact |
| The Settings page template: 720 px cap, 18/600 title, 13 px sub at 6 px, radii 10/14 | `client.js:29306-29316` (`:29311` the 720 px rule, `:29314-29315` the radii and the head margin); the sizes themselves at `packages/kybernos-models/client.js:2756-2761` | exact |
| The newest Settings page draws exactly that shell | `packages/kybernos-models/client.js:2756-2761` (the rules), `:4903-4908` (`.kbm-page`, `.kbm-pagehead`, `.kbm-h1`, `.kbm-sub`) | exact |
| A CSS class prefix belongs to one bundle | `scripts/audit-css-prefixes.mjs:1-15` | exact |
| The plugin claims `/kybernos`, the conversation-view slot, and may write `<DSH home>` | `packages/kybernos-plugin/plugin.json:100-104` (the prefix at `:103`), `:51` (`ui.slot:conversation.view`), `:67` (`fs.write:dsh-home`) | exact |
| The route guard order A6's route family follows | `packages/kybernos-plugin/index.js:10737-10752` (method, origin, signed session, bounded body) | exact |
| A pure block is extracted from `client.js` and imported through a `data:` URL | `scripts/test-onboarding.mjs:14-18` | exact |
| A client block is drawn with a stand-in window and `__test` | `packages/kybernos-hub/test-suite-plugins.mjs:10`, `:15-18`; its one import of the core's pack loader is a test file's (`:6`) | exact |
| The hub's own pure block marker (the idiom A7 follows, in the hub, not the plugin) | `packages/kybernos-hub/client.js:295` (`KB-PLUGINS-PURE-BEGIN`) | exact |
| A6's verifier, plan, record, route, page and seams (the wire this batch consumes) | `docs/tests/A6-theme-installer-strategy.md`, sections `§file`, `§flow`, `§wire`, `§GET`, `§yield`, `§INT4`, `§venue`, `§unit` — cited by name, its lines move (head note) | campaign spec, post-baseline (on disk today) |
| A6's unit adopts the seam signature on both ends | A6 `§unit`, **adopted 2026-10-28** (M7) — `{ source: 'catalogue', id, version }` for `__KB_THEME_INSTALL__` and `__KB_THEME_REMOVE__`; an adoption ruling, no line pin (A6's writer is amending the section) | campaign spec, post-baseline |
| The plugin README's two hunks: the sidebar sentence and the Settings-sections sentence | `packages/kybernos-plugin/README.md:15-18` (the **Kybernos** sidebar bullet), `:23` (the Settings-sections bullet) — present at the baseline at those lines | exact |
| A6's four levels and its "the level is `verifyEntry`'s answer" rule | A6 `§INT4` and `§unit`; `docs/dev/plugin-contract.md:415-421` | exact / A6 carve-out |
| The signed catalogue document, its signature, its `seq` | `plugin-contract.md:460-467` (the document and `plugins[]`), `:438-440` (the two signed messages), `:442` (nothing parsed before the signature), `:464` (the `seq` rule) | exact |
| A level never survives a change | `plugin-contract.md:423-424` | exact |
| The manifest's fields a card may draw: `id`, `name`/`description`, `author`, `license` | `plugin-contract.md:78` (`id`), `:81` (`name`, `description`, the 40/240 bounds), `:86` (`author`), `:88` (`license`) | exact |
| Sources, key pinning and the official-key plan | `plugin-contract.md:468-473` | exact |
| Bundles reach DSH only through its manager; a data package loads nothing | `plugin-contract.md:562`, `:551` | exact |
| The person's files live under `<DSH home>/kybernos/` | `plugin-contract.md:552` (`plugins-state.json`) | exact |
| The Plugins segment's cards, Remove and consent display | `plugin-contract.md:561-567` | exact |
| The kit's defaults: everything ticked unless it exists; automations created off | `docs/dev/domain-packs.md:62-63`, `:39`, `:135` | exact |
| The three switch rules (replaces wording/order/choice, adds kit, never touches sessions) | `docs/dev/domain-packs.md:92-93` | exact |
| The style seam's answer, never throwing | `docs/tests/A1-theme-seam-strategy.md:56-57` | exact |
| The kit wire `pack.kit` | `docs/tests/A2-pack-format-strategy.md:95-96` | exact |
| The pack's theme-id vocabulary | `docs/tests/A2-pack-format-strategy.md:100-102` | exact |
| A2 reads a contributed skill folder and writes nothing | `docs/tests/A2-registry-points-strategy.md:57-62` | exact |
| A2's lane line, at the declared baseline (re-pin) | `docs/tests/A2-registry-points-strategy.md:19` | exact |
| The accent invariant | `docs/tests/A3-vertical-content-strategy.md:48` | exact |
| The two verticals are `sante` + `recrutement` | `docs/tests/A3-vertical-content-strategy.md:20-27` | exact |
| A5 renames the *style* page's label and its nav key — never "Themes" | `docs/tests/A5-style-rename-strategy.md:82-84`, `:88` | campaign file, post-baseline |
| The registry's provenance rule and stored level | `packages/kybernos-registry/registry.mjs:47` (`sourceOf`), `:98` (`level: source === 'local' ? 'local' : 'unlisted'`) | exact |
| A symbolic link is refused, never read (re-pin) | `packages/kybernos-registry/registry.mjs:37-39` (`readBounded`: `lstat`, missing, `isSymbolicLink`) | exact |
| The registry's preview, the plan's source, checked before acceptance | `packages/kybernos-registry/registry.mjs:303-316` | exact |
| A bundle's shipped code imports no other bundle's file | `packages/kybernos-registry/host.mjs:10-11` | exact |
| The style catalogue's verifier (a different catalogue, cited not reused) | `packages/kybernos-theme/themes-catalogue.mjs:97` (`verifySignature`) | exact |
| The style catalogue's signature chain has no key today | `packages/kybernos-theme/themes-pubkey.json:1-3` (`{ "keys": [] }`) | exact |
| The pack's bounds, id, colour and unknown-key rule | `packages/kybernos-plugin/domain-pack.mjs:28` (`LIMITS`), `:30` (`ID_RE`), `:37` (`COLOR_RE`), `:71` (`only(...)` refuses any other key) | exact |
| The shipped pack's cited colour and words | `packages/kybernos-plugin/domains/sante.json:5` (`#1B7F76`), `:7-13` (`Health` / `Santé` and the tagline) | exact |
| The core's packs import, beside which A6's own import sits (A6 `§file`, its one line outside its module) | `packages/kybernos-plugin/index.js:30` (`loadPacks` from `./domain-pack.mjs`) | exact |
| The one language policy | `scripts/test-no-french-literals.mjs:2-5` | exact |
| No media; personal paths warn only | `scripts/garde-depot.mjs:3` (the promises), `:11` (`MEDIA`) | exact |
| The fault gate's own flags | `scripts/check-bundle-faults.mjs:2-4` | exact |
| The live-GUI sign-in (signed cookie, never the stale token URL) | `docs/dev/live-testing.md:1-16`; the helper `scripts/live-page.mjs` (present at the baseline) | exact |
| The validated mockups' required controls and their hex allow-list | `docs/handoff/theme-medecin/maquette-v1/maquette.json:12-15` (`minTokens`, `hexAllowlist`), `:17-23` (`requiresControls`) | exact |
| The mockup's real-CSS extraction comment | `docs/handoff/theme-medecin/maquette-v1/maquette.html:7-9` | exact |
| The two cited sector accents, in the mockups' own CSS | `docs/handoff/theme-medecin/maquette-v1/maquette.html:23` (`#1B7F76`), `docs/handoff/theme-recrutement-ssii/maquette-v1/maquette.html:23` (`#4F5BD5`) | exact |
| The Suite catalogue is derived and has a `--check` | `scripts/build-catalog.mjs:3` (the flag's doc), `:231` (`process.argv.includes('--check')`) | exact |
| The four campaign files that postdate the baseline | `docs/tests/porte-go-verdicts.md`, `gate-verdicts-final.md`, `gate-verdicts-marche.md`, `A5-style-rename-strategy.md` — `git cat-file -e 2ac67fb4:<path>` fails on each (measured) | carve-out |

Short names in the table are unique in the tree at the baseline and were resolved mechanically
(`git ls-tree -r --name-only 2ac67fb4`): one `test-settings-nav.mjs`, one `test-settings-icons.mjs`, one
`test-onboarding.mjs`, one `test-suite-plugins.mjs`, one `sante.json`; `client.js` unqualified is always
`packages/kybernos-plugin/client.js`, and the hub's is spelled out. **Every anchor of this file resolves at `2ac67fb4`
except the rows that carry a carve-out — stated in the head note, never implied.** Counted mechanically on this
revision: **58 claims — 53 exact at `2ac67fb4` (the two page-shell and registration rows re-pinned to the measured baseline values on 2026-10-28), 1 mixed (its `plugin-contract` part exact, its A6 part carved out)
and 4 carve-outs** (A5's label row, the row naming the four campaign files, the A6 wire row, and the M7 adoption row
— an adoption ruling of 2026-10-28, not a line re-read today). No A6 row carries a line pin, on purpose. The two
accent hexes are data in the mockups' own CSS, not prose.

**Corrections made in this revision** (each is a citation, or a claim, a reader would have got wrong):

1. **The reader, the path and the route are gone (M1).** Revision 1's "shared source" froze
   `packages/kybernos-hub/theme-market.mjs`, `<DSH home>/kybernos/themes/catalogue.json` and
   `GET /kybernos-hub/themes`; A6 owns the surface and this file consumes `GET /kybernos/themes` (A6 `§wire`).
2. **The document `kind: "kybernos/theme-market"` and its `themes[]` display record are gone.** The one document is
   `kybernos-plugin-catalogue` (`plugin-contract.md:460-467`), and the only fields the page may draw are A6's answer's
   (A6 `§GET`).
3. **The card's accent, tagline and kit counts before the install are gone.** They lived in a catalogue field this file
   invented; they now appear in the report, from A6's plan (A6 `§GET`, its closing sentence).
4. **The venue is A6's page plus the listing's Settings entrance (M2/M4).** Revision 1 opened a hub Settings section
   `kybernos-themes-market` with its own page; the section now registers A7's listing component inside A6's page tree,
   and A7's lines are three table rows.
5. **The symlink refusal is `registry.mjs:37-39`**, not `:216-221` (which is the dependency check) — the gate's re-pin.
6. **The manifest's `author` row is `plugin-contract.md:86`**, not `:93` (`provides`); and the `{1,31}` / `name ≤ 60`
   bounds revision 1 quoted are **not** in the contract: they are this document's own bounds, and the card now uses the
   manifest's real ones (`name ≤ 40`, `description ≤ 240`, `plugin-contract.md:81`).
7. **`KB-PLUGINS-PURE-BEGIN` is at `packages/kybernos-hub/client.js:295`**, not in the plugin's `client.js` — the gate's
   re-pin. A7's own block is `KB-MARKET-PURE-BEGIN`, a new marker in the plugin's file.
8. **A2's lane line is `A2-registry-points-strategy.md:19` at the declared baseline**, not `:64-68` (a post-correction
   line) — the gate's re-pin.
9. **`themes-catalogue.mjs`'s `KIND` (`kybernos-themes`) is the *style* catalogue** (`packages/kybernos-theme/themes-catalogue.mjs:21`),
   never the plugin catalogue A6 verifies: revision 1 compared two documents that were never the same thing.
10. **The look group's word list is `client.js:33675`**, and `:33662` is the `GROUPES` declaration, which revision 1
    quoted as if it held the words.
11. **A6 `§owe` now says "A7's list is A7's code"** (it read "in A7's own bundle" when revision 2 was written), while
    A6's file table (`§file`) puts the listing block in `packages/kybernos-plugin/client.js`. The file table wins;
    that one word is A6's writer's fix, not a second bundle.
12. **The hub pure-block idiom** (`packages/kybernos-hub/client.js:295`) is cited as the *idiom* A7 copies in another
    file; revision 1 attributed it to `packages/kybernos-plugin/client.js:295`, which holds a translation table.

**Corrections made in revision 3** (cycle 2 of 2 — each one is a contradiction a reader would have hit, and one of them
made D2 unreachable):

13. **D2 forbade the very field its own unit requires (M8).** D2's regex listed the literal `sha256`, while `marketCards`
    must return the card's `source`/`sha256`/`size` and `marketInstallable` must check `entry.archive.sha256` — so no
    conforming implementation could make D2 exit 0. The token is dropped from the regex **only**: `createHash` and
    `createPublicKey` already forbid hashing (that is what "hashes or verifies" means), the card keeps the field, and
    the presence check stays. One token, and the unit and its DoD are satisfiable together.
14. **The README's sidebar sentence (`:15-18`) is A7's hunk, not A6's edit (M6).** The file table now claims both hunks
    (`:15-18`, `:23`); A6's four-file perimeter stands unchanged, which is exactly why the sentence cannot be A6's.
15. **The wires row's "A6's amendment freezes both" was unbacked (M7).** It is now a line: A6 `§unit` adopts
    `{ source: 'catalogue', id, version }` for `__KB_THEME_INSTALL__` **and** `__KB_THEME_REMOVE__` (adopted
    2026-10-28), so the wire has both ends frozen and A7 keeps the signature verbatim (INT6, `marketInstall`).
16. **D4's "registered once in the whole tree" overreached its grep (M9).** The grep covers
    `packages/kybernos-plugin/index.js` alone and answers 0 or 1 there; the prose, the failure message and the notes now
    say that, instead of implying a tree-wide scan.
17. **The `kybernos-models` cite had lost its `packages/` prefix (M9).** V's judgement line reads
    `packages/kybernos-models/client.js:2756-2761`, like every other row of the anchor table.
18. **Correction 11's quote of A6 `§owe` was stale (M9).** A6 says "A7's list is A7's code"; item 11 is re-quoted from
    the file as it stands, and the attribution argument is unchanged.

e2e:

**A journey on the real surfaces, reported, not gated — it needs A6's page and A6's route, which land before it.**

- [ ] **E1, the live GUI, in the sandbox first (`scripts/sandbox/setup.sh` then `start.sh`, never `:3080`).** On a
      signed page (`scripts/live-page.mjs`, the signed cookie, never the stale token URL: `docs/dev/live-testing.md:1-16`),
      in this order: open Kybernos ▸ **Themes** (A6's page) and Settings ▸ **Thèmes** (A7's section) — **the same
      listing, the same cards, the same sentences** in both; the empty state reads *no source configured yet* (no official catalogue
      key exists, `themes-pubkey.json:1-3`, and A6 `§AMB5` refuses a source it cannot verify); add A6's source the way A6's Settings row does (a local
      fixture with a generated Ed25519 keypair pinned on first use, A6 `§INT5`, `§AMB5`), reload: **one card per verified
      entry**, in the catalogue's order, each with the manifest's `name[lang]`, its `description[lang]`, the author, the
      version, the licence and the level the verifier computed (`data-level`), and **no swatch** (INT4); a refused entry
      appears only in the "N entries were left out" line; press Install on one card — **one click, no dialog** (M3):
      A6's manager stages the inert package, the plan runs, and the card's report shows what was added (the shell — style
      and field — plus the kit's counts), the automations present **off** in `tasks.json` (`active: false`,
      `approvals: "ask"`), the style's accent visible in the report and on the page, and A6's Remove offered; the
      catalogue document and the source list are byte-identical afterwards; remove the package and the fixture, restore
      the profile exactly as found.
- [ ] **E2, the Settings entrance alone.** In the same sandbox, from Settings ▸ Thèmes only: the listing draws, the
      Install click works, the report is the same — proving the one component is not a menu-only artefact (INT1).
- [ ] **E3, the fault gate.** `node scripts/check-bundle-faults.mjs --only kybernos-plugin --faults throw-apply` (the
      script's own flags, `check-bundle-faults.mjs:2-4`): DSH starts, every other bundle mounts, the plugin's routes and
      page are the only ones lost, and the log names the entry (`AGENTS.md` rule 2, extended to the new blocks).
- [ ] **E4, no drift in the bundle.** `node scripts/run-all-tests.mjs --only kybernos-plugin` → the plugin's suites,
      including `test-settings-nav.mjs`, `test-settings-icons.mjs`, `test-menu-icons.mjs` and the new
      `test-theme-market.mjs`; the two known failures stay exactly the ones attributed in the regression gate.
- [ ] **E5, the merge gate — with the baseline measured, never assumed.** Measured 2026-10-28 on this worktree (HEAD
      `3efbdfdb`, now `a11942f1`: re-measure at the merge): `node scripts/run-all-tests.mjs` → **530 test files in
      177 s: 518 green, 12 RED** (exit 1). The 12 are
      pre-existing and attributed below; none is in this batch's perimeter. The rule is "0 red **caused by this batch**",
      and the merge message names the 12.

vision:

**Applicable — this is a listing drawn in two shells, and the visual pass is where half the batch is judged. Eight
captures, each read with `read_image`; a capture nobody looked at is not a proof.**

- [ ] V1 — the listing with **no source** (the honest default), in Settings, light.
- [ ] V2 — the same in dark.
- [ ] V3 — three cards light (an Official or Verified entry, a Community one, a Local-development one): the level chip,
      the author/version/licence line, the manifest's words, **no colour but the shell's** (INT4); the Install action
      visible on each.
- [ ] V4 — the same three cards in dark; nothing in the card changes colour with the theme, because the card carries no
      data colour.
- [ ] V5 — the **refused** state (a source whose document the verifier refuses): the sentence, and no card.
- [ ] V6 — the **left out** state: one good and one refused entry: one card, and the "N entries were left out" line with
      the reason on demand (the refused entry's id and A6's error code, never invented).
- [ ] V7 — narrow: the Settings pane under ~620 px and the panel at 390 px: cards stack, the Install button stays
      reachable, no horizontal scrollbar, and the shell's 720 px cap holds at the wide size
      (`packages/kybernos-plugin/client.js:29311`).
- [ ] V8 — the **report** after one click: the shell's style row with its one accent hex and its swatch (from A6's plan),
      the kit sentence with its counts, the automations shown off, A6's Remove; the other cards' actions disabled while
      it runs, and the answer shown once it lands.
- [ ] Judgement, not only capture: for each pair, one line on what changed and confirm no element moved; check the page
      head against the template (18/600, sub 13 at 6 px, first block at 20 px: `packages/kybernos-models/client.js:2756-2761`)
      and that every control is the core's `kbm-*` family, measured on the real page.

capture:

**Applicable. The artefacts live OUTSIDE the repository (a `mktemp -d` directory), never in git — a PNG in git is an
error (`scripts/garde-depot.mjs:3`, `:11`).**

- [ ] `listing-answers.json` — the four answers the listing draws from A6's route: no source, one good entry, one
      refused entry, a broken source; plus the 200 of the GET and A6's own 405/403 family (cited, not re-tested here).
- [ ] `cards-fr.html` / `cards-en.html` — the card grid's `outerHTML` in both languages (the i18n proof, text level).
- [ ] `seam-calls.json` — the fake seam's calls during the unit pass (0 at mount, 1 after the click, 0 when the entry is
      refused or the seam is absent), and A6's real manager call in E1 (A6's capture, cited).
- [ ] `levels.txt` — for each card, `data-level` as the route sent it, and the label drawn from it.
- [ ] `report.json` — the report of E1's click: the plan's style id and `settings.acc`, the kit counts, the skipped and
      failed lines, and the record file's `applied` block (A6's `themes.json`, read-only).
- [ ] `console.txt` — the bundle's own lines and the route's `refused:` lines for the refused entry.
- [ ] The eight PNGs of the vision pass, in the same directory; the report quotes their paths, and
      `node scripts/garde-depot.mjs` stays green.

maquette:

**Applicable — the batch ships a screen (a listing and its report), so the mockup comes before the code, at the real
CSS, and it is validated against the product's pages, never drawn from taste.**

- [ ] `docs/handoff/theme-market/maquette-v1/` with the shape the campaign already uses
      (`docs/handoff/theme-medecin/maquette-v1/`: `maquette.html`, `dsh.css`, `maquette.json`, `README.md`), the real CSS
      extracted by the same script (`docs/handoff/theme-medecin/maquette-v1/maquette.html:7-9`:
      `scripts/build-model-catalog-css.mjs`), no remote resource.
- [ ] `maquette.json`: `fidelite` declared (`"simple"` is enough: a listing, a card, a report), `lint.minTokens` ≥ 15
      (tokens, not hexes), `hexAllowlist` = **only** the two cited data hexes `#1B7F76` and `#4F5BD5` (they appear in the
      report's style row, never on a listing card), `requiresControls` = `["kbm-btn", "kbm-tag", "kbm-pill"]` (no
      `kbm-in-wrap`: the listing has no field, INT3), and `render.steps` that play the four states (no source → one card
      → refused → report).
- [ ] The mockup is measured against the real page afterwards (the Settings template's 720 px cap, the 18/600 title, the
      13 px sub at 6 px, the 10 px control radius / 14 px card radius:
      `packages/kybernos-plugin/client.js:29306-29316`, `packages/kybernos-models/client.js:2756-2761`), and the gaps are
      written down, not smoothed over.
- [ ] The sector look comes from the two validated mockups already in the tree — the medical accent at
      `docs/handoff/theme-medecin/maquette-v1/maquette.html:23` and the recruitment one at
      `docs/handoff/theme-recrutement-ssii/maquette-v1/maquette.html:23` — and a third card is marked **PROPOSAL** in
      the mockup when its content is not cited (build contract 4).
- [ ] One dark capture of the mockup is part of the maquette pass; the page's dark proof is V2/V4.

unit:

**The deterministic layer — this is where the batch is actually proven.**

`packages/kybernos-plugin/client.js` — the pure block (`// KB-MARKET-PURE-BEGIN` … `// KB-MARKET-PURE-END`), imported
alone by the test (the `KB-OB-CORE` idiom, `scripts/test-onboarding.mjs:14-18`):

- [ ] `marketCards(view, lang)` maps A6's answer (A6 `§GET`) to cards **in the answer's order**: `id`, `version`, `name`,
      `description` and `author` read from the embedded manifest **verbatim** (`plugin-contract.md:78`, `:81`, `:86`),
      `license` (`:88`), `level` copied as-is from the entry (**never computed, never defaulted to a flattering one**),
      `source`, `sha256`, `size`; a `lang` other than `fr` reads English (the `kt` rule, `packages/kybernos-hub/client.js:102`);
      an entry missing `id` or `version` is not turned into a card (it is the route's `refused` business).
- [ ] `LEVELS` = `['official', 'verified', 'community', 'local']` and `LEVEL_LABEL` + `LEVEL_HELP`: one `[fr, en]` pair
      each (`pair`, `packages/kybernos-hub/client.js:105`), the labels exactly **Official / Verified / Community /
      Local development** (`plugin-contract.md:415-421`), the help lines short enough for a chip's `title`; an unknown
      level is displayed as its raw string, labelled, never mapped to a nicer one.
- [ ] `kitLine(kit, lang)`: the plan's three counts (`kit.skills`, `kit.teams`, `kit.automations`, A6 `§unit`),
      pluralised per language (1 skill / 2 skills, 1 compétence / 2 compétences), joined with "and"/"et", a zero count
      omitted, and an all-zero kit reads "Adds no kit yet" / "N’ajoute encore rien au kit" — never "0 skills".
- [ ] `marketState(view, lang)`: the three honest sentences are **distinct** — no source ("No source configured yet."),
      a source that lists nothing ("This source lists no theme."), a source the verifier refuses ("This catalogue cannot
      be verified.") — plus the "N entries were left out" line when `refused` is non-empty; a state says which it is in
      `data-state`. A state never shows a card and a card never shows a state.
- [ ] `marketInstallable(entry)`: `{ ok: true }` only for an entry carrying an `id`, a `version` and an
      `archive.sha256` (the three things A6's installer needs, A6 `§flow`); a `yanked`/`revoked` entry — which A6
      puts in `refused` — never reaches this function and is refused if it does (`{ ok: false, reason: 'refused' }`).
- [ ] `marketInstall(entry, install)`: calls `install({ source: 'catalogue', id, version })` **exactly once**, returns
      `{ ok: true, id, version }` or `{ ok: false, error: 'no-installer' }` when `install` is not a function; **never
      throws**. It is only ever called from the click, so a mount makes zero calls (asserted by the test, not by hope).
- [ ] `marketReport(result, plan, lang)`: the report's rows — added, skipped, failed (`kbThApply`'s own vocabulary, A6
      `§unit`), the style's `{ id, acc }` when the plan carries one, the kit counts; an item without a name is dropped,
      never invented.

`packages/kybernos-plugin/client.js` — the UI block (`// KB-MARKET-UI-BEGIN` … `// KB-MARKET-UI-END`):

- [ ] The listing component draws: one card per `marketCards` result, `data-level` on the card, the Install button
      (`kb-market-install`) disabled when `marketInstallable` refuses or the seam is absent, a quiet line explaining
      why, the state block (`kb-market-state`) when there is no card, and the report after the answer. It uses the
      host's shell (INT2) and its own `kbtm-*` classes only.
- [ ] The Install action: exactly one `marketInstall` call per click (through the fake seam: 0 at mount, 1 after the
      click, none while busy), the answer shown on the card (A6's own words for a refusal), and **no** `installBundle`
      call, no `setBundleEnabled`, no file write, no style application of its own (INT6).
- [ ] The `settings.section` `kybernos-themes-market` registers **the same component** — order 30, after the
      Suite's 29 (`packages/kybernos-hub/client.js:2141`), label `kt('Thèmes', 'Themes')`, inside the bundle's
      `try/catch` so a broken listing leaves the boot beacon alive (`packages/kybernos-hub/client.js:2140-2143`'s shape,
      in this bundle's idiom `client.js:29690-29692`).
- [ ] The listing reads A6's route **once per mount and once after a click**, never a cache; a reload re-reads it.
- [ ] No French outside a `kt`/`pair` pair, and the English base is complete (`scripts/test-no-french-literals.mjs:2-5`).

`packages/kybernos-plugin/test-theme-market.mjs` (new) — the titles the DoD greps, pinned here

- [ ] `✓ a card carries the theme id, its name, its version and the level the verifier produced`
- [ ] `✓ no source, an empty catalogue and a source the verifier refuses say three different things`
- [ ] `✓ the listing is one component registered as a Settings section, never a second page`
- [ ] `✓ both languages come from one answer`
- [ ] `✓ one click hands the entry to the installer once, never at mount`
- [ ] `✓ without the installer the action is explained, not a dead button`
- [ ] `✓ an entry the verifier refused or revoked never reaches the installer`

**Must stay green, untouched:** the plugin bundle's existing suites (`test-settings-nav`, `test-settings-icons`,
`test-menu-icons`, `test-onboarding-state`, `test-domain-pack`, the i18n and menu checks — measured today:
`node scripts/run-all-tests.mjs --only kybernos-plugin`), `test-settings-nav.mjs`'s one known failure (`kybernos-log`
only), `node scripts/build-catalog.mjs --check` (green: 48 modules), and `node scripts/garde-depot.mjs` (exit 0 today,
one pre-existing warning about a personal path in `docs/tests/gate-verdicts-final.md`).

DoD:

**Commands of THIS repository, to be run from its root. Each one was run on this tree on 2026-10-28 (HEAD `3efbdfdb` —
the tree has since moved to `a11942f1`, A8; these are that day's measurements, re-pin them at the merge)
and FAILS today for the reason quoted next to it — the point of a DoD is the failure it names, not a colour.** A box is
ticked only when its command exits 0 *and* the named assertions pass; none of them needs a port, a clock, the network or
the real `<DSH home>`. D4 and D8 pass only once **A6's** route and verifier exist: the batch order is A6 then A7, and
that dependency is the price of M1, stated here rather than discovered in review.

**D1 — the cards exist and carry the manifest's facts verbatim.** Fails today:
`FAIL: no KB-MARKET-PURE block (the listing's pure helpers) in packages/kybernos-plugin/client.js`

```bash
grep -q 'KB-MARKET-PURE-BEGIN' packages/kybernos-plugin/client.js || { echo "FAIL: no KB-MARKET-PURE block (the listing's pure helpers) in packages/kybernos-plugin/client.js"; exit 1; }
node packages/kybernos-plugin/test-theme-market.mjs > /tmp/a7-market.txt || { echo "FAIL: node packages/kybernos-plugin/test-theme-market.mjs"; exit 1; }
grep -qF '✓ a card carries the theme id, its name, its version and the level the verifier produced' /tmp/a7-market.txt
```

**D2 — the level is the verifier's: read, copied, never computed.** Fails today:
`FAIL: no KB-MARKET-PURE block in packages/kybernos-plugin/client.js (the level must be read from the route)`

```bash
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs'
const src = readFileSync('./packages/kybernos-plugin/client.js', 'utf8')
const m = /\/\/ KB-MARKET-PURE-BEGIN([\s\S]*?)\/\/ KB-MARKET-PURE-END/.exec(src)
if (m === null) { console.log('FAIL: no KB-MARKET-PURE block in packages/kybernos-plugin/client.js (the level must be read from the route)'); process.exit(1) }
// M8: the list names the ways to HASH (createHash, createPublicKey) and to VERIFY (the two verifiers, the key list).
// The literal `sha256` is deliberately absent: a card must cite the archive's hash as a field (marketCards) and
// gate the Install on its presence (marketInstallable) — citing a hash is not computing one.
if (/(createPublicKey|createHash|verifyEntry|verifyCatalogue|officialKeys)/.test(m[1])) { console.log('FAIL: the listing block hashes or verifies: it may only display the level the route carries'); process.exit(1) }
const mod = await import('data:text/javascript,' + encodeURIComponent(m[1] + '\nexport { marketCards }'))
const view = { ok: true, themes: [ { id: 'acme/vet', version: '1.0.0', level: 'community', manifest: { id: 'acme/vet', name: { en: 'Vet clinic', fr: 'Clinique vétérinaire' }, description: { en: 'Care for pets', fr: 'Soins des animaux' }, author: { id: 'acme', name: 'Acme' }, license: 'Apache-2.0' }, archive: { url: 'https://example.invalid/vet.tgz', sha256: 'a'.repeat(64), size: 10 }, source: 'official' } ], records: [], sources: [ 'https://example.invalid/c.json' ], refused: [] }
const cards = mod.marketCards(view, 'en')
if (!Array.isArray(cards) || cards.length !== 1) { console.log('FAIL: one verified entry did not make one card'); process.exit(1) }
if (cards[0].level !== 'community') { console.log("FAIL: the card changed the route's level: " + cards[0].level); process.exit(1) }
const refused = mod.marketCards({ ok: true, themes: [ Object.assign({}, view.themes[0], { level: 'yanked' }) ], records: [], sources: [], refused: [] }, 'en')
if (refused.length !== 0) { console.log('FAIL: a yanked entry became a card'); process.exit(1) }
console.log('D2 ok')
JS
```

**D3 — one listing component, registered as a Settings section, never a second page.** Fails today:
`FAIL: packages/kybernos-plugin/client.js registers no settings section 'kybernos-themes-market' (the listing's Settings entrance, M2)`

```bash
grep -q "name: 'settings.section', id: 'kybernos-themes-market'" packages/kybernos-plugin/client.js || { echo "FAIL: packages/kybernos-plugin/client.js registers no settings section 'kybernos-themes-market' (the listing's Settings entrance, M2)"; exit 1; }
grep -q "'kybernos-themes-market': 'themes'" packages/kybernos-plugin/client.js || { echo "FAIL: KB_NAV_KEYS has no 'kybernos-themes-market' row (A7's first venue line, M2)"; exit 1; }
node packages/kybernos-plugin/test-theme-market.mjs > /tmp/a7-market.txt || { echo "FAIL: node packages/kybernos-plugin/test-theme-market.mjs"; exit 1; }
grep -qF '✓ the listing is one component registered as a Settings section, never a second page' /tmp/a7-market.txt
```

**D4 — the wire: A7 reads A6's route and registers none.** Fails today:
`FAIL: the listing does not read A6's GET /kybernos/themes`

```bash
grep -q "'/kybernos/themes'" packages/kybernos-plugin/client.js || { echo "FAIL: the listing does not read A6's GET /kybernos/themes"; exit 1; }
c=$(grep -c "'/kybernos/themes'" packages/kybernos-plugin/client.js || true)
[ "$c" -ge "1" ] || { echo "FAIL: the page never names A6's route"; exit 1; }
grep -q 'catalogue.json' packages/kybernos-plugin/client.js && { echo "FAIL: the page names a catalogue file: it must read the route"; exit 1; }
n=$(grep -l "path: '/kybernos/themes'" packages/kybernos-plugin/index.js | wc -l | tr -d ' ')
[ "$n" = "1" ] || { echo "FAIL: packages/kybernos-plugin/index.js names the route path in $n file(s) (0 expected before A6, 1 after: A6's route family — the grep covers that one file, not the whole tree)"; exit 1; }
echo 'D4 ok'
```

**D5 — the Settings menu knows the section: key, icon and group word.** Fails today:
`FAIL: KB_NAV_KEYS has no title for 'kybernos-themes-market'`

```bash
grep -q "'kybernos-themes-market': 'themes'" packages/kybernos-plugin/client.js || { echo "FAIL: KB_NAV_KEYS has no title for 'kybernos-themes-market'"; exit 1; }
grep -q "'themes': '<" packages/kybernos-plugin/client.js || { echo "FAIL: ICONES has no drawing under the page title 'themes'"; exit 1; }
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs'
const src = readFileSync('./packages/kybernos-plugin/client.js', 'utf8')
const g = /const GROUPES = \[([\s\S]*?)\n      \]/.exec(src)
if (g === null) { console.log('FAIL: no GROUPES block in packages/kybernos-plugin/client.js'); process.exit(1) }
const look = /id: 'look'[^}]*mots: \[([^\]]*)\]/.exec(g[1])
if (look === null) { console.log('FAIL: no look group in GROUPES'); process.exit(1) }
const mots = look[1].split(',').map((w) => w.trim().replace(/^'|'$/g, ''))
const i = mots.indexOf('theme'); const j = mots.indexOf('themes'); const k = mots.indexOf('language')
if (!(i >= 0 && j === i + 1 && k > j)) { console.log('FAIL: the look group does not hold theme, themes, language in that order: ' + JSON.stringify(mots)); process.exit(1) }
console.log('D5 group ok')
JS
node packages/kybernos-plugin/test-theme-market.mjs > /tmp/a7-market.txt || { echo "FAIL: node packages/kybernos-plugin/test-theme-market.mjs"; exit 1; }
grep -qF '✓ both languages come from one answer' /tmp/a7-market.txt
```

**D6 — the three honest states are different things.** Fails today:
`FAIL: no state block (kb-market-state) in packages/kybernos-plugin/client.js`

```bash
grep -q 'kb-market-state' packages/kybernos-plugin/client.js || { echo "FAIL: no state block (kb-market-state) in packages/kybernos-plugin/client.js"; exit 1; }
node packages/kybernos-plugin/test-theme-market.mjs > /tmp/a7-market.txt || { echo "FAIL: node packages/kybernos-plugin/test-theme-market.mjs"; exit 1; }
grep -qF '✓ no source, an empty catalogue and a source the verifier refuses say three different things' /tmp/a7-market.txt
```

**D7 — installing is A6's, on one click, and never at mount.** Fails today:
`FAIL: no Install action (kb-market-install) in packages/kybernos-plugin/client.js`

```bash
grep -q 'kb-market-install' packages/kybernos-plugin/client.js || { echo "FAIL: no Install action (kb-market-install) in packages/kybernos-plugin/client.js"; exit 1; }
node packages/kybernos-plugin/test-theme-market.mjs > /tmp/a7-market.txt || { echo "FAIL: node packages/kybernos-plugin/test-theme-market.mjs"; exit 1; }
grep -qF '✓ one click hands the entry to the installer once, never at mount' /tmp/a7-market.txt && \
grep -qF '✓ without the installer the action is explained, not a dead button' /tmp/a7-market.txt && \
grep -qF '✓ an entry the verifier refused or revoked never reaches the installer' /tmp/a7-market.txt
```

**D8 — one catalogue, one verifier, one route in the whole tree.** Fails today:
`FAIL: the signed catalogue is verified in 0 modules (one expected: packages/kybernos-plugin/theme-installer.mjs, A6's)`

```bash
n=$(grep -l 'verifyCatalogue' packages/*/*.mjs 2>/dev/null | wc -l | tr -d ' ')
[ "$n" = "1" ] || { echo "FAIL: the signed catalogue is verified in $n modules (one expected: packages/kybernos-plugin/theme-installer.mjs, A6's)"; exit 1; }
grep -q 'verifyCatalogue' packages/kybernos-plugin/theme-installer.mjs || { echo "FAIL: theme-installer.mjs is not the tree's catalogue verifier"; exit 1; }
[ ! -e packages/kybernos-hub/theme-market.mjs ] || { echo "FAIL: packages/kybernos-hub/theme-market.mjs exists: A7 dropped its own reader (M1)"; exit 1; }
r=$(grep -l 'kybernos-hub/themes' packages/*/*.js packages/*/*.mjs scripts/*.mjs 2>/dev/null | wc -l | tr -d ' ')
[ "$r" = "0" ] || { echo "FAIL: $r code files still name A7's dropped route /kybernos-hub/themes"; exit 1; }
p=$(grep -l 'kybernos/themes/catalogue.json' packages/*/*.js packages/*/*.mjs scripts/*.mjs 2>/dev/null | wc -l | tr -d ' ')
[ "$p" = "0" ] || { echo "FAIL: $p code files still name A7's dropped catalogue path"; exit 1; }
echo 'D8 ok'
```

Notes on how these are read. D2, D4 and D8 are behavioural: D2 imports the real block and proves the level travels
untouched — its forbidden list names the *ways* to hash or verify, never the `sha256` **field** the card must cite
(M8: that is the one token whose absence made this DoD unreachable); D4 proves the page reads A6's route and that
`packages/kybernos-plugin/index.js` names that path once — the count is over that **one file**, not the tree (0 before
A6 lands, 1 after, M9); D8 proves the second reader, the second path and the second route M1 removed are absent. D1, D3, D5, D6 and D7
pair a source marker that fails today (a block that does not exist, a section id nobody registers, a table row, a state
block, an action) with the new suite's pinned titles — the presence check is what fails today, the suite run is what
keeps it honest afterwards. None of the eight writes to the real `<DSH home>`, opens a port or needs the network.

## Regression gate (baseline measured today, never assumed)

Measured 2026-10-28 on this worktree, HEAD `3efbdfdb` — now `a11942f1` (A8 landed since), so these are that day's
numbers, re-measured at the merge, never re-quoted (revision 1 measured 13 reds at `317b2f21`; A3's
`packages/kybernos-theme/test-client.mjs` fix landed in between, so the number moved and is re-measured, not quoted):

| Command | Exit | Last line, verbatim |
|---|---|---|
| `node scripts/run-all-tests.mjs` | **1** | `530 test files in 177 s: 518 green, 12 RED` |
| `node scripts/run-all-tests.mjs --only kybernos-plugin` | 1 | `118 test files in 21 s: 116 green, 2 RED` — the two are `test-menu-icons.mjs` and `test-settings-nav.mjs`, the same two rows as below, none new |
| `packages/kybernos-plugin/test-settings-nav.mjs` | **1** | `44 verifications, 1 failure(s)` — the one failure is `every registered settings page has a key in KB_NAV_KEYS — ["kybernos-log"]` |
| `node scripts/test-layout.mjs` | **1** | both failures are `kybernos-log` (`declared to the robot`, `satellites.json`) |
| `node scripts/build-catalog.mjs --check` | 0 | `✓ catalogue up to date (48 modules)` |
| `node scripts/garde-depot.mjs` | 0 | `1984 tracked files — 0 error(s), 1 warning(s)` (the warning is a personal path in `docs/tests/gate-verdicts-final.md`, the campaign's own file) |

The 12 reds, attributed (none is in this batch's perimeter, and the batch may not make it 13):

| red file | attributed to | the failing check |
|---|---|---|
| `scripts/test-consistency-guards.mjs` | unattributed at measurement time | a `deepStrictEqual` mismatch (the run prints no check name) |
| `scripts/test-help-mounts.mjs` | untracked neighbour `kybernos-log` | `help.json is shipped, client.js never mounts __KB_HELP__.Help` |
| `scripts/test-help.mjs` | pre-existing docs gap (the campaign's own list, `A2-registry-points-strategy.md:54`) | `every module links to an article of the help site …` — eleven modules named, `kybernos-hub` among them; the check's own message says « ten » (a stale count in its text) |
| `scripts/test-layout.mjs` | `kybernos-log` | `every DSH bundle is declared to the robot with a name` · `every DSH bundle is in satellites.json` |
| `scripts/test-no-french-literals.mjs` | the neighbours' uncommitted diff | `every bundle is listed — ["kybernos-log"]` · `no French literal outside a dictionary — [client.js:33876, index.js:11628]` (`380 ✓ 2 ✗`) |
| `scripts/test-no-legacy-hosts.mjs` | a half-done rename in the worktree | `https://api.kybernos.app <> https://server.kybernos.app` (twice) |
| `scripts/test-plugin-scan.mjs` | `kybernos-pulse` | `no module declares less than its code shows — ["kybernos-pulse → exec: the host code starts processes (helper/gen-icon.mjs:9)"]` |
| `scripts/test-readmes.mjs` | `kybernos-log` | `each one is linked from README.md — ["kybernos-log"]` |
| `scripts/test-signposts.mjs` | a neighbour's page reference | `every « Settings › … » points at a page of the Settings menu` |
| `packages/kybernos-plugin/test-menu-icons.mjs` | a neighbour's menu row | `every menu row that has an icon-set entry is in the table` |
| `packages/kybernos-plugin/test-settings-nav.mjs` | `kybernos-log` | `every registered settings page has a key in KB_NAV_KEYS` |
| `packages/kybernos-servers/test-host.mjs` | a neighbour's servers work | `8 failed` |

Two of them **(test-settings-nav, test-layout)** are gates this batch must keep *exactly as red*: the new section adds
a nav key, an icon and a group word precisely because those tests demand them, and the reviewer checks that the only
`✗` lines still name `kybernos-log`. `test-settings-icons.mjs` must stay green: the `themes` drawing is a new one (no
two pages share a drawing). `build-catalog --check` and `garde-depot` must stay exit 0 — the batch adds no bundle and no
media.

## Cross-batch wires (named, not lettered — the campaign's letters are retired, `docs/tests/porte-go-verdicts.md:40-43`)

| Wire | Direction | Where it is frozen |
|---|---|---|
| the catalogue document, the verifier, the route, the record, the page and the install seam | **A6 → this batch** (this batch mints none of them: a second reader or route is a NO-GO) | A6 `§file`, `§wire`, `§GET`, `§unit`; the dropped list in "The shared source" |
| the install's plan and apply vocabulary (`kbThApply`'s added/skipped/failed, the plan's style and kit) | **A6 → this batch** (the report draws it, never recomputes it) | A6 `§unit` (`planTheme`, `kbThApply`, `kbThRemove`) |
| the seam's argument `{ source: 'catalogue', id, version }` and the listing component's name, drawn inside A6's page | **this batch → A6** — frozen on **both** ends: A6 `§unit` adopted the same signature for `__KB_THEME_INSTALL__` **and** `__KB_THEME_REMOVE__` on 2026-10-28 (M7), and A7 keeps it verbatim; A6 `§file` already declares the listing block | A6 `§unit` (**adopted 2026-10-28**), A6 `§file`, and this file's INT6 and `unit` (`marketInstall`) |
| the catalogue's four levels | **A6 → this batch** (displayed, never computed) | A6 `§INT4` and `§unit`; `plugin-contract.md:415-421` |
| the accent invariant `style.settings.acc === pack.accent`, shown in the report only | **A3 → this batch** | `docs/tests/A3-vertical-content-strategy.md:48` |
| the pack's `theme` key vocabulary (the plan's style id is A6's to read) | **A2-pack-format → this batch** | `docs/tests/A2-pack-format-strategy.md:95-96`, `:100-102` |
| the Settings section label `Themes` is **not** renamed by A5 (A5 renames the *style* page's label and nav key) | this batch → **A5** | `docs/tests/A5-style-rename-strategy.md:82-84`, `:88` (campaign file, post-baseline); the key `kybernos-themes-market` |
| the listing's two blocks must not land inside a `KB-OB` block | this batch ↔ **A1-kit-wizard** | `docs/tests/A1-kit-wizard-strategy.md:28` |
| the Plugins segment's consent display and Remove (the report points at them, draws neither) | this batch ← the hub's own code, unchanged | `packages/kybernos-hub/client.js:1094`; `plugin-contract.md:561-567` |

## Acceptance note

A box is closed by a test or by a capture, never by a comment; a closed box whose proof lives only in a throw-away
script is an open box. The batch is done when D1-D8 exit 0, the eight captures are read, the mockup is validated against
the real page, the regression gate shows no new red, and the merge message names the 12 pre-existing ones. One
dependency is not negotiable: **A6 lands first** (the route, the verifier, the page and the seam are its), and this
batch's D4/D8 stay open until it does. Nothing here waits on a human: M1-M4 closed the four ambiguities, and the only
decision left in review is the diff read of the two disjoint venue line sets (M2).
