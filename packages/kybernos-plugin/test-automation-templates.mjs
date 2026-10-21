// Test of Discover on the Automations page: the catalogue of templates (what each one says, in both languages, and nothing the engine
// cannot do), how it is filtered, and the text that turns a template into a chat. It extracts the KB-AUTOTPL block of client.js (the
// file is a browser bundle with no exports), then checks, on the source, what the page that draws it is allowed to do.
// Usage: node packages/kybernos-plugin/test-automation-templates.mjs   (exit 0 = everything passes)
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(fileURLToPath(new URL('./client.js', import.meta.url)), 'utf8')
const parts = src.split('// KB-AUTOTPL-BEGIN')
if (parts.length !== 2) { console.error('exactly one KB-AUTOTPL block expected in client.js'); process.exit(1) }
const block = parts[1].split('// KB-AUTOTPL-END')[0]
const m = await import('data:text/javascript,' + encodeURIComponent(block + '\nexport { KB_TPL_CATS, KB_TPLS, kbTplText, kbTplFilter, kbTplStepKind, kbTplChatText, kbTplSlug, kbTplSvgOk, kbTplLogos, kbTplLangName }'))

let fails = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) { fails++; console.log('FAIL', label, '| got', JSON.stringify(got), '| want', JSON.stringify(want)) } else console.log('ok  ', label)
}
const en = (p) => p[0]
const fr = (p) => p[1]

// The fixed words of the chat text, read from the page's own pairs.
const pairs = {}
for (const x of src.matchAll(/'(tasks\.tpl\.[\w.]+|tasks\.tab\.(?:yours|discover))': \{ kybernos: '((?:[^'\\]|\\.)*)', en: '((?:[^'\\]|\\.)*)' \}/g)) pairs[x[1]] = { fr: x[2], en: x[3] }
const trEn = (k) => (pairs[k] !== undefined ? pairs[k].en : 'MISSING:' + k)
const trFr = (k) => (pairs[k] !== undefined ? pairs[k].fr : 'MISSING:' + k)

/* ── The catalogue ───────────────────────────────────────────────────────── */
eq('three categories, each with a title in both languages and a colour of the theme (no literal hex)', m.KB_TPL_CATS.map((c) => [c.id, c.title.length, /^var\(--dsw-alias-state-(warn|business|success)-primary\)$/.test(c.color)]), [['social', 2, true], ['prospecting', 2, true], ['support', 2, true]])
eq('ten templates, none twice', [m.KB_TPLS.length, new Set(m.KB_TPLS.map((t) => t.id)).size], [10, 10])
eq('every template belongs to a category', m.KB_TPLS.every((t) => m.KB_TPL_CATS.some((c) => c.id === t.cat)), true)
{
  const pairOk = (p) => Array.isArray(p) === true && p.length === 2 && typeof p[0] === 'string' && typeof p[1] === 'string' && p[0].trim().length > 0 && p[1].trim().length > 0
  const bad = []
  for (const t of m.KB_TPLS) {
    const all = [t.title, t.cadence, t.desc, ...t.tags, ...t.steps.map((s) => s[1]), ...t.needs, ...t.guard, ...t.ask.flatMap((q) => [q.q, ...q.o])]
    if (all.every(pairOk) !== true) bad.push(t.id)
  }
  eq('every text of every template is an English / French pair, none empty', bad, [])
  eq('the French is not the English copied: titles, descriptions and steps differ', m.KB_TPLS.filter((t) => fr(t.title) === en(t.title) && fr(t.desc) === en(t.desc)).map((t) => t.id), [])
}
eq('a step is a model step or a tool step, one to six per template', m.KB_TPLS.every((t) => t.steps.length >= 2 && t.steps.length <= 6 && t.steps.every((s) => s[0] === 'ai' || s[0] === 'act')), true)
eq('each template asks two to four questions, each with at least two options', m.KB_TPLS.every((t) => t.ask.length >= 2 && t.ask.length <= 4 && t.ask.every((q) => q.o.length >= 2)), true)
eq('each template says what it needs, what it is bound by, and has tags and apps', m.KB_TPLS.every((t) => t.needs.length > 0 && t.guard.length > 0 && t.tags.length > 0 && t.apps.length > 0), true)
eq('a schedule is a five-field cron, or null for a template a webhook starts', m.KB_TPLS.every((t) => t.cron === null || /^\S+ \S+ \S+ \S+ \S+$/.test(t.cron)), true)
eq('a template that no schedule starts says a webhook does', m.KB_TPLS.filter((t) => t.cron === null).every((t) => /webhook/i.test(en(t.cadence)) && /webhook/i.test(fr(t.cadence))), true)
eq('the first memory check of a heavy template is a step of its own, written PREFLIGHT', m.KB_TPLS.filter((t) => t.tags.some((x) => en(x) === 'Memory check')).every((t) => /^PREFLIGHT/.test(en(t.steps[0][1]))), true)
{
  // What the engine does not have is not promised: there is no budget, no payment and no spending cap behind these templates.
  const words = /budget|payment|paiement|spend|dépens|cost per|coût par|minutes cap|per month|par mois/i
  const said = m.KB_TPLS.filter((t) => words.test(JSON.stringify(t))).map((t) => t.id)
  eq('no template promises a budget, a payment or a monthly spending cap', said, [])
}
eq('the icons are ones the page draws', m.KB_TPLS.map((t) => t.icon).filter((i) => new RegExp('^  ' + i + ': \\[', 'm').test(src.slice(src.indexOf('const LUCIDE = {'), src.indexOf('const Icon = '))) !== true), [])

