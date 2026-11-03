// The deck runtime: the slides of a Kybernos deck (navigation, steps, transitions, grid and presenter views, charts) and, when `edit` is set, the editing layer
// (one Tiptap editor per text box, formatting bar, bubble and « / » menu, blocks and slides). Ported from the HTML deck of the 2026-11-03 office spike.
//   start({ edit, framed, tiptap, lang, onTouch })  -> { setEditing, slidesHtml, commitAll, syncEditors, editing }
// `framed`: the deck runs in the sandboxed editor frame of the DSH page (no window, no fullscreen, no print, no download: the page around saves).
// `onTouch()`: called when the person changed something (the page enables « Save »).
import { T, getLang, setLang } from './i18n.js'
import { ICONS } from './icons.js'
import { chromeHtml } from './chrome.js'
import { drawChart } from './charts.js'

export function start (opts = {}) {
const EDIT = opts.edit === true, FRAMED = opts.framed === true, KBTip = opts.tiptap || null;
const touch = typeof opts.onTouch === 'function' ? opts.onTouch : () => {};
if (opts.lang) setLang(opts.lang);
if (!document.getElementById('bar')) document.body.insertAdjacentHTML('beforeend', chromeHtml({ edit: EDIT, framed: FRAMED }));
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
/* an element of the editing chrome, or a detached stand-in when this build has none (so wiring and reads never fail) */
const E = s => $(s) || document.createElement('div');
const deck = $('#deck');
let cells, N, maxStep;
const indexCells = () => {
  cells = $$('.cell'); N = cells.length; maxStep = cells.map(c => Math.max(0, ...$$('.frag', c).map(f => +f.dataset.step || 0)));
  cells.forEach((c, k) => { c.dataset.n = k + 1; const sl = $('.slide', c); if (sl) sl.setAttribute('aria-label', T('Slide') + ' ' + (k + 1)); });
};
indexCells();
const presenter = !FRAMED && new URLSearchParams(location.search).has('presenter');
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
let cur = -1, step = 0, editing = false, bc = null;
if (!FRAMED) { try { bc = new BroadcastChannel('kb-deck'); } catch (e) { /* no sync between windows */ } }
$$('.chart').forEach(el => { try { drawChart(el); } catch (e) { /* a chart with broken data stays empty */ } });

/* ---------- steps, transitions, navigation ---------- */
function setFrags(cell, s, animate) {
  $$('.frag', cell).forEach(f => {
    const on = (+f.dataset.step || 0) <= s;
    f.style.setProperty('--d', animate && on ? (f.dataset.delay || 0) + 'ms' : '0ms');
    f.classList.toggle('on', on);
  });
}
function transition(inc, out, type, dir) {
  if (reduce || !out || inc === out) { if (out) out.classList.remove('leaving', 'cur'); return; }
  inc.style.zIndex = 2; out.style.zIndex = 1; const o = { duration: 450, easing: 'ease', fill: 'none' };
  const done = () => { out.classList.remove('leaving'); inc.style.zIndex = out.style.zIndex = ''; };
  if (type === 'push') { inc.animate([{ transform: `translateX(${100 * dir}%)` }, { transform: 'none' }], o); out.animate([{ transform: 'none' }, { transform: `translateX(${-100 * dir}%)` }], o).onfinish = done; }
  else if (type === 'wipe') { inc.animate([{ clipPath: dir > 0 ? 'inset(0 100% 0 0)' : 'inset(0 0 0 100%)' }, { clipPath: 'inset(0)' }], o).onfinish = done; }
  else { inc.animate([{ opacity: 0 }, { opacity: 1 }], o).onfinish = done; }
}
function go(i, s, opts = {}) {
  i = Math.max(0, Math.min(N - 1, i)); const out = cur >= 0 ? cells[cur] : null, inc = cells[i], dir = i >= cur ? 1 : -1;
  const changed = i !== cur;
  if (changed) commitAll();
  if (changed) {
    if (out) { out.classList.add('leaving'); out.classList.remove('cur'); }
    inc.classList.add('cur'); setFrags(inc, s, false);
    if (!document.body.classList.contains('grid') && !presenter) transition(inc, out, $('.slide', inc).dataset.transition, dir); else if (out) out.classList.remove('leaving');
  } else setFrags(inc, s, true);
  cur = i; step = s; selEl = null; drawSel();
  if (changed) syncEditors();
  $('#cnt').textContent = (i + 1) + ' / ' + N;
  if (!FRAMED) { try { history.replaceState(null, '', (presenter ? '?presenter' : location.pathname.split('/').pop() || '') + '#' + (i + 1) + (s ? '.' + s : '')); } catch (e) { /* no history here */ } }
  cells.forEach((c, k) => c.dataset.n = k + 1);
  if (editing) E('#nbt').textContent = $('.notes', inc).textContent;
  if (presenter) renderPresenter();
  if (!opts.silent && bc) bc.postMessage({ i, s });
}
const next = () => step < maxStep[cur] ? go(cur, step + 1) : cur < N - 1 && go(cur + 1, 0);
const prev = () => step > 0 ? go(cur, step - 1) : cur > 0 && go(cur - 1, maxStep[cur - 1]);
if (bc) bc.onmessage = e => { if (e.data && 'i' in e.data) go(e.data.i, e.data.s, { silent: true }); };

/* ---------- fit, grid, fullscreen, print ---------- */
function fit() { const bot = editing ? 114 : 44, top = editing ? 96 : 0; deck.style.setProperty('--k', Math.min(innerWidth / 1280, (innerHeight - bot - top) / 720)); }
addEventListener('resize', fit);
const toggleGrid = on => { document.body.classList.toggle('grid', on); syncDraggable(); selEl = null; drawSel(); syncEditors(); if (on) setFrags(cells[cur], 99, false); else { setFrags(cells[cur], step, false); fit(); } };
E('#b-grid').onclick = () => toggleGrid(!document.body.classList.contains('grid'));
E('#b-fs').onclick = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
E('#b-print').onclick = () => print();
E('#b-prev').onclick = prev; E('#b-next').onclick = next;
deck.addEventListener('click', e => {
  const cell = e.target.closest('.cell');
  if (document.body.classList.contains('grid') && cell) { if (editing) { go(cells.indexOf(cell), 0); return; } toggleGrid(false); go(cells.indexOf(cell), 0); return; }
  if (editing || e.target.closest('a')) return; next();
});

deck.addEventListener('dblclick', e => { const cell = e.target.closest('.cell'); if (document.body.classList.contains('grid') && cell) { toggleGrid(false); go(cells.indexOf(cell), 0); } });
/* ---------- presenter view (second window, same file) ---------- */
function thumb(host, i, s, w) {
  host.style.width = w + 'px'; host.style.height = (w * 9 / 16) + 'px'; host.innerHTML = '';
  if (i < 0 || i >= N) { host.innerHTML = '<div style="color:#8f9bc4;padding:20px;font:16px system-ui">' + T('End of the presentation') + '</div>'; return; }
  const inner = document.createElement('div'); inner.style.cssText = `position:absolute;left:0;top:0;width:1280px;height:720px;transform:scale(${w / 1280});transform-origin:0 0`;
  const sl = $('.slide', cells[i]).cloneNode(true); $$('.frag', sl).forEach(f => f.classList.toggle('on', (+f.dataset.step || 0) <= s)); inner.append(sl); host.append(inner);
}
let t0 = Date.now(), tick = null;
function renderPresenter() {
  const pv = $('#pv');
  if (!pv.firstChild) {
    pv.innerHTML = '<div><h2>' + T('Current slide') + '</h2><div class="th" id="p-cur"></div><div class="info"><span id="p-n"></span><span id="p-t" title="' + T('Click to reset to zero') + '"></span></div><button id="p-prev">◀ ' + T('Previous') + '</button><button id="p-next">' + T('Next') + ' ▶</button></div><div><h2>' + T('Next slide') + '</h2><div class="th" id="p-next-th"></div><h2 style="margin-top:18px">' + T('Notes') + '</h2><div class="notes2" id="p-notes"></div></div>';
    $('#p-prev').onclick = prev; $('#p-next').onclick = next; $('#p-t').onclick = () => { t0 = Date.now(); };
    tick = setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); $('#p-t').textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }, 500);
  }
  thumb($('#p-cur'), cur, step, Math.min(760, innerWidth * .55)); thumb($('#p-next-th'), step < maxStep[cur] ? cur : cur + 1, step < maxStep[cur] ? step + 1 : 0, Math.min(420, innerWidth * .3));
  $('#p-n').textContent = T('Slide') + ' ' + (cur + 1) + ' / ' + N + (maxStep[cur] ? ' · ' + T('step') + ' ' + step + '/' + maxStep[cur] : '');
  $('#p-notes').textContent = $('.notes', cells[cur]).textContent;
}
E('#b-pres').onclick = () => open(location.pathname.split('/').pop() + '?presenter#' + (cur + 1), 'kb-presenter', 'width=1200,height=760');
if (presenter) { document.body.classList.add('pres'); document.title = T('Presenter') + ' · ' + document.title; addEventListener('resize', () => renderPresenter()); }

