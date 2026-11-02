// The owner's side of the HTTP server, and the visitor routes added with it, over a real local port: the public config and polling,
// the site script, the owner's pages, the admin API on both prefixes, the inbox, undo, unanswered questions and the studio (draft,
// gate, publish, rollback, preview). The clock is injected where time matters (rate windows).

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHttpServer } from '../server/http.mjs';
import { widgetScript } from '../server/widget.mjs';
import { scriptedModel, stepOf } from '../core/scripted.mjs';
import { makeShop, clock } from './helpers-shop.mjs';

const TOKEN = 'owner-token-for-tests';
const VID = 'a1b2c3d4e5f60718a1b2c3d4e5f60718';
const VID2 = 'b1b2c3d4e5f60718a1b2c3d4e5f60718';
const QUEUED = 'Your message was passed on. A person from the shop will answer you here.';
const GR = { actions: { leave_message: 'auto', note_visitor: 'auto' }, limits: { perIpPerMin: 120, perVisitorPerMin: 60, perShopPerMin: 1200 } };
const HEX24 = 'f'.repeat(24);
const HEX16 = 'f'.repeat(16);

const opened = [];
after(async () => { for (const close of opened) await close(); });

async function boot({ seed, guardrails = GR, handler, model, previewModel, ownerToken = TOKEN, c = clock(), runChecks, info, trustProxy } = {}) {
  const svc = makeShop({ seed, guardrails, handler, model, previewModel, now: c.now, runChecks });
  const server = createHttpServer({ service: svc, ownerToken, now: c.now, trustProxy, info });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = (path, { method = 'GET', body, headers = {}, auth = false } = {}) => fetch(base + path, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(auth ? { authorization: `Bearer ${TOKEN}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const h = {
    svc, base, c, req,
    get: (path, opts) => req(path, opts),
    post: (path, body, opts = {}) => req(path, { ...opts, method: 'POST', body }),
    admin: (path, opts) => req(`/v1/admin/${path}`, { auth: true, ...opts }),
    adminPost: (path, body) => req(`/v1/admin/${path}`, { auth: true, method: 'POST', body }),
    /** A visitor message on the site chat. */
    say: (text, visitorId = VID, extra = {}) => req('/c/test-shop/messages', { method: 'POST', body: { visitorId, text, ...extra } }),
    ops: (ops, scope) => req('/v1/admin/studio/ops', { auth: true, method: 'POST', body: scope === undefined ? { ops } : { ops, scope } }),
    studio: async () => (await h.admin('studio')).json(),
    overview: async () => (await h.admin('overview')).json(),
    /** review + checks + publish, the way the Atelier's gate does it. */
    async publish(summary = 'test') {
      assert.equal((await h.adminPost('studio/review', {})).status, 200);
      assert.equal((await h.adminPost('studio/checks', {})).status, 200);
      return h.adminPost('studio/publish', { summary });
    },
  };
  opened.push(() => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }));
  return h;
}

const cfgOf = (html) => JSON.parse(/<script type="application\/json" id="cfg">([\s\S]*?)<\/script>/.exec(html)[1]);
const cspOf = (res) => res.headers.get('content-security-policy');
const nonceOf = (res) => /script-src 'nonce-([^']+)'/.exec(cspOf(res))[1];
const codes = (blockers) => blockers.map((b) => b.code);
const ownerPages = ['/boite', '/atelier', '/preview'];

// ---------------------------------------------------------------------------------------------------------------- visitor routes

test('GET config is public with CORS *, holds nothing but what the page shows, and follows the origin rule', async () => {
  const h = await boot({ guardrails: { ...GR, allowedOrigins: ['https://shop.example'] }, seed: { brand: { color: '#aa3366', greeting: 'Hi there' } } });
  const res = await h.get('/c/test-shop/config');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.equal(res.headers.get('cache-control'), 'public, max-age=60');
  assert.match(res.headers.get('content-type'), /^application\/json/);
  const text = await res.text();
  assert.deepEqual(JSON.parse(text), { name: 'Test Shop', color: '#aa3366', greeting: 'Hi there', language: 'en', labels: { open: 'Chat with us', close: 'Close the chat' } });
  assert.doesNotMatch(text, /Open every day|budget|guardrail|token|knowledge/i);

  const listed = await h.get('/c/test-shop/config', { headers: { origin: 'https://shop.example' } });
  assert.deepEqual([listed.status, listed.headers.get('access-control-allow-origin')], [200, '*']);
  const stranger = await h.get('/c/test-shop/config', { headers: { origin: 'https://evil.example' } });
  assert.deepEqual([stranger.status, stranger.headers.get('access-control-allow-origin')], [403, null], 'a site the owner did not list gets nothing');
  assert.equal((await h.get('/c/other-shop/config')).status, 404);

  const fr = await boot({ seed: { language: 'fr' } });
  assert.deepEqual((await (await fr.get('/c/test-shop/config')).json()).labels, { open: 'Discuter avec nous', close: 'Fermer la discussion' });
});

test('GET /widget.js: a script, safe by construction, that holds no visitor data', async () => {
  const h = await boot();
  const res = await h.get('/widget.js');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/javascript; charset=utf-8');
  assert.equal(res.headers.get('cross-origin-resource-policy'), 'cross-origin');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('cache-control'), 'public, max-age=300');
  const js = await res.text();
  assert.equal(js, widgetScript());
  assert.doesNotThrow(() => new vm.Script(js), 'the served text is valid JavaScript');
  assert.match(js, /attachShadow\(\{ mode: 'open' \}\)/, 'everything lives in a shadow root');
  assert.doesNotMatch(js, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function|localStorage|sessionStorage|document\.cookie/, 'no markup built from strings, no storage, no code from strings');
  assert.match(js, /\^\[a-z0-9\]\[a-z0-9-\]\{2,39\}\$/, 'the shop slug is checked before it is used');
  assert.match(js, /setAttribute\('allow', ''\)/, 'the iframe gets no permission');
});

test('poll: a bad visitor id is refused, one visitor never reads another\'s conversation, and `after` returns only what is newer', async () => {
  const h = await boot({ handler: () => ({ text: 'Bot says hi.' }) });
  for (const bad of ['', 'short', VID.toUpperCase(), `${VID.slice(0, 31)}!`, 'x'.repeat(65)]) {
    assert.equal((await h.get(`/c/test-shop/messages?visitorId=${bad}`)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await h.get('/c/test-shop/messages')).status, 400, 'no visitor id at all');
  assert.equal((await h.get(`/c/other-shop/messages?visitorId=${VID}`)).status, 404);

  const sent = await (await h.say('hello')).json();
  h.c.tick(5000);
  const conv = (await h.overview()).conversations[0].id;
  const rep = await h.adminPost(`conversations/${conv}/reply`, { text: 'Ann here, from the shop.' });
  assert.deepEqual(await rep.json(), { ok: true, mode: 'human', delivered: true });
  const ownerTs = h.c.t;

  const poll = async (q, id = VID) => (await h.get(`/c/test-shop/messages?visitorId=${id}${q}`)).json();
  const both = [{ ts: sent.at, role: 'assistant', text: 'Bot says hi.' }, { ts: ownerTs, role: 'owner', text: 'Ann here, from the shop.' }];
  assert.deepEqual(await poll('&after=0'), { mode: 'human', messages: both });
  assert.deepEqual((await poll(`&after=${sent.at}`)).messages, [both[1]], 'only the owner words are newer than the assistant line');
  assert.deepEqual((await poll(`&after=${ownerTs}`)).messages, [], 'nothing newer');
  assert.deepEqual((await poll('&after=garbage')).messages, both, 'an unreadable `after` means "everything"');
  assert.deepEqual((await poll('')).messages, both, 'and so does none');
  assert.deepEqual(await poll('&after=0', VID2), { mode: 'agent', messages: [] }, 'another visitor sees none of it');
});

test('poll: 60 a minute per address, then 429 until the window passes; a spoofed forwarding header does not help unless the proxy is trusted', async () => {
  const h = await boot();
  const url = `/c/test-shop/messages?visitorId=${VID}&after=0`;
  for (let i = 0; i < 60; i += 1) {
    const r = await h.get(url, { headers: { 'x-forwarded-for': `9.9.9.${i}` } });
    assert.equal(r.status, 200, `poll ${i + 1}`);
    await r.text();
  }
  const over = await h.get(url, { headers: { 'x-forwarded-for': '8.8.8.8' } });
  assert.equal(over.status, 429);
  assert.deepEqual(await over.json(), { error: 'slow_down' });
  h.c.tick(59_000);
  assert.equal((await h.get(url)).status, 429, 'still inside the minute');
  h.c.tick(61_000);
  assert.equal((await h.get(url)).status, 200, 'a minute later it works again');

  const behind = await boot({ trustProxy: true });
  for (let i = 0; i < 60; i += 1) await (await behind.get(url, { headers: { 'x-forwarded-for': '1.1.1.1' } })).text();
  assert.equal((await behind.get(url, { headers: { 'x-forwarded-for': '1.1.1.1' } })).status, 429);
  assert.equal((await behind.get(url, { headers: { 'x-forwarded-for': '2.2.2.2' } })).status, 200, 'behind a trusted proxy each client address has its own count');
});

// ---------------------------------------------------------------------------------------------------------------- pages

test('the owner pages do not exist without an owner token', async () => {
  const h = await boot({ ownerToken: null });
  for (const p of ownerPages) {
    const r = await h.get(p);
    assert.deepEqual([p, r.status, (await r.json()).error], [p, 404, 'not_found']);
  }
  for (const p of ['/v1/admin/overview', '/api/overview', '/api/studio']) {
    assert.equal((await h.get(p, { headers: { authorization: `Bearer ${TOKEN}` } })).status, 404, p);
  }
});

test('the owner pages: a nonce that matches the inline script and style, no style attribute, framed by nobody but themselves', async () => {
  const h = await boot({ guardrails: { ...GR, allowedOrigins: ['https://a.example', 'https://b.example'] } });
  const seen = new Set();
  for (const p of ownerPages) {
    const res = await h.get(p); // the shells are static: the token is asked for by the page itself
    assert.equal(res.status, 200, p);
    assert.match(res.headers.get('content-type'), /^text\/html; charset=utf-8/);
    const html = await res.text();
    const csp = cspOf(res);
    const nonce = nonceOf(res);
    seen.add(nonce);
    for (const part of ["default-src 'none'", `style-src 'nonce-${nonce}'`, "connect-src 'self'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'self'"]) assert.ok(csp.includes(part), `${p}: ${part}`);
    assert.doesNotMatch(csp, /a\.example|unsafe-inline|unsafe-eval/, `${p}: the shop's own sites cannot frame the owner's pages`);
    assert.equal(csp.includes("frame-src 'self'"), p === '/atelier', `${p}: only the Atelier frames something (its preview)`);

    // Walk the real element blocks (the inline script holds the text "<script" inside a string, which is not an element).
    const blocks = [...html.matchAll(/<(script|style)\b([^>]*)>([\s\S]*?)<\/\1>/g)];
    assert.deepEqual(blocks.map((b) => b[1]), ['style', 'script', 'script'], `${p}: one style, the JSON block, one script`);
    const executable = blocks.filter((b) => !/type="application\/json"/.test(b[2]));
    assert.deepEqual(executable.map((b) => b[2].trim()), [`nonce="${nonce}"`, `nonce="${nonce}"`], `${p}: the style and the script carry this response's nonce`);
    assert.doesNotMatch(html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g, ''), /<(script|style)\b/, `${p}: no other script or style element`);
    assert.doesNotMatch(html, /\sstyle\s*=\s*["']/i, `${p}: the CSP blocks inline style attributes: use classes`);
    assert.match(html, p === '/preview' ? /<title>Test Shop<\/title>/ : /<title>Test Shop · (Inbox|Atelier)<\/title>/);
    assert.doesNotMatch(html, /(?:src|href|action|poster)\s*=\s*["']https?:|url\(\s*["']?https?:|@import/i, `${p}: nothing is loaded from another host`);
  }
  assert.equal(seen.size, 3, 'a new nonce for every response');
});

test('the visitor page frames by the owner\'s listed sites, or by nobody; the preview page shows the DRAFT and is never framed by a site', async () => {
  const none = await boot();
  for (const p of ['/', '/c/test-shop']) {
    const res = await none.get(p);
    assert.equal(res.status, 200, p);
    assert.match(cspOf(res), /frame-ancestors 'none'$/, `${p}: no listed site, no framing`);
    assert.equal(cspOf(res).includes('frame-src'), false);
  }
  const h = await boot({ guardrails: { ...GR, allowedOrigins: ['https://a.example', 'https://b.example'] }, seed: { brand: { greeting: 'Hello from live' } } });
  for (const p of ['/', '/c/test-shop']) assert.match(cspOf(await h.get(p)), /frame-ancestors https:\/\/a\.example https:\/\/b\.example$/, p);
  const prev = await h.get('/preview');
  assert.match(cspOf(prev), /frame-ancestors 'self'$/);

  assert.equal((await h.ops([{ op: 'set', path: 'brand.greeting', value: 'Hello from the draft' }])).status, 200);
  assert.deepEqual([cfgOf(await prev.text()).preview, cfgOf(await (await h.get('/preview')).text()).hello], [true, 'Hello from the draft']);
  const live = cfgOf(await (await h.get('/c/test-shop')).text());
  assert.deepEqual([live.preview, live.hello], [false, 'Hello from live'], 'the public page still shows the live fiche');
});

// ---------------------------------------------------------------------------------------------------------------- admin API

test('the admin API answers on /v1/admin and on /api, and only to the right Bearer', async () => {
  const h = await boot();
  for (const prefix of ['/v1/admin', '/api']) {
    const none = await h.get(`${prefix}/overview`);
    assert.deepEqual([none.status, await none.json()], [401, { error: 'unauthorized' }], prefix);
    for (const authorization of ['Bearer wrong', `Bearer ${TOKEN.slice(0, -1)}`, `${TOKEN}`, `Basic ${Buffer.from(`x:${TOKEN}`).toString('base64')}`, 'Bearer ']) {
      assert.equal((await h.get(`${prefix}/overview`, { headers: { authorization } })).status, 401, `${prefix} ${authorization}`);
    }
    const ok = await h.get(`${prefix}/overview`, { auth: true });
    assert.equal(ok.status, 200, prefix);
    assert.equal((await ok.json()).shop.slug, 'test-shop');
    assert.equal((await h.get(`${prefix}/nothing-here`, { auth: true })).status, 404);
    h.c.tick(61_000); // the wrong tokens above must not trip the ten-a-minute limit of the next prefix
  }
  const status = await (await h.get('/api/status', { auth: true })).json();
  assert.deepEqual(status, { shop: { name: 'Test Shop', slug: 'test-shop' }, mode: 'live', publicUrl: null, channels: {}, killed: false, version: 1 });
});

test('ten wrong tokens in a minute close the admin API to everyone on that address, even with the right token, until the minute passes', async () => {
  const h = await boot();
  for (let i = 0; i < 10; i += 1) {
    assert.equal((await h.get(i % 2 ? '/api/overview' : '/v1/admin/overview', { headers: { authorization: `Bearer nope${i}` } })).status, 401, `try ${i + 1}`);
  }
  const wrong = await h.get('/v1/admin/overview', { headers: { authorization: 'Bearer nope' } });
  assert.deepEqual([wrong.status, await wrong.json()], [429, { error: 'slow_down' }]);
  assert.equal((await h.get('/v1/admin/overview', { auth: true })).status, 429, 'the right token waits too: the two prefixes share the count');
  assert.equal((await h.get('/api/overview', { auth: true })).status, 429);
  h.c.tick(60_000);
  assert.equal((await h.get('/v1/admin/overview', { auth: true })).status, 200, 'a minute later the door opens again');
  assert.equal((await h.get('/v1/admin/overview', { headers: { authorization: 'Bearer nope' } })).status, 401, 'and a wrong token is a plain 401 again');
});

test('every inbox, undo, unanswered, studio and preview route asks for the token', async () => {
  const h = await boot();
  const routes = [
    ['GET', `conversations/c_${HEX24}`], ['POST', `conversations/c_${HEX24}/reply`], ['POST', `conversations/c_${HEX24}/mode`], ['POST', `conversations/c_${HEX24}/read`],
    ['GET', `conversations/c_${HEX24}/export`], ['DELETE', `conversations/c_${HEX24}`], ['POST', `done/d_${HEX16}/undo`], ['POST', `unanswered/u_${HEX16}`],
    ['GET', 'studio'], ['POST', 'studio/ops'], ['POST', 'studio/discard'], ['POST', 'studio/review'], ['POST', 'studio/checks'], ['POST', 'studio/publish'], ['POST', 'studio/rollback'],
    ['POST', 'preview/messages'], ['POST', 'preview/consent'], ['POST', 'preview/reset'],
  ];
  for (const [method, p] of routes) {
    const r = await h.req(`/api/${p}`, { method, body: method === 'POST' ? {} : undefined });
    assert.equal(r.status, 401, `${method} ${p}`);
    h.c.tick(61_000); // stay under the ten-failures-a-minute limit
  }
});

// ---------------------------------------------------------------------------------------------------------------- conversations

test('conversations: list, detail, take over, reply, read, hand back, export, erase; the visitor\'s JSON cannot set the channel or the reach', async () => {
  const model = scriptedModel(() => ({ text: 'Bot answer.' }));
  const h = await boot({ model });
  const first = await h.say('Hello shop', VID, { channel: 'tg', reach: '999', level: 3 });
  assert.equal(first.status, 200);

  const ov = await h.overview();
  assert.deepEqual(ov.conversations.map(({ lastAt, ...rest }) => rest), [{ id: ov.conversations[0].id, channel: 'site', level: 1, preview: 'Hello shop', mode: 'agent', unread: 1 }]);
  assert.equal(ov.waiting, 0);
  const id = ov.conversations[0].id;
  assert.equal(h.svc.store.getDoc('conversations', id).reach, undefined, 'a site visitor cannot say where the owner\'s reply goes');

  const detail = await (await h.admin(`conversations/${id}`)).json();
  assert.deepEqual([detail.meta.mode, detail.meta.unread, typeof detail.meta.createdAt], ['agent', 1, 'number']);
  assert.deepEqual(detail.log.map((e) => e.role), ['user', 'assistant']);
  assert.deepEqual([detail.card, detail.done, detail.unanswered, detail.bookings], [{ level: 1, channel: 'site', fields: {} }, [], [], []]);
  assert.equal((await h.admin(`conversations/c_${HEX24}`)).status, 404);
  assert.equal((await h.admin('conversations/not-an-id')).status, 404);

  const mode = (m, conv = id) => h.adminPost(`conversations/${conv}/mode`, { mode: m });
  const bad = await mode('robot');
  assert.deepEqual([bad.status, await bad.json()], [409, { ok: false, error: 'bad_mode' }]);
  assert.equal((await mode('human', `c_${HEX24}`)).status, 404);
  const reply = (text, conv = id) => h.adminPost(`conversations/${conv}/reply`, { text });
  const empty = await reply('  ');
  assert.deepEqual([empty.status, (await empty.json()).error], [400, 'empty']);
  assert.equal((await reply('hi', `c_${HEX24}`)).status, 404);
  assert.equal((await h.admin(`conversations/${id}/reply`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'hi' })).status, 415);

  const said = await reply('Hi, Ann here.');
  assert.deepEqual([said.status, await said.json()], [200, { ok: true, mode: 'human', delivered: true }]);
  const after = await (await h.admin(`conversations/${id}`)).json();
  assert.deepEqual([after.meta.mode, after.meta.unread, after.log.at(-1).role, after.log.at(-1).text], ['human', 0, 'owner', 'Hi, Ann here.']);

  const held = await (await h.say('Are you there?')).json();
  assert.deepEqual([held.ok, held.human, held.reply, held.pendingConsents], [true, true, QUEUED, []]);
  assert.equal(model.calls.length, 1, 'the model was not called while a person had the conversation');
  const waiting = await h.overview();
  assert.deepEqual([waiting.waiting, waiting.conversations[0].unread, waiting.conversations[0].mode], [1, 1, 'human']);
  const read = await h.adminPost(`conversations/${id}/read`, {});
  assert.deepEqual([read.status, await read.json()], [200, { ok: true }]);
  assert.equal((await h.overview()).waiting, 0);

  const exp = await h.admin(`conversations/${id}/export`);
  assert.equal(exp.status, 200);
  assert.equal(exp.headers.get('content-disposition'), `attachment; filename="conversation-${id}.json"`);
  const doc = await exp.json();
  assert.deepEqual([typeof doc.exportedAt, doc.meta.id, doc.log.length, doc.remembered, doc.done, doc.messages, doc.callbacks, doc.bookings], ['number', id, 4, {}, [], [], [], []]);

  assert.equal((await mode('agent')).status, 200);
  const back = await (await h.say('And now?')).json();
  assert.deepEqual([back.reply, back.human], ['Bot answer.', false]);
  assert.equal(model.calls.length, 2, 'handing back brings the model back');

  const gone = await h.admin(`conversations/${id}`, { method: 'DELETE' });
  const erased = await gone.json();
  assert.deepEqual([gone.status, erased.ok, erased.erased.conversations], [200, true, 1]);
  assert.equal((await h.admin(`conversations/${id}`)).status, 404);
  assert.deepEqual(h.svc.store.readLog(`conv_${id.slice(2)}`), []);
  assert.deepEqual((await h.overview()).conversations, []);
});

test('undo over HTTP: the message goes, it runs once, and an unknown or malformed id is a 404', async () => {
  const h = await boot({ handler: ({ messages }) => (stepOf(messages) === 0 ? { toolCalls: [{ name: 'leave_message', args: { message: 'Call me back please' } }] } : { text: 'Noted.' }) });
  await h.say('please call me');
  const ov = await h.overview();
  assert.equal(ov.messages.length, 1);
  const detail = await (await h.admin(`conversations/${ov.conversations[0].id}`)).json();
  assert.equal(detail.done.length, 1);
  const done = detail.done[0];
  assert.match(done.id, /^d_[0-9a-f]{16}$/);
  assert.deepEqual([done.kind, done.status], ['message', 'done']);

  const undo = await h.adminPost(`done/${done.id}/undo`, {});
  assert.deepEqual([undo.status, await undo.json()], [200, { ok: true }]);
  assert.equal((await h.overview()).messages.length, 0);
  const again = await h.adminPost(`done/${done.id}/undo`, {});
  assert.deepEqual([again.status, (await again.json()).error], [409, 'already_undone']);
  assert.equal((await h.adminPost(`done/d_${HEX16}/undo`, {})).status, 404);
  assert.equal((await h.adminPost('done/xyz/undo', {})).status, 404);
  const detail2 = await (await h.admin(`conversations/${ov.conversations[0].id}`)).json();
  assert.equal(detail2.done[0].status, 'undone');
});

test('an unanswered question answered by the owner becomes a validated fact in the DRAFT only; publishing it makes the assistant know it, with no restart', async () => {
  const model = scriptedModel(({ messages }) => (stepOf(messages) === 0 && /abroad/.test(messages.at(-1).content)
    ? { toolCalls: [{ name: 'report_unanswered', args: { question: 'Do you ship abroad?' } }] }
    : { text: 'ok' }));
  const h = await boot({ model });
  await h.say('Do you ship abroad?');
  const ov = await h.overview();
  assert.equal(ov.unanswered.length, 1);
  const q = ov.unanswered[0];
  assert.match(q.id, /^u_[0-9a-f]{16}$/);
  const answerOf = (id, body) => h.adminPost(`unanswered/${id}`, body);

  for (const body of [{}, { answer: '   ' }, { answer: 5 }, { dismiss: 'yes' }]) assert.equal((await answerOf(q.id, body)).status, 400, JSON.stringify(body));
  assert.equal((await answerOf(`u_${HEX16}`, { dismiss: true })).status, 404);
  assert.equal((await h.overview()).unanswered.length, 1, 'refused requests leave the question open');

  const done = await answerOf(q.id, { answer: 'We ship to the EU in 5 days.' });
  assert.deepEqual([done.status, await done.json()], [200, { ok: true, status: 'answered' }]);
  assert.equal(h.svc.fiche.knowledge.length, 1, 'the live fiche did not change');
  const st = await h.studio();
  assert.deepEqual(st.draft.knowledge.at(-1), { text: 'We ship to the EU in 5 days.', source: 'owner answer', validated: true });
  assert.equal(st.dirty, true);
  assert.deepEqual(codes(st.blockers), ['not_reviewed', 'checks_missing'], 'the owner typed it, so it counts as checked; the gate still has to be passed');
  assert.deepEqual((await h.overview()).unanswered, []);
  await h.say('shipping?', VID2);
  assert.doesNotMatch(model.calls.at(-1).system, /ship to the EU/, 'the live assistant does not know it yet');

  const pub = await h.publish('answer from the inbox');
  assert.deepEqual([pub.status, (await pub.json()).version], [200, 2]);
  await h.say('shipping?', VID2);
  assert.match(model.calls.at(-1).system, /We ship to the EU in 5 days\. \(source: owner answer\)/, 'the next turn already knows it');
});

test('an unanswered question can be dismissed, and an answer is cut at 300 characters', async () => {
  const h = await boot();
  const put = (n) => h.svc.store.putDoc('unanswered', `u_${n.repeat(16)}`, { id: `u_${n.repeat(16)}`, ts: n === 'a' ? 1 : 2, convId: `c_${HEX24}`, question: `question ${n}`, status: 'open' });
  put('a'); put('b');
  const dismissed = await h.adminPost(`unanswered/u_${'a'.repeat(16)}`, { dismiss: true });
  assert.deepEqual([dismissed.status, await dismissed.json()], [200, { ok: true, status: 'dismissed' }]);
  assert.equal((await h.studio()).dirty, false, 'dismissing touches no draft');
  assert.deepEqual((await h.overview()).unanswered.map((u) => u.question), ['question b']);
  await h.adminPost(`unanswered/u_${'b'.repeat(16)}`, { answer: 'y'.repeat(400) });
  assert.equal((await h.studio()).draft.knowledge.at(-1).text.length, 300);
});

// ---------------------------------------------------------------------------------------------------------------- studio

test('studio status: version, blockers on a clean draft, the embed snippet once the public address is known', async () => {
  const h = await boot({ info: { mode: 'dry-run', publicUrl: 'https://desk.example', channels: () => ({ site: { connected: true } }) } });
  const st = await h.studio();
  assert.deepEqual([st.published.n, st.dirty, st.diff, st.checks, st.reviewed, codes(st.blockers)], [1, false, [], null, false, ['no_changes', 'not_reviewed', 'checks_missing']]);
  assert.deepEqual(st.versions.map((v) => [v.n, v.by, v.summary]), [[1, 'operator', 'first version']]);
  assert.equal(st.publicUrl, 'https://desk.example');
  assert.equal(st.embed, '<script src="https://desk.example/widget.js" data-shop="test-shop" async></script>');
  const status = await (await h.admin('status')).json();
  assert.deepEqual([status.mode, status.channels, status.version], ['dry-run', { site: { connected: true } }, 1]);
  const plain = await boot();
  assert.deepEqual([(await plain.studio()).publicUrl, (await plain.studio()).embed], [null, null]);
});

test('scope: a chat with Kaby cannot touch money, doors, `auto` or "checked"; the owner can, up to the hard ceilings', async () => {
  const h = await boot();
  const ownerOnly = [
    [{ op: 'set', path: 'guardrails.budget.dailyCap', value: 1.5 }],
    [{ op: 'set', path: 'guardrails.budget.visitorDailyCap', value: 0.1 }],
    [{ op: 'set', path: 'guardrails.limits.perIpPerMin', value: 50 }],
    [{ op: 'set', path: 'guardrails.allowedOrigins', value: ['https://shop.example'] }],
    [{ op: 'set', path: 'guardrails.enabled', value: false }],
    [{ op: 'set', path: 'guardrails.retentionMonths', value: 3 }],
    [{ op: 'set', path: 'guardrails.actions.request_callback', value: 'auto' }],
    [{ op: 'add_fact', text: 'Parking is free.', validated: true }],
    [{ op: 'set_fact', index: 0, validated: true }],
  ];
  for (const o of ownerOnly) {
    for (const scope of [undefined, 'kaby', 'admin', 'OWNER', true, null]) {
      const r = await h.ops(o, scope);
      assert.deepEqual([r.status, (await r.json()).error], [409, 'owner_only'], `${JSON.stringify(o)} as ${JSON.stringify(scope)}`);
    }
  }
  assert.equal((await h.studio()).dirty, false, 'refused operations changed nothing');

  // What Kaby may do.
  const kaby = await h.ops([{ op: 'set', path: 'tone', value: 'Calm.' }, { op: 'set', path: 'brand.color', value: '#aa3366' }, { op: 'add_fact', text: 'Parking is free.' }, { op: 'set', path: 'guardrails.actions.request_callback', value: 'approve' }]);
  assert.equal(kaby.status, 200);
  assert.equal((await h.studio()).dirty, true);
  await h.adminPost('studio/discard', {});

  // What the owner may do, one by one.
  for (const o of ownerOnly) assert.equal((await h.ops(o, 'owner')).status, 200, JSON.stringify(o));
  const st = await h.studio();
  assert.equal(st.draft.guardrails.budget.dailyCap, 1.5);
  assert.equal(st.draft.guardrails.actions.request_callback, 'auto');
  assert.deepEqual(st.draft.guardrails.allowedOrigins, ['https://shop.example']);
  assert.equal(st.draft.knowledge[0].validated, true);
  await h.adminPost('studio/discard', {});

  // The hard ceilings hold for the owner too, and the draft stays as it was.
  for (const o of [
    { op: 'set', path: 'guardrails.budget.dailyCap', value: 500 },
    { op: 'set', path: 'guardrails.budget.visitorDailyCap', value: 5 },
    { op: 'set', path: 'guardrails.limits.maxInputChars', value: 5000 },
    { op: 'set', path: 'guardrails.limits.perIpPerMin', value: 1000 },
    { op: 'set', path: 'guardrails.limits.maxToolSteps', value: 9 },
  ]) {
    const r = await h.ops([o], 'owner');
    const body = await r.json();
    assert.deepEqual([r.status, body.error, body.warnings.length], [409, 'above_ceiling', 1], o.path);
  }
  assert.equal((await h.studio()).dirty, false);

  const unknown = await h.ops([{ op: 'set', path: 'guardrails.actions.delete_all', value: 'auto' }], 'owner');
  assert.deepEqual([unknown.status, (await unknown.json()).error], [409, 'unknown_action']);
  assert.equal((await (await h.ops([{ op: 'set', path: 'slug', value: 'other-shop' }], 'owner')).json()).error, 'path_not_allowed');
  assert.equal((await (await h.ops([], 'owner')).json()).error, 'bad_ops');
  assert.equal((await h.admin('studio/ops', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' })).status, 415);
});

test('publishing is refused until the facts are checked, the sheet read and the checks passed on THIS exact draft; any edit after that asks again', async () => {
  let verdict = true;
  const h = await boot({ runChecks: async () => [{ name: 'stub', ok: verdict, failures: verdict ? [] : ['nope'] }] });
  const publish = async () => { const r = await h.adminPost('studio/publish', { summary: 'try' }); return [r.status, await r.json()]; };

  let [status, body] = await publish();
  assert.deepEqual([status, body.error, codes(body.blockers)], [409, 'blocked', ['no_changes', 'not_reviewed', 'checks_missing']]);
  await h.ops([{ op: 'add_fact', text: 'Parking is free.', source: 'site' }, { op: 'set', path: 'tone', value: 'Warm.' }]);
  [status, body] = await publish();
  assert.deepEqual(codes(body.blockers), ['unvalidated_facts', 'not_reviewed', 'checks_missing']);
  assert.equal(body.blockers[0].count, 1);

  assert.equal((await h.adminPost('studio/review', {})).status, 200);
  const checked = await (await h.adminPost('studio/checks', {})).json();
  assert.deepEqual([checked.ok, checked.results.length], [true, 1]);
  [status, body] = await publish();
  assert.deepEqual(codes(body.blockers), ['unvalidated_facts'], 'read and checked, but a fact is still not validated');

  await h.ops([{ op: 'set_fact', index: 1, validated: true }], 'owner');
  let st = await h.studio();
  assert.deepEqual([st.reviewed, st.checks, codes(st.blockers)], [true, null, ['checks_missing']], 'the sheet is still read, but the checks are stale for the edited draft');
  await h.adminPost('studio/checks', {});
  assert.deepEqual((await h.studio()).blockers, []);

  await h.ops([{ op: 'set', path: 'guardrails.actions.request_callback', value: 'approve' }]);
  st = await h.studio();
  assert.deepEqual([st.reviewed, codes(st.blockers)], [false, ['not_reviewed', 'checks_missing']], 'changing what it can do asks for a new reading');

  await h.adminPost('studio/review', {});
  verdict = false;
  const failed = await (await h.adminPost('studio/checks', {})).json();
  assert.deepEqual([failed.ok, failed.results[0].failures], [false, ['nope']]);
  st = await h.studio();
  assert.deepEqual([st.checks.ok, codes(st.blockers)], [false, ['checks_failed']]);
  [status, body] = await publish();
  assert.deepEqual([status, codes(body.blockers)], [409, ['checks_failed']]);
  assert.equal((await h.studio()).published.n, 1, 'nothing was published');
});

test('publish replaces the live fiche with no restart: the tone, the budget, the allowed sites and the public config follow at once', async () => {
  const model = scriptedModel(() => ({ text: 'Hello.' }));
  const h = await boot({ model });
  await h.say('hi');
  assert.doesNotMatch(model.calls.at(-1).system, /Tone: Calm/);
  assert.match(cspOf(await h.get('/c/test-shop')), /frame-ancestors 'none'/);
  assert.equal((await h.overview()).budget.capMicro, 2_000_000);

  const edit = await h.ops([
    { op: 'set', path: 'tone', value: 'Calm and brief.' }, { op: 'set', path: 'brand.color', value: '#aa3366' }, { op: 'set', path: 'guardrails.budget.dailyCap', value: 1 },
    { op: 'set', path: 'guardrails.allowedOrigins', value: ['https://shop.example', 'javascript:alert(1)'] },
  ], 'owner');
  assert.equal(edit.status, 200);
  assert.equal(h.svc.fiche.tone, '', 'a draft is not live');
  const pub = await h.publish('calm tone');
  assert.deepEqual([pub.status, await pub.json()], [200, { ok: true, version: 2 }]);

  await h.say('hi again');
  assert.match(model.calls.at(-1).system, /Tone: Calm and brief\./);
  assert.match(cspOf(await h.get('/c/test-shop')), /frame-ancestors https:\/\/shop\.example$/, 'only the valid site was kept');
  assert.equal((await h.overview()).budget.capMicro, 1_000_000);
  const config = await (await h.get('/c/test-shop/config', { headers: { origin: 'https://shop.example' } })).json();
  assert.equal(config.color, '#aa3366');
  const st = await h.studio();
  assert.deepEqual([st.published.n, st.dirty, st.published.summary, st.blockers.map((b) => b.code)], [2, false, 'calm tone', ['no_changes', 'not_reviewed', 'checks_missing']]);
  assert.deepEqual(st.journal.slice(0, 1).map((j) => j.kind), ['publish']);
});

test('discard drops the draft, and a rollback republishes an old version as a new one', async () => {
  const model = scriptedModel(() => ({ text: 'Hello.' }));
  const h = await boot({ model });
  const discard = async () => (await h.adminPost('studio/discard', {})).json();
  assert.deepEqual(await discard(), { ok: true, unchanged: true }, 'nothing to discard');
  await h.ops([{ op: 'set', path: 'tone', value: 'Calm.' }]);
  assert.equal((await h.studio()).dirty, true);
  assert.deepEqual(await discard(), { ok: true });
  assert.equal((await h.studio()).dirty, false);

  await h.ops([{ op: 'set', path: 'tone', value: 'Calm.' }]);
  assert.equal((await h.publish('calm')).status, 200);
  await h.say('hi');
  assert.match(model.calls.at(-1).system, /Tone: Calm\./);

  const rb = (version) => h.adminPost('studio/rollback', { version });
  const live = await rb(2);
  assert.deepEqual([live.status, (await live.json()).error], [409, 'already_live']);
  for (const version of [99, '1', 1.5, null, undefined]) assert.equal((await rb(version)).status, 404, JSON.stringify(version));
  const back = await rb(1);
  assert.deepEqual([back.status, await back.json()], [200, { ok: true, version: 3, restored: 1 }]);
  await h.say('hi again');
  assert.doesNotMatch(model.calls.at(-1).system, /Tone: Calm\./, 'the old version is live again, without a restart');
  const st = await h.studio();
  assert.deepEqual(st.versions.map((v) => [v.n, v.summary]), [[3, 'restored version 1'], [2, 'calm'], [1, 'first version']]);
  assert.deepEqual(st.journal[0].kind, 'rollback');
});

// ---------------------------------------------------------------------------------------------------------------- preview

test('the preview talks to the DRAFT, in memory: the live conversations, ledger and model are never touched', async () => {
  const live = scriptedModel(() => ({ text: 'LIVE' }));
  const preview = scriptedModel(() => ({ text: 'Preview answer.' }));
  const h = await boot({ model: live, previewModel: preview });
  const say = (text, visitorId = VID) => h.adminPost('preview/messages', { visitorId, text });
  assert.equal((await h.post('/api/preview/messages', { visitorId: VID, text: 'hi' })).status, 401);
  assert.equal((await say('hi', 'short')).status, 400);
  assert.equal((await h.adminPost('preview/messages', { text: 'hi' })).status, 400);

  await h.ops([{ op: 'set', path: 'tone', value: 'Brief and formal.' }]);
  const r = await say('hello');
  assert.deepEqual([r.status, (await r.json()).reply], [200, 'Preview answer.']);
  assert.match(preview.calls[0].system, /Tone: Brief and formal\./, 'the preview reads the draft');
  assert.deepEqual([live.calls.length, h.svc.store.listDocs('conversations').length, h.svc.store.listDocs('ledger').length, h.svc.store.readLog('events').length], [0, 0, 0, 0], 'nothing live moved');
  assert.deepEqual([h.svc.governor.snapshot().spentMicro, (await h.overview()).conversations], [0, []]);

  await h.say('a real visitor');
  assert.doesNotMatch(live.calls[0].system, /Brief and formal/, 'the real visitor still gets the live fiche');
  assert.equal(preview.calls.length, 1);

  const before = h.svc.studio.preview();
  assert.deepEqual(await (await h.adminPost('preview/reset', {})).json(), { ok: true });
  assert.notEqual(h.svc.studio.preview(), before, 'a reset starts a fresh preview');
});

test('preview consent and its cap: its own small ledger, which runs out well before the shop\'s', async () => {
  const preview = scriptedModel(({ messages }) => (stepOf(messages) === 0 && /my name/.test(messages.at(-1).content)
    ? { toolCalls: [{ name: 'note_visitor', args: { field: 'first_name', value: 'Ann' } }] }
    : { text: 'Preview answer.', usage: { inputTokens: 30_000, outputTokens: 1000 } }));
  const guardrails = { ...GR, budget: { dailyCap: 2, visitorDailyCap: 2 }, limits: { ...GR.limits, maxOutputTokens: 1000, maxToolSteps: 5 } };
  const h = await boot({ guardrails, previewModel: preview });
  const say = async (text, visitorId) => { const r = await h.adminPost('preview/messages', { visitorId, text }); return [r.status, await r.json()]; };

  const [, ask] = await say('my name is Ann', VID);
  assert.equal(ask.pendingConsents.length, 1);
  const noteId = ask.pendingConsents[0].noteId;
  const yes = await h.adminPost('preview/consent', { visitorId: VID, noteId, accept: true });
  assert.deepEqual([yes.status, (await yes.json()).ok], [200, true]);
  assert.deepEqual([h.svc.store.listDocs('visitors').length, h.svc.store.listDocs('pending_notes').length], [0, 0], 'nothing remembered in the live store');
  assert.equal((await h.post('/c/test-shop/consent', { visitorId: VID, noteId, accept: true })).status, 404, 'the live page does not know that note');
  assert.equal((await h.adminPost('preview/consent', { visitorId: VID, noteId: 'nope', accept: true })).status, 400);

  const cap = h.svc.studio.preview().governor.snapshot().capMicro;
  assert.equal(cap, 500_000, 'the preview cap is 0.5, whatever the shop cap is');
  assert.ok(cap < h.svc.governor.snapshot().capMicro);
  let refused = null;
  let served = 0;
  for (let i = 0; i < 60 && !refused; i += 1) {
    const [status, body] = await say('question', `previewer${String(i).padStart(8, '0')}`);
    if (status === 200) served += 1; else refused = { status, body };
  }
  assert.ok(refused, 'the preview ran out of its own money');
  assert.deepEqual([refused.status, refused.body.error], [429, 'day_cap']);
  assert.ok(served >= 5 && served < 40, `${served} turns served before the preview cap`);
  const snap = h.svc.studio.preview().governor.snapshot();
  assert.ok(snap.spentMicro <= cap && snap.spentMicro > cap / 2, `spent ${snap.spentMicro} of ${cap}`);
  assert.equal(h.svc.governor.snapshot().spentMicro, 0, 'the shop\'s own ledger is untouched');
  assert.equal((await h.say('a real visitor', VID2)).status, 200, 'and the real chat still works');
});
