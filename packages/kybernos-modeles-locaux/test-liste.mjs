#!/usr/bin/env node
// The list of local models as a person reads it (V-21, V-37, V-38): the order (what fits first, the too-heavy last), the pages, the
// search, the score read from a catalogue line and the steps of its filter, and the install details one click away. The helpers are
// cut out of the client as they are written; the rest of the page is checked on a real GUI (scripts/check-ollama-search-live.mjs).
//
//   node packages/kybernos-modeles-locaux/test-liste.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(fileURLToPath(new URL('./client.js', import.meta.url)), 'utf8')
let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 200))) } }

const a = src.indexOf('// KB-KML-PURE-BEGIN')
const b = src.indexOf('// KB-KML-PURE-END')
check('the pure block is delimited', a > 0 && b > a)
const { KML_PAGE, kbScoreDe, kbOrdreAjuste, kbPagine, kbChercher, kbPaliers } = new Function(src.slice(a, b) + '\nreturn { KML_PAGE, kbScoreDe, kbOrdreAjuste, kbPagine, kbChercher, kbPaliers }')()

console.log('\n── the score of a catalogue line ──')
check('« II 32 · MMMU-Pro 69 % · 6.6–7.6 GB » reads 32', kbScoreDe('II 32 · MMMU-Pro 69 % · 6.6–7.6 GB') === 32 && kbScoreDe('II 16') === 16 && kbScoreDe('II 27.5') === 27.5 && kbScoreDe('II 27,5') === 27.5)
check('a line that quotes none reads none (no number is made up)', kbScoreDe('Ollama library · 6.6–9.5 GB · 128K ctx') === null && kbScoreDe('MoE 30B-A3B · code') === null && kbScoreDe('') === null && kbScoreDe(null) === null && kbScoreDe(undefined) === null)
check('« III », « WIKI 32 » or « II » with no number are not a score', kbScoreDe('III 32') === null && kbScoreDe('WIKI 32') === null && kbScoreDe('II') === null && kbScoreDe('II ·') === null)

console.log('\n── the order: what fits first, the too-heavy last (V-21) ──')
const mods = [
  { id: 'big-70b', etat: 'lourd' }, { id: 'a-9b', etat: 'compatible' }, { id: 'tight-14b', etat: 'juste' }, { id: 'b-4b', etat: 'compatible' },
  { id: 'who-knows', etat: 'inconnu' }, { id: 'c-2b', etat: 'compatible' }, { id: 'huge-120b', etat: 'lourd' },
]
const etat = (x) => x.etat
const ordre = kbOrdreAjuste(mods, etat).map((x) => x.id)
check('compatible first (kept in the catalogue\'s own order), then tight, then unknown, then too heavy', ordre.join() === 'a-9b,b-4b,c-2b,tight-14b,who-knows,big-70b,huge-120b', ordre)
check('the order is stable and the input is not changed', kbOrdreAjuste(mods, etat).map((x) => x.id).join() === ordre.join() && mods[0].id === 'big-70b')
check('an unknown state counts as « unknown » (never dropped)', kbOrdreAjuste([{ id: 'x', etat: 'mystery' }, { id: 'y', etat: 'compatible' }], etat).map((x) => x.id).join() === 'y,x' && kbOrdreAjuste([], etat).length === 0)

console.log('\n── the pages ──')
const many = Array.from({ length: 21 }, (x, i) => ({ id: 'm' + i }))
const p1 = kbPagine(many, 1, KML_PAGE)
check('eight to a page, and the page says where it is', KML_PAGE === 8 && p1.tranche.length === 8 && p1.debut === 0 && p1.fin === 8 && p1.pages === 3 && p1.total === 21)
check('the last page holds the rest', kbPagine(many, 3, KML_PAGE).tranche.map((x) => x.id).join() === 'm16,m17,m18,m19,m20' && kbPagine(many, 3, KML_PAGE).fin === 21)
check('a page out of range, or junk, is held inside the list (never an empty page)', kbPagine(many, 99, KML_PAGE).page === 3 && kbPagine(many, 0, KML_PAGE).page === 1 && kbPagine(many, -4, KML_PAGE).page === 1 && kbPagine(many, 'x', KML_PAGE).page === 1 && kbPagine([], 5, KML_PAGE).page === 1 && kbPagine([], 5, KML_PAGE).tranche.length === 0)

