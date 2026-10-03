// Workers — host logic, routes and real I/O, played without DSH.
//   node packages/kybernos-workers/test-host.mjs
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, delimiter } from 'node:path'
import { Readable } from 'node:stream'
import {
  WORKERS, trouverWorker, analyserPatch, etatProfil, blocOutil, calculerPolitique, lireAuthJson, verifier, statutGlobal, monterWorkers
} from './workers-host.mjs'
import { apply, envSansSecrets, trouverBinaire, worktreeJetable, workersDeps } from './index.js'

let echecs = 0
let total = 0
const ok = (nom, cond, detail) => { total++; if (cond) console.log('  ✓ ' + nom); else { echecs++; console.log('  ✗ ' + nom + (detail !== undefined ? ' — ' + detail : '')) } }
const claude = trouverWorker('claude-code')
const codex = trouverWorker('codex')
const zcode = trouverWorker('zcode')

// A patch shaped like the one the Outils page writes (see KB_TOOLS_CATALOG in kybernos-plugin).
const PATCH = `# Patch de profil — ecrit par l onglet Outils (Kybers).

# ── Outils · Codex — ajoute le 20260930-101500 par l onglet Outils (Kybers)
# Rollback : restaurer cordis.patch.yml.bak-outils-codex-20260930-101500, puis redemarrer DSH.
- insert:
    - id: codex
      name: '@deepseek-ai/dsh-subagent-codex'

# ── Outils · ZCode — ajoute le 20260930-102000 par l onglet Outils (Kybers)
- insert:
    - id: mcp-client-zcode
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: zcode
        transport: stdio
        command: /usr/local/bin/node # DSH lance avec un env nettoye
        args:
          - /Users/x/.dsh/mcp/zcode-mcp-server.mjs
        toolCallTimeoutMs: 600000
        failOnStartupError: false
        reconnect:
          enabled: true
          maxAttempts: 10
`

console.log('── lecture du patch ──')
{
  const items = analyserPatch(PATCH)
  ok('3 entrées reconnues, dans l’ordre', items.map((i) => i.id).join() === 'codex,mcp-client-zcode')
  ok('le nom de paquet est lu sans guillemets', items[0].champs.name === '@deepseek-ai/dsh-subagent-codex')
  const z = items[1]
  ok('scalaires de config lus, commentaire de fin retiré', z.config.serverName === 'zcode' && z.config.command === '/usr/local/bin/node')
  ok('la liste args (lignes « - … ») n’est pas prise pour une entrée', items.length === 2)
  ok('les lignes commentées sont ignorées', analyserPatch('# - id: x\n#   name: y\n').length === 0)
  ok('texte vide / null → aucune entrée', analyserPatch('').length === 0 && analyserPatch(null).length === 0)
}

console.log('── état du profil ──')
{
  ok('Codex monté, Claude Code non', etatProfil(PATCH, codex).connexion === true && etatProfil(PATCH, claude).connexion === false)
  ok('ZCode reconnu par son id de connecteur', etatProfil(PATCH, zcode).connexion === true)
  ok('ZCode reconnu aussi par serverName si l’id diffère', etatProfil(PATCH.replace('mcp-client-zcode', 'autre-id'), zcode).connexion === true)
  ok('aucune ligne d’outil quand il n’y en a pas', etatProfil(PATCH, codex).ligne === null)
  const etranger = PATCH + `
- insert:
    - id: mon-outil-codex
      name: '@deepseek-ai/dsh-tool-subagent'
      disabled: true
      config:
        provider: codex
        toolName: subagent_codex
        enableRunInBackground: true
        maxDepth: provider-managed
`
  const l = etatProfil(etranger, codex).ligne
  ok('ligne d’outil d’un autre auteur : lue, marquée « pas à nous »', l !== null && l.nous === false && l.expose === false && l.arrierePlan === true && l.id === 'mon-outil-codex')
  ok('une ligne commentée n’existe pas', etatProfil(PATCH + '# - id: x\n#   name: \'@deepseek-ai/dsh-tool-subagent\'\n', codex).ligne === null)
  ok('Hermes : jamais de connexion', etatProfil(PATCH, trouverWorker('hermes')).connexion === false)
}

