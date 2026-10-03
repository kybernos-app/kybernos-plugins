#!/usr/bin/env node
/**
 * Harnais de la moitié HÔTE de `kybernos-relance` — l'outil `relancer_dsh`.
 *
 * Rien n'est lancé pour de vrai : le « script de relance » est un faux qui note
 * ses arguments, `sessionController` et `approval` sont des doublures. On
 * vérifie donc exactement le contrat qui compte :
 *   · aucune autre session  → pas de panneau, relance détachée ;
 *   · d'autres sessions     → panneau d'approbation, et RIEN n'est coupé sans
 *                             « allowed-once » (rejet, annulation, unavailable,
 *                             canal absent = échec fermé) ;
 *   · le repli `defineTool` produit la même forme que `defineTool` ;
 *   · `sessionController` absent → repli `actives --json`.
 *
 * Usage : node kybernos-relance/test-host.mjs [--verbeux]
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ICI = dirname(fileURLToPath(import.meta.url))
const VERBOSE = process.argv.includes('--verbeux') || process.argv.includes('-v')

// DSH_HOME est lu à l'import du module : on le pose AVANT le `import()` dynamique.
const FAUX_HOME = mkdtempSync(join(tmpdir(), 'kybernos-relance-test-'))
mkdirSync(join(FAUX_HOME, 'tools'), { recursive: true })
const JOURNAL_ARGV = join(FAUX_HOME, 'argv.jsonl')
const FAUX_SCRIPT = join(FAUX_HOME, 'tools', 'dsh-relance.mjs')
writeFileSync(FAUX_SCRIPT, `
import { appendFileSync } from 'node:fs'
const argv = process.argv.slice(2)
appendFileSync(${JSON.stringify(JOURNAL_ARGV)}, JSON.stringify(argv) + '\\n')
if (argv[0] === 'actives') {
  process.stdout.write(JSON.stringify({ current: 'session-me', others: ${JSON.stringify([{ sessionId: 'session-fallback', title: 'Repli CLI' }])}, journal: null, supervision: null }))
}
`)
process.env.DSH_HOME = FAUX_HOME

const module = await import(join(ICI, 'index.js'))
const { optionsOutil, definitionLiteral, specDefineTool, filtrerActives, enregistrer, name } = module

const SESS_ME = 'session-me'
const SESS_A = 'session-a'
const SESS_B = 'session-b'
const SESS_CHILD = 'session-child'

let pass = 0
let fail = 0
const failures = []
function check (nom, condition, detail) {
  if (condition) { pass++; console.log(`  ✓ ${nom}`) }
  else { fail++; failures.push(nom); console.log(`  ✗ ${nom}${detail === undefined ? '' : ` — ${detail}`}`) }
}

function ligne (running, extra = {}) {
  return { sessionId: extra.sessionId ?? SESS_A, running, agentAvailable: true, updatedAt: Date.now(), blank: false, ...extra, projections: { kind: 'sequenced', values: { title: extra.titre ?? 'Titre' } } }
}

/** Doublure de contexte : `approval` et `sessionController` paramétrables. */
function fauxCtx ({ items, approvalOutcome = 'allowed-once', sansControleur = false, sansApproval = false, politique = 'ask' } = {}) {
  const appels = { approval: [] }
  return {
    appels,
    get (cle) {
      if (cle === 'tools') return { register () {} }
      if (cle === 'webServer') return { port: 3099 }
      if (cle === 'sessionController') {
        if (sansControleur) return undefined
        return { list: async () => ({ items, hasMore: false }) }
      }
      if (cle === 'approval') {
        if (sansApproval) return undefined
        return {
          request: async (requete) => { appels.approval.push(requete); return approvalOutcome },
          effectivePolicy: (session) => (session === undefined || session === null ? undefined : politique),
        }
      }
      return undefined
    },
    inject () {},
  }
}

function execFactice (signal) {
  return { agent: { id: SESS_ME, session: { id: SESS_ME } }, callId: 'call-1', ...(signal !== undefined ? { signal } : {}) }
}

