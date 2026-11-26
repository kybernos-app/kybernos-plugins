import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createBridge } from '../core/runner.mjs';
import { emptyState, loadState, saveState } from '../core/state.mjs';

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-bridge-run-'));
}

function fakeAdapter() {
  const sent = [];
  const edits = [];
  const files = [];
  return {
    name: 'fake',
    sent,
    edits,
    files,
    async send(chatId, text) {
      const message = { chatId, messageId: sent.length + 1, text };
      sent.push(message);
      return message;
    },
    async edit(chatId, messageId, text) {
      edits.push({ chatId, messageId, text });
      return true;
    },
    async sendFile(chatId, file) {
      files.push({ chatId, file });
      return { messageId: 999 };
    },
  };
}

function makeBridge(overrides = {}) {
  const dir = tmpdir();
  const stateFile = path.join(dir, 'state.json');
  const state = emptyState();
  const adapter = fakeAdapter();
  const config = {
    allowedChats: new Set(['42']),
    allowAll: false,
    defaultChat: '42',
    workspaceRoot: path.join(dir, 'ws'),
    statePath: stateFile,
    dshBin: 'dsh',
    dshProfile: 'headless',
    dshArgs: [],
    timeoutMs: 5000,
    minEditIntervalMs: 0,
    maxQueuePerChat: 5,
    ...overrides.config,
  };
  const calls = [];
  const runTask =
    overrides.runTask ||
    (async ({ task, sessionId, cwd }) => {
      calls.push({ task, sessionId, cwd });
      return {
        ok: true,
        exitCode: 0,
        sessionId: sessionId || 'session-fake-0001',
        final: `echo: ${task}`,
        error: null,
        usage: { totalTokens: 3 },
        stderr: '',
        durationMs: 5,
        timedOut: false,
        aborted: false,
        events: [],
      };
    });
  const logs = [];
  const bridge = createBridge({ adapter, config, state, stateFile, runTask, log: (line) => logs.push(line) });
  return { bridge, adapter, state, stateFile, calls, config, dir, logs };
}

const wait = () => new Promise((resolve) => setTimeout(resolve, 30));

test('an allowed message creates the placeholder, streams, then publishes the answer', async () => {
  const { bridge, adapter, state, stateFile } = makeBridge();
  await bridge.handleIncoming({ chatId: '42', messageId: 1, text: 'hello' });
  await wait();

  assert.ok(adapter.sent.length >= 1);
  assert.equal(adapter.sent[0].text, '⏳ DeepSeek Harness is working…');
  const last = adapter.edits.at(-1);
  assert.match(last.text, /echo: hello/);

  const persisted = loadState(stateFile);
  assert.equal(persisted.chats['42'].sessionId, 'session-fake-0001');
  assert.equal(state.chats['42'].messages, 1);
});

test('the next message resumes the same session', async () => {
  const { bridge, calls } = makeBridge();
  await bridge.handleIncoming({ chatId: '42', messageId: 1, text: 'one' });
  await bridge.handleIncoming({ chatId: '42', messageId: 2, text: 'two' });
  await wait();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].sessionId, null);
  assert.equal(calls[1].sessionId, 'session-fake-0001');
});

test('a chat outside the allowlist is refused without starting DSH', async () => {
  const { bridge, adapter, calls, logs } = makeBridge();
  await bridge.handleIncoming({ chatId: '99', messageId: 1, text: 'hi there' });
  await wait();
  assert.equal(calls.length, 0);
  assert.match(adapter.sent[0].text, /not allowed to drive/);
  assert.match(adapter.sent[0].text, /99/);
  assert.ok(logs.some((l) => /refused: chat 99 is not in the allowlist/.test(l)), 'the operator log is English');
});

test('/new resets the session and /status reports', async () => {
  const { bridge, adapter, state, calls } = makeBridge();
  await bridge.handleIncoming({ chatId: '42', messageId: 1, text: 'one' });
  await wait();
  await bridge.handleIncoming({ chatId: '42', messageId: 2, text: '/new' });
  assert.equal(state.chats['42'].sessionId, null);
  assert.match(adapter.sent.at(-1).text, /Fresh session/);
  await bridge.handleIncoming({ chatId: '42', messageId: 3, text: 'three' });
  await wait();
  assert.equal(calls.at(-1).sessionId, null, 'after /new the session must be fresh');

  await bridge.handleIncoming({ chatId: '42', messageId: 4, text: '/status' });
  const status = adapter.sent.at(-1).text;
  assert.match(status, /Bridge status/);
  assert.match(status, /channel: fake/);
  assert.match(status, /session-fake-0001/);
  assert.match(status, /message: idle/);
  assert.match(status, /last turn: ok in 0\.0 s \(3 tokens\)/);
});

test('/help lists the commands', async () => {
  const { bridge, adapter } = makeBridge();
  await bridge.handleIncoming({ chatId: '42', messageId: 1, text: '/help' });
  assert.match(adapter.sent.at(-1).text, /Available commands/);
  assert.match(adapter.sent.at(-1).text, /\/new/);
  assert.match(adapter.sent.at(-1).text, /\/status/);
});

