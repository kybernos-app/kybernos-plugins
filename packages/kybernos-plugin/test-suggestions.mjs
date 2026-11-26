// The ledger of suggestions that wait for a click (a memory, a section of the custom instructions): the door rules and the file.
import { mkdtempSync, readFileSync, statSync, readdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkSuggestion, factOf, hasPersonalData, makeLedger, sameText, LIMITS } from './suggestions.mjs'

let fails = 0
const eq = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) { fails++; console.log('FAIL', label, '| got', JSON.stringify(got), '| want', JSON.stringify(want)) } else console.log('ok  ', label) }

eq('an address, a phone number or a secret link is personal data', [hasPersonalData('write to claire@example.com'), hasPersonalData('call +33 6 12 34 56 78'), hasPersonalData('https://x.example/a?token=abc'), hasPersonalData('Clients are private individuals (14 of 14)')], [true, true, true, false])
// the fact of a memory suggestion: a small model copies the person's whole sentence (« Remember that I am allergic to peanuts »), the ask is not part of the fact
eq('the words the person asked with are not part of the fact, in English and French, first letter up', [factOf('Remember that I am allergic to peanuts'), factOf('remember that I am allergic to peanuts.'), factOf('Please remember that I like tea'), factOf('Remember: I like tea'), factOf('Remember I like tea'), factOf('Note that she is on the left'), factOf("Don't forget that Paul is vegan"), factOf('Retiens que je suis allergique aux arachides'), factOf("Souviens-toi que j'habite à Lyon"), factOf("N'oublie pas que Paul est végétarien"), factOf("S'il te plaît, retiens que je suis gaucher"), factOf('Rappelle-toi qu’il aime le thé'), factOf('Allergic to peanuts')], ['I am allergic to peanuts', 'I am allergic to peanuts.', 'I like tea', 'I like tea', 'I like tea', 'She is on the left', 'Paul is vegan', 'Je suis allergique aux arachides', "J'habite à Lyon", 'Paul est végétarien', 'Je suis gaucher', 'Il aime le thé', 'Allergic to peanuts'])
eq('a task is not a fact, and a text that is only the ask is left as it is', [factOf('Remember to call Paul'), factOf('Save the date'), factOf('Remember that'), factOf(''), factOf(null)], ['Remember to call Paul', 'Save the date', 'Remember that', '', ''])
eq('the door stores the fact', checkSuggestion('memory', { text: 'Retiens que je suis allergique aux arachides' }).text, 'Je suis allergique aux arachides')
eq('...but leaves a section of instructions as it is', checkSuggestion('instructions', { text: 'Remember that replies are short' }).text, 'Remember that replies are short')
eq('two texts that differ by case, spaces or the final dot are the same suggestion', [sameText('Allergic to peanuts', 'allergic  to peanuts.'), sameText('Allergic to peanuts', 'Allergic to peanuts!'), sameText('Allergic to peanuts', 'Allergic to nuts'), sameText('a', 'a. ')], [true, true, false, true])
eq('an unknown kind is refused', checkSuggestion('plugin', { text: 'x' }).error, 'unknown kind')
eq('an empty text is refused', checkSuggestion('memory', { text: '   ' }).error, 'empty')
eq('a long memory is refused, the limit is the kind\'s', [checkSuggestion('memory', { text: 'x'.repeat(LIMITS.memory.text + 1) }).error, checkSuggestion('instructions', { text: 'x'.repeat(LIMITS.memory.text + 1) }).ok], ['too long', true])
eq('personal data is refused at the door', checkSuggestion('memory', { text: 'Writes to dupont@example.org often' }).error, 'personal data')
eq('the proof is bounded', JSON.stringify(checkSuggestion('memory', { text: 'ok', n: 1e12, span: 's'.repeat(99), where: 'w'.repeat(99) }).from), JSON.stringify({ n: 100000, span: 's'.repeat(40), where: 'w'.repeat(80) }))

const dir = mkdtempSync(join(tmpdir(), 'kb-sugg-'))
const file = join(dir, 'kybernos', 'suggestions.json')
let n = 0
const led = makeLedger({ file, now: () => '2026-10-22T10:00:00.000Z', newId: () => 's_' + (n += 1) })
eq('an empty ledger lists nothing', led.list(), [])
const a = await led.add('memory', { text: 'Clients are private individuals (14 of 14 enquiries)', n: 14, span: '60 days', where: 'Gmail' })
eq('a memory is stored with where it comes from', [a.ok, a.item.id, a.item.from.n, a.item.at], [true, 's_1', 14, '2026-10-22T10:00:00.000Z'])
eq('the file is private and no temporary file is left', [(statSync(file).mode & 0o777).toString(8), readdirSync(join(dir, 'kybernos')).filter((x) => x.includes('.tmp-')).length], ['600', 0])
eq('the same text twice is refused', (await led.add('memory', { text: 'clients are private individuals (14 of 14 enquiries)' })).error, 'already waiting')
eq('...also when only the final dot, the case or the ask differs', [(await led.add('memory', { text: 'Clients are private individuals (14 of 14 enquiries).' })).error, (await led.add('memory', { text: 'Remember that clients are private individuals (14 of 14 enquiries)' })).error], ['already waiting', 'already waiting'])
for (let i = 0; i < 7; i += 1) await led.add('memory', { text: 'Memory ' + i })
eq('eight memories wait at most', (await led.add('memory', { text: 'One more' })).error, 'too many waiting')
await led.add('instructions', { text: 'First instruction text' })
const second = await led.add('instructions', { text: 'Second instruction text' })
eq('a new instruction suggestion replaces the older one', [led.list('instructions').length, led.list('instructions')[0].text, second.ok], [1, 'Second instruction text', true])
eq('the kinds are listed apart', [led.list('memory').length, led.list('instructions').length, led.list().length], [8, 1, 9])
const gone = await led.resolve('s_1')
eq('resolving removes it and returns it', [gone.ok, gone.item.kind, led.list('memory').length], [true, 'memory', 7])
eq('resolving an unknown id says so', (await led.resolve('nope')).error, 'not found')
// two writers at once never lose an item
const both = await Promise.all([led.add('memory', { text: 'Parallel A' }), led.add('instructions', { text: 'Parallel B' })])
eq('writes are one at a time', [both.every((x) => x.ok === true), led.list('memory').some((i) => i.text === 'Parallel A'), led.list('instructions').some((i) => i.text === 'Parallel B')], [true, true, true])
// a damaged file reads as empty and is repaired by the next write
writeFileSync(file, '{ not json')
eq('a damaged file reads as empty', led.list(), [])
eq('...and the next write repairs it', (await led.add('memory', { text: 'After the damage' })).ok, true)
rmSync(dir, { recursive: true, force: true })

console.log(fails === 0 ? '\nall checks passed' : '\n' + fails + ' check(s) FAILED')
process.exit(fails === 0 ? 0 : 1)
