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
const api = vm.runInNewContext(src.slice(a, b) + '\n;({ KB_NC_GROUPS, KB_NC_TEMPLATES, KB_NC_ART, KB_NC_WORDS, kbNcTemplates, kbNcSlider, kbNcDetect, kbNcFill, kbNcCloud, kbNcDot, kbNcActions, kbNcRefusalKey, kbNcIsNativeSchedules, kbNcHideNative, KB_NC_HERO_COUNT, kbNcPickLine })')

// 1. the 13 templates, in the four chapters of the slider; each is offered only when the bundle it needs is installed
{
  const J = (v) => JSON.parse(JSON.stringify(v))   // the arrays come from another realm
  const all = api.KB_NC_TEMPLATES
  assert.equal(all.length, 13, 'the 13 templates the product really has (not more: nothing is offered that does not exist)')
  assert.deepEqual(J(api.KB_NC_GROUPS), ['docs', 'media', 'apps', 'auto'])
  assert.equal(new Set(all.map((t) => t.id)).size, all.length, 'ids are unique')
  for (const t of all) assert.ok(J(api.KB_NC_GROUPS).indexOf(t.group) >= 0, t.id + ' is in a known chapter')
  const chapters = (boot) => J(api.kbNcSlider(boot).map((g) => g.id + ':' + g.templates.map((t) => t.id).join('/')))
  const core = ['docs:doc/sheet', 'media:image', 'apps:website', 'auto:automation/team/skill/plugin']
  assert.deepEqual(chapters([]), core, 'with no satellite only the core templates, the chapters in order')
  assert.deepEqual(chapters(null), core, 'no boot list reads as none')
  assert.deepEqual(chapters(['@local/kybernos-slides', '@local/kybernos-dashboards', '@local/kybernos-motion', '@local/kybernos-miniapps', '@local/kybernos-modeleur']),
    ['docs:slides/doc/sheet/dashboard', 'media:image/video', 'apps:website/miniapp/model3d', 'auto:automation/team/skill/plugin'], 'every satellite: all 13')
  assert.ok(!api.kbNcSlider(['@local/kybernos-dashboards']).some((g) => g.templates.some((t) => t.id === 'slides')), 'a template of another bundle stays hidden')
  assert.ok(api.kbNcTemplates(api.KB_NC_TEMPLATES, ['@local/kybernos-modeleur']).some((t) => t.id === 'model3d'))
  ok('the 13 templates follow the installed bundles, in four chapters (never offered dead)')
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
  for (const key of ['label', 'prev', 'next']) assert.ok(new RegExp("'kbnc\\.sl\\." + key + "': \\{ kybernos: '[^']+', en: '[^']+' \\}").test(src), 'slider sentence ' + key)
  // the Build / Create cards are gone, and so are their sentences (dead code)
  for (const key of ['kbnc.build', 'kbnc.create', 'kbnc.close']) assert.ok(!src.includes("'" + key + "'"), key + ' is not left behind')
  ok('every template has its label and prompt in both languages and a drawing; the chapters and the slider are named; no dead sentence')
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
  }
  for (const [text, id] of Object.entries(want)) assert.equal(api.kbNcDetect(text, ids), id, text + ' → ' + id)
  assert.equal(api.kbNcDetect('hello there', ids), null, 'nothing sounds like a template')
  assert.equal(api.kbNcDetect('', ids), null); assert.equal(api.kbNcDetect('ab', ids), null, 'too short says nothing')
  assert.equal(api.kbNcDetect(null, ids), null); assert.equal(api.kbNcDetect('a website', null), null, 'no offered list, no match')
  assert.equal(api.kbNcDetect('a website for me', ['doc']), null, 'a template that is not offered is never lit')
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
  // every sentence the card can show exists in both languages
  for (const key of ['resume', 'suspend', 'open', 'busy']) assert.ok(new RegExp("'kbnc\\.cc\\.act\\." + key + "': \\{ kybernos: '[^']+', en: '[^']+' \\}").test(src), 'act.' + key)
  for (const key of ['always_on', 'run_hours_exhausted', 'computer_deleting', 'computers_off_for_workspace', 'not_allowed_to_open', 'computer_not_ready', 'owner_left', 'rate_limited', 'no_computer', 'not_connected', 'refused', 'unreachable']) {
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
  assert.ok(/@container kbnc \(max-width:480px\)\{\.kb8-sl-nav\{display:none\}\}/.test(src), 'a narrow dock is swiped: no arrows')
  assert.ok(/id: 'kybernos-newchat', order: 25 \}, KbNewChatCards\)/.test(src) && !/conversation\.composer\.dock[^\n]{0,80}kybernos-newchat/.test(src), 'still the input dock entry (composer.dock is not drawn on the hero)')
  ok('the slider is drawn under the composer by CSS order, and drops its arrows in a narrow dock')
}

