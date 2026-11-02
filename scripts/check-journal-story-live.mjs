#!/usr/bin/env node
// The Journal tab of a chat (Story, Flow, Advanced) on the real GUI, in a throw-away signed-in Chrome.
//
//   node scripts/check-journal-story-live.mjs [--demo] [--real] [--log <session.v4.jsonl.zstd>] [--shots <dir>]
//
// Without --real the host half is not needed: `/kybernos/journal` is answered inside the throw-away browser with the story derived (by journal-story.mjs, this checkout)
// from one of the person's own chat logs (read only: the richest of the latest ones, or --log), and the browser half is this checkout's client.js (lib-bundle-swap.mjs).
// --demo plays a made-up chat instead (two crews, connectors with an error, a waiting question, approvals, links): what a real chat rarely holds all at once.
// So the page can be seen BEFORE the host restarts. With --real the route of the running DSH answers (the check after a restart). Nothing is written to the DSH.
//
// What it presses: the Journal tab, Story, Flow, Advanced, Story again, the filters, a crew card, a row, « Show more », the Insights switch, a node of the flow.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { deriveStory } from '../packages/kybernos-plugin/journal-story.mjs'
import { createRecorder, readDecisions } from '../packages/kybernos-plugin/journal-decisions.mjs'
import { loadSealKey, sealEvidence, verifyDecisions } from '../packages/kybernos-plugin/journal-seal.mjs'
import { journalDocument, journalPageHtml, pageFileName } from '../packages/kybernos-plugin/journal-page.mjs'
import { createJournalLinks } from '../packages/kybernos-plugin/journal-link.mjs'
import { openSealed } from '../packages/kybernos-plugin/vendored-share-seal.mjs'
import { openLivePage, waitFor } from './live-page.mjs'
import { swapBundles } from './lib-bundle-swap.mjs'

