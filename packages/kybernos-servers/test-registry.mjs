// Tests of the registry rules: names, ids and duplicates (pure).   node packages/kybernos-servers/test-registry.mjs
// SRV-05 (names and ids never collide), SRV-06 (two spellings of one address are one server).
import { BUILTIN_ID, ID, cleanName, findByApi, normalizeApi, suggestName, uniqueId, uniqueName, withName, withProfile, without } from './registry.mjs'

let failed = 0
const check = (name, ok, detail) => { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + JSON.stringify(detail))); if (!ok) failed += 1 }

console.log('names')
check('a name is cleaned: single spaces, no control characters, no angle brackets, at most 60 characters', cleanName('  Acme   <b>Corp</b>\n') === 'Acme b Corp /b' && cleanName('x'.repeat(100)).length === 60 && cleanName(5) === '' && cleanName('\u0000\u0007') === '', cleanName('  Acme   <b>Corp</b>\n'))
check('a published name that is free is proposed as it is', suggestName('Acme Corp', 'kb.acme.corp', ['Kybernos Cloud']) === 'Acme Corp')
check('« Kybernos », what every Kybernos server answers by default, becomes « Kybernos · host »', suggestName('Kybernos', 'api.dev.kybernos.app', ['Kybernos Cloud']) === 'Kybernos · api.dev.kybernos.app')
check('…whatever its case', suggestName('KYBERNOS', 'h:1', []) === 'KYBERNOS · h:1')
check('a name already in the list gets the host too, case-insensitively', suggestName('acme corp', 'kb2.acme.corp', ['Acme Corp']) === 'acme corp · kb2.acme.corp')
check('no published name: the host is the name', suggestName('', 'kb.acme.corp', []) === 'kb.acme.corp' && suggestName(undefined, 'kb.acme.corp', []) === 'kb.acme.corp')
check('a name the person typed is kept, with (2), (3) when taken', uniqueName('Staging', []) === 'Staging' && uniqueName('Staging', ['staging']) === 'Staging (2)' && uniqueName('Staging', ['Staging', 'Staging (2)']) === 'Staging (3)')
check('a typed name that cleans to nothing is empty, so the proposed name applies', uniqueName('   ', []) === '' && uniqueName('<>', []) === '', uniqueName('<>', []))
check('a long typed name stays within 60 characters even with a counter', uniqueName('y'.repeat(60), ['y'.repeat(60)]).length <= 60)

console.log('ids')
check('an id is valid by the same rule as the open half (lower case, digits, dashes, ≤ 40)', ID.test('acme-corp') && !ID.test('Acme') && !ID.test('a/b') && !ID.test('') && !ID.test('-a') && !ID.test('a'.repeat(41)))
check('a free id is kept', uniqueId('acme-corp', ['staging']) === 'acme-corp')
check('a taken id gets -2, -3…', uniqueId('acme-corp', ['acme-corp']) === 'acme-corp-2' && uniqueId('acme-corp', ['acme-corp', 'acme-corp-2']) === 'acme-corp-3')
check('the built-in id is never handed out', uniqueId(BUILTIN_ID, []) === BUILTIN_ID + '-2')
check('a long slug still fits in 40 characters with its counter', uniqueId('a'.repeat(40), ['a'.repeat(40)]).length <= 40 && ID.test(uniqueId('a'.repeat(40), ['a'.repeat(40)])))
check('an invalid base falls back to « server »', uniqueId('Not Valid!', []) === 'server')

console.log('SRV-06 duplicates')
check('scheme case, host case, a trailing slash and the default port do not make another server', normalizeApi('HTTPS://KB.Acme.Corp/') === 'https://kb.acme.corp' && normalizeApi('https://kb.acme.corp:443') === 'https://kb.acme.corp' && normalizeApi('https://kb.acme.corp/app/') === 'https://kb.acme.corp/app')
check('a different path or port is another server', normalizeApi('https://kb.acme.corp/app') !== normalizeApi('https://kb.acme.corp') && normalizeApi('https://kb.acme.corp:8443') !== normalizeApi('https://kb.acme.corp'))
const list = [{ id: 'kybernos-cloud', api: 'https://api.kybernos.app' }, { id: 'acme', api: 'https://kb.acme.corp' }, null, { id: 'x' }]
check('an entry with the same address is found, whatever the spelling', findByApi(list, 'https://KB.acme.corp/').id === 'acme' && findByApi(list, 'https://api.kybernos.app').id === 'kybernos-cloud')
check('no match, junk entries and a non-array are survived', findByApi(list, 'https://other.example') === undefined && findByApi(null, 'https://a.b') === undefined)

console.log('the registry object is never mutated')
{
  const reg = { active: 'acme', servers: [{ id: 'acme', name: 'Acme', api: 'https://kb.acme.corp' }, { id: 'stg', name: 'Staging', api: 'https://stg.acme.corp' }] }
  const frozen = JSON.stringify(reg)
  const plus = withProfile(reg, { id: 'new', name: 'New', api: 'https://n.example' })
  check('adding appends and keeps the active server', plus.servers.length === 3 && plus.servers[2].id === 'new' && plus.active === 'acme')
  const renamed = withName(reg, 'stg', 'Pre-prod')
  check('renaming changes one entry only', renamed.servers[1].name === 'Pre-prod' && renamed.servers[0].name === 'Acme' && renamed.servers[1].api === 'https://stg.acme.corp')
  check('removing a server that is not active keeps the active one', without(reg, 'stg').servers.length === 1 && without(reg, 'stg').active === 'acme')
  check('removing the ACTIVE server makes the built-in server active (the way back)', without(reg, 'acme').active === BUILTIN_ID && without(reg, 'acme').servers.length === 1)
  check('none of that touched the original', JSON.stringify(reg) === frozen)
}

console.log(failed === 0 ? '\nall good' : '\n' + failed + ' failed')
process.exit(failed === 0 ? 0 : 1)
