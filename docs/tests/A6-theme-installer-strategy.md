> **Naming update (2026-10-28, owner).** The visual layer (earlier "theme": token overlay, presets)
> is now the **style**; the installable sector unit (earlier "sector pack"/"pack") is now the
> **theme**. Code paths stay unchanged (`packages/kybernos-theme`, `theme-presets.json`) until the
> product-rename batch (kybernos-theme → kybernos-style) lands. This document uses the new words
> everywhere a person reads them, and the old code paths wherever it cites a file.

# A6-theme-installer — test strategy (written before the code)

| | |
|---|---|
| Batch | `A6-theme-installer` — *install one theme in one action: validate, show what it adds, one click, apply through the routes that exist* |
| Campaign | Phase A/B of `docs/etudes/2026-10-27-sector-packs-strategy.md` (`:163-166` Phase A items 3-4, `:169-171` Phase B item 1) |
| Lane | **B — standard** (no file of this batch touches auth, billing, RLS, migrations or secrets; see the lane section and its falsifier) |
| Author role | `redacteur-spec` — this file only; no code, no test module, no pack edited here |
| Binding contract | skill `contrat-pack-vertical` (primitives first, custom UI in Settings, a style is a token overlay, cited or labelled, the person decides, nothing un-ticked) |
| Status | strategy, **correction cycle 1** (2026-10-28: the gate's AMEND applied — the catalogue wire is this batch's and it names A7-theme-marketplace as its second consumer, bound decision M1); **baseline `2ac67fb4`** — every `file:line` below is verified with `git show 2ac67fb4:<path>`, never against the moving worktree. **Carve-out:** three campaign files postdate the baseline and are cited **as they stand on disk on 2026-10-28**, where `git show 2ac67fb4:` fails on them (measured): `docs/tests/porte-go-verdicts.md`, `docs/tests/gate-verdicts-marche.md` and `docs/tests/A7-theme-marketplace-strategy.md`. Every cite of those three says « campaign file, post-baseline » |
| Worktree drift | measured by the sibling specs on 2026-10-28, at two different moments: `A1-kit-wizard-strategy.md:17` reports `client.js` +126 from `KB-OB-CORE` and `index.js` +12 from the `/kybernos/onboarding` registration; `A2-registry-points-strategy.md:16-22` reports `index.js` +216 at its own reading (the neighbours' uncommitted work). Both cites are reads of the siblings' **corrected** files on disk — their lines moved with their own correction cycles, so they are quoted as measurements and never as baseline pins. Neither is an anchor; re-pin at the opening of the implementation (bound decision D1, `docs/tests/porte-go-verdicts.md:30-33`, campaign file, post-baseline) |

## What the batch ships, and what each file is for

**The unit.** A theme is a **data plugin** — `plugin.json`, `package.json` with an empty patch, and the folders `domains/`, `themes/`, `skills/`, `teams/`, `automations/` (`docs/etudes/2026-10-27-sector-packs-strategy.md:66-84`; the format is A2-pack-format's, `docs/tests/A2-pack-format-strategy.md:158-172`). Installing it means two halves, in this order:

1. **the package** enters the profile through **DSH's own manager** (`scope.remote.pluginManager`: `inspect`, `installBundle`, and `removeBundle` for removal — `docs/dev/plugin-contract.md:562`). A data package has an empty patch, so DSH loads nothing (`docs/dev/plugin-contract.md:551`); **no new install door is built**. A bundle that declares `kind: "code"` is refused before anything is applied (out of scope);
2. **its content** is applied through the **routes that already exist**: the field and its wording (`POST /kybernos/onboarding {action:"domain"}`, `packages/kybernos-plugin/index.js:10774-10783`), a shipped skill (`POST /kybernos/domain/skill`, `index.js:10737-10752`), a GitHub skill (`POST /kybernos-skills/install`, `packages/kybernos-skills/index.js:28`), a team (`POST /kybernos/create`, `index.js:9697-9704`), an automation (`POST /kybernos/tasks {action:"create"}`, `index.js:11403-11422`), the acceptance (`POST /kybernos-registry/consent`, `packages/kybernos-registry/host.mjs:156`) and the style (`window.__KB_THEME_APPLY__`, `docs/tests/A1-theme-seam-strategy.md:56`).

| File | Role |
|---|---|
| `packages/kybernos-plugin/theme-installer.mjs` | **new, pure.** The catalogue and archive verifier (`verifyCatalogue`, `verifyEntry`, `verifyArchive`), the plan builder (`planTheme`), the install record (`readThemes`, `writeThemes`), the route body (`handleThemes`), the anti-drift pre-check (`dataPluginProblems`) |
| `packages/kybernos-plugin/client.js` | the ONE `Themes` page (`view: 'themes'`, one menu row, one branch in `KybersMain`, one entry in `__KB_OPEN__.views` — the page primitive of `client.js:15849-15861`, `:26169`, `:26468-26469`), the one-click plan screen (the kit's ticks), the card list A7's entry point opens (M1, M4), and the two seams the page publishes for itself and its tests (`__KB_THEME_INSTALL__`, `__KB_THEME_REMOVE__`). **Adopted 2026-10-28 (M7):** the two seams take `{ source: 'catalogue', id, version }` — frozen here on the A6 end (`§unit`), A7 keeps it verbatim on the listing end. Its **three venue lines** are the ones bound decision M2 grants (see Lane); the page body is one marked block, not a venue line |
| `packages/kybernos-plugin/index.js` | one route family `/kybernos/themes` (GET read, POST actions), under the prefix already claimed (`packages/kybernos-plugin/plugin.json:100-104`), with `sameOriginStrict` / `writeRefused` unchanged; one import line |
| `packages/kybernos-plugin/plugin.json` | **nothing** unless a permission is proven missing: the page uses `ui.slot:conversation.view` (`plugin.json:51`, re-pinned: it sits above the `:56-104` block the first draft cited) and the route prefix (`:100-104`, `/kybernos` at `:103`), both already declared |
| `packages/kybernos-plugin/test-theme-installer.mjs` | **new.** The unit of `theme-installer.mjs` (catalogue, archive, plan, records, route) |
| `scripts/test-onboarding.mjs` | unchanged. The page's applier is tested by `test-theme-installer.mjs` with a fake `window`/`fetch`, not by the wizard's harness |

**The write perimeter is the four files this batch writes (`theme-installer.mjs`, `client.js`, `index.js`, `test-theme-installer.mjs`), and it contains no engine patch, no `cordis.patch.yml`, no `dsh-compat.json` change and no file of `packages/kybernos-registry/**` or `packages/kybernos-theme/**`.** The one line outside the module is the import of `theme-installer.mjs` in `index.js`, in the shape bound decision D4 granted to A2 (`docs/tests/porte-go-verdicts.md:46-48`, campaign file, post-baseline): one line, neither a route nor a guard, named in the PR. The existing import of the packs sits at `index.js:30` (re-pinned at the baseline; the first draft read it as `:31`). Inside `client.js`, the grant is bounded: **three venue lines** (M2) plus one marked page block, and nothing else in that file moves.

## The flow this batch freezes

`choose → package verified → registry validates → plan shown → ONE click → apply`.

1. **Choose.** The `Themes` page lists cards: the themes already installed (read from the registry seam, `registry.plugins()`), the entries of the verified catalogues, and one "From a folder" row. Each card states the level, the author, the licence, the version and what it brings (`docs/dev/plugin-contract.md:415-423`). **It is ONE page, named `Themes`** (M4): A7-theme-marketplace's listing is a view over this page — its entry point opens it and the cards come from the same route — never a second page sharing the same name and the same job. Configuration — the catalogue sources — is a bounded field row in Settings, not on the page (build contract 2).
2. **Package verified.** A folder is read on the host (bounded, symlink-free); a catalogue entry is verified **before** anything is handed to the manager: the catalogue document's Ed25519 signature first, then its shape, then its `seq` against the cached copy (`docs/dev/plugin-contract.md:460-468`), then the archive's `sha256`, then the author signature and, for Verified, the reviewer countersignature, over the messages of `plugin-contract.md:438-440`. The download reuses the bounded rules of `packages/kybernos-hub/telechargement.mjs` (https only, size cap, streamed while hashed, a tar listing that may not leave its folder — `plugin-contract.md:472-473`); the few lines are copied because a bundle cannot import another bundle's file (the precedent is `packages/kybernos-theme/themes-catalogue.mjs:97-104`).
3. **Registry validates.** This batch implements **no validator**: the registry reads the installed package and runs each point's own check (`registry.mjs:233-253`, `:275-276`), and the page reads the answer from `registry.preview(id)` (`packages/kybernos-registry/registry.mjs:303-316`) — "what an installed plugin brings, checked, for the person to read BEFORE they accept it". A file a point refuses is a line, never applied.
4. **Plan shown, one click.** `planTheme(preview)` turns that answer into the one screen: the **style** (one preset document), the **field** (the pack: its name, its menu words, its home order), the **kit** (skills, teams, automations), each item carrying the file it comes from — `themes/x.json`, `domains/x.json`, `skills/x`, `teams/x.json`, `automations/x.json` (build contract 4). Rejected files are listed under the list. **The click on Install is the person's consent for the theme shell** — the style and the field (its words, its home order) — so the shell takes no second confirmation (bound decision M3, the former A7-4: one click install; the click is the person's action, not a dialog's). The **kit** rows keep the wizard's ticks: everything ticked **unless it already exists** (`docs/dev/domain-packs.md:62-63`), a kit item left un-ticked is skipped and reported, and "nothing installs un-ticked" still holds because the click *is* the shell's tick. An automation is always created `active: false` with `approvals: "ask"` (`docs/dev/domain-packs.md:39`; the wizard does the same at `client.js:36691`). One primary action carries the click and the ticks; the quiet one cancels.
5. **Apply.** In this order, each step reported: the acceptance (`consent`), the field and its wording (`domain`), the kit (skills, teams, automations), then the style through the A1 seam. The seam's absence, refusal or a host that does not answer **degrades**: the kit is installed, the report says the style was not, and the person can retry from the card (A1's degradation rule, `docs/tests/A1-theme-seam-strategy.md:57`).

**One active theme per profile** (`docs/etudes/2026-10-27-sector-packs-strategy.md:153`): installing a second theme is a **switch**, and a switch follows the three rules written at `docs/dev/domain-packs.md:92-93` — the wording, the home order and the saved choice are **replaced** (reversibly); skills, teams and automations are only **added**, never removed by the switch; sessions, memory and workspaces are **never touched**. Install, update and remove are idempotent on the same keys (a skill by name, a team by id, an automation by name in any language, the style by preset id, the field by pack id).

## Cross-batch wires this batch consumes (named, never minted here)

Every wire below is written by another batch and read here through its frozen section; none is redefined in this document.

| Wire | Written by | State at `2ac67fb4` |
|---|---|---|
| `window.__KB_THEME_APPLY__(input)` and the `kybernos/theme#theme` point | `A1-theme-seam`, frozen at `docs/tests/A1-theme-seam-strategy.md:54-58` (`:62-72` for the point) | **cross-batch wire** — being implemented now; the page degrades when it is absent (INT step 5) |
| `kybernos/core#team-template`, `kybernos/core#automation-template`, `pack.kit` | `A2-pack-format`, frozen at `docs/tests/A2-pack-format-strategy.md:93-96`, `:158-212` | **cross-batch wire** — being implemented now |
| `kybernos/skills#skill` (read-only, no seeding) | `A2-registry-points`, frozen at `docs/tests/A2-registry-points-strategy.md:57-66` | **cross-batch wire** — being implemented now |
| `kybernos/core#domain-pack`, `validatePack`, `mergePackSets` | shipped (`packages/kybernos-plugin/domain-pack.mjs:68-74`, `:240-253`) | present |
| The registry's `preview`, `plugins`, `setConsent`, and its six routes | shipped (`packages/kybernos-registry/registry.mjs:303-316`, `:330`; `host.mjs:151-158`) | present |
| DSH's plugin manager (`inspect`, `installBundle`, `removeBundle`) | the engine, via `scope.remote.pluginManager` (`docs/dev/plugin-contract.md:562`) | present |
| The two sector themes (`sante` + `recrutement`) | `A3-vertical-content` (`docs/tests/A3-vertical-content-strategy.md:20-27`) | **cross-batch wire** — fixtures here, real packs there |
| The starter folder (`acme/vet-clinic`) | `A4-starter-docs` (`docs/tests/A4-starter-docs-strategy.md:249-251`) | **cross-batch wire** — the e2e's fixture, not a DoD input |
| The style rename (`kybernos-theme` → `kybernos-style`) | `A5-style-rename`, sequenced last | **cross-batch wire** — A6 is written pre-rename and names the old paths |

## The catalogue wire this batch WRITES, and its second consumer (M1)

The gate found the one thing that could not ship twice: this document and A7-theme-marketplace each minted a catalogue source, a reader, a path and a route, and no line here named A7 as a consumer. **M1 (owner, 2026-10-28) settles it: A6's shape wins, because it is the contract's own sections 9-10** (`docs/dev/plugin-contract.md:415-482`, sections 9 and 10; phase 3 names the same thing — *per-plugin install from a signed multi-source catalogue* — `:529`). A7 consumes this **reader through its route**; this batch never reads or writes A7's. Frozen here, once:

| Wire (written by this batch) | Frozen shape | Who reads it |
|---|---|---|
| the catalogue document | **ONE format, one document per source** (`kind: "kybernos-plugin-catalogue"`, `schema: 1`, `plugin-contract.md:460-468`): *multi-source* means several sources of one format — official, partner (delegated by the official key), added by the person (`:470-473`) — never two readers. Signed as a whole — **nothing is parsed before its signature verifies** (`:442`) — and `seq` only goes up per catalogue id (`:464`) | `verifyCatalogue` below |
| `verifyCatalogue` / `verifyEntry` / `verifyArchive` | `packages/kybernos-plugin/theme-installer.mjs` (the unit section below) | this batch only: **no bundle imports a file of another** (`packages/kybernos-registry/host.mjs:10`), so A7 gets these verdicts through the route, never through an import |
| `GET /kybernos/themes` | the ONE read of the catalogue: the verified entries, the bounded source list, the installed records and the refused lines | this batch's page **and A7-theme-marketplace** (its only access to the source) |
| the sources (`pluginCatalogues`) | a bounded https list, ≤ 3 (proposal), the key pinned on first use and shown with the warning (`plugin-contract.md:470-473`) | this batch's Settings field row; A7 sees their effect through the route |

**What the GET answers, and therefore what A7 may rely on.** Per catalogue theme: its `id` and `version`, the `level` `verifyEntry` computed, the embedded manifest's name, author, licence, points and permissions (`plugin-contract.md:415-423`), the archive's `url`/`sha256`/`size` (`:467`), and the catalogue's own id as its source; plus the installed records (INT6's shape), the bounded source list, and `refused` with the verifier's own error codes. Nothing more: no accent, no tagline, no kit counts for a theme that is not installed — the signed catalogue does not carry them, and minting them would be the second display record A7 had to defend. A card draws what the embedded manifest says, labelled (build contract 4); the accent and the kit counts appear once the theme is staged, from the plan (INT1: the inert package is staged before the plan).

**What A7 keeps, what it drops, what it must rewrite (M1).** A7 keeps its listing — the browse and filter rows and the Install action — as a **view** over this source: its entry point opens the ONE `Themes` page (M4), whose plan and one click carry the install (M3), and A7 adds no reader, no path, no route and no second page. How its list is drawn (a Settings list, a section, a row) is for A7's revision; this spec freezes only what A7 consumes — the route, the level it carries, and the page's own click. It drops: `packages/kybernos-hub/theme-market.mjs`; the path `<DSH home>/kybernos/themes/catalogue.json`; `GET /kybernos-hub/themes`; the document `kind: "kybernos/theme-market"` and its `themes[]` display record; the frozen names `readCatalogue`, `readCatalogueBytes`, `readCatalogueFile`, `trustOf`, `KIND`, `SCHEMA`, `MAX_DOC_BYTES`, `MAX_THEMES`, `CATALOGUE_PATH`, `LIMITS`; and `install.spec` (an archive address is `archive.url`, which the verifier has already hashed). It rewrites the wire sections and the fixtures that baked the old shape: **its D1** (the document), **its D2** (the trust rule — the level is computed here, once, by `verifyEntry`, and A7 displays it and never derives it), **its D4** (the route test, now `GET /kybernos/themes`) and **its D8** (the "no other file parses the catalogue document" grep, now pointing at `theme-installer.mjs`). A7's own spec — its "shared source" section (`docs/tests/A7-theme-marketplace-strategy.md`, campaign file, post-baseline; no line pin, its revision is moving as this is written) — is the surface it yields.

**What this batch does not owe A7.** No ranking, no categories, no install counts, no "featured" (OUT OF SCOPE), no second route and no page of its own; A7's list is A7's code, reading this route. **Reverse, one word (M1):** if A6 yields instead, this section, the three verifiers, D2's fixture and the whole `/kybernos/themes` family change — the larger cost, which is why the owner ratified A6's shape.

## Interpretations (the request admits several; each choice is argued)

**INT1 — "install one theme" is two halves, and the package half is DSH's.** The alternative — a Kybernos installer that unpacks a folder into `<DSH home>/kybernos/plugins/<author>/<name>/` itself, as `plugin-contract.md:475-479` describes for a future catalogue — would put a package where the registry does **not** read it (the registry reads `<DSH home>/profiles/web`, `registry.mjs:78-98`), and would be a second install door beside DSH's manager (repo rule 1's spirit, and `plugin-contract.md:562`: "the page never writes the profile"). Chosen: stage and remove through `pluginManager`, apply content through the existing routes. The doc's atomic-swap paragraph is cited as the **intent**, not as this batch's mechanism.

**INT2 — the plan is built from the registry's own preview, never from a second set of validators.** The registry runs each point's validator; A6 implements none. The alternative (validate a folder before installing it) would require either six imported validators across bundles — forbidden (`packages/kybernos-registry/host.mjs:10-11`) — or a copy, which is the drift this repo keeps paying for. Consequence, accepted and written: **the inert package is staged before the plan screen** (ratified M4; the staging decision below).

**INT3 — the click consents the shell, the ticks govern the kit (M3, the former A7-4).** The Install click is the person's consent for the theme shell — the style and the field — so the shell is applied by the click itself and takes no second confirmation. The **kit** rows keep the wizard's defaults: everything ticked unless it already exists (`domain-packs.md:62-63`), an automation ticked but created off. "Nothing installs un-ticked" is therefore about the **ticks being authoritative** — the click is the shell's tick, and no kit item applies un-ticked; it is not about a default-off screen, which would contradict the shipped Kit screen and add a second consent habit. A person who un-ticks every kit row installs the shell and no kit item; a person who takes the quiet action applies nothing at all.

**INT4 — four trust levels are A6's; "Unlisted" is not.** Official, Verified, Community and Local development (`plugin-contract.md:415-421`; the registry's own vocabulary for an installed package is `local` or `unlisted`, `registry.mjs:98`). A theme installed from a folder is **Local development** and says so. A bundle the person installed by another door (npm, GitHub, a tarball) is **Unlisted**, listed by the page from the registry with its own level, but A6 neither installs nor updates it — that is DSH's Plugins page. A level never survives a change (`plugin-contract.md:423-424`): an update re-verifies and re-shows the level before anything is applied. **The level a card shows is `verifyEntry`'s answer, carried by the route** — no page derives one, so A7-theme-marketplace displays what this batch computes and never recomputes it (M1).

**INT5 — the catalogue sources are configuration, and v1 pins them the way the contract says.** `pluginCatalogues` is a bounded list of https URLs (max 3, proposal), each with the key pinned on first use and shown with the warning of `plugin-contract.md:470-473`; the official catalogue's key is embedded when one ships. **The list is edited here only** (the Settings field row); A7-theme-marketplace reads the sources' effect through `GET /kybernos/themes` and never adds, removes or pins one (M1). **No official plugin-catalogue key exists today** (`docs/tests/A1-theme-seam-strategy.md:246` records the empty theme key list; the plugin catalogue is contract phase 3, `plugin-contract.md:529`), so in production the catalogue half is verifiable only once a key ships; the tests use a generated Ed25519 keypair. The local folder is fully usable today.

**INT6 — the install record is one bounded file, and it holds the undo snapshot.** `<DSH home>/kybernos/themes.json` (0600, ≤ 256 KiB, ≤ 8 records): the active theme id, per-record `{ id, version, level, source, applied, before, at }`, and the sources. `applied.style` keeps the id **and a fingerprint** (the stored look's settings with their keys sorted, taken when the theme is applied), `before` keeps the look and the saved choice that were there before. That is what makes "reversible" checkable instead of remembered: removal restores a value only if the person has not changed it since (INT7).

**INT7 — "reversible" does not overwrite a later choice and does not delete the kit.** Remove restores the previous **style** only when the current style is still exactly the one the theme applied (same id, same fingerprint); it restores the previous **field** only when the current field is still the theme's pack; it **never deletes** a skill, a team or an automation the theme added — they are the person's now, and rule 2 (`domain-packs.md:92-93`) says an addition is not removed by a switch. It lists them and offers one explicit second action, off by default. A4's journey says "uninstall and check nothing is left" (`docs/tests/A4-starter-docs-strategy.md:299`); that sentence is about the **traces of the theme**, and this reading is the one the contract's rule 2 and the "nothing is deleted silently" habit allow. See the staging decision below (AMBIGUITY 2, ratified M4).

**INT8 — update is a re-plan, not a reinstall of the person's edits.** The same theme id at a higher version: the manager installs the new archive (the previous one is kept in `<DSH home>/kybernos/theme-archives/` for one step back), the plan is re-derived from the new preview, and only what is missing is added. A skill the person edited is never overwritten: the seeded-skills rule keeps it (`packages/kybernos-registry/seed-skills.mjs:1-16`), and the page reports "kept". A downgrade is refused (the catalogue's `seq` only goes up, `plugin-contract.md:464`).

**INT9 — the two contributed folders whose install is not wired stay visible and inactive.** A `skills/` folder is a contribution A2 reads but does not write (`docs/tests/A2-registry-points-strategy.md:57-66`, AMBIGUITY 2 at `:71`); an `automations/` template carries steps, guard and questions, not the single `prompt` a task needs (`docs/tests/A2-pack-format-strategy.md:190-203`; the task store requires a `prompt`, `index.js:422-440`). Both are shown in the plan as **not installable yet**, cited to their file, never ticked and never silently dropped. The skills a **pack** names (`goals[].skills`) and the automations a **pack** carries (`goals[].automations`, with `name`/`prompt`/`cron`) are installable today; contributed **team** templates are installable because they use exactly the body `kybers/create` accepts (`docs/tests/A2-pack-format-strategy.md:174-188` against `client.js:36703-36708`).

## Decisions ratified by the owner on 2026-10-28 (these were AMBIGUITY 1-5, plus the gate's sixth; one word reverses each)

AMBIGUITY 1 — **the staging order.** The registry validates only what DSH's manager has installed (`registry.mjs:78-98`, `:303-316`), so "validate before the ask" means "stage the inert package, then validate, then ask". **Ratified (M4): stage on the Install click, show the plan once (the kit's ticks), and on Cancel leave the plugin installed but unapplied and unconsented**, shown on the card as "Added, not applied" with a Remove. The one-word veto is strict "nothing on disk before the ask": it needs a registry read of an **uninstalled** folder (a new read route, a path capability, and the point validators run outside the profile) — a registry change, another batch.

