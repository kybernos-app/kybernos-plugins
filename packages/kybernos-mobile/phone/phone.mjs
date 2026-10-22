// kybernos-mobile: the phone page. Served by the relay's web origin; nothing here is private (this file is part of the
// open repository, so what the page does can be read and checked).
//
//   · reads the pairing secrets from the URL fragment (never sent to a server) and removes them from the address bar,
//   · opens ONE WebSocket to the relay and runs the end-to-end handshake with the computer (remote-e2e.mjs),
//   · shows the 4-digit check, waits for the person to approve on the computer, keeps its identity in IndexedDB
//     (a non-extractable key: it cannot be exported even from this page),
//   · then runs the computer's own DSH page in an iframe: the service worker (sw.js) sends every request of that page
//     here, this file encrypts it for the computer, and a WebSocket shim does the same for DSH's streaming socket,
//   · offers to put the page on the home screen as one of two apps (the remote at /__kb/, Kaby at /__kb/kaby/: two pages,
//     two manifests, one service worker); on an iPhone an app keeps its own storage, so it is linked by pasting the link.
import * as e2e from '/__kb/remote-e2e.mjs'

const lang = String(navigator.language || 'en').toLowerCase().startsWith('fr') ? 'fr' : 'en'
const STR = {
  fr: {
    scanTitle: 'Scanne le code de ton ordinateur', scanSub: 'Ouvre le menu du compte › Téléphone et canaux sur ton ordinateur et vise le code avec l\'appareil photo.',
    connecting: 'Connexion à ton poste', verifyTitle: 'Autorise ce téléphone', verifySub: 'Sur ton ordinateur, vérifie que ce code est le même, puis touche Autoriser.',
    saslabel: 'Ce code doit être le même sur l\'ordinateur', waiting: 'Attente de ton accord sur l\'ordinateur…',
    offlineTitle: 'Ton ordinateur est hors ligne', offlineSub: 'Allume-le et ouvre Kybernos : la connexion reprend toute seule.',
    reconnecting: 'Reconnexion…', revokedTitle: 'Ce téléphone n\'est plus autorisé', revokedSub: 'Il a été retiré depuis l\'ordinateur. Scanne un nouveau code pour le rappairer.',
    deniedTitle: 'Accès refusé', deniedSub: 'L\'ordinateur n\'a pas autorisé ce téléphone.', expiredTitle: 'Code expiré', expiredSub: 'Génère un nouveau code sur l\'ordinateur et scanne-le.',
    errorTitle: 'Connexion impossible', unsupported: 'Ce navigateur ne gère pas les fonctions nécessaires (service worker, WebCrypto).',
    retry: 'Réessayer', lock: 'Chiffré de bout en bout. Kybernos transporte tes messages sans pouvoir les lire.',
    peerDown: 'Ordinateur hors ligne, reconnexion…', relayDown: 'Connexion perdue, reconnexion…',
    installTitle: 'Mets Kybernos sur ton écran d\'accueil', doneTitle: 'Ton téléphone est relié', installSub: 'Il s\'ouvre alors en un geste, sans barre d\'adresse.',
    iosTitle: 'Installe l\'app, puis relie-la', iosSub: 'Sur iPhone, une app de l\'écran d\'accueil garde ses propres données : elle se relie à ton ordinateur une seule fois.',
    remoteName: 'Kybernos à distance', remoteDesc: 'Tout ton ordinateur, comme à son écran.', kabyName: 'Kaby', kabyDesc: 'S\'ouvre directement sur ta conversation avec Kaby.',
    install: 'Installer', howTo: 'Comment faire', installed: 'Installée', later: 'Plus tard', next: 'Continuer', pairHere: 'Relier ici, sans installer',
    copyLink: 'Copier le lien de liaison', copied: 'Lien copié. Il vaut 5 minutes.',
    step1: 'Touche Partager, en bas de Safari.', step2: 'Touche « Sur l\'écran d\'accueil », puis « Ajouter ».', step3: 'Ouvre l\'icône, puis touche « Coller le lien » : l\'app se relie à ton ordinateur.',
    stepsPaired: 'Cette icône se relie à part : copie un nouveau lien sur ton ordinateur (Téléphone et canaux › Ajouter un téléphone).',
    chromeSteps: 'Ouvre le menu ⋮ de Chrome, puis « Installer l\'application ».',
    paste: 'Coller le lien', pasteSub: 'Sur ton ordinateur : menu du compte › Téléphone et canaux › Copier le lien. Colle-le ici.', pasteHere: 'Colle le lien ici', pasteBad: 'Ce n\'est pas un lien de liaison de Kybernos.',
    revokedPasteSub: 'Il a été retiré depuis l\'ordinateur. Pour le relier à nouveau, copie le lien sur l\'ordinateur et colle-le ici.',
    kabyOfflineTitle: 'Kaby est sur ton ordinateur', kabyOfflineSub: 'Il est éteint, ou Kybernos n\'est pas ouvert. Allume-le : la connexion reprend toute seule.',
    refusedPhone: 'Cette action n\'est pas possible depuis le téléphone — fais-la sur l\'ordinateur.',
  },
  en: {
    scanTitle: 'Scan the code on your computer', scanSub: 'Open the account menu › Phone and channels on your computer and aim the camera at the code.',
    connecting: 'Connecting to your computer', verifyTitle: 'Allow this phone', verifySub: 'On your computer, check that this code is the same, then click Allow.',
    saslabel: 'This code must be the same on the computer', waiting: 'Waiting for your approval on the computer…',
    offlineTitle: 'Your computer is offline', offlineSub: 'Turn it on and open Kybernos: the connection resumes by itself.',
    reconnecting: 'Reconnecting…', revokedTitle: 'This phone is no longer allowed', revokedSub: 'It was removed from the computer. Scan a new code to pair it again.',
    deniedTitle: 'Access refused', deniedSub: 'The computer did not allow this phone.', expiredTitle: 'Code expired', expiredSub: 'Make a new code on the computer and scan it.',
    errorTitle: 'Cannot connect', unsupported: 'This browser lacks what is needed (service worker, WebCrypto).',
    retry: 'Try again', lock: 'End-to-end encrypted. Kybernos carries your messages and cannot read them.',
    peerDown: 'Computer offline, reconnecting…', relayDown: 'Connection lost, reconnecting…',
    installTitle: 'Put Kybernos on your home screen', doneTitle: 'Your phone is linked', installSub: 'It then opens in one tap, with no address bar.',
    iosTitle: 'Install the app, then link it', iosSub: 'On an iPhone, a home-screen app keeps its own data: it links to your computer once.',
    remoteName: 'Kybernos Remote', remoteDesc: 'Your whole computer, as on its own screen.', kabyName: 'Kaby', kabyDesc: 'Opens straight on your conversation with Kaby.',
    install: 'Install', howTo: 'How to', installed: 'Installed', later: 'Later', next: 'Continue', pairHere: 'Link here, without installing',
    copyLink: 'Copy the pairing link', copied: 'Link copied. It lasts 5 minutes.',
    step1: 'Tap Share, at the bottom of Safari.', step2: 'Tap “Add to Home Screen”, then “Add”.', step3: 'Open the icon, then tap “Paste the link”: the app links to your computer.',
    stepsPaired: 'This icon links on its own: copy a new link on your computer (Phone and channels › Add a phone).',
    chromeSteps: 'Open Chrome\'s ⋮ menu, then “Install app”.',
    paste: 'Paste the link', pasteSub: 'On your computer: account menu › Phone and channels › Copy the link. Paste it here.', pasteHere: 'Paste the link here', pasteBad: 'That is not a Kybernos pairing link.',
    revokedPasteSub: 'It was removed from the computer. To link it again, copy the link on the computer and paste it here.',
    kabyOfflineTitle: 'Kaby is on your computer', kabyOfflineSub: 'It is off, or Kybernos is not open. Turn it on: the connection resumes by itself.',
    refusedPhone: 'This cannot be done from the phone — do it on the computer.',
  },
}[lang]

