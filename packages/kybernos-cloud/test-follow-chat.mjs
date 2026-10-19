// The active team follows the chat on screen: the page half (teams plan, option 2).
//   node packages/kybernos-cloud/test-follow-chat.mjs
//
// The blocks `team-folder` and `follow-chat` are cut out of client.js and run on their own, against FAKE DSH services (the workspaces list, the sessions list, the selection of the
// main view), a fake host (`space/for-folder`) and a manual clock, so what is proven is the shipped code: a chat opened (or the page loaded on one) is reported to the host with its
// own folder and the switch the host asks for is made without a new chat; the same chat is not asked about again for every list update; a chat change while the host is still
// answering drops the old answer; a switch that failed is tried again at the next report; the periodic report reaches the host but never switches by itself; a service that
// is missing or throws changes nothing. The rendered footer that mounts this is pinned in test-cloud-client.mjs; the real DSH is scripts/check-follow-chat-live.mjs.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + JSON.stringify(detail)))
  if (!ok) failed += 1
}

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, 'client.js'), 'utf8')
const cut = (name) => {
  const from = source.indexOf('// <' + name + ':begin>')
  const to = source.indexOf('// <' + name + ':end>', from)
  check('the block ' + name + ' is where the test expects it', from > 0 && to > from)
  return source.slice(from, to)
}
const lib = new Function(cut('team-folder') + '\n' + cut('follow-chat') + '\nreturn { chatOnScreen, createFollower, switchIsMoot, FOLLOW_LOOK_DELAY_MS, FOLLOW_REPORT_MS }')()
const { chatOnScreen, createFollower, switchIsMoot, FOLLOW_LOOK_DELAY_MS, FOLLOW_REPORT_MS } = lib

const ACME = '/home/u/Documents/Kybernos/Acme'
const WORK = '/home/u/work/app'

/** A manual clock: timers fire when time is advanced; `advance` also lets the promises that the fired callbacks started settle. */
const clock = () => {
  let now = 0
  let next = 1
  const timers = new Map()
  const api = {
    set: (fn, ms) => { const id = next++; timers.set(id, { at: now + ms, fn, every: null }); return id },
    clear: (id) => { timers.delete(id) },
    every: (fn, ms) => { const id = next++; timers.set(id, { at: now + ms, fn, every: ms }); return id },
    stop: (id) => { timers.delete(id) },
    pending: () => timers.size,
    advance: async (ms) => {
      const end = now + ms
      for (;;) {
        const due = Array.from(timers.entries()).filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (due === undefined) break
        const [id, t] = due
        now = t.at
        if (t.every !== null) t.at = now + t.every; else timers.delete(id)
        t.fn()
        await settle()
      }
      now = end
      await settle()
    },
  }
  return api
}
const settle = async () => { for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setImmediate(resolve)) }

/** Fake DSH: sessions with their own folder, workspaces that list them, the main view's selection. Every store can be listened to. */
const world = (opts = {}) => {
  const state = { sid: opts.sid === undefined ? 's-work' : opts.sid, cwd: { 's-work': WORK, 's-acme': ACME, ...(opts.cwd || {}) }, rows: [{ workspaceId: 'w-work', path: WORK, sessionIds: ['s-work'] }, { workspaceId: 'w-acme', path: ACME, sessionIds: ['s-acme'] }] }
  const listeners = { workspaces: new Set(), sessions: new Set(), selection: new Set() }
  const store = (name, snapshot) => ({ getSnapshot: snapshot, subscribe: (f) => { if (opts.noSubscribe === name) throw new Error('no store'); listeners[name].add(f); return () => listeners[name].delete(f) } })
  const services = {
    workspaces: { list: store('workspaces', () => ({ items: state.rows.map((r) => ({ ...r })) })) },
    sessions: opts.noSessions === true ? null : { list: store('sessions', () => ({ byId: Object.fromEntries(Object.keys(state.cwd).map((id) => [id, { id, cwd: state.cwd[id] }])) })) },
    uiWorkspace: {
      get mainReference() { return state.sid === null || opts.noMain === true ? undefined : { sessionId: state.sid } },
      selection: store('selection', () => (state.sid === null ? {} : { sessionId: state.sid })),
    },
  }
  return {
    state,
    services,
    open: (sid) => { state.sid = sid; listeners.selection.forEach((f) => f()) },
    touchLists: () => { listeners.workspaces.forEach((f) => f()); listeners.sessions.forEach((f) => f()) },
    subscribers: () => listeners.workspaces.size + listeners.sessions.size + listeners.selection.size,
  }
}

