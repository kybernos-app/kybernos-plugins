// ─────────────────────────────────────────────────────────────────────────────
//  L'action hôte `move` : réordonner un message de la file sans le consommer
//
//  La file d'attente est une projection de l'hôte : le client ne peut pas la
//  réordonner seul. `updateQueue` ne connaissait que edit/remove/steer, et un
//  réordonnancement par remove + re-envoi aurait coûté les pièces jointes
//  (`remove` appelle fileUploads.retirePrompt).
//
//  Ce test PROUVE le code livré, sans redémarrer DSH, en extrayant le code réel
//  des paquets installés — pas une réimplémentation :
//
//   1. la classe ReactLoopInbox (dsh-agent-loop) est extraite du bundle et
//      instanciée contre un état de file factice : on vérifie l'ordre obtenu,
//      l'identité du message déplacé, et surtout qu'AUCUN message n'est
//      « discarded » (c'est l'événement qu'écoutent les tours de but, les
//      sous-agents et les pièces jointes) ;
//   2. le schéma de fil réellement exporté par dsh-api-session-controller est
//      importé et interrogé avec de vrais payloads : `move` accepté avec un
//      beforeId ou null, refusé sans beforeId ou avec un beforeId non textuel,
//      et edit/remove/steer intacts ;
//   3. trois canaris sur les copies du contrat qui doivent rester d'accord (les
//      deux codecs du contrôleur + le client distant) et sur le switch de
//      l'hôte, qui doit continuer de finir par assertNever ;
//   4. le client : la poignée, la sonde de capacité et le CSS — puis la COUTURE
//      du geste, extraite elle aussi (`cibleDeDepot` / `peindreDepot`) et pilotée
//      contre une géométrie factice : aucune ordonnée de la liste ne perd la
//      cible du glisser, et l'indicateur ne lâche plus la ligne suivie.
//
//  Usage : node scripts/check-queue-move.mjs --dsh <racine>   (obligatoire)
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { racineDeclaree, resoudreCopie, refuserRacine } from './racine-dsh.mjs'

// La racine est DÉCLARÉE, jamais devinée : un contrôle qui retombe sur
// l'installation Homebrew mesure une copie que DSH ne charge peut-être pas, et
// rend un verdict vert sur la mauvaise installation (voir racine-dsh.mjs).
const racine = racineDeclaree(process.argv.slice(2))
const resolution = resoudreCopie(racine, '@deepseek-ai/dsh-agent-loop')
if (resolution.copie === null) refuserRacine(resolution.motif, 'check-queue-move.mjs')
const P = (p) => join(resolution.base, 'node_modules/@deepseek-ai', p)

let total = 0
const ok = (nom, condition, detail = '') => {
  total += 1
  console.log(`${condition ? '  ✓' : '  ✗'} ${nom}${detail === '' ? '' : ` — ${detail}`}`)
  if (!condition) process.exitCode = 1
}

const AGENT_LOOP = P('dsh-agent-loop/lib/index.js')
const CONTRÔLEUR = P('dsh-api-session-controller/lib/index.js')
const TYPERT_HOST = P('dsh-api-session-controller/lib/typert.host.js')
const TYPERT_CLIENT = P('dsh-api-session-controller/lib/typert.remote-client.js')
const REMOTE_CLIENT = P('dsh-api-remotes/lib/client.js')
const CLIENT_CONVERSATION = P('dsh-client-ui-conversation/lib/client.js')

// ── 1. la classe de la file, extraite du bundle et mise à l'épreuve ───────────
/** Le texte de `var ReactLoopInbox = class { … };`, accolades équilibrées. */
function extraireClasseInbox(src) {
  const debut = src.indexOf('var ReactLoopInbox = class {')
  if (debut < 0) throw new Error('classe ReactLoopInbox introuvable dans dsh-agent-loop — le bundle a changé')
  let i = src.indexOf('{', debut)
  let profondeur = 0
  for (let j = i; j < src.length; j += 1) {
    if (src[j] === '{') profondeur += 1
    else if (src[j] === '}') {
      profondeur -= 1
      if (profondeur === 0) return src.slice(debut, j + 1) + ';'
    }
  }
  throw new Error('classe ReactLoopInbox non refermée')
}
const extrait = extraireClasseInbox(readFileSync(AGENT_LOOP, 'utf8'))
// eslint-disable-next-line no-new-func -- on évalue le code livré, à dessein
const ReactLoopInbox = new Function(`${extrait}\nreturn ReactLoopInbox;`)()

/** Une boîte de réception factice : l'état de projection, l'événement durable et
 *  les notifications. `append` applique le splice comme le fait la projection. */
