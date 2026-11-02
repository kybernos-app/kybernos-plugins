// Downloads and extraction: bounded, https-only in production, hashed while streamed, and a tar that cannot leave its folder.
// A local HTTP server stands in for GitHub (the test opens the http door that production keeps shut); the tar is the real one.
//   node packages/kybernos-hub/test-telechargement.mjs
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import http from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cheminsSurs, creerTelechargeurs } from './telechargement.mjs'

let echecs = 0
let total = 0
const ok = (nom, cond, detail) => { total += 1; if (cond) console.log('  ✓ ' + nom); else { echecs += 1; console.log('  ✗ ' + nom + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 200) : '')) } }
const rejette = async (fn) => { try { await fn(); return null } catch (e) { return e.code ?? e.message } }

const tmp = mkdtempSync(join(tmpdir(), 'kb-dl-'))
const fabriquer = (nom, fichiers) => {
  const dossier = join(tmp, nom)
  for (const [chemin, contenu] of Object.entries(fichiers)) { mkdirSync(join(dossier, chemin, '..'), { recursive: true }); writeFileSync(join(dossier, chemin), contenu) }
  const archive = join(tmp, nom + '.tar.gz')
  execFileSync('tar', ['-czf', archive, '-C', dossier, '.'])
  return readFileSync(archive)
}
const bonne = fabriquer('bonne', { 'scripts/dsh-lifecycle.mjs': 'console.log(1)', 'manifest.json': '{}', 'VERSION': '1.1.0' })
const enveloppee = (() => { const d = join(tmp, 'env'); mkdirSync(join(d, 'kybernos-1.1.0', 'scripts'), { recursive: true }); writeFileSync(join(d, 'kybernos-1.1.0', 'scripts', 'dsh-lifecycle.mjs'), 'x'); writeFileSync(join(d, 'kybernos-1.1.0', 'manifest.json'), '{}'); execFileSync('tar', ['-czf', join(tmp, 'env.tar.gz'), '-C', d, '.']); return readFileSync(join(tmp, 'env.tar.gz')) })()
const sansRobot = fabriquer('sansrobot', { 'VERSION': '1.1.0' })

const serveur = http.createServer((req, res) => {
  const t = { '/doc': Buffer.from('{"a":1}'), '/bonne.tar.gz': bonne, '/env.tar.gz': enveloppee, '/sansrobot.tar.gz': sansRobot, '/gros': Buffer.alloc(5000, 1) }[req.url.split('?')[0]]
  if (req.url === '/redir') { res.writeHead(302, { location: '/doc' }); res.end(); return }
  if (t === undefined) { res.writeHead(404); res.end('no'); return }
  res.writeHead(200, { 'content-type': 'application/octet-stream' }); res.end(t)
})
await new Promise((r) => serveur.listen(0, '127.0.0.1', r))
const base = 'http://127.0.0.1:' + serveur.address().port

console.log('paths in a tar listing')
ok('relative paths inside the folder are safe', cheminsSurs('./\n./scripts/\n./scripts/a.mjs\nkybernos/manifest.json\n'))
ok('an absolute path, a drive, `..` anywhere, and backslash tricks are not', !cheminsSurs('/etc/passwd\n') && !cheminsSurs('C:\\Windows\\x\n') && !cheminsSurs('a/../../b\n') && !cheminsSurs('..\n') && !cheminsSurs('ok/file\n..\\evil\n') && cheminsSurs('a..b/c..d\n'))

console.log('production refuses plain http')
{
  const prod = creerTelechargeurs({ tmp })
  ok('http, ftp, file and junk URLs are refused before any request', await rejette(() => prod.telecharger(base + '/doc', { max: 100 })) === 'url' && await rejette(() => prod.telecharger('ftp://x/y', { max: 100 })) === 'url' && await rejette(() => prod.telecharger('file:///etc/passwd', { max: 100 })) === 'url' && await rejette(() => prod.telechargerVers('not a url', { max: 100 })) === 'url')
}

