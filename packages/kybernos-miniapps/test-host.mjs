// ═══════════════════════════════════════════════════════════════════════════
// Tests de kybernos-miniapps — moitié HÔTE (cas hostiles M-03/M-04).
//
//   node kybernos-miniapps/test-host.mjs
//
// M-03 : install/uninstall sont des POST qui écrivent et lancent une app
// native — origine EXACTE + Content-Type JSON requis, nom d'app confiné.
// ═══════════════════════════════════════════════════════════════════════════

import { apply } from './index.js'

let echecs = 0
const ok = (label, cond, detail) => {
  if (cond) console.log(`✓ ${label}${detail === undefined ? '' : ` (${detail})`}`)
  else { console.error(`✗ ${label}${detail === undefined ? '' : ` — ${detail}`}`); echecs += 1 }
}

// Monte les routes via un ctx factice
const routes = {}
const ctx = {
  get: (nom) => (nom === 'webServer' ? { register: (r) => { routes[r.path] = r.handler } } : undefined),
  effect: (fn) => fn(),
  inject: (_noms, fn) => fn(),
}
apply(ctx)

ok('routes install/uninstall/list montées', routes['/kybernos-miniapps/install'] && routes['/kybernos-miniapps/uninstall'] && routes['/kybernos-miniapps/list'])

// Requête factice
const requete = (extra, corps) => {
  const body = JSON.stringify(corps ?? {})
  return {
    method: 'POST',
    headers: Object.assign({ 'content-type': 'application/json' }, extra.headers || {}),
    socket: { localPort: 3080 },
    on: (ev, fn) => {
      if (ev === 'data') fn(body)
      if (ev === 'end') setTimeout(() => fn(), 0)
    },
  }
}
const reponse = () => {
  const r = { code: null, corps: '' }
  r.setHeader = () => {}
  r.writeHead = (c) => { r.code = c }
  r.end = (b) => { r.corps = String(b) }
  return r
}
const jouer = async (handler, req) => { const res = reponse(); await handler(req, res); return res }

// ── M-03 : origine hostile refusée ──────────────────────────────────────────
{
  const res = await jouer(routes['/kybernos-miniapps/install'], requete({ headers: { origin: 'http://evil.example' } }, { id: 'test', html: '<html><body>ok</body></html>' }))
  ok('M-03 : install depuis origin hostile → 403', res.code === 403, `code=${res.code}`)
}
{
  const res = await jouer(routes['/kybernos-miniapps/uninstall'], requete({ headers: { origin: 'http://localhost.evil.example:3080' } }, { id: 'test' }))
  ok('M-03 : uninstall depuis origin préfixe piégeux → 403', res.code === 403, `code=${res.code}`)
}
// ── M-03 : Content-Type non-JSON refusé (forme simple cross-site) ──────────
{
  const res = await jouer(routes['/kybernos-miniapps/install'], requete({ headers: { 'content-type': 'text/plain' } }, { id: 'test', html: '<html><body>ok</body></html>' }))
  ok('M-03 : install en text/plain → 415', res.code === 415, `code=${res.code}`)
}
// ── M-03 : origine locale acceptée (comportement légitime) ─────────────────
// NB : on ne lance PAS l'install pour de vrai — macOS seulement et effets de
// bord réels ; on vérifie juste qu'elle passe les gardes (code ≠ 403/415).
if (process.platform === 'darwin') {
  const res = await jouer(routes['/kybernos-miniapps/install'], requete({ headers: { origin: 'http://127.0.0.1:3080' } }, { id: 'garde-test', html: '<html><body>ok</body></html>' }))
  const j = (() => { try { return JSON.parse(res.corps) } catch { return {} } })()
  // l'install peut réussir OU échouer (codesign), mais pas sur un refus de garde
  ok('M-03 : install origine locale passe les gardes (pas 403/415)', res.code !== 403 && res.code !== 415, JSON.stringify(j).slice(0, 60))
  await jouer(routes['/kybernos-miniapps/uninstall'], requete({}, { id: 'garde-test' }))
} else {
  console.log('ℹ macOS requis pour l’install réelle — gardes 403/415 testées ci-dessus')
}

console.log(echecs === 0 ? '\nHost : tout est vert.' : `\n✗ ${echecs} échec(s)`)
process.exit(echecs === 0 ? 0 : 1)