const $ = (id) => document.getElementById(id)
const kb = (window.__kb = { state: 'start', req: 0, bytes: 0, wsOpen: 0, wsMsgs: 0, sas: null, refusals: 0, log: [] })
const log = (s) => { kb.log.push(String(s).slice(0, 160)); if (kb.log.length > 40) kb.log.shift() }
const te = new TextEncoder()
const td = new TextDecoder()

// ── which app this page is, and where it runs ───────────────────────────────────────────────────────────────────────
const app = document.body.dataset.app === 'kaby' ? 'kaby' : 'remote'
if (app === 'kaby') { STR.offlineTitle = STR.kabyOfflineTitle; STR.offlineSub = STR.kabyOfflineSub }
const ios = /iPhone|iPad|iPod/u.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const standalone = (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true
const touch = (navigator.maxTouchPoints || 0) > 0
const APPS = { remote: { path: '/__kb/', icon: '/__kb/icon-192.png' }, kaby: { path: '/__kb/kaby/', icon: '/__kb/kaby-192.png' } }

// ── screen ───────────────────────────────────────────────────────────────────────────────────────────────────────
function show (state, { title, sub, sas, actions } = {}) {
  kb.state = state
  document.body.dataset.state = state
  const running = state === 'running'
  if (!running) hideRefusal() // a line about the DSH page means nothing on the connection screens
  $('gate').hidden = running
  $('app').hidden = !running
  $('title').textContent = title || ''
  $('sub').textContent = sub || ''
  $('sas').hidden = !sas
  $('apps').hidden = true
  $('steps').hidden = true
  $('pasteBox').hidden = true
  if (sas) { $('saslabel').textContent = STR.saslabel; $('sasnum').textContent = sas }
  $('locktext').textContent = STR.lock
  const box = $('actions')
  box.textContent = ''
  for (const a of actions || []) {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = a.label
    if (a.primary) b.className = 'primary'
    b.addEventListener('click', a.run)
    box.appendChild(b)
  }
}
const veil = (text) => { const v = $('veil'); v.hidden = !text; v.textContent = text || '' }

// A request the computer refuses for a phone (settings, credentials, plugins, the server, phones: `refusedOnPhone` in remote-host.mjs)
// is answered 403 `refused_on_phone`. The computer's own screen counts and explains those refusals; the phone used to count them in
// silence, so a tap on a forbidden surface did nothing the person could see. Now one line says it, apart from the veil (which is
// about the connection). It goes away on a tap, or by itself.
const REFUSAL_SHOWN_MS = 8000
let refusalTimer = null
function hideRefusal () {
  clearTimeout(refusalTimer)
  refusalTimer = null
  const box = $('refusal')
  if (box) { box.hidden = true; box.textContent = '' }
}
function showRefusal () {
  kb.refusals += 1
  const box = $('refusal')
  if (!box) return
  box.textContent = STR.refusedPhone
  box.hidden = false
  clearTimeout(refusalTimer)
  refusalTimer = setTimeout(hideRefusal, REFUSAL_SHOWN_MS)
}
if ($('refusal')) $('refusal').addEventListener('click', hideRefusal)
const isRefusedBody = (body) => {
  try { const j = JSON.parse(td.decode(body)); return j !== null && typeof j === 'object' && j.error === 'refused_on_phone' } catch (e) { return false }
}
const fail = (state, title, sub) => show(state, { title, sub, actions: [{ label: STR.retry, primary: true, run: () => location.reload() }] })

// ── a tiny IndexedDB key/value store for the paired identity ─────────────────────────────────────────────────────
const idb = () => new Promise((resolve, reject) => {
  const r = indexedDB.open('kb-mobile-remote', 1)
  r.onupgradeneeded = () => r.result.createObjectStore('kv')
  r.onsuccess = () => resolve(r.result)
  r.onerror = () => reject(r.error)
})
const idbGet = async (k) => { const db = await idb(); return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error) }) }
const idbSet = async (k, v) => { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error) }) }
const idbDel = async (k) => { const db = await idb(); return new Promise((res) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').delete(k); tx.oncomplete = () => res(); tx.onerror = () => res() }) }

// ── the relay connection ─────────────────────────────────────────────────────────────────────────────────────────
function openRelay (sid, handlers) {
  const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws')
  ws.binaryType = 'arraybuffer'
  ws.onopen = () => ws.send(JSON.stringify({ t: 'auth', role: 'phone', sid }))
  ws.onmessage = (ev) => {
    if (typeof ev.data === 'string') { try { handlers.control(JSON.parse(ev.data)) } catch (e) { /* not ours */ } return }
    handlers.data(new Uint8Array(ev.data))
  }
  ws.onclose = () => handlers.close()
  ws.onerror = () => {}
  return ws
}
const waitFor = (box, ms) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('timeout')), ms)
  box.resolve = (v) => { clearTimeout(t); resolve(v) }
  box.reject = (err) => { clearTimeout(t); reject(err) }
})