AMBIGUITY 2 — **what Remove deletes.** **Ratified (M4): the package leaves, the style and the field are restored when they are still the theme's, and the kit stays** (rule 2, `domain-packs.md:92-93`), with the explicit second action off by default. The veto is "uninstall and check nothing is left" (`docs/tests/A4-starter-docs-strategy.md:299`): delete the skills, teams and automations the theme created — destructive, it needs an origin mark per item, and it contradicts "an addition is never removed by a switch".

AMBIGUITY 3 — **where the flow lives.** **Ratified (M4): ONE `Themes` page (one name, one job), and A7-theme-marketplace's listing and this batch's install flow are the SAME page** — A7's listing is a view over this page and its route, its entry point opens it, and this batch owns the page shell, the plan and the apply. The veto alternatives stay named and costed against a page that now exists: a section of the Kybernos Suite Settings page (which already lists bundles), or the wizard's Kit screen opened standalone from a card (`__KB_DOMAIN__.openKit`, `client.js:26220`) — the second puts a store inside Settings, the third reuses a first-run screen and would show the wizard's steps under a store.

AMBIGUITY 4 — **the missing write side for contributed `skills/` folders.** A2 left it out deliberately (`A2-registry-points-strategy.md:57-66`, AMBIGUITY 2 at `:71`: the writer recommended option (i), A2 read-only). **Ratified (M4): deferred** — A6 shows those skills and does not install them. The veto grants one of the three: a sixth `seed-skills.mjs` copy (forbidden by `scripts/test-seed-skills-drift.mjs:16`), extending the five copies together (four foreign packages), or a versioned shared service (`docs/dev/plugin-contract.md:317` already plans one).

