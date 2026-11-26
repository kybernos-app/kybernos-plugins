// End to end: the real command (`bin/front-desk.mjs`) as a child process, talking over real HTTP to a fake OpenAI-compatible
// model server, with a real data folder and real restarts. Everything except an actual language model.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/front-desk.mjs', import.meta.url));
const KEY = 'sk-e2e-secret-key-456';
const TOKEN = 'e2e-owner-token';
const VID = 'e2e0123456789abcdef0123456789abc';
const cleanups = [];
after(async () => { for (const c of cleanups.reverse()) await c(); });

const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

/** A fake OpenAI-compatible endpoint: a question gets text, "message for the shop" gets a tool call first, "boom" gets a 500. */
async function fakeModel() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = JSON.parse(raw);
      requests.push({ url: req.url, auth: req.headers.authorization, body });
      const last = body.messages.at(-1);
      const reply = (message) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message }], usage: { prompt_tokens: 300, completion_tokens: 30 } })); };
      if (/boom/.test(String(last.content))) { res.writeHead(500); res.end('{"error":"upstream"}'); return; }
      if (last.role === 'tool') { reply({ role: 'assistant', content: 'Passed on to the shop.' }); return; }
      if (/message for the shop/.test(String(last.content))) {
        reply({ role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'leave_message', arguments: JSON.stringify({ message: 'Please call me back' }) } }] });
        return;
      }
      reply({ role: 'assistant', content: 'We are open every day.' });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  cleanups.push(() => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }));
  return { requests, url: `http://127.0.0.1:${server.address().port}/v1` };
}

/** Starts the real command; resolves once it has printed its ready line. `stop()` sends SIGTERM and gives the exit code. */
async function startService({ model, dir, fiche }) {
  const port = await freePort();
  const child = spawn(process.execPath, [BIN, '--fiche', fiche, '--data', dir, '--port', String(port), '--host', '127.0.0.1'], {
    env: { PATH: process.env.PATH, MODEL_BASE_URL: model.url, MODEL_API_KEY: KEY, MODEL_NAME: 'fake-model', FRONT_DESK_OWNER_TOKEN: TOKEN },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (c) => { output += c; });
  child.stderr.on('data', (c) => { output += c; });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`service did not start: ${output}`)), 8000);
    const poll = setInterval(() => { if (/front-desk: ".*" on http/.test(output)) { clearTimeout(t); clearInterval(poll); resolve(); } }, 20);
    child.once('exit', (code) => { clearTimeout(t); clearInterval(poll); reject(new Error(`exited ${code}: ${output}`)); });
  });
  const base = `http://127.0.0.1:${port}`;
  const exited = new Promise((r) => child.once('exit', (code) => r(code)));
  const stop = async () => { if (child.exitCode === null) child.kill('SIGTERM'); return exited; };
  cleanups.push(stop);
  const post = (p, body, headers = {}) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const admin = (p, opts = {}) => fetch(`${base}/v1/admin/${p}`, { ...opts, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...(opts.headers || {}) } });
  return { base, post, admin, stop, output: () => output };
}

