// État persistant du pont : mapping chat → session DSH, allowlist, journal léger.
// Écrit en 0600, de façon atomique (tmp + rename).

import fs from 'node:fs';
import path from 'node:path';

export const STATE_VERSION = 1;

export function emptyState() {
  return { version: STATE_VERSION, chats: {}, allowlist: [], offset: 0, updatedAt: null };
}

export function loadState(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const state = emptyState();
    if (parsed && typeof parsed === 'object') {
      state.chats = parsed.chats && typeof parsed.chats === 'object' ? parsed.chats : {};
      state.allowlist = Array.isArray(parsed.allowlist) ? parsed.allowlist.map(String) : [];
      state.offset = Number.isFinite(parsed.offset) ? parsed.offset : 0;
      state.updatedAt = parsed.updatedAt ?? null;
    }
    return state;
  } catch {
    return emptyState();
  }
}

export function saveState(file, state) {
  state.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* best effort */
  }
  return state;
}

export function chatEntry(state, chatId) {
  return state.chats[String(chatId)] || null;
}

export function ensureChat(state, chatId, { workspace }) {
  const key = String(chatId);
  if (!state.chats[key]) {
    state.chats[key] = {
      chatId: key,
      sessionId: null,
      workspace,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: 0,
    };
  }
  return state.chats[key];
}

export function isAllowed(state, chatId, config) {
  if (config?.allowAll) return true;
  const key = String(chatId);
  if (state.allowlist.includes(key)) return true;
  return Boolean(config?.allowedChats?.has(key));
}

export function allowChat(state, chatId) {
  const key = String(chatId);
  if (!state.allowlist.includes(key)) state.allowlist.push(key);
  return state;
}
