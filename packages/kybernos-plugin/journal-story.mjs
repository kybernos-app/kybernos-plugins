// Pure derivation of the chat Journal « story » from ONE session's durable events.
//
// The Journal tab reads what a chat really did: the person's messages, the crews that ran, the connectors that were called, the handovers asked of a person and
// what they answered, the files delivered, the models used and what they cost. Nothing is invented: a field the log does not carry stays null (the approver's
// name and computer are in that case today: `approval/decided` only says « allowed-once »; the host's record of the decision fills them, see journal-decisions.mjs).
//
// The function returns DATA, never sentences: counts, names, texts the person or a tool wrote. The client words them (and translates them), so the language of
// the page never depends on this file.
//
//   deriveStory(events, { sessionId, runs, costOf, now }) → { chat, trigger, stats, series, models, connectors, crews, moments, droppedMoments, deliverables }
//
// `events` are the session events ({type, seq, time, data}); `runs` is what `deriveRuns` already derived (crews: workflow runs and agent-team tasks, with their
// members and real route facts); `costOf(provider, model, usage)` returns EUR or null (null = unpriced, never 0).

const MAX_TEXT = 800
const MAX_MOMENTS = 1200
const MAX_ITEMS = 60
const MAX_SERIES = 48
const URL_RE = /https?:\/\/[^\s"'<>)\]]+/g
// A connector call of the Composio kind is named TOOLKIT_ACTION (GMAIL_SEND_EMAIL); an MCP tool is mcp__<server>__<tool>.
const COMPOSIO_RE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/
const MCP_RE = /^mcp__([^_](?:[^_]|_(?!_))*)__(.+)$/

const str = (v) => (typeof v === 'string' ? v : null)
const num = (v) => (typeof v === 'number' && Number.isFinite(v) === true ? v : null)
const isObj = (v) => v !== null && typeof v === 'object' && Array.isArray(v) === false
const clip = (s, n) => (typeof s === 'string' && s.length > n ? s.slice(0, n) : s)

export const parseArgs = (raw) => {
  let a = raw
  for (let i = 0; i < 2; i += 1) {
    if (typeof a === 'string') { try { a = JSON.parse(a) } catch (e) { return null } }
  }
  return isObj(a) === true ? a : null
}

// The text of a tool result lives in data.message.content[{type:'text', text}] (two shapes are measured in the logs: {callId,…} and {message:{toolCallId,…}}).
export const resultOf = (data) => {
  if (isObj(data) === false) return { callId: null, text: null, isError: false }
  const msg = isObj(data.message) === true ? data.message : null
  let callId = str(data.callId)
  if (callId === null && msg !== null) {
    callId = str(msg.toolCallId)
    if (callId === null && isObj(msg.source) === true) callId = str(msg.source.callId)
  }
  const parts = msg !== null && Array.isArray(msg.content) === true ? msg.content : []
  let text = ''
  for (let i = 0; i < parts.length; i += 1) {
    if (isObj(parts[i]) === true && typeof parts[i].text === 'string') text += (text.length > 0 ? '\n' : '') + parts[i].text
  }
  return { callId: callId, text: text.length > 0 ? text : null, isError: msg !== null && msg.isError === true }
}

const textOfContent = (content) => {
  if (typeof content === 'string') return content
  if (Array.isArray(content) === false) return null
  let t = ''
  for (let i = 0; i < content.length; i += 1) {
    if (isObj(content[i]) === true && content[i].type === 'text' && typeof content[i].text === 'string') t += (t.length > 0 ? '\n' : '') + content[i].text
  }
  return t.length > 0 ? t : null
}

const linksOf = (text) => {
  if (typeof text !== 'string') return []
  const found = text.match(URL_RE)
  if (found === null) return []
  const out = []
  for (let i = 0; i < found.length && out.length < 4; i += 1) {
    const u = found[i].replace(/[.,;:]+$/, '')
    if (out.indexOf(u) < 0) out.push(clip(u, 240))
  }
  return out
}

const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, '') } catch (e) { return null } }

