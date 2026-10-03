import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createEventParser, runHeadless } from '../core/dsh-run.mjs';

const FIXTURE = fileURLToPath(new URL('./fixtures/fake-dsh.mjs', import.meta.url));

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-run-'));
}

function run(options = {}) {
  return runHeadless({
    dshBin: process.execPath,
    dshArgsPrefix: [FIXTURE],
    cwd: tmpdir(),
    timeoutMs: 20000,
    ...options,
  });
}

test('createEventParser assemble les lignes incomplètes et ignore le non-JSON', () => {
  const seen = [];
  const parser = createEventParser((e) => seen.push(e));
  parser.feed('{"type":"text","text":"a"}\n{"type":"te');
  parser.feed('xt","text":"b"}\npas du json\n');
  parser.flush();
  assert.deepEqual(seen.map((e) => e.type), ['text', 'text']);
  assert.equal(parser.state.nonJsonLines, 1);
});

test('runHeadless capture la session, la réponse finale et les événements', async () => {
  const events = [];
  const result = await run({ task: 'bonjour', onEvent: (e) => events.push(e.type) });
  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  assert.equal(result.sessionId, 'session-fake-0001');
  assert.equal(result.final, 'écho: bonjour');
  assert.equal(result.usage.totalTokens, 42);
  assert.ok(events.includes('tool_call'));
  assert.ok(events.includes('final'));
});

test('runHeadless adopte une session existante', async () => {
  const result = await run({ task: 'suite', sessionId: 'session-fake-0001' });
  assert.equal(result.ok, true);
  assert.equal(result.sessionId, 'session-fake-0001');
});

test('runHeadless signale un échec de tour', async () => {
  const result = await run({ task: 'ÉCHEC' });
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 1);
  assert.equal(result.turnEnd.reason.kind, 'aborted');
  assert.match(result.stderr, /tour interrompu/);
});

test('runHeadless respecte le délai et tue le processus', async () => {
  const started = Date.now();
  const result = await run({ task: 'LENT', timeoutMs: 700 });
  assert.equal(result.timedOut, true);
  assert.equal(result.ok, false);
  assert.ok(Date.now() - started < 5000, 'le processus aurait dû être tué rapidement');
});

test('runHeadless s’arrête sur un signal d’abandon', async () => {
  const controller = new AbortController();
  const promise = run({ task: 'LENT', signal: controller.signal });
  setTimeout(() => controller.abort(), 200);
  const result = await promise;
  assert.equal(result.aborted, true);
  assert.equal(result.ok, false);
});
