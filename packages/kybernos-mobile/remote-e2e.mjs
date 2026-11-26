// kybernos-mobile: the end-to-end channel between a computer and a paired phone.
//
// This file runs UNCHANGED on the computer (Node, host half) and on the phone (the page served by the relay): it only
// uses WebCrypto (`globalThis.crypto`), no Buffer, no imports. The relay carries the frames and can read none of them.
//
// Keys
//   · each side has a long-term ECDSA P-256 identity (the computer's public half travels in the QR code, the phone's
//     is learned at pairing);
//   · every connection makes a fresh ECDH P-256 pair on both sides, so a later theft of an identity key does not open
//     past traffic;
//   · the session keys are HKDF-SHA256 of the shared secret, salted with the hash of the whole transcript, one key
//     per direction.
//
// Pairing (the QR code carries `sid`, a one-time `code` and the computer's identity public key; all of it after the `#`
// of the URL, so it is never sent to a server)
//   phone -> computer  { t:'pair', id, eph, mac }   mac = HMAC(code, sid | id | eph): the relay cannot forge it
//   computer -> phone  { t:'pair-ok', eph, sig }    sig = ECDSA(computer identity, transcript): the relay cannot forge it
//   both derive the same keys and the same 4 digits (`sas`), which each screen shows.
// Reconnection of a known phone
//   phone -> computer  { t:'resume', id, eph, sig } sig = ECDSA(phone identity, sid | eph)
//   computer -> phone  { t:'resume-ok', eph, sig }
//
// After the handshake every frame is AES-256-GCM with a per-direction key and the frame counter as nonce; the receiver
// requires the counter to be exactly the next one, so a relay can neither replay, reorder nor splice frames.
const te = new TextEncoder()
const td = new TextDecoder()
const subtle = () => globalThis.crypto.subtle
const PROTO = 'kb-mr1'

// ── bytes ────────────────────────────────────────────────────────────────────────────────────────────────────────
export function toB64u (u8) {
  let s = ''
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000))
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}
export function fromB64u (s) {
  if (typeof s !== 'string' || /[^A-Za-z0-9_-]/u.test(s)) throw new Error('e2e: bad base64url')
  const b = atob(s.replaceAll('-', '+').replaceAll('_', '/'))
  const u8 = new Uint8Array(b.length)
  for (let i = 0; i < b.length; i += 1) u8[i] = b.charCodeAt(i)
  return u8
}
export function concat (...parts) {
  let n = 0
  for (const p of parts) n += p.length
  const out = new Uint8Array(n)
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}
const u16 = (n) => new Uint8Array([(n >> 8) & 255, n & 255])
const u32 = (n) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255])
const readU32 = (u8, o = 0) => ((u8[o] << 24) | (u8[o + 1] << 16) | (u8[o + 2] << 8) | u8[o + 3]) >>> 0
const asBytes = (v) => (typeof v === 'string' ? te.encode(v) : v)
/** Length-prefixed concatenation: no two different tuples of fields give the same bytes. */
const lp = (...fields) => concat(...fields.map((f) => { const b = asBytes(f); return concat(u16(b.length), b) }))
const sameBytes = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i += 1) d |= a[i] ^ b[i]; return d === 0 }

async function sha256 (data) { return new Uint8Array(await subtle().digest('SHA-256', data)) }
async function hmac (keyBytes, data) {
  const k = await subtle().importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await subtle().sign('HMAC', k, data))
}
async function hkdf (secret, salt, info, bytes) {
  const k = await subtle().importKey('raw', secret, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: te.encode(info) }, k, bytes * 8))
}

// ── keys ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/** A long-term identity. `extractable: false` on the phone (the key never leaves the browser), true on the computer
 *  (it is kept in a 0600 file so the QR code stays valid across restarts). */
