// What makes a code block a mermaid diagram on DSH 0.2, where the banner says "Code block" and the <code> has no
// language class (the old detection only read those two signals and drew nothing in the real GUI).
//   node packages/dsh-mermaid/test-detect.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, 'src', 'plugin.js'), 'utf8')

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + detail))
  if (!ok) failed += 1
}

// The pure part of the plugin sits between two markers and touches no DOM, so it can be run as it is.
const begin = source.indexOf('// <detect:begin>')
const end = source.indexOf('// <detect:end>')
check('the detection block is delimited by its markers', begin >= 0 && end > begin)
// The block speaks through the plugin's pair helper kt(fr, en), defined above it: the test hands it one that follows `say`,
// English until a check asks for French (the helper's own rule - French for French, English for every other language - is
// checked by scripts/test-no-french-literals.mjs, on the real source).
let say = (fr, en) => en
const { looksLikeMermaid, diagramProblem, explainError, toggleLabel, MAX_TEXT_SIZE } =
  new Function('kt', source.slice(begin, end) + '\nreturn { looksLikeMermaid, diagramProblem, explainError, toggleLabel, MAX_TEXT_SIZE }')((fr, en) => say(fr, en))

console.log('diagram headers are recognised')
const yes = {
  'flowchart with direction': 'flowchart TD\n  A --> B',
  'graph with direction': 'graph LR\n  A --> B',
  'graph without direction (valid mermaid, defaults to TB)': 'graph\n  A --> B',
  'flowchart alone on its line': 'flowchart\n  A --> B',
  'flowchart-elk': 'flowchart-elk TD\n  A --> B',
  'sequenceDiagram': 'sequenceDiagram\n  A->>B: hi',
  'classDiagram': 'classDiagram\n  class A',
  'classDiagram-v2': 'classDiagram-v2\n  class A',
  'stateDiagram-v2': 'stateDiagram-v2\n  [*] --> A',
  'erDiagram': 'erDiagram\n  A ||--o{ B : has',
  'gitGraph': 'gitGraph\n  commit',
  'pie': 'pie\n  "a": 1',
  'pie with a title': 'pie title Pets\n  "Dogs": 3',
  'pie showData': 'pie showData\n  "Dogs": 3',
  'journey': 'journey\n  title My day',
  'gantt': 'gantt\n  dateFormat YYYY-MM-DD',
  'timeline': 'timeline\n  title History',
  'mindmap': 'mindmap\n  root((x))',
  'xychart-beta': 'xychart-beta\n  title "x"',
  'C4Context': 'C4Context\n  title x',
  'leading blank lines': '\n\n  flowchart TD\n  A --> B',
  'a %% comment first': '%% a comment\nflowchart TD\n  A --> B',
  'an init directive first': '%%{init: {"theme": "dark"}}%%\ngraph TD\n  A --> B',
  'YAML front matter first': '---\ntitle: Example\n---\nflowchart TD\n  A --> B',
  'Windows line endings': 'flowchart TD\r\n  A --> B\r\n',
  'a byte order mark': '\uFEFFflowchart TD\n  A --> B',
}
for (const [name, text] of Object.entries(yes)) check(name, looksLikeMermaid(text) === true)

console.log('everything else is left alone')
const no = {
  'nothing': '',
  'plain prose': 'hello world',
  '"graph" starting a sentence': 'graph theory is the study of graphs',
  '"pie" starting a sentence': 'pie is good',
  '"timeline" starting a sentence': 'timeline of events',
  '"journey" starting a sentence': 'journey to the west',
  '"block" is only a header with its -beta suffix': 'block diagram',
  'python code': 'def f():\n    return 1',
  'a shell command': 'ls -la',
  'a # comment is not a mermaid comment': '# comment\nflowchart TD\n  A --> B',
  'only comments': '%% just a comment\n%% another',
  'only front matter': '---\ntitle: x\n---',
  'a header that is not on the first line': 'hello\nflowchart TD\n  A --> B',
  'JSON': '{"graph": "TD"}',
}
for (const [name, text] of Object.entries(no)) check(name, looksLikeMermaid(text) === false)
check('null', looksLikeMermaid(null) === false)
check('undefined', looksLikeMermaid(undefined) === false)