console.log('a small document')
{
  const t = creerTelechargeurs({ tmp, autoriserHttp: true })
  ok('it comes back whole', (await t.telecharger(base + '/doc', { max: 100 })).toString() === '{"a":1}')
  ok('a redirect is followed', (await t.telecharger(base + '/redir', { max: 100 })).toString() === '{"a":1}')
  ok('more than the limit is cut off, not buffered', await rejette(() => t.telecharger(base + '/gros', { max: 1000 })) === 'trop-gros')
  ok('an HTTP error is reported', await rejette(() => t.telecharger(base + '/absent', { max: 100 })) === 'http')
}

console.log('an archive')
{
  const t = creerTelechargeurs({ tmp, autoriserHttp: true })
  const r = await t.telechargerVers(base + '/bonne.tar.gz', { max: 10_000_000 })
  ok('it is streamed to a temp file with its real SHA-256 and size', existsSync(r.fichier) && r.sha256 === createHash('sha256').update(bonne).digest('hex') && r.taille === bonne.length && readFileSync(r.fichier).equals(bonne))
  const racine = await t.extraire(r.fichier)
  ok('it is extracted and the folder with the robot and the manifest is found', existsSync(join(racine, 'scripts', 'dsh-lifecycle.mjs')) && existsSync(join(racine, 'manifest.json')))
  const dossier = t.dossierTemporaire()
  t.nettoyer()
  ok('clean-up removes the whole temp folder, and is safe to repeat', !existsSync(dossier) && t.dossierTemporaire() === null && (t.nettoyer(), true))

  const t2 = creerTelechargeurs({ tmp, autoriserHttp: true })
  const e = await t2.telechargerVers(base + '/env.tar.gz', { max: 10_000_000 })
  const r2 = await t2.extraire(e.fichier)
  ok('an archive with one top folder (kybernos-1.1.0/) works too', r2.endsWith('kybernos-1.1.0') && existsSync(join(r2, 'manifest.json')))
  t2.nettoyer()

  const t3 = creerTelechargeurs({ tmp, autoriserHttp: true })
  const s = await t3.telechargerVers(base + '/sansrobot.tar.gz', { max: 10_000_000 })
  ok('an archive with no robot and no manifest is refused', await rejette(() => t3.extraire(s.fichier)) === 'bad-archive')
  t3.nettoyer()

  const t4 = creerTelechargeurs({ tmp, autoriserHttp: true })
  ok('an archive bigger than the signed size is cut off while streaming', await rejette(() => t4.telechargerVers(base + '/gros', { max: 1000 })) === 'trop-gros')
  t4.nettoyer()

  // a tar whose listing leaves the folder is refused before anything is extracted: fake the launcher with a hostile listing
  const t5 = creerTelechargeurs({ tmp, autoriserHttp: true, lancer: (cmd, args, opts, cb) => (args[0] === '-tzf' ? cb(null, '../../evil\n') : cb(null, '')) })
  const h = await t5.telechargerVers(base + '/bonne.tar.gz', { max: 10_000_000 })
  ok('a hostile listing (a `..` path) is refused before extraction', await rejette(() => t5.extraire(h.fichier)) === 'bad-archive' && !existsSync(join(t5.dossierTemporaire(), 'contenu', 'scripts')))
  t5.nettoyer()
  const t6 = creerTelechargeurs({ tmp, autoriserHttp: true, lancer: (cmd, args, opts, cb) => cb(new Error('tar: damaged')) })
  const d = await t6.telechargerVers(base + '/bonne.tar.gz', { max: 10_000_000 })
  ok('a damaged archive (tar fails) is a bad-archive, not a crash', await rejette(() => t6.extraire(d.fichier)) === 'bad-archive')
  t6.nettoyer()
}
serveur.close()

console.log('\n' + (total - echecs) + '/' + total + ' passed')
process.exit(echecs === 0 ? 0 : 1)
