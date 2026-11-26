import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTelegramChannel, splitMessage } from '../channels/telegram.mjs';

const TOKEN = '987654321:AAHsecretTOKENvalue_ZZ-9xQ';
const SECRET_HALF = TOKEN.split(':')[1];
const NOTE = 'n_0123456789abcdef';

const it = (name, fn) => test(name, { timeout: 15000 }, fn);
const nap = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(cond, what, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (cond()) return; await nap(5); }
  assert.fail(`timed out waiting for ${what}`);
}
const withTimeout = (p, ms, what) => {
  let timer;
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out: ${what}`)), ms); });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
};

// ---- A fake Bot API on a real local port: URL building, long-poll and abort are really exercised ---------------------------------

const servers = new Set();
after(() => { for (const s of servers) { s.closeAllConnections(); s.close(); } });

async function fakeApi({ token = TOKEN, holdMs = 100 } = {}) {
  const calls = [];
  const updates = [];
  const scripted = new Map(); // method -> one-shot answers { status, json }
  const wakers = new Set();
  let mid = 1000;
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const send = (status, json) => {
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(json));
    };
    const m = /^\/bot([^/]+)\/(\w+)$/.exec(req.url);
    if (!m) return send(404, { ok: false, error_code: 404, description: 'Not Found' });
    if (m[1] !== token) return send(401, { ok: false, error_code: 401, description: 'Unauthorized' });
    const method = m[2];
    const body = raw ? JSON.parse(raw) : {};
    calls.push({ method, body });
    const next = (scripted.get(method) || []).shift();
    if (next) return send(next.status, next.json || { ok: false, description: 'scripted' });
    if (method === 'getMe') return send(200, { ok: true, result: { id: 42, is_bot: true, username: 'shop_bot' } });
    if (method === 'getUpdates') {
      const offset = body.offset || 0;
      for (let i = updates.length - 1; i >= 0; i -= 1) if (updates[i].update_id < offset) updates.splice(i, 1); // Telegram confirms below the offset
      if (!updates.length) {
        await new Promise((resolve) => {
          const done = () => { clearTimeout(timer); wakers.delete(done); resolve(); };
          const timer = setTimeout(done, holdMs);
          wakers.add(done);
          res.on('close', done);
        });
      }
      return send(200, { ok: true, result: updates.filter((u) => u.update_id >= offset) });
    }
    if (method === 'sendMessage') { mid += 1; return send(200, { ok: true, result: { message_id: mid, chat: { id: body.chat_id } } }); }
    return send(200, { ok: true, result: true });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.add(server);
  const api = {
    url: `http://127.0.0.1:${server.address().port}`,
    calls,
    push(...us) { updates.push(...us); for (const w of [...wakers]) w(); },
    script(method, ...answers) { scripted.set(method, [...(scripted.get(method) || []), ...answers]); },
    sent: (chat) => calls.filter((c) => c.method === 'sendMessage' && (chat === undefined || String(c.body.chat_id) === String(chat))).map((c) => c.body),
    of: (method) => calls.filter((c) => c.method === method).map((c) => c.body),
    close() { server.closeAllConnections(); server.close(); servers.delete(server); },
  };
  return api;
}

const userMsg = (id, chat, text, extra = {}) => ({
  update_id: id,
  message: { message_id: id, from: { id: chat, is_bot: false, language_code: 'en' }, chat: { id: chat, type: 'private' }, date: 1, ...(text === null ? {} : { text }), ...extra },
});
const press = (id, from, data, over = {}) => ({
  update_id: id,
  callback_query: { id: `cbq-${id}`, from: { id: from, is_bot: false, language_code: 'en' }, message: { message_id: 77, chat: { id: from, type: 'private' } }, data, ...over },
});

