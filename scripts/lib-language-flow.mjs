// Drives the Language page of the REAL GUI: shared by check-language-live.mjs (the
// end-to-end test) and audit-i18n-live.mjs (the coverage audit, which needs a real
// translated language to measure).
//
//   import { createFlow } from './lib-language-flow.mjs'
//   const flow = await createFlow(page)         // page from openLivePage()
//   await flow.pseudoLanguage('es')             // add it, translate it (stubbed LLM), use it
//   …measure…
//   await flow.restoreEnglish()                 // ALWAYS, in a finally
//
// ⚠ Using a language makes DSH persist ITS language preference in the profile's
// configuration — on this machine, not in the throw-away browser. Every caller
// must `restoreEnglish()` in a `finally`, and `assertEnglishStored()` first: a
// run refuses to start if DSH's stored language is not « en », so it can never
// overwrite a choice of yours. See docs/dev/live-testing.md.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { clickText, waitFor } from './live-page.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// The LLM, stubbed in the page: every string comes back as ⟦text⟧ after a short
// delay. `window.__KB_TEST__` steers it from the test (`fail`, `failAfter` = fail once
// that many calls were made, `delay`) and keeps
// what was asked (`calls`, `batches`).
export const STUB = `(() => {
  const real = window.fetch.bind(window)
  window.__KB_TEST__ = { fail: false, failAfter: null, delay: 150, calls: 0, batches: [] }
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || ''
    if (url.indexOf('/kybernos/i18n-translate') >= 0 && init && init.body) {
      const T = window.__KB_TEST__
      T.calls += 1
      await new Promise((r) => setTimeout(r, T.delay))
      if (init.signal && init.signal.aborted) throw new DOMException('Aborted', 'AbortError')
      const body = JSON.parse(init.body)
      T.batches.push({ lang: body.lang, name: body.langName, source: body.source, n: Object.keys(body.batch).length })
      const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
      if (T.fail || (T.failAfter !== null && T.calls > T.failAfter)) return json({ ok: false, error: 'ollama-cloud/deepseek-v4.1-flash : MISSING_CREDENTIAL — OLLAMA_CLOUD_API_KEY is not set' })
      const tr = {}
      for (const k of Object.keys(body.batch)) tr[k] = '⟦' + body.batch[k] + '⟧'
      return json({ ok: true, provider: 'test', model: 'pseudo', translations: tr })
    }
    return real(input, init)
  }
})()`

// Simulates the Language plugin being switched OFF, as DSH would see it if the plugin
// were left out of the profile: its entry still loads (DSH waits for every entry), but
// does nothing. Steered by localStorage `__kb_disable_lang` = "1", read at every load.
export const DISABLE_SWITCH = `(() => {
  // DSH's loader REPLACES its own \`load\` after the first module (\`dsh-client-modules\`
  // swaps the queueing version for the real one), so wrapping the value of the moment
  // would only ever catch that first module: wrap the PROPERTY, whatever is assigned.
  const wrapLoad = (loader) => {
    const guard = (fn) => (def) => {
      const off = def && def.id === '@local/kybernos-language' && localStorage.getItem('__kb_disable_lang') === '1'
      return fn.call(loader, off ? Object.assign({}, def, { factory: () => ({ inject: [], apply() {} }) }) : def)
    }
    let wrapped = typeof loader.load === 'function' ? guard(loader.load) : loader.load
    Object.defineProperty(loader, 'load', { configurable: true, enumerable: true, get() { return wrapped }, set(fn) { wrapped = typeof fn === 'function' ? guard(fn) : fn } })
  }
  let loader
  Object.defineProperty(window, '__ModuleLoader__', {
    configurable: true,
    get() { return loader },
    set(v) {
      loader = v
      if (v && typeof v === 'object' && !v.__kbWrapped) { v.__kbWrapped = true; wrapLoad(v) }
    },
  })
})()`

/** The language DSH has STORED for this profile (null when the file can't be read). */
export const storedLocale = () => {
  try {
    const profile = process.env.KB_PROFILE || 'web'
    const yml = readFileSync(join(homedir(), '.dsh', 'profiles', profile, 'cordis.patch.yml'), 'utf8')
    const m = /-\s+id:\s+locale\s*\n\s+name:[^\n]*\n\s+config:\s*\n\s+preference:\s*(\S+)/.exec(yml)
    return m === null ? null : m[1]
  } catch (e) { return null }
}

