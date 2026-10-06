// ═════════════════════════════════════════════════════════════════════
// Tests for block-read.mjs: reading a connector block of cordis.patch.yml back into the form's shape,
// and refusing to when the form could not write it back as it was.
//
//   node test-block-read.mjs
//
// The YAML parser is the one that ships with the DSH engine of the machine (js-yaml, with the `!!js`
// tag as DSH reads it). Without an engine (CI) the parsing cases are skipped and say so; the
// expression reader, which needs no parser, still runs.
// ═════════════════════════════════════════════════════════════════════
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readdirSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { valueOfJs, readConnector } from './block-read.mjs'
import { suite } from './lib-test.mjs'

const { ok, done } = suite()

const engineDirs = () => {
  const found = []
  const root = join(homedir(), '.dsh', 'kybernos', 'moteur')
  try { for (const v of readdirSync(root).sort().reverse()) found.push(join(root, v, 'node_modules')) } catch (e) { /* no engine */ }
  found.push('/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules')
  return found.filter((d) => existsSync(join(d, 'js-yaml', 'package.json')) || existsSync(join(d, '@deepseek-ai', 'dsh-app-boot', 'package.json')))
}
let loadYaml = null
if (process.env.NO_DSH_ENGINE !== '1') {
  for (const d of engineDirs()) {
    try {
      const lib = createRequire(join(d, '@deepseek-ai', 'dsh-app-boot', 'package.json'))('js-yaml')
      const jsTag = new lib.Type('tag:yaml.org,2002:js', { kind: 'scalar', resolve: (s) => typeof s === 'string', construct: (s) => ({ __jsExpr: s }) })
      const schema = lib.JSON_SCHEMA.extend(jsTag)
      loadYaml = (text) => lib.load(text, { schema: schema })
      break
    } catch (e) { /* try the next one */ }
  }
}

// ── valueOfJs: the expressions in use ───────────────────────────────────────
const v = (e) => { const r = valueOfJs(e); return r.complex === true ? 'COMPLEX' : r.value }
ok('js: the skill\'s plain form  (process.env.X || \'\')  is $X', v("(process.env.HORLOGE_TOKEN || '')") === '$HORLOGE_TOKEN')
ok('js: what the form writes  "Bearer " + (process.env.X || \'\')  is "Bearer $X"', v('"Bearer " + (process.env.TAVILY_API_KEY || \'\')') === 'Bearer $TAVILY_API_KEY')
ok('js: a reference between two literals', v('"a-" + (process.env.A || \'\') + "-b"') === 'a-$A-b')
ok('js: a bare process.env.X', v('process.env.GITHUB_TOKEN') === '$GITHUB_TOKEN')
ok('js: the template literal DSH\'s own README uses', v('`Bearer ${process.env.MCP_TOKEN}`') === 'Bearer $MCP_TOKEN')
ok('js: bracket access', v("process.env['MY_VAR']") === '$MY_VAR')
ok('js: an escaped quote in a JSON literal', v('"say \\"hi\\" " + (process.env.X || \'\')') === 'say "hi" $X')
ok('js: a call is complex', v('require("fs").readFileSync("/x")') === 'COMPLEX')
ok('js: a ternary is complex', v("process.env.A ? 'x' : 'y'") === 'COMPLEX')
ok('js: a fallback value other than empty is complex (it would be lost)', v("(process.env.X || 'default')") === 'COMPLEX')
ok('js: an unbalanced parenthesis is complex', v("(process.env.X || '')) + 'a'") === 'COMPLEX')
ok('js: a literal that looks like a reference is complex (it could not be told apart)', v('"cost $PRICE"') === 'COMPLEX')
ok('js: a template with another expression is complex', v('`a${1 + 1}b`') === 'COMPLEX')
ok('js: an unclosed string is complex', v('"abc') === 'COMPLEX')
ok('js: nothing is complex', v('') === 'COMPLEX')

