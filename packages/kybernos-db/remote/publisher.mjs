// publisher.mjs — everything that makes an app published, in one place: the card's facts, Publish, Unpublish, the writes of rows that go to the hosted app, the mirror that
// follows it, and the link that opens it. The page and the agent reach it through routes.mjs, agent/tools.mjs (by way of remote/facade.mjs) and api.mjs's state.
//
// The shape of it (decisions of the cadrage, docs/etudes/2026-10-31-share-as-app-cadrage.md, and docs/dev/apps-hosting-port.md):
//   - the person chooses which of their own cloud computers receives the app: the card reads `hosting.hosts()` when it opens, Publish reads it again and refuses a computer it does not list;
//   - a published app's truth is the hosted copy; the folder on this computer is a read-only MIRROR refreshed from it (mirror.mjs, service.replaceMirror);
//   - Publish is atomic: nothing is registered before the hosted copy is verified, and a failure after the upload takes the upload back;
//   - Unpublish pulls the hosted copy one last time, takes the app out of the space, and only then forgets it: the mirror is the db again, a normal local one;
//   - a failure never damages the mirror; the state says `lastSync` and `syncError` and the page keeps working from the copy it has;
//   - the boot key is a secret of the registry: it never appears in a state, a log line, an error or a prompt.
// Nothing here touches the network except through `hosting` (the port) and the space client (space.mjs); `fetch`, the clock and the timers are injected.
import { rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_MAX_BYTES } from './bundle.mjs'
import { doorShape, makeFacade } from './facade.mjs'
import { describeHosting, readHosts } from './hosting.mjs'
import { pullMirror } from './mirror.mjs'
import { SLUG, SPACE_ID } from './registry.mjs'
import { bundleOf, discardStage, snapshotDb } from './snapshot.mjs'
import { makeSpaceClient, normalizeSpaceUrl } from './space.mjs'
import { hexKey } from './token.mjs'

export const POLL_MS = 30 * 1000
export const FIRST_POLL_MS = 2 * 1000
export const BACKOFF_MAX_MS = 5 * 60 * 1000
/** An app that cannot be reached asks the hosting whether its computer still exists, and the hosting is asked at most this often however many apps fail. */
export const HOSTS_EVERY_MS = 60 * 1000

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const fail = (code, message, extra) => ({ ok: false, code, message, ...(extra || {}) })

/** A slug for a hosted app from the name of the app: lower-case letters, digits and -, starting with a letter, at most 36 characters. */
export function slugFor (name, taken = []) {
  let s = String(name).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (s === '') s = 'app'
  if (!/^[a-z]/.test(s)) s = 'app-' + s
  s = s.slice(0, 36).replace(/-+$/, '')
  const used = new Set(taken)
  let out = s
  for (let n = 2; used.has(out); n++) out = s.slice(0, 36 - String(n).length - 1) + '-' + n
  return SLUG.test(out) ? out : 'app'
}

/**
 * `service` is agent/service.mjs, `registry` remote/registry.mjs, `hosting` the port (remote/hosting.mjs). `tmpRoot` is a folder on the same file system as the dbs, for the
 * copies being built. `ports`: `fetch`, `now`, `store` (the store's own ports, for tests), `timers` (`setTimeout`, `setInterval`, `clearInterval`), `log(text)`, and for a test
 * `clientFor(space)` in place of the real space client.
 */
