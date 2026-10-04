// Shared by audit-i18n-live.mjs and test-language-live.mjs: what counts as visible
// interface text on the live GUI, and how a leftover is told from a translation.
// Pseudo-localisation marks a translated string with ⟦…⟧ (see audit-i18n-live.mjs).

// In-page collector: every visible text node + the text-bearing attributes.
// Returns [{ text, kind }]; kind = 'text' | 'placeholder' | 'title' | 'aria'.
export const collectIn = (rootSelector) => `(() => {
  const ROOT = ${rootSelector === null || rootSelector === undefined ? 'null' : JSON.stringify(rootSelector)}
  const scope = ROOT ? document.querySelector(ROOT) : document.body
  if (!scope) return '[]'
  const out = []
  const visible = (el) => {
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e)
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false
    }
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.textContent.replace(/\\s+/g, ' ').trim()
    if (!t) continue
    const p = n.parentElement
    if (!p || /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA)$/.test(p.tagName) || !visible(p)) continue
    // The sidebar's session/workspace list is the USER's data (titles they wrote,
    // folder names), not interface copy: left out of the measure. The sidebar is
    // the 285 px column on the reading-start side (left in LTR, right in RTL).
    const r = p.getBoundingClientRect()
    if ((r.left < 285 || r.right > innerWidth - 285) && r.top > 345 && r.bottom < innerHeight - 70 && p.closest('[data-kb-audit-keep]') === null) {
      const sidebar = (document.documentElement.dir === 'rtl') ? r.left > innerWidth - 300 : r.right < 300
      if (sidebar) continue
    }
    out.push({ text: t, kind: 'text' })
  }
  for (const el of scope.querySelectorAll('[placeholder],[title],[aria-label]')) {
    if (!visible(el)) continue
    for (const [attr, kind] of [['placeholder', 'placeholder'], ['title', 'title'], ['aria-label', 'aria']]) {
      const v = el.getAttribute(attr)
      if (v && v.trim()) out.push({ text: v.trim(), kind })
    }
  }
  return JSON.stringify(out)
})()`
export const COLLECT = collectIn(null)

// What counts as a leftover worth reporting.
const FR_WORDS = /\b(le|la|les|des|du|de|un|une|et|ou|pour|avec|sans|dans|sur|par|est|sont|pas|vous|votre|vos|aucun|aucune|ajouter|créer|supprimer|ouvrir|fermer|enregistrer|annuler|modifier|choisir|nouveau|nouvelle|afficher|masquer|chargement|erreur|actif|actifs|lancer|relancer|réglages|paramètres)\b/i
export const classify = (text) => {
  if (!/\p{L}/u.test(text)) return null // digits, symbols, punctuation
  if (/^[\d\s.,:;%·•\-–—/()+×x#@]+[a-zA-Z]{0,3}$/.test(text)) return null // "16h", "3 x", "10%"
  if (/^(https?:\/\/|\/|~\/|[\w.-]+\.(js|mjs|ts|json|md|yml|yaml|txt|py|css|html))/.test(text)) return null // paths, urls, files
  if (/^[A-Za-z0-9_.:/\-@#]+$/.test(text) && text.length > 18) return null // ids, hashes, slugs
  return /[àâäçéèêëîïôöùûüœÀÉÈÊÔÛ]/.test(text) || FR_WORDS.test(text) ? 'fr' : 'en'
}

export const analyse = (items) => {
  const seen = new Set()
  const r = { translated: 0, fr: [], en: [] }
  for (const it of items) {
    const key = it.kind + '|' + it.text
    if (seen.has(key)) continue
    seen.add(key)
    if (it.text.includes('⟦')) { r.translated += 1; continue }
    const c = classify(it.text)
    if (c === 'fr') r.fr.push(it.text)
    else if (c === 'en') r.en.push(it.text)
  }
  return r
}
