// Test helper (not a test: the name does not start with "test"). Finds the one mistake that makes a React component crash on its SECOND render:
// a hook call (`React.useEffect(...)`, `useState(...)`, any `useXxx(...)`) placed AFTER a `return` of the same function. The first render takes the early
// `return`, so it calls fewer hooks than the render that does not; React throws « Rendered fewer hooks than expected » (error #300) or « more hooks »
// (#310) and the engine drops the slot entry for good (recette L1-43: the new-chat tiles and the Cloud Computer row vanished after the first message).
//
// It is a scanner, not a parser: it cuts the source into tokens (strings, templates, regular expressions and comments skipped), tells which `{` open
// a function body, and for each function body compares the end of its first `return` statement with the position of its own hook calls. The code
// style of this repo (no semicolons, arrow functions) is what it is tuned for; `selfTest()` pins the shapes it must flag and the ones it must leave alone.

const REGEX_AFTER_KW = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'void', 'delete', 'new', 'throw', 'instanceof', 'yield', 'await'])
const OPERAND_KW = new Set(['typeof', 'new', 'void', 'delete', 'await', 'in', 'instanceof', 'of', 'return', 'throw', 'case', 'yield', 'else', 'do'])
const CONTROL = new Set(['if', 'for', 'while', 'switch', 'catch', 'with'])
const CONTINUES = new Set(['.', '?', ':', '+', '-', '*', '/', '%', '&', '|', '^', '=', '<', '>', ',', '(', '[', '=>'])

function tokenize (src) {
  const toks = []
  const n = src.length
  let i = 0
  let nl = false
  const isIdStart = (c) => /[A-Za-z_$ -￿]/.test(c)
  const isId = (c) => /[A-Za-z0-9_$ -￿]/.test(c)
  const prevAllowsRegex = () => {
    const p = toks[toks.length - 1]
    if (p === undefined) return true
    if (p.t === 'id') return REGEX_AFTER_KW.has(p.v)
    if (p.t === 'num' || p.t === 'str' || p.t === 'tpl' || p.t === 're') return false
    return !(p.v === ')' || p.v === ']' || p.v === '}')
  }
  const skipString = (q) => {
    i++
    while (i < n && src[i] !== q) { if (src[i] === '\\') i++; i++ }
    i++
  }
  const skipBalanced = () => {
    let depth = 1
    while (i < n && depth > 0) {
      const c = src[i]
      if (c === '\'' || c === '"') { skipString(c); continue }
      if (c === '`') { skipTemplate(); continue }
      if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue }
      if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2); i = i < 0 ? n : i + 2; continue }
      if (c === '{') depth++
      else if (c === '}') depth--
      i++
    }
  }
  function skipTemplate () {
    i++
    while (i < n && src[i] !== '`') {
      if (src[i] === '\\') { i += 2; continue }
      if (src[i] === '$' && src[i + 1] === '{') { i += 2; skipBalanced(); continue }
      i++
    }
    i++
  }
  const push = (t, v, pos) => { toks.push({ t, v, pos, nl }); nl = false }
  while (i < n) {
    const c = src[i]
    if (c === '\n') { nl = true; i++; continue }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue }
    if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2)
      const stop = e < 0 ? n : e + 2
      if (src.slice(i, stop).includes('\n')) nl = true
      i = stop
      continue
    }
    const pos = i
    if (c === '\'' || c === '"') { skipString(c); push('str', '', pos); continue }
    if (c === '`') { skipTemplate(); push('tpl', '', pos); continue }
    if (c === '/' && prevAllowsRegex()) {
      i++
      let cls = false
      while (i < n && (src[i] !== '/' || cls) && src[i] !== '\n') {
        if (src[i] === '\\') i++
        else if (src[i] === '[') cls = true
        else if (src[i] === ']') cls = false
        i++
      }
      i++
      while (i < n && isId(src[i])) i++
      push('re', '', pos)
      continue
    }
    if (isIdStart(c)) { let j = i + 1; while (j < n && isId(src[j])) j++; push('id', src.slice(i, j), pos); i = j; continue }
    if (/[0-9]/.test(c)) { let j = i + 1; while (j < n && /[0-9A-Za-z_.]/.test(src[j])) j++; push('num', src.slice(i, j), pos); i = j; continue }
    if (c === '=' && src[i + 1] === '>') { push('p', '=>', pos); i += 2; continue }
    push('p', c, pos)
    i++
  }
  return toks
}

