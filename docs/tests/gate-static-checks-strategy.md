# Test strategy — Batch B1 `gate-static-checks`

Executable strategy for `docs/dev/kaby-proactive/specs/gate-static-checks.md`. One command per line, all
run from the worktree root unless stated. `REPO` is never hard-coded:

```bash
REPO="$(git rev-parse --show-toplevel)"; echo "$REPO"
```

Index (the six markers, each at the start of its line):

e2e: five replayable journeys on the real module and the real `index.js` core, no mock anywhere (§1).
capture: two screenshots + two page-text snapshots, written outside the repo, before and after the batch (§2).
vision: the pair read with `read_image`, expected result is *no visible change* — a negative proof (§3).
maquette: No visible surface in this batch — reason and transfer of the obligation in §4.
unit: `node packages/kybernos-plugin/test-automation-gate.mjs`, ~130 assertions, plus its own falsification control (§5).
DoD: a command that fails today (`MODULE_NOT_FOUND` on the new test file) and passes after, plus the guards that only guard (§6).

---

## 1. End-to-end journeys (real mode)

e2e: J1 — the real `automation_suggest` payload (`automation-tools.mjs:75-80`) → `checkDraft` → verdict.
e2e: J2 — the six defect families the contract names, one table, exact codes.
e2e: J3 — the module imported from a foreign working directory, proving it is dependency-free.
e2e: J4 — cron/zone parity against the `KB-TASKS-CORE` block of `index.js` (the scheduler's own code).
e2e: J5 — twice the same draft gives byte-identical output and leaves `git status` untouched.

`e2e:` J1 — the element that the model actually sends. No stub: the payload is the shape
`automation-tools.mjs` builds from the tool arguments.

```bash
cd "$REPO/packages/kybernos-plugin" && node --input-type=module -e "
import { checkDraft } from './automation-gate.mjs'
const base = {
  name: 'Weekly inbox digest',
  prompt: '1. Read the unread Gmail threads of the week.\n2. Write a one-page digest as a draft reply.\n3. Ask before sending anything.',
  cron: '0 8 * * 1', timezone: 'Europe/Paris', needs: ['gmail'],
  proof: { n: 6, span: '30 days', where: 'Gmail / Inbox', note: 'same request' }
}
const withPrompt = (prompt) => Object.assign({}, base, { prompt })
const word = (r) => {
  const f = r.findings.find((x) => x.code === 'prompt.send.word')
  return f === undefined ? null : /names ([a-z']+)/.exec(f.message)[1]
}
const show = (label, r) => console.log(label, JSON.stringify({ verdict: r.verdict, codes: r.findings.map((f) => f.code), word: word(r) }))
show('as written', checkDraft(base))
show('send today', checkDraft(withPrompt('1. Read the unread Gmail threads of the week.\n2. Send the digest to the team.')))
show('sending only', checkDraft(withPrompt('Ask before sending anything.')))"
```

Expected output, exactly three lines:

```
as written {"verdict":"pass","codes":[],"word":null}
send today {"verdict":"pass","codes":["prompt.send.word"],"word":"send"}
sending only {"verdict":"pass","codes":[],"word":null}
```

Read off the tables of the spec (§3.1), token by token — no inflection is guessed anywhere:

- `as written`: no code at all. Its tokens are `read`, `unread`, `gmail`, `threads`, `week`, `write`,
  `one`, `page`, `digest`, `draft`, `reply`, `ask`, `before`, `sending`, `anything`. None is a table entry:
  `write` and `reply` are excluded on purpose (a draft reply *is* the safe gesture), and the tokenizer is
  stem-free, so `sending` is not `send` (D2, findings 12 and 13 — the earlier expectation of
  `["prompt.send.word"]` on this very line assumed a stem that does not exist). `needs: ['gmail']` covers
  the word `Gmail`, so no `needs.missing` either.
- `send today`: exactly one token of the new step, `send`, is a `GATE_SEND_WORDS` entry, so
  `prompt.send.word` fires with `{word} = 'send'`. `approvals` is absent, so it is `ask` (§3 of the spec):
  a warn, verdict `pass`.
- `sending only`: silent again. The pin is two-sided on purpose — an implementation that stems, or that
  adds `sending` to the table, reds this line instead of passing it.

`e2e:` J2 — the six families. One row per case, expected codes in the last column.

```bash
cd "$REPO/packages/kybernos-plugin" && node --input-type=module -e "
import { checkDraft } from './automation-gate.mjs'
const base = { name: 'N', prompt: 'Summarize the week.', schedule: { mode: 'cron', cron: '0 8 * * 1', tz: 'Europe/Paris' } }
const d = (patch) => Object.assign({}, base, patch)
const cases = [
  ['bad cron', d({ schedule: { mode: 'cron', cron: 'not a cron', tz: 'Europe/Paris' } })],
  ['every minute', d({ schedule: { mode: 'cron', cron: '* * * * *', tz: 'Europe/Paris' } })],
  ['unknown tz', d({ schedule: { mode: 'cron', cron: '0 8 * * 1', tz: 'Mars/Phobos' } })],
  ['needs missing', d({ prompt: 'Read my Gmail inbox each morning.' })],
  ['approvals auto', d({ approvals: 'auto' })],
  ['pay words, unattended', d({ prompt: 'Pay the invoice and delete the receipt.', approvals: 'auto' })]
]
for (const [label, draft] of cases) console.log(label.padEnd(22), checkDraft(draft).verdict, checkDraft(draft).findings.map((f) => f.code).join(' '))"
```

Expected output, line by line:

```
bad cron               fail schedule.cron.invalid
every minute           fail schedule.cron.too-frequent
unknown tz             fail schedule.tz.unknown
needs missing          pass needs.missing
approvals auto         pass approvals.auto
pay words, unattended  fail prompt.unattended approvals.auto prompt.delete.word prompt.pay.word
```

Order matters and is the contract's: blockers first (severity rank), then warns in `GATE_CODE_ORDER`, so
the last line starts with `prompt.unattended` and not with `approvals.auto`.

(`needs missing` passes with a warn: a missing connector is not a safety defect, it is a run that will
stop. `approvals auto` alone passes: `'auto'` is a legal product choice, §11.2 of the spec.)

`e2e:` J3 — dependency-freedom, from `/tmp` (no `node_modules` of the repo, no relative import):

```bash
cd /tmp && KB_GATE="$REPO/packages/kybernos-plugin/automation-gate.mjs" node --input-type=module -e "
const m = await import('file://' + process.env.KB_GATE)
console.log(Object.keys(m).sort().join(',')); console.log('verdict:', m.checkDraft(null).verdict)"
```

Expected: two lines — the sorted export list (starts `GATE_APPROVAL_STATES,GATE_APP_HINTS,GATE_CHECKS,…`
and contains `checkDraft,gateSummary,normalizeDraft`) and `verdict: fail`.

`e2e:` J4 — the copy against the scheduler. This is the journey that would catch a future engine change:

```bash
cd "$REPO/packages/kybernos-plugin" && node --input-type=module -e "
import { readFileSync } from 'node:fs'
import { gateParseCron, gateCronGapMinutes, gateCronCanFire, gateIsValidZone } from './automation-gate.mjs'
const m = readFileSync('./index.js', 'utf8').match(/\/\/ KB-TASKS-CORE-BEGIN([\s\S]*?)\/\/ KB-TASKS-CORE-END/)
if (m === null) { console.error('KB-TASKS-CORE block not found'); process.exit(1) }
const core = await import('data:text/javascript,' + encodeURIComponent(m[1] + '\nexport { kbParseCron, kbCronGapMinutes, kbCronCanFire, kbIsValidTimeZone }'))
const crons = ['0 8 * * 1', '*/5 * * * *', '*/4 * * * *', '* * * * *', '0 0 31 2 *', '0 8 * * 1-5', '@daily', '* * * *', '22-2 * * *', '5/2 * * * *']
let bad = 0
for (const c of crons) {
  const mine = gateParseCron(c), host = core.kbParseCron(c)
  if ((mine !== null) !== (host !== null)) { bad += 1; console.log('MISMATCH parse', c) }
  if (mine !== null && host !== null && gateCronGapMinutes(c) !== core.kbCronGapMinutes(c)) { bad += 1; console.log('MISMATCH gap', c) }
  if (gateCronCanFire(c) !== core.kbCronCanFire(c)) { bad += 1; console.log('MISMATCH canFire', c) }
}
const zones = ['Europe/Paris', 'europe/paris', 'UTC', 'Asia/Kolkata', 'Mars/Phobos', '', 'x'.repeat(65)]
for (const z of zones) if (gateIsValidZone(z) !== core.kbIsValidTimeZone(z)) { bad += 1; console.log('MISMATCH zone', z) }
console.log(bad === 0 ? 'parity ok on ' + crons.length + ' crons and ' + zones.length + ' zones' : bad + ' mismatches')
process.exit(bad === 0 ? 0 : 1)"
```

Expected: `parity ok on 10 crons and 7 zones`, exit 0.

`e2e:` J5 — determinism and zero side effects (a gate that writes is not a gate). The probe lives in
`/tmp`, never in the repo:

```bash
CAP=/tmp/kb-gate-static-checks; mkdir -p "$CAP"
cat > "$CAP/j5.mjs" <<'JS'
const m = await import('file://' + process.env.KB_GATE)
const draft = { name: 'N', prompt: 'Read then send the digest.', schedule: { mode: 'cron', cron: '*/4 * * * *' }, approvals: 'auto' }
console.log(JSON.stringify(m.checkDraft(draft)))
JS
cd "$REPO" && before="$(git status --porcelain)" \
  && a="$(KB_GATE="$REPO/packages/kybernos-plugin/automation-gate.mjs" node "$CAP/j5.mjs")" \
  && b="$(KB_GATE="$REPO/packages/kybernos-plugin/automation-gate.mjs" node "$CAP/j5.mjs")" \
  && after="$(git status --porcelain)" \
  && if [ "$a" = "$b" ] && [ "$before" = "$after" ]; then echo 'deterministic, no side effect'; else echo 'FAIL'; fi \
  && echo "$a" | cut -c1-160
```

Expected: `deterministic, no side effect`, then one JSON line starting
`{"verdict":"fail","findings":[{"code":"schedule.cron.too-frequent","severity":"blocker","field":"schedule.cron",`. Note `git status` is compared to itself on purpose: the batch's two new files are
untracked already, so the listing must be identical before and after the `.checkDraft` call.

## 2. Captures

capture: capture directory `CAP=/tmp/kb-gate-static-checks` — outside the worktree on purpose (the repo
takes no media, `AGENTS.md` rule 4 and `scripts/garde-depot.mjs`).
capture: the GUI must answer; a capture that could not be taken is reported as *not taken*, never faked.

```bash
CAP=/tmp/kb-gate-static-checks; mkdir -p "$CAP"
curl -s -o /dev/null -w 'gui:%{http_code}\n' http://127.0.0.1:3080/    # 401 is normal (no cookie); 000 = down
```

`capture:` the pair of PNGs plus the text snapshot (run once with `KB_PHASE=before`, once with
`KB_PHASE=after`; "after" means after both new `.mjs` files exist on disk):

```bash
CAP=/tmp/kb-gate-static-checks; cd "$REPO" && KB_PHASE=before node --input-type=module -e "
import { writeFile } from 'node:fs/promises'
import { openLivePage, clickText, waitFor } from './scripts/live-page.mjs'
const live = await openLivePage({ width: 1400, height: 900 }).catch((e) => { console.error('NOT TAKEN: ' + e.message); process.exit(3) })
const { page } = live
await clickText(page, 'Automations')
await waitFor(page, \"document.body.innerText.trim().length > 100\", 15000)
const t = await page.evalJs('document.body.innerText')
const body = String(t.val === undefined ? '' : t.val)
await writeFile('/tmp/kb-gate-static-checks/automations-' + process.env.KB_PHASE + '.txt', body)
await page.shot('/tmp/kb-gate-static-checks/automations-' + process.env.KB_PHASE + '.png')
await live.close()
console.log(process.env.KB_PHASE, body.length, 'chars')"
```

Exit 3 with `NOT TAKEN:` means the GUI or Chrome was unavailable: the vision block is then reported as
*not run*, never as passed. `clickText(page, 'Automations')` is the exact gesture
`scripts/check-automations-list-live.mjs:103` uses, so it is a known-good path on this machine.

Then the comparison, which is the machine part of the vision check:

```bash
CAP=/tmp/kb-gate-static-checks; diff -u "$CAP/automations-before.txt" "$CAP/automations-after.txt" && echo 'text identical'
ls -l "$CAP"/*.png
```

Expected: `text identical`, exit 0, and two PNGs of the same byte size class. A non-empty diff is a red
flag: it means either `client.js` changed (B5 landed early, §9.3 of the spec is violated) or a boot guard
broke. If `clickText(page,'Automations')` throws (the label is translated on this machine), the same
command is replayed on `/` without the click and the report says so; the check keeps its value because
the batch cannot change the sidebar either.

## 3. Vision

vision: both PNGs are opened with `read_image` — a capture nobody read is not a proof.
vision: the expected finding is **negative**: nothing new on the page, no gate panel, no findings list.
vision: read the *before* first, write down the row count and the section titles, then read *after* and
vision: compare those exact items; the verdict is "unchanged" or it names the difference and its cause.

vision: checklist, answered in writing in the batch report (4 lines):

1. Same sections and same number of automation rows in both images.
2. No new string: no "Static checks", no "Findings", no "Approve", no badge count anywhere in the shell.
3. No layout shift: the list's first row sits at the same position relative to the header (visually, on
   the shared width).
