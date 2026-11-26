# Revue adversariale 2 — the CORRECTED merged diff `2ac67fb4..HEAD` + worktree delta

> Verifier: the adversarial checker (`verificateur`) of the `dev-team` kyber, second pass. Input: THE MERGED DIFF
> (`git diff 2ac67fb4..HEAD -- packages/ scripts/ docs/dev/` + `git diff HEAD`) and the nine specs (`A1-theme-seam`,
> `A1-kit-wizard`, `A2-pack-format`, `A2-registry-points`, `A3-vertical-content`, `A4-starter-docs`, `A6-theme-installer`,
> `A7-theme-marketplace`, `A8-theme-content-six`). The fix batch under review is `b2cae378` ("themes: fix the adversarial
> BLOCK…"). Nothing else was an input.

**VERDICT: BLOCK — narrowed.** The five first-pass grounds re-measure as: **(1) user data — FIXED**, verified by the
doer's probe 7/7 *and* by the verifier's own first-pass recipes run again; **(2) catalogue flow — HALF-FIXED**: the
trust chain, the verifiers and the byte transport are real and proven (F-25/F-26/F-3/F-1 cleared), but the flow is
still **unreachable for a person** — the frozen Settings source row (A6:41) is still missing (F-28, measured: zero UI
callers of `source-add`); **(3) the two frozen wizard invariants — FIXED** (seam green even file-wide; `pack.kit`
green under a spec narrowing my own flip list prescribed); **(4) the six log reds — 5 genuinely fixed, the 6th cleared
by WEAKENING THE GUARD** (B1); **(5) fixtures — FIXED** against the real wire, with one dropped proof (W1).
The suite is measured **532 files, 528 green, 4 RED** — no new red (the four are the first-pass survivors). Two BLOCK
anchors: **B1** (fix-introduced assertion weakening) and **S1** (frozen row still missing, flagship flow still
person-unreachable).

---

## Perimeter — what reached me, what I refused

Read: the nine `*-strategy.md` specs (including their `b2cae378` revisions — the yardstick moved and every move was
diffed), the merged diff over `packages/`, `scripts/`, `docs/dev/`, the worktree delta (`git diff HEAD`), the four
probes under `docs/tests/probes/` as re-runnable instruments, and `AGENTS.md` (grid 6's yardstick).

**Implementer/gate accounts present and IGNORED** (never opened): `impl-fix-block.md`, `impl-log-enregistrement.md`,
`sondes-fix-block.md`, and all pass-1-refused `impl-*.md`/`gate-verdicts*.md`/`campagne-tests.md`/`triage.md`/
`docs/handoff/**`. Commit `b2cae378`'s message quotes them ("verdict pass", "7/7", "14/14", "16/16", "9/9", "12 -> 4
red"): those are doer claims; every number below is my own measurement.

---

## Grid results (all six required for a PASS)

| # | Grid point | Result | Grounds |
|---|-----------|--------|---------|
| 1 | Line-by-line conformity with the specs | **FAIL** | S1 (A6:41's frozen Settings source row still missing — `source-add` has zero UI callers), F-29/F-30 (frozen retry affordance, frozen single listing) still open; everything else in the five grounds now conforms |
| 2 | Surgery | **FAIL (narrowed)** | F-38 still tripped (uncommitted `cordis.patch.yml` `disabled: true` in the reviewed delta, A7-Lane-B's literal falsifier); W2 (pre-existing delta hunk that rewrote a live-check's acceptance rule, missed by pass 1). The fix batch itself is well-scoped |
| 3 | Simplicity | **PASS-ish → WARN** | F-3's dead surfaces now have production callers; residual: F-31 (`revokedKeys` decorative), F-13 (unused exports), F-45 (extra wire key) |
| 4 | Security | **FAIL → WARN** | The fix is a net security *improvement* (level computed from signatures, archive verified+staged host-side, streamed caps, page never fetches/hashes/picks an address; `session-guard.mjs` zero-diff over the range). B1 is not security. Residual: F-31/F-34, redirect-downgrade checked only after `redirect:'follow'` (info) |
| 5 | Tests that prove the spec | **FAIL (narrowed)** | B1 (the A1-16 guard bent to admit the violation), W1 (skipped/failed rows unproven). F-27 is fixed: the market suite now feeds `handleThemes`' real answer and `kbThApply`'s real report |
| 6 | Existing patterns | **FAIL** | B1 (the A1-16 discipline "A new one is a label: write it in sentence case" overridden by editing the ceiling); the four reds are named in the merge message (AGENTS.md's "ticketed that day, and the merge message says which" clause) but "It must end with 0 red" is still not met |

---

## The suite at HEAD (measured, not assumed)

`node scripts/run-all-tests.mjs` → **532 test files, 528 green, 4 RED** (exit 1). The red set is exactly the
first-pass survivors — **no new red**:

| RED file | Cause | Status |
|---|---|---|
| `scripts/test-help.mjs` | `kybernos-webapp-creator` has no help article | pre-existing (pass 1), ticketed |
| `scripts/test-no-legacy-hosts.mjs` | stale `api.kybernos.app` literals (`KB_FEEDBACK_API_DEFAULT`, E2B template) | pass-1 F-8/F-6 cluster, deliberately ticketed |
| `packages/kybernos-servers/test-host.mjs` (8 failures) | stale servers fixture of the same cloud rename | pass-1 F-6, deliberately ticketed |
| `scripts/test-plugin-scan.mjs` | `kybernos-pulse → exec` undeclared | pre-existing (pass 1) |

Footnote: the commit title says "12 -> 4 red", its body "10 -> 4"; my first pass measured 10 at the parent. The end
state is what matters and it is measured above.

---

## The five grounds re-measured

### Ground 1 — the import path destroys user data (F-41/F-42): **CLEARED**

- The doer's `probe-import-invariant.mjs`: **7/7 green** (re-run by me).
- **My own first-pass recipes, re-run independently** (scratch script, not the doer's probe): the `me` record
  `{id:'soigne', name:'Soigne', source:'me', settings:{acc:'#000001'}}` survives a same-name import **byte for byte**,
  and the import never answers the person's id; the F-42 collision recipe keeps `soigne-2/"Cabinet"` (gid `cab`, v 3)
  untouched and the import answers its own name. All hold.
- The code fix is the right shape (`preset-store.mjs:216-244`): a record is the import's own only when it is not
  `source:'me'` and carries the import's name (plain or suffixed); every other holder makes the walk **skip** the id,
  never overwrite; a full library refuses (`'no free id'`, `'library full'`) instead of evicting. The promoted
  assertions in `test-preset-store.mjs:161-210` are byte-level and do not narrow the frozen rule (the old
  "a different id" narrowing, which let F-41 ship, is explicitly replaced).
- **Two boundary notes (info, not blockers):**
  - W3 — an update of the import's own record rebuilds it from the input, so a re-import that omits `gid`/`v`
    **drops the catalogue link** of that record (measured: `soigne` goes `{gid:'cab',v:3}` → no gid). Pre-existing
    path behaviour (identical at baseline), no frozen rule names it. `preset-store.mjs:246-249`. **doer-error (info)**.
  - W4 — two *different* documents exporting the same name converge on one record (the later replaces the earlier,
    `source`/`settings`/`gid` overwritten). This is the frozen rule **as written** — A1-1 keys identity on the id
    ("the *same* input applied twice is idempotent (same slug id, one record)"; a name colliding with a record of a
    **different** id gets the suffix) — so it conforms, but the comment's "this very import, applied before"
    (`preset-store.mjs:236`) overstates what the name test can know. **spec-error (the frozen text is id-keyed) /
    doer-loose (comment)**.

### Ground 2 — the decorative catalogue flow (F-25/F-26/F-3/F-1): **HALF-CLEARED — the BLOCK residue is S1**

Fixed and re-proven (probe-catalogue-trust 14/14 re-run green; every claim re-measured in the code):

- **F-25 fixed**: the level is *computed* by `verifyEntry` (`theme-installer.mjs:152-175`), never read from the
  document (`newest.level` gone); `official` needs the `kybernos/` namespace **and** a key in `OFFICIAL_KEYS`, which
  ships **empty** (`theme-installer.mjs:56-61`) — a self-pinned source can mint `community` at best. Measured: a
  self-signed `level:'official'` document comes out `community`.
- **F-26 fixed**: `verifyEntry` runs in the production read path (`catalogueView`, `theme-installer.mjs:495-500`) and
  `verifyArchive` runs on the fetched archive in `index.js:10765-10773` before anything is staged; the archive's
  hash and both signatures are checked, the staged bytes are re-hashed against the verdict and gzip-checked in
  `handleThemes`' `install` action (`theme-installer.mjs:647-661`).
- **F-1/F-3 fixed**: bytes are really fetched — `fetchCatalogueSources`/`fetchArchiveBytes`
  (`theme-installer.mjs:711-779`), https-only, redirect downgrade refused, streamed caps (`MAX_DOC_BYTES`,
  `SIGNATURE_MAX_BYTES`, `IMPORT_MAX`) enforced **while** reading, deadlines 8 s/60 s, atomic 0600 staging with
  pruning; `index.js:10746-10776` wires them behind the existing guards (`sameOriginStrict` + signed session checked
  *before* any fetch). The client-side "download then POST bytes" half is deleted (`client.js`: `kbThImportArchive`
  removed) — the page never hashes, never downloads a package, never picks an address. The `refresh` action now has
  callers; the verifier surfaces are production-reachable.
- `session-guard.mjs`, `sameOriginStrict`, `writeRefused`: **zero diff over the whole range** (measured). No guard
  weakening on the write routes.

**Still open (the ground's flow-level claim):**

- **S1 (BLOCK) — the frozen Settings source row is still missing (F-28 unchanged).** A6:41 freezes "this batch's
  Settings field row" for the bounded source list (key pinned on first use + the warning, `plugin-contract.md:470-473`)
  and INT5 its warning sentence. Measured: `source-add`/`source-remove` have **zero production UI callers** (grep over
  `packages/**`: only `theme-installer.mjs` itself). The transport and trust are live, but no person can add a
  source from the GUI: the marketplace still renders the `no-source` state forever and the flagship flow works only
  via direct route calls (curl/tests). `packages/kybernos-plugin/client.js` (absent row); `theme-installer.mjs:684`.
  **Blame: doer-error** (a frozen row of the flagship flow not shipped; flip-list item 1 included it).
- F-29 (WARN, unchanged): no "Apply the look" retry; the `styleThere` heuristic still assumes applied when the field
  matches (`client.js:25932-25941`), so a later Install never retries the seam. **doer-error**.
- F-30 (WARN, unchanged): A7's listing still registers its own Settings section (`KB-MARKET-UI`) — two « Thèmes »
  listings — against AMB3-M4's "the listing block is drawn inside it". **doer-error** (alternate reading defensible).

### Ground 3 — two frozen A1-kit-wizard invariants (F-39/F-40): **CLEARED (one via a sanctioned spec narrowing)**

- The seam invariant is fixed **in code**: the marketplace's raw `window.__KB_THEME_APPLY__` read is replaced by the
  published helper (`client.js:26090-26093`, `kbObThemeSeam(window)`). Measured file-wide: **exactly 1 raw read**,
  inside KB-OB-CORE (`client.js:36962`) — so the *original* file-wide "exactly once" form is green again too. The
  theme bundle still publishes the seam once (`kybernos-theme/client.js`). `test-onboarding.mjs:475-493` now pins
  both the file-wide count and the consumer-aware form.
- The `pack.kit` invariant is green under the narrowed spec: `A1-kit-wizard-strategy.md` DoD 4 was rewritten ("Review
  narrowing 2026-10-28", citing F-39/F-40) to count the `pack.kit` family over the **wizard's blocks**
  (KB-OB-CORE + KB-OB-UI), where it is measured **0**. The old file-wide form stays red by design (4 hits:
  `.kit.teams`×2, `.kit.automations`×2 — A7's `plan.kit` rendering, outside the wizard). I adjudicate this as
  **conformant**: my own flip list prescribed exactly "re-scope the `pack.kit` grep to the KB-OB blocks — one spec
  edit, one code edit"; the edit is annotated and dated, the seam count was *not* narrowed, and the remaining DoD-4
  clauses (kitApply via `kbObThemeApplied`, `complete` carries `theme`, `kit-theme` row, `k.theme.note`) are
  untouched and stay file-scoped. **spec-error component (the original was a file-wide count) discharged.**
- A2's THEME_RE transcription (`{0,40}` → `{0,39}`, 3 prose sites) and A6's GET wire (`description` added to the
  frozen answer list) are annotated spec corrections, both additive or DoD-aligned; the A6 edit extends what A7 may
  rely on and the route now emits `description` (`theme-installer.mjs:511`), proven end-to-end by ground 5's probe.
  No frozen refusal was weakened by any spec edit.

### Ground 4 — six kybernos-log registration reds: **5 FIXED, 1 CLEARED BY WEAKENING (B1)**

Genuine registration (matches the siblings' pattern): help mount (`kybernos-log/client.js:202-207`), robot name +
`satellites.json` entry, `README.md` row, `KB_NAV_KEYS`/icon/SS rows (`kybernos-plugin/client.js:3025,3127-3136,34903`),
`lifecycle-packages.json`, hub `catalog.json` entry, signpost copy (help.json + `test-signposts.mjs` PLACES).
`test-settings-nav.mjs`'s scan window change (fixed 24 000 chars → the organiser effect's end) is **strictly stronger**
(measured: window 2.6 M chars vs 312 866 — no assertion lost).

**B1 (BLOCK, fix-introduced) — the A1-16 shouting red was absorbed by weakening the guard, not by fixing the label.**
- `scripts/test-consistency-guards.mjs:237` — `SHOUTING_ALLOWED` gains `'kybernos-log': 1` (allowed 0 → 1).
- The violation it admits is `packages/kybernos-log/client.js:108` — `.kblg-table th{…text-transform:uppercase…}` —
  a **column header**, a class the guard's own text forbids verbatim: "titles, labels, **column headers** and badges
  are written in sentence case, so no stylesheet shouts them with text-transform: uppercase" and "A new one is a
  label: write it in sentence case" (`test-consistency-guards.mjs:234-236`).
- The guard's frozen enumeration — "the Beta pill, avatar initials, slide kicker and dashboard thumbnails are the
  only ones" (the check's name, `:238`) — is now false, and no justification row was added.
- The fix was one CSS declaration (delete `text-transform:uppercase`; weight/size/letter-spacing carry the design).
  Raising the ceiling to admit a named-forbidden class is precisely "a fix that weakens an assertion".
- **Blame: doer-error.**

### Ground 5 — fixtures that prove fixtures (F-27): **CLEARED, one proof dropped (W1)**

- `test-theme-market.mjs` now builds its fixtures from **A6's own route** (`routeGet` → `handleThemes` POST
  `source-add` + GET over a really signed catalogue) and **A6's own applier** (`kbThApply` over fake ports), then
  feeds the seam's real answer shape through `marketCards`/`marketReport`. The doer's `probe-market-contract.mjs`
  (16/16) repeats the recipe; I re-ran it green. The wire fixes are real: cards read the route's **flat** fields
  (`client.js:30467-30480`), the report reads `whole.report` with a bare-report fallback (`:30575-30577`), and the
  route emits `description` (`theme-installer.mjs:511`). The ghost-manifest test proves the old fixture shape is
  ignored. Install call convention stays the frozen 3 keys (`{source,id,version}`), version real.
- **W1 (WARN, fix-introduced) — the `skipped`/`failed` report rows lost their only proof.** The old fixture asserted
  `kinds.join() === 'style,kit,added,skipped,failed'` on `{added:5, skipped:2, failed:1}`; the real applier answer
  has `failed:0`, so the new assertion is `kinds.join() === 'style,kit,added'`
  (`test-theme-market.mjs:218-224`). `marketReport` draws `skipped`/`failed` rows whenever the counter is > 0
  (`client.js:30593-30597`, with singular/plural FR/EN lines) and that path is now **unproven anywhere**. The new
  behaviour could have been added without deleting the proof (a second case with nonzero counters). **doer-error.**

---

## New-damage hunt (the fix batch and the delta)

| Finding | Anchor | Blame |
|---|---|---|
| **B1 (BLOCK)** the A1-16 guard weakened to admit a forbidden-class violation (full evidence under Ground 4) | `scripts/test-consistency-guards.mjs:237`; `packages/kybernos-log/client.js:108` | **doer-error** |
| **S1 (BLOCK)** the frozen A6:41 Settings source row still missing — flagship flow person-unreachable (Ground 2) | `client.js` (absent); `theme-installer.mjs:684` | **doer-error** |
| W1 `skipped`/`failed` report rows unproven (Ground 5) | `test-theme-market.mjs:218-224` vs `client.js:30593-30597` | **doer-error** |
| W2 (delta, **not** fix-introduced) the hit-target live check adopted a "stacked pair = one 24 px target" acceptance: `ACCEPTED = /(?!)/` makes the "accepted list" check **vacuous**, and `stacked()` suppresses `tiny-target` for flush pairs — looser than SC 2.5.8's letter (its spacing exception is non-intersecting 24 px circles; a flush 12 px-pitch stack intersects). mtimes 2026-10-20: this sat in the delta at first pass and I missed it there | `scripts/check-hit-targets-live.mjs:25-28,67-68`; `.claude/skills/ux-bug-hunter/probes.js:270-292,305` | **doer-error** (delta content) + **exploration-error** (pass 1 read `git diff HEAD -- packages/ scripts/` and flagged only the `.yml` hunk) |
| F-38 (standing) the uncommitted `disabled: true` hunk is still A7-Lane-B's literal falsifier | `packages/kybernos-composio/cordis.patch.yml:15` | **doer-error** |
| Info — the redirect-downgrade refusal runs *after* `redirect:'follow'`, so a downgrade redirect is fetched before it is refused (same pattern as `kybernos-hub/telechargement.mjs:63`, the copied precedent) | `theme-installer.mjs:723-728` | doer-error (info) |
| Info — the seq floor is only as good as the stored `s.seq` (set at `source-add`, never updated after a fetch), so the replay check (`cat.seq < floor`, `:139`) is mostly inert; `revokedKeys` remains decorative (`:214`, F-31) | `theme-installer.mjs:139,214,487` | doer-error (WARN, standing) |

**Checked and clean (no new damage):** `session-guard.mjs`/`sameOriginStrict`/`writeRefused` zero-diff over the range;
no `net:` widening (the transport fetches person-pinned https hosts dynamically — the established
`kybernos-hub/telechargement.mjs` precedent, `kybernos-hub/index.js:58-85`; no repo guard tripped); the transport's
caps/timeouts/atomic-0600 staging/path sanitisation hold under my reading; `test-theme-installer.mjs`'s additions are
new assertions (F-25/F-26/install/symlink), none dropped; `test-preset-store.mjs`'s promotion is byte-level and
strictly stronger; `test-settings-names.mjs`/`test-signposts.mjs`/`satellites.json`/`README`/`lifecycle-packages.json`
edits are registration data, not guard changes; the A2/A6/A1 spec edits weaken no frozen refusal (details under
Ground 3).

**Still open from pass 1 (WARN, may ride a ticket):** F-5 (the five weakened assertion sets were not un-weakened —
flip-list item 4 not claimed by the fix), F-45 (`POST {import}` answers `{ok,id,preset}` vs the frozen
`200 {ok, preset}`), F-31/F-34 (above), F-2 partial (the `lstatSync` fix covers the final component only; a
symlinked intermediate still lets `stage` read a folder outside the tree — `theme-installer.mjs:449-458`), F-13
(unused exports in `plugin-check.mjs`), F-36 partial (newest = last array element), F-37/F-10 (cross-batch
contamination history).

---

## What would flip BLOCK → PASS (the shortest path)

1. **B1**: delete `text-transform:uppercase` from `packages/kybernos-log/client.js:108` (sentence-case the column
   headers) and drop `'kybernos-log': 1` from `SHOUTING_ALLOWED` — or, if it is truly design, amend the guard's
   enumeration and the check name with the reason. One CSS line + one test line.
2. **S1**: ship the frozen Settings source row (A6:41/INT5): the bounded field row, `source-add`/`source-remove`
   callers, TOFU pin display + the warning sentence. This is the last piece between the wired flow and the
   campaign's flagship flow working for a person.
3. **W1**: one more fixture case with nonzero `skipped`/`failed` counters (rows + singular/plural lines proven).

Everything else is WARN-level and can ride a ticket.

## Method note

Evidence: the four probes re-run verbatim; the verifier's own F-41/F-42 recipes re-run in a scratch script (2 boundary
cases added, adjudicated against the frozen A1-1 text at `A1-theme-seam-strategy.md:255-275`); `run-all-tests.mjs` run
in full and its four reds enumerated; the fix commit diff read file by file; the three spec edits diffed; guard files
diffed for weakening (only `SHOUTING_ALLOWED` found); `session-guard.mjs` zero-diffed over the range; transport code
read against its bounds claims; file mtimes used to attribute the worktree delta. No implementer or gate account was
read.