function deviceLabel () {
  const ua = navigator.userAgent || ''
  const os = /iPhone/u.test(ua) ? 'iPhone' : /iPad/u.test(ua) ? 'iPad' : /Android/u.test(ua) ? 'Android' : /Mac/u.test(ua) ? 'Mac' : /Windows/u.test(ua) ? 'Windows' : 'Phone'
  const br = /EdgA?\//u.test(ua) ? 'Edge' : /CriOS|Chrome\//u.test(ua) ? 'Chrome' : /FxiOS|Firefox\//u.test(ua) ? 'Firefox' : /Safari\//u.test(ua) ? 'Safari' : ''
  const where = standalone ? (app === 'kaby' ? 'Kaby' : 'app') : br
  return where === '' ? os : os + ' · ' + where
}

// ── the tunnel: requests of the DSH page, through the service worker and the shim ───────────────────────────────
const session = { channel: null, ws: null, ports: new Map(), headed: new Set(), sockets: new Set(), refusable: new Set(), seq: 0, saved: null, frameReady: false }

async function sendEnc (header, body) {
  if (session.channel === null || session.ws === null || session.ws.readyState !== 1) return false
  session.ws.send(await session.channel.seal(e2e.packFrame(header, body)))
  return true
}

function onServiceWorkerMessage (ev) {
  const d = ev.data
  if (d === null || typeof d !== 'object' || d.t !== 'req' || !ev.ports[0]) return
  kb.req += 1
  const id = 'r' + (++session.seq)
  session.ports.set(id, ev.ports[0])
  ev.ports[0].onmessage = (m) => { if (m.data && m.data.t === 'cancel') { void sendEnc({ t: 'cancel', id }); session.ports.delete(id) } }
  const body = d.body instanceof ArrayBuffer ? new Uint8Array(d.body) : new Uint8Array(0)
  void sendEnc({ t: 'req', id, method: d.method, path: d.path, headers: d.headers }, body).then((sent) => {
    if (!sent) { ev.ports[0].postMessage({ t: 'res', status: 503, headers: { 'content-type': 'text/plain' } }); ev.ports[0].postMessage({ t: 'end' }); session.ports.delete(id) }
  })
}

