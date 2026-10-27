// The API of the app (stack: web). Every route lives here; the mini base (donnees.sqlite) is read
// through node:sqlite. Template shell — migrations, auth and the admin UI arrive with the
// foundation batch; this file is where the app's own logic grows.
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const BASE = path.join(__dirname, 'donnees.sqlite')

const baseState = () => {
  if (fs.existsSync(BASE) !== true) return { present: false }
  try {
    const db = new DatabaseSync(BASE)
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name)
    db.close()
    return { present: true, tables: tables.length }
  } catch (e) { return { present: true, error: 'unreadable' } }
}

const routes = {
  'GET /api/health': () => ({ ok: true, stack: 'web', base: baseState() }),
}

exports.handle = (req, res, url) => {
  const key = (req.method || 'GET') + ' ' + url.split('?')[0]
  const handler = Object.prototype.hasOwnProperty.call(routes, key) === true ? routes[key] : null
  if (handler === null) {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'unknown route' }))
    return
  }
  try {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(handler()))
  } catch (e) {
    res.writeHead(500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e).slice(0, 120) }))
  }
}
