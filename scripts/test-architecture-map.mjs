#!/usr/bin/env node
// The platform story (demo/kybernos-architecture/index.html) is ONE file, in ONE language (English), with ONE copy of its data.
// This test keeps it that way, offline, with no browser:
//   - the folder holds the page and its README and nothing else (no twin, no second language), plus the optional private overlay;
//   - the page loads nothing from the network (its one optional script is the sibling overlay) and its script parses;
//   - the public file carries no vendor of the roadmap, no price, no commercial term: those live in the private overlay, which is
//     optional: the page and this test pass without it, and the overlay (when it is there) is checked against the bricks;
//   - the data block evaluates and is consistent: three frames in their order (Kybernos, the server, the outside), every brick sits in
//     one frame and one group of it, inside the frame, never on top of another brick, with a title and a subtitle that fit its box;
//     every link joins two things that exist and are laid out so the line can be drawn; every step of the story points at bricks;
//   - a brick that is not "built" says why, and every brick is told by at least one step of the story;
//   - the server frame has an admin side and a user side, and one queue that the doors feed; no vertical line crosses a brick;
//   - the roadmap is in the schema: the seven bricks it added, the planned lists with their dots, the story that tells them;
//   - the page is English only;
//   - every document the page cites exists in this repository.
//
//   node scripts/test-architecture-map.mjs [path/to/index.html]
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = join(REPO, 'demo', 'kybernos-architecture')
const PAGE = process.argv[2] ? resolve(process.argv[2]) : join(DIR, 'index.html')

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)))) }
}

// ── one source: the folder ──
const OVERLAY = 'roadmap.private.js'
const files = readdirSync(DIR).filter((f) => f !== OVERLAY).sort()
check('the folder holds index.html and README.md and nothing else (the optional private overlay aside)', JSON.stringify(files) === JSON.stringify(['README.md', 'index.html']), files)

const html = readFileSync(PAGE, 'utf8')
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
check('one inline script', scripts.length === 1, scripts.length)
const script = scripts.length === 1 ? scripts[0][1] : ''

