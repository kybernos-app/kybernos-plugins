// Workers — host logic, routes and real I/O, played without DSH.
//   node packages/kybernos-workers/test-host.mjs
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, delimiter } from 'node:path'
import { Readable } from 'node:stream'
import { execFileSync } from 'node:child_process'
import {
  WORKERS, trouverWorker, analyserPatch, etatProfil, blocOutil, calculerPolitique, calculerActivation, blocActivation,
  lireAuthJson, lireAuthCompte, lireAuthHermes, verifier, statutGlobal, monterWorkers, sansAnsi, ajouterAuJournal,
  nomsDeConnexion, paquetAChercher
} from './workers-host.mjs'
import { apply, envSansSecrets, trouverBinaire, worktreeJetable, workersDeps, lancerInstallation } from './index.js'

let failures = 0
let total = 0
const ok = (name, cond, detail) => { total++; if (cond) console.log('  ✓ ' + name); else { failures++; console.log('  ✗ ' + name + (detail !== undefined ? ' — ' + detail : '')) } }
const claude = trouverWorker('claude-code')
const codex = trouverWorker('codex')
const gemini = trouverWorker('gemini')
const opencode = trouverWorker('opencode')
const qwen = trouverWorker('qwen')
const hermes = trouverWorker('hermes')
const zcode = trouverWorker('zcode')

// A patch shaped like the one the Tools page writes (see KB_TOOLS_CATALOG in kybernos-plugin).
const PATCH = `# Profile patch — written by the Tools tab (Kybers).

# ── Tools · Codex — added 20260930-101500 by the Tools tab (Kybers)
# Rollback: restore cordis.patch.yml.bak-outils-codex-20260930-101500.
- insert:
    - id: codex
      name: '@deepseek-ai/dsh-subagent-codex'

# ── Tools · ZCode — added 20260930-102000 by the Tools tab (Kybers)
- insert:
    - id: mcp-client-zcode
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: zcode
        transport: stdio
        command: /usr/local/bin/node # DSH starts with a clean env
        args:
          - /Users/x/.dsh/mcp/zcode-mcp-server.mjs
        toolCallTimeoutMs: 600000
        failOnStartupError: false
        reconnect:
          enabled: true
          maxAttempts: 10
`
// What a hand-mounted home-made provider looks like in the real profile (double-quoted name).
const PATCH_AVEC_GEMINI = PATCH + `
- insert:
    - id: subagent-gemini
      name: "dsh-subagent-gemini"
`
// The same connector the way the Suite mounts it: a subpath of the shared package.
const PATCH_GEMINI_MAISON = PATCH + `
- insert:
    - id: subagent-gemini
      name: "@local/dsh-subagent-maison/gemini"
`

console.log('── reading the patch ──')
{
  const items = analyserPatch(PATCH)
  ok('2 entries recognised, in order', items.map((i) => i.id).join() === 'codex,mcp-client-zcode')
  ok('the package name is read without quotes', items[0].champs.name === '@deepseek-ai/dsh-subagent-codex')
  const z = items[1]
  ok('config scalars read, trailing comment removed', z.config.serverName === 'zcode' && z.config.command === '/usr/local/bin/node')
  ok('the args list ("- …" lines) is not taken for an entry', items.length === 2)
  ok('commented lines are ignored', analyserPatch('# - id: x\n#   name: y\n').length === 0)
  ok('empty / null text → no entry', analyserPatch('').length === 0 && analyserPatch(null).length === 0)
  ok('a double-quoted package name is read like a single-quoted one', analyserPatch(PATCH_AVEC_GEMINI).at(-1).champs.name === 'dsh-subagent-gemini')
}

console.log('── profile state ──')
{
  ok('Codex mounted, Claude Code not', etatProfil(PATCH, codex).connexion === true && etatProfil(PATCH, claude).connexion === false)
  ok('ZCode recognised by its connector id', etatProfil(PATCH, zcode).connexion === true)
  ok('ZCode also recognised by serverName when the id differs', etatProfil(PATCH.replace('mcp-client-zcode', 'other-id'), zcode).connexion === true)
  ok('a home-made provider is mounted when its package name is in the patch', etatProfil(PATCH_AVEC_GEMINI, gemini).connexion === true && etatProfil(PATCH, gemini).connexion === false)
  ok('no tool line when there is none', etatProfil(PATCH, codex).ligne === null)
  const foreign = PATCH + `
- insert:
    - id: my-tool-codex
      name: '@deepseek-ai/dsh-tool-subagent'
      disabled: true
      config:
        provider: codex
        toolName: subagent_codex
        enableRunInBackground: true
        maxDepth: provider-managed
`
  const l = etatProfil(foreign, codex).ligne
  ok('tool line by someone else: read, flagged "not ours"', l !== null && l.nous === false && l.expose === false && l.arrierePlan === true && l.id === 'my-tool-codex')
  ok('a commented line does not exist', etatProfil(PATCH + '# - id: x\n#   name: \'@deepseek-ai/dsh-tool-subagent\'\n', codex).ligne === null)
}

