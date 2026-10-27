// test-templates.mjs — the conformance suite of the stack catalog: scaffold, boot through the REAL
// runtime, serve, stop. Same suite for every stack (rule of the adversarial review, 2026-10-27):
// a stack that does not pass here does not enter the catalog.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scaffoldApp } from './lib/apps.mjs'
import { DEFAULT_STACK, listTemplates, scaffoldFromTemplate } from './lib/templates.mjs'
import { startApp, stopApp } from './lib/runtime.mjs'

let echecs = 0
const check = (libelle, ok, detail) => {
  if (ok === true) { console.log('  \u2713 ' + libelle); return }
  echecs++
  console.log('  \u2717 ' + libelle + (detail !== undefined ? ' \u2014 ' + JSON.stringify(detail) : ''))
}

console.log('catalogue')
const catalogue = listTemplates()
check('two stacks listed', catalogue.length === 2, catalogue)
check('both templates are present on disk', catalogue.every((t) => t.dispo === true), catalogue)
check('the default stack is web', DEFAULT_STACK === 'web')
check('an unknown stack is refused', scaffoldFromTemplate('/tmp/nowhere', 'php-nuke').ok === false)

const racine = mkdtempSync(join(tmpdir(), 'kb-tpl-'))
try {
  console.log('statique — the real runtime boots it')
  const s = scaffoldFromTemplate(join(racine, 'site'), 'statique')
  check('scaffolded', s.ok === true && existsSync(join(racine, 'site', 'public', 'index.html')), s)
  const ds = await startApp(join(racine, 'site'))
  check('it serves', ds.ok === true, ds)
  const page = await fetch('http://127.0.0.1:' + ds.port + '/')
  check('the landing answers 200', page.status === 200 && (await page.text()).includes('landing page'))
  // Traversal is proven on the wire: fetch() normalises dot segments away, so its URL would never
  // reach the guard. A raw socket sends what an attacker sends.
  const { createConnection } = await import('node:net')
  const reponse = await new Promise((resoudre) => {
    const s = createConnection({ host: '127.0.0.1', port: ds.port }, () => {
      s.write('GET /../server.js HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n')
    })
    let buf = ''
    s.on('data', (d) => { buf += d })
    s.on('end', () => resoudre(buf))
  })
  check('path traversal is refused on the wire', reponse.startsWith('HTTP/1.1 403'), reponse.slice(0, 24))
  await stopApp(join(racine, 'site'))

  console.log('web — the real runtime boots it')
  const w = scaffoldFromTemplate(join(racine, 'app'), 'web')
  check('scaffolded', w.ok === true && existsSync(join(racine, 'app', 'api.js')), w)
  const dw = await startApp(join(racine, 'app'))
  check('it serves', dw.ok === true, dw)
  const sante = await fetch('http://127.0.0.1:' + dw.port + '/api/health')
  const corps = await sante.json()
  check('the API answers', sante.status === 200 && corps.ok === true && corps.stack === 'web', corps)
  const shell = await fetch('http://127.0.0.1:' + dw.port + '/')
  check('the shell answers 200', shell.status === 200 && (await shell.text()).includes('/api/health'))
  await stopApp(join(racine, 'app'))

  console.log('brief + template, the way /create does it')
  const r = scaffoldApp(racine, { nom: 'Flux', slug: 'flux', stack: 'web' })
  check('the brief records its stack', r.ok === true && readFileSync(join(racine, 'flux', 'webapp.json'), 'utf8').includes('"stack": "web"'))
  const t = scaffoldFromTemplate(join(racine, 'flux'), 'web')
  check('the template lands beside the brief', t.ok === true && existsSync(join(racine, 'flux', 'server.js')) && existsSync(join(racine, 'flux', 'webapp.json')))
} finally {
  rmSync(racine, { recursive: true, force: true })
}

if (echecs > 0) { console.log('test-templates: ' + echecs + ' failure(s)'); process.exit(1) }
console.log('test-templates: all green')