console.log('\n── the search ──')
const cat = [
  { id: 'qwen3.5:9b', famille: 'q', badges: ['Vision', 'Tools', 'Thinking'], score: 'II 32' },
  { id: 'gemma4:e4b', famille: 'g', badges: ['Vision', 'Audio'], score: '' },
  { id: 'qwen3-coder:30b', famille: 'q', badges: ['Code', 'Tools'], score: '' },
]
const texte = (mod) => (mod.id === 'gemma4:e4b' ? 'Alternative on-device si le 9B s’avère lent' : 'Le meilleur sous 10B')
check('an empty search keeps everything', kbChercher(cat, '', texte).length === 3 && kbChercher(cat, '   ', texte).length === 3)
check('it finds by id, by badge and by the description', kbChercher(cat, 'qwen', texte).length === 2 && kbChercher(cat, 'audio', texte).map((x) => x.id).join() === 'gemma4:e4b' && kbChercher(cat, 'on-device', texte).map((x) => x.id).join() === 'gemma4:e4b')
check('every word must be found: « qwen code » is the coder only', kbChercher(cat, 'qwen code', texte).map((x) => x.id).join() === 'qwen3-coder:30b')
check('case and accents are ignored (« AVÈRE » finds « s’avère »)', kbChercher(cat, 'AVÈRE', texte).map((x) => x.id).join() === 'gemma4:e4b')
check('nothing found is an empty list, not an error', kbChercher(cat, 'zzz', texte).length === 0)

console.log('\n── the steps of the score filter ──')
check('steps only up to the best score of the list', JSON.stringify(kbPaliers([{ score: 'II 32' }, { score: 'II 16' }, { score: 'x' }])) === JSON.stringify([10, 20, 30]))
check('no line with a score: no filter at all', kbPaliers([{ score: 'Ollama library' }, { score: '' }]).length === 0 && kbPaliers([]).length === 0)

console.log('\n── what the page does with them ──')
const has = (frag) => src.includes(frag)
check('the page orders by fit, pages the ones that fit, and folds the too-heavy ones (still reachable, one click)', has('const ordonnes = kbOrdreAjuste(trouves, etatListe)') && has("const lourds = ordonnes.filter((mod) => etatListe(mod) === 'lourd')") && has('const pageDe = kbPagine(visibles, page, KML_PAGE)') && has("'data-kml': 'lourds-toggle'") && has("m('kml.lourd.n', { n: lourds.length })"))
check('with the machine not measured yet nothing counts as too heavy (the list would fold while it is being read)', has("const etatListe = (mod) => (ramGo === null ? 'inconnu' : etatDe(mod))"))
check('the search and the score steps sit in a bar that stays at the top of the list, and changing them goes back to page 1', has("className: 'kml-barre', 'data-kml': 'barre'") && has('position: sticky; top: 0') && has("'data-kml': 'recherche'") && has('setRecherche(e.target.value); setPage(1)') && has('setScoreMin(n); setPage(1)'))
check('the score shows on the card as « II 32 » with its source in the tooltip', has("'data-kml': 'score'") && has("'II ' + String(kbScoreDe(mod.score))") && has("m('kml.score.badge', { n: kbScoreDe(mod.score) })"))
check('the pager reads « 1–8 of 21 models » with previous / next, only when there is more than a page', has("m('kml.page.info', { a: pageDe.debut + 1, b: pageDe.fin, n: pageDe.total })") && has('visibles.length > KML_PAGE') && has("'data-kml': 'page-prev'") && has("'data-kml': 'page-next'"))
check('V-38: the install shows a bar and a percent; the command, the bytes and the last line open under a small chevron', has("'data-kml': 'detail-toggle'") && has("'aria-expanded': String(detailOuvert)") && has("'data-kml': 'detail'") && has("job.pct === null ? m('kml.en.cours') : job.pct + ' %'),") && has("m('kml.detail.cmd')") && has("m('kml.detail.recu')") && has("m('kml.detail.ligne')"))
const ids = [...src.matchAll(/'(kml\.(?:search|score\.[a-z]+|page\.[a-z]+|lourd\.n|aucun|detail\.[a-z]+))': \{ fr: '((?:[^'\\]|\\.)*)', en: '((?:[^'\\]|\\.)*)' \}/g)]
check('every new sentence exists in French and English, with the same {variables}', ids.length >= 15 && ids.every((k) => k[2].length > 0 && k[3].length > 0 && (k[2].match(/\{[a-z]+\}/g) || []).sort().join() === (k[3].match(/\{[a-z]+\}/g) || []).sort().join()), ids.length)
const used = [...src.matchAll(/m\('(kml\.(?:search|score\.[a-z]+|page\.[a-z]+|lourd\.n|aucun|detail\.[a-z]+))'/g)].map((x) => x[1])
check('every one of them that the code asks for is declared', used.every((k) => ids.some((x) => x[1] === k)), used.filter((k) => !ids.some((x) => x[1] === k)))

console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)