function onFrameFromComputer (header, body) {
  switch (header.t) {
    case 'res': { const p = session.ports.get(header.id); if (p) { session.headed.add(header.id); if (header.status === 403) session.refusable.add(header.id); p.postMessage({ t: 'res', status: header.status, headers: header.headers || {}, enc: header.enc || null }) } return }
    case 'chunk': {
      const p = session.ports.get(header.id)
      if (!p) return
      // The refusal arrives as an ordinary 403 answer: its small JSON body is what says it was the phone's rule.
      if (session.refusable.delete(header.id) && isRefusedBody(body)) showRefusal()
      kb.bytes += body.length
      const copy = body.slice().buffer
      p.postMessage({ t: 'chunk', buf: copy }, [copy])
      return
    }
    case 'end': { session.refusable.delete(header.id); const p = session.ports.get(header.id); if (p) { p.postMessage({ t: 'end' }); session.ports.delete(header.id); session.headed.delete(header.id) } return }
    case 'ws-open': kb.wsOpen += 1; toFrame({ kbws: 'open', id: header.id, protocol: header.protocol || '' }); return
    case 'ws-msg': {
      kb.wsMsgs += 1
      if (header.text === true) toFrame({ kbws: 'msg', id: header.id, text: td.decode(body) })
      else { const copy = body.slice().buffer; toFrame({ kbws: 'msg', id: header.id, bin: copy }, [copy]) }
      return
    }
    case 'ws-close': session.sockets.delete(header.id); toFrame({ kbws: 'close', id: header.id, code: header.code || 1006 }); return
    case 'refused': showRefusal(); return
    case 'bye': if (header.reason === 'revoked') void revoked(); return
    default: log('unknown frame ' + String(header.t).slice(0, 20))
  }
}
const toFrame = (msg, transfer) => { const w = $('app').contentWindow; if (w) w.postMessage(msg, location.origin, transfer || []) }