4. No error surface: no red banner, no "plugin failed" toast, no empty page (a bundle that stopped DSH
   from starting would show as a blank shell — the reason this batch has no registration at all).

vision: why this is enough here: the batch's only consumer is a later one (B5). The vision obligation for
the *gate panel itself* is B5's `automations-gate-ui`, and it is specified there (behaviour, both themes,
homogeneity, edge cases). A second mockup of a panel B1 does not draw would be a drawing of nothing.

## 4. Mockup

maquette: No visible surface in this batch.

maquette: reason: the write set is two new `.mjs` files under `packages/kybernos-plugin/`; no
`client.js`, no `shared-ui.css`, no `help.json`, no route, no tool definition, no i18n key is added or
edited. Nothing this batch produces is rendered, so there is no CSS state to mock at DSH's real
stylesheet, and no interactive surface to hand over.

maquette: transfer: the mockup obligation moves whole to batch B5 `automations-gate-ui`
(`packages/kybernos-plugin/client.js`), which owns the findings panel, the trial/proof display and the
two-step approval affordance. B5's spec must carry its own `maquette:` block with the real DSH tokens
(`shared-ui.css`, `kb6-title`, `kba-sub`) and an interactive HTML file.

maquette: the closest thing this batch could draw — a findings list — is deliberately not drawn: it
would fix a layout before the batch that owns the page has read the data, and a mockup that the real page
then contradicts is worse than no mockup.