export function makePublisher ({ service, registry, hosting, tmpRoot, ports = {}, maxBytes = DEFAULT_MAX_BYTES }) {
  const now = typeof ports.now === 'function' ? ports.now : Date.now
  const log = typeof ports.log === 'function' ? ports.log : () => {}
  const timers = { setTimeout, setInterval, clearInterval, clearTimeout, ...(ports.timers || {}) }
  const iso = () => new Date(now()).toISOString()
  const locks = new Set()
  const sync = new Map() // db id → { lastSync, syncError, fails, nextAt, hostGone }
  const chains = new Map()

  const isPublished = (id) => { try { return registry.published(id) } catch (e) { return false } }
  const available = () => { try { return hosting.available() === true } catch (e) { return false } }
  const clientOf = (space) => {
    try { return typeof ports.clientFor === 'function' ? ports.clientFor(space) : makeSpaceClient({ url: space.url, bootKey: space.bootKey, fetch: ports.fetch, now, maxBytes }) } catch (e) { return null }
  }
  const found = (id) => {
    const f = registry.spaceOf(id)
    if (f === null) return null
    const client = clientOf(f.space)
    return client === null ? null : { ...f, client }
  }

  // ── what the state says ──────────────────────────────────────────────────────────────────────────────────────────────────────
  const stateOf = (id) => sync.get(id) || { lastSync: null, syncError: null, fails: 0, nextAt: 0, hostGone: false }
  /**
   * `{ slug, url, since, lastSync, syncError, host, hostGone }` for a published app, else null. `host` is `{ id, name, region }` (the computer it lives on, as last seen) or null for an app
   * published before computers were chosen; `hostGone` is true only once the app could not be reached AND the hosting answered a list that no longer holds that computer. No secret.
   */
  function info (id) {
    const f = registry.spaceOf(id)
    if (f === null) return null
    const s = stateOf(id)
    return { slug: f.app.slug, url: f.space.url, since: f.app.since, lastSync: s.lastSync, syncError: s.syncError, host: f.app.host === undefined ? null : { ...f.app.host }, hostGone: s.hostGone === true }
  }
  /** What the Publish card and the header need to know about the hosting: no secret. */
  function hostingState () {
    if (!available()) return { available: false, name: '' }
    return { available: true, name: describeHosting(hosting).name }
  }
  const markOk = (id) => { sync.set(id, { lastSync: iso(), syncError: null, fails: 0, nextAt: 0, hostGone: false }) }
  const markFailed = (id, r) => {
    const s = stateOf(id)
    const fails = s.fails + 1
    sync.set(id, { lastSync: s.lastSync, syncError: { code: r.code || 'failed', message: String(r.message || 'the web app could not be reached').slice(0, 200), at: iso() }, fails, nextAt: now() + Math.min(POLL_MS * 2 ** fails, BACKOFF_MAX_MS), hostGone: s.hostGone })
  }

  // ── the person's computers ───────────────────────────────────────────────────────────────────────────────────────────────────────
  let hostsMemo = { at: -Infinity, ids: null } // the last attempt of the poll: when, and the ids it listed (null: it failed, which proves nothing)
  let hostsFlight = null
  /** Reads the hosting's list (`readHosts`: bounded, validated) and keeps the name and region of every listed computer on the apps that live there. */
  async function listHosts () {
    const r = await readHosts(hosting, { timers, timeoutMs: ports.hostsTimeoutMs })
    hostsMemo = { at: now(), ids: r.ok ? r.hosts.map((h) => h.id) : null }
    if (r.ok) for (const h of r.hosts) registry.setHostInfo(h.id, h)
    return r
  }
  /** The ids of the person's computers, or null when that cannot be known now. A fresh answer is reused for a minute, whoever asks, so a failing app never makes the hosting a busy loop. */
  function knownHosts () {
    if (now() - hostsMemo.at < HOSTS_EVERY_MS) return Promise.resolve(hostsMemo.ids)
    if (hostsFlight === null) hostsFlight = listHosts().then((r) => (r.ok ? r.hosts.map((h) => h.id) : null)).finally(() => { hostsFlight = null })
    return hostsFlight
  }
  /** An app that was not reached: is its computer still one of the person's? Only an answer that succeeded and does not list it says no; a list that failed changes nothing. */
  async function judgeHost (id) {
    const f = registry.spaceOf(id)
    if (f === null || f.app.host === undefined || !available()) return
    let ids = null
    try { ids = await knownHosts() } catch (e) { ids = null }
    if (ids === null || !isPublished(id)) return
    const s = stateOf(id)
    const gone = !ids.includes(f.app.host.id)
    if (s.hostGone !== gone) sync.set(id, { ...s, hostGone: gone })
  }
  /** Whether a failed pull means the web app was not reached (as opposed to answering, even to refuse). */
  const notReached = (r) => r.code === 'unreachable' || r.code === 'space'

  // ── the mirror: one refresh at a time per app, and a refresh asked for while one runs waits for the next ────────────────────────
  async function doRefresh (id) {
    const f = found(id)
    if (f === null) return fail('not-published', 'This app is not published.')
    const raw = service.raw(id)
    if (!raw.ok) return fail(raw.code, raw.message)
    let current
    try {
      const blobs = raw.db.blobs
      current = { fingerprint: raw.db.fingerprint(), blobSize: (h) => { const st = blobs.stat(h); return st === null ? null : st.size }, blobFile: (h) => join(blobs.dir, h) }
    } catch (e) { return fail('failed', 'The copy of this app on this computer cannot be read.') }
    const pulled = await pullMirror({ space: f.client, slug: f.app.slug, dbId: id, current, tmpRoot, ports: ports.store, maxBytes })
    if (!pulled.ok) { markFailed(id, pulled); if (notReached(pulled)) await judgeHost(id); return pulled }
    if (pulled.changed) {
      const swapped = service.replaceMirror(id, pulled.staged.folder)
      try { discardStage(pulled.staged.dir) } catch (e) { /* the staging folder is emptied at the next start */ }
      if (!swapped.ok) { markFailed(id, swapped); return swapped }
    }
    markOk(id)
    return { ok: true, changed: pulled.changed, lastSync: stateOf(id).lastSync }
  }
  const settle = (id) => doRefresh(id).catch(() => { const r = fail('failed', 'The copy of this app could not be refreshed.'); markFailed(id, r); return r })
  /** Brings the mirror up to date with the hosted app: `{ ok, changed, lastSync }`. One at a time per app; a call made during a refresh gets the next one, never a stale answer. */
  function refresh (id) {
    let c = chains.get(id)
    if (c === undefined) { c = { tail: Promise.resolve(), running: false, waiting: null }; chains.set(id, c) }
    const run = () => {
      c.running = true
      const p = settle(id).finally(() => { c.running = false })
      c.tail = p
      return p
    }
    if (!c.running) return run()
    if (c.waiting === null) c.waiting = c.tail.then(() => { c.waiting = null; return run() })
    return c.waiting
  }

  /** Every published app asks the hosted fingerprint once; one at a time, and an app that failed waits longer each time (up to five minutes). */
  let ticking = false
  async function tick () {
    if (ticking) return
    ticking = true
    try {
      for (const app of registry.apps()) {
        if (locks.has(app.db) || stateOf(app.db).nextAt > now()) continue
        await refresh(app.db)
      }
    } catch (e) { /* the next tick tries again */ } finally { ticking = false }
  }
  let handles = []
  function start ({ everyMs = POLL_MS, firstMs = FIRST_POLL_MS } = {}) {
    stop()
    try {
      const unref = (h) => { if (h !== null && h !== undefined && typeof h.unref === 'function') h.unref(); return h }
      handles = [{ kind: 'timeout', h: unref(timers.setTimeout(() => { tick() }, firstMs)) }, { kind: 'interval', h: unref(timers.setInterval(() => { tick() }, everyMs)) }]
    } catch (e) { handles = [] }
  }
  function stop () {
    for (const x of handles.splice(0)) { try { if (x.kind === 'interval') timers.clearInterval(x.h); else timers.clearTimeout(x.h) } catch (e) { /* already gone */ } }
  }

  // ── the writes of rows: to the hosted app, then the mirror ───────────────────────────────────────────────────────────────────────
  const OPS = ['create', 'update', 'delete', 'restore']
  /** One row write as the owner, then the mirror is refreshed before the answer returns. Answers in the store's shape (`code`). */
  async function rowWrite (id, { op, object, id: rowId, values }) {
    const f = found(id)
    if (f === null) return fail('not-published', 'This app is not published.')
    if (!OPS.includes(op) || typeof object !== 'string' || object === '' || (rowId !== undefined && typeof rowId !== 'string') || (values !== undefined && !plain(values))) return fail('invalid', 'op is create, update, delete or restore, on a table, with a row id and values where they apply')
    const r = await f.client.write(f.app.slug, { object, op, id: rowId, values })
    if (!r.ok) {
      if (r.code === 'unreachable') return fail('unreachable', 'The web app could not be reached, so the change may not have been saved. The page shows the real state once it answers again.')
      return r
    }
    await refresh(id) // awaited: the page re-reads the mirror as soon as this answer arrives
    return r
  }
  async function rowUpload (id, { object, field, name, type, bytes }) {
    const f = found(id)
    if (f === null) return fail('not-published', 'This app is not published.')
    if (!(bytes instanceof Uint8Array)) return fail('invalid', 'a file is bytes')
    const r = await f.client.upload(f.app.slug, { object, field, name, type, bytes: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) })
    return r.ok === false && r.code === 'unreachable' ? fail('unreachable', 'The web app could not be reached, so the file was not sent.') : r
  }
  /** The id of the published db a request means (the one it names, else the only live one), or null: a local db, an unknown one, an ambiguous call. */
  function locate (q) {
    const a = plain(q) ? q : {}
    const r = service.resolve(typeof a.db === 'string' && a.db !== '' ? a.db : undefined)
    if (!r.ok || r.db.published !== true) return null
    return r.db.info().id
  }
  /** For routes.mjs: the answer (a Promise, in the door's shape) when the request is a write to a published app, else null and the local door answers. */
  function forwardWrite (body) {
    const id = locate(body)
    if (id === null) return null
    const a = plain(body) ? body : {}
    return rowWrite(id, { op: a.op, object: a.object, id: a.id, values: a.values }).then(doorShape)
  }
  function forwardUpload (q) {
    const id = locate(q)
    if (id === null) return null
    return rowUpload(id, q).then(doorShape)
  }
  /** The facade the service gives out for a published db. */
  const facade = (id, rawOf) => makeFacade({ rawOf, row: (spec) => rowWrite(id, spec) })

  // ── the card ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const fieldRef = (o, f) => ({ object: o.key, objectLabel: o.label, field: f.key, fieldLabel: f.label })
  /**
   * The Publish card: the facts, and whether Publish is possible, `{ ok: true, can, reason, … }`. When nothing else stands in the way it also reads the person's computers
   * (`hosts`, and `lastHost`, the one the last Publish went to if it is still listed): none at all is `reason: 'no-host'`, a list that could not be read is `reason: 'hosts-unreachable'`
   * with `hostsError`; both still carry `hosting.orderUrl`, so the person can always go and order one. This runs when the card opens, never on a state read.
   */
  async function check (id) {
    const c = facts(id)
    if (!c.ok || c.reason !== null) return c
    if (locks.has(id)) return { ...c, can: false, reason: 'busy' }
    const read = await listHosts()
    if (!read.ok) return { ...c, can: false, reason: 'hosts-unreachable', hosts: null, lastHost: null, hostsError: { code: read.code, message: read.message } }
    const last = registry.lastHost()
    return { ...c, can: read.hosts.length > 0, reason: read.hosts.length > 0 ? null : 'no-host', hosts: read.hosts, lastHost: last !== null && read.hosts.some((h) => h.id === last) ? last : null }
  }
  /** The same facts without the lock and without the computers (Publish holds the lock itself, and reads the computers itself, when it asks). */
  function facts (id) {
    const r = service.raw(id)
    if (!r.ok) return fail(r.code, r.message)
    const db = r.db
    const meta = db.info()
    const objects = db.objects({ all: true })
    const blocked = []
    const personal = []
    for (const o of objects) {
      for (const f of o.fields) {
        if (f.protection === 'sensitive' || f.protection === 'secret') blocked.push({ ...fieldRef(o, f), protection: f.protection })
        else if (f.protection === 'personal') personal.push(fieldRef(o, f))
      }
    }
    let rows = 0
    for (const o of objects.filter((x) => x.archived === undefined)) rows += db.count(o.key)
    let files = 0
    let bytes = 0
    try { bytes += statSync(db.file).size } catch (e) { /* the size is an estimate */ }
    for (const hash of db.referenced()) { const st = db.blobs.stat(hash); if (st !== null) { files += 1; bytes += st.size } }
    const on = available()
    let reason = null
    if (isPublished(id)) reason = 'published'
    else if (meta.archived !== null) reason = 'archived'
    else if (!on) reason = 'unavailable'
    else if (blocked.length > 0) reason = 'sensitive'
    else if (bytes > maxBytes) reason = 'too-big'
    return {
      ok: true, can: reason === null, reason,
      app: { id, name: meta.name }, tables: objects.filter((o) => o.archived === undefined).length, rows, files, bytes,
      personal, blocked,
      hosting: on ? describeHosting(hosting) : { name: '', orderUrl: '' },
    }
  }

  // ── Publish ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  /** Locks one app against a second publish or unpublish at the same time. */
  async function locked (id, fn) {
    if (locks.has(id)) return fail('busy', 'This app is being published or unpublished: wait for that to end.')
    locks.add(id)
    try { return await fn() } finally { locks.delete(id) }
  }
  const validSpace = (s) => plain(s) && typeof s.id === 'string' && normalizeSpaceUrl(s.url) !== null && hexKey(s.bootKey) !== null

  /**
   * Publishes an app onto the computer the person chose (`host`, an id): the card's confirm button. `{ ok: true, published }`, or `{ ok: false, code, message }` with the db exactly as it was and
   * no stray app in the space. The computers are read again first, and one that is not in that answer is refused (`unknown-host`): nothing is asked of a computer the person does not have.
   */
  function publish (id, { confirm, host } = {}) {
    return locked(id, async () => {
      const card = facts(id)
      if (!card.ok) return card
      if (!card.can) return fail(card.reason, REASONS[card.reason] || 'This app cannot be published.', card.reason === 'sensitive' ? { fields: card.blocked } : undefined)
      if (confirm !== true) return fail('confirm', 'Publishing waits for the confirm button.')
      const raw = service.raw(id)
      if (!raw.ok) return fail(raw.code, raw.message)
      // 1. the computer the person chose, among the ones they have now, and a space on it
      if (typeof host !== 'string' || !SPACE_ID.test(host)) return fail('unknown-host', REASONS['unknown-host'])
      const read = await listHosts()
      if (!read.ok) return fail('hosts-unreachable', read.message)
      const chosen = read.hosts.find((h) => h.id === host)
      if (chosen === undefined) return fail('unknown-host', REASONS['unknown-host'])
      let given
      try { given = await hosting.ensureSpace({ host: chosen.id }) } catch (e) { given = fail('hosting-failed', 'Publishing could not start.') }
      if (!plain(given) || given.ok !== true) return fail(plain(given) && typeof given.code === 'string' ? given.code : 'hosting-failed', plain(given) && typeof given.message === 'string' ? given.message.slice(0, 300) : 'Publishing could not start.')
      if (!validSpace(given.space)) return fail('hosting-failed', 'The hosting gave an address this computer cannot use.')
      const held = registry.space(given.space.id)
      if (held !== null && held.host !== undefined && held.host !== chosen.id) return fail('hosting-failed', 'The hosting gave a space that belongs to another computer.')
      const added = registry.addSpace({ ...given.space, host: chosen.id }) // kept at once: a crash after the space exists must not lose its key
      if (!added.ok) return fail(added.code, added.message)
      const space = registry.space(given.space.id)
      const client = clientOf(space)
      if (client === null) return fail('hosting-failed', 'The hosting gave an address this computer cannot use.')
      // an upload left by an earlier attempt that never finished is taken out first
      for (const p of registry.pendingOf(id)) {
        const old = registry.space(p.space)
        const oldClient = old === null ? null : clientOf(old)
        if (oldClient !== null) { const gone = await oldClient.release(p.slug); if (!gone.ok && gone.code !== 'unknown') continue }
        registry.removePending(id, p.slug)
      }
      // 2. the copy to send, taken in one stretch with its fingerprint
      let snap = null
      let slug = null
      let uploaded = false
      const undo = async () => {
        if (!uploaded) { if (slug !== null) registry.removePending(id, slug); return }
        const gone = await client.release(slug)
        if (gone.ok || gone.code === 'unknown') registry.removePending(id, slug) // else the pending note stays: the next attempt takes it out
      }
      try {
        snap = snapshotDb({ db: raw.db, tmpDir: join(tmpRoot, 'out') })
        const packed = bundleOf(snap, raw.db, { maxBytes })
        if (!packed.ok) return fail(packed.code === 'too-big' ? 'too-big' : 'failed', packed.code === 'too-big' ? REASONS['too-big'] : 'The app could not be packed for sending.')
        // 3. the upload, under a free slug
        const taken = registry.slugsIn(space.id)
        let put = null
        for (let n = 0; n < 5; n++) {
          slug = slugFor(snap.name, taken)
          registry.addPending({ db: id, space: space.id, slug, at: iso() })
          put = await client.putBundle(slug, packed.bytes)
          if (put.ok) { uploaded = true; break }
          registry.removePending(id, slug)
          if (put.code !== 'exists') return put.code === 'db-exists' ? fail('db-exists', 'A copy of this app is already in the web app from an earlier attempt that was cut short. Unpublish it from there first.') : fail(put.code, put.message)
          taken.push(slug)
        }
        if (!uploaded) return fail('exists', 'No free name was found for the app in the web app.')
        // 4. what is there is what was sent
        const there = await client.fingerprint(slug)
        if (!there.ok || there.fingerprint !== snap.fingerprint || put.fingerprint !== snap.fingerprint) { await undo(); return there.ok ? fail('mismatch', 'The web app does not hold what was sent. Nothing was published.') : fail(there.code, there.message) }
        // 5. nothing changed here meanwhile (a change now would be lost to the mirror); then register, in the same synchronous stretch
        if (raw.db.fingerprint() !== snap.fingerprint) { await undo(); return fail('changed', 'The app changed while it was being published. Nothing was published: try again.') }
        const since = iso()
        const reg = registry.addApp({ db: id, space: space.id, slug, since, host: { id: chosen.id, name: chosen.name, region: chosen.region } })
        if (!reg.ok) { await undo(); return fail(reg.code === 'registry' ? 'registry' : 'failed', 'The list of published apps could not be saved. Nothing was published.') }
        markOk(id)
        registry.setLastHost(chosen.id) // only the default choice of the next card: a failure to write it costs nothing
        log('published ' + id + ' as ' + slug)
        return { ok: true, published: info(id), missing: packed.missing.length }
      } catch (e) {
        try { await undo() } catch (e2) { /* the pending note stays */ }
        return fail('failed', 'Publishing failed: ' + String((e && e.message) || e).slice(0, 120))
      } finally {
        if (snap !== null) { try { snap.dispose() } catch (e) { /* removed with the temporary folder */ } }
      }
    })
  }

  // ── Unpublish ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  /**
   * Brings the app back to this computer as a normal local db: the hosted copy is pulled one last time and checked, the app is taken out of the space, then forgotten here.
   * If the space cannot be reached the answer says so (`canForget: true`); `{ forget: true, confirm: <the app's name> }` is the deliberate way out: the local copy is kept as it is
   * (as of its last sync), the hosted one is left where it is, and nothing is asked of the space.
   */
  function unpublish (id, { forget, confirm } = {}) {
    return locked(id, async () => {
      const f = found(id)
      if (f === null) return fail('not-published', 'This app is not published.')
      const raw = service.raw(id)
      if (!raw.ok) return fail(raw.code, raw.message)
      if (forget === true) {
        if (confirm !== raw.db.info().name) return fail('confirm', 'Type the name of the app to confirm.')
        const gone = registry.removeApp(id)
        if (!gone.ok) return fail('registry', 'The list of published apps could not be saved.')
        // a computer that no longer exists takes its space with it: nothing is kept of a key that opens nothing
        if (stateOf(id).hostGone === true && registry.slugsIn(f.space.id).length === 0) registry.removeSpace(f.space.id)
        sync.delete(id)
        log('forgot the hosted copy of ' + id)
        return { ok: true, forgotten: true, left: { url: f.space.url, slug: f.app.slug } }
      }
      const stuck = (r) => fail(r.code, r.message, { canForget: true })
      // the mirror must be what the hosted app holds right now: pull until the hosted fingerprint is the one we have
      let settled = false
      for (let n = 0; n < 3 && !settled; n++) {
        const pulled = await refresh(id)
        if (!pulled.ok) return stuck(pulled)
        const head = await f.client.fingerprint(f.app.slug)
        if (!head.ok) return stuck(head)
        const cur = service.raw(id) // the handle is a new one when the pull changed anything
        settled = cur.ok && head.fingerprint === cur.db.fingerprint()
      }
      if (!settled) return fail('busy', 'The web app kept changing while it was being brought back. Try again in a moment.', { canForget: false })
      const released = await f.client.release(f.app.slug)
      if (!released.ok && released.code !== 'unknown') return stuck(released)
      const gone = registry.removeApp(id)
      if (!gone.ok) return fail('registry', 'The app left the web app but the list of published apps could not be saved. Try unpublishing again.')
      sync.delete(id)
      // the last app of a space leaves: the space itself is given back, when the hosting can
      if (registry.slugsIn(f.space.id).length === 0 && typeof hosting.releaseSpace === 'function') {
        try { const r = await hosting.releaseSpace(f.space.id); if (r && r.ok === true) registry.removeSpace(f.space.id) } catch (e) { /* the space is kept; the person is not told off for it */ }
      }
      log('unpublished ' + id)
      return { ok: true }
    })
  }

  /** The one-time link that signs the owner in to the web app: `{ ok: true, url }`. A secret for ten minutes: it is handed to the page and never kept. */
  function openWeb (id) {
    const f = found(id)
    if (f === null) return fail('not-published', 'This app is not published.')
    try { return { ok: true, url: f.client.openLink() } } catch (e) { return fail('failed', 'The link could not be made.') }
  }

  const REASONS = {
    published: 'This app is already published.',
    archived: 'This app is archived: restore it first.',
    unavailable: 'Publishing is not available on this computer.',
    sensitive: 'This app has sensitive or secret fields, which cannot be published.',
    'unknown-host': 'That is not one of your cloud computers any more. Pick another one.',
    'too-big': 'This app is too big to publish in one go.',
    busy: 'This app is being published or unpublished.',
  }

  return { info, hostingState, isPublished, check, publish, unpublish, openWeb, refresh, tick, start, stop, rowWrite, rowUpload, forwardWrite, forwardUpload, facade, cleanup: () => { try { rmSync(tmpRoot, { recursive: true, force: true }) } catch (e) { /* nothing to remove */ } } }
}