window.addEventListener('message', (ev) => {
  if (ev.origin !== location.origin || ev.source !== $('app').contentWindow) return
  const d = ev.data
  if (d === null || typeof d !== 'object' || typeof d.kbws !== 'string') return
  if (d.kbws === 'open') { session.sockets.add(d.id); void sendEnc({ t: 'ws-open', id: d.id, path: d.path, protocols: d.protocols }) }
  else if (d.kbws === 'msg') void sendEnc({ t: 'ws-msg', id: d.id, text: typeof d.text === 'string' }, typeof d.text === 'string' ? te.encode(d.text) : new Uint8Array(d.bin))
  else if (d.kbws === 'close') { session.sockets.delete(d.id); void sendEnc({ t: 'ws-close', id: d.id, code: d.code }) }
})

async function revoked () {
  await idbDel('phone')
  session.channel = null
  try { session.ws && session.ws.close() } catch (e) { /* closed */ }
  veil('')
  show('revoked', { title: STR.revokedTitle, sub: ios || standalone ? STR.revokedPasteSub : STR.revokedSub, actions: pasteActions() })
}


// ── installing the page as an app ────────────────────────────────────────────────────────────────────────────────
let deferredInstall = null
const installedNow = new Set()
let installCtx = null
let stepsShown = false
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e })
window.addEventListener('appinstalled', () => { deferredInstall = null; installedNow.add(app); if (kb.state === 'install') drawInstall() })
const LATER_KEY = 'kb-install-later'
const laterRecently = () => { try { const t = Number(localStorage.getItem(LATER_KEY)); return t > 0 && Date.now() - t < 7 * 24 * 3600 * 1000 } catch (e) { return false } }
const setLater = () => { try { localStorage.setItem(LATER_KEY, String(Date.now())) } catch (e) { /* private mode */ } }

/** After a pairing: offer the install once, on a phone that is not already running the app. Resolves when the person goes on. */
function offerInstall () {
  if (standalone || !touch || laterRecently()) return Promise.resolve()
  return new Promise((resolve) => { renderInstall({ link: null, done: resolve, paired: true }) })
}

function renderInstall (ctx) { installCtx = ctx; stepsShown = false; drawInstall() }

function appCard (name) {
  const card = document.createElement('div')
  card.className = 'app'
  const img = document.createElement('img')
  img.src = APPS[name].icon
  img.alt = ''
  const text = document.createElement('div')
  const title = document.createElement('b')
  title.textContent = STR[name + 'Name']
  const desc = document.createElement('span')
  desc.textContent = STR[name + 'Desc']
  text.append(title, desc)
  card.append(img, text)
  if (installedNow.has(name)) {
    const done = document.createElement('span')
    done.className = 'done'
    done.textContent = STR.installed
    card.appendChild(done)
    return card
  }
  const b = document.createElement('button')
  b.type = 'button'
  b.className = ios ? '' : 'primary'
  b.textContent = ios ? STR.howTo : STR.install
  // The other app is another page (its own manifest): go there, it offers its own install.
  b.addEventListener('click', () => { if (name !== app) location.assign(APPS[name].path + '?install=1'); else if (ios) showSteps(); else void installHere() })
  card.appendChild(b)
  return card
}

function drawInstall () {
  const ctx = installCtx
  const first = ctx.link !== null || ios
  const actions = []
  if (ctx.link !== null) actions.push({ label: STR.copyLink, primary: true, run: () => { void copyLink(ctx.link) } }, { label: STR.pairHere, run: ctx.done })
  else actions.push({ label: installedNow.size > 0 ? STR.next : STR.later, primary: installedNow.size > 0, run: () => { if (installedNow.size === 0) setLater(); ctx.done() } })
  show('install', { title: first ? STR.iosTitle : (ctx.paired === true ? STR.doneTitle : STR.installTitle), sub: first ? STR.iosSub : STR.installSub, actions })
  const apps = $('apps')
  apps.textContent = ''
  apps.append(appCard('remote'), appCard('kaby'))
  apps.hidden = false
  if (stepsShown) fillSteps()
}

