// test-templates.mjs — the conformance suite of the stack catalog: scaffold, boot through the REAL
// runtime, serve, stop. Same suite for every stack (rule of the adversarial review, 2026-10-27):
// a stack that does not pass here does not enter the catalog.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scaffoldApp } from './lib/apps.mjs'
import { DEFAULT_STACK, listTemplates, scaffoldFromTemplate } from './lib/templates.mjs'
import { startApp, stopApp } from './lib/runtime.mjs'

let echecs = 0
const check = (libelle, ok, detail) => {
  if (ok === true) { console.log('  \u2713 ' + libelle); return }
  echecs++
  console.log('  \u2717 ' + libelle + (detail !== undefined ? ' \u2014 ' + JSON.stringify(detail) : ''))
}

console.log('catalogue')
const catalogue = listTemplates()
check('three stacks listed', catalogue.length === 3, catalogue)
check('every stack is present on disk', catalogue.every((t) => t.dispo === true), catalogue)
check('the default stack is web', DEFAULT_STACK === 'web')
check('an unknown stack is refused', scaffoldFromTemplate('/tmp/nowhere', 'php-nuke').ok === false)

const racine = mkdtempSync(join(tmpdir(), 'kb-tpl-'))
try {
  console.log('statique — the real runtime boots it')
  const s = scaffoldFromTemplate(join(racine, 'site'), 'statique')
  check('scaffolded', s.ok === true && existsSync(join(racine, 'site', 'public', 'index.html')), s)
  const ds = await startApp(join(racine, 'site'))
  check('it serves', ds.ok === true, ds)
  const page = await fetch('http://127.0.0.1:' + ds.port + '/')
  check('the landing answers 200', page.status === 200 && (await page.text()).includes('landing page'))
  // Traversal is proven on the wire: fetch() normalises dot segments away, so its URL would never
  // reach the guard. A raw socket sends what an attacker sends.
  const { createConnection } = await import('node:net')
  const reponse = await new Promise((resoudre) => {
    const s = createConnection({ host: '127.0.0.1', port: ds.port }, () => {
      s.write('GET /../server.js HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n')
    })
    let buf = ''
    s.on('data', (d) => { buf += d })
    s.on('end', () => resoudre(buf))
  })
  check('path traversal is refused on the wire', reponse.startsWith('HTTP/1.1 403'), reponse.slice(0, 24))
  await stopApp(join(racine, 'site'))

  console.log('web — the real runtime boots it')
  const w = scaffoldFromTemplate(join(racine, 'app'), 'web')
  check('scaffolded', w.ok === true && existsSync(join(racine, 'app', 'api.js')), w)
  const dw = await startApp(join(racine, 'app'))
  check('it serves', dw.ok === true, dw)
  const sante = await fetch('http://127.0.0.1:' + dw.port + '/api/health')
  const corps = await sante.json()
  check('the API answers', sante.status === 200 && corps.ok === true && corps.stack === 'web', corps)
  const shell = await fetch('http://127.0.0.1:' + dw.port + '/')
  check('the shell answers 200', shell.status === 200 && (await shell.text()).includes('/api/notes'))
  // the CRUD loop through the wire: create, list, toggle, delete — the POC's heart
  const cree = await fetch('http://127.0.0.1:' + dw.port + '/api/notes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ titre: 'Premiere note', contenu: 'demo' }) })
  check('a note is created', cree.status === 200 && (await cree.json()).ok === true)
  const vide = await fetch('http://127.0.0.1:' + dw.port + '/api/notes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contenu: 'sans titre' }) })
  check('a note without a title is refused', vide.status === 400 && (await vide.json()).ok === false)
  const liste = await (await fetch('http://127.0.0.1:' + dw.port + '/api/notes')).json()
  check('the list carries it', liste.ok === true && liste.notes.length === 1 && liste.notes[0].titre === 'Premiere note', liste)
  const id = liste.notes[0].id
  await fetch('http://127.0.0.1:' + dw.port + '/api/notes/' + id, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fait: 1 }) })
  check('it toggles done', (await (await fetch('http://127.0.0.1:' + dw.port + '/api/notes')).json()).notes[0].fait === 1)
  await fetch('http://127.0.0.1:' + dw.port + '/api/notes/' + id, { method: 'DELETE' })
  check('it deletes', (await (await fetch('http://127.0.0.1:' + dw.port + '/api/notes')).json()).notes.length === 0)
  const sante2 = await (await fetch('http://127.0.0.1:' + dw.port + '/api/health')).json()
  check('the migrations were recorded (notes + _migrations)', sante2.base.present === true && sante2.base.tables >= 2, sante2.base)
  await stopApp(join(racine, 'app'))

  console.log('commerce — the preset on top of web, with its stock invariant')
  const c = scaffoldFromTemplate(join(racine, 'boutique'), 'commerce')
  check('scaffolded (web base + commerce overlay)', c.ok === true && existsSync(join(racine, 'boutique', 'routes', 'boutique.js')) && existsSync(join(racine, 'boutique', 'migrations', '002-commerce.sql')), c)
  const dc = await startApp(join(racine, 'boutique'))
  check('it serves', dc.ok === true, dc)
  const P = (p, body) => fetch('http://127.0.0.1:' + dc.port + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  await P('/api/produits', { nom: 'Gobelet emaille', prix_cents: 1200, stock: 3 })
  await P('/api/produits', { nom: 'Tasse', prix_cents: 800, stock: 1 })
  const prods = await (await fetch('http://127.0.0.1:' + dc.port + '/api/produits')).json()
  check('two products are listed', prods.produits.length === 2, prods)
  const cmd = await (await P('/api/commandes', { client_nom: 'Demo', client_email: 'demo@test.example', lignes: [{ produit_id: prods.produits[0].id, quantite: 2 }] })).json()
  check('an order reserves and is priced from the product', cmd.ok === true && cmd.total_cents === 2400 && cmd.statut === 'reservee', cmd)
  const prods2 = await (await fetch('http://127.0.0.1:' + dc.port + '/api/produits')).json()
  check('availability follows (3 -> 1) while stock waits for payment', prods2.produits[0].dispo === 1 && prods2.produits[0].stock === 3, prods2.produits)
  const trop = await (await P('/api/commandes', { client_nom: 'Demo', client_email: 'demo@test.example', lignes: [{ produit_id: prods.produits[1].id, quantite: 5 }] })).json()
  check('over-ordering is refused', trop.ok === false, trop)
  const prods3 = await (await fetch('http://127.0.0.1:' + dc.port + '/api/produits')).json()
  check('a refused order leaves availability intact', prods3.produits[1].dispo === 1, prods3.produits)
  const cmds = await (await fetch('http://127.0.0.1:' + dc.port + '/api/commandes')).json()
  check('the order is recorded with its line', cmds.commandes.length === 1 && cmds.commandes[0].lignes.length === 1 && cmds.commandes[0].total_cents === 2400, cmds)
  // payment: idempotent by event id, amount checked, state derived from the webhook
  const faux = await (await P('/api/webhooks/stripe', { event_id: 'evt_1', type: 'checkout.session.completed', commande_id: cmd.id, amount_cents: 999, currency: 'eur' })).json()
  check('a wrong amount is refused', faux.ok === false, faux)
  const paye = await (await P('/api/webhooks/stripe', { event_id: 'evt_2', type: 'checkout.session.completed', commande_id: cmd.id, amount_cents: 2400, currency: 'eur' })).json()
  check('payment marks the order paid and moves stock', paye.ok === true && paye.effet === 'payee', paye)
  const prods4 = await (await fetch('http://127.0.0.1:' + dc.port + '/api/produits')).json()
  check('stock moved at payment (3 -> 1) and the hold is released', prods4.produits[0].stock === 1 && prods4.produits[0].dispo === 1, prods4.produits)
  const rejoue = await (await P('/api/webhooks/stripe', { event_id: 'evt_2', type: 'checkout.session.completed', commande_id: cmd.id, amount_cents: 2400, currency: 'eur' })).json()
  check('a replayed event has no second effect', rejoue.ok === true && rejoue.effet === 'deja-traite', rejoue)
  const prods5 = await (await fetch('http://127.0.0.1:' + dc.port + '/api/produits')).json()
  check('the replay changed nothing', prods5.produits[0].stock === 1 && prods5.produits[0].dispo === 1, prods5.produits)
  // the last-item race
  await P('/api/produits', { nom: 'Dernier exemplaire', prix_cents: 500, stock: 1 })
  const duel = await Promise.all([
    P('/api/commandes', { client_nom: 'A', client_email: 'a@test.example', lignes: [{ produit_id: 3, quantite: 1 }] }),
    P('/api/commandes', { client_nom: 'B', client_email: 'b@test.example', lignes: [{ produit_id: 3, quantite: 1 }] }),
  ])
  const duels = await Promise.all(duel.map((r) => r.json()))
  check('the last item goes to exactly one buyer', duels.filter((r) => r.ok === true).length === 1, duels)
  // expiry releases the hold
  const { DatabaseSync } = await import('node:sqlite')
  const base = new DatabaseSync(join(racine, 'boutique', 'donnees.sqlite'))
  base.exec("UPDATE commandes SET cree_le = datetime('now', '-2 hours') WHERE statut = 'reservee'")
  base.close()
  await fetch('http://127.0.0.1:' + dc.port + '/api/produits')
  const prods6 = await (await fetch('http://127.0.0.1:' + dc.port + '/api/produits')).json()
  check('an expired reservation releases its hold', prods6.produits[2].dispo === 1 && prods6.produits[2].stock === 1, prods6.produits)
  // the themed storefront: shop.json drives the palette and the words, the kit sections carry the layout
  const magasin = await (await fetch('http://127.0.0.1:' + dc.port + '/api/shop')).json()
  check('the shop config answers', magasin.ok === true && magasin.nom === 'Atelier Café' && typeof magasin.palette.accent === 'string', magasin)
  const vitrine = await (await fetch('http://127.0.0.1:' + dc.port + '/')).text()
  check('the storefront carries the kit sections', ['sec-announcement', 'sec-header', 'sec-hero', 'sec-products', 'sec-cart', 'sec-footer'].every((s) => vitrine.includes(s)), vitrine.length)
  check('the storefront reads the shop config and the product API', vitrine.includes('/api/shop') && vitrine.includes('/api/produits'))
  await stopApp(join(racine, 'boutique'))

  console.log('brief + template, the way /create does it')
  const r = scaffoldApp(racine, { nom: 'Flux', slug: 'flux', stack: 'web' })
  check('the brief records its stack', r.ok === true && readFileSync(join(racine, 'flux', 'webapp.json'), 'utf8').includes('"stack": "web"'))
  const t = scaffoldFromTemplate(join(racine, 'flux'), 'web')
  check('the template lands beside the brief', t.ok === true && existsSync(join(racine, 'flux', 'server.js')) && existsSync(join(racine, 'flux', 'webapp.json')))
} finally {
  rmSync(racine, { recursive: true, force: true })
}

if (echecs > 0) { console.log('test-templates: ' + echecs + ' failure(s)'); process.exit(1) }
console.log('test-templates: all green')
