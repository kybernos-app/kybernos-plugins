// dsh-mermaid — plugin body (readable source).
//
// scripts/build.mjs wraps this file in a factory `(mermaid) => { name, inject, apply }`, then
// concatenates it after the vendored mermaid bundle to produce client/client.js.
//
// Principle: DSH's markdown renderer has NO fence-rendering registry (MarkdownRenderContext
// exposes neither a component nor a per-language callback). We hook onto the only stable contract
// there is, the DOM produced by CodeBlock (`div.md-code-block`), as measured on DSH 0.2.0-rc.2:
//
//   div.md-code-block
//     div.<bannerWrap>
//       div.<header>[data-code-block-banner]
//         div.<heading> > span   <- the language, ONLY when DSH can highlight it; otherwise the
//                                   generic "Code block". mermaid is NOT highlightable, so the
//                                   label never says "mermaid" (the old detection missed it).
//         div.<actions>          <- native wrap / copy buttons
//     div.<content>[data-code-block-content]
//       pre.<plain> > code       <- the verbatim source (a highlighted block has pre.shiki instead)
//
// The DOM is left intact (the native "copy" button still reads the <pre>) and a card is appended
// after it, with the source hidden by CSS.

const NAME = 'dsh-mermaid'
const ROOT_SELECTOR = 'div.md-code-block'
const CARD_CLASS = 'dsh-mermaid'
const READY_ATTR = 'data-dsh-mermaid'
const SOURCE_ATTR = 'dsh-mermaid-source'
const LANG = 'mermaid'
const DEBOUNCE_MS = 120

/** Theme token read from :root, with a fallback. */
function token(cs, name, fallback) {
  const value = cs.getPropertyValue(name).trim()
  return value || fallback
}

/**
 * Concrete fallbacks, used ONLY when a token is unreadable. The bundle is evaluated from <head>:
 * DSH tokens may not be computable yet, and `getPropertyValue` then returns an empty string.
 * Mermaid accepts neither an empty value nor `currentColor` ("Unsupported color format"); that
 * error used to fail the whole entry activation ("web boot: 1 entry did not activate").
 */
const COULEURS_REPLI = {
  bg: '#0e1117',
  layer1: '#141a22',
  layer2: '#101620',
  text: '#e7eef6',
  text2: '#93a2b4',
  border: '#26303d',
  brand: '#58a6ff'
}

/**
 * Normalises a colour to the format mermaid can read: the canvas resolves oklch()/color-mix()/var()
 * to #hex or rgba(), and returns the sentinel unchanged if the engine does not understand the value.
 */
