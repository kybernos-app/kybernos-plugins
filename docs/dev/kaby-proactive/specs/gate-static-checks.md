# Spec — Batch B1 `gate-static-checks`

Pure static certification of an automation draft: cron validity and frequency, IANA time zone,
connector/app needs, permissions, side-effect words in the prompt and in the tool set.

- Branch `feature/kaby-proactive-lot1` (worktree `kybernos-plugins-proactive`), stage `spec` of the kyber
  `dev-team`, 2026-10-28.
- Inputs: `docs/dev/kaby-proactive/cartographie.md` (mapping + anchors) and
  `docs/dev/kaby-proactive/cadrage.md` (frozen shapes, invariants, batch contract). This document does
  not change either: it fills B1's two files with an implementable contract.
- Test strategy: `docs/tests/gate-static-checks-strategy.md` (the six markers: e2e, vision, capture,
  maquette, unit, DoD).

## 1. Goal

One dependency-free module that answers, for an automation draft and nothing else:
**may this draft be certified, and what exactly is wrong with it?**

`packages/kybernos-plugin/automation-gate.mjs` (NEW) takes a draft — the object the model writes through
`automation_suggest`, the form posts, or a published definition carries — and returns a bounded,
deterministic verdict: `{ verdict: 'pass' | 'fail', findings: GateFinding[] }`. Every finding has a stable
machine `code`, a `severity` taken from a frozen table (never from the input), the dotted `field` of the
draft it is about, and one line of English that never quotes the draft.

What it is *not*: it does not run anything, store anything, read a file, open a socket, or decide
activation. It is the cheap, total, side-effect-free first gate that every later batch imports —
B2 builds the proof report beside it, B3 routes it, B5 draws it.

## 2. Why the copy is legitimate (reference semantics, read-only anchors)

