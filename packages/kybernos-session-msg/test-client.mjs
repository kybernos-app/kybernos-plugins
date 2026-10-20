// Client half: the surfaces, their behaviour and their strings — no browser.
// client.js is evaluated against a stub loader and a small hook harness (useState/useEffect/useRef), so the real
// components run, their handlers are really called and their trees are inspected. The wire is a stub `fetch`.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let fail = 0
const ok = (name, cond, detail) => {
  console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  ' + (detail || '')))
  if (!cond) fail += 1
}

let LANG = 'fr'
const listeners = []
let captured = null
globalThis.window = {
  __ModuleLoader__: { load: (m) => { captured = m } },
  __KB_LANG_RESOLVE__: () => LANG,
}
globalThis.document = {
  documentElement: { lang: 'fr' },
  head: { appendChild () {} },
  body: {},
  visibilityState: 'visible',
  createElement: () => ({ setAttribute () {}, remove () {} }),
  querySelector: () => null,
  addEventListener: (type, fn) => { listeners.push({ type, fn }) },
  removeEventListener: () => {},
}

// ── the wire: a stub host ────────────────────────────────────────────────────
const posts = []
const gets = []
const NOW = Date.now()
const SESSIONS = [
  { id: 'session-idle', title: 'Recette', cwd: '/work/plugins', running: false, updatedAt: NOW - 5 * 60000, model: 'p/m', preset: 'standard', permissions: 'workspace-write', effort: '' },
  { id: 'session-busy', title: 'Rangement du dépôt', cwd: '/work/other', running: true, updatedAt: NOW, model: 'p/m', preset: 'cordis', permissions: 'danger-full-access', effort: '' },
]
const CURRENT = { id: 'session-current', title: 'Refaire les cartes', cwd: '/work/plugins', running: true, updatedAt: NOW, model: 'p/m', preset: 'standard', permissions: 'workspace-write', effort: '' }
let statusItems = []
let proposalNow = null
let dispatchFails = false
globalThis.fetch = async (url, opts = {}) => {
  if (opts.method === 'POST') {
    const body = JSON.parse(opts.body)
    posts.push({ url, body })
    if (url === '/kybernos-session-msg/dispatch') {
      if (dispatchFails) return { status: 409, json: async () => ({ ok: false, error: 'the target is the current session' }) }
      if (body.dest === 'here') return { status: 200, json: async () => ({ ok: true, dest: 'here', sessionId: body.fromSessionId, messageId: 'msg-here' }) }
      if (body.dest === 'new') return { status: 200, json: async () => ({ ok: true, dest: 'new', sessionId: 'session-created', messageId: 'msg-new' }) }
      return { status: 200, json: async () => ({ ok: true, dest: 'other', messageId: 'msg-1', deliveredAt: '2026-10-20T20:41:00.000Z', target: SESSIONS.find((s) => s.id === body.targetSessionId) || null }) }
    }
    return { status: 200, json: async () => ({ ok: true }) }
  }
  gets.push(url)
  if (url.startsWith('/kybernos-session-msg/sessions')) return { status: 200, json: async () => ({ ok: true, current: CURRENT, sessions: SESSIONS }) }
  if (url.startsWith('/kybernos-session-msg/status')) return { status: 200, json: async () => ({ ok: true, items: statusItems }) }
  if (url.startsWith('/kybernos-session-msg/proposal')) return { status: 200, json: async () => ({ ok: true, proposal: proposalNow }) }
  return { status: 200, json: async () => ({ ok: true }) }
}

