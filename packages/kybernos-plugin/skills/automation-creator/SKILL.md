---
name: automation-creator
description: Creates a Kybernos automation from the conversation. Asks what should start it (a schedule, one date, or a webhook), what the team should do, and whether it may act without asking, shows the result for approval, then saves it where the Automations page and its scheduler read it. Use when the user wants something to run by itself, for example "every Monday at 8, summarise last week's pull requests".
whenToUse: The user asks for an automation, a recurring task, a scheduled run of the team, or something that must start when an outside service calls a URL.
---

# Automation creator

You create ONE automation per conversation, and you create it for real: an interview,
a draft the user approves, then a saved task. Never a mock-up, never invented data.
Talk to the user in their own language. Everything below is written in English because
it is read by you.

## 1. Interview

Ask at most two questions per turn, and only what is still missing, in this order:

1. **What starts it?** Three real options:
   - a **schedule**: "every Monday at 8", "weekdays at 9:30", "every 15 minutes";
   - **one date**: "on 15 December at 9";
   - a **webhook**: an outside service (Stripe, GitHub, a form) calls a URL made for
     this automation. A webhook can also be added to a schedule or a date.
2. **What should the team do each time?** Rewrite it as numbered steps, one action per
   line. If a step judges something, name who or what checks it.
3. **May it act without asking?** "Ask me first" (the default: the team asks before
   anything leaves the machine or changes something) or "always allow".

If the time zone matters (the user travels, or works for another zone), ask for it.
Otherwise it is the machine's own zone.

## 2. Draft and approve

Show: the name (short), what starts it in plain words, the numbered steps, the approval
mode. End with "Save it like this?" and wait for a clear yes. If the automation sends
something to someone, or spends money, say so in the draft and keep the approval on
"ask me first" unless the user explicitly chose otherwise.

## 3. Save

Do not edit the task file yourself and do not write it any other way: use the script
below. It checks the values, refuses to touch a task file it cannot read, takes the lock
the scheduler also takes (so two writers never overwrite each other), and writes
atomically (so the page and the scheduler never see half a file).

First write the specification to a temporary JSON file, for example
`/tmp/automation-spec.json`, with your file-writing tool, so no quoting can break it:

```json
{
  "name": "Weekly product report",
  "prompt": "1. Collect last week's merged pull requests\n2. Summarise them for the leadership team\n3. Post the summary in #product",
  "schedule": { "mode": "cron", "cron": "0 8 * * 1", "tz": "Europe/Paris" },
  "approvals": "ask",
  "notify": ["push"],
  "webhook": false
}
```

- `schedule.mode` is `cron` (with `cron`: five fields, minute hour day-of-month month
  day-of-week, digits only: `0 8 * * 1`, `30 9 * * 1-5`, `*/15 * * * *`), `once` (with
  `at`: `2026-12-15T09:00`, written in the zone of `tz`) or `webhook` (no cron, no date:
  it only runs when its URL is called).
- `tz` is an IANA name (`Europe/Paris`, `America/New_York`). Leave it out for the
  machine's zone.
- `approvals` is `ask` or `auto`. `ask` runs the session in a sandbox that asks before it
  leaves its workspace. It does NOT ask before a connected app acts (an email, a payment, a
  calendar change): that has to be written into the prompt. `notify` may hold `push` and
  `email`.
- `webhook: true` adds a webhook URL to a `cron` or `once` automation. A `webhook`
  schedule always has one.
- `prompt` is the numbered steps, at most 8000 characters. Never put a password, a key
  or a token in it.

Then run the script exactly as written (it reads the path you give as its argument):

