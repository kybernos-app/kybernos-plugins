// test-deploy.mjs — the cloud batch's locally provable half: the deploy artifact (faithful, with
// checksums), the secret scan (nothing credential-shaped ever enters), and the restore drill with
// REAL measured durations (the plan's RPO/RTO numbers live or die here).
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildDeploy, verifyDeploy } from './lib/deploy.mjs'
import { restoreBase, snapshotBase } from './lib/backup.mjs'
import { scaffoldApp } from './lib/apps.mjs'
import { scaffoldFromTemplate } from './lib/templates.mjs'

let echecs = 0
const check = (libelle, ok, detail) => {
  if (ok === true) { console.log('  \u2713 ' + libelle); return }
  echecs++
  console.log('  \u2717 ' + libelle + (detail !== undefined ? ' \u2014 ' + JSON.stringify(detail) : ''))
}

const racine = mkdtempSync(join(tmpdir(), 'kb-deploy-'))
const require = createRequire(import.meta.url)
try {
  const dir = join(racine, 'boutique')
  scaffoldApp(racine, { nom: 'Boutique', slug: 'boutique', stack: 'commerce' })
  scaffoldFromTemplate(dir, 'commerce')

  console.log('artifact')
  const artefact = buildDeploy(dir)
  check('it builds', artefact.ok === true, artefact)
  check('the snapshot and its manifest exist', existsSync(join(dir, '.deploy', 'app', 'server.js')) && existsSync(join(dir, '.deploy', 'manifest.json')))
  const verif = verifyDeploy(dir)
  check('every checksum verifies', verif.ok === true && verif.fichiers > 5, verif)
  check('runtime noise stays out', existsSync(join(dir, '.deploy', 'app', 'logs')) === false && existsSync(join(dir, '.deploy', 'app', '.runtime.json')) === false)

  console.log('secrets never ship')
  writeFileSync(join(dir, '.env'), 'STRIPE_SECRET_KEY=sk_test_aaaaaaaaaaaaaaaa\n')
  const env = buildDeploy(dir)
  check('a credentials file is refused outright', env.ok === false && /credentials file/.test(env.error), env)
  rmSync(join(dir, '.env'), { force: true })
  writeFileSync(join(dir, 'notes.txt'), 'the key is sk_test_abcdef1234567890 in the config\n')
  const secret = buildDeploy(dir)
  check('a secret-shaped string is refused by the scan', secret.ok === false && /Stripe secret key/.test(secret.error), secret)
  rmSync(join(dir, 'notes.txt'), { force: true })

  console.log('the restore drill (measured)')
  const appDb = require(join(dir, 'db.js'))
  const b = appDb.open()
  b.prepare('INSERT INTO produits (nom, prix_cents, stock) VALUES (?, ?, ?)').run('Produit du drill', 1000, 1)
  appDb.close()
  const snap = snapshotBase(dir)
  check('the snapshot takes it (' + snap.ms + ' ms)', snap.ok === true && snap.ms < 5000, snap)
  writeFileSync(join(dir, 'donnees.sqlite'), Buffer.from('corrupted on purpose'))
  const retour = restoreBase(dir, snap.fichier)
  check('the restore brings the data back (' + retour.ms + ' ms)', retour.ok === true && retour.ms < 30000, retour)
  const b2 = require(join(dir, 'db.js')).open()
  const recup = b2.prepare('SELECT COUNT(*) AS n FROM produits WHERE nom = ?').get('Produit du drill').n
  appDb.close()
  check('the row survived the drill', recup === 1, recup)
  check('the measured RTO budget holds (restore < 30 s)', retour.ms < 30000)
} finally {
  rmSync(racine, { recursive: true, force: true })
}

if (echecs > 0) { console.log('test-deploy: ' + echecs + ' failure(s)'); process.exit(1) }
console.log('test-deploy: all green')
