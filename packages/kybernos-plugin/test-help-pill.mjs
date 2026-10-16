// The help button of the core pages has ONE form, the « ? How it works » pill the Suite draws on the other pages (A5-19), and the
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
  check('it is a pill: a « ? » disc and the words, not a bare « ? »', /className: 'kb6-helpq'/.test(fn) && /kbt\('kbui\.howitworks'\)/.test(fn), fn)
  check('it keeps what the pages hang on it: the open state, the hook for tests, the title and the click', /'aria-expanded'/.test(fn) && /'data-kb': p\.dataKb/.test(fn) && /title: label/.test(fn) && /onClick/.test(fn))
  check('the label is defined, French and English', /'kbui\.howitworks': \{ kybernos: 'Comment ça marche', en: 'How it works' \}/.test(src))
  const css = src.match(/\.kb6-helpbtn\{[^}]*\}/)
  check('its style is the pill’s: 30 px high, round ends, a border, no fixed 26 px disc', css !== null && /height:30px/.test(css[0]) && /border-radius:16px/.test(css[0]) && !/width:26px/.test(css[0]), css && css[0])
  check('the disc has its own style', /\.kb6-helpq\{[^}]*border-radius:50%/.test(src))
  check('Agent Teams and Automations still hang their panels on it', /h\(KbHelpButton, \{ open: helpOpen === true, dataKb: 'kybers-help'/.test(src) && /h\(KbHelpButton, \{ open: guide === true, dataKb: 'automation-help'/.test(src))
  check('no other bare « ? » help button is left in a title row (the pages share this one)', (src.match(/className: 'kb6-helpbtn'/g) || []).length === 1)
}

console.log('the Tools page says what it is for')
{
  const head = from('const entete = () => h(\'header\', { className: \'kbt2-entete\' }', 2600)
  check('a line next to the existing ones says what Tools adds and where the coding assistants are managed', /kbt2-sub/.test(head) && /kbToolsTxt\(\{ fr: 'Les outils ajoutent des capacités à un profil DSH/.test(head) && /en: 'Tools add abilities to a DSH profile/.test(head), head.slice(0, 300))
  check('it names Workers, in both languages', /Workers/.test(head.slice(head.indexOf('Les outils ajoutent'), head.indexOf('Les outils ajoutent') + 700)) && /have their own page, Workers|own page, Workers/.test(head))
}

console.log(failed === 0 ? '\nOK' : `\n${failed} failure(s)`)
process.exit(failed === 0 ? 0 : 1)