function boite({ nextTurn = [], nextStep = [] } = {}) {
  const state = { 'next-turn': [...nextTurn], 'next-step': [...nextStep] }
  const evenements = []
  const notifications = []
  const session = {
    id: 's-essai',
    append(name, data) {
      if (name === 'agent/inbox/spliced') {
        const liste = state[data.target]
        liste.splice(data.start, data.removedCount === undefined ? 0 : data.removedCount, ...data.inserted)
      }
      evenements.push({ name, data })
      return { data }
    },
  }
  const projections = { stateOf: () => state }
  const dispatch = { emit: (name, payload) => notifications.push({ name, payload }) }
  return { inbox: new ReactLoopInbox(projections, session, dispatch), state, evenements, notifications }
}
const msg = (id) => ({ id, content: [], source: { kind: 'user', rpcId: `rpc-${id}` } })
const ordre = (state, lane = 'next-turn') => state[lane].map((m) => m.id).join(',')
const splices = (b) => b.evenements.filter((e) => e.name === 'agent/inbox/spliced')

{
  const b = boite({ nextTurn: [msg('a'), msg('b'), msg('c')] })
  const avant = b.state['next-turn'][2]
  const issu = b.inbox.move('c', 'a')
  ok('déplacer vers le haut change l’ordre', issu === 'moved' && ordre(b.state) === 'c,a,b', `${issu} → ${ordre(b.state)}`)
  ok('le message déplacé garde son identité (même objet)', b.state['next-turn'][0] === avant)
  ok('sa provenance est intacte (aucune pièce jointe retirée)', b.state['next-turn'][0].source.rpcId === 'rpc-c')

  const s = splices(b)
  ok('l’événement durable ne dit jamais « canceled »', s.every((e) => e.data.outcome === undefined),
    s.map((e) => `outcome=${String(e.data.outcome)}`).join(' '))
  ok('aucun message n’est discarded (tours de but, sous-agents, uploads intacts)',
    !b.notifications.some((n) => n.name === 'agent/inbox/discarded'))
  ok('le déplacement est bien notifié comme insertion',
    b.notifications.filter((n) => n.name === 'agent/inbox/inserted').length === 1)
  ok('aucun doublon dans les deux files', new Set([...b.state['next-turn'], ...b.state['next-step']].map((m) => m.id)).size === 3)
}

{
  const b = boite({ nextTurn: [msg('a'), msg('b'), msg('c')] })
  const issu = b.inbox.move('a', null)
  ok('beforeId null déplace en fin de file', issu === 'moved' && ordre(b.state) === 'b,c,a', `${issu} → ${ordre(b.state)}`)
}

{
  const b = boite({ nextTurn: [msg('a'), msg('b'), msg('c')] })
  const avant = b.evenements.length
  ok('déjà juste avant la cible : rien ne bouge', b.inbox.move('a', 'b') === 'same' && ordre(b.state) === 'a,b,c')
  ok('déjà en fin de file avec null : rien ne bouge', b.inbox.move('c', null) === 'same')
  ok('se déplacer devant soi-même : rien ne bouge', b.inbox.move('b', 'b') === 'same')
  ok('aucun événement durable écrit quand rien ne bouge', b.evenements.length === avant)
}

{
  const b = boite({ nextTurn: [msg('a')], nextStep: [msg('s1'), msg('s2')] })
  ok('identité inconnue : refus net', b.inbox.move('zz', 'a') === undefined)
  ok('cible inconnue : refus net', b.inbox.move('a', 'zz') === undefined)
  ok('croisement de files : refus explicite', b.inbox.move('a', 's1') === 'cross-lane')
  ok('la file d’étape se réordonne aussi', b.inbox.move('s2', 's1') === 'moved' && ordre(b.state, 'next-step') === 's2,s1')
  ok('une file ne perd rien en réordonnant', b.state['next-turn'].length === 1 && b.state['next-step'].length === 2)
}

// ── 2. le schéma de fil réellement exporté par le paquet installé ─────────────
{
  const m = await import(`file://${TYPERT_HOST}`)
  const param = m.TYPERT.invocations.find((x) => x.method === 'updateQueue').parameters[0]
  const schema = param.codec.create()
  const base = { sessionId: 's1', itemId: 'i1' }
  const cas = [
    ['move avec beforeId', { ...base, action: { kind: 'move', beforeId: 'i2' } }, true],
    ['move avec beforeId null (fin de file)', { ...base, action: { kind: 'move', beforeId: null } }, true],
    ['move sans beforeId', { ...base, action: { kind: 'move' } }, false],
    ['move avec beforeId non textuel', { ...base, action: { kind: 'move', beforeId: 42 } }, false],
    ['edit (inchangé)', { ...base, action: { kind: 'edit', content: [{ type: 'text', text: 'salut' }] } }, true],
    ['remove (inchangé)', { ...base, action: { kind: 'remove' } }, true],
    ['steer (inchangé)', { ...base, action: { kind: 'steer' } }, true],
    ['action inconnue', { ...base, action: { kind: 'nope' } }, false],
  ]
  for (const [nom, valeur, attendu] of cas) {
    const obtenu = schema.safeParse(valeur).success
    ok(`schéma de fil — ${nom}`, obtenu === attendu, obtenu ? 'accepté' : 'refusé')
  }
}

