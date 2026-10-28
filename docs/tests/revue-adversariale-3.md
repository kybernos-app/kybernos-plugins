# Revue adversariale 3 — the twice-corrected merged diff `2ac67fb4..HEAD` + worktree delta

> Verifier: the adversarial checker (`verificateur`) of the `dev-team` kybernos, third pass. Input: THE MERGED DIFF
> (`git diff 2ac67fb4..HEAD -- packages/ scripts/ docs/dev/` + `git diff HEAD`, fix batch `4b6f13a4`) and the nine specs
> (`A1-theme-seam`, `A1-kit-wizard`, `A2-pack-format`, `A2-registry-points`, `A3-vertical-content`, `A4-starter-docs`,
> `A6-theme-installer`, `A7-theme-marketplace`, `A8-theme-content-six`) + `docs/dev/plugin-contract.md`. Nothing else.

**VERDICT: WARN.** The two BLOCK anchors and the one WARN of pass 2 re-measure as **CLEARED, all three**:
**B1** — the guard is byte-identical to its pre-campaign state (ceiling back where it was, the frozen enumeration
untouched) and the log headers are genuinely sentence case, with no shouting moved anywhere else;
**S1** — the frozen A6:41 Settings source row exists, its two writes go through A6's existing door and nothing else,
the fields are bounded on both sides, the write keeps same-origin + signed session (my refusal probes measured), and
the row is reachable from Settings (my own render + registration capture; live GUI unavailable in this session —
measured, see S1); **W1** — the skipped/failed rows' proof is back and on the product's own answer (my own 9-check
variant on the real applier, different ticks, different failure). **No permission widening, no weakened assertion, no
rewritten frozen wire** in the fix batch. What keeps this from PASS is the fix batch's **one half-committed
obligation**: the B1 CSS fix broke the campaign's own byte-equality contract (`test-client.mjs`) at the committed
HEAD — the mandated mirror line sits **uncommitted** in the neighbour's `kblg.css` (the campaign diff does not carry
it, as required — confirmed) — and the commit message misreports the suite (**3 RED claimed, 4 measured**, and
"none new" is false at HEAD). Both are one-line remedies and both are named below.

