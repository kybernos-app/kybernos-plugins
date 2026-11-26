// What a deck file may bring into the editor page. The file is parsed with DOMParser (nothing runs), and the slides that come out of it are cleaned before they
// are put in the live page: no script or frame, no event handler, no address that leaves the page. The CSP of the frame already refuses all of it
// (script-src 'self', connect-src 'self', no inline handler); this keeps the saved file clean too, which is what the person shares afterwards.
const DROP = new Set(['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'link', 'meta', 'base', 'style', 'form', 'noscript', 'template'])
const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'poster', 'action', 'formaction', 'srcset', 'data', 'ping'])
// what an address may be: this page, a web or mail address, or (for a picture) the picture itself.
const href = (v) => /^(#|https?:|mailto:)/i.test(v)
const src = (v) => /^(https?:|data:image\/(png|jpe?g|gif|webp|svg\+xml)[;,])/i.test(v)
const compact = (v) => String(v).replace(/[\u0000- \u007f-\u009f]/g, '')

/** Cleans `root` (an element of a parsed document) in place and returns how many things were removed. */
export function sanitize (root) {
  let removed = 0
  for (const el of [...root.querySelectorAll('*')]) {
    if (DROP.has(el.localName)) { el.remove(); removed += 1; continue }
    for (const a of [...el.attributes]) {
      const name = a.name.toLowerCase()
      let bad = name.startsWith('on') || name === 'srcdoc'
      if (!bad && URL_ATTRS.has(name)) {
        const v = compact(a.value)
        bad = name === 'src' ? !src(v) : name === 'srcset' || name === 'data' || name === 'ping' || name === 'action' || name === 'formaction' ? true : !href(v)
      }
      if (!bad && name === 'style') bad = /url\(\s*(?!['"]?data:image\/)|@import|expression\(|javascript:|behavior:/i.test(a.value)
      if (bad) { el.removeAttribute(a.name); removed += 1 }
    }
  }
  return removed
}
