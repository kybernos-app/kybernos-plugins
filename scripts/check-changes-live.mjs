#!/usr/bin/env node
// The Changes chip (packages/kybernos-changes), end to end, in a real GUI.
//
//   source scripts/sandbox/env.sh && node scripts/check-changes-live.mjs [--shots <dir>]
//
// It needs a DSH that LOADS the bundle, i.e. a second instance whose profile links this checkout:
// `scripts/sandbox/setup.sh` then `scripts/sandbox/start.sh` build and start one (see docs/dev/live-testing.md). The user's own `dsh web`
// does not list the bundle, and this script refuses to run against it (exit 3).
//
// What it checks, in a real page:
//   1. the REAL data path: the sessions seam reads this chat's folder through the real state route (host code of
//      this checkout, `fichiers` included), the chip shows, the four git pills step aside and Memory & Lessons stays;
//   2. every state of the chip (facts handed to it through the seam): chip words, tone, the four steps, the primary
//      action and the others, files and who they belong to, the developer view;
//   3. an action end to end, with FAKE answers: the dry run is asked first (exec:false), then the confirm (exec:true,
//      with the message typed), a refusal shows its reason and offers nothing, the result shows and the state is re-read;
//   4. French; a narrow window; the seam missing (the pills must then stay).
//
// SAFETY: every POST to /kybernos-sessions/* is intercepted and answered here (fail-closed): no git command, no
// commit, no push ever runs, whatever the page asks. Reads go through. Nothing presses a real action.
// Exit code 0 / 1 / 3.
import { join } from 'node:path'
import { openLivePage } from './live-page.mjs'

const args = process.argv.slice(2)
const shotDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

const host = process.env.KB_HOST || '127.0.0.1:3080'
if (host === '127.0.0.1:3080') { console.error('○ inconclusive: this check needs a DSH that loads the bundle (a sandbox instance), not the one on :3080. Set KB_HOST, DSH_HOME and HOME.'); process.exit(3) }

const live = await openLivePage({ width: 1500, height: 1000 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const val = async (expr, ms) => (await page.evalJs(expr, ms)).val
const shot = async (name) => { if (shotDir !== null) { try { await page.shot(join(shotDir, name + '.png')) } catch (e) { /* no screenshot */ } } }
const poll = async (fn, ms = 15000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await sleep(250) } }

// ── fake answers to every POST of the sessions routes ───────────────────────────────────────────────────────────────
const posts = []
const fake = { refuse: null }
page.on('Fetch.requestPaused', async (p) => {
  try {
    const url = p.request.url
    if (p.request.method === 'POST' && /\/kybernos-sessions\//.test(url)) {
      let body = {}
      try { body = JSON.parse(p.request.postData || '{}') } catch (e) { /* not JSON */ }
      posts.push({ path: new URL(url).pathname, body })
      let out
      if (fake.refuse !== null) out = { ok: false, erreur: fake.refuse }
      else if (body.exec === true) out = { ok: true, message: 'fake: done' }
      else out = { ok: true, dry: true, commandes: ['git add src/a.js', 'git commit -m "livraison"', 'git push'] }
      await page.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }, { name: 'cache-control', value: 'no-store' }], body: Buffer.from(JSON.stringify(out)).toString('base64') })
      return
    }
    await page.send('Fetch.continueRequest', { requestId: p.requestId })
  } catch (e) { try { await page.send('Fetch.continueRequest', { requestId: p.requestId }) } catch (e2) { /* gone */ } }
})
await page.send('Fetch.enable', { patterns: [{ urlPattern: '*/kybernos-sessions/*', requestStage: 'Request' }] })

// A real mouse click on the leaf element whose text is exactly `text` — no scrolling: the page must stay where it is.
const clickText = async (_page, text) => {
  const pos = await val(`(() => { const own = (e) => Array.from(e.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim(); const e = Array.from(document.querySelectorAll('*')).filter((e) => (e.children.length === 0 ? (e.innerText || '').trim() : own(e)) === ${JSON.stringify(text)} && e.getBoundingClientRect().width > 3)[0]; if (!e) return null; const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }) })()`)
  if (typeof pos !== 'string') return false
  const { x, y } = JSON.parse(pos)
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  return true
}

