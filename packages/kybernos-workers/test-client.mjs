// Workers — the client's pure parts and its guards, outside a browser.
//   node packages/kybernos-workers/test-client.mjs
//
// client.js is a file in the DSH module-loader format. It is given a fake loader and a fake `react`, then its
// pure helpers are reached through `__test`: which status a row shows, which dots are lit, the sentences, the
// language rule. Static checks guard what a browser test would only find late: every French text has an English
// one, every worker has a logo, and the page makes no request other than to its own host.
import { readFileSync } from 'node:fs'
import { WORKERS } from './workers-host.mjs'

let failures = 0
let total = 0
const ok = (name, cond, detail) => { total++; if (cond) console.log('  ✓ ' + name); else { failures++; console.log('  ✗ ' + name + (detail !== undefined ? ' — ' + detail : '')) } }

const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
let definition = null
let resolved = 'kybernos'
globalThis.window = { __ModuleLoader__: { load: (def) => { definition = def } }, __KB_LANG_RESOLVE__: () => resolved }
await import(new URL('./client.js', import.meta.url).href)
ok('the client loads in the module-loader format', definition !== null && definition.id === '@local/kybernos-workers')
const plugin = definition.factory((name) => { if (name === 'react') return { createElement: () => null }; throw new Error('unexpected require ' + name) })
const T = plugin.__test
ok('it exposes its pure parts', typeof T.statusOf === 'function' && typeof T.stepsOf === 'function' && typeof T.kt === 'function')

console.log('── language ──')
{
  const fr = (l) => { resolved = l; return T.kt('un', 'one') === 'un' }
  ok('French only for the Kybernos default or a French base', fr('kybernos') && fr('fr') && fr('fr-CA') && fr('fr_FR'))
  ok('every other language, translated or not, gets English — never French', !fr('es') && !fr('de-DE') && !fr('en') && !fr('zh-Hans'))
  globalThis.window.__KB_LANG_RESOLVE__ = () => { throw new Error('resolver not ready') }
  ok('a language resolver that throws falls back on French (the product default)', T.kt('un', 'one') === 'un')
  globalThis.window.__KB_LANG_RESOLVE__ = () => resolved
  resolved = 'kybernos'
}

console.log('── the status of a row ──')
{
  const w = (over) => Object.assign({ id: 'x', nom: 'X', genre: 'connexion', connexion: true, dernier: null, connect: { mode: 'cli' } }, over)
  const dernier = (statut, controles = []) => ({ quand: '2026-10-08T01:00:00Z', statut, controles })
  ok('not mounted → "not turned on", whatever the last check said', T.statusOf(w({ connexion: false }), undefined) === 'inactive' && T.statusOf(w({ connexion: false, dernier: dernier('pret') }), undefined) === 'inactive')
  ok('mounted, never checked → "to check", NOT ready', T.statusOf(w(), undefined) === 'unknown')
  ok('a check running wins over the last answer', T.statusOf(w({ dernier: dernier('pret') }), 'check') === 'checking')
  ok('an activation or an apply running does not hide the status', T.statusOf(w({ dernier: dernier('pret') }), 'activate') === 'pret' && T.statusOf(w({ dernier: dernier('pret') }), 'apply') === 'pret')
  ok('the host’s "connection missing" is the same thing as not mounted', T.statusOf(w({ dernier: dernier('a-connecter') }), undefined) === 'inactive')
  for (const statut of ['pret', 'incomplet', 'a-relancer', 'binaire-absent', 'non-connecte', 'ecriture-impossible', 'serveur-absent']) {
    const s = T.statusOf(w({ dernier: dernier(statut) }), undefined)
    ok('host status "' + statut + '" has a row status with a dot, a French and an English word', Array.isArray(T.STATUS[s]) && T.STATUS[s].length === 3 && T.STATUS[s][1] !== T.STATUS[s][2], s)
  }
  ok('only "ready" is green, only the two real problems are red', Object.entries(T.STATUS).filter(([, v]) => v[0] === 'ok').map(([k]) => k).join() === 'pret' && Object.entries(T.STATUS).filter(([, v]) => v[0] === 'bad').map(([k]) => k).sort().join() === 'ecriture-impossible,serveur-absent')
}

