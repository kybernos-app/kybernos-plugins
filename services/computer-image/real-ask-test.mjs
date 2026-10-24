// The REAL test of an automation that asks first, on the owner's own DSH and a test computer on Fly dev: it makes ONE automation (set to ask, due in a few minutes), then publishes it
// to the computer through the page, the way a person would (Where it runs, Cloud computer, Publish), and says what the platform answers. Nothing else of the owner's data is touched.
//
//   node services/computer-image/real-ask-test.mjs publish [computer name]     creates the automation and publishes it (default computer: ask-test; ASK_NAME / ASK_FILE for a second one)
//   node services/computer-image/real-ask-test.mjs watch <computer id> <ref>   exits when a question of that automation is waiting for an answer
//   node services/computer-image/real-ask-test.mjs clean <ref> <computer id>   takes it away from the computer and deletes it here
//
// It signs in to the DSH on :3080 with the signed session cookie of scripts/live-page.mjs (docs/dev/live-testing.md), which needs Chrome. Never run it against a DSH you do not own.
import { openLivePage, clickText } from '../../scripts/live-page.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const [mode, a1, a2] = process.argv.slice(2)
// ASK_NAME and ASK_FILE make a second automation (a run where the person refuses writes `proof-refuse.txt`: if that file is ever there, the refusal failed).
const NAME = process.env.ASK_NAME || 'Preuve de demande (test, à supprimer)'
const COMMAND = 'echo kb-ask-proof > ' + (process.env.ASK_FILE || '/data/work/proof.txt')

const localAt = (minutes, tz) => {
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(Date.now() + minutes * 60000))
  return parts.replace(' ', 'T')
}

const withPage = async (fn) => {
  const live = await openLivePage({ width: 1500, height: 900 })
  try { return await fn(live.page) } finally { await live.close() }
}
const val = (page) => async (expr) => (await page.evalJs(expr, 15000)).val

if (mode === 'watch') {
  const [computerId, ref] = [a1, a2]
  const end = Date.now() + 25 * 60_000
  while (Date.now() < end) {
    try {
      const j = await (await fetch('http://127.0.0.1:3080/kybernos-cloud/computers/approvals?computerId=' + encodeURIComponent(computerId))).json()
      const pending = j && j.ok === true ? j.approvals.filter((x) => x.ref === ref && x.state === 'pending') : []
      if (pending.length > 0) { console.log('QUESTION WAITING:', JSON.stringify({ id: pending[0].id, kind: pending[0].kind, summary: pending[0].summary, expiresAt: pending[0].expiresAt, notified: pending[0].notified })); process.exit(0) }
    } catch (e) { /* the DSH may be busy: try again */ }
    await sleep(5000)
  }
  console.log('TIMEOUT: no question after 25 minutes')
  process.exit(1)
}

