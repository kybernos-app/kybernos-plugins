import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFileMarkers, safeFileName, splitMessage, TELEGRAM_TEXT_LIMIT } from '../core/text.mjs';

test('splitMessage laisse intact un texte court', () => {
  assert.deepEqual(splitMessage('bonjour'), ['bonjour']);
  assert.deepEqual(splitMessage(''), []);
});

test('splitMessage découpe sous la limite et préfère les frontières', () => {
  const paragraph = 'a'.repeat(2000);
  const text = [paragraph, paragraph, paragraph].join('\n\n');
  const chunks = splitMessage(text, 2500);
  assert.ok(chunks.length >= 2);
  for (const chunk of chunks) assert.ok(chunk.length <= 2500, `morceau trop long: ${chunk.length}`);
  assert.equal(chunks.join('').replace(/\s+/g, '').length, text.replace(/\s+/g, '').length);
});

test('splitMessage referme un bloc de code ouvert', () => {
  const text = '```\n' + 'ligne de code\n'.repeat(400) + '```\n';
  const chunks = splitMessage(text, 600);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks.slice(0, -1)) {
    const fences = (chunk.match(/```/g) || []).length;
    assert.equal(fences % 2, 0, 'bloc de code laissé ouvert');
  }
  for (const chunk of chunks) assert.ok(chunk.length <= 600);
});

test('splitMessage respecte toujours la limite Telegram par défaut', () => {
  const chunks = splitMessage('x'.repeat(10000));
  assert.ok(chunks.length >= 3);
  for (const chunk of chunks) assert.ok(chunk.length <= TELEGRAM_TEXT_LIMIT);
});

test('extractFileMarkers retire les marqueurs et résout les chemins relatifs', () => {
  const { text, files } = extractFileMarkers('voici le rapport\n[[send-file:./rapport.txt]]\net voilà', '/tmp/ws');
  assert.deepEqual(files, ['/tmp/ws/rapport.txt']);
  assert.equal(text, 'voici le rapport\n\net voilà');
  assert.ok(!text.includes('send-file'));
});

test('extractFileMarkers garde les chemins absolus tels quels', () => {
  const { files } = extractFileMarkers('[[send-file: /tmp/a b.pdf ]]');
  assert.deepEqual(files, ['/tmp/a b.pdf']);
});

test('safeFileName bloque la traversée de dossier', () => {
  assert.equal(safeFileName('../../etc/passwd'), 'passwd');
  assert.equal(safeFileName('C:\\Users\\x\\photo.jpg'), 'photo.jpg');
  assert.equal(safeFileName(''), 'fichier');
});
