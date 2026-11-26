# impl-fix-final — the two BLOCK anchors and the one WARN of the adversarial re-review 2

| | |
|---|---|
| Input | `docs/tests/revue-adversariale-2.md` (verdict BLOCK — narrowed: **B1**, **S1**, **W1**) |
| Tree | `dev` at `6624309e` + this fix batch (uncommitted) |
| Perimeter | `packages/kybernos-plugin/client.js`, `packages/kybernos-plugin/test-theme-market.mjs`, `packages/kybernos-log/client.js`, `scripts/test-consistency-guards.mjs`, the log plate `docs/handoff/journal-activite/maquette-v1/kblg.css`, one new probe under `docs/tests/probes/` |
| Date | 2026-10-28 |

**VERDICT: B1 FIXED, S1 FIXED, W1 FIXED.** The guard's enumeration is unchanged and its ceiling is back where it was; the frozen
Settings source row exists and calls the two seams that already shipped; the skipped/failed report rows are proven again, on the
product's own answer. `node scripts/run-all-tests.mjs` ends with the **same four pre-existing reds** (no new red).

---

## Files touched

| File | What |
|---|---|
| `scripts/test-consistency-guards.mjs:237` | `SHOUTING_ALLOWED` back to five entries — `'kybernos-log': 1` deleted (B1) |
| `packages/kybernos-log/client.js:108` | `.kblg-table th` no longer shouts: `text-transform:uppercase` deleted, weight/size/letter-spacing carry the hierarchy (B1) |
| `docs/handoff/journal-activite/maquette-v1/kblg.css:26` | the plate ships the bundle's CSS byte for byte (`packages/kybernos-log/test-client.mjs`): the same one declaration, so the plate follows the label |
| `packages/kybernos-plugin/client.js:25933-25937` | the applier's skipped rows carry the item's own `name` (`{ kind, id, name, file }`, additive) (W1) |
| `packages/kybernos-plugin/client.js:30604-30650` | the sources row's pure helpers: `marketSources`, `marketSourceUrlOk`, `marketSourceAdd`, `marketSourceRemove`, `marketSourceError`, the three bounds (S1) |
| `packages/kybernos-plugin/client.js:30675-30751` | `KbMarketSources` — the Settings row itself: list, add, remove, pinned key + warning (S1) |
| `packages/kybernos-plugin/client.js:30826` | the section draws the row (`h(KbMarketSources, { lang, view, reload: relire })`) (S1) |
| `packages/kybernos-plugin/client.js:30859-30877` | the row's CSS, `.kbtm-` prefix only, existing font sizes only |
| `packages/kybernos-plugin/test-theme-market.mjs:237-255` | the W1 proofs (real applier: named skipped row, plural and singular failed lines, the counter shape in both languages) |
| `packages/kybernos-plugin/test-theme-market.mjs:281-366` | the S1 proofs (route answer read back, the route accepts the panel's own bodies, the caller check, and a render proof: the row drawn from a real answer, its clicks delivering A6's bodies) |
| `docs/tests/probes/probe-market-report-rows.mjs` | new instrument: the skipped/failed rows, re-runnable on its own |

---

## B1 — the A1-16 guard was bent to admit a forbidden class: **FIXED by fixing the label**

**Before.** `scripts/test-consistency-guards.mjs:237` carried `'kybernos-log': 1` (allowed 0 → 1) to absorb
`packages/kybernos-log/client.js:108` — `.kblg-table th{…text-transform:uppercase…}` — i.e. **column headers**, a class the guard's
own frozen text forbids verbatim ("titles, labels, column headers and badges are written in sentence case"), outside its "are the only
ones" enumeration. The dictionary's own labels were already sentence case (`colTime: ['Heure','Time']`, …): only the CSS shouted them.

