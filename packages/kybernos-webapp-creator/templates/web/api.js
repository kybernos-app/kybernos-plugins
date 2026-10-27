// The API of the app (stack: web). Every route lives here; the mini base is opened by db.js, which
// also applies the numbered migrations. This file is where the app's own logic grows.
const db = require('./db.js')

const BASE = () => {
  const b = db.open()
  const tables = b.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name)
  return { present: true, tables: tables.length }
}

const texte = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

const lister = () => {
  const b = db.open()
  return { ok: true, notes: b.prepare('SELECT id, titre, contenu, fait, cree_le FROM notes ORDER BY id DESC').all() }
}

const creer = (corps) => {
  const titre = texte(corps && corps.titre, 200)
  if (titre === '') return { ok: false, error: 'titre is required' }
  const contenu = texte(corps && corps.contenu, 10000)
  const b = db.open()
  const r = b.prepare('INSERT INTO notes (titre, contenu) VALUES (?, ?)').run(titre, contenu)
  return { ok: true, id: Number(r.lastInsertRowid) }
}

const modifier = (id, corps) => {
  const b = db.open()
  const ligne = b.prepare('SELECT id FROM notes WHERE id = ?').get(id)
  if (ligne === undefined) return { ok: false, error: 'unknown note' }
  const titre = texte(corps && corps.titre, 200)
  const contenu = texte(corps && corps.contenu, 10000)
  const fait = corps !== null && corps !== undefined && (corps.fait === 1 || corps.fait === 0 || corps.fait === true || corps.fait === false) ? (corps.fait === true || corps.fait === 1 ? 1 : 0) : null
  if (titre !== '') b.prepare('UPDATE notes SET titre = ? WHERE id = ?').run(titre, id)
  if (typeof (corps && corps.contenu) === 'string') b.prepare('UPDATE notes SET contenu = ? WHERE id = ?').run(contenu, id)
  if (fait !== null) b.prepare('UPDATE notes SET fait = ? WHERE id = ?').run(fait, id)
  return { ok: true }
}

const supprimer = (id) => {
  const b = db.open()
  const r = b.prepare('DELETE FROM notes WHERE id = ?').run(id)
  return { ok: true, deleted: Number(r.changes) }
}

exports.handle = (req, res, url) => {
  const chemin = url.split('?')[0]
  const methode = req.method || 'GET'
  const parties = chemin.split('/').filter((p) => p !== '') // api | notes | :id
  const id = parties.length >= 3 && /^\d+$/.test(parties[2]) === true ? Number(parties[2]) : null
  let resultat
  try {
    if (chemin === '/api/health' && methode === 'GET') resultat = { ok: true, stack: 'web', base: BASE() }
    else if (chemin === '/api/notes' && methode === 'GET') resultat = lister()
    else if (chemin === '/api/notes' && methode === 'POST') resultat = creer(req.body)
    else if (parties[1] === 'notes' && id !== null && methode === 'POST') resultat = modifier(id, req.body)
    else if (parties[1] === 'notes' && id !== null && methode === 'DELETE') resultat = supprimer(id)
    else resultat = { ok: false, error: 'unknown route' }
  } catch (e) {
    res.writeHead(500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e).slice(0, 120) }))
    return
  }
  const code = resultat.ok === true ? 200 : (resultat.error === 'unknown route' ? 404 : 400)
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(resultat))
}
