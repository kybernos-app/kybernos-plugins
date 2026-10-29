// The commerce preset: products, orders and the transactional core. Invariants (proven by the
// conformance suite): stock is never negative; an order line is priced from the product at the
// moment the order is placed; an order RESERVES its availability until payment, expiry or
// cancellation; a payment event is applied at most once (idempotent by event id). Node runs each
// handler synchronously over one SQLite connection, so two orders for the last item serialise:
// the second sees the reservation and is refused.
// OPEN in local POC mode: POST /api/produits (admin) and POST /api/webhooks/stripe (the Stripe
// signature check arrives with the Stripe batch). Do not publish this template as-is.
const db = require('../db.js')
const fs = require('node:fs')
const path = require('node:path')
const emails = require('../emails.js')

/** The shop configuration (shop.json at the template root): words and palette, never layout. */
const shop = () => {
  try {
    const brut = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'shop.json'), 'utf8'))
    return { ok: true, nom: brut.nom, slogan: brut.slogan, annonce: brut.annonce, sections: brut.sections, palette: brut.palette }
  } catch (e) {
    return { ok: false, error: 'shop.json unreadable' }
  }
}

const texte = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const RESERVATION_MIN = 30
const DEVISE = 'eur'

/** Cancel reservations older than RESERVATION_MIN and release their hold (lazy: on every read). */
const expirer = (b) => {
  const perimees = b.prepare("SELECT id FROM commandes WHERE statut = 'reservee' AND cree_le < datetime('now', ?)").all('-' + RESERVATION_MIN + ' minutes')
  if (perimees.length === 0) return 0
  const lignes = b.prepare('SELECT commande_id, produit_id, quantite FROM commande_lignes').all()
  const liberer = b.prepare('UPDATE produits SET reserve = reserve - ? WHERE id = ?')
  const annuler = b.prepare("UPDATE commandes SET statut = 'annulee' WHERE id = ?")
  for (const c of perimees) {
    for (const l of lignes.filter((x) => x.commande_id === c.id)) liberer.run(l.quantite, l.produit_id)
    annuler.run(c.id)
  }
  return perimees.length
}

const produits = () => {
  const b = db.open()
  expirer(b)
  return { ok: true, produits: b.prepare('SELECT id, nom, description, prix_cents, stock, reserve, image_id, stock - reserve AS dispo FROM produits WHERE actif = 1 ORDER BY id').all() }
}

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
  expirer(b)
  b.exec('BEGIN')
  try {
    let total = 0
    const valides = []
    for (const ligne of lignes) {
      const produitId = Number(ligne && ligne.produit_id)
      const quantite = Number(ligne && ligne.quantite)
      if (Number.isInteger(produitId) !== true || Number.isInteger(quantite) !== true || quantite <= 0) throw new Error('invalid line')
      const p = b.prepare('SELECT id, nom, prix_cents, stock, reserve FROM produits WHERE id = ? AND actif = 1').get(produitId)
      if (p === undefined) throw new Error('unknown product ' + produitId)
      if (p.stock - p.reserve < quantite) throw new Error('not enough stock for ' + p.nom)
      valides.push({ p, quantite })
      total += p.prix_cents * quantite
    }
    const r = b.prepare("INSERT INTO commandes (client_nom, client_email, total_cents, statut) VALUES (?, ?, ?, 'reservee')").run(nom, email, total)
    const id = Number(r.lastInsertRowid)
    const ins = b.prepare('INSERT INTO commande_lignes (commande_id, produit_id, quantite, prix_cents) VALUES (?, ?, ?, ?)')
    const reserver = b.prepare('UPDATE produits SET reserve = reserve + ? WHERE id = ?')
    for (const l of valides) {
      ins.run(id, l.p.id, l.quantite, l.p.prix_cents)
      reserver.run(l.quantite, l.p.id)
    }
    b.exec('COMMIT')
    return { ok: true, id, total_cents: total, statut: 'reservee' }
  } catch (e) {
    b.exec('ROLLBACK')
    return { ok: false, error: String((e && e.message) || e).slice(0, 120) }
  }
}

