// The boot sheet: what the page paints before the client bundle runs. The data comes from the browser and lands in a
// <style> of every page, so the grammar is the whole point of this test.
//   node packages/kybernos-theme/test-boot-store.mjs
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BOOT_ID, FILE_NAME, LIMITS, cleanBoot, readBoot, renderBootCss, serveBoot, writeBoot } from './boot-store.mjs'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + JSON.stringify(detail)))
  if (!ok) failed += 1
}
const pair = (light, dark) => ({ light, dark })
const GOOD = { tokens: { '--dsw-alias-bg-base': pair('#f6f1e7', '#1b1a17'), '--dsw-specific-menu': pair('#ffffffe6', '#2a2822e6'), '--dsw-radius-md': pair('12px', '12px') }, font: "'Iowan Old Style', Georgia, serif" }

console.log('what is accepted')
{
  const r = cleanBoot(GOOD)
  check('a real snapshot', r.ok === true && Object.keys(r.snapshot.tokens).length === 3 && r.snapshot.font === GOOD.font, r)
  check('an empty one (the DSH look)', cleanBoot({}).ok === true && cleanBoot({ tokens: {}, font: null }).snapshot.font === null)
  check('colours in the forms the engine writes', ['#fff', '#ffffff', '#ffffff80', 'rgba(10, 20, 30, 0.5)', 'hsl(210 30% 50%)', 'transparent', '12px', '0.75rem', '100%'].every((v) => cleanBoot({ tokens: { '--dsw-a': pair(v, v) } }).ok === true))
  check('unknown keys are dropped, not stored', Object.keys(cleanBoot({ tokens: {}, evil: '</style>' }).snapshot).sort().join() === 'font,tokens,v')
}

console.log('what is refused (it would end up in every page)')
{
  const refused = (raw) => cleanBoot(raw).ok === false
  const token = (name, light, dark = '#000000') => ({ tokens: { [name]: pair(light, dark) } })
  check('not an object', refused(null) && refused([]) && refused('x') && refused(7))
  check('a token name outside --dsw-*', refused(token('--evil', '#fff')) && refused(token('color', '#fff')) && refused(token('--dsw-A', '#fff')) && refused(token('--dsw-a;b', '#fff')))
  check('a value that closes the rule, the sheet or the element', refused(token('--dsw-a', '#fff;}body{display:none')) && refused(token('--dsw-a', '#fff}')) && refused(token('--dsw-a', '</style><script>')))
  check('a value that fetches something', refused(token('--dsw-a', 'url(https://evil.example/x)')) && refused(token('--dsw-a', 'url(x)')) && refused(token('--dsw-a', "expression(1)")))
  check('an escape, a quote, a comment or a newline in a value', refused(token('--dsw-a', '\\41')) && refused(token('--dsw-a', "'x'")) && refused(token('--dsw-a', '/* x */')) && refused(token('--dsw-a', '#fff\n#000')))
  check('one of the two schemes missing or not text', refused({ tokens: { '--dsw-a': { light: '#fff' } } }) && refused(token('--dsw-a', 7)))
  check('too many tokens', refused({ tokens: Object.fromEntries(Array.from({ length: LIMITS.tokens + 1 }, (_, i) => ['--dsw-t' + i, pair('#fff', '#000')])) }))
  check('a font that closes the declaration', refused({ font: 'serif;}body{display:none' }) && refused({ font: 'a}' }) && refused({ font: '</style>' }))
  check('a font with a quote that does not pair', refused({ font: "'Georgia, serif" }) && refused({ font: 'Georgia", serif' }))
  check('a font with a function', refused({ font: 'url(x)' }) && refused({ font: 'var(--x)' }))
  check('a font that is too long', refused({ font: 'a'.repeat(LIMITS.font + 1) }))
}

