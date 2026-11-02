// French string literals in JavaScript source: the scanner behind scripts/test-no-french-literals.mjs (WP-07, decision D1:
// English is the base of every UI string; French lives only inside French dictionaries).
//
// Pure, offline, no dependency: a small lexer (comments, strings, template literals, regex literals, brackets) that yields
// every string literal with its place in the code, then two questions about each one:
//   isFrench(text)        does this literal read as French (accented letters, French function words, elisions)?
//   inDictionary(literal) is it where French is allowed: a French table, a [fr, en] row, the fr argument of a pair helper?
// Conservative on purpose: it must not flag English text or code identifiers. A single French word without accent and without
// a French function word (« Fichiers ») is NOT seen here; the per-bundle grep of whoever cleans a bundle catches those.

// ── lexer ───────────────────────────────────────────────────────────────────

const ID_START = /[A-Za-z_$]/
const ID_PART = /[A-Za-z0-9_$]/
// After these keywords a `/` starts a regex literal, not a division.
const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await'])

/**
 * Tokens of a JavaScript source: { type: 'str'|'tpl'|'id'|'p'|'num'|'re', text, value, line, depth stack info }.
 * - 'str'  a '…' or "…" literal; value = the cooked text (escapes resolved for the common ones).
 * - 'tpl'  a template literal; value = its text parts joined with a « ${} » placeholder (the expressions are lexed on their own).
 * - 'id'   an identifier or keyword; 'p' a punctuator (one char, or => / ?. / ?? / === etc. collapsed is NOT needed here).
 * Comments are dropped.
 */
export const lex = (src) => {
  const toks = []
  const n = src.length
  let i = 0
  let line = 1
  // template stack: each entry is the brace depth at which the current `${` was opened
  const tplStack = []
  let braceDepth = 0
  const last = () => toks[toks.length - 1]
  const regexAllowed = () => {
    const t = last()
    if (t === undefined) return true
    if (t.type === 'num' || t.type === 'str' || t.type === 'tpl' || t.type === 're') return false
    if (t.type === 'id') return REGEX_AFTER_WORD.has(t.text)
    // punctuator
    return !(t.text === ')' || t.text === ']' || t.text === '}')
  }
  const cook = (raw) => raw.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|\r?\n|[\s\S])/g, (m, e) => {
    if (e[0] === 'u') { try { return String.fromCodePoint(parseInt(e[1] === '{' ? e.slice(2, -1) : e.slice(1), 16)) } catch (err) { return m } }
    if (e[0] === 'x' && e.length === 3) return String.fromCharCode(parseInt(e.slice(1), 16))
    if (e === 'n') return '\n'
    if (e === 't') return '\t'
    if (e === 'r') return '\r'
    if (e === '\n' || e === '\r\n') return ''
    return e
  })
  // Reads template text from the char after a backtick (or after the `}` closing a `${`) up to the next `${` or closing backtick.
  const readTemplateChunk = (startLine) => {
    let raw = ''
    while (i < n) {
      const c = src[i]
      if (c === '\\') { raw += c + (src[i + 1] ?? ''); if (src[i + 1] === '\n') line += 1; i += 2; continue }
      if (c === '`') { i += 1; return { raw, end: true } }
      if (c === '$' && src[i + 1] === '{') { i += 2; return { raw, end: false } }
      if (c === '\n') line += 1
      raw += c
      i += 1
    }
    return { raw, end: true, unterminated: startLine }
  }
  const startTemplate = () => {
    const startLine = line
    const parts = []
    let chunk = readTemplateChunk(startLine)
    parts.push(chunk.raw)
    if (chunk.end) { toks.push({ type: 'tpl', text: '`', value: cook(parts.join('${}')), line: startLine }); return }
    // there are expressions: lex them with the main loop, remembering where the template started
    tplStack.push({ depth: braceDepth, parts, startLine })
    braceDepth += 1
  }
  while (i < n) {
    const c = src[i]
    if (c === '\n') { line += 1; i += 1; continue }
    if (c === ' ' || c === '\t' || c === '\r' || c === '﻿') { i += 1; continue }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i += 1; continue }
    if (c === '/' && src[i + 1] === '*') {
      i += 2
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line += 1; i += 1 }
      i += 2
      continue
    }
    if (c === '#' && i === 0 && src[1] === '!') { while (i < n && src[i] !== '\n') i += 1; continue }
    if (c === '"' || c === "'") {
      const startLine = line
      let raw = ''
      i += 1
      while (i < n && src[i] !== c && src[i] !== '\n') {
        if (src[i] === '\\') { raw += src[i] + (src[i + 1] ?? ''); if (src[i + 1] === '\n') line += 1; i += 2; continue }
        raw += src[i]
        i += 1
      }
      i += 1
      toks.push({ type: 'str', text: c, value: cook(raw), line: startLine })
      continue
    }
    if (c === '`') { i += 1; startTemplate(); continue }
    if (c === '}' && tplStack.length > 0 && tplStack[tplStack.length - 1].depth + 1 === braceDepth) {
      // end of a `${ … }` expression: continue the template text
      const t = tplStack[tplStack.length - 1]
      i += 1
      braceDepth -= 1
      const chunk = readTemplateChunk(t.startLine)
      t.parts.push(chunk.raw)
      if (chunk.end) { tplStack.pop(); toks.push({ type: 'tpl', text: '`', value: cook(t.parts.join('${}')), line: t.startLine }) } else { braceDepth += 1 }
      continue
    }
    if (c === '/' && regexAllowed()) {
      // regex literal: skip to the closing slash (class [...] aware), then flags
      let j = i + 1
      let inClass = false
      while (j < n && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue }
        if (src[j] === '[') inClass = true
        else if (src[j] === ']') inClass = false
        else if (src[j] === '/' && !inClass) break
        j += 1
      }
      if (src[j] === '/') {
        const body = src.slice(i + 1, j)
        j += 1
        while (j < n && ID_PART.test(src[j])) j += 1
        toks.push({ type: 're', text: '/', value: body, line })
        i = j
        continue
      }
    }
    if (ID_START.test(c) || c > '\u007f' && /\p{L}/u.test(c)) {
      let j = i + 1
      while (j < n && (ID_PART.test(src[j]) || (src[j] > '\u007f' && /[\p{L}\p{N}]/u.test(src[j])))) j += 1
      toks.push({ type: 'id', text: src.slice(i, j), line })
      i = j
      continue
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i + 1
      while (j < n && /[0-9a-zA-Z_.]/.test(src[j])) { if (src[j] === '.' && !/[0-9]/.test(src[j + 1] ?? '')) break; j += 1 }
      toks.push({ type: 'num', text: src.slice(i, j), line })
      i = j
      continue
    }
    if (c === '{') braceDepth += 1
    if (c === '}') braceDepth -= 1
    toks.push({ type: 'p', text: c, line })
    i += 1
  }
  return toks
}