// ── 3. les copies du contrat doivent rester d'accord ──────────────────────────
const lire = (p) => readFileSync(p, 'utf8')
{
  const copies = [
    ['codec hôte', TYPERT_HOST, `'kind': z.literal("move").readonly(),`],
    ['codec client distant', TYPERT_CLIENT, `'kind': z.literal("move").readonly(),`],
    ['client navigateur', REMOTE_CLIENT, `"kind": literal("move").readonly()`],
  ]
  for (const [nom, chemin, marque] of copies) {
    const src = lire(chemin)
    ok(`copie du contrat — ${nom} connaît move`, src.includes(marque), chemin.replace(`${racine}/`, ''))
    ok(`copie du contrat — ${nom} type beforeId en texte ou null`,
      /move"\)\.readonly\(\),[\s\S]{0,80}beforeId['"]?:\s*(?:z\.)?union\(\[(?:z\.)?string\(\), (?:z\.)?(?:null\(\)|literal\(null\))\]\)/.test(src))
  }
  const src = lire(CONTRÔLEUR)
  ok('l’hôte traite le cas move', /case "move": \{/.test(src))
  ok('l’hôte appelle la méthode de la file', /agent\.inbox\.move\(request\.itemId, request\.action\.beforeId\)/.test(src))
  ok('l’hôte refuse la croisée de files', src.includes('session/queue-move-across-lanes'))
  const corps = src.slice(src.indexOf('async updateQueue(request)'), src.indexOf('cancel(request)'))
  ok('le switch finit toujours par assertNever', /default: assertNever\(request\.action, "queue action"\);\n\t\t}/.test(corps))
  const loop = lire(AGENT_LOOP)
  ok('la méthode move vit dans la boîte de réception', /move\(messageId, beforeId\) \{/.test(loop))
  ok('le retrait du déplacement n’annule rien (discardRemoved désactivé)', /this\.mutate\(source\.target, source\.index, 1, \[\], false\)/.test(loop))
}

