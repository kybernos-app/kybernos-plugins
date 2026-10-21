// The account menu's spaces, the plan card by role, the wait on a switch and the composer's cues of a team space (plan « Équipes », steps 1, 2, 3 and 7).
//   node packages/kybernos-cloud/test-teams-menu.mjs
//
// The pure rules are cut out of client.js (the marked blocks `space-face`, `quota-notice-text` and `teams-menu`) and run on their own, so what is proven is the shipped code.
// The rendered menu, the real clicks, the screenshots and the delay of a switch are `scripts/check-footer-live.mjs` (« Teams menu »); the wiring and the host half are
// pinned in test-cloud-client.mjs and test-cloud-host.mjs.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + JSON.stringify(detail)))
  if (!ok) failed += 1
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, 'client.js'), 'utf8')
const block = (open, close) => {
  const from = source.indexOf(open)
  const to = source.indexOf(close, from)
  return from > 0 && to > from ? source.slice(from, to) : null
}
const faceSrc = block('// <space-face:begin>', '// <space-face:end>')
const quotaSrc = block('// <quota-notice-text>', '// </quota-notice-text>')
const teamsSrc = block('// <teams-menu:begin>', '// <teams-menu:end>')
check('the three blocks are where the test expects them', faceSrc !== null && quotaSrc !== null && teamsSrc !== null)
const lib = new Function(faceSrc + '\n' + quotaSrc + '\n' + teamsSrc + `
return { INLINE_SPACES_MAX, spacesMenuMode, spaceIsPersonal, spaceIsAdmin, spaceHue, SPACE_HUES, SWITCH_WAIT_MIN_MS, SWITCH_WAIT_MAX_MS, switchPlan, switchState,
  planCardModel, spaceRowOf, spaceCueOf, PERSONAL_MEMORY_CUT, placeholderNext, quotaMeterOf, planDeEspace, subPanelBox, SUB_PANEL_WIDTH }`)()