console.log('── policy: computing the new patch ──')
{
  const A = (o) => calculerPolitique({ worker: codex, texte: PATCH, horodatage: '20261003-120000', ...o })
  const ajout = A({ expose: true, arrierePlan: false })
  ok('add: the line is written after the rest, nothing else moves', ajout.ok && ajout.action === 'ajout' && ajout.apres.startsWith(PATCH))
  const relu = etatProfil(ajout.apres, codex).ligne
  ok('read back: ours, exposed, no background, depth left to the provider', relu.nous && relu.expose && !relu.arrierePlan && relu.profondeur === 'provider-managed' && relu.nomOutil === 'subagent_codex')
  ok('the block names the rollback backup', ajout.apres.includes('bak-workers-codex-20261003-120000'))
  ok('add with expose=false writes "disabled: true"', calculerPolitique({ worker: codex, texte: PATCH, expose: false, arrierePlan: false, horodatage: 'x' }).apres.includes('disabled: true'))
  const sansNl = calculerPolitique({ worker: codex, texte: PATCH.trimEnd(), expose: true, arrierePlan: false, horodatage: 'x' })
  ok('text without a final newline: the block is not glued to the last line', sansNl.ok && /maxAttempts: 10\n\n# ── Workers/.test(sansNl.apres))
  const modif = calculerPolitique({ worker: codex, texte: ajout.apres, expose: true, arrierePlan: true, horodatage: 'y' })
  ok('edit: background on', modif.ok && modif.action === 'modification' && etatProfil(modif.apres, codex).ligne.arrierePlan === true)
  ok('edit: the rest of the file is identical, word for word', modif.apres.replace('enableRunInBackground: true', 'enableRunInBackground: false') === ajout.apres)
  const coupe = calculerPolitique({ worker: codex, texte: modif.apres, expose: false, arrierePlan: false, horodatage: 'z' })
  ok('switching off: "disabled: true" appears, background drops', coupe.ok && etatProfil(coupe.apres, codex).ligne.expose === false && etatProfil(coupe.apres, codex).ligne.arrierePlan === false)
  const retour = calculerPolitique({ worker: codex, texte: coupe.apres, expose: true, arrierePlan: false, horodatage: 'w' })
  ok('round trip: back to exactly the state before switching off', retour.ok && retour.apres === ajout.apres)
  const idem = calculerPolitique({ worker: codex, texte: ajout.apres, expose: true, arrierePlan: false, horodatage: 'v' })
  ok('same policy: "inchange", identical text', idem.ok && idem.action === 'inchange' && idem.apres === ajout.apres)
  const deux = calculerPolitique({ worker: claude, texte: calculerPolitique({ worker: codex, texte: PATCH, expose: true, arrierePlan: false, horodatage: 'a' }).apres, expose: true, arrierePlan: false, horodatage: 'b' })
  ok('Claude Code not mounted: refused while the connection is missing', deux.ok === false && deux.error === 'connexion-absente')
  const etr = calculerPolitique({ worker: codex, texte: PATCH + `- insert:\n    - id: my-tool\n      name: '@deepseek-ai/dsh-tool-subagent'\n      config:\n        provider: codex\n        toolName: subagent_codex\n`, expose: true, arrierePlan: false, horodatage: 'c' })
  ok('tool line defined elsewhere: refused, not touched', etr.ok === false && etr.error === 'ligne-existante' && etr.detail.id === 'my-tool')
  const main = ajout.apres.replace('maxDepth: provider-managed', 'maxDepth: provider-managed\n        extra: 1')
  const refus = calculerPolitique({ worker: codex, texte: main, expose: true, arrierePlan: true, horodatage: 'd' })
  ok('our line but edited by hand (unknown key): refused', refus.ok === false && refus.error === 'ligne-modifiee-a-la-main' && refus.detail.includes('extra'))
  ok('ZCode: no policy (not handled by the subagent tool)', calculerPolitique({ worker: zcode, texte: PATCH, expose: true, arrierePlan: false, horodatage: 'e' }).error === 'non-supporte')
  ok('unknown worker', calculerPolitique({ worker: undefined, texte: PATCH, expose: true, arrierePlan: false, horodatage: 'f' }).error === 'worker-inconnu')
  ok('blocOutil parses as it is', etatProfil('- insert:\n    - id: codex\n      name: \'@deepseek-ai/dsh-subagent-codex\'\n' + blocOutil(codex, { expose: true, arrierePlan: true }, 'x'), codex).ligne.arrierePlan === true)
  const g = calculerPolitique({ worker: gemini, texte: PATCH_AVEC_GEMINI, expose: true, arrierePlan: true, horodatage: 'g' })
  const gl = etatProfil(g.apres, gemini).ligne
  ok('a home-made provider gets the same line, with its own provider and tool name', g.ok && gl.nous && gl.nomOutil === 'subagent_gemini' && g.apres.includes('provider: gemini'))
}

console.log('── activation: mounting a connection of ours ──')
{
  const A = (o) => calculerActivation({ worker: gemini, texte: PATCH, horodatage: '20261008-120000', ...o })
  const r = A({})
  ok('adds an insert block that loads the package, nothing else moves', r.ok && r.apres.startsWith(PATCH) && etatProfil(r.apres, gemini).connexion === true)
  ok('the block loads the connector by its subpath name in the shared package (id subagent-<worker>, double-quoted name)', r.apres.includes('    - id: subagent-gemini\n      name: "@local/dsh-subagent-maison/gemini"'))
  ok('the block names its rollback backup', r.apres.includes('bak-workers-activate-gemini-20261008-120000'))
  ok('text without a final newline: the block is not glued to the last line', /maxAttempts: 10\n\n# ── Workers/.test(A({ texte: PATCH.trimEnd() }).apres))
  ok('already mounted: refused, nothing to write', A({ texte: PATCH_AVEC_GEMINI }).error === 'deja-montee')
  ok('Claude Code and Codex are mounted by the Tools screen, not here', calculerActivation({ worker: claude, texte: PATCH, horodatage: 'x' }).error === 'non-supporte' && calculerActivation({ worker: zcode, texte: PATCH, horodatage: 'x' }).error === 'non-supporte')
  ok('unknown worker', calculerActivation({ worker: undefined, texte: PATCH, horodatage: 'x' }).error === 'worker-inconnu')
  ok('blocActivation is parsable on an empty patch', etatProfil(blocActivation(opencode, 'x'), opencode).connexion === true)
}

console.log('── the shipped package, and the hand-made setups that came before it ──')
{
  const NOUVEAU = PATCH_GEMINI_MAISON
  ok('the new subpath name counts as turned on', etatProfil(NOUVEAU, gemini).connexion === true && etatProfil(NOUVEAU, opencode).connexion === false)
  ok('the old bare name of a hand-made setup counts too (that machine keeps its connectors)', etatProfil(PATCH_AVEC_GEMINI, gemini).connexion === true)
  ok('turning on a worker the old way is "already turned on": no second line, so the provider is never registered twice', calculerActivation({ worker: gemini, texte: PATCH_AVEC_GEMINI, horodatage: 'x' }).error === 'deja-montee')
  ok('a name of another worker is not taken for this one', etatProfil(PATCH_AVEC_GEMINI.replace('dsh-subagent-gemini', 'dsh-subagent-qwen'), gemini).connexion === false)
  ok('the package to look for follows the NAME of the line: the shared one for the current name, the bare one for an old name, the shared one when there is no line yet', paquetAChercher(gemini, '@local/dsh-subagent-maison/gemini') === '@local/dsh-subagent-maison' && paquetAChercher(gemini, 'dsh-subagent-gemini') === 'dsh-subagent-gemini' && paquetAChercher(gemini) === '@local/dsh-subagent-maison' && paquetAChercher(codex, '@deepseek-ai/dsh-subagent-codex') === '@deepseek-ai/dsh-subagent-codex')
  ok('etatProfil says which name the line carries', etatProfil(NOUVEAU, gemini).nomMonte === '@local/dsh-subagent-maison/gemini' && etatProfil(PATCH_AVEC_GEMINI, gemini).nomMonte === 'dsh-subagent-gemini' && etatProfil(PATCH, gemini).nomMonte === null)
  ok('nomsDeConnexion: current name first', nomsDeConnexion(gemini)[0] === '@local/dsh-subagent-maison/gemini' && nomsDeConnexion(codex).join() === '@deepseek-ai/dsh-subagent-codex')
}

console.log('── reading what a CLI says about its sign-in ──')
{
  ok('claude: JSON loggedIn:true', lireAuthJson({ code: 0, sortie: '{\n "loggedIn": true,\n "authMethod": "oauth_token"\n}' }).connecte === true)
  ok('claude: JSON loggedIn:false, even with exit 0: the JSON is believed', lireAuthJson({ code: 0, sortie: '{"loggedIn": false}' }).connecte === false)
  ok('claude: no JSON → falls back on the exit code', lireAuthJson({ code: 1, sortie: 'Not logged in' }).connecte === false && lireAuthJson({ code: 0, sortie: 'ok' }).connecte === true)
  ok('claude: noise around the JSON is tolerated', lireAuthJson({ code: 0, sortie: 'WARNING: x\n{"loggedIn": true}\n' }).connecte === true)

  const listeOpencode = (n) => `\n┌  Credentials ~/.local/share/opencode/auth.json\n│\n●  Some Provider api\n│\n└  ${n} credentials\n\n`
  ok('opencode: "4 credentials" → signed in, count kept, no provider name leaked', (() => { const r = lireAuthCompte({ code: 0, sortie: listeOpencode(4) }); return r.connecte === true && r.detail === '4 credentials' })())
  ok('opencode: "1 credential" (singular) and "0 credentials"', lireAuthCompte({ code: 0, sortie: listeOpencode(1).replace('1 credentials', '1 credential') }).connecte === true && lireAuthCompte({ code: 0, sortie: listeOpencode(0) }).connecte === false)
  ok('opencode: an unreadable report is "cannot tell", not "not signed in"', lireAuthCompte({ code: 0, sortie: 'something else' }) === null)

  const statusOk = '┌──┐\n│ ☤ Hermes Agent Status │\n◆ Environment\n  Provider:     Nous Portal\n\n◆ API Keys\n  OpenRouter    ✗ (not set)\n\n◆ Auth Providers\n  Nous Portal   ✓ logged in\n    Portal URL: https://portal.nousresearch.com\n  OpenAI Codex  ✗ not logged in (run: hermes model)\n'
  const statusKo = '◆ Environment\n  Provider:     Nous Portal\n\n◆ Auth Providers\n  Nous Portal   ✗ not logged in (run: hermes model)\n\n◆ API-Key Providers\n  Z.AI / GLM       ✗ not configured (run: hermes model)\n'
  ok('hermes: a "✓ logged in" line → signed in, the line is the evidence', (() => { const r = lireAuthHermes({ code: 0, sortie: statusOk }); return r.connecte === true && r.detail === 'Nous Portal ✓ logged in' })())
  ok('hermes: "✓ configured" counts too', lireAuthHermes({ code: 0, sortie: statusKo.replace('Z.AI / GLM       ✗ not configured', 'Z.AI / GLM       ✓ configured') }).connecte === true)
  ok('hermes: a report with only crosses → not signed in', lireAuthHermes({ code: 0, sortie: statusKo }).connecte === false)
  ok('hermes: output that is not the status report → "cannot tell"', lireAuthHermes({ code: 1, sortie: 'Traceback…' }) === null)
  // measured on the real CLI: the messaging platforms tick "configured" too, and must not make an agent look signed in
  const statusMessagerie = statusKo + '\n◆ Messaging Platforms\n  Telegram      ✗ not configured\n  A2A           ✓ configured (plugin)\n  WhatsApp      ✓ configured (plugin)\n'
  ok('hermes: "✓ configured" under Messaging Platforms (WhatsApp, A2A…) is NOT a sign-in', lireAuthHermes({ code: 0, sortie: statusMessagerie }).connecte === false)
  ok('hermes: a tick in the "API Keys" list (tools such as Firecrawl) is not a model sign-in either', lireAuthHermes({ code: 0, sortie: statusKo.replace('◆ Environment', '◆ API Keys\n  Firecrawl     ✓ (set)\n◆ Environment') }).connecte === false)
  ok('hermes: a logged-in provider is still found when messaging blocks follow it', lireAuthHermes({ code: 0, sortie: statusOk + '\n◆ Messaging Platforms\n  WhatsApp      ✓ configured (plugin)\n' }).connecte === true)
}

console.log('── checks: scenarios ──')
{
  const io = (over = {}) => ({
    fichierServeur: '/x/zcode-mcp-server.mjs',
    paquetInstalle: () => true, fichierExiste: () => true,
    trouver: async () => '/usr/local/bin/claude',
    executer: async (bin, args) => (args[0] === '--version' ? { code: 0, sortie: '2.1.288 (Claude Code)\n' } : { code: 0, sortie: '{"loggedIn": true, "authMethod": "oauth_token"}' }),
    cleDansEnv: () => false,
    worktreeJetable: async () => ({ ok: true, detail: 'git version 2.34.1' }),
    ...over
  })
  const avecClaude = PATCH + `- insert:\n    - id: subagent-claude-code\n      name: '@deepseek-ai/dsh-subagent-claude-code'\n`
  const V = (over, worker = claude, texte = avecClaude) => verifier({ worker, texte, io: io(over) })
  const tout = await V()
  ok('everything fine → ready', tout.statut === 'pret' && tout.controles.every((c) => c.etat === 'ok'))
  ok('the 5 checks, in order', tout.controles.map((c) => c.id).join() === 'connexion,paquet,binaire,auth,worktree')
  ok('the binary carries its path and version', tout.controles[2].detail.includes('/usr/local/bin/claude') && tout.controles[2].detail.includes('2.1.288'))
  ok('connection missing from the profile → a-connecter', (await V({}, claude, PATCH)).statut === 'a-connecter')
  ok('mounted but package not installed → a-relancer', (await V({ paquetInstalle: () => false })).statut === 'a-relancer')
  const sansBin = await V({ trouver: async () => null })
  ok('binary missing → absent, and the sign-in is NOT claimed ok', sansBin.statut === 'binaire-absent' && sansBin.controles.find((c) => c.id === 'auth').etat === 'inconnu')
  ok('CLI not signed in → non-connecte', (await V({ executer: async (b, a) => (a[0] === '--version' ? { code: 0, sortie: 'v' } : { code: 1, sortie: '{"loggedIn": false}' }) })).statut === 'non-connecte')
  ok('sign-in command that does not answer → partial check, never ready', (await V({ executer: async (b, a) => (a[0] === '--version' ? { code: 0, sortie: 'v' } : { code: 1, sortie: '', delai: true }) })).statut === 'incomplet')
  const sansGit = await V({ worktreeJetable: async () => ({ ok: false, detail: 'git not found' }) })
  ok('worktree impossible → ecriture-impossible, with the reason', sansGit.statut === 'ecriture-impossible' && sansGit.controles.at(-1).detail === 'git not found')
  const explose = await V({ trouver: async () => { throw new Error('boom') }, paquetInstalle: () => { throw new Error('boom') } })
  ok('I/O that throws does not bring the check down', explose.statut === 'a-relancer' || explose.statut === 'binaire-absent')
  const z = await V({}, zcode, PATCH)
  ok('ZCode: connection + server checked, sign-in said not checkable → partial', z.statut === 'incomplet' && z.controles.find((c) => c.id === 'auth').code === 'coffre-propre')
  ok('ZCode: MCP server missing → flagged', (await V({ fichierExiste: () => false }, zcode, PATCH)).statut === 'serveur-absent')
  ok('statutGlobal: the connection outranks everything', statutGlobal([{ id: 'connexion', etat: 'ko' }, { id: 'auth', etat: 'ko' }]) === 'a-connecter')

  // The home-made providers: their own way of telling "signed in".
  const geminiIo = (over) => io({ trouver: async () => '/opt/homebrew/bin/gemini', ...over })
  const gKey = await verifier({ worker: gemini, texte: PATCH_AVEC_GEMINI, io: geminiIo({ cleDansEnv: (noms) => noms.includes('GEMINI_API_KEY') }) })
  ok('gemini: the key is in DSH’s environment → ready; no CLI sign-in command is run', gKey.statut === 'pret' && gKey.controles.find((c) => c.id === 'auth').detail === 'API key found')
  let lances = []
  await verifier({ worker: gemini, texte: PATCH_AVEC_GEMINI, io: geminiIo({ cleDansEnv: () => true, executer: async (b, a) => { lances.push(a.join(' ')); return { code: 0, sortie: 'v' } } }) })
  ok('gemini: only --version is run (a key is read from the environment, not asked to the CLI)', lances.length === 1 && lances[0] === '--version', lances.join('|'))
  const gNo = await verifier({ worker: gemini, texte: PATCH_AVEC_GEMINI, io: geminiIo({ cleDansEnv: () => false }) })
  ok('gemini: no key → non-connecte, the names to look for are the evidence, never a value', gNo.statut === 'non-connecte' && gNo.controles.find((c) => c.id === 'auth').detail === 'GEMINI_API_KEY / GOOGLE_API_KEY')
  ok('qwen: looks for its own two names', (await verifier({ worker: qwen, texte: PATCH + '- insert:\n    - id: subagent-qwen\n      name: "dsh-subagent-qwen"\n', io: geminiIo({ cleDansEnv: (n) => n.join() === 'QWEN_TOKEN_PLAN_API_KEY,DASHSCOPE_API_KEY' }) })).statut === 'pret')
  const ocPatch = PATCH + '- insert:\n    - id: subagent-opencode\n      name: "dsh-subagent-opencode"\n'
  const oc = (n) => verifier({ worker: opencode, texte: ocPatch, io: io({ trouver: async () => '/x/opencode', executer: async (b, a) => (a[0] === '--version' ? { code: 0, sortie: '1.18.18' } : { code: 0, sortie: `└  ${n} credentials` }) }) })
  ok('opencode: runs "auth list", credentials > 0 → ready; 0 → non-connecte', (await oc(4)).statut === 'pret' && (await oc(0)).statut === 'non-connecte')
  const hmPatch = PATCH + '- insert:\n    - id: subagent-hermes\n      name: "dsh-subagent-hermes"\n'
  const hm = (sortie) => verifier({ worker: hermes, texte: hmPatch, io: io({ trouver: async () => '/x/hermes', executer: async (b, a) => (a[0] === '--version' ? { code: 0, sortie: 'Hermes Agent v0.21.5' } : { code: 0, sortie }) }) })
  ok('hermes: runs "status": a logged-in provider → ready, an unreadable report → partial, never "not signed in"', (await hm('◆ Auth Providers\n  Nous Portal   ✓ logged in\n')).statut === 'pret' && (await hm('garbage')).statut === 'incomplet')
}

console.log('── the install log ──')
{
  ok('sansAnsi: colours and cursor moves removed, carriage returns become line breaks', sansAnsi('\x1b[32mok\x1b[0m\rnext\x1b[2K') === 'ok\nnext')
  const job = { journal: [], reste: '' }
  ajouterAuJournal(job, 'Download')
  ajouterAuJournal(job, 'ing…\ndone\n')
  ok('a line split across two chunks is rebuilt, whole lines only', job.journal.join('|') === 'Downloading…|done' && job.reste === '')
  ajouterAuJournal(job, 'x'.repeat(500) + '\n')
  ok('a very long line is cut', job.journal.at(-1).length === 241 && job.journal.at(-1).endsWith('…'))
  for (let i = 0; i < 100; i++) ajouterAuJournal(job, 'l' + i + '\n')
  ok('only the last 40 lines are kept', job.journal.length === 40 && job.journal.at(-1) === 'l99')
  ajouterAuJournal(job, '\n\n  \n')
  ok('blank lines are dropped', job.journal.length === 40)
}

console.log('── routes ──')
{
  const PROFIL = 'web'
  const disque = { patch: PATCH, ecritures: [], profils: [PROFIL, 'other'], paquets: new Set(['@deepseek-ai/dsh-subagent-codex', '@local/dsh-subagent-maison']), env: new Set() }
  const monde = { binaires: { codex: '/bin/codex', npm: '/bin/npm', curl: '/bin/curl', bash: '/bin/bash' }, plateforme: 'darwin', installs: [], installFin: null, installDonnees: [] }
  const deps = (over = {}) => ({
    profils: () => disque.profils, profilParDefaut: (l) => (l.includes('web') ? 'web' : l[0]),
    lirePatch: () => disque.patch, cheminPatch: (p) => '/h/' + p + '/cordis.patch.yml',
    ecrirePatch: (p, t) => { disque.ecritures.push(['patch', t]); disque.patch = t },
    sauvegarder: (p, n, c) => { disque.ecritures.push(['sauvegarde', n, c]) },
    maintenant: () => new Date(2026, 9, 3, 12, 0, 0),
    io: {
      fichierServeur: '/x/z.mjs', paquetInstalle: (p, pkg) => disque.paquets.has(pkg), fichierExiste: () => true,
      trouver: async (b) => monde.binaires[b] ?? null,
      executer: async (b, a) => (a[0] === '--version' ? { code: 0, sortie: 'codex-cli 0.160.0' } : { code: 0, sortie: 'Logged in using ChatGPT' }),
      worktreeJetable: async () => ({ ok: true }),
      cleDansEnv: (noms) => noms.some((n) => disque.env.has(n)),
      plateforme: () => monde.plateforme,
      lancerInstallation: (commande, { surDonnees }) => new Promise((resolve) => {
        monde.installs.push(commande)
        monde.installFin = (res) => { for (const t of monde.installDonnees) surDonnees(t); resolve(res) }
      })
    },
    ...over
  })
  const monter = (d) => {
    const routes = new Map()
    monterWorkers({ register: ({ path, handler }) => routes.set(path, handler) }, d)
    return routes
  }
  const requete = ({ methode = 'GET', url = '/', corps, origine = 'http://127.0.0.1:3080', type = 'application/json' }) => {
    const r = Readable.from(corps === undefined ? [] : [Buffer.from(typeof corps === 'string' ? corps : JSON.stringify(corps))])
    r.method = methode; r.url = url; r.socket = { localPort: 3080 }
    r.headers = { ...(origine ? { origin: origine } : {}), ...(type && methode === 'POST' ? { 'content-type': type } : {}) }
    return r
  }
  const appeler = async (routes, chemin, opts) => {
    let statut = 0; let texte = ''
    const res = { writeHead: (s) => { statut = s }, end: (t) => { texte = t } }
    await routes.get(chemin)(requete(opts), res)
    return { statut, json: texte ? JSON.parse(texte) : null }
  }
  const attendre = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms))
  const routes = monter(deps())
  ok('5 routes mounted', [...routes.keys()].sort().join() === '/kybernos-workers/activate,/kybernos-workers/check,/kybernos-workers/install,/kybernos-workers/policy,/kybernos-workers/state')

  let r = await appeler(routes, '/kybernos-workers/state', { url: '/kybernos-workers/state' })
  ok('state: 200, default profile, the 7 workers in registry order', r.statut === 200 && r.json.profil === 'web' && r.json.workers.map((w) => w.id).join() === 'claude-code,codex,gemini,opencode,qwen,hermes,zcode')
  ok('state: Codex mounted and installed, Claude Code not, nothing checked yet', r.json.workers.find((w) => w.id === 'codex').connexion === true && r.json.workers.find((w) => w.id === 'claude-code').connexion === false && r.json.workers.every((w) => w.dernier === null && w.job === null))
  ok('state: every worker has a boolean `connexion` (no "not supported" any more)', r.json.workers.every((w) => typeof w.connexion === 'boolean'))
  ok('state: the install command and where it comes from are given, with whether this machine can run it', (() => { const g = r.json.workers.find((w) => w.id === 'gemini'); return g.install.cmd === 'npm install -g @google/gemini-cli' && g.install.src === 'npm' && g.install.possible === true && g.activation === 'workers' })())
  ok('state: ZCode has no install; Claude Code and Codex are mounted by the Tools screen', r.json.workers.find((w) => w.id === 'zcode').install === null && r.json.workers.find((w) => w.id === 'claude-code').activation === 'outils')
  ok('state: how to connect is told (a key for Gemini and Qwen, a terminal command for the others)', r.json.workers.find((w) => w.id === 'gemini').connect.mode === 'key' && r.json.workers.find((w) => w.id === 'gemini').connect.env === 'GEMINI_API_KEY' && r.json.workers.find((w) => w.id === 'opencode').connect.cmd === 'opencode auth login')
  ok('state: GET without an origin header accepted (read only)', (await appeler(routes, '/kybernos-workers/state', { url: '/kybernos-workers/state', origine: '' })).statut === 200)
  ok('state: foreign origin refused', (await appeler(routes, '/kybernos-workers/state', { url: '/kybernos-workers/state', origine: 'http://evil.example' })).statut === 403)
  ok('state: unknown profile refused', (await appeler(routes, '/kybernos-workers/state', { url: '/kybernos-workers/state?profile=../etc' })).statut === 400)
  ok('state: valid profile accepted', (await appeler(routes, '/kybernos-workers/state', { url: '/kybernos-workers/state?profile=other' })).json.profil === 'other')
  ok('state: POST refused', (await appeler(routes, '/kybernos-workers/state', { methode: 'POST', corps: {} })).statut === 405)

  r = await appeler(routes, '/kybernos-workers/check', { methode: 'POST', corps: { worker: 'codex' } })
  ok('check: 200, ready, 5 checks', r.statut === 200 && r.json.statut === 'pret' && r.json.controles.length === 5)
  r = await appeler(routes, '/kybernos-workers/state', { url: '/kybernos-workers/state' })
  ok('state remembers the last check', r.json.workers.find((w) => w.id === 'codex').dernier.statut === 'pret' && r.json.workers.find((w) => w.id === 'codex').dernier.quand.startsWith('2026-10-0'))
  ok('check: unknown worker → 404', (await appeler(routes, '/kybernos-workers/check', { methode: 'POST', corps: { worker: 'zzz' } })).statut === 404)
  ok('check: missing origin refused (writes are strict)', (await appeler(routes, '/kybernos-workers/check', { methode: 'POST', corps: { worker: 'codex' }, origine: '' })).statut === 403)
  ok('check: content-type required', (await appeler(routes, '/kybernos-workers/check', { methode: 'POST', corps: { worker: 'codex' }, type: 'text/plain' })).statut === 415)
  ok('check: invalid body → 400', (await appeler(routes, '/kybernos-workers/check', { methode: 'POST', corps: '{not json' })).statut === 400)
  ok('check: unknown profile → 400', (await appeler(routes, '/kybernos-workers/check', { methode: 'POST', corps: { worker: 'codex', profile: 'nope' } })).statut === 400)

  disque.env.add('SECRET-NAME-CHECK')
  const SECRETE = 'sk-this-value-must-never-appear-anywhere'
  disque.patch = PATCH_GEMINI_MAISON
  const withKey = monter(deps({ io: { ...deps().io, cleDansEnv: (noms) => { void SECRETE; return noms.includes('GEMINI_API_KEY') }, trouver: async () => '/bin/gemini' } }))
  r = await appeler(withKey, '/kybernos-workers/check', { methode: 'POST', corps: { worker: 'gemini' } })
  ok('check of a key-based worker: ready, and nothing but "API key found" is said about the key', r.json.statut === 'pret' && !JSON.stringify(r.json).includes(SECRETE) && r.json.controles.find((c) => c.id === 'auth').detail === 'API key found')
  disque.patch = PATCH

  let liberer
  const lent = monter(deps({ io: { ...deps().io, worktreeJetable: () => new Promise((resolve) => { liberer = () => resolve({ ok: true }) }) } }))
  const premiere = appeler(lent, '/kybernos-workers/check', { methode: 'POST', corps: { worker: 'codex' } })
  await attendre()
  ok('two checks at the same time: the second gets 409', (await appeler(lent, '/kybernos-workers/check', { methode: 'POST', corps: { worker: 'codex' } })).statut === 409)
  liberer(); await premiere
  ok('the lock is released after the first', (await (async () => { const p = appeler(lent, '/kybernos-workers/check', { methode: 'POST', corps: { worker: 'codex' } }); await attendre(); liberer(); return p })()).statut === 200)

  r = await appeler(routes, '/kybernos-workers/policy', { methode: 'POST', corps: { worker: 'codex', expose: true, background: false, dry: true } })
  ok('policy dry: announces the addition without writing', r.statut === 200 && r.json.dry === true && r.json.action === 'ajout' && disque.ecritures.length === 0)
  r = await appeler(routes, '/kybernos-workers/policy', { methode: 'POST', corps: { worker: 'codex', expose: true, background: true } })
  ok('policy: 200 and the backup name (DSH reloads the patch by itself: no restart is announced)', r.statut === 200 && r.json.restart === undefined && r.json.backup === 'cordis.patch.yml.bak-workers-codex-20261003-120000')
  ok('policy: the BACKUP is written before the patch, with the old content', disque.ecritures[0][0] === 'sauvegarde' && disque.ecritures[0][2] === PATCH && disque.ecritures[1][0] === 'patch')
  ok('policy: the patch written holds the wanted line', etatProfil(disque.patch, codex).ligne.arrierePlan === true)
  r = await appeler(routes, '/kybernos-workers/policy', { methode: 'POST', corps: { worker: 'codex', expose: true, background: true } })
  ok('same policy: "inchange", no new write', r.json.action === 'inchange' && disque.ecritures.length === 2)
  r = await appeler(routes, '/kybernos-workers/policy', { methode: 'POST', corps: { worker: 'claude-code', expose: true, background: false } })
  ok('policy: connection missing → 409 with the reason', r.statut === 409 && r.json.error === 'connexion-absente')
  ok('policy: malformed policy → 400', (await appeler(routes, '/kybernos-workers/policy', { methode: 'POST', corps: { worker: 'codex', expose: 'yes' } })).statut === 400)
  ok('policy: ZCode → 400 not supported', (await appeler(routes, '/kybernos-workers/policy', { methode: 'POST', corps: { worker: 'zcode', expose: true, background: false } })).statut === 400)
  ok('policy: foreign origin → 403', (await appeler(routes, '/kybernos-workers/policy', { methode: 'POST', corps: { worker: 'codex', expose: false, background: false }, origine: 'http://evil.example' })).statut === 403)
  const before = disque.ecritures.length
  const broken = monter(deps({ ecrirePatch: () => { throw new Error('disk full') } }))
  r = await appeler(broken, '/kybernos-workers/policy', { methode: 'POST', corps: { worker: 'codex', expose: false, background: false } })
  ok('policy: write failure → 500 with the reason, backup already made', r.statut === 500 && r.json.error === 'write-failed' && r.json.detail.includes('disk full') && disque.ecritures.length === before + 1)
  ok('policy: profile without a patch → 409', (await appeler(monter(deps({ lirePatch: () => null })), '/kybernos-workers/policy', { methode: 'POST', corps: { worker: 'codex', expose: true, background: false } })).statut === 409)

  // activate
  disque.patch = PATCH; disque.ecritures = []
  r = await appeler(routes, '/kybernos-workers/activate', { methode: 'POST', corps: { worker: 'gemini' } })
  ok('activate: 200, not already mounted, backup name', r.statut === 200 && r.json.ok === true && r.json.restart === undefined && r.json.already === false && r.json.backup === 'cordis.patch.yml.bak-workers-activate-gemini-20261003-120000', JSON.stringify(r.json))
  ok('activate: the BACKUP is written before the patch, the patch now mounts the connection', disque.ecritures[0][0] === 'sauvegarde' && disque.ecritures[0][2] === PATCH && disque.ecritures[1][0] === 'patch' && etatProfil(disque.patch, gemini).connexion === true)
  r = await appeler(routes, '/kybernos-workers/activate', { methode: 'POST', corps: { worker: 'gemini' } })
  ok('activate again: already mounted, nothing written', r.json.already === true && disque.ecritures.length === 2)
  disque.paquets.delete('@local/dsh-subagent-maison')
  r = await appeler(routes, '/kybernos-workers/activate', { methode: 'POST', corps: { worker: 'opencode' } })
  ok('activate: the shared package is not in the profile → 409, NOTHING written (DSH would fail to load it)', r.statut === 409 && r.json.error === 'package-missing' && disque.ecritures.length === 2 && etatProfil(disque.patch, opencode).connexion === false)
  r = await appeler(routes, '/kybernos-workers/state', { url: '/kybernos-workers/state' })
  ok('state tells it: not installed for the four connectors, installed for Codex', r.json.workers.filter((w) => w.activation === 'workers').every((w) => w.installe === false) && r.json.workers.find((w) => w.id === 'codex').installe === true)
  // a hand-made line keeps working only with ITS bare package; a package it does not load never vouches for it
  const patchAncien = disque.patch
  disque.patch = PATCH_AVEC_GEMINI
  r = await appeler(routes, '/kybernos-workers/state', { url: '/kybernos-workers/state' })
  ok('an old-name line with neither package: not installed', r.json.workers.find((w) => w.id === 'gemini').installe === false)
  disque.paquets.add('@local/dsh-subagent-maison')
  r = await appeler(routes, '/kybernos-workers/state', { url: '/kybernos-workers/state' })
  ok('an old-name line is NOT vouched for by the shared package (it would not load that line)', r.json.workers.find((w) => w.id === 'gemini').installe === false)
  disque.paquets.add('dsh-subagent-gemini')
  r = await appeler(routes, '/kybernos-workers/state', { url: '/kybernos-workers/state' })
  ok('with its own bare package the old-name line is installed', r.json.workers.find((w) => w.id === 'gemini').installe === true)
  r = await appeler(routes, '/kybernos-workers/check', { methode: 'POST', corps: { worker: 'gemini' } })
  ok('and the check agrees: package installed for an old-name line only with the bare package', r.json.controles.find((c) => c.id === 'paquet').etat === 'ok')
  disque.paquets.delete('dsh-subagent-gemini')
  r = await appeler(routes, '/kybernos-workers/check', { methode: 'POST', corps: { worker: 'gemini' } })
  ok('without it the check says the package is not installed, even though the shared package is there', r.json.controles.find((c) => c.id === 'paquet').etat === 'ko' && r.json.statut === 'a-relancer')
  disque.patch = patchAncien
  disque.paquets.delete('@local/dsh-subagent-maison')
  disque.paquets.add('dsh-subagent-opencode')
  r = await appeler(routes, '/kybernos-workers/activate', { methode: 'POST', corps: { worker: 'opencode' } })
  ok('a bare package alone does not allow writing a NEW line: it would not load it → package-missing, nothing written', r.statut === 409 && r.json.error === 'package-missing' && etatProfil(disque.patch, opencode).connexion === false)
  disque.paquets.delete('dsh-subagent-opencode'); disque.paquets.add('@local/dsh-subagent-maison')
  ok('activate: Claude Code is mounted by the Tools screen → 400', (await appeler(routes, '/kybernos-workers/activate', { methode: 'POST', corps: { worker: 'claude-code' } })).statut === 400)
  ok('activate: unknown worker → 404, foreign origin → 403, no patch → 409', (await appeler(routes, '/kybernos-workers/activate', { methode: 'POST', corps: { worker: 'zzz' } })).statut === 404 && (await appeler(routes, '/kybernos-workers/activate', { methode: 'POST', corps: { worker: 'gemini' }, origine: 'http://evil.example' })).statut === 403 && (await appeler(monter(deps({ lirePatch: () => null })), '/kybernos-workers/activate', { methode: 'POST', corps: { worker: 'gemini' } })).statut === 409)
  disque.patch = PATCH; disque.ecritures = []
  const cassee = monter(deps({ lirePatch: () => PATCH, ecrirePatch: () => { throw new Error('read-only') } }))
  ok('activate: write failure → 500 with the reason', (await appeler(cassee, '/kybernos-workers/activate', { methode: 'POST', corps: { worker: 'gemini' } })).json.error === 'write-failed')
  disque.patch = PATCH

  // install
  const CMD_GEMINI = 'npm install -g @google/gemini-cli'
  const post = (corps, opts = {}) => appeler(routes, '/kybernos-workers/install', { methode: 'POST', corps, ...opts })
  ok('install: the command shown must be the one the host would run → 409 command-changed (and it says which)', (await post({ worker: 'gemini', command: 'npm install -g something-else' })).json.error === 'command-changed' && monde.installs.length === 0)
  ok('install: no command at all is refused too', (await post({ worker: 'gemini' })).json.error === 'command-changed')
  ok('install: unknown worker 404, ZCode has nothing to install 400', (await post({ worker: 'zzz', command: 'x' })).statut === 404 && (await post({ worker: 'zcode', command: 'x' })).statut === 400)
  ok('install: foreign origin → 403, wrong content-type → 415', (await post({ worker: 'gemini', command: CMD_GEMINI }, { origine: 'http://evil.example' })).statut === 403 && (await post({ worker: 'gemini', command: CMD_GEMINI }, { type: 'text/plain' })).statut === 415)
  monde.plateforme = 'win32'
  ok('install: Windows is not covered → 400, and state says "possible: false"', (await post({ worker: 'gemini', command: CMD_GEMINI })).json.error === 'unsupported-platform' && (await appeler(routes, '/kybernos-workers/state', { url: '/kybernos-workers/state' })).json.workers.find((w) => w.id === 'gemini').install.possible === false)
  monde.plateforme = 'darwin'
  ok('install: already on the PATH → 409, nothing run', (await post({ worker: 'codex', command: 'npm install -g @openai/codex' })).json.error === 'already-installed' && monde.installs.length === 0)
  delete monde.binaires.npm
  r = await post({ worker: 'gemini', command: CMD_GEMINI })
  ok('install: npm is not on the PATH → 409 missing-tool "npm", nothing run', r.statut === 409 && r.json.error === 'missing-tool' && r.json.tool === 'npm' && monde.installs.length === 0)
  monde.binaires.npm = '/bin/npm'
  delete monde.binaires.curl
  ok('install: curl missing for a script install → missing-tool "curl"', (await post({ worker: 'opencode', command: 'curl -fsSL https://opencode.ai/install | bash' })).json.tool === 'curl')
  monde.binaires.curl = '/bin/curl'

  r = await post({ worker: 'gemini', command: CMD_GEMINI })
  ok('install: accepted → 202, the exact constant command was run', r.statut === 202 && r.json.started === true && monde.installs.join() === CMD_GEMINI)
  r = await appeler(routes, '/kybernos-workers/install', { url: '/kybernos-workers/install?worker=gemini' })
  ok('install status while running: phase running, empty log', r.json.job.phase === 'running' && r.json.job.journal.length === 0)
  ok('install: a second one at the same time → 409 busy (and names the running one)', (await post({ worker: 'qwen', command: 'npm install -g @qwen-code/qwen-code@latest' })).json.error === 'busy')
  monde.installDonnees = ['added 1 package\n', 'half a li']
  monde.binaires.gemini = '/bin/gemini'
  monde.installFin({ code: 0 }); await attendre()
  r = await appeler(routes, '/kybernos-workers/install', { url: '/kybernos-workers/install?worker=gemini' })
  ok('install done: phase done, output kept (a half line is shown too), found on the PATH', r.json.job.phase === 'done' && r.json.job.surLePath === true && r.json.job.journal.join('|') === 'added 1 package|half a li' && r.json.job.code === 0)
  r = await appeler(routes, '/kybernos-workers/state', { url: '/kybernos-workers/state' })
  ok('state carries the finished job so a reloaded page can show it', r.json.workers.find((w) => w.id === 'gemini').job.phase === 'done' && r.json.workers.find((w) => w.id === 'opencode').job === null)
  delete monde.binaires.gemini

  monde.installDonnees = ['permission denied\n']
  await post({ worker: 'gemini', command: CMD_GEMINI })
  monde.installFin({ code: 243 }); await attendre()
  r = await appeler(routes, '/kybernos-workers/install', { url: '/kybernos-workers/install?worker=gemini' })
  ok('install failed: phase error with the exit code and what the installer said', r.json.job.phase === 'error' && r.json.job.raison === 'exit' && r.json.job.code === 243 && r.json.job.journal[0] === 'permission denied')
  await post({ worker: 'gemini', command: CMD_GEMINI })
  monde.installFin({ code: 1, delai: true }); await attendre()
  ok('install timed out: phase error, raison timeout', (await appeler(routes, '/kybernos-workers/install', { url: '/kybernos-workers/install?worker=gemini' })).json.job.raison === 'timeout')
  await post({ worker: 'gemini', command: CMD_GEMINI })
  monde.installDonnees = []; monde.binaires.gemini = undefined
  monde.installFin({ code: 0 }); await attendre()
  ok('install finished but the program is not on DSH’s PATH: done, surLePath false (the page then says "restart DSH")', (await appeler(routes, '/kybernos-workers/install', { url: '/kybernos-workers/install?worker=gemini' })).json.job.surLePath === false)
  const jette = monter(deps({ io: { ...deps().io, lancerInstallation: () => Promise.reject(new Error('spawn exploded')) } }))
  await appeler(jette, '/kybernos-workers/install', { methode: 'POST', corps: { worker: 'gemini', command: CMD_GEMINI } }); await attendre()
  ok('an installer that throws becomes a failed job, never an unhandled rejection', (await appeler(jette, '/kybernos-workers/install', { url: '/kybernos-workers/install?worker=gemini' })).json.job.phase === 'error')
  ok('install status: unknown worker → 404, no job yet → null', (await appeler(routes, '/kybernos-workers/install', { url: '/kybernos-workers/install?worker=zzz' })).statut === 404 && (await appeler(routes, '/kybernos-workers/install', { url: '/kybernos-workers/install?worker=hermes' })).json.job === null)
  // the job is published whole: never "done" before the rest of the answer (is it on the PATH, when it ended) is known
  let appels = 0
  let libererTrouver
  const finLente = monter(deps({ io: { ...deps().io,
    trouver: (b) => (b === 'gemini' && ++appels > 1 ? new Promise((resolve) => { libererTrouver = () => resolve('/bin/gemini') }) : Promise.resolve(b === 'gemini' ? null : (monde.binaires[b] ?? null))),
    lancerInstallation: async (c, { surDonnees }) => { surDonnees('ok\n'); return { code: 0 } } } }))
  await appeler(finLente, '/kybernos-workers/install', { methode: 'POST', corps: { worker: 'gemini', command: CMD_GEMINI } }); await attendre()
  r = await appeler(finLente, '/kybernos-workers/install', { url: '/kybernos-workers/install?worker=gemini' })
  ok('while the host still looks for the program on the PATH, the job is still "running" (never "done" with an unknown answer)', r.json.job.phase === 'running' && r.json.job.surLePath === null && r.json.job.fini === null, JSON.stringify(r.json.job))
  libererTrouver(); await attendre()
  r = await appeler(finLente, '/kybernos-workers/install', { url: '/kybernos-workers/install?worker=gemini' })
  ok('then "done" arrives with its answer and its end time at once', r.json.job.phase === 'done' && r.json.job.surLePath === true && typeof r.json.job.fini === 'string', JSON.stringify(r.json.job))
  const sansIo = monter(deps({ io: { ...deps().io, lancerInstallation: undefined } }))
  ok('without an installer on the host: 501, and state says "possible: false"', (await appeler(sansIo, '/kybernos-workers/install', { methode: 'POST', corps: { worker: 'gemini', command: CMD_GEMINI } })).statut === 501 && (await appeler(sansIo, '/kybernos-workers/state', { url: '/kybernos-workers/state' })).json.workers.find((w) => w.id === 'gemini').install.possible === false)
}