/* ── Words and filters ───────────────────────────────────────────────────── */
eq('a pair is read in the language `pick` chooses, English by default', [m.kbTplText(['a', 'b'], en), m.kbTplText(['a', 'b'], fr), m.kbTplText(['a', 'b']), m.kbTplText(null, en)], ['a', 'b', 'a', ''])
eq('all templates when no category and no words', m.kbTplFilter(m.KB_TPLS, 'all', '', en).length, 10)
eq('a category keeps its own', [m.kbTplFilter(m.KB_TPLS, 'social', '', en).length, m.kbTplFilter(m.KB_TPLS, 'prospecting', '', en).length, m.kbTplFilter(m.KB_TPLS, 'support', '', en).length], [3, 3, 4])
eq('words are looked for in the title, the text, the tags and the apps', [m.kbTplFilter(m.KB_TPLS, 'all', 'whatsapp', en).map((t) => t.id), m.kbTplFilter(m.KB_TPLS, 'all', 'shopify', en).map((t) => t.id)], [['cs-whatsapp', 'cs-shopify'], ['cs-shopify']])
eq('every word must match, in any order, whatever the case', m.kbTplFilter(m.KB_TPLS, 'all', 'CALL  outbound', en).map((t) => t.id), ['prosp-calls'])
eq('the filter reads the page’s language: a French word finds the French text', [m.kbTplFilter(m.KB_TPLS, 'all', 'appels sortants', fr).map((t) => t.id), m.kbTplFilter(m.KB_TPLS, 'all', 'appels sortants', en).length], [['prosp-calls'], 0])
eq('a category and words together', m.kbTplFilter(m.KB_TPLS, 'support', 'whatsapp', en).map((t) => t.id), ['cs-whatsapp', 'cs-shopify'])
eq('nothing matches, nothing breaks', [m.kbTplFilter(m.KB_TPLS, 'all', 'zzzz', en), m.kbTplFilter(null, 'all', '', en), m.kbTplFilter(m.KB_TPLS, 'all', undefined, en).length], [[], [], 10])
eq('a step kind is ai or act, act when unknown', [m.kbTplStepKind(['ai', ['x', 'y']]), m.kbTplStepKind(['act', ['x', 'y']]), m.kbTplStepKind(null), m.kbTplStepKind(['?'])], ['ai', 'act', 'act', 'act'])