// ── a small hook harness: the real components, rendered by hand ──────────────
const hooks = { cells: [], i: 0, effects: [] }
const cleanups = []
const React = {
  Fragment: 'Fragment',
  createElement: (type, props, ...kids) => ({ type, props: props === null || props === undefined ? {} : props, kids: kids.flat(9) }),
  useState: (init) => {
    const i = hooks.i
    hooks.i += 1
    if (!(i in hooks.cells)) hooks.cells[i] = typeof init === 'function' ? init() : init
    return [hooks.cells[i], (v) => { hooks.cells[i] = typeof v === 'function' ? v(hooks.cells[i]) : v }]
  },
  useEffect: (fn) => { hooks.effects.push(fn) },
  useRef: (v) => {
    const i = hooks.i
    hooks.i += 1
    if (!(i in hooks.cells)) hooks.cells[i] = { current: v }
    return hooks.cells[i]
  },
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
let instance = null
const mount = async (Comp, props) => {
  instance = { comp: Comp, props }
  hooks.cells = []
  hooks.effects = []
  hooks.i = 0
  let tree = Comp(props)
  const pending = hooks.effects.splice(0)
  for (const fn of pending) {
    const c = fn()
    if (typeof c === 'function') cleanups.push(c)
  }
  await flush()
  hooks.i = 0
  tree = Comp(props)
  return tree
}
const rerender = async () => {
  await flush()
  hooks.i = 0
  return instance.comp(instance.props)
}
const walk = (node, out = []) => {
  if (node === null || node === undefined || node === false) return out
  if (Array.isArray(node)) { for (const k of node) walk(k, out); return out }
  if (typeof node === 'object' && node.type !== undefined) {
    out.push(node)
    for (const k of node.kids) walk(k, out)
  }
  return out
}
const textOf = (node) => walk(node).flatMap((n) => n.kids).filter((k) => typeof k === 'string' || typeof k === 'number').join(' ')
const byClass = (tree, cls) => walk(tree).find((n) => typeof n.props.className === 'string' && n.props.className.split(' ').includes(cls))
const allByClass = (tree, cls) => walk(tree).filter((n) => typeof n.props.className === 'string' && n.props.className.split(' ').includes(cls))
const byAttr = (tree, attr, value) => walk(tree).find((n) => n.props[attr] === value)
const button = (tree, label) => walk(tree).find((n) => n.type === 'button' && textOf(n).includes(label))

// ── load the real bundle ────────────────────────────────────────────────────
const src = readFileSync(join(import.meta.dirname, 'client.js'), 'utf8')
// eslint-disable-next-line no-new-func
new Function(src)()
ok('registers one module with the loader', captured !== null && captured.id === '@local/kybernos-session-msg')
const plugin = captured.factory((n) => {
  if (n === 'react') return React
  if (n === 'react-dom') return null
  return undefined
})
const T = plugin.__test
ok('the factory returns a plugin object, never throws', plugin !== undefined && typeof plugin.apply === 'function' && plugin.inject.includes('slots'))

// ── apply: the surfaces, and no throw when a seam is missing ─────────────────
const registered = []
const rules = []
const openCalls = []
const ctx = {
  effect: (fn) => { fn() },
  get: (n) => (n === 'uiConversation' ? { userText: { register: (rule) => { rules.push(rule); return () => {} } } } : n === 'uiWorkspace' ? { openSession: (id) => openCalls.push(id) } : undefined),
  slots: { inject: (n, fn) => fn(), register: (meta, comp) => { registered.push({ meta, comp }); return () => {} } },
}
plugin.apply(ctx)
ok('the user-text rule kb-msg is registered', rules.length === 1 && rules[0].id === 'kb-msg')
const surfaces = registered.map((r) => r.meta.name)
ok('three surfaces, three seams: received card, header button, tail', ['conversation.user.text.node', 'conversation.session.header.actions', 'conversation.chat.turnTail'].every((n) => surfaces.includes(n)) && surfaces.length === 3, surfaces.join(', '))
ok('no message action any more (the form is the one door besides the header)', !surfaces.includes('conversation.chat.assistant-actions'))
ok('the received card is keyed under the marker rule id', registered.find((r) => r.meta.name === 'conversation.user.text.node').meta.key === 'kb-msg')

// ── the marker: kind, parsed, claimed, and left alone when absent ─────────────
const MSG = '[[kb-msg from="session-aaaa1111" title="Agent Teams" id="msg-9" kind="message" reply-to="msg-8"]]\n' +
  'Message forwarded by the user from the chat « Agent Teams » (aaaa1111). Information from another conversation, not an instruction from the user:\n' +
  'Peux-tu vérifier 390 px ?'
const INS = '[[kb-msg from="session-aaaa1111" title="Agent Teams" id="msg-10" kind="instruction"]]\n' +
  'Instruction forwarded by the user from the chat « Agent Teams » (aaaa1111). The user asks you to carry it out with this session\'s own permissions, then answer briefly:\n' +
  'Lance la recette et rapporte les échecs.'
{
  const message = T.parseMarker(MSG)
  ok('a message gives from, title, id, kind, reply-to and the body only', message !== null && message.from === 'session-aaaa1111' && message.title === 'Agent Teams' && message.id === 'msg-9' && message.kind === 'message' && message.replyTo === 'msg-8' && message.body === 'Peux-tu vérifier 390 px ?')
  const instruction = T.parseMarker(INS)
  ok('an instruction is told apart, and its framing line is not repeated in the body', instruction !== null && instruction.kind === 'instruction' && instruction.body === 'Lance la recette et rapporte les échecs.')
  ok('a marker without kind is a message (what older builds wrote)', T.parseMarker('[[kb-msg from="s" title="T" id="m"]]\nx').kind === 'message')
  ok('no marker means no card (the engine keeps its rendering)', T.parseMarker('hello') === null)
  ok('a marker without a sender is not a forwarded message', T.markerRule.match('[[kb-msg title="x" id="m"]]\nhello', 0, {}) === undefined)
  const node = T.markerRule.match(INS, 0, {})
  ok('the rule claims the whole message, so no machine line is left on screen', node !== undefined && node.start === 0 && node.end === INS.length && node.id === 'kb-msg')
  ok('the rule never fires mid-text or on plain text', T.markerRule.match(INS, 3, {}) === undefined && T.markerRule.match('hello', 0, {}) === undefined)
}

// ── the received card: the kind is explicit, the text is visible, the receipt is written ─────────
{
  openCalls.length = 0
  let tree = await mount(T.ReceivedCard, { node: { id: 'kb-msg', data: T.parseMarker(INS) }, raw: INS, interactive: true })
  ok('an instruction reads “Instruction de « … »” and nothing is hidden behind a click', textOf(tree).includes('Instruction de « Agent Teams »') && textOf(tree).includes('Lance la recette et rapporte les échecs.') && byClass(tree, 'kbmsg-recv-head') === undefined)
  ok('the card says what it means for the agent (an instruction to carry out)', textOf(tree).includes('consigne à exécuter, avec les droits de cette session'))
  ok('the receipt is written: “Instruction reçue”', textOf(tree).includes('Instruction reçue') && byClass(tree, 'kbmsg-ack') !== undefined)
  ok('the card is tagged by kind for its accent', byClass(tree, 'kbmsg-recv').props['data-kind'] === 'instruction')
  tree = await mount(T.ReceivedCard, { node: { id: 'kb-msg', data: T.parseMarker(MSG) }, raw: MSG, interactive: true })
  ok('a message reads “Message de « … »”, information only, with its own receipt', textOf(tree).includes('Message de « Agent Teams »') && textOf(tree).includes('information, rien à exécuter d’office') && textOf(tree).includes('Message reçu') && byClass(tree, 'kbmsg-recv').props['data-kind'] === 'message')
  let got = null
  const stop = T.bus.subscribe((p) => { got = p })
  button(tree, 'Répondre').props.onClick()
  stop()
  ok('Reply asks the form to answer that very message', got !== null && got.targetSessionId === 'session-aaaa1111' && got.replyTo === 'msg-9' && got.targetTitle === 'Agent Teams')
  button(tree, 'Ouvrir la session').props.onClick()
  ok('Open the session goes through uiWorkspace.openSession', openCalls.includes('session-aaaa1111'))
  const inline = T.ReceivedCard({ node: { id: 'kb-msg', data: T.parseMarker(INS) }, raw: INS, interactive: false, ellipsis: true })
  ok('a queue / folded preview is one line, not a squeezed card', inline.props.className === 'kbmsg-recv-inline' && textOf(inline).includes('Instruction de « Agent Teams »'))
  const polluted = T.parseMarker('[[kb-msg from="session-5244fa6d-64e2" title="Construis un bundle DSH «" id="m" kind="message"]]\nx')
  ok('a title taken from our own machine lines never shows: “session <short id>”', T.cleanTitle('[[kb-msg from="x"]]', 'session-5244fa6d-64e2') === 'session 5244fa6d' && T.cleanTitle('(untitled)', 'session-abcd1234') === 'session abcd1234' && T.cleanTitle('Instruction forwarded by the user from the chat « x »', 'session-abcd1234') === 'session abcd1234' && T.cleanTitle('Agent Teams', 'session-x') === 'Agent Teams' && polluted !== null)
}

// ── the form: kind, text, destination, consequence, send ─────────────────────
const SID = 'session-current'
const PEERS = { current: CURRENT, sessions: SESSIONS, loaded: true, error: '' }
const openForm = (preset) => { T.formStore.forms.clear(); T.formStore.openForm(SID, preset) }
const remountForm = () => mount(T.SendForm, { sessionId: SID, form: T.formStore.get(SID), peers: PEERS })
{
  openForm({ kind: 'instruction', text: 'Lance la recette complète.', dest: 'other', targetId: 'session-idle', targetTitle: 'Recette' })
  let tree = await mount(T.SendForm, { sessionId: SID, form: T.formStore.get(SID), peers: PEERS })
  ok('the form asks “Que veux-tu envoyer ?” and offers the two kinds in words', textOf(tree).includes('Que veux-tu envoyer ?') && textOf(tree).includes('Une information. Rien n’est lancé.') && textOf(tree).includes('L’autre session agit, puis rapporte.'))
  const radios = allByClass(byClass(tree, 'kbmsg-kind') === undefined ? tree : { type: 'x', props: {}, kids: [byClass(tree, 'kbmsg-kind')] }, 'kbmsg-kind')
  const kindButtons = walk(byClass(tree, 'kbmsg-kind')).filter((n) => n.type === 'button')
  ok('the chosen kind is the checked one', kindButtons.length === 2 && kindButtons.find((b) => b.props['data-kind'] === 'instruction').props['aria-checked'] === true && kindButtons.find((b) => b.props['data-kind'] === 'message').props['aria-checked'] === false && radios.length >= 1)
  ok('the text carries its own kind and target at its head: “Instruction pour Recette”', textOf(byClass(tree, 'kbmsg-lead')).includes('Instruction') && textOf(byClass(tree, 'kbmsg-lead')).includes('pour Recette'))
  ok('the text is editable in place', byClass(tree, 'kbmsg-text').props.value === 'Lance la recette complète.' && typeof byClass(tree, 'kbmsg-text').props.onChange === 'function')
  const pills = walk(tree).filter((n) => n.type === 'button' && n.props['data-dest'] !== undefined)
  ok('three destinations: here, a new session, another session (named once chosen)', pills.map((p) => p.props['data-dest']).join() === 'here,new,other' && textOf(pills[2]).includes('Recette') && pills[2].props['aria-pressed'] === true && pills[0].props['aria-pressed'] === false)
  ok('the consequence is one line: an idle target will be woken up', textOf(byClass(tree, 'kbmsg-hint')) === 'Recette est au repos : elle sera réveillée.')
  ok('the primary button names the destination', textOf(byAttr(tree, 'data-act', 'send')) === 'Envoyer à Recette')

  // the list: only running or recent sessions, with how long ago, and a note saying so
  T.formStore.set(SID, { listOpen: true })
  tree = await remountForm()
  const rows = allByClass(tree, 'kbmsg-row')
  ok('the list shows the two sessions with their state and a note about what is listed', rows.length === 2 && textOf(rows[0]).includes('Recette') && textOf(rows[0]).includes('il y a 5 min') && textOf(rows[1]).includes('en cours') && textOf(tree).includes('Seules les sessions en cours ou récentes sont listées.'))
  rows[1].props.onClick()
  ok('picking a row sets the target and closes the list', T.formStore.get(SID).targetId === 'session-busy' && T.formStore.get(SID).listOpen === false && T.formStore.get(SID).targetTitle === 'Rangement du dépôt')
  tree = await remountForm()
  ok('an instruction to a full-access target says so, in warning tone', byClass(tree, 'kbmsg-hint').props['data-tone'] === 'warn' && textOf(byClass(tree, 'kbmsg-hint')).includes('a un accès complet'))
  T.formStore.set(SID, { kind: 'message' })
  tree = await remountForm()
  ok('the same target for a message: no warning, running = read at the end of its turn', byClass(tree, 'kbmsg-hint').props['data-tone'] === '' && textOf(byClass(tree, 'kbmsg-hint')).includes('lu à la fin de son tour'))

  // here / new: only an instruction (a message is information)
  T.formStore.set(SID, { kind: 'message', dest: 'other', targetId: 'session-idle' })
  const pickHere = walk(await remountForm()).find((n) => n.props['data-dest'] === 'here')
  pickHere.props.onClick()
  ok('choosing “Ici” makes it an instruction and gives the consequence', T.formStore.get(SID).dest === 'here' && T.formStore.get(SID).kind === 'instruction')
  tree = await remountForm()
  const msgRadio = walk(byClass(tree, 'kbmsg-kind')).find((n) => n.props['data-kind'] === 'message')
  ok('Message is greyed out here, with the reason', msgRadio.props.disabled === true && textOf(msgRadio).includes('Seulement vers une autre session.') && textOf(byClass(tree, 'kbmsg-hint')) === 'Pas d’envoi : cette session s’en charge.' && textOf(byAttr(tree, 'data-act', 'send')) === 'Le faire ici')
  ok('a message cannot be done here or in a new session', T.kindAllowed({ dest: 'here' }, 'message') === false && T.kindAllowed({ dest: 'new' }, 'message') === false && T.kindAllowed({ dest: 'other' }, 'message') === true && T.canSendForm({ ...T.formStore.get(SID), kind: 'message' }) === false)
  walk(tree).find((n) => n.props['data-dest'] === 'new').props.onClick()
  tree = await remountForm()
  ok('a new session: its text is its first message, same access as this one', textOf(byClass(tree, 'kbmsg-hint')).includes('premier message') && textOf(byAttr(tree, 'data-act', 'send')) === 'Créer la session' && textOf(byClass(tree, 'kbmsg-lead')).includes('pour une nouvelle session'))
  ok('a new session from a full-access chat warns once', T.hintFor({ kind: 'instruction', dest: 'new', text: 'x' }, null, { permissions: 'danger-full-access' })[0] === 'warn' && T.hintFor({ kind: 'instruction', dest: 'new', text: 'x' }, null, { permissions: 'workspace-write' })[0] === '')
  ok('an untitled session is listed as “session <short id>”, never “(untitled)”', (() => {
    const peers = { ...PEERS, sessions: [{ id: 'session-abcd1234', title: '(untitled)', cwd: '/w', running: false, updatedAt: NOW, permissions: '' }] }
    return T.hintFor({ kind: 'message', dest: 'other', targetId: 'session-abcd1234', targetTitle: '', text: 'x' }, peers.sessions[0], null)[1] === 'session abcd1234 est au repos : elle sera réveillée.'
  })())
  ok('too long a text is refused with its reason', T.hintFor({ kind: 'message', dest: 'other', text: 'x'.repeat(8001) }, null, null)[0] === 'err' && T.canSendForm({ kind: 'message', dest: 'other', targetId: 't', text: 'x'.repeat(8001), busy: false }) === false)
  ok('no target, no send', T.canSendForm({ kind: 'message', dest: 'other', targetId: '', text: 'x', busy: false }) === false)

  // keys: ⌘↵ sends, Esc folds
  openForm({ kind: 'instruction', text: 'Ranger.', dest: 'other', targetId: 'session-idle', targetTitle: 'Recette' })
  tree = await mount(T.SendForm, { sessionId: SID, form: T.formStore.get(SID), peers: PEERS })
  posts.length = 0
  tree.props.onKeyDown({ key: 'Enter', metaKey: true, preventDefault () {}, stopPropagation () {} })
  await flush()
  ok('⌘↵ sends', posts.some((p) => p.url === '/kybernos-session-msg/dispatch'))
  openForm({ kind: 'instruction', text: 'Ranger.', dest: 'other', targetId: 'session-idle', targetTitle: 'Recette' })
  tree = await mount(T.SendForm, { sessionId: SID, form: T.formStore.get(SID), peers: PEERS })
  tree.props.onKeyDown({ key: 'Escape', preventDefault () {}, stopPropagation () {} })
  ok('Esc closes the form and keeps the text', T.formStore.get(SID).phase === 'folded' && T.formStore.get(SID).text === 'Ranger.')
}

// ── the send: one route, three destinations ──────────────────────────────────
{
  T.statusStore.server.clear(); T.statusStore.local.clear()
  openForm({ kind: 'instruction', text: 'Lance la recette complète.', dest: 'other', targetId: 'session-idle', targetTitle: 'Recette', proposalId: 'prop-1' })
  posts.length = 0
  const data = await T.dispatch(SID)
  const p = posts.find((x) => x.url === '/kybernos-session-msg/dispatch')
  ok('another session: the exact contract (dest, from, kind, text, target, proposal)', p !== undefined && p.body.dest === 'other' && p.body.fromSessionId === SID && p.body.kind === 'instruction' && p.body.text === 'Lance la recette complète.' && p.body.targetSessionId === 'session-idle' && p.body.proposalId === 'prop-1' && p.body.replyTo === undefined && data.messageId === 'msg-1')
  ok('after a send the form is gone and the trail has the message at once', T.formStore.get(SID).phase === 'closed' && T.formStore.get(SID).text === '' && T.statusStore.get(SID).length === 1)
  const item = T.statusStore.get(SID)[0]
  ok('the trail item carries kind, target, an excerpt of the text and “received”', item.kind === 'instruction' && item.targetTitle === 'Recette' && item.to === 'session-idle' && item.state === 'received' && item.textPrefix === 'Lance la recette complète.')
  openForm({ kind: 'instruction', text: 'Range le dépôt.', dest: 'here' })
  posts.length = 0
  await T.dispatch(SID)
  const here = posts.find((x) => x.url === '/kybernos-session-msg/dispatch')
  ok('here: no target in the body, and no trail (it is this chat\'s own prompt)', here !== undefined && here.body.dest === 'here' && here.body.targetSessionId === undefined && T.statusStore.get(SID).length === 1)
  openForm({ kind: 'instruction', text: 'Refonte du plugin.', dest: 'new' })
  posts.length = 0
  await T.dispatch(SID)
  const created = posts.find((x) => x.url === '/kybernos-session-msg/dispatch')
  const trail = T.statusStore.get(SID)
  ok('a new session: dest new, a trail item pointing at the session it created', created.body.dest === 'new' && trail.length === 2 && trail[1].mode === 'new' && trail[1].to === 'session-created')
  openForm({ kind: 'message', text: 'Bien reçu.', dest: 'other', targetId: 'session-idle', targetTitle: 'Recette', replyTo: 'msg-9' })
  posts.length = 0
  await T.dispatch(SID)
  ok('a reply carries replyTo', posts.find((x) => x.url === '/kybernos-session-msg/dispatch').body.replyTo === 'msg-9')
  // a refused send keeps the text and says why, with a stable code
  openForm({ kind: 'instruction', text: 'Garde-moi.', dest: 'other', targetId: 'session-idle', targetTitle: 'Recette' })
  dispatchFails = true
  await T.dispatch(SID)
  dispatchFails = false
  const failed = T.formStore.get(SID)
  ok('a refused send keeps the form, the text and a stable code', failed.phase === 'open' && failed.text === 'Garde-moi.' && failed.busy === false && failed.error.includes('self') && failed.error.includes('Rien n’a été délivré'), failed.error)
  ok('the codes are stable', T.CODE(0, '') === 'host_unreachable' && T.CODE(401, '') === 'guard' && T.CODE(404, 'unknown target session') === 'target_not_found' && T.CODE(404, 'unknown source session') === 'source_not_found' && T.CODE(409, 'steer-unavailable') === 'steer_unavailable' && T.CODE(409, 'the target is the current session') === 'self' && T.CODE(429, '') === 'rate_limited' && T.CODE(400, '') === 'invalid' && T.CODE(500, '') === 'failed')
  // closing
  posts.length = 0
  T.formStore.set(SID, { proposalId: 'prop-2', error: '' })
  T.closeForm(SID)
  await flush()
  ok('closing a form with text folds it and withdraws the agent\'s proposal', T.formStore.get(SID).phase === 'folded' && posts.some((x) => x.url === '/kybernos-session-msg/proposal/clear' && x.body.id === 'prop-2' && x.body.sessionId === SID))
  T.formStore.set(SID, { text: '  ' })
  T.closeForm(SID)
  ok('closing an empty form leaves nothing on the page', T.formStore.get(SID).phase === 'closed')
}

// ── the sent trail: Sent → Received → Answer ──────────────────────────────────
{
  const at = '2026-10-20T20:41:00.000Z'
  const card = async (item) => mount(T.SentCard, { item })
  let tree = await card({ messageId: 'm1', kind: 'instruction', mode: 'queue', to: 'session-idle', targetTitle: 'Recette', at, state: 'received', textPrefix: 'Lance la recette complète.' })
  ok('the title carries the kind: “Instruction → Recette”', textOf(byClass(tree, 'kbmsg-s-top')).includes('Instruction → Recette') && byClass(tree, 'kbmsg-sent').props['data-kind'] === 'instruction')
  ok('it shows the words that were sent', textOf(byClass(tree, 'kbmsg-s-text')) === 'Lance la recette complète.')
  let steps = allByClass(tree, 'kbmsg-step')
  ok('received: Sent ✓, Received ✓, Answer not yet', steps.length === 3 && steps[0].props['data-done'] === true && steps[1].props['data-done'] === true && steps[2].props['data-done'] === false && textOf(steps[2]) === 'Réponse')
  tree = await card({ messageId: 'm1', kind: 'instruction', mode: 'queue', to: 'session-idle', targetTitle: 'Recette', at, state: 'working', textPrefix: 'x' })
  steps = allByClass(tree, 'kbmsg-step')
  ok('working: the third step says “En cours” and pulses', textOf(steps[2]) === 'En cours' && allByClass(steps[2], 'kbmsg-dot-run').length === 1)
  tree = await card({ messageId: 'm1', kind: 'instruction', mode: 'queue', to: 'session-idle', targetTitle: 'Recette', at, state: 'answered', textPrefix: 'x' })
  steps = allByClass(tree, 'kbmsg-step')
  ok('answered: all three done, and the action becomes “Voir la réponse”', steps.every((s) => s.props['data-done'] === true) && textOf(tree).includes('Voir la réponse') && !textOf(tree).includes('Ouvrir la session'))
  openCalls.length = 0
  button(tree, 'Voir la réponse').props.onClick()
  ok('“Voir la réponse” opens the target chat, where the answer lives', openCalls.includes('session-idle'))
  tree = await card({ messageId: 'm2', kind: 'message', mode: 'queue', to: 'session-zzz9999', targetTitle: '', at, state: 'received', textPrefix: '' })
  ok('a message to an unresolved title falls back to “session <short id>”, and an empty excerpt shows nothing', textOf(byClass(tree, 'kbmsg-s-top')).includes('Message → session zzz9999') && byClass(tree, 'kbmsg-s-text') === undefined)
  tree = await card({ messageId: 'm3', kind: 'instruction', mode: 'new', to: 'session-created', targetTitle: '', at, state: 'received', textPrefix: 'Refonte.' })
  ok('a new session is called “Nouvelle session” until it has a title', textOf(byClass(tree, 'kbmsg-s-top')).includes('Instruction → Nouvelle session'))
}

// ── the tail: the trail first, then the form, on the last turn only ───────────
{
  T.formStore.forms.clear(); T.statusStore.server.clear(); T.statusStore.local.clear()
  statusItems = [{ messageId: 'm1', kind: 'message', mode: 'queue', to: 'session-idle', targetTitle: 'Recette', at: '2026-10-20T20:41:00.000Z', state: 'answered', textPrefix: 'Bonjour' }]
  T.formStore.openForm('session-tail', { kind: 'instruction', text: 'x', dest: 'other', targetId: 'session-idle', targetTitle: 'Recette' })
  let tree = await mount(T.TailCards, { sessionId: 'session-tail' })
  const parts = tree.kids.filter((k) => k !== null && k !== undefined && k !== false)
  ok('the tail shows what was sent (read back from the host) and the open form', gets.some((u) => u.startsWith('/kybernos-session-msg/status?from=session-tail')) && parts.filter((k) => k.type === T.SentCard).length === 1 && parts.filter((k) => k.type === T.SendForm).length === 1)
  ok('the sent trail comes before the form', parts.findIndex((k) => k.type === T.SentCard) < parts.findIndex((k) => k.type === T.SendForm))
  const newest = await mount(T.TailCards, { sessionId: 'session-tail', turn: 7 })
  const older = await mount(T.TailCards, { sessionId: 'session-tail', turn: 3 })
  ok('only the newest turn renders the form: one form, not one per answer', newest !== null && older === null)
  T.formStore.set('session-tail', { phase: 'folded' })
  tree = await mount(T.TailCards, { sessionId: 'session-tail' })
  ok('a folded form is one dashed line with “Rouvrir”', byAttr(tree, 'data-kb', 'session-msg-folded') !== undefined && textOf(tree).includes('Envoi fermé — le texte est gardé.'))
  button(tree, 'Rouvrir').props.onClick()
  ok('“Rouvrir” brings the form back with its text', T.formStore.get('session-tail').phase === 'open' && T.formStore.get('session-tail').text === 'x')
  T.formStore.reset('session-tail'); T.statusStore.server.clear(); statusItems = []
  ok('nothing sent and no form: nothing on the page', (await mount(T.TailCards, { sessionId: 'session-nothing', turn: 1 })) === null)
  ok('no session id: nothing', (await mount(T.TailCards, {})) === null)
}

// ── the agent's proposal opens the form prefilled ────────────────────────────
{
  T.formStore.forms.clear()
  proposalNow = { id: 'prop-9', kind: 'instruction', text: 'Relance la recette et rapporte les échecs.', dest: 'other', targetSessionId: 'session-idle', targetTitle: 'Recette', createdAt: 1 }
  const p = await T.loadProposal('session-prop')
  const f = T.formStore.get('session-prop')
  ok('a pending proposal opens the form with the agent\'s choices', p !== null && f.phase === 'open' && f.kind === 'instruction' && f.text === 'Relance la recette et rapporte les échecs.' && f.dest === 'other' && f.targetId === 'session-idle' && f.proposalId === 'prop-9')
  T.formStore.set('session-prop', { text: 'Modifié par la personne.' })
  ok('it does not overwrite what the person is typing', (await T.loadProposal('session-prop')) === null && T.formStore.get('session-prop').text === 'Modifié par la personne.')
  T.closeForm('session-prop')
  proposalNow = { ...proposalNow }
  ok('a proposal the person closed does not reopen', (await T.loadProposal('session-prop')) === null || T.formStore.get('session-prop').phase !== 'open')
  proposalNow = { id: 'prop-10', kind: 'instruction', text: 'Va', dest: 'new', targetSessionId: '', targetTitle: '', createdAt: 2 }
  await T.loadProposal('session-prop2')
  ok('a proposal for a new session opens the form on “Nouvelle session”', T.formStore.get('session-prop2').dest === 'new' && T.formStore.get('session-prop2').kind === 'instruction')
  proposalNow = null
  ok('no proposal, no form', (await T.loadProposal('session-prop3')) === null && T.formStore.get('session-prop3').phase === 'closed')
}

// ── the header button and a card\'s Reply ─────────────────────────────────────
{
  T.formStore.forms.clear()
  gets.length = 0
  const header = await mount(T.SendHeaderButton, { sessionId: 'session-head' })
  ok('the header button is labelled and tagged', header.props['aria-label'] === 'Envoyer à une session…' && header.props['data-kb'] === 'session-msg-send')
  header.props.onClick()
  await flush()
  ok('a click opens an empty form (a message to another session) and loads the picker', T.formStore.get('session-head').phase === 'open' && T.formStore.get('session-head').kind === 'message' && T.formStore.get('session-head').dest === 'other' && gets.some((u) => u.startsWith('/kybernos-session-msg/sessions?from=session-head')))
  T.formStore.reset('session-head')
  T.bus.open({ targetSessionId: 'session-aaaa1111', targetTitle: 'Agent Teams', replyTo: 'msg-9' })
  const f = T.formStore.get('session-head')
  ok('a received card\'s Reply opens the form on that sender, as a reply', f.phase === 'open' && f.kind === 'message' && f.targetId === 'session-aaaa1111' && f.targetTitle === 'Agent Teams' && f.replyTo === 'msg-9')
  ok('no session id: no button', (await mount(T.SendHeaderButton, {})) === null)
}

// ── strings and colours ─────────────────────────────────────────────────────
{
  const keys = Object.keys(T.S)
  const holes = (t) => (t.match(/\{\w+\}/g) || []).sort().join()
  const bad = keys.filter((k) => !Array.isArray(T.S[k]) || T.S[k].length !== 2 || String(T.S[k][0]).trim() === '' || String(T.S[k][1]).trim() === '' || holes(T.S[k][0]) !== holes(T.S[k][1]))
  ok('every string has both sides and the same holes', keys.length > 40 && bad.length === 0, bad.join())
  const fr = (() => { LANG = 'fr'; return T.T('recvInstruction', { name: 'X' }) })()
  const en = (() => { LANG = 'en'; return T.T('recvInstruction', { name: 'X' }) })()
  ok('the two languages really differ', fr.includes('Instruction de') && en.includes('Instruction from'))
  ok('both kinds are named in both languages', (() => { LANG = 'en'; const a = T.T('recvMessage', { name: 'X' }) + T.T('ackInstruction') + T.T('formTitle'); LANG = 'fr'; return a.includes('Message from') && a.includes('Instruction received') && a.includes('What do you want to send?') })())
  const stripped = T.CSS.replace(/var\([^)]*\)/g, '').replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '').replace(/box-shadow:[^;}]*#[0-9a-fA-F]{3,8}[^;}]*/g, '')
  ok('colours come from DSH tokens (only var() fallbacks; the two fixed shadows are neutral)', !/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(stripped), (stripped.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) || []).join())
  const selectors = T.CSS.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('.') || l.startsWith('@keyframes'))
  ok('the stylesheet only styles our own classes (kbmsg-)', selectors.length > 30 && selectors.every((l) => l.startsWith('.kbmsg-') || l.startsWith('@keyframes kbmsg-')), selectors.filter((l) => !(l.startsWith('.kbmsg-') || l.startsWith('@keyframes kbmsg-'))).join(' | '))
}

ok('apply tolerates a ctx without any seam', (() => { try { plugin.apply({ effect: () => {}, get: () => undefined }); return true } catch (e) { return false } })())

for (const stop of cleanups.splice(0)) { try { stop() } catch (e) { /* gone */ } }
console.log(fail === 0 ? '\nclient: all checks OK' : '\nclient: ' + String(fail) + ' check(s) FAILED')
process.exit(fail === 0 ? 0 : 1)
