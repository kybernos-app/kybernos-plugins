import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeSvc, msg } from './helpers.mjs';
import { scriptedModel } from '../core/scripted.mjs';
import { createGovernor, dayKey, worstCaseMicro, costOf } from '../core/budget.mjs';
import { createStore } from '../core/store.mjs';
import { normaliseGuardrails } from '../core/guardrails.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fd-test-'));

test('worst case grows with the tool steps, the output allowance and the input', () => {
  const { value } = normaliseGuardrails({});
  const a = worstCaseMicro({ inputChars: 1000, limits: value.limits, budget: value.budget });
  const b = worstCaseMicro({ inputChars: 2000, limits: value.limits, budget: value.budget });
  const c = worstCaseMicro({ inputChars: 1000, limits: { ...value.limits, maxToolSteps: 0 }, budget: value.budget });
  assert.ok(b > a && a > c && c > 0);
  assert.equal(costOf({ inputTokens: 1000, outputTokens: 100 }, value.budget), 1000 * 1 + 100 * 4);
});

test('concurrent turns cannot reserve more than the daily cap: the sum of what can be spent stays under it', async () => {
  const svc = makeSvc({ guardrails: { budget: { dailyCap: 0.05, visitorDailyCap: 2 }, limits: { maxConcurrentShop: 20, perIpPerMin: 120, perVisitorPerMin: 60, perShopPerMin: 1200 } }, delayMs: 30 });
  const results = await Promise.all(Array.from({ length: 20 }, () => svc.runner.handleMessage(msg('hello there'))));
  const started = svc.model.calls.length;
  const capMicro = 50_000;
  const est = results.filter((r) => r.ok).length;
  assert.equal(est, started);
  assert.ok(started >= 1, 'at least one turn runs');
  assert.ok(started < 20, 'not all twenty were let in');
  assert.ok(results.some((r) => r.error === 'day_cap'), 'the others are refused because of the cap');
  const snap = svc.governor.snapshot();
  assert.ok(snap.spentMicro <= capMicro, 'spent stays under the cap');
  assert.equal(snap.reservedMicro, 0, 'every reservation is settled');
  assert.equal(snap.inflight, 0);
});

test('sequential turns keep spending real money until the cap, then stop; spend never passes the cap', async () => {
  const svc = makeSvc({
    guardrails: { budget: { dailyCap: 0.1, visitorDailyCap: 2 }, limits: { perIpPerMin: 120, perVisitorPerMin: 60, perShopPerMin: 1200 } },
    handler: () => ({ text: 'ok', usage: { inputTokens: 5000, outputTokens: 500 } }), // 7000 micro a turn
  });
  let ok = 0;
  for (let i = 0; i < 30; i += 1) { const r = await svc.runner.handleMessage(msg('hi')); if (r.ok) ok += 1; }
  const snap = svc.governor.snapshot();
  assert.ok(ok > 1 && ok < 30);
  assert.ok(snap.spentMicro <= 100_000, `spent ${snap.spentMicro}`);
});

test('a provider that overruns its reservation is cut off, charged for what it used, and the shop is then closed for the day', async () => {
  const svc = makeSvc({
    guardrails: { budget: { dailyCap: 0.05, visitorDailyCap: 0.05 } },
    handler: () => ({ text: 'ok', usage: { inputTokens: 5_000_000, outputTokens: 5_000_000 } }),
  });
  const r = await svc.runner.handleMessage(msg('hi'));
  assert.equal(r.ok, false);
  const snap = svc.governor.snapshot();
  assert.ok(snap.spentMicro > snap.capMicro, 'the real spend is recorded honestly');
  const next = await svc.runner.handleMessage(msg('hi again'));
  assert.equal(next.error, 'day_cap');
});

test('one visitor has their own daily cap', async () => {
  const svc = makeSvc({
    guardrails: { budget: { dailyCap: 2, visitorDailyCap: 0.04 }, limits: { perVisitorPerMin: 60 } },
    handler: () => ({ text: 'ok', usage: { inputTokens: 5000, outputTokens: 500 } }),
  });
  const v = msg('hi', { visitorId: 'visitor_one_00001' });
  const outcomes = [];
  for (let i = 0; i < 10; i += 1) outcomes.push((await svc.runner.handleMessage({ ...v, text: `q${i}` })).error || 'ok');
  assert.ok(outcomes.includes('visitor_cap'));
  const other = await svc.runner.handleMessage(msg('hi'));
  assert.equal(other.ok, true, 'a different visitor is not affected');
});

