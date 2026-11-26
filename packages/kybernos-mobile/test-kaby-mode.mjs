// kybernos-mobile, Kaby mode: the switch, the one list of what is shown and hidden, the messages between the page and the shell, the connection card and the
// notification triggers, on a minimal fake DOM and a fake React. The real page is read by scripts/check-kaby-mode-live.mjs.
//   node packages/kybernos-mobile/test-kaby-mode.mjs
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  KABY_CLASS, KABY_EARLY_SCRIPT, KABY_HIDE, KABY_MODE_VERSION, KABY_ROUTE, KABY_SHOW, KABY_STYLE_ID, KABY_UA_SOURCE, KABY_UA_TOKEN, classOf, kabyCss, kabyRows
} from './kaby-mode.mjs'
import { MODE_CLASS } from './mode.mjs'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + JSON.stringify(detail).slice(0, 400)))
  if (!ok) failed += 1
}
const here = fileURLToPath(new URL('.', import.meta.url))
const SOURCE = readFileSync(join(here, 'client.js'), 'utf8')
const README = readFileSync(join(here, 'README.md'), 'utf8')
const CONTRACT_FILE = join(here, '..', '..', 'docs', 'dev', 'kaby-mode-shell-contract.md')
const tick = () => new Promise((resolve) => setImmediate(resolve))

const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KybernosHost/0.1.0 (ios)'
const KABY_IOS = IOS + ' KabyMode/1'
const KABY_ANDROID = 'Mozilla/5.0 (Linux; Android 16) KybernosHost/1.2.3-beta.4 (android) KabyMode/1'