if (mode === 'publish') {
  const wantName = a1 || 'ask-test'
  await withPage(async (page) => {
    const v = val(page)
    const comps = await v(`fetch('/kybernos-cloud/computers', { credentials: 'same-origin' }).then((r) => r.json()).then((j) => JSON.stringify(j.computers || []))`)
    const list = JSON.parse(comps)
    const target = list.find((c) => c.name === wantName)
    if (target === undefined) throw new Error('no computer named ' + wantName + ' (found: ' + list.map((c) => c.name).join(', ') + ')')
    if (!Array.isArray(target.capabilities) || target.capabilities.indexOf('ask_approvals') < 0) throw new Error(wantName + ' cannot ask yet (capabilities: ' + JSON.stringify(target.capabilities) + ')')
    console.log('computer:', target.name, target.id, target.state, JSON.stringify(target.capabilities))
    const at = localAt(7, 'Europe/Paris')
    const task = { name: NAME, prompt: 'Use the bash tool to run exactly this command: ' + COMMAND + ' . Then reply with the single word: done.', schedule: { mode: 'once', at, tz: 'Europe/Paris' }, active: true, approvals: 'ask' }
    const made = JSON.parse(await v(`fetch('/kybernos/tasks', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'create', task: ${JSON.stringify(task)} }) }).then((r) => r.text())`))
    if (made.ok !== true) throw new Error('could not create: ' + JSON.stringify(made).slice(0, 300))
    const id = made.task.id
    console.log('automation created:', id, '| due', at, 'Europe/Paris')
    // The page, as a person uses it.
    for (let i = 0; i < 4; i += 1) { await clickText(page, 'Automations'); if (await v(`!!document.querySelector('[data-kb="page-automations"]')`)) break; await sleep(1500) }
    await sleep(3000)
    const click = (sel) => v(`(() => { const b = document.querySelector('${sel}'); if (b) b.click(); return !!b })()`)
    const open = await v(`(() => { const b = Array.from(document.querySelectorAll('.kba-rowbtn')).find((x) => x.innerText.indexOf(${JSON.stringify(NAME)}) >= 0); if (b) b.click(); return !!b })()`)
    if (open !== true) throw new Error('the automation is not in the list of the page')
    await sleep(1500)
    if (!(await click('[data-kb="tab-where"]'))) throw new Error('no « Where it runs » tab')
    await sleep(700)
    await click('[data-kb="where-cloud"]'); await sleep(900)
    const picked = await v(`JSON.stringify(Array.from(document.querySelectorAll('[data-kb="where-opt"]')).map((x) => ({ id: x.getAttribute('data-kb-id'), text: x.innerText.replace(/\\s+/g, ' ').slice(0, 60), on: x.getAttribute('aria-checked') === 'true', disabled: x.disabled })))`)
    console.log('picker:', picked)
    const opt = JSON.parse(picked).find((o) => o.id === target.id)
    if (opt === undefined || opt.disabled) throw new Error('the page does not offer ' + wantName + ' for an automation that asks')
    if (!opt.on) { await v(`(() => { const b = document.querySelector('[data-kb="where-opt"][data-kb-id="${target.id}"]'); if (b) b.click(); return !!b })()`); await sleep(500) }
    if (!(await click('[data-kb="where-publish"]'))) throw new Error('no Publish button')
    console.log('Publish pressed')
    // What the platform says: pending, then applied, then the schedule row.
    for (let i = 0; i < 40; i += 1) {
      await sleep(3000)
      const s = JSON.parse(await v(`fetch('/kybernos-cloud/computers/tasks?computerId=${target.id}', { credentials: 'same-origin' }).then((r) => r.json()).then((j) => JSON.stringify(j))`))
      const mine = s.ok === true ? s.tasks.find((t) => t.ref === id) : null
      const err = await v(`(document.querySelector('[data-kb="where-error"], [data-kb="where-refused"]') || {}).innerText || null`)
      console.log(' platform says:', mine === null || mine === undefined ? JSON.stringify({ ok: s.ok, error: s.error || null, listed: false }) : JSON.stringify({ state: mine.state, code: mine.code, schedule: mine.schedule }), err ? '| page: ' + err.replace(/\s+/g, ' ') : '')
      if (err) break
      if (mine && (mine.state === 'applied' || mine.state === 'error') && mine.schedule !== null) break
    }
    console.log('REF', id)
    console.log('COMPUTER', target.id)
  })
  process.exit(0)
}

if (mode === 'clean') {
  const [ref, computerId] = [a1, a2]
  await withPage(async (page) => {
    const v = val(page)
    const del = await v(`fetch('/kybernos-cloud/computers/publish', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ computerId: ${JSON.stringify(computerId)}, ops: [{ op: 'delete', ref: ${JSON.stringify(ref)} }] }) }).then((r) => r.text())`)
    console.log('taken away from the computer:', del.slice(0, 200))
    const back = await v(`fetch('/kybernos/tasks', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'cloud-link', id: ${JSON.stringify(ref)}, cloud: null }) }).then((r) => r.text())`)
    console.log('link removed here:', back.slice(0, 120))
    const gone = await v(`fetch('/kybernos/tasks', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'delete', id: ${JSON.stringify(ref)} }) }).then((r) => r.text())`)
    console.log('deleted here:', gone.slice(0, 120))
  })
  process.exit(0)
}

console.log('usage: publish [computer name] | watch <computer id> <ref> | clean <ref> <computer id>')
process.exit(2)