/** A fake host that answers like `space/for-folder`: a chat in ACME belongs to the team 'acme', anything else to Personal. `active` is the id of the active space. */
const host = (active = 'me') => {
  const h = { active, asked: [], delay: 0, down: false, bad: false, release: null }
  h.ask = async (chat) => {
    h.asked.push({ path: chat.path, sid: chat.sid })
    if (h.down) throw new Error('offline')
    if (h.delay > 0) await new Promise((resolve) => { h.release = resolve })
    if (h.bad) return { ok: false, error: 'non_connecte' }
    const team = chat.path === ACME || chat.path.startsWith(ACME + '/')
    const id = team ? 'acme' : 'me'
    return { ok: true, kind: team ? 'team' : 'personal', space_id: id, space_name: team ? 'Acme' : 'My workspace', active_id: h.active, follow: id !== h.active }
  }
  return h
}

const rig = (opts = {}) => {
  const w = world(opts.world)
  const h = host(opts.active)
  const c = clock()
  const picks = []
  const heard = []
  const follower = createFollower({
    seen: opts.seenThrows === true ? () => { throw new Error('footer gone') } : (answer) => { heard.push(answer.active_id) },
    services: () => (opts.noServices === true ? null : w.services),
    ask: opts.ask || h.ask,
    pick: opts.pick || (async (id, name) => { picks.push({ id, name }); if (opts.pickFails === true) return { ok: false, error: 'busy_switching' }; h.active = id; return { ok: true } }),
    timers: c,
  })
  return { w, h, c, picks, heard, follower, stop: follower.mount() }
}

// ── the chat on screen ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const w = world()
  const here = chatOnScreen(w.services)
  check('the chat on screen, with the folder it works in', here !== null && here.sid === 's-work' && here.path === WORK, here)
  w.state.cwd['s-work'] = '/home/u/elsewhere'
  check('the session\'s OWN folder wins over its workspace\'s', chatOnScreen(w.services).path === '/home/u/elsewhere')
  check('without the sessions service the workspace that lists the chat tells', chatOnScreen(world({ noSessions: true }).services).path === WORK)
  check('no chat open: null', chatOnScreen(world({ sid: null }).services) === null)
  check('a chat DSH has not listed yet: null', chatOnScreen(world({ sid: 's-unknown', noSessions: true }).services) === null)
  check('the selection store tells when the main reference is not there', chatOnScreen(world({ noMain: true }).services).sid === 's-work')
  check('services missing: null, no throw', chatOnScreen(null) === null && chatOnScreen({}) === null && chatOnScreen({ uiWorkspace: { get mainReference() { throw new Error('boom') } } }) === null)
}

// ── the footer's idea of the active team is not the host's ─────────────────────────────────────────────────────────────────────────────────────
check('a click on the team the footer says is active has nothing to do', switchIsMoot('acme', 'acme', undefined) === true && switchIsMoot('acme', 'acme', false) === true)
check('a click on another team does', switchIsMoot('acme', 'me', undefined) === false && switchIsMoot('acme', null, undefined) === false)
check('a switch that follows a chat is never moot, whatever the footer says (the host may have switched behind the page, at claim time: the footer is stale)', switchIsMoot('acme', 'acme', true) === false)
check('no usable id is never moot', switchIsMoot(undefined, undefined, undefined) === false && switchIsMoot(null, null, false) === false)

