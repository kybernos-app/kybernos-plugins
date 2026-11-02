import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { createTelegramAdapter, normalizeUpdate } from '../channels/telegram.mjs';

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-tg-'));
}

/** Fake Bot API server: no request leaves for Telegram. */
async function startFakeApi() {
  const calls = [];
  let served = 0;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    const url = new URL(req.url, 'http://127.0.0.1');
    const parts = url.pathname.split('/').filter(Boolean);
    const json = (body, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (parts[0] === 'file') {
      calls.push({ method: 'download', path: url.pathname });
      res.writeHead(200, { 'content-type': 'image/jpeg' });
      res.end('contenu-image');
      return;
    }

    const token = parts[0]; // botTEST
    const method = parts[1];
    calls.push({ method, token, raw });

    if (token === 'botCONFLICT' && method === 'getUpdates') {
      json({ ok: false, error_code: 409, description: 'Conflict: can not use getUpdates while webhook is active' }, 409);
      return;
    }
    switch (method) {
      case 'getUpdates': {
        served += 1;
        if (served === 1) {
          json({
            ok: true,
            result: [
              {
                update_id: 7,
                message: {
                  message_id: 5,
                  date: 1700000000,
                  chat: { id: 42, type: 'private' },
                  from: { id: 9, username: 'alex', is_bot: false, language_code: 'fr' },
                  caption: 'salut',
                  photo: [{ file_id: 'petit' }, { file_id: 'grand', file_size: 1234 }],
                },
              },
            ],
          });
          return;
        }
        json({ ok: true, result: [] });
        return;
      }
      case 'sendMessage':
        json({ ok: true, result: { message_id: 11, chat: { id: 42 } } });
        return;
      case 'editMessageText': {
        if (raw.includes('UNCHANGED')) {
          json({ ok: false, error_code: 400, description: 'Bad Request: message is not modified' }, 400);
          return;
        }
        json({ ok: true, result: { message_id: 11 } });
        return;
      }
      case 'getFile':
        json({ ok: true, result: { file_path: 'docs/photo-5.jpg' } });
        return;
      case 'getMe':
        json({ ok: true, result: { id: 1, username: 'testbot' } });
        return;
      case 'sendDocument':
      case 'sendPhoto':
        json({ ok: true, result: { message_id: 12, document: { file_id: 'doc' }, chat: { id: 42 } } });
        return;
      default:
        json({ ok: false, error_code: 404, description: 'not found' }, 404);
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const close = () => {
    server.closeAllConnections?.();
    server.close();
  };
  return { server, base: `http://127.0.0.1:${port}`, calls, close };
}

test('normalizeUpdate extracts chat, text, attachments and ignores bots', () => {
  const message = normalizeUpdate({
    update_id: 1,
    message: {
      message_id: 5,
      date: 1700000000,
      chat: { id: -100, type: 'group' },
      from: { id: 9, username: 'alex', is_bot: false, language_code: 'en-GB' },
      text: 'bonjour',
      document: { file_id: 'f', file_name: 'notes.pdf', file_size: 10, mime_type: 'application/pdf' },
    },
  });
  assert.equal(message.chatId, '-100');
  assert.equal(message.text, 'bonjour');
  assert.equal(message.attachments[0].name, 'notes.pdf');
  assert.equal(message.lang, 'en-GB', 'the sender’s language code is handed to the core');

  assert.equal(
    normalizeUpdate({ update_id: 2, message: { message_id: 1, chat: { id: 1 }, from: { id: 2, is_bot: true }, text: 'x' } }),
    null,
  );
  assert.equal(normalizeUpdate({ update_id: 3 }), null);
});

test('normalizeUpdate keeps the largest photo, and a sender without a language code has lang null', () => {
  const message = normalizeUpdate({
    update_id: 4,
    message: {
      message_id: 6,
      date: 1,
      chat: { id: 1 },
      from: { id: 2, is_bot: false },
      photo: [{ file_id: 'petit' }, { file_id: 'moyen' }, { file_id: 'grand', file_size: 999 }],
    },
  });
  assert.equal(message.attachments[0].fileId, 'grand');
  assert.equal(message.attachments[0].kind, 'photo');
  assert.equal(message.lang, null);
});

test('createTelegramAdapter refuses a missing token', () => {
  assert.throws(() => createTelegramAdapter({}), /Telegram token missing/);
});

test('start receives a message, downloads the attachment and moves the offset forward', async () => {
  const { base, calls, close } = await startFakeApi();
  const inbox = path.join(tmpdir(), 'inbox');
  const offsets = [];
  const received = [];
  const controller = new AbortController();
  const adapter = createTelegramAdapter({
    token: 'TEST',
    apiBase: base,
    initialOffset: 0,
    onOffset: (offset) => offsets.push(offset),
    log: () => {},
  });

  try {
    await adapter.start({
      onMessage: async (message) => {
        received.push(message);
        controller.abort();
      },
      inboxFor: () => inbox,
      signal: controller.signal,
    });
  } finally {
    close();
  }

  assert.equal(received.length, 1);
  const message = received[0];
  assert.equal(message.chatId, '42');
  assert.equal(message.text, 'salut');
  assert.equal(message.from, 'alex');
  assert.equal(message.lang, 'fr');
  assert.equal(message.attachments.length, 1);
  assert.ok(message.attachments[0].localPath, 'the attachment must be downloaded');
  assert.equal(fs.readFileSync(message.attachments[0].localPath, 'utf8'), 'contenu-image');
  assert.deepEqual(offsets, [8]);
  assert.ok(calls.some((c) => c.method === 'getFile'));
  assert.ok(calls.some((c) => c.method === 'download'));
});

test('an active webhook (409) is an explicit fatal error, in English', async () => {
  const { base, close } = await startFakeApi();
  const adapter = createTelegramAdapter({ token: 'CONFLICT', apiBase: base, log: () => {} });
  try {
    await assert.rejects(
      () => adapter.start({ onMessage: async () => {}, signal: new AbortController().signal }),
      /getUpdates refused \(409\) — a webhook is configured/,
    );
  } finally {
    close();
  }
});

test('send and edit return the identifiers, an identical edit does not throw', async () => {
  const { base, close } = await startFakeApi();
  const adapter = createTelegramAdapter({ token: 'TEST', apiBase: base, log: () => {} });
  try {
    const sent = await adapter.send('42', 'coucou');
    assert.equal(sent.messageId, 11);
    assert.equal(sent.chatId, '42');
    assert.equal(await adapter.edit('42', 11, 'coucou v2'), true);
    assert.equal(await adapter.edit('42', 11, 'UNCHANGED'), false);
    const me = await adapter.me();
    assert.equal(me.username, 'testbot');
  } finally {
    close();
  }
});

test('sendFile picks sendPhoto for an image and sendDocument otherwise', async () => {
  const { base, calls, close } = await startFakeApi();
  const dir = tmpdir();
  const image = path.join(dir, 'capture.png');
  const doc = path.join(dir, 'rapport.txt');
  fs.writeFileSync(image, 'png');
  fs.writeFileSync(doc, 'texte');
  const adapter = createTelegramAdapter({ token: 'TEST', apiBase: base, log: () => {} });
  try {
    await adapter.sendFile('42', image);
    await adapter.sendFile('42', doc);
    const methods = calls.filter((c) => c.method.startsWith('send')).map((c) => c.method);
    assert.ok(methods.includes('sendPhoto'));
    assert.ok(methods.includes('sendDocument'));
  } finally {
    close();
  }
});

test('a transient network error is marked non-fatal, and says so in English', async () => {
  const adapter = createTelegramAdapter({ token: 'TEST', apiBase: 'http://127.0.0.1:1', log: () => {} });
  await assert.rejects(
    () => adapter.send('42', 'test'),
    (err) => err.transient === true && !err.fatal && /^sendMessage: network — /.test(err.message),
  );
});