// The dictionary of one language, read from the source (the strings the page uses): French is the first block of client.js, English the last.
const frFrom = source.indexOf('      fr: {')
const enFrom = source.indexOf('      en: {')
const dictOf = (lang) => (lang === 'en' ? source.slice(enFrom, source.indexOf('\n      },', enFrom)) : source.slice(frFrom, enFrom))
const translator = (lang) => (key) => {
  const m = new RegExp('\\b' + key + ": '((?:[^'\\\\]|\\\\.)*)'").exec(dictOf(lang))
  // the dictionary writes its non-breaking space as the six characters backslash-u-0-0-a-0: read them back as the character
  return m === null ? key : m[1].replace(/\\'/g, "'").split(String.fromCharCode(92) + 'u00a0').join(String.fromCharCode(0xa0))
}
const t = translator('en')
const fr = translator('fr')
const NBSP = String.fromCharCode(0xa0)
const plain = (s) => (typeof s === 'string' ? s.split(NBSP).join(' ') : s)

const NOW = Date.parse('2026-10-18T12:00:00.000Z')
const inH = (h) => new Date(NOW + h * 3600000).toISOString()
const win = (kind, seconds, percent, extra = {}) => ({ kind, window_seconds: seconds, scope: 'plan', used_percent: percent, exhausted: false, resets_at: null, ...extra })
const full = (kind, seconds, extra = {}) => win(kind, seconds, 100, { exhausted: true, ...extra })
const facts = (usage, extra = {}) => ({ ok: true, workspace: {}, payment_blocked: false, usage, ...extra })
const personalSpace = { id: 'p', name: 'My workspace', personal: true, role: 'owner' }
const team = (role, id = 't1', name = 'Acme') => ({ id, name, personal: false, role })
const TEAM_PLAN = { none: false, free: false }
const FREE_PLAN = { none: false, free: true }
const NO_PLAN = { none: true, free: true }
const card = (o) => lib.planCardModel({ t, now: NOW, title: 'Team', planInfo: TEAM_PLAN, facts: null, ...o })

console.log('the menu lists the spaces itself up to three, from four the top row stays « Switch team »')
{
  check('the threshold is ONE constant, 3 (Personal + 2 teams)', lib.INLINE_SPACES_MAX === 3 && (source.match(/INLINE_SPACES_MAX = /g) || []).length === 1)
  check('1, 2 and 3 spaces: listed in the menu', [1, 2, 3].every((n) => lib.spacesMenuMode(n) === 'inline'))
  check('4, 6 and 12 spaces: the « Switch team » row with its arrows', [4, 6, 12].every((n) => lib.spacesMenuMode(n) === 'submenu'))
  check('nothing known yet (0, undefined, NaN, a string): the old row, which names a fallback team', [0, undefined, NaN, '3', null, -1, 2.5].every((n) => lib.spacesMenuMode(n) === 'submenu'))
  check('the threshold is read only through spacesMenuMode (no second copy of the number)', source.split('\n').filter((l) => !l.trim().startsWith('//') && l.includes('INLINE_SPACES_MAX')).length === 2, source.split('\n').filter((l) => !l.trim().startsWith('//') && l.includes('INLINE_SPACES_MAX')))
}

console.log('a team has its own colour, a personal space none')
{
  check('personal: none', lib.spaceHue(personalSpace) === null && lib.spaceHue({ id: 'x', name: 'My workspace' }) === null)
  check('a team always gets the same colour, one of the six', lib.spaceHue(team('admin', 'abc')) === lib.spaceHue(team('member', 'abc', 'Other name')) && lib.SPACE_HUES.includes(lib.spaceHue(team('admin', 'abc'))))
  const seen = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'].map((id) => lib.spaceHue(team('member', id))))
  check('twelve ids spread over several colours', seen.size >= 4, [...seen])
  check('unreadable input: none, never a throw', lib.spaceHue(null) === null && lib.spaceHue(undefined) === null && lib.spaceHue('x') === null)
}

console.log('the rows of the list')
{
  const row = (w, o = {}) => lib.spaceRowOf(w, { t, activeId: 'p', userName: 'Local test', planLabel: 'Free', facts: null, ...o })
  const acme = row(team('admin'), { facts: { members: 6, usage: [win('member', 18000, 12), win('pool', 2592000, 84)] } })
  check('a team: the kind leads, then the role, then the count (« Team · Admin · 6 members »)', acme.sub === 'Team · Admin · 6 members', acme.sub)
  check('the owner is an Owner, a member a Member', row(team('owner'), { facts: { members: 2 } }).sub === 'Team · Owner · 2 members' && row(team('member'), { facts: { members: 3 } }).sub === 'Team · Member · 3 members')
  check('one member is « 1 member », not « 1 members »', row(team('admin'), { facts: { members: 1 } }).sub === 'Team · Admin · 1 member')
  check('the head count not known (menu just opened): the kind and the role alone', row(team('member')).sub === 'Team · Member' && row(team('member'), { facts: { members: null, usage: null } }).sub === 'Team · Member')
  check('the personal space: the kind, then the name, then the plan', row(personalSpace).sub === 'Personal · Local test · Free', row(personalSpace).sub)
  check('the personal space with no plan name known: kind and name; with neither: the kind alone', row(personalSpace, { planLabel: '' }).sub === 'Personal · Local test' && row(personalSpace, { planLabel: '', userName: '' }).sub === 'Personal')
  check('the usage of an admin is the team\'s pool, as the card says (84%, near)', acme.percent === 84 && acme.level === 'near', acme)
  const mine = row(team('member'), { facts: { members: 6, usage: [win('member', 18000, 12), win('pool', 2592000, 84)] } })
  check('the usage of a member is their own window (12%, ok)', mine.percent === 12 && mine.level === 'ok', mine)
  const out = row(team('member'), { facts: { members: 6, usage: [win('member', 18000, 12), full('pool', 2592000, { resets_at: inH(3) })] } })
  check('a used-up pool turns everyone away: that window is the one shown (100%, full)', out.percent === 100 && out.level === 'full', out)
  check('no window read: no percent (a row without a bar, not a 0%)', row(team('admin')).percent === null && row(team('admin'), { facts: { members: 2, usage: [] } }).percent === null)
  check('the tile has the initials of the shown name (Personal, not My workspace)', row(personalSpace).name === 'Personal' && row(personalSpace).initials === 'PE' && acme.initials === 'AC', [row(personalSpace).name, row(personalSpace).initials, acme.initials])
  check('the active one is marked, the others are not', row(personalSpace).current === true && acme.current === false)
  check('a team carries its colour, the personal space none', acme.hue !== null && row(personalSpace).hue === null)
  const frRow = lib.spaceRowOf(team('admin'), { t: fr, activeId: 'p', facts: { members: 6 } })
  check('in French: the kind leads too (Équipe · Admin · 6 membres)', frRow.sub === 'Équipe · Admin · 6 membres', frRow.sub)
  const text = JSON.stringify([acme, mine, out])
  check('no money anywhere in a row', !/[$€]|usd|credit/i.test(text), text)
}

console.log('the plan card by role')
{
  const pool = (p, extra) => win('pool', 2592000, p, extra)
  const base = [pool(84), win('member', 18000, 12), win('member', 604800, 30)]
  const member = card({ space: team('member'), facts: facts(base) })
  check('a member of a team: the Team bar (30 days), then their own 5 hours and 7 days', same(member.rows.map((r) => [r.key, r.label, r.percent, r.note]), [['team', 'Team', 84, 'Last 30 days'], ['you', 'You', 12, 'Last 5 hours'], ['you', 'You', 30, 'Last 7 days']]), member.rows)
  check('and neither Manage nor Add credits', same(member.actions, []), member.actions)
  const admin = card({ space: team('admin'), facts: facts(base) })
  check('an admin gets Manage', same(admin.actions, ['manage']), admin.actions)
  check('an owner too', same(card({ space: team('owner'), facts: facts(base) }).actions, ['manage']))
  const poolFull = [pool(100, { exhausted: true, resets_at: inH(3) }), win('member', 18000, 12), win('member', 604800, 30)]
  const adminFull = card({ space: team('admin'), facts: facts(poolFull) })
  check('an admin of a team whose pool is used up also gets Add credits', same(adminFull.actions, ['manage', 'credits']), adminFull.actions)
  const memberFull = card({ space: team('member'), facts: facts(poolFull) })
  check('a member of that team gets neither, and the card says when it is back', same(memberFull.actions, []) && memberFull.rows[0].full === true && plain(memberFull.rows[0].note) === 'Back in about 3 h', memberFull.rows[0])
  check('Add credits is never offered while the pool has room', !card({ space: team('admin'), facts: facts(base) }).actions.includes('credits'))
  const free = card({ space: personalSpace, title: 'Free', planInfo: FREE_PLAN, facts: facts([win('member', 2592000, 5), win('member', 18000, 1)]) })
  check('a free personal space: Upgrade and ONE allowance bar (the one closest to full)', same(free.actions, ['upgrade']) && free.rows.length === 1 && free.rows[0].percent === 5 && free.rows[0].key === 'allowance' && free.rows[0].note === 'Last 30 days', free)
  const paid = card({ space: personalSpace, title: 'Solo Plus', planInfo: { none: false, free: false }, facts: facts([win('member', 18000, 40)]) })
  check('a paid personal space: the bar, no action in the card', same(paid.actions, []) && paid.rows.length === 1 && paid.rows[0].percent === 40, paid)
  const none = card({ space: team('admin'), title: 'No plan', planInfo: NO_PLAN, facts: facts([]) })
  check('a team nobody bought a plan for: « Choose a plan », no bar', same(none.actions, ['choose']) && none.rows.length === 0, none)
  const unread = card({ space: team('admin'), facts: null })
  check('the allowance not read yet: no bar, the role\'s action only, never « Add credits » (the pool is not known to be full)', unread.rows.length === 0 && same(unread.actions, ['manage']), unread)
  check('an unreadable answer is read as not read', card({ space: team('admin'), facts: { ok: false } }).rows.length === 0)
  check('a Free plan on a team keeps its Upgrade', card({ space: team('admin'), planInfo: FREE_PLAN, facts: facts(base) }).actions.join() === 'manage,upgrade')
  check('a team with no limit on its own windows (only a pool): the Team bar alone', card({ space: team('member'), facts: facts([pool(10)]) }).rows.map((r) => r.key).join() === 'team')
  check('windows of another length than 5 h and 7 d: the one closest to full stands in for them', card({ space: team('member'), facts: facts([win('member', 86400, 20), win('member', 2592000, 60)]) }).rows.map((r) => [r.percent, r.note]).join('|') === '60,Last 30 days')
  const blocked = card({ space: team('member'), facts: facts([win('member', 86400, 100, { exhausted: true, resets_at: inH(5) }), win('member', 18000, 5), win('member', 604800, 7)]) })
  check('a window of the person that is used up is shown even when it is not the 5 h or the 7 d one', blocked.rows.length === 3 && blocked.rows.some((r) => r.full === true && r.note === 'Back in about 5 h' || (r.full === true && plain(r.note) === 'Back in about 5 h')), blocked.rows)
  const pay = card({ space: team('member'), facts: facts([], { payment_blocked: true }) })
  check('a blocked payment reads 100% and says so', pay.rows.length === 1 && pay.rows[0].percent === 100 && pay.rows[0].level === 'full' && pay.rows[0].note === 'Payment failed', pay.rows)
  const levels = card({ space: team('member'), facts: facts([pool(74), win('member', 18000, 75), win('member', 604800, 99)]) }).rows.map((r) => r.level)
  check('the bars turn amber from 75% (QUOTA_NEAR_PERCENT), never before', levels.join() === 'ok,near,near', levels)
}

console.log('percent and bars only: the sentence of a window')
{
  const row = (w, space = team('member')) => card({ space, facts: facts([w, ...(w.kind === 'pool' ? [] : [])]) }).rows
  const open = card({ space: team('member'), facts: facts([win('pool', 2592000, 40), win('member', 18000, 40), win('member', 604800, 40)]) }).rows
  check('a window with room says how long it is (« Last 7 days »), nothing about a time of return', open.map((r) => r.note).join('|') === 'Last 30 days|Last 5 hours|Last 7 days', open.map((r) => r.note))
  check('never « Resets », never « Back » for a window that is not used up', open.every((r) => !/reset|back/i.test(r.note) && !/reset|back/i.test(r.title)), open)
  const used = card({ space: team('member'), facts: facts([win('pool', 2592000, 50), full('member', 18000, { resets_at: inH(3) }), win('member', 604800, 30)]) }).rows.find((r) => r.full)
  check('a window that is used up says « Back in about 3 h » (the server\'s time)', used !== undefined && plain(used.note) === 'Back in about 3 h' && used.percent === 100 && used.level === 'full', used)
  const unknown = card({ space: team('member'), facts: facts([win('pool', 2592000, 50), full('member', 18000), win('member', 604800, 30)]) }).rows.find((r) => r.full)
  check('used up with no time from an older server: « Used up », and the tooltip keeps the « whole again » words', unknown !== undefined && unknown.note === 'Used up' && unknown.title === 'as older use leaves that window, and is whole again 5 hours after your last call', unknown)
  const past = card({ space: team('member'), facts: facts([full('member', 18000, { resets_at: new Date(NOW - 60000).toISOString() })]) }).rows[0]
  check('a time already past is not shown', past.note === 'Used up', past)
  const days = card({ space: team('member'), facts: facts([full('member', 604800, { resets_at: inH(72) })]) }).rows[0]
  check('days when it is more than two days away', plain(days.note) === 'Back in about 3 days', days.note)
  const mins = card({ space: team('member'), facts: facts([full('member', 18000, { resets_at: new Date(NOW + 25 * 60000).toISOString() })]) }).rows[0]
  check('minutes when it is under an hour', plain(mins.note) === 'Back in about 25 min', mins.note)
  const capped = card({ space: team('member', 't9', 'Acme'), facts: facts([win('member', 604800, 30, { scope: 'team' })]) }).rows[0]
  check('a cap an admin set says where it was set', capped.note === 'Last 7 days (a cap set in Acme)', capped.note)
  const personalCap = card({ space: personalSpace, planInfo: FREE_PLAN, facts: facts([win('member', 604800, 30, { scope: 'team' })]) }).rows[0]
  check('the cap wording follows the space\'s name', personalCap.note.includes('(a cap set in this team)') || personalCap.note.includes('(a cap set in'), personalCap.note)
  const skewed = lib.planCardModel({ t, title: 'Team', planInfo: TEAM_PLAN, space: team('member'), facts: { ok: true, skew_ms: 3 * 3600000, usage: [full('member', 18000, { resets_at: new Date(Date.now() + 6 * 3600000).toISOString() })] } }).rows[0]
  check('a clock that is hours off is corrected by the server\'s own stamp', plain(skewed.note) === 'Back in about 3 h', skewed.note)
  void row
  const all = JSON.stringify([open, used, unknown, days, mins, capped])
  check('no dollar, no credit, no token in any bar', !/[$€]|usd|credit|token/i.test(all), all)
  const f = card({ space: team('member'), facts: facts([win('pool', 2592000, 50), full('member', 18000, { resets_at: inH(3) })]) })
  const frCard = lib.planCardModel({ t: fr, now: NOW, title: 'Team', planInfo: TEAM_PLAN, space: team('member'), facts: facts([win('pool', 2592000, 50), full('member', 18000, { resets_at: inH(3) }), win('member', 604800, 30)]) })
  check('in French: « Sur 30 jours », « Revient dans environ 3 h »', frCard.rows[0].note === 'Sur 30 jours' && plain(frCard.rows[1].note) === 'Revient dans environ 3 h' && frCard.rows[0].label === 'Équipe' && frCard.rows[1].label === 'Toi', frCard.rows.map((r) => [r.label, r.note]))
  void f
}

console.log('the wait on a switch: the footer says « switching » until DSH runs the new route')
{
  check('a route that already names the team, or a server with no model service: nothing to wait for', lib.switchPlan('current') === 'done' && lib.switchPlan('none') === 'done')
  check('a route the host could not rewrite: said at once (the choice is kept, the billing is not)', lib.switchPlan('failed') === 'stale' && lib.switchPlan('not_written') === 'stale')
  check('a route that was written (or an answer from an older host that says nothing): wait', lib.switchPlan('written') === 'wait' && lib.switchPlan(undefined) === 'wait')
  check('applied: done, whatever the time', lib.switchState(true, 0) === 'done' && lib.switchState(true, 60000) === 'done')
  check('not applied yet: wait, until the maximum', lib.switchState(false, 0) === 'wait' && lib.switchState(false, lib.SWITCH_WAIT_MAX_MS - 1) === 'wait')
  check('not applied at the maximum: slow (the person is told to wait before sending)', lib.switchState(false, lib.SWITCH_WAIT_MAX_MS) === 'slow' && lib.switchState(null, lib.SWITCH_WAIT_MAX_MS) === 'slow')
  check('DSH cannot say (null): a fixed minimum, then done', lib.switchState(null, 0) === 'wait' && lib.switchState(null, lib.SWITCH_WAIT_MIN_MS - 1) === 'wait' && lib.switchState(null, lib.SWITCH_WAIT_MIN_MS) === 'done')
  check('the minimum is above the 2-3 s DSH takes to reload (measured in October), the maximum well above it', lib.SWITCH_WAIT_MIN_MS >= 3000 && lib.SWITCH_WAIT_MAX_MS >= 10000)
}

console.log('the composer\'s cues in a team space')
{
  check('the personal space has none', lib.spaceCueOf(personalSpace, null, t) === null && lib.spaceCueOf(null, null, t) === null && lib.spaceCueOf(undefined, null, t) === null)
  const c = lib.spaceCueOf(team('member'), null, t)
  check('« Message Acme… » and « What is Acme working on? »', c.placeholder === 'Message Acme…' && c.heading === 'What is Acme working on?', c)
  check('in French', lib.spaceCueOf(team('member'), null, fr).placeholder === 'Écrire à Acme…' && lib.spaceCueOf(team('member'), null, fr).heading === 'Sur quoi travaille Acme ?')
  check('the pill carries the team\'s colour', c.hue === lib.spaceHue(team('member')) && c.hue !== null)
  check('ONE constant decides whether the pill says the personal memory is off, and it is on now that the memory cut has landed', lib.PERSONAL_MEMORY_CUT === true && (source.match(/const PERSONAL_MEMORY_CUT = /g) || []).length === 1)
  check('the pill says « Team memory · personal off » by default, with the reason in its title', c.memory === 'Team memory · personal off' && /never reach colleagues/.test(c.memoryTitle), c)
  const plain = lib.spaceCueOf(team('member'), null, t, false)
  check('flag off (kept as a switch): « Team memory », it does not promise what is not true', plain.memory === 'Team memory' && !/personal off/i.test(plain.memory) && !/personal memory is not used/i.test(plain.memoryTitle), plain)
  check('the same in French', lib.spaceCueOf(team('member'), null, fr).memory === 'Mémoire d\'équipe · perso coupée' && lib.spaceCueOf(team('member'), null, fr, false).memory === 'Mémoire d\'équipe')
  check('no team folder yet: NO folder pill (none is invented)', c.folder === null && lib.spaceCueOf(team('member'), '', t).folder === null && lib.spaceCueOf(team('member'), '   ', t).folder === null && lib.spaceCueOf(team('member'), 7, t).folder === null)
  const withFolder = lib.spaceCueOf(team('member'), '/some/folder/Acme', t)
  check('a team folder the host names: its pill, the path as its title', withFolder.folder !== null && withFolder.folder.label === 'Acme folder' && withFolder.folder.title === '/some/folder/Acme', withFolder.folder)
  check('the folder comes from one seam, the state\'s `space_folder` (step 6 writes it)', /cueSet\([^\n]*state\.space_folder/.test(source))
}

console.log('the placeholder, put back when the person leaves the team')
{
  const next = lib.placeholderNext
  const dsh = 'Describe what you want to build'
  const ours = 'Message Acme…'
  const a = next({ text: dsh, ours: null, orig: null }, ours)
  check('a team space: ours replaces DSH\'s words, which are remembered', a.text === ours && a.ours === ours && a.orig === dsh && same(a.swap, { from: [dsh], to: ours }), a)
  check('already ours: nothing to do', next({ text: ours, ours, orig: dsh }, ours) === null)
  const b = next({ text: ours, ours, orig: dsh }, 'Message Studio…')
  check('another team: ours changes, the original stays the original', b.text === 'Message Studio…' && b.orig === dsh && b.ours === 'Message Studio…' && b.swap.from.includes(ours) && b.swap.from.includes(dsh), b)
  const c = next({ text: 'Cmd/Ctrl+Enter steers all queued messages', ours, orig: dsh }, ours)
  check('DSH drew another text after ours (a plan or queue hint): ours replaces it again (KNOWN GAP), and the new text is what is remembered and put back later', c.text === ours && c.orig === 'Cmd/Ctrl+Enter steers all queued messages' && c.swap.from.includes('Cmd/Ctrl+Enter steers all queued messages'), c)
  const d = next({ text: ours, ours, orig: dsh }, null)
  check('leaving the team (or a disabled box): DSH\'s own words come back', d.text === dsh && d.ours === null && d.orig === null && same(d.swap, { from: [ours], to: dsh }), d)
  const e = next({ text: 'Session unavailable', ours, orig: dsh }, null)
  check('and a text DSH drew after ours is never put back over', e.text === 'Session unavailable' && e.ours === null && same(e.swap.from, []), e)
  check('never touched and not a team: nothing', next({ text: dsh, ours: null, orig: null }, null) === null)
}

console.log('wiring in the source')
{
  const must = (name, re) => check(name, re.test(source))
  must('the pills sit in the composer\'s dock and the new chat\'s options row, one id, with the other pills', /for \(const slotName of \['conversation\.composer\.dock', 'conversation\.hero\.options'\]\)[\s\S]{0,260}id: 'kybernos-cloud-cues', order: 3/)
  must('and the registration is guarded: a failure leaves the composer as DSH draws it', /try \{\n\s+for \(const slotName of [\s\S]{0,1400}\} catch \(e\) \{ \/\* the cues are optional \*\/ \}/)
  must('the heading is read by the core plugin through window.__KB_SPACE_CUE__ (an accessor, null while a switch waits)', /Object\.defineProperty\(window, '__KB_SPACE_CUE__', \{ configurable: true, get: cueNow \}\)/ )
  check('no money in the strings of the bars', !/(winTeam|winYou|winAllowance|winLast|winBack|winFull|winPayment|winUsed): '[^']*[$€]/.test(source))
  must('the menu asks the host once when it opens, for the summary of its spaces', /callLocal\('\/spaces\/summary', 'GET'\)/)
  must('the footer asks whether the route is applied, by the host\'s route, not by a fixed delay alone', /callLocal\('\/space\/applied', 'POST', \{ workspace_id: id \}\)/)
  must('the card cannot be opened while a switch waits, and says so', /disabled: switching !== null, 'aria-busy'/)
  const coreSrc = readFileSync(join(here, '..', 'kybernos-plugin', 'client.js'), 'utf8')
  check('the core plugin\'s new-chat heading takes the team\'s line and listens for a change of cue', /window\.__KB_SPACE_CUE__/.test(coreSrc) && /addEventListener\('kybernos:space-cue', later\)/.test(coreSrc))
}

console.log('the words, in both languages')
{
  const keys = ['roleOwner', 'roleAdmin', 'roleMember', 'spaceMembers', 'spaceMembers1', 'spaceSwitching', 'spaceSwitchSlow', 'spaceRouteStale', 'winTeam', 'winYou', 'winAllowance', 'winLast', 'winBack', 'winFull',
    'winPayment', 'winUsed', 'planManage', 'planAddCredits', 'cueMemory', 'cueMemoryOff', 'cueMemoryTip', 'cueMemoryOffTip', 'cueFolder', 'cuePlaceholder', 'cueHeading']
  const frStart = source.indexOf('      fr: {')
  const enStart = source.indexOf('      en: {')
  const keysOf = (text) => new Set([...text.matchAll(/^ {8}([A-Za-z][A-Za-z0-9_]*): '/gm)].map((m) => m[1]))
  const frKeys = keysOf(source.slice(frStart, enStart))
  const enKeys = keysOf(source.slice(enStart, source.indexOf('\n      },', enStart)))
  check('every new key exists in French AND in English', keys.every((k) => frKeys.has(k) && enKeys.has(k)), keys.filter((k) => !frKeys.has(k) || !enKeys.has(k)))
  check('a French string says « tu », never « vous »', !keys.some((k) => /(?<![A-Za-zÀ-ÿ])(vous|votre|vos)(?![A-Za-zÀ-ÿ])/i.test(fr(k))))
  check('placeholders {name}, {pct}, {window}, {when}, {n} are the same in both languages', keys.every((k) => same((t(k).match(/\{\w+\}/g) || []).sort(), (fr(k).match(/\{\w+\}/g) || []).sort())), keys.filter((k) => !same((t(k).match(/\{\w+\}/g) || []).sort(), (fr(k).match(/\{\w+\}/g) || []).sort())))
  check('no raw line separator in the source (a dictionary writes escapes, never the character)', source.split(String.fromCharCode(0x2028)).length === 1 && source.split(String.fromCharCode(0x2029)).length === 1)
}

console.log('the box of the « Switch team » list')
{
  const menu = { top: 120, right: 330 }
  const wide = lib.subPanelBox(menu, 1400)
  check('desktop: a 248 px panel beside the menu, top at the menu\'s top', wide.left === 338 && wide.width === 248 && wide.top === 120, wide)
  const edge = lib.subPanelBox({ top: 120, right: 1300 }, 1400)
  check('desktop, menu near the right edge: the panel is pushed back inside the window', edge.left + edge.width + 8 <= 1400 && edge.left >= 8, edge)
  const phone = lib.subPanelBox({ top: 47, right: 315 }, 390)
  check('phone (390 px): the panel takes the window\'s width less an 8 px margin on each side, so no name is cut at 248 px', phone.left === 8 && phone.width === 374 && phone.top === 47, phone)
  const small = lib.subPanelBox({ top: 2, right: 200 }, 320)
  check('a 320 px phone: still inside the window, and never above it', small.left === 8 && small.width === 304 && small.top === 8, small)
  check('a tablet\'s width (521 px) keeps the beside-the-menu panel', lib.subPanelBox(menu, 521).width === 248 && lib.subPanelBox(menu, 520).width === 504)
  check('the footer places the list through this rule and sets its width', /setSubPos\(subPanelBox\(r, window\.innerWidth\)\)/.test(source) && /width: subPos\.width \+ 'px'/.test(source))
}

if (failed > 0) { console.error('\n' + failed + ' check(s) failed'); process.exit(1) }
console.log('\nall checks OK')
