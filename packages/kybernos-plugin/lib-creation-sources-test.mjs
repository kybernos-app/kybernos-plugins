// Test helper (not a test): the « creation sources » block of client.js, evaluated on its own with the few names it reads stood in, so that the tests of the
// plugin, of Dashboards and of Apps all check the real rules of the registry and not a copy.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const FAMILIES = ['slides', 'websites', 'documents', 'spreadsheets', 'images', 'av']
const TYPES = ['miniapp', 'html', 'js', 'quiz', 'doc', 'deck', 'cards', 'resume', 'fiche', 'engine', 'data', 'image', 'other']
const DRAWINGS = ['slides', 'doc', 'sheet', 'dashboard', 'image', 'video', 'website', 'miniapp', 'app', 'file']

/** `{ check, items, word, registry, Item, win, warnings }`: a fresh registry each call, on its own fake window. */
export const loadCreationSources = () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')
  const a = src.indexOf('// <kb-creation-sources>')
  const b = src.indexOf('// </kb-creation-sources>')
  if (a < 0 || b < a) throw new Error('the creation sources block is missing from client.js')
  const win = { dispatched: 0, dispatchEvent () { this.dispatched += 1; return true } }
  const warnings = []
  const h = (tag, props, ...kids) => ({ tag, props: props || {}, kids: kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false) })
  const body = src.slice(a, b) + '\nreturn { kbSrcCheck, kbSrcItems, kbSrcWord, kbCreationSources, KbSrcItem }'
  const make = new Function('window', 'CustomEvent', 'console', 'KB_ART_FAMILIES', 'KB_ART_TYPES', 'KB_NC_ART', 'h', 'kbDomainLang', 'fmtAge', 'kbArtDraw', body)
  const out = make(win, class { constructor (t) { this.type = t } }, { warn: (m) => warnings.push(String(m)) },
    FAMILIES.map((id) => ({ id })), TYPES.map((id) => ({ id })), Object.fromEntries(DRAWINGS.map((k) => [k, '<g/>'])),
    h, () => 'en', () => '2 min ago', (id) => h('svg', { 'data-art': id }))
  return { check: (e) => out.kbCreationSources.check(e), items: out.kbSrcItems, word: out.kbSrcWord, registry: out.kbCreationSources, Item: out.KbSrcItem, win, warnings, h }
}
