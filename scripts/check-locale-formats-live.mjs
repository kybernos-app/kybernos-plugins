#!/usr/bin/env node
// Numbers, dates, times and money by language (case J18-11): the same figures read in English, French, German and Arabic, on the two screens a person reads them on.
//
//   source scripts/sandbox/env.sh && source <replica env> && node scripts/check-locale-formats-live.mjs --out <dir> [--only web|dsh]
//
//   web  the server's account pages on a disposable replica (the made-up account `a` of KB_E2E_DIR/accounts.json), with the browser's language set to
//        en-US, fr-FR, de-DE and ar-EG: the home page, Plan and credits, Usage, Billing. The page chooses French or English from the first browser language, so
//        what a German or an Arabic browser gets is part of the answer.
//   dsh  the desktop GUI of a sandbox paired to that replica (KYBERNOS_CLOUD_API at start, scripts/e2e-connect.mjs): Settings > Usage (the plan block, a
//        figure from the server) and the Automations list, its calendar and one automation, which it seeds (a daily, a weekly and a Friday-evening cron, each with
//        past runs). English; the built-in French; German and Arabic as added languages (the translation is the stand-in of lib-language-flow.mjs: every text comes
//        back as ⟦text⟧, so only what the page FORMATS itself, numbers, dates, times, shows what the language does). English is put back in a `finally`.
//
// It WRITES the sandbox's kybernos/tasks.json (removed again) and switches the sandbox's language (put back). Refuses :3080 and any DSH home that is not a sandbox's.
// The web part only reads. Nothing leaves the machine. Exit code 0 when the run went through (the findings are in the report), 1 when it broke, 3 when it cannot start.
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, waitFor, clickText } from './live-page.mjs'
import { createFlow, assertEnglishStored, LANGUAGE } from './lib-language-flow.mjs'
import { makeServer, readAccounts } from './lib-e2e-server.mjs'

