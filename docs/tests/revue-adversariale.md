# Revue adversariale — merged diff `2ac67fb4..HEAD` + worktree delta

> Verifier: the adversarial checker (`verificateur`) of the `dev-team` kyber. Input: THE MERGED DIFF
> (`git diff 2ac67fb4..HEAD -- packages/ scripts/ docs/dev/` + `git diff HEAD -- packages/ scripts/`) and the nine
> specs (`docs/tests/A1-theme-seam-strategy.md`, `A1-kit-wizard`, `A2-pack-format`, `A2-registry-points`,
> `A3-vertical-content`, `A4-starter-docs`, `A6-theme-installer`, `A7-theme-marketplace`, `A8-theme-content-six`).
> Nothing else. Implementer and gate accounts were NOT read (see "Perimeter").

**VERDICT: BLOCK.** Five independent BLOCK grounds, each measured on the tree: (0) **the import path destroys the
person's preset records** — two probes, reproduced by the verifier: a `me` record is overwritten on a same-id import
and an unrelated kept record is silently rewritten (gid/v dropped) on a suffixed-id collision, violating A1-1's frozen
« the `me` record is never touched (byte for byte) » (F-41/F-42); (1) the campaign's flagship flow — the
signed-catalogue install — is non-functional and its trust chain decorative (F-25/F-26/F-3/F-1); (2) two frozen DoD
invariants of A1-kit-wizard are RED on the merged tree (F-39 measured: `FAIL wiring: __KB_THEME_APPLY__ appears 2
time(s)`, exit 1; F-40); (3) the suite is 10 RED at HEAD, 8 of them range-introduced (F-6); (4) test fixtures diverge
from the real wire, so green suites prove fixtures, not the product (F-27).

---

## Perimeter — what reached me, what I refused

Read: the nine `*-strategy.md` specs; the merged diff over `packages/`, `scripts/`, `docs/dev/`; the worktree delta
over `packages/`, `scripts/`; the repo's `AGENTS.md` rules (the yardstick of grid 6).

**Implementer/gate accounts present in `docs/tests/` and IGNORED as inputs** (an implementer's account anchors the
verifier, so none was opened): `impl-A1-theme-seam.md`, `impl-A1-kit-wizard.md`, `impl-A2-pack-format.md`,
`impl-A2-registry-points.md`, `impl-A3-vertical-content.md`, `impl-A4-starter-docs.md`, `impl-A6-theme-installer.md`,
`impl-A7-theme-marketplace.md`, `impl-A8-theme-content-six.md`, `impl-a6-fix.md`, `impl-live-check-maj.md`,
`gate-verdicts*.md`, `porte-go-verdicts.md`, `campagne-tests.md`, `triage.md`, and `docs/handoff/**`.
One exception of note: commit `5bc2dc24`'s message itself quotes `docs/tests/impl-a6-fix.md` ("verdict pass") and the
suite count "12 RED -> 10 RED"; the message text reached me inside the diff and is treated as a doer claim, not evidence.

The range contains 19 commits. Nine are the A1–A8 spec batches; **six are outside every spec** (see Finding F-10).

---

## Grid results (all six required for a PASS)

