// Signed out, the sidebar footer has no account menu to carry the "Update available" line, and the card at launch comes once per version
// and session (then "Later" hides it for a day). The reminder that must not go away lives in the footer itself, in both signed-out
// layouts, and opens the same dialog as the menu line of a signed-in user.
//   node packages/kybernos-cloud/test-footer-update.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')
let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + detail))
  if (!ok) failed += 1
}
const bloc = (from, to) => { const a = source.indexOf(from); const b = source.indexOf(to, a + 1); return a < 0 || b < 0 ? '' : source.slice(a, b) }

console.log('the footer keeps the reminder')
const pied = bloc('const [majInfo, setMajInfo] = React.useState', "ctx.effect(() => styles.insert(CLOUD_CSS), 'kybernos-cloud: styles')")
check('the footer reads the whole signal (which version), not only that something is available', /const \[majInfo, setMajInfo\] = React\.useState\(\(\) => lireMaj\(\)\)/.test(pied) && /const majDispo = majInfo !== null/.test(pied))
check('it follows the kybernos:update event of the maintenance bundle', /addEventListener\('kybernos:update', sur\)/.test(pied) && /removeEventListener\('kybernos:update', sur\)/.test(pied))
check('the line is absent when there is no update', /const ligneMaj = majInfo === null \? null : h\('button'/.test(pied))
check('it opens the same dialog as the menu line (kybernos:menu:update)', /ouvrirMaj = \(\) => \{ try \{ window\.dispatchEvent\(new Event\('kybernos:menu:update'\)\)/.test(pied) && /onClick: ouvrirMaj/.test(pied))
check('the signed-out layout carries it', /const hint = phase === 'loading'[\s\S]*?corps = h\('div', \{ className: 'kbf-off' \},\s*ligneMaj,/.test(pied))
check('the pairing layout carries it too', /phase === 'pairing'[\s\S]*?corps = h\('div', \{ className: 'kbf-off' \},\s*ligneMaj,/.test(pied))
check('it says "Update available" and the version, with the engine named when it is the engine', /t\('menuUpdate'\)/.test(pied) && /majInfo\.kind === 'moteur' \? 'DSH ' : ''/.test(pied))
check('the signed-in menu line and the tile dot are still there', /entree\('update', h\(UpdateIcon/.test(source) && /'data-update': majDispo === true \? 'true' : undefined/.test(source))
const both = (k) => new RegExp("menuUpdate: '[^']+'").test(source) && source.split("menuUpdate: '").length === 3
check('the words exist in French and in English', both())

console.log('the look')
const css = source.split('\n').filter((l) => l.startsWith('.kbf-maj') || /^\[class\*="collapsed"\] \.kbf-maj/.test(l))
check('the styles exist, with a collapsed-rail variant', css.length >= 6 && css.some((l) => /collapsed/.test(l)), String(css.length))
check('no colour but the amber the update dot already uses (#f5a524), and design tokens for the rest', css.every((l) => (l.match(/#[0-9a-fA-F]{3,8}\b/g) || []).every((c) => c.toLowerCase() === '#f5a524')) && !css.some((l) => /rgba?\(/.test(l)))

console.log(failed === 0 ? '\nOK' : `\n${failed} failure(s)`)
process.exit(failed === 0 ? 0 : 1)