/** A channel over a fake API, with spies for everything the caller supplies. Stopped and closed when the test ends. */
async function boot(t, { api: shared = null, apiOpts, options = {}, begin = true } = {}) {
  const api = shared || await fakeApi(apiOpts);
  const logs = [];
  const handled = [];
  const consents = [];
  const sleeps = [];
  const channel = createTelegramChannel({
    token: TOKEN,
    apiBase: api.url,
    pollTimeoutSec: 1,
    handle: async (a) => { handled.push(a); return { ok: true, reply: `echo ${a.text}` }; },
    consent: async (a) => { consents.push(a); return { ok: true, saved: a.accept, reply: a.accept ? 'Saved' : 'Not kept' }; },
    say: (key, lang) => `[${lang || '-'}] ${key}`,
    log: (...args) => logs.push(JSON.stringify(args)),
    sleep: async (ms) => { sleeps.push(ms); },
    ...options,
  });
  const ac = new AbortController();
  let run = null;
  const begin_ = () => { run = channel.start({ signal: ac.signal }); run.catch(() => {}); return run; };
  const stop = async () => { ac.abort(); if (run) await withTimeout(run.catch(() => {}), 3000, 'start() to return'); };
  t.after(async () => { await stop(); if (!shared) api.close(); });
  if (begin) begin_();
  return { api, channel, logs, handled, consents, sleeps, ac, stop, begin: begin_, run: () => run };
}

const idle = (channel, updates) => until(() => { const s = channel.stats(); return s.updates >= updates && s.inFlight === 0 && s.queued === 0; }, `${updates} updates handled`);

// ---- Tests ------------------------------------------------------------------------------------------------------------------------

it('a text message round-trips: handle gets sender, chat and language, the reply goes out as plain text', async (t) => {
  const { api, handled } = await boot(t);
  api.push(userMsg(10, 111, 'hello', { from: { id: 111, is_bot: false, language_code: 'pt-BR' } }));
  await until(() => api.sent().length === 1, 'the reply');
  assert.deepEqual(handled, [{ senderKey: '111', chatId: '111', text: 'hello', lang: 'pt' }]);
  assert.deepEqual(api.sent()[0], { chat_id: '111', text: 'echo hello', disable_web_page_preview: true });
  const first = api.of('getUpdates')[0];
  assert.equal(first.offset, undefined, 'no offset before anything was seen');
  assert.equal(first.timeout, 1);
  assert.deepEqual(first.allowed_updates, ['message', 'callback_query']);
  await until(() => api.of('getUpdates').some((b) => b.offset === 11), 'the next poll to confirm update 10');
});

it('/start gets the welcome line and never reaches the model', async (t) => {
  const { api, handled, channel } = await boot(t);
  api.push(userMsg(1, 5, '/start'), userMsg(2, 5, '/start promo'), userMsg(3, 5, '/start@shop_bot'));
  await idle(channel, 3);
  assert.deepEqual(api.sent(5).map((b) => b.text), ['[en] tg.start', '[en] tg.start', '[en] tg.start']);
  assert.deepEqual(handled, []);
});

it('a non-text private message gets the unsupported line; a bot sender is ignored', async (t) => {
  const { api, handled, channel } = await boot(t);
  api.push(
    userMsg(1, 5, null, { photo: [{ file_id: 'x', width: 1, height: 1 }] }),
    userMsg(2, 6, 'hi from a bot', { from: { id: 6, is_bot: true } }),
  );
  await idle(channel, 2);
  assert.deepEqual(api.sent().map((b) => [b.chat_id, b.text]), [['5', '[en] tg.unsupported']]);
  assert.deepEqual(handled, []);
});

it('groups and channels are not served: one notice per chat, nothing reaches the model', async (t) => {
  const { api, handled, channel } = await boot(t);
  const inGroup = (id, chatId, type) => userMsg(id, 9, 'hello all', { chat: { id: chatId, type } });
  api.push(inGroup(1, -100, 'supergroup'), inGroup(2, -100, 'supergroup'), inGroup(3, -200, 'group'), userMsg(4, 9, 'private hello'));
  await idle(channel, 4);
  assert.deepEqual(api.sent(-100).map((b) => b.text), ['[en] tg.private_only']);
  assert.deepEqual(api.sent(-200).map((b) => b.text), ['[en] tg.private_only']);
  assert.deepEqual(handled.map((h) => h.text), ['private hello']);
});