// ── structure: where is each literal? ───────────────────────────────────────

const isPunct = (t, ch) => t !== undefined && t.type === 'p' && t.text === ch

/**
 * Walks the tokens with a stack of brackets and returns every string/template literal as
 * { text, line, labels, key, callee, argIndex, arrayIndex, arrayLen, siblingStr, afterEq } where
 *   labels     the names of the enclosing `{`/`[`/`(` openers, innermost last (the key before `: {`, the variable before `= {`, a callee before `(`);
 *   key        the property key right before this literal (`fr: 'x'` → 'fr'), or null;
 *   callee     the function name when this literal is a direct argument of a call, or null;
 *   argIndex   its rank among the arguments (0-based), -1 when not an argument;
 *   arrayIndex / arrayLen / arraySecond   when a direct element of an array literal: its index, the element count, the second element's token.
 */
export const literals = (src) => {
  const toks = lex(src)
  const out = []
  // stack entry: { open: '{'|'['|'(', label, argIndex, elems: [tokens of direct children kind], isCall }
  const stack = []
  const topInfo = () => stack[stack.length - 1]
  const labelBefore = (idx) => {
    // idx = index of the opener token. Look back for `key :`, `NAME =`, `NAME(`, `name: [`, `.name = {`.
    const p = toks[idx - 1]
    if (p === undefined) return null
    if (p.type === 'id') return p.text
    if (p.type === 'str' && isPunct(toks[idx], '(') === false) return p.value
    if (isPunct(p, ':') || isPunct(p, '=')) {
      const q = toks[idx - 2]
      if (q !== undefined && (q.type === 'id' || q.type === 'str')) return q.type === 'id' ? q.text : q.value
      if (isPunct(q, ']')) {
        // computed key  [x]: {  or  obj[x] = {  : label unknown
        return null
      }
    }
    if (isPunct(p, '>') && isPunct(toks[idx - 2], '=')) return null // arrow body
    if (isPunct(p, ')') ) return null
    return null
  }
  // pre-pass: arrays' string-element counting needs lookahead, so record for each `[` its direct children.
  const arrayInfo = new Map() // opener token index → { items: [{ tokIdx, isStr }] }
  {
    const st = []
    for (let k = 0; k < toks.length; k += 1) {
      const t = toks[k]
      if (t.type === 'p' && (t.text === '{' || t.text === '[' || t.text === '(')) {
        const par = st[st.length - 1]
        if (par !== undefined && par.itemStart) { par.items.push({ k, isStr: false, tok: t }); par.itemStart = false }
        st.push({ open: t.text, k, itemStart: true, items: [] })
        continue
      }
      if (t.type === 'p' && (t.text === '}' || t.text === ']' || t.text === ')')) { const e = st.pop(); if (e !== undefined && e.open === '[') arrayInfo.set(e.k, e.items); const par = st[st.length - 1]; if (par !== undefined) par.itemStart = false; continue }
      const e = st[st.length - 1]
      if (e === undefined) continue
      if (t.type === 'p' && t.text === ',') { e.itemStart = true; continue }
      if (e.itemStart) {
        // a direct item starts here; is it a bare string literal followed by , or ] ?
        const nx = toks[k + 1]
        const isBareStr = (t.type === 'str' || t.type === 'tpl') && (isPunct(nx, ',') || isPunct(nx, ']'))
        e.items.push({ k, isStr: isBareStr, tok: t })
        e.itemStart = false
      }
    }
  }
  for (let k = 0; k < toks.length; k += 1) {
    const t = toks[k]
    if (t.type === 'p' && (t.text === '{' || t.text === '[' || t.text === '(')) {
      const entry = { open: t.text, label: labelBefore(k), argIndex: 0, k }
      if (t.text === '(') {
        const p = toks[k - 1]
        entry.label = p !== undefined && p.type === 'id' ? p.text : null
        entry.isCall = p !== undefined && p.type === 'id'
      }
      stack.push(entry)
      continue
    }
    if (t.type === 'p' && (t.text === '}' || t.text === ']' || t.text === ')')) { stack.pop(); continue }
    if (t.type === 'p' && t.text === ',') { const e = topInfo(); if (e !== undefined && e.open === '(') e.argIndex += 1; continue }
    if (t.type === 'str' || t.type === 'tpl') {
      const e = topInfo()
      const prev = toks[k - 1]
      const next = toks[k + 1]
      // a property key follows « { » or « , »; a literal before a colon after « ? » is the middle of a ternary (« c ? 'Fermer' : 'Close' »)
      const isKey = isPunct(next, ':') && e !== undefined && e.open === '{' && (isPunct(prev, '{') || isPunct(prev, ',') || prev === undefined)
      const key = isKey ? null : (isPunct(prev, ':') && (toks[k - 2] !== undefined && (toks[k - 2].type === 'id' || toks[k - 2].type === 'str')) && e !== undefined && e.open === '{' ? (toks[k - 2].type === 'id' ? toks[k - 2].text : toks[k - 2].value) : null)
      let callOf = null
      for (let q = stack.length - 1; q >= 0; q -= 1) {
        const st = stack[q]
        if (st.open !== '(') break
        if (st.isCall) { callOf = st; break }
      }
      const rec = {
        text: t.value,
        line: t.line,
        isKey,
        key,
        labels: stack.map((s) => s.label).filter((l) => l !== null && l !== undefined),
        // the call this literal is an argument of, even when it sits inside the argument's expression (`kt('il y a ' + n, …)`),
        // also through grouping parentheses (`kt('' + (n > 1 ? 's' : ''), …)`); a bracket or a brace in between makes it part of that structure
        callee: callOf !== null ? callOf.label : null,
        argIndex: callOf !== null ? callOf.argIndex : (e !== undefined && e.open === '(' ? e.argIndex : -1),
        arrayLen: -1,
        arrayIndex: -1,
        arraySecondStr: false,
        rowMixed: false,
      }
      if (e !== undefined && e.open === '[') {
        const items = arrayInfo.get(e.k) ?? []
        rec.arrayLen = items.length
        rec.arrayIndex = items.findIndex((it) => it.k === k)
        rec.arraySecondStr = items.length === 2 && items[0].isStr && items[1].isStr
        // a row of languages ([en, fr, es, ar]): two to six bare strings of which at least one is not French
        rec.rowMixed = items.length >= 2 && items.length <= 6 && items.every((it) => it.isStr) && items.some((it) => !isFrench(it.tok.value))
      }
      out.push(rec)
    }
  }
  return { literals: out, tokens: toks }
}

