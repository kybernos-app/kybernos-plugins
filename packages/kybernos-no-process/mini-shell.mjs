// A small shell that runs inside the process: the STAND-IN used to prove the plumbing (bash tool -> sandbox -> subprocess -> shell) on a device without processes.
// It is not bash: a real interpreter (a bash written in JavaScript) replaces runShell() behind the same signature. File effects obey the sandbox policy.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, readdirSync, statSync, rmSync, copyFileSync, renameSync, existsSync, utimesSync, openSync, closeSync } from 'node:fs'
import { resolve, relative, isAbsolute, dirname, basename, join } from 'node:path'
import { tmpdir } from 'node:os'

const tokenize = (src) => {
  const toks = []
  let cur = null; let i = 0
  const push = () => { if (cur !== null) { toks.push({ w: cur }); cur = null } }
  while (i < src.length) {
    const c = src[i]
    if (c === ' ' || c === '\t' || c === '\n') { push(); i++; if (c === '\n') toks.push({ op: ';' }); continue }
    if (c === '\'') { const j = src.indexOf('\'', i + 1); if (j < 0) throw new Error('unterminated quote'); cur = (cur ?? '') + src.slice(i + 1, j); i = j + 1; continue }
    if (c === '"') {
      let j = i + 1; let s = ''
      while (j < src.length && src[j] !== '"') { if (src[j] === '\\' && '"$\\`'.includes(src[j + 1])) { s += src[j + 1]; j += 2 } else if (src[j] === '$') { const m = /^\$(\{\w+\}|\w+|\?|\([^)]*\))/.exec(src.slice(j)); if (m) { s += '\u0000' + m[0] + '\u0001'; j += m[0].length } else { s += '$'; j++ } } else { s += src[j]; j++ } }
      cur = (cur ?? '') + s; i = j + 1; continue
    }
    if (c === '\\') { cur = (cur ?? '') + (src[i + 1] ?? ''); i += 2; continue }
    if (c === '$') { const m = /^\$(\{\w+\}|\w+|\?|\([^)]*\))/.exec(src.slice(i)); if (m) { cur = (cur ?? '') + '\u0000' + m[0] + '\u0001'; i += m[0].length; continue } }
    if (c === ';') { push(); toks.push({ op: ';' }); i++; continue }
    if (c === '&' && src[i + 1] === '&') { push(); toks.push({ op: '&&' }); i += 2; continue }
    if (c === '|' && src[i + 1] === '|') { push(); toks.push({ op: '||' }); i += 2; continue }
    if (c === '|') { push(); toks.push({ op: '|' }); i++; continue }
    if (c === '>') { push(); if (src[i + 1] === '>') { toks.push({ op: '>>' }); i += 2 } else { toks.push({ op: '>' }); i++ } continue }
    if (c === '#' && cur === null) { while (i < src.length && src[i] !== '\n') i++; continue }
    cur = (cur ?? '') + c; i++
  }
  push()
  return toks
}

