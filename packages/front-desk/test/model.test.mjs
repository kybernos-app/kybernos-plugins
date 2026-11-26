import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpenAiCompatModel } from '../core/model.mjs';

const KEY = 'sk-test-secret-key-123';

function fakeFetch(handler) {
  const seen = [];
  const fn = async (url, init) => { seen.push({ url, init, body: JSON.parse(init.body) }); return handler(url, init); };
  fn.seen = seen;
  return fn;
}
const ok = (json) => ({ ok: true, status: 200, json: async () => json });
const model = (fetchImpl, baseUrl = 'https://llm.example/v1/') => createOpenAiCompatModel({ baseUrl, apiKey: KEY, model: 'm-1', fetchImpl });
const ask = (m, over = {}) => m.complete({ system: 'sys', messages: [{ role: 'user', content: 'hi' }], tools: [], maxOutputTokens: 100, ...over });

test('sends one chat completion with the key, the model, the system prompt first, and the output cap', async () => {
  const f = fakeFetch(() => ok({ choices: [{ message: { role: 'assistant', content: 'hello' } }], usage: { prompt_tokens: 12, completion_tokens: 3 } }));
  const out = await ask(model(f));
  const { url, init, body } = f.seen[0];
  assert.equal(url, 'https://llm.example/v1/chat/completions');
  assert.equal(init.headers.authorization, `Bearer ${KEY}`);
  assert.equal(body.model, 'm-1');
  assert.equal(body.max_tokens, 100);
  assert.deepEqual(body.messages[0], { role: 'system', content: 'sys' });
  assert.equal(body.tools, undefined, 'no tools field when there is no tool');
  assert.deepEqual([out.text, out.usage], ['hello', { inputTokens: 12, outputTokens: 3 }]);
});

test('tools are sent with tool_choice auto, and tool calls come back parsed', async () => {
  const f = fakeFetch(() => ok({
    choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'leave_message', arguments: '{"message":"hi"}' } }, { id: 'c2', type: 'function', function: { name: 'x', arguments: '{nope' } }] } }],
    usage: { prompt_tokens: 5, completion_tokens: 2 },
  }));
  const tools = [{ type: 'function', function: { name: 'leave_message', parameters: { type: 'object' } } }];
  const out = await ask(model(f), { tools });
  assert.deepEqual(f.seen[0].body.tools, tools);
  assert.equal(f.seen[0].body.tool_choice, 'auto');
  assert.deepEqual(out.toolCalls, [{ id: 'c1', name: 'leave_message', args: { message: 'hi' } }, { id: 'c2', name: 'x', args: null }]);
  assert.equal(out.assistant.tool_calls.length, 2);
  assert.equal(out.text, '');
});

test('a provider that sends no usage gives null, so the runner counts the worst case itself', async () => {
  const out = await ask(model(fakeFetch(() => ok({ choices: [{ message: { content: 'x' } }] }))));
  assert.equal(out.usage, null);
});

test('HTTP errors, empty answers and network failures throw short errors that never carry the key', async () => {
  for (const [name, f, expect] of [
    ['401', () => ({ ok: false, status: 401, json: async () => ({ error: KEY }) }), /HTTP 401/],
    ['500', () => ({ ok: false, status: 500, json: async () => ({}) }), /HTTP 500/],
    ['empty', () => ok({ choices: [] }), /empty answer/],
    ['network', () => { throw new Error(`connect failed with ${KEY}`); }, /network error/],
    ['timeout', () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); }, /timeout/],
  ]) {
    await assert.rejects(() => ask(model(fakeFetch(f))), (e) => { assert.match(e.message, expect, name); assert.ok(!e.message.includes(KEY), `${name}: key leaked`); return true; });
  }
});

test('the abort signal reaches fetch', async () => {
  const ac = new AbortController();
  const f = fakeFetch(() => ok({ choices: [{ message: { content: 'x' } }] }));
  await ask(model(f), { signal: ac.signal });
  assert.equal(f.seen[0].init.signal, ac.signal);
});
