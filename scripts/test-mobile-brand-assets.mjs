// The phone app's icon and splash are the real Kybernos K, drawn from the web client's brand block (mobile/app/scripts/brand-art.mjs), never a stand-in.
// What is proven: the shapes come out of kbBrandArt (a stem, an arm, a leg, three dots, brand red and white); the icon is opaque, the K centred, on the
// app's own background; the Android layers keep the K inside the middle 66 % any launcher mask leaves; the one-colour layer has its dots cut out; the
// splash is the K alone on a transparent canvas; edges are smoothed; app.json names the same background for the splash plugin; make-assets writes five
// real PNG files. Usage: node scripts/test-mobile-brand-assets.mjs   (exit 0 = everything passes)
import { mkdtempSync, readFileSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const app = join(root, 'mobile', 'app')
const { ASSETS, APP_BACKGROUND, loadBrand, renderAsset } = await import(join(app, 'scripts', 'brand-art.mjs'))

let fails = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) { fails++; console.log('FAIL', label, '| got', JSON.stringify(got), '| want', JSON.stringify(want)) } else console.log('ok  ', label)
}
const yes = (label, cond) => eq(label, Boolean(cond), true)

const N = 256
const brand = await loadBrand()
const px = (buf, x, y) => [...buf.subarray((y * N + x) * 4, (y * N + x) * 4 + 4)]
const near = (a, b, tol = 3) => a.every((v, i) => Math.abs(v - b[i]) <= tol)
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
// where the K's parts sit on the canvas for a K `height` px tall (K units -> pixels)
const place = (height) => { const s = height / brand.height; return { s, ox: (N - brand.width * s) / 2, oy: (N - brand.height * s) / 2, at: (u, v) => [Math.round(((N - brand.width * s) / 2) + u * s), Math.round(((N - brand.height * s) / 2) + v * s)] } }
const bbox = (buf, test) => { let x0 = N, y0 = N, x1 = -1, y1 = -1; for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (test(px(buf, x, y))) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) } return { x0, y0, x1, y1 } }

/* 1. the shapes come from the brand block */
const shapes = brand.shapesOf(3.3)
eq('a stem, an arm, a leg, three dots', shapes.map((s) => s.type), ['rect', 'polygon', 'polygon', 'circle', 'circle', 'circle'])
eq('the K is the brand red, the dots white', [...new Set(shapes.map((s) => s.fill.join(',')))].sort(), ['242,55,42,255', '255,255,255,255'])
eq('the red is the one the web client names', brand.red, '#f2372a')
eq('the K box is the web client\'s 32.5 x 36', [brand.width, brand.height], [32.5, 36])
eq('the icon dots are the favicon\'s bigger ones, the splash\'s the logo\'s', [ASSETS['icon.png'].dot, ASSETS['splash-icon.png'].dot], [3.3, 2.8])