console.log('── real I/O ──')
{
  const dossier = mkdtempSync(join(tmpdir(), 'kb-workers-test-'))
  try {
    const bin = join(dossier, 'bin'); mkdirSync(bin)
    writeFileSync(join(bin, 'myworker'), '#!/bin/sh\necho ok\n'); chmodSync(join(bin, 'myworker'), 0o755)
    writeFileSync(join(bin, 'notexec'), 'x'); chmodSync(join(bin, 'notexec'), 0o644)
    const env = { PATH: bin + delimiter + '/nowhere' }
    ok('trouverBinaire: finds an executable of the PATH', trouverBinaire('myworker', env, 'linux') === join(bin, 'myworker'))
    ok('trouverBinaire: a non-executable file is not a binary', trouverBinaire('notexec', env, 'linux') === null)
    ok('trouverBinaire: missing → null, and no search outside the PATH', trouverBinaire('missing-xyz', env, 'linux') === null)

    const sale = { PATH: '/usr/bin', HOME: '/h', ANTHROPIC_API_KEY: 'k', OPENAI_API_KEY: 'k', GITHUB_TOKEN: 't', MY_SECRET: 's', DB_PASSWORD: 'p', ANTHROPIC_BASE_URL: 'https://x', SSH_AUTH_SOCK: '/s' }
    const propre = envSansSecrets(sale)
    ok('envSansSecrets: keys, tokens, secrets, passwords removed', !('ANTHROPIC_API_KEY' in propre) && !('OPENAI_API_KEY' in propre) && !('GITHUB_TOKEN' in propre) && !('MY_SECRET' in propre) && !('DB_PASSWORD' in propre) && !('SSH_AUTH_SOCK' in propre))
    ok('envSansSecrets: PATH, HOME and the API address kept (like the official connections)', propre.PATH === '/usr/bin' && propre.HOME === '/h' && propre.ANTHROPIC_BASE_URL === 'https://x')

    const home = join(dossier, 'dsh'); mkdirSync(join(home, 'profiles', 'web'), { recursive: true }); mkdirSync(join(home, 'profiles', 'empty'))
    writeFileSync(join(home, 'profiles', 'web', 'package.json'), '{}')
    writeFileSync(join(home, 'profiles', 'web', 'cordis.patch.yml'), PATCH)
    mkdirSync(join(home, 'profiles', 'web', 'node_modules', '@deepseek-ai', 'dsh-subagent-codex'), { recursive: true })
    mkdirSync(join(home, 'profiles', 'web', 'node_modules', 'dsh-subagent-gemini'), { recursive: true })
    const d = workersDeps(home, { PATH: process.env.PATH, FAKE_TOKEN: 'secret-must-not-pass', FAKE_NAME: 'visible', GEMINI_API_KEY: 'sk-real-value', QWEN_TOKEN_PLAN_API_KEY: '   ' })
    ok('profiles: only the folders that have a package.json', d.profils().join() === 'web')
    ok('default profile: web, or DSH_PROFILE when it exists', d.profilParDefaut(['web', 'x']) === 'web' && workersDeps(home, { DSH_PROFILE: 'x' }).profilParDefaut(['web', 'x']) === 'x' && workersDeps(home, { DSH_PROFILE: 'unknown' }).profilParDefaut(['web']) === 'web')
    ok('lirePatch: reads the file; missing → null', d.lirePatch('web') === PATCH && d.lirePatch('empty') === null)
    ok('paquetInstalle: reads the profile’s node_modules, for scoped and bare names', d.io.paquetInstalle('web', '@deepseek-ai/dsh-subagent-codex') === true && d.io.paquetInstalle('web', 'dsh-subagent-gemini') === true && d.io.paquetInstalle('web', 'dsh-subagent-qwen') === false)
    d.sauvegarder('web', 'cordis.patch.yml.bak-workers-test', PATCH)
    d.ecrirePatch('web', PATCH + '# end\n')
    ok('ecrirePatch: atomic, no temporary file left behind', readFileSync(join(home, 'profiles', 'web', 'cordis.patch.yml'), 'utf8').endsWith('# end\n') && !readdirSync(join(home, 'profiles', 'web')).some((n) => n.includes('.tmp-')))
    ok('sauvegarder: the file exists with the old content', readFileSync(join(home, 'profiles', 'web', 'cordis.patch.yml.bak-workers-test'), 'utf8') === PATCH)
    ok('cleDansEnv: true when one of the names holds a value, false for a blank or missing one', d.io.cleDansEnv(['NOPE', 'GEMINI_API_KEY']) === true && d.io.cleDansEnv(['QWEN_TOKEN_PLAN_API_KEY']) === false && d.io.cleDansEnv(['NOPE']) === false)
    ok('cleDansEnv answers a boolean: the value never leaves it', typeof d.io.cleDansEnv(['GEMINI_API_KEY']) === 'boolean')

    let r = await d.io.executer(process.execPath, ['-e', 'console.log(process.env.FAKE_NAME + "|" + (process.env.FAKE_TOKEN === undefined) + "|" + (process.env.GEMINI_API_KEY === undefined))'])
    ok('executer: runs a real process, without the secrets, with the rest', r.code === 0 && r.sortie.trim() === 'visible|true|true')
    r = await d.io.executer(process.execPath, ['-e', 'process.exit(3)'])
    ok('executer: exit code passed on', r.code === 3)
    r = await d.io.executer('binary-that-does-not-exist-xyz', [])
    ok('executer: a missing binary is reported as such', r.absent === true)
    r = await d.io.executer(process.execPath, ['-e', 'setTimeout(()=>{}, 5000)'], { delaiMs: 300 })
    ok('executer: timeout reported, the process is killed', r.delai === true)

    const avant = readdirSync(tmpdir()).filter((n) => n.startsWith('kybernos-workers-')).length
    const w = await worktreeJetable()
    const apres = readdirSync(tmpdir()).filter((n) => n.startsWith('kybernos-workers-')).length
    ok('worktreeJetable (real git): init, commit, worktree, write, read back', w.ok === true && /git version/.test(w.detail ?? ''), JSON.stringify(w))
    ok('worktreeJetable: nothing is left in the temp folder', avant === apres)
    const sans = await worktreeJetable(async () => ({ code: 127, sortie: '', absent: true }))
    ok('worktreeJetable: git missing → readable failure, and still cleaned up', sans.ok === false && /git not found/.test(sans.detail) && readdirSync(tmpdir()).filter((n) => n.startsWith('kybernos-workers-')).length === avant)
    const casse = await worktreeJetable(async (b, args) => (args.includes('--version') ? { code: 0, sortie: 'git version x' } : { code: 128, sortie: 'fatal: boom\nother', absent: false }))
    ok('worktreeJetable: a failing git step is reported with its name', casse.ok === false && /git init: fatal: boom/.test(casse.detail))

    if (process.platform !== 'win32') {
      const morceaux = []
      let ins = await lancerInstallation('echo "start"; echo "oops" >&2; echo "$FAKE_NAME|${FAKE_TOKEN:-gone}|${GEMINI_API_KEY:-gone}"', { surDonnees: (t) => morceaux.push(t), env: { PATH: process.env.PATH, FAKE_NAME: 'visible', FAKE_TOKEN: 'secret', GEMINI_API_KEY: 'sk-real' } })
      const texte = morceaux.join('')
      ok('lancerInstallation: runs the command through the shell and feeds stdout AND stderr to the log', ins.code === 0 && /start/.test(texte) && /oops/.test(texte))
      ok('lancerInstallation: the installer gets no secret-looking variable, but keeps the rest', /visible\|gone\|gone/.test(texte), texte)
      ins = await lancerInstallation('exit 7')
      ok('lancerInstallation: exit code passed on', ins.code === 7 && ins.delai === undefined)
      ins = await lancerInstallation('sleep 5', { delaiMs: 300 })
      ok('lancerInstallation: killed after the delay, reported as a timeout', ins.delai === true)
      // `curl … | bash` is two processes: the timeout must stop both, not only the shell
      const debut = Date.now()
      ins = await lancerInstallation('echo start | sleep 6.123', { delaiMs: 300 })
      ok('lancerInstallation: a timeout on a PIPELINE ends the run at once (the whole process group is stopped)', ins.delai === true && Date.now() - debut < 3000, String(Date.now() - debut) + ' ms')
      let survivants = ''
      try { survivants = execFileSync('pgrep', ['-f', 'sleep 6.123'], { encoding: 'utf8' }).trim() } catch { survivants = '' }
      ok('and no process of the pipeline is left behind', survivants === '', survivants)
      ins = await lancerInstallation('echo hi', { surDonnees: () => { throw new Error('a log consumer that throws') } })
      ok('lancerInstallation: a log consumer that throws does not break the run', ins.code === 0)
    }

    const mounted = []
    const ctx = { get: (n) => (n === 'webServer' ? { register: (x) => mounted.push(x.path) } : undefined), effect: (fn) => fn(), inject: () => { throw new Error('must not be called') } }
    const oldHome = process.env.DSH_HOME; process.env.DSH_HOME = home
    apply(ctx)
    if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome
    ok('apply: mounts the 5 routes when webServer is already there', mounted.length === 5)
    let deferred = null
    apply({ get: () => undefined, effect: (fn) => fn(), inject: (list, cb) => { deferred = [list, cb] } })
    ok('apply: otherwise waits for the webServer service', deferred !== null && deferred[0].join() === 'webServer')
    ok('apply: never throws, even with a broken context', (() => { try { apply({ get: () => { throw new Error('x') } }); return true } catch { return false } })())
  } finally { rmSync(dossier, { recursive: true, force: true }) }
}