// ── is this French? ─────────────────────────────────────────────────────────

// Accented letters that mark French (é è ê ë à â ç î ï ô ù û œ and the capitals). Spanish/Portuguese-only ones (á í ó ú ñ ã õ) are not here.
const FR_ACCENT = /[àâçéèêëîïôùûœÀÂÇÉÈÊËÎÏÔÙÛŒ]/
// French function words that are not English words (« on », « a », « me », « son », « plus », « pour », « sur » are left out):
// two of them in one literal make it French.
const FUNCTION_WORDS = new Set('le la les des du au aux une et ou où dans avec sans est sont pas qui que cette ces cet votre vos vous tu ton tes toi mais donc très aussi déjà encore chaque tous toutes après avant depuis chez leur leurs ses nous elle elles ils être avoir faire fait peut pouvez voulez ici'.split(' '))
// French content words that are not English words: one of them in a short label (five words or fewer) makes it French.
const LEXICON = new Set(('début fin relire briques maquette maquettes aucun aucune fichier fichiers dossier dossiers fermer ouvrir annuler valider enregistrer enregistrement supprimer désinstaller ' +
  'démarrage rejouer couleur texte vide lancer arrêter réessayer chargement erreur échec terminé bientôt ajouter retirer renommer dupliquer copier coller effacer choisir choisissez ' +
  'demande demandez retour suivant précédent aujourd hui hier demain jamais toujours merci bonjour ordinateur serveur connexion compte langue réglages paramètres compétences créations ' +
  'livrables rechercher résultats épinglés modeleur maintenant ensuite rien plusieurs prochain dernier derniers première cliquez appuyez introuvable lancez créez ajoutez mettez relancez ' +
  'patientez attendez pièces rendu élément éléments enregistré enregistrée envoyer envoyé afficher masquer actualiser rafraîchir ' +
  'diagramme diagrammes graphiques').split(' '))