console.log('── the four dots ──')
{
  const c = (id, etat, code = 'x') => ({ id, etat, code })
  const w = (controles, over = {}) => Object.assign({ id: 'x', genre: 'connexion', connexion: true, dernier: controles === null ? null : { statut: 'x', controles } }, over)
  ok('mounted, nothing checked: only the first dot is lit', T.stepsOf(w(null)).join() === 'ok,,,')
  ok('not mounted: no dot', T.stepsOf(w(null, { connexion: false })).join() === ',,,')
  ok('program missing: the install dot is amber, the later ones are empty', T.stepsOf(w([c('connexion', 'ok'), c('binaire', 'ko'), c('auth', 'inconnu')])).join() === 'ok,warn,,')
  ok('installed but not signed in: install green, sign-in amber', T.stepsOf(w([c('binaire', 'ok'), c('auth', 'ko')])).join() === 'ok,ok,warn,')
  ok('all good and ready: four green dots', T.stepsOf(Object.assign(w([c('binaire', 'ok'), c('auth', 'ok'), c('worktree', 'ok')]), { dernier: { statut: 'pret', controles: [c('binaire', 'ok'), c('auth', 'ok')] } })).join() === 'ok,ok,ok,ok')
  ok('a check running: the fourth dot is not green', T.stepsOf(Object.assign(w([c('binaire', 'ok'), c('auth', 'ok')]), { dernier: { statut: 'pret', controles: [c('binaire', 'ok'), c('auth', 'ok')] } }), 'check')[3] === '')
  ok('ZCode (MCP): its server stands for the program, and its sign-in can never be confirmed (amber, not green)', T.stepsOf(w([c('paquet', 'ok'), c('auth', 'inconnu', 'coffre-propre')], { genre: 'mcp' })).join() === 'ok,ok,warn,')
}

console.log('── the sentences ──')
{
  const key = { id: 'gemini', nom: 'Gemini CLI', genre: 'connexion', connect: { mode: 'key', env: 'GEMINI_API_KEY' } }
  const cli = { id: 'codex', nom: 'Codex', genre: 'connexion', connect: { mode: 'cli', cmd: 'codex' } }
  ok('the line under the name follows the status: install, then sign in, then key', /pas encore sur cet ordinateur/.test(T.sublineOf(cli, 'binaire-absent')) && /connecter à votre compte/.test(T.sublineOf(cli, 'non-connecte')) && /clé API/.test(T.sublineOf(key, 'non-connecte')))
  ok('otherwise the line says who it is: vendor · what it signs in with (also before the worker is turned on)', T.sublineOf(cli, 'pret') === 'OpenAI · compte ChatGPT' && T.sublineOf(key, 'pret') === 'Google · clé API Google' && T.sublineOf(cli, 'inactive') === 'OpenAI · compte ChatGPT')
  ok('a worker the page does not know still renders (no logo identity, no crash)', T.sublineOf({ id: 'new-one', nom: 'New', genre: 'connexion' }, 'pret') === '' && T.sublineOf({ id: 'new-one', nom: 'New', genre: 'connexion' }, 'inactive') === '')
  resolved = 'en'
  ok('the same lines in English', T.sublineOf(cli, 'pret') === 'OpenAI · ChatGPT account' && T.sublineOf(key, 'non-connecte') === 'Installed. Your API key is missing.')
  resolved = 'kybernos'

  const label = (code, id, w) => T.controlLabel({ id, code }, w)
  ok('a key-based worker says "API key", not "CLI"', /clé API/i.test(label('connecte', 'auth', key)) && /Aucune clé API/.test(label('non-connecte', 'auth', key)) && /CLI/.test(label('connecte', 'auth', cli)))
  ok('an evidence line the page does not know shows its raw code, never an invented sentence', label('weird', 'binaire', cli) === 'binaire · weird')
  // every code the host can emit has a sentence
  const codes = { connexion: ['montee', 'non-montee'], paquet: ['installe', 'non-installe', 'serveur-present', 'serveur-absent'], binaire: ['trouve', 'absent'], auth: ['connecte', 'non-connecte', 'non-verifiable', 'binaire-absent', 'coffre-propre'], worktree: ['ecriture-ok', 'ecriture-ko'] }
  const missing = []
  for (const [id, list] of Object.entries(codes)) for (const code of list) if (label(code, id, cli).includes(' · ')) missing.push(id + ':' + code)
  ok('every check the host can report has a French and English sentence', missing.length === 0, missing.join())

  ok('an install that timed out, was refused (permissions) or failed each get their own words', /trop de temps/.test(T.failureText({ raison: 'timeout' })) && /droits/.test(T.failureText({ raison: 'exit', code: 243, journal: ['npm ERR! code EACCES'] })) && /code 7/.test(T.failureText({ raison: 'exit', code: 7, journal: ['boom'] })) && T.failureText(null) === '')
  ok('refusals of the host are said in words, with a prefix only for the ones nobody foresaw', /Agent connectors/.test(T.refusalText({ error: 'package-missing' }, 'x', 'x')) && /changé/.test(T.refusalText({ error: 'command-changed' }, 'x', 'x')) && T.refusalText({ error: 'weird' }, 'Raté : ', 'Failed: ') === 'Raté : weird' && T.refusalText({ error: 'network' }, 'Raté : ', 'Failed: ') === 'Raté : network')
  ok('a missing npm is explained (it comes with Node.js), another missing tool is named', /Node\.js/.test(T.refusalText({ error: 'missing-tool', tool: 'npm' }, 'x', 'x')) && /« curl »/.test(T.refusalText({ error: 'missing-tool', tool: 'curl' }, 'x', 'x')))
  ok('the policy of a row: the profile line, or off when there is none', T.currentPolicy({ ligne: null }).expose === false && T.currentPolicy({ ligne: { expose: true, arrierePlan: true } }).background === true && T.currentPolicy({ ligne: { expose: false, arrierePlan: true } }).expose === false)
}