AMBIGUITY 5 — **the official catalogue key.** No Kybernos plugin-catalogue key exists; the plugin catalogue is contract phase 3 and `plugin-contract.md:529` says it "needs a Kybernos server route for `account` entitlement and keys". **Ratified (M4): refuse unverifiable sources** — A6 verifies against whatever keys it has (a source's pinned key, a fixture key in tests) and refuses to offer a source it cannot verify ("unverifiable source — not installable"), so the local folder carries v1. The veto is shipping a placeholder official key, which would make every Verified claim untrustworthy.

AMBIGUITY 6 (the gate's, now M1) — **who owns the catalogue supply.** **Ratified (M1): this batch** — the reader, the three verifiers, the `pluginCatalogues` sources and the `/kybernos/themes` family are A6's, and A7-theme-marketplace consumes them and yields its own reader, path, route and document (the wire section above says what it drops and which of its DoDs it rewrites). The veto is the expensive direction: A6 yields, and this section, the verifiers, D2's fixture and the route family change instead.

## Verified anchors (read with `git show 2ac67fb4:<path>`, never remembered; the label « campaign file, post-baseline » marks the three that exist only on disk)

| Claim | Verified at | Verdict |
|---|---|---|
| A data package may declare only `dsh.bundle.patch`, must be empty, no install scripts, no `bin` | `packages/kybernos-registry/registry.mjs:54-76` (`dataPackageProblems`) | exact |
| The registry reads the profile, never an arbitrary folder | `registry.mjs:78-105` (`scanProfile`), `:110-132` (`inspectPackage`) | exact |
| A data point has exactly one of schema and validator | `packages/kybernos-registry/manifest.mjs:84` | exact |
| The manifest requires `plugin.json` and `package.json` versions to agree | `manifest.mjs:65` | exact |
| The point API and its idempotence | `registry.mjs:199-210` | exact |
| The folder scan is generic over points, and one validator per point | `registry.mjs:233-253` | exact |
| A plugin contributing to an `instruction` point needs the person's acceptance | `registry.mjs:275-276` | exact |
| The preview exists, checked, before acceptance | `registry.mjs:303-316`; route `host.mjs:151-158`, preview route `:154` | exact |
| The consent route is a signed-session write | `host.mjs:156` (`session: true`) | exact |
| The archive the person chose can be kept for DSH's manager (8 MB, gzip, filename checked) | `host.mjs:128-141` (`importRoute`), `:65` (`IMPORT_MAX`), `:157` (the route) | exact |
| Bundles reach DSH only through its manager (`inspect`, `installBundle`, `removeBundle`) | `docs/dev/plugin-contract.md:562` | exact |
| A data package is accepted by DSH's manager and loads nothing | `plugin-contract.md:551` | exact |
| The five trust levels and "a level never survives a change" | `plugin-contract.md:415-424` | exact |
| The two signed messages (author, reviewer countersignature) and their fixed first lines | `plugin-contract.md:438-440` | exact |
| Sources, pinning and the official key plan | `plugin-contract.md:470-473` | exact |
| The per-plugin archive and the atomic folder swap (intent) | `plugin-contract.md:475-479` | exact |
| Phase 3 needs a server route for entitlement and keys | `plugin-contract.md:529` | exact |
| The native Plugins page installs from a name, a GitHub address, a tarball or a local directory | `plugin-contract.md:595` | exact |
| The style seam, its answer and "never throws" | `docs/tests/A1-theme-seam-strategy.md:54-58` (the wire at `:56`) | baseline shape |
| The style point's manifest entry and validator | `A1-theme-seam-strategy.md:62-72` | baseline shape |
| The wizard already calls the pack's style id, and only the id | `docs/tests/A1-kit-wizard-strategy.md:42-52` | exact |
| The wizard's kit apply: one item at a time, automation `active:false`, skills by route, team by `kybers/create` | `packages/kybernos-plugin/client.js:36664-36720` (automation `:36691`, skills `:36694-36698`, team `:36703-36708`, counters `:36713-36714`) | exact |
| The kit exists before consent, by looking it up (`/kybernos-skills/skills`, `kybers/load`, `/kybernos/tasks list`) | `client.js:36647-36662` | exact |
| `__KB_DOMAIN__` publishes `installSkill` and `openKit` today | `client.js:26213`, `:26220` | exact |
| The host bridge maps `kybers/create` to `/kybernos/create` | `client.js:8289-8300` | exact |
| The field/wording write and its pack-id guard | `index.js:10774-10783` | exact |
| A shipped skill is written only when a pack lists it | `index.js:10737-10752` (the `listed` check `:10745`) | exact |
| A GitHub skill install refuses a duplicate | `packages/kybernos-skills/index.js:28`, `:1117-1132` | exact |
| Tasks: create, `active` boolean, approvals, cron validated | `index.js:3193-3214`, `:422-440` | exact |
| The task route is a signed-session write | `index.js:11403-11422` | exact |
| The team creation path | `index.js:9697-9704` (`createKyber` at `:7949`) | exact |
| The route prefix is already claimed | `packages/kybernos-plugin/plugin.json:100-104` (`/kybernos`) | exact |
| The pack validator refuses unknown keys and requires `id` = file name | `packages/kybernos-plugin/domain-pack.mjs:68-74` | exact |
| The three switch rules | `docs/dev/domain-packs.md:92-93` | exact |
| What applying a pack does today (skills, teams, automations off) | `domain-packs.md:65-75` | exact |
| Nothing is installed without a tick; automations are created off | `domain-packs.md:131-135` | exact |
| The signed catalogue and its levels are contract phase 3, not built | `plugin-contract.md:522-530` | exact |
| The style point is the first data point of a plugin the wizard reads | `docs/tests/A2-pack-format-strategy.md:158-172` | exact |
| The frozen kit wire (`pack.kit`) and the four folder table | `A2-pack-format-strategy.md:93-96`, `:160-172` | exact |
| The team and automation template shapes | `A2-pack-format-strategy.md:174-212` | exact |
| A2 reads a skill folder but writes nothing to `<DSH home>/skills` | `docs/tests/A2-registry-points-strategy.md:57-66`; AMBIGUITY 2 at `:71` | exact |
| No sixth `seed-skills.mjs` copy | `scripts/test-seed-skills-drift.mjs:16` | exact |
| A4's theme file is the light `{ id, name, settings }` | `docs/tests/A4-starter-docs-strategy.md:251` | exact |
| A4's install/uninstall journey is written but not gated | `A4-starter-docs-strategy.md:299` | exact |
| The two verticals are `sante` + `recrutement` | `docs/tests/A3-vertical-content-strategy.md:20-27` | exact |
| A need no primitive covers is written, never smuggled | `A3-vertical-content-strategy.md:221` | exact |
| One active theme per profile | `docs/etudes/2026-10-27-sector-packs-strategy.md:153` | exact |
| The catalogue document, its whole-document signature and its `seq` rule | `docs/dev/plugin-contract.md:460-468`, `:442`, `:464` | exact (baseline) |
| The sources, the key pinned on first use and the bounded list | `plugin-contract.md:470-473` | exact (baseline) |
| What a card states (level, author, licence, version, what it brings) | `plugin-contract.md:415-423` | exact (baseline) |
| Phase 3 is *per-plugin install from a **signed multi-source** catalogue*, not built | `plugin-contract.md:529` | exact (baseline) |
| A bundle imports no file of another (the host seam is a global) | `packages/kybernos-registry/host.mjs:10` | exact (baseline) |
| The Kybernos page table's view branch (one line added for `themes`) | `packages/kybernos-plugin/client.js:15849-15861` | exact (baseline) |
| The page allowlist a Settings cell uses to open a Kybernos page (`kbOpenPage.views`) | `client.js:26167-26169` | exact (baseline) |
| The Kybernos menu rows, where the `themes` row is added (`row(...)`) | `client.js:26468-26469` | exact (baseline) |
| **A7's** three Settings-venue lines (its entry point, disjoint from the three above) | `client.js:3005-3016` (`KB_NAV_KEYS`), `:33675` (`GROUPES`, the look group's `mots`), `:33696` (`ICONES`) | exact (baseline) |
| The single import line of the packs in `index.js` | `packages/kybernos-plugin/index.js:30` (re-pinned; `:31` in the first draft) | exact |
| The `fs.write:dsh-home` permission the record file relies on | `packages/kybernos-plugin/plugin.json:67` (re-pinned; `:66` in the first draft) | exact |
| The `conversation.view` slot and the claimed `/kybernos` prefix | `plugin.json:51` (re-pinned, outside the first draft's `:56-104`), `:100-104` (`/kybernos` at `:103`) | exact |
| The three campaign files this spec cites postdate the baseline | `docs/tests/porte-go-verdicts.md`, `docs/tests/gate-verdicts-marche.md`, `docs/tests/A7-theme-marketplace-strategy.md` — `git show 2ac67fb4:` fails on all three (measured) | carve-out, on disk only |

**Corrections to the delegation's brief** (measured, so the spec does not propagate them):

1. **The data plugin's file list is incomplete in the brief.** `plugin.json` alone is not a package: the registry requires a `package.json` (with an empty `dsh.bundle.patch`) beside it (`registry.mjs:54-76`, `:110-132`), and A4's starter has both plus `cordis.patch.yml` (`A4-starter-docs-strategy.md:249-251`). A6's list is `plugin.json`, `package.json`, `cordis.patch.yml`, `domains/`, `themes/`, `skills/`, `teams/`, `automations/`.
2. **"Local development" is a display label, not the stored value.** The registry stores `level: 'local'` (`registry.mjs:98`, `:153`) and the contract's table displays "Local development" (`plugin-contract.md:420`). The page displays the label; the record stores `local`.
3. **The brief's "signed catalogue (catalogue entry = manifest + archive hash, plugin-contract.md sections 9-10)" is right, but that machinery does not exist yet**: no `pluginCatalogues` key, no plugin catalogue document on disk, no key (`plugin-contract.md:529`). A6 builds the reader and the verification, not the review queue, the entitlement call or the marketplace — and **the marketplace A7-theme-marketplace builds is a view over this reader and route (M1: one document, one path, one route)**, which is why the card can say "no key present" without a second source behind it (AMBIGUITY 5, ratified).
4. **`themes/` is not a folder A6 validates itself.** The point belongs to `A1-theme-seam` (`docs/tests/A1-theme-seam-strategy.md:62-72`); A6 consumes its contributions through the registry preview, exactly like the other four points. A spec that re-validated a style file here would be the second validator A1 spent a batch avoiding.

## Lane

**B — standard.** The four files add an inert data reader, a page, a record file and one route family under the prefix already claimed. No credential, billing, RLS, migration or signature **surface** is added: the route guards are the existing `sameOriginStrict` and `writeRefused` (`index.js:10737-10752` is the pattern), unchanged; the route writes one bounded JSON file under `<DSH home>/kybernos`, which the bundle already may write (`fs.write:dsh-home`, `plugin.json:67`, re-pinned); no engine patch and no compat bump (`dsh-compat.json` untouched). The signature work is **verification only** (public keys in, a boolean out); it stores no secret and mints none.

**Falsifier that would flip it to A:** any hunk in `packages/kybernos-plugin/session-guard.mjs`, in `writeGuard`/`sameOriginStrict`, in `packages/kybernos-registry/host.mjs`'s six routes or their guards, in a `cordis.patch.yml`, or any write outside `<DSH home>/kybernos` and the profile through DSH's manager. If the diff shows one, the batch is A on the spot.

**The venue grant (M2, the former A7-3) — three lines each, disjoint.** Both batches write `packages/kybernos-plugin/client.js`, so the owner bounded both to their entry point. **A6's three lines are the install-flow entry point**: one branch in the page's view table (`client.js:15849-15861`), one entry in `kbOpenPage.views` (`:26169` — the allowlist a Settings cell reads before it offers to open a Kybernos page, `:26167-26168`), one `row(...)` in the menu block (`:26468-26469`). **A7's three are the listing entry point**: `KB_NAV_KEYS` (`:3005-3016`), the look group's `mots` (`:33675`) and `ICONES` (`:33696`). The two sets share no line and no range. The reviewer's check is a diff read, not a promise: A6's hunks in that file are exactly these three lines plus its one marked page block, A7's are exactly its three lines, and a line of one batch inside the other's hunk is the NO-GO. The page block is not a venue line — it belongs to this batch's `client.js` perimeter, already counted above.

OUT OF SCOPE:

- **Code plugins, of any level.** A6 installs data only; a `kind: "code"` package is refused before the manager (`plugin-contract.md:415-421`, `:551`). Third-party code is contract phase 4 behind the review pipeline this batch does not build.
- **Payment, entitlement and the commerce model.** No price, no key, no `account` call (`plugin-contract.md:522-530`: phase 3 needs a server route); the card shows the licence, not a buy button.
- **Review queues, reviewer tooling and the `plugin-check.mjs` publication.** The countersignature is *verified*, never *issued*; the conformance tool and the reviewer's checklist are A4's/contract phase 4's.
- **The marketplace's product surface.** No ranking, no categories, no install counts, no "featured", no editorial selection. The listing itself is A7-theme-marketplace's view over this batch's route (M1, M4) — A7's code, not this batch's.
- **A second catalogue door.** No reader, path, route or document of A7's shape (`packages/kybernos-hub/theme-market.mjs`, `<DSH home>/kybernos/themes/catalogue.json`, `GET /kybernos-hub/themes`, `kind: "kybernos/theme-market"`): A7 drops them under M1, and this batch neither reads nor writes them.
- **Installing "Unlisted" bundles** (npm, GitHub, tarball) — DSH's own Plugins page does that (`plugin-contract.md:595`); A6 only lists them.
- **The wizard** (`A1-kit-wizard`): its Kit step, its miniature, its confirm button. A6 adds a page, never a step.
- **The style seam's internals** (`A1-theme-seam`): `applyPreset`, the `{ import }` route branch, the library. A6 calls the global and reads its answer.
- **The registry's points, validators, folder scan, consent store and six routes** (`A2-registry-points`, `A2-pack-format`): read, never changed.
- **Pack content** — `domains/*.json`, `catalog/**`, the two verticals (`A3-vertical-content`): fixtures only here.
- **The starter template, the "Build a theme" page and `plugin-check.mjs`** (`A4-starter-docs`): A6's e2e copies the starter; it does not write it.
- **The style rename** (`A5-style-rename`): sequenced last; A6's new strings already say "style" for the visual layer, its new files are named as the pre-rename tree names them.
- **Any engine patch, any `dsh-compat.json` bump, any new permission, any new `cordis.patch.yml`.** `scripts/patches.json` untouched; the route stays under the claimed `/kybernos` prefix (`plugin.json:100-104`).
- **Media in git** (no screenshot, no mockup committed) — `scripts/garde-depot.mjs:11`; the maquette and the captures live outside the repository.
- **Deleting what a theme added, on removal** — the ratified reading (AMBIGUITY 2, M4) keeps it, and the optional second action is the person's.
- **Writing a contributed `skills/` folder to `<DSH home>/skills`** — A2 left it out (`A2-registry-points-strategy.md:57-66`); AMBIGUITY 4 is ratified as deferred (M4), so it is not granted to this batch.
- **Telemetry, analytics and any network call beyond the catalogue sources the person added.** No call to `api.kybernos.app` from this batch.

e2e:

**Played on the real GUI, sandbox only, reported and not gated** (`docs/dev/live-testing.md`: a signed session cookie, never the stale token URL; `scripts/sandbox/setup.sh` then `start.sh`, never `:3080`).

- [ ] **E1 — a local folder, one action.** Copy A4's starter (`docs/dev/templates/acme-vet-clinic/`, A4's batch) to a temp folder; on `Themes`, "From a folder" → the path; press Install. Expected, in order: the manager reports the package installed; the card shows **Local development**; the plan lists the style, the field (its menu words) and the kit, each with its file; the primary action is pressed once; after it, `GET /kybernos/domains` marks the pack `from: "acme/vet-clinic"`, the menu rows show the pack's words, the style's accent is on the page, the automations exist **off** in `tasks.json`, the team is in `~/.dsh/kybers`, and the record file is written. Nothing is applied before the press.
- [ ] **E2 — un-ticked means absent, and the shell follows the click.** The same theme with one skill and one automation un-ticked: neither is created, the shell (style + field) applies because the click consented it, the rest is applied, and the report lists the two skipped items (M3: the click is the shell's consent, the kit keeps the wizard's ticks).
- [ ] **E3 — install twice.** Press Install again: the plan is identical, every item is reported "already there", no duplicate skill/team/automation, one record, one style apply. The record file is byte-identical except `at`.
- [ ] **E4 — update.** Bump the starter's version and change one menu word plus one automation's cron; the card offers Update; after it, the wording and the cron follow, the skills already present are not re-created, a skill edited by hand is "kept" (its text unchanged on disk).
- [ ] **E5 — remove.** Remove from the card: the package leaves the profile (DSH's manager), the style and the field are restored because they are still the theme's, the kit **stays** and is listed as kept, and a second Remove reports "already removed" and calls nothing. Sessions, memory and workspaces are not touched (their files' mtimes and contents unchanged).
- [ ] **E6 — switch.** With theme A applied, install theme B: the menu wording and the style are replaced, A's kit stays, B's kit is added, and the undo snapshot of B is A's applied look and field.
- [ ] **E7 — the style seam's degradation.** Install the same theme on a profile where `window.__KB_THEME_APPLY__` is absent: the kit applies, the report says the style was not applied, and the card offers "Apply the look" (which retries the seam alone).
- [ ] **E8 — a code plugin is refused.** A folder whose `plugin.json` says `kind: "code"`: the card refuses it before the manager install, with the reason, and nothing is written (`plugin-contract.md:551`).
- [ ] **E9 — a broken theme never stops DSH.** A theme with one refused file: it appears as a line, the rest of the plan is usable, and DSH starts and mounts every other bundle (`node scripts/check-bundle-faults.mjs`, when the page ships).
- [ ] **E10 — the merge gate, measured never assumed (D8 of the arbitration report).** `node scripts/run-all-tests.mjs` ends at the red set the campaign recorded — **12 files, file for file** (`docs/tests/gate-verdicts-marche.md`, campaign file, post-baseline; the earlier six-cause reading is `docs/tests/porte-go-verdicts.md:77-81`, same carve-out), with A6 adding none. The merge message names them.

vision:

**The page is new, so the visible proof is a page pass — not a caption of a screen that did not change.** Captures are taken outside git (`mktemp -d`), read with the image reader, one line each on what changed; a capture nobody looked at is not a proof.

- [ ] V1/V2 — the card list with one installed theme, one catalogue theme and the folder row, **light and dark**.
- [ ] V3/V4 — the plan screen (one click; the kit's ticks set), **light and dark**: the style, the field and its menu words, the kit, each with its file cited under it, the level badge, one primary and one quiet action.
- [ ] V5 — the same screen with one refused file listed (a rejected line, the rest still usable) and with **every kit tick removed** (the primary still works: the shell applies — the click consented it — and no kit item is written).
- [ ] V6 — narrow (390 px): the cards stack, the ask screen's list is readable, the actions stay reachable, nothing is clipped.
- [ ] V7 — Arabic (RTL, the only right-to-left language, `docs/tests/A1-kit-wizard-strategy.md:116-119`): the row is right-aligned, the file paths are not broken mid-token, no Latin word is invented into a sentence.
- [ ] V8 — the "Added, not applied" state after a cancel (the staged plugin, its Remove, and no trace of the theme on any page).
- [ ] Judgement, not only capture: for each pair say in one line what changed; a layout move that was not intended is a defect.

capture:

**Applicable, and the artefacts live OUTSIDE the repository** (a `mktemp -d` directory): `node scripts/garde-depot.mjs` refuses media (`scripts/garde-depot.mjs:11`).

- [ ] `catalogue-answers.json` — the verifier's verdict for: a valid document, a tampered byte, a wrong key, an older `seq`, a revoked entry, a yanked version.
- [ ] `archive-answers.json` — the archive verifier for: the right hash, a wrong hash, an author signature made for another version, a missing reviewer countersignature on a Verified entry.
- [ ] `plan.json` — the plan of E1, printed once: every item with its `file`, and the rejected lines verbatim.
- [ ] `themes-before.json` / `themes-after.json` — `<DSH home>/kybernos/themes.json` around E1 and around E5 (0600, mode shown by `stat`).
- [ ] `requests.txt` — E1's own requests in order (manager calls aside): consent, domain, skills, teams, automations, style — and the GETs the lookups made. This is the wire of the batch.
- [ ] `tasks-before.json` / `tasks-after.json` — the automations created, each with `active: false` and `approvals: "ask"`.
- [ ] `domains.json` — `GET /kybernos/domains` before and after E1, with `from` on the theme's pack.
- [ ] The eight PNGs of the vision pass in the same directory; the report quotes the paths.

maquette:

**Applicable, because the batch ships a page.** The frame is the shipped page primitive — the menu row and the `KbXxxView` shell of Skills/Connectors (`client.js:25789-25803`, `:15849-15861`), the `.kbg-*` and `.kb6-*` classes, the cards of the shipped listing views — and the **one screen that is genuinely new is the plan**: a list of rows (a tick, a name, one line, a mono file path) above a sticky action row. One mockup is built before the code, outside the repository (`maquette-dsh` skill, real CSS, the app's tokens), covering the two states (cards, plan) at 1440 px and 390 px, light and dark, and validated by the owner against the shipped pages **before** implementation starts. The mockup is the reference for V3/V4/V6; the folder's own mockups (`docs/handoff/theme-medecin/maquette-v1`, `theme-recrutement-ssii/maquette-v1`) are A3's field screens, not this flow, and are cited as the visual family, not reused as this flow's maquette.

unit:

**The deterministic layer — this is where the batch is proven.**

`packages/kybernos-plugin/theme-installer.mjs`

- [ ] `verifyCatalogue({ bytes, signature, keys, floor })` → `{ ok: true, doc, key }` or `{ ok: false, error }`, never throws. The signature is checked **before** the document is parsed; errors are `no-key`, `size`, `signature`, `json`, `schema`, `kind`, `seq`, `older`, `duplicate`. The document's shape is `plugin-contract.md:460-468` (`catalogue{id,name,seq,publishedAt}`, `authors`, `reviewers`, `plugins[].versions[{version, manifest, archive{url,sha256,size}, authorSig, review?, yanked?}]`, `revoked`, `revokedKeys`).
- [ ] `verifyEntry({ id, version, entry, catalogueKey, keys, reviewerKeys, officialKeys })` → `{ ok: true, sha256, level }` or `{ ok: false, error }`: the author signature verifies over `kybernos-plugin-v1\n<id>\n<version>\n<sha256>` and, for Verified, the reviewer countersignature over `kybernos-plugin-review-v1\n<id>\n<version>\n<sha256>\nverified` (`plugin-contract.md:438-440`); the level is `official` (namespace `kybernos` **and** a key of `officialKeys`), `verified` (both signatures on the same hash), `community` (the author's only); a `yanked` entry is `yanked`, a missing or malformed hash is `hash`, a bad signature is `signature`.
- [ ] `verifyArchive({ bytes, id, version, entry, catalogueKey, keys, reviewerKeys, officialKeys })` → the same answer after hashing `bytes` and comparing it to `entry.archive.sha256`: a wrong hash is `hash`, a size over the cap (`IMPORT_MAX`, `host.mjs:65`) is `size`. A level is never inherited from another version.
- [ ] **Revocation is evaluated before an offer, not after an install** (`plugin-contract.md:451-456`): the catalogue's `revoked` list (`{ id, versions, sha256?, reason, at, action: "disable" | "warn" }`) is read from the verified document and from the cached copy, and an entry it names is refused (`revoked`) — or shown with the warning when the action is `warn`; a revoked theme already installed is shown on its card with the reason and the action, never silently applied again. The `yanked` case is refused at the offer (`yanked`, D2).
- [ ] `planTheme(preview)` → `{ ok, id, style, pack, kit: { skills, teams, automations }, notInstallable, rejected }`: `style` is the one `kybernos/theme#theme` contribution (`{ id, name, settings, file }`); `pack` is the one `kybernos/core#domain-pack` contribution with its `menu`, `home` and `goals` (`{ id, name, file, words, goals }`); `kit.skills` holds the pack's `goals[].skills` (by route), `kit.teams` the pack's team ids **and** the `teams/` contributions (`{ id, file, value }`), `kit.automations` the pack's `goals[].automations` (`{ id, name, prompt, cron, file }`); `notInstallable` holds a `skills/` folder contribution and an `automations/` template contribution (INT9), each with its `file` and a one-line `why`; `rejected` is every refused file the preview carried, verbatim. Every item carries a `file`; an item without one is a bug, not a missing citation.
- [ ] `planTheme` is deterministic (same preview → byte-identical JSON), never invents a datum, and refuses (`{ ok:false, error }`) a preview with no pack (`no-pack`), more than one pack or more than one style (`ambiguous`), or a plan whose style id is not a valid preset id (`style`).
- [ ] `dataPluginProblems(pkg, dir)` is the pre-install pre-check and **agrees with the registry's own table**: a fixture set (a good data package, a package with `dsh.client`, a package with `dsh.bundle.preview`, a package with a `preinstall` script, a package with `bin`, a package whose patch names a module, a package whose patch is `[]`) produces the same verdict as `dataPackageProblems` (`registry.mjs:54-76`) on each. That test is the anti-drift gate: the day the registry's table changes, this one reddens.
- [ ] `readThemes(dir)` / `writeThemes(dir, value)` on `<DSH home>/kybernos/themes.json` (D5 builds `store = { dir }` for the route body): one version (`v: 1`), at most 8 records, at most 256 KiB, written atomically with mode 0600; a corrupt or too-new file reads as empty and is never thrown on; an unknown key in a record is dropped with a named line, not obeyed.
- [ ] `handleThemes({ dir }, request, ports)` → `{ status, body }`, pure over its ports: method first (405), origin (`sameOriginStrict` port) second (403), signed session (`writeRefused` port) third (403/401) — the order of `index.js:11403-11422`; a body over the cap is 413; unknown actions are 400; `{action:'stage', folder}` refuses a folder without `plugin.json` (`not-a-theme`), a code plugin (`code-plugin`), a path with `..`/a symlink (`path`), a package that fails `dataPluginProblems` (`package`); `{action:'plan', id}` answers the plan of an installed plugin; `{action:'record', id, applied}` and `{action:'forget', id}` write the record; `{action:'source-add'|'source-remove'|'refresh'}` manage the bounded source list (https only, max 3, a key pinned and shown); nothing throws on garbage.

`packages/kybernos-plugin/client.js` — the applier lives in a marked **pure core** (`// KB-TH-CORE-BEGIN` … `// KB-TH-CORE-END`), extracted by the tests the way `scripts/test-onboarding.mjs:14-18` extracts `KB-OB-CORE`; the UI block only wires it to `fetch`, to the host bridge (`host.call`) and to the style seam.

- [ ] `kbThApply(plan, ticks, ports)` → `{ ok, already, added, failed, skipped, style, domain }`, never throws, pure over its ports (`ports.get(path)`, `ports.post(path, body)`, `ports.team(item)` → the body `kybers/create` takes, `ports.style(input)`):
  - **lookups first**, so a replay creates nothing: the skills list, `kybers/load`, `/kybernos/tasks {action:'list'}` and the saved choice — the kit's own rule (`client.js:36647-36662`);
  - then, in this order, only for ticked and missing items: `POST /kybernos-registry/consent {id, accepted:true}`, `POST /kybernos/onboarding {action:'domain', profil, goals}`, one POST per skill (`/kybernos/domain/skill` for `source: 'kybernos'`, `/kybernos-skills/install` otherwise), one `POST /kybernos/create` per team (the contributed value, or the shipped team template, `home: true`), one `POST /kybernos/tasks {action:'create'}` per automation with `active: false` and `approvals: 'ask'`, then `ports.style(style.id)` **once**;
  - `goals` in the domain body are the pack's goals that still have **at least one ticked item**: a goal with nothing ticked is not chosen, so the saved choice and the applied kit agree;
  - `added` counts the applied things — the field, the style and each ticked kit item (D3's example: 5);
  - a second call on a profile whose lookups answer the items present makes **no write** (the `/kybernos/tasks` list is a read, as it is for the wizard) and answers `{ already: true }`;
  - no unticked item produces a POST; an automation is never created `active: true`; the core calls **no** other path — in particular nothing that writes a session, a memory or a workspace (the allowlist is asserted on the recorded paths);
  - a step that fails is counted in `failed` and does not stop the next one (the wizard's `kitAdded`/`kitFailed`, `client.js:36713-36714`); a missing seam answers `style: 'unavailable'` and the rest is applied.
- [ ] `kbThFingerprint(settings)` → the stable text of the stored look (its keys sorted), and `kbThRemove(record, current, ports)` → `{ ok, restored, kept }`, pure: the style is restored through `ports.style(record.before.style)` **only** when `current.style` still carries the record's applied id and that fingerprint; the field is restored through `POST /kybernos/onboarding {action:'domain', profil: before.profil, goals: before.goals}` only when `current.domain.profil` is still the theme's; the kit is never deleted (no delete path is called) and `kept` counts it; nothing touches sessions, memory or workspaces. Removing an absent record is `handleThemes`'s job (D5), not this function's.
- [ ] The UI block wires the core: `window.__KB_THEME_INSTALL__` and `window.__KB_THEME_REMOVE__` (published inside `try/catch`, one function reused so a second call does not replace it); `ports.get`/`ports.post` are the wizard's own `call` (`client.js:36105`); `ports.style` is `window.__KB_THEME_APPLY__` when it is a function. The page fills the **shell** ticks (`style`, `goals`) from the Install click and the **kit** ticks from the screen (M3), so the core keeps honouring exactly what it is handed. The manager calls (`installBundle`, `removeBundle`) happen in the page, never in the core.
- [ ] The page: one menu row, one `view: 'themes'` branch, one `views` entry (`client.js:15849-15861`, `:26169`, `:26468-26469`), the cards and the plan drawn with the existing classes; the level badge reads the stored `local`/`unlisted` and the catalogue's own level; no new CSS file, no layout fork.
- [ ] The Settings row for the sources is a bounded field list (https URLs, max 3, add/remove), data only: no journey, no install from Settings.

DoD:

**Commands of THIS repository, run from its root. Each one FAILS on the code as it stands today (2026-10-28, `2ac67fb4`), for the reason quoted under it; each can only pass by implementing the contract.**

D1 — the module exists and the plan is cited, deterministic and complete (fails today: `theme-installer.mjs` does not exist):

Measured on this tree, 2026-10-28: **exit 1** — `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/packages/kybernos-plugin/theme-installer.mjs'`.

```bash
node --input-type=module -e "import*as T from './packages/kybernos-plugin/theme-installer.mjs';const pack={v:1,id:'clinic',order:50,accent:'#1B7F76',icon:'heart',name:{en:'Clinic'},tagline:{en:'Care'},keywords:[],home:['doc','sheet'],menu:{labels:{tasks:'Visits'}},mode:'bureau',agents:{preset:'prudent'},goals:[{id:'recall',name:{en:'Recall'},skills:[{source:'kybernos',name:'patient-reminders'}],teams:['clinic-assist'],automations:[{id:'daily-recall',name:{en:'Daily recall'},prompt:{en:'Draft only.'},cron:'0 8 * * *'}]}]};const preview=[{point:'kybernos/core#domain-pack',class:'instruction',files:[{file:'domains/clinic.json',value:pack}],rejected:[]},{point:'kybernos/theme#theme',class:'inert',files:[{file:'themes/clinic.json',value:{id:'clinic-style',name:'Clinic style',settings:{acc:'#1B7F76'}}}],rejected:[{file:'themes/bad.json',errors:['accessibility setting in a catalogue theme: cbSafe']}]},{point:'kybernos/skills#skill',class:'instruction',files:[{file:'skills/vet-notes',value:{name:'vet-notes'}}],rejected:[]},{point:'kybernos/core#team-template',class:'instruction',files:[{file:'teams/assist.json',value:{id:'assist',name:{en:'Assist'}}}],rejected:[]},{point:'kybernos/core#automation-template',class:'instruction',files:[{file:'automations/recall.json',value:{id:'recall',name:{en:'Recall'}}}],rejected:[]}];const p=T.planTheme(preview);if(p.ok!==true){console.error('planTheme refused a valid preview: '+p.error);process.exit(1)}if(p.style.id!=='clinic-style'||p.style.file!=='themes/clinic.json'){console.error('the style is not the theme point contribution');process.exit(1)}if(p.pack.id!=='clinic'||p.pack.file!=='domains/clinic.json'||p.pack.words.menu.labels.tasks!=='Visits'){console.error('the field or its words are missing');process.exit(1)}if(p.kit.skills.length!==1||p.kit.skills[0].name!=='patient-reminders'||p.kit.skills[0].file!=='domains/clinic.json'){console.error('the pack skill is not in the kit, or not cited');process.exit(1)}if(p.kit.teams.length!==2||p.kit.automations.length!==1||p.kit.automations[0].cron!=='0 8 * * *'){console.error('the kit is incomplete');process.exit(1)}if(p.notInstallable.length!==2||p.notInstallable.filter(function(x){return x.kind==='skill'}).length!==1||p.notInstallable.filter(function(x){return x.kind==='automation'}).length!==1){console.error('the two unwired folders are not shown as not installable');process.exit(1)}if(p.rejected.length!==1||p.rejected[0].file!=='themes/bad.json'){console.error('a refused file was dropped or invented');process.exit(1)}for(const it of [p.style,p.pack].concat(p.kit.skills,p.kit.teams,p.kit.automations))if(typeof it.file!=='string'||it.file===''){console.error('an item has no citation');process.exit(1)}if(JSON.stringify(T.planTheme(preview))!==JSON.stringify(p)){console.error('planTheme is not deterministic');process.exit(1)}console.log('D1 ok')"
```

D2 — the catalogue and the archive are verified before anything is used (fails today: no `verifyCatalogue`/`verifyEntry`/`verifyArchive`):

Measured on this tree, 2026-10-28: **exit 1** — `ERR_MODULE_NOT_FOUND` on `theme-installer.mjs`.

```bash
node --input-type=module -e "import*as T from './packages/kybernos-plugin/theme-installer.mjs';import{generateKeyPairSync,sign,createHash}from'node:crypto';const mk=function(){const kp=generateKeyPairSync('ed25519');return{kp:kp,pem:kp.publicKey.export({format:'pem',type:'spki'})}};const acme=mk(),rev=mk(),off=mk();const sig=function(kp,m){return sign(null,Buffer.from(m),kp.privateKey).toString('base64')};const arch=Buffer.concat([Buffer.from([0x1f,0x8b]),Buffer.alloc(64,7)]);const hash=createHash('sha256').update(arch).digest('hex');const ver=function(id,kp,review){const o={version:'1.0.0',manifest:{id:id,kind:'data'},archive:{url:'https://example.invalid/vet.tgz',sha256:hash,size:arch.length},authorSig:sig(kp,'kybernos-plugin-v1\n'+id+'\n1.0.0\n'+hash)};if(review!==null)o.review=sig(review,'kybernos-plugin-review-v1\n'+id+'\n1.0.0\n'+hash+'\nverified');return o};const doc={schema:1,kind:'kybernos-plugin-catalogue',catalogue:{id:'official',name:'Kybernos',seq:7,publishedAt:'2026-10-27T00:00:00Z'},authors:{acme:{keys:[{keyId:'a1',pem:acme.pem}]}},reviewers:[{keyId:'r1',pem:rev.pem}],plugins:[{id:'acme/vet',versions:[ver('acme/vet',acme.kp,rev.kp)]}],revoked:[],revokedKeys:[]};const bytes=Buffer.from(JSON.stringify(doc));const catKeys=[{keyId:'k1',pem:off.pem}];const ok=T.verifyCatalogue({bytes:bytes,signature:sig(off.kp,bytes),keys:catKeys,floor:null});if(ok.ok!==true||ok.doc.catalogue.seq!==7||ok.key!=='k1'){console.error('a valid signed catalogue was refused',ok);process.exit(1)}if(T.verifyCatalogue({bytes:bytes,signature:'',keys:catKeys,floor:null}).error!=='signature'){console.error('an unsigned catalogue was parsed or accepted');process.exit(1)}if(T.verifyCatalogue({bytes:bytes,signature:sig(off.kp,bytes),keys:catKeys,floor:{seq:8}}).error!=='older'){console.error('a replayed older catalogue was accepted');process.exit(1)}if(T.verifyCatalogue({bytes:bytes,signature:sig(off.kp,bytes),keys:[],floor:null}).error!=='no-key'){console.error('a catalogue was verified with no key');process.exit(1)}const entry=doc.plugins[0].versions[0];const base={id:'acme/vet',version:'1.0.0',entry:entry,catalogueKey:'k1',keys:[{keyId:'a1',pem:acme.pem}],reviewerKeys:[{keyId:'r1',pem:rev.pem}],officialKeys:['k1']};const a=T.verifyArchive(Object.assign({bytes:arch},base));if(a.ok!==true||a.sha256!==hash||a.level!=='verified'){console.error('a valid reviewed archive was refused or its level invented',a);process.exit(1)}if(T.verifyArchive(Object.assign({bytes:Buffer.concat([arch,Buffer.from([0])])},base)).error!=='hash'){console.error('a tampered archive was accepted');process.exit(1)}const other=Object.assign({},entry,{authorSig:sig(acme.kp,'kybernos-plugin-v1\nacme/vet\n0.9.0\n'+hash)});if(T.verifyArchive(Object.assign({bytes:arch},base,{entry:other})).error!=='signature'){console.error('an author signature made for another version was accepted');process.exit(1)}const yank=Object.assign({},entry,{yanked:true});if(T.verifyArchive(Object.assign({bytes:arch},base,{entry:yank})).error!=='yanked'){console.error('a yanked version was offered');process.exit(1)}const official=T.verifyEntry({id:'kybernos/vet',version:'1.0.0',entry:ver('kybernos/vet',acme.kp,rev.kp),catalogueKey:'k1',keys:[{keyId:'a1',pem:acme.pem}],reviewerKeys:[{keyId:'r1',pem:rev.pem}],officialKeys:['k1']});if(official.ok!==true||official.level!=='official'){console.error('the official level is wrong',official);process.exit(1)}const community=T.verifyEntry({id:'acme/vet',version:'1.0.0',entry:ver('acme/vet',acme.kp,null),catalogueKey:'k2',keys:[{keyId:'a1',pem:acme.pem}],reviewerKeys:[{keyId:'r1',pem:rev.pem}],officialKeys:['k1']});if(community.ok!==true||community.level!=='community'){console.error('an author-signed entry from another source is not community',community);process.exit(1)}console.log('D2 ok')"
```

D3 — the applier calls the existing routes only, in order, and a replay writes nothing (fails today: no `KB-TH-CORE` block in `client.js`):

Measured on this tree, 2026-10-28: **exit 1** — `D3: no // KB-TH-CORE-BEGIN block in packages/kybernos-plugin/client.js`.

```bash
D=$(mktemp -d)
cat > "$D/d3.mjs" <<'JS'
import { readFileSync } from 'node:fs'
const src = readFileSync('./packages/kybernos-plugin/client.js', 'utf8')
const m = src.match(/\/\/ KB-TH-CORE-BEGIN([\s\S]*?)\/\/ KB-TH-CORE-END/)
if (m === null) { console.error('D3: no // KB-TH-CORE-BEGIN block in packages/kybernos-plugin/client.js'); process.exit(1) }
const mod = await import('data:text/javascript,' + encodeURIComponent(m[1] + '\nexport { kbThApply }'))
const plan = { id: 'acme/vet', style: { id: 'clinic-style', file: 'themes/clinic.json' }, pack: { id: 'clinic', file: 'domains/clinic.json', words: { menu: { labels: { tasks: 'Visits' } } }, goals: [{ id: 'recall' }, { id: 'quiet' }] }, kit: { skills: [{ name: 'patient-reminders', source: 'kybernos', file: 'domains/clinic.json' }], teams: [{ id: 'clinic-assist', value: null, file: 'teams/assist.json' }], automations: [{ id: 'daily-recall', name: { en: 'Daily recall' }, prompt: { en: 'Draft only.' }, cron: '0 8 * * *', file: 'domains/clinic.json' }] }, notInstallable: [], rejected: [] }
const ticks = { style: true, goals: ['recall'], skills: ['patient-reminders'], teams: ['clinic-assist'], automations: ['daily-recall'] }
const calls = []
const portsFor = (seen) => ({
  get: async (path) => {
    calls.push({ m: 'GET', path })
    if (path.indexOf('/kybernos-skills/skills') === 0) return { ok: true, skills: seen.skills.map((n) => ({ name: n })) }
    if (path.indexOf('/kybernos/load') === 0) return { ok: true, roots: [{ kybers: seen.teams.map((id) => ({ id })) }] }
    if (path.indexOf('/kybernos/onboarding') === 0) return { ok: true, profil: seen.profil || '', goals: seen.goals || [] }
    return { ok: true }
  },
  post: async (path, body) => {
    calls.push({ m: 'POST', path, body })
    if (path.indexOf('/kybernos/tasks') === 0 && body !== null && body.action === 'list') return { ok: true, tasks: seen.tasks.map((n) => ({ name: n })) }
    return { ok: true }
  },
  team: async (item) => ({ name: item.id, id: item.id, home: true }),
  style: async (input) => { calls.push({ m: 'STYLE', input }); return { ok: true, id: 'clinic-style' } },
})
const writes = () => calls.filter((c) => c.m === 'STYLE' || (c.m === 'POST' && !(c.body !== null && c.body.action === 'list')))
const fresh = { skills: [], teams: [], tasks: [], profil: '' }
const r = await mod.kbThApply(plan, ticks, portsFor(fresh))
const posts = calls.filter((c) => c.m === 'POST')
const order = ['/kybernos-registry/consent', '/kybernos/onboarding', '/kybernos/domain/skill', '/kybernos/create', '/kybernos/tasks']
let at = -1
for (const want of order) {
  const i = posts.findIndex((c, j) => j > at && c.path.indexOf(want) === 0)
  if (i < 0) { console.error('D3: missing or out of order: ' + want, posts.map((c) => c.path)); process.exit(1) }
  at = i
}
const firstWrite = calls.findIndex((c) => c.m === 'STYLE' || (c.m === 'POST' && !(c.body !== null && c.body.action === 'list')))
if (firstWrite < calls.findIndex((c) => c.m === 'GET') || firstWrite < calls.findIndex((c) => c.m === 'POST' && c.body !== null && c.body.action === 'list')) { console.error('D3: a write happens before the lookups', calls); process.exit(1) }
const auto = posts.find((c) => c.path.indexOf('/kybernos/tasks') === 0 && c.body !== null && c.body.action === 'create')
if (auto === undefined || auto.body.task.active !== false || auto.body.task.approvals !== 'ask') { console.error('D3: the automation is not created off with approvals ask', auto); process.exit(1) }
const consent = posts.find((c) => c.path.indexOf('/kybernos-registry/consent') === 0)
if (consent === undefined || consent.body.id !== 'acme/vet' || consent.body.accepted !== true) { console.error('D3: no acceptance was sent', consent); process.exit(1) }
const domain = posts.find((c) => c.path.indexOf('/kybernos/onboarding') === 0)
if (domain === undefined || domain.body.action !== 'domain' || domain.body.profil !== 'clinic' || JSON.stringify(domain.body.goals) !== '["recall"]') { console.error('D3: the field or its goals are not written as ticked', domain); process.exit(1) }
const app = calls.filter((c) => c.m === 'STYLE')
if (app.length !== 1 || app[0].input !== 'clinic-style') { console.error('D3: the style is not applied exactly once through the seam', app); process.exit(1) }
if (calls.some((c) => /sessions|memory|workspaces/.test(c.path))) { console.error('D3: a call touches sessions, memory or workspaces', calls); process.exit(1) }
if (r === null || r.ok !== true || r.already !== false || r.added !== 5) { console.error('D3: the report is wrong (field + style + 3 kit items = 5 added)', r); process.exit(1) }
const before = writes().length
const again = await mod.kbThApply(plan, ticks, portsFor({ skills: ['patient-reminders'], teams: ['clinic-assist'], tasks: ['Daily recall'], profil: 'clinic' }))
if (again.already !== true || writes().length !== before) { console.error('D3: the second install is not a no-op', again, writes()); process.exit(1) }
const none = writes().length
const empty = await mod.kbThApply(plan, { style: false, goals: [], skills: [], teams: [], automations: [] }, portsFor(fresh))
if (empty.added !== 0 || writes().length !== none) { console.error('D3: an unticked item was applied', empty, writes()); process.exit(1) }
console.log('D3 ok')
process.exit(0)
JS
node "$D/d3.mjs"
r=$?
rm -rf "$D"
[ "$r" -eq 0 ]
```

D4 — removal restores only what the person has not changed, never deletes the kit, and touches no session (fails today: no `kbThRemove`):

Measured on this tree, 2026-10-28: **exit 1** — `D4: no // KB-TH-CORE-BEGIN block in packages/kybernos-plugin/client.js`.

```bash
D=$(mktemp -d)
cat > "$D/d4.mjs" <<'JS'
import { readFileSync } from 'node:fs'
const src = readFileSync('./packages/kybernos-plugin/client.js', 'utf8')
const m = src.match(/\/\/ KB-TH-CORE-BEGIN([\s\S]*?)\/\/ KB-TH-CORE-END/)
if (m === null) { console.error('D4: no // KB-TH-CORE-BEGIN block in packages/kybernos-plugin/client.js'); process.exit(1) }
const mod = await import('data:text/javascript,' + encodeURIComponent(m[1] + '\nexport { kbThRemove }'))
const record = { id: 'acme/vet', applied: { style: { id: 'clinic-style', fingerprint: 'f1' }, domain: { profil: 'clinic', goals: ['recall'] }, kit: { skills: ['patient-reminders'], teams: ['clinic-assist'], automations: ['daily-recall'] } }, before: { style: 'neutral', domain: { profil: 'sante', goals: [] } } }
const mk = () => {
  const calls = []
  return { calls, ports: {
    post: async (path, body) => { calls.push({ m: 'POST', path, body }); return { ok: true } },
    style: async (input) => { calls.push({ m: 'STYLE', input }); return { ok: true, id: 'neutral' } },
  } }
}
const a = mk()
const ra = await mod.kbThRemove(record, { style: { id: 'clinic-style', fingerprint: 'f1' }, domain: { profil: 'clinic', goals: ['recall'] } }, a.ports)
if (ra.ok !== true || ra.kept.skills !== 1 || ra.kept.teams !== 1 || ra.kept.automations !== 1) { console.error('D4: the kept kit is not reported', ra); process.exit(1) }
if (a.calls.some((c) => /delete|remove|tasks\/delete|skills\/delete/.test(c.path))) { console.error('D4: removal deleted a kit item', a.calls); process.exit(1) }
if (a.calls.some((c) => /sessions|memory|workspaces/.test(c.path))) { console.error('D4: a call touches sessions, memory or workspaces', a.calls); process.exit(1) }
const app = a.calls.filter((c) => c.m === 'STYLE')
if (app.length !== 1 || app[0].input !== 'neutral') { console.error('D4: the previous look was not restored through the seam', a.calls); process.exit(1) }
const dom = a.calls.find((c) => c.m === 'POST' && c.path.indexOf('/kybernos/onboarding') === 0)
if (dom === undefined || dom.body.action !== 'domain' || dom.body.profil !== 'sante') { console.error('D4: the previous field was not restored', dom); process.exit(1) }
const b = mk()
const rb = await mod.kbThRemove(record, { style: { id: 'someone-else', fingerprint: 'f2' }, domain: { profil: 'clinic', goals: [] } }, b.ports)
if (rb.restored.style !== false || b.calls.some((c) => c.m === 'STYLE')) { console.error('D4: a later style choice was overwritten', rb, b.calls); process.exit(1) }
if (rb.restored.domain !== true || b.calls.filter((c) => c.m === 'POST').some((c) => c.path.indexOf('/kybernos/onboarding') !== 0)) { console.error('D4: the field restore is not the only write', rb, b.calls); process.exit(1) }
const c = mk()
const rc = await mod.kbThRemove(record, { style: { id: 'clinic-style', fingerprint: 'f1' }, domain: { profil: 'autre', goals: [] } }, c.ports)
if (rc.restored.domain !== false || c.calls.some((x) => x.m === 'POST')) { console.error('D4: a later field choice was overwritten', rc, c.calls); process.exit(1) }
console.log('D4 ok')
process.exit(0)
JS
node "$D/d4.mjs"
r=$?
rm -rf "$D"
[ "$r" -eq 0 ]
```

D5 — the route body `handleThemes({ dir }, request, ports)`: guards in order, bounded store, no path escape, idempotent forget (fails today: no `handleThemes`):

Measured on this tree, 2026-10-28: **exit 1** — `ERR_MODULE_NOT_FOUND` on `theme-installer.mjs`.

```bash
node --input-type=module -e "import*as T from './packages/kybernos-plugin/theme-installer.mjs';import{mkdtempSync,rmSync,mkdirSync,writeFileSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';const dir=mkdtempSync(join(tmpdir(),'a6-dod-'));try{const store={dir};const ports={sameOrigin:function(){return true},session:function(){return true},registry:null};const get=T.handleThemes(store,{method:'GET'},ports);if(get.status!==200){console.error('GET is not 200',get);process.exit(1)}const put=T.handleThemes(store,{method:'PUT'},ports);if(put.status!==405){console.error('PUT is not 405',put);process.exit(1)}const foreign=T.handleThemes(store,{method:'POST',body:{action:'source-add',url:'https://example.invalid/c.json'}},{sameOrigin:function(){return false},session:function(){return true},registry:null});if(foreign.status!==403){console.error('a foreign origin was not refused',foreign);process.exit(1)}const noSession=T.handleThemes(store,{method:'POST',body:{action:'source-add',url:'https://example.invalid/c.json'}},{sameOrigin:function(){return true},session:function(){return false},registry:null});if(noSession.status!==403&&noSession.status!==401){console.error('a write without the signed session was accepted',noSession);process.exit(1)}const huge=T.handleThemes(store,{method:'POST',body:{action:'x',pad:'y'.repeat(300000)}},ports);if(huge.status!==413){console.error('an oversized body was not 413',huge.status);process.exit(1)}const unknown=T.handleThemes(store,{method:'POST',body:{action:'nope'}},ports);if(unknown.status!==400){console.error('an unknown action was not 400',unknown.status);process.exit(1)}const noTheme=T.handleThemes(store,{method:'POST',body:{action:'stage',folder:'/etc'}},ports);if(noTheme.status!==400||noTheme.body.error!=='not-a-theme'){console.error('a folder that is not a theme was accepted',noTheme);process.exit(1)}const bad=join(dir,'code');mkdirSync(bad);writeFileSync(join(bad,'plugin.json'),JSON.stringify({contract:1,id:'acme/code',kind:'code',version:'1.0.0',name:{en:'C'},description:{en:'d'},author:{id:'acme',name:'A'},license:'MIT',pricing:'free'}));const refused=T.handleThemes(store,{method:'POST',body:{action:'stage',folder:bad}},ports);if(refused.status!==400||refused.body.error!=='code-plugin'){console.error('a code plugin was not refused',refused);process.exit(1)}const escape=T.handleThemes(store,{method:'POST',body:{action:'stage',folder:'../..'}},ports);if(escape.status!==400){console.error('a path with .. was accepted',escape);process.exit(1)}const rec=T.handleThemes(store,{method:'POST',body:{action:'record',id:'acme/vet',applied:{style:{id:'vet',fingerprint:'f'}}}},ports);if(rec.status!==200){console.error('a record was not written',rec);process.exit(1)}const read=T.readThemes(dir);if(read.v!==1||read.records.length!==1||read.records[0].id!=='acme/vet'){console.error('the record file does not read back',read);process.exit(1)}const forget=T.handleThemes(store,{method:'POST',body:{action:'forget',id:'acme/vet'}},ports);if(forget.status!==200||T.readThemes(dir).records.length!==0){console.error('a record was not forgotten',forget);process.exit(1)}const forget2=T.handleThemes(store,{method:'POST',body:{action:'forget',id:'acme/vet'}},ports);if(forget2.status!==200||forget2.body.already!==true){console.error('forgetting an absent record is not a no-op',forget2);process.exit(1)}const src=T.handleThemes(store,{method:'POST',body:{action:'source-add',url:'https://example.invalid/c.json'}},ports);if(src.status!==200){console.error('a source was not added',src);process.exit(1)}const insecure=T.handleThemes(store,{method:'POST',body:{action:'source-add',url:'http://example.invalid/c.json'}},ports);if(insecure.status!==400){console.error('an http source was accepted',insecure);process.exit(1)}for(const junk of [null,{},[],'x',{method:42},{method:'POST',body:'x'}]){const a=T.handleThemes(store,junk,ports);if(a===null||typeof a!=='object'||typeof a.status!=='number'){console.error('handleThemes threw or answered garbage',junk,a);process.exit(1)}}}finally{rmSync(dir,{recursive:true,force:true})}console.log('D5 ok')"
```

D6 — the pre-check cannot drift from the registry's own table (fails today: no `dataPluginProblems`):

Measured on this tree, 2026-10-28: **exit 1** — `ERR_MODULE_NOT_FOUND` on `theme-installer.mjs`.

```bash
node --input-type=module -e "import*as T from './packages/kybernos-plugin/theme-installer.mjs';import*as R from './packages/kybernos-registry/registry.mjs';import{mkdtempSync,rmSync,writeFileSync,mkdirSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';const dir=mkdtempSync(join(tmpdir(),'a6-dod-'));try{const cases=[{name:'good',pkg:{name:'@acme/vet',version:'1.0.0',dsh:{bundle:{patch:'./cordis.patch.yml'}}},patch:'[]\n'},{name:'client',pkg:{name:'@acme/vet',version:'1.0.0',dsh:{bundle:{patch:'./cordis.patch.yml'},client:'./client.js'}},patch:'[]\n'},{name:'scripts',pkg:{name:'@acme/vet',version:'1.0.0',scripts:{postinstall:'node x.js'},dsh:{bundle:{patch:'./cordis.patch.yml'}}},patch:'[]\n'},{name:'bin',pkg:{name:'@acme/vet',version:'1.0.0',bin:{vet:'./x.js'},dsh:{bundle:{patch:'./cordis.patch.yml'}}},patch:'[]\n'},{name:'patch-names',pkg:{name:'@acme/vet',version:'1.0.0',dsh:{bundle:{patch:'./cordis.patch.yml'}}},patch:'- id: x\n  insert: []\n'}];for(const c of cases){const d=join(dir,c.name);mkdirSync(d,{recursive:true});writeFileSync(join(d,'cordis.patch.yml'),c.patch);writeFileSync(join(d,'package.json'),JSON.stringify(c.pkg));const mine=T.dataPluginProblems(c.pkg,d);const theirs=R.dataPackageProblems(c.pkg,d);const bad=(x)=>Array.isArray(x)&&x.length>0;if(bad(mine)!==bad(theirs)){console.error('the installer and the registry disagree on '+c.name,{mine,theirs});process.exit(1)}if(c.name==='good'&&bad(mine)){console.error('a good data package was refused',mine);process.exit(1)}}console.log('D6 ok')}finally{rmSync(dir,{recursive:true,force:true})}"
```

D7 — the page is registered, the core is marked, and the batch's own suite is green (fails today: no `themes` view, no `KB-TH-CORE` block, no test file):

Measured on this tree, 2026-10-28: **exit 1**, no output — the first `grep` finds no `KB-TH-CORE-BEGIN`.

```bash
grep -q "KB-TH-CORE-BEGIN" packages/kybernos-plugin/client.js && grep -q "data-kb-page': 'themes'" packages/kybernos-plugin/client.js && grep -q "view === 'themes'" packages/kybernos-plugin/client.js && grep -q "__KB_THEME_INSTALL__" packages/kybernos-plugin/client.js && grep -q "__KB_THEME_REMOVE__" packages/kybernos-plugin/client.js && node packages/kybernos-plugin/test-theme-installer.mjs
```

Notes on how these are read. D1, D2, D5 and D6 are behavioural on purpose: they fail today because an export is missing, and they can only pass by implementing the contract, not by adding a string to a file. D3 and D4 are the gate's discriminators: they are fake-fetch assertions over the real `client.js` source, so they fail an implementation that calls a route the batch does not own, creates an automation on, deletes a kit item on removal, or overwrites a later style choice — not just one that forgets the global. D7 pairs a presence check with the batch's suite because the page is otherwise only proven by a capture; the presence check is what fails today, the suite is what keeps it honest afterwards. **None of these commands is already green** — re-checked after this correction cycle, on the same tree: `packages/kybernos-plugin/theme-installer.mjs` and `test-theme-installer.mjs` are absent, and `KB-TH-CORE-BEGIN`, `data-kb-page': 'themes'` and `view === 'themes'` are absent from `client.js`, so all seven still exit 1 for the quoted reason. The gates that already pass are in E10 and the regression list below.

**Regression gates (measured today, therefore not DoD):** `node packages/kybernos-plugin/test-domain-pack.mjs`, `node packages/kybernos-plugin/test-onboarding-state.mjs`, `node scripts/test-onboarding.mjs`, `node packages/kybernos-registry/test-registry.mjs`, `node packages/kybernos-theme/test-preset-store.mjs`, `node packages/kybernos-skills/test-index.mjs` — all pass at the baseline and must stay green; `node scripts/run-all-tests.mjs` carries the pre-existing reds of bound decision D8 (`docs/tests/porte-go-verdicts.md:77-81`, campaign file, post-baseline; 12 files as measured by `docs/tests/gate-verdicts-marche.md`, same carve-out) and A6 adds none. Before the push: `node scripts/garde-depot.mjs && node scripts/test-lifecycle-engine.mjs && node scripts/test-paquet.mjs`.

## Acceptance note

A box is closed by a test, a command or a capture, never by a comment; a closed box whose proof lives only in a throw-away script is an open box. The six AMBIGUITY lines were the human's; **the owner ratified all six on 2026-10-28 (M1, M4) and each keeps its one-word veto** — stage-then-plan, keep-the-kit, the ONE `Themes` page (with A7's listing a view over it), the deferred skills write, the refused unverifiable source, and this batch owning the catalogue wire while A7 consumes it. A veto still lands as a one-line edit of the corresponding decision above, and nothing here was settled silently. The two cross-batch dependencies that must not be re-decided here: the style seam, whose shape is `A1-theme-seam`'s (`A1-theme-seam-strategy.md:54-58`) and which A6 consumes exactly as the wizard does, never widens; and the catalogue wire, which is this batch's and is frozen for A7 in the section above (M1). A6 is written against the pre-A5 names (`kybernos/theme`, `theme-presets.json`); the rename batch is sequenced last and its table must carry this batch's new strings (already "style" for the visual layer) and its new files. If a reviewer finds a sixth validator in this batch, that is the NO-GO: one validator per point (INT2) is what makes an installed theme trustworthy.