| # | Grid point | Result | Grounds |
|---|-----------|--------|---------|
| 1 | Line-by-line conformity with the specs | **FAIL** | F-25/F-26 (frozen verification chain decorative), F-3/F-1 (frozen catalogue flow unreachable), F-27/F-28/F-29/F-30 (frozen pieces missing or mis-shaped), F-39/F-40 (frozen DoD/invariants RED), F-14/F-16, per-batch tables below |
| 2 | Surgery (no drive-by, no unrequested rename, no cosmetic passage) | **FAIL** | F-10 (six out-of-spec commits; `e52c7c72` misfiles ~130 lines of feedback UI; `aab53868` carries sidebar work + `rapports/` artifacts; worktree disables `composio`, tripping A7-Lane-B's frozen falsifier F-38), F-37 (cross-batch contamination in hunks) |
| 3 | Simplicity (YAGNI: no single-use abstraction, no dead branch) | **FAIL** | F-2 (dead symlink guard, proven dead), F-3 (~150 lines of verifier + `refresh` + marketplace cards unreachable outside tests), F-31 (dead revocation claim), F-13 (unused exports/dead lines) |
| 4 | Security | **FAIL** | F-25 (levels forgeable from the document), F-26 (archive hash + author/reviewer signatures never checked before install), F-32 (client-forged record level displayed), F-2/F-4 (boundary validation + opt-in guards), F-8 (declared `net:` drift). Shipped write routes keep the strict same-origin + signed session rule (`session-guard.mjs` byte-identical to baseline); client factories guarded |
| 5 | Tests that prove the spec | **FAIL** | F-27 (fixtures diverge from the real wire — the flagship suites prove fixtures), F-5 (five weakened assertion sets, old-vs-new proven), F-6 (10 RED at HEAD), F-21, plus unproven branches (symlink, level gate) |
| 6 | Existing patterns (idioms, i18n rows, KB-* discipline, guards) | **FAIL** | F-6 (six repo guards + two dependent packages' guards turned red), F-35 (frozen OUT OF SCOPE tripped), F-39/F-40 (frozen file-wide invariants broken by a sibling batch), AGENTS.md: "It must end with 0 red." |

---

## The suite at HEAD (measured, not assumed)

`node scripts/run-all-tests.mjs` → **532 test files, 522 green, 10 RED** (exit 1).

| RED file | Cause | Introduced by | Blame |
|---|---|---|---|
| `scripts/test-consistency-guards.mjs` | A1-16 shouting: `packages/kybernos-log/client.js:108` `text-transform:uppercase` (`kybernos-log 1 (allowed 0)`) | `201a8eaf` (log bundle) | doer-error |
| `scripts/test-help-mounts.mjs` | `kybernos-log` ships `help.json` but never mounts `__KB_HELP__.Help` | `201a8eaf` | doer-error |
| `scripts/test-layout.mjs` | `kybernos-log` not "declared to the robot with a name" and not in `satellites.json` | `201a8eaf` | doer-error |
| `scripts/test-readmes.mjs` | `kybernos-log` not linked from `README.md` | `201a8eaf` | doer-error |
| `scripts/test-signposts.mjs` | `packages/kybernos-log/help.json:9,21,22` sends people to « Activity log (System group) » — not a page of the Settings menu | `201a8eaf` | doer-error |
| `packages/kybernos-plugin/test-settings-nav.mjs` | `kybernos-log` settings page has no `KB_NAV_KEYS` key | `201a8eaf` | doer-error |
| `scripts/test-no-legacy-hosts.mjs` | `BUILTIN_API` moved to `server.kybernos.app` but `KB_FEEDBACK_API_DEFAULT` (`packages/kybernos-plugin/index.js:12297`) and `packages/kybernos-computers/template-dsh/settings.yaml:10` kept `api.kybernos.app` | `e52c7c72` (cloud) | doer-error |
| `packages/kybernos-servers/test-host.mjs` (8 failures) | same rename: `packages/kybernos-servers/test-host.mjs:57` fixture pins the old built-in address; the "duplicate of the built-in" guard no longer catches the live CNAME → mirror accepted, state polluted, 8 cascading failures | `e52c7c72` | doer-error |
| `scripts/test-help.mjs` | `kybernos-webapp-creator` has no help article (`NO_ARTICLE_YET` has 10, reality 11) | **pre-existing** (webapp-creator predates the range) | not the range's doing; still red at this merge |
| `scripts/test-plugin-scan.mjs` | `kybernos-pulse → exec` (`helper/gen-icon.mjs:9`) undeclared | **pre-existing** (`kybernos-pulse` untouched by the range) | not the range's doing; still red at this merge |

Commit `5bc2dc24`'s message acknowledges the 10 reds and treats "no new red" as the gate. AGENTS.md says otherwise:
the merge into `dev` needs `run-all-tests.mjs` at 0 red, and a red not broken by you "is fixed in the same session or
ticketed that day, and the merge message says which". Neither happened.

**The campaign's own gate is also tripped.** The specs froze a softer gate: "8 red today … the batch may not make it 9"
(`A2-registry-points-strategy.md:430-453`), with a baseline-8 of `consistency-guards, help-mounts, help, layout,
no-french-literals, plugin-scan, readmes, settings-nav`. That baseline was measured on a worktree that already held the
then-**untracked** `packages/kybernos-log` (the same gate notes "one of them the untracked kybernos-log"), so it
undercounts the merge-base state; and even by that softer gate HEAD sits at 10 red with **three files red that appear
in no baseline list** — `test-signposts`, `test-no-legacy-hosts`, `kybernos-servers/test-host` — plus
`no-french-literals` fixed (7 of the 8 stay red). "May not make it 9" is broken by either reading.

---

## BLOCK findings

### F-1 — The frozen catalogue/marketplace flow has no transport in production (grid 1, 3, 4) — CONFIRMED AND EXTENDED BY F-25/F-26

- `packages/kybernos-plugin/index.js:10751-10755` — the ONLY caller of `handleThemes` passes `sameOrigin`, `session`,
  `registry` and **never `catalogues`**.
- `packages/kybernos-plugin/theme-installer.mjs:483-485` — `readAll` builds the card list from
  `catalogueView(store.sources, ports.catalogues)`; with no provider, every source answers `no-byte` (`:453`) and
  `themes` is always `[]`.
- `packages/kybernos-plugin/client.js:30462-30463` — the marketplace cards are built **only** from `view.themes`.
- The signature chain (`verifyCatalogue` `:91`, `signedBy` `:73`, `revocationOf` `:189`, `catalogueView` `:445-480`),
  the `refresh` action (`:596`, invoked by nobody — no `action: 'refresh'` in `client.js`) and the whole marketplace
  card UI are reachable only from tests (`test-theme-installer.mjs:360` feeds `catalogues` by hand).
- Net effect in production: sources can be added but never fetched or verified; the marketplace shows empty states
  forever; ~150 lines of A6's verifier and A7's display path never run outside tests.
- **Blame: doer-error** (the frozen flow — A6 "The flow this batch freezes", A7 "The shared source — A6's, consumed"
  and "levels come from A6's verifier — displayed" — is implemented and tested but left unwired at the one seam that
  gives it data; if the spec itself deferred the transport, the batch must say so in the frozen flow instead of
  shipping a route whose documented port nobody supplies — either way the merged tree delivers no working flow).
- Severity note: this is also a grid-5 problem in disguise — the tests inject the missing wiring, so they prove the
  machinery while the product path stays dead.

### F-2 — Dead symlink guard in the stage boundary (grid 3, 4)

- `packages/kybernos-plugin/theme-installer.mjs:437-438` — `statSync(folder)` **follows** symlinks, so
  `st.isSymbolicLink()` is always `false`; the declared refusal "the folder is a symbolic link" can never fire.
  Measured: `statSync` on a link → `isSymbolicLink() false`; `lstatSync` → `true`.
- `folderProblem`'s `..` check (`:434`) is literal-segment only; a symlinked intermediate or final component escapes
  the tree the comment promises ("checked without leaving the folder", `:430`).
- Impact: `stage` (`:528-542`) reads `plugin.json`/`package.json` from any readable directory on the machine
  (including through symlinks) and returns id/version/name and package problems to a same-origin signed caller.
  Bounded but real local disclosure, and a guard that lies about what it does.
- **Blame: doer-error.**

### F-3 — Grid 3 dead surfaces riding on F-1 (grid 3)

- `theme-installer.mjs:596` `refresh` action: no caller anywhere (client never sends it).
- `verifyCatalogue`/`signedBy`/`revocationOf`/`catalogueView`: production-unreachable (F-1).
- `packages/kybernos-plugin/index.js:12584-12588`: orphaned doubled JSDoc ("The body the PUBLIC door takes… Pure.")
  stranded above `KB_FEEDBACK_EXT` — leftover of a moved function.
- **Blame: doer-error** (dead-code rider, AGENTS.md rule 3).

---

## WARN findings

### F-4 — `handleThemes` guards are opt-in; missing ports default to allow (grid 4)
`theme-installer.mjs:516` skips the origin check when `p.sameOrigin` is not a function; `:519` defaults `session` to
`true` when `p.session` is absent — so an unwired caller gets an unguarded write handler, while the docblock
(`:503`) reads as unconditional. The shipped route does pass both (verified), so this is defense-in-depth debt, not a
live hole. **Blame: doer-error.**

### F-5 — Weakened assertions (old vs new, proven) (grid 5)
1. `packages/kybernos-sessions/test-etude-auto.mjs:180-189` — the rewrite drops the only exercises of a **failing
   model, an alert, and the automatic failover** (old assertions proved failover `→ openai/gpt-5-mini`; new ones only
   prove "the probe skips our gateway"). The new behavior could have been added without deleting those proofs.
   **doer-error.**
2. `packages/kybernos-plugin/test-feedback-box.mjs:302-307` — `retryable`/`retry_after` (the 30 s hold) silently
   dropped from the failure-path case. **doer-error.**
3. `packages/kybernos-plugin/test-feedback-box.mjs:343,359` — new tests hard-code `https://api.kybernos.app/...`,
   pinning the stale host (should derive from `BUILTIN_API`); together with `index.js:12297` this is why
   `test-no-legacy-hosts` is red. **doer-error** (spec-error component: no spec pinned the new host value).
4. `packages/kybernos-plugin/test-domain-pack.mjs:281-284` — the frozen exact nine-id list became a filtered
   subsequence; an unknown extra pack now passes silently (`SHIPPED_IDS` still holds nine, not ten). **doer-error**
   (mild; the A3 tenth pack forced an edit, the loosening was a choice).
5. `packages/kybernos-cloud/test-server-profile.mjs:95` — the old-host guard regex widened
   (`(?<!api\.)` → `(?<!(api|server)\.)`); no assertion anywhere pins the NEW host value, which is exactly how two
   stale literals survived the rename. **spec-error** (the out-of-spec cloud change had no frozen expectation).

### F-6 — Eight range-introduced reds (grid 5, 6)
See the suite table above. The log bundle alone turns six repo guards red; the cloud rename turns two more red,
including a real behavior regression (the "duplicate of the built-in server" guard no longer catches the live CNAME
`api.kybernos.app`, so production can be added twice — `packages/kybernos-servers/test-host.mjs:57,147`).
**Blame: doer-error** (both clusters).

### F-7 — Cross-batch contradiction left in the tree (grid 1, 2)
`docs/dev/sector-bundles.md:284-286` and `docs/dev/domain-packs.md:112` still say the wizard Kit step "is not built";
commit `9c3dfe3d` (A1-kit-wizard) built exactly that (`packages/kybernos-plugin/client.js:36959-36971`,
`:38553` read `window.__KB_THEME_APPLY__`) without updating the two documents. The merged tree contradicts itself.
**Blame: doer-error** (the later batch falsified the earlier batch's text and did not refresh it).

### F-8 — Declared-permission drift on the feedback fallback (grid 4, 6)
`packages/kybernos-plugin/plugin.json:91` swaps `net:api.kybernos.app` → `net:server.kybernos.app`, but the fallback
fetch at `packages/kybernos-plugin/index.js:12297` (`KB_FEEDBACK_API_DEFAULT`) still targets `api.kybernos.app` —
an outbound call outside the declared permissions. **Blame: doer-error.**

### F-9 — Stale line anchors in the starter docs (grid 1, 6)
`docs/dev/sector-bundles.md:170,257,259,262,278,280,292` cite `docs/dev/plugin-contract.md` at baseline line numbers;
the batch's own 4-line head link shifted them +4 (`:266` now points at a blank line; the real row is `:270`). The
acceptance text itself froze the stale numbers. **Blame: spec-error** (frozen numbers) **+ doer-error** (never
re-pinned after its own edit).

### F-10 — Six out-of-spec commits inside the reviewed range (grid 2)
`9c71cb8a` (sessions traffic-health), `201a8eaf` (log bundle), `aab53868` (feedback screenshots + anonymous door,
plus **sidebar drive-by** and `rapports/` artifacts), `e52c7c72` (cloud address rename, which **misfiles ~130 lines
of the feedback client UI**), `045d3176` (live-check catch-up), and the worktree delta's quiet
`packages/kybernos-composio/cordis.patch.yml` `disabled: true` (a live connector switched off, uncommitted, frozen
by no spec). None of the nine specs freezes any of these. They are also where all the reds come from.
**Blame: doer-error** (unrequested changes in the reviewed perimeter; entanglement with the spec batches in
`index.js`/`client.js`).

### F-11 — `traffic-health` hard-couples to the log bundle's journal file (grid 3, cross-batch)
`packages/kybernos-sessions/index.js:1463-1471` reads `<DSH home>/kybernos/log/events.jsonl` — a file format owned by
another new bundle (`201a8eaf`), with no interface between them; if the log bundle is off, traffic health silently
reports `unknown`. Recorded as a friction between the two out-of-spec commits. **Blame: doer-error** (minor).

### F-12 — A6 verifier's level values are not validated at the record boundary (grid 4) — SUPERSEDED BY F-32 (evidence there)
`theme-installer.mjs:560` copies `version/level/source/applied/before` from the request body raw;
`cleanRecord` (`:350`) drops unknown KEYS but validates no VALUES — a client can write `level: 'official'` into an
install record. Harmless only as long as nothing displays a record's `level` as a verifier verdict (A7 displays
`view.themes` levels, which are verifier-carried). Flagged as boundary-validation debt. **Blame: doer-error**
(pending the A6/A7 evidence to confirm exposure).

### F-13 — Minor dead code (grid 3)
`scripts/plugin-check.mjs:67,107,135` exports `OWNER_VALIDATORS`, `pluginTree`, `unknownFolders` that nothing imports;
`scripts/test-plugin-check.mjs:237` deletes a file in a tmp copy immediately before the copy is removed (dead line);
`scripts/test-plugin-check.mjs:69` `fenced` parameter never used. **Blame: doer-error** (dead-code rider).

---

## Cross-batch frictions (reviewed as a whole)

1. `e52c7c72` moves one shared constant; three other surfaces keep the old value (feedback fallback, E2B template,
   servers fixture) → 10 test failures across two packages. A rename of a shared constant with no dependent sweep.
2. `201a8eaf` (log) ships a new settings page + help card without the repo's registration trio (KB_NAV_KEYS,
   satellites.json, README link, help mount) → 6 reds. The repo guards caught every one; the merge happened anyway.
3. `9c3dfe3d` (A1-kit-wizard) falsifies A4's just-written "not built" sentences in two documents (F-7).
4. `aab53868` + `e52c7c72` split one feature (feedback screenshots) across two commits in two packages' shared
   files — the client half is filed under "cloud: the built-in server is…" (F-10).
5. `9c71cb8a` (traffic-health) silently consumes `201a8eaf`'s journal file (F-11).
6. A3's tenth pack forced `test-domain-pack.mjs`'s frozen list to loosen (F-5.4); the exact ten-id list survives only
   in `scripts/check-onboarding-live.mjs`.

---

## What is genuinely good (so the fix list stays short)

- The A4 conformance tool (`scripts/plugin-check.mjs`) is proven read-only three ways and every broken variant fails
  on its intended single reason (D1..D19 run, all green).
- `theme-installer.mjs`'s catalogue layer is solid where reachable: signature-before-parse, pinned keys, seq floor,
  size caps, revocation-before-offer; `writeThemes` is atomic, 0600, key-whitelisted (verified personally).
- `session-guard.mjs` is the strict same-origin + HMAC-signed session rule and the shipped write routes use it
  (including `/kybernos/feedback/attachment`).
- Client factories are guarded (`kybernos-log/client.js` returns a disabled plugin on error; tests freeze that).
- The theme seam wire (`applyPreset` `preset-store.mjs:200`, `{import}`/`{library}` exclusivity `:258-265`,
  `window.__KB_THEME_APPLY__` `kybernos-theme/client.js:2265-2281`) matches A1's frozen shape.

---

## Per-batch conformity

### A2-pack-format + A2-registry-points — 22/26 frozen requirements CONFORM; 2 real format findings

Suites green on the tree: `test-domain-pack.mjs` 52, `test-onboarding-state.mjs` 20, `test-registry.mjs` OK; every new
check fails at `2ac67fb4` (the new imports alone crash the old files). Registry `files:"folder"` mechanic conforms in
full (bounds, symlink refusal at any depth via `lstat` — `registry.mjs:278,309`, cap semantics, manifest fault lines
byte-identical, schema pair byte-identical, `host.mjs`/`seed-skills` at zero diff).

| Finding | Anchor | Blame |
|---|---|---|
| **F-14 `apps`/`ask` lower bounds drift**: code accepts `apps` 0–4 and `ask` 1–4 (`domain-pack.mjs:334-336,357`, comment admits "looser than the catalogue's own floor"), while the frozen format table says `apps` 1–4, `ask` 2–4 and freezes "ask outside 2-4 questions" as a refusal (`A2-pack-format-strategy.md:199,203,205-206`). The spec's own DoD D4 fixture (`:321`, no `apps`, one question, must pass) contradicts that table; the code took the DoD side and recorded the divergence only in a code comment. Divergence is baked into A4's exemplar `docs/dev/templates/acme-vet-clinic/automations/morning-reminders.json` (no `apps` key). A contributed template with 0 apps / 1 question is accepted although the client catalogue asserts non-emptiness — the "second class of template" the spec says it wants to prevent. | `packages/kybernos-plugin/domain-pack.mjs:334-336,357` | **spec-error** (the frozen table contradicts its own DoD) **+ doer-error** (a frozen refusal silently reinterpreted in a comment, never escalated) |
| **F-15 `THEME_RE` off-by-one**: code `/^[a-z0-9][a-z0-9-]{0,39}$/` (40 chars) vs the spec's literal `{0,40}`; the literal would accept D1's `'x'.repeat(41)` bad case and contradicts the spec's own "implements 40" prose. Code matches DoD and prose. | `packages/kybernos-plugin/domain-pack.mjs:40` vs `A2-pack-format-strategy.md:130` | **spec-error** (mis-transcribed regex) |
| **F-16 contract `provides` row never gained `files`**: `docs/dev/plugin-contract.md:97` still shows `[{ name, version "1.0", kind, class?, summary?, schema?, validator? }]` while the registry now freezes `files: "json"\|"folder"` on provides and `A2-registry-points-strategy.md:125,469` require the contract's row to use the same word. MISSING in the merged state. | `docs/dev/plugin-contract.md:97` | **doer-error** (A4 owns the docs prose and passed its own D-checks without this row) |
| F-17 silent dedupe: duplicate tags/skills/apps are dropped, not refused (`domain-pack.mjs:287-295,336-345`), against the "reject, never trim" discipline (`A2-pack-format-strategy.md:131`). | `packages/kybernos-plugin/domain-pack.mjs:287-295` | doer-error (minor) |
| F-18 `cat` accepts any token while the catalogue ids are four (`A2-pack-format-strategy.md:195`); the exemplar ships `"cat": "clinic"`. | `packages/kybernos-plugin/domain-pack.mjs:324` | spec-ambiguity (human's) + doer-loose |
| F-19 spec-internal: contributed packs with zero own templates get `kit: { teams: [] }` (`domain-pack.mjs:469-474`) vs interp-5 prose "appears only when something was contributed"; DoD D5 demands exactly the empty slice. Code conforms to the DoD. | — | **spec-error** (loose prose) |

Security of the A2 area is sound: `only()` refuses `__proto__` at every level, merges are spread-only, folder paths are
built solely from `readdir` names with `lstat` + symlink refusal at any depth, names regex-gated, bounds enforced.

### A3-vertical-content + A8-theme-content-six — no frozen requirement violated

Every DoD command ran green (A3 1/3/4/5, A8 D1/D3/D4/D5; both "seq vs HEAD" clauses fail only as the post-commit
batch-time artifact the specs themselves predict). `recrutement.json` matches A3's mockup block verbatim (goal ids,
`mode: "bureau"`, balanced agents with reason, order 90, accent `#4F5BD5`, `theme: "recrutement-ssii"`,
`legacyJobs: []`, draft-only prompts, `research-desk` + the `soon` line P-E #1 prescribes). The six A8 themes conform
line by line (ids, `acc` = pack accent lower-cased, canonical key order/case, `immobilier-locatif.json` byte-matches
the spec model). The five pack edits are exactly +1 key each (D4 deepStrictEqual vs baseline). "The one thing it must
not create" — a new pack file — was not created. No vertical content in code; no dashboard/listing primitive; no
provenance key (P-E #2/#3 written, not smuggled).

| Finding | Anchor | Blame |
|---|---|---|
| F-20 A3:74's e2e expects a "Recrutement SSII" wizard tile; the pack name is `Recruitment/Recrutement` ("SSII" only in the tagline and the style name). No DoD pins the name (PROPOSAL per the spec). | `packages/kybernos-plugin/domains/recrutement.json` name vs `A3-vertical-content-strategy.md:74` | **spec-error** (e2e prose not backed by any check) |
| F-21 `scripts/test-themes-catalogue.mjs:114` ("every shipped theme passes the point") is satisfied by any well-formed gallery JSON and freezes none of A8's semantics (six ids, `acc` = `pack.accent`, canonical form); same shape-level character for the widened `SHIPPED_IDS` assertions. Spec-designed (A8 L8 refuses to pin counts) but it is exactly the class of test that proves the code, not the spec. | `scripts/test-themes-catalogue.mjs:114` | spec-choice (recorded gap G1) |
| F-22 `POINT_CASES` refusal table copy-pasted in both test copies (`packages/kybernos-theme/test-themes-catalogue.mjs:139-146`, `scripts/test-themes-catalogue.mjs:88-95`) while `A11Y_KEYS` was properly de-duplicated. | both files | doer-error (minor) |
| F-23 catalogue `seq` went 2→5 in A3's GO commit (three `--bump` runs where the spec says "preceded by `build --bump`", singular); A8's own batch is exactly one bump (5→6). | `catalog/themes/_catalogue.json` history | doer-error (cosmetic) |
| F-24 doer `impl-*.md` logs written inside `docs/tests/` beyond the specs' write-perimeter tables ("ten files"). Content not read (forbidden input); the perimeter breach itself is visible in the commit file lists. | `3efbdfdb`, `a11942f1` file lists | doer-error (convention breach) |
| Gaps: nothing permanent pins "six themes by id" or `acc = pack.accent`; D10's tenth-pack scenario has no in-repo test. | — | spec-designed gaps, recorded |

### A6-theme-installer + A7-theme-marketplace — PARTIAL/VIOLATES on the flagship flow

Suites green (`test-theme-installer.mjs` 44, `test-theme-market.mjs` 47) — but see F-27: two fixtures diverge from
the real wire, so green there proves the fixture, not the product. The folder path of the flow largely conforms
(stage→plan→one-click→apply order, switch/reversibility rules, kit ticks, automations `active:false, approvals:"ask"`,
degradation when the seam is absent, `session-guard.mjs` byte-identical to baseline — no guard weakening). The
**catalogue path — the campaign's headline — does not work in production and its trust chain is decorative**:

| Finding | Anchor | Spec | Blame |
|---|---|---|---|
| **F-25 (critical) the level is forged from the document**: `level: typeof newest.level === 'string' ? newest.level : 'community'` — the route copies the level the catalogue document claims; `verifyEntry` (which "computes" the level from author/reviewer signatures) is never invoked in production. A person-added source with its own pinned key can publish `level: 'official'`. | `packages/kybernos-plugin/theme-installer.mjs:468` | A6:75 "the level `verifyEntry` computed"; A7:122-141 "levels come from A6's verifier" | **doer-error** |
| **F-26 (critical) the four-level proof chain is decorative**: `verifyEntry` (`:137`) and `verifyArchive` (`:165`) have **zero production callers** (grep: only the tests) — the archive `sha256`, the author signature and the reviewer countersignature are never checked before the manager installs; the "few lines copied from `telechargement.mjs`" (streamed hash, tar listing that may not leave its folder) do not exist anywhere in the diff. | `theme-installer.mjs:137-182`; `client.js:26212` | A6:43 frozen step 2 | **doer-error** |
| **F-27 (critical) the fixtures diverge from the real wire (tests prove the fixture)**: (a) `marketReport` is fed the seam's `{ok,id,version,report}` but reads `r.added/r.skipped/r.failed` + `answer.plan` — the install report **always renders zero rows** (no style accent, no kit counts); (b) `marketCards` reads `entry.manifest.{name,description,author,license}` while the route sends **flat** fields and omits `description` — live cards render empty name/author/licence/description. Both fixtures (`test-theme-market.mjs:27-64,191`) bake the shapes the product never emits; no test feeds `marketCards` an actual `handleThemes` GET answer. | `client.js:26216` vs `30585-30603`; `client.js:30473-30480` vs `theme-installer.mjs:463-476` | A7:97-101, A7:753-755 | **doer-error** |
| **F-28 sources are unconfigurable from the GUI**: the frozen "bounded field row in Settings" is missing — `source-add`/`source-remove` have zero UI callers; no TOFU "key pinned on first use", no warning sentence. | `client.js` (absent); `theme-installer.mjs:577-587` | A6:41, INT5 | **doer-error** |
| **F-29 "Apply the look" retry affordance missing** (the frozen degradation path), and the `styleThere` heuristic (`client.js:25927`: style assumed applied when the field matches) means a later Install never retries the seam either. | `client.js:25927,25986-25992` | A6:49 + its E7 | **doer-error** |
| **F-30 A7's listing is not drawn inside A6's page**: `KbThemesMarket` registers its own Settings section with a second same-named « Thèmes » listing; test §9 enshrines `pageBranch === false`. AMB3-M4/A7's shared-source row froze "the listing block is drawn inside it". | `client.js:30733-30738` vs `26398-26428` | A6:110, A7:93-95 | **doer-error** (defensible alternate reading exists; as shipped there are two listings) |
| **F-31 revokedKeys never checked**: `revocationOf` returns them; the comment claims "a revoked key disables everything that key signed" — nothing checks signing keys against them. | `theme-installer.mjs:187,199` | A6:67 (revocation semantics) | **doer-error** |
| **F-32 record boundary**: `record` copies client-supplied `level/source/applied/before` verbatim and the page **displays** `r.level` (`client.js:26405`) — a signed caller can label a record "official"; meanwhile the page's own record calls never send `version/level/source`, so INT6's fields are half-empty. | `theme-installer.mjs:560`; `client.js:26405` | A6 INT4/INT6 | **doer-error** |
| **F-33 `source` semantics**: the route answers `source: s.url` (the source address) while A6:75 freezes "the catalogue's own id as its source"; the two test fixtures disagree on the meaning. | `theme-installer.mjs:466` | A6:75 | doer-error/ambiguity |
| **F-34 equal-seq replay accepted** (`cat.seq < floor`, not `<=`) though the comment says "backwards is a replay". | `theme-installer.mjs:124` | A6:67 | spec-ambiguity + doer-loose |
| **F-35 A7's frozen OUT OF SCOPE tripped**: `KB_SS_INDEX`/`KB_SS_FR` rows index the listing although "the listing is not indexed in this batch"; code comment cites a repo guard discovered later. | `client.js:3167-3170,3268` | A7:265-266 | **exploration-error** |
| F-36 "newest" version = last array element, not highest (`:458`); archive 8 MiB cap checked only **after** a full browser download (`client.js:26173`) — no streamed cap. | `theme-installer.mjs:458`; `client.js:26165-26185` | A6:43 | doer-error (minor) |
| F-37 A6's client footprint exceeds the granted "three rows + one marked block" (menu icon-set edit + unmarked page/wiring 26036-26463); the menu hunk mixes an unrelated sidebar change and French comments; the `mots` hunk mixes kybernos-log's words; commit `5bc2dc24` ("A6 fix") carries kybernos-log's i18n-allow rows. | `client.js:4796,26036-26463,34875` | A7:211 M2, repo rule 6 | doer-error (cross-batch contamination) |
| F-38 the uncommitted worktree `packages/kybernos-composio/cordis.patch.yml` (`disabled: true`) is literally A7-Lane-B's frozen falsifier ("any hunk in a cordis.patch.yml") if the review counts the worktree — and this review does. | `packages/kybernos-composio/cordis.patch.yml:15` | A7 Lane B | doer-error (uncommitted local config inside the reviewed delta) |

Security notes for this area (deep dive): guard order on the write route is the established one and
`session-guard.mjs`/`sameOriginStrict`/`writeRefused` are **byte-identical to `2ac67fb4`** (no weakening); the catalogue
document is parsed only after its signature verifies (`:100-103`); `writeThemes` is atomic/0600/whitelisted; no
shell/exec anywhere; no archive extraction in-batch (delegated to DSH's manager). Against that: F-25/F-26/F-32 (trust
levels forgeable), F-6/F-2 above (dead symlink guard), 8 MiB unbounded fetch before cap.

### A1-theme-seam + A1-kit-wizard — the wizard itself conforms; two frozen invariants broken from outside

*(Evidence: the A1 evidence-gatherer ran both specs' DoD sets — everything passes except the two items below — plus my
own measurements: `applyPreset` signature and the `{import}`/`{library}` exclusivity match the frozen wire
(`preset-store.mjs:200,258-265`), the browser seam is published and never throws (`kybernos-theme/client.js:2265-2281`),
the kit step reads it through the shared helper and carries `theme` in the complete body
(`kybernos-plugin/client.js:36959-36971`; `test-onboarding-state.mjs` green). The wizard itself conforms.)*

| Finding | Anchor | Spec | Blame |
|---|---|---|---|
| **F-39 `__KB_THEME_APPLY__` exactly-once invariant RED**: DoD 4 asserts the seam is read **exactly once** in `client.js` (and inside the KB-OB-CORE block); it now appears twice — `client.js:36961` (the wizard's `kbObThemeSeam`, correct) and `client.js:26089` (the A6/A7 marketplace's `kbThPorts().style`, added by the same merged diff). The frozen DoD command prints `FAIL wiring: __KB_THEME_APPLY__ appears 2 time(s)` (exit 1). | `client.js:26089,36961` | `A1-kit-wizard-strategy.md:259-290` (DoD 4) | **doer-error** (A6/A7 wrote a second raw read of a wire whose consumption the specs freeze; it should read through the shared helper) **+ spec-error component** (a file-wide "exactly once" count cannot survive a second legitimate consumer) |
| **F-40 the `pack.kit` zero-occurrence invariant RED**: A1-kit-wizard freezes "client.js contains **no** occurrence of `pack.kit`, `.kit.teams`, `.kit.automations` or `kit.themes` (grep count 0)"; the marketplace now reads `plan.kit.teams`/`plan.kit.automations`/`plan.kit.skills` at `client.js:25880,26115,26335,26342,26349`. | `client.js:25880,26115,26335,26342,26349` | `A1-kit-wizard-strategy.md:95-99` | **doer-error** (same collision; the market's kit rendering is legitimate work sitting on a frozen invariant) |
| **F-41 (critical, data loss — VERIFIED BY PROBE) a same-id import overwrites the person's own `me` record**: A1-1 freezes « The `me` record is never touched (byte for byte) ». Probe: store with `{id:'soigne', name:'Soigne', source:'me', settings:{acc:'#000001'}}` + `applyPreset({name:'Soigne', settings:{acc:'#abcdef'}})` → the record afterwards reads `source:'file'`, `settings.acc:'#abcdef'` — the person's settings replaced and their source rewritten. The unit test narrows the frozen claim to "a different id" (`test-preset-store.mjs:147-153`), leaving exactly this hole green. | `packages/kybernos-theme/preset-store.mjs:219-230` | `A1-theme-seam-strategy.md:261-267` (A1-1) | **doer-error** (the test narrowed the frozen rule to pass) |
| **F-42 (critical, data loss — VERIFIED BY PROBE) the suffixed-candidate branch rewrites an unrelated kept record**: with records `u-mine/"Soigne"` (me) and `soigne-2/"Cabinet"` (gallery, `gid:'cab'`, `v:3`), importing name "Soigne" silently rewrites **Cabinet**: settings replaced, `source` gallery→file, **`gid` and `v` dropped** (catalogue link destroyed), and the import answers `{ok, id:'soigne-2', name:'Cabinet'}` — the victim's name, not the import's. Violates « the person's own work is never replaced » and « the import never evicts a theme the person kept ». | `packages/kybernos-theme/preset-store.mjs:224-225` | `A1-theme-seam-strategy.md:261-267` (A1-1) | **doer-error** |
| F-43 frozen gates that cannot pass on a merged diff (design): A1-theme-seam's E4 freezes `git diff --quiet -- packages/kybernos-theme/gallery.json catalog/` (« a NO-GO… must stay empty », `:304-306`) — non-empty on any merged diff because A3's content lands there; same class as F-39/F-40. | `A1-theme-seam-strategy.md:304-306` | — | **spec-error** (batch gates written against a moving shared tree) |
| F-44 two kit-wizard e2e checkboxes never played live: `:115` (seam absent on a **styled** field — only the style-less variant is played) and `:116` (seam refusing/throwing → `theme:null`, no error state). DoD 6's greps pass, the boxes stay open per the spec's own acceptance rule ("a box is closed by a test or by a capture"). | `scripts/check-onboarding-live.mjs` (absent legs) | `A1-kit-wizard-strategy.md:115-116` | **doer-error** |
| F-45 `POST {import}` answers `{ok, id, preset}` where the wire freezes `200 { ok, preset }` — an extra key. | `packages/kybernos-theme/preset-store.mjs:261-263` | `A1-theme-seam-strategy.md:71` | doer-error (low) |
| F-46 `k.theme.note` translations deviate from the pinned proposals and inconsistently: fr translates the page name (« Réglages › Thème ») while es/ar keep Latin "Theme" inside the sentence, against the vision item « no Latin word invented into the sentence ». | `packages/kybernos-plugin/client.js:36780` | `A1-kit-wizard-strategy.md:72-78,126` | doer-error (low) + spec-error (proposal wording) |
| F-47 `node scripts/garde-depot.mjs` regressed from 0 errors/0 warnings to **0 errors/3 warnings**: hard-coded personal paths ×3 in `docs/tests/impl-a6-fix.md` (added by commit `5bc2dc24`; the file is an implementer account and was NOT read — the guard's own output is the evidence). Repo rule 4: "paths = warning to burn down". | `docs/tests/impl-a6-fix.md` (via `scripts/garde-depot.mjs`) | repo rule 4 | **doer-error** |
| F-48 offline fallback mints a fresh `presetId('u')` per call, so repeated offline bag applies create duplicate rows (idempotence frozen only for ids/online); `seamAdopt` evicts the oldest row when a client-side library is full. | `kybernos-theme/client.js:2236,2192` | `A1-theme-seam-strategy.md:261-267` | doer-error (info) |

---

## What would flip BLOCK → PASS (the shortest path)

0. **Fix the record-destroying import path first** (F-41/F-42, user data): the same-id branch must leave a `me`
   record alone (A1-1's literal rule), and the suffixed-candidate branch must match only the record that import
   itself created (e.g. keep the import's own name/gid as the identity), never a stranger's id. Add the two probes
   above as tests — the current unit test's "a different id" narrowing is what let this ship.
1. **Wire the catalogue half or cut it**: give `handleThemes` a real transport (bounded, `telechargement.mjs` rules
   copied as A6:43 freezes), call `verifyEntry`/`verifyArchive` so the level is computed (F-25/F-26), fix the two
   A6↔A7 wire shapes against the real route answer (F-27), and ship the Settings source row (F-28). Or: freeze in the
   specs that the catalogue half is out and delete the decorative chain (F-3, dead-code rider).
2. **Re-green the two frozen A1 invariants** (F-39/F-40): route the marketplace's seam read through the shared helper
   (or the `__KB__` provide alias) and re-scope the `pack.kit` grep to the KB-OB blocks — one spec edit, one code edit.
3. **0 red** (F-6): the log bundle must carry its registration trio + signpost copy (6 reds), and the cloud rename must
   sweep its three dependents (`KB_FEEDBACK_API_DEFAULT`, the E2B template, the servers fixture — 10 failures).
4. **Un-weaken the five dropped assertion sets** (F-5) and make the fixtures speak the product's wire (F-27).
5. Kill the dead branches (F-2/F-31), fix the two doc contradictions (F-7) and the seven stale anchors (F-9).

Everything else in this review is WARN-level and can ride a ticket.

## Method note

Evidence was gathered by six focused evidence-gathers (per-batch conformity, tests sweep) whose findings were
re-measured by the verifier before inclusion; every red suite file was run, the two frozen A1 invariants were run
verbatim, the symlink/`statSync` claim was proven in a scratch dir, and the guard files' zero-diff status was checked
with `git diff --stat`. No implementer or gate account was read.