// ── 4. le client : la poignée, le geste, et la sonde qui protège ──────────────
//  Ces vérifications ne jugent pas le rendu (il a été éprouvé dans la vraie page) :
//  elles constatent que le câblage client est toujours là après une mise à jour de
//  DSH, qui réécrit ces fichiers et emporterait silencieusement la fonction.
{
  const src = lire(CLIENT_CONVERSATION)
  ok('le client envoie l’action move', /kind: "move"/.test(src))
  ok('le client sonde l’hôte avant d’afficher une poignée', /function queueMoveSupported\(updateQueue\)/.test(src) && /queue-item-not-found/.test(src))
  ok('la sonde est mise en cache pour la page', /let queueMoveProbe = null;/.test(src))
  ok('la poignée n’apparaît qu’avec plusieurs messages', /moveReady && queue\.length > 1/.test(src))
  ok('la couture d’indication est posée sur la ligne visée', /dropBefore/.test(src) && /dropEnd/.test(src))
  ok('la bande des messages pas encore admis est refusée', /data-pending-row/.test(src) && /dropRefused/.test(src))
  ok('la ligne suivie est estompée', /rowDragging/.test(src))
  ok('la poignée est une vraie commande, étiquetée', /"aria-label": t\("queue\.reorder"\)/.test(src))
  ok('les deux libellés existent (zh et en)', (src.match(/"queue\.reorder":/g) ?? []).length === 2 && (src.match(/"queue\.moveFailed":/g) ?? []).length === 2)
  ok('Alt+flèche déplace au clavier', /altKey/.test(src) && /deplacerAuClavier/.test(src))
  ok('le CSS de la poignée et des coutures est livré avec le composant',
    /_7yHdaG_grip\{/.test(src) && /_7yHdaG_dropBefore\{/.test(src) && /"grip": "_7yHdaG_grip"/.test(src))
}

// ── 4 bis. la couture du geste, extraite du bundle et mise à l'épreuve ────────
//  Ces assertions ne lisent pas le texte : elles ÉVALUENT la fonction livrée
//  contre une géométrie factice, sans React. Elles gardent le défaut réparé le
//  23/09/2026 — `cibleDeDepot` rendait `null` dès qu'on dépassait le haut d'une
//  ligne, et `peindreDepot` en profitait pour oublier le geste (`setDrag(null)`) :
//  passer d'une ligne à l'autre, ou simplement descendre la première, tuait le
//  glisser sans rien dire. Quatre de ces huit assertions échouent sur l'ancien
//  code (bandes mortes, moitié basse, au-dessus de la liste, indicateur) : mesuré
//  le 23/09/2026 sur le bloc d'avant, 30 ordonnées perdues entre y = 88 et 135.
{
  /** Le texte de `const X = (…) => { … }`, accolades équilibrées. */
  const extraireFleche = (src, entete) => {
    const debut = src.indexOf(entete)
    if (debut < 0) throw new Error('couture introuvable dans le bundle : ' + entete)
    let profondeur = 0
    for (let j = src.indexOf('{', debut); j < src.length; j += 1) {
      if (src[j] === '{') profondeur += 1
      else if (src[j] === '}') {
        profondeur -= 1
        if (profondeur === 0) return src.slice(debut, j + 1)
      }
    }
    throw new Error('couture non refermée : ' + entete)
  }
  const src = lire(CLIENT_CONVERSATION)
  const corpsCible = extraireFleche(src, 'const cibleDeDepot = (y) => {')
  const corpsPeinture = extraireFleche(src, 'const peindreDepot = (id, y) => {')
  /** Deux lignes de 36 px empilées à partir de y = 100, une bande en attente
   *  optionnelle juste dessous : la même géométrie qu'une vraie file. */
  const geometrie = (pendante = null) => {
    const lignes = [0, 1].map((i) => ({
      dataset: { queueId: i === 0 ? 'a' : 'b' },
      getBoundingClientRect: () => ({ top: 100 + i * 36, height: 36 }),
    }))
    const liste = {
      querySelector: (sel) => (sel === '[data-pending-row]' ? pendante : null),
      querySelectorAll: (sel) => (sel === '[data-queue-id]' ? lignes : []),
    }
    return { liste, haut: 100, bas: 172 }
  }
  const couture = (geo) => new Function('listRef', `${corpsCible}\nreturn cibleDeDepot;`)({ current: geo.liste })
  const seam = (cible, y) => {
    const c = cible(y)
    if (c === null) return 'null'
    if (c.refuse === true) return 'refus'
    return c.atEnd === true ? 'fin' : c.ligne.dataset.queueId
  }
  const geo = geometrie()
  const cible = couture(geo)
  const mortes = []
  for (let y = geo.haut - 12; y <= geo.bas + 12; y += 1) if (cible(y) === null) mortes.push(y)
  ok('aucune bande morte ne perd la cible du geste', mortes.length === 0, mortes.slice(0, 6).join(',') + (mortes.length > 6 ? '…' : ''))
  ok('la moitié haute d’une ligne dépose avant elle', seam(cible, geo.haut + 5) === 'a', seam(cible, geo.haut + 5))
  ok('la moitié basse dépose avant la suivante', seam(cible, geo.haut + 35) === 'b', seam(cible, geo.haut + 35))
  ok('sous la dernière ligne, on dépose en fin de file', seam(cible, geo.bas + 5) === 'fin', seam(cible, geo.bas + 5))
  ok('au-dessus de la liste, on reste sur la première couture', seam(cible, geo.haut - 10) === 'a', seam(cible, geo.haut - 10))
  const pendante = { getBoundingClientRect: () => ({ top: 172, height: 36 }) }
  const cibleAvecAttente = couture(geometrie(pendante))
  ok('la bande des messages pas encore admis est refusée, pas oubliée', seam(cibleAvecAttente, 190) === 'refus', seam(cibleAvecAttente, 190))
  ok('au-dessus de la bande, la couture reste offerte', seam(cibleAvecAttente, 105) === 'a', seam(cibleAvecAttente, 105))
  const peintures = []
  const peindre = new Function('listRef', 'setDrag', `${corpsCible}\n${corpsPeinture}\nreturn peindreDepot;`)({ current: geo.liste }, (v) => peintures.push(v))
  peindre('a', geo.haut + 35)
  ok('l’indicateur ne lâche pas la ligne quand la couture manque',
    peintures.length === 1 && peintures[0] !== null && peintures[0].id === 'a' && peintures[0].atEnd !== true,
    JSON.stringify(peintures))
}

console.log(`${total} assertions passent.`)
