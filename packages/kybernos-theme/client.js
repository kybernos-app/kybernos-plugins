// kybernos-theme — moitié navigateur.
//
// Câblage de la maquette « Simple » (docs/handoff + maquette fournie) sur les
// vraies API de DSH :
//
//   mode (Système/Clair/Sombre) .... ctx.theme.setTheme()      — préférence native
//   9 thèmes prêts + accent ........ ctx.theme.overrideTokens() — 17 jetons {light,dark}
//   fond d'écran (24 fonds) ........ <div> fixe sous l'app     — motif dream-skin
//   police + taille ................ --dsw-font-family + ctx.theme.setFontSize()
//   jetons (Avancé) ................ le même overrideTokens, par paire de schémas
//
// Tout ce que cette page applique est mesuré par makeTheme (porté tel quel de
// la maquette) : l'accent dérivé vise 4,5:1 sur les DEUX schémas, jamais une
// clarté fixe.
//
// Chargé via window.__ModuleLoader__.load — même forme que les paquets ui-*.
// Le try/catch de la factory est vital : une erreur d'évaluation ici casse TOUTE
// l'entrée (« Failed to load plugins ») et laisse la GUI inutilisable. On
// dégrade : plugin désactivé, GUI préservée.
window.__ModuleLoader__.load({
  id: '@local/kybernos-theme',
  factory(require) {
    try {

      const React = require('react')
      const h = React.createElement

      // `styles` suit le contrat du runner cordis dynamique : insert(css)
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
      // 1. MOTEUR DE COULEURS — porté tel quel de la maquette Simple.
      //    Les jetons TK sont la feuille officielle DSH condensée ; makeTheme
      //    applique contraste, teinte, recouvrements, puis DÉRIVE l'accent pour
      //    viser 4,5:1 (boucles while sur ratio, pas une clarté en dur).
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

      // Feuille officielle condensée — clair / sombre, valeurs telles quelles.
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
          t.t4 = dark ? '#ADB2B8' : '#43454A' // the caption stayed at the Renforcé grey: 3.7:1 on white
          t.b2 = dark ? '#FFFFFFA6' : '#000000A6'; t.b3 = dark ? '#FFFFFFCC' : '#000000CC'; t.b4 = dark ? '#FFFFFF' : '#000000'
        }
        // Links come from DSH's own sheet (4.2:1 on white) and no level touched them: Renforcé
        // brings them to AA, Maximal to AAA, by the same walk the accent text already uses.
        if (o.lvl >= 1) { let k = 0; while (ratio(t.link, t.l1) < (o.lvl >= 2 ? 7 : 4.5) && k < 30) { t.link = mix(t.link, dark ? '#FFFFFF' : '#000000', 0.06); k++ } }
        if (o.tint > 0 && o.dom) { SURF.forEach((k) => { t[k] = mix(t[k], o.dom, o.tint / 100 * 0.16) }) }
        Object.keys(o.ov || {}).forEach((k) => { if (k.indexOf(mode + ':') === 0) { t[k.slice(mode.length + 1)] = o.ov[k] } })
        // Palette daltonisme : le couple vert/rouge devient bleu/vermillon (Okabe-Ito, distinguable par les trois
        // formes courantes de daltonisme), et ce sont bien `ok` / `err` — jetons appliqués — qui changent, pas
        // seulement leurs fonds doux. Chaque encre garde ≥ 5:1 sur la couche 1 (testé).
        if (o.cb) {
          t.ok = dark ? '#56B4E9' : '#0072B2'; t.err = dark ? '#FF8A3D' : '#B84A00'
          t.okSoft = dark ? '#10263F' : '#E3EEFF'; t.errSoft = dark ? '#3D2A10' : '#FFEBD6'
        }
        let acc = o.acc || t.brand
        // Un accent qui se fond dans la surface (le noir du dernier rond, sur le thème sombre) rend
        // boutons et interrupteurs invisibles : on l'éclaircit, dans CE schéma seulement, jusqu'à 3:1.
        if (o.acc || (o.ov && o.ov[mode + ':brand'])) { let q = 0; while (ratio(acc, t.l1) < 3 && q < 30) { acc = mix(acc, dark ? '#FFFFFF' : '#000000', 0.08); q++ } }
        let fill = acc, on = t.onBrand
        if (o.acc || (o.ov && o.ov[mode + ':brand'])) {
          if (lum(acc) > 0.35) { on = '#0F1115' } else { on = '#FFFFFF'; let j = 0; while (ratio('#FFFFFF', fill) < 4.5 && j < 24) { fill = mix(fill, '#000000', 0.05); j++ } }
        }
        let at = o.acc ? acc : t.link, i = 0
        while (ratio(at, t.l1) < 4.5 && i < 30) { at = mix(at, dark ? '#FFFFFF' : '#000000', 0.06); i++ }
        t.brand = acc; t.acc = acc; t.fill = fill; t.onAcc = on; t.accText = at
        t.accSoft = rgba(acc, dark ? 0.2 : 0.1); t.accRing = rgba(acc, 0.5)
        return t
      }

      // ══════════════════════════════════════════════════════════════════════
      // 2. CATALOGUE — thèmes prêts, fonds, accents, polices, jetons.
      //    Tout vient de la maquette, à l'identique.
      // ══════════════════════════════════════════════════════════════════════

      const SKINS = [
        { id: 'dsh', name: 'Défaut DSH', mode: 'dark', acc: null, wp: 'none', vis: 60 },
        { id: 'bleu', name: 'Bleu profond', mode: 'dark', acc: '#4176E6', wp: 'nuit', vis: 70 },
        { id: 'aurore', name: 'Aurore', mode: 'dark', acc: '#2DD4BF', wp: 'aurore', vis: 60 },
        { id: 'nebuleuse', name: 'Nébuleuse', mode: 'dark', acc: '#A855F7', wp: 'nebuleuse', vis: 60 },
        { id: 'ambre', name: 'Ambre', mode: 'dark', acc: '#F59E0B', wp: 'ambre', vis: 60 },
        { id: 'oled', name: 'Minuit OLED', mode: 'dark', acc: null, wp: 'noir', vis: 100 },
        { id: 'papier', name: 'Papier', mode: 'light', acc: '#4176E6', wp: 'seyes', vis: 55 },
        { id: 'clair', name: 'Clair net', mode: 'light', acc: null, wp: 'none', vis: 60 },
        // Neutral light theme: white panels, grey fields, one violet accent, Inter. Surfaces measured on a
        // light admin dashboard; the engine still lifts the accent to 4.5:1 wherever text sits on it.
        { id: 'neutre', name: 'Neutre violet', mode: 'light', acc: '#6114D4', wp: 'none', vis: 60, fontText: 'inter', radius: 'standard',
          ov: { 'light:base': '#FAFAFA', 'light:l1': '#FFFFFF', 'light:l2': '#F5F5F5', 'light:l3': '#FFFFFF', 'light:side': '#FFFFFF', 'light:input': '#F2F2F2', 'light:t1': '#101010' } },
        { id: 'rose', name: 'Rose', mode: 'light', acc: '#EC4899', wp: 'peche', vis: 60 },

        // ── Palettes héritées de « Colour Pack » v1 (ancien onglet Kybernos) ──
        // Les 8 packs sont portés à l'identique — mêmes noms, mêmes surfaces,
        // mêmes accents — mais PAR SCHÉMA, par le vocabulaire `ov` de cette page
        // (celui que l'onglet Avancé écrit déjà) :
        //   mode: null → le pack n'impose pas de mode ; il suit Système / Clair /
        //                Sombre comme le faisait le v1 ;
        //   acc: null  → l'accent vient de `ov[mode+':brand']`, donc la valeur
        //                exacte du pack dans chaque schéma ; le moteur dérive
        //                ensuite `fill`/`on` pour garder le libellé lisible.
        // Rôles v1 → jetons v2 : bg→base, layer1→l1, layer2→l2, sidebar→side,
        // overlay→input, sidebar→code, accent→brand (par schéma).
        // Non repris du v1 : les bordures (b1/b2) et les corrections de texte et
        // d'états, communes aux 8 packs : hors des 17 jetons pilotables ici, et
        // désormais dérivées par le moteur (contraste mesuré).
        { id: 'kb-ember', name: 'Braise', mode: null, acc: null, wp: 'none', vis: 60,
          ov: {
            'light:base': '#faf5ef', 'light:l1': '#ffffff', 'light:l2': '#f5ede3',
            'light:side': '#f3ece1', 'light:input': '#ffffff', 'light:code': '#f3ece1',
            'light:brand': '#c1552f', 'dark:base': '#191513', 'dark:l1': '#201b18',
            'dark:l2': '#2a231f', 'dark:side': '#1c1815', 'dark:input': '#221d1a',
            'dark:code': '#1c1815', 'dark:brand': '#e2805a',
          } },
        { id: 'kb-stone-cloud', name: 'Pierre & Nuage', mode: null, acc: null, wp: 'none', vis: 60,
          ov: {
            'light:base': '#fafafa', 'light:l1': '#ffffff', 'light:l2': '#f1f1ef',
            'light:side': '#f0f0ed', 'light:input': '#ffffff', 'light:code': '#f0f0ed',
            'light:brand': '#64748b', 'dark:base': '#141517', 'dark:l1': '#1c1d20',
            'dark:l2': '#26282c', 'dark:side': '#18191c', 'dark:input': '#1e2023',
            'dark:code': '#18191c', 'dark:brand': '#94a3b8',
          } },
        { id: 'kb-indigo-pulse', name: 'Pulsation indigo', mode: null, acc: null, wp: 'none', vis: 60,
          ov: {
            'light:base': '#f8f8fd', 'light:l1': '#ffffff', 'light:l2': '#eef0fb',
            'light:side': '#edeffa', 'light:input': '#ffffff', 'light:code': '#edeffa',
            'light:brand': '#4f46e5', 'dark:base': '#131320', 'dark:l1': '#1b1b2b',
            'dark:l2': '#242438', 'dark:side': '#171728', 'dark:input': '#1d1d2e',
            'dark:code': '#171728', 'dark:brand': '#818cf8',
          } },
        { id: 'kb-midnight-pulse', name: 'Pulsation minuit', mode: null, acc: null, wp: 'none', vis: 60,
          ov: {
            'light:base': '#f6f8fc', 'light:l1': '#ffffff', 'light:l2': '#eaeff8',
            'light:side': '#e8eef8', 'light:input': '#ffffff', 'light:code': '#e8eef8',
            'light:brand': '#1e40af', 'dark:base': '#101623', 'dark:l1': '#171e2e',
            'dark:l2': '#1f283b', 'dark:side': '#131a28', 'dark:input': '#192231',
            'dark:code': '#131a28', 'dark:brand': '#60a5fa',
          } },
        { id: 'kb-olive-grove', name: 'Olivaie', mode: null, acc: null, wp: 'none', vis: 60,
          ov: {
            'light:base': '#f8faf1', 'light:l1': '#ffffff', 'light:l2': '#eff3e2',
            'light:side': '#eef2e0', 'light:input': '#ffffff', 'light:code': '#eef2e0',
            'light:brand': '#5f7a28', 'dark:base': '#141610', 'dark:l1': '#1c1f18',
            'dark:l2': '#262a21', 'dark:side': '#181b14', 'dark:input': '#1e2219',
            'dark:code': '#181b14', 'dark:brand': '#a3c060',
          } },
        { id: 'kb-aurora-bloom', name: 'Aube florale', mode: null, acc: null, wp: 'none', vis: 60,
          ov: {
            'light:base': '#fdf6f9', 'light:l1': '#ffffff', 'light:l2': '#f9ebf2',
            'light:side': '#f8eaf1', 'light:input': '#ffffff', 'light:code': '#f8eaf1',
            'light:brand': '#d5286c', 'dark:base': '#1a1216', 'dark:l1': '#221820',
            'dark:l2': '#2d202a', 'dark:side': '#1e151a', 'dark:input': '#251b22',
            'dark:code': '#1e151a', 'dark:brand': '#f472b6',
          } },
        { id: 'kb-sunset-dream', name: 'Rêve de crépuscule', mode: null, acc: null, wp: 'none', vis: 60,
          ov: {
            'light:base': '#fdf9f1', 'light:l1': '#ffffff', 'light:l2': '#f9f0df',
            'light:side': '#f8efdc', 'light:input': '#ffffff', 'light:code': '#f8efdc',
            'light:brand': '#d97706', 'dark:base': '#191510', 'dark:l1': '#221d16',
            'dark:l2': '#2d271d', 'dark:side': '#1e1913', 'dark:input': '#251f17',
            'dark:code': '#1e1913', 'dark:brand': '#fbbf24',
          } },
        { id: 'kb-plum-haze', name: 'Brume de prune', mode: null, acc: null, wp: 'none', vis: 60,
          ov: {
            'light:base': '#faf7fe', 'light:l1': '#ffffff', 'light:l2': '#f2ecfb',
            'light:side': '#f1ebfa', 'light:input': '#ffffff', 'light:code': '#f1ebfa',
            'light:brand': '#7c3aed', 'dark:base': '#17121f', 'dark:l1': '#211a2d',
            'dark:l2': '#2b2339', 'dark:side': '#1c1626', 'dark:input': '#241c31',
            'dark:code': '#1c1626', 'dark:brand': '#a78bfa',
          } }
      ]

      const WPS = [
        { id: 'none', cat: 'none', name: 'Aucun', css: 'none', dom: '' },
        { id: 'noir', cat: 'colors', name: 'Noir OLED', css: '#000000', dom: '#81858C' },
        { id: 'encre', cat: 'colors', name: 'Encre', css: '#0F1115', dom: '#81858C' },
        { id: 'ardoise', cat: 'colors', name: 'Ardoise', css: '#2C2C2E', dom: '#81858C' },
        { id: 'nuit', cat: 'colors', name: 'Bleu nuit', css: '#172554', dom: '#4176E6' },
        { id: 'foret', cat: 'colors', name: 'Forêt', css: '#0F2A22', dom: '#22A06B' },
        { id: 'prune', cat: 'colors', name: 'Prune', css: '#2A1638', dom: '#A855F7' },
        { id: 'sable', cat: 'colors', name: 'Sable', css: '#E8DFD3', dom: '#B45309' },
        { id: 'brume', cat: 'colors', name: 'Brume', css: '#E9ECF2', dom: '#61666B' },
        { id: 'aurore', cat: 'gradients', name: 'Fond Aurore', css: 'radial-gradient(90% 70% at 15% 10%, #2dd4bf66, transparent 60%), radial-gradient(80% 70% at 90% 20%, #6366f199, transparent 55%), linear-gradient(160deg,#0b1220,#0f2a3a)', dom: '#2DD4BF' },
        { id: 'crepuscule', cat: 'gradients', name: 'Crépuscule', css: 'radial-gradient(90% 70% at 85% 0%, #fb923caa, transparent 55%), radial-gradient(80% 80% at 10% 100%, #7c3aed99, transparent 60%), linear-gradient(180deg,#1e1b4b,#3b1d4a)', dom: '#FB923C' },
        { id: 'nebuleuse', cat: 'gradients', name: 'Fond Nébuleuse', css: 'radial-gradient(60% 55% at 30% 30%, #a855f7aa, transparent 62%), radial-gradient(55% 55% at 75% 72%, #38bdf8aa, transparent 62%), #120a24', dom: '#A855F7' },
        { id: 'ocean', cat: 'gradients', name: 'Océan', css: 'linear-gradient(160deg,#0c4a6e,#0e7490 55%,#134e4a)', dom: '#0E7490' },
        { id: 'ambre', cat: 'gradients', name: 'Fond Ambre', css: 'radial-gradient(80% 70% at 80% 10%, #f59e0baa, transparent 60%), linear-gradient(170deg,#1c1108,#3a1f0a)', dom: '#F59E0B' },
        { id: 'menthe', cat: 'gradients', name: 'Menthe', css: 'linear-gradient(135deg,#d1fae5,#a7f3d0 50%,#bae6fd)', dom: '#34D399' },
        { id: 'peche', cat: 'gradients', name: 'Pêche', css: 'linear-gradient(135deg,#ffe4e6,#fed7aa)', dom: '#FB7185' },
        { id: 'brumeg', cat: 'gradients', name: 'Brume claire', css: 'linear-gradient(180deg,#f8fafc,#dbe4f0)', dom: '#94A3B8' },
        { id: 'carreaux', cat: 'patterns', name: 'Petits carreaux', css: 'linear-gradient(#bfd0ee 1px,transparent 1px) 0 0/18px 18px, linear-gradient(90deg,#bfd0ee 1px,transparent 1px) 0 0/18px 18px, #ffffff', dom: '#4176E6' },
        { id: 'carreaux-lg', cat: 'patterns', name: 'Grands carreaux', css: 'linear-gradient(#c8d6e5 1px,transparent 1px) 0 0/32px 32px, linear-gradient(90deg,#c8d6e5 1px,transparent 1px) 0 0/32px 32px, #f0f4f8', dom: '#4176E6' },
        { id: 'carreaux-sombre', cat: 'patterns', name: 'Carreaux nuit', css: 'linear-gradient(#ffffff12 1px,transparent 1px) 0 0/24px 24px, linear-gradient(90deg,#ffffff12 1px,transparent 1px) 0 0/24px 24px, #0f1115', dom: '#679EFE' },
        { id: 'seyes', cat: 'patterns', name: 'Seyès', css: 'linear-gradient(90deg,transparent 47px,#f0a3a3 47px,#f0a3a3 49px,transparent 49px), linear-gradient(90deg,#dbe4f7 1px,transparent 1px) 0 0/32px 32px, linear-gradient(#c5d2ee 1px,transparent 1px) 0 0/32px 8px, #ffffff', dom: '#4176E6' },
        { id: 'points', cat: 'patterns', name: 'Points', css: 'radial-gradient(#94a3b8 1px,transparent 1.6px) 0 0/16px 16px, #f8fafc', dom: '#61666B' },
        { id: 'milli', cat: 'patterns', name: 'Millimétré', css: 'linear-gradient(#cbd5e1 1px,transparent 1px) 0 0/40px 40px, linear-gradient(90deg,#cbd5e1 1px,transparent 1px) 0 0/40px 40px, linear-gradient(#e2e8f0 1px,transparent 1px) 0 0/8px 8px, linear-gradient(90deg,#e2e8f0 1px,transparent 1px) 0 0/8px 8px, #f8fafc', dom: '#61666B' },
        { id: 'lignes', cat: 'patterns', name: 'Lignes', css: 'repeating-linear-gradient(0deg,#f1f3f5 0 23px,#dfe3e8 23px 24px)', dom: '#81858C' },
        { id: 'plan', cat: 'patterns', name: 'Plan bleu', css: 'linear-gradient(#ffffff1a 1px,transparent 1px) 0 0/20px 20px, linear-gradient(90deg,#ffffff1a 1px,transparent 1px) 0 0/20px 20px, #0e3074', dom: '#4176E6' },
        { id: 'diag', cat: 'patterns', name: 'Diagonales', css: 'repeating-linear-gradient(45deg,#1b1b1c 0 10px,#232324 10px 20px)', dom: '#81858C' },
        { id: 'kraft', cat: 'patterns', name: 'Kraft', css: 'radial-gradient(#00000014 1px,transparent 1.4px) 0 0/6px 6px, #d8c4a0', dom: '#B45309' },
        { id: 'iaurore', cat: 'images', name: 'Aurore boréale', css: 'radial-gradient(60% 28% at 38% 42%, #34d39988, transparent 70%), radial-gradient(50% 24% at 66% 36%, #a78bfa77, transparent 70%), radial-gradient(130% 42% at 50% 118%, #02060c 62%, transparent 63%), linear-gradient(180deg,#050a18,#0b2a3a 65%)', dom: '#34D399' },
        { id: 'icoucher', cat: 'images', name: 'Coucher de soleil', css: 'radial-gradient(28% 34% at 50% 66%, #fde68a, #fb923c 45%, transparent 72%), radial-gradient(130% 40% at 50% 120%, #1c0f2a 60%, transparent 61%), linear-gradient(180deg,#312e81,#be185d 58%,#fb923c)', dom: '#FB923C' },
        { id: 'idunes', cat: 'images', name: 'Dunes', css: 'radial-gradient(90% 42% at 18% 112%, #c2410c 58%, transparent 59%), radial-gradient(90% 46% at 88% 116%, #ea580c 58%, transparent 59%), linear-gradient(180deg,#fde68a,#fdba74)', dom: '#EA580C' },
        { id: 'iforet', cat: 'images', name: 'Forêt brumeuse', css: 'radial-gradient(120% 50% at 30% 112%, #0b2e22 58%, transparent 59%), radial-gradient(110% 46% at 85% 110%, #134e3a 58%, transparent 59%), linear-gradient(180deg,#cfe8dc,#8fbfa8 60%,#3b7a62)', dom: '#22A06B' },
        { id: 'iespace', cat: 'images', name: 'Espace', css: 'radial-gradient(1.2px 1.2px at 12% 22%, #fff, transparent), radial-gradient(1px 1px at 38% 64%, #fff, transparent), radial-gradient(1.4px 1.4px at 70% 30%, #fff, transparent), radial-gradient(1px 1px at 84% 74%, #fff, transparent), radial-gradient(50% 45% at 30% 40%, #7c3aed66, transparent 65%), radial-gradient(50% 45% at 78% 70%, #0ea5e955, transparent 65%), #06040f', dom: '#7C3AED' },
        { id: 'iencre', cat: 'images', name: 'Lavis d’encre', css: 'radial-gradient(50% 60% at 30% 40%, #ffffff22, transparent 65%), radial-gradient(45% 55% at 72% 62%, #ffffff14, transparent 65%), #0f1115', dom: '#81858C' }
      ]
      const WPCATS = [
        { id: 'colors', name: 'Couleurs' },
        { id: 'gradients', name: 'Dégradés' },
        { id: 'patterns', name: 'Motifs' },
        { id: 'images', name: 'Images' }
      ]

      // Les 17 jetons que cette page sait piloter, mappés sur les vraies
      // variables DSH (contrat TOKG de la maquette).
      const TOKMAP = [
        ['base', 'Fond de base', 'alias-bg-base'],
        ['l1', 'Couche 1', 'alias-bg-layer-1'],
        ['l2', 'Couche 2', 'alias-bg-layer-2'],
        ['l3', 'Couche 3', 'alias-bg-layer-3'],
        ['side', 'Barre latérale', 'specific-sidebar-fill'],
        ['input', 'Champ de saisie', 'specific-input-major'],
        ['code', 'Bloc de code', 'alias-markdown-code-block'],
        ['t1', 'Texte principal', 'alias-label-primary'],
        ['t2', 'Texte secondaire', 'alias-label-secondary'],
        ['t3', 'Texte tertiaire', 'alias-label-tertiary'],
        ['t4', 'Légende', 'alias-label-caption'],
        ['link', 'Lien', 'alias-link'],
        ['err', 'Erreur', 'alias-state-error-primary'],
        ['ok', 'Succès', 'alias-state-success-primary'],
        ['warn', 'Alerte', 'alias-state-warn-primary'],
        ['biz', 'Information', 'alias-state-business-primary'],
        ['brand', 'Accent (marque)', 'alias-brand-primary']
      ]
      const TOKINDEX = {}
      TOKMAP.forEach((e) => { TOKINDEX[e[0]] = e })

      const ACCS = ['#4176E6', '#679EFE', '#2DD4BF', '#22A06B', '#34D399', '#F59E0B', '#FB923C', '#EC4899', '#A855F7', '#7C3AED', '#0EA5E9', '#0F1115']

      // Polices — piles système éprouvées (même mécanisme que le pack police
      // kybernos : --dsw-font-family sur :root).
      // Catalogue = les 9 polices du studio + les 21 de l'ancien « Colour Pack »
      // (kybernos-plugin) : rien ne disparaît, l'ordre suit les groupes
      // sans / serif / mono de la page supprimée.
      const FONTS = [
        // Sans serif
        { id: 'dsh', name: 'DSH (défaut)', stack: null },
        { id: 'system-ui', name: 'Système', stack: 'system-ui, -apple-system, sans-serif' },
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
        { id: 'mono', name: 'Mono système', stack: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
        { id: 'plex-mono', name: 'IBM Plex Mono', stack: "'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace" },
        { id: 'jetbrains-mono', name: 'JetBrains Mono', stack: "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace" },
        { id: 'sf-mono', name: 'SF Mono', stack: "'SF Mono', ui-monospace, Menlo, monospace" },
        { id: 'menlo', name: 'Menlo', stack: 'Menlo, monospace' },
        { id: 'fira-code', name: 'Fira Code', stack: "'Fira Code', ui-monospace, Menlo, monospace" },
        { id: 'source-code', name: 'Source Code Pro', stack: "'Source Code Pro', ui-monospace, Menlo, monospace" },
        { id: 'courier', name: 'Courier New', stack: "'Courier New', Courier, monospace" }
      ]

      // Ce qu'applique un skin — UNE seule définition, partagée par le clic du
      // sélecteur et par la reprise des réglages v1 ci-dessous.
      //   • `ov` est TOUJOURS posé : sans cela les jetons d'un pack hérité
      //     survivraient au retour sur « Défaut DSH » (qui promet de retirer la
      //     couche), et l'édition Avancée d'un thème précédent aussi.
      //   • `mode` n'est posé que si le skin en impose un : les packs hérités
      //     (mode null) suivent le réglage Système / Clair / Sombre.
      const skinPatch = (sk) => {
        const patch = { skin: sk.id, acc: sk.acc, wp: sk.wp, wpVis: sk.vis, ov: sk.ov || {} }
        if (sk.mode !== null && sk.mode !== undefined) patch.mode = sk.mode
        // A shipped theme may also set the font and the corners; the older ones leave both alone.
        if (sk.fontText !== undefined) patch.fontText = sk.fontText
        if (sk.radius !== undefined) patch.radius = sk.radius
        return patch
      }
      // L'accent affiché d'un skin : sa valeur directe, sinon celle de sa
      // palette par schéma (packs hérités). Sert au rond et à la légende.
      const skinAccent = (sk) => (sk.acc !== null && sk.acc !== undefined)
        ? sk.acc
        : (((sk.ov || {})['light:brand']) || null)

      // ── Reprise unique des réglages de l'ancien « Colour Pack » (v1) ───────
      // L'onglet Kybernos qui portait ce système a été supprimé : ses deux clés
      // (`kybernos.pack`, `kybernos.font`) restent telles quelles dans le
      // navigateur. Au PREMIER démarrage sans état v2, on les adopte au lieu de
      // repartir des défauts — sinon un pack ou une police choisis avant la
      // migration seraient perdus en silence. Aucune écriture : la reprise est
      // recalculée à chaque lecture tant que l'utilisateur n'a rien modifié,
      // donc elle reste idempotente et ne fige pas son choix.
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
        } catch (e) { /* stockage indisponible : on garde les défauts */ }
        return patch
      }

      // ══════════════════════════════════════════════════════════════════════
      // 3. ÉTAT + PERSISTANCE.
      //    localStorage suffit au profil web ; l'hôte prendra le relais en v2
      //    (DSH Desktop tire des ports aléatoires — le constat wallpaper-engine).
      // ══════════════════════════════════════════════════════════════════════

      const STORE_KEY = 'kybernos.theme.v1'
      // Chaque clé ici est LUE par un câble (jetons, fond, feuille d'effets) : une commande dont la clé
      // manquerait ici s'afficherait, ne s'appliquerait pas et se perdrait au rechargement (41 l'étaient).
      // Le test `test-client.mjs` refuse désormais toute commande sans clé.
      const DEF = {
        mode: 'dark', skin: 'dsh', acc: null,
        wp: 'none', wpVis: 60, wpBlur: 0, tint: 0,
        fs: 15, fontText: 'dsh', ov: {}, contrastMode: 'standard', cbSafe: false,
        // Verre et fond
        glassEffect: 'frosted', glassBlur: 18, sidebarLinked: true, sidebarOpacity: 25, fieldOpacity: 20, floatOpacity: 10,
        bgBrightness: 100, bgContrast: 100, bgSaturation: 100, bgDarken: 0, bgFit: 'cover', bgMirror: false,
        // Texte et forme
        ligatures: true, radius: 'standard', showBrand: true,
        // Accessibilité
        reduceMotion: false, focusRing: 'accent', largeTargets: false, underlineLinks: false
      }
      const ENUMS = { glassEffect: ['frosted', 'liquid'], bgFit: ['cover', 'fill', 'center', 'stretch'], radius: ['sharp', 'standard', 'soft'], focusRing: ['accent', 'double', 'thick'] }
      const RANGES = { glassBlur: [0, 40], sidebarOpacity: [0, 100], fieldOpacity: [0, 100], floatOpacity: [0, 100], bgBrightness: [0, 200], bgContrast: [0, 200], bgSaturation: [0, 200], bgDarken: [0, 100] }
      const BOOLS = ['cbSafe', 'sidebarLinked', 'bgMirror', 'ligatures', 'showBrand', 'reduceMotion', 'largeTargets', 'underlineLinks']
      /** Les réglages à choix, à plage ou booléens d'un objet quelconque : seules les valeurs VALIDES en sortent. */
      const valeursValides = (raw) => {
        const out = {}
        Object.keys(ENUMS).forEach((k) => { if (ENUMS[k].indexOf(raw[k]) >= 0) out[k] = raw[k] })
        Object.keys(RANGES).forEach((k) => { if (typeof raw[k] === 'number' && Number.isFinite(raw[k])) out[k] = Math.max(RANGES[k][0], Math.min(RANGES[k][1], Math.round(raw[k]))) })
        BOOLS.forEach((k) => { if (typeof raw[k] === 'boolean') out[k] = raw[k] })
        return out
      }
      /** Ce qu'un fichier importé a le droit de poser : uniquement des clés connues, de type et de
       *  plage valides. Rend `null` si le fichier n'est pas un objet. Une valeur douteuse est ignorée
       *  (jamais écrite) : `{"ov":null}` faisait planter la section entière. */
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

      // ── Export : le MÊME état, en trois formats réels ─────────────────────────────────────────────
      const yamlScalaire = (v) => (v === null ? 'null' : (typeof v === 'string' ? JSON.stringify(v) : String(v)))
      const exportEtat = (S) => { const o = {}; Object.keys(DEF).forEach((k) => { o[k] = S[k] }); return o }
      /** `format` : 'json' | 'yaml' | 'css'. Rend le texte du fichier. */
      const exportTexte = (format, S) => {
        if (format === 'json') return JSON.stringify(exportEtat(S), null, 2)
        if (format === 'yaml') {
          const o = exportEtat(S)
          const lines = ['# Kybernos · Thème — réimportable en JSON, lisible ici', 'theme:']
          Object.keys(o).forEach((k) => {
            if (k === 'ov') {
              const keys = Object.keys(o.ov)
              if (keys.length === 0) lines.push('  ov: {}')
              else { lines.push('  ov:'); keys.forEach((kk) => lines.push('    ' + JSON.stringify(kk) + ': ' + yamlScalaire(o.ov[kk]))) }
            } else lines.push('  ' + k + ': ' + yamlScalaire(o[k]))
          })
          return lines.join('\n')
        }
        // css : les 17 jetons, clair puis sombre — un fichier à coller dans un thème tiers
        const wpo = WPS.find((w) => w.id === S.wp) || WPS[0]
        const lvl = S.contrastMode === 'max' ? 2 : (S.contrastMode === 'plus' ? 1 : 0)
        const o = { acc: S.acc, ov: S.ov, lvl, cb: S.cbSafe, tint: wpo.id !== 'none' ? S.tint : 0, dom: wpo.dom }
        const bloc = (mode) => { const t = makeTheme(mode, o); return TOKMAP.map((e) => '  --dsw-' + e[2] + ': ' + t[e[0]] + ';').join('\n') }
        return '/* Kybernos · Thème (' + (S.skin || 'custom') + ') — jetons DSH, clair puis sombre */\n:root,\nbody:not([data-ds-dark-theme]) {\n' + bloc('light') + '\n}\nbody[data-ds-dark-theme] {\n' + bloc('dark') + '\n}'
      }

      const readState = () => {
        try {
          const raw = localStorage.getItem(STORE_KEY)
          if (raw === null) return { ...DEF, ...legacyAdopt() }
          const s = JSON.parse(raw)
          const out = { ...DEF }
          for (const k of Object.keys(DEF)) if (s[k] !== undefined) out[k] = s[k]
          if (out.ov === null || typeof out.ov !== 'object') out.ov = {}
          // Une valeur stockée abîmée (à la main, ou par une version plus ancienne) retombe sur le défaut.
          const ok = valeursValides(s)
          Object.keys(ENUMS).concat(Object.keys(RANGES), BOOLS).forEach((k) => { out[k] = ok[k] !== undefined ? ok[k] : DEF[k] })
          return out
        } catch (e) { return { ...DEF } }
      }
      const writeState = (s) => { try { localStorage.setItem(STORE_KEY, JSON.stringify(s)) } catch (e) { /* quota */ } }

      // ══════════════════════════════════════════════════════════════════════
      // 4. APPLICATION — les vrais câbles.
      // ══════════════════════════════════════════════════════════════════════

      let layerDispose = null   // overrideTokens
      let wpEl = null           // fond d'écran
      let fontDispose = null    // police

      /** Combien de jetons ont une retouche (clair et/ou sombre comptent pour un). */
      const jetonsRetouches = (ov) => new Set(Object.keys(ov).map((k) => k.slice(k.indexOf(':') + 1))).size

      /** Le schéma réellement AFFICHÉ. « Système » suit l'OS : déduire le schéma du seul réglage (`mode !== 'light'`)
       *  donnait toujours « sombre » à quelqu'un en « Système » sur un OS clair, et la page mesurait des encres
       *  sombres sur un fond clair. On lit l'attribut que DSH pose sur <body>, et on ne se rabat sur le réglage
       *  que s'il n'y a pas de page (rendu hors navigateur). */
      const schemeSombre = (S) => {
        try { if (document.body && typeof document.body.hasAttribute === 'function') return document.body.hasAttribute('data-ds-dark-theme') } catch (e) { /* pas de page */ }
        return S.mode !== 'light'
      }

      const estNaturel = (S) => S.skin === 'dsh' && S.acc === null && S.wp === 'none'
        && Object.keys(S.ov).length === 0 && S.contrastMode === 'standard' && S.radius === 'standard' && S.cbSafe === false

      // ── Fond d'écran : filtres, ajustement (aussi utilisés par l'aperçu du verre) ─────────────
      const filtreFond = (S) => {
        const f = []
        if (S.wpBlur > 0) f.push('blur(' + S.wpBlur + 'px)')
        const br = (S.bgBrightness / 100) * (1 - S.bgDarken / 100)
        if (Math.abs(br - 1) > 0.005) f.push('brightness(' + br.toFixed(3) + ')')
        if (S.bgContrast !== 100) f.push('contrast(' + S.bgContrast + '%)')
        if (S.bgSaturation !== 100) f.push('saturate(' + S.bgSaturation + '%)')
        return f.length > 0 ? f.join(' ') : 'none'
      }
      /** Taille / position / répétition d'un fond. Les motifs et les couleurs portent leur taille dans leur shorthand. */
      const ajustementFond = (S) => {
        if (S.bgFit === 'fill') return { size: 'contain', position: 'center', repeat: 'no-repeat' }
        if (S.bgFit === 'center') return { size: 'auto', position: 'center', repeat: 'no-repeat' }
        if (S.bgFit === 'stretch') return { size: '100% 100%', position: 'center', repeat: 'no-repeat' }
        return { size: 'cover', position: 'center', repeat: 'no-repeat' }
      }
      const avecAlpha = (hex, a) => toHex(HEX(hex) || [0, 0, 0]) + Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0')
      const RADIUS_DEF = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, panel: 28 }
      const RADIUS_ECHELLE = { sharp: 0.25, standard: 1, soft: 1.5 }

      /** La couche de jetons : 17 variables, une paire {light, dark} chacune.
       *  En configuration natives, la couche est retirée — le DSH d'origine
       *  passe alors tel quel, sans même une redondance par-dessus. */
      const appliquerJetons = (themeSvc, S) => {
        if (layerDispose !== null) { try { layerDispose() } catch (e) { /* déjà retirée */ } layerDispose = null }
        if (estNaturel(S)) return
        const lvl = S.contrastMode === 'max' ? 2 : (S.contrastMode === 'plus' ? 1 : 0)
        const wpo = WPS.find((w) => w.id === S.wp) || WPS[0]
        const o = { acc: S.acc, ov: S.ov, lvl, cb: S.cbSafe, tint: wpo.id !== 'none' ? S.tint : 0, dom: wpo.dom }
        const cl = makeTheme('light', o), cd = makeTheme('dark', o)
        const jetons = {}
        for (const [k, , css] of TOKMAP) jetons['--dsw-' + css] = { light: cl[k], dark: cd[k] }
        // Un fond qu'on ne voit pas ne sert à rien : la zone principale de DSH (`bg-base`) peint un aplat
        // opaque PAR-DESSUS lui (mesuré : 375 points sur 375 couverts). Quand un fond est choisi, `bg-base`
        // devient transparent — c'est le curseur « Visibilité » qui dose alors le fond contre la couleur de base.
        // Seule la pastille d'espace du pied de barre latérale s'en servait comme couleur de TEXTE
        // (corrigé dans kybernos-cloud) ; sur toutes les pages parcourues, rien d'autre.
        if (wpo.id !== 'none') {
          jetons['--dsw-alias-bg-base'] = { light: avecAlpha(cl.base, 0), dark: avecAlpha(cd.base, 0) }
          if (S.sidebarLinked) jetons['--dsw-specific-sidebar-fill'] = { light: avecAlpha(cl.side, 1 - S.sidebarOpacity / 100), dark: avecAlpha(cd.side, 1 - S.sidebarOpacity / 100) }
          jetons['--dsw-specific-input-major'] = { light: avecAlpha(cl.input, 1 - S.fieldOpacity / 100), dark: avecAlpha(cd.input, 1 - S.fieldOpacity / 100) }
          jetons['--dsw-specific-menu'] = { light: avecAlpha(cl.l3, 1 - S.floatOpacity / 100), dark: avecAlpha(cd.l3, 1 - S.floatOpacity / 100) }
        }
        if (S.radius !== 'standard') {
          Object.keys(RADIUS_DEF).forEach((n) => { const v = Math.max(0, Math.round(RADIUS_DEF[n] * RADIUS_ECHELLE[S.radius])) + 'px'; jetons['--dsw-radius-' + n] = { light: v, dark: v } })
        }
        try { layerDispose = themeSvc.overrideTokens('kybernos-theme', jetons) } catch (e) { layerDispose = null }
      }

      /** Le fond d'écran : une div fixe sous l'application (motif éprouvé
       *  dream-skin), plus une teinte des surfaces quand il est actif.
       *  Le corps du document peut ne pas exister encore à l'activation du
       *  plugin : on attend alors DOMContentLoaded au lieu d'avaler l'erreur —
       *  mesuré, sans cela la couche de jetons s'appliquait mais le fond, la
       *  police et la taille étaient silencieusement sautés. */
      const appliquerFond = (S) => {
        const poser = () => {
          const wpo2 = WPS.find((w) => w.id === S.wp) || WPS[0]
          if (wpo2.id === 'none') {
            if (wpEl !== null) { try { wpEl.remove() } catch (e) { /* déjà retiré */ } wpEl = null }
            return
          }
          if (wpEl === null || !document.body.contains(wpEl)) {
            wpEl = document.createElement('div')
            wpEl.style.cssText = 'position:fixed;inset:0;z-index:-1;pointer-events:none;'
            document.body.prepend(wpEl)
          }
          // IMPORTANT : certains fonds utilisent la syntaxe shorthand
          // (position/taille dans la même chaîne, ex: "gradient 0 0/32px 32px").
          // Cette syntaxe n'est valide que sur la propriété `background`,
          // pas sur `backgroundImage`. On pose d'abord le shorthand,
          // puis on override les propriétés individuelles si nécessaire.
          wpEl.style.background = wpo2.css
          const isPattern = wpo2.cat === 'patterns' || wpo2.cat === 'colors'
          // Motifs et couleurs : le shorthand porte déjà taille et répétition (« 0 0/18px 18px »).
          // Les écraser par `auto` écrasait les carreaux en une seule grande cellule.
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
        // readyState, pas DOMContentLoaded : à l'activation du plugin,
        // l'événement est SOUVENT déjà passé — l'attendre ne servirait à rien.
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', poser, { once: true })
          return
        }
        poser()
      }

      /** La feuille des effets qui ne sont pas des jetons : verre (flou), ligatures, logo, mouvement, focus,
       *  cibles, liens. Une chaîne pure (testable) ; vide quand rien n'est demandé. Les sélecteurs sont les
       *  crochets STABLES de DSH (`data-slot`, `data-composer-card`, rôles ARIA), jamais ses classes hachées. */
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
        return css.join('\n')
      }
      let effetsDispose = null
      const appliquerEffets = (S) => {
        if (effetsDispose !== null) { try { effetsDispose() } catch (e) { /* déjà retirée */ } effetsDispose = null }
        // Le moteur d'animation de réflexion lit aussi cet attribut : « réduire » vaut pour lui aussi.
        try { if (S.reduceMotion) document.documentElement.setAttribute('data-kbth-reduced', '1'); else document.documentElement.removeAttribute('data-kbth-reduced') } catch (e) { /* hors navigateur */ }
        try { if (S.cbSafe) document.documentElement.setAttribute('data-kbth-cb', '1'); else document.documentElement.removeAttribute('data-kbth-cb') } catch (e) { /* hors navigateur */ }
        const css = effetsCss(S)
        if (css !== '') effetsDispose = styles.insert(css)
      }

      const appliquerPolice = (S) => {
        if (fontDispose !== null) { try { fontDispose() } catch (e) { /* déjà retiré */ } fontDispose = null }
        const f = FONTS.find((x) => x.id === S.fontText) || FONTS[0]
        if (f.stack !== null) fontDispose = styles.insert(':root{--dsw-font-family:' + f.stack + ' !important;}')
      }

      const appliquerMode = (themeSvc, S) => {
        const m = S.mode === 'system' || S.mode === 'light' ? S.mode : 'dark'
        try { themeSvc.setTheme(m) } catch (e) {
          // Une préférence refusée doit se voir, pas disparaître.
          try { console.error('[kybernos-theme] setTheme(' + m + ') refusé', e) } catch (e2) { /* console indisponible */ }
        }
      }

      const appliquerTaille = (themeSvc, S) => {
        const px = Math.max(12, Math.min(17, Math.round(Number(S.fs) || 15)))
        try { themeSvc.setFontSize(px) } catch (e) { /* hors plage */ }
      }

      const appliquerTout = (themeSvc, S) => {
        appliquerMode(themeSvc, S)
        appliquerJetons(themeSvc, S)
        appliquerFond(S)
        appliquerPolice(S)
        appliquerEffets(S)
        appliquerTaille(themeSvc, S)
      }

      /** La préférence native courante, quand elle est exploitable.
       *  `getTheme()` rend un instantané stable : `preference` vaut « light »,
       *  « dark » ou « system », ou le défaut du service tant que la portée de
       *  réglages n'est pas arrivée. */
      const prefNative = (themeSvc, snapArg) => {
        try {
          const snap = (snapArg !== null && snapArg !== undefined) ? snapArg : ((themeSvc === null || themeSvc === undefined || typeof themeSvc.getTheme !== 'function') ? null : themeSvc.getTheme())
          const p = (snap !== null && snap !== undefined) ? snap.preference : null
          return (p === 'light' || p === 'dark' || p === 'system') ? p : null
        } catch (e) { return null }
      }

      /** L'application d'ACTIVATION : tout sauf le mode.
       *
       *  Pourquoi le mode est exclu — mesuré le 23/09/2026 : DSH garde la
       *  préférence de thème dans une portée de réglages durable
       *  (`theme.setTheme()` → `host.set('preference')`) et la restaure
       *  lui-même au chargement. La réécrire depuis notre store écrasait le
       *  dernier choix de l'utilisateur : bascule « sombre → clair » par le
       *  bouton du pied de sidebar, puis rechargement → l'app revenait en
       *  sombre. On laisse donc la préférence native s'appliquer, on ADOPTE sa
       *  valeur dans le store (pour que la page Réglages dise la vérité), et on
       *  recopie tout changement natif venu d'ailleurs. */
      const appliquerBoot = (themeSvc, S) => {
        appliquerJetons(themeSvc, S)
        appliquerFond(S)
        appliquerPolice(S)
        appliquerEffets(S)
        // Pas de taille ici non plus : DSH la persiste (setFontSize) et la restaure
        // lui-même ; la réécrire depuis notre store écrasait celle de l'utilisateur
        // (même classe de bug que le mode). On l'ADOPTE, voir tailleNative.
      }

      /** La taille de texte native de DSH (12–17), quand l'instantané la porte. */
      const tailleNative = (themeSvc, snapArg) => {
        try {
          const snap = (snapArg !== null && snapArg !== undefined) ? snapArg : ((themeSvc === null || themeSvc === undefined || typeof themeSvc.getTheme !== 'function') ? null : themeSvc.getTheme())
          const n = (snap !== null && snap !== undefined) ? Number(snap.fontSize) : NaN
          return (Number.isFinite(n) && n >= 12 && n <= 17) ? Math.round(n) : null
        } catch (e) { return null }
      }

      /** « Me surprendre » — un tirage cohérent : le fond dicte le mode et la
       *  teinte, l'accent sort de la dominante du fond. */
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
      // 4b. ANIMATION DE RÉFLEXION — le statut du bas du chat.
      //
      //   Tant que l'agent travaille, DSH monte un bloc `[data-chat-running]` : une
      //   queue de baleine de 14 px, puis « Deep diving for 12s ··· » (texte à reflet,
      //   écrit DEUX fois : le texte et sa copie lumineuse). Le bloc est remonté à
      //   chaque réponse. On ne touche pas au moteur : un MutationObserver le repère,
      //   y pose l'animation choisie (en masquant la queue de baleine) et remplace la
      //   phrase native par un mot de l'ambiance — avec le gabarit et la durée de DSH.
      //   Tout est défensif : si la structure change, on ne fait rien.
      //
      //   Les réglages vivent dans une clé à part (kybernos.theme.loader.v1) : « Tout
      //   rétablir » de la page Thème ne doit pas effacer vos animations. Les fichiers
      //   importés et les mots du pack vivent sur le disque (route hôte
      //   /kybernos-theme/loader-store) ; le navigateur n'en garde que les animations
      //   CHOISIES, pour peindre sans attendre l'hôte.
      // ══════════════════════════════════════════════════════════════════════

      const LD_KEY = 'kybernos.theme.loader.v1'
      const LD_CACHE = 'kybernos.theme.loader.cache.v1'
      const LD_DEF = { sel: [], mode: 'random', size: 'standard', tint: true, keep: true, speed: 1, avoid: true, delay: 300, pack: 'dsh', rot: 'fixed', dur: true, updatedAt: 0 }
      const LD_SIZES = { compact: 14, standard: 24, large: 40 }
      const LD_MAX = 4
      const LD_LIMIT = 200 * 1024
      const LD_ID = /^[a-z0-9][a-z0-9-]{0,63}$/
      const LD_WHALE = 'M8.844 13.742C8.967 12.328 8.45 10.4 8.45 9.65C8.45 8.94 8.88 8.43 9.6 8.43C11.285 8.43 12.106 8.281 12.685 8.104C13.71 7.791 14.585 6.768 15.055 5.945C15.137 5.803 14.99 5.641 14.829 5.671C13.829 5.86 12.828 5.376 11.827 4.978C10.659 4.514 9.491 4.707 8.935 4.876C8.805 4.915 8.658 4.819 8.636 4.686C8.468 3.643 7.405 2.615 5.498 2.238C4.54 2.048 3.748 1.574 3.347 1.202C3.252 1.113 3.088 1.125 3.03 1.242C2.628 2.059 2.168 3.82 5.248 6.115C5.82 6.494 6.31 6.785 6.574 7.637C6.72 8.104 6.157 9.168 6.061 9.368C5.157 11.27 5.089 12.19 4.926 13.742'

      /** Les réglages, toujours remis dans la forme attendue (même liste blanche que l'hôte). */
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

      // ── Le catalogue : 14 dessins originaux (48×48, animés en CSS) ───────────
      // Ceux de vos deux références (pack Lottie « Loading symbols set ») ne sont pas
      // inclus : ils appartiennent à leur auteur. Importez-les depuis « Ajouter la vôtre ».
      const ldSv=(inner,attrs)=>'<svg viewBox="0 0 48 48" aria-hidden="true" '+(attrs||'')+'>'+inner+'</svg>'
      const LD_PRESETS_RAW=[
       {id:'ring',name:'Anneau',kind:'mono',dur:'1,0 s',svg:ldSv('<circle cx="24" cy="24" r="18" stroke-opacity=".2"/><circle class="vb a-spin" cx="24" cy="24" r="18" stroke-dasharray="30 120" style="--d:1s"/>','fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"')},
       {id:'orbit',name:'Orbite',kind:'mono',dur:'1,4 s',svg:ldSv('<g class="vb a-spin" style="--d:1.4s"><circle cx="24" cy="8" r="4.5"/><circle cx="37.9" cy="32" r="3.5" opacity=".65"/><circle cx="10.1" cy="32" r="2.5" opacity=".4"/></g>','fill="currentColor"')},
       {id:'pulse',name:'Pulsation',kind:'mono',dur:'1,6 s',svg:ldSv('<circle cx="24" cy="24" r="4" fill="currentColor"/><circle class="a-pulse" cx="24" cy="24" r="22" fill="none" stroke="currentColor" stroke-width="3"/><circle class="a-pulse" cx="24" cy="24" r="22" fill="none" stroke="currentColor" stroke-width="3" style="animation-delay:-.8s"/>')},
       {id:'bars',name:'Barres',kind:'mono',dur:'1,0 s',svg:ldSv([5,14,23,32,41].map((x,i)=>'<rect class="a-bar" x="'+(x-3)+'" y="8" width="6" height="32" rx="3" style="animation-delay:'+(-0.9+i*0.12).toFixed(2)+'s"/>').join(''),'fill="currentColor"')},
       {id:'dots',name:'Rebond',kind:'mono',dur:'1,1 s',svg:ldSv([10,24,38].map((x,i)=>'<circle class="a-bounce" cx="'+x+'" cy="29" r="5" style="animation-delay:'+(-1+i*0.16).toFixed(2)+'s"/>').join(''),'fill="currentColor"')},
       {id:'atom',name:'Atome',kind:'mono',dur:'1,4 s',svg:ldSv([0,60,120].map((r,i)=>'<ellipse cx="24" cy="24" rx="20" ry="8" transform="rotate('+r+' 24 24)" stroke-opacity=".22"/><ellipse class="a-dash" pathLength="100" cx="24" cy="24" rx="20" ry="8" transform="rotate('+r+' 24 24)" stroke-dasharray="30 70" style="animation-delay:'+(-i*0.45).toFixed(2)+'s"/>').join('')+'<circle cx="24" cy="24" r="3" fill="currentColor" stroke="none"/>','fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"')},
       {id:'flow',name:'Flux',kind:'mono',dur:'1,4 s',svg:ldSv('<line x1="6" y1="24" x2="42" y2="24" stroke-opacity=".2"/><line class="a-dash" pathLength="100" x1="6" y1="24" x2="42" y2="24" stroke-dasharray="28 72"/>','fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"')},
       {id:'sand',name:'Sablier',kind:'mono',dur:'2,4 s',svg:ldSv('<g class="vb a-flip" style="--d:2.4s"><path d="M14 6h20M14 42h20"/><path d="M16 6c0 11 8 13 8 18s-8 7-8 18M32 6c0 11-8 13-8 18s8 7 8 18"/><path d="M18.5 12h11L24 20z" fill="currentColor" stroke="none"/></g>','fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"')},
       {id:'jelly',name:'Bille',kind:'color',dur:'1,6 s',svg:ldSv('<g class="a-jelly"><circle cx="24" cy="24" r="16" fill="var(--c1)"/><circle cx="31" cy="18" r="3.2" fill="#fff" opacity=".92"/></g>')},
       {id:'quad',name:'Quatre carrés',kind:'color',dur:'1,2 s',svg:ldSv([[6,6,'--c1'],[26,6,'--c3'],[6,26,'--c2'],[26,26,'--c4']].map((q,i)=>'<rect class="a-pop" x="'+q[0]+'" y="'+q[1]+'" width="16" height="16" rx="4.5" fill="var('+q[2]+')" style="animation-delay:'+(-1.2+i*0.3).toFixed(2)+'s"/>').join(''))},
       {id:'petals',name:'Pétales',kind:'color',dur:'1,2 s',svg:ldSv(Array.from({length:8},(_,i)=>'<ellipse class="a-fade" cx="24" cy="9.5" rx="3.2" ry="6.5" transform="rotate('+(i*45)+' 24 24)" fill="var(--c'+(i%4+1)+')" style="animation-delay:'+(-1.2+i*0.15).toFixed(2)+'s"/>').join(''))},
       {id:'gears',name:'Engrenages',kind:'color',dur:'3,0 s',svg:ldSv('<g transform="translate(18 18)"><circle class="a-spin" r="8.91" fill="none" stroke="var(--c1)" stroke-width="5" stroke-dasharray="3.5 3.5" style="--d:3s"/><circle r="6" fill="none" stroke="var(--c1)" stroke-width="3"/></g><g transform="translate(32 32) scale(.78)"><circle class="a-spin a-rev" r="8.91" fill="none" stroke="var(--c2)" stroke-width="5" stroke-dasharray="3.5 3.5" style="--d:3s"/><circle r="6" fill="none" stroke="var(--c2)" stroke-width="3"/></g>')},
       {id:'spark',name:'Étincelle',kind:'color',dur:'1,6 s',svg:ldSv('<path class="a-twinkle" d="M24 4C26 16 32 22 44 24C32 26 26 32 24 44C22 32 16 26 4 24C16 22 22 16 24 4Z" fill="var(--c2)"/><path class="a-twinkle" d="M38 4l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" fill="var(--c1)" style="animation-delay:-.8s"/>')},
       {id:'grid',name:'Cascade',kind:'color',dur:'1,2 s',svg:ldSv([0,1,2].map(r=>[0,1,2].map(c=>'<rect class="a-fade" x="'+(5+c*14)+'" y="'+(5+r*14)+'" width="10" height="10" rx="2.6" fill="var(--c'+(r+1)+')" style="animation-delay:'+(-1.2+(r+c)*0.2).toFixed(2)+'s"/>').join('')).join(''))}
      ]
      /* dessinés par le skill (la démo en tire un à chaque demande) */
      const LD_PRESETS = LD_PRESETS_RAW.map((p) => ({ type: 'inline', source: 'preset', ...p }))

      // ── Les ambiances : des mots par métier, en français et en anglais ─────────
      // Une forme qui se lit après « … for 12s » : un nom d'action ou un gérondif.
      const LD_PACKS = [
        { id: 'dsh', name: 'DSH d’origine', orig: true, words: { fr: [], en: [] } },
        { id: 'mer', name: 'Mer', words: { fr: ['Plongée', 'Sondage', 'Cap sur la réponse', 'Remontée', 'Veille'], en: ['Diving', 'Sounding', 'Charting a course', 'Surfacing', 'Keeping watch'] } },
        { id: 'cuisine', name: 'Cuisine', words: { fr: ['Mijotage', 'Assaisonnement', 'Dressage', 'Émulsion', 'Réduction'], en: ['Cooking', 'Simmering', 'Seasoning', 'Plating', 'Reducing'] } },
        { id: 'atelier', name: 'Atelier créatif', words: { fr: ['Composition', 'Esquisse', 'Brouillon', 'Mise en page', 'Polissage'], en: ['Composing', 'Sketching', 'Drafting', 'Laying out', 'Polishing'] } },
        { id: 'architecture', name: 'Architecture', words: { fr: ['Esquisse', 'Relevé', 'Étude de la lumière', 'Coupe et élévation', 'Calcul des structures'], en: ['Sketching', 'Surveying', 'Studying daylight', 'Drawing sections', 'Calculating structures'] } },
        { id: 'medecine', name: 'Médecine', words: { fr: ['Examen', 'Anamnèse', 'Diagnostic différentiel', 'Recoupement des recommandations', 'Triage'], en: ['Examining', 'Taking the history', 'Weighing differentials', 'Cross-checking guidelines', 'Triaging'] } },
        { id: 'sante-mentale', name: 'Santé mentale', words: { fr: ['Écoute active', 'Reformulation', 'Prise de recul', 'Repérage des ressources', 'Pas à pas'], en: ['Listening closely', 'Rephrasing', 'Stepping back', 'Mapping resources', 'Taking it step by step'] } },
        { id: 'ingenierie', name: 'Ingénierie', words: { fr: ['Calcul des tolérances', 'Simulation', 'Dimensionnement', 'Vérification des charges', 'Mise au point'], en: ['Calculating tolerances', 'Simulating', 'Sizing', 'Checking loads', 'Fine-tuning'] } },
        { id: 'droit', name: 'Droit', words: { fr: ['Lecture de la jurisprudence', 'Rédaction des clauses', 'Recoupement des textes', 'Qualification des faits'], en: ['Reading case law', 'Drafting clauses', 'Cross-referencing statutes', 'Qualifying the facts'] } },
        { id: 'finance', name: 'Finance', words: { fr: ['Rapprochement', 'Audit', 'Prévision', 'Consolidation', 'Amortissement'], en: ['Reconciling', 'Auditing', 'Forecasting', 'Consolidating', 'Amortizing'] } },
        { id: 'science', name: 'Recherche', words: { fr: ['Titrage', 'Séquençage', 'Contrôle témoin', 'Relecture par les pairs', 'Calibrage'], en: ['Titrating', 'Sequencing', 'Running controls', 'Peer-reviewing', 'Calibrating'] } },
        { id: 'education', name: 'Éducation', words: { fr: ['Préparation du cours', 'Correction', 'Différenciation', 'Évaluation', 'Mise en séquence'], en: ['Planning the lesson', 'Marking', 'Differentiating', 'Assessing', 'Sequencing'] } }
      ]

      // ── Le magasin ────────────────────────────────────────────────────────────
      const ld = { S: ldRead(), mine: [], words: [], subs: new Set(), hostState: 'unknown', pushTimer: null, ctx: null, started: false, pulled: false, mo: null, runs: new Set() }
      const ldNotify = () => { ld.subs.forEach((fn) => { try { fn() } catch (e) { /* un abonné fautif ne coupe pas les autres */ } }) }
      const ldById = (id) => LD_PRESETS.find((p) => p.id === id) || ld.mine.find((p) => p.id === id) || null
      const ldLang = () => {
        try { return String(ld.ctx.locale.getLocale().active).toLowerCase().indexOf('fr') === 0 ? 'fr' : 'en' } catch (e) { return 'en' }
      }
      const ldHash = (str) => Array.from(String(str)).reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)
      const ldPackById = (id) => (id === 'perso' ? { id: 'perso', name: 'Mon pack', words: { fr: ld.words, en: ld.words } } : (LD_PACKS.find((p) => p.id === id) || LD_PACKS[0]))
      /** Les mots de l'ambiance active, dans la langue de l'interface. Vide = on laisse le texte de DSH. */
      const ldWordList = (id) => {
        const p = ldPackById(id === undefined ? ld.S.pack : id)
        if (p.orig === true) return []
        const w = p.words[ldLang()]
        return Array.isArray(w) && w.length > 0 ? w : (p.words.en || [])
      }

      // Les animations CHOISIES sont gardées dans le navigateur (≤ 4 × 200 Ko) : sans cela, la
      // première réponse après un rechargement attendrait l'hôte pour savoir quoi dessiner.
      const ldCacheWrite = () => {
        try {
          const keep = ld.mine.filter((l) => ld.S.sel.indexOf(l.id) >= 0)
          localStorage.setItem(LD_CACHE, JSON.stringify({ loaders: keep, words: ld.words }))
        } catch (e) { /* quota : l'hôte reste la référence */ }
      }
      const ldCacheRead = () => {
        try {
          const c = JSON.parse(localStorage.getItem(LD_CACHE))
          if (c !== null && typeof c === 'object') {
            if (Array.isArray(c.loaders)) ld.mine = c.loaders.filter(ldRecordOk)
            if (Array.isArray(c.words)) ld.words = c.words.filter((w) => typeof w === 'string')
          }
        } catch (e) { /* pas de cache */ }
      }
      const ldRecordOk = (l) => l !== null && typeof l === 'object' && typeof l.id === 'string' && LD_ID.test(l.id) && typeof l.name === 'string'
        && (l.type === 'svg' || l.type === 'lottie' || l.type === 'img') && l.data !== undefined && l.data !== null
      ldCacheRead()

      // ── L'hôte : disque durable, optionnel ────────────────────────────────────
      const ldHostOn = () => { try { return window.__KB_THEME_HOST_STORE__ !== false } catch (e) { return true } }
      const ldHostUrl = () => { try { return new URL('kybernos-theme/loader-store', document.baseURI).pathname } catch (e) { return '/kybernos-theme/loader-store' } }
      const ldHost = async (body) => {
        if (!ldHostOn()) return { ok: false, unreachable: true, error: 'host store off' }
        try {
          const res = await fetch(ldHostUrl(), body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
          const j = await res.json().catch(() => null)
          return (j !== null && typeof j === 'object') ? j : { ok: false, unreachable: true, error: 'réponse illisible' }
        } catch (e) { return { ok: false, unreachable: true, error: String(e !== null && e.message ? e.message : e) } }
      }
      const ldSchedulePush = () => {
        if (!ldHostOn()) return
        if (ld.pushTimer !== null) clearTimeout(ld.pushTimer)
        ld.pushTimer = setTimeout(() => { ld.pushTimer = null; ldHost({ op: 'put-settings', settings: ld.S }) }, 700)
      }
      /** Lit l'hôte. `quiet` : ne réveille la page que si quelque chose a changé. */
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
        else if ((j.settings === null || j.settings === undefined) && ld.S.updatedAt > 0 && ld.pulled === false) ldSchedulePush() // premier passage : l'hôte n'a rien, on lui donne ce que le navigateur sait
        ld.pulled = true
        ldCacheWrite()
        if (quiet !== true || sig() !== before || was !== ld.hostState) ldNotify()
        return true
      }
      /** Change des réglages : navigateur d'abord (immédiat), disque ensuite (différé). */
      const ldSet = (patch) => {
        ld.S = ldClean({ ...ld.S, ...patch, updatedAt: Date.now() })
        ldWrite(ld.S); ldCacheWrite(); ldNotify(); ldSchedulePush()
      }
      /** Rend { ok, local?, error?, loader? }. Un hôte qui REFUSE le fichier (il en a vu un défaut) : rien n'est
       *  gardé. Un hôte INJOIGNABLE : le fichier reste dans ce navigateur jusqu'au rechargement (`local`). */
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

      // ── Le dessin d'une animation ─────────────────────────────────────────────
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
      /** Un nœud DOM prêt à être posé. Le contenu importé n'est JAMAIS injecté comme HTML :
       *  un SVG passe par <img> ou par un masque CSS (aucun script n'y tourne), un Lottie par
       *  son moteur, les dessins du catalogue (nos propres chaînes) sont seuls en ligne. */
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
      const ldDestroy = (node) => { try { if (node !== null && node !== undefined && node.__kbAnim) node.__kbAnim.destroy() } catch (e) { /* déjà détruit */ } }

      // ── Le tirage ─────────────────────────────────────────────────────────────
      /** `memo` garde le dernier tirage : { last, idx }. Muté. */
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

      // ── Le statut du bas, dans la vraie page ──────────────────────────────────
      const ldTurn = { loader: null, word: null, t0: 0, lastSeen: 0, memo: {}, wmemo: {} }
      const ldBase = () => { try { return String(ld.ctx.locale.bind('chat')('chat.deepDiving')) } catch (e) { return '' } }
      /** DSH écrit le texte DEUX fois : un nœud texte (la base) et, dans la copie lumineuse qui balaie
       *  le mot, un attribut `data-shimmer-text` que le CSS affiche (`::after`). Sans le second, le
       *  reflet repasserait « Deep diving » par-dessus notre mot. */
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
        try { if (run.mo !== null) run.mo.disconnect() } catch (e) { /* déjà détaché */ }
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
        if (now - ldTurn.lastSeen > 1500) { // une NOUVELLE réponse (le bloc est remonté à l'identique au milieu d'une réponse)
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
            if (idx !== run.idx) { run.idx = idx; run.word = ldChooseWord(ldTurn.wmemo); ldTurn.word = run.word } // DSH réécrit le texte à chaque seconde : le nouveau mot passe au prochain tic
          }
        }, 1000)
      }
      /** Arrête tout et rend à DSH son icône : le plugin peut être désactivé à chaud. */
      const ldStop = () => {
        try { if (ld.mo !== null) ld.mo.disconnect() } catch (e) { /* déjà détaché */ }
        ld.mo = null
        Array.from(ld.runs).forEach((run) => {
          ldRelease(run)
          try {
            if (run.node !== null && run.node.parentNode) run.node.parentNode.removeChild(run.node)
            if (run.icon !== null) run.icon.removeAttribute('data-kb-ld-hide')
            run.el.removeAttribute('data-kb-ld-notext')
            run.el.__kbLd = false
          } catch (e) { /* le bloc est déjà parti */ }
        })
        ld.started = false
      }
      /** Surveille la page : chaque `[data-chat-running]` qui apparaît est décoré. Rend le disposer. */
      const ldStart = (ctx) => {
        ld.ctx = ctx
        if (ld.started) return ldStop
        ld.started = true
        const scan = (root) => {
          try {
            if (root.nodeType !== 1) return
            if (root.matches('[data-chat-running]')) ldDecorate(root)
            root.querySelectorAll('[data-chat-running]').forEach(ldDecorate)
          } catch (e) { /* une erreur ici ne doit jamais atteindre DSH */ }
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
        colors: ['mode', 'acc', 'ov'],
        font: ['fontText', 'ligatures'],
        radius: ['radius'],
        glass: ['wp', 'wpVis', 'wpBlur', 'tint', 'glassEffect', 'glassBlur', 'sidebarLinked', 'sidebarOpacity', 'fieldOpacity', 'floatOpacity', 'bgBrightness', 'bgContrast', 'bgSaturation', 'bgDarken', 'bgFit', 'bgMirror'],
        a11y: ['contrastMode', 'cbSafe', 'reduceMotion', 'focusRing', 'largeTargets', 'underlineLinks']
      }
      const PRESET_GROUP_LABELS = { colors: 'Couleurs et accent', font: 'Police', radius: 'Coins', glass: 'Verre et fond d’écran', a11y: 'Accessibilité' }
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
        const base = presetName(name) || 'Thème'
        let n = base
        for (let i = 2; libNameTaken(n); i += 1) n = base.slice(0, PRESET_NAME_MAX - String(i).length - 3).trim() + ' (' + i + ')'
        return n
      }
      /** Adds a theme at the end of the library. Rend l'enregistrement, ou null (settings vides, bibliothèque pleine). */
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
        return { ok: true, name: name === '' ? 'Thème importé' : name, settings, legacy: !framed, author: framed && typeof raw.author === 'string' ? raw.author : undefined }
      }

      // « Modified » = a setting this theme retains has moved. The mode is left out on purpose: DSH's own
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
        fontText: rec.settings.fontText, radius: rec.settings.radius
      })
      const RADIUS_LABEL = { sharp: 'nets', standard: 'standard', soft: 'doux' }
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
      //   Installing puts a copy in « My themes » (source « gallery », with its catalogue id and version);
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
      /** The language of the interface, « fr » or « en »: French while nothing says otherwise (the page is written in French), English for any other language. */
      const kbLang = () => {
        try {
          const a = (typeof window !== 'undefined') ? window.__KB_I18N_ACTIVE__ : null
          const l = (a !== null && a !== undefined && a.lang !== null && a.lang !== undefined) ? String(a.lang).toLowerCase() : ''
          return l === '' || l.indexOf('fr') === 0 ? 'fr' : 'en'
        } catch (e) { return 'fr' }
      }
      /** One catalogue theme as the page uses it, or null. Checked again here: the host is not trusted any more than a file is. */
      const galTheme = (raw) => {
        if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
        if (typeof raw.id !== 'string' || !PRESET_ID.test(raw.id)) return null
        const name = presetName(raw.name)
        const settings = presetSettings(raw.settings)
        if (name === '' || settings === null) return null
        PRESET_GROUPS.a11y.forEach((k) => { delete settings[k] }) // a catalogue never touches accessibility
        if (Object.keys(settings).length === 0) return null
        const d = (raw.description !== null && typeof raw.description === 'object') ? raw.description : {}
        return {
          id: raw.id, name, settings,
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
        fontText: t.settings.fontText, radius: t.settings.radius
      })
      const GAL_ONLINE_TEXT = {
        offline: 'Le catalogue en ligne est injoignable : ce sont les thèmes livrés avec Kybernos.',
        off: 'Le catalogue en ligne est désactivé : ce sont les thèmes livrés avec Kybernos.'
      }
      const galOnlineText = (o) => {
        if (o.state === 'offline' || o.state === 'off') return GAL_ONLINE_TEXT[o.state]
        if (o.state === 'refused') {
          if (o.reason === 'no-key') return 'Le catalogue en ligne n’est pas encore activé : ce sont les thèmes livrés avec Kybernos.'
          const why = { signature: 'sa signature n’est pas reconnue', older: 'il est plus ancien que celui déjà connu', shape: 'il est mal formé', theme: 'il est mal formé', json: 'il est mal formé', size: 'il est trop gros' }[o.reason]
          return 'Le catalogue en ligne a été refusé' + (why === undefined ? '' : ' (' + why + ')') + ' : ce sont les thèmes déjà connus qui s’affichent.'
        }
        return ''
      }

      // ══════════════════════════════════════════════════════════════════════
      // 5. LA PAGE DE RÉGLAGES.
      // ══════════════════════════════════════════════════════════════════════

      const css = `
/* ── Bordures du schéma clair ─────────────────────────────────────────────
   La feuille officielle DSH pose alias-border-l1 à 4 % de noir (#0000000a)
   en clair : invisible sur fond blanc, cartes et panneaux perdent leur
   liseré (Marketplace, teams, etc.). On remonte à 8 % sur body SANS
   l'attribut sombre — spécificité 0,1,1 > 0,0,1, la règle gagne quel que
   soit l'ordre des feuilles, et ne touche jamais le sombre (#ffffff0f y
   reste lisible). Volontairement TOUJOURS actif, même en configuration
   native : la valeur fautive est celle de DSH, pas celle d'une peau. */
body:not([data-ds-dark-theme]) { --dsw-alias-border-l1: #00000014; }
/* ── Masquer la section native DSH "Theme / 外观" de la sidebar ─────────── */
[data-slot="settings.section"][data-id="theme"],
[role="dialog"] nav [data-id="theme"] { display: none !important; }
/* Forcer le conteneur parent du slot à prendre toute la largeur disponible,
   sinon le grid 2 colonnes n'a jamais assez de place. */
[data-slot="settings.section"]:has(.kbth-page) { width: 100%; max-width: none; }

/* Une seule colonne : l'aperçu latéral a été retiré (il ne servait pas). */
.kbth-page{display:grid;grid-template-columns:1fr;gap:22px;max-width:720px;align-items:start}
.kbth-main{display:flex;flex-direction:column;gap:22px;min-width:0}
.kbth-head{display:flex;flex-direction:column;gap:6px}
.kbth-title{font-size:26px;line-height:32px;font-weight:800;letter-spacing:-.01em;color:var(--dsw-alias-label-primary)}
.kbth-sub{font-size:14px;line-height:1.55;color:var(--dsw-alias-label-secondary);max-width:640px}
.kbth-seg{display:inline-flex;gap:2px;padding:3px;border-radius:11px;background:var(--dsw-alias-bg-layer-2);width:max-content}
/* (29/09, demande) Sélecteur Simple/Avancé (et Mode) PLUS CLAIR : 14px,
   paddings généreux, état actif à la couleur de marque — on ne cherche
   plus le segment actif dans un fond de gris. */
.kbth-seg button{appearance:none;border:1px solid transparent;font:inherit;font-size:14px;font-weight:500;padding:8px 18px;border-radius:9px;cursor:pointer;background:transparent;color:var(--dsw-alias-label-secondary);transition:background .12s,color .12s,border-color .12s}
.kbth-seg button:hover:not([aria-pressed="true"]){background:var(--dsw-alias-interactive-bg-hover)}
.kbth-seg button[aria-pressed="true"]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.12)}
/* (29/09) Le bloc « Appearance » natif de Général est remplacé par la
   section Apparence de cette page (même préférence via themeSvc.setTheme) :
   marqué data-kbth-own par l'observateur ci-dessous, il disparaît — un seul
   endroit règle l'apparence. */
[data-kbth-own="appearance"]{display:none}
.kbth-sec{display:flex;flex-direction:column;gap:12px}
.kbth-sec-h{display:flex;flex-direction:column;gap:3px}
.kbth-sec-t{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}
.kbth-sec-d{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.kbth-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.kbth-lb{font-size:13px;font-weight:500;color:var(--dsw-alias-label-secondary);width:130px;flex:none}
.kbth-hint{font-size:11px;color:var(--dsw-alias-label-caption, var(--dsw-alias-label-tertiary));line-height:1.45}
.kbth-link{appearance:none;border:0;background:none;padding:0;font:inherit;color:var(--dsw-alias-label-primary);text-decoration:underline;text-underline-offset:2px;cursor:pointer}
.kbth-link:hover{color:var(--dsw-alias-brand-primary)}
/* Avertissement de conflit dream-skin — stylé avec les jetons DSH */
.kbth-conflict{font-size:12px;line-height:1.5;padding:8px 12px;border-radius:9px;
  background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-label);
  border:.5px solid var(--dsw-alias-state-warn-secondary);flex-basis:100%}
.kbth-conflict strong{font-weight:600}
/* Pastilles rondes : le fond du thème d'un côté, son accent de l'autre.
   Rien d'autre — ni cadre, ni méta sous chaque pastille (l'état du thème
   choisi s'affiche en une ligne, sous la rangée). */
.kbth-skins{display:flex;flex-wrap:wrap;gap:12px 14px;align-items:flex-start}
.kbth-skin{appearance:none;font:inherit;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:6px;
  padding:2px;border:0;background:none;width:76px;border-radius:12px}
/* (30/09) Pastille des thèmes prêts : liseré propre sur fond clair ET sombre
   (1 px à border-l2, le 0,5 px à l3 disparaissait sur les bases claires),
   profondeur discrète par ombre interne — le disque ne flotte plus.
   corner-shape:round — le shell pose superellipse(1.5) en global (Chrome 139),
   qui peint le border-radius:50% en SQUIRCLE : une pastille de couleur se
   lit ronde, la superellipse reste aux surfaces du shell. */
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
.kbth-dot{appearance:none;border:1px solid var(--dsw-alias-border-l3);box-shadow:inset 0 0 0 1px rgba(255,255,255,.10);width:22px;height:22px;border-radius:50%;cursor:pointer;padding:0;transition:transform .1s,box-shadow .12s}
.kbth-dot:hover{transform:scale(1.15)}
.kbth-dot[aria-pressed="true"]{box-shadow:0 0 0 2px var(--dsw-alias-bg-layer-1),0 0 0 4px var(--dsw-alias-brand-primary)}
.kbth-btn{appearance:none;font:inherit;font-size:12px;padding:5px 11px;border-radius:8px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);transition:background .12s,border-color .12s}
.kbth-btn:hover{background:var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-3));border-color:var(--dsw-alias-border-l3)}
.kbth-wpcats{display:flex;gap:6px;flex-wrap:wrap}
.kbth-cat{appearance:none;font:inherit;font-size:12px;padding:3px 10px;border-radius:999px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);transition:background .12s,color .12s}
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
.kbth-fsopt-name{font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}
.kbth-fsopt-sample{font-size:14px;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbth-fsempty{padding:12px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
/* ── Onglet Avancé : layout 2 colonnes (liste + éditeur) ──────────────── */
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
/* ── Sous-onglets Avancé — pile VERTICALE à gauche du contenu (règle du
   26/09/2026) : colonne d'onglets + panneau, grid 2 colonnes. ──────────── */
/* ── Sous-onglets Avancé — pile VERTICALE à gauche du contenu ───────────
   (29/09, harmonisation) Même matière que les onglets unifiés du plugin
   (kb8-tab) : pilule contour 1px, état actif à la couleur de marque — le
   rail vertical et le liseré droit disparaissent au profit du traitement
   commun. text-align:start : bidi-sûr. */
.kbth-adv-cols{display:grid;grid-template-columns:180px minmax(0,1fr);gap:8px 22px;align-items:start}
.kbth-adv-tabs{display:flex;flex-direction:column;gap:6px;overflow-y:auto;position:sticky;top:0}
.kbth-adv-tab{appearance:none;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;font:inherit;font-size:13px;font-weight:500;padding:8px 12px;cursor:pointer;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:start;transition:color .12s,background .12s,border-color .12s}
.kbth-adv-tab:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l2)}
.kbth-adv-tab.on{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);font-weight:600}
/* ── Toggle switch ───────────────────────────────────────────────────── */
.kbth-toggle-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 0}
.kbth-toggle-label{font-size:13px;font-weight:500;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;gap:4px}
.kbth-toggle-hint{font-size:11px;color:var(--dsw-alias-label-tertiary);cursor:help}
.kbth-toggle{appearance:none;border:0;width:40px;height:22px;border-radius:11px;background:var(--dsw-alias-bg-layer-3);cursor:pointer;position:relative;transition:background .15s;flex:none}
.kbth-toggle.on{background:var(--dsw-alias-brand-primary)}
.kbth-toggle-knob{position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:var(--dsw-alias-bg-layer-1);transition:transform .15s;box-shadow:0 1px 2px rgba(0,0,0,.2)}
.kbth-toggle.on .kbth-toggle-knob{transform:translateX(18px)}
/* ── Rampe de couleurs ───────────────────────────────────────────────── */
.kbth-ramp{display:flex;gap:0;border-radius:8px;overflow:hidden;margin-top:8px}
.kbth-ramp-step{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px}
.kbth-ramp-swatch{width:100%;height:28px}
.kbth-ramp-label{font-size:9px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
/* ── Jetons enrichis ─────────────────────────────────────────────────── */
.kbth-tok-hex{font-size:11px;color:var(--dsw-alias-label-tertiary);font-family:ui-monospace,Menlo,monospace;font-variant-numeric:tabular-nums}
.kbth-tok-badge{font-size:9.5px;font-weight:700;padding:1px 6px;border-radius:4px;border:1px solid;flex:none}
.kbth-tok-sel{background:var(--dsw-alias-bg-layer-2)!important;border-color:var(--dsw-alias-border-l2)!important}
/* ── Table accessibilité ─────────────────────────────────────────────── */
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
/* ══ Animation de réflexion ═════════════════════════════════════════════════
   .kb-ld : une animation, partout (statut du bas, aperçu, bibliothèque). Les
   classes a-* et vb sont celles du catalogue ; tout est borné par .kb-ld. */
.kb-ld{display:inline-flex;flex:none;width:var(--kb-px,24px);height:var(--kb-px,24px);color:var(--kb-tint,currentColor);--c1:#E5534B;--c2:#F2A65A;--c3:#7FAF63;--c4:#F0C75E}
.kb-ld svg,.kb-ld img{width:100%;height:100%;display:block;overflow:visible}
.kb-ld svg *{transform-box:fill-box;transform-origin:center}
.kb-ld svg .vb{transform-box:view-box;transform-origin:24px 24px}
.kb-ld svg [transform]{transform-box:view-box;transform-origin:0 0}
.kb-ld-mask{background:currentColor;-webkit-mask-size:contain;mask-size:contain;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-position:center;mask-position:center}
.kb-ld .a-spin{animation:kbk-spin calc(var(--d,1.2s)/var(--kb-spd,1)) linear infinite}
.kb-ld .a-rev{animation-direction:reverse}
.kb-ld .a-bounce{animation:kbk-bounce calc(var(--d,1.1s)/var(--kb-spd,1)) ease-in-out infinite}
.kb-ld .a-bar{animation:kbk-bar calc(var(--d,1s)/var(--kb-spd,1)) ease-in-out infinite}
.kb-ld .a-pulse{animation:kbk-pulse calc(var(--d,1.6s)/var(--kb-spd,1)) ease-out infinite}
.kb-ld .a-fade{animation:kbk-fade calc(var(--d,1.2s)/var(--kb-spd,1)) ease-in-out infinite}
.kb-ld .a-jelly{animation:kbk-jelly calc(var(--d,1.6s)/var(--kb-spd,1)) ease-in-out infinite}
.kb-ld .a-flip{animation:kbk-flip calc(var(--d,2.4s)/var(--kb-spd,1)) ease-in-out infinite}
.kb-ld .a-dash{animation:kbk-dash calc(var(--d,1.4s)/var(--kb-spd,1)) linear infinite}
.kb-ld .a-twinkle{animation:kbk-twinkle calc(var(--d,1.6s)/var(--kb-spd,1)) ease-in-out infinite}
.kb-ld .a-pop{animation:kbk-pop calc(var(--d,1.2s)/var(--kb-spd,1)) ease-in-out infinite}
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
@keyframes kbk-vis{to{visibility:visible}}
@keyframes kbk-sway{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.5px)}}
@keyframes kbk-shim{0%{background-position:100% 0}67%,100%{background-position:0 0}}
.kb-ld.kb-late{visibility:hidden;animation:kbk-vis 0s forwards;animation-delay:var(--kb-late,0ms)}
html[data-kbth-reduced] .kb-ld *{animation:none!important}
@media (prefers-reduced-motion:reduce){.kb-ld *{animation:none!important}.kbth-ldp-text,.kbth-ldp-whale{animation:none!important}}
/* Dans la vraie page : la queue de baleine native s'efface, le texte peut se masquer. */
[data-kb-ld-hide]{display:none!important}
[data-chat-running][data-kb-ld-notext] [data-shimmer]{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
/* Aperçu en situation (copie fidèle du statut du bas : mêmes jetons DSH) */
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
.kbth-lds.empty{border-style:dashed;background:transparent;color:var(--dsw-alias-label-caption);justify-content:center;min-height:96px;font-size:12px}
.kbth-lds-pv{height:56px;display:flex;align-items:center;justify-content:center}
.kbth-lds-nm{font-size:12px;font-weight:600;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}
.kbth-lds-x{position:absolute;top:4px;right:4px;width:24px;height:24px;border-radius:50%;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;display:flex;align-items:center;justify-content:center}
.kbth-lds-x:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.kbth-lds-ord{position:absolute;top:7px;left:9px;font-size:11px;color:var(--dsw-alias-label-caption);font-variant-numeric:tabular-nums}
@media(max-width:480px){.kbth-ldt{grid-template-columns:repeat(2,minmax(0,1fr))}}
/* Réglages repliés */
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
.kbth-sk{height:230px;border-radius:14px;background:linear-gradient(100deg,var(--dsw-alias-bg-layer-2) 30%,var(--dsw-alias-bg-layer-3) 50%,var(--dsw-alias-bg-layer-2) 70%);background-size:200% 100%;animation:kbth-sk 1.3s linear infinite}
@keyframes kbth-sk{to{background-position:-200% 0}}
@media (prefers-reduced-motion:reduce){.kbth-sk{animation:none}}
.kbth-trial{position:sticky;top:0;z-index:3;display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 14px;margin-bottom:18px;border-radius:12px;background:var(--dsw-alias-state-warn-tertiary);border:1px solid var(--dsw-alias-state-warn-secondary);color:var(--dsw-alias-state-warn-label);font-size:13px}
.kbth-trial b{font-weight:600}
.kbth-trial-sp{flex:1;min-width:8px}
.kbth-grp{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-caption);font-weight:600}
/* Fenêtre */
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
/* Bibliothèque */
.kbth-lgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.kbth-lcard{display:flex;flex-direction:column;gap:8px;padding:10px;border-radius:12px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);min-width:0}
.kbth-lcard.on{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary)}
.kbth-lcard-pv{height:84px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary)}
.kbth-lcard-nm{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbth-lcard-meta{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-top:-4px}
.kbth-lcard-acts{display:flex;gap:6px}
.kbth-lcard-acts .kbth-btn{flex:1;padding:5px 8px;font-size:12px}
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
/* ── Petits textes en schéma CLAIR ──────────────────────────────────────────
   DSH colore ses textes discrets avec label-tertiary (#81858C, 3,7:1 sur blanc) et label-caption
   (#ADB2B8, 2,1:1) : sous le seuil AA de 4,5:1. Dans CETTE page, en clair seulement, ils prennent
   label-secondary (5,7:1). Le sombre n'y gagne rien et garde sa hiérarchie. Mesuré sur la GUI réelle. */
body:not([data-ds-dark-theme]) :is(.kbth-a11y-hex,.kbth-adv-css,.kbth-card-a,.kbth-card-m,.kbth-src,.kbth-adv-swatch-label,.kbth-disc-s,.kbth-drop,.kbth-empty,.kbth-export-bar,.kbth-fschev,.kbth-fsempty,.kbth-fsmeta,.kbth-fsopt-name,.kbth-grp,.kbth-hex span,.kbth-hint,.kbth-lcard-meta,.kbth-ldp-bar,.kbth-ldp-step,.kbth-lds-ord,.kbth-lds-x,.kbth-lds.empty,.kbth-mx,.kbth-note,.kbth-panel2 p,.kbth-pill,.kbth-ramp-label,.kbth-sec-d,.kbth-sl-vl,.kbth-sum-m,.kbth-toggle-hint,.kbth-tok-css,.kbth-tok-hex,.kbth-trow-m,.kbth-wchip button){color:var(--dsw-alias-label-secondary)}
/* ── Encre des notes (AAA / AA / grand texte / échec) ───────────────────────────────────────
   Les teintes d'état de DSH sont des fonds d'état, pas des encres : en clair, #22C55E fait 2,2:1 sur blanc.
   Une variable par note ET par schéma, lue par le CSS : elle suit le schéma affiché sans que le script ait
   à le deviner ni à se redessiner. Chaque encre dépasse 5:1 sur la couche 1 de son schéma (testé). */
.kbth-gr-ok{--kbth-ink:#4ED17E}
.kbth-gr-warn{--kbth-ink:#F7AD31}
.kbth-gr-err{--kbth-ink:#F25A5A}
body:not([data-ds-dark-theme]) .kbth-gr-ok{--kbth-ink:#15803D}
body:not([data-ds-dark-theme]) .kbth-gr-warn{--kbth-ink:#B45309}
body:not([data-ds-dark-theme]) .kbth-gr-err{--kbth-ink:#B91C1C}
html[data-kbth-cb] .kbth-gr-ok{--kbth-ink:#56B4E9}
html[data-kbth-cb] body:not([data-ds-dark-theme]) .kbth-gr-ok{--kbth-ink:#0072B2}
.kbth-a11y-badge[class*="kbth-gr-"],.kbth-tok-badge[class*="kbth-gr-"]{color:var(--kbth-ink);border-color:var(--kbth-ink)}
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
      // 5b. L'ONGLET « ANIMATION » — aperçu, rotation, texte d'état, réglages,
      //     et deux fenêtres (bibliothèque, pack de mots).
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
      const ldKo = (n) => (n / 1024).toFixed(n < 10240 ? 1 : 0).replace('.', ',') + ' Ko'
      const ldDuration = (secs) => (secs < 60 ? secs + 's' : Math.floor(secs / 60) + 'm ' + (secs % 60) + 's')

      /** Nettoie un SVG importé : ce qui peut exécuter ou charger quelque chose est retiré. L'hôte REFUSE
       *  ensuite tout ce qui en contient encore ; <img> et masque CSS ne font de toute façon rien tourner. */
      const ldCleanSvg = (text) => {
        let doc = null
        try { doc = new DOMParser().parseFromString(text, 'image/svg+xml') } catch (e) { return { error: 'Ce fichier n’est pas un SVG valide.' } }
        const root = doc.documentElement
        if (!root || String(root.nodeName).toLowerCase() !== 'svg' || doc.querySelector('parsererror')) return { error: 'Ce fichier n’est pas un SVG valide.' }
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

      /** Lit un fichier déposé et l'enregistre. Résout { t: 'ok'|'warn'|'err', text }. */
      const ldImport = (file) => new Promise((resolve) => {
        const done = (t, text) => resolve({ t, text })
        if (file.size > LD_LIMIT) return done('err', '« ' + file.name + ' » pèse ' + ldKo(file.size) + ' : la limite est de 200 Ko. Simplifiez l’animation ou réduisez ses images.')
        const ext = (String(file.name).split('.').pop() || '').toLowerCase()
        const base = String(file.name).replace(/\.[^.]+$/, '')
        const id = ldSlug(base) + '-' + Date.now().toString(36)
        const reader = new FileReader()
        const save = async (rec, okText) => {
          const r = await ldAddRecord(rec)
          if (r.ok !== true) done('err', 'Refusée par DSH : ' + (r.error || 'raison inconnue') + '.')
          else if (r.local === true) done('warn', okText + ' Elle n’est pas enregistrée sur le disque : elle reste dans ce navigateur jusqu’au rechargement.')
          else done('ok', okText)
        }
        reader.onerror = () => done('err', 'Le fichier n’a pas pu être lu.')
        if (ext === 'svg') {
          reader.onload = () => {
            const r = ldCleanSvg(String(reader.result))
            if (r.error) return done('err', r.error)
            save({ id, name: base.slice(0, 60), type: 'svg', kind: r.mono ? 'mono' : 'color', source: 'file', data: r.svg },
              '« ' + base + ' » ajoutée à Mes animations.' + (r.removed ? ' ' + r.removed + ' élément(s) dangereux retiré(s).' : '') + (r.animated ? '' : ' Ce SVG n’est pas animé : il apparaîtra fixe.'))
          }
          reader.readAsText(file)
        } else if (ext === 'json') {
          reader.onload = () => {
            let d = null
            try { d = JSON.parse(String(reader.result)) } catch (e) { return done('err', 'Ce fichier n’est pas du JSON valide.') }
            if (!(d !== null && typeof d === 'object' && Array.isArray(d.layers) && typeof d.fr === 'number' && typeof d.w === 'number')) return done('err', 'Ce JSON n’est pas une animation Lottie (il manque layers, fr ou w).')
            const name = (typeof d.nm === 'string' && d.nm.trim() !== '' ? d.nm : base).slice(0, 60)
            const dur = typeof d.op === 'number' && d.fr > 0 ? (((d.op - (d.ip || 0)) / d.fr).toFixed(1).replace('.', ',') + ' s') : ''
            save({ id, name, type: 'lottie', kind: 'color', source: 'file', dur, data: d }, '« ' + name + ' » (Lottie) ajoutée à Mes animations.')
          }
          reader.readAsText(file)
        } else if (ext === 'gif' || ext === 'webp' || ext === 'png') {
          reader.onload = () => save({ id, name: base.slice(0, 60), type: 'img', kind: 'color', source: 'file', data: String(reader.result) }, '« ' + base + ' » ajoutée à Mes animations.')
          reader.readAsDataURL(file)
        } else done('err', 'Format « .' + ext + ' » non pris en charge. Utilisez SVG, JSON (Lottie), GIF ou WebP.')
      })

      /** Un nœud d'animation, monté dans un <span> React. */
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
      /** Une liste de nœuds texte (et non une phrase) : le traducteur de pages va nœud par nœud. */
      const ldSummaryHint = () => {
        const sel = ld.S.sel.map(ldById).filter((x) => x !== null)
        const p = ldPackById(ld.S.pack)
        const names = []
        sel.forEach((l, i) => { if (i > 0) names.push(', '); names.push(l.name) })
        return (sel.length > 0 ? names.concat([' · ', ld.S.mode === 'random' ? 'au hasard' : 'dans l’ordre']) : ['Queue de baleine de DSH']).concat([' · ', 'texte :', ' ', p.name])
      }

      /** La ligne de résumé d'Essentiel : renvoie vers l'onglet Animation. */
      function LdSummary(props) {
        const [, bump] = React.useReducer((x) => x + 1, 0)
        React.useEffect(() => { ld.subs.add(bump); return () => { ld.subs.delete(bump) } }, [])
        const sel = ld.S.sel.map(ldById).filter((x) => x !== null)
        return h('div', { className: 'kbth-sum', 'data-kb': 'ld-summary' },
          h('div', { className: 'kbth-sum-ic' }, sel.length > 0
            ? sel.map((l) => h(LdView, { key: l.id, l, px: 28, spd: 1 }))
            : h('svg', { width: 28, height: 28, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' }, h('path', { d: LD_WHALE, stroke: 'currentColor', strokeWidth: 1 }))),
          h('div', { className: 'kbth-sum-tx' },
            h('span', { className: 'kbth-sec-t', style: { textTransform: 'none', fontSize: 13 } }, 'Animation de réflexion ', h('span', { className: 'kbth-new' }, 'NOUVEAU')),
            h('span', { className: 'kbth-hint' }, ldSummaryHint())),
          h('button', { type: 'button', className: 'kbth-btn', 'data-kb': 'ld-open', onClick: props.onOpen }, 'Régler…'))
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
        const [note, setNote] = React.useState(null)           // bannière de la fenêtre : { t, text }
        const [drawn, setDrawn] = React.useState(null)         // l'aperçu : { id, word, t0, hist }
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
          const poll = setInterval(() => { try { if (document.visibilityState !== 'hidden') ldPull(true) } catch (e) { /* page fermée */ } }, 4000)
          const clock = setInterval(bump, 1000)
          return () => { ld.subs.delete(bump); clearInterval(poll); clearInterval(clock) }
        }, [])
        const draw = () => {
          const l = ldChoose(memo.current.l)
          const w = ldChooseWord(memo.current.w)
          setDrawn((cur) => ({ id: l === null ? null : l.id, word: w, t0: Date.now() - 12000, hist: [l === null ? null : l.name].concat(cur === null ? [] : cur.hist).filter((x) => x !== null).slice(0, 4), nonce: (cur === null ? 0 : cur.nonce) + 1 }))
        }
        React.useEffect(() => { draw() }, [])
        // « Je viens de demander au chat une animation / des mots » : on attend qu'elle(s) arrive(nt) sur le disque.
        React.useEffect(() => {
          if (waiting === null) return
          if (waiting.kind === 'loader') {
            const n = ld.mine.filter((l) => l.source === 'skill').length
            if (n > waiting.base) {
              const fresh = ld.mine.filter((l) => l.source === 'skill')[0]
              setNote({ t: 'ok', text: '« ' + fresh.name + ' » est dans Mes animations. Ajoutez-la à votre rotation.' }); setTab('mine'); setWaiting(null)
            }
          } else if (ld.words.length > waiting.base) {
            setNote({ t: 'ok', text: (ld.words.length - waiting.base) + ' mot(s) ajouté(s) à votre pack.' }); setWaiting(null)
          }
        })
        // Fenêtre : Échap la ferme, Tab reste dedans, le focus revient au bouton d'origine.
        React.useEffect(() => {
          if (modal === null) return undefined
          const el = dlg.current
          if (el !== null && el !== undefined && typeof el.focus === 'function') el.focus()
          const key = (e) => {
            if (e.key === 'Escape' && !ambOpen) { e.preventDefault(); e.stopPropagation(); close(); return }
            if (e.key === 'Tab' && dlg.current) {
              // Toujours nous-mêmes : la boîte de réglages de DSH a son propre piège à focus, et la
              // fenêtre est posée hors d'elle (portail) — laisser faire le navigateur, c'est en sortir.
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

        // La phrase de DSH, avec son gabarit et sa durée, dont on remplace le mot de base.
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
          h('div', { className: 'kbth-sec-t', style: { fontSize: 13, textTransform: 'none' } }, 'Aperçu'),
          h('div', { className: 'kbth-ldp', 'data-kb': 'ld-preview' },
            h('div', { className: 'kbth-ldp-user' }, 'Peux-tu ranger les fichiers du dossier docs ?'),
            h('div', { className: 'kbth-ldp-step' }, 'Lecture de 3 fichiers'),
            h('div', { className: 'kbth-ldp-run' + (S.keep ? '' : ' nolabel') },
              h('span', { className: 'kbth-ldp-div' }),
              h('span', { className: 'kbth-ldp-ct' },
                h('span', { className: 'kbth-ldp-ic', style: { '--kb-px': px + 'px' } },
                  cur === null
                    ? h('svg', { className: 'kbth-ldp-whale', width: '100%', height: '100%', viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' }, h('path', { d: LD_WHALE, stroke: 'currentColor', strokeWidth: 1 }))
                    : h(LdView, { key: cur.id + ':' + drawn.nonce, l: cur, px, spd: S.speed, tint: S.tint && tAcc, late: S.delay, nonce: drawn.nonce })),
                h('span', { className: 'kbth-ldp-text', 'data-kb': 'ld-label' }, label)))),
          h('div', { className: 'kbth-ldp-bar' },
            h('button', { type: 'button', className: 'kbth-btn', 'data-kb': 'ld-draw', disabled: sel.length === 0, onClick: draw }, '↻ Simuler une réponse'),
            cur !== null ? h('span', null, 'Animation tirée : ', h('b', { style: { color: 'var(--dsw-alias-label-primary)' } }, cur.name)) : h('span', null, 'Aucune animation choisie : la queue de baleine de DSH s’affiche.'),
            drawn !== null && drawn.hist.length > 1 ? drawn.hist.map((n, i) => h('span', { key: i + n, className: 'kbth-ldchip' + (i === 0 ? ' cur' : '') }, n)) : null))

        // ── Rotation ────────────────────────────────────────────────────────
        const slots = [0, 1, 2, 3].map((i) => {
          const l = sel[i]
          if (l === undefined) return h('div', { key: 'e' + i, className: 'kbth-lds empty' }, 'Libre')
          return h('div', { key: l.id, className: 'kbth-lds' + (cur !== null && cur.id === l.id ? ' cur' : '') },
            S.mode === 'order' ? h('span', { className: 'kbth-lds-ord' }, String(i + 1)) : null,
            h('button', { type: 'button', className: 'kbth-lds-x', 'aria-label': 'Retirer ' + l.name, 'data-kb': 'ld-remove', 'data-id': l.id, onClick: () => ldSet({ sel: S.sel.filter((x) => x !== l.id) }) },
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
            h('div', { className: 'kbth-sec-t', style: { fontSize: 13, textTransform: 'none' } }, 'Ma rotation ', h('span', { className: 'kbth-hint' }, '— ', String(sel.length), ' ', 'sur', ' ', String(LD_MAX))),
            seg({ items: [
              { id: 'random', label: 'Au hasard', on: S.mode === 'random', tap: () => ldSet({ mode: 'random' }) },
              { id: 'order', label: 'Dans l’ordre', on: S.mode === 'order', tap: () => ldSet({ mode: 'order' }) }] })),
          sel.length === 0 ? h('div', { className: 'kbth-note' }, 'Rien n’est choisi : DSH garde sa queue de baleine.') : null,
          h('div', { className: 'kbth-ldt' }, slots),
          h('div', { className: 'kbth-row', style: { gap: 8 } },
            h('button', { type: 'button', className: 'kbth-btn', 'data-kb': 'ld-open-picker', onClick: (e) => { setTab('examples'); open('picker', e) } }, sel.length < LD_MAX ? '+ Ajouter une animation…' : 'Parcourir la bibliothèque…'),
            h('button', { type: 'button', className: 'kbth-btn', 'data-kb': 'ld-surprise-anim', onClick: surpriseAnim }, '✦ Me surprendre')))

        // ── Texte d'état : un grand sélecteur d'ambiances ───────────────────
        const plat = (x) => String(x).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        const ambs = LD_PACKS.concat([{ id: 'perso', name: 'Mon pack', custom: true, words: { fr: ld.words, en: ld.words } }])
        // Un aperçu qui VIT : trois mots qui défilent dans la liste toutes les 3 s, chaque ambiance partant d'un
        // endroit différent. Les trois premiers, figés, donnaient l'impression que le pack s'arrêtait là.
        const ambSample = (p) => {
          if (p.orig === true) return '« Deep diving for 12s ··· »'
          const w = (p.words[ldLang()] && p.words[ldLang()].length > 0) ? p.words[ldLang()] : p.words.en
          if (w.length === 0) return 'Aucun mot pour l’instant'
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
            h('div', { className: 'kbth-sec-t', style: { fontSize: 13, textTransform: 'none' } }, 'Texte d’état'),
            h('span', { className: 'kbth-hint' }, 'Aujourd’hui :', ' « Deep diving for 12s ··· »')),
          h('div', { className: 'kbth-fsel', ref: ambBox, 'data-kb': 'ld-amb' },
            h('button', { type: 'button', className: 'kbth-fsbtn', 'aria-haspopup': 'listbox', 'aria-expanded': String(ambOpen), onClick: () => { setAmbOpen((o) => !o); setAmbQ(''); setAmbIdx(0) } },
              h('span', { className: 'kbth-fsname' }, ambCur.name),
              h('span', { className: 'kbth-fschev' },
                h('svg', { width: 15, height: 15, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
                  h('path', { d: ambOpen ? 'M3.5 10.5 8 6l4.5 4.5' : 'M3.5 5.5 8 10l4.5-4.5', stroke: 'currentColor', strokeWidth: '1.6', strokeLinecap: 'round', strokeLinejoin: 'round' })))),
            h('div', { className: 'kbth-fsmeta' }, ambSample(ambCur)),
            ambOpen ? h('div', { className: 'kbth-fspanel' },
              h('input', { className: 'kbth-fssearch', ref: ambInput, value: ambQ, placeholder: 'Rechercher une ambiance…', 'aria-label': 'Rechercher une ambiance', onInput: (e) => { setAmbQ(e.target.value); setAmbIdx(0) }, onKeyDown: ambKey }),
              h('div', { className: 'kbth-fslist', role: 'listbox' },
                ambList.length === 0 ? h('div', { className: 'kbth-fsempty' }, 'Aucune ambiance ne correspond.')
                  : ambList.map((p, i) => h('button', { key: p.id, type: 'button', role: 'option', className: 'kbth-fsopt', 'aria-selected': p.id === S.pack ? 'true' : 'false', 'data-actif': i === ambIdx ? '1' : '0', 'data-id': p.id, disabled: disabledAmb(p), onMouseEnter: () => setAmbIdx(i), onClick: () => pickAmb(p.id) },
                    h('span', { className: 'kbth-fsopt-name' }, p.name),
                    h('span', { className: 'kbth-fsopt-sample' }, ambSample(p)))))) : null),
          h('div', { className: 'kbth-row', style: { gap: 8 } },
            h('button', { type: 'button', className: 'kbth-btn', 'data-kb': 'ld-surprise-text', onClick: surpriseText }, '✦ Me surprendre'),
            h('button', { type: 'button', className: 'kbth-btn', 'data-kb': 'ld-open-pack', onClick: (e) => open('pack', e) }, 'Modifier mon pack…')))

        // ── Réglages (repliés) ──────────────────────────────────────────────
        const sizeName = S.size === 'compact' ? 'Compacte' : (S.size === 'large' ? 'Grande' : 'Standard')
        const summary = [sizeName, ' · ' + LD_SIZES[S.size] + ' px · ', 'vitesse', ' ' + S.speed.toFixed(2).replace('.', ',') + ' × · ', S.rot === 'fixed' ? 'un mot par réponse' : (S.rot === '8' ? 'un mot toutes les 8 s' : 'un mot toutes les 15 s')]
        const reglages = h('div', { className: 'kbth-sec', style: { gap: 8 } },
          h('button', { type: 'button', className: 'kbth-disc', 'aria-expanded': String(setOpen), 'data-kb': 'ld-settings', onClick: () => setSetOpen((o) => !o) },
            h('span', { className: 'kbth-disc-t' }, 'Réglages'), h('span', { className: 'kbth-disc-s' }, summary),
            h('span', { className: 'kbth-fschev' }, h('svg', { width: 15, height: 15, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' }, h('path', { d: setOpen ? 'M3.5 10.5 8 6l4.5 4.5' : 'M3.5 5.5 8 10l4.5-4.5', stroke: 'currentColor', strokeWidth: '1.6', strokeLinecap: 'round', strokeLinejoin: 'round' })))),
          setOpen ? h('div', { className: 'kbth-setbody' },
            h('div', { className: 'kbth-grp' }, 'Animation'),
            h('div', { className: 'kbth-row' }, h('span', { className: 'kbth-lb' }, 'Taille'),
              seg({ items: [
                { id: 'compact', label: 'Compacte · 14 px', on: S.size === 'compact', tap: () => ldSet({ size: 'compact' }) },
                { id: 'standard', label: 'Standard · 24 px', on: S.size === 'standard', tap: () => ldSet({ size: 'standard' }) },
                { id: 'large', label: 'Grande · 40 px', on: S.size === 'large', tap: () => ldSet({ size: 'large' }) }] })),
            ldToggle('Teinter avec l’accent du thème', S.tint, () => ldSet({ tint: !S.tint }), 'Les animations d’une couleur prennent l’accent. Les autres gardent leurs couleurs.'),
            slider({ label: 'Vitesse', min: 50, max: 200, value: Math.round(S.speed * 100), text: S.speed.toFixed(2).replace('.', ',') + ' ×', tap: (v) => ldSet({ speed: v / 100 }) }),
            ldToggle('Ne jamais répéter la même d’affilée', S.avoid, () => ldSet({ avoid: !S.avoid })),
            slider({ label: 'Délai avant affichage', min: 0, max: 1000, value: S.delay, text: S.delay + ' ms', tap: (v) => ldSet({ delay: Math.round(v / 50) * 50 }), hint: 'Évite un clignotement sur les réponses très rapides.' }),
            h('div', { className: 'kbth-grp', style: { marginTop: 4 } }, 'Texte'),
            ldToggle('Garder le texte d’état', S.keep, () => ldSet({ keep: !S.keep }), 'Sans lui, seule l’animation reste dans la ligne de statut.'),
            h('div', { className: 'kbth-row' }, h('span', { className: 'kbth-lb' }, 'Changement'),
              seg({ items: [
                { id: 'fixed', label: 'Un mot par réponse', on: S.rot === 'fixed', tap: () => ldSet({ rot: 'fixed' }) },
                { id: '8', label: 'Toutes les 8 s', on: S.rot === '8', tap: () => ldSet({ rot: '8' }) },
                { id: '15', label: 'Toutes les 15 s', on: S.rot === '15', tap: () => ldSet({ rot: '15' }) }] })),
            ldToggle('Afficher la durée', S.dur, () => ldSet({ dur: !S.dur }), '« … for 12s » reste à droite du mot.'),
            h('div', { className: 'kbth-note' }, 'Animations réduites : l’image fixe remplace l’animation. Le réglage du système est respecté.'),
            h('div', { className: 'kbth-row' }, h('button', { type: 'button', className: 'kbth-btn', 'data-kb': 'ld-reset', onClick: () => ldSet({ ...LD_DEF, sel: S.sel, pack: S.pack }) }, 'Rétablir ces réglages'))) : null)

        // ── Fenêtre : bibliothèque ──────────────────────────────────────────
        const toggleSel = (id) => {
          if (S.sel.indexOf(id) >= 0) ldSet({ sel: S.sel.filter((x) => x !== id) })
          else if (S.sel.length < LD_MAX) ldSet({ sel: S.sel.concat([id]) })
          setTimeout(draw, 0)
        }
        const card = (l, mine) => {
          const on = S.sel.indexOf(l.id) >= 0
          const full = S.sel.length >= LD_MAX && !on
          const kindLabel = l.type !== 'inline' && l.kind !== 'mono' ? 'Couleurs d’origine' : (l.kind === 'mono' ? 'Une couleur' : 'Colorée')
          return h('div', { key: l.id, className: 'kbth-lcard' + (on ? ' on' : ''), 'data-id': l.id },
            h('div', { className: 'kbth-lcard-pv' }, h(LdView, { l, px: 44, spd: 1, tint: S.tint && tAcc })),
            h('div', { className: 'kbth-lcard-nm', title: l.name }, l.name),
            h('div', { className: 'kbth-lcard-meta' }, kindLabel, l.dur ? ' · ' + l.dur : null, mine ? ' · ' : null, mine ? (l.source === 'skill' ? 'Skill' : 'Fichier') : null, mine && typeof l.size === 'number' ? ' · ' + ldKo(l.size) : null),
            l.prompt ? h('div', { className: 'kbth-lcard-meta', style: { fontStyle: 'italic' } }, '« ' + l.prompt + ' »') : null,
            h('div', { className: 'kbth-lcard-acts' },
              h('button', { type: 'button', className: 'kbth-btn' + (on ? '' : ' kbth-ldpri'), 'data-kb': 'ld-toggle', 'data-id': l.id, disabled: full, title: full ? 'Retirez-en une pour en ajouter une autre' : undefined, onClick: () => toggleSel(l.id) }, on ? 'Retirer' : (full ? 'Rotation pleine' : 'Ajouter')),
              mine ? h('button', { type: 'button', className: 'kbth-btn del', 'aria-label': 'Supprimer ' + l.name, 'data-kb': 'ld-delete', 'data-id': l.id, onClick: () => { ldDelRecord(l.id).then(draw) } }, 'Suppr.') : null))
        }
        const ex = tab === 'examples'
        const exList = LD_PRESETS.filter((l) => filter === 'all' || l.kind === filter)
        const onDrop = (e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) ldImport(f).then((r) => { setNote({ t: r.t, text: r.text }); if (r.t !== 'err') setTab('mine') }) }
        const addTab = h('div', { className: 'kbth-add2' },
          h('div', { className: 'kbth-panel2' },
            h('h4', null, 'Importer un fichier'),
            h('p', null, 'SVG animé, Lottie (.json), GIF ou WebP animé. 200 Ko au maximum.'),
            h('div', { className: 'kbth-drop' + (over ? ' over' : ''), onDragEnter: (e) => { e.preventDefault(); setOver(true) }, onDragOver: (e) => { e.preventDefault(); setOver(true) }, onDragLeave: () => setOver(false), onDrop },
              h('span', null, 'Déposez un fichier ici'),
              h('label', { className: 'kbth-btn', style: { cursor: 'pointer' } }, 'Choisir un fichier',
                h('input', { type: 'file', accept: '.svg,.json,.gif,.webp,.png', 'data-kb': 'ld-file', style: { display: 'none' }, onChange: (e) => {
                  const input = e.target; const f = input.files && input.files[0]
                  if (!f) return
                  ldImport(f).then((r) => { setNote({ t: r.t, text: r.text }); if (r.t !== 'err') setTab('mine') })
                  input.value = ''
                } }))),
            h('p', null, 'Avant usage, DSH retire les scripts, les liens externes et les images intégrées du fichier.')),
          h('div', { className: 'kbth-panel2' },
            h('h4', null, 'Créer avec Claude'),
            h('p', null, 'Décrivez l’animation, collez la commande dans le chat : le skill « loader » la dessine et elle apparaît ici toute seule.'),
            h('textarea', { className: 'kbth-ta', value: prompt, placeholder: 'Trois points qui rebondissent, en suivant mon accent', 'aria-label': 'Description de l’animation', onInput: (e) => setPrompt(e.target.value) }),
            h('div', { className: 'kbth-codeln' }, h('span', null, '/skill-loader ' + (prompt.trim() === '' ? 'trois points qui rebondissent' : prompt.trim())),
              h('button', { type: 'button', className: 'kbth-link', 'data-kb': 'ld-copy', onClick: () => ldCopy('/skill-loader ' + (prompt.trim() === '' ? 'trois points qui rebondissent' : prompt.trim()), (ok) => { setCopied(ok ? 'loader' : 'fail'); setWaiting({ kind: 'loader', base: ld.mine.filter((l) => l.source === 'skill').length }) }) }, copied === 'loader' ? 'Copié' : 'Copier')),
            waiting !== null && waiting.kind === 'loader' ? h('div', { className: 'kbth-hint', role: 'status' }, 'En attente de l’animation… collez la commande dans le chat. Cette fenêtre la détecte seule.') : null,
            copied === 'fail' ? h('div', { className: 'kbth-hint' }, 'Copie impossible : sélectionnez la commande ci-dessus.') : null))
        const picker = h('div', { className: 'kbth-mdlg', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'kbth-ld-mt', tabIndex: -1, ref: dlg, 'data-kb': 'ld-picker', onKeyDown: (e) => e.stopPropagation() },
          h('div', { className: 'kbth-mhd' }, h('h3', { id: 'kbth-ld-mt' }, 'Ajouter une animation'), h('span', { className: 'kbth-hint' }, String(sel.length), ' ', 'sur', ' ', String(LD_MAX), ' ', 'dans la rotation'),
            h('button', { type: 'button', className: 'kbth-mx', 'aria-label': 'Fermer', onClick: close }, '×')),
          h('div', { className: 'kbth-mbody' },
            h('div', { className: 'kbth-pills' },
              [['examples', 'Exemples', LD_PRESETS.length], ['mine', 'Mes animations', ld.mine.length], ['add', 'Ajouter la vôtre', null]].map((t) =>
                h('button', { key: t[0], type: 'button', className: 'kbth-cat', 'aria-pressed': tab === t[0] ? 'true' : 'false', 'data-kb': 'ld-tab', 'data-id': t[0], onClick: () => { setTab(t[0]); setNote(null) } }, t[1], t[2] === null ? null : ' (' + t[2] + ')'))),
            note !== null ? h('div', { className: 'kbth-status ' + note.t, role: 'status', 'data-kb': 'ld-note' }, note.text) : null,
            ld.hostState === 'off' && ldHostOn() ? h('div', { className: 'kbth-status warn' }, 'Le disque de DSH ne répond pas : vos importations restent dans ce navigateur jusqu’au rechargement.') : null,
            tab === 'add' ? addTab : h('div', { className: 'kbth-sec', style: { gap: 10 } },
              ex ? h('div', { className: 'kbth-pills' }, [['all', 'Toutes'], ['mono', 'Une couleur'], ['color', 'Colorées']].map((f) =>
                h('button', { key: f[0], type: 'button', className: 'kbth-pillb', 'aria-pressed': filter === f[0] ? 'true' : 'false', onClick: () => setFilter(f[0]) }, f[1]))) : null,
              (ex ? exList : ld.mine).length > 0
                ? h('div', { className: 'kbth-lgrid' }, (ex ? exList : ld.mine).map((l) => card(l, !ex)))
                : h('div', { className: 'kbth-note' }, 'Vous n’avez encore rien ajouté. Importez un fichier ou demandez au skill d’en dessiner une, dans « Ajouter la vôtre ».'),
              ex ? h('div', { className: 'kbth-note' }, h('b', null, 'Les animations de vos références ne sont pas incluses. '), 'Les deux liens Dribbble montrent le même pack Lottie en couleurs, qui appartient à son auteur. Si vous l’avez, importez ses fichiers .json dans « Ajouter la vôtre ».') : null)),
          h('div', { className: 'kbth-mft' },
            h('span', { className: 'kbth-hint', style: { flex: 1 } }, sel.length >= LD_MAX ? 'Rotation pleine : retirez-en une pour en ajouter une autre.' : ''),
            h('button', { type: 'button', className: 'kbth-btn kbth-ldpri', onClick: close }, 'Terminé')))

        // ── Fenêtre : mon pack de mots ──────────────────────────────────────
        const addWord = () => { const w = wordDraft.trim(); if (w !== '') { ldPutWords(ld.words.concat([w])); setWordDraft('') } }
        const packCmd = '/skill-loading-text ' + (job.trim() === '' ? 'sage-femme libérale' : job.trim())
        const packModal = h('div', { className: 'kbth-mdlg', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'kbth-ld-mt', tabIndex: -1, ref: dlg, 'data-kb': 'ld-pack', onKeyDown: (e) => e.stopPropagation() },
          h('div', { className: 'kbth-mhd' }, h('h3', { id: 'kbth-ld-mt' }, 'Mon pack de mots'), h('button', { type: 'button', className: 'kbth-mx', 'aria-label': 'Fermer', onClick: close }, '×')),
          h('div', { className: 'kbth-mbody' },
            h('p', { className: 'kbth-hint', style: { margin: 0 } }, 'Vos propres mots, ou ceux que Claude écrit pour votre métier. Ils forment l’ambiance « Mon pack » du sélecteur.'),
            note !== null ? h('div', { className: 'kbth-status ' + note.t, role: 'status' }, note.text) : null,
            h('div', { className: 'kbth-wchips' }, ld.words.length > 0
              ? ld.words.map((w, i) => h('span', { key: w, className: 'kbth-wchip' }, w, h('button', { type: 'button', 'aria-label': 'Retirer ' + w, 'data-kb': 'ld-wdel', onClick: () => ldPutWords(ld.words.filter((_, j) => j !== i)) }, '×')))
              : h('span', { className: 'kbth-hint' }, 'Aucun mot. Ajoutez-en un, ou demandez à Claude.')),
            h('div', { className: 'kbth-row', style: { gap: 6 } },
              h('input', { className: 'kbth-in', style: { flex: 1, minWidth: 140 }, value: wordDraft, maxLength: 40, placeholder: 'Ajouter un mot, puis Entrée', 'aria-label': 'Ajouter un mot', 'data-kb': 'ld-word', onInput: (e) => setWordDraft(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); addWord() } } }),
              h('button', { type: 'button', className: 'kbth-btn', 'data-kb': 'ld-wadd', onClick: addWord }, 'Ajouter')),
            h('div', { className: 'kbth-panel2' },
              h('h4', null, 'Écrire avec Claude'),
              h('p', null, 'Le skill « loading-text » écrit une dizaine de mots propres à votre métier, dans la langue de l’interface. Collez la commande dans le chat : les mots arrivent ici tout seuls.'),
              h('input', { className: 'kbth-in', value: job, maxLength: 80, placeholder: 'Votre métier, par ex. sage-femme libérale', 'aria-label': 'Votre métier ou votre univers', onInput: (e) => setJob(e.target.value) }),
              h('div', { className: 'kbth-codeln' }, h('span', null, packCmd),
                h('button', { type: 'button', className: 'kbth-link', 'data-kb': 'ld-copy2', onClick: () => ldCopy(packCmd, (ok) => { setCopied(ok ? 'words' : 'fail'); setWaiting({ kind: 'words', base: ld.words.length }) }) }, copied === 'words' ? 'Copié' : 'Copier')),
              waiting !== null && waiting.kind === 'words' ? h('div', { className: 'kbth-hint', role: 'status' }, 'En attente des mots… collez la commande dans le chat. Cette fenêtre les détecte seule.') : null)),
          h('div', { className: 'kbth-mft' }, h('button', { type: 'button', className: 'kbth-btn kbth-ldpri', onClick: close }, 'Terminé')))

        return h(React.Fragment, null,
          h('section', { className: 'kbth-sec', style: { gap: 20 }, 'aria-labelledby': 'kbth-ld-t', 'data-kb': 'ld-pane' },
            h('div', null,
              h('div', { className: 'kbth-sec-t', id: 'kbth-ld-t' }, 'Animation de réflexion'),
              h('div', { className: 'kbth-sec-d', style: { marginTop: 4 } }, 'Ce qui s’anime en bas du chat pendant que l’agent travaille.')),
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

      function Page(props) {
        const ctxRef = props.ctx
        const themeSvc = (ctxRef && ctxRef.theme) ? ctxRef.theme : null
        const [S, setS] = React.useState(readState())
        const [hexDraft, setHexDraft] = React.useState(null)
        const [wpCat, setWpCat] = React.useState('gradients')
        const [tokSel, setTokSel] = React.useState('l1')
        const [revision, setRevision] = React.useState(0)
        // The theme library (« My themes »): redrawn when it changes (own writes, or the disk copy arriving).
        const [, libBump] = React.useReducer((x) => x + 1, 0)
        React.useEffect(() => { lib.subs.add(libBump); libPull(true); return () => { lib.subs.delete(libBump) } }, [])
        const [saveDlg, setSaveDlg] = React.useState(null)       // null | { name, groups, error }: the « Enregistrer comme thème » window
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
        const [exportFmt, setExportFmt] = React.useState('yaml')  // format de l'export affiché (non stocké)
        const [advTab, setAdvTab] = React.useState('essentiel') // onglet ouvert : Essentiel = les réglages de base

        // ── Sélecteur de police ────────────────────────────────────────────
        // L'état vit ici, avec les autres contrôles : le rendu hors navigateur
        // n'exécute que Page, et un composant imbriqué ne serait jamais appelé.
        const [fontOuvert, setFontOuvert] = React.useState(false)
        const [fontQ, setFontQ] = React.useState('')
        const [fontActif, setFontActif] = React.useState(0)
        const boitePolice = React.useRef(null)
        const champPolice = React.useRef(null)
        React.useEffect(() => {
          const el = champPolice.current
          if (!fontOuvert || el === null) return undefined
          el.focus()
          // Échap ferme le panneau de polices, PAS la boîte de réglages entière : on coupe la
          // propagation au niveau natif (celui où l'écoute la boîte), pas seulement en React.
          const stop = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setFontOuvert(false) } }
          el.addEventListener('keydown', stop)
          return () => el.removeEventListener('keydown', stop)
        }, [fontOuvert])
        React.useEffect(() => { setFontActif(0) }, [fontQ])
        React.useEffect(() => {
          // Suit la sélection au clavier dans une liste qui défile.
          const el = boitePolice.current === null ? null : boitePolice.current.querySelector('[data-actif="1"]')
          if (el !== null && el !== undefined && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' })
        }, [fontActif, fontOuvert])
        React.useEffect(() => {
          // Un clic ailleurs referme — pas de piège à focus.
          if (!fontOuvert) return undefined
          const dehors = (e) => { if (boitePolice.current !== null && boitePolice.current.contains(e.target) === false) setFontOuvert(false) }
          document.addEventListener('mousedown', dehors)
          return () => document.removeEventListener('mousedown', dehors)
        }, [fontOuvert])

        // Rendu du sélecteur : grand bouton (la police courante, dans sa propre
        // fonte) + panneau avec recherche et liste des familles.
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
            h('div', { className: 'kbth-fsmeta' }, choisi.stack === null ? 'Police native de DSH' : choisi.stack),
            fontOuvert
              ? h('div', { className: 'kbth-fspanel' },
                h('input', {
                  className: 'kbth-fssearch', ref: champPolice, value: fontQ, placeholder: 'Rechercher une police…',
                  'aria-label': 'Rechercher une police', onInput: (e) => setFontQ(e.target.value), onKeyDown: clavier
                }),
                h('div', { className: 'kbth-fslist', role: 'listbox' },
                  liste.length === 0
                    ? h('div', { className: 'kbth-fsempty' }, 'Aucune police ne correspond.')
                    : liste.map((x, i) => h('button', {
                      key: x.id, type: 'button', role: 'option', className: 'kbth-fsopt',
                      'aria-selected': x.id === courant ? 'true' : 'false',
                      'data-actif': i === fontActif ? '1' : '0',
                      onMouseEnter: () => setFontActif(i),
                      onClick: () => prendre(x.id),
                      style: x.stack === null ? {} : { fontFamily: x.stack }
                    },
                      h('span', { className: 'kbth-fsopt-name' }, x.name),
                      h('span', { className: 'kbth-fsopt-sample' }, 'Le renard brun saute par-dessus le chien paresseux.')))))
              : null)
        }

                // Suivre le mode réel (la page native peut le changer aussi). Une
        // préférence TIERS (« nebula »…) n'est pas un mode : la stocker
        // corromprait l'état — on ne suit que les trois modes natifs.
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

        // S'abonner aux changements de thème : quand un plugin tiers reprend la
        // main (dream-skin réaffirme son thème en moins de 250 ms), la note de
        // conflit doit RÉAPPARAÎTRE — sans cet abonnement, elle n'était calculée
        // qu'à nos propres re-rendus et restait masquée après la riposte.
        React.useEffect(() => {
          if (ctxRef === null || ctxRef === undefined || typeof ctxRef.on !== 'function') return
          let rendu = null
          try {
            rendu = ctxRef.on('theme/change', () => setRevision((r) => r + 1))
          } catch (e) { rendu = null }
          return () => { try { if (typeof rendu === 'function') rendu() } catch (e) { /* déjà détaché */ } }
        }, [])

        // `transient`: drawn but NOT stored, so a reload (or closing Settings) gives the previous look back: that is a trial.
        // Any other change made during a trial ends it: the person is editing the look they see.
        const commit = (patch, replace, transient) => {
          if (transient !== true && trialRef.current !== null) { trialRef.current = null; setTrial(null) }
          setS((cur) => {
            const next = replace === true ? { ...patch } : { ...cur, ...patch }
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
        const lvl = S.contrastMode === 'max' ? 2 : (S.contrastMode === 'plus' ? 1 : 0)
        const o = { acc: S.acc, ov: S.ov, lvl, cb: S.cbSafe, tint: wpo.id !== 'none' ? S.tint : 0, dom: wpo.dom }
        const dark = schemeSombre(S)
        const c = makeTheme(dark ? 'dark' : 'light', o)
        const cl = makeTheme('light', o)
        const cd = makeTheme('dark', o)

        // Le sélecteur de thème prêt : pastille « chip » concentrique.
        // Le FOND du thème en disque, l'ACCENT en point centré — la diagonale
        // 135° à arrêt sec (mesurée le 30/09) lisait comme un panneau de
        // signalisation, pas comme un thème. Un skin sans mode (pack hérité)
        // se dessine dans le schéma courant : c'est celui que l'utilisateur
        // verra en le sélectionnant.
        const skinDot = (sk) => {
          const m = (sk.mode === null || sk.mode === undefined) ? (dark ? 'dark' : 'light') : sk.mode
          const so = { acc: sk.acc, ov: sk.ov || {}, lvl: 0, cb: false, tint: 0, dom: '' }
          const sd = makeTheme(m, so)
          const acc = skinAccent(sk) || sd.brand
          // point d'accent 13 px sur disque 34 px (~38 %), bord adouci 0,5 px
          // pour éviter l'escalier d'anticrénelage sur le cercle.
          return 'radial-gradient(circle at 50% 50%,' + acc + ' 0 6.5px,' + sd.base + ' 7px 100%)'
        }
        const skinMeta = (sk) => (sk.mode === 'dark' ? 'Sombre' : (sk.mode === 'light' ? 'Clair' : 'Clair + sombre')) +
          (skinAccent(sk) === null ? ' · accent neutre' : ' · ' + skinAccent(sk)) +
          (sk.fontText !== undefined ? ' · police ' + (FONTS.find((f) => f.id === sk.fontText) || FONTS[0]).name : '') +
          (sk.radius !== undefined ? ' · coins ' + RADIUS_LABEL[sk.radius] : '')

        // The theme in use: one of yours, or a shipped one. « Modified » = a setting it retains has moved.
        const activeMine = lib.presets.find((x) => x.id === S.skin) || null
        const activeSkin = activeMine !== null ? null : (SKINS.find((x) => x.id === S.skin) || null)
        const activeNow = activeMine !== null ? presetAsSkin(activeMine) : activeSkin
        const activeModified = activeMine !== null ? settingsDirty(S, activeMine.settings) : (activeSkin !== null && settingsDirty(S, skinSettings(activeSkin)))
        const applyMine = (rec) => commit({ skin: rec.id, ...rec.settings })
        // Back to the theme as it was saved. The mode stays as it is: it is not part of « modified » either.
        const revertTheme = () => {
          const full = activeMine !== null ? { skin: activeMine.id, ...activeMine.settings } : (activeSkin !== null ? skinPatch(activeSkin) : null)
          if (full === null) return
          const { mode, ...rest } = full
          setHexDraft(null); commit(rest)
        }
        const openSave = () => { setLibNote(null); setSaveDlg({ name: libFreeName('Mon thème'), groups: { font: true, radius: true, glass: true, a11y: false }, error: '' }) }
        const doSave = () => {
          if (saveDlg === null) return
          const name = presetName(saveDlg.name)
          if (name === '') { setSaveDlg({ ...saveDlg, error: 'Donnez un nom au thème.' }); return }
          if (libNameTaken(name)) { setSaveDlg({ ...saveDlg, error: 'Ce nom existe déjà. Choisissez-en un autre.' }); return }
          const rec = libAdd(name, 'me', presetFromState(S, saveDlg.groups))
          if (rec === null) { setSaveDlg({ ...saveDlg, error: 'La bibliothèque est pleine (' + PRESET_LIMIT + ' thèmes). Supprimez-en un dans Partage.' }); return }
          setSaveDlg(null); commit({ skin: rec.id })
          setLibNote({ ok: true, text: 'Thème « ' + rec.name + ' » enregistré dans Mes thèmes.' })
        }
        const doUpdate = () => {
          if (activeMine === null) return
          libPatch(activeMine.id, { settings: presetFromState(S, groupsOf(activeMine.settings)) })
          setLibNote({ ok: true, text: 'Thème « ' + activeMine.name + ' » mis à jour.' })
        }

        // Un thème TIERS actif (dream-skin…) reprend la main sur la préférence :
        // mesuré, un setTheme('light') est réaffirmé sombre en moins de 250 ms.
        // On ne peut pas gagner ce bras de fer silencieusement — on le dit.
        let themeTiers = null
        try {
          const pref = themeSvc !== null && typeof themeSvc.getTheme === 'function' ? (themeSvc.getTheme() || {}).preference : null
          if (pref !== null && pref !== 'light' && pref !== 'dark' && pref !== 'system') themeTiers = pref
        } catch (e) { themeTiers = null }

        // Le champ et la pipette montrent l'accent EFFECTIF : celui choisi à la
        // main, sinon celui du skin en cours (les packs hérités portent leur
        // accent par schéma dans `ov`, donc S.acc reste null).
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
        const toSharing = h('button', { type: 'button', className: 'kbth-link', 'data-kb': 'theme-open-sharing', onClick: () => setAdvTab('partage') }, 'Partage')
        const toGallery = h('button', { type: 'button', className: 'kbth-link', 'data-kb': 'theme-open-gallery', onClick: () => setAdvTab('galerie') }, 'Galerie')
        const themeSummary = h('div', { className: 'kbth-sum', 'data-kb': 'theme-sum' },
          h('div', { className: 'kbth-sum-tx' },
            h('div', { className: 'kbth-sum-n' }, activeNow === null ? 'Personnalisé' : activeNow.name,
              activeModified ? h('span', { className: 'kbth-tone kbth-tone-mod', 'data-kb': 'theme-modified' }, 'modifié') : null,
              activeNow === null ? null : h('span', { className: 'kbth-pill' }, activeMine === null ? 'livré' : (activeMine.source === 'gallery' ? 'Galerie' : 'à vous'))),
            libNote !== null
              ? h('div', { className: libNote.ok ? 'kbth-ok kbth-gr-ok' : 'kbth-bad kbth-gr-err', role: 'status', 'data-kb': 'theme-note' }, libNote.text)
              : h('div', { className: 'kbth-sum-m' }, activeNow === null
                ? 'Réglage libre : enregistrez-le pour le retrouver en un clic.'
                : skinMeta(activeNow) + (activeModified && activeMine === null ? ' · un thème livré ne se modifie pas : enregistrez-en une copie.' : ''))),
          h('div', { className: 'kbth-sum-a' },
            activeMine !== null && activeModified ? h('button', { type: 'button', className: 'kbth-btn kbth-ldpri', 'data-kb': 'theme-update', onClick: doUpdate }, 'Mettre à jour') : null,
            h('button', { type: 'button', className: 'kbth-btn' + (activeMine !== null && activeModified ? '' : ' kbth-ldpri'), 'data-kb': 'theme-save', onClick: openSave }, 'Enregistrer sous…'),
            activeModified ? h('button', { type: 'button', className: 'kbth-btn', 'data-kb': 'theme-revert', onClick: revertTheme }, 'Annuler les changements') : null))
        const themeBlock = h('div', { className: 'kbth-sec', 'data-kb': 'theme-block' },
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, 'Thème'),
            h('div', { className: 'kbth-sec-d' }, 'Un thème règle les couleurs ; il peut aussi retenir la police et les coins. Gérez les vôtres dans ', toSharing, '.')),
          h('div', { className: 'kbth-skinblock' },
            h('div', { className: 'kbth-grp' }, 'Livrés'),
            h('div', { className: 'kbth-skins', 'data-kb': 'theme-shipped' }, SKINS.map((sk) => skinButton(sk, null)))),
          h('div', { className: 'kbth-skinblock' },
            h('div', { className: 'kbth-grp' }, 'Mes thèmes'),
            h('div', { className: 'kbth-skins', 'data-kb': 'theme-mine' },
              lib.presets.map((rec) => skinButton(presetAsSkin(rec), rec)),
              h('button', { type: 'button', className: 'kbth-skin kbth-skin-add', 'data-kb': 'theme-add', 'aria-label': 'Enregistrer l’état actuel comme thème', onClick: openSave },
                h('span', { className: 'kbth-skin-dot', 'aria-hidden': 'true' }, '+'),
                h('span', { className: 'kbth-skin-name' }, 'Enregistrer'))),
            lib.presets.length === 0 ? h('div', { className: 'kbth-empty' }, 'Aucun thème à vous pour l’instant. Réglez l’apparence puis « Enregistrer », importez un fichier dans ', toSharing, ', ou installez-en un depuis la ', toGallery, '.') : null),
          themeSummary,
          S.skin === 'dsh' ? h('div', { className: 'kbth-hint' }, '« Défaut DSH » retire la couche de jetons : l’apparence native repasse telle quelle.') : null)

        const apparence = h('div', { className: 'kbth-sec' },
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, 'Apparence'),
            h('div', { className: 'kbth-sec-d' }, 'Choisissez un mode, puis un thème prêt à l’emploi. Ce réglage remplace le bloc « Appearance » de la page Général — un seul endroit.')),
          h('button', { className: 'kbth-btn', type: 'button', style: { width: 'max-content' },
            onClick: () => commit(surprendre()) }, 'Me surprendre'),
          h('div', { className: 'kbth-row' },
            h('span', { className: 'kbth-lb' }, 'Mode'),
            seg({ items: [
              { id: 'system', label: 'Système', on: S.mode === 'system', tap: () => commit({ mode: 'system' }) },
              { id: 'light', label: 'Clair', on: S.mode === 'light', tap: () => commit({ mode: 'light' }) },
              { id: 'dark', label: 'Sombre', on: S.mode === 'dark', tap: () => commit({ mode: 'dark' }) }] }),
            themeTiers !== null ? h('div', { className: 'kbth-conflict' },
              h('strong', null, 'Conflit de thème : '),
              'Un autre plugin (« ' + themeTiers + ' ») contrôle le mode clair/sombre. ',
              'Désactivez-le dans son propre panneau pour que ce réglage s’applique.') : null),
          themeBlock)

        // ── Simple : couleur ────────────────────────────────────────────────
        const accentHex = S.acc === null ? c.brand : S.acc
        const couleur = h('div', { className: 'kbth-sec' },
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, 'Couleur'),
            h('div', { className: 'kbth-sec-d' }, 'Teinte des boutons, interrupteurs et sélections.')),
          h('div', { className: 'kbth-row' },
            h('span', { className: 'kbth-lb' }, 'Accent'),
            h('div', { className: 'kbth-acc' },
              h('label', { className: 'kbth-sw', style: { background: accentHex }, title: 'Pipette' },
                h('input', { type: 'color', value: accentHex, 'aria-label': 'Choisir la couleur d’accent',
                  onInput: (e) => { setHexDraft(null); commit({ acc: e.target.value }) } })),
              h('label', { className: 'kbth-hex' + (hexDraft !== null && !validHex(hexDraft) ? ' bad' : '') },
                h('span', null, '#'),
                h('input', { value: hexShown, maxLength: 7, spellCheck: false, 'aria-label': 'Code hexadécimal',
                  onInput: (e) => {
                    const v = e.target.value
                    setHexDraft(v)
                    const p = HEX(v)
                    if (p !== null) commit({ acc: toHex(p) })
                  } })),
              S.acc !== null ? h('button', { className: 'kbth-btn', type: 'button',
                onClick: () => { setHexDraft(null); commit({ acc: null }) } }, 'Rétablir') : null)),
          h('div', { className: 'kbth-dots' },
            ACCS.map((a) => h('button', {
              key: a, type: 'button', className: 'kbth-dot', style: { background: a },
              'aria-pressed': S.acc !== null && S.acc.toLowerCase() === a.toLowerCase() ? 'true' : 'false',
              title: a, 'aria-label': 'Accent ' + a,
              onClick: () => { setHexDraft(null); commit({ acc: a }) } }))))
        // P2-8 (chasse Settings 27/09) : les ratios WCAG restent en vue
        // Avancé — en Simple, ce jargon de contraste n'a rien à faire.
        const ratiosAccent = h('div', { className: 'kbth-hint' },
          'L’accent dérivé vise 4,5:1 sur les deux schémas : ',
          h('span', {
            className: 'kbth-acc-ratio', 'data-texte': c.accText, 'data-fond': c.l1,
            title: 'Texte d’accent sur la couche 1'
          }, ratio(c.accText, c.l1).toFixed(2) + ':1 (' + (dark ? 'sombre' : 'clair') + ')'),
          ' pour le texte d’accent, ',
          h('span', {
            className: 'kbth-btn-ratio', 'data-texte': c.onAcc, 'data-fond': c.fill,
            title: 'Texte sur un bouton d’accent'
          }, ratio(c.onAcc, c.fill).toFixed(2) + ':1'),
          ' pour le texte d’un bouton plein.')
        // ── Simple : fond ───────────────────────────────────────────────────
        // La tuile « Aucun » ouvre la grille : sans elle, un fond posé ne pouvait plus être retiré.
        const fonds = [WPS[0]].concat(WPS.filter((w) => w.cat === wpCat))
        const fond = h('div', { className: 'kbth-sec' },
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, 'Arrière-plan'),
            h('div', { className: 'kbth-sec-d' }, 'Couleur, dégradé, motif ou image derrière l’interface.')),
          h('div', { className: 'kbth-row' },
            h('span', { className: 'kbth-lb' }, 'Fond'),
            h('div', { className: 'kbth-wpcats' },
              WPCATS.map((cat) => h('button', {
                key: cat.id, type: 'button', className: 'kbth-cat',
                'aria-pressed': wpCat === cat.id ? 'true' : 'false',
                onClick: () => setWpCat(cat.id) }, cat.name)),
              wpo.id !== 'none' && WPCATS.every((cat) => cat.id !== wpo.cat)
                ? h('button', { type: 'button', className: 'kbth-cat', onClick: () => commit({ wp: 'none' }) }, 'Retirer (« ' + wpo.name + ' »)') : null)),
          h('div', { className: 'kbth-wps' },
            fonds.map((w) => h('button', {
              key: w.id, type: 'button', className: 'kbth-wp',
              'aria-pressed': S.wp === w.id ? 'true' : 'false', title: w.name,
              onClick: () => commit({ wp: w.id }) },
              h('span', { className: 'kbth-wp-band', style: { background: w.css } }),
              h('span', { className: 'kbth-wp-name', title: w.name }, w.name)))),
          wpo.id !== 'none' ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
            slider({ label: 'Visibilité', min: 0, max: 100, value: S.wpVis, text: S.wpVis + ' %',
              tap: (v) => commit({ wpVis: v }), hint: 'Opacité du fond derrière l’interface.' }),
            slider({ label: 'Flou', min: 0, max: 40, value: S.wpBlur, text: S.wpBlur + ' px',
              tap: (v) => commit({ wpBlur: v }), hint: 'Adoucit le fond pour laisser la place au contenu.' }),
            slider({ label: 'Teinte des surfaces', min: 0, max: 100, value: S.tint, text: S.tint + ' %',
              tap: (v) => commit({ tint: v }), hint: 'Tire les panneaux vers la dominante du fond, pour que l’interface s’y fonde.' })) : null)

        // ── Simple : police ─────────────────────────────────────────────────
        const police = h('div', { className: 'kbth-sec' },
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, 'Police'),
            h('div', { className: 'kbth-sec-d' }, 'Choisissez la police de l’interface ; la recherche filtre les familles.')),
          selecteurPolice(S.fontText, (id) => commit({ fontText: id })),
          slider({ label: 'Taille du texte', min: 12, max: 17, value: S.fs, text: S.fs + ' px',
            tap: (v) => commit({ fs: v }), hint: 'La taille de la conversation — le réglage natif de DSH, en direct.' }))

        // ── Avancé : sous-onglets ──────────────────────────────────────────
        const ADV_TABS = [
          { id: 'essentiel', label: 'Essentiel' },
          { id: 'verre', label: 'Verre et fond' },
          { id: 'couleurs', label: 'Couleurs' },
          { id: 'texte', label: 'Texte et forme' },
          { id: 'animation', label: 'Animation' },
          { id: 'accessibilite', label: 'Accessibilité' },
          { id: 'partage', label: 'Partage' },
          { id: 'galerie', label: 'Galerie' }
        ]

        // Toggle switch réutilisable
        const toggle = (label, value, onToggle, hint) => h('div', { className: 'kbth-toggle-row' },
          h('span', { className: 'kbth-toggle-label' }, label, hint ? h('span', { className: 'kbth-toggle-hint', title: hint }, ' ?') : null),
          h('button', { type: 'button', className: 'kbth-toggle' + (value ? ' on' : ''), role: 'switch', 'aria-checked': value ? 'true' : 'false', 'aria-label': label, onClick: onToggle },
            h('span', { className: 'kbth-toggle-knob' })))

        // ── Onglet Essentiel (= mode Simple condensé) ──────────────────────
        const advEssentiel = h('div', { className: 'kbth-sec' },
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, 'Essentiel'),
            h('div', { className: 'kbth-sec-d' }, 'Apparence, accent, fond et police.')),
          apparence, couleur, ratiosAccent, fond, police,
          h(LdSummary, { onOpen: () => setAdvTab('animation') }))

        // ── Onglet Verre et fond ───────────────────────────────────────────
        // Les réglages de verre n'ont d'effet que sur un fond : sans fond choisi on le dit, et l'aperçu montre
        // ce que donnerait le réglage (le vrai fond n'est visible que derrière le chat, pas dans les réglages).
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
            h('div', { className: 'kbth-sec-t' }, 'Verre'),
            h('div', { className: 'kbth-sec-d' }, 'Transparence et flou des surfaces posées sur le fond.')),
          verrePreview,
          wpOn ? null : h('div', { className: 'kbth-note' }, 'Ces réglages s’appliquent dès qu’un fond est choisi : Essentiel › Arrière-plan.'),
          h('div', { className: 'kbth-row' },
            h('span', { className: 'kbth-lb' }, 'Effet'),
            seg({ items: [
              { id: 'frosted', label: 'Verre dépoli', on: S.glassEffect === 'frosted', tap: () => commit({ glassEffect: 'frosted' }) },
              { id: 'liquid', label: 'Liquid glass', on: S.glassEffect === 'liquid', tap: () => commit({ glassEffect: 'liquid' }) }] })),
          slider({ label: 'Flou du verre', min: 0, max: 40, value: S.glassBlur, text: S.glassBlur + ' px', tap: (v) => commit({ glassBlur: v }) }),
          toggle('Lier la barre latérale au fond', S.sidebarLinked, () => commit({ sidebarLinked: !S.sidebarLinked }), 'Désactivé, la barre latérale reste pleine.'),
          h('div', { style: S.sidebarLinked ? null : { opacity: 0.45, pointerEvents: 'none' } },
            slider({ label: 'Transparence de la barre latérale', min: 0, max: 100, value: S.sidebarOpacity, text: S.sidebarOpacity + ' %', tap: (v) => commit({ sidebarOpacity: v }) })),
          slider({ label: 'Transparence des champs', min: 0, max: 100, value: S.fieldOpacity, text: S.fieldOpacity + ' %', tap: (v) => commit({ fieldOpacity: v }) }),
          slider({ label: 'Transparence des menus', min: 0, max: 100, value: S.floatOpacity, text: S.floatOpacity + ' %', tap: (v) => commit({ floatOpacity: v }) }),
          h('div', { style: { height: 16 } }),
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, 'Image de fond'),
            h('div', { className: 'kbth-sec-d' }, 'Réglages fins du fond choisi.')),
          slider({ label: 'Visibilité du fond', min: 0, max: 100, value: S.wpVis, text: S.wpVis + ' %', tap: (v) => commit({ wpVis: v }) }),
          slider({ label: 'Flou de l’image', min: 0, max: 40, value: S.wpBlur, text: S.wpBlur + ' px', tap: (v) => commit({ wpBlur: v }) }),
          slider({ label: 'Luminosité', min: 0, max: 200, value: S.bgBrightness, text: S.bgBrightness + ' %', tap: (v) => commit({ bgBrightness: v }) }),
          slider({ label: 'Contraste', min: 0, max: 200, value: S.bgContrast, text: S.bgContrast + ' %', tap: (v) => commit({ bgContrast: v }) }),
          slider({ label: 'Saturation', min: 0, max: 200, value: S.bgSaturation, text: S.bgSaturation + ' %', tap: (v) => commit({ bgSaturation: v }) }),
          slider({ label: 'Assombrissement', min: 0, max: 100, value: S.bgDarken, text: S.bgDarken + ' %', tap: (v) => commit({ bgDarken: v }) }),
          h('div', { className: 'kbth-row' },
            h('span', { className: 'kbth-lb' }, 'Ajustement'),
            seg({ items: [
              { id: 'cover', label: 'Couvrir', on: S.bgFit === 'cover', tap: () => commit({ bgFit: 'cover' }) },
              { id: 'fill', label: 'Remplir', on: S.bgFit === 'fill', tap: () => commit({ bgFit: 'fill' }) },
              { id: 'center', label: 'Centrer', on: S.bgFit === 'center', tap: () => commit({ bgFit: 'center' }) },
              { id: 'stretch', label: 'Étirer', on: S.bgFit === 'stretch', tap: () => commit({ bgFit: 'stretch' }) }] })),
          toggle('Miroir horizontal', S.bgMirror, () => commit({ bgMirror: !S.bgMirror })))

        // ── Onglet Couleurs ────────────────────────────────────────────────
        const sel = TOKINDEX[tokSel] || TOKMAP[0]
        const selClair = cl[sel[0]], selSombre = cd[sel[0]]
        const modifie = Object.prototype.hasOwnProperty.call(S.ov, 'light:' + sel[0]) || Object.prototype.hasOwnProperty.call(S.ov, 'dark:' + sel[0])
        const ratioSel = ['t1', 't2', 't3', 't4', 'link', 'err', 'ok', 'warn', 'biz'].indexOf(sel[0]) >= 0
        const TOK_CATS = [
          { id: 'surfaces', label: 'Surfaces', keys: ['base', 'l1', 'l2', 'l3', 'side', 'input', 'code'] },
          { id: 'texte', label: 'Texte', keys: ['t1', 't2', 't3', 't4'] },
          { id: 'etats', label: 'États', keys: ['err', 'ok', 'warn', 'biz', 'link'] },
          { id: 'marque', label: 'Marque', keys: ['brand'] }
        ]
        const [tokCat, setTokCat] = React.useState('surfaces')
        const catKeys = (TOK_CATS.find((c) => c.id === tokCat) || TOK_CATS[0]).keys
        const advCouleurs = h('div', { className: 'kbth-sec' },
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, 'Couleur d’accent'),
            h('div', { className: 'kbth-sec-d' }, 'Les couleurs de texte sont recalculées pour rester lisibles.')),
          h('div', { className: 'kbth-row' },
            h('span', { className: 'kbth-lb' }, 'Accent'),
            h('div', { className: 'kbth-acc' },
              h('label', { className: 'kbth-sw', style: { background: accentHex }, title: 'Pipette' },
                h('input', { type: 'color', value: accentHex, 'aria-label': 'Choisir la couleur d’accent',
                  onInput: (e) => { setHexDraft(null); commit({ acc: e.target.value }) } })),
              h('div', { className: 'kbth-dots' },
                ACCS.map((a) => h('button', {
                  key: a, type: 'button', className: 'kbth-dot', style: { background: a },
                  'aria-pressed': S.acc !== null && S.acc.toLowerCase() === a.toLowerCase() ? 'true' : 'false',
                  title: a, 'aria-label': 'Accent ' + a,
                  onClick: () => { setHexDraft(null); commit({ acc: a }) } }))))),
          h('div', { className: 'kbth-row' },
            h('span', { className: 'kbth-lb' }, 'Valeur exacte'),
            h('div', { className: 'kbth-acc' },
              h('label', { className: 'kbth-hex' + (hexDraft !== null && !validHex(hexDraft) ? ' bad' : '') },
                h('span', null, '#'),
                h('input', { value: hexShown, maxLength: 7, spellCheck: false, 'aria-label': 'Code hexadécimal',
                  onInput: (e) => { const v = e.target.value; setHexDraft(v); const p = HEX(v); if (p !== null) commit({ acc: toHex(p) }) } })),
              S.acc !== null ? h('button', { className: 'kbth-btn', type: 'button', onClick: () => { setHexDraft(null); commit({ acc: null }) } }, 'Neutre DSH') : null)),
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
            h('div', { className: 'kbth-sec-t' }, 'Jetons de couleur'),
            h('div', { className: 'kbth-sec-d' }, 'Modifiez un jeton pour le mode courant : le contraste est recalculé aussitôt.')),
          h('div', { className: 'kbth-row' },
            seg({ items: TOK_CATS.map((c) => ({ id: c.id, label: c.label, on: tokCat === c.id, tap: () => setTokCat(c.id) })) })),
          h('div', { className: 'kbth-sec-d', style: { marginTop: 4 } }, 'Couleurs du thème'),
          h('div', { className: 'kbth-toks' },
            catKeys.map((key) => {
              const e = TOKINDEX[key]
              if (!e) return null
              const r = ['t1', 't2', 't3', 't4', 'link', 'err', 'ok', 'warn', 'biz'].indexOf(key) >= 0
                ? ratio(c[key], c.l1) : null
              const badge = r !== null ? (r >= 7 ? 'AAA' : r >= 4.5 ? 'AA' : r >= 3 ? 'Grand texte' : 'Échec') : null
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
          // Éditeur du jeton sélectionné
          h('div', { className: 'kbth-adv-editor' },
            h('div', { className: 'kbth-adv-preview' },
              h('span', { className: 'kbth-adv-chip', style: { background: dark ? cd[sel[0]] : cl[sel[0]] } }),
              h('div', { className: 'kbth-adv-info' },
                h('span', { className: 'kbth-adv-label' }, sel[1]),
                h('span', { className: 'kbth-adv-css' }, '--dsw-' + sel[2]))),
            ratioSel ? h('div', { className: 'kbth-adv-ratio',
              style: { color: ratio(c[sel[0]], c.l1) >= 4.5 ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-warn-primary)' } },
              ratio(c[sel[0]], c.l1).toFixed(1) + ':1 · ' + (ratio(c[sel[0]], c.l1) >= 7 ? 'AAA' : ratio(c[sel[0]], c.l1) >= 4.5 ? 'AA' : 'Échec')) : null,
            h('div', { className: 'kbth-adv-colors' },
              ['light', 'dark'].map((m) => h('div', { key: m, className: 'kbth-adv-swatch' },
                h('label', { className: 'kbth-sw', style: { background: m === 'light' ? selClair : selSombre, width: 28, height: 28 },
                  title: (m === 'light' ? 'Clair' : 'Sombre') + ' — pipette' },
                  h('input', { type: 'color', value: m === 'light' ? selClair : selSombre,
                    'aria-label': sel[1] + ' (' + (m === 'light' ? 'clair' : 'sombre') + ')',
                    onInput: (e) => commit({ ov: { ...S.ov, [m + ':' + sel[0]]: e.target.value } }) })),
                h('span', { className: 'kbth-adv-swatch-label' }, m === 'light' ? 'Clair' : 'Sombre')))),
            modifie ? h('button', { className: 'kbth-btn', type: 'button', style: { width: 'max-content' },
              onClick: () => { const ov = { ...S.ov }; delete ov['light:' + sel[0]]; delete ov['dark:' + sel[0]]; commit({ ov }) } }, 'Rétablir') : null))

        // ── Onglet Texte et forme ──────────────────────────────────────────
        const advTexte = h('div', { className: 'kbth-sec' },
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, 'Texte'),
            h('div', { className: 'kbth-sec-d' }, 'La police se choisit dans Essentiel.')),
          slider({ label: 'Taille du texte', min: 12, max: 17, value: S.fs, text: S.fs + ' px', tap: (v) => commit({ fs: v }) }),
          toggle('Ligatures', S.ligatures, () => commit({ ligatures: !S.ligatures }), 'Fusionne « fi », « -> » et autres paires dans les polices qui en ont.'),
          h('div', { style: { height: 16 } }),
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, 'Forme'),
            h('div', { className: 'kbth-sec-d' }, 'Arrondi des boutons, cartes et panneaux.')),
          h('div', { className: 'kbth-row' },
            h('span', { className: 'kbth-lb' }, 'Rayons'),
            seg({ items: [
              { id: 'sharp', label: 'Net', on: S.radius === 'sharp', tap: () => commit({ radius: 'sharp' }) },
              { id: 'standard', label: 'Standard', on: S.radius === 'standard', tap: () => commit({ radius: 'standard' }) },
              { id: 'soft', label: 'Doux', on: S.radius === 'soft', tap: () => commit({ radius: 'soft' }) }] })),
          h('div', { style: { height: 16 } }),
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, 'Identité'),
            h('div', { className: 'kbth-sec-d' }, 'Ce qui rappelle le harness.')),
          toggle('Logo et nom', S.showBrand, () => commit({ showBrand: !S.showBrand }), 'Dans la barre latérale et sur l’écran d’accueil.'))

        // ── Onglet Accessibilité ───────────────────────────────────────────
        const advAccessibilite = h('div', { className: 'kbth-sec' },
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, 'Contraste'),
            h('div', { className: 'kbth-sec-d' }, 'Lisibilité des textes et des bordures.')),
          h('div', { className: 'kbth-row' },
            h('span', { className: 'kbth-lb' }, 'Niveau'),
            seg({ items: [
              { id: 'standard', label: 'Standard', on: S.contrastMode === 'standard', tap: () => commit({ contrastMode: 'standard' }) },
              { id: 'plus', label: 'Renforcé', on: S.contrastMode === 'plus', tap: () => commit({ contrastMode: 'plus' }) },
              { id: 'max', label: 'Maximal', on: S.contrastMode === 'max', tap: () => commit({ contrastMode: 'max' }) }] })),
          h('div', { className: 'kbth-hint' }, 'Rapports mesurés — AA : 4,5:1 · AAA : 7:1'),
          h('div', { className: 'kbth-a11y-table' },
            [['Texte principal', 't1'], ['Texte secondaire', 't2'], ['Texte tertiaire', 't3'], ['Légende', 't4'], ['Lien', 'link'], ['Bouton principal', 'brand']].map(([label, key]) => {
              const r = ratio(c[key], c.l1)
              const badge = r >= 7 ? 'AAA' : r >= 4.5 ? 'AA' : r >= 3 ? 'Grand texte' : 'Échec'
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
            h('div', { className: 'kbth-sec-t' }, 'Mouvement et focus'),
            h('div', { className: 'kbth-sec-d' }, 'Animations et navigation au clavier.')),
          toggle('Réduire les animations', S.reduceMotion, () => commit({ reduceMotion: !S.reduceMotion }), 'Coupe les animations et les transitions. Le réglage de votre système est déjà respecté sans cela.'),
          h('div', { className: 'kbth-row' },
            h('span', { className: 'kbth-lb' }, 'Anneau de focus'),
            seg({ items: [
              { id: 'accent', label: 'Accent', on: S.focusRing === 'accent', tap: () => commit({ focusRing: 'accent' }) },
              { id: 'double', label: 'Double', on: S.focusRing === 'double', tap: () => commit({ focusRing: 'double' }) },
              { id: 'thick', label: 'Épais', on: S.focusRing === 'thick', tap: () => commit({ focusRing: 'thick' }) }] })),
          h('div', { className: 'kbth-hint' }, 'Visible quand vous naviguez au clavier : essayez Tab.'),
          h('div', { style: { height: 16 } }),
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, 'Lisibilité'),
            h('div', { className: 'kbth-sec-d' }, 'Repères supplémentaires.')),
          toggle('Cibles de 44 px', S.largeTargets, () => commit({ largeTargets: !S.largeTargets }), 'Boutons et champs d’au moins 44 px de haut.'),
          toggle('Soulignement des liens', S.underlineLinks, () => commit({ underlineLinks: !S.underlineLinks })),
          toggle('Palette daltonisme', S.cbSafe, () => commit({ cbSafe: !S.cbSafe }), 'Succès et erreurs en bleu et orange plutôt qu’en vert et rouge.'))

        // ── Sharing tab: your themes, import, and the file of the current look ───────────
        const importThemeFile = (file) => {
          if (file.size > PRESET_FILE_MAX) { setLibNote({ ok: false, text: 'Fichier trop gros : un thème fait quelques Ko. Rien n’a été modifié.' }); return }
          const reader = new FileReader()
          reader.onload = () => {
            const r = presetFromFileText(String(reader.result))
            if (r.ok !== true) { setLibNote({ ok: false, text: 'Fichier non reconnu : seul un fichier de thème Kybernos (.json) est accepté. Rien n’a été modifié.' }); return }
            const rec = libAdd(r.name, 'file', r.settings, r.author !== undefined ? { author: r.author } : undefined)
            setLibNote(rec === null
              ? { ok: false, text: 'La bibliothèque est pleine (' + PRESET_LIMIT + ' thèmes). Supprimez-en un d’abord.' }
              : { ok: true, text: '« ' + rec.name + ' » est dans Mes thèmes' + (r.legacy ? ' (ancien fichier : tout le réglage est repris)' : '') + '. Il n’est pas appliqué.' })
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
            if (name === '') { setLibNote({ ok: false, text: 'Donnez un nom au thème.' }); return }
            if (libNameTaken(name, rec.id)) { setLibNote({ ok: false, text: 'Ce nom existe déjà. Choisissez-en un autre.' }); return }
            libPatch(rec.id, { name }); setRenameId(null); setLibNote(null)
          }
          const acts = renaming
            ? [h('button', { key: 'ok', type: 'button', className: 'kbth-btn kbth-ldpri', 'data-kb': 'theme-rename-ok', onClick: doRename }, 'OK'),
              h('button', { key: 'no', type: 'button', className: 'kbth-btn', onClick: () => setRenameId(null) }, 'Annuler')]
            : (deleting
              ? [h('span', { key: 'q', className: 'kbth-hint' }, 'Supprimer « ' + rec.name + ' » ?'),
                h('button', { key: 'y', type: 'button', className: 'kbth-btn kbth-danger kbth-gr-err', 'data-kb': 'theme-delete-yes', onClick: () => { libRemove(rec.id); setDelId(null); setLibNote({ ok: true, text: '« ' + rec.name + ' » supprimé.' }) } }, 'Supprimer'),
                h('button', { key: 'n', type: 'button', className: 'kbth-btn', onClick: () => setDelId(null) }, 'Garder')]
              : [cur ? null : h('button', { key: 'a', type: 'button', className: 'kbth-btn', 'data-kb': 'theme-apply', onClick: () => { setLibNote(null); applyMine(rec) } }, 'Appliquer'),
                h('button', { key: 'e', type: 'button', className: 'kbth-btn', 'data-kb': 'theme-export-one', 'aria-expanded': showing ? 'true' : 'false', onClick: () => setExpId(showing ? null : rec.id) }, 'Exporter'),
                h('button', { key: 'r', type: 'button', className: 'kbth-btn', 'data-kb': 'theme-rename', onClick: () => { setRenameId(rec.id); setRenameDraft(rec.name); setDelId(null) } }, 'Renommer'),
                h('button', { key: 'd', type: 'button', className: 'kbth-btn kbth-danger kbth-gr-err', 'data-kb': 'theme-delete', onClick: () => { setDelId(rec.id); setRenameId(null) } }, 'Supprimer')])
          const file = presetFile(rec)
          return h(React.Fragment, { key: rec.id },
            h('div', { className: 'kbth-trow', 'data-kb': 'theme-row', 'data-id': rec.id },
              h('span', { className: 'kbth-skin-dot', style: { background: skinDot(sk) } }),
              h('div', { className: 'kbth-trow-tx' },
                h('div', { className: 'kbth-trow-n' },
                  renaming
                    ? h('input', { className: 'kbth-in', style: { width: 190 }, value: renameDraft, maxLength: PRESET_NAME_MAX, 'aria-label': 'Nouveau nom', 'data-kb': 'theme-rename-in',
                      onInput: (e) => setRenameDraft(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); doRename() } else if (e.key === 'Escape') { e.stopPropagation(); setRenameId(null) } } })
                    : [h('span', { key: 'n' }, rec.name),
                      cur ? h('span', { key: 'c', className: 'kbth-tone kbth-tone-on kbth-gr-ok' }, 'appliqué') : null,
                      h('span', { key: 's', className: 'kbth-pill' }, rec.source === 'gallery' ? 'Galerie' + (rec.author !== undefined ? ' · ' + rec.author : '') : (rec.source === 'file' ? 'importé' : 'à vous'))]),
                h('div', { className: 'kbth-trow-m' }, skinMeta(sk) + ' · retient : ' + Object.keys(PRESET_GROUPS).filter((g) => groupsOf(rec.settings)[g]).map((g) => PRESET_GROUP_LABELS[g].toLowerCase()).join(', '))),
              h('div', { className: 'kbth-trow-a' }, acts)),
            showing ? h('div', { className: 'kbth-exp' },
              h('div', { className: 'kbth-row', style: { justifyContent: 'space-between' } },
                h('span', { className: 'kbth-hint' }, 'theme-' + fileSlug(rec.name) + '.json · à partager ou à versionner'),
                h('div', { className: 'kbth-row', style: { gap: 6 } },
                  h('button', { type: 'button', className: 'kbth-btn', 'data-kb': 'theme-copy-one', onClick: () => { try { navigator.clipboard.writeText(file) } catch (e) { /* clipboard unavailable */ } } }, 'Copier'),
                  h('button', { type: 'button', className: 'kbth-btn', 'data-kb': 'theme-download-one', onClick: () => { if (!downloadText('theme-' + fileSlug(rec.name) + '.json', file)) setLibNote({ ok: false, text: 'Le téléchargement a échoué : utilisez Copier.' }) } }, 'Télécharger'))),
              h('pre', { className: 'kbth-export-code', 'data-kb': 'theme-file' }, file)) : null)
        }

        const exportFormats = [['yaml', 'YAML'], ['json', 'JSON'], ['css', 'CSS']]
        const exportBody = exportTexte(exportFmt, S)
        const advPartage = h('div', { className: 'kbth-sec', style: { gap: 22 } },
          h('div', { className: 'kbth-sec' },
            h('div', { className: 'kbth-sec-h' },
              h('div', { className: 'kbth-sec-t' }, 'Mes thèmes'),
              h('div', { className: 'kbth-sec-d' }, 'Les thèmes que vous avez enregistrés ou importés.')),
            libNote !== null ? h('div', { className: libNote.ok ? 'kbth-ok kbth-gr-ok' : 'kbth-bad kbth-gr-err', role: 'status', 'data-kb': 'theme-note' }, libNote.text) : null,
            lib.presets.length > 0
              ? h('div', { className: 'kbth-lib', 'data-kb': 'theme-lib' }, lib.presets.map(libRow))
              : h('div', { className: 'kbth-state', 'data-kb': 'theme-lib-empty' },
                h('div', { className: 'kbth-sec-t' }, 'Aucun thème à vous'),
                h('div', { className: 'kbth-sec-d' }, 'Réglez l’apparence dans Essentiel puis enregistrez-la, ou importez un fichier ci-dessous.')),
            h('div', { className: 'kbth-row' },
              h('button', { type: 'button', className: 'kbth-btn kbth-ldpri', 'data-kb': 'theme-save-sharing', onClick: openSave }, 'Enregistrer l’état actuel…'),
              lib.hostState === 'off' && ldHostOn() ? h('span', { className: 'kbth-hint' }, 'Le disque de DSH ne répond pas : vos thèmes restent dans ce navigateur.') : null)),
          h('div', { className: 'kbth-sec' },
            h('div', { className: 'kbth-sec-h' },
              h('div', { className: 'kbth-sec-t' }, 'Importer'),
              h('div', { className: 'kbth-sec-d' }, 'Un fichier de thème (.json) s’ajoute à Mes thèmes. Il ne change rien tant que vous ne cliquez pas sur Appliquer. Un ancien fichier d’état complet devient lui aussi un thème.')),
            h('div', { className: 'kbth-row' },
              h('label', { className: 'kbth-btn', style: { cursor: 'pointer' } }, 'Choisir un fichier .json',
                h('input', { type: 'file', accept: '.json,application/json', 'data-kb': 'theme-import', style: { display: 'none' }, onChange: (e) => {
                  const input = e.target
                  const file = input.files && input.files[0]
                  if (!file) return
                  importThemeFile(file)
                  input.value = ''
                } })))),
          h('details', { className: 'kbth-fold', 'data-kb': 'theme-export-fold' },
            h('summary', null, 'Exporter l’état actuel'),
            h('div', { className: 'kbth-sec', style: { marginTop: 10 } },
              h('div', { className: 'kbth-sec-d' }, 'Le réglage en cours, tel quel : un fichier à partager ou à versionner. Pour un thème enregistré, utilisez « Exporter » sur sa ligne.'),
              h('div', { className: 'kbth-row' },
                h('span', { className: 'kbth-lb' }, 'Format'),
                seg({ items: exportFormats.map((f) => ({ id: f[0], label: f[1], on: exportFmt === f[0], tap: () => setExportFmt(f[0]) })) }),
                h('button', { className: 'kbth-btn', type: 'button', 'data-kb': 'theme-copy', onClick: () => {
                  try { navigator.clipboard.writeText(exportBody) } catch (e) { /* clipboard unavailable */ }
                } }, 'Copier')),
              h('div', { className: 'kbth-export-preview' },
                h('div', { className: 'kbth-export-bar' },
                  h('span', null, 'dsh-theme.' + (exportFmt === 'yaml' ? 'yml' : exportFmt)),
                  h('span', { 'data-kb': 'theme-export-lines' }, exportBody.split('\n').length + ' lignes')),
                h('pre', { className: 'kbth-export-code', 'data-kb': 'theme-export' }, exportBody)))),
          h('div', { className: 'kbth-sec' },
            h('div', { className: 'kbth-sec-h' },
              h('div', { className: 'kbth-sec-t' }, 'Réinitialiser'),
              h('div', { className: 'kbth-sec-d' }, 'Revenir aux valeurs par défaut du harness. Vos thèmes enregistrés restent dans Mes thèmes.')),
            h('div', { className: 'kbth-row' },
              h('span', { className: 'kbth-lb' }, 'Tous les réglages de thème'),
              h('button', { className: 'kbth-btn', type: 'button', onClick: () => { setHexDraft(null); commit({ ...DEF }, true) } }, 'Réinitialiser'))))

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
          if (rec === null) { setLibNote({ ok: false, text: 'La bibliothèque est pleine (' + PRESET_LIMIT + ' thèmes). Supprimez-en un dans Partage.' }); return }
          setHexDraft(null)
          commit({ skin: rec.id, ...rec.settings })
          setLibNote({ ok: true, text: '« ' + rec.name + ' » est installé et appliqué. Il est dans Mes thèmes.' })
        }
        const updateTheme = (t, rec) => {
          galUpdate(t, rec)
          if (S.skin === rec.id) commit({ ...t.settings })
          setLibNote({ ok: true, text: '« ' + rec.name + ' » est à jour (version ' + t.v + ').' })
        }
        const trialBar = trial === null ? null : h('div', { className: 'kbth-trial', role: 'status', 'data-kb': 'theme-trial' },
          h('span', null, 'Essai de ', h('b', null, trial.name), '. Rien n’est enregistré.'),
          h('span', { className: 'kbth-trial-sp' }),
          h('button', { type: 'button', className: 'kbth-btn kbth-ldpri', 'data-kb': 'theme-trial-install', onClick: () => { const t = gal.data === null ? null : gal.data.themes.find((x) => x.id === trial.id); if (t) installTheme(t) } }, 'Installer'),
          h('button', { type: 'button', className: 'kbth-btn', 'data-kb': 'theme-trial-end', onClick: endTrial }, 'Revenir à mon thème'))

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
            ? [h('span', { key: 'i', className: 'kbth-tone kbth-tone-on kbth-gr-ok' }, 'Installé'),
              newer ? h('button', { key: 'u', type: 'button', className: 'kbth-btn kbth-ldpri', 'data-kb': 'theme-gal-update', onClick: () => updateTheme(t, inst) }, 'Mettre à jour')
                : (S.skin === inst.id ? null : h('button', { key: 'a', type: 'button', className: 'kbth-btn', 'data-kb': 'theme-gal-apply', onClick: () => { setLibNote(null); setHexDraft(null); applyMine(inst) } }, 'Appliquer'))]
            : [h('button', { key: 'i', type: 'button', className: 'kbth-btn kbth-ldpri', 'data-kb': 'theme-gal-install', onClick: () => installTheme(t) }, 'Installer'),
              h('button', { key: 't', type: 'button', className: 'kbth-btn', 'data-kb': 'theme-gal-try', disabled: trying, onClick: () => startTrial(t) }, trying ? 'En essai' : 'Essayer')]
          return h('article', { key: t.id, className: 'kbth-card', 'data-kb': 'theme-gal-card', 'data-id': t.id, 'aria-label': t.name },
            galThumb(t),
            h('div', { className: 'kbth-card-b' },
              h('div', { className: 'kbth-card-n' }, t.name),
              // « par » and the name are two text nodes: the page's English dictionary translates the first and leaves the author alone
              t.author !== '' ? h('div', { className: 'kbth-card-a' }, 'par ', t.author) : null,
              (t.description[lang] || t.description.fr || t.description.en) !== '' ? h('div', { className: 'kbth-card-d' }, t.description[lang] || t.description.fr || t.description.en) : null,
              h('div', { className: 'kbth-card-m' }, skinMeta(sk)),
              h('div', { className: 'kbth-card-f' }, foot)))
        }
        const galBody = () => {
          if (gal.state === 'idle' || gal.state === 'loading') {
            return h('div', { className: 'kbth-gal', 'aria-hidden': 'true', 'data-kb': 'theme-gal-loading' }, [0, 1, 2, 3, 4, 5].map((i) => h('div', { key: i, className: 'kbth-sk' })))
          }
          if (gal.state === 'error' || gal.data === null) {
            return h('div', { className: 'kbth-state', role: 'alert', 'data-kb': 'theme-gal-error' },
              h('div', { className: 'kbth-sec-t' }, 'Impossible de lire la galerie'),
              h('div', { className: 'kbth-sec-d' }, 'Elle est lue par DSH, pas par la page. Si le plugin vient d’être mis à jour, redémarrez DSH. Vos thèmes restent disponibles dans Partage.'),
              h('button', { type: 'button', className: 'kbth-btn kbth-ldpri', 'data-kb': 'theme-gal-retry', onClick: () => { galLoad() } }, 'Réessayer'))
          }
          const q = galQ.trim().toLowerCase()
          const list = gal.data.themes.filter((t) => (galF === 'all' || t.settings.mode === galF) && (q === '' || (t.name + ' ' + t.author + ' ' + (t.description[lang] || t.description.fr)).toLowerCase().indexOf(q) >= 0))
          const o = gal.data.online
          const onlineText = galOnlineText(o)
          return h(React.Fragment, null,
            h('div', { className: 'kbth-src', 'data-kb': 'theme-gal-source' },
              gal.data.source === 'signed' ? h('span', { className: 'kbth-tone kbth-tone-on kbth-gr-ok' }, 'Catalogue signé') : h('span', { className: 'kbth-pill' }, 'Livré avec Kybernos'),
              h('span', null, gal.data.themes.length + (gal.data.themes.length > 1 ? ' thèmes' : ' thème')),
              o.state !== 'off' && !(o.state === 'refused' && o.reason === 'no-key')
                ? h('button', { type: 'button', className: 'kbth-link', 'data-kb': 'theme-gal-refresh', disabled: gal.refreshing, onClick: () => { galRefresh() } }, gal.refreshing ? 'Actualisation…' : 'Actualiser') : null),
            onlineText !== '' ? h('div', { className: 'kbth-hint', 'data-kb': 'theme-gal-online' }, onlineText) : null,
            h('div', { className: 'kbth-gbar' },
              h('input', { className: 'kbth-search', type: 'search', value: galQ, placeholder: 'Rechercher un thème, un auteur', 'aria-label': 'Rechercher un thème', 'data-kb': 'theme-gal-q', onInput: (e) => setGalQ(e.target.value) }),
              seg({ items: [['all', 'Tous'], ['light', 'Clair'], ['dark', 'Sombre']].map((f) => ({ id: f[0], label: f[1], on: galF === f[0], tap: () => setGalF(f[0]) })) })),
            list.length === 0
              ? h('div', { className: 'kbth-state', 'data-kb': 'theme-gal-none' },
                h('div', { className: 'kbth-sec-t' }, gal.data.themes.length === 0 ? 'La galerie est vide' : 'Aucun thème ne correspond'),
                h('div', { className: 'kbth-sec-d' }, gal.data.themes.length === 0 ? 'Aucun thème n’est publié pour l’instant.' : 'Essayez un autre mot, ou affichez tous les modes.'),
                gal.data.themes.length === 0 ? null : h('button', { type: 'button', className: 'kbth-btn', onClick: () => { setGalQ(''); setGalF('all') } }, 'Effacer la recherche'))
              : h('div', { className: 'kbth-gal', 'data-kb': 'theme-gal' }, list.map(galCard)))
        }
        const advGalerie = h('div', { className: 'kbth-sec', style: { gap: 14 } },
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, 'Galerie de thèmes'),
            h('div', { className: 'kbth-sec-d' }, 'Un thème n’est qu’un fichier de réglages : il ne contient aucun code et ne charge rien d’extérieur. Installez-le, ou essayez-le d’abord.')),
          libNote !== null ? h('div', { className: libNote.ok ? 'kbth-ok kbth-gr-ok' : 'kbth-bad kbth-gr-err', role: 'status', 'data-kb': 'theme-note' }, libNote.text) : null,
          galBody())

        // ── Assemblage Avancé avec sous-onglets ────────────────────────────
        const ADV_CONTENT = {
          essentiel: advEssentiel,
          animation: h(AnimationPane, { ctx: ctxRef }),
          verre: advVerre,
          couleurs: advCouleurs,
          texte: advTexte,
          accessibilite: advAccessibilite,
          partage: advPartage,
          galerie: advGalerie
        }
        const groupToggle = (g, hint) => ldToggle(PRESET_GROUP_LABELS[g], saveDlg.groups[g] === true, () => setSaveDlg({ ...saveDlg, groups: { ...saveDlg.groups, [g]: !saveDlg.groups[g] } }), hint)
        const saveModal = saveDlg === null ? null : h(ThemeModal, { labelId: 'kbth-save-t', kb: 'theme-save-dlg', onClose: () => setSaveDlg(null) },
          h('div', { className: 'kbth-mhd' },
            h('h3', { id: 'kbth-save-t' }, 'Enregistrer comme thème'),
            h('button', { type: 'button', className: 'kbth-mx', 'aria-label': 'Fermer', onClick: () => setSaveDlg(null) }, '×')),
          h('div', { className: 'kbth-mbody' },
            h('div', { className: 'kbth-sec', style: { gap: 6 } },
              h('label', { className: 'kbth-lb', htmlFor: 'kbth-save-name', style: { width: 'auto' } }, 'Nom'),
              h('input', {
                id: 'kbth-save-name', className: 'kbth-in' + (saveDlg.error !== '' ? ' bad' : ''), value: saveDlg.name, maxLength: PRESET_NAME_MAX, autoComplete: 'off', 'data-kb': 'theme-save-name',
                'aria-invalid': saveDlg.error !== '' ? 'true' : 'false',
                onInput: (e) => setSaveDlg({ ...saveDlg, name: e.target.value, error: '' }),
                onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); doSave() } } }),
              saveDlg.error !== '' ? h('div', { className: 'kbth-bad kbth-gr-err', role: 'alert', 'data-kb': 'theme-save-error' }, saveDlg.error) : null),
            h('div', { className: 'kbth-sec', style: { gap: 4 } },
              h('div', { className: 'kbth-sec-t' }, 'Ce que le thème retient'),
              h('div', { className: 'kbth-hint' }, 'Les couleurs et l’accent sont toujours retenus.'),
              groupToggle('font'), groupToggle('radius'), groupToggle('glass'),
              groupToggle('a11y', 'Contraste, palette daltonien, cibles larges : ce sont vos besoins, pas un style. Décoché, un thème ne les change jamais.'))),
          h('div', { className: 'kbth-mft' },
            h('button', { type: 'button', className: 'kbth-btn', onClick: () => setSaveDlg(null) }, 'Annuler'),
            h('button', { type: 'button', className: 'kbth-btn kbth-ldpri', 'data-kb': 'theme-save-ok', onClick: doSave }, 'Enregistrer')))

        // Une seule page : les sept onglets restent toujours là, « Essentiel » s'ouvre par défaut.
        const reglages = h('div', { className: 'kbth-sec' },
          // Onglets empilés VERTICALEMENT à gauche, contenu à droite.
          h('div', { className: 'kbth-adv-cols' },
            h('div', { className: 'kbth-adv-tabs' },
              ADV_TABS.map((t) => h('button', {
                key: t.id, type: 'button', className: 'kbth-adv-tab' + (advTab === t.id ? ' on' : ''),
                'aria-pressed': advTab === t.id ? 'true' : 'false',
                onClick: () => setAdvTab(t.id) }, t.label))),
            h('div', { className: 'kbth-adv-pane' },
              trialBar,
              ADV_CONTENT[advTab] || advCouleurs)))

        // ── assemblage — une seule colonne (l'aperçu latéral a été retiré) ────────
        return h(React.Fragment, null,
          saveModal,
          h('div', { className: 'kbth-page' },
            // Colonne principale
            h('div', { className: 'kbth-main' },
              h('div', { className: 'kbth-head' },
                h('div', { style: { display: 'flex', justifyContent: 'flex-end', width: '100%', marginBottom: 6 } }, (typeof window !== 'undefined' && window.__KB_HELP__ && window.__KB_HELP__.Help ? h(window.__KB_HELP__.Help, { id: 'kybernos-theme' }) : null)),
                h('div', { className: 'kbth-title' }, 'Thème'),
                h('div', { className: 'kbth-sub' },
                  'Personnalisez l’apparence de DeepSeek Harness. Les réglages de base sont dans Essentiel.'),
                // (02/10) Rappel : le MODE clair / sombre / système se règle dans Apparence (groupe Account) ;
                // ce panneau garde palette, accent, fond, police et variables — rien n'est perdu.
                h('div', { className: 'kbth-hint', 'data-kb': 'theme-appearance-reminder' },
                  'Mode clair / sombre / système : réglé dans ',
                  h('button', { type: 'button', className: 'kbth-link', 'data-kb': 'theme-open-appearance', onClick: () => {
                    try {
                      const norm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim()
                      const cells = Array.prototype.slice.call(document.querySelectorAll('[role="dialog"] nav button'))
                      for (let i = 0; i < cells.length; i++) { const n = norm(cells[i].textContent); if (n === 'appearance' || n === 'apparence') { cells[i].click(); break } }
                    } catch (e) { /* nav indisponible */ }
                  } }, 'Apparence'),
                  ' (Account).')),
              h('div', null, reglages),
              h('div', { className: 'kbth-foot' },
                h('span', { className: 'kbth-pill' }, estNaturel(S) ? 'DSH natif — aucune couche posée' : '17 jetons · {light, dark}'),
                h('span', { className: 'kbth-pill' }, (jetonsRetouches(S.ov) === 1 ? '1 jeton retouché' : jetonsRetouches(S.ov) + ' jetons retouchés')),
                h('button', { className: 'kbth-btn', type: 'button',
                  onClick: () => { setHexDraft(null); commit({ ...DEF }, true) } }, 'Tout rétablir'),
                h('button', { className: 'kbth-btn', type: 'button',
                  onClick: () => setRevision((r) => r + 1) }, 'Actualiser le mode')))))
      }

      // ══════════════════════════════════════════════════════════════════════
      // 6. MONTAGE.
      // ══════════════════════════════════════════════════════════════════════

      // Le contrat d'export d'une entrée cordis : la liste des services que le
      // contexte DOIT exposer — le garde de ctx refuse tout ctx.<service> non
      // déclaré ici (même contrat que kybernos et dream-skin). Sans elle,
      // l'entrée reste « loading » et n'active jamais.
      return {
        inject: ['slots', 'theme', 'remote', 'locale'],
        // Read-only handles for test-client.mjs (same convention as kybernos-language).
        __test: {
          makeTheme, ratio, HEX, toHex, mix, SKINS, WPS, WPCATS, FONTS, ACCS, TOKMAP, DEF, STORE_KEY,
          skinPatch, skinAccent, legacyAdopt, readState, writeState, estNaturel, surprendre, sanitiserImport, schemeSombre, effetsCss, exportTexte, filtreFond, ajustementFond, avecAlpha, valeursValides, appliquerEffets, ENUMS, RANGES, BOOLS, RADIUS_DEF, jetonsRetouches, tailleNative,
          LD_PRESETS, LD_PACKS, LD_DEF, LD_SIZES, LD_KEY, ld, ldClean, ldRead, ldSet, ldHash, ldChoose, ldChooseWord, ldWordList, ldById, ldPackById, ldNode, ldDestroy, ldCleanSvg, ldImport,
          ldDecorate, ldStart, ldStop, ldApplyText, ldPull, ldAddRecord, ldDelRecord, ldPutWords, ldCacheRead, AnimationPane, LdSummary, LdView,
          appliquerBoot, appliquerTout, appliquerJetons, appliquerFond, appliquerPolice, Page,
          PRESET_FORMAT, PRESET_GROUPS, PRESET_KEYS, PRESET_LIMIT, PRESET_ID, LIB_KEY, lib, libClean, libRead, libWrite, libSet, libAdd, libPatch, libRemove, libPull, libFreeName, libNameTaken,
          gal, galTheme, galClean, galLoad, galRefresh, galInstalled, galInstall, galUpdate, galOnlineText, kbLang,
          presetSettings, presetRecord, presetFromState, presetFile, presetFromFileText, settingsDirty, skinSettings, presetAsSkin, groupsOf, fileSlug, ThemeModal,
        },
        apply(ctx) {
          // (01/10) Libellé selon l'état de langue courant. La langue n'est
          // PLUS portée par ce bundle depuis le 01/10 : elle vit dans
          // @local/kybernos-language, qui pose `__KB_I18N_ACTIVE__` dès son
          // activation. Ce plugin ne fait que LIRE le global — débrayable sans
          // casser le thème : sans language, le libellé retombe en français.
          const kbthLabel = (fr, en) => {
            try {
              const a = (typeof window !== 'undefined') ? window.__KB_I18N_ACTIVE__ : null
              const loc = (a !== null && a !== undefined && a.lang !== null && a.lang !== undefined) ? String(a.lang).toLowerCase() : ''
              return loc.indexOf('en') === 0 ? en : fr
            } catch (e) { return fr }
          }
          // (29/09) Le bloc « Appearance » de Général ▸ (DSH) est masqué : la
          // section Apparence de la page Thème règle la MÊME préférence via
          // themeSvc.setTheme — deux endroits pour un réglage, c'est un de
          // trop. Les classes du shell sont hachées : on repère le bloc par
          // son texte (titre « Appearance » + boutons Light/Dark/System) et on
          // le marque data-kbth-own (la règle CSS ci-dessus le cache).
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
          // L'état persisté s'applique DÈS L'ACTIVATION : au rechargement de la
          // page, le thème revient avant que l'utilisateur n'ouvre les réglages
          // (anti-flash v1 — l'injection côté serveur viendra en v2).
          try {
            if (ctx !== null && ctx !== undefined && ctx.theme !== null && ctx.theme !== undefined) {
              const S = readState()
              appliquerBoot(ctx.theme, S)
              // Adoption : la préférence native explicite (clair/sombre) est le
              // dernier choix de l'utilisateur — quel que soit le contrôle
              // employé, bouton du pied de sidebar compris. On la recopie dans
              // notre store pour que la page Réglages l'affiche.
              const nat = prefNative(ctx.theme)
              const natPx = tailleNative(ctx.theme)
              const adopt = {}
              if (nat !== null && nat !== 'system' && nat !== S.mode) adopt.mode = nat
              if (natPx !== null && natPx !== S.fs) adopt.fs = natPx
              if (Object.keys(adopt).length > 0) writeState({ ...S, ...adopt })
              // Et on suit les changements natifs pour la suite : sans cet
              // abonnement, un mode choisi hors de la page Réglages Kybernos
              // n'était jamais mémorisé (bug du rechargement, cf. appliquerBoot).
              // `theme/change` est émis sur le contexte racine (les contextes
              // cordis partagent le registre `_hooks` — `noShadow`) : l'écoute
              // depuis notre contexte le reçoit, et c'est aussi le chemin par
              // lequel la préférence durable arrive ~1,5 s après l'activation
              // (mesuré : `preference` vaut « system» au t0, « dark » au t1500).
              // Le service n'expose PAS de `subscribe` : l'abonnement du pied de
              // sidebar (`tSvc.subscribe`) est un no-op silencieux.
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
                  return () => { try { if (typeof off === 'function') off() } catch (e) { /* déjà détaché */ } }
                } catch (e) { return undefined }
              }, 'kybernos-theme: mémorise le mode natif')
            }
          } catch (e) {
            // Une erreur avalée ici se lit comme « le plugin ne marche pas » :
            // on la trace pour rester diagnosticable.
            try { console.error('[kybernos-theme] application initiale échouée', e) } catch (e2) { /* console indisponible */ }
          }

          // « My themes »: the disk copy, once the page is up. Never a reason for DSH not to start.
          try { setTimeout(() => { libPull(true) }, 900) } catch (e) { /* no timers */ }

          // L'animation du statut du bas : défensif de bout en bout (un échec ici ne touche pas DSH).
          try {
            if (ctx !== null && ctx !== undefined && typeof ctx.effect === 'function') ctx.effect(() => ldStart(ctx), 'kybernos-theme: animation de réflexion')
          } catch (e) {
            try { console.error('[kybernos-theme] animation de réflexion : démarrage impossible', e) } catch (e2) { /* console indisponible */ }
          }

          if (ctx !== null && ctx !== undefined && ctx.slots !== null && ctx.slots !== undefined) {
            ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register(
              { name: 'settings.section', id: 'kybernos-theme', order: 1, label: kbthLabel('Thème', 'Theme') },
              (props) => h(Page, { ...props, ctx }))), 'kybernos-theme: section réglages thème')

            ctx.effect(() => styles.insert(css), 'kybernos-theme: styles')
          }
        }
      }
    } catch (kbThemeBootError) {
      try {
        console.error('[kybernos-theme] chargement impossible — plugin désactivé, GUI préservée', kbThemeBootError)
      } catch (e2) { /* console indisponible */ }
      return { apply() { /* plugin désactivé après erreur de chargement */ } }
    }
  },
})