const argv = process.argv.slice(2)
const flag = (name) => argv.indexOf(name) >= 0
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null }
const REAL = flag('--real')
const DEMO = flag('--demo')
const SHOTS = opt('--shots') ? resolve(opt('--shots')) : null
if (SHOTS !== null) mkdirSync(SHOTS, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let failed = 0
const ok = (label, cond, more) => { if (cond) console.log('  ok   ' + label); else { failed += 1; console.log('  FAIL ' + label + (more === undefined ? '' : ' — ' + more)) } }

/** The events of a chat's log: one JSON per line, the first line being the session header. The file is several zstd frames, one per append: the `zstd` tool reads them all. */
const readLog = (file) => execFileSync('zstd', ['-dc', file], { maxBuffer: 512 * 1024 * 1024 }).toString('utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l)).filter((e) => e.type !== 'session')

/** The latest logs, each scored by what the Journal has to show (connectors, crews, handovers, outputs); the richest wins. */
const pickLog = () => {
  const root = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'sessions')
  const files = []
  for (const slug of readdirSync(root)) {
    let dirs = []
    try { dirs = readdirSync(join(root, slug)) } catch (e) { continue }
    for (const d of dirs) {
      const f = join(root, slug, d, 'session.v4.jsonl.zstd')
      try { files.push({ f, t: statSync(f).mtimeMs, size: statSync(f).size }) } catch (e) { /* not a chat folder */ }
    }
  }
  files.sort((a, b) => b.t - a.t)
  let best = null
  for (const c of files.slice(0, 40)) {
    if (c.size > 6_000_000) continue
    let events = []
    try { events = readLog(c.f) } catch (e) { continue }
    let score = 0
    const kinds = {}
    for (const e of events) {
      if (e.type === 'approval/asked' || e.type === 'deliverables/presented') score += 5
      if (e.type === 'tool/call') {
        const n = String((e.data && e.data.name) || '')
        if (/^[A-Z][A-Z0-9]+_[A-Z0-9_]+$/.test(n) || n.indexOf('mcp__') === 0) score += 2
        kinds[n] = 1
      }
    }
    score += Object.keys(kinds).length
    if (best === null || score > best.score) best = { f: c.f, score: score, events: events }
  }
  return best
}

const flatCost = (provider, model, usage) => {
  if (usage === null || usage === undefined) return null
  return ((Number(usage.input) || 0) * 3 + (Number(usage.output) || 0) * 15) / 1e6 * 0.92
}


/** A made-up chat that holds every kind of moment, built with the event shapes the engine writes (see test-journal-story.mjs). */
const demoStory = () => {
  const MIN = 60_000
  const T0 = Date.now() - 3 * 60 * MIN
  let seq = 0
  const ev = (type, at, data) => { seq += 1; return { type, seq, time: T0 + at * MIN, data } }
  const user = (at, text, source) => ev('user/message', at, { role: 'user', content: [{ type: 'text', text }], source })
  const call = (at, callId, name, args) => ev('tool/call', at, { turn: 1, step: 1, callId, name, arguments: JSON.stringify(args) })
  const result = (at, callId, text, isError) => ev('tool/result', at + 0.03, { turn: 1, step: 1, message: { role: 'tool', toolCallId: callId, source: { kind: 'tool', callId }, content: [{ type: 'text', text }], isError: isError === true } })
  const reply = (at, text, usage, provider, model) => ev('assistant/message', at, { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model', provider, model } }, usage })
  const events = [
    ev('turn/start', 0, { turn: 1 }),
    ev('model/selection', 0.1, { provider: 'anthropic', model: 'claude-sonnet-5-5' }),
    user(1, 'Prepare the Q4 hiring campaign: shortlist five recruiters, send the offer, book a kick-off and open a tracking issue.', { kind: 'user', rpcId: 'kb-task-weekly-hiring' }),
    reply(2, 'Plan: research recruiters, draft the offer, then send and schedule.', { inputTokens: 2400, outputTokens: 300, cacheReadTokens: 1800 }, 'anthropic', 'claude-sonnet-5-5'),
    call(3, 'k1', 'skill', { name: 'hiring-campaign' }), result(3.1, 'k1', '<skill_content name="hiring-campaign">…'),
    call(4, 'k2', 'memory_search', { query: 'preferred recruiters' }), result(4.1, 'k2', '3 notes'),
    call(5, 'k3', 'bash', { command: 'ls offers' }), result(5.1, 'k3', 'a.md b.md'), call(5.2, 'k4', 'read', { path: '/work/offers/a.md' }), result(5.3, 'k4', 'text'),
    call(6, 'k5', 'edit', { path: '/work/offers/a.md' }), result(6.1, 'k5', 'Error: no match', true), call(6.2, 'k6', 'edit', { path: '/work/offers/a.md' }), result(6.3, 'k6', 'ok'),
    call(12, 'g1', 'GMAIL_SEND_EMAIL', { to: 'talent@example.com' }), result(12.1, 'g1', 'HTTP 429 rate limit', true),
    call(13, 'g2', 'GMAIL_SEND_EMAIL', { to: 'talent@example.com' }), result(13.2, 'g2', 'Sent. See https://mail.google.com/mail/u/0/#sent/abc.'),
    call(14, 'g3', 'GMAIL_SEND_EMAIL', { to: 'hr@example.com' }), result(14.3, 'g3', 'Sent.'),
    call(15, 's1', 'SLACK_SEND_MESSAGE', { channel: '#hiring' }), result(15.1, 's1', 'Posted'),
    call(16, 'n1', 'NOTION_CREATE_PAGE', { title: 'Q4 hiring' }), result(16.5, 'n1', 'Created https://www.notion.so/q4-hiring-123'),
    call(17, 'c1', 'GOOGLECALENDAR_CREATE_EVENT', { summary: 'Kick-off' }), result(17.4, 'c1', 'Event created https://calendar.google.com/event?eid=xyz'),
    call(20, 'q1', 'ask_user_question', { questions: [{ header: 'Go?', id: 'go', question: 'Send the offer to the five shortlisted recruiters?', options: [{ label: 'Send' }, { label: 'Wait' }] }] }),
    result(24, 'q1', JSON.stringify({ answers: [{ id: 'go', selected: ['Send'], custom: null }] })),
    ev('approval/asked', 25, { id: 'ap1', toolName: 'bash', callId: 'b9', reason: 'Delete the draft folder offers/old' }),
    ev('approval/decided', 26, { id: 'ap1', outcome: 'allowed-once' }),
    ev('approval/asked', 27, { id: 'ap2', toolName: 'bash', callId: 'b10', reason: 'Send a bulk mail to 4,000 people' }),
    ev('approval/decided', 27.5, { id: 'ap2', outcome: 'denied' }),
    call(30, 'g4', 'GITHUB_CREATE_ISSUE', { repo: 'acme/hiring', title: 'Q4 tracking' }), result(30.2, 'g4', 'HTTP 403: resource not accessible by integration', true),
    call(31, 'p1', 'present', { files: [{ path: '/work/offers/offer.pdf', description: 'The offer letter' }, { path: '/work/offers/plan.html', description: 'Campaign plan' }] }), result(31.1, 'p1', 'Presented'),
    ev('deliverables/presented', 31.1, { turn: 1, callId: 'p1', files: [{ path: '/work/offers/offer.pdf', description: 'The offer letter' }, { path: '/work/offers/plan.html', description: 'Campaign plan' }] }),
    reply(32, 'Offer sent to three of five; the issue could not be opened (no access).', { inputTokens: 18000, outputTokens: 900, cacheReadTokens: 12000 }, 'zai', 'glm-5.3'),
    call(40, 'q2', 'ask_user_question', { questions: [{ header: 'Next', id: 'nx', question: 'Which recruiter should get the follow-up call?', options: [{ label: 'Anna' }, { label: 'Marc' }] }] }),
  ]
  const crew = (id, name, a, b, members, failed) => ({ runId: id, name, startedAt: T0 + a * MIN, endedAt: b === null ? null : T0 + b * MIN, declaredFrom: 'agent-team', stopReason: failed > 0 ? 'failed' : 'completed', totals: { durationMs: b === null ? null : (b - a) * MIN, tokens: 52000, costEur: 0.41, failed }, members })
  const mem = (label, phase, outcome, d, provider, model, tokens, costEur) => ({ label, phase, outcome, durationMs: d * MIN, childId: 'session-' + label, actual: { provider, model, tokens, costEur } })
  const runs = [
    crew('r1', 'Recruiter research', 7, 11.5, [mem('scout', 'research', 'done', 3, 'zai', 'glm-5.3', 30000, 0.21), mem('checker', 'review', 'done', 1.5, 'anthropic', 'claude-sonnet-5-5', 22000, 0.2)], 0),
    crew('r2', 'Offer drafting', 17.5, 29, [mem('writer', 'draft', 'done', 6, 'anthropic', 'claude-sonnet-5-5', 40000, 0.52), mem('legal', 'review', 'failed', 2, 'zai', 'glm-5.3', 9000, 0.03)], 1),
    crew('r3', 'Follow-up calls', 33, null, [mem('caller', 'plan', 'running', 0, 'zai', 'glm-5.3', 2000, 0.01)], 0),
  ]
  const costOf = (provider, model, usage) => ((usage.input * 3 + usage.output * 15) / 1e6) * 0.92
  // The host's record of who decided, made by the real recorder with a throw-away key: two people of the company on two computers. Afterwards someone edits the name on the refusal in
  // the record: its seal breaks (the other two stay sealed).
  const dir = mkdtempSync(join(tmpdir(), 'kb-journal-demo-'))
  try {
    const key = loadSealKey(join(dir, 'key.json'), { create: true })
    let person = { by: 'Amira Benali', device: 'MacBook Pro de Amira' }
    const recorder = createRecorder({ dir: join(dir, 'decisions'), who: () => person, seal: () => key })
    for (const e of events) {
      if (e.type === 'approval/decided' && e.data.id === 'ap2') person = { by: 'Karim Haddad', device: 'Mac mini du bureau' }
      recorder.ingest('session-demo-journal', e)
    }
    const decisions = readDecisions(join(dir, 'decisions'), 'session-demo-journal')
    decisions['a:ap2'].by = 'K. Haddad'
    const seals = verifyDecisions(events, decisions, 'session-demo-journal', key)
    return {
      story: deriveStory(events, { sessionId: 'session-demo-journal', runs, costOf, decisions, seals }),
      seal: { alg: 'ed25519', keyId: key.keyId, publicKey: key.publicKey },
      evidence: sealEvidence(events, decisions, 'session-demo-journal', key),
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

// The server half of the Journal link, in memory, behind the real verbs of journal-link.mjs: what the host does, with a stand-in for the cloud bundle's `snapshots` seam.
const makeLinkServer = () => {
  const dir = mkdtempSync(join(tmpdir(), 'kb-journal-links-'))
  const server = { mode: 'absent', links: new Map(), n: 0 }
  const seam = {
    status: async () => (server.mode === 'absent'
      ? { ok: false, available: false, error: 'not_on_this_server' }
      : { ok: true, available: true, allowed: true, maxBytes: 1000000, maxCount: 20, ttlDays: 90, count: server.links.size, links: [...server.links.values()].map((l) => ({ id: l.id, url: l.url, expires: l.expires, sealed: l.sealed, doc: l.doc })) }),
    put: async (input) => {
      if (input.id !== undefined) {
        const l = server.links.get(input.id)
        if (l === undefined) return { ok: false, error: 'not_found', message: '' }
        Object.assign(l, { text: input.text, sealed: input.sealed })
        return { ok: true, id: l.id, url: l.url, expires: l.expires, bytes: input.text.length }
      }
      server.n += 1
      const id = 'kjlinkcheck' + String.fromCharCode(96 + server.n).repeat(5)
      const l = { id: id, url: 'https://kaby.app/s/' + id, expires: '2027-01-30T00:00:00.000Z', sealed: input.sealed, doc: input.doc, text: input.text }
      server.links.set(id, l)
      return { ok: true, id: id, url: l.url, expires: l.expires, bytes: input.text.length }
    },
    remove: async (id) => (server.links.delete(id) ? { ok: true } : { ok: false, error: 'not_found', message: '' }),
  }
  server.verbs = createJournalLinks({ dir: dir, seam: () => seam })
  server.done = () => rmSync(dir, { recursive: true, force: true })
  return server
}

const run = async () => {
  let fake = null
  const linkServer = DEMO ? makeLinkServer() : null
  if (DEMO) {
    const demo = demoStory()
    fake = { ok: true, notes: [], story: demo.story, seal: demo.seal, evidence: demo.evidence }
    console.log('story: the made-up chat, ' + fake.story.moments.length + ' moments')
  } else if (REAL === false) {
    const picked = opt('--log') ? { f: resolve(opt('--log')), events: readLog(resolve(opt('--log'))) } : pickLog()
    if (picked === null) throw new Error('no chat log found under ~/.dsh/sessions')
    fake = { ok: true, notes: [], story: deriveStory(picked.events, { sessionId: 'session-live-check', runs: [], costOf: flatCost }) }
    console.log('story from one chat log: ' + fake.story.moments.length + ' moments, ' + fake.story.chat.id)
  }
  const live = await openLivePage()
  const { page } = live
  try {
    if (fake !== null) {
      page.on('Fetch.requestPaused', async (p) => {
        if (p.responseStatusCode !== undefined || String(p.request.url).indexOf('/kybernos/journal') < 0) return
        try {
          let payload = fake
          if (linkServer !== null && String(p.request.url).indexOf('/kybernos/journal/link') >= 0) {
            let body = {}
            try { body = JSON.parse(p.request.postData || '{}') } catch (e) { body = {} }
            if (body.action === 'state') payload = await linkServer.verbs.state(body.sessionId)
            else if (body.action === 'remove') payload = await linkServer.verbs.remove({ sessionId: body.sessionId })
            else {
              const doc = journalDocument({ story: fake.story, include: body.include, lang: body.lang, logos: body.logos, seal: fake.seal, evidence: fake.evidence, made: '2026-11-02' })
              payload = await linkServer.verbs.publish({ sessionId: body.sessionId, doc: doc, protect: body.protect !== false, fresh: body.fresh === true })
            }
          } else if (String(p.request.url).indexOf('/kybernos/journal/page') >= 0) {
            // The page route of the host, answered here with the same builder (journal-page.mjs): what the browser sends is what the document is made from.
            let body = {}
            try { body = JSON.parse(p.request.postData || '{}') } catch (e) { body = {} }
            const doc = journalDocument({ story: fake.story, include: body.include, lang: body.lang, logos: body.logos, seal: fake.seal, evidence: fake.evidence, made: '2026-11-02' })
            payload = doc === null ? { ok: false } : { ok: true, name: pageFileName(doc), html: journalPageHtml(doc).html }
          }
          await page.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: Buffer.from(JSON.stringify(payload)).toString('base64') })
        } catch (e) { /* page gone */ }
      })
    }
    let pageOne = null
    let pageTwo = null
    const swap = await swapBundles(page, [{ name: 'kybernos-plugin' }], { extraPatterns: fake !== null ? [{ urlPattern: '*/kybernos/journal*', requestStage: 'Request' }] : [] })
    // The chat header is folded by default and hides the Journal tab: unfold it (this throw-away browser's own storage), then reload.
    await page.evalJs(`localStorage.setItem('kybernos.chat-tools', 'open')`, 3000)
    await page.send('Page.reload', {})
    await waitFor(page, `document.querySelectorAll('[data-row-key^="session:"]').length > 0`, 30000)
    ok('this checkout\'s client is the one on the page', swap.report()[0].replaced === true, 'the shared tree has local edits of client.js? the page then runs the deployed one')
    const shot = async (name) => { if (SHOTS !== null) await page.shot(join(SHOTS, name + '.png')) }
    const click = async (sel) => {
      const r = await page.evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }) })()`, 4000)
      if (typeof r.val !== 'string') return false
      const { x, y } = JSON.parse(r.val)
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
      await sleep(350)
      return true
    }
    const clickLabel = async (label, within) => {
      const r = await page.evalJs(`(() => { const root = ${within ? JSON.stringify(within) : 'null'} ? document.querySelector(${JSON.stringify(within || '')}) : document; if (!root) return null; const e = Array.from(root.querySelectorAll('button,[role=tab]')).find((b) => (b.innerText || '').replace(/[⟦⟧]/g, '').trim().toLowerCase().indexOf(${JSON.stringify(label.toLowerCase())}) === 0); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }) })()`, 4000)
      if (typeof r.val !== 'string') return false
      const { x, y } = JSON.parse(r.val)
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
      await sleep(400)
      return true
    }
    const count = async (sel) => (await page.evalJs(`document.querySelectorAll(${JSON.stringify(sel)}).length`, 4000)).val
    const text = async (sel) => (await page.evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.innerText : '' })()`, 4000)).val || ''

    // open a chat, then its Journal tab
    // an empty « New Session » draft has no tabs: the first chat with a title of its own
    await page.evalJs(`(() => { const rows = Array.from(document.querySelectorAll('[data-row-key^="session:"]')); const e = rows.find((r) => (r.innerText || '').trim().indexOf('New Session') !== 0) || rows[0]; if (e) e.setAttribute('data-kb-check-chat', '1') })()`, 4000)
    ok('a chat is in the sidebar', await click('[data-kb-check-chat="1"]'))
    await sleep(900)
    // DSH slides the chat header (and its tab strip) out of sight while the chat is read: the tab is opened with a script click, as the product's own « open the Journal » buttons do.
    ok('the Journal tab is pressed', ((await page.evalJs(`(() => { const t = Array.from(document.querySelectorAll('[role=tab]')).find((x) => (x.innerText || '').trim() === 'Journal'); if (!t) return false; t.setAttribute('data-kb-check-tab', '1'); t.click(); return true })()`, 3000)).val) === true)
    ok('the Journal tab is the selected one', (await waitFor(page, `document.querySelector('[data-kb-check-tab="1"]') && document.querySelector('[data-kb-check-tab="1"]').getAttribute('aria-selected') === 'true'`, 6000)) !== null)
    const painted = await waitFor(page, `document.querySelector('.wvs-root, .wvs-classic') !== null`, 20000)
    ok('the Journal draws (Story shell or the classic fallback)', painted !== null)
    await sleep(900)
    await shot('1-story')
    // the story is read from the host a moment after the tab opens
    await waitFor(page, `document.querySelector('.wvs-top') !== null`, 15000)
    await shot('1-story')
    const onStory = (await count('.wvs-root')) > 0
    ok('Story is the first thing seen', onStory, REAL ? 'the running DSH does not know /kybernos/journal yet: restart it once' : undefined)
    if (onStory) {
      const headTop = (await page.evalJs(`(() => { const e = document.querySelector('.wvs-top'); return e ? Math.round(e.getBoundingClientRect().top) : null })()`, 4000)).val
      ok('the Journal opens at its own top, not where the chat was scrolled to', typeof headTop === 'number' && headTop >= 0 && headTop < 200, 'head at y=' + headTop)
      ok('no note injected by the runtime is shown as the person\'s message', (await page.evalJs(`document.body.innerText.indexOf('Time sampled while preparing') < 0 && document.body.innerText.indexOf('Current runtime context') < 0`, 4000)).val === true)
      ok('the head has the three views and the context chips', (await count('.wvs-seg button')) === 3 && (await count('.wvs-chip')) >= 2)
      ok('there are numbers (KPIs)', (await count('.wvs-kpi')) >= 4, String(await count('.wvs-kpi')))
      ok('the story lists moments', (await count('.wvs-list > li')) > 0, String(await count('.wvs-list > li')))
      // filters
      const chips = await count('.wvs-filters button')
      ok('the filters are there', chips >= 3, String(chips))
      if (chips >= 3) {
        const before = await count('.wvs-list > li')
        await clickLabel('Connectors', '.wvs-filters')
        const after = await count('.wvs-list > li')
        ok('a filter narrows the list', after <= before, before + ' -> ' + after)
        await shot('2-filter-connectors')
        await clickLabel('All', '.wvs-filters')
      }
      if (DEMO) {
        ok('the made-up chat shows its three crews, its waiting question and its open errors', (await count('.wvs-crews .wvs-crew')) === 4 && (await text('.wvs-kpis')).indexOf('Which recruiter') >= 0 && (await count('.wvs-pill.err')) >= 2)
        // the logos come from the connector catalogue, a moment after the page (an inline svg in the tile)
        await waitFor(page, `document.querySelectorAll('.wvs-tile.logo svg').length >= 3`, 10000)
        ok('connectors show their logo', (await count('.wvs-tile.logo svg')) >= 3, String(await count('.wvs-tile.logo svg')))
      }
      if (DEMO) {
        await clickLabel('Handovers', '.wvs-filters')
        ok('the handovers filter lists the four handovers', (await count('.wvs-list > li:not(.wvs-day)')) === 4, String(await count('.wvs-list > li:not(.wvs-day)')))
        // the permission that was allowed once: its detail holds the approver block
        await page.evalJs(`(() => { const r = Array.from(document.querySelectorAll('.wvs-row')).find((x) => /Delete the draft/.test(x.innerText)); const h = r && r.querySelector('.wvs-head'); if (h) h.setAttribute('data-kb-check-row', '1') })()`, 3000)
        await click('[data-kb-check-row="1"]')
        await shot('2b-handovers')
        const handoverList = await text('.wvs-list')
        ok('the handovers name who decided and on which computer (two people, two computers); the waiting one stays unnamed', /Amira Benali/.test(handoverList) && /K\. Haddad/.test(handoverList) && /MacBook Pro de Amira/.test(handoverList) && /Mac mini du bureau/.test(handoverList) && /Approver\s*Needs you/.test(handoverList.replace(/\n+/g, ' ')), handoverList.replace(/\n+/g, ' | ').slice(0, 300))
        ok('two decisions are sealed and the refusal whose record was edited shows a broken seal', (await count('.wvs-sig:not(.bad):not(.off)')) === 2 && (await count('.wvs-sig.bad')) === 1, (await count('.wvs-sig:not(.bad):not(.off)')) + ' sealed, ' + (await count('.wvs-sig.bad')) + ' broken')
        await clickLabel('All', '.wvs-filters')
      }
      // a row opens its detail
      if (await click('.wvs-row .wvs-head')) {
        await sleep(300)
        ok('a row opens its detail', (await count('[data-kb="wvs-detail"]')) > 0)
        await shot('3-detail')
      }
      // insights switch
      const insBefore = await count('.wvs-ins')
      await clickLabel('Insights')
      ok('the Insights switch hides and shows the charts', (await count('.wvs-ins')) !== insBefore)
      await clickLabel('Insights')
      // crews: the second card is the first crew (the first is « All crews »)
      if ((await count('.wvs-crew')) > 1) {
        const all = await count('.wvs-list > li:not(.wvs-day)')
        await click('.wvs-crews .wvs-crew:nth-child(2)')
        const inCrew = await count('.wvs-list > li:not(.wvs-day)')
        ok('a crew card narrows the story to its window', inCrew > 0 && inCrew < all, all + ' -> ' + inCrew)
        ok('the crew card is the pressed one', (await count('.wvs-crews .wvs-crew.on')) === 1 && (await count('.wvs-crews .wvs-crew:nth-child(2).on')) === 1)
        await shot('4-crew')
        await click('.wvs-crews .wvs-crew:nth-child(2)')
        ok('pressing it again brings the whole story back', (await count('.wvs-list > li:not(.wvs-day)')) === all)
      }
      // show more
      if ((await count('.wvs-showmore')) > 0) {
        const b = await count('.wvs-list > li')
        await click('.wvs-showmore')
        ok('« Show more » adds rows', (await count('.wvs-list > li')) > b)
      }
      // flow
      await clickLabel('Flow', '.wvs-seg')
      await sleep(700)
      await shot('5-flow')
      ok('Flow draws boxes', (await count('.wvs-node')) > 0, String(await count('.wvs-node')))
      ok('Flow draws lines between them', (await count('.wvs-edge')) > 0 || (await count('.wvs-node')) < 2)
      if (await click('.wvs-node')) {
        await sleep(300)
        ok('a box is selected and its card is beside the flow', (await count('.wvs-node.on')) > 0 && (await count('.wvs-finsp')) > 0)
        await shot('6-flow-node')
      }
      // advanced = the old sections
      await clickLabel('Advanced', '.wvs-seg')
      await sleep(900)
      ok('Advanced shows the old Journal sections', (await count('.wvs-classic')) > 0 && (await count('.wv2-root')) > 0)
      await shot('7-advanced')
      const seg = (await page.evalJs(`JSON.stringify(['.wvs-classic', '.wvs-barwrap', '.wvs-bar', '.wvs-seg', '.wv2-root'].map((q) => { const e = document.querySelector(q); if (!e) return q + ': none'; const r = e.getBoundingClientRect(); return q + ': ' + Math.round(r.x) + ',' + Math.round(r.y) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) }))`, 4000)).val
      ok('the view switcher is still on screen in Advanced', (await count('.wvs-seg')) > 0, seg)
      await clickLabel('Story', '.wvs-seg')
      await sleep(500)
      ok('back to Story', (await count('[data-kb="wvs-feed"]')) > 0, seg)
      // share: the sheet, its switches, and the page that is saved
      if (DEMO) {
        const checked = async () => JSON.parse((await page.evalJs(`JSON.stringify(Array.from(document.querySelectorAll('[data-kb="wvs-share"] input[type=checkbox]')).map((i) => [i.getAttribute('data-kb').replace('wvs-sw-', ''), i.checked]))`, 4000)).val || '[]')
        const hookDownload = async () => page.evalJs(`(() => { window.__kbPage = null; window.__kbName = null; if (!window.__kbHooked) { window.__kbHooked = true; const orig = URL.createObjectURL.bind(URL); URL.createObjectURL = (b) => { try { b.text().then((t) => { window.__kbPage = t }) } catch (e) { /* none */ } return orig(b) }; const click = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__kbName = this.download; return } return click.call(this) } } })()`, 3000)
        const saved = async () => { await click('[data-kb="wvs-share-save"]'); await waitFor(page, `window.__kbPage !== null && window.__kbPage !== undefined`, 12000); return { html: (await page.evalJs(`window.__kbPage`, 6000)).val || '', name: (await page.evalJs(`window.__kbName`, 3000)).val || '' } }
        ok('the Share button opens the sheet', await click('[data-kb="wvs-share-btn"]') && (await count('[data-kb="wvs-share"]')) === 1)
        const first = await checked()
        ok('the sheet has its eight switches; decisions, durations and deliverables are on, the words, names, computers, chat number and the seal check are off', first.length === 8 && first.filter((x) => x[1]).map((x) => x[0]).sort().join() === 'approvers,deliverables,timing', JSON.stringify(first))
        await shot('9-share-sheet')
        await hookDownload()
        const one = await saved()
        pageOne = one
        ok('« Save the page » hands the browser one .html file', one.html.indexOf('<!doctype html>') === 0 && /^journal-2026-11-02\.html$/.test(one.name) && (await count('[data-kb="wvs-share-done"]')) === 1, one.name + ' ' + one.html.length)
        ok('the default page holds none of the names, computers or the chat number', !/Amira|Haddad|MacBook|Mac mini|demo-journal/.test(one.html))
        await click('[data-kb="wvs-sw-verify"]')
        const second = await checked()
        ok('turning on « Let readers check the seals » turns on names, computers and the chat number', second.filter((x) => x[1]).map((x) => x[0]).sort().join() === 'approvers,chatId,computers,deliverables,names,timing,verify', JSON.stringify(second))
        await click('[data-kb="wvs-sw-names"]')
        ok('turning names off turns the seal check off again', (await checked()).filter((x) => x[0] === 'verify')[0][1] === false)
        await click('[data-kb="wvs-sw-names"]')
        await click('[data-kb="wvs-sw-verify"]')
        await hookDownload()
        pageTwo = await saved()
        ok('the page that can be checked carries the names, the key and the signed facts', /Amira Benali/.test(pageTwo.html) && /BEGIN PUBLIC KEY/.test(pageTwo.html) && /"evidence"/.test(pageTwo.html) && /journal-demojour-2026-11-02\.html/.test(pageTwo.name), pageTwo.name)
        // the link: the part of the sheet that talks to the Kybernos account
        await click('[data-kb="wvs-sw-verify"]')
        const reopen = async () => { await click('[data-kb="wvs-share-btn"]'); await click('[data-kb="wvs-share-btn"]'); await waitFor(page, `document.querySelector('[data-kb="wvs-link"]') && !/Looking for/.test(document.querySelector('[data-kb="wvs-link"]').innerText)`, 8000) }
        const onServer = () => [...linkServer.links.values()]
        await reopen()
        ok('on a server without links the sheet says so and offers no button', /not available on your Kybernos server yet/.test(await text('[data-kb="wvs-link-why"]')) && (await count('[data-kb="wvs-link-make"]')) === 0, await text('[data-kb="wvs-link"]'))
        await shot('13-link-unavailable')
        linkServer.mode = 'ok'
        await reopen()
        ok('with links available the sheet offers « Create the link », password on', (await count('[data-kb="wvs-link-make"]')) === 1 && (await page.evalJs(`document.querySelector('[data-kb="wvs-link-protect"]').checked`, 3000)).val === true)
        await shot('14-link-make')
        await click('[data-kb="wvs-link-make"]')
        await waitFor(page, `document.querySelector('[data-kb="wvs-link-url"]') !== null`, 8000)
        const url1 = (await page.evalJs(`document.querySelector('[data-kb="wvs-link-url"]').value`, 3000)).val
        const pw1 = await text('[data-kb="wvs-link-pw"]')
        ok('the link and its password are shown', /^https:\/\/kaby\.app\/s\//.test(url1) && /^[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/.test(pw1), url1 + ' ' + pw1)
        ok('the server holds one locked copy, no word of the Journal in it', onServer().length === 1 && onServer()[0].sealed === true && onServer()[0].doc === 'journal' && !/Amira|Recruiter|kybernos-journal/.test(onServer()[0].text))
        const opened1 = JSON.parse(await openSealed(JSON.parse(onServer()[0].text), pw1))
        ok('the password opens exactly the Journal that was chosen', opened1.kind === 'kybernos-journal' && opened1.include.verify === false && opened1.moments.length > 5 && opened1.include.names === true, JSON.stringify(opened1.include))
        ok('the sheet shows until when the link lives and offers update and delete', /Valid until/.test(await text('[data-kb="wvs-link-until"]')) && (await count('[data-kb="wvs-link-update"]')) === 1 && (await count('[data-kb="wvs-link-remove"]')) === 1)
        await shot('15-link-made')
        await click('[data-kb="wvs-sw-prompts"]')
        await click('[data-kb="wvs-link-update"]')
        await waitFor(page, `!/Updating/.test(document.querySelector('[data-kb="wvs-link"]').innerText)`, 8000)
        await sleep(400)
        const opened2 = JSON.parse(await openSealed(JSON.parse(onServer()[0].text), pw1))
        ok('an update keeps the link and the password and brings in the new choice', onServer().length === 1 && (await page.evalJs(`document.querySelector('[data-kb="wvs-link-url"]').value`, 3000)).val === url1 && await text('[data-kb="wvs-link-pw"]') === pw1 && opened2.include.prompts === true, JSON.stringify(opened2.include))
        onServer().forEach((l) => linkServer.links.delete(l.id))
        await click('[data-kb="wvs-link-update"]')
        await waitFor(page, `document.querySelector('[data-kb="wvs-link-gone"]') !== null`, 8000)
        ok('a link the server forgot says it has ended and offers a new one, not a quiet replacement', (await count('[data-kb="wvs-link-fresh"]')) === 1 && onServer().length === 0)
        await shot('16-link-gone')
        await click('[data-kb="wvs-link-fresh"]')
        await waitFor(page, `document.querySelector('[data-kb="wvs-link-url"]') !== null`, 8000)
        ok('a new link has its own address and its own password', (await page.evalJs(`document.querySelector('[data-kb="wvs-link-url"]').value`, 3000)).val !== url1 && await text('[data-kb="wvs-link-pw"]') !== pw1 && onServer().length === 1)
        await page.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 1100, deviceScaleFactor: 1, mobile: false })
        await sleep(600)
        const wideSheet = (await page.evalJs(`(() => { const r = document.querySelector('.wvs-root'); return r ? r.scrollWidth - r.clientWidth : -1 })()`, 4000)).val
        ok('the sheet with a link fits a narrow window', wideSheet <= 1, 'overflow ' + wideSheet + ' px')
        await shot('17-link-phone')
        await page.send('Emulation.clearDeviceMetricsOverride', {})
        await sleep(400)
        await click('[data-kb="wvs-link-remove"]')
        await waitFor(page, `document.querySelector('[data-kb="wvs-link-make"]') !== null`, 8000)
        ok('deleting takes the link down on the server and the sheet offers to make one again', onServer().length === 0 && (await count('[data-kb="wvs-link-url"]')) === 0)
        await click('[data-kb="wvs-share-btn"]')
      }
      // a narrow window must not scroll sideways
      await page.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 800, deviceScaleFactor: 1, mobile: false })
      await sleep(700)
      const wide = (await page.evalJs(`(() => { const r = document.querySelector('.wvs-root'); return r ? r.scrollWidth - r.clientWidth : -1 })()`, 4000)).val
      ok('a narrow window does not scroll sideways', wide <= 1, 'overflow ' + wide + ' px')
      await shot('8-narrow')
      await page.send('Emulation.clearDeviceMetricsOverride', {})
      // the saved pages, opened as files in the same browser: drawn, offline, no policy violation, seals checked by WebCrypto
      if (DEMO && pageOne !== null && pageTwo !== null) {
        const dir = mkdtempSync(join(tmpdir(), 'kb-journal-page-'))
        const logs = []
        await page.send('Log.enable', {})
        page.on('Log.entryAdded', (e) => { try { if (e.entry && e.entry.level === 'error') logs.push(String(e.entry.text)) } catch (err) { /* none */ } })
        const open = async (name, html) => {
          const f = join(dir, name)
          writeFileSync(f, html)
          await page.send('Page.navigate', { url: 'file://' + f })
          return waitFor(page, `document.querySelector('.kj-foot') !== null`, 15000)
        }
        try {
          await page.send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 1500, deviceScaleFactor: 1, mobile: false })
          ok('the default page opens as a file and draws', (await open('one.html', pageOne.html)) !== null)
          await sleep(500)
          await shot('10-page-default')
          ok('it shows the story, the crews and the deliverables', (await count('.kj-row')) >= 10 && (await count('.kj-crew')) === 3 && (await count('.kj-dl li')) >= 3, (await count('.kj-row')) + ' rows')
          ok('the connector logos travelled inside the page', (await count('.kj-tile.logo img')) >= 3, String(await count('.kj-tile.logo img')))
          ok('the words of the person are marked as not included', /Text not included/.test(await text('.kj-wrap')))
          ok('no name, computer or chat number is on the page', !/Amira|Haddad|MacBook|Mac mini|demo-journal/.test(await text('.kj-wrap')))
          ok('the sealed decisions say « Sealed »', (await count('.kj-pill.ok')) >= 2)
          ok('a narrow window does not scroll sideways', (await page.evalJs(`document.documentElement.scrollWidth - document.documentElement.clientWidth`, 3000)).val <= 1)
          ok('the page is its own: no request left the page, no policy violation', logs.filter((l) => /Content Security Policy|Refused|violat/i.test(l)).length === 0, logs.join(' | ').slice(0, 300))
          ok('the page that can be checked opens and draws', (await open('two.html', pageTwo.html)) !== null)
          await waitFor(page, `Array.from(document.querySelectorAll('.kj-pill')).filter((p) => /Checking/.test(p.innerText)).length === 0`, 8000)
          const pills = JSON.parse((await page.evalJs(`JSON.stringify(Array.from(document.querySelectorAll('.kj-pill')).map((p) => p.innerText.trim()))`, 3000)).val || '[]')
          ok('the reader\'s browser checks the two intact seals with the key in the page', pills.filter((x) => x === 'Checked in this browser').length === 2, pills.join(' | '))
          ok('the decision whose record was edited is shown broken, not checked', pills.filter((x) => x === 'Seal broken').length === 1, pills.join(' | '))
          ok('the footer counts the seals it checked', /2 \/ 2/.test(await text('.kj-foot')), await text('.kj-foot'))
          await page.send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 2600, deviceScaleFactor: 1, mobile: false })
          await sleep(400)
          await shot('11-page-verified')
          await page.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 900, deviceScaleFactor: 1, mobile: false })
          await sleep(400)
          ok('on a phone the page does not scroll sideways', (await page.evalJs(`document.documentElement.scrollWidth - document.documentElement.clientWidth`, 3000)).val <= 1)
          await shot('12-page-phone')
          await page.send('Emulation.clearDeviceMetricsOverride', {})
        } finally { rmSync(dir, { recursive: true, force: true }) }
      }
    }
    const errs = (await page.evalJs(`(window.__kbErrors || []).length`, 3000)).val
    if (errs) console.log('  note: the page recorded ' + errs + ' script errors')
  } finally {
    if (linkServer !== null) linkServer.done()
    await live.close()
  }
  console.log(failed === 0 ? '\nJournal tab: all checks passed' : '\nJournal tab: ' + failed + ' failed')
  process.exit(failed === 0 ? 0 : 1)
}
run().catch((e) => { console.error(String(e && e.message ? e.message : e)); process.exit(2) })