/* ── Logos and the page's language ──────────────────────────────────────── */
eq('an app name is the slug of the connectors catalogue', ['Google Drive', 'HubSpot', 'YouTube', 'Google Sheets', 'X', null, undefined].map(m.kbTplSlug), ['googledrive', 'hubspot', 'youtube', 'googlesheets', 'x', '', ''])
{
  const good = '<svg viewBox="0 0 24 24"><path d="M1 1h22v22H1z" fill="#fff"/></svg>'
  eq('a plain SVG is accepted', m.kbTplSvgOk(good), true)
  const bad = ['<svg><script>alert(1)</script></svg>', '<svg onload="x()"></svg>', '<svg><g onclick = "x()"/></svg>', '<svg><foreignObject/></svg>', '<svg><image href="https://evil.example/a.png"/></svg>', '<svg><a href="https://evil.example"/></svg>', '<svg><a xlink:href=\'http://evil.example\'/></svg>', '<svg><path style="fill:url(https://evil.example/x)"/></svg>', '<svg><style>@import url(x)</style></svg>', '<svg><iframe/></svg>', '<svg href="javascript:alert(1)"/>', '<div>not svg</div>', '', null, undefined, 7, '<svg>' + 'x'.repeat(20001) + '</svg>']
  eq('script, handlers, foreign objects, images, external links and things that are not an SVG are refused', bad.map(m.kbTplSvgOk).filter((x) => x === true).length, 0)
  eq('an internal reference is fine, an external one is not', [m.kbTplSvgOk('<svg><use href="#a"/><g id="a"/></svg>'), m.kbTplSvgOk('<svg><use href="https://x.example/a.svg#a"/></svg>')], [true, false])
  const logos = m.kbTplLogos([{ s: 'slack', l: good }, { s: 'evil', l: bad[0] }, { s: 'none' }, null, 'x', { l: good }])
  eq('only the safe logos of the catalogue are kept, by slug', Object.keys(logos), ['slack'])
  eq('a catalogue that is not a list gives no logo', [m.kbTplLogos(null), m.kbTplLogos({}), m.kbTplLogos('x')], [{}, {}, {}])
}
eq('the page\'s language is named in English with its code, `kybernos` being French', [m.kbTplLangName('kybernos'), m.kbTplLangName('en'), m.kbTplLangName('fr'), m.kbTplLangName('es'), m.kbTplLangName('ar'), m.kbTplLangName('pt-BR')], ['French (fr)', 'English (en)', 'French (fr)', 'Spanish (es)', 'Arabic (ar)', 'Brazilian Portuguese (pt-BR)'])
eq('an unknown or empty language never throws: its code, or nothing', [m.kbTplLangName('zz-invalid-xx-yy'), m.kbTplLangName(''), m.kbTplLangName(null), m.kbTplLangName(undefined), m.kbTplLangName('!!')], ['zz-invalid-xx-yy', '', '', '', '!!'])
{
  const catalog = JSON.parse(readFileSync(fileURLToPath(new URL('../kybernos-composio/catalog.js', import.meta.url)), 'utf8').match(/export const CATALOG = (\[[\s\S]*\]);/)[1])
  const all = m.kbTplLogos(catalog)
  const apps = [...new Set(m.KB_TPLS.flatMap((t) => t.apps))]
  const withLogo = apps.filter((a) => all[m.kbTplSlug(a)] !== undefined)
  eq('every app of a template that the connectors catalogue knows has a logo that passes the filter', apps.filter((a) => catalog.some((c) => c.s === m.kbTplSlug(a) && typeof c.l === 'string' && all[c.s] === undefined)), [])
  eq('...which is all of them but Twilio (not in the catalogue: its initial in a round tile)', apps.filter((a) => withLogo.indexOf(a) < 0), ['Twilio'])
  eq('the catalogue that is read is the one the host serves', existsSync(fileURLToPath(new URL('../kybernos-composio/catalog.js', import.meta.url))), true)
}

/* ── The chat text ───────────────────────────────────────────────────────── */
for (const [name, tr, pick] of [['English', trEn, en], ['French', trFr, fr]]) {
  const texts = m.KB_TPLS.map((t) => m.kbTplChatText(t, tr, pick))
  eq(name + ': every chat text names the skill, the template, every step and every question', m.KB_TPLS.every((t, i) => texts[i].indexOf('automation-creator') >= 0 && texts[i].indexOf(pick(t.title)) >= 0 && t.steps.every((s) => texts[i].indexOf(pick(s[1])) >= 0) && t.ask.every((q) => texts[i].indexOf(pick(q.q)) >= 0 && q.o.every((o) => texts[i].indexOf(pick(o)) >= 0))), true)
  eq(name + ': no placeholder is left, nothing is undefined, no key is missing', texts.filter((x) => /undefined|MISSING|\{title\}|null/.test(x)), [])
  eq(name + ': the chat asks for a task that stays OFF until everything is connected', texts.every((x) => /active: false/.test(x)), true)
}
{
  const t = m.KB_TPLS.find((x) => x.id === 'social-daily')
  const text = m.kbTplChatText(t, trEn, en)
  eq('a template with a schedule hands it over, cron included', text.indexOf('Every day, 09:00 (cron 0 9 * * *)') >= 0, true)
  eq('a multiple-choice question says so, a single one does not', [/Where should the posts go\? Options: .*\(several allowed\)/.test(text), /Which providers for image, video and voice\? Options: [^\n]*\(several allowed\)/.test(text)], [true, false])
  eq('steps are numbered in order', text.indexOf('1. PREFLIGHT') > 0 && text.indexOf('2. Pick today') > text.indexOf('1. PREFLIGHT'), true)
  const hook = m.kbTplChatText(m.KB_TPLS.find((x) => x.id === 'cs-whatsapp'), trEn, en)
  eq('a webhook template does not invent a cron', hook.indexOf('cron') < 0, true)
  eq('without a language the chat starts with the skill, the way Create and Edit do', text.split('\n')[0].startsWith('Skill automation-creator — '), true)
  const withLang = m.kbTplChatText(t, trEn, en, 'French (fr)')
  eq('with a language, the first line asks to follow the conversation in it, then a blank line, then the skill', withLang.split('\n').slice(0, 3), ['Follow this conversation in my language: French (fr)', '', withLang.split('\n')[2]])
  eq('...and the rest of the text is the same', withLang.split('\n').slice(2).join('\n'), text)
  eq('an empty or blank language adds nothing', [m.kbTplChatText(t, trEn, en, ''), m.kbTplChatText(t, trEn, en, '   '), m.kbTplChatText(t, trEn, en, undefined)], [text, text, text])
  eq('the language line is the same sentence in both languages of the page', [pairs['tasks.tpl.chat.lang'].en, pairs['tasks.tpl.chat.lang'].fr], ['Follow this conversation in my language: {lang}', 'Follow this conversation in my language: {lang}'])
  eq('a language with a dollar sign in it stays as written', m.kbTplChatText(t, trEn, en, 'a $& b').split('\n')[0], 'Follow this conversation in my language: a $& b')
}
{
  const keys = ['head', 'rule', 'when', 'steps', 'ask', 'options', 'multi', 'needs', 'guard', 'save'].map((k) => 'tasks.tpl.chat.' + k)
  eq('every fixed word of the chat text exists in both languages', keys.filter((k) => pairs[k] === undefined || pairs[k].en === '' || pairs[k].fr === ''), [])
  eq('the heading keeps its {title} in both languages', [pairs['tasks.tpl.chat.head'].en.indexOf('{title}') > 0, pairs['tasks.tpl.chat.head'].fr.indexOf('{title}') > 0], [true, true])
}