/** Index of the last token of the expression or statement that starts at `from`: it stops at a closing bracket of the enclosing level, at `;`, at `,` when
 *  `stopOnComma`, or at a line break the language would read as the end of the statement (the next line cannot continue it). */
function endOfExpr (toks, from, stopOnComma) {
  let depth = 0
  for (let j = from; j < toks.length; j++) {
    const t = toks[j]
    if (t.t === 'p') {
      if (t.v === '(' || t.v === '[' || t.v === '{') { depth++; continue }
      if (t.v === ')' || t.v === ']' || t.v === '}') { if (depth === 0) return j - 1; depth--; continue }
      if (depth === 0 && (t.v === ';' || (stopOnComma === true && t.v === ','))) return j - 1
    }
    if (depth === 0 && j > from && t.nl === true) {
      const p = toks[j - 1]
      const complete = (p.t === 'id' && !OPERAND_KW.has(p.v)) || p.t === 'num' || p.t === 'str' || p.t === 'tpl' || p.t === 're' || (p.t === 'p' && (p.v === ')' || p.v === ']' || p.v === '}'))
      const goesOn = (t.t === 'p' && CONTINUES.has(t.v)) || t.t === 'tpl' || (t.t === 'id' && (t.v === 'in' || t.v === 'instanceof'))
      if (complete && !goesOn) return j - 1
    }
  }
  return toks.length - 1
}

/** `{ violations: [{ hook, hookPos, returnPos, fnPos }], balanced, hookFns }` for a JavaScript source (`hookFns`: how many functions call a hook, to prove the scan saw them). */
export function scanHookOrder (src) {
  const toks = tokenize(src)
  const parens = [] // one entry per open '(': the two tokens before it
  const braces = [] // one entry per open '{': the function record it opens, or null
  const stack = [] // the functions being read, the innermost last (a function with an expression body ends with its expression)
  const out = []
  let hookFns = 0
  let lastClose = null // the '(' ... ')' pair that has just been closed, when the very next token is a '{'
  const finish = (rec) => {
    if (rec.hooks.length > 0) hookFns += 1
    for (const hk of rec.hooks) {
      const gone = rec.returns.find((r) => r.endPos < hk.pos)
      if (gone !== undefined) out.push({ hook: hk.name, hookPos: hk.pos, returnPos: gone.pos, fnPos: rec.pos })
    }
  }
  for (let k = 0; k < toks.length; k++) {
    while (stack.length > 0 && stack[stack.length - 1].endIdx !== undefined && k > stack[stack.length - 1].endIdx) finish(stack.pop())
    const tk = toks[k]
    const prev = toks[k - 1]
    if (tk.t === 'p') {
      if (tk.v === '(') { parens.push({ prev, prev2: toks[k - 2] }); lastClose = null; continue }
      if (tk.v === ')') { lastClose = parens.pop() || null; continue }
      if (tk.v === '=>') {
        lastClose = null
        const nx = toks[k + 1]
        if (nx !== undefined && !(nx.t === 'p' && nx.v === '{')) stack.push({ pos: tk.pos, returns: [], hooks: [], endIdx: endOfExpr(toks, k + 1, true) })
        continue
      }
      if (tk.v === '{') {
        let isFn = false
        if (prev !== undefined && prev.t === 'p' && prev.v === '=>') isFn = true
        else if (prev !== undefined && prev.t === 'p' && prev.v === ')' && lastClose !== null) {
          const a = lastClose.prev
          const b = lastClose.prev2
          if (a !== undefined && a.t === 'id') {
            if (a.v === 'function' || (b !== undefined && b.t === 'id' && b.v === 'function')) isFn = true
            else if (!CONTROL.has(a.v)) isFn = true // a method: name(args) {
          }
        } else if (prev !== undefined && prev.t === 'id' && prev.v === 'function') isFn = true
        let rec = null
        if (isFn) { rec = { pos: tk.pos, returns: [], hooks: [] }; stack.push(rec) }
        braces.push(rec)
        lastClose = null
        continue
      }
      if (tk.v === '}') {
        const rec = braces.pop()
        if (rec !== undefined && rec !== null) { const top = stack.pop(); if (top !== undefined) finish(top) }
        lastClose = null
        continue
      }
      lastClose = null
      continue
    }
    lastClose = null
    if (tk.t !== 'id') continue
    const cur = stack[stack.length - 1]
    if (cur === undefined) continue
    if (tk.v === 'return') {
      const nx = toks[k + 1]
      const bare = nx === undefined || nx.nl === true || (nx.t === 'p' && (nx.v === ';' || nx.v === '}'))
      const end = bare ? tk : toks[endOfExpr(toks, k + 1, false)]
      cur.returns.push({ pos: tk.pos, endPos: end.pos })
      continue
    }
    if (/^use[A-Z0-9]/.test(tk.v)) {
      const nx = toks[k + 1]
      if (nx === undefined || nx.t !== 'p' || nx.v !== '(') continue
      if (prev !== undefined && prev.t === 'p' && prev.v === '.') { const owner = toks[k - 2]; if (!(owner !== undefined && owner.t === 'id' && owner.v === 'React')) continue }
      // `useThing (a) { ... }` defines a method called like a hook; it does not call one.
      let depth = 0
      let close = k + 1
      for (; close < toks.length; close++) {
        const c = toks[close]
        if (c.t === 'p' && c.v === '(') depth++
        else if (c.t === 'p' && c.v === ')' && --depth === 0) break
      }
      const after = toks[close + 1]
      if (after !== undefined && after.t === 'p' && after.v === '{') continue
      cur.hooks.push({ name: tk.v, pos: tk.pos })
    }
  }
  while (stack.length > 0) finish(stack.pop())
  return { violations: out, balanced: braces.length === 0 && parens.length === 0, hookFns }
}