// ── no network ──
check('no URL in the file', !/https?:\/\//i.test(html), (html.match(/https?:\/\/[^\s"')]+/gi) || []).slice(0, 3))
const srcTags = [...html.matchAll(/<script[^>]+\bsrc=["']([^"']+)["']/gi)].map((m) => m[1])
check('no external script, stylesheet or request: the one script tag with a source is the optional sibling overlay', JSON.stringify(srcTags) === JSON.stringify([OVERLAY]) && !/<link[^>]+rel=["']stylesheet/i.test(html) && !/\b(fetch|XMLHttpRequest|WebSocket|sendBeacon)\b\s*\(/.test(script), srcTags)
let parses = true
try { new vm.Script(script) } catch (e) { parses = e.message }
check('the script parses', parses === true, parses)

// ── English only ──
const FRENCH = /[éèêëàâùûôîïçœ]|\b(le|la|les|des|une|pour|avec|dans|sur|est|sont|chaque|jeton|harnais)\b/i
const frenchLines = html.split('\n').filter((l) => FRENCH.test(l) && !/^\s*(\/\/|\/\*)/.test(l))
check('the page is English only', frenchLines.length === 0 && /<html lang="en">/.test(html), frenchLines.slice(0, 3).map((l) => l.trim().slice(0, 80)))
check('no language switch is left', !/\bI18N\b|data-i=|\?lang=|langBtn/.test(html))

// ── the data block ──
const block = script.match(/\/\*DATA:START\*\/([\s\S]*?)\/\*DATA:END\*\//)
check('the data block is delimited', Boolean(block))
let RAW = null
if (block) {
  try { RAW = vm.runInNewContext(block[1] + '\n;RAW', {}) } catch (e) { check('the data block evaluates', false, e.message) }
}
// ── the public file carries nothing private ──
const PRIVATE_WORDS = ['Telnyx', 'Twilio', 'Kapso', 'OpenRouter', 'Vercel', 'Sakana', 'Fugu', 'AI Gateway', 'CIR', 'MESR', 'rescrit', 'clawback']
const leaks = PRIVATE_WORDS.filter((w) => new RegExp('\\b' + w + '\\b', 'i').test(html))
check('the public file names no vendor of the roadmap and no commercial term (they live in the private overlay)', leaks.length === 0, leaks)
const moneyWords = block ? (block[1].match(/[€$£]|\b(EUR|USD)\b|\bper cent\b|\d\s?%/gi) || []) : []
check('the public data states no price, no amount and no percentage', moneyWords.length === 0, moneyWords.slice(0, 4))
check('the page reads the overlay only when it is there (a missing or broken one leaves the public page)', /typeof window !== "undefined" \? window\.KB_PRIVATE : null/.test(script) && /catch \(e\) \{ return null; \}/.test(script))

if (RAW) {
  check('the data block evaluates', true)
  const { FRAMES, NODES, LINKS, STORY } = RAW
  const ids = NODES.map((n) => n.id)
  const byId = new Map(NODES.map((n) => [n.id, n]))
  const frameById = new Map(FRAMES.map((f) => [f.id, f]))
  const frameIds = FRAMES.map((f) => f.id)
  const groupKeys = new Set(FRAMES.flatMap((f) => f.groups.map((g) => f.id + '/' + g.id)))
  const TONES = ['purple', 'gray', 'dash']
  const NODE_TONES = ['kaby', 'install']
  const STATUSES = ['done', 'half', 'todo']
  const KINDS = ['frames', 'v', 'h', 'elbow']
  const FX = 20
  const FW = 640

  // ── the frames: Kybernos, then its server, then the outside ──
  check('the frames are Kybernos, the server and the outside, in that order', JSON.stringify(frameIds) === JSON.stringify(['engine', 'server', 'outside']), frameIds)
  check('every frame has its fields, a tone, a height and groups', FRAMES.every((f) => f.title && f.short && TONES.includes(f.tone) && f.h > 0 && f.role && Array.isArray(f.limits) && f.limits.length > 0 && f.source && Array.isArray(f.groups) && f.groups.length > 0 && Array.isArray(f.notes)))
  check('frame tones are all different', new Set(FRAMES.map((f) => f.tone)).size === FRAMES.length)
  check('every frame holds at least one brick', FRAMES.every((f) => NODES.some((n) => n.frame === f.id)), frameIds.filter((id) => !NODES.some((n) => n.frame === id)))
  check('every group holds at least one brick', [...groupKeys].every((k) => NODES.some((n) => n.frame + '/' + n.group === k)), [...groupKeys].filter((k) => !NODES.some((n) => n.frame + '/' + n.group === k)))
  check('a note says where it is drawn, and a group label that has a place is inside the frame', FRAMES.every((f) => f.groups.every((g) => g.y === undefined || (typeof g.y === 'number' && g.y >= 0 && g.y <= f.h)) && f.notes.every((n) => n.t && typeof n.x === 'number' && typeof n.y === 'number' && n.y >= 0 && n.y <= f.h)))
  check('a band is a box inside its frame', FRAMES.every((f) => (f.bands || []).every((b) => b.x >= FX + 8 && b.x + b.w <= FX + FW - 8 && b.y >= 36 && b.y + b.h <= f.h - 8)))

  // ── the bricks ──
  check('brick ids are unique', new Set(ids).size === ids.length, ids.filter((x, i) => ids.indexOf(x) !== i))
  check('brick titles are unique (no brick said twice)', new Set(NODES.map((n) => n.t)).size === NODES.length, NODES.map((n) => n.t).filter((x, i, a) => a.indexOf(x) !== i))
  const NEEDED = ['id', 'frame', 'group', 'x', 'y', 'w', 'h', 't', 's', 'tip', 'role', 'cross', 'limits', 'where', 'source', 'st']
  check('every brick has its fields', NODES.every((n) => NEEDED.every((k) => n[k] !== undefined)), NODES.filter((n) => !NEEDED.every((k) => n[k] !== undefined)).map((n) => n.id))
  check('every brick has a valid status, frame and group', NODES.every((n) => STATUSES.includes(n.st) && frameById.has(n.frame) && groupKeys.has(n.frame + '/' + n.group)), NODES.filter((n) => !(STATUSES.includes(n.st) && frameById.has(n.frame) && groupKeys.has(n.frame + '/' + n.group))).map((n) => n.id))
  check('a brick that is not "built" says why', NODES.filter((n) => n.st !== 'done').every((n) => n.stNote), NODES.filter((n) => n.st !== 'done' && !n.stNote).map((n) => n.id))
  check('a tooltip is one short sentence or two', NODES.every((n) => n.tip.length > 20 && n.tip.length <= 200), NODES.filter((n) => n.tip.length <= 20 || n.tip.length > 200).map((n) => n.id))
  check('every brick says what it crosses and what it does not do', NODES.every((n) => Array.isArray(n.cross) && Array.isArray(n.limits) && n.limits.length > 0))
  check('what a brick holds is a list of titled entries with a valid status', NODES.every((n) => (n.inside || []).every((i) => i.t && (i.st === undefined || STATUSES.includes(i.st)))))
  check('a tone is "kaby" (the assistant) or "install" (a Kybernos install), a tag is "kaby", nothing else', NODES.every((n) => (n.tone === undefined || NODE_TONES.includes(n.tone)) && (n.tag === undefined || n.tag === 'kaby')))

  // ── the roadmap in the schema: seven new bricks, a planned list on nine others ──
  const NEW_BRICKS = { kyModel: ['todo', 'server', 'doors'], triggers: ['todo', 'server', 'doors'], customerAgent: ['half', 'engine', 'work'], customers: ['half', 'outside', 'row'], provider: ['todo', 'outside', 'row'], appStores: ['todo', 'outside', 'row'], commissions: ['todo', 'server', 'owner'] }
  const wrongNew = Object.entries(NEW_BRICKS).filter(([id, [st, fr, gr]]) => !byId.has(id) || byId.get(id).st !== st || byId.get(id).frame !== fr || byId.get(id).group !== gr).map(([id]) => id)
  check('the seven bricks of the roadmap are there, with their status, frame and group', wrongNew.length === 0, wrongNew)
  check('the outside brick for developers is renamed to name the model marketplaces too', byId.has('developers') && byId.get('developers').t === 'Developers and model marketplaces')
  check('a brick that has a customer-facing or commercial sibling says so: the customer agent is the front desk plugin, and the plugin exists', existsSync(join(REPO, 'packages', 'kybernos-front-desk', 'README.md')) && /front-desk/.test(byId.get('customerAgent').source))
  const PLANNED = { workers: ['workerPicker'], automations: ['createAutomation', 'genericTriggers'], kabyLink: ['whatsappStable', 'whatsappBsp', 'slack'], mobile: ['nativeBuild'], voice: ['phoneNumber'], kaby: ['kabyEmail'], queue: ['envelope'], cloudComputers: ['vault', 'localModelsCloud'], selfhosted: ['pullHost'] }
  const wrongPlan = Object.entries(PLANNED).filter(([id, want]) => !byId.has(id) || JSON.stringify((byId.get(id).planned || []).map((i) => i.id)) !== JSON.stringify(want)).map(([id]) => id)
  check('the planned lists are on the nine bricks the roadmap names, item by item', wrongPlan.length === 0, wrongPlan)
  check('a planned item has an id, a short title and at most a sentence or two', NODES.every((n) => n.planned === undefined || (Array.isArray(n.planned) && n.planned.length > 0 && new Set(n.planned.map((i) => i.id)).size === n.planned.length && n.planned.every((i) => /^[a-zA-Z]+$/.test(i.id) && i.t && i.t.length <= 80 && (i.d === undefined || i.d.length <= 200)))))

  // ── the layout: inside its frame, on nothing else, with text that fits ──
  const inside = (n) => { const f = frameById.get(n.frame); return n.x >= FX + 16 && n.x + n.w <= FX + FW - 16 && n.y >= 36 && n.y + n.h <= f.h - 8 }
  check('every brick sits inside its frame', NODES.every(inside), NODES.filter((n) => !inside(n)).map((n) => n.id))
  const overlaps = []
  for (const a of NODES) for (const b of NODES) {
    if (a.id < b.id && a.frame === b.frame && a.x < b.x + b.w + 12 && b.x < a.x + a.w + 12 && a.y < b.y + b.h + 8 && b.y < a.y + a.h + 8) overlaps.push(a.id + '/' + b.id)
  }
  check('no two bricks touch (12 px apart sideways, 8 px apart down)', overlaps.length === 0, overlaps)
  // 14 px semi-bold measures about 7.6 px a letter (the test counts 8), 12 px regular about 6.5 (counted 6.4); the box keeps 10 px on each side (more for the mark above the corner)
  // A title too long for its box is drawn on its own `lines` (the first one bold): the full title stays in `t` for the sheet and the links.
  const drawn = (n) => n.lines || [n.t, n.s].concat(n.s2 ? [n.s2] : [])
  check('a brick that is drawn on its own lines has two or three of them', NODES.every((n) => n.lines === undefined || (Array.isArray(n.lines) && n.lines.length >= 2 && n.lines.length <= 3 && n.lines.every((x) => typeof x === 'string' && x !== ''))), NODES.filter((n) => n.lines !== undefined).map((n) => n.id))
  const tight = NODES.filter((n) => drawn(n)[0].length * 8 + 20 > n.w || drawn(n).slice(1).some((x) => x.length * 6.4 + 16 > n.w))
  check('what is drawn on a brick (title, subtitle) fits the box that holds it', tight.length === 0, tight.map((n) => n.id))
  check('a box has two lines, or three with a second subtitle, and is tall enough', NODES.every((n) => n.h >= (drawn(n).length === 3 ? 60 : 46)), NODES.filter((n) => n.h < (drawn(n).length === 3 ? 60 : 46)).map((n) => n.id))
  check('bricks on one row have the same height', NODES.every((a) => NODES.every((b) => a.frame !== b.frame || a.y !== b.y || a.h === b.h)))
  check('a frame id is never a brick id (a link end can be either)', frameIds.every((id) => !byId.has(id)))

  // ── the links ──
  const lids = LINKS.map((l) => l.id)
  check('link ids are unique', new Set(lids).size === lids.length, lids.filter((x, i) => lids.indexOf(x) !== i))
  check('every link has a title, a description and what it crosses', LINKS.every((l) => l.t && l.d && Array.isArray(l.cross) && KINDS.includes(l.kind)))
  const end = (id) => byId.has(id) || frameById.has(id)
  check('every link joins two things that exist', LINKS.every((l) => end(l.a) && end(l.b)), LINKS.filter((l) => !(end(l.a) && end(l.b))).map((l) => l.id))
  const order = (id) => frameIds.indexOf(frameById.has(id) ? id : byId.get(id).frame)
  const geo = LINKS.map((l) => {
    if (l.kind === 'frames') return [l.id, frameById.has(l.a) && frameById.has(l.b) && order(l.a) < order(l.b) && l.x > FX + 20 && l.x < FX + FW - 20]
    if (l.kind === 'v') { const A = byId.get(l.a); const B = byId.get(l.b); const above = A && B && (order(l.a) < order(l.b) || (A.frame === B.frame && A.y + A.h <= B.y)); return [l.id, above && Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x) >= 20] }
    if (l.kind === 'h') { const A = byId.get(l.a); const B = byId.get(l.b); return [l.id, A && B && A.frame === B.frame && A.y === B.y && A.x + A.w < B.x] }
    // an elbow runs from a frame's edge (ay) or from a brick, along the left or the right margin (lane), into a brick
    const laneOk = l.lane === undefined || (typeof l.lane === 'number' && (l.side === 'right' ? l.lane >= FX + FW + 4 && l.lane <= 676 : l.lane >= 4 && l.lane <= FX - 4))
    return [l.id, byId.has(l.b) && (frameById.has(l.a) ? typeof l.ay === 'number' : byId.has(l.a)) && order(l.a) <= order(l.b) && (l.side === undefined || l.side === 'left' || l.side === 'right') && laneOk]
  })
  check('every link can be drawn: a vertical one joins a brick above another, a horizontal one two in a row, an elbow runs along a margin', geo.every(([, ok]) => ok), geo.filter(([, ok]) => !ok).map(([id]) => id))
  // the page stacks the frames with a 36 px gap, 20 px from the top (GAP and TOP in the script): the same sums give a brick's place on the page
  const fyOf = (id) => { let y = 20; for (const f of FRAMES) { if (f.id === id) return y; y += f.h + 36 } return y }
  const abs = (n) => ({ x: n.x, r: n.x + n.w, y: fyOf(n.frame) + n.y, b: fyOf(n.frame) + n.y + n.h })
  const crossed = []
  for (const l of LINKS.filter((k) => k.kind === 'v')) {
    const A = abs(byId.get(l.a)); const B = abs(byId.get(l.b)); const x = (Math.max(A.x, B.x) + Math.min(A.r, B.r)) / 2
    const [y1, y2] = A.y < B.y ? [A.b, B.y] : [B.b, A.y]
    for (const c of NODES) { if (c.id === l.a || c.id === l.b) continue; const C = abs(c); if (x > C.x - 4 && x < C.r + 4 && C.y < y2 && C.b > y1) crossed.push(l.id + ' crosses ' + c.id) }
  }
  check('no vertical line crosses a brick', crossed.length === 0, crossed)
  check('a link that is a target says so and is dashed', LINKS.filter((l) => l.target).every((l) => l.dash === true))
  check('a reversed link (arrow toward the brick above) is a vertical one', LINKS.filter((l) => l.rev).every((l) => l.kind === 'v' && !l.two))

  // ── the server: an admin side, a user side, one queue the doors feed ──
  const grp = (g) => NODES.filter((n) => n.frame === 'server' && n.group === g)
  const server = frameById.get('server')
  check('the server frame has two bands, an admin side and a user side', server && (server.bands || []).length === 2)
  check('the admin side holds a team console and an owner page, the user side holds the account page and the cloud computers', grp('team').length >= 3 && grp('owner').length >= 2 && grp('owner').some((n) => n.id === 'commissions') && grp('user').some((n) => n.id === 'account') && grp('user').some((n) => n.id === 'cloudComputers'))
  check('every admin and user brick sits inside its band', ['team', 'owner', 'user'].every((g) => grp(g).every((n) => (server.bands || []).some((b) => n.x >= b.x && n.x + n.w <= b.x + b.w && n.y >= b.y && n.y + n.h <= b.y + b.h))), ['team', 'owner', 'user'].flatMap((g) => grp(g)).filter((n) => !(server.bands || []).some((b) => n.x >= b.x && n.x + n.w <= b.x + b.w && n.y >= b.y && n.y + n.h <= b.y + b.h)).map((n) => n.id))
  const queueIn = LINKS.filter((l) => l.a === 'queue' && l.rev).map((l) => l.b).sort()
  check('every door feeds the one task queue: Kaby link, Kaby MCP, the API, and the two still to build (triggers, the Kybernos model)', JSON.stringify(queueIn) === JSON.stringify(['api', 'kabyLink', 'kabyMcp', 'kyModel', 'triggers']), queueIn)
  const queue = byId.get('queue')
  check('the queue is one bar above all the doors', grp('doors').length >= 5 && grp('doors').every((n) => n.x >= queue.x && n.x + n.w <= queue.x + queue.w && n.y > queue.y + queue.h))
  check('the queue reaches the cloud computers and a local install', LINKS.some((l) => l.a === 'cloudComputers' && l.b === 'queue') && LINKS.some((l) => l.a === 'ownInstall' && l.b === 'queue'))

  // ── the story ──
  const sids = STORY.map((s) => s.id)
  check('story step ids are unique', new Set(sids).size === sids.length)
  check('every step has a title and a text', STORY.every((s) => s.title && s.text && s.text.length > 40))
  check('every step points at bricks and links that exist', STORY.every((s) => (s.nodes === 'ahead' || (Array.isArray(s.nodes) && s.nodes.length > 0 && s.nodes.every((n) => byId.has(n)))) && Array.isArray(s.links) && s.links.every((l) => lids.includes(l))), STORY.filter((s) => !((s.nodes === 'ahead' || (Array.isArray(s.nodes) && s.nodes.every((n) => byId.has(n)))) && s.links.every((l) => lids.includes(l)))).map((s) => s.id))
  check('there are at most nine steps', STORY.length >= 3 && STORY.length <= 9, STORY.length)
  const ahead = (n) => n.st !== 'done' || (Array.isArray(n.planned) && n.planned.length > 0)
  check('the last step is "Where we go next" and lights what is not fully built or has something planned', STORY[STORY.length - 1].title === 'Where we go next' && STORY[STORY.length - 1].nodes === 'ahead')
  const told = new Set(STORY.flatMap((s) => (s.nodes === 'ahead' ? NODES.filter(ahead).map((n) => n.id) : s.nodes)))
  check('every brick is told by at least one step', NODES.every((n) => told.has(n.id)), NODES.filter((n) => !told.has(n.id)).map((n) => n.id))
  check('the page says when it was read', typeof RAW.asof === 'string' && /\d{4}-\d{2}-\d{2}/.test(RAW.asof))

  // ── cited documents exist ──
  const cites = []
  for (const f of FRAMES) cites.push([f.id, f.source])
  for (const n of NODES) { cites.push([n.id, n.source]); for (const i of n.inside || []) if (i.src) cites.push([n.id + ':' + i.t, i.src]) }
  const missing = []
  for (const [who, text] of cites) {
    for (const m of String(text).matchAll(/(?<![\w/.-])((?:docs|packages|services|scripts)\/[\w./-]*[\w-])/g)) {
      const p = m[1].replace(/[.,;]+$/, '')
      if (!existsSync(join(REPO, p))) missing.push(who + ' → ' + p)
    }
  }
  check('every document the page cites exists in this repository', missing.length === 0, missing.slice(0, 6))

  // ── evidence: what a brick says is checked against the code it was read from ──
  // A brick may carry `evidence: [{ repo, path, has | absent }]`. `has` is a text the file holds; `absent` is a text that no file under
  // `path` holds (a "not built" claim needs an absence: when someone builds it, this fails and the page must be updated).
  // `repo: 'plugins'` is checked in this repository. `repo: 'server'` is checked at the commit named by `RAW.serverRef`, in the server
  // repository beside this one (or KYBERNOS_SERVER_REPO); where that repository is not there (CI of this repository), those items are
  // skipped and counted, never passed in silence.
  check('the page names the server commit its server claims were read at', typeof RAW.serverRef === 'string' && /^[0-9a-f]{7,40}$/.test(RAW.serverRef), RAW.serverRef)
  const gitIn = (cwd, args) => spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
  const commonDir = gitIn(REPO, ['rev-parse', '--path-format=absolute', '--git-common-dir']).stdout.trim()
  const SERVER = process.env.KYBERNOS_SERVER_REPO || (commonDir ? resolve(dirname(commonDir), '..', 'kybernos-server') : '')
  const serverThere = SERVER !== '' && existsSync(join(SERVER, '.git')) && gitIn(SERVER, ['cat-file', '-e', RAW.serverRef + '^{commit}']).status === 0
  const evidence = NODES.flatMap((n) => (n.evidence || []).map((e) => ({ brick: n.id, ...e })))
  const malformed = evidence.filter((e) => !['plugins', 'server'].includes(e.repo) || typeof e.path !== 'string' || e.path === '' || (typeof e.has === 'string') === (typeof e.absent === 'string'))
  check('every evidence item says which repository, which path, and one of has or absent', malformed.length === 0, malformed.map((e) => e.brick))
  const broken = []
  let skipped = 0
  let verified = 0
  for (const e of evidence) {
    const what = e.brick + ': ' + e.path + (e.has ? ' has ' : ' lacks ') + JSON.stringify(e.has || e.absent)
    if (malformed.includes(e)) continue
    if (e.repo === 'server' && !serverThere) { skipped += 1; continue }
    verified += 1
    if (e.has !== undefined) {
      const text = e.repo === 'plugins'
        ? (existsSync(join(REPO, e.path)) ? readFileSync(join(REPO, e.path), 'utf8') : '')
        : (gitIn(SERVER, ['show', RAW.serverRef + ':' + e.path]).stdout || '')
      if (!text.includes(e.has)) broken.push(what)
    } else {
      const r = e.repo === 'plugins' ? gitIn(REPO, ['grep', '-F', '-q', '-e', e.absent, '--', e.path]) : gitIn(SERVER, ['grep', '-F', '-q', '-e', e.absent, RAW.serverRef, '--', e.path])
      if (r.status === 0) broken.push(what)
    }
  }
  check('every evidence item still holds in the code it was read from', broken.length === 0, broken)
  check('the claims about the queue, Kaby link, the API and the cloud computer carry evidence', ['queue', 'kabyLink', 'api', 'cloudComputers'].every((id) => (byId.get(id).evidence || []).length > 0))
  console.log(`  · evidence: ${evidence.length} items on ${new Set(evidence.map((e) => e.brick)).size} bricks; ${verified} checked${skipped ? `, ${skipped} server items SKIPPED (the server repository is not beside this one)` : ''}`)

  // ── the private overlay (roadmap.private.js): optional, never committed, and well-behaved either way ──
  // The page's own helper block is run here against synthetic overlays: with none, a broken one, and a good one.
  const hStart = script.indexOf('/* ── the optional private overlay')
  const hEnd = /const ahead = [^\n]*\n/.exec(script.slice(Math.max(hStart, 0)))
  check('the overlay helpers are in the page, between two known marks', hStart > 0 && Boolean(hEnd))
  if (hStart > 0 && hEnd) {
    const helpers = script.slice(hStart, hStart + hEnd.index + hEnd[0].length)
    const run = (ctx) => vm.runInNewContext(helpers + '\n;({ whens: RAW.NODES.filter((n) => n.when).map((n) => n.id + ":" + n.when), HAS_WHEN, PRIV: PRIV !== null })', { RAW: JSON.parse(JSON.stringify({ NODES })), ...ctx })
    const none = run({ window: {} })
    check('without the overlay: no When on any brick, no When filter', none.whens.length === 0 && none.HAS_WHEN === false && none.PRIV === false, none)
    let noWindow = null
    try { noWindow = run({}) } catch (e) { noWindow = e.message }
    check('without a window (or with an overlay that throws when read), the page does not break', noWindow && noWindow.PRIV === false && run({ window: Object.defineProperty({}, 'KB_PRIVATE', { get () { throw new Error('no') } }) }).PRIV === false, noWindow)
    const broken = [{ nodes: 'x' }, { nodes: [] , x: 1 }, 'text', 42, null].map((p) => run({ window: { KB_PRIVATE: p } }))
    check('a broken overlay is ignored', broken.every((r) => r.PRIV === false && r.whens.length === 0), broken)
    const lenient = run({ window: { KB_PRIVATE: { nodes: { workers: { when: 'soon', planned: { workerPicker: { when: 'someday' }, nothing: { when: 'now' } } }, queue: null, nope: { when: 'now' } } } } })
    check('an unknown horizon, an unknown planned item and an unknown brick are skipped, not fatal', lenient.PRIV === true && lenient.whens.length === 0 && lenient.HAS_WHEN === false, lenient)
    const good = run({ window: { KB_PRIVATE: { nodes: { workers: { planned: { workerPicker: { when: 'later' } } }, queue: { when: 'now', planned: { envelope: { when: 'later' } } }, automations: { planned: { createAutomation: { when: 'later' }, genericTriggers: { when: 'next' } } }, kyModel: { when: 'next' } } } } })
    check('a horizon is the brick\'s own, else the earliest of its planned items', JSON.stringify(good.whens.sort()) === JSON.stringify(['automations:next', 'kyModel:next', 'queue:now', 'workers:later']) && good.HAS_WHEN === true, good.whens)
  }
  const overlayFile = join(DIR, OVERLAY)
  if (existsSync(overlayFile)) {
    const win = {}
    let loaded = true
    try { vm.runInNewContext(readFileSync(overlayFile, 'utf8'), { window: win }) } catch (e) { loaded = e.message }
    const P = win.KB_PRIVATE
    check('the private overlay loads and sets window.KB_PRIVATE', loaded === true && P && typeof P === 'object' && P.nodes && typeof P.nodes === 'object', loaded)
    if (loaded === true && P && P.nodes) {
      const WHENS = ['now', 'next', 'later']
      const badNode = Object.keys(P.nodes).filter((id) => !byId.has(id))
      check('every brick the overlay names exists', badNode.length === 0, badNode)
      const badWhen = []
      const badPlan = []
      const badNote = []
      for (const [id, o] of Object.entries(P.nodes)) {
        if (!byId.has(id)) continue
        if (o.when !== undefined && !WHENS.includes(o.when)) badWhen.push(id)
        for (const [pid, q] of Object.entries(o.planned || {})) {
          if (!(byId.get(id).planned || []).some((i) => i.id === pid)) badPlan.push(id + '/' + pid)
          if (q.when !== undefined && !WHENS.includes(q.when)) badWhen.push(id + '/' + pid)
        }
        for (const x of o.notes || []) if (!x || typeof x.t !== 'string' || (x.d !== undefined && typeof x.d !== 'string')) badNote.push(id)
      }
      check('every horizon is now, next or later, and every planned item it names is in the brick\'s sheet', badWhen.length === 0 && badPlan.length === 0, { badWhen, badPlan })
      check('every private note has a title and a text', badNote.length === 0, badNote)
      const badStory = Object.keys(P.story || {}).filter((id) => !sids.includes(id))
      check('every story step the overlay speaks of exists', badStory.length === 0, badStory)
      const untagged = NODES.filter((n) => ahead(n) && n.st !== 'done' && !((P.nodes[n.id] || {}).when || Object.values((P.nodes[n.id] || {}).planned || {}).some((q) => q.when)))
      console.log('  · overlay: ' + Object.keys(P.nodes).length + ' bricks named; not fully built and with no horizon: ' + untagged.map((n) => n.id).join(', '))
    }
  } else {
    console.log('  · private overlay: not there (the public page is what was checked)')
  }

  const count = (st) => NODES.filter((n) => n.st === st).length
  console.log(`  · ${NODES.length} bricks in ${FRAMES.length} frames, ${LINKS.length} links, ${STORY.length} story steps; built ${count('done')}, partly ${count('half')}, not built ${count('todo')}`)
}

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