console.log('the font stacks the bundle ships')
{
  const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
  const stacks = [...source.matchAll(/stack: (['"])(.*?)\1[ ,}]/g)].map((m) => m[2])
  check('there are some (the list was read)', stacks.length >= 20, stacks.length)
  const bad = stacks.filter((s) => cleanBoot({ font: s }).ok !== true)
  check('every one passes the grammar', bad.length === 0, bad)
}

console.log('the sheet')
{
  const css = renderBootCss(cleanBoot(GOOD).snapshot)
  check('light selector, dark selector, then the font', css === 'html body:not([data-ds-dark-theme]){--dsw-alias-bg-base:#f6f1e7;--dsw-specific-menu:#ffffffe6;--dsw-radius-md:12px}'
    + 'html body[data-ds-dark-theme]{--dsw-alias-bg-base:#1b1a17;--dsw-specific-menu:#2a2822e6;--dsw-radius-md:12px}'
    + ":root,body{--dsw-font-family:'Iowan Old Style', Georgia, serif !important}", css)
  check('nothing for the DSH look', renderBootCss({ v: 1, tokens: {}, font: null }) === '' && renderBootCss(null) === '')
  check('the font alone is enough', renderBootCss({ v: 1, tokens: {}, font: 'serif' }) === ':root,body{--dsw-font-family:serif !important}')
  check('the font rule reaches `body` too (0.2.1-alpha.2 declares the variable there again, which shadows `:root`)', /^:root,body\{/.test(renderBootCss({ v: 1, tokens: {}, font: 'serif' })))
  check('the id the browser half removes is the one in the contract', BOOT_ID === 'kbth-boot')
}

console.log('the file')
{
  const dir = mkdtempSync(join(tmpdir(), 'kb-boot-'))
  check('absent reads as null', readBoot(dir) === null)
  const snap = cleanBoot(GOOD).snapshot
  check('written', writeBoot(dir, snap).changed === true && existsSync(join(dir, FILE_NAME)))
  check('read back the same', JSON.stringify(readBoot(dir)) === JSON.stringify(snap))
  check('the same snapshot again writes nothing', writeBoot(dir, snap).changed === false)
  check('no temporary file is left', readdirSync(dir).every((n) => !n.endsWith('.tmp')))
  writeFileSync(join(dir, FILE_NAME), '{ not json')
  check('a damaged file counts as absent', readBoot(dir) === null)
  writeFileSync(join(dir, FILE_NAME), JSON.stringify({ v: 1, tokens: { '--evil': { light: '#fff', dark: '#000' } }, font: null }))
  check('a hand-edited file is re-validated on the way out', readBoot(dir) === null)
  writeBoot(dir, snap)
  check('an empty snapshot removes the file', writeBoot(dir, { v: 1, tokens: {}, font: null }).changed === true && !existsSync(join(dir, FILE_NAME)))
  check('and removing nothing is not a change', writeBoot(dir, { v: 1, tokens: {}, font: null }).changed === false)
  rmSync(dir, { recursive: true, force: true })
}

console.log('the route')
{
  const home = mkdtempSync(join(tmpdir(), 'kb-boot-home-'))
  let css = null
  const sent = []
  const io = (extra = {}) => ({
    home: async () => home,
    sameOriginStrict: (req) => req.origin === 'self',
    readJson: async (req) => req.body,
    send: (res, status, body) => { sent.push({ status, body }); return status },
    changed: (c) => { css = c },
    ...extra,
  })
  const call = async (req, deps) => { sent.length = 0; await serveBoot(req, {}, deps ?? io()); return sent[0] }
  check('GET is not offered', (await call({ method: 'GET', origin: 'self' })).status === 405)
  check('a request that names no origin of this server is refused', (await call({ method: 'POST', origin: 'other', body: GOOD })).status === 403)
  check('and nothing was stored', !existsSync(join(home, 'kybernos', FILE_NAME)))
  const bad = await call({ method: 'POST', origin: 'self', body: { tokens: { '--dsw-a': pair('url(x)', '#000') } } })
  check('an invalid snapshot is a 400 with the reason', bad.status === 400 && bad.body.ok === false, bad)
  const ok = await call({ method: 'POST', origin: 'self', body: GOOD })
  check('a valid one is stored and the host is told the new sheet', ok.status === 200 && ok.body.ok === true && ok.body.changed === true && css === renderBootCss(cleanBoot(GOOD).snapshot), ok)
  check('it is on disk under <home>/kybernos', existsSync(join(home, 'kybernos', FILE_NAME)))
  check('too large a body is a 413', (await call({ method: 'POST', origin: 'self' }, io({ readJson: async () => { throw new Error('too large') } }))).status === 413)
  check('no DSH home is a readable answer, not a fault', (await call({ method: 'POST', origin: 'self', body: GOOD }, io({ home: async () => null }))).body.ok === false)
  check('a fault never escapes the route', (await call({ method: 'POST', origin: 'self', body: GOOD }, io({ home: async () => { throw new Error('boom') } }))).status === 500)
  rmSync(home, { recursive: true, force: true })
}

console.log(failed === 0 ? '\nOK' : `\n${failed} failure(s)`)
process.exit(failed === 0 ? 0 : 1)