## 5. Unit tests

unit: file `packages/kybernos-plugin/test-automation-gate.mjs` (NEW), plain Node, house idiom of
`test-automation-suggest.mjs`: `eq(label, got, want)` printing `ok`/`FAIL`, a final
`all checks passed (N checks)` or `N check(s) FAILED`, `process.exit(fails === 0 ? 0 : 1)`.
unit: runner: `node packages/kybernos-plugin/test-automation-gate.mjs` (cwd `packages/kybernos-plugin`
is also fine). It joins `node scripts/run-all-tests.mjs` automatically — the runner's
`/^test.*\.mjs$/` over `packages/*` picks it up, one job, `process.execPath`, no flag (§6 proves it by
count).

unit: block A — shapes and bounds (the "bounded finding" contract, asserted, not hoped):

- `Object.keys(finding)` equals `GATE_FINDING_KEYS` for every finding of a 12-draft corpus.
- Every finding and the result are `Object.isFrozen`.
- `GATE_FINDINGS_MAX === Object.keys(GATE_CHECKS).length` — the cap cannot bind.
- Every code matches `/^[a-z][a-z0-9]*(\.[a-z0-9-]+)+$/` and exists in `GATE_CHECKS`; the emitted
  `severity`/`field` equal the table's (a draft carrying `severity: 'info'` changes nothing).
