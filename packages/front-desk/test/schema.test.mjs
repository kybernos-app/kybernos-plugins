import test from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../core/schema.mjs';

const S = { type: 'object', required: ['a'], properties: { a: { type: 'string', minLength: 1, maxLength: 5 }, n: { type: 'integer', minimum: 1, maximum: 3 }, b: { type: 'boolean' }, e: { type: 'string', enum: ['x', 'y'] } } };

test('accepts a good object and cleans strings', () => {
  const r = validate(S, { a: '  hi\u0007 ', n: 2 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { a: 'hi', n: 2 });
});

test('refuses unknown keys, missing keys, wrong types and bounds', () => {
  assert.equal(validate(S, { a: 'x', extra: 1 }).ok, false);
  assert.equal(validate(S, {}).ok, false);
  assert.equal(validate(S, { a: 5 }).ok, false);
  assert.equal(validate(S, { a: 'toolong' }).ok, false);
  assert.equal(validate(S, { a: 'x', n: 4 }).ok, false);
  assert.equal(validate(S, { a: 'x', n: 1.5 }).ok, false);
  assert.equal(validate(S, { a: 'x', b: 'yes' }).ok, false);
  assert.equal(validate(S, { a: 'x', e: 'z' }).ok, false);
  assert.equal(validate(S, null).ok, false);
  assert.equal(validate(S, [1]).ok, false);
});

test('a key named __proto__ or constructor is not a property', () => {
  assert.equal(validate(S, JSON.parse('{"a":"x","__proto__":{"x":1}}')).ok, false);
  assert.equal(validate(S, { a: 'x', constructor: 1 }).ok, false);
});