it('a consent card carries Yes/No buttons; accepting answers the button, clears the keyboard, then confirms', async (t) => {
  const { api, consents, channel } = await boot(t, {
    options: {
      handle: async () => ({ ok: true, reply: 'Nice to meet you', pendingConsents: [{ noteId: NOTE, field: 'first_name', value: 'Ann', text: 'May I remember your first name (Ann)?' }] }),
    },
  });
  api.push(userMsg(1, 111, 'my name is Ann'));
  await until(() => api.sent().length === 2, 'the reply and the card');
  assert.equal(api.sent()[0].text, 'Nice to meet you');
  assert.equal(api.sent()[0].reply_markup, undefined);
  assert.equal(api.sent()[1].text, 'May I remember your first name (Ann)?');
  assert.deepEqual(api.sent()[1].reply_markup, { inline_keyboard: [[
    { text: '[en] tg.yes', callback_data: `c:${NOTE}:1` },
    { text: '[en] tg.no', callback_data: `c:${NOTE}:0` },
  ]] });

  api.push(press(2, 111, `c:${NOTE}:1`));
  await until(() => api.sent().length === 3, 'the confirmation');
  await idle(channel, 2);
  assert.deepEqual(consents, [{ senderKey: '111', noteId: NOTE, accept: true }]);
  const after = api.calls.map((c) => c.method).filter((m) => m !== 'getUpdates').slice(2);
  assert.deepEqual(after, ['answerCallbackQuery', 'editMessageReplyMarkup', 'sendMessage']);
  assert.deepEqual(api.of('answerCallbackQuery')[0], { callback_query_id: 'cbq-2' });
  assert.deepEqual(api.of('editMessageReplyMarkup')[0], { chat_id: 111, message_id: 77, reply_markup: { inline_keyboard: [] } });
  assert.equal(api.sent()[2].text, 'Saved');
});

it('declining a consent card clears the keyboard too and sends the decline line', async (t) => {
  const { api, consents, channel } = await boot(t);
  api.push(press(1, 111, `c:${NOTE}:0`));
  await idle(channel, 1);
  assert.deepEqual(consents, [{ senderKey: '111', noteId: NOTE, accept: false }]);
  assert.equal(api.of('editMessageReplyMarkup').length, 1);
  assert.deepEqual(api.sent().map((b) => b.text), ['Not kept']);
});

it('a consent card with a malformed note id is not offered', async (t) => {
  const { api, channel } = await boot(t, {
    options: {
      handle: async () => ({ ok: true, reply: 'ok', pendingConsents: [{ noteId: 'n_not-hex', text: 'bad' }, { noteId: NOTE, text: 'good' }, null] }),
    },
  });
  api.push(userMsg(1, 111, 'hi'));
  await idle(channel, 1);
  assert.deepEqual(api.sent().map((b) => b.text), ['ok', 'good']);
});

it('forged or malformed callback data is answered with no text and ignored', async (t) => {
  const { api, consents, channel } = await boot(t);
  const forged = [`c:${NOTE}:2`, `x:${NOTE}:1`, 'c:n_zzzz:1', `c:n_0123456789ABCDEF:1`, `c:${NOTE}:1 `, `c:${NOTE}:1:extra`, '', undefined];
  forged.forEach((data, i) => api.push(press(i + 1, 111, data)));
  // a well-formed one, but from a message in a group
  api.push(press(100, 111, `c:${NOTE}:1`, { message: { message_id: 3, chat: { id: -5, type: 'supergroup' } } }));
  await idle(channel, forged.length + 1);
  assert.deepEqual(consents, []);
  assert.equal(api.of('answerCallbackQuery').length, forged.length + 1);
  assert.ok(api.of('answerCallbackQuery').every((b) => Object.keys(b).join() === 'callback_query_id'));
  assert.equal(api.of('editMessageReplyMarkup').length, 0);
  assert.equal(api.sent().length, 0);
});

it('a button pressed by someone who does not own the note gets ok:false and nothing is sent', async (t) => {
  const { api, consents, channel } = await boot(t, { options: { consent: async (a) => { consentsSeen.push(a); return { ok: false, error: 'not_found' }; } } });
  const consentsSeen = [];
  api.push(press(1, 222, `c:${NOTE}:1`));
  await idle(channel, 1);
  assert.deepEqual(consentsSeen, [{ senderKey: '222', noteId: NOTE, accept: true }]);
  assert.deepEqual(consents, []);
  assert.deepEqual(api.calls.map((c) => c.method).filter((m) => m !== 'getUpdates'), ['answerCallbackQuery']);
});

