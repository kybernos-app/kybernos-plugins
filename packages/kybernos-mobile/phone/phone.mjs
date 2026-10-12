// kybernos-mobile: the phone page. Served by the relay's web origin; nothing here is private (this file is part of the
// open repository, so what the page does can be read and checked).
//
//   · reads the pairing secrets from the URL fragment (never sent to a server) and removes them from the address bar,
//   · opens ONE WebSocket to the relay and runs the end-to-end handshake with the computer (remote-e2e.mjs),
//   · shows the 4-digit check, waits for the person to approve on the computer, keeps its identity in IndexedDB
//     (a non-extractable key: it cannot be exported even from this page),
//   · then runs the computer's own DSH page in an iframe: the service worker (sw.js) sends every request of that page
//     here, this file encrypts it for the computer, and a WebSocket shim does the same for DSH's streaming socket.
import * as e2e from '/__kb/remote-e2e.mjs'

const lang = String(navigator.language || 'en').toLowerCase().startsWith('fr') ? 'fr' : 'en'
const STR = {
  fr: {
    scanTitle: 'Scanne le code de ton ordinateur', scanSub: 'Ouvre Réglages › Mobile sur ton ordinateur et vise le code avec l\'appareil photo.',
    connecting: 'Connexion à ton poste', verifyTitle: 'Autorise ce téléphone', verifySub: 'Sur ton ordinateur, vérifie que ce code est le même, puis touche Autoriser.',
    saslabel: 'Ce code doit être le même sur l\'ordinateur', waiting: 'Attente de ton accord sur l\'ordinateur…',
    offlineTitle: 'Ton ordinateur est hors ligne', offlineSub: 'Allume-le et ouvre Kybernos : la connexion reprend toute seule.',
    reconnecting: 'Reconnexion…', revokedTitle: 'Ce téléphone n\'est plus autorisé', revokedSub: 'Il a été retiré depuis l\'ordinateur. Scanne un nouveau code pour le rappairer.',
    deniedTitle: 'Accès refusé', deniedSub: 'L\'ordinateur n\'a pas autorisé ce téléphone.', expiredTitle: 'Code expiré', expiredSub: 'Génère un nouveau code sur l\'ordinateur et scanne-le.',
    errorTitle: 'Connexion impossible', unsupported: 'Ce navigateur ne gère pas les fonctions nécessaires (service worker, WebCrypto).',
    retry: 'Réessayer', lock: 'Chiffré de bout en bout. Kybernos transporte tes messages sans pouvoir les lire.',
    peerDown: 'Ordinateur hors ligne, reconnexion…', relayDown: 'Connexion perdue, reconnexion…',
  },
  en: {
    scanTitle: 'Scan the code on your computer', scanSub: 'Open Settings › Mobile on your computer and aim the camera at the code.',
    connecting: 'Connecting to your computer', verifyTitle: 'Allow this phone', verifySub: 'On your computer, check that this code is the same, then click Allow.',
    saslabel: 'This code must be the same on the computer', waiting: 'Waiting for your approval on the computer…',
    offlineTitle: 'Your computer is offline', offlineSub: 'Turn it on and open Kybernos: the connection resumes by itself.',
    reconnecting: 'Reconnecting…', revokedTitle: 'This phone is no longer allowed', revokedSub: 'It was removed from the computer. Scan a new code to pair it again.',
    deniedTitle: 'Access refused', deniedSub: 'The computer did not allow this phone.', expiredTitle: 'Code expired', expiredSub: 'Make a new code on the computer and scan it.',
    errorTitle: 'Cannot connect', unsupported: 'This browser lacks what is needed (service worker, WebCrypto).',
    retry: 'Try again', lock: 'End-to-end encrypted. Kybernos carries your messages and cannot read them.',
    peerDown: 'Computer offline, reconnecting…', relayDown: 'Connection lost, reconnecting…',
  },
}[lang]

const $ = (id) => document.getElementById(id)
const kb = (window.__kb = { state: 'start', req: 0, bytes: 0, wsOpen: 0, wsMsgs: 0, sas: null, refusals: 0, log: [] })
const log = (s) => { kb.log.push(String(s).slice(0, 160)); if (kb.log.length > 40) kb.log.shift() }
const te = new TextEncoder()
const td = new TextDecoder()

