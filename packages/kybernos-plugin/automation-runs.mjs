// What an automation run did, from the engine's own journal events.
//
// The Automations detail page lists the runs of one automation (Sessions) and tells the story of one run (Journal). Both need
// more than `tasks.json` holds: how long the run took, which model answered, which tools it called and for how long, whether a
// call asked for an approval, how the turn ended. The engine writes all of it in the session journal; this reads it and
// nothing else. No guess from what the model wrote, no cost, no judgement.
//
// Pure: events in, a bounded summary out. The host reads the events (sessionPersistence) and the page asks for the summary.
//
// A session of an automation is one prompt, so a run is its FIRST turn. A person may keep talking in that chat afterwards: the
// later turns are theirs, not the automation's, and are counted (`turns`) but not summarised.

import { lastTurnOutcome } from './session-outcome.mjs'

/** The longest label of a step (the title of a node of the execution graph). */
export const RUN_LABEL_MAX = 90
/** The longest input or output handed to the page for one step (detail mode only). */
export const RUN_TEXT_MAX = 420
/** Steps handed to the page per run: a list of runs stays small; one run opened in detail may carry more. */
export const RUN_NODES_LIST = 12
export const RUN_NODES_DETAIL = 40

const ctl = /[\u0000-\u001f\u007f]+/g
const num = (v) => (typeof v === 'number' && Number.isFinite(v) === true ? v : null)
const one = (v, max) => (typeof v === 'string' ? v.replace(ctl, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '')

/**
 * Text that may come from a person's machine, made safe to hand to a page: control characters out, one line, no long
 * token-like string (keys, tokens, ids that look like secrets) and no email address, then bounded.
 */
export const scrub = (v, max = RUN_TEXT_MAX) => {
  const s = typeof v === 'string' ? v : ''
  return one(s.replace(/[A-Za-z0-9_-]{28,}/g, '•••').replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '•••@•••'), max)
}

const argsOf = (raw) => {
  if (raw !== null && typeof raw === 'object') return raw
  try { const a = JSON.parse(String(raw === undefined ? '{}' : raw)); return a !== null && typeof a === 'object' ? a : {} } catch (e) { return {} }
}

const textOf = (content) => {
  if (typeof content === 'string') return content
  if (Array.isArray(content) === true) return content.map((p) => (typeof p === 'string' ? p : (p !== null && typeof p === 'object' ? String(p.text !== undefined ? p.text : (p.output !== null && typeof p.output === 'object' && p.output.text !== undefined ? p.output.text : '')) : ''))).join(' ')
  try { return JSON.stringify(content === undefined ? '' : content) } catch (e) { return '' }
}

const sizeOf = (content) => { try { return JSON.stringify(content === undefined ? '' : content).length } catch (e) { return 0 } }

/**
 * The summary of the first turn of a session, or null when no turn ever started.
 *   startedAt / endedAt / durationMs   the turn's own clock (endedAt and durationMs are null while it is open)
 *   outcome   { state: 'completed' | 'failed' | 'open', code?, message? }   the engine's `turn/end` reason, as session-outcome.mjs reads it
 *   models    [{ provider, model }]    what the engine's requests were routed to, in order, without repeats
 *   selected  true when a model was chosen on purpose for this session (a `model/selection` event), false when the profile's default answered
 *   turns / steps / toolCalls          how many turns the session holds, steps of the first turn, tool calls of the first turn
 *   nodes     [{ kind, label, thinkMs, runMs, outBytes, ok, approval?, in?, out? }]   the tool calls in order (bounded; in/out only in detail mode)
 *   nodeCount / final                  the number of tool calls, and the model's last step when it called no tool: { thinkMs }
 *   approvals [{ toolName, outcome }]  what asked for an approval during the turn, `outcome` is the engine's decision ('asked' while undecided)
 */