// ── the page loads on a chat in a team's folder ─────────────────────────────────────────────────────────────────────────────────────────────
{
  const r = rig({ world: { sid: 's-acme' } })
  await r.c.advance(FOLLOW_LOOK_DELAY_MS + 1)
  check('it asks the host about the chat on screen, with its folder and its id', JSON.stringify(r.h.asked) === JSON.stringify([{ path: ACME, sid: 's-acme' }]), r.h.asked)
  check('and switches to the team the host names, once', JSON.stringify(r.picks) === JSON.stringify([{ id: 'acme', name: 'Acme' }]), r.picks)
  r.w.touchLists(); r.w.touchLists()
  await r.c.advance(FOLLOW_LOOK_DELAY_MS + 1)
  check('list updates of the same chat do not ask again', r.h.asked.length === 1, r.h.asked)
  r.stop()
}

// ── a chat is opened ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const r = rig({ world: { sid: 's-work' }, active: 'me' })
  await r.c.advance(FOLLOW_LOOK_DELAY_MS + 1)
  check('a personal chat while Personal is active: asked, nothing to switch', r.h.asked.length === 1 && r.picks.length === 0, { asked: r.h.asked.length, picks: r.picks })
  r.w.open('s-acme')
  await r.c.advance(FOLLOW_LOOK_DELAY_MS + 1)
  check('a team chat opened: switched to the team', JSON.stringify(r.picks) === JSON.stringify([{ id: 'acme', name: 'Acme' }]), r.picks)
  r.w.open('s-work')
  await r.c.advance(FOLLOW_LOOK_DELAY_MS + 1)
  check('a personal chat opened again: back to Personal', r.picks.length === 2 && r.picks[1].id === 'me', r.picks)
  r.w.open('s-work')
  r.w.touchLists()
  await r.c.advance(FOLLOW_LOOK_DELAY_MS + 1)
  check('opening the chat that is already on screen asks nothing', r.h.asked.length === 3, r.h.asked.length)
  r.stop()
}
{
  // Five events inside the delay are one look.
  const r = rig({ world: { sid: 's-acme' } })
  for (let i = 0; i < 5; i += 1) r.w.touchLists()
  r.w.open('s-acme')
  await r.c.advance(FOLLOW_LOOK_DELAY_MS + 1)
  check('events inside the delay make one look', r.h.asked.length === 1, r.h.asked.length)
  r.stop()
}

// ── the answer comes after the person moved on ──────────────────────────────────────────────────────────────────────────────────────────────
{
  const r = rig({ world: { sid: 's-acme' } })
  r.h.delay = 1
  await r.c.advance(FOLLOW_LOOK_DELAY_MS + 1)
  check('the host has not answered yet', r.h.asked.length === 1 && r.picks.length === 0)
  const firstRelease = r.h.release
  r.h.delay = 0
  r.w.open('s-work')
  await r.c.advance(FOLLOW_LOOK_DELAY_MS + 1)
  check('the person moved to a personal chat: nothing to switch for it', r.picks.length === 0, r.picks)
  firstRelease()
  await settle()
  check('the late answer about the chat they left is dropped', r.picks.length === 0, r.picks)
  r.stop()
}

// ── a switch that fails is tried again; the report never switches by itself ──────────────────────────────────────────────────────────────────
{
  const r = rig({ world: { sid: 's-acme' }, pickFails: true })
  await r.c.advance(FOLLOW_LOOK_DELAY_MS + 1)
  check('the switch was tried', r.picks.length === 1)
  await r.c.advance(FOLLOW_REPORT_MS + 1)
  check('and tried again at the next report (it did not succeed)', r.picks.length === 2, r.picks)
  r.stop()
}
{
  const r = rig({ world: { sid: 's-acme' } })
  await r.c.advance(FOLLOW_LOOK_DELAY_MS + 1)
  check('first look switched', r.picks.length === 1)
  r.h.active = 'me' // something else moved the active team (the person, by hand)
  await r.c.advance(FOLLOW_REPORT_MS + 1)
  check('the periodic report reaches the host (it repeats the sighting)', r.h.asked.length === 2, r.h.asked.length)
  check('but it does not undo what the person chose by hand: the chat did not change', r.picks.length === 1, r.picks)
  r.stop()
}

