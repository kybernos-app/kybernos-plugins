// Telegram channel of the front desk: lets VISITORS (strangers) talk to the shop's public assistant through a bot, by long polling
// (getUpdates: no webhook, no public URL). It knows nothing of the runner. The caller passes `handle` (a visitor's text in, a safe reply
// out), `consent` (a pressed button) and `say` (every line a visitor reads, in their language), so no wording lives here except an
// English last resort. Standalone on purpose: nothing is imported from the messaging package.
//
// What it guarantees, in code:
//   - only PRIVATE chats are served; the visitor is Telegram's own `from.id`, never anything typed;
//   - replies go out as plain text (no parse_mode), so nothing the model writes can be read as markup;
//   - the bot token lives only in the request path and is scrubbed from every log line and every error;
//   - an update is confirmed (offset moved and saved) once it is queued; one chat runs in order, four chats run at once.

import fs from 'node:fs';
import path from 'node:path';

const MAX_TEXT = 4096;
const MAX_CONCURRENT = 4;
const MAX_QUEUED = 200; // beyond this the poll loop waits, so a flood cannot grow memory without bound
const MAX_NOTICED = 1000;
const CALL_TIMEOUT_MS = 20000;
const BACKOFF_MIN_MS = 1000;
const BACKOFF_MAX_MS = 30000;
const CONSENT_DATA = /^c:(n_[0-9a-f]{16}):([01])$/;
const NOTE_ID = /^n_[0-9a-f]{16}$/;
const START_CMD = /^\/start(?:@\w+)?(?:\s|$)/;
const CHAT_ID = /^-?\d{1,20}$/;

// Last resort only, when the caller's `say` is missing or answers nothing usable.
const FALLBACK = {
  'tg.start': 'Hello! Ask me anything about the shop.',
  'tg.private_only': 'I only answer in private chats. Please write to me directly.',
  'tg.yes': 'Yes',
  'tg.no': 'No',
  'tg.error': 'Something went wrong. Please try again in a moment.',
  'tg.unsupported': 'I can only read text messages.',
};

class ApiError extends Error {
  constructor(message, { status = 0, retryAfter = null, aborted = false } = {}) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
    this.aborted = aborted;
  }
}

/** Cuts a text into parts of at most `max` characters, on a newline or a space when one is close enough, never inside a surrogate pair. */
export function splitMessage(text, max = MAX_TEXT) {
  const parts = [];
  let rest = String(text ?? '');
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max / 2) cut = rest.lastIndexOf(' ', max);
    if (cut < max / 2) {
      cut = max;
      const code = rest.charCodeAt(cut - 1);
      if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
    }
    const part = rest.slice(0, cut).trimEnd();
    if (part) parts.push(part);
    rest = rest.slice(cut).replace(/^\s+/, '');
  }
  if (rest.trim()) parts.push(rest.trimEnd());
  return parts;
}

const defaultSleep = (ms, signal) => new Promise((resolve) => {
  const done = () => { clearTimeout(timer); if (signal) signal.removeEventListener('abort', done); resolve(); };
  const timer = setTimeout(done, ms);
  if (signal) signal.addEventListener('abort', done, { once: true });
});

