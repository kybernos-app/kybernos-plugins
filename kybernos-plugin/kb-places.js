// kb-places.js — renderer « places » pour MiniApps kybernos
//
// Fichier AUTONOME : il ne remplace ni n'importe rien dans client.js. Il se
// charge comme un script global (ou via eval) et s'expose sur
// `window.KB_PLACES = { component, parse }`. Le câblage dans
// KB_MINIAPP_COMPONENTS reste une décision du plugin : ici on ne fait que
// fournir le composant.
//
// Contrat d'entrée (voir ArtBody dans client.js) : props { text, name }.
// `text` est le JSON reconstruit par ArtBody, soit {"items":[...]} où chaque
// entrée porte un `payload`, soit un tableau nu. On accepte les deux.
//
// Style : mêmes réflexes que le client — pas d'optional chaining, comparaisons
// explicites au null, CSS injecté une fois, helpers en `kb*`, classes en `.kbpl-`.
(function () {
  'use strict'

  var React_ = (typeof React !== 'undefined' ? React : window.React)
  if (React_ === null || React_ === undefined) return
  var h = React_.createElement

  // `globalThis` est capturé AVANT que le client n'évalue ce fichier : son
  // shim `kbPlacesEval` passe globalThis/self = un objet factice, donc le vrai
  // objet global n'est accessible qu'ici.window` reste la cible d'exposition.
  var GLOBAL_ = (typeof globalThis !== 'undefined' ? globalThis : window)

  // ── Icônes ────────────────────────────────────────────────────────────────

  // ── Icônes ────────────────────────────────────────────────────────────────
  // Table locale : ce fichier doit rester compilable et exécutable seul, donc
  // on ne dépend pas de la const LUCIDE du client. Clés = sous-ensemble exact
  // de celles déclarées dans client.js (star, check, link, phone/tel, etc.).
  var PL_ICONS = {
    star: ['M11.52 2.8a.55.55 0 0 1 1 0l2.34 6.37a.55.55 0 0 0 .47.35l6.36.57a.55.55 0 0 1 .31.97l-4.84 4.86a.55.55 0 0 0-.13.47l1.01 6.3a.55.55 0 0 1-.83.56L12.32 19.6a.55.55 0 0 0-.64 0l-5.25 3.64a.55.55 0 0 1-.83-.56l1-6.3a.55.55 0 0 0-.13-.47L1.6 11.06a.55.55 0 0 1 .31-.97l6.36-.57a.55.55 0 0 0 .47-.34z'],
    search: ['M11 11m8 0a8 8 0 1 0-16 0 8 8 0 1 0 16 0', 'm21 21-4.35-4.35'],
    house: ['m15 21-6 0', 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
    link: ['M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71', 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'],
    phone: ['M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z'],
    pin: ['M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z', 'M12 12m2 0a2 2 0 1 0-4 0 2 2 0 1 0 4 0'],
    target: ['M12 12m10 0a10 10 0 1 0-20 0 10 10 0 1 0 20 0', 'M12 12m6 0a6 6 0 1 0-12 0 6 6 0 1 0 12 0', 'M12 12m2 0a2 2 0 1 0-4 0 2 2 0 1 0 4 0'],
    x: ['M18 6 6 18', 'M6 6l12 12'],
    check: ['M20 6 9 17l-5-5'],
    info: ['M12 12m10 0a10 10 0 1 0-20 0 10 10 0 1 0 20 0', 'M12 16v-4', 'M12 8h.01'],
    loader: ['M12 2v4', 'M12 18v4', 'M4.93 4.93l2.83 2.83', 'M16.24 16.24l2.83 2.83', 'M2 12h4', 'M18 12h4', 'M4.93 19.07l2.83-2.83', 'M16.24 7.76l2.83-2.83'],
  }
  function plIcon(name, size) {
    var d = PL_ICONS[name]
    if (d === null || d === undefined) return null
    var s = size === undefined ? 14 : size
    return h('svg', { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', style: { flex: 'none' } },
      d.map(function (p, i) { return h('path', { d: p, key: i }) }))
  }

  // ── Parsing tolérant ──────────────────────────────────────────────────────
  // Un agent écrit ce JSON à la main : on accepte payload ou objet direct,
  // titre/title/name, description/blurb, q/query… et on jette sans bruit ce
  // qui n'a pas de nom (une carte sans titre n'a aucun sens à afficher).
  function plStr(v) { return typeof v === 'string' ? v.trim() : (v === null || v === undefined || typeof v === 'number' ? String(v) : '') }
  function plField(p, names) {
    for (var i = 0; i < names.length; i++) {
      var v = p[names[i]]
      if (v !== null && v !== undefined && plStr(v) !== '') return plStr(v)
    }
    return ''
  }
  function plNum(v) {
    if (typeof v === 'number') return isNaN(v) === false ? v : null
    if (typeof v === 'string') {
      var m = v.replace(/[^0-9.,]/g, '').replace(',', '.')
      var n = parseFloat(m)
      return isNaN(n) === false ? n : null
    }
    return null
  }
  // `open_now` est déclaré "string?" par la skill : l'agent y met soit un
  // booléen, soit un horaire libre (« jusqu'à 23:00 »). On garde les deux.
  function plOpen(v) {
    if (v === true) return { on: true, label: 'ouvert' }
    if (typeof v === 'number') return v > 0 ? { on: true, label: 'ouvert' } : null
    if (typeof v !== 'string') return null
    var t = v.trim()
    if (t === '') return null
    var low = t.toLowerCase()
    if (low === 'false' || low === 'no' || low === 'non' || low === '0' || low === 'closed' || low === 'fermé' || low === 'ferme') {
      return { on: false, label: 'fermé' }
    }
    if (low === 'true' || low === 'yes' || low === 'oui' || low === '1' || low === 'open' || low === 'ouvert') {
      return { on: true, label: 'ouvert' }
    }
    return { on: true, label: t }
  }

  // URL sûre : le renderer tourne dans la page DSH, donc une ressource http://
  // serait bloquée en mixed-content. On n'accepte que https:// pour les photos,
  // et on laisse passer mailto:/tel: uniquement sur les champs qui s'y prêtent.
  function plSafeUrl(v) { return /^https:\/\/[^\s"']+$/i.test(String(v === null || v === undefined ? '' : v).trim()) === true }
  function plTelHref(v) {
    var t = String(v === null || v === undefined ? '' : v).replace(/[^0-9+*#]/g, '')
    return t.length > 5 ? 'tel:' + t : ''
  }

  function kbPlacesItems(text) {
    var data = null
    try { data = JSON.parse(String(text === null || text === undefined ? '' : text)) } catch (e) { data = null }
    var raw = []
    if (Array.isArray(data) === true) raw = data
    else if (data !== null && typeof data === 'object') {
      if (Array.isArray(data.items) === true) raw = data.items
      else if (Array.isArray(data.places) === true) raw = data.places
      else if (Array.isArray(data.data) === true) raw = data.data
      else if (Array.isArray(data.results) === true) raw = data.results
    }
    if (raw.length === 0 && typeof text === 'string') {
      // Repli texte brut : une ligne non vide = un lieu sans détails.
      raw = text.split('\n').map(function (l) { return l.trim() }).filter(function (l) { return l !== '' })
    }
    var out = []
    for (var i = 0; i < raw.length; i++) {
      var it = raw[i]
      var p = null
      if (it !== null && typeof it === 'object') {
        p = (it.payload !== null && typeof it.payload === 'object') ? it.payload : it
      } else if (typeof it === 'string' && it.trim() !== '') {
        p = { name: it }
      }
      if (p === null) continue
      var name = plField(p, ['name', 'titre', 'title', 'nom'])
      if (name === '') continue
      var links = (p.links !== null && typeof p.links === 'object') ? p.links : {}
      var photo = plField(p, ['photo', 'image', 'thumbnail', 'img'])
      out.push({
        name: name,
        kind: plField(p, ['kind', 'type', 'category', 'categorie']),
        rating: plNum(p.rating !== undefined ? p.rating : p.note),
        reviews: plNum(p.reviews !== undefined ? p.reviews : (p.nb_reviews !== undefined ? p.nb_reviews : p.avis)),
        price: plField(p, ['price', 'prix', 'price_level']),
        open: plOpen(p.open_now !== undefined ? p.open_now : p.ouvert),
        blurb: plField(p, ['blurb', 'description', 'resume', 'summary', 'texte']),
        q: plField(p, ['q', 'query', 'search', 'recherche']),
        address: plField(p, ['address', 'adresse']),
        photo: /^https:\/\//i.test(photo) ? photo : '',
        links: {
          site: plSafeUrl(plField(links, ['site', 'website', 'url'])) ? plField(links, ['site', 'website', 'url']).trim() : '',
          tel: plTelHref(plField(links, ['tel', 'phone']) || plField(p, ['tel', 'phone'])),
        },
      })
    }
    return out
  }

  // ── Bounding boxes de villes connues ──────────────────────────────────────
  // Tant que le géocodage court — et si jamais il échoue — la carte a déjà un
  // cadre cohérent au lieu d'un zoom monde inutile.
  var PL_CITY_BOX = {
    paris: [48.815, 2.285, 48.905, 2.47],
    lyon: [45.705, 4.76, 45.845, 5.02],
    marseille: [43.22, 5.3, 43.4, 5.52],
    londres: [51.42, -0.35, 51.62, 0.06],
    berlin: [52.44, 13.2, 52.62, 13.55],
    rome: [41.8, 12.38, 41.95, 12.62],
    tunis: [36.7, 10.12, 36.9, 10.35],
    casablanca: [33.5, -7.75, 33.65, -7.5],
    'new york': [40.63, -74.1, 40.88, -73.83],
    newyork: [40.63, -74.1, 40.88, -73.83],
  }
  // Libellés propres : les clés sont en minuscules, la barre du haut affiche
  // « N lieux · Ville » avec la casse réelle.
  var PL_CITY_LABEL = {
    paris: 'Paris', lyon: 'Lyon', marseille: 'Marseille', londres: 'Londres',
    berlin: 'Berlin', rome: 'Rome', tunis: 'Tunis', casablanca: 'Casablanca',
    'new york': 'New York', newyork: 'New York',
  }
  function plCityBox(city) {
    if (typeof city !== 'string') return null
    var k = city.trim().toLowerCase()
    if (k === '') return null
    var b = PL_CITY_BOX[k]
    if (b === null || b === undefined) return null
    return [[b[0], b[1]], [b[2], b[3]]]
  }
  // Le JSON brut reçu par ArtBody est déjà reconstruit en {items:[...]}, donc
  // le `city` de l'en-tête est perdu. On ne peut que le déduire des requêtes
  // de géocodage : « nom ville » → la première ville connue de la chaîne.
  function plCityName(text) {
    var s = String(text === null || text === undefined ? '' : text).toLowerCase()
    var keys = Object.keys(PL_CITY_BOX)
    for (var i = 0; i < keys.length; i++) {
      if (new RegExp('[^a-zà-ÿ]' + keys[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^a-zà-ÿ]').test(s) === true) {
        return PL_CITY_LABEL[keys[i]] !== undefined ? PL_CITY_LABEL[keys[i]] : keys[i]
      }
    }
    return ''
  }

  // ── Géocodage Photon avec repli Nominatim ─────────────────────────────────
  var plGeoCache = {}
  function plFetchJson(url) {
    return fetch(url).then(function (r) { return r.ok === true ? r.json() : null }).catch(function () { return null })
  }
  function plFromPhoton(q) {
    return plFetchJson('https://photon.komoot.io/api/?limit=1&q=' + encodeURIComponent(q)).then(function (j) {
      if (j === null || Array.isArray(j.features) !== true || j.features.length === 0) return null
      var f = j.features[0]
      if (f === null || typeof f !== 'object') return null
      var g = f.geometry
      if (g === null || typeof g !== 'object' || Array.isArray(g.coordinates) !== true) return null
      var c = g.coordinates
      if (typeof c[0] !== 'number' || typeof c[1] !== 'number') return null
      return { lat: c[1], lng: c[0] }
    })
  }
  function plFromNominatim(q) {
    return plFetchJson('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=' + encodeURIComponent(q)).then(function (a) {
      if (Array.isArray(a) !== true || a.length === 0) return null
      var o = a[0]
      var lat = parseFloat(o.lat); var lng = parseFloat(o.lon)
      if (isNaN(lat) === true || isNaN(lng) === true) return null
      return { lat: lat, lng: lng }
    })
  }
  function kbGeocodeOne(q) {
    var key = String(q === null || q === undefined ? '' : q).trim()
    if (key === '') return Promise.resolve(null)
    if (plGeoCache[key] !== undefined) return plGeoCache[key]
    var pr = plFromPhoton(key).then(function (r) {
      if (r !== null) return r
      return plFromNominatim(key)
    })
    plGeoCache[key] = pr
    return pr
  }

  // ── Leaflet à la demande ──────────────────────────────────────────────────
  var plLeafletP = null
  // Copie locale servie par le plugin d'abord (route maison, marche hors
  // internet), CDN en secours — même filet que React Flow côté client.
  var PL_LEAFLET_JS = ['/kybernos/vendor/leaflet.js', 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js']
  var PL_LEAFLET_CSS = ['/kybernos/vendor/leaflet.css', 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css']
  function plDark() {
    try {
      var el = document.documentElement
      if (el.getAttribute('data-theme') === 'dark') return true
      if (el.classList.contains('dark')) return true
      if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches === true) return true
    } catch (e) { /* pas de DOM */ }
    return false
  }
  function plHasCss(href) {
    var links = document.getElementsByTagName('link')
    for (var i = 0; i < links.length; i++) { if (links[i].getAttribute('href') === href) return true }
    return false
  }
  function plLoadCss(src) {
    return new Promise(function (res, rej) {
      if (plHasCss(src)) { res(); return }
      var l = document.createElement('link')
      l.rel = 'stylesheet'; l.href = src
      l.onload = function () { res() }
      l.onerror = function () { rej(new Error('css ' + src)) }
      document.head.appendChild(l)
    })
  }
  function plEach(list, fn) {
    var p = Promise.reject(new Error('aucune source'))
    list.forEach(function (src) { p = p.catch(function () { return fn(src) }) })
    return p
  }
  function plLoadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script')
      s.src = src; s.async = true
      s.onload = function () { res() }
      s.onerror = function () { rej(new Error('js ' + src)) }
      document.head.appendChild(s)
    })
  }
  function kbLoadLeaflet() {
    if (plLeafletP !== null) return plLeafletP
    plLeafletP = plEach(PL_LEAFLET_CSS, plLoadCss)
      .then(function () {
        if (window.L !== null && window.L !== undefined) return undefined
        return plEach(PL_LEAFLET_JS, plLoadScript)
      })
      .then(function () {
        if (window.L !== null && window.L !== undefined) return window.L
        throw new Error('leaflet indisponible')
      })
      .catch(function (err) { plLeafletP = null; throw err })
    return plLeafletP
  }
  function plTileUrl(dark) {
    return dark === true
      ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
  }
  var PL_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'

  // Pin SVG en teardrop, numéro centré. divIcon plutôt qu'une image : zéro
  // requête réseau et le recolorement « actif » est un simple swap d'icône.
  function plPinSvg(num, active) {
    var fill = active === true ? '#f2372a' : '#ffffff'
    var tcol = active === true ? '#ffffff' : '#1c1c1e'
    var shadow = active === true ? 'rgba(242,55,42,.45)' : 'rgba(0,0,0,.35)'
    return '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">' +
      '<path d="M14 1C7.4 1 2 6.3 2 12.9 2 21 14 35 14 35s12-14 12-22.1C26 6.3 20.6 1 14 1z" fill="' + fill + '" stroke="' + shadow + '" stroke-width="1.5"/>' +
      '<text x="14" y="17.5" text-anchor="middle" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="12" font-weight="700" fill="' + tcol + '">' + num + '</text>' +
      '</svg>'
  }
  function plPinIcon(num, active) {
    if (window.L === null || window.L === undefined) return null
    return window.L.divIcon({
      className: 'kbpl-pin' + (active === true ? ' on' : ''),
      html: plPinSvg(num, active),
      iconSize: [28, 36],
      iconAnchor: [14, 34],
      popupAnchor: [0, -30],
    })
  }

  // Requête de géocodage d'un lieu : q (vital, voir skill), puis adresse,
  // puis le nom seul — jamais de coordonnées inventées.
  function plQueryFor(p) {
    if (p.q !== '') return p.q
    if (p.address !== '' && p.name !== '') return p.name + ' ' + p.address
    return p.name
  }

  // ── Styles ────────────────────────────────────────────────────────────────
  function kbPlacesCss() {
    return '\n' +
      '.kbpl-wrap{display:flex;flex-direction:column;gap:12px}\n' +
      '.kbpl-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:12px;color:var(--dsw-alias-label-secondary,#8b949e)}\n' +
      '.kbpl-title{font-size:13.5px;font-weight:600;color:var(--dsw-alias-label-primary,#e6edf3);display:inline-flex;align-items:center;gap:7px}\n' +
      '.kbpl-city{color:var(--dsw-alias-label-secondary,#8b949e);font-weight:400}\n' +
      '.kbpl-dot{opacity:.5}\n' +
      '.kbpl-spacer{flex:1}\n' +
      '.kbpl-count{font-variant-numeric:tabular-nums;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;border:1px solid var(--dsw-alias-border-l1,#30363d);border-radius:999px;padding:2px 9px}\n' +
      '.kbpl-mapbox{position:relative}\n' +
      '.kbpl-map{height:240px;width:100%;border:1px solid var(--dsw-alias-border-l1,#30363d);border-radius:12px;overflow:hidden;background:var(--dsw-alias-bg-layer-1,#161b22)}\n' +
      '.kbpl-map .kbpl-pin{background:transparent;border:none}\n' +
      '.kbpl-note{position:absolute;left:10px;bottom:10px;z-index:500;font-size:11px;line-height:1.4;max-width:70%;padding:5px 9px;border-radius:8px;background:rgba(22,27,34,.86);color:var(--dsw-alias-label-secondary,#8b949e);border:1px solid var(--dsw-alias-border-l1,#30363d);pointer-events:none;display:flex;align-items:center;gap:6px}\n' +
      '.kbpl-rail{display:flex;gap:12px;overflow-x:auto;padding:2px 2px 10px;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch}\n' +
      '.kbpl-rail::-webkit-scrollbar{height:8px}\n' +
      '.kbpl-rail::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2,#484f58);border-radius:999px}\n' +
      '.kbpl-card{position:relative;flex:none;min-width:260px;max-width:280px;scroll-snap-align:center;display:flex;flex-direction:column;gap:8px;border:1px solid var(--dsw-alias-border-l1,#30363d);border-radius:12px;background:var(--dsw-alias-bg-layer-1,#161b22);padding:10px;cursor:pointer;transition:border-color .12s ease,transform .12s ease}\n' +
      '.kbpl-card:hover{border-color:var(--dsw-alias-border-l2,#484f58)}\n' +
      '.kbpl-card.on{border-color:#f2372a;transform:translateY(-2px)}\n' +
      '.kbpl-media{position:relative;height:104px;border-radius:9px;overflow:hidden;background:var(--dsw-alias-bg-layer-2,#21262d);display:flex;align-items:center;justify-content:center}\n' +
      '.kbpl-img{width:100%;height:100%;object-fit:cover;display:block}\n' +
      '.kbpl-mono{font-size:30px;font-weight:700;color:var(--dsw-alias-label-secondary,#8b949e);letter-spacing:-.02em}\n' +
      '.kbpl-num{position:absolute;top:7px;left:7px;min-width:20px;height:20px;padding:0 5px;display:inline-flex;align-items:center;justify-content:center;border-radius:6px;background:rgba(22,27,34,.86);color:var(--dsw-alias-label-primary,#e6edf3);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;font-weight:700;border:1px solid var(--dsw-alias-border-l1,#30363d)}\n' +
      '.kbpl-card.on .kbpl-num{background:#f2372a;color:#fff;border-color:transparent}\n' +
      '.kbpl-name{margin:0;font-size:13.5px;font-weight:600;line-height:1.35;color:var(--dsw-alias-label-primary,#e6edf3);display:flex;align-items:flex-start;gap:7px}\n' +
      '.kbpl-nbadge{flex:none;min-width:19px;height:19px;padding:0 4px;display:inline-flex;align-items:center;justify-content:center;border-radius:5px;background:var(--dsw-alias-bg-layer-2,#21262d);border:1px solid var(--dsw-alias-border-l1,#30363d);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px;font-weight:700;color:var(--dsw-alias-label-secondary,#8b949e)}\n' +
      '.kbpl-card.on .kbpl-nbadge{background:#f2372a;color:#fff;border-color:transparent}\n' +
      '.kbpl-meta{display:flex;align-items:center;flex-wrap:wrap;gap:5px;font-size:11.5px;color:var(--dsw-alias-label-secondary,#8b949e);font-variant-numeric:tabular-nums}\n' +
      '.kbpl-star{color:#f5b301;display:inline-flex;align-items:center}\n' +
      '.kbpl-open{color:var(--dsw-alias-state-success-primary,#3fb950)}\n' +
      '.kbpl-closed{opacity:.7}\n' +
      '.kbpl-blurb{font-size:12.5px;line-height:1.5;color:var(--dsw-alias-label-secondary,#8b949e)}\n' +
      '.kbpl-addr{font-size:11.5px;line-height:1.4;color:var(--dsw-alias-label-secondary,#8b949e);display:flex;align-items:flex-start;gap:6px}\n' +
      '.kbpl-links{display:flex;flex-wrap:wrap;gap:6px;margin-top:auto;padding-top:2px}\n' +
      '.kbpl-a{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;text-decoration:none;color:var(--dsw-alias-label-primary,#e6edf3);border:1px solid var(--dsw-alias-border-l1,#30363d);border-radius:7px;padding:4px 9px;background:transparent}\n' +
      '.kbpl-a:hover{border-color:var(--dsw-alias-border-l2,#484f58)}\n' +
      '.kbpl-empty{font-size:12.5px;color:var(--dsw-alias-label-secondary,#8b949e);border:1px dashed var(--dsw-alias-border-l1,#30363d);border-radius:12px;padding:16px}\n' +
      '.kbpl-leaflet-dark .leaflet-container{background:#161b22}\n'
  }
  function plInjectCss() {
    try {
      if (typeof document === 'undefined' || document === null) return
      if (document.getElementById('kb-places-css') !== null) return
      var st = document.createElement('style')
      st.id = 'kb-places-css'
      st.textContent = kbPlacesCss()
      var head = document.head !== null && document.head !== undefined ? document.head : document.documentElement
      if (head !== null && head !== undefined) head.appendChild(st)
    } catch (e) { /* feuille deja presente */ }
  }

  // ── Composant ─────────────────────────────────────────────────────────────
  function KbPlacesPlay(props) {
    var text = props !== null && props !== undefined && props.text !== undefined ? props.text : ''
    var artName = props !== null && props !== undefined && props.name !== undefined ? String(props.name) : 'places'
    var meta = props !== null && props !== undefined ? props.meta : null
    // La ville peut arriver de trois façons, par ordre de confiance : une prop
    // explicite (le plugin câblé qui lit l'en-tête du MiniApp), un objet meta,
    // ou — le cas réel d'ArtBody, qui ne passe que { text, name } — une déduction
    // depuis les requêtes de géocodage « nom ville » présentes dans le JSON.
    var city = ''
    if (meta !== null && typeof meta === 'object') city = plField(meta, ['city', 'ville'])
    if (city === '') city = plField(props || {}, ['city', 'ville'])
    if (city === '') city = plCityName(text)

    var items = React_.useMemo(function () { return kbPlacesItems(text) }, [text])
    var geoKey = React_.useMemo(function () {
      return items.map(function (p) { return plQueryFor(p) + '|' + p.name }).join('\n')
    }, [items])
    var pairCoords = React_.useState({})
    var coords = pairCoords[0]; var setCoords = pairCoords[1]
    var pairState = React_.useState({ done: 0, total: 0, failed: 0 })
    var state = pairState[0]; var setState = pairState[1]
    var pairActive = React_.useState(0)
    var active = pairActive[0]; var setActive = pairActive[1]
    var pairReady = React_.useState(false)
    var ready = pairReady[0]; var setReady = pairReady[1]

    var mapEl = React_.useRef(null)
    var railEl = React_.useRef(null)
    var mapP = React_.useRef(null)
    var markers = React_.useRef([])
    var scrolledByCard = React_.useRef(false)
    var clickedFromMap = React_.useRef(false)
    // Refs « dernière valeur » : les callbacks asynchrones (fin de géocodage,
    // clic sur un pin) doivent lire le présent, pas la closure du premier rendu.
    var itemsR = React_.useRef(items); itemsR.current = items
    var geoGen = React_.useRef(null)
    var activeR = React_.useRef(active); activeR.current = active

    plInjectCss()

    // 1) Leaflet + carte
    React_.useEffect(function () {
      var dead = false
      if (mapEl.current === null) return
      kbLoadLeaflet().then(function (L) {
        if (dead === true || mapEl.current === null) return
        var dark = plDark()
        var box = mapEl.current
        box.className = box.className + (dark === true ? ' kbpl-leaflet-dark' : '')
        // `trackResize` (défaut Leaflet) garde la carte cohérente quand le panneau
      // DSH se replie ou change de largeur.
      var map = L.map(box, { scrollWheelZoom: false, zoomControl: true, attributionControl: true })
        L.tileLayer(plTileUrl(dark), { maxZoom: 19, attribution: PL_ATTR }).addTo(map)
        var b = plCityBox(city)
        if (b !== null) map.fitBounds(b, { padding: [34, 34] })
        else if (itemsR.current.length > 0) map.setView([48.85, 2.35], 12)
        else map.setView([20, 0], 2)
        mapP.current = map
        // scrollWheelZoom seulement sur intention explicite : un scroll de page
        // qui survole la carte ne doit pas voler le défilement.
        var enable = function () { map.scrollWheelZoom.enable() }
        map.on('click', enable)
        map.on('focus', enable)
        setReady(true)
      }).catch(function () { if (dead !== true) setReady(true) })
      return function () {
        dead = true
        try { if (mapP.current !== null) { mapP.current.remove(); mapP.current = null } } catch (e) { /* carte deja demontee */ }
        markers.current = []
      }
    }, [])

    // 2) Géocodage en parallèle, séquentiellement limité à 4 à la fois
    React_.useEffect(function () {
      var gen = {}
      geoGen.current = gen
      var list = itemsR.current
      var queries = list.map(plQueryFor)
      setCoords({})
      setState({ done: 0, total: queries.length, failed: 0 })
      if (queries.length === 0) return function () { geoGen.current = null }
      var idx = 0
      var got = 0
      var failed = 0
      function tick() { if (geoGen.current === gen) setState({ done: got, total: queries.length, failed: failed }) }
      function worker() {
        if (idx >= queries.length) return Promise.resolve()
        var i = idx; idx += 1
        return kbGeocodeOne(queries[i]).then(function (r) {
          got += 1
          if (r !== null && geoGen.current === gen) {
            setCoords(function (old) { var n = Object.assign({}, old); n[i] = r; return n })
          } else if (r === null) { failed += 1 }
        }, function () { got += 1; failed += 1 }).then(tick).then(worker)
      }
      var pool = []
      for (var w = 0; w < Math.min(4, queries.length); w++) pool.push(worker())
      return function () { if (geoGen.current === gen) geoGen.current = null }
    }, [geoKey])

    // 3) Marqueurs + cadrage
    React_.useEffect(function () {
      var map = mapP.current
      if (ready !== true || map === null || window.L === null || window.L === undefined) return
      var L = window.L
      markers.current.forEach(function (m) { try { map.removeLayer(m) } catch (e) { /* deja retire */ } })
      markers.current = []
      var pts = []
      items.forEach(function (p, i) {
        var c = coords[i]
        if (c === null || c === undefined) return
        var mk = L.marker([c.lat, c.lng], { icon: plPinIcon(i + 1, i === activeR.current), title: p.name, alt: p.name }).addTo(map)
        mk.on('click', function () { clickedFromMap.current = true; setActive(i) })
        markers.current.push(mk)
        pts.push([c.lat, c.lng])
      })
      if (pts.length > 1) map.fitBounds(pts, { padding: [34, 34], maxZoom: 15 })
      else if (pts.length === 1) map.setView(pts[0], Math.max(map.getZoom(), 15))
    }, [ready, coords, items.length])

    // 4) Recolore les pins + centre la carte sur l'actif (sans recréer les layers)
    React_.useEffect(function () {
      var map = mapP.current
      if (map === null || window.L === null || window.L === undefined) return
      markers.current.forEach(function (mk, i) {
        try { mk.setIcon(plPinIcon(i + 1, i === active)) } catch (e) { /* layer mort */ }
      })
      var c = coords[active]
      if (clickedFromMap.current === true) { clickedFromMap.current = false; return }
      if (c !== null && c !== undefined) {
        try { map.panTo([c.lat, c.lng], { animate: true }) } catch (e) { /* carte pas prete */ }
      }
    }, [active, ready])

    // 5) actif → scroll de la carte dans le rail
    React_.useEffect(function () {
      if (scrolledByCard.current === true) { scrolledByCard.current = false; return }
      var rail = railEl.current
      var card = rail !== null && rail !== undefined ? rail.querySelector('[data-kbpl-idx="' + active + '"]') : null
      if (card === null || card === undefined || rail === null) return
      try {
        var target = card.offsetLeft - (rail.clientWidth / 2) + (card.offsetWidth / 2)
        rail.scrollTo({ left: Math.max(0, target), behavior: 'smooth' })
      } catch (e) {
        rail.scrollLeft = Math.max(0, card.offsetLeft - rail.clientWidth / 2 + card.offsetWidth / 2)
      }
    }, [active])

    // 6) scroll du rail → carte la plus proche du centre visible
    function onRailScroll() {
      var rail = railEl.current
      if (rail === null || items.length === 0) return
      var mid = rail.scrollLeft + rail.clientWidth / 2
      var best = 0; var bestD = Infinity
      var cards = rail.querySelectorAll('[data-kbpl-idx]')
      for (var i = 0; i < cards.length; i++) {
        var el = cards[i]
        var center = el.offsetLeft + el.offsetWidth / 2
        var d = Math.abs(center - mid)
        if (d < bestD) { bestD = d; best = parseInt(el.getAttribute('data-kbpl-idx'), 10) }
      }
      if (isNaN(best) === true) return
      if (best !== active) { scrolledByCard.current = true; setActive(best) }
    }

    function cardLink(kindLabel, href, iconName, external) {
      return h('a', {
        className: 'kbpl-a', href: href, target: external === true ? '_blank' : undefined,
        rel: external === true ? 'noopener noreferrer' : undefined,
        'data-kb': 'places-link-' + kindLabel,
      }, plIcon(iconName, 12), ' ' + kindLabel)
    }

    if (items.length === 0) {
      return h('div', { className: 'kbpl-wrap', 'data-kb': 'places' },
        h('div', { className: 'kbpl-empty' }, 'Aucun lieu exploitable dans ' + artName))
    }

    var geoDone = state.done
    var note = null
    if (geoDone >= state.total && state.total > 0 && state.failed === state.total) {
      note = h('div', { className: 'kbpl-note' }, plIcon('info', 12), ' Géolocalisation indisponible — la liste reste utilisable.')
    }

    return h('div', { className: 'kbpl-wrap', 'data-kb': 'places' },
      h('div', { className: 'kbpl-bar' },
        h('span', { className: 'kbpl-title' }, plIcon('pin', 13),
          items.length + ' lieux',
          h('span', { className: 'kbpl-city' }, ' · ' + (city !== '' ? city : 'lieux géolocalisés'))),
        h('span', { className: 'kbpl-spacer' }),
        h('span', { className: 'kbpl-count' }, geoDone + '/' + items.length + ' géolocalisés')),
      h('div', { className: 'kbpl-mapbox' },
        h('div', { className: 'kbpl-map', 'data-kb': 'places-map', ref: mapEl }),
        note),
      h('div', { className: 'kbpl-rail', 'data-kb': 'places-rail', ref: railEl, onScroll: onRailScroll },
        items.map(function (p, i) {
          var initial = p.name.charAt(0).toUpperCase()
          var imgPair = React_.useState(false)
          var imgFailed = imgPair[0]; var setImgFailed = imgPair[1]
          var mapsQ = encodeURIComponent((p.name + (p.address !== '' ? ' ' + p.address : (city !== '' ? ' ' + city : ''))).trim())
          return h('div', {
            className: 'kbpl-card' + (i === active ? ' on' : ''), key: 'pl' + i,
            'data-kb': 'places-card', 'data-kbpl-idx': String(i),
            onClick: function () { if (i !== active) { scrolledByCard.current = true; setActive(i) } },
          },
            h('div', { className: 'kbpl-media' },
              (p.photo !== '' ? h('img', { className: 'kbpl-img', src: p.photo, alt: p.name, loading: 'lazy',
                onError: function () { setImgFailed(true) } }) : null),
              (imgFailed === true || p.photo === '' ? h('span', { className: 'kbpl-mono' }, initial) : null),
              h('span', { className: 'kbpl-num' }, String(i + 1))),
            h('h3', { className: 'kbpl-name' }, h('span', { className: 'kbpl-nbadge' }, String(i + 1)), p.name),
            h('div', { className: 'kbpl-meta' },
              (p.rating !== null ? h('span', { className: 'kbpl-star' }, plIcon('star', 11), ' ' + p.rating.toFixed(1)) : null),
              (p.rating !== null && p.reviews !== null ? h('span', null, '(' + p.reviews + ')') : null),
              (p.price !== '' ? h('span', { className: 'kbpl-dot' }, '· ') : null),
              (p.price !== '' ? h('span', null, p.price) : null),
              (p.kind !== '' ? h('span', { className: 'kbpl-dot' }, '· ') : null),
              (p.kind !== '' ? h('span', null, p.kind) : null),
              (p.open !== null ? h('span', { className: p.open.on === true ? 'kbpl-open' : 'kbpl-closed' }, ' · ' + p.open.label) : null)),
            (p.blurb !== '' ? h('div', { className: 'kbpl-blurb' }, p.blurb) : null),
            (p.address !== '' ? h('div', { className: 'kbpl-addr' }, plIcon('target', 11), ' ' + p.address) : null),
            h('div', { className: 'kbpl-links' },
              (p.links.site !== '' ? cardLink('Site', p.links.site, 'link', true) : null),
              (p.links.tel !== '' ? cardLink('Appeler', p.links.tel, 'phone', false) : null),
              cardLink('Itinéraire', 'https://www.google.com/maps/dir/?api=1&destination=' + mapsQ, 'pin', true)))
        })))
  }

  var mod = { component: KbPlacesPlay, parse: kbPlacesItems, css: kbPlacesCss, geocode: kbGeocodeOne, loadLeaflet: kbLoadLeaflet }
  try { GLOBAL_.KB_PLACES = mod } catch (e) { /* globalThis en lecture seule */ }
  window.KB_PLACES = mod
})()
