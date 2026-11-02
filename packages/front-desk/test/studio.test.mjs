import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseFiche } from '../core/fiche.mjs';
import { createService } from '../core/service.mjs';
import { scriptedModel } from '../core/scripted.mjs';

const SEED = {
  slug: 'atelier-lune', name: 'Atelier Lune', language: 'en',
  knowledge: [{ text: 'Open Tuesday to Saturday.', source: 'owner', validated: true }],
  guardrails: { actions: { leave_message: 'auto' }, budget: { dailyCap: 2 } },
};

function shop(dir = null) {
  const model = scriptedModel(() => ({ text: 'Hello from the live fiche.' }));
  const svc = createService({ fiche: parseFiche(SEED).fiche, model, dir, runChecks: async () => [{ name: 'stub', ok: true, failures: [] }] });
  svc.studio.init(SEED);
  return svc;
}
const ops = (svc, o, scope = 'owner') => svc.studio.applyOps(o, { scope });
const ready = async (svc) => { svc.studio.review(); await svc.studio.check(); };

test('a first start publishes the seed as version 1; the stored version wins on the next start', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-studio-'));
  const a = shop(dir);
  assert.equal(a.studio.status().published.n, 1);
  assert.equal(ops(a, [{ op: 'set', path: 'tone', value: 'Warm.' }]).ok, true);
  assert.equal(a.fiche.tone, '', 'a draft never reaches the live fiche');
  const model = scriptedModel(() => ({ text: 'x' }));
  const b = createService({ fiche: parseFiche({ ...SEED, name: 'Changed In The File' }).fiche, model, dir });
  const r = b.studio.init({ ...SEED, name: 'Changed In The File' });
  assert.deepEqual([r.fromStore, b.fiche.name], [true, 'Atelier Lune']);
  assert.equal(b.studio.status().dirty, true, 'the draft survives a restart');
});

test('Kaby edits looks and wording; money, doors and "validated" wait for the owner', () => {
  const s = shop();
  assert.equal(ops(s, [{ op: 'set', path: 'brand.color', value: '#aa3366' }, { op: 'add_fact', text: 'Parking is free.', source: 'site' }], 'kaby').ok, true);
  const refused = [
    [{ op: 'set', path: 'guardrails.budget.dailyCap', value: 5 }],
    [{ op: 'set', path: 'guardrails.limits.perIpPerMin', value: 50 }],
    [{ op: 'set', path: 'guardrails.allowedOrigins', value: ['https://shop.example'] }],
    [{ op: 'set', path: 'guardrails.actions.leave_message', value: 'auto' }],
    [{ op: 'add_fact', text: 'Sure thing.', validated: true }],
    [{ op: 'set_fact', index: 0, validated: true }],
  ];
  for (const o of refused) assert.equal(ops(s, o, 'kaby').error, 'owner_only', JSON.stringify(o));
  assert.equal(ops(s, [{ op: 'set', path: 'guardrails.actions.leave_message', value: 'approve' }], 'kaby').ok, true, 'a safer mode is allowed');
  assert.equal(ops(s, [{ op: 'set', path: 'slug', value: 'other' }]).error, 'path_not_allowed');
  assert.equal(ops(s, [{ op: 'set', path: 'guardrails.actions.delete_all', value: 'auto' }]).error, 'unknown_action');
  assert.equal(ops(s, [{ op: 'set', path: 'guardrails.budget.dailyCap', value: 500 }]).error, 'above_ceiling', 'even the owner cannot pass the hard ceiling');
});

test('the diff says how careful to be: wording low, a validated fact medium, auto and raised money high', () => {
  const s = shop();
  ops(s, [{ op: 'set', path: 'tone', value: 'Warm.' }, { op: 'add_fact', text: 'Closed in August.', validated: true }, { op: 'set', path: 'guardrails.actions.leave_message', value: 'off' }]);
  ops(s, [{ op: 'set', path: 'guardrails.actions.request_callback', value: 'auto' }, { op: 'set', path: 'guardrails.budget.dailyCap', value: 3 }, { op: 'set', path: 'guardrails.allowedOrigins', value: ['https://shop.example'] }]);
  const risk = Object.fromEntries(s.studio.diff().map((d) => [d.path, d.risk]));
  assert.equal(risk.tone, 'low');
  assert.equal(risk.fact, 'medium');
  assert.equal(risk['action.request_callback'], 'high');
  assert.equal(risk['action.leave_message'], 'low');
  assert.equal(risk['budget.dailyCapMicro'], 'high');
  assert.equal(risk.allowedOrigin, 'high');
});