// 6d. ONE colour: the theme's accent (owner, 2026-10-15 « pas de couleurs… » and 2026-10-18 « trop de couleurs »)
{
  assert.ok(!/KB_NC_HUES|kbNcTint|KB_NC_VISUALS|KB_NC_BUILD|KB_NC_CREATE|kb8-nc-ico|kb8-nc-panel|kb8-nc-row/.test(src), 'no hue table, no tinted icon tile, no panel: nothing left of the multicolour cards')
  assert.ok(/\.kb8-nc\{--kb8-acc:var\(--dsw-alias-brand-primary\)/.test(src), 'the accent is the theme\'s (the token Settings > Theme drives)')
  const css = src.slice(src.indexOf('.kb8-nc{--kb8-acc'), src.indexOf("'kybers: styles of the new chat cards'"))
  assert.ok(css.length > 4000, 'the slider CSS was found')
  const hexes = css.match(/#[0-9a-f]{3,8}\b/gi) || []
  assert.deepEqual(hexes.filter((x) => x.toLowerCase() !== '#000'), [], 'the slider CSS holds no colour of its own (only tokens, and black for shadows and masks)')
  // the 13 templates' drawings and the eight the Creations page adds (cards, quiz, code, diagram, all, pdf, folder, file)
  assert.deepEqual(Object.keys(api.KB_NC_ART).filter((id) => !api.KB_NC_TEMPLATES.some((t) => t.id === id)), ['cards', 'quiz', 'code', 'diagram', 'all', 'pdf', 'folder', 'file'], 'the extra drawings are exactly the ones the Creations page adds (tiles and file icons)')
  for (const t of Object.keys(api.KB_NC_ART).map((id) => ({ id }))) {
    const art = api.KB_NC_ART[t.id]
    // inline shapes only: nothing fetched, nothing executable, no colour (no media in git, AGENTS rule 4)
    assert.ok(/^(<(rect|circle|path)\b[^>]*\/>)+$/.test(art), t.id + ' drawing is only rect / circle / path')
    assert.ok(!/(href|src)\s*=|https?:|url\(|<image|<script|<foreignObject|\son[a-z]+\s*=|#[0-9a-f]{3,8}\b|fill\s*=|stroke\s*=/i.test(art), t.id + ' drawing has no external reference, no script and no colour of its own (classes only)')
    const classes = new Set([...art.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(' ')))
    for (const c of classes) assert.ok(new RegExp('\\.kb8-sl-stage \\.' + c + '[{,]|' + '\\.kb8-sl-stage \\.' + c + ' ').test(css) || new RegExp('(?:^|[ ,])\\$\\{kbNcHot\\} \\.' + c + '[{,]').test(css) || ['gr', 'blk', 'pop', 'dr', 'play', 'sun', 'node'].indexOf(c) >= 0 && css.includes('} .' + c + '{') || css.includes('.' + c + '{') || css.includes('.' + c + ','), t.id + ': class « ' + c + ' » is styled')
  }
  ok('one colour on the page (the theme\'s accent); the 21 drawings are classes on inline shapes, styled from tokens')
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

// 6e-pre. the slider: wiring pinned at source level
{
  const c = src.slice(src.indexOf('const KbNcSlider = (sp)'), src.indexOf('const KbNewChatCards = (props)'))
  assert.ok(c.length > 3000, 'the slider component exists')
  assert.ok(/dangerouslySetInnerHTML: \{ __html: '<svg viewBox="0 0 64 44" aria-hidden="true">' \+ KB_NC_ART\[t\.id\]/.test(c), 'a card draws its template\'s inline drawing')
  assert.ok(/scrollBy\(/.test(c) && /const bring = \(el, align\)/.test(c), 'arrows page the track, and a title or a lit card is brought in by scrolling the track')
  // the browser's own scroll-into-view scrolls every scrollable ancestor: it pushed DSH's frame 462 px sideways and the composer out of the window
  assert.ok(!/\.scrollIntoView\(/.test(c), 'the slider never calls scrollIntoView (it moves the engine\'s own containers, not only the track)')
  assert.ok(/pointerType === 'mouse'/.test(c) && /quietRef/.test(c), 'a mouse drags the track and a drag is never a click')
  assert.ok(/'aria-label': kbt\('kbnc\.sl\.prev'\)/.test(c) && /'aria-label': kbt\('kbnc\.sl\.next'\)/.test(c) && /role: 'group'/.test(c), 'the arrows and the track are named')
  assert.ok(/direction === 'rtl'/.test(c) && /st\.rtl/.test(c), 'right-to-left is read (the arrows and the edge fades follow it)')
  assert.ok(/kbNcCalm\(\) \? 'auto' : 'smooth'/.test(c), 'no smooth scrolling when the person asked for reduced motion')
  const cards = src.slice(src.indexOf('const KbNewChatCards = (props)'), src.indexOf('const KbNewChatCards = (props)') + 14000)
  assert.ok(/p\.input\.draft/.test(cards) && /kbNcDetect\(draft, offered\)/.test(cards) && /h\(KbNcSlider, \{ groups, match, onPick: prefill \}\)/.test(cards), 'the slider is lit by the draft the dock entry receives')
  assert.ok(/kbNcFill\(draft, kbt\('kbnc\.p\.' \+ id\)/.test(cards), 'a click fills the composer through kbNcFill (the person\'s words are kept)')
  assert.ok(/'data-kb': 'newchat-cloud'/.test(cards) && /'data-kb': 'newchat-cloud-open'/.test(cards) && /'data-kb': 'newchat-cloud-' \+ verb/.test(cards), 'the Cloud Computer line keeps its hooks and its actions')
  assert.ok(/kbNcDot\(cloud\.kind\)/.test(cards) && /kbNcActions\(cloud\)/.test(cards), 'and its state dot and the actions its state allows')
  ok('the slider: drawings, paging, drag, names, right-to-left, reduced motion; lit by the draft; the Cloud Computer line keeps its state and actions')
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
  assert.ok(/\[class\*="previewBadge"\]\[data-kb-beta\]\{[^}]*font-size:10px/.test(src), 'and is small')
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

console.log('\n' + pass + ' checks passed')