**After.** The ceiling is back to its five entries — `{ 'kybernos-plugin': 1, 'kybernos-refs': 1, 'kybernos-slides': 2,
'kybernos-dashboards': 2 }` — and the CSS declaration is gone: `font-weight:600;font-size:11.5px;letter-spacing:.02em` (no uppercase,
never a `font-weight`/`font-size` trick that re-capitalises). The guard's comment, its check name and its enumeration are **untouched**.
The approved plate (`docs/handoff/journal-activite/maquette-v1/kblg.css`) is compared byte for byte with the bundle's CSS by
`packages/kybernos-log/test-client.mjs`, so it carries the same one declaration — the plate follows the label, not the reverse.

**Proof**

1. Failing run captured with the ceiling reverted and the CSS still shouting:

   ```
   $ node scripts/test-consistency-guards.mjs        # ceiling reverted, CSS untouched
   AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
   + [ 'kybernos-log 1 (allowed 0)' ]
   - []
       at scripts/test-consistency-guards.mjs:246:10
   exit 1
   ```

2. After the CSS fix, same reverted ceiling:

   ```
   $ node scripts/test-consistency-guards.mjs
   ok   A1-16: no bundle shouts a label with text-transform: uppercase (the Beta pill, avatar initials, slide kicker and dashboard thumbnails are the only ones)
   12 tests passed
   exit 0
   ```

3. The enumeration is unchanged and no justification row was invented:

   ```
   $ grep -n "SHOUTING_ALLOWED = " scripts/test-consistency-guards.mjs
   237:const SHOUTING_ALLOWED = { 'kybernos-plugin': 1, 'kybernos-refs': 1, 'kybernos-slides': 2, 'kybernos-dashboards': 2 }
   $ grep -c "text-transform:\s*uppercase\|textTransform" packages/kybernos-log/client.js
   0
   ```

---

## S1 — the frozen A6:41 / INT5 Settings source row was absent: **FIXED**

**Before.** `source-add` / `source-remove` existed only in `theme-installer.mjs` (the host module) — measured, as the review did:

```
$ grep -c "source-add\|source-remove" packages/kybernos-plugin/client.js
0        (exit 1)
```

The transport and the trust were live, but no person could add a source from the GUI: the marketplace's Settings section rendered the
`no-source` state forever.