test('an empty answer is not silent and a failure is explained', async () => {
  const failing = async () => ({
    ok: false,
    exitCode: 1,
    sessionId: 'session-fake-0001',
    final: '',
    error: null,
    usage: null,
    stderr: 'fake-dsh: turn interrupted',
    durationMs: 5,
    timedOut: false,
    aborted: false,
    events: [],
  });
  const { bridge, adapter } = makeBridge({ runTask: failing });
  await bridge.handleIncoming({ chatId: '42', messageId: 1, text: 'FAIL' });
  await wait();
  const last = adapter.edits.at(-1).text;
  assert.match(last, /❌ Turn failed: code 1/);
  assert.match(last, /turn interrupted/);

  const empty = makeBridge({
    runTask: async () => ({ ok: true, exitCode: 0, sessionId: 's', final: '', error: null, usage: null, stderr: '', durationMs: 1, timedOut: false, aborted: false, events: [] }),
  });
  await empty.bridge.handleIncoming({ chatId: '42', messageId: 1, text: 'x' });
  await wait();
  assert.equal(empty.adapter.edits.at(-1).text, '(empty reply)');

  const slow = makeBridge({
    runTask: async () => ({ ok: false, exitCode: null, sessionId: 's', final: '', error: null, usage: null, stderr: '', durationMs: 1, timedOut: true, aborted: false, events: [] }),
    config: { timeoutMs: 1000 },
  });
  await slow.bridge.handleIncoming({ chatId: '42', messageId: 1, text: 'x' });
  await wait();
  assert.match(slow.adapter.edits.at(-1).text, /Turn failed: timed out \(1 s\)/);
});

test('send-file markers are sent as attachments and removed from the text', async () => {
  const dir = tmpdir();
  const file = path.join(dir, 'report.txt');
  fs.writeFileSync(file, 'content');
  const runTask = async ({ sessionId }) => ({
    ok: true,
    exitCode: 0,
    sessionId: sessionId || 'session-fake-0001',
    final: `here is the report\n[[send-file:${file}]]`,
    error: null,
    usage: null,
    stderr: '',
    durationMs: 5,
    timedOut: false,
    aborted: false,
    events: [],
  });
  const { bridge, adapter } = makeBridge({ runTask });
  await bridge.handleIncoming({ chatId: '42', messageId: 1, text: 'FILE' });
  await wait();
  assert.deepEqual(adapter.files.map((f) => f.file), [file]);
  assert.ok(!adapter.edits.at(-1).text.includes('send-file'));
});

test('an adapter without sendFile does not break the delivery', async () => {
  const dir = tmpdir();
  const file = path.join(dir, 'report.txt');
  fs.writeFileSync(file, 'content');
  const { bridge, adapter } = makeBridge({
    runTask: async ({ sessionId }) => ({
      ok: true,
      exitCode: 0,
      sessionId: sessionId || 'session-fake-0001',
      final: `report\n[[send-file:${file}]]`,
      error: null,
      usage: null,
      stderr: '',
      durationMs: 5,
      timedOut: false,
      aborted: false,
      events: [],
    }),
  });
  delete adapter.sendFile;
  await bridge.handleIncoming({ chatId: '42', messageId: 1, text: 'FILE' });
  await wait();
  assert.match(adapter.edits.at(-1).text, /report/);
});

test('a marker that names a missing file says so', async () => {
  const { bridge, adapter } = makeBridge({
    runTask: async () => ({ ok: true, exitCode: 0, sessionId: 's', final: 'x\n[[send-file:/nope/missing.txt]]', error: null, usage: null, stderr: '', durationMs: 1, timedOut: false, aborted: false, events: [] }),
  });
  await bridge.handleIncoming({ chatId: '42', messageId: 1, text: 'x' });
  await wait();
  assert.ok(adapter.sent.some((m) => /file not found: \/nope\/missing\.txt/.test(m.text)));
});

test('notify refuses a chat outside the allowlist and accepts the target chat', async () => {
  const { bridge, adapter } = makeBridge();
  await assert.rejects(() => bridge.notify('999', 'test'), /not in the allowlist/);
  await assert.rejects(() => makeBridge({ config: { defaultChat: null } }).bridge.notify('', 'x'), /no target chat/);
  await bridge.notify('42', 'proactive message');
  assert.equal(adapter.sent.at(-1).text, 'proactive message');
});