export const runShell = async (script, { cwd, env, out, err, signal, policy }) => {
  const mode = policy?.mode ?? 'danger-full-access'
  const root = policy?.root ?? cwd
  const vars = { ...(env ?? {}) }
  let pwd = cwd; let last = 0
  const abs = (p) => (isAbsolute(p) ? p : resolve(pwd, p))
  const inside = (p, base) => { const r = relative(base, p); return r === '' || (!r.startsWith('..') && !isAbsolute(r)) }
  const mayWrite = (p) => mode === 'danger-full-access' || (mode === 'workspace-write' && (inside(p, root) || inside(p, tmpdir()) || p === '/dev/null'))
  const denied = (p, e) => { e(`bash: ${p}: Operation not permitted (sandbox ${mode})\n`); return 1 }
  const expand = async (w) => {
    let s = w
    const subs = []
    s = s.replace(/\u0000(\$[^\u0001]*)\u0001/g, (_, ref) => { subs.push(ref); return '\u0002' + (subs.length - 1) + '\u0002' })
    const vals = []
    for (const ref of subs) {
      if (ref === '$?') vals.push(String(last))
      else if (ref.startsWith('$(')) { let o = ''; await runShell(ref.slice(2, -1), { cwd: pwd, env: vars, out: (x) => { o += x }, err, signal, policy }); vals.push(o.replace(/\n+$/, '')) }
      else { const k = ref.replace(/^\$\{?|\}$/g, ''); vals.push(vars[k] ?? '') }
    }
    return s.replace(/\u0002(\d+)\u0002/g, (_, n) => vals[Number(n)])
  }
  const glob = (p) => {
    if (!/[*?]/.test(p)) return [p]
    const dir = dirname(p); const re = new RegExp('^' + basename(p).replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$')
    try { const hits = readdirSync(abs(dir)).filter((n) => re.test(n) && !n.startsWith('.')).sort().map((n) => (dir === '.' ? n : join(dir, n))); return hits.length ? hits : [p] } catch { return [p] }
  }
  const builtins = {
    echo: async (a, io) => { const n = a[0] === '-n'; io.out((n ? a.slice(1) : a).join(' ') + (n ? '' : '\n')); return 0 },
    pwd: async (a, io) => { io.out(pwd + '\n'); return 0 },
    cd: async (a, io) => { const t = abs(a[0] ?? vars.HOME ?? root); try { if (!statSync(t).isDirectory()) throw new Error(); pwd = t; return 0 } catch { io.err(`bash: cd: ${a[0]}: No such file or directory\n`); return 1 } },
    true: async () => 0, false: async () => 1,
    export: async (a) => { for (const kv of a) { const i = kv.indexOf('='); if (i > 0) vars[kv.slice(0, i)] = kv.slice(i + 1) } return 0 },
    env: async (a, io) => { for (const [k, v] of Object.entries(vars)) io.out(`${k}=${v}\n`); return 0 },
    ls: async (a, io) => { const files = a.filter((x) => !x.startsWith('-')); const all = a.some((x) => /^-\w*a/.test(x)); let code = 0; for (const f of files.length ? files : ['.']) { try { const t = abs(f); const st = statSync(t); if (st.isDirectory()) io.out(readdirSync(t).filter((n) => all || !n.startsWith('.')).sort().join('\n') + '\n'); else io.out(f + '\n') } catch { io.err(`ls: ${f}: No such file or directory\n`); code = 1 } } return code },
    cat: async (a, io) => { if (a.length === 0) { io.out(io.stdin); return 0 } let code = 0; for (const f of a) { try { io.out(readFileSync(abs(f), 'utf8')) } catch { io.err(`cat: ${f}: No such file or directory\n`); code = 1 } } return code },
    mkdir: async (a, io) => { let code = 0; for (const f of a.filter((x) => !x.startsWith('-'))) { const t = abs(f); if (!mayWrite(t)) { code = denied(f, io.err); continue } try { mkdirSync(t, { recursive: a.includes('-p') }) } catch (e) { io.err(`mkdir: ${f}: ${e.code === 'EEXIST' ? 'File exists' : e.message}\n`); code = 1 } } return code },
    touch: async (a, io) => { let code = 0; for (const f of a) { const t = abs(f); if (!mayWrite(t)) { code = denied(f, io.err); continue } if (existsSync(t)) utimesSync(t, new Date(), new Date()); else closeSync(openSync(t, 'w')) } return code },
    rm: async (a, io) => { let code = 0; const force = a.some((x) => /^-\w*f/.test(x)); const rec = a.some((x) => /^-\w*[rR]/.test(x)); for (const f of a.filter((x) => !x.startsWith('-'))) { const t = abs(f); if (!mayWrite(t)) { code = denied(f, io.err); continue } try { rmSync(t, { recursive: rec, force }) } catch (e) { io.err(`rm: ${f}: ${e.code === 'ENOENT' ? 'No such file or directory' : e.message}\n`); code = 1 } } return code },
    cp: async (a, io) => { const f = a.filter((x) => !x.startsWith('-')); const [s, d] = f; const t = abs(d); if (!mayWrite(t)) return denied(d, io.err); try { copyFileSync(abs(s), t); return 0 } catch (e) { io.err(`cp: ${e.message}\n`); return 1 } },
    mv: async (a, io) => { const [s, d] = a; const t = abs(d); if (!mayWrite(t) || !mayWrite(abs(s))) return denied(d, io.err); try { renameSync(abs(s), t); return 0 } catch (e) { io.err(`mv: ${e.message}\n`); return 1 } },
    head: async (a, io) => { const n = a[0] === '-n' ? Number(a[1]) : 10; const rest = a[0] === '-n' ? a.slice(2) : a; const t = rest.length ? readFileSync(abs(rest[0]), 'utf8') : io.stdin; io.out(t.split('\n').slice(0, n).join('\n') + '\n'); return 0 },
    tail: async (a, io) => { const n = a[0] === '-n' ? Number(a[1]) : 10; const rest = a[0] === '-n' ? a.slice(2) : a; const t = (rest.length ? readFileSync(abs(rest[0]), 'utf8') : io.stdin).replace(/\n$/, ''); io.out(t.split('\n').slice(-n).join('\n') + '\n'); return 0 },
    wc: async (a, io) => { const t = a.filter((x) => !x.startsWith('-')).length ? readFileSync(abs(a.filter((x) => !x.startsWith('-'))[0]), 'utf8') : io.stdin; io.out(String(t.split('\n').length - (t.endsWith('\n') ? 1 : 0)) + '\n'); return 0 },
    grep: async (a, io) => { const pat = a.find((x) => !x.startsWith('-')); const files = a.filter((x) => !x.startsWith('-')).slice(1); const re = new RegExp(pat, a.includes('-i') ? 'i' : ''); const lines = (files.length ? files.flatMap((f) => readFileSync(abs(f), 'utf8').split('\n').map((l) => (files.length > 1 ? f + ':' + l : l))) : io.stdin.split('\n')).filter((l) => l !== ''); const hits = lines.filter((l) => re.test(l)); io.out(hits.map((l) => l + '\n').join('')); return hits.length ? 0 : 1 },
    test: async (a) => { const [f, p] = a; if (f === '-f') return existsSync(abs(p)) && statSync(abs(p)).isFile() ? 0 : 1; if (f === '-d') return existsSync(abs(p)) && statSync(abs(p)).isDirectory() ? 0 : 1; if (f === '-e') return existsSync(abs(p)) ? 0 : 1; return a.length === 3 && a[1] === '=' ? (a[0] === a[2] ? 0 : 1) : 1 },
    date: async (a, io) => { io.out(new Date().toISOString() + '\n'); return 0 },
    sleep: async (a) => { await new Promise((r) => setTimeout(r, Math.min(Number(a[0] ?? 0), 30) * 1000)); return 0 },
  }
  builtins['['] = (a, io) => builtins.test(a.slice(0, -1), io)
  const runSimple = async (words, redirs, stdin, outFn) => {
    const argv = []
    for (const w of words) for (const x of glob(await expand(w))) argv.push(x)
    while (argv.length && /^\w+=/.test(argv[0]) && !argv[1]) { const i = argv[0].indexOf('='); vars[argv[0].slice(0, i)] = argv[0].slice(i + 1); argv.shift() }
    if (argv.length === 0) return 0
    let target = outFn
    let fileOut = null
    for (const r of redirs) { const p = abs(await expand(r.target)); if (!mayWrite(p)) return denied(r.target, err); fileOut = { p, append: r.op === '>>' } }
    let buf = ''
    if (fileOut) target = (s) => { buf += s }
    const fn = builtins[argv[0]]
    let code
    if (!fn) { err(`bash: ${argv[0]}: command not found (no processes on this device)\n`); code = 127 }
    else { try { code = await fn(argv.slice(1), { out: target, err, stdin }) } catch (e) { err(`bash: ${argv[0]}: ${e.message}\n`); code = 1 } }
    if (fileOut) { try { (fileOut.append ? appendFileSync : writeFileSync)(fileOut.p, buf) } catch (e) { err(`bash: ${fileOut.p}: ${e.message}\n`); code = 1 } }
    return code
  }
  let toks
  try { toks = tokenize(script) } catch (e) { err(`bash: syntax error: ${e.message}\n`); return 2 }
  // split into and-or lists separated by ';', each a pipeline sequence
  let i = 0
  const readPipeline = () => {
    const cmds = []; let words = []; let redirs = []
    while (i < toks.length) {
      const t = toks[i]
      if (t.op === '|') { cmds.push({ words, redirs }); words = []; redirs = []; i++; continue }
      if (t.op === '>' || t.op === '>>') { redirs.push({ op: t.op, target: toks[i + 1]?.w ?? '' }); i += 2; continue }
      if (t.op) break
      words.push(t.w); i++
    }
    cmds.push({ words, redirs })
    return cmds
  }
  while (i < toks.length) {
    if (signal?.aborted) return 130
    if (toks[i].op === ';') { i++; continue }
    const pipe = readPipeline()
    let stdin = ''
    for (let k = 0; k < pipe.length; k++) {
      const lastCmd = k === pipe.length - 1
      let piped = ''
      last = await runSimple(pipe[k].words, pipe[k].redirs, stdin, lastCmd ? out : (s) => { piped += s })
      stdin = piped
    }
    const op = toks[i]?.op
    if (op === '&&') { i++; if (last !== 0) { while (i < toks.length && toks[i].op !== ';' && toks[i].op !== '||') i++ } continue }
    if (op === '||') { i++; if (last === 0) { while (i < toks.length && toks[i].op !== ';' && toks[i].op !== '&&') i++ } continue }
  }
  return last
}
