// A ripgrep stand-in that runs inside the process: the two argv shapes dsh-tool-fs-search builds (`--files --glob=…` for glob, `--json --regexp=…` for grep).
// Not a general ripgrep: unknown flags are refused, so a tool that starts passing a new one fails loudly instead of silently returning nothing.
import { readdirSync, readFileSync, statSync, lstatSync, existsSync } from 'node:fs'
import { join, isAbsolute, resolve, basename } from 'node:path'

// gitignore-style glob -> RegExp on a '/'-separated path relative to the search root. No '/' (apart from a trailing one) = matches the name at any depth.
export const globToRegex = (glob) => {
  let g = glob
  const dirOnly = g.endsWith('/')
  if (dirOnly) g = g.slice(0, -1)
  const anchored = g.includes('/')
  if (g.startsWith('/')) g = g.slice(1)
  let re = ''
  const inner = (s) => {
    let o = ''
    for (let i = 0; i < s.length; i++) {
      const c = s[i]
      if (c === '*') {
        if (s[i + 1] === '*') {
          if (s[i + 2] === '/') { o += '(?:.*/)?'; i += 2 } else { o += '.*'; i += 1 }
        } else o += '[^/]*'
      } else if (c === '?') o += '[^/]'
      else if (c === '[') {
        const j = s.indexOf(']', i + 2)
        if (j === -1) o += '\\['
        else { let cls = s.slice(i + 1, j); if (cls.startsWith('!')) cls = '^' + cls.slice(1); o += '[' + cls.replace(/\\/g, '\\\\') + ']'; i = j }
      } else if (c === '{') {
        const j = s.indexOf('}', i)
        if (j === -1) o += '\\{'
        else { o += '(?:' + s.slice(i + 1, j).split(',').map(inner).join('|') + ')'; i = j }
      } else if (c === '\\' && i + 1 < s.length) { o += s[i + 1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); i += 1 }
      else o += c.replace(/[.*+?^${}()|[\]\\/]/g, (m) => (m === '/' ? '/' : '\\' + m))
    }
    return o
  }
  re = inner(g)
  return { re: new RegExp(anchored ? '^' + re + '$' : '^(?:.*/)?' + re + '$'), dirOnly }
}

const jsRegex = (pattern) => {
  let p = pattern; let flags = ''
  const lead = /^\(\?([imsx]+)\)/.exec(p)
  if (lead) { p = p.slice(lead[0].length); for (const f of lead[1]) if ('ims'.includes(f) && !flags.includes(f)) flags += f }
  p = p.replace(/\\A/g, '^').replace(/\\z/g, '$')
  const posix = { alpha: 'a-zA-Z', digit: '0-9', alnum: 'a-zA-Z0-9', upper: 'A-Z', lower: 'a-z', space: '\\s', punct: '!-\\/:-@\\[-`{-~', word: '\\w', xdigit: '0-9a-fA-F' }
  p = p.replace(/\[:(\w+):\]/g, (m, n) => posix[n] ?? m)
  try { return new RegExp(p, flags + 'u') } catch { return new RegExp(p, flags) }
}

const readIgnore = (dir) => {
  const rules = []
  for (const name of ['.gitignore', '.ignore', '.rgignore']) {
    const f = join(dir, name)
    if (!existsSync(f)) continue
    for (const raw of readFileSync(f, 'utf8').split(/\r?\n/)) {
      const line = raw.trim()
      if (line === '' || line.startsWith('#')) continue
      const neg = line.startsWith('!')
      const { re, dirOnly } = globToRegex(neg ? line.slice(1) : line)
      rules.push({ re, neg, dirOnly })
    }
  }
  return rules
}

