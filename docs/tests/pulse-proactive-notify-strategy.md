# Test strategy — `pulse-proactive-notify` (B6)

Executable contract for the implementation of `docs/dev/kaby-proactive/specs/pulse-proactive-notify.md`.
Every command below is written to be pasted as it stands, from the repository root of the worktree
`kybernos-plugins-proactive` (branch `feature/kaby-proactive-lot1`). Nothing here writes inside the
tracked tree except the six files of the spec's write set (the five `packages/kybernos-pulse/` code
and test files plus its `README.md`); captures and the mockup live in `/tmp`.

Finding numbers below are the rows of `docs/dev/kaby-proactive/porte-spec.md`, never a local
renumbering (lead decision R9e): `finding 16` is the maquette gate, `17` the before/after pair, `26`
the machine-local CSS source, `29` the projected fixture.

Preconditions used by the markers below:

```bash
cd "$(git rev-parse --show-toplevel)"        # the worktree, whatever its name
git branch --show-current                     # feature/kaby-proactive-lot1
node scripts/sandbox/setup.sh                 # links the sandbox profile at THIS worktree (idempotent)
```

`scripts/sandbox/env.sh` sets `HOME`, `DSH_HOME` and `KB_HOST` to the sandbox instance (never the real
`~/.dsh`); it must be sourced in every shell block that seeds or queries. The sandbox loads the bundle,
the person's own `dsh web` on `:3080` does not (that is why `scripts/check-pulse-live.mjs` refuses it).

e2e: three replayable journeys, real mode (sandbox DSH + real routes + real panel page)