function fillSteps () {
  const steps = $('steps')
  steps.textContent = ''
  const lines = ios ? [STR.step1, STR.step2, STR.step3].concat(installCtx.link === null && installCtx.paired === true ? [STR.stepsPaired] : []) : [STR.chromeSteps]
  for (const t of lines) { const li = document.createElement('li'); li.textContent = t; steps.appendChild(li) }
  steps.hidden = false
}
function showSteps () { stepsShown = true; fillSteps() }

async function installHere () {
  if (deferredInstall === null) { showSteps(); return }
  const ev = deferredInstall
  deferredInstall = null
  try {
    await ev.prompt()
    const choice = await ev.userChoice
    if (choice && choice.outcome === 'accepted') installedNow.add(app)
  } catch (e) { log('install: ' + String(e.message || e)) }
  drawInstall()
}

async function copyLink (link) {
  try { await navigator.clipboard.writeText(link); veil(STR.copied); setTimeout(() => veil(''), 3500) } catch (e) {
    // The clipboard is refused: show the link, selected, so that it can be copied by hand.
    const box = $('pasteBox'); box.hidden = false; box.value = link; box.readOnly = true; box.focus(); box.select()
  }
}

// ── linking from inside an installed app: the camera opens the browser, not the app, so the link is pasted ────────
const pasteActions = () => (ios || standalone ? [{ label: STR.paste, primary: true, run: () => { void pasteFlow() } }] : [])
function tryLink (text) {
  let frag = null
  try { frag = e2e.parsePairingFragment(new URL(String(text).trim()).hash) } catch (e) { frag = null }
  if (frag === null) return false
  veil('')
  void pair(frag, { offer: false })
  return true
}
async function pasteFlow () {
  let text = ''
  try { text = (await navigator.clipboard.readText()).trim() } catch (e) { text = '' }
  if (text !== '' && tryLink(text)) return
  if (text !== '') veil(STR.pasteBad)
  const box = $('pasteBox')
  box.readOnly = false
  box.value = ''
  box.placeholder = STR.pasteHere
  box.hidden = false
  box.focus()
}
$('pasteBox').addEventListener('input', (ev) => {
  const v = ev.target.value.trim()
  if (ev.target.readOnly || v === '') { veil(''); return }
  if (!tryLink(v)) veil(STR.pasteBad)
})

// ── handshake drivers ────────────────────────────────────────────────────────────────────────────────────────────
/** A message box that keeps what arrived BEFORE somebody waited for it (the computer answers fast: its `ready` frame can
 *  land while the phone is still deriving its keys). */
const mailbox = () => {
  const items = new Map()
  const waiters = new Map()
  return {
    put (key, value) {
      const w = waiters.get(key)
      if (w) { waiters.delete(key); w.resolve(value) } else items.set(key, value)
    },
    fail (err) { for (const [k, w] of waiters) { waiters.delete(k); w.reject(err) } },
    take (key, ms) {
      if (items.has(key)) { const v = items.get(key); items.delete(key); return Promise.resolve(v) }
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => { waiters.delete(key); reject(new Error('timeout')) }, ms)
        waiters.set(key, { resolve: (v) => { clearTimeout(t); resolve(v) }, reject: (e) => { clearTimeout(t); reject(e) } })
      })
    },
  }
}

