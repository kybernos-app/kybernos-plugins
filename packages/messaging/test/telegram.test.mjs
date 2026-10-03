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

/** Faux serveur Bot API : aucune requête ne sort vers Telegram. */
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
                  from: { id: 9, username: 'miled', is_bot: false },
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
        if (raw.includes('INCHANGÉ')) {
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

test('normalizeUpdate extrait chat, texte, pièces jointes et ignore les bots', () => {
  const message = normalizeUpdate({
    update_id: 1,
    message: {
      message_id: 5,
      date: 1700000000,
      chat: { id: -100, type: 'group' },
      from: { id: 9, username: 'miled', is_bot: false },
      text: 'bonjour',
      document: { file_id: 'f', file_name: 'notes.pdf', file_size: 10, mime_type: 'application/pdf' },
    },
  });
  assert.equal(message.chatId, '-100');
  assert.equal(message.text, 'bonjour');
  assert.equal(message.attachments[0].name, 'notes.pdf');

  assert.equal(
    normalizeUpdate({ update_id: 2, message: { message_id: 1, chat: { id: 1 }, from: { id: 2, is_bot: true }, text: 'x' } }),
    null,
  );
  assert.equal(normalizeUpdate({ update_id: 3 }), null);
});

test('normalizeUpdate retient la plus grande photo', () => {
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
});

test('createTelegramAdapter refuse l’absence de token', () => {
  assert.throws(() => createTelegramAdapter({}), /token/);
});

test('start reçoit un message, télécharge la pièce jointe et avance l’offset', async () => {
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
  assert.equal(message.from, 'miled');
  assert.equal(message.attachments.length, 1);
  assert.ok(message.attachments[0].localPath, 'la pièce jointe doit être téléchargée');
  assert.equal(fs.readFileSync(message.attachments[0].localPath, 'utf8'), 'contenu-image');
  assert.deepEqual(offsets, [8]);
  assert.ok(calls.some((c) => c.method === 'getFile'));
  assert.ok(calls.some((c) => c.method === 'download'));
});

test('un webhook actif (409) est une erreur fatale explicite', async () => {
  const { base, close } = await startFakeApi();
  const adapter = createTelegramAdapter({ token: 'CONFLICT', apiBase: base, log: () => {} });
  try {
    await assert.rejects(
      () => adapter.start({ onMessage: async () => {}, signal: new AbortController().signal }),
      /409|webhook/,
    );
  } finally {
    close();
  }
});

test('send et edit renvoient les identifiants, une édition identique ne lève pas', async () => {
  const { base, close } = await startFakeApi();
  const adapter = createTelegramAdapter({ token: 'TEST', apiBase: base, log: () => {} });
  try {
    const sent = await adapter.send('42', 'coucou');
    assert.equal(sent.messageId, 11);
    assert.equal(sent.chatId, '42');
    assert.equal(await adapter.edit('42', 11, 'coucou v2'), true);
    assert.equal(await adapter.edit('42', 11, 'INCHANGÉ'), false);
    const me = await adapter.me();
    assert.equal(me.username, 'testbot');
  } finally {
    close();
  }
});

test('sendFile choisit sendPhoto pour une image et sendDocument sinon', async () => {
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

test('une erreur réseau transitoire est marquée non fatale', async () => {
  const adapter = createTelegramAdapter({ token: 'TEST', apiBase: 'http://127.0.0.1:1', log: () => {} });
  await assert.rejects(
    () => adapter.send('42', 'test'),
    (err) => err.transient === true && !err.fatal,
  );
});
