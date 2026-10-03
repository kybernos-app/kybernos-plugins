// Adaptateur Telegram — long polling sortant (aucun port ouvert, aucun tunnel).
//
// Contrat : voir CONTRACT.md. Ne connaît ni DSH ni les sessions : il ne fait que
// recevoir des messages normalisés et savoir écrire dans un chat.

import fs from 'node:fs';
import path from 'node:path';

import { safeFileName } from '../core/text.mjs';

const DEFAULT_API = 'https://api.telegram.org';

export class TelegramApiError extends Error {
  constructor(method, status, description, { fatal = false, retryAfter = null } = {}) {
    super(`${method}: HTTP ${status} ${description || ''}`.trim());
    this.name = 'TelegramApiError';
    this.method = method;
    this.status = status;
    this.description = description;
    this.fatal = fatal;
    this.retryAfter = retryAfter;
  }
}

export function normalizeUpdate(update) {
  const raw = update?.message || update?.edited_message;
  if (!raw) return null;
  if (raw.from?.is_bot) return null;
  const chatId = String(raw.chat.id);
  const text = raw.text || raw.caption || '';
  const attachments = [];

  if (Array.isArray(raw.photo) && raw.photo.length) {
    const largest = raw.photo[raw.photo.length - 1];
    attachments.push({
      kind: 'photo',
      fileId: largest.file_id,
      name: `photo-${raw.message_id}.jpg`,
      size: largest.file_size ?? null,
    });
  }
  if (raw.document) {
    attachments.push({
      kind: 'document',
      fileId: raw.document.file_id,
      name: raw.document.file_name || `document-${raw.message_id}`,
      size: raw.document.file_size ?? null,
      mime: raw.document.mime_type || null,
    });
  }
  for (const [key, kind] of [
    ['voice', 'voice'],
    ['audio', 'audio'],
    ['video', 'video'],
  ]) {
    const media = raw[key];
    if (media) {
      attachments.push({
        kind,
        fileId: media.file_id,
        name: media.file_name || `${kind}-${raw.message_id}`,
        size: media.file_size ?? null,
        mime: media.mime_type || null,
      });
    }
  }

  return {
    updateId: update.update_id,
    chatId,
    messageId: raw.message_id,
    chatType: raw.chat.type,
    from: raw.from?.username || raw.from?.first_name || String(raw.from?.id ?? ''),
    text,
    attachments,
    receivedAt: raw.date ? raw.date * 1000 : Date.now(),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createTelegramAdapter({
  token,
  apiBase = DEFAULT_API,
  log = () => {},
  fetchImpl = fetch,
  longPollSeconds = 25,
  maxFileBytes = 25 * 1024 * 1024,
  initialOffset = 0,
  onOffset = () => {},
} = {}) {
  if (!token) throw new Error('token Telegram manquant');

  async function apiCall(method, payload = {}, { signal = null, form = null, timeoutMs = null } = {}) {
    const url = `${apiBase}/bot${token}/${method}`;
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
    let response;
    try {
      if (form) {
        response = await fetchImpl(url, { method: 'POST', body: form, signal: controller.signal });
      } else {
        response = await fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      }
    } catch (err) {
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      if (signal?.aborted) {
        const abortErr = new Error('abandonné');
        abortErr.aborted = true;
        throw abortErr;
      }
      const netErr = new Error(`${method}: réseau — ${err.message}`);
      netErr.transient = true;
      throw netErr;
    }
    if (timer) clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);

    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (!response.ok || !body || body.ok !== true) {
      const description = body?.description || response.statusText || 'réponse illisible';
      const retryAfter = body?.parameters?.retry_after ?? null;
      const fatal = response.status === 401 || response.status === 403 || response.status === 409;
      throw new TelegramApiError(method, response.status, description, { fatal, retryAfter });
    }
    return body.result;
  }

  async function download(attachment, inboxDir) {
    const info = await apiCall('getFile', { file_id: attachment.fileId });
    if (attachment.size && attachment.size > maxFileBytes) {
      throw new Error(`fichier trop gros (${attachment.size} octets > ${maxFileBytes})`);
    }
    const url = `${apiBase}/file/bot${token}/${info.file_path}`;
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`téléchargement HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(inboxDir, { recursive: true, mode: 0o700 });
    const name = safeFileName(attachment.name || path.basename(info.file_path || 'fichier'));
    const dest = path.join(inboxDir, name);
    fs.writeFileSync(dest, buffer, { mode: 0o600 });
    return dest;
  }

  function formatSendError(err) {
    return err && err.message ? err.message : String(err);
  }

  async function start({ onMessage, inboxFor = null, signal = null } = {}) {
    let offset = Number(initialOffset) || 0;
    let backoff = 1000;
    log(`telegram: long polling démarré (offset ${offset})`);
    while (!signal?.aborted) {
      let updates;
      try {
        updates = await apiCall(
          'getUpdates',
          { offset, timeout: longPollSeconds, allowed_updates: ['message', 'edited_message'] },
          { signal, timeoutMs: (longPollSeconds + 10) * 1000 },
        );
      } catch (err) {
        if (err.aborted || signal?.aborted) break;
        if (err.fatal) {
          if (err.status === 409) {
            throw new Error(
              'telegram: getUpdates refusé (409) — un webhook est configuré sur ce bot. ' +
                'Supprime-le (deleteWebhook) pour utiliser le long polling.',
            );
          }
          throw new Error(`telegram: ${err.message} — vérifie TELEGRAM_BOT_TOKEN`);
        }
        const wait = err.retryAfter ? err.retryAfter * 1000 : backoff;
        log(`telegram: ${formatSendError(err)} — nouvelle tentative dans ${Math.round(wait / 1000)} s`);
        await sleep(wait);
        backoff = Math.min(backoff * 2, 15000);
        continue;
      }
      backoff = 1000;
      for (const update of updates) {
        const message = normalizeUpdate(update);
        if (message) {
          if (inboxFor && message.attachments.length) {
            const inbox = inboxFor(message.chatId);
            for (const att of message.attachments) {
              try {
                att.localPath = await download(att, inbox);
              } catch (err) {
                log(`telegram: pièce jointe ignorée (${formatSendError(err)})`);
              }
            }
          }
          try {
            await onMessage(message);
          } catch (err) {
            log(`telegram: traitement du message en échec — ${formatSendError(err)}`);
          }
        }
        // L'offset n'avance qu'APRÈS traitement : Telegram confirme l'update au
        // prochain getUpdates. Un crash en cours de tour laisse donc le message
        // non confirmé, et il sera relivré (au-moins-une-fois) au lieu d'être
        // perdu en silence.
        offset = update.update_id + 1;
        try {
          onOffset(offset);
        } catch {
          /* best effort */
        }
      }
    }
    log('telegram: long polling arrêté');
  }

  async function send(chatId, text, { replyTo = null } = {}) {
    const result = await apiCall('sendMessage', {
      chat_id: chatId,
      text: String(text ?? ''),
      disable_web_page_preview: true,
      ...(replyTo ? { reply_to_message_id: replyTo } : {}),
    });
    return { messageId: result.message_id, chatId: String(result.chat.id) };
  }

  async function edit(chatId, messageId, text) {
    try {
      await apiCall('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: String(text ?? ''),
        disable_web_page_preview: true,
      });
      return true;
    } catch (err) {
      // Telegram refuse une édition identique : ce n'est pas une erreur.
      if (err.description && /message is not modified/i.test(err.description)) return false;
      throw err;
    }
  }

  async function sendFile(chatId, filePath, { caption = '' } = {}) {
    const buffer = fs.readFileSync(filePath);
    const name = path.basename(filePath);
    const isImage = /\.(jpe?g|png|webp|gif)$/i.test(name);
    const form = new FormData();
    form.set('chat_id', String(chatId));
    if (caption) form.set('caption', String(caption).slice(0, 1024));
    const field = isImage ? 'photo' : 'document';
    form.set(field, new Blob([buffer]), name);
    const result = await apiCall(isImage ? 'sendPhoto' : 'sendDocument', {}, { form });
    const sent = result.document || result.photo?.[result.photo.length - 1] || null;
    return { messageId: result.message_id, kind: isImage ? 'photo' : 'document', fileId: sent?.file_id ?? null };
  }

  async function me() {
    return apiCall('getMe');
  }

  async function webhookInfo() {
    return apiCall('getWebhookInfo');
  }

  return { name: 'telegram', start, send, edit, sendFile, download, me, webhookInfo, apiCall, normalizeUpdate };
}
