// kybernos-theme — browser half.
//
// Wiring of the “Simple” mockup onto the real DSH APIs:
//
//   mode (System/Light/Dark) ....... ctx.theme.setTheme()      — native preference
//   18 ready-made themes + accent .. ctx.theme.overrideTokens() — 17 tokens {light,dark}
//   wallpaper (32 backgrounds) ..... fixed <div> under the app — dream-skin pattern
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
      /** The page's description lives in the « ? » card (the Suite's Help takes it as `lead`); only without the Suite is it drawn under the title. */
      const subFallback = (text) => { try { return typeof window !== 'undefined' && window.__KB_HELP__ && window.__KB_HELP__.Help ? null : h('div', { className: 'kbth-sub' }, text) } catch (e) { return h('div', { className: 'kbth-sub' }, text) } }
      /** The page's head: its title and its « ? » through the Suite's Title (one style for every page title, the button right after the text); the bare title where the Suite is not there. */
      const pageHead = (props) => { try { if (window.__KB_HELP__ && window.__KB_HELP__.Title) return h(window.__KB_HELP__.Title, props) } catch (e) { /* the bare title below */ } return h(props.as || 'h2', { className: 'kbhp-title' + (props.className ? ' ' + props.className : '') }, props.title, props.after) }
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

      // Codex-inspired default palette: pure white canvas + whisper-grey sidebar in light mode,
      // calm neutral graphite in dark mode, high-contrast ink and soft blue accent.
      const EPURE_OV = {
        'light:base': '#ffffff', 'light:l1': '#ffffff', 'light:l2': '#f7f7f8', 'light:l3': '#ffffff',
        'light:side': '#f7f7f8', 'light:input': '#ffffff', 'light:code': '#f7f7f8',
        'light:t1': '#1a1c1f', 'light:t2': '#5f6570', 'light:brand': '#2563eb',
        'dark:base': '#161618', 'dark:l1': '#161618', 'dark:l2': '#1f1f23', 'dark:l3': '#28282d',
        'dark:side': '#1c1c1f', 'dark:input': '#202024', 'dark:code': '#1c1c1f',
        'dark:t1': '#f3f4f6', 'dark:t2': '#a5aab4', 'dark:brand': '#60a5fa'
      }

      const SKINS = [
        { id: 'epure', mode: null, acc: null, wp: 'none', vis: 60, fontText: 'system-ui', radius: 'soft', shadow: 'soft', bubbleUser: 'auto', ov: { ...EPURE_OV } },
        { id: 'dsh', mode: 'dark', acc: null, wp: 'none', vis: 60, fontText: 'dsh', radius: 'standard', shadow: 'none', bubbleUser: 'auto' },
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
        epure: ['Épuré (Codex)', 'Pure (Codex)'],
        dsh: ['Défaut Kybernos', 'Kybernos default'],
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
        dsh: ['Kybernos (défaut)', 'Kybernos (default)'],
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
        if (sk.shadow !== undefined) patch.shadow = sk.shadow
        if (sk.bubbleUser !== undefined) patch.bubbleUser = sk.bubbleUser
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
      const ICON_ENTRIES = ['cloud', 'kyber', 'dash', 'teams', 'creations', 'auto', 'skills', 'plug']
      const ICON_HUES = { cloud: '#14b8a6', kyber: '#8b5cf6', dash: '#3b82f6', teams: '#6366f1', creations: '#ec4899', auto: '#f97316', skills: '#10b981', plug: '#06b6d4' }
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

      // ── The five sober sets: solid silhouettes, a mass (p) and a detail (s) ──
      const ICON_FILL = {
        cloud: { p: iRect(2.5, 4, 19, 13, 3.2), s: iRect(7.5, 19, 9, 2.4, 1.2) },
        kyber: { p: iDot(6, 6.5, 3.4) + iDot(18, 7, 3.4) + iDot(12, 18, 3.4), s: iPath('M6 6.5 18 7 12 18z') },
        dash: { p: iRect(3, 3, 8, 10, 2.2) + iRect(13, 11, 8, 10, 2.2), s: iRect(13, 3, 8, 6, 2.2) + iRect(3, 15, 8, 6, 2.2) },
        teams: { p: iDot(9, 8, 3.6) + iPath('M2 20a7 7 0 0 1 14 0z'), s: iDot(17.5, 9, 2.8) + iPath('M15 20a5.5 5.5 0 0 1 8.5-4.6V20z') },
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
        // Touch comfort: on a small screen (480 px or less) bigger rows and icons, full-width menus, section tabs as a list (see TOUCH_RULES)
        touch: false,
        // How the pages of Settings are laid out on a small screen (600 px or less; see PRES_RULES). Every default is today's look, so a screen that does not ask for more is unchanged:
        // `tabsNav` tabs as a bar (`tabs`) or as a menu of rows, then one page per entry (`list`); `rowsLayout` the control under the text (`stacked`) or opposite the label (`inline`);
        // `rowsDescription` shown under the label (`below`) or behind an « i » (`info`, only the descriptions a page marks `data-kb-desc="fold"`); `helpButton` the « ? » in a square (`boxed`)
        // or the sign alone (`bare`) or the sign with its word, « Help » (`named`: the owner's item 27, the mockup's page bar); `cardsFrame` cards with their frame (`boxed`) or on the page (`flat`); `chipsStyle` outlined pills (`pill`) or plain text (`plain`); `groupTitles` the group names
        // of the Settings menu shown (`shown`) or hidden, a space taking their place (`hidden`).
        tabsNav: 'tabs', rowsLayout: 'stacked', rowsDescription: 'below', helpButton: 'boxed', cardsFrame: 'boxed', chipsStyle: 'pill', groupTitles: 'shown',
        // The menu, the chat and the search on a small screen (600 px or less; see PRES_RULES), same rule: every default is today's look. `drawerSize` the drawer's search, rows, workspaces and
        // dock, and the button that opens it, at the usual size (`standard`) or made for a thumb (`large`); `drawerPanels` the engine's own rows of the drawer (its pinned pages, such as « Code review ») shown
        // as they are (`shown`) or left out so that only Kybernos's rows are drawn (`hidden`); `composerSize` the message box's buttons and its text (`standard` | `large`); `newChatCards` what an empty chat
        // offers to make, on a phone: ONE slider of the illustrated cards with « See all » (`slider`, the default: the owner's mock-up of 2026-11-24), all of them in a grid on the page (`grid`), or none (`hidden`).
        // The search is touch comfort (TOUCH_RULES), not a setting of its own.
        drawerSize: 'standard', drawerPanels: 'shown', composerSize: 'standard', newChatCards: 'slider',
        // `rating`: how an answer is rated on a phone (the row under it, list item 31): two thumbs (`thumbs`, the default since 2026-11-24: the owner's rule, in Simple AND Complete; up = a 5 sent at once, with the
        // share box shown under it, down = a 1 that opens the sheet) or the five stars (`stars`, a choice). Wider than 600 px: stars, whatever this says.
        rating: 'thumbs',
        // `messageSize`: the size of the text of the messages on a phone (list item 33), four sizes two pixels apart: `compact` 15 px (what the engine drew), `standard` 17 px (the default, Simple and Complete alike: the
        // owner's mock-up; the phone's stylesheet draws it, no token), `large` 19 px and `xlarge` 21 px; the code in a block follows (12, 13.5, 14, 14 px) and scrolls sideways. These are the sizes that SHOW. Wider than 600 px: the engine's own size.
        messageSize: 'standard',
        // Chat: the colour of your messages and its text, the frame of the agent's replies and their text
        bubbleUser: 'auto', textUser: null, replyBg: 'none', replyColor: null, textReply: null,
        // The tone of the sidebar, shadows, glow
        sideTone: 'auto', shadow: 'none', glow: false,
        // The pills under the message box: shown unless switched off here
        wgSessions: true, wgChanges: true, wgUsage: true,
        // Bars on hover: the collapsed rail and the chat's top bar leave the layout and come back at the edge (on by default, owner's call 2026-10-22; switch off in the Sidebar panel)
        autoHideBars: true,
        // Notification counters: the number in brackets in the tab title and the badge on the app icon (drawn by kybernos-pulse, which reads `data-kbth-counters` on <html>). Hidden unless switched on here
        // (owner's call, 2026-11-24); personal like the pills: never in a theme, a vibe or the dice. Banners and the floating window are not part of it.
        notifCounters: 'hidden'
      }
      const ENUMS = { glassEffect: ['frosted', 'liquid'], bgFit: ['cover', 'fill', 'center', 'stretch'], radius: ['sharp', 'standard', 'soft'], focusRing: ['accent', 'double', 'thick'], iconSet: ICON_SET_IDS, sideTone: ['auto', 'darker', 'lighter', 'tinted'], shadow: ['none', 'soft'], replyBg: ['none', 'card', 'outline', 'tint'],
        tabsNav: ['tabs', 'list'], rowsLayout: ['stacked', 'inline'], rowsDescription: ['below', 'info'], helpButton: ['boxed', 'bare', 'named'], cardsFrame: ['boxed', 'flat'], chipsStyle: ['pill', 'plain'], groupTitles: ['shown', 'hidden'],
        drawerSize: ['standard', 'large'], drawerPanels: ['shown', 'hidden'], composerSize: ['standard', 'large'], newChatCards: ['slider', 'grid', 'hidden'], rating: ['stars', 'thumbs'], messageSize: ['compact', 'standard', 'large', 'xlarge'], notifCounters: ['shown', 'hidden'] }
      /** Your bubble: one of DSH's own / the accent / a soft tone / a dark one, or any colour (a hex). The three text colours are a hex or null (= the colour of the app). */
      const BUBBLE_CHOICES = ['auto', 'accent', 'soft', 'dark']
      const HEX_KEYS = ['textUser', 'replyColor', 'textReply']
      const RANGES = { glassBlur: [0, 40], sidebarOpacity: [0, 100], fieldOpacity: [0, 100], floatOpacity: [0, 100], bgBrightness: [0, 200], bgContrast: [0, 200], bgSaturation: [0, 200], bgDarken: [0, 100] }
      const BOOLS = ['cbSafe', 'sidebarLinked', 'bgMirror', 'ligatures', 'showBrand', 'reduceMotion', 'largeTargets', 'underlineLinks', 'touch', 'glow', 'wgSessions', 'wgChanges', 'wgUsage', 'autoHideBars']
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
      // next load paint a theme nobody kept (see posterBoot). Returns whether the page kept it: the seam answers `{ ok:false }`
      // on a full quota rather than pretending the look was applied.
      const writeState = (s) => {
        let kept = true
        try { localStorage.setItem(STORE_KEY, JSON.stringify(s)) } catch (e) { kept = false }
        if (kept !== true) return false
        try { posterBoot(s) } catch (e) { /* the host is not told: one more flash on the next load */ }
        return true
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

      /**
       * TOUCH COMFORT: one layer for every menu surface of a small screen, driven by ONE setting (`touch`, an accessibility setting of the person's own, or the `touch` option of a locked preset:
       * the phone's Simple turns it on). It is a static stylesheet keyed on `html[data-kb-touch="on"]` and a 480 px media query, so switching it is an attribute flip, and it only uses the
       * STABLE hooks of the app: ARIA roles, `data-slot`, `data-kb*` and the Kybernos plugins' own classes (never a hashed class, but the engine's `_danger_` marker, matched as a substring).
       * Groups, in order: sheets (every menu and popover spans the screen's width, every dialog but Settings sits at the bottom edge, edge to edge: the engine anchors them to their button with `justify-self`, which is what left the workspace menu 168 px wide
       * and the view options on the right half), rows (46 px rows of 13 px text become 54 px rows of 16 px text with 22 px icons), the account sheet's Appearance switch, the drawer's rows and icons,
       * Settings (the list, then every page at 1.14 times its size), the search palette (a full-width sheet that hangs from the TOP edge: the keyboard opens at once and leaves 513 px of 813, a bottom sheet would sit under it; no keyboard hints, the scopes on one scrolling line, bigger rows), and section tabs as a list.
       */
      const TOUCH_ATTR = 'data-kb-touch'
      /** The size of every Settings page in the touch layer: 1.14 times. Whatever hangs inside it in pixels measured on the screen (a popover card: 358 px wide, placed from its button's rectangle) is scaled with it, so it is brought back to 1. */
      const TOUCH_ZOOM = 1.14
      const TOUCH_MEDIA = '(max-width: 480px)'
      /** The section tabs of a page that read as a list on a small screen: Kaby, the Theme editor, Language. (Segmented filters such as Yours / Discover keep their line.) */
      const TOUCH_TABS = ['.kbkc-tabs', '.kbln-tabs', '.kbth-adv-tabs']
      const SETTINGS = '[data-shortcut-modal="settings"]'
      /** Every dialog but Settings (a page), the search palette (its own rules) and the help card of a page (`[data-kb="help-panel"]`): a sheet at the bottom edge, in the engine's flex overlay that centres it.
       *  The help card is no overlay: it hangs from its « ? » button inside a wrapper as wide as the button, so « width:100% » made it a 44 px strip (owner's phone, 2026-11-23). It keeps its own width and place. */
      const DIALOG = '[role="dialog"]:not([data-shortcut-modal]):not(.kbsr-dlg):not([data-kb="help-panel"])'
      /** [selectors, declarations] pairs; each selector is prefixed by the attribute, each declaration made `!important` (the engine's and the mobile bundle's rules are). */
      const TOUCH_RULES = [
        [['[role="menu"]', '[role="listbox"]', '[data-trigger-menu]'], 'justify-self:stretch'],
        [['[role="menu"]'], 'border-radius:22px 22px 0 0'],
        [['[role="menu"] [role^="menuitem"]', '[role="listbox"] [role="option"]'], 'min-height:54px;padding-inline:14px;gap:14px;font-size:16px'],
        [['[role="menu"] [role^="menuitem"] svg'], 'width:22px;height:22px;flex:none'],
        [['[role="menu"] [class*="_danger_"]'], 'margin-top:8px'],
        [['[data-kb="menu-appearance"]'], 'min-height:58px;font-size:16px'],
        [['[data-kb="menu-appearance"] > svg'], 'width:22px;height:22px'],
        [['[data-kb="menu-appearance"] .kbfp-mlab'], 'font-size:16px'],
        [['[data-kb="menu-appearance"] .kbfp-seg'], 'height:46px;padding:3px;gap:4px;border-radius:23px;background:var(--dsw-alias-bg-layer-3,rgba(128,128,128,.16))'],
        [['[data-kb="menu-appearance"] .kbfp-seg button.on'], 'background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 1px 4px rgba(0,0,0,.25)'],
        [['[data-kb="menu-appearance"] .kbfp-seg button'], 'width:54px;height:40px;border-radius:20px'],
        [['[data-kb="menu-appearance"] .kbfp-seg svg'], 'width:24px;height:24px'],
        [['[data-kb-row]'], 'min-height:58px;font-size:18px'],
        [['[data-kb-row] svg'], 'width:26px;height:26px'],
        [['[data-slot="sidebar"] [data-row-key]'], 'min-height:56px;font-size:16px'],
        [['[data-slot="sidebar"] [data-row-key] button'], 'min-width:44px;min-height:44px'],
        [['[data-slot="sidebar"] [data-row-key] svg'], 'width:22px;height:22px'],
        [[SETTINGS + ' [class*="navList"] [data-kb-t]'], 'min-height:62px;font-size:18px'],
        [[SETTINGS + ' [class*="navList"] [data-kb-t] svg'], 'width:26px;height:26px'],
        // « Back to workspace » (the Settings header, `.kbsb`): 14 px text and a 15 px arrow in a 22 px line were the smallest thing on a screen of 18 px rows (owner's phone, 2026-11-23). It reads like a row's title
        // (18 px, the arrow at 24 px) and its tap zone is 48 px high with room on each side.
        [[SETTINGS + ' .kbsb'], 'min-height:48px;max-width:100%;gap:10px;padding:0 14px 0 0;font-size:18px;font-weight:600;line-height:24px'],
        [[SETTINGS + ' .kbsb svg'], 'width:24px;height:24px;flex:none'],
        [[SETTINGS + ' .kbsb-label'], 'min-width:0;overflow:hidden;text-overflow:ellipsis'],
        [[SETTINGS + ' [data-slot="settings.section"]'], 'zoom:' + TOUCH_ZOOM],
        [[SETTINGS + ' [data-slot="settings.section"] [data-kb="help-panel"]'], 'zoom:' + (Math.round(1e4 / TOUCH_ZOOM) / 1e4)],
        [[SETTINGS + ' [data-slot="settings.section"] :is(button:not([role="switch"]):not([data-kb="help-button"]):not(.kbln-help-btn),select,textarea,input:not([type="checkbox"]):not([type="radio"]):not([type="range"]))'], 'min-height:48px'],
        // The Theme's own controls the line above does not reach: « Import… » is a <label> (it holds the file input: 29 px high on the owner's phone), and the « ⋯ » of a preset tile is a 26 px button the line above made 48 px
        // from the top of the NAME row, so its sign landed in the middle of the chips under the name. Its tap zone is 44 px now, centred on the name row; the name leaves room for it.
        [[SETTINGS + ' [data-slot="settings.section"] label.kbth-btn'], 'min-height:48px;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box'],
        [[SETTINGS + ' [data-slot="settings.section"] button.kbth-pr-more[data-kb="theme-preset-more"][aria-haspopup="menu"]:not([disabled])'], 'top:54px;right:2px;width:44px;height:44px;min-width:44px;min-height:44px;padding:0'],
        [[SETTINGS + ' [data-slot="settings.section"] .kbth-pr-nm'], 'padding-inline-end:34px'],
        // « Report an answer » in the help card of the app’s parts in About (Simple): the phone layer makes the report button a 44 px flag (`html[data-kb-msg-actions="tap"]`, one class heavier than the card's own rule), so its words
        // wrapped three lines in a 44 px box and ran out of the card. In this card the button is a plain button again: as wide as its words, 48 px high, never wider than the card.
        [[SETTINGS + ' .kbk-help [data-kb="report-tail"] > button[data-act="report-open"]'], 'width:auto;max-width:100%;height:auto;min-height:48px;padding:8px 16px;overflow:visible;white-space:normal;text-indent:0;box-sizing:border-box'],
        [[DIALOG], 'align-self:flex-end;width:100%;max-width:none;margin:0;border-radius:22px 22px 0 0'],
        [[':has(> ' + DIALOG + ')'], 'padding:0'],
        [['.kbsr-scrim'], 'align-items:flex-start;padding:0'],
        [['.kbsr-dlg'], 'width:100%;max-width:none;max-height:58dvh;border-radius:0 0 22px 22px;border-top-width:0'],
        [['.kbsr-top .kbsr-kbd', '.kbsr-hh'], 'display:none'],
        [['.kbsr-foot > span:has(> .kbsr-kbd)'], 'display:none'],
        // the search on a phone: the field 52 px high at 18 px, a ✕ of 52 px where a computer has the « Esc » key, the scopes on ONE line that scrolls (44 px chips at 16 px, the right edge fading to say there is more)
        [['.kbsr-top'], 'min-height:64px;padding:6px 6px 6px 16px;gap:12px'],
        // the field: 18 px (the phone layer's `input:not(…)` rule makes every field 16 px with a heavier selector, so this one names the tag and the hook too)
        [['input.kbsr-in[data-kb="search-input"]'], 'height:52px;font-size:18px'],
        [['.kbsr-x'], 'display:flex;align-items:center;justify-content:center;flex:none;width:52px;height:52px;padding:0;border:0;border-radius:26px;background:transparent;color:inherit;cursor:pointer'],
        [['.kbsr-x svg'], 'width:24px;height:24px'],
        [['.kbsr-scopes'], 'flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;padding:12px 14px;-webkit-mask-image:linear-gradient(90deg,#000 88%,transparent);mask-image:linear-gradient(90deg,#000 88%,transparent)'],
        [['.kbsr-chip'], 'flex:none;height:44px;padding:0 14px 0 12px;font-size:16px'],
        [['.kbsr-it'], 'padding:12px 10px'],
        [TOUCH_TABS, 'display:flex;flex-direction:column;align-items:stretch;gap:6px;overflow:visible;position:static;width:100%;padding:0;border:0;border-radius:0;background:transparent'],
        [TOUCH_TABS.map((x) => x + ' > *'), 'justify-content:flex-start;text-align:start;width:100%;min-height:52px;padding:0 16px;font-size:16px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));border-radius:12px;box-shadow:none;background:transparent'],
        [TOUCH_TABS.map((x) => x + ' > [aria-selected="true"]'), 'background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.12));border-color:var(--dsw-alias-brand-primary,currentColor);font-weight:600'],
        [TOUCH_TABS.map((x) => x + ' > *::after'), 'display:none']
      ]
      /** The touch comfort stylesheet: static, inert until `<html>` carries the attribute. */
      const touchCss = () => '@media ' + TOUCH_MEDIA + '{\n' + TOUCH_RULES.map((r) => r[0].map((x) => 'html[' + TOUCH_ATTR + '="on"] ' + x).join(',') + '{' + r[1].split(';').map((d) => d + '!important').join(';') + '}').join('\n') + '\n}'

      // kb-pres:begin  (the ONE place of this bundle that names the class prefixes of other bundles; the guards of the prefixes read the bundle without what lies between this line and `kb-pres:end`)
      /**
       * PRESENTATION: how the pages of Settings (seven settings: `tabsNav`, `rowsLayout`, `rowsDescription`, `helpButton`, `cardsFrame`, `chipsStyle`, `groupTitles`) and the drawer and the empty chat (four more:
       * `drawerSize`, `drawerPanels`, `composerSize`, `newChatCards`) are laid out on a small screen, how an answer is rated (`rating`: stars or thumbs) and the size of the text of the messages (`messageSize`: 15, 17, 19 or 21 px). Thirteen settings in all (sixteen tokens: `newChatCards` has two non-default values, `messageSize` three), ONE attribute on <html> that
       * lists the ones that are on (`data-kb-pres="tabs-list rows-inline …"`, one token each), ONE static stylesheet, inert without the token and under 600 px only (a wider screen is exactly as before).
       * A person's own setting wins; otherwise the phone's Simple preset asks for them all (`options.presentation`, while the app is in Kaby mode). The content of a page never changes: same labels, same
       * texts, same order; only the way a row, a card, a chip, the « ? » and the tabs are drawn.
       * It names the balisage of each page (Memory `.kbmem-*`, Language `.kbln-*`, Kaby `.kbkc-*`, the hub's « ? » `.kbhp-*`) in ONE place and takes over the phone layer's rules (`kybernos-mobile/mobile.css`, `!important`
       * too) by specificity: `:is(html, #kb-pres)` matches <html> and counts as an id, which the structural selectors of the phone layer (rule 7c) do not reach.
       * Two things need a hand of the DOM, both added next to what the page drew, never inside React's own nodes' state, and put back if a render removes them (`presWalk`): the « i » that opens a description
       * a page marked `data-kb-desc="fold"` (a description that warns, or changes what the setting means, is never marked: nothing folds without the mark), and the menu / page navigation of the Kaby tabs.
       */
      const PRES_ATTR = 'data-kb-pres'
      const PRES_MEDIA = '(max-width: 700px), (max-height: 500px) and (pointer: coarse)'
      /** [setting, the value that turns it on, the token it puts on <html>] */
      const PRES_TOKENS = [['tabsNav', 'list', 'tabs-list'], ['rowsLayout', 'inline', 'rows-inline'], ['rowsDescription', 'info', 'desc-info'], ['helpButton', 'bare', 'help-bare'], ['helpButton', 'named', 'help-named'], ['cardsFrame', 'flat', 'frame-flat'], ['chipsStyle', 'plain', 'chips-plain'], ['groupTitles', 'hidden', 'groups-hidden'], ['drawerSize', 'large', 'drawer-large'], ['drawerPanels', 'hidden', 'panels-hidden'], ['composerSize', 'large', 'composer-large'], ['newChatCards', 'grid', 'nccards-grid'], ['newChatCards', 'hidden', 'nccards-hidden'], ['rating', 'thumbs', 'rating-thumbs'], ['messageSize', 'compact', 'msg-compact'], ['messageSize', 'large', 'msg-large'], ['messageSize', 'xlarge', 'msg-xlarge']]
      const presSel = (token) => ':is(html,#kb-pres)[' + PRES_ATTR + '~="' + token + '"]'
      const PRES_PAGE = '[data-shortcut-modal="settings"]'
      const PRES_HELP_BTN = ['.kbhp-btn', '.kb6-helpbtn', '.kbln-help-btn', '.kbat-help', '.kbcl-hl']
      const PRES_HELP_Q = ['.kbhp-q', '.kb6-helpq', '.kbln-help-q', '.kbat-helpq', '.kbcl-hq']
      /** A Memory row whose control is a switch or one small button sits opposite its label; a segmented choice or a pair of buttons is wider than that and stays under the text. */
      const PRES_MEM_INLINE = PRES_PAGE + ' .kbmem-srow:not(:has(> .ctl [role="radiogroup"], > .ctl .kbmem-seg, > .ctl .kbmem-acts))'
      const PRES_SIDEBAR = '[data-slot="sidebar"]'
      const PRES_WS = '[data-slot="sidebar.workspaces"]'
      const PRES_CARD = '[data-composer-card]'
      const PRES_FLOW = '[data-slot="conversation.chat.flow"]'
      const PRES_KABY = '.kbkc-page'
      const PRES_TAB = PRES_KABY + ' > .kbkc-tabs > .kbkc-tab'
      /** [token, selectors (each one under the token), declarations (each made `!important`)] */
      const PRES_RULES = [
        // tabsNav = list: the Kaby page is a menu (one row per section), then the section alone with a back row at the top (`.kbth-navback`, put by `presWalk`; the title says the section)
        ['tabs-list', [PRES_KABY + '[data-kb-nav="menu"] > .kbkc-panel', PRES_KABY + '[data-kb-nav="page"] > .kbkc-tabs'], 'display:none'],
        ['tabs-list', [PRES_KABY + ' > .kbkc-tabs'], 'display:flex;flex-direction:column;gap:0;margin:0 -8px;padding:0;border:0;overflow:visible;position:static;width:auto;border-radius:0;background:transparent'],
        ['tabs-list', [PRES_TAB], 'display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;height:auto;min-height:62px;margin:0;padding:0 8px;border:0;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.25));border-radius:0;background:transparent;box-shadow:none;color:var(--dsw-alias-label-primary,inherit);font-size:18px;font-weight:500;text-align:start;white-space:normal'],
        ['tabs-list', [PRES_TAB + ':last-child'], 'border-bottom:0'],
        ['tabs-list', [PRES_TAB + '[aria-selected="true"]'], 'background:transparent;font-weight:500;border-color:var(--dsw-alias-border-l1,rgba(128,128,128,.25))'],
        ['tabs-list', [PRES_TAB + ':last-child[aria-selected="true"]'], 'border-bottom-color:transparent'],
        ['tabs-list', [PRES_TAB + '::after'], 'content:"";display:block;flex:none;width:9px;height:9px;margin-inline-end:4px;border:solid currentColor;border-width:2px 2px 0 0;transform:rotate(45deg);opacity:.45'],
        ['tabs-list', ['[dir="rtl"] ' + PRES_TAB + '::after'], 'transform:rotate(-135deg)'],
        ['tabs-list', [PRES_KABY + '[data-kb-nav="page"] > .kbth-navback'], 'display:flex;align-self:flex-start;align-items:center;gap:4px;order:-2;position:relative;z-index:1;min-height:44px;margin:0 0 -26px;padding:0 12px 0 0;border:0;background:transparent;color:color-mix(in srgb,var(--dsw-alias-label-primary,currentColor) 72%,transparent);font:inherit;font-size:15px;font-weight:500;text-align:start;cursor:pointer'],
        ['tabs-list', [PRES_KABY + '[data-kb-nav="page"] > .kbth-navback::before'], 'content:"";display:block;flex:none;width:8px;height:8px;margin-inline:8px 2px;border:solid currentColor;border-width:0 0 1.5px 1.5px;transform:rotate(45deg)'],
        ['tabs-list', ['[dir="rtl"] ' + PRES_KABY + '[data-kb-nav="page"] > .kbth-navback::before'], 'transform:rotate(-135deg)'],
        ['tabs-list', [PRES_KABY + '[data-kb-nav="page"] [data-kb-section]'], 'font-size:0;line-height:0'],
        ['tabs-list', [PRES_KABY + '[data-kb-nav="page"] [data-kb-section]::before'], 'content:attr(data-kb-section);font-size:18px;line-height:1.3'],
        // rowsLayout = inline: the label and its text on the left, the switch or the small button opposite (a segmented choice or two buttons stay under the text)
        ['rows-inline', [PRES_MEM_INLINE], 'flex-wrap:nowrap;align-items:center;gap:14px;padding:10px 0;min-height:56px'],
        ['rows-inline', [PRES_MEM_INLINE + ' > div:first-child'], 'flex:1 1 0;min-width:0'],
        ['rows-inline', [PRES_MEM_INLINE + ' > .ctl'], 'width:auto;flex:none'],
        ['rows-inline', [PRES_PAGE + ' .kbln-set-row:has(> label.kbln-sw)'], 'flex-direction:row;flex-wrap:nowrap;align-items:center;gap:14px;min-height:56px'],
        ['rows-inline', [PRES_PAGE + ' .kbln-set-row:has(> label.kbln-sw) > .kbln-set-txt'], 'flex:1 1 0;min-width:0'],
        ['rows-inline', [PRES_PAGE + ' .kbkc-mrow'], 'align-items:flex-start;gap:6px 14px;padding-inline:0'],
        ['rows-inline', [PRES_PAGE + ' .kbkc-mrow > .kbkc-mtext'], 'flex:1 1 0;min-width:0'],
        // the Kaby page puts its switch first in the DOM: it goes opposite the label like everywhere else, the limit line stays under the text
        // a note that carries its own button (Memory's « Not connected »): the icon, then the text over the whole width, the button under the text — not a column of two words beside a half-width button
        ['rows-inline', [PRES_PAGE + ' .kbmem-note:has(> svg):has(> button)'], 'display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px 12px;align-items:start'],
        ['rows-inline', [PRES_PAGE + ' .kbmem-note:has(> svg):has(> button) > button'], 'grid-column:2;justify-self:start'],
        ['rows-inline', [PRES_PAGE + ' .kbkc-mrow > .kbkc-sw'], 'order:2'],
        ['rows-inline', [PRES_PAGE + ' .kbkc-mrow > .kbkc-row'], 'order:3;flex:0 0 100%;box-sizing:border-box'],
        // cardsFrame = flat: the page is the frame already: a card loses its border, its radius and its padding; the next card is told from it by one line (a notice and the dashed « always asked » box keep theirs)
        ['frame-flat', [PRES_PAGE + ' .kbkc-card', PRES_PAGE + ' .kbkc-lines', PRES_PAGE + ' .kbkc-prov', PRES_PAGE + ' .kbln-langs', PRES_PAGE + ' .kbln-set', PRES_PAGE + ' .kbmz-auto', PRES_PAGE + ' .kbth-pr-strip'], 'border:0;border-radius:0;background:transparent;box-shadow:none'],
        ['frame-flat', [PRES_PAGE + ' .kbkc-card', PRES_PAGE + ' .kbkc-prov'], 'padding:6px 0 10px'],
        ['frame-flat', [PRES_PAGE + ' .kbkc-panel > .kbkc-card + .kbkc-card'], 'border-top:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.25));padding-top:22px'],
        ['frame-flat', [PRES_PAGE + ' .kbln-lang'], 'padding-inline:4px'],
        // without its frame a block keeps no side padding: its text lines up with the page margin like the titles above it
        ['frame-flat', [PRES_PAGE + ' .kbth-pr-strip', PRES_PAGE + ' .kbln-set-row', PRES_PAGE + ' .kbmz-auto'], 'padding-inline:0'],
        // chipsStyle = plain: a status is a word (« Ready » in the success colour), not an outlined pill
        ['chips-plain', [PRES_PAGE + ' .kbkc-chip', PRES_PAGE + ' .kbmem-chip', PRES_PAGE + ' .kbth-pr-src.built', PRES_PAGE + ' .kbth-pr-chip', PRES_PAGE + ' .kbln-state', PRES_PAGE + ' .kbln-pill'], 'border:0;border-radius:0;background:transparent;padding:0;min-height:24px;height:auto'],
        ['chips-plain', [PRES_PAGE + ' .kbkc-chip.ok', PRES_PAGE + ' .kbmem-chip.ok'], 'color:var(--dsw-alias-state-success-primary,#1b7f43);font-weight:600'],
        // rowsDescription = info: a description a page marked foldable is hidden until the « i » at the end of its label is pressed
        ['desc-info', ['[data-kb-desc="fold"]:not([data-kb-open="1"])'], 'display:none'],
        ['desc-info', ['.kbth-info'], 'display:inline-grid;place-items:center;flex:none;width:44px;height:44px;margin:-14px -6px -14px 2px;padding:0;border:0;border-radius:12px;background:transparent;color:var(--dsw-alias-label-secondary,inherit);vertical-align:middle;cursor:pointer'],
        ['desc-info', ['.kbth-info[aria-expanded="true"]'], 'color:var(--dsw-alias-label-primary,inherit)'],
        // a Memory label is a wrapping flex line: the « i » stays at the end of the text instead of dropping under it
        ['desc-info', [PRES_PAGE + ' .kbmem-srow .lab:has(> .kbth-info)'], 'flex-wrap:nowrap'],
        ['desc-info', [PRES_PAGE + ' .kbln-set-lb:has(> .kbth-info)'], 'display:flex;flex-wrap:nowrap;align-items:center;gap:8px'],
        ['desc-info', ['.kbth-info:focus-visible'], 'outline:2px solid var(--dsw-alias-brand-primary,currentColor);outline-offset:-2px'],
        // helpButton = bare: the « ? » alone, its 44 px tap zone stays (the phone layer makes it a square of the card's tone)
        ['help-bare', PRES_HELP_BTN, 'background:transparent;background-color:transparent;border-color:transparent;box-shadow:none'],
        ['help-bare', PRES_HELP_Q, 'width:auto;height:auto;border-radius:0;background:transparent;font-size:22px;font-weight:600;line-height:1;color:color-mix(in srgb,var(--dsw-alias-label-primary,currentColor) 80%,transparent)'],
        ['help-bare', PRES_HELP_BTN.map((x) => x + ':focus-visible'), 'outline:2px solid var(--dsw-alias-brand-primary,currentColor);outline-offset:-2px;border-radius:12px'],
        // helpButton = named: the « ? » AND its word in one pill, as the page bar of the mockup draws it. The word is no text of the page: `presWalk` stamps `data-kb-help-word` (« Help » / « Aide », in the language at that
        // moment) on each help button and the rule reads it. The pill keeps the phone layer's tone (no outline) and its 44 px; the accessible name stays the button's own (« How it works »)
        ['help-named', PRES_HELP_BTN, 'padding:0 16px 0 8px;gap:8px;border-radius:22px;font-size:16px;color:var(--dsw-alias-label-primary,inherit)'],
        ['help-named', PRES_HELP_BTN.map((x) => x + '::after'), 'content:attr(data-kb-help-word)'],
        ['help-named', PRES_HELP_BTN.map((x) => x + ':focus-visible'), 'outline:2px solid var(--dsw-alias-brand-primary,currentColor);outline-offset:-2px'],
        // groupTitles = hidden: the group names of the Settings menu (`[data-kb-fold-toggle]`, drawn by the core plugin, small labels that do nothing on a phone) leave the screen and the focus order
        // (`visibility:hidden`); the header keeps a gap (16 px, no height) so the groups do not run into one another: a group is told from the next by space alone (a line between nearly every row,
        // each group often being one page, read as a list of boxes, and drew one above the first row)
        ['groups-hidden', [PRES_PAGE + ' [data-kb-settings] [data-kb-fold-toggle]'], 'visibility:hidden;height:0;min-height:0;margin:16px 0 0;padding:0;overflow:hidden;border:0;font-size:0;line-height:0;background:none'],
        // drawerSize = large: the drawer of the phone app (search, rows, workspaces, Recents, dock) and the button that opens it, sized for a thumb (targets 52 px, text 19 to 22 px). The phone layer
        // (`kybernos-mobile/mobile.css`, menu C2) places the drawer and the touch comfort sizes it at 56 to 58 px; this goes over both. The dock's own height is a variable the scroll area clears.
        ['drawer-large', [PRES_SIDEBAR], '--kbmob-dock-h:120px'],
        ['drawer-large', [PRES_SIDEBAR + ' [data-window-drag]'], 'min-height:68px'],
        ['drawer-large', [PRES_SIDEBAR + ' [data-kb="search-top"]'], 'width:52px;height:52px;min-width:52px;min-height:52px;border-radius:26px;background:color-mix(in srgb,currentColor 9%,transparent)'],
        ['drawer-large', [PRES_SIDEBAR + ' [data-kb="search-top"] svg'], 'width:28px;height:28px'],
        ['drawer-large', [PRES_SIDEBAR + ' nav [data-kb-row]'], 'min-height:60px;gap:16px;font-size:22px'],
        ['drawer-large', [PRES_SIDEBAR + ' nav [data-kb-row] .kb4-lab'], 'font-size:22px'],
        ['drawer-large', [PRES_SIDEBAR + ' nav [data-kb-row] svg'], 'width:28px;height:28px'],
        // the engine's pinned panels (a pinned page such as « Code review ») read like the rows above them
        ['drawer-large', [PRES_SIDEBAR + ' nav [class*="panelRow"]'], 'min-height:60px;gap:16px;font-size:22px'],
        ['drawer-large', [PRES_SIDEBAR + ' nav [class*="panelRow"] svg'], 'width:28px;height:28px'],
        ['drawer-large', [PRES_WS + ' [data-sidebar-workspace-header]'], 'min-height:48px;padding:10px 4px 0 16px;font-size:19px;font-weight:600'],
        // the title may use the line (the engine gives it 45 % of the header, « Espaces de travail » was cut at 19 px)
        ['drawer-large', [PRES_WS + ' [data-sidebar-workspace-header] > span'], 'font-size:19px;font-weight:600;max-width:none'],
        // the header's three buttons (options, import, add) do nothing on the phone (the phone layer makes them untouchable and invisible): they only fill the line
        ['drawer-large', [PRES_WS + ' [data-sidebar-workspace-header] button'], 'display:none'],
        ['drawer-large', [PRES_WS + ' [data-row-key^="workspace:"]'], 'min-height:64px;font-size:22px'],
        ['drawer-large', [PRES_WS + ' [data-row-key^="session:"]'], 'min-height:60px;font-size:22px'],
        ['drawer-large', [PRES_WS + ' [data-row-key^="workspace:"] span', PRES_WS + ' [data-row-key^="session:"] span'], 'font-size:22px'],
        ['drawer-large', [PRES_WS + ' [data-row-key^="workspace:"] svg'], 'width:28px;height:28px'],
        ['drawer-large', [PRES_WS + ' [data-row-key^="workspace:"] button'], 'min-width:52px;min-height:52px'],
        ['drawer-large', [PRES_WS + ' [role="tree"]::after'], 'font-size:17px;font-weight:600;padding:14px 16px 6px'],
        // « Pinned » (the plugin's folding header, a button) is drawn like « Recents » just above (owner's list 25): the same 17 px / 600 and the same padding; mobile.css gives it the 44 px tap height
        ['drawer-large', [PRES_WS + ' .kbpin_header'], 'font-size:17px;font-weight:600;padding:14px 16px 6px'],
        // and the pinned ROWS are Recents rows (owner, 2026-11-24): the title, the folder label and the rename field at the chats' 22 px, the row at their 60 px, the « … » and the chevron at the sizes the rows of the
        // drawer use. The room kept at the end of a title follows the bigger « … ».
        ['drawer-large', [PRES_WS + ' .kbpin_row .kbpin_open'], 'height:60px;line-height:60px;font-size:22px;padding-inline-end:56px'],
        ['drawer-large', [PRES_WS + ' .kbpin_folder'], 'height:60px;font-size:22px;padding:0 16px'],
        ['drawer-large', [PRES_WS + ' .kbpin_row .kbpin_edit'], 'height:52px;font-size:22px'],
        ['drawer-large', [PRES_WS + ' .kbpin_row .kbpin_more'], 'width:52px;height:52px'],
        ['drawer-large', [PRES_WS + ' .kbpin_row .kbpin_more svg'], 'width:24px;height:24px'],
        ['drawer-large', [PRES_WS + ' .kbpin_header .kbpin_chevron svg'], 'width:20px;height:20px'],
        ['drawer-large', ['.kbmob-avatar'], 'width:56px;height:56px;font-size:22px'],
        ['drawer-large', ['.kbmob-newchat'], 'height:56px;border-radius:28px;gap:12px;font-size:21px'],
        ['drawer-large', ['.kbmob-newchat svg'], 'width:26px;height:26px'],
        ['drawer-large', ['.kbmob-menu'], 'width:52px;height:52px;border-radius:26px'],
        ['drawer-large', ['.kbmob-menu svg'], 'width:30px;height:30px'],
        // drawerPanels = hidden: the drawer draws only Kybernos's rows (Automations, Apps…) and then the Workspaces. The engine's own rows of the same list (its pinned pages: « Code review », « Automation tasks »,
        // their unpin buttons, and its « More » launcher) are left out. No word is read: the engine translates their names, so a rule keyed on one language left the other with extra rows. A row is the engine's
        // when it is a `panelEntry` of the sidebar's nav that does not hold the Kybernos menu (`.kb4-menu`); `moreAnchor` is the launcher's own box. A row the Kybernos menu draws is never one of them.
        ['panels-hidden', [PRES_SIDEBAR + ' nav > [class*="panelEntry"]:not(:has(.kb4-menu))', PRES_SIDEBAR + ' nav > [class*="moreAnchor"]'], 'display:none'],
        // composerSize = large: the message box's buttons are 52 px with drawings of 26 px, the model's name is 17 px inside a frame (it read as a label), the text 20 px.
        // EVERY empty-field sentence of the box is 20 px, whatever the engine build draws it with: the box `[data-composer-placeholder]` itself (a build draws the sentence as its own text node,
        // and the phone layer sizes that box at 12 to 16 px; Simple's « Ask Kaby anything » is such a node), the engine's slot inside it, and the placeholder of a plain field of the box.
        ['composer-large', [PRES_CARD + ' [data-composer-input]', PRES_CARD + ' [data-composer-placeholder]', PRES_CARD + ' [data-composer-placeholder] *', PRES_CARD + ' [data-slot="conversation.input.placeholder"]', PRES_CARD + ' [data-slot="conversation.input.placeholder"] *'], 'font-size:20px;line-height:1.4'],
        ['composer-large', [PRES_CARD + ' input::placeholder', PRES_CARD + ' textarea::placeholder'], 'font-size:20px'],
        ['composer-large', [PRES_CARD + ' [data-composer-input]'], 'min-height:60px'],
        ['composer-large', [PRES_CARD + ' button[aria-haspopup="listbox"]', PRES_CARD + ' button[class*="_primary"]'], 'width:48px;height:48px;min-width:48px;min-height:48px'],
        ['composer-large', [PRES_CARD + ' button[aria-haspopup="listbox"] svg', PRES_CARD + ' button[class*="_primary"] svg'], 'width:24px;height:24px'],
        // The model chip (list item 24, the mock-up's composer block): 15 px in a 48 px frame, as wide as its name needs and no wider, pushed against the send button; the name is whole and only an
        // overflowing one ends in an ellipsis (the chip gives way before the send button does: it shrinks, the buttons never do).
        ['composer-large', [PRES_CARD + ' [data-kb="model-seat"]'], 'flex:0 1 auto;min-width:0;margin-left:auto;height:48px;min-height:48px;padding:0 10px 0 12px;gap:6px;font-size:15px;line-height:1.2;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));border-radius:24px'],
        ['composer-large', [PRES_CARD + ' [data-kb="model-seat"] .kbmsl-label'], 'font-size:15px;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'],
        // The two icons never give way to a long name (a build of the engine lets every span of the seat shrink: measured at 6 px with an overflowing name, the icons were cut).
        ['composer-large', [PRES_CARD + ' [data-kb="model-seat"] .kbmsl-ic', PRES_CARD + ' [data-kb="model-seat"] .kbmsl-chev'], 'flex:none;overflow:visible'],
        ['composer-large', [PRES_CARD + ' [data-kb="model-seat"] svg'], 'width:16px;height:16px;flex:none'],
        ['composer-large', [PRES_CARD + ' [data-kb="model-seat"] .kbmsl-chev svg'], 'width:16px;height:16px'],
        // newChatCards: the Kybernos plugin draws the phone's cards (`.kb8-ncs`: the slider with « See all », right above the message box, the stack sitting over the box and the keyboard as in any messaging app;
        // its own sheet is the default, `slider`). `grid`: the same six cards in three columns on the page instead of the slider, « See all » kept (the sheet's own grid, `.kb8-ncs-shgr`, stays a sheet's). `hidden`: no card at
        // all, and the empty chat is the engine's own (its scroller centres the stack: the message box under the headline).
        ['nccards-grid', ['.kb8-ncs-sl'], 'display:none'],
        ['nccards-grid', ['.kb8-ncs-gr:not(.kb8-ncs-shgr)'], 'display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;padding:0 16px'],
        ['nccards-grid', ['.kb8-ncs-gr:not(.kb8-ncs-shgr) .kb8-ncs-card'], 'width:auto'],
        ['nccards-hidden', ['.kb8-ncs'], 'display:none'],
        ['nccards-hidden', ['[class*="scrollBody"]:has(.kb8-ncs)'], 'justify-content:safe center'],
        // rating `thumbs` (list item 31): the Kybernos plugin draws BOTH the five stars (`.kbq-rating-etoiles`, with its question) and the two thumbs (`.kbq-rating-pouces`, hidden by its own CSS); this token
        // shows the thumbs, 44 px each, and hides the stars. Up is a 5 sent at once, down opens the same sheet as a low star.
        ['rating-thumbs', ['.kbq-rating .kbq-rating-question', '.kbq-rating .kbq-rating-etoiles'], 'display:none'],
        ['rating-thumbs', ['.kbq-rating .kbq-rating-pouces'], 'display:inline-flex'],
        ['rating-thumbs', ['.kbq-rating .kbq-rating-pouce'], 'width:44px;height:44px;min-width:44px'],
        // once rated, the thumbs STAY in the row (the lit one says what was chosen) and the thank-you line goes under the row: the card gives its two parts to the row, the rating tag is left out
        ['rating-thumbs', ['.kbq-rating:has(.kbq-rating-merci)'], 'display:contents'],
        ['rating-thumbs', ['.kbq-rating-merci'], 'order:9;flex:1 0 100%;padding-left:6px;font-size:14px'],
        ['rating-thumbs', ['.kbq-rating-merci > .kbq-rating-tag:first-child'], 'display:none'],
        // after a thumbs-up the share box is shown, ticked as it was sent: a 44 px line, its box big enough for a thumb
        ['rating-thumbs', ['.kbq-rating-partage-apres'], 'min-height:44px;gap:10px;font-size:14px'],
        ['rating-thumbs', ['.kbq-rating-partage-apres input'], 'width:22px;height:22px;margin:0;flex:none'],
        // messageSize (list item 33): the engine keeps the size of the chat's text in --dsh-content-font-size (on <body>, set by General › Font size, 12 to 17 px); the phone's stylesheet gives the chat 17 px
        // (`standard`, no token), uses that variable for the answer's text and derives the size of the code from it. The three other sizes are this variable on the chat itself (the menu is not touched).
        ['msg-compact', [PRES_FLOW], '--dsh-content-font-size:15px'],
        ['msg-large', [PRES_FLOW], '--dsh-content-font-size:19px'],
        ['msg-xlarge', [PRES_FLOW], '--dsh-content-font-size:21px']
      ]
      /** The base of the presentation sheet, outside the media query: what `presWalk` adds stays out of sight until a token asks for it. */
      const PRES_BASE = '.kbth-info,.kbth-navback{display:none}'
      /** The presentation stylesheet: static, inert until `<html>` carries a token. */
      const presCss = () => PRES_BASE + '\n@media ' + PRES_MEDIA + '{\n' + PRES_RULES.map((r) => r[1].map((x) => presSel(r[0]) + ' ' + x).join(',') + '{' + r[2].split(';').map((d) => d + '!important').join(';') + '}').join('\n') + '\n}'
      /** Whether the locked Simple small-screen presentation applies now: Simple mode (`html.kb-simple` when `data-kb-mode` is set, else `kb-simple` or `kb-kaby`) on a small screen matching `PRES_MEDIA` (never on a wide desktop). */
      const presSimplePhone = () => {
        try {
          const root = document.documentElement
          const hasMode = typeof root.hasAttribute === 'function' && root.hasAttribute('data-kb-mode')
          const simple = hasMode ? root.classList.contains('kb-simple') : (root.classList.contains('kb-simple') || root.classList.contains('kb-kaby'))
          if (!simple) return false
          if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') return window.matchMedia(PRES_MEDIA).matches === true
          return root.classList.contains('kb-kaby')
        } catch (e) { return false }
      }
      /** The tokens that are on: a person's own setting (anything but the default) wins; the phone's Simple preset asks for the rest in Simple mode on a small screen; else the default (only `rating` has a default that turns a token on: thumbs, in Simple and in Complete). */
      const presTokens = (S) => {
        const locked = presSimplePhone() ? lockedPresentation() : {}
        return PRES_TOKENS.filter((t) => (S[t[0]] !== undefined && S[t[0]] !== DEF[t[0]] ? S[t[0]] : (locked[t[0]] !== undefined ? locked[t[0]] : DEF[t[0]])) === t[1]).map((t) => t[2])
      }
      const INFO_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5.2"/><circle cx="12" cy="7.8" r=".7" fill="currentColor"/></svg>'
      let presSeq = 0
      let presListening = false
      let presWatch = null
      let presQueued = false
      /** Puts back (or takes away) what the presentation adds to the DOM, from the tokens now on <html>. Idempotent: it changes nothing when everything is in place, so the observer that calls it cannot loop. */
      const presWalk = () => {
        presQueued = false
        try {
          const tokens = (document.documentElement.getAttribute(PRES_ATTR) || '').split(' ')
          const fold = tokens.indexOf('desc-info') >= 0
          const nav = tokens.indexOf('tabs-list') >= 0
          const named = tokens.indexOf('help-named') >= 0
          const word = named ? kt('Aide', 'Help') : ''
          document.querySelectorAll(PRES_HELP_BTN.join(',')).forEach((b) => {
            if (!named) { if (b.hasAttribute('data-kb-help-word')) b.removeAttribute('data-kb-help-word'); return }
            if (b.getAttribute('data-kb-help-word') !== word) b.setAttribute('data-kb-help-word', word)
          })
          document.querySelectorAll('[data-kb-desc="fold"]').forEach((d) => {
            const t = d.previousElementSibling
            if (t === null) return
            const mine = t.querySelector(':scope > .kbth-info')
            if (!fold) { if (mine !== null) mine.remove(); d.removeAttribute('data-kb-open'); return }
            if (mine !== null) return
            if (!d.id) { presSeq += 1; d.id = 'kbth-d' + presSeq }
            const b = document.createElement('button')
            b.type = 'button'; b.className = 'kbth-info'; b.setAttribute('aria-expanded', d.getAttribute('data-kb-open') === '1' ? 'true' : 'false'); b.setAttribute('aria-controls', d.id)
            b.setAttribute('aria-label', kt('En savoir plus sur ce réglage', 'More about this setting')); b.innerHTML = INFO_ICON
            t.appendChild(b)
          })
          document.querySelectorAll(PRES_KABY).forEach((pg) => {
            const tl = pg.querySelector(':scope > .kbkc-tabs')
            const back = pg.querySelector(':scope > .kbth-navback')
            const title = pg.querySelector('[data-kb="page-title"], .kbhp-title')
            if (!nav || tl === null) {
              if (back !== null) back.remove()
              pg.removeAttribute('data-kb-nav')
              if (title !== null) title.removeAttribute('data-kb-section')
              return
            }
            if (!pg.hasAttribute('data-kb-nav')) pg.setAttribute('data-kb-nav', 'menu')
            const name = title !== null ? (title.textContent || '').trim() : ''
            let b = back
            if (b === null) { b = document.createElement('button'); b.type = 'button'; b.className = 'kbth-navback'; pg.insertBefore(b, pg.firstChild) }
            if (b.textContent !== name) b.textContent = name
            if (title !== null) {
              if (pg.getAttribute('data-kb-nav') === 'page') {
                const sel = tl.querySelector('[role="tab"][aria-selected="true"]')
                const label = sel !== null ? (sel.textContent || '').trim() : ''
                if (title.getAttribute('data-kb-section') !== label) title.setAttribute('data-kb-section', label)
              } else if (title.hasAttribute('data-kb-section')) title.removeAttribute('data-kb-section')
            }
          })
        } catch (e) { /* a page that is gone, or outside a browser */ }
      }
      const presQueue = () => { if (presQueued) return; presQueued = true; Promise.resolve().then(presWalk) }
      const presClick = (ev) => {
        try {
          const t = ev.target
          if (t === null || typeof t.closest !== 'function') return
          const info = t.closest('.kbth-info')
          if (info !== null) {
            const d = info.parentElement !== null ? info.parentElement.nextElementSibling : null
            if (d !== null) { const open = d.getAttribute('data-kb-open') !== '1'; if (open) d.setAttribute('data-kb-open', '1'); else d.removeAttribute('data-kb-open'); info.setAttribute('aria-expanded', open ? 'true' : 'false') }
            ev.preventDefault(); ev.stopPropagation()
            return
          }
          const back = t.closest('.kbth-navback')
          if (back !== null && back.parentElement !== null) { back.parentElement.setAttribute('data-kb-nav', 'menu'); presWalk(); back.parentElement.scrollIntoView({ block: 'start' }); ev.preventDefault(); ev.stopPropagation(); return }
          const tab = t.closest('.kbkc-tabs > [role="tab"]')
          if (tab !== null && tab.parentElement !== null && tab.parentElement.parentElement !== null) {
            const pg = tab.parentElement.parentElement
            if (pg.getAttribute('data-kb-nav') === 'menu' && window.matchMedia(PRES_MEDIA).matches) {
              const title = pg.querySelector('[data-kb="page-title"], .kbhp-title')
              if (title !== null) title.setAttribute('data-kb-section', (tab.textContent || '').trim())
              pg.setAttribute('data-kb-nav', 'page')
              pg.scrollIntoView({ block: 'start' })
            }
          }
        } catch (e) { /* the page is gone */ }
      }
      /** The attribute on <html> follows the tokens; the hand of the DOM (`presWalk`, the clicks) runs only while one is on. */
      const presSync = (S) => {
        try {
          const tokens = presTokens(S)
          const html = document.documentElement
          if (tokens.length > 0) html.setAttribute(PRES_ATTR, tokens.join(' ')); else html.removeAttribute(PRES_ATTR)
          const want = tokens.indexOf('desc-info') >= 0 || tokens.indexOf('tabs-list') >= 0
          if (want && !presListening) {
            presListening = true
            document.addEventListener('click', presClick, true)
            if (typeof MutationObserver === 'function') { presWatch = new MutationObserver(presQueue); presWatch.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-selected'] }) }
          } else if (!want && presListening) {
            presListening = false
            document.removeEventListener('click', presClick, true)
            if (presWatch !== null) { presWatch.disconnect(); presWatch = null }
          }
          presWalk()
        } catch (e) { /* outside a browser */ }
      }
      // kb-pres:end

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
        if (S.skin === 'epure') {
          css.push(EPURE_CSS)
          if (S.bubbleUser === 'auto') css.push(EPURE_BUBBLE_CSS)
        }
        if (typeof navigator !== 'undefined' && /Electron\//i.test(String(navigator.userAgent || '')) && /Mac/i.test(String(navigator.userAgent || ''))) {
          css.push(
            'html[data-kb-electron="darwin"] [data-slot="sidebar"]{padding-top:34px}',
            'html[data-kb-electron="darwin"] header[class*="_header"]{-webkit-app-region:drag}',
            'html[data-kb-electron="darwin"] header[class*="_header"] :is(button,a,input,select,[role="button"]){-webkit-app-region:no-drag}'
          )
        }
        if (S.autoHideBars) css.push(AUTOHIDE_CSS)
        return css.join('\n')
      }
      /** Codex-inspired minimalist refinements for the "Pure (Codex)" preset:
       *  whisper hairline dividers, floating rounded composer card, soft blue user message pill,
       *  and airy pill navigation rows. */
      const EPURE_CSS = [
        'body:not([data-ds-dark-theme]){--dsw-alias-border-l1:rgba(0,0,0,.055);--dsw-alias-border-l2:rgba(0,0,0,.09)}',
        'body[data-ds-dark-theme]{--dsw-alias-border-l1:rgba(255,255,255,.065);--dsw-alias-border-l2:rgba(255,255,255,.11)}',
        '[data-composer-card]{border-radius:20px!important;border:1px solid var(--dsw-alias-border-l2)!important}',
        'body:not([data-ds-dark-theme]) [data-composer-card]{box-shadow:0 1px 2px rgba(0,0,0,.03),0 8px 24px rgba(0,0,0,.05)!important}',
        'body[data-ds-dark-theme] [data-composer-card]{box-shadow:0 2px 14px rgba(0,0,0,.28)!important}',
        '[data-slot="sidebar"]{border-inline-end:1px solid var(--dsw-alias-border-l1)!important}'
      ].join('')
      const EPURE_BUBBLE_CSS = [
        'body:not([data-ds-dark-theme]) [data-chat-flow-kind="user"]{--dsw-specific-bubble:#e8f1fe;--dsw-alias-label-primary:#1a1c1f}',
        'body[data-ds-dark-theme] [data-chat-flow-kind="user"]{--dsw-specific-bubble:#1e2c44;--dsw-alias-label-primary:#f3f4f6}'
      ].join('')
      /** Bars on hover (owner's call, 2026-10-22). Only on a pointer that can hover: a touch screen has nothing to hover with.
       *  - The collapsed rail slides out to an 8 px sliver and the chat takes its column back (the three columns are placed by hand so the
       *    grid does not reflow); it comes back while the pointer or the keyboard is in it, or while a menu opened from it is open
       *    (an open section of the rail is aria-expanded too, so only a popup trigger counts).
       *  - The top bar of a chat (title, pin, ⋯) does the same with a 6 px sliver at the top.
       *  Found by the suffix of the shell's hashed classes, which survives a rebuild (the prefix does not). */
      const AUTOHIDE_FRAME = '[class*="_frame"]:has(>[class*="_sidebarCol"] [class*="_collapsed"])'
      const AUTOHIDE_RAIL = AUTOHIDE_FRAME + '>[class*="_sidebarCol"]'
      const AUTOHIDE_TOP = '[class*="_centerCol"] header[class*="_header"]:has(>[class*="_headerLeading"])'
      // The chat column that holds the top bar. ONE `:has()`: CSS does not allow a `:has()` inside a `:has()` (the old `position:relative` rule of this
      // column was written that way and never applied), so the bar's own `:has(>_headerLeading)` is spelled as a child combinator here.
      const AUTOHIDE_COL = '[class*="_centerCol"]:has(header[class*="_header"]>[class*="_headerLeading"])'
      const TAB_W = 44
      const TAB_H = 18
      const TAB_CHEVRON = 'url("data:image/svg+xml;utf8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 12 12\'%3E%3Cpath d=\'M2 4.5l4 4 4-4\' fill=\'none\' stroke=\'black\' stroke-width=\'1.6\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3C/svg%3E")'
      const AUTOHIDE_CSS = '@media (hover:hover) and (pointer:fine){' +
        AUTOHIDE_FRAME + '>[class*="_centerCol"]{grid-column:1 / 3;grid-row:1}' +
        AUTOHIDE_FRAME + '>[class*="_rightbarCol"]{grid-column:3;grid-row:1}' +
        AUTOHIDE_RAIL + '{grid-column:1;grid-row:1;z-index:40;transform:translateX(calc(-100% + 8px));transition:transform .18s ease .2s,box-shadow .18s ease .2s;background:var(--dsw-alias-bg-layer-1)}' +
        'html[dir="rtl"] ' + AUTOHIDE_RAIL + '{transform:translateX(calc(100% - 8px))}' +
        AUTOHIDE_RAIL + ':hover,' + AUTOHIDE_RAIL + ':focus-within,' + AUTOHIDE_RAIL + ':has([aria-haspopup][aria-expanded="true"]){transform:none;transition-delay:0s;box-shadow:0 0 28px rgba(0,0,0,.35)}' +
        AUTOHIDE_COL + '{position:relative}' +
        // `app-region:no-drag`: in the desktop app the top bar is the window's drag handle, and the 6 px sliver that stays on screen would then be
        // drag area, which never gets the pointer: the bar could not be brought back by hovering it (seen in the Electron app, 2026-11-18). While
        // the bars hide on hover, the window is dragged by the sidebar's own top row.
        AUTOHIDE_TOP + '{position:absolute;inset-inline:0;top:0;z-index:30;transform:translateY(calc(-100% + 6px));transition:transform .18s ease .2s,box-shadow .18s ease .2s;background:var(--dsw-alias-bg-layer-1);app-region:no-drag;-webkit-app-region:no-drag}' +
        AUTOHIDE_TOP + ':hover,' + AUTOHIDE_TOP + ':focus-within,' + AUTOHIDE_TOP + ':has([aria-haspopup][aria-expanded="true"]){transform:none;transition-delay:0s;box-shadow:0 8px 24px rgba(0,0,0,.28)}' +
        // `data-kbth-peek` is set by `peekBind` below while the pointer is in the top PEEK_ZONE px of the bar's column: same look as a hover.
        'html[data-kbth-peek] ' + AUTOHIDE_TOP + '{transform:none;transition-delay:0s;box-shadow:0 8px 24px rgba(0,0,0,.28)}' +
        // Pinned (button below, or Ctrl/⌘+Shift+H): the bar is back in the flow of the page, as DSH draws it, and stays.
        'html[data-kbth-pin-top] ' + AUTOHIDE_TOP + '{position:relative;transform:none;box-shadow:none;transition:none}' +
        // The tab: a small handle hanging from the top edge of the chat column, always on screen, that pins / unpins the bar. Two pseudo-elements of the
        // column, so nothing is added to DSH's DOM; `pinBind` finds a click on it by its place. Down chevron = show the bar, up chevron = let it hide.
        AUTOHIDE_COL + '::before{content:"";position:absolute;z-index:31;top:0;inset-inline-start:50%;margin-inline-start:-' + (TAB_W / 2) + 'px;width:' + TAB_W + 'px;height:' + TAB_H + 'px;box-sizing:border-box;border-radius:0 0 10px 10px;background:var(--dsw-alias-bg-layer-1);box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2);opacity:.8;cursor:pointer}' +
        AUTOHIDE_COL + '::after{content:"";position:absolute;z-index:32;top:3px;inset-inline-start:50%;margin-inline-start:-6px;width:12px;height:12px;pointer-events:none;background:var(--dsw-alias-label-secondary,currentColor);-webkit-mask:' + TAB_CHEVRON + ' center/contain no-repeat;mask:' + TAB_CHEVRON + ' center/contain no-repeat}' +
        'html[data-kbth-pin-top] ' + AUTOHIDE_COL + '::after{transform:scaleY(-1)}' +
        '}'
      /** The reach of the hidden top bar (owner, 2026-11-19: « toujours dur » in the desktop app). The 6 px sliver is too thin to stop on: in the
       *  desktop app the page starts right under the window's own title bar, so a hand that goes up overshoots it, and the pointer that leaves
       *  the page loses its hover. So the bar also comes down while the pointer is in the top PEEK_ZONE px of its column, stays down while the
       *  pointer is inside it, and waits PEEK_LINGER ms when the pointer leaves the page by the top (the overshoot) before it goes back up.
       *  Cheap: a pointer below the zone, with the bar up, costs one comparison. `doc` is a parameter so the test can drive it. */
      const PEEK_ZONE = 28
      const PEEK_LINGER = 700
      const PEEK_ATTR = 'data-kbth-peek'
      const peekBind = (doc) => {
        const root = doc.documentElement
        let on = false
        let timer = null
        const cancel = () => { if (timer !== null) { clearTimeout(timer); timer = null } }
        const set = (v) => {
          if (v === on) return
          on = v
          try { if (v) root.setAttribute(PEEK_ATTR, '1'); else root.removeAttribute(PEEK_ATTR) } catch (e) { /* no document element */ }
        }
        const onMove = (ev) => {
          try {
            const y = ev.clientY
            if (!on && !(y <= PEEK_ZONE)) return
            const h = doc.querySelector(AUTOHIDE_TOP)
            if (h === null) { cancel(); set(false); return }
            const r = h.getBoundingClientRect()
            const inside = ev.clientX >= r.left && ev.clientX <= r.right
            if (inside && y <= PEEK_ZONE) { cancel(); set(true); return }
            // the bar is down: it stays while the pointer is on it (a few px of margin below), and goes up as soon as the pointer is anywhere else
            if (on && inside && y <= Math.max(PEEK_ZONE, r.bottom) + 6) { cancel(); return }
            cancel(); set(false)
          } catch (e) { /* a page without these APIs: the CSS hover still works */ }
        }
        const onLeave = (ev) => {
          // the pointer left the page: by the top it is the overshoot, give it a moment to come back; anywhere else the bar goes up now
          if (!on) return
          cancel()
          if (ev && ev.clientY <= 1) timer = setTimeout(() => { timer = null; set(false) }, PEEK_LINGER)
          else set(false)
        }
        // `mouseleave` does not bubble, so without capture only the page itself (<html>) reaches `onLeave`: leaving a button inside the bar does not.
        doc.addEventListener('mousemove', onMove, { capture: true, passive: true })
        root.addEventListener('mouseleave', onLeave)
        return () => {
          cancel()
          set(false)
          try { doc.removeEventListener('mousemove', onMove, { capture: true }) } catch (e) { /* gone */ }
          try { root.removeEventListener('mouseleave', onLeave) } catch (e) { /* gone */ }
        }
      }
      /** Hide / unhide by hand (owner, 2026-11-19: « ya pas de système, hide, unhide ? »). Two ways to the same switch: the tab drawn under the
       *  column's top edge (see AUTOHIDE_CSS) and Ctrl/⌘+Shift+H. Pinned = the top bar stays in place as DSH draws it; unpinned = it hides to the
       *  sliver and comes back on hover. Kept in this browser's localStorage (a per-viewer convenience; a private window forgets it). */
      const PIN_KEY = 'kybernos.top-bar-pinned'
      const PIN_ATTR = 'data-kbth-pin-top'
      const pinBind = (doc) => {
        const root = doc.documentElement
        const win = doc.defaultView
        const read = () => { try { return win.localStorage.getItem(PIN_KEY) === '1' } catch (e) { return false } }
        const write = (v) => { try { if (v) win.localStorage.setItem(PIN_KEY, '1'); else win.localStorage.removeItem(PIN_KEY) } catch (e) { /* no storage: it lasts until the page closes */ } }
        let pinned = read()
        const apply = () => { try { if (pinned) root.setAttribute(PIN_ATTR, '1'); else root.removeAttribute(PIN_ATTR) } catch (e) { /* no document element */ } }
        const toggle = () => { pinned = !pinned; write(pinned); apply() }
        const onClick = (ev) => {
          try {
            if (ev.button !== undefined && ev.button !== 0) return
            const col = ev.target
            // a click on the tab (a pseudo-element) lands on the column itself: it is the tab only inside the tab's box, at the top and centre of the column
            if (col === null || col === undefined || typeof col.matches !== 'function' || !col.matches(AUTOHIDE_COL)) return
            const r = col.getBoundingClientRect()
            if (ev.clientY < r.top || ev.clientY > r.top + TAB_H || Math.abs(ev.clientX - (r.left + r.width / 2)) > TAB_W / 2) return
            ev.preventDefault(); ev.stopPropagation(); toggle()
          } catch (e) { /* a page without these APIs: the shortcut still works */ }
        }
        const onKey = (ev) => {
          try {
            if (ev.shiftKey !== true || ev.altKey === true || (ev.metaKey !== true && ev.ctrlKey !== true)) return
            if (ev.code !== 'KeyH' && String(ev.key).toLowerCase() !== 'h') return
            if (doc.querySelector(AUTOHIDE_TOP) === null) return // no top bar on this page: the keys stay free
            ev.preventDefault(); ev.stopPropagation(); toggle()
          } catch (e) { /* idem */ }
        }
        apply()
        doc.addEventListener('click', onClick, true)
        doc.addEventListener('keydown', onKey, true)
        return () => {
          try { doc.removeEventListener('click', onClick, true) } catch (e) { /* gone */ }
          try { doc.removeEventListener('keydown', onKey, true) } catch (e) { /* gone */ }
          try { root.removeAttribute(PIN_ATTR) } catch (e) { /* gone */ }
        }
      }
      let effetsDispose = null
      let peekDispose = null
      let pinDispose = null
      // Touch comfort: the stylesheet is inserted once (it is inert without the attribute); the attribute follows the person's setting, or the locked preset's `touch` option while the app is in Kaby mode
      // (`kb-kaby` on <html>, put there by the Mobile bundle, maybe after this runs: the class is watched).
      let touchDispose = null
      let presDispose = null
      let touchLast = null
      let touchWatch = null
      let presMq = null
      let countersLast = null
      const touchWanted = (S) => {
        if (S.touch === true) return true
        try { return document.documentElement.classList.contains('kb-kaby') && lockedTouch() } catch (e) { return false }
      }
      const touchSync = (S) => {
        try { if (touchWanted(S)) document.documentElement.setAttribute(TOUCH_ATTR, 'on'); else document.documentElement.removeAttribute(TOUCH_ATTR) } catch (e) { /* outside a browser */ }
      }
      const appliquerEffets = (S) => {
        touchLast = S
        touchSync(S)
        presSync(S)
        try {
          if (touchDispose === null) touchDispose = styles.insert(touchCss())
          if (presDispose === null) presDispose = styles.insert(presCss())
          if (touchWatch === null && typeof MutationObserver === 'function') {
            touchWatch = new MutationObserver(() => { if (touchLast !== null) { touchSync(touchLast); presSync(touchLast) } })
            touchWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
          }
          if (presMq === null && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
            const mq = window.matchMedia(PRES_MEDIA)
            if (mq !== null && mq !== undefined && typeof mq.addEventListener === 'function') {
              presMq = mq
              mq.addEventListener('change', () => { if (touchLast !== null) presSync(touchLast) })
            }
          }
        } catch (e) { /* outside a browser */ }
        if (effetsDispose !== null) { try { effetsDispose() } catch (e) { /* already removed */ } effetsDispose = null }
        if (peekDispose !== null) { try { peekDispose() } catch (e) { /* already removed */ } peekDispose = null }
        if (pinDispose !== null) { try { pinDispose() } catch (e) { /* already removed */ } pinDispose = null }
        if (S.autoHideBars) { try { if (typeof document !== 'undefined') { peekDispose = peekBind(document); pinDispose = pinBind(document) } } catch (e) { /* hors navigateur */ } }
        // The thinking-animation engine also reads this attribute: “reduce” applies to it too.
        try { if (S.reduceMotion) document.documentElement.setAttribute('data-kbth-reduced', '1'); else document.documentElement.removeAttribute('data-kbth-reduced') } catch (e) { /* hors navigateur */ }
        try { if (S.cbSafe) document.documentElement.setAttribute('data-kbth-cb', '1'); else document.documentElement.removeAttribute('data-kbth-cb') } catch (e) { /* hors navigateur */ }
        // The notification counters (title count, app badge): kybernos-pulse reads this attribute, always 'shown' or 'hidden', and is told of a change by the window event `kb-counters-change`.
        try {
          const want = S.notifCounters === 'shown' ? 'shown' : 'hidden'
          document.documentElement.setAttribute('data-kbth-counters', want)
          if (countersLast !== want) { countersLast = want; window.dispatchEvent(new CustomEvent('kb-counters-change', { detail: want })) }
        } catch (e) { /* hors navigateur */ }
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

      // `keepNativeMode`: a look that carries no mode must not write DSH's own light/dark preference (the person's choice).
      const appliquerTout = (themeSvc, S) => {
        if (S.keepNativeMode !== true) appliquerMode(themeSvc, S)
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
        dsh: ['Kybernos d’origine', 'Kybernos original'],
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
      // 4c. THEME LIBRARY (the presets of « Mine »).
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
        a11y: ['contrastMode', 'cbSafe', 'reduceMotion', 'focusRing', 'largeTargets', 'underlineLinks', 'touch']
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
      const PRESET_SOURCES = ['me', 'file', 'gallery', 'template']
      const PRESET_FILE_MAX = 200 * 1024
      const LIB_KEY = 'kybernos.theme.presets.v1'
      /** The menu in use, as the menu itself reads it at first paint (kybernos-plugin/client.js `kbMenuPrefsRead`): written only by this page. */
      const MENU_KEY = 'kybernos.theme.menu.v1'
      const MENU_EVENT = 'kb-menu-prefs-change'
      // The menu arrangement: { entries: [{ id, shown, order, label? }], unlisted: 'show' | 'hide', locked }. Three copies of this check
      // exist and must agree (preset-store.mjs `sanitizeMenu`, kybernos-plugin/client.js `kbMenuPrefsClean`); each package's test pins the same vectors.
      const MENU_ENTRIES_MAX = 24
      const MENU_LABEL_MAX = 40
      const MENU_ID = /^[a-z][a-z0-9-]{1,23}$/
      /** The rows a person can never hide: the host's own (Workspaces, Settings, the account). They cannot even be stored. */
      const MENU_NEVER = ['workspaces', 'projects', 'settings', 'account']
      /**
       * The two other places an arrangement shows or hides entries (`surfaces` of the arrangement; the main menu is its own `entries`): the SECONDARY menu (the account menu the avatar
       * opens) and the SETTINGS pages. `never`: ids that cannot even be stored there (Settings, the account, the referral and the sign-out open the app's own screens on the phone;
       * General is the page Settings opens on). Their entries are { id, shown, order }: no name. Mirrors preset-store.mjs `MENU_SURFACES`.
       */
      const MENU_SURFACES = { secondary: { never: ['account', 'referral', 'settings', 'logout'], max: 24 }, settings: { never: ['general'], trustedNever: [], max: 64 } }
      const MENU_SURFACE_IDS = ['secondary', 'settings']
      const MENU_LANGS = ['en', 'fr', 'es', 'ar']
      const menuText = (s) => String(s).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim()
      /** One surface of an arrangement (the secondary menu or the Settings pages) out of any value, or null when it says nothing. Same checks as the main menu's entries. */
      const menuSurfaceClean = (raw, spec, trusted) => {
        const never = trusted === true && Array.isArray(spec.trustedNever) ? spec.trustedNever : spec.never
        if (raw === null || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.entries)) return null
        const seen = new Set()
        const kept = []
        for (const e of raw.entries) {
          if (kept.length >= spec.max) break
          if (e === null || typeof e !== 'object' || Array.isArray(e) || typeof e.id !== 'string' || !MENU_ID.test(e.id) || never.indexOf(e.id) >= 0 || seen.has(e.id) || typeof e.shown !== 'boolean') continue
          seen.add(e.id)
          kept.push({ id: e.id, shown: e.shown, order: Number.isInteger(e.order) && e.order >= 0 && e.order <= 99 ? e.order : kept.length })
        }
        kept.sort((a, b) => a.order - b.order)
        kept.forEach((e, i) => { e.order = i })
        const unlisted = raw.unlisted === 'hide' ? 'hide' : 'show'
        return kept.length === 0 && unlisted === 'show' ? null : { entries: kept, unlisted }
      }
      /** One arrangement out of any value, or null. Bad entries are dropped one by one, never trusted; sorted by `order`, renumbered 0..n-1. `surfaces` is kept only when it says something. */
      const menuClean = (raw, trusted) => {
        if (raw === null || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.entries)) return null
        const seen = new Set()
        const kept = []
        for (const e of raw.entries) {
          if (kept.length >= MENU_ENTRIES_MAX) break
          if (e === null || typeof e !== 'object' || Array.isArray(e) || typeof e.id !== 'string' || !MENU_ID.test(e.id) || MENU_NEVER.indexOf(e.id) >= 0 || seen.has(e.id) || typeof e.shown !== 'boolean') continue
          seen.add(e.id)
          const entry = { id: e.id, shown: e.shown, order: Number.isInteger(e.order) && e.order >= 0 && e.order <= 99 ? e.order : kept.length }
          if (e.label !== null && typeof e.label === 'object' && !Array.isArray(e.label)) {
            const label = {}
            MENU_LANGS.forEach((l) => {
              if (typeof e.label[l] !== 'string') return
              const t = menuText(e.label[l])
              if (t !== '' && t.length <= MENU_LABEL_MAX && !/[<>]/.test(t)) label[l] = t
            })
            if (Object.keys(label).length > 0) entry.label = label
          }
          kept.push(entry)
        }
        kept.sort((a, b) => a.order - b.order)
        kept.forEach((e, i) => { e.order = i })
        const out = { entries: kept, unlisted: raw.unlisted === 'hide' ? 'hide' : 'show', locked: raw.locked === true }
        if (raw.surfaces !== null && typeof raw.surfaces === 'object' && !Array.isArray(raw.surfaces)) {
          const surfaces = {}
          MENU_SURFACE_IDS.forEach((k) => { const v = menuSurfaceClean(raw.surfaces[k], MENU_SURFACES[k], trusted === true); if (v !== null) surfaces[k] = v })
          if (Object.keys(surfaces).length > 0) out.surfaces = surfaces
        }
        return out
      }
      /** Does a cleaned arrangement say anything: an entry on the main menu or on another surface, or a surface that hides what it does not list? */
      const menuHasContent = (menu) => menu !== null && menu !== undefined && (menu.entries.length > 0 || menu.surfaces !== undefined)
      const menuSame = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b)

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
      /** One library record, or null. The same shape check as the host's (preset-store.mjs), plus the meaning of the values. A preset holds an appearance part (`settings`), a menu part (`menu`), or both. */
      const presetRecord = (raw) => {
        if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
        if (typeof raw.id !== 'string' || !PRESET_ID.test(raw.id)) return null
        const name = presetName(raw.name)
        const settings = presetSettings(raw.settings)
        const menu = raw.menu === undefined || raw.menu === null ? null : menuClean(raw.menu)
        const menuOk = menuHasContent(menu)
        if (name === '' || (settings === null && !menuOk)) return null
        const rec = {
          id: raw.id, name,
          source: PRESET_SOURCES.indexOf(raw.source) >= 0 ? raw.source : 'file',
          at: typeof raw.at === 'number' && Number.isFinite(raw.at) ? Math.max(0, Math.round(raw.at)) : 0
        }
        if (settings !== null) rec.settings = settings
        if (menuOk) rec.menu = menu
        if (typeof raw.author === 'string' && raw.author.trim() !== '') rec.author = raw.author.trim().slice(0, 60)
        if (typeof raw.gid === 'string' && PRESET_ID.test(raw.gid)) rec.gid = raw.gid
        if (Number.isInteger(raw.v) && raw.v >= 0 && raw.v <= 1000000) rec.v = raw.v
        return rec
      }

      const lib = { presets: [], menu: null, updatedAt: 0, hostState: 'unknown', pulled: false, pushTimer: null, subs: new Set() }
      const libNotify = () => { lib.subs.forEach((f) => { try { f() } catch (e) { /* a page that is gone */ } }) }
      /** A library document (from the browser or the host), always put back in the expected shape. `menu` is the menu in use (null: the default menu). */
      const libClean = (raw) => {
        const r = (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {}
        const seen = new Set()
        const presets = []
        ;(Array.isArray(r.presets) ? r.presets : []).forEach((p) => {
          const rec = presetRecord(p)
          if (rec !== null && !seen.has(rec.id) && presets.length < PRESET_LIMIT) { seen.add(rec.id); presets.push(rec) }
        })
        const menu = r.menu === undefined || r.menu === null ? null : menuClean(r.menu)
        return { presets, menu, updatedAt: typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt) ? Math.max(0, Math.round(r.updatedAt)) : 0 }
      }
      /** The document that goes to the browser copy and to the host. */
      const libDoc = () => {
        const doc = { v: 1, updatedAt: lib.updatedAt, presets: lib.presets }
        if (lib.menu !== null) doc.menu = lib.menu
        return doc
      }
      const libRead = () => {
        try {
          const raw = localStorage.getItem(LIB_KEY)
          const c = libClean(raw === null ? {} : JSON.parse(raw))
          lib.presets = c.presets; lib.menu = c.menu; lib.updatedAt = c.updatedAt
        } catch (e) { lib.presets = []; lib.menu = null; lib.updatedAt = 0 }
      }
      /** What the menu reads at first paint: written with the library, and the menu is told (same tab: an event; other tabs: the `storage` event). */
      const menuMirror = (announce) => {
        try { localStorage.setItem(MENU_KEY, JSON.stringify({ v: 1, updatedAt: lib.updatedAt, menu: lib.menu })) } catch (e) { /* quota */ }
        if (announce === true) { try { window.dispatchEvent(new CustomEvent(MENU_EVENT)) } catch (e) { /* outside a browser */ } }
      }
      const libWrite = (menuMoved) => {
        try { localStorage.setItem(LIB_KEY, JSON.stringify(libDoc())) } catch (e) { /* quota */ }
        if (menuMoved !== false) menuMirror(menuMoved === true)
      }
      libRead()
      // A menu kept in the library but missing from the menu's own key (site data cleared in part): put it back, without waking anybody.
      try { if (lib.menu !== null && localStorage.getItem(MENU_KEY) === null) menuMirror(false) } catch (e) { /* no storage */ }

      const libHostUrl = () => { try { return new URL('kybernos-theme/preset-store', document.baseURI).pathname } catch (e) { return '/kybernos-theme/preset-store' } }
      const libHost = async (body) => {
        if (!ldHostOn()) return { ok: false, unreachable: true, error: 'host store off' }
        try {
          const res = await fetch(libHostUrl(), body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
          const j = await res.json().catch(() => null)
          const out = (j !== null && typeof j === 'object') ? j : { ok: false, unreachable: true, error: 'unreadable answer' }
          // The status tells the seam a refusal (400) from a host fault (5xx), which it treats differently (A1-3).
          if (typeof res.status === 'number') out.status = res.status
          return out
        } catch (e) { return { ok: false, unreachable: true, error: String(e !== null && e.message ? e.message : e) } }
      }
      const libSchedulePush = () => {
        if (!ldHostOn()) return
        if (lib.pushTimer !== null) clearTimeout(lib.pushTimer)
        lib.pushTimer = setTimeout(() => {
          lib.pushTimer = null
          libHost({ library: libDoc() }).then((j) => {
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
        const sig = () => JSON.stringify([lib.updatedAt, lib.presets.map((p) => p.id + p.name), lib.menu])
        const before = sig()
        if (j.library !== null && j.library !== undefined) {
          const c = libClean(j.library)
          if (c.updatedAt > lib.updatedAt) {
            const menuMoved = !menuSame(c.menu, lib.menu)
            lib.presets = c.presets; lib.menu = c.menu; lib.updatedAt = c.updatedAt
            libWrite(menuMoved) // a menu that came from the disk copy is announced to the menu, like one set on this page
          }
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
        return SKINS.some((s) => s.name.toLowerCase() === k) || ST_VIBES.some((v) => kt(v.fr, v.en).toLowerCase() === k || v.fr.toLowerCase() === k || v.en.toLowerCase() === k)
          || MENU_BUILTINS.some((m) => m.fr.toLowerCase() === k || m.en.toLowerCase() === k) || lib.presets.some((p) => p.id !== exceptId && p.name.toLowerCase() === k)
      }
      /** `name`, or `name (2)`, `name (3)`... when it is already taken by a shipped theme or one of yours. */
      const libFreeName = (name) => {
        const base = presetName(name) || kt('Préréglage', 'Preset')
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
      /** Puts a menu in use (a MENU DOC, or null for the default menu): browser first, the menu is told at once, the disk after. Returns false when nothing changed. */
      const menuUse = (doc) => {
        const next = doc === null || doc === undefined ? null : menuClean(doc)
        if (doc !== null && doc !== undefined && next === null) return false
        if (menuSame(next, lib.menu)) return false
        lib.menu = next
        lib.updatedAt = Math.max(Date.now(), lib.updatedAt + 1)
        libWrite(true); libNotify(); libSchedulePush()
        return true
      }

      // ── The menu: the rows this install draws now, and the arrangement in use ───────────────────────────────────────────
      //   kybernos-plugin publishes ONE registry of the rows (`window.__KB_MENU_ENTRIES__`: id, icon, default name; the same ids as the menu's
      //   own rows) and reads the arrangement back from MENU_KEY. This page is the only writer of the arrangement; rows are found by their stable
      //   hook (`data-kb-row`) on the menu's side, never by their label. A row the arrangement does not list follows `unlisted`.
      const menuRegistry = () => { try { const r = window.__KB_MENU_ENTRIES__; return r !== undefined && r !== null && r.v === 1 && typeof r.list === 'function' ? r : null } catch (e) { return null } }
      /** The rows this install can draw right now, in the default order: [{ id, icon, name, off? }] (`off: true` = a row the default menu leaves out, a plugin's `defaultShown: false`). [] when the menu is not there. */
      const menuRows = () => {
        const r = menuRegistry()
        if (r === null) return []
        try {
          const list = r.list()
          return (Array.isArray(list) ? list : []).filter((x) => x !== null && typeof x === 'object' && typeof x.id === 'string' && MENU_ID.test(x.id) && MENU_NEVER.indexOf(x.id) < 0 && typeof x.name === 'string')
            .slice(0, MENU_ENTRIES_MAX).map((x) => (x.off === true ? { id: x.id, icon: typeof x.icon === 'string' ? x.icon : null, name: x.name, off: true } : { id: x.id, icon: typeof x.icon === 'string' ? x.icon : null, name: x.name }))
        } catch (e) { return [] }
      }
      /** The key of the page language in a row's `label`, or null (a language the labels do not cover: the default name is shown). */
      const menuLabelKey = () => { const l = lang(); const two = l === 'kybernos' ? 'fr' : String(l).slice(0, 2).toLowerCase(); return MENU_LANGS.indexOf(two) >= 0 ? two : null }
      /**
       * The rows as the person sees them for an arrangement (a MENU DOC or null): [{ id, icon, base, name, shown, label, listed }] in display order.
       * Listed rows come first, by `order`; the others keep their default order after them. A name is `label[page language]` or the default one.
       */
      const menuView = (doc, rows) => {
        const ents = doc === null || doc === undefined ? [] : doc.entries
        const byId = {}
        rows.forEach((r) => { byId[r.id] = r })
        const key = menuLabelKey()
        const mk = (r, e) => {
          const label = e !== null && e.label !== undefined ? { ...e.label } : {}
          return { id: r.id, icon: r.icon, base: r.name, name: key !== null && label[key] !== undefined ? label[key] : r.name, shown: e !== null ? e.shown : (r.off !== true && !(doc !== null && doc !== undefined && doc.unlisted === 'hide')), label, listed: e !== null, off: r.off === true }
        }
        const listed = new Set(ents.map((e) => e.id))
        return ents.filter((e) => byId[e.id] !== undefined).map((e) => mk(byId[e.id], e)).concat(rows.filter((r) => !listed.has(r.id)).map((r) => mk(r, null)))
      }
      /** Do the surfaces of an arrangement hide nothing (no entry hidden, nothing hidden by default)? True when it has none. */
      const menuSurfacesDefault = (doc) => doc === null || doc === undefined || doc.surfaces === undefined || MENU_SURFACE_IDS.every((k) => doc.surfaces[k] === undefined || (doc.surfaces[k].unlisted === 'show' && doc.surfaces[k].entries.every((e) => e.shown)))
      /** Is this arrangement the default menu (every row shown, default order and names, nothing hidden by default)? */
      const menuIsDefault = (doc, rows) => {
        if (doc === null || doc === undefined) return true
        if (doc.unlisted === 'hide' || doc.locked === true || !menuSurfacesDefault(doc)) return false
        const v = menuView(doc, rows)
        return v.every((x, i) => x.shown === !x.off && x.id === rows[i].id && Object.keys(x.label).length === 0) && doc.entries.every((e) => rows.some((r) => r.id === e.id))
      }
      /**
       * An edit of the arrangement: `fn` gets the rows as a plain list [{ id, shown, label }] (in display order) and changes it in place (move, show or hide, rename);
       * the answer is the new FULL arrangement (one entry per row of this install), or null when it is the default menu. A row listed in `doc` that this install does not
       * have (a preset from another machine) is kept, after the others. A locked arrangement is left alone (null is not "default" here: `undefined` = refused).
       */
      const menuEdit = (doc, rows, fn) => {
        if (doc !== null && doc !== undefined && doc.locked === true) return undefined
        const list = menuView(doc, rows).map((v) => ({ id: v.id, shown: v.shown, label: { ...v.label } }))
        fn(list)
        const kept = (doc === null || doc === undefined ? [] : doc.entries).filter((e) => !rows.some((r) => r.id === e.id))
        const entries = list.map((v) => ({ id: v.id, shown: v.shown, order: 0, ...(Object.keys(v.label).length > 0 ? { label: v.label } : {}) })).concat(kept.map((e) => ({ ...e, order: 0 })))
        entries.forEach((e, i) => { e.order = i })
        const next = menuClean({ entries, unlisted: doc === null || doc === undefined ? 'show' : doc.unlisted, locked: false, surfaces: doc === null || doc === undefined ? undefined : doc.surfaces })
        return next === null || menuIsDefault(next, rows) ? null : next
      }
      // ── The account menu and the Settings pages: the same shown / hidden choice, one entry per item of the registry's `secondary` and `settings` surfaces ──
      /** The entries of a surface this install can draw: [{ id, name, locked, group, groupName }] in the default order. [] when the registry is not there or is too old to know surfaces. */
      const surfaceRows = (surface) => {
        const r = menuRegistry()
        const spec = MENU_SURFACES[surface]
        if (r === null || spec === undefined || r.hooks === undefined || r.hooks === null || typeof r.hooks[surface] !== 'string') return []
        try {
          const list = r.list(surface)
          return (Array.isArray(list) ? list : []).filter((x) => x !== null && typeof x === 'object' && typeof x.id === 'string' && MENU_ID.test(x.id) && typeof x.name === 'string')
            .slice(0, spec.max).map((x) => ({ id: x.id, name: x.name, locked: x.locked === true || spec.never.indexOf(x.id) >= 0, group: typeof x.group === 'string' ? x.group : '', groupName: typeof x.groupName === 'string' ? x.groupName : '' }))
        } catch (e) { return [] }
      }
      /** The entries of a surface as the person sees them for an arrangement: `rows` plus `shown` (a locked entry is always shown; a listed one follows its entry; the rest follow `unlisted`). */
      const surfaceView = (doc, surface, rows) => {
        const s = doc === null || doc === undefined || doc.surfaces === undefined || doc.surfaces[surface] === undefined ? null : doc.surfaces[surface]
        const byId = new Map((s === null ? [] : s.entries).map((e) => [e.id, e.shown]))
        return rows.map((r) => ({ ...r, shown: r.locked ? true : (byId.has(r.id) ? byId.get(r.id) : !(s !== null && s.unlisted === 'hide')) }))
      }
      /**
       * An edit of one surface: `fn` gets [{ id, shown, locked }] (in the registry's order) and changes it in place; the answer is the new FULL arrangement (the main menu and the other surface
       * untouched), or null when it is the default menu. A listed entry this install does not have is kept. A locked arrangement is left alone (`undefined` = refused).
       */
      const surfaceEdit = (doc, surface, rows, mainRows, fn) => {
        if (doc !== null && doc !== undefined && doc.locked === true) return undefined
        const list = surfaceView(doc, surface, rows).map((v) => ({ id: v.id, shown: v.shown, locked: v.locked }))
        fn(list)
        const old = doc === null || doc === undefined || doc.surfaces === undefined || doc.surfaces[surface] === undefined ? null : doc.surfaces[surface]
        const kept = (old === null ? [] : old.entries).filter((e) => !rows.some((r) => r.id === e.id))
        const entries = list.filter((v) => !v.locked).map((v) => ({ id: v.id, shown: v.shown, order: 0 })).concat(kept.map((e) => ({ ...e, order: 0 })))
        entries.forEach((e, i) => { e.order = i })
        const surfaces = { ...(doc === null || doc === undefined || doc.surfaces === undefined ? {} : doc.surfaces), [surface]: { entries, unlisted: old === null ? 'show' : old.unlisted } }
        const next = menuClean({ entries: doc === null || doc === undefined ? [] : doc.entries, unlisted: doc === null || doc === undefined ? 'show' : doc.unlisted, locked: false, surfaces })
        return next === null || menuIsDefault(next, mainRows) ? null : next
      }
      /** Every row shown again, in the page. A locked arrangement stays locked (that is the escape hatch of the person, not the app's). */
      const menuShowAll = (doc, rows) => {
        if (doc === null || doc === undefined) return null
        const surfaces = {}
        MENU_SURFACE_IDS.forEach((k) => { if (doc.surfaces !== undefined && doc.surfaces[k] !== undefined) surfaces[k] = { entries: doc.surfaces[k].entries.map((e) => ({ ...e, shown: true })), unlisted: 'show' } })
        const full = menuClean({ entries: doc.entries.map((e) => ({ ...e, shown: true })), unlisted: 'show', locked: doc.locked === true, surfaces })
        return full === null ? null : (doc.locked === true ? full : (menuIsDefault(full, rows) ? null : full))
      }
      /** The shipped menu arrangements: the default one, and a short menu of two entries (everything else is kept out, by the `unlisted` rule). */
      const MENU_BUILTINS = [
        { id: 'menu-complete', fr: 'Complet', en: 'Complete', menu: null },
        { id: 'menu-simple', fr: 'Simple', en: 'Simple', menu: { entries: [{ id: 'skills', shown: true, order: 0 }, { id: 'deliverables', shown: true, order: 1 }], unlisted: 'hide', locked: false } }
      ]
      /**
       * The presets an APP locks: shipped here, read only. They are never in the library and never in the menu in use, so a person cannot edit, delete, import or forge one; the only way
       * to read one is `window.__KB_THEME_LOCKED__` (below), and the app that applies it (the phone's Kaby mode, through the Kybernos plugin) asks it by id. Each is a MENU DOC with `locked: true`.
       *
       * `locked-simple` is the phone's SIMPLE (the shell's Kaby mode token), the owner's six defaults of 2026-11-22, the menu changed on 2026-11-23 (mockup 2):
       *   1. the menu is the owner's three rows (Automations, Apps, Conversations), as the REAL drawer draws them: `tasks` (the Automations page, which holds the reminders) keeps the registry's own
       *      name « Automations », `connectors` (the Connectors page) is shown under the name « Apps », and the conversations are the drawer's own list (Recents); `kyber` (the Kaby row at the top) is
       *      hidden, the « Kaby » folder under Workspaces and Settings › Kaby are the ways in; every other row of the full app is hidden (`unlisted: hide`). The ids are the registry's
       *      (`window.__KB_MENU_ENTRIES__`), never a Simple-only id;
       *   2. Referral stays in the account menu, locked (it is in the surface's `never`: it cannot even be listed);
       *   3. Help and Send feedback stay;
       *   4. Phone and channels is hidden, and so are the entries that open the web or a team (the list of spaces and its team rows, Create a team, Join, Upgrade, Team settings, Website): the phone's
       *      embedded engine cannot start a team's engine (`dsh_not_found`), so no row of the phone may offer one (the toast of kybernos-cloud stays as the fallback for a path that still opens a team);
       *   5. Settings keeps five pages: Kaby, Memory & Lessons, Theme, Language and About (the app's own parts, « The Kybernos app » of 2026-11-23, are drawn inside About since item 28: kybernos-mobile files them there); General,
       *      Usage, Connectors, and every other page (any added later too) are hidden (`unlisted: hide`). General is the one page a person's own arrangement can never hide (the surface's
       *      `never`); a locked preset is shipped here and read through `lockedMenu`, which is the only path that cleans with `trusted`, so it can hide it. Connectors stays in the MAIN menu, as « Apps »;
       *   6. nothing about the chat's own wording or look (the gear, the time): that stays in Kaby mode; a preset shows or hides entries and, through `options`, turns a behaviour on (touch comfort, the padlock,
       *      `messageActions`: the row under an answer appears on a tap).
       */
      const LOCKED_PRESETS = {
        'locked-simple': {
          name: { fr: 'Simple (téléphone)', en: 'Simple (phone)' },
          // Options are settings of THIS plugin that the preset turns on while the app is in Kaby mode (never stored, never in the person's settings): `touch` is touch comfort (TOUCH_RULES).
          // `appPage` is read by kybernos-mobile (through `window.__KB_THEME_LOCKED__.options`) for the app’s parts that Simple draws inside About (they were the page « The Kybernos app » until item 28): `log: false` does not draw the engine-log card (a developer's card),
          // `computer: 'linked'` draws the computer card only when a computer is really linked (the phone's own engine, or no news yet, says nothing a person needs). Absent or unreadable = everything is drawn,
          // as in the full app, so reversing either is one word here.
          // `padlock` is read by kybernos-cloud (the one that knows whether somebody is signed in): the rows of the drawer it lists carry a padlock while nobody is signed in, and a tap on one opens a one-sentence sheet
          // (« Sign in » / « Not now ») instead of the page. Signed in, or no list, or an unreadable preset = the drawer is exactly the full app's.
          // `messageActions` is read by the Kybernos plugin (the one that draws the row): `'tap'` hides the row under the agent's answers (copy, read aloud, stars, branch, usage, report) until a tap on the answer,
          // and puts its buttons at 44 px (kybernos-mobile). Absent or another word = the row is drawn as in the full app (shown on a phone, on hover on a computer).
          // `presentation` is the layout of the Settings pages (PRES_RULES): menu of rows for the Kaby page, rows opposite their label, « ? Help » named, cards on the page, chips as text, descriptions a page marks behind an « i ».
          options: { touch: true, presentation: { tabsNav: 'list', rowsLayout: 'inline', rowsDescription: 'info', helpButton: 'named', cardsFrame: 'flat', chipsStyle: 'plain', groupTitles: 'hidden', drawerSize: 'large', drawerPanels: 'hidden', composerSize: 'large', newChatCards: 'slider', rating: 'thumbs', messageSize: 'standard' }, appPage: { log: false, computer: 'linked' }, padlock: ['tasks', 'connectors'], messageActions: 'tap' },
          menu: {
            entries: [{ id: 'kyber', shown: false, order: 0 }, { id: 'tasks', shown: true, order: 1 }, { id: 'connectors', shown: true, order: 2, label: { en: 'Apps', fr: 'Apps' } }],
            unlisted: 'hide',
            locked: true,
            surfaces: {
              secondary: {
                entries: [
                  { id: 'spaces', shown: false, order: 0 }, { id: 'create-team', shown: false, order: 1 }, { id: 'join-team', shown: false, order: 2 }, { id: 'plan', shown: true, order: 3 },
                  { id: 'upgrade', shown: false, order: 4 }, { id: 'team-settings', shown: false, order: 5 }, { id: 'appearance', shown: true, order: 6 }, { id: 'phone', shown: false, order: 7 },
                  { id: 'website', shown: false, order: 8 }, { id: 'help', shown: true, order: 9 }, { id: 'feedback', shown: true, order: 10 },
                  // signed out (the account menu's own rows): « Create an account » and « See plans » open the server's web pages (the phone app offers no sign-up, and offers are not for a person with no account); « Sign in » is never hidden
                  { id: 'signup', shown: false, order: 11 }, { id: 'plans', shown: false, order: 12 }
                ],
                unlisted: 'show'
              },
              settings: {
                // General is hidden too (a locked preset is the one reader the surface's `never` does not bind: see `trustedNever`); the phone's Settings opens on the list, and every General setting is
                // one tap away in the full app (« Need more? »), the language and the look have their own pages.
                entries: [{ id: 'general', shown: false, order: 0 }].concat(['kaby', 'memory', 'theme', 'language', 'about'].map((id, i) => ({ id, shown: true, order: i + 1 }))),
                unlisted: 'hide'
              }
            }
          }
        }
      }
      /** A locked preset's options (a fresh copy; `{}` for an id this build does not ship). */
      const lockedOptions = (id) => (typeof id === 'string' && Object.prototype.hasOwnProperty.call(LOCKED_PRESETS, id) ? JSON.parse(JSON.stringify(LOCKED_PRESETS[id].options)) : {})
      /** True when the phone's Simple preset turns touch comfort on. */
      const lockedTouch = () => lockedOptions('locked-simple').touch === true
      /** The Settings-page layout the phone's Simple preset asks for (`{}` when it asks for none). */
      const lockedPresentation = () => { const p = lockedOptions('locked-simple').presentation; return p !== null && typeof p === 'object' ? p : {} }
      /** A locked preset's arrangement (a fresh, checked copy: nothing a caller does to it reaches the table), or null for an id this build does not ship. */
      const lockedMenu = (id) => (typeof id === 'string' && Object.prototype.hasOwnProperty.call(LOCKED_PRESETS, id) ? menuClean(JSON.parse(JSON.stringify(LOCKED_PRESETS[id].menu)), true) : null)
      /** What an arrangement does to the menu, in short lines for the person ("Shows 4 of 7 entries", "Renamed: …"). */
      const menuLines = (doc, rows) => {
        if (doc === null || doc === undefined) return [kt('Toutes les entrées, dans l’ordre habituel.', 'Every entry, in the usual order.')]
        const v = menuView(doc, rows)
        const shown = v.filter((x) => x.shown)
        const hidden = v.filter((x) => !x.shown)
        const lines = [kt('Montre ' + shown.length + ' entrée' + (shown.length === 1 ? '' : 's') + ' sur ' + v.length, 'Shows ' + shown.length + ' of ' + v.length + ' entries')]
        if (hidden.length > 0 && hidden.length <= 4) lines.push(kt('Cache : ', 'Hides: ') + hidden.map((x) => x.base).join(', '))
        const renamed = v.filter((x) => x.name !== x.base)
        if (renamed.length > 0) lines.push(kt('Renommé : ', 'Renamed: ') + renamed.slice(0, 3).map((x) => x.base + ' → ' + x.name).join(', '))
        if (!v.every((x, i) => x.id === rows[i].id)) lines.push(kt('Ordre changé', 'Order changed'))
        if (doc.unlisted === 'hide') lines.push(kt('Les entrées ajoutées plus tard restent cachées.', 'Entries added later stay hidden.'))
        // The other two places, in one line each: how many entries are hidden there, or that only the listed ones show.
        const where = { secondary: [kt('Menu du compte', 'Account menu'), 'secondary'], settings: [kt('Réglages', 'Settings'), 'settings'] }
        MENU_SURFACE_IDS.forEach((k) => {
          const sf = doc.surfaces === undefined ? undefined : doc.surfaces[k]
          if (sf === undefined) return
          const n = sf.entries.filter((e) => !e.shown).length
          if (sf.unlisted === 'hide') lines.push(where[k][0] + kt(' : seules les pages listées sont montrées (' + sf.entries.filter((e) => e.shown).length + ').', ': only the listed entries show (' + sf.entries.filter((e) => e.shown).length + ').'))
          else if (n > 0) lines.push(where[k][0] + kt(' : cache ' + n + (n === 1 ? ' entrée.' : ' entrées.'), ': hides ' + n + (n === 1 ? ' entry.' : ' entries.')))
        })
        return lines
      }

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
        if (rec.settings !== undefined) doc.settings = rec.settings
        if (rec.menu !== undefined) doc.menu = rec.menu
        return JSON.stringify(doc, null, 2)
      }
      /**
       * The text of a file → { ok, name, settings, menu, legacy, author, droppedA11y } or { ok:false, error }. A file carries an appearance part, a menu part, or both; an old
       * export (the whole look, no frame) still imports: as an appearance. What comes from a file never carries the person's accessibility settings: they are dropped here.
       */
      const presetFromFileText = (text) => {
        if (typeof text !== 'string' || text.length === 0 || text.length > PRESET_FILE_MAX) return { ok: false, error: 'size' }
        let raw = null
        try { raw = JSON.parse(text) } catch (e) { return { ok: false, error: 'json' } }
        if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'shape' }
        const framed = raw.format === PRESET_FORMAT
        let settings = presetSettings(framed ? raw.settings : raw)
        const menuRaw = framed && raw.menu !== undefined && raw.menu !== null ? menuClean(raw.menu) : null
        const menu = menuHasContent(menuRaw) ? menuRaw : null
        let droppedA11y = false
        if (settings !== null) {
          PRESET_GROUPS.a11y.forEach((k) => { if (settings[k] !== undefined) { delete settings[k]; droppedA11y = true } })
          if (Object.keys(settings).length === 0) settings = null
        }
        if (settings === null && menu === null) return { ok: false, error: 'empty' }
        const name = framed ? presetName(raw.name) : ''
        return { ok: true, name: name === '' ? kt('Préréglage importé', 'Imported preset') : name, settings: settings === null ? undefined : settings, menu: menu === null ? undefined : menu, legacy: !framed, droppedA11y, author: framed && typeof raw.author === 'string' ? raw.author : undefined }
      }

      // “Modified” = a setting this theme retains has moved. The mode is left out on purpose: DSH's own
      // light/dark button changes it from elsewhere, and that is not editing the theme.
      const settingText = (v) => JSON.stringify(v !== null && typeof v === 'object' ? Object.keys(v).sort().map((k) => [k, v[k]]) : v).toLowerCase()
      const settingsDirty = (S, settings) => Object.keys(settings).some((k) => k !== 'mode' && settingText(S[k]) !== settingText(settings[k]))
      /** What a shipped theme sets, in the same shape as a library theme's settings. */
      const skinSettings = (sk) => { const p = skinPatch(sk); delete p.skin; return p }
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
      //   Installing puts a copy in Mine (source “gallery”, with its catalogue id and version);
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
        panneau: ['Panneau', 'LED panel'], sakura: ['Sakura', 'Sakura'], 'neutre-violet': ['Neutre violet', 'Neutral violet'],
        'cabinet-avocats': ['Cabinet d’avocats', 'Law firm'], 'cabinet-medical': ['Cabinet médical', 'Medical practice'], 'e-commerce': ['E-commerce', 'E-commerce'],
        education: ['Éducation', 'Education'], 'immobilier-locatif': ['Immobilier locatif', 'Rental property'], 'recrutement-ssii': ['Recrutement SSII', 'IT recruitment']
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
      // 4e. THE SEAM — `window.__KB_THEME_APPLY__`, the one public "apply a
      //     style preset" door (A1-theme-seam). A preset is DATA: an id, or a
      //     bag of known settings. An id already in « My styles » is applied as
      //     it is; a NEW one is an import and goes through the host entry, which
      //     is the only writer of the disk copy from an import. The look applied
      //     is a non-transient commit: merged over the stored look, stored, then
      //     drawn. Nothing here is ever executed.
      // ══════════════════════════════════════════════════════════════════════

      /** The name a settings bag gets in « My styles » (A1-2): a localized default, never a name invented by a caller. */
      const seamName = () => kt('Mon style', 'My style')
      /** One record put in the browser library WITHOUT pushing the whole document: the host already has it (A1-1..A1-3). */
      const seamAdopt = (rec) => {
        lib.presets = lib.presets.filter((p) => p.id !== rec.id).concat([rec]).slice(0, PRESET_LIMIT)
        lib.updatedAt = Math.max(Date.now(), lib.updatedAt + 1)
        libWrite(); libNotify()
      }
      /**
       * Why a host answer refuses the import, or null when it does not: a 400 is authoritative (a11y, invalid
       * value, full library), while off, unreachable and a 5xx are not a failure of applying (A1-3).
       */
      const seamRefusal = (j) => {
        if (j === null || typeof j !== 'object') return 'no answer'
        if (j.ok === true) return null
        if (j.unreachable === true) return null
        if (typeof j.status === 'number' && j.status >= 500) return null
        return typeof j.error === 'string' && j.error !== '' ? j.error : 'refused'
      }
      /** The commit of a preset: merged over the stored look, stored (which posts the boot sheet), then drawn. */
      const seamApply = (ctx, settings) => {
        const next = { ...readState(), ...settings }
        if (writeState(next) !== true) return { ok: false, reason: 'the page could not store the look' }
        const themeSvc = ctx !== null && ctx !== undefined && ctx.theme !== undefined && ctx.theme !== null ? ctx.theme : null
        if (themeSvc !== null) {
          // No `mode` in the preset: the person's light/dark preference is theirs; the rest of the look is applied.
          const drawn = settings.mode === undefined ? { ...next, keepNativeMode: true } : next
          try { appliquerTout(themeSvc, drawn) } catch (e) { return { ok: false, reason: 'the look could not be drawn: ' + String(e !== null && e.message ? e.message : e) } }
        }
        return null
      }
      /** A record already in the library (the person's own theme, or an installed catalogue one): applied as it is, never POSTed. */
      const seamCommit = (ctx, rec) => {
        const r = presetRecord(rec)
        if (r === null) return { ok: false, reason: 'invalid preset' }
        const bad = seamApply(ctx, r.settings)
        return bad !== null ? bad : { ok: true, id: r.id }
      }
      /** The import: the host writes the disk copy, the browser adopts its answer (A1-3 for the fallback). */
      const seamImport = async (ctx, doc) => {
        const j = await libHost({ import: doc })
        const refusal = seamRefusal(j)
        if (refusal !== null) return { ok: false, reason: refusal }
        let rec = null
        if (j.ok === true) {
          rec = presetRecord(j.preset)
          if (rec === null) return { ok: false, reason: 'the host answered an invalid preset' }
        } else {
          // Off, unreachable or a host fault: a local-only row, no disk copy; libPull brings the disk up to date later.
          rec = presetRecord({ id: presetId('u'), name: libFreeName(doc.name), source: 'file', at: Date.now(), settings: doc.settings, gid: doc.gid, v: doc.v, author: doc.author })
          if (rec === null) return { ok: false, reason: 'invalid preset' }
        }
        // The look is applied BEFORE the row is adopted: a look the page could not store leaves no row behind either
        // (the disk copy the host wrote comes back through libPull).
        const bad = seamApply(ctx, rec.settings)
        if (bad !== null) return bad
        seamAdopt(rec)
        return { ok: true, id: rec.id }
      }
      /** A settings bag: known keys and valid values only, never an accessibility key (the person's own business). */
      const seamBag = (ctx, input) => {
        const a11y = PRESET_GROUPS.a11y.filter((k) => Object.prototype.hasOwnProperty.call(input, k))
        if (a11y.length > 0) return { ok: false, reason: 'accessibility setting: ' + a11y[0] }
        const settings = presetSettings(input)
        if (settings === null) return { ok: false, reason: 'no known setting' }
        return seamImport(ctx, { name: seamName(), settings, source: 'file' })
      }
      /** A string id: the library (by id, then by catalogue id), then the shipped gallery — which needs no network. */
      const seamById = async (ctx, wanted) => {
        const own = lib.presets.find((p) => p.id === wanted)
        if (own !== undefined) return seamCommit(ctx, own)
        const installed = galInstalled(wanted)
        if (installed !== null) return seamCommit(ctx, installed)
        if (gal.state !== 'ready' && (await galLoad()) !== true) return { ok: false, reason: 'unknown preset: ' + wanted }
        const theme = (gal.data === null ? [] : gal.data.themes).find((t) => t.id === wanted)
        if (theme === undefined) return { ok: false, reason: 'unknown preset: ' + wanted }
        return seamImport(ctx, { name: theme.name, settings: theme.settings, source: 'gallery', gid: theme.id, v: theme.v, author: theme.author })
      }
      /** The menu a template asks for: a FULL arrangement over the rows of this install, in the order in use, every row shown, only the renamed rows carrying a label. null when it renames nothing. */
      const seamTemplateMenu = (menuLabels) => {
        if (menuLabels === null || typeof menuLabels !== 'object' || Array.isArray(menuLabels)) return null
        const names = Object.keys(menuLabels).filter((id) => MENU_ID.test(id) && MENU_NEVER.indexOf(id) < 0)
        if (names.length === 0) return null
        const rows = menuRows()
        const view = menuView(lib.menu, rows)
        const ids = view.map((v) => v.id).concat(names.filter((id) => !view.some((v) => v.id === id)))
        const entries = ids.map((id, i) => {
          const cur = view.find((v) => v.id === id)
          const label = { ...(cur !== undefined ? cur.label : {}), ...(menuLabels[id] !== null && typeof menuLabels[id] === 'object' ? menuLabels[id] : {}) }
          return { id, shown: true, order: i, ...(Object.keys(label).length > 0 ? { label } : {}) }
        })
        const doc = menuClean({ entries, unlisted: 'show', locked: false })
        return doc !== null && doc.entries.some((e) => e.label !== undefined) ? doc : null
      }
      /**
       * Third form: `{ preset: { name, settings?, menuLabels?, gid?, v?, author? }, apply: { appearance, menu } }` — a template. ONE record is stored
       * (source `template`, its appearance and its menu part), then only the ticked parts are applied; both false = stored, nothing changes. A menu
       * that comes from outside never replaces the person's own without keeping it first in Mine (one click to go back).
       */
      const seamTemplate = async (ctx, input) => {
        const p = input.preset
        const a = input.apply
        if (p === null || typeof p !== 'object' || Array.isArray(p) || typeof p.name !== 'string' || presetName(p.name) === '') return { ok: false, reason: 'a preset with a name is expected' }
        if (a === null || typeof a !== 'object' || Array.isArray(a) || typeof a.appearance !== 'boolean' || typeof a.menu !== 'boolean') return { ok: false, reason: 'apply: { appearance, menu } is expected' }
        if (p.settings !== undefined && p.settings !== null) {
          const bad = PRESET_GROUPS.a11y.filter((k) => p.settings !== null && typeof p.settings === 'object' && Object.prototype.hasOwnProperty.call(p.settings, k))
          if (bad.length > 0) return { ok: false, reason: 'accessibility setting: ' + bad[0] }
        }
        const settings = presetSettings(p.settings)
        const menu = seamTemplateMenu(p.menuLabels)
        if (settings === null && menu === null) return { ok: false, reason: 'nothing to store: no known setting and no menu name' }
        const doc = { name: presetName(p.name), source: 'template' }
        if (settings !== null) doc.settings = settings
        if (menu !== null) doc.menu = menu
        if (typeof p.gid === 'string' && PRESET_ID.test(p.gid)) doc.gid = p.gid
        if (Number.isInteger(p.v) && p.v >= 0 && p.v <= 1000000) doc.v = p.v
        if (typeof p.author === 'string' && p.author.trim() !== '') doc.author = p.author.trim().slice(0, 60)
        const j = await libHost({ import: doc })
        const refusal = seamRefusal(j)
        if (refusal !== null) return { ok: false, reason: refusal }
        const rec = j.ok === true ? presetRecord(j.preset) : presetRecord({ ...doc, id: presetId('t'), name: libFreeName(doc.name), at: Date.now() })
        if (rec === null) return { ok: false, reason: 'the preset could not be stored' }
        if (a.appearance === true && rec.settings !== undefined) {
          const bad = seamApply(ctx, { ...rec.settings, skin: rec.id })
          if (bad !== null) return bad
        }
        seamAdopt(rec)
        if (a.menu === true && rec.menu !== undefined) {
          if (lib.menu !== null && !menuSame(lib.menu, rec.menu)) libAdd(libFreeName(kt('Mon menu', 'My menu')), 'me', undefined, { menu: lib.menu })
          menuUse(rec.menu)
        }
        return { ok: true, id: rec.id }
      }
      /** `window.__KB_THEME_APPLY__(input)`: an id (string) or a settings bag. Never throws, always answers. */
      const seamApplyInput = async (ctx, input) => {
        try {
          if (typeof input === 'string') return await seamById(ctx, input)
          if (input !== null && typeof input === 'object' && !Array.isArray(input) && input.preset !== undefined) return await seamTemplate(ctx, input)
          if (input !== null && typeof input === 'object' && !Array.isArray(input)) return await seamBag(ctx, input)
          return { ok: false, reason: 'a preset id or a settings object is expected' }
        } catch (e) { return { ok: false, reason: String(e !== null && e.message ? e.message : e) } }
      }
      /** One function for the life of the page — a second `apply(ctx)` must not replace a door the wizard already holds — that always
       *  reads the CURRENT context (a re-activation rebinds the services, not the function). */
      let seamFn = null
      let seamCtx = null
      /** `window.__KB_THEME_MODE__(mode?)`: with 'light', 'dark' or 'system' it sets the light/dark preference (the one of the footer's sun/moon, and of the three cards above), and answers `{ ok }`; with nothing it answers the stored
       *  one, or null. It adds no row to « My styles » (an id or a bag given to `__KB_THEME_APPLY__` is an import). Kaby's settings on the phone use it. Never throws. */
      let modeFn = null
      const publierSeam = (ctx) => {
        try {
          seamCtx = ctx
          if (seamFn === null) seamFn = (input) => seamApplyInput(seamCtx, input)
          try { if (window.__KB_THEME_APPLY__ === undefined) window.__KB_THEME_APPLY__ = seamFn } catch (e) { /* outside a browser */ }
          if (modeFn === null) {
            modeFn = (mode) => {
              try {
                if (mode === undefined) { const m = readState().mode; return m === 'light' || m === 'dark' || m === 'system' ? m : null }
                if (mode !== 'light' && mode !== 'dark' && mode !== 'system') return { ok: false, reason: 'light, dark or system is expected' }
                const bad = seamApply(seamCtx, { mode })
                return bad !== null ? bad : { ok: true }
              } catch (e) { return { ok: false, reason: String(e !== null && e.message ? e.message : e) } }
            }
          }
          try { if (window.__KB_THEME_MODE__ === undefined) window.__KB_THEME_MODE__ = modeFn } catch (e) { /* outside a browser */ }
          // The presets an app locks (the phone's Simple): read only, never in the library. Published once and made unwritable, so no other script can stand in for it.
          try {
            if (window.__KB_THEME_LOCKED__ === undefined) {
              Object.defineProperty(window, '__KB_THEME_LOCKED__', { value: Object.freeze({ v: 1, ids: () => Object.keys(LOCKED_PRESETS), get: lockedMenu, options: lockedOptions, name: (id) => (Object.prototype.hasOwnProperty.call(LOCKED_PRESETS, id) ? kt(LOCKED_PRESETS[id].name.fr, LOCKED_PRESETS[id].name.en) : '') }), writable: false, configurable: false, enumerable: false })
              window.dispatchEvent(new CustomEvent('kb-locked-presets-ready'))
            }
          } catch (e) { /* outside a browser, or a page that froze window */ }
          // The menu in use, read only (for tests and for the templates page's "before / after" text): a MENU DOC, or null for the default menu.
          try { if (window.__KB_THEME_MENU__ === undefined) window.__KB_THEME_MENU__ = Object.freeze({ v: 1, current: () => (lib.menu === null ? null : JSON.parse(JSON.stringify(lib.menu))) }) } catch (e) { /* outside a browser */ }
          // The versioned alias, when the page seam exists (docs/dev/plugin-contract.md): additive, re-offered on `kybernos:registry`.
          const offrir = () => { try { if (window.__KB__ !== undefined && window.__KB__ !== null && window.__KB__.version === 1) window.__KB__.provide('kybernos/theme', '1.0.0', { apply: seamFn }) } catch (e) { /* the seam is optional */ } }
          offrir()
          try { window.addEventListener('kybernos:registry', offrir) } catch (e) { /* no events */ }
        } catch (e) {
          try { console.error('[kybernos-theme] apply seam not published', e) } catch (e2) { /* console indisponible */ }
        }
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
.kbth-sub{font-size:14px;line-height:1.55;color:var(--dsw-alias-label-secondary);max-width:640px}
.kbth-seg{display:inline-flex;gap:2px;padding:3px;border-radius:11px;background:var(--dsw-alias-bg-layer-2);width:max-content;max-width:100%;overflow-x:auto}
/* (29/09, on request) Simple/Advanced selector (and Mode) CLEARER: 14px,
   generous padding, active state in the brand colour — nobody has to look
   for the active segment in a grey background any more. */
.kbth-seg button{appearance:none;border:1px solid transparent;font:inherit;font-size:14px;font-weight:500;padding:8px 18px;border-radius:9px;cursor:pointer;background:transparent;color:var(--dsw-alias-label-secondary);transition:background .12s,color .12s,border-color .12s}
.kbth-seg button:hover:not([aria-checked="true"]){background:var(--dsw-alias-interactive-bg-hover)}
.kbth-seg button[aria-checked="true"]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.12)}
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
/* Icon sets: the sample row of the Icons tab. */
.kbth-icset-r{display:flex;gap:6px;color:var(--dsw-alias-label-tertiary)}
.kbth-icset-i{display:inline-flex;width:18px;height:18px}
.kbth-icset-i svg{display:block}
/* (30/09) Dot of the ready-made themes: clean hairline on a light AND dark background
   (1 px at border-l2; the 0.5 px at l3 vanished on light bases),
   discreet depth through an inner shadow — the disc no longer floats.
   corner-shape:round — the shell sets superellipse(1.5) globally (Chrome 139),
   which paints border-radius:50% as a SQUIRCLE: a colour dot must
   read round; the superellipse stays on the shell's surfaces. */
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
.kbth-cat{appearance:none;font:inherit;font-size:12px;padding:3px 10px;border-radius:999px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);transition:background .12s,color .12s}
.kbth-cat{position:relative}
.kbth-cat::before{content:"";position:absolute;inset:-2px 0}
.kbth-cat:hover:not([aria-pressed="true"]){background:var(--dsw-alias-interactive-bg-hover)}
.kbth-cat[aria-pressed="true"]{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}
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
.kbth-empty{font-size:12px;color:var(--dsw-alias-label-tertiary);line-height:1.5;padding:2px 0;max-width:54ch}
/* A pill with a state colour. Not a .kbth-pill: the light-scheme list further down greys every one of those. */
.kbth-tone{font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid var(--tone);color:var(--tone);background:var(--tone-bg,transparent)}
.kbth-tone-on{--tone:var(--kbth-ink,var(--dsw-alias-state-success-primary))}
.kbth-tone-mod{--tone:var(--dsw-alias-state-warn-label);--tone-bg:var(--dsw-alias-state-warn-tertiary)}
.kbth-ok{font-size:12px;color:var(--kbth-ink,var(--dsw-alias-state-success-primary));font-weight:500;line-height:1.45}
.kbth-bad{font-size:12px;color:var(--kbth-ink,var(--dsw-alias-state-error-primary));line-height:1.45}
.kbth-btn.kbth-danger{color:var(--kbth-ink,var(--dsw-alias-state-error-primary))}
.kbth-in.bad{border-color:var(--dsw-alias-state-error-primary)}
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
/* ── Small texts in the LIGHT scheme ────────────────────────────────────────
   DSH colours its discreet texts with label-tertiary (#81858C, 3.7:1 on white) and label-caption
   (#ADB2B8, 2.1:1): below the AA threshold of 4.5:1. On THIS page, in light only, they take
   label-secondary (5.7:1). Dark gains nothing from it and keeps its hierarchy. Measured on the real GUI. */
body:not([data-ds-dark-theme]) :is(.kbth-pr-k,.kbth-sh-fine,.kbth-sel-nm.ph,.kbth-sel-chev,.kbth-sel-grp,.kbth-mr-grip,.kbth-mr-was,.kbth-mr-always,.kbth-mz-cap,.kbth-mr-gh,.kbth-icset-r,.kbth-st-hint,.kbth-st-sub,.kbth-st-cap,.kbth-a11y-hex,.kbth-adv-css,.kbth-card-a,.kbth-card-m,.kbth-src,.kbth-adv-swatch-label,.kbth-disc-s,.kbth-drop,.kbth-empty,.kbth-export-bar,.kbth-fschev,.kbth-fsempty,.kbth-fsmeta,.kbth-fsopt-name,.kbth-grp,.kbth-hex span,.kbth-hint,.kbth-lcard-meta,.kbth-ldp-bar,.kbth-ldp-step,.kbth-lds-ord,.kbth-lds-x,.kbth-lds.empty,.kbth-mx,.kbth-note,.kbth-panel2 p,.kbth-pill,.kbth-ramp-label,.kbth-sec-d,.kbth-sl-vl,.kbth-toggle-hint,.kbth-tok-css,.kbth-tok-hex,.kbth-wchip button){color:var(--dsw-alias-label-secondary)}
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
   The window paints itself with the look's own colours (inline); everything around it speaks Kybernos's tokens. */
.kbth-st{display:flex;flex-direction:column;gap:14px;min-width:0}
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
.kbth-stz:not(.big)::before{content:"";position:absolute;inset:min(0px,calc((100% - 24px) / 2))}
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
.kbth-st-lgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(46px,1fr));gap:6px;padding:4px 2px}
.kbth-st-lt{position:relative;appearance:none;height:46px;padding:0;border-radius:12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);display:grid;place-items:center;cursor:pointer;color:var(--dsw-alias-label-secondary)}
.kbth-st-lt:hover{border-color:var(--dsw-alias-border-l4)}
.kbth-st-lt[aria-pressed="true"]{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary)}
.kbth-st-lt.add{border-style:dashed}
.kbth-st-lt::after{content:attr(data-name);position:absolute;bottom:calc(100% + 4px);left:50%;transform:translateX(-50%);z-index:5;padding:3px 8px;border-radius:7px;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-1);font-size:11px;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .1s}
.kbth-st-lt:hover::after,.kbth-st-lt:focus-visible::after{opacity:1}
.kbth-st-actions .kbth-in{width:auto;flex:1;min-width:150px;max-width:260px}
.kbth-st .kbth-in::placeholder{color:var(--dsw-alias-label-secondary);opacity:1}
.kbth-st .kbth-in{box-sizing:border-box}
.kbth-st-sp{flex:1}
.kbth-st-sec .kbth-link{font-size:12.5px}
.kbth-st-classic>.kbth-foot{padding:0 16px 12px}
.kbth-st-classic{border:1px solid var(--dsw-alias-border-l2);border-radius:14px}
.kbth-st-classic>summary{cursor:pointer;padding:13px 16px;font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}
.kbth-st-classic>summary .kbth-hint{margin-left:6px;font-weight:400}
.kbth-st-classic[open]>summary{border-bottom:1px solid var(--dsw-alias-border-l2)}
.kbth-st-classic>.kbth-sec{padding:16px}
/* ── Presets: ONE section, built-in and mine (a preset can hold the appearance, the menu, or both) ───────── */
.kbth-pr{display:flex;flex-direction:column;gap:12px;min-width:0}
.kbth-pr-strip{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
.kbth-pr-sp{display:flex;align-items:center;gap:8px;min-width:0}
.kbth-pr-k{font-size:11px;font-weight:600;color:var(--dsw-alias-label-tertiary)}
.kbth-pr-v{display:inline-flex;align-items:center;gap:7px;min-width:0;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.kbth-pr-dot{width:14px;height:14px;flex:none;border-radius:50%;box-shadow:0 0 0 1px var(--dsw-alias-border-l3)}
.kbth-pr-rel{position:relative}
.kbth-pr-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px}
.kbth-pr-h{margin:0;font-size:15px;font-weight:700;color:var(--dsw-alias-label-primary)}
.kbth-pr-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
.kbth-pr-tile{position:relative;min-width:0;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
.kbth-pr-tile:hover{border-color:var(--dsw-alias-border-l4)}
.kbth-pr-tile.use{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary)}
.kbth-pr-btn{appearance:none;display:flex;flex-direction:column;width:100%;padding:0;border:0;border-radius:inherit;background:none;font:inherit;color:inherit;text-align:start;cursor:pointer}
.kbth-pr-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.kbth-pr-pv{position:relative;display:flex;align-items:center;justify-content:center;height:58px;overflow:hidden;border-radius:11px 11px 0 0;background:var(--dsw-alias-bg-layer-2)}
.kbth-pr-sb{position:absolute;left:0;top:0;bottom:0;width:30%}
.kbth-pr-ac{position:absolute;left:38%;bottom:13px;width:30%;height:9px;border-radius:5px}
.kbth-pr-mb{display:flex;flex-direction:column;gap:5px;width:46%}
.kbth-pr-mb b{display:block;height:6px;border-radius:3px;background:var(--dsw-alias-label-tertiary);opacity:.55}
.kbth-pr-use{position:absolute;right:6px;bottom:5px;padding:1px 7px;border-radius:999px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground);font-size:10px;font-weight:600}
.kbth-pr-tt{display:flex;flex-direction:column;gap:5px;padding:8px 10px 10px}
.kbth-pr-nm{padding-inline-end:24px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.kbth-pr-tm{display:flex;flex-wrap:wrap;gap:4px}
.kbth-pr-src,.kbth-pr-chip{padding:0 7px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;font-size:10.5px;line-height:1.55;color:var(--dsw-alias-label-secondary)}
.kbth-pr-src.mine{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);color:var(--dsw-alias-label-primary)}
.kbth-pr-more{appearance:none;position:absolute;right:6px;top:62px;width:26px;height:26px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:16px;line-height:1;cursor:pointer}
.kbth-pr-more:hover,.kbth-pr-more[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.kbth-pr-ov{position:absolute;inset:0;z-index:5;display:flex;flex-direction:column;justify-content:center;gap:8px;padding:10px;border:1px solid var(--dsw-alias-border-l4);border-radius:12px;background:var(--dsw-alias-bg-layer-2);font-size:12.5px;color:var(--dsw-alias-label-primary)}
.kbth-pr-row{display:flex;flex-wrap:wrap;gap:6px}
.kbth-pop{position:absolute;z-index:30;top:calc(100% + 6px);right:0;display:flex;flex-direction:column;min-width:190px;padding:5px;border:1px solid var(--dsw-alias-border-l3);border-radius:10px;background:var(--dsw-alias-bg-layer-2);box-shadow:0 10px 28px rgba(0,0,0,.28)}
.kbth-pr-tile>.kbth-pop{top:92px;right:6px}
.kbth-pi{appearance:none;padding:7px 10px;border:0;border-radius:7px;background:none;font:inherit;font-size:13px;text-align:start;color:var(--dsw-alias-label-primary);cursor:pointer}
.kbth-pi:hover,.kbth-pi:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}
.kbth-pi.dng{color:var(--dsw-alias-state-error-primary)}
/* ── The apply sheet and the save sheet (drawn next to the window: the result shows before it is applied) ───────── */
.kbth-sheet{display:flex;flex-direction:column;gap:10px;margin-top:10px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l3);border-radius:16px;background:var(--dsw-alias-bg-layer-1)}
.kbth-sh-hd{display:flex;align-items:center;justify-content:space-between;gap:8px}
.kbth-sh-hd h3{margin:0;font-size:15px;font-weight:700;color:var(--dsw-alias-label-primary)}
.kbth-sh-opt{display:flex;align-items:flex-start;gap:10px;padding:9px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;cursor:pointer}
.kbth-sh-opt:has(input:checked){border-color:var(--dsw-alias-brand-primary)}
.kbth-sh-opt input{flex:none;margin-top:3px}
.kbth-sh-opt b{display:block;font-size:13px;color:var(--dsw-alias-label-primary)}
.kbth-sh-dl{display:block;margin-top:2px;font-size:12px;line-height:1.45;color:var(--dsw-alias-label-secondary)}
.kbth-sh-fine{margin:0;font-size:11.5px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.kbth-sh-btns{display:flex;flex-wrap:wrap;gap:8px}
/* ── One select for five options or more (each option drawn in its own style), segmented control for two to four ───────── */
.kbth-sel{position:relative;display:block;width:100%;max-width:360px}
.kbth-sel-btn{appearance:none;display:flex;align-items:center;gap:9px;width:100%;min-height:36px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-layer-1);font:inherit;font-size:14px;text-align:start;color:var(--dsw-alias-label-primary);cursor:pointer}
.kbth-sel-btn:hover,.kbth-sel.open .kbth-sel-btn{border-color:var(--dsw-alias-border-l4)}
.kbth-sel-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.kbth-sel-nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbth-sel-nm.ph{color:var(--dsw-alias-label-tertiary)}
.kbth-sel-chev{flex:none;color:var(--dsw-alias-label-tertiary)}
.kbth-sel-list{position:absolute;z-index:40;inset-inline:0;top:calc(100% + 4px);max-height:280px;overflow:auto;padding:4px;border:1px solid var(--dsw-alias-border-l3);border-radius:10px;background:var(--dsw-alias-bg-layer-2);box-shadow:0 10px 28px rgba(0,0,0,.28)}
.kbth-sel-grp{padding:8px 8px 3px;font-size:11px;font-weight:600;color:var(--dsw-alias-label-tertiary)}
.kbth-sel-opt{display:flex;align-items:center;gap:9px;min-height:34px;padding:0 8px;border-radius:7px;font-size:14px;color:var(--dsw-alias-label-primary);cursor:pointer}
.kbth-sel-opt[data-act="1"]{background:var(--dsw-alias-interactive-bg-hover)}
.kbth-sel-opt[aria-selected="true"]{box-shadow:inset 3px 0 0 var(--dsw-alias-brand-primary)}
.kbth-sel-sw{display:inline-block;width:16px;height:16px;flex:none;border-radius:50%;box-shadow:0 0 0 1px var(--dsw-alias-border-l3)}
.kbth-sel-sw.wp{border-radius:5px}
.kbth-sel-ic{display:inline-flex;align-items:center;gap:4px;flex:none;color:var(--dsw-alias-label-secondary)}
.kbth-icsets-pv{display:flex;flex-wrap:wrap;align-items:center;gap:16px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary)}
/* ── The Menu panel: the real rows, show or hide, order, a name per language ───────── */
.kbth-mr{display:flex;flex-direction:column;gap:10px;min-width:0}
.kbth-mr-list{display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
.kbth-mr-row{display:flex;flex-direction:column;gap:6px;padding:7px 10px;border-top:1px solid var(--dsw-alias-border-l1)}
.kbth-mr-row:first-child{border-top:0}
.kbth-mr-row.off .kbth-mr-ico,.kbth-mr-row.off .kbth-mr-nm{opacity:.5}
.kbth-mr-row.drag{opacity:.45}
.kbth-mr-main{display:flex;align-items:center;gap:8px;min-width:0}
.kbth-mr-grip{width:14px;flex:none;font-size:13px;letter-spacing:-2px;color:var(--dsw-alias-label-tertiary);cursor:grab;user-select:none}
.kbth-mr-ico{display:inline-flex;width:18px;height:18px;flex:none;color:var(--dsw-alias-label-secondary)}
.kbth-mr-nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13.5px;font-weight:500;color:var(--dsw-alias-label-primary)}
.kbth-mr-was{font-weight:400;color:var(--dsw-alias-label-tertiary)}
.kbth-mr-always{flex:none;font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
.kbth-mr-row.fixed .kbth-mr-nm{color:var(--dsw-alias-label-secondary);font-weight:400}
.kbth-mr-acts{display:inline-flex;align-items:center;gap:4px;flex:none}
.kbth-mr-b{appearance:none;min-width:28px;height:28px;padding:0 6px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);font:inherit;font-size:13px;color:var(--dsw-alias-label-secondary);cursor:pointer}
.kbth-mr-b.txt{padding:0 9px;font-size:12px}
.kbth-mr-b:hover:not(:disabled){border-color:var(--dsw-alias-border-l4);color:var(--dsw-alias-label-primary)}
.kbth-mr-b[aria-expanded="true"]{border-color:var(--dsw-alias-brand-primary)}
.kbth-mr-b:disabled,.kbth-mr .kbth-toggle:disabled{opacity:.4;cursor:default}
.kbth-mr-names{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px;padding:2px 0 4px 40px}
.kbth-mr-names .kbth-hint{grid-column:1/-1}
.kbth-mr-nl{display:flex;flex-direction:column;gap:3px;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.kbth-mr-foot{display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px}
.kbth-mz{display:flex;flex-direction:column;gap:10px;min-width:0}
.kbth-mz>.kbth-seg{align-self:flex-start;max-width:100%;overflow-x:auto}
.kbth-mz-cap{margin:0;font-size:12.5px;line-height:1.45;color:var(--dsw-alias-label-secondary)}
.kbth-mr-blk{display:flex;flex-direction:column;gap:6px}
.kbth-mr-gh{padding:6px 2px 0;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.kbth-mr-always{display:inline-flex;align-items:center;gap:5px}
.kbth-mr-lk{flex:none}
.kbth-mr-unl{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.kbth-st-row1.fixed{margin-top:6px;opacity:.85}
@media (max-width:560px){
.kbth-adv-cols{grid-template-columns:minmax(0,1fr)}
.kbth-adv-tabs{flex-direction:row;overflow-x:auto;overflow-y:hidden;position:static;padding-bottom:4px}
.kbth-adv-tab{flex:0 0 auto}
.kbth-pr-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}
.kbth-pr-tile>.kbth-pop{left:6px;right:6px;min-width:0}
.kbth-pr-strip{gap:8px 12px}
.kbth-mr-names{grid-template-columns:minmax(0,1fr);padding-left:0}
.kbth-mr-b{min-width:32px;height:32px}
.kbth-mr-main{flex-wrap:wrap}
.kbth-mr-nm{flex:1 1 90px}
.kbth-mr-acts{margin-inline-start:auto}
.kbth-sel{max-width:none}
}
[hidden]{display:none!important}

`

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
          if (r.ok !== true) done('err', r.error ? kt('Refusée par Kybernos : ' + r.error + '.', 'Refused by Kybernos: ' + r.error + '.') : kt('Refusée par Kybernos : raison inconnue.', 'Refused by Kybernos: unknown reason.'))
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
            cur !== null ? h('span', null, kt('Animation tirée : ', 'Animation drawn: '), h('b', { style: { color: 'var(--dsw-alias-label-primary)' } }, cur.name)) : h('span', null, kt('Aucune animation choisie : la queue de baleine de Kybernos s’affiche.', 'No animation chosen: the Kybernos whale tail is shown.')),
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
          sel.length === 0 ? h('div', { className: 'kbth-note' }, kt('Rien n’est choisi : Kybernos garde sa queue de baleine.', 'Nothing is chosen: Kybernos keeps its whale tail.')) : null,
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
            h('p', null, kt('Avant usage, Kybernos retire les scripts, les liens externes et les images intégrées du fichier.', 'Before use, Kybernos removes scripts, external links and embedded images from the file.'))),
          h('div', { className: 'kbth-panel2' },
            h('h4', null, kt('Créer avec Claude', 'Create with Claude')),
            h('p', null, kt('Décris l’animation, colle la commande dans le chat : le skill « loader » la dessine et elle apparaît ici toute seule.', 'Describe the animation, paste the command in the chat: the “loader” skill draws it and it appears here by itself.')),
            h('textarea', { className: 'kbth-ta', value: prompt, placeholder: kt('Trois points qui rebondissent, en suivant mon accent', 'Three bouncing dots, following my accent'), 'aria-label': kt('Description de l’animation', 'Animation description'), onInput: (e) => setPrompt(e.target.value) }),
            h('div', { className: 'kbth-codeln' }, h('span', null, '/skill-loader ' + (prompt.trim() === '' ? kt('trois points qui rebondissent', 'three bouncing dots') : prompt.trim())),
              h('button', { type: 'button', className: 'kbth-link', 'data-kb': 'ld-copy', onClick: () => ldCopy('/skill-loader ' + (prompt.trim() === '' ? kt('trois points qui rebondissent', 'three bouncing dots') : prompt.trim()), (ok) => { setCopied(ok ? 'loader' : 'fail'); setWaiting({ kind: 'loader', base: ld.mine.filter((l) => l.source === 'skill').length }) }) }, copied === 'loader' ? kt('Copié', 'Copied') : kt('Copier', 'Copy'))),
            waiting !== null && waiting.kind === 'loader' ? h('div', { className: 'kbth-hint', role: 'status' }, kt('En attente de l’animation… colle la commande dans le chat. Cette fenêtre la détecte seule.', 'Waiting for the animation… paste the command in the chat. This window detects it by itself.')) : null,
            copied === 'fail' ? h('div', { className: 'kbth-hint' }, kt('Copie impossible : sélectionne la commande ci-dessus.', 'Copy failed: select the command above.')) : null))
        const picker = h('div', { className: 'kbth-mdlg', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'kbth-ld-mt', tabIndex: -1, ref: dlg, 'data-kb': 'ld-picker', onKeyDown: (e) => e.stopPropagation() },
          h('div', { className: 'kbth-mhd' }, h('h3', { id: 'kbth-ld-mt' }, kt('Ajouter une animation', 'Add an animation')), h('span', { className: 'kbth-hint' }, String(sel.length), ' ', kt('sur', 'of'), ' ', String(LD_MAX), ' ', kt('dans la rotation', 'in the rotation')),
            h('button', { type: 'button', className: 'kbth-mx', 'aria-label': kt('Fermer', 'Close'), onClick: close }, '×')),
          h('div', { className: 'kbth-mbody' },
            h('div', { className: 'kbth-pills' },
              [['examples', kt('Exemples', 'Examples'), LD_PRESETS.length], ['mine', kt('Mes animations', 'My animations'), ld.mine.length], ['add', kt('Ajouter la tienne', 'Add your own'), null]].map((t) =>
                h('button', { key: t[0], type: 'button', className: 'kbth-cat', 'aria-pressed': tab === t[0] ? 'true' : 'false', 'data-kb': 'ld-tab', 'data-id': t[0], onClick: () => { setTab(t[0]); setNote(null) } }, t[1], t[2] === null ? null : ' (' + t[2] + ')'))),
            note !== null ? h('div', { className: 'kbth-status ' + note.t, role: 'status', 'data-kb': 'ld-note' }, note.text) : null,
            ld.hostState === 'off' && ldHostOn() ? h('div', { className: 'kbth-status warn' }, kt('Le disque de Kybernos ne répond pas : tes importations restent dans ce navigateur jusqu’au rechargement.', 'Kybernos’s disk does not answer: your imports stay in this browser until it reloads.')) : null,
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

      // ══════════════════════════════════════════════════════════════════════
      // 5b-bis. THE SHARED CONTROLS — a compact select (five options or more), a segmented control (two to four), and the menu rows editor.
      //     Options are drawn in their own style (a font in its own typeface, a colour as a dot). Hover or the arrow keys preview in the window
      //     (never in the real interface: a preview is a state of the page, not a commit), Enter keeps, Escape puts back what was there.
      // ══════════════════════════════════════════════════════════════════════

      /** The keyboard of a list: the index a key goes to (Arrow keys, Home, End), or null when the key is not for moving. Pure, pinned by the tests. */
      const selNav = (key, i, n) => {
        if (n <= 0) return null
        if (key === 'ArrowDown') return Math.min(n - 1, i + 1)
        if (key === 'ArrowUp') return Math.max(0, i - 1)
        if (key === 'Home') return 0
        if (key === 'End') return n - 1
        return null
      }
      /** The same for a segmented control: Left / Right (Up / Down too) move to the next segment, without wrapping past the ends. */
      const segNav = (key, i, n) => {
        if (key === 'ArrowRight' || key === 'ArrowDown') return Math.min(n - 1, i + 1)
        if (key === 'ArrowLeft' || key === 'ArrowUp') return Math.max(0, i - 1)
        if (key === 'Home') return 0
        if (key === 'End') return n - 1
        return null
      }

      /** The fonts as select options (grouped, each written in its own typeface). */
      const fontOptions = () => FONTS.map((f, i) => ({ value: f.id, label: f.name, group: i < 15 ? kt('Sans empattement', 'Sans serif') : (i < 22 ? kt('Avec empattement', 'Serif') : kt('Chasse fixe', 'Monospace')), style: f.stack === null ? undefined : { fontFamily: f.stack } }))
      /** The wallpapers as select options, grouped by category, with a swatch. */
      const wallOptions = () => WPS.map((w) => ({ value: w.id, label: w.name, group: w.id === 'none' ? undefined : (WPCATS.find((cat) => cat.id === w.cat) || { name: w.cat }).name, lead: h('i', { className: 'kbth-sel-sw wp', style: w.id === 'none' ? undefined : { background: w.css } }) }))
      /** The icon sets as select options, each with three of its own icons as a sample. */
      const iconSetOptions = () => ICON_SETS.map((st) => ({ value: st.id, label: st[kbLang()], lead: h('span', { className: 'kbth-sel-ic', 'aria-hidden': 'true' }, ['kyber', 'auto', 'skills'].map((e, i) => h('span', { key: e, dangerouslySetInnerHTML: { __html: stIcon(st.id, e, i === 0, 14) } }))) }))

      /**
       * A compact select. props: { id, label, value, options: [{ value, label, group?, style?, lead? }], onPick(value), onPreview(value | null), kb }.
       * The button shows the option in use in its own style; the list is a listbox. Hover or arrow keys call `onPreview(value)`; closing without a choice calls
       * `onPreview(null)`. A choice calls `onPreview(null)` first, then `onPick(value)`: the preview never leaks into what is stored.
       */
      function KbSelect(props) {
        const [open, setOpen] = React.useState(false)
        const [act, setAct] = React.useState(0)
        const box = React.useRef(null)
        const listRef = React.useRef(null)
        const previewed = React.useRef(false)
        const opts = props.options
        const found = opts.findIndex((o) => o.value === props.value)
        const curIdx = Math.max(0, found)
        const preview = (i) => { if (typeof props.onPreview === 'function' && opts[i] !== undefined) { previewed.current = true; props.onPreview(opts[i].value) } }
        const revert = () => { if (previewed.current) { previewed.current = false; if (typeof props.onPreview === 'function') props.onPreview(null) } }
        const shut = () => { setOpen(false); revert() }
        const pick = (i) => {
          const o = opts[i]
          revert(); setOpen(false)
          if (o !== undefined && o.value !== props.value) props.onPick(o.value)
          try { if (box.current !== null) { const b = box.current.querySelector('button.kbth-sel-btn'); if (b !== null && typeof b.focus === 'function') b.focus() } } catch (e) { /* gone */ }
        }
        const openList = () => { setAct(curIdx); setOpen(true) }
        // A press outside the select closes it, and what was previewed goes back.
        React.useEffect(() => {
          if (!open) return undefined
          const down = (e) => { if (box.current !== null && !box.current.contains(e.target)) shut() }
          document.addEventListener('mousedown', down)
          return () => document.removeEventListener('mousedown', down)
        }, [open])
        // Follows the keyboard in a long list.
        React.useEffect(() => {
          if (!open || listRef.current === null) return
          const el = listRef.current.querySelector('[data-act="1"]')
          if (el !== null && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' })
        }, [open, act])
        // Whatever unmounts the select with a preview running puts the window back.
        React.useEffect(() => () => { if (previewed.current) { previewed.current = false; try { if (typeof props.onPreview === 'function') props.onPreview(null) } catch (e) { /* gone */ } } }, [])
        const key = (e) => {
          if (!open) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openList() }
            return
          }
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); shut(); return }
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(act); return }
          if (e.key === 'Tab') { shut(); return }
          const next = selNav(e.key, act, opts.length)
          if (next !== null) { e.preventDefault(); setAct(next); preview(next) }
        }
        const cur = found >= 0 ? opts[found] : null // a value that is not in the list (a preset's own id, say) shows the placeholder, never the first option
        const lid = 'kbth-sel-' + props.id
        let lastGroup = null
        const items = []
        opts.forEach((o, i) => {
          if (o.group !== undefined && o.group !== lastGroup) { lastGroup = o.group; items.push(h('div', { key: 'g:' + o.group, className: 'kbth-sel-grp', role: 'presentation' }, o.group)) }
          items.push(h('div', {
            key: String(o.value), id: lid + '-' + i, role: 'option', className: 'kbth-sel-opt', 'aria-selected': o.value === props.value ? 'true' : 'false', 'data-act': i === act ? '1' : '0', 'data-value': String(o.value), 'data-kb': 'theme-sel-opt',
            style: o.style,
            onMouseDown: (e) => e.preventDefault(),
            onMouseEnter: () => { setAct(i); preview(i) },
            onClick: () => pick(i)
          }, o.lead !== undefined ? o.lead : null, h('span', { className: 'kbth-sel-nm' }, o.label)))
        })
        return h('div', { className: 'kbth-sel' + (open ? ' open' : ''), ref: box, 'data-kb': props.kb || 'theme-sel' },
          h('button', {
            type: 'button', className: 'kbth-sel-btn', role: 'combobox', 'aria-haspopup': 'listbox', 'aria-expanded': open ? 'true' : 'false', 'aria-controls': lid, 'aria-label': props.label,
            'aria-activedescendant': open ? lid + '-' + act : undefined, 'data-value': String(cur === null ? '' : cur.value), style: cur === null ? undefined : cur.style,
            onClick: () => { if (open) shut(); else openList() }, onKeyDown: key
          }, cur !== null && cur.lead !== undefined ? cur.lead : null, h('span', { className: 'kbth-sel-nm' + (cur === null ? ' ph' : '') }, cur === null ? (props.placeholder === undefined ? '' : props.placeholder) : cur.label),
          h('svg', { className: 'kbth-sel-chev', width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' }, h('path', { d: open ? 'M3.5 10.5 8 6l4.5 4.5' : 'M3.5 5.5 8 10l4.5-4.5', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }))),
          open ? h('div', { className: 'kbth-sel-list', id: lid, role: 'listbox', 'aria-label': props.label, ref: listRef, onMouseLeave: () => revert() }, items) : null)
      }

      /**
       * A segmented control (two to four options): a radio group, Left / Right move the choice, hover or focus previews it through `opts.pv`
       * (`{ on(id), off() }`, optional). items: [{ id, label, on, tap, style? }].
       */
      const seg = (opts) => h('div', {
        className: 'kbth-seg', role: 'radiogroup', 'aria-label': opts.label, 'data-kb': opts.kb,
        onKeyDown: (e) => {
          const i = opts.items.findIndex((it) => it.on === true)
          const next = segNav(e.key, i < 0 ? 0 : i, opts.items.length)
          if (next === null || next === i) return
          e.preventDefault(); e.stopPropagation()
          if (opts.pv !== undefined) opts.pv.off()
          opts.items[next].tap()
          try { const kids = e.currentTarget.children; if (kids[next] !== undefined && typeof kids[next].focus === 'function') kids[next].focus() } catch (er) { /* gone */ }
        }
      }, opts.items.map((it, i) => h('button', {
        key: it.id, type: 'button', role: 'radio', 'aria-checked': it.on === true ? 'true' : 'false', 'data-id': it.id,
        tabIndex: it.on === true || (i === 0 && !opts.items.some((x) => x.on === true)) ? 0 : -1, style: it.style,
        onClick: () => { if (opts.pv !== undefined) opts.pv.off(); it.tap() },
        onMouseEnter: opts.pv !== undefined && it.on !== true ? () => opts.pv.on(it.id) : undefined, onMouseLeave: opts.pv !== undefined ? () => opts.pv.off() : undefined,
        onFocus: opts.pv !== undefined && it.on !== true ? () => opts.pv.on(it.id) : undefined, onBlur: opts.pv !== undefined ? () => opts.pv.off() : undefined
      }, it.label)))

      /**
       * The rows of the menu: show or hide, order (drag, or the arrows), a name per language. props: { rows, doc, edit(fn), showAll(), setUnlisted(v), compact }.
       * `rows` are the rows of this install (the registry's), `doc` the arrangement in use; the host's own rows (Workspaces, Settings, the account) are drawn
       * after them and cannot be hidden. A locked arrangement (set by an app) is read-only here, except « Show every entry ».
       */
      function MenuRows(props) {
        const [drag, setDrag] = React.useState(null)
        const [naming, setNaming] = React.useState(null)
        const view = menuView(props.doc, props.rows)
        const locked = props.doc !== null && props.doc !== undefined && props.doc.locked === true
        const allShown = view.every((v) => v.shown) && (props.doc === null || props.doc === undefined || props.doc.unlisted === 'show') && props.surfacesShown !== false
        const move = (id, to) => props.edit((list) => {
          const from = list.findIndex((x) => x.id === id)
          if (from < 0 || to < 0 || to >= list.length || from === to) return
          const item = list.splice(from, 1)[0]
          list.splice(to, 0, item)
        })
        const setShown = (id, shown) => props.edit((list) => { const x = list.find((y) => y.id === id); if (x !== undefined) x.shown = shown })
        const setLabel = (id, lng, text) => props.edit((list) => {
          const x = list.find((y) => y.id === id)
          if (x === undefined) return
          const t = menuText(text)
          if (t === '' || t.length > MENU_LABEL_MAX || /[<>]/.test(t)) delete x.label[lng]; else x.label[lng] = t
        })
        if (props.rows.length === 0) {
          return h('div', { className: 'kbth-note', role: 'status', 'data-kb': 'theme-menu-none' }, kt('Le menu n’est pas affiché sur cet écran : ses entrées apparaissent ici dès que Kybernos le dessine.', 'The menu is not drawn on this screen: its entries show up here as soon as Kybernos draws it.'))
        }
        return h('div', { className: 'kbth-mr', 'data-kb': 'theme-menu-rows' },
          locked ? h('div', { className: 'kbth-note', role: 'status', 'data-kb': 'theme-menu-locked' }, kt('Ce menu est réglé par une application : tu peux seulement tout réafficher.', 'This menu is set by an app: you can only show every entry again.')) : null,
          h('div', { className: 'kbth-mr-list', role: 'list' },
            view.map((v, i) => {
              const open = naming === v.id && !locked
              return h('div', { key: v.id, role: 'listitem', className: 'kbth-mr-row' + (v.shown ? '' : ' off') + (drag === v.id ? ' drag' : ''), 'data-kb': 'theme-menu-row', 'data-id': v.id,
                draggable: !locked, onDragStart: (e) => { if (locked) return; setDrag(v.id); try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', v.id) } catch (er) { /* synthetic */ } },
                onDragOver: (e) => { if (drag !== null) e.preventDefault() }, onDragEnd: () => setDrag(null),
                onDrop: (e) => { e.preventDefault(); if (drag !== null && drag !== v.id) move(drag, i); setDrag(null) } },
                h('div', { className: 'kbth-mr-main' },
                  h('span', { className: 'kbth-mr-grip', 'aria-hidden': 'true' }, '⋮⋮'),
                  v.icon !== null ? h('span', { className: 'kbth-mr-ico', 'aria-hidden': 'true', dangerouslySetInnerHTML: { __html: props.icon(v.icon) } }) : h('span', { className: 'kbth-mr-ico', 'aria-hidden': 'true' }),
                  h('span', { className: 'kbth-mr-nm' }, v.name, v.name !== v.base ? h('span', { className: 'kbth-mr-was' }, ' · ' + v.base) : null),
                  h('span', { className: 'kbth-mr-acts' },
                    h('button', { type: 'button', className: 'kbth-mr-b', 'data-kb': 'theme-menu-up', disabled: locked || i === 0, 'aria-label': kt('Monter ', 'Move up ') + v.name, onClick: () => move(v.id, i - 1) }, '↑'),
                    h('button', { type: 'button', className: 'kbth-mr-b', 'data-kb': 'theme-menu-down', disabled: locked || i === view.length - 1, 'aria-label': kt('Descendre ', 'Move down ') + v.name, onClick: () => move(v.id, i + 1) }, '↓'),
                    h('button', { type: 'button', className: 'kbth-mr-b txt', 'data-kb': 'theme-menu-rename', disabled: locked, 'aria-expanded': open ? 'true' : 'false', onClick: () => setNaming(open ? null : v.id) }, kt('Nom', 'Name')),
                    h('button', { type: 'button', className: 'kbth-toggle' + (v.shown ? ' on' : ''), role: 'switch', 'aria-checked': v.shown ? 'true' : 'false', 'aria-label': (v.shown ? kt('Cacher ', 'Hide ') : kt('Afficher ', 'Show ')) + v.name, 'data-kb': 'theme-menu-show', disabled: locked, onClick: () => setShown(v.id, !v.shown) }, h('span', { className: 'kbth-toggle-knob' })))),
                open ? h('div', { className: 'kbth-mr-names', 'data-kb': 'theme-menu-names' },
                  [['en', 'English'], ['fr', 'Français']].map((l) => h('label', { key: l[0], className: 'kbth-mr-nl' }, h('span', null, l[1]),
                    h('input', { className: 'kbth-in', maxLength: MENU_LABEL_MAX, value: v.label[l[0]] === undefined ? '' : v.label[l[0]], placeholder: v.base, 'data-kb': 'theme-menu-name-' + l[0], 'aria-label': v.base + ' · ' + l[1], onInput: (e) => setLabel(v.id, l[0], e.target.value) }))),
                  h('div', { className: 'kbth-hint' }, kt('Laisse vide pour garder le nom d’origine. Chaque langue garde son propre nom.', 'Leave empty to keep the original name. Each language keeps its own name.'))) : null)
            }),
            [kt('Espaces de travail', 'Workspaces'), kt('Réglages et compte', 'Settings and account')].map((nm, i) => h('div', { key: 'fixed' + i, role: 'listitem', className: 'kbth-mr-row fixed', 'data-kb': 'theme-menu-fixed' },
              h('div', { className: 'kbth-mr-main' }, h('span', { className: 'kbth-mr-grip', 'aria-hidden': 'true' }), h('span', { className: 'kbth-mr-ico', 'aria-hidden': 'true' }), h('span', { className: 'kbth-mr-nm' }, nm), h('span', { className: 'kbth-mr-always' }, kt('toujours affiché', 'always shown')))))),
          h('div', { className: 'kbth-mr-foot' },
            h('button', { type: 'button', className: 'kbth-btn', 'data-kb': 'theme-menu-showall', disabled: allShown, onClick: () => props.showAll() }, kt('Tout réafficher', 'Show every entry')),
            props.compact === true || locked ? null : h('div', { className: 'kbth-mr-unl' }, h('span', { className: 'kbth-lb' }, kt('Entrées ajoutées plus tard', 'Entries added later')),
              seg({ label: kt('Entrées ajoutées plus tard', 'Entries added later'), kb: 'theme-menu-unlisted', items: [['show', kt('Affichées', 'Shown')], ['hide', kt('Cachées', 'Hidden')]].map((u) => ({ id: u[0], label: u[1], on: (props.doc === null || props.doc === undefined ? 'show' : props.doc.unlisted) === u[0], tap: () => props.setUnlisted(u[0]) })) }))))
      }

      /** A closed padlock, 12 px, drawn in the text colour. */
      const lockMark = () => h('svg', { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', className: 'kbth-mr-lk' },
        h('rect', { x: 5, y: 11, width: 14, height: 10, rx: 2 }), h('path', { d: 'M8 11V8a4 4 0 0 1 8 0v3' }))
      /**
       * The entries of one surface (the account menu, the Settings pages): a switch per entry, a padlock on the ones that can never be hidden (they open the app's own screens, or are the page
       * Settings opens on), Settings pages under the name of their group. props: { surface, rows, doc, edit(fn), showAll(), allShown }. A locked arrangement (set by an app) is read-only, except « Show every entry ».
       */
      function SurfaceRows(props) {
        const view = surfaceView(props.doc, props.surface, props.rows)
        const locked = props.doc !== null && props.doc !== undefined && props.doc.locked === true
        const setShown = (id, shown) => props.edit((list) => { const x = list.find((y) => y.id === id); if (x !== undefined && x.locked !== true) x.shown = shown })
        const blocks = []
        view.forEach((v) => {
          const last = blocks[blocks.length - 1]
          if (last !== undefined && last.group === v.group) last.items.push(v)
          else blocks.push({ group: v.group, name: typeof v.groupName === 'string' ? v.groupName : '', items: [v] })
        })
        const rowOf = (v) => h('div', { key: v.id, role: 'listitem', className: 'kbth-mr-row' + (v.shown ? '' : ' off') + (v.locked ? ' fixed' : ''), 'data-kb': 'theme-surface-row', 'data-surface': props.surface, 'data-id': v.id },
          h('div', { className: 'kbth-mr-main' },
            h('span', { className: 'kbth-mr-nm' }, v.name),
            v.locked ? h('span', { className: 'kbth-mr-always', 'data-kb': 'theme-surface-locked' }, lockMark(), kt('toujours affiché', 'always shown')) : null,
            h('span', { className: 'kbth-mr-acts' },
              h('button', { type: 'button', className: 'kbth-toggle' + (v.shown ? ' on' : ''), role: 'switch', 'aria-checked': v.shown ? 'true' : 'false', 'aria-label': (v.shown ? kt('Cacher ', 'Hide ') : kt('Afficher ', 'Show ')) + v.name, 'data-kb': 'theme-surface-show', disabled: locked || v.locked, onClick: () => setShown(v.id, !v.shown) }, h('span', { className: 'kbth-toggle-knob' })))))
        return h('div', { className: 'kbth-mr', 'data-kb': 'theme-surface-rows', 'data-surface': props.surface },
          locked ? h('div', { className: 'kbth-note', role: 'status', 'data-kb': 'theme-menu-locked' }, kt('Ce menu est réglé par une application : tu peux seulement tout réafficher.', 'This menu is set by an app: you can only show every entry again.')) : null,
          blocks.map((b, i) => h('div', { key: 'b' + i, className: 'kbth-mr-blk' },
            b.name !== '' ? h('div', { className: 'kbth-mr-gh', 'data-kb': 'theme-surface-group' }, b.name) : null,
            h('div', { className: 'kbth-mr-list', role: 'list', 'aria-label': b.name !== '' ? b.name : undefined }, b.items.map(rowOf)))),
          h('div', { className: 'kbth-mr-foot' },
            h('button', { type: 'button', className: 'kbth-btn', 'data-kb': 'theme-menu-showall', disabled: props.allShown, onClick: () => props.showAll() }, kt('Tout réafficher', 'Show every entry'))))
      }
      /**
       * The three places an arrangement shows or hides entries, one at a time: the menu (its rows: order, names, show or hide), the account menu, the Settings pages. A zone the install cannot draw (an older
       * menu that knows no other surface) is not offered. props: the MenuRows ones, plus `editSurface(surface, fn)`.
       */
      function MenuZones(props) {
        const [zone, setZone] = React.useState('main')
        const rowsOf = { secondary: surfaceRows('secondary'), settings: surfaceRows('settings') }
        const flat = (k) => surfaceView(props.doc, k, rowsOf[k])
        const surfacesShown = MENU_SURFACE_IDS.every((k) => flat(k).every((v) => v.shown) && (props.doc === null || props.doc === undefined || props.doc.surfaces === undefined || props.doc.surfaces[k] === undefined || props.doc.surfaces[k].unlisted === 'show'))
        const mainView = menuView(props.doc, props.rows)
        const allShown = mainView.every((v) => v.shown) && (props.doc === null || props.doc === undefined || props.doc.unlisted === 'show') && surfacesShown
        const zones = [['main', kt('Menu', 'Menu'), mainView.filter((v) => v.shown).length + '/' + mainView.length]]
          .concat([['secondary', kt('Menu du compte', 'Account menu')], ['settings', kt('Pages des Réglages', 'Settings pages')]].filter((z) => rowsOf[z[0]].length > 0).map((z) => [z[0], z[1], flat(z[0]).filter((v) => v.shown).length + '/' + rowsOf[z[0]].length]))
        const cur = zones.some((z) => z[0] === zone) ? zone : 'main'
        const caption = { main: null,
          secondary: kt('Le menu du compte, celui que l’avatar ouvre. Cadenas : l’entrée ouvre un écran propre à l’app et ne peut pas être cachée.', 'The account menu the avatar opens. Padlock: the entry opens one of the app’s own screens and can never be hidden.'),
          settings: kt('Les pages des Réglages, des pages entières : ce qu’il y a dans une page n’a pas de repère, donc ne peut être ni montré ni caché. Général est la page qui s’ouvre en premier : elle reste.', 'The Settings pages, whole pages only: what is inside a page has no hook, so it cannot be shown or hidden. General is the page Settings opens on: it stays.') }[cur]
        return h('div', { className: 'kbth-mz', 'data-kb': 'theme-menu-zones' },
          zones.length > 1 ? seg({ label: kt('Quoi montrer ou cacher', 'What to show or hide'), kb: 'theme-menu-zone', items: zones.map((z) => ({ id: z[0], label: z[1] + ' ' + z[2], on: cur === z[0], tap: () => setZone(z[0]) })) }) : null,
          caption !== null ? h('p', { className: 'kbth-mz-cap', 'data-kb': 'theme-menu-zone-cap' }, caption) : null,
          cur === 'main'
            ? h(MenuRows, { ...props, surfacesShown })
            : h(SurfaceRows, { key: cur, surface: cur, rows: rowsOf[cur], doc: props.doc, edit: (fn) => props.editSurface(cur, fn), showAll: props.showAll, allShown }))
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
      const ST_ZONES = ['mood', 'style', 'accent', 'sidebar', 'wall', 'user', 'agent', 'menu', 'think', 'letters', 'widgets', 'effects', 'access']
      const ST_SIZE_ID = (fs) => (fs <= 13 ? 's' : (fs >= 16 ? 'l' : 'm'))

      /** The keys of a look (what a theme may keep, accessibility excluded: those are needs, not a style). A vibe starts from the defaults of these. */
      const stLookKeys = () => PRESET_KEYS.filter((k) => PRESET_GROUPS.a11y.indexOf(k) < 0)
      /** Six whole looks: a theme, an accent, a font, the tone of the sidebar, icons, how replies are framed, the pills under the message box and the thinking animation + words. */
      const ST_VIBES = [
        { id: 'epure', fr: 'Épuré (Codex)', en: 'Pure (Codex)', dot: '#2563EB', skin: 'epure', set: { mode: 'light', fontText: 'system-ui', fs: 14, radius: 'soft', shadow: 'soft', bubbleUser: 'auto', iconSet: 'classic', wgSessions: false, wgChanges: false, wgUsage: true }, think: 'dots', pack: 'dsh' },
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
        menu: () => ({ state: { iconSet: stPick(ICON_SET_IDS) } }),
        think: () => ({ loop: { sel: [stPick(LD_PRESETS).id], pack: stPick(LD_PACKS).id } }),
        letters: () => ({ state: { fontText: stPick(ST_FONTS)[0], fs: stPick(ST_SIZES)[1] } }),
        effects: () => ({ state: { radius: stPick(ENUMS.radius), shadow: stPick(ENUMS.shadow), glow: Math.random() < 0.3 } })
      }
      /** « Surprise me » of the studio: a coherent draw (the page's own, for mode, accent and wallpaper) and a draw for every other panel. */
      const stSurprise = () => {
        const state = { ...surprendre() }
        const loop = {}
        ;['menu', 'letters', 'sidebar', 'user', 'agent', 'think', 'effects'].forEach((z) => { const r = ST_RAND[z](); Object.assign(state, r.state || {}); Object.assign(loop, r.loop || {}) })
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
        try { svg = entry === null || entry === undefined ? null : (setId === 'classic' ? (typeof window.__KB_MENU_CLASSIC__ === 'function' ? window.__KB_MENU_CLASSIC__(entry, size) : null) : iconSvg(setId, entry, on, size)) } catch (e) { svg = null }
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
        const menuP = props.menu !== undefined ? props.menu : { rows: [], doc: null, pvDoc: undefined, edit: () => {}, editSurface: () => {}, showAll: () => {}, setUnlisted: () => {} }
        const [zoneOn, setZone] = React.useState(props.initialZone === undefined ? null : props.initialZone)
        const [more, setMore] = React.useState({})
        const [mixOn, setMixOn] = React.useState(ld.S.sel.length > 1)
        const [menuTab, setMenuTab] = React.useState('rows')
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
        // A preview is a state of the page (the window draws it), never a commit: `pvOf(key)` is the hover / arrow-key preview of one setting.
        const preview = typeof props.preview === 'function' ? props.preview : () => {}
        const pvOf = (key) => (v) => preview(v === null ? null : { [key]: v })
        const pvSeg = (key) => ({ on: (id) => preview({ [key]: id }), off: () => preview(null) })
        const dice = (z) => (ST_RAND[z] === undefined ? null : h('button', { type: 'button', className: 'kbth-st-ic', 'data-kb': 'theme-dice', 'aria-label': say('Tirer au sort pour ce panneau', 'Draw one at random for this panel'), title: say('Au hasard', 'Random'), onClick: () => apply(ST_RAND[z]()) },
          h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' }, h('rect', { x: 2, y: 2, width: 12, height: 12, rx: 3, stroke: 'currentColor', strokeWidth: 1.3 }), [[5.2, 5.2], [10.8, 5.2], [8, 8], [5.2, 10.8], [10.8, 10.8]].map((p, i) => h('circle', { key: i, cx: p[0], cy: p[1], r: 0.95, fill: 'currentColor' }))))
        )

        // ── small builders ────────────────────────────────────────────────
        const sub = (t) => h('div', { className: 'kbth-st-sub' }, t)
        const cap = (t) => h('p', { className: 'kbth-st-cap' }, t)
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
          seg({ label: say('Clair ou sombre ?', 'Light or dark?'), kb: 'theme-st-mood', items: [['light', say('Clair', 'Light')], ['dark', say('Sombre', 'Dark')], ['system', say('Système', 'System')]].map((m) => ({ id: m[0], label: m[1], on: S.mode === m[0], tap: () => commit({ mode: m[0] }) })) }),
          cap(say('S’applique à toute l’interface. « Système » suit le réglage de ton appareil.', 'Applies to the whole interface. “System” follows your device setting.'))
        ]

        // ── style ─────────────────────────────────────────────────────────
        const skinTheme = (sk) => makeTheme(sk.mode === null || sk.mode === undefined ? (dark ? 'dark' : 'light') : sk.mode, { acc: sk.acc, ov: sk.ov || {}, lvl: 0, cb: false, tint: 0, dom: '', sideTone: 'auto' })
        const skinOpts = SKINS.map((sk) => ({ value: sk.id, label: sk.name, lead: h('i', { className: 'kbth-sel-sw', style: { background: skinTheme(sk).base, boxShadow: 'inset 0 0 0 4px ' + (skinAccent(sk) || skinTheme(sk).brand) } }) }))
        const stylePanel = () => [
          h('div', { key: 'sel', className: 'kbth-row' }, h('span', { className: 'kbth-lb' }, say('Style', 'Style')),
            h(KbSelect, { id: 'style', kb: 'theme-st-style', label: say('Style', 'Style'), value: S.skin, options: skinOpts, placeholder: say('Personnalisé', 'Custom'), onPick: (id) => { const sk = SKINS.find((x) => x.id === id); if (sk !== undefined) props.applySkin(sk) }, onPreview: (id) => { const sk = id === null ? undefined : SKINS.find((x) => x.id === id); preview(sk === undefined ? null : skinPatch(sk)) } })),
          cap(say(SKINS.length + ' styles livrés avec Kybernos. Les tiens sont dans les préréglages.', SKINS.length + ' styles shipped with Kybernos. Yours are in the presets.')),
          h('div', { key: 'gal', className: 'kbth-st-row' }, h('button', { type: 'button', className: 'kbth-link', onClick: () => props.openClassic('galerie') }, say('Plus de styles : la galerie', 'More styles: the gallery')))
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
          seg({ label: say('Ton de la barre latérale', 'Sidebar tone'), kb: 'theme-st-side', pv: pvSeg('sideTone'), items: ENUMS.sideTone.map((t) => ({ id: t, label: sideNames[t], on: S.sideTone === t, tap: () => commit({ sideTone: t }) })) }),
          wpOn ? sl(say('Transparence', 'See-through'), 0, 100, S.sidebarOpacity, S.sidebarOpacity + ' %', (v) => commit({ sidebarOpacity: v }), S.sidebarLinked ? undefined : say('Activé dans « Plus d’options ».', 'Switched on under “More options”.'))
            : cap(say('Choisis un arrière-plan pour qu’il se voie à travers la barre latérale.', 'Pick a wallpaper to let it show through the sidebar.')),
          ldToggle(say('Barres au survol', 'Bars on hover'), S.autoHideBars, () => commit({ autoHideBars: !S.autoHideBars }), say('Le rail replié et la barre du haut du chat se cachent, et reviennent quand tu approches le bord de la fenêtre. La languette sous le bord du haut, ou Ctrl/⌘+Maj+H, épingle la barre ou la laisse se cacher.', 'The collapsed rail and the chat’s top bar hide, and come back when you reach for the edge of the window. The tab under the top edge, or Ctrl/⌘+Shift+H, pins the bar or lets it hide.')),
          moreBox('sidebar', [
            ldToggle(say('Laisser voir le fond', 'Let the wallpaper show'), S.sidebarLinked, () => commit({ sidebarLinked: !S.sidebarLinked }), say('Désactivé, la barre latérale reste pleine.', 'When off, the sidebar stays solid.')),
            sl(say('Flou derrière', 'Blur behind'), 0, 40, S.glassBlur, S.glassBlur + ' px', (v) => commit({ glassBlur: v }), wpOn ? undefined : themeNeeds),
            ldToggle(say('Logo et nom', 'Logo and name'), S.showBrand, () => commit({ showBrand: !S.showBrand }), say('Dans la barre latérale et sur l’accueil.', 'In the sidebar and on the home screen.'))
          ])
        ]

        // ── wallpaper ─────────────────────────────────────────────────────
        const wpOpts = wallOptions()
        const wallPanel = () => [
          h('div', { key: 'sel', className: 'kbth-row' }, h('span', { className: 'kbth-lb' }, say('Arrière-plan', 'Wallpaper')),
            h(KbSelect, { id: 'wall', kb: 'theme-st-wall', label: say('Arrière-plan', 'Wallpaper'), value: S.wp, options: wpOpts, onPick: (id) => commit({ wp: id }), onPreview: pvOf('wp') })),
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
        const bubbleNames = { auto: say('Auto (Kybernos)', 'Auto (Kybernos)'), accent: say('Accent', 'Accent'), soft: say('Doux', 'Soft'), dark: say('Sombre', 'Dark') }
        const userPanel = () => [
          sub(say('Couleur de la bulle', 'Bubble color')),
          seg({ label: say('Couleur de la bulle', 'Bubble color'), kb: 'theme-st-bubble', pv: pvSeg('bubbleUser'), items: BUBBLE_CHOICES.map((b) => ({ id: b, label: bubbleNames[b], on: S.bubbleUser === b, tap: () => commit({ bubbleUser: b }) })) }),
          h('div', { className: 'kbth-st-row' }, anyColor(validHex(S.bubbleUser) ? S.bubbleUser : dshBubble, validHex(S.bubbleUser), (v) => commit({ bubbleUser: toHex(HEX(v)) }), say('Une autre couleur', 'Any color'))),
          sub(say('Couleur du texte', 'Text color')),
          swatches([null].concat(ST_INKS), S.textUser, (col) => commit({ textUser: col }), say('Auto (suit l’application)', 'Auto (follows the app)')),
          moreBox('user', [cap(say('La bulle utilise le réglage de couleur propre à Kybernos. La couleur du texte ne s’applique qu’à tes messages : le reste de l’application garde la sienne.', 'The bubble uses Kybernos’s own color setting. The text color applies to your messages only: the rest of the app keeps its own.'))])
        ]
        const replyNames = { none: say('Aucun (Kybernos)', 'None (Kybernos)'), card: say('Carte', 'Card'), outline: say('Contour', 'Outline'), tint: say('Teinte', 'Tinted') }
        const agentPanel = () => [
          sub(say('Fond de la réponse', 'Reply background')),
          seg({ label: say('Fond de la réponse', 'Reply background'), kb: 'theme-st-reply', pv: pvSeg('replyBg'), items: ENUMS.replyBg.map((b) => ({ id: b, label: replyNames[b], on: S.replyBg === b, tap: () => commit({ replyBg: b }) })) }),
          S.replyBg !== 'none' ? [sub(say('Couleur de la réponse', 'Reply color')), swatches([null].concat(ACCS), S.replyColor, (col) => commit({ replyColor: col }), say('Auto', 'Auto'))] : null,
          sub(say('Couleur du texte', 'Text color')),
          swatches([null].concat(ST_INKS), S.textReply, (col) => commit({ textReply: col }), say('Auto (suit l’application)', 'Auto (follows the app)')),
          moreBox('agent', [cap(say('Kybernos ne dessine aucune bulle autour des réponses de l’agent : un fond ou un contour est ajouté autour de chacune. Si Kybernos renomme le repère qui sert à les trouver, le cadre disparaît et le reste du thème continue de marcher.', 'Kybernos draws no bubble around the agent’s replies: a background or an outline is added around each one. If Kybernos renames the marker used to find them, the frame goes away and the rest of the theme keeps working.'))])
        ]

        // ── the menu: its rows, and the icons they wear ─────────────────────
        const iconOpts = iconSetOptions()
        const iconsPick = () => h('div', { key: 'ics', className: 'kbth-row' }, h('span', { className: 'kbth-lb' }, say('Jeu d’icônes', 'Icon set')),
          h(KbSelect, { id: 'iconset', kb: 'theme-st-icons', label: say('Jeu d’icônes', 'Icon set'), value: S.iconSet, options: iconOpts, onPick: (id) => commit({ iconSet: id }), onPreview: pvOf('iconSet') }))
        const menuPanel = () => [
          seg({ label: say('Panneau du menu', 'Menu panel'), kb: 'theme-st-menutab', items: [['rows', say('Entrées', 'Rows')], ['icons', say('Icônes', 'Icons')]].map((t) => ({ id: t[0], label: t[1], on: menuTab === t[0], tap: () => setMenuTab(t[0]) })) }),
          menuTab === 'rows'
            ? h(MenuZones, { key: 'rows', rows: menuP.rows, doc: menuP.doc, edit: menuP.edit, editSurface: menuP.editSurface, showAll: menuP.showAll, setUnlisted: menuP.setUnlisted, compact: true, icon: (e) => stIcon(S.iconSet, e, false, 16) })
            : [iconsPick(), cap(ICON_SETS.length + say(' jeux, dessinés par le code du plugin.', ' sets, drawn by the plugin’s own code.'))],
          h('div', { key: 'adv', className: 'kbth-st-row' }, h('button', { type: 'button', className: 'kbth-link', 'data-kb': 'theme-st-menu-adv', onClick: () => props.openClassic(menuTab === 'rows' ? 'menu' : 'icones') }, say('Plus de réglages : éditeur avancé', 'More settings: advanced editor')))
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
              loopTile('dsh', null, say('Queue de baleine de Kybernos', 'Kybernos whale tail'), ld.S.sel.length === 0),
              LD_PRESETS.map((l) => loopTile(l.id, l, l.name, ld.S.sel.indexOf(l.id) >= 0)),
              ld.mine.map((l) => loopTile(l.id, l, l.name, ld.S.sel.indexOf(l.id) >= 0)),
              h('label', { className: 'kbth-st-lt add', title: say('Ajouter la tienne (SVG, Lottie, GIF, WebP)', 'Add your own (SVG, Lottie, GIF, WebP)'), 'data-name': say('Ajouter la tienne (SVG, Lottie, GIF, WebP)', 'Add your own (SVG, Lottie, GIF, WebP)') },
                h('svg', { width: 18, height: 18, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' }, h('path', { d: 'M8 3v10M3 8h10', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' })),
                h('input', { type: 'file', accept: '.svg,.json,.gif,.webp,.png', 'data-kb': 'theme-st-addloop', style: { display: 'none' }, 'aria-label': say('Ajouter ta propre animation', 'Add your own animation'), onChange: (e) => { const input = e.target; const f = input.files && input.files[0]; if (f) importLoop(f); input.value = '' } }))),
            note !== null ? h('div', { className: note.ok ? 'kbth-ok kbth-gr-ok' : 'kbth-bad kbth-gr-err', role: 'status', 'data-kb': 'theme-st-note' }, note.text) : null,
            cap(say('Choisie : ', 'Selected: ') + (selNames.length > 0 ? selNames.join(', ') : say('queue de baleine de Kybernos', 'Kybernos whale tail')) + say(' · survole une vignette pour son nom', ' · hover a tile for its name')),
            h('div', { className: 'kbth-row' }, h('span', { className: 'kbth-lb' }, say('Mots affichés', 'Words it shows')),
              h(KbSelect, { id: 'pack', kb: 'theme-st-pack', label: say('Mots affichés', 'Words it shows'), value: packs.some((p) => p.id === ld.S.pack) ? ld.S.pack : 'dsh', options: packs.map((p) => ({ value: p.id, label: p.name })), onPick: (id) => loop({ pack: id }) })),
            cap(words.length > 0 ? words.slice(0, 5).join(', ') + (words.length > 5 ? '…' : '') : say('La phrase de Kybernos (« Deep diving… »).', 'Kybernos’s own phrase (“Deep diving…”).')),
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
        const fontOpts = fontOptions()
        const lettersPanel = () => {
          const inkNow = S.ov[inkKey] === undefined ? null : S.ov[inkKey]
          return [
            h('div', { key: 'f', className: 'kbth-row' }, h('span', { className: 'kbth-lb' }, say('Police', 'Font')),
              h(KbSelect, { id: 'font', kb: 'theme-st-font', label: say('Police', 'Font'), value: S.fontText, options: fontOpts, onPick: (id) => commit({ fontText: id }), onPreview: pvOf('fontText') })),
            h('div', { key: 's', className: 'kbth-row' }, h('span', { className: 'kbth-lb' }, say('Taille', 'Size')), seg({ label: say('Taille du texte', 'Text size'), kb: 'theme-st-size', pv: { on: (id) => preview({ fs: ST_SIZES.find((z) => z[0] === id)[1] }), off: () => preview(null) }, items: ST_SIZES.map((z) => ({ id: z[0], label: say(z[2], z[3]), on: ST_SIZE_ID(S.fs) === z[0], tap: () => commit({ fs: z[1] }) })) })),
            cap(say('Une police ne s’affiche que si elle est installée sur ton ordinateur.', 'A font only shows if it is installed on your computer.')),
            moreBox('letters', [
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
          h('div', { className: 'kbth-row' }, h('span', { className: 'kbth-lb' }, say('Coins', 'Corners')), seg({ label: say('Coins', 'Corners'), kb: 'theme-st-radius', pv: pvSeg('radius'), items: [['sharp', say('Nets', 'Sharp')], ['standard', say('Standard', 'Standard')], ['soft', say('Doux', 'Soft')]].map((z) => ({ id: z[0], label: z[1], on: S.radius === z[0], tap: () => commit({ radius: z[0] }) })) })),
          h('div', { className: 'kbth-row' }, h('span', { className: 'kbth-lb' }, say('Ombres', 'Shadows')), seg({ label: say('Ombres', 'Shadows'), kb: 'theme-st-shadow', pv: pvSeg('shadow'), items: [['none', say('Aucune', 'None')], ['soft', say('Douces', 'Soft')]].map((z) => ({ id: z[0], label: z[1], on: S.shadow === z[0], tap: () => commit({ shadow: z[0] }) })) })),
          ldToggle(say('Halo', 'Glow'), S.glow, () => commit({ glow: !S.glow }), say('Une lueur de ta couleur autour de la zone de message.', 'A soft light of your color around the message box.')),
          h('div', { className: 'kbth-row' }, h('span', { className: 'kbth-lb' }, say('Verre', 'Glass')), seg({ items: [['frosted', say('Dépoli', 'Frosted')], ['liquid', 'Liquid glass']].map((z) => ({ id: z[0], label: z[1], on: S.glassEffect === z[0], tap: () => commit({ glassEffect: z[0] }) })) })),
          sl(say('Flou du verre', 'Glass blur'), 0, 40, S.glassBlur, S.glassBlur + ' px', (v) => commit({ glassBlur: v }), wpOn ? undefined : themeNeeds)
        ]
        const accessPanel = () => [
          h('div', { className: 'kbth-row' }, h('span', { className: 'kbth-lb' }, say('Contraste', 'Contrast')), seg({ items: [['standard', 'Standard'], ['plus', say('Renforcé', 'Enhanced')], ['max', say('Maximal', 'Maximum')]].map((z) => ({ id: z[0], label: z[1], on: S.contrastMode === z[0], tap: () => commit({ contrastMode: z[0] }) })) })),
          ldToggle(say('Réduire les animations', 'Reduce animations'), S.reduceMotion, () => commit({ reduceMotion: !S.reduceMotion }), say('Coupe les boucles et les transitions.', 'Turns off loops and transitions.')),
          h('div', { className: 'kbth-row' }, h('span', { className: 'kbth-lb' }, say('Anneau de focus', 'Focus ring')), seg({ items: [['accent', 'Accent'], ['double', 'Double'], ['thick', say('Épais', 'Thick')]].map((z) => ({ id: z[0], label: z[1], on: S.focusRing === z[0], tap: () => commit({ focusRing: z[0] }) })) })),
          ldToggle(say('Cibles de 44 px', '44 px targets'), S.largeTargets, () => commit({ largeTargets: !S.largeTargets }), say('Boutons et champs plus grands.', 'Larger buttons and fields.')),
          ldToggle(say('Confort au doigt', 'Touch comfort'), S.touch, () => commit({ touch: !S.touch }), say('Petit écran : lignes et icônes plus grandes, menus pleine largeur.', 'Small screen: bigger rows and icons, full-width menus.')),
          ldToggle(say('Liens soulignés', 'Underlined links'), S.underlineLinks, () => commit({ underlineLinks: !S.underlineLinks })),
          ldToggle(say('Palette daltonisme', 'Color-blind palette'), S.cbSafe, () => commit({ cbSafe: !S.cbSafe }), say('Succès, alerte et erreur en couleurs plus sûres.', 'Success, warning and error in safer colors.'))
        ]
        const PANELS = {
          mood: [say('Clair ou sombre ?', 'Light or dark?'), moodPanel], style: [say('Choisis un style', 'Pick a style'), stylePanel], accent: [say('Couleur d’accent', 'Accent color'), accentPanel],
          sidebar: [say('Barre latérale', 'Sidebar'), sidebarPanel], wall: [say('Arrière-plan', 'Wallpaper'), wallPanel], user: [say('Tes messages', 'Your messages'), userPanel], agent: [say('Réponses de l’agent', 'Agent replies'), agentPanel],
          menu: [say('Menu', 'Menu'), menuPanel], think: [say('Animation de réflexion', 'Thinking animation'), thinkPanel], letters: [say('Lettres', 'Letters'), lettersPanel],
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
        // The rows of the real menu (the registry's, in the arrangement in use or the one being previewed); five stand-ins when the menu is not drawn here.
        const wRegistry = menuP.rows
        const wRows = wRegistry.length > 0
          ? menuView(menuP.pvDoc !== undefined ? menuP.pvDoc : menuP.doc, wRegistry).filter((v) => v.shown).map((v) => [v.icon, v.name])
          : [['kyber', 'Kaby'], ['dash', say('Tableaux de bord', 'Dashboards')], ['creations', say('Créations', 'Creations')], ['auto', say('Automatisations', 'Automations')], ['skills', say('Compétences', 'Skills')]]
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
            Z('menu', say('Changer le menu : entrées, ordre, noms et icônes', 'Change the menu: entries, order, names and icons'), 'kbth-st-rows big', undefined,
              wRows.map((n, i) => h('div', { key: (n[0] === null ? 'x' : n[0]) + ':' + i, className: 'kbth-st-row1' + (i === 0 ? ' on' : ''), 'data-kb': 'theme-st-winrow', style: i === 0 ? { background: c.navAct, borderRadius: rad(8) } : { borderRadius: rad(8) } },
                h('span', { className: 'kbth-st-ico', style: { color: i === 0 ? c.accText : c.t3 }, dangerouslySetInnerHTML: { __html: stIcon(S.iconSet, n[0], i === 0, 16) } }),
                h('span', { className: 'kbth-st-rn', style: { color: i === 0 ? c.t1 : c.t2 } }, n[1]))),
              wRows.length === 0 ? h('div', { className: 'kbth-st-row1', 'data-kb': 'theme-st-winempty', style: { color: c.t3 } }, say('Toutes les entrées sont cachées', 'Every entry is hidden')) : null,
              h('div', { className: 'kbth-st-row1 fixed', style: { color: c.t3, borderRadius: rad(8) } }, h('span', { className: 'kbth-st-rn' }, say('Espaces de travail', 'Workspaces'))))),
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

        // ══ the chips that open a panel, and the inspector slot (the apply and save sheets of the Presets section) ══
        const also = h('div', { className: 'kbth-st-also', 'data-kb': 'theme-st-also' },
          [['mood', say('Clair ou sombre', 'Light or dark')], ['accent', say('Couleur d’accent', 'Accent color')], ['letters', say('Lettres', 'Letters')], ['wall', say('Arrière-plan', 'Wallpaper')], ['effects', say('Effets et formes', 'Effects and shape')], ['menu', say('Menu', 'Menu')], ['access', say('Accessibilité', 'Accessibility')]].map((z) => h('button', { key: z[0], type: 'button', className: 'kbth-st-chip', 'data-chip': z[0], 'data-kb': 'theme-st-chip', 'aria-pressed': zoneOn === z[0] ? 'true' : 'false', onClick: (e) => { e.stopPropagation(); setZone(zoneOn === z[0] ? null : z[0]) } }, z[1])))
        const hint = h('div', { className: 'kbth-st-hint' }, h('svg', { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'currentColor', 'aria-hidden': 'true' }, h('path', { d: ST_PENCIL })), h('b', null, say('Clique sur ce que tu veux changer', 'Click anything in the window')), say(' dans la fenêtre, ou choisis ci-dessous.', ' to change it, or pick below.'))

        return h('div', { className: 'kbth-st' + (narrow ? ' narrow' : ''), 'data-kb': 'theme-studio' },
          hint,
          h('div', { className: 'kbth-st-stage', ref: stage, 'data-kb': 'theme-st-stage' }, win, props.inspector === undefined ? null : props.inspector, popEl),
          also)
      }
      // <look-studio:end>

      // ══════════════════════════════════════════════════════════════════════
      // 5d. PRESETS — ONE section for everything that can be applied: built-in (the five vibes, two menus, the templates) and mine (saved, imported,
      //     installed from the gallery). A preset changes the appearance, the menu, or both; the person says which, with ticks, before anything changes.
      //     The pure parts (what the list holds, what applying with these ticks does) are functions of their own, pinned by the tests.
      // ══════════════════════════════════════════════════════════════════════

      /** One record of the library as a list item. `guarded`: it comes from outside (a file, the gallery, a template), so its menu is never applied unless ticked. */
      const presetRecItem = (rec) => ({
        key: 'rec:' + rec.id, id: rec.id, kind: 'rec', name: rec.name, src: rec.source === 'template' ? 'template' : 'mine', rec, A: rec.settings !== undefined, M: rec.menu !== undefined,
        ACC: rec.settings !== undefined && PRESET_GROUPS.a11y.some((k) => rec.settings[k] !== undefined), guarded: rec.source !== 'me'
      })
      /** Everything the section lists, in order: the vibes, the two menus, the templates (built-in), then mine. */
      const presetItems = () => {
        const out = []
        ST_VIBES.forEach((v) => out.push({ key: 'vibe:' + v.id, id: v.id, kind: 'vibe', name: kt(v.fr, v.en), src: 'builtin', vibe: v, A: true, M: false, ACC: false, guarded: false }))
        MENU_BUILTINS.forEach((m) => out.push({ key: 'menu:' + m.id, id: m.id, kind: 'menu', name: kt(m.fr, m.en), src: 'builtin', menuDoc: m.menu, A: false, M: true, ACC: false, guarded: false }))
        lib.presets.filter((p) => p.source === 'template').forEach((rec) => out.push(presetRecItem(rec)))
        lib.presets.filter((p) => p.source !== 'template').forEach((rec) => out.push(presetRecItem(rec)))
        return out
      }
      const presetBuiltin = (item) => item.src !== 'mine'
      /** The menu part of an item (a MENU DOC, or null = the default menu), or undefined when it has none. */
      const presetMenuOf = (item) => (item.kind === 'menu' ? item.menuDoc : (item.rec !== undefined ? item.rec.menu : undefined))
      /** The ticks a sheet starts with: the appearance, the menu unless it comes from outside, the accessibility only of the person's own preset. */
      const presetTicks = (item) => ({ tA: item.A, tM: item.M && !item.guarded, tAcc: item.ACC && !item.guarded })
      /**
       * What applying an item with these ticks does: `{ patch, loop, menu, keep }`. `patch`: the settings to commit (a11y keys only when ticked); `loop`: the thinking
       * animation of a vibe; `menu`: undefined (untouched), null (the default menu) or an arrangement; `keep`: the menu in use is the person's own and must be kept in Mine first.
       */
      const presetPlan = (item, ticks, rows) => {
        const plan = { patch: null, loop: null, menu: undefined, keep: false }
        if (ticks.tA === true && item.A) {
          if (item.vibe !== undefined) { const v = stVibePatch(item.vibe); plan.patch = v.state; plan.loop = v.loop }
          else if (item.rec !== undefined && item.rec.settings !== undefined) {
            const st = { ...item.rec.settings }
            if (ticks.tAcc !== true) PRESET_GROUPS.a11y.forEach((k) => { delete st[k] })
            plan.patch = { skin: item.rec.id, ...st }
          }
        }
        if (ticks.tM === true && item.M) {
          const doc = presetMenuOf(item)
          const next = doc === null || doc === undefined || menuIsDefault(doc, rows) ? null : doc
          plan.menu = next
          plan.keep = item.guarded === true && lib.menu !== null && !menuSame(lib.menu, next)
        }
        return plan
      }
      /** A full arrangement of the rows of this install (what « the default menu » means as a preset): every row shown, in the order in use. null when the menu is not drawn here. */
      const menuFull = (doc, rows) => {
        if (rows.length === 0) return doc === null || doc === undefined ? null : doc
        const v = menuView(doc, rows)
        return menuClean({ entries: v.map((x, i) => ({ id: x.id, shown: x.shown, order: i, ...(Object.keys(x.label).length > 0 ? { label: x.label } : {}) })), unlisted: doc === null || doc === undefined ? 'show' : doc.unlisted, locked: false, surfaces: doc === null || doc === undefined ? undefined : doc.surfaces })
      }
      /** Short lines for what the appearance part of an item holds. */
      const presetAppearanceLines = (item) => {
        if (item.vibe !== undefined) return [kt('Couleurs, police, icônes, animation de réflexion.', 'Colors, font, icons, thinking animation.')]
        if (item.rec === undefined || item.rec.settings === undefined) return []
        const g = groupsOf(item.rec.settings)
        return [Object.keys(PRESET_GROUPS).filter((k) => k !== 'a11y' && g[k]).map((k) => groupLabel(k)).join(', ')]
      }
      /** Swatch data for a tile: the colours of the appearance (or a few menu bars), or null. */
      const presetSwatch = (item, dark) => {
        const st = item.vibe !== undefined ? stVibePatch(item.vibe).state : (item.rec !== undefined ? item.rec.settings : undefined)
        if (st === undefined || st === null) return null
        const m = st.mode === 'light' || st.mode === 'dark' ? st.mode : (dark ? 'dark' : 'light')
        const t = makeTheme(m, { acc: st.acc === undefined ? null : st.acc, ov: st.ov || {}, lvl: 0, cb: false, tint: 0, dom: '', sideTone: st.sideTone || 'auto' })
        return { bg: t.base, side: t.side, line: t.t4, accent: st.acc === undefined || st.acc === null ? t.brand : st.acc }
      }

      function PresetsBlock(props) {
        const S = props.S
        const [filter, setFilter] = React.useState('all')
        const [menuFor, setMenuFor] = React.useState(null)
        const [renaming, setRenaming] = React.useState(null)
        const [confirming, setConfirming] = React.useState(null)
        const [resetOpen, setResetOpen] = React.useState(false)
        const rows = props.rows
        const items = presetItems()
        const nBuilt = items.filter(presetBuiltin).length
        const shown = items.filter((it) => filter === 'all' || (filter === 'builtin' ? presetBuiltin(it) : !presetBuiltin(it)))
        const inUse = (it) => {
          const curMenu = lib.menu
          const menuIn = it.M && (it.kind === 'menu' || it.rec !== undefined) && (() => { const d = presetMenuOf(it); return menuSame(d === null || d === undefined || menuIsDefault(d, rows) ? null : d, curMenu) })()
          if (it.vibe !== undefined) return stVibeOn(S, it.vibe)
          if (it.A && !it.M) return it.rec !== undefined && S.skin === it.rec.id
          if (!it.A && it.M) return menuIn === true
          return it.rec !== undefined && S.skin === it.rec.id && menuIn === true
        }
        // The names in the strip: the appearance (a vibe, one of mine, a shipped style, or custom) and the menu (one that is listed, or custom).
        const vibeNow = ST_VIBES.find((v) => stVibeOn(S, v))
        const recNow = lib.presets.find((p) => p.id === S.skin && p.settings !== undefined) || null
        const skinNow = recNow === null ? (SKINS.find((x) => x.id === S.skin) || null) : null
        const aName = vibeNow !== undefined ? kt(vibeNow.fr, vibeNow.en) : (recNow !== null ? recNow.name : (skinNow !== null ? skinNow.name : (estNaturel(S) ? kt('Défaut Kybernos', 'Kybernos default') : kt('Personnalisé', 'Custom'))))
        const aMod = vibeNow === undefined && ((recNow !== null && settingsDirty(S, recNow.settings)) || (recNow === null && skinNow !== null && settingsDirty(S, skinSettings(skinNow))))
        const menuNow = lib.menu
        const mItem = items.filter((it) => !it.A && it.M).concat(items.filter((it) => it.A && it.M)).find((it) => { const d = presetMenuOf(it); return menuSame(d === null || d === undefined || menuIsDefault(d, rows) ? null : d, menuNow) })
        const mName = mItem !== undefined ? mItem.name : kt('Menu personnalisé', 'Custom menu')
        const dotOf = (() => { const t = makeTheme(props.dark ? 'dark' : 'light', optsDe(S)); return 'radial-gradient(circle at 50% 50%,' + (S.acc === null ? t.brand : S.acc) + ' 0 4px,' + t.base + ' 4.5px 100%)' })()

        const open = (it) => {
          setMenuFor(null)
          if (!it.M && !it.ACC) props.apply(it, { tA: true, tM: false, tAcc: false })
          else props.openSheet(it, presetTicks(it))
        }
        const dup = (it) => {
          setMenuFor(null)
          const settings = it.vibe !== undefined ? presetSettings(stVibePatch(it.vibe).state) : (it.rec !== undefined ? it.rec.settings : undefined)
          const doc = presetMenuOf(it)
          const menu = it.M ? (doc === null || doc === undefined ? menuFull(null, rows) : doc) : undefined
          const rec = libAdd(it.name + kt(' (copie)', ' (copy)'), 'me', settings === undefined ? undefined : settings, menu === undefined || menu === null ? undefined : { menu })
          props.say(rec === null ? { ok: false, text: kt('La bibliothèque est pleine (' + PRESET_LIMIT + ' préréglages).', 'The library is full (' + PRESET_LIMIT + ' presets).') } : { ok: true, text: kt('« ' + rec.name + ' » est dans Les miens.', '“' + rec.name + '” is in Mine.') })
        }
        const doRename = () => {
          if (renaming === null) return
          const name = presetName(renaming.text)
          if (name === '') { props.say({ ok: false, text: kt('Donne un nom au préréglage.', 'Give the preset a name.') }); return }
          if (libNameTaken(name, renaming.id)) { props.say({ ok: false, text: kt('Ce nom existe déjà. Choisis-en un autre.', 'That name already exists. Pick another one.') }); return }
          libPatch(renaming.id, { name }); setRenaming(null); props.say(null)
        }
        const exportOne = (it) => {
          setMenuFor(null)
          const ok = downloadText('preset-' + fileSlug(it.name) + '.json', presetFile(it.rec))
          props.say(ok ? { ok: true, text: kt('« ' + it.name + ' » est téléchargé en fichier .json.', '“' + it.name + '” is downloaded as a .json file.') } : { ok: false, text: kt('Le téléchargement a échoué.', 'The download failed.') })
        }

        const tile = (it) => {
          const mine = !presetBuiltin(it)
          const sw = presetSwatch(it, props.dark)
          const used = inUse(it)
          const bars = it.M ? menuView(presetMenuOf(it) === undefined ? null : presetMenuOf(it), rows).filter((v) => v.shown).length : 0
          const pvMenu = it.M ? (presetMenuOf(it) === undefined ? null : presetMenuOf(it)) : undefined
          const chips = [it.A ? kt('Apparence', 'Appearance') : null, it.M ? kt('Menu', 'Menu') : null].filter((x) => x !== null)
          const badge = it.src === 'mine' ? (it.rec.source === 'gallery' ? kt('Galerie', 'Gallery') : kt('Les miens', 'Mine')) : (it.src === 'template' ? kt('Modèle', 'Template') : kt('Livré', 'Built-in'))
          const pv = () => props.preview(it.vibe !== undefined ? stVibePatch(it.vibe).state : (it.rec !== undefined && it.rec.settings !== undefined ? { skin: it.rec.id, ...it.rec.settings } : null), pvMenu)
          return h('div', { key: it.key, className: 'kbth-pr-tile' + (used ? ' use' : ''), 'data-kb': 'theme-preset', 'data-id': it.key, 'data-src': it.src },
            h('button', { type: 'button', className: 'kbth-pr-btn', 'data-kb': 'theme-preset-open', 'aria-label': kt('Appliquer ', 'Apply ') + it.name, onClick: () => open(it), onMouseEnter: pv, onFocus: pv, onMouseLeave: () => props.preview(null), onBlur: () => props.preview(null) },
              h('span', { className: 'kbth-pr-pv', style: sw === null ? undefined : { background: sw.bg } },
                sw !== null ? [h('i', { key: 's', className: 'kbth-pr-sb', style: { background: sw.side } }), h('i', { key: 'a', className: 'kbth-pr-ac', style: { background: sw.accent } })]
                  : h('span', { key: 'm', className: 'kbth-pr-mb' }, Array.from({ length: Math.min(6, Math.max(1, bars)) }).map((x, i) => h('b', { key: i }))),
                used ? h('span', { className: 'kbth-pr-use' }, kt('En cours', 'In use')) : null),
              h('span', { className: 'kbth-pr-tt' }, h('span', { className: 'kbth-pr-nm' }, it.name),
                h('span', { className: 'kbth-pr-tm' }, h('span', { className: 'kbth-pr-src ' + (mine ? 'mine' : 'built') }, badge), chips.map((ch) => h('span', { key: ch, className: 'kbth-pr-chip' }, ch))))),
            h('button', { type: 'button', className: 'kbth-pr-more', 'data-kb': 'theme-preset-more', 'aria-label': kt('Plus pour ', 'More for ') + it.name, 'aria-haspopup': 'menu', 'aria-expanded': menuFor === it.key ? 'true' : 'false', onClick: () => setMenuFor(menuFor === it.key ? null : it.key) }, '…'),
            menuFor === it.key ? h('div', { className: 'kbth-pop', role: 'menu', 'data-kb': 'theme-preset-menu' },
              h('button', { type: 'button', role: 'menuitem', className: 'kbth-pi', 'data-kb': 'theme-preset-apply', onClick: () => open(it) }, kt('Appliquer…', 'Apply…')),
              !mine ? h('button', { type: 'button', role: 'menuitem', className: 'kbth-pi', 'data-kb': 'theme-preset-dup', onClick: () => dup(it) }, kt('Dupliquer dans Les miens', 'Duplicate to Mine')) : null,
              mine ? h('button', { type: 'button', role: 'menuitem', className: 'kbth-pi', 'data-kb': 'theme-preset-rename', onClick: () => { setMenuFor(null); setRenaming({ id: it.id, text: it.name }) } }, kt('Renommer', 'Rename')) : null,
              mine ? h('button', { type: 'button', role: 'menuitem', className: 'kbth-pi', 'data-kb': 'theme-preset-export', onClick: () => exportOne(it) }, kt('Exporter en fichier', 'Export as a file')) : null,
              mine ? h('button', { type: 'button', role: 'menuitem', className: 'kbth-pi dng', 'data-kb': 'theme-preset-delete', onClick: () => { setMenuFor(null); setConfirming(it.id) } }, kt('Supprimer…', 'Delete…')) : null) : null,
            renaming !== null && renaming.id === it.id ? h('div', { className: 'kbth-pr-ov', 'data-kb': 'theme-preset-renaming' },
              h('input', { className: 'kbth-in', maxLength: PRESET_NAME_MAX, value: renaming.text, autoFocus: true, 'aria-label': kt('Nouveau nom', 'New name'), 'data-kb': 'theme-preset-rename-in', onInput: (e) => setRenaming({ id: it.id, text: e.target.value }), onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); doRename() } else if (e.key === 'Escape') { e.stopPropagation(); setRenaming(null) } } }),
              h('div', { className: 'kbth-pr-row' }, h('button', { type: 'button', className: 'kbth-btn kbth-ldpri', 'data-kb': 'theme-preset-rename-ok', onClick: doRename }, kt('Enregistrer', 'Save')), h('button', { type: 'button', className: 'kbth-btn', onClick: () => setRenaming(null) }, kt('Annuler', 'Cancel')))) : null,
            confirming === it.id ? h('div', { className: 'kbth-pr-ov', 'data-kb': 'theme-preset-confirm' },
              h('span', null, kt('Supprimer « ' + it.name + ' » ?', 'Delete “' + it.name + '”?')),
              h('div', { className: 'kbth-pr-row' }, h('button', { type: 'button', className: 'kbth-btn kbth-danger kbth-gr-err', 'data-kb': 'theme-preset-delete-yes', onClick: () => { libRemove(it.id); setConfirming(null); props.say({ ok: true, text: kt('« ' + it.name + ' » supprimé.', '“' + it.name + '” deleted.') }) } }, kt('Supprimer', 'Delete')), h('button', { type: 'button', className: 'kbth-btn', onClick: () => setConfirming(null) }, kt('Garder', 'Keep')))) : null)
        }

        const strip = h('div', { className: 'kbth-pr-strip', 'data-kb': 'theme-strip' },
          h('div', { className: 'kbth-pr-sp' }, h('span', { className: 'kbth-pr-k' }, kt('Apparence', 'Appearance')), h('span', { className: 'kbth-pr-v', 'data-kb': 'theme-strip-a' }, h('i', { className: 'kbth-pr-dot', style: { background: dotOf } }), aName, aMod ? h('span', { className: 'kbth-tone kbth-tone-mod', 'data-kb': 'theme-modified' }, kt('modifié', 'modified')) : null)),
          h('div', { className: 'kbth-pr-sp' }, h('span', { className: 'kbth-pr-k' }, kt('Menu', 'Menu')), h('span', { className: 'kbth-pr-v', 'data-kb': 'theme-strip-m' }, mName)),
          h('span', { className: 'kbth-st-sp' }),
          h('button', { type: 'button', className: 'kbth-btn', 'data-kb': 'theme-undo', disabled: !props.canUndo(), onClick: () => { props.say(null); props.undo() } }, kt('Annuler', 'Undo')),
          h('div', { className: 'kbth-pr-rel' },
            h('button', { type: 'button', className: 'kbth-btn', 'data-kb': 'theme-reset', 'aria-haspopup': 'menu', 'aria-expanded': resetOpen ? 'true' : 'false', onClick: () => setResetOpen(!resetOpen) }, kt('Réinitialiser', 'Reset')),
            resetOpen ? h('div', { className: 'kbth-pop', role: 'menu', 'data-kb': 'theme-reset-menu' },
              [['appearance', kt('Réinitialiser l’apparence', 'Reset the appearance')], ['menu', kt('Réinitialiser le menu', 'Reset the menu')], ['all', kt('Tout réinitialiser', 'Reset everything')]].map((r) => h('button', { key: r[0], type: 'button', role: 'menuitem', className: 'kbth-pi', 'data-kb': 'theme-reset-' + r[0], onClick: () => { setResetOpen(false); props.say(null); props.reset(r[0]) } }, r[1]))) : null),
          h('button', { type: 'button', className: 'kbth-btn kbth-ldpri', 'data-kb': 'theme-save', onClick: props.openSave }, kt('Enregistrer comme préréglage…', 'Save as preset…')))

        const counts = [['all', kt('Tous', 'All'), items.length], ['builtin', kt('Livrés', 'Built-in'), nBuilt], ['mine', kt('Les miens', 'Mine'), items.length - nBuilt]]
        return h('div', { className: 'kbth-pr', 'data-kb': 'theme-presets' },
          strip,
          props.note !== null && props.note !== undefined ? h('div', { className: props.note.ok ? 'kbth-ok kbth-gr-ok' : 'kbth-bad kbth-gr-err', role: 'status', 'data-kb': 'theme-note' }, props.note.text) : null,
          h('div', { className: 'kbth-pr-head' },
            h('h3', { className: 'kbth-pr-h' }, kt('Préréglages', 'Presets')),
            seg({ label: kt('Afficher les préréglages', 'Show presets'), kb: 'theme-preset-filter', items: counts.map((f) => ({ id: f[0], label: f[1] + ' ' + f[2], on: filter === f[0], tap: () => setFilter(f[0]) })) }),
            h('span', { className: 'kbth-st-sp' }),
            h('button', { type: 'button', className: 'kbth-btn', 'data-kb': 'theme-surprise', onClick: props.surprise }, kt('Me surprendre', 'Surprise me')),
            h('button', { type: 'button', className: 'kbth-btn', 'data-kb': 'theme-open-gallery', onClick: () => props.openClassic('galerie') }, kt('Galerie', 'Gallery')),
            h('label', { className: 'kbth-btn', style: { cursor: 'pointer' } }, kt('Importer…', 'Import…'), h('input', { type: 'file', accept: '.json,application/json', 'data-kb': 'theme-import', style: { display: 'none' }, onChange: (e) => { const input = e.target; const f = input.files && input.files[0]; if (f) props.importFile(f); input.value = '' } }))),
          h('p', { className: 'kbth-hint' }, kt('Un préréglage est un réglage enregistré. Il peut changer l’apparence, le menu, ou les deux. Rien ne change tant que tu n’en choisis pas un.', 'A preset is a saved setup. It can change the appearance, the menu, or both. Nothing changes until you pick one.')),
          h('div', { className: 'kbth-pr-tiles', 'data-kb': 'theme-preset-list' }, shown.map(tile)),
          shown.length === 0 ? h('div', { className: 'kbth-empty' }, kt('Aucun préréglage ici : règle l’apparence ou le menu, puis « Enregistrer comme préréglage ».', 'No preset here yet: set the appearance or the menu, then “Save as preset”.')) : null)
      }

      function Page(props) {
        const ctxRef = props.ctx
        const themeSvc = (ctxRef && ctxRef.theme) ? ctxRef.theme : null
        const [S, setS] = React.useState(readState())
        const [hexDraft, setHexDraft] = React.useState(null)
        const [tokSel, setTokSel] = React.useState('l1')
        const [revision, setRevision] = React.useState(0)
        // The preset library and the menu in use: redrawn when they change (own writes, or the disk copy arriving), and when the menu's rows change.
        const [, libBump] = React.useReducer((x) => x + 1, 0)
        React.useEffect(() => { lib.subs.add(libBump); libPull(true); return () => { lib.subs.delete(libBump) } }, [])
        React.useEffect(() => {
          const reg = menuRegistry()
          if (reg === null || typeof reg.subscribe !== 'function') return undefined
          let off = null
          try { off = reg.subscribe(() => libBump()) } catch (e) { off = null }
          return () => { try { if (typeof off === 'function') off() } catch (e) { /* already detached */ } }
        }, [])
        const [libNote, setLibNote] = React.useState(null)       // { ok, text }: the last thing the presets did or refused
        const [pv, setPv] = React.useState(null)                 // a preview: { s: settings to draw over the state, m: a menu to draw (null = the default one) } — the window shows it, nothing is stored
        const [sheet, setSheet] = React.useState(null)           // the apply sheet: { key, ticks } for the item being applied
        const [saveSheet, setSaveSheet] = React.useState(null)   // the save sheet: { name, tA, tM, tAcc, error }
        // The gallery: redrawn when the catalogue arrives; the search and the filter live here.
        const [, galBump] = React.useReducer((x) => x + 1, 0)
        const [galQ, setGalQ] = React.useState('')
        const [galF, setGalF] = React.useState('all')           // 'all' | 'light' | 'dark'
        const [trial, setTrial] = React.useState(null)          // null | { id, name, prev }: a gallery theme being tried, and the look to come back to
        const trialRef = React.useRef(null)
        trialRef.current = trial
        const [exportFmt, setExportFmt] = React.useState('yaml')  // displayed export format (not stored)
        const [advTab, setAdvTab] = React.useState('couleurs')   // open tab of the advanced editor
        const [classicOpen, setClassicOpen] = React.useState(false) // the advanced editor sits folded under the window
        // Undo: the looks before each change (the page's state and the animation store), at most 40; a burst of changes (a slider drag) is one step.
        const histRef = React.useRef([])
        const histAt = React.useRef(0)
        const pushHist = (cur) => {
          const now = Date.now()
          const gap = now - histAt.current
          histAt.current = now // the window slides: a drag that lasts three seconds is still one step
          if (gap < 700) return
          histRef.current.push(JSON.stringify({ s: cur === undefined ? readState() : cur, l: ld.S, m: lib.menu }))
          if (histRef.current.length > 40) histRef.current.shift()
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
          if (transient !== true) setPv((cur) => (cur === null ? cur : null))
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

        // The window draws the state with a preview laid over it (a hovered option, a tile, an apply sheet): nothing is stored before a click.
        const rowsNow = menuRows()
        const sheetItem = sheet === null ? null : (presetItems().find((x) => x.key === sheet.key) || null)
        const sheetPlan = sheetItem === null ? null : presetPlan(sheetItem, sheet.ticks, rowsNow)
        const baseSv = sheetPlan !== null && sheetPlan.patch !== null ? { ...S, ...sheetPlan.patch } : S
        const Sv = pv !== null && pv.s !== null && pv.s !== undefined ? { ...baseSv, ...pv.s } : baseSv
        const darkV = Sv === S ? dark : schemeSombre(Sv)
        const cV = Sv === S ? c : makeTheme(darkV ? 'dark' : 'light', optsDe(Sv))
        const pvMenuDoc = pv !== null && pv.m !== undefined ? pv.m : (sheetPlan !== null && sheetPlan.menu !== undefined ? sheetPlan.menu : undefined)
        const preview = (patch, menuDoc) => setPv((cur) => {
          const next = (patch === null || patch === undefined) && menuDoc === undefined ? null : { s: patch === undefined ? null : patch, m: menuDoc }
          return cur === null && next === null ? cur : next
        })
        const pvOf = (key) => (v) => preview(v === null ? null : { [key]: v })
        const pvSeg = (key) => ({ on: (id) => preview({ [key]: id }), off: () => preview(null) })

        const skinMeta = (sk) => (sk.mode === 'dark' ? kt('Sombre', 'Dark') : (sk.mode === 'light' ? kt('Clair', 'Light') : kt('Clair + sombre', 'Light + dark'))) +
          (skinAccent(sk) === null ? kt(' · accent neutre', ' · neutral accent') : ' · ' + skinAccent(sk)) +
          (sk.fontText !== undefined ? kt(' · police ', ' · font ') + (FONTS.find((f) => f.id === sk.fontText) || FONTS[0]).name : '') +
          (sk.radius !== undefined ? ' · ' + kt(RADIUS_LABEL[sk.radius][0], RADIUS_LABEL[sk.radius][1]) : '') +
          (sk.iconSet !== undefined ? ((nm) => kt(' · icônes ' + nm, ' · ' + nm + ' icons'))((ICON_SETS.find((x) => x.id === sk.iconSet) || ICON_SETS[0])[kbLang()]) : '')

        const applyMine = (rec) => commit({ skin: rec.id, ...rec.settings })

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


        // ── what the presets do ─────────────────────────────────────────────────────────────────────────────────────
        const say = (n) => setLibNote(n)
        const editMenu = (fn) => { const next = menuEdit(lib.menu, rowsNow, fn); if (next === undefined) return; pushHist(); menuUse(next) }
        const editSurface = (surface, fn) => { const next = surfaceEdit(lib.menu, surface, surfaceRows(surface), rowsNow, fn); if (next === undefined) return; pushHist(); menuUse(next) }
        const menuShowEvery = () => { pushHist(); menuUse(menuShowAll(lib.menu, rowsNow)); say({ ok: true, text: kt('Toutes les entrées sont affichées.', 'Every entry is shown again.') }) }
        const setUnlisted = (v) => {
          if (lib.menu !== null && lib.menu.locked === true) return
          const base = menuFull(lib.menu, rowsNow)
          if (base === null) return
          const next = menuClean({ ...base, unlisted: v })
          pushHist(); menuUse(next === null || menuIsDefault(next, rowsNow) ? null : next)
        }
        const applyItem = (item, ticks) => {
          const plan = presetPlan(item, ticks, rowsNow)
          if (plan.patch === null && plan.menu === undefined) { setSheet(null); return }
          pushHist(); setHexDraft(null)
          if (plan.patch !== null) commit(plan.patch)
          if (plan.loop !== null) ldSet(plan.loop)
          if (plan.menu !== undefined) {
            if (plan.keep) libAdd(libFreeName(kt('Mon menu', 'My menu')), 'me', undefined, { menu: lib.menu })
            menuUse(plan.menu)
          }
          setSheet(null); setPv(null)
          const parts = [plan.patch !== null ? kt('l’apparence', 'the appearance') : null, plan.menu !== undefined ? kt('le menu', 'the menu') : null].filter((x) => x !== null)
          say({ ok: true, text: kt('« ' + item.name + ' » appliqué : ' + parts.join(' et ') + '.', '“' + item.name + '” applied: ' + parts.join(' and ') + '.') + (plan.keep ? kt(' Ton menu d’avant est gardé dans Les miens.', ' Your previous menu is kept in Mine.') : '') })
        }
        const openSheet = (item, ticks) => { setSaveSheet(null); setLibNote(null); setSheet({ key: item.key, ticks }) }
        const openSave = () => { setSheet(null); setLibNote(null); setSaveSheet({ name: libFreeName(kt('Mon préréglage', 'My preset')), tA: true, tM: lib.menu !== null, tAcc: false, error: '' }) }
        const doSave = () => {
          const sv = saveSheet
          if (sv === null) return
          const name = presetName(sv.name)
          if (name === '') { setSaveSheet({ ...sv, error: kt('Donne un nom au préréglage.', 'Give the preset a name.') }); return }
          if (libNameTaken(name)) { setSaveSheet({ ...sv, error: kt('Ce nom existe déjà. Choisis-en un autre.', 'That name already exists. Pick another one.') }); return }
          const a11yOnly = {}
          PRESET_GROUPS.a11y.forEach((k) => { if (S[k] !== undefined) a11yOnly[k] = S[k] })
          const settings = sv.tA ? presetFromState(S, { font: true, radius: true, icons: true, chat: true, glass: true, a11y: sv.tAcc }) : (sv.tAcc ? a11yOnly : null)
          const menu = sv.tM ? menuFull(lib.menu, rowsNow) : null
          if (settings === null && menu === null) { setSaveSheet({ ...sv, error: kt('Coche au moins une case.', 'Tick at least one box.') }); return }
          const rec = libAdd(name, 'me', settings === null ? undefined : settings, menu === null ? undefined : { menu })
          if (rec === null) { setSaveSheet({ ...sv, error: kt('La bibliothèque est pleine (' + PRESET_LIMIT + ' préréglages). Supprime-en un d’abord.', 'The library is full (' + PRESET_LIMIT + ' presets). Delete one first.') }); return }
          setSaveSheet(null)
          if (sv.tA) commit({ skin: rec.id })
          say({ ok: true, text: kt('« ' + rec.name + ' » est enregistré dans Les miens.', '“' + rec.name + '” is saved in Mine.') })
        }
        const doReset = (what) => {
          pushHist(); setHexDraft(null)
          if (what !== 'menu') commit({ ...DEF }, true)
          if (what !== 'appearance') menuUse(null)
          say({ ok: true, text: what === 'menu' ? kt('Menu remis par défaut.', 'Menu reset to the default.') : (what === 'appearance' ? kt('Apparence remise par défaut.', 'Appearance reset to the default.') : kt('Tout est remis par défaut.', 'Everything is back to the default.')) })
        }
        const doSurprise = () => {
          const r = stSurprise()
          pushHist(); setHexDraft(null)
          commit(r.state); ldSet(r.loop)
          say({ ok: true, text: kt('Surprise ! Une apparence au hasard. Ton menu n’a pas changé.', 'Surprise! A random appearance. Your menu did not change.') })
        }
        const undoStep = () => {
          const snap = histRef.current.pop()
          if (snap === undefined) return
          histAt.current = 0 // the next change is a new step, however soon it comes
          try { const p = JSON.parse(snap); setHexDraft(null); commit(p.s, true, false, true); ldSet({ ...p.l }); if (p.m !== undefined) menuUse(p.m) } catch (e) { /* a damaged step is dropped */ }
        }
        // A sheet that opens comes into view next to the window.
        React.useEffect(() => {
          if (sheet === null && saveSheet === null) return
          try { const el = document.querySelector('[data-kb="theme-sheet"],[data-kb="theme-save-sheet"]'); if (el !== null && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' }) } catch (e) { /* nothing to scroll */ }
        }, [sheet === null, saveSheet === null])

        // The mode (Light / Dark / System) is set HERE, on three cards (the Appearance page that used to hold them is gone). The same preference as the footer's sun/moon:
        // `commit({ mode })` stores it in this page's state and writes it through `themeSvc.setTheme`. A third-party theme that takes the preference over is told below.
        const modes = [['light', kt('Clair', 'Light')], ['dark', kt('Sombre', 'Dark')], ['system', kt('Système', 'System')]]
        const conflictNote = themeTiers === null ? null : h('div', { className: 'kbth-conflict' },
          h('strong', null, kt('Conflit de thème : ', 'Theme conflict: ')),
          kt('Un autre plugin (« ' + themeTiers + ' ») contrôle le mode clair/sombre. ', 'Another plugin (“' + themeTiers + '”) controls the light/dark mode. '),
          kt('Désactive-le dans son propre panneau pour que ce réglage s’applique.', 'Turn it off in its own panel for this setting to apply.'))
        const accentHex = S.acc === null ? c.brand : S.acc
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
        // Reusable toggle switch
        const toggle = (label, value, onToggle, hint) => h('div', { className: 'kbth-toggle-row' },
          h('span', { className: 'kbth-toggle-label' }, label, hint ? h('span', { className: 'kbth-toggle-hint', title: hint }, ' ?') : null),
          h('button', { type: 'button', className: 'kbth-toggle' + (value ? ' on' : ''), role: 'switch', 'aria-checked': value ? 'true' : 'false', 'aria-label': label, onClick: onToggle },
            h('span', { className: 'kbth-toggle-knob' })))


        // ── The tabs of the advanced editor ─────────────────────────────────────────────────────────────────────────
        const ADV_TABS = [
          { id: 'couleurs', label: kt('Couleurs', 'Colors') },
          { id: 'lettres', label: kt('Lettres', 'Letters') },
          { id: 'formes', label: kt('Formes', 'Shapes') },
          { id: 'fond', label: kt('Arrière-plan', 'Background') },
          { id: 'effets', label: kt('Effets', 'Effects') },
          { id: 'icones', label: kt('Icônes', 'Icons') },
          { id: 'menu', label: 'Menu' },
          { id: 'animation', label: 'Animation' },
          { id: 'accessibilite', label: kt('Accessibilité', 'Accessibility') },
          { id: 'partage', label: kt('Import / Export', 'Import / Export') },
          { id: 'galerie', label: kt('Galerie', 'Gallery') }
        ]
        const sech = (t, d) => h('div', { className: 'kbth-sec-h' }, h('div', { className: 'kbth-sec-t' }, t), d === undefined ? null : h('div', { className: 'kbth-sec-d' }, d))
        const rowOf = (label, ctl) => h('div', { className: 'kbth-row' }, h('span', { className: 'kbth-lb' }, label), ctl)

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
              // role: the phone's settings rule grows the first child of a two-child row (« a label and its control »); a role keeps this round swatch out of it (it was stretched into an ellipse)
              h('label', { className: 'kbth-sw', role: 'presentation', style: { background: accentHex }, title: kt('Pipette', 'Eyedropper') },
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
              S.acc !== null ? h('button', { className: 'kbth-btn', type: 'button', onClick: () => { setHexDraft(null); commit({ acc: null }) } }, kt('Neutre Kybernos', 'Neutral Kybernos')) : null)),
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


        // Colors: the mode, then the accent and the colour tokens.
        const advCol = h('div', { className: 'kbth-sec', 'data-kb': 'theme-tab-couleurs' },
          sech(kt('Mode', 'Mode'), kt('S’applique à toute l’interface Kybernos. « Système » suit le réglage de ton appareil.', 'Applies to the whole Kybernos interface. “System” follows your device setting.')),
          seg({ label: kt('Mode', 'Mode'), kb: 'theme-mode', items: modes.map((m) => ({ id: m[0], label: m[1], on: S.mode === m[0], tap: () => commit({ mode: m[0] }) })) }),
          advCouleurs, ratiosAccent)

        // Letters: one font select, the size, the ligatures.
        const advLettres = h('div', { className: 'kbth-sec', 'data-kb': 'theme-tab-lettres' },
          sech(kt('Police', 'Font'), kt('Choisis la police de l’interface : chaque nom est écrit dans sa propre police.', 'Choose the interface font: each name is written in its own typeface.')),
          rowOf(kt('Police', 'Font'), h(KbSelect, { id: 'adv-font', kb: 'theme-adv-font', label: kt('Police', 'Font'), value: S.fontText, options: fontOptions(), onPick: (id) => commit({ fontText: id }), onPreview: pvOf('fontText') })),
          h('div', { className: 'kbth-hint' }, kt('Une police ne s’affiche que si elle est installée sur ton ordinateur.', 'A font only shows if it is installed on your computer.')),
          slider({ label: kt('Taille du texte', 'Text size'), min: 12, max: 17, value: S.fs, text: S.fs + ' px', tap: (v) => commit({ fs: v }), hint: kt('La taille de la conversation : le réglage natif de Kybernos, en direct.', 'The conversation size: Kybernos’s native setting, live.') }),
          toggle('Ligatures', S.ligatures, () => commit({ ligatures: !S.ligatures }), kt('Fusionne « fi », « -> » et autres paires dans les polices qui en ont.', 'Joins “fi”, “->” and other pairs in fonts that have them.')))

        // Shapes: corners, shadows, glow, the logo, the frames of the messages.
        const bubbleLabels = { auto: kt('Auto (Kybernos)', 'Auto (Kybernos)'), accent: 'Accent', soft: kt('Doux', 'Soft'), dark: kt('Sombre', 'Dark') }
        const replyLabels = { none: kt('Aucun (Kybernos)', 'None (Kybernos)'), card: kt('Carte', 'Card'), outline: kt('Contour', 'Outline'), tint: kt('Teinte', 'Tinted') }
        const advFormes = h('div', { className: 'kbth-sec', 'data-kb': 'theme-tab-formes' },
          sech(kt('Formes', 'Shapes'), kt('Arrondi des boutons, cartes et panneaux, ombres et cadres des messages.', 'Rounding of buttons, cards and panels, shadows and the frames of the messages.')),
          rowOf(kt('Coins', 'Corners'), seg({ label: kt('Coins', 'Corners'), kb: 'theme-adv-radius', pv: pvSeg('radius'), items: [['sharp', kt('Nets', 'Sharp')], ['standard', 'Standard'], ['soft', kt('Doux', 'Soft')]].map((z) => ({ id: z[0], label: z[1], on: S.radius === z[0], tap: () => commit({ radius: z[0] }) })) })),
          rowOf(kt('Ombres', 'Shadows'), seg({ label: kt('Ombres', 'Shadows'), kb: 'theme-adv-shadow', pv: pvSeg('shadow'), items: [['none', kt('Aucune', 'None')], ['soft', kt('Douces', 'Soft')]].map((z) => ({ id: z[0], label: z[1], on: S.shadow === z[0], tap: () => commit({ shadow: z[0] }) })) })),
          toggle(kt('Halo', 'Glow'), S.glow, () => commit({ glow: !S.glow }), kt('Une lueur de ta couleur autour de la zone de message.', 'A soft light of your color around the message box.')),
          rowOf(kt('Tes messages', 'Your messages'), seg({ label: kt('Couleur de la bulle', 'Bubble color'), kb: 'theme-adv-bubble', pv: pvSeg('bubbleUser'), items: BUBBLE_CHOICES.map((b) => ({ id: b, label: bubbleLabels[b], on: S.bubbleUser === b, tap: () => commit({ bubbleUser: b }) })) })),
          rowOf(kt('Réponses de l’agent', 'Agent replies'), seg({ label: kt('Fond de la réponse', 'Reply background'), kb: 'theme-adv-reply', pv: pvSeg('replyBg'), items: ENUMS.replyBg.map((b) => ({ id: b, label: replyLabels[b], on: S.replyBg === b, tap: () => commit({ replyBg: b }) })) })),
          toggle(kt('Logo et nom', 'Logo and name'), S.showBrand, () => commit({ showBrand: !S.showBrand }), kt('Dans la barre latérale et sur l’écran d’accueil.', 'In the sidebar and on the home screen.')))

        // Background: one select of wallpapers, then the fine settings.
        const advFond = h('div', { className: 'kbth-sec', 'data-kb': 'theme-tab-fond' },
          sech(kt('Arrière-plan', 'Background'), kt('Couleur, dégradé, motif ou image derrière l’interface.', 'Color, gradient, pattern or image behind the interface.')),
          rowOf(kt('Fond', 'Background'), h(KbSelect, { id: 'adv-wall', kb: 'theme-adv-wall', label: kt('Arrière-plan', 'Wallpaper'), value: S.wp, options: wallOptions(), onPick: (id) => commit({ wp: id }), onPreview: pvOf('wp') })),
          wpOn ? null : h('div', { className: 'kbth-note' }, kt('Choisis un arrière-plan : les réglages ci-dessous s’appliquent dès qu’il y en a un.', 'Pick a wallpaper: the settings below apply as soon as there is one.')),
          slider({ label: kt('Visibilité du fond', 'Background visibility'), min: 0, max: 100, value: S.wpVis, text: S.wpVis + ' %', tap: (v) => commit({ wpVis: v }), hint: kt('Opacité du fond derrière l’interface.', 'Opacity of the background behind the interface.') }),
          slider({ label: kt('Flou de l’image', 'Image blur'), min: 0, max: 40, value: S.wpBlur, text: S.wpBlur + ' px', tap: (v) => commit({ wpBlur: v }) }),
          slider({ label: kt('Teinte des surfaces', 'Surface tint'), min: 0, max: 100, value: S.tint, text: S.tint + ' %', tap: (v) => commit({ tint: v }), hint: kt('Tire les panneaux vers la dominante du fond, pour que l’interface s’y fonde.', 'Pulls the panels towards the dominant color of the background, so the interface blends into it.') }),
          slider({ label: kt('Luminosité', 'Brightness'), min: 0, max: 200, value: S.bgBrightness, text: S.bgBrightness + ' %', tap: (v) => commit({ bgBrightness: v }) }),
          slider({ label: kt('Contraste', 'Contrast'), min: 0, max: 200, value: S.bgContrast, text: S.bgContrast + ' %', tap: (v) => commit({ bgContrast: v }) }),
          slider({ label: 'Saturation', min: 0, max: 200, value: S.bgSaturation, text: S.bgSaturation + ' %', tap: (v) => commit({ bgSaturation: v }) }),
          slider({ label: kt('Assombrissement', 'Darkening'), min: 0, max: 100, value: S.bgDarken, text: S.bgDarken + ' %', tap: (v) => commit({ bgDarken: v }) }),
          rowOf(kt('Ajustement', 'Fit'), seg({ label: kt('Ajustement', 'Fit'), kb: 'theme-adv-fit', pv: pvSeg('bgFit'), items: [['cover', kt('Couvrir', 'Cover')], ['fill', kt('Remplir', 'Fill')], ['center', kt('Centrer', 'Center')], ['stretch', kt('Étirer', 'Stretch')]].map((f) => ({ id: f[0], label: f[1], on: S.bgFit === f[0], tap: () => commit({ bgFit: f[0] }) })) })),
          toggle(kt('Miroir horizontal', 'Horizontal mirror'), S.bgMirror, () => commit({ bgMirror: !S.bgMirror })))

        // Effects: glass, the sidebar, the pills under the message box.
        const advEffets = h('div', { className: 'kbth-sec', 'data-kb': 'theme-tab-effets' },
          sech(kt('Verre', 'Glass'), kt('Transparence et flou des surfaces posées sur le fond.', 'Transparency and blur of the surfaces placed over the background.')),
          verrePreview,
          wpOn ? null : h('div', { className: 'kbth-note' }, kt('Ces réglages s’appliquent dès qu’un fond est choisi : onglet Arrière-plan.', 'These settings apply as soon as a background is chosen: Background tab.')),
          rowOf(kt('Effet', 'Effect'), seg({ label: kt('Effet de verre', 'Glass effect'), kb: 'theme-adv-glass', pv: pvSeg('glassEffect'), items: [['frosted', kt('Verre dépoli', 'Frosted glass')], ['liquid', 'Liquid glass']].map((z) => ({ id: z[0], label: z[1], on: S.glassEffect === z[0], tap: () => commit({ glassEffect: z[0] }) })) })),
          slider({ label: kt('Flou du verre', 'Glass blur'), min: 0, max: 40, value: S.glassBlur, text: S.glassBlur + ' px', tap: (v) => commit({ glassBlur: v }) }),
          toggle(kt('Lier la barre latérale au fond', 'Link the sidebar to the background'), S.sidebarLinked, () => commit({ sidebarLinked: !S.sidebarLinked }), kt('Désactivé, la barre latérale reste pleine.', 'When off, the sidebar stays solid.')),
          h('div', { style: S.sidebarLinked ? null : { opacity: 0.45, pointerEvents: 'none' } },
            slider({ label: kt('Transparence de la barre latérale', 'Sidebar transparency'), min: 0, max: 100, value: S.sidebarOpacity, text: S.sidebarOpacity + ' %', tap: (v) => commit({ sidebarOpacity: v }) })),
          slider({ label: kt('Transparence des champs', 'Field transparency'), min: 0, max: 100, value: S.fieldOpacity, text: S.fieldOpacity + ' %', tap: (v) => commit({ fieldOpacity: v }) }),
          slider({ label: kt('Transparence des menus', 'Menu transparency'), min: 0, max: 100, value: S.floatOpacity, text: S.floatOpacity + ' %', tap: (v) => commit({ floatOpacity: v }) }),
          rowOf(kt('Ton de la barre latérale', 'Sidebar tone'), seg({ label: kt('Ton de la barre latérale', 'Sidebar tone'), kb: 'theme-adv-sidetone', pv: pvSeg('sideTone'), items: ENUMS.sideTone.map((t) => ({ id: t, label: { auto: kt('Auto', 'Auto'), darker: kt('Plus sombre', 'Darker'), lighter: kt('Plus clair', 'Lighter'), tinted: kt('Teintée', 'Tinted') }[t], on: S.sideTone === t, tap: () => commit({ sideTone: t }) })) })),
          toggle(kt('Barres au survol', 'Bars on hover'), S.autoHideBars, () => commit({ autoHideBars: !S.autoHideBars }), kt('Le rail replié et la barre du haut du chat se cachent, et reviennent quand tu approches le bord de la fenêtre.', 'The collapsed rail and the chat’s top bar hide, and come back when you reach for the edge of the window.')),
          sech(kt('Sous la zone de message', 'Under the message box'), kt('Ces pastilles sont dessinées par d’autres modules : ici tu les montres ou les caches.', 'Other modules draw these pills: here you show or hide them.')),
          toggle(kt('Pastilles d’état', 'Status pills'), S.wgSessions, () => commit({ wgSessions: !S.wgSessions }), kt('Enregistré, synchro, revue, mémoire, leçons.', 'Saved, sync, review, memory, lessons.')),
          toggle(kt('Changements', 'Changes'), S.wgChanges, () => commit({ wgChanges: !S.wgChanges }), kt('Où en est le travail de cette conversation.', 'Where the work of this chat stands.')),
          toggle(kt('Usage', 'Usage'), S.wgUsage, () => commit({ wgUsage: !S.wgUsage }), kt('Quelle part de ton forfait est utilisée, ou ce que coûte la session.', 'How much of your plan is used, or what the session costs.')),
          sech(kt('Notifications', 'Notifications'), kt('Les bannières du système et la fenêtre flottante ne changent pas : elles se règlent dans Réglages › Widget.', 'System banners and the floating window do not change: they are set in Settings › Widget.')),
          toggle(kt('Compteurs de notifications', 'Notification counters'), S.notifCounters === 'shown', () => commit({ notifCounters: S.notifCounters === 'shown' ? 'hidden' : 'shown' }), kt('Le nombre entre parenthèses dans le titre de l’onglet, et le badge sur l’icône de l’appli (Dock).', 'The number in brackets in the tab title, and the badge on the app icon (Dock).')))

        // Icons: one select; the nine entries drawn at rest and in colour.
        const advIcones = h('div', { className: 'kbth-sec', 'data-kb': 'theme-icons' },
          sech(kt('Icônes du menu', 'Menu icons'), kt('Le dessin des entrées de la barre latérale : gris au repos, en couleur sur la page ouverte. Un préréglage peut le retenir.', 'How the sidebar entries are drawn: grey at rest, in colour on the open page. A preset can keep it.')),
          rowOf(kt('Jeu d’icônes', 'Icon set'), h(KbSelect, { id: 'adv-icons', kb: 'theme-adv-iconset', label: kt('Jeu d’icônes', 'Icon set'), value: S.iconSet, options: iconSetOptions(), onPick: (id) => commit({ iconSet: id }), onPreview: pvOf('iconSet') })),
          h('div', { className: 'kbth-icsets-pv', 'data-kb': 'theme-icons-preview' }, iconeApercu(S.iconSet, false), iconeApercu(S.iconSet, true)),
          h('div', { className: 'kbth-hint' }, ICON_SETS.length + kt(' jeux, dessinés par le code du plugin. Les entrées elles-mêmes (ordre, noms, afficher ou cacher) sont dans l’onglet Menu.', ' sets, drawn by the plugin’s own code. The entries themselves (order, names, show or hide) are in the Menu tab.')))

        // Menu: the rows of the menu, with the same editor as the panel in the window.
        const advMenu = h('div', { className: 'kbth-sec', 'data-kb': 'theme-tab-menu' },
          sech('Menu', kt('Les entrées de la barre latérale : lesquelles, dans quel ordre, sous quel nom. Les Espaces de travail, les Réglages et le compte restent toujours affichés.', 'The entries of the sidebar: which ones, in which order, under which name. Workspaces, Settings and the account always stay shown.')),
          h(MenuZones, { rows: rowsNow, doc: lib.menu, edit: editMenu, editSurface, showAll: menuShowEvery, setUnlisted, compact: false, icon: (e) => stIcon(S.iconSet, e, false, 16) }))

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
          toggle(kt('Confort au doigt', 'Touch comfort'), S.touch, () => commit({ touch: !S.touch }), kt('Sur un petit écran (480 px ou moins) : lignes et icônes plus grandes, menus sur toute la largeur, onglets en liste. Le Simple du téléphone l’a toujours.', 'On a small screen (480 px or less): bigger rows and icons, full-width menus, tabs as a list. The phone’s Simple always has it.')),
          toggle(kt('Soulignement des liens', 'Link underlining'), S.underlineLinks, () => commit({ underlineLinks: !S.underlineLinks })),
          toggle(kt('Palette daltonisme', 'Color-blind palette'), S.cbSafe, () => commit({ cbSafe: !S.cbSafe }), kt('Succès en bleu, alertes en vert bleuté et erreurs en orange plutôt qu’en vert, ambre et rouge.', 'Success in blue, warnings in bluish green and errors in orange rather than green, amber and red.')),
          h('div', { style: { height: 16 } }),
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, kt('Pages sur petit écran', 'Pages on a small screen')),
            h('div', { className: 'kbth-sec-d' }, kt('Sous 600 px : comment les pages de Réglages sont disposées. Le contenu ne change pas. Le Simple du téléphone choisit tout ce qui est à droite.', 'Under 600 px: how the Settings pages are laid out. The content does not change. The phone’s Simple picks everything on the right.'))),
          ...[['tabsNav', kt('Onglets de Kaby', 'Kaby tabs'), [['tabs', kt('Barre', 'Bar')], ['list', kt('Menu', 'Menu')]]],
            ['rowsLayout', kt('Rangées de réglage', 'Setting rows'), [['stacked', kt('Dessous', 'Under')], ['inline', kt('En ligne', 'Inline')]]],
            ['rowsDescription', kt('Descriptions', 'Descriptions'), [['below', kt('Dessous', 'Below')], ['info', '« i »']]],
            ['helpButton', kt('Bouton « ? »', 'The “?” button'), [['boxed', kt('Carré', 'Square')], ['bare', kt('Seul', 'Bare')], ['named', kt('Nommé', 'Named')]]],
            ['cardsFrame', kt('Cartes', 'Cards'), [['boxed', kt('Cadre', 'Frame')], ['flat', kt('À plat', 'Flat')]]],
            ['chipsStyle', kt('Pastilles', 'Chips'), [['pill', kt('Contour', 'Outlined')], ['plain', kt('Texte', 'Text')]]],
            ['groupTitles', kt('Titres de groupes', 'Group titles'), [['shown', kt('Visibles', 'Shown')], ['hidden', kt('Cachés', 'Hidden')]]]].map((k) => h('div', { className: 'kbth-row', key: 'pres-' + k[0] },
            h('span', { className: 'kbth-lb' }, k[1]),
            seg({ label: k[1], kb: 'theme-pres-' + k[0], items: k[2].map((o) => ({ id: o[0], label: o[1], on: S[k[0]] === o[0], tap: () => commit({ [k[0]]: o[0] }) })) }))),
          h('div', { style: { height: 16 } }),
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, kt('Menu et chat sur petit écran', 'Menu and chat on a small screen')),
            h('div', { className: 'kbth-sec-d' }, kt('Sous 600 px : la taille du menu et de la zone de saisie, le chat vide, la note d’une réponse et la taille du texte des messages (en px). Le contenu ne change pas. Le Simple du téléphone choisit tout ce qui est à droite.', 'Under 600 px: the size of the menu and the message box, the empty chat, how an answer is rated and the size of the message text (in px). The content does not change. The phone’s Simple picks everything on the right.'))),
          ...[['drawerSize', kt('Menu', 'Menu'), [['standard', kt('Normal', 'Usual')], ['large', kt('Grand', 'Large')]]],
            ['drawerPanels', kt('Autres lignes du menu', 'Other menu rows'), [['shown', kt('Visibles', 'Shown')], ['hidden', kt('Cachées', 'Hidden')]]],
            ['composerSize', kt('Zone de saisie', 'Message box'), [['standard', kt('Normale', 'Usual')], ['large', kt('Grande', 'Large')]]],
            ['newChatCards', kt('Cartes du chat vide', 'Empty chat cards'), [['slider', kt('Slider', 'Slider')], ['grid', kt('Grille', 'Grid')], ['hidden', kt('Cachées', 'Hidden')]]],
            ['rating', kt('Note d’une réponse', 'Rating an answer'), [['stars', kt('Étoiles', 'Stars')], ['thumbs', kt('Pouces', 'Thumbs')]]],
            ['messageSize', kt('Texte des messages', 'Message text'), [['compact', '15'], ['standard', '17'], ['large', '19'], ['xlarge', '21']]]].map((k) => h('div', { className: 'kbth-row', key: 'pres-' + k[0] },
            h('span', { className: 'kbth-lb' }, k[1]),
            seg({ label: k[1], kb: 'theme-pres-' + k[0], items: k[2].map((o) => ({ id: o[0], label: o[1], on: S[k[0]] === o[0], tap: () => commit({ [k[0]]: o[0] }) })) }))))


        // Import / Export: a preset file in, the current appearance out, and the resets.
        const importThemeFile = (file) => {
          if (file.size > PRESET_FILE_MAX) { say({ ok: false, text: kt('Fichier trop gros : un préréglage fait quelques Ko. Rien n’a été modifié.', 'File too big: a preset is a few KB. Nothing was changed.') }); return }
          const reader = new FileReader()
          reader.onload = () => {
            const r = presetFromFileText(String(reader.result))
            if (r.ok !== true) { say({ ok: false, text: kt('Fichier non reconnu : seul un fichier de préréglage Kybernos (.json) est accepté. Rien n’a été modifié.', 'File not recognized: only a Kybernos preset file (.json) is accepted. Nothing was changed.') }); return }
            const rec = libAdd(r.name, 'file', r.settings, { author: r.author, menu: r.menu })
            if (rec === null) { say({ ok: false, text: kt('La bibliothèque est pleine (' + PRESET_LIMIT + ' préréglages). Supprime-en un d’abord.', 'The library is full (' + PRESET_LIMIT + ' presets). Delete one first.') }); return }
            say({ ok: true, text: kt('« ' + rec.name + ' » est dans Les miens. Rien n’est appliqué : choisis ce que tu veux en reprendre.', '“' + rec.name + '” is in Mine. Nothing is applied yet: choose what you want from it.') + (r.droppedA11y ? kt(' Ses réglages d’accessibilité ont été laissés de côté.', ' Its accessibility settings were left out.') : '') })
            openSheet(presetRecItem(rec), { tA: rec.settings !== undefined, tM: false, tAcc: false })
          }
          reader.readAsText(file)
        }
        const exportFormats = [['yaml', 'YAML'], ['json', 'JSON'], ['css', 'CSS']]
        const exportBody = exportTexte(exportFmt, S)
        const advPartage = h('div', { className: 'kbth-sec', style: { gap: 22 }, 'data-kb': 'theme-tab-partage' },
          h('div', { className: 'kbth-sec' },
            sech(kt('Importer', 'Import'), kt('Un fichier de préréglage (.json) s’ajoute à Les miens. Il ne change rien tant que tu n’as pas coché ce que tu en reprends. Il ne change jamais tes réglages d’accessibilité.', 'A preset file (.json) is added to Mine. It changes nothing until you tick what you take from it. It never changes your accessibility settings.')),
            libNote !== null ? h('div', { className: libNote.ok ? 'kbth-ok kbth-gr-ok' : 'kbth-bad kbth-gr-err', role: 'status', 'data-kb': 'theme-note' }, libNote.text) : null,
            h('div', { className: 'kbth-row' },
              h('label', { className: 'kbth-btn', style: { cursor: 'pointer' } }, kt('Choisir un fichier .json', 'Choose a .json file'),
                h('input', { type: 'file', accept: '.json,application/json', 'data-kb': 'theme-import-adv', style: { display: 'none' }, onChange: (e) => { const input = e.target; const file = input.files && input.files[0]; if (!file) return; importThemeFile(file); input.value = '' } })),
              lib.hostState === 'off' && ldHostOn() ? h('span', { className: 'kbth-hint' }, kt('Le disque de Kybernos ne répond pas : tes préréglages restent dans ce navigateur.', 'Kybernos’s disk does not answer: your presets stay in this browser.')) : null)),
          h('details', { className: 'kbth-fold', 'data-kb': 'theme-export-fold' },
            h('summary', null, kt('Exporter l’apparence actuelle', 'Export the current appearance')),
            h('div', { className: 'kbth-sec', style: { marginTop: 10 } },
              h('div', { className: 'kbth-sec-d' }, kt('Le réglage en cours, tel quel : un fichier à partager ou à versionner. Pour un préréglage enregistré, utilise « Exporter en fichier » sur sa vignette.', 'The current setting as it is: a file to share or to version. For a saved preset, use “Export as a file” on its tile.')),
              h('div', { className: 'kbth-row' },
                h('span', { className: 'kbth-lb' }, 'Format'),
                seg({ label: 'Format', kb: 'theme-export-format', items: exportFormats.map((f) => ({ id: f[0], label: f[1], on: exportFmt === f[0], tap: () => setExportFmt(f[0]) })) }),
                h('button', { className: 'kbth-btn', type: 'button', 'data-kb': 'theme-copy', onClick: () => { try { navigator.clipboard.writeText(exportBody) } catch (e) { /* clipboard unavailable */ } } }, kt('Copier', 'Copy'))),
              h('div', { className: 'kbth-export-preview' },
                h('div', { className: 'kbth-export-bar' },
                  h('span', null, 'dsh-theme.' + (exportFmt === 'yaml' ? 'yml' : exportFmt)),
                  h('span', { 'data-kb': 'theme-export-lines' }, ((n) => n + (n === 1 ? kt(' ligne', ' line') : kt(' lignes', ' lines')))(exportBody.split('\n').length))),
                h('pre', { className: 'kbth-export-code', 'data-kb': 'theme-export' }, exportBody)))),
          h('div', { className: 'kbth-sec' },
            sech(kt('Réinitialiser', 'Reset'), kt('Revenir aux valeurs par défaut. Tes préréglages enregistrés restent dans Les miens.', 'Back to the defaults. Your saved presets stay in Mine.')),
            h('div', { className: 'kbth-row' },
              h('button', { className: 'kbth-btn', type: 'button', 'data-kb': 'theme-reset-adv-a', onClick: () => doReset('appearance') }, kt('Apparence', 'Appearance')),
              h('button', { className: 'kbth-btn', type: 'button', 'data-kb': 'theme-reset-adv-m', onClick: () => doReset('menu') }, kt('Menu', 'Menu')),
              h('button', { className: 'kbth-btn', type: 'button', 'data-kb': 'theme-reset-adv-all', onClick: () => doReset('all') }, kt('Tout', 'Everything')))))

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
          setLibNote({ ok: true, text: kt('« ' + rec.name + ' » est installé et appliqué. Il est dans Les miens.', '“' + rec.name + '” is installed and applied. It is in Mine.') })
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
              h('div', { className: 'kbth-sec-d' }, kt('Elle est lue par Kybernos, pas par la page. Si le plugin vient d’être mis à jour, redémarre Kybernos. Tes thèmes restent disponibles dans Partage.', 'It is read by Kybernos, not by the page. If the plugin was just updated, restart Kybernos. Your themes remain available in Sharing.')),
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


        // ── The advanced editor ─────────────────────────────────────────────────────────────────────────────────────
        const ADV_CONTENT = {
          couleurs: advCol, lettres: advLettres, formes: advFormes, fond: advFond, effets: advEffets, icones: advIcones, menu: advMenu,
          animation: h(AnimationPane, { ctx: ctxRef }), accessibilite: advAccessibilite, partage: advPartage, galerie: advGalerie
        }
        const reglages = h('div', { className: 'kbth-sec' },
          h('div', { className: 'kbth-adv-cols' },
            h('div', {
              className: 'kbth-adv-tabs', role: 'tablist', 'aria-label': kt('Éditeur avancé', 'Advanced editor'),
              // The tabs pattern: ONE tab stop (the selected tab), the arrow keys, Home and End move to a tab, select it and focus it.
              onKeyDown: (e) => {
                const at = ADV_TABS.findIndex((t) => t.id === advTab)
                const to = segNav(e.key, at < 0 ? 0 : at, ADV_TABS.length)
                if (to === null || to === at) { if (to !== null) e.preventDefault(); return }
                e.preventDefault()
                setAdvTab(ADV_TABS[to].id)
                const root = e.currentTarget
                setTimeout(() => { try { const b = root.querySelector('[data-id="' + ADV_TABS[to].id + '"]'); if (b) b.focus() } catch (er) { /* the page was left */ } }, 0)
              } },
              ADV_TABS.map((t) => h('button', {
                key: t.id, type: 'button', role: 'tab', id: 'kbth-tab-' + t.id, className: 'kbth-adv-tab' + (advTab === t.id ? ' on' : ''), 'aria-selected': advTab === t.id ? 'true' : 'false', 'aria-controls': 'kbth-tabpanel',
                tabIndex: advTab === t.id ? 0 : -1, 'data-kb': 'theme-adv-tab', 'data-id': t.id,
                onClick: () => setAdvTab(t.id) }, t.label))),
            h('div', { className: 'kbth-adv-pane', role: 'tabpanel', id: 'kbth-tabpanel', 'aria-labelledby': 'kbth-tab-' + advTab },
              trialBar,
              ADV_CONTENT[advTab] || advCol)))

        // ── The apply sheet and the save sheet (next to the window, so the result shows before it is applied) ───────
        const setTicks = (patch) => setSheet({ ...sheet, ticks: { ...sheet.ticks, ...patch } })
        const tickRow = (checked, onChange, title, lines, kb) => h('label', { className: 'kbth-sh-opt', 'data-kb': kb },
          h('input', { type: 'checkbox', checked, onChange }), h('span', null, h('b', null, title), lines.filter((l) => l !== null && l !== '').map((l, i) => h('span', { key: i, className: 'kbth-sh-dl' }, l))))
        const sheetEl = sheetItem === null ? null : (() => {
          const tk = sheet.ticks
          const mDoc = presetMenuOf(sheetItem)
          const mLines = sheetItem.M ? menuLines(mDoc === null || mDoc === undefined ? null : mDoc, rowsNow) : []
          const mNote = sheetItem.M ? (sheetItem.guarded ? kt('Ce menu vient de l’extérieur : il n’est appliqué que si tu coches cette case.', 'This menu comes from outside: it is applied only if you tick this box.') : '') : ''
          const keepNote = sheetItem.M && tk.tM && sheetPlan !== null && sheetPlan.keep ? kt('Ton menu actuel est gardé dans Les miens avant, pour y revenir en un clic.', 'Your current menu is kept in Mine first, so one click goes back.') : ''
          const none = !(tk.tA && sheetItem.A) && !(tk.tM && sheetItem.M)
          return h('div', { className: 'kbth-sheet', role: 'group', 'aria-label': kt('Appliquer « ' + sheetItem.name + ' »', 'Apply “' + sheetItem.name + '”'), 'data-kb': 'theme-sheet' },
            h('div', { className: 'kbth-sh-hd' }, h('h3', null, kt('Appliquer « ' + sheetItem.name + ' »', 'Apply “' + sheetItem.name + '”')), h('button', { type: 'button', className: 'kbth-mx', 'aria-label': kt('Fermer', 'Close'), 'data-kb': 'theme-sheet-close', onClick: () => setSheet(null) }, '×')),
            sheetItem.A ? tickRow(tk.tA, () => setTicks({ tA: !tk.tA }), kt('Apparence', 'Appearance'), presetAppearanceLines(sheetItem), 'theme-sheet-a') : null,
            sheetItem.M ? tickRow(tk.tM, () => setTicks({ tM: !tk.tM }), 'Menu', mLines.concat([mNote, keepNote]), 'theme-sheet-m') : null,
            sheetItem.ACC ? tickRow(tk.tAcc, () => setTicks({ tAcc: !tk.tAcc }), kt('Accessibilité', 'Accessibility'), [kt('Contraste, mouvement, grandes cibles. C’est personnel : coché, ça reprend ce que tu avais enregistré.', 'Contrast, motion, large targets. This is personal: ticked, it takes what you had saved.')], 'theme-sheet-acc') : null,
            h('p', { className: 'kbth-sh-fine' }, kt('La fenêtre montre le résultat avant d’appliquer. Tu peux annuler, ou utiliser « Tout réafficher » dans le menu, à tout moment. Un préréglage importé ne change jamais tes réglages d’accessibilité.', 'The window shows the result before you apply it. You can undo it, or use “Show every entry” in the menu, at any time. A preset you import never changes your accessibility settings.')),
            h('div', { className: 'kbth-sh-btns' }, h('button', { type: 'button', className: 'kbth-btn kbth-ldpri', 'data-kb': 'theme-sheet-apply', disabled: none, onClick: () => applyItem(sheetItem, tk) }, kt('Appliquer ce qui est coché', 'Apply what is ticked')), h('button', { type: 'button', className: 'kbth-btn', 'data-kb': 'theme-sheet-cancel', onClick: () => setSheet(null) }, kt('Annuler', 'Cancel'))))
        })()
        const saveEl = saveSheet === null ? null : (() => {
          const sv = saveSheet
          const patchSv = (p) => setSaveSheet({ ...sv, ...p, error: '' })
          const menuText2 = rowsNow.length === 0 ? kt('le menu n’est pas affiché ici', 'the menu is not drawn here') : menuLines(lib.menu, rowsNow)[0]
          return h('div', { className: 'kbth-sheet', role: 'group', 'aria-label': kt('Enregistrer comme préréglage', 'Save as preset'), 'data-kb': 'theme-save-sheet' },
            h('div', { className: 'kbth-sh-hd' }, h('h3', null, kt('Enregistrer comme préréglage', 'Save as preset')), h('button', { type: 'button', className: 'kbth-mx', 'aria-label': kt('Fermer', 'Close'), 'data-kb': 'theme-save-close', onClick: () => setSaveSheet(null) }, '×')),
            h('input', { className: 'kbth-in' + (sv.error !== '' ? ' bad' : ''), value: sv.name, maxLength: PRESET_NAME_MAX, autoComplete: 'off', 'data-kb': 'theme-save-name', 'aria-label': kt('Nom du préréglage', 'Name of the preset'), 'aria-invalid': sv.error !== '' ? 'true' : 'false', onInput: (e) => patchSv({ name: e.target.value }), onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); doSave() } else if (e.key === 'Escape') { e.stopPropagation(); setSaveSheet(null) } } }),
            sv.error !== '' ? h('div', { className: 'kbth-bad kbth-gr-err', role: 'alert', 'data-kb': 'theme-save-error' }, sv.error) : null,
            tickRow(sv.tA, () => patchSv({ tA: !sv.tA }), kt('Apparence', 'Appearance'), [kt('Couleurs, lettres, formes, arrière-plan, effets et icônes.', 'Colors, letters, shapes, background, effects and icons.')], 'theme-save-a'),
            tickRow(sv.tM, () => patchSv({ tM: !sv.tM }), 'Menu', [kt('Quelles entrées, leur ordre et leurs noms (', 'Which entries, their order and their names (') + menuText2 + ').'], 'theme-save-m'),
            tickRow(sv.tAcc, () => patchSv({ tAcc: !sv.tAcc }), kt('Accessibilité', 'Accessibility'), [kt('Contraste, mouvement, grandes cibles. C’est personnel : laissé de côté sauf si tu le coches.', 'Contrast, motion, large targets. Personal: kept out unless you tick it.')], 'theme-save-acc'),
            h('div', { className: 'kbth-sh-btns' }, h('button', { type: 'button', className: 'kbth-btn kbth-ldpri', 'data-kb': 'theme-save-ok', disabled: !sv.tA && !sv.tM && !sv.tAcc, onClick: doSave }, kt('Enregistrer', 'Save')), h('button', { type: 'button', className: 'kbth-btn', onClick: () => setSaveSheet(null) }, kt('Annuler', 'Cancel'))))
        })()

        // ── The window (guarded: if it ever fails to draw, the advanced editor stays complete) ───────────────────────
        const studioProps = {
          S: Sv, c: cV, dark: darkV, commit: (patch, replace, transient) => { setHexDraft(null); commit(patch, replace, transient) }, preview,
          applySkin: (sk) => { setLibNote(null); setHexDraft(null); commit(skinPatch(sk)) },
          openClassic: (tab) => { setClassicOpen(true); setAdvTab(tab) }, pushHist: () => pushHist(S),
          menu: { rows: rowsNow, doc: lib.menu, pvDoc: pvMenuDoc, edit: editMenu, editSurface, showAll: menuShowEvery, setUnlisted },
          inspector: sheetEl !== null ? sheetEl : saveEl
        }
        const studioEl = StBoundary !== null ? h(StBoundary, { onFail: () => setClassicOpen(true) }, h(Studio, studioProps)) : h(Studio, studioProps)
        const presetsEl = h(PresetsBlock, {
          S, dark, rows: rowsNow, apply: applyItem, openSheet, openSave, preview, note: libNote, say, canUndo: () => histRef.current.length > 0, undo: undoStep, reset: doReset,
          surprise: doSurprise, importFile: importThemeFile, openClassic: (tab) => { setClassicOpen(true); setAdvTab(tab) }
        })

        // ── assembly — a single column ────────────────────────────────────────────────────────────────────────────
        const pageTitle = kt('Thème', 'Theme')
        const pageLead = kt('Personnalise l’apparence de Kybernos : choisis un préréglage, ou clique sur ce que tu veux changer dans la fenêtre. Tous les réglages restent dans l’éditeur avancé.', 'Customize the appearance of Kybernos: pick a preset, or click what you want to change in the window. Every setting stays in the advanced editor.')
        return h(React.Fragment, null,
          h('div', { className: 'kbth-page' },
            h('div', { className: 'kbth-main' },
              h('div', { className: 'kbth-head' },
                pageHead({ id: 'kybernos-theme', lead: pageLead, title: pageTitle, className: 'kbth-title' }),
                subFallback(pageLead)),
              conflictNote,
              presetsEl,
              studioEl,
              h('details', { className: 'kbth-st-classic', 'data-kb': 'theme-classic', open: classicOpen, onToggle: (e) => { const open = e.currentTarget.open; setClassicOpen((was) => (was === open ? was : open)) } },
                h('summary', null, kt('Éditeur avancé', 'Advanced editor'), h('span', { className: 'kbth-hint' }, kt(' · toutes les options, en onglets', ' · every option, in tabs'))),
                h('div', { className: 'kbth-foot' },
                  h('span', { className: 'kbth-pill' }, estNaturel(S) ? kt('Couleurs de Kybernos — aucun thème posé', 'Kybernos colours — no theme applied') : kt('Thème posé · clair et sombre', 'Theme applied · light and dark')),
                  h('span', { className: 'kbth-pill' }, (jetonsRetouches(S.ov) === 1 ? kt('1 couleur retouchée', '1 colour adjusted') : kt(jetonsRetouches(S.ov) + ' couleurs retouchées', jetonsRetouches(S.ov) + ' colours adjusted'))),
                  h('button', { className: 'kbth-btn', type: 'button', onClick: () => setRevision((r) => r + 1) }, kt('Actualiser le mode', 'Refresh the mode'))),
                reglages))))
      }

      // ══════════════════════════════════════════════════════════════════════
      // 6. MONTAGE.
      // ══════════════════════════════════════════════════════════════════════

      // The export contract of a cordis entry: the list of services the
      // context MUST expose — the ctx guard refuses any ctx.<service> not
      // declared here (same contract as kybernos and dream-skin). Without it,
      // the entry stays “loading” and never activates.
      return {
        inject: ['slots', 'theme', 'locale'],
        // Read-only handles for test-client.mjs (same convention as kybernos-language).
        __test: {
          makeTheme, ratio, HEX, toHex, mix, SKINS, WPS, WPCATS, FONTS, ACCS, TOKMAP, DEF, STORE_KEY,
          skinPatch, skinAccent, legacyAdopt, readState, writeState, estNaturel, accentsPropres, surprendre, sanitiserImport, schemeSombre, effetsCss, touchCss, TOUCH_RULES, TOUCH_ATTR, TOUCH_MEDIA, TOUCH_TABS, presCss, presTokens, presSync, presWalk, PRES_RULES, PRES_TOKENS, PRES_ATTR, PRES_MEDIA, lockedOptions, lockedPresentation, peekBind, PEEK_ZONE, PEEK_LINGER, pinBind, PIN_KEY, PIN_ATTR, TAB_W, TAB_H, exportTexte, filtreFond, ajustementFond, avecAlpha, valeursValides, appliquerEffets, ENUMS, RANGES, BOOLS, RADIUS_DEF, jetonsRetouches, tailleNative, appliquerTaille,
          LD_PRESETS, LD_PACKS, LD_DEF, LD_SIZES, LD_KEY, ld, ldClean, ldRead, ldSet, ldHash, ldChoose, ldChooseWord, ldWordList, ldById, ldPackById, ldNode, ldDestroy, ldCleanSvg, ldImport,
          knum, ldKo, ldDurText, ldDecorate, ldStart, ldStop, ldApplyText, ldPull, ldAddRecord, ldDelRecord, ldPutWords, ldCacheRead, AnimationPane, LdView,
          appliquerBoot, appliquerTout, appliquerJetons, appliquerFond, appliquerPolice, Page, bootSnapshot, posterBoot, retirerFeuilleBoot, jetonsDe, BOOT_ID,
          PRESET_FORMAT, PRESET_GROUPS, PRESET_KEYS, PRESET_LIMIT, PRESET_ID, LIB_KEY, lib, libClean, libRead, libWrite, libSet, libAdd, libPatch, libRemove, libPull, libFreeName, libNameTaken,
          gal, galTheme, galClean, galLoad, galRefresh, galInstalled, galInstall, galUpdate, galOnlineText, kbLang,
          presetSettings, presetRecord, presetFromState, presetFile, presetFromFileText, settingsDirty, skinSettings, groupsOf, fileSlug,
          ICON_ENTRIES, ICON_HUES, ICON_SETS, ICON_SET_IDS, iconInner, iconSvg, iconRegistry, appliquerIcones,
          optsDe, bulleDe, encreSur, BUBBLE_CHOICES, HEX_KEYS, Studio, StBoundary, ST_VIBES, ST_FONTS, ST_SIZES, ST_SPEEDS, ST_INKS, ST_ZONES, ST_RAND, stVibePatch, stLookKeys, stSurprise, stDshBubble,
          MENU_KEY, MENU_EVENT, MENU_SURFACES, menuSurfaceClean, menuHasContent, surfaceRows, surfaceView, surfaceEdit, menuSurfacesDefault, LOCKED_PRESETS, lockedMenu, menuClean, menuSame, menuUse, menuRegistry, menuRows, menuView, menuIsDefault, menuEdit, menuShowAll, menuFull, menuLines, menuLabelKey, MENU_BUILTINS, MENU_NEVER,
          selNav, segNav, KbSelect, MenuRows, SurfaceRows, MenuZones, seg, fontOptions, wallOptions, iconSetOptions, PresetsBlock, presetItems, presetRecItem, presetPlan, presetTicks, presetMenuOf, presetBuiltin, presetSwatch, presetAppearanceLines,
          seamTemplate, seamTemplateMenu, seamApplyInput,
        },
        apply(ctx) {
          // Tag macOS Electron host so hiddenInset traffic lights get clean top-left sidebar clearance.
          try {
            const ua = typeof navigator !== 'undefined' ? String(navigator.userAgent || '') : ''
            if (/Electron\//i.test(ua) && /Mac/i.test(ua)) document.documentElement.setAttribute('data-kb-electron', 'darwin')
          } catch (e) { /* non-browser */ }
          // (01/10) Label according to the current language state. The language is
          // NO LONGER carried by this bundle since 01/10: it lives in
          // @local/kybernos-language, which sets `__KB_I18N_ACTIVE__` as soon as it
          // activates. This plugin only READS the global — can be switched off without
          // breaking the theme: without language, the label falls back to French.
          // (UJ-54) French for « kybernos » and fr*; every other language (an added one: Spanish, Arabic…) reads English, as the product's strings do.
          const kbthLabel = (fr, en) => {
            try {
              const a = (typeof window !== 'undefined') ? window.__KB_I18N_ACTIVE__ : null
              const loc = (a !== null && a !== undefined && a.lang !== null && a.lang !== undefined) ? String(a.lang).toLowerCase() : ''
              return (loc === '' || loc === 'kybernos' || loc.split(/[-_]/)[0] === 'fr') ? fr : en
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

          // The presets of Mine: the disk copy, once the page is up. Never a reason for DSH not to start.
          try { setTimeout(() => { libPull(true) }, 900) } catch (e) { /* no timers */ }

          // The public seam of this bundle (A1-theme-seam): the wizard runs with Settings never opened, so a page
          // effect would be too late. Published here, guarded, and never replaced by a second activation.
          try { publierSeam(ctx) } catch (e) {
            try { console.error('[kybernos-theme] apply seam not published', e) } catch (e2) { /* console indisponible */ }
          }

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
