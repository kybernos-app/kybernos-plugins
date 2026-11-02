import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseGuardrails, HARD } from '../core/guardrails.mjs';

test('defaults are conservative: only answering, leaving a message and the visitor\'s own memory', () => {
  const { value } = normaliseGuardrails(undefined);
  assert.deepEqual(Object.keys(value.actions).sort(), ['forget_visitor', 'leave_message', 'note_visitor']);
  assert.equal(value.enabled, true);
  assert.equal(value.budget.dailyCapMicro, 2_000_000);
});

test('an action outside the menu is dropped with a warning; a bad mode turns the action off', () => {
  const { value, warnings } = normaliseGuardrails({ actions: { delete_everything: 'auto', book_appointment: 'yolo', list_slots: 'approve' } });
  assert.equal(value.actions.delete_everything, undefined);
  assert.equal(value.actions.book_appointment, 'off');
  assert.equal(value.actions.list_slots, 'approve');
  assert.equal(warnings.length, 2);
});

test('every number is clamped to its hard ceiling', () => {
  const huge = Object.fromEntries(Object.keys(HARD).filter((k) => !['dailyCap', 'visitorDailyCap'].includes(k)).map((k) => [k, 1e9]));
  const { value, warnings } = normaliseGuardrails({ budget: { dailyCap: 1e9, visitorDailyCap: 1e9 }, limits: huge });
  assert.equal(value.budget.dailyCapMicro, HARD.dailyCap * 1e6);
  assert.equal(value.budget.visitorDailyCapMicro, HARD.visitorDailyCap * 1e6);
  for (const k of Object.keys(huge)) assert.equal(value.limits[k], HARD[k], k);
  assert.ok(warnings.length >= 10);
});

test('nonsense values fall back to defaults, never to zero or NaN', () => {
  const { value } = normaliseGuardrails({ budget: { dailyCap: 'lots', inPerMTok: NaN }, limits: { maxOutputTokens: null, perIpPerMin: -5 } });
  assert.equal(value.budget.dailyCapMicro, 2_000_000);
  assert.ok(value.budget.inPerToken > 0);
  assert.equal(value.limits.maxOutputTokens, 400);
  assert.equal(value.limits.perIpPerMin, 1);
});

test('only well-formed origins are kept; enabled is on unless explicitly false', () => {
  const { value } = normaliseGuardrails({ allowedOrigins: ['https://shop.example', 'javascript:alert(1)', 'https://a.example/path'], enabled: false });
  assert.deepEqual(value.allowedOrigins, ['https://shop.example']);
  assert.equal(value.enabled, false);
});