/** How one tool name is classed. `connector` carries what the logo lookup needs (the toolkit or the server), `work` is folded into a group. */
export function classifyTool(name) {
  if (typeof name !== 'string' || name.length === 0) return { kind: 'work', group: 'other' }
  if (COMPOSIO_RE.test(name) === true) {
    const cut = name.indexOf('_')
    return { kind: 'connector', connector: { id: name.slice(0, cut).toLowerCase(), name: name.slice(0, cut), action: name.slice(cut + 1).toLowerCase().replace(/_/g, ' '), via: 'composio' } }
  }
  const mcp = MCP_RE.exec(name)
  if (mcp !== null) {
    const server = mcp[1]
    return { kind: 'connector', connector: { id: server.toLowerCase(), name: server, action: mcp[2].replace(/^browser_/, '').replace(/_/g, ' '), via: 'mcp' } }
  }
  if (name === 'ask_user_question') return { kind: 'handover' }
  if (name === 'present') return { kind: 'output' }
  if (name === 'workflow') return { kind: 'crew-call' }
  if (/^(memory_|lesson_|instructions_suggest)/.test(name) === true) return { kind: 'memory', op: /(write|suggest)$/.test(name) === true ? 'write' : 'read' }
  if (/^skill(_|$)/.test(name) === true) return { kind: 'skill', op: name === 'skill' ? 'use' : name.slice(6) }
  if (/^(create_goal|update_goal|get_goal)$/.test(name) === true) return { kind: 'goal', op: name.slice(0, name.indexOf('_')) }
  if (/^(schedule_|automation_)/.test(name) === true) return { kind: 'automation', op: name }
  if (name === 'bash' || name === 'job_output' || name === 'job_kill' || name === 'job_list') return { kind: 'work', group: 'command' }
  if (name === 'edit' || name === 'write') return { kind: 'work', group: 'edit' }
  if (name === 'read' || name === 'read_image' || name === 'glob' || name === 'grep') return { kind: 'work', group: 'read' }
  if (name === 'web_fetch' || name === 'web_search') return { kind: 'work', group: 'web' }
  if (/^(spawn_teammate|send_message|wait_agent|list_agents|team_task_|subagent)/.test(name) === true) return { kind: 'work', group: 'crew' }
  return { kind: 'work', group: 'other' }
}

const permissionOutcome = (o) => {
  const s = typeof o === 'string' ? o.toLowerCase() : ''
  if (s.length === 0) return 'answered'
  if (/den|reject|refus|block/.test(s) === true) return 'denied'
  if (/allow|approv|grant|accept/.test(s) === true) return 'allowed'
  return 'answered'
}

// The answer of ask_user_question is {"answers":[{id, selected:[…], custom}]}.
const answersOf = (text) => {
  if (typeof text !== 'string') return null
  try {
    const j = JSON.parse(text)
    if (isObj(j) === true && Array.isArray(j.answers) === true) {
      return j.answers.filter((a) => isObj(a) === true).map((a) => ({
        id: str(a.id),
        selected: Array.isArray(a.selected) === true ? a.selected.filter((x) => typeof x === 'string').slice(0, 6) : [],
        custom: str(a.custom) !== null ? clip(a.custom, MAX_TEXT) : null,
      }))
    }
  } catch (e) { /* not JSON: shown as plain text */ }
  return null
}

const rejectedAnswer = (answers, raw) => /(rejet|refus|annul|reject|deny|denied|cancel)/i.test(JSON.stringify(answers !== null ? answers : (raw === null ? '' : raw))) === true

// Union length of [start, end] intervals: two crews running at once count once.
const unionMs = (spans) => {
  const list = spans.filter((s) => s[0] !== null && s[1] !== null && s[1] > s[0]).sort((a, b) => a[0] - b[0])
  let total = 0
  let curS = null
  let curE = null
  for (let i = 0; i < list.length; i += 1) {
    if (curE === null || list[i][0] > curE) {
      if (curE !== null) total += curE - curS
      curS = list[i][0]
      curE = list[i][1]
    } else if (list[i][1] > curE) curE = list[i][1]
  }
  if (curE !== null) total += curE - curS
  return total
}

/** The key a recorded decision is joined on: the id of a permission, the call id of a question. */
export const decisionKey = (kind, id) => (kind === 'permission' ? 'a:' : 'q:') + id

