// The commerce preset: products and orders. Invariants (proven by the conformance suite): stock is
// never negative, and an order line is priced from the product at the moment the order is placed.
// POST /api/produits is an admin route OPEN in local POC mode — the link key and visitor auth come
// with the foundation batch; do not publish this template as-is.
const db = require('../db.js')

const texte = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

const produits = () => ({ ok: true, produits: db.open().prepare('SELECT id, nom, description, prix_cents, stock FROM produits WHERE actif = 1 ORDER BY id').all() })

const creerProduit = (corps) => {
  const nom = texte(corps && corps.nom, 200)
  if (nom === '') return { ok: false, error: 'nom is required' }
  const prix = Number(corps && corps.prix_cents)
  const stock = Number(corps && corps.stock)
  if (Number.isInteger(prix) !== true || prix < 0) return { ok: false, error: 'prix_cents must be a positive integer' }
  if (Number.isInteger(stock) !== true || stock < 0) return { ok: false, error: 'stock must be a positive integer' }
  const b = db.open()
  const r = b.prepare('INSERT INTO produits (nom, description, prix_cents, stock) VALUES (?, ?, ?, ?)').run(nom, texte(corps && corps.description, 2000), prix, stock)
  return { ok: true, id: Number(r.lastInsertRowid) }
}

const creerCommande = (corps) => {
  const nom = texte(corps && corps.client_nom, 200)
  const email = texte(corps && corps.client_email, 320)
  const lignes = corps !== null && corps !== undefined && Array.isArray(corps.lignes) === true ? corps.lignes.slice(0, 50) : []
  if (nom === '' || email === '') return { ok: false, error: 'client_nom and client_email are required' }
  if (lignes.length === 0) return { ok: false, error: 'lignes is required' }
  const b = db.open()
  b.exec('BEGIN')
  try {
    let total = 0
    const valides = []
    for (const ligne of lignes) {
      const produitId = Number(ligne && ligne.produit_id)
      const quantite = Number(ligne && ligne.quantite)
      if (Number.isInteger(produitId) !== true || Number.isInteger(quantite) !== true || quantite <= 0) throw new Error('invalid line')
      const p = b.prepare('SELECT id, nom, prix_cents, stock FROM produits WHERE id = ? AND actif = 1').get(produitId)
      if (p === undefined) throw new Error('unknown product ' + produitId)
      if (p.stock < quantite) throw new Error('not enough stock for ' + p.nom)
      valides.push({ p, quantite })
      total += p.prix_cents * quantite
    }
    const r = b.prepare('INSERT INTO commandes (client_nom, client_email, total_cents) VALUES (?, ?, ?)').run(nom, email, total)
    const id = Number(r.lastInsertRowid)
    const ins = b.prepare('INSERT INTO commande_lignes (commande_id, produit_id, quantite, prix_cents) VALUES (?, ?, ?, ?)')
    const majStock = b.prepare('UPDATE produits SET stock = stock - ? WHERE id = ?')
    for (const l of valides) {
      ins.run(id, l.p.id, l.quantite, l.p.prix_cents)
      majStock.run(l.quantite, l.p.id)
    }
    b.exec('COMMIT')
    return { ok: true, id, total_cents: total }
  } catch (e) {
    b.exec('ROLLBACK')
    return { ok: false, error: String((e && e.message) || e).slice(0, 120) }
  }
}

const listerCommandes = () => {
  const b = db.open()
  const commandes = b.prepare('SELECT id, client_nom, client_email, statut, total_cents, cree_le FROM commandes ORDER BY id DESC').all()
  const lignes = b.prepare('SELECT commande_id, produit_id, quantite, prix_cents FROM commande_lignes').all()
  for (const c of commandes) c.lignes = lignes.filter((l) => l.commande_id === c.id)
  return { ok: true, commandes }
}

exports.routes = {
  'GET /api/produits': () => produits(),
  'POST /api/produits': (req) => creerProduit(req.body),
  'GET /api/commandes': () => listerCommandes(),
  'POST /api/commandes': (req) => creerCommande(req.body),
}
