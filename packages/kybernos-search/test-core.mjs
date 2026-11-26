// The extractor, the folding and the search itself: pure, no disk.   node packages/kybernos-search/test-core.mjs
import { extractJournal } from './extractor.mjs'
import { fold, queryTerms, marksOf, snippet, maskSecrets, prepare, search } from './core.mjs'

let total = 0
let failed = 0
const ok = (name, cond, detail) => { total += 1; if (cond) console.log('  ✓ ' + name); else { failed += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 240))) } }

console.log('folding')
ok('accents and case are ignored', fold('Thème ÉTÉ Œuvre') === 'theme ete œuvre' || fold('Thème ÉTÉ Œuvre') === 'theme ete oeuvre' || fold('Thème ÉTÉ Œuvre').startsWith('theme ete'))
{
  const samples = ['Créer un nouveau thème', 'İstanbul ÇA va', 'naïve café', 'ASCII only', '日本語 テスト', 'emoji ✅ 📊 é']
  ok('folding keeps the length, so offsets in the folded text are offsets in the original', samples.every((s) => fold(s).length === s.length), samples.map((s) => [s.length, fold(s).length]))
}
ok('a decomposed accent is folded too', fold('é') !== 'x')
ok('the query: folded, distinct, at most 6 words', JSON.stringify(queryTerms('  Thème   thème DOCKER ')) === '["theme","docker"]' && queryTerms('a b c d e f g h').length === 6 && queryTerms('   ').length === 0 && queryTerms(null).length === 0)

