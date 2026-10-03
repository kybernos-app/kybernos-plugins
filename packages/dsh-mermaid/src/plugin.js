// dsh-mermaid — corps du plugin (source lisible).
//
// Ce fichier est encapsulé par scripts/build.mjs dans une fabrique
// `(mermaid) => { name, inject, apply }`, puis concaténé après le bundle
// mermaid vendoré pour produire client/client.js.
//
// Principe : le renderer markdown de DSH ne possède AUCUN registre de rendu de
// fence (MarkdownRenderContext n'expose ni composant ni callback par langage).
// On s'accroche donc au seul contrat stable disponible, le DOM produit par
// CodeBlock (`div.md-code-block`) :
//
//   div.md-code-block[data-line-numbers]
//     div.<bannerWrap>
//       div.<banner>[data-code-block-banner]
//         div.<infostring>   ← le langage, ici « mermaid »
//         div.<action> > button.<copyButton>
//     pre.<plain>            ← source verbatim (shiki n'a pas de grammaire mermaid)
//
// On laisse ce DOM intact — le bouton « copier » lit toujours le <pre> — et on
// ajoute une carte juste après, en masquant la source par CSS.

const NAME = 'dsh-mermaid'
const ROOT_SELECTOR = 'div.md-code-block'
const CARD_CLASS = 'dsh-mermaid'
const READY_ATTR = 'data-dsh-mermaid'
const SOURCE_ATTR = 'dsh-mermaid-source'
const LANG = 'mermaid'
const DEBOUNCE_MS = 120

/** Jeton de thème lu sur :root, avec repli. */
function token(cs, name, fallback) {
  const value = cs.getPropertyValue(name).trim()
  return value || fallback
}

/**
 * Replis concrets, utilisés UNIQUEMENT si un jeton est illisible. Le bundle est
 * évalué depuis <head> : les jetons DSH peuvent n'être pas encore calculables,
 * et `getPropertyValue` rend alors une chaîne vide. Mermaid n'accepte ni le vide
 * ni `currentColor` (« Unsupported color format ») — l'erreur faisait échouer
 * toute l'activation de l'entrée (« web boot: 1 entry did not activate »).
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
 * Normalise une couleur au format que mermaid sait lire : le canevas résout
 * oklch()/color-mix()/var() en #hex ou rgba(), et rend la sentinelle inchangée
 * si le moteur ne comprend pas la valeur.
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
    /* canevas indisponible : on garde le repli */
  }
  return fallback
}

/** Palette lue dans les jetons DSH — aucune couleur en dur hors repli. */
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

/** Palette de dernier recours, sans aucune lecture du DOM. */
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
 * Initialise mermaid sans jamais faire tomber l'activation de l'entrée : une
 * configuration refusée dégrade le rendu, elle ne doit pas rendre le plugin
 * inerte (« web boot: 1 entry did not activate »).
 */
function initMermaid(theme) {
  try {
    mermaid.initialize(mermaidConfig(theme))
  } catch (error) {
    console.warn('[dsh-mermaid] configuration refusée par mermaid — palette de repli', error)
    mermaid.initialize(mermaidConfig(paletteDeRepli()))
  }
}

function mermaidConfig(theme) {
  return {
    startOnLoad: false,
    // Le markdown assistant est NON FIABLE : aucun HTML injecté dans les labels,
    // aucun lien cliquable produit par un diagramme.
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
  style.textContent = [
    `.${ROOT_SELECTOR.split('.')[1]}[${READY_ATTR}="ready"] > pre { display: none; }`,
    `.${ROOT_SELECTOR.split('.')[1]}.${SOURCE_ATTR} > pre { display: block !important; }`,
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

/** Vrai si ce bloc de code est une fence ```mermaid. */
function isMermaidBlock(block) {
  const banner = block.querySelector('[data-code-block-banner]')
  const info = banner && banner.firstElementChild ? banner.firstElementChild.textContent.trim() : ''
  if (info.toLowerCase() === LANG) return true
  // Repli si DSH venait à coloriser la fence : classe de langage explicite.
  return block.querySelector('code.language-' + LANG) !== null
}

function apply(ctx) {
  if (typeof document === 'undefined' || typeof window === 'undefined') return
  // Défense en profondeur : une seule installation par page.
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
    // Mémoriser la carte : sans ça, chaque re-rendu (changement de thème,
    // source modifiée) en fabriquait une deuxième et le bloc finissait avec
    // plusieurs diagrammes empilés.
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
      // Deux rendus peuvent se chevaucher (un changement de thème pendant un
      // rendu). Seul le plus récent a le droit d'insérer son canevas : sans ce
      // contrôle, les deux s'ajoutaient et le bloc finissait avec deux
      // diagrammes empilés.
      const current = rendered.get(block)
      if (!current || current.inflight !== key) return
      const holder = document.createElement('div')
      holder.className = CARD_CLASS + '-canvas'
      // SVG produit par mermaid en securityLevel strict : labels en texte,
      // pas de HTML, pas de lien. Aucune donnée utilisateur n'y est injectée.
      holder.innerHTML = svg
      card.insertBefore(holder, card.firstChild)
      card.dataset.dshMermaidState = 'ok'
      block.setAttribute(READY_ATTR, 'ready')
      current.inflight = ''
    } catch (error) {
      const current = rendered.get(block)
      // Même règle qu'au succès : une erreur d'un rendu périmé ne doit pas
      // écraser le rendu plus récent.
      if (!current || current.inflight !== key) return
      const message = error && error.message ? error.message : String(error)
      const node = document.createElement('p')
      node.className = CARD_CLASS + '-error'
      node.textContent = 'Diagramme mermaid invalide — ' + message.split('\n')[0]
      card.append(node)
      card.dataset.dshMermaidState = 'error'
      // Source laissée visible : le lecteur voit le code fautif.
      block.classList.add(SOURCE_ATTR)
      current.inflight = ''
    }
  }

  const domObserver = new MutationObserver(schedule)
  // On observe `document.documentElement`, jamais `document.body` : le chargeur
  // de la GUI évalue ce bundle depuis <head>, quand `body` est encore null —
  // `observe(null)` jetait, l'entrée n'activait pas (« web boot: 1 entry did not
  // activate »), alors que le style et le drapeau étaient déjà posés : plugin
  // inerte ET en erreur au boot. `documentElement` existe toujours et son
  // sous-arbre couvre `body`.
  domObserver.observe(document.documentElement, { childList: true, subtree: true, characterData: true })

  const themeObserver = new MutationObserver(() => {
    // themeRevision entre dans la clé de rendu : tout redessine avec les
    // nouveaux jetons, sans vider le cache (une WeakMap n'en a pas).
    themeRevision += 1
    initMermaid(palette())
    schedule()
  })
  themeObserver.observe(document.documentElement, {
    attributes: true,
    // `data-ds-theme-source` est le marqueur de thème de la GUI DSH ; les autres
    // sont ceux du banc d'essai et des versions antérieures.
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