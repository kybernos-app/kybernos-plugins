// kybernos-theme — browser half.
//
// Wiring of the “Simple” mockup (docs/handoff + supplied mockup) onto the
// vraies API de DSH :
//
//   mode (System/Light/Dark) ....... ctx.theme.setTheme()      — native preference
//   9 ready-made themes + accent ... ctx.theme.overrideTokens() — 17 tokens {light,dark}
//   wallpaper (24 backgrounds) ..... fixed <div> under the app — dream-skin pattern
//   police + taille ................ --dsw-font-family + ctx.theme.setFontSize() (px; 'text', px since 0.2.1-alpha.2)
//   tokens (Advanced) .............. the same overrideTokens, per scheme pair
//
// Everything this page applies is measured by makeTheme (carried over as is from
// the mockup): the derived accent aims for 4.5:1 on BOTH schemes, never a fixed
// lightness.
//
// Loaded via window.__ModuleLoader__.load — same shape as the ui-* packages.
// The factory's try/catch is vital: an evaluation error here breaks the WHOLE
// entry (“Failed to load plugins”) and leaves the GUI unusable. We
// degrade: plugin disabled, GUI preserved.
window.__ModuleLoader__.load({
  id: '@local/kybernos-theme',
  factory(require) {
    try {

      const React = require('react')
      const h = React.createElement

      // ── language: what Kybernos resolved ──────────────────────────────────────────────────────────────
      // French for the French of the product (“kybernos”, or any fr*); English for every other language, and for a language not known
      // yet; a translated language is looked up by its French text, like any kbf phrase. English is the BASE of the page.
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
      /** A decimal number in the number format of the page: a comma for French, a point for every other language. */
      const frPage = () => { const l = lang(); return l === 'kybernos' || l.slice(0, 2) === 'fr' }
      const knum = (x, digits) => { const s = Number(x).toFixed(digits); return frPage() ? s.replace('.', ',') : s }
      /** The names of the data tables below are read when they are DRAWN, in the language of the page (a constant is evaluated once, at
       *  load, before the language is known): `named(rows, { <id>: [French, English] })` gives each row a `name` looked up at every read. */
      const named = (rows, names) => {
        rows.forEach((o) => {
          const p = names[o.id]
          if (p !== undefined) Object.defineProperty(o, 'name', { enumerable: true, configurable: true, get: () => kt(p[0], p[1]) })
        })
        return rows
      }

      // `styles` follows the contract of the dynamic cordis runner: insert(css)
      // retourne un disposer.
      const styles = (() => {
        const insert = (css) => {
          const tag = document.createElement('style')
          tag.dataset.plugin = '@local/kybernos-theme'
          tag.textContent = css
          document.head.append(tag)
          return () => { tag.remove() }
        }
        return { insert }
      })()

      // ══════════════════════════════════════════════════════════════════════
      // 1. COLOUR ENGINE — carried over as is from the Simple mockup.
      //    The TK tokens are DSH's official sheet, condensed; makeTheme
      //    applies contrast, tint and overrides, then DERIVES the accent to
      //    aim for 4.5:1 (while loops on the ratio, not a hard-coded lightness).
      // ══════════════════════════════════════════════════════════════════════

      const HEX = (c) => {
        const s = String(c || '').trim()
        const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s)
        if (m === null) return null
        const x = m[1].length === 3 ? m[1].split('').map((d) => d + d).join('') : m[1]
        return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)]
      }
      const toHex = (p) => '#' + p.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
      const mix = (a, b, t) => {
        const A = HEX(a) || [0, 0, 0], B = HEX(b) || [0, 0, 0]
        return toHex([0, 1, 2].map((i) => A[i] + (B[i] - A[i]) * t))
      }
      const rgba = (c, a) => {
        const p = HEX(c) || [0, 0, 0]
        return 'rgba(' + p[0] + ',' + p[1] + ',' + p[2] + ',' + a + ')'
      }
      const lum = (c) => {
        const p = HEX(c) || [0, 0, 0]
        const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
        return 0.2126 * f(p[0]) + 0.7152 * f(p[1]) + 0.0722 * f(p[2])
      }
      const ratio = (a, b) => {
        const x = lum(a), y = lum(b)
        return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
      }
      const validHex = (v) => HEX(v) !== null

      // Official condensed sheet — light / dark, values as they are.
      const TK = {
        light: { base: '#FFFFFF', l1: '#FFFFFF', l2: '#FFFFFF', l3: '#FFFFFF', platform: '#F5F6F7', overlay: '#E9ECF2', b1: '#0000000A', b2: '#0000001A', b3: '#0000001F', b4: '#00000029', brand: '#0F1115', onBrand: '#FFFFFF', t1: '#0F1115', t2: '#61666B', t3: '#81858C', t4: '#ADB2B8', link: '#4176E6', hov: '#2631480F', act: '#2631481A', err: '#EC1313', ok: '#22C55E', warn: '#F59E0B', biz: '#4176E6', side: '#F9FAFB', navAct: '#EBEEF2', navHov: '#F1F3F5', input: '#FFFFFF', selector: '#F5F6F7', code: '#F9FAFB', codeBanner: '#F9FAFB', inline: '#FAFAFA', tipBg: '#2C2C2E', okSoft: '#E6FAED', errSoft: '#FEE2E2', warnSoft: '#FEF5E7', bizSoft: '#E4EDFD', okTx: '#15803D', warnTx: '#B45309', off: '#CFD3D6' },
        dark: { base: '#151517', l1: '#232324', l2: '#2C2C2E', l3: '#353638', platform: '#353638', overlay: '#61666B', b1: '#FFFFFF0F', b2: '#FFFFFF1F', b3: '#FFFFFF29', b4: '#FFFFFF33', brand: '#F9FAFB', onBrand: '#0F1115', t1: '#F9FAFB', t2: '#CFD3D6', t3: '#ADB2B8', t4: '#81858C', link: '#7AAAFF', hov: '#FFFFFF14', act: '#FFFFFF24', err: '#F25A5A', ok: '#22C55E', warn: '#F59E0B', biz: '#7AAAFF', side: '#1B1B1C', navAct: '#43454A', navHov: '#2C2C2E', input: '#2C2C2E', selector: '#353638', code: '#1B1B1C', codeBanner: '#2C2C2E', inline: '#292929', tipBg: '#43454A', okSoft: '#233C2C', errSoft: '#570C0C', warnSoft: '#27241F', bizSoft: '#34415B', okTx: '#4ED17E', warnTx: '#F7AD31', off: '#61666B' }
      }
      const SURF = ['base', 'l1', 'l2', 'l3', 'side', 'input', 'code', 'codeBanner', 'navAct', 'navHov', 'selector', 'platform']

      function makeTheme(mode, o) {
        const dark = mode === 'dark'
        const t = Object.assign({}, TK[mode])
        if (o.lvl >= 1) {
          t.t2 = dark ? '#E1E5EE' : '#43454A'; t.t3 = dark ? '#CFD3D6' : '#61666B'; t.t4 = dark ? '#ADB2B8' : '#81858C'
          t.b2 = dark ? '#FFFFFF59' : '#00000059'; t.b3 = dark ? '#FFFFFF73' : '#00000073'; t.b4 = dark ? '#FFFFFF8C' : '#0000008C'
        }
        if (o.lvl >= 2) {
          t.base = dark ? '#000000' : '#FFFFFF'; t.l1 = t.base; t.l2 = dark ? '#0F0F0F' : '#FFFFFF'; t.l3 = dark ? '#1B1B1C' : '#FFFFFF'
          t.side = dark ? '#0F0F0F' : '#F5F5F5'; t.input = t.l2; t.code = t.side
          t.t1 = dark ? '#FFFFFF' : '#000000'; t.t2 = dark ? '#F5F6F7' : '#1B1B1C'; t.t3 = dark ? '#E1E5EE' : '#292929'
          t.t4 = dark ? '#ADB2B8' : '#43454A' // the caption stayed at the Enhanced grey: 3.7:1 on white
          t.b2 = dark ? '#FFFFFFA6' : '#000000A6'; t.b3 = dark ? '#FFFFFFCC' : '#000000CC'; t.b4 = dark ? '#FFFFFF' : '#000000'
        }
        // Links come from DSH's own sheet (4.2:1 on white) and no level touched them: Enhanced
        // brings them to AA, Maximal to AAA, by the same walk the accent text already uses.
        if (o.lvl >= 1) { let k = 0; while (ratio(t.link, t.l1) < (o.lvl >= 2 ? 7 : 4.5) && k < 30) { t.link = mix(t.link, dark ? '#FFFFFF' : '#000000', 0.06); k++ } }
        if (o.tint > 0 && o.dom) { SURF.forEach((k) => { t[k] = mix(t[k], o.dom, o.tint / 100 * 0.16) }) }
        Object.keys(o.ov || {}).forEach((k) => { if (k.indexOf(mode + ':') === 0) { t[k.slice(mode.length + 1)] = o.ov[k] } })
        // Colour-blind palette: the green/red pair becomes blue/vermilion (Okabe-Ito, distinguishable by the three
        // common forms of colour blindness), and it really is `ok` / `err` — applied tokens — that change, not
        // just their soft backgrounds. `warn` moves too: amber (38°) sat 14° from the new orange `err` (24°), the very
        // pair this palette exists to separate, so it takes the Okabe-Ito bluish green. Each ink keeps ≥ 5:1 on
        // layer 1 and the three stay apart under simulated protanopia / deuteranopia (tested). The grade inks of
        // the notes (`.kbth-gr-*`, CSS below) repeat these hexes: a test pins them to this function.
        if (o.cb) {
          t.ok = dark ? '#56B4E9' : '#0072B2'; t.err = dark ? '#FF8A3D' : '#B84A00'; t.warn = dark ? '#14B58A' : '#00785A'
          t.okSoft = dark ? '#10263F' : '#E3EEFF'; t.errSoft = dark ? '#3D2A10' : '#FFEBD6'; t.warnSoft = dark ? '#0F2E27' : '#DDF3EC'
        }
        let acc = o.acc || t.brand
        // An accent that blends into the surface (the black of the last dot, on the dark theme) makes
        // buttons and switches invisible: we lighten it, in THIS scheme only, up to 3:1.
        if (o.acc || (o.ov && o.ov[mode + ':brand'])) { let q = 0; while (ratio(acc, t.l1) < 3 && q < 30) { acc = mix(acc, dark ? '#FFFFFF' : '#000000', 0.08); q++ } }
        let fill = acc, on = t.onBrand
        if (o.acc || (o.ov && o.ov[mode + ':brand'])) {
          if (lum(acc) > 0.35) { on = '#0F1115' } else { on = '#FFFFFF'; let j = 0; while (ratio('#FFFFFF', fill) < 4.5 && j < 24) { fill = mix(fill, '#000000', 0.05); j++ } }
        }
        let at = o.acc ? acc : t.link, i = 0
        while (ratio(at, t.l1) < 4.5 && i < 30) { at = mix(at, dark ? '#FFFFFF' : '#000000', 0.06); i++ }
        t.brand = acc; t.acc = acc; t.fill = fill; t.onAcc = on; t.accText = at
        t.accSoft = rgba(acc, dark ? 0.2 : 0.1); t.accRing = rgba(acc, 0.5)
        // The tone of the sidebar, taken from the sidebar colour the scheme ended up with (a theme's own, or an edit): darker, lighter, or tinted by the accent.
        if (o.sideTone === 'darker') t.side = mix(t.side, '#000000', dark ? 0.35 : 0.06)
        else if (o.sideTone === 'lighter') t.side = mix(t.side, '#FFFFFF', dark ? 0.08 : 0.55)
        else if (o.sideTone === 'tinted') t.side = mix(t.side, acc, dark ? 0.22 : 0.12)
        return t
      }

      // ══════════════════════════════════════════════════════════════════════
      // 2. CATALOGUE — ready-made themes, backgrounds, accents, fonts, tokens.
      //    Everything comes straight from the mockup, unchanged.
      // ══════════════════════════════════════════════════════════════════════

      const SKINS = [
        { id: 'dsh', mode: 'dark', acc: null, wp: 'none', vis: 60 },
        { id: 'bleu', mode: 'dark', acc: '#4176E6', wp: 'nuit', vis: 70 },
        { id: 'aurore', mode: 'dark', acc: '#2DD4BF', wp: 'aurore', vis: 60 },
        { id: 'nebuleuse', mode: 'dark', acc: '#A855F7', wp: 'nebuleuse', vis: 60 },
        { id: 'ambre', mode: 'dark', acc: '#F59E0B', wp: 'ambre', vis: 60 },
        { id: 'oled', mode: 'dark', acc: null, wp: 'noir', vis: 100 },
        { id: 'papier', mode: 'light', acc: '#4176E6', wp: 'seyes', vis: 55 },
        { id: 'clair', mode: 'light', acc: null, wp: 'none', vis: 60 },
        // Neutral light theme: white panels, grey fields, one violet accent, Inter. Surfaces measured on a
        // light admin dashboard; the engine still lifts the accent to 4.5:1 wherever text sits on it.
        { id: 'neutre', mode: 'light', acc: '#6114D4', wp: 'none', vis: 60, fontText: 'inter', radius: 'standard',
          ov: { 'light:base': '#FAFAFA', 'light:l1': '#FFFFFF', 'light:l2': '#F5F5F5', 'light:l3': '#FFFFFF', 'light:side': '#FFFFFF', 'light:input': '#F2F2F2', 'light:t1': '#101010' } },
        { id: 'rose', mode: 'light', acc: '#EC4899', wp: 'peche', vis: 60 },

        // ── Palettes inherited from “Colour Pack” v1 (former Kybernos tab) ──
        // The 8 packs are carried over unchanged — same names, same surfaces,
        // same accents — but PER SCHEME, through this page's `ov` vocabulary
        // (the one the Advanced tab already writes):
        //   mode: null → the pack imposes no mode; it follows System / Light /
        //                Dark as v1 did;
        //   acc: null  → the accent comes from `ov[mode+':brand']`, hence the
        //                pack's exact value in each scheme; the engine then
        //                derives `fill`/`on` to keep the label readable.
        // Roles v1 → tokens v2: bg→base, layer1→l1, layer2→l2, sidebar→side,
        // overlay→input, sidebar→code, accent→brand (per scheme).
        // Not carried over from v1: the borders (b1/b2) and the text and
        // state corrections, common to the 8 packs: outside the 17 tokens drivable here, and
        // now derived by the engine (measured contrast).
        { id: 'kb-ember', mode: null, acc: null, wp: 'none', vis: 60,
          ov: {
            'light:base': '#faf5ef', 'light:l1': '#ffffff', 'light:l2': '#f5ede3',
            'light:side': '#f3ece1', 'light:input': '#ffffff', 'light:code': '#f3ece1',
            'light:brand': '#c1552f', 'dark:base': '#191513', 'dark:l1': '#201b18',
            'dark:l2': '#2a231f', 'dark:side': '#1c1815', 'dark:input': '#221d1a',
            'dark:code': '#1c1815', 'dark:brand': '#e2805a',
          } },
        { id: 'kb-stone-cloud', mode: null, acc: null, wp: 'none', vis: 60,
          ov: {
            'light:base': '#fafafa', 'light:l1': '#ffffff', 'light:l2': '#f1f1ef',
            'light:side': '#f0f0ed', 'light:input': '#ffffff', 'light:code': '#f0f0ed',
            'light:brand': '#64748b', 'dark:base': '#141517', 'dark:l1': '#1c1d20',
            'dark:l2': '#26282c', 'dark:side': '#18191c', 'dark:input': '#1e2023',
            'dark:code': '#18191c', 'dark:brand': '#94a3b8',
          } },
        { id: 'kb-indigo-pulse', mode: null, acc: null, wp: 'none', vis: 60,
          ov: {
            'light:base': '#f8f8fd', 'light:l1': '#ffffff', 'light:l2': '#eef0fb',
            'light:side': '#edeffa', 'light:input': '#ffffff', 'light:code': '#edeffa',
            'light:brand': '#4f46e5', 'dark:base': '#131320', 'dark:l1': '#1b1b2b',
            'dark:l2': '#242438', 'dark:side': '#171728', 'dark:input': '#1d1d2e',
            'dark:code': '#171728', 'dark:brand': '#818cf8',
          } },
        { id: 'kb-midnight-pulse', mode: null, acc: null, wp: 'none', vis: 60,
          ov: {
            'light:base': '#f6f8fc', 'light:l1': '#ffffff', 'light:l2': '#eaeff8',
            'light:side': '#e8eef8', 'light:input': '#ffffff', 'light:code': '#e8eef8',
            'light:brand': '#1e40af', 'dark:base': '#101623', 'dark:l1': '#171e2e',
            'dark:l2': '#1f283b', 'dark:side': '#131a28', 'dark:input': '#192231',
            'dark:code': '#131a28', 'dark:brand': '#60a5fa',
          } },
        { id: 'kb-olive-grove', mode: null, acc: null, wp: 'none', vis: 60,
          ov: {
            'light:base': '#f8faf1', 'light:l1': '#ffffff', 'light:l2': '#eff3e2',
            'light:side': '#eef2e0', 'light:input': '#ffffff', 'light:code': '#eef2e0',
            'light:brand': '#5f7a28', 'dark:base': '#141610', 'dark:l1': '#1c1f18',
            'dark:l2': '#262a21', 'dark:side': '#181b14', 'dark:input': '#1e2219',
            'dark:code': '#181b14', 'dark:brand': '#a3c060',
          } },
        { id: 'kb-aurora-bloom', mode: null, acc: null, wp: 'none', vis: 60,
          ov: {
            'light:base': '#fdf6f9', 'light:l1': '#ffffff', 'light:l2': '#f9ebf2',
            'light:side': '#f8eaf1', 'light:input': '#ffffff', 'light:code': '#f8eaf1',
            'light:brand': '#d5286c', 'dark:base': '#1a1216', 'dark:l1': '#221820',
            'dark:l2': '#2d202a', 'dark:side': '#1e151a', 'dark:input': '#251b22',
            'dark:code': '#1e151a', 'dark:brand': '#f472b6',
          } },
        { id: 'kb-sunset-dream', mode: null, acc: null, wp: 'none', vis: 60,
          ov: {
            'light:base': '#fdf9f1', 'light:l1': '#ffffff', 'light:l2': '#f9f0df',
            'light:side': '#f8efdc', 'light:input': '#ffffff', 'light:code': '#f8efdc',
            'light:brand': '#d97706', 'dark:base': '#191510', 'dark:l1': '#221d16',
            'dark:l2': '#2d271d', 'dark:side': '#1e1913', 'dark:input': '#251f17',
            'dark:code': '#1e1913', 'dark:brand': '#fbbf24',
          } },
        { id: 'kb-plum-haze', mode: null, acc: null, wp: 'none', vis: 60,
          ov: {
            'light:base': '#faf7fe', 'light:l1': '#ffffff', 'light:l2': '#f2ecfb',
            'light:side': '#f1ebfa', 'light:input': '#ffffff', 'light:code': '#f1ebfa',
            'light:brand': '#7c3aed', 'dark:base': '#17121f', 'dark:l1': '#211a2d',
            'dark:l2': '#2b2339', 'dark:side': '#1c1626', 'dark:input': '#241c31',
            'dark:code': '#1c1626', 'dark:brand': '#a78bfa',
          } }
      ]

      const SKIN_NAMES = {
        dsh: ['Défaut DSH', 'DSH default'],
        bleu: ['Bleu profond', 'Deep blue'],
        aurore: ['Aurore', 'Aurora'],
        nebuleuse: ['Nébuleuse', 'Nebula'],
        ambre: ['Ambre', 'Amber'],
        oled: ['Minuit OLED', 'OLED midnight'],
        papier: ['Papier', 'Paper'],
        clair: ['Clair net', 'Clean light'],
        neutre: ['Neutre violet', 'Neutral violet'],
        rose: ['Rose', 'Rose'],
        'kb-ember': ['Braise', 'Ember'],
        'kb-stone-cloud': ['Pierre & Nuage', 'Stone & Cloud'],
        'kb-indigo-pulse': ['Pulsation indigo', 'Indigo pulse'],
        'kb-midnight-pulse': ['Pulsation minuit', 'Midnight pulse'],
        'kb-olive-grove': ['Olivaie', 'Olive grove'],
        'kb-aurora-bloom': ['Aube florale', 'Floral dawn'],
        'kb-sunset-dream': ['Rêve de crépuscule', 'Twilight dream'],
        'kb-plum-haze': ['Brume de prune', 'Plum mist']
      }
      named(SKINS, SKIN_NAMES)

      const WPS = [
        { id: 'none', cat: 'none', css: 'none', dom: '' },
        { id: 'noir', cat: 'colors', css: '#000000', dom: '#81858C' },
        { id: 'encre', cat: 'colors', css: '#0F1115', dom: '#81858C' },
        { id: 'ardoise', cat: 'colors', css: '#2C2C2E', dom: '#81858C' },
        { id: 'nuit', cat: 'colors', css: '#172554', dom: '#4176E6' },
        { id: 'foret', cat: 'colors', css: '#0F2A22', dom: '#22A06B' },
        { id: 'prune', cat: 'colors', css: '#2A1638', dom: '#A855F7' },
        { id: 'sable', cat: 'colors', css: '#E8DFD3', dom: '#B45309' },
        { id: 'brume', cat: 'colors', css: '#E9ECF2', dom: '#61666B' },
        { id: 'aurore', cat: 'gradients', css: 'radial-gradient(90% 70% at 15% 10%, #2dd4bf66, transparent 60%), radial-gradient(80% 70% at 90% 20%, #6366f199, transparent 55%), linear-gradient(160deg,#0b1220,#0f2a3a)', dom: '#2DD4BF' },
        { id: 'crepuscule', cat: 'gradients', css: 'radial-gradient(90% 70% at 85% 0%, #fb923caa, transparent 55%), radial-gradient(80% 80% at 10% 100%, #7c3aed99, transparent 60%), linear-gradient(180deg,#1e1b4b,#3b1d4a)', dom: '#FB923C' },
        { id: 'nebuleuse', cat: 'gradients', css: 'radial-gradient(60% 55% at 30% 30%, #a855f7aa, transparent 62%), radial-gradient(55% 55% at 75% 72%, #38bdf8aa, transparent 62%), #120a24', dom: '#A855F7' },
        { id: 'ocean', cat: 'gradients', css: 'linear-gradient(160deg,#0c4a6e,#0e7490 55%,#134e4a)', dom: '#0E7490' },
        { id: 'ambre', cat: 'gradients', css: 'radial-gradient(80% 70% at 80% 10%, #f59e0baa, transparent 60%), linear-gradient(170deg,#1c1108,#3a1f0a)', dom: '#F59E0B' },
        { id: 'menthe', cat: 'gradients', css: 'linear-gradient(135deg,#d1fae5,#a7f3d0 50%,#bae6fd)', dom: '#34D399' },
        { id: 'peche', cat: 'gradients', css: 'linear-gradient(135deg,#ffe4e6,#fed7aa)', dom: '#FB7185' },
        { id: 'brumeg', cat: 'gradients', css: 'linear-gradient(180deg,#f8fafc,#dbe4f0)', dom: '#94A3B8' },
        { id: 'carreaux', cat: 'patterns', css: 'linear-gradient(#bfd0ee 1px,transparent 1px) 0 0/18px 18px, linear-gradient(90deg,#bfd0ee 1px,transparent 1px) 0 0/18px 18px, #ffffff', dom: '#4176E6' },
        { id: 'carreaux-lg', cat: 'patterns', css: 'linear-gradient(#c8d6e5 1px,transparent 1px) 0 0/32px 32px, linear-gradient(90deg,#c8d6e5 1px,transparent 1px) 0 0/32px 32px, #f0f4f8', dom: '#4176E6' },
        { id: 'carreaux-sombre', cat: 'patterns', css: 'linear-gradient(#ffffff12 1px,transparent 1px) 0 0/24px 24px, linear-gradient(90deg,#ffffff12 1px,transparent 1px) 0 0/24px 24px, #0f1115', dom: '#679EFE' },
        { id: 'seyes', cat: 'patterns', css: 'linear-gradient(90deg,transparent 47px,#f0a3a3 47px,#f0a3a3 49px,transparent 49px), linear-gradient(90deg,#dbe4f7 1px,transparent 1px) 0 0/32px 32px, linear-gradient(#c5d2ee 1px,transparent 1px) 0 0/32px 8px, #ffffff', dom: '#4176E6' },
        { id: 'points', cat: 'patterns', css: 'radial-gradient(#94a3b8 1px,transparent 1.6px) 0 0/16px 16px, #f8fafc', dom: '#61666B' },
        { id: 'milli', cat: 'patterns', css: 'linear-gradient(#cbd5e1 1px,transparent 1px) 0 0/40px 40px, linear-gradient(90deg,#cbd5e1 1px,transparent 1px) 0 0/40px 40px, linear-gradient(#e2e8f0 1px,transparent 1px) 0 0/8px 8px, linear-gradient(90deg,#e2e8f0 1px,transparent 1px) 0 0/8px 8px, #f8fafc', dom: '#61666B' },
        { id: 'lignes', cat: 'patterns', css: 'repeating-linear-gradient(0deg,#f1f3f5 0 23px,#dfe3e8 23px 24px)', dom: '#81858C' },
        { id: 'plan', cat: 'patterns', css: 'linear-gradient(#ffffff1a 1px,transparent 1px) 0 0/20px 20px, linear-gradient(90deg,#ffffff1a 1px,transparent 1px) 0 0/20px 20px, #0e3074', dom: '#4176E6' },
        { id: 'diag', cat: 'patterns', css: 'repeating-linear-gradient(45deg,#1b1b1c 0 10px,#232324 10px 20px)', dom: '#81858C' },
        { id: 'kraft', cat: 'patterns', css: 'radial-gradient(#00000014 1px,transparent 1.4px) 0 0/6px 6px, #d8c4a0', dom: '#B45309' },
        { id: 'iaurore', cat: 'images', css: 'radial-gradient(60% 28% at 38% 42%, #34d39988, transparent 70%), radial-gradient(50% 24% at 66% 36%, #a78bfa77, transparent 70%), radial-gradient(130% 42% at 50% 118%, #02060c 62%, transparent 63%), linear-gradient(180deg,#050a18,#0b2a3a 65%)', dom: '#34D399' },
        { id: 'icoucher', cat: 'images', css: 'radial-gradient(28% 34% at 50% 66%, #fde68a, #fb923c 45%, transparent 72%), radial-gradient(130% 40% at 50% 120%, #1c0f2a 60%, transparent 61%), linear-gradient(180deg,#312e81,#be185d 58%,#fb923c)', dom: '#FB923C' },
        { id: 'idunes', cat: 'images', css: 'radial-gradient(90% 42% at 18% 112%, #c2410c 58%, transparent 59%), radial-gradient(90% 46% at 88% 116%, #ea580c 58%, transparent 59%), linear-gradient(180deg,#fde68a,#fdba74)', dom: '#EA580C' },
        { id: 'iforet', cat: 'images', css: 'radial-gradient(120% 50% at 30% 112%, #0b2e22 58%, transparent 59%), radial-gradient(110% 46% at 85% 110%, #134e3a 58%, transparent 59%), linear-gradient(180deg,#cfe8dc,#8fbfa8 60%,#3b7a62)', dom: '#22A06B' },
        { id: 'iespace', cat: 'images', css: 'radial-gradient(1.2px 1.2px at 12% 22%, #fff, transparent), radial-gradient(1px 1px at 38% 64%, #fff, transparent), radial-gradient(1.4px 1.4px at 70% 30%, #fff, transparent), radial-gradient(1px 1px at 84% 74%, #fff, transparent), radial-gradient(50% 45% at 30% 40%, #7c3aed66, transparent 65%), radial-gradient(50% 45% at 78% 70%, #0ea5e955, transparent 65%), #06040f', dom: '#7C3AED' },
        { id: 'iencre', cat: 'images', css: 'radial-gradient(50% 60% at 30% 40%, #ffffff22, transparent 65%), radial-gradient(45% 55% at 72% 62%, #ffffff14, transparent 65%), #0f1115', dom: '#81858C' }
      ]
      const WPS_NAMES = {
        none: ['Aucun', 'None'],
        noir: ['Noir OLED', 'OLED black'],
        encre: ['Encre', 'Ink'],
        ardoise: ['Ardoise', 'Slate'],
        nuit: ['Bleu nuit', 'Night blue'],
        foret: ['Forêt', 'Forest'],
        prune: ['Prune', 'Plum'],
        sable: ['Sable', 'Sand'],
        brume: ['Brume', 'Mist'],
        aurore: ['Fond Aurore', 'Aurora background'],
        crepuscule: ['Crépuscule', 'Twilight'],
        nebuleuse: ['Fond Nébuleuse', 'Nebula background'],
        ocean: ['Océan', 'Ocean'],
        ambre: ['Fond Ambre', 'Amber background'],
        menthe: ['Menthe', 'Mint'],
        peche: ['Pêche', 'Peach'],
        brumeg: ['Brume claire', 'Light mist'],
        carreaux: ['Petits carreaux', 'Small squares'],
        'carreaux-lg': ['Grands carreaux', 'Large squares'],
        'carreaux-sombre': ['Carreaux nuit', 'Night squares'],
        seyes: ['Seyès', 'French ruled paper'],
        points: ['Points', 'Dots'],
        milli: ['Millimétré', 'Graph paper'],
        lignes: ['Lignes', 'Lines'],
        plan: ['Plan bleu', 'Blueprint'],
        diag: ['Diagonales', 'Diagonals'],
        kraft: ['Kraft', 'Kraft'],
        iaurore: ['Aurore boréale', 'Northern lights'],
        icoucher: ['Coucher de soleil', 'Sunset'],
        idunes: ['Dunes', 'Dunes'],
        iforet: ['Forêt brumeuse', 'Misty forest'],
        iespace: ['Espace', 'Space'],
        iencre: ['Lavis d’encre', 'Ink wash']
      }
      named(WPS, WPS_NAMES)
      const WPCATS = [
        { id: 'colors', },
        { id: 'gradients', },
        { id: 'patterns', },
        { id: 'images', }
      ]

      named(WPCATS, {
        colors: ['Couleurs', 'Colors'],
        gradients: ['Dégradés', 'Gradients'],
        patterns: ['Motifs', 'Patterns'],
        images: ['Images', 'Images']
      })

      // The 17 tokens this page can drive, mapped onto the real
      // DSH variables (the mockup's TOKG contract).
      const TOKMAP = [
        ['base', null, 'alias-bg-base'],
        ['l1', null, 'alias-bg-layer-1'],
        ['l2', null, 'alias-bg-layer-2'],
        ['l3', null, 'alias-bg-layer-3'],
        ['side', null, 'specific-sidebar-fill'],
        ['input', null, 'specific-input-major'],
        ['code', null, 'alias-markdown-code-block'],
        ['t1', null, 'alias-label-primary'],
        ['t2', null, 'alias-label-secondary'],
        ['t3', null, 'alias-label-tertiary'],
        ['t4', null, 'alias-label-caption'],
        ['link', null, 'alias-link'],
        ['err', null, 'alias-state-error-primary'],
        ['ok', null, 'alias-state-success-primary'],
        ['warn', null, 'alias-state-warn-primary'],
        ['biz', null, 'alias-state-business-primary'],
        ['brand', null, 'alias-brand-primary']
      ]
      const TOK_NAMES = {
        base: ['Fond de base', 'Base background'],
        l1: ['Couche 1', 'Layer 1'],
        l2: ['Couche 2', 'Layer 2'],
        l3: ['Couche 3', 'Layer 3'],
        side: ['Barre latérale', 'Sidebar'],
        input: ['Champ de saisie', 'Input field'],
        code: ['Bloc de code', 'Code block'],
        t1: ['Texte principal', 'Primary text'],
        t2: ['Texte secondaire', 'Secondary text'],
        t3: ['Texte tertiaire', 'Tertiary text'],
        t4: ['Légende', 'Caption'],
        link: ['Lien', 'Link'],
        err: ['Erreur', 'Error'],
        ok: ['Succès', 'Success'],
        warn: ['Alerte', 'Warning'],
        biz: ['Information', 'Information'],
        brand: ['Accent (marque)', 'Accent (brand)']
      }
      // the label (index 1 of a row) is read when drawn, in the language of the page
      TOKMAP.forEach((e) => { const p = TOK_NAMES[e[0]]; Object.defineProperty(e, 1, { enumerable: true, configurable: true, get: () => kt(p[0], p[1]) }) })
      const TOKINDEX = {}
      TOKMAP.forEach((e) => { TOKINDEX[e[0]] = e })

      const ACCS = ['#4176E6', '#679EFE', '#2DD4BF', '#22A06B', '#34D399', '#F59E0B', '#FB923C', '#EC4899', '#A855F7', '#7C3AED', '#0EA5E9', '#0F1115']

      // Fonts: proven system stacks, applied through --dsw-font-family on :root and on body (since
      // 0.2.1-alpha.2, see appliquerPolice). The catalogue is the studio's 9 fonts plus the 21 of the old
      // “Colour Pack” (kybernos-plugin): nothing disappears, the order follows the sans / serif / mono
      // groups of the page that was removed.
      const FONTS = [
        // Sans serif
        { id: 'dsh', stack: null },
        { id: 'system-ui', stack: 'system-ui, -apple-system, sans-serif' },
        { id: 'sf-pro', name: 'SF Pro Text', stack: "'SF Pro Text', -apple-system, BlinkMacSystemFont, system-ui, sans-serif" },
        { id: 'helvetica', name: 'Helvetica Neue', stack: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
        { id: 'avenir', name: 'Avenir Next', stack: "'Avenir Next', Avenir, 'Helvetica Neue', sans-serif" },
        { id: 'inter', name: 'Inter', stack: "'Inter', system-ui, -apple-system, sans-serif" },
        { id: 'optima', name: 'Optima', stack: "Optima, 'Gill Sans', 'Gill Sans MT', sans-serif" },
        { id: 'futura', name: 'Futura', stack: "Futura, 'Trebuchet MS', sans-serif" },
        { id: 'roboto', name: 'Roboto', stack: 'Roboto, system-ui, sans-serif' },
        { id: 'open-sans', name: 'Open Sans', stack: "'Open Sans', system-ui, sans-serif" },
        { id: 'lato', name: 'Lato', stack: 'Lato, system-ui, sans-serif' },
        { id: 'montserrat', name: 'Montserrat', stack: 'Montserrat, system-ui, sans-serif' },
        { id: 'poppins', name: 'Poppins', stack: 'Poppins, system-ui, sans-serif' },
        { id: 'nunito', name: 'Nunito', stack: 'Nunito, system-ui, sans-serif' },
        { id: 'space-grotesk', name: 'Space Grotesk', stack: "'Space Grotesk', system-ui, sans-serif" },
        // Serif
        { id: 'georgia', name: 'Georgia', stack: "Georgia, 'Times New Roman', serif" },
        { id: 'iapono', name: 'Iowan Old Style', stack: "'Iowan Old Style', 'Palatino Linotype', Palatino, serif" },
        { id: 'palatino', name: 'Palatino', stack: "Palatino, 'Palatino Linotype', 'Book Antiqua', serif" },
        { id: 'baskerville', name: 'Baskerville', stack: "Baskerville, 'Times New Roman', serif" },
        { id: 'charter', name: 'Charter', stack: "Charter, 'Bitstream Charter', Georgia, serif" },
        { id: 'merriweather', name: 'Merriweather', stack: 'Merriweather, Georgia, serif' },
        { id: 'playfair', name: 'Playfair Display', stack: "'Playfair Display', Georgia, serif" },
        // Monospace
        { id: 'mono', stack: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
        { id: 'plex-mono', name: 'IBM Plex Mono', stack: "'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace" },
        { id: 'jetbrains-mono', name: 'JetBrains Mono', stack: "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace" },
        { id: 'sf-mono', name: 'SF Mono', stack: "'SF Mono', ui-monospace, Menlo, monospace" },
        { id: 'menlo', name: 'Menlo', stack: 'Menlo, monospace' },
        { id: 'fira-code', name: 'Fira Code', stack: "'Fira Code', ui-monospace, Menlo, monospace" },
        { id: 'source-code', name: 'Source Code Pro', stack: "'Source Code Pro', ui-monospace, Menlo, monospace" },
        { id: 'courier', name: 'Courier New', stack: "'Courier New', Courier, monospace" }
      ]
      named(FONTS, {
        dsh: ['DSH (défaut)', 'DSH (default)'],
        'system-ui': ['Système', 'System'],
        mono: ['Mono système', 'System mono']
      })

      // What a skin applies — ONE single definition, shared by the click on the
      // picker and by the carry-over of the v1 settings below.
      //   • `ov` is ALWAYS set: without that, the tokens of an inherited pack
      //     would survive the return to “DSH default” (which promises to remove the
      //     layer), and so would the Advanced edit of a previous theme.
      //   • `mode` is only set if the skin imposes one: inherited packs
      //     (mode null) follow the System / Light / Dark setting.
      const skinPatch = (sk) => {
        const patch = { skin: sk.id, acc: sk.acc, wp: sk.wp, wpVis: sk.vis, ov: sk.ov || {} }
        if (sk.mode !== null && sk.mode !== undefined) patch.mode = sk.mode
        // A shipped theme may also set the font and the corners; the older ones leave both alone.
        if (sk.fontText !== undefined) patch.fontText = sk.fontText
        if (sk.radius !== undefined) patch.radius = sk.radius
        // …and the menu icon set (the id of one of the sets above)
        if (sk.iconSet !== undefined) patch.iconSet = sk.iconSet
        return patch
      }
      // The accent displayed for a skin: its direct value, otherwise that of its
      // per-scheme palette (inherited packs). Used for the dot and the caption.
      const skinAccent = (sk) => (sk.acc !== null && sk.acc !== undefined)
        ? sk.acc
        : (((sk.ov || {})['light:brand']) || null)

      // ── One-time carry-over of the settings of the former “Colour Pack” (v1) ───────
      // The Kybernos tab that carried this system has been removed: its two keys
      // (`kybernos.pack`, `kybernos.font`) stay as they are in the
      // browser. On the FIRST start without a v2 state, we adopt them instead of
      // starting over from the defaults — otherwise a pack or a font chosen before the
      // migration would be silently lost. No write: the carry-over is
      // recomputed on every read as long as the user has changed nothing,
      // so it stays idempotent and does not freeze their choice.
      const LEGACY_FONT_IDS = { default: 'dsh', iowan: 'iapono' }
      const legacyAdopt = () => {
        const patch = {}
        try {
          const packId = localStorage.getItem('kybernos.pack')
          const sk = packId === null || packId === '' ? null : SKINS.find((s) => s.id === packId)
          if (sk !== null && sk !== undefined) Object.assign(patch, skinPatch(sk))
          const fontId = localStorage.getItem('kybernos.font')
          if (fontId !== null && fontId !== '') {
            const mapped = LEGACY_FONT_IDS[fontId] || fontId
            if (FONTS.some((f) => f.id === mapped)) patch.fontText = mapped
          }
        } catch (e) { /* storage unavailable: we keep the defaults */ }
        return patch
      }

      // <icon-sets:begin>
      // ══ MENU ICON SETS ═══════════════════════════════════════════════════
      // Pure drawing code: no DOM, no state, no I/O. One drawing per (set, menu entry); every drawing is flat fills,
      // no outlines. `t` is the tone kit of the state being drawn: at rest everything is the row's own text colour
      // (`currentColor`, so it follows light and dark themes), when the page is open it takes the entry's hue.
      const ICON_ENTRIES = ['cloud', 'kyber', 'dash', 'teams', 'ws', 'creations', 'auto', 'skills', 'plug']
      const ICON_HUES = { cloud: '#14b8a6', kyber: '#8b5cf6', dash: '#3b82f6', teams: '#6366f1', ws: '#f59e0b', creations: '#ec4899', auto: '#f97316', skills: '#10b981', plug: '#06b6d4' }
      const iconRgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] }
      const iconHex = (c) => '#' + c.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('')
      const iconMix = (hex, t) => iconHex(iconRgb(hex).map((v) => v + (255 - v) * t))
      const iconShade = (hex, t) => iconHex(iconRgb(hex).map((v) => v * (1 - t)))
      const iconN = (v) => Math.round(v * 100) / 100
      const iconTones = (on, hue) => {
        const g = (fill, op) => (x) => '<g fill="' + fill + '"' + (op < 1 ? ' opacity="' + op + '"' : '') + '>' + x + '</g>'
        const INK = 'var(--dsw-alias-label-primary,#1c1f26)'
        return on
          ? { on, hue, m: g(hue, 1), s: g(hue, 0.4), b: g(hue, 0.55), k: g(iconShade(hue, 0.38), 1), ik: g(INK, 1), hi: g(iconMix(hue, 0.45), 1), md: g(hue, 1), lo: g(iconShade(hue, 0.3), 1), p: g('#fff', 1) }
          : { on, hue, m: g('currentColor', 1), s: g('currentColor', 0.4), b: g('currentColor', 0.5), k: g('currentColor', 0.62), ik: g('currentColor', 0.45), hi: g('currentColor', 0.38), md: g('currentColor', 0.68), lo: g('currentColor', 1), p: g('#fff', 1) }
      }
      const iRect = (x, y, w, h, r) => '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + (r === undefined ? 0.9 : r) + '"/>'
      const iDot = (cx, cy, r) => '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '"/>'
      const iPath = (d, extra) => '<path d="' + d + '"' + (extra || '') + '/>'
      const iPoly = (pts) => '<polygon points="' + pts.map((p) => iconN(p[0]) + ',' + iconN(p[1])).join(' ') + '"/>'
      const iRing = (cx, cy, R, w) => {
        const r = R - w
        return iPath('M' + (cx - R) + ' ' + cy + 'a' + R + ' ' + R + ' 0 1 0 ' + (2 * R) + ' 0a' + R + ' ' + R + ' 0 1 0 ' + (-2 * R) + ' 0zM' + (cx - r) + ' ' + cy + 'a' + r + ' ' + r + ' 0 1 0 ' + (2 * r) + ' 0a' + r + ' ' + r + ' 0 1 0 ' + (-2 * r) + ' 0z', ' fill-rule="evenodd"')
      }
      const iArc = (cx, cy, R, w, a0, a1) => {
        const r = R - w
        const P = (q, a) => iconN(cx + q * Math.sin((a * Math.PI) / 180)) + ' ' + iconN(cy - q * Math.cos((a * Math.PI) / 180))
        const big = a1 - a0 > 180 ? 1 : 0
        return iPath('M' + P(R, a0) + 'A' + R + ' ' + R + ' 0 ' + big + ' 1 ' + P(R, a1) + 'L' + P(r, a1) + 'A' + r + ' ' + r + ' 0 ' + big + ' 0 ' + P(r, a0) + 'z')
      }
      // An isometric cuboid: back corner (cx, ty), two top edges (ux right-down, uy left-down), height h.
      const iCub = (t, cx, ty, ux, uy, h) => {
        const P0 = [cx, ty], P1 = [cx + ux, ty + ux / 2], P2 = [cx + ux - uy, ty + ux / 2 + uy / 2], P3 = [cx - uy, ty + uy / 2]
        const dn = (p) => [p[0], p[1] + h]
        return t.hi(iPoly([P0, P1, P2, P3])) + t.md(iPoly([P3, P2, dn(P2), dn(P3)])) + t.lo(iPoly([P2, P1, dn(P1), dn(P2)]))
      }
      const iFade = (x) => '<g opacity=".55">' + x + '</g>'

      // ── The five sober sets: solid silhouettes, a mass (p) and a detail (s) ──
      const ICON_FILL = {
        cloud: { p: iRect(2.5, 4, 19, 13, 3.2), s: iRect(7.5, 19, 9, 2.4, 1.2) },
        kyber: { p: iDot(6, 6.5, 3.4) + iDot(18, 7, 3.4) + iDot(12, 18, 3.4), s: iPath('M6 6.5 18 7 12 18z') },
        dash: { p: iRect(3, 3, 8, 10, 2.2) + iRect(13, 11, 8, 10, 2.2), s: iRect(13, 3, 8, 6, 2.2) + iRect(3, 15, 8, 6, 2.2) },
        teams: { p: iDot(9, 8, 3.6) + iPath('M2 20a7 7 0 0 1 14 0z'), s: iDot(17.5, 9, 2.8) + iPath('M15 20a5.5 5.5 0 0 1 8.5-4.6V20z') },
        ws: { p: iPath('M2.5 10.5h19V17a2.5 2.5 0 0 1-2.5 2.5H5A2.5 2.5 0 0 1 2.5 17z'), s: iPath('M2.5 7A2.5 2.5 0 0 1 5 4.5h3.8a2 2 0 0 1 1.6.8L11.7 7H19a2.5 2.5 0 0 1 2.5 2.5v1h-19z') },
        creations: { p: iDot(17, 17, 4.5) + iRect(3, 13.5, 7.5, 7.5, 2), s: iPath('M7.2 3.4a1.2 1.2 0 0 1 2 0l3.9 6.6a1.2 1.2 0 0 1-1 1.8H4.3a1.2 1.2 0 0 1-1-1.8z') + iRect(13.5, 3, 7.5, 7.5, 2.2) },
        auto: { p: iRect(2.8, 4.5, 4.6, 15, 1.5), s: '<g transform="rotate(16 11.7 13.5)">' + iRect(9.4, 6, 4.6, 15, 1.5) + '</g><g transform="rotate(34 17.9 16)">' + iRect(15.6, 9, 4.6, 14, 1.5) + '</g>' },
        skills: { p: iRect(3, 10, 18, 10.5, 2.6), s: iRect(5.2, 5.6, 4, 4.4, 1.4) + iRect(10, 5.6, 4, 4.4, 1.4) + iRect(14.8, 5.6, 4, 4.4, 1.4) },
        plug: { p: iPath('M4.5 9h15v2.5a7.5 7.5 0 0 1-15 0z'), s: iRect(7, 2, 3.4, 7, 1.7) + iRect(13.6, 2, 3.4, 7, 1.7) + iRect(10.8, 18.5, 2.4, 3.5, 1.2) }
      }
      const ICON_BAUHAUS = {
        cloud: (t) => t.m(iRect(3, 4, 18, 12, 0)) + t.ik(iDot(17.5, 16.5, 4.5)) + t.ik(iRect(6, 19, 7, 2, 0)),
        kyber: (t) => t.m(iDot(6.5, 7, 3.5)) + t.ik(iRect(13, 3.5, 7, 7, 0)) + t.m(iPath('M12 13l5.5 8h-11z')),
        dash: (t) => t.m(iRect(3, 3, 8, 10, 0)) + t.ik(iRect(13, 3, 8, 6, 0)) + t.m(iRect(13, 11, 8, 10, 0)) + t.ik(iRect(3, 15, 8, 6, 0)),
        teams: (t) => t.ik(iDot(6, 8, 2.6)) + t.m(iDot(12, 6.5, 3.2)) + t.ik(iDot(18, 8, 2.6)) + t.ik(iPath('M1.5 20a4.5 4.5 0 0 1 9 0z')) + t.m(iPath('M7.5 20a4.5 4.5 0 0 1 9 0z')) + t.ik(iPath('M13.5 20a4.5 4.5 0 0 1 9 0z')),
        ws: (t) => t.m(iRect(2.5, 9, 19, 11, 0)) + t.ik(iPath('M2.5 9V5.5h8L12.5 9z')),
        creations: (t) => t.m(iPath('M7 3l5 8.5H2z')) + t.ik(iRect(13, 3, 8, 8, 0)) + t.m(iDot(17, 17, 4.5)) + t.ik(iRect(3, 14, 7, 7, 0)),
        auto: (t) => t.m(iRect(3, 4.5, 4.6, 15, 0)) + t.ik('<g transform="rotate(16 11.7 13.5)">' + iRect(9.4, 6, 4.6, 15, 0) + '</g>') + t.m('<g transform="rotate(34 17.9 16)">' + iRect(15.6, 9, 4.6, 14, 0) + '</g>'),
        skills: (t) => t.m(iRect(3, 10.5, 18, 10, 0)) + t.ik(iDot(7.5, 7.4, 2.4)) + t.m(iDot(12, 7.4, 2.4)) + t.ik(iDot(16.5, 7.4, 2.4)),
        plug: (t) => t.ik(iRect(7.5, 2, 3, 6, 0)) + t.ik(iRect(13.5, 2, 3, 6, 0)) + t.m(iPath('M5 8h14v3a7 7 0 0 1-14 0z')) + t.ik(iRect(11, 18, 2, 4, 0))
      }
      const iSober = (kind) => (e, t) => {
        const F = ICON_FILL[e]
        if (kind === 'aplat') return t.m(F.p + F.s)
        if (kind === 'duotone') return t.m(F.p) + (t.on ? '<g fill="' + t.hue + '" opacity=".38">' : '<g fill="currentColor" opacity=".45">') + F.s + '</g>'
        if (kind === 'doux') {
          const gid = 'kbg-' + e + (t.on ? t.hue.slice(1) : 'g')
          const stops = t.on
            ? '<stop offset="0" stop-color="' + iconMix(t.hue, 0.4) + '"/><stop offset="1" stop-color="' + t.hue + '"/>'
            : '<stop offset="0" stop-color="currentColor" stop-opacity=".55"/><stop offset="1" stop-color="currentColor"/>'
          return '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="1" y2="1">' + stops + '</linearGradient></defs><g fill="url(#' + gid + ')">' + F.p + '</g><g fill="url(#' + gid + ')" opacity=".6">' + F.s + '</g>'
        }
        // pastille: a filled rounded square with the silhouette cut out of it
        const tile = t.on ? '<rect x="1" y="1" width="22" height="22" rx="7" fill="' + t.hue + '"/>' : '<rect x="1" y="1" width="22" height="22" rx="7" fill="currentColor" opacity=".45"/>'
        return tile + '<g transform="translate(6.6 6.6) scale(.45)" fill="#fff">' + F.p + '</g><g transform="translate(6.6 6.6) scale(.45)" fill="#fff" opacity=".7">' + F.s + '</g>'
      }

      // ── The nine pictograms the other languages redraw: each has a visible link with its menu entry ──
      // cloud = a cloud, kyber = a robot head, dash = a bar chart, teams = three people, ws = a folder,
      // creations = a picture, auto = a cog, skills = an open book, plug = a plug.
      // m = the mass, s = the lighter detail, p = paper cut-outs (eyes, holes), q = what is drawn over the paper
      const iTooth = (a, cx, cy, r0, r1, hw) => {
        const rad = (a * Math.PI) / 180, c = Math.cos(rad), s = Math.sin(rad)
        return iPoly([[-hw, -r1], [hw, -r1], [hw, -r0], [-hw, -r0]].map((p) => [iconN(cx + p[0] * c - p[1] * s), iconN(cy + p[0] * s + p[1] * c)]))
      }
      const ICON_PICTO = {
        cloud: { m: iDot(7.5, 14, 4.8) + iDot(13.5, 10, 6.3) + iDot(18.5, 14.5, 4.3) + iRect(3, 14, 18.5, 6, 3), s: '', p: iRect(8, 15.5, 8, 1.4, 0.7), q: '' },
        kyber: { m: iRect(4.5, 7.5, 15, 12.5, 4), s: iRect(11, 3.2, 2, 4.5, 1) + iDot(12, 2.8, 1.8) + iRect(1.5, 11.5, 2.2, 5, 1.1) + iRect(20.3, 11.5, 2.2, 5, 1.1), p: iDot(9, 13, 1.9) + iDot(15, 13, 1.9) + iRect(9.3, 16.6, 5.4, 1.5, 0.75), q: '' },
        dash: { m: iRect(3, 12, 4.6, 8.5, 1.2) + iRect(16.4, 2.5, 4.6, 18, 1.2), s: iRect(9.7, 7, 4.6, 13.5, 1.2) + iRect(1.5, 21.6, 21, 1.6, 0.8), p: '', q: '' },
        teams: { m: iDot(12, 7, 3.4) + iPath('M5.5 20.5a6.5 6.5 0 0 1 13 0z'), s: iDot(4.8, 9.5, 2.6) + iPath('M1 20.5a3.8 3.8 0 0 1 7.6 0z') + iDot(19.2, 9.5, 2.6) + iPath('M15.4 20.5a3.8 3.8 0 0 1 7.6 0z'), p: '', q: '' },
        ws: { m: iRect(2, 8.5, 20, 12.5, 2.5), s: iPath('M2 8.5V6.5A2.5 2.5 0 0 1 4.5 4h5l2.5 3h7.5A2.5 2.5 0 0 1 22 9.5v-1z'), p: '', q: '' },
        creations: { m: iRect(2.5, 3.5, 19, 17, 2.5), s: '', p: iRect(5, 6, 14, 12, 1), q: iPoly([[6.5, 17], [11, 10.5], [14, 14.5], [16, 12], [18, 17]]) + iDot(16.5, 8.5, 1.6) },
        auto: { m: iDot(12, 12, 7.6) + [0, 45, 90, 135, 180, 225, 270, 315].map((a) => iTooth(a, 12, 12, 6.5, 11, 2)).join(''), s: '', p: iDot(12, 12, 3.2), q: '' },
        skills: { m: iPath('M2 5.5c4-1.8 7.5-1.6 10 1v14.5c-2.5-2.5-6-2.8-10-1z') + iPath('M22 5.5c-4-1.8-7.5-1.6-10 1v14.5c2.5-2.5 6-2.8 10-1z'), s: '', p: iRect(11.4, 6, 1.2, 15, 0.6), q: '' },
        plug: { m: iRect(5, 9, 14, 8.5, 3.2) + iRect(10.6, 17, 2.8, 5.5, 1.4), s: iRect(8, 3, 2.6, 6.5, 1.1) + iRect(13.4, 3, 2.6, 6.5, 1.1), p: '', q: '' }
      }
      const iSilhouette = (P) => P.m + P.s + P.q
      // A clip path whose id is stable for (set, entry, state): the same id always names the same shape.
      const iClipId = (kind, e, t) => 'kb' + kind + '-' + e + (t.on ? t.hue.slice(1) : 'g')
      // Cut-outs are real holes (a mask), not paper-coloured fills: they show the row's own background, light or dark, hover or not.
      const iMasked = (kind, e, t, holes, body) => {
        if (holes === '') return body
        const id = iClipId(kind, e, t)
        return '<defs><mask id="' + id + '" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect x="0" y="0" width="24" height="24" fill="#fff"/><g fill="#000">' + holes + '</g></mask></defs><g mask="url(#' + id + ')">' + body + '</g>'
      }

      // ── 1 · Matrice: dots of a 9×9 panel (# main, + light) ──
      const ICON_BITMAPS = {
        cloud: ['.........', '....##...', '..######.', '.########', '#########', '#########', '.#######.', '..+++++..', '.........'],
        kyber: ['....+....', '....+....', '.#######.', '##.###.##', '##.###.##', '.#######.', '.##...##.', '.#######.', '.........'],
        dash: ['.........', '.......##', '.......##', '....##.##', '....##.##', '.##.##.##', '.##.##.##', '.##.##.##', '+++++++++'],
        teams: ['.........', '.##...##.', '.##...##.', '.........', '####.####', '####.####', '####.####', '####.####', '.........'],
        ws: ['.........', '.####....', '#########', '#+++++++#', '#########', '#########', '#########', '#########', '.........'],
        creations: ['#########', '#.......#', '#....+..#', '#.......#', '#...#...#', '#..###..#', '#.#####.#', '#########', '.........'],
        auto: ['....#....', '.#.###.#.', '.#######.', '..##.##..', '####.####', '..##.##..', '.#######.', '.#.###.#.', '....#....'],
        skills: ['.........', '.###.###.', '####.####', '####.####', '####.####', '####.####', '.###.###.', '.........', '.........'],
        plug: ['.........', '..#...#..', '..#...#..', '.#######.', '.#######.', '.#######.', '..#####..', '....#....', '....#....']
      }
      const iMatrix = (e, t) => {
        let m = '', s = ''
        ICON_BITMAPS[e].forEach((row, y) => { row.split('').forEach((c, x) => { if (c === '#') m += iDot(iconN(2 + 2.5 * x), iconN(2 + 2.5 * y), 1.05); else if (c === '+') s += iDot(iconN(2 + 2.5 * x), iconN(2 + 2.5 * y), 1.05) }) })
        return t.m(m) + t.s(s)
      }

      // ── 2 · Mondrian: the same nine, built from blocks and gutters only ──
      const ICON_MONDRIAN = {
        cloud: (t) => t.m(iRect(3, 13, 18, 7.5, 3.5) + iRect(10.5, 5, 8.5, 9, 4)) + t.s(iRect(4.5, 8.5, 7, 6, 3)),
        kyber: (t) => t.m(iRect(4, 8, 16, 12, 1.5)) + t.s(iRect(10.5, 2.5, 3, 4.5, 0.8) + iRect(1, 11, 2, 5, 0.6) + iRect(21, 11, 2, 5, 0.6)) + t.p(iRect(7.5, 11.5, 3, 3, 0.5) + iRect(13.5, 11.5, 3, 3, 0.5) + iRect(8.5, 16.2, 7, 1.6, 0.5)),
        dash: (t) => t.m(iRect(3, 12, 4.6, 8.5, 0.8) + iRect(16.4, 2.5, 4.6, 18, 0.8)) + t.s(iRect(9.7, 7, 4.6, 13.5, 0.8) + iRect(1.5, 21.6, 21, 1.6, 0.5)),
        teams: (t) => t.m(iRect(10, 3.5, 4.2, 4.2, 0.6) + iRect(7, 9.5, 10.2, 11.5, 0.8)) + t.s(iRect(2, 8, 3.4, 3.4, 0.6) + iRect(1, 12.8, 5.2, 8.2, 0.8) + iRect(18.6, 8, 3.4, 3.4, 0.6) + iRect(17.8, 12.8, 5.2, 8.2, 0.8)),
        ws: (t) => t.s(iRect(2, 4, 8.5, 4, 0.8)) + t.m(iRect(2, 9.5, 20, 11.5, 0.8)),
        creations: (t) => iMasked('mm', 'creations', t, iRect(5, 6, 14, 12, 0.5), t.m(iRect(2.5, 3.5, 19, 17, 0.8))) + t.s(iRect(7, 13.5, 4, 4, 0.5) + iRect(12.5, 10.5, 4.5, 7, 0.5) + iRect(14.5, 7, 2.6, 2.6, 0.5)),
        auto: (t) => t.m(iRect(7, 7, 10, 10, 0.8) + iRect(10.5, 1.5, 3, 4.5, 0.6) + iRect(10.5, 18, 3, 4.5, 0.6) + iRect(1.5, 10.5, 4.5, 3, 0.6) + iRect(18, 10.5, 4.5, 3, 0.6)) + t.s(iRect(3.5, 3.5, 3, 3, 0.5) + iRect(17.5, 3.5, 3, 3, 0.5) + iRect(3.5, 17.5, 3, 3, 0.5) + iRect(17.5, 17.5, 3, 3, 0.5)) + t.p(iRect(10.5, 10.5, 3, 3, 0.4)),
        skills: (t) => t.m(iRect(2, 5, 9.5, 15.5, 0.8)) + t.s(iRect(12.5, 5, 9.5, 15.5, 0.8)) + t.p(iRect(4, 8.5, 5.5, 1.3, 0.4) + iRect(4, 12, 5.5, 1.3, 0.4) + iRect(14.5, 8.5, 5.5, 1.3, 0.4) + iRect(14.5, 12, 5.5, 1.3, 0.4)),
        plug: (t) => t.m(iRect(5, 9, 14, 8, 0.8) + iRect(10.7, 17.5, 2.6, 5, 0.6)) + t.s(iRect(8, 3, 2.6, 5.5, 0.6) + iRect(13.4, 3, 2.6, 5.5, 0.6))
      }

      // ── 3 · Anneaux: rings, bands and dots ──
      const iBand = (outer, inner) => iPath(outer + inner, ' fill-rule="evenodd"')
      const ICON_RINGS = {
        cloud: (t) => t.s(iRing(7.5, 14.5, 5, 2)) + t.m(iRing(13.5, 10.5, 6.5, 2.4)) + t.s(iRing(18.5, 15, 4.5, 2)),
        kyber: (t) => t.m(iRing(12, 13.5, 8.8, 2.6)) + t.k(iDot(8.7, 13, 1.7) + iDot(15.3, 13, 1.7)) + t.s(iRect(11.2, 3, 1.6, 3.5, 0.8) + iDot(12, 2.6, 1.7)),
        dash: (t) => t.m(iArc(12, 17.5, 10.5, 3, 270, 450)) + t.s(iArc(12, 17.5, 6, 2.4, 270, 450)) + t.k(iPoly([[11.2, 17.5], [17.5, 9], [18.8, 10.2], [12.8, 18.8]])) + t.m(iDot(12, 18, 1.8)),
        teams: (t) => t.s(iRing(5, 9, 3, 1.4) + iRing(19, 9, 3, 1.4) + iArc(5, 21, 4.6, 1.8, 270, 450) + iArc(19, 21, 4.6, 1.8, 270, 450)) + t.m(iRing(12, 7, 3.8, 1.8) + iArc(12, 21, 6.4, 2.4, 270, 450)),
        ws: (t) => t.m(iBand('M2 21V8.5a2.5 2.5 0 0 1 2.5-2.5h5l2.5 3h7.5a2.5 2.5 0 0 1 2.5 2.5V21z', 'M4.6 18.6V11.4H19.4v7.2z')),
        creations: (t) => t.m(iBand('M4 3.5h16a2.5 2.5 0 0 1 2.5 2.5v12a2.5 2.5 0 0 1-2.5 2.5H4A2.5 2.5 0 0 1 1.5 18V6A2.5 2.5 0 0 1 4 3.5z', 'M4.2 6.1h15.6v11.8H4.2z')) + t.s(iPoly([[5.5, 16.5], [10, 10.5], [13, 14], [15.5, 11.5], [18.5, 16.5]])) + t.m(iRing(16.5, 8.5, 2, 1)),
        auto: (t) => t.m(iRing(12, 12, 7.2, 2.6) + [0, 45, 90, 135, 180, 225, 270, 315].map((a) => iTooth(a, 12, 12, 6.8, 11, 1.9)).join('')) + t.s(iDot(12, 12, 2)),
        skills: (t) => t.s(iPoly([[7, 14], [4.5, 22], [9, 20], [12, 22.5], [8.5, 14.5]]) + iPoly([[17, 14], [19.5, 22], [15, 20], [12, 22.5], [15.5, 14.5]])) + t.m(iRing(12, 9.5, 7, 2.8)) + t.k(iDot(12, 9.5, 2)),
        plug: (t) => t.m(iRing(8, 12, 6, 2.6)) + t.s(iRing(16, 12, 6, 2.6))
      }

      // ── 4 · Isometric: blocks in three tones ──
      const iFaceQuad = (cx, ty, ux, uy, h, pts) => {
        const P3 = [cx - uy, ty + uy / 2], P2 = [cx + ux - uy, ty + ux / 2 + uy / 2]
        return pts.map((q) => [iconN(P3[0] + q[0] * (P2[0] - P3[0])), iconN(P3[1] + q[0] * (P2[1] - P3[1]) + q[1] * h)])
      }
      const ICON_ISO = {
        cloud: (t) => iCub(t, 12, 12, 8, 8, 3.2) + iCub(t, 12, 7, 8, 8, 3.2) + iCub(t, 12, 2, 8, 8, 3.2) + t.p(iDot(7.5, 17, 0.8) + iDot(7.5, 12, 0.8) + iDot(7.5, 7, 0.8)),
        kyber: (t) => iCub(t, 12, 6, 8, 8, 9) + t.p(iDot(6.5, 14.25, 1.3) + iDot(9.5, 15.75, 1.3)) + t.lo(iRect(11.4, 4.5, 1.2, 5.5, 0.6)) + t.hi(iDot(12, 4, 1.7)),
        dash: (t) => iCub(t, 5.8, 13.8, 3.2, 3.2, 5) + iCub(t, 12.2, 9.8, 3.2, 3.2, 9) + iCub(t, 18.6, 5.8, 3.2, 3.2, 13),
        teams: (t) => [[5, 10], [12, 7.5], [19, 10]].map((q) => t.lo('<ellipse cx="' + q[0] + '" cy="21.5" rx="4.2" ry="1.6"/>') + t.md(iPoly([[q[0] - 3.6, 21.5], [q[0] - 2, q[1] + 3.5], [q[0] + 2, q[1] + 3.5], [q[0] + 3.6, 21.5]])) + t.hi(iDot(q[0], q[1], 3))).join(''),
        ws: (t) => iCub(t, 12, 3, 9, 9, 9) + t.lo(iPoly([[12, 4.8], [17.4, 7.5], [12, 10.2], [6.6, 7.5]])),
        creations: (t) => { const f = (pts) => iFaceQuad(5, 3, 14, 3.6, 12, pts); return iMasked('mi', 'creations', t, iPoly(f([[0.1, 0.12], [0.9, 0.12], [0.9, 0.88], [0.1, 0.88]])), iCub(t, 5, 3, 14, 3.6, 12)) + t.hi(iPoly(f([[0.2, 0.8], [0.42, 0.38], [0.58, 0.62], [0.7, 0.5], [0.82, 0.8]]))) },
        auto: (t) => {
          const star = (dy) => iPoly(Array.from({ length: 24 }, (_, k) => { const R = k % 2 === 0 ? 10.8 : 7.6, a = k * Math.PI / 12; return [iconN(12 + R * Math.sin(a)), iconN(8.5 + dy + 0.6 * R * -Math.cos(a))] }))
          return [5, 4, 3, 2, 1].map((d) => t.md(star(d))).join('') + t.hi(star(0)) + t.lo('<ellipse cx="12" cy="8.5" rx="3" ry="1.8"/>')
        },
        skills: (t) => iCub(t, 12, 7, 9, 7, 4.5) + t.p(iBar([14.5, 17.4], [20.5, 14.4], 0.7) + iBar([14.5, 18.8], [20.5, 15.8], 0.7)),
        plug: (t) => iCub(t, 6, 3, 4, 4, 5) + iCub(t, 11.4, 6.2, 5.6, 1.8, 1.8) + iCub(t, 18, 9, 4, 4, 5)
      }

      // ── 5 · Kawaii: the same nine, with two eyes ──
      const ICON_FACES = {
        cloud: [[9.5, 15.5, 1.5], [15.5, 15.5, 1.5]],
        dash: [[17.5, 7, 0.9], [19.9, 7, 0.9]],
        teams: [[10.8, 6.8, 0.8], [13.2, 6.8, 0.8]],
        ws: [[8, 14.5, 1.6], [16, 14.5, 1.6]],
        skills: [[7, 13, 1.5], [17, 13, 1.5]],
        plug: [[9.5, 13, 1.5], [14.5, 13, 1.5]]
      }
      const iKawaii = (e, t) => {
        const P = ICON_PICTO[e]
        const face = ICON_FACES[e] === undefined ? '' : t.p(ICON_FACES[e].map((q) => iDot(q[0], q[1], q[2])).join('')) + t.k(ICON_FACES[e].map((q) => iDot(q[0] + 0.15, q[1], q[2] * 0.5)).join(''))
        const hollow = e === 'creations' ? t.k(iDot(9.5, 10, 1.1) + iDot(14.5, 10, 1.1)) : (e === 'auto' ? t.k(iDot(10.4, 12, 1.1) + iDot(13.6, 12, 1.1)) : '')
        return iMasked('mk', e, t, P.p, t.m(P.m + P.s)) + t.m(P.q) + face + hollow
      }

      // ── 6 · Persiennes: each pictogram cut into vertical slats ──
      const iBlinds = (e, t) => {
        const P = ICON_PICTO[e], cid = iClipId('b', e, t)
        let slats = ''
        for (let i = 0; i < 7; i += 1) slats += iRect(iconN(1.2 + i * 3.3), 0, 2.2, 24, 0)
        return '<defs><clipPath id="' + cid + '">' + slats + '</clipPath></defs><g clip-path="url(#' + cid + ')">' + iMasked('mb', e, t, P.p, t.m(P.m) + t.k(P.s)) + t.m(P.q) + '</g>'
      }

      // ── 7 · Facettes: low-poly triangles in four tones ──
      const iFan = (t, o, pts, seq) => pts.map((p, i) => t[seq[i % seq.length]](iPoly([o, p, pts[(i + 1) % pts.length]]))).join('')
      const iPolar = (cx, cy, n, r, a0) => Array.from({ length: n }, (_, k) => [iconN(cx + r * Math.sin(a0 + k * 2 * Math.PI / n)), iconN(cy - r * Math.cos(a0 + k * 2 * Math.PI / n))])
      const ICON_FACETS = {
        cloud: (t) => iFan(t, [12.5, 12], [[3, 17.5], [3.5, 12], [8, 9], [10, 5.5], [15, 4.5], [19, 8], [22, 10.5], [21.5, 17.5]], ['hi', 'md', 'lo']),
        kyber: (t) => iFan(t, [12, 13], iPolar(12, 13, 8, 9.5, Math.PI / 8), ['hi', 'md', 'lo', 'md']) + t.p(iDot(8.8, 12, 1.5) + iDot(15.2, 12, 1.5)),
        dash: (t) => [[2, 11], [9, 4], [16, 14]].map((b) => t.hi(iPoly([[b[0], b[1]], [b[0] + 6, b[1]], [b[0], 21]])) + t.md(iPoly([[b[0] + 6, b[1]], [b[0] + 6, 21], [b[0], 21]]))).join(''),
        teams: (t) => [5, 12, 19].map((x, i) => iFan(t, [x, 18], [[x - 4, 21.5], [x - 2.5, 14.5], [x + 2.5, 14.5], [x + 4, 21.5]], ['md', 'lo']) + iFan(t, [x, 9 - (i === 1 ? 1.5 : 0)], iPolar(x, 9 - (i === 1 ? 1.5 : 0), 6, 3.2, 0), ['hi', 'md', 'lo'])).join(''),
        ws: (t) => iFan(t, [12, 15], [[2, 8], [9, 8], [11, 10.5], [22, 10.5], [22, 20], [2, 20]], ['hi', 'md', 'lo']),
        creations: (t) => t.hi(iPoly([[7, 14], [10, 17], [17, 4]])) + t.md(iPoly([[10, 17], [20, 7], [17, 4]])) + t.lo(iPoly([[3, 21], [7, 14], [10, 17]])) + t.s(iPoly([[17, 4], [20, 7], [22, 5], [19, 2]])),
        auto: (t) => iFan(t, [12, 12], Array.from({ length: 16 }, (_, k) => { const R = k % 2 === 0 ? 10.5 : 7.5, a = k * Math.PI / 8; return [iconN(12 + R * Math.sin(a)), iconN(12 - R * Math.cos(a))] }), ['hi', 'md', 'lo', 'md']) + t.p(iDot(12, 12, 2.8)),
        skills: (t) => iFan(t, [6.5, 13], [[2, 6], [11.5, 8], [11.5, 20], [2, 18]], ['hi', 'md']) + iFan(t, [17.5, 13], [[22, 6], [12.5, 8], [12.5, 20], [22, 18]], ['md', 'lo']),
        plug: (t) => iFan(t, [5.5, 12], [[2, 7], [9, 9], [9, 15], [2, 17]], ['hi', 'lo']) + iFan(t, [18.5, 12], [[22, 7], [15, 9], [15, 15], [22, 17]], ['md', 'lo']) + t.s(iPoly([[9, 10], [13, 12], [9, 14]])) + t.s(iPoly([[15, 10], [11, 12], [15, 14]]))
      }

      // ── 8 · Ombre longue: the pictogram and its long diagonal shadow ──
      const iLongShadow = (e, t) => {
        const P = ICON_PICTO[e], sil = iSilhouette(P)
        let copies = ''
        for (let i = 1; i <= 7; i += 1) copies += '<g transform="translate(' + i + ' ' + i + ')">' + sil + '</g>'
        return '<g transform="translate(1 1) scale(.74)">' + t.s(copies) + iMasked('ml', e, t, P.p, t.m(P.m) + t.k(P.s)) + t.m(P.q) + '</g>'
      }

      // ── 9 · Trame: the silhouette filled with comic-book halftone dots ──
      const iHalftone = (e, t) => {
        const P = ICON_PICTO[e], sil = iSilhouette(P), cid = iClipId('h', e, t)
        let dots = ''
        for (let gy = 0; gy < 8; gy += 1) {
          for (let gx = 0; gx < 8; gx += 1) {
            const x = 1.5 + gx * 3, y = 1.5 + gy * 3
            dots += iDot(x, y, iconN(0.45 + 1.25 * ((x + y) / 45)))
          }
        }
        return '<defs><clipPath id="' + cid + '">' + sil + '</clipPath></defs>' + iMasked('mh', e, t, P.p, t.s(sil) + '<g clip-path="url(#' + cid + ')">' + t.m(dots) + '</g>') + t.m(P.q)
      }

      // ── 10 · Bulles: translucent pieces that darken where they overlap ──
      const iBubbles = (e, t) => {
        const P = ICON_PICTO[e]
        return iMasked('mu', e, t, P.p, (iSilhouette(P).match(/<[^>]*\/>/g) || []).map((x) => t.b(x)).join(''))
      }

      // ── 11 · Honeycomb: the same bitmaps, in honeycomb cells ──
      const iHexCell = (cx, cy, r) => iPoly(Array.from({ length: 6 }, (_, k) => [iconN(cx + r * Math.sin(k * Math.PI / 3)), iconN(cy - r * Math.cos(k * Math.PI / 3))]))
      const iHoney = (e, t) => {
        let m = '', s = '', k = ''
        ICON_BITMAPS[e].forEach((row, y) => row.split('').forEach((c, x) => {
          if (c === '.') return
          const cx = iconN(1.4 + x * 2.5 + (y % 2 === 1 ? 1.25 : 0)), cy = iconN(3.4 + y * 2.16), cell = iHexCell(cx, cy, 1.4)
          if (c === '+') s += cell; else if ((x * 3 + y * 5) % 7 === 0) k += cell; else m += cell
        }))
        return t.m(m) + t.s(s) + t.k(k)
      }

      // ── 12 · Constellation: stars and the thin lines that join them ──
      const iBar = (a, b, w) => {
        const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, nx = (-dy / l) * (w / 2), ny = (dx / l) * (w / 2)
        return iPoly([[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]])
      }
      const iLoop = (n, off) => Array.from({ length: n }, (_, i) => [off + i, off + ((i + 1) % n)])
      const ICON_STARS = {
        cloud: { p: [[3, 16], [5, 11], [9, 8.5], [12, 5], [16, 7.5], [19.5, 9.5], [21.5, 13], [21, 16]], l: iLoop(8, 0), big: 3 },
        kyber: { p: [[5, 8], [19, 8], [19, 19], [5, 19], [9.5, 12.5], [14.5, 12.5], [12, 3.5], [9.5, 16], [14.5, 16], [12, 8]], l: [[0, 1], [1, 2], [2, 3], [3, 0], [7, 8], [9, 6]], big: 6 },
        dash: { p: [[3, 19], [8, 13], [13, 15.5], [21, 5], [2, 21.5], [22, 21.5]], l: [[0, 1], [1, 2], [2, 3], [4, 5]], big: 3 },
        teams: { p: [[5, 8], [12, 6], [19, 8], [1.5, 19], [8.5, 19], [15.5, 19], [22.5, 19]], l: [[0, 3], [0, 4], [3, 4], [1, 4], [1, 5], [4, 5], [2, 5], [2, 6], [5, 6]], big: 1 },
        ws: { p: [[3, 7], [10, 7], [12, 9.5], [21, 9.5], [21, 19], [3, 19]], l: iLoop(6, 0), big: 0 },
        creations: { p: [[3, 4], [21, 4], [21, 20], [3, 20], [6, 17], [11, 11], [16, 17], [17, 8]], l: iLoop(4, 0).concat([[4, 5], [5, 6]]), big: 7 },
        auto: { p: iPolar(12, 12, 8, 9, Math.PI / 8).concat([[12, 12]]), l: iLoop(8, 0).concat([[8, 0], [8, 2], [8, 4], [8, 6]]), big: 8 },
        skills: { p: [[2, 6], [12, 8], [22, 6], [22, 19], [12, 21], [2, 19]], l: iLoop(6, 0).concat([[1, 4]]), big: 1 },
        plug: { p: [[6, 10], [18, 10], [18, 17], [6, 17], [9, 4], [15, 4], [12, 22]], l: iLoop(4, 0).concat([[0, 4], [1, 5], [3, 6]]), big: 6 }
      }
      const iStars = (e, t) => {
        const c = ICON_STARS[e]
        const dust = [[1.5, 1.5], [22.5, 1.5], [1.5, 22.5], [22.5, 22.5]].map((q) => iDot(q[0], q[1], 0.6)).join('')
        const links = c.l.map((q) => iBar(c.p[q[0]], c.p[q[1]], 0.9)).join('')
        const dots = c.p.map((q, i) => iDot(q[0], q[1], i === c.big ? 2.2 : 1.3)).join('')
        return t.s(dust + links) + t.m(dots)
      }

      // ── 13 · Biton: the pictogram split by a diagonal into two tones ──
      const iTwoTone = (e, t) => {
        const P = ICON_PICTO[e], sil = iSilhouette(P), a = iClipId('ta', e, t), b = iClipId('tb', e, t)
        return '<defs><clipPath id="' + a + '">' + iPoly([[0, 0], [24, 0], [0, 24]]) + '</clipPath><clipPath id="' + b + '">' + iPoly([[24, 0], [24, 24], [0, 24]]) + '</clipPath></defs>' +
          iMasked('mt', e, t, P.p, '<g clip-path="url(#' + a + ')">' + t.hi(sil) + '</g><g clip-path="url(#' + b + ')">' + t.lo(sil) + '</g>') + t.md(P.q)
      }

      // ── 14 · Tampon: ink with the speckles of a worn rubber stamp ──
      const iStamp = (e, t) => {
        const P = ICON_PICTO[e], sil = iSilhouette(P), cid = iClipId('s', e, t)
        let speck = ''
        for (let i = 0; i < 20; i += 1) speck += iDot(iconN(1.5 + ((i * 7.3) % 21)), iconN(1.5 + ((i * 11.7 + 3) % 21)), iconN(0.4 + ((i * 3) % 5) * 0.13))
        return '<defs><clipPath id="' + cid + '">' + sil + '</clipPath></defs>' + iMasked('ms', e, t, P.p + speck, t.m(P.m) + t.k(P.s)) + t.m(P.q)
      }

      // ── 15 · Nature: a landscape ──
      const ICON_NATURE = {
        cloud: (t) => t.s(iDot(16, 8, 4.5)) + t.m(iDot(8.5, 16, 4) + iDot(13, 13.5, 5) + iDot(17.5, 16.5, 3.5) + iRect(4.5, 16, 16, 4, 2)),
        kyber: (t) => t.s([0, 45, 90, 135, 180, 225, 270, 315].map((a) => iTooth(a, 12, 12, 7.5, 11, 1.4)).join('')) + t.m(iDot(12, 12, 6)) + t.k(iDot(9.8, 11, 0.9) + iDot(14.2, 11, 0.9) + iPath('M9.6 13.6q2.4 3 4.8 0q-2.4 1.4-4.8 0z')),
        dash: (t) => t.s(iPoly([[9, 21], [17, 10], [23, 21]])) + t.m(iPoly([[1, 21], [9, 6], [17, 21]])) + t.p(iPoly([[9, 6], [11.6, 10.5], [9, 9.2], [6.4, 10.5]])),
        teams: (t) => t.k(iRect(5.2, 16, 1.6, 5) + iRect(11.2, 15, 1.6, 6) + iRect(17.2, 16, 1.6, 5)) + t.m(iDot(6, 12, 4) + iDot(12, 9, 5.5) + iDot(18, 12, 4)),
        ws: (t) => t.m(iRect(4, 11, 16, 10, 0)) + t.k(iPoly([[2, 12], [12, 3], [22, 12]])) + t.p(iRect(10, 15, 4, 6, 1)),
        creations: (t) => t.m(iArc(12, 19, 11, 3, 270, 450)) + t.md(iArc(12, 19, 8, 3, 270, 450)) + t.s(iArc(12, 19, 5, 3, 270, 450)),
        auto: (t) => t.k(iPoly([[10.2, 11], [13.8, 11], [15.5, 21.5], [8.5, 21.5]])) + t.s([20, 110, 200, 290].map((a) => iTooth(a, 12, 10, 1.5, 10, 1.3)).join('')) + t.m(iDot(12, 10, 1.9)),
        skills: (t) => t.m(iPath('M3 20C3 9 10 3 21 3c0 11-6 17-17 17z')) + t.p(iPoly([[4, 19.5], [17, 6.5], [17.8, 7.3], [5, 20.3]])),
        plug: (t) => t.s(iRect(1, 18, 22, 4, 2)) + t.m(iRect(1, 11, 22, 3, 1) + iRect(3, 14, 18, 6, 0)) + t.p(iPath('M5 20a3.2 3.2 0 0 1 6.4 0z') + iPath('M12.6 20a3.2 3.2 0 0 1 6.4 0z'))
      }

      const ICON_SETS = [
        { id: 'classic', fr: 'Classique', en: 'Classic', hint: { fr: 'Les pictogrammes à trait de l’application.', en: 'The application’s line icons.' } },
        { id: 'aplat', fr: 'Aplat', en: 'Flat', hint: { fr: 'La silhouette seule, d’une teinte.', en: 'The silhouette alone, one tone.' }, draw: iSober('aplat') },
        { id: 'duotone', fr: 'Duotone', en: 'Duotone', hint: { fr: 'Une masse pleine et un détail plus léger.', en: 'A solid mass and a lighter detail.' }, draw: iSober('duotone') },
        { id: 'bauhaus', fr: 'Bauhaus', en: 'Bauhaus', hint: { fr: 'Cercles, carrés et triangles en deux tons.', en: 'Circles, squares and triangles in two tones.' }, draw: (e, t) => ICON_BAUHAUS[e](t) },
        { id: 'doux', fr: 'Dégradé doux', en: 'Soft gradient', hint: { fr: 'Les mêmes formes, un dégradé à peine perceptible.', en: 'The same shapes, a barely visible gradient.' }, draw: iSober('doux') },
        { id: 'pastille', fr: 'Pastille', en: 'Tile', hint: { fr: 'Un carré arrondi plein, le pictogramme découpé dedans.', en: 'A filled rounded square with the icon cut out.' }, draw: iSober('pastille') },
        { id: 'matrice', fr: 'Matrice', en: 'Matrix', hint: { fr: 'Des points, comme un panneau lumineux.', en: 'Dots, like an LED panel.' }, draw: iMatrix },
        { id: 'mondrian', fr: 'Mondrian', en: 'Mondrian', hint: { fr: 'Des blocs et des gouttières, rien d’autre.', en: 'Blocks and gutters, nothing else.' }, draw: (e, t) => ICON_MONDRIAN[e](t) },
        { id: 'anneaux', fr: 'Anneaux', en: 'Rings', hint: { fr: 'Des anneaux, des arcs et des points.', en: 'Rings, arcs and dots.' }, draw: (e, t) => ICON_RINGS[e](t) },
        { id: 'iso', fr: 'Isométrique', en: 'Isometric', hint: { fr: 'Des volumes en trois tons.', en: 'Volumes in three tones.' }, draw: (e, t) => ICON_ISO[e](t) },
        { id: 'kawaii', fr: 'Kawaii', en: 'Kawaii', hint: { fr: 'Les mêmes objets, avec deux yeux.', en: 'The same objects, with two eyes.' }, draw: iKawaii },
        { id: 'barres', fr: 'Persiennes', en: 'Blinds', hint: { fr: 'Chaque pictogramme découpé en lamelles verticales.', en: 'Each pictogram cut into vertical slats.' }, draw: iBlinds },
        { id: 'facettes', fr: 'Facettes', en: 'Facets', hint: { fr: 'Des triangles de verre, taillés comme une pierre.', en: 'Glass triangles, cut like a gem.' }, draw: (e, t) => ICON_FACETS[e](t) },
        { id: 'ombre', fr: 'Ombre longue', en: 'Long shadow', hint: { fr: 'Une forme plate et son ombre qui s’étire en diagonale.', en: 'A flat shape and its long diagonal shadow.' }, draw: iLongShadow },
        { id: 'trame', fr: 'Trame', en: 'Halftone', hint: { fr: 'La silhouette remplie de points de trame, comme une bande dessinée.', en: 'The silhouette filled with halftone dots, comic-book style.' }, draw: iHalftone },
        { id: 'bulles', fr: 'Bulles', en: 'Bubbles', hint: { fr: 'Des pièces translucides qui foncent où elles se recouvrent.', en: 'Translucent pieces that darken where they overlap.' }, draw: iBubbles },
        { id: 'alveoles', fr: 'Alvéoles', en: 'Honeycomb', hint: { fr: 'Le pictogramme bâti en cellules de ruche.', en: 'The pictogram built from honeycomb cells.' }, draw: iHoney },
        { id: 'constellation', fr: 'Constellation', en: 'Constellation', hint: { fr: 'Des étoiles reliées par de fins traits dessinent le pictogramme.', en: 'Stars joined by thin lines draw the pictogram.' }, draw: iStars },
        { id: 'biton', fr: 'Biton', en: 'Two-tone', hint: { fr: 'Le pictogramme coupé en deux tons par une diagonale.', en: 'The pictogram split in two tones by a diagonal.' }, draw: iTwoTone },
        { id: 'tampon', fr: 'Tampon', en: 'Stamp', hint: { fr: 'De l’encre aux petites éclaboussures d’un tampon usé.', en: 'Ink with the speckles of a worn rubber stamp.' }, draw: iStamp },
        { id: 'nature', fr: 'Nature', en: 'Nature', hint: { fr: 'Un paysage : soleil, montagnes, arbres, moulin.', en: 'A landscape: sun, mountains, trees, windmill.' }, draw: (e, t) => ICON_NATURE[e](t) }
      ]
      const ICON_SET_IDS = ICON_SETS.map((s) => s.id)
      /** The inner SVG markup of one icon (24×24 box), or null for the classic set and for an unknown set or entry. */
      const iconInner = (setId, entry, on) => {
        const set = ICON_SETS.find((s) => s.id === setId)
        if (set === undefined || typeof set.draw !== 'function' || ICON_HUES[entry] === undefined) return null
        try { return set.draw(entry, iconTones(on === true, ICON_HUES[entry])) } catch (e) { return null }
      }
      /** A complete `<svg>` string at `size` px, or null (the caller then keeps its own icon). */
      const iconSvg = (setId, entry, on, size) => {
        const inner = iconInner(setId, entry, on)
        if (inner === null) return null
        const px = typeof size === 'number' && size > 0 ? size : 16
        return '<svg width="' + px + '" height="' + px + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + inner + '</svg>'
      }

      // The registry the menu reads (kybernos-plugin): which set is current, and the drawing of one entry.
      const iconRegistry = () => {
        const w = window
        const prev = (w.__KB_ICONSETS__ !== null && typeof w.__KB_ICONSETS__ === 'object') ? w.__KB_ICONSETS__ : null
        const reg = {
          v: 1,
          entries: ICON_ENTRIES.slice(),
          sets: ICON_SETS.map((s) => ({ id: s.id, fr: s.fr, en: s.en, hint: s.hint })),
          cur: (prev !== null && ICON_SET_IDS.indexOf(prev.cur) >= 0) ? prev.cur : 'classic',
          current: () => reg.cur,
          hue: (entry) => ICON_HUES[entry] || null,
          svg: (entry, on, size, setId) => iconSvg(setId === undefined ? reg.cur : setId, entry, on, size),
          set: (id) => {
            const next = ICON_SET_IDS.indexOf(id) >= 0 ? id : 'classic'
            if (next === reg.cur) return
            reg.cur = next
            try { document.documentElement.setAttribute('data-kb-icons', next) } catch (e) { /* no document */ }
            try { w.dispatchEvent(new CustomEvent('kb-icons-change', { detail: { set: next } })) } catch (e) { /* no events */ }
          }
        }
        w.__KB_ICONSETS__ = reg
        return reg
      }
      /** Puts the chosen menu icon set in force. Never throws: the menu keeps its own icons when this cannot run. */
      const appliquerIcones = (S) => {
        try {
          const reg = (typeof window !== 'undefined' && window.__KB_ICONSETS__ && window.__KB_ICONSETS__.v === 1) ? window.__KB_ICONSETS__ : iconRegistry()
          reg.set(S.iconSet)
        } catch (e) { /* no window: nothing to draw */ }
      }
      // <icon-sets:end>

      // ══════════════════════════════════════════════════════════════════════
      // 3. STATE + PERSISTENCE.
      //    localStorage is enough for the web profile; the host will take over in v2
      //    (DSH Desktop picks random ports — the wallpaper-engine finding).
      // ══════════════════════════════════════════════════════════════════════

      const STORE_KEY = 'kybernos.theme.v1'
      // Every key here is READ by a wire (tokens, background, effects sheet): a command whose key
      // were missing here would show up, not apply, and be lost on reload (41 were).
      // The `test-client.mjs` test now refuses any command without a key.
      const DEF = {
        mode: 'dark', skin: 'dsh', acc: null,
        wp: 'none', wpVis: 60, wpBlur: 0, tint: 0,
        fs: 15, fontText: 'dsh', ov: {}, contrastMode: 'standard', cbSafe: false,
        // Verre et fond
        glassEffect: 'frosted', glassBlur: 18, sidebarLinked: true, sidebarOpacity: 25, fieldOpacity: 20, floatOpacity: 10,
        bgBrightness: 100, bgContrast: 100, bgSaturation: 100, bgDarken: 0, bgFit: 'cover', bgMirror: false,
        // Texte et forme
        ligatures: true, radius: 'standard', showBrand: true,
        // Menu icons: the id of a set drawn by the block above ('classic' keeps the application's line icons)
        iconSet: 'classic',
        // Accessibility
        reduceMotion: false, focusRing: 'accent', largeTargets: false, underlineLinks: false,
        // Chat: the colour of your messages and its text, the frame of the agent's replies and their text
        bubbleUser: 'auto', textUser: null, replyBg: 'none', replyColor: null, textReply: null,
        // The tone of the sidebar, shadows, glow
        sideTone: 'auto', shadow: 'none', glow: false,
        // The pills under the message box: shown unless switched off here
        wgSessions: true, wgChanges: true, wgUsage: true,
        // Bars on hover: the collapsed rail and the chat's top bar leave the layout and come back at the edge (off unless chosen)
        autoHideBars: false
      }
      const ENUMS = { glassEffect: ['frosted', 'liquid'], bgFit: ['cover', 'fill', 'center', 'stretch'], radius: ['sharp', 'standard', 'soft'], focusRing: ['accent', 'double', 'thick'], iconSet: ICON_SET_IDS, sideTone: ['auto', 'darker', 'lighter', 'tinted'], shadow: ['none', 'soft'], replyBg: ['none', 'card', 'outline', 'tint'] }
      /** Your bubble: one of DSH's own / the accent / a soft tone / a dark one, or any colour (a hex). The three text colours are a hex or null (= the colour of the app). */
      const BUBBLE_CHOICES = ['auto', 'accent', 'soft', 'dark']
      const HEX_KEYS = ['textUser', 'replyColor', 'textReply']
      const RANGES = { glassBlur: [0, 40], sidebarOpacity: [0, 100], fieldOpacity: [0, 100], floatOpacity: [0, 100], bgBrightness: [0, 200], bgContrast: [0, 200], bgSaturation: [0, 200], bgDarken: [0, 100] }
      const BOOLS = ['cbSafe', 'sidebarLinked', 'bgMirror', 'ligatures', 'showBrand', 'reduceMotion', 'largeTargets', 'underlineLinks', 'glow', 'wgSessions', 'wgChanges', 'wgUsage', 'autoHideBars']
      /** The choice, range or boolean settings of any object: only the VALID values come out. */
      const valeursValides = (raw) => {
        const out = {}
        Object.keys(ENUMS).forEach((k) => { if (ENUMS[k].indexOf(raw[k]) >= 0) out[k] = raw[k] })
        Object.keys(RANGES).forEach((k) => { if (typeof raw[k] === 'number' && Number.isFinite(raw[k])) out[k] = Math.max(RANGES[k][0], Math.min(RANGES[k][1], Math.round(raw[k]))) })
        BOOLS.forEach((k) => { if (typeof raw[k] === 'boolean') out[k] = raw[k] })
        if (typeof raw.bubbleUser === 'string') { if (BUBBLE_CHOICES.indexOf(raw.bubbleUser) >= 0) out.bubbleUser = raw.bubbleUser; else if (validHex(raw.bubbleUser)) out.bubbleUser = toHex(HEX(raw.bubbleUser)) }
        HEX_KEYS.forEach((k) => { if (raw[k] === null) out[k] = null; else if (typeof raw[k] === 'string' && validHex(raw[k])) out[k] = toHex(HEX(raw[k])) })
        return out
      }
      /** What an imported file is allowed to set: only known keys, of valid type and
       *  range. Returns `null` if the file is not an object. A doubtful value is ignored
       *  (never written): `{"ov":null}` used to crash the whole section. */
      const sanitiserImport = (raw) => {
        if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
        const out = {}
        const num = (k, a, b) => { if (typeof raw[k] === 'number' && Number.isFinite(raw[k])) out[k] = Math.max(a, Math.min(b, Math.round(raw[k]))) }
        if (['system', 'light', 'dark'].indexOf(raw.mode) >= 0) out.mode = raw.mode
        if (typeof raw.skin === 'string' && raw.skin.length < 40) out.skin = raw.skin
        if (raw.acc === null || (typeof raw.acc === 'string' && validHex(raw.acc))) { if (raw.acc !== undefined) out.acc = raw.acc === null ? null : toHex(HEX(raw.acc)) }
        if (typeof raw.wp === 'string' && WPS.some((w) => w.id === raw.wp)) out.wp = raw.wp
        if (typeof raw.fontText === 'string' && FONTS.some((f) => f.id === raw.fontText)) out.fontText = raw.fontText
        if (['standard', 'plus', 'max'].indexOf(raw.contrastMode) >= 0) out.contrastMode = raw.contrastMode
        Object.assign(out, valeursValides(raw))
        num('wpVis', 0, 100); num('wpBlur', 0, 40); num('tint', 0, 100); num('fs', 12, 17)
        if (raw.ov !== null && typeof raw.ov === 'object' && !Array.isArray(raw.ov)) {
          const ov = {}
          Object.keys(raw.ov).forEach((k) => {
            const m = /^(light|dark):([a-z0-9]+)$/.exec(k)
            if (m !== null && TOKINDEX[m[2]] !== undefined && typeof raw.ov[k] === 'string' && validHex(raw.ov[k])) ov[k] = toHex(HEX(raw.ov[k]))
          })
          out.ov = ov
        }
        return out
      }

      // ── Export: the SAME state, in three real formats ─────────────────────────────────────────────
      const yamlScalaire = (v) => (v === null ? 'null' : (typeof v === 'string' ? JSON.stringify(v) : String(v)))
      const exportEtat = (S) => { const o = {}; Object.keys(DEF).forEach((k) => { o[k] = S[k] }); return o }
      /** `format`: 'json' | 'yaml' | 'css'. Returns the text of the file. */
      const exportTexte = (format, S) => {
        if (format === 'json') return JSON.stringify(exportEtat(S), null, 2)
        if (format === 'yaml') {
          const o = exportEtat(S)
          const lines = [kt('# Kybernos · Thème — réimportable en JSON, lisible ici', '# Kybernos · Theme — re-importable as JSON, readable here'), 'theme:']
          Object.keys(o).forEach((k) => {
            if (k === 'ov') {
              const keys = Object.keys(o.ov)
              if (keys.length === 0) lines.push('  ov: {}')
              else { lines.push('  ov:'); keys.forEach((kk) => lines.push('    ' + JSON.stringify(kk) + ': ' + yamlScalaire(o.ov[kk]))) }
            } else lines.push('  ' + k + ': ' + yamlScalaire(o[k]))
          })
          return lines.join('\n')
        }
        // css: the 17 tokens, light then dark — a file to paste into a third-party theme
        const o = optsDe(S)
        const bloc = (mode) => { const t = makeTheme(mode, o); return TOKMAP.map((e) => '  --dsw-' + e[2] + ': ' + t[e[0]] + ';').join('\n') }
        return kt('/* Kybernos · Thème (' + (S.skin || 'custom') + ') — jetons DSH, clair puis sombre */', '/* Kybernos · Theme (' + (S.skin || 'custom') + ') — DSH tokens, light then dark */') + '\n:root,\nbody:not([data-ds-dark-theme]) {\n' + bloc('light') + '\n}\nbody[data-ds-dark-theme] {\n' + bloc('dark') + '\n}'
      }

      const readState = () => {
        try {
          const raw = localStorage.getItem(STORE_KEY)
          if (raw === null) return { ...DEF, ...legacyAdopt() }
          const s = JSON.parse(raw)
          const out = { ...DEF }
          for (const k of Object.keys(DEF)) if (s[k] !== undefined) out[k] = s[k]
          if (out.ov === null || typeof out.ov !== 'object') out.ov = {}
          // A damaged stored value (by hand, or by an older version) falls back to the default.
          const ok = valeursValides(s)
          Object.keys(ENUMS).concat(Object.keys(RANGES), BOOLS, HEX_KEYS, ['bubbleUser']).forEach((k) => { out[k] = ok[k] !== undefined ? ok[k] : DEF[k] })
          return out
        } catch (e) { return { ...DEF } }
      }
      // The host is told what is PERSISTED, never a trial being previewed: closing the tab during a trial must not make the
      // next load paint a theme nobody kept (see posterBoot).
      const writeState = (s) => {
        try { localStorage.setItem(STORE_KEY, JSON.stringify(s)) } catch (e) { /* quota */ }
        try { posterBoot(s) } catch (e) { /* the host is not told: one more flash on the next load */ }
      }

      // ══════════════════════════════════════════════════════════════════════
      // 4. APPLICATION — the real wires.
      // ══════════════════════════════════════════════════════════════════════

      let layerDispose = null   // overrideTokens
      let wpEl = null           // wallpaper
      let fontDispose = null    // police

      /** How many tokens have a tweak (light and/or dark count as one). */
      const jetonsRetouches = (ov) => new Set(Object.keys(ov).map((k) => k.slice(k.indexOf(':') + 1))).size

      /** The scheme actually DISPLAYED. “System” follows the OS: deducing the scheme from the setting alone (`mode !== 'light'`)
       *  always gave “dark” to someone on “System” on a light OS, and the page measured dark inks
       *  on a light background. We read the attribute DSH sets on <body>, and fall back on the setting
       *  only when there is no page (rendering outside a browser). */
      const schemeSombre = (S) => {
        try { if (document.body && typeof document.body.hasAttribute === 'function') return document.body.hasAttribute('data-ds-dark-theme') } catch (e) { /* no page */ }
        return S.mode !== 'light'
      }

      const estNaturel = (S) => S.skin === 'dsh' && S.acc === null && S.wp === 'none'
        && Object.keys(S.ov).length === 0 && S.contrastMode === 'standard' && S.radius === 'standard' && S.cbSafe === false
        && S.sideTone === 'auto' && S.bubbleUser === 'auto'

      /** The schemes in which the look sets its OWN brand colour: an accent (every scheme) or a `<scheme>:brand` override (Ember, the Advanced editor). The
       *  Kybernos accent (kybernos-plugin, `--kybernos-accent`) is the brand orange unless the look says otherwise; this is how it says so (makeTheme: the same test). */
      const accentsPropres = (S) => (estNaturel(S) ? [] : ['light', 'dark'].filter((mode) => Boolean(S.acc) || Boolean(S.ov && S.ov[mode + ':brand'])))

      // ── Wallpaper: filters, fit (also used by the glass preview) ─────────────
      const filtreFond = (S) => {
        const f = []
        if (S.wpBlur > 0) f.push('blur(' + S.wpBlur + 'px)')
        const br = (S.bgBrightness / 100) * (1 - S.bgDarken / 100)
        if (Math.abs(br - 1) > 0.005) f.push('brightness(' + br.toFixed(3) + ')')
        if (S.bgContrast !== 100) f.push('contrast(' + S.bgContrast + '%)')
        if (S.bgSaturation !== 100) f.push('saturate(' + S.bgSaturation + '%)')
        return f.length > 0 ? f.join(' ') : 'none'
      }
      /** Size / position / repeat of a background. Patterns and colours carry their size in their shorthand. */
      const ajustementFond = (S) => {
        if (S.bgFit === 'fill') return { size: 'contain', position: 'center', repeat: 'no-repeat' }
        if (S.bgFit === 'center') return { size: 'auto', position: 'center', repeat: 'no-repeat' }
        if (S.bgFit === 'stretch') return { size: '100% 100%', position: 'center', repeat: 'no-repeat' }
        return { size: 'cover', position: 'center', repeat: 'no-repeat' }
      }
      const avecAlpha = (hex, a) => toHex(HEX(hex) || [0, 0, 0]) + Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0')
      const RADIUS_DEF = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, panel: 28 }
      const RADIUS_ECHELLE = { sharp: 0.25, standard: 1, soft: 1.5 }

      /** The options makeTheme takes, from a state: one place for the three that used to build them (the layer, the CSS export, the page). */
      const optsDe = (S) => {
        const wpo = WPS.find((w) => w.id === S.wp) || WPS[0]
        return { acc: S.acc, ov: S.ov, lvl: S.contrastMode === 'max' ? 2 : (S.contrastMode === 'plus' ? 1 : 0), cb: S.cbSafe, tint: wpo.id !== 'none' ? S.tint : 0, dom: wpo.dom, sideTone: S.sideTone }
      }
      /** The text colour that reads best on a colour: white or the DSH ink. */
      const encreSur = (bg) => (ratio('#FFFFFF', bg) >= ratio('#0F1115', bg) ? '#FFFFFF' : '#0F1115')
      /** Your messages in ONE scheme (`t` = makeTheme of that scheme): the bubble colour (`bg`, null while DSH's own bubble stays) and the text colour
       *  (`text`, null while the app's own stays). A bubble of our own colour gets a readable text unless one was chosen. */
      const bulleDe = (S, t, dark) => {
        const v = S.bubbleUser
        let bg = null
        if (v === 'accent') bg = t.fill
        else if (v === 'soft') bg = mix(t.base, t.t1, 0.1)
        else if (v === 'dark') bg = dark ? '#000000' : '#1D1F24'
        else if (validHex(v)) bg = toHex(HEX(v))
        const text = S.textUser !== null ? S.textUser : (bg !== null ? encreSur(bg) : null)
        return { bg, text }
      }

      /** The token layer: 17 variables, one {light, dark} pair each.
       *  In native configuration, the layer is removed — the original DSH
       *  then passes through as is, without even a redundancy on top. */
      const jetonsDe = (S) => {
        if (estNaturel(S)) return null
        const wpo = WPS.find((w) => w.id === S.wp) || WPS[0]
        const o = optsDe(S)
        const cl = makeTheme('light', o), cd = makeTheme('dark', o)
        const jetons = {}
        for (const [k, , css] of TOKMAP) jetons['--dsw-' + css] = { light: cl[k], dark: cd[k] }
        // Your messages: DSH paints its bubble with this token (`body` and `body[data-ds-dark-theme]` declare it), so a colour here reaches it with no hook on the markup.
        const bl = bulleDe(S, cl, false), bd = bulleDe(S, cd, true)
        if (bl.bg !== null) jetons['--dsw-specific-bubble'] = { light: bl.bg, dark: bd.bg }
        // A background you cannot see is useless: DSH's main area (`bg-base`) paints an opaque flat fill
        // OVER it (measured: 375 points out of 375 covered). When a background is chosen, `bg-base`
        // becomes transparent — the “Visibility” slider then doses the background against the base colour.
        // Only the workspace badge at the foot of the sidebar used it as a TEXT colour
        // (fixed in kybernos-cloud); on all the pages browsed, nothing else.
        if (wpo.id !== 'none') {
          jetons['--dsw-alias-bg-base'] = { light: avecAlpha(cl.base, 0), dark: avecAlpha(cd.base, 0) }
          if (S.sidebarLinked) jetons['--dsw-specific-sidebar-fill'] = { light: avecAlpha(cl.side, 1 - S.sidebarOpacity / 100), dark: avecAlpha(cd.side, 1 - S.sidebarOpacity / 100) }
          jetons['--dsw-specific-input-major'] = { light: avecAlpha(cl.input, 1 - S.fieldOpacity / 100), dark: avecAlpha(cd.input, 1 - S.fieldOpacity / 100) }
          jetons['--dsw-specific-menu'] = { light: avecAlpha(cl.l3, 1 - S.floatOpacity / 100), dark: avecAlpha(cd.l3, 1 - S.floatOpacity / 100) }
        }
        if (S.radius !== 'standard') {
          Object.keys(RADIUS_DEF).forEach((n) => { const v = Math.max(0, Math.round(RADIUS_DEF[n] * RADIUS_ECHELLE[S.radius])) + 'px'; jetons['--dsw-radius-' + n] = { light: v, dark: v } })
        }
        return jetons
      }

      // ── The first-paint sheet (anti-flash v2) ────────────────────────────────────────────────────────
      // This layer only applies when the bundle activates, which on a slow link is long after the shell has
      // painted (measured: 34 s with a throttled 250 KB/s link), so the page showed DSH's default palette until
      // then. The host keeps the last applied state (tokens + font, POST /kybernos-theme/boot) and puts it in
      // every index render as `<style id="kbth-boot">` (boot-store.mjs). The sheet is scaffolding: it is removed
      // as soon as the real layer is in place.
      const BOOT_ID = 'kbth-boot'
      /** What the host paints first: the same layer and font as the ones applied here, from the same function. */
      const bootSnapshot = (S) => {
        const f = FONTS.find((x) => x.id === S.fontText) || FONTS[0]
        return { v: 1, tokens: jetonsDe(S) || {}, font: typeof f.stack === 'string' ? f.stack : null }
      }
      const bootHostUrl = () => { try { return new URL('kybernos-theme/boot', document.baseURI).pathname } catch (e) { return '/kybernos-theme/boot' } }
      let bootEnvoye = ''
      /** Fire and forget: a refusal only costs a flash on the next load. The same look is never sent twice. */
      const posterBoot = (S) => {
        try {
          const corps = JSON.stringify(bootSnapshot(S))
          if (corps === bootEnvoye || typeof fetch !== 'function') return
          bootEnvoye = corps
          const r = fetch(bootHostUrl(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: corps })
          if (r !== null && r !== undefined && typeof r.catch === 'function') r.catch(() => { bootEnvoye = '' })
        } catch (e) { bootEnvoye = '' }
      }
      /** Removes the sheet once the layer is in (two frames later: DSH's presenter writes the variables inline). */
      const retirerFeuilleBoot = () => {
        try {
          const el = typeof document.getElementById === 'function' ? document.getElementById(BOOT_ID) : null
          if (el === null || el === undefined) return
          const retirer = () => { try { el.remove() } catch (e) { /* already removed */ } }
          if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => { requestAnimationFrame(retirer) })
          else retirer()
        } catch (e) { /* not in a browser */ }
      }

      const appliquerJetons = (themeSvc, S) => {
        if (layerDispose !== null) { try { layerDispose() } catch (e) { /* already removed */ } layerDispose = null }
        // The Kybernos accent follows this look's brand colour when it has one (see accentsPropres; the rule is the core's KB_ACCENT_CSS).
        try {
          const own = accentsPropres(S)
          if (own.length > 0) document.documentElement.setAttribute('data-kbth-brand', own.join(' '))
          else document.documentElement.removeAttribute('data-kbth-brand')
        } catch (e) { /* not in a browser */ }
        const jetons = jetonsDe(S)
        if (jetons === null) { retirerFeuilleBoot(); return }
        try { layerDispose = themeSvc.overrideTokens('kybernos-theme', jetons); retirerFeuilleBoot() } catch (e) { layerDispose = null }
      }

      /** The wallpaper: a fixed div under the application (proven
       *  dream-skin pattern), plus a tint of the surfaces when it is active.
       *  The document body may not exist yet when the plugin is
       *  activated: we then wait for DOMContentLoaded instead of swallowing the error —
       *  measured, without that the token layer was applied but the background, the
       *  font and the size were silently skipped. */
      const appliquerFond = (S) => {
        const poser = () => {
          const wpo2 = WPS.find((w) => w.id === S.wp) || WPS[0]
          if (wpo2.id === 'none') {
            if (wpEl !== null) { try { wpEl.remove() } catch (e) { /* already removed */ } wpEl = null }
            return
          }
          if (wpEl === null || !document.body.contains(wpEl)) {
            wpEl = document.createElement('div')
            wpEl.style.cssText = 'position:fixed;inset:0;z-index:-1;pointer-events:none;'
            document.body.prepend(wpEl)
          }
          // IMPORTANT : certains fonds utilisent la syntaxe shorthand
          // (position/size in the same string, e.g. "gradient 0 0/32px 32px").
          // This syntax is only valid on the `background` property,
          // not on `backgroundImage`. We set the shorthand first,
          // then override the individual properties if needed.
          wpEl.style.background = wpo2.css
          const isPattern = wpo2.cat === 'patterns' || wpo2.cat === 'colors'
          // Patterns and colours: the shorthand already carries size and repeat (“0 0/18px 18px”).
          // Overriding them with `auto` squashed the tiles into one big cell.
          if (!isPattern) {
            const aj = ajustementFond(S)
            wpEl.style.backgroundSize = aj.size
            wpEl.style.backgroundPosition = aj.position
            wpEl.style.backgroundRepeat = aj.repeat
          }
          wpEl.style.opacity = String(Math.max(0, Math.min(100, S.wpVis)) / 100)
          wpEl.style.filter = filtreFond(S)
          wpEl.style.transform = S.bgMirror ? 'scaleX(-1)' : 'none'
        }
        // readyState, not DOMContentLoaded: when the plugin is activated,
        // the event has OFTEN already passed — waiting for it would be pointless.
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', poser, { once: true })
          return
        }
        poser()
      }

      /** The sheet of effects that are not tokens: glass (blur), ligatures, logo, motion, focus,
       *  targets, links. A pure string (testable); empty when nothing is requested. The selectors are
       *  DSH's STABLE hooks (`data-slot`, `data-composer-card`, ARIA roles), never its hashed classes. */
      const effetsCss = (S) => {
        const css = []
        if (S.wp !== 'none' && S.glassBlur > 0) {
          const bf = 'blur(' + S.glassBlur + 'px)' + (S.glassEffect === 'liquid' ? ' saturate(165%) brightness(1.06)' : '')
          const sel = []
          if (S.sidebarLinked) sel.push('[data-slot="sidebar"]', '[data-slot="sidebar"] > *', ':has(> [data-slot="sidebar"])')
          sel.push('[data-composer-card]', '[role="menu"]', '[role="listbox"]')
          css.push(sel.join(',') + '{-webkit-backdrop-filter:' + bf + ';backdrop-filter:' + bf + '}')
          if (S.glassEffect === 'liquid') css.push('[data-composer-card],[role="menu"],[role="listbox"]{box-shadow:inset 0 0 0 .5px rgba(255,255,255,.18),inset 0 1px 0 rgba(255,255,255,.22)}')
        }
        if (!S.ligatures) css.push('*,*::before,*::after{font-variant-ligatures:none!important;font-feature-settings:"liga" 0,"calt" 0!important}')
        if (!S.showBrand) css.push('[data-slot="sidebar.brand.mark"],[data-slot="sidebar.brand.name"],[data-slot="conversation.hero.brand.mark"]{display:none!important}')
        if (S.reduceMotion) css.push('*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}')
        if (S.focusRing === 'thick') css.push(':focus-visible{outline:3px solid var(--dsw-alias-brand-primary)!important;outline-offset:2px!important}')
        if (S.focusRing === 'double') css.push(':focus-visible{outline:2px solid var(--dsw-alias-brand-primary)!important;outline-offset:2px!important;box-shadow:0 0 0 5px var(--dsw-alias-bg-layer-1)!important}')
        if (S.largeTargets) css.push('button,[role="button"],[role="tab"],[role="menuitem"],[role="option"],[role="switch"],select,summary,input:not([type="hidden"]):not([type="range"]):not([type="checkbox"]):not([type="radio"]){min-height:44px!important}')
        if (S.underlineLinks) css.push('a[href],[role="link"]{text-decoration:underline!important;text-underline-offset:2px!important}')
        // Shadows and glow: layers of one box-shadow (a later rule replaces an earlier one, so the glass highlight is repeated when it is on).
        const insets = S.wp !== 'none' && S.glassBlur > 0 && S.glassEffect === 'liquid' ? ['inset 0 0 0 .5px rgba(255,255,255,.18)', 'inset 0 1px 0 rgba(255,255,255,.22)'] : []
        const lift = S.shadow === 'soft' ? ['0 4px 14px rgba(0,0,0,.2)'] : []
        if (lift.length > 0) css.push('[role="menu"],[role="listbox"]{box-shadow:' + lift.concat(insets).join(',') + '}')
        const halo = S.glow ? ['0 0 18px color-mix(in srgb,var(--dsw-alias-brand-primary) 55%,transparent)'] : []
        if (lift.length + halo.length > 0) css.push('[data-composer-card]{box-shadow:' + lift.concat(halo, insets).join(',') + '}')
        // Your messages: their text colour, inside your messages only (the markup says `data-chat-flow-kind="user"`); each scheme has its own readable ink
        // when the bubble is our colour. The bubble colour itself is a token (see jetonsDe).
        const o = optsDe(S)
        const bl = bulleDe(S, makeTheme('light', o), false), bd = bulleDe(S, makeTheme('dark', o), true)
        const ink = (t) => '[data-chat-flow-kind="user"]{--dsw-alias-label-primary:' + t + '}'
        if (S.textUser !== null) css.push(ink(S.textUser))
        else {
          if (bl.text !== null) css.push('body:not([data-ds-dark-theme]) ' + ink(bl.text))
          if (bd.text !== null) css.push('body[data-ds-dark-theme] ' + ink(bd.text))
        }
        // The agent's replies: DSH draws no bubble around them, so the frame is ours, on the container of the reply (`data-chat-group-part="response"`).
        // If DSH renames that marker the frame stops showing and nothing else is touched.
        const own = S.replyColor
        const frame = []
        if (S.replyBg === 'card') frame.push('background:' + (own !== null ? own : 'color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent)'), 'border:1px solid var(--dsw-alias-border-l2)')
        if (S.replyBg === 'outline') frame.push('border:1px solid ' + (own !== null ? own : 'var(--dsw-alias-border-l4)'))
        if (S.replyBg === 'tint') frame.push('background:color-mix(in srgb,' + (own !== null ? own : 'var(--dsw-alias-brand-primary)') + ' 12%,transparent)')
        if (S.replyBg !== 'none') frame.push('border-radius:var(--dsw-radius-lg,16px)', 'padding:10px 14px')
        const replyInk = S.textReply !== null ? S.textReply : (S.replyBg === 'card' && own !== null ? encreSur(own) : null)
        if (replyInk !== null) frame.push('color:' + replyInk, '--dsw-alias-label-primary:' + replyInk)
        if (frame.length > 0) css.push('[data-chat-group-part="response"]{' + frame.join(';') + '}')
        // The pills under the message box (the dock): the status pills, the changes chip and the usage chip, each switched off on its own. Each is found by the
        // `data-kb` its own bundle puts on it (a bundle's classes are its own: test-prefix of kybernos-sessions).
        const dock = '[data-slot="conversation.composer.dock"]'
        if (!S.wgSessions) css.push(dock + ' [data-kb="status-pill"]{display:none!important}')
        if (!S.wgChanges) css.push(dock + ' [data-kb="changes"]{display:none!important}')
        if (!S.wgUsage) css.push(dock + ' [data-kb="usage-chip"]{display:none!important}')
        if (S.autoHideBars) css.push(AUTOHIDE_CSS)
        return css.join('\n')
      }
      /** Bars on hover (owner's call, 2026-10-22). Only on a pointer that can hover: a touch screen has nothing to hover with.
       *  - The collapsed rail slides out to an 8 px sliver and the chat takes its column back (the three columns are placed by hand so the
       *    grid does not reflow); it comes back while the pointer or the keyboard is in it, or while a menu opened from it is open
       *    (an open section of the rail is aria-expanded too, so only a popup trigger counts).
       *  - The top bar of a chat (title, pin, ⋯) does the same with a 6 px sliver at the top.
       *  Found by the suffix of the shell's hashed classes, which survives a rebuild (the prefix does not). */
      const AUTOHIDE_FRAME = '[class*="_frame"]:has(>[class*="_sidebarCol"] [class*="_collapsed"])'
      const AUTOHIDE_RAIL = AUTOHIDE_FRAME + '>[class*="_sidebarCol"]'
      const AUTOHIDE_TOP = '[class*="_centerCol"] header[class*="_header"]:has(>[class*="_headerLeading"])'
      const AUTOHIDE_CSS = '@media (hover:hover) and (pointer:fine){' +
        AUTOHIDE_FRAME + '>[class*="_centerCol"]{grid-column:1 / 3;grid-row:1}' +
        AUTOHIDE_FRAME + '>[class*="_rightbarCol"]{grid-column:3;grid-row:1}' +
        AUTOHIDE_RAIL + '{grid-column:1;grid-row:1;z-index:40;transform:translateX(calc(-100% + 8px));transition:transform .18s ease .2s,box-shadow .18s ease .2s;background:var(--dsw-alias-bg-layer-1)}' +
        'html[dir="rtl"] ' + AUTOHIDE_RAIL + '{transform:translateX(calc(100% - 8px))}' +
        AUTOHIDE_RAIL + ':hover,' + AUTOHIDE_RAIL + ':focus-within,' + AUTOHIDE_RAIL + ':has([aria-haspopup][aria-expanded="true"]){transform:none;transition-delay:0s;box-shadow:0 0 28px rgba(0,0,0,.35)}' +
        '[class*="_centerCol"]:has(' + AUTOHIDE_TOP.slice('[class*="_centerCol"] '.length) + '){position:relative}' +
        AUTOHIDE_TOP + '{position:absolute;inset-inline:0;top:0;z-index:30;transform:translateY(calc(-100% + 6px));transition:transform .18s ease .2s,box-shadow .18s ease .2s;background:var(--dsw-alias-bg-layer-1)}' +
        AUTOHIDE_TOP + ':hover,' + AUTOHIDE_TOP + ':focus-within,' + AUTOHIDE_TOP + ':has([aria-haspopup][aria-expanded="true"]){transform:none;transition-delay:0s;box-shadow:0 8px 24px rgba(0,0,0,.28)}' +
        '}'
      let effetsDispose = null
      const appliquerEffets = (S) => {
        if (effetsDispose !== null) { try { effetsDispose() } catch (e) { /* already removed */ } effetsDispose = null }
        // The thinking-animation engine also reads this attribute: “reduce” applies to it too.
        try { if (S.reduceMotion) document.documentElement.setAttribute('data-kbth-reduced', '1'); else document.documentElement.removeAttribute('data-kbth-reduced') } catch (e) { /* hors navigateur */ }
        try { if (S.cbSafe) document.documentElement.setAttribute('data-kbth-cb', '1'); else document.documentElement.removeAttribute('data-kbth-cb') } catch (e) { /* hors navigateur */ }
        const css = effetsCss(S)
        if (css !== '') effetsDispose = styles.insert(css)
      }

      // `:root` AND `body`: DSH 0.2.1-alpha.2 declares `--dsw-font-family` again on `body` (its own font list
      // goes ahead of the built-in stack there), which shadows a rule that only targets `:root` — the chosen
      // family then reached nothing. Both selectors are harmless on the engines that only declare it on `:root`.
      const appliquerPolice = (S) => {
        if (fontDispose !== null) { try { fontDispose() } catch (e) { /* already removed */ } fontDispose = null }
        const f = FONTS.find((x) => x.id === S.fontText) || FONTS[0]
        if (f.stack !== null) fontDispose = styles.insert(':root,body{--dsw-font-family:' + f.stack + ' !important;}')
      }

      const appliquerMode = (themeSvc, S) => {
        const m = S.mode === 'system' || S.mode === 'light' ? S.mode : 'dark'
        try { themeSvc.setTheme(m) } catch (e) {
          // A refused preference must be visible, not disappear.
          try { console.error('[kybernos-theme] setTheme(' + m + ') refused', e) } catch (e2) { /* console indisponible */ }
        }
      }

      /** Does DSH's theme service take a font ROLE (`setFontSize('text', px)`)? 0.2.1-alpha.2 does, and its snapshot
       *  carries `fontSizes: { text, code, terminal }`. Earlier engines: `setFontSize(px)` and `fontSize`. The old
       *  call on the new service throws (the role would be the size), so the size was silently never written. */
      const tailleParRole = (themeSvc) => {
        try {
          const snap = themeSvc.getTheme()
          return snap !== null && typeof snap === 'object' && snap.fontSizes !== null && typeof snap.fontSizes === 'object'
        } catch (e) { return false }
      }

      const appliquerTaille = (themeSvc, S) => {
        const px = Math.max(12, Math.min(17, Math.round(Number(S.fs) || 15)))
        try {
          if (tailleParRole(themeSvc)) themeSvc.setFontSize('text', px)
          else themeSvc.setFontSize(px)
        } catch (e) { /* hors plage */ }
      }

      const appliquerTout = (themeSvc, S) => {
        appliquerMode(themeSvc, S)
        appliquerIcones(S)
        appliquerJetons(themeSvc, S)
        appliquerFond(S)
        appliquerPolice(S)
        appliquerEffets(S)
        appliquerTaille(themeSvc, S)
      }

      /** The current native preference, when usable.
       *  `getTheme()` returns a stable snapshot: `preference` is “light”,
       *  “dark” or “system”, or the service default as long as the settings
       *  scope has not arrived. */
      const prefNative = (themeSvc, snapArg) => {
        try {
          const snap = (snapArg !== null && snapArg !== undefined) ? snapArg : ((themeSvc === null || themeSvc === undefined || typeof themeSvc.getTheme !== 'function') ? null : themeSvc.getTheme())
          const p = (snap !== null && snap !== undefined) ? snap.preference : null
          return (p === 'light' || p === 'dark' || p === 'system') ? p : null
        } catch (e) { return null }
      }

      /** The ACTIVATION application: everything except the mode.
       *
       *  Why the mode is excluded — measured on 23/09/2026: DSH keeps the
       *  theme preference in a durable settings scope
       *  (`theme.setTheme()` → `host.set('preference')`) and restores it
       *  itself on load. Rewriting it from our store overwrote the
       *  user's last choice: toggle “dark → light” with the button at the
       *  foot of the sidebar, then reload → the app went back to
       *  dark. So we let the native preference apply, we ADOPT its
       *  value into the store (so the Settings page tells the truth), and we
       *  copy back any native change coming from elsewhere. */
      const appliquerBoot = (themeSvc, S) => {
        posterBoot(S)
        appliquerIcones(S)
        appliquerJetons(themeSvc, S)
        appliquerFond(S)
        appliquerPolice(S)
        appliquerEffets(S)
        // No size here either: DSH persists it (setFontSize) and restores it
        // itself; rewriting it from our store overwrote the user's
        // (same class of bug as the mode). We ADOPT it, see tailleNative.
      }

      /** DSH's own text size (12–17) when the snapshot carries it: `fontSizes.text` (0.2.1-alpha.2), else `fontSize`
       *  (earlier engines). */
      const tailleNative = (themeSvc, snapArg) => {
        try {
          const snap = (snapArg !== null && snapArg !== undefined) ? snapArg : ((themeSvc === null || themeSvc === undefined || typeof themeSvc.getTheme !== 'function') ? null : themeSvc.getTheme())
          const brute = (snap === null || snap === undefined) ? undefined
            : ((snap.fontSizes !== null && typeof snap.fontSizes === 'object') ? snap.fontSizes.text : snap.fontSize)
          const n = brute === undefined ? NaN : Number(brute)
          return (Number.isFinite(n) && n >= 12 && n <= 17) ? Math.round(n) : null
        } catch (e) { return null }
      }

      /** “Surprise me” — a coherent draw: the background dictates the mode and the
       *  tint, the accent comes from the dominant colour of the background. */
      const surprendre = () => {
        const wp = WPS[1 + Math.floor(Math.random() * (WPS.length - 1))]
        const clair = ['sable', 'brume', 'menthe', 'peche', 'brumeg', 'carreaux', 'seyes', 'points', 'milli', 'lignes', 'kraft', 'idunes', 'iforet'].indexOf(wp.id) >= 0
        return {
          mode: clair ? 'light' : 'dark',
          skin: 'custom', acc: wp.dom || null, wp: wp.id,
          wpVis: 55 + Math.floor(Math.random() * 25), tint: Math.floor(Math.random() * 40)
        }
      }

      // ══════════════════════════════════════════════════════════════════════
      // 4b. THINKING ANIMATION — the status at the bottom of the chat.
      //
      //   As long as the agent is working, DSH mounts a `[data-chat-running]` block: a
      //   14 px whale tail, then “Deep diving for 12s ···” (shimmering text,
      //   written TWICE: the text and its luminous copy). The block is remounted on
      //   every answer. We do not touch the engine: a MutationObserver spots it,
      //   puts the chosen animation in it (hiding the whale tail) and replaces the
      //   native phrase with an ambiance word — with DSH's template and duration.
      //   Everything is defensive: if the structure changes, we do nothing.
      //
      //   The settings live in a separate key (kybernos.theme.loader.v1): “Reset
      //   all” on the Theme page must not erase your animations. The imported files
      //   and the pack's words live on disk (host route
      //   /kybernos-theme/loader-store); the browser keeps only the CHOSEN
      //   animations, to paint without waiting for the host.
      // ══════════════════════════════════════════════════════════════════════

      const LD_KEY = 'kybernos.theme.loader.v1'
      const LD_CACHE = 'kybernos.theme.loader.cache.v1'
      const LD_DEF = { sel: [], mode: 'random', size: 'standard', tint: true, keep: true, speed: 1, avoid: true, delay: 300, pack: 'dsh', rot: 'fixed', dur: true, updatedAt: 0 }
      const LD_SIZES = { compact: 14, standard: 24, large: 40 }
      const LD_MAX = 4
      const LD_LIMIT = 200 * 1024
      const LD_ID = /^[a-z0-9][a-z0-9-]{0,63}$/
      const LD_WHALE = 'M8.844 13.742C8.967 12.328 8.45 10.4 8.45 9.65C8.45 8.94 8.88 8.43 9.6 8.43C11.285 8.43 12.106 8.281 12.685 8.104C13.71 7.791 14.585 6.768 15.055 5.945C15.137 5.803 14.99 5.641 14.829 5.671C13.829 5.86 12.828 5.376 11.827 4.978C10.659 4.514 9.491 4.707 8.935 4.876C8.805 4.915 8.658 4.819 8.636 4.686C8.468 3.643 7.405 2.615 5.498 2.238C4.54 2.048 3.748 1.574 3.347 1.202C3.252 1.113 3.088 1.125 3.03 1.242C2.628 2.059 2.168 3.82 5.248 6.115C5.82 6.494 6.31 6.785 6.574 7.637C6.72 8.104 6.157 9.168 6.061 9.368C5.157 11.27 5.089 12.19 4.926 13.742'

      /** The settings, always put back into the expected shape (same allow-list as the host). */
      const ldClean = (raw) => {
        const r = (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {}
        const out = { ...LD_DEF, sel: [] }
        if (Array.isArray(r.sel)) out.sel = r.sel.filter((id, i, a) => typeof id === 'string' && LD_ID.test(id) && a.indexOf(id) === i).slice(0, LD_MAX)
        if (r.mode === 'random' || r.mode === 'order') out.mode = r.mode
        if (typeof r.size === 'string' && LD_SIZES[r.size] !== undefined) out.size = r.size
        ;['tint', 'keep', 'avoid', 'dur'].forEach((k) => { if (typeof r[k] === 'boolean') out[k] = r[k] })
        if (typeof r.speed === 'number' && Number.isFinite(r.speed)) out.speed = Math.round(Math.max(0.5, Math.min(2, r.speed)) * 20) / 20
        if (typeof r.delay === 'number' && Number.isFinite(r.delay)) out.delay = Math.round(Math.max(0, Math.min(1000, r.delay)))
        if (typeof r.pack === 'string' && /^[a-z0-9-]{1,40}$/.test(r.pack)) out.pack = r.pack
        if (r.rot === 'fixed' || r.rot === '8' || r.rot === '15') out.rot = r.rot
        if (typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt)) out.updatedAt = r.updatedAt
        return out
      }
      const ldRead = () => {
        try { const raw = localStorage.getItem(LD_KEY); return raw === null ? ldClean({}) : ldClean(JSON.parse(raw)) } catch (e) { return ldClean({}) }
      }
      const ldWrite = (S) => { try { localStorage.setItem(LD_KEY, JSON.stringify(S)) } catch (e) { /* quota */ } }

      // ── The catalogue: 34 original drawings (48×48, animated in CSS) ───────────
      // The ones from your two references (Lottie pack “Loading symbols set”) are not
      // included: they belong to their author. Import them from “Add your own”.
      const ldSv=(inner,attrs)=>'<svg viewBox="0 0 48 48" aria-hidden="true" '+(attrs||'')+'>'+inner+'</svg>'
      const LD_PRESETS_RAW=[
       {id:'ring',kind:'mono',dur:'1,0 s',svg:ldSv('<circle cx="24" cy="24" r="18" stroke-opacity=".2"/><circle class="vb a-spin" cx="24" cy="24" r="18" stroke-dasharray="30 120" style="--d:1s"/>','fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"')},
       {id:'orbit',kind:'mono',dur:'1,4 s',svg:ldSv('<g class="vb a-spin" style="--d:1.4s"><circle cx="24" cy="8" r="4.5"/><circle cx="37.9" cy="32" r="3.5" opacity=".65"/><circle cx="10.1" cy="32" r="2.5" opacity=".4"/></g>','fill="currentColor"')},
       {id:'pulse',kind:'mono',dur:'1,6 s',svg:ldSv('<circle cx="24" cy="24" r="4" fill="currentColor"/><circle class="a-pulse" cx="24" cy="24" r="22" fill="none" stroke="currentColor" stroke-width="3"/><circle class="a-pulse" cx="24" cy="24" r="22" fill="none" stroke="currentColor" stroke-width="3" style="animation-delay:-.8s"/>')},
       {id:'bars',kind:'mono',dur:'1,0 s',svg:ldSv([5,14,23,32,41].map((x,i)=>'<rect class="a-bar" x="'+(x-3)+'" y="8" width="6" height="32" rx="3" style="animation-delay:'+(-0.9+i*0.12).toFixed(2)+'s"/>').join(''),'fill="currentColor"')},
       {id:'dots',kind:'mono',dur:'1,1 s',svg:ldSv([10,24,38].map((x,i)=>'<circle class="a-bounce" cx="'+x+'" cy="29" r="5" style="animation-delay:'+(-1+i*0.16).toFixed(2)+'s"/>').join(''),'fill="currentColor"')},
       {id:'atom',kind:'mono',dur:'1,4 s',svg:ldSv([0,60,120].map((r,i)=>'<ellipse cx="24" cy="24" rx="20" ry="8" transform="rotate('+r+' 24 24)" stroke-opacity=".22"/><ellipse class="a-dash" pathLength="100" cx="24" cy="24" rx="20" ry="8" transform="rotate('+r+' 24 24)" stroke-dasharray="30 70" style="animation-delay:'+(-i*0.45).toFixed(2)+'s"/>').join('')+'<circle cx="24" cy="24" r="3" fill="currentColor" stroke="none"/>','fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"')},
       {id:'flow',kind:'mono',dur:'1,4 s',svg:ldSv('<line x1="6" y1="24" x2="42" y2="24" stroke-opacity=".2"/><line class="a-dash" pathLength="100" x1="6" y1="24" x2="42" y2="24" stroke-dasharray="28 72"/>','fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"')},
       {id:'sand',kind:'mono',dur:'2,4 s',svg:ldSv('<g class="vb a-flip" style="--d:2.4s"><path d="M14 6h20M14 42h20"/><path d="M16 6c0 11 8 13 8 18s-8 7-8 18M32 6c0 11-8 13-8 18s8 7 8 18"/><path d="M18.5 12h11L24 20z" fill="currentColor" stroke="none"/></g>','fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"')},
       {id:'jelly',kind:'color',dur:'1,6 s',svg:ldSv('<g class="a-jelly"><circle cx="24" cy="24" r="16" fill="var(--c1)"/><circle cx="31" cy="18" r="3.2" fill="#fff" opacity=".92"/></g>')},
       {id:'quad',kind:'color',dur:'1,2 s',svg:ldSv([[6,6,'--c1'],[26,6,'--c3'],[6,26,'--c2'],[26,26,'--c4']].map((q,i)=>'<rect class="a-pop" x="'+q[0]+'" y="'+q[1]+'" width="16" height="16" rx="4.5" fill="var('+q[2]+')" style="animation-delay:'+(-1.2+i*0.3).toFixed(2)+'s"/>').join(''))},
       {id:'petals',kind:'color',dur:'1,2 s',svg:ldSv(Array.from({length:8},(_,i)=>'<ellipse class="a-fade" cx="24" cy="9.5" rx="3.2" ry="6.5" transform="rotate('+(i*45)+' 24 24)" fill="var(--c'+(i%4+1)+')" style="animation-delay:'+(-1.2+i*0.15).toFixed(2)+'s"/>').join(''))},
       {id:'gears',kind:'color',dur:'3,0 s',svg:ldSv('<g transform="translate(18 18)"><circle class="a-spin" r="8.91" fill="none" stroke="var(--c1)" stroke-width="5" stroke-dasharray="3.5 3.5" style="--d:3s"/><circle r="6" fill="none" stroke="var(--c1)" stroke-width="3"/></g><g transform="translate(32 32) scale(.78)"><circle class="a-spin a-rev" r="8.91" fill="none" stroke="var(--c2)" stroke-width="5" stroke-dasharray="3.5 3.5" style="--d:3s"/><circle r="6" fill="none" stroke="var(--c2)" stroke-width="3"/></g>')},
       {id:'spark',kind:'color',dur:'1,6 s',svg:ldSv('<path class="a-twinkle" d="M24 4C26 16 32 22 44 24C32 26 26 32 24 44C22 32 16 26 4 24C16 22 22 16 24 4Z" fill="var(--c2)"/><path class="a-twinkle" d="M38 4l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" fill="var(--c1)" style="animation-delay:-.8s"/>')},
       {id:'grid',kind:'color',dur:'1,2 s',svg:ldSv([0,1,2].map(r=>[0,1,2].map(c=>'<rect class="a-fade" x="'+(5+c*14)+'" y="'+(5+r*14)+'" width="10" height="10" rx="2.6" fill="var(--c'+(r+1)+')" style="animation-delay:'+(-1.2+(r+c)*0.2).toFixed(2)+'s"/>').join('')).join(''))},
       {id:'sprout',kind:'color',dur:'2,4 s',svg:ldSv('<ellipse cx="24" cy="41" rx="15" ry="4" fill="currentColor" opacity=".18"/><g class="a-grow" style="transform-box:view-box;transform-origin:24px 40px"><path d="M24 40V24" fill="none" stroke="var(--c3)" stroke-width="3.5" stroke-linecap="round"/><path d="M24 27C14 27 9.5 20 9.5 13.5C18 13.5 24 17.5 24 27Z" fill="var(--c3)"/><path d="M24 23C33 23 38.5 17 38.5 9.5C30 9.5 24 13.5 24 23Z" fill="var(--c3)" opacity=".7"/></g>','style="--d:2.4s"')},
       {id:'sunflower',kind:'color',dur:'8,0 s',svg:ldSv('<g class="vb a-spin" style="--d:8s">'+Array.from({length:12},(_,i)=>'<ellipse cx="24" cy="8.5" rx="3.2" ry="6.5" transform="rotate('+(i*30)+' 24 24)" fill="var(--c4)"/>').join('')+'</g><circle cx="24" cy="24" r="9" fill="var(--c2)"/><circle cx="20.5" cy="22.5" r="1.4" fill="currentColor"/><circle cx="27.5" cy="22.5" r="1.4" fill="currentColor"/><path d="M20.5 26.5q3.5 3 7 0" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>')},
       {id:'cactus',kind:'color',dur:'3,2 s',svg:ldSv('<g class="a-rock" style="--rk:3deg;transform-box:view-box;transform-origin:24px 40px"><rect x="18" y="9" width="12" height="32" rx="6" fill="var(--c3)"/><path d="M18 31h-4.5a3 3 0 0 1-3-3v-8" fill="none" stroke="var(--c3)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path d="M30 26h4.5a3 3 0 0 0 3-3v-7" fill="none" stroke="var(--c3)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><circle class="a-pop" cx="24" cy="8" r="4" fill="var(--c1)" style="--d:1.6s"/></g><path d="M14 40h20l-2.2 6.5H16.2z" fill="var(--c2)"/>','style="--d:3.2s"')},
       {id:'mushroom',kind:'color',dur:'1,4 s',svg:ldSv('<ellipse cx="24" cy="42" rx="11" ry="2.5" fill="currentColor" opacity=".16"/><g class="a-hop" style="transform-box:view-box;transform-origin:24px 40px"><rect x="18.5" y="24" width="11" height="16" rx="5" fill="var(--c4)" opacity=".6"/><path d="M5.5 28C5.5 15 13.5 7.5 24 7.5S42.5 15 42.5 28z" fill="var(--c1)"/><circle cx="14.5" cy="20" r="3.2" fill="#fff" opacity=".9"/><circle cx="26.5" cy="14.5" r="2.6" fill="#fff" opacity=".9"/><circle cx="34" cy="22.5" r="3" fill="#fff" opacity=".9"/><circle cx="21.5" cy="33" r="1.3" fill="currentColor"/><circle cx="26.5" cy="33" r="1.3" fill="currentColor"/></g>','style="--d:1.4s"')},
       {id:'rocket',kind:'color',dur:'0,4 s',svg:ldSv('<g class="a-shake"><path class="a-flame" d="M20 33h8l-4 12z" fill="var(--c4)" style="transform-box:view-box;transform-origin:24px 33px"/><path d="M17.5 25l-6.5 9h7z" fill="var(--c2)"/><path d="M30.5 25l6.5 9h-7z" fill="var(--c2)"/><path d="M24 3C31.5 9 33.5 20 31.5 33h-15C14.5 20 16.5 9 24 3z" fill="var(--c1)"/><circle cx="24" cy="18" r="3.8" fill="#fff" opacity=".92"/></g>','style="--d:.35s"')},
       {id:'balloon',kind:'color',dur:'2,4 s',svg:ldSv('<g class="a-float"><path d="M24 34c-3 4 3 7 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" opacity=".5"/><ellipse cx="24" cy="18" rx="11" ry="14" fill="var(--c1)"/><path d="M22.2 32l1.8 3.3 1.8-3.3z" fill="var(--c1)"/><ellipse cx="19.5" cy="12" rx="2.6" ry="4" fill="#fff" opacity=".4" transform="rotate(20 19.5 12)"/></g><g class="a-float" style="--d:1.7s;animation-delay:-.9s"><ellipse cx="11" cy="30" rx="6" ry="7.5" fill="var(--c4)" opacity=".85"/><path d="M11 37.5c-1.5 3 1.5 4 0 7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity=".4"/></g>','style="--d:2.4s"')},
       {id:'bulb',kind:'color',dur:'1,6 s',svg:ldSv(''+[-90,-60,-30,0,30,60,90].map((r,i)=>'<path class="a-fade" d="M24 2.5v4" transform="rotate('+r+' 24 20)" stroke="var(--c4)" stroke-width="3" stroke-linecap="round" style="animation-delay:'+(-1.6+i*0.2).toFixed(2)+'s"/>').join('')+'<circle class="a-glow" cx="24" cy="20" r="9.5" fill="var(--c4)"/><path d="M19.5 27.5h9v3a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2z" fill="var(--c4)" opacity=".6"/><rect x="19.5" y="33" width="9" height="3.5" rx="1.5" fill="currentColor" opacity=".55"/><rect x="21" y="37.5" width="6" height="3" rx="1.5" fill="currentColor" opacity=".55"/><path d="M20.5 22.5l2 3.5 1.5-4.5 1.5 4.5 2-3.5" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity=".85"/>','style="--d:1.6s"')},
       {id:'alarm',kind:'mono',dur:'3,0 s',svg:ldSv('<g class="a-shake" style="--d:.3s"><path d="M8 13l5-4M40 13l-5-4"/></g><circle cx="24" cy="25" r="15"/><path d="M13 41l3-3M35 38l3 3"/><path class="vb a-spin" style="--d:3s" d="M24 24V14"/><path class="vb a-spin" style="--d:36s" d="M24 24l5.5 3"/>','fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"')},
       {id:'cup',kind:'color',dur:'2,0 s',svg:ldSv(''+[[17,0],[24,-.6],[31,-1.2]].map((s)=>'<path class="a-rise" d="M'+s[0]+' 18c-3-3 3-5 0-9" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" style="animation-delay:'+s[1]+'s"/>').join('')+'<path d="M10 22h24v8a10 10 0 0 1-10 10h-4a10 10 0 0 1-10-10z" fill="var(--c1)"/><path d="M34 25h3a4 4 0 0 1 0 9h-4" fill="none" stroke="var(--c1)" stroke-width="3.5" stroke-linecap="round"/><rect x="8" y="41.5" width="30" height="3.5" rx="1.75" fill="currentColor" opacity=".35"/><path d="M14 26h8" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".45"/>','style="--d:2s"')},
       {id:'bunny',kind:'color',dur:'1,2 s',svg:ldSv('<ellipse cx="24" cy="43" rx="10" ry="2.4" fill="currentColor" opacity=".15"/><g class="a-hop" style="transform-box:view-box;transform-origin:24px 41px"><g class="a-rock" style="--rk:9deg;--d:.6s;transform-box:view-box;transform-origin:19px 20px"><ellipse cx="18.5" cy="11.5" rx="3.6" ry="9" fill="var(--c2)"/><ellipse cx="18.5" cy="12.5" rx="1.5" ry="5.5" fill="var(--c1)" opacity=".55"/></g><g class="a-rock a-rev" style="--rk:9deg;--d:.6s;transform-box:view-box;transform-origin:29px 20px"><ellipse cx="29.5" cy="11.5" rx="3.6" ry="9" fill="var(--c2)"/><ellipse cx="29.5" cy="12.5" rx="1.5" ry="5.5" fill="var(--c1)" opacity=".55"/></g><circle cx="24" cy="31" r="11" fill="var(--c2)"/><circle cx="19.5" cy="30" r="1.6" fill="currentColor"/><circle cx="28.5" cy="30" r="1.6" fill="currentColor"/><path d="M22.5 34l1.5 1.5 1.5-1.5z" fill="var(--c1)"/><circle cx="16" cy="34" r="2.3" fill="var(--c1)" opacity=".35"/><circle cx="32" cy="34" r="2.3" fill="var(--c1)" opacity=".35"/></g>','style="--d:1.2s"')},
       {id:'fish',kind:'color',dur:'2,0 s',svg:ldSv('<circle class="a-rise" cx="9" cy="23" r="2" fill="none" stroke="currentColor" stroke-width="1.5" style="--d:1.6s"/><circle class="a-rise" cx="6" cy="29" r="1.4" fill="none" stroke="currentColor" stroke-width="1.3" style="--d:1.6s;animation-delay:-.8s"/><g class="a-swim"><g class="a-rock" style="--rk:12deg;--d:.7s;transform-box:view-box;transform-origin:33px 26px"><path d="M32 26l10-8v16z" fill="var(--c1)"/></g><ellipse cx="22" cy="26" rx="13" ry="9" fill="var(--c2)"/><path d="M20 17.5c3-5 8-4 9 0z" fill="var(--c1)"/><path d="M26 19.5c2 4 2 9 0 13" fill="none" stroke="var(--c1)" stroke-width="2.6" stroke-linecap="round" opacity=".6"/><circle cx="14" cy="24" r="2.6" fill="#fff"/><circle cx="13.4" cy="24" r="1.2" fill="currentColor"/></g>','style="--d:2s"')},
       {id:'snail',kind:'color',dur:'3,6 s',svg:ldSv('<g class="a-swim"><rect x="5" y="32" width="36" height="8.5" rx="4.25" fill="var(--c4)"/><circle cx="38" cy="29" r="6" fill="var(--c4)"/><g class="a-rock" style="--rk:10deg;--d:1.2s;transform-box:view-box;transform-origin:37px 25px"><path d="M37 25.5l-2-9" stroke="var(--c4)" stroke-width="2.2" stroke-linecap="round" fill="none"/><circle cx="34.5" cy="15.5" r="2.2" fill="var(--c4)"/></g><g class="a-rock a-rev" style="--rk:10deg;--d:1.2s;transform-box:view-box;transform-origin:41px 25px"><path d="M41 26l2.5-8.5" stroke="var(--c4)" stroke-width="2.2" stroke-linecap="round" fill="none"/><circle cx="43.5" cy="16.5" r="2.2" fill="var(--c4)"/></g><circle cx="40" cy="29.5" r="1.2" fill="currentColor"/><circle cx="19" cy="26" r="11" fill="var(--c1)"/><path d="M19 26a3 3 0 1 1 3 3 6 6 0 1 1-6-6" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".7"/></g>','style="--d:3.6s"')},
       {id:'bee',kind:'color',dur:'1,6 s',svg:ldSv('<g class="a-float" style="--d:1.6s"><g class="a-flap" style="--d:.22s;transform-box:view-box;transform-origin:22px 22px"><ellipse cx="19" cy="12.5" rx="4.5" ry="8" fill="#fff" stroke="currentColor" stroke-width="1.5" opacity=".9"/></g><g class="a-flap a-rev" style="--d:.22s;transform-box:view-box;transform-origin:27px 22px"><ellipse cx="29" cy="12.5" rx="4.5" ry="8" fill="#fff" stroke="currentColor" stroke-width="1.5" opacity=".9"/></g><ellipse cx="24" cy="28" rx="12" ry="9" fill="var(--c4)"/><path d="M19 20.5v15M25 19.5v17M31 21.5v13" stroke="currentColor" stroke-width="3.6" opacity=".85"/><circle cx="37" cy="26" r="5.5" fill="var(--c4)"/><circle cx="39" cy="25" r="1.4" fill="currentColor"/><path d="M12 28l-5 1.5 5 1.5z" fill="currentColor"/><path d="M38 21l2-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></g>','style="--d:1.6s"')},
       {id:'cat',kind:'color',dur:'3,2 s',svg:ldSv('<g class="a-rock" style="--rk:3deg;transform-box:view-box;transform-origin:24px 42px"><path d="M11.5 21L10 6.5l10 7z" fill="var(--c2)"/><path d="M36.5 21L38 6.5l-10 7z" fill="var(--c2)"/><path d="M13 17l-.8-6.5 5 3.5z" fill="var(--c1)" opacity=".6"/><path d="M35 17l.8-6.5-5 3.5z" fill="var(--c1)" opacity=".6"/><ellipse cx="24" cy="28" rx="15" ry="13" fill="var(--c2)"/><ellipse class="a-blink" cx="18" cy="26.5" rx="2" ry="3" fill="currentColor"/><ellipse class="a-blink" cx="30" cy="26.5" rx="2" ry="3" fill="currentColor"/><path d="M22 31h4l-2 2.5z" fill="var(--c1)"/><path d="M24 33.5v1.5M21.5 36q2.5 1.5 5 0" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" opacity=".7"/><path d="M6 28h8M6.5 32.5l7-2M42 28h-8M41.5 32.5l-7-2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" opacity=".45"/></g>','style="--d:3.2s"')},
       {id:'jellyfish',kind:'color',dur:'2,4 s',svg:ldSv('<g class="a-float" style="--d:2.4s">'+[17,22.5,28,33].map((x,i)=>'<path class="a-float" d="M'+x+' 27c-3 4 3 7 0 11" fill="none" stroke="var(--c1)" stroke-width="2.6" stroke-linecap="round" opacity=".6" style="--d:1.2s;animation-delay:'+(-0.2*i)+'s"/>').join('')+'<g class="a-boing" style="transform-box:view-box;transform-origin:24px 28px"><path d="M9 28a15 15 0 0 1 30 0z" fill="var(--c1)"/><circle cx="19" cy="21" r="1.6" fill="#fff"/><circle cx="29" cy="21" r="1.6" fill="#fff"/><path d="M21.5 25q2.5 2 5 0" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></g></g>','style="--d:2.4s"')},
       {id:'onigiri',kind:'color',dur:'1,4 s',svg:ldSv('<ellipse cx="24" cy="43" rx="12" ry="2.4" fill="currentColor" opacity=".15"/><g class="a-hop" style="transform-box:view-box;transform-origin:24px 41px"><path d="M24 6c2.2 0 3.8 1.2 4.9 3.1l11.7 20.3c2.6 4.5-.6 10.1-5.8 10.1H13.2c-5.2 0-8.4-5.6-5.8-10.1L19.1 9.1C20.2 7.2 21.8 6 24 6z" fill="#fff" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/><path d="M15 33.5h18l1.9 3.4c1.1 2-.3 4.1-2.6 4.1H15.7c-2.3 0-3.7-2.1-2.6-4.1z" fill="currentColor"/><circle class="a-blink" cx="20" cy="24" r="1.7" fill="currentColor" style="--d:2.8s"/><circle class="a-blink" cx="28" cy="24" r="1.7" fill="currentColor" style="--d:2.8s"/><circle cx="16.5" cy="28" r="2.3" fill="var(--c1)" opacity=".45"/><circle cx="31.5" cy="28" r="2.3" fill="var(--c1)" opacity=".45"/><path d="M22.2 27.5q1.8 1.8 3.6 0" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></g>','style="--d:1.4s"')},
       {id:'shuriken',kind:'mono',dur:'0,7 s',svg:ldSv('<g class="vb a-spin">'+[0,90,180,270].map((r)=>'<path transform="rotate('+r+' 24 24)" d="M24 24C24 12 28 6 24 3C34 8 34 18 24 24z"/>').join('')+'</g>','fill="currentColor" style="--d:.7s"')},
       {id:'sakura',kind:'color',dur:'2,4 s',svg:ldSv('<path d="M3 7c11 5 31 5 42 0" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" opacity=".4"/>'+[[7,12,0],[22,15,-.5],[34,11,-1],[13,27,-1.5],[30,26,-1.9]].map((p)=>'<path class="a-drop" d="M'+p[0]+' '+p[1]+'c4-4 10-1 10 4-5 3-11 1-10-4z" fill="var(--c1)" fill-opacity=".75" style="animation-delay:'+p[2]+'s"/>').join('')+'','style="--d:2.4s"')},
       {id:'ghost',kind:'color',dur:'2,0 s',svg:ldSv('<g class="a-float"><path d="M10 41V23a14 14 0 0 1 28 0v18l-4.7-4-4.7 4-4.6-4-4.6 4-4.7-4z" fill="#fff" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/><ellipse class="a-blink" cx="19" cy="23" rx="1.9" ry="2.8" fill="currentColor" style="--d:3s"/><ellipse class="a-blink" cx="29" cy="23" rx="1.9" ry="2.8" fill="currentColor" style="--d:3s"/><circle cx="15" cy="28" r="2.3" fill="var(--c1)" opacity=".45"/><circle cx="33" cy="28" r="2.3" fill="var(--c1)" opacity=".45"/><path d="M22 29q2 2.2 4 0" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></g>','style="--d:2s"')},
       {id:'anger',kind:'color',dur:'1,0 s',svg:ldSv('<g class="a-beat"><path d="M8 19c8 0 11-3 11-11"/><path d="M40 19c-8 0-11-3-11-11"/><path d="M8 29c8 0 11 3 11 11"/><path d="M40 29c-8 0-11 3-11 11"/></g>','fill="none" stroke="var(--c1)" stroke-width="4.5" stroke-linecap="round" style="--d:1s"')}
      ]
      /* drawn by the skill (the demo draws one at each request) */
      const LD_NAMES = {
        ring: ['Anneau', 'Ring'],
        orbit: ['Orbite', 'Orbit'],
        pulse: ['Pulsation', 'Pulse'],
        bars: ['Barres', 'Bars'],
        dots: ['Rebond', 'Bounce'],
        atom: ['Atome', 'Atom'],
        flow: ['Flux', 'Flow'],
        sand: ['Sablier', 'Hourglass'],
        jelly: ['Bille', 'Marble'],
        quad: ['Quatre carrés', 'Four squares'],
        petals: ['Pétales', 'Petals'],
        gears: ['Engrenages', 'Gears'],
        spark: ['Étincelle', 'Spark'],
        grid: ['Cascade', 'Cascade'],
        sprout: ['Pousse', 'Sprout'],
        sunflower: ['Tournesol', 'Sunflower'],
        cactus: ['Cactus', 'Cactus'],
        mushroom: ['Champignon', 'Mushroom'],
        rocket: ['Fusée', 'Rocket'],
        balloon: ['Ballon', 'Balloon'],
        bulb: ['Ampoule', 'Light bulb'],
        alarm: ['Réveil', 'Alarm clock'],
        cup: ['Tasse', 'Cup'],
        bunny: ['Lapin', 'Bunny'],
        fish: ['Poisson', 'Fish'],
        snail: ['Escargot', 'Snail'],
        bee: ['Abeille', 'Bee'],
        cat: ['Chat', 'Cat'],
        jellyfish: ['Méduse', 'Jellyfish'],
        onigiri: ['Onigiri', 'Onigiri'],
        shuriken: ['Shuriken', 'Shuriken'],
        sakura: ['Sakura', 'Sakura'],
        ghost: ['Fantôme', 'Ghost'],
        anger: ['Colère', 'Anger']
      }
      const LD_PRESETS = named(LD_PRESETS_RAW.map((p) => ({ type: 'inline', source: 'preset', ...p })), LD_NAMES)

      // ── The ambiances: words per profession, in French and English ─────────
      // A form that reads after “… for 12s”: an action noun or a gerund.
      const LD_PACKS = [
        { id: 'dsh', orig: true, words: { fr: [], en: [] } },
        { id: 'mer', words: { fr: ['Plongée', 'Sondage', 'Cap sur la réponse', 'Remontée', 'Veille'], en: ['Diving', 'Sounding', 'Charting a course', 'Surfacing', 'Keeping watch'] } },
        { id: 'cuisine', words: { fr: ['Mijotage', 'Assaisonnement', 'Dressage', 'Émulsion', 'Réduction'], en: ['Cooking', 'Simmering', 'Seasoning', 'Plating', 'Reducing'] } },
        { id: 'atelier', words: { fr: ['Composition', 'Esquisse', 'Brouillon', 'Mise en page', 'Polissage'], en: ['Composing', 'Sketching', 'Drafting', 'Laying out', 'Polishing'] } },
        { id: 'architecture', words: { fr: ['Esquisse', 'Relevé', 'Étude de la lumière', 'Coupe et élévation', 'Calcul des structures'], en: ['Sketching', 'Surveying', 'Studying daylight', 'Drawing sections', 'Calculating structures'] } },
        { id: 'medecine', words: { fr: ['Examen', 'Anamnèse', 'Diagnostic différentiel', 'Recoupement des recommandations', 'Triage'], en: ['Examining', 'Taking the history', 'Weighing differentials', 'Cross-checking guidelines', 'Triaging'] } },
        { id: 'sante-mentale', words: { fr: ['Écoute active', 'Reformulation', 'Prise de recul', 'Repérage des ressources', 'Pas à pas'], en: ['Listening closely', 'Rephrasing', 'Stepping back', 'Mapping resources', 'Taking it step by step'] } },
        { id: 'ingenierie', words: { fr: ['Calcul des tolérances', 'Simulation', 'Dimensionnement', 'Vérification des charges', 'Mise au point'], en: ['Calculating tolerances', 'Simulating', 'Sizing', 'Checking loads', 'Fine-tuning'] } },
        { id: 'droit', words: { fr: ['Lecture de la jurisprudence', 'Rédaction des clauses', 'Recoupement des textes', 'Qualification des faits'], en: ['Reading case law', 'Drafting clauses', 'Cross-referencing statutes', 'Qualifying the facts'] } },
        { id: 'finance', words: { fr: ['Rapprochement', 'Audit', 'Prévision', 'Consolidation', 'Amortissement'], en: ['Reconciling', 'Auditing', 'Forecasting', 'Consolidating', 'Amortizing'] } },
        { id: 'science', words: { fr: ['Titrage', 'Séquençage', 'Contrôle témoin', 'Relecture par les pairs', 'Calibrage'], en: ['Titrating', 'Sequencing', 'Running controls', 'Peer-reviewing', 'Calibrating'] } },
        { id: 'education', words: { fr: ['Préparation du cours', 'Correction', 'Différenciation', 'Évaluation', 'Mise en séquence'], en: ['Planning the lesson', 'Marking', 'Differentiating', 'Assessing', 'Sequencing'] } }
      ]
      named(LD_PACKS, {
        dsh: ['DSH d’origine', 'DSH original'],
        mer: ['Mer', 'Sea'],
        cuisine: ['Cuisine', 'Kitchen'],
        atelier: ['Atelier créatif', 'Creative studio'],
        architecture: ['Architecture', 'Architecture'],
        medecine: ['Médecine', 'Medicine'],
        'sante-mentale': ['Santé mentale', 'Mental health'],
        ingenierie: ['Ingénierie', 'Engineering'],
        droit: ['Droit', 'Law'],
        finance: ['Finance', 'Finance'],
        science: ['Recherche', 'Research'],
        education: ['Éducation', 'Education']
      })

      // ── Le magasin ────────────────────────────────────────────────────────────
      const ld = { S: ldRead(), mine: [], words: [], subs: new Set(), hostState: 'unknown', pushTimer: null, ctx: null, started: false, pulled: false, mo: null, runs: new Set() }
      const ldNotify = () => { ld.subs.forEach((fn) => { try { fn() } catch (e) { /* a faulty subscriber does not cut off the others */ } }) }
      const ldById = (id) => LD_PRESETS.find((p) => p.id === id) || ld.mine.find((p) => p.id === id) || null
      const ldLang = () => kbLang()
      const ldHash = (str) => Array.from(String(str)).reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)
      const ldPackById = (id) => (id === 'perso' ? { id: 'perso', name: kt('Mon pack', 'My pack'), words: { fr: ld.words, en: ld.words } } : (LD_PACKS.find((p) => p.id === id) || LD_PACKS[0]))
      /** The words of the active ambiance, in the interface language. Empty = we leave DSH's text. */
      const ldWordList = (id) => {
        const p = ldPackById(id === undefined ? ld.S.pack : id)
        if (p.orig === true) return []
        const w = p.words[ldLang()]
        return Array.isArray(w) && w.length > 0 ? w : (p.words.en || [])
      }

      // The CHOSEN animations are kept in the browser (≤ 4 × 200 KB): without that, the
      // first answer after a reload would wait for the host to know what to draw.
      const ldCacheWrite = () => {
        try {
          const keep = ld.mine.filter((l) => ld.S.sel.indexOf(l.id) >= 0)
          localStorage.setItem(LD_CACHE, JSON.stringify({ loaders: keep, words: ld.words }))
        } catch (e) { /* quota: the host remains the reference */ }
      }
      const ldCacheRead = () => {
        try {
          const c = JSON.parse(localStorage.getItem(LD_CACHE))
          if (c !== null && typeof c === 'object') {
            if (Array.isArray(c.loaders)) ld.mine = c.loaders.filter(ldRecordOk)
            if (Array.isArray(c.words)) ld.words = c.words.filter((w) => typeof w === 'string')
          }
        } catch (e) { /* no cache */ }
      }
      const ldRecordOk = (l) => l !== null && typeof l === 'object' && typeof l.id === 'string' && LD_ID.test(l.id) && typeof l.name === 'string'
        && (l.type === 'svg' || l.type === 'lottie' || l.type === 'img') && l.data !== undefined && l.data !== null
      ldCacheRead()

      // ── The host: durable disk, optional ────────────────────────────────────
      const ldHostOn = () => { try { return window.__KB_THEME_HOST_STORE__ !== false } catch (e) { return true } }
      const ldHostUrl = () => { try { return new URL('kybernos-theme/loader-store', document.baseURI).pathname } catch (e) { return '/kybernos-theme/loader-store' } }
      const ldHost = async (body) => {
        if (!ldHostOn()) return { ok: false, unreachable: true, error: 'host store off' }
        try {
          const res = await fetch(ldHostUrl(), body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
          const j = await res.json().catch(() => null)
          return (j !== null && typeof j === 'object') ? j : { ok: false, unreachable: true, error: kt('réponse illisible', 'unreadable reply') }
        } catch (e) { return { ok: false, unreachable: true, error: String(e !== null && e.message ? e.message : e) } }
      }
      const ldSchedulePush = () => {
        if (!ldHostOn()) return
        if (ld.pushTimer !== null) clearTimeout(ld.pushTimer)
        ld.pushTimer = setTimeout(() => { ld.pushTimer = null; ldHost({ op: 'put-settings', settings: ld.S }) }, 700)
      }
      /** Reads the host. `quiet`: only wakes the page if something changed. */
      const ldPull = async (quiet) => {
        const j = await ldHost()
        const was = ld.hostState
        ld.hostState = j.ok === true ? 'on' : 'off'
        if (j.ok !== true) { if (was !== ld.hostState) ldNotify(); return false }
        const sig = () => JSON.stringify([ld.mine.map((l) => l.id), ld.words, ld.S])
        const before = sig()
        if (Array.isArray(j.loaders)) {
          const local = ld.mine.filter((l) => l.local === true && !j.loaders.some((x) => x.id === l.id))
          ld.mine = j.loaders.filter(ldRecordOk).concat(local)
        }
        if (Array.isArray(j.words)) ld.words = j.words.filter((w) => typeof w === 'string')
        if (j.settings !== null && typeof j.settings === 'object' && typeof j.settings.updatedAt === 'number' && j.settings.updatedAt > ld.S.updatedAt) { ld.S = ldClean(j.settings); ldWrite(ld.S) }
        else if ((j.settings === null || j.settings === undefined) && ld.S.updatedAt > 0 && ld.pulled === false) ldSchedulePush() // first pass: the host has nothing, we give it what the browser knows
        ld.pulled = true
        ldCacheWrite()
        if (quiet !== true || sig() !== before || was !== ld.hostState) ldNotify()
        return true
      }
      /** Changes settings: browser first (immediate), disk afterwards (deferred). */
      const ldSet = (patch) => {
        ld.S = ldClean({ ...ld.S, ...patch, updatedAt: Date.now() })
        ldWrite(ld.S); ldCacheWrite(); ldNotify(); ldSchedulePush()
      }
      /** Returns { ok, local?, error?, loader? }. A host that REFUSES the file (it saw a defect in it): nothing is
       *  kept. An UNREACHABLE host: the file stays in this browser until reload (`local`). */
      const ldAddRecord = async (rec) => {
        const j = await ldHost({ op: 'put-loader', loader: rec })
        if (j.ok !== true && j.unreachable !== true) return { ok: false, error: j.error }
        const local = j.ok !== true
        const saved = local ? { ...rec, local: true, size: typeof rec.data === 'string' ? rec.data.length : JSON.stringify(rec.data).length, createdAt: Date.now() }
          : (j.loader !== undefined && ldRecordOk(j.loader) ? j.loader : rec)
        ld.mine = [saved].concat(ld.mine.filter((x) => x.id !== saved.id))
        ldCacheWrite(); ldNotify()
        return { ok: true, local, loader: saved }
      }
      const ldDelRecord = async (id) => {
        ld.mine = ld.mine.filter((x) => x.id !== id)
        if (ld.S.sel.indexOf(id) >= 0) ldSet({ sel: ld.S.sel.filter((x) => x !== id) })
        ldCacheWrite(); ldNotify()
        return ldHost({ op: 'delete-loader', id })
      }
      const ldPutWords = async (words) => {
        const clean = words.map((w) => String(w).trim().slice(0, 40)).filter((w, i, a) => w !== '' && a.findIndex((x) => x.toLowerCase() === w.toLowerCase()) === i).slice(0, 40)
        ld.words = clean
        if (clean.length === 0 && ld.S.pack === 'perso') ldSet({ pack: 'dsh' }); else { ldCacheWrite(); ldNotify() }
        const j = await ldHost({ op: 'put-words', words: clean })
        return j
      }

      // ── The drawing of an animation ─────────────────────────────────────────────
      const ldReduced = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.getAttribute('data-kbth-reduced') === '1' } catch (e) { return false } }
      let ldLottiePromise = null
      const ldLottieLib = () => {
        if (typeof window.lottie !== 'undefined') return Promise.resolve(window.lottie)
        if (ldLottiePromise === null) {
          ldLottiePromise = new Promise((resolve, reject) => {
            const s = document.createElement('script')
            try { s.src = new URL('kybernos-theme/vendor/lottie.js', document.baseURI).pathname + '?v=5.12.2' } catch (e) { s.src = '/kybernos-theme/vendor/lottie.js?v=5.12.2' }
            s.async = true
            s.onload = () => { if (typeof window.lottie !== 'undefined') resolve(window.lottie); else { ldLottiePromise = null; reject(new Error('lottie missing')) } }
            s.onerror = () => { ldLottiePromise = null; reject(new Error('lottie unavailable')) }
            document.head.appendChild(s)
          })
        }
        return ldLottiePromise
      }
      /** A DOM node ready to be placed. Imported content is NEVER injected as HTML:
       *  an SVG goes through <img> or a CSS mask (no script runs in it), a Lottie through
       *  its engine, only the catalogue drawings (our own strings) are inline. */
      const ldNode = (l, px) => {
        const span = document.createElement('span')
        span.className = 'kb-ld'
        span.setAttribute('data-kind', l.kind === 'mono' ? 'mono' : 'color')
        span.style.setProperty('--kb-px', px + 'px')
        if (l.type === 'inline') {
          span.innerHTML = l.svg
        } else if (l.type === 'svg') {
          const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(String(l.data))
          if (l.kind === 'mono') {
            span.classList.add('kb-ld-mask')
            span.style.setProperty('-webkit-mask-image', 'url("' + url + '")')
            span.style.setProperty('mask-image', 'url("' + url + '")')
          } else {
            const img = document.createElement('img'); img.alt = ''; img.src = url; span.appendChild(img)
          }
        } else if (l.type === 'img') {
          const img = document.createElement('img'); img.alt = ''; img.src = String(l.data); span.appendChild(img)
        } else if (l.type === 'lottie') {
          ldLottieLib().then((lot) => {
            try { span.__kbAnim = lot.loadAnimation({ container: span, renderer: 'svg', loop: true, autoplay: !ldReduced(), animationData: JSON.parse(JSON.stringify(l.data)) }) } catch (e) { /* animation illisible */ }
          }).catch(() => { /* moteur indisponible : l'emplacement reste vide */ })
        }
        return span
      }
      const ldDestroy = (node) => { try { if (node !== null && node !== undefined && node.__kbAnim) node.__kbAnim.destroy() } catch (e) { /* already destroyed */ } }

      // ── Le tirage ─────────────────────────────────────────────────────────────
      /** `memo` keeps the last draw: { last, idx }. Mutated. */
      const ldChoose = (memo) => {
        const sel = ld.S.sel.map(ldById).filter((x) => x !== null)
        if (sel.length === 0) return null
        let c
        if (ld.S.mode === 'order') { memo.idx = ((memo.idx === undefined ? -1 : memo.idx) + 1) % sel.length; c = sel[memo.idx] }
        else {
          c = sel[Math.floor(Math.random() * sel.length)]
          let g = 0
          while (sel.length > 1 && ld.S.avoid && c.id === memo.last && g++ < 30) c = sel[Math.floor(Math.random() * sel.length)]
        }
        memo.last = c.id
        return c
      }
      const ldChooseWord = (memo, packId) => {
        const w = ldWordList(packId)
        if (w.length === 0) return null
        let x = w[Math.floor(Math.random() * w.length)]
        let g = 0
        while (w.length > 1 && x === memo.word && g++ < 30) x = w[Math.floor(Math.random() * w.length)]
        memo.word = x
        return x
      }

      // ── The status at the bottom, in the real page ──────────────────────────────
      const ldTurn = { loader: null, word: null, t0: 0, lastSeen: 0, memo: {}, wmemo: {} }
      const ldBase = () => { try { return String(ld.ctx.locale.bind('chat')('chat.deepDiving')) } catch (e) { return '' } }
      /** DSH writes the text TWICE: a text node (the base) and, in the luminous copy that sweeps
       *  the word, a `data-shimmer-text` attribute that the CSS displays (`::after`). Without the second, the
       *  shimmer would paint “Deep diving” back over our word. */
      const ldApplyText = (run) => {
        if (run.word === null || run.word === undefined) return
        const base = ldBase()
        if (base === '' || run.word.indexOf(base) >= 0) return
        const swap = (v) => { const i = v.indexOf(base); return i < 0 ? null : (ld.S.dur ? v.slice(0, i) + run.word + v.slice(i + base.length) : run.word + ' ···') }
        let walker = null
        try { walker = document.createTreeWalker(run.shim, NodeFilter.SHOW_TEXT) } catch (e) { return }
        let n = walker.nextNode()
        while (n !== null) {
          const r = n.nodeValue === null ? null : swap(n.nodeValue)
          if (r !== null) n.nodeValue = r
          n = walker.nextNode()
        }
        const copies = run.shim.querySelectorAll('[data-shimmer-text]')
        for (let i = 0; i < copies.length; i += 1) {
          const v = copies[i].getAttribute('data-shimmer-text')
          const r = v === null ? null : swap(v)
          if (r !== null) copies[i].setAttribute('data-shimmer-text', r)
        }
      }
      const ldRelease = (run) => {
        try { if (run.mo !== null) run.mo.disconnect() } catch (e) { /* already detached */ }
        if (run.timer !== null) clearInterval(run.timer)
        ldDestroy(run.node)
        run.mo = null; run.timer = null
        ld.runs.delete(run)
      }
      const ldDecorate = (el) => {
        if (el.__kbLd === true) return
        const shim = el.querySelector('[data-shimmer]')
        const content = shim === null ? null : shim.parentElement
        if (shim === null || content === null || content === undefined) return // structure inconnue : on laisse DSH tranquille
        el.__kbLd = true
        const now = Date.now()
        if (now - ldTurn.lastSeen > 1500) { // a NEW answer (the block is remounted identically in the middle of an answer)
          ldTurn.loader = ldChoose(ldTurn.memo)
          ldTurn.word = ldChooseWord(ldTurn.wmemo)
          ldTurn.t0 = now
        }
        ldTurn.lastSeen = now
        const run = { el, shim, content, word: ldTurn.word, loader: ldTurn.loader, node: null, icon: null, mo: null, timer: null, t0: ldTurn.t0, idx: 0 }
        if (run.loader !== null) {
          const node = ldNode(run.loader, LD_SIZES[ld.S.size] || 24)
          node.setAttribute('data-kb-ld-run', '1')
          node.style.setProperty('--kb-spd', String(ld.S.speed))
          let accentSet = false
          try { accentSet = readState().acc !== null } catch (e) { accentSet = false }
          if (ld.S.tint && accentSet) node.style.setProperty('--kb-tint', 'var(--dsw-alias-brand-primary)')
          if (ld.S.delay > 0) { node.classList.add('kb-late'); node.style.setProperty('--kb-late', ld.S.delay + 'ms') }
          const first = content.firstElementChild
          const icon = first !== null && first !== shim ? first : null
          content.insertBefore(node, content.firstChild)
          if (icon !== null) icon.setAttribute('data-kb-ld-hide', '1')
          run.node = node; run.icon = icon
        }
        if (!ld.S.keep) el.setAttribute('data-kb-ld-notext', '1')
        ld.runs.add(run)
        ldApplyText(run)
        try {
          run.mo = new MutationObserver(() => { ldApplyText(run); try { run.mo.takeRecords() } catch (e) { /* rien */ } })
          run.mo.observe(shim, { subtree: true, characterData: true, childList: true, attributes: true, attributeFilter: ['data-shimmer-text'] })
        } catch (e) { run.mo = null }
        run.timer = setInterval(() => {
          if (!el.isConnected) { ldRelease(run); return }
          ldTurn.lastSeen = Date.now()
          if (ld.S.rot !== 'fixed' && run.word !== null) {
            const step = ld.S.rot === '8' ? 8000 : 15000
            const idx = Math.floor((Date.now() - run.t0) / step)
            if (idx !== run.idx) { run.idx = idx; run.word = ldChooseWord(ldTurn.wmemo); ldTurn.word = run.word } // DSH rewrites the text every second: the new word shows at the next tick
          }
        }, 1000)
      }
      /** Stops everything and gives DSH its icon back: the plugin can be disabled on the fly. */
      const ldStop = () => {
        try { if (ld.mo !== null) ld.mo.disconnect() } catch (e) { /* already detached */ }
        ld.mo = null
        Array.from(ld.runs).forEach((run) => {
          ldRelease(run)
          try {
            if (run.node !== null && run.node.parentNode) run.node.parentNode.removeChild(run.node)
            if (run.icon !== null) run.icon.removeAttribute('data-kb-ld-hide')
            run.el.removeAttribute('data-kb-ld-notext')
            run.el.__kbLd = false
          } catch (e) { /* the block has already gone */ }
        })
        ld.started = false
      }
      /** Watches the page: each `[data-chat-running]` that appears is decorated. Returns the disposer. */
      const ldStart = (ctx) => {
        ld.ctx = ctx
        if (ld.started) return ldStop
        ld.started = true
        const scan = (root) => {
          try {
            if (root.nodeType !== 1) return
            if (root.matches('[data-chat-running]')) ldDecorate(root)
            root.querySelectorAll('[data-chat-running]').forEach(ldDecorate)
          } catch (e) { /* an error here must never reach DSH */ }
        }
        const go = () => {
          try {
            ld.mo = new MutationObserver((recs) => { for (const r of recs) for (const n of r.addedNodes) scan(n) })
            ld.mo.observe(document.body, { childList: true, subtree: true })
            scan(document.body)
          } catch (e) { /* hors navigateur */ }
        }
        if (document.body) go(); else document.addEventListener('DOMContentLoaded', go, { once: true })
        setTimeout(() => { ldPull(false) }, 800)
        return ldStop
      }

      // ══════════════════════════════════════════════════════════════════════
      // 4c. THEME LIBRARY ("My themes").
      //
      //   A preset is DATA: a name plus the settings it retains, in groups so that the person
      //   chooses what travels with it (colours, font, corners, glass and wallpaper,
      //   accessibility). Accessibility is off by default when saving: contrast, the
      //   colour-blind palette and big targets are a need of the person, not a style.
      //   Nothing in a preset is ever executed, and the only values it can carry are the ones
      //   `sanitiserImport` accepts: known keys, valid types and ranges, fonts and wallpapers
      //   that already ship with this plugin.
      //
      //   Two copies, like the thinking-animation settings: the browser (`kybernos.theme.presets.v1`,
      //   what paints first) and the DSH disk (/kybernos-theme/preset-store, see preset-store.mjs,
      //   what survives clearing site data or DSH Desktop picking another port). The library is
      //   ONE document: the newer `updatedAt` wins as a whole, so a deletion cannot come back.
      // ══════════════════════════════════════════════════════════════════════

      const PRESET_FORMAT = 'kybernos-theme-preset'
      /** What a theme may retain. Mirrored by SETTINGS_KEYS in preset-store.mjs (test-client.mjs fails when they drift). */
      const PRESET_GROUPS = {
        colors: ['mode', 'acc', 'ov', 'sideTone'],
        font: ['fontText', 'ligatures'],
        radius: ['radius', 'shadow', 'glow'],
        icons: ['iconSet'],
        chat: ['bubbleUser', 'textUser', 'replyBg', 'replyColor', 'textReply'],
        glass: ['wp', 'wpVis', 'wpBlur', 'tint', 'glassEffect', 'glassBlur', 'sidebarLinked', 'sidebarOpacity', 'fieldOpacity', 'floatOpacity', 'bgBrightness', 'bgContrast', 'bgSaturation', 'bgDarken', 'bgFit', 'bgMirror'],
        a11y: ['contrastMode', 'cbSafe', 'reduceMotion', 'focusRing', 'largeTargets', 'underlineLinks']
      }
      const PRESET_GROUP_NAMES = {
        colors: ['Couleurs et accent', 'Colors and accent'],
        font: ['Police', 'Font'],
        radius: ['Coins et ombres', 'Corners and shadows'],
        icons: ['Icônes du menu', 'Menu icons'],
        chat: ['Bulles et réponses', 'Bubbles and replies'],
        glass: ['Verre et fond d’écran', 'Glass and wallpaper'],
        a11y: ['Accessibilité', 'Accessibility']
      }
      /** The label of a group of a theme, in the language of the page. */
      const groupLabel = (g) => kt(PRESET_GROUP_NAMES[g][0], PRESET_GROUP_NAMES[g][1])
      const PRESET_KEYS = Object.keys(PRESET_GROUPS).reduce((all, g) => all.concat(PRESET_GROUPS[g]), [])
      const PRESET_LIMIT = 100
      const PRESET_NAME_MAX = 40
      const PRESET_ID = /^[a-z0-9][a-z0-9-]{0,63}$/
      const PRESET_SOURCES = ['me', 'file', 'gallery']
      const PRESET_FILE_MAX = 200 * 1024
      const LIB_KEY = 'kybernos.theme.presets.v1'

      /** The settings of a theme out of any object: only the keys a theme may carry, only valid values. null when nothing is left. */
      const presetSettings = (raw) => {
        const s = sanitiserImport(raw)
        if (s === null) return null
        const out = {}
        PRESET_KEYS.forEach((k) => { if (s[k] !== undefined) out[k] = s[k] })
        return Object.keys(out).length > 0 ? out : null
      }
      const presetName = (raw) => (typeof raw === 'string'
        ? raw.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, PRESET_NAME_MAX) : '')
      /** One library record, or null. The same shape check as the host's (preset-store.mjs), plus the meaning of the values. */
      const presetRecord = (raw) => {
        if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
        if (typeof raw.id !== 'string' || !PRESET_ID.test(raw.id)) return null
        const name = presetName(raw.name)
        const settings = presetSettings(raw.settings)
        if (name === '' || settings === null) return null
        const rec = {
          id: raw.id, name, settings,
          source: PRESET_SOURCES.indexOf(raw.source) >= 0 ? raw.source : 'file',
          at: typeof raw.at === 'number' && Number.isFinite(raw.at) ? Math.max(0, Math.round(raw.at)) : 0
        }
        if (typeof raw.author === 'string' && raw.author.trim() !== '') rec.author = raw.author.trim().slice(0, 60)
        if (typeof raw.gid === 'string' && PRESET_ID.test(raw.gid)) rec.gid = raw.gid
        if (Number.isInteger(raw.v) && raw.v >= 0 && raw.v <= 1000000) rec.v = raw.v
        return rec
      }

      const lib = { presets: [], updatedAt: 0, hostState: 'unknown', pulled: false, pushTimer: null, subs: new Set() }
      const libNotify = () => { lib.subs.forEach((f) => { try { f() } catch (e) { /* a page that is gone */ } }) }
      /** A library document (from the browser or the host), always put back in the expected shape. */
      const libClean = (raw) => {
        const r = (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {}
        const seen = new Set()
        const presets = []
        ;(Array.isArray(r.presets) ? r.presets : []).forEach((p) => {
          const rec = presetRecord(p)
          if (rec !== null && !seen.has(rec.id) && presets.length < PRESET_LIMIT) { seen.add(rec.id); presets.push(rec) }
        })
        return { presets, updatedAt: typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt) ? Math.max(0, Math.round(r.updatedAt)) : 0 }
      }
      const libRead = () => {
        try {
          const raw = localStorage.getItem(LIB_KEY)
          const c = libClean(raw === null ? {} : JSON.parse(raw))
          lib.presets = c.presets; lib.updatedAt = c.updatedAt
        } catch (e) { lib.presets = []; lib.updatedAt = 0 }
      }
      const libWrite = () => { try { localStorage.setItem(LIB_KEY, JSON.stringify({ v: 1, updatedAt: lib.updatedAt, presets: lib.presets })) } catch (e) { /* quota */ } }
      libRead()

      const libHostUrl = () => { try { return new URL('kybernos-theme/preset-store', document.baseURI).pathname } catch (e) { return '/kybernos-theme/preset-store' } }
      const libHost = async (body) => {
        if (!ldHostOn()) return { ok: false, unreachable: true, error: 'host store off' }
        try {
          const res = await fetch(libHostUrl(), body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
          const j = await res.json().catch(() => null)
          return (j !== null && typeof j === 'object') ? j : { ok: false, unreachable: true, error: 'unreadable answer' }
        } catch (e) { return { ok: false, unreachable: true, error: String(e !== null && e.message ? e.message : e) } }
      }
      const libSchedulePush = () => {
        if (!ldHostOn()) return
        if (lib.pushTimer !== null) clearTimeout(lib.pushTimer)
        lib.pushTimer = setTimeout(() => {
          lib.pushTimer = null
          libHost({ library: { v: 1, updatedAt: lib.updatedAt, presets: lib.presets } }).then((j) => {
            const state = j.ok === true ? 'on' : 'off'
            if (state !== lib.hostState) { lib.hostState = state; libNotify() }
          })
        }, 700)
      }
      /** Reads the disk copy. The newer document wins; `quiet`: only wake the page when something changed. */
      const libPull = async (quiet) => {
        const j = await libHost()
        const was = lib.hostState
        lib.hostState = j.ok === true ? 'on' : 'off'
        if (j.ok !== true) { if (was !== lib.hostState) libNotify(); return false }
        const sig = () => JSON.stringify([lib.updatedAt, lib.presets.map((p) => p.id + p.name)])
        const before = sig()
        if (j.library !== null && j.library !== undefined) {
          const c = libClean(j.library)
          if (c.updatedAt > lib.updatedAt) { lib.presets = c.presets; lib.updatedAt = c.updatedAt; libWrite() }
          else if (c.updatedAt < lib.updatedAt) libSchedulePush()
        } else if (lib.updatedAt > 0) libSchedulePush() // the disk has nothing yet: give it what this browser knows
        lib.pulled = true
        if (quiet !== true || sig() !== before || was !== lib.hostState) libNotify()
        return true
      }
      /** Replaces the whole library: browser first (immediate), disk after (deferred). */
      const libSet = (presets) => {
        lib.presets = presets.slice(0, PRESET_LIMIT)
        lib.updatedAt = Math.max(Date.now(), lib.updatedAt + 1)
        libWrite(); libNotify(); libSchedulePush()
      }

      const presetId = (prefix) => prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
      const libNameTaken = (name, exceptId) => {
        const k = name.trim().toLowerCase()
        return SKINS.some((s) => s.name.toLowerCase() === k) || lib.presets.some((p) => p.id !== exceptId && p.name.toLowerCase() === k)
      }
      /** `name`, or `name (2)`, `name (3)`... when it is already taken by a shipped theme or one of yours. */
      const libFreeName = (name) => {
        const base = presetName(name) || kt('Thème', 'Theme')
        let n = base
        for (let i = 2; libNameTaken(n); i += 1) n = base.slice(0, PRESET_NAME_MAX - String(i).length - 3).trim() + ' (' + i + ')'
        return n
      }
      /** Adds a theme at the end of the library. Returns the record, or null (empty settings, full library). */
      const libAdd = (name, source, settings, extra) => {
        if (lib.presets.length >= PRESET_LIMIT) return null
        const rec = presetRecord({ ...(extra || {}), id: presetId(source === 'gallery' ? 'g' : 'u'), name: libFreeName(name), source, at: Date.now(), settings })
        if (rec === null) return null
        libSet(lib.presets.concat([rec]))
        return rec
      }
      /** Changes one theme. The result goes through the same check as a new one (accent lowercased, nothing unknown kept); a change that would leave nothing valid is ignored. */
      const libPatch = (id, patch) => {
        libSet(lib.presets.map((p) => (p.id === id ? (presetRecord({ ...p, ...patch, at: Date.now() }) || p) : p)))
      }
      const libRemove = (id) => { libSet(lib.presets.filter((p) => p.id !== id)) }

      /** What the person chose to keep, out of the current look. Colours always travel. */
      const presetFromState = (S, groups) => {
        const out = {}
        Object.keys(PRESET_GROUPS).forEach((g) => {
          if (g !== 'colors' && !(groups && groups[g] === true)) return
          PRESET_GROUPS[g].forEach((k) => { if (S[k] !== undefined) out[k] = k === 'ov' ? { ...S.ov } : S[k] })
        })
        return out
      }
      /** The file for one theme. */
      const presetFile = (rec) => {
        const doc = { format: PRESET_FORMAT, version: 1, name: rec.name }
        if (rec.author !== undefined) doc.author = rec.author
        doc.settings = rec.settings
        return JSON.stringify(doc, null, 2)
      }
      /** The text of a file → { ok, name, settings, legacy } or { ok:false, error }. An old export (the whole look, no frame) still imports: as a theme. */
      const presetFromFileText = (text) => {
        if (typeof text !== 'string' || text.length === 0 || text.length > PRESET_FILE_MAX) return { ok: false, error: 'size' }
        let raw = null
        try { raw = JSON.parse(text) } catch (e) { return { ok: false, error: 'json' } }
        if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'shape' }
        const framed = raw.format === PRESET_FORMAT
        const settings = presetSettings(framed ? raw.settings : raw)
        if (settings === null) return { ok: false, error: 'empty' }
        const name = framed ? presetName(raw.name) : ''
        return { ok: true, name: name === '' ? kt('Thème importé', 'Imported theme') : name, settings, legacy: !framed, author: framed && typeof raw.author === 'string' ? raw.author : undefined }
      }

      // “Modified” = a setting this theme retains has moved. The mode is left out on purpose: DSH's own
      // light/dark button changes it from elsewhere, and that is not editing the theme.
      const settingText = (v) => JSON.stringify(v !== null && typeof v === 'object' ? Object.keys(v).sort().map((k) => [k, v[k]]) : v).toLowerCase()
      const settingsDirty = (S, settings) => Object.keys(settings).some((k) => k !== 'mode' && settingText(S[k]) !== settingText(settings[k]))
      /** What a shipped theme sets, in the same shape as a library theme's settings. */
      const skinSettings = (sk) => { const p = skinPatch(sk); delete p.skin; return p }
      /** A library theme drawn like a shipped one (dot, accent, meta line). */
      const presetAsSkin = (rec) => ({
        id: rec.id, name: rec.name,
        mode: rec.settings.mode === 'light' || rec.settings.mode === 'dark' ? rec.settings.mode : null,
        acc: rec.settings.acc === undefined ? null : rec.settings.acc, ov: rec.settings.ov || {},
        fontText: rec.settings.fontText, radius: rec.settings.radius, iconSet: rec.settings.iconSet
      })
      const RADIUS_LABEL = { sharp: ['coins nets', 'sharp corners'], standard: ['coins standard', 'standard corners'], soft: ['coins doux', 'soft corners'] }
      /** The groups a set of settings retains: { colors: true, font: false, ... }. */
      const groupsOf = (settings) => {
        const g = {}
        Object.keys(PRESET_GROUPS).forEach((k) => { g[k] = PRESET_GROUPS[k].some((key) => settings[key] !== undefined) })
        return g
      }
      const downloadText = (filename, text) => {
        try {
          const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
          const a = document.createElement('a')
          a.href = url; a.download = filename
          document.body.appendChild(a); a.click(); a.remove()
          setTimeout(() => { try { URL.revokeObjectURL(url) } catch (e) { /* already revoked */ } }, 1000)
          return true
        } catch (e) { return false }
      }
      const fileSlug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'theme'

      // ══════════════════════════════════════════════════════════════════════
      // 4d. THEME GALLERY.
      //
      //   Themes to install, from a catalogue that is read by the HOST (route /kybernos-theme/gallery,
      //   see themes-gallery.mjs): the catalogue shipped with Kybernos, or the signed online one once it
      //   has been verified and cached. The page never sees an unverified catalogue, and it checks what
      //   it is given anyway: a theme is data, so a catalogue theme goes through the same check as a file
      //   (`presetSettings`) and never carries accessibility settings.
      //   Installing puts a copy in “My themes” (source “gallery”, with its catalogue id and version);
      //   from then on it is yours, and the gallery only offers an update when its version moves.
      // ══════════════════════════════════════════════════════════════════════

      const gal = { data: null, state: 'idle', refreshing: false, refreshed: false, subs: new Set() }
      const galNotify = () => { gal.subs.forEach((f) => { try { f() } catch (e) { /* a page that is gone */ } }) }
      const galHostUrl = () => { try { return new URL('kybernos-theme/gallery', document.baseURI).pathname } catch (e) { return '/kybernos-theme/gallery' } }
      const galHost = async (body) => {
        if (!ldHostOn()) return { ok: false, unreachable: true, error: 'host store off' }
        try {
          const res = await fetch(galHostUrl(), body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
          const j = await res.json().catch(() => null)
          return (j !== null && typeof j === 'object') ? j : { ok: false, unreachable: true, error: 'unreadable answer' }
        } catch (e) { return { ok: false, unreachable: true, error: String(e !== null && e.message ? e.message : e) } }
      }
      /** The language of the interface, « fr » or « en »: French for the French of the product, English for every other language. */
      const kbLang = () => { const l = lang(); return l === 'kybernos' || l.slice(0, 2) === 'fr' ? 'fr' : 'en' }
      /** One catalogue theme as the page uses it, or null. Checked again here: the host is not trusted any more than a file is. */
      // The names of the themes of the shipped gallery are French words chosen by their author; the page says them in English too
      // (any other id keeps the name it carries).
      const GAL_NAMES = {
        calcaire: ['Calcaire', 'Limestone'], composition: ['Composition', 'Composition'], 'console-verte': ['Console verte', 'Green console'],
        crepuscule: ['Crépuscule', 'Twilight'], egaliseur: ['Égaliseur', 'Equalizer'], 'encre-papier': ['Encre & papier', 'Ink & paper'],
        graphite: ['Graphite', 'Graphite'], kawaii: ['Kawaii', 'Kawaii'], 'lavande-brumeuse': ['Lavande brumeuse', 'Misty lavender'],
        maquette: ['Maquette', 'Mock-up'], 'ocean-nuit': ['Océan nuit', 'Night ocean'], orbite: ['Orbite', 'Orbit'],
        panneau: ['Panneau', 'LED panel'], sakura: ['Sakura', 'Sakura'], 'neutre-violet': ['Neutre violet', 'Neutral violet']
      }
      const galTheme = (raw) => {
        if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
        if (typeof raw.id !== 'string' || !PRESET_ID.test(raw.id)) return null
        const name = presetName(raw.name)
        const settings = presetSettings(raw.settings)
        if (name === '' || settings === null) return null
        PRESET_GROUPS.a11y.forEach((k) => { delete settings[k] }) // a catalogue never touches accessibility
        if (Object.keys(settings).length === 0) return null
        const d = (raw.description !== null && typeof raw.description === 'object') ? raw.description : {}
        const loc = GAL_NAMES[raw.id]
        return {
          id: raw.id, get name () { return loc !== undefined && loc[0] === name ? kt(loc[0], loc[1]) : name }, settings,
          v: Number.isInteger(raw.v) && raw.v >= 1 && raw.v <= 1000000 ? raw.v : 1,
          author: typeof raw.author === 'string' ? presetName(raw.author) : '',
          description: { fr: typeof d.fr === 'string' ? d.fr.slice(0, 200) : '', en: typeof d.en === 'string' ? d.en.slice(0, 200) : '' }
        }
      }
      /** The host's answer, put in the shape the page uses; null when it is not one. */
      const galClean = (j) => {
        if (j === null || typeof j !== 'object' || j.ok !== true || !Array.isArray(j.themes)) return null
        const o = (j.online !== null && typeof j.online === 'object') ? j.online : {}
        const seen = new Set()
        const themes = []
        j.themes.forEach((t) => { const g = galTheme(t); if (g !== null && !seen.has(g.id) && themes.length < 200) { seen.add(g.id); themes.push(g) } })
        return {
          source: j.source === 'signed' ? 'signed' : 'shipped',
          publishedAt: typeof j.publishedAt === 'string' ? j.publishedAt.slice(0, 40) : '',
          themes,
          online: {
            state: ['never', 'ok', 'offline', 'refused', 'off'].indexOf(o.state) >= 0 ? o.state : 'never',
            reason: typeof o.reason === 'string' ? o.reason.slice(0, 40) : null
          }
        }
      }
      const galLoad = async () => {
        gal.state = 'loading'; galNotify()
        const c = galClean(await galHost())
        if (c === null) gal.state = 'error'; else { gal.data = c; gal.state = 'ready' }
        galNotify()
        return gal.state === 'ready'
      }
      /** Asks the online catalogue (through the host, which verifies it). Once per page session unless asked again. */
      const galRefresh = async () => {
        if (gal.refreshing) return
        gal.refreshing = true; gal.refreshed = true; galNotify()
        const c = galClean(await galHost({ op: 'refresh' }))
        if (c !== null) { gal.data = c; gal.state = 'ready' }
        gal.refreshing = false; galNotify()
      }
      const galInstalled = (id) => lib.presets.find((p) => p.gid === id) || null
      const galInstall = (t) => libAdd(t.name, 'gallery', t.settings, { author: t.author, gid: t.id, v: t.v })
      const galUpdate = (t, rec) => libPatch(rec.id, { settings: t.settings, v: t.v, author: t.author })
      const galAsSkin = (t) => ({
        id: t.id, name: t.name,
        mode: t.settings.mode === 'light' || t.settings.mode === 'dark' ? t.settings.mode : null,
        acc: t.settings.acc === undefined ? null : t.settings.acc, ov: t.settings.ov || {},
        fontText: t.settings.fontText, radius: t.settings.radius, iconSet: t.settings.iconSet
      })
      const galOnlineText = (o) => {
        if (o.state === 'offline') return kt('Le catalogue en ligne est injoignable : ce sont les thèmes livrés avec Kybernos.', 'The online catalog cannot be reached: these are the themes shipped with Kybernos.')
        if (o.state === 'off') return kt('Le catalogue en ligne est désactivé : ce sont les thèmes livrés avec Kybernos.', 'The online catalog is turned off: these are the themes shipped with Kybernos.')
        if (o.state === 'refused') {
          if (o.reason === 'no-key') return kt('Le catalogue en ligne n’est pas encore activé : ce sont les thèmes livrés avec Kybernos.', 'The online catalog is not active yet: these are the themes shipped with Kybernos.')
          const WHY = {
            signature: () => kt('sa signature n’est pas reconnue', 'its signature is not recognized'),
            older: () => kt('il est plus ancien que celui déjà connu', 'it is older than the one already known'),
            malformed: () => kt('il est mal formé', 'it is malformed'),
            size: () => kt('il est trop gros', 'it is too large')
          }
          const key = o.reason === 'shape' || o.reason === 'theme' || o.reason === 'json' ? 'malformed' : o.reason
          const why = WHY[key] === undefined ? undefined : WHY[key]()
          return kt('Le catalogue en ligne a été refusé' + (why === undefined ? '' : ' (' + why + ')') + ' : ce sont les thèmes déjà connus qui s’affichent.',
            'The online catalog was refused' + (why === undefined ? '' : ' (' + why + ')') + ': the themes already known are shown.')
        }
        return ''
      }

      // ══════════════════════════════════════════════════════════════════════
      // 5. THE SETTINGS PAGE.
      // ══════════════════════════════════════════════════════════════════════

      const css = `
/* ── Borders of the light scheme ──────────────────────────────────────────
   DSH's official sheet sets alias-border-l1 to 4 % black (#0000000a)
   in light: invisible on a white background, cards and panels lose their
   hairline (Marketplace, teams, etc.). We raise it to 8 % on body WITHOUT
   the dark attribute — specificity 0,1,1 > 0,0,1, the rule wins whatever
   the order of the sheets, and never touches dark (#ffffff0f is still
   readable there). Deliberately ALWAYS on, even in the native
   configuration: the faulty value is DSH's, not a skin's. */
body:not([data-ds-dark-theme]) { --dsw-alias-border-l1: #00000014; }
/* ── Hide DSH's native "Theme / 外观" section from the sidebar ─────────── */
[data-slot="settings.section"][data-id="theme"],
[role="dialog"] nav [data-id="theme"] { display: none !important; }
/* Force the slot's parent container to take the whole available width,
   otherwise the 2-column grid never has enough room. */
[data-slot="settings.section"]:has(.kbth-page) { width: 100%; max-width: none; }

/* A single column: the side preview was removed (it was of no use). */
.kbth-page{display:grid;grid-template-columns:1fr;gap:22px;max-width:720px;align-items:start}
.kbth-main{display:flex;flex-direction:column;gap:22px;min-width:0}
.kbth-head{display:flex;flex-direction:column;gap:6px}
.kbth-title{font-size:26px;line-height:32px;font-weight:800;letter-spacing:-.01em;color:var(--dsw-alias-label-primary)}
.kbth-sub{font-size:14px;line-height:1.55;color:var(--dsw-alias-label-secondary);max-width:640px}
.kbth-seg{display:inline-flex;gap:2px;padding:3px;border-radius:11px;background:var(--dsw-alias-bg-layer-2);width:max-content}
/* (29/09, on request) Simple/Advanced selector (and Mode) CLEARER: 14px,
   generous padding, active state in the brand colour — nobody has to look
   for the active segment in a grey background any more. */
.kbth-seg button{appearance:none;border:1px solid transparent;font:inherit;font-size:14px;font-weight:500;padding:8px 18px;border-radius:9px;cursor:pointer;background:transparent;color:var(--dsw-alias-label-secondary);transition:background .12s,color .12s,border-color .12s}
.kbth-seg button:hover:not([aria-pressed="true"]){background:var(--dsw-alias-interactive-bg-hover)}
.kbth-modes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
.kbth-mode{display:flex;flex-direction:column;gap:12px;padding:12px;border-radius:14px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;text-align:start;cursor:pointer}
.kbth-mode:hover{border-color:var(--dsw-alias-border-l4)}
.kbth-mode.on{border-color:var(--dsw-alias-brand-primary)}
.kbth-mode-pv{display:flex;height:64px;border-radius:10px;overflow:hidden;align-items:center;justify-content:center}
.kbth-mode-pv i{display:block;width:60%;height:10px;border-radius:5px}
.kbth-mode-light{background:var(--dsw-static-neutral-50)}
.kbth-mode-light i{background:var(--dsw-static-neutral-900);opacity:.25}
.kbth-mode-dark{background:var(--dsw-static-neutral-1000)}
.kbth-mode-dark i{background:var(--dsw-static-neutral-100);opacity:.25}
.kbth-mode-pv-light{background:var(--dsw-static-neutral-50)}
.kbth-mode-pv-light i{background:var(--dsw-static-neutral-900);opacity:.25}
.kbth-mode-pv-dark{background:var(--dsw-static-neutral-1000)}
.kbth-mode-pv-dark i{background:var(--dsw-static-neutral-100);opacity:.25}
.kbth-mode-half{flex:1 1 0;height:100%;display:flex;align-items:center;justify-content:center}
.kbth-mode-half i{width:56%}
.kbth-mode-n{display:flex;align-items:center;flex-wrap:wrap;gap:8px;font-size:14px;font-weight:500}
.kbth-mode-cur{font-size:12px;font-weight:400;color:var(--dsw-alias-state-success-primary)}
body:not([data-ds-dark-theme]) .kbth-mode-cur{color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 55%,var(--dsw-alias-label-primary))}
@media (max-width:560px){.kbth-modes{grid-template-columns:1fr}}
.kbth-seg button[aria-pressed="true"]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.12)}
/* (29/09) The native “Appearance” block of General is replaced by the
   Appearance section of this page (same preference via themeSvc.setTheme):
   marked data-kbth-own by the observer below, it disappears — one single
   place sets the appearance. */
[data-kbth-own="appearance"]{display:none}
.kbth-sec{display:flex;flex-direction:column;gap:12px}
.kbth-sec-h{display:flex;flex-direction:column;gap:3px}
.kbth-sec-t{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}
.kbth-sec-d{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.kbth-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.kbth-lb{font-size:13px;font-weight:500;color:var(--dsw-alias-label-secondary);width:130px;flex:none}
/* tertiary, not caption: caption is #81858c on the dark layers (3.8:1) and #adb2b8 on white (2.1:1); tertiary is 5.9:1 and 3.7:1 */
.kbth-hint{font-size:11px;color:var(--dsw-alias-label-tertiary);line-height:1.45}
.kbth-link{appearance:none;border:0;background:none;padding:0;font:inherit;color:var(--dsw-alias-label-primary);text-decoration:underline;text-underline-offset:2px;cursor:pointer}
.kbth-link:hover{color:var(--dsw-alias-brand-primary)}
/* dream-skin conflict warning — styled with the DSH tokens */
.kbth-conflict{font-size:12px;line-height:1.5;padding:8px 12px;border-radius:9px;
  background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-label);
  border:.5px solid var(--dsw-alias-state-warn-secondary);flex-basis:100%}
.kbth-conflict strong{font-weight:600}
/* Round dots: the theme's background on one side, its accent on the other.
   Nothing else — no frame, no meta under each dot (the state of the chosen
   theme is shown on one line, under the row). */
.kbth-icsets{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}
.kbth-icset{appearance:none;font:inherit;cursor:pointer;display:flex;flex-direction:column;gap:7px;text-align:left;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.kbth-icset:hover{border-color:var(--dsw-alias-border-l3)}
.kbth-icset.on{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary)}
.kbth-icset-n{font-size:13px;font-weight:600}
.kbth-icset-r{display:flex;gap:6px;color:var(--dsw-alias-label-tertiary)}
.kbth-icset-i{display:inline-flex;width:18px;height:18px}
.kbth-icset-i svg{display:block}
.kbth-skins{display:flex;flex-wrap:wrap;gap:12px 14px;align-items:flex-start}
.kbth-skin{appearance:none;font:inherit;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:6px;
  padding:2px;border:0;background:none;width:76px;border-radius:12px}
/* (30/09) Dot of the ready-made themes: clean hairline on a light AND dark background
   (1 px at border-l2; the 0.5 px at l3 vanished on light bases),
   discreet depth through an inner shadow — the disc no longer floats.
   corner-shape:round — the shell sets superellipse(1.5) globally (Chrome 139),
   which paints border-radius:50% as a SQUIRCLE: a colour dot must
   read round; the superellipse stays on the shell's surfaces. */
.kbth-skin-dot{width:34px;height:34px;border-radius:50%;corner-shape:round;flex:none;
  border:1px solid var(--dsw-alias-border-l2);
  box-shadow:inset 0 1px 2px rgba(0,0,0,.18);
  transition:transform .12s,box-shadow .12s}
.kbth-skin:hover .kbth-skin-dot{transform:scale(1.07)}
.kbth-skin[aria-pressed="true"] .kbth-skin-dot,
.kbth-skin:focus-visible .kbth-skin-dot{box-shadow:inset 0 1px 2px rgba(0,0,0,.18),0 0 0 2px var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-layer-2)),0 0 0 4px var(--dsw-alias-brand-primary)}
.kbth-skin:focus-visible{outline:none}
.kbth-skin-name{font-size:11px;line-height:1.35;text-align:center;color:var(--dsw-alias-label-secondary);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.kbth-skin[aria-pressed="true"] .kbth-skin-name{color:var(--dsw-alias-label-primary);font-weight:600}
.kbth-acc{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.kbth-sw{position:relative;width:26px;height:26px;border-radius:50%;corner-shape:round;overflow:hidden;border:1px solid var(--dsw-alias-border-l3);cursor:pointer;flex:none;transition:border-color .12s}
.kbth-sw:hover{border-color:var(--dsw-alias-border-l4)}
.kbth-sw input{position:absolute;inset:-6px;width:calc(100% + 12px);height:calc(100% + 12px);cursor:pointer;border:0;padding:0}
.kbth-hex{display:flex;align-items:center;gap:2px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:4px 8px;background:var(--dsw-alias-bg-layer-1);transition:border-color .12s}
.kbth-hex:focus-within{border-color:var(--dsw-alias-brand-primary)}
.kbth-hex span{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.kbth-hex input{border:0;outline:0;background:transparent;font:inherit;font-size:13px;width:70px;color:var(--dsw-alias-label-primary)}
.kbth-hex.bad{border-color:var(--dsw-alias-state-error-primary)}
.kbth-dots{display:flex;gap:7px;flex-wrap:wrap}
.kbth-dot{position:relative}
.kbth-dot::before{content:"";position:absolute;inset:-2px}
.kbth-dot{appearance:none;border:1px solid var(--dsw-alias-border-l3);box-shadow:inset 0 0 0 1px rgba(255,255,255,.10);width:22px;height:22px;border-radius:50%;cursor:pointer;padding:0;transition:transform .1s,box-shadow .12s}
.kbth-dot:hover{transform:scale(1.15)}
.kbth-dot[aria-pressed="true"]{box-shadow:0 0 0 2px var(--dsw-alias-bg-layer-1),0 0 0 4px var(--dsw-alias-brand-primary)}
.kbth-btn{appearance:none;font:inherit;font-size:12px;padding:5px 11px;border-radius:8px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);transition:background .12s,border-color .12s}
.kbth-btn:hover{background:var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-3));border-color:var(--dsw-alias-border-l3)}
.kbth-wpcats{display:flex;gap:6px;flex-wrap:wrap}
.kbth-cat{appearance:none;font:inherit;font-size:12px;padding:3px 10px;border-radius:999px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);transition:background .12s,color .12s}
.kbth-cat{position:relative}
.kbth-cat::before{content:"";position:absolute;inset:-2px 0}
.kbth-cat:hover:not([aria-pressed="true"]){background:var(--dsw-alias-interactive-bg-hover)}
.kbth-cat[aria-pressed="true"]{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}
.kbth-wps{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.kbth-wp{appearance:none;font:inherit;cursor:pointer;text-align:left;display:flex;flex-direction:column;gap:5px;padding:6px;border-radius:10px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);transition:border-color .12s,box-shadow .12s}
.kbth-wp:hover:not([aria-pressed="true"]){border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-interactive-bg-hover)}
.kbth-wp[aria-pressed="true"]{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary)}
.kbth-wp-band{height:38px;border-radius:6px;border:.5px solid var(--dsw-alias-border-l3)}
.kbth-wp-name{font-size:11px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbth-slider{-webkit-appearance:none;appearance:none;width:100%;height:4px;border-radius:999px;cursor:pointer;
  background:linear-gradient(to right,var(--dsw-alias-brand-primary) 0 var(--fill,50%),var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-3)) var(--fill,50%) 100%)}
.kbth-slider::-webkit-slider-thumb{-webkit-appearance:none;width:15px;height:15px;border-radius:50%;background:var(--dsw-alias-bg-layer-1);border:2px solid var(--dsw-alias-brand-primary);transition:transform .1s}
.kbth-slider::-webkit-slider-thumb:hover{transform:scale(1.2)}
.kbth-slider::-moz-range-thumb{width:13px;height:13px;border-radius:50%;background:var(--dsw-alias-bg-layer-1);border:2px solid var(--dsw-alias-brand-primary)}
.kbth-sl{display:flex;flex-direction:column;gap:7px}
.kbth-sl-hd{display:flex;justify-content:space-between;align-items:baseline}
.kbth-sl-lb{font-size:13px;font-weight:500;color:var(--dsw-alias-label-secondary)}
.kbth-sl-vl{font-size:12px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.kbth-toks{display:flex;flex-direction:column;gap:6px}
.kbth-tok{display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:8px;border:.5px solid transparent;cursor:pointer;background:transparent;transition:background .12s}
.kbth-tok:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}
.kbth-tok[aria-pressed="true"]{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}
.kbth-tok-chip{width:16px;height:16px;border-radius:4px;border:1px solid var(--dsw-alias-border-l3);flex:none}
.kbth-tok-name{font-size:13px;color:var(--dsw-alias-label-primary);flex:1}
.kbth-tok-css{font-size:11px;color:var(--dsw-alias-label-tertiary);font-family:ui-monospace,Menlo,monospace}
.kbth-tok-ratio{font-size:11px;font-variant-numeric:tabular-nums;flex:none;width:46px;text-align:right}
.kbth-note{font-size:12px;color:var(--dsw-alias-label-tertiary);line-height:1.5;padding:10px 12px;border-radius:9px;background:var(--dsw-alias-bg-layer-2)}
.kbth-foot{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.kbth-pill{font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary)}
/* ── Police : grand select, avec recherche ─────────────────────────────── */
.kbth-fsel{display:flex;flex-direction:column;gap:4px;max-width:520px;width:100%}
.kbth-fsbtn{appearance:none;font:inherit;cursor:pointer;display:flex;align-items:center;justify-content:space-between;
  gap:12px;width:100%;padding:12px 14px;border-radius:12px;border:.5px solid var(--dsw-alias-border-l2);
  background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);text-align:left;
  transition:border-color .12s,background .12s}
.kbth-fsbtn:hover{border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-interactive-bg-hover)}
.kbth-fsbtn[aria-expanded="true"]{border-color:var(--dsw-alias-brand-primary)}
.kbth-fsname{font-size:20px;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
.kbth-fschev{color:var(--dsw-alias-label-tertiary);flex:none;display:flex;align-items:center}
.kbth-fsmeta{font-size:11px;color:var(--dsw-alias-label-tertiary);padding-left:2px}
.kbth-fspanel{display:flex;flex-direction:column;margin-top:6px;border:.5px solid var(--dsw-alias-border-l2);
  border-radius:12px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.kbth-fssearch{padding:11px 13px;border:0;border-bottom:.5px solid var(--dsw-alias-border-l2);background:transparent;
  color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;outline:none}
.kbth-fssearch::placeholder{color:var(--dsw-alias-label-tertiary)}
.kbth-fslist{max-height:300px;overflow-y:auto;display:flex;flex-direction:column;padding:6px}
.kbth-fsopt{appearance:none;font:inherit;cursor:pointer;text-align:left;display:flex;flex-direction:column;gap:2px;
  padding:8px 10px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary)}
.kbth-fsopt[data-actif="1"]{background:var(--dsw-alias-interactive-bg-hover)}
.kbth-fsopt[aria-selected="true"]{background:var(--dsw-alias-interactive-bg-active,var(--dsw-alias-interactive-bg-hover))}
.kbth-fsopt-name{font-size:11px;font-weight:600;color:var(--dsw-alias-label-tertiary)}
.kbth-fsopt-sample{font-size:14px;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbth-fsempty{padding:12px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
/* ── Advanced tab: 2-column layout (list + editor) ──────────────────────── */
.kbth-adv-editor{display:flex;flex-direction:column;gap:12px;padding:14px;border-radius:12px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);position:sticky;top:0}
.kbth-adv-preview{display:flex;align-items:center;gap:10px;padding:10px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l2)}
.kbth-adv-chip{width:32px;height:32px;border-radius:6px;border:1px solid var(--dsw-alias-border-l3);flex:none}
.kbth-adv-info{display:flex;flex-direction:column;gap:2px;min-width:0}
.kbth-adv-label{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.kbth-adv-css{font-size:11px;color:var(--dsw-alias-label-tertiary);font-family:ui-monospace,Menlo,monospace}
.kbth-adv-ratio{font-size:11px;font-variant-numeric:tabular-nums}
.kbth-adv-colors{display:flex;gap:8px;align-items:center}
.kbth-adv-swatch{display:flex;flex-direction:column;align-items:center;gap:3px}
.kbth-adv-swatch-label{font-size:9.5px;color:var(--dsw-alias-label-tertiary)}
/* ── Advanced sub-tabs — VERTICAL stack on the left of the content (rule of
   26/09/2026): column of tabs + panel, 2-column grid. ──────────────────── */
/* ── Advanced sub-tabs — VERTICAL stack on the left of the content ──────
   (29/09, harmonisation) Same look as the plugin's unified tabs
   (kb8-tab): 1px outline pill, active state in the brand colour — the
   vertical rail and the right hairline give way to the common
   treatment. text-align:start: bidi-safe. */
.kbth-adv-cols{display:grid;grid-template-columns:180px minmax(0,1fr);gap:8px 22px;align-items:start}
.kbth-adv-tabs{display:flex;flex-direction:column;gap:6px;overflow-y:auto;position:sticky;top:0}
.kbth-adv-tab{appearance:none;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;font:inherit;font-size:13px;font-weight:500;padding:8px 12px;cursor:pointer;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:start;transition:color .12s,background .12s,border-color .12s}
.kbth-adv-tab:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l2)}
.kbth-adv-tab.on{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);font-weight:600}
/* ── Toggle switch ───────────────────────────────────────────────────── */
.kbth-toggle-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 0}
.kbth-toggle-label{font-size:13px;font-weight:500;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;gap:4px}
.kbth-toggle-hint{font-size:11px;color:var(--dsw-alias-label-tertiary);cursor:help}
/* The off track is a tint of the text colour: layer-3 is white in the light scheme, so a white knob sat on an invisible track. */
.kbth-toggle{appearance:none;border:0;width:40px;height:22px;border-radius:11px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 22%,transparent);cursor:pointer;position:relative;transition:background .15s;flex:none}
.kbth-toggle.on{background:var(--dsw-alias-brand-primary)}
.kbth-toggle-knob{position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:var(--dsw-alias-label-secondary);transition:transform .15s;box-shadow:0 1px 2px rgba(0,0,0,.2)}
.kbth-toggle.on .kbth-toggle-knob{transform:translateX(18px);background:var(--dsw-alias-label-primary-foreground)}
/* ── Rampe de couleurs ───────────────────────────────────────────────── */
.kbth-ramp{display:flex;gap:0;border-radius:8px;overflow:hidden;margin-top:8px}
/* min-width:0 so eleven steps shrink to a 330 px column instead of leaving the ramp's box by 10 px (390 px window) */
.kbth-ramp-step{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:4px}
.kbth-ramp-swatch{width:100%;height:28px}
.kbth-ramp-label{font-size:9px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
/* ── Jetons enrichis ─────────────────────────────────────────────────── */
.kbth-tok-hex{font-size:11px;color:var(--dsw-alias-label-tertiary);font-family:ui-monospace,Menlo,monospace;font-variant-numeric:tabular-nums}
.kbth-tok-badge{font-size:9.5px;font-weight:700;padding:1px 6px;border-radius:4px;border:1px solid;flex:none}
.kbth-tok-sel{background:var(--dsw-alias-bg-layer-2)!important;border-color:var(--dsw-alias-border-l2)!important}
/* ── Accessibility table ─────────────────────────────────────────────── */
.kbth-a11y-table{display:flex;flex-direction:column;gap:2px}
.kbth-a11y-row{display:grid;grid-template-columns:28px 1fr auto auto auto;gap:10px;align-items:center;padding:6px 8px;border-radius:6px}
.kbth-a11y-row:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}
.kbth-a11y-aa{width:24px;height:24px;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex:none}
.kbth-a11y-label{font-size:12.5px;color:var(--dsw-alias-label-primary)}
.kbth-a11y-hex{font-size:10.5px;color:var(--dsw-alias-label-tertiary);font-family:ui-monospace,Menlo,monospace}
.kbth-a11y-ratio{font-size:11px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);width:46px;text-align:right}
.kbth-a11y-badge{font-size:9.5px;font-weight:700;padding:1px 6px;border-radius:4px;border:1px solid;flex:none}
.kbth-gpv{position:relative;overflow:hidden;height:150px;border-radius:12px;border:.5px solid var(--dsw-alias-border-l2);display:flex}
.kbth-gpv-bg{position:absolute;inset:0}
.kbth-gpv-side{position:relative;width:30%;padding:12px 10px;display:flex;flex-direction:column;gap:8px;border-right:.5px solid var(--dsw-alias-border-l1)}
.kbth-gpv-main{position:relative;flex:1;display:flex;flex-direction:column;justify-content:flex-end;gap:10px;padding:12px}
.kbth-gpv-menu{align-self:flex-end;width:46%;padding:8px 10px;border-radius:10px;border:.5px solid var(--dsw-alias-border-l2);display:flex;flex-direction:column;gap:6px}
.kbth-gpv-input{padding:10px 12px;border-radius:12px;border:.5px solid var(--dsw-alias-border-l2)}
.kbth-gpv-line{display:block;height:6px;border-radius:3px;background:var(--dsw-alias-label-tertiary);opacity:.55}
.kbth-gpv-line.short{width:55%}
/* ── Export preview ──────────────────────────────────────────────────── */
.kbth-export-preview{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;overflow:hidden;margin-top:8px}
.kbth-export-bar{display:flex;justify-content:space-between;padding:6px 12px;border-bottom:1px solid var(--dsw-alias-border-l2);font-size:11px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-2)}
.kbth-export-code{margin:0;padding:12px 14px;font-family:ui-monospace,Menlo,monospace;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);white-space:pre;overflow-x:auto}
/* ══ Thinking animation ═════════════════════════════════════════════════════
   .kb-ld: one animation, everywhere (bottom status, preview, library). The
   a-* and vb classes are the catalogue's; everything is scoped by .kb-ld. */
.kb-ld{display:inline-flex;flex:none;width:var(--kb-px,24px);height:var(--kb-px,24px);color:var(--kb-tint,currentColor);--c1:#E5534B;--c2:#F2A65A;--c3:#7FAF63;--c4:#F0C75E}
.kb-ld svg,.kb-ld img{width:100%;height:100%;display:block;overflow:visible}
.kb-ld svg *{transform-box:fill-box;transform-origin:center}
.kb-ld svg .vb{transform-box:view-box;transform-origin:24px 24px}
.kb-ld svg [transform]{transform-box:view-box;transform-origin:0 0}
.kb-ld-mask{background:currentColor;-webkit-mask-size:contain;mask-size:contain;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-position:center;mask-position:center}
.kb-ld .a-spin{animation:kbk-spin calc(var(--d,1.2s)/var(--kb-spd,1)) linear infinite}
.kb-ld .a-bounce{animation:kbk-bounce calc(var(--d,1.1s)/var(--kb-spd,1)) ease-in-out infinite}
.kb-ld .a-bar{animation:kbk-bar calc(var(--d,1s)/var(--kb-spd,1)) ease-in-out infinite}
.kb-ld .a-pulse{animation:kbk-pulse calc(var(--d,1.6s)/var(--kb-spd,1)) ease-out infinite}
.kb-ld .a-fade{animation:kbk-fade calc(var(--d,1.2s)/var(--kb-spd,1)) ease-in-out infinite}
.kb-ld .a-jelly{animation:kbk-jelly calc(var(--d,1.6s)/var(--kb-spd,1)) ease-in-out infinite}
.kb-ld .a-flip{animation:kbk-flip calc(var(--d,2.4s)/var(--kb-spd,1)) ease-in-out infinite}
.kb-ld .a-dash{animation:kbk-dash calc(var(--d,1.4s)/var(--kb-spd,1)) linear infinite}
.kb-ld .a-twinkle{animation:kbk-twinkle calc(var(--d,1.6s)/var(--kb-spd,1)) ease-in-out infinite}
.kb-ld .a-pop{animation:kbk-pop calc(var(--d,1.2s)/var(--kb-spd,1)) ease-in-out infinite}
/* the second wave of the catalogue: plants, objects, animals, manga. --rk = the amplitude of a-rock */
.kb-ld .a-hop{animation:kbk-hop calc(var(--d,1.2s)/var(--kb-spd,1)) ease-in-out infinite}
.kb-ld .a-rock{animation:kbk-rock calc(var(--d,1.6s)/var(--kb-spd,1)) ease-in-out infinite}
.kb-ld .a-blink{animation:kbk-blink calc(var(--d,3s)/var(--kb-spd,1)) ease-in-out infinite}
.kb-ld .a-grow{animation:kbk-grow calc(var(--d,2.4s)/var(--kb-spd,1)) ease-out infinite}
.kb-ld .a-float{animation:kbk-float calc(var(--d,2s)/var(--kb-spd,1)) ease-in-out infinite}
.kb-ld .a-rise{animation:kbk-rise calc(var(--d,1.8s)/var(--kb-spd,1)) ease-out infinite}
.kb-ld .a-drop{animation:kbk-drop calc(var(--d,2.4s)/var(--kb-spd,1)) ease-in infinite}
.kb-ld .a-swim{animation:kbk-swim calc(var(--d,2s)/var(--kb-spd,1)) ease-in-out infinite}
.kb-ld .a-flap{animation:kbk-flap calc(var(--d,.25s)/var(--kb-spd,1)) ease-in-out infinite}
.kb-ld .a-shake{animation:kbk-shake calc(var(--d,.35s)/var(--kb-spd,1)) linear infinite}
.kb-ld .a-glow{animation:kbk-glow calc(var(--d,1.6s)/var(--kb-spd,1)) ease-in-out infinite}
.kb-ld .a-beat{animation:kbk-beat calc(var(--d,1s)/var(--kb-spd,1)) ease-in-out infinite}
.kb-ld .a-boing{animation:kbk-boing calc(var(--d,2.4s)/var(--kb-spd,1)) ease-in-out infinite}
.kb-ld .a-flame{animation:kbk-flame calc(var(--d,.35s)/var(--kb-spd,1)) ease-in-out infinite}
.kb-ld .a-rev{animation-direction:reverse}
@keyframes kbk-spin{to{transform:rotate(360deg)}}
@keyframes kbk-bounce{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-9px)}}
@keyframes kbk-bar{0%,100%{transform:scaleY(.3)}50%{transform:scaleY(1)}}
@keyframes kbk-pulse{0%{transform:scale(.18);opacity:.95}100%{transform:scale(1);opacity:0}}
@keyframes kbk-fade{0%,100%{opacity:.16}40%{opacity:1}}
@keyframes kbk-jelly{0%,100%{transform:scale(1.12,.88) rotate(0)}50%{transform:scale(.88,1.12) rotate(90deg)}}
@keyframes kbk-flip{0%,55%{transform:rotate(0)}85%,100%{transform:rotate(180deg)}}
@keyframes kbk-dash{to{stroke-dashoffset:-100}}
@keyframes kbk-twinkle{0%,100%{transform:scale(.5) rotate(0);opacity:.55}50%{transform:scale(1) rotate(45deg);opacity:1}}
@keyframes kbk-pop{0%,100%{transform:scale(.55);opacity:.5}50%{transform:scale(1);opacity:1}}
@keyframes kbk-hop{0%,100%{transform:translateY(0) scale(1.1,.88)}35%{transform:translateY(-9px) scale(.92,1.1)}70%{transform:translateY(0) scale(1.1,.88)}}
@keyframes kbk-rock{0%,100%{transform:rotate(calc(var(--rk,12deg)*-1))}50%{transform:rotate(var(--rk,12deg))}}
@keyframes kbk-blink{0%,44%,52%,100%{transform:scaleY(1)}48%{transform:scaleY(.08)}}
@keyframes kbk-grow{0%{transform:scale(.1);opacity:0}15%{opacity:1}55%,85%{transform:scale(1);opacity:1}100%{transform:scale(1);opacity:0}}
@keyframes kbk-float{0%,100%{transform:translateY(2px)}50%{transform:translateY(-4px)}}
@keyframes kbk-rise{0%{transform:translateY(5px) scale(.6);opacity:0}25%{opacity:.9}100%{transform:translateY(-11px) scale(1);opacity:0}}
@keyframes kbk-drop{0%{transform:translate(0,-10px) rotate(0);opacity:0}20%{opacity:1}100%{transform:translate(4px,12px) rotate(40deg);opacity:0}}
@keyframes kbk-swim{0%,100%{transform:translateX(-5px)}50%{transform:translateX(5px)}}
@keyframes kbk-flap{0%,100%{transform:rotate(-28deg)}50%{transform:rotate(14deg)}}
@keyframes kbk-shake{0%,100%{transform:translate(0,0)}25%{transform:translate(-1px,1px)}50%{transform:translate(1px,-1px)}75%{transform:translate(-1px,-1px)}}
@keyframes kbk-glow{0%,100%{opacity:.35;transform:scale(.88)}50%{opacity:1;transform:scale(1.08)}}
@keyframes kbk-beat{0%,60%,100%{transform:scale(1)}15%{transform:scale(1.18)}30%{transform:scale(.96)}45%{transform:scale(1.1)}}
@keyframes kbk-boing{0%,100%{transform:scale(1.1,.88)}50%{transform:scale(.9,1.12)}}
@keyframes kbk-flame{0%,100%{transform:scaleY(.65)}50%{transform:scaleY(1.2)}}
@keyframes kbk-vis{to{visibility:visible}}
@keyframes kbk-sway{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.5px)}}
@keyframes kbk-shim{0%{background-position:100% 0}67%,100%{background-position:0 0}}
.kb-ld.kb-late{visibility:hidden;animation:kbk-vis 0s forwards;animation-delay:var(--kb-late,0ms)}
html[data-kbth-reduced] .kb-ld *{animation:none!important}
@media (prefers-reduced-motion:reduce){.kb-ld *{animation:none!important}.kbth-ldp-text,.kbth-ldp-whale{animation:none!important}}
/* In the real page: the native whale tail fades out, the text can be hidden. */
[data-kb-ld-hide]{display:none!important}
[data-chat-running][data-kb-ld-notext] [data-shimmer]{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
/* In-context preview (a faithful copy of the bottom status: same DSH tokens) */
.kbth-ldp{display:flex;flex-direction:column;gap:10px;padding:14px 16px;border-radius:12px;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l2)}
.kbth-ldp-user{align-self:flex-end;max-width:80%;background:var(--dsw-alias-bg-layer-3);padding:7px 11px;border-radius:12px;font-size:13px;color:var(--dsw-alias-label-primary)}
.kbth-ldp-step{font-size:13px;color:var(--dsw-alias-label-tertiary)}
.kbth-ldp-run{display:flex;flex-direction:column;align-items:flex-start;font-size:12px;line-height:22px;color:var(--dsw-alias-label-deep-diving,#5686fe)}
.kbth-ldp-div{display:block;width:100%;height:.5px;margin:6px 0 8px;background:var(--dsw-alias-border-l2)}
.kbth-ldp-ct{display:inline-flex;align-items:center;gap:6px;min-width:0}
.kbth-ldp-ic{display:inline-flex;flex:none;align-items:center;justify-content:center;width:var(--kb-px,14px);height:var(--kb-px,14px);overflow:hidden}
.kbth-ldp-whale{animation:kbk-sway 1.4s ease-in-out infinite}
.kbth-ldp-text{font-variant-numeric:tabular-nums;background:linear-gradient(105deg,var(--dsw-alias-label-deep-diving,#5686fe) 38%,var(--dsw-alias-label-deep-diving-shimmer,#93c5fd) 50%,var(--dsw-alias-label-deep-diving,#5686fe) 62%);background-size:260% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:kbk-shim 1.5s steps(48) infinite}
.kbth-ldp-run.nolabel .kbth-ldp-text{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
.kbth-ldp-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.kbth-ldchip{border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:2px 9px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.kbth-ldchip.cur{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary);font-weight:600}
/* Rotation */
.kbth-ldt{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.kbth-lds{position:relative;display:flex;flex-direction:column;align-items:center;gap:6px;padding:12px 8px 10px;border-radius:12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);min-width:0;color:var(--dsw-alias-label-secondary)}
.kbth-lds.cur{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary)}
.kbth-lds.empty{border-style:dashed;background:transparent;color:var(--dsw-alias-label-tertiary);justify-content:center;min-height:96px;font-size:12px}
.kbth-lds-pv{height:56px;display:flex;align-items:center;justify-content:center}
.kbth-lds-nm{font-size:12px;font-weight:600;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}
.kbth-lds-x{position:absolute;top:4px;right:4px;width:24px;height:24px;border-radius:50%;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;display:flex;align-items:center;justify-content:center}
.kbth-lds-x:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.kbth-lds-ord{position:absolute;top:7px;left:9px;font-size:11px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
@media(max-width:480px){.kbth-ldt{grid-template-columns:repeat(2,minmax(0,1fr))}}
/* Folded settings */
.kbth-disc{appearance:none;width:100%;display:flex;align-items:center;gap:12px;padding:11px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);cursor:pointer;text-align:start;color:var(--dsw-alias-label-primary);font:inherit}
.kbth-disc:hover{background:var(--dsw-alias-interactive-bg-hover)}
.kbth-disc-t{font-size:13px;font-weight:600}
.kbth-disc-s{flex:1;font-size:12px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.kbth-setbody{display:flex;flex-direction:column;gap:12px;padding:14px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
.kbth-skinblock{display:flex;flex-direction:column;gap:10px}
.kbth-skin-add .kbth-skin-dot{border:1.5px dashed var(--dsw-alias-border-l4);box-shadow:none;background:transparent;color:var(--dsw-alias-label-secondary);font-size:20px;line-height:1;display:grid;place-items:center}
.kbth-skin-add:hover .kbth-skin-dot{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.kbth-empty{font-size:12px;color:var(--dsw-alias-label-tertiary);line-height:1.5;padding:2px 0;max-width:54ch}
.kbth-sum{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
.kbth-sum-tx{display:flex;flex-direction:column;gap:3px;flex:1;min-width:200px}
.kbth-sum-n{font-size:14px;font-weight:600;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.kbth-sum-m{font-size:12px;color:var(--dsw-alias-label-tertiary);line-height:1.45}
.kbth-sum-a{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
/* A pill with a state colour. Not a .kbth-pill: the light-scheme list further down greys every one of those. */
.kbth-tone{font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid var(--tone);color:var(--tone);background:var(--tone-bg,transparent)}
.kbth-tone-on{--tone:var(--kbth-ink,var(--dsw-alias-state-success-primary))}
.kbth-tone-mod{--tone:var(--dsw-alias-state-warn-label);--tone-bg:var(--dsw-alias-state-warn-tertiary)}
.kbth-ok{font-size:12px;color:var(--kbth-ink,var(--dsw-alias-state-success-primary));font-weight:500;line-height:1.45}
.kbth-bad{font-size:12px;color:var(--kbth-ink,var(--dsw-alias-state-error-primary));line-height:1.45}
.kbth-btn.kbth-danger{color:var(--kbth-ink,var(--dsw-alias-state-error-primary))}
.kbth-in.bad{border-color:var(--dsw-alias-state-error-primary)}
.kbth-lib{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}
.kbth-trow{display:flex;align-items:center;gap:12px;padding:10px 14px;flex-wrap:wrap}
.kbth-trow+.kbth-trow,.kbth-trow+.kbth-exp,.kbth-exp+.kbth-trow{border-top:1px solid var(--dsw-alias-border-l1)}
.kbth-trow .kbth-skin-dot{width:28px;height:28px;flex:none}
.kbth-trow-tx{display:flex;flex-direction:column;gap:2px;flex:1;min-width:170px}
.kbth-trow-n{font-size:13px;font-weight:600;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.kbth-trow-m{font-size:11px;color:var(--dsw-alias-label-tertiary);line-height:1.4}
.kbth-trow-a{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.kbth-exp{padding:10px 14px 14px;display:flex;flex-direction:column;gap:8px;background:var(--dsw-alias-bg-layer-2)}
.kbth-state{display:flex;flex-direction:column;align-items:flex-start;gap:6px;padding:16px;border:1px dashed var(--dsw-alias-border-l3);border-radius:12px}
.kbth-fold{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:10px 14px}
.kbth-fold>summary{cursor:pointer;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.kbth-gbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.kbth-search{flex:1;min-width:180px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:8px 12px;font-size:13px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.kbth-search:focus{outline:0;border-color:var(--dsw-alias-brand-primary)}
/* the browser's default placeholder is a mid grey: 3.4:1 on the dark layer */
.kbth-search::placeholder{color:var(--dsw-alias-label-secondary)}
.kbth-src{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.kbth-gal{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px}
.kbth-card{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-layer-1);overflow:hidden;min-width:0}
.kbth-thumb{height:104px;display:flex;border-bottom:1px solid var(--dsw-alias-border-l1)}
.kbth-thumb-s{width:26%;padding:10px 8px;display:flex;flex-direction:column;gap:6px}
.kbth-thumb-s i,.kbth-thumb-c i{display:block;height:5px;border-radius:3px}
.kbth-thumb-c{flex:1;padding:12px;display:flex;flex-direction:column;gap:7px}
.kbth-thumb-in{height:18px;border:1px solid;margin-top:2px}
.kbth-thumb-bt{height:16px;width:46%}
.kbth-card-b{padding:12px 14px 14px;display:flex;flex-direction:column;gap:5px;flex:1}
.kbth-card-n{font-size:14px;font-weight:600}
.kbth-card-a{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.kbth-card-d{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.5}
.kbth-card-m{font-size:11px;color:var(--dsw-alias-label-tertiary);line-height:1.4}
.kbth-card-f{display:flex;gap:8px;margin-top:auto;padding-top:8px;flex-wrap:wrap;align-items:center}
.kbth-card-i{display:flex;flex-direction:column;gap:5px;padding-top:6px}
.kbth-sk{height:230px;border-radius:14px;background:linear-gradient(100deg,var(--dsw-alias-bg-layer-2) 30%,var(--dsw-alias-bg-layer-3) 50%,var(--dsw-alias-bg-layer-2) 70%);background-size:200% 100%;animation:kbth-sk 1.3s linear infinite}
@keyframes kbth-sk{to{background-position:-200% 0}}
@media (prefers-reduced-motion:reduce){.kbth-sk{animation:none}}
.kbth-trial{position:sticky;top:0;z-index:3;display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 14px;margin-bottom:18px;border-radius:12px;background:var(--dsw-alias-state-warn-tertiary);border:1px solid var(--dsw-alias-state-warn-secondary);color:var(--dsw-alias-state-warn-label);font-size:13px}
.kbth-trial b{font-weight:600}
.kbth-trial-sp{flex:1;min-width:8px}
.kbth-grp{font-size:11px;color:var(--dsw-alias-label-tertiary);font-weight:600}
/* Window */
.kbth-mback{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:2147483000}
.kbth-mdlg{position:fixed;z-index:2147483001;left:50%;top:50%;transform:translate(-50%,-50%);width:min(720px,calc(100vw - 32px));max-height:min(86vh,800px);display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l3);border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.6);outline:none;font-size:14px}
.kbth-mhd{display:flex;align-items:center;gap:12px;padding:16px 18px 8px}
.kbth-mhd h3{margin:0;font-size:16px;flex:1;font-weight:600}
.kbth-mx{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;width:30px;height:30px;border-radius:50%;font-size:20px;line-height:1}
.kbth-mx:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.kbth-mbody{padding:6px 18px 14px;overflow:auto;display:flex;flex-direction:column;gap:12px;min-height:0}
.kbth-mft{padding:12px 18px;border-top:1px solid var(--dsw-alias-border-l1);display:flex;justify-content:flex-end;gap:12px;align-items:center}
.kbth-btn.kbth-ldpri{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground,#0f1115);border-color:var(--dsw-alias-brand-primary);font-weight:600}
[data-kb="ld-pane"] .kbth-btn:disabled,[data-kb="ld-picker"] .kbth-btn:disabled,[data-kb="ld-pack"] .kbth-btn:disabled{opacity:.45;cursor:not-allowed}
/* Library */
.kbth-lgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:8px}
.kbth-lcard{display:flex;flex-direction:column;gap:5px;padding:7px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);min-width:0}
.kbth-lcard.on{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary)}
.kbth-lcard-pv{height:56px;border-radius:7px;background:var(--dsw-alias-bg-layer-2);display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary)}
.kbth-lcard-nm{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbth-lcard-meta{font-size:10.5px;color:var(--dsw-alias-label-tertiary);margin-top:-3px}
.kbth-lcard-acts{display:flex;gap:6px}
.kbth-lcard-acts .kbth-btn{flex:1;padding:3px 6px;font-size:11px}
.kbth-lcard-acts .kbth-btn.del{flex:none}
.kbth-pills{display:flex;gap:6px;flex-wrap:wrap}
.kbth-pillb{appearance:none;border:1px solid var(--dsw-alias-border-l2);background:transparent;border-radius:999px;padding:3px 10px;font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer}
.kbth-pillb[aria-pressed="true"]{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l3)}
.kbth-status{font-size:12px;border-radius:9px;padding:8px 10px;line-height:1.45}
.kbth-status.ok{background:var(--dsw-alias-state-success-tertiary,rgba(34,197,94,.14));color:var(--dsw-alias-state-success-primary)}
.kbth-status.warn{background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-label,var(--dsw-alias-state-warn-primary))}
.kbth-status.err{background:var(--dsw-alias-state-error-tertiary,rgba(242,90,90,.14));color:var(--dsw-alias-state-error-primary)}
.kbth-panel2{display:flex;flex-direction:column;gap:10px;padding:14px;border-radius:12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);min-width:0}
.kbth-panel2 h4{margin:0;font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}
.kbth-panel2 p{margin:0;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.kbth-add2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
@media(max-width:640px){.kbth-add2{grid-template-columns:minmax(0,1fr)}}
.kbth-drop{display:flex;flex-direction:column;align-items:center;gap:8px;padding:18px 12px;border-radius:10px;border:1.5px dashed var(--dsw-alias-border-l3);text-align:center;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.kbth-drop.over{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-brand-primary)}
.kbth-ta{width:100%;min-height:64px;resize:vertical;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);padding:9px 11px;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary)}
.kbth-in{width:100%;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);padding:7px 10px;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary)}
.kbth-codeln{display:flex;align-items:center;gap:8px;justify-content:space-between;padding:7px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);font-family:ui-monospace,Menlo,monospace;font-size:12px;color:var(--dsw-alias-label-secondary)}
.kbth-codeln span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbth-wchips{display:flex;flex-wrap:wrap;gap:6px}
.kbth-wchip{display:inline-flex;align-items:center;gap:4px;padding:2px 4px 2px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.kbth-wchip button{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;width:18px;height:18px;border-radius:50%;line-height:1;font-size:13px}
.kbth-wchip button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.kbth-sum{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
.kbth-sum-ic{display:flex;align-items:center;gap:10px;min-width:30px;color:var(--dsw-alias-label-secondary)}
.kbth-sum-tx{display:flex;flex-direction:column;gap:2px;flex:1;min-width:160px}
.kbth-new{font-size:10px;font-weight:700;letter-spacing:.06em;padding:2px 7px;border-radius:999px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground,#0f1115)}
/* ── Small texts in the LIGHT scheme ────────────────────────────────────────
   DSH colours its discreet texts with label-tertiary (#81858C, 3.7:1 on white) and label-caption
   (#ADB2B8, 2.1:1): below the AA threshold of 4.5:1. On THIS page, in light only, they take
   label-secondary (5.7:1). Dark gains nothing from it and keeps its hierarchy. Measured on the real GUI. */
body:not([data-ds-dark-theme]) :is(.kbth-icset-r,.kbth-st-lbl,.kbth-st-hint,.kbth-st-sub,.kbth-st-cap,.kbth-st-grp,.kbth-st-x,.kbth-a11y-hex,.kbth-adv-css,.kbth-card-a,.kbth-card-m,.kbth-src,.kbth-adv-swatch-label,.kbth-disc-s,.kbth-drop,.kbth-empty,.kbth-export-bar,.kbth-fschev,.kbth-fsempty,.kbth-fsmeta,.kbth-fsopt-name,.kbth-grp,.kbth-hex span,.kbth-hint,.kbth-lcard-meta,.kbth-ldp-bar,.kbth-ldp-step,.kbth-lds-ord,.kbth-lds-x,.kbth-lds.empty,.kbth-mx,.kbth-note,.kbth-panel2 p,.kbth-pill,.kbth-ramp-label,.kbth-sec-d,.kbth-sl-vl,.kbth-sum-m,.kbth-toggle-hint,.kbth-tok-css,.kbth-tok-hex,.kbth-trow-m,.kbth-wchip button){color:var(--dsw-alias-label-secondary)}
/* The "in use" pill is a brand fill with its own label pair: the grey of the rule above made it 3.3:1 (1.4:1 in Neutral violet). */
body:not([data-ds-dark-theme]) .kbth-pill.ok{color:var(--dsw-alias-label-primary-foreground,#fff)}
/* ── Ink of the grades (AAA / AA / large text / fail) ───────────────────────────────────────
   DSH's state tints are state backgrounds, not inks: in light, #22C55E gives 2.2:1 on white.
   One variable per grade AND per scheme, read by the CSS: it follows the scheme on display without the script
   having to guess it or to redraw. Every ink exceeds 5:1 on layer 1 of its scheme (tested). */
.kbth-gr-ok{--kbth-ink:#4ED17E}
.kbth-gr-warn{--kbth-ink:#F7AD31}
.kbth-gr-err{--kbth-ink:#F25A5A}
body:not([data-ds-dark-theme]) .kbth-gr-ok{--kbth-ink:#15803D}
body:not([data-ds-dark-theme]) .kbth-gr-warn{--kbth-ink:#B45309}
body:not([data-ds-dark-theme]) .kbth-gr-err{--kbth-ink:#B91C1C}
html[data-kbth-cb] .kbth-gr-ok{--kbth-ink:#56B4E9}
html[data-kbth-cb] .kbth-gr-warn{--kbth-ink:#14B58A}
html[data-kbth-cb] .kbth-gr-err{--kbth-ink:#FF8A3D}
html[data-kbth-cb] body:not([data-ds-dark-theme]) .kbth-gr-ok{--kbth-ink:#0072B2}
html[data-kbth-cb] body:not([data-ds-dark-theme]) .kbth-gr-warn{--kbth-ink:#00785A}
html[data-kbth-cb] body:not([data-ds-dark-theme]) .kbth-gr-err{--kbth-ink:#B84A00}
.kbth-a11y-badge[class*="kbth-gr-"],.kbth-tok-badge[class*="kbth-gr-"]{color:var(--kbth-ink);border-color:var(--kbth-ink)}
/* ── The look studio (the simple view): a small DSH drawn from the look in use, panels under the part you click ──
   The window paints itself with the look's own colours (inline); everything around it speaks DSH's tokens. */
.kbth-st{display:flex;flex-direction:column;gap:14px;min-width:0}
.kbth-st-lbl{font-size:12px;color:var(--dsw-alias-label-tertiary);margin-right:2px}
.kbth-st-vibes,.kbth-st-also,.kbth-st-looks,.kbth-st-chips,.kbth-st-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.kbth-st-chip{appearance:none;font:inherit;font-size:13px;display:inline-flex;align-items:center;gap:7px;padding:5px 12px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer}
.kbth-st-chip:hover{border-color:var(--dsw-alias-border-l4)}
.kbth-st-chip[aria-pressed="true"]{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary)}
.kbth-st-chip i{width:9px;height:9px;border-radius:50%;display:inline-block}
.kbth-st-chip.surprise{margin-left:auto}
.kbth-st-hint{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.kbth-st-hint b{color:var(--dsw-alias-label-primary);font-weight:600}
.kbth-st-also>span,.kbth-st-looks .kbth-link{font-size:12.5px}
.kbth-st-stage{position:relative}
.kbth-st-win{position:sticky;top:8px;z-index:3;display:grid;grid-template-columns:148px minmax(0,1fr);height:340px;overflow:hidden;border:1px solid;isolation:isolate;line-height:1.4}
.kbth-st.narrow .kbth-st-win{grid-template-columns:104px minmax(0,1fr);height:auto;min-height:330px}
.kbth-st-wpl{position:absolute;inset:0;z-index:0;pointer-events:none}
.kbth-st-side{position:relative;z-index:1;display:flex;flex-direction:column;gap:12px;padding:12px 10px;border-right:1px solid}
.kbth-st-main{position:relative;z-index:1;display:flex;flex-direction:column;min-width:0}
.kbth-stz{position:relative;cursor:pointer;outline:none;transition:box-shadow .12s}
.kbth-stz:hover:not(:has(.kbth-stz:hover)),.kbth-stz:focus-visible,.kbth-stz.open{box-shadow:0 0 0 2px var(--dsw-alias-brand-primary)}
.kbth-stz-pen{position:absolute;top:-6px;right:-6px;z-index:2;width:16px;height:16px;border-radius:50%;display:grid;place-items:center;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground,#fff);opacity:.5;pointer-events:none;transition:opacity .12s}
.kbth-stz.big>.kbth-stz-pen{top:4px;right:4px}
.kbth-stz:hover:not(:has(.kbth-stz:hover))>.kbth-stz-pen,.kbth-stz:focus-visible>.kbth-stz-pen,.kbth-stz.open>.kbth-stz-pen{opacity:1}
.kbth-st-brand{align-self:flex-start;padding:2px 5px;border-radius:6px;font-weight:700;font-size:1.15em;letter-spacing:-.01em}
.kbth-st-logo b{font-weight:900}
.kbth-st-rows{display:flex;flex-direction:column;gap:2px;border-radius:8px}
.kbth-st-row1{display:flex;align-items:center;gap:8px;padding:5px 7px}
.kbth-st-ico{display:inline-flex;width:16px;height:16px;flex:none}
.kbth-st-rn{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kbth-st-top{display:flex;align-items:center;justify-content:space-between;padding:9px 14px;border-bottom:1px solid;font-weight:700}
.kbth-st-title{padding:2px 5px;border-radius:6px}
.kbth-st-moon{width:26px;height:26px;border-radius:50%;border:1px solid;display:grid;place-items:center}
.kbth-st-chat{flex:1;display:flex;flex-direction:column;justify-content:center;gap:11px;padding:14px;min-height:0;overflow:hidden}
.kbth-st-bub,.kbth-st-bub2{max-width:80%;padding:8px 13px;align-self:flex-end}
.kbth-st-reply1{max-width:92%}
.kbth-st-reply1 code{padding:0 4px;font-family:ui-monospace,Menlo,monospace}
.kbth-st-think{display:flex;align-items:center;gap:8px;align-self:flex-start;padding:2px 5px;border-radius:6px}
.kbth-st-ld{display:inline-flex;align-items:center;justify-content:center;min-width:14px}
.kbth-st-comp{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 12px 6px;padding:8px 8px 8px 12px;border:1px solid}
.kbth-st-ph{flex:1;padding:2px 5px;border-radius:6px}
.kbth-st-send{width:26px;height:26px;display:grid;place-items:center}
.kbth-st-dock{display:flex;flex-wrap:wrap;gap:6px;margin:0 12px 10px;padding:3px;min-height:24px;border-radius:8px}
.kbth-st-pillw{padding:2px 9px;border-radius:999px;border:1px solid}
.kbth-st-pillw.none{border-style:dashed}
.kbth-st-pop{box-sizing:border-box;margin-top:10px;width:100%;max-height:max(240px,calc(100vh - 420px));overflow:auto;border:1px solid var(--dsw-alias-border-l3);border-radius:16px;background:var(--dsw-alias-bg-layer-1);padding:0 16px 16px;display:flex;flex-direction:column;gap:12px;outline:none}
.kbth-st-ph2{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;padding:14px 0 8px;background:var(--dsw-alias-bg-layer-1)}
.kbth-st-ph2 h3{margin:0;font-size:15px;font-weight:700;color:var(--dsw-alias-label-primary)}
.kbth-st-pa{display:flex;align-items:center;gap:8px}
.kbth-st-ic{appearance:none;width:30px;height:30px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);display:grid;place-items:center;cursor:pointer}
.kbth-st-ic:hover{border-color:var(--dsw-alias-border-l4);color:var(--dsw-alias-label-primary)}
.kbth-st-sub{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);margin-top:2px}
.kbth-st-cap{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.kbth-st-tiles{display:grid;gap:8px}
.kbth-st-tiles.c3{grid-template-columns:repeat(3,minmax(0,1fr))}
.kbth-st-tiles.c4{grid-template-columns:repeat(4,minmax(0,1fr))}
.kbth-st-tiles.c5{grid-template-columns:repeat(5,minmax(0,1fr))}
.kbth-st-tiles.scroll{max-height:210px;overflow:auto;padding:2px}
.kbth-st-tiles.tall{max-height:270px}
.kbth-st-tile{appearance:none;font:inherit;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer;display:flex;flex-direction:column;overflow:hidden;text-align:center;min-width:0}
.kbth-st-tile:hover{border-color:var(--dsw-alias-border-l4)}
.kbth-st-tile[aria-pressed="true"]{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary)}
.kbth-st-mini{position:relative;height:52px;overflow:hidden;display:flex;align-items:center;justify-content:center}
.kbth-st-nm{font-size:11.5px;line-height:1.25;padding:6px 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbth-st-ms{position:absolute;left:0;top:0;bottom:0;width:30%}
.kbth-st-ms.wide{width:38%}
.kbth-st-ml{position:absolute;left:38%;top:13px;width:40%;height:4px;border-radius:2px;opacity:.7}
.kbth-st-mbar{position:absolute;left:38%;bottom:11px;width:24%;height:9px;border-radius:5px}
.kbth-st-wp,.kbth-st-wpfill{position:absolute;inset:0}
.kbth-st-pill{display:block;width:62%;height:18px;border-radius:9px}
.kbth-st-reply{display:block}
.kbth-st-ic4{display:flex;gap:6px;align-items:center;color:var(--dsw-alias-label-secondary)}
.kbth-st-ab{font-size:24px;font-weight:600;line-height:1}
.kbth-st-sws{display:flex;flex-wrap:wrap;gap:9px;align-items:center}
.kbth-st-sw{appearance:none;width:24px;height:24px;border-radius:50%;border:0;padding:0;box-shadow:0 0 0 1px var(--dsw-alias-border-l3);cursor:pointer}
.kbth-st-sw[aria-pressed="true"]{box-shadow:0 0 0 2px var(--dsw-alias-bg-layer-1),0 0 0 4px var(--dsw-alias-brand-primary)}
.kbth-st-sw.auto{background:linear-gradient(135deg,var(--dsw-alias-bg-layer-1) 50%,var(--dsw-alias-label-primary) 50%)}
.kbth-st-own{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;padding:4px 10px;border-radius:999px;border:1px dashed var(--dsw-alias-border-l3);cursor:pointer;color:var(--dsw-alias-label-secondary)}
.kbth-st-own.on{border-style:solid;border-color:var(--dsw-alias-brand-primary)}
.kbth-st-own input{width:18px;height:18px;padding:0;border:0;background:none;cursor:pointer}
.kbth-st-badge{font-size:11.5px;padding:3px 9px;border-radius:999px;border:1px solid var(--kbth-ink,var(--dsw-alias-border-l3));color:var(--kbth-ink,var(--dsw-alias-label-secondary))}
.kbth-st-badge.ok{--kbth-ink:#15803D}
.kbth-st-badge.low{--kbth-ink:#B45309}
.kbth-st-more{border-top:1px solid var(--dsw-alias-border-l2);padding-top:8px}
.kbth-st-more>summary{cursor:pointer;font-size:12.5px;color:var(--dsw-alias-label-secondary);padding:4px 0}
.kbth-st-mb{display:flex;flex-direction:column;gap:12px;padding-top:10px}
.kbth-st-sel{font:inherit;font-size:13px;padding:6px 10px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);min-width:180px}
.kbth-st-lgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(46px,1fr));gap:6px;padding:4px 2px}
.kbth-st-lt{position:relative;appearance:none;height:46px;padding:0;border-radius:12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);display:grid;place-items:center;cursor:pointer;color:var(--dsw-alias-label-secondary)}
.kbth-st-lt:hover{border-color:var(--dsw-alias-border-l4)}
.kbth-st-lt[aria-pressed="true"]{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary)}
.kbth-st-lt.add{border-style:dashed}
.kbth-st-lt::after{content:attr(data-name);position:absolute;bottom:calc(100% + 4px);left:50%;transform:translateX(-50%);z-index:5;padding:3px 8px;border-radius:7px;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-1);font-size:11px;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .1s}
.kbth-st-lt:hover::after,.kbth-st-lt:focus-visible::after{opacity:1}
.kbth-st-fontlist{display:flex;flex-direction:column;gap:6px;max-height:210px;overflow:auto}
.kbth-st-grp{font-size:11px;font-weight:600;color:var(--dsw-alias-label-tertiary);margin-top:4px}
.kbth-st-ft{appearance:none;font:inherit;display:flex;align-items:baseline;gap:7px;padding:7px 9px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer;min-width:0;text-align:start}
.kbth-st-ft b{font-size:17px;font-weight:600}
.kbth-st-ft span{font-size:11.5px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbth-st-ft[aria-pressed="true"]{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary)}
.kbth-st-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.kbth-st-actions .kbth-in{width:auto;flex:1;min-width:150px;max-width:260px}
.kbth-st .kbth-in::placeholder{color:var(--dsw-alias-label-secondary);opacity:1}
.kbth-st .kbth-in{box-sizing:border-box}
.kbth-st-sp{flex:1}
.kbth-st-look{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-1)}
.kbth-st-look.on{border-color:var(--dsw-alias-brand-primary)}
.kbth-st-look.del{padding:3px 10px;gap:8px;font-size:12.5px}
.kbth-st-lookb{appearance:none;border:0;background:none;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);padding:4px 4px 4px 9px;display:inline-flex;align-items:center;gap:7px;cursor:pointer}
.kbth-st-lookb i{width:14px;height:14px;border-radius:50%;box-shadow:0 0 0 1px var(--dsw-alias-border-l3)}
.kbth-st-x{appearance:none;border:0;background:none;color:var(--dsw-alias-label-tertiary);font-size:15px;line-height:1;padding:4px 8px 4px 2px;cursor:pointer}
.kbth-st-x:hover{color:var(--dsw-alias-state-error-primary)}
.kbth-st-classic{border:1px solid var(--dsw-alias-border-l2);border-radius:14px}
.kbth-st-classic>summary{cursor:pointer;padding:13px 16px;font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}
.kbth-st-classic>summary .kbth-hint{margin-left:6px;font-weight:400}
.kbth-st-classic[open]>summary{border-bottom:1px solid var(--dsw-alias-border-l2)}
.kbth-st-classic>.kbth-sec{padding:16px}
[hidden]{display:none!important}

`

      const seg = (opts) => h('div', { className: 'kbth-seg', role: 'group' },
        opts.items.map((it) => h('button', {
          key: it.id, type: 'button', 'aria-pressed': it.on === true ? 'true' : 'false',
          onClick: it.tap,
        }, it.label)))

      const slider = (o) => h('div', { className: 'kbth-sl' },
        h('div', { className: 'kbth-sl-hd' },
          h('span', { className: 'kbth-sl-lb' }, o.label),
          h('span', { className: 'kbth-sl-vl' }, o.text)),
        h('input', {
          type: 'range', className: 'kbth-slider', min: String(o.min), max: String(o.max),
          value: String(o.value), 'aria-label': o.label,
          style: { '--fill': ((o.value - o.min) / (o.max - o.min) * 100).toFixed(1) + '%' },
          onInput: (e) => o.tap(Number(e.target.value)),
        }),
        o.hint ? h('div', { className: 'kbth-hint' }, o.hint) : null)

      // ══════════════════════════════════════════════════════════════════════
      // 5b. THE “ANIMATION” TAB — preview, rotation, status text, settings,
      //     and two windows (library, word pack).
      // ══════════════════════════════════════════════════════════════════════

      const ReactDOM = (() => { try { return require('react-dom') } catch (e) { return null } })()
      const portal = (el) => (ReactDOM !== null && ReactDOM !== undefined && typeof ReactDOM.createPortal === 'function' && typeof document !== 'undefined' && document.body)
        ? ReactDOM.createPortal(el, document.body) : el

      const ldToggle = (label, value, onToggle, hint) => h('div', { className: 'kbth-toggle-row' },
        h('span', { className: 'kbth-toggle-label', style: { flexDirection: 'column', alignItems: 'flex-start', gap: 2 } }, label,
          hint ? h('span', { className: 'kbth-hint' }, hint) : null),
        h('button', { type: 'button', className: 'kbth-toggle' + (value ? ' on' : ''), role: 'switch', 'aria-checked': value ? 'true' : 'false', 'aria-label': label, onClick: onToggle },
          h('span', { className: 'kbth-toggle-knob' })))

      const ldSlug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'anim'
      const ldKo = (n) => knum(n / 1024, n < 10240 ? 1 : 0) + kt(' Ko', ' KB')
      /** A stored duration (« 1,2 s » in the catalogue, « 1.5 s » on an import) in the number format of the page. */
      const ldDurText = (d) => (frPage() ? String(d).replace('.', ',') : String(d).replace(',', '.'))
      const ldDuration = (secs) => (secs < 60 ? secs + 's' : Math.floor(secs / 60) + 'm ' + (secs % 60) + 's')

      /** Cleans an imported SVG: whatever can execute or load something is removed. The host then REFUSES
       *  anything that still contains some; <img> and a CSS mask do not run anything anyway. */
      const ldCleanSvg = (text) => {
        let doc = null
        try { doc = new DOMParser().parseFromString(text, 'image/svg+xml') } catch (e) { return { error: kt('Ce fichier n’est pas un SVG valide.', 'This file is not a valid SVG.') } }
        const root = doc.documentElement
        if (!root || String(root.nodeName).toLowerCase() !== 'svg' || doc.querySelector('parsererror')) return { error: kt('Ce fichier n’est pas un SVG valide.', 'This file is not a valid SVG.') }
        let removed = 0
        doc.querySelectorAll('script,foreignObject,image,iframe,audio,video,link,embed,object').forEach((n) => { n.remove(); removed += 1 })
        doc.querySelectorAll('style').forEach((n) => { if (/@import|url\(\s*['"]?\s*(https?:|data:|\/\/)/i.test(n.textContent || '')) { n.remove(); removed += 1 } })
        doc.querySelectorAll('*').forEach((n) => Array.prototype.slice.call(n.attributes).forEach((a) => {
          const nm = a.name.toLowerCase()
          const v = a.value.trim().toLowerCase()
          if (nm.indexOf('on') === 0 || ((nm === 'href' || nm === 'xlink:href') && v.charAt(0) !== '#') || /url\(\s*['"]?\s*(https?:|data:|\/\/)/.test(v) || v.indexOf('javascript:') >= 0) { n.removeAttribute(a.name); removed += 1 }
        }))
        const svg = new XMLSerializer().serializeToString(root)
        return { svg, removed, animated: !!doc.querySelector('animate,animateTransform,animateMotion,set') || /@keyframes|animation/i.test(text), mono: /currentColor/i.test(svg) }
      }

      /** Reads a dropped file and saves it. Resolves { t: 'ok'|'warn'|'err', text }. */
      const ldImport = (file) => new Promise((resolve) => {
        const done = (t, text) => resolve({ t, text })
        if (file.size > LD_LIMIT) return done('err', kt('« ' + file.name + ' » pèse ' + ldKo(file.size) + ' : la limite est de 200 Ko. Simplifie l’animation ou réduise ses images.', '“' + file.name + '” weighs ' + ldKo(file.size) + ': the limit is 200 KB. Simplify the animation or reduce its images.'))
        const ext = (String(file.name).split('.').pop() || '').toLowerCase()
        const base = String(file.name).replace(/\.[^.]+$/, '')
        const id = ldSlug(base) + '-' + Date.now().toString(36)
        const reader = new FileReader()
        const save = async (rec, okText) => {
          const r = await ldAddRecord(rec)
          if (r.ok !== true) done('err', r.error ? kt('Refusée par DSH : ' + r.error + '.', 'Refused by DSH: ' + r.error + '.') : kt('Refusée par DSH : raison inconnue.', 'Refused by DSH: unknown reason.'))
          else if (r.local === true) done('warn', okText + kt(' Elle n’est pas enregistrée sur le disque : elle reste dans ce navigateur jusqu’au rechargement.', ' It is not saved to disk: it stays in this browser until the page reloads.'))
          else done('ok', okText)
        }
        reader.onerror = () => done('err', kt('Le fichier n’a pas pu être lu.', 'The file could not be read.'))
        if (ext === 'svg') {
          reader.onload = () => {
            const r = ldCleanSvg(String(reader.result))
            if (r.error) return done('err', r.error)
            save({ id, name: base.slice(0, 60), type: 'svg', kind: r.mono ? 'mono' : 'color', source: 'file', data: r.svg },
              kt('« ' + base + ' » ajoutée à Mes animations.', '“' + base + '” added to My animations.') +
                (r.removed ? ' ' + (r.removed === 1 ? kt('1 élément dangereux retiré.', '1 dangerous element removed.') : kt(r.removed + ' éléments dangereux retirés.', r.removed + ' dangerous elements removed.')) : '') +
                (r.animated ? '' : ' ' + kt('Ce SVG n’est pas animé : il apparaîtra fixe.', 'This SVG is not animated: it will appear still.')))
          }
          reader.readAsText(file)
        } else if (ext === 'json') {
          reader.onload = () => {
            let d = null
            try { d = JSON.parse(String(reader.result)) } catch (e) { return done('err', kt('Ce fichier n’est pas du JSON valide.', 'This file is not valid JSON.')) }
            if (!(d !== null && typeof d === 'object' && Array.isArray(d.layers) && typeof d.fr === 'number' && typeof d.w === 'number')) return done('err', kt('Ce JSON n’est pas une animation Lottie (il manque layers, fr ou w).', 'This JSON is not a Lottie animation (layers, fr or w is missing).'))
            const name = (typeof d.nm === 'string' && d.nm.trim() !== '' ? d.nm : base).slice(0, 60)
            const dur = typeof d.op === 'number' && d.fr > 0 ? (((d.op - (d.ip || 0)) / d.fr).toFixed(1) + ' s') : ''
            save({ id, name, type: 'lottie', kind: 'color', source: 'file', dur, data: d }, kt('« ' + name + ' » (Lottie) ajoutée à Mes animations.', '“' + name + '” (Lottie) added to My animations.'))
          }
          reader.readAsText(file)
        } else if (ext === 'gif' || ext === 'webp' || ext === 'png') {
          reader.onload = () => save({ id, name: base.slice(0, 60), type: 'img', kind: 'color', source: 'file', data: String(reader.result) }, kt('« ' + base + ' » ajoutée à Mes animations.', '“' + base + '” added to My animations.'))
          reader.readAsDataURL(file)
        } else done('err', kt('Format « .' + ext + ' » non pris en charge. Utilise SVG, JSON (Lottie), GIF ou WebP.', 'Format “.' + ext + '” is not supported. Use SVG, JSON (Lottie), GIF or WebP.'))
      })

      /** An animation node, mounted in a React <span>. */
      function LdView(props) {
        const ref = React.useRef(null)
        const l = props.l
        React.useEffect(() => {
          const host = ref.current
          if (host === null || host === undefined) return undefined
          host.textContent = ''
          const node = ldNode(l, props.px)
          if (props.spd !== undefined) node.style.setProperty('--kb-spd', String(props.spd))
          if (props.tint) node.style.setProperty('--kb-tint', 'var(--dsw-alias-brand-primary)')
          if (props.late > 0) { node.classList.add('kb-late'); node.style.setProperty('--kb-late', props.late + 'ms') }
          host.appendChild(node)
          return () => { ldDestroy(node) }
        }, [l.id, l.type, props.px, props.spd, props.tint, props.late, props.nonce])
        return h('span', { ref, style: { display: 'inline-flex' } })
      }

      const ldCopy = (text, then) => {
        try { navigator.clipboard.writeText(text).then(() => then(true), () => then(false)) } catch (e) { then(false) }
      }
      /** A list of text nodes (not a sentence): the page translator goes node by node. */
      const ldSummaryHint = () => {
        const sel = ld.S.sel.map(ldById).filter((x) => x !== null)
        const p = ldPackById(ld.S.pack)
        const names = []
        sel.forEach((l, i) => { if (i > 0) names.push(', '); names.push(l.name) })
        return (sel.length > 0 ? names.concat([' · ', ld.S.mode === 'random' ? kt('au hasard', 'at random') : kt('dans l’ordre', 'in order')]) : [kt('Queue de baleine de DSH', 'DSH whale tail')]).concat([' · ', kt('texte :', 'text:'), ' ', p.name])
      }

      /** The summary line of Essentials: points to the Animation tab. */
      function LdSummary(props) {
        const [, bump] = React.useReducer((x) => x + 1, 0)
        React.useEffect(() => { ld.subs.add(bump); return () => { ld.subs.delete(bump) } }, [])
        const sel = ld.S.sel.map(ldById).filter((x) => x !== null)
        return h('div', { className: 'kbth-sum', 'data-kb': 'ld-summary' },
          h('div', { className: 'kbth-sum-ic' }, sel.length > 0
            ? sel.map((l) => h(LdView, { key: l.id, l, px: 28, spd: 1 }))
            : h('svg', { width: 28, height: 28, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' }, h('path', { d: LD_WHALE, stroke: 'currentColor', strokeWidth: 1 }))),
          h('div', { className: 'kbth-sum-tx' },
            h('span', { className: 'kbth-sec-t', style: { textTransform: 'none', fontSize: 13 } }, kt('Animation de réflexion ', 'Thinking animation '), h('span', { className: 'kbth-new' }, kt('Nouveau', 'NEW'))),
            h('span', { className: 'kbth-hint' }, ldSummaryHint())),
          h('button', { type: 'button', className: 'kbth-btn', 'data-kb': 'ld-open', onClick: props.onOpen }, kt('Régler…', 'Adjust…')))
      }

      function AnimationPane(props) {
        const ctx = props.ctx
        if (ld.ctx === null) ld.ctx = ctx
        const [, bump] = React.useReducer((x) => x + 1, 0)
        const [modal, setModal] = React.useState(null)          // null | 'picker' | 'pack'
        const [tab, setTab] = React.useState('examples')
        const [filter, setFilter] = React.useState('all')
        const [ambOpen, setAmbOpen] = React.useState(false)
        const [ambQ, setAmbQ] = React.useState('')
        const [ambIdx, setAmbIdx] = React.useState(0)
        const [setOpen, setSetOpen] = React.useState(false)
        const [note, setNote] = React.useState(null)           // window banner: { t, text }
        const [drawn, setDrawn] = React.useState(null)         // the preview: { id, word, t0, hist }
        const [wordDraft, setWordDraft] = React.useState('')
        const [prompt, setPrompt] = React.useState('')
        const [job, setJob] = React.useState('')
        const [waiting, setWaiting] = React.useState(null)     // { kind: 'loader'|'words', base: n }
        const [copied, setCopied] = React.useState('')
        const [over, setOver] = React.useState(false)
        const memo = React.useRef({ l: {}, w: {} })
        const ambBox = React.useRef(null)
        const ambInput = React.useRef(null)
        const dlg = React.useRef(null)
        const lastBtn = React.useRef(null)

        React.useEffect(() => {
          ld.subs.add(bump)
          ldPull(true)
          const poll = setInterval(() => { try { if (document.visibilityState !== 'hidden') ldPull(true) } catch (e) { /* page closed */ } }, 4000)
          const clock = setInterval(bump, 1000)
          return () => { ld.subs.delete(bump); clearInterval(poll); clearInterval(clock) }
        }, [])
        const draw = () => {
          const l = ldChoose(memo.current.l)
          const w = ldChooseWord(memo.current.w)
          setDrawn((cur) => ({ id: l === null ? null : l.id, word: w, t0: Date.now() - 12000, hist: [l === null ? null : l.name].concat(cur === null ? [] : cur.hist).filter((x) => x !== null).slice(0, 4), nonce: (cur === null ? 0 : cur.nonce) + 1 }))
        }
        React.useEffect(() => { draw() }, [])
        // “I just asked the chat for an animation / words”: we wait for them to arrive on disk.
        React.useEffect(() => {
          if (waiting === null) return
          if (waiting.kind === 'loader') {
            const n = ld.mine.filter((l) => l.source === 'skill').length
            if (n > waiting.base) {
              const fresh = ld.mine.filter((l) => l.source === 'skill')[0]
              setNote({ t: 'ok', text: kt('« ' + fresh.name + ' » est dans Mes animations. Ajoute-la à ta rotation.', '“' + fresh.name + '” is in My animations. Add it to your rotation.') }); setTab('mine'); setWaiting(null)
            }
          } else if (ld.words.length > waiting.base) {
            setNote({ t: 'ok', text: (ld.words.length - waiting.base === 1 ? kt('1 mot ajouté à ton pack.', '1 word added to your pack.') : kt((ld.words.length - waiting.base) + ' mots ajoutés à ton pack.', (ld.words.length - waiting.base) + ' words added to your pack.')) }); setWaiting(null)
          }
        })
        // Window: Escape closes it, Tab stays inside, focus returns to the original button.
        React.useEffect(() => {
          if (modal === null) return undefined
          const el = dlg.current
          if (el !== null && el !== undefined && typeof el.focus === 'function') el.focus()
          const key = (e) => {
            if (e.key === 'Escape' && !ambOpen) { e.preventDefault(); e.stopPropagation(); close(); return }
            if (e.key === 'Tab' && dlg.current) {
              // Always handled by us: DSH's settings dialog has its own focus trap, and the
              // window sits outside it (portal) — leaving it to the browser would mean falling out of it.
              const f = Array.prototype.slice.call(dlg.current.querySelectorAll('button,input,textarea,select,a[href],[tabindex="0"]')).filter((x) => !x.disabled && x.offsetParent !== null)
              e.preventDefault(); e.stopPropagation()
              if (f.length === 0) return
              const i = f.indexOf(document.activeElement)
              const next = i < 0 ? (e.shiftKey ? f.length - 1 : 0) : (i + (e.shiftKey ? -1 : 1) + f.length) % f.length
              f[next].focus()
            }
          }
          document.addEventListener('keydown', key, true)
          return () => document.removeEventListener('keydown', key, true)
        }, [modal])
        React.useEffect(() => { if (ambOpen && ambInput.current) ambInput.current.focus() }, [ambOpen])
        React.useEffect(() => {
          if (!ambOpen) return undefined
          const outside = (e) => { if (ambBox.current && !ambBox.current.contains(e.target)) setAmbOpen(false) }
          document.addEventListener('mousedown', outside)
          return () => document.removeEventListener('mousedown', outside)
        }, [ambOpen])

        const open = (kind, e) => { lastBtn.current = e && e.currentTarget ? e.currentTarget : null; setNote(null); setModal(kind) }
        const close = () => { setModal(null); setWaiting(null); if (lastBtn.current && lastBtn.current.focus) { try { lastBtn.current.focus() } catch (e) { /* bouton parti */ } } }

        const S = ld.S
        const sel = S.sel.map(ldById).filter((x) => x !== null)
        const cur = drawn !== null && drawn.id !== null ? ldById(drawn.id) : null
        const px = cur === null ? 14 : LD_SIZES[S.size]
        const secs = drawn === null ? 12 : Math.floor((Date.now() - drawn.t0) / 1000)
        const tAcc = (() => { try { return readState().acc !== null } catch (e) { return false } })()

        // DSH's phrase, with its template and duration, of which we replace the base word.
        const label = (() => {
          const dur = ldDuration(secs)
          let s = 'Deep diving for ' + dur + ' ···'
          try { s = String(ctx.locale.bind('chat')('chat.deepDivingFor', { duration: dur })) } catch (e) { /* gabarit de repli */ }
          const base = ldBase()
          const word = drawn === null ? null : drawn.word
          if (word && base !== '' && s.indexOf(base) >= 0 && word.indexOf(base) < 0) s = S.dur ? s.replace(base, () => word) : word + ' ···'
          return s
        })()

        const preview = h('div', { className: 'kbth-sec', style: { gap: 10 } },
          h('div', { className: 'kbth-sec-t', style: { fontSize: 13, textTransform: 'none' } }, kt('Aperçu', 'Preview')),
          h('div', { className: 'kbth-ldp', 'data-kb': 'ld-preview' },
            h('div', { className: 'kbth-ldp-user' }, kt('Peux-tu ranger les fichiers du dossier docs ?', 'Can you tidy the files in the docs folder?')),
            h('div', { className: 'kbth-ldp-step' }, kt('Lecture de 3 fichiers', 'Reading 3 files')),
            h('div', { className: 'kbth-ldp-run' + (S.keep ? '' : ' nolabel') },
              h('span', { className: 'kbth-ldp-div' }),
              h('span', { className: 'kbth-ldp-ct' },
                h('span', { className: 'kbth-ldp-ic', style: { '--kb-px': px + 'px' } },
                  cur === null
                    ? h('svg', { className: 'kbth-ldp-whale', width: '100%', height: '100%', viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' }, h('path', { d: LD_WHALE, stroke: 'currentColor', strokeWidth: 1 }))
                    : h(LdView, { key: cur.id + ':' + drawn.nonce, l: cur, px, spd: S.speed, tint: S.tint && tAcc, late: S.delay, nonce: drawn.nonce })),
                h('span', { className: 'kbth-ldp-text', 'data-kb': 'ld-label' }, label)))),
          h('div', { className: 'kbth-ldp-bar' },
            h('button', { type: 'button', className: 'kbth-btn', 'data-kb': 'ld-draw', disabled: sel.length === 0, onClick: draw }, kt('↻ Simuler une réponse', '↻ Simulate a reply')),
            cur !== null ? h('span', null, kt('Animation tirée : ', 'Animation drawn: '), h('b', { style: { color: 'var(--dsw-alias-label-primary)' } }, cur.name)) : h('span', null, kt('Aucune animation choisie : la queue de baleine de DSH s’affiche.', 'No animation chosen: the DSH whale tail is shown.')),
            drawn !== null && drawn.hist.length > 1 ? drawn.hist.map((n, i) => h('span', { key: i + n, className: 'kbth-ldchip' + (i === 0 ? ' cur' : '') }, n)) : null))

        // ── Rotation ────────────────────────────────────────────────────────
        const slots = [0, 1, 2, 3].map((i) => {
          const l = sel[i]
          if (l === undefined) return h('div', { key: 'e' + i, className: 'kbth-lds empty' }, kt('Libre', 'Free'))
          return h('div', { key: l.id, className: 'kbth-lds' + (cur !== null && cur.id === l.id ? ' cur' : '') },
            S.mode === 'order' ? h('span', { className: 'kbth-lds-ord' }, String(i + 1)) : null,
            h('button', { type: 'button', className: 'kbth-lds-x', 'aria-label': kt('Retirer ', 'Remove ') + l.name, 'data-kb': 'ld-remove', 'data-id': l.id, onClick: () => ldSet({ sel: S.sel.filter((x) => x !== l.id) }) },
              h('svg', { width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': 'true' }, h('path', { d: 'M2 2l8 8M10 2l-8 8', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }))),
            h('div', { className: 'kbth-lds-pv' }, h(LdView, { l, px: 40, spd: S.speed, tint: S.tint && tAcc })),
            h('div', { className: 'kbth-lds-nm', title: l.name }, l.name))
        })
        const surpriseAnim = () => {
          const pool = LD_PRESETS.slice(); const pick = []
          while (pick.length < 3 && pool.length > 0) pick.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0].id)
          ldSet({ sel: pick }); memo.current = { l: {}, w: memo.current.w }; setTimeout(draw, 0)
        }
        const rotation = h('div', { className: 'kbth-sec', style: { gap: 10 } },
          h('div', { className: 'kbth-row', style: { justifyContent: 'space-between' } },
            h('div', { className: 'kbth-sec-t', style: { fontSize: 13, textTransform: 'none' } }, kt('Ma rotation ', 'My rotation '), h('span', { className: 'kbth-hint' }, '— ', String(sel.length), ' ', kt('sur', 'of'), ' ', String(LD_MAX))),
            seg({ items: [
              { id: 'random', label: kt('Au hasard', 'Random'), on: S.mode === 'random', tap: () => ldSet({ mode: 'random' }) },
              { id: 'order', label: kt('Dans l’ordre', 'In order'), on: S.mode === 'order', tap: () => ldSet({ mode: 'order' }) }] })),
          sel.length === 0 ? h('div', { className: 'kbth-note' }, kt('Rien n’est choisi : DSH garde sa queue de baleine.', 'Nothing is chosen: DSH keeps its whale tail.')) : null,
          h('div', { className: 'kbth-ldt' }, slots),
          h('div', { className: 'kbth-row', style: { gap: 8 } },
            h('button', { type: 'button', className: 'kbth-btn', 'data-kb': 'ld-open-picker', onClick: (e) => { setTab('examples'); open('picker', e) } }, sel.length < LD_MAX ? kt('+ Ajouter une animation…', '+ Add an animation…') : kt('Parcourir la bibliothèque…', 'Browse the library…')),
            h('button', { type: 'button', className: 'kbth-btn', 'data-kb': 'ld-surprise-anim', onClick: surpriseAnim }, kt('✦ Me surprendre', '✦ Surprise me'))))

        // ── Status text: a large ambiance picker ───────────────────
        const plat = (x) => String(x).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        const ambs = LD_PACKS.concat([{ id: 'perso', name: kt('Mon pack', 'My pack'), custom: true, words: { fr: ld.words, en: ld.words } }])
        // A preview that LIVES: three words scrolling in the list every 3 s, each ambiance starting from a
        // different place. The first three, frozen, gave the impression that the pack stopped there.
        const ambSample = (p) => {
          if (p.orig === true) return '« Deep diving for 12s ··· »'
          const w = (p.words[ldLang()] && p.words[ldLang()].length > 0) ? p.words[ldLang()] : p.words.en
          if (w.length === 0) return kt('Aucun mot pour l’instant', 'No words yet')
          if (w.length <= 3) return w.join(' · ')
          const o = (Math.floor(Date.now() / 3000) + ldHash(p.id)) % w.length
          return [0, 1, 2].map((i) => w[(o + i) % w.length]).join(' · ') + '…'
        }
        const ambList = ambs.filter((p) => plat(p.name).indexOf(plat(ambQ)) >= 0)
        const ambCur = ambs.find((p) => p.id === S.pack) || ambs[0]
        const pickAmb = (id) => { ldSet({ pack: id }); setAmbOpen(false); setAmbQ(''); setAmbIdx(0); memo.current.w = {}; setTimeout(draw, 0) }
        const disabledAmb = (p) => p.custom === true && ld.words.length === 0
        const ambKey = (e) => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setAmbOpen(false); return }
          if (e.key === 'ArrowDown') { e.preventDefault(); setAmbIdx((i) => Math.min(i + 1, ambList.length - 1)); return }
          if (e.key === 'ArrowUp') { e.preventDefault(); setAmbIdx((i) => Math.max(i - 1, 0)); return }
          if (e.key === 'Enter') { e.preventDefault(); const p = ambList[ambIdx]; if (p !== undefined && !disabledAmb(p)) pickAmb(p.id) }
        }
        const surpriseText = () => {
          const c = ambs.filter((p) => !p.orig && p.id !== S.pack && !disabledAmb(p))
          pickAmb(c[Math.floor(Math.random() * c.length)].id)
        }
        const texte = h('div', { className: 'kbth-sec', style: { gap: 10 } },
          h('div', { className: 'kbth-row', style: { justifyContent: 'space-between' } },
            h('div', { className: 'kbth-sec-t', style: { fontSize: 13, textTransform: 'none' } }, kt('Texte d’état', 'Status text')),
            h('span', { className: 'kbth-hint' }, kt('Aujourd’hui :', 'Today:'), ' « Deep diving for 12s ··· »')),
          h('div', { className: 'kbth-fsel', ref: ambBox, 'data-kb': 'ld-amb' },
            h('button', { type: 'button', className: 'kbth-fsbtn', 'aria-haspopup': 'listbox', 'aria-expanded': String(ambOpen), onClick: () => { setAmbOpen((o) => !o); setAmbQ(''); setAmbIdx(0) } },
              h('span', { className: 'kbth-fsname' }, ambCur.name),
              h('span', { className: 'kbth-fschev' },
                h('svg', { width: 15, height: 15, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
                  h('path', { d: ambOpen ? 'M3.5 10.5 8 6l4.5 4.5' : 'M3.5 5.5 8 10l4.5-4.5', stroke: 'currentColor', strokeWidth: '1.6', strokeLinecap: 'round', strokeLinejoin: 'round' })))),
            h('div', { className: 'kbth-fsmeta' }, ambSample(ambCur)),
            ambOpen ? h('div', { className: 'kbth-fspanel' },
              h('input', { className: 'kbth-fssearch', ref: ambInput, value: ambQ, placeholder: kt('Rechercher une ambiance…', 'Search an ambiance…'), 'aria-label': kt('Rechercher une ambiance', 'Search an ambiance'), onInput: (e) => { setAmbQ(e.target.value); setAmbIdx(0) }, onKeyDown: ambKey }),
              h('div', { className: 'kbth-fslist', role: 'listbox' },
                ambList.length === 0 ? h('div', { className: 'kbth-fsempty' }, kt('Aucune ambiance ne correspond.', 'No ambiance matches.'))
                  : ambList.map((p, i) => h('button', { key: p.id, type: 'button', role: 'option', className: 'kbth-fsopt', 'aria-selected': p.id === S.pack ? 'true' : 'false', 'data-actif': i === ambIdx ? '1' : '0', 'data-id': p.id, disabled: disabledAmb(p), onMouseEnter: () => setAmbIdx(i), onClick: () => pickAmb(p.id) },
                    h('span', { className: 'kbth-fsopt-name' }, p.name),
                    h('span', { className: 'kbth-fsopt-sample' }, ambSample(p)))))) : null),
          h('div', { className: 'kbth-row', style: { gap: 8 } },
            h('button', { type: 'button', className: 'kbth-btn', 'data-kb': 'ld-surprise-text', onClick: surpriseText }, kt('✦ Me surprendre', '✦ Surprise me')),
            h('button', { type: 'button', className: 'kbth-btn', 'data-kb': 'ld-open-pack', onClick: (e) => open('pack', e) }, kt('Modifier mon pack…', 'Edit my pack…'))))

        // ── Settings (collapsed) ──────────────────────────────────────────────
        const sizeName = S.size === 'compact' ? kt('Compacte', 'Compact') : (S.size === 'large' ? kt('Grande', 'Large') : 'Standard')
        const summary = [sizeName, ' · ' + LD_SIZES[S.size] + ' px · ', kt('vitesse', 'speed'), ' ' + knum(S.speed, 2) + kt(' × · ', '× · '), S.rot === 'fixed' ? kt('un mot par réponse', 'one word per reply') : (S.rot === '8' ? kt('un mot toutes les 8 s', 'one word every 8 s') : kt('un mot toutes les 15 s', 'one word every 15 s'))]
        const reglages = h('div', { className: 'kbth-sec', style: { gap: 8 } },
          h('button', { type: 'button', className: 'kbth-disc', 'aria-expanded': String(setOpen), 'data-kb': 'ld-settings', onClick: () => setSetOpen((o) => !o) },
            h('span', { className: 'kbth-disc-t' }, kt('Réglages', 'Settings')), h('span', { className: 'kbth-disc-s', title: summary.join('') }, summary),
            h('span', { className: 'kbth-fschev' }, h('svg', { width: 15, height: 15, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' }, h('path', { d: setOpen ? 'M3.5 10.5 8 6l4.5 4.5' : 'M3.5 5.5 8 10l4.5-4.5', stroke: 'currentColor', strokeWidth: '1.6', strokeLinecap: 'round', strokeLinejoin: 'round' })))),
          setOpen ? h('div', { className: 'kbth-setbody' },
            h('div', { className: 'kbth-grp' }, 'Animation'),
            h('div', { className: 'kbth-row' }, h('span', { className: 'kbth-lb' }, kt('Taille', 'Size')),
              seg({ items: [
                { id: 'compact', label: kt('Compacte · 14 px', 'Compact · 14 px'), on: S.size === 'compact', tap: () => ldSet({ size: 'compact' }) },
                { id: 'standard', label: 'Standard · 24 px', on: S.size === 'standard', tap: () => ldSet({ size: 'standard' }) },
                { id: 'large', label: kt('Grande · 40 px', 'Large · 40 px'), on: S.size === 'large', tap: () => ldSet({ size: 'large' }) }] })),
            ldToggle(kt('Teinter avec l’accent du thème', 'Tint with the theme accent'), S.tint, () => ldSet({ tint: !S.tint }), kt('Les animations d’une couleur prennent l’accent. Les autres gardent leurs couleurs.', 'Single-colour animations take the accent. The others keep their colours.')),
            slider({ label: kt('Vitesse', 'Speed'), min: 50, max: 200, value: Math.round(S.speed * 100), text: knum(S.speed, 2) + kt(' ×', '×'), tap: (v) => ldSet({ speed: v / 100 }) }),
            ldToggle(kt('Ne jamais répéter la même d’affilée', 'Never repeat the same one twice in a row'), S.avoid, () => ldSet({ avoid: !S.avoid })),
            slider({ label: kt('Délai avant affichage', 'Delay before showing'), min: 0, max: 1000, value: S.delay, text: S.delay + ' ms', tap: (v) => ldSet({ delay: Math.round(v / 50) * 50 }), hint: kt('Évite un clignotement sur les réponses très rapides.', 'Avoids a flicker on very quick replies.') }),
            h('div', { className: 'kbth-grp', style: { marginTop: 4 } }, kt('Texte', 'Text')),
            ldToggle(kt('Garder le texte d’état', 'Keep the status text'), S.keep, () => ldSet({ keep: !S.keep }), kt('Sans lui, seule l’animation reste dans la ligne de statut.', 'Without it, only the animation stays in the status line.')),
            h('div', { className: 'kbth-row' }, h('span', { className: 'kbth-lb' }, kt('Changement', 'Change')),
              seg({ items: [
                { id: 'fixed', label: kt('Un mot par réponse', 'One word per reply'), on: S.rot === 'fixed', tap: () => ldSet({ rot: 'fixed' }) },
                { id: '8', label: kt('Toutes les 8 s', 'Every 8 s'), on: S.rot === '8', tap: () => ldSet({ rot: '8' }) },
                { id: '15', label: kt('Toutes les 15 s', 'Every 15 s'), on: S.rot === '15', tap: () => ldSet({ rot: '15' }) }] })),
            ldToggle(kt('Afficher la durée', 'Show the duration'), S.dur, () => ldSet({ dur: !S.dur }), kt('« … for 12s » reste à droite du mot.', '“… for 12s” stays to the right of the word.')),
            h('div', { className: 'kbth-note' }, kt('Animations réduites : l’image fixe remplace l’animation. Le réglage du système est respecté.', 'Reduced motion: a still image replaces the animation. The system setting is respected.')),
            h('div', { className: 'kbth-row' }, h('button', { type: 'button', className: 'kbth-btn', 'data-kb': 'ld-reset', onClick: () => ldSet({ ...LD_DEF, sel: S.sel, pack: S.pack }) }, kt('Rétablir ces réglages', 'Reset these settings')))) : null)

        // ── Window: library ──────────────────────────────────────────
        const toggleSel = (id) => {
          if (S.sel.indexOf(id) >= 0) ldSet({ sel: S.sel.filter((x) => x !== id) })
          else if (S.sel.length < LD_MAX) ldSet({ sel: S.sel.concat([id]) })
          setTimeout(draw, 0)
        }
        const card = (l, mine) => {
          const on = S.sel.indexOf(l.id) >= 0
          const full = S.sel.length >= LD_MAX && !on
          const kindLabel = l.type !== 'inline' && l.kind !== 'mono' ? kt('Couleurs d’origine', 'Original colours') : (l.kind === 'mono' ? kt('Une couleur', 'One colour') : kt('Colorée', 'Colourful'))
          return h('div', { key: l.id, className: 'kbth-lcard' + (on ? ' on' : ''), 'data-id': l.id },
            h('div', { className: 'kbth-lcard-pv' }, h(LdView, { l, px: 36, spd: 1, tint: S.tint && tAcc })),
            h('div', { className: 'kbth-lcard-nm', title: l.name }, l.name),
            h('div', { className: 'kbth-lcard-meta' }, kindLabel, l.dur ? ' · ' + ldDurText(l.dur) : null, mine ? ' · ' : null, mine ? (l.source === 'skill' ? 'Skill' : kt('Fichier', 'File')) : null, mine && typeof l.size === 'number' ? ' · ' + ldKo(l.size) : null),
            l.prompt ? h('div', { className: 'kbth-lcard-meta', style: { fontStyle: 'italic' } }, '« ' + l.prompt + ' »') : null,
            h('div', { className: 'kbth-lcard-acts' },
              h('button', { type: 'button', className: 'kbth-btn' + (on ? '' : ' kbth-ldpri'), 'data-kb': 'ld-toggle', 'data-id': l.id, disabled: full, title: full ? kt('Retire-en une pour en ajouter une autre', 'Remove one to add another') : undefined, onClick: () => toggleSel(l.id) }, on ? kt('Retirer', 'Remove') : (full ? kt('Rotation pleine', 'Rotation full') : kt('Ajouter', 'Add'))),
              mine ? h('button', { type: 'button', className: 'kbth-btn del', 'aria-label': kt('Supprimer ', 'Delete ') + l.name, 'data-kb': 'ld-delete', 'data-id': l.id, onClick: () => { ldDelRecord(l.id).then(draw) } }, kt('Suppr.', 'Del.')) : null))
        }
        const ex = tab === 'examples'
        const exList = LD_PRESETS.filter((l) => filter === 'all' || l.kind === filter)
        const onDrop = (e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) ldImport(f).then((r) => { setNote({ t: r.t, text: r.text }); if (r.t !== 'err') setTab('mine') }) }
        const addTab = h('div', { className: 'kbth-add2' },
          h('div', { className: 'kbth-panel2' },
            h('h4', null, kt('Importer un fichier', 'Import a file')),
            h('p', null, kt('SVG animé, Lottie (.json), GIF ou WebP animé. 200 Ko au maximum.', 'Animated SVG, Lottie (.json), animated GIF or WebP. 200 KB at most.')),
            h('div', { className: 'kbth-drop' + (over ? ' over' : ''), onDragEnter: (e) => { e.preventDefault(); setOver(true) }, onDragOver: (e) => { e.preventDefault(); setOver(true) }, onDragLeave: () => setOver(false), onDrop },
              h('span', null, kt('Dépose un fichier ici', 'Drop a file here')),
              h('label', { className: 'kbth-btn', style: { cursor: 'pointer' } }, kt('Choisir un fichier', 'Choose a file'),
                h('input', { type: 'file', accept: '.svg,.json,.gif,.webp,.png', 'data-kb': 'ld-file', style: { display: 'none' }, onChange: (e) => {
                  const input = e.target; const f = input.files && input.files[0]
                  if (!f) return
                  ldImport(f).then((r) => { setNote({ t: r.t, text: r.text }); if (r.t !== 'err') setTab('mine') })
                  input.value = ''
                } }))),
            h('p', null, kt('Avant usage, DSH retire les scripts, les liens externes et les images intégrées du fichier.', 'Before use, DSH removes scripts, external links and embedded images from the file.'))),
          h('div', { className: 'kbth-panel2' },
            h('h4', null, kt('Créer avec Claude', 'Create with Claude')),
            h('p', null, kt('Décris l’animation, colle la commande dans le chat : le skill « loader » la dessine et elle apparaît ici toute seule.', 'Describe the animation, paste the command in the chat: the “loader” skill draws it and it appears here by itself.')),
            h('textarea', { className: 'kbth-ta', value: prompt, placeholder: kt('Trois points qui rebondissent, en suivant mon accent', 'Three bouncing dots, following my accent'), 'aria-label': kt('Description de l’animation', 'Animation description'), onInput: (e) => setPrompt(e.target.value) }),
            h('div', { className: 'kbth-codeln' }, h('span', null, '/skill-loader ' + (prompt.trim() === '' ? kt('trois points qui rebondissent', 'three bouncing dots') : prompt.trim())),
              h('button', { type: 'button', className: 'kbth-link', 'data-kb': 'ld-copy', onClick: () => ldCopy('/skill-loader ' + (prompt.trim() === '' ? kt('trois points qui rebondissent', 'three bouncing dots') : prompt.trim()), (ok) => { setCopied(ok ? 'loader' : 'fail'); setWaiting({ kind: 'loader', base: ld.mine.filter((l) => l.source === 'skill').length }) }) }, copied === 'loader' ? kt('Copié', 'Copied') : kt('Copier', 'Copy'))),
            waiting !== null && waiting.kind === 'loader' ? h('div', { className: 'kbth-hint', role: 'status' }, kt('En attente de l’animation… colle la commande dans le chat. Cette fenêtre la détecte seule.', 'Waiting for the animation… paste the command in the chat. This window detects it by itself.')) : null,
            copied === 'fail' ? h('div', { className: 'kbth-hint' }, kt('Copie impossible : sélectionne la commande ci-dessus.', 'Copy failed: select the command above.')) : null))
        const picker = h('div', { className: 'kbth-mdlg', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'kbth-ld-mt', tabIndex: -1, ref: dlg, 'data-kb': 'ld-picker', onKeyDown: (e) => e.stopPropagation() },
          h('div', { className: 'kbth-mhd' }, h('h3', { id: 'kbth-ld-mt' }, kt('Ajouter une animation', 'Add an animation')), h('span', { className: 'kbth-hint' }, String(sel.length), ' ', 'sur', ' ', String(LD_MAX), ' ', kt('dans la rotation', 'in the rotation')),
            h('button', { type: 'button', className: 'kbth-mx', 'aria-label': kt('Fermer', 'Close'), onClick: close }, '×')),
          h('div', { className: 'kbth-mbody' },
            h('div', { className: 'kbth-pills' },
              [['examples', kt('Exemples', 'Examples'), LD_PRESETS.length], ['mine', kt('Mes animations', 'My animations'), ld.mine.length], ['add', kt('Ajouter la tienne', 'Add your own'), null]].map((t) =>
                h('button', { key: t[0], type: 'button', className: 'kbth-cat', 'aria-pressed': tab === t[0] ? 'true' : 'false', 'data-kb': 'ld-tab', 'data-id': t[0], onClick: () => { setTab(t[0]); setNote(null) } }, t[1], t[2] === null ? null : ' (' + t[2] + ')'))),
            note !== null ? h('div', { className: 'kbth-status ' + note.t, role: 'status', 'data-kb': 'ld-note' }, note.text) : null,
            ld.hostState === 'off' && ldHostOn() ? h('div', { className: 'kbth-status warn' }, kt('Le disque de DSH ne répond pas : tes importations restent dans ce navigateur jusqu’au rechargement.', 'DSH’s disk does not answer: your imports stay in this browser until it reloads.')) : null,
            tab === 'add' ? addTab : h('div', { className: 'kbth-sec', style: { gap: 10 } },
              ex ? h('div', { className: 'kbth-pills' }, [['all', kt('Toutes', 'All')], ['mono', kt('Une couleur', 'One colour')], ['color', kt('Colorées', 'Colourful')]].map((f) =>
                h('button', { key: f[0], type: 'button', className: 'kbth-pillb', 'aria-pressed': filter === f[0] ? 'true' : 'false', onClick: () => setFilter(f[0]) }, f[1]))) : null,
              (ex ? exList : ld.mine).length > 0
                ? h('div', { className: 'kbth-lgrid' }, (ex ? exList : ld.mine).map((l) => card(l, !ex)))
                : h('div', { className: 'kbth-note' }, kt('Tu n’as encore rien ajouté. Importe un fichier ou demande au skill d’en dessiner une, dans « Ajouter la tienne ».', 'You have not added anything yet. Import a file or ask the skill to draw one, in “Add your own”.')),
              ex ? h('div', { className: 'kbth-note' }, h('b', null, kt('Les animations de tes références ne sont pas incluses. ', 'The animations of your references are not included. ')), kt('Les deux liens Dribbble montrent le même pack Lottie en couleurs, qui appartient à son auteur. Si tu l’as, importe ses fichiers .json dans « Ajouter la tienne ».', 'The two Dribbble links show the same colour Lottie pack, which belongs to its author. If you have it, import its .json files in “Add your own”.')) : null)),
          h('div', { className: 'kbth-mft' },
            h('span', { className: 'kbth-hint', style: { flex: 1 } }, sel.length >= LD_MAX ? kt('Rotation pleine : retire-en une pour en ajouter une autre.', 'Rotation full: remove one to add another.') : ''),
            h('button', { type: 'button', className: 'kbth-btn kbth-ldpri', onClick: close }, kt('Terminé', 'Done'))))

        // ── Window: my word pack ──────────────────────────────────────
        const addWord = () => { const w = wordDraft.trim(); if (w !== '') { ldPutWords(ld.words.concat([w])); setWordDraft('') } }
        const packCmd = '/skill-loading-text ' + (job.trim() === '' ? kt('sage-femme libérale', 'freelance midwife') : job.trim())
        const packModal = h('div', { className: 'kbth-mdlg', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'kbth-ld-mt', tabIndex: -1, ref: dlg, 'data-kb': 'ld-pack', onKeyDown: (e) => e.stopPropagation() },
          h('div', { className: 'kbth-mhd' }, h('h3', { id: 'kbth-ld-mt' }, kt('Mon pack de mots', 'My word pack')), h('button', { type: 'button', className: 'kbth-mx', 'aria-label': kt('Fermer', 'Close'), onClick: close }, '×')),
          h('div', { className: 'kbth-mbody' },
            h('p', { className: 'kbth-hint', style: { margin: 0 } }, kt('Tes propres mots, ou ceux que Claude écrit pour ton métier. Ils forment l’ambiance « Mon pack » du sélecteur.', 'Your own words, or the ones Claude writes for your job. They make up the “My pack” ambiance in the selector.')),
            note !== null ? h('div', { className: 'kbth-status ' + note.t, role: 'status' }, note.text) : null,
            h('div', { className: 'kbth-wchips' }, ld.words.length > 0
              ? ld.words.map((w, i) => h('span', { key: w, className: 'kbth-wchip' }, w, h('button', { type: 'button', 'aria-label': kt('Retirer ', 'Remove ') + w, 'data-kb': 'ld-wdel', onClick: () => ldPutWords(ld.words.filter((_, j) => j !== i)) }, '×')))
              : h('span', { className: 'kbth-hint' }, kt('Aucun mot. Ajoute-en un, ou demande à Claude.', 'No words. Add one, or ask Claude.'))),
            h('div', { className: 'kbth-row', style: { gap: 6 } },
              h('input', { className: 'kbth-in', style: { flex: 1, minWidth: 140 }, value: wordDraft, maxLength: 40, placeholder: kt('Ajouter un mot, puis Entrée', 'Add a word, then Enter'), 'aria-label': kt('Ajouter un mot', 'Add a word'), 'data-kb': 'ld-word', onInput: (e) => setWordDraft(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); addWord() } } }),
              h('button', { type: 'button', className: 'kbth-btn', 'data-kb': 'ld-wadd', onClick: addWord }, kt('Ajouter', 'Add'))),
            h('div', { className: 'kbth-panel2' },
              h('h4', null, kt('Écrire avec Claude', 'Write with Claude')),
              h('p', null, kt('Le skill « loading-text » écrit une dizaine de mots propres à ton métier, dans la langue de l’interface. Colle la commande dans le chat : les mots arrivent ici tout seuls.', 'The “loading-text” skill writes about ten words specific to your job, in the interface language. Paste the command in the chat: the words arrive here by themselves.')),
              h('input', { className: 'kbth-in', value: job, maxLength: 80, placeholder: kt('Ton métier, par ex. sage-femme libérale', 'Your job, e.g. freelance midwife'), 'aria-label': kt('Ton métier ou ton univers', 'Your job or your world'), onInput: (e) => setJob(e.target.value) }),
              h('div', { className: 'kbth-codeln' }, h('span', null, packCmd),
                h('button', { type: 'button', className: 'kbth-link', 'data-kb': 'ld-copy2', onClick: () => ldCopy(packCmd, (ok) => { setCopied(ok ? 'words' : 'fail'); setWaiting({ kind: 'words', base: ld.words.length }) }) }, copied === 'words' ? kt('Copié', 'Copied') : kt('Copier', 'Copy'))),
              waiting !== null && waiting.kind === 'words' ? h('div', { className: 'kbth-hint', role: 'status' }, kt('En attente des mots… colle la commande dans le chat. Cette fenêtre les détecte seule.', 'Waiting for the words… paste the command in the chat. This window detects them by itself.')) : null)),
          h('div', { className: 'kbth-mft' }, h('button', { type: 'button', className: 'kbth-btn kbth-ldpri', onClick: close }, kt('Terminé', 'Done'))))

        return h(React.Fragment, null,
          h('section', { className: 'kbth-sec', style: { gap: 20 }, 'aria-labelledby': 'kbth-ld-t', 'data-kb': 'ld-pane' },
            h('div', null,
              h('div', { className: 'kbth-sec-t', id: 'kbth-ld-t' }, kt('Animation de réflexion', 'Thinking animation')),
              h('div', { className: 'kbth-sec-d', style: { marginTop: 4 } }, kt('Ce qui s’anime en bas du chat pendant que l’agent travaille.', 'What animates at the bottom of the chat while the agent works.'))),
            preview, rotation, texte, reglages),
          modal === null ? null : portal(h(React.Fragment, null, h('div', { className: 'kbth-mback', onClick: close }), modal === 'picker' ? picker : packModal)))
      }

      /** A window in front of the settings box: Escape closes it, Tab stays inside it, the focus goes back to where it came from. */
      function ThemeModal(props) {
        const box = React.useRef(null)
        React.useEffect(() => {
          const back = typeof document !== 'undefined' ? document.activeElement : null
          const el = box.current
          if (el !== null && el !== undefined) {
            const first = el.querySelector('input:not([disabled]),textarea')
            if (first !== null && typeof first.focus === 'function') first.focus(); else if (typeof el.focus === 'function') el.focus()
          }
          const key = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); props.onClose(); return }
            if (e.key === 'Tab' && box.current) {
              // Always ours: DSH's settings box has its own focus trap and this window sits outside it (portal).
              const f = Array.prototype.slice.call(box.current.querySelectorAll('button,input,textarea,select,a[href],[tabindex="0"]')).filter((x) => !x.disabled && x.offsetParent !== null)
              e.preventDefault(); e.stopPropagation()
              if (f.length === 0) return
              const i = f.indexOf(document.activeElement)
              f[i < 0 ? (e.shiftKey ? f.length - 1 : 0) : (i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus()
            }
          }
          document.addEventListener('keydown', key, true)
          return () => {
            document.removeEventListener('keydown', key, true)
            try { if (back !== null && back !== undefined && typeof back.focus === 'function') back.focus() } catch (e) { /* gone */ }
          }
        }, [])
        return portal(h(React.Fragment, null,
          h('div', { className: 'kbth-mback', onClick: props.onClose }),
          h('div', { className: 'kbth-mdlg', style: { width: 'min(480px, calc(100vw - 32px))' }, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': props.labelId, tabIndex: -1, ref: box, 'data-kb': props.kb, onKeyDown: (e) => e.stopPropagation() }, props.children)))
      }

      // <look-studio:begin>
      // ══════════════════════════════════════════════════════════════════════
      // 5c. THE LOOK STUDIO — the simple view of the page.
      //     A small DSH drawn from the look in use (the same palette function, wallpaper, icon sets and loops as the real
      //     thing): a click on a part opens a short panel for it, a click on a choice changes the look at once. Everything
      //     a click sets is a setting of this page (`S`, through `commit`) or of the animation store (`ld`, through `ldSet`):
      //     the studio keeps no look of its own, only which panel is open. The editor of the nine tabs stays below it, whole.
      // ══════════════════════════════════════════════════════════════════════

      /** The six fonts of the first sight (the thirty of the page are under « More options »). */
      const ST_FONTS = [['dsh', 'Standard', 'Standard'], ['avenir', 'Net', 'Clean'], ['nunito', 'Amical', 'Friendly'], ['georgia', 'Classique', 'Classic'], ['futura', 'Gras', 'Bold'], ['jetbrains-mono', 'Code', 'Code']]
      /** Text size in three steps; the exact size is under « More options ». */
      const ST_SIZES = [['s', 13, 'Petit', 'Small'], ['m', 15, 'Moyen', 'Medium'], ['l', 16, 'Grand', 'Large']]
      const ST_SPEEDS = [['slow', 0.6, 'Lent', 'Slow'], ['normal', 1, 'Normal', 'Normal'], ['fast', 1.6, 'Rapide', 'Fast']]
      /** Text colours on offer (« auto » is the colour of the app). */
      const ST_INKS = ['#FFFFFF', '#E5E7EB', '#FDE68A', '#A7F3D0', '#BFDBFE', '#111111', '#374151']
      const ST_ZONES = ['mood', 'style', 'accent', 'sidebar', 'wall', 'user', 'agent', 'icons', 'think', 'letters', 'widgets', 'effects', 'access']
      /** The shipped themes of the first sight: the ten that are not the inherited packs. */
      const ST_FIRST_SKINS = 10
      const ST_SIZE_ID = (fs) => (fs <= 13 ? 's' : (fs >= 16 ? 'l' : 'm'))

      /** The keys of a look (what a theme may keep, accessibility excluded: those are needs, not a style). A vibe starts from the defaults of these. */
      const stLookKeys = () => PRESET_KEYS.filter((k) => PRESET_GROUPS.a11y.indexOf(k) < 0)
      /** Five whole looks: a theme, an accent, a font, the tone of the sidebar, icons, how replies are framed, the pills under the message box and the thinking animation + words. */
      const ST_VIBES = [
        { id: 'work', fr: 'Travail', en: 'Work', dot: '#3B82F6', skin: 'clair', set: { acc: '#3B82F6', fontText: 'avenir', fs: 14, sideTone: 'lighter', iconSet: 'classic', wgSessions: false, wgChanges: false, wgUsage: true }, think: 'dots', pack: 'finance' },
        { id: 'dev', fr: 'Dev', en: 'Dev', dot: '#22C55E', skin: 'oled', set: { acc: '#22C55E', fontText: 'jetbrains-mono', fs: 13, sideTone: 'darker', iconSet: 'matrice', replyBg: 'outline', bubbleUser: 'dark', wgSessions: true, wgChanges: true, wgUsage: true }, think: 'bars', pack: 'ingenierie' },
        { id: 'study', fr: 'Études', en: 'Study', dot: '#F59E0B', skin: 'papier', set: { acc: '#F59E0B', fontText: 'nunito', fs: 16, iconSet: 'kawaii', replyBg: 'card', wgSessions: false, wgChanges: false, wgUsage: true }, think: 'bunny', pack: 'education' },
        { id: 'chill', fr: 'Détente', en: 'Chill', dot: '#EC4899', skin: 'nebuleuse', set: { acc: '#EC4899', sideTone: 'tinted', iconSet: 'duotone', bubbleUser: 'accent', replyBg: 'tint', fs: 14, wgSessions: false, wgChanges: false, wgUsage: false }, think: 'jellyfish', pack: 'mer' },
        { id: 'night', fr: 'Nuit', en: 'Night', dot: '#6366F1', skin: 'bleu', set: { acc: '#6366F1', wp: 'iespace', wpVis: 70, sideTone: 'darker', iconSet: 'aplat', fs: 13, wgSessions: false, wgChanges: false, wgUsage: true }, think: 'orbit', pack: 'science' }
      ]
      /** What a vibe changes in the page's state (everything of a look, so a vibe is a whole look) and in the animation store. */
      const stVibePatch = (v) => {
        const base = {}
        stLookKeys().forEach((k) => { base[k] = DEF[k] })
        const sk = SKINS.find((x) => x.id === v.skin)
        return { state: { ...base, ...(sk !== undefined ? skinPatch(sk) : {}), ...v.set }, loop: { sel: [v.think], pack: v.pack } }
      }
      const stVibeOn = (S, v) => { const p = stVibePatch(v).state; return Object.keys(p).every((k) => settingText(S[k]) === settingText(p[k])) && ld.S.sel.length === 1 && ld.S.sel[0] === v.think && ld.S.pack === v.pack }

      const stPick = (a) => a[Math.floor(Math.random() * a.length)]
      /** A random choice for one panel: { state, loop }, both parts optional. Accessibility and the pills under the message box are never drawn at random. */
      const ST_RAND = {
        mood: () => ({ state: { mode: Math.random() < 0.6 ? 'dark' : 'light' } }),
        style: () => ({ skin: stPick(SKINS) }),
        accent: () => ({ state: { acc: stPick(ACCS) } }),
        sidebar: () => ({ state: { sideTone: stPick(ENUMS.sideTone) } }),
        wall: () => ({ state: { wp: stPick(WPS.filter((w) => w.id !== 'none')).id, wpVis: 50 + Math.floor(Math.random() * 50) } }),
        user: () => ({ state: { bubbleUser: stPick(BUBBLE_CHOICES), textUser: null } }),
        agent: () => ({ state: { replyBg: stPick(ENUMS.replyBg), replyColor: null, textReply: null } }),
        icons: () => ({ state: { iconSet: stPick(ICON_SET_IDS) } }),
        think: () => ({ loop: { sel: [stPick(LD_PRESETS).id], pack: stPick(LD_PACKS).id } }),
        letters: () => ({ state: { fontText: stPick(ST_FONTS)[0], fs: stPick(ST_SIZES)[1] } }),
        effects: () => ({ state: { radius: stPick(ENUMS.radius), shadow: stPick(ENUMS.shadow), glow: Math.random() < 0.3 } })
      }
      /** « Surprise me » of the studio: a coherent draw (the page's own, for mode, accent and wallpaper) and a draw for every other panel. */
      const stSurprise = () => {
        const state = { ...surprendre() }
        const loop = {}
        ;['icons', 'letters', 'sidebar', 'user', 'agent', 'think', 'effects'].forEach((z) => { const r = ST_RAND[z](); Object.assign(state, r.state || {}); Object.assign(loop, r.loop || {}) })
        return { state, loop }
      }
      /** The colour DSH paints its own bubble with, in the scheme shown (read from the page when there is one). */
      const stDshSeen = { light: '#EDF3FE', dark: '#2A3040' }
      const stDshBubble = (dark, own) => {
        const k = dark ? 'dark' : 'light'
        if (own === true) return stDshSeen[k] // our token is on the page: what it holds is not DSH's
        try {
          const v = String(window.getComputedStyle(document.body).getPropertyValue('--dsw-specific-bubble')).trim()
          if (validHex(v)) stDshSeen[k] = v
        } catch (e) { /* no page to read */ }
        return stDshSeen[k]
      }

      /** An SVG for one menu entry, in the set `setId` (the classic set is the application's own, lent through a seam). */
      const stIcon = (setId, entry, on, size) => {
        let svg = null
        try { svg = setId === 'classic' ? (typeof window.__KB_MENU_CLASSIC__ === 'function' ? window.__KB_MENU_CLASSIC__(entry, size) : null) : iconSvg(setId, entry, on, size) } catch (e) { svg = null }
        return typeof svg === 'string' ? svg : '<svg width="' + size + '" height="' + size + '" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="2.5" stroke="currentColor" stroke-width="1.3"/></svg>'
      }
      const ST_PENCIL = 'M11.2 2.3a1.6 1.6 0 0 1 2.3 2.3L5.4 12.7 2 13.5l.8-3.4z'

      /** If the studio ever fails to draw, the page says so and the editor of the nine tabs (always complete) takes over: a broken view must not leave a person with no way to change the look. */
      const StBoundary = typeof React.Component === 'function'
        ? class extends React.Component {
          constructor(p) { super(p); this.state = { bad: false } }
          static getDerivedStateFromError() { return { bad: true } }
          componentDidCatch(e) {
            try { console.error('[kybernos-theme] the look studio could not be drawn', e) } catch (e2) { /* no console */ }
            try { if (typeof this.props.onFail === 'function') this.props.onFail() } catch (e3) { /* the page is gone */ }
          }
          render() { return this.state.bad ? h('div', { className: 'kbth-note', role: 'status', 'data-kb': 'theme-studio-failed' }, kt('La vue simple n’a pas pu s’afficher : l’éditeur avancé ci-dessous reste complet.', 'The simple view could not be drawn: the advanced editor below is still complete.')) : this.props.children }
        }
        : null

      function Studio(props) {
        const S = props.S, c = props.c, dark = props.dark, commit = props.commit
        const [zoneOn, setZone] = React.useState(props.initialZone === undefined ? null : props.initialZone)
        const [more, setMore] = React.useState({})
        const [fq, setFq] = React.useState('')
        const [wpCat, setWpCat] = React.useState('gradients')
        const [allStyles, setAllStyles] = React.useState(false)
        const [mixOn, setMixOn] = React.useState(ld.S.sel.length > 1)
        const [lookName, setLookName] = React.useState('')
        const [delId, setDelId] = React.useState(null)
        const [note, setNote] = React.useState(null)
        const [narrow, setNarrow] = React.useState(false)
        const [hexDraft, setHexDraft] = React.useState(null)
        const [wordsDraft, setWordsDraft] = React.useState(null)
        const [, bump] = React.useReducer((x) => x + 1, 0)
        const typedHex = React.useRef(null)
        const stage = React.useRef(null)
        const pop = React.useRef(null)
        const lastZone = React.useRef(null)

        // The hex field keeps what is being typed, but follows the accent when something else changed it (a vibe, Undo, Reset, the dice).
        React.useEffect(() => { if (typedHex.current === null || S.acc === null || typedHex.current !== S.acc.toLowerCase()) { setHexDraft(null); typedHex.current = null } }, [S.acc])
        React.useEffect(() => { setWordsDraft(null) }, [zoneOn])
        // Undo can bring back a mix of several loops: the switch follows.
        React.useEffect(() => { if (ld.S.sel.length > 1 && !mixOn) setMixOn(true) })
        // The animation store: redrawn when it changes; my own animations come from the disk.
        React.useEffect(() => { ld.subs.add(bump); ldPull(true); return () => { ld.subs.delete(bump) } }, [])
        // The width of the stage: under 560 px the panel is not floated over the window, it is drawn under it.
        React.useEffect(() => {
          const el = stage.current
          if (el === null || typeof ResizeObserver !== 'function') return undefined
          const ro = new ResizeObserver(() => { try { setNarrow(el.getBoundingClientRect().width < 560) } catch (e) { /* gone */ } })
          ro.observe(el)
          return () => { try { ro.disconnect() } catch (e) { /* gone */ } }
        }, [])
        // The panel sits UNDER the window, never over it: what you change must stay in view while you change it. The window sticks to the top while the panel
        // scrolls under it; opening a panel brings it into view.
        React.useEffect(() => {
          const p = pop.current
          if (zoneOn === null || p === null || typeof p.scrollIntoView !== 'function') return
          try { p.scrollIntoView({ block: 'nearest' }) } catch (e) { /* nothing to scroll */ }
        }, [zoneOn])
        // Escape closes the panel (and nothing else); a press outside it closes it too, a press on another part opens that one.
        React.useEffect(() => {
          if (zoneOn === null) return undefined
          const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setZone(null) } }
          const down = (e) => {
            const t = e.target
            if (pop.current !== null && pop.current.contains(t)) return
            if (t.closest && (t.closest('[data-zone]') || t.closest('[data-chip]'))) return
            setZone(null)
          }
          document.addEventListener('keydown', key, true)
          document.addEventListener('mousedown', down)
          return () => { document.removeEventListener('keydown', key, true); document.removeEventListener('mousedown', down) }
        }, [zoneOn])
        // The focus goes into the panel when it opens and back to the part that opened it when it closes.
        React.useEffect(() => {
          if (zoneOn !== null) { lastZone.current = zoneOn; if (pop.current !== null && typeof pop.current.focus === 'function') pop.current.focus({ preventScroll: true }); return }
          const z = lastZone.current
          lastZone.current = null
          try { const st = stage.current; const el = z === null || st === null ? null : (st.querySelector('[data-zone="' + z + '"]') || st.parentElement.querySelector('[data-chip="' + z + '"]')); if (el !== null && typeof el.focus === 'function' && document.activeElement === document.body) el.focus() } catch (e) { /* nothing to focus */ }
        }, [zoneOn])

        const o = optsDe(S)
        const wpo = WPS.find((w) => w.id === S.wp) || WPS[0]
        const wpOn = wpo.id !== 'none'
        const lang = kbLang()
        const say = (fr, en) => kt(fr, en)

        // ── what a click does ─────────────────────────────────────────────
        // The animation store has its own save; the step is recorded here so that Undo covers it too.
        const loop = (p) => { props.pushHist(); ldSet(p) }
        const setAcc = (v) => { setHexDraft(null); commit({ acc: v }) }
        const applyLoop = (patch) => { if (patch !== undefined && patch !== null) loop(patch) }
        const apply = (r) => {
          if (r.skin !== undefined) props.applySkin(r.skin)
          else if (r.state !== undefined) commit(r.state)
          applyLoop(r.loop)
        }
        const applyVibe = (v) => { const p = stVibePatch(v); props.setLibNote(null); commit(p.state); applyLoop(p.loop); setMixOn(false) }
        const dice = (z) => (ST_RAND[z] === undefined ? null : h('button', { type: 'button', className: 'kbth-st-ic', 'data-kb': 'theme-dice', 'aria-label': say('Tirer au sort pour ce panneau', 'Draw one at random for this panel'), title: say('Au hasard', 'Random'), onClick: () => apply(ST_RAND[z]()) },
          h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' }, h('rect', { x: 2, y: 2, width: 12, height: 12, rx: 3, stroke: 'currentColor', strokeWidth: 1.3 }), [[5.2, 5.2], [10.8, 5.2], [8, 8], [5.2, 10.8], [10.8, 10.8]].map((p, i) => h('circle', { key: i, cx: p[0], cy: p[1], r: 0.95, fill: 'currentColor' }))))
        )

        // ── small builders ────────────────────────────────────────────────
        const sub = (t) => h('div', { className: 'kbth-st-sub' }, t)
        const cap = (t) => h('p', { className: 'kbth-st-cap' }, t)
        const tile = (t) => h('button', { key: t.id, type: 'button', className: 'kbth-st-tile', 'aria-pressed': t.on ? 'true' : 'false', title: t.title, onClick: t.tap, 'data-kb': t.kb, 'data-id': t.id },
          h('div', { className: 'kbth-st-mini', style: t.bg !== undefined ? { background: t.bg } : undefined }, t.inner), h('span', { className: 'kbth-st-nm' }, t.label))
        const tiles = (cols, list) => h('div', { className: 'kbth-st-tiles c' + cols }, list.map(tile))
        const swatches = (list, cur, tap, autoLabel) => h('div', { className: 'kbth-st-sws' }, list.map((col) => {
          const on = col === null ? cur === null : (cur !== null && String(cur).toLowerCase() === col.toLowerCase())
          return h('button', { key: col === null ? 'auto' : col, type: 'button', className: 'kbth-st-sw' + (col === null ? ' auto' : ''), style: col === null ? undefined : { background: col }, 'aria-pressed': on ? 'true' : 'false', 'aria-label': col === null ? autoLabel : col, title: col === null ? autoLabel : col, onClick: () => tap(col) })
        }))
        const anyColor = (value, on, tap, label) => h('label', { className: 'kbth-st-own' + (on ? ' on' : '') },
          h('input', { type: 'color', value: value, 'aria-label': label, onInput: (e) => tap(e.target.value) }), label)
        const chip = (label, on, tap, kb) => h('button', { type: 'button', className: 'kbth-st-chip', 'aria-pressed': on ? 'true' : 'false', onClick: tap, 'data-kb': kb }, label)
        const moreBox = (id, kids) => h('details', { className: 'kbth-st-more', 'data-kb': 'theme-more', open: more[id] === true, onToggle: (e) => { const open = e.currentTarget.open; setMore((m) => (m[id] === open ? m : { ...m, [id]: open })) } },
          h('summary', null, say('Plus d’options', 'More options')), h('div', { className: 'kbth-st-mb' }, ...[kids].flat(Infinity)))
        const sl = (label, min, max, value, text, tap, hint) => slider({ label, min, max, value, text, tap, hint })
        const badge = (r) => h('span', { className: 'kbth-st-badge ' + (r >= 4.5 ? 'ok' : 'low'), 'data-kb': 'theme-badge' },
          r >= 7 ? say('Facile à lire (' + knum(r, 1) + ':1)', 'Easy to read (' + knum(r, 1) + ':1)') : (r >= 4.5 ? say('Lisible (' + knum(r, 1) + ':1)', 'Readable (' + knum(r, 1) + ':1)') : say('Un peu faible (' + knum(r, 1) + ':1)', 'A bit low (' + knum(r, 1) + ':1)')))
        const themeNeeds = say('Cet effet se voit dès qu’un arrière-plan est choisi.', 'This shows as soon as a wallpaper is chosen.')

        // ── mood ──────────────────────────────────────────────────────────
        const moodPanel = () => [
          tiles(3, [['light', say('Clair', 'Light')], ['dark', say('Sombre', 'Dark')], ['system', say('Système', 'System')]].map((m) => ({
            id: m[0], kb: 'theme-st-mood', on: S.mode === m[0], tap: () => commit({ mode: m[0] }), label: m[1],
            bg: m[0] === 'system' ? 'linear-gradient(90deg,' + makeTheme('light', o).base + ' 50%,' + makeTheme('dark', o).base + ' 50%)' : makeTheme(m[0], o).base
          }))),
          cap(say('S’applique à toute l’interface. « Système » suit le réglage de ton appareil.', 'Applies to the whole interface. “System” follows your device setting.'))
        ]

        // ── style ─────────────────────────────────────────────────────────
        const skinTheme = (sk) => makeTheme(sk.mode === null || sk.mode === undefined ? (dark ? 'dark' : 'light') : sk.mode, { acc: sk.acc, ov: sk.ov || {}, lvl: 0, cb: false, tint: 0, dom: '', sideTone: 'auto' })
        const skinMini = (sk) => {
          const t = skinTheme(sk)
          const w = WPS.find((x) => x.id === sk.wp)
          return [w !== undefined && w.id !== 'none' ? h('i', { key: 'w', className: 'kbth-st-wp', style: { background: w.css, opacity: (sk.vis || 60) / 100 } }) : null,
            h('i', { key: 's', className: 'kbth-st-ms', style: { background: t.side } }), h('i', { key: 'l', className: 'kbth-st-ml', style: { background: t.t3 } }), h('i', { key: 'b', className: 'kbth-st-mbar', style: { background: t.fill } })]
        }
        const stylePanel = () => [
          tiles(5, SKINS.filter((sk, i) => allStyles || i < ST_FIRST_SKINS).map((sk) => ({
            id: sk.id, kb: 'theme-st-style', on: S.skin === sk.id, tap: () => props.applySkin(sk), label: sk.name, title: sk.name + ' — ' + props.skinMeta(sk),
            bg: skinTheme(sk).base, inner: skinMini(sk)
          }))),
          h('div', { className: 'kbth-st-row' }, chip(allStyles ? say('Montrer ' + ST_FIRST_SKINS, 'Show ' + ST_FIRST_SKINS) : say('Les ' + SKINS.length + ' styles', 'All ' + SKINS.length + ' styles'), allStyles, () => setAllStyles(!allStyles), 'theme-st-allstyles'),
            h('button', { type: 'button', className: 'kbth-link', onClick: () => props.openClassic('galerie') }, say('Plus de styles : la galerie', 'More looks: the gallery')))
        ]

        // ── accent ────────────────────────────────────────────────────────
        const accentPanel = () => [
          swatches(ACCS, S.acc, (col) => setAcc(col), say('Accent du thème', 'Theme accent')),
          h('div', { className: 'kbth-st-row' }, anyColor(S.acc === null ? c.fill : S.acc, S.acc !== null && ACCS.every((a) => a.toLowerCase() !== S.acc.toLowerCase()), (v) => setAcc(v), say('Une autre couleur', 'Any color')),
            S.acc !== null ? chip(say('Couleur du thème', 'Theme color'), false, () => setAcc(null), 'theme-st-accreset') : null,
            badge(ratio(c.onAcc, c.fill))),
          cap(say('Boutons, liens, bouton d’envoi et surlignages.', 'Buttons, links, the send button and highlights.')),
          moreBox('accent', [
            h('div', { key: 'hex', className: 'kbth-row' }, h('span', { className: 'kbth-lb' }, say('Code hexadécimal', 'Hex code')),
              h('label', { className: 'kbth-hex' + (hexDraft !== null && !validHex(hexDraft) ? ' bad' : '') }, h('span', null, '#'),
                h('input', { value: hexDraft !== null ? hexDraft : (S.acc === null ? c.fill : S.acc).replace('#', ''), maxLength: 7, spellCheck: false, 'aria-label': say('Code hexadécimal', 'Hex code'), 'data-kb': 'theme-st-hex',
                  onInput: (e) => { const v = e.target.value; setHexDraft(v); const p = HEX(v); if (p !== null) { typedHex.current = toHex(p).toLowerCase(); commit({ acc: toHex(p) }) } } }))),
            sl(say('Teinte des surfaces', 'Surface tint'), 0, 100, S.tint, S.tint + ' %', (v) => commit({ tint: v }), wpOn ? say('Tire les panneaux vers la couleur du fond.', 'Pulls the panels towards the wallpaper color.') : themeNeeds),
            cap(say('Chaque couleur une par une : éditeur avancé › Couleurs.', 'Every single color: advanced editor › Colors.'))
          ])
        ]

        // ── sidebar ───────────────────────────────────────────────────────
        const sideNames = { auto: say('Auto', 'Auto'), darker: say('Plus sombre', 'Darker'), lighter: say('Plus clair', 'Lighter'), tinted: say('Teintée', 'Tinted') }
        const sidebarPanel = () => [
          tiles(4, ENUMS.sideTone.map((t) => ({ id: t, kb: 'theme-st-side', on: S.sideTone === t, tap: () => commit({ sideTone: t }), label: sideNames[t], bg: makeTheme(dark ? 'dark' : 'light', { ...o, sideTone: 'auto' }).base,
            inner: h('i', { className: 'kbth-st-ms wide', style: { background: makeTheme(dark ? 'dark' : 'light', { ...o, sideTone: t }).side } }) }))),
          wpOn ? sl(say('Transparence', 'See-through'), 0, 100, S.sidebarOpacity, S.sidebarOpacity + ' %', (v) => commit({ sidebarOpacity: v }), S.sidebarLinked ? undefined : say('Activé dans « Plus d’options ».', 'Switched on under “More options”.'))
            : cap(say('Choisis un arrière-plan pour qu’il se voie à travers la barre latérale.', 'Pick a wallpaper to let it show through the sidebar.')),
          ldToggle(say('Barres au survol', 'Bars on hover'), S.autoHideBars, () => commit({ autoHideBars: !S.autoHideBars }), say('Le rail replié et la barre du haut du chat se cachent, et reviennent quand tu approches le bord de la fenêtre.', 'The collapsed rail and the chat’s top bar hide, and come back when you reach for the edge of the window.')),
          moreBox('sidebar', [
            ldToggle(say('Laisser voir le fond', 'Let the wallpaper show'), S.sidebarLinked, () => commit({ sidebarLinked: !S.sidebarLinked }), say('Désactivé, la barre latérale reste pleine.', 'When off, the sidebar stays solid.')),
            sl(say('Flou derrière', 'Blur behind'), 0, 40, S.glassBlur, S.glassBlur + ' px', (v) => commit({ glassBlur: v }), wpOn ? undefined : themeNeeds),
            ldToggle(say('Logo et nom', 'Logo and name'), S.showBrand, () => commit({ showBrand: !S.showBrand }), say('Dans la barre latérale et sur l’accueil.', 'In the sidebar and on the home screen.'))
          ])
        ]

        // ── wallpaper ─────────────────────────────────────────────────────
        const wallPanel = () => [
          h('div', { className: 'kbth-st-chips' }, chip(say('Aucun', 'None'), S.wp === 'none', () => commit({ wp: 'none' }), 'theme-st-wpnone'),
            WPCATS.map((cat) => h('button', { key: cat.id, type: 'button', className: 'kbth-st-chip', 'aria-pressed': S.wp !== 'none' && wpCat === cat.id ? 'true' : 'false', 'data-kb': 'theme-st-wpcat', 'data-id': cat.id, onClick: () => setWpCat(cat.id) }, cat.name))),
          h('div', { className: 'kbth-st-tiles c4 scroll' }, WPS.filter((w) => w.cat === wpCat).map((w) => tile({ id: w.id, kb: 'theme-st-wp', on: S.wp === w.id, tap: () => commit({ wp: w.id }), label: w.name, inner: h('i', { className: 'kbth-st-wpfill', style: { background: w.css } }) }))),
          moreBox('wall', [
            sl(say('Visibilité', 'Visibility'), 0, 100, S.wpVis, S.wpVis + ' %', (v) => commit({ wpVis: v })),
            sl(say('Flou de l’image', 'Image blur'), 0, 40, S.wpBlur, S.wpBlur + ' px', (v) => commit({ wpBlur: v })),
            sl(say('Assombrissement', 'Darkening'), 0, 100, S.bgDarken, S.bgDarken + ' %', (v) => commit({ bgDarken: v })),
            sl(say('Teinte des surfaces', 'Surface tint'), 0, 100, S.tint, S.tint + ' %', (v) => commit({ tint: v })),
            sl(say('Flou du verre', 'Glass blur'), 0, 40, S.glassBlur, S.glassBlur + ' px', (v) => commit({ glassBlur: v })),
            h('div', { key: 'fit', className: 'kbth-row' }, h('span', { className: 'kbth-lb' }, say('Ajustement', 'Fit')),
              seg({ items: [['cover', say('Couvrir', 'Cover')], ['fill', say('Remplir', 'Fill')], ['center', say('Centrer', 'Center')], ['stretch', say('Étirer', 'Stretch')]].map((f) => ({ id: f[0], label: f[1], on: S.bgFit === f[0], tap: () => commit({ bgFit: f[0] }) })) })),
            cap(say('Luminosité, contraste, saturation, miroir : éditeur avancé › Verre et fond.', 'Brightness, contrast, saturation, mirror: advanced editor › Glass and background.'))
          ])
        ]

        // ── your messages / the agent's replies ───────────────────────────
        const dshBubble = stDshBubble(dark, S.bubbleUser !== 'auto')
        const bubbleNames = { auto: say('Auto (DSH)', 'Auto (DSH)'), accent: say('Accent', 'Accent'), soft: say('Doux', 'Soft'), dark: say('Sombre', 'Dark') }
        const userPanel = () => [
          sub(say('Couleur de la bulle', 'Bubble color')),
          tiles(4, BUBBLE_CHOICES.map((b) => ({ id: b, kb: 'theme-st-bubble', on: S.bubbleUser === b, tap: () => commit({ bubbleUser: b }), label: bubbleNames[b], bg: c.base,
            inner: h('i', { className: 'kbth-st-pill', style: { background: b === 'auto' ? dshBubble : bulleDe({ ...S, bubbleUser: b }, c, dark).bg } }) }))),
          h('div', { className: 'kbth-st-row' }, anyColor(validHex(S.bubbleUser) ? S.bubbleUser : dshBubble, validHex(S.bubbleUser), (v) => commit({ bubbleUser: toHex(HEX(v)) }), say('Une autre couleur', 'Any color'))),
          sub(say('Couleur du texte', 'Text color')),
          swatches([null].concat(ST_INKS), S.textUser, (col) => commit({ textUser: col }), say('Auto (suit l’application)', 'Auto (follows the app)')),
          moreBox('user', [cap(say('La bulle utilise le réglage de couleur propre à DSH. La couleur du texte ne s’applique qu’à tes messages : le reste de l’application garde la sienne.', 'The bubble uses DSH’s own color setting. The text color applies to your messages only: the rest of the app keeps its own.'))])
        ]
        const replyNames = { none: say('Aucun (DSH)', 'None (DSH)'), card: say('Carte', 'Card'), outline: say('Contour', 'Outline'), tint: say('Teinte', 'Tinted') }
        const replyMini = (b) => {
          const own = S.replyColor
          const st = { width: '70%', height: 22, borderRadius: 7 }
          if (b === 'card') { st.background = own !== null ? own : rgba(c.t1, 0.08); st.border = '1px solid ' + c.b2 }
          if (b === 'outline') st.border = '1px solid ' + (own !== null ? own : c.b4)
          if (b === 'tint') st.background = rgba(own !== null ? own : c.fill, 0.14)
          return h('i', { className: 'kbth-st-reply', style: st })
        }
        const agentPanel = () => [
          sub(say('Fond de la réponse', 'Reply background')),
          tiles(4, ENUMS.replyBg.map((b) => ({ id: b, kb: 'theme-st-reply', on: S.replyBg === b, tap: () => commit({ replyBg: b }), label: replyNames[b], bg: c.base, inner: replyMini(b) }))),
          S.replyBg !== 'none' ? [sub(say('Couleur de la réponse', 'Reply color')), swatches([null].concat(ACCS), S.replyColor, (col) => commit({ replyColor: col }), say('Auto', 'Auto'))] : null,
          sub(say('Couleur du texte', 'Text color')),
          swatches([null].concat(ST_INKS), S.textReply, (col) => commit({ textReply: col }), say('Auto (suit l’application)', 'Auto (follows the app)')),
          moreBox('agent', [cap(say('DSH ne dessine aucune bulle autour des réponses de l’agent : un fond ou un contour est ajouté autour de chacune. Si DSH renomme le repère qui sert à les trouver, le cadre disparaît et le reste du thème continue de marcher.', 'DSH draws no bubble around the agent’s replies: a background or an outline is added around each one. If DSH renames the marker used to find them, the frame goes away and the rest of the theme keeps working.'))])
        ]

        // ── menu icons ────────────────────────────────────────────────────
        const iconsPanel = () => [
          h('div', { className: 'kbth-st-tiles c3 scroll tall' }, ICON_SETS.map((st) => tile({ id: st.id, kb: 'theme-st-icons', on: S.iconSet === st.id, tap: () => commit({ iconSet: st.id }), label: st[lang], title: st.hint[lang],
            inner: h('div', { className: 'kbth-st-ic4' }, ['kyber', 'dash', 'ws', 'creations'].map((e, i) => h('span', { key: e, dangerouslySetInnerHTML: { __html: stIcon(st.id, e, i === 0, 17) } }))) }))),
          cap(ICON_SETS.length + say(' jeux, dessinés par le code du plugin.', ' sets, drawn by the plugin’s own code.'))
        ]

        // ── thinking animation ────────────────────────────────────────────
        const tAcc = S.acc !== null
        const pickLoop = (id) => {
          if (!mixOn) { loop({ sel: [id] }); return }
          const sel = ld.S.sel
          if (sel.indexOf(id) >= 0) loop({ sel: sel.filter((x) => x !== id) })
          else if (sel.length < LD_MAX) loop({ sel: sel.concat([id]) })
          else setNote({ ok: false, text: say('Quatre animations au plus.', 'Up to four animations.') })
        }
        const loopTile = (key, l, name, on) => h('button', { key, type: 'button', className: 'kbth-st-lt', 'aria-pressed': on ? 'true' : 'false', 'aria-label': name, title: name, 'data-name': name, 'data-kb': 'theme-st-loop', 'data-id': key, onClick: () => (l === null ? loop({ sel: [] }) : pickLoop(l.id)) },
          l === null ? h('svg', { width: 26, height: 26, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' }, h('path', { d: LD_WHALE, stroke: 'currentColor', strokeWidth: 1 })) : h(LdView, { l, px: 26, spd: 1, tint: ld.S.tint && tAcc }))
        const packs = LD_PACKS.concat(ld.words.length > 0 ? [{ id: 'perso', name: say('Mes mots', 'My words'), words: { fr: ld.words, en: ld.words } }] : [])
        const importLoop = (file) => ldImport(file).then((r) => {
          const full = r.t !== 'err' && mixOn && ld.S.sel.length >= LD_MAX
          setNote({ ok: r.t !== 'err', text: r.text + (full ? ' ' + say('La rotation est pleine : retires-en une pour l’utiliser.', 'The mix is full: remove one to use it.') : '') })
          if (r.t !== 'err' && ld.mine.length > 0 && !full) loop({ sel: mixOn ? ld.S.sel.concat([ld.mine[0].id]) : [ld.mine[0].id] })
        })
        const saveWords = (text) => {
          const words = String(text).split(',').map((w) => w.trim()).filter((w) => w !== '')
          setWordsDraft(null)
          ldPutWords(words).then(() => { if (words.length > 0) loop({ pack: 'perso' }) })
        }
        const thinkPanel = () => {
          const selNames = ld.S.sel.map(ldById).filter((x) => x !== null).map((l) => l.name)
          const words = ldWordList(ld.S.pack)
          return [
            h('div', { className: 'kbth-st-lgrid' },
              loopTile('dsh', null, say('Queue de baleine de DSH', 'DSH whale tail'), ld.S.sel.length === 0),
              LD_PRESETS.map((l) => loopTile(l.id, l, l.name, ld.S.sel.indexOf(l.id) >= 0)),
              ld.mine.map((l) => loopTile(l.id, l, l.name, ld.S.sel.indexOf(l.id) >= 0)),
              h('label', { className: 'kbth-st-lt add', title: say('Ajouter la tienne (SVG, Lottie, GIF, WebP)', 'Add your own (SVG, Lottie, GIF, WebP)'), 'data-name': say('Ajouter la tienne (SVG, Lottie, GIF, WebP)', 'Add your own (SVG, Lottie, GIF, WebP)') },
                h('svg', { width: 18, height: 18, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' }, h('path', { d: 'M8 3v10M3 8h10', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' })),
                h('input', { type: 'file', accept: '.svg,.json,.gif,.webp,.png', 'data-kb': 'theme-st-addloop', style: { display: 'none' }, 'aria-label': say('Ajouter ta propre animation', 'Add your own animation'), onChange: (e) => { const input = e.target; const f = input.files && input.files[0]; if (f) importLoop(f); input.value = '' } }))),
            note !== null ? h('div', { className: note.ok ? 'kbth-ok kbth-gr-ok' : 'kbth-bad kbth-gr-err', role: 'status', 'data-kb': 'theme-st-note' }, note.text) : null,
            cap(say('Choisie : ', 'Selected: ') + (selNames.length > 0 ? selNames.join(', ') : say('queue de baleine de DSH', 'DSH whale tail')) + say(' · survole une vignette pour son nom', ' · hover a tile for its name')),
            h('div', { className: 'kbth-row' }, h('span', { className: 'kbth-lb' }, say('Mots affichés', 'Words it shows')),
              h('select', { className: 'kbth-st-sel', 'data-kb': 'theme-st-pack', 'aria-label': say('Mots affichés', 'Words it shows'), value: packs.some((p) => p.id === ld.S.pack) ? ld.S.pack : 'dsh', onChange: (e) => loop({ pack: e.target.value }) },
                packs.map((p) => h('option', { key: p.id, value: p.id }, p.name)))),
            cap(words.length > 0 ? words.slice(0, 5).join(', ') + (words.length > 5 ? '…' : '') : say('La phrase de DSH (« Deep diving… »).', 'DSH’s own phrase (“Deep diving…”).')),
            moreBox('think', [
              h('div', { key: 'size', className: 'kbth-row' }, h('span', { className: 'kbth-lb' }, say('Taille', 'Size')), seg({ items: [['compact', '14 px'], ['standard', '24 px'], ['large', '40 px']].map((z) => ({ id: z[0], label: z[1], on: ld.S.size === z[0], tap: () => loop({ size: z[0] }) })) })),
              h('div', { key: 'speed', className: 'kbth-row' }, h('span', { className: 'kbth-lb' }, say('Vitesse', 'Speed')), seg({ items: ST_SPEEDS.map((z) => ({ id: z[0], label: say(z[2], z[3]), on: Math.abs(ld.S.speed - z[1]) < 0.01, tap: () => loop({ speed: z[1] }) })) })),
              ldToggle(say('Teinter avec ma couleur', 'Tint with my color'), ld.S.tint, () => loop({ tint: !ld.S.tint }), say('Seulement les animations d’une couleur.', 'Single-color animations only.')),
              ldToggle(say('Montrer le temps', 'Show the time'), ld.S.dur, () => loop({ dur: !ld.S.dur }), say('« … 12s » à droite du mot.', '“… 12s” to the right of the word.')),
              ldToggle(say('Garder le texte', 'Keep the words'), ld.S.keep, () => loop({ keep: !ld.S.keep }), say('Sans lui, seule l’animation reste.', 'Without it, only the animation stays.')),
              h('div', { key: 'rot', className: 'kbth-row' }, h('span', { className: 'kbth-lb' }, say('Changer de mot', 'Change the word')), seg({ items: [['fixed', say('Jamais', 'Never')], ['8', '8 s'], ['15', '15 s']].map((z) => ({ id: z[0], label: z[1], on: ld.S.rot === z[0], tap: () => loop({ rot: z[0] }) })) })),
              sl(say('Délai', 'Delay'), 0, 1000, ld.S.delay, ld.S.delay + ' ms', (v) => loop({ delay: Math.round(v / 50) * 50 }), say('Évite un clignotement sur les réponses très rapides.', 'Avoids a flicker on very quick replies.')),
              ldToggle(say('Mélanger plusieurs animations', 'Mix several animations'), mixOn, () => { const next = !mixOn; setMixOn(next); if (!next && ld.S.sel.length > 1) loop({ sel: ld.S.sel.slice(0, 1) }) }, say('Jusqu’à quatre, jamais deux fois la même d’affilée.', 'Up to four, never the same twice in a row.')),
              h('div', { key: 'words', className: 'kbth-row' }, h('span', { className: 'kbth-lb' }, say('Mes propres mots', 'My own words')),
                h('input', { className: 'kbth-in', style: { flex: 1, minWidth: 160 }, 'data-kb': 'theme-st-words', value: wordsDraft !== null ? wordsDraft : ld.words.join(', '), placeholder: say('Réfléchir, Mijoter, Peaufiner…', 'Pondering, Brewing, Plotting…'), 'aria-label': say('Mes propres mots', 'My own words'),
                  onInput: (e) => setWordsDraft(e.target.value), onBlur: (e) => { if (wordsDraft !== null) saveWords(e.target.value) }, onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); saveWords(e.target.value) } } })),
              cap(say('Séparés par des virgules. Plus de réglages : éditeur avancé › Animation.', 'Separated by commas. More settings: advanced editor › Animation.'))
            ])
          ]
        }

        // ── letters ───────────────────────────────────────────────────────
        const inkKey = (dark ? 'dark' : 'light') + ':t1'
        const setInk = (col) => { const ov = { ...S.ov }; if (col === null) delete ov[inkKey]; else ov[inkKey] = col; commit({ ov }) }
        const lettersPanel = () => {
          const fq2 = fq.trim().toLowerCase()
          const grp = (name, list) => (list.length === 0 ? null : [h('div', { key: 'g' + name, className: 'kbth-st-grp' }, name), h('div', { key: 'l' + name, className: 'kbth-st-tiles c3' }, list.map((f) => h('button', { key: f.id, type: 'button', className: 'kbth-st-ft', 'aria-pressed': S.fontText === f.id ? 'true' : 'false', 'data-kb': 'theme-st-fontall', 'data-id': f.id, style: f.stack === null ? undefined : { fontFamily: f.stack }, onClick: () => commit({ fontText: f.id }) }, h('b', null, 'Aa'), h('span', null, f.name))))])
          const part = (a, b) => FONTS.slice(a, b).filter((f) => fq2 === '' || f.name.toLowerCase().indexOf(fq2) >= 0)
          const inkNow = S.ov[inkKey] === undefined ? null : S.ov[inkKey]
          return [
            tiles(3, ST_FONTS.map((f) => { const fo = FONTS.find((x) => x.id === f[0]) || FONTS[0]; return { id: f[0], kb: 'theme-st-font', on: S.fontText === f[0], tap: () => commit({ fontText: f[0] }), label: say(f[1], f[2]), inner: h('div', { className: 'kbth-st-ab', style: fo.stack === null ? undefined : { fontFamily: fo.stack } }, 'Aa') } })),
            h('div', { className: 'kbth-row' }, h('span', { className: 'kbth-lb' }, say('Taille', 'Size')), seg({ items: ST_SIZES.map((z) => ({ id: z[0], label: say(z[2], z[3]), on: ST_SIZE_ID(S.fs) === z[0], tap: () => commit({ fs: z[1] }) })) })),
            moreBox('letters', [
              sub(say('Toutes les polices', 'All fonts')),
              h('input', { key: 'q', className: 'kbth-in', 'data-kb': 'theme-st-fq', value: fq, placeholder: say('Chercher une police (Roboto, Open Sans, Lato…)', 'Search a font (Roboto, Open Sans, Lato…)'), 'aria-label': say('Chercher une police', 'Search a font'), onInput: (e) => setFq(e.target.value) }),
              h('div', { key: 'fl', className: 'kbth-st-fontlist' }, grp(say('Sans empattement', 'Sans serif'), part(0, 15)), grp(say('Avec empattement', 'Serif'), part(15, 22)), grp(say('Chasse fixe', 'Monospace'), part(22, FONTS.length)),
                FONTS.every((f) => fq2 !== '' && f.name.toLowerCase().indexOf(fq2) < 0) ? cap(say('Aucune police de ce nom.', 'No font with that name.')) : null),
              cap(say('Une police ne s’affiche que si elle est installée sur ton ordinateur.', 'A font only shows if it is installed on your computer.')),
              sl(say('Taille exacte', 'Exact size'), 12, 17, S.fs, S.fs + ' px', (v) => commit({ fs: v })),
              sub(say('Couleur du texte de l’application', 'App text color')),
              swatches([null].concat(ST_INKS), inkNow, (col) => setInk(col), say('Auto', 'Auto')),
              h('div', { key: 'rb' }, badge(ratio(c.t1, c.l1))),
              ldToggle(say('Ligatures', 'Ligatures'), S.ligatures, () => commit({ ligatures: !S.ligatures }), say('Lettres jointes dans les polices de code.', 'Joined letters in code fonts.'))
            ])
          ]
        }

        // ── the pills under the message box ───────────────────────────────
        const widgetsPanel = () => [
          ldToggle(say('Pastilles d’état', 'Status pills'), S.wgSessions, () => commit({ wgSessions: !S.wgSessions }), say('Enregistré, synchro, revue, mémoire, leçons.', 'Saved, sync, review, memory, lessons.')),
          ldToggle(say('Changements', 'Changes'), S.wgChanges, () => commit({ wgChanges: !S.wgChanges }), say('Où en est le travail de cette conversation.', 'Where the work of this chat stands.')),
          ldToggle(say('Usage', 'Usage'), S.wgUsage, () => commit({ wgUsage: !S.wgUsage }), say('Quelle part de ton forfait est utilisée, ou ce que coûte la session.', 'How much of your plan is used, or what the session costs.')),
          cap(say('Ces pastilles sont dessinées par d’autres modules : ici tu les montres ou les caches.', 'Other modules draw these pills: here you show or hide them.'))
        ]

        // ── effects and shape · accessibility (chips under the window) ─────
        const effectsPanel = () => [
          h('div', { className: 'kbth-row' }, h('span', { className: 'kbth-lb' }, say('Coins', 'Corners')), seg({ items: [['sharp', say('Nets', 'Sharp')], ['standard', say('Standard', 'Standard')], ['soft', say('Doux', 'Soft')]].map((z) => ({ id: z[0], label: z[1], on: S.radius === z[0], tap: () => commit({ radius: z[0] }) })) })),
          h('div', { className: 'kbth-row' }, h('span', { className: 'kbth-lb' }, say('Ombres', 'Shadows')), seg({ items: [['none', say('Aucune', 'None')], ['soft', say('Douces', 'Soft')]].map((z) => ({ id: z[0], label: z[1], on: S.shadow === z[0], tap: () => commit({ shadow: z[0] }) })) })),
          ldToggle(say('Halo', 'Glow'), S.glow, () => commit({ glow: !S.glow }), say('Une lueur de ta couleur autour de la zone de message.', 'A soft light of your color around the message box.')),
          h('div', { className: 'kbth-row' }, h('span', { className: 'kbth-lb' }, say('Verre', 'Glass')), seg({ items: [['frosted', say('Dépoli', 'Frosted')], ['liquid', 'Liquid glass']].map((z) => ({ id: z[0], label: z[1], on: S.glassEffect === z[0], tap: () => commit({ glassEffect: z[0] }) })) })),
          sl(say('Flou du verre', 'Glass blur'), 0, 40, S.glassBlur, S.glassBlur + ' px', (v) => commit({ glassBlur: v }), wpOn ? undefined : themeNeeds)
        ]
        const accessPanel = () => [
          h('div', { className: 'kbth-row' }, h('span', { className: 'kbth-lb' }, say('Contraste', 'Contrast')), seg({ items: [['standard', 'Standard'], ['plus', say('Renforcé', 'Enhanced')], ['max', say('Maximal', 'Maximum')]].map((z) => ({ id: z[0], label: z[1], on: S.contrastMode === z[0], tap: () => commit({ contrastMode: z[0] }) })) })),
          ldToggle(say('Réduire les animations', 'Reduce animations'), S.reduceMotion, () => commit({ reduceMotion: !S.reduceMotion }), say('Coupe les boucles et les transitions.', 'Turns off loops and transitions.')),
          h('div', { className: 'kbth-row' }, h('span', { className: 'kbth-lb' }, say('Anneau de focus', 'Focus ring')), seg({ items: [['accent', 'Accent'], ['double', 'Double'], ['thick', say('Épais', 'Thick')]].map((z) => ({ id: z[0], label: z[1], on: S.focusRing === z[0], tap: () => commit({ focusRing: z[0] }) })) })),
          ldToggle(say('Cibles de 44 px', '44 px targets'), S.largeTargets, () => commit({ largeTargets: !S.largeTargets }), say('Boutons et champs plus grands.', 'Larger buttons and fields.')),
          ldToggle(say('Liens soulignés', 'Underlined links'), S.underlineLinks, () => commit({ underlineLinks: !S.underlineLinks })),
          ldToggle(say('Palette daltonisme', 'Color-blind palette'), S.cbSafe, () => commit({ cbSafe: !S.cbSafe }), say('Succès, alerte et erreur en couleurs plus sûres.', 'Success, warning and error in safer colors.'))
        ]
        const PANELS = {
          mood: [say('Clair ou sombre ?', 'Light or dark?'), moodPanel], style: [say('Choisis un style', 'Pick a style'), stylePanel], accent: [say('Couleur d’accent', 'Accent color'), accentPanel],
          sidebar: [say('Barre latérale', 'Sidebar'), sidebarPanel], wall: [say('Arrière-plan', 'Wallpaper'), wallPanel], user: [say('Tes messages', 'Your messages'), userPanel], agent: [say('Réponses de l’agent', 'Agent replies'), agentPanel],
          icons: [say('Icônes du menu', 'Menu icons'), iconsPanel], think: [say('Animation de réflexion', 'Thinking animation'), thinkPanel], letters: [say('Lettres', 'Letters'), lettersPanel],
          widgets: [say('Sous la zone de message', 'Under the message box'), widgetsPanel], effects: [say('Effets et formes', 'Effects and shape'), effectsPanel], access: [say('Accessibilité', 'Accessibility'), accessPanel]
        }

        // ══ the small DSH ═════════════════════════════════════════════════
        const fontStack = (FONTS.find((f) => f.id === S.fontText) || FONTS[0]).stack
        const k = S.fs / 15
        const px = (n) => (Math.round(n * k * 10) / 10) + 'px'
        const bub = bulleDe(S, c, dark)
        const userBg = bub.bg !== null ? bub.bg : dshBubble
        const userInk = bub.text !== null ? bub.text : c.t1
        const ownReply = S.replyColor
        const replyFrame = {}
        if (S.replyBg === 'card') { replyFrame.background = ownReply !== null ? ownReply : rgba(c.t1, 0.06); replyFrame.border = '1px solid ' + c.b2 }
        if (S.replyBg === 'outline') replyFrame.border = '1px solid ' + (ownReply !== null ? ownReply : c.b4)
        if (S.replyBg === 'tint') replyFrame.background = rgba(ownReply !== null ? ownReply : c.fill, 0.12)
        if (S.replyBg !== 'none') { replyFrame.borderRadius = 12 * (RADIUS_ECHELLE[S.radius] || 1); replyFrame.padding = '8px 11px' }
        const replyInk = S.textReply !== null ? S.textReply : (S.replyBg === 'card' && ownReply !== null ? encreSur(ownReply) : c.t1)
        const glass = wpOn ? 'blur(' + S.glassBlur + 'px)' : 'none'
        const sideBg = wpOn && S.sidebarLinked ? rgba(c.side, 1 - S.sidebarOpacity / 100) : c.side
        const inputBg = wpOn ? rgba(c.input, 1 - S.fieldOpacity / 100) : c.input
        const aj = ajustementFond(S)
        const flat = wpo.cat === 'patterns' || wpo.cat === 'colors'
        const rad = (n) => Math.round(n * (RADIUS_ECHELLE[S.radius] || 1))
        const sel0 = ld.S.sel.length > 0 ? ldById(ld.S.sel[0]) : null
        const word = (() => { const w = ldWordList(ld.S.pack); return w.length > 0 ? w[0] : say('Plongée', 'Deep diving') })()
        const dockOn = S.wgSessions || S.wgChanges || S.wgUsage
        const names = [['kyber', 'Kaby'], ['dash', say('Tableaux de bord', 'Dashboards')], ['ws', say('Espaces', 'Workspaces')], ['creations', say('Créations', 'Creations')], ['auto', say('Automatisations', 'Automations')]]
        const pencil = h('span', { className: 'kbth-stz-pen', 'aria-hidden': 'true' }, h('svg', { width: 10, height: 10, viewBox: '0 0 16 16', fill: 'currentColor' }, h('path', { d: ST_PENCIL })))
        const Z = (id, label, cls, style, ...kids) => h('div', {
          className: 'kbth-stz' + (zoneOn === id ? ' open' : '') + (cls ? ' ' + cls : ''), style, 'data-zone': id, 'data-kb': 'theme-zone', role: 'button', tabIndex: 0, 'aria-label': label, title: label,
          onClick: (e) => { e.stopPropagation(); setZone(id) },
          onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setZone(id) } }
        }, ...kids, pencil)

        const win = h('div', { className: 'kbth-st-win', 'data-kb': 'theme-st-window', style: { background: c.base, color: c.t1, fontFamily: fontStack === null ? undefined : fontStack, fontSize: px(12.5), borderColor: c.b2, borderRadius: rad(14) } },
          wpOn ? h('div', { className: 'kbth-st-wpl', 'aria-hidden': 'true', style: { background: wpo.css, backgroundSize: flat ? undefined : aj.size, backgroundPosition: 'center', backgroundRepeat: flat ? undefined : aj.repeat, opacity: S.wpVis / 100, filter: filtreFond(S), transform: S.bgMirror ? 'scaleX(-1)' : 'none' } }) : null,
          Z('sidebar', say('Changer la barre latérale', 'Change the sidebar'), 'kbth-st-side big', { background: sideBg, backdropFilter: wpOn && S.sidebarLinked ? glass : undefined, WebkitBackdropFilter: wpOn && S.sidebarLinked ? glass : undefined, borderRightColor: c.b1 },
            Z('style', say('Changer le style', 'Change the style'), 'kbth-st-brand', { color: c.accText }, S.showBrand ? h('span', { className: 'kbth-st-logo' }, h('b', null, 'K'), 'ybernos') : h('span', { className: 'kbth-st-logo' }, h('b', null, 'K'))),
            Z('icons', say('Changer les icônes du menu', 'Change the menu icons'), 'kbth-st-rows big', undefined,
              names.map((n, i) => h('div', { key: n[0], className: 'kbth-st-row1' + (i === 0 ? ' on' : ''), style: i === 0 ? { background: c.navAct, borderRadius: rad(8) } : { borderRadius: rad(8) } },
                h('span', { className: 'kbth-st-ico', style: { color: i === 0 ? c.accText : c.t3 }, dangerouslySetInnerHTML: { __html: stIcon(S.iconSet, n[0], i === 0, 16) } }),
                h('span', { className: 'kbth-st-rn', style: { color: i === 0 ? c.t1 : c.t2 } }, n[1]))))),
          h('div', { className: 'kbth-st-main' },
            h('div', { className: 'kbth-st-top', style: { borderBottomColor: c.b1 } },
              Z('letters', say('Changer les lettres', 'Change the letters'), 'kbth-st-title', undefined, say('Aide aux devoirs', 'Homework help')),
              Z('mood', say('Clair ou sombre', 'Light or dark'), 'kbth-st-moon', { color: c.t3, borderColor: c.b2 }, h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' }, dark ? h('path', { d: 'M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z', stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round' }) : [h('circle', { key: 'c', cx: 8, cy: 8, r: 3, stroke: 'currentColor', strokeWidth: 1.3 }), h('path', { key: 'r', d: 'M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' })]))),
            Z('wall', say('Changer l’arrière-plan', 'Change the wallpaper'), 'kbth-st-chat big', undefined,
              Z('user', say('Changer tes messages', 'Change your messages'), 'kbth-st-bub', { background: userBg, color: userInk, borderRadius: rad(14), alignSelf: 'flex-end' }, say('Peux-tu m’expliquer les fractions avec une pizza ?', 'Can you explain fractions with a pizza?')),
              Z('agent', say('Changer les réponses de l’agent', 'Change the agent’s replies'), 'kbth-st-reply1', { color: replyInk, ...replyFrame }, [say('Bien sûr ! Une pizza en 8 parts : si tu en manges 3, tu as mangé ', 'Sure! A pizza cut in 8 slices: if you eat 3, you ate '), h('code', { key: 'c', style: { background: c.code, borderRadius: rad(4), fontSize: px(11.5) } }, '3/8'), ' ', h('span', { key: 'l', style: { color: c.accText } }, say('Pourquoi ?', 'Why?'))]),
              Z('user', say('Changer tes messages', 'Change your messages'), 'kbth-st-bub2', { background: userBg, color: userInk, borderRadius: rad(14), alignSelf: 'flex-end' }, say('Maintenant, un quiz !', 'Now give me a quiz!')),
              Z('think', say('Changer l’animation de réflexion', 'Change the thinking animation'), 'kbth-st-think', { color: c.t2, fontSize: px(11.5) }, [
                h('span', { key: 'a', className: 'kbth-st-ld', style: { '--kb-px': Math.min(LD_SIZES[ld.S.size], 28) + 'px' } },
                  sel0 === null ? h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' }, h('path', { d: LD_WHALE, stroke: 'currentColor', strokeWidth: 1 })) : h(LdView, { key: sel0.id, l: sel0, px: Math.min(LD_SIZES[ld.S.size], 28), spd: ld.S.speed, tint: ld.S.tint && tAcc })),
                ld.S.keep ? h('span', { key: 't' }, word + (ld.S.dur ? ' · 12s' : '…')) : null])),
            h('div', { className: 'kbth-st-comp', style: { background: inputBg, borderColor: c.b2, borderRadius: rad(14), backdropFilter: wpOn ? glass : undefined, WebkitBackdropFilter: wpOn ? glass : undefined, boxShadow: [S.shadow === 'soft' ? '0 4px 14px rgba(0,0,0,.2)' : null, S.glow ? '0 0 14px ' + rgba(c.fill, 0.55) : null].filter((x) => x !== null).join(',') || undefined } },
              Z('letters', say('Changer les lettres', 'Change the letters'), 'kbth-st-ph', { color: c.t2 }, say('Écris ici…', 'Ask anything…')),
              Z('accent', say('Changer la couleur d’accent', 'Change the accent color'), 'kbth-st-send', { background: c.fill, color: c.onAcc, borderRadius: rad(10) }, h('svg', { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' }, h('path', { d: 'M2.5 8h11M9 3.5 13.5 8 9 12.5', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' })))),
            Z('widgets', say('Changer les pastilles sous la zone de message', 'Change the pills under the message box'), 'kbth-st-dock big', undefined, dockOn ? [
              S.wgSessions ? h('span', { key: 's', className: 'kbth-st-pillw', style: { borderColor: c.b2, color: c.t2, fontSize: px(10.5) } }, say('Enregistré', 'Saved')) : null,
              S.wgChanges ? h('span', { key: 'c', className: 'kbth-st-pillw', style: { borderColor: c.b2, color: c.t2, fontSize: px(10.5) } }, say('Changements', 'Changes')) : null,
              S.wgUsage ? h('span', { key: 'u', className: 'kbth-st-pillw', style: { borderColor: c.b2, color: c.t2, fontSize: px(10.5) } }, say('Usage 8 %', 'Usage 8%')) : null
            ] : h('span', { className: 'kbth-st-pillw none', style: { color: c.t4, fontSize: px(10.5) } }, say('Aucune pastille', 'No pills')))))

        // ══ the panel ═════════════════════════════════════════════════════
        const panel = zoneOn !== null && PANELS[zoneOn] !== undefined ? PANELS[zoneOn] : null
        const popEl = panel === null ? null : h('div', { className: 'kbth-st-pop', ref: pop, role: 'dialog', 'aria-label': panel[0], tabIndex: -1, 'data-kb': 'theme-st-panel', 'data-panel': zoneOn },
          h('div', { className: 'kbth-st-ph2' }, h('h3', null, panel[0]), h('div', { className: 'kbth-st-pa' }, dice(zoneOn), h('button', { type: 'button', className: 'kbth-btn', 'data-kb': 'theme-st-done', onClick: () => setZone(null) }, say('Terminé', 'Done')))),
          ...[panel[1]()].flat(Infinity))

        // ══ vibes, chips, actions, my looks ═══════════════════════════════
        const doSurprise = () => { props.setLibNote(null); apply(stSurprise()) }
        const vibes = h('div', { className: 'kbth-st-vibes', 'data-kb': 'theme-st-vibes' }, h('span', { className: 'kbth-st-lbl' }, say('Partir d’une ambiance', 'Start from a vibe')),
          ST_VIBES.map((v) => h('button', { key: v.id, type: 'button', className: 'kbth-st-chip', 'aria-pressed': stVibeOn(S, v) ? 'true' : 'false', 'data-kb': 'theme-st-vibe', 'data-id': v.id, onClick: () => applyVibe(v) }, h('i', { style: { background: v.dot } }), say(v.fr, v.en))),
          h('button', { type: 'button', className: 'kbth-st-chip surprise', 'data-kb': 'theme-st-surprise', onClick: doSurprise }, h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' }, h('rect', { x: 2, y: 2, width: 12, height: 12, rx: 3, stroke: 'currentColor', strokeWidth: 1.3 }), [[5.2, 5.2], [10.8, 5.2], [8, 8], [5.2, 10.8], [10.8, 10.8]].map((p, i) => h('circle', { key: i, cx: p[0], cy: p[1], r: 0.95, fill: 'currentColor' }))), say('Me surprendre', 'Surprise me')))
        const also = h('div', { className: 'kbth-st-also' }, h('span', { className: 'kbth-st-lbl' }, say('Aussi :', 'Also:')),
          [['accent', say('Couleur d’accent', 'Accent color')], ['effects', say('Effets et formes', 'Effects and shape')], ['access', say('Accessibilité', 'Accessibility')]].map((z) => h('button', { key: z[0], type: 'button', className: 'kbth-st-chip', 'data-chip': z[0], 'data-kb': 'theme-st-chip', 'aria-pressed': zoneOn === z[0] ? 'true' : 'false', onClick: (e) => { e.stopPropagation(); setZone(zoneOn === z[0] ? null : z[0]) } }, z[1])))
        const saveLook = () => {
          const name = presetName(lookName) === '' ? libFreeName(say('Mon thème', 'My theme')) : presetName(lookName)
          if (libNameTaken(name)) { props.setLibNote({ ok: false, text: say('Ce nom existe déjà. Choisis-en un autre.', 'That name already exists. Pick another one.') }); return }
          const rec = libAdd(name, 'me', presetFromState(S, { font: true, radius: true, icons: true, chat: true, glass: true, a11y: false }))
          if (rec === null) { props.setLibNote({ ok: false, text: say('La bibliothèque est pleine (' + PRESET_LIMIT + ' thèmes). Supprime-en un dans l’éditeur avancé › Partage.', 'The library is full (' + PRESET_LIMIT + ' themes). Delete one in the advanced editor › Sharing.') }); return }
          setLookName(''); commit({ skin: rec.id }); props.setLibNote({ ok: true, text: say('« ' + rec.name + ' » est enregistré dans Mes thèmes.', '“' + rec.name + '” is saved in My themes.') })
        }
        const exportLook = () => {
          const name = presetName(lookName) === '' ? say('Mon thème', 'My theme') : presetName(lookName)
          const file = presetFile({ name, settings: presetFromState(S, { font: true, radius: true, icons: true, chat: true, glass: true, a11y: false }) })
          props.setLibNote(downloadText('theme-' + fileSlug(name) + '.json', file) ? { ok: true, text: say('« ' + name + ' » est téléchargé en fichier .json.', '“' + name + '” is downloaded as a .json file.') } : { ok: false, text: say('Le téléchargement a échoué.', 'The download failed.') })
        }
        const actions = h('div', { className: 'kbth-st-actions' },
          h('button', { type: 'button', className: 'kbth-btn', 'data-kb': 'theme-st-undo', disabled: !props.canUndo(), onClick: () => { props.setLibNote(null); props.undo() } }, say('Annuler', 'Undo')),
          h('button', { type: 'button', className: 'kbth-btn', 'data-kb': 'theme-st-reset', onClick: () => { props.setLibNote(null); props.reset() } }, say('Réinitialiser', 'Reset')),
          h('span', { className: 'kbth-st-sp' }),
          h('input', { className: 'kbth-in', 'data-kb': 'theme-st-name', value: lookName, maxLength: PRESET_NAME_MAX, placeholder: say('Donne un nom à ce thème…', 'Name this look…'), 'aria-label': say('Nom du thème', 'Name of the look'), onInput: (e) => setLookName(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); saveLook() } } }),
          h('button', { type: 'button', className: 'kbth-btn kbth-ldpri', 'data-kb': 'theme-st-save', onClick: saveLook }, say('Enregistrer', 'Save')),
          h('button', { type: 'button', className: 'kbth-btn', 'data-kb': 'theme-st-export', onClick: exportLook }, say('Exporter', 'Export')),
          h('label', { className: 'kbth-btn', style: { cursor: 'pointer' } }, say('Importer', 'Import'), h('input', { type: 'file', accept: '.json,application/json', 'data-kb': 'theme-st-import', style: { display: 'none' }, onChange: (e) => { const input = e.target; const f = input.files && input.files[0]; if (f) props.importFile(f); input.value = '' } })))
        const mine = h('div', { className: 'kbth-st-looks', 'data-kb': 'theme-st-looks' }, h('span', { className: 'kbth-st-lbl' }, say('Mes thèmes', 'My looks')),
          lib.presets.length === 0 ? h('span', { className: 'kbth-hint' }, say('Aucun pour l’instant : règle ton thème, donne-lui un nom, puis Enregistrer.', 'None yet: set your look, name it, then Save.')) : null,
          lib.presets.map((rec) => (delId === rec.id
            ? h('span', { key: rec.id, className: 'kbth-st-look del' }, say('Supprimer « ' + rec.name + ' » ?', 'Delete “' + rec.name + '”?'),
              h('button', { type: 'button', className: 'kbth-btn kbth-danger kbth-gr-err', 'data-kb': 'theme-st-delyes', onClick: () => { libRemove(rec.id); setDelId(null); props.setLibNote({ ok: true, text: say('« ' + rec.name + ' » supprimé.', '“' + rec.name + '” deleted.') }) } }, say('Supprimer', 'Delete')),
              h('button', { type: 'button', className: 'kbth-btn', onClick: () => setDelId(null) }, say('Garder', 'Keep')))
            : h('span', { key: rec.id, className: 'kbth-st-look' + (S.skin === rec.id ? ' on' : '') },
              h('button', { type: 'button', className: 'kbth-st-lookb', 'data-kb': 'theme-st-look', 'data-id': rec.id, 'aria-pressed': S.skin === rec.id ? 'true' : 'false', onClick: () => { props.setLibNote(null); props.applyMine(rec) } },
                h('i', { style: { background: 'radial-gradient(circle at 50% 50%,' + (rec.settings.acc || '#808080') + ' 0 3.5px,' + makeTheme(rec.settings.mode === 'light' ? 'light' : 'dark', { acc: rec.settings.acc === undefined ? null : rec.settings.acc, ov: rec.settings.ov || {}, lvl: 0, cb: false, tint: 0, dom: '' }).base + ' 4px 100%)' } }), rec.name),
              h('button', { type: 'button', className: 'kbth-st-x', 'aria-label': say('Supprimer ', 'Delete ') + rec.name, onClick: () => setDelId(rec.id) }, '×')))),
          h('button', { type: 'button', className: 'kbth-link', onClick: () => props.openClassic('galerie') }, say('Trouver d’autres thèmes (galerie)', 'Find more looks (gallery)')))
        const status = props.libNote
        const hint = h('div', { className: 'kbth-st-hint' }, h('svg', { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'currentColor', 'aria-hidden': 'true' }, h('path', { d: ST_PENCIL })), h('b', null, say('Clique sur ce que tu veux changer', 'Click anything in the window')), say(' dans la fenêtre.', ' to change it.'))

        return h('div', { className: 'kbth-st' + (narrow ? ' narrow' : ''), 'data-kb': 'theme-studio' },
          vibes, hint,
          h('div', { className: 'kbth-st-stage', ref: stage, 'data-kb': 'theme-st-stage' }, win, popEl),
          also, actions,
          status !== null && status !== undefined ? h('div', { className: status.ok ? 'kbth-ok kbth-gr-ok' : 'kbth-bad kbth-gr-err', role: 'status', 'data-kb': 'theme-st-status' }, status.text) : null,
          mine)
      }
      // <look-studio:end>

      function Page(props) {
        const ctxRef = props.ctx
        const themeSvc = (ctxRef && ctxRef.theme) ? ctxRef.theme : null
        const [S, setS] = React.useState(readState())
        const [hexDraft, setHexDraft] = React.useState(null)
        const [wpCat, setWpCat] = React.useState('gradients')
        const [tokSel, setTokSel] = React.useState('l1')
        const [revision, setRevision] = React.useState(0)
        // The theme library (“My themes”): redrawn when it changes (own writes, or the disk copy arriving).
        const [, libBump] = React.useReducer((x) => x + 1, 0)
        React.useEffect(() => { lib.subs.add(libBump); libPull(true); return () => { lib.subs.delete(libBump) } }, [])
        const [saveDlg, setSaveDlg] = React.useState(null)       // null | { name, groups, error }: the “Save as theme” window
        const [renameId, setRenameId] = React.useState(null)     // Sharing: the row being renamed...
        const [renameDraft, setRenameDraft] = React.useState('')
        const [delId, setDelId] = React.useState(null)           // ...the one waiting for a delete confirmation...
        const [expId, setExpId] = React.useState(null)           // ...the one whose file is shown
        const [libNote, setLibNote] = React.useState(null)       // { ok, text }: the last thing the library did or refused
        // The gallery: redrawn when the catalogue arrives; the search and the filter live here.
        const [, galBump] = React.useReducer((x) => x + 1, 0)
        const [galQ, setGalQ] = React.useState('')
        const [galF, setGalF] = React.useState('all')           // 'all' | 'light' | 'dark'
        const [trial, setTrial] = React.useState(null)          // null | { id, name, prev }: a gallery theme being tried, and the look to come back to
        const trialRef = React.useRef(null)
        trialRef.current = trial
        const [exportFmt, setExportFmt] = React.useState('yaml')  // displayed export format (not stored)
        const [advTab, setAdvTab] = React.useState('essentiel') // open tab: Essentials = the basic settings
        const [classicOpen, setClassicOpen] = React.useState(false) // the editor of the nine tabs sits folded under the simple view
        // Undo: the looks before each change (the page's state and the animation store), at most 40; a burst of changes (a slider drag) is one step.
        const histRef = React.useRef([])
        const histAt = React.useRef(0)
        const pushHist = (cur) => {
          const now = Date.now()
          const gap = now - histAt.current
          histAt.current = now // the window slides: a drag that lasts three seconds is still one step
          if (gap < 700) return
          histRef.current.push(JSON.stringify({ s: cur === undefined ? readState() : cur, l: ld.S }))
          if (histRef.current.length > 40) histRef.current.shift()
        }

        // ── Font picker ────────────────────────────────────────────
        // The state lives here, with the other controls: rendering outside a browser
        // only runs Page, and a nested component would never be called.
        const [fontOuvert, setFontOuvert] = React.useState(false)
        const [fontQ, setFontQ] = React.useState('')
        const [fontActif, setFontActif] = React.useState(0)
        const boitePolice = React.useRef(null)
        const champPolice = React.useRef(null)
        React.useEffect(() => {
          const el = champPolice.current
          if (!fontOuvert || el === null) return undefined
          el.focus()
          // Escape closes the fonts panel, NOT the whole settings dialog: we cut the
          // propagation at the native level (the one the dialog listens at), not only in React.
          const stop = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setFontOuvert(false) } }
          el.addEventListener('keydown', stop)
          return () => el.removeEventListener('keydown', stop)
        }, [fontOuvert])
        React.useEffect(() => { setFontActif(0) }, [fontQ])
        React.useEffect(() => {
          // Follows the keyboard selection in a scrolling list.
          const el = boitePolice.current === null ? null : boitePolice.current.querySelector('[data-actif="1"]')
          if (el !== null && el !== undefined && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' })
        }, [fontActif, fontOuvert])
        React.useEffect(() => {
          // A click elsewhere closes it — no focus trap.
          if (!fontOuvert) return undefined
          const dehors = (e) => { if (boitePolice.current !== null && boitePolice.current.contains(e.target) === false) setFontOuvert(false) }
          document.addEventListener('mousedown', dehors)
          return () => document.removeEventListener('mousedown', dehors)
        }, [fontOuvert])

        // Picker rendering: a large button (the current font, in its own
        // typeface) + a panel with search and the list of families.
        const selecteurPolice = (courant, onPick) => {
          const plat = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          const liste = FONTS.filter((x) => plat(x.name).indexOf(plat(fontQ)) >= 0)
          const choisi = FONTS.find((x) => x.id === courant) || FONTS[0]
          const prendre = (id) => { onPick(id); setFontOuvert(false); setFontQ('') }
          const clavier = (e) => {
            if (e.key === 'Escape') { setFontOuvert(false); return }
            if (e.key === 'ArrowDown') { e.preventDefault(); setFontActif((i) => Math.min(i + 1, liste.length - 1)); return }
            if (e.key === 'ArrowUp') { e.preventDefault(); setFontActif((i) => Math.max(i - 1, 0)); return }
            if (e.key === 'Enter') { e.preventDefault(); if (liste[fontActif] !== undefined) prendre(liste[fontActif].id) }
          }
          return h('div', { className: 'kbth-fsel', ref: boitePolice },
            h('button', {
              type: 'button', className: 'kbth-fsbtn', 'aria-haspopup': 'listbox', 'aria-expanded': String(fontOuvert),
              onClick: () => setFontOuvert((o) => !o),
              style: choisi.stack === null ? {} : { fontFamily: choisi.stack }
            },
              h('span', { className: 'kbth-fsname' }, choisi.name),
              h('span', { className: 'kbth-fschev' },
                h('svg', { width: 15, height: 15, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
                  h('path', {
                    d: fontOuvert ? 'M3.5 10.5 8 6l4.5 4.5' : 'M3.5 5.5 8 10l4.5-4.5',
                    stroke: 'currentColor', strokeWidth: '1.6', strokeLinecap: 'round', strokeLinejoin: 'round'
                  })))),
            h('div', { className: 'kbth-fsmeta' }, choisi.stack === null ? kt('Police native de DSH', 'Native DSH font') : choisi.stack),
            fontOuvert
              ? h('div', { className: 'kbth-fspanel' },
                h('input', {
                  className: 'kbth-fssearch', ref: champPolice, value: fontQ, placeholder: kt('Rechercher une police…', 'Search a font…'),
                  'aria-label': kt('Rechercher une police', 'Search a font'), onInput: (e) => setFontQ(e.target.value), onKeyDown: clavier
                }),
                h('div', { className: 'kbth-fslist', role: 'listbox' },
                  liste.length === 0
                    ? h('div', { className: 'kbth-fsempty' }, kt('Aucune police ne correspond.', 'No font matches.'))
                    : liste.map((x, i) => h('button', {
                      key: x.id, type: 'button', role: 'option', className: 'kbth-fsopt',
                      'aria-selected': x.id === courant ? 'true' : 'false',
                      'data-actif': i === fontActif ? '1' : '0',
                      onMouseEnter: () => setFontActif(i),
                      onClick: () => prendre(x.id),
                      style: x.stack === null ? {} : { fontFamily: x.stack }
                    },
                      h('span', { className: 'kbth-fsopt-name' }, x.name),
                      h('span', { className: 'kbth-fsopt-sample' }, kt('Le renard brun saute par-dessus le chien paresseux.', 'The quick brown fox jumps over the lazy dog.'))))))
              : null)
        }

                // Follow the real mode (the native page can change it too). A
        // THIRD-PARTY preference (“nebula”…) is not a mode: storing it
        // would corrupt the state — we only follow the three native modes.
        React.useEffect(() => {
          if (themeSvc === null || typeof themeSvc.getTheme !== 'function') return
          try {
            const snap = themeSvc.getTheme()
            if (snap && snap.preference && snap.preference !== S.mode
              && (snap.preference === 'light' || snap.preference === 'dark' || snap.preference === 'system')) {
              setS((cur) => ({ ...cur, mode: snap.preference }))
            }
            const px = tailleNative(themeSvc, snap)
            if (px !== null && px !== S.fs) setS((cur) => ({ ...cur, fs: px }))
          } catch (e) { /* lecture impossible */ }
        }, [revision])

        // Subscribe to theme changes: when a third-party plugin takes
        // over (dream-skin reasserts its theme in under 250 ms), the conflict
        // note must REAPPEAR — without this subscription, it was only computed
        // on our own re-renders and stayed hidden after the counter-move.
        React.useEffect(() => {
          if (ctxRef === null || ctxRef === undefined || typeof ctxRef.on !== 'function') return
          let rendu = null
          try {
            rendu = ctxRef.on('theme/change', () => setRevision((r) => r + 1))
          } catch (e) { rendu = null }
          return () => { try { if (typeof rendu === 'function') rendu() } catch (e) { /* already detached */ } }
        }, [])

        // `transient`: drawn but NOT stored, so a reload (or closing Settings) gives the previous look back: that is a trial.
        // Any other change made during a trial ends it: the person is editing the look they see.
        const commit = (patch, replace, transient, noHist) => {
          if (transient !== true && trialRef.current !== null) { trialRef.current = null; setTrial(null) }
          setS((cur) => {
            const next = replace === true ? { ...patch } : { ...cur, ...patch }
            if (transient !== true && noHist !== true) pushHist(cur)
            if (transient !== true) writeState(next)
            if (themeSvc !== null) appliquerTout(themeSvc, next)
            return next
          })
        }
        // Closing Settings with a trial running puts the stored look back. Not through setS: the page is gone by then.
        React.useEffect(() => {
          gal.subs.add(galBump)
          return () => {
            gal.subs.delete(galBump)
            const t = trialRef.current
            if (t !== null && themeSvc !== null) { try { appliquerTout(themeSvc, t.prev) } catch (e) { /* nothing more to do */ } }
          }
        }, [])
        // A reload or a closed tab are not an unmount: put the stored look back then too (a trial may have switched the mode, which DSH keeps).
        React.useEffect(() => {
          if (trial === null || themeSvc === null || typeof window === 'undefined') return undefined
          const back = () => { const t = trialRef.current; if (t !== null) { try { appliquerTout(themeSvc, t.prev) } catch (e) { /* page is going away */ } } }
          window.addEventListener('pagehide', back)
          return () => window.removeEventListener('pagehide', back)
        }, [trial !== null])
        React.useEffect(() => {
          if (advTab !== 'galerie') return
          if (gal.state === 'idle' || gal.state === 'error') galLoad().then(() => { if (!gal.refreshed) galRefresh() })
          else if (!gal.refreshed) galRefresh()
        }, [advTab])

        const wpo = WPS.find((w) => w.id === S.wp) || WPS[0]
        const o = optsDe(S)
        const dark = schemeSombre(S)
        const c = makeTheme(dark ? 'dark' : 'light', o)
        const cl = makeTheme('light', o)
        const cd = makeTheme('dark', o)

        // The ready-made theme picker: concentric “chip” dot.
        // The theme's BACKGROUND as a disc, the ACCENT as a centred dot — the 135°
        // diagonal with a hard stop (measured on 30/09) read like a
        // road sign, not like a theme. A skin without a mode (inherited pack)
        // is drawn in the current scheme: that is the one the user
        // will see when selecting it.
        const skinDot = (sk) => {
          const m = (sk.mode === null || sk.mode === undefined) ? (dark ? 'dark' : 'light') : sk.mode
          const so = { acc: sk.acc, ov: sk.ov || {}, lvl: 0, cb: false, tint: 0, dom: '' }
          const sd = makeTheme(m, so)
          const acc = skinAccent(sk) || sd.brand
          // point d'accent 13 px sur disque 34 px (~38 %), bord adouci 0,5 px
          // to avoid the anti-aliasing staircase on the circle.
          return 'radial-gradient(circle at 50% 50%,' + acc + ' 0 6.5px,' + sd.base + ' 7px 100%)'
        }
        const skinMeta = (sk) => (sk.mode === 'dark' ? kt('Sombre', 'Dark') : (sk.mode === 'light' ? kt('Clair', 'Light') : kt('Clair + sombre', 'Light + dark'))) +
          (skinAccent(sk) === null ? kt(' · accent neutre', ' · neutral accent') : ' · ' + skinAccent(sk)) +
          (sk.fontText !== undefined ? kt(' · police ', ' · font ') + (FONTS.find((f) => f.id === sk.fontText) || FONTS[0]).name : '') +
          (sk.radius !== undefined ? ' · ' + kt(RADIUS_LABEL[sk.radius][0], RADIUS_LABEL[sk.radius][1]) : '') +
          (sk.iconSet !== undefined ? ((nm) => kt(' · icônes ' + nm, ' · ' + nm + ' icons'))((ICON_SETS.find((x) => x.id === sk.iconSet) || ICON_SETS[0])[kbLang()]) : '')

        // The theme in use: one of yours, or a shipped one. “Modified” = a setting it retains has moved.
        const activeMine = lib.presets.find((x) => x.id === S.skin) || null
        const activeSkin = activeMine !== null ? null : (SKINS.find((x) => x.id === S.skin) || null)
        const activeNow = activeMine !== null ? presetAsSkin(activeMine) : activeSkin
        const activeModified = activeMine !== null ? settingsDirty(S, activeMine.settings) : (activeSkin !== null && settingsDirty(S, skinSettings(activeSkin)))
        const applyMine = (rec) => commit({ skin: rec.id, ...rec.settings })
        // Back to the theme as it was saved. The mode stays as it is: it is not part of “modified” either.
        const revertTheme = () => {
          const full = activeMine !== null ? { skin: activeMine.id, ...activeMine.settings } : (activeSkin !== null ? skinPatch(activeSkin) : null)
          if (full === null) return
          const { mode, ...rest } = full
          setHexDraft(null); commit(rest)
        }
        const openSave = () => { setLibNote(null); setSaveDlg({ name: libFreeName(kt('Mon thème', 'My theme')), groups: { font: true, radius: true, icons: true, chat: true, glass: true, a11y: false }, error: '' }) }
        const doSave = () => {
          if (saveDlg === null) return
          const name = presetName(saveDlg.name)
          if (name === '') { setSaveDlg({ ...saveDlg, error: kt('Donne un nom au thème.', 'Give the theme a name.') }); return }
          if (libNameTaken(name)) { setSaveDlg({ ...saveDlg, error: kt('Ce nom existe déjà. Choisis-en un autre.', 'That name already exists. Pick another one.') }); return }
          const rec = libAdd(name, 'me', presetFromState(S, saveDlg.groups))
          if (rec === null) { setSaveDlg({ ...saveDlg, error: kt('La bibliothèque est pleine (' + PRESET_LIMIT + ' thèmes). Supprime-en un dans Partage.', 'The library is full (' + PRESET_LIMIT + ' themes). Delete one in Sharing.') }); return }
          setSaveDlg(null); commit({ skin: rec.id })
          setLibNote({ ok: true, text: kt('Thème « ' + rec.name + ' » enregistré dans Mes thèmes.', 'Theme “' + rec.name + '” saved in My themes.') })
        }
        const doUpdate = () => {
          if (activeMine === null) return
          libPatch(activeMine.id, { settings: presetFromState(S, groupsOf(activeMine.settings)) })
          setLibNote({ ok: true, text: kt('Thème « ' + activeMine.name + ' » mis à jour.', 'Theme “' + activeMine.name + '” updated.') })
        }

        // An active THIRD-PARTY theme (dream-skin…) takes over the preference:
        // measured, a setTheme('light') is reasserted dark in under 250 ms.
        // We cannot win this tug of war silently — we say so.
        let themeTiers = null
        try {
          const pref = themeSvc !== null && typeof themeSvc.getTheme === 'function' ? (themeSvc.getTheme() || {}).preference : null
          if (pref !== null && pref !== 'light' && pref !== 'dark' && pref !== 'system') themeTiers = pref
        } catch (e) { themeTiers = null }

        // The field and the eyedropper show the EFFECTIVE accent: the one chosen by
        // hand, otherwise that of the current skin (inherited packs carry their
        // accent per scheme in `ov`, so S.acc stays null).
        const hexShown = hexDraft !== null ? hexDraft : ((S.acc === null ? c.brand : S.acc).replace('#', ''))

        // ── Simple : apparence ──────────────────────────────────────────────
        const skinButton = (sk, rec) => h('button', {
          key: sk.id, type: 'button', className: 'kbth-skin',
          'aria-pressed': S.skin === sk.id ? 'true' : 'false',
          title: sk.name + ' — ' + skinMeta(sk),
          'aria-label': sk.name + ' — ' + skinMeta(sk),
          onClick: () => { setLibNote(null); setHexDraft(null); if (rec === null) commit(skinPatch(sk)); else applyMine(rec) }
        },
          h('span', { className: 'kbth-skin-dot', style: { background: skinDot(sk) } }),
          h('span', { className: 'kbth-skin-name' }, sk.name))
        const toSharing = h('button', { type: 'button', className: 'kbth-link', 'data-kb': 'theme-open-sharing', onClick: () => setAdvTab('partage') }, kt('Partage', 'Sharing'))
        const toGallery = h('button', { type: 'button', className: 'kbth-link', 'data-kb': 'theme-open-gallery', onClick: () => setAdvTab('galerie') }, kt('Galerie', 'Gallery'))
        const themeSummary = h('div', { className: 'kbth-sum', 'data-kb': 'theme-sum' },
          h('div', { className: 'kbth-sum-tx' },
            h('div', { className: 'kbth-sum-n' }, activeNow === null ? kt('Personnalisé', 'Custom') : activeNow.name,
              activeModified ? h('span', { className: 'kbth-tone kbth-tone-mod', 'data-kb': 'theme-modified' }, kt('modifié', 'modified')) : null,
              activeNow === null ? null : h('span', { className: 'kbth-pill' }, activeMine === null ? kt('livré', 'shipped') : (activeMine.source === 'gallery' ? kt('Galerie', 'Gallery') : kt('à toi', 'yours')))),
            libNote !== null
              ? h('div', { className: libNote.ok ? 'kbth-ok kbth-gr-ok' : 'kbth-bad kbth-gr-err', role: 'status', 'data-kb': 'theme-note' }, libNote.text)
              : h('div', { className: 'kbth-sum-m' }, activeNow === null
                ? kt('Réglage libre : enregistre-le pour le retrouver en un clic.', 'Free setting: save it to get it back in one click.')
                : skinMeta(activeNow) + (activeModified && activeMine === null ? kt(' · un thème livré ne se modifie pas : enregistre-en une copie.', ' · a shipped theme is not edited: save a copy.') : ''))),
          h('div', { className: 'kbth-sum-a' },
            activeMine !== null && activeModified ? h('button', { type: 'button', className: 'kbth-btn kbth-ldpri', 'data-kb': 'theme-update', onClick: doUpdate }, kt('Mettre à jour', 'Update')) : null,
            h('button', { type: 'button', className: 'kbth-btn' + (activeMine !== null && activeModified ? '' : ' kbth-ldpri'), 'data-kb': 'theme-save', onClick: openSave }, kt('Enregistrer sous…', 'Save as…')),
            activeModified ? h('button', { type: 'button', className: 'kbth-btn', 'data-kb': 'theme-revert', onClick: revertTheme }, kt('Annuler les changements', 'Undo the changes')) : null))
        const themeBlock = h('div', { className: 'kbth-sec', 'data-kb': 'theme-block' },
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, kt('Thème', 'Theme')),
            h('div', { className: 'kbth-sec-d' }, kt('Un thème règle les couleurs ; il peut aussi retenir la police, les coins et les icônes du menu. Gère les tiens dans ', 'A theme sets the colors; it can also keep the font, the corners and the menu icons. Manage yours in '), toSharing, '.')),
          h('div', { className: 'kbth-skinblock' },
            h('div', { className: 'kbth-grp' }, kt('Livrés', 'Shipped')),
            h('div', { className: 'kbth-skins', 'data-kb': 'theme-shipped' }, SKINS.map((sk) => skinButton(sk, null)))),
          h('div', { className: 'kbth-skinblock' },
            h('div', { className: 'kbth-grp' }, kt('Mes thèmes', 'My themes')),
            h('div', { className: 'kbth-skins', 'data-kb': 'theme-mine' },
              lib.presets.map((rec) => skinButton(presetAsSkin(rec), rec)),
              h('button', { type: 'button', className: 'kbth-skin kbth-skin-add', 'data-kb': 'theme-add', 'aria-label': kt('Enregistrer l’état actuel comme thème', 'Save the current look as a theme'), onClick: openSave },
                h('span', { className: 'kbth-skin-dot', 'aria-hidden': 'true' }, '+'),
                h('span', { className: 'kbth-skin-name' }, kt('Enregistrer', 'Save')))),
            lib.presets.length === 0 ? h('div', { className: 'kbth-empty' }, kt('Aucun thème à toi pour l’instant. Règle l’apparence puis « Enregistrer », importe un fichier dans ', 'No theme of yours yet. Set the look, then “Save”, import a file in '), toSharing, kt(', ou installe-en un depuis la ', ', or install one from the '), toGallery, '.') : null),
          themeSummary,
          S.skin === 'dsh' ? h('div', { className: 'kbth-hint' }, kt('« Défaut DSH » retire la couche de jetons : l’apparence native repasse telle quelle.', '“DSH default” removes the token layer: the native look comes back as is.')) : null)

        // The mode (Light / Dark / System) is set HERE, on three cards (the Appearance page that used to hold them is gone). The same preference as the footer's sun/moon:
        // `commit({ mode })` stores it in this page's state and writes it through `themeSvc.setTheme`. A third-party theme that takes the preference over is told below.
        const modes = [['light', kt('Clair', 'Light')], ['dark', kt('Sombre', 'Dark')], ['system', kt('Système', 'System')]]
        const conflictNote = themeTiers === null ? null : h('div', { className: 'kbth-conflict' },
          h('strong', null, kt('Conflit de thème : ', 'Theme conflict: ')),
          kt('Un autre plugin (« ' + themeTiers + ' ») contrôle le mode clair/sombre. ', 'Another plugin (“' + themeTiers + '”) controls the light/dark mode. '),
          kt('Désactive-le dans son propre panneau pour que ce réglage s’applique.', 'Turn it off in its own panel for this setting to apply.'))
        const apparence = h('div', { className: 'kbth-sec' },
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, kt('Apparence', 'Appearance')),
            h('div', { className: 'kbth-sec-d' }, kt('Choisis le mode clair ou sombre, puis un thème prêt à l’emploi.', 'Pick the light or dark mode, then a ready-made theme.'))),
          h('div', { className: 'kbth-modes', 'data-kb': 'theme-mode', role: 'radiogroup', 'aria-label': kt('Mode', 'Mode') },
            modes.map((m) => {
              const on = S.mode === m[0]
              return h('button', {
                key: m[0], type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false', 'data-kb': 'theme-mode-card', 'data-mode': m[0],
                className: 'kbth-mode' + (on ? ' on' : ''), onClick: () => commit({ mode: m[0] }),
              },
                h('span', { className: 'kbth-mode-pv kbth-mode-pv-' + m[0], 'aria-hidden': 'true' },
                  m[0] === 'system'
                    ? [h('span', { key: 'l', className: 'kbth-mode-half kbth-mode-light' }, h('i', null)), h('span', { key: 'd', className: 'kbth-mode-half kbth-mode-dark' }, h('i', null))]
                    : h('i', null)),
                h('span', { className: 'kbth-mode-n' }, m[1], on ? h('span', { className: 'kbth-mode-cur' }, '● ' + kt('actuel', 'current')) : null))
            })),
          h('div', { className: 'kbth-hint' }, kt('S’applique à toute l’interface DSH. « Système » suit le réglage de ton appareil.', 'Applies to the whole DSH interface. “System” follows your device setting.')),
          conflictNote,
          h('button', { className: 'kbth-btn', type: 'button', style: { width: 'max-content' },
            onClick: () => commit(surprendre()) }, kt('Me surprendre', 'Surprise me')),
          themeBlock)

        // ── Simple : couleur ────────────────────────────────────────────────
        const accentHex = S.acc === null ? c.brand : S.acc
        const couleur = h('div', { className: 'kbth-sec' },
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, kt('Couleur', 'Color')),
            h('div', { className: 'kbth-sec-d' }, kt('Teinte des boutons, interrupteurs et sélections.', 'Tint of buttons, switches and selections.'))),
          h('div', { className: 'kbth-row' },
            h('span', { className: 'kbth-lb' }, 'Accent'),
            h('div', { className: 'kbth-acc' },
              h('label', { className: 'kbth-sw', style: { background: accentHex }, title: kt('Pipette', 'Eyedropper') },
                h('input', { type: 'color', value: accentHex, 'aria-label': kt('Choisir la couleur d’accent', 'Pick the accent color'),
                  onInput: (e) => { setHexDraft(null); commit({ acc: e.target.value }) } })),
              h('label', { className: 'kbth-hex' + (hexDraft !== null && !validHex(hexDraft) ? ' bad' : '') },
                h('span', null, '#'),
                h('input', { value: hexShown, maxLength: 7, spellCheck: false, 'aria-label': kt('Code hexadécimal', 'Hex code'),
                  onInput: (e) => {
                    const v = e.target.value
                    setHexDraft(v)
                    const p = HEX(v)
                    if (p !== null) commit({ acc: toHex(p) })
                  } })),
              S.acc !== null ? h('button', { className: 'kbth-btn', type: 'button',
                onClick: () => { setHexDraft(null); commit({ acc: null }) } }, kt('Rétablir', 'Reset')) : null)),
          h('div', { className: 'kbth-dots' },
            ACCS.map((a) => h('button', {
              key: a, type: 'button', className: 'kbth-dot', style: { background: a },
              'aria-pressed': S.acc !== null && S.acc.toLowerCase() === a.toLowerCase() ? 'true' : 'false',
              title: a, 'aria-label': 'Accent ' + a,
              onClick: () => { setHexDraft(null); commit({ acc: a }) } }))))
        // P2-8 (chasse Settings 27/09) : les ratios WCAG restent en vue
        // Advanced — in Simple, this contrast jargon has no business here.
        const ratiosAccent = h('div', { className: 'kbth-hint' },
          kt('L’accent dérivé vise 4,5:1 sur les deux schémas : ', 'The derived accent aims for 4.5:1 on both schemes: '),
          h('span', {
            className: 'kbth-acc-ratio', 'data-texte': c.accText, 'data-fond': c.l1,
            title: kt('Texte d’accent sur la couche 1', 'Accent text on layer 1')
          }, ratio(c.accText, c.l1).toFixed(2) + ':1 (' + (dark ? kt('sombre', 'dark') : kt('clair', 'light')) + ')'),
          kt(' pour le texte d’accent, ', ' for the accent text, '),
          h('span', {
            className: 'kbth-btn-ratio', 'data-texte': c.onAcc, 'data-fond': c.fill,
            title: kt('Texte sur un bouton d’accent', 'Text on an accent button')
          }, ratio(c.onAcc, c.fill).toFixed(2) + ':1'),
          kt(' pour le texte d’un bouton plein.', ' for the text of a filled button.'))
        // ── Simple : fond ───────────────────────────────────────────────────
        // The “None” tile opens the grid: without it, a background that was set could no longer be removed.
        const fonds = [WPS[0]].concat(WPS.filter((w) => w.cat === wpCat))
        const fond = h('div', { className: 'kbth-sec' },
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, kt('Arrière-plan', 'Background')),
            h('div', { className: 'kbth-sec-d' }, kt('Couleur, dégradé, motif ou image derrière l’interface.', 'Color, gradient, pattern or image behind the interface.'))),
          h('div', { className: 'kbth-row' },
            h('span', { className: 'kbth-lb' }, kt('Fond', 'Background')),
            h('div', { className: 'kbth-wpcats' },
              WPCATS.map((cat) => h('button', {
                key: cat.id, type: 'button', className: 'kbth-cat',
                'aria-pressed': wpCat === cat.id ? 'true' : 'false',
                onClick: () => setWpCat(cat.id) }, cat.name)),
              wpo.id !== 'none' && WPCATS.every((cat) => cat.id !== wpo.cat)
                ? h('button', { type: 'button', className: 'kbth-cat', onClick: () => commit({ wp: 'none' }) }, kt('Retirer (« ' + wpo.name + ' »)', 'Remove (“' + wpo.name + '”)')) : null)),
          h('div', { className: 'kbth-wps' },
            fonds.map((w) => h('button', {
              key: w.id, type: 'button', className: 'kbth-wp',
              'aria-pressed': S.wp === w.id ? 'true' : 'false', title: w.name,
              onClick: () => commit({ wp: w.id }) },
              h('span', { className: 'kbth-wp-band', style: { background: w.css } }),
              h('span', { className: 'kbth-wp-name', title: w.name }, w.name)))),
          wpo.id !== 'none' ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
            slider({ label: kt('Visibilité', 'Visibility'), min: 0, max: 100, value: S.wpVis, text: S.wpVis + ' %',
              tap: (v) => commit({ wpVis: v }), hint: kt('Opacité du fond derrière l’interface.', 'Opacity of the background behind the interface.') }),
            slider({ label: kt('Flou', 'Blur'), min: 0, max: 40, value: S.wpBlur, text: S.wpBlur + ' px',
              tap: (v) => commit({ wpBlur: v }), hint: kt('Adoucit le fond pour laisser la place au contenu.', 'Softens the background to make room for the content.') }),
            slider({ label: kt('Teinte des surfaces', 'Surface tint'), min: 0, max: 100, value: S.tint, text: S.tint + ' %',
              tap: (v) => commit({ tint: v }), hint: kt('Tire les panneaux vers la dominante du fond, pour que l’interface s’y fonde.', 'Pulls the panels towards the dominant color of the background, so the interface blends into it.') })) : null)

        // ── Simple : police ─────────────────────────────────────────────────
        const police = h('div', { className: 'kbth-sec' },
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, kt('Police', 'Font')),
            h('div', { className: 'kbth-sec-d' }, kt('Choisis la police de l’interface ; la recherche filtre les familles.', 'Choose the interface font; search filters the families.'))),
          selecteurPolice(S.fontText, (id) => commit({ fontText: id })),
          slider({ label: kt('Taille du texte', 'Text size'), min: 12, max: 17, value: S.fs, text: S.fs + ' px',
            tap: (v) => commit({ fs: v }), hint: kt('La taille de la conversation — le réglage natif de DSH, en direct.', 'The conversation size — DSH’s native setting, live.') }))

        // ── Simple: menu icons ─────────────────────────────────────────
        // One row of the nine entries per state (grey at rest, then the colour of the open page). The classic set is drawn by the
        // application itself, which owns its line icons: it lends the drawing through window.__KB_MENU_CLASSIC__.
        const iconeApercu = (setId, etat) => h('div', { className: 'kbth-icset-r', style: setId === 'classic' && etat ? { color: 'var(--dsw-alias-brand-primary)' } : undefined },
          ICON_ENTRIES.map((e) => {
            let svg = null
            try {
              svg = setId === 'classic'
                ? (typeof window.__KB_MENU_CLASSIC__ === 'function' ? window.__KB_MENU_CLASSIC__(e, 18) : null)
                : iconSvg(setId, e, etat, 18)
            } catch (err) { svg = null }
            return h('span', { key: e, className: 'kbth-icset-i', dangerouslySetInnerHTML: { __html: typeof svg === 'string' ? svg : '' } })
          }))
        const icones = h('div', { className: 'kbth-sec', 'data-kb': 'theme-icons' },
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, kt('Icônes du menu', 'Menu icons')),
            h('div', { className: 'kbth-sec-d' }, kt('Le dessin des entrées de la barre latérale : gris au repos, en couleur sur la page ouverte. Un thème peut le retenir.', 'How the sidebar entries are drawn: grey at rest, in colour on the open page. A theme can keep it.'))),
          h('div', { className: 'kbth-icsets', role: 'radiogroup', 'aria-label': kt('Icônes du menu', 'Menu icons') },
            ICON_SETS.map((st) => h('button', {
              key: st.id, type: 'button', role: 'radio', 'aria-checked': S.iconSet === st.id ? 'true' : 'false',
              className: 'kbth-icset' + (S.iconSet === st.id ? ' on' : ''), 'data-kb': 'theme-icset', 'data-id': st.id,
              title: st.hint[kbLang()], onClick: () => commit({ iconSet: st.id })
            }, h('span', { className: 'kbth-icset-n' }, st[kbLang()]), iconeApercu(st.id, false), iconeApercu(st.id, true)))))

        // The Essentiel tab only says which set is in use; the sets themselves live in their own tab, next to Animation.
        const iconesNom = (ICON_SETS.find((x) => x.id === S.iconSet) || ICON_SETS[0])[kbLang()]
        const iconesResume = h('div', { className: 'kbth-sum', 'data-kb': 'icons-summary' },
          h('div', { className: 'kbth-sum-tx' },
            h('span', { className: 'kbth-sec-t', style: { textTransform: 'none', fontSize: 13 } }, kt('Icônes du menu', 'Menu icons')),
            h('span', { className: 'kbth-hint' }, kt(iconesNom + ' · ' + (ICON_SETS.length - 1) + ' jeux à choisir', iconesNom + ' · ' + (ICON_SETS.length - 1) + ' sets to choose from')),
            iconeApercu(S.iconSet, false)),
          h('button', { type: 'button', className: 'kbth-btn', 'data-kb': 'icons-open', onClick: () => setAdvTab('icones') }, kt('Régler…', 'Adjust…')))

        // ── Advanced: sub-tabs ──────────────────────────────────────────
        const ADV_TABS = [
          { id: 'essentiel', label: kt('Essentiel', 'Essentials') },
          { id: 'verre', label: kt('Verre et fond', 'Glass and background') },
          { id: 'couleurs', label: kt('Couleurs', 'Colors') },
          { id: 'texte', label: kt('Texte et forme', 'Text and shape') },
          { id: 'animation', label: 'Animation' },
          { id: 'icones', label: kt('Icônes', 'Icons') },
          { id: 'accessibilite', label: kt('Accessibilité', 'Accessibility') },
          { id: 'partage', label: kt('Partage', 'Sharing') },
          { id: 'galerie', label: kt('Galerie', 'Gallery') }
        ]

        // Reusable toggle switch
        const toggle = (label, value, onToggle, hint) => h('div', { className: 'kbth-toggle-row' },
          h('span', { className: 'kbth-toggle-label' }, label, hint ? h('span', { className: 'kbth-toggle-hint', title: hint }, ' ?') : null),
          h('button', { type: 'button', className: 'kbth-toggle' + (value ? ' on' : ''), role: 'switch', 'aria-checked': value ? 'true' : 'false', 'aria-label': label, onClick: onToggle },
            h('span', { className: 'kbth-toggle-knob' })))

        // ── Essentials tab (= condensed Simple mode) ──────────────────────
        const advEssentiel = h('div', { className: 'kbth-sec' },
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, kt('Essentiel', 'Essentials')),
            h('div', { className: 'kbth-sec-d' }, kt('Apparence, accent, fond, police et icônes du menu.', 'Appearance, accent, background, font and menu icons.'))),
          apparence, couleur, ratiosAccent, fond, police, iconesResume,
          h(LdSummary, { onOpen: () => setAdvTab('animation') }))

        // ── Onglet Verre et fond ───────────────────────────────────────────
        // The glass settings only have an effect on a background: without a chosen background we say so, and the preview shows
        // what the setting would give (the real background is only visible behind the chat, not in the settings).
        const wpOn = wpo.id !== 'none'
        const aj = ajustementFond(S)
        const verreAlpha = (k, v) => rgba(c[k], v)
        const flou = S.glassBlur > 0 ? 'blur(' + S.glassBlur + 'px)' + (S.glassEffect === 'liquid' ? ' saturate(165%) brightness(1.06)' : '') : 'none'
        const verrePreview = h('div', { className: 'kbth-gpv', 'data-kb': 'glass-preview', style: { background: c.base } },
          wpOn ? h('div', { className: 'kbth-gpv-bg', style: { background: wpo.css, backgroundSize: wpo.cat === 'patterns' || wpo.cat === 'colors' ? undefined : aj.size, backgroundPosition: 'center', backgroundRepeat: wpo.cat === 'patterns' || wpo.cat === 'colors' ? undefined : aj.repeat, opacity: S.wpVis / 100, filter: filtreFond(S), transform: S.bgMirror ? 'scaleX(-1)' : 'none' } }) : null,
          h('div', { className: 'kbth-gpv-side', style: { background: wpOn && S.sidebarLinked ? verreAlpha('side', 1 - S.sidebarOpacity / 100) : c.side, backdropFilter: wpOn && S.sidebarLinked ? flou : 'none', WebkitBackdropFilter: wpOn && S.sidebarLinked ? flou : 'none' } },
            h('span', { className: 'kbth-gpv-line' }), h('span', { className: 'kbth-gpv-line' }), h('span', { className: 'kbth-gpv-line short' })),
          h('div', { className: 'kbth-gpv-main' },
            h('div', { className: 'kbth-gpv-menu', style: { background: wpOn ? verreAlpha('l3', 1 - S.floatOpacity / 100) : c.l3, backdropFilter: wpOn ? flou : 'none', WebkitBackdropFilter: wpOn ? flou : 'none' } }, h('span', { className: 'kbth-gpv-line' }), h('span', { className: 'kbth-gpv-line short' })),
            h('div', { className: 'kbth-gpv-input', style: { background: wpOn ? verreAlpha('input', 1 - S.fieldOpacity / 100) : c.input, backdropFilter: wpOn ? flou : 'none', WebkitBackdropFilter: wpOn ? flou : 'none' } }, h('span', { className: 'kbth-gpv-line short' }))))
        const advVerre = h('div', { className: 'kbth-sec' },
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, kt('Verre', 'Glass')),
            h('div', { className: 'kbth-sec-d' }, kt('Transparence et flou des surfaces posées sur le fond.', 'Transparency and blur of the surfaces placed over the background.'))),
          verrePreview,
          wpOn ? null : h('div', { className: 'kbth-note' }, kt('Ces réglages s’appliquent dès qu’un fond est choisi : Essentiel › Arrière-plan.', 'These settings apply as soon as a background is chosen: Essentials › Background.')),
          h('div', { className: 'kbth-row' },
            h('span', { className: 'kbth-lb' }, kt('Effet', 'Effect')),
            seg({ items: [
              { id: 'frosted', label: kt('Verre dépoli', 'Frosted glass'), on: S.glassEffect === 'frosted', tap: () => commit({ glassEffect: 'frosted' }) },
              { id: 'liquid', label: 'Liquid glass', on: S.glassEffect === 'liquid', tap: () => commit({ glassEffect: 'liquid' }) }] })),
          slider({ label: kt('Flou du verre', 'Glass blur'), min: 0, max: 40, value: S.glassBlur, text: S.glassBlur + ' px', tap: (v) => commit({ glassBlur: v }) }),
          toggle(kt('Lier la barre latérale au fond', 'Link the sidebar to the background'), S.sidebarLinked, () => commit({ sidebarLinked: !S.sidebarLinked }), kt('Désactivé, la barre latérale reste pleine.', 'When off, the sidebar stays solid.')),
          h('div', { style: S.sidebarLinked ? null : { opacity: 0.45, pointerEvents: 'none' } },
            slider({ label: kt('Transparence de la barre latérale', 'Sidebar transparency'), min: 0, max: 100, value: S.sidebarOpacity, text: S.sidebarOpacity + ' %', tap: (v) => commit({ sidebarOpacity: v }) })),
          slider({ label: kt('Transparence des champs', 'Field transparency'), min: 0, max: 100, value: S.fieldOpacity, text: S.fieldOpacity + ' %', tap: (v) => commit({ fieldOpacity: v }) }),
          slider({ label: kt('Transparence des menus', 'Menu transparency'), min: 0, max: 100, value: S.floatOpacity, text: S.floatOpacity + ' %', tap: (v) => commit({ floatOpacity: v }) }),
          h('div', { style: { height: 16 } }),
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, kt('Image de fond', 'Background image')),
            h('div', { className: 'kbth-sec-d' }, kt('Réglages fins du fond choisi.', 'Fine adjustments for the chosen background.'))),
          slider({ label: kt('Visibilité du fond', 'Background visibility'), min: 0, max: 100, value: S.wpVis, text: S.wpVis + ' %', tap: (v) => commit({ wpVis: v }) }),
          slider({ label: kt('Flou de l’image', 'Image blur'), min: 0, max: 40, value: S.wpBlur, text: S.wpBlur + ' px', tap: (v) => commit({ wpBlur: v }) }),
          slider({ label: kt('Luminosité', 'Brightness'), min: 0, max: 200, value: S.bgBrightness, text: S.bgBrightness + ' %', tap: (v) => commit({ bgBrightness: v }) }),
          slider({ label: kt('Contraste', 'Contrast'), min: 0, max: 200, value: S.bgContrast, text: S.bgContrast + ' %', tap: (v) => commit({ bgContrast: v }) }),
          slider({ label: 'Saturation', min: 0, max: 200, value: S.bgSaturation, text: S.bgSaturation + ' %', tap: (v) => commit({ bgSaturation: v }) }),
          slider({ label: kt('Assombrissement', 'Darkening'), min: 0, max: 100, value: S.bgDarken, text: S.bgDarken + ' %', tap: (v) => commit({ bgDarken: v }) }),
          h('div', { className: 'kbth-row' },
            h('span', { className: 'kbth-lb' }, kt('Ajustement', 'Fit')),
            seg({ items: [
              { id: 'cover', label: kt('Couvrir', 'Cover'), on: S.bgFit === 'cover', tap: () => commit({ bgFit: 'cover' }) },
              { id: 'fill', label: kt('Remplir', 'Fill'), on: S.bgFit === 'fill', tap: () => commit({ bgFit: 'fill' }) },
              { id: 'center', label: kt('Centrer', 'Center'), on: S.bgFit === 'center', tap: () => commit({ bgFit: 'center' }) },
              { id: 'stretch', label: kt('Étirer', 'Stretch'), on: S.bgFit === 'stretch', tap: () => commit({ bgFit: 'stretch' }) }] })),
          toggle(kt('Miroir horizontal', 'Horizontal mirror'), S.bgMirror, () => commit({ bgMirror: !S.bgMirror })))

        // ── Onglet Couleurs ────────────────────────────────────────────────
        const sel = TOKINDEX[tokSel] || TOKMAP[0]
        const selClair = cl[sel[0]], selSombre = cd[sel[0]]
        const modifie = Object.prototype.hasOwnProperty.call(S.ov, 'light:' + sel[0]) || Object.prototype.hasOwnProperty.call(S.ov, 'dark:' + sel[0])
        const ratioSel = ['t1', 't2', 't3', 't4', 'link', 'err', 'ok', 'warn', 'biz'].indexOf(sel[0]) >= 0
        const TOK_CATS = [
          { id: 'surfaces', label: 'Surfaces', keys: ['base', 'l1', 'l2', 'l3', 'side', 'input', 'code'] },
          { id: 'texte', label: kt('Texte', 'Text'), keys: ['t1', 't2', 't3', 't4'] },
          { id: 'etats', label: kt('États', 'States'), keys: ['err', 'ok', 'warn', 'biz', 'link'] },
          { id: 'marque', label: kt('Marque', 'Brand'), keys: ['brand'] }
        ]
        const [tokCat, setTokCat] = React.useState('surfaces')
        const catKeys = (TOK_CATS.find((c) => c.id === tokCat) || TOK_CATS[0]).keys
        const advCouleurs = h('div', { className: 'kbth-sec' },
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, kt('Couleur d’accent', 'Accent color')),
            h('div', { className: 'kbth-sec-d' }, kt('Les couleurs de texte sont recalculées pour rester lisibles.', 'Text colors are recalculated to stay readable.'))),
          h('div', { className: 'kbth-row' },
            h('span', { className: 'kbth-lb' }, 'Accent'),
            h('div', { className: 'kbth-acc' },
              h('label', { className: 'kbth-sw', style: { background: accentHex }, title: kt('Pipette', 'Eyedropper') },
                h('input', { type: 'color', value: accentHex, 'aria-label': kt('Choisir la couleur d’accent', 'Pick the accent color'),
                  onInput: (e) => { setHexDraft(null); commit({ acc: e.target.value }) } })),
              h('div', { className: 'kbth-dots' },
                ACCS.map((a) => h('button', {
                  key: a, type: 'button', className: 'kbth-dot', style: { background: a },
                  'aria-pressed': S.acc !== null && S.acc.toLowerCase() === a.toLowerCase() ? 'true' : 'false',
                  title: a, 'aria-label': 'Accent ' + a,
                  onClick: () => { setHexDraft(null); commit({ acc: a }) } }))))),
          h('div', { className: 'kbth-row' },
            h('span', { className: 'kbth-lb' }, kt('Valeur exacte', 'Exact value')),
            h('div', { className: 'kbth-acc' },
              h('label', { className: 'kbth-hex' + (hexDraft !== null && !validHex(hexDraft) ? ' bad' : '') },
                h('span', null, '#'),
                h('input', { value: hexShown, maxLength: 7, spellCheck: false, 'aria-label': kt('Code hexadécimal', 'Hex code'),
                  onInput: (e) => { const v = e.target.value; setHexDraft(v); const p = HEX(v); if (p !== null) commit({ acc: toHex(p) }) } })),
              S.acc !== null ? h('button', { className: 'kbth-btn', type: 'button', onClick: () => { setHexDraft(null); commit({ acc: null }) } }, kt('Neutre DSH', 'Neutral DSH')) : null)),
          // Rampe de couleurs
          h('div', { className: 'kbth-ramp' },
            [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((step) => {
              const base = S.acc || (dark ? TK.dark.brand : TK.light.brand)
              const t = step / 1000
              const col = mix(base, dark ? '#000000' : '#ffffff', t < 0.5 ? (0.5 - t) * 1.2 : (t - 0.5) * 1.6)
              return h('div', { key: step, className: 'kbth-ramp-step' },
                h('div', { className: 'kbth-ramp-swatch', style: { background: col } }),
                h('span', { className: 'kbth-ramp-label' }, String(step)))
            })),
          h('div', { style: { height: 12 } }),
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, kt('Jetons de couleur', 'Color tokens')),
            h('div', { className: 'kbth-sec-d' }, kt('Modifie un jeton pour le mode courant : le contraste est recalculé aussitôt.', 'Edit a token for the current mode: contrast is recalculated right away.'))),
          h('div', { className: 'kbth-row' },
            seg({ items: TOK_CATS.map((c) => ({ id: c.id, label: c.label, on: tokCat === c.id, tap: () => setTokCat(c.id) })) })),
          h('div', { className: 'kbth-sec-d', style: { marginTop: 4 } }, kt('Couleurs du thème', 'Theme colors')),
          h('div', { className: 'kbth-toks' },
            catKeys.map((key) => {
              const e = TOKINDEX[key]
              if (!e) return null
              const r = ['t1', 't2', 't3', 't4', 'link', 'err', 'ok', 'warn', 'biz'].indexOf(key) >= 0
                ? ratio(c[key], c.l1) : null
              const badge = r !== null ? (r >= 7 ? 'AAA' : r >= 4.5 ? 'AA' : r >= 3 ? kt('Grand texte', 'Large text') : kt('Échec', 'Fail')) : null
              const grade = r !== null ? (r >= 4.5 ? 'ok' : (r >= 3 ? 'warn' : 'err')) : null
              return h('button', {
                key: key, type: 'button', className: 'kbth-tok' + (tokSel === key ? ' kbth-tok-sel' : ''),
                'aria-pressed': tokSel === key ? 'true' : 'false',
                onClick: () => { setTokSel(key); setHexDraft(null) } },
                h('span', { className: 'kbth-tok-chip', style: { background: dark ? cd[key] : cl[key] } }),
                h('span', { className: 'kbth-tok-name' }, e[1]),
                h('span', { className: 'kbth-tok-css' }, '--dsw-' + e[2]),
                h('span', { className: 'kbth-tok-hex' }, (dark ? cd[key] : cl[key]).toUpperCase()),
                r !== null ? h('span', { className: 'kbth-tok-ratio' }, r.toFixed(1) + ':1') : null,
                badge ? h('span', { className: 'kbth-tok-badge kbth-gr-' + grade }, badge) : null)
            })),
          // Editor of the selected token
          h('div', { className: 'kbth-adv-editor' },
            h('div', { className: 'kbth-adv-preview' },
              h('span', { className: 'kbth-adv-chip', style: { background: dark ? cd[sel[0]] : cl[sel[0]] } }),
              h('div', { className: 'kbth-adv-info' },
                h('span', { className: 'kbth-adv-label' }, sel[1]),
                h('span', { className: 'kbth-adv-css' }, '--dsw-' + sel[2]))),
            ratioSel ? h('div', { className: 'kbth-adv-ratio',
              style: { color: ratio(c[sel[0]], c.l1) >= 4.5 ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-warn-primary)' } },
              ratio(c[sel[0]], c.l1).toFixed(1) + ':1 · ' + (ratio(c[sel[0]], c.l1) >= 7 ? 'AAA' : ratio(c[sel[0]], c.l1) >= 4.5 ? 'AA' : kt('Échec', 'Fail'))) : null,
            h('div', { className: 'kbth-adv-colors' },
              ['light', 'dark'].map((m) => h('div', { key: m, className: 'kbth-adv-swatch' },
                h('label', { className: 'kbth-sw', style: { background: m === 'light' ? selClair : selSombre, width: 28, height: 28 },
                  title: (m === 'light' ? kt('Clair', 'Light') : kt('Sombre', 'Dark')) + kt(' — pipette', ' — eyedropper') },
                  h('input', { type: 'color', value: m === 'light' ? selClair : selSombre,
                    'aria-label': sel[1] + ' (' + (m === 'light' ? 'clair' : 'sombre') + ')',
                    onInput: (e) => commit({ ov: { ...S.ov, [m + ':' + sel[0]]: e.target.value } }) })),
                h('span', { className: 'kbth-adv-swatch-label' }, m === 'light' ? kt('Clair', 'Light') : kt('Sombre', 'Dark'))))),
            modifie ? h('button', { className: 'kbth-btn', type: 'button', style: { width: 'max-content' },
              onClick: () => { const ov = { ...S.ov }; delete ov['light:' + sel[0]]; delete ov['dark:' + sel[0]]; commit({ ov }) } }, kt('Rétablir', 'Reset')) : null))

        // ── Onglet Texte et forme ──────────────────────────────────────────
        const advTexte = h('div', { className: 'kbth-sec' },
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, kt('Texte', 'Text')),
            h('div', { className: 'kbth-sec-d' }, kt('La police se choisit dans Essentiel.', 'The font is chosen in Essentials.'))),
          slider({ label: kt('Taille du texte', 'Text size'), min: 12, max: 17, value: S.fs, text: S.fs + ' px', tap: (v) => commit({ fs: v }) }),
          toggle('Ligatures', S.ligatures, () => commit({ ligatures: !S.ligatures }), kt('Fusionne « fi », « -> » et autres paires dans les polices qui en ont.', 'Joins “fi”, “->” and other pairs in fonts that have them.')),
          h('div', { style: { height: 16 } }),
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, kt('Forme', 'Shape')),
            h('div', { className: 'kbth-sec-d' }, kt('Arrondi des boutons, cartes et panneaux.', 'Rounding of buttons, cards and panels.'))),
          h('div', { className: 'kbth-row' },
            h('span', { className: 'kbth-lb' }, kt('Rayons', 'Radii')),
            seg({ items: [
              { id: 'sharp', label: kt('Net', 'Sharp'), on: S.radius === 'sharp', tap: () => commit({ radius: 'sharp' }) },
              { id: 'standard', label: 'Standard', on: S.radius === 'standard', tap: () => commit({ radius: 'standard' }) },
              { id: 'soft', label: kt('Doux', 'Soft'), on: S.radius === 'soft', tap: () => commit({ radius: 'soft' }) }] })),
          h('div', { style: { height: 16 } }),
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, kt('Identité', 'Identity')),
            h('div', { className: 'kbth-sec-d' }, kt('Ce qui rappelle le harness.', 'What reminds you of the harness.'))),
          toggle(kt('Logo et nom', 'Logo and name'), S.showBrand, () => commit({ showBrand: !S.showBrand }), kt('Dans la barre latérale et sur l’écran d’accueil.', 'In the sidebar and on the home screen.')))

        // ── Accessibility tab ───────────────────────────────────────────
        const advAccessibilite = h('div', { className: 'kbth-sec' },
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, kt('Contraste', 'Contrast')),
            h('div', { className: 'kbth-sec-d' }, kt('Lisibilité des textes et des bordures.', 'Legibility of text and borders.'))),
          h('div', { className: 'kbth-row' },
            h('span', { className: 'kbth-lb' }, kt('Niveau', 'Level')),
            seg({ items: [
              { id: 'standard', label: 'Standard', on: S.contrastMode === 'standard', tap: () => commit({ contrastMode: 'standard' }) },
              { id: 'plus', label: kt('Renforcé', 'Enhanced'), on: S.contrastMode === 'plus', tap: () => commit({ contrastMode: 'plus' }) },
              { id: 'max', label: kt('Maximal', 'Maximum'), on: S.contrastMode === 'max', tap: () => commit({ contrastMode: 'max' }) }] })),
          h('div', { className: 'kbth-hint' }, kt('Rapports mesurés — AA : 4,5:1 · AAA : 7:1', 'Measured ratios — AA: 4.5:1 · AAA: 7:1')),
          h('div', { className: 'kbth-a11y-table' },
            [[kt('Texte principal', 'Primary text'), 't1'], [kt('Texte secondaire', 'Secondary text'), 't2'], [kt('Texte tertiaire', 'Tertiary text'), 't3'], [kt('Légende', 'Caption'), 't4'], [kt('Lien', 'Link'), 'link'], [kt('Bouton principal', 'Primary button'), 'brand']].map(([label, key]) => {
              const r = ratio(c[key], c.l1)
              const badge = r >= 7 ? 'AAA' : r >= 4.5 ? 'AA' : r >= 3 ? kt('Grand texte', 'Large text') : kt('Échec', 'Fail')
              const grade = r >= 4.5 ? 'ok' : (r >= 3 ? 'warn' : 'err')
              return h('div', { key: key, className: 'kbth-a11y-row' },
                h('span', { className: 'kbth-a11y-aa', style: { background: dark ? cd[key] : cl[key], color: dark ? cd.l1 : cl.l1 } }, 'Aa'),
                h('span', { className: 'kbth-a11y-label' }, label),
                h('span', { className: 'kbth-a11y-hex' }, (dark ? cd[key] : cl[key]).toUpperCase()),
                h('span', { className: 'kbth-a11y-ratio' }, r.toFixed(1) + ':1'),
                h('span', { className: 'kbth-a11y-badge kbth-gr-' + grade }, badge))
            })),
          h('div', { style: { height: 16 } }),
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, kt('Mouvement et focus', 'Motion and focus')),
            h('div', { className: 'kbth-sec-d' }, kt('Animations et navigation au clavier.', 'Animations and keyboard navigation.'))),
          toggle(kt('Réduire les animations', 'Reduce animations'), S.reduceMotion, () => commit({ reduceMotion: !S.reduceMotion }), kt('Coupe les animations et les transitions. Le réglage de ton système est déjà respecté sans cela.', 'Turns off animations and transitions. Your system setting is already respected without this.')),
          h('div', { className: 'kbth-row' },
            h('span', { className: 'kbth-lb' }, kt('Anneau de focus', 'Focus ring')),
            seg({ items: [
              { id: 'accent', label: 'Accent', on: S.focusRing === 'accent', tap: () => commit({ focusRing: 'accent' }) },
              { id: 'double', label: 'Double', on: S.focusRing === 'double', tap: () => commit({ focusRing: 'double' }) },
              { id: 'thick', label: kt('Épais', 'Thick'), on: S.focusRing === 'thick', tap: () => commit({ focusRing: 'thick' }) }] })),
          h('div', { className: 'kbth-hint' }, kt('Visible quand tu navigues au clavier : essaie Tab.', 'Visible when you navigate by keyboard: try Tab.')),
          h('div', { style: { height: 16 } }),
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, kt('Lisibilité', 'Legibility')),
            h('div', { className: 'kbth-sec-d' }, kt('Repères supplémentaires.', 'Extra aids.'))),
          toggle(kt('Cibles de 44 px', '44 px targets'), S.largeTargets, () => commit({ largeTargets: !S.largeTargets }), kt('Boutons et champs d’au moins 44 px de haut.', 'Buttons and fields at least 44 px tall.')),
          toggle(kt('Soulignement des liens', 'Link underlining'), S.underlineLinks, () => commit({ underlineLinks: !S.underlineLinks })),
          toggle(kt('Palette daltonisme', 'Color-blind palette'), S.cbSafe, () => commit({ cbSafe: !S.cbSafe }), kt('Succès en bleu, alertes en vert bleuté et erreurs en orange plutôt qu’en vert, ambre et rouge.', 'Success in blue, warnings in bluish green and errors in orange rather than green, amber and red.')))

        // ── Sharing tab: your themes, import, and the file of the current look ───────────
        const importThemeFile = (file) => {
          if (file.size > PRESET_FILE_MAX) { setLibNote({ ok: false, text: kt('Fichier trop gros : un thème fait quelques Ko. Rien n’a été modifié.', 'File too big: a theme is a few KB. Nothing was changed.') }); return }
          const reader = new FileReader()
          reader.onload = () => {
            const r = presetFromFileText(String(reader.result))
            if (r.ok !== true) { setLibNote({ ok: false, text: kt('Fichier non reconnu : seul un fichier de thème Kybernos (.json) est accepté. Rien n’a été modifié.', 'File not recognized: only a Kybernos theme file (.json) is accepted. Nothing was changed.') }); return }
            const rec = libAdd(r.name, 'file', r.settings, r.author !== undefined ? { author: r.author } : undefined)
            setLibNote(rec === null
              ? { ok: false, text: kt('La bibliothèque est pleine (' + PRESET_LIMIT + ' thèmes). Supprime-en un d’abord.', 'The library is full (' + PRESET_LIMIT + ' themes). Delete one first.') }
              : { ok: true, text: kt('« ' + rec.name + ' » est dans Mes thèmes', '“' + rec.name + '” is in My themes') + (r.legacy ? kt(' (ancien fichier : tout le réglage est repris)', ' (old file: the whole look is taken)') : '') + kt('. Il n’est pas appliqué.', '. It is not applied.') })
          }
          reader.readAsText(file)
        }
        const libRow = (rec) => {
          const cur = S.skin === rec.id
          const renaming = renameId === rec.id
          const deleting = delId === rec.id
          const showing = expId === rec.id
          const sk = presetAsSkin(rec)
          const doRename = () => {
            const name = presetName(renameDraft)
            if (name === '') { setLibNote({ ok: false, text: kt('Donne un nom au thème.', 'Give the theme a name.') }); return }
            if (libNameTaken(name, rec.id)) { setLibNote({ ok: false, text: kt('Ce nom existe déjà. Choisis-en un autre.', 'That name already exists. Pick another one.') }); return }
            libPatch(rec.id, { name }); setRenameId(null); setLibNote(null)
          }
          const acts = renaming
            ? [h('button', { key: 'ok', type: 'button', className: 'kbth-btn kbth-ldpri', 'data-kb': 'theme-rename-ok', onClick: doRename }, 'OK'),
              h('button', { key: 'no', type: 'button', className: 'kbth-btn', onClick: () => setRenameId(null) }, kt('Annuler', 'Cancel'))]
            : (deleting
              ? [h('span', { key: 'q', className: 'kbth-hint' }, kt('Supprimer « ' + rec.name + ' » ?', 'Delete “' + rec.name + '”?')),
                h('button', { key: 'y', type: 'button', className: 'kbth-btn kbth-danger kbth-gr-err', 'data-kb': 'theme-delete-yes', onClick: () => { libRemove(rec.id); setDelId(null); setLibNote({ ok: true, text: kt('« ' + rec.name + ' » supprimé.', '“' + rec.name + '” deleted.') }) } }, kt('Supprimer', 'Delete')),
                h('button', { key: 'n', type: 'button', className: 'kbth-btn', onClick: () => setDelId(null) }, kt('Garder', 'Keep'))]
              : [cur ? null : h('button', { key: 'a', type: 'button', className: 'kbth-btn', 'data-kb': 'theme-apply', onClick: () => { setLibNote(null); applyMine(rec) } }, kt('Appliquer', 'Apply')),
                h('button', { key: 'e', type: 'button', className: 'kbth-btn', 'data-kb': 'theme-export-one', 'aria-expanded': showing ? 'true' : 'false', onClick: () => setExpId(showing ? null : rec.id) }, kt('Exporter', 'Export')),
                h('button', { key: 'r', type: 'button', className: 'kbth-btn', 'data-kb': 'theme-rename', onClick: () => { setRenameId(rec.id); setRenameDraft(rec.name); setDelId(null) } }, kt('Renommer', 'Rename')),
                h('button', { key: 'd', type: 'button', className: 'kbth-btn kbth-danger kbth-gr-err', 'data-kb': 'theme-delete', onClick: () => { setDelId(rec.id); setRenameId(null) } }, kt('Supprimer', 'Delete'))])
          const file = presetFile(rec)
          return h(React.Fragment, { key: rec.id },
            h('div', { className: 'kbth-trow', 'data-kb': 'theme-row', 'data-id': rec.id },
              h('span', { className: 'kbth-skin-dot', style: { background: skinDot(sk) } }),
              h('div', { className: 'kbth-trow-tx' },
                h('div', { className: 'kbth-trow-n' },
                  renaming
                    ? h('input', { className: 'kbth-in', style: { width: 190 }, value: renameDraft, maxLength: PRESET_NAME_MAX, 'aria-label': kt('Nouveau nom', 'New name'), 'data-kb': 'theme-rename-in',
                      onInput: (e) => setRenameDraft(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); doRename() } else if (e.key === 'Escape') { e.stopPropagation(); setRenameId(null) } } })
                    : [h('span', { key: 'n' }, rec.name),
                      cur ? h('span', { key: 'c', className: 'kbth-tone kbth-tone-on kbth-gr-ok' }, kt('appliqué', 'applied')) : null,
                      h('span', { key: 's', className: 'kbth-pill' }, rec.source === 'gallery' ? kt('Galerie', 'Gallery') + (rec.author !== undefined ? ' · ' + rec.author : '') : (rec.source === 'file' ? kt('importé', 'imported') : kt('à toi', 'yours')))]),
                h('div', { className: 'kbth-trow-m' }, skinMeta(sk) + kt(' · retient : ', ' · keeps: ') + Object.keys(PRESET_GROUPS).filter((g) => groupsOf(rec.settings)[g]).map((g) => groupLabel(g).toLowerCase()).join(', '))),
              h('div', { className: 'kbth-trow-a' }, acts)),
            showing ? h('div', { className: 'kbth-exp' },
              h('div', { className: 'kbth-row', style: { justifyContent: 'space-between' } },
                h('span', { className: 'kbth-hint' }, kt('theme-' + fileSlug(rec.name) + '.json · à partager ou à versionner', 'theme-' + fileSlug(rec.name) + '.json · to share or to version')),
                h('div', { className: 'kbth-row', style: { gap: 6 } },
                  h('button', { type: 'button', className: 'kbth-btn', 'data-kb': 'theme-copy-one', onClick: () => { try { navigator.clipboard.writeText(file) } catch (e) { /* clipboard unavailable */ } } }, kt('Copier', 'Copy')),
                  h('button', { type: 'button', className: 'kbth-btn', 'data-kb': 'theme-download-one', onClick: () => { if (!downloadText('theme-' + fileSlug(rec.name) + '.json', file)) setLibNote({ ok: false, text: kt('Le téléchargement a échoué : utilise Copier.', 'The download failed: use Copy.') }) } }, kt('Télécharger', 'Download')))),
              h('pre', { className: 'kbth-export-code', 'data-kb': 'theme-file' }, file)) : null)
        }

        const exportFormats = [['yaml', 'YAML'], ['json', 'JSON'], ['css', 'CSS']]
        const exportBody = exportTexte(exportFmt, S)
        const advPartage = h('div', { className: 'kbth-sec', style: { gap: 22 } },
          h('div', { className: 'kbth-sec' },
            h('div', { className: 'kbth-sec-h' },
              h('div', { className: 'kbth-sec-t' }, kt('Mes thèmes', 'My themes')),
              h('div', { className: 'kbth-sec-d' }, kt('Les thèmes que tu as enregistrés ou importés.', 'The themes you saved or imported.'))),
            libNote !== null ? h('div', { className: libNote.ok ? 'kbth-ok kbth-gr-ok' : 'kbth-bad kbth-gr-err', role: 'status', 'data-kb': 'theme-note' }, libNote.text) : null,
            lib.presets.length > 0
              ? h('div', { className: 'kbth-lib', 'data-kb': 'theme-lib' }, lib.presets.map(libRow))
              : h('div', { className: 'kbth-state', 'data-kb': 'theme-lib-empty' },
                h('div', { className: 'kbth-sec-t' }, kt('Aucun thème à toi', 'No theme of your own')),
                h('div', { className: 'kbth-sec-d' }, kt('Règle l’apparence dans Essentiel puis enregistre-la, ou importe un fichier ci-dessous.', 'Set the look in Essentials, then save it, or import a file below.'))),
            h('div', { className: 'kbth-row' },
              h('button', { type: 'button', className: 'kbth-btn kbth-ldpri', 'data-kb': 'theme-save-sharing', onClick: openSave }, kt('Enregistrer l’état actuel…', 'Save the current look…')),
              lib.hostState === 'off' && ldHostOn() ? h('span', { className: 'kbth-hint' }, kt('Le disque de DSH ne répond pas : tes thèmes restent dans ce navigateur.', 'DSH’s disk does not answer: your themes stay in this browser.')) : null)),
          h('div', { className: 'kbth-sec' },
            h('div', { className: 'kbth-sec-h' },
              h('div', { className: 'kbth-sec-t' }, kt('Importer', 'Import')),
              h('div', { className: 'kbth-sec-d' }, kt('Un fichier de thème (.json) s’ajoute à Mes thèmes. Il ne change rien tant que tu ne cliques pas sur Appliquer. Un ancien fichier d’état complet devient lui aussi un thème.', 'A theme file (.json) is added to My themes. It changes nothing until you click Apply. An old file of the whole look becomes a theme too.'))),
            h('div', { className: 'kbth-row' },
              h('label', { className: 'kbth-btn', style: { cursor: 'pointer' } }, kt('Choisir un fichier .json', 'Choose a .json file'),
                h('input', { type: 'file', accept: '.json,application/json', 'data-kb': 'theme-import', style: { display: 'none' }, onChange: (e) => {
                  const input = e.target
                  const file = input.files && input.files[0]
                  if (!file) return
                  importThemeFile(file)
                  input.value = ''
                } })))),
          h('details', { className: 'kbth-fold', 'data-kb': 'theme-export-fold' },
            h('summary', null, kt('Exporter l’état actuel', 'Export the current look')),
            h('div', { className: 'kbth-sec', style: { marginTop: 10 } },
              h('div', { className: 'kbth-sec-d' }, kt('Le réglage en cours, tel quel : un fichier à partager ou à versionner. Pour un thème enregistré, utilise « Exporter » sur sa ligne.', 'The current setting as it is: a file to share or to version. For a saved theme, use “Export” on its row.')),
              h('div', { className: 'kbth-row' },
                h('span', { className: 'kbth-lb' }, 'Format'),
                seg({ items: exportFormats.map((f) => ({ id: f[0], label: f[1], on: exportFmt === f[0], tap: () => setExportFmt(f[0]) })) }),
                h('button', { className: 'kbth-btn', type: 'button', 'data-kb': 'theme-copy', onClick: () => {
                  try { navigator.clipboard.writeText(exportBody) } catch (e) { /* clipboard unavailable */ }
                } }, kt('Copier', 'Copy'))),
              h('div', { className: 'kbth-export-preview' },
                h('div', { className: 'kbth-export-bar' },
                  h('span', null, 'dsh-theme.' + (exportFmt === 'yaml' ? 'yml' : exportFmt)),
                  h('span', { 'data-kb': 'theme-export-lines' }, ((n) => n + (n === 1 ? kt(' ligne', ' line') : kt(' lignes', ' lines')))(exportBody.split('\n').length))),
                h('pre', { className: 'kbth-export-code', 'data-kb': 'theme-export' }, exportBody)))),
          h('div', { className: 'kbth-sec' },
            h('div', { className: 'kbth-sec-h' },
              h('div', { className: 'kbth-sec-t' }, kt('Réinitialiser', 'Reset')),
              h('div', { className: 'kbth-sec-d' }, kt('Revenir aux valeurs par défaut du harness. Tes thèmes enregistrés restent dans Mes thèmes.', 'Back to the harness defaults. Your saved themes stay in My themes.'))),
            h('div', { className: 'kbth-row' },
              h('span', { className: 'kbth-lb' }, kt('Tous les réglages de thème', 'All theme settings')),
              h('button', { className: 'kbth-btn', type: 'button', onClick: () => { setHexDraft(null); commit({ ...DEF }, true) } }, kt('Réinitialiser', 'Reset')))))

        // ── Gallery tab ───────────────────────────────────────────────────────────────────
        const lang = kbLang()
        const startTrial = (t) => {
          setLibNote(null)
          if (trialRef.current === null) { const t0 = { id: t.id, name: t.name, prev: { ...S } }; trialRef.current = t0; setTrial(t0) } else { const t1 = { ...trialRef.current, id: t.id, name: t.name }; trialRef.current = t1; setTrial(t1) }
          setHexDraft(null)
          commit({ skin: 'try-' + t.id, ...t.settings }, false, true)
        }
        const endTrial = () => { const t = trialRef.current; if (t === null) return; setHexDraft(null); commit(t.prev, true) }
        const installTheme = (t) => {
          const rec = galInstall(t)
          if (rec === null) { setLibNote({ ok: false, text: kt('La bibliothèque est pleine (' + PRESET_LIMIT + ' thèmes). Supprime-en un dans Partage.', 'The library is full (' + PRESET_LIMIT + ' themes). Delete one in Sharing.') }); return }
          setHexDraft(null)
          commit({ skin: rec.id, ...rec.settings })
          setLibNote({ ok: true, text: kt('« ' + rec.name + ' » est installé et appliqué. Il est dans Mes thèmes.', '“' + rec.name + '” is installed and applied. It is in My themes.') })
        }
        const updateTheme = (t, rec) => {
          galUpdate(t, rec)
          if (S.skin === rec.id) commit({ ...t.settings })
          setLibNote({ ok: true, text: kt('« ' + rec.name + ' » est à jour (version ' + t.v + ').', '“' + rec.name + '” is up to date (version ' + t.v + ').') })
        }
        const trialBar = trial === null ? null : h('div', { className: 'kbth-trial', role: 'status', 'data-kb': 'theme-trial' },
          h('span', null, kt('Essai de ', 'Trial of '), h('b', null, trial.name), kt('. Rien n’est enregistré.', '. Nothing is saved.')),
          h('span', { className: 'kbth-trial-sp' }),
          h('button', { type: 'button', className: 'kbth-btn kbth-ldpri', 'data-kb': 'theme-trial-install', onClick: () => { const t = gal.data === null ? null : gal.data.themes.find((x) => x.id === trial.id); if (t) installTheme(t) } }, kt('Installer', 'Install')),
          h('button', { type: 'button', className: 'kbth-btn', 'data-kb': 'theme-trial-end', onClick: endTrial }, kt('Revenir à mon thème', 'Back to my theme')))

        const galThumb = (t) => {
          const m = (t.settings.mode === 'light' || t.settings.mode === 'dark') ? t.settings.mode : (dark ? 'dark' : 'light')
          const g = makeTheme(m, { acc: t.settings.acc === undefined ? null : t.settings.acc, ov: t.settings.ov || {}, lvl: 0, cb: false, tint: 0, dom: '' })
          const r = Math.round(5 * (RADIUS_ECHELLE[t.settings.radius] === undefined ? 1 : RADIUS_ECHELLE[t.settings.radius]))
          return h('div', { className: 'kbth-thumb', 'aria-hidden': 'true', style: { background: g.base, borderColor: g.b2 } },
            h('div', { className: 'kbth-thumb-s', style: { background: g.side } },
              h('i', { style: { width: '70%', background: g.t3 } }), h('i', { style: { width: '55%', background: g.t4 } }), h('i', { style: { width: '62%', background: g.t4 } })),
            h('div', { className: 'kbth-thumb-c' },
              h('i', { style: { width: '48%', height: 7, background: g.t1 } }), h('i', { style: { width: '78%', background: g.t3 } }),
              h('div', { className: 'kbth-thumb-in', style: { background: g.input, borderColor: g.b2, borderRadius: r } }),
              h('div', { className: 'kbth-thumb-bt', style: { background: g.fill, borderRadius: r } })))
        }
        const galCard = (t) => {
          const inst = galInstalled(t.id)
          const trying = trial !== null && trial.id === t.id
          const sk = galAsSkin(t)
          const newer = inst !== null && (inst.v === undefined ? 1 : inst.v) < t.v
          const foot = inst !== null
            ? [h('span', { key: 'i', className: 'kbth-tone kbth-tone-on kbth-gr-ok' }, kt('Installé', 'Installed')),
              newer ? h('button', { key: 'u', type: 'button', className: 'kbth-btn kbth-ldpri', 'data-kb': 'theme-gal-update', onClick: () => updateTheme(t, inst) }, kt('Mettre à jour', 'Update'))
                : (S.skin === inst.id ? null : h('button', { key: 'a', type: 'button', className: 'kbth-btn', 'data-kb': 'theme-gal-apply', onClick: () => { setLibNote(null); setHexDraft(null); applyMine(inst) } }, kt('Appliquer', 'Apply')))]
            : [h('button', { key: 'i', type: 'button', className: 'kbth-btn kbth-ldpri', 'data-kb': 'theme-gal-install', onClick: () => installTheme(t) }, kt('Installer', 'Install')),
              h('button', { key: 't', type: 'button', className: 'kbth-btn', 'data-kb': 'theme-gal-try', disabled: trying, onClick: () => startTrial(t) }, trying ? kt('En essai', 'Trying') : kt('Essayer', 'Try'))]
          return h('article', { key: t.id, className: 'kbth-card', 'data-kb': 'theme-gal-card', 'data-id': t.id, 'aria-label': t.name },
            galThumb(t),
            h('div', { className: 'kbth-card-b' },
              h('div', { className: 'kbth-card-n' }, t.name),
              // “by” and the name are two text nodes: a live translation of the first leaves the author's name alone
              t.author !== '' ? h('div', { className: 'kbth-card-a' }, kt('par ', 'by '), t.author) : null,
              (t.description[lang] || t.description.fr || t.description.en) !== '' ? h('div', { className: 'kbth-card-d' }, t.description[lang] || t.description.fr || t.description.en) : null,
              h('div', { className: 'kbth-card-m' }, skinMeta(sk)),
              // A theme that carries an icon set shows it: the nine entries at rest, then in colour (the picker's preview).
              ICON_SET_IDS.indexOf(t.settings.iconSet) > 0
                ? h('div', { className: 'kbth-card-i', 'data-kb': 'theme-gal-icons', 'data-id': t.settings.iconSet }, iconeApercu(t.settings.iconSet, false), iconeApercu(t.settings.iconSet, true)) : null,
              h('div', { className: 'kbth-card-f' }, foot)))
        }
        const galBody = () => {
          if (gal.state === 'idle' || gal.state === 'loading') {
            return h('div', { className: 'kbth-gal', 'aria-hidden': 'true', 'data-kb': 'theme-gal-loading' }, [0, 1, 2, 3, 4, 5].map((i) => h('div', { key: i, className: 'kbth-sk' })))
          }
          if (gal.state === 'error' || gal.data === null) {
            return h('div', { className: 'kbth-state', role: 'alert', 'data-kb': 'theme-gal-error' },
              h('div', { className: 'kbth-sec-t' }, kt('Impossible de lire la galerie', 'Cannot read the gallery')),
              h('div', { className: 'kbth-sec-d' }, kt('Elle est lue par DSH, pas par la page. Si le plugin vient d’être mis à jour, redémarre DSH. Tes thèmes restent disponibles dans Partage.', 'It is read by DSH, not by the page. If the plugin was just updated, restart DSH. Your themes remain available in Sharing.')),
              h('button', { type: 'button', className: 'kbth-btn kbth-ldpri', 'data-kb': 'theme-gal-retry', onClick: () => { galLoad() } }, kt('Réessayer', 'Try again')))
          }
          const q = galQ.trim().toLowerCase()
          const list = gal.data.themes.filter((t) => (galF === 'all' || t.settings.mode === galF) && (q === '' || (t.name + ' ' + t.author + ' ' + (t.description[lang] || t.description.fr)).toLowerCase().indexOf(q) >= 0))
          const o = gal.data.online
          const onlineText = galOnlineText(o)
          return h(React.Fragment, null,
            h('div', { className: 'kbth-src', 'data-kb': 'theme-gal-source' },
              gal.data.source === 'signed' ? h('span', { className: 'kbth-tone kbth-tone-on kbth-gr-ok' }, kt('Catalogue signé', 'Signed catalog')) : h('span', { className: 'kbth-pill' }, kt('Livré avec Kybernos', 'Shipped with Kybernos')),
              h('span', null, gal.data.themes.length + (gal.data.themes.length > 1 ? kt(' thèmes', ' themes') : kt(' thème', ' theme'))),
              o.state !== 'off' && !(o.state === 'refused' && o.reason === 'no-key')
                ? h('button', { type: 'button', className: 'kbth-link', 'data-kb': 'theme-gal-refresh', disabled: gal.refreshing, onClick: () => { galRefresh() } }, gal.refreshing ? kt('Actualisation…', 'Refreshing…') : kt('Actualiser', 'Refresh')) : null),
            onlineText !== '' ? h('div', { className: 'kbth-hint', 'data-kb': 'theme-gal-online' }, onlineText) : null,
            h('div', { className: 'kbth-gbar' },
              h('input', { className: 'kbth-search', type: 'search', value: galQ, placeholder: kt('Rechercher un thème, un auteur', 'Search for a theme or an author'), 'aria-label': kt('Rechercher un thème', 'Search for a theme'), 'data-kb': 'theme-gal-q', onInput: (e) => setGalQ(e.target.value) }),
              seg({ items: [['all', kt('Tous', 'All')], ['light', kt('Clair', 'Light')], ['dark', kt('Sombre', 'Dark')]].map((f) => ({ id: f[0], label: f[1], on: galF === f[0], tap: () => setGalF(f[0]) })) })),
            list.length === 0
              ? h('div', { className: 'kbth-state', 'data-kb': 'theme-gal-none' },
                h('div', { className: 'kbth-sec-t' }, gal.data.themes.length === 0 ? kt('La galerie est vide', 'The gallery is empty') : kt('Aucun thème ne correspond', 'No theme matches')),
                h('div', { className: 'kbth-sec-d' }, gal.data.themes.length === 0 ? kt('Aucun thème n’est publié pour l’instant.', 'No theme is published yet.') : kt('Essaie un autre mot, ou affiche tous les modes.', 'Try another word, or show all modes.')),
                gal.data.themes.length === 0 ? null : h('button', { type: 'button', className: 'kbth-btn', onClick: () => { setGalQ(''); setGalF('all') } }, kt('Effacer la recherche', 'Clear the search')))
              : h('div', { className: 'kbth-gal', 'data-kb': 'theme-gal' }, list.map(galCard)))
        }
        const advGalerie = h('div', { className: 'kbth-sec', style: { gap: 14 } },
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, kt('Galerie de thèmes', 'Theme gallery')),
            h('div', { className: 'kbth-sec-d' }, kt('Un thème n’est qu’un fichier de réglages : il ne contient aucun code et ne charge rien d’extérieur. Installe-le, ou essaie-le d’abord.', 'A theme is only a settings file: it contains no code and loads nothing from outside. Install it, or try it first.'))),
          libNote !== null ? h('div', { className: libNote.ok ? 'kbth-ok kbth-gr-ok' : 'kbth-bad kbth-gr-err', role: 'status', 'data-kb': 'theme-note' }, libNote.text) : null,
          galBody())

        // ── Advanced assembly with sub-tabs ────────────────────────────
        const ADV_CONTENT = {
          essentiel: advEssentiel,
          animation: h(AnimationPane, { ctx: ctxRef }),
          icones,
          verre: advVerre,
          couleurs: advCouleurs,
          texte: advTexte,
          accessibilite: advAccessibilite,
          partage: advPartage,
          galerie: advGalerie
        }
        const groupToggle = (g, hint) => ldToggle(groupLabel(g), saveDlg.groups[g] === true, () => setSaveDlg({ ...saveDlg, groups: { ...saveDlg.groups, [g]: !saveDlg.groups[g] } }), hint)
        const saveModal = saveDlg === null ? null : h(ThemeModal, { labelId: 'kbth-save-t', kb: 'theme-save-dlg', onClose: () => setSaveDlg(null) },
          h('div', { className: 'kbth-mhd' },
            h('h3', { id: 'kbth-save-t' }, kt('Enregistrer comme thème', 'Save as a theme')),
            h('button', { type: 'button', className: 'kbth-mx', 'aria-label': kt('Fermer', 'Close'), onClick: () => setSaveDlg(null) }, '×')),
          h('div', { className: 'kbth-mbody' },
            h('div', { className: 'kbth-sec', style: { gap: 6 } },
              h('label', { className: 'kbth-lb', htmlFor: 'kbth-save-name', style: { width: 'auto' } }, kt('Nom', 'Name')),
              h('input', {
                id: 'kbth-save-name', className: 'kbth-in' + (saveDlg.error !== '' ? ' bad' : ''), value: saveDlg.name, maxLength: PRESET_NAME_MAX, autoComplete: 'off', 'data-kb': 'theme-save-name',
                'aria-invalid': saveDlg.error !== '' ? 'true' : 'false',
                onInput: (e) => setSaveDlg({ ...saveDlg, name: e.target.value, error: '' }),
                onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); doSave() } } }),
              saveDlg.error !== '' ? h('div', { className: 'kbth-bad kbth-gr-err', role: 'alert', 'data-kb': 'theme-save-error' }, saveDlg.error) : null),
            h('div', { className: 'kbth-sec', style: { gap: 4 } },
              h('div', { className: 'kbth-sec-t' }, kt('Ce que le thème retient', 'What the theme keeps')),
              h('div', { className: 'kbth-hint' }, kt('Les couleurs et l’accent sont toujours retenus.', 'Colors and accent are always kept.')),
              groupToggle('font'), groupToggle('radius'), groupToggle('icons'), groupToggle('chat'), groupToggle('glass'),
              groupToggle('a11y', kt('Contraste, palette daltonien, cibles larges : ce sont tes besoins, pas un style. Décoché, un thème ne les change jamais.', 'Contrast, color-blind palette, large targets: these are your needs, not a style. Switched off, a theme never changes them.')))),
          h('div', { className: 'kbth-mft' },
            h('button', { type: 'button', className: 'kbth-btn', onClick: () => setSaveDlg(null) }, kt('Annuler', 'Cancel')),
            h('button', { type: 'button', className: 'kbth-btn kbth-ldpri', 'data-kb': 'theme-save-ok', onClick: doSave }, kt('Enregistrer', 'Save'))))

        // A single page: the nine tabs are always there, “Essentials” opens by default.
        const reglages = h('div', { className: 'kbth-sec' },
          // Tabs stacked VERTICALLY on the left, content on the right.
          h('div', { className: 'kbth-adv-cols' },
            h('div', { className: 'kbth-adv-tabs' },
              ADV_TABS.map((t) => h('button', {
                key: t.id, type: 'button', className: 'kbth-adv-tab' + (advTab === t.id ? ' on' : ''),
                'aria-pressed': advTab === t.id ? 'true' : 'false',
                onClick: () => setAdvTab(t.id) }, t.label))),
            h('div', { className: 'kbth-adv-pane' },
              trialBar,
              ADV_CONTENT[advTab] || advCouleurs)))

        // ── The simple view: the studio, guarded (see StBoundary) ─────────────────
        const studioProps = {
          S, c, dark, commit: (patch, replace, transient) => { setHexDraft(null); commit(patch, replace, transient) },
          applySkin: (sk) => { setLibNote(null); setHexDraft(null); commit(skinPatch(sk)) }, applyMine, skinMeta,
          openClassic: (tab) => { setClassicOpen(true); setAdvTab(tab) }, importFile: importThemeFile, libNote, setLibNote,
          canUndo: () => histRef.current.length > 0, pushHist: () => pushHist(S),
          undo: () => {
            const snap = histRef.current.pop()
            if (snap === undefined) return
            histAt.current = 0 // the next change is a new step, however soon it comes
            try { const p = JSON.parse(snap); setHexDraft(null); commit(p.s, true, false, true); ldSet({ ...p.l }) } catch (e) { /* a damaged step is dropped */ }
          },
          reset: () => { setHexDraft(null); commit({ ...DEF }, true) }
        }
        const studioEl = StBoundary !== null ? h(StBoundary, { onFail: () => setClassicOpen(true) }, h(Studio, studioProps)) : h(Studio, studioProps)

        // ── assembly — a single column (the side preview has been removed) ────────
        return h(React.Fragment, null,
          saveModal,
          h('div', { className: 'kbth-page' },
            // Colonne principale
            h('div', { className: 'kbth-main' },
              h('div', { className: 'kbth-head' },
                h('div', { className: 'kbhp-row', style: { '--kbhp-gap': '6px' } }, (typeof window !== 'undefined' && window.__KB_HELP__ && window.__KB_HELP__.Help ? h(window.__KB_HELP__.Help, { id: 'kybernos-theme' }) : null)),
                h('div', { className: 'kbth-title' }, kt('Thème', 'Theme')),
                h('div', { className: 'kbth-sub' },
                  kt('Personnalise l’apparence de Kybernos : clique sur ce que tu veux changer dans la fenêtre ci-dessous. Tous les réglages restent dans l’éditeur avancé.', 'Customize the look of Kybernos: click what you want to change in the window below. Every setting stays in the advanced editor.'))),
              conflictNote,
              studioEl,
              h('details', { className: 'kbth-st-classic', 'data-kb': 'theme-classic', open: classicOpen, onToggle: (e) => { const open = e.currentTarget.open; setClassicOpen((was) => (was === open ? was : open)) } },
                h('summary', null, kt('Éditeur avancé', 'Advanced editor'), h('span', { className: 'kbth-hint' }, kt(' · toutes les options, les jetons, la galerie, le partage', ' · every option, the tokens, the gallery, sharing'))),
                reglages),
              h('div', { className: 'kbth-foot' },
                h('span', { className: 'kbth-pill' }, estNaturel(S) ? kt('Couleurs de DSH — aucun thème posé', 'DSH colours — no theme applied') : kt('Thème posé · clair et sombre', 'Theme applied · light and dark')),
                h('span', { className: 'kbth-pill' }, (jetonsRetouches(S.ov) === 1 ? kt('1 couleur retouchée', '1 colour adjusted') : kt(jetonsRetouches(S.ov) + ' couleurs retouchées', jetonsRetouches(S.ov) + ' colours adjusted'))),
                h('button', { className: 'kbth-btn', type: 'button',
                  onClick: () => { setHexDraft(null); commit({ ...DEF }, true) } }, kt('Tout rétablir', 'Reset all')),
                h('button', { className: 'kbth-btn', type: 'button',
                  onClick: () => setRevision((r) => r + 1) }, kt('Actualiser le mode', 'Refresh the mode'))))))
      }

      // ══════════════════════════════════════════════════════════════════════
      // 6. MONTAGE.
      // ══════════════════════════════════════════════════════════════════════

      // The export contract of a cordis entry: the list of services the
      // context MUST expose — the ctx guard refuses any ctx.<service> not
      // declared here (same contract as kybernos and dream-skin). Without it,
      // the entry stays “loading” and never activates.
      return {
        inject: ['slots', 'theme', 'remote', 'locale'],
        // Read-only handles for test-client.mjs (same convention as kybernos-language).
        __test: {
          makeTheme, ratio, HEX, toHex, mix, SKINS, WPS, WPCATS, FONTS, ACCS, TOKMAP, DEF, STORE_KEY,
          skinPatch, skinAccent, legacyAdopt, readState, writeState, estNaturel, accentsPropres, surprendre, sanitiserImport, schemeSombre, effetsCss, exportTexte, filtreFond, ajustementFond, avecAlpha, valeursValides, appliquerEffets, ENUMS, RANGES, BOOLS, RADIUS_DEF, jetonsRetouches, tailleNative, appliquerTaille,
          LD_PRESETS, LD_PACKS, LD_DEF, LD_SIZES, LD_KEY, ld, ldClean, ldRead, ldSet, ldHash, ldChoose, ldChooseWord, ldWordList, ldById, ldPackById, ldNode, ldDestroy, ldCleanSvg, ldImport,
          knum, ldKo, ldDurText, ldDecorate, ldStart, ldStop, ldApplyText, ldPull, ldAddRecord, ldDelRecord, ldPutWords, ldCacheRead, AnimationPane, LdSummary, LdView,
          appliquerBoot, appliquerTout, appliquerJetons, appliquerFond, appliquerPolice, Page, bootSnapshot, posterBoot, retirerFeuilleBoot, jetonsDe, BOOT_ID,
          PRESET_FORMAT, PRESET_GROUPS, PRESET_KEYS, PRESET_LIMIT, PRESET_ID, LIB_KEY, lib, libClean, libRead, libWrite, libSet, libAdd, libPatch, libRemove, libPull, libFreeName, libNameTaken,
          gal, galTheme, galClean, galLoad, galRefresh, galInstalled, galInstall, galUpdate, galOnlineText, kbLang,
          presetSettings, presetRecord, presetFromState, presetFile, presetFromFileText, settingsDirty, skinSettings, presetAsSkin, groupsOf, fileSlug, ThemeModal,
          ICON_ENTRIES, ICON_HUES, ICON_SETS, ICON_SET_IDS, iconInner, iconSvg, iconRegistry, appliquerIcones,
          optsDe, bulleDe, encreSur, BUBBLE_CHOICES, HEX_KEYS, Studio, StBoundary, ST_VIBES, ST_FONTS, ST_SIZES, ST_SPEEDS, ST_INKS, ST_ZONES, ST_RAND, stVibePatch, stLookKeys, stSurprise, stDshBubble,
        },
        apply(ctx) {
          // (01/10) Label according to the current language state. The language is
          // NO LONGER carried by this bundle since 01/10: it lives in
          // @local/kybernos-language, which sets `__KB_I18N_ACTIVE__` as soon as it
          // activates. This plugin only READS the global — can be switched off without
          // breaking the theme: without language, the label falls back to French.
          const kbthLabel = (fr, en) => {
            try {
              const a = (typeof window !== 'undefined') ? window.__KB_I18N_ACTIVE__ : null
              const loc = (a !== null && a !== undefined && a.lang !== null && a.lang !== undefined) ? String(a.lang).toLowerCase() : ''
              return loc.indexOf('en') === 0 ? en : fr
            } catch (e) { return fr }
          }
          // (29/09) The “Appearance” block of General ▸ (DSH) is hidden: the
          // Appearance section of the Theme page sets the SAME preference through
          // themeSvc.setTheme — two places for one setting is one
          // too many. The shell classes are hashed: we spot the block by
          // its text (“Appearance” title + Light/Dark/System buttons) and we
          // mark it data-kbth-own (the CSS rule above hides it).
          try {
            const marquer = () => {
              document.querySelectorAll('[role="dialog"] div').forEach((d) => {
                if (d.getAttribute('data-kbth-own') !== null) return
                const t = d.textContent || ''
                if (/^Appearance/.test(t.trim()) === true && t.indexOf('Light') >= 0 && t.indexOf('Dark') >= 0 && t.indexOf('System') >= 0 && t.length < 60) {
                  d.setAttribute('data-kbth-own', 'appearance')
                }
              })
            }
            marquer()
            const obs = new MutationObserver(() => { marquer() })
            obs.observe(document.body, { childList: true, subtree: true })
          } catch (e) { /* hors navigateur */ }
          // The persisted state applies AS SOON AS ACTIVATED: when the page is
          // reloaded, the theme comes back before the user opens the settings
          // (v1 anti-flash — server-side injection will come in v2).
          try {
            if (ctx !== null && ctx !== undefined && ctx.theme !== null && ctx.theme !== undefined) {
              const S = readState()
              appliquerBoot(ctx.theme, S)
              // Adoption: the explicit native preference (light/dark) is the
              // user's last choice — whatever control was
              // used, the sidebar-footer button included. We copy it into
              // our store so that the Settings page displays it.
              const nat = prefNative(ctx.theme)
              const natPx = tailleNative(ctx.theme)
              const adopt = {}
              if (nat !== null && nat !== 'system' && nat !== S.mode) adopt.mode = nat
              if (natPx !== null && natPx !== S.fs) adopt.fs = natPx
              if (Object.keys(adopt).length > 0) writeState({ ...S, ...adopt })
              // And we follow native changes afterwards: without this
              // subscription, a mode chosen outside the Kybernos Settings page
              // was never remembered (the reload bug, cf. appliquerBoot).
              // `theme/change` is emitted on the root context (cordis contexts
              // share the `_hooks` registry — `noShadow`): listening
              // from our context receives it, and it is also the path by
              // which the durable preference arrives ~1.5 s after activation
              // (measured: `preference` is “system” at t0, “dark” at t1500).
              // The service does NOT expose a `subscribe`: the sidebar-footer
              // subscription (`tSvc.subscribe`) is a silent no-op.
              ctx.effect(() => {
                try {
                  const off = ctx.on('theme/change', (snap) => {
                    const p = prefNative(ctx.theme, snap)
                    const px = tailleNative(ctx.theme, snap)
                    const cur = readState()
                    const adopt = {}
                    if (p !== null && p !== 'system' && cur.mode !== p) adopt.mode = p
                    if (px !== null && cur.fs !== px) adopt.fs = px
                    if (Object.keys(adopt).length > 0) writeState({ ...cur, ...adopt })
                  })
                  return () => { try { if (typeof off === 'function') off() } catch (e) { /* already detached */ } }
                } catch (e) { return undefined }
              }, 'kybernos-theme: remembers the native mode')
            }
          } catch (e) {
            // An error swallowed here reads as “the plugin does not work”:
            // we log it to stay diagnosable.
            try { console.error('[kybernos-theme] initial apply failed', e) } catch (e2) { /* console indisponible */ }
          }

          // “My themes”: the disk copy, once the page is up. Never a reason for DSH not to start.
          try { setTimeout(() => { libPull(true) }, 900) } catch (e) { /* no timers */ }

          // The bottom-status animation: defensive end to end (a failure here does not touch DSH).
          try {
            if (ctx !== null && ctx !== undefined && typeof ctx.effect === 'function') ctx.effect(() => ldStart(ctx), 'kybernos-theme: thinking animation')
          } catch (e) {
            try { console.error('[kybernos-theme] thinking animation: cannot start', e) } catch (e2) { /* console indisponible */ }
          }

          if (ctx !== null && ctx !== undefined && ctx.slots !== null && ctx.slots !== undefined) {
            ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register(
              { name: 'settings.section', id: 'kybernos-theme', order: 1, label: kbthLabel('Thème', 'Theme') },
              (props) => h(Page, { ...props, ctx }))), 'kybernos-theme: theme settings section')

            ctx.effect(() => styles.insert(css), 'kybernos-theme: styles')
          }
        }
      }
    } catch (kbThemeBootError) {
      try {
        console.error('[kybernos-theme] cannot load — plugin disabled, GUI preserved', kbThemeBootError)
      } catch (e2) { /* console indisponible */ }
      return { apply() { /* plugin disabled after a load error */ } }
    }
  },
})
