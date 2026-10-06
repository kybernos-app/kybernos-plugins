// ═════════════════════════════════════════════════════════════════════
// Tests for the connectors route beyond saving: reading what the skill wrote in full, editing it,
// renaming, what is "to apply", the connector Test route, and the folders commands may run from.
//
//   node test-connecteurs.mjs
//
// Every write goes to a temp HOME. The parser DSH uses is the engine's js-yaml when this machine has one
// (the parsing cases are skipped, and say so, without it).
// ═════════════════════════════════════════════════════════════════════
import { mkdtempSync, writeFileSync, chmodSync, symlinkSync, rmSync, existsSync, statSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { suite, startHost, fakeHttpMcp, fakeStdioScript, engineYaml } from './lib-test.mjs'
import { readConnector } from './block-read.mjs'
import { patchBlocks } from './index.js'

const { ok, done } = suite()
const yaml = engineYaml()
const NODE = process.execPath

const scratch = mkdtempSync(join(tmpdir(), 'kb-conn-scratch-'))
const fakeScript = fakeStdioScript(scratch)

const SKILL_PATCH = (extraBlocks) => [
  '- id: other-entry', "  name: '@x/y'", '  config: {}', '',
  '# ── CONNECTEURS PERSONNALISÉS (géré par la skill connecteur-personnalise) ────', '',
  '# connecteur:horloge', '- insert:', '    - id: mcp-client-horloge', "      name: '@deepseek-ai/dsh-mcp-client'", '      config:', '        serverName: horloge', '        transport: stdio',
  '        command: ' + NODE + ' # DSH spawns with a scrubbed env', '        args:', '          - ' + fakeScript,
  '        env:', "          FAKE_TOKEN: !!js \"(process.env.FAKE_TOKEN || '')\"", '        toolCallTimeoutMs: 180000', '        failOnStartupError: false', '        reconnect:', '          enabled: true', '          maxAttempts: 10', '',
  '# connecteur:zcode', '- insert:', '    - id: mcp-client-zcode', "      name: '@deepseek-ai/dsh-mcp-client'", '      config:', '        serverName: zcode', '        transport: stdio', '        command: /opt/homebrew/bin/node', '        args:', '          - /home/me/.dsh/mcp/zcode-mcp-server.mjs',
  '        # aucun secret ici', '        toolCallTimeoutMs: 600000', '        failOnStartupError: false', '        reconnect:', '          enabled: true', '          maxAttempts: 10', '',
  '# connecteur:weird', '- insert:', '    - id: mcp-client-weird', "      name: '@deepseek-ai/dsh-mcp-client'", '      config:', '        serverName: weird', '        transport: stdio', '        command: /usr/bin/true', '        autoApprove: true', '',
  ...(extraBlocks || []), '- id: kybernos-computers', '  disabled: false', ''].join('\n')

if (yaml === null) console.log('(no DSH engine: the cases that read the blocks back are skipped)')

// ── reading what the skill wrote ────────────────────────────────────────────
{
  const h = await startHost({ before: ({ patch }) => { writeFileSync(patch, SKILL_PATCH()) } })
  const g = await h.call('/kybernos/composio/connecteurs')
  const by = (n) => (g.json.connecteurs || []).find((c) => c.nom === n)
  ok('GET lists the three blocks of the skill', g.code === 200 && g.json.connecteurs.length === 3, g.text.slice(0, 100))
  if (yaml !== null) {
    const hor = by('horloge')
    ok('a block of the skill is read in full: command, arguments, env as $NAME', hor.editable === true && hor.source === 'skill' && hor.command === NODE && hor.args[0] === fakeScript && hor.env[0].name === 'FAKE_TOKEN' && hor.env[0].value === '$FAKE_TOKEN', JSON.stringify(hor).slice(0, 200))
    ok('...with its own tool timeout', by('zcode').toolCallTimeoutMs === 600000)
    ok('a block with an option the form does not know is read only, with the reason', by('weird').editable === false && /autoApprove/.test(by('weird').readOnlyReason) && by('weird').command === '/usr/bin/true')
    ok('the secret a connector refers to says whether it has a value, never the value', hor.secretsSet.FAKE_TOKEN === false && g.text.includes('FAKE_TOKEN') && !/good|ck_/.test(g.text))
  } else ok('without a parser the blocks stay listed, read only, with the reason', by('horloge').editable === false && /parser/.test(by('horloge').readOnlyReason))
  ok('the list says which contract it speaks (the page refuses to save through an older host)', g.json.api === 2 && h.mod.API_VERSION === 2)
  ok('without DSH\'s services the page is told there is no live state (not that nothing is loaded)', g.json.live === false && g.json.connecteurs.every((c) => c.live === null))
  ok('the folders commands may run from are reported', g.json.roots.base.includes('/opt/homebrew/bin') && Array.isArray(g.json.roots.extra))
  h.stop()
}

// ── editing it, renaming it, deleting it ────────────────────────────────────
if (yaml !== null) {
  const h = await startHost({ before: ({ patch }) => { writeFileSync(patch, SKILL_PATCH()) } })
  const get = async () => (await h.call('/kybernos/composio/connecteurs')).json
  const form = { nom: 'zcode', transport: 'stdio', command: NODE, args: ['/home/me/.dsh/mcp/zcode-mcp-server.mjs', '--verbose'], toolCallTimeoutMs: 600000, env: [], secrets: [] }
  // NODE is outside the system roots on some machines; the folders route is the way in, tested below. Here: a root-listed command.
  const form2 = Object.assign({}, form, { command: '/usr/bin/true' })
  const save = await h.call('/kybernos/composio/connecteurs', { method: 'POST', body: form2 })
  ok('editing a block of the skill saves it (it becomes the form\'s)', save.code === 200 && save.json.ok === true, save.text.slice(0, 160))
  const z = (await get()).connecteurs.find((c) => c.nom === 'zcode')
  ok('...it is now a form connector, with its timeout kept', z.source === 'form' && z.toolCallTimeoutMs === 600000 && z.args.includes('--verbose'), JSON.stringify(z).slice(0, 160))
  const patch = h.files.read('patch')
  const back = readConnector('zcode', patchBlocks(patch).zcode, yaml.load)
  ok('...and the block on disk reads back to what was saved', back.connecteur !== undefined && back.connecteur.command === '/usr/bin/true' && back.connecteur.toolCallTimeoutMs === 600000 && back.connecteur.args.join() === form2.args.join(), JSON.stringify(back).slice(0, 160))
  ok('...the other blocks and entries were not touched', patch.includes('# connecteur:horloge') && patch.includes('autoApprove: true') && patch.includes('- id: kybernos-computers'))

  // the enabled flag and the tool timeout
  const off = await h.call('/kybernos/composio/connecteurs', { method: 'POST', body: Object.assign({}, form2, { disabled: true, toolCallTimeoutMs: 90000 }) })
  const pOff = h.files.read('patch')
  ok('disabled: true is written as the loader reads it, and the timeout with it', off.code === 200 && /mcp-client-zcode\n\s+name: '@deepseek-ai\/dsh-mcp-client'\n\s+disabled: true/.test(pOff) && /toolCallTimeoutMs: 90000/.test(pOff))
  const backOff = readConnector('zcode', patchBlocks(pOff).zcode, yaml.load)
  ok('...and it reads back as disabled', backOff.connecteur !== undefined && backOff.connecteur.disabled === true && backOff.connecteur.toolCallTimeoutMs === 90000)
  ok('...a timeout out of range is refused', (await h.call('/kybernos/composio/connecteurs', { method: 'POST', body: Object.assign({}, form2, { toolCallTimeoutMs: 5 }) })).code === 400)
  await h.call('/kybernos/composio/connecteurs', { method: 'POST', body: form2 })
  ok('...enabling it again drops the flag', !/disabled: true/.test(h.files.read('patch').slice(h.files.read('patch').indexOf('# connecteur:zcode'), h.files.read('patch').indexOf('# connecteur:weird'))))

  // rename
  const ren = await h.call('/kybernos/composio/connecteurs', { method: 'POST', body: { nom: 'chrono', renameFrom: 'horloge', transport: 'stdio', command: '/usr/bin/true', args: [], env: [{ name: 'FAKE_TOKEN', value: '$FAKE_TOKEN' }], secrets: [{ name: 'FAKE_TOKEN', value: 'good' }] } })
  ok('a rename answers ok and says where it came from', ren.code === 200 && ren.json.renamedFrom === 'horloge', ren.text.slice(0, 120))
  const after = await get()
  ok('...the old name is gone, the new one is there', !after.connecteurs.some((c) => c.nom === 'horloge') && after.connecteurs.some((c) => c.nom === 'chrono'))
  const p2 = h.files.read('patch')
  ok('...in the patch the old block is gone and the new one is there once', !p2.includes('# connecteur:horloge') && !p2.includes('mcp-client-horloge') && p2.split('# connecteur:chrono').length === 2)
  ok('...the secret typed with it is in the .env, and the new connector says it is set', /FAKE_TOKEN=/.test(h.files.read('env') || '') && after.connecteurs.find((c) => c.nom === 'chrono').secretsSet.FAKE_TOKEN === true)
  const clash = await h.call('/kybernos/composio/connecteurs', { method: 'POST', body: { nom: 'chrono', renameFrom: 'zcode', transport: 'stdio', command: '/usr/bin/true' } })
  ok('a rename onto a name that exists is refused (it would replace that connector)', clash.code === 409 && /already exists/.test(clash.json.error), clash.text.slice(0, 100))
  const none = await h.call('/kybernos/composio/connecteurs', { method: 'POST', body: { nom: 'neuf', renameFrom: 'ghost', transport: 'stdio', command: '/usr/bin/true' } })
  ok('a rename from a name that does not exist is a 404', none.code === 404, none.text.slice(0, 100))
  ok('...and neither refusal changed the patch', h.files.read('patch') === p2)

  // delete
  const del = await h.call('/kybernos/composio/connecteurs?nom=zcode', { method: 'DELETE' })
  ok('deleting a connector removes its block and says so', del.code === 200 && del.json.removed === true && !h.files.read('patch').includes('mcp-client-zcode') && !(await get()).connecteurs.some((c) => c.nom === 'zcode'))
  ok('...the response no longer claims a restart is needed (DSH reloads the patch itself)', del.json.needRestart === undefined && save.json.needRestart === undefined)
  h.stop()
} else console.log('- skipped, no DSH engine: edit, rename and delete of the skill\'s blocks')

// ── what DSH says about each connector ──────────────────────────────────────
{
  const inventory = { list: async () => ({ entries: [
    { entryId: 'include:mcp-client-horloge', moduleName: '@deepseek-ai/dsh-mcp-client', enabled: true, fiberPhase: 'active' },
    { entryId: 'include:mcp-client-zcode', moduleName: '@deepseek-ai/dsh-mcp-client', enabled: true, fiberPhase: 'failed' },
    { entryId: 'include:mcp-client-weird', moduleName: '@deepseek-ai/dsh-mcp-client', enabled: false, fiberPhase: null },
    { entryId: 'include:not-a-connector', enabled: true, fiberPhase: 'active' },
  ], agentPresets: [], managementAvailable: true }) }
  const tools = { schemas: () => [{ name: 'mcp__horloge__now' }, { name: 'mcp__horloge__zone' }, { name: 'mcp__horloge2__x' }, { name: 'read_file' }] }
  const h = await startHost({ services: { pluginInventory: inventory, tools: tools }, before: ({ patch }) => { writeFileSync(patch, SKILL_PATCH()) } })
  const g = (await h.call('/kybernos/composio/connecteurs')).json
  const live = (n) => g.connecteurs.find((c) => c.nom === n).live
  ok('live: a loaded connector says its phase and how many tools it registered (and only its own: mcp__horloge2__ is another)', g.live === true && live('horloge').loaded === true && live('horloge').phase === 'active' && live('horloge').tools === 2, JSON.stringify(live('horloge')))
  ok('live: a connector whose entry failed to load says so', live('zcode').phase === 'failed' && live('zcode').tools === 0)
  ok('live: a disabled entry is loaded:true, enabled:false', live('weird').enabled === false)
  ok('live: a block DSH has not loaded (yet) is loaded:false', (await (async () => { await h.call('/kybernos/composio/connecteurs', { method: 'POST', body: { nom: 'neuf', transport: 'stdio', command: '/usr/bin/true' } }); return (await h.call('/kybernos/composio/connecteurs')).json.connecteurs.find((c) => c.nom === 'neuf').live })()).loaded === false)
  h.stop()
  // services that fail must never fail the route
  const bad = await startHost({ services: { pluginInventory: { list: async () => { throw new Error('boom') } }, tools: { schemas: () => { throw new Error('boom') } } }, before: ({ patch }) => { writeFileSync(patch, SKILL_PATCH()) } })
  const r = await bad.call('/kybernos/composio/connecteurs')
  ok('live: an inventory that throws is "no live state", not an error', r.code === 200 && r.json.live === false)
  bad.stop()
}

// ── the Test route ──────────────────────────────────────────────────────────
{
  const fh = await fakeHttpMcp()
  const h = await startHost({ before: ({ patch }) => { writeFileSync(patch, SKILL_PATCH()) } })
  const T = '/kybernos/composio/connecteurs/test'
  const post = (body, headers) => h.call(T, { method: 'POST', body, headers })

  // a draft over http, secrets typed in the form and not saved
  fh.state.mode = 'auth'
  const draft = { nom: 'brouillon', transport: 'streamable-http', url: fh.url, headers: [{ name: 'authorization', value: 'Bearer $DRAFT_KEY' }], secrets: [{ name: 'DRAFT_KEY', value: 'good' }] }
  let r = await post(draft)
  ok('test: a draft over http is run with the secret typed in the form', r.code === 200 && r.json.result.ok === true && r.json.result.tools.length === 2, r.text.slice(0, 160))
  ok('...and nothing was saved: no .env, no sidecar, no patch change', h.files.read('env') === null && h.files.read('sidecar') === null && !(h.files.read('patch') || '').includes('brouillon'))
  r = await post(Object.assign({}, draft, { secrets: [] }))
  ok('test: a secret with no value anywhere is named, and the server\'s refusal is a 401', r.json.result.ok === false && r.json.result.code === '401' && r.json.missing.join() === 'DRAFT_KEY', r.text.slice(0, 160))
  r = await post(Object.assign({}, draft, { secrets: [{ name: 'DRAFT_KEY', value: 'wrong-value' }] }))
  ok('test: a wrong key is a 401 that does not echo the key', r.json.result.code === '401' && !r.text.includes('wrong-value'))
  fh.state.mode = 'rpcerr'
  r = await post(Object.assign({}, draft, { secrets: [{ name: 'DRAFT_KEY', value: 'secret-abc-123' }], headers: [{ name: 'x-k', value: '$DRAFT_KEY' }] }))
  ok('test: a server that echoes the secret back has it redacted in the answer', r.json.result.code === 'rpc-error' && !r.text.includes('secret-abc-123') && r.text.includes('***'), r.text.slice(0, 200))
  fh.state.mode = 'normal'

  // a saved connector over http, its secret in the .env
  const saved = await h.call('/kybernos/composio/connecteurs', { method: 'POST', body: { nom: 'distant', transport: 'streamable-http', url: fh.url, headers: [{ name: 'x-key', value: '$REMOTE_KEY' }], secrets: [{ name: 'REMOTE_KEY', value: 'k-from-env-file' }] } })
  ok('(setup) a saved http connector', saved.code === 200, saved.text.slice(0, 100))
  fh.state.seen.length = 0
  r = await post({ nom: 'distant' })
  ok('test: a saved connector is run with the secret from the .env', r.json.result.ok === true && fh.state.seen[0].headers['x-key'] === 'k-from-env-file' && r.json.missing.length === 0, r.text.slice(0, 160))

  // a saved stdio connector written by the skill: tested as DSH would start it
  if (yaml !== null) {
    r = await post({ nom: 'horloge' })
    ok('test: a connector of the skill is run as DSH starts it, outside the form\'s folder rule', r.json.result.ok === true && r.json.result.tools.some((t) => t.name === 'ping'), r.text.slice(0, 200))
    ok('...its missing secret is reported (FAKE_TOKEN is in no .env)', r.json.missing.join() === 'FAKE_TOKEN', JSON.stringify(r.json.missing))
  }
  r = await post({ nom: 'inconnu' })
  ok('test: an unknown saved connector is a 404', r.code === 404)
  r = await post(Object.assign({}, draft, { transport: 'stdio', command: '/tmp/not-allowed/bin', url: undefined }))
  ok('test: a draft whose command is outside the accepted folders is refused like a save, with help', r.code === 400 && r.json.code === 'command-refused' && Array.isArray(r.json.help), r.text.slice(0, 160))
  ok('test: hostile origin -> 403', (await post(draft, { origin: 'http://evil.example' })).code === 403)
  ok('test: text/plain -> 415', (await post(draft, { 'content-type': 'text/plain' })).code === 415)
  ok('test: GET -> 405', (await h.call(T)).code === 405)
  ok('test: a body that is not JSON -> 400', (await h.call(T, { method: 'POST', raw: '{nope' })).code === 400)
  fh.close(); h.stop()
}

// ── the folders commands may run from ───────────────────────────────────────
{
  const h = await startHost()
  const C = '/kybernos/composio/connecteurs/commande'
  const TMP = realpathSync(tmpdir())
  const dir = mkdtempSync(join(TMP, 'kb-roots-'))
  const launcher = join(dir, 'mylauncher')
  writeFileSync(launcher, '#!/bin/sh\nexec "' + NODE + '" "$@"\n')
  chmodSync(launcher, 0o755); chmodSync(dir, 0o755)
  const draft = { nom: 'viauvx', transport: 'stdio', command: launcher, args: [fakeScript] }
  let r = await h.call('/kybernos/composio/connecteurs/test', { method: 'POST', body: draft })
  ok('folders: a command in a folder nobody confirmed is refused, and the help says where it is', r.code === 400 && r.json.code === 'command-refused', r.text.slice(0, 120))
  r = await h.call(C + '?command=mylauncher')
  ok('folders: GET help finds a program in PATH-like places only (this one is nowhere yet)', r.code === 200 && Array.isArray(r.json.help) && !r.json.help.some((x) => x.path === launcher))
  for (const [label, bad] of [['a relative folder', 'bin'], ['the root', '/'], ['a folder that is too broad', TMP], ['a folder that does not exist', join(dir, 'nope')], ['a path with ..', dir + '/../' + 'x']]) {
    r = await h.call(C, { method: 'POST', body: { dir: bad } })
    ok('folders: refuses ' + label, r.code === 400, r.text.slice(0, 100))
  }
  const loose = mkdtempSync(join(TMP, 'kb-roots-loose-')); chmodSync(loose, 0o777)
  ok('folders: refuses a folder others can write in', (await h.call(C, { method: 'POST', body: { dir: loose } })).code === 400)
  const real = mkdtempSync(join(TMP, 'kb-roots-real-')); const link = join(scratch, 'link'); symlinkSync(real, link)
  ok('folders: refuses a link to a folder', (await h.call(C, { method: 'POST', body: { dir: link } })).code === 400)
  ok('folders: a hostile origin -> 403, text/plain -> 415', (await h.call(C, { method: 'POST', body: { dir }, headers: { origin: 'http://evil.example' } })).code === 403 && (await h.call(C, { method: 'POST', body: { dir }, headers: { 'content-type': 'text/plain' } })).code === 415)

  r = await h.call(C, { method: 'POST', body: { dir } })
  ok('folders: a clean folder is accepted and listed', r.code === 200 && r.json.roots.extra.includes(dir), r.text.slice(0, 120))
  ok('folders: it is written privately', existsSync(join(h.dsh, 'kybernos', 'connecteurs-roots.json')) && (statSync(join(h.dsh, 'kybernos', 'connecteurs-roots.json')).mode & 0o077) === 0)
  r = await h.call(C + '?command=mylauncher')
  ok('folders: help now finds the program and says its folder is accepted', r.json.help.some((x) => x.path === launcher && x.allowed === true), r.text.slice(0, 160))
  r = await h.call('/kybernos/composio/connecteurs/test', { method: 'POST', body: draft })
  ok('folders: a draft with a command in that folder is now tested (it starts a real process)', r.code === 200 && r.json.result.ok === true && r.json.result.tools.some((t) => t.name === 'ping'), r.text.slice(0, 200))
  const sv = await h.call('/kybernos/composio/connecteurs', { method: 'POST', body: draft })
  ok('folders: ...and saved', sv.code === 200, sv.text.slice(0, 100))
  chmodSync(dir, 0o777)
  r = await h.call('/kybernos/composio/connecteurs/test', { method: 'POST', body: draft })
  ok('folders: a folder that becomes writable by others stops being trusted at once', r.code === 400, r.text.slice(0, 100))
  chmodSync(dir, 0o755)
  r = await h.call(C + '?dir=' + encodeURIComponent(dir), { method: 'DELETE' })
  ok('folders: DELETE removes it', r.code === 200 && !r.json.roots.extra.includes(dir))
  r = await h.call('/kybernos/composio/connecteurs/test', { method: 'POST', body: draft })
  ok('folders: ...and the command is refused again', r.code === 400)
  for (const d of [dir, loose, real]) { try { chmodSync(d, 0o755); rmSync(d, { recursive: true, force: true }) } catch (e) { /* gone */ } }
  h.stop()
}
rmSync(scratch, { recursive: true, force: true })
done('Connectors route')
