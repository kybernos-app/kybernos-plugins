// The owner's inbox (core/inbox.mjs) and the human-mode branch of the runner: taking a conversation over, answering in it, handing it
// back, and what that does to the model and to the budget.

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeShop, clock, logOf } from './helpers-shop.mjs';
import { msg } from './helpers.mjs';
import { scriptedModel, stepOf } from '../core/scripted.mjs';

const NO_SUCH = `c_${'f'.repeat(24)}`;
const meta = (svc, convId) => svc.store.getDoc('conversations', convId);
const QUEUED_EN = 'Your message was passed on. A person from the shop will answer you here.';

test('setMode: an unknown conversation and a bad mode are refused; a valid switch is kept on the conversation', async () => {
  const s = makeShop();
  const out = await s.runner.handleMessage(msg('hi'));
  assert.deepEqual(s.inbox.setMode(NO_SUCH, 'human'), { ok: false, error: 'not_found' });
  for (const bad of ['robot', '', 'HUMAN', undefined, null, 1]) {
    assert.deepEqual(s.inbox.setMode(out.convId, bad), { ok: false, error: 'bad_mode' }, String(bad));
  }
  assert.equal(meta(s, out.convId).mode, 'agent', 'refused switches change nothing');
  assert.deepEqual(s.inbox.setMode(out.convId, 'human'), { ok: true, mode: 'human' });
  assert.equal(meta(s, out.convId).mode, 'human');
  assert.deepEqual(s.inbox.setMode(out.convId, 'agent'), { ok: true, mode: 'agent' });
  assert.equal(meta(s, out.convId).mode, 'agent');
});

test('an owner reply takes the conversation over, is logged as the owner, clears unread and is cleaned and capped', async () => {
  const c = clock();
  const s = makeShop({ now: c.now });
  const out = await s.runner.handleMessage(msg('hi'));
  assert.deepEqual([meta(s, out.convId).mode, meta(s, out.convId).unread], ['agent', 1]);

  c.tick();
  const r1 = await s.inbox.reply(out.convId, '  Hello, this is Ann from the shop.  ');
  assert.deepEqual(r1, { ok: true, mode: 'human', delivered: true });
  const m = meta(s, out.convId);
  assert.deepEqual([m.mode, m.unread, m.lastAt, m.preview], ['human', 0, c.t, 'Hello, this is Ann from the shop.']);
  assert.deepEqual(logOf(s, out.convId).at(-1), { ts: c.t, role: 'owner', text: 'Hello, this is Ann from the shop.', first: true });

  c.tick();
  await s.inbox.reply(out.convId, 'Second line.');
  const second = logOf(s, out.convId).at(-1);
  assert.deepEqual([second.role, second.text, 'first' in second], ['owner', 'Second line.', false], 'only the first owner line says the owner joined');

  assert.deepEqual(await s.inbox.reply(out.convId, '   '), { ok: false, error: 'empty' });
  assert.deepEqual(await s.inbox.reply(out.convId, String.fromCharCode(0, 7, 27)), { ok: false, error: 'empty' }, 'control characters alone are nothing');
  assert.deepEqual(await s.inbox.reply(out.convId, undefined), { ok: false, error: 'empty' });
  assert.deepEqual(await s.inbox.reply(NO_SUCH, 'hello'), { ok: false, error: 'not_found' });
  const before = logOf(s, out.convId).length;
  await s.inbox.reply(out.convId, 'x'.repeat(3000));
  const long = logOf(s, out.convId);
  assert.equal(long.length, before + 1);
  assert.equal(long.at(-1).text.length, 2000, 'a reply is cut at 2000 characters');
});

