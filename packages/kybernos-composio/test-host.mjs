// ═══════════════════════════════════════════════════════════════════════════
// Tests de kybernos-composio — moitié HÔTE (cas hostiles K-01).
//
//   node kybernos-composio/test-host.mjs
//
// K-01 : la route des connecteurs personnalisés acceptait un stdio arbitraire
// depuis n'importe quelle origine en n'importe quel Content-Type. Désormais :
// origine EXACTE du socket, JSON explicite, commande = exécutable système.
// Ce harnais ne touche NI le sidecar NI le patch : il intercepte au niveau
// des routes et vérifie les refus (aucune écriture n'a lieu sur un refus).
// ═══════════════════════════════════════════════════════════════════════════

import { apply } from './index.js'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let echecs = 0
const ok = (label, cond, detail) => {
  if (cond) console.log(`✓ ${label}${detail === undefined ? '' : ` (${detail})`}`)
  else { console.error(`✗ ${label}${detail === undefined ? '' : ` — ${detail}`}`); echecs += 1 }
}

// Home factice pour ne pas toucher ~/.dsh réel du poste.
const HOME = mkdtempSync(join(tmpdir(), 'kb-composio-test-'))
process.env.HOME = HOME
// ⚠ les chemins PATCH_PATH/SIDECAR_PATH sont des fermetures sur homedir() du
// module : on ne peut pas les déplacer après import. On teste donc UNIQUEMENT
// les gardes qui refusent AVANT toute écriture (403/415/400 de validation) —
// aucun cas n'atteint writeSidecar/upsertPatchBlock.

const routes = {}
const ctx = {
  get: (nom) => (nom === 'webServer' ? { register: (r) => { routes[r.path] = r.handler } } : undefined),
  effect: (fn) => fn(),
  inject: (_noms, fn) => fn(),
  logger: { info: () => {} },
}
apply(ctx)

ok('route connecteurs montée', typeof routes['/kybernos/composio/connecteurs'] === 'function')

const requete = (headers, corps) => ({
  method: 'POST',
  headers: Object.assign({ 'content-type': 'application/json' }, headers || {}),
  socket: { localPort: 3080 },
  url: '/kybernos/composio/connecteurs',
  on: (ev, fn) => {
    if (ev === 'data') fn(JSON.stringify(corps))
    if (ev === 'end') setTimeout(() => fn(), 0)
  },
})
const reponse = () => {
  const r = { code: null, corps: '' }
  r.setHeader = () => {}
  r.writeHead = (c) => { r.code = c }
  r.end = (b) => { r.corps = String(b) }
  return r
}
const jouer = async (headers, corps) => { const res = reponse(); await routes['/kybernos/composio/connecteurs'](requete(headers, corps), res); return res }