/** Exits 3 (inconclusive) unless DSH's stored language is « en » — see the warning above. */
export const assertEnglishStored = () => {
  const stored = storedLocale()
  if (stored !== null && stored !== 'en') {
    console.error('○ inconclusive: DSH’s stored language is « ' + stored + ' », not « en ». This run switches languages and puts English back: it refuses to start so it cannot overwrite your choice.')
    process.exit(3)
  }
  return stored
}

export const SETTINGS = ['Settings', 'Paramètres', 'Réglages']
// The nav entry first: under a translated UI, « Language » is also a row of the General page.
export const LANGUAGE = ['Langue', 'Language']

export async function createFlow(page) {
  const val = async (expr, ms) => (await page.evalJs(expr, ms)).val
  const mouse = async (x, y) => {
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  }
  // Click an element found by CSS selector (the page carries stable data-act / data-lang hooks).
  const clickSel = async (selector) => {
    const pos = await val(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) })()`)
    if (pos === null || pos === undefined) return false
    const { x, y } = JSON.parse(pos)
    await mouse(x, y)
    return true
  }
  const click = async (text, within) => clickText(page, text, within ? { within } : {})
  const typeInPicker = async (text) => {
    await page.evalJs(`(() => { const i = document.querySelector('.kbth-add input'); i.focus(); i.select() })()`)
    await page.send('Input.insertText', { text })
    await sleep(450)
  }
  const shellReady = `/studio|my workspace/i.test(document.body ? document.body.innerText : '')`
  const reload = async () => {
    await page.send('Page.reload', {})
    await sleep(3000)
    await waitFor(page, shellReady, 25000)
    await sleep(800)
  }
  const openSettings = async (label) => {
    // Always from a clean state: from inside the settings, the account footer is not there.
    await reload()
    for (let i = 0; i < 3; i += 1) {
      const pos = JSON.parse(await val(`JSON.stringify({ x: document.documentElement.dir === 'rtl' ? innerWidth - 140 : 140, y: innerHeight - 45 })`))
      await mouse(pos.x, pos.y); await sleep(700)
      for (const l of SETTINGS) if (await click(l)) break
      await sleep(1500)
      if (/back to workspace|retour au workspace/i.test(await val('document.body.innerText'))) break
      await reload()
    }
    if (label) {
      for (const l of Array.isArray(label) ? label : [label]) if (await click(l)) break
      await sleep(1200)
    }
  }
  const rowText = (id) => val(`(() => { const r = document.querySelector('[data-lang="${id}"]'); return r ? r.innerText.replace(/\\n+/g, ' | ') : null })()`)
  const hasRow = async (id) => (await val(`!!document.querySelector('[data-lang="${id}"]')`)) === true
  const waitReady = (id, ms) => waitFor(page, `(() => { const r = document.querySelector('[data-lang="${id}"]'); return !!r && !!r.querySelector('[data-act="use"]') })()`, ms)
  const addLanguage = async (iso, searchText) => {
    await clickSel('[data-act="add-language"]'); await sleep(500)
    if (searchText) { await typeInPicker(searchText); await clickSel('.kbth-iso [data-iso="' + iso + '"]') } else await clickSel('.kbth-chip[data-iso="' + iso + '"]')
    await sleep(800)
  }

  /** Installs the stubbed LLM for this page and every later load. */
  const installStub = async () => {
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: DISABLE_SWITCH })
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: STUB })
    await page.send('Page.reload', {})
    await sleep(4000)
    await waitFor(page, shellReady, 25000)
  }

  /** Add `iso`, translate it (stubbed), press « Use » and land in the reloaded GUI. */
  const pseudoLanguage = async (iso) => {
    await openSettings(LANGUAGE)
    if (!(await hasRow(iso))) await addLanguage(iso, null)
    await clickSel('[data-lang="' + iso + '"] [data-act="start"]')
    if ((await waitReady(iso, 120000)) === null) throw new Error('the ' + iso + ' translation did not finish: ' + (await rowText(iso)))
    await clickSel('[data-lang="' + iso + '"] [data-act="use"]')
    await sleep(2500)
    await waitFor(page, `document.documentElement.lang === ${JSON.stringify(iso)}`, 20000)
    await reload()
  }

  /** Switch the Language plugin off/on for the NEXT page load (see DISABLE_SWITCH). */
  const languagePlugin = async (on) => {
    await val(on ? `localStorage.removeItem('__kb_disable_lang')` : `localStorage.setItem('__kb_disable_lang', '1')`)
  }
  /** DSH's own Language row in Settings › General: where its label and its button are. */
  const dshLanguageRow = async () => {
    const r = await val(`(() => {
      const labels = Array.from(document.querySelectorAll('*')).filter((e) => e.children.length === 0 && /^(⟦)?language(⟧)?$/i.test((e.innerText || '').trim()) && e.getBoundingClientRect().left > 250 && e.getBoundingClientRect().width > 0)
      for (const l of labels) {
        let row = l
        for (let i = 0; i < 6 && row.parentElement; i += 1) {
          row = row.parentElement
          const b = row.querySelector('button')
          // Either side of the label: right-to-left mirrors the row.
          if (b && !l.contains(b)) {
            const q = b.getBoundingClientRect(); const lr = l.getBoundingClientRect()
            return JSON.stringify({ trigger: b.innerText.trim(), x: q.left + q.width / 2, y: q.top + q.height / 2, labelTop: lr.top, labelBottom: lr.bottom, labelLeft: lr.left })
          }
        }
      }
      return null
    })()`)
    return r === null || r === undefined ? null : JSON.parse(r)
  }
  /** Same, but waits for the General page to finish painting (a loaded machine takes a few seconds). */
  const waitDshLanguageRow = async (ms = 12000) => {
    const end = Date.now() + ms
    for (;;) {
      const row = await dshLanguageRow()
      if (row !== null || Date.now() > end) return row
      await sleep(400)
    }
  }
  const openDshLanguageMenu = async () => {
    const row = await waitDshLanguageRow()
    if (row === null) return false
    await mouse(row.x, row.y)
    await sleep(700)
    return true
  }
  const dshLanguageOptions = async () => JSON.parse((await val(`JSON.stringify(Array.from(document.querySelectorAll('[role=menu] *')).filter((e) => e.children.length === 0 && (e.innerText || '').trim()).map((e) => e.innerText.trim()))`)) || '[]')
  /** Pick a language in DSH's own selector; waits for the page to reload into it. */
  const pickDshLanguage = async (label, expectLang) => {
    await waitFor(page, `performance.now() > 8000`, 20000) // past the runtime's boot grace: this is a user's choice
    if (!(await openDshLanguageMenu())) throw new Error('DSH Language row not found')
    if (!(await click(label, '[role="menu"]'))) throw new Error('option not found: ' + label)
    await waitFor(page, `document.documentElement.lang === ${JSON.stringify(expectLang)}`, 25000)
    await sleep(3500)
    await waitFor(page, shellReady, 25000)
    await sleep(800)
  }

  let restoring = false
  /** Puts DSH back in English (« Use » on English, or on French, which also sends DSH to English). */
  const restoreEnglish = async () => {
    if (restoring) return
    restoring = true
    try {
      await languagePlugin(true) // the page to press « Use » on needs the plugin
      await openSettings(LANGUAGE)
      await waitFor(page, `!!document.querySelector('[data-lang="en"]')`, 10000)
      if (!(await clickSel('[data-lang="en"] [data-act="use"]'))) await clickSel('[data-lang="kybernos"] [data-act="use"]')
      await sleep(2500)
    } catch (e) { console.log('  ! restoring English failed: ' + e.message) }
    restoring = false
  }

  return { val, mouse, clickSel, click, typeInPicker, reload, openSettings, rowText, hasRow, waitReady, addLanguage, installStub, pseudoLanguage, restoreEnglish, shellReady, languagePlugin, dshLanguageRow, waitDshLanguageRow, openDshLanguageMenu, dshLanguageOptions, pickDshLanguage }
}
