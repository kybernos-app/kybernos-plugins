// The HTTP face of the public service, on node:http with no dependency.
//
//   GET  /c/:slug                  the chat page (also GET / : the service serves one shop); ?embed=1 inside the shop's own site
//   GET  /c/:slug/config           what the site script needs to draw the button (name, colour, labels): public, no secret
//   POST /c/:slug/messages         { visitorId, text, lang? }  -> { ok, reply, pendingConsents, human?, at }
//   GET  /c/:slug/messages         ?visitorId&after=<ms>       -> the assistant's and the owner's words since `after`, and the mode
//   POST /c/:slug/consent          { visitorId, noteId, accept }
//   GET|DELETE /c/:slug/me         the visitor's own data / erase it   (header x-visitor-id)
//   GET  /widget.js                the script a shop pastes into its site
//   GET  /boite  /atelier  /preview   the owner's pages (static shells; their data needs the token) and the draft's chat
//   /v1/admin/*  and  /api/*       the owner's API, Bearer FRONT_DESK_OWNER_TOKEN (no token configured = no admin at all).
//                                  The pages call the relative `api/…`, so they work both here and behind a host that adds the token.
//
// Rules kept here: body size cap, JSON only, an Origin that is neither this host nor allow-listed is refused, a CSP nonce on every
// page, replies as text (pages render with textContent), no stack trace ever leaves, the visitor's IP is the socket's (a proxy
// header is read only when `trustProxy` is set).

import http from 'node:http';
import crypto from 'node:crypto';
import { chatPage } from './pages.mjs';
import { boitePage, atelierPage } from './owner-pages.mjs';
import { widgetScript, embedSnippet } from './widget.mjs';
import { runScenarios } from '../core/scenarios.mjs';
import { t } from '../core/text.mjs';

const MAX_BODY = 16 * 1024;
const VISITOR_ID = /^[a-z0-9]{16,64}$/;
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const fieldsOf = (rec) => (rec ? Object.fromEntries(Object.entries(rec.fields).map(([k, v]) => [k, v.value])) : {});
const POLLS_PER_MIN = 60;