export async function newIdentity (extractable = false) {
  const kp = await subtle().generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, extractable, ['sign', 'verify'])
  const pub = new Uint8Array(await subtle().exportKey('raw', kp.publicKey))
  return { privateKey: kp.privateKey, publicKey: kp.publicKey, pub }
}
export async function exportIdentity (id) {
  return { priv: await subtle().exportKey('jwk', id.privateKey), pub: toB64u(id.pub) }
}
export async function importIdentity (stored) {
  const privateKey = await subtle().importKey('jwk', stored.priv, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const pub = fromB64u(stored.pub)
  const publicKey = await verifyKey(pub)
  return { privateKey, publicKey, pub }
}
async function verifyKey (rawPub) {
  if (!(rawPub instanceof Uint8Array) || rawPub.length !== 65 || rawPub[0] !== 4) throw new Error('e2e: bad public key')
  return subtle().importKey('raw', rawPub, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
}
async function sign (privateKey, data) { return new Uint8Array(await subtle().sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, data)) }
async function verify (rawPub, sig, data) {
  try { return await subtle().verify({ name: 'ECDSA', hash: 'SHA-256' }, await verifyKey(rawPub), sig, data) } catch (e) { return false }
}
async function ephemeral () {
  const kp = await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
  return { privateKey: kp.privateKey, pub: new Uint8Array(await subtle().exportKey('raw', kp.publicKey)) }
}
async function dh (privateKey, rawPub) {
  if (!(rawPub instanceof Uint8Array) || rawPub.length !== 65 || rawPub[0] !== 4) throw new Error('e2e: bad ephemeral key')
  const pub = await subtle().importKey('raw', rawPub, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  return new Uint8Array(await subtle().deriveBits({ name: 'ECDH', public: pub }, privateKey, 256))
}

// ── the AEAD channel ─────────────────────────────────────────────────────────────────────────────────────────────
const ivFor = (counter) => { const iv = new Uint8Array(12); let c = counter; for (let i = 11; i >= 4; i -= 1) { iv[i] = c % 256; c = Math.floor(c / 256) } return iv }
const counterBytes = (counter) => ivFor(counter).subarray(4)
const readCounter = (u8) => { let c = 0; for (let i = 0; i < 8; i += 1) c = c * 256 + u8[i]; return c }

export class Channel {
  constructor (sendKey, recvKey) {
    this.sendKey = sendKey
    this.recvKey = recvKey
    this.sent = 0
    this.received = 0
    this.sendChain = Promise.resolve()
    this.recvChain = Promise.resolve()
  }

  /** Encrypt one frame. Calls are served in order, so frames leave in counter order. */
  seal (plain) {
    const run = async () => {
      const c = this.sent
      this.sent += 1
      const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: ivFor(c) }, this.sendKey, plain))
      return concat(counterBytes(c), ct)
    }
    const p = this.sendChain.then(run, run)
    this.sendChain = p.catch(() => {})
    return p
  }

  /** Decrypt one frame; throws on a wrong counter (replay, drop, reorder) or a bad tag (tampering). */
  open (frame) {
    const run = async () => {
      if (!(frame instanceof Uint8Array) || frame.length < 8 + 16) throw new Error('e2e: short frame')
      const c = readCounter(frame)
      if (c !== this.received) throw new Error('e2e: frame out of order')
      const pt = new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: ivFor(c) }, this.recvKey, frame.subarray(8)))
      this.received += 1
      return pt
    }
    const p = this.recvChain.then(run, run)
    this.recvChain = p.catch(() => {})
    return p
  }
}

async function makeChannel (secret, transcript, side) {
  const okm = await hkdf(secret, transcript, PROTO + ' keys', 64)
  const aes = (b) => subtle().importKey('raw', b, 'AES-GCM', false, ['encrypt', 'decrypt'])
  const hostToPhone = await aes(okm.subarray(0, 32))
  const phoneToHost = await aes(okm.subarray(32, 64))
  const s = await hkdf(secret, transcript, PROTO + ' sas', 2)
  const sas = String(((s[0] << 8) | s[1]) % 10000).padStart(4, '0')
  return { channel: side === 'host' ? new Channel(hostToPhone, phoneToHost) : new Channel(phoneToHost, hostToPhone), sas }
}

const transcript = (kind, sid, phoneId, phoneEph, hostEph, hostId) => sha256(lp(PROTO, kind, sid, phoneId, phoneEph, hostEph, hostId))
const need = (cond, what) => { if (cond !== true) throw new Error('e2e: ' + what) }

// ── pairing ──────────────────────────────────────────────────────────────────────────────────────────────────────
/** PHONE: the first message. `phoneId` is the phone's identity from `newIdentity()`. Keep `state` for `phonePairFinish`. */
export async function phonePairRequest ({ sid, code, phoneId }) {
  const eph = await ephemeral()
  const mac = await hmac(te.encode(code), lp('pair', sid, phoneId.pub, eph.pub))
  return {
    msg: { v: 1, t: 'pair', id: toB64u(phoneId.pub), eph: toB64u(eph.pub), mac: toB64u(mac) },
    state: { eph, phoneId },
  }
}

/** COMPUTER: check the message, answer it. Throws when the one-time code was not used (a relay that swapped the phone's
 *  key cannot compute the MAC). The returned channel must not serve anything until the person approves. */
export async function hostPairAccept (msg, { sid, code, hostId }) {
  need(msg !== null && typeof msg === 'object' && msg.v === 1 && msg.t === 'pair', 'not a pair message')
  const phoneIdPub = fromB64u(msg.id)
  const phoneEph = fromB64u(msg.eph)
  const want = await hmac(te.encode(code), lp('pair', sid, phoneIdPub, phoneEph))
  need(sameBytes(want, fromB64u(msg.mac)), 'bad pairing code')
  await verifyKey(phoneIdPub)
  const eph = await ephemeral()
  const secret = await dh(eph.privateKey, phoneEph)
  const th = await transcript('pair', sid, phoneIdPub, phoneEph, eph.pub, hostId.pub)
  const { channel, sas } = await makeChannel(secret, th, 'host')
  const sig = await sign(hostId.privateKey, th)
  return {
    reply: { v: 1, t: 'pair-ok', eph: toB64u(eph.pub), sig: toB64u(sig) },
    channel,
    sas,
    phoneIdPub,
  }
}