All three run against the sandbox instance. They are ordered: J1 needs a fresh store, and J2/J3 only
rewrite the two feed files on disk — `gates.json` (B3's gate store) and the `initiatives.json` ledger
beside it, both next to `tasks.json`. Both files are read on every pass (15 s), so no restart is
needed after J1: a journey is a file write, a wait, and an assertion on `/kybernos-pulse/state`.
`tasks.json` is seeded too, but for one thing only: the automation's display name.

### J1 — an approval due at switch-on (baselining + name lookup)

```bash
bash scripts/sandbox/stop.sh
source scripts/sandbox/env.sh
rm -f "$DSH_HOME/kybernos/pulse/pulse.json" "$DSH_HOME/kybernos/initiatives.json" "$DSH_HOME/kybernos/gates.json"
# one automation (the name only) and its gate, in B3's store: `gates.json` beside `tasks.json` is the
# feed B6's pass reads (lead decision R1) — never the `gate` field of `tasks.json`, which is B5's
cat > "$DSH_HOME/kybernos/tasks.json" <<'JSON'
[{"id":"a1","name":"Weekly price digest","active":false,"history":[]}]
JSON
cat > "$DSH_HOME/kybernos/gates.json" <<'JSON'
{"version":1,"records":[
 {"id":"gate:a1","automationId":"a1","status":"awaiting-approval",
  "staticChecks":{"ranAt":"2026-10-28T00:00:00.000Z","verdict":"pass","findings":[]},
  "trial":{"runId":"run-1","gateId":"gate:a1","startedAt":"2026-10-28T00:00:00.000Z","endedAt":"2026-10-28T00:02:10.000Z",
           "supervised":true,"sideEffectFree":true,
           "toolCalls":[{"toolName":"bash","access":"read","outcome":"ok"}],
           "outcome":{"state":"completed"},"externalEffects":[],"errors":[]},
  "approval":{"state":"asked","at":null},"updatedAt":"2026-10-28T00:03:00.000Z","rev":4}]}
JSON
bash scripts/sandbox/start.sh
sleep 20   # one watcher pass is every 15 s (PASS_MS), the first one 3 s after boot
node --input-type=module -e "$(cat <<'EOF'
const st = await (await fetch('http://' + process.env.KB_HOST + '/kybernos-pulse/state')).json()
const g = st.inbox.find((x) => x.id === 'g:a1')
const problems = []
if (!g) problems.push('no gate item in the inbox: ' + JSON.stringify(st.inbox))
else {
  if (g.kind !== 'waiting') problems.push('kind is ' + g.kind + ' (expected waiting)')
  if (g.todo !== true) problems.push('the gate item is not a to-do')
  if (g.source !== 'gate') problems.push('source is ' + g.source)
  if (g.task !== 'Weekly price digest') problems.push('the automation name was not resolved: ' + g.task)
  if (g.code !== 'gate.awaiting-approval') problems.push('code is ' + g.code)
}
if (st.banners.length !== 0) problems.push('the first pass raised a banner: ' + JSON.stringify(st.banners))
if (st.unread < 1) problems.push('the ask is not counted: ' + st.unread)
if (problems.length > 0) { console.error(problems.join('\n')); process.exit(1) }
console.log('J1 ok')
EOF
)"
```

Expected: `J1 ok`. The ask is listed, counted, silent (no banner) because it arrived on the first pass;
its name is the `name` of the task whose `id` is the record's `automationId`, read from the
`tasks.json` list the pass already has; `pulse.json` now holds `state.gates.a1 = { sig, at }`:

```bash
source scripts/sandbox/env.sh
node --input-type=module -e "$(cat <<'EOF'
import { readFileSync } from 'node:fs'
const s = JSON.parse(readFileSync(process.env.DSH_HOME + '/kybernos/pulse/pulse.json', 'utf8'))
if (s.state.baselined !== true) { console.error('not baselined'); process.exit(1) }
if (!s.state.gates || s.state.gates.a1 === undefined) { console.error('the gate was not remembered: ' + JSON.stringify(s.state)); process.exit(1) }
if (s.settings.level !== 'need' || s.settings.version !== 1) { console.error('the settings shape moved: ' + JSON.stringify(s.settings)); process.exit(1) }
console.log('J1 stored ok')
EOF
)"
```

### J2 — a trial that passes, then a trial that reached outside

```bash
source scripts/sandbox/env.sh
# the same automation, its supervised trial produced its proof and nothing left the machine: the record
# is rewritten in gates.json, the store — tasks.json is not touched at all (it only carries the name)
node --input-type=module -e "$(cat <<'EOF'
import { readFileSync, writeFileSync } from 'node:fs'
const file = process.env.DSH_HOME + '/kybernos/gates.json'
const store = JSON.parse(readFileSync(file, 'utf8'))
store.records[0] = { id: 'gate:a1', automationId: 'a1', status: 'trial-done',
  staticChecks: { ranAt: '2026-10-28T00:00:00.000Z', verdict: 'pass', findings: [] },
  trial: { runId: 'run-1', gateId: 'gate:a1', startedAt: '2026-10-28T00:00:00.000Z', endedAt: '2026-10-28T00:02:10.000Z',
           supervised: true, sideEffectFree: true,
           toolCalls: [{ toolName: 'bash', access: 'read', outcome: 'ok' }, { toolName: 'read', access: 'read', outcome: 'ok' }],
           outcome: { state: 'completed' }, externalEffects: [], errors: [] },
  approval: { state: 'none', at: null }, updatedAt: '2026-10-28T00:10:00.000Z', rev: 5 }
writeFileSync(file, JSON.stringify(store))
console.log('gate repointed: trial-done, clean')
EOF
)"
sleep 20
node --input-type=module -e "$(cat <<'EOF'
const st = await (await fetch('http://' + process.env.KB_HOST + '/kybernos-pulse/state')).json()
const g = st.inbox.find((x) => x.id === 'g:a1')
if (!g || g.kind !== 'done' || g.code !== 'gate.trial.passed') { console.error('the verdict card is wrong: ' + JSON.stringify(g)); process.exit(1) }
if (!/no external effect/i.test(g.message)) { console.error('the card does not report the verdict: ' + g.message); process.exit(1) }
if (st.banners.includes('g:a1')) { console.error('a passed trial bannered at the default level'); process.exit(1) }
if (st.running.length !== 0) { console.error('the trial was relaunched as a run: ' + JSON.stringify(st.running)); process.exit(1) }
console.log('J2a ok')
EOF
)"
# now the proof says the trial reached outside (same store, one record replaced)
node --input-type=module -e "$(cat <<'EOF'
import { readFileSync, writeFileSync } from 'node:fs'
const file = process.env.DSH_HOME + '/kybernos/gates.json'
const store = JSON.parse(readFileSync(file, 'utf8'))
store.records[0] = { id: 'gate:a1', automationId: 'a1', status: 'trial-done',
  staticChecks: { ranAt: '2026-10-28T00:00:00.000Z', verdict: 'pass', findings: [] },
  trial: { runId: 'run-2', gateId: 'gate:a1', startedAt: '2026-10-28T00:20:00.000Z', endedAt: '2026-10-28T00:21:00.000Z',
           supervised: true, sideEffectFree: false,
           toolCalls: [{ toolName: 'mcp__composio__GMAIL_SEND_EMAIL', access: 'write', outcome: 'refused-as-write' }],
           outcome: { state: 'completed' }, externalEffects: ['composio:GMAIL_SEND_EMAIL'], errors: [] },
  approval: { state: 'none', at: null }, updatedAt: '2026-10-28T00:22:00.000Z', rev: 6 }
writeFileSync(file, JSON.stringify(store))
console.log('gate repointed: trial-done, unsafe')
EOF
)"
sleep 20
node --input-type=module -e "$(cat <<'EOF'
const st = await (await fetch('http://' + process.env.KB_HOST + '/kybernos-pulse/state')).json()
const g = st.inbox.find((x) => x.id === 'g:a1')
if (!g || g.kind !== 'failed' || g.code !== 'gate.trial.effects') { console.error('an unsafe proof is not reported as failed: ' + JSON.stringify(g)); process.exit(1) }
if (!/GMAIL_SEND_EMAIL/.test(g.message)) { console.error('the card does not name the effect: ' + g.message); process.exit(1) }
if (!st.banners.includes('g:a1')) { console.error('a failure is not due for a banner at the default level'); process.exit(1) }
console.log('J2b ok')
EOF
)"
```

### J3 — a proposal, and the proof that the inbox cannot approve

```bash
source scripts/sandbox/env.sh
cat > "$DSH_HOME/kybernos/initiatives.json" <<'JSON'
[{"id":"i_demo1","title":"Prepare a weekly price digest",
  "evidence":{"n":3,"span":"7 days","where":"chat"},
  "risk":"low","reversibility":"easy",
  "nextAction":{"kind":"draft","summary":"A draft message, ready to review"},
  "status":"proposed","at":"2026-10-28T00:30:00.000Z"}]
JSON
sleep 20
node --input-type=module -e "$(cat <<'EOF'
const st = await (await fetch('http://' + process.env.KB_HOST + '/kybernos-pulse/state')).json()
const q = st.inbox.find((x) => x.id === 'q:i_demo1')
const problems = []
if (!q) problems.push('no proposal item: ' + JSON.stringify(st.inbox))
else {
  if (q.kind !== 'waiting' || q.source !== 'queue') problems.push('wrong mapping: ' + JSON.stringify(q))
  if (q.task !== 'Prepare a weekly price digest') problems.push('the title is not the entry title: ' + q.task)
  if (!/draft message/i.test(q.message)) problems.push('the draft is not described: ' + q.message)
}
if (problems.length > 0) { console.error(problems.join('\n')); process.exit(1) }
console.log('J3a ok')
EOF
)"
# the same browser the page uses: a real session cookie, and the only actions the route accepts
node --input-type=module -e "$(cat <<'EOF'
import { openLivePage } from './scripts/live-page.mjs'
const live = await openLivePage({ width: 1200, height: 900 })
const post = (body) => live.page.evalJs("fetch('/kybernos-pulse/inbox',{method:'POST',headers:{'content-type':'application/json'},body:" + JSON.stringify(JSON.stringify(body)) + "}).then(async (r)=>({status:r.status, body: await r.json()}))")
const bad = await post({ action: 'approve', id: 'g:a1' })
const alsoBad = await post({ action: 'activate', id: 'g:a1' })
const readOk = await post({ action: 'read', id: 'q:i_demo1' })
await live.page.evalJs("fetch('/kybernos-pulse/settings',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mute:'Weekly price digest'})}).then((r)=>r.status)")
const st = await (await fetch('http://' + process.env.KB_HOST + '/kybernos-pulse/state')).json()
await live.close()
const problems = []
if (bad.val.status !== 400) problems.push('the inbox accepted { action: "approve" }: ' + JSON.stringify(bad.val))
if (alsoBad.val.status !== 400) problems.push('the inbox accepted { action: "activate" }: ' + JSON.stringify(alsoBad.val))
if (readOk.val.status !== 200) problems.push('the friendliest action broke: ' + JSON.stringify(readOk.val))
const g = st.inbox.find((x) => x.id === 'g:a1')
if (!g || g.quiet === true) problems.push('muting the automation quieted an ask: ' + JSON.stringify(g))
if (!g || g.kind !== 'failed') problems.push('the failure disappeared')
if (problems.length > 0) { console.error(problems.join('\n')); process.exit(1) }
console.log('J3b ok')
EOF
)"
bash scripts/sandbox/stop.sh
```

Expected: `J3a ok`, `J3b ok`. Invariant #1 is proved at the route, not only in the unit test: the four
inbox actions still work, `approve`/`activate` are refused, and a mute silences results only.

Cleanup (the sandbox is disposable, but leave it as found): `bash scripts/sandbox/stop.sh` then,
after sourcing `env.sh`, `rm -f "$DSH_HOME/kybernos/gates.json" "$DSH_HOME/kybernos/initiatives.json"
"$DSH_HOME/kybernos/tasks.json"` — the three seed files are the journeys' own, they live in the
sandbox home and nowhere else. The person's real `~/.dsh` is never read and never written by any block here
(`scripts/sandbox/env.sh` is sourced in every one of them).

### Regression journey (must pass unchanged)

```bash
bash scripts/sandbox/stop.sh
source scripts/sandbox/env.sh
node scripts/check-pulse-live.mjs --seed   # writes the seeded failed run into the sandbox store, then exits
bash scripts/sandbox/start.sh              # the host reads that file at boot, so the seed comes first
node scripts/check-pulse-live.mjs          # needs DSH_HOME / HOME / KB_HOST from env.sh, in this shell
bash scripts/sandbox/stop.sh
```

Expected: the same checks as before the batch, 0 failed. This check is the proof that the scheduler
half (routes, settings, badges, Settings › Widget page, narrow window) did not move. It is **not**
discriminating for this batch (it passes today) and therefore is not the DoD.

vision: before/after captures, compared point by point and read by the session model

Five captures per side (before = the code of the parent commit, after = the batch), same seeds, same
viewport. Every PNG is opened with `read_image` in the session that wrote it: `read_image` attaches the
image to the running conversation, so the **session model** reads it. No delegation of the reading to
another model, and no third-party vision route (account policy).

The pair is a **construction** before it is a reading: the before side runs on `$(git rev-parse
HEAD~1)`, in its own worktree and sandbox, and `/tmp/kbpulse-probe.mjs` (capture section) counts the
gate/queue cards by `data-src`. With `EXPECT_GATE_QUEUE=0` that probe is **red on the batched tree**
(2 cards) and green on the parent commit (0): two captures that both pass the same probe would be the
same picture and would prove nothing (finding 17 of `porte-spec.md`, decision D7).

| # | File (under `/tmp/kbpulse-shots/<side>/`) | State it must show |
|---|---|---|
| 1 | `panel-fr-todo.png` | panel, French, *To do*: the gate ask (amber, clock icon), the proposal (amber) and the seeded failed run (red cross, the card that already exists) |
| 2 | `panel-fr-results.png` | same page after pressing *Résultats*: the trial verdict card (green tick) — the only result of the seed |
| 3 | `panel-fr-dark.png` | state 1 under `prefers-color-scheme: dark` |
| 4 | `panel-en-todo.png` | state 1 in English (`?lang=en`): every new sentence has its English pair |
| 5 | `panel-narrow.png` | state 1 re-captured after the page is resized to 390 px: no horizontal overflow |

What is compared (the reading grid, applied to each pair):

1. **Card count per feed**: before 0 cards from gate/queue; after exactly 2 gate/queue cards on
   *To do* (the ask, the proposal) and 1 on *Résultats* (the verdict) — 3 in all, plus the scheduler
   card the seed already carried, which must look as it did before the batch. The count is asserted by
   `/tmp/kbpulse-probe.mjs` on `data-src` (`EXPECT_GATE_QUEUE=2`), not counted by eye; a fourth
   gate/queue card, or a missing one, is a failure.
2. **Kind → tone**: `waiting` reads amber (`--dsw-alias-state-warn-primary`), `failed` red, `done`
   green. Read on the icon disc of the card, not on a written word.
3. **Verbatim sub-lines** in the capture: *"Trial passed: your approval is due"*, *"A draft waits for
   you, nothing was sent · A draft message, ready to review"*, *"Supervised trial passed, no external
   effect · 2 calls"*, and on the scheduler card the engine's own words unchanged
   (*"Check run failed"* / *"No credit left"*). A truncation with `…` at the wrong place, or a mixed
   French/English line, fails.
4. **Hero line**: the seed holds three to-dos (the gate ask, the proposal, the failed run), so the hero
   reads *"3 things need you"* with the red tone (`hero()` takes `bad` from any `failed` to-do,
   `client.js:83`) — the same logic as before the batch, and the proof that an ask outranks a
   result in the big sentence.
5. **What must NOT change**: the wording and the count of the scheduler cards (compare 1 and 4 with
   the pre-batch captures of the same seeded run), the Settings › Widget page, and the empty state.

The comparison is read, not diffed: two PNGs of two different commits never match byte for byte
(fonts, timestamps, `ago()` strings). What is compared is the five points above, one capture at a
time, and the verdict is written down in the batch's report with the file names.

capture: the exact commands that produce the PNGs (never inside the tracked tree)

Frames first, then the captures. `scripts/garde-depot.mjs` treats a tracked `.png` as an error, so all
captures go to `/tmp`.

The seed comes first, and it is the same bytes on both sides (the before side copies these two feed
files from the after side's sandbox home): two gate records in `gates.json` (the ask, the verdict),
the two automation names they belong to in `tasks.json`, one proposal in the ledger, and the failed
scheduler run `check-pulse-live.mjs --seed` already writes.

```bash
source scripts/sandbox/env.sh
bash scripts/sandbox/stop.sh
node scripts/check-pulse-live.mjs --seed         # the scheduler failure card (point 5 of the grid)
node --input-type=module -e "$(cat <<'EOF'
import { mkdirSync, writeFileSync } from 'node:fs'
const home = process.env.DSH_HOME + '/kybernos'
const proof = (id) => ({ runId: 'run-' + id, gateId: 'gate:' + id, startedAt: '2026-10-28T00:00:00.000Z', endedAt: '2026-10-28T00:02:10.000Z',
  supervised: true, sideEffectFree: true,
  toolCalls: [{ toolName: 'bash', access: 'read', outcome: 'ok' }, { toolName: 'read', access: 'read', outcome: 'ok' }],
  outcome: { state: 'completed' }, externalEffects: [], errors: [] })
const gate = (id, status, extra) => ({ id: 'gate:' + id, automationId: id, status,
  staticChecks: { ranAt: '2026-10-28T00:00:00.000Z', verdict: 'pass', findings: [] },
  trial: proof(id), approval: { state: 'none', at: null }, updatedAt: '2026-10-28T00:03:00.000Z', rev: 1, ...extra })
const tasks = [
  { id: 'a1', name: 'Weekly price digest', active: false, history: [] },
  { id: 'a2', name: 'Read the supplier mails', active: false, history: [] }
]
const store = { version: 1, records: [
  gate('a1', 'awaiting-approval', { approval: { state: 'asked', at: null } }),
  gate('a2', 'trial-done')
] }
const entries = [{ id: 'i_demo1', title: 'Prepare a weekly price digest',
  evidence: { n: 3, span: '7 days', where: 'chat' }, risk: 'low', reversibility: 'easy',
  nextAction: { kind: 'draft', summary: 'A draft message, ready to review' },
  status: 'proposed', at: '2026-10-28T00:30:00.000Z' }]
mkdirSync(home, { recursive: true })
writeFileSync(home + '/tasks.json', JSON.stringify(tasks))
writeFileSync(home + '/gates.json', JSON.stringify(store))
writeFileSync(home + '/initiatives.json', JSON.stringify(entries))
console.log('seed: 2 names in tasks.json, 2 gate records in gates.json, 1 proposal')
EOF
)"
bash scripts/sandbox/start.sh
sleep 20                                      # one watcher pass is 15 s, the first one 3 s after boot
```

```bash
source scripts/sandbox/env.sh          # KB_HOST: the sandbox instance that loads the bundle
export KB_REPO="$(git rev-parse --show-toplevel)"
mkdir -p /tmp/kbpulse-shots
cat > /tmp/kbpulse-capture.mjs <<'EOF'
import { mkdirSync, writeFileSync } from 'node:fs'
const { openLivePage, waitFor } = await import(process.env.KB_REPO + '/scripts/live-page.mjs')
const DIR = process.env.KB_SHOTS_DIR || '/tmp/kbpulse-shots/after'
mkdirSync(DIR, { recursive: true })
const panel = 'http://' + process.env.KB_HOST + '/kybernos-pulse/panel'
const live = await openLivePage({ width: 390, height: 620 })
const shot = async (name) => {
  const r = await live.page.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(DIR + '/' + name + '.png', Buffer.from(r.result.data, 'base64'))
  console.log('captured ' + name + ' → ' + DIR + '/' + name + '.png')
}
const go = async (query) => {
  await live.page.send('Page.navigate', { url: panel + '?' + query })
  await waitFor(live.page, 'document.querySelector(\'[data-kb="pulse-window"]\') !== null', 20000)
}
// 1 — French, To do (the ask and the proposal)
await go('lang=fr')
await shot('panel-fr-todo')
// 2 — the Results filter, where the verdict and the failure live
await live.page.evalJs("document.querySelector('[data-act=\"filter\"][data-v=\"results\"]').click()")
await new Promise((r) => setTimeout(r, 800))
await shot('panel-fr-results')
// 3 — the same state, dark
await live.page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
await go('lang=fr')
await shot('panel-fr-dark')
// 4 — English pairs
await live.page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] })
await go('lang=en')
await shot('panel-en-todo')
// 5 — narrow: the same page at 390 px (overflow probe before the capture)
const over = await live.page.evalJs("(() => { const w = document.querySelector('[data-kb=\"pulse-window\"]'); return w ? { scroll: w.scrollWidth, client: w.clientWidth } : null })()")
if (!over.val || over.val.scroll > over.val.client) { console.error('the panel overflows at 390 px: ' + JSON.stringify(over.val)); process.exit(1) }
await shot('panel-narrow')
await live.close()
console.log('captures in ' + DIR)
EOF
KB_SHOTS_DIR=/tmp/kbpulse-shots/after node /tmp/kbpulse-capture.mjs
```

The script is written once and driven by `KB_SHOTS_DIR`: the **after** run above, then the **before**
run below, same file, no path typed twice. It is the same `openLivePage` (`scripts/live-page.mjs`) the
live checks use, so the capture of a `Document Picture-in-Picture` window is not attempted: the panel
page is captured (`GET /kybernos-pulse/panel`, the Mac menu-bar page that draws the same block).

The Settings page and the living window (regression of the surface that already exists):

```bash
node scripts/check-pulse-live.mjs --shots /tmp/kbpulse-shots/after
```

The **before** side is captured with the same script, on the **parent commit** (`HEAD~1`): `HEAD` is
the batch once the code exists, so a reviewer who arrives late would otherwise capture the batch
against itself. The probe is the red construction of the pair, and it is a command, not a promise:

```bash
source scripts/sandbox/env.sh
export KB_REPO="$(git rev-parse --show-toplevel)"
cat > /tmp/kbpulse-probe.mjs <<'EOF'
const expect = Number(process.env.EXPECT_GATE_QUEUE ?? '2')
const { openLivePage, waitFor } = await import(process.env.KB_REPO + '/scripts/live-page.mjs')
const live = await openLivePage({ width: 390, height: 620 })
let n = -1
try {
  await live.page.send('Page.navigate', { url: 'http://' + process.env.KB_HOST + '/kybernos-pulse/panel?lang=fr' })
  await waitFor(live.page, 'document.querySelector(\'[data-kb="pulse-window"]\') !== null', 20000)
  const r = await live.page.evalJs("[...document.querySelectorAll('[data-kb=\"pulse-card\"]')].filter((c) => c.dataset.src === 'gate' || c.dataset.src === 'queue').length")
  n = r !== null && r !== undefined && typeof r.val === 'number' ? r.val : -1
} finally { await live.close() }
if (n !== expect) { console.error('gate/queue cards: ' + n + ' (expected ' + expect + ')'); process.exit(1) }
console.log('gate/queue cards: ' + n + ' (expected ' + expect + ')')
EOF
EXPECT_GATE_QUEUE=2 node /tmp/kbpulse-probe.mjs     # after: 2 asks on *To do* (the gate ask + the proposal)
```

```bash
source scripts/sandbox/env.sh
export KB_REPO="$(git rev-parse --show-toplevel)"
AFTER_HOME="$DSH_HOME"                                    # the seeded sandbox home of the after side
BEFORE=/tmp/kbpulse-before
git worktree add "$BEFORE" "$(git rev-parse HEAD~1)"      # the PARENT commit, explicitly
(
  cd "$BEFORE" || exit 1
  bash scripts/sandbox/stop.sh
  source scripts/sandbox/env.sh
  mkdir -p "$DSH_HOME/kybernos/pulse"
  cp "$AFTER_HOME/kybernos/tasks.json" "$DSH_HOME/kybernos/tasks.json"
  cp "$AFTER_HOME/kybernos/gates.json" "$DSH_HOME/kybernos/gates.json"     # ignored by the parent commit, read by the batch
  cp "$AFTER_HOME/kybernos/initiatives.json" "$DSH_HOME/kybernos/initiatives.json"
  bash scripts/sandbox/start.sh
  sleep 20
  KB_REPO="$BEFORE" KB_SHOTS_DIR=/tmp/kbpulse-shots/before node /tmp/kbpulse-capture.mjs
  KB_REPO="$BEFORE" EXPECT_GATE_QUEUE=0 node /tmp/kbpulse-probe.mjs
  bash scripts/sandbox/stop.sh
)
git worktree remove "$BEFORE" --force
```

Expected, and this is the discriminating half of finding 17 of `porte-spec.md`: on the **parent
commit** the probe prints `gate/queue cards: 0 (expected 0)` and exits 0 (the cards carry no
`data-src`, the attribute does not exist yet); on the **batched tree** the same invocation with
`EXPECT_GATE_QUEUE=0` prints
`gate/queue cards: 2 (expected 0)` and exits 1. One side of the pair is red, so the two capture sets
cannot be the same picture. Both outputs are kept in the batch report.

maquette: a mockup of the panel's new cards at DSH's real CSS, fidelity `simple`, one real gesture and a verifier (no visible surface is delivered without it)

The batch has a visible surface: three new card variants in the Widget panel (in the floating window
and in the Mac menu-bar page, which draw from the same pure block). It is iterated on a mockup
**before** `client.js` is touched, because the real panel lives in a Document Picture-in-Picture
window that a headless browser cannot float and a person cannot screenshot reliably mid-change.

- **Where**: `/tmp/kbpulse-maquette/` (`index.html`, `tokens.css`, `maquette.json`, `verifier.mjs`,
  `README.md`), opened by double-click, no server. It stays outside the tracked tree on purpose: a
  tracked maquette folder would be a docs write outside this batch's write set (`packages/kybernos-pulse/*`
  only, cadrage invariant #4) and would need a write-set amendment, the way B5's maquette got one
  (decision D5). In `/tmp` nothing enters the tree, and `scripts/garde-depot.mjs` keeps seeing zero
  media. If the Lead wants it kept, it is moved as a one-item follow-up to
  `docs/handoff/kaby-proactive/pulse-maquette/` — a docs write, decided by the Lead, not by this
  batch. The consequence is stated instead of hidden: the folder is produced by the same
  implementation session that delivers the batch, and the run of its verifier (command + output) goes
  into the batch report.
- **CSS, pinned (finding 26 of `porte-spec.md`)**: no machine-local copy. `tokens.css` is **produced** by
  `verifier.mjs --tokens`, which opens the running GUI through `scripts/live-page.mjs` and reads
  `getComputedStyle(document.body)` for the nine `--dsw-alias-*` tokens `PANEL_CSS` (`client.js:148`)
  uses, writing `:root{--dsw-alias-x:#…}` with a header line naming the DSH version and the extraction
  date. `maquette.json` then **pins** the result — `{"tokens": {"sha256": "<64 hex>", "dsh": "<version>",
  "date": "2026-10-28"}}` — and `verifier.mjs --tokens --check` recomputes the hash, re-extracts, and
  exits 1 on a drift: a DSH upgrade cannot move the mockup under our feet, and nothing is read from
  `~/.dsh/skills/…` (a path that exists on one machine). No hex value and no `rgba()` in the page's own
  rules: only `var(--dsw-alias-*)` and the product font-family token. The card's own geometry follows
  `PANEL_CSS`, so the mockup and the product agree by construction.
- **Source of truth**: `donnees` — a seeded `pulse.json`-shaped JSON (the J1–J3 records), not invented
  copy.
- **Fidelity**: `simple`, declared in `maquette.json` (`"fidelite": "simple"`) and in its `README.md`,
  the two agreeing.
- **Regions**: the hero line, the card `waiting` (gate ask), the card `waiting` (proposal, titled by the
  entry), the card `done` (trial verdict with its muted second line), the card `failed` (unsafe proof).
- **One real gesture, deterministic, no timer**: *To do* ↔ *Résultats* re-filters the same list, and
  the ✕ on a card removes it from the DOM. A third gesture is not allowed (a mockup that plays a movie
  proves nothing).
- **Dark**: a pill toggles `data-ds-dark-theme` on `<body>`; no dark colour written by hand.
- **Responsive**: `@media (max-width: 480px)` — the panel is born narrow (380–390 px), the assertion
  is that nothing overflows and the two action buttons stay on the row.
- **Gate (finding 16 of `porte-spec.md`, decision D6)**: the mockup carries its own contract script,
  `verifier.mjs`, in the folder — `scripts/check-maquette.mjs` does not exist in this checkout
  (`ls scripts | grep maquette` is empty), so the same pattern as B5's maquette is written here. It
  opens `index.html` over `file://` through the CDP layer of `scripts/live-page.mjs` and **fails**
  on: a hardcoded colour
  (`#`, `rgb(`, `hsl()`) in the maquette's own `<style>`; a `font-size` outside the product ladder
  (11.5 / 12.5 / 13 / 14 px); a card without `data-src`; a `waiting` card whose icon colour is not
  `--dsw-alias-state-warn-primary` (read with `getComputedStyle`, not judged by eye); a gesture count
  of 0; *To do* → *Résultats* not changing the drawn list; the ✕ not removing its card; the dark pill
  not changing the panel's luminance by ≥ 0.25; a horizontal overflow > 1 px at 390 px; a French
  string in the English build or an English one in the French build. Every region declared in
  `maquette.json` must be present in the parsed HTML (the hand check it replaces, turned into
  assertions on `document.querySelector`).
- **Red construction**: `verifier.mjs --sabotage` re-injects one defect per control (a `#ff0000`, a
  `font-size:11px`, a card stripped of `data-src`, a dead *To do* tab, a dark pill that does nothing)
  and must **exit 1 with one failure per injected defect** — a verifier that cannot go red proves
  nothing (decision D6).

unit: the pure tests, added to `packages/kybernos-pulse/test-core.mjs`

Runner: `node packages/kybernos-pulse/test-core.mjs` (exit 0, `N checks passed`).
Discovery: `scripts/run-all-tests.mjs` runs every `packages/*/test*.mjs` with the package folder as
`cwd` (`discover()`, pattern `^test.*\.mjs$`), so `test-core.mjs` joins the suite with no registration;
`node scripts/run-all-tests.mjs --only kybernos-pulse` runs the six pulse files alone.

New sections, inserted **before** the final summary line (`test-core.mjs:185`), with the existing
assertions untouched (they are the proof that scheduler runs did not move):

| Section (`console.log`) | Assertions it must carry |
|---|---|
| `gate records` | the eight rows of the gate table: `failed`/`bad` for static fail, trial failed and an unsafe proof; `waiting`/`ask` for awaiting-approval and approved; `done` for trial-done and activated; `null` for `draft`, `static-passed`, `refused` |
| | the message of an unsafe proof names the first `externalEffects` entry; a static failure names the first `blocker`; a trial pass says "no external effect" and counts the calls |
| | `id` is `gate:<automationId>`; `source` is `gate`; an unknown `status` and a record with no `automationId` give `null`; a 2000-character finding message comes out ≤ 200 |
| `queue entries` | `proposed` → `waiting`, `source: 'queue'`, `task` = the entry title; `asked` → same; `added` and `dropped` → `null`; a title carrying `someone@example.com` comes out scrubbed; `nextAction.kind !== 'draft'` still yields the "nothing was sent" card (the queue refuses it, not Pulse) |
| `the muting rule` | `isQuiet` is false for a gate `waiting` and a gate `failed` even when `muted` holds the automation name; true for a gate `done` of that name; `unreadCount` ignores the quiet one and keeps the ask |
| `the proactive pass` | first pass (`baselined: false`): a `done`/`failed` record makes no item but fills `state.gates`; an ask makes one item with `bannered: true`; second pass: `added.length === 0` |
| | `awaiting-approval → approved` keeps one item (`inbox.length` unchanged) and its `code` follows; `trial-done` unsafe cancels the ask of the same automation (same id, one card) |
| | a queue entry going `dropped` removes its `q:` item; a queue entry re-appearing with the same `sig` adds nothing |
| | `GATE_ITEMS_PER_PASS`: 200 ask records → at most 40 items and `inbox.length <= INBOX_MAX`; `state.gates` stays under `SEEN_MAX` after 400 ids |
| | `watchStep` called with the old four keys only returns exactly the state the current tests expect: the fixture is **projected**, never hand-typed — `const project = ({ state, running, added }) => ({ state, running, added })`, then `deepStrictEqual(project(result), FIXTURE)` with `FIXTURE` holding only `{ state, running, added }`. The fixture therefore carries no `removed` key (finding 29 of `porte-spec.md`), and the additive key is stated separately: `deepStrictEqual(Object.keys(result).sort(), ['added', 'removed', 'running', 'state'])`. A stored fixture with the new key would be a fixture that only passes after the batch, which is the opposite of a regression check |
| `the inbox door` | `inboxAction(inbox, { action: 'approve', id })` and `{ action: 'activate' }` return `null`; the four known actions still work; `cleanItem` keeps `source` and defaults it to `scheduler`; `normalizeState` cleans `gates`/`queue` (bad key, bad sig, 500 ids) and an old file without those keys loads as `{}` |

Companion gates that must stay green, unchanged (they are not new tests, they are the regression net):

```bash
node packages/kybernos-pulse/test-host.mjs        # store, watcher on a real folder, routes
node packages/kybernos-pulse/test-client.mjs      # the 25 card/sentence assertions
node packages/kybernos-pulse/test-panel.mjs       # the shared block, standalone, plus its route
node packages/kybernos-pulse/test-helper.mjs
node packages/kybernos-pulse/test-write-guard.mjs
node scripts/test-no-french-literals.mjs          # kybernos-pulse is strict ([]): pairs only
node scripts/run-all-tests.mjs                    # the merge gate, 0 red
node scripts/garde-depot.mjs                      # no media, no personal path
```

DoD: five discriminating commands — each one FAILS on today's code and PASSES after the batch

Run from the repository root. A, B and C were executed against the pre-batch tree while this strategy
was written and their failing output is quoted below; D and E are red today for the plain reason that
nothing they name exists yet (`gatesFile` / `readGatesFile` / `readEntriesFile` in the bundle,
`verifier.mjs` in the mockup folder). A ends in `TypeError: core.gateItemFor is not a function`, B prints *"first pass added
0 items (expected 1: the ask only)"*, C prints the three wrong card texts — all with exit code 1.

**A — the mapping and the four guards of the data layer**

```bash
node --input-type=module -e "$(cat <<'EOF'
const core = await import('file://' + process.cwd() + '/packages/kybernos-pulse/pulse-core.mjs')
const now = Date.parse('2026-10-28T00:00:00Z')
const iso = (ms) => new Date(ms).toISOString()
const proof = { runId: 'run-1', gateId: 'gate:a1', startedAt: iso(now), endedAt: iso(now), supervised: true, sideEffectFree: true, toolCalls: [{ toolName: 'bash', access: 'read', outcome: 'ok' }], outcome: { state: 'completed' }, externalEffects: [], errors: [] }
const gate = { id: 'gate:a1', automationId: 'a1', status: 'awaiting-approval', staticChecks: { ranAt: iso(now), verdict: 'pass', findings: [] }, trial: proof, approval: { state: 'asked', at: null }, updatedAt: iso(now), rev: 4 }
const g = core.gateItemFor(gate, now, 'Weekly price digest')
const q = core.queueItemFor({ id: 'i_demo1', title: 'Prepare a weekly price digest', evidence: { n: 3, span: '7 days', where: 'chat' }, risk: 'low', reversibility: 'easy', nextAction: { kind: 'draft', summary: 'A draft message, ready to review' }, status: 'proposed', at: iso(now) }, now)
const problems = []
if (!g || g.kind !== 'waiting' || g.todo !== true || g.source !== 'gate' || g.code !== 'gate.awaiting-approval') problems.push('gate item: ' + JSON.stringify(g))
if (!q || q.kind !== 'waiting' || q.source !== 'queue' || q.task !== 'Prepare a weekly price digest') problems.push('queue item: ' + JSON.stringify(q))
if (core.isQuiet(g, { ...core.defaults(), muted: ['Weekly price digest'] }) !== false) problems.push('a waiting item was quieted by muted')
if (core.inboxAction([g], { action: 'approve', id: g.id }) !== null) problems.push('the inbox accepted an approve action')
if (core.gateItemFor({ ...gate, status: 'draft' }, now, 'x') !== null) problems.push('a draft made an item')
if (problems.length > 0) { console.error(problems.join('\n')); process.exit(1) }
console.log('DoD A ok')
EOF
)"
```

**B — the pass: first-pass baselining, idempotence, the approval transition, the caps, and the old call**

```bash
node --input-type=module -e "$(cat <<'EOF'
const core = await import('file://' + process.cwd() + '/packages/kybernos-pulse/pulse-core.mjs')
const now = Date.parse('2026-10-28T00:00:00Z')
const iso = (ms) => new Date(ms).toISOString()
const proof = (over) => ({ runId: 'run-1', gateId: 'gate:a1', startedAt: iso(now), endedAt: iso(now), supervised: true, sideEffectFree: true, toolCalls: [], outcome: { state: 'completed' }, externalEffects: [], errors: [], ...over })
const rec = (id, status, over) => ({ id: 'gate:' + id, automationId: id, status, staticChecks: { ranAt: iso(now), verdict: 'pass', findings: [] }, trial: proof({}), approval: { state: 'none', at: null }, updatedAt: iso(now), rev: 1, ...over })
const readRunOf = async () => null
const empty = () => ({ baselined: false, seen: {}, inbox: [] })
const problems = []
const r1 = await core.watchStep({ tasks: [], state: empty(), readRunOf, now, gates: [rec('a1', 'activated'), rec('a2', 'awaiting-approval')], entries: [] })
if (r1.added.length !== 1) problems.push('first pass added ' + r1.added.length + ' item(s) (expected 1: the ask only)')
if (r1.added[0] && r1.added[0].bannered !== true) problems.push('the first-pass ask was not silent')
const r2 = await core.watchStep({ tasks: [], state: r1.state, readRunOf, now: now + 20000, gates: [rec('a1', 'activated'), rec('a2', 'awaiting-approval')], entries: [] })
if (r2.added.length !== 0) problems.push('the second pass re-announced ' + r2.added.length + ' item(s)')
const r3 = await core.watchStep({ tasks: [], state: r2.state, readRunOf, now: now + 40000, gates: [rec('a1', 'activated'), rec('a2', 'approved', { rev: 2 })], entries: [] })
const kept = r3.state.inbox.filter((x) => x.id === 'g:a2')
if (kept.length !== 1 || kept[0].code !== 'gate.approved') problems.push('the approval transition did not replace the card: ' + JSON.stringify(kept))
const many = Array.from({ length: 200 }, (_, i) => rec('m' + i, 'awaiting-approval'))
const r4 = await core.watchStep({ tasks: [], state: empty(), readRunOf, now, gates: many, entries: [] })
if (r4.added.length > core.GATE_ITEMS_PER_PASS) problems.push('the pass emitted ' + r4.added.length + ' items over the cap ' + core.GATE_ITEMS_PER_PASS)
if (r4.state.inbox.length > core.INBOX_MAX) problems.push('the inbox is over INBOX_MAX')
const r5 = await core.watchStep({ tasks: [], state: empty(), readRunOf, now })
if (r5.added.length !== 0 || r5.state.inbox.length !== 0) problems.push('the behaviour without any feed changed')
if (problems.length > 0) { console.error(problems.join('\n')); process.exit(1) }
console.log('DoD B ok')
EOF
)"
```

**C — the cards: the ask, the proposal, the verdict, and the engine's own code untouched**

```bash
node --input-type=module -e "$(cat <<'EOF'
import { readFileSync } from 'node:fs'
import { extractCore } from './packages/kybernos-pulse/panel-page.mjs'
const core = extractCore(readFileSync('packages/kybernos-pulse/client.js', 'utf8'))
if (typeof core !== 'string') { console.error('no PANEL-CORE block'); process.exit(1) }
const block = new Function('window', core + '\nreturn { itemText }')({ __KB_LANG_RESOLVE__: () => 'en' })
const text = (it) => { try { return block.itemText(it) } catch (e) { return { title: '', sub: '' } } }
const problems = []
const wait = text({ kind: 'waiting', code: 'gate.awaiting-approval', source: 'gate', task: 'Weekly price digest' })
if (!/approval is due/i.test(wait.sub)) problems.push('gate ask card says: ' + JSON.stringify(wait))
const prop = text({ kind: 'waiting', code: 'queue.draft', source: 'queue', task: 'Prepare a weekly price digest', message: 'A draft message, ready to review' })
if (prop.title !== 'Prepare a weekly price digest') problems.push('proposal card title: ' + JSON.stringify(prop))
const done = text({ kind: 'done', code: 'gate.trial.passed', source: 'gate', task: 'Weekly price digest', calls: 4 })
if (!/supervised trial passed, no external effect/i.test(done.sub)) problems.push('trial card says: ' + JSON.stringify(done))
const old = text({ kind: 'failed', code: 'NO_CREDENTIAL' })
if (old.sub !== 'NO_CREDENTIAL') problems.push('an engine code no longer passes through: ' + JSON.stringify(old))
if (problems.length > 0) { console.error(problems.join('\n')); process.exit(1) }
console.log('DoD C ok')
EOF
)"
```

**D — the feeds: the gate store `gates.json`, the real ledger, and no invented seam or folder**

Structural half (the two paths and the forbidden shapes) plus the behavioural half that settles R1:
the store is the feed, and a `gate` carried by `tasks.json` alone yields nothing.

```bash
node --input-type=module -e "$(cat <<'EOF'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const problems = []
const src = readFileSync('packages/kybernos-pulse/index.js', 'utf8')
const iso = '2026-10-28T00:03:00.000Z'
const rec = (id, status) => ({ id: 'gate:' + id, automationId: id, status, staticChecks: { ranAt: iso, verdict: 'pass', findings: [] }, trial: null, approval: { state: 'none', at: null }, updatedAt: iso, rev: 1 })
if (!/gates\.json/.test(src)) problems.push('the gate store gates.json is not named in the host half')
if (!/initiatives\.json/.test(src)) problems.push('the ledger is not initiatives.json')
if (/Symbol\.for\(/.test(src)) problems.push('a globalThis seam is back (no batch publishes one)')
if (/automations\//.test(src)) problems.push('the invented kybernos/automations/ folder is back')
if (/gate-records\.json/.test(src)) problems.push('the invented gate file is back')
let core = null
try { core = await import('file://' + process.cwd() + '/packages/kybernos-pulse/index.js') } catch (e) { problems.push('the host half cannot be imported: ' + e.message) }
if (core !== null) {
  for (const n of ['gatesFile', 'readGatesFile', 'entriesFile', 'readEntriesFile', 'readProactiveFrom']) {
    if (typeof core[n] !== 'function') problems.push('no ' + n + ' export: that feed is still undefined')
  }
  if (typeof core.readProactiveFrom === 'function') {
    const home = mkdtempSync(join(tmpdir(), 'kp-dod-d-'))
    try {
      mkdirSync(join(home, 'kybernos'), { recursive: true })
      writeFileSync(join(home, 'kybernos', 'gates.json'), JSON.stringify({ version: 1, records: [rec('a1', 'awaiting-approval')] }))
      const one = await core.readProactiveFrom(home)()
      if (!one || !Array.isArray(one.gates) || one.gates.length !== 1) problems.push('gates.json is not read as records: ' + JSON.stringify(one))
      if (!one || !Array.isArray(one.entries) || one.entries.length !== 0) problems.push('the absent ledger is not []: ' + JSON.stringify(one))
      writeFileSync(join(home, 'kybernos', 'gates.json'), JSON.stringify([rec('a2', 'trial-done')]))
      const bare = await core.readProactiveFrom(home)()
      if (!bare || bare.gates.length !== 1) problems.push('a bare GateRecord[] is not tolerated: ' + JSON.stringify(bare))
      writeFileSync(join(home, 'kybernos', 'gates.json'), 'not json at all')
      writeFileSync(join(home, 'kybernos', 'tasks.json'), JSON.stringify([{ id: 'a3', name: 'Read the mails', active: false, history: [], gate: rec('a3', 'awaiting-approval') }]))
      const none = await core.readProactiveFrom(home)()
      if (!none || none.gates.length !== 0) problems.push('task.gate on tasks.json is read as a feed (that projection belongs to B5, not to us): ' + JSON.stringify(none))
    } catch (e) { problems.push('a reader threw instead of degrading: ' + e.message) } finally { rmSync(home, { recursive: true, force: true }) }
  }
}
if (problems.length > 0) { console.error(problems.join('\n')); process.exit(1) }
console.log('DoD D ok')
EOF
)"
```

Today it prints `no gatesFile export: …`, `no readGatesFile export: …` and `no entriesFile export: …`
and exits 1 (the two paths are not in the file either); after the batch it exits 0, and it goes red
again the day somebody reintroduces a seam, an invented file, or starts reading the `gate` field of
`tasks.json` as a feed.

**E — the mockup's contract, proven able to fail**

```bash
node /tmp/kbpulse-maquette/verifier.mjs                    # 0: regions, tokens, gestures, both themes, 390 px
node /tmp/kbpulse-maquette/verifier.mjs --tokens --check   # 0: tokens.css still matches the running GUI
node /tmp/kbpulse-maquette/verifier.mjs --sabotage         # 1: one failure per injected defect
```

Today both first commands end in `Cannot find module` (exit 1, the folder does not exist); after the
batch the first two exit 0 and `--sabotage` exits 1 with one failure per injected defect, which is what
makes E a proof instead of a claim (decision D6).

Passing bar, and what does NOT count as the DoD:

- all five print `DoD A ok` … `DoD E ok` (or the expected `--sabotage` red) with the exit codes above,
  **in one session, after the batch**, on the same machine where they failed before it (keep the two
  outputs in the report: the failing run and the passing run are the proof, not the claim);
- the before/after pair is asserted, not asserted by prose: `EXPECT_GATE_QUEUE=0 node
  /tmp/kbpulse-probe.mjs` exits 1 on the batched tree and 0 in the `HEAD~1` worktree, and
  `EXPECT_GATE_QUEUE=2` exits 0 on the batched tree;
- `node scripts/run-all-tests.mjs` at 0 red, `node scripts/garde-depot.mjs` clean,
  `node scripts/test-no-french-literals.mjs` clean, `scripts/check-pulse-live.mjs` 0 failed;
- explicitly **not** a DoD, because they already pass today: the six pulse test files green on their
  current assertions, `check-pulse-live.mjs` 0 failed, `boot-check.mjs`, `test-lifecycle-engine.mjs`,
  `test-paquet.mjs`, and any `grep` for a new identifier. Those prove "nothing broke"; the five
  commands above prove "the batch happened".