- `message` ≤ 200 code points, `field` ≤ 80, no newline in either.
- one finding per code: a draft with 40 bad slugs yields exactly one `needs.unknown-app` mentioning `40`.
- the word tables are a strict subset of the engine's own, read from `index.js` and never from a copy of it:
  the set built from `readFileSync(new URL('./index.js', import.meta.url), 'utf8')` matched by
  `/const KB_MCP_WRITE_WORDS = new Set\(\[([\s\S]*?)\]\)/` then `/'[a-z]+'/g` must contain every entry of
  `GATE_SEND_WORDS`, `GATE_DELETE_WORDS` and `GATE_PAY_WORDS`. This is the parity test finding 12 asks for,
  and it is red on any table holding `sent` or `sending` — the engine has neither.

unit: block B — totality and determinism:

- 500 generated values (null, primitives, arrays, nested garbage, `{ schedule: 42 }`, deep objects) →
  never throws, always `{verdict, findings}`.
- a `Proxy` whose `get` throws → `fail` + `['gate.internal']`.
- the same draft twice → identical `JSON.stringify`; findings sorted by severity then `GATE_CODE_ORDER`.
- `checkDraft` called with a frozen draft does not throw and does not mutate it (`JSON.stringify` of the
  input unchanged).

unit: block C — cron, gaps, firing, zones, against the engine block (the parity of J4, in the suite):

