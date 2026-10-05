// Suite panel as a store, lot 1: the catalogue says what the page draws (title, glyph, family colour, featured sheets), and the
// pure helpers (title, compatibility verdict, Featured/family filters). Played without DSH, React or a browser; the rendered page is
// checked on the real GUI.
//   node packages/kybernos-hub/test-suite-store.mjs
import { readFileSync } from 'node:fs'

const catalogue = JSON.parse(readFileSync(new URL('./catalog.json', import.meta.url), 'utf8'))
const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
let echecs = 0
let total = 0
const ok = (nom, cond, detail) => { total++; if (cond) console.log('  ✓ ' + nom); else { echecs++; console.log('  ✗ ' + nom + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 200) : '')) } }

let def
new Function('window', source)({ __ModuleLoader__: { load: (d) => { def = d } } })
const T = def.factory().__test
const bil = (o) => o !== null && typeof o === 'object' && typeof o.fr === 'string' && o.fr.length > 8 && typeof o.en === 'string' && o.en.length > 8

console.log('the catalogue says what the page draws')
ok('every module has a human title and a glyph the client knows', catalogue.modules.every((m) => typeof m.titre === 'string' && m.titre.length > 1 && typeof m.glyphe === 'string' && Object.prototype.hasOwnProperty.call(T.GLYPHES, m.glyphe)), catalogue.modules.filter((m) => !(m.titre && T.GLYPHES[m.glyphe])).map((m) => m.id))
ok('titles are unique, so two cards are never confused', new Set(catalogue.modules.map((m) => m.titre)).size === catalogue.modules.length)
ok('every family has a colour (the tile and the chip) and no unused fields', catalogue.familles.every((f) => /^#[0-9a-f]{6}$/i.test(f.couleur) && f.icone === undefined && f.ligne === undefined), catalogue.familles)
const vedettes = catalogue.modules.filter((m) => m.vedette !== undefined)
ok('six featured modules, ranked 1 to 6 with no gap or duplicate', vedettes.length === 6 && vedettes.map((m) => m.vedette).sort().join() === '1,2,3,4,5,6', vedettes.map((m) => [m.id, m.vedette]))
ok('a featured sheet has a tagline, a description and points, in French and English', vedettes.every((m) => bil(m.accroche) && bil(m.description) && Array.isArray(m.points) && m.points.length >= 3 && m.points.every(bil)))
ok('a module that is not featured carries none of it', catalogue.modules.filter((m) => m.vedette === undefined).every((m) => m.accroche === undefined && m.description === undefined && m.points === undefined))
ok('Databases is in its own family and featured', catalogue.modules.find((m) => m.id === 'dsh-db-viewer').famille === 'data' && catalogue.modules.find((m) => m.id === 'dsh-db-viewer').vedette > 0)
ok('the Databases sheet says SQLite and read-only — never Postgres, which the module does not read', /SQLite/.test(catalogue.modules.find((m) => m.id === 'dsh-db-viewer').description.en) && !/postgres/i.test(JSON.stringify(catalogue.modules.find((m) => m.id === 'dsh-db-viewer'))))

console.log('the pure helpers')
const mods = catalogue.modules
const installes = new Map(mods.slice(0, 20).map((m) => [m.nom, { name: m.nom, version: m.version, enabled: true }]))
ok('titreDe: the human name, the id when there is none', T.titreDe({ id: 'x', titre: 'Fancy' }) === 'Fancy' && T.titreDe({ id: 'x' }) === 'x' && T.titreDe({ id: 'x', titre: '' }) === 'x')
ok('verdictCompat: inside the range, outside it, unknown', T.verdictCompat({ min: 'a', max: 'b', horsZone: false }) === 'ok' && T.verdictCompat({ horsZone: true }) === 'hors' && T.verdictCompat(null) === 'inconnu' && T.verdictCompat(undefined) === 'inconnu')
const feat = T.filtrer({ modules: mods.slice().reverse(), filtre: 'featured', requete: '', installes })
ok('Featured lists the featured modules in the catalogue’s rank, whatever order they come in', feat.map((m) => m.id).join() === 'kybernos-models,kybernos-auto,kybernos-memory,dsh-db-viewer,kybernos-slides,kybernos-modeleur', feat.map((m) => m.id))
ok('every other filter still keeps the order it is given', T.filtrer({ modules: mods.slice().reverse(), filtre: 'all', requete: '', installes }).map((m) => m.id).join() === mods.slice().reverse().map((m) => m.id).join())
ok('the family filter keeps one family', T.filtrer({ modules: mods, filtre: 'all', requete: '', installes, famille: 'data' }).map((m) => m.id).join() === 'dsh-db-viewer' && T.filtrer({ modules: mods, filtre: 'all', requete: '', installes, famille: '' }).length === mods.length && T.filtrer({ modules: mods, filtre: 'all', requete: '', installes }).length === mods.length)
ok('a family and Featured combine; a family with no featured module is empty', T.filtrer({ modules: mods, filtre: 'featured', requete: '', installes, famille: 'models' }).map((m) => m.id).join() === 'kybernos-models,kybernos-auto' && T.filtrer({ modules: mods, filtre: 'featured', requete: '', installes, famille: 'cloud' }).map((m) => m.id).join() === 'kybernos-memory' && T.filtrer({ modules: mods, filtre: 'featured', requete: '', installes, famille: 'base' }).length === 0)
ok('search finds a module by its human title, not only by its id', T.filtrer({ modules: mods, filtre: 'all', requete: 'Auto routing', installes }).map((m) => m.id).join() === 'kybernos-auto' && T.filtrer({ modules: mods, filtre: 'all', requete: '3d modeller', installes }).map((m) => m.id).join() === 'kybernos-modeleur')
ok('Installed and Available still split the catalogue', T.filtrer({ modules: mods, filtre: 'installed', requete: '', installes }).length === 20 && T.filtrer({ modules: mods, filtre: 'available', requete: '', installes }).length === mods.length - 20)

console.log('wiring')
const has = (f) => source.includes(f)
ok('Featured is the first tab and the default', has("React.useState('featured')") && has("segment('featured', kt('À la une', 'Featured'), nbVedettes), segment('all'"))
ok('one flat grid, no family heading any more: the chips filter', !has('kbsu-fam h5') && !has('const familles =') && has("'data-kb': 'suite-grid'") && has("'kbsu-fams'"))
ok('every card and row opens the module’s page on a click, Enter or Space; a control inside it does not', has('onClick: ouvrirFiche(m.id), onKeyDown: clavierFiche(m.id)') && (source.match(/onClick: ouvrirFiche\(m\.id\)/g) || []).length === 2 && has("closest('button,a,input,select,textarea,[role=\"switch\"],.kbsu-cfg')"))
ok('the module’s page: back link, header with its actions, Description and Compatibility tabs, a details column', has("'data-kb': 'suite-retour'") && has("onglet('description'") && has("onglet('compat'") && has("'data-kb': 'suite-fiche'") && has('kbsu-side'))
ok('the page shows nothing the catalogue does not say: no screenshots, no banner, no changelog tab', !/screenshot|capture d.écran|changelog|journal des changements/i.test(source.slice(source.indexOf('const fiche = '), source.indexOf('// ── Reordering'))))
ok('the artwork is the glyph on a family-coloured tile, in cards and rows', has('const artwork = ') && (source.match(/artwork\(m, p\.fam/g) || []).length === 3 && !has('ic(p.fam.icone)'))
ok('compatibility only speaks up on a card when something is wrong', has("chipCompat(false)") && has("verdict === 'hors'"))
ok('the family icons nothing draws any more are gone', !/\n      (cpu|users|layout|cloud|database): '/.test(source.slice(source.indexOf('const ICONES = {'), source.indexOf('const construirePanneau'))))
ok('no hard-coded colour in the new styles except the DSH orange the page already uses', !/kbsu-(fb|chip|hero|panel|ticks|dl|side|vedette)[^']*#[0-9a-fA-F]{3,8}\b/.test(source))

console.log('\n' + (total - echecs) + '/' + total + ' passed')
process.exit(echecs === 0 ? 0 : 1)