it('a consent handler that throws still answers the button and tells the visitor generically', async (t) => {
  const { api, channel } = await boot(t, { options: { consent: async () => { throw new Error('db exploded: secret detail'); } } });
  api.push(press(1, 111, `c:${NOTE}:1`));
  await idle(channel, 1);
  assert.equal(api.of('answerCallbackQuery').length, 1);
  assert.deepEqual(api.sent().map((b) => b.text), ['[en] tg.error']);
});

it('handle ok:false sends its safe reply, or the generic line; a throw sends the generic line and leaks nothing', async (t) => {
  const answers = [
    { ok: false, error: 'rate_visitor', reply: 'Please wait a minute.' },
    { ok: false, error: 'internal detail with stack at line 12' },
    new Error('boom: secret stack detail'),
    { ok: true, reply: '   ' },
  ];
  const { api, channel } = await boot(t, { options: { handle: async () => { const a = answers.shift(); if (a instanceof Error) throw a; return a; } } });
  for (const [i, chat] of [1, 2, 3, 4].entries()) { api.push(userMsg(i + 1, chat, `m${chat}`)); await idle(channel, i + 1); }
  assert.deepEqual(api.sent().map((b) => b.text), ['Please wait a minute.', '[en] tg.error', '[en] tg.error', '[en] tg.error']);
  assert.ok(api.sent().every((b) => !/secret|stack|boom|detail/.test(b.text)));
});

it('splitMessage cuts on a newline or a space when it can, hard otherwise, and never inside a surrogate pair', () => {
  assert.deepEqual(splitMessage('short'), ['short']);
  assert.deepEqual(splitMessage(''), []);
  assert.deepEqual(splitMessage('   '), []);
  assert.deepEqual(splitMessage(`${'a'.repeat(4000)}\n${'b'.repeat(4000)}`), ['a'.repeat(4000), 'b'.repeat(4000)]);
  assert.deepEqual(splitMessage(`${'a'.repeat(4000)} ${'b'.repeat(4000)}`), ['a'.repeat(4000), 'b'.repeat(4000)]);
  assert.deepEqual(splitMessage('x'.repeat(9000)).map((p) => p.length), [4096, 4096, 808]);
  const emoji = `${'a'.repeat(4095)}\u{1F600}${'b'.repeat(10)}`;
  const parts = splitMessage(emoji);
  assert.equal(parts.length, 2);
  assert.equal(parts.join(''), emoji);
  assert.ok(parts.every((p) => p.length <= 4096 && !/[\ud800-\udbff]$/.test(p)));
  for (const p of splitMessage(`${'word '.repeat(2000)}`)) assert.ok(p.length <= 4096);
});

it('a long reply is split at 4096 and delivered in order, and send() splits the same way', async (t) => {
  const long = `${'a'.repeat(4000)}\n${'b'.repeat(4000)}`;
  const { api, channel } = await boot(t, { options: { handle: async () => ({ ok: true, reply: long }) } });
  api.push(userMsg(1, 111, 'tell me everything'));
  await until(() => api.sent(111).length === 2, 'both parts');
  assert.deepEqual(api.sent(111).map((b) => b.text), ['a'.repeat(4000), 'b'.repeat(4000)]);
  const r = await channel.send('111', 'x'.repeat(9000));
  assert.equal(r.ok, true);
  assert.deepEqual(api.sent(111).slice(2).map((b) => b.text.length), [4096, 4096, 808]);
});