function couleurSure(value, fallback) {
  const v = String(value ?? '').trim()
  if (!v || /^currentcolor$/i.test(v)) return fallback
  try {
    const ctx = document.createElement('canvas').getContext('2d')
    ctx.fillStyle = '#123456'
    ctx.fillStyle = v
    const normalise = ctx.fillStyle
    if (typeof normalise === 'string' && normalise !== '#123456' && /^(#|rgb|hsl)/i.test(normalise)) {
      return normalise
    }
  } catch (error) {
    /* canvas unavailable: keep the fallback */
  }
  return fallback
}

/** Palette read from DSH tokens — no hard-coded colour outside the fallback. */
function palette() {
  const cs = getComputedStyle(document.documentElement)
  const bg = couleurSure(token(cs, '--dsw-alias-bg-base', ''), COULEURS_REPLI.bg)
  const layer1 = couleurSure(token(cs, '--dsw-alias-bg-layer-1', ''), COULEURS_REPLI.layer1)
  const layer2 = couleurSure(token(cs, '--dsw-alias-bg-layer-2', ''), COULEURS_REPLI.layer2)
  return {
    font: token(cs, '--dsw-font-family', 'ui-sans-serif, system-ui, sans-serif'),
    bg,
    layer1,
    layer2,
    text: couleurSure(token(cs, '--dsw-alias-label-primary', ''), COULEURS_REPLI.text),
    text2: couleurSure(
      token(cs, '--dsw-alias-label-secondary', token(cs, '--dsw-alias-label-tertiary', '')),
      COULEURS_REPLI.text2
    ),
    border: couleurSure(
      token(cs, '--dsw-alias-border-l2', token(cs, '--dsw-alias-border-l1', '')),
      COULEURS_REPLI.border
    ),
    brand: couleurSure(
      token(cs, '--dsw-alias-brand-primary', token(cs, '--dsw-alias-link', '')),
      COULEURS_REPLI.brand
    )
  }
}

/** Last-resort palette, with no DOM read at all. */
function paletteDeRepli() {
  return {
    font: 'ui-sans-serif, system-ui, sans-serif',
    bg: COULEURS_REPLI.bg,
    layer1: COULEURS_REPLI.layer1,
    layer2: COULEURS_REPLI.layer2,
    text: COULEURS_REPLI.text,
    text2: COULEURS_REPLI.text2,
    border: COULEURS_REPLI.border,
    brand: COULEURS_REPLI.brand
  }
}

/**
 * Initialises mermaid without ever failing the entry activation: a refused configuration degrades
 * the rendering, it must not make the plugin inert ("web boot: 1 entry did not activate").
 */
function initMermaid(theme) {
  try {
    mermaid.initialize(mermaidConfig(theme))
  } catch (error) {
    console.warn('[dsh-mermaid] configuration refused by mermaid — fallback palette', error)
    mermaid.initialize(mermaidConfig(paletteDeRepli()))
  }
}

function mermaidConfig(theme) {
  return {
    startOnLoad: false,
    // The assistant's markdown is UNTRUSTED: no HTML injected into labels, no clickable link
    // produced by a diagram.
    securityLevel: 'strict',
    suppressErrorRendering: true,
    theme: 'base',
    fontFamily: theme.font,
    themeVariables: {
      background: theme.layer1,
      primaryColor: theme.layer2,
      primaryTextColor: theme.text,
      primaryBorderColor: theme.border,
      secondaryColor: theme.layer2,
      tertiaryColor: theme.bg,
      lineColor: theme.text2,
      textColor: theme.text,
      fontSize: '14px'
    },
    flowchart: { htmlLabels: false, useMaxWidth: true },
    sequence: { useMaxWidth: true },
    gantt: { useMaxWidth: true },
    class: { htmlLabels: false, useMaxWidth: true }
  }
}

function injectStyle() {
  const style = document.createElement('style')
  style.dataset.plugin = NAME
  const block = ROOT_SELECTOR.split('.')[1]
  // The source sits in `[data-code-block-content]` on DSH 0.2; `> pre` is the older, flatter DOM.
  style.textContent = [
    `.${block}[${READY_ATTR}="ready"] > pre, .${block}[${READY_ATTR}="ready"] [data-code-block-content] { display: none; }`,
    `.${block}.${SOURCE_ATTR} > pre { display: block !important; }`,
    `.${block}.${SOURCE_ATTR} [data-code-block-content] { display: block !important; }`,
    `.${CARD_CLASS}{margin:4px 0;padding:10px;border:1px solid var(--dsw-alias-border-l2,currentColor);`,
    `border-radius:10px;background:var(--dsw-alias-bg-layer-1,transparent);overflow-x:auto}`,
    `.${CARD_CLASS} svg{max-width:100%;height:auto;display:block;margin:0 auto}`,
    `.${CARD_CLASS}[data-dsh-mermaid-state="error"]{border-color:var(--dsw-alias-state-error-primary,currentColor)}`,
    `.${CARD_CLASS}-bar{display:flex;justify-content:flex-end;gap:6px;margin-top:6px}`,
    `.${CARD_CLASS}-bar button{font:inherit;font-size:12px;line-height:18px;padding:2px 8px;cursor:pointer;`,
    `border:1px solid var(--dsw-alias-border-l2,currentColor);border-radius:6px;background:transparent;`,
    `color:var(--dsw-alias-label-secondary,currentColor)}`,
    `.${CARD_CLASS}-bar button:hover{background:var(--dsw-alias-interactive-bg-hover,transparent)}`,
    `.${CARD_CLASS}-error{font-size:12px;line-height:18px;white-space:pre-wrap;`,
    `color:var(--dsw-alias-state-error-primary,currentColor);margin:2px 0 0}`
  ].join('')
  document.head.append(style)
  return () => style.remove()
}

// <detect:begin> (test-detect.mjs extracts this block by its markers: keep it free of DOM access)
//
// DSH 0.2 does not tell us a fence's language unless it can highlight it, and mermaid cannot be
// highlighted, so the source is the only trace left. A diagram always opens with a header line.
// Two lists, to keep prose out of it: names that cannot be mistaken for anything else are matched
// as a prefix, common English words only count when they are the WHOLE first line.
const DISTINCT_HEADER = new RegExp(
  '^(?:(?:graph|flowchart(?:-elk)?)\\s+(?:TB|TD|BT|RL|LR)\\b' +
  '|sequenceDiagram\\b|classDiagram(?:-v2)?\\b|stateDiagram(?:-v2)?\\b|erDiagram\\b|gitGraph\\b' +
  '|requirementDiagram\\b|quadrantChart\\b|zenuml\\b|C4(?:Context|Container|Component|Dynamic|Deployment)\\b' +
  '|(?:sankey|xychart|block|packet|architecture|radar|treemap)-beta\\b)'
)
const PLAIN_WORD_HEADER = /^(?:graph|flowchart|pie(?:\s+showData)?(?:\s+title\b.*)?|journey|gantt|timeline|mindmap|kanban)\s*$/

/** True when `source` opens like a mermaid diagram (front matter, blank lines and %% lines skipped). */
function looksLikeMermaid(source) {
  let text = String(source === null || source === undefined ? '' : source).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  text = text.replace(/^\s*---[ \t]*\n[\s\S]*?\n---[ \t]*(?:\n|$)/, '') // YAML front matter
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('%%')) continue // blank, comment or %%{init}%% directive
    return DISTINCT_HEADER.test(line) || PLAIN_WORD_HEADER.test(line)
  }
  return false
}
// <detect:end>

