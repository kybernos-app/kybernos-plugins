// The model port: one function, `complete`, over any OpenAI-compatible chat endpoint. The service calls a model directly; it does not
// start `dsh` and holds none of the owner's keys. The key is passed in by the host process and never logged or echoed in an error.

/**
 * `complete({ system, messages, tools, maxOutputTokens, signal })` resolves to
 * `{ text, toolCalls: [{ id, name, args }], usage: { inputTokens, outputTokens } | null, assistant }`.
 * `messages` and `assistant` use the OpenAI shape (role / content / tool_calls / tool_call_id).
 */
export function createOpenAiCompatModel({ baseUrl, apiKey, model, fetchImpl = fetch }) {
  const url = `${String(baseUrl).replace(/\/+$/, '')}/chat/completions`;
  return {
    async complete({ system, messages, tools, maxOutputTokens, signal }) {
      const body = { model, max_tokens: maxOutputTokens, messages: [{ role: 'system', content: system }, ...messages] };
      if (tools && tools.length) { body.tools = tools; body.tool_choice = 'auto'; }
      let res;
      try {
        res = await fetchImpl(url, { method: 'POST', signal, headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body) });
      } catch (e) {
        throw new Error(e && e.name === 'AbortError' ? 'model: timeout' : 'model: network error');
      }
      if (!res.ok) throw new Error(`model: HTTP ${res.status}`);
      const json = await res.json();
      const msg = json && json.choices && json.choices[0] && json.choices[0].message;
      if (!msg) throw new Error('model: empty answer');
      const toolCalls = (msg.tool_calls || []).map((c) => {
        let args;
        try { args = JSON.parse((c.function && c.function.arguments) || '{}'); } catch { args = null; }
        return { id: String(c.id), name: String(c.function && c.function.name), args };
      });
      const u = json.usage;
      return {
        text: typeof msg.content === 'string' ? msg.content : '',
        toolCalls,
        usage: u && Number.isFinite(u.prompt_tokens) && Number.isFinite(u.completion_tokens) ? { inputTokens: u.prompt_tokens, outputTokens: u.completion_tokens } : null,
        assistant: { role: 'assistant', content: msg.content || null, ...(msg.tool_calls && msg.tool_calls.length ? { tool_calls: msg.tool_calls } : {}) },
      };
    },
  };
}
