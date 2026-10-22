// ═══════════════════════════════════════════════════════════════════════════
// kybernos-miniapps — moitié CLIENT.
//
// Ajoute un bouton « App » dans l'en-tête des mini-apps de la barre latérale
// droite (Briques, Modeleur, Slides) : il sérialise le panneau courant (DOM +
// styles + canvas figés en images) et appelle l'hôte, qui pose une petite app
// native macOS flottante — avec démarrage automatique optionnel.
//
// Aucun React : injection DOM directe, MutationObserver sur la sidebar droite.
// Enregistré par `window.__ModuleLoader__.load` — même contrat que les autres
// bundles clients (une IIFE nue ne s'active pas : leçon payée par le boot).
// ═══════════════════════════════════════════════════════════════════════════

window.__ModuleLoader__.load({
  id: '@local/kybernos-miniapps/client',
  factory () {
    const ID_STYLE = 'kbmini-style'
    const CLASSE_BOUTON = 'kbmini-btn'
    const CLASSE_MENU = 'kbmini-menu'

    // ── language: French is the source, English the pair; French only for a French UI, a translated language is looked up by its
    // French text (the dictionary the Language page keeps), and every other language (and a language not known yet) reads English ──
    const lang = () => {
      try { return String(typeof window.__KB_LANG_RESOLVE__ === 'function' ? window.__KB_LANG_RESOLVE__() : (document.documentElement.lang || 'en')) } catch (e) { return 'en' }
    }
    const kt = (fr, en) => {
      const l = lang()
      if (l === 'kybernos' || l.slice(0, 2) === 'fr') return fr
      if (l === 'en') return en
      try {
        const a = window.__KB_I18N_ACTIVE__
        if (a !== null && a !== undefined && a.dict !== null && typeof a.dict === 'object' && typeof a.dict[fr] === 'string') return a.dict[fr]
      } catch (e) { /* no dictionary: English */ }
      return en
    }
    /** 'fr' for a French UI, 'en' for every other language: what a number format is keyed by. */
    const langBase = () => { const l = lang(); return l === 'kybernos' || l.slice(0, 2) === 'fr' ? 'fr' : 'en' }

    const CSS = `
  .${CLASSE_BOUTON}{display:inline-flex;align-items:center;gap:4px;margin-inline-start:auto;
    padding:2px 9px;border-radius:9px;border:1px solid var(--dsw-alias-border-l3);background:transparent;
    color:var(--dsw-alias-label-secondary);font:600 11px/1.6 ui-rounded,-apple-system,system-ui,sans-serif;
    cursor:pointer;white-space:nowrap}
  .${CLASSE_BOUTON}:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l4)}
  .${CLASSE_BOUTON}:disabled{opacity:.6;cursor:wait}
  .${CLASSE_MENU}{position:fixed;z-index:99999;min-width:170px;padding:6px;
    border-radius:12px;border:1px solid #3a4356;background:#161c27f2;
    box-shadow:0 12px 40px #0009;display:flex;flex-direction:column;gap:2px}
  .${CLASSE_MENU} button{all:unset;padding:7px 10px;border-radius:8px;cursor:pointer;
    color:#c6d0e2;font:500 12px/1.4 ui-rounded,-apple-system,system-ui,sans-serif;
    display:flex;align-items:center;gap:8px}
  .${CLASSE_MENU} button:hover{background:#232b3a}
  .${CLASSE_MENU} .kbmini-coche{width:14px;display:inline-block;color:#ff8a3d}
  .kbmini-toast{position:fixed;bottom:18px;inset-inline-start:50%;transform:translateX(-50%);
    padding:9px 16px;border-radius:12px;background:#161c27f2;border:1px solid #3a4356;
    color:#e8ecf3;font:600 12px/1.4 ui-rounded,-apple-system,system-ui,sans-serif;z-index:99999}
  `

    // ── les panneaux reconnus : sélecteur racine + où poser le bouton ─────────
    const PANNEAUX = [
      { racine: '.kbb-root', id: 'briques', tete: '.kbb-head', get defaut () { return kt('Briques', 'Bricks') }, l: 260, h: 380 },
      // The Modeleur has its own prefix: `.kbm-root` is the root of kybernos-models' Settings page (`.kbm-root.kbmp`) and of the core's Models page, and
      // the button once landed twice on AI Provider & Models.
      { racine: '.kbmo-root', id: 'modeleur', tete: '.kbmo-head', get defaut () { return kt('Modeleur', '3D modeller') }, l: 320, h: 420 },
      // Slides renders `.kbsd-root` / `.kbsd-head`. This entry used to say `.kbs-root`, which is the root of the SKILLS page (and `.kbs-` is also
      // the prefix of the sessions and cloud bundles): the button landed on Skills, and Slides, whose classes had been renamed, got none.
      // test-miniapps-panels.mjs fails when a selector here matches a panel of another bundle.
      { racine: '.kbsd-root', id: 'slides', tete: '.kbsd-head', defaut: 'Slides', l: 420, h: 340 },
    ]

    // Racines SANS en-tête dédié (livrable mini-app ouvert depuis la page
    // Livrables, panneau sidebar, popup) : le bouton prend sa propre ligne au-dessus
    // du rendu, aligné à droite. L'id dérive du fichier — chaque mini-app s'installe
    // séparément.
    const slugId = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'miniapp'
    function panneauxDynamiques () {
      const out = []
      for (const el of Array.from(window.document.querySelectorAll('.kbma-root'))) {
        const nom = String(el.getAttribute('data-kb-nom') || el.getAttribute('data-nom') || 'MiniApp')
        out.push({ racineDynamique: el, id: 'ma-' + slugId(nom), tete: null, defaut: nom, l: 420, h: 480, flottant: true })
      }
      return out
    }

    const installe = new Map() // id → { auto }

    // ── sérialisation d'un panneau en page autonome ────────────────────────────
    function reglesApplicables (clone) {
      const morceaux = []
      for (const feuille of Array.from(window.document.styleSheets)) {
        let regles
        try { regles = feuille.cssRules } catch { continue } // feuille externe muette
        if (!regles) continue
        for (const regle of Array.from(regles)) {
          const sel = regle.selectorText
          if (typeof sel !== 'string' || sel.length === 0 || sel.length > 400) continue
          let convient = false
          try {
            if (clone.matches?.(sel)) convient = true
            else if (clone.querySelector(sel) !== null) convient = true
          } catch { continue }
          if (convient) morceaux.push(regle.cssText)
        }
      }
      return morceaux.join('\n')
    }

    function figerCanvas (el, clone) {
      // replacer chaque canvas du clone par une image du canvas vivant
      const vivants = Array.from(el.querySelectorAll('canvas'))
      const clones = Array.from(clone.querySelectorAll('canvas'))
      for (let i = 0; i < Math.min(vivants.length, clones.length); i++) {
        const img = window.document.createElement('img')
        try { img.src = vivants[i].toDataURL('image/png') } catch { img.alt = '' }
        img.style.maxWidth = '100%'
        clones[i].replaceWith(img)
      }
      return clone
    }

    // contrôles et textes de pilotage : morts hors DSH — on ne les exporte pas
    const MORTE = '[class*="-foot"],[class*="-tools"],[class*="-track"],[class*="-note"],[class*="-chips"],[class*="-empty"],[class*="-bar"],[class*="-lab"]'

    function serialiser (racine, conf) {
      const clone = racine.cloneNode(true)
      clone.querySelectorAll('button,input,select,textarea').forEach((n) => n.remove())
      clone.querySelectorAll(MORTE).forEach((n) => n.remove())
      figerCanvas(racine, clone)
      const styles = reglesApplicables(racine)
      const corps = clone.innerHTML || ''
      // M-04 : le titre vient d'un nom de livrable / de panneau — jamais
      // trusté dans une balise. On échappe le HTML (ferme </title>, etc.).
      return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escTitre(conf.defaut)}</title><style>
  html,body{height:100%;margin:0;background:#0d1118;overflow:hidden;
    display:flex;align-items:center;justify-content:center}
  html,body *{box-sizing:border-box}
  ${conf.racine}{width:100%;height:100%;padding:8px;overflow:hidden}
  ${styles}
  </style></head><body>${corps}</body></html>`
    }

    /**
     * A player that lives in another bundle (Motion) can hand over a LIVE page of its own through
     * `window.__KB_MINIAPP_EXPORTERS__[renderer](root) -> { titre, html }`: a copy of its canvas would be a still picture.
     * The renderer is the one written on the root of the page it plays in (`data-renderer`). Null when nothing is registered.
     */
    async function exporterExterne (conf) {
      try {
        const racine = conf.racineDynamique !== undefined ? conf.racineDynamique : window.document.querySelector(conf.racine)
        const renderer = racine && typeof racine.getAttribute === 'function' ? racine.getAttribute('data-renderer') : null
        const f = renderer && window.__KB_MINIAPP_EXPORTERS__ ? window.__KB_MINIAPP_EXPORTERS__[renderer] : null
        if (typeof f !== 'function') return null
        const r = await f(racine)
        return r && typeof r.html === 'string' && r.html.length > 0 ? { html: r.html, titre: String(r.titre || conf.defaut) } : null
      } catch { return null }
    }

    async function pageExport (conf) {
      // a player's own live page first (Motion), then the live export of a panel that has one (Briques), else a still snapshot
      const externe = await exporterExterne(conf)
      if (externe !== null) return externe
      try {
        const vivant = await exportVivant(conf)
        if (vivant !== null) return { html: vivant, titre: vivantTitre(conf) }
      } catch { /* repli instantané */ }
      const racine = (conf.racineDynamique !== undefined ? conf.racineDynamique : window.document.querySelector(conf.racine)) || window.document.body
      return { html: serialiser(racine, conf), titre: conf.defaut }
    }
    const vivantTitre = (conf) => conf.defaut

    // ── export VIVANT (Briques) : embarquer moteur + état dans l'app ──────────
    // The code of a plugin's client module, as the page loaded it. It is NOT in a <script> of the page: DSH fetches it and
    // lists the address in its boot script (a JSON manifest, with escaped quotes: \"url\":\"plugins/??@local/<module>/client.js&rev=…\").
    // The first inline script that merely MENTIONS the module is that boot script (38 KB of manifest, no module in it), and it used to be
    // taken for the engine: the exported app opened with a bar and no scene. A text only counts when it defines the module.
    // Returns null when nothing does; the export then falls back to a still snapshot of the panel.
    async function sourceModule (marque) {
      const echappe = marque.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const definit = (texte) => typeof texte === 'string' &&
        new RegExp('__ModuleLoader__\\s*\\.\\s*load\\s*\\(\\s*\\{\\s*id\\s*:\\s*[\'"]@local/' + echappe + '[\'"]').test(texte)
      const adresses = []
      for (const s of Array.from(window.document.scripts)) {
        if (s.src) {
          if (s.src.includes(marque)) adresses.push(s.src)
        } else if (typeof s.textContent === 'string') {
          if (definit(s.textContent)) return s.textContent
          if (s.textContent.includes(marque)) {
            const re = new RegExp('url\\\\?"\\s*:\\s*\\\\?"(plugins/\\?\\?[^"\\\\]*' + echappe + '[^"\\\\]*)', 'g')
            for (const m of s.textContent.matchAll(re)) {
              let url = m[1]
              try { url = new URL(m[1], window.document.baseURI || undefined).href } catch { /* keep the relative address */ }
              adresses.push(url)
            }
          }
        }
      }
      for (const url of adresses) {
        try {
          const r = await window.fetch(url, { cache: 'no-store' })
          if (r.ok) {
            const texte = await r.text()
            if (definit(texte)) return texte
          }
        } catch { /* this address does not answer: try the next one */ }
      }
      return null
    }

    // ── M-04 : échappement du HTML embarqué ─────────────────────────────────
    // Titre → entités (ferme </title> et toute balise) ; JSON → `</` devient
    // `<\/` (ferme </script> sans casser la chaîne JS).
    function escTitre (s) {
      return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    }
    function jsonPourScript (s) {
      return String(s).replace(/<\//g, '<\\/')
    }

    async function exportVivant (conf) {
      if (conf.id !== 'briques') return null
      const [source, rEtat] = await Promise.all([
        sourceModule('kybernos-bricks/client'),
        window.fetch('/kybernos-bricks/state', { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
      ])
      if (source === null || rEtat === null || rEtat.vide) return null
      const etat = JSON.stringify(rEtat)
      const LIBELLES = JSON.stringify({
        rejouer: kt('Rejouer', 'Replay'), pause: 'Pause',
        vues: { iso: '3/4', front: kt('Face', 'Front'), top: kt('Dessus', 'Top') }, spin: kt('Rotation', 'Spin'),
        pieces: kt('pièces', 'pieces'),
      })
      // Le moteur embarqué : stub React (la fabrique n'en a besoin qu'à la
      // définition des composants, jamais pour __test), shim ModuleLoader,
      // source du bundle bricks, puis le pilote (pose, relecture, orbite).
      return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + escTitre(conf.defaut) + '</title><style>\n' +
        'html,body{height:100%;margin:0;background:#0d1118;overflow:hidden;font-family:ui-rounded,-apple-system,system-ui,sans-serif;color:#e8ecf3}\n' +
        '#vue{position:fixed;top:0;left:0;width:100vw;height:100vh;touch-action:none}\n' +
        '.barre{position:absolute;inset-inline:0;bottom:0;display:flex;gap:6px;align-items:center;padding:8px 10px;background:#161c27e6;border-top:1px solid #232b3a}\n' +
        '.barre button{all:unset;cursor:pointer;padding:4px 10px;border-radius:8px;border:1px solid #3a4356;color:#c6d0e2;font:600 11px/1.4 ui-rounded,-apple-system,system-ui,sans-serif}\n' +
        '.barre button:hover{background:#232b3a}.barre button.on{background:#ff8a3d;color:#161c27;border-color:#ff8a3d}\n' +
        '.compte{margin-inline-start:auto;font-size:11px;color:#8fa0c0;font-variant-numeric:tabular-nums}\n' +
        '</style></head><body><canvas id="vue"></canvas><div class="barre">' +
        '<button id="play">▶</button><button data-v="0.5">0.5×</button><button data-v="1" class="on">1×</button><button data-v="2">2×</button><button data-v="4">4×</button>' +
        '<button data-cam="iso"></button><button data-cam="front"></button><button data-cam="top"></button><button id="spin"></button>' +
        '<span class="compte" id="compte"></span></div>\n' +
        '<script>\n' +
        // M-04 : un JSON dans un <script> doit neutraliser TOUTE fermeture de
        // balise — l'état (titre de maquette libre) peut porter </script>.
        'var ETAT = ' + jsonPourScript(etat) + ';\n' +
        'var LIB = ' + jsonPourScript(LIBELLES) + ';\n' +
        'window.__ModuleLoader__ = { mods: [], load: function (m) { this.mods.push(m) } };\n' +
        'var REACT_STUB = { createElement: function () { return null }, useState: function (v) { return [typeof v === "function" ? v() : v, function () {}] }, useRef: function (v) { return { current: v } }, useReducer: function (v) { return [0, function () {}] }, useEffect: function () {} };\n' +
        '</script>\n' +
        '<script>' + source.replace(/<\/script>/gi, '<\\/script>') + '</script>\n' +
        '<script>\n' +
        '(function () {\n' +
        '  var reg = window.__ModuleLoader__.mods.find(function (m) { return m.id.indexOf("kybernos-bricks") >= 0 })\n' +
        '  if (!reg) return\n' +
        '  var T = reg.factory(function (nom) { return nom === "react" ? REACT_STUB : (function () { throw new Error("hors scope") }) }).__test\n' +
        '  if (!T || !T.construire || !T.renderScene) return\n' +
        '  var RAD = Math.PI / 180\n' +
        '  var modele = T.construire(ETAT).model, total = modele.bricks.length\n' +
        '  var el = document.getElementById("vue"), ombre = document.createElement("canvas")\n' +
        '  var cam = T.makeCam(), POSE = total, T0 = 0, DUREE = Math.max(1500, ETAT.dureeMs || 8000), VITESSE = 1, EN_COURS = false, SPIN = false, RAF = 0\n' +
        '  function dessiner () {\n' +
        '    var dpr = Math.min(2, window.devicePixelRatio || 1), W = el.clientWidth || 320, H = el.clientHeight || 240\n' +
        '    if (el.width !== Math.round(W * dpr) || el.height !== Math.round(H * dpr)) { el.width = Math.round(W * dpr); el.height = Math.round(H * dpr) }\n' +
        '    if (ombre.width !== el.width || ombre.height !== el.height) { ombre.width = el.width; ombre.height = el.height }\n' +
        '    var ctx = el.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0)\n' +
        '    ombre.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0)\n' +
        '    var bd = modele.bounds(); cam._z0 = bd.z0; T.fitCamera(cam, W, H, bd, 0.86)\n' +
        '    T.renderScene(ctx, W, H, modele.bricks.slice(0, Math.max(1, POSE)), cam, { bg: "#f7f6f3", shadowCanvas: ombre, occ: modele.occ, studs: !EN_COURS && POSE < 1400 })\n' +
        '    document.getElementById("compte").textContent = Math.round(POSE).toLocaleString("fr-FR") + " / " + total.toLocaleString("fr-FR") + " " + LIB.pieces\n' +
        '  }\n' +
        '  function boucle (t) {\n' +
        '    RAF = 0\n' +
        '    if (EN_COURS) {\n' +
        '      var ecoule = (performance.now() - T0) * VITESSE, part = Math.max(0, Math.min(1, ecoule / DUREE))\n' +
        '      POSE = Math.round(total * part); if (part >= 1) { EN_COURS = false; majBoutons() }\n' +
        '    }\n' +
        '    if (SPIN) cam.yaw += 0.005\n' +
        '    dessiner()\n' +
        '    if (EN_COURS || SPIN) RAF = requestAnimationFrame(boucle)\n' +
        '  }\n' +
        '  function reveiller () { if (!RAF) RAF = requestAnimationFrame(boucle) }\n' +
        '  var glisse = null\n' +
        '  el.addEventListener("pointerdown", function (e) { glisse = { x: e.clientX, y: e.clientY }; try { el.setPointerCapture(e.pointerId) } catch (err) {} })\n' +
        '  el.addEventListener("pointermove", function (e) {\n' +
        '    if (!glisse) return\n' +
        '    cam.yaw += (e.clientX - glisse.x) * 0.006\n' +
        '    cam.pitch = Math.max(0, Math.min(1.5, cam.pitch - (e.clientY - glisse.y) * 0.005))\n' +
        '    glisse = { x: e.clientX, y: e.clientY }; reveiller()\n' +
        '  })\n' +
        '  el.addEventListener("pointerup", function () { glisse = null })\n' +
        '  el.addEventListener("wheel", function (e) { e.preventDefault(); cam.zoom = Math.max(0.35, Math.min(3, cam.zoom * (e.deltaY > 0 ? 0.92 : 1.08))); reveiller() }, { passive: false })\n' +
        '  function majBoutons () { document.getElementById("play").textContent = EN_COURS ? LIB.pause : LIB.rejouer }\n' +
        '  document.getElementById("play").addEventListener("click", function () {\n' +
        '    if (EN_COURS) { EN_COURS = false; majBoutons(); return }\n' +
        '    POSE = 0; T0 = performance.now(); EN_COURS = true; majBoutons(); reveiller()\n' +
        '  })\n' +
        '  Array.prototype.forEach.call(document.querySelectorAll("[data-v]"), function (b) {\n' +
        '    b.addEventListener("click", function () {\n' +
        '      VITESSE = parseFloat(b.getAttribute("data-v"))\n' +
        '      Array.prototype.forEach.call(document.querySelectorAll("[data-v]"), function (x) { x.classList.toggle("on", x === b) })\n' +
        '    })\n' +
        '  })\n' +
        '  var vueBtns = document.querySelectorAll("[data-cam]")\n' +
        '  vueBtns[0].textContent = LIB.vues.iso; vueBtns[1].textContent = LIB.vues.front; vueBtns[2].textContent = LIB.vues.top\n' +
        '  document.getElementById("spin").textContent = LIB.spin\n' +
        '  Array.prototype.forEach.call(document.querySelectorAll("[data-cam]"), function (b) {\n' +
        '    b.addEventListener("click", function () {\n' +
        '      var v = b.getAttribute("data-cam")\n' +
        '      cam.yaw = (v === "iso" ? 38 : 0) * RAD\n' +
        '      cam.pitch = (v === "iso" ? 27 : v === "front" ? 0 : 84) * RAD\n' +
        '      cam.zoom = 1; reveiller()\n' +
        '    })\n' +
        '  })\n' +
        '  document.getElementById("spin").addEventListener("click", function (e) { SPIN = !SPIN; e.currentTarget.classList.toggle("on", SPIN); reveiller() })\n' +
        '  majBoutons(); dessiner()\n' +
        '  // replay the laying on open\n' +
        '  POSE = 0; T0 = performance.now(); EN_COURS = true; majBoutons(); reveiller()\n' +
        '})()\n' +
        '</script></body></html>'
    }

    // ── appel hôte ─────────────────────────────────────────────────────────────
    async function post (route, corps) {
      const r = await window.fetch(route, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corps),
      })
      return r.json()
    }

    // For another bundle (Motion's export dialog): install an app from a page it built itself. `supported` becomes true once the host
    // has said it runs on macOS (the same list call that says which apps exist); until then, or elsewhere, the caller hides the option.
    const interfaceExterne = {
      supported: false,
      async install (o) {
        const id = slugId(o && o.id)
        const r = await post('/kybernos-miniapps/install', { id, titre: String((o && o.titre) || id).slice(0, 80), html: String((o && o.html) || ''), largeur: Number(o && o.largeur) || 520, hauteur: Number(o && o.hauteur) || 360, auto: false })
        if (r && r.ok === true) installe.set(id, { auto: false })
        return r
      },
    }
    try { window.__KB_MINIAPPS__ = interfaceExterne } catch { /* no window */ }

    // `marque` (optional) is a data-kb hook on the toast, for the checks that read what the person was told.
    function toast (texte, marque) {
      const t = window.document.createElement('div')
      t.className = 'kbmini-toast'
      t.textContent = texte
      if (marque !== undefined) t.setAttribute('data-kb', marque)
      window.document.body.appendChild(t)
      setTimeout(() => t.remove(), 3800)
    }

    // Why the host refused an install, in the person's language: the host's own sentence is English and for the log, its `code` is stable.
    // An answer without a known code (or no answer) keeps the generic sentence.
    const CAUSES_INSTALLATION = {
      'macos-only': () => kt('cette fonction n’existe que sur macOS.', 'this only works on macOS.'),
      'html-short': () => kt('la page est vide.', 'the page is empty.'),
      'html-long': () => kt('la page est trop lourde.', 'the page is too large.'),
      'name-refused': () => kt('ce titre ne peut pas servir de nom d’app : change-le et réessaie.', 'this title cannot be used as an app name: change it and try again.'),
      codesign: () => kt('la signature de l’app a échoué (codesign) : vérifie que les outils de développement Apple sont installés.', 'signing the app failed (codesign): check that the Apple command line tools are installed.'),
    }
    function messageEchecInstallation (r) {
      const cause = r !== null && typeof r === 'object' && typeof r.code === 'string' && Object.prototype.hasOwnProperty.call(CAUSES_INSTALLATION, r.code) ? CAUSES_INSTALLATION[r.code] : null
      return cause === null ? kt('L’installation a échoué.', 'Installation failed.') : kt('Installation impossible : ', 'Cannot install: ') + cause()
    }

    // ── menu après installation ────────────────────────────────────────────────
    /** Where the menu goes: under the button with the left edges aligned, kept INSIDE the window. The button of a right-hand panel sits
     *  at the window's edge and the menu, starting at the button, ran about 110 px out of it (the labels were cut). When there is no
     *  room below it opens above the button. Pure. */
    function placerMenu (r, largeur, hauteur, W, H) {
      const marge = 8
      const left = Math.max(marge, Math.min(r.left, W - largeur - marge))
      let top = r.bottom + 6
      if (top + hauteur + marge > H) {
        const auDessus = r.top - hauteur - 6
        top = auDessus >= marge ? auDessus : Math.max(marge, H - hauteur - marge)
      }
      return { left, top }
    }

    function ouvrirMenu (conf, ancre) {
      window.document.querySelectorAll('.' + CLASSE_MENU).forEach((m) => m.remove())
      const etat = installe.get(conf.id) || { auto: false }
      const menu = window.document.createElement('div')
      menu.className = CLASSE_MENU
      const fermer = () => menu.remove()
      const opt = (label, action, coche) => {
        const b = window.document.createElement('button')
        const c = window.document.createElement('span')
        c.className = 'kbmini-coche'
        c.textContent = coche ? '✓' : ''
        b.appendChild(c)
        b.appendChild(window.document.createTextNode(label))
        b.addEventListener('click', () => { action(); fermer() })
        menu.appendChild(b)
      }
      opt(kt('Lancer', 'Launch'), async () => {
        // relancer = réinstaller la vue courante (l'hôte ouvre l'app)
        const ex = await pageExport(conf)
        const html = ex.html
        await post('/kybernos-miniapps/install', { id: conf.id, titre: ex.titre, html, largeur: conf.l, hauteur: conf.h, auto: etat.auto })
      })
      opt(kt('Démarrage auto', 'Launch at login'), async () => {
        const ex = await pageExport(conf)
        const html = ex.html
        toast(etat.auto ? kt('Retirer le démarrage auto…', 'Removing auto-launch…') : kt('Relancer avec démarrage auto…', 'Reinstalling with auto-launch…'))
        etat.auto = !etat.auto
        await post('/kybernos-miniapps/install', { id: conf.id, titre: ex.titre, html, largeur: conf.l, hauteur: conf.h, auto: etat.auto })
        installe.set(conf.id, etat)
      }, etat.auto)
      opt(kt('Désinstaller', 'Uninstall'), async () => {
        await post('/kybernos-miniapps/uninstall', { id: conf.id })
        installe.delete(conf.id)
        majBouton(conf)
        toast(kt('Désinstallée.', 'Uninstalled.'))
      })
      window.document.body.appendChild(menu)
      const r = ancre.getBoundingClientRect()
      const doc = window.document.documentElement || {}
      const place = placerMenu(r, menu.offsetWidth || 190, menu.offsetHeight || 120, window.innerWidth || doc.clientWidth || 1200, window.innerHeight || doc.clientHeight || 800)
      menu.style.top = place.top + 'px'
      menu.style.left = place.left + 'px'
      setTimeout(() => window.document.addEventListener('click', fermer, { once: true }), 0)
    }

    function majBouton (conf) {
      const racine = conf.racineDynamique !== undefined ? conf.racineDynamique : window.document.querySelector(conf.racine)
      if (racine === null || racine === undefined) return
      const tete = (conf.tete !== null && racine.querySelector(conf.tete)) || racine
      let btn = tete.querySelector(':scope > .' + CLASSE_BOUTON)
      if (btn === null) {
        btn = window.document.createElement('button')
        btn.className = CLASSE_BOUTON
        btn.title = kt('Petite fenêtre autonome, toujours au-dessus, qui survit à la fermeture de DSH.', 'A standalone little window, always on top, that survives closing DSH.')
        if (conf.flottant === true) {
          // A mini-app has no head of its own: the button is a strip of its own ABOVE the player, right-aligned, in the flow. Floated
          // over the corner (top 8 px, right 8 px) it covered the primary button of the Quiz and Cards players (« Check », « Replay »):
          // a click in the middle of that button installed an app instead.
          btn.style.alignSelf = 'flex-end'
          btn.style.margin = '0 0 6px'
          tete.prepend(btn)
        } else tete.appendChild(btn)
      }
      const etat = installe.get(conf.id)
      const libelle = 'App' + (etat ? ' ⚙' : ' ⤓')
      if (btn.textContent !== libelle) btn.textContent = libelle
      // ⚠ ne JAMAIS écrire le DOM inconditionnellement ici : balayer() tourne
      // dans un MutationObserver — réécrire textContent à l'identique crée une
      // mutation → reboucle → crash du renderer (mesuré : page tuée en ~1 s).
      btn.onclick = async () => {
        if (installe.has(conf.id)) { ouvrirMenu(conf, btn); return }
        btn.textContent = kt('Installation…', 'Installing…')
        btn.disabled = true
        try {
          const ex = await pageExport(conf)
          const html = ex.html
          const r = await post('/kybernos-miniapps/install', { id: conf.id, titre: ex.titre, html, largeur: conf.l, hauteur: conf.h, auto: false })
          if (r && r.ok === true) { installe.set(conf.id, { auto: false }); toast(kt('Mini-app installée — elle vit hors de DSH.', 'Mini-app installed — it lives outside DSH.')) }
          else toast(messageEchecInstallation(r), 'miniapps-install-error')
        } catch { toast(messageEchecInstallation(null), 'miniapps-install-error') }
        btn.disabled = false
        majBouton(conf)
      }
    }

    let balayageEnCours = false
    let balayageAttente = false
    function balayer () {
      // anti-rebond : l'observateur voit nos propres écritures — sans cette
      // garde, un simple textContent reboucle à l'infini.
      if (balayageEnCours) { balayageAttente = true; return }
      balayageEnCours = true
      try { balayerReel() } finally {
        balayageEnCours = false
        if (balayageAttente) { balayageAttente = false; queueMicrotask(balayer) }
      }
    }

    let dernierBalayage = 0
    let balayageDiffere = null
    function balayerReel () {
      const maintenant = Date.now()
      const attente = 200 - (maintenant - dernierBalayage)
      if (attente > 0) {
        // No more than 5 sweeps a second, but a sweep that is skipped is REPLAYED once the quiet period is over: a panel mounted
        // right after another change used to find nobody to sweep for it, and never got its button until some unrelated mutation.
        if (balayageDiffere === null) balayageDiffere = setTimeout(() => { balayageDiffere = null; balayer() }, attente)
        return
      }
      dernierBalayage = maintenant
      if (window.document.getElementById(ID_STYLE) === null) {
        const s = window.document.createElement('style')
        s.id = ID_STYLE
        s.textContent = CSS
        window.document.head.appendChild(s)
      }
      for (const conf of PANNEAUX.concat(panneauxDynamiques())) majBouton(conf)
      // état réel des installs connues
      window.fetch('/kybernos-miniapps/list', { cache: 'no-store' })
        .then((r) => r.json())
        .then((r) => {
          if (r && typeof r.macos === 'boolean') interfaceExterne.supported = r.macos
          if (!r || !Array.isArray(r.items)) return
          for (const it of r.items) installe.set(it.id, { auto: it.auto === true })
          for (const conf of PANNEAUX.concat(panneauxDynamiques())) majBouton(conf)
        })
        .catch(() => {})
    }

    function apply (ctx) {
      try {
        ctx.effect(() => {
          balayer()
          const obs = new MutationObserver(() => balayer())
          obs.observe(window.document.body, { childList: true, subtree: true })
          return () => obs.disconnect()
        }, 'kybernos-miniapps: boutons App sur les mini-apps')
      } catch { /* harnais sans effet */ }
    }

    return {
      apply,
      inject: [],
      __test: { majBouton, messageEchecInstallation, kt, serialiser, reglesApplicables, PANNEAUX, escTitre, jsonPourScript, sourceModule, placerMenu, pageExport, exporterExterne, interfaceExterne },
    }
  },
})