it('send() delivers plain text, reports failures without throwing, and refuses anything but a numeric chat id', async (t) => {
  const { api, channel } = await boot(t, { begin: false });
  const ok = await channel.send('111', 'Your order is ready *bold* <b>x</b>');
  assert.equal(ok.ok, true);
  assert.equal(typeof ok.messageId, 'number');
  assert.deepEqual(api.sent()[0], { chat_id: '111', text: 'Your order is ready *bold* <b>x</b>', disable_web_page_preview: true });
  api.script('sendMessage', { status: 403, json: { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' } });
  const blocked = await channel.send(111, 'hi');
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /HTTP 403/);
  const before = api.calls.length;
  assert.equal((await channel.send('@some_channel', 'hi')).ok, false);
  assert.equal((await channel.send('111', '  ')).ok, false);
  assert.equal(api.calls.length, before, 'nothing was sent for a bad chat id or an empty text');
});

it('send() waits retry_after on a 429 and tries again', async (t) => {
  const { api, channel, sleeps } = await boot(t, { begin: false });
  api.script('sendMessage', { status: 429, json: { ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 3 } } });
  const r = await channel.send('111', 'hi');
  assert.equal(r.ok, true);
  assert.deepEqual(sleeps, [3000]);
  assert.equal(api.sent().length, 2);
});

it('me() returns the bot, and a rejected token is fatal without showing the token', async (t) => {
  const { api, channel } = await boot(t, { begin: false });
  assert.deepEqual(await channel.me(), { id: 42, username: 'shop_bot' });
  const wrong = '555555555:BBBwrongTOKENvalue_Q-8zP';
  const bad = createTelegramChannel({ token: wrong, apiBase: api.url, handle: async () => ({}), consent: async () => ({}) });
  await assert.rejects(() => bad.me(), (e) => { assert.equal(e.message, 'telegram: token rejected'); assert.ok(!e.message.includes(wrong)); return true; });
});

it('the offset is saved (0600, atomic) and a restart over the same state file replays nothing', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-tg-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const stateFile = path.join(dir, 'state', 'telegram.json');
  const api = await fakeApi();
  t.after(() => api.close());
  const u10 = userMsg(10, 111, 'first');

  const one = await boot(t, { api, options: { stateFile } });
  api.push(u10);
  await idle(one.channel, 1);
  await until(() => fs.existsSync(stateFile), 'the state file');
  assert.deepEqual(JSON.parse(fs.readFileSync(stateFile, 'utf8')), { offset: 11 });
  assert.equal(fs.statSync(stateFile).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(path.dirname(stateFile)), ['telegram.json'], 'no temp file left behind');
  await one.stop();

  // Telegram delivers update 10 again (it had not been confirmed on its side): the saved offset keeps it from running twice.
  api.push(u10);
  const two = await boot(t, { api, options: { stateFile } });
  await until(() => api.of('getUpdates').some((b) => b.offset === 11), 'a poll with the saved offset');
  api.push(userMsg(11, 111, 'second'));
  await idle(two.channel, 1);
  assert.deepEqual(two.handled.map((h) => h.text), ['second']);
  await two.stop();

  // Without the state file the same redelivery would run again: the saved offset is what prevents it.
  api.push(u10, userMsg(12, 111, 'again'));
  const three = await boot(t, { api });
  await until(() => three.handled.some((h) => h.text === 'first'), 'the replay without a state file');
});

it('a corrupt state file is ignored with a warning, and the same update id is never processed twice', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-tg-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const stateFile = path.join(dir, 'telegram.json');
  fs.writeFileSync(stateFile, '{not json');
  const api = await fakeApi();
  t.after(() => api.close());
  const u5 = userMsg(5, 111, 'm5');
  const u6 = userMsg(6, 111, 'm6');
  api.script('getUpdates', { status: 200, json: { ok: true, result: [u5, u6, u5] } }, { status: 200, json: { ok: true, result: [u5, u6] } });
  const { handled, channel, logs } = await boot(t, { api, options: { stateFile } });
  await idle(channel, 2);
  await nap(50);
  assert.deepEqual(handled.map((h) => h.text), ['m5', 'm6']);
  assert.ok(logs.some((l) => /state file is unreadable/.test(l)));
  assert.deepEqual(JSON.parse(fs.readFileSync(stateFile, 'utf8')), { offset: 7 });
});

it('401 from getUpdates is fatal: start() rejects with "token rejected" and no token anywhere', async (t) => {
  const api = await fakeApi();
  t.after(() => api.close());
  const wrong = '555555555:BBBwrongTOKENvalue_Q-8zP';
  const logs = [];
  const ch = createTelegramChannel({ token: wrong, apiBase: api.url, handle: async () => ({}), consent: async () => ({}), say: () => 'x', log: (...a) => logs.push(JSON.stringify(a)), sleep: async () => {} });
  await assert.rejects(() => withTimeout(ch.start({ signal: AbortSignal.timeout(3000) }), 3500, 'start()'), (e) => {
    assert.equal(e.message, 'telegram: token rejected');
    assert.ok(!e.message.includes(wrong) && !String(e.stack).includes(wrong));
    return true;
  });
  assert.ok(logs.every((l) => !l.includes(wrong)), 'no log line carries the token');
});