/* ---------- edit mode, notes, save ---------- */
function setEditing(on) {
  editing = on; document.body.classList.toggle('editing', on);
  syncEditors(); syncDraggable(); if (on && !KBTip) toast(T('The text editor is not available in this file.'));
  E('#b-edit').textContent = on ? T('Done') : T('Edit'); selEl = null; drawSel(); closePop();
  if (on) { setFrags(cells[cur], 99, false); E('#nbt').textContent = $('.notes', cells[cur]).textContent; } else setFrags(cells[cur], step, false);
  fit();
}
E('#b-edit').onclick = () => setEditing(!editing);
E('#nbt').addEventListener('input', () => { $('.notes', cells[cur]).textContent = E('#nbt').textContent; touch(); });
deck.addEventListener('click', e => { if (editing && e.target.closest('a')) e.preventDefault(); }, true);
const PALETTE = ['#1E2761', '#D4A843', '#F2F5FB', '#7A8A94', '#3A6EA5', '#CADCFC', '#FFFFFF', '#333333', '#000000', '#C0392B', '#2E8B57', '#E8EEF9'];
const BLOCKS = '.b, .pic, .chart, .t, h1', TEXT_BOXES = '[data-e]:not(.notes)';
const fmtBar = E('#fmt'), pop = E('#pop'), msg = E('#f-msg'), bubble = E('#bubble'), slashEl = E('#slash');
const SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 45, 48, 56, 64, 72, 84, 96, 120], LS = [1, 1.2, 1.5, 2];
let selEl = null, popKind = null, msgTimer = null, pdown = false, active = null;
const eds = new Set();
const curSlide = () => $('.slide', cells[cur]);
const kscale = () => parseFloat(deck.style.getPropertyValue('--k')) || 1;
const parentEl = n => (n && n.nodeType === 3 ? n.parentElement : n);
const norm = s => s.normalize('NFD').replace(/[^\x00-\x7f]/g, '').toLowerCase();
const cssSet = (s, p, v) => {
  const m = new Map((s || '').split(';').map(x => { const i = x.indexOf(':'); return i < 0 ? [] : [x.slice(0, i).trim(), x.slice(i + 1).trim()]; }).filter(x => x[0]));
  if (v == null) m.delete(p); else m.set(p, v);
  return [...m].map(([k, x]) => k + ':' + x).join(';') || null;
};
function toast(text, label, fn) {
  if (!EDIT) return;
  clearTimeout(msgTimer); msg.textContent = text + ' ';
  if (label) { const b = document.createElement('button'); b.textContent = label; b.onclick = () => { fn(); msg.textContent = ''; }; msg.append(b); }
  msgTimer = setTimeout(() => { msg.textContent = ''; }, 8000);
}

