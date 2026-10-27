// The API of the app (stack: web). A tiny dispatcher: every routes/*.js module exports `routes`, a
// map of "METHOD /path" (params like :id) to (req, params) -> result. Presets add modules without
// touching this file: the commerce preset drops routes/boutique.js in. The mini base is opened by
// db.js, which also applies the numbered migrations.
const fs = require('node:fs')
const path = require('node:path')
const db = require('./db.js')

const routes = {
  'GET /api/health': () => {
    const b = db.open()
    const tables = b.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name)
    let stack = 'web'
    try { stack = JSON.parse(fs.readFileSync(path.join(__dirname, 'webapp.json'), 'utf8')).stack || 'web' } catch (e) { /* no brief: plain web */ }
    return { ok: true, stack, base: { present: true, tables: tables.length } }
  },
}

try {
  const dossier = path.join(__dirname, 'routes')
  for (const f of fs.readdirSync(dossier).filter((n) => n.endsWith('.js')).sort()) {
    const m = require(path.join(dossier, f))
    if (m !== null && typeof m.routes === 'object') Object.assign(routes, m.routes)
  }
} catch (e) { /* no routes folder: health only */ }

const matcher = (pat, chemin) => {
  const a = pat.split('/').filter((p) => p !== '')
  const b = chemin.split('/').filter((p) => p !== '')
  if (a.length !== b.length) return null
  const params = {}
  for (let i = 0; i < a.length; i++) {
    if (a[i].charAt(0) === ':') { params[a[i].slice(1)] = decodeURIComponent(b[i]); continue }
    if (a[i] !== b[i]) return null
  }
  return params
}

exports.handle = (req, res, url) => {
  const chemin = url.split('?')[0]
  const methode = req.method || 'GET'
  let resultat = null
  for (const cle of Object.keys(routes)) {
    const espace = cle.indexOf(' ')
    if (cle.slice(0, espace) !== methode) continue
    const params = matcher(cle.slice(espace + 1), chemin)
    if (params === null) continue
    try { resultat = routes[cle](req, params) } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e).slice(0, 120) }))
      return
    }
    break
  }
  if (resultat === null) resultat = { ok: false, error: 'unknown route' }
  const code = resultat.ok === true ? 200 : (resultat.error === 'unknown route' ? 404 : 400)
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(resultat))
}
