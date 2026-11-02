// kybernos-db/share: sharing a dashboard, the whole of it behind four verbs: `check` (what would be shared, nothing written), `file` (one page the person keeps or sends by hand),
// `publish` (a link, through the `snapshots` port) and `revoke`. The agent tool (agent/tools.mjs) is a thin door onto this; every effect is injected, so a test runs it on a temp folder.
//
// The `snapshots` port is what turns a snapshot into a link, and it is NOT there by default: no server, no link, and the answer says so and offers the file. A port is
//   { limits?: () => { maxBytes, maxCount, ttlDays },
//     put: async ({ id?, sealed, text }) => { ok: true, id, url, expires, bytes } | { ok: false, error, message },
//     remove: async (id) => { ok: true } | { ok: false, error, message } }
// `text` is the JSON of the snapshot, or of its sealed envelope (`sealed: true`): the server never holds anything it can read of a protected one, and learns no title from it.
//
// What stays on this computer, in `<sharesDir>/index.json` (mode 600): which dashboard became which link, and the password of a protected one, so that an update keeps the link AND the
// password the readers were given. A password is shown to the person once, when it is made; it is never in a listing.

import { chmodSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { newPassword, sealText } from './seal.mjs'
import { SNAPSHOT_MAX_BYTES, buildSnapshot } from './snapshot.mjs'
import { exportFile } from './viewer.mjs'

const EXT = '.miniapp.json'
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const fail = (error, message, more = {}) => ({ ok: false, error, message, ...more })
const day = (ms) => new Date(ms).toISOString().slice(0, 10)

/** Every verb answers `{ ok, ... }`, never throws for something the person can fix. */
export function makeSharing ({ api, dashboardsDir, sharesDir, snapshots = null, now = Date.now }) {
  const port = isObj(snapshots) && typeof snapshots.put === 'function' && typeof snapshots.remove === 'function' ? snapshots : null
  const indexFile = () => join(sharesDir, 'index.json')

  function readIndex () {
    try { const j = JSON.parse(readFileSync(indexFile(), 'utf8')); return isObj(j) && Array.isArray(j.shares) ? j.shares.filter((s) => isObj(s) && typeof s.id === 'string') : [] } catch (e) { return [] }
  }
  function writeIndex (shares) {
    mkdirSync(sharesDir, { recursive: true, mode: 0o700 })
    const tmp = indexFile() + '.tmp'
    writeFileSync(tmp, JSON.stringify({ version: 1, shares }, null, 2), { mode: 0o600 })
    renameSync(tmp, indexFile())
    try { chmodSync(indexFile(), 0o600) } catch (e) { /* a file system without modes */ }
  }

  /** The dashboards on this computer: `[{ id, name }]`. */
  function dashboards () {
    let names = []
    try { names = readdirSync(dashboardsDir).filter((n) => n.endsWith(EXT)).sort() } catch (e) { return [] }
    return names.map((n) => ({ id: n.slice(0, -EXT.length), dashboard: loadFile(join(dashboardsDir, n)) })).filter((d) => d.dashboard !== null && ID.test(d.id)).map((d) => ({ id: d.id, name: String(d.dashboard.name || d.id) }))
  }
  function loadFile (file) {
    try {
      const doc = JSON.parse(readFileSync(file, 'utf8'))
      const first = isObj(doc) && doc.kind === 'dashboard' && Array.isArray(doc.data) ? doc.data[0] : null
      return isObj(first) ? (isObj(first.payload) ? first.payload : first) : null
    } catch (e) { return null }
  }
  /** A dashboard by id; with no id, the only one there is. */
  function pick (id) {
    const all = dashboards()
    if (all.length === 0) return fail('no_dashboard', 'there is no dashboard on this computer yet')
    const want = typeof id === 'string' && id !== '' ? id : all.length === 1 ? all[0].id : ''
    if (want === '') return fail('which_dashboard', 'say which dashboard: ' + all.map((d) => d.id + ' (' + d.name + ')').join(', '), { dashboards: all })
    if (!ID.test(want) || !all.some((d) => d.id === want)) return fail('unknown_dashboard', 'no dashboard "' + String(id) + '"', { dashboards: all })
    return { ok: true, id: want, dashboard: loadFile(join(dashboardsDir, want + EXT)) }
  }

  const limitsOf = () => {
    let l = null
    try { l = port !== null && typeof port.limits === 'function' ? port.limits() : null } catch (e) { l = null }
    return { maxBytes: isObj(l) && Number.isInteger(l.maxBytes) && l.maxBytes > 0 ? Math.min(l.maxBytes, SNAPSHOT_MAX_BYTES) : SNAPSHOT_MAX_BYTES, maxCount: isObj(l) && Number.isInteger(l.maxCount) ? l.maxCount : null, ttlDays: isObj(l) && Number.isInteger(l.ttlDays) ? l.ttlDays : null }
  }
  const report = (r) => ({ included: r.included.map((w) => ({ id: w.id, title: w.title, type: w.type })), left: r.left, withheld: r.withheld })

  function snapshotOf (d, { includePersonal, maxBytes }) {
    const r = buildSnapshot({ dashboard: d.dashboard, api, now: now(), includePersonal: includePersonal === true, maxBytes })
    return r.ok ? r : { ...r, ok: false, ...(r.left ? { left: r.left } : {}), ...(r.withheld ? { withheld: r.withheld } : {}) }
  }

  /** What a share of this dashboard would hold, and what it would leave out and why. Writes nothing and sends nothing. */
  function check ({ dashboard, includePersonal = false } = {}) {
    const d = pick(dashboard)
    if (!d.ok) return d
    const limits = limitsOf()
    const r = snapshotOf(d, { includePersonal, maxBytes: limits.maxBytes })
    if (!r.ok) return fail(r.error, r.message, { dashboard: d.id, ...(r.left ? { left: r.left } : {}), ...(r.withheld ? { withheld: r.withheld } : {}) })
    return { ok: true, dashboard: d.id, title: r.doc.title, bytes: r.bytes, ...report(r), link: port !== null ? 'available' : 'unavailable', limits }
  }

  /** The text to hand out, and the password when it is protected (new, or the one kept for an update). */
  async function wrap (doc, protect, kept) {
    const text = JSON.stringify(doc)
    if (!protect) return { text, sealed: false, password: null, fresh: false }
    const password = typeof kept === 'string' && kept !== '' ? kept : newPassword()
    return { text: JSON.stringify(await sealText(text, password)), sealed: true, password, fresh: !(typeof kept === 'string' && kept !== '') }
  }

  /** One page, `<sharesDir>/<dashboard>-<day>.html`: opens in any browser, offline. */
  async function file ({ dashboard, protect = false, includePersonal = false } = {}) {
    const d = pick(dashboard)
    if (!d.ok) return d
    const r = snapshotOf(d, { includePersonal, maxBytes: SNAPSHOT_MAX_BYTES })
    if (!r.ok) return fail(r.error, r.message, { dashboard: d.id, ...(r.left ? { left: r.left } : {}), ...(r.withheld ? { withheld: r.withheld } : {}) })
    const w = await wrap(r.doc, protect === true, null)
    const page = exportFile(w.sealed ? JSON.parse(w.text) : r.doc)
    mkdirSync(sharesDir, { recursive: true, mode: 0o700 })
    const path = join(sharesDir, d.id + '-' + day(now()) + '.html')
    writeFileSync(path, page, { mode: 0o600 })
    return { ok: true, dashboard: d.id, path, bytes: Buffer.byteLength(page), protected: w.sealed, ...(w.password !== null ? { password: w.password } : {}), ...report(r) }
  }

  /** A link through the port. With `share` (the id of one of this computer's links) it is an update: same link, same password, new numbers. */
  async function publish ({ dashboard, protect = false, includePersonal = false, share } = {}) {
    if (port === null) return fail('unavailable', 'this computer has no way to publish a link yet (no Kybernos account connected): `file` makes a page you can keep or send by hand')
    const known = typeof share === 'string' && share !== '' ? readIndex().find((s) => s.id === share) : undefined
    if (typeof share === 'string' && share !== '' && known === undefined) return fail('unknown_share', 'no link "' + share + '" on this computer: `list` shows them')
    const d = pick(known !== undefined ? known.dashboard : dashboard)
    if (!d.ok) return d
    const limits = limitsOf()
    const r = snapshotOf(d, { includePersonal: known !== undefined ? known.includePersonal === true : includePersonal, maxBytes: limits.maxBytes })
    if (!r.ok) return fail(r.error, r.message, { dashboard: d.id, ...(r.left ? { left: r.left } : {}), ...(r.withheld ? { withheld: r.withheld } : {}) })
    const shares = readIndex()
    if (known === undefined && limits.maxCount !== null && shares.length >= limits.maxCount) return fail('too_many', 'this account may keep ' + limits.maxCount + ' links: revoke one first', { shares: shares.map(brief) })
    const w = await wrap(r.doc, known !== undefined ? known.protected === true : protect === true, known !== undefined ? known.password : null)
    let answer
    try { answer = await port.put({ ...(known !== undefined ? { id: known.id } : {}), sealed: w.sealed, text: w.text }) } catch (e) { return fail('port_failed', 'the link could not be made: ' + (e instanceof Error ? e.message : String(e))) }
    if (!isObj(answer) || answer.ok !== true || typeof answer.id !== 'string' || typeof answer.url !== 'string') return fail(isObj(answer) && typeof answer.error === 'string' ? answer.error : 'port_failed', isObj(answer) && typeof answer.message === 'string' ? answer.message : 'the link could not be made')
    const record = {
      id: answer.id, url: answer.url, dashboard: d.id, title: String(r.doc.title), protected: w.sealed, ...(w.password !== null ? { password: w.password } : {}), includePersonal: known !== undefined ? known.includePersonal === true : includePersonal === true,
      made: known !== undefined ? known.made : day(now()), updated: day(now()), expires: typeof answer.expires === 'string' ? answer.expires : null, bytes: Number.isInteger(answer.bytes) ? answer.bytes : Buffer.byteLength(w.text),
    }
    writeIndex([...shares.filter((s) => s.id !== record.id), record])
    return { ok: true, renewed: known !== undefined, ...brief(record), ...(w.fresh ? { password: w.password } : {}), ...report(r) }
  }

  const brief = (s) => ({ share: s.id, url: s.url, dashboard: s.dashboard, title: s.title, protected: s.protected === true, includePersonal: s.includePersonal === true, made: s.made, updated: s.updated, expires: s.expires })

  /** The links of this computer (never a password). */
  function list () { return { ok: true, link: port !== null ? 'available' : 'unavailable', shares: readIndex().map(brief) } }

  /** Takes a link down. A link the server no longer has is forgotten here too. */
  async function revoke ({ share } = {}) {
    const known = typeof share === 'string' ? readIndex().find((s) => s.id === share) : undefined
    if (known === undefined) return fail('unknown_share', 'no link "' + String(share) + '" on this computer: `list` shows them')
    if (port === null) return fail('unavailable', 'this computer cannot reach the server that holds the link now: try again when the account is connected')
    let answer
    try { answer = await port.remove(known.id) } catch (e) { return fail('port_failed', 'the link could not be taken down: ' + (e instanceof Error ? e.message : String(e))) }
    if (!isObj(answer) || (answer.ok !== true && answer.error !== 'not_found')) return fail(isObj(answer) && typeof answer.error === 'string' ? answer.error : 'port_failed', isObj(answer) && typeof answer.message === 'string' ? answer.message : 'the link could not be taken down')
    writeIndex(readIndex().filter((s) => s.id !== known.id))
    return { ok: true, revoked: brief(known) }
  }

  return { dashboards, check, file, publish, list, revoke }
}