// ── A4-16: an oversized diagram is refused before mermaid sees it ──────────
// The audit's sample: a chain of 5 000 edges (~76 KB), generated here. Mermaid itself would draw a pink
// « Maximum text size in diagram exceeded » box in its place.
console.log('a diagram over the text limit is not drawn')
{
  const chain = 'flowchart TD\n' + Array.from({ length: 5000 }, (_, i) => `  M${i}-->M${i + 1}`).join('\n')
  check('the sample really is over the limit', chain.length > MAX_TEXT_SIZE, chain.length + ' chars')
  const p = diagramProblem(chain)
  check('a 5 000-edge chain gets a card that says it is too large', p !== null && p.title === 'Diagram too large to draw', JSON.stringify(p))
  check('the card gives the size and the limit in English', p !== null && /has 7\d,\d{3} characters; mermaid draws up to 50,000/.test(p.detail), p && p.detail)
  check('no French in it', p !== null && !/Diagramme|invalide/.test(p.title + p.detail))
  const atLimit = 'flowchart TD\n' + 'A-->B\n'.repeat(Math.floor((MAX_TEXT_SIZE - 13) / 6))
  check('a diagram right under the limit is still drawn', atLimit.length <= MAX_TEXT_SIZE && diagramProblem(atLimit) === null, atLimit.length + ' chars')
  check('one character over is refused', diagramProblem(atLimit + 'x'.repeat(MAX_TEXT_SIZE - atLimit.length + 1)) !== null)
}

// A4-15 (not reproduced): the 400-edge fan of the audit is NOT refused. It drew in 0.9 s here (a 0.6 s main-thread gap in
// the real GUI), so an edge budget would only hide diagrams that draw fine. See the finding in the commit message.
console.log('a big but sane diagram is still drawn')
{
  const fan = 'flowchart LR\n' + Array.from({ length: 400 }, (_, i) => `  R-->F${i}`).join('\n')
  check('the 400-edge fan is not refused', diagramProblem(fan) === null, fan.length + ' chars')
  const chain = 'flowchart TD\n' + Array.from({ length: 120 }, (_, i) => `  M${i}-->M${i + 1}`).join('\n')
  check('the 120-edge chain is not refused', diagramProblem(chain) === null)
}

// ── A4-14: a header with nothing after it is an error, not a blank card ────
console.log('a header alone is an empty diagram')
{
  for (const [name, text] of Object.entries({
    'sequenceDiagram alone': 'sequenceDiagram',
    'flowchart TD alone': 'flowchart TD',
    'flowchart TD and a semicolon': 'flowchart TD;',
    'pie alone': 'pie',
    'pie with a title only': 'pie title Pets',
    'gantt alone': 'gantt',
    'classDiagram-v2 alone': 'classDiagram-v2',
    'a header under a comment and front matter': '---\ntitle: x\n---\n%% nothing yet\nsequenceDiagram\n\n',
    'Windows line endings': 'sequenceDiagram\r\n',
  })) {
    const p = diagramProblem(text)
    check(name, p !== null && p.title === 'Empty diagram', JSON.stringify(p))
  }
  for (const [name, text] of Object.entries({
    'a header and one line': 'sequenceDiagram\n  A->>B: hi',
    'a one-line flowchart': 'graph LR; A-->B',
    'a one-line sequence diagram': 'sequenceDiagram; A->>B: hi',
    'a header with its content on the next lines': 'flowchart TD\n  A --> B',
    'a diagram whose only content is a comment-looking text after a header': 'gantt\n  title x',
    'not a diagram at all (left to mermaid)': 'hello world',
    'nothing': '',
  })) check(name + ' is not « empty »', diagramProblem(text) === null || diagramProblem(text).title !== 'Empty diagram', JSON.stringify(diagramProblem(text)))
}