/* one Tiptap editor per text box of the slide on screen; closing it writes clean HTML back into the box */
const edFor = el => [...eds].find(e => e.kb.el === el);
function curEd() {
  if (selEl) { const e = edFor(selEl); if (e) return e; if (active && eds.has(active) && selEl.contains(active.kb.el)) return active; }
  return active && eds.has(active) && active.view.hasFocus() ? active : null;
}
function needEd() { const ed = curEd(); if (!ed) toast(T('Click in a text first.')); return ed; }
function mountBox(el) {
  if (!KBTip || edFor(el)) return;
  const rich = el.matches('.b');
  eds.add(KBTip.mount(el, {
    rich, placeholder: T('Type “/” to add…'), onUpdate: () => touch(), slash: rich ? SLASH : null,
    onFocus: e => { active = e; e.kb.touched = true; syncFmt(); placeBubble(); },
    onBlur: () => setTimeout(placeBubble, 0),
    onChange: e => { if (e === active) { syncFmt(); placeBubble(); } },
  }));
}
function commitAll() { hideBubble(); slashHide(); closePop(); eds.forEach(e => KBTip.close(e)); eds.clear(); active = null; }
function syncEditors() { commitAll(); if (editing && !document.body.classList.contains('grid') && cells[cur]) $$(TEXT_BOXES, cells[cur]).forEach(mountBox); }