// French words written WITHOUT their accent (a host log, an error message, a label typed on a keyboard that has no é): the accent rule cannot see them.
// Only words that are not English words. Checked in the bundles listed under "unaccented" in the allow-list (the gate tightens bundle by bundle).
const UNACCENTED = new Set(('indisponible indisponibles injoignable illisible illisibles inconnu inconnue invalide invalides manquant manquante requis requise attendu attendue refusee refusees ' +
  'discuter cacher archiver cloner rejeter approuver recentrer graphe chronologie orchestrateur connecteur connecteurs galerie favoris sonde membres outil outils ' +
  'objectif actif initiale composants acteur sortie attente ecriture ecrit reglage reglages demarrage lancement parrainage reponse octets ' +
  'etape etapes equipe equipes modele modeles cle cles tache taches fichier fichiers apercu echec reussi termine bientot rien jamais toujours demain aujourd ' +
  'vide chargement erreur introuvable aucun aucune').split(' '))
const ELISION = /(?:^|[^A-Za-z0-9])(?:l|d|qu|n|s|j|c|m|t|jusqu)['’][a-zàâçéèêëîïôùûœ]/i
// Language names written in their own language, and a few proper names, are not « French text » (a language picker lists them).
const AUTONYM = /^(?:Français|Español|Deutsch|Português|Italiano|Nederlands|Türkçe|Polski|Русский|日本語|한국어|中文|العربية|हिन्दी|Svenska|Čeština|Română|Magyar|Ελληνικά|עברית|Bahasa|Tiếng Việt|Amélie|Zoé|Aurélie|Gérard|Hélène|Cécile|Frédéric|Valérie|Rénald)(?:\s*\(.*\))?$/

const NOT_FRENCH_MARK = /[¿¡ñáíóúãõìòßäöü]/i
const FR_ONLY = /[èêëâçîïôûœÈÊËÂÇÎÏÔÛŒ]/
const wordsOf = (text) => text.toLowerCase().split(/[^a-zàâçéèêëîïôùûœ]+/).filter((w) => w.length > 0)

/** Does this literal read as French text? (the decision is about the text alone, not about where it sits) */
export const isFrench = (raw, opts) => {
  if (typeof raw !== 'string') return false
  let unaccented = opts !== undefined && opts !== null && opts.unaccented === true
  // a comment inside a CSS template is not a user-facing string
  const text = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\$\{\}/g, ' ').replace(/\bkybernos-[a-z-]+/g, ' ').trim()
  if (text.length < 2) return false
  // CSS (class names such as .kbi-vide are not words) and code-like text: the accent-less rule is about sentences and labels
  if (/[{};]/.test(text)) unaccented = false
  if (AUTONYM.test(text)) return false
  // not text at all: a URL, a path, a selector list, a regex source, a JSON/CSS fragment with no sentence
  if (/^(?:https?:|\/|\.{1,2}\/|[#.][\w-]+$|@[\w-]+\/)/.test(text)) return false
  // Spanish, Portuguese, Italian or German text that happens to carry an é or an à is not French
  if (NOT_FRENCH_MARK.test(text) && !FR_ONLY.test(text)) return false
  // an identifier (id, class, route, event name) is not text: the one-word lexicon rule below needs a bare word
  const identifierLike = /^[\w$]+(?:[-_.:/][\w$]+)+$/.test(raw.trim())
  if (FR_ACCENT.test(text)) {
    // a lone accented token inside code-like text (a character class « [àé] », an escape table) is not a sentence
    if (/^[\[\]()\\|^$*+?{}\-àâçéèêëîïôùûœ\s]+$/i.test(text) && /[\[\]\\|]/.test(text)) return false
    return true
  }
  const words = wordsOf(text)
  const fn = new Set(words.filter((w) => FUNCTION_WORDS.has(w)))
  if (fn.size >= 2) return true
  if (ELISION.test(text) && (fn.size >= 1 || words.length >= 3)) return true
  // A lone lowercase word ('texte', 'trait') is a token of the code (a type, an id), not a label: labels are capitalised or phrases.
  if (!identifierLike && words.length <= 5 && words.some((w) => LEXICON.has(w) || (unaccented && UNACCENTED.has(w))) && (words.length >= 2 || /^[A-ZÀ-Ý]/.test(text))) return true
  // a longer text (a log line, an error message) with two of the accent-less words in it
  if (unaccented && !identifierLike && words.filter((w) => UNACCENTED.has(w)).length >= 2) return true
  return false
}

// English function words: a Markdown line with more of these than French ones is English even when it quotes a French label.
const EN_WORDS = new Set('the and of to is are for with in an that this it on by as at be or not from you your can will when if then no one'.split(' '))
const FR_PROSE = new Set('de du des le la les un une et ou pour par sur dans avec sans est sont pas ne qui que ce cette ces au aux il elle se son sa ses nous vous leur mais donc comme où ni très aussi chaque tous toutes après avant depuis chez'.split(' '))

/** Is this line of prose (a README) French? Counts French and English function words; an accent tips a close call. */
export const isFrenchProse = (line) => {
  const words = wordsOf(line)
  let fr = 0
  let en = 0
  for (const w of words) { if (FR_PROSE.has(w)) fr += 1; else if (EN_WORDS.has(w)) en += 1 }
  if (fr >= 2 && fr > en) return true
  if (FR_ACCENT.test(line) && fr >= 1 && fr >= en) return true
  return false
}

// ── where French is allowed ─────────────────────────────────────────────────

const FR_LABEL = /^(?:fr|FR|kybernos|fr[-_]FR|FRENCH|French|[A-Za-z0-9_]*_FR|FR_[A-Za-z0-9_]*|[a-z][A-Za-z0-9]*Fr|fr[A-Z][A-Za-z0-9_]*|[A-Z_]*FR_EN|[A-Za-z]*FrEn|[a-z]+FR)$/
// Prose of a given language table of another language is outside this scanner's question (es/ar/zh strings are not French).

/**
 * The names a file gives to its [fr, en] pair helpers: `const kt = (fr, en) =>`, `function tr(fr, en)`, `const pick = (fr, en, …)`.
 * A call whose callee is one of them and whose first argument is a literal puts that literal in a dictionary.
 */
export const pairHelpers = (src) => {
  const names = new Map() // helper name → index of its French parameter
  const note = (name, params) => {
    const list = params.split(',').map((p) => p.trim().replace(/\s*=.*$/, ''))
    const at = list.findIndex((p, i) => /^(?:fr|francais)$/.test(p) && /^(?:en|anglais)$/.test(list[i + 1] ?? ''))
    if (at >= 0) { names.set(name, at); return }
    // …or (en, fr): `const kbObSkill = (name, source, en, fr) =>`
    const back = list.findIndex((p, i) => /^(?:en|anglais)$/.test(p) && /^(?:fr|francais)$/.test(list[i + 1] ?? ''))
    if (back >= 0) names.set(name, back + 1)
  }
  for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^()]*)\)\s*=>/g)) note(m[1], m[2])
  for (const m of src.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(([^()]*)\)/g)) note(m[1], m[2])
  return names
}

