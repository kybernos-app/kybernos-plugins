// A model that follows a script, for tests and for the automatic scenarios: no network, no cost, same port as the real one.
// `handler({ system, messages, tools, call })` returns `{ text, toolCalls?, usage? }`; every call is recorded in `calls`.

export function scriptedModel(handler, { delayMs = 0 } = {}) {
  const calls = [];
  return {
    calls,
    async complete({ system, messages, tools, maxOutputTokens }) {
      const call = { system, messages: structuredClone(messages), tools: structuredClone(tools || []), maxOutputTokens };
      calls.push(call);
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      const out = await handler({ system, messages, tools: tools || [], call: calls.length });
      const toolCalls = (out.toolCalls || []).map((c, i) => ({ id: `t${calls.length}_${i}`, name: c.name, args: c.args === undefined ? {} : c.args }));
      return {
        text: out.text || '',
        toolCalls,
        usage: out.usage === undefined ? { inputTokens: 400, outputTokens: 60 } : out.usage,
        assistant: { role: 'assistant', content: out.text || null, ...(toolCalls.length ? { tool_calls: toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) } : {}) },
      };
    },
  };
}

/** How many tool results the model has already seen in this turn (a simple "which step am I on"). */
export const stepOf = (messages) => messages.filter((m) => m.role === 'tool').length;
export const lastToolResult = (messages) => {
  for (let i = messages.length - 1; i >= 0; i -= 1) if (messages[i].role === 'tool') return messages[i].content;
  return '';
};

/**
 * The dry-run model of `bin/front-desk.mjs --dry-run`: it echoes, and shows the two moves worth seeing without a key or a cost.
 * "my name is Ann" asks to remember a first name (the consent card), "leave a message: ..." leaves one for the shop.
 */
export function dryRunHandler({ messages, tools }) {
  const last = messages.at(-1);
  const has = (n) => tools.some((t) => t.function.name === n);
  if (last.role === 'tool') return { text: '(dry run) Done.' };
  const text = String(last.content).replace(/<\/?visitor>/g, '');
  const name = /my name is (\p{L}{1,30})/iu.exec(text);
  if (name && has('note_visitor')) return { toolCalls: [{ name: 'note_visitor', args: { field: 'first_name', value: name[1] } }] };
  const msg = /leave a message: (.{1,300})/i.exec(text);
  if (msg && has('leave_message')) return { toolCalls: [{ name: 'leave_message', args: { message: msg[1] } }] };
  return { text: `(dry run) You said: ${text.slice(0, 200)}` };
}