console.log('extracting a journal')
{
  const J = [
    { type: 'session', id: 'session-a', cwd: '/home/x/projet', createdAt: 1000 },
    { type: 'user/message', time: 1100, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Crée un thème sombre <system-reminder>secret instructions</system-reminder> merci' }] } },
    { type: 'user/message', time: 1150, data: { source: { kind: 'agent-instructions' }, content: 'injected text that is not the person' } },
    { type: 'assistant/message', time: 1200, data: { message: { content: [{ type: 'text', text: 'Voici le thème.' }, { type: 'tool_use', name: 'x' }] } } },
    { type: 'tool/result', time: 1250, data: { content: 'a huge tool output that must not be read' } },
    { type: 'session/title', time: 1300, data: { title: 'Premier titre' } },
    { type: 'session/title', time: 1400, data: { title: 'Titre final' } },
    { type: 'user/message', time: 1500, data: { content: 'Message sans source' } }
  ].map((e) => JSON.stringify(e)).join('\n') + '\nnot json\n'
  const r = extractJournal(J)
  ok('the header', r.id === 'session-a' && r.cwd === '/home/x/projet' && r.createdAt === 1000)
  ok('the LAST title wins', r.title === 'Titre final')
  ok('the person and the assistant are read, the injection and the tool output are not', r.msgs.length === 3 && r.msgs[0][0] === 'u' && r.msgs[1][0] === 'a' && r.msgs[2][2] === 'Message sans source', r.msgs)
  ok('system reminders are stripped from what the person wrote', r.msgs[0][2] === 'Crée un thème sombre  merci', r.msgs[0][2])
  ok('only text blocks of the assistant are kept', r.msgs[1][2] === 'Voici le thème.')
  const big = extractJournal(JSON.stringify({ type: 'assistant/message', time: 1, data: { message: { content: 'x'.repeat(50000) } } }))
  ok('a message is capped', big.msgs[0][2].length === 8000)
  let many = ''
  for (let i = 0; i < 100; i += 1) many += JSON.stringify({ type: 'assistant/message', time: i, data: { message: { content: 'y'.repeat(8000) } } }) + '\n'
  ok('a chat is capped', extractJournal(many).msgs.length <= 40)
  ok('an empty or broken journal is an empty chat, not a throw', extractJournal('').msgs.length === 0 && extractJournal('{{{{').msgs.length === 0 && extractJournal(null).msgs.length === 0)
}

console.log('searching')
const doc = (scope, id, title, texts, over = {}) => prepare({ scope, id, title, parts: texts.map((t, i) => ({ r: i % 2 ? 'a' : 'u', ts: 1000 + i, t })), meta: {}, open: null, ts: over.ts ?? null })
const DOCS = [
  doc('chat', 'c1', 'Créer un nouveau thème', ['Je veux un thème sombre violet', 'Voici trois pistes de thème']),
  doc('chat', 'c2', 'Nettoyage Docker', ['Les images occupent 14 Go, ce thème de nettoyage vaut pour toutes']),
  doc('chat', 'c3', 'Autre sujet', ['rien à voir avec ça']),
  doc('skill', 's1', 'maquette-dsh', ['Skill qui fabrique une maquette fidèle : jetons du thème, clair et sombre']),
  doc('lesson', 'l1', 'Un test prouve la sélection', ['Vérifier le thème rendu dans le vrai GUI'])
]
{
  const r = search(DOCS, 'theme')
  ok('"theme" finds "thème" in every scope', r.results.length === 4 && r.counts.chat === 2 && r.counts.skill === 1 && r.counts.lesson === 1, r.counts)
  ok('a title match ranks first', r.results[0].id === 'c1', r.results.map((x) => x.id))
  ok('a result carries the marks of its title', r.results[0].titleMarks.length === 1 && r.results[0].titleMarks[0][0] === 'Créer un nouveau '.length)
  ok('and snippets with marks inside the window', r.results[0].hits.length > 0 && r.results[0].hits.every((h) => h.marks.every(([a, b]) => b <= h.text.length && fold(h.text).slice(a, b) === 'theme')))
}
ok('every word must be there (AND)', search(DOCS, 'theme docker').results.map((x) => x.id).join() === 'c2' && search(DOCS, 'theme zzz').results.length === 0)
ok('a scope filter', search(DOCS, 'theme', { scopes: ['skill'] }).results.map((x) => x.id).join() === 's1')
ok('an empty or blank query is nothing', search(DOCS, '').results.length === 0 && search(DOCS, '  ').results.length === 0)
{
  const phrase = [doc('chat', 'p1', 'x', ['le thème sombre']), doc('chat', 'p2', 'y', ['sombre et un autre thème'])]
  ok('a contiguous phrase ranks above the same words apart', search(phrase, 'theme sombre').results[0].id === 'p1')
}
{
  const many = []
  for (let i = 0; i < 50; i += 1) many.push(doc('chat', 'm' + i, 'thème ' + i, ['thème']))
  ok('per-scope and total limits', search(many, 'theme', { perScope: 5 }).results.length === 5 && search(many, 'theme', { limit: 7, perScope: 50 }).results.length === 7)
  ok('the counts are the TRUE counts, not the capped list', search(many, 'theme', { perScope: 5 }).counts.chat === 50)
}
{
  const recent = doc('chat', 'new', 'sujet', ['thème'], { ts: Date.now() })
  const old = doc('chat', 'old', 'sujet', ['thème'], { ts: Date.now() - 400 * 86400000 })
  ok('between two equal matches the newer one first', search([old, recent], 'theme').results[0].id === 'new')
}
{
  const long = 'a '.repeat(200) + 'MOT-CLÉ ' + 'b '.repeat(200)
  const s = snippet(long, fold(long), ['mot-cle'])
  ok('a snippet is a window around the first match, with ellipsis flags', s.text.length < 260 && s.pre === true && s.post === true && s.marks.length === 1 && fold(s.text).slice(s.marks[0][0], s.marks[0][1]) === 'mot-cle', s)
  ok('overlapping terms merge into one mark', JSON.stringify(marksOf('theme sombre', ['theme', 'them'])) === '[[0,5]]')
}
{
  const key = 'voici ma clé ' + 'ab12'.repeat(10) + ' fin'
  const masked = maskSecrets(key)
  ok('a long mixed token is masked in a snippet, with the same length', masked.length === key.length && !masked.includes('ab12ab12ab12') && masked.includes('voici ma clé') && masked.endsWith(' fin'), masked)
  ok('a long word without digits is left alone', maskSecrets('anticonstitutionnellement-et-extraordinairement') === 'anticonstitutionnellement-et-extraordinairement')
}

console.log('\n' + (total - failed) + '/' + total + (failed === 0 ? ' ✓' : ' ✗ ' + failed + ' failure(s)'))
process.exit(failed === 0 ? 0 : 1)
