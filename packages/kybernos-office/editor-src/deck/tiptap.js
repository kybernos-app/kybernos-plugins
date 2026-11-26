/* Text layer of the HTML deck: one Tiptap editor per text box (MIT, ProseMirror). Ported from the 2026-11-03 office spike.
   The box itself becomes the editor root, so the layout (absolute position, flex centring) is untouched.
   Lines are <div class="ln"> (style kept as written), lists are <ul class="bul"><li>, like the generator writes them. */
import { Editor, Extension, Mark, mergeAttributes } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Bold from '@tiptap/extension-bold';
import Italic from '@tiptap/extension-italic';
import Underline from '@tiptap/extension-underline';
import Strike from '@tiptap/extension-strike';
import HardBreak from '@tiptap/extension-hard-break';
import { BulletList, ListItem } from '@tiptap/extension-list';
import { TextStyle, Color, FontSize, BackgroundColor } from '@tiptap/extension-text-style';
import { UndoRedo, Placeholder } from '@tiptap/extensions';
import Suggestion from '@tiptap/suggestion';

const rawStyle = { style: { default: null, parseHTML: el => el.getAttribute('style') || null, renderHTML: a => (a.style ? { style: a.style } : {}) } };
const Line = Paragraph.extend({
  addAttributes() { return { ...this.parent?.(), ...rawStyle }; },
  parseHTML() { return [{ tag: 'div.ln' }, { tag: 'p' }]; },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { class: 'ln' }), 0]; },
});
const Bullets = BulletList.extend({
  addAttributes() { return { cls: { default: 'bul', parseHTML: el => el.getAttribute('class') || 'bul', renderHTML: a => ({ class: a.cls }) } }; },
});
const Anchor = Mark.create({ name: 'link', inclusive: false, addAttributes() { return { href: { default: null }, target: { default: null }, rel: { default: null } }; }, parseHTML() { return [{ tag: 'a[href]' }]; }, renderHTML({ HTMLAttributes }) { return ['a', HTMLAttributes, 0]; } });
const HEAVY = /^(bold(er)?|[5-9]\d{2,})$/;
const Strong = Bold.extend({ parseHTML() { return [{ tag: 'strong' }, { tag: 'b', getAttrs: n => n.style.fontWeight !== 'normal' && null }, { tag: 'span', getAttrs: n => HEAVY.test(n.style.fontWeight) && null }]; } });
const EnterBreaks = Extension.create({ name: 'enterBreaks', addKeyboardShortcuts() { return { Enter: () => this.editor.commands.setHardBreak() }; } });
const Slash = Extension.create({
  name: 'slash',
  addOptions() { return { suggestion: {} }; },
  addProseMirrorPlugins() { return [Suggestion({ editor: this.editor, char: '/', ...this.options.suggestion })]; },
});

/* o: { rich, slash, placeholder, onFocus(ed), onBlur(ed), onChange(ed), onUpdate(ed) }  -- slash = { items, command, render } for the "/" menu; onUpdate: the text changed */
function mount(el, o = {}) {
  const html = el.innerHTML, rich = !!o.rich, attrs = el.getAttributeNames().map(n => [n, el.getAttribute(n)]);
  el.textContent = '';
  const ex = [
    Document.extend({ content: rich ? 'block+' : 'paragraph' }), Line, Text, Strong, Italic, Underline, Strike, HardBreak,
    Anchor, TextStyle, Color, FontSize, BackgroundColor, UndoRedo,
  ];
  if (rich) ex.push(Bullets, ListItem); else ex.push(EnterBreaks);
  if (rich) ex.push(Placeholder.configure({ placeholder: o.placeholder || '' }));
  if (rich && o.slash) ex.push(Slash.configure({ suggestion: o.slash }));
  const ed = new Editor({
    element: { mount: el }, injectCSS: false, content: html, extensions: ex, autofocus: false,
    editorProps: { attributes: { spellcheck: 'false' } },
    onFocus: () => o.onFocus && o.onFocus(ed), onBlur: () => o.onBlur && o.onBlur(ed),
    onSelectionUpdate: () => o.onChange && o.onChange(ed), onTransaction: () => o.onChange && o.onChange(ed),
    onUpdate: () => { ed.kb.changed = true; if (o.onUpdate) o.onUpdate(ed); },
  });
  ed.kb = { el, rich, keepLn: /^\s*<div class="ln"/.test(html), bare: !/class="ln"/.test(html) && !/<ul/.test(html), attrs, html0: html, changed: false };
  if (ed.kb.bare) el.dataset.bare = '1';
  return ed;
}

/* Clean HTML of the box, written back into the page when the editor is closed. */
function exportHTML(ed) {
  const { el, rich, keepLn } = ed.kb, t = document.createElement('template');
  t.innerHTML = ed.getHTML();
  const root = t.content;
  root.querySelectorAll('li > div.ln:only-child').forEach(p => { if (!p.hasAttribute('style')) p.replaceWith(...p.childNodes); });
  root.querySelectorAll('[class=""]').forEach(n => n.removeAttribute('class'));
  const first = root.firstElementChild, single = root.children.length === 1 && first.matches('div.ln') && root.childNodes.length === 1;
  if (!rich && single) {
    if (first.hasAttribute('style')) el.style.cssText += ';' + first.getAttribute('style');
    return first.innerHTML.replace(/<br class="ProseMirror-trailingBreak">/g, '');
  }
  if (single && !first.hasAttribute('style') && !keepLn) return first.innerHTML.replace(/<br class="ProseMirror-trailingBreak">/g, '');
  const d = document.createElement('div'); d.append(root);
  return d.innerHTML.replace(/<br class="ProseMirror-trailingBreak">/g, '');
}

/* Close the editor: write the HTML back, give the box its original attributes. */
function close(ed) {
  /* a box nobody typed in gets back exactly the markup it had: opening a deck and paging through it never rewrites it */
  const { el, attrs } = ed.kb, html = ed.kb.changed ? exportHTML(ed) : ed.kb.html0;
  ed.destroy();
  const keep = new Set(attrs.map(a => a[0]));
  el.getAttributeNames().forEach(n => { if (!keep.has(n)) el.removeAttribute(n); });
  attrs.forEach(([n, v]) => { if (n === 'style') return; el.setAttribute(n, v); });
  el.innerHTML = html;
  return html;
}

export const KBTip = { mount, exportHTML, close };