**After.** `packages/kybernos-plugin/client.js` carries the row the spec freezes (A6:41 "a bounded field row in Settings, not on the
page"; INT5; A6:289 "bounded field list (https URLs, max 3, add/remove), data only"):

- **the list** — each source's address, its pinned key id, and either « Key pinned · cat-1 » or « No key pinned: this source cannot be
  verified » (the route's own `pinned`/`keyId`, never re-derived on the page);
- **an add** — three bounded fields: the https address (≤ 2000, the route's own `^https://[^\s]{1,2000}$` rule checked in place),
  an optional key id (≤ 64) and an optional public key (≤ 4000, textarea). The count is bounded to three, and the button says so;
- **a remove** — per row, through the route;
- **the warning INT5 freezes** — every source added is Community, its key is pinned on first use and shown, and removing the source
  drops the trust, never the installed themes;
- **one door only** — every write is `kbThApi(body)` → `POST /kybernos/themes {action:'source-add'|'source-remove'}`
  (`theme-installer.mjs:684`, `:695`), the same door the page already reads through, under the unchanged `sameOriginStrict` +
  signed-session checks. No second route, no second path, no file written by the page, no new `fetch`.

**Proof**

1. A production caller exists for each seam (grep, declarations excluded):

   ```
   $ grep -n "marketSourceAdd(\|marketSourceRemove(" packages/kybernos-plugin/client.js | grep -v "const marketSource"
   30709:        const body = marketSourceAdd(url, { keyId, pem })
   30717:        const body = marketSourceRemove(source.url)
   $ grep -n "action: 'source-add'\|action: 'source-remove'" packages/kybernos-plugin/client.js
   30629:      const body = { action: 'source-add', url: u }
   30641:      return u === '' ? null : { action: 'source-remove', url: u }
   $ grep -n "if (action === 'source-add')\|if (action === 'source-remove')" packages/kybernos-plugin/theme-installer.mjs
   684:    if (action === 'source-add') {
   695:    if (action === 'source-remove') {
   ```

2. The real route accepts the panel's own bodies and answers back what the row draws (not a fixture): `test-theme-market.mjs`
   §10 runs `handleThemes` on a temp folder with `mod.marketSourceAdd(...)` / `mod.marketSourceRemove(...)` —
   `200 {ok:true}` then GET lists `{url, keyId:'cat-1', pinned:true}`, then `200 {removed:true}` and the list reads empty.

   ```
   $ node packages/kybernos-plugin/test-theme-market.mjs
     ✓ A6's route accepts the row's add body
     ✓ the route answers back what the row draws: the address, its key id, pinned
     ✓ A6's route accepts the row's remove body, and the list reads empty again
     ✓ the row calls source-add and source-remove through A6's route door, and adds no second one
     ✓ the row is a Settings surface: drawn by the section, with its warning and its bound of three
   ```

3. The row really renders, and its clicks land on A6's door (the UI block evaluated with a small React stub, the tree walked like a
   person would):

   ```
   $ node packages/kybernos-plugin/test-theme-market.mjs
     ✓ the row renders the route's source, its pinned key and the warning, inside the Settings block
     ✓ the row offers a Remove per source
     ✓ the Remove click sends A6's own remove body to A6's own door
     ✓ the add fields are bounded and https-only (the button stays disabled until a valid address)
     ✓ a valid https address enables the add, which sends A6's own add body
     ✓ the row speaks French in French
   82 verifications, 0 failure(s)
   ```

4. The row passes both Settings suites:

   ```
   $ node scripts/test-settings-names.mjs
   9 ✓  0 ✗                                            (exit 0)
   $ node packages/kybernos-plugin/test-settings-nav.mjs
   45 verifications, 0 failure(s)                       (exit 0)
   ```

**Ownership note (a decision, not a drift).** The row is A6's INT5 surface drawn inside the marketplace's Settings section — the only
Settings surface that reads `/kybernos/themes`. The listing's own code still never adds or removes a source (its assertions in §8/§9
are unchanged), and A7 gains no reader, no path and no route. The read-only line « Catalogue sources: … » that A6's Themes page already
draws stays: it displays, it does not configure, and A6:41 forbids configuration *on the page*.

---

## W1 — the skipped/failed report rows lost their only proof: **RESTORED, and made real**

**Before.** `test-theme-market.mjs:218-224` asserted only `kinds.join() === 'style,kit,added'` on the real applier answer (whose
`failed` is `0`); the old assertion on `{ added: 5, skipped: 2, failed: 1 }` was deleted with the fixture. Worse, measured while
restoring it: the real applier reports a skipped item as `{ kind, id, file }` — **no `name`** — and `marketNameOf` read only `name`,
so even a real skipped item drew **no row at all**.

**After.** Two changes, both minimal and additive:

- `kbThApply`'s skipped entries now carry the item's **own** name (`{ kind, id, name, file }`, `client.js:25933-25937`): a skill is
  keyed by its name, a team and an automation by their id, and `name` is the label the plan showed. The top-level report keys are
  unchanged (`test-theme-installer.mjs:555`'s `skipped.length === 4` still holds). **The client's frozen line stays literal** — "an
  item without a name is dropped, never invented" — so `marketNameOf` is untouched: the applier names, the report draws;
- the suite proves the rows on the product's answers: one un-ticked kit item + refused writes (`skipped` row `patient-notes`,
  `3 steps failed`), one failing step (`1 step failed`), and the counter shape the seam also takes
  (`style,kit,added,skipped,failed`; `5 items added | 2 items skipped | 1 step failed`; French `5 éléments ajoutés | 2 éléments
  ignorés | 1 étape en échec`).

**Proof**

1. New instrument, failing run captured with the applier's naming reverted:

   ```
   $ node docs/tests/probes/probe-market-report-rows.mjs     # name fields reverted
     ok   A6's applier really skipped one item and failed more than one step
     FAIL the skipped item carries its own name, and the row is drawn from that real answer — [{"kind":"style",…},{"kind":"kit",…},{"kind":"added","count":1,…},{"kind":"failed","count":3,"text":"3 steps failed"}]
   1 failure(s)     (exit 1)
   ```

2. Green with the fix:

   ```
   $ node docs/tests/probes/probe-market-report-rows.mjs
     ok   the skipped item carries its own name, and the row is drawn from that real answer
     ok   and the failed line is plural on it
     ok   the singular failed line is drawn
     ok   the counter answer draws style, kit, added, skipped and failed
     ok   the counters read 5 / 2 / 1 in English
     ok   and in French
   W1 ok — the skipped and failed rows are drawn from the product's own answer and from the counter shape     (exit 0)
   ```

3. The suite carries the same assertions (7 new checks in `test-theme-market.mjs` §7, plus its own §10): `82 verifications, 0 failure(s)`.

---

## The suite: `node scripts/run-all-tests.mjs`

**Before** (the re-review's measurement on this same tree, `6624309e`): **532 test files, 528 green, 4 RED** — `scripts/test-help.mjs`,
`scripts/test-no-legacy-hosts.mjs`, `packages/kybernos-servers/test-host.mjs` (8 failures), `scripts/test-plugin-scan.mjs`.

**After** (measured on this tree with `node scripts/run-all-tests.mjs`, twice, the last run after the final rename of the row's two
handlers): **532 test files in 133 s — 528 green, 4 RED** (exit 1), the red set
exactly the four above:

```
532 test files in 133 s: 528 green, 4 RED
  RED    scripts/test-help.mjs                                  (kybernos-webapp-creator has no help article)
  RED    scripts/test-no-legacy-hosts.mjs                       (stale api.kybernos.app literals)
  RED    scripts/test-plugin-scan.mjs                           (kybernos-pulse → exec undeclared)
  RED    packages/kybernos-servers/test-host.mjs                (8 failures, stale servers fixture)
```

No new red: the four survivors are the same four, and every file this batch touches is green
(`test-consistency-guards.mjs` 12/12, `test-theme-market.mjs` 82/82, `test-theme-installer.mjs` 48/48,
`packages/kybernos-log/test-client.mjs` 28/28, `scripts/test-settings-names.mjs` 9/9,
`packages/kybernos-plugin/test-settings-nav.mjs` 45/45). `node scripts/garde-depot.mjs`: 0 error, the same four pre-existing personal-path
warnings (none in this batch's files).

---

## What was refused, and what was not done

- **Refused:** raising `SHOUTING_ALLOWED` for a class the guard's own text names forbidden (B1) — the guard's text wins; the label
  is fixed instead. **Refused:** any second route or client-side source list for S1 — the row calls the two seams that shipped.
- **Not in this batch** (the review itself puts them at ticket level): F-29 (no « Apply the look » retry), F-30 (A7's second
  « Thèmes » listing), F-31/F-34/F-13/F-45, F-38 (the `cordis.patch.yml` `disabled: true` delta), W2 (the hit-target live check's
  acceptance rule — both are pre-existing worktree deltas, untouched here and untouched by this diff).
- **Dead-code rider:** nothing is provably dead in this diff, so nothing was deleted. The one near-candidate — the counter shape of
  `marketReport` (`skipped`/`failed` as numbers) — is still accepted by the published seam and is now **proven** rather than dropped,
  which is the opposite of dead.
- **No live GUI pass, stated as skipped:** this change lives in the repository; the DSH answering at `127.0.0.1:3080` serves the
  installed profile copies, and reinstalling the profile was not this batch's grant. The browser benches
  (`scripts/test-suite-gui.mjs`) need Playwright + React UMD and SKIP on a machine without them. What replaces the capture here is
  the route-level proof above: the panel's own bodies, run through `handleThemes`, answer exactly what the row draws.
- **Environment note:** the hot-file / isolation tooling the machine rules name (`garde.mjs --claim`, `--check`) does not exist on
  this machine (`/Users/miled/dyad-apps/dsh-kybernos` and its `kybernos-sessions/` are absent), so no claim could be taken; the six
  files were edited in one pass, in one checkout, and re-checked with `node --check` plus the suites above.
