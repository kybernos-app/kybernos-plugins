// Forgetting a visitor leaves nothing of them: not through the assistant's own `forget_visitor` in a normal turn (it used to write the visitor's last words back),
// not in the calls parked for the owner's approval (they hold the visitor's phone number), not in the retry memory (a later call of the same words saved nothing).

import test from 'node:test';
import assert from 'node:assert/strict';
import { stepOf } from '../core/scripted.mjs';
import { makeShop, ctxOf, logOf } from './helpers-shop.mjs';
import { msg } from './helpers.mjs';

/** A tool context whose conversation id is the one the runner would give that visitor (the erasure finds a visitor's things by it). */
const visitor = (s, senderKey) => { const c = ctxOf({ senderKey }); c.convId = s.runner.convIdFor(c); return c; };
const call = (s, name, args, ctx) => s.actions.execute({ name, args, ctx: ctx || visitor(s, 'visitoraaaaaa') });

test('a visitor who asks to be forgotten in a turn is not written back: no conversation, no log, nothing in the inbox', async () => {
  const s = makeShop({
    guardrails: { actions: { leave_message: 'auto', forget_visitor: 'auto' } },
    handler: ({ messages }) => (stepOf(messages) === 0 ? { toolCalls: [{ name: 'forget_visitor', args: {} }] } : { text: 'Done, you are forgotten.' }),
  });
  const m = msg('Forget me, I am Ann Smith, ann@example.com', { visitorId: 'visitorannsmith1' });
  const r = await s.runner.handleMessage(m);
  assert.equal(r.ok, true);
  assert.equal(r.erased, true);
  assert.equal(r.reply, 'Done, you are forgotten.');
  assert.deepEqual(s.store.listDocs('conversations'), [], 'no conversation was made for them');
  assert.deepEqual(logOf(s, r.convId), [], 'their words are not in a log');
  assert.ok(!JSON.stringify(s.store.listDocs('conversations')).includes('ann@example.com'));
  assert.equal(s.store.readLog('erasures', 10).length, 1, 'the erasure itself is recorded (a key, a count, no words)');
  assert.ok(!JSON.stringify(s.store.readLog('erasures', 10)).includes('Ann Smith'));
});

test('forgotten after a first exchange: the earlier conversation goes too, and the turn leaves nothing behind', async () => {
  let forget = false;
  const s = makeShop({
    guardrails: { actions: { leave_message: 'auto', forget_visitor: 'auto' } },
    handler: ({ messages }) => (forget && stepOf(messages) === 0 ? { toolCalls: [{ name: 'forget_visitor', args: {} }] } : { text: 'ok' }),
  });
  const m = msg('hello there', { visitorId: 'visitorsecond01' });
  const first = await s.runner.handleMessage(m);
  assert.equal(s.store.listDocs('conversations').length, 1);
  forget = true;
  const r = await s.runner.handleMessage({ ...m, text: 'please forget me' });
  assert.equal(r.erased, true);
  assert.deepEqual(s.store.listDocs('conversations'), []);
  assert.deepEqual(logOf(s, first.convId), []);
});

test('a call parked for approval (a phone number) is erased with the visitor, and cannot be approved afterwards', () => {
  const s = makeShop({ guardrails: { actions: { request_callback: 'approve', forget_visitor: 'auto' } } });
  const parked = call(s, 'request_callback', { phone: '+33 6 12 34 56 78' });
  assert.equal(parked.pending, true);
  assert.equal(s.store.listDocs('approvals').length, 1);
  const gone = call(s, 'forget_visitor', {});
  assert.equal(gone.ok, true);
  assert.deepEqual(s.store.listDocs('approvals'), [], 'the parked call, with its phone number, is gone');
  assert.deepEqual(s.actions.decide(parked.approvalId, 'approve'), { ok: false, error: 'not_found' });
  assert.equal(s.store.listDocs('callbacks').length, 0, 'nothing was made of it');
});

test('another visitor\'s parked call stays', () => {
  const s = makeShop({ guardrails: { actions: { request_callback: 'approve', forget_visitor: 'auto' } } });
  const other = visitor(s, 'visitorbbbbbb');
  call(s, 'request_callback', { phone: '+33 6 00 00 00 01' }, other);
  call(s, 'request_callback', { phone: '+33 6 00 00 00 02' });
  call(s, 'forget_visitor', {});
  const left = s.store.listDocs('approvals');
  assert.equal(left.length, 1);
  assert.equal(left[0].value.ctx.convId, other.convId);
});

test('after erasure the same words are a new message: the retry memory went with the visitor', () => {
  const s = makeShop({ guardrails: { actions: { leave_message: 'auto', forget_visitor: 'auto' } } });
  call(s, 'leave_message', { message: 'Please call me' });
  assert.equal(s.store.listDocs('messages').length, 1);
  call(s, 'forget_visitor', {});
  assert.equal(s.store.listDocs('messages').length, 0);
  assert.equal(s.store.listDocs('idem').length, 0, 'no retry memory of the erased conversation');
  call(s, 'leave_message', { message: 'Please call me' });
  assert.equal(s.store.listDocs('messages').length, 1, 'saved again, not answered "done" from a stale memory');
});

test('the retry memory of another visitor is kept', () => {
  const s = makeShop({ guardrails: { actions: { leave_message: 'auto', forget_visitor: 'auto' } } });
  const other = visitor(s, 'visitorbbbbbb');
  call(s, 'leave_message', { message: 'Hi from B' }, other);
  call(s, 'leave_message', { message: 'Hi from A' });
  call(s, 'forget_visitor', {});
  const left = s.store.listDocs('idem');
  assert.equal(left.length, 1);
  assert.equal(left[0].value.convId, other.convId);
});
