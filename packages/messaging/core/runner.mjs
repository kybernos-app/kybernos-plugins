// Heart of the bridge: receives the normalised messages of an adapter, drives the DSH
// sessions (headless mode), streams the progress and sends the answer back.
//
// This file knows NO platform: everything goes through the adapter contract
// described in channels/CONTRACT.md.
//
// What a person reads in the chat comes from core/messages.mjs (English, or French for a sender whose
// language is French). What the operator reads (`log`) and the errors thrown to a CLI are English only.

import fs from 'node:fs';
import path from 'node:path';

import { runHeadless } from './dsh-run.mjs';
import { pickLang, t } from './messages.mjs';
import { extractFileMarkers, shortError, splitMessage } from './text.mjs';
import { ensureChat, isAllowed, saveState } from './state.mjs';

const MAX_PROGRESS_LINES = 4;

function slug(id) {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function tail(text, max = 600) {
  const value = String(text || '').trim();
  return value.length > max ? `…${value.slice(-max)}` : value;
}

function toolName(event) {
  return event.name || event.tool || event.toolName || event.tool?.name || null;
}

/**
 * @param {object} opts
 * @param {object} opts.adapter channel adapter (see CONTRACT.md)
 * @param {object} opts.config  resolved configuration (core/config.mjs)
 * @param {object} opts.state   loaded state (core/state.mjs)
 * @param {string} opts.stateFile path of the state file
 * @param {(event:object)=>void} [opts.runTask] injectable for the tests
 */
export function createBridge({ adapter, config, state, stateFile, runTask = runHeadless, log = () => {} }) {
  const queues = new Map(); // chatId -> array of waiting messages
  const active = new Map(); // chatId -> { startedAt }
  const lastRun = new Map(); // chatId -> summary of the last run
  const startedAt = Date.now();

  const persist = () => {
    try {
      saveState(stateFile, state);
    } catch (err) {
      log(`state not saved: ${shortError(err)}`);
    }
  };

  function workspaceFor(chatId) {
    const dir = path.join(config.workspaceRoot, slug(chatId));
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.join(dir, 'inbox'), { recursive: true, mode: 0o700 });
    return dir;
  }

  async function handleIncoming(message) {
    const chatId = String(message.chatId);
    const text = String(message.text || '').trim();
    const lang = pickLang(message.lang);

    if (!isAllowed(state, chatId, config)) {
      log(`refused: chat ${chatId} is not in the allowlist (${message.from || 'unknown'})`);
      await safeSend(chatId, t(lang, 'denied', { id: chatId }));
      return;
    }

    const command = normalizeCommand(text);
    if (command) {
      await handleCommand(chatId, command, lang);
      return;
    }
    if (!text && !(message.attachments || []).length) return;

    const pending = queues.get(chatId) || [];
    if (active.has(chatId)) {
      if (pending.length >= config.maxQueuePerChat) {
        await safeSend(chatId, t(lang, 'queueFull', { n: config.maxQueuePerChat }));
        return;
      }
      pending.push(message);
      queues.set(chatId, pending);
      await safeSend(chatId, t(lang, 'queued', { n: pending.length }));
      return;
    }
    await runMessage(chatId, message, lang);
  }

  function normalizeCommand(text) {
    if (!text.startsWith('/')) return null;
    const [raw] = text.split(/\s+/);
    const name = raw.slice(1).split('@')[0].toLowerCase();
    return { name, rest: text.slice(raw.length).trim() };
  }

  async function handleCommand(chatId, command, lang) {
    if (command.name === 'new') {
      const entry = ensureChat(state, chatId, { workspace: workspaceFor(chatId) });
      entry.sessionId = null;
      entry.updatedAt = new Date().toISOString();
      persist();
      await safeSend(chatId, t(lang, 'newSession'));
      return;
    }
    if (command.name === 'status') {
      const entry = state.chats[chatId];
      const last = lastRun.get(chatId);
      const waiting = (queues.get(chatId) || []).length;
      const turn = last
        ? t(lang, last.ok ? 'status.lastOk' : 'status.lastFail', { s: (last.durationMs / 1000).toFixed(1), tokens: last.tokens ?? '?' })
        : t(lang, 'status.lastNone');
      await safeSend(
        chatId,
        [
          t(lang, 'status.title'),
          t(lang, 'status.channel', { v: adapter.name }),
          t(lang, 'status.session', { v: entry?.sessionId || t(lang, 'status.sessionNew') }),
          t(lang, 'status.folder', { v: entry?.workspace || workspaceFor(chatId) }),
          t(lang, 'status.dsh', { v: `${config.dshBin} --profile ${config.dshProfile}` }),
          t(lang, 'status.message', { v: t(lang, active.has(chatId) ? 'status.running' : 'status.idle') + (waiting ? t(lang, 'status.queue', { n: waiting }) : '') }),
          t(lang, 'status.lastTurn', { v: turn }),
          t(lang, 'status.daemon', { n: ((Date.now() - startedAt) / 60000).toFixed(0) }),
        ].join('\n'),
      );
      return;
    }
    await safeSend(chatId, t(lang, 'help'));
  }

  async function safeSend(chatId, text) {
    try {
      return await adapter.send(chatId, text);
    } catch (err) {
      log(`could not send to ${chatId}: ${shortError(err)}`);
      return null;
    }
  }

  // The task is addressed to the model, not to the person: English, whatever language the sender writes in.
  function buildTask(message) {
    const parts = [];
    const attachments = message.attachments || [];
    if (attachments.length) {
      parts.push('Attachments received with this message:');
      for (const att of attachments) {
        parts.push(`- ${att.localPath || att.path || att.name}${att.kind ? ` (${att.kind})` : ''}`);
      }
      parts.push('');
    }
    parts.push(String(message.text || '').trim());
    if (attachments.length) {
      parts.push('');
      parts.push('(The files above are in the current working folder. Use a read tool if needed.)');
    }
    return parts.filter((p) => p !== undefined).join('\n').trim();
  }

  async function runMessage(chatId, message, lang) {
    const cwd = workspaceFor(chatId);
    const entry = ensureChat(state, chatId, { workspace: cwd });
    entry.messages = (entry.messages || 0) + 1;
    entry.updatedAt = new Date().toISOString();
    persist();

    active.set(chatId, { startedAt: Date.now() });
    let placeholder = null;
    try {
      placeholder = await adapter.send(chatId, t(lang, 'working'));
    } catch (err) {
      log(`placeholder failed: ${shortError(err)}`);
    }

    const progress = [];
    let currentText = '';
    let lastEditAt = 0;

    const render = () => {
      const body = currentText ? currentText.slice(-1500) : t(lang, 'working');
      const lines = progress.slice(-MAX_PROGRESS_LINES).map((p) => `· ${p}`);
      return [body, ...(lines.length ? ['', ...lines] : [])].join('\n');
    };

    const edit = async (force = false) => {
      if (!placeholder || !adapter.edit) return;
      const now = Date.now();
      if (!force && now - lastEditAt < config.minEditIntervalMs) return;
      lastEditAt = now;
      try {
        await adapter.edit(chatId, placeholder.messageId, render());
      } catch (err) {
        log(`edit failed: ${shortError(err)}`);
      }
    };

    const onEvent = (event) => {
      if (event.type === 'text' && event.text) {
        currentText = event.text;
        void edit();
        return;
      }
      if (event.type === 'tool_call') {
        const name = toolName(event);
        progress.push(name ? t(lang, 'tool', { name }) : t(lang, 'toolUnknown'));
        void edit();
        return;
      }
      if (event.type === 'status' && event.phase === 'step_end' && event.usage && !currentText) {
        progress.push(t(lang, 'stepDone', { n: event.step ?? '?' }));
      }
    };

    const cwdBefore = cwd;
    const task = buildTask(message);
    log(`turn ${chatId}: ${task.length} characters → ${cwdBefore}`);

    const result = await runTask({
      task,
      sessionId: entry.sessionId,
      cwd: cwdBefore,
      dshBin: config.dshBin,
      profile: config.dshProfile,
      extraArgs: config.dshArgs,
      timeoutMs: config.timeoutMs,
      onEvent,
    });

    if (result.sessionId) {
      entry.sessionId = result.sessionId;
      persist();
    }

    const files = [];
    if (result.ok) {
      const extracted = extractFileMarkers(result.final || '', cwdBefore);
      files.push(...extracted.files);
      await deliver(chatId, placeholder, extracted.text || t(lang, 'emptyReply'), files, lang);
    } else {
      const reason = result.timedOut
        ? t(lang, 'timedOut', { n: Math.round(config.timeoutMs / 1000) })
        : result.error && result.error.message
          ? result.error.message
          : t(lang, 'exitCode', { n: result.exitCode });
      const body = [
        t(lang, 'turnFailed', { reason: shortError(reason) }),
        result.stderr ? `\n${tail(result.stderr, 500)}` : '',
      ].join('');
      await deliver(chatId, placeholder, body, [], lang);
    }

    lastRun.set(chatId, {
      ok: result.ok,
      durationMs: result.durationMs,
      tokens: result.usage?.totalTokens ?? null,
      at: Date.now(),
    });
    active.delete(chatId);
    log(`turn ${chatId} finished: ${result.ok ? 'ok' : 'failed'} in ${result.durationMs} ms`);

    const pending = queues.get(chatId);
    if (pending && pending.length) {
      const next = pending.shift();
      if (!pending.length) queues.delete(chatId);
      void handleIncoming(next);
    }
  }

  /** Edits the placeholder with the final text (or sends the extra chunks). */
  async function deliver(chatId, placeholder, text, files = [], lang = 'en') {
    const chunks = splitMessage(text) || [''];
    const [first, ...rest] = chunks.length ? chunks : [''];
    if (placeholder) {
      try {
        await adapter.edit(chatId, placeholder.messageId, first || t(lang, 'emptyText'));
      } catch {
        await safeSend(chatId, first || t(lang, 'emptyText'));
      }
    } else {
      await safeSend(chatId, first || t(lang, 'emptyText'));
    }
    for (const chunk of rest) await safeSend(chatId, chunk);

    if (adapter.sendFile) {
      for (const file of files) {
        try {
          if (!fs.existsSync(file)) {
            await safeSend(chatId, t(lang, 'fileMissing', { file }));
            continue;
          }
          await adapter.sendFile(chatId, file);
        } catch (err) {
          await safeSend(chatId, t(lang, 'fileFailed', { reason: shortError(err) }));
        }
      }
    }
  }

  /** Proactive send (CLI, other plugins, scripts). The text is the caller's own: it is not translated. */
  async function notify(chatId, text, { files = [] } = {}) {
    const target = String(chatId || config.defaultChat || '');
    if (!target) throw new Error('no target chat (use --chat)');
    if (!isAllowed(state, target, config)) throw new Error(`chat ${target} is not in the allowlist`);
    await safeSend(target, text);
    for (const file of files) {
      if (adapter.sendFile) await adapter.sendFile(target, file);
    }
  }

  return {
    name: adapter.name,
    handleIncoming,
    notify,
    workspaceFor,
    activeCount: () => active.size,
    queueCount: () => [...queues.values()].reduce((n, q) => n + q.length, 0),
  };
}