function lireArgv () {
  if (!existsSync(JOURNAL_ARGV)) return []
  return readFileSync(JOURNAL_ARGV, 'utf8').split('\n').filter((l) => l.length > 0).map((l) => JSON.parse(l))
}

function viderArgv () { writeFileSync(JOURNAL_ARGV, '') }

/** Attend l'écriture du faux script (le spawn est détaché : il rend la main tout de suite). */
async function attendreArgv (attendu, timeoutMs = 5000) {
  const fin = Date.now() + timeoutMs
  while (Date.now() < fin) {
    if (lireArgv().length >= attendu) return lireArgv()
    await new Promise((r) => setTimeout(r, 50))
  }
  return lireArgv()
}

async function main () {
  console.log(`kybernos-relance · hôte · faux DSH_HOME=${FAUX_HOME}\n`)

  console.log('1. filtrage des sessions (natif `running`)')
  const items = [
    ligne(true, { sessionId: SESS_ME }),
    ligne(true, { sessionId: SESS_A, titre: 'Le chantier voisin' }),
    ligne(true, { sessionId: SESS_CHILD, origin: 'subagent', parentSessionId: SESS_A }),
    ligne(false, { sessionId: SESS_B }),
  ]
  const filtrees = filtrerActives(items, SESS_ME)
  check('garde la session qui tourne', filtrees.some((r) => r.sessionId === SESS_A))
  check('écarte la session courante', !filtrees.some((r) => r.sessionId === SESS_ME))
  check('écarte les enfants subagents', !filtrees.some((r) => r.sessionId === SESS_CHILD))
  check('écarte les sessions à l’arrêt', !filtrees.some((r) => r.sessionId === SESS_B))

  console.log('\n2. aucune autre session — pas de panneau, relance détachée')
  viderArgv()
  const calme = fauxCtx({ items: [ligne(true, { sessionId: SESS_ME }), ligne(false, { sessionId: SESS_B })] })
  let resultat = await optionsOutil(calme).execute({ motif: 'test calme', delai: 7 }, execFactice())
  check('coupe demandée', resultat.coupe === true, JSON.stringify(resultat))
  check('aucune approbation demandée', calme.appels.approval.length === 0)
  const argv = await attendreArgv(1)
  check('le script est appelé', argv.length === 1, JSON.stringify(argv))
  const ligne0 = argv[0] ?? []
  check('passe --avec-autres', ligne0.includes('--avec-autres'))
  check('passe la session courante', ligne0[ligne0.indexOf('--session') + 1] === SESS_ME)
  check('passe le délai demandé', ligne0[ligne0.indexOf('--delay') + 1] === '7')
  check('passe le motif', ligne0[ligne0.indexOf('--motif') + 1] === 'test calme')
  check('passe le port du serveur', ligne0[ligne0.indexOf('--port') + 1] === '3099')

  console.log('\n3. d’autres sessions tournent — le panneau décide')
  viderArgv()
  const charge = fauxCtx({ items: [ligne(true, { sessionId: SESS_A, titre: 'Le chantier voisin' })] })
  resultat = await optionsOutil(charge).execute({}, execFactice())
  check('une approbation est demandée', charge.appels.approval.length === 1)
  const requete = charge.appels.approval[0] ?? {}
  check('l’agent qui demande est transmis', requete.agent?.id === SESS_ME)
  check('le motif nomme les sessions actives', /Le chantier voisin/.test(String(requete.reason ?? '')))
  check('le motif nomme le redémarrage', /Redémarrage de DSH/.test(String(requete.reason ?? '')))
  check('le toolName est celui de l’outil', requete.toolName === 'relancer_dsh')
  check('coupe après accord', resultat.coupe === true, JSON.stringify(resultat))
  check('rapporte l’approbation', resultat.approbation === 'allowed-once')
  check('annonce les sessions actives', (resultat.sessions_actives ?? []).length === 1)
  const argv2 = await attendreArgv(1)
  check('la relance part bien', argv2.length === 1, JSON.stringify(argv2))

  console.log('\n4. refus, annulation, canal absent — échec fermé, rien n’est coupé')
  for (const [issue, attendu] of [['rejected', 'refus'], ['cancelled', 'annul'], ['unavailable', 'indisponible']]) {
    viderArgv()
    const ctx = fauxCtx({ items: [ligne(true, { sessionId: SESS_A })], approvalOutcome: issue })
    const res = await optionsOutil(ctx).execute({}, execFactice())
    check(`« ${issue} » : pas de coupe`, res.coupe === false, JSON.stringify(res))
    check(`« ${issue} » : le script n’est pas lancé`, lireArgv().length === 0)
    check(`« ${issue} » : l’issue est rapportée`, res.raison === issue, attendu)
  }
  viderArgv()
  const sansCanal = fauxCtx({ items: [ligne(true, { sessionId: SESS_A })], sansApproval: true })
  const resSansCanal = await optionsOutil(sansCanal).execute({}, execFactice())
  check('sans canal d’approbation : pas de coupe', resSansCanal.coupe === false)
  check('sans canal d’approbation : raison explicite', resSansCanal.raison === 'approbation_indisponible')
  check('sans canal d’approbation : aucun script lancé', lireArgv().length === 0)

  console.log('\n4 bis. politique « never » — le panneau ne peut pas s’ouvrir, personne n’est consulté')
  viderArgv()
  const jamais = fauxCtx({ items: [ligne(true, { sessionId: SESS_A })], politique: 'never' })
  const resJamais = await optionsOutil(jamais).execute({}, execFactice())
  check('« never » : pas de coupe', resJamais.coupe === false, JSON.stringify(resJamais))
  check('« never » : raison distincte du refus utilisateur', resJamais.raison === 'politique_never', String(resJamais.raison))
  check('« never » : AUCUNE demande au panneau', jamais.appels.approval.length === 0, `appels=${jamais.appels.approval.length}`)
  check('« never » : le message ne prétend pas que l’utilisateur a refusé', !/utilisateur a refus/i.test(String(resJamais.message)), String(resJamais.message).slice(0, 120))
  check('« never » : le message dit comment tester', /workspace-write|\/permission/.test(String(resJamais.message)), String(resJamais.message).slice(0, 120))
  check('« never » : les sessions actives sont listées', resJamais.sessions_actives?.[0]?.sessionId === SESS_A)
  check('« never » : aucun script lancé', lireArgv().length === 0)
  const avecSession = fauxCtx({ items: [ligne(true, { sessionId: SESS_A })], politique: 'ask' })
  const resAsk = await optionsOutil(avecSession).execute({}, execFactice())
  check('politique « ask » : le panneau est bien demandé', avecSession.appels.approval.length === 1)
  check('politique « ask » : la coupe part après l’accord', resAsk.coupe === true, JSON.stringify(resAsk).slice(0, 120))
  await attendreArgv(1)
  // Service d'approbation sans `effectivePolicy` (montage plus ancien) : on ne
  // devine pas la politique, on retombe sur le comportement historique.
  viderArgv()
  const sansPolitique = fauxCtx({ items: [ligne(true, { sessionId: SESS_A })] })
  const getOrigine = sansPolitique.get.bind(sansPolitique)
  sansPolitique.get = (cle) => (cle === 'approval'
    ? { request: async (r) => { sansPolitique.appels.approval.push(r); return 'allowed-once' } }
    : getOrigine(cle))
  const resSansPolitique = await optionsOutil(sansPolitique).execute({}, execFactice())
  check('service sans `effectivePolicy` : le panneau est quand même demandé', sansPolitique.appels.approval.length === 1)
  check('service sans `effectivePolicy` : la coupe part après l’accord', resSansPolitique.coupe === true, JSON.stringify(resSansPolitique).slice(0, 120))
  await attendreArgv(1)

  console.log('\n5. repli quand `sessionController` est absent')
  viderArgv()
  const sansControleur = fauxCtx({ sansControleur: true })
  const resRepli = await optionsOutil(sansControleur).execute({}, execFactice())
  const argvRepli = await attendreArgv(1)
  check('le repli interroge la CLI (`actives`)', argvRepli.some((a) => a[0] === 'actives'), JSON.stringify(argvRepli))
  check('le repli trouve la session active', resRepli.sessions_actives?.[0]?.sessionId === 'session-fallback', JSON.stringify(resRepli))
  check('le repli demande l’approbation du panneau', sansControleur.appels.approval.length === 1)

  console.log('\n6. forme de la définition (repli `defineTool` identique)')
  const def = optionsOutil(fauxCtx({ items: [] }))
  const litt = definitionLiteral(def)
  check('name', litt.name === 'relancer_dsh')
  check('description non vide', typeof litt.description === 'string' && litt.description.length > 40)
  check('paramètres compilés', litt.parameters?.type === 'object' && litt.parameters.properties?.motif?.type === 'string')
  check('délai déclaré en nombre', litt.parameters.properties?.delai?.type === 'number')
  check('schéma de sortie `{}`', JSON.stringify(litt.output?.schema) === '{}')
  check('render rend du texte', litt.output.render({}, { coupe: true })[0]?.type === 'text')
  check('execute transmis', typeof litt.execute === 'function')
  // Le vrai `defineTool` n'existe que là où DSH est installé. Absent (CI, bac
  // vierge) : on le dit, la comparaison est SAUTÉE — elle n'est pas comptée verte.
  const CHEMINS_TOOLS = [
    process.env.DSH_TOOLS_PATH,
    join(process.env.HOME ?? '', '.dsh', 'profiles', 'web', 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js'),
    '/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js',
    '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js',
  ].filter((c) => typeof c === 'string' && c.length > 0 && existsSync(c))
  if (CHEMINS_TOOLS.length === 0) {
    console.log('  · defineTool réel absent de cette machine : comparaison avec le repli SAUTÉE (pas verte)')
  } else try {
    const { defineTool } = await import(CHEMINS_TOOLS[0])
    // On compile la MÊME intention par l'API officielle : le repli doit rendre la même forme.
    const compile = defineTool(specDefineTool(def))
    check('specDefineTool accepté par defineTool', compile.name === 'relancer_dsh')
    check('paramètres identiques à defineTool', JSON.stringify(compile.parameters) === JSON.stringify(litt.parameters),
      `${JSON.stringify(compile.parameters)} vs ${JSON.stringify(litt.parameters)}`)
    check('sortie identique à defineTool', JSON.stringify(compile.output.schema) === JSON.stringify(litt.output.schema))
  } catch (e) {
    check('defineTool importable (sinon le repli n’est pas vérifié)', false, String(e?.message ?? e))
  }

  console.log('\n7. enregistrement réel de l’outil (le bug de forme est arrivé là)')
  const enregistres = []
  const ctxOutil = {
    tools: { register: (t) => enregistres.push(t) },
    get: (cle) => (cle === 'tools' ? ctxOutil.tools : undefined),
  }
  await enregistrer(ctxOutil)
  check('un outil est enregistré', enregistres.length === 1, JSON.stringify(enregistres.map((t) => t?.name)))
  check('il porte le bon nom', enregistres[0]?.name === 'relancer_dsh', String(enregistres[0]?.name))
  check('il porte un schéma de sortie', enregistres[0]?.output?.schema !== undefined)
  check('il porte un render', typeof enregistres[0]?.output?.render === 'function')
  check('il porte un execute', typeof enregistres[0]?.execute === 'function')
  check('les paramètres sont un schéma JSON', enregistres[0]?.parameters?.type === 'object')

  console.log('\n8. nom du plugin')
  check('le plugin garde son nom', name === 'kybernos-relance')

  console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} réussite(s), ${fail} échec(s)`)
  if (fail > 0) {
    console.log('\néchecs :')
    for (const f of failures) console.log(`  · ${f}`)
  }
  return fail === 0 ? 0 : 1
}

let code = 1
try { code = await main() } catch (e) { console.error(`✗ harnais interrompu : ${e?.stack ?? e}`); code = 1 } finally {
  if (code === 0 && !VERBOSE) rmSync(FAUX_HOME, { recursive: true, force: true })
  else console.log(`(faux DSH_HOME conservé : ${FAUX_HOME})`)
}
process.exit(code)
