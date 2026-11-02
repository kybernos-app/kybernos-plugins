// What a translated interface text must still be, whatever the model says.
//
// A model that is asked for forty translations at once sometimes translates a variable, drops a tag, answers in the source
// language, adds a sentence of its own or cuts the text short. Each of these reached a screen once: `{count} files` read
// `{compte} fichiers`, a link lost its address, a button said « Here is the translation: Save ». The checks below are cheap,
// run on every text before it is kept, and say WHY a text was refused so the next attempt can be told.
//
//   hard  → the text is not kept; the batch's next attempt (and the second pass) is told the reason;
//   soft  → the text is kept and listed for the person to double-check (an unchanged copy is often right: « Document »).
//
// Pure: no I/O, no model. One call per text, a few regular expressions: it costs nothing next to the model call.

// Variables a translation must carry over untouched: {name}, {{name}}, ${name}, %s, %d, %1$s.
const PLACEHOLDER = /\{\{?\w+\}?\}|\$\{\w+\}|%\d+\$[sd]|%[sd]/g
const TAG = /<\/?[A-Za-z][^<>]*>/g
const URL_RE = /https?:\/\/[^\s)<>\]"'`]+/g
const MD_LINK = /\[([^\]]*)\]\(([^)\s]+)\)/g
const CODE = /`([^`]+)`/g

// Product names and technical words that stay as they are. Soft: a transliteration (« كلود ») is not a mistake of the
// kind that breaks a screen, so it is flagged, not refused.
export const PROTECTED_TERMS = Object.freeze([
  'Kybernos', 'DSH', 'DeepSeek', 'Claude', 'Anthropic', 'OpenAI', 'Ollama', 'Gemini', 'GitHub', 'Composio', 'LiveKit',
  'MCP', 'API', 'JSON', 'YAML', 'Markdown', 'Telegram', 'Stripe', 'Whisper',
])

// Letters of the script a language is written in. A language not listed is Latin-script as far as this check goes.
const SCRIPTS = {
  ar: /[؀-ۿݐ-ݿࢠ-ࣿ]/u, fa: /[؀-ۿݐ-ݿ]/u, ur: /[؀-ۿݐ-ݿ]/u,
  ps: /[؀-ۿ]/u, sd: /[؀-ۿ]/u, ug: /[؀-ۿ]/u, ku: /[؀-ۿÀ-ſ]/u,
  he: /[֐-׿]/u, yi: /[֐-׿]/u,
  ru: /[Ѐ-ӿ]/u, uk: /[Ѐ-ӿ]/u, bg: /[Ѐ-ӿ]/u, be: /[Ѐ-ӿ]/u, sr: /[Ѐ-ӿÀ-ſ]/u,
  mk: /[Ѐ-ӿ]/u, kk: /[Ѐ-ӿ]/u, mn: /[Ѐ-ӿ]/u, tg: /[Ѐ-ӿ]/u, ky: /[Ѐ-ӿ]/u,
  el: /[Ͱ-Ͽἀ-῿]/u, hy: /[԰-֏]/u, ka: /[Ⴀ-ჿ]/u,
  hi: /[ऀ-ॿ]/u, mr: /[ऀ-ॿ]/u, ne: /[ऀ-ॿ]/u, sa: /[ऀ-ॿ]/u,
  bn: /[ঀ-৿]/u, pa: /[਀-੿]/u, gu: /[઀-૿]/u, ta: /[஀-௿]/u, te: /[ఀ-౿]/u,
  kn: /[ಀ-೿]/u, ml: /[ഀ-ൿ]/u, si: /[඀-෿]/u, th: /[฀-๿]/u, lo: /[຀-໿]/u,
  my: /[က-႟]/u, km: /[ក-៿]/u, am: /[ሀ-፿]/u,
  ko: /[가-힯ᄀ-ᇿ]/u, ja: /[぀-ヿ一-鿿]/u, zh: /[一-鿿]/u,
}
// Scripts that say a lot in few characters: the length bounds are wider for them.
const COMPACT = new Set(['ja', 'zh', 'ko'])

const PROTECTED_RE = new RegExp('(?<![\\p{L}])(?:' + PROTECTED_TERMS.join('|') + ')(?![\\p{L}])', 'gu')
const baseLang = (lang) => String(lang === undefined || lang === null ? '' : lang).toLowerCase().split(/[-_]/)[0]
const multiset = (list) => list.slice().sort().join('\u0001')
const matches = (re, s) => s.match(re) || []
// Eastern Arabic, Persian and Devanagari digits are digits: a model may well write « ٣ » for « 3 ».
const asciiDigits = (s) => s.replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06F0)).replace(/[०-९]/g, (c) => String(c.charCodeAt(0) - 0x0966))
const trailing = (u) => u.replace(/[.,;:!?)]+$/, '')

/** The text with what a translation must not touch taken out: what is left is what a person reads. */
export function visibleText(s) {
  return String(s).replace(TAG, ' ').replace(URL_RE, ' ').replace(CODE, ' ').replace(PLACEHOLDER, ' ').replace(/\s+/g, ' ').trim()
}

const META = /^\s*(?:```|here(?:'s| is)\b|sure[,!.]|certainly[,!.]|of course\b|voici\b|bien sûr\b|traduction\s*:|translation\s*:|translated\s+text\s*:)|as an ai\b|i (?:cannot|can't|can not) (?:translate|help)/i

