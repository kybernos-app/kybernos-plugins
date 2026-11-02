// The Account page's "Custom instructions" are written into `<DSH home>/AGENTS.md`, between two markers, so that DSH's own
// instruction loader hands them to every agent. The rest of the file is the person's: it must come out byte for byte.
//   node packages/kybernos-cloud/test-instructions.mjs
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CLOSE, HEADING, MAX_CHARS, OPEN, agentsFile, readInstructions, writeInstructions } from './instructions.mjs'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + detail))
  if (!ok) failed += 1
}
const home = mkdtempSync(join(tmpdir(), 'kb-instr-'))
const fresh = (name) => { const d = join(home, name); mkdirSync(d, { recursive: true }); return agentsFile(d) }

console.log('an absent file')
{
  const f = fresh('absent')
  const r = readInstructions(f)
  check('reads as an empty text, nothing present', r.ok === true && r.present === false && r.text === '', JSON.stringify(r))
  const w = writeInstructions(f, '   ')
  check('an empty text does not create the file', w.ok === true && w.changed === false && existsSync(f) === false)
  const w2 = writeInstructions(f, 'Be direct.\nShort sentences.')
  check('a text creates it, with the section only', w2.ok === true && w2.present === true && readFileSync(f, 'utf8') === OPEN + '\n' + HEADING + '\n\nBe direct.\nShort sentences.\n' + CLOSE + '\n')
  const r2 = readInstructions(f)
  check('and it reads back as typed', r2.ok === true && r2.text === 'Be direct.\nShort sentences.', JSON.stringify(r2))
}

console.log('a file that has rules of its own')
{
  const f = fresh('own')
  const own = '# My rules\n\nAlways answer in French.\n\n<!-- kybernos:force-proposition v1 -->\n## Force de proposition\nx\n<!-- /kybernos:force-proposition -->\n'
  writeFileSync(f, own)
  writeInstructions(f, 'First version')
  const after1 = readFileSync(f, 'utf8')
  check('the section goes at the end, the rest is untouched', after1.startsWith(own) && after1.includes(OPEN) && after1.endsWith(CLOSE + '\n'))
  const tail = '\n## After\nkept\n'
  writeFileSync(f, after1 + tail)
  const w = writeInstructions(f, 'Second version')
  const after2 = readFileSync(f, 'utf8')
  check('a new text replaces the section in place', w.changed === true && after2 === after1.replace('First version', 'Second version') + tail)
  check('the same text again changes nothing', writeInstructions(f, 'Second version').changed === false)
  const w3 = writeInstructions(f, '')
  const after3 = readFileSync(f, 'utf8')
  check('an emptied field removes the section and leaves the rest', w3.ok === true && w3.present === false && !after3.includes(OPEN) && after3.startsWith(own.trimEnd()) && after3.endsWith('kept\n'), JSON.stringify(after3))
  check('no temporary file is left behind', readdirSync(join(f, '..')).every((n) => !n.endsWith('.tmp')))
}

console.log('what is refused')
{
  const f = fresh('refused')
  writeFileSync(f, 'mine\n')
  check('a text over the cap', writeInstructions(f, 'x'.repeat(MAX_CHARS + 1)).error === 'too-long')
  check('the cap itself is accepted', writeInstructions(f, 'x'.repeat(MAX_CHARS)).ok === true)
  writeInstructions(f, '')
  check('a marker typed in the field', writeInstructions(f, 'a ' + CLOSE + ' b').error === 'reserved')
  check('a value that is not text', writeInstructions(f, null).error === 'bad-text' && writeInstructions(f, { a: 1 }).error === 'bad-text')
  check('none of that touched the file', readFileSync(f, 'utf8') === 'mine\n')
  const broken = 'mine\n' + OPEN + '\n' + HEADING + '\n\nhalf\n'
  writeFileSync(f, broken)
  check('an opening marker with no closing one is refused, never guessed', writeInstructions(f, 'x').error === 'markers-damaged' && readInstructions(f).error === 'markers-damaged')
  check('and the file is left as it was', readFileSync(f, 'utf8') === broken)
}

console.log('the shape of the file')
{
  const f = fresh('crlf')
  writeFileSync(f, '# Rules\r\n\r\nline\r\n')
  writeInstructions(f, 'one\ntwo')
  const raw = readFileSync(f, 'utf8')
  check('a Windows file keeps its line ends', raw.includes('\r\n') && !/[^\r]\n/.test(raw), JSON.stringify(raw))
  check('and reads back with plain ones', readInstructions(f).text === 'one\ntwo')
  const g = fresh('nonewline')
  writeFileSync(g, 'no trailing newline')
  writeInstructions(g, 'x')
  check('a file without a final newline gets a blank line before the section', readFileSync(g, 'utf8').startsWith('no trailing newline\n\n' + OPEN))
}

console.log('a linked AGENTS.md (dotfiles)')
{
  const real = join(home, 'dotfiles'); mkdirSync(real, { recursive: true })
  const target = join(real, 'agents.md')
  writeFileSync(target, 'from dotfiles\n')
  const dir = join(home, 'linked'); mkdirSync(dir, { recursive: true })
  const link = agentsFile(dir)
  symlinkSync(target, link)
  writeInstructions(link, 'through the link')
  check('the link is still a link', lstatSync(link).isSymbolicLink() === true)
  check('the target carries the section', readFileSync(target, 'utf8').includes('through the link') && readFileSync(target, 'utf8').startsWith('from dotfiles\n'))
}

rmSync(home, { recursive: true, force: true })
console.log(failed === 0 ? '\nOK' : `\n${failed} failure(s)`)
process.exit(failed === 0 ? 0 : 1)