/** PHONE: check the computer's answer against the identity key the QR code carried. */
export async function phonePairFinish (reply, state, { sid, hostIdPub }) {
  need(reply !== null && typeof reply === 'object' && reply.v === 1 && reply.t === 'pair-ok', 'not a pair-ok message')
  const hostEph = fromB64u(reply.eph)
  const th = await transcript('pair', sid, state.phoneId.pub, state.eph.pub, hostEph, hostIdPub)
  need(await verify(hostIdPub, fromB64u(reply.sig), th), 'the computer did not prove its identity')
  const secret = await dh(state.eph.privateKey, hostEph)
  return makeChannel(secret, th, 'phone')
}

// ── reconnection ─────────────────────────────────────────────────────────────────────────────────────────────────
/** PHONE: reconnect with the identity paired earlier. */
export async function phoneResumeRequest ({ sid, phoneId }) {
  const eph = await ephemeral()
  const sig = await sign(phoneId.privateKey, lp('resume', sid, eph.pub))
  return { msg: { v: 1, t: 'resume', id: toB64u(phoneId.pub), eph: toB64u(eph.pub), sig: toB64u(sig) }, state: { eph, phoneId } }
}

/** COMPUTER: `isKnown(phoneIdPubBytes)` says whether that identity is a paired, un-revoked phone. */
export async function hostResumeAccept (msg, { sid, hostId, isKnown }) {
  need(msg !== null && typeof msg === 'object' && msg.v === 1 && msg.t === 'resume', 'not a resume message')
  const phoneIdPub = fromB64u(msg.id)
  const phoneEph = fromB64u(msg.eph)
  need(isKnown(phoneIdPub) === true, 'unknown phone')
  need(await verify(phoneIdPub, fromB64u(msg.sig), lp('resume', sid, phoneEph)), 'bad phone signature')
  const eph = await ephemeral()
  const secret = await dh(eph.privateKey, phoneEph)
  const th = await transcript('resume', sid, phoneIdPub, phoneEph, eph.pub, hostId.pub)
  const { channel } = await makeChannel(secret, th, 'host')
  const sig = await sign(hostId.privateKey, th)
  return { reply: { v: 1, t: 'resume-ok', eph: toB64u(eph.pub), sig: toB64u(sig) }, channel, phoneIdPub }
}

export async function phoneResumeFinish (reply, state, { sid, hostIdPub }) {
  need(reply !== null && typeof reply === 'object' && reply.v === 1 && reply.t === 'resume-ok', 'not a resume-ok message')
  const hostEph = fromB64u(reply.eph)
  const th = await transcript('resume', sid, state.phoneId.pub, state.eph.pub, hostEph, hostIdPub)
  need(await verify(hostIdPub, fromB64u(reply.sig), th), 'the computer did not prove its identity')
  const secret = await dh(state.eph.privateKey, hostEph)
  return makeChannel(secret, th, 'phone')
}

// ── frames: a JSON header and an optional binary body ────────────────────────────────────────────────────────────
export function packFrame (header, body = new Uint8Array(0)) {
  const h = te.encode(JSON.stringify(header))
  return concat(u32(h.length), h, body)
}
export function unpackFrame (u8) {
  need(u8 instanceof Uint8Array && u8.length >= 4, 'short message')
  const n = readU32(u8)
  need(n > 0 && 4 + n <= u8.length, 'bad header length')
  const header = JSON.parse(td.decode(u8.subarray(4, 4 + n)))
  need(header !== null && typeof header === 'object' && typeof header.t === 'string', 'bad header')
  return { header, body: u8.subarray(4 + n) }
}

/** The text a QR code carries: `<phone url>#<sid>.<code>.<computer identity key>`. */
export function pairingUrl (phoneUrl, sid, code, hostIdPubB64u) {
  return phoneUrl.replace(/#.*$/u, '') + '#' + sid + '.' + code + '.' + hostIdPubB64u
}
export function parsePairingFragment (fragment) {
  const m = /^#?([A-Za-z0-9_-]{16,64})\.([A-Za-z0-9_-]{16,64})\.([A-Za-z0-9_-]{80,100})$/u.exec(String(fragment))
  if (m === null) return null
  return { sid: m[1], code: m[2], hostIdPub: fromB64u(m[3]) }
}

/** A random URL-safe string of `bytes` random bytes. */
export function randomToken (bytes = 16) { return toB64u(globalThis.crypto.getRandomValues(new Uint8Array(bytes))) }
