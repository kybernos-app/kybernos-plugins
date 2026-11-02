// The HTML shells (chat page, Boîte, Atelier) and the words in them: they render in English and French from a fiche, every key their
// scripts ask for exists in both dictionaries, the French speaks to the reader as "tu", and a fiche cannot break out of the page.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseFiche } from '../core/fiche.mjs';
import { ACTION_INFO } from '../core/actions.mjs';
import { MODES } from '../core/guardrails.mjs';
import { LEVELS } from '../core/identity.mjs';
import { diffFiches } from '../core/studio.mjs';
import { t as say } from '../core/text.mjs';
import { chatPage, esc, safeJson } from '../server/pages.mjs';
import { boitePage, atelierPage } from '../server/owner-pages.mjs';
import { makeShop } from './helpers-shop.mjs';
import { BASE } from './helpers.mjs';

const NONCE = 'TESTNONCE123';
const ficheOf = (language, over = {}) => parseFiche({ ...BASE, language, brand: { greeting: 'Ask me anything' }, ...over }).fiche;
const PAGES = { chat: chatPage, boite: boitePage, atelier: atelierPage };
const render = (which, fiche) => PAGES[which]({ fiche, nonce: NONCE });
const cfgOf = (html) => JSON.parse(/<script type="application\/json" id="cfg">([\s\S]*?)<\/script>/.exec(html)[1]);
const uiSource = (name) => fs.readFileSync(new URL(`../server/ui/${name}`, import.meta.url), 'utf8');
const textSource = () => fs.readFileSync(new URL('../core/text.mjs', import.meta.url), 'utf8');
/** The real <script>/<style> elements of a page (the inline script also holds the text "<script" in a string, which is not one). */
const blocksOf = (html) => [...html.matchAll(/<(script|style)\b([^>]*)>([\s\S]*?)<\/\1>/g)];
const outsideBlocks = (html) => html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g, '');
/** Comments out of a script, so a key mentioned in a comment is not taken for a key in use. */
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');

/** `{ chat, boite, atelier }`, each `{ en, fr }`: the dictionaries the pages really send to the browser. */
const DICT = Object.fromEntries(Object.keys(PAGES).map((which) => [which, Object.fromEntries(['en', 'fr'].map((lang) => [lang, cfgOf(render(which, ficheOf(lang))).t]))]));
const FILES = { chat: ['chat.js'], boite: ['boite.js', 'kit.js'], atelier: ['atelier.js', 'kit.js'] };

