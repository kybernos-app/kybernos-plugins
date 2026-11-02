#!/usr/bin/env node
/** The Journal as a link (journal-link.mjs): the verbs and the local record, against an in-memory stand-in for the `snapshots` seam of the cloud bundle.
 *  Usage: node packages/kybernos-plugin/test-journal-link.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createJournalLinks, linksFile } from './journal-link.mjs'
import { openSealed } from './vendor/share-seal.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

const dir = mkdtempSync(join(tmpdir(), 'kb-journal-link-'))
const SESSION = 'session-9ac99113-3d9e-4a8a-8a14-d9a49025473c'
const DOC = { kind: 'kybernos-journal', version: 1, made: '2026-11-02', title: null, moments: [{ id: 'm1', kind: 'reply', text: 'MARK-DOC-TEXT' }] }

// the seam, as the server behaves behind it
let ids = 0
const server = { links: new Map(), calls: [], available: true, error: null, maxBytes: 1000000, putError: null }
const seam = {
  status: async () => {
    server.calls.push('status')
    if (server.error !== null) return { ok: false, available: false, error: server.error }
    return { ok: true, available: server.available, allowed: server.available, maxBytes: server.maxBytes, maxCount: 20, ttlDays: 90, count: server.links.size, links: [...server.links.values()].map((l) => ({ id: l.id, url: l.url, expires: l.expires, sealed: l.sealed, doc: l.doc })) }
  },
  put: async (input) => {
    server.calls.push('put')
    if (server.putError !== null) return { ok: false, error: server.putError, message: 'said by the server' }
    if (input.id !== undefined) {
      const l = server.links.get(input.id)
      if (l === undefined) return { ok: false, error: 'not_found', message: '' }
      Object.assign(l, { text: input.text, sealed: input.sealed, expires: '2027-02-01T00:00:00.000Z' })
      return { ok: true, id: l.id, url: l.url, expires: l.expires, bytes: input.text.length }
    }
    ids += 1
    const id = 'abcdefghijklmn' + String(10 + ids)
    const l = { id: id, url: 'https://kaby.app/s/' + id, expires: '2027-01-30T00:00:00.000Z', sealed: input.sealed, doc: input.doc, text: input.text }
    server.links.set(id, l)
    return { ok: true, id: id, url: l.url, expires: l.expires, bytes: input.text.length }
  },
  remove: async (id) => { server.calls.push('remove'); return server.links.delete(id) ? { ok: true } : { ok: false, error: 'not_found', message: '' } },
}
let theSeam = seam
const links = createJournalLinks({ dir: () => dir, seam: () => theSeam, now: () => Date.UTC(2026, 10, 2, 12) })

try {
  // ── nothing to talk to ───────────────────────────────────────────────────────────────
  theSeam = null
  let s = await links.state(SESSION)
  assert.deepEqual([s.ok, s.available, s.reason, s.link], [true, false, 'no_account', null])
  assert.equal((await links.publish({ sessionId: SESSION, doc: DOC })).error, 'no_account')
  theSeam = seam
  server.error = 'not_on_this_server'
  s = await links.state(SESSION)
  assert.deepEqual([s.available, s.reason], [false, 'not_on_this_server'])
  assert.equal((await links.publish({ sessionId: SESSION, doc: DOC })).error, 'not_on_this_server')
  server.error = 'not_connected'
  assert.equal((await links.state(SESSION)).reason, 'not_connected')
  server.error = null
  server.available = false
  assert.equal((await links.state(SESSION)).available, false)
  server.available = true
  assert.equal((await links.state('../../etc')).ok, false)
  assert.equal((await links.publish({ sessionId: 'a/b', doc: DOC })).error, 'bad_session')
  assert.equal((await links.publish({ sessionId: SESSION, doc: { kind: 'kybernos-snapshot' } })).error, 'bad_document')
  assert.equal(server.links.size, 0)
  ok('with no account, no route, no plan or a bad chat id or document: it says why, it makes no link')

  // ── a first link, protected (the default) ────────────────────────────────────────────
  s = await links.state(SESSION)
  assert.deepEqual([s.available, s.link, s.limits.maxBytes, s.limits.maxCount], [true, null, 1000000, 20])
  const made = await links.publish({ sessionId: SESSION, doc: DOC })
  assert.equal(made.ok, true, JSON.stringify(made))
  assert.equal(made.link.protected, true)
  assert.match(made.link.password, /^[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/u)
  assert.equal(made.link.url.startsWith('https://kaby.app/s/'), true)
  const onServer = [...server.links.values()][0]
  assert.equal(onServer.sealed, true)
  assert.equal(onServer.doc, 'journal')
  assert.equal(onServer.text.includes('MARK-DOC-TEXT') || onServer.text.includes('kybernos-journal'), false, 'the server holds only the envelope')
  assert.deepEqual(JSON.parse(await openSealed(JSON.parse(onServer.text), made.link.password)), DOC, 'the password opens exactly the document')
  await assert.rejects(openSealed(JSON.parse(onServer.text), 'wrong password here'))
  ok('a protected link: the server holds an envelope that only the password opens, and that opens to exactly the document')

  const file = linksFile(dir)
  assert.equal(statSync(file).mode & 0o777, 0o600)
  const rec = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(Object.keys(rec.links).length, 1)
  assert.equal(rec.links['9ac99113-3d9e-4a8a-8a14-d9a49025473c'].password, made.link.password)
  s = await links.state(SESSION)
  assert.equal(s.link.url, made.link.url)
  assert.equal(s.link.password, made.link.password)
  assert.equal(s.link.gone, false)
  assert.equal((await links.state('9ac99113-3d9e-4a8a-8a14-d9a49025473c')).link.url, made.link.url, 'session-<id> and <id> are the same chat')
  ok('the record is private (mode 600), keyed by chat, and the sheet reads the link and its password back')

  // ── an update keeps the link and the password ─────────────────────────────────────────
  const doc2 = { ...DOC, moments: [{ id: 'm1', kind: 'reply', text: 'MARK-DOC-TEXT-2' }] }
  const upd = await links.publish({ sessionId: SESSION, doc: doc2 })
  assert.equal(upd.ok, true)
  assert.equal(upd.link.url, made.link.url)
  assert.equal(upd.link.password, made.link.password)
  assert.equal(upd.link.expires, '2027-02-01T00:00:00.000Z')
  assert.equal(server.links.size, 1)
  assert.deepEqual(JSON.parse(await openSealed(JSON.parse([...server.links.values()][0].text), made.link.password)), doc2)
  ok('an update replaces the content of the same link under the same password')

  // ── not protected ────────────────────────────────────────────────────────────────────
  const open = await links.publish({ sessionId: 'session-open-chat', doc: DOC, protect: false })
  assert.equal(open.ok, true)
  assert.equal(open.link.protected, false)
  assert.equal(open.link.password, null)
  const plain = [...server.links.values()].find((l) => l.url === open.link.url)
  assert.equal(plain.sealed, false)
  assert.deepEqual(JSON.parse(plain.text), DOC)
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).links['open-chat'].password, null)
  const toOpen = await links.publish({ sessionId: SESSION, doc: DOC, protect: false })
  assert.equal(toOpen.link.url, made.link.url)
  assert.equal(toOpen.link.password, null)
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).links['9ac99113-3d9e-4a8a-8a14-d9a49025473c'].password, null, 'a password that no longer protects anything is not kept')
  ok('an open link carries the document as it is and keeps no password; switching the protection off on an update drops the password')

  // ── the server is the truth ──────────────────────────────────────────────────────────
  server.links.delete(upd.link.url.split('/').pop())
  s = await links.state(SESSION)
  assert.equal(s.link.gone, true, 'a link the server no longer lists is gone')
  assert.equal((await links.publish({ sessionId: SESSION, doc: DOC })).error, 'gone', 'an update of a gone link says so, it does not quietly make another')
  const again = await links.publish({ sessionId: SESSION, doc: DOC, fresh: true })
  assert.equal(again.ok, true)
  assert.notEqual(again.link.url, made.link.url)
  assert.notEqual(again.link.password, made.link.password, 'a new link gets a new password')
  assert.equal((await links.state(SESSION)).link.gone, false)
  server.putError = 'snapshot_limit'
  const full = await links.publish({ sessionId: 'session-other-chat', doc: DOC })
  assert.deepEqual([full.ok, full.error, full.message], [false, 'snapshot_limit', 'said by the server'])
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).links['other-chat'], undefined, 'a refused link is not recorded')
  server.putError = null
  ok('a link the server forgot is shown as gone and is not silently replaced; a new one is a choice; the server\'s refusals pass through and leave no record')

  // ── too big ──────────────────────────────────────────────────────────────────────────
  server.maxBytes = 100
  const calls = server.calls.length
  const big = await links.publish({ sessionId: 'session-big-chat', doc: DOC, protect: false })
  assert.deepEqual([big.ok, big.error, big.maxBytes > 0, big.bytes > big.maxBytes], [false, 'too_big', true, true])
  assert.equal(server.calls.slice(calls).includes('put'), false, 'checked before anything is sent')
  server.maxBytes = 1000000
  ok('a document over the server\'s limit is refused here, before anything is sent')

  // ── taking it down ───────────────────────────────────────────────────────────────────
  const sizeBefore = server.links.size
  assert.deepEqual(await links.remove({ sessionId: 'session-open-chat' }), { ok: true, removed: true })
  assert.equal(server.links.size, sizeBefore - 1)
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).links['open-chat'], undefined)
  assert.deepEqual(await links.remove({ sessionId: 'session-open-chat' }), { ok: true, removed: false }, 'nothing recorded: nothing to do')
  server.links.clear()
  assert.deepEqual(await links.remove({ sessionId: SESSION }), { ok: true, removed: true }, 'already gone on the server: done')
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).links['9ac99113-3d9e-4a8a-8a14-d9a49025473c'], undefined)
  await links.publish({ sessionId: 'session-keep-chat', doc: DOC })
  theSeam = null
  assert.equal((await links.remove({ sessionId: 'session-keep-chat' })).ok, false)
  assert.ok(JSON.parse(readFileSync(file, 'utf8')).links['keep-chat'], 'a link that could not be taken down stays recorded')
  theSeam = seam
  ok('removing takes the link down on the server and forgets it; one already gone is done; one that could not be reached stays recorded')

  // ── a damaged record ─────────────────────────────────────────────────────────────────
  writeFileSync(file, '{ not json')
  s = await links.state(SESSION)
  assert.deepEqual([s.ok, s.link], [true, null])
  assert.equal((await links.publish({ sessionId: SESSION, doc: DOC })).ok, true)
  ok('a damaged record reads as empty and is rewritten by the next link')
} finally {
  rmSync(dir, { recursive: true, force: true })
}

console.log('\n' + pass + ' groups passed')
