// src/plugin.js — corps de la fabrique du panneau (assemblé par scripts/build.mjs).
// `TipTap` est injecté par l'assemblage (vendor/tiptap.iife.js) ; absent,
// l'édition riche retombe sur la boîte texte simple.
    const React = require('react')
    const h = React.createElement

    const TT = TipTap !== null && typeof TipTap === 'object' && typeof TipTap.Editor === 'function' ? TipTap : null
    /** Texte brut d'une valeur de champ (qui peut porter du HTML riche). */
    const plainDe = (t) => String(t ?? '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>\s*<p[^>]*>/gi, '\n')
      .replace(/<[^>]*>/g, '')
    /** HTML compact : sans enveloppes <p> de ProseMirror, \n entre paragraphes. */
    const htmlCompacte = (t) => String(t ?? '').trim().replace(/^<p[^>]*>/, '').replace(/<\/p>$/, '').replace(/<\/p>\s*<p[^>]*>/g, '\n')

    const TYPE_ID = 'kybernos-slides'
    const KIND = 'kybernos-slides'
    const SLOT = 'sidebar.right.pane.tab'
    const STYLE_ID = 'kybernos-slides-styles'
    const ROUTE_STATE = '/kybernos-slides/state'
    const ROUTE_PUSH = '/kybernos-slides/push'
    const CADENCE_MS = 500
    const L = 1600
    const H = 900

    /* ══════════════════════ utilitaires ══════════════════════ */

    const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

    /* ══════════════════════ 1. THÈMES ══════════════════════ */

    const THEMES = {
      sombre: { bg: '#10201F', ink: '#F4F1EA', muted: 'rgba(244,241,234,.55)', accent: '#37B5C4', trait: '#F2C31A' },
      clair: { bg: '#F7F5F0', ink: '#1E2422', muted: 'rgba(30,36,34,.55)', accent: '#0E7C86', trait: '#C98A12' },
      corail: { bg: '#2A1512', ink: '#FBEEE8', muted: 'rgba(251,238,232,.55)', accent: '#E1502A', trait: '#F2C31A' },
      papier: { bg: '#F3EDDE', ink: '#33301F', muted: 'rgba(51,48,31,.55)', accent: '#8E1B14', trait: '#B37D1E' },
    }
    const themeDe = (v) => (THEMES[v] ? v : 'sombre')

    const CSS = `
.kbsd-root{display:flex;flex-direction:column;height:100%;min-height:0;font-size:12px;
  color:var(--dsw-alias-label-primary,#1a1a1a);background:var(--dsw-alias-bg-layer-2,#fff)}
.kbs-head{flex:none;display:flex;align-items:center;gap:8px;padding:10px 12px 8px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.07))}
.kbs-title{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kbs-badge{margin-left:auto;flex:none;font-size:10.5px;font-weight:600;padding:2px 8px;border-radius:99px;
  background:var(--dsw-alias-bg-module-platform,rgba(0,0,0,.05));color:var(--dsw-alias-label-secondary,#6b6b68)}
.kbs-badge.run{background:#37B5C4;color:#08262a}
.kbs-badge.ia{background:#1f9d57;color:#fff}
.kbs-scene{flex:1;min-height:120px;display:flex;align-items:center;justify-content:center;
  background:#e9e7e2;padding:10px;position:relative;overflow:hidden}
.kbs-wrap{position:relative}
.kbs-stage{position:absolute;top:0;left:0;width:${L}px;height:${H}px;transform-origin:top left;
  border-radius:6px;overflow:hidden;box-shadow:0 6px 24px rgba(20,28,26,.18)}
.kbs-slide{position:absolute;inset:0;padding:96px 110px;box-sizing:border-box;
  font-family:ui-sans-serif,-apple-system,'Segoe UI',system-ui,sans-serif}
.kbs-kicker{position:absolute;top:78px;left:110px;font-size:21px;font-weight:650;letter-spacing:.42em;
  text-transform:uppercase;opacity:.85}
.kbs-foot{position:absolute;bottom:52px;right:110px;font-size:17px;font-weight:600;letter-spacing:.18em;
  text-transform:uppercase;opacity:.5}
.kbs-note{position:absolute;bottom:52px;left:110px;font-size:17px;opacity:.55;max-width:900px}
.kbs-titre{font-weight:800;letter-spacing:-.02em;line-height:1.08;margin:0}
.kbs-champ{position:relative;white-space:pre-wrap}
.kbs-outil-texte .kbs-champ{cursor:text;border-bottom:1.5px dashed transparent}
.kbs-outil-texte .kbs-champ:hover{border-bottom-color:currentColor}
.kbs-cor{animation:kbs-cor 5s ease-out 1}
@keyframes kbs-cor{0%{box-shadow:0 0 0 8px rgba(31,157,87,.45);background:rgba(31,157,87,.22)}
  70%{box-shadow:0 0 0 4px rgba(31,157,87,.25);background:rgba(31,157,87,.10)}100%{box-shadow:none;background:transparent}}
.kbs-caret{display:inline-block;width:.08em;min-width:3px;height:.9em;margin-left:.06em;vertical-align:-.08em;
  background:currentColor;animation:kbs-clign 1s steps(2) infinite}
@keyframes kbs-clign{0%,49%{opacity:1}50%,100%{opacity:0}}
.kbs-puces{list-style:none;margin:0;padding:0}
.kbs-puces li{position:relative;padding-left:44px;margin-bottom:.55em;line-height:1.4}
.kbs-puces li::before{content:'';position:absolute;left:0;top:.52em;width:18px;height:6px;border-radius:3px;background:var(--kbs-accent)}
.kbs-champ.kbs-sel{outline:2px solid var(--kbs-accent);outline-offset:5px;border-radius:2px}
.kbs-ebox{position:absolute;z-index:30;margin:0;border:1.5px solid #37B5C4;border-radius:4px;padding:0;background:transparent;
  background:rgba(255,255,255,.92);color:#111;resize:none;overflow:hidden;outline:none;box-shadow:0 4px 18px rgba(0,0,0,.25)}
.kbs-trait{position:absolute;inset:0;z-index:20;touch-action:none}
.kbs-trait.off{pointer-events:none}
.kbs-vignettes{flex:none;display:flex;gap:10px;padding:10px 14px;overflow-x:auto;border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.07));scrollbar-width:thin}
.kbs-vignettes::-webkit-scrollbar{height:6px}
.kbs-vignettes::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l1,rgba(0,0,0,.14));border-radius:3px}
.kbs-vign{position:relative;flex:none;width:132px;height:75px;padding:0;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.16));
  border-radius:8px;overflow:hidden;background:var(--dsw-alias-bg-layer-2,#fff);cursor:pointer;
  transition:transform .12s ease,box-shadow .12s ease,border-color .12s ease}
.kbs-vign:hover{transform:translateY(-2px);box-shadow:0 4px 10px rgba(0,0,0,.10)}
.kbs-vign.on{border-color:#4C8DFF;box-shadow:0 0 0 2px #4C8DFF}
.kbs-vign i{position:absolute;left:5px;bottom:5px;z-index:2;font-style:normal;font-weight:700;font-size:9px;
  width:15px;height:15px;border-radius:4px;display:grid;place-items:center;background:rgba(0,0,0,.5);color:#fff}
.kbs-mini{position:absolute;top:0;left:0;width:1600px;height:900px;transform-origin:top left;pointer-events:none;overflow:hidden}
.kbs-bar{flex:none;display:flex;align-items:center;gap:7px;padding:7px 12px 10px;border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.07))}
.kbs-play{flex:none;width:26px;height:26px;border:0;border-radius:50%;background:#e1502a;color:#fff;cursor:pointer;
  display:grid;place-items:center;font-size:10px;line-height:1}
.kbs-play:hover{background:#c94522}
.kbs-sp{border:0;background:transparent;font:inherit;font-size:10.5px;color:#8a8a87;padding:3px 5px;border-radius:5px;cursor:pointer}
.kbs-sp.on{background:rgba(0,0,0,.06);color:#1a1a1a;font-weight:650}
.kbs-range{-webkit-appearance:none;appearance:none;flex:1;min-width:40px;height:4px;border-radius:2px;background:rgba(0,0,0,.10);outline:0}
.kbs-range::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:12px;border-radius:50%;background:#e1502a;border:2px solid #fff;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.25)}
.kbs-outils{position:absolute;top:10px;left:10px;z-index:25;display:flex;gap:2px;background:rgba(255,255,255,.94);
  border-radius:9px;padding:3px;box-shadow:0 3px 12px rgba(28,42,28,.16)}
.kbs-outil{border:0;background:transparent;font:inherit;font-size:10.5px;color:#6b6b68;padding:3px 8px;border-radius:6px;cursor:pointer}
.kbs-outil:hover{background:rgba(0,0,0,.05)}
.kbs-outil.on{background:#efefec;color:#1a1a1a;font-weight:650}
.kbs-coul{width:15px;height:15px;border-radius:50%;border:2px solid transparent;cursor:pointer;padding:0}
.kbs-coul.on{border-color:#1a1a1a}
.kbs-note-bas{flex:none;padding:4px 12px 8px;font-size:10.5px;line-height:1.45;color:var(--dsw-alias-label-tertiary,#8a8a87);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kbs-note-bas b{color:var(--dsw-alias-label-secondary,#4a4a47);font-weight:600}
.kbs-empty{position:absolute;inset:0;display:flex;flex-direction:column;gap:8px;align-items:center;justify-content:center;
  padding:24px;text-align:center;color:var(--dsw-alias-label-tertiary,#8a8a87);font-size:12px;line-height:1.55;z-index:5}
.kbs-empty b{color:var(--dsw-alias-label-secondary,#4a4a47);font-weight:600}
.kbs-empty code{font-size:11px;background:var(--dsw-alias-bg-module-platform,rgba(0,0,0,.05));padding:1px 5px;border-radius:4px}
.kbs-demo{border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));background:transparent;font:inherit;font-size:11px;
  padding:5px 12px;border-radius:99px;cursor:pointer;color:var(--dsw-alias-label-secondary,#4a4a47)}
.kbs-demo:hover{background:rgba(0,0,0,.05)}
`

    /* ═══════════════ 2. MOTEUR DE FRAPPE ═══════════════
     * Chaque slide pèse ses caractères ; la frappe globale (p ∈ 0..1) se
     * répartit par poids. Dans une slide, les champs se tapent en séquence
     * (kicker → titre → sous → puces…), chaque segment recevant sa part. */

    const CHAMPS_TEXTE = ['kicker', 'titre', 'sous', 'grand', 'legende', 'citation', 'auteur', 'note']

    function normaliserSlide (brut, k) {
      if (brut === null || typeof brut !== 'object' || Array.isArray(brut)) return null
      const s = brut
      const slide = { layout: String(s.layout || 'puces'), accent: typeof s.accent === 'string' ? s.accent : null }
      for (const c of CHAMPS_TEXTE) slide[c] = typeof s[c] === 'string' ? s[c] : ''
      slide.points = Array.isArray(s.points) ? s.points.map((p) => (typeof p === 'string' ? p : '')) : []
      slide.k = k
      return slide
    }

    function normaliserDeck (slides) {
      return (Array.isArray(slides) ? slides : [])
        .slice(0, 60)
        .map(normaliserSlide)
        .filter(Boolean)
    }

    /** Miniature d'une slide pour le filmstrip du bas : le même gabarit que
     * la scène, rendu en 1600×900 puis réduit par transform — le texte reste
     * vectoriel et lisible en tout petit. Aucun champ éditable ici. */
    function miniature (s, th) {
      const ac = s.accent || th.accent
      const T = (txt, x, y, fs, o) => h('div', {
        key: o.k,
        style: {
          position: 'absolute', left: x, top: y, fontSize: fs,
          lineHeight: o.lh || 1.2, color: o.coul || th.ink,
          fontWeight: o.gras || 600, letterSpacing: o.esp || 'normal',
          maxWidth: o.larg || 1380, whiteSpace: 'nowrap', overflow: 'hidden',
        },
      }, txt)
      const noeuds = []
      if (s.kicker !== '') noeuds.push(T(s.kicker, 110, 84, 30, { coul: ac, esp: '4px', k: 'k' }))
      if (s.layout === 'titre') {
        if (s.titre !== '') noeuds.push(T(s.titre, 110, 320, 92, { gras: 750, k: 't' }))
        if (s.sous !== '') noeuds.push(T(s.sous, 110, 500, 40, { coul: th.muted, gras: 500, k: 's' }))
      } else if (s.layout === 'statement') {
        if (s.grand !== '') noeuds.push(T(s.grand, 110, 310, 124, { coul: ac, gras: 780, lh: 1.1, k: 'g' }))
      } else if (s.layout === 'puces') {
        if (s.titre !== '') noeuds.push(T(s.titre, 110, 150, 58, { gras: 700, k: 't' }))
        s.points.slice(0, 5).forEach((p, j) =>
          noeuds.push(T('— ' + p, 110, 330 + j * 82, 36, { coul: th.muted, gras: 500, k: 'p' + j })))
      } else if (s.layout === 'chiffre') {
        if (s.titre !== '') noeuds.push(T(s.titre, 110, 150, 44, { k: 't' }))
        if (s.grand !== '') noeuds.push(T(s.grand, 110, 290, 186, { coul: ac, gras: 800, k: 'g' }))
        if (s.legende !== '') noeuds.push(T(s.legende, 110, 610, 34, { coul: th.muted, gras: 500, k: 'l' }))
      } else if (s.layout === 'citation') {
        noeuds.push(T('«', 88, 90, 150, { coul: ac, gras: 700, k: 'q' }))
        if (s.citation !== '') noeuds.push(T(s.citation, 110, 290, 52, { gras: 650, k: 'c' }))
        if (s.auteur !== '') noeuds.push(T(s.auteur, 110, 620, 30, { coul: ac, k: 'a' }))
      } else { // fin
        if (s.titre !== '') noeuds.push(T(s.titre, 380, 380, 92, { gras: 750, k: 't' }))
      }
      return h('div', { className: 'kbs-mini', style: { background: th.bg, transform: 'scale(0.0825)' } }, noeuds)
    }

    function poidsSlide (s) {
      let c = 50
      for (const f of CHAMPS_TEXTE) c += (s[f] || '').length * 2
      for (const p of s.points) c += p.length * 2 + 40
      return c
    }

    /** Intervalles [start, start+weight] normalisés, un par slide. */
    function budget (slides) {
      const poids = slides.map(poidsSlide)
      const total = poids.reduce((a, b) => a + b, 0) || 1
      let acc = 0
      return poids.map((w) => {
        const o = { start: acc / total, weight: w / total }
        acc += w
        return o
      })
    }

    /** Segments de frappe d'une slide, dans l'ordre de lecture. */
    function segments (s) {
      const segs = []
      const aj = (champ, idx, v) => {
        if (typeof v === 'string' && v !== '') segs.push({ champ, idx, len: v.length, source: v })
      }
      aj('kicker', -1, s.kicker)
      if (s.layout === 'puces') {
        aj('titre', -1, s.titre); aj('sous', -1, s.sous)
        s.points.forEach((p, i) => aj('points', i, p))
      } else if (s.layout === 'chiffre') {
        aj('titre', -1, s.titre); aj('grand', -1, s.grand); aj('legende', -1, s.legende)
      } else if (s.layout === 'citation') {
        aj('citation', -1, s.citation); aj('auteur', -1, s.auteur)
      } else {
        aj('titre', -1, s.titre); aj('sous', -1, s.sous)
      }
      aj('note', -1, s.note)
      const total = segs.reduce((a, g) => a + g.len, 0) || 1
      let acc = 0
      for (const g of segs) { g.start = acc / total; g.part = g.len / total; acc += g.len }
      return segs
    }

    /** Texte tapé d'un segment à la progression q (0..1) de sa slide. */
    function texteVisible (seg, q) {
      const local = clamp((q - seg.start) / (seg.part || 1), 0, 1)
      return seg.source.slice(0, Math.ceil(local * seg.len))
    }

    /** Slide courante à la progression p, ou -1. */
    function slideActive (intervals, p) {
      for (let i = 0; i < intervals.length; i++) {
        const iv = intervals[i]
        if (p >= iv.start && (p < iv.start + iv.weight || i === intervals.length - 1)) return i
      }
      return -1
    }

    const cleChamp = (k, champ, idx) => `${k}:${champ}:${idx}`

    /* ═══════════════ 3. DIFF (correction IA) ═══════════════ */

    /** Passage d'un deck à l'autre : liste des champs modifiés. */
    function diffSlides (avant, apres) {
      const out = []
      const n = Math.max(avant.length, apres.length)
      for (let k = 0; k < n; k++) {
        const a = avant[k] || normaliserSlide({}, k)
        const b = apres[k] || normaliserSlide({}, k)
        for (const c of CHAMPS_TEXTE) {
          if ((a[c] || '') !== (b[c] || '')) out.push({ slide: k, champ: c, idx: -1, avant: a[c] || '', apres: b[c] || '' })
        }
        const m = Math.max(a.points.length, b.points.length)
        for (let i = 0; i < m; i++) {
          if ((a.points[i] || '') !== (b.points[i] || '')) out.push({ slide: k, champ: 'points', idx: i, avant: a.points[i] || '', apres: b.points[i] || '' })
        }
      }
      return out
    }

    /* ═══════════════ 4. OUTILS UTILISATEUR ═══════════════ */

    /** Distance point→polyligne ; sert à la gomme. */
    function hitStroke (strokes, x, y, rayon) {
      const d2 = (px, py, ax, ay, bx, by) => {
        const vx = bx - ax; const vy = by - ay
        const wx = px - ax; const wy = py - ay
        const t = clamp((vx * wx + vy * wy) / ((vx * vx + vy * vy) || 1), 0, 1)
        const dx = px - (ax + t * vx); const dy = py - (ay + t * vy)
        return dx * dx + dy * dy
      }
      for (let i = strokes.length - 1; i >= 0; i--) {
        const pts = strokes[i].points
        for (let j = 1; j < pts.length; j++) {
          if (d2(x, y, pts[j - 1][0], pts[j - 1][1], pts[j][0], pts[j][1]) <= rayon * rayon) return i
        }
      }
      return -1
    }

    /** Tracé lissé d'une liste de traits sur un contexte 2D (repère 1600×900). */
    function dessinerTraits (ctx, strokes) {
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      for (const t of strokes) {
        ctx.strokeStyle = t.color
        ctx.lineWidth = t.width
        ctx.beginPath()
        const pts = t.points
        ctx.moveTo(pts[0][0], pts[0][1])
        for (let i = 1; i < pts.length - 1; i++) {
          const mx = (pts[i][0] + pts[i + 1][0]) / 2
          const my = (pts[i][1] + pts[i + 1][1]) / 2
          ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my)
        }
        const dern = pts[pts.length - 1]
        ctx.lineTo(dern[0], dern[1])
        ctx.stroke()
      }
    }

    const DEMOS = [{
      titre: 'Varde 2.0 — démo',
      theme: 'sombre',
      dureeMs: 9000,
      prompt: "Deck de démonstration : essaie l'édition (T), le pinceau (B), puis demande une correction au chat.",
      slides: [
        { layout: 'titre', kicker: 'La démo', titre: 'Rain is a given.', sous: 'Slides écrites en direct par le chat — modifie-les pendant qu\'il tape.' },
        { layout: 'statement', kicker: 'The premise', titre: 'Shells should come prepared.' },
        { layout: 'puces', kicker: 'How it works', titre: 'Trois gestes', points: ['Le chat écrit : machine à écrire, slide après slide.', 'Tu corriges : retape un texte, dessine au pinceau.', 'Le chat relit : tes annotations, puis corrige en soulignant.'] },
        { layout: 'chiffre', kicker: 'Tempo', grand: '12 s', legende: 'pour un deck complet, tempo réglable' },
        { layout: 'fin', titre: 'À toi.', sous: 'Demande une correction : l\'agent relit tes retouches et les intègre.' },
      ],
    }]

    /* ═══════════════ 5. PANNEAU ═══════════════ */

    let CTX = null
    let SERVICE_SIDEBAR = null
    let SESSION_ID = ''
    let TICK = null // horloge locale de relecture ({t0, vitesse} ou null)

    /** Ouvre l'onglet « Slides » quand un deck arrive (motif kybernos-modeleur :
     * `sidebarRight` lu À L'APPEL — un service manquant ne bloque rien). */
    function ouvrirOnglet () {
      if (CTX !== null && SERVICE_SIDEBAR === null) {
        try { SERVICE_SIDEBAR = CTX.get('sidebarRight') } catch { SERVICE_SIDEBAR = null }
      }
      if (!SERVICE_SIDEBAR || typeof SERVICE_SIDEBAR.openTab !== 'function') return
      try { SERVICE_SIDEBAR.openTab(KIND, {}) } catch { /* pas de session montée */ }
    }

    function PanneauSlides () {
      const [, force] = React.useReducer((x) => x + 1, 0)
      const S = React.useRef({
        deck: null, ann: { version: 0, edits: [], strokes: [] },
        overrides: new Map(), traits: new Map(),
        corrections: [], corInstant: 0,
        outil: 'voir', couleur: '#F2C31A',
        vue: 0, suivre: true, edition: null, editionRect: null, editeurRiche: null, selection: null,
        echelle: 0.2, encours: false,
      }).current
      const sceneRef = React.useRef(null)
      const racineRef = React.useRef(null)
      const wrapRef = React.useRef(null)
      const canvasRef = React.useRef(null)
      const traitLive = React.useRef(null)

      const reveiller = () => force()

      React.useEffect(() => {
        if (TICK !== null) { S.deck = null; TICK = null }
      }, [])
      React.useEffect(() => { S.echelle = 0.2; reveiller() }, [])

      // ── sonde de l'hôte ────────────────────────────────────────────────
      React.useEffect(() => {
        let vivant = true
        const interroger = async () => {
          let data = null
          try {
            const url = ROUTE_STATE + (SESSION_ID ? `?session=${encodeURIComponent(SESSION_ID)}` : '')
            const r = await fetch(url)
            if (r.ok) data = await r.json()
          } catch { /* l'hôte reviendra */ }
          if (!vivant || data === null || data.vide) return
          const d = S.deck
          if (d === null || data.version !== d.version) {
            // L'« avant » du diff vient de l'hôte (deck précédent poussé avec
            // la correction) : le soulignement survit à un rechargement.
            const avant = Array.isArray(data.precedent) && data.precedent.length > 0
              ? normaliserDeck(data.precedent)
              : (d !== null ? d.slides : [])
            const deck = {
              version: data.version,
              t0: data.t0, dureeMs: data.dureeMs,
              titre: data.titre, theme: themeDe(data.theme), prompt: data.prompt,
              mode: data.mode, slides: normaliserDeck(data.slides),
            }
            const corriger = deck.mode === 'corriger' && avant.length > 0
            S.corrections = corriger ? diffSlides(avant, deck.slides) : []
            S.corInstant = Date.now()
            if (!corriger) S.overrides = new Map()
            else {
              const touche = new Set(S.corrections.map((c) => cleChamp(c.slide, c.champ, c.idx)))
              for (const cle of [...S.overrides.keys()]) if (touche.has(cle)) S.overrides.delete(cle)
            }
            if (data.annotations && data.annotations.version !== S.ann.version) appliquerAnnotations(S, data.annotations)
            S.deck = deck
            S.vue = 0
            S.suivre = true
            TICK = null
            // NB : pas d'ouvrirOnglet() ici — un openTab déclenché pendant le
            // commit du panneau lève « React error #60 » (mise à jour d'un
            // composant pendant le rendu d'un autre). L'ouverture automatique
            // est du ressort de la sonde au niveau module, différée hors rendu.
            reveiller()
          } else if (S.deck !== null && progression(S) < 1) {
            // Onglet masqué : rAF est mis en pause par Chrome, l'horloge de
            // frappe (t0 de l'hôte) reste juste mais plus personne ne repeint —
            // le sondage (intervalle, jamais asphyxié) prend le relais.
            reveiller()
          }
        }
        interroger()
        const t = setInterval(interroger, CADENCE_MS)
        return () => { vivant = false; clearInterval(t) }
      }, [])

      // ── horloge de frappe : rattrape t0 de l'hôte, puis stoppe ─────────
      React.useEffect(() => {
        let raf = 0
        const boucle = () => {
          if (S.deck !== null && progression(S) < 1) reveiller()
          else if (S.corrections.length > 0 && Date.now() - S.corInstant < 9000) reveiller()
          raf = requestAnimationFrame(boucle)
        }
        raf = requestAnimationFrame(boucle)
        return () => cancelAnimationFrame(raf)
      }, [])

      // ── calage de l'échelle de la scène ────────────────────────────────
      React.useEffect(() => {
        const el = sceneRef.current
        if (el === null) return
        // La chaîne de hauteurs casse au parent `display:contents` du slot
        // (boîte 0×0 : `height:100%` du root ne résout pas) — on mesure le
        // corps du pane et on fixe la hauteur du root en pixels.
        const corps = racineRef.current?.parentElement?.parentElement ?? null
        const calerHauteur = () => {
          const dispo = corps?.clientHeight ?? 0
          if (dispo >= 300) racineRef.current.style.height = dispo + 'px'
        }
        const caler = () => {
          calerHauteur()
          const w = el.clientWidth - 20
          const hh = el.clientHeight - 20
          const k = Math.max(0.05, Math.min(w / L, hh / H))
          if (Math.abs(k - S.echelle) > 0.001) { S.echelle = k; reveiller() }
        }
        caler()
        const ro = new ResizeObserver(caler)
        ro.observe(el)
        if (corps !== null) ro.observe(corps)
        return () => ro.disconnect()
      }, [])

      // ── rendu du calque de traits ──────────────────────────────────────
      React.useEffect(() => {
        const cv = canvasRef.current
        if (cv === null) return
        const ctx = cv.getContext('2d')
        ctx.setTransform(2, 0, 0, 2, 0, 0)
        ctx.clearRect(0, 0, L, H)
        const liste = traitLive.current !== null
          ? [...(S.traits.get(S.vue) || []), traitLive.current]
          : (S.traits.get(S.vue) || [])
        if (liste.length > 0) dessinerTraits(ctx, liste)
      })

      const p = S.deck !== null ? progression(S) : 1
      const theme = THEMES[S.deck !== null ? S.deck.theme : 'sombre']
      const intervals = S.deck !== null ? budget(S.deck.slides) : []
      const enEcriture = S.deck !== null && p < 1
      const kVue = S.deck !== null
        ? (S.suivre || enEcriture ? Math.max(0, slideActive(intervals, p)) : clamp(S.vue, 0, S.deck.slides.length - 1))
        : 0
      if (kVue !== S.vue) S.vue = kVue
      const slide = S.deck !== null && S.deck.slides[kVue] ? S.deck.slides[kVue] : null
      const qSlide = slide !== null && intervals[kVue]
        ? clamp((p - intervals[kVue].start) / (intervals[kVue].weight || 1), 0, 1)
        : 1
      const segs = slide !== null ? segments(slide) : []
      const texteDe = (champ, idx) => {
        const cle = cleChamp(kVue, champ, idx)
        const survol = S.overrides.get(cle)
        if (survol !== undefined) return survol
        if (champ === 'points') return slide.points[idx] || ''
        return slide[champ] || ''
      }
      const segDe = (champ, idx) => segs.find((g) => g.champ === champ && g.idx === idx) || null
      const frappe = (champ, idx) => {
        const seg = segDe(champ, idx)
        if (seg === null || !enEcriture) return { texte: texteDe(champ, idx), tape: false }
        const t = texteDe(champ, idx)
        const source = S.overrides.has(cleChamp(kVue, champ, idx)) ? t : seg.source
        const vu = texteVisible({ ...seg, source }, qSlide)
        return { texte: vu, tape: vu.length < source.length }
      }

      const corrigeIci = (champ, idx) => S.corrections.some((c) => c.slide === kVue && c.champ === champ && c.idx === idx)

      // ── édition : ouvrir la boîte de saisie sur un champ ───────────────
      // Clic (outil ✎ Texte) ou double-clic direct, à la Google Slides.
      const ouvrirEdition = (e, champ, idx, force) => {
        if ((!force && S.outil !== 'texte') || S.deck === null) return
        const noeud = e.currentTarget
        const wrap = wrapRef.current
        if (noeud === null || wrap === null) return
        const r = noeud.getBoundingClientRect()
        const w = wrap.getBoundingClientRect()
        const k = S.echelle
        S.edition = { slide: kVue, champ, idx, avant: texteDe(champ, idx), couleur: S.overrides.get(cleChamp(kVue, champ, idx) + ':couleur') ?? null }
        S.editionRect = {
          x: (r.left - w.left) / k, y: (r.top - w.top) / k,
          w: r.width / k, h: r.height / k,
          font: getComputedStyle(noeud).font, lh: getComputedStyle(noeud).lineHeight,
          ta: getComputedStyle(noeud).textAlign, color: getComputedStyle(noeud).color,
        }
        if (TT !== null) S.editeurRiche = monterEditeurRiche(S.edition, noeud)
        reveiller()
      }
      const fermerEdition = (valider, valeur) => {
        const ed = S.edition
        let riche = null
        if (S.editeurRiche !== null) {
          riche = valider ? htmlCompacte(S.editeurRiche.editeur.getHTML()) : null
          try { S.editeurRiche.editeur.destroy() } catch { /* déjà parti */ }
          S.editeurRiche.host.remove()
          S.editeurRiche = null
        }
        S.edition = null
        S.editionRect = null
        const final = riche !== null ? riche : valeur
        if (ed !== null && valider && final !== null && final !== ed.avant) {
          S.overrides.set(cleChamp(ed.slide, ed.champ, ed.idx), final)
          pousserAnnotations({ edits: [{ slide: ed.slide, champ: ed.champ, idx: ed.idx, avant: ed.avant, apres: final, couleur: ed.couleur }] })
        }
        reveiller()
      }
      // Couleur du texte du champ en cours d'édition — pousse tout de suite
      // une retouche `couleur`, que l'agent relit comme les autres.
      const PALETTE = ['#F2C31A', '#E1502A', '#37B5C4', '#1F9D57', '#B78BF9', '#111111']
      const choisirCouleur = (c) => {
        const ed = S.edition
        if (ed === null) return
        ed.couleur = c
        S.overrides.set(cleChamp(ed.slide, ed.champ, ed.idx) + ':couleur', c)
        pousserAnnotations({ edits: [{ slide: ed.slide, champ: ed.champ, idx: ed.idx, avant: ed.avant, apres: ed.avant, couleur: c }] })
        reveiller()
      }
      // Édition riche (TipTap vendoré) : barre G/I/S + couleurs, montée en
      // impératif à côté de React — ProseMirror possède son propre DOM.
      const monterEditeurRiche = (ed, noeud) => {
        const wrap = wrapRef.current
        if (wrap === null || document === undefined) return null
        const rn = noeud.getBoundingClientRect()
        const wr = wrap.getBoundingClientRect()
        const k = S.echelle
        const host = document.createElement('div')
        // Barre de format DOCKÉE en haut de la scène (façon Google Slides),
        // l'édition reste en place sur le texte.
        host.style.cssText = 'position:absolute;z-index:30;display:flex;flex-direction:column;gap:5px;align-items:flex-start;left:50px;top:16px'
        const barre = document.createElement('div')
        barre.style.cssText = 'display:flex;gap:4px;align-items:center;background:rgba(255,255,255,.96);border:1px solid rgba(0,0,0,.18);border-radius:6px;padding:4px 8px;box-shadow:0 2px 8px rgba(0,0,0,.18)'
        const zone = document.createElement('div')
        zone.className = 'kbs-ebox'
        zone.style.cssText = 'position:static;background:transparent;border:none;min-width:200px;max-width:520px;min-height:1.2em;padding:0'
        host.appendChild(barre)
        host.appendChild(zone)
        const bouton = (label, cmd, style) => {
          const btn = document.createElement('button')
          btn.type = 'button'
          btn.textContent = label
          btn.style.cssText = (style || '') + ';font-size:11px;padding:1px 7px;border-radius:4px;border:1px solid rgba(0,0,0,.25);background:#fff;cursor:pointer'
          btn.onmousedown = (e) => { e.preventDefault(); cmd() }
          return btn
        }
        const ch = (f) => () => editeur.chain().focus()[f]().run()
        barre.appendChild(bouton('G', ch('toggleBold'), 'font-weight:800'))
        barre.appendChild(bouton('I', ch('toggleItalic'), 'font-style:italic'))
        barre.appendChild(bouton('S', ch('toggleUnderline'), 'text-decoration:underline'))
        for (const c of PALETTE) {
          const p = document.createElement('button')
          p.type = 'button'
          p.title = 'Couleur du texte'
          p.style.cssText = 'width:18px;height:18px;border-radius:9px;border:2px solid rgba(255,255,255,.8);background:' + c + ';cursor:pointer;padding:0'
          p.onmousedown = (e) => { e.preventDefault(); editeur.chain().focus().setColor(c).run() }
          barre.appendChild(p)
        }
        wrap.appendChild(host)
        const editeur = new TT.Editor({
          element: zone,
          extensions: [
            TT.StarterKit.configure({ heading: false, blockquote: false, codeBlock: false, code: false, horizontalRule: false, bulletList: false, orderedList: false, listItem: false }),
            TT.Underline, TT.TextStyle, TT.Color,
          ],
          content: ed.avant.includes('<')
            ? ed.avant
            : '<p>' + ed.avant.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</p>',
          editorProps: {
            attributes: { style: 'outline:none;font:inherit;color:inherit' },
            handleKeyDown: (view, event) => {
              if (event.key === 'Escape') { fermerEdition(false, null); return true }
              if (event.key === 'Enter' && !event.shiftKey) { fermerEdition(true, null); return true }
              return false
            },
          },
        })
        return { host, editeur }
      }

      // ── pinceau / gomme ────────────────────────────────────────────────
      const posTrait = (e) => {
        const r = e.currentTarget.getBoundingClientRect()
        return [clamp((e.clientX - r.left) / S.echelle, 0, L), clamp((e.clientY - r.top) / S.echelle, 0, H)]
      }
      const traitDebut = (e) => {
        if (S.outil !== 'pinceau' && S.outil !== 'gomme') return
        if (S.outil === 'gomme') {
          const [x, y] = posTrait(e)
          const liste = S.traits.get(S.vue) || []
          const i = hitStroke(liste, x, y, 18)
          if (i >= 0) {
            const reste = liste.slice(0, i).concat(liste.slice(i + 1))
            S.traits.set(S.vue, reste)
            pousserTraits(S, S.vue)
            reveiller()
          }
          return
        }
        e.currentTarget.setPointerCapture && e.currentTarget.setPointerCapture(e.pointerId)
        traitLive.current = { points: [posTrait(e)], color: S.couleur, width: 5 }
        reveiller()
      }
      const traitBouge = (e) => {
        if (traitLive.current === null) return
        traitLive.current.points.push(posTrait(e))
        reveiller()
      }
      const traitFin = () => {
        if (traitLive.current === null) return
        if (traitLive.current.points.length >= 2) {
          const liste = S.traits.get(S.vue) || []
          S.traits.set(S.vue, [...liste, traitLive.current])
          pousserTraits(S, S.vue)
        }
        traitLive.current = null
        reveiller()
      }

      // ── lecture ────────────────────────────────────────────────────────
      const rejouer = () => {
        if (S.deck === null) return
        TICK = { t0: Date.now(), vitesse: TICK !== null ? TICK.vitesse : 1 }
        S.suivre = true
        reveiller()
      }
      const vitesses = [0.5, 1, 2]
      const changerVitesse = (v) => {
        const vitesse = TICK !== null ? TICK.vitesse : 1
        TICK = { t0: Date.now() - (p * S.deck.dureeMs) / v * vitesse, vitesse: v }
        reveiller()
      }

      // ── construction de la slide ───────────────────────────────────────
      // M-01 (sécurité) : le HTML riche n'est plus rendu tel quel. Un champ
      // n'est considéré riche QUE si TOUTES ses balises appartiennent à la
      // liste blanche TipTap (gras, italique, listes…) ; tout le reste —
      // `<img onerror=…>`, texte littéral `Map<String, Integer>` — retombe en
      // TEXTE PUR échappé par React. Et même le HTML admis passe par un
      // assainissement DOMParser : attributs on*/javascript: supprimés.
      const RICHE_BALISES = /^(?:p|strong|em|u|s|code|br|ul|ol|li|b|i|span|mark)$/
      const estRicheTipTap = (t) => {
        const balises = [...String(t).matchAll(/<\/?([a-zA-Z][a-zA-Z0-9-]*)/g)].map((m) => m[1].toLowerCase())
        return balises.length > 0 && balises.every((b) => RICHE_BALISES.test(b))
      }
      const assainirRiche = (html) => {
        try {
          const doc = new DOMParser().parseFromString(String(html), 'text/html')
          const parcourir = (n) => {
            for (const enfant of [...n.children]) {
              parcourir(enfant)
              for (const attr of [...enfant.attributes]) {
                const nom = attr.name.toLowerCase()
                if (nom !== 'style' || /url\(|expression\(|javascript:/i.test(attr.value)) enfant.removeAttribute(attr.name)
              }
            }
          }
          parcourir(doc.body)
          return doc.body.innerHTML
        } catch { return '' }
      }
      const A = (champ, idx, props, ...enfants) => {
        const f = frappe(champ, idx)
        const { style: styleProps, className: classeProps, ...reste } = props
        const coul = S.overrides.get(cleChamp(kVue, champ, idx) + ':couleur') ?? null
        const source = texteDe(champ, idx)
        // Valeur riche (HTML TipTap whitelisté + assaini) rendue en HTML une
        // fois la frappe du champ terminée ; pendant la frappe, le texte
        // dénudé défile. Tout le reste est du texte pur (échappé par React).
        const richeVue = !f.tape && estRicheTipTap(source)
        return h('div', {
          'data-kbs': cleChamp(kVue, champ, idx),
          className: 'kbs-champ'
            + (corrigeIci(champ, idx) ? ' kbs-cor' : '')
            + (S.selection === cleChamp(kVue, champ, idx) ? ' kbs-sel' : '')
            + (classeProps ? ' ' + classeProps : ''),
          style: coul !== null ? { ...(styleProps ?? {}), color: coul } : styleProps,
          // Le HTML passe par un ref callback (post-commit) : un
          // dangerouslySetInnerHTML au milieu du rendu du slot levait
          // « React error #60 » côté hôte.
          ...(richeVue ? { ref: (el) => { if (el !== null && el.__kbsHtml !== source) { el.__kbsHtml = source; el.innerHTML = assainirRiche(source) } } } : null),
          onMouseDown: (e) => { S.selection = cleChamp(kVue, champ, idx); ouvrirEdition(e, champ, idx) },
          onDoubleClick: (e) => ouvrirEdition(e, champ, idx, true),
          ...reste,
        }, richeVue ? null : f.texte, richeVue ? null : (f.tape ? h('span', { className: 'kbs-caret' }) : null), ...enfants)
      }

      const ac = slide !== null && slide.accent ? slide.accent : theme.accent
      const styleSlide = { background: theme.bg, color: theme.ink, '--kbs-accent': ac }
      const contenu = () => {
        if (slide === null) return null
        const n = S.deck.slides.length
        const noeuds = []
        if (slide.kicker !== '') noeuds.push(A('kicker', -1, { className: 'kbs-kicker', key: 'k', style: { color: ac } }))
        if (slide.layout === 'statement') {
          noeuds.push(A('titre', -1, {
            key: 't', className: 'kbs-titre',
            style: { fontSize: 88, color: ac, position: 'absolute', top: 300, left: 110, right: 110 },
          }))
          if (slide.sous !== '') noeuds.push(A('sous', -1, { key: 's', style: { position: 'absolute', top: 620, left: 110, fontSize: 30, color: theme.ink } }))
        } else if (slide.layout === 'puces') {
          if (slide.titre !== '') noeuds.push(A('titre', -1, { key: 't', className: 'kbs-titre', style: { position: 'absolute', top: 150, left: 110, fontSize: 58 } }))
          if (slide.sous !== '') noeuds.push(A('sous', -1, { key: 's', style: { position: 'absolute', top: 246, left: 110, fontSize: 24, color: theme.muted } }))
          noeuds.push(h('ul', { key: 'l', className: 'kbs-puces', style: { position: 'absolute', top: 320, left: 110, right: 130, fontSize: 31 } },
            slide.points.map((_, i) => {
              const sg = segDe('points', i)
              const visible = !enEcriture || (sg !== null && qSlide >= sg.start)
              return h('li', { key: i, style: { opacity: visible ? 1 : 0.15, transition: 'opacity .3s' } },
                A('points', i, { style: { fontSize: 'inherit' } }))
            })))
        } else if (slide.layout === 'chiffre') {
          if (slide.titre !== '') noeuds.push(A('titre', -1, { key: 't', className: 'kbs-titre', style: { position: 'absolute', top: 150, left: 110, fontSize: 44 } }))
          noeuds.push(A('grand', -1, { key: 'g', className: 'kbs-titre', style: { position: 'absolute', top: 300, left: 110, fontSize: 190, color: ac } }))
          if (slide.legende !== '') noeuds.push(A('legende', -1, { key: 'l', style: { position: 'absolute', top: 590, left: 110, fontSize: 30, color: theme.muted } }))
        } else if (slide.layout === 'citation') {
          noeuds.push(h('div', { key: 'q', style: { position: 'absolute', top: 130, left: 100, fontSize: 150, color: ac, fontFamily: 'Georgia,serif', lineHeight: 1 } }, '«'))
          noeuds.push(A('citation', -1, { key: 'c', className: 'kbs-titre', style: { position: 'absolute', top: 270, left: 110, right: 150, fontSize: 52, fontWeight: 650 } }))
          if (slide.auteur !== '') noeuds.push(A('auteur', -1, { key: 'a', style: { position: 'absolute', top: 640, left: 110, fontSize: 26, color: theme.muted } }))
        } else { // titre / fin
          const centre = slide.layout === 'fin'
          noeuds.push(A('titre', -1, {
            key: 't', className: 'kbs-titre',
            style: {
              position: 'absolute', left: 110, right: 110, top: centre ? 340 : 330,
              fontSize: 92, textAlign: centre ? 'center' : 'left',
            },
          }))
          if (slide.sous !== '') {
            noeuds.push(A('sous', -1, { key: 's', style: { position: 'absolute', left: 110, right: 110, top: centre ? 560 : 550, fontSize: 31, color: theme.muted, textAlign: centre ? 'center' : 'left' } }))
          }
          if (!centre) noeuds.push(h('div', { key: 'r', style: { position: 'absolute', top: 290, left: 112, width: 110, height: 5, background: ac } }))
        }
        if (slide.note !== '') noeuds.push(A('note', -1, { key: 'n', className: 'kbs-note' }))
        noeuds.push(h('div', { key: 'f', className: 'kbs-foot' }, `${S.deck.titre} · ${kVue + 1}/${n}`))
        return noeuds
      }

      const correctionsRecentes = S.corrections.length > 0 && Date.now() - S.corInstant < 8000
      const outils = [
        ['voir', 'Voir'], ['texte', '✎ Texte'], ['pinceau', '✎ Pinceau'], ['gomme', 'Gomme'],
      ]

      return h('div', { className: 'kbsd-root', ref: racineRef },
        h('div', { className: 'kbs-head' },
          h('div', { className: 'kbs-title' }, S.deck !== null ? S.deck.titre : 'Slides'),
          correctionsRecentes ? h('div', { className: 'kbs-badge ia' }, `IA · ${S.corrections.length} correction${S.corrections.length > 1 ? 's' : ''}`) : null,
          h('div', { className: 'kbs-badge' + (enEcriture ? ' run' : '') }, enEcriture ? `écrit… ${Math.round(p * 100)} %` : (S.deck !== null ? 'live' : 'vide')),
        ),
        h('div', { className: 'kbs-scene', ref: sceneRef },
          S.deck === null
            ? h('div', { className: 'kbs-empty' },
                h('b', null, 'Demande un deck au chat'),
                h('div', null, 'l\'agent l\'écrit ici même, slide après slide — tu peux retaper un texte ou peindre par-dessus pendant qu\'il écrit.'),
                h('button', {
                  className: 'kbs-demo',
                  onClick: () => pousserDeck(DEMOS[0]),
                }, 'Voir la démo'))
            : h('div', { className: 'kbs-wrap', ref: wrapRef, style: { width: L * S.echelle, height: H * S.echelle } },
                h('div', {
                  className: 'kbs-stage kbs-outil-' + S.outil,
                  style: { transform: `scale(${S.echelle})`, background: theme.bg },
                },
                  h('div', { className: 'kbs-slide', style: styleSlide }, contenu()),
                  h('canvas', {
                    ref: canvasRef,
                    className: 'kbs-trait' + (S.outil === 'pinceau' || S.outil === 'gomme' ? '' : ' off'),
                    width: L * 2, height: H * 2,
                    style: { width: L, height: H, cursor: S.outil === 'gomme' ? 'not-allowed' : 'crosshair' },
                    onPointerDown: traitDebut, onPointerMove: traitBouge,
                    onPointerUp: traitFin, onPointerLeave: traitFin,
                  }),
                  S.edition !== null && S.editionRect !== null && S.editeurRiche === null
                    ? [
                        h('textarea', {
                          className: 'kbs-ebox',
                          autoFocus: true,
                          style: {
                            left: S.editionRect.x, top: S.editionRect.y,
                            width: Math.max(160, S.editionRect.w), height: Math.max(40, S.editionRect.h + 14),
                            font: S.editionRect.font, lineHeight: S.editionRect.lh,
                            textAlign: S.editionRect.ta, color: S.editionRect.color,
                          },
                          defaultValue: S.edition.avant,
                          onBlur: (e) => fermerEdition(true, e.currentTarget.value),
                          onKeyDown: (e) => {
                            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); fermerEdition(true, e.currentTarget.value) }
                            if (e.key === 'Escape') fermerEdition(false, null)
                          },
                        }),
                        // Palette Google-Slides : la couleur part aussitôt,
                        // sans fermer la boîte de texte.
                        h('div', {
                          key: 'palette',
                          style: {
                            position: 'absolute', zIndex: 31,
                            left: S.editionRect.x, top: S.editionRect.y + Math.max(40, S.editionRect.h + 14) + 6,
                            display: 'flex', gap: 6,
                          },
                        }, PALETTE.map((c) => h('button', {
                          key: c,
                          title: 'Couleur du texte',
                          className: 'kbs-coul' + (S.edition.couleur === c ? ' on' : ''),
                          style: { background: c, width: 22, height: 22, borderRadius: 11, border: '2px solid rgba(255,255,255,.75)', cursor: 'pointer', padding: 0 },
                          onClick: () => choisirCouleur(c),
                        }))),
                      ]
                    : null,
                ),
                S.outil !== 'voir'
                  ? h('div', { className: 'kbs-outils' },
                      outils.map(([cle, label]) => h('button', {
                        key: cle, className: 'kbs-outil' + (S.outil === cle ? ' on' : ''),
                        onClick: () => { S.outil = cle; S.edition = null; S.editionRect = null; reveiller() },
                      }, label)),
                      S.outil === 'pinceau'
                        ? ['#F2C31A', '#E1502A', theme.accent, theme.ink].map((c) => h('button', {
                            key: c, className: 'kbs-coul' + (S.couleur === c ? ' on' : ''),
                            style: { background: c, margin: '2px 2px' },
                            onClick: () => { S.couleur = c; reveiller() },
                          }))
                        : null,
                      h('button', {
                        className: 'kbs-outil',
                        onClick: () => { S.traits.set(S.vue, []); pousserTraits(S, S.vue); reveiller() },
                      }, 'Tout effacer'))
                  : null,
              ),
        ),
        h('div', { className: 'kbs-vignettes' },
          S.deck !== null
            ? S.deck.slides.map((s, i) => h('button', {
                key: i,
                className: 'kbs-vign' + (i === kVue ? ' on' : ''),
                title: s.titre || s.grand || s.citation || s.layout,
                onClick: () => { S.vue = i; S.suivre = false; reveiller() },
              }, miniature(s, theme), h('i', null, String(i + 1))))
            : null,
        ),
        h('div', { className: 'kbs-bar' },
          h('button', { className: 'kbs-play', title: 'Rejouer l\'écriture', onClick: rejouer }, '▶'),
          vitesses.map((v) => h('button', {
            key: v, className: 'kbs-sp' + ((TICK !== null ? TICK.vitesse : 1) === v ? ' on' : ''),
            onClick: () => changerVitesse(v),
          }, `×${v}`)),
          h('input', {
            type: 'range', className: 'kbs-range', min: 0, max: 1000, value: Math.round(p * 1000),
            onChange: (e) => {
              if (S.deck === null) return
              TICK = { t0: Date.now() - (Number(e.currentTarget.value) / 1000) * S.deck.dureeMs, vitesse: TICK !== null ? TICK.vitesse : 1 }
              S.suivre = true
              reveiller()
            },
          }),
        ),
        h('div', { className: 'kbs-note-bas' },
          S.deck === null
            ? h('b', null, 'Panneau « Slides » — le chat écrit, tu modifies, il corrige.')
            : h('span', null,
                h('b', null, S.deck.prompt !== '' ? S.deck.prompt : S.deck.titre),
                S.ann.edits.length > 0 || S.ann.strokes.length > 0
                  ? ` — tes retouches : ${S.ann.edits.length} texte(s), ${S.ann.strokes.length} trait(s) (relues par l'agent)`
                  : ''),
        ),
      )
    }

    /* ── progression et annotations (hors composant, testables) ─────────── */

    function progression (S) {
      if (S.deck === null) return 1
      const t0 = TICK !== null ? TICK.t0 : S.deck.t0
      const vitesse = TICK !== null ? TICK.vitesse : 1
      return clamp(((Date.now() - t0) * vitesse) / (S.deck.dureeMs || 1), 0, 1)
    }

    /** Rejoue les annotations du serveur dans l'état local du panneau. */
    function appliquerAnnotations (S, ann) {
      S.ann = { version: ann.version, edits: ann.edits || [], strokes: ann.strokes || [] }
      for (const e of S.ann.edits) {
        S.overrides.set(cleChamp(e.slide, e.champ, e.idx), e.apres)
        if (typeof e.couleur === 'string' && e.couleur.startsWith('#')) {
          S.overrides.set(cleChamp(e.slide, e.champ, e.idx) + ':couleur', e.couleur)
        }
      }
      const parSlide = new Map()
      for (const t of S.ann.strokes) {
        const liste = parSlide.get(t.slide) || []
        liste.push(t)
        parSlide.set(t.slide, liste)
      }
      S.traits = parSlide
    }

    async function pousserAnnotations (payload) {
      try {
        await fetch(ROUTE_PUSH, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: SESSION_ID, ...payload }),
        })
      } catch { /* l'hôte relira au prochain passage */ }
    }

    function pousserTraits (S, slide) {
      const liste = S.traits.get(slide) || []
      pousserAnnotations({ strokes: { [String(slide)]: liste } })
    }

    /** Dépose un deck de démo par la route push (sans passer par l'agent). */
    async function pousserDeck (demo) {
      try {
        await fetch(ROUTE_PUSH, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: SESSION_ID, ...demo, mode: 'nouveau' }),
        })
      } catch { /* rien */ }
    }

    /* ═══════════════ montage ═══════════════ */

    function apply (ctx) {
      CTX = ctx
      ctx.effect(() => {
        if (document.getElementById(STYLE_ID) === null) {
          const s = document.createElement('style')
          s.id = STYLE_ID
          s.textContent = CSS
          document.head.appendChild(s)
        }
      }, 'kybernos-slides: styles')

      try { SERVICE_SIDEBAR = ctx.get('sidebarRight') } catch { SERVICE_SIDEBAR = null }
      try {
        const ui = ctx.get('uiSession')
        const cle = ui && ui.adapter && ui.adapter.current ? ui.adapter.current.getSnapshot().key : ''
        if (typeof cle === 'string' && cle.length > 0) SESSION_ID = cle
      } catch { /* la route retombe sur la dernière commande déposée */ }

      let registre = null
      try { registre = ctx.get('sidebarRightTabs') } catch { registre = null }
      if (registre && typeof registre.register === 'function') {
        ctx.effect(() => registre.register({
          id: TYPE_ID,
          kind: KIND,
          title: () => 'Slides',
          guide: [{ title: () => 'Slides', description: () => 'Decks écrits en temps réel par le chat : frappe live, retouche et pinceau pour l\'utilisateur, corrections soulignées.' }],
        }), 'kybernos-slides: type d onglet barre latérale droite')
      }

      ctx.effect(() => ctx.slots.inject(SLOT, () => ctx.slots.register(
        { name: SLOT, key: TYPE_ID }, PanneauSlides)), 'kybernos-slides: corps de panneau')

      ctx.effect(() => {
        const t = setInterval(() => {
          try {
            const ui = ctx.get('uiSession')
            const cle = ui && ui.adapter && ui.adapter.current ? ui.adapter.current.getSnapshot().key : ''
            if (typeof cle === 'string' && cle.length > 0) SESSION_ID = cle
          } catch { /* garde la dernière clé connue */ }
        }, 4000)
        return () => clearInterval(t)
      }, 'kybernos-slides: clé de session')

      // Sonde AU NIVEAU MODULE (motif kybernos-modeleur) : elle ouvre l'onglet
      // quand un deck arrive — le panneau ne peut pas le faire lui-même, son
      // propre sondage ne tourne qu'une fois monté.
      let versionVue = null
      let ONGLET_DEJA_OUVERT = false
      ctx.effect(() => {
        const sonder = async () => {
          let data = null
          try {
            const url = ROUTE_STATE + (SESSION_ID ? `?session=${encodeURIComponent(SESSION_ID)}` : '')
            const r = await fetch(url)
            if (r.ok) data = await r.json()
          } catch { /* l'hôte reviendra */ }
          if (data === null) return
          if (data.vide) { ONGLET_DEJA_OUVERT = false; return }
          if (versionVue !== data.version) { versionVue = data.version; if (!ONGLET_DEJA_OUVERT) { ONGLET_DEJA_OUVERT = true; ouvrirOnglet() } }
        }
        sonder()
        const t = setInterval(sonder, 1200)
        return () => clearInterval(t)
      }, 'kybernos-slides: sonde d ouverture')
    }

    return {
      // `sidebarRightTabs` DOIT être déclaré : fourni par ui-sidebar-right,
      // sans cette déclaration notre `apply` tournerait AVANT le provide.
      inject: ['slots', 'sidebarRightTabs'],
      apply,
      // Surface de test : moteurs de frappe, diff, pinceau — sans navigateur.
      __test: {
        normaliserDeck, normaliserSlide, budget, segments, texteVisible,
        slideActive, diffSlides, hitStroke, dessinerTraits, cleChamp,
        progression, appliquerAnnotations, THEMES, DEMOS, poidsSlide,
      },
    }