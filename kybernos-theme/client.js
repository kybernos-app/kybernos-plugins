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
        dark: { base: '#151517', l1: '#232324', l2: '#2C2C2E', l3: '#353638', platform: '#353638', overlay: '#61666B', b1: '#FFFFFF0F', b2: '#FFFFFF1F', b3: '#FFFFFF29', b4: '#FFFFFF33', brand: '#F9FAFB', onBrand: '#0F1115', t1: '#F9FAFB', t2: '#CFD3D6', t3: '#ADB2B8', t4: '#81858C', link: '#679EFE', hov: '#FFFFFF14', act: '#FFFFFF24', err: '#F25A5A', ok: '#22C55E', warn: '#F59E0B', biz: '#679EFE', side: '#1B1B1C', navAct: '#43454A', navHov: '#2C2C2E', input: '#2C2C2E', selector: '#353638', code: '#1B1B1C', codeBanner: '#2C2C2E', inline: '#292929', tipBg: '#43454A', okSoft: '#233C2C', errSoft: '#570C0C', warnSoft: '#27241F', bizSoft: '#34415B', okTx: '#4ED17E', warnTx: '#F7AD31', off: '#61666B' }
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
          t.b2 = dark ? '#FFFFFFA6' : '#000000A6'; t.b3 = dark ? '#FFFFFFCC' : '#000000CC'; t.b4 = dark ? '#FFFFFF' : '#000000'
        }
        if (o.tint > 0 && o.dom) { SURF.forEach((k) => { t[k] = mix(t[k], o.dom, o.tint / 100 * 0.16) }) }
        Object.keys(o.ov || {}).forEach((k) => { if (k.indexOf(mode + ':') === 0) { t[k.slice(mode.length + 1)] = o.ov[k] } })
        if (o.cb) { t.okSoft = dark ? '#10263F' : '#E3EEFF'; t.errSoft = dark ? '#3D2A10' : '#FFEBD6' }
        const acc = o.acc || t.brand
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
      const DEF = {
        level: 'simple', mode: 'dark', skin: 'dsh', acc: null,
        wp: 'none', wpVis: 60, wpBlur: 0, tint: 0,
        fs: 15, fontText: 'dsh', ov: {}, contrastMode: 'standard', cbSafe: false
      }
      const readState = () => {
        try {
          const raw = localStorage.getItem(STORE_KEY)
          if (raw === null) return { ...DEF, ...legacyAdopt() }
          const s = JSON.parse(raw)
          const out = { ...DEF }
          for (const k of Object.keys(DEF)) if (s[k] !== undefined) out[k] = s[k]
          if (out.ov === null || typeof out.ov !== 'object') out.ov = {}
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

      const estNaturel = (S) => S.skin === 'dsh' && S.acc === null && S.wp === 'none'
        && Object.keys(S.ov).length === 0 && S.contrastMode === 'standard'

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
          if (isPattern) {
            wpEl.style.backgroundSize = 'auto'
            wpEl.style.backgroundRepeat = 'repeat'
          } else {
            wpEl.style.backgroundSize = 'cover'
            wpEl.style.backgroundPosition = 'center'
            wpEl.style.backgroundRepeat = 'no-repeat'
          }
          wpEl.style.opacity = String(Math.max(0, Math.min(100, S.wpVis)) / 100)
          wpEl.style.filter = S.wpBlur > 0 ? 'blur(' + S.wpBlur + 'px)' : 'none'
        }
        // readyState, pas DOMContentLoaded : à l'activation du plugin,
        // l'événement est SOUVENT déjà passé — l'attendre ne servirait à rien.
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', poser, { once: true })
          return
        }
        poser()
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
        appliquerTaille(themeSvc, S)
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
.kbth-skin-current{margin-top:10px}
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
.kbth-adv-layout{display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start}
@media(max-width:700px){.kbth-adv-layout{grid-template-columns:1fr}}
.kbth-adv-editor{display:flex;flex-direction:column;gap:12px;padding:14px;border-radius:12px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);position:sticky;top:0}
.kbth-adv-preview{display:flex;align-items:center;gap:10px;padding:10px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l2)}
.kbth-adv-chip{width:32px;height:32px;border-radius:6px;border:1px solid var(--dsw-alias-border-l3);flex:none}
.kbth-adv-info{display:flex;flex-direction:column;gap:2px;min-width:0}
.kbth-adv-label{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.kbth-adv-css{font-size:11px;color:var(--dsw-alias-label-tertiary);font-family:ui-monospace,Menlo,monospace}
.kbth-adv-ratio{font-size:11px;font-variant-numeric:tabular-nums}
.kbth-adv-colors{display:flex;gap:8px;align-items:center}
.kbth-adv-swatch{display:flex;flex-direction:column;align-items:center;gap:3px}
.kbth-adv-swatch-circle{width:28px;height:28px;border-radius:6px;border:1px solid var(--dsw-alias-border-l3)}
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
/* ── Palette ANSI ────────────────────────────────────────────────────── */
.kbth-ansi-grid{display:grid;grid-template-columns:repeat(8,1fr);gap:6px;margin-top:8px}
.kbth-ansi-swatch{aspect-ratio:1;border-radius:6px;border:1px solid var(--dsw-alias-border-l3);cursor:pointer;transition:transform .1s}
.kbth-ansi-swatch:hover{transform:scale(1.15)}
/* ── Aperçu terminal ─────────────────────────────────────────────────── */
.kbth-term-preview{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;overflow:hidden;margin-top:12px;font-family:ui-monospace,Menlo,monospace;font-size:12px}
.kbth-term-bar{padding:6px 12px;border-bottom:1px solid var(--dsw-alias-border-l2);font-size:11px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-2)}
.kbth-term-body{padding:12px;background:#0f1115;color:#e5e5e5;line-height:1.7;display:flex;flex-direction:column;gap:2px}
.kbth-term-cursor{animation:kbth-blink 1s step-end infinite}
@keyframes kbth-blink{0%,100%{opacity:1}50%{opacity:0}}
/* ── Export preview ──────────────────────────────────────────────────── */
.kbth-export-preview{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;overflow:hidden;margin-top:8px}
.kbth-export-bar{display:flex;justify-content:space-between;padding:6px 12px;border-bottom:1px solid var(--dsw-alias-border-l2);font-size:11px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-2)}
.kbth-export-code{margin:0;padding:12px 14px;font-family:ui-monospace,Menlo,monospace;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);white-space:pre;overflow-x:auto}
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

      function Page(props) {
        const ctxRef = props.ctx
        const themeSvc = (ctxRef && ctxRef.theme) ? ctxRef.theme : null
        const [S, setS] = React.useState(readState())
        const [hexDraft, setHexDraft] = React.useState(null)
        const [wpCat, setWpCat] = React.useState('gradients')
        const [tokSel, setTokSel] = React.useState('l1')
        const [revision, setRevision] = React.useState(0)
        const [advTab, setAdvTab] = React.useState('couleurs') // sous-onglet Avancé

        // ── Sélecteur de police ────────────────────────────────────────────
        // L'état vit ici, avec les autres contrôles : le rendu hors navigateur
        // n'exécute que Page, et un composant imbriqué ne serait jamais appelé.
        const [fontOuvert, setFontOuvert] = React.useState(false)
        const [fontQ, setFontQ] = React.useState('')
        const [fontActif, setFontActif] = React.useState(0)
        const boitePolice = React.useRef(null)
        const champPolice = React.useRef(null)
        React.useEffect(() => { if (fontOuvert && champPolice.current !== null) champPolice.current.focus() }, [fontOuvert])
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
                    stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round'
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

        const commit = (patch) => {
          setS((cur) => {
            const next = { ...cur, ...patch }
            writeState(next)
            if (themeSvc !== null) appliquerTout(themeSvc, next)
            return next
          })
        }

        const wpo = WPS.find((w) => w.id === S.wp) || WPS[0]
        const lvl = S.contrastMode === 'max' ? 2 : (S.contrastMode === 'plus' ? 1 : 0)
        const o = { acc: S.acc, ov: S.ov, lvl, cb: S.cbSafe, tint: wpo.id !== 'none' ? S.tint : 0, dom: wpo.dom }
        const dark = S.mode !== 'light'
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
          (skinAccent(sk) === null ? ' · accent neutre' : ' · ' + skinAccent(sk))

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
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 7 } },
            h('span', { className: 'kbth-lb' }, 'Thème'),
            h('div', { className: 'kbth-skins' },
              SKINS.map((sk) => h('button', {
                key: sk.id, type: 'button', className: 'kbth-skin',
                'aria-pressed': S.skin === sk.id ? 'true' : 'false',
                title: sk.name + ' — ' + skinMeta(sk),
                'aria-label': sk.name + ' — ' + skinMeta(sk),
                onClick: () => commit(skinPatch(sk)),
              },
                h('span', { className: 'kbth-skin-dot', style: { background: skinDot(sk) } }),
                h('span', { className: 'kbth-skin-name' }, sk.name)))),
            h('div', { className: 'kbth-hint kbth-skin-current' },
              'Thème : ' + (SKINS.find((x) => x.id === S.skin) || { name: 'Personnalisé' }).name +
              (SKINS.find((x) => x.id === S.skin) === undefined ? '' : ' — ' + skinMeta(SKINS.find((x) => x.id === S.skin))) +
              '. « Défaut DSH » retire la couche de jetons : l’apparence native repasse telle quelle.')))

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
                  onInput: (e) => { setHexDraft(null); commit({ acc: e.target.value, skin: 'custom' }) } })),
              h('label', { className: 'kbth-hex' + (hexDraft !== null && !validHex(hexDraft) ? ' bad' : '') },
                h('span', null, '#'),
                h('input', { value: hexShown, maxLength: 7, spellCheck: false, 'aria-label': 'Code hexadécimal',
                  onInput: (e) => {
                    const v = e.target.value
                    setHexDraft(v)
                    const p = HEX(v)
                    if (p !== null) commit({ acc: toHex(p), skin: 'custom' })
                  } })),
              S.acc !== null ? h('button', { className: 'kbth-btn', type: 'button',
                onClick: () => { setHexDraft(null); commit({ acc: null }) } }, 'Rétablir') : null)),
          h('div', { className: 'kbth-dots' },
            ACCS.map((a) => h('button', {
              key: a, type: 'button', className: 'kbth-dot', style: { background: a },
              'aria-pressed': S.acc !== null && S.acc.toLowerCase() === a.toLowerCase() ? 'true' : 'false',
              title: a, 'aria-label': 'Accent ' + a,
              onClick: () => { setHexDraft(null); commit({ acc: a, skin: 'custom' }) } }))))
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
        const fonds = WPS.filter((w) => w.cat === wpCat)
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
              onClick: () => commit({ wp: w.id, skin: 'custom' }) },
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
          { id: 'conversation', label: 'Conversation' },
          { id: 'terminal', label: 'Terminal' },
          { id: 'accessibilite', label: 'Accessibilité' },
          { id: 'partage', label: 'Partage' }
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
            h('div', { className: 'kbth-sec-d' }, 'Les réglages de base, identiques au mode Simple.')),
          apparence, couleur, ratiosAccent, fond, police)

        // ── Onglet Verre et fond ───────────────────────────────────────────
        const advVerre = h('div', { className: 'kbth-sec' },
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, 'Verre'),
            h('div', { className: 'kbth-sec-d' }, 'Transparence et flou des surfaces posées sur le fond.')),
          h('div', { className: 'kbth-row' },
            h('span', { className: 'kbth-lb' }, 'Effet'),
            seg({ items: [
              { id: 'frosted', label: 'Verre dépoli', on: (S.glassEffect || 'frosted') === 'frosted', tap: () => commit({ glassEffect: 'frosted' }) },
              { id: 'liquid', label: 'Liquid glass', on: S.glassEffect === 'liquid', tap: () => commit({ glassEffect: 'liquid' }) }] })),
          slider({ label: 'Flou du verre', min: 0, max: 40, value: S.glassBlur || 18, text: (S.glassBlur || 18) + ' px', tap: (v) => commit({ glassBlur: v }) }),
          toggle('Lier la barre latérale au fond', S.sidebarLinked !== false, () => commit({ sidebarLinked: S.sidebarLinked === false })),
          slider({ label: 'Transparence de la barre latérale', min: 0, max: 100, value: S.sidebarOpacity != null ? S.sidebarOpacity : 25, text: (S.sidebarOpacity != null ? S.sidebarOpacity : 25) + ' %', tap: (v) => commit({ sidebarOpacity: v }) }),
          slider({ label: 'Transparence des champs', min: 0, max: 100, value: S.fieldOpacity != null ? S.fieldOpacity : 20, text: (S.fieldOpacity != null ? S.fieldOpacity : 20) + ' %', tap: (v) => commit({ fieldOpacity: v }) }),
          slider({ label: 'Transparence des fenêtres flottantes', min: 0, max: 100, value: S.floatOpacity != null ? S.floatOpacity : 10, text: (S.floatOpacity != null ? S.floatOpacity : 10) + ' %', tap: (v) => commit({ floatOpacity: v }) }),
          h('div', { style: { height: 16 } }),
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, 'Image de fond'),
            h('div', { className: 'kbth-sec-d' }, 'Réglages fins du fond choisi.')),
          slider({ label: 'Visibilité du fond', min: 0, max: 100, value: S.wpVis, text: S.wpVis + ' %', tap: (v) => commit({ wpVis: v }) }),
          slider({ label: 'Flou de l’image', min: 0, max: 40, value: S.wpBlur, text: S.wpBlur + ' px', tap: (v) => commit({ wpBlur: v }) }),
          slider({ label: 'Luminosité', min: 0, max: 200, value: S.bgBrightness != null ? S.bgBrightness : 100, text: (S.bgBrightness != null ? S.bgBrightness : 100) + ' %', tap: (v) => commit({ bgBrightness: v }) }),
          slider({ label: 'Contraste', min: 0, max: 200, value: S.bgContrast != null ? S.bgContrast : 100, text: (S.bgContrast != null ? S.bgContrast : 100) + ' %', tap: (v) => commit({ bgContrast: v }) }),
          slider({ label: 'Saturation', min: 0, max: 200, value: S.bgSaturation != null ? S.bgSaturation : 100, text: (S.bgSaturation != null ? S.bgSaturation : 100) + ' %', tap: (v) => commit({ bgSaturation: v }) }),
          slider({ label: 'Assombrissement', min: 0, max: 100, value: S.bgDarken || 0, text: (S.bgDarken || 0) + ' %', tap: (v) => commit({ bgDarken: v }) }),
          h('div', { className: 'kbth-row' },
            h('span', { className: 'kbth-lb' }, 'Ajustement'),
            seg({ items: [
              { id: 'cover', label: 'Couvrir', on: (S.bgFit || 'cover') === 'cover', tap: () => commit({ bgFit: 'cover' }) },
              { id: 'fill', label: 'Remplir', on: S.bgFit === 'fill', tap: () => commit({ bgFit: 'fill' }) },
              { id: 'center', label: 'Centrer', on: S.bgFit === 'center', tap: () => commit({ bgFit: 'center' }) },
              { id: 'stretch', label: 'Étirer', on: S.bgFit === 'stretch', tap: () => commit({ bgFit: 'stretch' }) }] })),
          toggle('Miroir horizontal', S.bgMirror === true, () => commit({ bgMirror: !S.bgMirror })),
          toggle('Atténuation automatique', S.bgAutoDim === true, () => commit({ bgAutoDim: !S.bgAutoDim })),
          toggle('Pause sur batterie', S.bgPauseBattery === true, () => commit({ bgPauseBattery: !S.bgPauseBattery })))

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
                  onInput: (e) => { setHexDraft(null); commit({ acc: e.target.value, skin: 'custom' }) } })),
              h('div', { className: 'kbth-dots' },
                ACCS.map((a) => h('button', {
                  key: a, type: 'button', className: 'kbth-dot', style: { background: a },
                  'aria-pressed': S.acc !== null && S.acc.toLowerCase() === a.toLowerCase() ? 'true' : 'false',
                  title: a, 'aria-label': 'Accent ' + a,
                  onClick: () => { setHexDraft(null); commit({ acc: a, skin: 'custom' }) } }))))),
          h('div', { className: 'kbth-row' },
            h('span', { className: 'kbth-lb' }, 'Valeur exacte'),
            h('div', { className: 'kbth-acc' },
              h('label', { className: 'kbth-hex' + (hexDraft !== null && !validHex(hexDraft) ? ' bad' : '') },
                h('span', null, '#'),
                h('input', { value: hexShown, maxLength: 7, spellCheck: false, 'aria-label': 'Code hexadécimal',
                  onInput: (e) => { const v = e.target.value; setHexDraft(v); const p = HEX(v); if (p !== null) commit({ acc: toHex(p), skin: 'custom' }) } })),
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
                ? ratio(cl[key], cl.l1) : null
              const badge = r !== null ? (r >= 7 ? 'AAA' : r >= 4.5 ? 'AA' : r >= 3 ? 'Grand texte' : 'Échec') : null
              const badgeColor = r !== null ? (r >= 4.5 ? 'var(--dsw-alias-state-success-primary)' : r >= 3 ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-state-error-primary)') : null
              return h('button', {
                key: key, type: 'button', className: 'kbth-tok' + (tokSel === key ? ' kbth-tok-sel' : ''),
                'aria-pressed': tokSel === key ? 'true' : 'false',
                onClick: () => { setTokSel(key); setHexDraft(null) } },
                h('span', { className: 'kbth-tok-chip', style: { background: dark ? cd[key] : cl[key] } }),
                h('span', { className: 'kbth-tok-name' }, e[1]),
                h('span', { className: 'kbth-tok-css' }, '--dsw-' + e[2]),
                h('span', { className: 'kbth-tok-hex' }, (dark ? cd[key] : cl[key]).toUpperCase()),
                r !== null ? h('span', { className: 'kbth-tok-ratio' }, r.toFixed(1) + ':1') : null,
                badge ? h('span', { className: 'kbth-tok-badge', style: { color: badgeColor, borderColor: badgeColor } }, badge) : null)
            })),
          // Éditeur du jeton sélectionné
          h('div', { className: 'kbth-adv-editor' },
            h('div', { className: 'kbth-adv-preview' },
              h('span', { className: 'kbth-adv-chip', style: { background: dark ? cd[sel[0]] : cl[sel[0]] } }),
              h('div', { className: 'kbth-adv-info' },
                h('span', { className: 'kbth-adv-label' }, sel[1]),
                h('span', { className: 'kbth-adv-css' }, '--dsw-' + sel[2]))),
            ratioSel ? h('div', { className: 'kbth-adv-ratio',
              style: { color: ratio(cl[sel[0]], cl.l1) >= 4.5 ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-warn-primary)' } },
              ratio(cl[sel[0]], cl.l1).toFixed(1) + ':1 · ' + (ratio(cl[sel[0]], cl.l1) >= 7 ? 'AAA' : ratio(cl[sel[0]], cl.l1) >= 4.5 ? 'AA' : 'Échec')) : null,
            h('div', { className: 'kbth-adv-colors' },
              ['light', 'dark'].map((m) => h('div', { key: m, className: 'kbth-adv-swatch' },
                h('label', { className: 'kbth-sw', style: { background: m === 'light' ? selClair : selSombre, width: 28, height: 28 },
                  title: (m === 'light' ? 'Clair' : 'Sombre') + ' — pipette' },
                  h('input', { type: 'color', value: m === 'light' ? selClair : selSombre,
                    'aria-label': sel[1] + ' (' + (m === 'light' ? 'clair' : 'sombre') + ')',
                    onInput: (e) => commit({ ov: { ...S.ov, [m + ':' + sel[0]]: e.target.value }, skin: 'custom' }) })),
                h('span', { className: 'kbth-adv-swatch-label' }, m === 'light' ? 'Clair' : 'Sombre')))),
            modifie ? h('button', { className: 'kbth-btn', type: 'button', style: { width: 'max-content' },
              onClick: () => { const ov = { ...S.ov }; delete ov['light:' + sel[0]]; delete ov['dark:' + sel[0]]; commit({ ov }) } }, 'Rétablir') : null))

        // ── Onglet Texte et forme ──────────────────────────────────────────
        const advTexte = h('div', { className: 'kbth-sec' },
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, 'Texte'),
            h('div', { className: 'kbth-sec-d' }, 'La police se choisit dans Essentiel.')),
          slider({ label: 'Taille du texte', min: 12, max: 17, value: S.fs, text: S.fs + ' px', tap: (v) => commit({ fs: v }) }),
          slider({ label: 'Interligne', min: 120, max: 200, value: S.lineHeight || 155, text: ((S.lineHeight || 155) / 100).toFixed(2), tap: (v) => commit({ lineHeight: v }) }),
          toggle('Ligatures', S.ligatures !== false, () => commit({ ligatures: S.ligatures === false })),
          h('div', { style: { height: 16 } }),
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, 'Forme'),
            h('div', { className: 'kbth-sec-d' }, 'Rayons et espacements.')),
          h('div', { className: 'kbth-row' },
            h('span', { className: 'kbth-lb' }, 'Rayons'),
            seg({ items: [
              { id: 'sharp', label: 'Net', on: (S.radius || 'standard') === 'sharp', tap: () => commit({ radius: 'sharp' }) },
              { id: 'standard', label: 'Standard', on: (S.radius || 'standard') === 'standard', tap: () => commit({ radius: 'standard' }) },
              { id: 'soft', label: 'Doux', on: S.radius === 'soft', tap: () => commit({ radius: 'soft' }) }] })),
          h('div', { className: 'kbth-row' },
            h('span', { className: 'kbth-lb' }, 'Densité'),
            seg({ items: [
              { id: 'compact', label: 'Compacte', on: (S.density || 'comfortable') === 'compact', tap: () => commit({ density: 'compact' }) },
              { id: 'comfortable', label: 'Confortable', on: (S.density || 'comfortable') === 'comfortable', tap: () => commit({ density: 'comfortable' }) },
              { id: 'spacious', label: 'Aérée', on: S.density === 'spacious', tap: () => commit({ density: 'spacious' }) }] })),
          h('div', { style: { height: 16 } }),
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, 'Identité'),
            h('div', { className: 'kbth-sec-d' }, 'Ce qui rappelle le harness.')),
          toggle('Logo et nom', S.showBrand !== false, () => commit({ showBrand: S.showBrand === false })),
          toggle('Favicon', S.showFavicon !== false, () => commit({ showFavicon: S.showFavicon === false })),
          h('div', { style: { height: 16 } }),
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, 'Mode automatique'),
            h('div', { className: 'kbth-sec-d' }, 'Bascule clair et sombre sans y penser.')),
          toggle('Bascule selon l’heure', S.autoSchedule === true, () => commit({ autoSchedule: !S.autoSchedule })),
          toggle('Raccourci de bascule', S.toggleShortcut !== false, () => commit({ toggleShortcut: S.toggleShortcut === false })))

        // ── Onglet Conversation (placeholder) ──────────────────────────────
        const advConversation = h('div', { className: 'kbth-sec' },
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, 'Conversation'),
            h('div', { className: 'kbth-sec-d' }, 'Affichage des messages et du compositeur.')),
          h('div', { className: 'kbth-note' }, 'Les réglages de conversation seront disponibles prochainement : densité des messages, style des bulles, affichage du raisonnement, position du compositeur.'))

        // ── Onglet Terminal ────────────────────────────────────────────────
        const advTerminal = h('div', { className: 'kbth-sec' },
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, 'Couleurs du terminal'),
            h('div', { className: 'kbth-sec-d' }, 'Comment le thème s’adapte à votre terminal.')),
          h('div', { className: 'kbth-row' },
            h('span', { className: 'kbth-lb' }, 'Profondeur'),
            seg({ items: [
              { id: 'auto', label: 'Auto', on: (S.termDepth || 'auto') === 'auto', tap: () => commit({ termDepth: 'auto' }) },
              { id: '24bit', label: '24 bits', on: S.termDepth === '24bit', tap: () => commit({ termDepth: '24bit' }) },
              { id: '256', label: '256', on: S.termDepth === '256', tap: () => commit({ termDepth: '256' }) },
              { id: '16', label: '16', on: S.termDepth === '16', tap: () => commit({ termDepth: '16' }) }] })),
          h('div', { className: 'kbth-hint' }, 'Détecté via COLORTERM : 24 bits si disponible, sinon 256 puis 16.'),
          toggle('Respecter NO_COLOR', S.termNoColor !== false, () => commit({ termNoColor: S.termNoColor === false })),
          toggle('Gras en couleur vive', S.termBoldBright === true, () => commit({ termBoldBright: !S.termBoldBright })),
          h('div', { style: { height: 16 } }),
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, 'Curseur et cadre'),
            h('div', { className: 'kbth-sec-d' }, 'Zone de saisie et bordure de session.')),
          h('div', { className: 'kbth-row' },
            h('span', { className: 'kbth-lb' }, 'Curseur'),
            seg({ items: [
              { id: 'block', label: 'Bloc', on: (S.termCursor || 'block') === 'block', tap: () => commit({ termCursor: 'block' }) },
              { id: 'bar', label: 'Barre', on: S.termCursor === 'bar', tap: () => commit({ termCursor: 'bar' }) },
              { id: 'underline', label: 'Souligné', on: S.termCursor === 'underline', tap: () => commit({ termCursor: 'underline' }) }] })),
          toggle('Clignotement', S.termBlink !== false, () => commit({ termBlink: S.termBlink === false })),
          h('div', { className: 'kbth-row' },
            h('span', { className: 'kbth-lb' }, 'Bordures'),
            seg({ items: [
              { id: 'rounded', label: 'Arrondies', on: (S.termBorder || 'rounded') === 'rounded', tap: () => commit({ termBorder: 'rounded' }) },
              { id: 'square', label: 'Carrées', on: S.termBorder === 'square', tap: () => commit({ termBorder: 'square' }) },
              { id: 'double', label: 'Doubles', on: S.termBorder === 'double', tap: () => commit({ termBorder: 'double' }) },
              { id: 'none', label: 'Aucune', on: S.termBorder === 'none', tap: () => commit({ termBorder: 'none' }) }] })),
          toggle('Glyphes Unicode', S.termUnicode !== false, () => commit({ termUnicode: S.termUnicode === false })),
          h('div', { style: { height: 16 } }),
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, 'Palette ANSI'),
            h('div', { className: 'kbth-sec-d' }, 'Les 16 couleurs. Le bleu suit votre accent.')),
          h('div', { className: 'kbth-ansi-grid' },
            ['#000000', '#ef4444', '#22c55e', '#f59e0b', S.acc || '#4176E6', '#a855f7', '#2dd4bf', '#d4d4d4',
             '#7f8287', '#f25a5a', '#4ed17e', '#f7ad31', S.acc || '#679EFE', '#c084fc', '#5eead4', '#ffffff'].map((c, i) =>
              h('div', { key: i, className: 'kbth-ansi-swatch', style: { background: c }, title: c }))),
          // Aperçu terminal
          h('div', { className: 'kbth-term-preview' },
            h('div', { className: 'kbth-term-bar' }, 'dsh · session 0142'),
            h('div', { className: 'kbth-term-body' },
              h('div', null, h('span', { style: { color: '#22c55e' } }, '❯ '), 'applique le thème sombre'),
              h('div', null, h('span', { style: { color: '#a855f7' } }, '◆ '), 'réflexion · 4 étapes'),
              h('div', null, h('span', { style: { color: '#22c55e' } }, '✓ '), h('b', null, 'read_file'), ' ', h('span', { style: { color: S.acc || '#4176E6' } }, 'theme.json')),
              h('div', null, h('span', { style: { color: '#ef4444' } }, '✗ '), 'contraste 3.1:1 sous le seuil AA'),
              h('div', null, h('span', { style: { color: '#f59e0b' } }, '▲ '), h('span', { style: { textDecoration: 'line-through' } }, '--dsw-alias-label-tertiary')),
              h('div', null, h('span', { style: { color: '#ef4444' } }, '− '), 'label-tertiary: #81858C'),
              h('div', null, h('span', { style: { color: '#22c55e' } }, '+ '), 'label-tertiary: #61666B'),
              h('div', null, h('span', { style: { color: '#22c55e' } }, '❯ '), h('span', { className: 'kbth-term-cursor' }, '█')))))

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
              const r = ratio(cl[key], cl.l1)
              const badge = r >= 7 ? 'AAA' : r >= 4.5 ? 'AA' : r >= 3 ? 'Grand texte' : 'Échec'
              const badgeColor = r >= 4.5 ? 'var(--dsw-alias-state-success-primary)' : r >= 3 ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-state-error-primary)'
              return h('div', { key: key, className: 'kbth-a11y-row' },
                h('span', { className: 'kbth-a11y-aa', style: { background: dark ? cd[key] : cl[key], color: dark ? cd.l1 : cl.l1 } }, 'Aa'),
                h('span', { className: 'kbth-a11y-label' }, label),
                h('span', { className: 'kbth-a11y-hex' }, (dark ? cd[key] : cl[key]).toUpperCase()),
                h('span', { className: 'kbth-a11y-ratio' }, r.toFixed(1) + ':1'),
                h('span', { className: 'kbth-a11y-badge', style: { color: badgeColor, borderColor: badgeColor } }, badge))
            })),
          h('div', { style: { height: 16 } }),
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, 'Mouvement et focus'),
            h('div', { className: 'kbth-sec-d' }, 'Animations et navigation au clavier.')),
          h('div', { className: 'kbth-row' },
            h('span', { className: 'kbth-lb' }, 'Animations'),
            seg({ items: [
              { id: 'system', label: 'Système', on: (S.animations || 'system') === 'system', tap: () => commit({ animations: 'system' }) },
              { id: 'full', label: 'Complètes', on: S.animations === 'full', tap: () => commit({ animations: 'full' }) },
              { id: 'reduced', label: 'Réduites', on: S.animations === 'reduced', tap: () => commit({ animations: 'reduced' }) }] })),
          h('div', { className: 'kbth-row' },
            h('span', { className: 'kbth-lb' }, 'Anneau de focus'),
            seg({ items: [
              { id: 'accent', label: 'Accent', on: (S.focusRing || 'accent') === 'accent', tap: () => commit({ focusRing: 'accent' }) },
              { id: 'double', label: 'Double', on: S.focusRing === 'double', tap: () => commit({ focusRing: 'double' }) },
              { id: 'thick', label: 'Épais', on: S.focusRing === 'thick', tap: () => commit({ focusRing: 'thick' }) }] })),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 } },
            h('button', { className: 'kbth-btn', type: 'button', style: { outline: '2px solid var(--dsw-alias-brand-primary)', outlineOffset: '2px' } }, 'Élément actif'),
            h('span', { className: 'kbth-hint' }, 'Aperçu de l’anneau de focus.')),
          h('div', { style: { height: 16 } }),
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, 'Lisibilité'),
            h('div', { className: 'kbth-sec-d' }, 'Tailles et repères supplémentaires.')),
          slider({ label: 'Taille de l’interface', min: 75, max: 150, value: S.uiScale || 100, text: (S.uiScale || 100) + ' %', tap: (v) => commit({ uiScale: v }) }),
          toggle('Cibles de 44 px', S.largeTargets === true, () => commit({ largeTargets: !S.largeTargets })),
          toggle('Soulignement des liens', S.underlineLinks === true, () => commit({ underlineLinks: !S.underlineLinks })),
          toggle('Icônes sur les statuts', S.statusIcons !== false, () => commit({ statusIcons: S.statusIcons === false })),
          toggle('Palette daltonisme', S.colorblindPalette === true, () => commit({ colorblindPalette: !S.colorblindPalette })))

        // ── Onglet Partage ─────────────────────────────────────────────────
        const advPartage = h('div', { className: 'kbth-sec' },
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, 'Portée'),
            h('div', { className: 'kbth-sec-d' }, 'Où le thème s’applique.')),
          toggle('Web (profil par défaut)', S.scopeWeb !== false, () => commit({ scopeWeb: S.scopeWeb === false })),
          toggle('Terminal (TUI)', S.scopeTui === true, () => commit({ scopeTui: !S.scopeTui })),
          toggle('Headless', S.scopeHeadless === true, () => commit({ scopeHeadless: !S.scopeHeadless })),
          h('div', { className: 'kbth-row' },
            h('span', { className: 'kbth-lb' }, 'Enregistrer dans'),
            seg({ items: [
              { id: 'user', label: 'Utilisateur', on: (S.saveScope || 'user') === 'user', tap: () => commit({ saveScope: 'user' }) },
              { id: 'workspace', label: 'Espace de travail', on: S.saveScope === 'workspace', tap: () => commit({ saveScope: 'workspace' }) }] })),
          h('div', { style: { height: 16 } }),
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, 'Exporter'),
            h('div', { className: 'kbth-sec-d' }, 'Un fichier à partager ou à versionner.')),
          h('div', { className: 'kbth-row' },
            h('span', { className: 'kbth-lb' }, 'Format'),
            seg({ items: [
              { id: 'json', label: 'JSON', on: (S.exportFormat || 'yaml') === 'json', tap: () => commit({ exportFormat: 'json' }) },
              { id: 'yaml', label: 'YAML', on: (S.exportFormat || 'yaml') === 'yaml', tap: () => commit({ exportFormat: 'yaml' }) },
              { id: 'css', label: 'CSS', on: S.exportFormat === 'css', tap: () => commit({ exportFormat: 'css' }) }] }),
            h('button', { className: 'kbth-btn', type: 'button', onClick: () => {
              const data = JSON.stringify(S, null, 2)
              try { navigator.clipboard.writeText(data) } catch (e) { /* clipboard indisponible */ }
            } }, 'Copier')),
          h('div', { className: 'kbth-export-preview' },
            h('div', { className: 'kbth-export-bar' },
              h('span', null, 'dsh-theme.' + (S.exportFormat || 'yaml')),
              h('span', null, '41 lignes')),
            h('pre', { className: 'kbth-export-code' },
              'theme:\n  appearance: ' + S.mode + '\n  schedule: ' + (S.autoSchedule ? 'auto' : 'null') + '\n  skin: ' + S.skin + '\n  accent: ' + (S.acc || 'dsh-default') + '\n  background:\n    id: ' + S.wp + '\n    visibility: ' + S.wpVis + '\n    blur: ' + S.wpBlur + '\n    glass: ' + (S.glassEffect || 'frosted') + '\n    fit: ' + (S.bgFit || 'cover') + '\n  font:\n    text: ' + S.fontText + '\n    code: dshmono\n    size: ' + S.fs)),
          h('div', { style: { height: 16 } }),
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, 'Importer'),
            h('div', { className: 'kbth-sec-d' }, 'Un fichier de thème ou un pack.')),
          h('div', { className: 'kbth-row' },
            h('span', { className: 'kbth-lb' }, 'Fichier'),
            h('label', { className: 'kbth-btn', style: { cursor: 'pointer' } }, 'Déposer un fichier .json, .yml ou .css',
              h('input', { type: 'file', accept: '.json,.yml,.yaml,.css', style: { display: 'none' }, onChange: (e) => {
                const file = e.target.files && e.target.files[0]
                if (!file) return
                const reader = new FileReader()
                reader.onload = () => {
                  try {
                    const imported = JSON.parse(reader.result)
                    commit(imported)
                  } catch (err) { /* format invalide */ }
                }
                reader.readAsText(file)
              } }))),
          h('div', { className: 'kbth-hint' }, 'Ou installer un pack depuis le registre de plugins :'),
          h('div', { className: 'kbth-export-preview' },
            h('pre', { className: 'kbth-export-code', style: { padding: '10px 14px' } }, 'dsh plugin --profile web add <nom-du-pack>')),
          h('div', { style: { height: 16 } }),
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sec-t' }, 'Réinitialiser'),
            h('div', { className: 'kbth-sec-d' }, 'Revenir aux valeurs par défaut du harness.')),
          h('div', { className: 'kbth-row' },
            h('span', { className: 'kbth-lb' }, 'Tous les réglages de thème'),
            h('button', { className: 'kbth-btn', type: 'button', onClick: () => { setHexDraft(null); commit({ ...DEF }) } }, 'Réinitialiser')))

        // ── Assemblage Avancé avec sous-onglets ────────────────────────────
        const ADV_CONTENT = {
          essentiel: advEssentiel,
          verre: advVerre,
          couleurs: advCouleurs,
          texte: advTexte,
          conversation: advConversation,
          terminal: advTerminal,
          accessibilite: advAccessibilite,
          partage: advPartage
        }
        const avances = h('div', { className: 'kbth-sec' },
          h('div', { className: 'kbth-sec-h' },
            h('div', { className: 'kbth-sub' }, 'Personnalisez l’apparence de DeepSeek Harness. Tous les réglages, rangés par onglet.')),
          // Onglets empilés VERTICALEMENT à gauche, contenu à droite.
          h('div', { className: 'kbth-adv-cols' },
            h('div', { className: 'kbth-adv-tabs' },
              ADV_TABS.map((t) => h('button', {
                key: t.id, type: 'button', className: 'kbth-adv-tab' + (advTab === t.id ? ' on' : ''),
                'aria-pressed': advTab === t.id ? 'true' : 'false',
                onClick: () => setAdvTab(t.id) }, t.label))),
            h('div', { className: 'kbth-adv-pane' },
              ADV_CONTENT[advTab] || advCouleurs)))

        // ── assemblage — une seule colonne (l'aperçu latéral a été retiré) ────────
        return h(React.Fragment, null,
          h('div', { className: 'kbth-page' },
            // Colonne principale
            h('div', { className: 'kbth-main' },
              h('div', { className: 'kbth-head' },
                h('div', { className: 'kbth-title' }, 'Thème'),
                h('div', { className: 'kbth-sub' },
                  'Personnalisez l’apparence de DeepSeek Harness. Essentiel : apparence, accent, fond et police.'),
                seg({ items: [
                  { id: 'simple', label: 'Simple', on: S.level === 'simple', tap: () => commit({ level: 'simple' }) },
                  { id: 'advanced', label: 'Avancé', on: S.level === 'advanced', tap: () => commit({ level: 'advanced' }) }] }),
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
                  ' (Account).'),
                S.level === 'simple'
                  ? h('div', { className: 'kbth-hint' },
                    'Besoin de plus de réglages ? Le mode Avancé ajoute les variables de couleur, variable par variable.')
                    : null),
              S.level === 'simple'
                ? h('div', null, apparence, h('div', { style: { height: 4 } }), couleur, h('div', { style: { height: 4 } }), fond, h('div', { style: { height: 4 } }), police)
                : h('div', null, avances),
              h('div', { className: 'kbth-foot' },
                h('span', { className: 'kbth-pill' }, estNaturel(S) ? 'DSH natif — aucune couche posée' : '17 jetons · {light, dark}'),
                h('span', { className: 'kbth-pill' }, (Object.keys(S.ov).length / 2) + ' jeton(s) retouché(s)'),
                h('button', { className: 'kbth-btn', type: 'button',
                  onClick: () => { setHexDraft(null); commit({ ...DEF }) } }, 'Tout rétablir'),
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
        inject: ['slots', 'theme', 'remote'],
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
              if (nat !== null && nat !== 'system' && nat !== S.mode) writeState({ ...S, mode: nat })
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
                    if (p === null || p === 'system') return
                    const cur = readState()
                    if (cur.mode !== p) writeState({ ...cur, mode: p })
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
