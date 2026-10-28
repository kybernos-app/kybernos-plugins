# Gate verdict — marche 3, A7 revision 3 (validateur-spec, fail-closed)

Run: cold re-judgement of `docs/tests/A7-theme-marketplace-strategy.md` (774 lines, read cold on disk,
2026-10-28 ~05:55-06:10 Europe/Paris), after the owner's M6-M9 correction cycle. Method: all eight
DoD blocks extracted verbatim and run cold from the repository root; D2 proven reachable with a
fixture pure block under the M8 regex **and** unreachable under the pre-M8 regex; every `file:line`
of the 58-row anchor table re-checked at the declared baseline `2ac67fb4` (`git show
2ac67fb4:<path>`), with the three candidate trees cross-compared (`2ac67fb4`, `3efbdfdb`, the
worktree `a11942f1`); `docs/tests/A6-theme-installer-strategy.md` (455 lines, mtime 05:23) read on
disk for the M6/M7/M9 claims. Calibration inherited from marche-2: AMEND when a gate check fails in
substance — a false premise, an unapplied bound decision, or a **dishonest baseline record**;
isolated anchor slips are listed as re-pin fixes and do not flip on their own.

## Ground truth (measured this run)

- **D2/unit contradiction RESOLVED.** D2's forbidden list is now
  `/(createPublicKey|createHash|verifyEntry|verifyCatalogue|officialKeys)/` (M8). A minimal conforming
  pure block — `marketCards` carrying `source`/`sha256`/`size` and `marketInstallable` checking
  `entry.archive.sha256` — runs D2's exact script to `D2 ok` (exit 0); the same block fails the
  pre-M8 regex (`sha256` listed) with the quoted `FAIL: the listing block hashes or verifies` line.
  The contradiction was real (the old regex rejected the very field the unit requires) and is gone.
- **All eight DoDs exit 1 today, each for its quoted reason, verbatim.** D1 `FAIL: no KB-MARKET-PURE
  block (the listing's pure helpers)…`; D2 `FAIL: no KB-MARKET-PURE block … (the level must be read
  from the route)`; D3 `FAIL: … registers no settings section 'kybernos-themes-market' …`; D4 `FAIL:
  the listing does not read A6's GET /kybernos/themes`; D5 `FAIL: KB_NAV_KEYS has no title for
  'kybernos-themes-market'`; D6 `FAIL: no state block (kb-market-state) …`; D7 `FAIL: no Install
  action (kb-market-install) …`; D8 `FAIL: the signed catalogue is verified in 0 modules …`.