// ── the footer is told what the host says ───────────────────────────────────────────────────────────────────────────────────────────────────
{
  const r = rig({ world: { sid: 's-work' } })
  await r.c.advance(FOLLOW_LOOK_DELAY_MS + 1)
  check('every answer of the host is handed to the footer (it can read the state when the host switched behind the page)', JSON.stringify(r.heard) === JSON.stringify(['me']), r.heard)
  r.h.active = 'acme'
  await r.c.advance(FOLLOW_REPORT_MS + 1)
  check('and the next report says the team changed', r.heard.length === 2 && r.heard[1] === 'acme', r.heard)
  r.stop()
  const quiet = rig({ world: { sid: 's-acme' }, seenThrows: true })
  await quiet.c.advance(FOLLOW_LOOK_DELAY_MS + 1)
  check('a footer that throws does not stop the switch', quiet.picks.length === 1, quiet.picks)
  quiet.stop()
}

// ── nothing breaks it ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const down = rig({ world: { sid: 's-acme' } })
  down.h.down = true
  await down.c.advance(FOLLOW_LOOK_DELAY_MS + 1)
  check('a host that does not answer: nothing switched, nothing thrown', down.picks.length === 0 && down.h.asked.length === 1)
  down.h.down = false
  await down.c.advance(FOLLOW_REPORT_MS + 1)
  check('and it is asked again at the next report', down.picks.length === 1, down.picks)
  down.stop()

  const refused = rig({ world: { sid: 's-acme' } })
  refused.h.bad = true
  await refused.c.advance(FOLLOW_LOOK_DELAY_MS + 1)
  check('a host that says not ok: nothing switched', refused.picks.length === 0)
  refused.stop()

  const noServices = rig({ noServices: true })
  await noServices.c.advance(FOLLOW_LOOK_DELAY_MS + 1)
  check('no DSH services: nothing asked', noServices.h.asked.length === 0)
  noServices.stop()

  const noStore = rig({ world: { sid: 's-acme', noSubscribe: 'sessions' } })
  await noStore.c.advance(FOLLOW_LOOK_DELAY_MS + 1)
  check('a store that cannot be listened to: the others still tell', noStore.picks.length === 1, noStore.picks)
  noStore.stop()

  const pickThrows = rig({ world: { sid: 's-acme' }, pick: async () => { throw new Error('boom') } })
  await pickThrows.c.advance(FOLLOW_LOOK_DELAY_MS + 1)
  check('a switch that throws is swallowed', pickThrows.h.asked.length === 1)
  pickThrows.stop()

  const askThrows = rig({ world: { sid: 's-acme' }, ask: () => { throw new Error('sync boom') } })
  await askThrows.c.advance(FOLLOW_LOOK_DELAY_MS + 1)
  check('an ask that throws at once is swallowed', askThrows.picks.length === 0)
  askThrows.stop()
}

// ── stopping ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const r = rig({ world: { sid: 's-acme' } })
  check('mounted: it listens to the three stores and keeps its report timer', r.w.subscribers() === 3 && r.c.pending() >= 1, { subscribers: r.w.subscribers(), timers: r.c.pending() })
  r.stop()
  check('stopped: every listener and timer is gone', r.w.subscribers() === 0 && r.c.pending() === 0, { subscribers: r.w.subscribers(), timers: r.c.pending() })
  r.w.open('s-work')
  await r.c.advance(FOLLOW_REPORT_MS * 2)
  check('and nothing is asked afterwards', r.h.asked.length === 0)

  const late = rig({ world: { sid: 's-acme' } })
  late.h.delay = 1
  await late.c.advance(FOLLOW_LOOK_DELAY_MS + 1)
  const release = late.h.release
  late.stop()
  release()
  await settle()
  check('an answer that comes after the follower was stopped switches nothing', late.picks.length === 0)
}

console.log(failed === 0 ? '\nall checks passed' : '\n' + failed + ' failure(s)')
process.exit(failed === 0 ? 0 : 1)