const args = process.argv.slice(2)
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d }
const OUT = argOf('--out', null)
const ONLY = argOf('--only', null)
if (OUT === null) { console.error('usage: --out <dir> [--only web|dsh]'); process.exit(3) }
mkdirSync(join(OUT, 'shots'), { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const host = process.env.KB_HOST || '127.0.0.1:3080'
const home = process.env.DSH_HOME || ''
if (/:3080$/.test(host) || !home.includes('.kybernos-sandbox')) { console.error('○ inconclusive: needs a sandbox DSH (source scripts/sandbox/env.sh), not :3080.'); process.exit(3) }
if (!process.env.KB_E2E_WEB) { console.error('○ inconclusive: no replica (KB_E2E_WEB unset)'); process.exit(3) }

const report = { when: new Date().toISOString(), web: {}, dsh: {} }
const squash = (t) => String(t || '').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim()
/** The lines of a page that carry a figure: a digit in any script, or a currency sign. */
const figureLines = (text) => squash(text).split('\n').map((l) => l.trim()).filter((l) => /[0-9٠-٩۰-۹]|[$€£]/.test(l))
const show = (s) => String(s).replace(/ /g, '⍽').replace(/ /g, '⍽n').replace(/ /g, '⍽t')
const classify = (lines) => {
  const all = lines.join(' | ')
  return {
    arabicIndicDigits: /[٠-٩۰-۹]/.test(all),
    twelveHour: /\b\d{1,2}:\d{2}\s?(?:[AaPp]\.?[Mm]\.?)/.test(all),
    twentyFourHour: /\b(?:1[3-9]|2[0-3]):\d{2}\b/.test(all) || /\b(?:1[3-9]|2[0-3])\s?h\s?\d{2}\b/.test(all),
    thousandsComma: /\b\d{1,3}(?:,\d{3})+\b/.test(all),
    thousandsSpace: /\b\d{1,3}(?:[   ]\d{3})+\b/.test(all),
    thousandsDot: /\b\d{1,3}(?:\.\d{3})+\b/.test(all),
    decimalComma: /\d,\d{1,2}(?!\d)/.test(all.replace(/\b\d{1,3}(?:,\d{3})+\b/g, '')),
    decimalDot: /\d\.\d{1,2}(?!\d)/.test(all.replace(/\b\d{1,3}(?:\.\d{3})+\b/g, '')),
    dollarBefore: /\$\s?\d/.test(all),
    dollarAfter: /\d\s?(?:\$|\$US|US\$)/.test(all),
    euroSign: /€/.test(all),
  }
}

// ═══ web: the server's account pages ═══════════════════════════════════════════════════════════════════════════════
const runWeb = async () => {
  const s = makeServer()
  const acc = readAccounts(s.e).a
  if (!acc) throw new Error('no account a in accounts.json: create one first')
  const si = await s.signIn(acc.email, acc.password)
  const live = await openLivePage({ width: 1300, height: 950 })
  const { page } = live
  const val = async (e, ms) => (await page.evalJs(e, ms)).val
  await page.send('Network.enable', {})
  for (const c of si.cookie.split(';').map((x) => x.trim()).filter(Boolean)) { const i = c.indexOf('='); await page.send('Network.setCookie', { name: c.slice(0, i), value: c.slice(i + 1), url: s.e.web }) }
  const ua = await val('navigator.userAgent')
  const PAGES = [['home', ''], ['plan', '#plan'], ['usage', '#usage'], ['billing', '#billing']]
  try {
    for (const [tag, accept] of [['en-US', 'en-US'], ['fr-FR', 'fr-FR'], ['de-DE', 'de-DE'], ['ar-EG', 'ar-EG']]) {
      await page.send('Emulation.setUserAgentOverride', { userAgent: ua, acceptLanguage: accept })
      await page.send('Emulation.setLocaleOverride', { locale: accept })
      const rec = { languages: null, pages: {} }
      for (const [name, hash] of PAGES) {
        await page.send('Page.navigate', { url: s.e.web + '/account' + hash })
        await sleep(600)
        await page.send('Page.reload', { ignoreCache: true })
        await waitFor(page, `document.readyState === 'complete' && (document.body.innerText || '').length > 200`, 20000)
        await sleep(2500)
        if (rec.languages === null) rec.languages = JSON.parse(await val('JSON.stringify(navigator.languages)'))
        const text = await val(`(() => { const m = document.querySelector('main') || document.body; return m.innerText })()`)
        const lines = figureLines(text)
        rec.pages[name] = { url: await val('location.href'), htmlLang: await val('document.documentElement.lang'), dir: await val('document.documentElement.dir'), figures: lines.slice(0, 60), shown: lines.slice(0, 60).map(show), classes: classify(lines), head: squash(text).slice(0, 160) }
        try { await page.shot(join(OUT, 'shots', 'web-' + tag + '-' + name + '.png')) } catch (e) { /* no shot */ }
      }
      report.web[tag] = rec
      console.log('  ○ web ' + tag + ': languages ' + JSON.stringify(rec.languages) + ' | home figures: ' + JSON.stringify(rec.pages.home.shown.slice(0, 6)))
    }
  } finally { await live.close() }
}

// ═══ dsh: the desktop GUI ═════════════════════════════════════════════════════════════════════════════════════════
const runDsh = async () => {
  assertEnglishStored()
  const kyb = join(home, 'kybernos')
  const tasksFile = join(kyb, 'tasks.json')
  if (existsSync(tasksFile)) { console.error('○ inconclusive: the sandbox already has automations (tasks.json): this check seeds its own and will not overwrite yours'); process.exit(3) }
  const at = (d, h, m) => new Date(Date.UTC(2026, 9, d, h, m, 0)).toISOString()
  const mk = (id, name, cron, tz, history) => ({ id, createdAt: at(1, 9, 0), updatedAt: at(1, 9, 0), name, prompt: 'A made-up task.', schedule: { mode: 'cron', cron, tz }, runsOn: 'local', active: false, approvals: 'ask', notify: [], history, lastRun: history[history.length - 1].at, nextRun: null })
  const fired = (d, h, m, n) => ({ at: at(d, h, m), sessionId: 'seed-' + n, status: 'fired' })
  const SEED = [
    mk('loc-daily', 'Daily digest', '30 14 * * *', 'Europe/Paris', [fired(28, 14, 30, 1), fired(29, 14, 30, 2), fired(30, 14, 30, 3)]),
    mk('loc-weekly', 'Weekly report', '0 8 * * 1', 'UTC', [fired(5, 8, 0, 4), fired(12, 8, 0, 5), fired(19, 8, 0, 6), fired(26, 8, 0, 7)]),
    mk('loc-evening', 'Evening backup', '45 23 * * 5', 'America/New_York', [fired(23, 23, 45, 8)]),
  ]
  writeFileSync(tasksFile, JSON.stringify(SEED, null, 2))
  const live = await openLivePage({ width: 1400, height: 900 }).catch((e) => { rmSync(tasksFile, { force: true }); console.error('○ inconclusive: ' + e.message); process.exit(3) })
  const { page } = live
  const val = async (e, ms) => (await page.evalJs(e, ms)).val
  const flow = await createFlow(page)
  const mouse = flow.mouse
  const pressSel = (sel) => flow.clickSel(sel)
  const shot = async (n) => { try { await page.shot(join(OUT, 'shots', n + '.png')) } catch (e) { /* no shot */ } }
  let usageCellIndex = null

  const readSettingsUsage = async (tag) => {
    await flow.openSettings(LANGUAGE) // opens Settings on the Language page, in whichever language the UI is in
    await sleep(800)
    if (usageCellIndex === null) {
      const cells = JSON.parse(await val(`JSON.stringify(Array.from(document.querySelectorAll('button[class*="navCell"]')).map((b) => (b.innerText || '').trim().split('\\n')[0]))`))
      usageCellIndex = cells.indexOf('Usage')
      report.dsh.navCells = cells
    }
    const pos = await val(`(() => { const b = Array.from(document.querySelectorAll('button[class*="navCell"]'))[${usageCellIndex}]; if (!b) return null; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) })()`)
    if (typeof pos !== 'string') return { error: 'no nav cell ' + usageCellIndex }
    const p = JSON.parse(pos)
    await mouse(p.x, p.y)
    await sleep(3500)
    const text = await val(`(() => { const t = document.body.innerText; const i = t.lastIndexOf('\\nClose'); return t })()`)
    const cut = squash(text)
    const start = Math.max(cut.lastIndexOf('Usage\n?'), cut.lastIndexOf('\n?\n'))
    const body = start >= 0 ? cut.slice(start, start + 1800) : cut.slice(-1800)
    await shot('dsh-' + tag + '-usage')
    return { text: body, figures: figureLines(body), classes: classify(figureLines(body)) }
  }
  const readAutomations = async (tag) => {
    await flow.reload()
    await val(`window.__KB_OPEN__ && window.__KB_OPEN__({ view: 'tasks' })`)
    await waitFor(page, `!!document.querySelector('[data-kb="page-automations"]')`, 20000)
    await sleep(1800)
    const out = {}
    await pressSel('[data-kb="view-list"]'); await sleep(900)
    const list = await val(`document.querySelector('[data-kb="page-automations"]').innerText`)
    out.list = { figures: figureLines(list), classes: classify(figureLines(list)) }
    await shot('dsh-' + tag + '-automations-list')
    await pressSel('[data-kb="view-calendar"]'); await sleep(1500)
    const cal = await val(`document.querySelector('[data-kb="page-automations"]').innerText`)
    const weekdays = JSON.parse(await val(`JSON.stringify(Array.from(document.querySelectorAll('[data-kb="page-automations"] *')).filter((e) => e.children.length === 0 && /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|lun|mar|mer|jeu|ven|sam|dim|Mo|Di|Mi|Do|Fr|Sa|So|[\\u0623-\\u064a]{2,6})\\.?$/i.test((e.innerText || '').trim()) && e.getBoundingClientRect().top < 400).map((e) => (e.innerText || '').trim()).slice(0, 14))`))
    out.calendar = { head: squash(cal).slice(0, 500), weekdayHeaders: weekdays, figures: figureLines(cal).slice(0, 30) }
    await shot('dsh-' + tag + '-automations-calendar')
    await pressSel('[data-kb="view-list"]'); await sleep(900)
    // one automation: its schedule line and its past runs
    await clickText(page, 'Daily digest'); await sleep(2500)
    const det = await val(`document.querySelector('[data-kb="page-automations"]').innerText`)
    out.detail = { figures: figureLines(det).slice(0, 40), classes: classify(figureLines(det)), head: squash(det).slice(0, 500) }
    await shot('dsh-' + tag + '-automation-detail')
    return out
  }
  const readAll = async (tag) => {
    const rec = { htmlLang: await val('document.documentElement.lang'), dir: await val('document.documentElement.dir'), navLanguage: await val('navigator.language') }
    rec.automations = await readAutomations(tag)
    rec.usage = await readSettingsUsage(tag)
    report.dsh[tag] = rec
    console.log('  ○ dsh ' + tag + ' (html lang ' + rec.htmlLang + '): automations ' + JSON.stringify(rec.automations.list.figures.slice(0, 4).map(show)) + ' | usage ' + JSON.stringify((rec.usage.figures || []).slice(0, 4).map(show)))
  }

  try {
    await flow.reload()
    await readAll('en')
    // the built-in French
    await flow.openSettings(LANGUAGE)
    await pressSel('[data-lang="kybernos"] [data-act="use"]')
    await sleep(2500)
    await waitFor(page, `document.documentElement.lang === 'fr'`, 20000)
    await flow.reload()
    await readAll('fr')
    await flow.restoreEnglish(); await flow.reload()
    // German and Arabic as added languages
    for (const iso of ['de', 'ar']) {
      await flow.reload()
      await flow.installStub()
      await flow.pseudoLanguage(iso)
      await sleep(1500)
      await flow.reload()
      await readAll(iso)
      await flow.restoreEnglish(); await flow.reload()
    }
  } finally {
    try { await flow.restoreEnglish() } catch (e) { /* reported below */ }
    try { await live.close() } catch (e) { /* gone */ }
    rmSync(tasksFile, { force: true })
  }
}

let broke = null
try {
  if (ONLY !== 'dsh') await runWeb()
  if (ONLY !== 'web') await runDsh()
} catch (e) { broke = String(e && e.stack ? e.stack : e).slice(0, 800); console.log('  ✗ the run broke — ' + broke) }
report.broke = broke
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 1))
console.log('report: ' + join(OUT, 'report.json'))
process.exit(broke ? 1 : 0)