/**
 * Check one translated text against its source.
 * @param {string} source  the text as it was sent
 * @param {string} translated  what the model answered (already trimmed)
 * @param {{ lang?: string }} [opts]
 * @returns {{ hard: string[], soft: string[] }} codes: hard = placeholder | tags | url | code | numbers | script | length | meta | empty;
 *   soft = unchanged | glossary:<term>
 */
export function inspect(source, translated, opts) {
  const lang = baseLang(opts && opts.lang)
  const s = String(source)
  const t = String(translated)
  const hard = []
  const soft = []
  if (t.trim() === '') return { hard: ['empty'], soft }

  if (multiset(matches(PLACEHOLDER, s)) !== multiset(matches(PLACEHOLDER, t))) hard.push('placeholder')
  if (multiset(matches(TAG, s).map((x) => x.toLowerCase())) !== multiset(matches(TAG, t).map((x) => x.toLowerCase()))) hard.push('tags')
  if (multiset(matches(URL_RE, s).map(trailing)) !== multiset(matches(URL_RE, t).map(trailing))) hard.push('url')
  // A markdown link keeps its address; inline code is kept verbatim.
  const links = (x) => Array.from(x.matchAll(MD_LINK)).map((m) => m[2])
  if (multiset(links(s)) !== multiset(links(t)) && !hard.includes('url')) hard.push('url')
  const codes = (x) => Array.from(x.matchAll(CODE)).map((m) => m[1])
  if (multiset(codes(s)) !== multiset(codes(t))) hard.push('code')

  const sv = visibleText(s)
  const tv = visibleText(t)
  const digits = (x) => matches(/\d+/g, asciiDigits(x))
  if (multiset(digits(sv)) !== multiset(digits(tv))) hard.push('numbers')

  // The answer is not the text: a sentence of the model's own, a code fence.
  if (META.test(t) && !META.test(s)) hard.push('meta')

  // Written in the wrong script (a language left in Latin letters, or the source's language kept).
  const script = SCRIPTS[lang]
  if (script !== undefined) {
    // A product name stays in Latin letters in any script: it is not evidence the answer was left in the wrong one.
    const bare = tv.replace(PROTECTED_RE, ' ')
    const letters = Array.from(bare).filter((c) => /\p{L}/u.test(c))
    if (letters.length >= 6) {
      const own = letters.filter((c) => script.test(c)).length
      if (own / letters.length < 0.4) hard.push('script')
    }
  }

  // Cut short, or padded with an explanation.
  if (sv.length >= 12) {
    const ratio = tv.length / sv.length
    const low = COMPACT.has(lang) ? 0.12 : 0.3
    if (ratio < low || ratio > 3.5) hard.push('length')
  }

  if (hard.length === 0) {
    const norm = (x) => visibleText(x).toLowerCase().replace(/[\s.,;:!?¿¡…"'«»“”]+/g, ' ').trim()
    const letters = (norm(s).match(/\p{L}/gu) || []).length
    // « OK », « Menu », « Document », a lone number or a brand are the same in many languages: only a sentence counts
    // (two words or more, eight letters or more) when it comes back exactly as it went.
    const words = norm(s).split(' ').filter((w) => w !== '').length
    if (letters >= 8 && words >= 2 && norm(s) === norm(t) && lang !== 'fr') soft.push('unchanged')
    for (const term of PROTECTED_TERMS) {
      if (new RegExp('(^|[^\\p{L}])' + term + '([^\\p{L}]|$)', 'u').test(s) && !new RegExp('(^|[^\\p{L}])' + term + '([^\\p{L}]|$)', 'u').test(t)) soft.push('glossary:' + term)
    }
  }
  return { hard, soft }
}

const WHY = {
  empty: 'the translation is empty',
  placeholder: 'a variable ({name}, {{name}}, %s, %d) was changed, translated or lost: copy them exactly',
  tags: 'the HTML tags are not the same as in the source text: keep them exactly',
  url: 'an address (URL or Markdown link) changed: keep it exactly',
  code: 'a code excerpt between backticks was changed: keep it exactly',
  numbers: 'the numbers are not the same as in the source text',
  meta: 'the answer contains a sentence that is not the translation (introduction, explanation, code block): answer with the translation only',
  script: 'the text is not written in the script of the target language',
  length: 'the length is inconsistent with the source text (cut short or padded)',
}

/** A sentence for the model, in French like the rest of its prompt, for the reasons a text was refused. */
export const explain = (reasons) => reasons.map((r) => WHY[r] || r).join(' ; ')

/** « placeholder+length » → ['placeholder', 'length'] (reasons travel as a short string between host calls). */
export const joinReasons = (reasons) => reasons.join('+')
export const splitReasons = (s) => String(s).split('+').filter((x) => x !== '')