// ── A4-14: the error card keeps the parser's reason ────────────────────────
// The texts below are what mermaid 11.14.0 throws for the audit's samples (measured in the vendored bundle).
console.log('the error card says why')
{
  const parse = new Error("Parse error on line 3:\n...t TD  A -->  B -->> C [[\n---------------------^\nExpecting 'AMP', 'COLON', 'PIPE', 'TESTSTR', got 'TAGEND'")
  const e = explainError(parse)
  check('a parse error is titled in English', e.title === 'Invalid mermaid diagram', e.title)
  check('the line, the code, the caret and the reason all survive', /Parse error on line 3:/.test(e.detail) && /-\^/.test(e.detail) && /Expecting 'AMP'.*got 'TAGEND'/.test(e.detail), e.detail)
  check('it is no longer cut after its first line', e.detail.split('\n').length === 4)
  // In the real GUI the parser indents its last three lines by six spaces, and pads the code line on the right.
  const indented = explainError(new Error("Parse error on line 3:\n      ...t TD  A -->  B -->> C [[      \n      ---------------------^\n      Expecting 'AMP', got 'TAGEND'"))
  check('a common indent is dropped, the caret stays under its column', indented.detail === "Parse error on line 3:\n...t TD  A -->  B -->> C [[\n---------------------^\nExpecting 'AMP', got 'TAGEND'", JSON.stringify(indented.detail))
  check('no French', !/Diagramme|invalide —/.test(e.title + e.detail))

  const edges = explainError(new Error('Edge limit exceeded. 500 edges found, but the limit is 500.\n\nInitialize mermaid with maxEdges set to a higher number to allow more edges.\nYou cannot set this config via configuration inside the diagram as it is a secure config.\nYou have to call mermaid.initialize.'))
  check('another error keeps its first paragraph only', edges.detail === 'Edge limit exceeded. 500 edges found, but the limit is 500.', edges.detail)
  check('and gets a neutral title', edges.title === 'Mermaid could not draw this diagram')

  const unknown = explainError(new Error('No diagram type detected matching given configuration for text: foobarDiagram\n a --> b'))
  check('an unknown diagram type shows its message', /^No diagram type detected/.test(unknown.detail))

  const long = explainError(new Error('Parse error on line 2:\n' + 'x'.repeat(2000)))
  check('a very long reason is cut', long.detail.length <= 601 && long.detail.endsWith('…'), long.detail.length)
  check('an error with no message still says something', explainError(new Error('')).detail !== '' && explainError(undefined).detail !== '' && explainError('plain text').detail === 'plain text')
}

// ── A2-01: the words the card shows come in English, and in French for a French UI ──────────────────────
console.log('the card speaks English, and French for a French UI')
{
  check('the toggle reads « Code » while the diagram is shown, « Diagram » while the source is', toggleLabel(false) === 'Code' && toggleLabel(true) === 'Diagram', [toggleLabel(false), toggleLabel(true)])
  const parse = new Error('Parse error on line 3:\n...t TD  A -->  B -->> C [[\n---------------------^\nExpecting \'AMP\', got \'TAGEND\'')
  const chain = 'flowchart TD\n' + Array.from({ length: 5000 }, (_, i) => `  M${i}-->M${i + 1}`).join('\n')
  const en = [toggleLabel(true), diagramProblem(chain), diagramProblem('sequenceDiagram'), explainError(parse), explainError(new Error('boom: x')), explainError(undefined)]
  check('no French word in English', !/Diagramme|invalide|vide|trop grand|caract[eè]res|aucune|n.a pas/i.test(JSON.stringify(en)), JSON.stringify(en))
  say = (fr) => fr
  try {
    check('French: the toggle says « Diagramme »', toggleLabel(true) === 'Diagramme' && toggleLabel(false) === 'Code', [toggleLabel(false), toggleLabel(true)])
    const big = diagramProblem(chain)
    check('French: the oversized card', big.title === 'Diagramme trop grand pour être dessiné' && /^Ce diagramme compte 7\d\u00A0\d{3} caractères ; Mermaid en dessine jusqu’à 50\u00A0000 au plus\./.test(big.detail), JSON.stringify(big))
    check('French: the empty card', diagramProblem('sequenceDiagram').title === 'Diagramme vide')
    check('French: a parse error is titled in French, its reason stays the parser\'s own words', explainError(parse).title === 'Diagramme Mermaid invalide' && /Expecting 'AMP'.*got 'TAGEND'/.test(explainError(parse).detail))
    check('French: any other error gets a neutral French title', explainError(new Error('boom: x')).title === 'Mermaid n’a pas pu dessiner ce diagramme' && explainError(undefined).detail === 'Mermaid n’a donné aucune raison.')
  } finally { say = (fr, en) => en }
  check('...and English again afterwards', toggleLabel(true) === 'Diagram')
}

console.log('the shipped bundle carries the same code')
{
  const bundle = readFileSync(join(here, 'client', 'client.js'), 'utf8')
  const block = source.slice(begin, end).trim().split('\n').map((l) => l.trim()).filter((l) => l !== '')
  const flat = bundle.split('\n').map((l) => l.trim()).filter((l) => l !== '').join('\n')
  check('client/client.js contains the detection block (run `node scripts/build.mjs` after editing src/plugin.js)', flat.includes(block.join('\n')))
}

console.log(failed === 0 ? '\nOK' : `\n${failed} failure(s)`)
process.exit(failed === 0 ? 0 : 1)
