# Executable test strategy — B2 `gate-trial-proof`

Batch: `gate-trial-proof` (supervised trial machine, proof report, gate-record normalization).
Worktree: `kybernos-plugins-proactive`, branch `feature/kaby-proactive-lot1`.
Spec: `docs/dev/kaby-proactive/specs/gate-trial-proof.md`. Contract: `docs/dev/kaby-proactive/cadrage.md` §B2.

The batch adds **no route and no pixel**: it ships one pure ES module
(`packages/kybernos-plugin/automation-trial.mjs`) and its unit test. So "real mode" here means
*the real module run against real DSH journal files and the real GUI still standing*, not an HTTP
journey (B3 owns the routes and its own journey test).
Every command below is run from the repository root of the worktree. `$DSH_HOME` is DSH's own
home variable; nothing in this document hardcodes a personal path, and nothing writes inside the
repository.

Each of the six marker lines below is anchored at column 0 (one line per marker, no other line in
this file starts with those words), so `grep -c '^e2e:'` style checks find exactly one hit each.

## e2e — replayable journeys in real mode

e2e: three journeys, J1 on a real automation-run journal of this machine, J2 on a read-only journal fixture, J3 on the refusal and no-activation edges; each command exits 0 only when its assertions hold.

**J1 — a real run, replayed.** A real automation run of this machine wrote `bash`, `web_fetch` and
`skill` calls in its journal (measured on the journals present under `$DSH_HOME/sessions`). bash is
write-classified and, in a journal written before this batch, it was **not** refused at runtime, so
such a run must come back **not** side-effect-free: that is the case which would slip through if the
mask were trusted instead of checked. The command asserts the consequence only when a write-classified
call that was not refused is really present (`refused-as-write` can only appear once B3's guard is
installed, never in a historical journal), and it asserts the converse — a non-passing proof always
names at least one effect — so a machine whose journals happen to be read-only still gets an honest
verdict.

```bash
JR=$(ls -S "${DSH_HOME:-$HOME/.dsh}"/sessions/*automations*/*/session.v4.jsonl.zstd 2>/dev/null | head -1)
[ -n "$JR" ] || { echo 'SKIPPED: no automation-run journal on this machine'; exit 3; }
zstd -dc "$JR" > /tmp/kb-real-run.jsonl
node --input-type=module -e "
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const m = await import('./packages/kybernos-plugin/automation-trial.mjs')
const events = readFileSync('/tmp/kb-real-run.jsonl', 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l))
const at = new Date().toISOString()
const gate = { id: 'gate:real', automationId: 'real', status: 'static-passed', staticChecks: { ranAt: at, verdict: 'pass', findings: [] }, trial: null, approval: { state: 'none', at: null }, updatedAt: at, rev: 1 }
const started = m.startTrial({ gate, by: 'person', at })
assert.equal(started.ok, true)
const { trial, proof } = m.trialFromEvents({ trial: started.trial, events, at })
assert.equal(proof.supervised, true)
assert.ok(proof.toolCalls.length > 0)
assert.notEqual(proof.outcome.state, 'open', 'replay a closed run')
if (proof.toolCalls.some((c) => c.access === 'write' && c.outcome !== 'refused-as-write')) assert.equal(proof.sideEffectFree, false, 'a real run that used bash is not side-effect-free')
if (proof.sideEffectFree === false) assert.ok(proof.externalEffects.length > 0, 'a non-passing proof names at least one effect')
assert.ok(['done', 'failed'].includes(trial.state))
console.log('J1 ok:', proof.toolCalls.length, 'calls,', proof.externalEffects.length, 'effect(s),', trial.state)
"
```

**J2 — a clean, read-only journal.** The opposite verdict, on a fixture written outside the repo;
the shape is the engine's own (validated against `summarizeRun`, which reads it back as
`outcome: completed`, 2 calls).