it('404 from getUpdates is fatal too', async (t) => {
  const { api, run } = await boot(t, { begin: false });
  api.script('getUpdates', { status: 404, json: { ok: false, error_code: 404, description: 'Not Found' } });
  const ac = new AbortController();
  const ch = createTelegramChannel({ token: TOKEN, apiBase: api.url, handle: async () => ({}), consent: async () => ({}), log: () => {}, sleep: async () => {} });
  await assert.rejects(() => withTimeout(ch.start({ signal: ac.signal }), 3000, 'start()'), /^Error: telegram: token rejected$/);
  assert.equal(run(), null);
});

it('409 from getUpdates is fatal with its own message', async (t) => {
  const { api, channel } = await boot(t, { begin: false });
  api.script('getUpdates', { status: 409, json: { ok: false, error_code: 409, description: 'Conflict: terminated by other getUpdates request' } });
  await assert.rejects(() => withTimeout(channel.start({ signal: AbortSignal.timeout(3000) }), 3500, 'start()'), /^Error: telegram: another consumer is polling this bot$/);
});

it('a 500, a 500, then a 429 are retried (1 s, 2 s, then retry_after), polling goes on, and the backoff resets', async (t) => {
  const { api, channel, handled, sleeps, logs } = await boot(t, { begin: false });
  api.script('getUpdates',
    { status: 500, json: { ok: false, error_code: 500, description: 'Internal Server Error' } },
    { status: 500, json: { ok: false, error_code: 500, description: 'Internal Server Error' } },
    { status: 429, json: { ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 7 } } });
  api.push(userMsg(1, 111, 'after the storm'));
  const ac = new AbortController();
  t.after(() => ac.abort());
  const run = channel.start({ signal: ac.signal });
  run.catch(() => {});
  await idle(channel, 1);
  assert.deepEqual(sleeps, [1000, 2000, 7000]);
  assert.deepEqual(handled.map((h) => h.text), ['after the storm']);
  assert.ok(logs.some((l) => /HTTP 500/.test(l)) && logs.some((l) => /HTTP 429/.test(l)));

  api.script('getUpdates', { status: 502, json: { ok: false, error_code: 502, description: 'Bad Gateway' } });
  api.push(userMsg(2, 111, 'again'));
  await idle(channel, 2);
  assert.equal(sleeps[3], 1000, 'a success put the backoff back to one second');
  ac.abort();
  await withTimeout(run, 3000, 'start() to return');
});