console.log('── every worker the host knows is dressed ──')
{
  const known = []
  const noLogo = []
  for (const w of WORKERS) {
    if (T.identityLine(w) === '') known.push(w.id)
    const sym = w.id === 'zcode' ? 'term' : { 'claude-code': 'claude', codex: 'codex', gemini: 'gemini', opencode: 'opencode', qwen: 'qwen', hermes: 'hermes' }[w.id]
    if (!source.includes('id="kbwk-lg-' + sym + '"') && !source.includes('id=\\"kbwk-lg-' + sym + '\\"')) noLogo.push(w.id)
  }
  ok('each worker has a vendor · account line', known.length === 0, known.join())
  ok('each worker has a logo symbol in the sprite (ZCode: the terminal glyph)', noLogo.length === 0, noLogo.join())
  ok('the sprite also carries the fallback glyph for a worker added later', source.includes('id="kbwk-lg-term"'))
  const sprite = source.match(/const LOGOS = '(<svg[^']*<\/svg>)'/)
  ok('the sprite is one inline SVG, free of scripts and external references, and not bloated', sprite !== null && sprite[1].length < 40000 && !/<script|onload|xlink:href="http|href="http/i.test(sprite[1]), sprite && String(sprite[1].length))
  ok('gradient ids of the sprite are this page’s own (kbwk-), so they cannot clash with another bundle', [...(source.match(/<linearGradient id="([^"]+)"/g) || [])].every((m) => /id="kbwk-/.test(m)))
}

console.log('── the text: every French sentence has its English ──')
{
  const pairs = [...source.matchAll(/kt\('((?:[^'\\]|\\.)*)',\s*'((?:[^'\\]|\\.)*)'\)/g)].map((m) => [m[1], m[2]])
  ok('the page has a few hundred translated sentences (the scan found them)', pairs.length > 150, String(pairs.length))
  ok('none is empty on either side', pairs.every(([a, b]) => a.trim() !== '' && b.trim() !== ''))
  const same = pairs.filter(([a, b]) => a === b && a.length > 24).map(([a]) => a.slice(0, 50))
  ok('no long sentence is the same in both languages (nobody translated it)', same.length === 0, same.slice(0, 3).join(' | '))
  const french = /\b(le|la|les|des|votre|vous|est|une|pour|sur|dans)\b/i
  const english = pairs.filter(([, b]) => french.test(b) && !/[A-Z]{2}|DSH|Terminal/.test(b) && /\b(votre|vous|est|dans)\b/i.test(b)).map(([, b]) => b.slice(0, 50))
  ok('no English side is French', english.length === 0, english.slice(0, 3).join(' | '))
}

console.log('── what the page may talk to ──')
{
  const fetched = [...source.matchAll(/(?:lireJson|post)\(\s*'([^']+)'/g)].map((m) => m[1])
  ok('every request goes to this host: /kybernos-workers/… or the Tools screen of the main plugin', fetched.length >= 6 && fetched.every((u) => u.startsWith('/kybernos-workers/') || u.startsWith('/kybernos/tools/')), fetched.join())
  ok('no image, script or stylesheet is loaded from anywhere (logos are inline)', !/<img\b|new Image\(|\.src\s*=(?!=)|createElement\('(script|link|iframe)'\)/.test(source))
  ok('the only external addresses in the file are links to the vendors’ own guides and the demo command', [...source.matchAll(/https?:\/\/[^\s'"`)]+/g)].map((m) => m[0]).every((u) => /claude\.ai\/install\.sh$|^http:\/\/www\.w3\.org/.test(u)), [...source.matchAll(/https?:\/\/[^\s'"`)]+/g)].map((m) => m[0]).join())
  ok('an API key is read from an input and handed to the credentials service, nowhere else (never logged, never fetched)', !/console\.\w+\([^)]*typed/.test(source) && !/fetch\([^)]*typed/.test(source) && /creds\.get\(\)\.set\(w\.connect\.env, value\)/.test(source))
  ok('the section asks for the Settings slots only; the credentials service is asked for on its own and is optional', /ctx\.inject\(\['slots'\]/.test(source) && /ctx\.inject\(\['remote', 'remote\.credentials'\]/.test(source))
  ok('the shared help card is used behind a guard, with an action for the guide', /window\.__KB_HELP__ && window\.__KB_HELP__\.Help \? h\(window\.__KB_HELP__\.Help, \{ id: 'kybernos-workers', action:/.test(source))
}

console.log('\n' + (failures === 0 ? '✓ ' : '✗ ') + (total - failures) + '/' + total + ' checks')
process.exit(failures === 0 ? 0 : 1)