// ── the page: open the one session of the sandbox ───────────────────────────────────────────────────────────────────
// A fresh sandbox has no chat: send a first message from the empty composer. No model is configured there, so the turn
// fails (that is fine); what matters is that DSH now holds a real session in this repository's folder.
const createSession = async () => {
  const pos = await val(`(() => { const e = document.querySelector('[contenteditable="true"], textarea'); if (!e) return null; const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.x + 40, y: r.y + r.height / 2 }) })()`)
  if (typeof pos !== 'string') return false
  const { x, y } = JSON.parse(pos)
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  await sleep(300)
  await page.send('Input.insertText', { text: 'Changes check' })
  await sleep(300)
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  return poll(() => val(`/Changes check/.test(document.body.innerText)`), 15000)
}
const hasComposer = () => val(`/Message or run a task/.test(document.body.innerText)`)
const openSession = async () => {
  // A fresh sandbox asks for an API key on the first load: dismiss it, then open the session once the sidebar is there.
  let found = false
  for (let i = 0; i < 24 && !found; i += 1) {
    await sleep(500)
    if ((await val(`/Add an API key to get started/.test(document.body.innerText)`)) === true) { await clickText(page, 'Configure later'); await sleep(700); continue }
    found = (await val(`/Changes check/.test(document.body.innerText)`)) === true
  }
  if (!found && !(await createSession())) return false
  if (await hasComposer()) return true // creating it opened it
  const ok = await clickText(page, 'Changes check')
  for (let i = 0; i < 20 && ok; i += 1) { await sleep(500); if (await hasComposer()) return true }
  return false
}
const chipText = () => val(`(document.querySelector('[data-kb="changes-chip"]') || { innerText: null }).innerText`)
const wrapState = () => val(`(() => { const w = document.querySelector('[data-kb="changes"]'); return w ? JSON.stringify({ state: w.getAttribute('data-state'), cls: w.className }) : null })()`).then((x) => (typeof x === 'string' ? JSON.parse(x) : null))
const cardOpen = () => val(`!!document.querySelector('[data-kb="changes-card"]')`)
const openCard = async () => { if (!(await cardOpen())) await val(`document.querySelector('[data-kb="changes-chip"]').click()`); return poll(cardOpen, 4000) }
const closeCard = async () => { if (await cardOpen()) await val(`document.querySelector('[data-kb="changes-chip"]').click()`); await sleep(150) }
const steps = () => val(`JSON.stringify(Array.from(document.querySelectorAll('[data-kb="changes-card"] .kbch-stp')).map((e) => e.getAttribute('data-step')))`).then((x) => JSON.parse(x || '[]'))
const cardText = () => val(`(document.querySelector('[data-kb="changes-card"]') || { innerText: '' }).innerText.replace(/\\n+/g, ' | ')`)
const buttons = () => val(`JSON.stringify(Array.from(document.querySelectorAll('[data-kb="changes-card"] [data-act]')).map((b) => ({ act: b.getAttribute('data-act'), role: b.getAttribute('data-role'), text: b.innerText.trim().replace(/\\s+/g, ' ') })))`).then((x) => JSON.parse(x || '[]'))
const pills = () => val(`JSON.stringify(Array.from(document.querySelectorAll('.kbs-pill')).map((e) => e.getAttribute('data-kbs-pill')))`).then((x) => JSON.parse(x || '[]'))
const click = (sel) => val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true })()`)

try {
  check('the sandbox answers and has one session to open', (await openSession()) === true)
  const sid = await poll(() => val(`(window.__KB_SESSIONS_VIEW__ && typeof window.__KB_SESSIONS_VIEW__.read === 'function') ? 'seam' : null`), 10000)
  check('the sessions client publishes its seam (version 1)', sid === 'seam' && (await val(`window.__KB_SESSIONS_VIEW__.version`)) === 1)

  // ═══ 1. the real data path ══════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n── 1. the real state of this chat’s folder ──')
  const chip = await poll(chipText, 20000)
  await shot('1-real-chip')
  check('the chip shows, with words (not an icon)', typeof chip === 'string' && chip.trim().length > 4, chip)
  const real = await wrapState()
  check('it is in one of the known states', real !== null && /^(ok|unsaved|toSend|sync|notInProject|readyReview|prChecks|prWaiting|prChanges|prFail|prReady|prMerged|toFetch|conflict|elsewhere)$/.test(real.state), real)
  // The row under the composer fills in a moment after the chip: look until something is there before judging what it holds.
  const p0 = (await poll(async () => { const x = await pills(); return Array.isArray(x) && x.length > 0 ? x : null }, 12000)) ?? []
  check('the four git pills stepped aside; Memory & Lessons stays', !p0.some((x) => ['local', 'recap', 'sync', 'pr'].includes(x)) && p0.includes('notes'), p0)
  check('the pills were told (flag and event)', (await val(`window.__KB_CHANGES_ACTIVE__`)) === true)
  await openCard()
  await shot('1-real-card')
  const real1 = await cardText()
  check('the card opens and says where the work stands', typeof real1 === 'string' && /Changes/.test(real1) && (await steps()).length === 4, real1)
  const files = await val(`JSON.stringify(Array.from(document.querySelectorAll('[data-kb="changes-files"] li')).map((l) => l.innerText.replace(/\\s+/g, ' ').trim()))`).then((x) => JSON.parse(x || '[]'))
  if (files.length > 0) check('files are listed, each with its kind (the host sent `fichiers`)', files.filter((f) => !/^… /.test(f)).every((f) => /(modified|new|deleted|renamed|conflict)/.test(f)), files.slice(0, 4))
  else console.log('  · the folder has no dirty file right now: the file list is covered by the scenarios')
  await val(`document.querySelector('[data-act="mode-dev"]').click()`)
  await sleep(250)
  const dev = await val(`(document.querySelector('[data-kb="changes-dev"]') || { innerText: '' }).innerText.replace(/\\n+/g, ' | ')`)
  check('the developer view shows the branch, the gap and the folder', /Branch/.test(dev) && /Gap/.test(dev) && /Folder/.test(dev), dev)
  await shot('1-real-dev')
  await val(`document.querySelector('[data-act="mode-simple"]').click()`)
  await closeCard()
  // (DSH's own classifier may post a session's category to /decision: that is not an action of the chip.)
  check('no action was posted by just looking', posts.filter((x) => !/\/decision$/.test(x.path)).length === 0, posts)

  // ═══ 2. every state ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n── 2. every state, through the seam ──')
  const A = (...roles) => Object.fromEntries(roles.map((r) => [r, { url: '/kybernos-sessions/' + ({ save: 'commit', saveLocal: 'commit', addToProject: 'commit', push: 'push', fetch: 'fetch', sync: 'sync', askReview: 'pr', merge: 'pr', isolate: 'isolate', closeCopy: 'close' }[r]), corps: { session: 'sid', ...(r === 'save' ? { chemins: ['src/a.js'] } : {}), ...(r === 'saveLocal' ? { chemins: ['src/a.js'], local: true } : {}), ...(r === 'askReview' ? { action: 'create' } : {}), ...(r === 'merge' ? { action: 'merge' } : {}) }, label: r, hint: '' }]))
  const F = (o) => Object.assign({ git: true, folder: '/work/proj', branch: 'feat/x', base: 'main', isolated: false, isolatedName: '', remote: 'git@github.com:acme/proj.git', github: true, unsaved: 0, unsavedKnown: true, files: [], folderDirty: 0, sharedWith: 0, ahead: 0, behind: 0, notMerged: 0, lastFetch: null, conflicts: 0, pr: null, onBase: false, actions: {} }, o)
  const file = (path, kind, mine) => ({ path, kind, mine })
  const setFacts = (f) => val(`window.__KB_SESSIONS_VIEW__.read = async () => (${JSON.stringify(f)})`)
  const scenario = async (name, facts, want) => {
    await closeCard()
    await setFacts(facts)
    await openCard() // opening re-reads
    await sleep(350)
    const w = await wrapState()
    const c = await chipText()
    const st = await steps()
    const b = await buttons()
    const primary = b.filter((x) => x.act === 'primary').map((x) => x.role)
    const second = b.filter((x) => x.act === 'secondary').map((x) => x.role)
    check(name + ' — state "' + want.state + '", tone ' + want.tone + ', chip "' + want.chip + '"', w !== null && w.state === want.state && w.cls.indexOf('kbch-' + want.tone) >= 0 && String(c).indexOf(want.chip) >= 0, { w, c })
    check(name + ' — steps ' + want.steps.join('/'), JSON.stringify(st) === JSON.stringify(want.steps), st)
    check(name + ' — primary ' + (want.primary || 'none') + (want.second ? ', also ' + want.second.join(',') : ''), JSON.stringify(primary) === JSON.stringify(want.primary ? [want.primary] : []) && JSON.stringify(second) === JSON.stringify(want.second || []), { primary, second })
    return { w, c, st, b }
  }
  const D = 'done'; const T = 'todo'
  await scenario('everything saved', F({}), { state: 'ok', tone: 'ok', chip: 'Everything is saved', steps: [D, D, D, D] })
  await scenario('a clean isolated copy', F({ isolated: true, isolatedName: 'x', actions: A('closeCopy') }), { state: 'ok', tone: 'ok', chip: 'Everything is saved', steps: [D, D, D, D], primary: 'closeCopy' })
  const u = await scenario('unsaved work', F({ unsaved: 2, folderDirty: 3, sharedWith: 1, files: [file('src/a.js', 'modified', true), file('src/b.js', 'modified', true), file('logo.png', 'new', false)], actions: A('save', 'saveLocal') }), { state: 'unsaved', tone: 'warn', chip: '2 files to save', steps: ['now', T, T, T], primary: 'save', second: ['saveLocal'] })
  await shot('2-unsaved')
  const t = await cardText()
  check('unsaved — the files are listed, with their kind and the one that is another chat’s', /src\/a\.js \| modified/.test(t) && /logo\.png \| new · other chat/.test(t), t)
  check('unsaved — the card says the folder is shared, and what will be saved', /shared with 1 other chat/.test(t), t)
  check('unsaved — the main button uses no git word in Simple', /Save my work/.test(JSON.stringify(u.b)) && !/commit|push/i.test(JSON.stringify(u.b.filter((x) => x.act === 'primary'))), u.b)
  await scenario('ahead of GitHub', F({ ahead: 3, actions: A('push') }), { state: 'toSend', tone: 'info', chip: 'Saved · not online', steps: [D, 'now', T, T], primary: 'push' })
  await scenario('ahead and behind', F({ ahead: 1, behind: 2, actions: A('sync') }), { state: 'sync', tone: 'warn', chip: 'Needs syncing', steps: [D, 'now', T, T], primary: 'sync' })
  await scenario('a copy not in the project', F({ isolated: true, isolatedName: 'x', notMerged: 2, actions: A('addToProject', 'askReview') }), { state: 'notInProject', tone: 'info', chip: 'Saved · not in the project', steps: [D, 'now', T, T], primary: 'addToProject', second: ['askReview'] })
  await scenario('ready for a review', F({ isolated: true, actions: A('askReview') }), { state: 'readyReview', tone: 'info', chip: 'Ready for review', steps: [D, D, 'now', T], primary: 'askReview' })
  const pr = (o) => ({ number: 12, title: 'Do x', state: 'open', checks: 'pass', review: 'approved', url: 'https://github.com/acme/proj/pull/12', ...o })
  await scenario('checks running', F({ isolated: true, pr: pr({ checks: 'running', review: 'review_required' }) }), { state: 'prChecks', tone: 'info', chip: 'GitHub is checking your work', steps: [D, D, 'wait', T] })
  await scenario('waiting for a teammate', F({ isolated: true, pr: pr({ review: 'review_required' }) }), { state: 'prWaiting', tone: 'info', chip: 'Waiting for review', steps: [D, D, 'wait', T] })
  await scenario('changes asked', F({ isolated: true, pr: pr({ review: 'changes_requested' }) }), { state: 'prChanges', tone: 'warn', chip: 'Changes were asked', steps: [D, D, 'bad', T] })
  await scenario('a check failed', F({ isolated: true, pr: pr({ checks: 'fail' }) }), { state: 'prFail', tone: 'err', chip: 'A check failed', steps: [D, D, 'bad', T] })
  await scenario('approved, ready to merge', F({ isolated: true, pr: pr({}), actions: A('merge') }), { state: 'prReady', tone: 'ok', chip: 'Approved', steps: [D, D, 'now', T], primary: 'merge' })
  check('the request on GitHub is a link that opens outside (new tab, no opener)', (await val(`(() => { const a = document.querySelector('[data-kb="changes-card"] a[href*="github.com"]'); return !!a && a.target === '_blank' && /noreferrer/.test(a.rel) })()`)) === true)
  await scenario('merged', F({ isolated: true, pr: pr({ state: 'merged' }), actions: A('fetch') }), { state: 'prMerged', tone: 'ok', chip: 'In the project', steps: [D, D, D, D], primary: 'fetch' })
  await scenario('GitHub has news', F({ behind: 2, actions: A('fetch') }), { state: 'toFetch', tone: 'info', chip: 'GitHub has news', steps: [D, D, D, D], primary: 'fetch' })
  await scenario('a conflict', F({ conflicts: 1, unsaved: 1, files: [file('README.md', 'conflict', true)] }), { state: 'conflict', tone: 'err', chip: 'A conflict blocks', steps: [D, 'bad', T, T] })
  await scenario('files from other chats only', F({ folderDirty: 4, sharedWith: 2, files: [file('a', 'modified', false)], actions: A('isolate') }), { state: 'elsewhere', tone: 'info', chip: 'Nothing to save here', steps: [D, D, D, D], second: ['isolate'] })
  // a folder that is not a git project: the chip goes away rather than saying something false (the next 30 s read)
  await closeCard()
  await setFacts({ git: false, pourquoi: 'git' })
  await sleep(31000)
  check('a folder that is not a git project: no chip at all', (await val(`!document.querySelector('[data-kb="changes-chip"]')`)) === true)
  check('… and the four pills stay silent (the chip took them over, it did not leave a hole)', !(await pills()).some((x) => ['local', 'recap', 'sync', 'pr'].includes(x)))

  // ═══ 3. an action, with fake answers ══════════════════════════════════════════════════════════════════════════════════
  console.log('\n── 3. an action: the dry run first, then the confirm ──')
  posts.length = 0
  await setFacts(F({ unsaved: 2, files: [file('src/a.js', 'modified', true)], actions: A('save', 'saveLocal') }))
  // the chip went away with the folder that is not a project: it comes back at the next 30 s read
  await poll(() => val(`!!document.querySelector('[data-kb="changes-chip"]')`), 40000)
  await closeCard(); await openCard(); await sleep(300)
  await click('[data-act="primary"]')
  await poll(() => val(`!!document.querySelector('[data-kb="changes-confirm"]')`), 6000)
  await shot('3-confirm-simple')
  check('the dry run was asked first (exec:false), nothing else', posts.length === 1 && posts[0].path === '/kybernos-sessions/commit' && posts[0].body.exec === false, posts)
  const cf = await val(`document.querySelector('[data-kb="changes-confirm"]').innerText.replace(/\\n+/g, ' | ')`)
  check('Simple: the confirm says what will happen in plain words, with a message field, and shows no command', /Before going on/.test(cf) && /optional/.test(cf) && !/git (add|commit|push)/.test(cf), cf)
  await val(`(() => { const i = document.getElementById('kbch-msg'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'Fix the menu'); i.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await sleep(150)
  await click('[data-act="confirm"]')
  await poll(() => val(`!!document.querySelector('[data-kb="changes-done"]')`), 6000)
  check('the confirm ran the action (exec:true) with the user’s message, on the same route and body', posts.length === 2 && posts[1].body.exec === true && posts[1].body.message === 'Fix the menu' && JSON.stringify(posts[1].body.chemins) === '["src/a.js"]' && posts[1].path === '/kybernos-sessions/commit', posts)
  check('the result is shown', /Done/.test(await cardText()))
  await shot('3-done')
  // developer view: the exact commands are shown before confirming
  posts.length = 0
  await closeCard(); await openCard(); await click('[data-act="mode-dev"]'); await sleep(150)
  await click('[data-act="primary"]')
  await poll(() => val(`!!document.querySelector('[data-kb="changes-confirm"]')`), 6000)
  const cfd = await val(`document.querySelector('[data-kb="changes-confirm"]').innerText.replace(/\\n+/g, ' | ')`)
  check('Developer: the exact commands of the plan are shown, and the button says it runs them', /git add src\/a\.js/.test(cfd) && /git push/.test(cfd) && /Confirm and run/.test(cfd), cfd)
  await shot('3-confirm-dev')
  await click('[data-act="back"]')
  await sleep(150)
  check('Back cancels: nothing was run (only the dry run was posted)', posts.length === 1 && posts[0].body.exec === false && (await val(`!document.querySelector('[data-kb="changes-confirm"]')`)) === true, posts)
  // a refusal
  posts.length = 0
  fake.refuse = 'rien à committer — arbre propre'
  await click('[data-act="primary"]')
  await poll(() => val(`!!document.querySelector('[data-kb="changes-error"]')`), 6000)
  const er = await val(`(document.querySelector('[data-kb="changes-error"]') || { innerText: '' }).innerText`)
  check('a refusal shows its reason and offers no confirm', /rien à committer/.test(er) && (await val(`!document.querySelector('[data-kb="changes-confirm"]')`)) === true && posts.length === 1, { er, posts })
  fake.refuse = null
  check('the mode choice is remembered', (await val(`localStorage.getItem('kybernos.changes.mode')`)) === 'dev')
  await click('[data-act="mode-simple"]')

  // ═══ 4. French, a narrow window, the seam missing ═══════════════════════════════════════════════════════════════════
  console.log('\n── 4. French, narrow, and without the seam ──')
  await setFacts(F({ unsaved: 2, files: [file('src/a.js', 'modified', true)], actions: A('save', 'saveLocal') }))
  await val(`window.__kbOrigLang = window.__KB_LANG_RESOLVE__; window.__KB_LANG_RESOLVE__ = () => 'kybernos'`)
  await closeCard(); await openCard(); await sleep(300)
  const fr = await chipText()
  const frCard = await cardText()
  check('in French the chip and the card are French', /fichiers? à sauvegarder/.test(String(fr)) && /Sauvegarder mon travail/.test(frCard) && /Modifié/.test(frCard) && /Sur GitHub/.test(frCard), { fr, frCard })
  await shot('4-french')
  await val(`window.__KB_LANG_RESOLVE__ = window.__kbOrigLang`)
  await page.send('Emulation.setDeviceMetricsOverride', { width: 560, height: 800, deviceScaleFactor: 1, mobile: false })
  await sleep(600)
  await closeCard(); await openCard(); await sleep(300)
  const box = await val(`(() => { const c = document.querySelector('[data-kb="changes-card"]').getBoundingClientRect(); return JSON.stringify({ l: Math.round(c.left), r: Math.round(c.right), w: innerWidth }) })()`).then((x) => JSON.parse(x))
  check('at 560 px the card stays inside the window', box.l >= 0 && box.r <= box.w, box)
  await shot('4-narrow')
  await page.send('Emulation.clearDeviceMetricsOverride', {})
  // the seam missing: a fresh load where the property cannot be set
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(window, '__KB_SESSIONS_VIEW__', { configurable: true, get() { return undefined }, set() {} })` })
  await page.send('Page.reload', {})
  await openSession()
  await sleep(4000)
  const p2 = await pills()
  check('without the seam there is no chip, and the four pills are still there', (await val(`!document.querySelector('[data-kb="changes-chip"]')`)) === true && ['local', 'recap'].every((x) => p2.includes(x)) && p2.includes('notes'), p2)
  check('… and nobody was told to step aside', (await val(`window.__KB_CHANGES_ACTIVE__ !== true`)) === true)
} catch (e) {
  fail += 1
  console.log('  ✗ the check stopped: ' + e.message)
} finally {
  await live.close()
}
console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)