if (loadYaml === null) console.log('- skipped, no DSH engine: the parsing cases of readConnector')
else {
  const block = (extra) => ['# connecteur:horloge', '- insert:', '    - id: mcp-client-horloge', "      name: '@deepseek-ai/dsh-mcp-client'", '      config:', '        serverName: horloge', '        transport: stdio', ...(extra || [
    '        command: /opt/homebrew/bin/node # DSH spawns with a scrubbed env',
    '        args:', '          - /home/me/.dsh/mcp/horloge-mcp-server.mjs',
    '        env:', "          HORLOGE_TOKEN: !!js \"(process.env.HORLOGE_TOKEN || '')\"",
    '        toolCallTimeoutMs: 180000', '        failOnStartupError: false', '        reconnect:', '          enabled: true', '          maxAttempts: 10']), '']
  const r = readConnector('horloge', block(), loadYaml)
  ok('a block written by the skill is read in full', r.connecteur !== undefined && r.connecteur.command === '/opt/homebrew/bin/node' && r.connecteur.args.join() === '/home/me/.dsh/mcp/horloge-mcp-server.mjs' && r.connecteur.env.length === 1 && r.connecteur.env[0].name === 'HORLOGE_TOKEN' && r.connecteur.env[0].value === '$HORLOGE_TOKEN', JSON.stringify(r))
  const z = readConnector('horloge', block(['        command: /opt/homebrew/bin/node', '        args: [a.mjs]', '        toolCallTimeoutMs: 600000', '        failOnStartupError: false', '        reconnect: { enabled: true, maxAttempts: 10 }']), loadYaml)
  ok('a longer tool timeout is kept (zcode\'s is 600 s)', z.connecteur !== undefined && z.connecteur.toolCallTimeoutMs === 600000, JSON.stringify(z))
  ok('a block with no timeout line has none (the default applies)', readConnector('horloge', block(['        command: /usr/bin/true']), loadYaml).connecteur.toolCallTimeoutMs === undefined)
  const http = readConnector('tavily', ['# connecteur:tavily', '- insert:', '    - id: mcp-client-tavily', "      name: '@deepseek-ai/dsh-mcp-client'", '      config:', '        serverName: tavily', '        transport: streamable-http', '        url: https://mcp.tavily.com/mcp/', '        headers:', '          "authorization": !!js "\\"Bearer \\" + (process.env.TAVILY_API_KEY || \'\')"', ''], loadYaml)
  ok('an http block gives its url and its headers, a reference as $NAME', http.connecteur !== undefined && http.connecteur.url === 'https://mcp.tavily.com/mcp/' && http.connecteur.headers[0].value === 'Bearer $TAVILY_API_KEY', JSON.stringify(http))
  ok('disabled: true is read', readConnector('horloge', ['# connecteur:horloge', '- insert:', '    - id: mcp-client-horloge', "      name: '@deepseek-ai/dsh-mcp-client'", '      disabled: true', '      config:', '        serverName: horloge', '        transport: stdio', '        command: /usr/bin/true', ''], loadYaml).connecteur.disabled === true)
  const ro = (lines) => readConnector('horloge', lines, loadYaml).readOnly
  ok('read only: a serverName that is not the name (the tools\' names depend on it)', /serverName/.test(ro(block().map((l) => l.replace('serverName: horloge', 'serverName: other')))))
  ok('read only: an option the form does not know (autoApprove)', /autoApprove/.test(ro(block().map((l) => l.replace('toolCallTimeoutMs: 180000', 'autoApprove: true')))))
  ok('read only: failOnStartupError true', /failOnStartupError/.test(ro(block().map((l) => l.replace('failOnStartupError: false', 'failOnStartupError: true')))))
  ok('read only: a non-standard reconnect', /reconnect/.test(ro(block().map((l) => l.replace('maxAttempts: 10', 'maxAttempts: 3')))))
  ok('read only: a computed value', /computed/.test(ro(block().map((l) => l.replace(/!!js .*/, '!!js "require(\'fs\').readFileSync(\'/x\', \'utf8\')"')))))
  ok('read only: an entry key the form does not know', /entry has an option/.test(ro(block().map((l) => l.replace("      name: '@deepseek-ai/dsh-mcp-client'", "      name: '@deepseek-ai/dsh-mcp-client'\n      autoApprove: true")))))
  ok('read only: not an MCP client', /MCP client/.test(ro(block().map((l) => l.replace('@deepseek-ai/dsh-mcp-client', '@x/other')))))
  ok('read only: two entries in one block', /exactly one/.test(ro(block().concat(['    - id: second', "      name: '@x/y'", '']))))
  ok('read only: a block that does not parse', /parse/.test(ro(['# connecteur:horloge', '- insert: [', ''])))
  ok('read only: no parser reachable', readConnector('horloge', block(), null).readOnly === 'no YAML parser is reachable')
  ok('read only: a toolCallTimeoutMs out of range', /range/.test(ro(block().map((l) => l.replace('180000', '5')))))
}
done('Block reader')