test('publishing is blocked until the facts are validated, the sheet read and the checks passed on THIS draft', async () => {
  const s = shop();
  assert.deepEqual(s.studio.publish().blockers.map((b) => b.code), ['no_changes', 'not_reviewed', 'checks_missing']);
  ops(s, [{ op: 'add_fact', text: 'Parking is free.', source: 'site' }, { op: 'set', path: 'tone', value: 'Warm.' }], 'kaby');
  assert.ok(s.studio.publish().blockers.some((b) => b.code === 'unvalidated_facts' && b.count === 1));
  ops(s, [{ op: 'set_fact', index: 1, validated: true }]);
  await ready(s);
  assert.deepEqual(s.studio.status().blockers, []);
  // Any further change to the draft makes the checks stale; a change to what the assistant can do asks for a new reading.
  ops(s, [{ op: 'set', path: 'tone', value: 'Calm.' }]);
  assert.deepEqual(s.studio.status().blockers.map((b) => b.code), ['checks_missing']);
  await s.studio.check();
  ops(s, [{ op: 'set', path: 'guardrails.actions.request_callback', value: 'approve' }]);
  assert.deepEqual(s.studio.status().blockers.map((b) => b.code), ['not_reviewed', 'checks_missing']);
});

test('a failing check blocks publication', async () => {
  const model = scriptedModel(() => ({ text: 'x' }));
  const svc = createService({ fiche: parseFiche(SEED).fiche, model, runChecks: async () => [{ name: 'bad', ok: false, failures: ['no'] }] });
  svc.studio.init(SEED);
  ops(svc, [{ op: 'set', path: 'tone', value: 'Warm.' }]);
  await ready(svc);
  assert.deepEqual(svc.studio.status().blockers.map((b) => b.code), ['checks_failed']);
  assert.equal(svc.studio.publish().ok, false);
});

test('publishing replaces the live fiche in place, with no restart, and the new tone reaches the model', async () => {
  const s = shop();
  const held = s.fiche; // what the runner, the pages and the governor hold
  ops(s, [{ op: 'set', path: 'tone', value: 'Calm and brief.' }, { op: 'set', path: 'guardrails.budget.dailyCap', value: 1 }]);
  await ready(s);
  const r = s.studio.publish({ summary: 'tone' });
  assert.deepEqual([r.ok, r.version], [true, 2]);
  assert.equal(held.tone, 'Calm and brief.');
  assert.equal(held, s.fiche, 'the same object');
  assert.equal(s.governor.snapshot().capMicro, 1_000_000, 'the budget follows the live fiche');
  assert.equal(s.studio.status().dirty, false);
  assert.equal(s.studio.status().journal[0].kind, 'publish');
});

test('rollback publishes an old version again as a new one; the live one cannot be "restored"', async () => {
  const s = shop();
  ops(s, [{ op: 'set', path: 'tone', value: 'Calm.' }]);
  await ready(s);
  s.studio.publish();
  assert.equal(s.fiche.tone, 'Calm.');
  assert.equal(s.studio.rollback(2).error, 'already_live');
  const back = s.studio.rollback(1);
  assert.deepEqual([back.ok, back.version, s.fiche.tone], [true, 3, '']);
  assert.deepEqual(s.studio.status().versions.map((v) => v.n), [3, 2, 1]);
  assert.equal(s.studio.rollback(99).error, 'not_found');
});

test('discard drops the draft; the preview answers from the DRAFT, in memory, and rebuilds when the draft changes', async () => {
  const s = shop();
  ops(s, [{ op: 'set', path: 'tone', value: 'Calm.' }]);
  const p1 = s.studio.preview();
  assert.equal(p1.fiche.tone, 'Calm.');
  assert.equal(s.studio.preview(), p1, 'cached while the draft is the same');
  const out = await p1.runner.handleMessage({ channel: 'site', senderKey: 'previewaaaaaaaaaaa', visitorId: 'previewaaaaaaaaaaa', ip: 'x', text: 'hi' });
  assert.equal(out.ok, true);
  assert.equal(s.governor.snapshot().spentMicro, 0, 'a preview never touches the real ledger');
  assert.equal(s.store.listDocs('conversations').length, 0, 'nor the real conversations');
  ops(s, [{ op: 'set', path: 'tone', value: 'Loud.' }]);
  assert.notEqual(s.studio.preview(), p1);
  s.studio.discard();
  assert.equal(s.studio.status().dirty, false);
  assert.equal(s.studio.preview().fiche.tone, '');
});

test('the preview has a cap of its own, below the shop cap', () => {
  const s = shop();
  assert.ok(s.studio.preview().governor.snapshot().capMicro <= 500_000);
});

test('the real publish gate (scenarios + draft checks) passes on a normal draft', async () => {
  const model = scriptedModel(() => ({ text: 'x' }));
  const svc = createService({ fiche: parseFiche(SEED).fiche, model });
  svc.studio.init(SEED);
  ops(svc, [{ op: 'set', path: 'guardrails.actions.request_callback', value: 'approve' }]);
  const r = await svc.studio.check();
  assert.deepEqual(r.results.filter((x) => !x.ok), []);
  assert.ok(r.results.length >= 8, 'five scenarios and three draft checks');
});
