#!/usr/bin/env node
// The icon pickers find what a person means, not only what an icon is called (UX audit 2026-10-20): kbIconSearch of client.js, cut out and
// run on the real icon data (icons.json, icon-tags.json). No browser.
//
//   node packages/kybernos-plugin/test-icon-search.mjs
//
// Pinned because « sport » found `sport-shoe` and nothing else: the picker compared the word with the icon's name only, while the library
// lists twenty icons tagged « sport » and a French speaker types « musculation » or « vélo ».
import { readFileSync } from 'node:fs'

let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) console.log('  ✓ ' + name)
  else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 400))) }
}
const here = (f) => new URL(f, import.meta.url)
const SRC = readFileSync(here('./client.js'), 'utf8')
const a = SRC.indexOf('// <kb-icon-search>')
const b = SRC.indexOf('// </kb-icon-search>', a)
if (a < 0 || b < a) { console.log('  ✗ cannot cut the icon search out of client.js'); process.exit(1) }
const { kbIconSearch } = new Function(SRC.slice(a, b) + '\nreturn { kbIconSearch }')()
const catalog = JSON.parse(readFileSync(here('./icons.json'), 'utf8'))
const file = JSON.parse(readFileSync(here('./icon-tags.json'), 'utf8'))
const LINES = JSON.parse(readFileSync(here('./icon-concepts.json'), 'utf8')).lines
const names = Object.keys(catalog).sort()
const tags = file.tags
const words = { tags: tags, concepts: LINES }   // what GET /kybernos/icon-tags answers

console.log('the data')
check('the search words cover almost every icon the pickers offer', Object.keys(tags).length >= 1900 && Object.keys(tags).length <= names.length, Object.keys(tags).length)
check('every icon that has words is an icon of the catalogue', Object.keys(tags).every((n) => catalog[n] !== undefined))
check('the words are lower-case, accent-free, and not the icon\'s own name', Object.entries(tags).every(([n, w]) => w === w.toLowerCase() && !/[^a-z0-9 ]/.test(w) && !w.split(' ').some((x) => n.split('-').includes(x))))
check('a renamed icon (alert-circle) carries the words of the icon that draws the same thing', typeof tags['alert-circle'] === 'string' && /warning/.test(tags['alert-circle']))

console.log('the search, with the words')
{
  const sport = kbIconSearch('sport', names, words)
  check('« sport » no longer finds one icon: the 15 this catalogue can draw (the site shows more: some are newer than icons.json)', sport.length >= 12, sport.length)
  check('...the one named for it comes first', sport[0] === 'sport-shoe', sport.slice(0, 3))
  for (const n of ['medal', 'bike', 'kayak', 'trophy', 'dumbbell']) check('...and « ' + n + ' » is among them', sport.includes(n))
  check('an icon that has nothing to do with it is not', !sport.includes('house') && !sport.includes('clock'))
  check('« musculation » finds the dumbbell first', kbIconSearch('musculation', names, words)[0] === 'dumbbell', kbIconSearch('musculation', names, words).slice(0, 4))
  check('« vélo » and « velo » find the bike first', kbIconSearch('vélo', names, words)[0] === 'bike' && kbIconSearch('velo', names, words)[0] === 'bike')
  const money = kbIconSearch('argent', names, words)
  check('« argent » finds banknote, coins and wallet', ['banknote', 'coins', 'wallet'].every((n) => money.includes(n)), money.slice(0, 8))
  check('two words must both be found: « sport shoe » is the shoe alone', JSON.stringify(kbIconSearch('sport shoe', names, words)) === JSON.stringify(['sport-shoe']), kbIconSearch('sport shoe', names, words))
  check('a plural finds its singular (« sports », « jeux »)', kbIconSearch('sports', names, words).includes('trophy') && kbIconSearch('jeux', names, words).includes('gamepad-2') || kbIconSearch('jeux', names, words).includes('gamepad'))
  check('a word typed in part finds its concept (« musc »)', kbIconSearch('musc', names, words).includes('dumbbell'))
  check('the exact name comes first (« bike »)', kbIconSearch('bike', names, words)[0] === 'bike')
  check('nothing matches a nonsense word', kbIconSearch('xyzzyx', names, words).length === 0)
  check('one letter finds names that start with it, not every icon with a tag containing it', kbIconSearch('a', names, words).every((n) => n.startsWith('a') || n.split('-').some((p) => p.startsWith('a'))) , kbIconSearch('a', names, words).length)
  check('an empty word finds nothing (the picker shows its short list then)', kbIconSearch('  ', names, words).length === 0)
}

console.log('the search, without the words (the route is not there yet: an older host)')
{
  const small = ['trophy', 'dumbbell', 'medal', 'house', 'clock', 'bike', 'sport-shoe']
  check('the name still works, ranked: the exact name first', kbIconSearch('clock', small, null)[0] === 'clock')
  check('and so does the start of a name', JSON.stringify(kbIconSearch('sport', small, null)) === JSON.stringify(['sport-shoe']))
  check('nothing breaks when the data is half there (tags without concepts, concepts without tags)', kbIconSearch('sport', small, { tags: {} }).length === 1 && kbIconSearch('sport', small, { concepts: LINES }).includes('dumbbell'))
}

console.log('the table of concepts')
{
  const wordsSet = new Set()
  for (const n of names) { for (const w of n.split('-')) wordsSet.add(w); for (const w of (tags[n] || '').split(' ')) if (w !== '') wordsSet.add(w) }
  const orphan = []
  const keys = []
  for (const line of LINES) {
    const cut = line.indexOf('|')
    keys.push(...line.slice(0, cut).split(' '))
    for (const t of line.slice(cut + 1).split(' ')) if (![...wordsSet].some((w) => w.startsWith(t)) && !names.some((n) => n.includes(t))) orphan.push(t)
  }
  check('every concept points at words that icons carry (no dead target)', orphan.length === 0, orphan)
  check('it holds a good number of concepts, in French and in English', LINES.length >= 150 && new Set(keys).size >= 350, new Set(keys).size)
  check('its keys are lower-case and accent-free (they meet a normalised query)', keys.every((k) => k === k.toLowerCase() && !/[^a-z0-9-]/.test(k)))
  check('the table is data, not code (the French policy gate reads the code)', !SRC.includes('KB_ICON_SYN_LINES') && !/'[a-z ]+\|[a-z -]+'/.test(SRC.slice(SRC.indexOf('// <kb-icon-search>'), SRC.indexOf('// </kb-icon-search>'))))
}

console.log('the picker')
{
  check('the picker searches with it, not with the name alone', SRC.includes('kbIconSearch(q2, all, o.words).slice(0, 300)') && !SRC.includes('all.filter((n) => n.indexOf(q2) >= 0)'))
  check('the words are fetched the first time the person types', SRC.includes("if (e.target.value.trim() !== '') kbLoadIconTags(); o.onQuery(e.target.value)"))
  check('all three pickers receive them', (SRC.match(/words: iconTags/g) || []).length === 3 && (SRC.match(/const iconTags = kbUseIconTags\(\)/g) || []).length === 3)
  const host = readFileSync(here('./index.js'), 'utf8')
  check('the host serves tags and concepts on GET /kybernos/icon-tags, and says so when they are absent', host.includes("path: '/kybernos/icon-tags'") && /ok: iconTags !== null, tags: iconTags === null \? \{\} : iconTags, concepts: iconConcepts/.test(host))
}
process.exit(fail === 0 ? 0 : 1)
