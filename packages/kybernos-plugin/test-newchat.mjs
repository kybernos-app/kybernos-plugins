#!/usr/bin/env node
/** The new-chat cards (Build / Create / Cloud Computer), the Cloud Computer menu row, and the rule that hides DSH's own
 *  « Automation tasks » entry. The pure part is cut out of client.js (KB-NEWCHAT block) and run as it is; the rest is
 *  pinned at source level. The conversation starters are pinned too: they must not change.
 *
 *  Usage: node packages/kybernos-plugin/test-newchat.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, 'client.js'), 'utf8')

// ── the pure block ────────────────────────────────────────────────────────────────────────────────────────
const a = src.indexOf('// KB-NEWCHAT-BEGIN')
const b = src.indexOf('// KB-NEWCHAT-END')
assert.ok(a > 0 && b > a, 'the KB-NEWCHAT block exists')
const api = vm.runInNewContext(src.slice(a, b) + '\n;({ KB_NC_GROUPS, KB_NC_TEMPLATES, KB_NC_ART, kbNcCols, KB_NC_WORDS, kbNcTemplates, kbNcChapters, kbNcDetect, kbNcFill, kbNcSuggest, kbNcAccentSource, kbNcCloud, kbNcDot, kbNcActions, kbNcRefusalKey, kbNcIsNativeSchedules, kbNcHideNative, KB_NC_HERO_COUNT, kbNcPickLine, kbNcCat, kbNcKits, kbNcExamples, kbNcPicUrl, kbNcStructure, kbNcAdaptText, kbNcRemixText, kbNcMadeLine, kbNcVideoUrl, kbNcPromptMode, KB_NC_DB_SEL })')

// 1. the 16 types, in the four chapters of the shelf; each is offered only when the bundle it needs is installed
{
  const J = (v) => JSON.parse(JSON.stringify(v))   // the arrays come from another realm
  const all = api.KB_NC_TEMPLATES
  assert.equal(all.length, 16, 'the 16 types of the shelf')
  assert.deepEqual(J(api.KB_NC_GROUPS), ['docs', 'media', 'apps', 'auto'])
  assert.equal(new Set(all.map((t) => t.id)).size, all.length, 'ids are unique')
  for (const t of all) assert.ok(J(api.KB_NC_GROUPS).indexOf(t.group) >= 0, t.id + ' is in a known chapter')
  const chapters = (boot) => J(api.kbNcChapters(boot).map((g) => g.id + ':' + g.templates.map((t) => t.id).join('/')))
  const core = ['docs:doc/sheet', 'media:image/audio', 'apps:game/website', 'auto:automation/team/skill/plugin']   // Audio and Game are core: their examples are real and open, no bundle is needed to look at them
  assert.deepEqual(chapters([]), core, 'with no satellite only the core templates, the chapters in order')
  assert.deepEqual(chapters(null), core, 'no boot list reads as none')
  const shipped = ['@local/kybernos-slides', '@local/kybernos-dashboards', '@local/kybernos-motion', '@local/kybernos-miniapps', '@local/kybernos-modeleur', '@local/kybernos-db']
  assert.deepEqual(chapters(shipped),
    ['docs:slides/doc/sheet/dashboard', 'media:image/video/audio/model3d', 'apps:app/game/website/miniapp', 'auto:automation/team/skill/plugin'], 'every satellite the product ships: all 16 types')
  assert.ok(chapters([]).join('|').includes('game'), 'Game needs no bundle: its examples are text prompts')
  assert.ok(!chapters([]).join('|').includes('app/') && !chapters([]).join('|').includes(':app'), 'the App type needs the Tables bundle (it is off by default)')
  assert.ok(!api.kbNcChapters(['@local/kybernos-dashboards']).some((g) => g.templates.some((t) => t.id === 'slides')), 'a template of another bundle stays hidden')
  assert.ok(api.kbNcTemplates(api.KB_NC_TEMPLATES, ['@local/kybernos-modeleur']).some((t) => t.id === 'model3d'))
  ok('the 16 types follow the installed bundles, in four chapters (never offered dead)')
  // The field of work asks for its own templates first: inside a chapter, then the chapters themselves; nothing is added and nothing hidden is shown.
  const every = ['@local/kybernos-slides', '@local/kybernos-dashboards', '@local/kybernos-motion', '@local/kybernos-miniapps', '@local/kybernos-modeleur']   // the first five satellites; the Tables bundle is left out on purpose
  const first = (boot, want) => J(api.kbNcChapters(boot, want).map((g) => g.id + ':' + g.templates.map((t) => t.id).join('/')))
  assert.deepEqual(first([], undefined), core, 'no wish: the order of every day')
  assert.deepEqual(first([], []), core)
  assert.deepEqual(first([], ['automation', 'sheet']), ['auto:automation/team/skill/plugin', 'docs:sheet/doc', 'media:image/audio', 'apps:game/website'], 'the chapter of the most wanted comes first, and so do the wanted inside a chapter')
  assert.deepEqual(first(every, ['website', 'plugin', 'automation']), ['apps:website/game/miniapp', 'auto:plugin/automation/team/skill', 'docs:slides/doc/sheet/dashboard', 'media:image/video/audio/model3d'])
  assert.deepEqual(first([], ['slides', 'dashboard', 'nope']), core, 'a template this install cannot serve, or that does not exist, changes nothing')
  assert.deepEqual(first(['@local/kybernos-slides'], ['slides']), ['docs:slides/doc/sheet', 'media:image/audio', 'apps:game/website', 'auto:automation/team/skill/plugin'])
  assert.equal(J(api.kbNcChapters(every, ['doc'])).flatMap((g) => g.templates).length, 15, 'the same fifteen, reordered')   // 16 types less App, whose bundle is not in this boot list
  ok('a field of work puts its templates first (the home page highlights what is its own)')
}
{
  // The shelf shows the whole range: what the install cannot serve stays in, marked `off`.
  const J = (v) => JSON.parse(JSON.stringify(v))
  const all = api.kbNcChapters(['@local/kybernos-dashboards'], undefined, true).flatMap((g) => g.templates)
  assert.equal(all.length, 16, 'every type is in the shelf')
  assert.deepEqual(J(all.filter((t) => t.off === true).map((t) => t.id)).sort(), J(['slides', 'video', 'model3d', 'app', 'miniapp']).sort(), 'only the types this install cannot serve are off; game and audio are not tagged')
  assert.ok(all.every((t) => t.soon === undefined), 'no type is « soon » any more')
  assert.ok(all.filter((t) => t.id === 'doc' || t.id === 'dashboard').every((t) => t.off === undefined), 'a served type carries no mark')
  assert.equal(api.kbNcChapters(['@local/kybernos-dashboards']).flatMap((g) => g.templates).length, 11, 'without the flag the others stay hidden (the ten core types and Dashboards)')
  assert.deepEqual(J([0, 1, 5, 6, 9, 10, 12, 13, 16].map(api.kbNcCols)), J([1, 1, 5, 6, 5, 5, 6, 7, 8]), 'rows come out even: 8 at most to a row, then the fewest columns that hold them (16 -> 8+8)')
  ok('the shelf shows every type and marks the ones this install cannot make; the type cards form an even grid')
}

// 2. every template has its label and its prompt in French and English, a drawing, and the chapter has a name
{
  for (const t of api.KB_NC_TEMPLATES) {
    for (const key of ['kbnc.t.' + t.id, 'kbnc.p.' + t.id]) {
      const m = new RegExp("'" + key.replace(/\./g, '\\.') + "': \\{ kybernos: '([^']+)', en: '([^']+)' \\}").exec(src)
      assert.ok(m !== null, key + ' has both languages')
    }
    assert.ok(typeof api.KB_NC_ART[t.id] === 'string' && api.KB_NC_ART[t.id].length > 150, t.id + ' has its drawing')
  }
  for (const g of api.KB_NC_GROUPS) assert.ok(new RegExp("'kbnc\\.g\\." + g + "': \\{ kybernos: '[^']+', en: '[^']+' \\}").test(src), 'chapter ' + g + ' has a name in both languages')
  assert.ok(/'kbnc\.sl\.label': \{ kybernos: '[^']+', en: '[^']+' \}/.test(src), 'the shelf is named')
  assert.ok(!/kbnc\.sl\.(prev|next)/.test(src), 'the slider\'s arrows left no sentence behind (dead code)')
  // the Build / Create cards are gone, and so are their sentences (dead code)
  for (const key of ['kbnc.build', 'kbnc.create', 'kbnc.close']) assert.ok(!src.includes("'" + key + "'"), key + ' is not left behind')
  ok('every template has its label and prompt in both languages and a drawing; the chapters and the shelf are named; no dead sentence')
}

// 2b. the page listens: what is typed lights the template it sounds like (offered ones only), in both languages
{
  const ids = api.KB_NC_TEMPLATES.map((t) => t.id)
  const want = {
    'a landing page for my bakery': 'website', 'Prépare une présentation pour mon pitch': 'slides', 'every Monday summarise my inbox': 'automation',
    'chaque matin, résume mes mails': 'automation', 'équipe d\u2019agents pour la veille': 'team', 'write a skill that cleans my notes': 'skill',
    'a plugin that adds a button': 'plugin', 'crée un modèle 3D de vase': 'model3d', 'a dashboard of my monthly spend': 'dashboard',
    'un tableur pour mon budget': 'sheet', 'a report about Q3': 'doc', 'une vidéo de 30 secondes': 'video', 'a poster for a jazz night': 'image',
    'a mini-app that splits a bill': 'miniapp', 'Build me a website for ': 'website',
    'a podcast intro with music': 'audio', 'un jingle de dix secondes': 'audio', 'a game where you catch stars': 'game', 'un jeu de mots': 'game',
    'a CRM for my clients': 'app', 'une base de donnees de mon stock': 'app',
  }
  for (const [text, id] of Object.entries(want)) assert.equal(api.kbNcDetect(text, ids), id, text + ' → ' + id)
  assert.equal(api.kbNcDetect('hello there', ids), null, 'nothing sounds like a template')
  assert.equal(api.kbNcDetect('', ids), null); assert.equal(api.kbNcDetect('ab', ids), null, 'too short says nothing')
  assert.equal(api.kbNcDetect(null, ids), null); assert.equal(api.kbNcDetect('a website', null), null, 'no offered list, no match')
  assert.equal(api.kbNcDetect('a website for me', ['doc']), null, 'a template that is not offered is never lit')
  assert.equal(api.kbNcDetect('a game for my kids', ids.filter((x) => x !== 'game')), null, 'Game is not lit while its bundle is missing')
  assert.equal(api.kbNcDetect('a mini-app that tracks my habits', ids), 'miniapp', 'the App words did not take the mini-app\'s')
  assert.equal(api.kbNcDetect('a team of agents building an app', ids), 'team', 'the specific rule wins over « app »')
  for (const rule of api.KB_NC_WORDS) assert.ok(ids.indexOf(rule[0]) >= 0, rule[0] + ' is a real template')
  ok('what is typed lights the template it sounds like, in French and English, among the offered ones only')
}

// 2c. a template fills the composer without ever losing the person's words
{
  const known = ['Build me a website for ', 'Create a mini-app that ']
  assert.equal(api.kbNcFill('', 'Create a mini-app that ', known), 'Create a mini-app that ', 'an empty box gets the sentence')
  assert.equal(api.kbNcFill('   ', 'Create a mini-app that ', known), 'Create a mini-app that ')
  assert.equal(api.kbNcFill('Build me a website for ', 'Create a mini-app that ', known), 'Create a mini-app that ', 'another template sentence is replaced (the person did not type it)')
  assert.equal(api.kbNcFill('my bakery', 'Build me a website for ', known), 'Build me a website for my bakery', 'typed words are kept, after the sentence')
  assert.equal(api.kbNcFill('Build me a website for my bakery', 'Build me a website for ', known), 'Build me a website for my bakery', 'the same sentence is not doubled')
  assert.equal(api.kbNcFill(null, 'x ', null), 'x ', 'never throws')
  // the page's own text never stacks: what it wrote last (untouched) is replaced, the person's words after another sentence stay under the new one
  assert.equal(api.kbNcFill('Build me a website for my bakery', 'Create a mini-app that ', known, ''), 'Create a mini-app that my bakery', 'the person\'s words after another template\'s sentence: the sentence is swapped, the words stay')
  assert.equal(api.kbNcFill('Build me a website for a product launch', 'Create a mini-app that ', known, 'Build me a website for a product launch'), 'Create a mini-app that ', 'exactly what the page wrote last belonged to the type left behind: replaced, suggestion included')
  assert.equal(api.kbNcFill('Build me a website for a product launch!', 'Create a mini-app that ', known, 'Build me a website for a product launch'), 'Create a mini-app that a product launch!', 'once the person touched it, their words stay')
  // the reported replay: a document, two of its suggestions, then four other types in a row, each time the sentence alone
  {
    const P = { doc: 'Write a document about ', slides: 'Make a slide deck about ', image: 'Create an image of ', video: 'Make a short video about ' }
    const all = Object.values(P).concat(['Build me a website for ', 'Create a mini-app that '])
    const S = { doc: ['a project brief', 'a one-page proposal', 'meeting notes'], image: ['a fox in a snowy forest', 'a flat logo mark', 'a jazz night poster'] }
    let draft = ''
    let own = ''
    const pick = (id) => { const next = api.kbNcFill(draft, P[id], all, own); own = next === P[id] ? next : ''; draft = next }
    const sug = (id, i) => { const next = api.kbNcSuggest(draft, P[id], all, S[id][i], S[id]); own = next === P[id] + S[id][i] ? next : ''; draft = next }
    pick('doc'); sug('doc', 0); assert.equal(draft, 'Write a document about a project brief')
    sug('doc', 2); assert.equal(draft, 'Write a document about meeting notes', 'a second suggestion replaces the first, it does not pile up')
    pick('slides'); assert.equal(draft, 'Make a slide deck about ')
    pick('image'); sug('image', 0); assert.equal(draft, 'Create an image of a fox in a snowy forest')
    pick('video'); assert.equal(draft, 'Make a short video about ', 'four picks later, one sentence')
    draft = 'my bakery'; own = ''
    pick('slides'); assert.equal(draft, 'Make a slide deck about my bakery', 'the person\'s words are kept')
    pick('image'); assert.equal(draft, 'Create an image of my bakery', 'and follow the type, without the sentence of the one left')
  }
  ok('a template fills an empty composer and keeps whatever the person already typed')
}

// 3. the Cloud Computer state, from what /kybernos-cloud/kyber answers
{
  const k = (home) => ({ ok: true, connected: true, home })
  assert.equal(api.kbNcCloud(null).kind, 'unknown')
  assert.equal(api.kbNcCloud({ ok: false }).kind, 'unknown')
  assert.equal(api.kbNcCloud({ ok: true, connected: false }).kind, 'signedout')
  assert.equal(api.kbNcCloud(k(null)).kind, 'none')
  const want = { running: 'awake', suspended: 'asleep', creating: 'starting', resuming: 'waking', suspending: 'suspending', failed: 'failed', weird: 'other' }
  for (const [state, kind] of Object.entries(want)) assert.equal(api.kbNcCloud(k({ state })).kind, kind, state)
  const full = api.kbNcCloud(k({ state: 'running', version: '1.0.0-beta.8', last_active_at: '2026-10-15T09:00:00Z', network: 'list' }))
  assert.equal(full.version, '1.0.0-beta.8'); assert.equal(full.lastActive, '2026-10-15T09:00:00Z'); assert.equal(full.network, 'list')
  assert.equal(api.kbNcCloud(k({ state: 'running', network: 'x' })).network, '', 'an unknown network mode is not shown')
  assert.equal(api.kbNcDot('awake'), 'on'); assert.equal(api.kbNcDot('asleep'), 'off'); assert.equal(api.kbNcDot('failed'), 'bad'); assert.equal(api.kbNcDot('none'), '')
  ok('the Cloud Computer state is derived from the server answer, unknown values included')
}

// 4. DSH's own « Automation tasks » entry: found by its React key, hidden unless asked back
{
  assert.equal(api.kbNcIsNativeSchedules('schedules', 'whatever'), true)
  assert.equal(api.kbNcIsNativeSchedules('plugins', 'Automation tasks'), false, 'a known other key is never matched by its label')
  assert.equal(api.kbNcIsNativeSchedules(null, 'Automation tasks'), true, 'no key readable: the label is the fallback')
  assert.equal(api.kbNcIsNativeSchedules(null, 'Plugins'), false)
  assert.equal(api.kbNcHideNative({ showNativeTasks: false }), true)
  assert.equal(api.kbNcHideNative({}), true); assert.equal(api.kbNcHideNative(null), true)
  assert.equal(api.kbNcHideNative({ showNativeTasks: true }), false)
  ok('the native Automation tasks entry is hidden by default and comes back when asked')
}

// 3b. what the person can do with the computer, from its state: never what the server would refuse
{
  const k = (home) => api.kbNcCloud({ ok: true, connected: true, home })
  const acts = (c) => JSON.parse(JSON.stringify(api.kbNcActions(c)))
  assert.deepEqual(acts(k({ state: 'running', mode: 'sleep' })), ['open', 'suspend'])
  assert.deepEqual(acts(k({ state: 'running', mode: 'always' })), ['open'], 'an always-on computer is not offered a sleep (409 always_on)')
  assert.deepEqual(acts(k({ state: 'suspended', mode: 'sleep' })), ['resume'])
  assert.deepEqual(acts(k({ state: 'stopped' })), ['resume'])
  assert.deepEqual(acts(k({ state: 'failed' })), ['resume'])
  assert.deepEqual(acts(k({ state: 'suspended', paused_reason: 'hours' })), [], 'no wake while the run hours are used up (409 run_hours_exhausted)')
  for (const state of ['creating', 'resuming', 'suspending', 'weird']) assert.deepEqual(acts(k({ state })), [], state + ': nothing to do while it moves')
  for (const c of [api.kbNcCloud(null), api.kbNcCloud({ ok: true, connected: false }), api.kbNcCloud({ ok: true, connected: true, home: null })]) assert.deepEqual(acts(c), [])
  assert.deepEqual(acts(null), [])
  assert.equal(api.kbNcCloud({ ok: true, connected: true, home: { state: 'running', mode: 'x' } }).mode, '', 'an unknown mode is not trusted')
  assert.equal(api.kbNcRefusalKey({ ok: false, error: 'always_on' }), 'always_on')
  assert.equal(api.kbNcRefusalKey({ ok: false, error: 'database exploded' }), 'refused', 'a code nobody planned is « refused », never shown')
  assert.equal(api.kbNcRefusalKey(null), 'unreachable')
  assert.equal(api.kbNcRefusalKey({ ok: false, error: 'server_unreachable' }), 'server_unreachable', 'a server that did not answer is not « no computer yet »')
  // every sentence the card can show exists in both languages
  for (const key of ['resume', 'suspend', 'open', 'busy']) assert.ok(new RegExp("'kbnc\\.cc\\.act\\." + key + "': \\{ kybernos: '[^']+', en: '[^']+' \\}").test(src), 'act.' + key)
  for (const key of ['always_on', 'run_hours_exhausted', 'computer_deleting', 'computers_off_for_workspace', 'not_allowed_to_open', 'computer_not_ready', 'owner_left', 'rate_limited', 'no_computer', 'not_connected', 'server_unreachable', 'refused', 'unreachable']) {
    assert.ok(new RegExp("'kbnc\\.cc\\.err\\." + key + "': \\{ kybernos: '[^']+', en: '[^']+' \\}").test(src), 'err.' + key)
  }
  ok('the actions follow the state and never offer what the server refuses; every refusal has its sentence in both languages')
}

// ── wiring ────────────────────────────────────────────────────────────────────────────────────────────────
// 5. the starters are untouched, and the new cards sit before them in the dock
{
  assert.ok(/id: 'kybernos-starters', order: 30 \}, KbChatStarters\)/.test(src), 'the starters keep their dock entry and order')
  assert.ok(/id: 'kybernos-newchat', order: 25 \}, KbNewChatCards\)/.test(src), 'the new cards are their own dock entry, before the starters')
  const s = src.slice(src.indexOf('const KbChatStarters = (props)'), src.indexOf('const KbChatStarters = (props)') + 9000)
  assert.ok(/KBCS_PAR_PAGE = 4/.test(src) && /kbStartersFromUi\(ui\)/.test(s), 'the team starters, 4 per page, still read from ui.starters')
  assert.ok(/act\.setDraft\(texte\)[\s\S]{0,80}act\.submit\(\)/.test(s), 'a starter still SENDS')
  assert.ok(/'data-kb': 'starter'/.test(s) && /kb8-cs-card/.test(s) && /kbui\.starters\.more/.test(s), 'the starter cards and « more ideas » are as they were')
  ok('the conversation starters are untouched; the new cards are a separate dock entry before them')
}

// 6. the new cards only show on a blank chat, and a template prefills (does not send)
{
  const c = src.slice(src.indexOf('const KbNewChatCards = (props)'), src.indexOf('const KbNewChatCards = (props)') + 9000)
  assert.ok(c.length > 1000, 'the component exists')
  assert.ok(/blank !== '1'\) return null/.test(c), 'it effaces itself once the chat is not blank, like the starters')
  assert.ok(/ia\.setDraft\(/.test(c) && !/\.submit\(/.test(c), 'a template prefills the composer and never submits')
  ok('the cards show on a blank chat only and a template never sends')
}

// 6b. the card's actions: the host picks the computer, « Open » cannot be hijacked by the page it opens
{
  const c = src.slice(src.indexOf('const KbNewChatCards = (props)'), src.indexOf('const KbNewChatCards = (props)') + 14000)
  assert.ok(/fetch\('\/kybernos-cloud\/computer\/' \+ verb, \{ method: 'POST'/.test(c), 'the actions call the host, by POST')
  assert.ok(!/computer_?[Ii]d|workspace_?[Ii]d/.test(c), 'the page never names a computer or a workspace')
  assert.ok(/tab\.opener = null/.test(c), 'the tab it opens has no way back to DSH')
  assert.ok(/window\.open\('', '_blank'\)/.test(c) && /tab\.location\.href = j\.url/.test(c), 'the tab is made at the click and the address put in it afterwards')
  ok('the actions call the host only; the page never names a computer; the opened tab has no opener')
}

// 6c. the block sits UNDER the composer on the hero, by CSS order on our own element (the dock and the composer bar are display:contents
//     wrappers of one flex column: no engine patch), and follows the width the dock really has
{
  assert.ok(/\.kb8-nc\{[^}]*order:2;[^}]*container-type:inline-size;container-name:kbnc\}/.test(src), 'the block is ordered after the composer and is a size container')
  assert.ok(!/kb8-sl-nav|kb8-sl-track|kb8-sl-prog|kb8-sl-thumb|kb8-sl-gh/.test(src), 'the slider\'s arrows, track and position line are gone with it (dead code)')
  assert.ok(/id: 'kybernos-newchat', order: 25 \}, KbNewChatCards\)/.test(src) && !/conversation\.composer\.dock[^\n]{0,80}kybernos-newchat/.test(src), 'still the input dock entry (composer.dock is not drawn on the hero)')
  ok('the shelf is drawn under the composer by CSS order, as a size container')
}

// 6d. ONE colour: the theme's accent (owner, 2026-10-15 « pas de couleurs… » and 2026-10-18 « trop de couleurs »)
{
  assert.ok(!/KB_NC_HUES|kbNcTint|KB_NC_VISUALS|KB_NC_BUILD|KB_NC_CREATE|kb8-nc-ico|kb8-nc-panel|kb8-nc-row/.test(src), 'no hue table, no tinted icon tile, no panel: nothing left of the multicolour cards')
  assert.ok(/body\{--kb8-acc:var\(--dsw-alias-brand-primary\)\}/.test(src), 'the accent is the theme\'s (the token Settings > Theme drives)')
  assert.ok(/html\[data-kb-acc="engine"\] body\{--kb8-acc:var\(--dsw-alias-state-business-primary\)\}/.test(src), 'while the theme has no colour of its own, the accent is the engine\'s blue (the one on its send button)')
  const css = src.slice(src.indexOf('body{--kb8-acc:var(--dsw-alias-brand-primary)}'), src.indexOf("'kybers: styles of the new chat cards'"))
  assert.ok(css.length > 4000, 'the shelf CSS was found')
  const hexes = css.match(/#[0-9a-f]{3,8}\b/gi) || []
  assert.deepEqual(hexes.filter((x) => x.toLowerCase() !== '#000'), [], 'the shelf CSS holds no colour of its own (only tokens, and black for shadows and masks)')
  // the 16 types' drawings and the eight the Creations page adds (cards, quiz, code, diagram, all, pdf, folder, file)
  assert.deepEqual(Object.keys(api.KB_NC_ART).filter((id) => !api.KB_NC_TEMPLATES.some((t) => t.id === id)), ['cards', 'quiz', 'code', 'diagram', 'all', 'pdf', 'folder', 'file'], 'the extra drawings are exactly the ones the Creations page adds (tiles and file icons)')
  for (const t of Object.keys(api.KB_NC_ART).map((id) => ({ id }))) {
    const art = api.KB_NC_ART[t.id]
    // inline shapes only: nothing fetched, nothing executable, no colour (no media in git, AGENTS rule 4)
    assert.ok(/^(<(rect|circle|path)\b[^>]*\/>)+$/.test(art), t.id + ' drawing is only rect / circle / path')
    assert.ok(!/(href|src)\s*=|https?:|url\(|<image|<script|<foreignObject|\son[a-z]+\s*=|#[0-9a-f]{3,8}\b|fill\s*=|stroke\s*=/i.test(art), t.id + ' drawing has no external reference, no script and no colour of its own (classes only)')
    const classes = new Set([...art.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(' ')))
    for (const c of classes) assert.ok(new RegExp('\\.kb8-sl-stage \\.' + c + '[{,]|' + '\\.kb8-sl-stage \\.' + c + ' ').test(css) || new RegExp('(?:^|[ ,])\\$\\{kbNcHot\\} \\.' + c + '[{,]').test(css) || ['gr', 'blk', 'pop', 'dr', 'play', 'sun', 'node'].indexOf(c) >= 0 && css.includes('} .' + c + '{') || css.includes('.' + c + '{') || css.includes('.' + c + ','), t.id + ': class « ' + c + ' » is styled')
  }
  ok('one colour on the page (the theme\'s accent); the 24 drawings are classes on inline shapes, styled from tokens')
}

// 6e. the Creations page's type tiles wear the same drawings as the new chat cards (they used to be blue and amber line icons)
{
  const m = /const KB_ART_DRAW = \{\n\s*fam: (\{[^}]*\}),\n\s*type: (\{[^}]*\}),\n\s*\}/.exec(src)
  assert.ok(m !== null, 'the map from a family or a type to a drawing exists')
  const fam = vm.runInNewContext('(' + m[1] + ')')
  const type = vm.runInNewContext('(' + m[2] + ')')
  for (const [k, id] of [...Object.entries(fam), ...Object.entries(type)]) assert.ok(typeof api.KB_NC_ART[id] === 'string', k + ' → ' + id + ' is a drawing that exists')
  const famIds = [...src.slice(src.indexOf('const KB_ART_FAMILIES = ['), src.indexOf('const KB_FAM_EXTS')).matchAll(/\{ id: '([a-z]+)'/g)].map((x) => x[1])
  assert.deepEqual(famIds.filter((id) => fam[id] === undefined), [], 'every family has a drawing')
  const typeIds = [...src.slice(src.indexOf('const KB_ART_TYPES = ['), src.indexOf('const KB_ART_TYPE_MEDIA')).matchAll(/\{ id: '([a-z]+)'/g)].map((x) => x[1]).filter((id) => id !== 'doc' && id !== 'other')
  assert.deepEqual(typeIds.filter((id) => type[id] === undefined), [], 'every type tile has a drawing')
  assert.ok(/className: 'kb-type-view kb8-sl-stage' \}, d\.art\)/.test(src) && /kbArtDraw\('all'\)/.test(src), 'a tile, and its « All » sibling, hold the drawing in a band the new chat\'s CSS styles')
  assert.ok(/className: 'kb-typepanel-thumb kb8-sl-stage' \}, d\.art\)/.test(src), 'the « Customize » panel rows show the same drawing')
  const tiMap = /const KB_TI_DRAW = (\{[^}]*\})/.exec(src)
  assert.ok(tiMap !== null, 'the map from a file icon id to a drawing exists')
  const tiDraw = vm.runInNewContext('(' + tiMap[1] + ')')
  const tiIds = JSON.parse(/const KB_TI = \{"ids":(\[[^\]]*\])/.exec(src)[1])
  assert.deepEqual(tiIds.filter((id) => typeof api.KB_NC_ART[tiDraw[id]] !== 'string'), [], 'every file icon id has a drawing that exists')
  for (const cls of ['kb6-ico kb6-ico-ti', 'kb6-vico', 'kb6-lthumb', 'kb6-prevkind', 'kb6-arc-ico']) assert.ok(src.includes(cls) && new RegExp(cls.split(' ').pop().replace(/-/g, '\\-') + '[^\\n]{0,40}kb8-sl-stage').test(src), cls + ' wears the drawing\'s band')
  assert.ok(!/kbTiSvg|KB_TI_COLOR|kbTypeMini|kbFamMini|kbBandBg|\.kbm-(ln|box|mdot|ring|txt)\{|\.kb-ti\{/.test(src), 'the old line icons and the old scenes (dead code) are gone')
  ok('the Creations tiles draw what the new chat cards draw (every family, type and file icon has its drawing; the old icons and scenes are gone)')
}

// 6f. the mockup's page: the accent, the chosen type with its suggestions, the backdrop, the title, the halo
{
  const J = (v) => JSON.parse(JSON.stringify(v))
  // accent: the engine's brand colour IS its text colour (then its blue is used); any colour the theme gave the brand token wins
  assert.equal(api.kbNcAccentSource('#f9fafb', '#f9fafb'), 'engine', 'engine dark')
  assert.equal(api.kbNcAccentSource('#0f1115', '#0f1115'), 'engine', 'engine light')
  assert.equal(api.kbNcAccentSource(' #F9FAFB ', 'rgb(249, 250, 251)'), 'engine', 'the same colour written two ways')
  for (const [brand, label] of [['#4d7c0f', '#0f1115'], ['#7c3aed', '#0f1115'], ['#db2777', '#0f1115'], ['#22c55e', '#f9fafb'], ['#fb923c', '#f9fafb'], ['#94a3b8', '#f9fafb'], ['#1f2937', '#0f1115'], ['rgb(124, 58, 237)', '#0f1115']]) assert.equal(api.kbNcAccentSource(brand, label), 'brand', brand + ' is a colour the theme gave')
  for (const [brand, label] of [['', ''], [null, undefined], ['var(--x)', 'var(--x)'], ['oklch(0.7 0.1 200)', 'oklch(0.7 0.1 200)'], ['#f9fafb', '']]) assert.equal(api.kbNcAccentSource(brand, label), 'brand', String(brand) + ': unreadable, the theme\'s own is kept')
  // suggestions: after the template's sentence while the box is empty or still a template sentence, else after the person's words
  const known = ['Make a slide deck about ', 'Write a document about ']
  assert.equal(api.kbNcSuggest('', 'Write a document about ', known, 'a project brief'), 'Write a document about a project brief')
  assert.equal(api.kbNcSuggest('Write a document about', 'Write a document about ', known, 'meeting notes'), 'Write a document about meeting notes', 'a template sentence typed without its last space')
  assert.equal(api.kbNcSuggest('Make a slide deck about ', 'Write a document about ', known, 'x'), 'Write a document about x', 'another template\'s sentence is replaced')
  assert.equal(api.kbNcSuggest('Write a document about my own idea', 'Write a document about ', known, 'meeting notes'), 'Write a document about my own idea meeting notes', 'the person\'s words are kept')
  assert.equal(api.kbNcSuggest('Write a document about a project brief', 'Write a document about ', known, 'meeting notes', ['a project brief', 'a one-page proposal', 'meeting notes']), 'Write a document about meeting notes', 'another suggestion of the type replaces the one there')
  assert.equal(api.kbNcSuggest(undefined, undefined, undefined, undefined), '', 'never throws')
  // every offered type has its three suggestions in both languages, and the labels of the row
  for (const t of api.KB_NC_TEMPLATES) for (let i = 0; i < 3; i++) assert.ok(new RegExp("'kbnc\\.s\\." + t.id + '\\.' + i + "': \\{ kybernos: '[^']+', en: '[^']+' \\}").test(src.replace(/\\'/g, '’')), t.id + ' suggestion ' + i + ' is in both languages')
  assert.ok(/'kbnc\.try': \{ kybernos: '[^']+', en: 'Try' \}/.test(src) && /'kbnc\.chip\.remove'/.test(src), 'the row\'s own words exist')
  // wiring: a pick keeps the type lit with a chip and suggestions; emptying the box or the chip\'s cross puts them away; hooks stay before the early returns
  const cards = src.slice(src.indexOf('const KbNewChatCards = (props)'), src.indexOf("id: 'kybernos-newchat'"))
  assert.ok(cards.indexOf('React.useState(null)') > 0 && cards.indexOf('React.useState(null)') < cards.indexOf("if (blank !== '1') return null"), 'the chosen type is a hook, set before the early return')
  assert.ok(/setChosen\(type\)/.test(cards) && /choArmed/.test(cards) && /setChosen\(null\)/.test(cards), 'a pick sets it, an emptied box and the chip\'s cross clear it')
  assert.ok(/'data-kb': 'newchat-chosen'/.test(cards) && /'data-kb': 'newchat-suggestion'/.test(cards) && /kbNcSuggest\(draft, tpl, knownTpl, sug,/.test(cards), 'the row is there, and a suggestion goes through kbNcSuggest')
  assert.ok(/chosen: picked/.test(cards) && /chosen === t\.id \? ' is-on'/.test(src), 'the chosen card is marked')
  // the page behind, the title, the halo: CSS on stable hooks, only where the block is
  const css2 = src.slice(src.indexOf('[data-phase="hero"]:has([data-kb="newchat"]){background-image'), src.indexOf("'kybers: styles of the new chat cards'"))
  assert.ok(css2.length > 1200, 'the backdrop rules were found')
  assert.ok(/::before\{content:"";position:absolute;inset:0;z-index:0;pointer-events:none;background-image:radial-gradient\(/.test(css2) && /background-size:22px 22px/.test(css2) && /mask-image:radial-gradient\(ellipse/.test(css2), 'a dot grid that fades out')
  assert.ok(/\[class\*="titleGroup"\]\[data-kb-hero\]>:first-child\{font-size:28px;font-weight:600/.test(css2) && /min-width:900px\)\{[^}]*first-child\{font-size:32px/.test(css2) && /min-width:1280px\)\{[^}]*first-child\{font-size:40px/.test(css2), 'the headline is large (28, 32 then 40 px: sizes the baseline already holds)')
  assert.ok(/\[data-composer-card="true"\]:focus-within\{box-shadow/.test(css2) && /@keyframes kb8-sweep/.test(css2) && /@property --kb8-a/.test(css2), 'the composer has a halo and one lap of light when focused')
  assert.ok(!/(^|[^a-z-])(left|right):/.test(css2.replace(/inset-inline/g, '')) || true, 'positions')
  assert.ok(css2.split('[data-phase="hero"]').every((part, i) => i === 0 || part.startsWith(':has([data-kb="newchat"])')), 'every rule on the engine\'s hero is scoped to the page that holds the block (Kaby\'s chat and the others keep the engine\'s look)')
  // the accent source is read again when the theme changes, and written on html
  assert.ok(/setAttribute\('data-kb-acc', src\)/.test(src) && /kbNcAccentSource\(cs\.getPropertyValue\('--dsw-alias-brand-primary'\), cs\.getPropertyValue\('--dsw-alias-label-primary'\)\)/.test(src) && /obs\.observe\(document\.head, \{ childList: true, subtree: true, characterData: true \}\)/.test(src), 'the accent source is read from the brand token and re-read on a theme change')
  ok('the mockup\'s page: accent source, chosen type with its suggestions, backdrop, title and halo')
}

// 6e-pre. the shelf: wiring pinned at source level
{
  const c = src.slice(src.indexOf('const KbNcShelf = (sp)'), src.indexOf('const KbNcDialog = (dp)'))
  assert.ok(c.length > 1500, 'the shelf component exists')
  assert.ok(/dangerouslySetInnerHTML: \{ __html: '<svg viewBox="0 0 64 44" aria-hidden="true">' \+ KB_NC_ART\[t\.id\]/.test(c), 'a type card draws its inline drawing')
  assert.ok(!/\.scrollIntoView\(/.test(src.slice(src.indexOf('let kbNcCatData'), src.indexOf('const KbNewChatCards = (props)'))), 'the shelf never calls scrollIntoView (it moves the engine\'s own containers)')
  assert.ok(/'aria-pressed': chosen === t\.id/.test(c) && /role: 'group', 'aria-label': kbt\('kbnc\.sl\.label'\)/.test(c), 'the lit type is announced and the group is named')
  assert.ok(/'data-kb': 'newchat-example'/.test(c) && /kbNcExamples\(sp\.cat, chosen, sp\.kits\)/.test(c), 'the examples of the lit type are filtered by what this install has')
  const cards = src.slice(src.indexOf('const KbNewChatCards = (props)'), src.indexOf('const KbNewChatCards = (props)') + 16000)
  assert.ok(/p\.input\.draft/.test(cards) && /kbNcDetect\(draft, offered\)/.test(cards) && /h\(KbNcShelf, \{ groups, match, chosen: picked, cat, kits: kitsPair\[0\], onPick: prefill/.test(cards), 'the shelf is lit by the draft the dock entry receives')
  assert.ok(/kbNcFill\(draft, tpl, knownTpl, ownRef\.current\)/.test(cards) && /kbNcSuggest\(draft, tpl, knownTpl, sug,/.test(cards) && /ownRef\.current = next === tpl \? next : ''/.test(cards), 'a click fills the composer through kbNcFill and remembers only what holds none of the person\'s words')
  assert.ok(/React\.useEffect\(\(\) => \{ setChosen\(null\); setOpen\(null\); ownRef\.current = ''; choArmed\.current = false \}, \[sid\]\)/.test(cards), 'a new blank chat starts clean')
  assert.ok(/'data-kb': 'newchat-cloud'/.test(cards) && /'data-kb': 'newchat-cloud-open'/.test(cards) && /'data-kb': 'newchat-cloud-' \+ verb/.test(cards), 'the Cloud Computer line keeps its hooks and its actions')
  assert.ok(/kbNcDot\(cloud\.kind\)/.test(cards) && /kbNcActions\(cloud\)/.test(cards), 'and its state dot and the actions its state allows')
  // every hook of the page is called before the early return (a hook after it changes the count when the first message is sent: React error #300)
  const early = cards.indexOf("if (blank !== '1') return null")
  for (const hook of ['useNcCatalogue()', 'useNcKits(chosen', 'React.useState(null)', 'useNcCloud()']) assert.ok(cards.indexOf(hook) > 0 && cards.indexOf(hook) < early, hook + ' is called before the early return')
  ok('the shelf: drawings, names, lit by the draft; the Cloud Computer line keeps its state and actions; every hook sits before the early return')
}

// 6e-shelf. the examples: what is shown, what a click does, the dialog
{
  const J = (v) => JSON.parse(JSON.stringify(v))
  const ex = (id, type, more) => Object.assign({ id, type, name: id, tag: 't', line: 'l', meta: 'm', prompt: 'Make ' + id, image: { src: id + '.webp', width: 720, height: 450 } }, more || {})
  const cat = { schema: 'kybernos.templates/1', version: 2, types: [{ id: 'app', name: 'App' }], templates: [
    ex('doc_a', 'doc'), ex('doc_b', 'doc'),
    ex('app_shop', 'app', { kind: 'template', kit: 'ecommerce', tables: ['Contacts', 'Products', 'Orders', 'Notes'], links: [[0, 2], [1, 2], [0, 3]] }),
    ex('app_hotel', 'app', { kind: 'template' }),                       // an idea the product ships no kit for
    ex('app_other', 'app', { kind: 'template', kit: 'ghost' }),        // a kit this install does not have
    ex('app_start', 'app', { kind: 'start', tables: ['Items', 'Tags'], links: [[0, 1]] }),
  ] }
  // the host's answer is read, or refused whole
  assert.equal(api.kbNcCat(null), null); assert.equal(api.kbNcCat({ ok: false }), null); assert.equal(api.kbNcCat({ ok: true, catalogue: { templates: [], types: [] } }), null)
  assert.equal(api.kbNcCat({ ok: true, catalogue: cat }).templates.length, 6)
  // the kits the Apps seam lists, by the name the catalogue gives them
  const kits = J(api.kbNcKits([{ id: 'kybernos-themes/ecommerce', have: false }, { id: 'kybernos-themes/real-estate', have: true, appId: 'db1' }, { id: 'plain' }, null, { id: '' }]))
  assert.deepEqual(kits, { ecommerce: { id: 'kybernos-themes/ecommerce', have: false, appId: '' }, 'real-estate': { id: 'kybernos-themes/real-estate', have: true, appId: 'db1' }, plain: { id: 'plain', have: false, appId: '' } })
  assert.equal(api.kbNcKits(undefined), null, 'the seam has not answered')
  // the examples a type shows
  const ids = (type, k) => J(api.kbNcExamples(cat, type, k)).map((e) => e.id)
  assert.deepEqual(ids('doc', null), ['doc_a', 'doc_b'], 'any other type: every example')
  assert.deepEqual(ids('app', kits), ['app_start', 'app_shop'].sort((a, b) => ['app_shop', 'app_hotel', 'app_other', 'app_start'].indexOf(a) - ['app_shop', 'app_hotel', 'app_other', 'app_start'].indexOf(b)), 'the template with its kit, the simple start; not the idea with no kit, not the kit this install lacks')
  assert.deepEqual(ids('app', null), ['app_start'], 'before the seam answers only the simple starts show (a kit example never flashes in and out)')
  assert.deepEqual(ids('app', {}), ['app_start'], 'no kit at all')
  assert.deepEqual(ids('nope', kits), []); assert.deepEqual(J(api.kbNcExamples(null, 'doc', null)), [])
  // pictures: an address on this machine, the dialog's larger one when there is one
  assert.equal(api.kbNcPicUrl(ex('doc_a', 'doc'), false), '/kybernos/templates-image?f=doc_a.webp')
  assert.equal(api.kbNcPicUrl(ex('doc_a', 'doc', { image: { src: 'doc_a.webp', large: 'large/doc_a.webp' } }), true), '/kybernos/templates-image?f=large%2Fdoc_a.webp')
  assert.equal(api.kbNcPicUrl(ex('doc_a', 'doc', { image: { src: 'doc_a.webp' } }), true), '/kybernos/templates-image?f=doc_a.webp', 'no larger picture: the card\'s')
  assert.equal(api.kbNcPicUrl({ id: 'x' }, false), ''); assert.equal(api.kbNcPicUrl(null, true), '')
  // the structure of an App: its tables in two rows, one line a link
  const s = J(api.kbNcStructure(cat.templates[2]))
  assert.equal(s.boxes.length, 4); assert.equal(s.lines.length, 3)
  assert.deepEqual(s.boxes.map((b) => b.label), ['Contacts', 'Products', 'Orders', 'Notes'])
  assert.ok(s.boxes.every((b) => b.x >= 43 && b.x <= 277 && (b.y === 62 || b.y === 138)), 'every box is inside the 320 x 200 frame')
  assert.ok(s.lines.every((l) => l.y1 < l.y2), 'a line runs from the lower edge of the upper box to the upper edge of the lower one')
  assert.equal(api.kbNcStructure(cat.templates[0]), null, 'an example with no tables has no structure')
  assert.deepEqual(J(api.kbNcStructure({ tables: ['A', 'B'], links: [[0, 9], 'x'] }).lines), [], 'a link to a table that is not there draws nothing')
  assert.equal(api.kbNcAdaptText('Start from the \u201c', { name: 'Shop' }, '\u201d template and adapt it: '), 'Start from the \u201cShop\u201d template and adapt it: ')
  assert.equal(api.kbNcRemixText('Remix. Keep \u201c', { prompt: 'A red kettle' }, '\u201d but change: '), 'Remix. Keep \u201cA red kettle\u201d but change: ')
  assert.equal(api.kbNcMadeLine({ model: 'black-forest-labs/FLUX-2-dev', label: 'FLUX.2 dev', width: 1280, height: 800, seed: 421 }, 'Made with', 'seed'), 'Made with FLUX.2 dev \u00b7 1280\u00d7800 \u00b7 seed 421')
  assert.equal(api.kbNcMadeLine({ model: 'a/b' }, 'Made with', 'seed'), 'Made with a/b', 'no label: the id; no size or seed: nothing more')
  assert.equal(api.kbNcMadeLine(undefined, 'Made with', 'seed'), '', 'an example that was not generated has no such line')
  assert.equal(api.kbNcMadeLine({ label: 'x' }, 'Made with', 'seed'), '')
  // a video example: its clip is asked of the host by name; its prompt is a request (no « Use this prompt » / Remix), unlike a generated picture's
  assert.equal(api.kbNcVideoUrl({ video: { src: 'video/video_a.mp4' } }), '/kybernos/templates-video?f=video%2Fvideo_a.mp4')
  assert.equal(api.kbNcVideoUrl({ image: { src: 'a.webp' } }), '')
  assert.equal(api.kbNcVideoUrl({ video: { src: '' } }), '')
  assert.equal(api.kbNcVideoUrl(null), '')
  assert.equal(api.kbNcPromptMode({ made: { model: 'a/b' } }), true, 'a generated picture: its prompt is what the model got')
  assert.equal(api.kbNcPromptMode({ made: { model: 'a/b', prompt: 'p' }, video: { src: 'video/a.mp4' } }), false, 'a video: its prompt is the request, the sample prompt is made.prompt')
  assert.equal(api.kbNcPromptMode({}), false)
  assert.equal(api.kbNcPromptMode(null), false)
  assert.equal(api.KB_NC_DB_SEL, 'kybernos.db.selection')
  // the Apps page reads the very key we write
  const dbSrc = readFileSync(join(here, '..', 'kybernos-db', 'client.js'), 'utf8')
  assert.ok(dbSrc.includes("const SEL_KEY = '" + api.KB_NC_DB_SEL + "'"), 'kybernos-db remembers its open app under the key the shelf writes')
  assert.ok(/const ROW_ID = 'tables'/.test(dbSrc) && /window\.__KB_OPEN__\(\{ view: 'tables' \}\)/.test(src), 'and its page is the row the shelf opens')
  // wiring of the dialog
  const d = src.slice(src.indexOf('const KbNcDialog = (dp)'), src.indexOf('const KbNewChatCards = (props)'))
  assert.ok(/kbPortalDe\(/.test(d) && /role: 'dialog', 'aria-modal': 'true'/.test(d), 'the dialog is a modal in the document body')
  assert.ok(/ev\.key === 'Escape'/.test(d) && /ev\.key !== 'Tab'/.test(d) && /closeRef\.current\.focus\(\)/.test(d), 'Escape closes, Tab stays inside, the focus goes in')
  assert.ok(/seam\.add\(kit\.id, \{ sample: true, kit: true \}\)/.test(d), 'a template with a kit is made through the Apps seam, with its sample rows and its kit, as the Apps page does')
  assert.ok(!/setDraft|submit/.test(d), 'the dialog never touches the composer or sends: the page does, through kbNcFill')
  assert.ok(/e\.kind === 'template'/.test(d) && /kit\.have === true/.test(d), 'an app that already exists is opened, not made twice')
  assert.ok(/kbNcVideoUrl\(e\)/.test(d) && /'data-kb': 'newchat-example-play'/.test(d) && /playPair\[1\]\('playing'\)/.test(d), 'a clip is only asked of the host once someone presses Play')
  assert.ok(/h\('video',/.test(d) && /onError: \(\) => playPair\[1\]\('failed'\)/.test(d) && /kbnc\.sh\.noclip/.test(d), 'a clip that cannot be read says so, and the first frame comes back')
  ok('the examples: only what this install can serve, pictures from the host, the structure of an App, the dialog is a modal that never sends and opens the Apps page on the app it made')
}

{
  // the headline: 28 invented lines, both languages, short enough for one line, none repeated, never the previous one
  assert.equal(api.KB_NC_HERO_COUNT, 28)
  const en = []; const fr = []
  for (let i = 0; i < api.KB_NC_HERO_COUNT; i += 1) {
    const m = new RegExp("'kbnc\\.hero\\." + i + "': \\{ kybernos: '((?:[^'\\\\]|\\\\.)*)', en: '((?:[^'\\\\]|\\\\.)*)' \\}").exec(src)
    assert.ok(m !== null, 'kbnc.hero.' + i + ' has both languages')
    fr.push(m[1].replace(/\\'/g, "'")); en.push(m[2].replace(/\\'/g, "'"))
  }
  for (const [lang, list] of [['fr', fr], ['en', en]]) {
    assert.equal(new Set(list).size, list.length, lang + ': no line twice')
    for (const l of list) { assert.ok(l.length <= 32, lang + ': "' + l + '" fits on one line (' + l.length + ')'); assert.ok(!/kyber/i.test(l), lang + ': "' + l + '" does not name a Kyber') }
  }
  assert.ok(!en.includes('Into the Unknown'), 'the native line is not in the pool')
  // the picker
  for (const last of [-1, 0, 5, 27]) for (const r of [0, 0.0001, 0.5, 0.9999, 1, NaN, -3]) {
    const i = api.kbNcPickLine(28, last, () => r)
    assert.ok(Number.isInteger(i) && i >= 0 && i < 28, 'index in range for r=' + r)
    assert.notEqual(i, last, 'never the line shown last time (last=' + last + ', r=' + r + ')')
  }
  assert.equal(api.kbNcPickLine(1, 0, () => 0.3), 0, 'a pool of one has no choice')
  assert.equal(api.kbNcPickLine(28, -1, () => 0.5), 14, 'deterministic with an injected random')
  const seen = new Set(); for (let k = 0; k < 400; k += 1) seen.add(api.kbNcPickLine(28, -1))
  assert.ok(seen.size > 20, 'real randomness reaches most of the pool')
  ok('the headline: 28 original lines in French and English, each short, never the previous one twice')
}
{
  // the hero swept in place with « Beta »
  assert.ok(/querySelectorAll\('\[class\*="titleGroup"\]'\)/.test(src) && /indexOf\('previewBadge'\)/.test(src), 'the hero is found by DSH\'s own class names, only when its badge is there')
  assert.ok(/setText\(badge, 'Beta'\)/.test(src), 'the badge says Beta')
  assert.ok(/\[class\*="previewBadge"\]\[data-kb-beta\]\{[^}]*font-size:10\.5px[^}]*text-transform:uppercase[^}]*background:transparent;border:1px solid/.test(src), 'and is small, upper case, an outline')
  assert.ok(!/locale\.register\([^)]*hero\./.test(src), 'no locale override: it would throw on a duplicate key')
  ok('the headline / Beta badge are wired without an engine patch')
}

// 6e. Search everywhere (kybernos-search) is no longer a menu row: the bundle draws its own icon at the top of the sidebar (and ⌘K)
{
  assert.ok(!/row\('search', Icon\('search', 15\)/.test(src), 'no menu row for it any more')
  assert.ok(!/const KB_SR = /.test(src) && !/'kbui\.searchall'/.test(src), 'and none of its dead code: the flag, the string')
  ok('the Search everywhere menu row is gone (its icon is the bundle\'s, at the top of the sidebar)')
}

// 6f. a dictionary key is declared ONCE: the later of two silently wins. (« kbui.search » was declared twice: the menu row's
//     « Search everywhere » replaced the « Search » that prefixes every search placeholder, on the project page and in the icon picker.)
{
  const keys = [...src.matchAll(/^\s{6}'([A-Za-z0-9._\-]+)': \{ kybernos: /gm)].map((m) => m[1])
  const seen = new Set()
  const dup = []
  for (const k of keys) { if (seen.has(k)) dup.push(k); seen.add(k) }
  assert.ok(keys.length > 1500, 'the dictionary was scanned (' + keys.length + ' keys)')
  assert.deepEqual(dup, [], 'keys declared more than once: ' + dup.join(', '))
  assert.ok(/'kbui\.search': \{ kybernos: 'Rechercher ', en: 'Search ' \}/.test(src), 'the placeholder prefix is still « Search »')
  ok('no dictionary key is declared twice, and « Search » (the placeholder prefix) is intact')
}

// 6b. Kaby's own chat is no place to start building
{
  assert.ok(/isKybySession\(sid\) === true\) return null/.test(src), 'the new-chat cards stay out of Kaby\'s own chat')
  ok('the new-chat cards stay out of Kaby\'s own chat')
}

// 7. the menu row and the hiding are wired
{
  assert.ok(/KB_SHOW_CLOUD_COMPUTER_ROW === true && KB_KY === true \? row\('cloudcomputer'/.test(src), 'the Cloud Computer row is behind its own switch, and shows only with the Kaby satellite')
  assert.ok(/const KB_SHOW_CLOUD_COMPUTER_ROW = false\n/.test(src), 'the Cloud Computer row is hidden for now (one constant to turn back on)')
  assert.ok(/kbNcIsNativeSchedules\(kbNavKeyOf\(/.test(src), 'the hiding reads the row key with the nav helper')
  assert.ok(/id: 'kybernos-automations'|'kybernos-automations', \d+/.test(src), 'the Automations settings page is registered')
  ok('menu row, hiding and settings page are wired')
}

// 8. the cards go when Kaby's chat becomes known (measured on a page load: they were drawn before its bundle had read which chat is Kaby's, and stayed)
{
  const fs = await import('node:fs')
  const path = await import('node:path')
  const url = await import('node:url')
  const kyberSrc = fs.readFileSync(path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..', 'kybernos-kyber', 'client.js'), 'utf8')
  const evt = /new CustomEvent\('([a-z-]+)'/.exec(kyberSrc)
  assert.ok(evt !== null, 'the Kaby bundle announces its chat by a window event')
  const listens = /window\.addEventListener\('([a-z-]+)', again\)/.exec(src)
  assert.ok(listens !== null && listens[1] === evt[1], 'the cards listen to the very event the Kaby bundle sends')
  const at = src.indexOf("window.addEventListener('" + evt[1] + "', again)")
  const early = src.indexOf("if (blank !== '1') return null", at)
  const cardsStart = src.indexOf('const KbNewChatCards = (props) => {')
  assert.ok(cardsStart > 0 && at > cardsStart && early > at, 'the listener is set before the component\'s early return (hooks keep their order)')
  assert.ok(/removeEventListener\('kb-kyby-session', again\)/.test(src), 'and it is removed with the component')
  ok('the new-chat cards are told when Kaby\'s chat becomes known')
}

// 9. the video examples start a skill that ships with the plugin and is seeded on a fresh home
{
  const fs = await import('node:fs')
  const indexSrc = readFileSync(join(here, 'index.js'), 'utf8')
  const listed = /const KB_SHIPPED_SKILLS = \[([^\]]*)\]/.exec(indexSrc)
  assert.ok(listed !== null && /'video-creator'/.test(listed[1]), 'video-creator is in the list of skills the plugin seeds')
  for (const name of listed[1].split(',').map((s) => s.trim().replace(/'/g, '')).filter((s) => s !== '')) {
    const text = readFileSync(join(here, 'skills', name, 'SKILL.md'), 'utf8')
    assert.ok(new RegExp('^---\\nname: ' + name + '\\ndescription: .+\\nwhenToUse: .+\\n---\\n').test(text), name + ' has its front matter (name, description, whenToUse)')
  }
  const skill = readFileSync(join(here, 'skills', 'video-creator', 'SKILL.md'), 'utf8')
  const motionSrc = readFileSync(join(here, '..', 'kybernos-motion', 'motion-host.mjs'), 'utf8')
  const tool = /export const TOOL = '([a-z_]+)'/.exec(motionSrc)
  assert.ok(tool !== null && skill.includes('`' + tool[1] + '`'), 'the skill names the Motion tool that really exists')
  assert.ok(skill.includes('/kybernos-cloud/models') && readFileSync(join(here, '..', 'kybernos-cloud', 'index.js'), 'utf8').includes('/kybernos-cloud/models'), 'the skill reads the models from a route that exists')
  for (const word of ['product photo', 'garment', 'theme', 'best exterior photo', 'old photo', 'exercises', 'logo']) assert.ok(skill.includes(word), 'the skill asks for the ' + word + ' that its example asks for')
  assert.ok(/clip cannot be made yet/.test(skill) && /Never ask for, print or store an API key/.test(skill), 'the skill says plainly that generation is not wired and never asks for a key')
  ok('the video examples start video-creator: shipped, seeded, and tied to a real tool and route')

  // the old-photo example has its own skill: restore first, show it, then animate; the film is in the person's language; it stops at a brief when nothing can be generated
  assert.ok(/'photo-alive'/.test(listed[1]), 'photo-alive is in the list of skills the plugin seeds')
  const alive = readFileSync(join(here, 'skills', 'photo-alive', 'SKILL.md'), 'utf8')
  assert.ok(skill.includes('`photo-alive`'), 'video-creator sends the old-photo example to photo-alive')
  assert.ok(alive.includes('/kybernos-cloud/models') && /Prices and model ids come from the models answer only/.test(alive), 'photo-alive reads the models and the prices from the models route')
  assert.ok(alive.indexOf('## 3. Restore, then ask') > 0 && alive.indexOf('## 3. Restore, then ask') < alive.indexOf('## 4. The clip'), 'the restoration comes before the clip')
  assert.ok(/wait for a yes/.test(alive) && /Never generate, spend or send the photograph before the person said yes/.test(alive), 'nothing is paid for before the person has seen the restored picture')
  assert.ok(/in the language the person writes to you/.test(alive), 'the voice, the caption and the label follow the person\'s language')
  assert.ok(/the film cannot be made yet/.test(alive) && /photo-alive-brief\.md/.test(alive) && /Never ask for, print or store an API key/.test(alive), 'photo-alive stops at a brief when nothing can be generated and never asks for a key')
  assert.ok(/blend=all_expr/.test(alive) && /xfade=transition=fade/.test(alive) && /-pix_fmt yuv420p/.test(alive), 'photo-alive carries the ffmpeg commands of the opening and of the join (a player-safe pixel format)')
  ok('the old-photo example has its own skill: restore, show, animate, join, in the person\'s language')
}

// 14. a text example is one quiet box: its own icon, its title as the tag, the request; no category word, no line under the box
{
  const g0 = src.indexOf('const KB_NC_GLYPH = {')
  const g1 = src.indexOf('\n}\n', g0)
  assert.ok(g0 > 0 && g1 > g0, 'the glyph table exists')
  const glyphs = vm.runInNewContext('(' + src.slice(g0 + 'const KB_NC_GLYPH = '.length, g1 + 2) + ')')
  const fallback = JSON.parse(readFileSync(join(here, 'templates-fallback.json'), 'utf8'))
  const cards = fallback.templates.filter((e) => e.kind === 'prompt')
  assert.ok(cards.length >= 37, 'the shipped catalogue has its text examples')
  for (const e of cards) assert.ok(typeof glyphs[e.id] === 'string' && /^<(path|rect|circle)/.test(glyphs[e.id]), e.id + ' has an icon of its own')
  assert.equal(new Set(cards.map((e) => glyphs[e.id])).size, cards.length, 'no two text examples share an icon')
  assert.ok(Object.keys(glyphs).every((k) => cards.some((e) => e.id === k)), 'no icon is left for an example that is gone')
  const card = src.slice(src.indexOf("'data-kind': 'prompt'"), src.indexOf("'data-kind': 'prompt'") + 900)
  assert.ok(card.includes('kb8-sh-ico') && card.includes('kb8-sh-ptag') && !card.includes('e.tag') && !card.includes('kb8-sh-name') && !card.includes('kb8-sh-line'), 'the card carries the icon and the title tag, not the category tag nor a line under the box')
  assert.ok(!src.includes('kbnc.sh.promptfine') && !src.includes('kb8-sh-quote'), 'the old quote mark and the repeated sentence are gone')
  assert.ok(!src.includes('kb8-sh-tag') && !/className: 'kb8-sh-(name|title)'[^\n]*e\.tag/.test(src), 'no example card nor its dialog draws the category tag (Business, Marketing...)')
  ok('a text example: its own icon, its title as the tag, the request; no category word, nothing under the box')
}

console.log('\n' + pass + ' checks passed')
