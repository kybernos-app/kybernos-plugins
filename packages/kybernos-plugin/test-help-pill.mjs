// The help button of the core pages has ONE form, the round « ? » (its name is « How it works ») the Suite draws on the other pages (A5-19), and the
// Tools page says what it is for next to Workers (V-32). client.js is a browser bundle: it is read as text, as the neighbours do.
//   node packages/kybernos-plugin/test-help-pill.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { entry } from './lib-i18n-test.mjs'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + String(detail).slice(0, 300)))
  if (!ok) failed += 1
}
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')
const from = (marker, n) => { const i = src.indexOf(marker); return i < 0 ? '' : src.slice(i, i + n) }

console.log('the help button of Agent Teams and Automations')
{
  const fn = from('const KbHelpButton = (props) => {', 900)
  check('it is a round « ? » (the pill without its words): the words are its accessible name, and no text sits beside the disc', /className: 'kb6-helpq'/.test(fn) && /'aria-label': kbt\('kbui\.howitworks'\)/.test(fn) && !/, kbt\('kbui\.howitworks'\)\)/.test(fn), fn)
  check('it keeps what the pages hang on it: the open state, the hook for tests, the title and the click', /'aria-expanded'/.test(fn) && /'data-kb': p\.dataKb/.test(fn) && /title: label/.test(fn) && /onClick/.test(fn))
  check('the label is defined, French and English', (e => e !== null && e.kybernos === 'Comment ça marche' && e.en === 'How it works')(entry('kbui.howitworks')))
  const css = src.match(/\.kb6-helpbtn\{[^}]*\}/)
  check('its style is the pill’s: 30 px high, round ends, a border, the disc alone inside (padding 6 px both sides), no fixed 26 px disc', css !== null && /height:30px/.test(css[0]) && /border-radius:16px/.test(css[0]) && /padding:0 6px/.test(css[0]) && !/width:26px/.test(css[0]), css && css[0])
  check('the disc has its own style', /\.kb6-helpq\{[^}]*border-radius:50%/.test(src))
  check('Agent Teams and Automations still hang their panels on it', /h\(KbHelpButton, \{ open: helpOpen === true, dataKb: 'kybers-help'/.test(src) && /h\(KbHelpButton, \{ open: guide === true, dataKb: 'automation-help'/.test(src))
  check('Automations draws no guide button where the home it would open is already on screen (a phone draws the Suite\'s « ? » there, see below), and opens the guide on the other tabs (UJ-15)', /list\.length === 0 && section === 'yours' \? \(kbOnPhone\(\) \? kbPagePill\('automations'[^\n]*\) : null\) : h\(KbHelpButton, \{ open: guide === true, dataKb: 'automation-help'/.test(src) && /guide === true && !\(list\.length === 0 && section === 'yours'\) \? kbaOnboard\(true\)/.test(src))
  check('no other bare « ? » help button is left in a title row (the pages share this one)', (src.match(/className: 'kb6-helpbtn'/g) || []).length === 1)
}

console.log('the Tools page says what it is for (in the card of its « ? »)')
{
  const lead = from('const leadTools = [', 1800)
  const head = from('const entete = () => h(\'header\', { className: \'kbt2-entete\' }', 1400)
  check('the card’s lead says what Tools adds and where the coding assistants are managed', /kbToolsTxt\(\{ fr: 'Les outils ajoutent des capacités à un profil Kybernos/.test(lead) && /en: 'Tools add abilities to a Kybernos profile/.test(lead), lead.slice(0, 300))
  check('it names Workers, in both languages, as the one place the coding assistants are managed', /Workers/.test(lead.slice(lead.indexOf('Les outils ajoutent'), lead.indexOf('Les outils ajoutent') + 700)) && /managed only in Workers/.test(lead) && /se gèrent uniquement dans Workers/.test(lead))
  check('the pill hands both sentences to the card, and the page no longer draws them under its title unless the help cannot be drawn', /pageHead\(\{ as: 'h1', className: 'kbt2-h1', id: 'kybernos-plugin', page: 'tools', lead: leadTools, title: kbt\('kbui\.tools'\) \}\)/.test(head) && /leadTools\.map\(\(x, i\) => kbSubFallback\('kbt2-sub', x, 'p', 'lead' \+ i\)\)/.test(head))
  check('how a change applies (no restart, a dry run first, a backup) is a note, not a description: it stays on the page', /Kybernos applies the change by itself a few seconds after it is written: no restart/.test(head) && !/Nothing is hot-reloaded/.test(head))
  check('the coding assistants (Codex, Claude Code, ZCode) are managed in Workers only: the page neither draws, counts nor lists their cards', /const entries = \(Array\.isArray\(data\.entries\) \? data\.entries : \[\]\)\.filter\(\(e\) => e\.worker !== true\)/.test(src) && !/kbt2Workers/.test(src) && !/squareTerminal|codeXml/.test(src) && !/codex: '|'claude-code': '|zcode: '/.test(from('const kbt2IconOf = ', 400)))
  check('the External tools group carries one line that opens Settings › Workers (cards, filtered cards and list)', /g\.id === 'ext' \? kbt2Assistants\(\) : null/.test(src) && /filtre === 'ext' \? kbt2Assistants\(\) : null/.test(src) && /filtre !== 'exp' \? kbt2Assistants\(\) : null/.test(src) && /'data-kb': 'tool-open-workers', onClick: \(\) => kbOpenSettingsPage\(\['kybernos-workers', 'workers'\]\)/.test(from('const kbt2Assistants = ', 800)))
  check('the Tools help copies say the same: no restart, and the assistants are managed only in Workers', ![readFileSync(new URL('./help.json', import.meta.url), 'utf8'), readFileSync(new URL('../kybernos-hub/catalog.json', import.meta.url), 'utf8')].some((t) => /nothing is hot-reloaded|own page, Workers/.test(t)))
}

console.log('the pages of this bundle hand their description to the card of their « ? »')
{
  check('the pill takes the description and the title, and the fallback only draws it when there is no Suite', /const kbPagePill = \(page, lead, title\) =>/.test(src) && /lead: lead, title: title/.test(src) && /const kbSubFallback = \(cls, text, tag, key\)/.test(src))
  check('Workspaces and Creations', /kbPagePill\('workspaces', kbt\('kbui\.project\.holds'\)/.test(src) && /kbPagePill\('creations', kbt\('deliverables\.desc'\)/.test(src))
  check('Settings › Automations, Voice', /pageHead\(\{ id: 'kybernos-plugin', page: props\.help, lead: props\.sub, title: props\.title \}\)/.test(src) && /page: 'voice', lead: kbt\('kbui\.tts\.sub'\)/.test(src))
  check('Agent Teams: the description opens the panel of its « ? »; Automations: it opens the guide', /className: 'kb8-help-lead'[^\n]*kbt\('kbui\.kybers\.about'\)/.test(src) && /'kba-ob-sub kba-ob-lead'[^\n]*kbt\('tasks\.subtitle'\)/.test(src))
  check('none of them draws the description under its title any more', !/className: 'kba-subtitle'/.test(src) && !/h\('p', \{ className: 'kb8-sub' \}, kbt\('kbui\.kybers\.about'\)\)/.test(src))
}

console.log('D4 (phone): the words that explain a page wait behind its « ? »')
{
  const help = JSON.parse(readFileSync(new URL('./help.json', import.meta.url), 'utf8'))
  const page = help.pages.automations
  check('help.json has the Automations page: title, description, three steps and where, in French and English', page !== undefined && ['title', 'what'].every((k) => typeof page[k].fr === 'string' && typeof page[k].en === 'string' && page[k].fr !== '' && page[k].en !== '') && page.steps.length === 3 && page.steps.every((st) => st.fr !== '' && st.en !== '') && page.where.page === true, page)
  check('...and its description is the page\'s own (the one the Suite pill is handed)', page.what.en === 'AI Agent Teams that start by themselves — on a schedule, on a date or when a webhook is called.' && (e => e !== null && e.kybernos !== '' && e.en === 'AI Agent Teams that start by themselves — on a schedule, on a date or when a webhook is called.')(entry('tasks.subtitle')))
  check('the phone test is the phone layer\'s own condition (the same media query as mobile.css), and no matchMedia is a desktop', /const kbOnPhone = \(\) => \{ try \{ return typeof window !== 'undefined' && typeof window\.matchMedia === 'function' && window\.matchMedia\('\(max-width: 700px\), \(max-height: 500px\) and \(pointer: coarse\)'\)\.matches === true \} catch \(e\) \{ return false \} \}/.test(src))
  check('the empty « Yours » home of Automations draws the pill after the title on a phone only', /kbOnPhone\(\) \? kbPagePill\('automations', kbt\('tasks\.subtitle'\), kbDomainTitle\('tasks', kbt\('tasks\.title'\)\)\) : null/.test(src))
  check('the plain-text paragraphs the phone hides carry a hook (the Agent Teams line, the Creations hint, the Automations line and note)', (src.match(/'data-kb': 'kybers-sub'/g) || []).length === 2 && (src.match(/'data-kb': 'type-hint-text'/g) || []).length === 2 && /'kba-ob-sub', 'data-kb': 'automation-onboard-sub'/.test(src) && /'kba-ob-ctanote', 'data-kb': 'automation-onboard-note'/.test(src))
  check('the Agent Teams panel carries the line that sits under the title, `hidden` until the phone layer shows it', /h\('p', \{ className: 'kb8-help-lead', hidden: true, 'data-kb': 'kybers-help-sub' \}, kbt\('kbui\.teams\.sub'\)\)/.test(src))
  check('the Creations card already says the types combine (the hidden hint says nothing the card does not)', /ils se combinent/.test(JSON.stringify(help.pages.creations.steps[0].fr)) && /combine/.test(help.pages.creations.steps[0].en))
}

console.log(failed === 0 ? '\nOK' : `\n${failed} failure(s)`)
process.exit(failed === 0 ? 0 : 1)
