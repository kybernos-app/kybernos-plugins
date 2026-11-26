// Maquette editor, pure part: find every element of an HTML file by position, and patch the file
// in place. Everything outside the touched ranges stays byte-identical (contract: docs/dev/office-editors-open-save-contract-2026-11-03.md).
// No disk, no network: texts in, texts out. parse5 and postcss are the vendored copies (vendor/NOTICES.md).
import { parse, parseFragment, serialize } from './vendor/parse5.mjs'
import postcss from './vendor/postcss.mjs'
import crypto from 'node:crypto'

export const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');

// Walk the parse5 tree in document order. Elements that exist in the source (they have a
// start tag) get an id; implied html/head/body get none.
export function index(src) {
  const doc = parse(src, { sourceCodeLocationInfo: true });
  const byId = new Map();
  let n = 0;
  (function walk(node) {
    if (node.nodeName && !node.nodeName.startsWith('#')) {
      const loc = node.sourceCodeLocation;
      if (loc && loc.startTag) { node.__id = ++n; byId.set(n, node); }
    }
    const kids = node.content ? node.content.childNodes : node.childNodes;
    if (kids) kids.forEach(walk);
  })(doc);
  return { doc, byId, count: n };
}

// The copy served to the editor: same file plus data-ky-i="N" on every start tag.
export function instrument(src) {
  const { byId } = index(src);
  const ins = [];
  for (const [id, node] of byId) {
    const st = node.sourceCodeLocation.startTag;
    const at = st.endOffset - (src[st.endOffset - 2] === '/' ? 2 : 1);
    ins.push([at, ` data-ky-i="${id}"`]);
  }
  ins.sort((a, b) => b[0] - a[0]);
  let out = src;
  for (const [at, text] of ins) out = out.slice(0, at) + text + out.slice(at);
  return out;
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Split "a:b; c:url(x;y)" at top-level semicolons.
function declarations(css) {
  const out = []; let depth = 0, quote = '', cur = '';
  for (const ch of css) {
    if (quote) { cur += ch; if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ';' && depth === 0) { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.map((d) => { const i = d.indexOf(':'); return [d.slice(0, i).trim(), d.slice(i + 1).trim()]; });
}

const norm = (s) => s.replace(/\s*([>+~,])\s*/g, '$1').replace(/\s+/g, ' ').trim();   // the browser writes "a > b, c" where the file says "a>b,c"

// Change one declaration of one top-level rule, leaving every other byte of the stylesheet alone.
export function patchCss(css, selector, prop, after, add = false) {
  const root = postcss.parse(css);
  const hits = [], rules = [];
  root.walkRules((r) => {
    if (r.parent.type !== 'root' || norm(r.selector) !== norm(selector)) return;
    rules.push(r);
    r.each((d) => { if (d.type === 'decl' && d.prop === prop) hits.push(d); });
  });
  if (!hits.length && add) {
    if (rules.length !== 1) return { error: `the selector ${selector} appears ${rules.length} times at the top level` };
    rules[0].append({ prop, value: after });
    return { out: root.toString() };
  }
  if (hits.length !== 1) return { error: hits.length ? `the rule ${selector} declares ${prop} ${hits.length} times` : `no rule "${selector}" declaring ${prop} at the top level` };
  hits[0].value = after;
  return { out: root.toString() };
}

// patches: {type:'rule', file:'dsh.css' | null, styleId, selector, prop, after}
// html is the (already patched) page; cssFiles is {name: text}. Returns new texts.
export function applyRules(html, cssFiles, patches) {
  const errors = [], applied = [];
  let outHtml = html; const outCss = { ...cssFiles };
  for (const p of patches) {
    if (!declOk(p.prop, p.after)) { errors.push({ patch: p, why: `"${p.prop}: ${p.after}" is not a style the editor accepts` }); continue; }
    if (p.file) {
      if (!(p.file in outCss)) { errors.push({ patch: p, why: `stylesheet ${p.file} not found` }); continue; }
      const r = patchCss(outCss[p.file], p.selector, p.prop, p.after, !!p.add);
      if (r.error) errors.push({ patch: p, why: r.error }); else { outCss[p.file] = r.out; applied.push(p); }
    } else {
      const { byId } = index(outHtml);
      const el = byId.get(p.styleId);
      const t = el && el.nodeName === 'style' && el.childNodes.find((c) => c.nodeName === '#text');
      if (!t) { errors.push({ patch: p, why: '<style> block not found in the file' }); continue; }
      const { startOffset, endOffset } = t.sourceCodeLocation;
      const r = patchCss(outHtml.slice(startOffset, endOffset), p.selector, p.prop, p.after, !!p.add);
      if (r.error) errors.push({ patch: p, why: r.error }); else { outHtml = outHtml.slice(0, startOffset) + r.out + outHtml.slice(endOffset); applied.push(p); }
    }
  }
  return { html: outHtml, css: outCss, applied, errors };
}

// One style declaration the editor may write (inline or in a rule): a plain property name, a value that cannot close the
// declaration, the block or the style tag, and nothing that loads or runs something.
export const declOk = (prop, value) => /^[a-z][a-z-]{1,40}$/.test(String(prop)) && typeof value === 'string' && value.trim().length > 0 && value.length <= 300 && !/[;{}<>\\]|\/\*|\*\/|url\s*\(|expression|@import|javascript:|behavior/i.test(value);
const NO_TEXT = new Set(['script', 'style', 'textarea', 'template']);
const EDIT_ATTRS = new Set(['src', 'alt', 'href']);
const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
// a web address, a mail address, a # anchor, or a file next to the page (images/photo.png); never javascript: or data:
export const URL_OK = /^(https?:\/\/[^\s"'<>]+|mailto:[^\s"'<>]+|#[\w-]*|(?!\/\/)(?![a-z][a-z0-9+.-]*:)[\w./%~-][\w./%~?&=#,+-]*)$/i;

// patches: [{type:'text', id, node, before, after} | {type:'style', id, prop, after}]
export function applyPatches(src, patches) {
  const { byId } = index(src);
  const edits = []; const applied = []; const errors = [];
  const styleByEl = new Map();
  for (const p of patches) {
    const node = byId.get(p.id);
    if (!node) { errors.push({ patch: p, why: 'element not found in the file (built by a script, or the file changed)' }); continue; }
    if (p.type === 'text') {
      if (NO_TEXT.has(node.nodeName)) { errors.push({ patch: p, why: `text of <${node.nodeName}> is refused` }); continue; }
      const texts = node.childNodes.filter((c) => c.nodeName === '#text');
      const t = texts[p.node];
      if (!t || !t.sourceCodeLocation) { errors.push({ patch: p, why: 'text node not found' }); continue; }
      if (t.value !== p.before) { errors.push({ patch: p, why: 'the text in the file is no longer what the editor saw' }); continue; }
      const { startOffset, endOffset } = t.sourceCodeLocation;
      edits.push({ start: startOffset, end: endOffset, text: esc(p.after) });
      applied.push(p);
    } else if (p.type === 'style') {
      if (!declOk(p.prop, p.after)) { errors.push({ patch: p, why: `"${p.prop}: ${p.after}" is not a style the editor accepts` }); continue; }
      if (!styleByEl.has(p.id)) styleByEl.set(p.id, []);
      styleByEl.get(p.id).push(p);
    } else if (p.type === 'attr') {
      // one attribute of one element: only the few the editor offers, with a value that cannot run anything
      if (!EDIT_ATTRS.has(p.name)) { errors.push({ patch: p, why: `attribute ${p.name} cannot be changed here` }); continue; }
      const after = String(p.after);
      if ((p.name === 'src' || p.name === 'href') && !URL_OK.test(after)) { errors.push({ patch: p, why: `"${after}" is not an address the editor accepts (web address, file next to the page, or #)` }); continue; }
      const st = node.sourceCodeLocation.startTag, loc = st.attrs && st.attrs[p.name];
      const was = node.attrs.find((a) => a.name === p.name);
      if ((was ? was.value : null) !== (p.before ?? null)) { errors.push({ patch: p, why: `the ${p.name} in the file is no longer what the editor saw` }); continue; }
      const text = `${p.name}="${escAttr(after)}"`;
      if (loc) edits.push({ start: loc.startOffset, end: loc.endOffset, text });
      else { const at = st.endOffset - (src[st.endOffset - 2] === '/' ? 2 : 1); edits.push({ start: at, end: at, text: ' ' + text }); }
      applied.push(p);
    } else errors.push({ patch: p, why: 'unknown patch type' });
  }
  for (const [id, list] of styleByEl) {
    const node = byId.get(id);
    const st = node.sourceCodeLocation.startTag;
    const attr = st.attrs && st.attrs.style;
    const existing = node.attrs.find((a) => a.name === 'style');
    const decls = existing ? declarations(existing.value) : [];
    for (const p of list) {
      const i = decls.findIndex(([k]) => k === p.prop);
      if (i >= 0) decls[i][1] = p.after; else decls.push([p.prop, p.after]);
      applied.push(p);
    }
    const value = decls.map(([k, v]) => `${k}: ${v}`).join('; ');
    const attrText = `style="${value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`;
    if (attr) edits.push({ start: attr.startOffset, end: attr.endOffset, text: attrText });
    else {
      const at = st.endOffset - (src[st.endOffset - 2] === '/' ? 2 : 1);
      edits.push({ start: at, end: at, text: ' ' + attrText });
    }
  }
  edits.sort((a, b) => b.start - a.start);
  for (let i = 1; i < edits.length; i++) if (edits[i].end > edits[i - 1].start) throw new Error('overlapping edits');
  let out = src;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return { out, applied, errors, edits: edits.length };
}

// ---- structure: move, duplicate, delete, add ---------------------------------------------
// Operations run one after the other, in the order the user made them, on a copy of the file
// where every element carries data-ky-i; the numbers are removed again at the end, so
// everything the operations did not touch stays byte-identical.
const LINE = 'rgba(128,128,128,.35)'
const IMG = 'style="max-width:100%;height:auto;border-radius:8px"'
// The words a new block carries into the page, and the names the « Add » panel shows, in the two languages of the product.
const WORDS = {
  fr: { title: 'Nouveau titre', subtitle: 'Nouveau sous-titre', text: 'Nouveau texte', p1: 'Premier point', p2: 'Deuxième point', p3: 'Troisième point', quote: 'Une citation à remplacer.', cap: "Légende de l'image", beside: "Texte à côté de l'image.", head: 'Titre', col: 'Colonne', colText: 'Texte de la colonne.', cardTitle: 'Titre de la carte', cardText: 'Texte de la carte.', sec: 'Nouvelle section', secText: 'Texte de la section.', btn: 'Nouveau bouton', link: 'Nouveau lien' },
  en: { title: 'New title', subtitle: 'New subtitle', text: 'New text', p1: 'First point', p2: 'Second point', p3: 'Third point', quote: 'A quote to replace.', cap: 'Picture caption', beside: 'Text next to the picture.', head: 'Title', col: 'Column', colText: 'Column text.', cardTitle: 'Card title', cardText: 'Card text.', sec: 'New section', secText: 'Section text.', btn: 'New button', link: 'New link' },
}
const COLS = (n, w) => `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(${n === 2 ? 240 : 180}px,1fr));gap:16px">` + Array.from({ length: n }, (_, i) => `<div><h3>${w.col} ${i + 1}</h3><p>${w.colText}</p></div>`).join('') + '</div>'
const GROUPS = { text: { fr: 'Texte', en: 'Text' }, images: { fr: 'Images', en: 'Pictures' }, layout: { fr: 'Mise en page', en: 'Layout' }, actions: { fr: 'Actions', en: 'Actions' } }
// What the editor offers under « Add »: {{src}} / {{alt}} are filled in with the picture chosen. Inline styles only where a block needs a
// layout of its own, so a block looks right in any maquette.
const BLOCK_DEFS = [
  { kind: 'title', group: 'text', label: { fr: 'Titre', en: 'Title' }, html: (w) => `<h2>${w.title}</h2>` },
  { kind: 'subtitle', group: 'text', label: { fr: 'Sous-titre', en: 'Subtitle' }, html: (w) => `<h3>${w.subtitle}</h3>` },
  { kind: 'text', group: 'text', label: { fr: 'Texte', en: 'Text' }, html: (w) => `<p>${w.text}</p>` },
  { kind: 'list', group: 'text', label: { fr: 'Liste', en: 'List' }, html: (w) => `<ul><li>${w.p1}</li><li>${w.p2}</li><li>${w.p3}</li></ul>` },
  { kind: 'quote', group: 'text', label: { fr: 'Citation', en: 'Quote' }, html: (w) => `<blockquote style="margin:0;padding:4px 0 4px 16px;border-left:3px solid ${LINE}">${w.quote}</blockquote>` },
  { kind: 'image', group: 'images', label: { fr: 'Image', en: 'Picture' }, needs: 'image', html: () => `<img src="{{src}}" alt="{{alt}}" ${IMG}>` },
  { kind: 'figure', group: 'images', label: { fr: 'Image + légende', en: 'Picture + caption' }, needs: 'image', html: (w) => `<figure style="margin:0"><img src="{{src}}" alt="{{alt}}" ${IMG}><figcaption style="margin-top:6px;opacity:.7;font-size:.9em">${w.cap}</figcaption></figure>` },
  { kind: 'imgtext', group: 'images', label: { fr: 'Image et texte', en: 'Picture and text' }, needs: 'image', html: (w) => `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;align-items:center"><img src="{{src}}" alt="{{alt}}" ${IMG}><div><h3>${w.head}</h3><p>${w.beside}</p></div></div>` },
  { kind: 'cols2', group: 'layout', label: { fr: '2 colonnes', en: '2 columns' }, html: (w) => COLS(2, w) },
  { kind: 'cols3', group: 'layout', label: { fr: '3 colonnes', en: '3 columns' }, html: (w) => COLS(3, w) },
  { kind: 'card', group: 'layout', label: { fr: 'Carte', en: 'Card' }, html: (w) => `<div style="border:1px solid ${LINE};border-radius:12px;padding:16px"><h3>${w.cardTitle}</h3><p>${w.cardText}</p></div>` },
  { kind: 'section', group: 'layout', label: { fr: 'Section', en: 'Section' }, html: (w) => `<section><h2>${w.sec}</h2><p>${w.secText}</p></section>` },
  { kind: 'divider', group: 'layout', label: { fr: 'Séparateur', en: 'Divider' }, html: () => `<hr style="border:0;border-top:1px solid ${LINE};margin:24px 0">` },
  { kind: 'button', group: 'actions', label: { fr: 'Bouton', en: 'Button' }, html: (w) => `<button type="button">${w.btn}</button>` },
  { kind: 'link', group: 'actions', label: { fr: 'Lien', en: 'Link' }, html: (w) => `<a href="#">${w.link}</a>` },
]
const langOf = (lang) => (lang === 'fr' ? 'fr' : 'en')
/** The blocks of the « Add » panel in one language: [{ kind, group, groupLabel, label, needs?, html }]. */
export const paletteFor = (lang) => { const l = langOf(lang); return BLOCK_DEFS.map((b) => ({ kind: b.kind, group: b.group, groupLabel: GROUPS[b.group][l], label: b.label[l], ...(b.needs ? { needs: b.needs } : {}), html: b.html(WORDS[l]) })) }
const blockHtml = (kind, lang) => { const b = BLOCK_DEFS.find((x) => x.kind === kind && !x.needs); return b ? b.html(WORDS[langOf(lang)]) : null }
export const fillBlock = (html, { src = '', alt = '' } = {}) => html.replace(/\{\{src\}\}/g, escAttr(src)).replace(/\{\{alt\}\}/g, escAttr(alt))

// A block sent by the editor is one element made of a short list of harmless tags and attributes. Anything else
// (script, an on… handler, javascript:, a stylesheet import) is refused, never silently dropped.
const OK_TAGS = new Set(['a', 'article', 'aside', 'b', 'blockquote', 'br', 'button', 'div', 'em', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'i', 'img', 'li', 'main', 'nav', 'ol', 'p', 'section', 'small', 'span', 'strong', 'sub', 'sup', 'u', 'ul']);
const OK_ATTRS = new Set(['class', 'style', 'href', 'src', 'alt', 'title', 'id', 'role', 'width', 'height']);
const BAD_STYLE = /url\s*\(|expression|@import|javascript:|[<>]/i;
// lenient = the markup is a copy of something already in the page (its svg icons, data-… and aria-… attributes, inline
// backgrounds): everything is accepted except what can run (script, frames, on… handlers, javascript:) or pull code in.
const BAD_TAGS = new Set(['script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'link', 'meta', 'base', 'template', 'noscript', 'title', 'head', 'html', 'body']);
const BAD_STYLE_LENIENT = /expression|@import|javascript:|[<>]/i;
export function cleanFragment(html, { lenient = false } = {}) {
  const frag = parseFragment(html);
  const els = frag.childNodes.filter((n) => n.nodeName !== '#text' || n.value.trim());
  if (els.length !== 1 || els[0].nodeName.startsWith('#')) return { error: 'a block is exactly one element' };
  let bad = null;
  (function walk(n) {
    if (bad || n.nodeName === '#text') return;
    if (n.nodeName.startsWith('#')) { bad = 'comments are not allowed in a block'; return; }
    if (lenient ? BAD_TAGS.has(n.nodeName) : !OK_TAGS.has(n.nodeName)) { bad = `<${n.nodeName}> is not allowed in a block`; return; }
    for (const a of n.attrs) {
      if (lenient) {
        if (/^on/i.test(a.name) || ['srcdoc', 'formaction'].includes(a.name)) { bad = `attribute ${a.name} is not allowed in a block`; return; }
        if (['href', 'src', 'xlink:href', 'action', 'poster'].includes(a.name) && !URL_OK.test(a.value) && !/^data:image\/(png|jpeg|gif|webp|svg\+xml)[;,]/i.test(a.value)) { bad = `"${a.value.slice(0, 40)}" is not an address the editor accepts`; return; }
        if (a.name === 'style' && BAD_STYLE_LENIENT.test(a.value)) { bad = 'this style is not allowed in a block'; return; }
        continue;
      }
      if (a.name.startsWith('aria-')) continue;
      if (!OK_ATTRS.has(a.name) && !(a.name === 'type' && n.nodeName === 'button' && a.value === 'button')) { bad = `attribute ${a.name} is not allowed in a block`; return; }
      if ((a.name === 'href' || a.name === 'src') && !URL_OK.test(a.value)) { bad = `"${a.value}" is not an address the editor accepts`; return; }
      if (a.name === 'style' && BAD_STYLE.test(a.value)) { bad = 'this style is not allowed in a block'; return; }
    }
    n.childNodes.forEach(walk);
  })(els[0]);
  return bad ? { error: bad } : { out: serialize(frag).trim() };
}
const NO_STRUCT = new Set(['html', 'head', 'body', 'script', 'style', 'link', 'meta', 'title', 'base']);
const NO_REF = new Set(['html', 'head', 'title', 'meta', 'link', 'style', 'base']);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const KY = / data-ky-i="[^"]*"/g;

const attrOf = (n, name) => { const a = n.attrs && n.attrs.find((x) => x.name === name); return a ? a.value : null; };
function locate(s) {
  const doc = parse(s, { sourceCodeLocationInfo: true });
  const byKy = new Map();
  (function walk(n) {
    const v = attrOf(n, 'data-ky-i'); if (v !== null) byKy.set(v, n);
    const kids = n.content ? n.content.childNodes : n.childNodes; if (kids) kids.forEach(walk);
  })(doc);
  return byKy;
}
const inHead = (n) => { for (let p = n.parentNode; p; p = p.parentNode) if (p.nodeName === 'head') return true; return false; };
const lineStart = (s, p) => s.lastIndexOf('\n', p - 1) + 1;
const lineEnd = (s, p) => { const i = s.indexOf('\n', p); return i < 0 ? s.length : i; };
const blank = (t) => !t.trim();
const ownLine = (s, a, b) => blank(s.slice(lineStart(s, a), a)) && blank(s.slice(b, lineEnd(s, b)));

function removeEdit(s, node) {
  const { startOffset: a, endOffset: b } = node.sourceCodeLocation;
  if (!ownLine(s, a, b)) return { start: a, end: b, text: '' };
  let le = lineEnd(s, b); if (le < s.length) le += 1;
  return { start: lineStart(s, a), end: le, text: '' };
}
function insertEdit(s, node, where, t) {
  const L = node.sourceCodeLocation, a = L.startOffset, b = L.endOffset;
  if (where === 'inside') {
    const ea = L.endTag && L.endTag.startOffset;
    if (ea === undefined) return { error: 'this element has no closing tag in the file, so nothing can be put inside it' };
    const ls = lineStart(s, ea);
    if (blank(s.slice(ls, ea))) return { start: ls, end: ls, text: s.slice(ls, ea) + '  ' + t + '\n' };
    return { start: ea, end: ea, text: t };
  }
  if (ownLine(s, a, b)) {
    const ind = s.slice(lineStart(s, a), a);
    if (where === 'before') { const p = lineStart(s, a); return { start: p, end: p, text: ind + t + '\n' }; }
    const le = lineEnd(s, b);
    return le < s.length ? { start: le + 1, end: le + 1, text: ind + t + '\n' } : { start: s.length, end: s.length, text: '\n' + ind + t };
  }
  const p = where === 'before' ? a : b;
  return { start: p, end: p, text: t };
}
function applyEdits(s, edits) {
  const e = [...edits].sort((x, y) => y.start - x.start || (y.end - y.start) - (x.end - x.start));
  let out = s; for (const k of e) out = out.slice(0, k.start) + k.text + out.slice(k.end);
  return out;
}
function withNewId(markup, newId) {
  const m = /^<[a-zA-Z][^\s/>]*/.exec(markup);
  return m ? m[0] + ` data-ky-i="${newId}"` + markup.slice(m[0].length) : markup;
}

function oneOp(s, op, notes) {
  const m = locate(s);
  const node = m.get(String(op.id));
  const where = op.where;
  let markup = null;
  if (op.op === 'add') {
    if (op.html !== undefined) { const c = cleanFragment(String(op.html), { lenient: !!op.lenient }); if (c.error) return { error: c.error }; markup = c.out; }
    else if (blockHtml(op.kind, op.lang)) markup = blockHtml(op.kind, op.lang);
    else return { error: `unknown block kind ${op.kind}` };
  } else {
    if (!node) return { error: 'element not found in the file (built by a script, removed earlier, or the file changed)' };
    if (NO_STRUCT.has(node.nodeName) || inHead(node)) return { error: `<${node.nodeName}> cannot be moved, copied or removed here` };
  }
  if (op.op === 'del') return { out: applyEdits(s, [removeEdit(s, node)]) };

  let ref = null;
  if (op.op === 'move' || op.op === 'add') {
    ref = m.get(String(op.ref));
    if (!ref) return { error: 'the target element is not in the file' };
    if (!['before', 'after', 'inside'].includes(where)) return { error: 'where must be before, after or inside' };
    if (NO_REF.has(ref.nodeName) || inHead(ref)) return { error: `nothing can be put next to <${ref.nodeName}>` };
    if (where === 'inside' && VOID.has(ref.nodeName)) return { error: `<${ref.nodeName}> cannot hold anything` };
  }
  if (op.op === 'move') {
    if (ref === node) return { error: 'an element cannot be moved onto itself' };
    const A = node.sourceCodeLocation, B = ref.sourceCodeLocation;
    if (B.startOffset >= A.startOffset && B.endOffset <= A.endOffset) return { error: 'an element cannot be moved inside itself' };
    const ins = insertEdit(s, ref, where, s.slice(A.startOffset, A.endOffset));
    if (ins.error) return ins;
    return { out: applyEdits(s, [removeEdit(s, node), ins]) };
  }
  if (op.op === 'dup') {
    if (!op.newId || m.has(String(op.newId))) return { error: 'the copy needs a new unique id' };
    const A = node.sourceCodeLocation;
    let copy = s.slice(A.startOffset, A.endOffset).replace(KY, '');
    copy = copy.replace(/(\sid=)(["'])([^"']*)\2/g, (_, a, q, v) => { notes.push(`id "${v}" became "${v}-copy" (the copy is not wired to the page script)`); return `${a}${q}${v}-copy${q}`; });
    const ins = insertEdit(s, node, 'after', withNewId(copy, op.newId));
    if (ins.error) return ins;
    return { out: applyEdits(s, [ins]) };
  }
  if (op.op === 'add') {
    if (!op.newId || m.has(String(op.newId))) return { error: 'the new block needs a unique id' };
    const ins = insertEdit(s, ref, where, withNewId(markup, op.newId));
    if (ins.error) return ins;
    return { out: applyEdits(s, [ins]) };
  }
  return { error: `unknown operation ${op.op}` };
}

// ops: [{op:'move', id, ref, where} | {op:'dup', id, newId} | {op:'del', id} | {op:'add', kind | html, ref, where, newId}]
export function applyStructure(src, ops) {
  const errors = [], applied = [], notes = [];
  let s = instrument(src);
  for (const op of ops) {
    const r = oneOp(s, op, notes);
    if (r.error) errors.push({ patch: op, why: r.error }); else { s = r.out; applied.push(op); }
  }
  return { out: s.replace(KY, ''), applied, errors, notes };
}

// ---- text the page builds from its own data files -----------------------------------------------
// A text on screen that is not written in the html usually sits in a data file as a string literal
// ({"d":"Gmail is Google's..."}). It is changed there, only when the whole literal is found as it is;
// when the page composes it ("Relier " + name) nothing is found and the change is refused, never guessed.
export const TEXT_CAP = 50;
const asciiOnly = (s) => s.replace(/[\u0080-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const single = (s) => "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r') + "'";
function variants(text) {
  const all = [
    { lit: JSON.stringify(text), enc: (a) => JSON.stringify(a) },
    { lit: asciiOnly(JSON.stringify(text)), enc: (a) => asciiOnly(JSON.stringify(a)) },
    { lit: single(text), enc: single },
  ];
  return all.filter((v, i) => all.findIndex((w) => w.lit === v.lit) === i);
}
function scriptRegions(name, content) {
  if (!/\.html?$/i.test(name)) return [[0, content.length]];
  const out = [];
  for (const n of index(content).byId.values()) {
    if (n.nodeName !== 'script') continue;
    const t = n.childNodes.find((c) => c.nodeName === '#text');
    if (t && t.sourceCodeLocation) out.push([t.sourceCodeLocation.startOffset, t.sourceCodeLocation.endOffset]);
  }
  return out;
}
// files: {name: text} of the html, js and json files of the maquette
export function findLiterals(files, text) {
  const hits = [];
  if (typeof text !== 'string' || text.trim().length < 2) return hits;
  const vs = variants(text);
  for (const [name, content] of Object.entries(files)) {
    for (const [a, b] of scriptRegions(name, content)) {
      for (const v of vs) {
        let i = a;
        while ((i = content.indexOf(v.lit, i)) !== -1 && i + v.lit.length <= b) {
          const end = i + v.lit.length;
          if (!/^\s*:/.test(content.slice(end, end + 8))) hits.push({ file: name, start: i, end, v });   // "d": is a key, not a text
          i = end;
        }
      }
    }
  }
  return hits;
}
export function applySrcText(files, patches) {
  const out = { ...files }, applied = [], errors = [], touched = new Set();
  for (const p of patches) {
    if (typeof p.before !== 'string' || typeof p.after !== 'string' || p.after.length > 5000) { errors.push({ patch: p, why: 'this text change is not valid' }); continue; }
    const hits = findLiterals(out, p.before);
    if (!hits.length) { errors.push({ patch: p, why: 'this text is not written as it is in any file of the maquette (the page composes it): nothing changed' }); continue; }
    if (hits.length > TEXT_CAP) { errors.push({ patch: p, why: `this text appears ${hits.length} times in the data: too many to change at once` }); continue; }
    const byFile = {};
    for (const h of hits) (byFile[h.file] ||= []).push(h);
    if (/<\/script/i.test(p.after) && Object.keys(byFile).some((f) => /\.html?$/i.test(f))) { errors.push({ patch: p, why: 'a text with </script cannot be written into the page' }); continue; }
    for (const [f, hs] of Object.entries(byFile)) {
      let t = out[f];
      for (const h of hs.sort((x, y) => y.start - x.start)) t = t.slice(0, h.start) + h.v.enc(p.after) + t.slice(h.end);
      out[f] = t; touched.add(f);
    }
    applied.push({ ...p, places: hits.length });
  }
  return { files: out, applied, errors, touched: [...touched] };
}