/** Is this literal (an element of `literals(src).literals`) in a place where French belongs? */
export const inDictionary = (lit, helpers) => {
  if (lit.key !== null && FR_LABEL.test(lit.key)) return true
  if (lit.labels.some((l) => FR_LABEL.test(l))) return true
  if (lit.callee !== null && helpers.has(lit.callee) && lit.argIndex === helpers.get(lit.callee)) return true
  if (lit.arrayLen === 2 && lit.arrayIndex === 0 && lit.arraySecondStr) return true
  if (lit.rowMixed) return true
  return false
}

/** Every French literal of a source that is NOT in a dictionary: [{ line, text }]. */
export const frenchOutsideDictionary = (src, opts) => {
  const helpers = pairHelpers(src)
  const { literals: lits } = literals(src)
  const out = []
  for (const lit of lits) {
    if (lit.isKey) continue
    if (!isFrench(lit.text, opts)) continue
    if (inDictionary(lit, helpers)) continue
    out.push({ line: lit.line, text: lit.text })
  }
  return out
}

/** Every French literal of a source, dictionary or not: used to report what a table holds. */
export const frenchEverywhere = (src) => literals(src).literals.filter((l) => !l.isKey && isFrench(l.text)).map((l) => ({ line: l.line, text: l.text }))