test('while a person has the conversation the model is not called, nothing is charged, and the visitor message is still kept', async () => {
  const c = clock();
  const model = scriptedModel(() => ({ text: 'Bot answer.' }));
  const s = makeShop({ model, now: c.now });
  const v = msg('hello');
  const first = await s.runner.handleMessage(v);
  assert.equal(model.calls.length, 1);
  const spent = s.governor.snapshot().spentMicro;
  assert.ok(spent > 0, 'the first turn was charged');

  c.tick();
  await s.inbox.reply(first.convId, 'I take over.');
  c.tick();
  const a = await s.runner.handleMessage({ ...v, text: 'Are you there?' });
  assert.deepEqual([a.ok, a.human, a.reply, a.costMicro, a.pendingConsents, a.convId], [true, true, QUEUED_EN, 0, [], first.convId]);
  assert.equal(model.calls.length, 1, 'the model was not called');
  const snap = s.governor.snapshot();
  assert.deepEqual([snap.spentMicro, snap.reservedMicro, snap.inflight], [spent, 0, 0], 'nothing spent, nothing left reserved, no slot held');
  assert.equal(s.store.getDoc('ledger', 'main').shopSpentMicro, spent, 'the stored ledger did not move either');

  assert.deepEqual(logOf(s, first.convId).at(-1), { ts: c.t, role: 'user', text: 'Are you there?' }, 'the visitor line is kept for the owner');
  assert.deepEqual([meta(s, first.convId).unread, meta(s, first.convId).preview, s.inbox.waiting()], [1, 'Are you there?', 1]);
  c.tick();
  await s.runner.handleMessage({ ...v, text: 'Hello?' });
  assert.deepEqual([meta(s, first.convId).unread, s.inbox.waiting(), model.calls.length], [2, 1, 1], 'unread counts every held message, one conversation is waiting');

  const fr = await s.runner.handleMessage({ ...v, text: 'Allo ?', lang: 'fr' });
  assert.match(fr.reply, /^Ton message a été transmis/, 'the holding reply follows the visitor language');
});

test('handing back resumes the model, which then sees the owner words and the held messages in the history', async () => {
  const c = clock();
  const model = scriptedModel(() => ({ text: 'Bot answer.' }));
  const s = makeShop({ model, now: c.now });
  const v = msg('hello');
  const first = await s.runner.handleMessage(v);
  const spent = s.governor.snapshot().spentMicro;
  c.tick();
  await s.inbox.reply(first.convId, 'I take over.');
  c.tick();
  await s.runner.handleMessage({ ...v, text: 'held question' });
  assert.equal(model.calls.length, 1);

  assert.deepEqual(s.inbox.setMode(first.convId, 'agent'), { ok: true, mode: 'agent' });
  c.tick();
  const back = await s.runner.handleMessage({ ...v, text: 'And now?' });
  assert.deepEqual([back.ok, back.reply, back.human], [true, 'Bot answer.', undefined]);
  assert.equal(model.calls.length, 2, 'the model answers again');
  assert.ok(s.governor.snapshot().spentMicro > spent, 'and the turn is charged again');
  assert.deepEqual(model.calls[1].messages.map((m) => [m.role, m.content]), [
    ['user', '<visitor>hello</visitor>'],
    ['assistant', 'Bot answer.'],
    ['assistant', 'I take over.'],
    ['user', '<visitor>held question</visitor>'],
    ['user', '<visitor>And now?</visitor>'],
  ]);
  assert.equal(s.inbox.waiting(), 0, 'an agent-mode conversation never waits for the owner');
});

test('since: only the assistant and the owner, strictly after the timestamp, with the current mode', async () => {
  const c = clock();
  const s = makeShop({
    now: c.now,
    handler: ({ messages }) => (stepOf(messages) === 0 && /first/.test(messages.at(-1).content)
      ? { toolCalls: [{ name: 'leave_message', args: { message: 'a note' } }] }
      : { text: 'Bot.' }),
  });
  assert.deepEqual(s.inbox.since(NO_SUCH, 0), { mode: 'agent', messages: [] }, 'an unknown conversation reads as empty');

  const v = msg('first');
  const a = await s.runner.handleMessage(v); // user, an event line and the assistant, all at t0
  const t0 = c.t;
  c.tick();
  await s.inbox.reply(a.convId, 'The owner is here.');
  const t1 = c.t;
  c.tick();
  await s.runner.handleMessage({ ...v, text: 'held message' }); // a visitor line, never shown back
  c.tick();
  s.inbox.setMode(a.convId, 'agent');
  await s.runner.handleMessage({ ...v, text: 'again' });
  const t3 = c.t;

  assert.ok(logOf(s, a.convId).some((e) => e.type === 'event'), 'the log holds an event line too');
  const all = s.inbox.since(a.convId, 0);
  assert.deepEqual(all.messages, [
    { ts: t0, role: 'assistant', text: 'Bot.' },
    { ts: t1, role: 'owner', text: 'The owner is here.' },
    { ts: t3, role: 'assistant', text: 'Bot.' },
  ]);
  assert.equal(all.mode, 'agent');
  assert.deepEqual(s.inbox.since(a.convId, a.at).messages.map((m) => m.role), ['owner', 'assistant'], 'strictly after: the line at `after` is not repeated');
  assert.deepEqual(s.inbox.since(a.convId, t3).messages, []);
  s.inbox.setMode(a.convId, 'human');
  assert.equal(s.inbox.since(a.convId, t3).mode, 'human');
});

