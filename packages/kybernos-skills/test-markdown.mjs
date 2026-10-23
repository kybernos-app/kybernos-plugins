#!/usr/bin/env node
/** SKILL.md is shown as a person reads it (owner's question, 2026-10-23: « pourquoi on n'a pas le rendu du markdown ici ? »): a safe subset of Markdown drawn as React
 *  elements, with the file as it is one click away. The renderer lives in the browser bundle, so it is cut out of client.js and run here with a stand-in for `h`.
 *  Usage: node packages/kybernos-skills/test-markdown.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, 'client.js'), 'utf8')

const from = src.indexOf('const mdInline = ')
const to = src.indexOf('// `kb` is the test hook the raw block always had')
assert.ok(from > 0 && to > from, 'the renderer was found')
const h = (tag, props, ...kids) => ({ tag, props: props === null || props === undefined ? {} : props, kids: kids.flat(Infinity).filter((x) => x !== null && x !== undefined) })
const text = (n) => (typeof n === 'string' ? n : n.kids.map(text).join(''))
const all = (n, out = []) => { if (typeof n === 'string') return out; out.push(n); n.kids.forEach((k) => all(k, out)); return out }
const { mdRender } = new Function('h', src.slice(from, to) + '\nreturn { mdRender }')(h)
const render = (md) => mdRender(md).filter(Boolean)
const tags = (nodes) => nodes.flatMap((n) => all(n)).map((n) => n.tag)

const doc = `---
name: docx
description: "Use this skill whenever the user wants \\"Word\\" files"
license: Proprietary
---

# DOCX creation

A \`.docx\` is a **ZIP** archive. See [the docs](https://example.com/x) and ![logo](https://tracker.example/p.png).

| Task | Approach |
|---|---|
| **Create** | Write a \`docx\` script |
| Read | \`pandoc\` |

> Script paths are relative.

- one
  - nested
- two
1. first
2. second

\`\`\`bash
npm i docx
\`\`\`
<!-- hidden comment -->
`
const nodes = render(doc)
const kinds = nodes.map((n) => n.tag + (n.props.className ? '.' + n.props.className : ''))
assert.deepEqual(kinds, ['dl.fm', 'div.h h1', 'p', 'div.tw', 'blockquote', 'ul', 'ol', 'pre', 'p'])
ok('front matter, heading, paragraph, table, quote, two lists, code block and the last line each become one block')

const fm = nodes[0]
assert.deepEqual(fm.kids.map(text), ['name', 'docx', 'description', 'Use this skill whenever the user wants "Word" files', 'license', 'Proprietary'])
ok('the front matter is a small properties box (quotes stripped)')

const para = nodes[2]
assert.equal(text(para), 'A .docx is a ZIP archive. See the docs and logo.')
assert.deepEqual(all(para).map((n) => n.tag), ['p', 'code', 'strong', 'a'])
assert.equal(all(para).find((n) => n.tag === 'a').props.href, 'https://example.com/x')
ok('inline code, bold and an https link are drawn; an image is never loaded (its alt text stays)')

const table = all(nodes[3])
assert.deepEqual(table.filter((n) => n.tag === 'th').map(text), ['Task', 'Approach'])
assert.deepEqual(table.filter((n) => n.tag === 'td').map(text), ['Create', 'Write a docx script', 'Read', 'pandoc'])
ok('a table keeps its header and its cells, with the inline marks inside them')

assert.deepEqual(all(nodes[5]).filter((n) => n.tag === 'li').map(text), ['one' + 'nested', 'nested', 'two'])
assert.equal(tags([nodes[5]]).filter((t) => t === 'ul').length, 2, 'the sub-list is nested')
assert.deepEqual(all(nodes[6]).filter((n) => n.tag === 'li').map(text), ['first', 'second'])
ok('lists nest by indentation, and a numbered list after a bulleted one is its own list')

assert.equal(text(nodes[8]), '<!-- hidden comment -->')
ok('an HTML comment is shown as text: formatting hides nothing')

// What a hostile SKILL.md can try
const hostile = render('<script>alert(1)</script>\n\n[click](javascript:alert(1)) [rel](../x.md) [ok](http://a.example)\n\n<img src=x onerror=alert(1)>\n\n![p](https://t.example/p.png)')
const flat = hostile.flatMap((n) => all(n))
assert.ok(flat.every((n) => ['p', 'a'].indexOf(n.tag) >= 0), 'only paragraphs and anchors come out: ' + [...new Set(flat.map((n) => n.tag))].join(','))
assert.deepEqual(flat.filter((n) => n.tag === 'a').map((n) => n.props.href), ['http://a.example'])
assert.ok(text(hostile[0]) === '<script>alert(1)</script>' && text(hostile[2]) === '<img src=x onerror=alert(1)>')
assert.ok(flat.filter((n) => n.tag === 'a').every((n) => n.props.rel === 'noopener noreferrer' && n.props.target === '_blank'))
ok('HTML stays text, a javascript: or relative link is not an anchor, an https link opens apart, no image is loaded')

// A start cut in the middle (the preview is the first part of the file), and rubbish
assert.doesNotThrow(() => render('---\nname: x\n\n```js\nconst a = 1\n\n| a | b |\n|---'))
assert.doesNotThrow(() => render('*'.repeat(5000) + '`'.repeat(3000) + '['.repeat(2000) + '| |\n'.repeat(500) + '- x\n'.repeat(2000)))
const big = 'word **bold** `code` [l](https://a.example) _it_\n'.repeat(900)
const t0 = Date.now()
render(big)
assert.ok(Date.now() - t0 < 1500, 'a 40 KB file renders in well under two seconds (' + (Date.now() - t0) + ' ms)')
ok('a cut-off start, unclosed fences, and 40 KB of marks render without throwing and quickly')

// Where it is used: the three places that showed the file as a monospace block, each with the switch back to the raw file
const uses = [...src.matchAll(/h\(SkillText, \{ text: ([^,]+), truncated: ([^,]+), kb: '([a-z-]+)' \}\)/g)].map((m) => m[3]).sort()
assert.deepEqual(uses, ['preview-text', 'preview-text', 'skill-text'])
const comp = src.slice(src.indexOf('const SkillText = '), src.indexOf('const STR = {'))
assert.ok(comp.includes("'data-kb': 'md-switch'") && comp.includes("t('md.raw')") && comp.includes("t('md.rendered')") && comp.includes("h('pre', { className: 'kb-local-body', 'data-kb': props.kb }, text)"))
assert.ok(/catch \(e\) \{ body = h\('pre'/.test(comp), 'a renderer that fails falls back to the raw text')
ok('the pick page, the Discover panel and the installed skill panel use it, each with a « Raw text » switch and a fallback to the raw file')

console.log(pass + ' tests passed')