export const runRg = async (argv, cwd, out, err, signal) => {
  const f = { files: false, json: false, regexps: [], globs: [], sortModified: false, noIgnore: false, hidden: false, paths: [] }
  let rest = false
  for (const a of argv.slice(1)) {
    if (rest) { f.paths.push(a); continue }
    if (a === '--') rest = true
    else if (a === '--no-config') continue
    else if (a === '--files') f.files = true
    else if (a === '--json') f.json = true
    else if (a === '--no-ignore') f.noIgnore = true
    else if (a === '--hidden') f.hidden = true
    else if (a === '--sort=modified') f.sortModified = true
    else if (a.startsWith('--regexp=')) f.regexps.push(a.slice(9))
    else if (a.startsWith('--glob=')) f.globs.push(a.slice(7))
    else { err(`rg: unrecognized flag ${a}\n`); return 2 }
  }
  let rx = null
  if (!f.files) {
    if (f.regexps.length === 0) { err('rg: no pattern given\n'); return 2 }
    try { rx = jsRegex(f.regexps.length === 1 ? f.regexps[0] : f.regexps.map((r) => '(?:' + r + ')').join('|')) } catch (e) { err('regex parse error:\n    ' + f.regexps[0] + '\nerror: ' + e.message + '\n'); return 2 }
  }
  const neg = f.globs.filter((g) => g.startsWith('!')).map((g) => globToRegex(g.slice(1)))
  const pos = f.globs.filter((g) => !g.startsWith('!')).map((g) => globToRegex(g))
  const found = []
  const roots = f.paths.length > 0 ? f.paths : ['']
  for (const root of roots) {
    const abs = root === '' ? cwd : (isAbsolute(root) ? root : resolve(cwd, root))
    let st
    try { st = statSync(abs) } catch { err(`rg: ${root}: No such file or directory (os error 2)\n`); continue }
    const show = (rel) => (root === '' ? rel : (rel === '' ? root : root.endsWith('/') ? root + rel : root + '/' + rel))
    if (!st.isDirectory()) { found.push({ abs, display: root, mtime: st.mtimeMs }); continue }
    const walk = (dir, rel, ignoreStack) => {
      if (signal?.aborted) return
      let entries
      try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
      entries.sort((a, b) => (a.name < b.name ? -1 : 1))
      const stack = f.noIgnore ? ignoreStack : [...ignoreStack, { base: rel, rules: readIgnore(dir) }]
      for (const e of entries) {
        if (!f.hidden && e.name.startsWith('.')) continue
        const r = rel === '' ? e.name : rel + '/' + e.name
        const isDir = e.isDirectory()
        if (e.isSymbolicLink()) continue
        if (neg.some((n) => n.re.test(r) && (!n.dirOnly || isDir))) continue
        if (!f.noIgnore) {
          let ignored = false
          for (const layer of stack) {
            const sub = layer.base === '' ? r : r.slice(layer.base.length + 1)
            for (const rule of layer.rules) if (rule.re.test(sub) && (!rule.dirOnly || isDir)) ignored = !rule.neg
          }
          if (ignored) continue
        }
        if (isDir) { walk(join(dir, e.name), r, stack); continue }
        if (!e.isFile()) continue
        if (pos.length > 0 && !pos.some((p) => p.re.test(r))) continue
        let m = 0
        try { m = lstatSync(join(dir, e.name)).mtimeMs } catch { /* vanished */ }
        found.push({ abs: join(dir, e.name), display: show(r), mtime: m })
      }
    }
    walk(abs, '', [])
  }
  if (f.files) {
    if (f.sortModified) found.sort((a, b) => a.mtime - b.mtime)
    for (const x of found) out(x.display + '\n')
    return found.length > 0 ? 0 : 1
  }
  let total = 0
  for (const x of found) {
    if (signal?.aborted) break
    let buf
    try { const s = statSync(x.abs); if (s.size > 50 * 1024 * 1024) continue; buf = readFileSync(x.abs) } catch { continue }
    if (buf.subarray(0, 8192).includes(0)) continue
    const text = buf.toString('utf8')
    const lines = text.split('\n'); if (lines[lines.length - 1] === '') lines.pop()
    let began = false; let offset = 0; let n = 0
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      rx.lastIndex = 0
      const m = rx.exec(line)
      if (m !== null) {
        if (!began) { out(JSON.stringify({ type: 'begin', data: { path: { text: x.display } } }) + '\n'); began = true }
        out(JSON.stringify({ type: 'match', data: { path: { text: x.display }, lines: { text: line + '\n' }, line_number: i + 1, absolute_offset: offset, submatches: [{ match: { text: m[0] }, start: m.index, end: m.index + m[0].length }] } }) + '\n')
        n += 1
      }
      offset += Buffer.byteLength(line) + 1
    }
    if (began) { out(JSON.stringify({ type: 'end', data: { path: { text: x.display }, stats: { matches: n } } }) + '\n'); total += n }
  }
  out(JSON.stringify({ type: 'summary', data: { stats: { matches: total, searches: found.length } } }) + '\n')
  return total > 0 ? 0 : 1
}
void basename
