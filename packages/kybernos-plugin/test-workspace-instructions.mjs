// Workspace instructions: private store, injection block, optional AGENTS.md section.   node packages/kybernos-plugin/test-workspace-instructions.mjs
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BEGIN, END, MAX_CHARS, cleanText, createWorkspaceInstructions, renderBlock, withSection, workspaceOfSession } from './workspace-instructions.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

// ── pure parts ──────────────────────────────────────────────────────────────
assert.equal(cleanText('  a\r\nb\u0000  '), 'a\nb'); assert.equal(cleanText(42), null); assert.equal(cleanText(''), '')
ok('the text is cleaned: no NUL, LF line ends, trimmed; a non-string is refused')

{
  const a = withSection('# My rules\n\nBe kind.\n', 'Use tabs.')
  assert.ok(a.includes('Be kind.') && a.includes(BEGIN) && a.includes('Use tabs.') && a.endsWith(END + '\n'))
  const b = withSection(a, 'Use spaces.')
  assert.ok(b.includes('Use spaces.') && !b.includes('Use tabs.') && b.split(BEGIN).length === 2, 'a second write replaces, never duplicates')
  const c = withSection(b, '')
  assert.equal(c, '# My rules\n\nBe kind.\n', 'an empty text removes the section and leaves the rest as it was')
  assert.equal(withSection('', 'x'), BEGIN + '\n## Workspace instructions\n\nx\n' + END + '\n')
  assert.equal(withSection(withSection('', 'x'), ''), '', 'a file that only held our section ends empty')
  ok('the AGENTS.md section is inserted, replaced and removed without touching the rest')
}