```bash
node --input-type=module -e "
import assert from 'node:assert/strict'
const m = await import('./packages/kybernos-plugin/automation-trial.mjs')
const T0 = 1_790_000_000_000
const ev = (type, dt, data) => ({ type, time: T0 + dt, data })
const journal = (calls) => {
  const out = [ev('session', 0, {}), ev('turn/start', 100, { turn: 1 })]
  calls.forEach((c, i) => {
    out.push(ev('tool/call', 200 + i, { turn: 1, step: 1, callId: 'c' + i, name: c.name, arguments: JSON.stringify(c.args || {}) }))
    out.push(ev('tool/result', 300 + i, { turn: 1, step: 1, message: Object.assign({ role: 'tool', toolCallId: 'c' + i, content: c.text || 'ok' }, c.error === true ? { isError: true } : {}) }))
  })
  out.push(ev('turn/end', 400 + calls.length, { turn: 1, reason: { kind: 'completed' } }))
  return out
}
const at = new Date(T0).toISOString()
const gate = { id: 'gate:a1', automationId: 'a1', status: 'static-passed', staticChecks: { ranAt: at, verdict: 'pass', findings: [] }, trial: null, approval: { state: 'none', at: null }, updatedAt: at, rev: 1 }
const trial = m.startTrial({ gate, by: 'person', at }).trial
const clean = m.trialFromEvents({ trial, events: journal([{ name: 'read', args: { path: '/tmp/x' } }, { name: 'web_search', args: { q: 'x' } }]), at })
assert.equal(clean.proof.sideEffectFree, true)
assert.deepEqual(clean.proof.externalEffects, [])
assert.equal(clean.trial.state, 'done')
assert.equal(m.trialPassed(clean.proof), true)
assert.equal(m.gateStatusAfterTrial(clean.trial, clean.proof), 'awaiting-approval')
const rec = m.applyTrial(gate, { trial: clean.trial, proof: clean.proof, at })
assert.equal(rec.status, 'awaiting-approval')
assert.equal(rec.rev, 2)
console.log('J2 ok:', rec.status)
"
```

**J3 — the two refusals and the un-activatable record.** No journal needed: the state machine and
the ladder.

```bash
node --input-type=module -e "
import assert from 'node:assert/strict'
const m = await import('./packages/kybernos-plugin/automation-trial.mjs')
const at = new Date().toISOString()
const gate = { id: 'gate:a1', automationId: 'a1', status: 'static-passed', staticChecks: { ranAt: at, verdict: 'pass', findings: [] }, trial: null, approval: { state: 'none', at: null }, updatedAt: at, rev: 1 }
for (const by of ['model', 'cron', 'webhook', undefined]) assert.equal(m.startTrial({ gate, by, at }).code, 'not-supervised')
assert.equal(m.startTrial({ gate: { ...gate, status: 'draft' }, by: 'person', at }).code, 'gate-not-ready')
assert.equal(m.startTrial({ gate, by: 'person', at, capacity: { level: 'high' } }).code, 'machine-busy')
const forged = m.normalizeGateRecord({ ...gate, staticChecks: null, status: 'activated', approval: { state: 'none', at: null } })
assert.equal(forged.status, 'draft')
assert.equal(m.mayActivate(forged), false)
assert.equal(typeof m.mayActivate, 'function', 'B3 activation predicate')
assert.equal(Object.keys(m).length, 27, 'the complete export surface of spec 3.2.1')
assert.equal(Object.keys(m).filter((k) => /^(grant|activate|approve)/.test(k)).length, 0, 'the module must not export a grant/activate transition')
console.log('J3 ok:', forged.status)
"
```

What "replayable" means here: J1 needs a machine that has run automations (exit 3 and a
`SKIPPED:` line when it has none — a skip is not a pass, and `scripts/run-all-tests.mjs` counts
`SKIPPED:` lines), J2 and J3 are deterministic anywhere.

## vision — before/after captures compared

vision: two captures of the same real Automations page, one before the batch is applied and one after, read with `read_image` and compared for "no visible change", because this batch ships no surface.