it('the backoff doubles up to 30 s', async (t) => {
  const { api, channel, sleeps } = await boot(t, { begin: false });
  const fail = { status: 500, json: { ok: false, error_code: 500, description: 'x' } };
  api.script('getUpdates', ...Array.from({ length: 8 }, () => fail));
  const ac = new AbortController();
  t.after(() => ac.abort());
  const run = channel.start({ signal: ac.signal });
  run.catch(() => {});
  await until(() => sleeps.length === 8, 'eight retries');
  assert.deepEqual(sleeps, [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  ac.abort();
  await withTimeout(run, 3000, 'start() to return');
});

it('the token never appears in a log argument, an error, or a send() result, even when a dependency echoes it', async (t) => {
  const api = await fakeApi();
  t.after(() => api.close());
  let boom = true;
  const flaky = async (url, init) => {
    if (boom) { boom = false; throw new Error(`connect ECONNREFUSED ${url} (token ${TOKEN})`); }
    return fetch(url, init);
  };
  const { channel, logs } = await boot(t, {
    api,
    options: {
      fetchImpl: flaky,
      handle: async () => { throw new Error(`upstream answered with ${TOKEN}`); },
      consent: async () => { throw new Error(`consent failed ${SECRET_HALF}`); },
    },
  });
  api.script('getUpdates', { status: 500, json: { ok: false, error_code: 500, description: `oops ${TOKEN}` } });
  api.push(userMsg(1, 111, 'hi'), press(2, 111, `c:${NOTE}:1`));
  await idle(channel, 2);
  api.script('sendMessage', { status: 400, json: { ok: false, error_code: 400, description: `chat not found for ${TOKEN}` } });
  const r = await channel.send('111', 'hello');
  assert.equal(r.ok, false);
  assert.ok(!JSON.stringify(r).includes(TOKEN) && !JSON.stringify(r).includes(SECRET_HALF));
  const failing = createTelegramChannel({ token: TOKEN, apiBase: api.url, fetchImpl: async (url) => { throw new Error(`down: ${url}`); }, handle: async () => ({}), consent: async () => ({}) });
  await assert.rejects(() => failing.me(), (e) => { assert.ok(!e.message.includes(TOKEN), e.message); assert.match(e.message, /\*\*\*/); return true; });
  assert.ok(logs.length >= 3, 'the failures were logged');
  assert.ok(logs.every((l) => !l.includes(TOKEN) && !l.includes(SECRET_HALF) && !l.includes(encodeURIComponent(TOKEN))), logs.join('\n'));
  assert.ok(logs.some((l) => l.includes('***')), 'scrubbing was exercised');
});

it('aborting stops start() promptly, even in the middle of a long poll', async (t) => {
  const { api, ac, run } = await boot(t, { apiOpts: { holdMs: 8000 } });
  await until(() => api.of('getUpdates').length === 1, 'the first long poll');
  const t0 = Date.now();
  ac.abort();
  await withTimeout(run(), 2000, 'start() to return');
  assert.ok(Date.now() - t0 < 1500);
  const polls = api.of('getUpdates').length;
  await nap(100);
  assert.equal(api.of('getUpdates').length, polls, 'no poll after the abort');
});

it('aborting also cuts a backoff wait short, and an already aborted signal never calls the API', async (t) => {
  const { api, ac, run } = await boot(t, { options: { sleep: () => new Promise(() => {}) } });
  api.script('getUpdates', { status: 500, json: { ok: false, error_code: 500, description: 'x' } });
  await until(() => api.of('getUpdates').length >= 1, 'the failing poll');
  await nap(30);
  ac.abort();
  await withTimeout(run(), 2000, 'start() to return');

  const done = createTelegramChannel({ token: TOKEN, apiBase: api.url, handle: async () => ({}), consent: async () => ({}) });
  const before = api.calls.length;
  await withTimeout(done.start({ signal: AbortSignal.abort() }), 1000, 'start() on an aborted signal');
  assert.equal(api.calls.length, before);
});

it('updates of one chat run one at a time in order, other chats are not blocked, and the loop keeps polling', async (t) => {
  const gates = new Map();
  const started = [];
  const finished = [];
  const { api, channel } = await boot(t, {
    options: {
      handle: async (a) => {
        started.push(a.text);
        await new Promise((resolve) => gates.set(a.text, resolve));
        finished.push(a.text);
        return { ok: true, reply: `done ${a.text}` };
      },
    },
  });
  api.push(userMsg(1, 1, 'a1'), userMsg(2, 1, 'a2'), userMsg(3, 2, 'b1'));
  await until(() => started.includes('a1') && started.includes('b1'), 'a1 and b1 to start together');
  await nap(60);
  assert.deepEqual(started.sort(), ['a1', 'b1'], 'a2 waits for a1');
  await until(() => api.of('getUpdates').some((b) => b.offset === 4), 'the offset to move past all three while a1 is stuck');
  gates.get('b1')();
  await until(() => api.sent(2).length === 1, 'b1 reply');
  assert.equal(started.includes('a2'), false);
  gates.get('a1')();
  await until(() => started.includes('a2'), 'a2 to start');
  gates.get('a2')();
  await idle(channel, 3);
  assert.deepEqual(api.sent(1).map((b) => b.text), ['done a1', 'done a2']);
  assert.deepEqual(finished.filter((x) => x !== 'b1'), ['a1', 'a2']);
});

it('at most four turns run at once; the others wait their turn', async (t) => {
  let running = 0;
  let max = 0;
  const gates = [];
  const seen = [];
  const { api, channel } = await boot(t, {
    options: {
      handle: async (a) => {
        seen.push(a.text);
        running += 1; max = Math.max(max, running);
        await new Promise((resolve) => gates.push(resolve));
        running -= 1;
        return { ok: true, reply: `done ${a.text}` };
      },
    },
  });
  for (let chat = 1; chat <= 6; chat += 1) api.push(userMsg(chat, chat, `m${chat}`));
  await until(() => running === 4, 'four turns running');
  await nap(60);
  assert.equal(running, 4);
  assert.equal(seen.length, 4);
  while (api.sent().length < 6) { gates.splice(0).forEach((g) => g()); await nap(10); }
  await idle(channel, 6);
  assert.equal(max, 4);
  assert.equal(seen.length, 6);
});