test('concurrent messages of one chat are queued', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const seen = [];
  const runTask = async ({ task, sessionId }) => {
    seen.push(task);
    if (seen.length === 1) await gate;
    return {
      ok: true,
      exitCode: 0,
      sessionId: sessionId || 'session-fake-0001',
      final: `ok: ${task}`,
      error: null,
      usage: null,
      stderr: '',
      durationMs: 1,
      timedOut: false,
      aborted: false,
      events: [],
    };
  };
  const { bridge, adapter, state } = makeBridge({ runTask, config: { maxQueuePerChat: 2 } });
  const first = bridge.handleIncoming({ chatId: '42', messageId: 1, text: 'one' });
  await wait();
  await bridge.handleIncoming({ chatId: '42', messageId: 2, text: 'two' });
  assert.match(adapter.sent.at(-1).text, /Queued \(position 1\)/);
  release();
  await first;
  await wait();
  assert.deepEqual(seen, ['one', 'two']);
  assert.equal(state.chats['42'].messages, 2);
});

test('a full queue says so, and says « 1 message » when the limit is one', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const runTask = async ({ sessionId }) => {
    await gate;
    return { ok: true, exitCode: 0, sessionId: sessionId || 's', final: 'ok', error: null, usage: null, stderr: '', durationMs: 1, timedOut: false, aborted: false, events: [] };
  };
  const { bridge, adapter } = makeBridge({ runTask, config: { maxQueuePerChat: 1 } });
  const first = bridge.handleIncoming({ chatId: '42', messageId: 1, text: 'one' });
  await wait();
  await bridge.handleIncoming({ chatId: '42', messageId: 2, text: 'two' });
  await bridge.handleIncoming({ chatId: '42', messageId: 3, text: 'three' });
  assert.match(adapter.sent.at(-1).text, /Queue full \(1 message\)\./);
  assert.ok(!/1 messages/.test(adapter.sent.at(-1).text));
  release();
  await first;
  await wait();
});

test('the intermediate state is written to disk', async () => {
  const { bridge, stateFile, state } = makeBridge();
  await bridge.handleIncoming({ chatId: '42', messageId: 1, text: 'one' });
  await wait();
  saveState(stateFile, state);
  assert.equal(loadState(stateFile).chats['42'].messages, 1);
});

// ── the language of the bridge's own sentences ──────────────────────────────────────────────────

test('a French-speaking sender gets French sentences, in « tu »; any other language gets English', async () => {
  const { bridge, adapter } = makeBridge();
  await bridge.handleIncoming({ chatId: '42', messageId: 1, text: '/help', lang: 'fr' });
  assert.match(adapter.sent.at(-1).text, /Commandes disponibles/);
  await bridge.handleIncoming({ chatId: '42', messageId: 2, text: '/help', lang: 'fr-CA' });
  assert.match(adapter.sent.at(-1).text, /Commandes disponibles/);
  for (const lang of ['en', 'en-GB', 'es', 'de', 'ar', '', null, undefined]) {
    await bridge.handleIncoming({ chatId: '42', messageId: 3, text: '/help', lang });
    assert.match(adapter.sent.at(-1).text, /Available commands/, `lang ${JSON.stringify(lang)}`);
  }
  await bridge.handleIncoming({ chatId: '42', messageId: 4, text: '/new', lang: 'fr' });
  assert.match(adapter.sent.at(-1).text, /Session suivante neuve/);
  await bridge.handleIncoming({ chatId: '99', messageId: 5, text: 'salut', lang: 'fr' });
  assert.match(adapter.sent.at(-1).text, /Ce chat n’est pas autorisé/);
  assert.match(adapter.sent.at(-1).text, /--allow 99/);
});

test('the placeholder, the progress and the failure follow the sender’s language, the operator log does not', async () => {
  const runTask = async ({ onEvent }) => {
    onEvent({ type: 'tool_call', name: 'run_code' });
    onEvent({ type: 'status', phase: 'step_end', step: 2, usage: { totalTokens: 1 } });
    return { ok: false, exitCode: 3, sessionId: 's', final: '', error: null, usage: null, stderr: '', durationMs: 1, timedOut: false, aborted: false, events: [] };
  };
  const { bridge, adapter, logs } = makeBridge({ runTask });
  await bridge.handleIncoming({ chatId: '42', messageId: 1, text: 'x', lang: 'fr' });
  await wait();
  assert.equal(adapter.sent[0].text, '⏳ DeepSeek Harness travaille…');
  assert.ok(adapter.edits.some((e) => /🔧 run_code/.test(e.text)));
  assert.match(adapter.edits.at(-1).text, /❌ Échec du tour : code 3/);
  assert.ok(logs.every((l) => !/[àâçéèêëîïôùûœ]/.test(l)), 'the log lines are English: ' + logs.join(' | '));
  assert.ok(logs.some((l) => /turn 42 finished: failed in 1 ms/.test(l)));
});

test('the task handed to DSH is English whatever the sender’s language, attachments included', async () => {
  const { bridge, calls } = makeBridge();
  await bridge.handleIncoming({ chatId: '42', messageId: 1, text: 'regarde ça', lang: 'fr', attachments: [{ kind: 'photo', localPath: '/tmp/x/photo.jpg', name: 'photo.jpg' }] });
  await wait();
  assert.match(calls[0].task, /^Attachments received with this message:\n- \/tmp\/x\/photo\.jpg \(photo\)\n\nregarde ça\n\n\(The files above are in the current working folder\./);
});
