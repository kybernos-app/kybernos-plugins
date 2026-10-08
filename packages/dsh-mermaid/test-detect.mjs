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
const looksLikeMermaid = new Function(source.slice(begin, end) + '\nreturn looksLikeMermaid')()

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

console.log('the shipped bundle carries the same code')
{
  const bundle = readFileSync(join(here, 'client', 'client.js'), 'utf8')
  const block = source.slice(begin, end).trim().split('\n').map((l) => l.trim()).filter((l) => l !== '')
  const flat = bundle.split('\n').map((l) => l.trim()).filter((l) => l !== '').join('\n')
  check('client/client.js contains the detection block (run `node scripts/build.mjs` after editing src/plugin.js)', flat.includes(block.join('\n')))
}

console.log(failed === 0 ? '\nOK' : `\n${failed} failure(s)`)
process.exit(failed === 0 ? 0 : 1)