/** True when this code block is a ```mermaid fence. */
function isMermaidBlock(block) {
  const banner = block.querySelector('[data-code-block-banner]')
  const info = banner && banner.firstElementChild ? banner.firstElementChild.textContent.trim() : ''
  if (info.toLowerCase() === LANG) return true
  // Fallback if DSH ever highlights the fence: an explicit language class.
  if (block.querySelector('code.language-' + LANG) !== null) return true
  // DSH 0.2: the label says "Code block" and the <code> has no class, so read the source — but never
  // on a highlighted block, which carries its own language (pre.shiki) and is not ours.
  if (block.querySelector('pre.shiki, pre[class*="shiki"]') !== null) return false
  const pre = block.querySelector('pre')
  return pre !== null && looksLikeMermaid(pre.textContent)
}

function apply(ctx) {
  if (typeof document === 'undefined' || typeof window === 'undefined') return
  // Defence in depth: a single installation per page.
  if (window.__DSH_MERMAID_ACTIVE__) return
  window.__DSH_MERMAID_ACTIVE__ = true

  const removeStyle = injectStyle()
  let themeRevision = 0
  let renderId = 0
  let timer = 0
  const rendered = new WeakMap() // block -> { key, inflight, card }

  const theme = palette()
  initMermaid(theme)

  function schedule() {
    if (timer) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      timer = 0
      scan()
    }, DEBOUNCE_MS)
  }

  function scan() {
    const blocks = document.querySelectorAll(ROOT_SELECTOR)
    for (const block of blocks) {
      if (!isMermaidBlock(block)) continue
      void draw(block)
    }
  }

  function makeCard(block) {
    const entry = rendered.get(block)
    let card = entry && entry.card
    if (card && card.isConnected) return card
    card = document.createElement('div')
    card.className = CARD_CLASS
    const bar = document.createElement('div')
    bar.className = CARD_CLASS + '-bar'
    const toggle = document.createElement('button')
    toggle.type = 'button'
    toggle.textContent = 'Code'
    toggle.addEventListener('click', () => {
      const shown = block.classList.toggle(SOURCE_ATTR)
      toggle.textContent = shown ? 'Diagramme' : 'Code'
    })
    bar.append(toggle)
    card.append(bar)
    block.append(card)
    // Remember the card: without it, every re-render (theme change, edited source) built a second
    // one and the block ended up with several stacked diagrams.
    if (entry) entry.card = card
    return card
  }

  async function draw(block) {
    const pre = block.querySelector('pre')
    if (!pre) return
    const source = (pre.textContent || '').replace(/\s+$/, '')
    if (!source) return

    const key = themeRevision + '\u0000' + source
    const previous = rendered.get(block)
    if (previous && previous.key === key) return
    if (previous && previous.inflight === key) return
    rendered.set(block, { key, inflight: key, card: previous && previous.card })

    const card = makeCard(block)
    const canvas = card.querySelector('.' + CARD_CLASS + '-canvas')
    if (canvas) canvas.remove()
    const errorNode = card.querySelector('.' + CARD_CLASS + '-error')
    if (errorNode) errorNode.remove()

    initMermaid(palette())
    const id = NAME + '-' + ++renderId
    try {
      const { svg } = await mermaid.render(id, source)
      // Two renders can overlap (a theme change during a render). Only the most recent one may
      // insert its canvas: without this check both were added and the block ended up with two
      // stacked diagrams.
      const current = rendered.get(block)
      if (!current || current.inflight !== key) return
      const holder = document.createElement('div')
      holder.className = CARD_CLASS + '-canvas'
      // SVG produced by mermaid at securityLevel strict: text labels, no HTML, no link. No user
      // data is injected into it.
      holder.innerHTML = svg
      card.insertBefore(holder, card.firstChild)
      card.dataset.dshMermaidState = 'ok'
      block.setAttribute(READY_ATTR, 'ready')
      current.inflight = ''
    } catch (error) {
      const current = rendered.get(block)
      // Same rule as on success: an error from a stale render must not overwrite the newer one.
      if (!current || current.inflight !== key) return
      const message = error && error.message ? error.message : String(error)
      const node = document.createElement('p')
      node.className = CARD_CLASS + '-error'
      node.textContent = 'Diagramme mermaid invalide — ' + message.split('\n')[0]
      card.append(node)
      card.dataset.dshMermaidState = 'error'
      // Source left visible: the reader sees the faulty code.
      block.classList.add(SOURCE_ATTR)
      current.inflight = ''
    }
  }

  const domObserver = new MutationObserver(schedule)
  // We observe `document.documentElement`, never `document.body`: the GUI loader evaluates this
  // bundle from <head>, when `body` is still null — `observe(null)` threw, the entry did not
  // activate ("web boot: 1 entry did not activate"), while the style and the flag were already set:
  // an inert AND failing plugin at boot. `documentElement` always exists and its subtree covers `body`.
  domObserver.observe(document.documentElement, { childList: true, subtree: true, characterData: true })

  const themeObserver = new MutationObserver(() => {
    // themeRevision is part of the render key: everything is redrawn with the new tokens, without
    // emptying the cache (a WeakMap has none).
    themeRevision += 1
    initMermaid(palette())
    schedule()
  })
  themeObserver.observe(document.documentElement, {
    attributes: true,
    // `data-ds-theme-source` is the DSH GUI theme marker; the others come from the test bench and
    // earlier versions.
    attributeFilter: ['class', 'style', 'data-theme', 'data-dsw-theme', 'data-ds-theme-source']
  })

  scan()

  const dispose = () => {
    if (!window.__DSH_MERMAID_ACTIVE__) return
    window.__DSH_MERMAID_ACTIVE__ = false
    domObserver.disconnect()
    themeObserver.disconnect()
    if (timer) window.clearTimeout(timer)
    for (const card of document.querySelectorAll('.' + CARD_CLASS)) card.remove()
    for (const block of document.querySelectorAll('[' + READY_ATTR + ']')) {
      block.removeAttribute(READY_ATTR)
      block.classList.remove(SOURCE_ATTR)
    }
    removeStyle()
  }

  if (ctx && typeof ctx.effect === 'function') ctx.effect(() => dispose)
  else if (ctx && typeof ctx.on === 'function') ctx.on('dispose', dispose)
}

return { name: NAME, inject: [], apply: apply }
