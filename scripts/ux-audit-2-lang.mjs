// Second UX and bug audit — the FRENCH and ARABIC (RTL) walks on an isolated instance.
// It drives DSH's own language selector (Settings › General › Language), which PERSISTS
// DSH's language preference in the sandbox profile; it always restores English in a
// finally, and it refuses to run against the real DSH (:3080).
//
//   source scripts/sandbox/env.sh
//   node scripts/ux-audit-2-lang.mjs --out /tmp/ux-audit-2 --lang fr
//   node scripts/ux-audit-2-lang.mjs --out /tmp/ux-audit-2 --lang ar --width 1400
//
// Per screen: a screenshot, the probe scan, and a check for text left in the wrong
// language (a French word under the English UI, an English one under French).
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openLivePage, waitFor, clickText } from './live-page.mjs'
import { createFlow } from './lib-language-flow.mjs'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d }
const OUT = argOf('--out', '/tmp/ux-audit-2/lang')
const LANG = argOf('--lang', 'fr') // fr | ar
const WIDTH = Number(argOf('--width', '1400'))
const HEIGHT = Number(argOf('--height', '900'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const host = process.env.KB_HOST || '127.0.0.1:3080'
if (host === '127.0.0.1:3080') { console.error('○ refusing to run against :3080 — this switches DSH\'s language'); process.exit(3) }
mkdirSync(join(OUT, 'shots'), { recursive: true })
const probes = readFileSync(process.env.KB_PROBES || join(REPO_ROOT, '.claude', 'skills', 'ux-bug-hunter', 'probes.js'), 'utf8')

const live = await openLivePage({ width: WIDTH, height: HEIGHT })
const page = live.page
const ev = async (js, ms = 15000) => (await page.evalJs(js, ms)).val
const flow = await createFlow(page)
const results = []
const n = { i: 0 }
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)

const shot = async (id) => {
  const name = String(n.i++).padStart(3, '0') + '-' + slug(id) + '.png'
  return (await page.shot(join(OUT, 'shots', name))) ? name : null
}

// Words that only belong to the OTHER language, found in visible text nodes.
// French under an English UI (and the reverse) is a leftover: a string a plugin
// hardcoded, or one its own table never translated.
const FRENCH_WORDS = /\b(le|la|les|des|une|pour|avec|dans|vous|votre|nous|est|sont|tout|tous|paramètres|réglages|ajouter|modifier|supprimer|enregistrer|connexion|langue|thème|mémoire|leçons|espace|équipe|automatisations|compétences|connecteurs)\b/i
const ENGLISH_WORDS = /\b(the|and|with|for|from|your|you|this|that|settings|language|theme|memory|lessons|workspace|team|automations|skills|connectors|save|delete|install|add)\b/i

const wrongLanguage = async () => {
  const want = LANG === 'fr' ? FRENCH_WORDS : (LANG === 'ar' ? /[\u0600-\u06FF]/ : ENGLISH_WORDS)
  const bad = LANG === 'fr' ? ENGLISH_WORDS : FRENCH_WORDS
  return JSON.parse((await ev(`JSON.stringify((() => {
    const bad = ${bad.source ? JSON.stringify(bad.source) : '""'}
    const re = new RegExp(bad, ${JSON.stringify(LANG === 'ar' ? '' : 'i')})
    const out = []
    const walk = (el) => {
      for (const n of el.childNodes) {
        if (n.nodeType === 3) {
          const t = (n.nodeValue || '').replace(/\\s+/g, ' ').trim()
          if (t.length > 3 && re.test(t)) { const r = el.getBoundingClientRect(); if (r.width > 2 && r.height > 2) out.push({ tag: el.tagName, cls: String(el.className || '').slice(0, 40), text: t.slice(0, 70) }) }
        } else if (n.nodeType === 1) walk(n)
      }
    }
    walk(document.body)
    return out.slice(0, 30)
  })()))`)) || '[]')
}

const record = async (id) => {
  await sleep(500)
  const img = await shot(id)
  await page.evalJs(probes, 8000)
  const findings = JSON.parse((await ev('JSON.stringify(window.__UXH__.scan())', 20000)) || '{"findings":[]}')
  const overflow = JSON.parse((await ev(`JSON.stringify((() => {
    const out = []
    for (const e of document.querySelectorAll('*')) {
      const r = e.getBoundingClientRect()
      if (r.width < 2 || r.height < 2) continue
      if (r.right > window.innerWidth + 1 || r.left < -1) {
        const cs = getComputedStyle(e)
        if (cs.position === 'fixed' || cs.visibility === 'hidden' || cs.opacity === '0') continue
        out.push({ tag: e.tagName, cls: String(e.className || '').slice(0, 50), left: Math.round(r.left), right: Math.round(r.right), text: (e.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 60) })
      }
    }
    return out.slice(0, 20)
  })()))`)) || '[]')
  const wrong = await wrongLanguage()
  const entry = { id, lang: LANG, width: WIDTH, shot: img, findings: findings.findings || findings, overflow, wrongLanguage: wrong }
  results.push(entry)
  writeFileSync(join(OUT, 'walk-' + LANG + '.json'), JSON.stringify(results, null, 2))
  console.log('✓ ' + id + ' — ' + ((entry.findings || []).length) + ' findings, ' + overflow.length + ' overflowing, ' + wrong.length + ' in the wrong language')
  return entry
}

try {
  // 1. switch DSH to the language under test (the sandbox persists it; restored below).
  const label = LANG === 'fr' ? 'Français' : 'العربية'
  await flow.pickDshLanguage(label, LANG)
  console.log('interface is now ' + (await ev('document.documentElement.lang')))
  await sleep(1500)

  // 2. walk the main pages + the settings pages at this width.
  const PAGES = [
    ['home', null], ['kaby', 'Kaby'], ['agent-teams', null], ['workspaces', null], ['creations', null],
    ['automations', null], ['skills', null], ['connectors', null],
  ]
  const clickSidebar = async (text) => {
    const js = `(() => {
      const want = ${JSON.stringify(String(text).toLowerCase())}
      const els = Array.from(document.querySelectorAll('[data-slot="sidebar"] button, [data-slot="sidebar"] [role=button]'))
      const hit = els.find((e) => { const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4 && (e.innerText || e.getAttribute('aria-label') || '').trim().split('\\n')[0].trim().toLowerCase() === want })
      if (!hit) return false
      hit.scrollIntoView({ block: 'center' })
      const r = hit.getBoundingClientRect()
      return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 })
    })()`
    const pos = await ev(js, 6000)
    if (!pos) return false
    const { x, y } = JSON.parse(pos)
    for (const t of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type: t, x, y, button: 'left', clickCount: 1 })
    await sleep(1100)
    return true
  }
  await record('home')
  for (const [id, label2] of PAGES) {
    if (id === 'home') continue
    // labels are translated now: go by position — the sidebar order is stable.
    const idx = PAGES.findIndex((p) => p[0] === id)
    const ok = await ev(`(() => {
      const els = Array.from(document.querySelectorAll('[data-slot="sidebar"] button, [data-slot="sidebar"] [role=button]')).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4 && (e.innerText || e.getAttribute('aria-label') || '').trim().length > 1 })
      const rows = els.filter((e) => /kb4-item|kb4-row/.test(String(e.className)) || e.closest('[class*="kb4"]'))
      const list = rows.length >= 5 ? rows : els
      const pick = list[${idx}]
      if (!pick) return false
      pick.scrollIntoView({ block: 'center' })
      const r = pick.getBoundingClientRect()
      return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 })
    })()`)
    if (ok) {
      const { x, y } = JSON.parse(ok)
      for (const t of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type: t, x, y, button: 'left', clickCount: 1 })
      await sleep(1200)
    }
    await record(id)
  }

  // 3. settings pages (the frame and the labels at this language).
  if (await flow.openSettings()) {
    await page.evalJs(`document.documentElement.setAttribute('data-kb-all-pages', '1')`, 4000)
    await sleep(800)
    const cells = JSON.parse((await ev(`JSON.stringify(Array.from(document.querySelectorAll('button[class*="navCell"]')).filter((b) => { const r = b.getBoundingClientRect(); return r.width > 4 && r.height > 4 }).map((b) => (b.innerText || '').trim().split('\\n')[0]))`)) || '[]')
    writeFileSync(join(OUT, 'settings-cells-' + LANG + '.json'), JSON.stringify(cells, null, 2))
    for (const name of cells) {
      const ok = await ev(`(() => { const b = Array.from(document.querySelectorAll('button[class*="navCell"]')).find((x) => (x.innerText || '').trim().split('\\n')[0] === ${JSON.stringify(name)}); if (!b) return false; b.scrollIntoView({ block: 'center' }); b.click(); return true })()`)
      if (ok !== true) continue
      await sleep(900)
      await record('set-' + slug(name))
    }
    // the frame, page by page
    const frames = []
    for (const name of cells) {
      await ev(`(() => { const b = Array.from(document.querySelectorAll('button[class*="navCell"]')).find((x) => (x.innerText || '').trim().split('\\n')[0] === ${JSON.stringify(name)}); if (b) { b.scrollIntoView({ block: 'center' }); b.click() } })()`)
      await sleep(500)
      frames.push({ label: name, frame: JSON.parse((await ev('JSON.stringify(window.__UXH__.frame())')) || '{}') })
    }
    const moved = JSON.parse((await ev(`JSON.stringify(window.__UXH__.diffFrames(${JSON.stringify(frames)}))`)) || '[]')
    writeFileSync(join(OUT, 'settings-frames-' + LANG + '.json'), JSON.stringify({ frames, moved }, null, 2))
    console.log('frame drift entries at ' + LANG + ': ' + moved.length)
  }
} finally {
  // Always give English back: this profile is the sandbox's, but leaving it in
  // another language would make the next run lie.
  try { await flow.restoreEnglish() } catch (e) { console.log('! restore English failed: ' + e.message) }
  writeFileSync(join(OUT, 'walk-' + LANG + '.json'), JSON.stringify(results, null, 2))
  console.log('\n' + results.length + ' screens at ' + LANG + ' → ' + OUT)
  await live.close()
}
