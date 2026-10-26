// The phone app redistributes third-party code, so its licences are checked and shipped:
//   · mobile/payload/notices.mjs: what is allowed (permissive licences), what stops the build (no licence, UNLICENSED, GPL), how a missing `license` field is read from the licence file,
//     and the text of THIRD-PARTY-NOTICES.txt;
//   · build-payload.mjs drops the chat-channel plugin and the QQ connector (no licence) and runs the audit before it packs;
//   · every package of this repository declares its licence (Apache-2.0, the repository's);
//   · the engine serves the notices inside the phone app only, and the app's page has the card;
//   · TRADEMARK.md covers apps built from this source.
// Usage: node scripts/test-mobile-licences.mjs   (exit 0 = everything passes)
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const { ALLOWED, allowedExpression, audit, render, scanTrees, sniff } = await import(join(root, 'mobile', 'payload', 'notices.mjs'))
const mobile = await import(join(root, 'packages', 'kybernos-mobile', 'index.js'))

let fails = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) { fails++; console.log('FAIL', label, '| got', JSON.stringify(got), '| want', JSON.stringify(want)) } else console.log('ok  ', label)
}
const yes = (label, cond) => eq(label, Boolean(cond), true)

/* 1. what is allowed */
yes('MIT, ISC, BSD, Apache and MPL are allowed', ['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'MPL-2.0'].every((l) => allowedExpression(l)))
yes('GPL, AGPL, LGPL and SSPL are not on the list', ['GPL-3.0', 'AGPL-3.0-only', 'LGPL-3.0-or-later', 'SSPL-1.0', 'UNLICENSED'].every((l) => !allowedExpression(l)))
yes('an OR needs one allowed alternative, an AND needs all', allowedExpression('(MIT OR GPL-3.0)') && !allowedExpression('MIT AND GPL-3.0') && allowedExpression('(MIT AND CC0-1.0)'))
yes('common spellings are understood', allowedExpression('Apache 2.0') && allowedExpression('BSD'))
yes('the allow-list is permissive licences only', [...ALLOWED].every((l) => !/GPL|SSPL|BUSL|PROPRIETARY/i.test(l)))
eq('a licence file is read by its own words', [sniff('MIT License\n\nPermission is hereby granted, free of charge, to any person ... THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY'), sniff('                                 Apache License\n                           Version 2.0, January 2004'), sniff('all rights reserved')], ['MIT', 'Apache-2.0', null])

/* 2. a fixture tree */
const dir = mkdtempSync(join(tmpdir(), 'kb-lic-'))
const nm = join(dir, 'node_modules')
const put = (name, version, pkg, files = {}) => {
  const p = join(nm, ...name.split('/'))
  mkdirSync(p, { recursive: true })
  writeFileSync(join(p, 'package.json'), JSON.stringify({ name, version, ...pkg }))
  for (const [f, t] of Object.entries(files)) writeFileSync(join(p, f), t)
}
const MIT_TEXT = 'MIT License\n\nCopyright (c) 2026 Someone\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files, to deal in the Software without restriction.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.'
try {
  put('good-mit', '1.0.0', { license: 'MIT', author: 'Ann <ann@example.org>', repository: { url: 'git+https://example.org/good.git' } }, { LICENSE: MIT_TEXT })
  put('@scope/apache', '2.1.0', { license: 'Apache-2.0' })
  put('no-field', '0.3.0', {}, { 'LICENSE.md': MIT_TEXT })
  put('qq-like', '1.2.0', { license: 'UNLICENSED' })
  put('copyleft', '1.0.0', { license: 'GPL-3.0' })
  put('nothing', '1.0.0', {})
  put('dual', '1.0.0', { license: '(MIT OR GPL-3.0)' })
  put('see-file', '1.0.0', { license: 'SEE LICENSE IN LICENSE.md' }, { 'LICENSE.md': MIT_TEXT })
  put('parent', '1.0.0', { license: 'ISC' })
  mkdirSync(join(nm, 'parent', 'node_modules'), { recursive: true })
  const nested = join(nm, 'parent', 'node_modules', 'child'); mkdirSync(nested, { recursive: true })
  writeFileSync(join(nested, 'package.json'), JSON.stringify({ name: 'child', version: '1.0.0', license: 'BSD-3-Clause' }))

  const found = scanTrees([nm])
  eq('every package is found, nested and scoped ones too', found.map((e) => e.name), ['@scope/apache', 'child', 'copyleft', 'dual', 'good-mit', 'no-field', 'nothing', 'parent', 'qq-like', 'see-file'])
  const r = audit(found)
  eq('what passes', r.ok.map((e) => e.name + ':' + e.license), ['@scope/apache:Apache-2.0', 'child:BSD-3-Clause', 'dual:(MIT OR GPL-3.0)', 'good-mit:MIT', 'no-field:MIT', 'parent:ISC', 'see-file:MIT'])
  eq('what stops the build', r.problems.map((p) => p.name), ['copyleft', 'nothing', 'qq-like'])
  yes('a package with no licence field is read from its licence file', r.ok.find((e) => e.name === 'no-field').how === 'licence file')
  yes('UNLICENSED stays a problem even beside a licence-looking file', audit(scanTrees([nm]).filter((e) => e.name === 'qq-like')).problems.length === 1)
  const withOverride = audit(found, { nothing: { license: 'MIT', reason: 'read the upstream repository by hand' } })
  yes('an override is accepted and says why', withOverride.ok.some((e) => e.name === 'nothing' && /by hand/.test(e.how)) && withOverride.problems.every((p) => p.name !== 'nothing'))

  const text = render({ entries: r.ok, extra: [{ title: 'Node.js', body: 'MIT, see the link' }], built: '2026-10-26T00:00:00.000Z' })
  yes('the notice lists every package with its licence and author', /good-mit 1\.0\.0 \. MIT \. Ann \. https:\/\/example\.org\/good/.test(text) && /@scope\/apache 2\.1\.0 \. Apache-2\.0/.test(text))
  yes('the licence text ships once for packages that share it', (text.match(/Copyright \(c\) 2026 Someone/g) ?? []).length === 1 && /good-mit, no-field, see-file/.test(text))
  yes('packages without a licence file are named at the end', /ship no licence file/.test(text) && /@scope\/apache \(Apache-2\.0\)/.test(text))
  yes('the extra sections come first', text.indexOf('== Node.js ==') > 0 && text.indexOf('== Node.js ==') < text.indexOf('== Packages'))
} finally { rmSync(dir, { recursive: true, force: true }) }

/* 3. the payload build */
const build = readFileSync(join(root, 'mobile', 'payload', 'build-payload.mjs'), 'utf8')
const dropList = build.slice(build.indexOf('const DROP_PACKAGE = ['), build.indexOf(']\n', build.indexOf('const DROP_PACKAGE = [')))
yes('the chat-channel plugin and the QQ connector are not shipped', /@xmanrui\\\/dsh-im/.test(dropList) && /@tencent-connect\\\//.test(dropList))
yes('our sub-agent providers for command-line programs are not shipped either (the phone cannot launch programs)', /dsh-subagent-\(gemini\|hermes\|opencode\|qwen\)/.test(dropList))
yes('the audit runs before the pack and stops the build on a problem', build.indexOf('audit(shipped)') > 0 && build.indexOf('audit(shipped)') < build.indexOf('const r = await pack(') && /process\.exit\(3\)/.test(build))
yes('the notices are written into the payload', /THIRD-PARTY-NOTICES\.txt/.test(build))
yes('the bootstrap tells the engine where the runtime is', /process\.env\.KB_RUNTIME = dest/.test(readFileSync(join(root, 'mobile', 'payload', 'bootstrap.mjs'), 'utf8')))

/* 4. our own packages declare their licence */
const own = []
const walk = (d) => { for (const e of readdirSync(d)) { if (e === 'node_modules' || e.startsWith('.')) continue; const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (e === 'package.json') own.push(p) } }
walk(join(root, 'packages'))
own.push(join(root, 'mobile', 'app', 'package.json'))
const bad = own.filter((f) => { try { return !allowedExpression(JSON.parse(readFileSync(f, 'utf8')).license ?? '') } catch (e) { return true } }).map((f) => f.slice(root.length))
eq('every package of this repository declares an allowed licence', bad, [])
yes('and they are Apache-2.0, the repository\'s', own.every((f) => JSON.parse(readFileSync(f, 'utf8')).license === 'Apache-2.0'))

/* 5. the engine serves the notices inside the phone app, and the app's page has the card */
const call = (opts, runtime) => {
  const out = { status: 0, headers: {}, body: '' }
  const res = { writeHead (s, h) { out.status = s; out.headers = h ?? {} }, end (b) { out.body = b ?? '' } }
  mobile.serveNotices({ method: opts.method ?? 'GET', headers: { host: opts.host ?? '127.0.0.1:4000', ...(opts.headers ?? {}) }, socket: { localPort: 4000 } }, res, runtime)
  return out
}
const rt = mkdtempSync(join(tmpdir(), 'kb-rt-'))
try {
  eq('the route is under the plugin\'s prefix', mobile.NOTICES_ROUTE, '/kybernos-mobile/notices')
  eq('no runtime folder: not found', call({}, undefined).status, 404)
  eq('a runtime without the file: not found', call({}, rt).status, 404)
  writeFileSync(join(rt, mobile.NOTICES_FILE), 'Kybernos: open-source components\n')
  const ok = call({}, rt)
  eq('the file is served as plain text', [ok.status, ok.headers['content-type'], ok.body], [200, 'text/plain; charset=utf-8', 'Kybernos: open-source components\n'])
  eq('only a read', call({ method: 'POST' }, rt).status, 405)
  eq('a foreign Host is refused', call({ host: 'evil.example:4000' }, rt).status, 403)
  eq('a foreign Origin is refused', call({ headers: { origin: 'https://evil.example' } }, rt).status, 403)
} finally { rmSync(rt, { recursive: true, force: true }) }
yes('the app page has the open-source card, behind a button', /data-kb': 'mobile-app-notices'/.test(readFileSync(join(root, 'packages', 'kybernos-mobile', 'client.js'), 'utf8')) && /fetch\('\/kybernos-mobile\/notices'\)/.test(readFileSync(join(root, 'packages', 'kybernos-mobile', 'client.js'), 'utf8')))

/* 6. the trademark policy covers apps built from this source */
const tm = readFileSync(join(root, 'TRADEMARK.md'), 'utf8')
yes('TRADEMARK.md says what a published app built from the source may not use', /## Apps built from this source/.test(tm) && /must \*\*not\*\*/.test(tm) && /app\.kybernos\.host/.test(tm))

console.log(fails === 0 ? '\nall good' : '\n' + fails + ' failed')
process.exit(fails === 0 ? 0 : 1)