The module may not import `index.js` (the plugin entry, executed for its side effects, with no exports)
and may not import anything at all, so the scheduler rules it must agree with are **copied**, and the copy
is pinned by a parity test against the real scheduler (see the strategy's `unit:` section). Each anchor was
read for this spec; **none is edited by this batch**:

| Anchor | What it gives the gate |
|---|---|
| `packages/kybernos-plugin/index.js:188` / `:825` | The `KB-TASKS-CORE` block, extracted by the parity test to compare cron/zone behaviour |
| `index.js:228` `kbIsValidTimeZone` | Zone = a string of 1..64 characters that `Intl.DateTimeFormat` accepts |
| `index.js:280` `kbParseCronField`, `:300` `kbParseCron` | Five fields, digits + `* , - /` only, `a-b/n`, `a/n`, no names, no `L`/`#`; DOW 0-7; a field starting with `*` is unrestricted |
| `index.js:361` `kbCronCanFire` | A cron that never fires is refused, not stored asleep (8-year window from 2024-01-01) |
| `index.js:364` `KB_FREQUENT_MINUTES = 5`, `:365` `kbCronGapMinutes`, `:383` | Gap `>= 5` passes; a confirmed schedule is not asked again |
| `index.js:420` `kbSanitizeTaskInput`, `:449` | `approvals: 'auto'` only for an explicit `'auto'`, anything else is `'ask'`; `active: r.active !== false` |
| `index.js:460` | `needs` = unique strings matching `^[a-z0-9_-]{2,40}$`, first 6 kept |
| `index.js:765` `KB_MCP_WRITE_WORDS`, `:778` `kbIsReadName`, `:806` `kbMcpGate` | The engine's own write vocabulary; the gate's word tables are a strict **subset** of it (§3.1 lists them in full) |
| `automation-tools.mjs:48-85` (payload at `:75-80`) | The real draft shape the model produces: `{ name, prompt, cron, timezone?, needs?, proof? }` |
| `automation-suggest.mjs:7,24-46` | `SUGGESTED_MAX = 8`; a suggested task is stored `active: false`, `acceptedTask` keeps it off |
| `automation-settings.mjs:22` | `STABLE_CHOICES` — the page's own bound style (frozen choice lists, not free numbers) |
| `automation-published.mjs:49-52` | `approval_path_missing`: a published `'ask'` automation needs a machine that can ask |
| `automation-load.mjs:18-30` | The house style for named, frozen threshold constants with a stated reason |
| `skills/automation-creator/SKILL.md:140,148,162,195,211` | The skill's own `validZone`/`cronOk`/`gapOf`/`needsYes`/`approvals` — the second copy the gate must not contradict |

Consequence, stated as an invariant for the implementer: **the gate may refuse a draft the route would
accept (an advisory warn), it may never accept a draft the scheduler would silently break** — a cron the
scheduler cannot parse, a zone `Intl` refuses, or a sub-5-minute schedule presented as confirmed.

## 3. Public API (exact)

`packages/kybernos-plugin/automation-gate.mjs`, ESM, no imports, no `require`, no `fs`, no `net`, no
`fetch`, no `Date`, no `Math.random`, no `process.env`.

```js
/** A draft (tool payload or task-shaped) → the canonical draft, or null when it is not an object. Never throws. */
export const normalizeDraft = (raw) => NormalizedDraft | null

/** The checks. Never throws. `options` is optional. */
export const checkDraft = (draft, options = {}) => ({ verdict, findings })

/** Counts for a badge (B5/B6). Severity is looked up by code; an unknown code counts as info. */
export const gateSummary = (findings) => ({ blockers, warnings, infos, total })
```

```ts
interface CheckOptions { nowMs?: number; gate?: GateRecord | null }

interface NormalizedDraft {
  name: string            // trimmed, control characters dropped, NOT truncated (bounds are findings)
  prompt: string          // same
  schedule: { mode: 'cron' | 'once' | 'webhook', tz?: string, cron?: string, at?: string } | null
  needs: string[] | null  // null when absent (not [])
  tools: string[] | null
  approvals: string       // 'ask' when absent or unknown (index.js:449)
  active: boolean         // true only when the draft says exactly true
  confirmFrequent: boolean
}

interface CheckResult {
  verdict: 'pass' | 'fail'   // 'fail' iff at least one 'blocker'
  findings: GateFinding[]    // frozen, deterministic order, at most GATE_FINDINGS_MAX
}
```

Behavioural contract:

1. **Totality.** For any input at all (null, a string, an array, a Proxy that throws on access, a 10 MB
   object) `checkDraft` returns a valid `CheckResult`. Any internal exception is caught and becomes the
   single blocker `gate.internal` — **fail closed, never fail open**.
2. **No aliasing.** `findings` and every finding are frozen (`Object.freeze`), and the result is a fresh
   object on every call: a caller cannot mutate a verdict into a pass.
3. **Determinism.** Same draft, same options → byte-identical JSON. No clock, no randomness, no locale
   dependence. `nowMs` is only read when it is an integer; without it, no past-date check runs (documented
   below, this is the only check that needs a clock).
4. **One finding per code.** A draft with fifty bad slugs yields one `needs.unknown-app`, with a count in
   its message. Total findings ≤ number of declared codes, so output size does not depend on input size.
5. **Severity and field come from the table**, never from the input: a draft carrying
   `severity: 'info'`, `findings: [...]`, `verdict: 'pass'` or `gate` keys it did not earn changes nothing.
6. **No draft text is echoed.** A message may contain: an integer, a word from a frozen table
   (`send`/`delete`/`pay` families, app hints), or a slug matching `^[a-z0-9_-]{2,40}$`. It never contains
   a phrase of the prompt, a name, an address or a number from the draft.

### 3.1 Frozen constants

| Constant | Value | Why |
|---|---|---|
| `GATE_VERDICTS` | `['pass','fail']` | closed vocabulary for B2/B3/B5 |
| `GATE_SEVERITIES` | `['blocker','warn','info']` | cadrage's `Severity` |
| `GATE_STATUSES` | `['draft','static-failed','static-passed','trial-done','awaiting-approval','approved','refused','activated']` | cadrage's `GateStatus`, frozen here so B2 normalizes against it |
| `GATE_APPROVAL_STATES` | `['none','asked','granted','refused']` | cadrage's `GateRecord.approval.state` |
| `GATE_FINDING_KEYS` | `['code','severity','field','message']` | exactly cadrage's `GateFinding`, in order |
| `GATE_RECORD_KEYS` | `['id','automationId','status','staticChecks','trial','approval','updatedAt','rev']` | cadrage's `GateRecord`: B2 normalizes against this list, B1 only publishes it |
| `GATE_CHECKS` | frozen map `code → { severity, field }` | the single source of truth; severity is never input |
| `GATE_CODE_ORDER` | frozen array of the codes, in catalogue order (blockers, then warns, then infos) | the deterministic sort: severity rank first, then this index |
| `GATE_FINDINGS_MAX` | `Object.keys(GATE_CHECKS).length` (33) | the cap is **provably non-binding**: one finding per code. A test asserts the equality, so truncation can never silently drop a blocker |
| `GATE_NAME_MAX` | `120` | `automation_suggest`'s name description |
| `GATE_PROMPT_MAX` | `8000` | same tool's prompt description |
| `GATE_NEEDS_MAX` | `6` | `index.js:460` |
| `GATE_TOOLS_MAX` | `32` | forward-looking bound on an optional field |
| `GATE_TZ_MAX` | `64` | `index.js:228` |
| `GATE_CRON_MAX` | `200` | `kbParseCron` |
| `GATE_FREQUENT_MINUTES` | `5` | `KB_FREQUENT_MINUTES` |
| `GATE_MESSAGE_MAX` | `200` | cadrage's "English, one line" |
| `GATE_FIELD_MAX` | `80` | a dotted path, bounded |
| `GATE_SEND_WORDS`, `GATE_DELETE_WORDS`, `GATE_PAY_WORDS` | frozen `Set`s, listed entry by entry just below | strict **subset** of `KB_MCP_WRITE_WORDS` (`index.js:765`); the unit suite asserts the membership word by word |
| `GATE_APP_HINTS` | frozen map `composioSlug → hint words` | 8 slugs: `gmail`, `googlecalendar`, `googledrive`, `slack`, `notion`, `stripe`, `hubspot`, `airtable` — advisory only |

The three tables are listed in full, in declaration order, because the tokenizer is **stem-free** and the
tables are the whole vocabulary (D2 — a prompt token is compared to a table entry as a string, whole-token
equality only, no prefix and no inflection):

```js
const GATE_SEND_WORDS   = new Set(['send', 'publish', 'submit', 'post', 'forward', 'share', 'invite', 'upload'])
const GATE_DELETE_WORDS = new Set(['delete', 'remove', 'trash', 'purge', 'empty', 'revoke'])
const GATE_PAY_WORDS    = new Set(['pay', 'charge', 'refund', 'buy', 'sell', 'transfer', 'void'])
```

Every entry above is a member of `KB_MCP_WRITE_WORDS`, so the subset assertion (unit block A of the
strategy) passes by construction, and no table may gain a word outside it: `sent`, `sending`, `paid` and
`deleted` are **not** in `KB_MCP_WRITE_WORDS` and are therefore not gate words. `gateWords('sending the
digest')` yields the token `sending`, which names nothing — a draft that says `send` is caught, its
inflections are not, and the engine's own name gate (`index.js:778`) reads tool names the same way.

Inflection is not the only exclusion. Words the product treats as a read or as a formatting token stay out:
`run`, `set`, `add`, `start`, `stop`, `type`, `click`, `format`, `evaluate`, `order`, `report`, `mark`,
`check` (a gate whose warn fires on "in order to" is a gate people learn to ignore). Two write words are
excluded on purpose: `write` and `reply` — writing a *draft reply* is exactly the gesture the gate
recommends (§4.1 messages), so warning on it would punish the safe draft. `draft` is in no table either.

## 4. Check catalogue

`checkDraft` runs the checks in `GATE_CODE_ORDER`. Codes are stable: a client greps them, a test asserts
them, a translation table keys on them. `field` is a dotted path of the draft; `''` never appears —
`draft` names the whole object.

### 4.1 Blockers (any one → `verdict: 'fail'`)

| Code | Field | Fires when | Message |
|---|---|---|---|
| `draft.unreadable` | `draft` | the draft is not a plain object | `the draft is not an object: nothing can be certified.` |
| `gate.internal` | `draft` | a check threw (guarded, fail-closed) | `the checks could not complete: this draft is not certified.` |
| `name.missing` | `name` | `name` is empty after trim | `name is empty: the automation would have no title.` |
| `name.too-long` | `name` | `name` > 120 characters | `name is longer than 120 characters.` |
| `prompt.missing` | `prompt` | `prompt` is empty after trim | `prompt is empty: the run would have no steps.` |
| `prompt.too-long` | `prompt` | `prompt` > 8000 characters | `prompt is longer than 8000 characters.` |
| `schedule.missing` | `schedule` | no `schedule`, and no `cron` in the flat tool form either | `the draft has no schedule: a cron, a one-off date or a webhook is needed.` |
| `schedule.mode` | `schedule.mode` | mode is not `cron`/`once`/`webhook` | `schedule.mode must be one of cron, once, webhook.` |
| `schedule.cron.invalid` | `schedule.cron` | mode `cron` and the cron is not parseable | `the cron is not five fields of digits, *, lists, ranges and steps.` |
| `schedule.cron.never-fires` | `schedule.cron` | parseable, no matching calendar date in the 8-year window | `that cron never fires: no date in the next eight years matches it.` |
| `schedule.cron.too-frequent` | `schedule.cron` | shortest gap < 5 min and `confirmFrequent !== true` | `the shortest gap between two runs is {n} minute(s): below 5, every run starts a model session and needs the person's confirmation.` |
| `schedule.tz.unknown` | `schedule.tz` | `tz` is a non-empty string `Intl` refuses, or longer than 64 | `that time zone is not an IANA zone name.` |
| `schedule.at.invalid` | `schedule.at` | mode `once` and `at` is not `YYYY-MM-DDTHH:MM` on a real date | `a one-off date is YYYY-MM-DDTHH:MM, on a date that exists.` |
| `schedule.at.past` | `schedule.at` | mode `once`, a valid `at`, and `options.nowMs` is an integer that it is before | `that one-off date is in the past: it would never run.` |
| `prompt.unattended` | `prompt` | a send/delete/pay word in the prompt **and** `approvals === 'auto'` | `the prompt names {word} and approvals is 'auto': the run would act without asking. Write the step as a draft the person sends.` |
| `tools.unattended` | `tools` | a write-capable tool in `tools` **and** `approvals === 'auto'` | `the tool {tool} can change something outside the session and approvals is 'auto': the run would act without asking.` |
| `gate.unapproved-activation` | `gate` | `options.gate.status` is `approved` or `activated` and `options.gate.approval.state !== 'granted'` | `the gate record is {status} with no recorded human approval: activation only follows approval.state 'granted'.` |

### 4.2 Warnings (verdict stays `pass` when there is no blocker)

| Code | Field | Fires when | Message |
|---|---|---|---|
| `approvals.auto` | `approvals` | `approvals === 'auto'` | `approvals is 'auto': no run pauses for the person. Acceptable only for read-only work.` |
| `approvals.unknown` | `approvals` | a value that is neither `ask` nor `auto` | `approvals is neither 'ask' nor 'auto': the route stores 'ask'.` |
| `prompt.send.word` | `prompt` | a word of `GATE_SEND_WORDS` (first in table order) | `the prompt names {word}: an automation prepares and asks, it does not send or publish by itself.` |
| `prompt.delete.word` | `prompt` | a word of `GATE_DELETE_WORDS` | `the prompt names {word}: deleting is irreversible and stays the person's gesture.` |
| `prompt.pay.word` | `prompt` | a word of `GATE_PAY_WORDS` | `the prompt names {word}: money never leaves on a schedule.` |
| `tools.write-capable` | `tools` | one of `tools` tokenizes to a write word (first such tool) | `the tool {tool} can change something outside the session: its steps must prepare drafts.` |
| `needs.invalid` | `needs` | `needs` is present and not an array | `needs must be an array of Composio toolkit slugs.` |
| `needs.unknown-app` | `needs` | one or more entries do not match `^[a-z0-9_-]{2,40}$` | `{n} toolkit slug(s) are not slugs (2 to 40 characters of a-z, 0-9, _ or -): the route drops them.` |
| `needs.too-many` | `needs` | more than 6 entries | `needs lists more than 6 toolkits: the route keeps the first 6.` |
| `needs.missing` | `needs` | an app hint word is in the prompt and no `needs` slug covers that app (at most 2 apps named) | `the prompt names {apps} and needs does not list it: the run would look for a connector it was not given.` |
| `schedule.cron.frequent-confirmed` | `schedule.cron` | shortest gap < 5 min and `confirmFrequent === true` | `this runs every {n} minute(s), and the person confirmed it: every run starts a model session.` |

### 4.2.1 Message placeholders

A template has at most two placeholders, each resolved from a frozen, bounded value — never from the
draft's text:

- `{n}` — a non-negative integer.
- `{word}` — the **first** entry of the frozen table that a prompt token equals exactly, in the declaration
  order of §3.1 (so the answer is stable across calls and across implementations). Whole-token equality
  only: `send` matches `send`, never `sending`, `sent` or `sender`.
- `{apps}` — up to 2 slugs of `GATE_APP_HINTS`, joined by `, `.
- `{slug}`, `{tool}` — a value already matching `^[a-z0-9_.-]{1,80}$`; anything else is replaced by
  `a connector` / `a tool`.
- `{status}` — one of `GATE_STATUSES`.

After substitution the message is bounded: `Array.from(msg).slice(0, GATE_MESSAGE_MAX).join('')` (code
points, so a multi-byte character is never cut in half).

### 4.3 Informations

| Code | Field | Fires when | Message |
|---|---|---|---|
| `schedule.tz.machine` | `schedule.tz` | mode is `cron`/`once` and `tz` is absent or `''` | `no time zone: the machine's own is used, which is not the same on a laptop and on a cloud computer.` |
| `schedule.cron.ignored` | `schedule.cron` | mode `webhook` and a `cron` is present | `a cron is present and schedule.mode is webhook: the cron is never used.` |
| `schedule.cron.defaulted` | `schedule.cron` | mode `cron` and no `cron` at all | `no cron: the route stores every day at 8, which may not be the hour the person meant.` |
| `activation.pending-approval` | `active` | `active === true` and (no `options.gate` or `approval.state !== 'granted'`) | `the draft is switched on; nothing here activates it: the flip follows a granted approval on the gate record.` |
| `needs.write-capable` | `needs` | a `needs` slug has a write-capable hint (e.g. `stripe`) | `the connector {slug} can change something outside the session: its steps must prepare drafts.` |

`activation.pending-approval` is this batch's only trace of invariant #1, and it is deliberately an
**info**: the gate observes the flag, it never interprets it as permission, and it never writes it.

### 4.4 Frequency, worked examples (also the test table)

| cron | gap (min) | finding |
|---|---|---|
| `0 8 * * 1` | ∞ (one run a week: no gap inside a day) | — |
| `*/5 * * * *` | 5 | — (the boundary passes: `index.js:383` uses `>=`) |
| `*/4 * * * *` | 4 | `schedule.cron.too-frequent` |
| `* * * * *` | 1 | `schedule.cron.too-frequent` |
| `0,2 8 * * *` | 2 | `schedule.cron.too-frequent` |
| `0 0 31 2 *` | ∞ | `schedule.cron.never-fires` (checked **before** the frequency) |
| `5/2 * * * *` | 2 | `schedule.cron.too-frequent` (`a/n` = from `a` to the max) |
| `22-2 * * *` | — | `schedule.cron.invalid` (`lo > hi` is not a wrap, as in `index.js:280`) |
| `0 8 * * 1` + `confirmFrequent: true` | — | — (nothing asked) |
| `*/4 * * * *` + `confirmFrequent: true` | 4 | `schedule.cron.frequent-confirmed` (warn) |

Those six values (`∞, 5, 4, 1, 2, 2`) were read from the real `kbCronGapMinutes` in this worktree, so the
implementer copies an observed behaviour, not a remembered one.

## 5. Data shapes — what B1 owns and what it does not

B1 consumes cadrage's frozen shapes and adds **constants only**:

- `GateFinding` — B1 produces it (`GATE_FINDING_KEYS`, frozen instances, bounded strings).
- `GateRecord` / `GateStatus` — B1 exports `GATE_STATUSES`, `GATE_APPROVAL_STATES`, `GATE_RECORD_KEYS`
  (`['id','automationId','status','staticChecks','trial','approval','updatedAt','rev']`) so B2 normalizes
  against one vocabulary. **B1 does not build, normalize, timestamp or persist a record** — no
  `ranAt`, no `rev`, no `staticChecks` assembly. `checkDraft` returns the checks' verdict; the caller
  stamps and stores it.
- `ProofReport` / `InitiativeEntry` — untouched, no key, no reference.

`staticChecks` assembly for B2/B3, for reference only (not implemented here):
`{ ranAt: <caller's ISO>, verdict, findings }` — `ranAt` is *the caller's* clock precisely because this
module has none.

## 6. Edge cases and failure modes

| Input | Result |
|---|---|
| `null`, `undefined`, `'x'`, `42`, `[]`, `() => {}` | `fail` + `draft.unreadable` only |
| `{ name, prompt, cron, timezone }` (the real tool payload) | normalized to `schedule.mode = 'cron'`, `tz = timezone` |
| both `schedule` and flat `cron` | `schedule` wins, silently (no new code) |
| `schedule: 'daily'` (a string, not an object) | `schedule.missing` only — `schedule.mode` is emitted **only** when a schedule object exists, so one defect is never reported twice |
| `schedule: { mode: 'webhook' }` | no cron requirement; `schedule.tz.machine` not emitted (a webhook has no hour) |
| `cron: '*/5 * * * *'` with `tz: ''` | cron ok, `schedule.tz.machine` info |
| `tz: 'europe/paris'` | accepted by `Intl` (case-insensitive), no finding — canonicalization is **not** checked (ICU-version dependent: not deterministic, and determinism wins) |
| `tz: 'Mars/Phobos'`, `tz: 'x'.repeat(65)` | `schedule.tz.unknown` |
| `tz: 42` (not a string) | `schedule.tz.unknown`: a zone that is not a string is not a zone |
| mode `cron`, no `cron` key | `schedule.cron.defaulted` info (the route would store `0 8 * * *`) |
| mode `once`, `at: '2026-12-15T09:00'`, `nowMs` absent | no past check at all (the module has no clock) |
| mode `once`, `at` in the past, `nowMs` given | `schedule.at.past` |
| mode `once`, `at: '2026-02-30T09:00'` | `schedule.at.invalid` (the day must exist) |
| `needs: []` | no finding (`[]` is a decision: no connector) |
| `needs` absent, prompt says "my Gmail inbox" | `needs.missing` naming `gmail` |
| `needs: ['gmail','gmail']` | no finding: duplicate removal is the route's job, not a certification defect |
| `approvals: 'never'` | `approvals.unknown`, stored as `'ask'` → no `approvals.auto` |
| prompt = 8 001 characters, the word `send` repeated with spaces | `prompt.too-long` + one `prompt.send.word` (never one per occurrence) |
| prompt = 8 001 characters with no space at all | `prompt.too-long` only: the scan matches whole tokens, so a glued blob names nothing |
| prompt `Ask before sending anything.` | no finding: `sending` is not `send`, and no table entry is an inflection (§3.1) |
| prompt `Send the digest to the team.` | one `prompt.send.word`, `{word}` = `send` (whole-token match) |
| prompt with an e-mail, a phone number, a person's name | those strings appear in **no** message (asserted by test) |
| a Proxy whose `get` throws | `gate.internal`, `fail` |
| `options.gate = { status: 'activated', approval: { state: 'granted' } }` | no finding (the record is consistent) |
| `options.gate = { status: 'activated', approval: { state: 'none' } }` | `gate.unapproved-activation` blocker |

Performance: linear scans over strings bounded by `GATE_PROMPT_MAX`, `GATE_TOOLS_MAX`, `GATE_NEEDS_MAX`;
no regex alternation over the draft, no recursion over its keys. An 8 000-character prompt is tokenized
once into a `Set` lookup pass.

## 7. Security guards

1. **Activation is impossible here.** No export returns, computes or writes a status; the module has no
   `active = true`, no `'approved'` transition, no store call. `GATE_STATUSES` is a vocabulary, not a
   state machine. Verified by a test that greps the module for activation-shaped code and by the absence
   of any import.
2. **"Never sends, publishes, deletes or pays alone" is what the checks enforce** — invariant #2, in three
   places: prompt words (family warns), the unattended escalation (blocker when `approvals: 'auto'`), and
   the tool/connector advisories.
3. **Fail closed.** Any internal error → `gate.internal` blocker. There is no input for which the module
   returns `pass` by accident: `pass` requires an object draft, a name, a non-empty prompt, and a schedule
   the scheduler can act on (a cron it parses and that fires, a one-off date, a webhook, or the cron the
   route defaults to).
4. **Bounded output.** `GATE_FINDINGS_MAX === |GATE_CHECKS|`, one finding per code, message ≤ 200,
   field ≤ 80, code matching `/^[a-z][a-z0-9]*(\.[a-z0-9-]+)+$/`. A caller can size its buffer; a draft
   cannot inflate the answer.
5. **No personal data echo.** Draft text never reaches a message; only frozen table words, slugs, counts.
   This is the gate's contribution to cadrage's risk #7, and it is cheap because the gate runs *before*
   any model-written proof exists.
6. **No authority delegated to the input.** Severity/field come from `GATE_CHECKS`; a forged
   `findings`/`severity`/`gate` key on the draft is data, never a decision.
7. **No authority delegated to a model.** No model is called, no prompt is built. The gate's answer is a
   pure function of the draft.
8. **Dependency-free by construction**, so a later batch can import it from any context — including a
   client-side bundle or a test under `data:` — without dragging I/O into it.

## 8. Explicitly out of scope

- Any I/O: no file, no network, no `~/.dsh`, no `tasks.json`, no ledger. Frozen shapes are *described*,
  not persisted.
- Any route, action, HTTP handler, `webServerSvc.register` (B3), any UI, `client.js`, i18n table (B5),
  any pulse/notification (B6).
- Building, normalizing, stamping or comparing `GateRecord`s (B2), the trial machine and `ProofReport`
  (B2), the approval transition and `activated` (B3).
- The initiative queue and its caps (B4).
- `hasPersonalData` / `proofOf` personal-data refusal on suggestion text (B4 owns the queue door; the
  gate avoids the problem instead of solving it, by never echoing text).
- Model-written message translation: messages are English machine strings; the page translates by code.
- Re-checking a *stored* task (`tasks.json`) or its `history` — the gate sees a draft, not a store.
- Anything about `runsOn`, `workspaceHint`, `sessionMode`, `homeSessionId`, `trigger`, `notify`: not
  read, not validated (they are the route's business and are not certification risks).
- Editing any existing file, including `index.js`, `client.js`, `automation-*.mjs` and the SKILL.md.

## 9. File-by-file change plan

Two new files, **zero edits**. The anchors in §2 are the reference semantics; because they live in files
this batch does not own, the gate carries a verified copy instead of an import.

### 9.1 `packages/kybernos-plugin/automation-gate.mjs` — NEW

Layout, top to bottom (each block with its `// KB-AUTOGATE-*` marker so later batches can cite it, in the
house style of `automation-occurrences.mjs` and the `KB-AUTOBOARD` block):

1. `// KB-AUTOGATE-HEADER` — the doc comment: what it certifies, why no imports, who consumes it (B2, B3, B5).
2. `// KB-AUTOGATE-SHAPES` — `GATE_VERDICTS`, `GATE_SEVERITIES`, `GATE_STATUSES`, `GATE_APPROVAL_STATES`,
   `GATE_RECORD_KEYS`, `GATE_FINDING_KEYS`, then `GATE_CHECKS` (the code table) and `GATE_CODE_ORDER`,
   `GATE_FINDINGS_MAX` (derived), and the bounds (`GATE_NAME_MAX` … `GATE_FREQUENT_MINUTES`,
   `GATE_MESSAGE_MAX`, `GATE_FIELD_MAX`). All `Object.freeze`d, entries frozen too.
3. `// KB-AUTOGATE-WORDS` — `GATE_SEND_WORDS`, `GATE_DELETE_WORDS`, `GATE_PAY_WORDS`, `GATE_APP_HINTS`
   (subset of `KB_MCP_WRITE_WORDS`, `index.js:765`), plus the tokenizer `gateWords(text)` (lowercase,
   split on non `[a-z0-9']`, bounded by input length) and `gateHasWord(set, tokens)`.
4. `// KB-AUTOGATE-CRON` — `gateParseCron(expr)` (mirror of `kbParseCron`/`kbParseCronField`, `:280`/`:300`,
   including `domStar`/`dowStar`), `gateCronGapMinutes(expr)` (`:365`, `null` for an unparseable cron, so
   "unknown" and "always alone" stay distinct), `gateCronCanFire(expr)` (calendar scan over the 8-year
   window from 2024-01-01, the same window as `:361`), and `gateParseAt(text)` → `{y,mo,d,h,mi}` or `null`
   for `YYYY-MM-DDTHH:MM`, validated by arithmetic (Gregorian leap rule, days per month) — **without
   `Date`**, because the module has no clock and `new Date('2026-02-30T09:00')` rolls over silently.
5. `// KB-AUTOGATE-ZONE` — `gateIsValidZone(tz)` (mirror of `:228`: string, 1..64, `Intl.DateTimeFormat`
   builds), with the formatter cached in a module-local `Map` capped at 200 entries like `:219`.
6. `// KB-AUTOGATE-DRAFT` — `normalizeDraft(raw)` (the two accepted shapes, no aliasing, never throws).
7. `// KB-AUTOGATE-CHECKS` — the individual checks as small functions returning `null | { code, message }`
   (each one pure over the normalized draft), then `checkDraft` itself: run them in `GATE_CODE_ORDER`,
   collect by code, derive `{severity, field}` from `GATE_CHECKS`, bound the message, freeze, sort, return.
   The whole body sits inside one `try/catch` that returns `gate.internal`.
8. `// KB-AUTOGATE-SUMMARY` — `gateSummary(findings)`.

### 9.2 `packages/kybernos-plugin/test-automation-gate.mjs` — NEW

The house test idiom (`test-automation-suggest.mjs`, `test-automation-occurrences.mjs`): a plain Node
script with `eq(label, got, want)`, `FAIL`/`ok` lines, `process.exit(fails === 0 ? 0 : 1)`, and a header
comment saying what it proves. Content and the exact table are in
`docs/tests/gate-static-checks-strategy.md` (`unit:` section). It is picked up automatically by
`scripts/run-all-tests.mjs` (`/^test.*\.mjs$/` in `packages/*`, run with the package as cwd).

### 9.3 No edits — proof obligations for the reviewer

- `git status --porcelain --untracked-files=all | grep -E 'automation-gate|gate-static-checks'` lists
  exactly four paths (two `.mjs`, two docs) and nothing else: sibling batches write their own files in the
  same worktree, so the check is filtered on this batch's names, not global. `git diff --stat` over the
  tracked files of the package is empty.
- `node scripts/garde-depot.mjs` stays clean, and the four new files are also scanned one by one with its
  own exported `warningsOf` — the guard reads `git ls-files`, so an untracked new file escapes it. No media,
  no personal path, no mail address; the docs use `$REPO` and repo-relative paths (measured: both docs
  return `[]`).
- No new line in `index.js`, `client.js`, `automation-*.mjs`, `shared-ui.css`, `help.json`:
  `git diff --name-only -- packages/kybernos-plugin/index.js packages/kybernos-plugin/client.js` is empty.
- Dead-code rider (`AGENTS.md` rule 3): the batch adds no branch it cannot reach — the finding cap is
  provably non-binding (`GATE_FINDINGS_MAX === |GATE_CHECKS|`), every check has a case in the test table, and
  the falsification control (§9.2, strategy block J) fails if a check stops being exercised.

## 10. Definition of done (the discriminating one lives in the strategy)

`node packages/kybernos-plugin/test-automation-gate.mjs` exits 0, and the same command fails on the branch
as it stands today (`MODULE_NOT_FOUND` on the new test file — measured on this branch, not assumed). The
exact command, its expected failure today, its expected output after, and the falsification control that
proves the table is not vacuous are in `docs/tests/gate-static-checks-strategy.md`.

## 11. Decisions frozen by this spec

1. `checkDraft(draft)` keeps the cadrage signature; the second parameter `options` is optional and
   additive, so B2/B3/B5 can pass `nowMs` and the gate record without a new function.
2. The gate **never blocks on a legal product choice**: `approvals: 'auto'` is a warn, and becomes a
   blocker only through the `prompt.unattended` / `tools.unattended` escalation. A gate that forbids what
   the product allows would be bypassed, not used.
3. Severity per code is fixed. Context-dependent severity would make the output non-deterministic and
   untestable; two codes carry the two cases instead (`too-frequent` / `frequent-confirmed`).
4. `null` (not `Infinity`) for an uncomputable gap, `null` (not `[]`) for an absent `needs`: absent and
   empty stay different facts.
5. Cron and zone semantics are copied, never approximated, and the copy is pinned by a parity test against
   the `KB-TASKS-CORE` block of `index.js` — the one test that would catch a future engine change.
