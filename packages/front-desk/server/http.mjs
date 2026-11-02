// The HTTP face of the public service, on node:http with no dependency.
//
//   GET  /c/:slug                  the chat page (also GET / : the service serves one shop)
//   POST /c/:slug/messages         { visitorId, text, lang? }  -> { ok, reply, pendingConsents }
//   POST /c/:slug/consent          { visitorId, noteId, accept }
//   GET|DELETE /c/:slug/me         the visitor's own data / erase it   (header x-visitor-id)
//   GET  /boite                    the owner's page (a static shell; its data needs the token)
//   /v1/admin/*                    the owner's API, Bearer FRONT_DESK_OWNER_TOKEN (no token configured = no admin at all)
//
// Rules kept here: body size cap, JSON only, an Origin that is neither this host nor allow-listed is refused, a CSP nonce on every
// page, replies as text (pages render with textContent), no stack trace ever leaves, the visitor's IP is the socket's (a proxy
// header is read only when `trustProxy` is set).

import http from 'node:http';
import crypto from 'node:crypto';
import { chatPage, boitePage } from './pages.mjs';
import { runScenarios } from '../core/scenarios.mjs';
import { t } from '../core/text.mjs';

const MAX_BODY = 16 * 1024;
const VISITOR_ID = /^[a-z0-9]{16,64}$/;
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const fieldsOf = (rec) => (rec ? Object.fromEntries(Object.entries(rec.fields).map(([k, v]) => [k, v.value])) : {});

export function createHttpServer({ service, ownerToken = null, trustProxy = false, now = Date.now }) {
  const { fiche, store, governor, actions, runner } = service;
  const failedAuth = new Map();

  const ipOf = (req) => {
    if (trustProxy) { const f = req.headers['x-forwarded-for']; if (typeof f === 'string' && f) return f.split(',').pop().trim().slice(0, 64); }
    return req.socket.remoteAddress || 'unknown';
  };

  function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', ...extra });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  }
  const json = (res, status, body, extra) => send(res, status, body, undefined, extra);

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

  function page(res, build) {
    const nonce = crypto.randomBytes(16).toString('base64');
    const ancestors = fiche.guardrails.allowedOrigins.length ? fiche.guardrails.allowedOrigins.join(' ') : "'none'";
    send(res, 200, build(nonce), 'text/html; charset=utf-8', {
      'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors ${ancestors}`,
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

  async function visitorApi(req, res, rest) {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...corsHeaders(req), 'access-control-allow-methods': 'GET, POST, DELETE', 'access-control-allow-headers': 'content-type, x-visitor-id', 'access-control-max-age': '600' });
      res.end();
      return;
    }
    if (!originAllowed(req)) { json(res, 403, { error: 'origin' }); return; }
    const cors = corsHeaders(req);
    if (rest === 'messages' && req.method === 'POST') {
      const body = await readJson(req);
      if (!body || typeof body.visitorId !== 'string' || !VISITOR_ID.test(body.visitorId)) { json(res, 400, { error: 'bad_visitor' }, cors); return; }
      const lang = typeof body.lang === 'string' && /^(en|fr)$/.test(body.lang) ? body.lang : undefined;
      const out = await runner.handleMessage({ channel: 'site', senderKey: body.visitorId, visitorId: body.visitorId, ip: ipOf(req), text: body.text, lang });
      const status = out.ok ? 200 : (out.error === 'empty' || out.error === 'too_long' ? 400 : out.error === 'failed' ? 502 : 429);
      json(res, status, { ok: out.ok, error: out.error, reply: out.reply, pendingConsents: out.pendingConsents || [] }, cors);
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

  async function adminApi(req, res, rest) {
    if (!isOwner(req, res)) return;
    if (rest === 'overview' && req.method === 'GET') {
      const convs = store.listDocs('conversations').map((c) => c.value).sort((a, b) => b.lastAt - a.lastAt).slice(0, 100);
      const approvals = store.listDocs('approvals').map((a) => a.value).filter((a) => a.status === 'pending').map((a) => ({ id: a.id, name: a.name, params: a.params, convId: a.ctx.convId, createdAt: a.createdAt }));
      const recent = (col) => store.listDocs(col).map((m) => m.value).sort((a, b) => b.ts - a.ts).slice(0, 50);
      json(res, 200, { shop: { name: fiche.name, slug: fiche.slug }, budget: governor.snapshot(), conversations: convs, approvals, messages: recent('messages'), callbacks: recent('callbacks') });
      return;
    }
    const conv = /^conversations\/(c_[0-9a-f]{24})$/.exec(rest);
    if (conv && req.method === 'GET') {
      const meta = store.getDoc('conversations', conv[1]);
      if (!meta) { json(res, 404, { error: 'not_found' }); return; }
      const rec = actions.recordByKey(meta.key);
      const fields = rec ? Object.fromEntries(Object.entries(rec.fields).map(([k, v]) => [k, { value: v.value, consentAt: v.consentAt }])) : {};
      json(res, 200, { meta, log: store.readLog(`conv_${conv[1].slice(2)}`, 200), card: { level: meta.level, channel: meta.channel, fields } });
      return;
    }
    if (conv && req.method === 'DELETE') {
      const meta = store.getDoc('conversations', conv[1]);
      if (!meta) { json(res, 404, { error: 'not_found' }); return; }
      json(res, 200, { ok: true, erased: actions.eraseKey(meta.key) });
      return;
    }
    const appr = /^approvals\/(a_[0-9a-f]{16})$/.exec(rest);
    if (appr && req.method === 'POST') {
      const body = await readJson(req);
      const r = actions.decide(appr[1], body && body.decision);
      json(res, r.ok || r.status ? 200 : 409, r);
      return;
    }
    if (rest === 'kill' && req.method === 'POST') {
      const body = await readJson(req);
      governor.setKilled(!!(body && body.on === true));
      json(res, 200, { killed: governor.isKilled() });
      return;
    }
    if (rest === 'scenarios' && req.method === 'POST') { json(res, 200, { results: await runScenarios() }); return; }
    json(res, 404, { error: 'not_found' });
  }

  const server = http.createServer(async (req, res) => {
    try {
      const p = new URL(req.url, 'http://x').pathname;
      if (req.method === 'GET' && (p === '/' || p === `/c/${fiche.slug}`)) { page(res, (nonce) => chatPage({ fiche, nonce })); return; }
      const v = /^\/c\/([^/]+)\/(messages|consent|me)$/.exec(p);
      if (v) {
        if (v[1] !== fiche.slug) { json(res, 404, { error: 'not_found' }); return; }
        await visitorApi(req, res, v[2]);
        return;
      }
      if (req.method === 'GET' && p === '/boite') {
        if (!ownerToken) { json(res, 404, { error: 'not_found' }); return; }
        page(res, (nonce) => boitePage({ fiche, nonce }));
        return;
      }
      const a = /^\/v1\/admin\/(.+)$/.exec(p);
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
