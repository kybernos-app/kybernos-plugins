#!/usr/bin/env node
/** Host test of the settings writer of kybernos-sessions (`ecrireReglages`).
 *
 *  ~/.dsh/kybernos/settings.json is shared: the core bundle reads `pairingToken`,
 *  `gatewayBase` and `wsAdminKey` from it, kybernos-auto writes its own keys. A save
 *  from the Kybernos Settings page used to rewrite the file with its seven keys only,
 *  so those keys vanished. This test pins the merge, the atomic write, the file
 *  permissions and the corrupt-file behaviour. Everything runs in a temporary
 *  directory: nothing outside it is read or written.
 *
 *  Usage: node packages/kybernos-sessions/test-reglages.mjs   (exit 0 = all pass) */
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, chmodSync, symlinkSync, lstatSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ecrireReglages, lireReglages, readRawSettings, monterRoutes, REGLAGES_DEFAUT } from './index.js'

let ok0 = 0
let ko = 0
const ok = (nom, cond, detail) => {
  if (cond === true) { ok0 += 1; console.log('  ✓ ' + nom) } else { ko += 1; console.log('  ✗ ' + nom + (detail !== undefined ? ' → ' + JSON.stringify(detail).slice(0, 300) : '')) }
}

const racine = mkdtempSync(join(tmpdir(), 'ksess-reglages-'))
let n = 0
const nouveau = () => { n += 1; const dossier = join(racine, 'c' + n); mkdirSync(dossier); return join(dossier, 'settings.json') }
const ecrire = (f, objet) => writeFileSync(f, typeof objet === 'string' ? objet : JSON.stringify(objet, null, 2) + '\n')
const lire = (f) => JSON.parse(readFileSync(f, 'utf8'))
const fichiersAutour = (f) => readdirSync(join(f, '..'))
const estRoot = typeof process.getuid === 'function' && process.getuid() === 0

const SEPT = ['renameAfterRecap', 'brain', 'voiceInput', 'decisionBrain', 'autoRouting', 'autoWhitelist', 'autoClassifier']
const SECRETS = { pairingToken: 'pt-secret-123', gatewayBase: 'https://gateway.example', wsAdminKey: 'wk-secret-456' }

console.log('\n── the bug: keys of other bundles survive a save ──')
{
  const f = nouveau()
  ecrire(f, { ...SECRETS, brain: 'ollama/qwen', futureKey: { nested: [1, 2, 3] }, renameAfterRecap: true })
  const r = ecrireReglages(f, { renameAfterRecap: false })
  const disque = lire(f)
  ok('the save succeeds', r.ok === true, r)
  ok('pairingToken survives', disque.pairingToken === SECRETS.pairingToken, disque)
  ok('gatewayBase survives', disque.gatewayBase === SECRETS.gatewayBase)
  ok('wsAdminKey survives', disque.wsAdminKey === SECRETS.wsAdminKey)
  ok('an unknown future key survives, untouched', JSON.stringify(disque.futureKey) === JSON.stringify({ nested: [1, 2, 3] }))
  ok('the patched key is written', disque.renameAfterRecap === false)
  ok('an unpatched known key keeps its value', disque.brain === 'ollama/qwen')
  ok('the seven known keys are all on disk', SEPT.every((k) => k in disque), Object.keys(disque))
  ok('existing keys keep their position (clean diffs)', Object.keys(disque).slice(0, 3).join() === 'pairingToken,gatewayBase,wsAdminKey', Object.keys(disque))
  ok('the answer to the page holds the seven keys and NO secret', Object.keys(r.reglages).join() === SEPT.join() && !('pairingToken' in r.reglages) && !('wsAdminKey' in r.reglages), r.reglages)
  ok('reading back still hides the other keys', Object.keys(lireReglages(f)).join() === SEPT.join())
}

console.log('\n── a second save keeps everything too ──')
{
  const f = nouveau()
  ecrire(f, { ...SECRETS })
  ecrireReglages(f, { brain: 'a/b' })
  ecrireReglages(f, { voiceInput: 'native' })
  const disque = lire(f)
  ok('after two saves: secrets intact, both values written', disque.pairingToken === SECRETS.pairingToken && disque.wsAdminKey === SECRETS.wsAdminKey && disque.brain === 'a/b' && disque.voiceInput === 'native', disque)
}

console.log('\n── no file, empty file ──')
{
  const f = join(racine, 'neuf', 'sous', 'settings.json')
  const r = ecrireReglages(f, { renameAfterRecap: false })
  ok('a missing file (and its folders) is created', r.ok === true && lire(f).renameAfterRecap === false, r)
  ok('the defaults fill the other keys', lire(f).voiceInput === REGLAGES_DEFAUT.voiceInput && lire(f).autoRouting === false)
  ok('a new file is private (0600)', (statSync(f).mode & 0o777) === 0o600, (statSync(f).mode & 0o777).toString(8))
  const g = nouveau()
  ecrire(g, '   \n')
  {
  const g = join(racine, 'refus.json')
  const refuse = ecrireReglages(g, { brain: 42 })
  ok('a refused value is flagged as the sender\'s mistake (invalide), and nothing is written', refuse.ok === false && refuse.invalide === true && !existsSync(g), JSON.stringify(refuse))
  writeFileSync(g, '{not json')
  const bloque = ecrireReglages(g, { brain: 'a/b' })
  ok('a blocked settings.json is NOT flagged invalide (it is the host\'s trouble, 500)', bloque.ok === false && bloque.invalide !== true, JSON.stringify(bloque))
}
ok('an empty file counts as an empty object', ecrireReglages(g, { brain: 'a/b' }).ok === true && lire(g).brain === 'a/b')
}