export function createTelegramChannel(options = {}) {
  const {
    token, apiBase = 'https://api.telegram.org', fetchImpl = globalThis.fetch, handle, consent, say,
    stateFile = null, pollTimeoutSec = 25, log = () => {}, sleep = defaultSleep,
  } = options;
  if (typeof token !== 'string' || !/^[\w:-]{8,}$/.test(token)) throw new Error('telegram: a bot token is required');
  if (typeof handle !== 'function' || typeof consent !== 'function') throw new Error('telegram: handle and consent are required');
  if (typeof fetchImpl !== 'function') throw new Error('telegram: no fetch available');

  const base = String(apiBase).replace(/\/+$/, '');
  const secrets = [...new Set([token, encodeURIComponent(token), token.split(':')[1]])].filter((s) => s && s.length >= 8);
  const scrub = (s) => secrets.reduce((out, secret) => out.split(secret).join('***'), String(s));
  const note = (message) => { try { log(scrub(message)); } catch { /* a broken logger must not stop the bot */ } };
  const describe = (e) => scrub((e && e.message) || e).slice(0, 160);

  const stats_ = { updates: 0, handled: 0, ignored: 0, errors: 0 };
  let polling = false;
  let offset = 0;

  // ---- Bot API -----------------------------------------------------------------------------------------------------------------

  async function api(method, payload = {}, { signal = null, timeoutMs = CALL_TIMEOUT_MS } = {}) {
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    if (signal) { if (signal.aborted) ac.abort(); else signal.addEventListener('abort', onAbort, { once: true }); }
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    let res;
    let body = null;
    try {
      res = await fetchImpl(`${base}/bot${token}/${method}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: ac.signal,
      });
      try { body = await res.json(); } catch { body = null; }
    } catch (e) {
      if (signal && signal.aborted) throw new ApiError(`telegram: ${method} aborted`, { aborted: true });
      throw new ApiError(scrub(`telegram: ${method} network error (${(e && e.message) || 'unknown'})`).slice(0, 200));
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
    if (!res.ok || !body || body.ok !== true) {
      const why = body && typeof body.description === 'string' ? `: ${body.description}` : '';
      const retryAfter = Number(body && body.parameters && body.parameters.retry_after);
      throw new ApiError(scrub(`telegram: ${method} failed (HTTP ${res.status}${why})`).slice(0, 200), {
        status: res.status, retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 3600) : null,
      });
    }
    return body.result;
  }

  // A rejected-for-rate call never reached the chat, so repeating it cannot send twice. Other failures are not repeated for that reason.
  async function sendCall(method, payload) {
    for (let attempt = 0; ; attempt += 1) {
      try { return await api(method, payload); } catch (e) {
        if (e.status === 429 && e.retryAfter && attempt < 2) { await sleep(Math.min(e.retryAfter, 30) * 1000); continue; }
        throw e;
      }
    }
  }

  /** Sends `text` (split at 4096) to a chat as plain text; `markup` goes on the last part. Never throws. */
  async function deliver(chatId, text, markup = null) {
    const id = String(chatId);
    if (!CHAT_ID.test(id)) return { ok: false, error: 'bad_chat_id' };
    const parts = splitMessage(String(text ?? ''));
    if (!parts.length) return { ok: false, error: 'empty' };
    let messageId = null;
    for (let i = 0; i < parts.length; i += 1) {
      try {
        const r = await sendCall('sendMessage', {
          chat_id: id, text: parts[i], disable_web_page_preview: true, ...(markup && i === parts.length - 1 ? { reply_markup: markup } : {}),
        });
        if (r && r.message_id !== undefined) messageId = r.message_id;
      } catch (e) {
        stats_.errors += 1;
        note(e.message);
        return { ok: false, messageId, error: e.message };
      }
    }
    return { ok: true, messageId };
  }

  const quietly = async (fn) => { try { await fn(); } catch (e) { stats_.errors += 1; note(e.message); } };

  // ---- Wording ----------------------------------------------------------------------------------------------------------------

  function line(key, lang) {
    try {
      const s = typeof say === 'function' ? say(key, lang) : null;
      if (typeof s === 'string' && s.trim()) return s;
    } catch { /* fall through */ }
    return FALLBACK[key] || FALLBACK['tg.error'];
  }

  function langOf(from) {
    const code = from && typeof from.language_code === 'string' ? from.language_code.toLowerCase().split(/[-_]/)[0] : '';
    return /^[a-z]{2,3}$/.test(code) ? code : null;
  }

  // ---- One update --------------------------------------------------------------------------------------------------------------

  const noticed = new Set(); // groups already told once that only private chats are served

  async function onMessage(msg) {
    const chatId = String(msg.chat.id);
    const from = msg.from;
    const lang = langOf(from);
    if (msg.chat.type !== 'private') {
      stats_.ignored += 1;
      if (!noticed.has(chatId)) {
        if (noticed.size >= MAX_NOTICED) noticed.delete(noticed.values().next().value);
        noticed.add(chatId);
        await deliver(chatId, line('tg.private_only', lang));
      }
      return;
    }
    if (!from || from.is_bot) { stats_.ignored += 1; return; }
    if (typeof msg.text !== 'string' || !msg.text) { await deliver(chatId, line('tg.unsupported', lang)); return; }
    if (START_CMD.test(msg.text)) { await deliver(chatId, line('tg.start', lang)); return; }

    let result = null;
    try {
      result = await handle({ senderKey: String(from.id), chatId, text: msg.text, lang });
    } catch (e) {
      stats_.errors += 1;
      note(`telegram: the handler failed (${describe(e)})`);
    }
    stats_.handled += 1;
    // `reply` is made safe by the caller; error details never travel here.
    const reply = result && typeof result.reply === 'string' && result.reply.trim() ? result.reply : line('tg.error', lang);
    await deliver(chatId, reply);
    if (!result || result.ok !== true || !Array.isArray(result.pendingConsents)) return;
    for (const c of result.pendingConsents) {
      if (!c || typeof c.noteId !== 'string' || !NOTE_ID.test(c.noteId) || typeof c.text !== 'string' || !c.text.trim()) continue;
      await deliver(chatId, c.text.slice(0, MAX_TEXT), {
        inline_keyboard: [[
          { text: line('tg.yes', lang), callback_data: `c:${c.noteId}:1` },
          { text: line('tg.no', lang), callback_data: `c:${c.noteId}:0` },
        ]],
      });
    }
  }

  async function onCallback(cb) {
    const answer = () => quietly(() => api('answerCallbackQuery', { callback_query_id: cb.id }));
    const m = typeof cb.data === 'string' ? CONSENT_DATA.exec(cb.data) : null;
    const chat = cb.message && cb.message.chat;
    if (!m || !chat || chat.type !== 'private' || !cb.from || cb.from.is_bot) { stats_.ignored += 1; await answer(); return; }
    let result = null;
    try {
      result = await consent({ senderKey: String(cb.from.id), noteId: m[1], accept: m[2] === '1' });
    } catch (e) {
      stats_.errors += 1;
      note(`telegram: the consent handler failed (${describe(e)})`);
      await answer();
      await deliver(chat.id, line('tg.error', langOf(cb.from)));
      return;
    }
    await answer();
    // ok:false = not this visitor's note, already answered or erased: nothing to say.
    if (!result || result.ok !== true) { stats_.ignored += 1; return; }
    await quietly(() => api('editMessageReplyMarkup', { chat_id: chat.id, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } }));
    if (typeof result.reply === 'string' && result.reply.trim()) await deliver(chat.id, result.reply);
  }

  // ---- Scheduling: one chat at a time, four at once, a bounded backlog ---------------------------------------------------------

  const chats = new Map(); // chat id -> { jobs, busy }
  const roomWaiters = [];
  let active = 0;
  let queued = 0;

  function pump() {
    for (const [key, c] of chats) {
      if (active >= MAX_CONCURRENT) break;
      if (c.busy || !c.jobs.length) continue;
      const job = c.jobs.shift();
      queued -= 1;
      c.busy = true;
      active += 1;
      Promise.resolve().then(job)
        .catch((e) => { stats_.errors += 1; note(`telegram: an update failed (${describe(e)})`); })
        .finally(() => {
          c.busy = false;
          active -= 1;
          if (!c.jobs.length && chats.get(key) === c) chats.delete(key);
          pump();
        });
    }
    if (queued < MAX_QUEUED) for (const wake of roomWaiters.splice(0)) wake();
  }

  function enqueue(chatKey, job) {
    let c = chats.get(chatKey);
    if (!c) { c = { jobs: [], busy: false }; chats.set(chatKey, c); }
    c.jobs.push(job);
    queued += 1;
    pump();
  }

  async function room(signal) {
    while (queued >= MAX_QUEUED && !(signal && signal.aborted)) {
      await new Promise((resolve) => { roomWaiters.push(resolve); if (signal) signal.addEventListener('abort', resolve, { once: true }); });
    }
  }

  function dispatch(update) {
    const msg = update.message;
    const cb = update.callback_query;
    if (msg && msg.chat && msg.chat.id !== undefined) enqueue(String(msg.chat.id), () => onMessage(msg));
    else if (cb && typeof cb.id === 'string') enqueue(String((cb.message && cb.message.chat && cb.message.chat.id) ?? (cb.from && cb.from.id) ?? 'unknown'), () => onCallback(cb));
    else stats_.ignored += 1;
  }

  // ---- The offset ---------------------------------------------------------------------------------------------------------------

  function loadOffset() {
    if (!stateFile) return 0;
    try {
      const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      return Number.isSafeInteger(saved.offset) && saved.offset > 0 ? saved.offset : 0;
    } catch (e) {
      if (e.code !== 'ENOENT') note('telegram: the state file is unreadable, polling starts without an offset');
      return 0;
    }
  }

  function saveOffset(value) {
    if (!stateFile) return;
    try {
      fs.mkdirSync(path.dirname(stateFile), { recursive: true, mode: 0o700 });
      const tmp = `${stateFile}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ offset: value }), { mode: 0o600 });
      fs.renameSync(tmp, stateFile);
    } catch (e) {
      note(`telegram: the offset could not be saved (${e.code || 'error'})`);
    }
  }

  // ---- Polling -------------------------------------------------------------------------------------------------------------------

  // A wait that an abort cuts short, whatever the injected `sleep` does with the signal.
  const pause = (ms, signal) => new Promise((resolve) => {
    if (signal && signal.aborted) { resolve(); return; }
    const onAbort = () => resolve();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(sleep(ms, signal)).catch(() => {}).then(() => { if (signal) signal.removeEventListener('abort', onAbort); resolve(); });
  });

  async function start({ signal = null } = {}) {
    if (polling) throw new Error('telegram: already started');
    polling = true;
    offset = loadOffset();
    let lastId = offset - 1;
    let backoff = BACKOFF_MIN_MS;
    note('telegram: long polling started');
    try {
      while (!(signal && signal.aborted)) {
        let updates;
        try {
          updates = await api('getUpdates', {
            ...(offset > 0 ? { offset } : {}), timeout: pollTimeoutSec, allowed_updates: ['message', 'callback_query'],
          }, { signal, timeoutMs: (pollTimeoutSec + 10) * 1000 });
          if (!Array.isArray(updates)) throw new ApiError('telegram: getUpdates returned an unexpected answer');
        } catch (e) {
          if (signal && signal.aborted) break;
          if (e.status === 401 || e.status === 404) throw new Error('telegram: token rejected');
          if (e.status === 409) throw new Error('telegram: another consumer is polling this bot');
          stats_.errors += 1;
          let wait = backoff;
          if (e.status === 429 && e.retryAfter) wait = e.retryAfter * 1000;
          else backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
          note(`${e.message}; retrying in ${Math.round(wait / 1000)} s`);
          await pause(wait, signal);
          continue;
        }
        backoff = BACKOFF_MIN_MS;
        for (const update of updates) {
          const id = update && update.update_id;
          if (!Number.isSafeInteger(id) || id <= lastId) continue; // never twice
          await room(signal);
          dispatch(update);
          lastId = id;
          offset = id + 1;
          stats_.updates += 1;
          saveOffset(offset);
        }
      }
    } finally {
      polling = false;
      note('telegram: long polling stopped');
    }
  }

  // ---- Public --------------------------------------------------------------------------------------------------------------------

  /** Delivers a text (the owner's reply, say) to a visitor's chat. `{ ok, messageId }`, or `{ ok: false, error }`; never throws. */
  const send = (chatId, text) => deliver(chatId, text);

  async function me() {
    try {
      const r = await api('getMe', {});
      return { id: r.id, username: r.username || null };
    } catch (e) {
      if (e.status === 401 || e.status === 404) throw new Error('telegram: token rejected');
      throw new Error(e.message);
    }
  }

  const stats = () => ({ polling, offset, ...stats_, inFlight: active, queued });

  return { name: 'telegram', start, send, me, stats };
}
