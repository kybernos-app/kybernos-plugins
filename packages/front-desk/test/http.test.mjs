import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { makeSvc } from './helpers.mjs';
import { createHttpServer } from '../server/http.mjs';
import { stepOf } from '../core/scripted.mjs';

const VID = 'a1b2c3d4e5f60718a1b2c3d4e5f60718';
const TOKEN = 'owner-token-for-tests';

async function boot({ guardrails = {}, handler, ownerToken = TOKEN } = {}) {
  const svc = makeSvc({ guardrails, handler });
  const server = createHttpServer({ service: svc, ownerToken });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const close = () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); });
  opened.push(close);
  return { svc, base, post, close };
}
const opened = [];
after(async () => { for (const close of opened) await close(); });
const admin = (h) => ({ authorization: `Bearer ${TOKEN}`, ...h });

test('the chat page carries a CSP nonce, no external request, and the shop name escaped', async () => {
  const h = await boot();
  const res = await fetch(`${h.base}/`);
  const html = await res.text();
  const csp = res.headers.get('content-security-policy');
  const nonce = /nonce-([A-Za-z0-9+/=]+)/.exec(csp)[1];
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(html.split(`nonce="${nonce}"`).length - 1, 2, 'one style and one script, both with the nonce');
  assert.doesNotMatch(html, /https?:\/\/(?!x)/);
  assert.doesNotMatch(html, / style="/, 'the CSP blocks inline style attributes: use classes');
  const boite = await (await fetch(`${h.base}/boite`, { headers: {} })).text();
  assert.doesNotMatch(boite, / style="/, 'same for the Boîte');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await fetch(`${h.base}/c/test-shop`)).status, 200);
  assert.equal((await fetch(`${h.base}/c/other-shop`)).status, 404);
  await h.close();
});

test('a visitor message gets a reply; bad input gets a clean refusal and nothing leaks', async () => {
  const h = await boot({ handler: () => ({ text: 'Hello from the shop.' }) });
  const ok = await h.post('/c/test-shop/messages', { visitorId: VID, text: 'hi' });
  assert.deepEqual([ok.status, (await ok.json()).reply], [200, 'Hello from the shop.']);
  assert.equal((await h.post('/c/test-shop/messages', { visitorId: 'short', text: 'hi' })).status, 400);
  assert.equal((await h.post('/c/test-shop/messages', { visitorId: VID, text: '' })).status, 400);
  assert.equal((await h.post('/c/test-shop/messages', { visitorId: VID, text: 'x'.repeat(5000) })).status, 400);
  const big = await fetch(`${h.base}/c/test-shop/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ visitorId: VID, text: 'x'.repeat(40_000) }) });
  assert.equal(big.status, 413);
  const wrong = await fetch(`${h.base}/c/test-shop/messages`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'hi' });
  assert.equal(wrong.status, 415);
  const bad = await fetch(`${h.base}/c/test-shop/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' });
  const badBody = await bad.text();
  assert.equal(bad.status, 400);
  assert.doesNotMatch(badBody, /at |\.mjs|stack/);
  await h.close();
});

test('another site cannot use a visitor\'s browser; a listed origin can', async () => {
  const h = await boot({ guardrails: { allowedOrigins: ['https://shop.example'] } });
  const evil = await h.post('/c/test-shop/messages', { visitorId: VID, text: 'hi' }, { origin: 'https://evil.example' });
  assert.equal(evil.status, 403);
  const good = await h.post('/c/test-shop/messages', { visitorId: VID, text: 'hi' }, { origin: 'https://shop.example' });
  assert.equal(good.status, 200);
  assert.equal(good.headers.get('access-control-allow-origin'), 'https://shop.example');
  const pre = await fetch(`${h.base}/c/test-shop/messages`, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
  assert.equal(pre.headers.get('access-control-allow-origin'), null);
  assert.match((await fetch(`${h.base}/`)).headers.get('content-security-policy'), /frame-ancestors https:\/\/shop\.example/);
  await h.close();
});

test('consent, my data and erasure work end to end, keyed to the visitor\'s own id', async () => {
  const h = await boot({
    guardrails: { actions: { note_visitor: 'auto' } },
    handler: ({ messages }) => (stepOf(messages) === 0 ? { toolCalls: [{ name: 'note_visitor', args: { field: 'first_name', value: 'Ann' } }] } : { text: 'Nice to meet you.' }),
  });
  const r = await (await h.post('/c/test-shop/messages', { visitorId: VID, text: 'I am Ann' })).json();
  const noteId = r.pendingConsents[0].noteId;
  assert.deepEqual((await (await fetch(`${h.base}/c/test-shop/me`, { headers: { 'x-visitor-id': VID } })).json()).fields, {});
  const other = await h.post('/c/test-shop/consent', { visitorId: 'f'.repeat(32), noteId, accept: true });
  assert.equal(other.status, 404);
  const yes = await (await h.post('/c/test-shop/consent', { visitorId: VID, noteId, accept: true })).json();
  assert.equal(yes.ok, true);
  assert.deepEqual((await (await fetch(`${h.base}/c/test-shop/me`, { headers: { 'x-visitor-id': VID } })).json()).fields, { first_name: 'Ann' });
  assert.equal((await fetch(`${h.base}/c/test-shop/me`, { method: 'DELETE', headers: { 'x-visitor-id': VID } })).status, 200);
  assert.deepEqual((await (await fetch(`${h.base}/c/test-shop/me`, { headers: { 'x-visitor-id': VID } })).json()).fields, {});
  assert.equal(h.svc.store.listDocs('conversations').length, 0, 'the conversation is erased too');
  assert.equal((await fetch(`${h.base}/c/test-shop/me`, { headers: { 'x-visitor-id': 'bad' } })).status, 400);
  await h.close();
});

test('the owner API: closed without a token, 401 with a wrong one, throttled after ten tries', async () => {
  const none = await boot({ ownerToken: null });
  assert.equal((await fetch(`${none.base}/v1/admin/overview`)).status, 404);
  assert.equal((await fetch(`${none.base}/boite`)).status, 404);
  await none.close();
  const h = await boot();
  assert.equal((await fetch(`${h.base}/v1/admin/overview`)).status, 401);
  assert.equal((await fetch(`${h.base}/v1/admin/overview`, { headers: { authorization: 'Bearer nope' } })).status, 401);
  for (let i = 0; i < 12; i += 1) await fetch(`${h.base}/v1/admin/overview`, { headers: { authorization: 'Bearer nope' } });
  assert.equal((await fetch(`${h.base}/v1/admin/overview`, { headers: admin() })).status, 429, 'even the right token waits after a burst of failures');
  await h.close();
});

test('the Boîte: overview, a conversation with its contact card, approvals, kill switch, scenarios', async () => {
  const h = await boot({
    guardrails: { actions: { leave_message: 'approve', note_visitor: 'auto' } },
    handler: ({ messages }) => (stepOf(messages) === 0 ? { toolCalls: [{ name: 'leave_message', args: { message: 'Please call me' } }] } : { text: 'Passed on.' }),
  });
  const r = await (await h.post('/c/test-shop/messages', { visitorId: VID, text: 'Call me' })).json();
  assert.equal(r.ok, true);
  const o = await (await fetch(`${h.base}/v1/admin/overview`, { headers: admin() })).json();
  assert.equal(o.shop.slug, 'test-shop');
  assert.equal(o.conversations.length, 1);
  assert.equal(o.approvals.length, 1);
  assert.equal(o.messages.length, 0);
  const d = await (await fetch(`${h.base}/v1/admin/conversations/${o.conversations[0].id}`, { headers: admin() })).json();
  assert.equal(d.card.level, 1);
  assert.deepEqual(d.log.map((e) => e.role || e.type), ['user', 'event', 'assistant']);
  const dec = await h.post(`/v1/admin/approvals/${o.approvals[0].id}`, { decision: 'approve' }, admin());
  assert.equal(dec.status, 200);
  assert.equal((await (await fetch(`${h.base}/v1/admin/overview`, { headers: admin() })).json()).messages.length, 1);
  assert.equal((await h.post(`/v1/admin/approvals/${o.approvals[0].id}`, { decision: 'approve' }, admin())).status, 409);
  assert.equal((await (await h.post('/v1/admin/kill', { on: true }, admin())).json()).killed, true);
  const closed = await h.post('/c/test-shop/messages', { visitorId: VID, text: 'anyone?' });
  assert.equal((await closed.json()).error, 'killed');
  assert.equal((await (await h.post('/v1/admin/kill', { on: false }, admin())).json()).killed, false);
  const sc = await (await h.post('/v1/admin/scenarios', {}, admin())).json();
  assert.equal(sc.results.length, 5);
  assert.ok(sc.results.every((x) => x.ok));
  assert.match(await (await fetch(`${h.base}/boite`)).text(), /<title>Test Shop/);
  const del = await fetch(`${h.base}/v1/admin/conversations/${o.conversations[0].id}`, { method: 'DELETE', headers: admin() });
  assert.equal(del.status, 200);
  await h.close();
});
