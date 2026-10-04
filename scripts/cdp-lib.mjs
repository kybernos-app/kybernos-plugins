// Pilote CDP robuste : joint une page 3080 existante (répondante), évalue avec
// timeout par commande, et sait recharger via location.reload() si le client est
// périmé. Exporte : findPage(), evalJs(), shot().
import { readFileSync } from 'node:fs'
import { createHash, createHmac } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'

const CDP = process.env.KB_CDP || 'http://127.0.0.1:9333'

const withTimeout = (p, ms, label) => Promise.race([
  p,
  new Promise((_, rej) => setTimeout(() => rej(new Error('timeout ' + label)), ms)),
])

export async function connect(targetInfo) {
  const ws = new WebSocket(targetInfo.webSocketDebuggerUrl)
  await withTimeout(new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }) }), 8000, 'ws-open')
  let seq = 0
  const pending = new Map()
  const errs = []
  const listeners = new Map() // protocol event name -> [fn(params)]
  ws.addEventListener('message', (ev) => {
    let m = null
    try { m = JSON.parse(ev.data) } catch (e) { return }
    if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
    if (m.method !== undefined && listeners.has(m.method)) for (const fn of listeners.get(m.method)) { try { fn(m.params || {}) } catch (e) { /* a listener must not stop the others */ } }
    if (m.method === 'Runtime.consoleAPICalled' && m.params && m.params.type === 'error') {
      const t = (m.params.args || []).map((a) => (a.value !== undefined ? String(a.value) : (a.description || ''))).join(' ')
      errs.push(t.slice(0, 240))
    }
  })
  const send = (method, params) => new Promise((res) => {
    const id = ++seq
    pending.set(id, res)
    try { ws.send(JSON.stringify({ id, method, params: params || {} })) } catch (e) { pending.delete(id); res({}) }
  })
  const evalJs = async (expression, timeoutMs) => {
    try {
      const r = await withTimeout(send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }), timeoutMs || 8000, 'evaluate')
      if (r.result && r.result.exceptionDetails) return { err: (r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description) || 'exception' }
      return { val: r.result && r.result.result ? r.result.result.value : undefined }
    } catch (e) { return { err: String(e.message || e) } }
  }
  const shot = async (path, timeoutMs) => {
    const r = await withTimeout(send('Page.captureScreenshot', { format: 'png' }), timeoutMs || 25000, 'screenshot')
    if (r.result && r.result.data) { const fs = await import('node:fs'); fs.writeFileSync(path, Buffer.from(r.result.data, 'base64')); return true }
    return false
  }
  /** Subscribe to a protocol event (e.g. 'Fetch.requestPaused'). */
  const on = (method, fn) => { if (!listeners.has(method)) listeners.set(method, []); listeners.get(method).push(fn) }
  return { info: targetInfo, send, evalJs, shot, errs, on, close: () => { try { ws.close() } catch (e) { /* fermé */ } } }
}

// Cherche parmi les pages 3080 celle qui répond ET dont le client est à jour.
export async function findPage({ needMarkers }) {
  // Le Chrome de debug éteint (ou injoignable) doit rendre `null` — « mesure
  // impossible » — et JAMAIS lever : un `fetch` non protégé sortait en exception
  // non rattrapée (`connect ECONNREFUSED 127.0.0.1:9333`, constaté le 23/09/2026
  // sur settings-nav-live et sessions-pilules), donc en ROUGE, et les sorties 3
  // « non concluant » déjà écrites par les appelants n'étaient jamais atteintes.
  let list = null
  try {
    const r = await fetch(CDP + '/json/list')
    list = await r.json()
  } catch (e) {
    return null
  }
  if (Array.isArray(list) === false) return null
  const pages = list.filter((t) => t.type === 'page' && t.url.startsWith('http://127.0.0.1:3080'))
  for (const t of pages) {
    let c = null
    try { c = await connect(t) } catch (e) { continue }
    const r = await c.evalJs('document.title', 4000)
    if (r.err !== undefined) { c.close(); continue }
    if (needMarkers === null || needMarkers === undefined) return c
    const m = await c.evalJs(needMarkers, 6000)
    if (m.val !== undefined && JSON.parse(m.val).fresh === true) return c
    c.close()
  }
  return null
}

export { CDP }

/** Sortie « non concluant » (code 3) : la mesure était impossible AVANT toute
 *  mesure — Chrome de debug muet, aucune page produit. Ce n'est ni un feu vert
 *  ni un échec du produit : `check-all.mjs` réserve le code 3 au ○, alors qu'un
 *  rouge à ce stade noie les vraies régressions dans le bruit des suites CDP.
 *  Règle : « non concluant » seulement si l'environnement manque AVANT la
 *  première mesure ; après, un échec mesuré reste un échec. */
export function nonConcluant (raison) {
  console.error('○ non concluant : ' + raison)
  process.exit(3)
}

// ── La session : le cookie persistant, pas le token ────────────────────────
// Le token de `~/.dsh/logs/dsh-web.url` vieillit MAL : dès que DSH est relancé
// à la main (il tourne alors dans un terminal et n'écrit plus `dsh-web.out.log`),
// le fichier garde l'ancien token et la GUI répond 401 — un contrôle échouait
// alors en « aucune page répondante », sans dire pourquoi. Le cookie, lui, est
// signé par le secret PERSISTANT : il survit aux redémarrages. Même mécanisme
// que `dsh-relance.mjs` (dérivé du secret, donc jamais du token).

const b64url = (b) => Buffer.from(b).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')

/** Cookie `dsh-auth-<hash(authority)>` signé HMAC-SHA256, valable 24 h.
 *  Rend `null` si le secret est illisible — jamais une exception : un contrôle
 *  doit pouvoir dire « mesure impossible » au lieu de tomber. */
export function cookieDeSession (autorite) {
  try {
    const brut = readFileSync(join(homedir(), '.dsh', '.credentials.yaml'), 'utf8')
    const at = brut.indexOf('client-connection/browser-session')
    if (at < 0) return null
    const m = brut.slice(at).match(/secret:\s*(\S+)/)
    if (m === null) return null
    const secret = Buffer.from(m[1].replaceAll('-', '+').replaceAll('_', '/'), 'base64')
    if (secret.byteLength !== 32) return null
    const nom = 'dsh-auth-' + b64url(createHash('sha256').update(autorite).digest())
    const now = Date.now()
    const corps = b64url(Buffer.from(JSON.stringify({ version: 1, authority: autorite, issuedAt: now, expiresAt: now + 86400000 }), 'utf8'))
    return { nom, valeur: 'v1.' + corps + '.' + b64url(createHmac('sha256', secret).update(corps).digest()) }
  } catch (e) { return null }
}

/** Pose le cookie sur une page CDP ouverte (avant navigation ou rechargement).
 *  Rend `true` si le navigateur l'a accepté. */
export async function poserCookie (page, autorite) {
  const session = cookieDeSession(autorite)
  if (session === null) return false
  await page.send('Network.enable', {})
  const r = await page.send('Network.setCookie', { name: session.nom, value: session.valeur, domain: '127.0.0.1', path: '/' })
  return r !== null && r !== undefined && r.result !== undefined && r.result.success === true
}