// ── the list ─────────────────────────────────────────────────────────────────────────────────────
console.log('the one list')
{
  const ids = KABY_HIDE.map((r) => r.id)
  check('every hidden row has an id, plain words (what, why) and a list of selectors', KABY_HIDE.every((r) => /^[a-z][a-z-]*$/.test(r.id) && r.what.length > 20 && r.why.length > 20 && Array.isArray(r.css)))
  check('the ids are unique', new Set(ids).size === ids.length, ids)
  check('every shown row says what it is, where it is drawn, and how a live check finds it', KABY_SHOW.every((r) => /^[a-z-]+$/.test(r.id) && r.what.length > 10 && r.probe.length > 3 && r.where.length >= 3) && new Set(KABY_SHOW.map((r) => r.id)).size === KABY_SHOW.length)
  const css = kabyCss()
  const rules = css.split('\n').filter((l) => l !== '' && !l.startsWith('/*'))
  const selectorLines = rules.map((l) => l.replace(/ \{.*$/, '').replace(/,$/, ''))
  const underOwnClass = (l) => l.startsWith('html.' + KABY_CLASS + ' ') || l.startsWith('html.' + MODE_CLASS + ' ')
  check('every selector of the stylesheet is under html.kb-kaby (the phone app\'s frame) or html.kb-simple (the mode): the full app, the desktop and a browser in Complete never get a rule of it', selectorLines.length > 10 && selectorLines.every(underOwnClass), selectorLines.filter((l) => !underOwnClass(l)))
  check('only the technical view follows the MODE (html.kb-simple); every other row is the phone app\'s own frame (html.kb-kaby)', KABY_HIDE.filter((r) => r.scope === 'mode').map((r) => r.id).join() === 'answer-extras,process' && KABY_HIDE.filter((r) => r.scope !== 'mode').every((r) => r.scope === undefined || r.scope === 'phone') && KABY_HIDE.every((r) => r.css.every((sel) => css.indexOf('html.' + classOf(r) + ' ' + sel) >= 0)))
  check('the rows of the mode are never under the phone class, and the rows of the frame never under the mode class', KABY_HIDE.every((r) => r.css.every((sel) => css.indexOf('html.' + (r.scope === 'mode' ? KABY_CLASS : MODE_CLASS) + ' ' + sel) < 0)))
  check('the hide rows are in the stylesheet, in the order of the list, each under its own comment', KABY_HIDE.filter((r) => r.css.length > 0).every((r) => css.indexOf('/* ' + r.id + ' (') >= 0) && KABY_HIDE.filter((r) => r.css.length > 0).map((r) => css.indexOf('/* ' + r.id + ' (')).every((n, i, a) => i === 0 || n > a[i - 1]))
  check('a hidden thing is only display: none (it stays in the page: the full app keeps it), and Kaby mode has no layout, visibility, padding or position rule of its own', /display: none !important/.test(css) && !/visibility|padding|margin|position|z-index/.test(rules.join('\n')))
  check('the agent’s steps (the thinking line, bash, the tool cards) are hidden in Simple unless a turn of the chat has its process opened by a tap (that is « Details »); the engine’s own collapsed steps are not touched; ask_user_question, approval cards and connector-ask stay visible', (() => {
    const row = KABY_HIDE.find((r) => r.id === 'process')
    const guard = '[data-slot="conversation.chat.flow"]:not(:has([data-chat-flow-kind="turn-process"] button[aria-expanded="true"])) '
    const keep = ':not(:has([data-tool="ask_user_question"], [data-slot*="approval"], [data-kb="connector-ask"]))'
    return row !== undefined && row.css.length === 3 && row.css.every((s) => s.startsWith(guard) && s.includes(':not([data-turn-process-hidden])') && s.includes(':not([data-slot*="approval"])') && s.includes(':not([data-kb="connector-ask"])') && s.includes(':not([data-tool="ask_user_question"])') && s.endsWith(keep)) &&
      row.css[0].includes(' [data-turn-process-member]:not(') && row.css[1].includes(' [data-turn-process-inline]:not(') && row.css[2].includes(' [data-tool]:not(')
  })())
  // Real DOM probes evaluated against the actual stylesheet emitted by kabyCss() (not string checks):
  // prove thinking/bash/tools hide when Details is closed, open when Details is expanded, and approvals/connector-ask/ask_user_question are NEVER hidden (direct or nested).
  {
    const mkNode = (tag, attrs = {}, kids = [], cls = []) => {
      const n = { tag, attrs: { ...attrs }, cls: [...cls], kids: [], parent: null }
      for (const k of kids) { k.parent = n; n.kids.push(k) }
      return n
    }
    const splitTop = (str, sep) => {
      const out = []; let cur = ''; let p = 0; let b = 0; let q = null
      for (let i = 0; i < str.length; i += 1) {
        const c = str[i]
        if (q !== null) { cur += c; if (c === q) q = null; continue }
        if (c === '"' || c === '\'') { q = c; cur += c; continue }
        if (c === '(') p += 1; else if (c === ')') p -= 1
        else if (c === '[') b += 1; else if (c === ']') b -= 1
        if (p === 0 && b === 0 && c === sep) { out.push(cur.trim()); cur = '' } else cur += c
      }
      if (cur.trim() !== '') out.push(cur.trim())
      return out
    }
    const splitComplex = (sel) => {
      const parts = []; let cur = ''; let p = 0; let b = 0; let q = null; let comb = null
      const flush = (nextComb) => { if (cur.trim() !== '') { parts.push({ comb, sel: cur.trim() }); cur = '' } comb = nextComb }
      for (let i = 0; i < sel.length; i += 1) {
        const c = sel[i]
        if (q !== null) { cur += c; if (c === q) q = null; continue }
        if (c === '"' || c === '\'') { q = c; cur += c; continue }
        if (c === '(') { p += 1; cur += c; continue }
        if (c === ')') { p -= 1; cur += c; continue }
        if (c === '[') { b += 1; cur += c; continue }
        if (c === ']') { b -= 1; cur += c; continue }
        if (p === 0 && b === 0 && c === '>') { flush('>'); continue }
        if (p === 0 && b === 0 && /\s/.test(c)) {
          if (cur.trim() !== '') {
            let j = i; while (j < sel.length && /\s/.test(sel[j])) j += 1
            if (sel[j] === '>') { flush('>'); i = j; continue }
            flush(' ')
          }
          continue
        }
        cur += c
      }
      if (cur.trim() !== '') parts.push({ comb, sel: cur.trim() })
      return parts
    }
    const descendants = (node, out = []) => { for (const k of node.kids) { out.push(k); descendants(k, out) } return out }
    const matchCompound = (node, sel) => {
      let i = 0
      const readBalanced = (open, close) => {
        let d = 0; let q = null; const start = i
        while (i < sel.length) {
          const c = sel[i]; i += 1
          if (q !== null) { if (c === q) q = null; continue }
          if (c === '"' || c === '\'') { q = c; continue }
          if (c === open) d += 1
          else if (c === close) { d -= 1; if (d === 0) return sel.slice(start + 1, i - 1) }
        }
        return ''
      }
      while (i < sel.length) {
        const c = sel[i]
        if (c === '.') {
          i += 1; const s = i; while (i < sel.length && /[\w-]/.test(sel[i])) i += 1
          if (!node.cls.includes(sel.slice(s, i))) return false
        } else if (c === '[') {
          const inner = readBalanced('[', ']')
          const m = /^([a-z0-9-]+)(?:(\*|\^|)="([^"]*)")?$/i.exec(inner.trim())
          if (m === null) return false
          const has = Object.prototype.hasOwnProperty.call(node.attrs, m[1])
          if (!has) return false
          const val = String(node.attrs[m[1]])
          if (m[3] !== undefined) {
            if (m[2] === '' && val !== m[3]) return false
            if (m[2] === '*' && val.indexOf(m[3]) < 0) return false
            if (m[2] === '^' && !val.startsWith(m[3])) return false
          }
        } else if (c === ':') {
          i += 1; const s = i; while (i < sel.length && /[a-z-]/i.test(sel[i])) i += 1
          const fn = sel.slice(s, i)
          const arg = sel[i] === '(' ? readBalanced('(', ')') : ''
          if (fn === 'not') {
            if (splitTop(arg, ',').some((sub) => matchComplex(node, sub))) return false
          } else if (fn === 'has') {
            const subs = splitTop(arg, ',')
            const ok = subs.some((sub) => {
              if (sub.startsWith('>')) {
                const rest = sub.slice(1).trim()
                return node.kids.some((k) => matchComplex(k, rest, node))
              }
              return descendants(node).some((d) => matchComplex(d, sub, node))
            })
            if (!ok) return false
          } else { return false }
        } else {
          const s = i; while (i < sel.length && /[a-z0-9-]/i.test(sel[i])) i += 1
          if (node.tag !== sel.slice(s, i).toLowerCase()) return false
        }
      }
      return true
    }
    const matchComplex = (node, sel, scope = null) => {
      const parts = splitComplex(sel)
      const step = (el, idx) => {
        if (!matchCompound(el, parts[idx].sel)) return false
        if (idx === 0) return true
        const comb = parts[idx].comb
        if (comb === '>') return el.parent !== null && el.parent !== scope && step(el.parent, idx - 1)
        for (let p = el.parent; p !== null && p !== scope; p = p.parent) if (step(p, idx - 1)) return true
        return false
      }
      return parts.length > 0 && step(node, parts.length - 1)
    }
    const hiddenBy = (node, sels) => sels.some((s) => matchComplex(node, s))
    const isHidden = (node, sels) => { for (let n = node; n !== null; n = n.parent) if (hiddenBy(n, sels)) return true; return false }

    const buildChatDom = ({ simple = true, expanded = false } = {}) => {
      const detailsBtn = mkNode('button', { 'aria-expanded': expanded ? 'true' : 'false' })
      const detailsRow = mkNode('div', { 'data-chat-flow-kind': 'turn-process', 'data-chat-turn': '1' }, [detailsBtn])
      const thinkingInline = mkNode('div', { 'data-turn-process-inline': '' })
      const thinkingMember = mkNode('div', { 'data-turn-process-member': '' }, [mkNode('div', { 'data-thinking': '' })])
      const bashTool = mkNode('div', { 'data-tool': 'bash' })
      const bashMember = mkNode('div', { 'data-turn-process-member': '' }, [bashTool])
      const engineHiddenMember = mkNode('div', { 'data-turn-process-member': '', 'data-turn-process-hidden': '' })
      const engineHiddenInline = mkNode('div', { 'data-turn-process-inline': '', 'data-turn-process-hidden': '' })
      const engineHiddenTool = mkNode('div', { 'data-tool': 'bash', 'data-turn-process-hidden': '' })
      const askTool = mkNode('div', { 'data-tool': 'ask_user_question' })
      const askMember = mkNode('div', { 'data-turn-process-member': '' }, [askTool])
      const approvalDirect = mkNode('div', { 'data-slot': 'conversation.approval.card' })
      const approvalOnMember = mkNode('div', { 'data-turn-process-member': '', 'data-slot': 'conversation.approval.card' })
      const approvalNested = mkNode('div', { 'data-slot': 'conversation.approval.card' })
      const approvalTool = mkNode('div', { 'data-tool': 'bash' }, [approvalNested])
      const approvalMember = mkNode('div', { 'data-turn-process-member': '' }, [approvalTool])
      const connectorNested = mkNode('div', { 'data-kb': 'connector-ask' })
      const connectorTool = mkNode('div', { 'data-tool': 'connections_execute' }, [connectorNested])
      const connectorMember = mkNode('div', { 'data-turn-process-member': '' }, [connectorTool])
      const connectorInInline = mkNode('div', { 'data-kb': 'connector-ask' })
      const connectorInlineWrap = mkNode('div', { 'data-turn-process-inline': '' }, [connectorInInline])
      const answer = mkNode('div', { 'data-slot': 'conversation.chat.node' })
      const flow = mkNode('div', { 'data-slot': 'conversation.chat.flow' }, [
        detailsRow, thinkingInline, thinkingMember, bashMember,
        engineHiddenMember, engineHiddenInline, engineHiddenTool,
        askMember, approvalDirect, approvalOnMember, approvalMember,
        connectorMember, connectorInlineWrap, answer
      ])
      const html = mkNode('html', {}, [mkNode('body', {}, [flow])], simple ? [MODE_CLASS] : [])
      return {
        html, detailsRow, detailsBtn, thinkingInline, thinkingMember, bashTool, bashMember,
        engineHiddenMember, engineHiddenInline, engineHiddenTool,
        askTool, askMember, approvalDirect, approvalOnMember, approvalNested, approvalTool, approvalMember,
        connectorNested, connectorTool, connectorMember, connectorInInline, answer
      }
    }
    const closed = buildChatDom({ simple: true, expanded: false })
    check('DOM probe (Simple, Details closed): thinking and normal bash/tool steps are hidden, while the Details door and the answer stay visible',
      isHidden(closed.thinkingInline, selectorLines) && isHidden(closed.thinkingMember, selectorLines) &&
      isHidden(closed.bashTool, selectorLines) && isHidden(closed.bashMember, selectorLines) &&
      !isHidden(closed.detailsRow, selectorLines) && !isHidden(closed.detailsBtn, selectorLines) && !isHidden(closed.answer, selectorLines))
    check('DOM probe (Simple, Details closed): DSH’s own data-turn-process-hidden elements are never matched by our rules',
      !hiddenBy(closed.engineHiddenMember, selectorLines) && !hiddenBy(closed.engineHiddenInline, selectorLines) && !hiddenBy(closed.engineHiddenTool, selectorLines))
    check('DOM probe (Simple, Details closed): ask_user_question, direct approvals, approvals nested inside [data-tool]/[data-turn-process-member], and nested connector-ask are NEVER hidden',
      !isHidden(closed.askTool, selectorLines) && !isHidden(closed.askMember, selectorLines) &&
      !isHidden(closed.approvalDirect, selectorLines) && !isHidden(closed.approvalOnMember, selectorLines) &&
      !isHidden(closed.approvalNested, selectorLines) && !isHidden(closed.approvalTool, selectorLines) && !isHidden(closed.approvalMember, selectorLines) &&
      !isHidden(closed.connectorNested, selectorLines) && !isHidden(closed.connectorTool, selectorLines) && !isHidden(closed.connectorMember, selectorLines) &&
      !isHidden(closed.connectorInInline, selectorLines))
    const opened = buildChatDom({ simple: true, expanded: true })
    check('DOM probe (Simple, Details open): thinking, bash/tool steps, ask_user_question, approvals and connector-ask are all visible',
      !isHidden(opened.thinkingInline, selectorLines) && !isHidden(opened.thinkingMember, selectorLines) &&
      !isHidden(opened.bashTool, selectorLines) && !isHidden(opened.bashMember, selectorLines) &&
      !isHidden(opened.askTool, selectorLines) && !isHidden(opened.approvalNested, selectorLines) && !isHidden(opened.connectorNested, selectorLines))
    const complete = buildChatDom({ simple: false, expanded: false })
    check('DOM probe (Complete mode): technical steps and interactive cards are all visible',
      !isHidden(complete.thinkingInline, selectorLines) && !isHidden(complete.thinkingMember, selectorLines) &&
      !isHidden(complete.bashTool, selectorLines) && !isHidden(complete.approvalNested, selectorLines) && !isHidden(complete.connectorNested, selectorLines))
  }
  // no row of the hide list takes away something of the show list: a selector that equals a probe, or a prefix / substring selector that the probe's own value satisfies
  const attrOf = (s) => { const m = /^\[(data-[a-z-]+)(\^|\*|)="([^"]*)"\]$/.exec(s); return m === null ? null : { name: m[1], op: m[2], value: m[3] } }
  const hitsProbe = (selector, probe) => {
    if (selector === probe) return true
    const a = attrOf(selector); const p = attrOf(probe)
    if (a === null || p === null || a.name !== p.name) return false
    return a.op === '^' ? p.value.startsWith(a.value) : (a.op === '*' ? p.value.indexOf(a.value) >= 0 : false)
  }
  const clashes = []
  for (const row of KABY_HIDE) for (const s of row.css) for (const show of KABY_SHOW) if (hitsProbe(s, show.probe)) clashes.push([row.id, s, show.id])
  check('no selector of the hide list matches a hook of the show list', clashes.length === 0, clashes)
  check('the full-app guard of the store rules is not repeated here (same hooks, hidden by STORE_HIDDEN under html.kb-app)', KABY_HIDE.find((r) => r.id === 'store-controls').css.length === 0 && /STORE_HIDDEN/.test(SOURCE))
  check('no rule keys on a hashed class name or a translated label', !rules.some((l) => /\.[a-z]+_[A-Za-z0-9]{5,}|:contains\(|text\(\)/.test(l)))
  const NAV = /sidebar|data-kb="mobile-|data-kb\^="mobile|data-kbmob|data-kb-t|data-shortcut-modal|data-sidebar|role="dialog"|role="menu"/
  const hiddenSelectors = KABY_HIDE.flatMap((r) => r.css)
  check('Kaby mode hides nothing of the app\'s own navigation: no sidebar, drawer, burger, dock, account menu, Settings dialog or Settings page in the list (the preset filters those, this file does not)', !hiddenSelectors.some((s) => NAV.test(s)) && ['drawer', 'account-menu', 'settings'].every((id) => KABY_SHOW.some((r) => r.id === id)), hiddenSelectors.filter((s) => NAV.test(s)))
  const hostile = kabyCss([{ id: 'x', what: 'a */ b', why: 'y', css: ['.z'] }])
  check('a hostile comment in a row cannot close the stylesheet\'s comment', (hostile.match(/\*\//g) || []).length === 2, hostile)
  check('a row with no selectors writes no rule', !/\/\* empty/.test(kabyCss([{ id: 'empty', what: 'nothing to hide here', why: 'y', css: [] }])))
}

console.log('the switch')
{
  const ua = new RegExp(KABY_UA_SOURCE)
  check('the token is KabyMode, after the app\'s own, with the version the shell speaks', KABY_UA_TOKEN === 'KabyMode' && KABY_MODE_VERSION === 1 && ua.test(KABY_IOS) && ua.test(KABY_ANDROID))
  check('the app without the token, a browser, another platform, an empty or a non-numeric version do not match', [IOS, 'Mozilla/5.0 (Macintosh) Safari/605 KabyMode/1', 'KybernosHost/0.1.0 (windows) KabyMode/1', 'KybernosHost/0.1.0 (ios) KabyMode/', 'KybernosHost/0.1.0 (ios) KabyMode/x', 'KybernosHost/0.1.0 (ios) KabyMode/0', 'KybernosHost/0.1.0 (ios) KabyMode/00', ''].every((s) => !ua.test(s)))
  const clientUa = /const KABY_UA = \/(.*)\/\n/.exec(SOURCE)
  const kyberUa = /const KABY_MODE_UA = \/(.*)\/\n/.exec(readFileSync(join(here, '..', 'kybernos-kyber', 'client.js'), 'utf8'))
  check('the page head, the browser half and the kyber bundle test the same words (the kyber one needs no capture)', clientUa !== null && kyberUa !== null && clientUa[1] === KABY_UA_SOURCE && kyberUa[1] === KABY_UA_SOURCE.replace('([1-9][0-9]{0,2})', '[1-9][0-9]{0,2}'), { client: clientUa && clientUa[1], kyber: kyberUa && kyberUa[1] })
  // the early script, played on a fake document: it adds the class when the agent matches, and never throws
  const play = (userAgent, brokenNavigator) => {
    const added = []
    const fakeNav = brokenNavigator ? undefined : { userAgent }
    new Function('navigator', 'document', KABY_EARLY_SCRIPT)(fakeNav, { documentElement: { classList: { add: (c) => added.push(c) } } })
    return added
  }
  check('the head script puts the class on <html> before the first paint when the agent asks for it', JSON.stringify(play(KABY_IOS, false)) === JSON.stringify([KABY_CLASS]))
  check('and does nothing for the full app or a page with no navigator', play(IOS, false).length === 0 && play('', false).length === 0 && (() => { try { return play('', true).length === 0 } catch (e) { return false } })())
  const rows = kabyRows()
  check('the page gets two head rows: the stylesheet (its id is known to the browser half), then the script', rows.length === 2 && rows.every((r) => r.kind === 'html' && r.placement === 'head') && rows[0].html.startsWith('<style id="' + KABY_STYLE_ID + '">') && rows[1].html.startsWith('<script>'))
  check('neither row can close its own tag', !/<\/style/i.test(rows[0].html.slice(0, -8)) && !/</.test(KABY_EARLY_SCRIPT) && KABY_ROUTE === '/kybernos-mobile/kaby.css')
  check('the page head carries the same rules as the route (the same function)', rows[0].html === '<style id="' + KABY_STYLE_ID + '">' + kabyCss() + '</style>')
}

// ── the browser half, loaded on a fake DOM ─────────────────────────────────────────────────────────────
const fakeReact = {
  createElement: (...a) => ({ a }),
  useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
  useRef: () => ({ current: null }),
  useEffect: () => {}
}
const makeDom = () => {
  const listeners = []
  const el = (tag) => ({
    tag, attrs: {}, children: [], className: '', id: '', removed: false, dataset: {},
    setAttribute (k, v) { this.attrs[k] = String(v) },
    getAttribute (k) { return this.attrs[k] },
    appendChild (c) { this.children.push(c); c.parent = this; return c },
    addEventListener (ev, fn) { this.listeners = (this.listeners || []).concat([{ ev, fn }]) },
    remove () { this.removed = true },
    hasAttribute (k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) },
    click () {}
  })
  const body = el('body'); const head = el('head')
  const meta = el('meta'); meta.attrs.content = 'width=device-width, initial-scale=1'
  const doc = {
    body, head,
    createElement: (t) => el(t),
    createElementNS: (ns, t) => el(t),
    getElementById: () => null,
    querySelector: (sel) => (sel === 'meta[name="viewport"]' ? meta : null),
    baseURI: 'http://127.0.0.1:3080/',
    visibilityState: 'visible',
    addEventListener: (ev, fn) => listeners.push({ ev, fn }),
    removeEventListener: (ev, fn) => { const i = listeners.findIndex((l) => l.ev === ev && l.fn === fn); if (i >= 0) listeners.splice(i, 1) }
  }
  return { doc, body, head, listeners }
}
/** Loads client.js on a fake window the way DSH's loader does, and applies it with a context that records what it registers. */
const runPage = ({ ua = KABY_IOS, rn = true, lang = 'en', failRoot = false } = {}) => {
  const dom = makeDom()
  let def = null
  const win = { __ModuleLoader__: { load: (d) => { def = d } }, matchMedia: () => ({ matches: true }), __KB_LANG_RESOLVE__: () => lang }
  globalThis.window = win
  globalThis.document = dom.doc
  new Function('window', 'document', SOURCE)(win, dom.doc)
  win.navigator = { userAgent: ua }
  const posted = []; const assigned = []
  win.location = { assign: (u) => assigned.push(u) }
  // `layers` (the page tells the shell how many layers are open) has its own file, test-layers.mjs: it is kept out of the list the older checks count
  const layerPosts = []
  if (rn) win.ReactNativeWebView = { postMessage: (m) => { if (JSON.parse(m).kybernos === 'layers') layerPosts.push(m); else posted.push(m) } }
  const windowListeners = []
  win.addEventListener = (ev, fn) => windowListeners.push({ ev, fn })
  win.removeEventListener = (ev, fn) => { const i = windowListeners.findIndex((l) => l.ev === ev && l.fn === fn); if (i >= 0) windowListeners.splice(i, 1) }
  const classes = new Set()
  dom.doc.documentElement = { classList: { add: (...c) => c.forEach((x) => classes.add(x)), remove: (...c) => c.forEach((x) => classes.delete(x)) } }
  const rendered = []; const roots = []
  const reactDom = { createRoot: (box) => { if (failRoot) throw new Error('no root'); roots.push(box); return { render: (tree) => rendered.push(tree), unmount: () => {} } } }
  const plugin = def.factory((name) => (name === 'react' ? fakeReact : (name === 'react-dom/client' ? reactDom : undefined)))
  const disposers = []; const registered = []; const styles = []
  dom.head.appendChild = (c) => { styles.push(c); return c }
  const slots = { inject: (name, fn) => fn(), register: (spec) => { registered.push(spec); return () => {} } }
  const ctx = { effect: (fn) => { const d = fn(); disposers.push(d); return d }, inject: (names, cb) => cb({ slots }) }
  let threw = null
  try { plugin.apply(ctx) } catch (e) { threw = e }
  return { win, plugin, dom, posted, assigned, classes, disposers, registered, styles, roots, rendered, threw, windowListeners, test: plugin.__test, kinds: () => posted.map((m) => JSON.parse(m).kybernos) }
}

console.log('the switch, in the page')
{
  const t = runPage({ ua: IOS }).test
  const p = t.parseKabyMode
  check('KabyMode/1 on the app\'s agent is Kaby mode, whichever platform', p(KABY_IOS).version === 1 && p(KABY_ANDROID).version === 1)
  check('a shell that speaks a higher contract is served the version this build has', p(IOS + ' KabyMode/7').version === 1 && p(IOS + ' KabyMode/7').asked === 7)
  check('KabyMode/0 is off, as is no token, a browser, null and undefined', [IOS + ' KabyMode/0', IOS, 'Mozilla/5.0 (Macintosh) KabyMode/1', null, undefined, ''].every((ua) => p(ua) === null))

  const full = runPage({ ua: IOS })
  check('the full app is as it was: the seam has no Kaby field, the section is « The Kybernos app », no Kaby bar, no Kaby class, one message to the shell', Object.keys(full.win.__KB_APP__).sort().join() === 'appVersion,openLog,openSettings,platform,receive,version' && full.registered.some((r) => r.name === 'settings.section' && r.label === 'The Kybernos app') && !full.classes.has('kb-kaby') && full.roots.length === 0 && JSON.stringify(full.kinds()) === '["app-entry"]', { keys: Object.keys(full.win.__KB_APP__), kinds: full.kinds(), classes: [...full.classes] })
  full.win.__KB_APP__.openSettings()
  check('the full app\'s openSettings is still the app\'s own link', JSON.stringify(full.assigned) === '["kybernos://settings"]', full.assigned)
  const off = runPage({ ua: IOS + ' KabyMode/0' })
  check('KabyMode/0 gives the full app', off.win.__KB_APP__.mode === undefined && !off.classes.has('kb-kaby') && JSON.stringify(off.kinds()) === '["app-entry"]')
  const browser = runPage({ ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15 KabyMode/1' })
  check('a browser that carries the words is not Kaby mode (it is not the app): the phone link stays, nothing of the app', browser.win.__KB_APP__ === undefined && browser.classes.size === 0 && browser.posted.length === 0 && browser.roots.length === 0)
}

console.log('inside Kaby mode')
{
  const k = runPage()
  check('it mounts without a failure', k.threw === null, k.threw && String(k.threw))
  check('the seam keeps the old fields and adds the mode, the contract version, receive, shell, requestConnect and askNotifications', ['version', 'platform', 'appVersion', 'openSettings', 'openLog'].every((f) => f in k.win.__KB_APP__) && k.win.__KB_APP__.mode === 'kaby' && k.win.__KB_APP__.modeVersion === 1 && ['receive', 'shell', 'requestConnect', 'askNotifications'].every((f) => typeof k.win.__KB_APP__[f] === 'function'), Object.keys(k.win.__KB_APP__))
  check('<html> gets kb-app, kb-app-ios and kb-kaby', k.classes.has('kb-app') && k.classes.has('kb-app-ios') && k.classes.has('kb-kaby'), [...k.classes])
  const first = JSON.parse(k.posted[0] || '{}')
  check('the shell hears « kaby-ready » first (mode, versions, platform), then the old entry message', first.kybernos === 'kaby-ready' && first.version === 1 && first.mode === 'kaby' && first.modeVersion === 1 && first.platform === 'ios' && first.appVersion === '0.1.0' && JSON.stringify(k.kinds()) === '["kaby-ready","app-entry"]', k.posted)
  const sections = k.registered.filter((r) => r.name === 'settings.section')
  check('DSH\'s Settings gets NO page of ours any more (item 28: « The Kybernos app » doubled About), and the phone link window is not published', sections.length === 0 && k.win.__KB_MOBILE__ === undefined, sections)
  const aboutParts = Array.isArray(k.win.__KB_ABOUT_EXTRA__) ? k.win.__KB_ABOUT_EXTRA__ : []
  check('its parts are filed under About instead: ONE entry on window.__KB_ABOUT_EXTRA__ (id kybernos-app, a component), told to the page with the kb-about-extra event', aboutParts.length === 1 && aboutParts[0].id === 'kybernos-app' && typeof aboutParts[0].component === 'function' && typeof aboutParts[0].order === 'number', aboutParts.map((x) => x.id))
  const tails = k.registered.filter((r) => r.name === 'conversation.chat.turnTail').map((r) => r.id).sort()
  check('under each finished answer: the « Report » link (store rule) and the probe that counts finished answers (draws nothing)', JSON.stringify(tails) === '["kybernos-mobile-kaby-turn","kybernos-mobile-report"]', tails)
  check('the chip and the card are drawn in a React root of their own on <body>', k.roots.length === 1 && k.roots[0].attrs['data-kb'] === 'kaby-root' && k.dom.body.children.includes(k.roots[0]) && k.rendered.length === 1)
  const css = k.styles.map((s) => s.textContent || '').join('\n')
  check('its styles are under .kbk- (and the report link\'s .kbapp-), with the page\'s own tokens only', /\.kbk-root/.test(css) && !/\.kbk-chip|\.kbk-answer/.test(css) && /\.kbapp-/.test(css) && !/\.kbk-bar|\.kbk-menu|\.kbk-sheet/.test(css) && !/#[0-9a-fA-F]{3,8}\b/.test(css))
  const link = k.styles.find((s) => s.tag === 'link' && s.id === 'kbmob-kaby-link')
  check('when the page head did not carry the rules, the stylesheet is linked from the host route', link !== undefined && link.id === 'kbmob-kaby-link' && link.href === '/kybernos-mobile/kaby.css', link && link.href)
  check('a Kaby page has no store control either: the same hooks as the full app', /STORE_HIDDEN/.test(SOURCE))
  const sets = (screen) => k.win.__KB_APP__.openSettings(screen)
  check('openSettings(screen) is refused until the shell says it has the screen (and says so: false)', sets('account') === false && k.kinds().length === 2)
  check('openSettings() with no argument is still the app\'s own settings link', (k.win.__KB_APP__.openSettings(), JSON.stringify(k.assigned) === '["kybernos://settings"]'))
  check('a window event from another bundle asks for a connection (kb-connect-request)', k.windowListeners.some((l) => l.ev === 'kb-connect-request'))
  k.win.__KB_APP__.receive({ kybernos: 'shell-state', version: 1, capabilities: { authorize: true, notifications: true, screens: ['account', 'plan', 'help', 'bogus'] }, notifications: 'undetermined', connection: 'cloud' })
  check('after the shell\'s state: a declared screen opens with a message, an unknown one is dropped', sets('account') === true && sets('bogus') === false && JSON.parse(k.posted[k.posted.length - 1]).screen === 'account' && k.win.__KB_APP__.shell().screens.join() === 'account,plan,help')
  for (const d of k.disposers) { try { if (typeof d === 'function') d() } catch (e) { /* counted below */ } }
  check('the cleanups take the seam, the classes, the listener and the part filed under About away', k.win.__KB_APP__ === undefined && k.classes.size === 0 && !k.windowListeners.some((l) => l.ev === 'kb-connect-request') && (k.win.__KB_ABOUT_EXTRA__ || []).length === 0, [...k.classes])
  const realWarn = console.warn; console.warn = () => {}
  const noRoot = runPage({ failRoot: true })
  console.warn = realWarn
  check('a page that cannot make its React root still mounts the rest and throws nothing', noRoot.threw === null && noRoot.win.__KB_APP__.mode === 'kaby')
  const noShell = runPage({ rn: false })
  check('a Kaby user agent with no shell to talk to (a bridge that is not there) never throws, and nothing is asked of it', noShell.threw === null && noShell.posted.length === 0 && noShell.win.__KB_APP__.openSettings('plan') === false && noShell.win.__KB_APP__.askNotifications('approval') === false)
}

// ── the bridge ────────────────────────────────────────────────────────────────────────────────────
console.log('the messages between the page and the shell')
const T = runPage({ ua: IOS }).test
const bridgeOn = (capabilities, extra = {}) => {
  const t = T
  const posted = []
  const win = { ReactNativeWebView: { postMessage: (m) => posted.push(JSON.parse(m)) } }
  let n = 0
  const bridge = t.buildKabyBridge(win, { platform: 'android', version: '2.0.0' }, { version: 1, asked: 1 }, { random: () => 'r' + (n += 1) + '0000000000000' })
  if (capabilities !== null) bridge.receive({ kybernos: 'shell-state', version: 1, capabilities, ...extra })
  return { t, bridge, posted, win }
}
{
  const { t, bridge, posted } = bridgeOn(null)
  check('ready says the mode and the platform', bridge.ready() === true && posted[0].kybernos === t.KABY_OUT.ready && posted[0].platform === 'android' && posted[0].modeVersion === 1)
  check('the words of the contract are what the document lists', JSON.stringify(t.KABY_OUT) === JSON.stringify({ ready: 'kaby-ready', screen: 'open-screen', authorize: 'authorize', notifications: 'notifications-ask', mode: 'set-mode' }) && JSON.stringify(t.KABY_IN) === JSON.stringify({ shell: 'shell-state', authorized: 'authorize-result', notifications: 'notifications-state' }))
  const junk = [null, undefined, 3, 'x', '{', '[]', '{"kybernos":3}', '{"a":1}', [], {}, { kybernos: 'nope' }, { kybernos: 'authorize-result', id: 'nobody', state: 'returned' }, { kybernos: 'notifications-state', state: 'maybe' }, 'x'.repeat(9000)]
  check('what the shell says is never trusted nor thrown on: junk is answered false', junk.every((m) => bridge.receive(m) === false))
  // The small model's messages belong to another bundle: handed on as a cancelable window event, understood only when a listener claims it.
  const events = []
  const claimWin = { ReactNativeWebView: { postMessage: () => {} }, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; this.cancelable = init.cancelable === true; this.defaultPrevented = false } preventDefault() { this.defaultPrevented = true } }, dispatchEvent: (ev) => { events.push(ev); if (claimWin.claim === true) ev.preventDefault(); return true } }
  const claimBridge = T.buildKabyBridge(claimWin, { platform: 'android', version: '2.0.0' }, { version: 1, asked: 1 }, {})
  const local = { kybernos: 'local-llm', version: 1, event: 'state', state: { supported: true } }
  check('another bundle\'s message with no listener is answered false, as before', claimBridge.receive(local) === false && events.length === 1 && events[0].type === 'kb-app-message' && events[0].cancelable === true && events[0].detail.kybernos === 'local-llm')
  claimWin.claim = true
  check('the small model\'s state is understood when a listener claims it, and only that name is passed on', claimBridge.receive(local) === true && claimBridge.receive({ kybernos: 'something-else', version: 1 }) === false && events.length === 2)
  check('a message that is not an object is not passed on', claimBridge.receive(null) === false && claimBridge.receive('{"kybernos":"local-llm"}') === true && events.length === 3)
  check('a page with no window to dispatch on never throws', T.handOn(null, local) === false && T.handOn({}, local) === false)
  check('the state is kept as « the shell has not answered » until it does', bridge.shell().answered === false && bridge.shell().authorize === false && bridge.shell().screens.length === 0 && bridge.shell().notificationState === 'unknown')
}
{
  const { bridge, posted } = bridgeOn({ authorize: true, notifications: true, screens: ['account', 'help'] }, { notifications: 'undetermined', connection: 'remote' })
  const s = bridge.shell()
  check('shell-state sets what the shell can do, the permission state and where DSH runs', s.answered && s.authorize && s.notifications && s.screens.join() === 'account,help' && s.notificationState === 'undetermined' && s.connection === 'remote')
  check('a state with an unknown connection or permission word does not change what is known', (bridge.receive({ kybernos: 'shell-state', version: 1, capabilities: { authorize: true, notifications: true, screens: ['account', 'help'] }, notifications: 'sure', connection: 'mars' }), bridge.shell().notificationState === 'undetermined' && bridge.shell().connection === 'remote'))
  const bad = ['http://example.com/oauth', 'javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,x', 'kybernos://settings', 'not a url', '', 'https://' + 'a'.repeat(2100) + '.com/', 'http://127.0.0.1.evil.com/x']
  check('only an https address (or a loopback http one, for a computer in a test) goes to the sign-in sheet', bad.every((u) => bridge.authorize({ url: u, app: 'gmail' }).reason === 'bad_url') && bridge.authorize({ url: 'https://accounts.example.com/o?x=1', app: 'gmail', name: 'Gmail' }).ok === true && bridge.authorize({ url: 'http://127.0.0.1:3098/cb', app: 'gmail' }).ok === true && bridge.authorize({ url: 'http://[::1]:3098/cb', app: 'gmail' }).ok === true && bridge.authorize({ url: 'http://localhost:1/cb', app: 'gmail' }).ok === true)
  const sent = posted.filter((m) => m.kybernos === 'authorize')
  check('the message carries an id, the address, the app and a name, and nothing else of the person', sent.length === 4 && sent.every((m) => /^k\d+-r\d+/.test(m.id) && Object.keys(m).sort().join().startsWith('app,id,')) && sent[0].name === 'Gmail' && !('name' in sent[1]), sent[0])
  check('the shell\'s answer is accepted once, for an id that was asked, with a known state', bridge.receive({ kybernos: 'authorize-result', id: sent[0].id, state: 'maybe' }) === false && bridge.receive({ kybernos: 'authorize-result', id: sent[0].id, state: 'returned' }) === true && bridge.receive({ kybernos: 'authorize-result', id: sent[0].id, state: 'returned' }) === false)
}
{
  const { bridge, posted } = bridgeOn({ authorize: false, notifications: false, screens: [] })
  check('a shell that cannot open the sign-in sheet is told nothing: the page says « unsupported »', bridge.authorize({ url: 'https://a.example.com/', app: 'x' }).reason === 'unsupported' && posted.length === 0)
  check('a shell with no notification capability is never asked', bridge.askNotifications('approval') === false && posted.length === 0)
}
{
  const { bridge, posted } = bridgeOn({ authorize: false, notifications: true, screens: [] }, { notifications: 'undetermined' })
  check('the ask names its reason from a closed list; free text is refused', ['approval', 'reply', 'settings'].length === 3 && bridge.askNotifications('because you said so') === false && bridge.askNotifications('') === false && bridge.askNotifications(undefined) === false && posted.length === 0)
  check('an approval waiting asks once: the message is {kybernos, version, id, why}, nothing of anyone\'s words', bridge.askNotifications('approval') === true && Object.keys(posted[0]).sort().join() === 'id,kybernos,version,why' && posted[0].kybernos === 'notifications-ask' && posted[0].why === 'approval', posted[0])
  check('while it is open, and after it for the other two reasons, it does not ask again in this load', bridge.askNotifications('reply') === false && bridge.askNotifications('approval') === false && bridge.canAskNotifications() === false)
  check('the shell\'s state closes it; a decided permission is never asked again', bridge.receive({ kybernos: 'notifications-state', version: 1, state: 'denied' }) === true && bridge.shell().notificationState === 'denied' && bridge.askNotifications('settings') === false)
}
{
  const { bridge, posted } = bridgeOn({ authorize: false, notifications: true, screens: [] }, { notifications: 'undetermined' })
  bridge.askNotifications('reply')
  bridge.receive({ kybernos: 'notifications-state', version: 1, state: 'undetermined' })
  check('the person\'s own tap on « Turn on » (settings) is allowed again after a first ask that left it undecided', bridge.askNotifications('reply') === false && bridge.askNotifications('settings') === true && posted.filter((m) => m.kybernos === 'notifications-ask').length === 2)
}
{
  const { bridge, posted } = bridgeOn({ authorize: false, notifications: true, screens: [] }, { notifications: 'undetermined' })
  bridge.askNotifications('approval')
  check('a shell that never answered the first ask does not leave « Turn on » dead: the person\'s tap goes through, the automatic reasons keep waiting', bridge.askNotifications('reply') === false && bridge.askNotifications('settings') === true && posted.filter((m) => m.kybernos === 'notifications-ask').map((m) => m.why).join() === 'approval,settings')
}

console.log('the moments to ask for notifications')
{
  const realSet = globalThis.setTimeout; const realClear = globalThis.clearTimeout
  const timers = []
  globalThis.setTimeout = (f) => { timers.push(f); return timers.length }
  globalThis.clearTimeout = () => {}
  const make = (state, caps = { authorize: false, notifications: true, screens: [] }) => {
    const { bridge, posted } = caps === null ? bridgeOn(null) : bridgeOn(caps, { notifications: state })
    let clock = 1000000
    timers.length = 0
    const doc = { body: {}, visibilityState: 'visible', approval: false, handlers: {}, querySelector () { return this.approval ? {} : null }, addEventListener (ev, fn) { this.handlers[ev] = fn }, removeEventListener () {} }
    let observed = null
    const win = { MutationObserver: function (cb) { this.observe = () => { observed = cb }; this.disconnect = () => { observed = null } } }
    const triggers = T.startNotificationTriggers(win, doc, bridge, { now: () => clock })
    return { bridge, posted, doc, triggers, advance: (ms) => { clock += ms }, change: () => { if (observed !== null) observed([]) }, fire: () => { const f = timers.shift(); if (f) f() }, observing: () => observed !== null }
  }
  const t = T
  check('the approval card is DSH\'s own slot or the connection card', t.KABY_APPROVAL === '[data-slot*="approval"], [data-kb="connector-ask"]')
  const a = make('undetermined')
  a.change(); a.fire()
  check('a change of the page with no approval on it asks nothing', a.posted.length === 0 && a.observing())
  a.doc.approval = true
  a.change(); a.fire()
  check('the first approval card that appears asks (reason: approval) and the watcher stops', a.posted.length === 1 && a.posted[0].why === 'approval' && !a.observing(), a.posted)
  const b = make('granted')
  b.doc.approval = true
  b.change(); b.fire()
  check('with the permission already granted nothing is asked, and the watcher stops', b.posted.length === 0 && !b.observing())
  const c = make('undetermined')
  check('the turns the page draws as it opens are history, not a reply that came while the person was away', c.triggers.turnDone() === false && c.posted.length === 0)
  c.advance(9000)
  check('a reply that finishes while the person looks at the page asks nothing', c.triggers.turnDone() === false && c.posted.length === 0)
  c.doc.visibilityState = 'hidden'; c.doc.handlers.visibilitychange()
  check('a reply that finishes while the page is hidden asks (reason: reply)', c.triggers.turnDone() === true && c.posted[0].why === 'reply' && !c.observing())
  const d = make('undetermined')
  d.advance(9000)
  d.doc.visibilityState = 'hidden'; d.doc.handlers.visibilitychange()
  d.advance(5000)
  d.doc.visibilityState = 'visible'; d.doc.handlers.visibilitychange()
  check('a reply drawn as the person comes back after a few seconds away counts as one that came while away', d.triggers.turnDone() === true && d.posted[0].why === 'reply')
  const e = make('undetermined')
  e.advance(9000)
  e.doc.visibilityState = 'hidden'; e.doc.handlers.visibilitychange()
  e.advance(1000)
  e.doc.visibilityState = 'visible'; e.doc.handlers.visibilitychange()
  check('a glance away of a second does not', e.triggers.turnDone() === false)
  const f = make('undetermined')
  f.advance(9000); f.doc.visibilityState = 'hidden'
  f.triggers.stop()
  check('a stopped watcher does not observe, and one that fails inside never throws', !f.observing() && (() => { try { return typeof f.triggers.turnDone() === 'boolean' } catch (err) { return false } })())
  const h = make('undetermined', null)
  h.doc.approval = true
  h.change(); h.fire()
  check('a card that is there before the shell has answered asks nothing yet, and the watcher keeps watching (DSH draws while the shell is still answering)', h.posted.length === 0 && h.observing())
  h.bridge.receive({ kybernos: 'shell-state', version: 1, capabilities: { notifications: true, screens: [] }, notifications: 'undetermined' })
  h.fire()
  check('when the shell\'s answer arrives, the card that is already there asks (reason: approval), once', h.posted.length === 1 && h.posted[0].why === 'approval' && !h.observing(), h.posted)
  const n = make('undetermined', null)
  n.change(); n.fire()
  n.bridge.receive({ kybernos: 'shell-state', version: 1, capabilities: { notifications: false, screens: [] } })
  n.fire()
  check('a shell that has no notifications stops the watcher for good', !n.observing() && n.posted.length === 0)
  globalThis.setTimeout = realSet; globalThis.clearTimeout = realClear
}

// ── the connection card ───────────────────────────────────────────────────────────────────────────
console.log('« Kaby wants to connect »')
const flowOn = ({ capabilities = { authorize: true, notifications: false, screens: [] }, pollMax = 3, responses = {} } = {}) => {
  const base = bridgeOn(capabilities)
  const calls = []; const timers = []
  const answer = (method, path, body) => {
    calls.push({ method, path, body })
    const key = method + ' ' + path.split('?')[0]
    const r = responses[key]
    const v = typeof r === 'function' ? r(body, path, calls.filter((c) => c.method + ' ' + c.path.split('?')[0] === key).length) : r
    return v === undefined ? { status: 404, json: null } : v
  }
  const io = { fetchJson: async (method, path, body) => { const v = answer(method, path, body); if (v instanceof Error) throw v; return v }, setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length }, clearTimeout: () => {} }
  const flow = base.t.buildConnectFlow(base.bridge, io, { pollMs: 10, pollMax })
  return { ...base, flow, calls, timers, runTimer: async () => { const x = timers.shift(); if (x) x.f(); await tick(); await tick() }, authPosts: () => base.posted.filter((m) => m.kybernos === 'authorize') }
}
const LINK_OK = { status: 200, json: { ok: true, redirectUrl: 'https://accounts.example.com/o/auth?x=1', connection: { id: 'conn_1', status: 'pending' } } }
const ITEM = (status) => ({ status: 200, json: { ok: true, connection: { id: 'conn_1', status } } })
{
  const x = flowOn()
  check('a request needs an app slug; anything else is dropped', [null, undefined, {}, { toolkit: '' }, { toolkit: 'Gm ail' }, { toolkit: '../x' }, { toolkit: 'a'.repeat(65) }, { toolkit: 7 }].every((r) => x.flow.request(r) === null) && x.flow.list().length === 0)
  const r = x.flow.request({ toolkit: 'GMAIL', name: '  Gmail  ' })
  check('a request is a card in « asking »: the slug in lower case, the name trimmed, and NOTHING has left the phone', r.phase === 'asking' && r.toolkit === 'gmail' && r.name === 'Gmail' && x.calls.length === 0 && x.posted.length === 0)
  check('the same app asked twice is one card; the name falls back on the slug; the card shown is the first still open', x.flow.request({ toolkit: 'gmail' }) === r && x.flow.request({ toolkit: 'notion' }).name === 'notion' && x.flow.current() === r && x.flow.list().length === 2)
  check('« Not now » sends nothing anywhere, and the card goes away', x.flow.decline(r.id) === true && r.phase === 'declined' && x.calls.length === 0 && x.posted.length === 0 && x.flow.current().toolkit === 'notion' && x.flow.decline('nobody') === false)
  const again = x.flow.request({ toolkit: 'gmail' })
  check('an app that was declined can be asked again (a new card)', again !== r && again.phase === 'asking')
}
{
  const x = flowOn({ responses: { 'POST /kybernos-cloud/connections/link': LINK_OK, 'GET /kybernos-cloud/connections/item': ITEM('active') } })
  const r = x.flow.request({ toolkit: 'gmail', name: 'Gmail' })
  const phases = []
  x.flow.subscribe(() => phases.push(r.phase))
  const ok = await x.flow.accept(r.id)
  check('« Connect » asks the cloud half for the address, then hands it to the shell with an id, once', ok === true && x.calls[0].method === 'POST' && x.calls[0].path === '/kybernos-cloud/connections/link' && JSON.stringify(x.calls[0].body) === '{"toolkit":"gmail"}' && x.authPosts().length === 1 && x.authPosts()[0].url === 'https://accounts.example.com/o/auth?x=1' && x.authPosts()[0].app === 'gmail' && r.phase === 'authorizing', { phase: r.phase, calls: x.calls })
  check('while the sheet is open nothing is polled: the shell\'s answer comes first', x.calls.length === 1 && x.timers.length === 0)
  x.bridge.receive({ kybernos: 'authorize-result', id: x.authPosts()[0].id, state: 'returned' })
  await tick(); await tick()
  check('when the sheet is gone the page asks the server, and the SERVER\'s word makes it connected (the sheet\'s word proves nothing)', x.calls[1].method === 'GET' && x.calls[1].path === '/kybernos-cloud/connections/item?id=conn_1' && r.phase === 'connected' && phases.join() === 'linking,authorizing,checking,connected', phases)
  check('« OK » closes the card', x.flow.close(r.id) === true && r.phase === 'closed' && x.flow.current() === null)
}
{
  const x = flowOn({ pollMax: 3, responses: { 'POST /kybernos-cloud/connections/link': LINK_OK, 'GET /kybernos-cloud/connections/item': ITEM('pending') } })
  const r = x.flow.request({ toolkit: 'gmail' })
  await x.flow.accept(r.id)
  x.bridge.receive({ kybernos: 'authorize-result', id: x.authPosts()[0].id, state: 'dismissed' })
  await tick(); await tick()
  check('a sheet closed by the person (dismissed) is checked with the server too', r.phase === 'checking' && x.timers.length === 1 && x.timers[0].ms === 10)
  await x.runTimer(); await x.runTimer()
  check('the server is asked a few times, then the card says « not yet » (a cap, never a loop)', r.phase === 'not_yet' && x.calls.filter((c) => c.method === 'GET').length === 3 && x.timers.length === 0, { phase: r.phase, gets: x.calls.filter((c) => c.method === 'GET').length })
  check('« Check again » asks the server now', x.flow.checkNow(r.id) === true && r.phase === 'checking')
}
{
  const x = flowOn({ pollMax: 2, responses: { 'POST /kybernos-cloud/connections/link': LINK_OK, 'GET /kybernos-cloud/connections/item': (b, p, n) => ITEM(n < 3 ? 'pending' : 'active') } })
  const r = x.flow.request({ toolkit: 'gmail' })
  await x.flow.accept(r.id)
  x.bridge.receive({ kybernos: 'authorize-result', id: x.authPosts()[0].id, state: 'returned' })
  await tick(); await tick(); await x.runTimer()
  check('after the cap, « Check again » reaches a connection that finished in the meantime', r.phase === 'not_yet' && x.flow.checkNow(r.id) === true && (await tick(), await tick(), r.phase === 'connected'), r.phase)
  const y = flowOn({ pollMax: 1, responses: { 'POST /kybernos-cloud/connections/link': LINK_OK, 'GET /kybernos-cloud/connections/item': ITEM('pending') } })
  const q = y.flow.request({ toolkit: 'gmail' })
  await y.flow.accept(q.id)
  y.bridge.receive({ kybernos: 'authorize-result', id: y.authPosts()[0].id, state: 'returned' })
  await tick(); await tick()
  const before = y.calls.filter((c) => c.path.includes('/link')).length
  const reopened = await y.flow.accept(q.id)
  check('« Open the page again » hands the same address to the shell again without making a new connection', q.phase === 'authorizing' && reopened === true && y.calls.filter((c) => c.path.includes('/link')).length === before && y.authPosts().length === 2 && y.authPosts()[1].url === y.authPosts()[0].url)
  const z = flowOn({ responses: { 'POST /kybernos-cloud/connections/link': LINK_OK, 'GET /kybernos-cloud/connections/item': ITEM('failed') } })
  const s = z.flow.request({ toolkit: 'gmail' })
  await z.flow.accept(s.id)
  z.bridge.receive({ kybernos: 'authorize-result', id: z.authPosts()[0].id, state: 'returned' })
  await tick(); await tick()
  check('a connection the server marks failed or expired says « refused »', s.phase === 'failed' && s.error === 'refused')
}
{
  const sheetFailed = flowOn({ responses: { 'POST /kybernos-cloud/connections/link': LINK_OK } })
  const r = sheetFailed.flow.request({ toolkit: 'gmail' })
  await sheetFailed.flow.accept(r.id)
  sheetFailed.bridge.receive({ kybernos: 'authorize-result', id: sheetFailed.authPosts()[0].id, state: 'failed' })
  check('a sheet that could not open says so (the card offers to try again)', r.phase === 'failed' && r.error === 'sheet')
  sheetFailed.bridge.receive({ kybernos: 'authorize-result', id: sheetFailed.authPosts()[0].id, state: 'returned' })
  check('a late answer for a card that is not waiting for one changes nothing', r.phase === 'failed')
  const unsupported = flowOn({ capabilities: { authorize: false, notifications: false, screens: [] }, responses: { 'POST /kybernos-cloud/connections/link': LINK_OK } })
  const u = unsupported.flow.request({ toolkit: 'gmail' })
  const res = await unsupported.flow.accept(u.id)
  check('a shell that cannot open the sign-in sheet is found out BEFORE the server starts a connection nobody could finish', res === false && u.phase === 'failed' && u.error === 'unsupported' && unsupported.calls.length === 0 && unsupported.posted.length === 0)
  const unknown = flowOn({ capabilities: null, responses: { 'POST /kybernos-cloud/connections/link': LINK_OK } })
  const w = unknown.flow.request({ toolkit: 'gmail' })
  await unknown.flow.accept(w.id)
  check('the same when the shell never answered shell-state', w.error === 'unsupported' && unknown.calls.length === 0)
  const evil = flowOn({ responses: { 'POST /kybernos-cloud/connections/link': { status: 200, json: { ok: true, redirectUrl: 'javascript:alert(1)', connection: { id: 'c', status: 'pending' } } } } })
  const e = evil.flow.request({ toolkit: 'gmail' })
  await evil.flow.accept(e.id)
  check('an address that is not https never reaches the shell', e.phase === 'failed' && e.error === 'other' && evil.authPosts().length === 0)
  const done = flowOn({ responses: { 'POST /kybernos-cloud/connections/link': { status: 200, json: { ok: true, connection: { id: 'c', status: 'active' } } } } })
  const d = done.flow.request({ toolkit: 'gmail' })
  await done.flow.accept(d.id)
  check('an app that needs no sign-in page (already active, no address) is connected at once, with no sheet', d.phase === 'connected' && done.authPosts().length === 0)
}
{
  const cases = [
    ['on the phone link the computer does it (the cloud routes\' spelling)', { status: 403, json: { ok: false, error: 'refused_on_phone' } }, 'on_computer'],
    ['and this bundle\'s own spelling', { status: 403, json: { ok: false, error: 'refused-on-phone' } }, 'on_computer'],
    ['an app that needs its own key', { status: 400, json: { ok: false, error: 'needs_api_key' } }, 'needs_key'],
    ['a plan with no connections', { status: 403, json: { ok: false, error: 'connection_limit', entitled: false } }, 'plan'],
    ['a plan that is full', { status: 403, json: { ok: false, error: 'connection_limit', entitled: true } }, 'limit'],
    ['one is already waiting', { status: 409, json: { ok: false, error: 'pending_exists' } }, 'pending_exists'],
    ['not signed in', { status: 401, json: { ok: false, error: 'not_connected' } }, 'signin'],
    ['the account must sign in again', { status: 401, json: { ok: false, error: 'reconnect_required' } }, 'signin'],
    ['no network', { status: 0, json: null }, 'network'],
    ['a server without connected apps', { status: 200, json: { ok: false, offered: false } }, 'unavailable'],
    ['anything else', { status: 500, json: { ok: false, error: 'boom' } }, 'other']
  ]
  const seen = []
  for (const [name, response, want] of cases) {
    const x = flowOn({ responses: { 'POST /kybernos-cloud/connections/link': response } })
    const r = x.flow.request({ toolkit: 'gmail' })
    await x.flow.accept(r.id)
    seen.push([name, r.phase, r.error, want])
  }
  check('each refusal of the server is told in its own words', seen.every(([, phase, error, want]) => phase === 'failed' && error === want), seen.filter(([, phase, error, want]) => !(phase === 'failed' && error === want)))
  const thrown = flowOn({ responses: { 'POST /kybernos-cloud/connections/link': new Error('offline') } })
  const r = thrown.flow.request({ toolkit: 'gmail' })
  await thrown.flow.accept(r.id)
  check('a fetch that throws is « network » and nothing else', r.error === 'network')
}
{
  const pending = flowOn({ responses: { 'POST /kybernos-cloud/connections/link': LINK_OK, 'GET /kybernos-cloud/connections/item': ITEM('pending'), 'POST /kybernos-cloud/connections/delete': { status: 200, json: { ok: true } } } })
  const r = pending.flow.request({ toolkit: 'gmail' })
  await pending.flow.accept(r.id)
  pending.flow.decline(r.id)
  await tick(); await tick()
  const del = pending.calls.find((c) => c.path.endsWith('/delete'))
  check('giving up while the sheet is open removes the connection the person started (it would count against the plan)', r.phase === 'declined' && del !== undefined && JSON.stringify(del.body) === '{"id":"conn_1"}', pending.calls)
  const active = flowOn({ responses: { 'POST /kybernos-cloud/connections/link': LINK_OK, 'GET /kybernos-cloud/connections/item': ITEM('active'), 'POST /kybernos-cloud/connections/delete': { status: 200, json: { ok: true } } } })
  const q = active.flow.request({ toolkit: 'gmail' })
  await active.flow.accept(q.id)
  active.flow.decline(q.id)
  await tick(); await tick()
  check('but never one that turned out to be active in the meantime', !active.calls.some((c) => c.path.endsWith('/delete')))
  const connected = flowOn({ responses: { 'POST /kybernos-cloud/connections/link': { status: 200, json: { ok: true, connection: { id: 'c', status: 'active' } } }, 'POST /kybernos-cloud/connections/delete': { status: 200, json: { ok: true } } } })
  const c = connected.flow.request({ toolkit: 'gmail' })
  await connected.flow.accept(c.id)
  connected.flow.decline(c.id)
  await tick()
  check('and not one that was connected', !connected.calls.some((x) => x.path.endsWith('/delete')))
}

console.log('what the person reads')
{
  const page = (lang, react = fakeReact, svc = () => null, posted = [], appUi = { ReportTail: () => null }) => {
    const run = runPage({ ua: IOS, lang })
    const { t } = { t: run.test }
    const win = { ReactNativeWebView: { postMessage: (m) => posted.push(JSON.parse(m)) } }
    const bridge = t.buildKabyBridge(win, { platform: 'ios', version: '0.1.0' }, { version: 1, asked: 1 })
    let current = null
    const acts = []
    const flow = { subscribe: () => () => {}, list: () => [], current: () => current, accept: (id) => acts.push(['accept', id]), decline: (id) => acts.push(['decline', id]), checkNow: (id) => acts.push(['check', id]), close: (id) => acts.push(['close', id]), request () {} }
    const ui = t.buildKabyUi(react, { createRoot () {} }, { platform: 'ios', version: '0.1.0' }, { version: 1, asked: 1 }, bridge, flow, appUi, svc)
    const expand = (n) => {
      if (n === null || n === undefined || typeof n !== 'object' || !Array.isArray(n.a)) return n
      const [type, props, ...kids] = n.a
      if (typeof type === 'function') return expand(type(Object.assign({}, props, kids.length === 0 ? {} : { children: kids.length === 1 ? kids[0] : kids })))
      return { type, props: props || {}, kids: kids.flat(Infinity).map(expand) }
    }
    const walk = (n, out = []) => { if (n && typeof n === 'object') { if (n.props) out.push(n); (n.kids || []).forEach((k) => walk(k, out)) } return out }
    const text = (n) => (typeof n === 'string' ? n : (n && n.kids ? n.kids.map(text).join(' ') : ''))
    const draw = (C, props) => expand(fakeReact.createElement(C, props || {}))
    return { ui, bridge, acts, draw, walk, text, run, setCurrent: (r) => { current = r } }
  }
  const en = page('en')
  const card = (p, phase, extra = {}) => { p.setCurrent({ id: 'req1', toolkit: 'gmail', name: 'Gmail', phase, error: '', ...extra }); const tree = p.draw(p.ui.ConnectCard); return { tree, acts: p.walk(tree).map((n) => n.props['data-act']).filter(Boolean), text: p.text(tree) } }
  const asking = card(en, 'asking')
  check('the card says what Kaby wants, why, that the person signs in on the app\'s own page, with Connect / Not now', /Kaby wants to connect Gmail/.test(asking.text) && /never sees your password/.test(asking.text) && asking.acts.join() === 'kaby-connect-accept,kaby-connect-decline' && /Connect/.test(asking.text) && /Not now/.test(asking.text), asking)
  check('the buttons call the flow with this card (accept, decline)', (() => { const nodes = en.walk(en.draw(en.ui.ConnectCard)); nodes.find((n) => n.props['data-act'] === 'kaby-connect-accept').props.onClick(); nodes.find((n) => n.props['data-act'] === 'kaby-connect-decline').props.onClick(); return JSON.stringify(en.acts) === '[["accept","req1"],["decline","req1"]]' })(), en.acts)
  check('every phase has a title and the right buttons', [
    ['linking', ''], ['authorizing', 'kaby-connect-cancel'], ['checking', ''], ['not_yet', 'kaby-connect-check,kaby-connect-retry,kaby-connect-close'], ['connected', 'kaby-connect-done'], ['failed', 'kaby-connect-retry,kaby-connect-close']
  ].every(([phase, want]) => card(en, phase).acts.join() === want), ['linking', 'authorizing', 'checking', 'not_yet', 'connected', 'failed'].map((p) => [p, card(en, p).acts]))
  check('a failure that retrying cannot mend (plan, key, computer, pending, unavailable, unsupported) offers only to close', ['plan', 'needs_key', 'on_computer', 'pending_exists', 'unavailable', 'unsupported'].every((error) => card(en, 'failed', { error }).acts.join() === 'kaby-connect-close'))
  check('a failure that retrying may mend offers Try again', ['network', 'signin', 'sheet', 'refused', 'other', 'limit'].every((error) => card(en, 'failed', { error }).acts.join() === 'kaby-connect-retry,kaby-connect-close'))
  check('with nothing to ask, the card is not drawn', (() => { en.setCurrent(null); return en.draw(en.ui.ConnectCard) === null })())
  const fr = page('fr')
  const cardFr = card(fr, 'asking')
  check('in French the card is French: « Kaby veut se connecter à Gmail », Connecter / Pas maintenant', /Kaby veut se connecter à Gmail/.test(cardFr.text) && /Connecter/.test(cardFr.text) && /Pas maintenant/.test(cardFr.text), cardFr.text)
  const leadEn = en.draw(en.ui.SimpleLead)
  const kbsOf = (p, tree) => p.walk(tree).map((n) => n.props['data-kb']).filter(Boolean)
  const ours = /^kaby-(notifications|computer|account|help|mode-switch|connections|memory|appearance)$/
  check('the page of the app in Simple leads with what the full Settings has no page for: where Kaby works, account and plan, help and report (Notifications and « Need more? » only once the shell handles them), and nothing else', JSON.stringify(kbsOf(en, leadEn).filter((k) => ours.test(k))) === '["kaby-computer","kaby-account","kaby-help"]' && !kbsOf(en, leadEn).some((k) => /plugin|mcp|model|environment|advanced|channel|remote|phone/i.test(k)), kbsOf(en, leadEn))
  const withShell = page('en')
  withShell.bridge.receive({ kybernos: 'shell-state', version: 1, capabilities: { notifications: true, mode: true, screens: [] }, notifications: 'undetermined' })
  check('...and Notifications comes first, « Need more? » last, when the shell handles them', JSON.stringify(kbsOf(withShell, withShell.draw(withShell.ui.SimpleLead)).filter((k) => ours.test(k))) === '["kaby-notifications","kaby-computer","kaby-account","kaby-help","kaby-mode-switch"]')
  const said = en.text(leadEn) + ' ' + asking.text
  check('no word of the engine\'s wording: no « DeepSeek », « Harness », « Remote control », « Telegram », no model or plugin settings', !/DeepSeek|Harness|Remote control|Telegram|WhatsApp|plugin|MCP|API key/i.test(said), said.slice(0, 300))
  check('what the browser half hands out is the connect card, the sections of the page and the mount: no bar, no sheet, no menu, no page of its own', Object.keys(en.ui).sort().join() === 'AccountSection,CSS,ComputerSection,ConnectCard,HelpSection,ModeSection,NotificationsSection,Root,SimpleLead,mount', Object.keys(en.ui))
  check('the root is one box and nothing else while no app is asked for (no chip, no model name: the composer\'s own picker says it); with a request the connect card comes in too', en.walk(en.draw(en.ui.Root)).map((n) => n.props.className).filter(Boolean).join() === 'kbk-root' && (() => { en.setCurrent({ id: 'req1', toolkit: 'gmail', name: 'Gmail', phase: 'asking', error: '' }); const has = en.walk(en.draw(en.ui.Root)).some((n) => n.props['data-kb'] === 'kaby-connect-card'); en.setCurrent(null); return has })())
  // ── the switch line, the sections of the page of the app ──
  console.log('the root, the sections')
  const posted = []
  const sw = page('en', fakeReact, () => null, posted)
  const switchKb = (p) => p.draw(p.ui.ModeSection) !== null
  check('« Need more? » is not drawn until the shell says it can switch (a build with no Advanced mode shows nothing), and the page cannot send set-mode before', switchKb(sw) === false && sw.bridge.setMode('advanced') === false && posted.length === 0)
  sw.bridge.receive({ kybernos: 'shell-state', version: 1, capabilities: { mode: true, screens: [] }, connection: 'local' })
  const swNode = sw.draw(sw.ui.ModeSection)
  check('after the shell says `mode`, the card says what Advanced is, and has one button', swNode !== null && sw.walk(swNode)[0].props['data-kb'] === 'kaby-mode-switch' && /Need more\?/.test(sw.text(swNode)) && /Switch to Advanced/.test(sw.text(swNode)) && sw.walk(swNode).filter((n) => n.type === 'button').length === 1, swNode && sw.text(swNode))
  // the button goes through the display seam when the page has one (it keeps the choice with the account first, then asks the shell: one tick later), else straight to the shell
  // (this page's display seam is mounted too: it keeps the choice first, then speaks to the shell through the door the page's `__KB_APP__` gives it: here, this test's bridge)
  sw.run.win.__KB_APP__ = { requestMode: (m) => sw.bridge.setMode(m) }
  sw.walk(swNode).find((n) => n.type === 'button').props.onClick()
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
  check('the button asks the shell for Advanced with one `set-mode` message (through the display seam); a mode the page does not know is refused', posted.length === 1 && posted[0].kybernos === 'set-mode' && posted[0].version === 1 && posted[0].mode === 'advanced' && sw.bridge.setMode('expert') === false && posted.length === 1, posted)
  check('with no seam the button asks the shell itself, as it always did', (() => { const w = sw.run.win; const seam = w.__KB_MODE__; delete w.__KB_MODE__; sw.walk(sw.draw(sw.ui.ModeSection)).find((n) => n.type === 'button').props.onClick(); w.__KB_MODE__ = seam; return posted.length === 2 && posted[1].kybernos === 'set-mode' && posted[1].mode === 'advanced' })(), posted)
  check('in the Kaby app the page\'s own bridge is the seam\'s door to the shell', typeof runPage({ ua: KABY_IOS }).win.__KB_APP__.requestMode === 'function' && runPage({ ua: IOS }).win.__KB_APP__.requestMode === undefined)
  check('the shell saying `mode: false` (or nothing) takes the card away again', (() => { sw.bridge.receive({ kybernos: 'shell-state', version: 1, capabilities: { mode: false, screens: [] } }); return switchKb(sw) === false && sw.bridge.shell().mode === false })())
  const swFr = page('fr'); swFr.bridge.receive({ kybernos: 'shell-state', version: 1, capabilities: { mode: true, screens: [] } })
  check('in French the card is French: Besoin de plus ?, Passer en Avancé', (() => { const n = swFr.draw(swFr.ui.ModeSection); return /Besoin de plus/.test(swFr.text(n)) && /Passer en Avancé/.test(swFr.text(n)) })())

  const noteLine = (p, shellMsg) => { if (shellMsg) p.bridge.receive(shellMsg); const n = p.draw(p.ui.NotificationsSection); return { drawn: n !== null, text: p.text(n), acts: n === null ? [] : p.walk(n).map((x) => x.props['data-act']).filter(Boolean) } }
  const n0 = noteLine(page('en'), null)
  check('before the shell answers (or with a shell that cannot handle notifications) there is no Notifications card: nothing says what the app cannot do yet', n0.text === '' && n0.acts.length === 0 && n0.drawn === false, n0)
  const n1 = noteLine(page('en'), { kybernos: 'shell-state', version: 1, capabilities: { notifications: true, screens: ['notification-settings'] }, notifications: 'undetermined' })
  check('undecided: « Turn on »', n1.acts.join() === 'kaby-notifications-on', n1)
  const pd = page('en')
  const n2 = noteLine(pd, { kybernos: 'shell-state', version: 1, capabilities: { notifications: true, screens: ['notification-settings'] }, notifications: 'denied' })
  check('refused on the phone: the way to the phone\'s settings, when the shell has that screen', n2.acts.join() === 'kaby-notifications-phone-settings', n2)
  const n3 = noteLine(page('en'), { kybernos: 'shell-state', version: 1, capabilities: { notifications: true, screens: [] }, notifications: 'granted' })
  check('on: the line says a notification never carries what was said', /never what was said/.test(n3.text) && n3.acts.length === 0, n3)
  // the computer card says where Kaby works, in words that fit the product: on this phone the « computer » is the phone
  const compCard = (lang, msg) => { const p = page(lang); if (msg) p.bridge.receive(msg); return p.text(p.draw(p.ui.ComputerSection)) }
  const onPhone = compCard('en', { kybernos: 'shell-state', version: 1, capabilities: {}, connection: 'local' })
  check('on the phone engine the card is « Where Kaby works »: this phone, the small model, and that heavier jobs need a computer (yours or the cloud); it never calls the phone « your computer » or says « works here »', /Where Kaby works/.test(onPhone) && /On this phone, with the app’s small model/.test(onPhone) && /yours or one in the cloud/.test(onPhone) && !/Your computer|works here/.test(onPhone), onPhone)
  check('in French the same card is French', /Où Kaby travaille/.test(compCard('fr', { kybernos: 'shell-state', version: 1, capabilities: {}, connection: 'local' })) && /Sur ce téléphone/.test(compCard('fr', { kybernos: 'shell-state', version: 1, capabilities: {}, connection: 'local' })))
  {
    const compPosted = []
    const pl = page('en', fakeReact, () => null, compPosted)
    pl.bridge.receive({ kybernos: 'shell-state', version: 1, capabilities: { screens: ['where'] }, connection: 'local' })
    const localTree = pl.draw(pl.ui.ComputerSection)
    const connectBtn = pl.walk(localTree).find((n) => n.props['data-act'] === 'kaby-connect-computer')
    check('ComputerSection: when connection is local and screens includes where, shows data-act=kaby-connect-computer calling bridge.openScreen("where")',
      connectBtn !== undefined && /Connect a computer/.test(pl.text(connectBtn)) && (connectBtn.props.onClick(), compPosted.length === 1 && compPosted[0].kybernos === 'open-screen' && compPosted[0].screen === 'where'), { btn: connectBtn && connectBtn.props, compPosted })
    const plFr = page('fr')
    plFr.bridge.receive({ kybernos: 'shell-state', version: 1, capabilities: { screens: ['where'] }, connection: 'local' })
    const frBtn = plFr.walk(plFr.draw(plFr.ui.ComputerSection)).find((n) => n.props['data-act'] === 'kaby-connect-computer')
    check('ComputerSection: in French the button says « Connecter un ordinateur »', frBtn !== undefined && /Connecter un ordinateur/.test(plFr.text(frBtn)))
    const noScreen = page('en')
    noScreen.bridge.receive({ kybernos: 'shell-state', version: 1, capabilities: { screens: ['account'] }, connection: 'local' })
    const onRemote = page('en')
    onRemote.bridge.receive({ kybernos: 'shell-state', version: 1, capabilities: { screens: ['where'] }, connection: 'remote' })
    const onCloud = page('en')
    onCloud.bridge.receive({ kybernos: 'shell-state', version: 1, capabilities: { screens: ['where'] }, connection: 'cloud' })
    check('ComputerSection: no connect-computer button when screens omits where, or when connection is not local',
      !noScreen.walk(noScreen.draw(noScreen.ui.ComputerSection)).some((n) => n.props['data-act'] === 'kaby-connect-computer') &&
      !onRemote.walk(onRemote.draw(onRemote.ui.ComputerSection)).some((n) => n.props['data-act'] === 'kaby-connect-computer') &&
      !onCloud.walk(onCloud.draw(onCloud.ui.ComputerSection)).some((n) => n.props['data-act'] === 'kaby-connect-computer'))
  }
  check('through the phone link it is the person\'s own computer; with no news yet it says so', /Your computer/.test(compCard('en', { kybernos: 'shell-state', version: 1, capabilities: {}, connection: 'remote' })) && /phone link/.test(compCard('en', { kybernos: 'shell-state', version: 1, capabilities: {}, connection: 'remote' })) && /No information yet/.test(compCard('en', null)))

  const pa = page('en')
  const a0 = pa.text(pa.draw(pa.ui.AccountSection))
  check('Account and plan says plainly when the shell has no such screen, and has no button', /cannot open it from here yet/.test(a0) && !/My account|My plan/.test(a0))
  const pb = page('en')
  pb.bridge.receive({ kybernos: 'shell-state', version: 1, capabilities: { screens: ['account', 'plan', 'help'] } })
  const acts = pb.walk(pb.draw(pb.ui.AccountSection)).map((n) => n.props['data-act']).filter(Boolean)
  const helpActs = pb.walk(pb.draw(pb.ui.HelpSection)).map((n) => n.props['data-act']).filter(Boolean)
  check('Account, Plan and Help open the shell\'s own screens, only those it said it has', ['kaby-open-account', 'kaby-open-plan'].every((a) => acts.includes(a)) && !acts.includes('kaby-open-where') && helpActs.includes('kaby-open-help'))

  // ── the leftovers of the phone retest (2026-11-21): a plain sentence in the composer, a word on the help button ──
  console.log('the composer sentence and the help button')
  const tEn = runPage({ ua: IOS, lang: 'en' }).test
  const tFr = runPage({ ua: IOS, lang: 'fr' }).test
  check('the composer asks in plain words, in English and in French (no « /commands », no « @ files »)', tEn.kabyAsk() === 'Ask Kaby anything' && tFr.kabyAsk() === 'Demande quelque chose à Kaby' && !/[/@]/.test(tEn.kabyAsk() + tFr.kabyAsk()), [tEn.kabyAsk(), tFr.kabyAsk()])
  const fakeComposer = (opts = {}) => {
    const attrs = Object.assign({ 'data-placeholder': 'Describe what you want to build, / commands, @ files or sessions', 'aria-label': 'Describe what you want to build, / commands, @ files or sessions' }, opts.attrs || {})
    const input = { getAttribute: (n) => (n in attrs ? attrs[n] : null), setAttribute: (n, v) => { attrs[n] = String(v) } }
    const textNode = { nodeType: 3, nodeValue: 'Describe what you want to build, / commands, @ files or sessions' }
    const ph = { childNodes: opts.kids || [textNode], firstChild: (opts.kids || [textNode])[0] }
    const doc = { body: {}, querySelector: (sel) => (sel === '[data-composer-input]' ? (opts.noInput ? null : input) : (sel === '[data-composer-placeholder]' ? ph : null)) }
    return { doc, attrs, textNode, ph }
  }
  {
    const f = fakeComposer()
    check('the engine\'s sentence is replaced in the three places it lives (the visible text, the field\'s data-placeholder, its accessible name)', tEn.placeholderPass(f.doc, 'Ask Kaby anything') === true && f.textNode.nodeValue === 'Ask Kaby anything' && f.attrs['data-placeholder'] === 'Ask Kaby anything' && f.attrs['aria-label'] === 'Ask Kaby anything', { n: f.textNode.nodeValue, a: f.attrs })
    check('a second pass changes nothing and says so (no write loop with the watch)', tEn.placeholderPass(f.doc, 'Ask Kaby anything') === false)
    const off = fakeComposer({ attrs: { contenteditable: 'false' } })
    check('a field that cannot be typed in keeps the engine\'s own sentence', tEn.placeholderPass(off.doc, 'Ask Kaby anything') === false && /Describe/.test(off.textNode.nodeValue) && /Describe/.test(off.attrs['aria-label']))
    const dis = fakeComposer({ attrs: { 'aria-disabled': 'true' } })
    check('...also when it says it is disabled', tEn.placeholderPass(dis.doc, 'Ask Kaby anything') === false && /Describe/.test(dis.textNode.nodeValue))
    check('no composer on the page: nothing happens, nothing throws', tEn.placeholderPass(fakeComposer({ noInput: true }).doc, 'x') === false && tEn.placeholderPass({ querySelector () { throw new Error('boom') } }, 'x') === false)
    const el = fakeComposer({ kids: [{ nodeType: 1, childNodes: [] }, { nodeType: 3, nodeValue: 'x' }] })
    check('a placeholder that is not one plain text node is left alone (the engine changed its shape: do not guess)', (tEn.placeholderPass(el.doc, 'Ask Kaby anything'), el.ph.childNodes[1].nodeValue === 'x'))
  }
  {
    const f = fakeComposer()
    let observed = null
    const timers = []
    class FakeObserver { constructor (cb) { this.cb = cb; this.gone = false } observe (target, opts) { observed = { target, opts, o: this } } disconnect () { this.gone = true } }
    const win = { MutationObserver: FakeObserver, setInterval: (fn, ms) => { timers.push({ fn, ms }); return timers.length }, clearInterval: () => {} }
    const w = tEn.startPlaceholder(win, f.doc, () => 'Ask Kaby anything')
    check('the watch writes our sentence at once and looks at text, children and the three attributes it cares about', f.textNode.nodeValue === 'Ask Kaby anything' && observed !== null && observed.opts.characterData === true && observed.opts.childList === true && observed.opts.subtree === true && observed.opts.attributeFilter.join() === 'data-placeholder,aria-label,contenteditable', observed && observed.opts)
    f.textNode.nodeValue = 'Message or run a task, / commands, @ files or sessions'; f.attrs['aria-label'] = 'Message or run a task, / commands, @ files or sessions'
    observed.o.cb([{}]); observed.o.cb([{}])
    await Promise.resolve(); await Promise.resolve()
    check('when the engine writes its own sentence back (the blank page became a chat) the watch puts ours back, once per batch, before the next paint', f.textNode.nodeValue === 'Ask Kaby anything' && f.attrs['aria-label'] === 'Ask Kaby anything')
    check('a slow timer covers a language change; stop() lets everything go', timers.length === 1 && timers[0].ms === 3000 && (w.stop(), observed.o.gone === true))
    const noObs = fakeComposer()
    const w2 = tEn.startPlaceholder({}, noObs.doc, () => 'Ask Kaby anything')
    check('a page with no MutationObserver still gets the sentence once, and does not throw', noObs.textNode.nodeValue === 'Ask Kaby anything' && (w2.stop(), true))
  }
  check('the page mounts that watch for Kaby mode, and removes it', /startPlaceholder\(window, document, kabyAsk\)/.test(SOURCE) && /kaby composer sentence/.test(SOURCE))

  // ── the phone's own words: « this computer » is « this phone » on the phone's own engine ──
  console.log('the phone\'s own words')
  {
    const T = tEn
    check('« cet ordinateur » and « cette machine » are « ce téléphone » (with their capital), « this computer » and « this machine » are « this phone »',
      T.phoneWordsText('Cet ordinateur · Aucun run en cours') === 'Ce téléphone · Aucun run en cours' && T.phoneWordsText('Légère : un run à la fois sur cette machine.') === 'Légère : un run à la fois sur ce téléphone.'
      && T.phoneWordsText('Cette machine') === 'Ce téléphone' && T.phoneWordsText('Kybernos cannot find this computer’s key') === 'Kybernos cannot find this phone’s key' && T.phoneWordsText('This computer') === 'This phone' && T.phoneWordsText('on this machine') === 'on this phone')
    check('only the demonstrative is swapped: the cloud computer, « Charge de l’ordinateur » and any other computer keep their words', T.phoneWordsText('Son cloud computer') === 'Son cloud computer' && T.phoneWordsText('Sur son ordinateur cloud') === 'Sur son ordinateur cloud' && T.phoneWordsText('Computer load') === 'Computer load' && T.phoneWordsText('cet ordinateurs') === 'cet ordinateurs' && T.phoneWordsText('microcomputer') === 'microcomputer')
    check('a swap is final (idempotent), and anything that is not a text goes through untouched', T.phoneWordsText(T.phoneWordsText('depuis cet ordinateur')) === 'depuis ce téléphone' && T.phoneWordsText('') === '' && T.phoneWordsText(null) === null && T.phoneWordsText(3) === 3)
    check('the place comes from the user agent: local by default and when the shell does not say, cloud only when it says so', T.kabyPlace('x KybernosPlace/cloud') === 'cloud' && T.kabyPlace('x KybernosPlace/local KabyMode/1') === 'local' && T.kabyPlace(IOS) === 'local' && T.kabyPlace(undefined) === 'local' && T.kabyPlace('x KybernosPlace/clouds') === 'local')
  }
  const fakePage = (texts, opts = {}) => {
    const mkEl = (cls, parent) => ({ cls, parent: parent || null, attrs: {}, closest (sel) { for (let e = this; e !== null; e = e.parent) { if (sel.split(',').some((x) => { x = x.trim(); return (x.startsWith('.') && e.cls === x.slice(1)) || x === e.tag }) ) return e } return null } })
    const root = mkEl('section', null)
    const nodes = texts.map((t) => {
      const el = mkEl(t.cls || 'p', root)
      if (t.tag !== undefined) el.tag = t.tag
      if (t.label !== undefined) el.attrs['aria-label'] = t.label
      el.getAttribute = (a) => (a in el.attrs ? el.attrs[a] : null)
      el.setAttribute = (a, v) => { el.attrs[a] = String(v) }
      return { nodeType: 3, nodeValue: t.text, parentElement: el, el }
    })
    root.getAttribute = () => null
    root.setAttribute = () => {}
    const labelled = nodes.map((n) => n.el).filter((e) => 'aria-label' in e.attrs)
    root.querySelectorAll = () => labelled
    const doc = {
      body: {},
      querySelectorAll: (sel) => (opts.noRoots === true ? [] : (sel === tEn.PHONE_WORDS_ROOTS ? [root] : [])),
      createTreeWalker: () => { let i = -1; return { nextNode: () => { i += 1; return i < nodes.length ? nodes[i] : null } } }
    }
    return { doc, nodes }
  }
  {
    const f = fakePage([{ text: 'Cet ordinateur' }, { text: 'Où Kaby travaille' }, { text: 'Garde cette machine ouverte', label: 'Allumer cette machine' }, { text: 'sur cet ordinateur', cls: 'kbmem-tx' }, { text: 'cet ordinateur', tag: 'textarea' }])
    const n = tEn.phoneWordsPass(f.doc)
    check('the open pages say « ce téléphone »: the text nodes and the accessible names', n === 3 && f.nodes[0].nodeValue === 'Ce téléphone' && f.nodes[1].nodeValue === 'Où Kaby travaille' && f.nodes[2].nodeValue === 'Garde ce téléphone ouverte' && f.nodes[2].el.attrs['aria-label'] === 'Allumer ce téléphone', { n, v: f.nodes.map((x) => x.nodeValue) })
    check('what the person wrote (a memory lesson) and the fields are never touched', f.nodes[3].nodeValue === 'sur cet ordinateur' && f.nodes[4].nodeValue === 'cet ordinateur')
    check('a second pass changes nothing and says so (no write loop with the watch)', tEn.phoneWordsPass(f.doc) === 0)
    check('no page of ours open: nothing happens, nothing throws', tEn.phoneWordsPass(fakePage([{ text: 'Cet ordinateur' }], { noRoots: true }).doc) === 0 && tEn.phoneWordsPass({ querySelectorAll () { throw new Error('boom') } }) === 0 && tEn.phoneWordsPass({}) === 0)
    check('the pages it looks at are the Settings sections, the menus, the search dialog and the Automations load strip', /settings\.section/.test(tEn.PHONE_WORDS_ROOTS) && /role="menu"/.test(tEn.PHONE_WORDS_ROOTS) && /load-strip/.test(tEn.PHONE_WORDS_ROOTS) && /data-kb="search-dialog"/.test(tEn.PHONE_WORDS_ROOTS) && !/composer|message|conversation/.test(tEn.PHONE_WORDS_ROOTS))
  }
  {
    const f = fakePage([{ text: 'Cet ordinateur' }])
    let observed = null
    const timers = []
    class FakeObserver { constructor (cb) { this.cb = cb; this.gone = false } observe (target, opts) { observed = { target, opts, o: this } } disconnect () { this.gone = true } }
    const win = { MutationObserver: FakeObserver, navigator: { userAgent: IOS + ' KybernosPlace/local' }, setInterval: (fn, ms) => { timers.push({ fn, ms }); return timers.length }, clearInterval: () => {} }
    const w = tEn.startPhoneWords(win, f.doc)
    check('on the phone\'s own engine the watch swaps at once and watches the page\'s text and children', f.nodes[0].nodeValue === 'Ce téléphone' && observed !== null && observed.opts.characterData === true && observed.opts.childList === true && observed.opts.subtree === true)
    f.nodes[0].nodeValue = 'Cet ordinateur'
    observed.o.cb([{}]); observed.o.cb([{}])
    await Promise.resolve(); await Promise.resolve()
    check('a page that draws its text again gets it swapped again, once per batch, before the next paint', f.nodes[0].nodeValue === 'Ce téléphone')
    check('a slow timer covers a language change; stop() lets everything go', timers.length === 1 && timers[0].ms === 3000 && (w.stop(), observed.o.gone === true))
    const cloud = fakePage([{ text: 'Cet ordinateur' }])
    const wc = tEn.startPhoneWords({ MutationObserver: FakeObserver, navigator: { userAgent: IOS + ' KybernosPlace/cloud' } }, cloud.doc)
    check('on a cloud computer « this computer » really is the computer: nothing is swapped', cloud.nodes[0].nodeValue === 'Cet ordinateur' && (wc.stop(), true))
    const bare = fakePage([{ text: 'Cet ordinateur' }])
    const wb = tEn.startPhoneWords({ navigator: { userAgent: IOS } }, bare.doc)
    check('a page with no MutationObserver still gets the swap once, and does not throw', bare.nodes[0].nodeValue === 'Ce téléphone' && (wb.stop(), true))
  }
  check('the page mounts that watch for Kaby mode, and removes it', /startPhoneWords\(window, document\)/.test(SOURCE) && /kaby phone wording/.test(SOURCE))
  check('the dock\'s « New chat » is French on a French phone (the Kybernos button\'s French source is the English word, so it is not copied), and the app page\'s « iPhone or iPad » is read at each draw (the language is not known when the page is built)',
    /own !== 'New chat' \? own : kt\('Nouveau chat', 'New chat'\)/.test(SOURCE) && /const where = \(\) => \(host\.platform === 'ios' \? kt\('iPhone ou iPad', 'iPhone or iPad'\)/.test(SOURCE) && (SOURCE.match(/' · ' \+ where\(\) \+ '\.'/g) || []).length === 2)
  {
    const seen = []
    const ph = page('en', fakeReact, () => null, [], { ReportTail: (p) => { seen.push(p); return null } })
    ph.draw(ph.ui.HelpSection)
    check('the help card asks for the report control with a visible label (and no answer text)', seen.length >= 1 && seen.every((p) => p.labelled === true && p.noText === true), seen)
    check('...and its CSS undoes the phone\'s 36 px flag for that button only (word back in sight, outline like its neighbours, no icon drawn)', /\.kbk-help \[data-kb="report-tail"\] > button\[data-act="report-open"\]\{[^}]*width:auto[^}]*text-indent:0[^}]*border:1px solid[^}]*border-radius:10px/.test(ph.ui.CSS) && /\.kbk-help \[data-kb="report-tail"\] > button\[data-act="report-open"\]::before\{content:none/.test(ph.ui.CSS))
    check('the label of the control is « Report an answer » / « Signaler une réponse » when labelled, the flag\'s own words under an answer', /openWords = labelled \? kt\('Signaler une réponse', 'Report an answer'\) : kt\('Signaler cette réponse', 'Report this answer'\)/.test(SOURCE) && /labelled \? openWords : kt\('Signaler', 'Report'\)/.test(SOURCE))
  }
}

console.log('Simple = the full app\'s own screens, filtered by the preset (no copy of them here)')
{
  const MOBILE_CSS = readFileSync(join(here, 'mobile.css'), 'utf8')
  const PLUGIN = readFileSync(join(here, '..', 'kybernos-plugin', 'client.js'), 'utf8')
  const gone = ['SettingsSheet', 'MenuDrawer', 'RemindersPage', 'AppsPage', 'ChatsPage', 'MemorySection', 'AppearanceSection', 'openRealSettings', 'realSettingsOf', 'syncSettingsClass', 'lockedDoc', 'menuRowsOf', 'MENU_ROWS', 'KABY_SETTINGS_CLASS', 'kb-kaby-settings']
  check('the copies are gone from the browser half: the settings sheet, the menu drawer, the Reminders, Apps and Conversations pages, the Memory and Appearance cards, the gear that chose between the real Settings and the sheet', gone.filter((w) => SOURCE.includes(w)).length === 0, gone.filter((w) => SOURCE.includes(w)))
  check('the phone\'s own drawer, dock and avatar are drawn in Simple too: no rule of mobile.css is cut off from Kaby mode, and `c2On` asks only for the app and a phone', !/kb-kaby/.test(MOBILE_CSS) && /const c2On = \(\) => \{ try \{ return appHost\(\) !== null && phone\(\) \} catch/.test(SOURCE))
  check('the rows of Simple come from the locked preset through the plugin\'s own menu code: SalesMenu follows kbSurfaceDoc (the preset in Kaby mode, the person\'s arrangement elsewhere) and redoes it when the presets become readable', /const prefs = kbSurfaceDoc\(\)/.test(PLUGIN) && /'kb-locked-presets-ready'/.test(PLUGIN))
  check('Kaby mode no longer listens for the presets or lifts anything: the fallback (a preset that cannot be read) is the plugin\'s, which then filters nothing; the one read left is `presetAppPage` (the `appPage` option of « The Kybernos app » page, read when the page draws, never listened to, and `{}` = draw everything)', !/kb-locked-presets-ready/.test(SOURCE) && (SOURCE.match(/__KB_THEME_LOCKED__/g) || []).length === 1 && /const presetAppPage = \(\) => \{\s*try \{\s*const l = window\.__KB_THEME_LOCKED__[\s\S]*?l\.options\('locked-simple'\)[\s\S]*?\} catch \(e\) \{ return \{\} \}/.test(SOURCE))

  // « The Kybernos app » in Simple: Kaby's own sections on top, the way out of Simple, the account doors
  const CAPS = ' KybernosCaps/account,plans,referral,where,signout,mode'
  const SHELL = { kybernos: 'shell-state', version: 1, capabilities: { authorize: true, notifications: true, mode: true, screens: ['account', 'plan', 'help', 'where'] }, notifications: 'undetermined', connection: 'cloud' }
  const uiOf = (r, state = null) => {
    const bridge = r.test.buildKabyBridge(r.win, { platform: 'ios', version: '0.1.0' }, { version: 1, asked: 1 })
    if (state !== null) bridge.receive(state)
    return r.test.buildKabyUi(fakeReact, { createRoot () {} }, { platform: 'ios', version: '0.1.0' }, { version: 1, asked: 1 }, bridge, { subscribe: () => () => {}, current: () => null }, { ReportTail: () => null })
  }
  const expand = (n) => {
    if (n === null || n === undefined || typeof n !== 'object' || !Array.isArray(n.a)) return n
    const [type, props, ...kids] = n.a
    if (typeof type === 'function') return expand(type(Object.assign({}, props, kids.length === 0 ? {} : { children: kids.length === 1 ? kids[0] : kids })))
    return { type, props: props || {}, kids: kids.flat(Infinity).map(expand) }
  }
  const walk = (n, out = []) => { if (n && typeof n === 'object') { if (n.props) out.push(n); (n.kids || []).forEach((k) => walk(k, out)) } return out }
  const draw = (C, props) => expand(fakeReact.createElement(C, props || {}))
  const sh = runPage({ ua: KABY_IOS + CAPS })
  const ui1 = uiOf(sh, SHELL)
  const lead = walk(draw(ui1.SimpleLead))
  const hooks = lead.map((n) => n.props['data-kb']).filter(Boolean)
  check('the top of the page is what DSH\'s Settings has no page for: notifications, where Kaby works, account and plan, help and report, « Need more? » (the way out of Simple)', ['kaby-notifications', 'kaby-computer', 'kaby-account', 'kaby-help', 'kaby-mode-switch'].every((k) => hooks.includes(k)), hooks)
  check('Account and plan carries My account, My plan, Where Kybernos runs AND Referral (the shell lists `referral` in its caps)', ['kaby-open-account', 'kaby-open-plan', 'kaby-open-where', 'kaby-open-referral'].every((a) => lead.some((n) => n.props['data-act'] === a)))
  lead.find((n) => n.props['data-act'] === 'kaby-open-referral').props.onClick()
  check('Referral opens the native screen by the link the full app\'s account menu uses', JSON.stringify(sh.assigned) === '["kybernos://referral"]', sh.assigned)
  const noRef = runPage({ ua: KABY_IOS + ' KybernosCaps/account,mode' })
  check('a shell that does not list `referral` gets no Referral button, and the other doors stay as the shell says', !walk(draw(uiOf(noRef, SHELL).SimpleLead)).some((n) => n.props['data-act'] === 'kaby-open-referral'))
  const appUi = sh.test.buildAppUi(fakeReact, { platform: 'ios', version: '0.1.0' })
  const simplePage = walk(expand(fakeReact.createElement(appUi.Page, { simple: true, lead: { a: ['div', { 'data-kb': 'LEAD' }] } })))
  const fullPage = walk(expand(fakeReact.createElement(appUi.Page, {})))
  check('in Simple the page of the app shows Kaby\'s sections, not the card that says « switch to Simple »; in the full app it is the card, as before', simplePage.some((n) => n.props['data-kb'] === 'LEAD') && !simplePage.some((n) => n.props['data-kb'] === 'mobile-mode-switch') && fullPage.some((n) => n.props['data-kb'] === 'mobile-mode-switch') && !fullPage.some((n) => n.props['data-kb'] === 'LEAD'))
  check('...and the rest of the page (engine log, licences, automations) is the same in both', ['mobile-app-log', 'mobile-app-notices', 'mobile-app-auto'].every((k) => simplePage.some((n) => n.props['data-kb'] === k) && fullPage.some((n) => n.props['data-kb'] === k)))
  check('the « Model key » card (bring-your-own Anthropic key) is not in Simple, where the models come from Kybernos Models, and stays in the full app on a phone', !simplePage.some((n) => n.props['data-kb'] === 'mobile-app-key') && fullPage.some((n) => n.props['data-kb'] === 'mobile-app-key'))
  const settingsRow = simplePage.find((n) => n.props['data-kb'] === 'mobile-app-settings')
  check('in Simple ONE row, « App settings », replaces the key card: it is the only way left from the page to the app\'s own Settings screen (the shell\'s gear is gone), and it says nothing of a key', !!settingsRow && !fullPage.some((n) => n.props['data-kb'] === 'mobile-app-settings') && !JSON.stringify(simplePage.find((n) => n.props['data-kb'] === 'mobile-app-settings') || {}).match(/Anthropic|clé du modèle|key/i), settingsRow && settingsRow.props)
  const openBtn = simplePage.find((n) => n.props['data-act'] === 'open-app-settings')
  check('its button opens `kybernos://settings`, the app\'s own Settings', !!openBtn && (() => { const before = sh.assigned.length; openBtn.props.onClick(); return sh.assigned.slice(before).join() === 'kybernos://settings' })(), sh.assigned)
  lead.find((n) => n.props['data-act'] === 'kaby-mode-advanced').props.onClick()
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
  check('« Need more? » asks the shell for Advanced (the way out of Simple stays one tap from the account menu\'s Settings)', sh.kinds().includes('set-mode') && JSON.parse(sh.posted[sh.posted.length - 1]).mode === 'advanced', sh.posted.slice(-1))
  // ── « The Kybernos app » in Simple follows the preset's `appPage` option (Step 6 part 3): no engine-log card, and the computer card only when a computer is really linked. A preset that cannot be read = everything drawn ──
  console.log('« The Kybernos app » page and the preset\'s appPage option')
  {
    const HOST = { platform: 'ios', version: '0.1.0' }
    const KABY = { version: 1, asked: 1 }
    const lockedWith = (appPage) => Object.freeze({ v: 1, ids: ['locked-simple'], get: () => null, options: (id) => (id === 'locked-simple' ? { touch: true, appPage } : {}), name: () => 'Simple' })
    const logOf = (r, props) => walk(expand(fakeReact.createElement(r.test.buildAppUi(fakeReact, HOST).Page, props))).some((n) => n.props['data-kb'] === 'mobile-app-log')
    const compOf = (r, shell, where) => {
      const bridge = r.test.buildKabyBridge(r.win, HOST, KABY)
      bridge.receive(Object.assign({ kybernos: 'shell-state', version: 1, capabilities: {} }, shell))
      r.win.__KB_KYBER__ = { where: () => where, subscribe: () => () => {} }
      const ui = r.test.buildKabyUi(fakeReact, { createRoot () {} }, HOST, KABY, bridge, { subscribe: () => () => {}, current: () => null }, { ReportTail: () => null })
      const n = draw(ui.ComputerSection)
      return n === null ? '' : walk(n).filter((x) => x.props['data-kb'] === 'kaby-computer-line').map((x) => (x.kids || []).join(' ')).join('')
    }
    const SIMPLE = { simple: true, lead: { a: ['div', { 'data-kb': 'LEAD' }] } }
    const none = runPage({ ua: KABY_IOS })
    check('no preset readable (the Theme plugin is off or late): the engine log is drawn in Simple and in the full app, as before', logOf(none, SIMPLE) === true && logOf(none, {}) === true)
    const r1 = runPage({ ua: KABY_IOS })
    r1.win.__KB_THEME_LOCKED__ = lockedWith({ log: false, computer: 'linked' })
    check('the preset says `log: false`: Simple has no « Engine log » card, the full app keeps it (the full page never reads the preset)', logOf(r1, SIMPLE) === false && logOf(r1, {}) === true)
    const r2 = runPage({ ua: KABY_IOS })
    r2.win.__KB_THEME_LOCKED__ = lockedWith({})
    check('an `appPage` with no word in it draws everything (reversing is one word in the preset)', logOf(r2, SIMPLE) === true)
    const r3 = runPage({ ua: KABY_IOS })
    r3.win.__KB_THEME_LOCKED__ = Object.freeze({ v: 1, options: () => { throw new Error('broken') } })
    check('a preset that throws is not a reason to lose a card: everything is drawn', logOf(r3, SIMPLE) === true)
    const r4 = runPage({ ua: KABY_IOS })
    r4.win.__KB_THEME_LOCKED__ = Object.freeze({ v: 1, options: () => ({ appPage: 'no' }) })
    check('an `appPage` that is not an object is ignored', logOf(r4, SIMPLE) === true)

    const CLOUD = { connection: 'cloud' }
    const rc = runPage({ ua: KABY_IOS })
    check('without the preset the computer card says « No information yet » and « Your computer: ready », as before', /No information yet/.test(compOf(rc, CLOUD, null)) && /Your computer: ready/.test(compOf(rc, CLOUD, { local: true })))
    const rl = runPage({ ua: KABY_IOS })
    rl.win.__KB_THEME_LOCKED__ = lockedWith({ computer: 'linked' })
    check('with `computer: \'linked\'` a card with nothing to say is not drawn: no news yet, or the engine is the phone\'s own', compOf(rl, CLOUD, null) === '' && compOf(rl, CLOUD, { local: true }) === '')
    check('...and a computer that IS linked still has its card: the person\'s own computer through the phone link, the phone\'s own engine (« Where Kaby works »), and Kaby\'s cloud computer', /phone link/.test(compOf(rl, { connection: 'remote' }, null)) && /small model/.test(compOf(rl, { connection: 'local' }, null)) && /Studio/.test(compOf(rl, CLOUD, { local: false, computers: [{ id: 'c1', name: 'Studio' }], picked: 'c1' })), [compOf(rl, { connection: 'remote' }, null), compOf(rl, { connection: 'local' }, null), compOf(rl, CLOUD, { local: false, computers: [{ id: 'c1', name: 'Studio' }], picked: 'c1' })])
  }

  const fr = runPage({ ua: KABY_IOS, lang: 'fr' })
  check('the parts say it in French too (the sections on top, and the part filed under About is drawn, not a Settings page)', fr.registered.filter((r) => r.name === 'settings.section').length === 0 && (fr.win.__KB_ABOUT_EXTRA__ || []).length === 1 && /Besoin de plus \?/.test(SOURCE) && /Compte et offre/.test(SOURCE) && /Parrainage/.test(SOURCE))
}

console.log('the written contract')
{
  const t = runPage({ ua: IOS }).test
  check('the document for the shell exists', existsSync(CONTRACT_FILE))
  const doc = existsSync(CONTRACT_FILE) ? readFileSync(CONTRACT_FILE, 'utf8') : ''
  const words = [...Object.values(t.KABY_OUT), ...Object.values(t.KABY_IN), ...t.KABY_SCREENS, ...t.KABY_WHY, KABY_UA_TOKEN, 'notifications-ask', 'authorize-result', 'system browser', 'window.open']
  check('it names every message, every screen, every reason, the token and the new-window case', words.every((w) => doc.includes(w)), words.filter((w) => !doc.includes(w)))
  check('it says a notification never carries anyone\'s words, and which side asks for the permission', /never carr/i.test(doc) && /permission/i.test(doc) && /rate-limit|rate limit/i.test(doc))
  check('the README lists every hidden row and every shown row of the list by id', KABY_HIDE.every((r) => README.includes('`' + r.id + '`')) && KABY_SHOW.every((r) => README.includes('`' + r.id + '`')), [...KABY_HIDE, ...KABY_SHOW].filter((r) => !README.includes('`' + r.id + '`')).map((r) => r.id))
  check('the README says how to turn it on and that the full app is unchanged', /KabyMode\/1/.test(README) && /full app/i.test(README))
  const NO_MODE = SOURCE.replace(/\/\/ <kb-mode>[\s\S]*?\/\/ <\/kb-mode>/, '') // the display mode's own block keeps the person's choice (mode.mjs, test-mode.mjs)
  check('the browser half keeps no state and no colour of its own beyond the page tokens', !/localStorage|sessionStorage|indexedDB/.test(NO_MODE) && !/#[0-9a-fA-F]{3,8}\b/.test(SOURCE))
}

if (failed > 0) { console.log('\n' + failed + ' failed'); process.exit(1) }
console.log('\nall passed')
