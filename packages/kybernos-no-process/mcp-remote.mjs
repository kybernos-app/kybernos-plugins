// Stand-in for a REMOTE MCP server (what a cloud computer would host): the same door code, run as a separate process on the Mac.
import { createDoor } from './mcp-door.mjs'
const [port, token, file] = [Number(process.argv[2]), process.argv[3], process.argv[4]]
const d = await createDoor({ port, token, servers: { horloge: { file } } })
console.log('remote MCP stand-in on 127.0.0.1:' + d.port)