function keysUsed(which) {
  const fixed = new Set();
  const prefixes = new Set();
  for (const file of FILES[which]) {
    const code = stripComments(uiSource(file));
    for (const m of code.matchAll(/\btt\('([^']+)'(\s*\+)?/g)) (m[2] ? prefixes : fixed).add(m[1]);
    for (const m of code.matchAll(/\bT\.([A-Za-z_]\w*)/g)) fixed.add(m[1]);
    for (const m of code.matchAll(/\bT\['([^']+)'\s*\+/g)) prefixes.add(m[1]);
  }
  return { fixed, prefixes };
}

const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

// What the Atelier says for the things the server decides: the journal kinds and the blocker codes a real studio produces.
async function studioFacts() {
  const kinds = new Set();
  const blockers = new Set();
  const note = (st) => { st.journal.forEach((j) => kinds.add(j.kind)); st.blockers.forEach((b) => blockers.add(b.code)); };
  const owner = { scope: 'owner' };
  const shop = makeShop();
  note(shop.studio.status());
  shop.studio.applyOps([{ op: 'add_fact', text: 'A new unchecked fact.' }, { op: 'set', path: 'tone', value: 'Calm.' }], owner);
  note(shop.studio.status());
  shop.studio.applyOps([{ op: 'set_fact', index: 1, validated: true }], owner);
  shop.studio.review();
  await shop.studio.check();
  assert.equal(shop.studio.publish().ok, true);
  assert.equal(shop.studio.rollback(1).ok, true);
  shop.studio.applyOps([{ op: 'set', path: 'tone', value: 'Again.' }], owner);
  shop.studio.discard();
  note(shop.studio.status());
  const bad = makeShop({ runChecks: async () => [{ name: 'x', ok: false, failures: ['no'] }] });
  bad.studio.applyOps([{ op: 'set', path: 'tone', value: 'x' }], owner);
  await bad.studio.check();
  note(bad.studio.status());
  return { kinds, blockers };
}

const FULL_CHANGE = {
  name: 'Another Name', language: 'fr', identity: 'About.', tone: 'Tone.', unknown: 'Say nothing.', brand: { color: '#aa3366', greeting: 'Hello' },
  knowledge: [{ text: 'Open every day.', source: 'someone else', validated: false }, { text: 'A new fact.', validated: true }], instructions: ['Be brief.'],
  agenda: { enabled: true, days: [1], from: '08:00', to: '17:00', slotMinutes: 15, horizonDays: 7, timezone: 'Europe/Paris' },
  guardrails: {
    actions: { leave_message: 'off', request_callback: 'auto', list_slots: 'approve' },
    budget: { dailyCap: 1, visitorDailyCap: 0.1, currency: 'USD', inPerMTok: 2, outPerMTok: 8, charsPerToken: 3, timezone: 'Europe/Paris' },
    limits: { maxInputChars: 500 }, allowedOrigins: ['https://x.example'], enabled: false, retentionMonths: 6,
  },
};

// ---------------------------------------------------------------------------------------------------------------- rendering

test('every page renders in English and in French from a fiche, with its own dictionary and one nonce on its two inline blocks', () => {
  const expectations = {
    chat: { en: { send: 'Send', title: /<title>Test Shop<\/title>/ }, fr: { send: 'Envoyer', title: /<title>Test Shop<\/title>/ } },
    boite: { en: { gateway: 'Owner token', title: /<title>Test Shop · Inbox<\/title>/ }, fr: { gateway: 'Jeton du propriétaire', title: /<title>Test Shop · Boîte<\/title>/ } },
    atelier: { en: { gateway: 'Owner token', title: /<title>Test Shop · Atelier<\/title>/ }, fr: { gateway: 'Jeton du propriétaire', title: /<title>Test Shop · Atelier<\/title>/ } },
  };
  for (const which of Object.keys(PAGES)) {
    for (const lang of ['en', 'fr']) {
      const html = render(which, ficheOf(lang, { brand: { color: '#aa3366' } }));
      const want = expectations[which][lang];
      assert.match(html, new RegExp(`^<!doctype html><html lang="${lang}">`), `${which} ${lang}`);
      assert.match(html, want.title);
      assert.equal(html.match(new RegExp(`nonce="${NONCE}"`, 'g')).length, 2, `${which} ${lang}: the style and the script`);
      assert.ok(html.includes('--brand:#aa3366'), `${which} ${lang}: the shop colour`);
      assert.doesNotMatch(html, /\sstyle\s*=\s*["']/i, `${which} ${lang}: no style attribute`);
      const cfg = cfgOf(html);
      assert.deepEqual(cfg.t, DICT[which][lang]);
      if (want.send) assert.equal(cfg.t.send, want.send);
      if (want.gateway) assert.ok(html.includes(`placeholder="${want.gateway}"`), `${which} ${lang}: the sign-in field speaks the language`);
    }
  }
  const chat = cfgOf(render('chat', ficheOf('en')));
  assert.deepEqual([chat.slug, chat.lang, chat.name, chat.hello, chat.preview], ['test-shop', 'en', 'Test Shop', 'Ask me anything', false]);
  assert.equal(cfgOf(chatPage({ fiche: ficheOf('en'), nonce: NONCE, preview: true })).preview, true);
  assert.equal(cfgOf(render('chat', ficheOf('de'))).lang, 'en', 'a language the pages do not have falls back to English');
  assert.equal(cfgOf(render('atelier', ficheOf('de'))).t.publish, 'Publish');
});

test('the page scripts parse, build the page with textContent only, and cannot close their own element', () => {
  for (const file of ['chat.js', 'boite.js', 'atelier.js', 'kit.js']) {
    const src = uiSource(file);
    assert.doesNotThrow(() => new vm.Script(src, { filename: file }), `${file} is valid JavaScript`);
    assert.doesNotMatch(stripComments(src), /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function/, `${file}: data goes in with textContent, never as markup`);
    assert.doesNotMatch(src, /<\/script|<!--/i, `${file}: nothing in it can end or confuse its <script> element`);
  }
  for (const file of ['chat.css', 'owner.css']) assert.doesNotMatch(uiSource(file), /<\/style|@import|url\(\s*["']?https?:/i, file);
  assert.equal(esc(`<a href="x" onclick='y'>&</a>`), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  const hostile = safeJson({ a: '</script><!--', b: `${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}` });
  assert.doesNotMatch(hostile, /</);
  assert.ok(!hostile.includes(String.fromCharCode(0x2028)) && !hostile.includes(String.fromCharCode(0x2029)));
  assert.deepEqual(JSON.parse(hostile), { a: '</script><!--', b: `${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}` }, 'and it reads back unchanged');
});

// ---------------------------------------------------------------------------------------------------------------- dictionaries

test('every key the page scripts ask for exists in both languages', () => {
  for (const which of Object.keys(PAGES)) {
    const { fixed } = keysUsed(which);
    assert.ok(fixed.size >= 10, `${which}: the scan found ${fixed.size} keys, the pattern is probably stale`);
    for (const lang of ['en', 'fr']) {
      const missing = [...fixed].filter((k) => !(k in DICT[which][lang]));
      assert.deepEqual(missing, [], `${which} (${lang}) misses keys its script uses`);
    }
  }
});

test('the keys built at run time (a prefix and a value) are all listed, and every value the server can send has its words', async () => {
  const { kinds, blockers } = await studioFacts();
  const diffPaths = new Set();
  const risks = new Set();
  for (const d of diffFiches(ficheOf('en'), parseFiche({ ...BASE, ...FULL_CHANGE }).fiche)) { diffPaths.add(d.path); risks.add(d.risk); }
  assert.ok(diffPaths.size >= 15, 'the maximal change exercises most of the diff');
  const needs = [...new Set(Object.values(ACTION_INFO).map((a) => a.needs).filter(Boolean))];
  const actionKeys = [...Object.keys(ACTION_INFO), 'report_unanswered'].map((n) => `act.${n}`);

  // Prefix -> every full key it can build. A prefix the script builds that is not listed here fails the test: list its values.
  const FAMILIES = {
    boite: {
      'act.': actionKeys, 'ch_': Object.keys(LEVELS).map((c) => `ch_${c}`), 'f_': ['first_name', 'email', 'preference'].map((f) => `f_${f}`),
      l: [1, 2, 3].map((n) => `l${n}`),
    },
    atelier: {
      'act.': actionKeys, 'needs_': needs.map((n) => `needs_${n}`), 'm_': MODES.map((m) => `m_${m}`), d: [0, 1, 2, 3, 4, 5, 6].map((n) => `d${n}`),
      'f_': ['first_name', 'email', 'preference'].map((f) => `f_${f}`), 'risk_': [...risks].map((r) => `risk_${r}`), 'j_': [...kinds].map((k) => `j_${k}`),
      // The diff paths a person reads; low-level numbers with no control in the page fall back to the raw path on purpose.
      'd_': [...diffPaths].filter((p) => !p.startsWith('action.') && !/^(limits\.|budget\.(currency|timezone|inPerToken|outPerToken|charsPerToken)$)/.test(p)).map((p) => `d_${p}`),
    },
    chat: {},
  };
  for (const which of Object.keys(FAMILIES)) {
    const { prefixes } = keysUsed(which);
    assert.deepEqual([...prefixes].filter((p) => !(p in FAMILIES[which])).sort(), [], `${which}: a key is built from a prefix this test does not list`);
    for (const lang of ['en', 'fr']) {
      for (const [prefix, full] of Object.entries(FAMILIES[which])) {
        assert.ok(full.length > 0, `${which} ${prefix}: the family is empty`);
        assert.deepEqual(full.filter((k) => !(k in DICT[which][lang])), [], `${which} (${lang}) ${prefix}*`);
      }
    }
  }
  assert.deepEqual([...risks].sort(), ['high', 'low', 'medium']);
  assert.deepEqual([...kinds].sort(), ['checks', 'discard', 'draft', 'publish', 'review', 'rollback']);
  assert.ok(['act.leave_message', 'act.book_appointment', 'act.order_status', 'act.report_unanswered'].every((k) => actionKeys.includes(k)));

  // The Atelier's table from a blocker code to a sentence covers every code the studio can raise.
  const table = /BLOCK_TEXT = \{([^}]*)\}/.exec(uiSource('atelier.js'))[1];
  const map = Object.fromEntries([...table.matchAll(/(\w+):\s*'(\w+)'/g)].map((m) => [m[1], m[2]]));
  assert.deepEqual([...blockers].sort(), ['checks_failed', 'checks_missing', 'no_changes', 'not_reviewed', 'unvalidated_facts']);
  assert.deepEqual(Object.keys(map).sort(), [...blockers].sort(), 'one sentence per blocker code');
  for (const lang of ['en', 'fr']) assert.deepEqual(Object.values(map).filter((k) => !(k in DICT.atelier[lang])), [], `atelier (${lang}) blocker sentences`);

  // The chat's "my data" list titles each remembered field with its own key.
  for (const lang of ['en', 'fr']) for (const f of ['first_name', 'email', 'preference']) assert.ok(f in DICT.chat[lang], `chat (${lang}) ${f}`);
});

test('English and French have the same keys and the same {placeholders}, and French is not English left in place', () => {
  // Words that are the same in both languages (a product name, a shared word): listed so a forgotten translation stands out.
  const SAME_IN_BOTH = { boite: ['ch_tg', 'ch_wa', 'ch_web', 'did', 'tabChats'], atelier: ['ch_tg', 'ch_wa', 'ch_web', 'gAgenda', 'journal', 'source', 'title', 'versionsTitle'], chat: [] };
  for (const which of Object.keys(DICT)) {
    const { en, fr } = DICT[which];
    assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort(), `${which}: the two languages have the same keys`);
    for (const k of Object.keys(en)) {
      assert.deepEqual(placeholders(fr[k]), placeholders(en[k]), `${which}.${k}: same placeholders`);
      assert.ok(typeof en[k] === 'string' && en[k] && typeof fr[k] === 'string' && fr[k], `${which}.${k}: not empty`);
    }
    const untranslated = Object.keys(en).filter((k) => en[k] === fr[k]);
    assert.deepEqual(untranslated.sort(), SAME_IN_BOTH[which], `${which}: French strings identical to the English ones`);
  }
  // The visitor-facing sentences of core/text.mjs: same keys, same placeholders.
  const block = (name) => new RegExp(`const ${name} = \\{([\\s\\S]*?)\\n\\};`).exec(textSource())[1];
  const keysOf = (src) => [...src.matchAll(/^\s*'([a-z][a-z0-9._]*)':/gm)].map((m) => m[1]);
  const en = keysOf(block('EN'));
  assert.ok(en.length > 20);
  assert.deepEqual(keysOf(block('FR')).sort(), [...en].sort(), 'text.mjs: the two languages have the same keys');
  for (const k of en) {
    assert.deepEqual(placeholders(say('fr', k)), placeholders(say('en', k)), `text.${k}`);
    assert.notEqual(say('fr', k), say('en', k), `text.${k} is translated`);
    assert.notEqual(say('en', k), k, `text.${k} exists`);
  }
});

test('the French speaks to the reader as "tu", never "vous"', () => {
  const french = [];
  for (const which of Object.keys(DICT)) for (const [k, v] of Object.entries(DICT[which].fr)) french.push([`${which}.${k}`, v]);
  const src = textSource();
  for (const m of src.matchAll(/^\s*'([a-z][a-z0-9._]*)':/gm)) french.push([`text.${m[1]}`, say('fr', m[1])]);
  assert.ok(french.length > 250, `${french.length} French strings were checked`);
  // "rendez-vous" (an appointment) is a noun, not a "vous" form.
  const words = french.map(([k, v]) => [k, v.replace(/rendez-vous/gi, 'RDV')]);
  const formal = words.filter(([, v]) => /(?<![\p{L}-])(vous|votre|vos)(?!\p{L})/iu.test(v)).map(([k]) => k);
  assert.deepEqual(formal, [], 'the formal "vous" is used');
  // A "vous" imperative needs no "vous" ("Cliquez", "Réessayez"): any word ending in -ez that is not a place or an adverb.
  const imperative = words.filter(([, v]) => /(?<!\p{L})(?!chez(?!\p{L})|assez(?!\p{L}))\p{L}{3,}ez(?!\p{L})/iu.test(v)).map(([k, v]) => `${k}: ${v}`);
  assert.deepEqual(imperative, [], 'a "vous" imperative is used');
  assert.ok(french.some(([, v]) => /\b(ton|ta|tes|toi|tu|t’)/i.test(v)), 'and the "tu" register is really there');
  assert.ok(french.some(([, v]) => /\b(Écris|Clique|Réessaie|Reviens)\b/.test(v)));
});

// ---------------------------------------------------------------------------------------------------------------- hostile fiche

test('a fiche that tries to close the script or break an attribute cannot get out of the chat page', () => {
  const evil = `</script><img onerror=1>"'&<!--<script>alert(1)</script>`;
  const f = parseFiche({ ...BASE, name: evil, identity: evil, brand: { greeting: evil, color: 'red;}</style><script>alert(1)</script>' } }).fiche;
  const html = chatPage({ fiche: f, nonce: NONCE });
  assert.ok(!html.includes('<img onerror=1>'), 'no element came out of the fiche');
  assert.deepEqual(blocksOf(html).map((b) => b[1]), ['style', 'script', 'script'], 'the style, the JSON block and the page script: nothing else');
  assert.doesNotMatch(outsideBlocks(html), /<(script|style|img)\b/, 'and nothing between them');
  assert.ok(html.includes('<title>&lt;/script&gt;&lt;img onerror=1&gt;&quot;&#39;&amp;&lt;!--&lt;script&gt;alert(1)&lt;/script&gt;</title>'), 'the title is escaped');
  assert.ok(html.includes('--brand:#2F6B54'), 'a colour that is not #rrggbb falls back to the default');
  assert.doesNotMatch(blocksOf(html)[0][3], /alert|</, 'the stylesheet holds nothing from the fiche but the colour');
  const json = blocksOf(html)[1][3];
  assert.ok(!json.includes('<'), 'the JSON block holds no raw "<"');
  const cfg = JSON.parse(json);
  assert.deepEqual([cfg.name, cfg.hello], [evil, evil], 'and reads back as the plain text it was');
});

test('line separators in a name are escaped in the JSON block, and the owner pages escape the name too', () => {
  const ls = String.fromCharCode(0x2028);
  const ps = String.fromCharCode(0x2029);
  const f = ficheOf('en', { name: `Shop${ls}One${ps}Two` });
  const json = /<script type="application\/json" id="cfg">([\s\S]*?)<\/script>/.exec(chatPage({ fiche: f, nonce: NONCE }))[1];
  assert.ok(!json.includes(ls) && !json.includes(ps));
  assert.equal(JSON.parse(json).name, `Shop${ls}One${ps}Two`);

  const evil = '</title><script>alert(1)</script>';
  const g = ficheOf('fr', { name: evil });
  for (const which of ['boite', 'atelier']) {
    const html = render(which, g);
    assert.ok(html.includes(`<title>${esc(evil)} · `), `${which}: the name is escaped in the title`);
    assert.deepEqual(blocksOf(html).map((b) => b[1]), ['style', 'script', 'script'], `${which}: still one style and two script elements`);
    assert.doesNotMatch(outsideBlocks(html), /<(script|style)\b/, which);
  }
});