/* 1b. the K drawn inside the app (src/BrandMark.tsx, react-native-svg) is the same K */
const mark = readFileSync(join(app, 'src', 'BrandMark.tsx'), 'utf8')
const num = (re) => Number(mark.match(re)?.[1])
const str = (re) => mark.match(re)?.[1]
const logo = brand.shapesOf(2.8)
const [stem, arm, leg, ...dots] = logo
eq('BrandMark: the red is the web client\'s', str(/K_RED = '(#[0-9a-f]{6})'/i), brand.red)
eq('BrandMark: the box is the K\'s own 32.5 x 36', [num(/K_BOX = \{ width: ([\d.]+)/), num(/K_BOX = \{[^}]*height: ([\d.]+)/)], [brand.width, brand.height])
eq('BrandMark: the stem', [num(/K_STEM = \{ x: ([\d.]+)/), num(/K_STEM = \{[^}]*y: ([\d.]+)/), num(/K_STEM = \{[^}]*width: ([\d.]+)/), num(/K_STEM = \{[^}]*height: ([\d.]+)/)], [stem.x, stem.y, stem.w, stem.h])
eq('BrandMark: the arm', str(/K_ARM = '([^']+)'/), arm.pts.map((q) => q.join(',')).join(' '))
eq('BrandMark: the leg', str(/K_LEG = '([^']+)'/), leg.pts.map((q) => q.join(',')).join(' '))
eq('BrandMark: the three dots', [num(/K_DOTS = \{ cx: ([\d.]+)/), str(/K_DOTS = \{[^}]*cy: \[([^\]]+)\]/).split(',').map((v) => Number(v.trim())), num(/K_DOTS = \{[^}]*r: ([\d.]+)/)], [dots[0].cx, dots.map((d) => d.cy), dots[0].r])

/* 2. icon: opaque, centred, on the app background */
const icon = await renderAsset('icon.png', { size: N, brand })
const p = place(ASSETS['icon.png'].height * N)
eq('icon: the corner is the app background', px(icon, 2, 2), [...hex(APP_BACKGROUND), 255])
yes('icon: no transparent pixel (iOS refuses one)', (() => { for (let i = 3; i < icon.length; i += 4) if (icon[i] !== 255) return false; return true })())
yes('icon: the middle of the stem is the brand red', near(px(icon, ...p.at(3, 2)), [242, 55, 42, 255]))
yes('icon: the first dot is white', near(px(icon, ...p.at(6.5, 7.5)), [255, 255, 255, 255]))
yes('icon: the arm is red', near(px(icon, ...p.at(24, 4)), [242, 55, 42, 255]))
const kb = bbox(icon, (c) => c[0] > 150)
yes('icon: the K is centred', Math.abs((kb.x0 + kb.x1) / 2 - N / 2) <= 1.5 && Math.abs((kb.y0 + kb.y1) / 2 - N / 2) <= 1.5)
yes('icon: the K is 55 % of the canvas high', Math.abs((kb.y1 - kb.y0 + 1) / N - 0.55) < 0.01)
yes('icon: edges are smoothed (many in-between colours along the arm)', (() => { const set = new Set(); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) set.add(px(icon, x, y).join(',')); return set.size > 12 })())

/* 3. Android layers */
const bg = await renderAsset('android-icon-background.png', { size: N, brand })
yes('android background: one flat colour, the app background', (() => { for (let i = 0; i < bg.length; i += 4) if (bg[i] !== 0x12 || bg[i + 1] !== 0x12 || bg[i + 2] !== 0x17 || bg[i + 3] !== 255) return false; return true })())
const fg = await renderAsset('android-icon-foreground.png', { size: N, brand })
eq('android foreground: the corner is transparent', px(fg, 2, 2)[3], 0)
const safe = (buf) => { let worst = 0; for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (buf[(y * N + x) * 4 + 3] > 8) worst = Math.max(worst, Math.hypot(x - N / 2, y - N / 2)); return worst / N }
yes('android foreground: every visible pixel is inside the middle 66 % circle', safe(fg) <= 0.33)
const mono = await renderAsset('android-icon-monochrome.png', { size: N, brand })
const pm = place(ASSETS['android-icon-monochrome.png'].height * N)
yes('android one-colour: the stem is solid black', near(px(mono, ...pm.at(3, 2)), [0, 0, 0, 255]))
yes('android one-colour: the dots are cut out', px(mono, ...pm.at(6.5, 18))[3] <= 8)
yes('android one-colour: nothing but black and transparent', (() => { for (let i = 0; i < mono.length; i += 4) if (mono[i + 3] > 0 && (mono[i] > 2 || mono[i + 1] > 2 || mono[i + 2] > 2)) return false; return true })())
yes('android one-colour: inside the safe circle', safe(mono) <= 0.33)

/* 4. splash */
const splash = await renderAsset('splash-icon.png', { size: N, brand })
const ps = place(ASSETS['splash-icon.png'].height * N)
eq('splash: the corner is transparent', px(splash, 2, 2)[3], 0)
yes('splash: the stem is the brand red', near(px(splash, ...ps.at(3, 2)), [242, 55, 42, 255]))
yes('splash: the dots are white', near(px(splash, ...ps.at(6.5, 28.5)), [255, 255, 255, 255]))
const sb = bbox(splash, (c) => c[3] > 200)
yes('splash: the K is centred', Math.abs((sb.x0 + sb.x1) / 2 - N / 2) <= 1.5 && Math.abs((sb.y0 + sb.y1) / 2 - N / 2) <= 1.5)
yes('splash: a transparent edge keeps the K\'s own colour (no dark fringe)', (() => { for (let i = 0; i < splash.length; i += 4) { const a = splash[i + 3]; if (a > 40 && a < 215 && splash[i] < 200) return false } return true })())

/* 5. the app config names the same background, and the files exist */
const cfg = JSON.parse(readFileSync(join(app, 'app.json'), 'utf8')).expo
const entry = cfg.plugins.find((x) => Array.isArray(x) && x[0] === 'expo-splash-screen')
yes('app.json: the splash plugin is configured', entry !== undefined)
eq('app.json: the splash background is the app background', entry?.[1]?.backgroundColor, APP_BACKGROUND)
eq('app.json: the splash picture is the one make-assets draws', entry?.[1]?.image, './assets/splash-icon.png')
eq('app.json: the app icon is the one make-assets draws', cfg.icon, './assets/icon.png')
// without it iOS hands an English-only app the locale « en_FR » on a French phone, and the native screens (src/i18n.ts) never show French
eq('app.json: iOS is told the app speaks English and French', cfg.ios.infoPlist.CFBundleLocalizations, ['en', 'fr'])
eq('app.json: the adaptive layers are the ones make-assets draws', [cfg.android.adaptiveIcon.backgroundImage, cfg.android.adaptiveIcon.foregroundImage, cfg.android.adaptiveIcon.monochromeImage].map((f) => f.replace('./assets/', '')), ['android-icon-background.png', 'android-icon-foreground.png', 'android-icon-monochrome.png'])
const pkg = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'))
yes('package.json: expo-splash-screen is a dependency (the plugin needs it)', typeof pkg.dependencies['expo-splash-screen'] === 'string')
yes('the app\'s own screens use the same background', /fill: \{ flex: 1, backgroundColor: '#121217' \}/.test(readFileSync(join(app, 'App.tsx'), 'utf8')))

/* 6. make-assets writes real files */
const dir = mkdtempSync(join(tmpdir(), 'kb-assets-'))
try {
  execFileSync('node', [join(app, 'scripts', 'make-assets.mjs'), '--out', dir], { stdio: 'pipe' })
  eq('make-assets: the five pictures', readdirSync(dir).sort(), Object.keys(ASSETS).sort())
  for (const f of Object.keys(ASSETS)) {
    const b = readFileSync(join(dir, f))
    yes(f + ' is a 1024 x 1024 PNG', b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && b.readUInt32BE(16) === 1024 && b.readUInt32BE(20) === 1024)
  }
} finally { rmSync(dir, { recursive: true, force: true }) }

console.log(fails === 0 ? '\nall good' : '\n' + fails + ' failed')
process.exit(fails === 0 ? 0 : 1)
