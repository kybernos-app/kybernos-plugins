// The JSON-RPC half of a minimal MCP server: pure, no I/O, no DSH. The HTTP half is door-http.mjs, the tools are tools.mjs.
//
// It speaks the Streamable HTTP transport in its simplest form: one JSON-RPC message in, one JSON message out (or nothing for a notification), no session id, no server-initiated
// stream. `initialize`, `ping`, `tools/list` and `tools/call` are answered; any other request is « method not found ». A tool whose arguments are wrong, or that fails, answers with a
// result marked `isError`, so that the assistant reads the reason and corrects itself, instead of a protocol error it cannot see. An error never carries a stack or a path.

export const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']

const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result })
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id === undefined ? null : id, error: { code, message } })

/** A tool's answer as MCP wants it: the data twice, as text for a model that reads text and as `structuredContent` for one that reads fields. */
const toolResult = (out) => {
  const data = out !== null && typeof out === 'object' && out.data !== undefined ? out.data : {}
  return {
    content: [{ type: 'text', text: typeof out.text === 'string' ? out.text : JSON.stringify(data, null, 2) }],
    structuredContent: data,
    ...(out.isError === true ? { isError: true } : {}),
  }
}
const refused = (message) => ({ content: [{ type: 'text', text: String(message).slice(0, 500) }], isError: true })

/**
 * @param info          `{ name, version }` of this server
 * @param instructions  a few sentences the assistant reads once, at `initialize`
 * @param tools         `[{ name, title, description, inputSchema, annotations?, parse(args) → { ok, value | error }, run(value) → Promise<{ data, text?, isError? }> }]`
 */
export function createMcp ({ info, instructions = '', tools }) {
  const byName = new Map(tools.map((t) => [t.name, t]))
  const listed = tools.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, ...(annotations === undefined ? {} : { annotations }) }))

  const callTool = async (id, params) => {
    const tool = params !== null && typeof params === 'object' && typeof params.name === 'string' ? byName.get(params.name) : undefined
    if (tool === undefined) return rpcError(id, -32602, 'unknown tool')
    const given = params.arguments === undefined ? {} : params.arguments
    if (given === null || typeof given !== 'object' || Array.isArray(given)) return rpcResult(id, refused('The arguments must be an object.'))
    const parsed = tool.parse(given)
    if (parsed.ok !== true) return rpcResult(id, refused(parsed.error))
    try {
      return rpcResult(id, toolResult(await tool.run(parsed.value)))
    } catch (e) {
      return rpcResult(id, refused('The tool failed.'))
    }
  }

  return {
    /** One message in; the answer, or null when none is due (a notification, or a reply the client sent to us). */
    async handle (message) {
      if (message === null || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0') return rpcError(null, -32600, 'invalid request')
      const hasId = message.id !== undefined && message.id !== null
      if (typeof message.method !== 'string') return null
      if (!hasId) return null
      const { id, method, params } = message
      if (method === 'initialize') {
        const asked = params !== null && typeof params === 'object' ? params.protocolVersion : undefined
        return rpcResult(id, {
          protocolVersion: PROTOCOLS.indexOf(asked) >= 0 ? asked : PROTOCOLS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: info.name, version: info.version },
          ...(instructions === '' ? {} : { instructions }),
        })
      }
      if (method === 'ping') return rpcResult(id, {})
      if (method === 'tools/list') return rpcResult(id, { tools: listed })
      if (method === 'tools/call') return callTool(id, params)
      return rpcError(id, -32601, 'method not found')
    },
  }
}
