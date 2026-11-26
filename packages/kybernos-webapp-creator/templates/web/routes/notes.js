// The example resource of the web template: notes CRUD, mounted automatically by api.js.
const db = require('../db.js')

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
  const fait = corps !== null && corps !== undefined && (corps.fait === 1 || corps.fait === 0 || corps.fait === true || corps.fait === false) ? (corps.fait === true || corps.fait === 1 ? 1 : 0) : null
  if (titre !== '') b.prepare('UPDATE notes SET titre = ? WHERE id = ?').run(titre, id)
  if (typeof (corps && corps.contenu) === 'string') b.prepare('UPDATE notes SET contenu = ? WHERE id = ?').run(texte(corps.contenu, 10000), id)
  if (fait !== null) b.prepare('UPDATE notes SET fait = ? WHERE id = ?').run(fait, id)
  return { ok: true }
}

const supprimer = (id) => {
  const b = db.open()
  const r = b.prepare('DELETE FROM notes WHERE id = ?').run(id)
  return { ok: true, deleted: Number(r.changes) }
}

exports.routes = {
  'GET /api/notes': () => lister(),
  'POST /api/notes': (req) => creer(req.body),
  'POST /api/notes/:id': (req, params) => modifier(Number(params.id), req.body),
  'DELETE /api/notes/:id': (req, params) => supprimer(Number(params.id)),
}