test('on a channel that is not the site the owner reply goes through deliver with the channel reach; a failing deliver says so without throwing', async () => {
  const calls = [];
  let outcome = true;
  const deliver = async (m, text) => {
    calls.push({ id: m.id, channel: m.channel, reach: m.reach, text });
    if (outcome === 'throw') throw new Error('network down');
    return outcome;
  };
  const s = makeShop({ deliver });
  const tg = await s.runner.handleMessage({ channel: 'tg', senderKey: '111', visitorId: 'tg111', ip: 'tg:111', text: 'hi', reach: '555' });
  assert.deepEqual([meta(s, tg.convId).channel, meta(s, tg.convId).reach, meta(s, tg.convId).level], ['tg', '555', 2]);

  assert.deepEqual(await s.inbox.reply(tg.convId, 'Hello Telegram'), { ok: true, mode: 'human', delivered: true });
  assert.deepEqual(calls, [{ id: tg.convId, channel: 'tg', reach: '555', text: 'Hello Telegram' }]);

  outcome = false;
  assert.equal((await s.inbox.reply(tg.convId, 'second')).delivered, false, 'a refusal from the channel');
  outcome = 'throw';
  const thrown = await s.inbox.reply(tg.convId, 'third');
  assert.deepEqual([thrown.ok, thrown.delivered], [true, false], 'a deliver that throws is reported, not raised');
  const owners = logOf(s, tg.convId).filter((e) => e.role === 'owner').map((e) => e.text);
  assert.deepEqual(owners, ['Hello Telegram', 'second', 'third'], 'the words are kept in the conversation even when they could not be sent');

  const before = calls.length;
  const site = await s.runner.handleMessage(msg('hello from the site'));
  assert.deepEqual(await s.inbox.reply(site.convId, 'Hi'), { ok: true, mode: 'human', delivered: true });
  assert.equal(calls.length, before, 'a site visitor reads the words on the page: deliver is not used');

  const long = await s.runner.handleMessage({ channel: 'tg', senderKey: '222', visitorId: 'tg222', ip: 'tg:222', text: 'hi', reach: 'r'.repeat(100) });
  assert.equal(meta(s, long.convId).reach.length, 64, 'the reach is clipped');

  const bare = makeShop();
  const lone = await bare.runner.handleMessage({ channel: 'tg', senderKey: '333', visitorId: 'tg333', ip: 'tg:333', text: 'hi', reach: '9' });
  assert.equal((await bare.inbox.reply(lone.convId, 'anyone?')).delivered, false, 'no deliver at all: not delivered');
});

test('markRead clears the counter, and waiting() counts only taken-over conversations that still have unread messages', async () => {
  const s = makeShop();
  const a = await s.runner.handleMessage(msg('agent mode'));
  const b = await s.runner.handleMessage(msg('human mode, unread'));
  const d = await s.runner.handleMessage(msg('human mode, read'));
  s.inbox.setMode(b.convId, 'human');
  s.inbox.setMode(d.convId, 'human');
  assert.equal(meta(s, a.convId).unread, 1, 'the agent-mode conversation has an unread message but is not waiting');
  assert.equal(s.inbox.waiting(), 2);
  assert.deepEqual(s.inbox.markRead(d.convId), { ok: true });
  assert.equal(meta(s, d.convId).unread, 0);
  assert.equal(s.inbox.waiting(), 1);
  assert.deepEqual(s.inbox.markRead(NO_SUCH), { ok: false, error: 'not_found' });
  s.inbox.markRead(b.convId);
  assert.equal(s.inbox.waiting(), 0);
});
