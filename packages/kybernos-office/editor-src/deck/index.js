// The deck editor frame: the slides of a `.deck.html` file, edited in place. The file is read with the other editors' envelope (open/save contract), parsed
// without running anything, cleaned, and drawn by the deck runtime; what goes back is the same file with only its slides replaced.
//   ?ro=1  view only (no editing chrome)    ?lang=fr|en    ?name=…  (a label; unused here)
import './deck-base.css'
import './deck-edit.css'
import './deck-print.css'
import { LANG, READONLY, dirty, errorText, fail, fetchFile, listen, loaded } from '../envelope.js'
import { T, setLang } from './i18n.js'
import { sanitize } from './sanitize.js'
import { replaceDeck } from './serialize.js'
import { start } from './runtime.js'
import { KBTip } from './tiptap.js'

setLang(LANG)
const state = { text: '', baseline: '', pending: null, api: null, since: 0 }

// The editor says « changed » only for what the person did, never for what it does by itself when it opens.
const onTouch = () => { if (performance.now() - state.since > 300) dirty(true) }

async function load () {
  const f = await fetchFile()
  const text = new TextDecoder('utf-8').decode(f.bytes)
  const doc = new DOMParser().parseFromString(text, 'text/html')
  const meta = doc.querySelector('meta[name="kybernos-deck"]')
  const main = doc.querySelector('main#deck')
  if (meta === null || meta.getAttribute('content') !== '1' || main === null) throw new Error(T('This file is not a Kybernos deck.'))
  sanitize(main)
  // The file's own base style is ignored (the editor's style is always the current one); its theme (colours) is kept.
  const theme = doc.querySelector('style[data-kd="theme"]')
  if (theme !== null) {
    const style = document.createElement('style')
    style.setAttribute('data-kd', 'theme')
    style.textContent = theme.textContent.replace(/@import[^;]*;?/gi, '')
    document.head.appendChild(style)
  }
  // The host page's empty box would take a viewport of height in front of the grid view; the deck is the page.
  const box = document.getElementById('app')
  if (box !== null) box.remove()
  const deck = document.createElement('main')
  deck.id = 'deck'
  deck.innerHTML = main.innerHTML
  document.body.appendChild(deck)
  state.text = text
  state.since = performance.now()
  state.api = start({ edit: !READONLY, framed: window.parent !== window, tiptap: KBTip, lang: LANG, onTouch })
  state.baseline = state.api.slidesHtml(true)
  if (!READONLY) state.api.setEditing(true)
  dirty(false)
  loaded(f.hash, READONLY)
}

listen({
  // An unchanged deck goes back byte for byte; a changed one is the original text with its slides replaced.
  exportBytes: () => {
    const canon = state.api.slidesHtml(true)
    const text = canon === state.baseline ? state.text : replaceDeck(state.text, state.api.slidesHtml())
    state.pending = { text, canon }
    return new TextEncoder().encode(text)
  },
  reload: () => location.reload(),
  saved: () => {
    if (state.pending !== null) { state.text = state.pending.text; state.baseline = state.pending.canon; state.pending = null }
    dirty(false)
  },
})

load().catch((e) => {
  fail(e)
  const box = document.getElementById('app') || document.body
  box.textContent = errorText(e)
  box.style.cssText = 'padding:16px;color:#b00;font:14px system-ui,sans-serif;white-space:pre-wrap'
})