console.log('\n── permissions are kept, never widened ──')
{
  const f = nouveau()
  ecrire(f, { ...SECRETS })
  chmodSync(f, 0o600)
  ecrireReglages(f, { brain: 'a/b' })
  ok('a 0600 file stays 0600', (statSync(f).mode & 0o777) === 0o600, (statSync(f).mode & 0o777).toString(8))
  const g = nouveau()
  ecrire(g, { ...SECRETS })
  chmodSync(g, 0o644)
  ecrireReglages(g, { brain: 'a/b' })
  ok('a 0644 file stays 0644 (not tightened behind the user\'s back)', (statSync(g).mode & 0o777) === 0o644, (statSync(g).mode & 0o777).toString(8))
}

console.log('\n── atomic write: nothing left behind ──')
{
  const f = nouveau()
  ecrire(f, { ...SECRETS })
  ecrireReglages(f, { brain: 'a/b' })
  ok('no temp file after a successful save', fichiersAutour(f).every((nom) => !nom.includes('.tmp-')), fichiersAutour(f))
  ok('the folder holds only settings.json', fichiersAutour(f).join() === 'settings.json', fichiersAutour(f))
}
if (estRoot) console.log('  (skipped: running as root, read-only folder tests are meaningless)')
else {
  const f = nouveau()
  ecrire(f, { ...SECRETS })
  const avant = readFileSync(f, 'utf8')
  const dossier = join(f, '..')
  chmodSync(dossier, 0o555)
  const r = ecrireReglages(f, { brain: 'a/b' })
  chmodSync(dossier, 0o755)
  ok('a failing write reports the error', r.ok === false && typeof r.erreur === 'string' && r.erreur.length > 0, r)
  ok('a failing write leaves the file byte for byte as it was', readFileSync(f, 'utf8') === avant)
  ok('a failing write leaves no temp file', fichiersAutour(f).join() === 'settings.json', fichiersAutour(f))
}

console.log('\n── a symlinked settings.json stays a symlink ──')
{
  const f = nouveau()
  const cible = join(racine, 'dotfiles-settings.json')
  ecrire(cible, { ...SECRETS })
  symlinkSync(cible, f)
  const r = ecrireReglages(f, { brain: 'a/b' })
  ok('the save succeeds through the link', r.ok === true, r)
  ok('the link is still a link', lstatSync(f).isSymbolicLink() === true)
  ok('the target holds the new value and the secrets', lire(cible).brain === 'a/b' && lire(cible).pairingToken === SECRETS.pairingToken, lire(cible))
}

console.log('\n── invalid patch: refused, file untouched ──')
{
  const f = nouveau()
  ecrire(f, { ...SECRETS })
  const avant = readFileSync(f, 'utf8')
  const mauvais = [{ brain: 'pas un id' }, { voiceInput: 'telepathie' }, { decisionBrain: 12 }, { autoWhitelist: ['a/b', 'a/b'] }]
  for (const patch of mauvais) {
    const r = ecrireReglages(f, patch)
    ok('refused: ' + JSON.stringify(patch), r.ok === false && typeof r.erreur === 'string', r)
  }
  ok('the file is byte for byte unchanged after the refusals', readFileSync(f, 'utf8') === avant)
}

console.log('\n── corrupt file: nothing overwritten, one copy kept ──')
{
  const f = nouveau()
  const tordu = '{ "pairingToken": "pt-secret-123", "gatewayBase": '
  ecrire(f, tordu)
  const lu = readRawSettings(f)
  ok('a truncated file is reported as corrupt', lu.corrupt === true && lu.text === tordu, lu)
  const r = ecrireReglages(f, { brain: 'a/b' })
  ok('the save is refused with a clear error', r.ok === false && /not a valid JSON object/.test(r.erreur) && /nothing was saved/.test(r.erreur), r)
  ok('the corrupt file is left exactly as it was', readFileSync(f, 'utf8') === tordu)
  const copies = fichiersAutour(f).filter((nom) => nom.startsWith('settings.json.corrupt-'))
  ok('one copy is kept next to it', copies.length === 1, fichiersAutour(f))
  ok('the copy holds the same text, so the token is recoverable', readFileSync(join(f, '..', copies[0]), 'utf8') === tordu)
  ok('the error names the copy', r.erreur.includes(copies[0]), r.erreur)
  ok('the copy is private (0600)', (statSync(join(f, '..', copies[0])).mode & 0o777) === 0o600)
  ecrireReglages(f, { brain: 'a/b' })
  ecrireReglages(f, { brain: 'a/c' })
  ok('repeating the save does not pile up copies', fichiersAutour(f).filter((nom) => nom.startsWith('settings.json.corrupt-')).length === 1, fichiersAutour(f))
  ok('the page can still read defaults from it', lireReglages(f).voiceInput === REGLAGES_DEFAUT.voiceInput)
  // The user fixes the file: saving works again, extras kept.
  ecrire(f, { ...SECRETS })
  ok('once repaired, a save works and keeps the secrets', ecrireReglages(f, { brain: 'a/b' }).ok === true && lire(f).pairingToken === SECRETS.pairingToken)
}
{
  const f = nouveau()
  for (const bizarre of ['[]', 'null', '"texte"', '42']) {
    ecrire(f, bizarre)
    const r = ecrireReglages(f, { brain: 'a/b' })
    ok('valid JSON that is not an object is refused: ' + bizarre, r.ok === false && readFileSync(f, 'utf8') === bizarre, r)
  }
}
{
  const f = nouveau()
  for (let i = 0; i < 8; i += 1) { ecrire(f, '{ tordu ' + i); ecrireReglages(f, { brain: 'a/b' }) }
  const copies = fichiersAutour(f).filter((nom) => nom.startsWith('settings.json.corrupt-'))
  ok('copies are capped (8 different corrupt files, at most 5 copies)', copies.length === 5, copies)
}