The expected result is **no visual difference**: nothing in this batch is wired into the page
(B5 renders the gate panel later). The reading is therefore a non-regression proof, and it is
read, not declared: open both PNGs with `read_image` in the same turn, then state the verdict in
one line — same layout, same labels, same row heights, no new column, no new chip, no shifted
baseline. A difference means the batch leaked into a surface it does not own (a red flag for
invariant #4), not an improvement.

Rules carried from `AGENTS.md`: the captures are read, never just taken; the page is visited
read-only (clicking through the GUI is not a persisted setting, so nothing of the person's DSH is
changed); the theme is **not** switched — a theme change persists, and this campaign must not
change a setting. The one dark capture is therefore taken only if the machine is already in dark
mode, and the strategy says so instead of silently switching.

## capture — the capture commands

capture: `node --input-type=module -e` with `scripts/live-page.mjs` (signed cookie, throw-away Chrome), click Automations, `page.shot` to `/tmp/trial-before/` and `/tmp/trial-after/`; screenshots never enter the repository.

Before the batch (run first, keep the PNGs):

```bash
mkdir -p /tmp/trial-before
node --input-type=module -e "
import { openLivePage, clickText, waitFor } from './scripts/live-page.mjs'
const live = await openLivePage()
const { page } = live
try {
  await waitFor(page, 'document.readyState === \'complete\'', 30000)
  await clickText(page, 'Automations')
  await waitFor(page, '/Automations/.test(document.body.innerText)', 30000)
  await page.shot('/tmp/trial-before/automations.png')
  console.log('captured')
} finally { await live.close() }
"
```

After the batch: the same command with `/tmp/trial-after/automations.png`, then the two files are
read with `read_image`. Only `/tmp` is written: `node scripts/garde-depot.mjs` stays clean, and no
media is added to git.

## maquette

maquette: No visible surface in this batch — the module has no DOM, no route and no string the person reads; the gate panel, its proof rendering and its i18n chains belong to B5 (`automations-gate-ui`), whose spec owns that mockup, and mocking it here would pre-empt a hot file this write set must not touch.

## unit — the unit tests and their runner

unit: `packages/kybernos-plugin/test-automation-trial.mjs`, `node:assert/strict` in the house style of `test-automation-runs.mjs`, auto-discovered by `scripts/run-all-tests.mjs` (`packages/*/test*.mjs`); 27 cases, one per spec §5 row.

Harness: `import assert from 'node:assert/strict'`, a local `ok(label)` counter printing `✓`, a
final `<n> verifications OK`, `process.exit(0)` — exactly the neighbours' shape, so the runner
(`discover()` → `packages/kybernos-plugin/test-automation-trial.mjs`, cwd = the package) needs no
registration. Run one file while working, the whole gate before a merge:

```bash
node packages/kybernos-plugin/test-automation-trial.mjs
node scripts/run-all-tests.mjs --only automation-trial
node scripts/run-all-tests.mjs
```

Cases (each maps to a spec row, each asserts one falsifiable thing):

1. empty event list and "no `turn/start`" → `proof === null`, trial unchanged (row 1);
2. an open turn → `outcome.state 'open'`, `endedAt null`, trial `running` (row 2);
3. a succeeded write call → `access 'write'`, `outcome 'ok'`, `sideEffectFree false`,
   `write-succeeded:` entry (row 3);
4. a write refused by approval `rejected`, `cancelled`, `unavailable` → `outcome 'refused-as-write'`,
   **no** `externalEffects` entry and `sideEffectFree true` (a refusal is the mask working, not an
   outside effect), so the proof passes (rows 4, 6);
5. a write refused by the mask (`TRIAL_DENY_REASON` in the error text) → same as 4 (row 5);
6. a write that errored with no refusal evidence → `write-unverified:`, `sideEffectFree false`
   (conservative: it may have run) (row 7);
7. `accessOf` tables: Composio multi-execute with a write slug, `COMPOSIO_SEARCH_TOOLS`,
   `mcp__notion__list_pages`, `read`/`glob`/`grep`/`web_search`/`web_fetch` are reads;
   `bash`/`write`/`edit`/`spawn_teammate`/`subagent` and any unknown name are writes (rows 8-10);
8. 300 calls where writes past the 20-call output bound succeed → lists capped at 20/10/5 and
   `externalEffects` capped at 10, but `sideEffectFree` is false because the verdict is computed over
   all calls (row 11);
9. a second turn later in the journal → ignored (row 12);
10. `startTrial` with `by: 'model' | 'cron' | 'webhook' | undefined` → `not-supervised`, no trial
    object returned (row 13);
11. `startTrial` on `draft` / `static-failed` → `gate-not-ready` (row 14);
12. `startTrial` while a proof is `open` → `already-open` (row 15);
13. `capacity: { level: 'high' }` → `machine-busy`, and `{ level: 'busy' }` with one run allowed
    → accepted (row 16, via `allowedAt`);
14. `advanceTrial` edges: `requested→running→done`, `running→failed`, and three illegal signals →
    `changed: false`, `code: 'illegal-transition'` (row 17, plus the no-regression rule);
15. the frozen vocabularies: `TRIAL_STATES` and `TRIAL_TRANSITIONS` equal spec §3.3, and the
    re-exported `GATE_STATUSES` / `GATE_APPROVAL_STATES` / `GATE_RECORD_KEYS` equal the cadrage
    unions and B1's own lists (a change on either side fails here, not in production);
16. the ladder: `activated` with `approval none` → `draft`; `activated` + granted + failing proof →
    `trial-done`; `approved` + granted + passing proof → kept, `mayActivate` true (rows 18-20);
17. derived static rung: `verdict 'fail'` + stored `static-passed` → `static-failed` (row 21);
18. `rev` flooring (`0`, `'7'`, `3.5`, absent → `1`) and no raising by normalization (row 22);
19. scrubbing: a result body with an e-mail, a 500-char token and control characters → no `@`
    pattern, no 28+ token run, no control char in `errors[].message` (row 23);
20. hostile records: `null`, `[]`, `'x'`, `{}`, `{ automationId: '../x' }` → `null` (row 24);
21. `applyTrial` twice with the same proof → equal record, same `rev` (row 25);
22. `toStoredGate` round trip is stable, emits exactly the frozen keys, and carries no `undefined`
    (row 26);
23. `findings` from B1 are bounded to the imported `GATE_FINDINGS_MAX` (33), `toStoredGate`
    emits exactly `GATE_RECORD_KEYS`, and an unknown severity becomes `info`;
24. the exported surface equals the complete list of spec §3.2.1 by set equality (27 names, so a name
    added, renamed or dropped fails here) — `mayActivate` included, and the three names B3's contract
    adopts (`startTrial`, `toStoredGate`, `mayActivate`) are all `typeof 'function'`, so the export B3
    calls as its single activation predicate cannot go missing — and no name starts with
    `grant`/`activate`/`approve` (invariant #1, asserted, not promised);
25. the module imports only `./automation-runs.mjs`, `./automation-load.mjs` and
    `./automation-gate.mjs` — every `from '…'` line of the source text matches
    `/from '\.\/(automation-runs|automation-load|automation-gate)\.mjs'/` — so a future `fs`,
    `index.js` or `pulse-core` import fails here;
26. a proof built twice from the same events is deeply equal (the builder is a pure function);
27. no clock: `startTrial`/`askApproval` with a missing, empty or non-ISO `at` refuse
    `'no-timestamp'`, `applyTrial` keeps the previous `updatedAt`, `normalizeGateRecord` returns
    `null` when neither the stored `updatedAt` nor `opts.at` is ISO 8601 (and never emits `''`), and
    the source text contains neither `Date.now(` nor `new Date(` (row 27 — the purity claim of §3,
    asserted).

## DoD — the discriminating definition of done

DoD: `node packages/kybernos-plugin/test-automation-trial.mjs` exits 0, and both inline commands below pass; all three FAIL on the current tree, measured on this machine, and the two labels differ: the unit file is absent, so Node's entry-point resolution stops with `MODULE_NOT_FOUND` (`Error: Cannot find module …/test-automation-trial.mjs`); Command 1's `await import()` of that same missing module throws `ERR_MODULE_NOT_FOUND`, the ESM resolver's code — not the same label as the line above; Command 2's `test -f` exits 1. None of them is a check that passes today, while `node scripts/run-all-tests.mjs` must end 0 red as the merge gate (green today, so a non-regression check, not the discriminating one).

Command 1 — the two opposite verdicts and the no-activation predicate, on the module itself:

```bash
node --input-type=module -e "
import assert from 'node:assert/strict'
const m = await import('./packages/kybernos-plugin/automation-trial.mjs')
const T0 = 1_790_000_000_000
const ev = (type, dt, data) => ({ type, time: T0 + dt, data })
const journal = (calls) => {
  const out = [ev('session', 0, {}), ev('turn/start', 100, { turn: 1 })]
  calls.forEach((c, i) => {
    out.push(ev('tool/call', 200 + i, { turn: 1, step: 1, callId: 'c' + i, name: c.name, arguments: JSON.stringify(c.args || {}) }))
    out.push(ev('tool/result', 300 + i, { turn: 1, step: 1, message: Object.assign({ role: 'tool', toolCallId: 'c' + i, content: c.text || 'ok' }, c.error === true ? { isError: true } : {}) }))
  })
  out.push(ev('turn/end', 400 + calls.length, { turn: 1, reason: { kind: 'completed' } }))
  return out
}
const at = new Date(T0).toISOString()
const gate = { id: 'gate:a1', automationId: 'a1', status: 'static-passed', staticChecks: { ranAt: at, verdict: 'pass', findings: [] }, trial: null, approval: { state: 'none', at: null }, updatedAt: at, rev: 1 }
const trial = m.startTrial({ gate, by: 'person', at }).trial
const ok = m.trialFromEvents({ trial, events: journal([{ name: 'read' }, { name: 'web_search' }]), at })
assert.equal(ok.proof.sideEffectFree, true)
assert.deepEqual(ok.proof.externalEffects, [])
assert.equal(m.trialPassed(ok.proof), true)
const bad = m.trialFromEvents({ trial, events: journal([{ name: 'mcp__gmail__send_email' }]), at })
assert.equal(bad.proof.toolCalls[0].access, 'write')
assert.equal(bad.proof.sideEffectFree, false)
assert.equal(bad.proof.externalEffects.length, 1)
assert.match(bad.proof.externalEffects[0], /^write-/)
assert.equal(m.trialPassed(bad.proof), false)
const masked = m.trialFromEvents({ trial, events: journal([{ name: 'mcp__gmail__send_email', error: true, text: m.TRIAL_DENY_REASON }]), at })
assert.equal(masked.proof.toolCalls[0].outcome, 'refused-as-write')
assert.deepEqual(masked.proof.externalEffects, [], 'a refusal is not an outside effect')
assert.equal(masked.proof.sideEffectFree, true, 'every write call was refused at runtime')
assert.equal(m.trialPassed(masked.proof), true)
assert.equal(m.mayActivate({ ...gate, status: 'activated', trial: ok.proof, approval: { state: 'none', at: null } }), false)
assert.equal(m.mayActivate({ ...gate, status: 'approved', trial: ok.proof, approval: { state: 'granted', at } }), true)
assert.equal(typeof m.startTrial, 'function', 'the export B3 starts a trial with')
assert.equal(typeof m.toStoredGate, 'function', 'the only writer shape B3 uses')
assert.equal(m.TRIAL_APPROVALS, 'ask', 'the approval preset B3 must install, frozen here')
assert.equal(m.normalizeGateRecord(m.toStoredGate({ ...gate, status: 'approved', trial: ok.proof, approval: { state: 'granted', at }, rev: 7 })).rev, 7)
assert.equal(Object.keys(m).length, 27)
assert.equal(Object.keys(m).filter((k) => /^(grant|activate|approve)/.test(k)).length, 0)
console.log('DoD-1 ok')
"
```

Command 2 — the module exists and is pure at the file level (no I/O import, no clock, no network),
which is what lets B3 import it without touching DSH's boot path. The header comment must therefore
say "never reads the clock" in prose and not spell the forbidden calls literally, or the grep below
would flag an honest comment:

```bash
test -f packages/kybernos-plugin/automation-trial.mjs \
  && ! grep -nE "from '(node:)?(fs|http|https|net|child_process)|fetch\(|require\(" packages/kybernos-plugin/automation-trial.mjs \
  && ! grep -nE "Date\.now\(|new Date\(" packages/kybernos-plugin/automation-trial.mjs \
  && echo 'DoD-2 ok'
```

Command 3 — the whole suite, because the merge gate is 0 red and a red file nothing here broke is
still red on the merge:

```bash
node scripts/run-all-tests.mjs
```

Not a DoD, and why: `node scripts/run-all-tests.mjs --only automation-trial` is green **today**
(zero files match, zero red) — a check that also passes on the current code proves nothing. It is
a convenience while working, never the verdict.