test('the real command, a model over HTTP, a data folder and two restarts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-e2e-'));
  const fiche = path.join(dir, 'fiche.json');
  fs.writeFileSync(fiche, JSON.stringify({
    slug: 'e2e-shop', name: 'E2E Shop', language: 'en',
    knowledge: [{ text: 'Open every day.', source: 'owner', validated: true }, { text: 'A secret unvalidated claim.', validated: false }],
    guardrails: { actions: { leave_message: 'auto' }, limits: { perIpPerMin: 100, perVisitorPerMin: 50, perShopPerMin: 500 } },
  }));
  const model = await fakeModel();
  const data = path.join(dir, 'data');

  let svc = await startService({ model, dir: data, fiche });
  assert.equal((await fetch(`${svc.base}/c/e2e-shop`)).status, 200);

  // 1. a question reaches the model with the key, the right fields and only what it should see
  const q = await (await svc.post('/c/e2e-shop/messages', { visitorId: VID, text: 'When are you open?' })).json();
  assert.deepEqual([q.ok, q.reply], [true, 'We are open every day.']);
  const first = model.requests[0];
  assert.equal(first.url, '/v1/chat/completions');
  assert.equal(first.auth, `Bearer ${KEY}`);
  assert.equal(first.body.model, 'fake-model');
  assert.ok(first.body.max_tokens <= 400);
  assert.equal(first.body.messages[0].role, 'system');
  assert.match(first.body.messages[0].content, /Open every day/);
  assert.doesNotMatch(first.body.messages[0].content, /secret unvalidated|dailyCap|guardrails/i);
  assert.equal(first.body.messages.at(-1).content, '<visitor>When are you open?</visitor>');
  assert.deepEqual(first.body.tools.map((t) => t.function.name).sort(), ['forget_visitor', 'leave_message', 'note_visitor', 'report_unanswered']);

  // 2. a tool call goes through the closed menu and lands in the data folder
  const m = await (await svc.post('/c/e2e-shop/messages', { visitorId: VID, text: 'I have a message for the shop' })).json();
  assert.equal(m.reply, 'Passed on to the shop.');
  const overview1 = await (await svc.admin('overview')).json();
  assert.equal(overview1.messages.length, 1);
  assert.equal(overview1.messages[0].message, 'Please call me back');
  assert.equal(overview1.conversations.length, 1);
  const spent = overview1.budget.spentMicro;
  assert.ok(spent > 0);

  // 3. a failing model gives a safe error, costs nothing and frees its slot
  const bad = await svc.post('/c/e2e-shop/messages', { visitorId: VID, text: 'boom' });
  assert.equal(bad.status, 502);
  const badBody = await bad.json();
  assert.doesNotMatch(JSON.stringify(badBody), /upstream|HTTP 500|sk-/);
  const overview2 = await (await svc.admin('overview')).json();
  assert.equal(overview2.budget.spentMicro, spent);
  assert.equal(overview2.budget.inflight, 0);

  // 4. the key is nowhere: not in a reply, not in the console, not in a file of the data folder
  assert.ok(!svc.output().includes(KEY));
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else files.push(p); } };
  walk(data);
  for (const f of files) assert.ok(!fs.readFileSync(f, 'utf8').includes(KEY), f);
  for (const f of files) assert.equal(fs.statSync(f).mode & 0o077, 0, `${f} is private to its owner`);

  // 5. a clean stop, then a restart on the same folder: conversations and the ledger are still there
  assert.equal(await svc.stop(), 0, 'SIGTERM ends the process normally');
  svc = await startService({ model, dir: data, fiche });
  const overview3 = await (await svc.admin('overview')).json();
  assert.equal(overview3.conversations.length, 1);
  assert.equal(overview3.messages.length, 1);
  assert.equal(overview3.budget.spentMicro, spent);
  const again = await (await svc.post('/c/e2e-shop/messages', { visitorId: VID, text: 'Still there?' })).json();
  assert.equal(again.ok, true);
  const history = model.requests.at(-1).body.messages.filter((x) => x.role === 'user' || x.role === 'assistant');
  assert.ok(history.length >= 5, 'the model gets the earlier turns after the restart');

  // 6. the kill switch survives a restart, and lifting it works
  assert.equal((await (await svc.admin('kill', { method: 'POST', body: JSON.stringify({ on: true }) })).json()).killed, true);
  assert.equal((await svc.post('/c/e2e-shop/messages', { visitorId: VID, text: 'anyone?' })).status, 429);
  await svc.stop();
  svc = await startService({ model, dir: data, fiche });
  const stillClosed = await svc.post('/c/e2e-shop/messages', { visitorId: VID, text: 'anyone?' });
  assert.equal((await stillClosed.json()).error, 'killed');
  assert.equal((await (await svc.admin('kill', { method: 'POST', body: JSON.stringify({ on: false }) })).json()).killed, false);
  assert.equal((await svc.post('/c/e2e-shop/messages', { visitorId: VID, text: 'open again?' })).status, 200);

  // 7. erasing the visitor from their own page removes the conversation and the message left, on disk
  assert.equal((await fetch(`${svc.base}/c/e2e-shop/me`, { method: 'DELETE', headers: { 'x-visitor-id': VID } })).status, 200);
  const overview4 = await (await svc.admin('overview')).json();
  assert.deepEqual([overview4.conversations.length, overview4.messages.length], [0, 0]);
  assert.equal(await svc.stop(), 0);
});

test('the command refuses to start without a model, and says so without printing a key', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-e2e-'));
  const fiche = path.join(dir, 'fiche.json');
  fs.writeFileSync(fiche, JSON.stringify({ slug: 'e2e-shop', name: 'E2E Shop' }));
  const out = await new Promise((resolve) => {
    const c = spawn(process.execPath, [BIN, '--fiche', fiche, '--data', path.join(dir, 'd')], { env: { PATH: process.env.PATH, MODEL_API_KEY: KEY }, stdio: ['ignore', 'pipe', 'pipe'] });
    let o = '';
    c.stdout.on('data', (x) => { o += x; });
    c.stderr.on('data', (x) => { o += x; });
    c.on('exit', (code) => resolve({ code, o }));
  });
  assert.equal(out.code, 2);
  assert.match(out.o, /MODEL_BASE_URL/);
  assert.ok(!out.o.includes(KEY));
});
