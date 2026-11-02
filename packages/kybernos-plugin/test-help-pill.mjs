// The help button of the core pages has ONE form, the round « ? » (its name is « How it works ») the Suite draws on the other pages (A5-19), and the
// Tools page says what it is for next to Workers (V-32). client.js is a browser bundle: it is read as text, as the neighbours do.
//   node packages/kybernos-plugin/test-help-pill.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

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
  check('the label is defined, French and English', /'kbui\.howitworks': \{ kybernos: 'Comment ça marche', en: 'How it works' \}/.test(src))
  const css = src.match(/\.kb6-helpbtn\{[^}]*\}/)
  check('its style is the pill’s: 30 px high, round ends, a border, the disc alone inside (padding 6 px both sides), no fixed 26 px disc', css !== null && /height:30px/.test(css[0]) && /border-radius:16px/.test(css[0]) && /padding:0 6px/.test(css[0]) && !/width:26px/.test(css[0]), css && css[0])
  check('the disc has its own style', /\.kb6-helpq\{[^}]*border-radius:50%/.test(src))
  check('Agent Teams and Automations still hang their panels on it', /h\(KbHelpButton, \{ open: helpOpen === true, dataKb: 'kybers-help'/.test(src) && /h\(KbHelpButton, \{ open: guide === true, dataKb: 'automation-help'/.test(src))
  check('no other bare « ? » help button is left in a title row (the pages share this one)', (src.match(/className: 'kb6-helpbtn'/g) || []).length === 1)
}

console.log('the Tools page says what it is for (in the card of its « ? »)')
{
  const lead = from('const leadTools = [', 1800)
  const head = from('const entete = () => h(\'header\', { className: \'kbt2-entete\' }', 1400)
  check('the card’s lead says what Tools adds and where the coding assistants are managed', /kbToolsTxt\(\{ fr: 'Les outils ajoutent des capacités à un profil DSH/.test(lead) && /en: 'Tools add abilities to a DSH profile/.test(lead), lead.slice(0, 300))
  check('it names Workers, in both languages', /Workers/.test(lead.slice(lead.indexOf('Les outils ajoutent'), lead.indexOf('Les outils ajoutent') + 700)) && /own page, Workers/.test(lead))
  check('the pill hands both sentences to the card, and the page no longer draws them under its title unless the help cannot be drawn', /kbPagePill\('tools', leadTools, kbt\('kbui\.tools'\)\)/.test(head) && /leadTools\.map\(\(x, i\) => kbSubFallback\('kbt2-sub', x, 'p', 'lead' \+ i\)\)/.test(head))
  check('the restart caveat is a warning, not a description: it stays on the page', /Nothing is hot-reloaded/.test(head))
}

console.log('the pages of this bundle hand their description to the card of their « ? »')
{
  check('the pill takes the description and the title, and the fallback only draws it when there is no Suite', /const kbPagePill = \(page, lead, title\) =>/.test(src) && /lead: lead, title: title/.test(src) && /const kbSubFallback = \(cls, text, tag, key\)/.test(src))
  check('Workspaces and Creations', /kbPagePill\('workspaces', kbt\('kbui\.project\.holds'\)/.test(src) && /kbPagePill\('creations', kbt\('deliverables\.desc'\)/.test(src))
  check('Settings › Automations, Voice', /kbPagePill\(props\.help, props\.sub, props\.title\)/.test(src) && /page: 'voice', lead: kbt\('kbui\.tts\.sub'\)/.test(src))
  check('Agent Teams: the description opens the panel of its « ? »; Automations: it opens the guide', /className: 'kb8-help-lead'[^\n]*kbt\('kbui\.kybers\.about'\)/.test(src) && /'kba-ob-sub kba-ob-lead'[^\n]*kbt\('tasks\.subtitle'\)/.test(src))
  check('none of them draws the description under its title any more', !/className: 'kba-subtitle'/.test(src) && !/h\('p', \{ className: 'kb8-sub' \}, kbt\('kbui\.kybers\.about'\)\)/.test(src))
}

console.log(failed === 0 ? '\nOK' : `\n${failed} failure(s)`)
process.exit(failed === 0 ? 0 : 1)
