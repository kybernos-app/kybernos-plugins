// ux-bug-hunter: page-side detectors.
//
// Inject into a page (`page.evalJs(src)` of scripts/live-page.mjs, or CDP Runtime.evaluate), then:
//   JSON.stringify(window.__UXH__.scan())           findings on the open dialog, else on the whole page
//   window.__UXH__.frame()                          boxes of the shell's landmarks (take one per page)
//   window.__UXH__.diffFrames([{ label, frame }])   what moved or resized between the first frame and the others
//
// READ-ONLY: it measures. It never clicks, types or edits the DOM; it only listens for errors from the moment it is injected.
// A finding is a suspect, not a verdict. level: bug (broken), ux (friction), check (look at it with your eyes).
// It cannot judge contrast, beauty or wording: those stay with the person looking at the screenshot.
(() => {
  if (window.__UXH__ !== undefined && window.__UXH__.version === 1) return 'ux-bug-hunter probes already installed'
  const CAP = 12
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION'])
  const INTERACTIVE = 'button,a[href],input:not([type="hidden"]),select,textarea,summary,[role="button"],[role="tab"],[role="menuitem"],[role="switch"],[role="checkbox"],[role="link"]'
  const BUTTONS = 'button,[role="button"],a[href]'
  const MARK = 'img,svg,canvas,picture,[role="img"],[style*="background-image"]'
  const VISUAL = 'img,canvas,iframe,video,picture,[style*="background-image"]'
  const JARGON = /\b[\w-]+\.(?:ya?ml|json|toml|env|mjs|cjs|tsx?|jsx?)\b|\bendpoints?\b|\bpayload\b|\bcordis\b|\bbundles?\b|`|(?:^|\s)[\w.-]+\/(?:\s|$)/i
  const S = { version: 1, errors: [], cls: 0 }

  const norm = (s) => String(s === null || s === undefined ? '' : s).replace(/\s+/g, ' ').trim()
  const vis = (el) => {
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false
    const r = el.getBoundingClientRect()
    return r.width >= 1 && r.height >= 1
  }
  const own = (el) => norm([...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join(' '))
  const cls1 = (el) => (typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] || '' : '')
  const where = (el) => {
    const bits = []
    for (let n = el, i = 0; n && n.nodeType === 1 && n !== document.body && i < 3; n = n.parentElement, i += 1) {
      const hook = n.getAttribute('data-kb') || n.getAttribute('data-act') || n.getAttribute('aria-label') || n.getAttribute('role')
      const cls = typeof n.className === 'string' ? n.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.') : ''
      bits.unshift(n.tagName.toLowerCase() + (hook ? '[' + hook.slice(0, 24) + ']' : '') + (cls ? '.' + cls.slice(0, 40) : ''))
    }
    return bits.join(' > ')
  }
  const label = (el) => {
    const by = el.getAttribute('aria-labelledby')
    const ref = by ? document.getElementById(by.split(' ')[0]) : null
    return norm(el.getAttribute('aria-label') || (ref && ref.textContent) || el.getAttribute('title') || el.textContent || el.getAttribute('placeholder') || '')
  }
  const words = (s) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').split(' ').filter((w) => w.length > 2)
  const overlap = (a, b) => {
    const A = words(a)
    const B = new Set(words(b))
    if (A.length < 2) return a.toLowerCase() === b.toLowerCase() ? 1 : 0
    return A.filter((w) => B.has(w)).length / A.length
  }
  const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)]

  // Lists of three or more same-shaped siblings that carry text: menu rows, cards, table rows, tabs.
  const groupsOf = (shown) => {
    const seen = new Set(shown)
    const out = []
    for (const p of shown) {
      const kids = [...p.children].filter((c) => seen.has(c))
      if (kids.length < 3 || kids.length > 300) continue
      const key = (c) => c.tagName + '|' + cls1(c)
      const n = {}
      for (const c of kids) n[key(c)] = (n[key(c)] || 0) + 1
      const best = Object.entries(n).sort((a, b) => b[1] - a[1])[0]
      if (best[1] < 3) continue
      const rows = kids.filter((c) => key(c) === best[0] && norm(c.textContent) !== '').filter((c) => { const r = c.getBoundingClientRect(); return r.height >= 18 && r.width >= 60 })
      if (rows.length >= 3) out.push({ parent: p, rows })
    }
    return out
  }
  // The logo, icon or monogram a row leads with (left half of the row, 10 to 72 px).
  const marksOf = (row) => {
    const rr = row.getBoundingClientRect()
    const lead = (m) => { const r = m.getBoundingClientRect(); return r.left < rr.left + rr.width / 2 && r.width >= 10 && r.width <= 72 && r.height >= 10 && r.height <= 72 }
    const found = [...row.querySelectorAll(MARK)].filter((m) => vis(m) && lead(m))
    if (found.length > 0) return found
    // No picture: a tile drawn by CSS (a background image or a filled square) or a monogram of one or two letters.
    return [...row.querySelectorAll('*')].filter((m) => {
      if (!vis(m) || !lead(m) || m.closest('svg') !== null || m.children.length > 1) return false
      const t = norm(m.textContent)
      if (t.length > 2) return false
      const cs = getComputedStyle(m)
      const filled = cs.backgroundColor !== 'rgba(0, 0, 0, 0)'
      return t.length === 0 ? (filled || cs.backgroundImage !== 'none') : (filled || cs.borderRadius !== '0px')
    })
  }
  const firstText = (row) => {
    const w = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (norm(n.nodeValue) === '' || (n.parentElement && n.parentElement.closest('svg') !== null)) continue
      const rg = document.createRange()
      rg.selectNodeContents(n)
      const b = rg.getBoundingClientRect()
      if (b.width > 0) return { left: b.left, mid: b.top + b.height / 2, text: norm(n.nodeValue) }
    }
    return null
  }

  function scan (rootArg) {
    const dlg = [...document.querySelectorAll('[role="dialog"],[aria-modal="true"]')].filter(vis).pop()
    const root = rootArg || dlg || document.body
    const out = []
    const add = (kind, level, el, text, detail) => out.push({ kind, level, where: el ? where(el) : '', text: String(text === undefined ? '' : text).slice(0, 80), detail: String(detail === undefined ? '' : detail).slice(0, 180) })
    const shown = [...root.querySelectorAll('*')].filter((e) => !SKIP.has(e.tagName) && e.closest('svg') === null && vis(e))
    const leaves = shown.map((el) => ({ el, t: own(el) })).filter((x) => x.t.length >= 3 && x.el.closest('code,pre,kbd,samp') === null)

    // Capitals: a title, label or badge shouted. Acronyms of up to four letters are left alone.
    for (const { el, t } of leaves) {
      const letters = t.replace(/[^\p{L}]/gu, '')
      if (letters.length < 2) continue
      const shouted = letters === letters.toUpperCase() && letters !== letters.toLowerCase()
      const css = getComputedStyle(el).textTransform === 'uppercase'
      if (shouted && letters.length <= 4) continue
      if (css || (shouted && letters.length >= 5)) add('caps', 'ux', el, t, css ? 'text-transform: uppercase' : 'written in capitals')
    }
    const heads = shown.filter((e) => /^H[1-6]$/.test(e.tagName) || e.getAttribute('role') === 'heading')
    for (const h of heads) {
      const t = norm(h.textContent)
      const w = t.split(' ')
      if (w.length >= 3 && w.slice(1).filter((x) => /^\p{Lu}\p{Ll}/u.test(x) && x.length > 3).length >= 2) add('title-case', 'check', h, t, 'most words capitalised; confirm the house style is sentence case')
      const next = h.nextElementSibling
      if (next !== null && vis(next)) {
        const b = norm(next.textContent)
        const [a, c] = t.length <= b.length ? [t, b] : [b, t]
        if (a.length >= 4 && b.length <= 240 && overlap(a, c) >= 0.8) add('repeat-title', 'ux', h, t, 'the line under the title says the same: "' + b.slice(0, 50) + '"')
      }
    }
    for (const { el, t } of leaves) if (/^(\p{L}[\p{L} ]{2,})\s*[›>\/]\s*\1$/iu.test(t)) add('repeat-label', 'ux', el, t, 'the same word on both sides of the separator')

    // Lists, grids, menus: logos, alignment, order, repetition, constants, previews.
    const pager = (() => { for (const { t } of leaves) { const m = /^(?:page\s+)?(\d+)\s*(?:\/|of|sur)\s*(\d+)$/i.exec(t); if (m !== null) return { cur: +m[1], total: +m[2] } } return null })()
    if (pager !== null && pager.total <= 1) add('pager-useless', 'check', null, 'Page ' + pager.cur + '/' + pager.total, 'a pager over a single page')
    for (const { parent, rows } of groupsOf(shown).slice(0, 60)) {
      if (rows.some((r) => r.querySelector('ul,ol,table,[role="list"],[role="grid"]') !== null)) continue // a list of lists is a layout, not a list
      const info = rows.map((r) => ({ r, m: marksOf(r), t: firstText(r) }))
      const rects = rows.map((r) => r.getBoundingClientRect())
      const name = (x) => (x.t ? x.t.text : '')
      const withMark = info.filter((x) => x.m.length > 0)
      if (withMark.length >= 2 && withMark.length < info.length && withMark.length / info.length >= 0.4) {
        for (const x of info) if (x.m.length === 0) add('no-mark', 'ux', x.r, name(x), withMark.length + ' of ' + info.length + ' siblings carry a logo or icon, this one does not')
      }
      const sizes = withMark.map((x) => Math.round(x.m[0].getBoundingClientRect().width))
      if (sizes.length >= 3 && Math.max(...sizes) - Math.min(...sizes) >= 3) add('icon-size', 'check', parent, '', 'marks of one list range from ' + Math.min(...sizes) + ' to ' + Math.max(...sizes) + ' px')
      if (info.length >= 4 && withMark.length === info.length) {
        const sig = (x) => { const m = x.m[0]; const cs = getComputedStyle(m); return m.tagName === 'IMG' ? m.currentSrc : (m.innerHTML + '|' + cs.backgroundColor + '|' + cs.backgroundImage).slice(0, 300) }
        const f = {}
        for (const x of info) f[sig(x)] = (f[sig(x)] || 0) + 1
        const top = Math.max(...Object.values(f))
        if (top / info.length >= 0.9) add('same-icon', 'check', parent, '', 'the same icon on ' + top + ' of ' + info.length + ' rows: it tells nothing')
      }

      const tops = rects.map((q) => q.top)
      const horizontal = Math.max(...tops) - Math.min(...tops) < 3 && rects.every((q, i) => i === 0 || q.left >= rects[i - 1].right - 1)
      const cs0 = getComputedStyle(rows[0])
      if (cs0.textAlign !== 'center' && cs0.justifyContent !== 'center') {
        if (horizontal) {
          const ys = info.filter((x) => x.t).map((x) => x.t.mid)
          const d = ys.length >= 3 ? Math.max(...ys) - Math.min(...ys) : 0
          if (d > 1.5 && d <= 12) add('misaligned', 'ux', parent, '', 'a row of ' + ys.length + ': text centres differ by ' + d.toFixed(1) + ' px')
        } else {
          const xs = info.map((x) => (x.m.length > 0 ? Math.min(x.m[0].getBoundingClientRect().left, x.t ? x.t.left : Infinity) : (x.t ? x.t.left : null))).filter((v) => v !== null)
          const spread = xs.length >= 3 ? Math.max(...xs) - Math.min(...xs) : 0
          if (spread > 1.5 && spread <= 16) {
            const med = median(xs)
            info.forEach((x, i) => { if (xs[i] !== undefined && Math.abs(xs[i] - med) > 1.5) add('misaligned', 'ux', x.r, name(x), 'leading edge ' + Math.round(xs[i] - med) + ' px off its siblings') })
          }
        }
      }

      const lines = []
      for (const q of rects) { const line = lines.find((l) => Math.abs(l.top - q.top) < 4); if (line) line.n += 1; else lines.push({ top: q.top, n: 1 }) }
      // A card alone on the last row of the LAST page is only a remainder; alone while another page follows, the page size is wrong.
      if (pager !== null && pager.cur < pager.total && lines.length >= 2 && lines[0].n >= 2 && lines[lines.length - 1].n === 1) {
        add('orphan', 'ux', rows[rows.length - 1], name(info[info.length - 1]), 'alone on the last row of a ' + lines[0].n + '-column grid while page ' + pager.cur + ' of ' + pager.total + ' is not the last: the page size is not a multiple of the columns')
      }
      const titles = info.map((x) => name(x).toLowerCase()).filter(Boolean)
      if (titles.length >= 6) {
        let inOrder = 0
        for (let i = 1; i < titles.length; i += 1) if (titles[i - 1].localeCompare(titles[i]) <= 0) inOrder += 1
        const ratio = inOrder / (titles.length - 1)
        if (ratio >= 0.8 && ratio < 1) add('order', 'check', parent, '', 'sorted except for ' + (titles.length - 1 - inOrder) + ' step(s): a list that looks ordered and is not')
      }

      const texts = info.map((x) => norm(x.r.textContent).toLowerCase())
      const dup = texts.filter((t, i) => t.length >= 3 && texts.indexOf(t) !== i)
      if (dup.length > 0) add('repeat-row', 'ux', parent, dup[0], dup.length + ' row(s) with the same text as an earlier one')
      if (info.length >= 4) {
        const f = {}
        for (const x of info) { const w = x.t ? x.t.text.split(' ')[0].toLowerCase() : ''; if (/^\p{L}{3,}$/u.test(w)) f[w] = (f[w] || 0) + 1 }
        const top = Object.entries(f).sort((a, b) => b[1] - a[1])[0]
        if (top && top[1] / info.length >= 0.75) add('repeat-word', 'check', parent, top[0], top[1] + ' of ' + info.length + ' rows start with the same word')
      }
      for (const x of info.slice(0, 60)) {
        const leafs = [...x.r.querySelectorAll('*')].filter(vis).map((e) => ({ e, t: own(e) })).filter((q) => q.t.length >= 2)
        const hit = leafs.find((a) => /\s[·|•]\s/.test(a.t) && leafs.some((b) => b.e !== a.e && a.t.split(/\s[·|•]\s/).map((p) => p.trim().toLowerCase()).includes(b.t.toLowerCase())))
        if (hit !== undefined) add('repeat-in-row', 'ux', x.r, hit.t, 'a value that is also shown on its own in the same row')
      }
      if (info.length >= 4) {
        const f = {}
        for (const x of info) {
          const rr = x.r.getBoundingClientRect()
          const here = new Set()
          for (const e of x.r.querySelectorAll('*')) { const t = own(e); if (t.length >= 2 && t.length <= 14 && vis(e) && e.getBoundingClientRect().left >= rr.left + rr.width * 0.5) here.add(t.toLowerCase()) }
          for (const t of here) f[t] = (f[t] || 0) + 1
        }
        const top = Object.entries(f).sort((a, b) => b[1] - a[1])[0]
        if (top && top[1] / info.length >= 0.9) add('badge-constant', 'check', parent, top[0], 'the same label on ' + top[1] + ' of ' + info.length + ' rows carries no information')
      }
      const files = info.filter((x) => [...x.r.querySelectorAll('*')].some((e) => /^\S+\.[A-Za-z][A-Za-z0-9]{0,4}$/.test(own(e)) && vis(e)))
      // A preview is a picture or a box named for it (thumb, preview): text rendered small counts as much as an image.
      if (files.length === info.length && info.length >= 3 && !info.some((x) => [...x.r.querySelectorAll(VISUAL + ',[class*="thumb"],[class*="prev"],[data-kb*="prev"],[data-kb*="thumb"]')].some((m) => { const r = m.getBoundingClientRect(); return r.width >= 56 && r.height >= 40 }))) {
        add('no-preview', 'ux', parent, '', info.length + ' items name a file and none shows what is inside')
      }
    }

    // A filled button floating away from both edges of its row (a cluster of sibling buttons counts as one).
    for (const b of shown.filter((e) => e.matches(BUTTONS)).slice(0, 300)) {
      if (norm(b.textContent).length < 3 || getComputedStyle(b).backgroundColor === 'rgba(0, 0, 0, 0)' || b.parentElement === null) continue
      const cluster = [...b.parentElement.children].filter((c) => c.matches(BUTTONS) && vis(c)).map((c) => c.getBoundingClientRect())
      const box = { left: Math.min(...cluster.map((q) => q.left)), right: Math.max(...cluster.map((q) => q.right)) }
      let row = b.parentElement
      while (row !== null && row !== root && row.getBoundingClientRect().width < box.right - box.left + 200) row = row.parentElement
      if (row === null) continue
      const rr = row.getBoundingClientRect()
      const gl = box.left - rr.left
      const gr = rr.right - box.right
      if (gl > 60 && gr > 60 && Math.abs(gl - gr) > 24 && b.closest('p') === null) add('stray-button', 'ux', b, label(b), 'floats ' + Math.round(gl) + ' px from the left and ' + Math.round(gr) + ' px from the right of its row: put it at an edge or under what it belongs to')
    }

    // Empty states that only say so: no picture, no way to add the first item.
    const flagged = []
    for (const el of shown) {
      if (el.children.length > 6 || flagged.some((f) => f.contains(el))) continue
      const t = norm(el.textContent)
      if (t.length < 8 || t.length > 200) continue
      const dashed = getComputedStyle(el).borderTopStyle === 'dashed'
      if (!dashed && !/^(no|aucun|aucune|nothing|empty|pas de|there (is|are) no|vide)\b/i.test(t)) continue
      const r = el.getBoundingClientRect()
      if (r.width < 160 || r.height < 40 || el.querySelector('button,a[href],[role="button"],img,svg,canvas,picture') !== null) continue
      flagged.push(el)
      add('empty-bare', 'ux', el, t, 'an empty state with no illustration and no way to add the first item')
    }
    for (const { el, t } of leaves) if (t.split(' ').length >= 4 && JARGON.test(t)) add('jargon', 'check', el, t, 'a file name, a key or an internal word in text a person reads')

    // Controls.
    for (const el of shown.filter((e) => e.matches(INTERACTIVE))) {
      const r = el.getBoundingClientRect()
      if (getComputedStyle(el).display === 'inline' && el.tagName === 'A') continue
      const name = label(el)
      const boxed = el.matches('input[type="checkbox"],input[type="radio"]') && el.labels && el.labels.length > 0
      if ((r.width < 24 || r.height < 24) && !boxed) add('tiny-target', 'ux', el, name, Math.round(r.width) + 'x' + Math.round(r.height) + ' px (24 is the floor, 32 comfortable)')
      if (name === '' && el.matches('button,[role="button"],a[href],[role="tab"],[role="menuitem"]') && el.querySelector('img[alt]:not([alt=""])') === null) add('no-name', 'ux', el, '', 'an icon-only control with no text, aria-label or title')
    }
    for (const el of shown.filter((e) => e.matches(INTERACTIVE)).slice(0, 400)) {
      const r = el.getBoundingClientRect()
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      if (cx < 0 || cy < 0 || cx >= innerWidth || cy >= innerHeight) continue
      let clipped = false
      for (let c = el.parentElement; c !== null && c !== document.body; c = c.parentElement) {
        const cs = getComputedStyle(c)
        if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue
        const cr = c.getBoundingClientRect()
        if (cx < cr.left || cx > cr.right || cy < cr.top || cy > cr.bottom) { clipped = true; break }
      }
      const hit = clipped ? null : document.elementFromPoint(cx, cy)
      if (hit !== null && hit !== el && !el.contains(hit) && !hit.contains(el)) add('covered', 'bug', el, label(el), 'covered by ' + where(hit))
    }
    for (const el of shown.filter((e) => e.tagName === 'A' && /^(#?|javascript:.*)$/.test(e.getAttribute('href') || ''))) add('dead-link', 'check', el, label(el), 'a link that goes nowhere')
    for (const el of shown.filter((e) => e.tagName === 'IMG')) {
      if (el.complete && el.naturalWidth === 0 && el.getAttribute('src')) add('broken-img', 'bug', el, el.getAttribute('src').slice(0, 60), 'the image did not load')
      if (!el.hasAttribute('alt')) add('img-no-alt', 'check', el, el.getAttribute('src') || '', 'no alt attribute')
    }

    // Text that does not fit, text that is too small, emoji used as chrome.
    for (const { el, t } of leaves) {
      const cs = getComputedStyle(el)
      if (el.clientWidth > 4 && el.scrollWidth - el.clientWidth > 2 && /hidden|clip/.test(cs.overflowX)) {
        if (cs.textOverflow !== 'ellipsis') add('clipped', 'bug', el, t, 'text cut at ' + el.clientWidth + ' px with no ellipsis')
        else if (!el.title && el.closest('[title]') === null && !el.getAttribute('aria-label')) add('truncated-no-hint', 'check', el, t, 'cut with an ellipsis and no title: the full text cannot be read')
      }
      if (el.matches('button,label,h1,h2,h3,h4,th,[role="tab"],[role="menuitem"],[role="heading"]') && /\p{Emoji_Presentation}/u.test(t)) add('emoji', 'check', el, t, 'an emoji used as interface chrome; use the house icon set')
    }
    const small = leaves.filter(({ el }) => parseFloat(getComputedStyle(el).fontSize) < 11)
    if (small.length > 0) add('tiny-text', 'check', small[0].el, small[0].t, small.length + ' text element(s) under 11 px')

    if (document.documentElement.scrollWidth > innerWidth + 1) add('hscroll', 'bug', null, '', 'the page scrolls sideways (' + document.documentElement.scrollWidth + ' > ' + innerWidth + ' px)')
    if (S.cls > 0.1) add('layout-shift', 'ux', null, S.cls.toFixed(3), 'content jumped while loading (cumulative layout shift, 0.1 is the limit)')
    for (const e of S.errors) add('js-error', 'bug', null, e.msg, e.src)
    for (const e of performance.getEntriesByType('resource')) if (e.responseStatus >= 400) add('http-error', 'bug', null, e.name.slice(-70), 'HTTP ' + e.responseStatus)

    const counts = {}
    const findings = []
    for (const f of out) { counts[f.kind] = (counts[f.kind] || 0) + 1; if (counts[f.kind] <= CAP) findings.push(f) }
    return { path: location.pathname, title: document.title, viewport: innerWidth + 'x' + innerHeight, root: root === document.body ? 'page' : where(root), total: out.length, counts, findings }
  }

  // The boxes the user's eye uses as a frame. Compare them page by page: a frame that moves is an interface that jumps.
  function frame () {
    const box = (el) => { if (!el || !vis(el)) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left * 10) / 10, y: Math.round(r.top * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 } }
    const dlg = [...document.querySelectorAll('[role="dialog"],[aria-modal="true"]')].filter(vis).pop()
    const first = (sel) => [...(dlg || document).querySelectorAll(sel)].find(vis)
    return {
      viewport: { w: innerWidth, h: innerHeight },
      scrollbar: innerWidth - document.documentElement.clientWidth,
      landmarks: {
        dialog: box(dlg),
        nav: box(first('nav,[role="navigation"],[role="tablist"]')),
        header: box(first('header,[role="banner"]')),
        heading: box(first('h1,h2,[role="heading"]')),
        main: box(first('main,[role="main"],[role="tabpanel"]'))
      }
    }
  }
  function diffFrames (frames) {
    const only = { heading: ['x', 'y'] }
    const out = []
    const base = {}
    for (const f of frames) for (const [k, b] of Object.entries(f.frame.landmarks)) if (b !== null && base[k] === undefined) base[k] = { label: f.label, box: b }
    for (const f of frames) {
      if (f.frame.scrollbar !== frames[0].frame.scrollbar && f !== frames[0]) out.push({ landmark: 'scrollbar', from: frames[0].label, to: f.label, deltas: 'gutter ' + frames[0].frame.scrollbar + ' -> ' + f.frame.scrollbar + ' px: content shifts when it appears' })
      for (const [k, b] of Object.entries(f.frame.landmarks)) {
        if (b === null || base[k] === undefined || base[k].label === f.label) continue
        const moved = (only[k] || ['x', 'y', 'w', 'h']).filter((q) => Math.abs(base[k].box[q] - b[q]) > 1)
        if (moved.length > 0) out.push({ landmark: k, from: base[k].label, to: f.label, deltas: moved.map((q) => q + ' ' + base[k].box[q] + ' -> ' + b[q]).join(', ') })
      }
    }
    return out
  }

  const push = (msg, src) => { if (S.errors.length < 50) S.errors.push({ msg: String(msg).slice(0, 200), src }) }
  window.addEventListener('error', (e) => push(e.message, 'error'))
  window.addEventListener('unhandledrejection', (e) => push(e.reason && e.reason.message ? e.reason.message : e.reason, 'unhandled rejection'))
  const ce = console.error
  console.error = function () { push([...arguments].map(String).join(' '), 'console.error'); return ce.apply(this, arguments) }
  try {
    new PerformanceObserver((list) => { for (const e of list.getEntries()) if (!e.hadRecentInput) S.cls += e.value }).observe({ type: 'layout-shift', buffered: true })
  } catch (e) { /* no layout-shift entries in this browser */ }

  window.__UXH__ = { version: 1, scan, frame, diffFrames, errors: S.errors }
  return 'ux-bug-hunter probes installed'
})()