async function connectAndHandshake ({ sid, mode, phoneId, hostIdPub, code }) {
  const mail = mailbox()
  let channel = null
  let peerUp = false
  const early = [] // encrypted frames that arrived before the channel existed
  let bad = 0
  const handle = async (u8) => {
    try {
      const { header, body } = e2e.unpackFrame(await channel.open(u8))
      bad = 0
      if (header.t === 'approved' || header.t === 'ready' || header.t === 'denied') mail.put('decision', header)
      else onFrameFromComputer(header, body)
    } catch (e) {
      log('frame: ' + String(e.message || e))
      // The channel requires every counter to be exactly the next one: once one frame is lost or late, every later one
      // fails the same way and nothing would ever load again. Three in a row: leave the connection, the resume that follows
      // starts a new channel (new keys, counters at zero), as for a network that changed.
      bad += 1
      if (bad >= 3 && session.ws === ws && kb.state === 'running') { bad = 0; kb.resyncs = (kb.resyncs || 0) + 1; try { ws.close() } catch (err) { /* closed */ } }
    }
  }
  const handlers = {
    control: (m) => {
      if (m.t === 'auth-ok') mail.put('auth', true)
      else if (m.t === 'peer') {
        peerUp = m.state === 'up'
        if (peerUp) mail.put('peer', true)
        else if (session.channel === channel && channel !== null) onPeerDown()
      } else if (m.t === 'error') mail.fail(new Error('relay:' + String(m.code || 'error')))
    },
    data: (u8) => {
      if (u8.length > 0 && u8[0] === 0x7b) { try { mail.put('handshake', JSON.parse(td.decode(u8))) } catch (e) { /* not ours */ } return }
      if (channel === null) { early.push(u8); return }
      void handle(u8)
    },
    close: () => { mail.fail(new Error('relay:closed')); if (session.ws === ws) onRelayDown() },
  }
  const ws = openRelay(sid, handlers)
  session.ws = ws
  await mail.take('auth', 8000)
  // the computer may be offline: the caller sees { ok: false, reason: 'offline' }
  if (!peerUp) { try { await mail.take('peer', 6000) } catch (e) { /* offline */ } }
  if (!peerUp) return { ok: false, reason: 'offline' }
  const adopt = (ch) => { channel = ch; session.channel = ch; for (const u8 of early.splice(0)) void handle(u8) }

  if (mode === 'pair') {
    const req = await e2e.phonePairRequest({ sid, code, phoneId })
    ws.send(te.encode(JSON.stringify(req.msg)))
    const fin = await e2e.phonePairFinish(await mail.take('handshake', 10000), req.state, { sid, hostIdPub })
    adopt(fin.channel)
    kb.sas = fin.sas
    show('verify', { title: STR.verifyTitle, sub: STR.verifySub, sas: fin.sas })
    await sendEnc({ t: 'hello', label: deviceLabel() })
    const decision = await mail.take('decision', 130000)
    if (decision.t !== 'approved') return { ok: false, reason: 'denied' }
    return { ok: true, computer: decision.computer || '' }
  }
  const req = await e2e.phoneResumeRequest({ sid, phoneId })
  ws.send(te.encode(JSON.stringify(req.msg)))
  const fin = await e2e.phoneResumeFinish(await mail.take('handshake', 10000), req.state, { sid, hostIdPub })
  adopt(fin.channel)
  const ready = await mail.take('decision', 10000)
  return { ok: true, computer: ready.computer || '' }
}

let retryTimer = null
let retryDelay = 1500
/** The encrypted channel is gone (the phone slept, the network changed, the computer went away). The DSH page does not know it:
 *  its tunnelled sockets would stay "open" for ever, so it would never reconnect and the chat would not answer. Tell it:
 *  its sockets are closed (its own reconnection logic only runs on a close it is told about) and its requests in flight end. */
function dropTunnel () {
  for (const id of session.sockets) toFrame({ kbws: 'close', id, code: 1006 })
  session.sockets.clear()
  for (const [id, port] of session.ports) {
    if (!session.headed.has(id)) port.postMessage({ t: 'res', status: 503, headers: { 'content-type': 'text/plain' } })
    port.postMessage({ t: 'end' })
  }
  session.ports.clear()
  session.headed.clear()
  session.refusable.clear()
}
function onPeerDown () { dropTunnel(); if (kb.state === 'running') { veil(STR.peerDown); scheduleResume() } }
function onRelayDown () { session.channel = null; dropTunnel(); if (kb.state === 'running') { veil(STR.relayDown); scheduleResume() } else if (kb.state === 'connecting' || kb.state === 'install') scheduleResume() }
function scheduleResume () {
  clearTimeout(retryTimer)
  retryTimer = setTimeout(() => { void resume(true) }, retryDelay)
  retryDelay = Math.min(30000, retryDelay * 2)
}