test('rate limits per IP: refused over the limit, allowed again a minute later', async () => {
  let t = 1_700_000_000_000;
  const svc = makeSvc({ guardrails: { limits: { perIpPerMin: 3, perVisitorPerMin: 60, perShopPerMin: 1200 } }, now: () => t });
  const ip = '203.0.113.7';
  const out = [];
  for (let i = 0; i < 5; i += 1) out.push((await svc.runner.handleMessage(msg('hi', { ip }))).error || 'ok');
  assert.deepEqual(out, ['ok', 'ok', 'ok', 'rate_ip', 'rate_ip']);
  t += 61_000;
  assert.equal((await svc.runner.handleMessage(msg('hi', { ip }))).ok, true);
});

test('per-visitor concurrency: a second turn of the same visitor is refused while one runs', async () => {
  const svc = makeSvc({ delayMs: 50, guardrails: { limits: { maxConcurrentVisitor: 1 } } });
  const v = msg('hi');
  const [a, b] = await Promise.all([svc.runner.handleMessage(v), svc.runner.handleMessage({ ...v, text: 'again' })]);
  assert.deepEqual([a.ok, b.error], [true, 'busy_visitor']);
});

test('the kill switch is a file, works across a restart, and does not depend on the ledger', async () => {
  const dir = tmp();
  const a = makeSvc({ dir });
  assert.equal((await a.runner.handleMessage(msg('hi'))).ok, true);
  a.governor.setKilled(true);
  assert.equal((await a.runner.handleMessage(msg('hi'))).error, 'killed');
  fs.rmSync(path.join(dir, 'ledger'), { recursive: true, force: true }); // the ledger is gone: still closed
  const b = makeSvc({ dir });
  assert.equal((await b.runner.handleMessage(msg('hi'))).error, 'killed');
  b.governor.setKilled(false);
  assert.equal((await b.runner.handleMessage(msg('hi'))).ok, true);
});

test('a new day starts a new count, in the shop\'s timezone', () => {
  const day = Date.UTC(2026, 10, 2, 23, 30); // 23:30 UTC
  assert.equal(dayKey(day, 'UTC'), '2026-11-02');
  assert.equal(dayKey(day, 'Europe/Paris'), '2026-11-03');
  let t = day;
  const store = createStore();
  const { value } = normaliseGuardrails({ budget: { dailyCap: 1, visitorDailyCap: 1 } });
  const gov = createGovernor({ guardrails: value, store, now: () => t });
  const r = gov.reserve({ visitorId: 'v1', ip: 'a', estimateMicro: 1000 });
  gov.settle(r.ticket, 900_000);
  assert.equal(gov.snapshot().spentMicro, 900_000);
  t += 3600_000 * 2;
  assert.equal(gov.snapshot().spentMicro, 0);
});

test('the ledger survives a restart', () => {
  const dir = tmp();
  const { value } = normaliseGuardrails({});
  const g1 = createGovernor({ guardrails: value, store: createStore({ dir }) });
  const r = g1.reserve({ visitorId: 'v1', ip: 'a', estimateMicro: 100 });
  g1.settle(r.ticket, 777);
  const g2 = createGovernor({ guardrails: value, store: createStore({ dir }) });
  assert.equal(g2.snapshot().spentMicro, 777);
});

test('settling twice charges once; a failed model call releases the slot', async () => {
  const { value } = normaliseGuardrails({});
  const gov = createGovernor({ guardrails: value, store: createStore() });
  const r = gov.reserve({ visitorId: 'v1', ip: 'a', estimateMicro: 100 });
  gov.settle(r.ticket, 50);
  gov.settle(r.ticket, 50);
  assert.equal(gov.snapshot().spentMicro, 50);
  const svc = makeSvc({ model: { async complete() { throw new Error('boom'); } } });
  const out = await svc.runner.handleMessage(msg('hi'));
  assert.equal(out.ok, false);
  assert.equal(svc.governor.snapshot().inflight, 0);
  assert.equal(svc.governor.snapshot().reservedMicro, 0);
});

test('a model that never answers is cut at the turn timeout and its slot released', async () => {
  const model = { complete: () => new Promise(() => {}) };
  const svc = makeSvc({ model, guardrails: { limits: { turnTimeoutMs: 1000 } } });
  const t0 = Date.now();
  const out = await svc.runner.handleMessage(msg('hi'));
  assert.equal(out.ok, false);
  assert.ok(Date.now() - t0 < 3000);
  assert.equal(svc.governor.snapshot().inflight, 0);
});

test('a disabled shop answers nothing', async () => {
  const svc = makeSvc({ guardrails: { enabled: false } });
  assert.equal((await svc.runner.handleMessage(msg('hi'))).error, 'disabled');
  assert.equal(svc.model.calls.length, 0);
});