/* ── What the page that draws it is allowed to do ────────────────────────── */
const disc = src.slice(src.indexOf('const kbTplPick = '), src.indexOf('const kbBoardBones = '))
eq('the Discover part is found', disc.length > 2000, true)
eq('read-only: Discover never calls the host, never writes a task or a setting; its one fetch is a GET of the logos the connectors page already serves', disc.indexOf('host.call') < 0 && disc.indexOf('act(') < 0 && disc.indexOf('localStorage') < 0 && (disc.match(/fetch\(/g) || []).length === 1 && disc.indexOf("fetch(kbApiBase() + '/composio/catalog', { method: 'GET' })") >= 0 && disc.indexOf("method: 'POST'") < 0, true)
eq('a logo is an inline SVG that passed the filter, else an initial: no <img>, no file, no address of its own', disc.indexOf('kbTplSvgOk') < 0 && /dangerouslySetInnerHTML: \{ __html: svg \}/.test(disc) && disc.indexOf('<img') < 0 && disc.indexOf("h('img'") < 0, true)
eq('the logos are filtered when the catalogue is read, never later', disc.indexOf('kbTplLogoCache = kbTplLogos(list)') >= 0, true)
eq('no image is shipped or loaded: no data URI, no <image>, no external address', disc.indexOf('data:') < 0 && disc.indexOf("'image'") < 0 && /https?:\/\//.test(disc) === false, true)
eq('the cover is drawn only on the page of one template, never on a card', (disc.match(/kbTplCover\(/g) || []).length === 1 && disc.indexOf("h('div', { className: 'kbtd-cover' }, kbTplCover(tpl)") >= 0, true)
eq('Import and Use open a chat through the same call as Create and Edit in chat, with the page\'s language read at the click', src.indexOf('kbStartChatText(kbTplChatText(tpl, kbt, kbTplPick, kbTplLangName(kbLangResolve())))') >= 0, true)
eq('the page has Yours and Discover, and Discover replaces the board and the list, not the header', src.indexOf("['yours', 'discover'].map(") >= 0 && src.indexOf("section === 'discover' ? h(KbDiscover, { onUse: useTemplate })") >= 0, true)
eq('the toolbar of the board belongs to Yours', src.indexOf("(list.length > 0 && section === 'yours'") >= 0, true)
eq('a card opens the page of its template with Enter and Space as well as a click', /key === 'Enter' \|\| e\.key === ' '\) \{ e\.preventDefault\(\); selPair\[1\]\(t\.id\) \}/.test(disc), true)
eq('Import does not also open the card behind it', disc.indexOf('e.stopPropagation(); props.onUse(t)') >= 0, true)

if (fails > 0) { console.log('\n' + fails + ' FAILED'); process.exit(1) }
console.log('\nALL PASS')