/* commands: a selection gets the mark, a caret (or a box picked by its handle) gets the whole line (or box) */
const paraStyle = (prop, val) => ({ tr, state }) => {
  state.doc.nodesBetween(state.selection.from, state.selection.to, (n, pos) => { if (n.type.name === 'paragraph') tr.setNodeMarkup(pos, null, { ...n.attrs, style: cssSet(n.attrs.style, prop, val) }); });
  return true;
};
function scoped(ed, fn) {
  const sel = ed.state.selection, whole = !ed.kb.touched, c = ed.chain().focus();
  if (whole) c.selectAll(); else if (sel.empty) c.setTextSelection({ from: sel.$from.start(), to: sel.$from.end() });
  fn(c, !whole && !sel.empty);
  if (whole || sel.empty) c.setTextSelection(Math.max(1, sel.from));
  c.run(); syncFmt();
}
const TOGGLE = { bold: 'toggleBold', italic: 'toggleItalic', underline: 'toggleUnderline', strike: 'toggleStrike' };
function textCmd(name) {
  const ed = needEd(); if (!ed) return;
  if (name === 'bold' && !ed.isActive('bold') && (ed.state.selection.empty || !ed.kb.touched)) { /* a line that is bold by its own style: switch that style */
    const s = getSelection(), el = s.rangeCount && ed.kb.el.contains(s.anchorNode) ? parentEl(s.anchorNode) : ed.kb.el;
    if (parseInt(getComputedStyle(el).fontWeight, 10) >= 600) return scoped(ed, c => c.command(paraStyle('font-weight', '400')));
  }
  scoped(ed, c => c[TOGGLE[name]]());
}
function setSize(px) { const ed = needEd(); if (ed) scoped(ed, (c, marks) => { if (marks) c.setFontSize(px + 'px'); else c.unsetFontSize().command(paraStyle('font-size', px + 'px')); }); }
function applyColor(kind, c) {
  if (kind === 'text') { const ed = needEd(); if (ed) scoped(ed, (ch, marks) => { if (!c) ch.unsetColor(); else if (marks) ch.setColor(c); else ch.unsetColor().command(paraStyle('color', c)); }); return; }
  if (kind === 'hl') { const ed = needEd(); if (ed) scoped(ed, ch => (c ? ch.setBackgroundColor(c) : ch.unsetBackgroundColor())); return; }
  if (kind === 'bg') { curSlide().style.background = c || ''; touch(); return; }
  if (!selEl) return toast(T('Select a block first.'));
  if (selEl.classList.contains('t')) $$('td', selEl).forEach(td => { td.style.background = c || ''; }); else selEl.style.background = c || 'transparent';
  touch();
}
function alignTo(v) {
  const ed = needEd(); if (!ed) return; const box = ed.kb.el, ctr = box.classList.contains('ctr');
  if (ctr) { box.style.textAlign = v; box.style.alignItems = { left: 'flex-start', center: 'center', right: 'flex-end' }[v]; }
  const c = ed.chain().focus(); if (ctr || !ed.kb.touched) c.selectAll();
  c.command(paraStyle('text-align', ctr ? null : v)).run(); syncFmt(); touch();
}
function cycleSpacing() {
  const ed = needEd(); if (!ed) return; const box = ed.kb.el;
  const nxt = LS[(LS.indexOf(parseFloat(box.dataset.ls || 1.2)) + 1) % LS.length]; box.dataset.ls = nxt; box.style.lineHeight = nxt;
  ed.chain().command(({ tr, state }) => { state.doc.descendants((n, pos) => { if (n.type.name === 'paragraph') tr.setNodeMarkup(pos, null, { ...n.attrs, style: cssSet(n.attrs.style, 'line-height', nxt) }); }); return true; }).run();
  toast(T('Line spacing') + ' ' + String(nxt).replace('.', getLang() === 'fr' ? ',' : '.')); touch();
}
function act(a) {
  const ed = needEd(); if (!ed) return; const c = ed.chain().focus();
  if (a === 'undo') c.undo().run(); else if (a === 'redo') c.redo().run();
  else if (c.toggleBulletList) { c.toggleBulletList().run(); syncFmt(); } else toast(T('No list in this text.'));
}
function syncFmt() {
  if (!editing) return; const ed = curEd();
  $$('[data-cmd]').forEach(b => b.classList.toggle('act', !!(ed && ed.isActive(b.dataset.cmd))));
  $$('[data-act="list"]').forEach(b => b.classList.toggle('act', !!(ed && ed.isActive('bulletList'))));
  const s = getSelection(), el = ed ? (s.rangeCount && ed.kb.el.contains(s.anchorNode) ? parentEl(s.anchorNode) : ed.kb.el) : selEl;
  if (!el || !el.isConnected) return;
  const cs = getComputedStyle(el); let ta = cs.textAlign; if (ta === 'start') ta = 'left'; if (ta === 'end') ta = 'right';
  E('#f-sizev').textContent = Math.round(parseFloat(cs.fontSize));
  $$('[data-align]').forEach(b => b.classList.toggle('act', b.dataset.align === ta));
  fmtBar.style.setProperty('--c', cs.color); bubble.style.setProperty('--c', cs.color);
}

/* popovers: colours, sizes, new-slide menu */
function openPop(kind, btn) {
  if (popKind === kind && pop.classList.contains('on')) return closePop(); popKind = kind;
  if (kind === 'newslide') pop.innerHTML = [['text', 'layout', T('Title and text')], ['section', 'heading', T('Section (title on a dark background)')], ['blank', 'blank', T('Blank slide')]].map(([l, i, t]) => `<button class="tt-btn mi" data-layout="${l}">${ICONS[i]} ${t}</button>`).join('');
  else if (kind === 'size') pop.innerHTML = SIZES.map(v => `<button class="tt-btn mi" data-size="${v}">${v} px</button>`).join('');
  else pop.innerHTML = PALETTE.map(c => `<button class="swc" data-c="${c}" style="background:${c}" title="${c}"></button>`).join('')
    + `<button class="swc" data-c="" title="${kind === 'text' ? T('Original colour') : T('None')}">∅</button><label class="cust">${T('Other colour')} <input type="color" value="#1E2761"></label>`;
  const r = btn.getBoundingClientRect(); pop.style.width = kind === 'size' ? '150px' : kind === 'newslide' ? '290px' : ''; pop.style.maxHeight = kind === 'size' ? '300px' : '';
  pop.style.overflowY = kind === 'size' ? 'auto' : ''; pop.style.left = Math.max(8, Math.min(r.left, innerWidth - 300)) + 'px'; pop.style.top = r.bottom + 6 + 'px'; pop.classList.add('on');
}
function closePop() { popKind = null; pop.classList.remove('on'); }
function onBar(e) {
  const b = e.target.closest('button'); if (!b) return; const d = b.dataset;
  if (d.cmd) textCmd(d.cmd); else if (d.align) alignTo(d.align); else if (d.act) act(d.act); else if (b.id === 'f-ls') cycleSpacing();
  else if (d.size) { setSize(+d.size); closePop(); } else if (d.pop) openPop(d.pop, b);
  else if (d.layout) { addSlide(d.layout); closePop(); } else if (b.classList.contains('swc')) { applyColor(popKind, d.c); closePop(); }
}
[fmtBar, bubble, pop].forEach(n => { n.addEventListener('mousedown', e => { if (!e.target.closest('input, select')) e.preventDefault(); }); n.addEventListener('click', onBar); });
pop.addEventListener('input', e => { if (e.target.type === 'color') applyColor(popKind, e.target.value); });

