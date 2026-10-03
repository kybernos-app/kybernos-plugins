// Cœur du pont : reçoit les messages normalisés d'un adaptateur, pilote les
// sessions DSH (mode headless), streame la progression et renvoie la réponse.
//
// Ce fichier ne connaît AUCUNE plateforme : tout passe par le contrat
// d'adaptateur décrit dans channels/CONTRACT.md.

import fs from 'node:fs';
import path from 'node:path';

import { runHeadless } from './dsh-run.mjs';
import { extractFileMarkers, shortError, splitMessage } from './text.mjs';
import { ensureChat, isAllowed, saveState } from './state.mjs';

export const HELP_TEXT = [
  'Commandes disponibles :',
  '/new — repartir sur une session DSH vierge',
  '/status — session, dossier de travail, file et dernière exécution',
  '/help — ce message',
  '',
  'Tout autre message est envoyé à DeepSeek Harness ; la réponse arrive ici.',
].join('\n');

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
 * @param {object} opts.adapter adaptateur de canal (voir CONTRACT.md)
 * @param {object} opts.config  configuration résolue (core/config.mjs)
 * @param {object} opts.state   état chargé (core/state.mjs)
 * @param {string} opts.stateFile chemin du fichier d'état
 * @param {(event:object)=>void} [opts.runTask] injectable pour les tests
 */
