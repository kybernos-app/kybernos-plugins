// medias.js — the media chain: upload with magic-byte sniffing and a quota, stored OUTSIDE the
// public root (media/), served through a route whose path comes from the database, never from the
// client. CDN derivatives arrive with the cloud batch. POST /api/medias is an admin route OPEN in
// local POC mode — the link key comes with the foundation batch.
const fs = require('node:fs')
const path = require('node:path')
const db = require('../db.js')

const STOCKAGE = path.join(__dirname, '..', 'media')
const QUOTA = 500 * 1024
const TYPES = [
  { mime: 'image/png', ext: 'png', magie: [0x89, 0x50, 0x4e, 0x47] },
  { mime: 'image/jpeg', ext: 'jpg', magie: [0xff, 0xd8, 0xff] },
  { mime: 'image/webp', ext: 'webp', magie: [0x52, 0x49, 0x46, 0x46], offset: [0x57, 0x45, 0x42, 0x50], offsetAt: 8 },
]

const sniffer = (t) => {
  for (const type of TYPES) {
    if (type.magie.every((o, i) => t[i] === o) !== true) continue
    if (type.offset !== undefined && type.offset.every((o, i) => t[type.offsetAt + i] === o) !== true) continue
    return type
  }
  return null
}

const televerser = (corps) => {
  const brut = typeof (corps && corps.data) === 'string' ? corps.data : ''
  const m = /^data:([a-z0-9.+/-]+);base64,(.+)$/i.exec(brut)
  if (m === null) return { ok: false, error: 'data must be a base64 data URL' }
  const tampon = Buffer.from(m[2], 'base64')
  if (tampon.length === 0) return { ok: false, error: 'empty file' }
  if (tampon.length > QUOTA) return { ok: false, error: 'file too large (' + Math.round(QUOTA / 1024) + ' KB max)' }
  const type = sniffer(tampon)
  if (type === null) return { ok: false, error: 'unsupported or spoofed type' }
  const b = db.open()
  const r = b.prepare('INSERT INTO medias (mime, taille, chemin) VALUES (?, ?, ?)').run(type.mime, tampon.length, '')
  const id = Number(r.lastInsertRowid)
  const nom = id + '.' + type.ext
  fs.mkdirSync(STOCKAGE, { recursive: true })
  fs.writeFileSync(path.join(STOCKAGE, nom), tampon)
  b.prepare('UPDATE medias SET chemin = ? WHERE id = ?').run(nom, id)
  return { ok: true, id, mime: type.mime, taille: tampon.length }
}

const attacher = (params, corps) => {
  const produitId = Number(params.id)
  const mediaId = Number(corps && corps.media_id)
  const b = db.open()
  if (b.prepare('SELECT id FROM medias WHERE id = ?').get(mediaId) === undefined) return { ok: false, error: 'unknown media' }
  const r = b.prepare('UPDATE produits SET image_id = ? WHERE id = ?').run(mediaId, produitId)
  return Number(r.changes) > 0 ? { ok: true } : { ok: false, error: 'unknown product' }
}

// Binary route: it answers the response itself (the dispatcher leaves `undefined` alone).
const servir = (req, res, params) => {
  const b = db.open()
  const m = b.prepare('SELECT mime, chemin FROM medias WHERE id = ?').get(Number(params.id))
  if (m === undefined || m.chemin === '') { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); return undefined }
  const fichier = path.normalize(path.join(STOCKAGE, m.chemin))
  if (fichier.startsWith(STOCKAGE + path.sep) !== true || fs.existsSync(fichier) !== true) {
    res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); return undefined
  }
  res.writeHead(200, { 'content-type': m.mime, 'content-length': fs.statSync(fichier).size, 'cache-control': 'public, max-age=31536000, immutable' })
  fs.createReadStream(fichier).pipe(res)
  return undefined
}

exports.routes = {
  'POST /api/medias': (req) => televerser(req.body),
  'POST /api/produits/:id/image': (req, params) => attacher(params, req.body),
  'GET /api/medias/:id': (req, params, res) => servir(req, res, params),
}