- **D1-D8 reachable on a conforming implementation** (preconditions checked on the tree): the
  registration literal `name: 'settings.section', id: …` matches D3's grep (Tools at
  `client.js:29691` baseline); `GROUPES` closes at `\n      ]`, matching D5's regex, and `ICONES`
  entries are `'<…`, matching D5's icon grep; the look group can hold `theme, themes, language` in
  order on A7's one granted `mots` line; `catalogue.json` is absent from `client.js` (D4's negative
  check passes on any conforming page); the dropped route/path name **0** code files and
  `verifyCatalogue` **0** modules today (D8 reaches 1 after A6's `theme-installer.mjs`).
- **M6 landed.** The README row claims **both** hunks (`:15-18` sidebar bullet, `:23`
  Settings-sections bullet — both verified present at the baseline at those exact lines) as A7's own;
  no "A6's edit" attribution remains in the file table; A6's `§file` declares its four-file perimeter
  (`theme-installer.mjs`, `client.js`, `index.js`, `test-theme-installer.mjs`) and never names
  `README.md`, so "A6's four-file perimeter stands unchanged and touches no README" is true as
  written.
- **M7 landed in A7 as the owner prescribed — but its A6-side backing is not on disk.** INT6, the
  wires row, the new anchor row and the decisions table all cite "A6 `§unit`, adopted 2026-10-28" for
  `__KB_THEME_INSTALL__`/`__KB_THEME_REMOVE__` and A7 keeps `{ source: 'catalogue', id, version }`
  verbatim in `marketInstall`. **Measured against A6: its `§unit` (the `unit:` section) wires the two
  seams but freezes no call signature anywhere in the file** — `grep` for the shape, for
  `'catalogue'` as a literal, and for any adoption wording finds nothing; A6's only signature-shaped
  lines are `verifyEntry`'s parameters and INT6's record `{ id, version, level, source, applied,
  before, at }`. The anchor row is honest about this ("an adoption ruling, no line pin … not a line
  re-read today"), but correction 15 ("It is now a line: A6 `§unit` adopts …") and the wires row's
  "A6 `§unit` adopted … on 2026-10-28" read as landed in A6's file. The wire's A6 end is frozen by
  the **owner's ruling M7**; A6's file has not yet carried it (A6's writer is amending; 455 lines at
  05:23).
- **M8 landed.** The regex drops the literal `sha256` only; the D2 comment says why; the unit keeps
  `source`/`sha256`/`size` and the `archive.sha256` presence check; the levels table's Official row
  no longer asserts `sha256` among D2's claims.
- **M9 landed.** D4's failure message and notes say the count is over `packages/kybernos-plugin/
  index.js` alone (0 before A6, 1 after); every actual citation of `kybernos-models/client.js` (V's
  judgement line, anchors rows, INT2) carries the `packages/` prefix (the unprefixed mentions left
  are shorthand in the correction texts, not citations); correction 11 is re-quoted from A6's current
  `§owe` — A6 on disk says "A7's list is A7's code", matching the quote.
- **M1-M5 still hold.** The yield/dropped list is intact and still greped by D8; the two M2 line sets
  are cited and disjoint at the baseline — A6 (`:15849-15861`, `:26169`, `:26468-26469`) and A7
  (`:3005-3016`, `:33675`, `:33696`), each verified line-by-line at `2ac67fb4`; M3 one-click holds in
  INT6/E1/V8/D7 (automations `active: false`, `approvals: "ask"`); M4's defaults point at A6's
  §AMB1/2/4/5 without restating them; M5's carve-outs are the three the head note names.
- **Six sections at line start:** `e2e:` `vision:` `capture:` `maquette:` `unit:` `DoD:` — all six at
  column 0, none duplicated or indented.
- **Perimeter vs A6's four files:** disjoint at the declared level. A7's perimeter is `client.js`
  (two `KB-MARKET-*` blocks + three granted rows), `test-theme-market.mjs` (new), `README.md` (two
  hunks) and the out-of-git maquette; the only shared file with A6's four is `client.js`, which M2
  ratifies as disjoint venue line sets plus each batch's own marked block (`KB-MARKET-*` vs A6's
  `KB-TH-CORE-*`), and no A7 hunk touches `theme-installer.mjs`, `index.js` or
  `test-theme-installer.mjs` (D4/D8, the Lane falsifier, enforce it).
- **Anchors: 58 rows counted mechanically (300-357 + header) — and the record is wrong by two rows.**
  51 of the 53 "exact" rows verify at `2ac67fb4` (spot-complete sweep this run: the signed messages,
  the catalogue shape/`seq`, the five levels, the manifest fields, sources/pinning, kit ticks and
  switch rules, registry `sourceOf`/symlink/preview, `host.mjs:10-11`, `kt`/`pair`, `KB-OB-CORE`,
  `pack.kit`, A2/A3/A1-kit anchors, `plugin.json:51/:67/:103`, `index.js:30`,
  `index.js:10737-10752`, README `:15-18`/`:23`, the mockup hexes and controls, `build-catalog`,
  `garde-depot`, `test-no-french-literals`, `live-testing`, `sante.json`, the M2/M5 rows); the four
  campaign-file carve-outs and the A6/A5/M7 carve-out rows are labelled and honest (measured:
  `git cat-file -e 2ac67fb4:` fails on all four campaign files, A6 is untracked, the six other Phase
  A specs exist at the baseline, the short names are unique there). **Two rows are pinned to the
  post-GO tree instead of the declared baseline** (they match `3efbdfdb` *and* `a11942f1` exactly):
  - row "A page's shell in the panel": `client.js:25806`/`:25823`/`:25838` — at `2ac67fb4` those
    lines hold unrelated code; the shells are at `:25764` (dashboards), `:25781` (kyber), `:25796`
    (skills);
  - row "A settings section is registered through the core slot": `client.js:29741-29743` (Tools) /
    `:30337-30339` (Voice) — at `2ac67fb4` those lines hold CSS/other code; the registrations are at
    `:29690-29692` (Tools) and `:30286-30288` (Voice). The unit section's "this bundle's idiom
    `client.js:29741-29743`" carries the same mis-pin.
  Both rows say "exact" and the table's closing sentence asserts "every anchor of this file resolves
  at `2ac67fb4` except the rows that carry a carve-out" and "53 exact at `2ac67fb4`" — as measured
  that record is false by two rows (the real count is 51 exact at the baseline + 2 post-GO pins).
  The claims themselves are true of the code; only the pins and the record sentence are wrong.

---

## docs/tests/A7-theme-marketplace-strategy.md

verdict: AMEND
blame: spec-error
raison: The cycle answered the substance completely and provably: the D2/unit contradiction is
resolved (a conforming block with `sha256` on the card passes D2's exact script under M8 and fails
under the old regex — measured both ways), all eight DoDs exit 1 today for their verbatim quoted
reasons and are reachable on the tree, M6/M8/M9 landed exactly as bound (README ownership vs A6's
four-file perimeter verified against A6's own `§file`; the D4 narrowing; the `packages/` prefix; the
re-quoted `§owe`), and M1-M5 hold (yield and D8 greps, the two disjoint venue line sets verified at
the baseline, one-click in INT6/E1/V8/D7, the M4 pointers, the M5 carve-outs). Six sections sit at
line start and the perimeter is disjoint from A6's four files at the declared level (the shared
`client.js` bounded to disjoint line sets and distinct marked blocks). It fails "anchors honest" on
two rows and on the record that vouches for them: the page-shell row (`:25806`/`:25823`/`:25838`)
and the settings-registration row (`:29741-29743`/`:30337-30339`, echoed in `unit`'s idiom cite)
resolve at `3efbdfdb`/`a11942f1`, not at the declared baseline `2ac67fb4` where they hold unrelated
content (the real baseline lines are `:25764`/`:25781`/`:25796` and `:29690-29692`/`:30286-30288`),
while the table marks them "exact" and the closing sentence claims every non-carve-out anchor
resolves at `2ac67fb4` ("53 exact") — a baseline record a reader would trust and that is false by
two rows. Second, non-flipping but reader-visible: correction 15's "It is now a line: A6 `§unit`
adopts …" and the wires row's past-tense "A6 `§unit` adopted …" are backed only by the owner's
ruling M7 — A6's file as it stands (455 lines, measured 06:05) carries no adoption line; the anchor
row's "an adoption ruling, no line pin" is the accurate wording and should be the one used
everywhere until A6 lands the line. Fixes are small and listed below; nothing here changes what is
built, and if the owner accepts the two rows as marche-2-class re-pin fixes and the M7 cite as the
ruling it is, the file is otherwise GO-equivalent — fail-closed, the record must be corrected first.

## Remaining ambiguities (the owner's, nothing here is settled by the gate)

1. **(A7/A6) The M7 backing line.** A6's `§unit` does not carry the `{ source: 'catalogue', id,
   version }` adoption for `__KB_THEME_INSTALL__`/`__KB_THEME_REMOVE__` as the files stand. Either
   A6's writer lands that line before the merge (then A7 stands exactly as written) or A7's
   correction 15 and wires row reword to "owner ruling M7, adopted 2026-10-28; A6's `§unit` line
   pending" — one word from the owner. A7 cannot edit A6's file (author role: its own file only).
2. **(A7) The two mis-pinned anchor rows and the record sentence.** Re-pin to the baseline numbers
   measured above (`:25764`/`:25781`/`:25796`; `:29690-29692`/`:30286-30288`, and the unit's idiom
   cite) and correct the closing count to "51 exact at `2ac67fb4`, 2 re-pins", or tag the two rows
   with an explicit post-GO carve-out and adjust the sentence the same way. Mechanical either way;
   the owner chooses which record they want.
3. **(A7, note not a defect)** The revision-3 claim that the M1-M5 yield and INT6/E1/V8/D7 are
   byte-identical to revision 2 apart from the M7 clause cannot be verified from disk (revision 2's
   bytes are gone — the file is untracked and was rewritten in place); nothing measured contradicts
   it, and the substance of those sections checks out.
