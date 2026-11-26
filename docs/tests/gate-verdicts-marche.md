# Gate verdicts — the three marche specs (validateur-spec, fail-closed)

Run: cold gate over `A6-theme-installer`, `A7-theme-marketplace`, `A8-theme-content-six`, 2026-10-28
~05:00-05:30 (Europe/Paris), this worktree at HEAD
`3efbdfdb` (the four GO batches are implemented and committed; measurements below are dated, the tree
moves). Every anchor was checked against the declared baseline `2ac67fb4` (`git show
2ac67fb4:<path>`), never against memory; post-baseline campaign files were checked on disk and are
marked as such. This file is the campaign artifact for the marche gate.

Calibration (same as the final Phase A pass): a spec is **AMEND** when a gate check fails *in
substance* — a false premise that changes what is built or reviewed, an unapplied bound decision, or
a dishonest baseline record. Isolated anchor slips (off-by-small, or a post-baseline campaign file
cited without its carve-out) are listed per spec as **re-pin fixes** and do not flip a verdict on
their own; the owner may veto any GO on the strength of a listed slip.

Ground truth (measured this run, not quoted from the specs):

- **DoD discrimination**: all 20 commands (A6 7, A7 8, A8 5) were extracted verbatim from the spec
  files and run cold from the repository root. **All 20 exit 1 today, each for the reason its spec
  quotes** — `ERR_MODULE_NOT_FOUND` on `theme-installer.mjs` (A6 D1/D2/D5/D6), the `KB-TH-CORE`
  absence (A6 D3/D4), A6 D7 silent exit 1 as claimed, A7's eight `FAIL:` lines including D4 printing
  exactly the seven routes the spec lists, A8's five messages including `seq not bumped (HEAD 5,
  now 5)`. No DoD is green today; each can only pass by implementing its contract.
- **Anchor sweep** (mechanical over every explicit `file:line`): A6 107 distinct anchors (72 in range
  at the baseline; 32 short-name continuations resolved in context and spot-checked; 3 post-baseline
  cites), A7 113 (108 in range; the 5 off-baseline cites are all under its head-note carve-out or
  labelled as a quoted test message), A8 84 (64 in range; 4 off-baseline, no carve-out). Content
  spot-checks: ~90 load-bearing claims dumped line by line at the baseline — the great majority
  exact (the three switch rules, "nothing installed without a tick", automations created off, DSH's
  manager `inspect`/`installBundle`/`removeBundle`, the five trust levels and "a level never survives
  a change", the catalogue document format and `seq` rule, the six pack accents at `:5`, A3's
  case-insensitive accent invariant at `:48`, A4's `{ id, name, settings }` at `:251` and its ungated
  journey at `:299`, `test-domain-pack.mjs:253` "one colour per field" and `:247` "a keyword belongs
  to one field", `test-settings-nav.mjs:117-121`, the hub's whole anchor set, the 27
  `settings.section` mounts, `test-help.mjs`'s « ten » message over eleven names). Slips listed per
  spec below.
- **Six sections** `e2e:` `vision:` `capture:` `maquette:` `unit:` `DoD:` at line start: present in
  all three specs (grep `^e2e:` … `^DoD:`).
- **Merge-gate discipline (D8)**: `node scripts/run-all-tests.mjs` measured now → exit 1, **12 RED**
  (`test-consistency-guards`, `test-help-mounts`, `test-help`, `test-layout`, `test-no-french-literals`,
  `test-no-legacy-hosts`, `test-plugin-scan`, `test-readmes`, `test-signposts`, `test-menu-icons`,
  `test-settings-nav`, `test-host` of kybernos-servers) — file for file A8's attributed list; A7's 13
  predates A3's `test-client.mjs` fix and says so. No spec claims the suite is green; all three record
  the reds.
- **Hygiene**: `node scripts/garde-depot.mjs` → 0 errors, 1 pre-existing warning (a personal path in
  `docs/tests/gate-verdicts-final.md`); `node scripts/build-catalog.mjs --check` → green (48 modules);
  no media and no home-directory path in any of the three specs.
- **The pair question that decides two verdicts**: A6 and A7 both claim the *catalogue supply*. A7
  freezes ONE source (path `<DSH home>/kybernos/themes/catalogue.json`, reader `theme-market.mjs`,
  route `GET /kybernos-hub/themes`, "no other file may parse the catalogue document") and names A6 as
  its consumer. A6 on disk mints the same surface itself (its own `verifyCatalogue`/`verifyEntry`/
  `verifyArchive`, https `pluginCatalogues` sources, a `/kybernos/themes` route family, a
  `<DSH home>/kybernos/themes.json` record) and its wires table never mentions A7. The marketplace and
  the installer therefore do **not** share one source as the two files stand.

---

## docs/tests/A6-theme-installer-strategy.md

verdict: AMEND
blame: spec-error
raison: The batch is otherwise well formed — 7/7 DoDs discriminate (measured, exact reasons), the flow
honours the build contract (page primitive; catalogue sources as a bounded Settings field row; ticks
authoritative and an empty tick list writes nothing (D3); automations created `active:false` with
`approvals: 'ask'`; every plan item cited to its file), the lane falsifier is real, the five
AMBIGUITYs are correctly left open, and the anchor ledger is close to exact. It fails on substance at
the one cross-batch wire the campaign made non-negotiable: "Cross-batch wires (named, never minted
here)" mints the catalogue source/verification surface that A7-theme-marketplace — on disk in the
same directory — freezes as its own single reader/path/route, with A6 named as consumer. The two
specs cannot both be implemented as written (two catalogue documents, two readers, two source
mechanisms), and A6 carries no wire entry and no AMBIGUITY line where A7-1's veto could land.
Re-pin fixes, non-flipping: (1) `index.js:31` → the packs import is `index.js:30` at the baseline;
(2) `plugin.json:66` → `fs.write:dsh-home` is `:67`; (3) `ui.slot:conversation.view` is `plugin.json:51`,
outside the cited `:56-104` (the `/kybernos` prefix at `:103` is inside, correct); (4)
`docs/tests/porte-go-verdicts.md:30-33/:46-48/:77-81` postdate the baseline and need the carve-out A7
already carries — the blanket "every `file:line` below is verified with `git show 2ac67fb4:<path>`"
is false for those three cites.

## docs/tests/A7-theme-marketplace-strategy.md

verdict: AMEND
blame: spec-error
raison: Measured strengths: 8/8 DoDs discriminate on real repo commands (D4 prints exactly the seven
routes the spec claims); this is the best-anchored file of the three (108/113 at the baseline; the
hub anchors, the pack vocabulary bounds, `test-settings-nav.mjs:117-121`, the 27 `settings.section`
mounts and even the `test-help.mjs` « ten »/eleven discrepancy verify line by line); the trust rule is
non-forgeable by construction; the 13-red regression table is honest, dated and attributed. It fails
on a false premise that changes what is built: the head note builds the whole "shared source" section
on "A6 is not on disk", and A6 is on disk, freezing a *different* catalogue shape (signed plugin
catalogues, https sources, its own verifier and routes). The producer contract frozen here (one
path, one reader, one route, document `kybernos/theme-market`) contradicts the installer spec it
binds, and its self-yield clause ("A6 adopts them… one-line edit per claim") understates the cost:
the shape is baked into D1's fixture, D2's trust rule, D4's route test and D8's greps. One
arbitration (A7-1 (i) vs (ii)) must land before either batch opens. Re-pin fixes, non-flipping:
(1) the symlink refusal is `registry.mjs:37-39` (and `:237-238`), not `:216-221` (dependency checks);
(2) the manifest's `author` row is `plugin-contract.md:86`, not `:93` (`provides`), and the
`{1,31}`/`name ≤ 60` bounds are the entry's own rules, uncited; (3) `KB-PLUGINS-PURE-BEGIN` is at
`packages/kybernos-hub/client.js:295`, not `packages/kybernos-plugin/client.js:295`; (4)
`A2-registry-points-strategy.md:64-68` resolves on the post-correction file — the lane section is at
`:19` at the declared baseline.

## docs/tests/A8-theme-content-six-strategy.md

verdict: GO
blame: none
raison: Every gate check passes. 5/5 DoDs exit 1 today for the quoted reasons (measured; D5's
regression leg `test-client.mjs` runs green first, exactly as the spec says it must). The anchors are
exact where they decide the batch — the four pack accents at `immo/com/droit/edu.json:5`,
`test-domain-pack.mjs:253` "one colour per field" and `:247` "a keyword belongs to one field",
`sanitizeTheme`'s bounds and a11y refusal, `sanitizePreset:104`'s silent drop, `PRESET_KEYS` order,
`toHex` lower-casing, `test-client.mjs:1304`'s round trip, `--bump` as the gallery's only writer — and
the central interpretation (style halves plus one `theme` key per pack, not A2-shaped duplicates) is
argued against the suite's own guards instead of asserted. Build contract: data only, one accent hex
per sector cited to its pack and labelled PROPOSAL, no new UI (existing gallery card and wizard
miniature), nothing created un-ticked, no test file touched. Perimeter: the four OTHER packs only —
`sante`/`recrutement` and `test-domain-pack.mjs` untouched — disjoint from A3 and from A6/A7. Reds
recorded and attributed (12, reproduced file for file by this run), never claimed green. Re-pin
fixes, non-flipping: (1) `recrutement.json:6` postdates the baseline (A3's file, landed `3efbdfdb`) —
the value `#4F5BD5` is correct on disk, but the blanket "every anchor verified with `git show
2ac67fb4`" needs the carve-out; (2) `porte-go-verdicts.md:29-33/:50-57` and
`gate-verdicts-final.md:2-30`, same; (3) the keyword guard is `test-domain-pack.mjs:247` (block
`:242-248`), cited as `:248-250`; (4) D4's recorded "verbatim, first line" is the script's second
line (`immo: keys …` prints first); the failure itself is exactly as described.

---

## Remaining ambiguities (the owner's, nothing here is settled by the gate)

A6 (5 declared, unchanged, plus 1 added by this gate):

1. Staging order — stage the inert package before the one ask (chosen) vs strict no-write-before-ask
   (needs a registry read of an uninstalled folder).
2. What Remove deletes — keep the kit (chosen, rule 2) vs A4's "nothing is left" reading.
3. Where the flow lives — the `Themes` page (chosen) vs a Suite Settings section vs the wizard's Kit
   screen. Note A7 puts its own "Themes" page in Settings: the two pages currently share a name and a
   job.
4. The missing write side for contributed `skills/` folders — defer (chosen) vs a sixth
   `seed-skills.mjs` copy (forbidden) / five copies / a shared service.
5. The official catalogue key — refuse unverifiable sources (chosen) vs ship a placeholder key.
6. **(gate)** Who owns the catalogue supply — A7's reader/path/route with A6 consuming it, or A6's
   verifier/sources with A7 yielding. This is A7-1 seen from A6's side, and one of the two specs must
   carry the veto line.

A7 (4 declared):

7. A7-1 — the catalogue wire: (i) the marketplace owns the source and A6 consumes
   `theme-market.mjs` / `GET /kybernos-hub/themes`; (ii) A6's shape wins and this spec's names, path,
   route and DoD paths yield (the rewrite is larger than its "one-line edit per claim" suggests).
8. A7-2 — what "Official" means: shipped document (chosen, dead until one ships) vs a signed document
   vs a forgeable `author.id`.
9. A7-3 — the venue's price: three granted lines in `packages/kybernos-plugin/client.js` (chosen; the
   reviewer checks the diff shows exactly them) vs a Suite segment at zero core lines. Both A6 and A7
   now edit that file (A6 its page blocks, A7 the three table rows): the grants should be ratified
   together.
10. A7-4 — one click to install (chosen; the click is the person's action) vs a confirmation dialog.
    This is where the build contract's "nothing installs un-ticked" meets a bundle install with no
    kit ticks — worth one explicit word from the owner.

A8 (4 declared):

11. "A2-pack-format shape" read literally vs the style halves actually implemented (the literal
    reading reddens `test-domain-pack.mjs` and yields thirteen tiles, not six).
12. Accent provenance — cited from the pack and labelled PROPOSAL (chosen) until a métier owner
    ratifies a hex; if a ratified hex differs from `pack.accent`, A3's invariant must be re-decided
    for all six themes.
13. Who owns the canonical `settings` form (lower-case hex, `PRESET_KEYS` order) — host
    `sanitizeTheme` canonicalising (recommended by the writer), A4's author docs, or nothing. The
    page silently rejects any other form; A3 already tripped this.
14. Whether the four one-line `theme` links are inside "new data files only" (this gate reads the
    campaign's "A8 adds the four OTHER packs" as covering them; without the links the four styles are
    orphaned).
