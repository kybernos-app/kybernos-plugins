import test from 'node:test';
import assert from 'node:assert/strict';

import { keysOf, pickLang, t } from '../core/messages.mjs';

test('pickLang: French for fr and its regional forms, English for everything else or nothing', () => {
  for (const code of ['fr', 'FR', 'fr-CA', 'fr_FR', ' fr-BE ']) assert.equal(pickLang(code), 'fr', code);
  for (const code of ['en', 'en-GB', 'es', 'de', 'ar', 'zh-hans', 'frp', 'fra', '', ' ', null, undefined, 42]) assert.equal(pickLang(code), 'en', String(code));
});

test('both languages say the same things: the same keys and the same placeholders', () => {
  assert.deepEqual(keysOf('fr').sort(), keysOf('en').sort());
  const holes = (text) => (text.match(/\{\w+\}/g) || []).sort().join();
  for (const key of keysOf('en')) {
    // an English sentence and its French twin ask for the same variables
    const en = t('en', key, {});
    const fr = t('fr', key, {});
    assert.equal(holes(fr), holes(en), key);
  }
});

test('t fills the placeholders, falls back to English for an unknown language and to the key for an unknown key', () => {
  assert.equal(t('en', 'queued', { n: 3 }), '⏳ Queued (position 3).');
  assert.equal(t('fr', 'queued', { n: 3 }), '⏳ En file d’attente (position 3).');
  assert.equal(t('de', 'queued', { n: 3 }), '⏳ Queued (position 3).');
  assert.equal(t(undefined, 'queued', { n: 3 }), '⏳ Queued (position 3).');
  assert.equal(t('en', 'no.such.key'), 'no.such.key');
  assert.equal(t('en', 'queued', {}), '⏳ Queued (position {n}).');
});

test('a count is right for one: the « .one » sentence is used when n is 1', () => {
  assert.match(t('en', 'queueFull', { n: 1 }), /\(1 message\)/);
  assert.match(t('en', 'queueFull', { n: 5 }), /\(5 messages\)/);
  assert.match(t('fr', 'queueFull', { n: 1 }), /\(1 message\)/);
  assert.match(t('fr', 'queueFull', { n: 5 }), /\(5 messages\)/);
  for (const lang of ['en', 'fr']) assert.ok(!/\b1 messages\b/.test(t(lang, 'queueFull', { n: 1 })));
});

test('the French register is « tu », and the English table holds no French', () => {
  for (const key of keysOf('fr')) assert.ok(!/\b(?:vous|votre|vos)\b|\b[A-Za-zéèêîô]+ez\b/i.test(t('fr', key, { n: 2 })), key + ': ' + t('fr', key));
  for (const key of keysOf('en')) assert.ok(!/[àâçéèêëîïôùûœ]/.test(t('en', key, { n: 2 })), key);
});