export function createBridge({ adapter, config, state, stateFile, runTask = runHeadless, log = () => {} }) {
  const queues = new Map(); // chatId -> array de messages en attente
  const active = new Map(); // chatId -> { startedAt }
  const lastRun = new Map(); // chatId -> résumé de la dernière exécution
  const startedAt = Date.now();

  const persist = () => {
    try {
      saveState(stateFile, state);
    } catch (err) {
      log(`état non enregistré: ${shortError(err)}`);
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

    if (!isAllowed(state, chatId, config)) {
      log(`refusé: chat ${chatId} hors allowlist (${message.from || 'inconnu'})`);
      await safeSend(
        chatId,
        '⛔ Ce chat n’est pas autorisé à piloter ce DeepSeek Harness.\n' +
          `Identifiant à autoriser : ${chatId}\n` +
          'Côté machine : `telegram-daemon --allow ' +
          chatId +
          '`',
      );
      return;
    }

    const command = normalizeCommand(text);
    if (command) {
      await handleCommand(chatId, command);
      return;
    }
    if (!text && !(message.attachments || []).length) return;

    const pending = queues.get(chatId) || [];
    if (active.has(chatId)) {
      if (pending.length >= config.maxQueuePerChat) {
        await safeSend(chatId, `⏳ File pleine (${config.maxQueuePerChat} messages). Attends la fin du tour en cours.`);
        return;
      }
      pending.push(message);
      queues.set(chatId, pending);
      await safeSend(chatId, `⏳ En file d’attente (position ${pending.length}).`);
      return;
    }
    await runMessage(chatId, message);
  }

  function normalizeCommand(text) {
    if (!text.startsWith('/')) return null;
    const [raw] = text.split(/\s+/);
    const name = raw.slice(1).split('@')[0].toLowerCase();
    return { name, rest: text.slice(raw.length).trim() };
  }

  async function handleCommand(chatId, command) {
    if (command.name === 'new') {
      const entry = ensureChat(state, chatId, { workspace: workspaceFor(chatId) });
      entry.sessionId = null;
      entry.updatedAt = new Date().toISOString();
      persist();
      await safeSend(chatId, '🆕 Session suivante neuve : le prochain message crée une nouvelle session DSH.');
      return;
    }
    if (command.name === 'status') {
      const entry = state.chats[chatId];
      const last = lastRun.get(chatId);
      await safeSend(
        chatId,
        [
          '📊 État du pont',
          `• canal : ${adapter.name}`,
          `• session : ${entry?.sessionId || '(neuve au prochain message)'}`,
          `• dossier : ${entry?.workspace || workspaceFor(chatId)}`,
          `• DSH : ${config.dshBin} --profile ${config.dshProfile}`,
          `• message : ${active.has(chatId) ? 'en cours' : 'au repos'}${(queues.get(chatId) || []).length ? ` · file ${(queues.get(chatId) || []).length}` : ''}`,
          `• dernier tour : ${
            last
              ? `${last.ok ? 'ok' : 'échec'} en ${(last.durationMs / 1000).toFixed(1)} s (${last.tokens ?? '?'} tokens)`
              : 'aucun'
          }`,
          `• démon : ${((Date.now() - startedAt) / 60000).toFixed(0)} min`,
        ].join('\n'),
      );
      return;
    }
    await safeSend(chatId, HELP_TEXT);
  }

  async function safeSend(chatId, text) {
    try {
      return await adapter.send(chatId, text);
    } catch (err) {
      log(`envoi impossible vers ${chatId}: ${shortError(err)}`);
      return null;
    }
  }

  function buildTask(message, cwd) {
    const parts = [];
    const attachments = message.attachments || [];
    if (attachments.length) {
      parts.push('Pièces jointes reçues dans ce message :');
      for (const att of attachments) {
        parts.push(`- ${att.localPath || att.path || att.name}${att.kind ? ` (${att.kind})` : ''}`);
      }
      parts.push('');
    }
    parts.push(String(message.text || '').trim());
    if (attachments.length) {
      parts.push('');
      parts.push(
        '(Les fichiers ci-dessus sont dans le dossier de travail courant. Utilise un outil de lecture si besoin.)',
      );
    }
    return parts.filter((p) => p !== undefined).join('\n').trim();
  }

  async function runMessage(chatId, message) {
    const cwd = workspaceFor(chatId);
    const entry = ensureChat(state, chatId, { workspace: cwd });
    entry.messages = (entry.messages || 0) + 1;
    entry.updatedAt = new Date().toISOString();
    persist();

    active.set(chatId, { startedAt: Date.now() });
    let placeholder = null;
    try {
      placeholder = await adapter.send(chatId, '⏳ DeepSeek Harness travaille…');
    } catch (err) {
      log(`placeholder impossible: ${shortError(err)}`);
    }

    const progress = [];
    let currentText = '';
    let lastEditAt = 0;

    const render = () => {
      const body = currentText ? currentText.slice(-1500) : '⏳ DeepSeek Harness travaille…';
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
        log(`édition impossible: ${shortError(err)}`);
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
        progress.push(name ? `🔧 ${name}` : '🔧 outil');
        void edit();
        return;
      }
      if (event.type === 'status' && event.phase === 'step_end' && event.usage && !currentText) {
        progress.push(`étape ${event.step ?? '?'} terminée`);
      }
    };

    const cwdBefore = cwd;
    const task = buildTask(message, cwdBefore);
    log(`tour ${chatId}: ${task.length} caractères → ${cwdBefore}`);

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
      await deliver(chatId, placeholder, extracted.text || '(réponse vide)', files);
    } else {
      const reason = result.timedOut
        ? `délai dépassé (${Math.round(config.timeoutMs / 1000)} s)`
        : result.error && result.error.message
          ? result.error.message
          : `code ${result.exitCode}`;
      const body = [
        `❌ Échec du tour : ${shortError(reason)}`,
        result.stderr ? `\n${tail(result.stderr, 500)}` : '',
      ].join('');
      await deliver(chatId, placeholder, body, []);
    }

    lastRun.set(chatId, {
      ok: result.ok,
      durationMs: result.durationMs,
      tokens: result.usage?.totalTokens ?? null,
      at: Date.now(),
    });
    active.delete(chatId);
    log(`tour ${chatId} terminé: ${result.ok ? 'ok' : 'échec'} en ${result.durationMs} ms`);

    const pending = queues.get(chatId);
    if (pending && pending.length) {
      const next = pending.shift();
      if (!pending.length) queues.delete(chatId);
      void handleIncoming(next);
    }
  }

  /** Édite le placeholder avec le texte final (ou envoie des morceaux supplémentaires). */
  async function deliver(chatId, placeholder, text, files = []) {
    const chunks = splitMessage(text) || [''];
    const [first, ...rest] = chunks.length ? chunks : [''];
    if (placeholder) {
      try {
        await adapter.edit(chatId, placeholder.messageId, first || '(vide)');
      } catch {
        await safeSend(chatId, first || '(vide)');
      }
    } else {
      await safeSend(chatId, first || '(vide)');
    }
    for (const chunk of rest) await safeSend(chatId, chunk);

    if (adapter.sendFile) {
      for (const file of files) {
        try {
          if (!fs.existsSync(file)) {
            await safeSend(chatId, `⚠️ fichier introuvable : ${file}`);
            continue;
          }
          await adapter.sendFile(chatId, file);
        } catch (err) {
          await safeSend(chatId, `⚠️ envoi du fichier impossible : ${shortError(err)}`);
        }
      }
    }
  }

  /** Envoi proactif (CLI, autres plugins, scripts). */
  async function notify(chatId, text, { files = [] } = {}) {
    const target = String(chatId || config.defaultChat || '');
    if (!target) throw new Error('aucun chat cible (utilise --chat)');
    if (!isAllowed(state, target, config)) throw new Error(`chat ${target} hors allowlist`);
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