- the 10-cron table of J4 plus a 300-expression generated corpus (`scripts/test-automation-creator-parity.mjs`
  vocabulary and seeded LCG, same idea) compared with `kbParseCron` and `kbCronGapMinutes`.
- `gateCronCanFire` vs `kbCronCanFire` on the same corpus, plus `0 0 29 2 *` (fires) and `0 0 30 2 *`
  (never) and `0 0 31 4 *` (never).
- `gateIsValidZone` vs `kbIsValidTimeZone` on 8 zones including `x`.repeat(65) and `' Europe/Paris'`.
- invalid cron → `gateCronGapMinutes` is `null`; `Infinity` when the cron parses but no two of its runs
  fall on the same day (`0 8 * * 1` is `Infinity`, as the real `kbCronGapMinutes` returns — measured).

unit: block D — the six contract families, one case each, with the exact expected `verdict` and codes:
bad cron; `*/4 * * * *` and `* * * * *` (and `*/5` as the passing boundary); `Mars/Phobos` (and
`Europe/Paris` passing); a prompt naming Gmail with no `needs`; `approvals: 'auto'` alone (passes, warn)
and with a send word (fails, `prompt.unattended`); `send`/`publish`, `delete`/`purge`, `pay`/`refund`
each in `ask` mode (warn only, verdict pass); and the stem-free pin of J1, asserted as its own pair —
`'Ask before sending anything.'` yields no code, `'Send the digest to the team.'` yields exactly
`prompt.send.word` with `{word}` = `send` (D2: exact token equality, no stemming).

unit: block E — the escalation matrix, 8 rows (`approvals` ask/auto × prompt clean/danger word ×
`tools` absent/write tool), asserted row by row so a future edit cannot silently downgrade a blocker. The
expected verdict is one rule: **`pass` unless `approvals === 'auto'` and at least one of (danger word,
write tool) is present**; the codes per row are `approvals.auto` when auto, `prompt.send.word` /
`tools.write-capable` whenever the cause is present, and `prompt.unattended` / `tools.unattended` on the
`fail` rows.

unit: block F — needs: absent, `[]`, `['gmail']`, `['Gmail']` (not a slug → `needs.unknown-app`),
7 entries (`needs.too-many`), a string instead of an array (`needs.invalid`), prompt naming an app that
`needs` covers (no finding), prompt naming two apps that `needs` misses (one finding, two slugs).