console.log('── politique : calcul du nouveau patch ──')
{
  const A = (o) => calculerPolitique({ worker: codex, texte: PATCH, horodatage: '20261003-120000', ...o })
  const ajout = A({ expose: true, arrierePlan: false })
  ok('ajout : la ligne est écrite à la suite, rien d’autre ne bouge', ajout.ok && ajout.action === 'ajout' && ajout.apres.startsWith(PATCH))
  const relu = etatProfil(ajout.apres, codex).ligne
  ok('relue : à nous, exposée, sans arrière-plan, profondeur gérée par le fournisseur', relu.nous && relu.expose && !relu.arrierePlan && relu.profondeur === 'provider-managed' && relu.nomOutil === 'subagent_codex')
  ok('le bloc donne la commande de retour arrière avec la sauvegarde', ajout.apres.includes('bak-workers-codex-20261003-120000'))
  ok('ajout avec expose=false écrit « disabled: true »', calculerPolitique({ worker: codex, texte: PATCH, expose: false, arrierePlan: false, horodatage: 'x' }).apres.includes('disabled: true'))
  const sansNl = calculerPolitique({ worker: codex, texte: PATCH.trimEnd(), expose: true, arrierePlan: false, horodatage: 'x' })
  ok('texte sans saut de ligne final : le bloc n’est pas collé à la dernière ligne', sansNl.ok && /maxAttempts: 10\n\n# ── Workers/.test(sansNl.apres))
  const modif = calculerPolitique({ worker: codex, texte: ajout.apres, expose: true, arrierePlan: true, horodatage: 'y' })
  ok('modification : arrière-plan activé', modif.ok && modif.action === 'modification' && etatProfil(modif.apres, codex).ligne.arrierePlan === true)
  ok('modification : le reste du fichier est identique, mot pour mot', modif.apres.replace('enableRunInBackground: true', 'enableRunInBackground: false') === ajout.apres)
  const coupe = calculerPolitique({ worker: codex, texte: modif.apres, expose: false, arrierePlan: false, horodatage: 'z' })
  ok('désactivation : « disabled: true » apparaît, arrière-plan retombe', coupe.ok && etatProfil(coupe.apres, codex).ligne.expose === false && etatProfil(coupe.apres, codex).ligne.arrierePlan === false)
  const retour = calculerPolitique({ worker: codex, texte: coupe.apres, expose: true, arrierePlan: false, horodatage: 'w' })
  ok('aller-retour : on retrouve exactement l’état d’avant la désactivation', retour.ok && retour.apres === ajout.apres)
  const idem = calculerPolitique({ worker: codex, texte: ajout.apres, expose: true, arrierePlan: false, horodatage: 'v' })
  ok('même politique : « inchange », texte identique', idem.ok && idem.action === 'inchange' && idem.apres === ajout.apres)
  const deux = calculerPolitique({ worker: claude, texte: calculerPolitique({ worker: codex, texte: PATCH, expose: true, arrierePlan: false, horodatage: 'a' }).apres, expose: true, arrierePlan: false, horodatage: 'b' })
  ok('Claude Code non monté : refusé tant que la connexion est absente', deux.ok === false && deux.error === 'connexion-absente')
  const etr = calculerPolitique({ worker: codex, texte: PATCH + `- insert:\n    - id: mon-outil\n      name: '@deepseek-ai/dsh-tool-subagent'\n      config:\n        provider: codex\n        toolName: subagent_codex\n`, expose: true, arrierePlan: false, horodatage: 'c' })
  ok('ligne d’outil définie ailleurs : refusée, on ne la touche pas', etr.ok === false && etr.error === 'ligne-existante' && etr.detail.id === 'mon-outil')
  const main = ajout.apres.replace('maxDepth: provider-managed', 'maxDepth: provider-managed\n        extra: 1')
  const refus = calculerPolitique({ worker: codex, texte: main, expose: true, arrierePlan: true, horodatage: 'd' })
  ok('ligne à nous mais éditée à la main (clé inconnue) : refusée', refus.ok === false && refus.error === 'ligne-modifiee-a-la-main' && refus.detail.includes('extra'))
  ok('ZCode : pas de politique (non géré par le tool subagent)', calculerPolitique({ worker: zcode, texte: PATCH, expose: true, arrierePlan: false, horodatage: 'e' }).error === 'non-supporte')
  ok('worker inconnu', calculerPolitique({ worker: undefined, texte: PATCH, expose: true, arrierePlan: false, horodatage: 'f' }).error === 'worker-inconnu')
  ok('blocOutil est parsable tel quel', etatProfil('- insert:\n    - id: codex\n      name: \'@deepseek-ai/dsh-subagent-codex\'\n' + blocOutil(codex, { expose: true, arrierePlan: true }, 'x'), codex).ligne.arrierePlan === true)
}

console.log('── lecture de « claude auth status » ──')
{
  ok('JSON loggedIn:true', lireAuthJson({ code: 0, sortie: '{\n "loggedIn": true,\n "authMethod": "oauth_token"\n}' }).connecte === true)
  ok('JSON loggedIn:false, même avec un code 0 : on croit le JSON', lireAuthJson({ code: 0, sortie: '{"loggedIn": false}' }).connecte === false)
  ok('pas de JSON : on se rabat sur le code retour', lireAuthJson({ code: 1, sortie: 'Not logged in' }).connecte === false && lireAuthJson({ code: 0, sortie: 'ok' }).connecte === true)
  ok('bruit autour du JSON toléré', lireAuthJson({ code: 0, sortie: 'WARNING: x\n{"loggedIn": true}\n' }).connecte === true)
}

console.log('── vérification : scénarios ──')
{
  const io = (sur = {}) => ({
    fichierServeur: '/x/zcode-mcp-server.mjs',
    paquetInstalle: () => true, fichierExiste: () => true,
    trouver: async () => '/usr/local/bin/claude',
    executer: async (bin, args) => (args[0] === '--version' ? { code: 0, sortie: '2.1.288 (Claude Code)\n' } : { code: 0, sortie: '{"loggedIn": true, "authMethod": "oauth_token"}' }),
    worktreeJetable: async () => ({ ok: true, detail: 'git version 2.34.1' }),
    ...sur
  })
  const avecClaude = PATCH + `- insert:\n    - id: subagent-claude-code\n      name: '@deepseek-ai/dsh-subagent-claude-code'\n`
  const V = (over, worker = claude, texte = avecClaude) => verifier({ worker, texte, io: io(over) })
  const tout = await V()
  ok('tout est bon → prêt', tout.statut === 'pret' && tout.controles.every((c) => c.etat === 'ok'))
  ok('les 5 contrôles, dans l’ordre', tout.controles.map((c) => c.id).join() === 'connexion,paquet,binaire,auth,worktree')
  ok('le binaire porte son chemin et sa version', tout.controles[2].detail.includes('/usr/local/bin/claude') && tout.controles[2].detail.includes('2.1.288'))
  const sansConn = await V({}, claude, PATCH)
  ok('connexion absente du profil → à connecter', sansConn.statut === 'a-connecter')
  const sansPaquet = await V({ paquetInstalle: () => false })
  ok('montée mais paquet non installé → relance', sansPaquet.statut === 'a-relancer')
  const sansBin = await V({ trouver: async () => null })
  ok('binaire absent → absent, et l’authentification n’est PAS déclarée ok', sansBin.statut === 'binaire-absent' && sansBin.controles.find((c) => c.id === 'auth').etat === 'inconnu')
  const nonCo = await V({ executer: async (b, a) => (a[0] === '--version' ? { code: 0, sortie: 'v' } : { code: 1, sortie: '{"loggedIn": false}' }) })
  ok('CLI non connectée → non authentifié', nonCo.statut === 'non-connecte')
  const delai = await V({ executer: async (b, a) => (a[0] === '--version' ? { code: 0, sortie: 'v' } : { code: 1, sortie: '', delai: true }) })
  ok('commande d’authentification qui ne répond pas → vérification partielle, jamais « prêt »', delai.statut === 'incomplet')
  const sansGit = await V({ worktreeJetable: async () => ({ ok: false, detail: 'git introuvable' }) })
  ok('worktree impossible → écriture impossible, avec la raison', sansGit.statut === 'ecriture-impossible' && sansGit.controles.at(-1).detail === 'git introuvable')
  const explose = await V({ trouver: async () => { throw new Error('boom') }, paquetInstalle: () => { throw new Error('boom') } })
  ok('une E/S qui lève ne fait pas tomber la vérification', explose.statut === 'a-relancer' || explose.statut === 'binaire-absent')
  const z = await V({}, zcode, PATCH)
  ok('ZCode : connexion + serveur vérifiés, authentification dite non vérifiable → partiel', z.statut === 'incomplet' && z.controles.find((c) => c.id === 'auth').code === 'coffre-propre')
  const zSansSrv = await V({ fichierExiste: () => false }, zcode, PATCH)
  ok('ZCode : serveur MCP absent → signalé', zSansSrv.statut === 'serveur-absent')
  ok('Hermes : non supporté, aucun contrôle joué', (await V({}, trouverWorker('hermes'), PATCH)).statut === 'non-supporte')
  ok('statutGlobal : la connexion prime sur tout', statutGlobal([{ id: 'connexion', etat: 'ko' }, { id: 'auth', etat: 'ko' }]) === 'a-connecter')
}

console.log('── routes ──')
{
  const PROFIL = 'web'
  const disque = { patch: PATCH, ecritures: [], profils: [PROFIL, 'autre'] }
  const deps = (sur = {}) => ({
    profils: () => disque.profils, profilParDefaut: (l) => (l.includes('web') ? 'web' : l[0]),
    lirePatch: () => disque.patch, cheminPatch: (p) => '/h/' + p + '/cordis.patch.yml',
    ecrirePatch: (p, t) => { disque.ecritures.push(['patch', t]); disque.patch = t },
    sauvegarder: (p, n, c) => { disque.ecritures.push(['sauvegarde', n, c]) },
    maintenant: () => new Date(2026, 9, 3, 12, 0, 0),
    io: {
      fichierServeur: '/x/z.mjs', paquetInstalle: () => true, fichierExiste: () => true, trouver: async () => '/bin/codex',
      executer: async (b, a) => (a[0] === '--version' ? { code: 0, sortie: 'codex-cli 0.160.0' } : { code: 0, sortie: 'Logged in using ChatGPT' }),
      worktreeJetable: async () => ({ ok: true })
    },
    ...sur
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
  const routes = monter(deps())
  ok('3 routes montées', [...routes.keys()].sort().join() === '/kybernos-workers/check,/kybernos-workers/policy,/kybernos-workers/state')

  let r = await appeler(routes, '/kybernos-workers/state', { url: '/kybernos-workers/state' })
  ok('state : 200, profil par défaut, 4 workers', r.statut === 200 && r.json.profil === 'web' && r.json.workers.length === 4)
  ok('state : Codex monté et installé, Claude Code non, rien n’a encore été vérifié', r.json.workers.find((w) => w.id === 'codex').connexion === true && r.json.workers.find((w) => w.id === 'claude-code').connexion === false && r.json.workers.every((w) => w.dernier === null))
  ok('state : Hermes n’a pas de connexion (null, pas false)', r.json.workers.find((w) => w.id === 'hermes').connexion === null)
  ok('state : GET sans en-tête d’origine accepté (lecture seule)', (await appeler(routes, '/kybernos-workers/state', { url: '/kybernos-workers/state', origine: '' })).statut === 200)
  ok('state : origine étrangère refusée', (await appeler(routes, '/kybernos-workers/state', { url: '/kybernos-workers/state', origine: 'http://evil.example' })).statut === 403)
  ok('state : profil inconnu refusé', (await appeler(routes, '/kybernos-workers/state', { url: '/kybernos-workers/state?profile=../etc' })).statut === 400)
  ok('state : profil valide accepté', (await appeler(routes, '/kybernos-workers/state', { url: '/kybernos-workers/state?profile=autre' })).json.profil === 'autre')
  ok('state : POST refusé', (await appeler(routes, '/kybernos-workers/state', { methode: 'POST', corps: {} })).statut === 405)

  r = await appeler(routes, '/kybernos-workers/check', { methode: 'POST', corps: { worker: 'codex' } })
  ok('check : 200, prêt, 5 contrôles', r.statut === 200 && r.json.statut === 'pret' && r.json.controles.length === 5)
  r = await appeler(routes, '/kybernos-workers/state', { url: '/kybernos-workers/state' })
  ok('state se souvient du dernier contrôle', r.json.workers.find((w) => w.id === 'codex').dernier.statut === 'pret' && r.json.workers.find((w) => w.id === 'codex').dernier.quand.startsWith('2026-10-0'))
  ok('check : worker inconnu → 404', (await appeler(routes, '/kybernos-workers/check', { methode: 'POST', corps: { worker: 'zzz' } })).statut === 404)
  ok('check : origine absente refusée (écriture = strict)', (await appeler(routes, '/kybernos-workers/check', { methode: 'POST', corps: { worker: 'codex' }, origine: '' })).statut === 403)
  ok('check : content-type exigé', (await appeler(routes, '/kybernos-workers/check', { methode: 'POST', corps: { worker: 'codex' }, type: 'text/plain' })).statut === 415)
  ok('check : corps invalide → 400', (await appeler(routes, '/kybernos-workers/check', { methode: 'POST', corps: '{pas du json' })).statut === 400)
  ok('check : profil inconnu → 400', (await appeler(routes, '/kybernos-workers/check', { methode: 'POST', corps: { worker: 'codex', profile: 'nope' } })).statut === 400)

  let liberer
  const lent = monter(deps({ io: { ...deps().io, worktreeJetable: () => new Promise((resolve) => { liberer = () => resolve({ ok: true }) }) } }))
  const premiere = appeler(lent, '/kybernos-workers/check', { methode: 'POST', corps: { worker: 'codex' } })
  await new Promise((resolve) => setTimeout(resolve, 20))
  ok('deux vérifications en même temps : la seconde reçoit 409', (await appeler(lent, '/kybernos-workers/check', { methode: 'POST', corps: { worker: 'codex' } })).statut === 409)
  liberer(); await premiere
  ok('le verrou est relâché après la première', (await (async () => { const p = appeler(lent, '/kybernos-workers/check', { methode: 'POST', corps: { worker: 'codex' } }); await new Promise((resolve) => setTimeout(resolve, 20)); liberer(); return p })()).statut === 200)

  r = await appeler(routes, '/kybernos-workers/policy', { methode: 'POST', corps: { worker: 'codex', expose: true, background: false, dry: true } })
  ok('policy dry : annonce l’ajout sans rien écrire', r.statut === 200 && r.json.dry === true && r.json.action === 'ajout' && disque.ecritures.length === 0)
  r = await appeler(routes, '/kybernos-workers/policy', { methode: 'POST', corps: { worker: 'codex', expose: true, background: true } })
  ok('policy : 200, relance requise, nom de la sauvegarde', r.statut === 200 && r.json.restart === true && r.json.backup === 'cordis.patch.yml.bak-workers-codex-20261003-120000')
  ok('policy : la SAUVEGARDE est écrite avant le patch, avec l’ancien contenu', disque.ecritures[0][0] === 'sauvegarde' && disque.ecritures[0][2] === PATCH && disque.ecritures[1][0] === 'patch')
  ok('policy : le patch écrit contient la ligne voulue', etatProfil(disque.patch, codex).ligne.arrierePlan === true)
  r = await appeler(routes, '/kybernos-workers/policy', { methode: 'POST', corps: { worker: 'codex', expose: true, background: true } })
  ok('policy identique : « inchange », pas de relance, pas de nouvelle écriture', r.json.action === 'inchange' && r.json.restart === false && disque.ecritures.length === 2)
  r = await appeler(routes, '/kybernos-workers/policy', { methode: 'POST', corps: { worker: 'claude-code', expose: true, background: false } })
  ok('policy : connexion absente → 409 avec la raison', r.statut === 409 && r.json.error === 'connexion-absente')
  ok('policy : politique mal formée → 400', (await appeler(routes, '/kybernos-workers/policy', { methode: 'POST', corps: { worker: 'codex', expose: 'oui' } })).statut === 400)
  ok('policy : ZCode → 400 non supporté', (await appeler(routes, '/kybernos-workers/policy', { methode: 'POST', corps: { worker: 'zcode', expose: true, background: false } })).statut === 400)
  ok('policy : origine étrangère → 403', (await appeler(routes, '/kybernos-workers/policy', { methode: 'POST', corps: { worker: 'codex', expose: false, background: false }, origine: 'http://evil.example' })).statut === 403)
  const avant = disque.ecritures.length
  const casse = monter(deps({ ecrirePatch: () => { throw new Error('disque plein') } }))
  r = await appeler(casse, '/kybernos-workers/policy', { methode: 'POST', corps: { worker: 'codex', expose: false, background: false } })
  ok('policy : échec d’écriture → 500 avec la raison, sauvegarde déjà faite', r.statut === 500 && r.json.error === 'write-failed' && r.json.detail.includes('disque plein') && disque.ecritures.length === avant + 1)
  const vide = monter(deps({ lirePatch: () => null }))
  ok('policy : profil sans patch → 409', (await appeler(vide, '/kybernos-workers/policy', { methode: 'POST', corps: { worker: 'codex', expose: true, background: false } })).statut === 409)
}

console.log('── E/S réelles ──')
{
  const dossier = mkdtempSync(join(tmpdir(), 'kb-workers-test-'))
  try {
    const bin = join(dossier, 'bin'); mkdirSync(bin)
    writeFileSync(join(bin, 'monworker'), '#!/bin/sh\necho ok\n'); chmodSync(join(bin, 'monworker'), 0o755)
    writeFileSync(join(bin, 'pasexec'), 'x'); chmodSync(join(bin, 'pasexec'), 0o644)
    const env = { PATH: bin + delimiter + '/nulle/part' }
    ok('trouverBinaire : trouve un exécutable du PATH', trouverBinaire('monworker', env, 'linux') === join(bin, 'monworker'))
    ok('trouverBinaire : un fichier non exécutable n’est pas un binaire', trouverBinaire('pasexec', env, 'linux') === null)
    ok('trouverBinaire : absent → null, et pas de recherche hors PATH', trouverBinaire('introuvable-xyz', env, 'linux') === null)

    const sale = { PATH: '/usr/bin', HOME: '/h', ANTHROPIC_API_KEY: 'k', OPENAI_API_KEY: 'k', GITHUB_TOKEN: 't', MY_SECRET: 's', DB_PASSWORD: 'p', ANTHROPIC_BASE_URL: 'https://x', SSH_AUTH_SOCK: '/s' }
    const propre = envSansSecrets(sale)
    ok('envSansSecrets : clés, jetons, secrets, mots de passe retirés', !('ANTHROPIC_API_KEY' in propre) && !('OPENAI_API_KEY' in propre) && !('GITHUB_TOKEN' in propre) && !('MY_SECRET' in propre) && !('DB_PASSWORD' in propre) && !('SSH_AUTH_SOCK' in propre))
    ok('envSansSecrets : PATH, HOME et l’adresse d’API conservés (comme les connexions officielles)', propre.PATH === '/usr/bin' && propre.HOME === '/h' && propre.ANTHROPIC_BASE_URL === 'https://x')

    const home = join(dossier, 'dsh'); mkdirSync(join(home, 'profiles', 'web'), { recursive: true }); mkdirSync(join(home, 'profiles', 'vide'))
    writeFileSync(join(home, 'profiles', 'web', 'package.json'), '{}')
    writeFileSync(join(home, 'profiles', 'web', 'cordis.patch.yml'), PATCH)
    mkdirSync(join(home, 'profiles', 'web', 'node_modules', '@deepseek-ai', 'dsh-subagent-codex'), { recursive: true })
    const d = workersDeps(home, { PATH: process.env.PATH, FAKE_TOKEN: 'secret-ne-doit-pas-passer', FAKE_NAME: 'visible' })
    ok('profils : ne liste que les dossiers qui ont un package.json', d.profils().join() === 'web')
    ok('profil par défaut : web, ou DSH_PROFILE s’il existe', d.profilParDefaut(['web', 'x']) === 'web' && workersDeps(home, { DSH_PROFILE: 'x' }).profilParDefaut(['web', 'x']) === 'x' && workersDeps(home, { DSH_PROFILE: 'inconnu' }).profilParDefaut(['web']) === 'web')
    ok('lirePatch : lit le fichier ; absent → null', d.lirePatch('web') === PATCH && d.lirePatch('vide') === null)
    ok('paquetInstalle : lit node_modules du profil', d.io.paquetInstalle('web', '@deepseek-ai/dsh-subagent-codex') === true && d.io.paquetInstalle('web', '@deepseek-ai/dsh-subagent-claude-code') === false)
    d.sauvegarder('web', 'cordis.patch.yml.bak-workers-test', PATCH)
    d.ecrirePatch('web', PATCH + '# fin\n')
    ok('ecrirePatch : atomique, sans fichier temporaire oublié', readFileSync(join(home, 'profiles', 'web', 'cordis.patch.yml'), 'utf8').endsWith('# fin\n') && !readdirSync(join(home, 'profiles', 'web')).some((n) => n.includes('.tmp-')))
    ok('sauvegarder : le fichier existe avec l’ancien contenu', readFileSync(join(home, 'profiles', 'web', 'cordis.patch.yml.bak-workers-test'), 'utf8') === PATCH)

    let r = await d.io.executer(process.execPath, ['-e', 'console.log(process.env.FAKE_NAME + "|" + (process.env.FAKE_TOKEN === undefined))'])
    ok('executer : lance un vrai processus, sans le secret, avec le reste', r.code === 0 && r.sortie.trim() === 'visible|true')
    r = await d.io.executer(process.execPath, ['-e', 'process.exit(3)'])
    ok('executer : code retour transmis', r.code === 3)
    r = await d.io.executer('binaire-qui-nexiste-pas-xyz', [])
    ok('executer : binaire absent signalé comme tel', r.absent === true)
    r = await d.io.executer(process.execPath, ['-e', 'setTimeout(()=>{}, 5000)'], { delaiMs: 300 })
    ok('executer : délai dépassé signalé, le processus est tué', r.delai === true)

    const avant = readdirSync(tmpdir()).filter((n) => n.startsWith('kybernos-workers-')).length
    const w = await worktreeJetable()
    const apres = readdirSync(tmpdir()).filter((n) => n.startsWith('kybernos-workers-')).length
    ok('worktreeJetable (vrai git) : init, commit, worktree, écriture, relecture', w.ok === true && /git version/.test(w.detail ?? ''), JSON.stringify(w))
    ok('worktreeJetable : rien ne reste dans le dossier temporaire', avant === apres)
    const sans = await worktreeJetable(async () => ({ code: 127, sortie: '', absent: true }))
    ok('worktreeJetable : git absent → échec lisible, et nettoyage quand même', sans.ok === false && /git introuvable/.test(sans.detail) && readdirSync(tmpdir()).filter((n) => n.startsWith('kybernos-workers-')).length === avant)
    const casse = await worktreeJetable(async (b, args) => (args.includes('--version') ? { code: 0, sortie: 'git version x' } : { code: 128, sortie: 'fatal: boom\nautre', absent: false }))
    ok('worktreeJetable : une étape git qui échoue est rapportée avec son nom', casse.ok === false && /git init : fatal: boom/.test(casse.detail))

    const monte = []
    const ctx = { get: (n) => (n === 'webServer' ? { register: (x) => monte.push(x.path) } : undefined), effect: (fn) => fn(), inject: () => { throw new Error('ne doit pas être appelé') } }
    const oldHome = process.env.DSH_HOME; process.env.DSH_HOME = home
    apply(ctx)
    if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome
    ok('apply : monte les 3 routes quand webServer est déjà là', monte.length === 3)
    let differe = null
    apply({ get: () => undefined, effect: (fn) => fn(), inject: (liste, cb) => { differe = [liste, cb] } })
    ok('apply : sinon attend le service webServer', differe !== null && differe[0].join() === 'webServer')
    ok('apply : ne lève jamais, même avec un contexte cassé', (() => { try { apply({ get: () => { throw new Error('x') } }); return true } catch { return false } })())
  } finally { rmSync(dossier, { recursive: true, force: true }) }
}

console.log('── registre ──')
ok('4 workers : 2 connexions officielles, 1 connecteur MCP, 1 non supporté', WORKERS.map((w) => w.genre).join() === 'connexion,connexion,mcp,non-supporte')
ok('chaque connexion officielle a sa ligne d’outil, nommée comme le README du fournisseur', claude.outil.toolName === 'subagent_claude_code' && codex.outil.toolName === 'subagent_codex' && claude.outil.provider === 'claude-code' && codex.outil.provider === 'codex')
ok('ids d’outil uniques et propres à ce module', new Set(WORKERS.filter((w) => w.outil).map((w) => w.outil.id)).size === 2 && WORKERS.filter((w) => w.outil).every((w) => w.outil.id.startsWith('kybernos-workers-')))

console.log('\n' + (echecs === 0 ? '✓ ' : '✗ ') + (total - echecs) + '/' + total + ' checks')
process.exit(echecs === 0 ? 0 : 1)