export function createHttpServer({ service, ownerToken = null, trustProxy = false, now = Date.now, info = {} }) {
  const { fiche, store, governor, actions, runner, inbox, studio, calendar } = service;
  const failedAuth = new Map();
  const polls = new Map();

  const ipOf = (req) => {
    if (trustProxy) { const f = req.headers['x-forwarded-for']; if (typeof f === 'string' && f) return f.split(',').pop().trim().slice(0, 64); }
    return req.socket.remoteAddress || 'unknown';
  };

  function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', ...extra });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  }
  const json = (res, status, body, extra) => send(res, status, body, undefined, extra);
  const answer = (res, r, notFound = 'not_found') => json(res, r.ok ? 200 : (r.error === notFound ? 404 : 409), r);

  function readJson(req) {
    return new Promise((resolve, reject) => {
      if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) { reject(Object.assign(new Error('type'), { code: 415 })); return; }
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) {
          // Answer 413, then drop the connection: what is still arriving is discarded, never buffered.
          reject(Object.assign(new Error('big'), { code: 413 }));
          req.removeAllListeners('data');
          req.resume();
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(Object.assign(new Error('json'), { code: 400 })); }
      });
      req.on('error', () => reject(Object.assign(new Error('read'), { code: 400 })));
    });
  }

  /** Same host, or listed by the owner: anything else is another site trying to use this visitor's browser. */
  function originAllowed(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    if (fiche.guardrails.allowedOrigins.includes(origin)) return true;
    return typeof req.headers.host === 'string' && (origin === `http://${req.headers.host}` || origin === `https://${req.headers.host}`);
  }
  const corsHeaders = (req) => {
    const o = req.headers.origin;
    return o && fiche.guardrails.allowedOrigins.includes(o) ? { 'access-control-allow-origin': o, vary: 'origin' } : {};
  };

  /** `ancestors`: who may frame the page. The visitor's chat answers to the sites the owner listed; the owner's pages only to themselves. */
  function page(res, build, { ancestors = null, frames = false } = {}) {
    const nonce = crypto.randomBytes(16).toString('base64');
    const who = ancestors || (fiche.guardrails.allowedOrigins.length ? fiche.guardrails.allowedOrigins.join(' ') : "'none'");
    send(res, 200, build(nonce), 'text/html; charset=utf-8', {
      'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:; ${frames ? "frame-src 'self'; " : ''}base-uri 'none'; form-action 'none'; frame-ancestors ${who}`,
    });
  }

  function isOwner(req, res) {
    if (!ownerToken) { json(res, 404, { error: 'not_found' }); return false; }
    const ip = ipOf(req);
    const recent = (failedAuth.get(ip) || []).filter((x) => now() - x < 60_000);
    if (recent.length >= 10) { json(res, 429, { error: 'slow_down' }); return false; }
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (m && crypto.timingSafeEqual(sha(m[1]), sha(ownerToken))) return true;
    recent.push(now());
    failedAuth.set(ip, recent);
    json(res, 401, { error: 'unauthorized' });
    return false;
  }

  const visitorCtx = (id) => ({ channel: 'site', senderKey: id });
  const visitorShape = (out) => ({ ok: out.ok, error: out.error, reply: out.reply, pendingConsents: out.pendingConsents || [], human: !!out.human, at: out.at });
  const statusOf = (out) => (out.ok ? 200 : (out.error === 'empty' || out.error === 'too_long' ? 400 : out.error === 'failed' ? 502 : 429));
  const pollAllowed = (ip) => {
    const t0 = now();
    const arr = (polls.get(ip) || []).filter((x) => t0 - x < 60_000);
    arr.push(t0);
    polls.set(ip, arr);
    if (polls.size > 5000) for (const [k, v] of polls) if (t0 - v[v.length - 1] >= 60_000) polls.delete(k);
    return arr.length <= POLLS_PER_MIN;
  };

  async function visitorApi(req, res, rest) {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...corsHeaders(req), 'access-control-allow-methods': 'GET, POST, DELETE', 'access-control-allow-headers': 'content-type, x-visitor-id', 'access-control-max-age': '600' });
      res.end();
      return;
    }
    if (!originAllowed(req)) { json(res, 403, { error: 'origin' }); return; }
    const cors = corsHeaders(req);
    if (rest === 'config' && req.method === 'GET') {
      // Read by the site script from another origin: public by design, and it holds nothing the page itself does not show.
      json(res, 200, { name: fiche.name, color: fiche.brand.color, greeting: fiche.brand.greeting, language: fiche.language, labels: { open: t(fiche.language, 'widget.open'), close: t(fiche.language, 'widget.close') } }, { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=60' });
      return;
    }
    if (rest === 'messages' && req.method === 'GET') {
      const q = new URL(req.url, 'http://x').searchParams;
      const id = q.get('visitorId');
      if (!id || !VISITOR_ID.test(id)) { json(res, 400, { error: 'bad_visitor' }, cors); return; }
      if (!pollAllowed(ipOf(req))) { json(res, 429, { error: 'slow_down' }, cors); return; }
      const after = Number(q.get('after'));
      json(res, 200, inbox.since(runner.convIdFor(visitorCtx(id)), Number.isFinite(after) ? after : 0), cors);
      return;
    }
    if (rest === 'messages' && req.method === 'POST') {
      const body = await readJson(req);
      if (!body || typeof body.visitorId !== 'string' || !VISITOR_ID.test(body.visitorId)) { json(res, 400, { error: 'bad_visitor' }, cors); return; }
      const lang = typeof body.lang === 'string' && /^(en|fr)$/.test(body.lang) ? body.lang : undefined;
      const out = await runner.handleMessage({ channel: 'site', senderKey: body.visitorId, visitorId: body.visitorId, ip: ipOf(req), text: body.text, lang });
      json(res, statusOf(out), visitorShape(out), cors);
      return;
    }
    if (rest === 'consent' && req.method === 'POST') {
      const body = await readJson(req);
      if (!body || typeof body.visitorId !== 'string' || !VISITOR_ID.test(body.visitorId) || typeof body.noteId !== 'string' || !/^n_[0-9a-f]{16}$/.test(body.noteId)) { json(res, 400, { error: 'bad_request' }, cors); return; }
      const r = actions.consent({ noteId: body.noteId, accept: body.accept === true, ctx: visitorCtx(body.visitorId) });
      json(res, r.ok ? 200 : 404, { ok: r.ok, reply: r.ok ? t(fiche.language, r.saved ? 'consent.saved' : 'consent.declined') : undefined, error: r.error }, cors);
      return;
    }
    if (rest === 'me' && (req.method === 'GET' || req.method === 'DELETE')) {
      const id = req.headers['x-visitor-id'];
      if (typeof id !== 'string' || !VISITOR_ID.test(id)) { json(res, 400, { error: 'bad_visitor' }, cors); return; }
      if (req.method === 'DELETE') { actions.eraseVisitor(visitorCtx(id)); json(res, 200, { ok: true, reply: t(fiche.language, 'forgotten') }, cors); return; }
      json(res, 200, { fields: fieldsOf(actions.visitorOf(visitorCtx(id))) }, cors);
      return;
    }
    json(res, 404, { error: 'not_found' }, cors);
  }

  const open = (col) => store.listDocs(col).map((x) => x.value);
  const recent = (col) => open(col).sort((a, b) => b.ts - a.ts).slice(0, 50);
  const convMeta = (c) => ({ id: c.id, channel: c.channel, level: c.level, preview: c.preview, lastAt: c.lastAt, mode: c.mode || 'agent', unread: c.unread || 0 });

  async function adminApi(req, res, rest) {
    if (!isOwner(req, res)) return;
    const method = req.method;
    if (rest === 'overview' && method === 'GET') {
      const convs = open('conversations').sort((a, b) => b.lastAt - a.lastAt).slice(0, 100).map(convMeta);
      const approvals = open('approvals').filter((a) => a.status === 'pending').map((a) => ({ id: a.id, name: a.name, params: a.params, convId: a.ctx.convId, createdAt: a.createdAt }));
      json(res, 200, {
        shop: { name: fiche.name, slug: fiche.slug }, budget: governor.snapshot(), conversations: convs, approvals,
        messages: recent('messages'), callbacks: recent('callbacks'), bookings: calendar.bookings ? calendar.bookings() : [],
        unanswered: open('unanswered').filter((u) => u.status === 'open').sort((a, b) => b.ts - a.ts).slice(0, 50),
        waiting: inbox.waiting(),
      });
      return;
    }
    if (rest === 'status' && method === 'GET') {
      json(res, 200, { shop: { name: fiche.name, slug: fiche.slug }, mode: info.mode || 'live', publicUrl: info.publicUrl || null, channels: info.channels ? info.channels() : {}, killed: governor.isKilled(), version: studio.status().published.n });
      return;
    }
    const conv = /^conversations\/(c_[0-9a-f]{24})(?:\/(reply|mode|read|export))?$/.exec(rest);
    if (conv) {
      const id = conv[1];
      const meta = store.getDoc('conversations', id);
      if (!meta) { json(res, 404, { error: 'not_found' }); return; }
      const sub = conv[2];
      const rec = actions.recordByKey(meta.key);
      const fields = rec ? Object.fromEntries(Object.entries(rec.fields).map(([k, v]) => [k, { value: v.value, consentAt: v.consentAt }])) : {};
      const mine = (col) => open(col).filter((x) => x.convId === id);
      if (!sub && method === 'GET') {
        json(res, 200, { meta: { ...convMeta(meta), createdAt: meta.createdAt }, log: store.readLog(`conv_${id.slice(2)}`, 200), card: { level: meta.level, channel: meta.channel, fields }, done: actions.doneFor(id), unanswered: mine('unanswered').filter((u) => u.status === 'open'), bookings: mine('bookings') });
        return;
      }
      if (!sub && method === 'DELETE') { json(res, 200, { ok: true, erased: actions.eraseKey(meta.key) }); return; }
      if (sub === 'export' && method === 'GET') {
        json(res, 200, { exportedAt: now(), meta: convMeta(meta), log: store.readLog(`conv_${id.slice(2)}`, 1000), remembered: fields, done: actions.doneFor(id), messages: mine('messages'), callbacks: mine('callbacks'), bookings: mine('bookings') }, { 'content-disposition': `attachment; filename="conversation-${id}.json"` });
        return;
      }
      if (sub === 'read' && method === 'POST') { answer(res, inbox.markRead(id)); return; }
      if (sub === 'mode' && method === 'POST') { const b = await readJson(req); answer(res, inbox.setMode(id, b && b.mode)); return; }
      if (sub === 'reply' && method === 'POST') { const b = await readJson(req); const r = await inbox.reply(id, b && b.text); json(res, r.ok ? 200 : r.error === 'not_found' ? 404 : 400, r); return; }
    }
    const done = /^done\/(d_[0-9a-f]{16})\/undo$/.exec(rest);
    if (done && method === 'POST') { answer(res, actions.undo(done[1])); return; }
    const un = /^unanswered\/(u_[0-9a-f]{16})$/.exec(rest);
    if (un && method === 'POST') {
      const u = store.getDoc('unanswered', un[1]);
      if (!u) { json(res, 404, { error: 'not_found' }); return; }
      const b = await readJson(req);
      if (b && typeof b.answer === 'string' && b.answer.trim()) {
        // The owner typed the fact themselves: that is the validation, so it goes into the draft as a checked fact (published later, through the gate).
        const r = studio.applyOps([{ op: 'add_fact', text: b.answer.trim().slice(0, 300), source: 'owner answer', validated: true }], { scope: 'owner', by: 'owner' });
        if (!r.ok) { json(res, 409, r); return; }
        u.status = 'answered';
      } else if (b && b.dismiss === true) u.status = 'dismissed';
      else { json(res, 400, { error: 'bad_request' }); return; }
      store.putDoc('unanswered', u.id, u);
      json(res, 200, { ok: true, status: u.status });
      return;
    }
    const appr = /^approvals\/(a_[0-9a-f]{16})$/.exec(rest);
    if (appr && method === 'POST') {
      const body = await readJson(req);
      const r = actions.decide(appr[1], body && body.decision);
      json(res, r.ok || r.status ? 200 : 409, r);
      return;
    }
    if (rest === 'kill' && method === 'POST') {
      const body = await readJson(req);
      governor.setKilled(!!(body && body.on === true));
      json(res, 200, { killed: governor.isKilled() });
      return;
    }
    if (rest === 'scenarios' && method === 'POST') { json(res, 200, { results: await runScenarios() }); return; }

    // The workshop: draft, checks, publication, versions. `scope` is who is asking: a chat with Kaby ("kaby", the default, the narrower)
    // or the owner's own click in the page ("owner").
    if (rest === 'studio' && method === 'GET') {
      json(res, 200, { ...studio.status(), publicUrl: info.publicUrl || null, embed: info.publicUrl ? embedSnippet({ base: info.publicUrl, slug: fiche.slug }) : null });
      return;
    }
    if (rest === 'studio/ops' && method === 'POST') {
      const b = await readJson(req);
      const scope = b && b.scope === 'owner' ? 'owner' : 'kaby';
      const r = studio.applyOps(b && b.ops, { scope, by: scope === 'owner' ? 'owner' : 'kaby' });
      json(res, r.ok ? 200 : 409, r);
      return;
    }
    // `by` says who made the call: the owner's own click (default), or Kaby's tool after the owner approved its card. Only the journal reads it.
    const byOf = (b) => (b && b.by === 'kaby' ? 'kaby (approved)' : 'owner');
    if (rest === 'studio/discard' && method === 'POST') { const b = await readJson(req); json(res, 200, studio.discard({ by: byOf(b) })); return; }
    if (rest === 'studio/review' && method === 'POST') { const b = await readJson(req); json(res, 200, studio.review({ by: byOf(b) })); return; }
    if (rest === 'studio/checks' && method === 'POST') { const b = await readJson(req); json(res, 200, await studio.check({ by: byOf(b) })); return; }
    if (rest === 'studio/publish' && method === 'POST') { const b = await readJson(req); answer(res, studio.publish({ by: byOf(b), summary: b && typeof b.summary === 'string' ? b.summary : '' })); return; }
    if (rest === 'studio/rollback' && method === 'POST') { const b = await readJson(req); answer(res, studio.rollback(b && b.version, { by: byOf(b) })); return; }

    // The preview: the draft, in memory, with a small cap of its own. Nothing here touches the live data.
    if (rest === 'preview/messages' && method === 'POST') {
      const b = await readJson(req);
      if (!b || typeof b.visitorId !== 'string' || !VISITOR_ID.test(b.visitorId)) { json(res, 400, { error: 'bad_visitor' }); return; }
      const lang = typeof b.lang === 'string' && /^(en|fr)$/.test(b.lang) ? b.lang : undefined;
      const out = await studio.preview().runner.handleMessage({ channel: 'site', senderKey: b.visitorId, visitorId: b.visitorId, ip: ipOf(req), text: b.text, lang });
      json(res, statusOf(out), visitorShape(out));
      return;
    }
    if (rest === 'preview/consent' && method === 'POST') {
      const b = await readJson(req);
      if (!b || typeof b.visitorId !== 'string' || !VISITOR_ID.test(b.visitorId) || typeof b.noteId !== 'string' || !/^n_[0-9a-f]{16}$/.test(b.noteId)) { json(res, 400, { error: 'bad_request' }); return; }
      const r = studio.preview().actions.consent({ noteId: b.noteId, accept: b.accept === true, ctx: visitorCtx(b.visitorId) });
      json(res, r.ok ? 200 : 404, { ok: r.ok, reply: r.ok ? t(fiche.language, r.saved ? 'consent.saved' : 'consent.declined') : undefined, error: r.error });
      return;
    }
    if (rest === 'preview/reset' && method === 'POST') { studio.resetPreview(); json(res, 200, { ok: true }); return; }
    json(res, 404, { error: 'not_found' });
  }

  const server = http.createServer(async (req, res) => {
    try {
      const p = new URL(req.url, 'http://x').pathname;
      if (req.method === 'GET' && (p === '/' || p === `/c/${fiche.slug}`)) { page(res, (nonce) => chatPage({ fiche, nonce })); return; }
      if (req.method === 'GET' && p === '/widget.js') {
        send(res, 200, widgetScript(), 'application/javascript; charset=utf-8', { 'cache-control': 'public, max-age=300', 'cross-origin-resource-policy': 'cross-origin' });
        return;
      }
      const v = /^\/c\/([^/]+)\/(messages|consent|me|config)$/.exec(p);
      if (v) {
        if (v[1] !== fiche.slug) { json(res, 404, { error: 'not_found' }); return; }
        await visitorApi(req, res, v[2]);
        return;
      }
      if (req.method === 'GET' && (p === '/boite' || p === '/atelier' || p === '/preview')) {
        if (!ownerToken) { json(res, 404, { error: 'not_found' }); return; }
        if (p === '/preview') page(res, (nonce) => chatPage({ fiche: studio.preview().fiche, nonce, preview: true }), { ancestors: "'self'" });
        else if (p === '/boite') page(res, (nonce) => boitePage({ fiche, nonce }), { ancestors: "'self'" });
        else page(res, (nonce) => atelierPage({ fiche, nonce }), { ancestors: "'self'", frames: true });
        return;
      }
      const a = /^\/(?:v1\/admin|api)\/(.+)$/.exec(p);
      if (a) { await adminApi(req, res, a[1]); return; }
      json(res, 404, { error: 'not_found' });
    } catch (e) {
      if (res.headersSent) { res.end(); return; }
      const code = e && Number.isInteger(e.code) && e.code >= 400 && e.code < 500 ? e.code : 500;
      if (code === 413) res.on('finish', () => req.socket.destroy());
      json(res, code, { error: { 413: 'too_big', 415: 'json_only', 400: 'bad_json' }[code] || 'error' }, code === 413 ? { connection: 'close' } : {});
    }
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 70_000;
  return server;
}