unit: block G — the gate record (invariant #1 through data): `approved`/`granted` → no finding;
`approved`/`none` and `activated`/`asked` → `gate.unapproved-activation`; `draft`/`none` → only the
`activation.pending-approval` info when the draft is `active: true`; an unknown status string → no
finding and no throw (B2 validates statuses, not B1).

unit: block H — no personal data in messages: a prompt containing a mail address, a French phone number
and two proper names produces findings whose concatenated messages match none of those strings (assert
`!msg.includes(...)` for each), and contain no substring longer than 24 characters taken from the prompt.

unit: block I — purity and "cannot activate", asserted on the module's own source with comments stripped:

```js
const src = readFileSync(new URL('./automation-gate.mjs', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1')
```
- no `import` statement, no `require(`, no `fetch(`, no `new Date(`, no `Date.now(`, no `Math.random(`,
  no `process.`, no `readFile`/`writeFile`.
- no `active = true`, no `status: 'activated'`, no `status: 'approved'` — the batch cannot activate.

unit: block J — **the falsification control**, which makes the whole file discriminating: the same case
table is replayed against two stubs, `const lax = () => ({ verdict: 'pass', findings: [] })` and
`const strict = () => ({ verdict: 'fail', findings: [{ code: 'gate.internal', severity: 'blocker', field: 'draft', message: 'x' }] })`.
The table must report **≥ 8 failures on `lax`** and **≥ 1 failure on `strict`**. A table that passes on a
stub proves nothing; this control is why the suite can be trusted when it goes green.

unit: expected size: ≥ 120 checks, under 3 s, no network, no temp file written (`mkdtemp` is not needed:
the module is pure and the engine block is imported through a `data:` URL).

## 6. Definition of done

DoD: `node packages/kybernos-plugin/test-automation-gate.mjs` — **today**: `Error: Cannot find module
'<REPO>/packages/kybernos-plugin/test-automation-gate.mjs'`, `code: 'MODULE_NOT_FOUND'`, exit 1 (measured on
this branch, 2026-10-28: Node 26.7.0 resolves the entry file through the CJS loader, so the code is
`MODULE_NOT_FOUND`, not `ERR_MODULE_NOT_FOUND`). **After**: `all checks passed (N checks)`, exit 0, `N >= 120`.
DoD: the same file is discriminating, not merely present: block J must print `falsification control: lax
fails 8+, strict fails 1+` — a partial implementation (cron-only, or a `pass`-everything stub) fails the
suite instead of passing it.

DoD: the single compound command, which fails today at the first step and passes after (exit 0):

```bash
sh -c 'node packages/kybernos-plugin/test-automation-gate.mjs && [ "$(node scripts/run-all-tests.mjs --list | grep -c "test-automation-gate.mjs")" -eq 1 ] && echo "DoD ok"'
```

Today: the first `node` exits 1 (`MODULE_NOT_FOUND`), so `DoD ok` is never printed. After: `all checks
passed`, then `1`, then `DoD ok`.

DoD: discovery is proven by count, never by `--only` alone: `node scripts/run-all-tests.mjs --only
automation-gate` with **zero** matching files also exits 0 (`0 test files … 0 RED`), so it would pass
today and is therefore *not* a DoD — it is only a fast way to watch the one file while working.

DoD: the merge-level gate stays the orchestrator's (cadrage, "final integration gate"):
`node scripts/run-all-tests.mjs` must end `0 RED`, and this batch must not add a red line to it.

DoD: these three guards pass today *by design* — they are non-regression, not DoD, and the report must
label them as such:

```bash
git diff --name-only -- packages/kybernos-plugin/index.js packages/kybernos-plugin/client.js \
  packages/kybernos-plugin/automation-tools.mjs packages/kybernos-pulse | wc -l    # 0: write sets respected
node scripts/garde-depot.mjs                                                          # exit 0 (tracked tree only)
node --input-type=module -e "
import { readFileSync } from 'node:fs'
import { warningsOf } from './scripts/garde-depot.mjs'
for (const f of ['packages/kybernos-plugin/automation-gate.mjs','packages/kybernos-plugin/test-automation-gate.mjs',
  'docs/dev/kaby-proactive/specs/gate-static-checks.md','docs/tests/gate-static-checks-strategy.md']) {
  try { console.log(f, JSON.stringify(warningsOf(f, readFileSync(f, 'utf8')))) } catch (e) { console.log(f, 'missing') }
}"                                                                                    # each line ends with []
git status --porcelain --untracked-files=all | grep -E 'automation-gate|gate-static-checks' | wc -l   # 4: two .mjs, two docs
```

The middle command exists because `garde-depot.mjs` enumerates `git ls-files`: a new, untracked file is
invisible to it, so the four files of this batch are scanned directly with the guard's own exported
`warningsOf`. Measured on 2026-10-28: the two docs answer `[]` while the two `.mjs` answer `missing`.

The last one is filtered on purpose: four sibling batches write in the same worktree (six specs, six
strategies), so a global count would be red for a reason that is not this batch. Four of *these* names is
the whole claim; a fifth line means this batch wrote something it does not own.

DoD: what is **not** required, and must not be claimed: a live GUI pass (no visible surface, §4), a
`check-*-live.mjs` run (no route, no client), an i18n audit (no key), a dark-theme capture of a panel
that does not exist yet.