// Payment truth comes from events, never from a redirect. Idempotent by event id; amounts are
// checked against the order; out-of-order events are tolerated (a late payment on an expired
// order still wins, MAX() keeping the hold sane). The Stripe signature check arrives with the
// Stripe batch — this core is the idempotency and the state machine.
const webhook = (corps) => {
  const eventId = texte(corps && corps.event_id, 200)
  const type = texte(corps && corps.type, 100)
  const commandeId = Number(corps && corps.commande_id)
  if (eventId === '') return { ok: false, error: 'event_id is required' }
  const b = db.open()
  const vu = b.prepare('INSERT OR IGNORE INTO webhooks (event_id, type) VALUES (?, ?)').run(eventId, type)
  if (Number(vu.changes) === 0) return { ok: true, effet: 'deja-traite' }
  const marquer = (effet) => b.prepare('UPDATE webhooks SET effet = ? WHERE event_id = ?').run(effet, eventId)
  const c = b.prepare('SELECT id, statut, total_cents, client_email FROM commandes WHERE id = ?').get(commandeId)
  if (type === 'checkout.session.completed') {
    if (c === undefined) { marquer('refuse'); return { ok: false, error: 'unknown commande' } }
    const montant = Number(corps && corps.amount_cents)
    const devise = texte(corps && corps.currency, 10)
    if (montant !== c.total_cents || devise !== DEVISE) { marquer('refuse'); return { ok: false, error: 'amount or currency mismatch' } }
    if (c.statut === 'payee') { marquer('ignore'); return { ok: true, effet: 'ignore' } }
    b.exec('BEGIN')
    try {
      const lignes = b.prepare('SELECT produit_id, quantite FROM commande_lignes WHERE commande_id = ?').all(commandeId)
      const liberer = b.prepare('UPDATE produits SET reserve = MAX(reserve - ?, 0), stock = stock - ? WHERE id = ?')
      for (const l of lignes) liberer.run(l.quantite, l.quantite, l.produit_id)
      b.prepare("UPDATE commandes SET statut = 'payee' WHERE id = ?").run(commandeId)
      b.exec('COMMIT')
    } catch (e) { b.exec('ROLLBACK'); throw e }
    marquer('payee')
    // one confirmation email per payment event — a replay never reaches this line (003)
    const lignesMail = b.prepare('SELECT l.quantite, l.prix_cents, p.nom AS produit FROM commande_lignes l JOIN produits p ON p.id = l.produit_id WHERE l.commande_id = ?').all(commandeId)
    const message = emails.rendreConfirmation({ id: commandeId, total_cents: c.total_cents }, lignesMail)
    emails.envoyer(c.client_email, message)
    b.prepare('INSERT INTO emails (commande_id, sujet, destinataire) VALUES (?, ?, ?)').run(commandeId, message.sujet, c.client_email)
    return { ok: true, effet: 'payee' }
  }
  if (type === 'charge.refunded') {
    if (c === undefined) { marquer('refuse'); return { ok: false, error: 'unknown commande' } }
    b.prepare("UPDATE commandes SET statut = 'remboursee' WHERE id = ?").run(commandeId)
    marquer('remboursee')
    return { ok: true, effet: 'remboursee' }
  }
  marquer('ignore')
  return { ok: true, effet: 'ignore' }
}

const listerCommandes = () => {
  const b = db.open()
  expirer(b)
  const commandes = b.prepare('SELECT id, client_nom, client_email, statut, total_cents, cree_le FROM commandes ORDER BY id DESC').all()
  const lignes = b.prepare('SELECT commande_id, produit_id, quantite, prix_cents FROM commande_lignes').all()
  for (const c of commandes) c.lignes = lignes.filter((l) => l.commande_id === c.id)
  return { ok: true, commandes }
}

exports.routes = {
  'GET /api/shop': () => shop(),
  'GET /api/produits': () => produits(),
  'POST /api/produits': (req) => creerProduit(req.body),
  'GET /api/commandes': () => listerCommandes(),
  'POST /api/commandes': (req) => creerCommande(req.body),
  'POST /api/webhooks/stripe': (req) => webhook(req.body),
}
