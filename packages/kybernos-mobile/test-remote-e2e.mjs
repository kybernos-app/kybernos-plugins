// Tests for the end-to-end channel of the phone link (remote-e2e.mjs). Plain Node, no DSH, no network.
import * as e from './remote-e2e.mjs'

let fail = 0
const ok = (name, cond, detail) => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (detail ? ' - ' + detail : '')); if (!cond) fail++ }
const throws = async (fn) => { try { await fn(); return null } catch (err) { return String(err.message || err) } }
const bytes = (s) => new TextEncoder().encode(s)
const text = (u8) => new TextDecoder().decode(u8)

const sid = e.randomToken(16)
const code = e.randomToken(16)
const hostId = await e.newIdentity(true)
const phoneId = await e.newIdentity(false)

// ── pairing, the happy path ─────────────────────────────────────────────────────────────────────────────────────
const req = await e.phonePairRequest({ sid, code, phoneId })
const acc = await e.hostPairAccept(req.msg, { sid, code, hostId })
const fin = await e.phonePairFinish(acc.reply, req.state, { sid, hostIdPub: hostId.pub })
ok('both sides show the same 4 digits', /^\d{4}$/u.test(acc.sas) && acc.sas === fin.sas, acc.sas)
ok('the computer learns the phone identity', acc.phoneIdPub.length === 65 && e.toB64u(acc.phoneIdPub) === e.toB64u(phoneId.pub))

const f1 = await fin.channel.seal(bytes('hello computer'))
ok('phone -> computer decrypts', text(await acc.channel.open(f1)) === 'hello computer')
const f2 = await acc.channel.seal(bytes('hello phone'))
ok('computer -> phone decrypts', text(await fin.channel.open(f2)) === 'hello phone')
ok('a frame carries no plaintext', !text(f1).includes('hello'))

// many frames, sealed concurrently, still arrive in order
const many = await Promise.all(Array.from({ length: 40 }, (_, i) => fin.channel.seal(bytes('m' + i))))
let inOrder = true
for (let i = 0; i < many.length; i += 1) { if (text(await acc.channel.open(many[i])) !== 'm' + i) inOrder = false }
ok('40 concurrent seals open in order', inOrder)

// a big body
const big = new Uint8Array(2 * 1024 * 1024)
for (let i = 0; i < big.length; i += 1) big[i] = (i * 31) & 255
const bigBack = await fin.channel.open(await acc.channel.seal(big))
ok('a 2 MiB frame survives', bigBack.length === big.length && bigBack[12345] === big[12345])

// ── attacks on the handshake ────────────────────────────────────────────────────────────────────────────────────
ok('a wrong one-time code is refused by the computer',
  /bad pairing code/u.test(await throws(() => e.hostPairAccept(req.msg, { sid, code: e.randomToken(16), hostId }))))
ok('a pairing request for another sid is refused',
  /bad pairing code/u.test(await throws(() => e.hostPairAccept(req.msg, { sid: e.randomToken(16), code, hostId }))))
const swapped = await e.phonePairRequest({ sid, code: e.randomToken(16), phoneId: await e.newIdentity(false) })
const relayForged = { ...req.msg, eph: swapped.msg.eph } // a relay putting its own ephemeral key in
ok('a relay that swaps the phone key is caught by the MAC',
  /bad pairing code/u.test(await throws(() => e.hostPairAccept(relayForged, { sid, code, hostId }))))
const rogueHost = await e.newIdentity(true)
const rogue = await e.hostPairAccept(req.msg, { sid, code, hostId: rogueHost })
ok('a computer that is not the one in the QR code is refused by the phone',
  /did not prove its identity/u.test(await throws(() => e.phonePairFinish(rogue.reply, req.state, { sid, hostIdPub: hostId.pub }))))
ok('a garbled pair-ok is refused', /e2e/u.test(await throws(() => e.phonePairFinish({ v: 1, t: 'pair-ok', eph: 'AAAA', sig: 'AAAA' }, req.state, { sid, hostIdPub: hostId.pub }))))