```bash
node --input-type=module - /tmp/automation-spec.json <<'JS'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

let lockDir = null
const done = (code, payload) => {
  if (lockDir !== null) { try { fs.rmSync(lockDir, { recursive: true, force: true }) } catch (e) { /* a stale lock is broken after 20 s */ } }
  const line = JSON.stringify(payload) + '\n'
  try { fs.writeSync(1, line) } catch (e) { process.stdout.write(line) }
  process.exit(code)
}
const fail = (code, error) => done(code, { ok: false, error })

let spec
try { spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) } catch (e) { fail(2, 'the specification file is missing or is not JSON') }
if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) fail(2, 'the specification must be a JSON object')

// ---- the DSH home, as DSH resolves it: $DSH_HOME (trimmed, ~ expanded), else <home>/.dsh
const dshHome = () => {
  const raw = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : ''
  if (raw === '') return path.join(os.homedir(), '.dsh')
  if (raw === '~') return os.homedir()
  return raw.startsWith('~/') ? path.join(os.homedir(), raw.slice(2)) : raw
}

// ---- validation (the same rules as the scheduler)
const text = (v) => (typeof v === 'string' ? v : '')
const name = text(spec.name).trim()
const prompt = text(spec.prompt).trim()
if (name === '' || name.length > 120) fail(2, 'name: required, 120 characters at most')
if (prompt === '' || prompt.length > 8000) fail(2, 'prompt: required, 8000 characters at most')

const validZone = (z) => { try { new Intl.DateTimeFormat('en-US', { timeZone: z }); return typeof z === 'string' && z.length > 0 && z.length <= 64 } catch (e) { return false } }
const machineZone = () => { try { return new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch (e) { return 'UTC' } }
const sc = spec.schedule !== null && typeof spec.schedule === 'object' ? spec.schedule : {}
const mode = sc.mode
if (mode !== 'cron' && mode !== 'once' && mode !== 'webhook') fail(2, 'schedule.mode must be cron, once or webhook')
let tz = machineZone()
if (sc.tz !== undefined && sc.tz !== null && sc.tz !== '') { if (!validZone(sc.tz)) fail(2, 'schedule.tz: unknown time zone'); tz = sc.tz }

const cronOk = (expr) => {
  const parts = text(expr).trim().split(/\s+/)
  if (parts.length !== 5 || expr.length > 200) return false
  const bounds = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]]
  return parts.every((field, i) => /^[0-9*,/-]+$/.test(field) && field.split(',').every((piece) => {
    const m = /^(?:(\*)|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(piece)
    if (m === null) return false
    if (m[4] !== undefined && Number(m[4]) <= 0) return false
    if (m[1] === '*') return true
    const lo = Number(m[2]); const hi = m[3] !== undefined ? Number(m[3]) : lo
    return lo >= bounds[i][0] && hi <= bounds[i][1] && lo <= hi
  }))
}
const schedule = { mode, tz }
if (mode === 'cron') {
  if (!cronOk(sc.cron)) fail(2, 'schedule.cron: five fields of digits, *, lists, ranges and steps (for example "0 8 * * 1")')
  schedule.cron = text(sc.cron).trim().split(/\s+/).join(' ')
} else if (mode === 'once') {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(text(sc.at).trim())
  if (m === null) fail(2, 'schedule.at: YYYY-MM-DDTHH:MM, for example "2026-12-15T09:00"')
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])
  const d = new Date(ms)
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3] || d.getUTCHours() !== +m[4]) fail(2, 'schedule.at: that date does not exist')
  if (ms < Date.now() - 14 * 3600 * 1000) fail(2, 'schedule.at: that date is in the past')
  schedule.at = text(sc.at).trim()
}

const task = {
  id: 'st-' + Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex').slice(0, 6),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  history: [],
  lastRun: null,
  nextRun: null, // the scheduler computes it within about 30 seconds
  name,
  prompt,
  schedule,
  runsOn: 'local',
  active: true,
  approvals: spec.approvals === 'auto' ? 'auto' : 'ask',
  notify: Array.isArray(spec.notify) ? Array.from(new Set(spec.notify.filter((x) => x === 'push' || x === 'email'))) : [],
}
let hookUrl = null
if (mode === 'webhook' || spec.webhook === true) {
  const hookId = 'hk_' + crypto.randomBytes(6).toString('hex')
  const secret = crypto.randomBytes(16).toString('hex')
  task.trigger = { type: 'webhook', hookId, secret }
  hookUrl = 'http://127.0.0.1:' + (process.env.DSH_WEB_PORT || '3080') + '/kybernos/hooks?hook=' + hookId + '&secret=' + secret
}

// ---- the task file: a list, or nothing at all. Anything else is left exactly as it is.
const file = path.join(dshHome(), 'kybernos', 'tasks.json')
const read = () => {
  let raw = null
  try { raw = fs.readFileSync(file, 'utf8') } catch (e) {
    if (e && e.code === 'ENOENT') return { raw: null, tasks: [] }
    fail(3, 'tasks.json cannot be read: nothing was written')
  }
  let data
  try { data = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw) } catch (e) { fail(4, 'tasks.json is not valid JSON: it was left untouched. Tell the user; do not repair or replace it.') }
  if (!Array.isArray(data)) fail(4, 'tasks.json is not a list: it was left untouched. Tell the user; do not repair or replace it.')
  return { raw, tasks: data }
}

// One writer at a time: creating a directory is atomic, so tasks.json.lock is a lock any writer can take
// (the scheduler takes the same one). A lock older than 20 seconds is what a crash left behind.
fs.mkdirSync(path.dirname(file), { recursive: true })
const until = Date.now() + 3000
for (;;) {
  try { fs.mkdirSync(file + '.lock'); lockDir = file + '.lock'; break } catch (e) {
    if (!e || e.code !== 'EEXIST') fail(3, 'tasks.json cannot be locked: nothing was written')
    try { if (Date.now() - fs.statSync(file + '.lock').mtimeMs > 20000) { fs.rmSync(file + '.lock', { recursive: true, force: true }); continue } } catch (e2) { /* it just went away */ }
    if (Date.now() > until) fail(5, 'tasks.json is being written by another process: nothing was written, try again')
    await new Promise((resolve) => setTimeout(resolve, 25 + Math.floor(Math.random() * 35)))
  }
}

// Write a temporary file next to it (private), then rename it over the real one, so the page and
// the scheduler never see half a file. If a writer that ignores the lock wrote in between, start
// again from what is there now instead of overwriting it.
for (let attempt = 0; attempt < 5; attempt += 1) {
  const current = read()
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now().toString(36)
  fs.writeFileSync(tmp, JSON.stringify(current.tasks.concat([task]), null, 2), { mode: 0o600 })
  let now = null
  try { now = fs.readFileSync(file, 'utf8') } catch (e) { now = null }
  if (now !== current.raw) { fs.rmSync(tmp, { force: true }); continue }
  fs.renameSync(tmp, file)
  done(0, { ok: true, id: task.id, name, schedule, approvals: task.approvals, hookUrl })
}
fail(5, 'tasks.json kept changing: nothing was written, try again')
JS
```

The script prints one JSON line. `{"ok":true,...}` means saved. Anything else is a refusal
with its reason: fix the specification and run it again, except for "tasks.json is not
valid JSON" or "is not a list": then stop and tell the user their task file needs a look
(the scheduler keeps a copy of a damaged file next to it), and do not save anything.

## 4. Afterwards

Tell the user, in their language: the name, when it starts in plain words, and that the
Automations page shows it with its next run within about half a minute. If there is a
webhook URL, show it once and say that it contains a secret (anyone with the URL can
start the automation): it can be regenerated or revoked from the automation's page.
Do not run the automation yourself unless the user asks. Offer "Run now?" once, and do not
restart the interview.

## Guard rails

- One automation per run of the script. Several automations are several approved drafts.
- Never save an automation that sends or spends without the user's explicit approval of
  that, and keep `approvals` on `ask` unless they chose `auto`. Because `ask` does not stop a
  connected app, write "read-only: never send, create, change or delete anything" into the
  prompt of every automation that should only look.
- A schedule that fires every minute is almost never what someone means: confirm it.
- If a value cannot be validated (a zone you are unsure of, a date that may be in the
  past), ask instead of guessing.