// ── screen ───────────────────────────────────────────────────────────────────────────────────────────────────────
function show (state, { title, sub, sas, actions } = {}) {
  kb.state = state
  document.body.dataset.state = state
  const running = state === 'running'
  $('gate').hidden = running
  $('app').hidden = !running
  $('title').textContent = title || ''
  $('sub').textContent = sub || ''
  $('sas').hidden = !sas
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
  return br === '' ? os : os + ' · ' + br
}

// ── the tunnel: requests of the DSH page, through the service worker and the shim ───────────────────────────────
const session = { channel: null, ws: null, ports: new Map(), seq: 0, saved: null, frameReady: false }

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
    case 'res': { const p = session.ports.get(header.id); if (p) p.postMessage({ t: 'res', status: header.status, headers: header.headers || {}, enc: header.enc || null }); return }
    case 'chunk': {
      const p = session.ports.get(header.id)
      if (!p) return
      kb.bytes += body.length
      const copy = body.slice().buffer
      p.postMessage({ t: 'chunk', buf: copy }, [copy])
      return
    }
    case 'end': { const p = session.ports.get(header.id); if (p) { p.postMessage({ t: 'end' }); session.ports.delete(header.id) } return }
    case 'ws-open': kb.wsOpen += 1; toFrame({ kbws: 'open', id: header.id, protocol: header.protocol || '' }); return
    case 'ws-msg': {
      kb.wsMsgs += 1
      if (header.text === true) toFrame({ kbws: 'msg', id: header.id, text: td.decode(body) })
      else { const copy = body.slice().buffer; toFrame({ kbws: 'msg', id: header.id, bin: copy }, [copy]) }
      return
    }
    case 'ws-close': toFrame({ kbws: 'close', id: header.id, code: header.code || 1006 }); return
    case 'refused': kb.refusals += 1; return
    case 'bye': if (header.reason === 'revoked') void revoked(); return
    default: log('unknown frame ' + String(header.t).slice(0, 20))
  }
}
const toFrame = (msg, transfer) => { const w = $('app').contentWindow; if (w) w.postMessage(msg, location.origin, transfer || []) }

window.addEventListener('message', (ev) => {
  if (ev.origin !== location.origin || ev.source !== $('app').contentWindow) return
  const d = ev.data
  if (d === null || typeof d !== 'object' || typeof d.kbws !== 'string') return
  if (d.kbws === 'open') void sendEnc({ t: 'ws-open', id: d.id, path: d.path, protocols: d.protocols })
  else if (d.kbws === 'msg') void sendEnc({ t: 'ws-msg', id: d.id, text: typeof d.text === 'string' }, typeof d.text === 'string' ? te.encode(d.text) : new Uint8Array(d.bin))
  else if (d.kbws === 'close') void sendEnc({ t: 'ws-close', id: d.id, code: d.code })
})

async function revoked () {
  await idbDel('phone')
  session.channel = null
  try { session.ws && session.ws.close() } catch (e) { /* closed */ }
  veil('')
  show('revoked', { title: STR.revokedTitle, sub: STR.revokedSub })
}

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
  const handle = async (u8) => {
    try {
      const { header, body } = e2e.unpackFrame(await channel.open(u8))
      if (header.t === 'approved' || header.t === 'ready' || header.t === 'denied') mail.put('decision', header)
      else onFrameFromComputer(header, body)
    } catch (e) { log('frame: ' + String(e.message || e)) }
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
function onPeerDown () { if (kb.state === 'running') { veil(STR.peerDown); scheduleResume() } }
function onRelayDown () { session.channel = null; if (kb.state === 'running') { veil(STR.relayDown); scheduleResume() } else if (kb.state === 'connecting') scheduleResume() }
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
  if (!saved) { show('scan', { title: STR.scanTitle, sub: STR.scanSub }); return }
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

async function pair (frag) {
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
  if (location.hash) history.replaceState(null, '', location.pathname) // the secrets never stay in the address bar
  navigator.serviceWorker.addEventListener('message', onServiceWorkerMessage)
  try {
    await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    await navigator.serviceWorker.ready
  } catch (e) { fail('error', STR.errorTitle, String(e.message || e)); return }
  if (frag !== null) await pair(frag)
  else await resume(false)
}
main().catch((e) => fail('error', STR.errorTitle, String((e && e.message) || e)))
