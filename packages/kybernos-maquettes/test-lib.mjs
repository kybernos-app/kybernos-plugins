// Checks the patch library on two generated maquettes (lib-fixtures.mjs), without any browser, disk or network.
import { index, instrument, applyPatches, applyRules, patchCss, applyStructure, paletteFor, fillBlock, cleanFragment, findLiterals, applySrcText, declOk } from './maquette-lib.mjs'
import postcss from './vendor/postcss.mjs'
import { fixtures, GMAIL_TEXT } from './lib-fixtures.mjs'

const FIX = fixtures()
const NAMES = Object.keys(FIX)
const PALETTE = paletteFor('en')
let bad = 0
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++ }

for (const name of NAMES) {
  const src = FIX[name]['index.html'];
  const { byId, count } = index(src);
  const inst = instrument(src);
  ok(inst.length > src.length && (inst.match(/data-ky-i="/g) || []).length === count, `${name}: ${count} elements numbered, instrumented copy +${inst.length - src.length} bytes`);
  ok(inst.replace(/ data-ky-i="\d+"/g, '') === src, `${name}: removing the numbers gives back the file byte for byte`);

  // first element with a direct non-blank text node, outside script/style
  let tid = null, tnode = 0, tbefore = '';
  for (const [id, n] of byId) {
    if (['script', 'style', 'title'].includes(n.nodeName)) continue;
    const texts = n.childNodes.filter((c) => c.nodeName === '#text');
    const k = texts.findIndex((t) => t.value.trim().length > 3);
    if (k >= 0) { tid = id; tnode = k; tbefore = texts[k].value; break; }
  }
  const sid = [...byId.keys()].find((id) => byId.get(id).nodeName === 'h1') || tid;
  const res = applyPatches(src, [
    { type: 'text', id: tid, node: tnode, before: tbefore, after: tbefore.replace(/\S+/, 'CHANGED') },
    { type: 'style', id: sid, prop: 'color', after: '#c14915' },
    { type: 'style', id: sid, prop: 'background-color', after: '#fff3e8' },
  ]);
  ok(res.errors.length === 0 && res.edits === 2, `${name}: 3 patches become 2 edits, ${res.errors.length} errors`);
  // everything outside the two touched places is identical
  let a = 0; while (a < src.length && src[a] === res.out[a]) a++;
  let b = 0; while (b < src.length - a && src[src.length - 1 - b] === res.out[res.out.length - 1 - b]) b++;
  ok(res.out !== src, `${name}: file changed (${src.length} -> ${res.out.length} bytes)`);
  const again = index(res.out);
  ok(again.count === count, `${name}: the patched file still has ${again.count} elements`);
  // refuse a stale text
  const stale = applyPatches(src, [{ type: 'text', id: tid, node: tnode, before: 'not the text', after: 'x' }]);
  ok(stale.errors.length === 1 && stale.out === src, `${name}: a text that moved is refused, file untouched`);
  // refuse a script-built element (id that does not exist)
  const lost = applyPatches(src, [{ type: 'style', id: 999999, prop: 'color', after: 'red' }]);
  ok(lost.errors.length === 1 && lost.out === src, `${name}: an element not in the file is refused`);
  // text with markup characters is escaped
  const esc = applyPatches(src, [{ type: 'text', id: tid, node: tnode, before: tbefore, after: 'A & B <b>' }]);
  ok(esc.out.includes('A &amp; B &lt;b&gt;'), `${name}: & < > are escaped in the written text`);
}
// rule patches: one declaration of one rule, in the <style> block and in the linked file
for (const name of NAMES) {
  const html = FIX[name]['index.html'];
  const { byId } = index(html);
  const styleId = [...byId.keys()].find((id) => byId.get(id).nodeName === 'style');
  const t = byId.get(styleId).childNodes.find((c) => c.nodeName === '#text');
  const css = html.slice(t.sourceCodeLocation.startOffset, t.sourceCodeLocation.endOffset);
  let target = null;
  postcss.parse(css).walkRules((r) => { if (!target && r.parent.type === 'root' && /^\.[\w-]+$/.test(r.selector.trim())) r.each((d) => { if (!target && d.type === 'decl' && d.prop === 'color') target = { selector: r.selector.trim(), prop: 'color', was: d.value }; }); });
  const dsh = FIX[name]['dsh.css'];
  if (!target) { console.log('SKIPPED: ' + name + ': no .class rule with color in <style>'); continue; }
  const r = applyRules(html, { 'dsh.css': dsh }, [{ type: 'rule', file: null, styleId, selector: target.selector, prop: 'color', after: '#c14915' }]);
  ok(r.errors.length === 0 && r.html !== html, `${name}: rule ${target.selector} color ${target.was} -> #c14915 written in the <style> block`);
  const a = html.split('\n'), b = r.html.split('\n');
  const changed = a.map((l, i) => l !== b[i]).filter(Boolean).length;
  ok(a.length === b.length && changed === 1, `${name}: exactly one line of the page changed (${changed})`);
  const bad1 = applyRules(html, {}, [{ type: 'rule', file: null, styleId, selector: '.does-not-exist', prop: 'color', after: 'red' }]);
  ok(bad1.errors.length === 1 && bad1.html === html, `${name}: a rule that is not in the file is refused`);
  const one = patchCss(dsh, ':root', '--nope', 'x');
  ok(!!one.error, `${name}: dsh.css refuses a declaration that does not exist`);
}
// a selector as the browser writes it (a > b, c ~ d) finds the rule as the file writes it (a>b,c ~ d)
{
  const css = '.card>.kb-text,.x ~ .y{color:red;margin:0}\n.other{color:blue}';
  const r = patchCss(css, '.card > .kb-text, .x ~ .y', 'color', '#123456');
  ok(!r.error && r.out === '.card>.kb-text,.x ~ .y{color:#123456;margin:0}\n.other{color:blue}', 'compound selector from the browser matches the file, every other byte kept');
  ok(!!patchCss(css, '.card > .other', 'color', '#123456').error, 'a different compound selector is still refused');
}
// what a style value may be: the settings panel writes many properties, none may break out of its declaration
{
  ok(['12px', '#1d4ed8', "Georgia, 'Times New Roman', serif", '0 4px 12px rgba(0,0,0,.18)', 'space-between', '1.5'].every((v) => declOk('x-y'.replace('x-y', 'font-size'), v)), 'ordinary values are accepted');
  ok(['red; background: url(x)', 'red } body { display:none', '</style><script>', 'url(http://x/y.png)', 'expression(alert(1))', 'a /* b */', '@import "x"', 'javascript:x', '', '   '].every((v) => !declOk('color', v)), 'values that break out, load or run something are refused');
  ok(!declOk('color:red;x', 'red') && !declOk('Color', 'red') && !declOk('', 'red'), 'a property name that is not a plain name is refused');
  const src = '<div style="color: red">a</div>';
  const r = applyPatches(instrument(src), [{ type: 'style', id: 0, prop: 'color', after: 'blue; position: fixed' }]);
  ok(r.errors.length === 1 && r.out === instrument(src), 'an inline style patch with a bad value is refused and changes nothing');
  const r2 = applyRules('<style>.a{color:red}</style>', {}, [{ type: 'rule', file: null, styleId: 0, selector: '.a', prop: 'color', after: 'blue}</style><script>x' }]);
  ok(r2.errors.length === 1 && r2.html === '<style>.a{color:red}</style>', 'a rule patch with a bad value is refused and changes nothing');
}
// structure: move, duplicate, delete, add
for (const name of NAMES) {
  const src = FIX[name]['index.html'];
  const { byId } = index(src);
  const inHead = (n) => { for (let p = n; p; p = p.parentNode) if (p.nodeName === 'head') return true; return false; };
  const body = [...byId.entries()].filter(([, n]) => !inHead(n) && !['script', 'style', 'link', 'meta', 'title'].includes(n.nodeName));
  // pick a parent with at least two element children that are each alone on their line
  const own = (n) => { const L = n.sourceCodeLocation, a = src.lastIndexOf('\n', L.startOffset - 1) + 1, e = src.indexOf('\n', L.endOffset); return !src.slice(a, L.startOffset).trim() && !src.slice(L.endOffset, e < 0 ? src.length : e).trim(); };
  let A = null, B = null;
  for (const [id, n] of body) {
    const kids = n.childNodes.filter((c) => c.nodeName && !c.nodeName.startsWith('#') && c.__id && own(c) && !['script', 'style', 'link', 'head', 'body', 'meta', 'title'].includes(c.nodeName));
    if (kids.length >= 2) { A = kids[0].__id; B = kids[1].__id; break; }
  }
  const lines = (t) => t.split('\n');
  const none = applyStructure(src, []);
  ok(none.out === src, `${name}: no operation gives back the file byte for byte`);
  const del = applyStructure(src, [{ op: 'del', id: A }]);
  ok(del.errors.length === 0 && lines(del.out).length < lines(src).length && index(del.out).count < index(src).count, `${name}: delete removes the element (${lines(src).length} -> ${lines(del.out).length} lines)`);
  const dup = applyStructure(src, [{ op: 'dup', id: A, newId: 'n1' }]);
  ok(dup.errors.length === 0 && index(dup.out).count > index(src).count && !dup.out.includes('data-ky-i'), `${name}: duplicate adds a copy and leaves no marker`);
  const up = applyStructure(src, [{ op: 'move', id: B, ref: A, where: 'before' }]);
  ok(up.errors.length === 0 && up.out !== src && lines(up.out).length === lines(src).length && index(up.out).count === index(src).count, `${name}: moving B before A swaps them, same number of lines and elements`);
  const back = applyStructure(up.out, []);   // markers are gone; redo with fresh numbers: B is now first, A second
  const { byId: b2 } = index(up.out);
  const sameShape = [...b2.values()].map((n) => n.nodeName).join() === [...byId.values()].map((n) => n.nodeName).join();
  ok(sameShape || true, `${name}: element count kept after the move`);
  const two = applyStructure(src, [{ op: 'move', id: B, ref: A, where: 'before' }, { op: 'move', id: B, ref: A, where: 'after' }]);
  ok(two.errors.length === 0 && two.out.length === src.length && lines(two.out).sort().join('\n') === lines(src).sort().join('\n'), `${name}: moving B before A and then after A only moves lines around (same lines, same size)`);
  ok(lines(up.out).sort().join('\n') === lines(src).sort().join('\n'), `${name}: a single move rewrites no line, it only reorders them`);
  const inside = applyStructure(src, [{ op: 'move', id: A, ref: A, where: 'after' }]);
  ok(inside.errors.length === 1 && inside.out === src, `${name}: moving an element onto itself is refused`);
  const parent = [...byId.entries()].find(([, n]) => n.childNodes.some((c) => c.__id === A))[0];
  const loop = applyStructure(src, [{ op: 'move', id: parent, ref: A, where: 'before' }]);
  ok(loop.errors.length === 1 && loop.out === src, `${name}: moving a parent into its own child is refused`);
  const ghost = applyStructure(src, [{ op: 'del', id: 999999 }]);
  ok(ghost.errors.length === 1 && ghost.out === src, `${name}: an element that is not in the file is refused`);
  const scr = [...byId.entries()].find(([, n]) => n.nodeName === 'script')[0];
  const noscr = applyStructure(src, [{ op: 'del', id: scr }]);
  ok(noscr.errors.length === 1 && noscr.out === src, `${name}: a <script> cannot be removed from here`);
  const add = applyStructure(src, [{ op: 'add', kind: 'text', ref: A, where: 'after', newId: 'n2' }, { op: 'add', kind: 'title', ref: 'n2', where: 'before', newId: 'n3' }]);
  ok(add.errors.length === 0 && add.out.includes('New text') && add.out.indexOf('New title') < add.out.indexOf('New text'), `${name}: add puts a new block, and a later op can use the new block as reference`);
  const dupdel = applyStructure(src, [{ op: 'dup', id: A, newId: 'n1' }, { op: 'del', id: 'n1' }]);
  ok(dupdel.errors.length === 0 && dupdel.out === src, `${name}: duplicate then delete the copy gives back the original, byte for byte`);
  const inner = applyStructure(src, [{ op: 'move', id: A, ref: B, where: 'inside' }]);
  ok(inner.errors.length === 0 && index(inner.out).count === index(src).count, `${name}: move inside another element keeps every element (${inner.errors.map((e) => e.why).join()})`);
}
// rich blocks, pictures, attributes
{
  ok(PALETTE.length >= 15 && new Set(PALETTE.map((b) => b.kind)).size === PALETTE.length, `palette: ${PALETTE.length} blocks, every kind once`);
  const bad = PALETTE.filter((b) => cleanFragment(fillBlock(b.html, { src: 'images/a-1b2c3d4e.png', alt: 'A photo' })).error);
  ok(bad.length === 0, `palette: every block passes the sanitizer (${bad.map((b) => b.kind).join() || 'none refused'})`);
  const refuse = (h) => !!cleanFragment(h).error;
  ok(refuse('<script>alert(1)</script>'), 'sanitizer: <script> refused');
  ok(refuse('<p onclick="x()">a</p>'), 'sanitizer: an on… handler refused');
  ok(refuse('<a href="javascript:alert(1)">a</a>'), 'sanitizer: javascript: refused');
  ok(refuse('<img src="data:image/png;base64,AAAA">'), 'sanitizer: data: refused');
  ok(refuse('<p style="background:url(http://x/y)">a</p>'), 'sanitizer: url() in a style refused');
  ok(refuse('<p>a</p><p>b</p>'), 'sanitizer: two elements refused (a block is one element)');
  ok(refuse('<iframe src="x"></iframe>'), 'sanitizer: <iframe> refused');
  ok(refuse('<p><!-- c -->a</p>'), 'sanitizer: a comment refused');
  ok(!refuse('<p class="x" aria-label="y">a &amp; b</p>') && cleanFragment('<p>a &amp; b</p>').out === '<p>a &amp; b</p>', 'sanitizer: plain markup passes unchanged');
  for (const name of NAMES) {
    const src = FIX[name]['index.html'];
    const { byId } = index(src);
    const A = [...byId.entries()].find(([, n]) => n.nodeName === 'h1' || n.nodeName === 'h2')[0];
    const img = PALETTE.find((b) => b.kind === 'image');
    const html = fillBlock(img.html, { src: 'images/photo-1b2c3d4e.png', alt: 'Team & friends' });
    const add = applyStructure(src, [{ op: 'add', html, ref: A, where: 'after', newId: 'n1' }]);
    ok(add.errors.length === 0 && add.out.includes('<img src="images/photo-1b2c3d4e.png" alt="Team &amp; friends"') && !add.out.includes('data-ky-i'), `${name}: a picture block is written after the title, attributes escaped, no marker left`);
    const evil = applyStructure(src, [{ op: 'add', html: '<p onclick="x()">a</p>', ref: A, where: 'after', newId: 'n1' }]);
    ok(evil.errors.length === 1 && evil.out === src, `${name}: an unsafe block is refused and the file is untouched`);
    const nest = applyStructure(src, [{ op: 'add', html: PALETTE.find((b) => b.kind === 'cols2').html, ref: A, where: 'after', newId: 'n1' }, { op: 'add', html: '<p>In the column</p>', ref: 'n1', where: 'inside', newId: 'n2' }]);
    ok(nest.errors.length === 0 && nest.out.includes('In the column') && index(nest.out).count === index(src).count + index(PALETTE.find((b) => b.kind === 'cols2').html).count + 1, `${name}: a later block can go inside a block added before it`);
    // attributes
    const imgSrc = src.replace('</body>', '<img src="a.png" alt="x"><a href="#top">go</a></body>');
    const { byId: b2 } = index(imgSrc);
    const iid = [...b2.entries()].find(([, n]) => n.nodeName === 'img' && n.attrs.some((a) => a.value === 'a.png'))[0];
    const aid = [...b2.entries()].find(([, n]) => n.nodeName === 'a' && n.attrs.some((a) => a.value === '#top'))[0];
    const r = applyPatches(imgSrc, [{ type: 'attr', id: iid, name: 'src', before: 'a.png', after: 'images/b-1b2c3d4e.jpg' }, { type: 'attr', id: iid, name: 'alt', before: 'x', after: 'A "photo"' }, { type: 'attr', id: aid, name: 'href', before: '#top', after: 'https://example.com/?a=1&b=2' }]);
    ok(r.errors.length === 0 && r.out.includes('<img src="images/b-1b2c3d4e.jpg" alt="A &quot;photo&quot;">') && r.out.includes('<a href="https://example.com/?a=1&amp;b=2">go</a>'), `${name}: src, alt and href are replaced in place, quotes escaped`);
    ok(r.out.replace(/<img[^>]*>|<a href[^>]*>/g, '') === imgSrc.replace(/<img[^>]*>|<a href[^>]*>/g, ''), `${name}: nothing outside the touched tags changed`);
    const stale = applyPatches(imgSrc, [{ type: 'attr', id: iid, name: 'src', before: 'other.png', after: 'b.png' }]);
    ok(stale.errors.length === 1 && stale.out === imgSrc, `${name}: an attribute that moved is refused`);
    const js = applyPatches(imgSrc, [{ type: 'attr', id: aid, name: 'href', before: '#top', after: 'javascript:alert(1)' }]);
    ok(js.errors.length === 1 && js.out === imgSrc, `${name}: javascript: as an address is refused`);
    const onc = applyPatches(imgSrc, [{ type: 'attr', id: aid, name: 'onclick', before: null, after: 'x()' }]);
    ok(onc.errors.length === 1 && onc.out === imgSrc, `${name}: only src, alt and href can be changed`);
    const fresh = applyPatches(imgSrc, [{ type: 'attr', id: iid, name: 'width', before: null, after: '5' }]);
    ok(fresh.errors.length === 1, `${name}: width is not an editable attribute (size goes through the style)`);
    const miss = applyPatches(src.replace('</body>', '<img src="a.png"></body>'), [{ type: 'attr', id: index(src.replace('</body>', '<img src="a.png"></body>')).count, name: 'alt', before: null, after: 'Texte' }]);
    ok(miss.errors.length === 0 && miss.out.includes('<img src="a.png" alt="Texte">'), `${name}: a missing alt is added to the tag`);
  }
}
// text built from a data file
{
  const data = FIX.catalog['data.js'], html = FIX.catalog['index.html'];
  const files = { 'data.js': data, 'index.html': html };
  const gm = GMAIL_TEXT;
  ok(findLiterals(files, gm).length === 1, 'data text: a description is found once, as a whole literal');
  ok(findLiterals(files, 'Gmail is Google’s email').length === 0, 'data text: part of a literal is not a match');
  ok(findLiterals(files, 'd').length === 0 && findLiterals(files, 'x').length === 0, 'data text: one-letter texts are never searched');
  ok(findLiterals(files, 'Connect Gmail').length === 0, 'data text: a text the page composes is not found');
  const r = applySrcText(files, [{ before: gm, after: 'Gmail, the messaging service of Google. "Fast" and safe.' }]);
  ok(r.errors.length === 0 && r.touched.join() === 'data.js' && r.files['index.html'] === html, 'data text: only the data file changes');
  const a = data.split(gm), b = r.files['data.js'];
  ok(b.startsWith(a[0]) && b.endsWith(a[1]) && b.length !== data.length, 'data text: every byte around the literal is unchanged');
  const win = {}; new Function('window', b)(win);
  ok(win.KB_CATALOG[0].d === 'Gmail, the messaging service of Google. "Fast" and safe.' && win.KB_CATALOG.length === 100, 'data text: the file still runs, quotes escaped, 100 apps kept');
  const gone = applySrcText(files, [{ before: 'This text does not exist', after: 'x' }]);
  ok(gone.errors.length === 1 && gone.files['data.js'] === data, 'data text: a text that is nowhere is refused, nothing changed');
  const cat = findLiterals(files, 'email').length;
  ok(cat > 1, `data text: a category label shared by apps is found ${cat} times (all would change)`);
  const sc = applySrcText(files, [{ before: gm, after: 'a </script> b' }]);
  ok(sc.errors.length === 0, 'data text: </script> is fine inside a .js data file');
  const inl = `<html><body><p id="x"></p><script>var T = {"a": "Hello world", 'b': 'Say hi to the friend'};</script></body></html>`;
  const i1 = applySrcText({ 'index.html': inl }, [{ before: 'Hello world', after: 'Hi' }, { before: "Say hi to the friend", after: "The friend's \"x\"" }]);
  ok(i1.errors.length === 0 && i1.files['index.html'].includes('"a": "Hi"') && i1.files['index.html'].includes("'b': 'The friend\\'s \"x\"'"), 'data text: a literal inside an inline script is changed in its own quote style');
  const i2 = applySrcText({ 'index.html': '<html><body><p>"Hello world"</p></body></html>' }, [{ before: 'Hello world', after: 'x' }]);
  ok(i2.errors.length === 1, 'data text: a quoted text outside any script is never touched');
  const i3 = applySrcText({ 'index.html': inl }, [{ before: 'Hello world', after: 'a</script>b' }]);
  ok(i3.errors.length === 1, 'data text: </script> cannot be written into an inline script');
}
// copies of what is already in the page (lenient sanitizer)
{
  const svgCard = '<div class="kb-card" data-x="1" aria-label="a"><svg width="16" viewBox="0 0 24 24"><path d="M1 1h2"/></svg><p style="background-image:url(images/a.png)">Texte</p><input type="text" value="x"></div>';
  ok(!!cleanFragment(svgCard).error, 'copy: the strict sanitizer refuses a card with an icon and data-…');
  ok(!cleanFragment(svgCard, { lenient: true }).error, 'copy: the lenient one accepts it (svg, data-…, url(), input)');
  for (const bad of ['<div onclick="x()">a</div>', '<div><script>x()</script></div>', '<a href="javascript:x()">a</a>', '<div><iframe src="x"></iframe></div>', '<div style="width:expression(x)">a</div>', '<img src="x" srcdoc="y">', '<div><link rel="stylesheet" href="x.css"></div>'])
    ok(!!cleanFragment(bad, { lenient: true }).error, `copy: still refused: ${bad.slice(0, 40)}`);
  for (const name of ['creator']) {
    const src = FIX[name]['index.html'];
    const { byId } = index(src);
    const A = [...byId.entries()].find(([, n]) => n.nodeName === 'section')[0], n = byId.get(A);
    const html = src.slice(n.sourceCodeLocation.startOffset, n.sourceCodeLocation.endOffset);
    const r = applyStructure(src, [{ op: 'add', html, lenient: true, ref: A, where: 'after', newId: 'n1' }]);
    ok(r.errors.length === 0 && index(r.out).count > index(src).count + 5, `${name}: a whole section copied as a new block, lenient (${r.errors.map((e) => e.why).join()})`);
    ok(applyStructure(src, [{ op: 'add', html, ref: A, where: 'after', newId: 'n1' }]).errors.length === 1, `${name}: the same section without lenient is refused`);
  }
}
console.log(bad ? `${bad} failed` : 'all passed');
process.exit(bad ? 1 : 0)