console.log('── registry ──')
ok('7 workers: 6 connections (2 official, 4 home-made) and 1 MCP connector', WORKERS.map((w) => w.genre).join() === 'connexion,connexion,connexion,connexion,connexion,connexion,mcp')
ok('display order: Claude Code, Codex, Gemini, OpenCode, Qwen, Hermes, ZCode', WORKERS.map((w) => w.id).join() === 'claude-code,codex,gemini,opencode,qwen,hermes,zcode')
ok('every connection has its tool line, named like the provider’s README', claude.outil.toolName === 'subagent_claude_code' && codex.outil.toolName === 'subagent_codex' && gemini.outil.toolName === 'subagent_gemini' && claude.outil.provider === 'claude-code')
ok('tool ids are unique and this module’s own', new Set(WORKERS.filter((w) => w.outil).map((w) => w.outil.id)).size === 6 && WORKERS.filter((w) => w.outil).every((w) => w.outil.id.startsWith('kybernos-workers-')))
ok('the four home-made connections are mounted by this module, the rest by the Tools screen', WORKERS.filter((w) => w.activation === 'workers').map((w) => w.id).join() === 'gemini,opencode,qwen,hermes')
ok('they load by a subpath of the ONE shared package, and keep the old bare name as an accepted alias', WORKERS.filter((w) => w.activation === 'workers').every((w) => w.paquet === '@local/dsh-subagent-maison/' + w.id && w.dossier === '@local/dsh-subagent-maison' && w.anciensNoms.join() === 'dsh-subagent-' + w.id))
ok('every connection says how its sign-in is verified', WORKERS.filter((w) => w.genre === 'connexion').every((w) => ['json-loggedIn', 'code', 'count', 'hermes', 'env'].includes(w.auth.format)))
ok('key-based workers name the variables to look for, and the one to write', [gemini, qwen].every((w) => w.auth.format === 'env' && w.connect.mode === 'key' && w.auth.names.includes(w.connect.env)))
{
  const cmds = WORKERS.filter((w) => w.install != null).map((w) => w.install.cmd)
  ok('every install command has the shape of one of the two official families, nothing else', cmds.every((c) => /^curl -fsSL https:\/\/[a-z0-9.-]+\/[a-z0-9./_-]+ \| bash$/.test(c) || /^npm install -g @?[a-z0-9./_-]+(@latest)?$/.test(c)), cmds.join(' ; '))
  ok('and each one says where it downloads from and what must be on the PATH', WORKERS.filter((w) => w.install != null).every((w) => typeof w.install.src === 'string' && Array.isArray(w.install.needs) && w.install.needs.length > 0 && w.install.doc.startsWith('https://')))
  ok('script installs come from the vendor’s own domain', WORKERS.filter((w) => w.install != null && w.install.cmd.startsWith('curl')).every((w) => w.install.cmd.includes('//' + w.install.src + '/')))
}

console.log('\n' + (failures === 0 ? '✓ ' : '✗ ') + (total - failures) + '/' + total + ' checks')
process.exit(failures === 0 ? 0 : 1)