/* bubble menu over a text selection */
function hideBubble() { bubble.classList.remove('on'); }
function placeBubble() {
  const ed = curEd();
  if (!editing || !ed || pdown || !ed.view.hasFocus() || ed.state.selection.empty) return hideBubble();
  const { from, to } = ed.state.selection, a = ed.view.coordsAtPos(from), b = ed.view.coordsAtPos(to);
  bubble.classList.add('on'); const w = bubble.offsetWidth, h = bubble.offsetHeight;
  const oneLine = Math.abs(a.top - b.top) < 4, box = ed.kb.el.getBoundingClientRect();
  const cx = oneLine ? (Math.min(a.left, b.left) + Math.max(a.right, b.right)) / 2 : (box.left + box.right) / 2;
  let y = Math.min(a.top, b.top) - h - 10; if (y < 104) y = Math.max(a.bottom, b.bottom) + 10;
  bubble.style.left = Math.max(8, Math.min(cx - w / 2, innerWidth - w - 8)) + 'px'; bubble.style.top = y + 'px';
}
addEventListener('pointerdown', e => { pdown = true; if (!e.target.closest('#bubble, #pop')) { hideBubble(); if (!e.target.closest('#fmt')) closePop(); } }, true);
addEventListener('pointerup', () => { pdown = false; setTimeout(placeBubble, 0); }, true);

/* "/" menu: add things without leaving the keyboard */
const SLASH_ITEMS = [
  { g: T('Text'), t: T('Bulleted list'), d: T('A simple list'), k: 'bullet list puces liste', i: 'list', run: ed => ed.chain().focus().toggleBulletList().run() },
  { g: T('Text'), t: T('Plain text'), d: T('Removes the list'), k: 'normal paragraph paragraphe', i: 'type', run: ed => ed.chain().focus().liftListItem('listItem').run() },
  { g: T('Insert'), t: T('Image'), d: T('Choose a file'), k: 'photo picture image', i: 'image', run: () => E('#f-img').click() },
  { g: T('Insert'), t: T('Text box'), d: T('A new block of text'), k: 'text box texte bloc', i: 'type', run: () => addBlock(false) },
  { g: T('Insert'), t: T('Shape'), d: T('A coloured rectangle'), k: 'shape rectangle square forme carre', i: 'square', run: () => addBlock(true) },
  { g: T('Slides'), t: T('New slide'), d: T('Title and text, after this one'), k: 'slide page add ajouter', i: 'layout', run: () => addSlide('text') },
  { g: T('Slides'), t: T('New section'), d: T('Title on a dark background'), k: 'section chapter chapitre', i: 'heading', run: () => addSlide('section') },
  { g: T('Slides'), t: T('Blank slide'), d: T('An empty page'), k: 'blank empty blanche vide', i: 'blank', run: () => addSlide('blank') },
  { g: T('Slides'), t: T('Duplicate the slide'), d: T('A copy right after'), k: 'copy duplicate copier', i: 'copy', run: () => dupSlide() },
  { g: T('Block'), t: T('Duplicate this block'), d: T('An offset copy'), k: 'copy duplicate copier', i: 'copy', run: () => dupBlock() },
  { g: T('Block'), t: T('Delete this block'), d: T('With “Undo” right after'), k: 'delete remove effacer supprimer', i: 'trash', run: () => deleteBlock() },
];
let slashProps = null, slashIdx = 0;
const SLASH = {
  items: ({ query }) => { const q = norm(query), hit = it => norm(it.t + ' ' + it.k).includes(q), first = it => (norm(it.t).startsWith(q) ? 0 : 1); return q ? SLASH_ITEMS.filter(hit).sort((a, b) => first(a) - first(b)) : SLASH_ITEMS; },
  command: ({ editor, range, props }) => { editor.chain().focus().deleteRange(range).run(); selEl = editor.kb.el; setTimeout(() => props.run(editor), 0); },
  render: () => ({ onStart: slashShow, onUpdate: slashShow, onKeyDown: ({ event }) => slashKey(event), onExit: slashHide }),
};
function slashShow(p) {
  slashProps = p; const items = p.items; if (slashIdx >= items.length) slashIdx = 0; let h = '', g = '';
  items.forEach((it, i) => { if (it.g !== g) { g = it.g; h += `<div class="sl-g">${g}</div>`; } h += `<button class="sl-it${i === slashIdx ? ' sel' : ''}" data-i="${i}" role="option"><span class="sl-ic">${ICONS[it.i]}</span><span><span class="sl-tt">${it.t}</span><span class="sl-d">${it.d}</span></span></button>`; });
  slashEl.innerHTML = h || '<div class="sl-none">' + T('Nothing matches') + '</div>';
  const r = p.clientRect && p.clientRect(); if (!r) return; slashEl.classList.add('on');
  const w = slashEl.offsetWidth, hh = slashEl.offsetHeight; let y = r.bottom + 8; if (y + hh > innerHeight - 8) y = Math.max(104, r.top - hh - 8);
  slashEl.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px'; slashEl.style.top = y + 'px';
  const sel = $('.sel', slashEl); if (sel) sel.scrollIntoView({ block: 'nearest' });
}
function slashHide() { slashProps = null; slashIdx = 0; slashEl.classList.remove('on'); }
function slashKey(ev) {
  if (!slashProps) return false; const n = slashProps.items.length;
  if (ev.key === 'ArrowDown' && n) { slashIdx = (slashIdx + 1) % n; slashShow(slashProps); return true; }
  if (ev.key === 'ArrowUp' && n) { slashIdx = (slashIdx + n - 1) % n; slashShow(slashProps); return true; }
  if ((ev.key === 'Enter' || ev.key === 'Tab') && n) { slashProps.command(slashProps.items[slashIdx]); return true; }
  if (ev.key === 'Escape') ev.stopPropagation();
  return false;
}
slashEl.addEventListener('mousedown', e => e.preventDefault());
slashEl.addEventListener('click', e => { const b = e.target.closest('.sl-it'); if (b && slashProps) slashProps.command(slashProps.items[+b.dataset.i]); });
addEventListener('beforeprint', commitAll); addEventListener('afterprint', syncEditors);

