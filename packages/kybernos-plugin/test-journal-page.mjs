#!/usr/bin/env node
/** The shared Journal page (journal-page.mjs + journal-viewer.js): what is kept back stays back, the page cannot be turned into code, and its seals are checked by the reader.
 *  Usage: node packages/kybernos-plugin/test-journal-page.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { createHash, webcrypto } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import vm from 'node:vm'
import { createRecorder, readDecisions } from './journal-decisions.mjs'
import { DEFAULT_INCLUDE, LOCK_LABELS, journalDocument, journalPageHtml, journalViewerHtml, logoUri, pageFileName, resolveInclude, viewerCss, viewerScript } from './journal-page.mjs'
import { sealText } from './vendor/share-seal.mjs'
import { loadSealKey, sealEvidence, verifyDecisions } from './journal-seal.mjs'
import { deriveStory } from './journal-story.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

// ── a chat that holds a marker in every place a person may want to keep back ─────────────
const T0 = 1_800_000_000_000
const MIN = 60_000
let seq = 0
const ev = (type, at, data) => { seq += 1; return { type: type, seq: seq, time: T0 + at, data: data } }
const call = (at, callId, name, args) => ev('tool/call', at, { turn: 1, step: 1, callId: callId, name: name, arguments: JSON.stringify(args) })
const result = (at, callId, text) => ev('tool/result', at, { turn: 1, step: 1, message: { role: 'tool', toolCallId: callId, source: { kind: 'tool', callId: callId }, content: [{ type: 'text', text: text }] } })
const SESSION = 'session-ZXCHATIDQ1W2E3R4'
const events = [
  ev('turn/start', 0, { turn: 1 }),
  ev('user/message', 1, { role: 'user', content: [{ type: 'text', text: 'MARK-PROMPT write to the board' }], source: { kind: 'user' } }),
  call(MIN, 'g1', 'GMAIL_SEND_EMAIL', { to: 'MARK-TOOL-INPUT@example.com' }), result(MIN + 500, 'g1', 'sent MARK-TOOL-OUTPUT https://example.com/MARK-LINK'),
  call(2 * MIN, 'sk', 'skill', { name: 'recruiter-outreach' }), result(2 * MIN + 100, 'sk', 'ok'),
  call(3 * MIN, 'mw', 'memory_write', { content: 'MARK-MEMORY' }), result(3 * MIN + 100, 'mw', 'ok'),
  ev('approval/asked', 4 * MIN, { id: 'ap1', toolName: 'bash', callId: 'b1', reason: 'MARK-REASON delete the folder' }),
  ev('approval/decided', 4 * MIN + 2000, { id: 'ap1', outcome: 'allowed-once' }),
  call(5 * MIN, 'q1', 'ask_user_question', { questions: [{ question: 'MARK-QUESTION send it?', options: [{ label: 'MARK-OPTION Send' }, { label: 'Wait' }] }] }), result(5 * MIN + 3000, 'q1', JSON.stringify({ answers: [{ id: 'a', selected: ['MARK-OPTION Send'] }] })),
  call(6 * MIN, 'pr', 'present', { files: [{ path: '/srv/projects/MARK-PATH/offer.pdf', description: 'The offer letter' }] }), result(6 * MIN + 100, 'pr', 'Presented'),
  ev('deliverables/presented', 6 * MIN + 100, { turn: 1, callId: 'pr', files: [{ path: '/srv/projects/MARK-PATH/offer.pdf', description: 'The offer letter' }] }),
  ev('assistant/message', 7 * MIN, { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'MARK-REPLY done' }], source: { kind: 'model', provider: 'zai', model: 'glm-5.3' } }, usage: { input: 1200, output: 300, cacheRead: 0, cacheWrite: 0 } }),
  ev('turn/end', 7 * MIN + 10, { turn: 1 }),
]
const dir = mkdtempSync(join(tmpdir(), 'kb-journal-page-'))
try {
  const key = loadSealKey(join(dir, 'key.json'), { create: true })
  const rec = createRecorder({ dir: join(dir, 'decisions'), who: () => ({ by: 'MARK-NAME Amira', device: 'MARK-DEVICE MacBook' }), seal: () => key })
  for (const e of events) rec.ingest(SESSION, e)
  const decisions = readDecisions(join(dir, 'decisions'), SESSION)
  const seals = verifyDecisions(events, decisions, SESSION, key)
  const evidence = sealEvidence(events, decisions, SESSION, key)
  const crew = { runId: 'r1', name: 'Recruiter research', startedAt: T0 + MIN, endedAt: T0 + 3 * MIN, declaredFrom: 'agent-team', stopReason: 'completed', totals: { durationMs: 2 * MIN, tokens: 5000, costEur: 0.2, failed: 0 }, members: [{ label: 'researcher', phase: 'doer', outcome: 'done', durationMs: 1000, actual: { provider: 'zai', model: 'glm-5.3', tokens: 5000, costEur: 0.2 } }] }
  const story = deriveStory(events, { sessionId: SESSION, runs: [crew], costOf: () => 0.31, decisions: decisions, seals: seals })
  const sealInfo = { alg: 'ed25519', keyId: key.keyId, publicKey: key.publicKey }
  const make = (include, extra) => journalDocument(Object.assign({ story: story, include: include, lang: 'en', seal: sealInfo, evidence: evidence, made: '2026-11-02' }, extra))
  const text = (doc) => JSON.stringify(doc)
  assert.equal(story.moments.filter((m) => m.kind === 'handover' && m.approvers[0].seal === 'valid').length, 2, 'the story was built with two sealed decisions')

  // ── the switches ────────────────────────────────────────────────────────────────────
  assert.deepEqual(resolveInclude(undefined), DEFAULT_INCLUDE)
  assert.deepEqual(resolveInclude({ prompts: 'yes', names: 1 }), DEFAULT_INCLUDE)
  const v = resolveInclude({ verify: true })
  assert.deepEqual([v.approvers, v.names, v.computers, v.chatId, v.verify], [true, true, true, true, true])
  const noAp = resolveInclude({ approvers: false, names: true, computers: true })
  assert.deepEqual([noAp.approvers, noAp.names, noAp.computers], [false, false, false])
  ok('the defaults keep the words, the names, the computers and the chat number back; checking the seals brings in what they cover; no decisions, no names')

  // ── what is kept back by default stays back ──────────────────────────────────────────
  const plain = make({})
  const plainText = text(plain)
  for (const m of ['MARK-PROMPT', 'MARK-REPLY', 'MARK-QUESTION', 'MARK-OPTION', 'MARK-REASON', 'MARK-MEMORY', 'MARK-NAME', 'MARK-DEVICE', 'ZXCHATID', 'MARK-TOOL-INPUT', 'MARK-TOOL-OUTPUT', 'MARK-PATH', '/srv/projects']) assert.equal(plainText.includes(m), false, m + ' is in the default page')
  assert.equal(plain.title, null)
  assert.equal(plain.chat.id, null)
  assert.equal(plainText.includes('MARK-LINK'), true, 'the link is a deliverable: on by default')
  assert.equal(plainText.includes('offer.pdf'), true)
  assert.equal(plain.seal.publicKey, undefined)
  const ap = plain.moments.filter((m) => m.kind === 'handover').map((m) => m.approvers[0])
  assert.deepEqual(ap.map((a) => [a.who, a.device, a.seal, a.evidence]), [[null, null, 'valid', undefined], [null, null, 'valid', undefined]])
  ok('by default the page holds no word of the person, no reply, no question, no name, no computer, no chat number, no tool input or output, no local path')

  // ── what is switched on comes in, and only that ──────────────────────────────────────
  const withWords = text(make({ prompts: true }))
  for (const m of ['MARK-PROMPT', 'MARK-REPLY', 'MARK-QUESTION', 'MARK-OPTION', 'MARK-REASON', 'MARK-MEMORY']) assert.equal(withWords.includes(m), true, m + ' should be in')
  for (const m of ['MARK-NAME', 'MARK-DEVICE', 'ZXCHATID', 'MARK-TOOL-INPUT', 'MARK-TOOL-OUTPUT', 'MARK-PATH']) assert.equal(withWords.includes(m), false, m + ' leaked with the words only')
  const named = text(make({ names: true }))
  assert.equal(named.includes('MARK-NAME'), true)
  assert.equal(named.includes('MARK-DEVICE'), false)
  const machine = text(make({ computers: true, chatId: true }))
  assert.equal(machine.includes('MARK-DEVICE'), true)
  assert.equal(machine.includes('ZXCHATID'), true)
  assert.equal(machine.includes('MARK-NAME'), false)
  const nothing = text(make({ approvers: false, deliverables: false, timing: false }))
  assert.equal(nothing.includes('MARK-LINK'), false)
  assert.equal(nothing.includes('offer.pdf'), false)
  assert.equal(make({ approvers: false }).moments.filter((m) => m.kind === 'handover').every((m) => m.approvers.length === 0), true)
  const calm = make({ timing: false })
  assert.equal(calm.stats.activeMs, null)
  assert.equal(calm.moments.every((m) => m.durMs === undefined && m.endAt === undefined), true)
  ok('each switch brings in its own thing and nothing else; without durations there are no durations; without deliverables no file and no link; without decisions no approver')

  // ── by whitelist: a field nobody named never reaches the page ────────────────────────
  const dirty = JSON.parse(JSON.stringify(story))
  dirty.secretField = 'MARK-SECRET-TOP'
  for (const m of dirty.moments) { m.secretField = 'MARK-SECRET-MOMENT'; m.input = 'MARK-SECRET-INPUT'; m.output = 'MARK-SECRET-OUTPUT'; m.error = 'MARK-SECRET-ERROR'; if (m.approvers) m.approvers.forEach((a) => { a.secretField = 'MARK-SECRET-APPROVER' }) }
  dirty.crews.forEach((c) => { c.secretField = 'MARK-SECRET-CREW' })
  const dirtyText = text(journalDocument({ story: dirty, include: { prompts: true, names: true, computers: true, chatId: true, verify: true }, lang: 'en', seal: sealInfo, evidence: evidence, made: '2026-11-02' }))
  assert.equal(dirtyText.includes('MARK-SECRET'), false)
  assert.equal(journalDocument({ story: null }), null)
  assert.equal(journalDocument({ story: { moments: 3 } }), null)
  ok('a field of the story that the page does not name never reaches it (tool input, output, error, anything new)')

  // ── logos and links ──────────────────────────────────────────────────────────────────
  const svg = '<svg viewBox="0 0 10 10"><rect width="10" height="10" fill="#d33"/></svg>'
  const uri = logoUri(svg)
  assert.match(uri, /^data:image\/svg\+xml;base64,/)
  assert.match(Buffer.from(uri.split(',')[1], 'base64').toString(), /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
  for (const bad of [null, 5, '', '<svg></svg>', '<div>x</div>', '<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>', '<svg viewBox="0 0 1 1" onload="x()"><rect/></svg>', '<svg viewBox="0 0 1 1"><foreignObject/></svg>', '<svg viewBox="0 0 1 1"><a href="javascript:x"/></svg>', '<svg>' + 'x'.repeat(31000) + '</svg>']) assert.equal(logoUri(bad), null)
  const logoDoc = make({}, { logos: { gmail: svg, 'not-a-connector-of-this-chat': svg } })
  assert.deepEqual(Object.keys(logoDoc.logos), ['gmail'])
  const linkStory = JSON.parse(JSON.stringify(story))
  linkStory.deliverables.push({ kind: 'link', url: 'javascript:alert(1)', name: 'bad' }, { kind: 'link', url: 'data:text/html,<b>', name: 'bad2' }, { kind: 'link', url: 'https://ok.example/path', name: 'ok.example' })
  const linkDoc = journalDocument({ story: linkStory, include: {}, lang: 'en', made: '2026-11-02' })
  assert.deepEqual(linkDoc.deliverables.filter((d) => d.kind === 'link').map((d) => d.url).sort(), ['https://example.com/MARK-LINK', 'https://ok.example/path'].sort())
  ok('a logo is kept only for a connector of this chat, and only if it is a plain SVG; only http(s) links are kept')

  // ── the page cannot be turned into code ──────────────────────────────────────────────
  const hostile = JSON.parse(JSON.stringify(story))
  hostile.chat.title = '</script><img src=x onerror=alert(1)><!--'
  hostile.moments.forEach((m) => { if (m.kind === 'message' || m.kind === 'reply') m.text = '</script><script>alert(1)</script> <!--' })
  const hostileDoc = journalDocument({ story: hostile, include: { prompts: true }, lang: 'en', made: '2026-11-02' })
  const page = journalPageHtml(hostileDoc)
  assert.equal(page.html.split('<script').length - 1, 2, 'exactly two script elements: the data and the viewer')
  assert.equal(page.html.includes('</script><img'), false)
  assert.equal(/<script>alert|<img src=x/.test(page.html), false)
  const script = viewerScript()
  const css = viewerCss()
  const hash = (t) => "'sha256-" + createHash('sha256').update(t, 'utf8').digest('base64') + "'"
  assert.ok(page.policy.includes('script-src ' + hash(script)))
  assert.ok(page.policy.includes('style-src ' + hash(css)))
  assert.ok(page.html.includes('<script>' + script + '</script>') && page.html.includes('<style>' + css + '</style>'))
  assert.equal(/unsafe-inline|unsafe-eval|\*/.test(page.policy), false)
  for (const d of ["default-src 'none'", "connect-src 'none'", 'img-src data:', "base-uri 'none'", "form-action 'none'"]) assert.ok(page.policy.includes(d), d)
  assert.ok(page.html.includes('http-equiv="Content-Security-Policy"'))
  assert.equal(/\binnerHTML\b|\binsertAdjacentHTML\b|\bdocument\.write\b|\beval\(|new Function|XMLHttpRequest|\.src\s*=|location\s*=|\bimport\(/.test(script), false, 'the viewer builds text nodes and shapes only')
  assert.equal(script.split('fetch(').length - 1, 1, 'one request only: the document of a link, from the same site')
  assert.ok(/fetch\(url, \{ credentials: 'omit', referrerPolicy: 'no-referrer'/.test(script), 'sent with no credentials and no referrer')
  assert.equal(/https?:\/\/(?!www\.w3\.org)/.test(script + css), false, 'nothing is loaded from anywhere')
  ok('a hostile title or message cannot end the data block or start a script; the policy pins the script and the style by hash, allows no inline code and no request; the viewer holds no way to make HTML')

  // ── the viewer, run on a minimal DOM ─────────────────────────────────────────────────
  const run = async (doc, opts = {}) => {
    class Txt { constructor (t) { this.t = t; this.parent = null } }
    class Node {
      constructor (tag) { this.tag = tag; this.kids = []; this.attrs = {}; this.parent = null; this.on = {} }
      get className () { return this.attrs.class || '' }
      set className (v) { this.attrs.class = String(v) }
      appendChild (k) { k.parent = this; this.kids.push(k); return k }
      removeChild (k) { this.kids = this.kids.filter((x) => x !== k); k.parent = null; return k }
      get firstChild () { return this.kids.length > 0 ? this.kids[0] : null }
      focus () {}
      setAttribute (k, val) { this.attrs[k] = String(val) }
      getAttribute (k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null }
      addEventListener (t, f) { this.on[t] = f }
      remove () { if (this.parent) this.parent.kids = this.parent.kids.filter((x) => x !== this) }
      set textContent (val) { this.kids = [new Txt(String(val))] }
      get textContent () { return textOf(this) }
      querySelector (sel) { const parts = sel.split(' ').map((p) => p.replace(/^\./, '')); return find(this, parts) }
    }
    const textOf = (n) => (n instanceof Txt ? n.t : n.kids.map(textOf).join(' '))
    const classes = (n) => (n instanceof Node ? n.className.split(/\s+/) : [])
    const find = (n, parts) => {
      if (!(n instanceof Node)) return null
      if (parts.length > 0 && classes(n).includes(parts[0])) {
        if (parts.length === 1) return n
        for (const k of n.kids) { const f = find(k, parts.slice(1)); if (f !== null) return f }
      }
      for (const k of n.kids) { const f = find(k, parts); if (f !== null) return f }
      return null
    }
    const all = (n, out = []) => { if (n instanceof Node) { out.push(n); n.kids.forEach((k) => all(k, out)) } return out }
    const root = new Node('div')
    const fake = {
      getElementById: (id) => (id === 'kj-doc' && opts.served === undefined ? { textContent: JSON.stringify(doc) } : (id === 'kj-root' ? root : (id === 'kj-lock' && opts.served !== undefined ? { textContent: JSON.stringify(LOCK_LABELS) } : null))),
      createElement: (t) => new Node(t), createElementNS: (ns, t) => new Node(t), createTextNode: (t) => new Txt(String(t)), title: '', documentElement: { lang: '' },
    }
    const asked = []
    const served = opts.served
    const fetchFake = served === undefined ? undefined : async (url, init) => { asked.push([url, init]); const r = served(url); return { ok: r !== null, status: r === null ? 404 : 200, json: async () => JSON.parse(r) } }
    const sandbox = { document: fake, window: { crypto: webcrypto }, crypto: webcrypto, atob: (t) => Buffer.from(t, 'base64').toString('binary'), btoa: (t) => Buffer.from(t, 'binary').toString('base64'), TextEncoder: TextEncoder, TextDecoder: TextDecoder, URL: URL, Uint8Array: Uint8Array, Intl: Intl, Promise: Promise, Error: Error, JSON: JSON, String: String, navigator: { language: opts.language || 'en' }, location: { pathname: '/s/abc/' }, fetch: fetchFake }
    vm.runInNewContext(viewerScript(), sandbox)
    await new Promise((r) => setTimeout(r, 120))
    const submit = async (password) => {
      const form = all(root).find((n) => n.tag === 'form')
      const input = all(root).find((n) => n.tag === 'input')
      input.value = password
      form.on.submit({ preventDefault () {} })
      for (let i = 0; i < 60; i += 1) { await new Promise((r) => setTimeout(r, 100)); if (all(root).some((n) => n.tag === 'form') === false || /Wrong password|Mot de passe incorrect|cannot be opened/.test(textOf(root))) break }
      return { text: textOf(root), nodes: all(root), pills: all(root).filter((n) => classes(n).includes('kj-pill')).map((n) => textOf(n)) }
    }
    return { asked: asked, doc: fake, submit: submit, root: root, text: textOf(root), nodes: all(root), pills: all(root).filter((n) => classes(n).includes('kj-pill')).map((n) => textOf(n)), find: (sel) => root.querySelector(sel) }
  }

  const shown = await run(make({}))
  assert.ok(shown.text.includes('Recruiter research') && shown.text.includes('Gmail') && shown.text.includes('Story of this chat') && shown.text.includes('offer.pdf'))
  assert.ok(shown.text.includes('Text not included'))
  for (const m of ['MARK-PROMPT', 'MARK-NAME', 'MARK-DEVICE', 'ZXCHATID', 'MARK-TOOL']) assert.equal(shown.text.includes(m), false, m)
  assert.ok(shown.pills.includes('Sealed'), 'sealed decisions say so (checked on the author\'s computer)')
  const links = shown.nodes.filter((n) => n.tag === 'a')
  assert.ok(links.length >= 1 && links.every((a) => /^https?:/.test(a.getAttribute('href')) && /noopener/.test(a.getAttribute('rel'))))
  assert.equal(shown.nodes.filter((n) => n.tag === 'script' || n.tag === 'iframe').length, 0)
  const fr = await run(make({}, { lang: 'fr' }))
  assert.ok(fr.text.includes('Histoire de ce chat') && fr.text.includes('Équipes'))
  ok('the page draws the story, the crews, the connectors and the deliverables from the document; what was kept back is not on it; links are http(s) with no opener; French when asked')

  // ── seals checked by the reader ──────────────────────────────────────────────────────
  const verifiable = make({ verify: true, prompts: false })
  const good = await run(verifiable)
  assert.equal(good.pills.filter((p) => p === 'Checked in this browser').length, 2, good.pills.join('|'))
  assert.ok(good.text.includes('MARK-NAME Amira') && good.text.includes('MARK-DEVICE MacBook'))
  assert.ok(good.text.includes('2 / 2'))
  const edit = (fn) => { const d = JSON.parse(JSON.stringify(verifiable)); fn(d); return d }
  const handovers = (d) => d.moments.filter((m) => m.kind === 'handover')
  assert.ok((await run(edit((d) => { handovers(d)[0].approvers[0].who = 'Someone Else' }))).pills.includes('Does not match'), 'a changed name')
  assert.ok((await run(edit((d) => { handovers(d)[0].approvers[0].state = 'denied' }))).pills.includes('Does not match'), 'a changed outcome')
  assert.ok((await run(edit((d) => { handovers(d)[1].approvers[0].at += 1 }))).pills.includes('Does not match'), 'a changed time')
  assert.ok((await run(edit((d) => { handovers(d)[0].approvers[0].evidence.sig = handovers(d)[1].approvers[0].evidence.sig }))).pills.includes('Does not match'), 'a signature from another decision')
  assert.ok((await run(edit((d) => { d.chat.id = 'session-someotherchat' }))).pills.includes('Does not match'), 'another chat')
  const otherKey = loadSealKey(join(dir, 'other.json'), { create: true })
  assert.ok((await run(edit((d) => { d.seal.publicKey = otherKey.publicKey }))).pills.includes('Does not match'), 'another key')
  const quiet = await run(make({}))
  assert.equal(quiet.pills.includes('Checked in this browser'), false)
  ok('a reader\'s browser checks each seal against the key in the page: a changed name, outcome, time, chat, signature or key is « Does not match »')
  assert.match(pageFileName(verifiable), /^journal-ZXCHATID-2026-11-02\.html$/)
  assert.equal(pageFileName(plain), 'journal-2026-11-02.html')
  ok('the file is named journal-<day>.html, with the chat number only when it is shared')

  // ── the page a server serves at a link ───────────────────────────────────────────────
  const served = journalViewerHtml()
  const again = journalViewerHtml()
  assert.equal(served.html, again.html, 'the same bytes every time: the server pins them')
  assert.ok(served.policy.includes("connect-src 'self'") && served.policy.includes('img-src data:') && served.policy.includes("default-src 'none'"))
  assert.equal(/unsafe-inline|unsafe-eval|\*/.test(served.policy), false)
  assert.ok(served.policy.includes("script-src 'sha256-" + createHash('sha256').update(viewerScript(), 'utf8').digest('base64')) && served.html.includes('<script>' + viewerScript() + '</script>'))
  assert.equal(served.html.includes('id="kj-doc"'), false, 'no document inside a page that is served for every link')
  assert.equal(served.html.split('<script').length - 1, 2, 'the words of the lock screen, and the viewer')
  assert.equal(journalViewerHtml({ docPath: '/s/abc.json' }).html.includes('data-doc="/s/abc.json"'), true)
  const mine = (name) => new RegExp('^(?:async\\s+)?(?:function\\*?|class|const|let|var)\\s+' + name + '\\b', 'mu')
  for (const name of ['SealError', 'openSealed', 'toB64u', 'fromB64u', 'isSealed']) assert.equal((viewerScript().match(mine(name)) || []).length + (viewerScript().match(new RegExp('^\\s+function\\s+' + name + '\\b', 'mu')) || []).length, 1, name + ' is declared once in the page script')
  ok('the served page is the same bytes every time, holds no document, allows one request to its own site and data images, and declares the seal code once')

  const doc = make({})
  const envelope = await sealText(JSON.stringify(doc), 'correct horse battery', { iterations: 100000 })
  const link = await run(null, { served: (url) => (url === '/s/abc.json' ? JSON.stringify(doc) : null) })
  assert.deepEqual(link.asked.map((a) => a[0]), ['/s/abc.json'], 'it asks for the address of the page plus .json')
  assert.equal(link.asked[0][1].credentials, 'omit')
  assert.ok(link.text.includes('Story of this chat') && link.text.includes('Recruiter research'), 'an open link draws the Journal')
  assert.equal(link.doc.documentElement.lang, 'en')
  const lock = await run(null, { served: () => JSON.stringify(envelope) })
  assert.ok(lock.text.includes('Protected journal'), 'the lock screen')
  assert.equal(lock.text.includes('Story of this chat'), false, 'nothing of the Journal before the password')
  assert.equal(lock.text.includes('Recruiter research') || lock.text.includes('Gmail'), false)
  const wrong = await lock.submit('not the password at all')
  assert.ok(wrong.text.includes('Wrong password'), 'a wrong password asks again')
  assert.equal(wrong.text.includes('Story of this chat'), false)
  const right = await (await run(null, { served: () => JSON.stringify(envelope) })).submit('correct horse battery')
  assert.ok(right.text.includes('Story of this chat') && right.text.includes('Recruiter research'), 'the right password opens it')
  const lockFr = await run(null, { served: () => JSON.stringify(envelope), language: 'fr-FR' })
  assert.ok(lockFr.text.includes('Journal protégé'), 'the lock screen follows the browser language')
  const gone = await run(null, { served: () => null })
  assert.ok(gone.text.includes('could not be loaded') && gone.text.includes('removed') && gone.text.includes('Story of this chat') === false, 'a link that is gone says so')
  const alien = await run(null, { served: () => JSON.stringify({ kind: 'kybernos-snapshot', version: 1, widgets: [] }) })
  assert.ok(alien.text.includes('cannot be shown'), 'a document this page does not know is not drawn')
  ok('a link: an open one draws, a protected one shows only a lock until the right password, a wrong one asks again, a gone one and a foreign document say so, French when the browser is')
} finally {
  rmSync(dir, { recursive: true, force: true })
}

console.log('\n' + pass + ' groups passed')
