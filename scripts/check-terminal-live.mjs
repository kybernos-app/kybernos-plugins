#!/usr/bin/env node
// The terminal's run route (packages/kybernos-terminal) on a real DSH, through the page's own signed session (audit A4-17, R-A4-01; R3-01).
//
//   source scripts/sandbox/env.sh && node scripts/check-terminal-live.mjs
//
// Needs a DSH that serves this checkout (scripts/sandbox/start.sh); refuses :3080 and any DSH home that is not a sandbox's.
//
// What it proves, with the page's own cookie and origin (nothing is faked):
//   - a request that names NO session (or an empty one) runs nothing: 400 « no chat session to run in », never the home folder;
//   - a request that names a real session runs in THAT session's folder (the sandbox's worktree), not in the home folder;
//   - a folder sent by the page is not used;
//   - the 30 s deadline kills the whole process group: a command that leaves a child behind is answered at 30 s (not when the child ends,
//     here 300 s) as a timeout, and the child is gone.
//
// SAFETY: the only commands sent are `pwd`, `echo` and a `sleep` (killed by the route; killed here by its own pid if the route failed to).
// No install, no update, no network, no message. Exit code 0 / 1 / 3 (3 = inconclusive: no sandbox).
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage } from './live-page.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) } }

const host = process.env.KB_HOST || '127.0.0.1:3080'
const home = process.env.DSH_HOME || ''
if (host === '127.0.0.1:3080') { console.error('○ inconclusive: this check needs a DSH that serves this checkout (a sandbox instance), not the one on :3080.'); process.exit(3) }
if (home.indexOf('.kybernos-sandbox') < 0) { console.error('○ inconclusive: DSH_HOME is not a sandbox home.'); process.exit(3) }
const worktree = process.env.KB_WORKTREE
if (!worktree || !existsSync(join(worktree, 'packages', 'kybernos-terminal'))) { console.error('○ inconclusive: KB_WORKTREE does not point at a checkout with packages/kybernos-terminal (source scripts/sandbox/env.sh).'); process.exit(3) }

// A session of this sandbox IN THE WORKTREE: the folders of its session store (`<home>/sessions/--<slug>--/session-<id>`, the slug being the working folder with its
// separators turned into dashes), newest first. The store lists other sessions too (the automations' own, in `<home>/kybernos/automations`): the route runs in the folder of
// the session it is given, so a session of another folder cannot be compared with the worktree.
const slugOfWorktree = '--' + (process.env.KB_WORKTREE || '').replace(/^[/\\]/, '').replace(/[/\\:]/g, '-') + '--'
const sessions = () => {
  const out = []
  const store = join(home, 'sessions')
  if (!existsSync(store)) return out
  for (const slug of readdirSync(store)) {
    if (slug !== slugOfWorktree) continue
    for (const id of readdirSync(join(store, slug))) if (id.startsWith('session-')) out.push({ id, at: statSync(join(store, slug, id)).mtimeMs })
  }
  return out.sort((a, b) => b.at - a.at).map((s) => s.id)
}
const sessionId = sessions()[0]
if (sessionId === undefined) { console.error('○ inconclusive: the sandbox holds no chat session in the worktree\'s folder yet (open the app and send a first message from its own chat, or run check-motion-live.mjs once).'); process.exit(3) }

const live = await openLivePage({ width: 1200, height: 800 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const val = async (expr, ms) => (await page.evalJs(expr, ms)).val
const run = async (body, ms = 20000) => {
  const raw = await val(`fetch('/kybernos-terminal/run', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }).then(async (r) => JSON.stringify({ status: r.status, body: await r.json().catch(() => null) })).catch((e) => JSON.stringify({ status: 0, body: String(e) }))`, ms)
  try { return JSON.parse(raw) } catch (e) { return { status: -1, body: raw } }
}
const alive = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return false } }

try {
  await sleep(2500)
  console.log('── A4-17 · where it runs ──')
  const none = await run({ commande: 'pwd' })
  check('no session named: 400, nothing ran (it ran in the home folder)', none.status === 400 && none.body && none.body.ok === false && /no chat session/.test(none.body.erreur) && none.body.stdout === undefined, none)
  const empty = await run({ commande: 'pwd', session: '' })
  check('an empty session (what the page sends when it cannot tell): 400, nothing ran', empty.status === 400 && /no chat session/.test((empty.body || {}).erreur || '') && (empty.body || {}).stdout === undefined, empty)
  const unknown = await run({ commande: 'pwd', session: 'session-00000000-0000-0000-0000-000000000000' })
  check('an unknown session: 400, nothing ran', unknown.status === 400 && /folder of this session/.test((unknown.body || {}).erreur || ''), unknown)
  const here = await run({ commande: 'pwd', session: sessionId })
  const dir = (here.body && here.body.stdout ? here.body.stdout.trim() : '')
  check('a real session runs in that session\'s folder (the sandbox worktree), not in the home folder', here.status === 200 && dir !== '' && realpathSync(dir) === realpathSync(worktree), here)
  const imposed = await run({ commande: 'pwd', session: sessionId, cwd: '/' })
  check('a folder sent by the page is not used', imposed.status === 200 && (imposed.body.stdout || '').trim() === dir, imposed)

  console.log('\n── R-A4-01 · the deadline kills the group (30 s) ──')
  const t0 = Date.now()
  const slow = await run({ commande: "sh -c 'echo $$; exec sleep 300'; echo late", session: sessionId }, 60000)
  const ms = Date.now() - t0
  const pid = parseInt(String((slow.body || {}).stdout || '').split('\n')[0], 10)
  check('a command that leaves a child behind is answered at the 30 s deadline as a timeout (not when the child ends)', slow.status === 200 && slow.body.timedOut === true && slow.body.code === null && ms >= 29000 && ms < 45000, { status: slow.status, ms, timedOut: (slow.body || {}).timedOut })
  await sleep(500)
  const gone = Number.isInteger(pid) && pid > 1 && !alive(pid)
  check('...and the child it started is gone', gone, { pid })
  if (Number.isInteger(pid) && pid > 1 && alive(pid)) { try { process.kill(pid, 'SIGKILL') } catch (e) { /* gone */ } }
} catch (e) {
  fail += 1
  console.log('  ✗ the check stopped: ' + (e && e.message ? e.message : e))
} finally {
  await live.close()
}
console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + ', ' + pass + ' passed')
process.exit(fail === 0 ? 0 : 1)