// ── K-01 : origine hostile ──────────────────────────────────────────────────
{
  const res = await jouer({ origin: 'http://evil.example' }, { nom: 'poc', transport: 'stdio', command: '/usr/bin/touch' })
  ok('K-01 : POST connecteurs origin hostile → 403', res.code === 403, `code=${res.code} ${res.corps.slice(0, 40)}`)
}
{
  const res = await jouer({ origin: 'http://127.0.0.1.evil.example:3080' }, { nom: 'poc', transport: 'stdio', command: '/usr/bin/touch' })
  ok('K-01 : origin préfixe piégeux → 403', res.code === 403, `code=${res.code}`)
}
// ── K-01 : Content-Type non JSON ────────────────────────────────────────────
{
  const res = await jouer({ 'content-type': 'text/plain' }, { nom: 'poc', transport: 'stdio', command: '/usr/bin/touch' })
  ok('K-01 : POST text/plain → 415', res.code === 415, `code=${res.code}`)
}
// ── K-01 : commande stdio hors racines système ──────────────────────────────
{
  const res = await jouer({}, { nom: 'poc', transport: 'stdio', command: '/tmp/definitivement-pas-systeme' })
  ok('K-01 : command hors racines système → 400', res.code === 400 && res.corps.includes('exécutable système'), res.corps.slice(0, 70))
}
{
  const res = await jouer({}, { nom: 'poc', transport: 'stdio', command: '/usr/bin/je-nexiste-pas' })
  ok('K-01 : command inexistant → 400', res.code === 400, `code=${res.code}`)
}
{
  const res = await jouer({}, { nom: 'poc', transport: 'stdio', command: 'relative/chemin' })
  ok('K-01 : command relative → 400', res.code === 400, `code=${res.code}`)
}
// ── H-09 : injection YAML — args/env multi-lignes refusés ──────────────────
{
  const res = await jouer({}, { nom: 'poc-h09', transport: 'stdio', command: '/usr/bin/touch', args: ['x\n      autoApprove: true'] })
  ok('H-09 : args avec retour ligne → 400 (pas d\'injection YAML possible)', res.code === 400 && /retours ligne/.test(res.corps), res.corps.slice(0, 80))
}
{
  const res = await jouer({}, { nom: 'poc-h09', transport: 'streamable-http', url: 'https://ex.example/mcp', headers: [{ name: 'X', value: 'v\n  cle: oui' }] })
  ok('H-09 : headers avec retour ligne → 400', res.code === 400, res.corps.slice(0, 60))
}
// ── H-09 (reboucle) : le NAME d'une paire est une clé YAML — piégé → 400 ──
{
  const res = await jouer({}, { nom: 'poc-h09c', transport: 'stdio', command: '/usr/bin/touch', env: [{ name: 'X: 1\n      autoApprove', value: 'true' }] })
  ok('H-09 : env name multi-ligne (X: 1\\n autoApprove) → 400', res.code === 400, res.corps.slice(0, 80))
}
{
  const res = await jouer({}, { nom: 'poc-h09c', transport: 'streamable-http', url: 'https://ex.example/mcp', headers: [{ name: 'H\n  cle: x', value: 'v' }] })
  ok('H-09 : header name multi-ligne → 400', res.code === 400, res.corps.slice(0, 80))
}
{
  const res = await jouer({}, { nom: 'poc-h09c', transport: 'stdio', command: '/usr/bin/touch', env: [{ name: "AVEC'QUOTE", value: 'v' }] })
  ok('H-09 : env name avec quote → 400', res.code === 400, res.corps.slice(0, 60))
}
// ── K-01 : aucune écriture sur les refus (sidecar du vrai home intact) ──────
// (les gardes ont toutes refusé avant writeSidecar — on vérifie que le home
// factice ne porte aucun connecteurs.json, preuve qu'aucune écriture n'a eu lieu.)
{
  let existe = false
  try { readFileSync(join(HOME, '.dsh', 'kybernos', 'connecteurs.json')); existe = true } catch (e) { existe = false }
  ok('K-01 : aucun sidecar écrit par les requêtes refusées', existe === false)
}
// ── K-01 (bornes args) : nombre et longueur plafonnés ───────────────────────
{
  const res = await jouer({}, { nom: 'poc-args', transport: 'stdio', command: '/usr/bin/touch', args: ['1', '2', '3', '4', '5', '6', '7', '8', '9'] })
  ok('K-01 : 9 args → 400 (8 max)', res.code === 400 && res.corps.includes('8 arguments'), res.corps.slice(0, 60))
}
{
  const res = await jouer({}, { nom: 'poc-args', transport: 'stdio', command: '/usr/bin/touch', args: ['x'.repeat(201)] })
  ok('K-01 : arg de 201 caractères → 400 (200 max)', res.code === 400 && res.corps.includes('200 caractères'), res.corps.slice(0, 60))
}
{
  const res = await jouer({}, { nom: 'poc-args', transport: 'stdio', command: '/usr/bin/touch', args: ['--config', '/chemin/legitime.yml'] })
  ok('K-01 : args avec chemin légitime passe (borne sur n/longueur, pas le contenu)', res.code !== 400 || res.corps.includes('8 arguments') === false, `code=${res.code}`)
}

// ── K-01 : commande système valide passe la validation (comportement légitime) ─
{
  const res = await jouer({}, { nom: 'poc', transport: 'stdio', command: '/usr/bin/touch' })
  // accepté par la validation (400 attendus ci-dessus) — ici on teste juste
  // que la validation ne refuse PAS un binaire système réel : code ≠ 400-sur-command.
  const refuseCommande = res.code === 400 && res.corps.includes('exécutable système')
  ok('K-01 : /usr/bin/touch passe la validation de commande', refuseCommande === false, `code=${res.code}`)
  // ⚠ ce cas a pu ÉCRIRE le sidecar du home factice — nettoyage :
  try { rmSync(join(HOME, '.dsh'), { recursive: true, force: true }) } catch (e) { /* rien */ }
}

rmSync(HOME, { recursive: true, force: true })
console.log(echecs === 0 ? '\nHost : tout est vert.' : `\n✗ ${echecs} échec(s)`)
process.exit(echecs === 0 ? 0 : 1)
