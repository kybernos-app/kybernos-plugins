import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadConfig, parseEnvFile } from '../core/config.mjs';
import { allowChat, emptyState, isAllowed, loadState, saveState } from '../core/state.mjs';

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-bridge-'));
}

test('parseEnvFile lit KEY=VALUE, ignore commentaires et gère les quotes', () => {
  const env = parseEnvFile('# commentaire\nA=1\nB="deux mots"\nC=\nD=espaces  \ninvalid\n');
  assert.deepEqual(env, { A: '1', B: 'deux mots', C: '', D: 'espaces' });
});

test('loadConfig résout token, chat par défaut et allowlist depuis le .env', () => {
  const dir = tmpdir();
  const envFile = path.join(dir, '.env');
  fs.writeFileSync(envFile, 'TELEGRAM_BOT_TOKEN=123:ABC\nTELEGRAM_CHAT_ID=4242\n');
  const cfg = loadConfig({
    configPath: path.join(dir, 'config.json'),
    env: { TELEGRAM_ENV_FILE: envFile },
  });
  assert.equal(cfg.token, '123:ABC');
  assert.equal(cfg.defaultChat, '4242');
  assert.ok(cfg.allowedChats.has('4242'));
  assert.equal(cfg.dshProfile, 'headless');
});

test('loadConfig donne la priorité à process.env sur le fichier .env', () => {
  const dir = tmpdir();
  const envFile = path.join(dir, '.env');
  fs.writeFileSync(envFile, 'TELEGRAM_BOT_TOKEN=fichier\nTELEGRAM_CHAT_ID=1\n');
  const cfg = loadConfig({
    configPath: path.join(dir, 'config.json'),
    env: { TELEGRAM_ENV_FILE: envFile, TELEGRAM_BOT_TOKEN: 'process' },
  });
  assert.equal(cfg.token, 'process');
});

test('loadConfig accepte des chats autorisés supplémentaires', () => {
  const dir = tmpdir();
  const envFile = path.join(dir, '.env');
  fs.writeFileSync(envFile, 'TELEGRAM_BOT_TOKEN=t\nTELEGRAM_CHAT_ID=1\nTELEGRAM_ALLOWED_CHATS=7, 8\n');
  const cfg = loadConfig({ configPath: path.join(dir, 'config.json'), env: { TELEGRAM_ENV_FILE: envFile } });
  assert.deepEqual([...cfg.allowedChats].sort(), ['1', '7', '8']);
});

test('loadConfig signale un .env absent sans échouer', () => {
  const dir = tmpdir();
  const cfg = loadConfig({ configPath: path.join(dir, 'config.json'), env: { TELEGRAM_ENV_FILE: path.join(dir, 'absent.env') } });
  assert.equal(cfg.token, null);
  assert.ok(cfg.notes.some((n) => n.includes('illisible')));
});

test('l’état se relit à l’identique et reste en 0600', () => {
  const dir = tmpdir();
  const file = path.join(dir, 'state.json');
  const state = emptyState();
  allowChat(state, '42');
  state.chats['42'] = { chatId: '42', sessionId: 'session-1', workspace: '/tmp/x' };
  state.offset = 17;
  saveState(file, state);

  const mode = fs.statSync(file).mode & 0o777;
  assert.equal(mode, 0o600);

  const back = loadState(file);
  assert.equal(back.offset, 17);
  assert.equal(back.chats['42'].sessionId, 'session-1');
  assert.deepEqual(back.allowlist, ['42']);
});

test('isAllowed obéit à l’allowlist, au .env et à allowAll', () => {
  const state = emptyState();
  const cfg = { allowAll: false, allowedChats: new Set(['7']) };
  assert.equal(isAllowed(state, '7', cfg), true);
  assert.equal(isAllowed(state, '8', cfg), false);
  allowChat(state, '8');
  assert.equal(isAllowed(state, '8', cfg), true);
  assert.equal(isAllowed(state, '999', { allowAll: true, allowedChats: new Set() }), true);
});

test('loadState tolère un fichier corrompu', () => {
  const dir = tmpdir();
  const file = path.join(dir, 'state.json');
  fs.writeFileSync(file, '{ ce n’est pas du JSON');
  const state = loadState(file);
  assert.deepEqual(state.chats, {});
  assert.equal(state.offset, 0);
});