export function deriveStory(events, opts) {
  const o = isObj(opts) === true ? opts : {}
  const list = Array.isArray(events) === true ? events : []
  const costOf = typeof o.costOf === 'function' ? o.costOf : () => null
  const runs = Array.isArray(o.runs) === true ? o.runs : []

  const moments = []
  const deliverables = []
  const deliverablePaths = {}
  const pending = {} // callId → { moment, classed, args }
  const approvalsById = {} // approval id → moment
  const presentCalls = {} // callId → files of a `present` call whose deliverables event has not been seen
  const models = {} // provider|model → totals
  const series = []
  const turns = []
  let openTurn = null
  let firstAt = null
  let lastAt = null
  let title = null
  let userMessages = 0
  let trigger = { kind: 'chat', rpcId: null }
  let firstUser = null
  let costEur = null
  let unpriced = 0
  let tokIn = 0
  let tokOut = 0
  let tokCache = 0
  let llmErrors = 0
  let llmRetries = 0
  let toolTotal = 0
  let n = 0
  let lastWork = null
  let lastReply = null
  let selectionSeen = false

  const push = (m) => { n += 1; m.id = 'm' + n; moments.push(m); return m }
  const closeWork = () => { lastWork = null }
  const addDeliverable = (d) => {
    const key = d.path !== null && d.path !== undefined ? d.path : d.url
    if (key === null || key === undefined || deliverablePaths[key] === true) return
    deliverablePaths[key] = true
    deliverables.push(d)
  }

  for (let i = 0; i < list.length; i += 1) {
    const ev = list[i]
    if (isObj(ev) === false) continue
    const data = isObj(ev.data) === true ? ev.data : {}
    const at = num(ev.time)
    const seq = num(ev.seq)
    if (at !== null) { if (firstAt === null) firstAt = at; lastAt = at }
    const type = ev.type

    if (type === 'session/title') { const t = str(data.title); if (t !== null && t.length > 0) title = t; continue }

    if (type === 'turn/start') { openTurn = { start: at, end: null }; turns.push(openTurn); continue }
    if (type === 'turn/end') {
      if (openTurn !== null) { openTurn.end = at; openTurn = null }
      if (lastReply !== null) {
        closeWork()
        push({ kind: 'reply', at: lastReply.at, seq: lastReply.seq, text: lastReply.text, provider: lastReply.provider, model: lastReply.model })
        lastReply = null
      }
      continue
    }

    if (type === 'user/message') {
      if (data.role !== undefined && data.role !== 'user') continue
      const text = textOfContent(data.content)
      if (text === null || /^\s*<system-reminder>/.test(text) === true) continue
      const src = isObj(data.source) === true ? data.source : {}
      // Only the person's words (and the schedule's own message) tell the story: the runtime context, the time sample, the skill catalogue, a finished background
      // job or a crew's report come in as `user` messages too, with a `source.kind` of their own.
      const srcKind = str(src.kind)
      if (srcKind !== null && srcKind !== 'user' && srcKind !== 'schedule') continue
      closeWork()
      userMessages += 1
      const rpc = str(src.rpcId)
      if (firstUser === null) {
        firstUser = clip(text, MAX_TEXT)
        if (rpc !== null && /^kb-task-/.test(rpc) === true) trigger = { kind: 'automation', rpcId: rpc }
      }
      push({ kind: 'message', at: at, seq: seq, actor: 'user', text: clip(text, MAX_TEXT), automation: (rpc !== null && /^kb-task-/.test(rpc) === true) || srcKind === 'schedule' })
      continue
    }

    if (type === 'assistant/message') {
      const msg = isObj(data.message) === true ? data.message : {}
      const src = isObj(msg.source) === true ? msg.source : {}
      const provider = str(src.provider)
      const model = str(src.model)
      const u = isObj(data.usage) === true ? data.usage : null
      if (u !== null) {
        const usage = { input: num(u.inputTokens) || 0, output: num(u.outputTokens) || 0, cacheRead: num(u.cacheReadTokens) || 0, cacheWrite: num(u.cacheWriteTokens) || 0 }
        tokIn += usage.input
        tokOut += usage.output
        tokCache += usage.cacheRead
        const cost = costOf(provider, model, usage)
        if (cost === null || cost === undefined) { if (usage.input + usage.output > 0) unpriced += 1 } else costEur = (costEur === null ? 0 : costEur) + cost
        const key = (provider === null ? '' : provider) + '|' + (model === null ? '' : model)
        if (models[key] === undefined) models[key] = { provider: provider, model: model, calls: 0, tokens: 0, costEur: null }
        models[key].calls += 1
        models[key].tokens += usage.input + usage.output
        if (cost !== null && cost !== undefined) models[key].costEur = (models[key].costEur === null ? 0 : models[key].costEur) + cost
        series.push({ at: at, tokens: tokIn + tokOut, costEur: costEur })
      }
      const text = textOfContent(Array.isArray(msg.content) === true ? msg.content.filter((c) => isObj(c) === true && c.type === 'text') : null)
      if (text !== null && text.trim().length > 0) lastReply = { at: at, seq: seq, text: clip(text, MAX_TEXT), provider: provider, model: model }
      continue
    }

    if (type === 'assistant/attempt') {
      const stream = Array.isArray(data.stream) === true ? data.stream : []
      for (let k = 0; k < stream.length; k += 1) {
        const c = isObj(stream[k]) === true && isObj(stream[k].chunk) === true ? stream[k].chunk : null
        if (c !== null && c.type === 'finish' && isObj(c.reason) === true && c.reason.kind === 'error') llmErrors += 1
      }
      continue
    }
    if (type === 'llm/retry') { llmRetries += 1; continue }

    if (type === 'model/selection') {
      const provider = str(data.provider)
      const mdl = str(data.model)
      if (mdl === null) continue
      push({ kind: 'model', at: at, seq: seq, provider: provider, model: mdl, initial: selectionSeen === false })
      selectionSeen = true
      continue
    }

    if (type === 'goal/change') {
      const g = isObj(data.goal) === true ? data.goal : null
      if (g !== null) { closeWork(); push({ kind: 'goal', at: at, seq: seq, op: str(data.operation), text: clip(str(g.objective), 300), phase: str(g.phase) }) }
      continue
    }

    if (type === 'deliverables/presented') {
      const files = Array.isArray(data.files) === true ? data.files : []
      closeWork()
      const items = []
      for (let k = 0; k < files.length && k < MAX_ITEMS; k += 1) {
        if (isObj(files[k]) === false || str(files[k].path) === null) continue
        const d = { kind: 'file', path: files[k].path, name: files[k].path.split('/').pop(), description: clip(str(files[k].description), 300), at: at, url: null }
        items.push(d)
        addDeliverable(d)
      }
      if (str(data.callId) !== null) delete presentCalls[str(data.callId)]
      if (items.length > 0) push({ kind: 'output', at: at, seq: seq, callId: str(data.callId), files: items.map((d) => ({ path: d.path, name: d.name, description: d.description })) })
      continue
    }

    if (type === 'approval/asked') {
      closeWork()
      const id = str(data.id)
      const m = push({
        kind: 'handover', at: at, seq: seq, source: 'permission', tool: str(data.toolName), callId: str(data.callId), approvalId: id, text: clip(str(data.reason), 500),
        options: [], outcome: 'waiting', decidedAt: null, waitMs: null, answers: null,
        approvers: [],
      })
      if (id !== null) approvalsById[id] = m
      continue
    }
    if (type === 'approval/decided') {
      const m = approvalsById[str(data.id)]
      if (m !== undefined) {
        m.decidedAt = at
        m.waitMs = at !== null && m.at !== null ? Math.max(0, at - m.at) : null
        m.outcome = permissionOutcome(data.outcome)
        m.approvers = [{ who: str(data.by), role: null, device: str(data.device), state: m.outcome, at: at, signed: false }]
      }
      continue
    }

    if (type === 'tool/call') {
      const name = str(data.name)
      if (name === null) continue
      toolTotal += 1
      const args = parseArgs(data.arguments)
      const callId = str(data.callId)
      const cls = classifyTool(name)
      if (cls.kind === 'crew-call') continue // the crew is drawn from its run, not from the tool call
      if (cls.kind === 'output') {
        // The files are the moment of the `deliverables/presented` event; the call only stands in for it when that event is missing.
        if (callId !== null && args !== null && Array.isArray(args.files) === true) presentCalls[callId] = { at: at, seq: seq, files: args.files }
        closeWork()
        continue
      }
      if (cls.kind === 'work') {
        if (lastWork === null) lastWork = push({ kind: 'work', at: at, seq: seq, endAt: at, counts: { command: 0, edit: 0, read: 0, web: 0, crew: 0, other: 0 }, total: 0, failed: 0, items: [] })
        lastWork.counts[cls.group] += 1
        lastWork.total += 1
        lastWork.endAt = at
        let item = null
        if (lastWork.items.length < MAX_ITEMS) {
          item = { name: name, at: at, durMs: null, error: false, target: clip(str(args !== null ? (args.path || args.file_path || args.command || args.url || args.query || args.pattern || null) : null), 160) }
          lastWork.items.push(item)
        }
        if (callId !== null) pending[callId] = { work: lastWork, item: item }
        continue
      }
      closeWork()
      if (cls.kind === 'handover') {
        const qs = args !== null && Array.isArray(args.questions) === true ? args.questions.filter((q) => isObj(q) === true) : []
        const q = qs.length > 0 ? qs[0] : {}
        const m = push({
          kind: 'handover', at: at, seq: seq, source: 'question', tool: name, callId: callId,
          text: clip(str(q.question) !== null ? q.question : str(q.header), 500), header: clip(str(q.header), 120),
          options: Array.isArray(q.options) === true ? q.options.filter((x) => isObj(x) === true && typeof x.label === 'string').slice(0, 6).map((x) => clip(x.label, 120)) : [],
          more: qs.length > 1 ? qs.length - 1 : 0,
          outcome: 'waiting', decidedAt: null, waitMs: null, answers: null, approvers: [],
        })
        if (callId !== null) pending[callId] = { moment: m }
        continue
      }
      const m = push({
        kind: cls.kind, at: at, seq: seq, endAt: null, durMs: null, tool: name, callId: callId, status: 'running',
        connector: cls.connector !== undefined ? cls.connector : null, op: cls.op !== undefined ? cls.op : null,
        input: args !== null ? clip(JSON.stringify(args), MAX_TEXT) : clip(str(data.arguments), MAX_TEXT),
        subject: clip(str(args !== null ? (args.name || args.title || args.query || args.url || args.prompt || args.content || args.objective || null) : null), 200),
        output: null, error: null, links: [],
      })
      if (callId !== null) pending[callId] = { moment: m }
      continue
    }

    if (type === 'tool/result') {
      const r = resultOf(data)
      if (r.callId === null) continue
      const p = pending[r.callId]
      if (p === undefined) continue
      delete pending[r.callId]
      if (p.work !== undefined) {
        if (p.item !== null && p.item !== undefined) { p.item.durMs = at !== null && p.item.at !== null ? Math.max(0, at - p.item.at) : null; p.item.error = r.isError }
        if (r.isError === true) p.work.failed += 1
        if (at !== null && (p.work.endAt === null || at > p.work.endAt)) p.work.endAt = at
        continue
      }
      const m = p.moment
      m.endAt = at
      m.durMs = at !== null && m.at !== null ? Math.max(0, at - m.at) : null
      if (m.kind === 'handover') {
        m.decidedAt = at
        m.waitMs = m.durMs
        m.answers = answersOf(r.text)
        m.rawAnswer = m.answers === null && r.text !== null ? clip(r.text, 400) : null
        m.outcome = r.isError === true ? 'error' : (rejectedAnswer(m.answers, r.text) === true ? 'denied' : 'answered')
        m.approvers = [{ who: null, role: null, device: null, state: m.outcome, at: at, signed: false }]
        continue
      }
      m.status = r.isError === true ? 'error' : 'ok'
      m.output = clip(r.text, MAX_TEXT)
      if (r.isError === true) m.error = clip(r.text, 300)
      if (m.kind === 'connector' || m.kind === 'automation' || m.kind === 'skill') m.links = linksOf(r.text)
      if (m.kind === 'connector') {
        for (let k = 0; k < m.links.length; k += 1) addDeliverable({ kind: 'link', path: null, url: m.links[k], name: hostOf(m.links[k]) || m.links[k], description: m.connector !== null ? m.connector.name : null, at: at })
      }
      continue
    }
  }

  // The reply of a turn still running is a moment too (it is the chat's visible output so far).
  if (lastReply !== null) push({ kind: 'reply', at: lastReply.at, seq: lastReply.seq, text: lastReply.text, provider: lastReply.provider, model: lastReply.model })
  const stray = Object.keys(presentCalls)
  for (let i = 0; i < stray.length; i += 1) {
    const pc = presentCalls[stray[i]]
    const items = []
    for (let k = 0; k < pc.files.length && k < MAX_ITEMS; k += 1) {
      if (isObj(pc.files[k]) === false || str(pc.files[k].path) === null) continue
      const d = { kind: 'file', path: pc.files[k].path, name: pc.files[k].path.split('/').pop(), description: clip(str(pc.files[k].description), 300), at: pc.at, url: null }
      items.push(d)
      addDeliverable(d)
    }
    if (items.length > 0) push({ kind: 'output', at: pc.at, seq: pc.seq, callId: stray[i], files: items.map((d) => ({ path: d.path, name: d.name, description: d.description })) })
  }
  moments.sort((a, b) => (a.seq === null ? 0 : a.seq) - (b.seq === null ? 0 : b.seq))

  // Who decided, and on which computer: the engine's events do not say, so the host's record (journal-decisions.mjs) is joined here. A name the engine gave is kept.
  const decisions = isObj(o.decisions) === true ? o.decisions : {}
  for (let i = 0; i < moments.length; i += 1) {
    const m = moments[i]
    if (m.kind !== 'handover' || m.approvers.length === 0) continue
    const id = m.source === 'permission' ? m.approvalId : m.callId
    const key = id !== null && id !== undefined ? decisionKey(m.source === 'permission' ? 'permission' : 'question', id) : null
    const d = key !== null ? decisions[key] : undefined
    if (isObj(d) === false) continue
    const a = m.approvers[0]
    if (a.who === null) a.who = str(d.by)
    if (a.device === null) a.device = str(d.device)
    // The seal of the decision, as checked against the log by the host (journal-seal.mjs): 'valid', 'broken' or 'foreign' (made with another key).
    const seal = isObj(o.seals) === true ? o.seals[key] : undefined
    a.seal = seal === 'valid' || seal === 'broken' || seal === 'foreign' ? seal : null
    a.signed = a.seal === 'valid'
  }

  // A connector call that failed and was later repeated with success is « recovered », not an open error.
  for (let i = 0; i < moments.length; i += 1) {
    const m = moments[i]
    if (m.kind !== 'connector' || m.status !== 'error') continue
    m.recovered = false
    for (let k = i + 1; k < moments.length; k += 1) {
      if (moments[k].kind === 'connector' && moments[k].tool === m.tool && moments[k].status === 'ok') { m.recovered = true; break }
    }
  }

  // Crews: one moment per run, with its members and their real route facts.
  const crews = []
  let crewTokens = 0
  for (let r = 0; r < runs.length; r += 1) {
    const run = runs[r]
    if (isObj(run) === false) continue
    const members = Array.isArray(run.members) === true ? run.members : []
    const totals = isObj(run.totals) === true ? run.totals : {}
    const state = run.endedAt === null || run.endedAt === undefined ? 'running' : ((num(totals.failed) || 0) > 0 || run.stopReason === 'failed' ? 'failed' : 'done')
    const crew = {
      id: str(run.runId), name: str(run.name), startedAt: num(run.startedAt), endedAt: num(run.endedAt), state: state, from: str(run.declaredFrom),
      durMs: num(totals.durationMs), tokens: num(totals.tokens), costEur: num(totals.costEur),
      members: members.slice(0, MAX_ITEMS).map((m) => ({
        label: str(m.label), phase: str(m.phase), outcome: str(m.outcome), durMs: num(m.durationMs), childId: str(m.childId),
        provider: isObj(m.actual) === true ? str(m.actual.provider) : null, model: isObj(m.actual) === true ? str(m.actual.model) : null,
        tokens: isObj(m.actual) === true ? num(m.actual.tokens) : null, costEur: isObj(m.actual) === true ? num(m.actual.costEur) : null,
      })),
    }
    crews.push(crew)
    if (crew.costEur !== null) costEur = (costEur === null ? 0 : costEur) + crew.costEur
    if (crew.tokens !== null) crewTokens += crew.tokens
    if (crew.startedAt !== null) moments.push({ id: 'c' + (r + 1), kind: 'crew', at: crew.startedAt, seq: null, endAt: crew.endedAt, crewId: crew.id, status: state })
  }
  moments.sort((a, b) => (a.at === null ? 0 : a.at) - (b.at === null ? 0 : b.at) || (a.seq === null ? 0 : a.seq) - (b.seq === null ? 0 : b.seq))
  const dropped = moments.length > MAX_MOMENTS ? moments.length - MAX_MOMENTS : 0
  const kept = dropped > 0 ? moments.slice(dropped) : moments

  // Time: only the turns count (a chat left open for three days did not « run » for three days).
  const nowMs = num(o.now) !== null ? o.now : lastAt
  const turnSpans = turns.map((t) => [t.start, t.end !== null ? t.end : nowMs])
  // No turn event (a seed, a very old log): the gaps up to ten minutes count, a longer silence is the chat left alone, not the chat working.
  let gapMs = 0
  for (let i = 1; i < list.length; i += 1) {
    const a = isObj(list[i - 1]) === true ? num(list[i - 1].time) : null
    const b = isObj(list[i]) === true ? num(list[i].time) : null
    if (a !== null && b !== null && b >= a && b - a <= 600000) gapMs += b - a
  }
  const activeMs = turnSpans.length > 0 ? unionMs(turnSpans) : gapMs
  const waits = moments.filter((m) => m.kind === 'handover' && m.waitMs !== null).map((m) => [m.at, m.at + m.waitMs])
  const waitingMs = unionMs(waits)
  const crewMs = unionMs(crews.map((c) => [c.startedAt, c.endedAt !== null ? c.endedAt : nowMs]))
  const running = turns.length > 0 && turns[turns.length - 1].end === null

  const counts = {}
  for (let i = 0; i < kept.length; i += 1) counts[kept[i].kind] = (counts[kept[i].kind] || 0) + 1
  const connectors = {}
  let connectorErrors = 0
  let connectorOpenErrors = 0
  for (let i = 0; i < kept.length; i += 1) {
    const m = kept[i]
    if (m.kind !== 'connector') continue
    const id = m.connector.id
    if (connectors[id] === undefined) connectors[id] = { id: id, name: m.connector.name, via: m.connector.via, calls: 0, errors: 0 }
    connectors[id].calls += 1
    if (m.status === 'error') { connectors[id].errors += 1; connectorErrors += 1; if (m.recovered !== true) connectorOpenErrors += 1 }
  }
  const crewFailed = crews.filter((c) => c.state === 'failed').length
  const handovers = kept.filter((m) => m.kind === 'handover')

  // The cumulative series is thinned to a size a small chart draws.
  let thin = series
  if (series.length > MAX_SERIES) {
    thin = []
    for (let i = 0; i < MAX_SERIES; i += 1) thin.push(series[Math.round((i * (series.length - 1)) / (MAX_SERIES - 1))])
  }

  return {
    chat: { id: str(o.sessionId), title: title, startedAt: firstAt, endedAt: lastAt, running: running, userMessage: firstUser, messages: userMessages },
    trigger: trigger,
    stats: {
      activeMs: activeMs, waitingMs: waitingMs, crewMs: crewMs, moments: kept.length, counts: counts,
      errors: connectorErrors + crewFailed, openErrors: connectorOpenErrors + crewFailed, llmErrors: llmErrors, llmRetries: llmRetries,
      handovers: handovers.length, handoversWaiting: handovers.filter((h) => h.outcome === 'waiting').length,
      tokens: { input: tokIn, output: tokOut, cacheRead: tokCache, crews: crewTokens }, costEur: costEur, unpriced: unpriced,
      toolCalls: toolTotal, deliverables: deliverables.length,
    },
    series: thin,
    models: Object.keys(models).map((k) => models[k]).sort((a, b) => b.tokens - a.tokens),
    connectors: Object.keys(connectors).map((k) => connectors[k]),
    crews: crews,
    moments: kept,
    droppedMoments: dropped,
    deliverables: deliverables.slice(0, 200),
  }
}