console.log('\n── unreadable file: refused, not treated as empty ──')
if (estRoot) console.log('  (skipped: running as root)')
else {
  const f = nouveau()
  ecrire(f, { ...SECRETS })
  chmodSync(f, 0o000)
  const lu = readRawSettings(f)
  const r = ecrireReglages(f, { brain: 'a/b' })
  chmodSync(f, 0o600)
  ok('an unreadable file is an error, not an empty object', typeof lu.error === 'string' && lu.raw === undefined, lu)
  ok('the save is refused and the secrets are still there', r.ok === false && lire(f).pairingToken === SECRETS.pairingToken, r)
}

console.log('\n── through the HTTP route (what the Settings page really calls) ──')
{
  const f = nouveau()
  ecrire(f, { ...SECRETS, renameAfterRecap: true })
  const routes = {}
  monterRoutes({ register: (r) => { routes[r.path] = r.handler } }, { reglagesPath: f, sessionsHome: join(racine, 'sessions'), kybersHome: join(racine, 'kybers') })
  const requete = (method, corps) => ({
    method, url: '/kybernos-sessions/settings', headers: { origin: 'http://127.0.0.1:3080' }, socket: { localPort: 3080 },
    on (ev, cb) { if (ev === 'data' && corps !== undefined) cb(JSON.stringify(corps)); if (ev === 'end') cb() }
  })
  const reponse = () => { const r = { code: null, corps: null, writeHead (c) { r.code = c }, end (s) { try { r.corps = JSON.parse(s) } catch (e) { r.corps = s } } }; return r }
  const post = reponse()
  await routes['/kybernos-sessions/settings'](requete('POST', { renameAfterRecap: false }), post)
  ok('POST answers 200 with the seven keys', post.code === 200 && post.corps.ok === true && Object.keys(post.corps.reglages).join() === SEPT.join(), post)
  ok('POST keeps the secrets on disk', lire(f).pairingToken === SECRETS.pairingToken && lire(f).gatewayBase === SECRETS.gatewayBase && lire(f).wsAdminKey === SECRETS.wsAdminKey, lire(f))
  ok('POST never sends a secret back to the page', !JSON.stringify(post.corps).includes('secret'), post.corps)
  const get = reponse()
  await routes['/kybernos-sessions/settings'](requete('GET'), get)
  ok('GET never sends a secret either', get.code === 200 && !JSON.stringify(get.corps).includes('secret'), get.corps)
  ecrire(f, '{ cassé')
  const mauvais = reponse()
  await routes['/kybernos-sessions/settings'](requete('POST', { brain: 'a/b' }), mauvais)
  ok('a corrupt file answers with an error, not a silent success', mauvais.code === 500 && mauvais.corps.ok === false && /nothing was saved/.test(mauvais.corps.erreur), mauvais)
  ok('and it is still untouched', readFileSync(f, 'utf8') === '{ cassé')
}

console.log('\n── the safe-write block is identical in kybernos-sessions and kybernos-auto ──')
{
  const bloc = (chemin) => { const m = readFileSync(new URL(chemin, import.meta.url), 'utf8').match(/\/\/ KB-SETTINGS-FILE-BEGIN[\s\S]*?\/\/ KB-SETTINGS-FILE-END/); return m === null ? null : m[0] }
  const duSessions = bloc('./index.js')
  const duAuto = bloc('../kybernos-auto/index.js')
  ok('both bundles carry the block', duSessions !== null && duAuto !== null)
  ok('the two copies are identical (bundles cannot import each other, so a test keeps them in step)', duSessions === duAuto)
}

rmSync(racine, { recursive: true, force: true })
console.log('\nSESSIONS SETTINGS — ' + (ok0 + ko) + ' assertions, ' + ko + ' failure(s)')
process.exit(ko === 0 ? 0 : 1)