export const lineOf = (src, pos) => src.slice(0, pos).split('\n').length

/** The shapes the scanner must flag (`bad`) and the ones it must leave alone (`good`). Throws with the name of the first it gets wrong. */
export function selfTest () {
  const bad = {
    'a hook after an early return': 'const A = (p) => {\n  const [x] = React.useState(0)\n  if (x) return null\n  React.useEffect(() => {}, [])\n  return h("div")\n}',
    'a hook after an early return in a block': 'function A (p) {\n  try { if (p.k) return null } catch (e) { /* none */ }\n  const r = useRef(null)\n  return r\n}',
    'a bare return, then a hook': 'const A = (p) => {\n  if (!p.on) return\n  useMemo(() => 1, [])\n}',
    'a hook after a return with a long expression': 'const A = (p) => {\n  if (p.x === null) return h("div",\n    h("b", null, "x"))\n  React.useEffect(() => {}, [])\n  return null\n}',
  }
  const good = {
    'every hook before the early return': 'const A = (p) => {\n  const [x] = React.useState(0)\n  React.useEffect(() => {}, [])\n  if (x) return null\n  return h("div")\n}',
    'a hook inside the returned value': 'const useA = () => {\n  return React.useMemo(() => 1, [])\n}\nconst B = {\n  useCallback (fn, deps) { return React.useMemo(() => fn, deps) },\n}',
    'a hook inside an arrow with an expression body, after a return of the function around it': 'function apply (ctx) {\n  if (!ctx) return\n  const useBrand = () => React.useSyncExternalStore(a, b, b)\n  return useBrand\n}',
    'a return in a callback does not count for the component': 'const A = (p) => {\n  React.useEffect(() => { if (p.x) return undefined; return () => {} }, [])\n  const [y] = React.useState(1)\n  return y\n}',
    'a regular expression and a template with braces': 'const A = (p) => {\n  const re = /[)}{]\\//g\n  const s = `x ${p.a ? "}" : "{"} y`\n  React.useState(re.test(s))\n  return null\n}',
    'a name that only looks like a hook': 'const A = (p) => {\n  if (p.x) return null\n  const used = userName(p)\n  p.useThing(1)\n  return used\n}',
  }
  for (const [name, code] of Object.entries(bad)) {
    const r = scanHookOrder(code)
    if (r.balanced !== true || r.violations.length === 0) throw new Error('the hook-order scanner misses: ' + name)
  }
  for (const [name, code] of Object.entries(good)) {
    const r = scanHookOrder(code)
    if (r.balanced !== true || r.violations.length !== 0) throw new Error('the hook-order scanner flags a good shape: ' + name + ' → ' + JSON.stringify(r.violations))
  }
}