export const summarizeRun = (events, options) => {
  const detail = options !== null && typeof options === 'object' && options.detail === true
  const list = Array.isArray(events) === true ? events : []
  let from = -1
  let to = -1
  let turns = 0
  for (let i = 0; i < list.length; i += 1) {
    const ev = list[i]
    if (ev === null || typeof ev !== 'object') continue
    if (ev.type === 'turn/start') { turns += 1; if (from < 0) from = i } else if (ev.type === 'turn/end' && from >= 0 && to < 0) to = i
  }
  if (from < 0) return null
  const turn = list.slice(from, to < 0 ? undefined : to + 1)
  const first = turn[0]
  const startedMs = num(first.time)
  const endedMs = to >= 0 ? num(list[to].time) : null
  const verdict = lastTurnOutcome(turn)
  const models = []
  const seen = new Set()
  let selected = false
  for (let i = 0; i < (to < 0 ? list.length : to + 1); i += 1) {
    const ev = list[i]
    if (ev === null || typeof ev !== 'object') continue
    if (ev.type === 'model/selection') selected = true
    if (ev.type === 'request/header' && i >= from) {
      const d = ev.data !== null && typeof ev.data === 'object' ? ev.data : null
      const cfg = d !== null && d.header !== null && typeof d.header === 'object' && d.header.config !== null && typeof d.header.config === 'object' ? d.header.config : null
      const provider = cfg !== null ? one(cfg.provider, 60) : ''
      const model = cfg !== null ? one(cfg.model, 80) : ''
      const key = provider + '/' + model
      if ((provider !== '' || model !== '') && seen.has(key) === false) { seen.add(key); models.push({ provider, model }) }
    }
  }
  const cap = detail === true ? RUN_NODES_DETAIL : RUN_NODES_LIST
  const nodes = []
  const byCall = new Map()
  const approvals = []
  const approvalById = new Map()
  let steps = 0
  let toolCalls = 0
  let stepStart = startedMs
  let lastStepStart = null
  let lastStepEnd = null
  let lastStepCalls = 0
  for (const ev of turn) {
    if (ev === null || typeof ev !== 'object') continue
    const d = ev.data !== null && typeof ev.data === 'object' ? ev.data : {}
    const t = num(ev.time)
    if (ev.type === 'step/start') { stepStart = t; lastStepStart = t; lastStepCalls = 0 } else if (ev.type === 'step/end') { steps += 1; lastStepEnd = t } else if (ev.type === 'tool/call') {
      toolCalls += 1
      lastStepCalls += 1
      const a = argsOf(d.arguments)
      const kind = one(d.name, 40) || 'tool'
      const label = one(a.description, RUN_LABEL_MAX) || one(a.name, RUN_LABEL_MAX) || one(a.query, RUN_LABEL_MAX) || one(a.url, RUN_LABEL_MAX) || one(a.command, RUN_LABEL_MAX) || kind
      const node = { kind, label: scrub(label, RUN_LABEL_MAX), thinkMs: t !== null && stepStart !== null && t >= stepStart ? t - stepStart : null, runMs: null, outBytes: 0, ok: true, atMs: t }
      if (detail === true) node.in = scrub(typeof a.command === 'string' ? a.command : (typeof a.query === 'string' ? a.query : (typeof a.name === 'string' ? a.name : JSON.stringify(a))))
      byCall.set(String(d.callId), node)
      if (nodes.length < cap) nodes.push(node)
    } else if (ev.type === 'tool/result') {
      const m = d.message !== null && typeof d.message === 'object' ? d.message : null
      const node = m !== null ? byCall.get(String(m.toolCallId)) : undefined
      if (node !== undefined) {
        node.runMs = t !== null && node.atMs !== null && t >= node.atMs ? t - node.atMs : null
        node.outBytes = sizeOf(m.content)
        node.ok = m.isError !== true
        if (detail === true) node.out = scrub(textOf(m.content))
      }
    } else if (ev.type === 'approval/asked') {
      const entry = { toolName: one(d.toolName, 60), outcome: 'asked', callId: String(d.callId) }
      approvals.push(entry)
      approvalById.set(String(d.id), entry)
    } else if (ev.type === 'approval/decided') {
      const entry = approvalById.get(String(d.id))
      if (entry !== undefined) entry.outcome = one(d.outcome, 40) || 'decided'
    }
  }
  for (const a of approvals) { const node = byCall.get(a.callId); if (node !== undefined) node.approval = a.outcome }
  const out = nodes.map((n) => { const x = { kind: n.kind, label: n.label, thinkMs: n.thinkMs, runMs: n.runMs, outBytes: n.outBytes, ok: n.ok }; if (n.approval !== undefined) x.approval = n.approval; if (n.in !== undefined) x.in = n.in; if (n.out !== undefined) x.out = n.out; return x })
  const final = lastStepCalls === 0 && lastStepStart !== null && lastStepEnd !== null && lastStepEnd >= lastStepStart ? { thinkMs: lastStepEnd - lastStepStart } : null
  return {
    startedAt: startedMs !== null ? new Date(startedMs).toISOString() : null,
    endedAt: endedMs !== null ? new Date(endedMs).toISOString() : null,
    durationMs: startedMs !== null && endedMs !== null && endedMs >= startedMs ? endedMs - startedMs : null,
    outcome: verdict.open === true ? { state: 'open' } : (verdict.failed === true ? { state: 'failed', code: verdict.code, message: verdict.message } : { state: 'completed' }),
    models,
    selected,
    turns,
    steps,
    toolCalls,
    nodes: out,
    nodeCount: toolCalls,
    final,
    approvals: approvals.map((a) => ({ toolName: a.toolName, outcome: a.outcome })),
  }
}