// ── the register: the French of the product speaks « tu » (decision D1) ─────────────────────────

// words that end in -ez without being a « vous » imperative
const NOT_VOUS = new Set(['chez', 'assez', 'nez', 'rez'])

/** The « vous » forms of a French text: the pronouns (vous, votre, vos) and the imperatives and present forms in -ez (rechargez, avez…).
 *  « rendez-vous » is a noun. Returns the words found, [] when the text speaks « tu » (or is not addressed to anyone). */
export const vousForms = (text) => {
  const clean = String(text).replace(/rendez-vous/gi, ' ')
  const out = []
  for (const m of clean.matchAll(/(?<![\p{L}\p{N}_])(vous|votre|vos|[\p{L}]{2,}ez)(?![\p{L}\p{N}_])/giu)) {
    if (!NOT_VOUS.has(m[1].toLowerCase())) out.push(m[1])
  }
  return out
}

// a stop list (« le la les … vous … vos ») is data read by a search, not text shown to anyone: fifteen or more bare lowercase words
const isStopList = (text) => text.trim().split(/\s+/).length >= 15 && /^[a-zà-ÿ' -]+$/.test(text.trim())

/** Every French literal of a source (dictionary keys included: a phrase table is keyed by the French text) that addresses the user as « vous »:
 *  [{ line, text, words }]. */
export const vousFormsOfSource = (src) => literals(src).literals
  .filter((l) => isFrench(l.text) && !isStopList(l.text))
  .map((l) => ({ line: l.line, text: l.text, words: vousForms(l.text) }))
  .filter((o) => o.words.length > 0)

// ── READMEs and descriptions: prose ─────────────────────────────────────────

/** The French lines of a Markdown file (prose lines only: fenced code and inline code are left alone). */
export const frenchLinesOfMarkdown = (md) => {
  const out = []
  let fence = false
  md.split('\n').forEach((l, i) => {
    if (/^\s*```/.test(l)) { fence = !fence; return }
    if (fence) return
    const prose = l.replace(/`[^`]*`/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    if (isFrenchProse(prose)) out.push({ line: i + 1, text: l.trim().slice(0, 100) })
  })
  return out
}