// ── attacks on the channel ──────────────────────────────────────────────────────────────────────────────────────
const p = await e.phonePairRequest({ sid, code, phoneId })
const a = await e.hostPairAccept(p.msg, { sid, code, hostId })
const fch = await e.phonePairFinish(a.reply, p.state, { sid, hostIdPub: hostId.pub })
const g1 = await fch.channel.seal(bytes('one'))
const g2 = await fch.channel.seal(bytes('two'))
ok('a reordered frame is refused', /out of order/u.test(await throws(() => a.channel.open(g2))))
ok('the first frame is still good after that refusal', text(await a.channel.open(g1)) === 'one')
ok('a replayed frame is refused', /out of order/u.test(await throws(() => a.channel.open(g1))))
const tampered = new Uint8Array(g2)
tampered[tampered.length - 1] ^= 1
ok('a tampered frame is refused', (await throws(() => a.channel.open(tampered))) !== null)
ok('a truncated frame is refused', /short frame/u.test(await throws(() => a.channel.open(g2.subarray(0, 10)))))
const other = await e.phonePairRequest({ sid, code, phoneId })
const otherAcc = await e.hostPairAccept(other.msg, { sid, code, hostId })
ok('a frame from another session does not open', (await throws(() => otherAcc.channel.open(g2))) !== null)

// ── reconnection ────────────────────────────────────────────────────────────────────────────────────────────────
const isKnown = (pub) => e.toB64u(pub) === e.toB64u(phoneId.pub)
const rq = await e.phoneResumeRequest({ sid, phoneId })
const ra = await e.hostResumeAccept(rq.msg, { sid, hostId, isKnown })
const rf = await e.phoneResumeFinish(ra.reply, rq.state, { sid, hostIdPub: hostId.pub })
ok('a known phone resumes and the channel works both ways',
  text(await ra.channel.open(await rf.channel.seal(bytes('back')))) === 'back' && text(await rf.channel.open(await ra.channel.seal(bytes('welcome')))) === 'welcome')
const rq2 = await e.phoneResumeRequest({ sid, phoneId })
const ra2 = await e.hostResumeAccept(rq2.msg, { sid, hostId, isKnown })
ok('every connection has its own keys', (await throws(async () => ra2.channel.open(await rf.channel.seal(bytes('x'))))) !== null)
const stranger = await e.newIdentity(false)
const sq = await e.phoneResumeRequest({ sid, phoneId: stranger })
ok('an unknown (or revoked) phone is refused', /unknown phone/u.test(await throws(() => e.hostResumeAccept(sq.msg, { sid, hostId, isKnown }))))
const forged = { ...rq.msg, id: e.toB64u(phoneId.pub), sig: sq.msg.sig }
ok('a resume signed by another key is refused', /bad phone signature/u.test(await throws(() => e.hostResumeAccept(forged, { sid, hostId, isKnown }))))
ok('a resume replayed on another sid is refused', /bad phone signature/u.test(await throws(() => e.hostResumeAccept(rq.msg, { sid: e.randomToken(16), hostId, isKnown }))))
ok('a rogue computer is refused on resume',
  /did not prove its identity/u.test(await throws(async () => {
    const r = await e.hostResumeAccept(rq.msg, { sid, hostId: rogueHost, isKnown })
    return e.phoneResumeFinish(r.reply, rq.state, { sid, hostIdPub: hostId.pub })
  })))

// ── identity storage and the QR fragment ────────────────────────────────────────────────────────────────────────
const stored = await e.exportIdentity(hostId)
const again = await e.importIdentity(JSON.parse(JSON.stringify(stored)))
ok('an identity survives a JSON round trip', e.toB64u(again.pub) === e.toB64u(hostId.pub))
const r3 = await e.phonePairRequest({ sid, code, phoneId })
const a3 = await e.hostPairAccept(r3.msg, { sid, code, hostId: again })
ok('the reloaded identity still signs for the same public key', (await e.phonePairFinish(a3.reply, r3.state, { sid, hostIdPub: hostId.pub })).sas === a3.sas)
ok('a non-extractable phone identity cannot be exported', (await throws(() => e.exportIdentity(phoneId))) !== null)

const url = e.pairingUrl('https://r.example.test/m/', sid, code, e.toB64u(hostId.pub))
const frag = e.parsePairingFragment(url.slice(url.indexOf('#')))
ok('the QR fragment round-trips', frag !== null && frag.sid === sid && frag.code === code && e.toB64u(frag.hostIdPub) === e.toB64u(hostId.pub))
ok('a malformed fragment is rejected', e.parsePairingFragment('#abc.def') === null && e.parsePairingFragment('') === null)
ok('the fragment is the only place the secrets sit', !url.split('#')[0].includes(code) && !url.split('#')[0].includes(sid))

const pk = e.packFrame({ t: 'req', id: 'r1' }, bytes('body'))
const un = e.unpackFrame(pk)
ok('a frame packs and unpacks', un.header.t === 'req' && un.header.id === 'r1' && text(un.body) === 'body')
ok('a bad frame is refused', /e2e/u.test(await throws(async () => e.unpackFrame(new Uint8Array([0, 0, 0, 200, 1, 2])))))

process.exit(fail ? 1 : 0)