**Implementer accounts present and IGNORED** (their numbers re-measured, never reused): `docs/tests/impl-fix-final.md`
arrives *inside* the fix commit and the commit message quotes it ("B1/S1/W1 all FIXED", "12 tests passed", "82
verifications", "3 RED … one fewer … none new"). Every figure in this report is my own measurement.

---

## Perimeter and attribution

- Fix batch `4b6f13a4` touches **5 files**: `scripts/test-consistency-guards.mjs` (B1), `packages/kybernos-log/client.js`
  (B1), `packages/kybernos-plugin/client.js` (S1 + W1's `name`), `packages/kybernos-plugin/test-theme-market.mjs`
  (W1 + S1 proofs), `docs/tests/impl-fix-final.md` (its account). All inside the flip-list perimeter.
- **The neighbour's `docs/handoff/journal-activite/maquette-v1/kblg.css` one-liner is NOT in the campaign diff —
  confirmed**: over `2ac67fb4..HEAD` the only commit touching that path is `201a8eaf` (which *created* the plate);
  the one-liner exists only in `git diff HEAD` (uncommitted, mtime 2026-10-28 09:06:46, between the two fix mtimes
  08:57 / 09:13). The campaign did not smuggle it.
- Worktree delta entries `check-hit-targets-live.mjs`, `.claude/skills/ux-bug-hunter/probes.js`,
  `scripts/check-ux-probes.mjs` (mtimes 2026-10-20) and `packages/kybernos-composio/cordis.patch.yml`
  (`disabled: true`, 2026-10-27) are the **standing** W2 / F-38 findings of pass 2 — not fix-introduced.

---

## B1 re-measured — the guard's frozen-text check: **CLEARED**

My recipes (not the doer's runs):

1. **The ceiling back where it was, and the enumeration original.** `git diff 2ac67fb4..HEAD --
   scripts/test-consistency-guards.mjs` is **empty** and a whole-file diff against `2ac67fb4` reports **identical**:
   `SHOUTING_ALLOWED = { 'kybernos-plugin': 1, 'kybernos-refs': 1, 'kybernos-slides': 2, 'kybernos-dashboards': 2 }`
   (`test-consistency-guards.mjs:237`) — no `'kybernos-log'`. The frozen comment (five named design items: Beta pill,
   avatar initials, slide kicker, slide footer, dashboard thumbnails) and the check name are byte-identical to the
   baseline. Footnote (doer-loose, harmless): the commit message says "back to five entries"; the map holds four
   keys and the comment names five items. What matters is the byte identity, which I measured.
2. **Genuinely sentence case, nothing hidden.** `packages/kybernos-log/client.js` holds **zero** occurrences of
   `text-transform`, `textTransform`, `toUpperCase`, `small-caps`, `capitalize`, `::first-letter`, `font-variant`
   caps tricks. The `.kblg-table th` rule is now `font-weight:600;font-size:11.5px;letter-spacing:.02em` only
   (`client.js:108`). The header labels are sentence case in the dictionary (`colTime: ['Heure','Time']` …
   `colDetail: ['Détail','Detail']`, `client.js:51-56`) and the `th` cells render those labels plain
   (`client.js:231-232`). No label string was re-shouted in JS.
3. **My own per-bundle count** of `text-transform: uppercase | textTransform:'uppercase'`: kybernos-plugin 1,
   kybernos-refs 1, kybernos-slides 2, kybernos-dashboards 2 — exactly the ceiling, kybernos-log absent. The guard
   run: `ok A1-16 …`, **12 tests passed**.

**BUT (N1, below): the fix is half-committed.** `packages/kybernos-log/test-client.mjs:66-69` — a contract created by
the campaign's own `201a8eaf` ("keep the two identical (test-client.mjs checks it)") — demands the plate
`docs/handoff/journal-activite/maquette-v1/kblg.css` equal the bundle CSS byte for byte. My simulation:
**HEAD-state plate == bundle CSS → false; worktree → true.** So at the committed HEAD this test is RED, and its green
in every suite run rests on the uncommitted line.

## S1 re-measured — the frozen A6:41 Settings source row: **CLEARED**

My recipes (a scratch harness with **my own** stub — effects run, slots captured — plus route-side refusal probes):

1. **The row exists and is reachable from Settings.** `KbMarketSources` (`client.js:30675-30751`) is drawn by the
   section (`h(KbMarketSources, { lang, view, reload: relire })`, `client.js:30826`), which registers as
   `settings.section` id `kybernos-themes-market`, order 30 (`client.js:30881-30883`). My harness captured the
   registration through `slots.inject('settings.section', …)`, rendered `KbThemesMarket`, and found the sources row
   in its tree; the row shows the pinned key (`Key pinned · cat-1`) and the INT5 warning (Community level, pinned on
   first use, removal drops trust not installed themes). **18/18 checks PASS** (`/tmp/verify-s1-own.mjs`).
   *Live GUI unmeasurable in this session*: no playwright (the suite skips its GUI files for `Cannot find module
   'playwright'`) and the CDP port 9333 is closed — measured, not assumed; the reachability proof is at the
   registration + rendered-tree level.
2. **The two calls hit the existing seams, no parallel path.** Add delivers exactly
   `{ action: 'source-add', url, key? }`, Remove exactly `{ action: 'source-remove', url }` through `kbThApi` — the
   page's own door (`fetch('/kybernos/themes')`, `credentials:'same-origin'`, `client.js:26047-26054`) — the same one
   the reads use. The block's only fetch is that door. The route handlers are the pre-existing
   `theme-installer.mjs:684-702` (untouched by the fix batch).
3. **The fields are bounded.** Row: https regex `^https://[^\s]{1,2000}$`, `keyId ≤ 64`, `pem ≤ 4000`,
   `MARKET_SOURCES_MAX = 3` (inputs carry matching `maxLength`; Add disabled when full, "Three sources at most").
   Route: identical url rule (`theme-installer.mjs:685`), `too-many-sources` at 3 (`:688`), `BODY_MAX`/`readJsonBody`
   64 KB (`index.js:10756`, `theme-installer.mjs:615`). My probes: `http://` → 400, a 4th source →
   `too-many-sources`, nothing over the wire for a bad address. INFO: the route does not cap `keyId`/`pem`
   individually (the 64 KB body cap bounds them) — the row caps them.
4. **The write keeps same-origin + signed session.** My refusal probes on the real route: cross-origin → 403
   `origin refused`; no signed session → 403; **both refused writes stored nothing**; the guarded write lands;
   `GET` never returns the key material (only `{url, keyId, pinned, seq}`, `theme-installer.mjs:579`). Guards are the
   frozen ones (`sameOriginStrict` + `writeGuard`, `index.js:10763-10767`), untouched by the batch.
5. **Data only.** No journey, no install from the Settings row (A6 build-contract row); the listing beside it adds
   and removes nothing.

Residue (WARN, F-30 family — standing, not new): the row ships **inside** the market listing's section
(`KbThemesMarket`), which is itself a Settings section. Under "the surface is Settings" this conforms to A6:41's
"bounded field row in Settings"; under INT5/M1's literal actor wording ("A7-theme-marketplace … never adds, removes
or pins one") the market component now does. Alternate reading defensible, as adjudicated at pass 2 (F-30).

## W1 re-measured — the report rows' proof: **CLEARED**

1. **Back, and on the real answer.** `test-theme-market.mjs` (my run: **82 verifications, 0 failures**) drives the
   real applier (`KB-TH-CORE` cut from the shipped `client.js`) with a real un-ticked item and real refused writes,
   and asserts the drawn rows: a named `skipped` row (`text === 'patient-notes'`), the `failed` plural
   (`3 steps failed`), the singular (`1 step failed`), and the restored counter shape
   (`style,kit,added,skipped,failed` with `5 items added / 2 items skipped / 1 step failed`, both languages).
   The new instrument `docs/tests/probes/probe-market-report-rows.mjs` is green (my run).
2. **My own variant** (different ticks, different failure, real applier): **9/9 PASS** (`/tmp/verify-w1-own.mjs`) —
   two un-ticked items → two named skipped rows (`care-team`, `patient-notes`) with **zero** create writes for them;
   one refused write → `1 step failed`; two refused writes → `2 étapes en échec` (French plural).
3. **The production change is the right shape and additive.** `marketReport` drops unnamed items by its own rule
   ("an item without a name is dropped from the report, never invented", `client.js:30565-30568`) and the applier
   sent no `name` — so real skipped rows drew **nothing** before this fix. The applier now fills
   `{ kind, id, name, file }` (`client.js:25933-25937`): additive, and it makes A6's E2 DoD ("the report lists the
   two skipped items", `A6:221`) actually hold. `kbThApply`'s frozen top-level shape (A6:278) is unchanged; the
   skipped item shape is not frozen anywhere.

---

## New-damage hunt (the fix batch and the delta)

| # | Finding | Anchor | Blame |
|---|---|---|---|
| **N1 (WARN — the one thing between WARN and PASS)** | The B1 CSS fix broke the campaign's own byte-equality contract **at the committed HEAD**: `test-client.mjs`'s plate check fails there (measured) and is green only thanks to an **uncommitted** line in the neighbour's `kblg.css`. The campaign diff does not carry that one-liner (the required confirmation — pass), but the doer's account claims the touch ("Files touched … so the plate follows the label") while the commit message disclaims it ("the neighbour's … not ours"): one of the two is false. If nobody lands that line before the merge, the merge carries a red **the campaign created**. | `packages/kybernos-log/test-client.mjs:66-69` vs `packages/kybernos-log/client.js:108`; delta `docs/handoff/journal-activite/maquette-v1/kblg.css:26` | **doer-error** (fix half-committed; contradictory attribution) |
| **N2 (WARN)** | The commit message's suite claim is false: "3 RED (the pre-existing cloud trio) — one fewer than before, none new". Measured: **4 RED** in this worktree (`test-help.mjs` is still red — "every module links to an article … the ten that have none yet", 12 listed — the pass-1 survivor), and at HEAD `test-client.mjs` adds a 5th. "One fewer" is not measured anywhere. | commit `4b6f13a4` message; `scripts/test-help.mjs` | **doer-error** (report integrity) |
| Info | The route does not individually bound `keyId`/`pem` on `source-add` (the row does; the 64 KB body cap bounds the write globally) | `theme-installer.mjs:691` | doer-loose (info) |

**Checked and clean (no new damage):** assertions — `test-theme-market.mjs`'s change is purely additive (its only
removed lines are the `fs` import and the export-name list, both replaced by supersets); the guard file is net-zero
over the whole range. Permissions — no `net:`/`remote.*` widening; `session-guard.mjs`, `sameOriginStrict`,
`writeRefused` untouched by the batch (absent from its diff; pass 2's zero-diff stands). Frozen wires — the install
convention stays the frozen 3 keys `{source,id,version}` (still asserted), the GET wire's `sources` entries keep
`{url,keyId,pinned,seq}` with the pem never returned (measured), `source-add`/`source-remove` bodies are exactly the
route's. Perimeter — the committed diff carries no file outside the flip list and **not** the neighbour's one-liner;
the remaining delta entries are the standing W2/F-38 items (mtimes 2026-10-20 / 10-27), not fix-introduced. The B1
mirror (`kblg.css` plate) is the sole out-of-commit dependency, carried as N1.

**Standing WARNs, untouched by the fix, riding their tickets:** F-29 (no "Apply the look" retry), F-30 (two « Thèmes »
listings; the S1 row inherits its ambiguity), F-31/F-34 (`revokedKeys` decorative; seq floor inert), F-45 (import
answer shape), F-2 partial (symlinked intermediate), F-13, F-36 partial, F-37/F-10, W2 (hit-target "stacked pair"
acceptance), F-38 (uncommitted `disabled: true` in `cordis.patch.yml`).

---

## Grid results

| # | Grid point | Result | Grounds |
|---|-----------|--------|---------|
| 1 | Line-by-line conformity with the specs | **PASS (with F-30-family residue)** | A6:41/INT5/A6:289 + `plugin-contract.md:470-473` now have their row, bounded and warning-carrying; A1-16's frozen text governs again; A6's E2 gets its proof. Residue: the row lives inside the market section (M1 actor wording, alternate reading). |
| 2 | Surgery | **WARN** | The committed batch is well-scoped (5 files, one account doc), but the B1 fix is half-committed: its mandated byte-mirror lives outside the commit (N1). |
| 3 | Simplicity | **PASS** | Pure helpers + one component + CSS on the existing `.kbtm-` prefix and the existing font scale (A1-14 green); the row reuses the door instead of a second path; no new dead surface. |
| 4 | Security | **PASS** | Same-origin + signed session on the writes, measured refusals with nothing stored; bounds on both sides; the key material is never echoed back (measured); no guard file touched. |
| 5 | Tests that prove the spec | **WARN** | W1's proof is back on the real answer (my 9/9 variant agrees), but the suite claim in the diff is false (N2) and the campaign's own plate test is red at HEAD (N1). |
| 6 | Existing patterns | **WARN** | Seams, doors, label discipline and registration all follow the established patterns; AGENTS.md's "0 red / the merge message says which" is not met: the message names the plate decision but miscounts the red set. |

---

## Blame sheet

| | |
|---|---|
| **BLOCK anchors remaining** | **none** |
| N1 | **doer-error** — the B1 fix left its byte-mirror uncommitted and the account/commit-message disagree on who touched it. `packages/kybernos-log/test-client.mjs:66-69` |
| N2 | **doer-error** — a false suite claim in the commit message (3 vs 4 measured; "none new" false at HEAD). Commit `4b6f13a4` message |

## What would flip WARN → PASS (the shortest path)

1. **N1**: land the plate's one declaration (the neighbour's commit, or the campaign fixing its own contract in the
   same session), **or** ticket it and make the merge message name `packages/kybernos-log/test-client.mjs` as red at
   HEAD until it does. If neither happens before the merge, this becomes a BLOCK (the merge carries a red the
   campaign broke).
2. **N2**: correct the merge message's suite line to the measured state (4 RED — `test-help` named) instead of
   "3 RED … none new".

Everything else is WARN-level or already ticketed.

## Method note

Evidence: the guard file byte-diffed against the pre-campaign baseline; my own per-bundle shouting count; the log
file grepped for every capitalisation trick; the plate/bundle byte comparison simulated at HEAD and in the worktree;
two scratch instruments written and run (`/tmp/verify-s1-own.mjs` 18 checks, `/tmp/verify-w1-own.mjs` 9 checks) with
their own stubs, tick sets and failure modes; the real route probed for guard refusals and bounds; `run-all-tests.mjs`
run in full (532 files, 528 green, 4 RED — enumerated) and `test-help.mjs`'s failing check named; the fix commit read
hunk by hunk; test diffs checked for removed assertions (none); file mtimes used for delta attribution. No implementer
or gate account was used as evidence.