{
  const b = renderBlock('proj "x"', 'Réponds en français. {{cwd}} and {{ name }}')
  assert.ok(b.includes('workspace "proj \'x\'"') && b.includes('Réponds en français.') && b.includes('more specific'))
  assert.ok(!/\{\{/.test(b), 'no interpolation group survives: an unresolved one fails the prompt assembly')
  ok('the block says it works alongside the account instructions and wins when more specific; {{ }} is broken')
}

assert.equal(workspaceOfSession({ w1: { sessionIds: ['s1', 's2'] }, w2: { sessionIds: ['s3'] } }, 's3'), 'w2')
assert.equal(workspaceOfSession({ w1: { sessionIds: ['s1'] } }, 'zzz'), null)
assert.equal(workspaceOfSession(null, 's1'), null); assert.equal(workspaceOfSession({}, ''), null)
ok('a session is found in its workspace by DSH\'s own table; unknown or malformed gives null')

// ── on a real directory ─────────────────────────────────────────────────────
const home = mkdtempSync(join(tmpdir(), 'kb-wsi-'))
const folder = join(home, 'project')
mkdirSync(folder, { recursive: true })
mkdirSync(join(home, 'storages'), { recursive: true })
const table = { tables: { workspaces: { 'w-1': { path: folder, title: 'Mon projet', sessionIds: ['session-a'] }, 'w-2': { path: join(home, 'gone'), title: 'Gone', sessionIds: ['session-b'] } } } }
writeFileSync(join(home, 'storages', 'workspace.json'), JSON.stringify(table))
let clock = 1000
const wi = createWorkspaceInstructions({ home, now: () => clock })

assert.deepEqual(wi.get('nope'), { ok: false, error: 'unknown-workspace' })
assert.equal(wi.get('w-1').text, ''); assert.equal(wi.get('w-1').title, 'Mon projet'); assert.equal(wi.get('w-1').max, MAX_CHARS)
assert.equal(wi.promptFor('session-a'), '')
ok('before anything is set: no text, no block')

let r = wi.set({ workspaceId: 'w-1', text: '  Toujours répondre en français.  ', alsoAgents: false })
assert.equal(r.ok, true); assert.equal(r.text, 'Toujours répondre en français.')
assert.equal(wi.get('w-1').text, 'Toujours répondre en français.')
assert.ok(wi.promptFor('session-a').includes('Toujours répondre en français.'))
assert.equal(wi.promptFor('session-zzz'), '', 'a session of no workspace gets nothing')
assert.equal(existsSync(join(folder, 'AGENTS.md')), false, 'private by default: nothing is written in the project')
assert.equal(statSync(join(home, 'kybernos', 'workspace-instructions.json')).mode & 0o777, 0o600, 'the private store is 0600')
ok('a text is stored privately (0600), read back, and injected for the sessions of that workspace only; nothing in the project folder')

r = wi.set({ workspaceId: 'w-1', text: 'Toujours répondre en français.', alsoAgents: true })
assert.equal(r.ok, true); assert.equal(r.alsoAgents, true)
const agents = readFileSync(join(folder, 'AGENTS.md'), 'utf8')
assert.ok(agents.includes(BEGIN) && agents.includes('Toujours répondre en français.'))
ok('with the option, the same text is also a marked section of the project\'s AGENTS.md')

writeFileSync(join(folder, 'AGENTS.md'), '# Existing\n\nKeep me.\n\n' + agents)
r = wi.set({ workspaceId: 'w-1', text: 'Nouveau texte.', alsoAgents: true })
const agents2 = readFileSync(join(folder, 'AGENTS.md'), 'utf8')
assert.ok(agents2.includes('Keep me.') && agents2.includes('Nouveau texte.') && !agents2.includes('Toujours répondre') && agents2.split(BEGIN).length === 2)
ok('an existing AGENTS.md keeps its own content; our section is replaced in place')

r = wi.set({ workspaceId: 'w-1', text: 'Nouveau texte.', alsoAgents: false })
assert.ok(!readFileSync(join(folder, 'AGENTS.md'), 'utf8').includes(BEGIN) && readFileSync(join(folder, 'AGENTS.md'), 'utf8').includes('Keep me.'))
assert.equal(wi.get('w-1').alsoAgents, false)
r = wi.set({ workspaceId: 'w-1', text: '', alsoAgents: true })
assert.equal(wi.get('w-1').text, ''); assert.equal(wi.promptFor('session-a'), '')
ok('turning the option off, or clearing the text, takes our section out and keeps the rest')

assert.deepEqual(wi.set({ workspaceId: 'nope', text: 'x' }), { ok: false, error: 'unknown-workspace' })
assert.equal(wi.set({ workspaceId: 'w-1', text: 'x'.repeat(MAX_CHARS + 1) }).error, 'too-long')
assert.equal(wi.set({ workspaceId: 'w-1', text: 12 }).error, 'bad-text')
assert.equal(wi.set({ workspaceId: 'w-1', text: 'x'.repeat(MAX_CHARS) }).ok, true)
ok('an unknown workspace, a text over the limit, and a non-string are refused with a code')

r = wi.set({ workspaceId: 'w-2', text: 'x', alsoAgents: true })
assert.equal(r.ok, false); assert.equal(r.error, 'folder-missing')
assert.equal(wi.get('w-2').text, '', 'when AGENTS.md cannot be written the private copy is not changed either: the screen never lies')
r = wi.set({ workspaceId: 'w-2', text: 'x', alsoAgents: false })
assert.equal(r.ok, true, 'without the option a missing folder is not a problem')
ok('a folder that is gone refuses only the AGENTS.md option, and then changes nothing')

{
  const broken = mkdtempSync(join(tmpdir(), 'kb-wsi-b-'))
  const w2 = createWorkspaceInstructions({ home: broken })
  assert.equal(w2.promptFor('s'), ''); assert.equal(w2.get('x').ok, false)
  mkdirSync(join(broken, 'storages'), { recursive: true }); writeFileSync(join(broken, 'storages', 'workspace.json'), '{not json')
  assert.equal(w2.promptFor('s'), '')
  rmSync(broken, { recursive: true, force: true })
  ok('missing or broken files are « no instructions », never a throw in a turn')
}
rmSync(home, { recursive: true, force: true })

// ── the page and the host wiring (source level: browser module and host entry are not importable here) ─────────
{
  const client = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')
  const index = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.js'), 'utf8')
  assert.ok(/kbt\('kbui\.details'\), kbt\('kbui\.instructions'\), kbt\('kbui\.documents'\)/.test(client), 'an Instructions tab sits right after Details on the workspace page')
  assert.ok(/if \(tab === kbt\('kbui\.instructions'\)\) return h\(KbWsInstructions, \{ ws: ws \}\)/.test(client), 'and shows the editor')
  assert.ok(/'\/workspace-instructions'/.test(client) && /workspaceId: ws\.workspaceId, text: st\.text, alsoAgents: st\.also/.test(client), 'the page sends the workspace id, never a path')
  for (const k of ['kbui.instructions', 'kbwi.head', 'kbwi.lead', 'kbwi.order', 'kbwi.also', 'kbwi.also.sub', 'kbwi.save', 'kbwi.err.too-long', 'kbwi.err.folder-missing', 'kbwi.err.agents-write-failed', 'kbwi.err.generic']) {
    assert.ok(new RegExp("'" + k.replace(/\./g, '\\.') + "': \\{ kybernos: '[^']+', en: '[^']+' \\}").test(client) || new RegExp("'" + k.replace(/\./g, '\\.') + "': \\{ kybernos: '[^\\n]+', en: '[^\\n]+' \\}").test(client), k + ' has both languages')
  }
  assert.ok(/path: '\/kybernos\/workspace-instructions'/.test(index) && /sameOriginStrict\(req\) === false\) return sendJson\(res, 403[^\n]*\n\s*return sendJson\(res, 200, wsInstructions\.get/.test(index), 'the route is guarded on GET too (the text may be private)')
  assert.ok(/name: 'kybernos:workspace-instructions',\s*order: 150,\s*interpolate: false,/.test(index), 'the block rides the system prompt, after memory (130), literal')
  assert.ok(!/engine|patch/i.test(index.slice(index.indexOf("createWorkspaceInstructions({ home"), index.indexOf("createWorkspaceInstructions({ home") + 200)), 'no engine patch')
  ok('the page (tab, editor, no path sent) and the host (guarded route, system prompt block) are wired')
}

console.log('\n' + pass + ' checks passed')
