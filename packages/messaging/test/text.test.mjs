import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFileMarkers, safeFileName, splitMessage, TELEGRAM_TEXT_LIMIT } from '../core/text.mjs';

test('splitMessage leaves a short text intact', () => {
  assert.deepEqual(splitMessage('bonjour'), ['bonjour']);
  assert.deepEqual(splitMessage(''), []);
});

test('splitMessage splits under the limit and prefers boundaries', () => {
  const paragraph = 'a'.repeat(2000);
  const text = [paragraph, paragraph, paragraph].join('\n\n');
  const chunks = splitMessage(text, 2500);
  assert.ok(chunks.length >= 2);
  for (const chunk of chunks) assert.ok(chunk.length <= 2500, `chunk too long: ${chunk.length}`);
  assert.equal(chunks.join('').replace(/\s+/g, '').length, text.replace(/\s+/g, '').length);
});

test('splitMessage closes an open code block', () => {
  const text = '```\n' + 'ligne de code\n'.repeat(400) + '```\n';
  const chunks = splitMessage(text, 600);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks.slice(0, -1)) {
    const fences = (chunk.match(/```/g) || []).length;
    assert.equal(fences % 2, 0, 'code block left open');
  }
  for (const chunk of chunks) assert.ok(chunk.length <= 600);
});

test('splitMessage always respects the default Telegram limit', () => {
  const chunks = splitMessage('x'.repeat(10000));
  assert.ok(chunks.length >= 3);
  for (const chunk of chunks) assert.ok(chunk.length <= TELEGRAM_TEXT_LIMIT);
});

test('extractFileMarkers removes the markers and resolves relative paths', () => {
  const { text, files } = extractFileMarkers('here is the report\n[[send-file:./report.txt]]\nand that is all', '/tmp/ws');
  assert.deepEqual(files, ['/tmp/ws/report.txt']);
  assert.equal(text, 'here is the report\n\nand that is all');
  assert.ok(!text.includes('send-file'));
});

test('extractFileMarkers keeps absolute paths as they are', () => {
  const { files } = extractFileMarkers('[[send-file: /tmp/a b.pdf ]]');
  assert.deepEqual(files, ['/tmp/a b.pdf']);
});

test('safeFileName blocks directory traversal', () => {
  assert.equal(safeFileName('../../etc/passwd'), 'passwd');
  assert.equal(safeFileName('C:\\Users\\x\\photo.jpg'), 'photo.jpg');
  assert.equal(safeFileName(''), 'file');
});