/* blocks: select, move, resize, add, duplicate, delete */
function placeSel() {
  const b = $('.selbox'); if (!b || !selEl) return;
  b.style.cssText = `left:${selEl.offsetLeft}px;top:${selEl.offsetTop}px;width:${selEl.offsetWidth}px;height:${selEl.offsetHeight}px`; b.classList.toggle('low', selEl.offsetTop < 28);
}
function drawSel() {
  $$('.selbox').forEach(b => b.remove()); if (!selEl || !editing || !selEl.isConnected || document.body.classList.contains('grid')) return;
  const b = document.createElement('div'); b.className = 'selbox'; b.setAttribute('contenteditable', 'false');
  b.innerHTML = '<i class="grip" title="' + T('Move') + '">⠿</i><i class="rz" title="' + T('Resize') + '"></i>'; selEl.closest('.slide').append(b); placeSel();
  $('.grip', b).addEventListener('pointerdown', e => dragSel(e, 'move')); $('.rz', b).addEventListener('pointerdown', e => dragSel(e, 'size'));
}
function selectBlock(el) { selEl = el; drawSel(); syncFmt(); }
function dragSel(e, mode) {
  e.preventDefault(); e.stopPropagation(); const el = selEl, k = kscale(), sx = e.clientX, sy = e.clientY, o = { l: el.offsetLeft, t: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
  let moved = false; const move = ev => { moved = true;
    const dx = (ev.clientX - sx) / k, dy = (ev.clientY - sy) / k;
    if (mode === 'move') { el.style.left = Math.round(o.l + dx) + 'px'; el.style.top = Math.round(o.t + dy) + 'px'; }
    else { el.style.width = Math.max(40, Math.round(o.w + dx)) + 'px'; el.style.height = Math.max(24, Math.round(o.h + dy)) + 'px'; }
    placeSel();
  };
  const up = () => {
    removeEventListener('pointermove', move); removeEventListener('pointerup', up);
    if (el.classList.contains('chart')) { el.dataset.w = el.offsetWidth; el.dataset.h = el.offsetHeight; drawChart(el); }
    placeSel(); if (moved) touch();
  };
  addEventListener('pointermove', move); addEventListener('pointerup', up);
}
deck.addEventListener('pointerdown', e => {
  if (!editing || document.body.classList.contains('grid') || e.target.closest('.selbox')) return; closePop();
  const t = e.target.closest(BLOCKS); if (t && cells[cur].contains(t)) selectBlock(t); else { selEl = null; drawSel(); }
}, true);
function addBlock(shape) {
  const sl = curSlide(), d = document.createElement('div'), dark = sl.classList.contains('dark');
  d.className = 'b' + (shape ? ' ctr' : ''); d.setAttribute('data-e', '');
  d.style.cssText = shape ? 'left:560px;top:300px;width:300px;height:160px;font-size:28px;color:#1E2761;background:#D4A843;' : `left:120px;top:300px;width:520px;height:90px;font-size:36px;color:${dark ? '#FFFFFF' : '#333333'};`;
  d.textContent = shape ? T('Shape') : T('New text'); touch(); sl.insertBefore(d, $('.notes', sl)); mountBox(d); selectBlock(d);
  const ed = edFor(d); if (ed) ed.chain().focus().selectAll().run();
}
function addImage(file) {
  if (!file || !file.type.startsWith('image/')) return toast(T('This file is not an image.'));
  const rd = new FileReader();
  rd.onload = () => {
    const im = new Image();
    im.onload = () => {
      let url = rd.result;
      if (file.type !== 'image/svg+xml' && (im.naturalWidth > 1600 || file.size > 700000)) {
        const k = Math.min(1, 1600 / im.naturalWidth), c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); url = c.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', .88);
      }
      const w0 = im.naturalWidth || 400, h0 = im.naturalHeight || 300, k2 = Math.min(560 / w0, 360 / h0, 1), w = Math.round(w0 * k2), h = Math.round(h0 * k2);
      const img = document.createElement('img'); img.className = 'pic'; img.alt = file.name.replace(/\.[^.]+$/, ''); img.src = url;
      img.style.cssText = `left:${Math.round((1280 - w) / 2)}px;top:${Math.round((720 - h) / 2)}px;width:${w}px;height:${h}px;object-fit:contain;`;
      const sl = curSlide(); sl.insertBefore(img, $('.notes', sl)); selectBlock(img); touch(); toast(T('Image added.'));
    };
    im.onerror = () => toast(T('Unreadable image.')); im.src = rd.result;
  };
  rd.readAsDataURL(file);
}
E('#f-addtext').onclick = () => addBlock(false); E('#f-addshape').onclick = () => addBlock(true);
E('#f-addimg').onclick = () => E('#f-img').click(); E('#f-img').onchange = e => { addImage(e.target.files[0]); e.target.value = ''; };
deck.addEventListener('dragover', e => { if (editing && e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
deck.addEventListener('drop', e => { if (editing && e.dataTransfer && e.dataTransfer.files.length && !document.body.classList.contains('grid')) { e.preventDefault(); addImage(e.dataTransfer.files[0]); } });
function dupBlock() {
  if (!selEl) return toast(T('Select a block first.'));
  const src = selEl; commitAll();
  const c = src.cloneNode(true); $$('.selbox', c).forEach(x => x.remove());
  c.style.left = src.offsetLeft + 24 + 'px'; c.style.top = src.offsetTop + 24 + 'px'; src.after(c); syncEditors(); selectBlock(c); touch();
}
E('#f-dupblock').onclick = dupBlock;
function deleteBlock() {
  if (!selEl) return toast(T('Select a block first.'));
  commitAll(); const el = selEl, parent = el.parentNode, next = el.nextSibling; el.remove(); selEl = null; drawSel();
  touch(); toast(T('Block deleted.'), T('Undo'), () => { parent.insertBefore(el, next); syncEditors(); selectBlock(el); touch(); });
}
E('#f-del').onclick = deleteBlock;

/* slides: add, duplicate, delete, move */
function refresh(i) {
  indexCells(); if (i instanceof Element) i = cells.indexOf(i); cells.forEach(c => c.classList.remove('cur', 'leaving')); cur = -1; selEl = null; go(i, 0, { silent: true }); syncDraggable();
}
function addSlide(layout) {
  const t = document.createElement('div'); t.className = 'cell'; let body;
  if (layout === 'section') {
    const nums = $$('.slide.dark .b[style*="border-radius:50%"]').map(e => parseInt(e.textContent, 10) || 0), n = String(Math.max(0, ...nums) + 1).padStart(2, '0');
    body = `<section class="slide dark" data-transition="fade"><div class="b ctr" style="left:88px;top:159px;width:121px;height:121px;border-radius:50%;background:#D4A843;color:#1E2761;font:700 53px Georgia,serif" data-e>${n}</div><h1 style="left:88px;top:310px;width:983px;height:128px;font-size:59px" data-e>${T('Section title')}</h1><div class="b" style="left:88px;top:469px;width:907px;height:60px;font-size:27px;color:#CADCFC" data-e>${T('Subtitle')}</div><aside class="notes" data-e></aside></section>`;
  } else if (layout === 'text') {
    body = `<section class="slide" data-transition="fade"><h1 data-e>${T('New title')}</h1><div class="b" style="left:88px;top:220px;width:1104px;height:380px;font-size:32px;color:#333333" data-e><ul class="bul"><li>${T('First point')}</li><li>${T('Second point')}</li></ul></div><aside class="notes" data-e></aside></section>`;
  } else body = '<section class="slide" data-transition="fade"><aside class="notes" data-e></aside></section>';
  t.innerHTML = body; cells[cur].after(t); const at = cur + 1; refresh(at);
  touch(); toast(layout === 'section' ? T('Section added.') : T('Slide added.'));
}
function dupSlide() {
  commitAll(); const c = cells[cur].cloneNode(true); $$('.selbox', c).forEach(x => x.remove()); c.classList.remove('cur', 'leaving'); c.removeAttribute('style');
  cells[cur].after(c); const at = cur + 1; refresh(at); touch(); toast(T('Slide duplicated.'));
}
E('#f-dupslide').onclick = dupSlide;
E('#f-delslide').onclick = () => {
  commitAll();
  if (N < 2) return toast(T('Keep at least one slide.'));
  const cell = cells[cur], next = cell.nextSibling, at = Math.min(cur, N - 2); cell.remove(); refresh(at);
  touch(); toast(T('Slide deleted.'), T('Undo'), () => { deck.insertBefore(cell, next); refresh(cell); touch(); });
};
function moveSlide(d) {
  const j = cur + d; if (j < 0 || j >= N) return toast(d < 0 ? T('It is already the first.') : T('It is already the last.'));
  const me = cells[cur], other = cells[j]; if (d < 0) deck.insertBefore(me, other); else other.after(me); refresh(j); touch();
}
E('#f-mvprev').onclick = () => moveSlide(-1); E('#f-mvnext').onclick = () => moveSlide(1);
/* grid view: drag a thumbnail to reorder (edit mode) */
let dragCell = null;
function syncDraggable() { cells.forEach(c => { if (editing && document.body.classList.contains('grid')) c.setAttribute('draggable', 'true'); else c.removeAttribute('draggable'); }); }
deck.addEventListener('dragstart', e => { const c = e.target.closest && e.target.closest('.cell'); if (!c || !editing) return; dragCell = c; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', 'slide'); } catch (x) { /* ignore */ } });
deck.addEventListener('dragover', e => { if (!dragCell) return; e.preventDefault(); const c = e.target.closest('.cell'); $$('.cell.dragover').forEach(x => x.classList.remove('dragover')); if (c && c !== dragCell) c.classList.add('dragover'); });
deck.addEventListener('drop', e => {
  if (!dragCell) return; e.preventDefault(); const c = e.target.closest('.cell'); $$('.cell.dragover').forEach(x => x.classList.remove('dragover'));
  if (c && c !== dragCell) { const from = cells.indexOf(dragCell), to = cells.indexOf(c); if (from < to) c.after(dragCell); else deck.insertBefore(dragCell, c); const moved = dragCell; dragCell = null; refresh(moved); touch(); } else dragCell = null;
});
deck.addEventListener('dragend', () => { dragCell = null; $$('.cell.dragover').forEach(x => x.classList.remove('dragover')); });

/* ---------- keyboard ---------- */
addEventListener('keydown', e => {
  const typing = document.activeElement && document.activeElement.isContentEditable;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (typing && e.key !== 'Escape') return;
  const k = e.key;
  if (editing && selEl && !document.body.classList.contains('grid')) {
    const d = e.shiftKey ? 10 : 1, mv = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[k];
    if (mv) { e.preventDefault(); selEl.style.left = selEl.offsetLeft + mv[0] + 'px'; selEl.style.top = selEl.offsetTop + mv[1] + 'px'; placeSel(); touch(); return; }
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); deleteBlock(); return; }
  }
  if (k === 'ArrowRight' || k === 'PageDown' || k === ' ' || k === 'Enter') { e.preventDefault(); next(); }
  else if (k === 'ArrowLeft' || k === 'PageUp' || k === 'Backspace') { e.preventDefault(); prev(); }
  else if (k === 'Home') go(0, 0); else if (k === 'End') go(N - 1, 0);
  else if (k === 'g' || k === 'G') E('#b-grid').click();
  else if (k === 'p' || k === 'P') E('#b-pres').click();
  else if ((k === 'e' || k === 'E') && EDIT) setEditing(!editing);
  else if (k === 'f' || k === 'F') E('#b-fs').click();
  else if (k === 'Escape') { if (document.activeElement) document.activeElement.blur(); if (selEl) { selEl = null; drawSel(); return; } if (document.body.classList.contains('grid')) toggleGrid(false); else if (editing) setEditing(false); }
});


/* ---------- the slides as the file keeps them ---------- */
/* `canon`: the same slides with every inline style written the way the browser writes it, so two states of the same deck compare equal whatever the
   showing and hiding of fragments did to the text of a style attribute (the file is never written from this form) */
function slidesHtml(canon) {
  commitAll();
  const c = deck.cloneNode(true);
  $$('[contenteditable]', c).forEach(e => e.removeAttribute('contenteditable'));
  $$('.selbox', c).forEach(e => e.remove());
  $$('.cell', c).forEach(e => { e.classList.remove('cur', 'leaving', 'dragover'); e.removeAttribute('style'); e.removeAttribute('data-n'); e.removeAttribute('draggable'); });
  $$('.slide', c).forEach(e => { if (!e.getAttribute('style')) e.removeAttribute('style'); });
  $$('.chart', c).forEach(e => { e.innerHTML = ''; });
  $$('.frag', c).forEach(e => { e.classList.remove('on'); e.style.removeProperty('--d'); if (!e.getAttribute('style')) e.removeAttribute('style'); if (e.getAttribute('class') === '') e.removeAttribute('class'); });
  $$('.slide', c).forEach(e => e.removeAttribute('aria-label'));
  if (canon) $$('[style]', c).forEach(e => e.setAttribute('style', e.style.cssText));
  /* the markup writes a valueless attribute as data-e="" ; the files keep it bare */
  const out = [...c.children].map(e => e.outerHTML).join('\n').replace(/(?<=<[a-z][^<>]*) (data-e|data-e-table)=""(?=[\s>/])/g, ' $1');
  syncEditors();
  return out;
}

/* ---------- start ---------- */
const wantGrid = !FRAMED && location.hash === '#grid', m = FRAMED ? null : location.hash.match(/#(\d+)(?:\.(\d+))?/);
fit(); go(m ? +m[1] - 1 : 0, m && m[2] ? +m[2] : 0, { silent: true });
if (wantGrid) toggleGrid(true);
return { get editing() { return editing; }, setEditing, slidesHtml, commitAll, syncEditors };
}
