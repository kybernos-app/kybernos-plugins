import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const html = readFileSync(join(root, 'index.html'), 'utf8')
const contract = JSON.parse(readFileSync(join(root, 'maquette.json'), 'utf8'))
const failures = []
const check = (name, value) => { if (!value) failures.push(name) }
check('interactive fidelity', contract.fidelite === 'interactive')
check('French document', html.includes('lang="fr"'))
check('no external resource', !/(?:src|href)=["']https?:/i.test(html))
check('DSH aliases', html.includes('--dsw-alias-bg-layer-2') && html.includes('--dsw-alias-label-primary'))
check('Kybernos brand geometry', html.includes('M0 0h13v36H0z') && html.includes('cx="6.5" cy="18"'))
for (const name of ['kbd-shell', 'kbd-rail', 'kbd-state', 'kbd-steps', 'kbd-primary', 'kbd-diagnostic']) check(`class ${name}`, html.includes(name))
for (const name of ['welcome', 'installing', 'ready', 'error']) check(`state ${name}`, html.includes(`${name}:`) || html.includes(`'${name}'`))
check('primary path', html.includes("render('ready')"))
check('dark theme', html.includes('data-theme="dark"'))
check('reduced motion', html.includes('prefers-reduced-motion'))
check('keyboard focus', html.includes(':focus-visible'))
check('no token display', html.includes('Jamais affichée ni enregistrée'))
if (failures.length) { console.error(`MOCKUP CONTRACT — ${failures.length} failure(s)\n${failures.join('\n')}`); process.exit(1) }
console.log('MOCKUP CONTRACT — 18 static assertions green; browser captures remain a separate live check')
