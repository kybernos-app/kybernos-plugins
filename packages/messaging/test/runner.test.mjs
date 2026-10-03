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
        final: `écho: ${task}`,
        error: null,
        usage: { totalTokens: 3 },
        stderr: '',
        durationMs: 5,
        timedOut: false,
        aborted: false,
        events: [],
      };
    });
  const bridge = createBridge({ adapter, config, state, stateFile, runTask, log: () => {} });
  return { bridge, adapter, state, stateFile, calls, config, dir };
}

const wait = () => new Promise((resolve) => setTimeout(resolve, 30));

test('un message autorisé crée le placeholder, streame puis publie la réponse', async () => {
  const { bridge, adapter, state, stateFile } = makeBridge();
  await bridge.handleIncoming({ chatId: '42', messageId: 1, text: 'bonjour' });
  await wait();

  assert.ok(adapter.sent.length >= 1);
  assert.equal(adapter.sent[0].text, '⏳ DeepSeek Harness travaille…');
  const last = adapter.edits.at(-1);
  assert.match(last.text, /écho: bonjour/);

  const persisted = loadState(stateFile);
  assert.equal(persisted.chats['42'].sessionId, 'session-fake-0001');
  assert.equal(state.chats['42'].messages, 1);
});

test('le message suivant reprend la même session', async () => {
  const { bridge, calls } = makeBridge();
  await bridge.handleIncoming({ chatId: '42', messageId: 1, text: 'un' });
  await bridge.handleIncoming({ chatId: '42', messageId: 2, text: 'deux' });
  await wait();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].sessionId, null);
  assert.equal(calls[1].sessionId, 'session-fake-0001');
});

test('un chat hors allowlist est refusé sans lancer DSH', async () => {
  const { bridge, adapter, calls } = makeBridge();
  await bridge.handleIncoming({ chatId: '99', messageId: 1, text: 'coucou' });
  await wait();
  assert.equal(calls.length, 0);
  assert.match(adapter.sent[0].text, /n’est pas autorisé/);
  assert.match(adapter.sent[0].text, /99/);
});

test('/new remet la session à zéro et /status renseigne', async () => {
  const { bridge, adapter, state, calls } = makeBridge();
  await bridge.handleIncoming({ chatId: '42', messageId: 1, text: 'un' });
  await wait();
  await bridge.handleIncoming({ chatId: '42', messageId: 2, text: '/new' });
  assert.equal(state.chats['42'].sessionId, null);
  await bridge.handleIncoming({ chatId: '42', messageId: 3, text: 'trois' });
  await wait();
  assert.equal(calls.at(-1).sessionId, null, 'après /new la session doit être neuve');

  await bridge.handleIncoming({ chatId: '42', messageId: 4, text: '/status' });
  const status = adapter.sent.at(-1).text;
  assert.match(status, /Étât du pont|État du pont/);
  assert.match(status, /fake/);
  assert.match(status, /session-fake-0001/);
});

test('/help répond la liste des commandes', async () => {
  const { bridge, adapter } = makeBridge();
  await bridge.handleIncoming({ chatId: '42', messageId: 1, text: '/help' });
  assert.match(adapter.sent.at(-1).text, /\/new/);
  assert.match(adapter.sent.at(-1).text, /\/status/);
});

test('une réponse vide n’est pas silencieuse et un échec est expliqué', async () => {
  const failing = async () => ({
    ok: false,
    exitCode: 1,
    sessionId: 'session-fake-0001',
    final: '',
    error: null,
    usage: null,
    stderr: 'fake-dsh: tour interrompu',
    durationMs: 5,
    timedOut: false,
    aborted: false,
    events: [],
  });
  const { bridge, adapter } = makeBridge({ runTask: failing });
  await bridge.handleIncoming({ chatId: '42', messageId: 1, text: 'ÉCHEC' });
  await wait();
  const last = adapter.edits.at(-1).text;
  assert.match(last, /❌/);
  assert.match(last, /tour interrompu/);
});

test('les marqueurs send-file sont envoyés en pièce jointe et retirés du texte', async () => {
  const dir = tmpdir();
  const file = path.join(dir, 'rapport.txt');
  fs.writeFileSync(file, 'contenu');
  const runTask = async ({ sessionId }) => ({
    ok: true,
    exitCode: 0,
    sessionId: sessionId || 'session-fake-0001',
    final: `voici le rapport\n[[send-file:${file}]]`,
    error: null,
    usage: null,
    stderr: '',
    durationMs: 5,
    timedOut: false,
    aborted: false,
    events: [],
  });
  const { bridge, adapter } = makeBridge({ runTask });
  await bridge.handleIncoming({ chatId: '42', messageId: 1, text: 'FICHIER' });
  await wait();
  assert.deepEqual(adapter.files.map((f) => f.file), [file]);
  assert.ok(!adapter.edits.at(-1).text.includes('send-file'));
});

test('un adaptateur sans sendFile ne casse pas la livraison', async () => {
  const dir = tmpdir();
  const file = path.join(dir, 'rapport.txt');
  fs.writeFileSync(file, 'contenu');
  const { bridge, adapter } = makeBridge({
    runTask: async ({ sessionId }) => ({
      ok: true,
      exitCode: 0,
      sessionId: sessionId || 'session-fake-0001',
      final: `rapport\n[[send-file:${file}]]`,
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
  await bridge.handleIncoming({ chatId: '42', messageId: 1, text: 'FICHIER' });
  await wait();
  assert.match(adapter.edits.at(-1).text, /rapport/);
});

test('notify refuse un chat hors allowlist et accepte le chat cible', async () => {
  const { bridge, adapter } = makeBridge();
  await assert.rejects(() => bridge.notify('999', 'test'), /hors allowlist/);
  await bridge.notify('42', 'message proactif');
  assert.equal(adapter.sent.at(-1).text, 'message proactif');
});

test('les messages concurrents d’un même chat sont mis en file', async () => {
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
  const first = bridge.handleIncoming({ chatId: '42', messageId: 1, text: 'un' });
  await wait();
  await bridge.handleIncoming({ chatId: '42', messageId: 2, text: 'deux' });
  assert.match(adapter.sent.at(-1).text, /file d’attente/);
  release();
  await first;
  await wait();
  assert.deepEqual(seen, ['un', 'deux']);
  assert.equal(state.chats['42'].messages, 2);
});

test('l’état intermédiaire est écrit sur disque', async () => {
  const { bridge, stateFile, state } = makeBridge();
  await bridge.handleIncoming({ chatId: '42', messageId: 1, text: 'un' });
  await wait();
  saveState(stateFile, state);
  assert.equal(loadState(stateFile).chats['42'].messages, 1);
});
