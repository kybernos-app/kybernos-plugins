// Kaby's row in the sidebar shows the name and the portrait the person gave it (kybernos-kaby-customisation), and falls back to the product's own
// icon and name when that bundle is not there. The reader is run on its own; the row and the event are pinned on the source.
//   node packages/kybernos-plugin/test-kaby-row.mjs
import { readFileSync } from 'node:fs'

let fail = 0
const ok = (name, cond) => { if (cond !== true) { fail += 1; console.log('FAIL  ' + name) } else console.log('ok    ' + name) }

const src = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
const start = src.indexOf('const kbKabyMe = () => {')
const end = src.indexOf('const kbMenuIcon = (rowKey', start)
ok('the reader exists, once, before the icon helper', start > 0 && end > start && src.indexOf('const kbKabyMe = () => {', start + 1) < 0)
const readerWith = (win) => new Function('window', src.slice(start, end) + '\nreturn kbKabyMe')(win)

console.log('── the reader ──')
ok('no bundle: null', readerWith({})() === null)
ok('a profile with a name is returned as it is', readerWith({ __KB_KABY__: { profile: () => ({ name: 'Léa', portrait: null }) } })().name === 'Léa')
ok('a profile not read yet (null) is no profile', readerWith({ __KB_KABY__: { profile: () => null } })() === null)
ok('a profile with no name, or a name that is not text, is no profile', readerWith({ __KB_KABY__: { profile: () => ({ name: '' }) } })() === null && readerWith({ __KB_KABY__: { profile: () => ({ name: 5 }) } })() === null)
ok('a seam that throws, or has no reader, is no profile (the menu never breaks)', readerWith({ __KB_KABY__: { profile: () => { throw new Error('x') } } })() === null && readerWith({ __KB_KABY__: {} })() === null)

console.log('── the row ──')
const builder = src.slice(src.indexOf('const row = (id, ico, badge, active, onClick, extra) => {'), src.indexOf('const ncCloud = useNcCloud()'))
const call = src.slice(src.indexOf("kyber: () => rowOf('kyber', "), src.indexOf("dashboards: () => rowOf('dashboards'"))
const naming = src.slice(src.indexOf('const kbMenuDefaultName = (id) => {'), src.indexOf('const kbMenuEntries = '))
ok('only the Kaby row is the person\'s own, and only when the bundle is there', /const kabyOwn = id === 'kyber' && kabyMe !== null/.test(builder))
// The name a row has when the person has not renamed it in the Theme page's menu arrangement (kbMenuLabelOf comes first): Kaby's own, the field's word, the dictionary's.
ok('its label is the chosen name, over the domain\'s word and the product\'s own', /const own = id === 'kyber' \? kbKabyMe\(\) : null/.test(naming) && naming.indexOf('return own.name') > 0 && naming.indexOf('return own.name') < naming.indexOf('kbDomainLabel(id)') && naming.indexOf('kbDomainLabel(id)') < naming.indexOf('kbt(d.nameKey)') && /const label = mine !== null \? mine : kbMenuDefaultName\(id\)/.test(builder))
ok('its icon is the portrait the host serves, round, when there is one, and the usual icon otherwise', /kabyOwn && kabyMe\.portrait !== null \? h\('img', \{ className: 'kb4-kabyav', src: kabyMe\.portrait\.url, alt: '', 'data-kb': 'kb-kaby-row-portrait' \}\) : kbMenuIcon\(id, ico, active === true\)/.test(builder))
ok('the call site keeps the product\'s icon and word as the fallback (they come from the one table of the fixed rows)', /rowOf\('kyber', null, shown === 'kyber'/.test(call) && /id: 'kyber', icon: 'kyber', classic: 'bot', nameKey: 'kbui\.kyber'/.test(src))
ok('a click still opens Kaby\'s chat, as before (the portrait is not a second button inside a button)', /window\.__KB_KYBER__\.openChat\(\)/.test(call) && !/<button/.test(builder))
ok('the menu re-renders when the bundle says the profile changed, and stops listening when it goes', /addEventListener\('kb-kaby-profile', onKaby\)/.test(src) && /removeEventListener\('kb-kaby-profile', onKaby\)/.test(src))
ok('the profile is read at each render, before the rows are built', /const kabyMe = kbKabyMe\(\)/.test(src) && src.indexOf('const kabyMe = kbKabyMe()') < src.indexOf('const row = (id, ico, badge, active, onClick, extra) => {'))
ok('the image is round and the size of the icon it replaces', /\.kb4-kabyav\{width:1\.25em;height:1\.25em;border-radius:50%/.test(src))

process.exit(fail > 0 ? 1 : 0)