async function startApp () {
  show('running')
  veil('')
  retryDelay = 1500
  const frame = $('app')
  if (!frame.src || !session.frameReady) { session.frameReady = true; frame.src = '/' }
}

async function resume (quiet) {
  const saved = session.saved || (await idbGet('phone'))
  if (!saved) { show('scan', { title: STR.scanTitle, sub: ios || standalone ? STR.pasteSub : STR.scanSub, actions: pasteActions() }); return }
  session.saved = saved
  if (!quiet) show('connecting', { title: STR.connecting, sub: STR.reconnecting })
  try {
    const r = await connectAndHandshake({ sid: saved.sid, mode: 'resume', phoneId: saved.phoneId, hostIdPub: e2e.fromB64u(saved.hostIdPub) })
    if (!r.ok) {
      if (kb.state === 'running') { veil(STR.peerDown); scheduleResume(); return }
      show('offline', { title: STR.offlineTitle, sub: STR.offlineSub, actions: [{ label: STR.retry, primary: true, run: () => { void resume(false) } }] })
      scheduleResume()
      return
    }
    await startApp()
  } catch (e) {
    log('resume: ' + String(e.message || e))
    if (/relay:(unknown_sid|revoked)/u.test(String(e.message))) { await revoked(); return }
    if (kb.state === 'running') { veil(STR.relayDown); scheduleResume(); return }
    show('offline', { title: STR.offlineTitle, sub: STR.offlineSub, actions: [{ label: STR.retry, primary: true, run: () => { void resume(false) } }] })
    scheduleResume()
  }
}

async function pair (frag, opts = {}) {
  show('connecting', { title: STR.connecting, sub: '' })
  try {
    const phoneId = await e2e.newIdentity(false)
    const r = await connectAndHandshake({ sid: frag.sid, mode: 'pair', phoneId, hostIdPub: frag.hostIdPub, code: frag.code })
    if (!r.ok) {
      if (r.reason === 'denied') show('denied', { title: STR.deniedTitle, sub: STR.deniedSub })
      else show('expired', { title: STR.expiredTitle, sub: STR.expiredSub })
      return
    }
    session.saved = { sid: frag.sid, hostIdPub: e2e.toB64u(frag.hostIdPub), phoneId, computer: r.computer, pairedAt: Date.now() }
    await idbSet('phone', session.saved)
    if (opts.offer !== false) await offerInstall()
    await startApp()
  } catch (e) {
    log('pair: ' + String(e.message || e))
    if (/relay:/u.test(String(e.message))) show('expired', { title: STR.expiredTitle, sub: STR.expiredSub })
    else fail('error', STR.errorTitle, String(e.message || e))
  }
}

async function main () {
  if (!('serviceWorker' in navigator) || !globalThis.crypto || !crypto.subtle || !window.indexedDB) { show('error', { title: STR.errorTitle, sub: STR.unsupported }); return }
  const frag = e2e.parsePairingFragment(location.hash)
  const fullUrl = location.href // what an iPhone app is linked with: copied before the secrets leave the address bar
  const wantInstall = new URLSearchParams(location.search).get('install') === '1'
  if (location.hash) history.replaceState(null, '', location.pathname) // the secrets never stay in the address bar
  navigator.serviceWorker.addEventListener('message', onServiceWorkerMessage)
  try {
    await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    await navigator.serviceWorker.ready
  } catch (e) { fail('error', STR.errorTitle, String(e.message || e)); return }
  if (frag !== null) {
    // An iPhone app keeps its own storage: a link made in Safari would be lost on installing. Offer to install first.
    if (ios && !standalone && touch && !laterRecently()) {
      renderInstall({ link: fullUrl, done: () => { setLater(); void pair(frag, { offer: false }) } })
      return
    }
    await pair(frag)
  } else if (wantInstall && !standalone) {
    history.replaceState(null, '', location.pathname)
    renderInstall({ link: null, done: () => { void resume(false) } })
  } else await resume(false)
}
main().catch((e) => fail('error', STR.errorTitle, String((e && e.message) || e)))
