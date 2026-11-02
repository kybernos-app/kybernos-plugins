// ─────────────────────────────────────────────────────────────────────────────
//  The host action `move`: reorder a queued message without consuming it
//
//  The waiting queue is a projection of the host: the client cannot reorder it
//  by itself. `updateQueue` only knew edit/remove/steer, and reordering by
//  remove + resend would have cost the attachments (`remove` calls
//  fileUploads.retirePrompt).
//
//  This check PROVES the shipped code, without restarting DSH, by extracting the
//  real code of the installed packages (not a reimplementation):
//
//   1. the ReactLoopInbox class (dsh-agent-loop) is extracted from the bundle and
//      instantiated against a fake queue state: it checks the resulting order,
//      the identity of the moved message and, above all, that NO message is
//      "discarded" (the event goal turns, sub-agents and attachments listen to);
//   2. the wire schema really exported by dsh-api-session-controller is imported
//      and queried with real payloads: `move` accepted with a beforeId or null,
//      refused without a beforeId or with a non-text beforeId, and
//      edit/remove/steer untouched;
//   3. three canaries on the copies of the contract that must stay in agreement
//      (the controller's two codecs + the remote client) and on the host's
//      switch, which must keep ending with assertNever;
//   4. the client: the handle, the capability probe and the CSS, then the SEAM
//      of the gesture, extracted too (`cibleDeDepot` / `peindreDepot`) and driven
//      against a fake geometry: no ordinate of the list loses the drag target,
//      and the indicator no longer lets go of the followed row.
//
//  Usage: node scripts/check-queue-move.mjs --dsh <root>   (required)
//
//  The patch this measures is RETIRED from engine 0.2.0-rc.2 on (scripts/patches.json):
//  on such an engine the check says SKIPPED and why, and exits 0.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { racineDeclaree, resoudreCopie, refuserRacine, versionDuMoteur } from './racine-dsh.mjs'
import { motifDeRetrait } from './lifecycle-engine.mjs'

// The root is DECLARED, never guessed: a check that falls back on the Homebrew
// installation measures a copy DSH may not load, and returns a green verdict on
// the wrong installation (see racine-dsh.mjs).
const racine = racineDeclaree(process.argv.slice(2))
const resolution = resoudreCopie(racine, '@deepseek-ai/dsh-agent-loop')
if (resolution.copie === null) refuserRacine(resolution.motif, 'check-queue-move.mjs')
const P = (p) => join(resolution.base, 'node_modules/@deepseek-ai', p)

// This check measures the `queue-move` PATCH (scripts/patch-dsh-queue-move.mjs). Since engine 0.2.0-rc.2 it is no longer applied (kybernos-flow is enough,
// scripts/patches.json › retire_depuis_moteur): on such an engine the queue class has no `move` action and every line would go red for a reason that is
// not a product defect. The check is therefore SKIPPED, says why and exits 0; it keeps all its code for an older engine of the compatibility range.
{
  const version = versionDuMoteur(resolution.moteur)
  const entree = JSON.parse(readFileSync(new URL('./patches.json', import.meta.url), 'utf8')).find((x) => x.id === 'queue-move')
  const retire = motifDeRetrait(entree, version)
  if (retire !== null) {
    console.log('SKIPPED: the queue-move engine patch check — the patch is retired on engine ' + version + ' (' + retire + ')')
    console.log('check-queue-move — 0 checks run, SKIPPED (an engine older than the retirement threshold still carries the patch and is measured by this script)')
    process.exit(0)
  }
}

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

// ── 1. the queue class, extracted from the bundle and put to the test ─────────
/** The text of `var ReactLoopInbox = class { … };`, braces balanced. */
function extraireClasseInbox(src) {
  const debut = src.indexOf('var ReactLoopInbox = class {')
  if (debut < 0) throw new Error('ReactLoopInbox class not found in dsh-agent-loop — the bundle changed')
  let i = src.indexOf('{', debut)
  let profondeur = 0
  for (let j = i; j < src.length; j += 1) {
    if (src[j] === '{') profondeur += 1
    else if (src[j] === '}') {
      profondeur -= 1
      if (profondeur === 0) return src.slice(debut, j + 1) + ';'
    }
  }
  throw new Error('ReactLoopInbox class not closed')
}
const extrait = extraireClasseInbox(readFileSync(AGENT_LOOP, 'utf8'))
// eslint-disable-next-line no-new-func -- the shipped code is evaluated on purpose
const ReactLoopInbox = new Function(`${extrait}\nreturn ReactLoopInbox;`)()

/** A fake inbox: the projection state, the durable event and the notifications.
 *  `append` applies the splice the way the projection does. */
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
  ok('moving up changes the order', issu === 'moved' && ordre(b.state) === 'c,a,b', `${issu} → ${ordre(b.state)}`)
  ok('the moved message keeps its identity (same object)', b.state['next-turn'][0] === avant)
  ok('its origin is intact (no attachment removed)', b.state['next-turn'][0].source.rpcId === 'rpc-c')

  const s = splices(b)
  ok('the durable event never says « canceled »', s.every((e) => e.data.outcome === undefined),
    s.map((e) => `outcome=${String(e.data.outcome)}`).join(' '))
  ok('no message is discarded (goal turns, sub-agents, uploads intact)',
    !b.notifications.some((n) => n.name === 'agent/inbox/discarded'))
  ok('the move is notified as an insertion',
    b.notifications.filter((n) => n.name === 'agent/inbox/inserted').length === 1)
  ok('no duplicate across the two lanes', new Set([...b.state['next-turn'], ...b.state['next-step']].map((m) => m.id)).size === 3)
}

{
  const b = boite({ nextTurn: [msg('a'), msg('b'), msg('c')] })
  const issu = b.inbox.move('a', null)
  ok('a null beforeId moves to the end of the queue', issu === 'moved' && ordre(b.state) === 'b,c,a', `${issu} → ${ordre(b.state)}`)
}

{
  const b = boite({ nextTurn: [msg('a'), msg('b'), msg('c')] })
  const avant = b.evenements.length
  ok('already right before the target: nothing moves', b.inbox.move('a', 'b') === 'same' && ordre(b.state) === 'a,b,c')
  ok('already at the end with null: nothing moves', b.inbox.move('c', null) === 'same')
  ok('moving in front of itself: nothing moves', b.inbox.move('b', 'b') === 'same')
  ok('no durable event written when nothing moves', b.evenements.length === avant)
}

{
  const b = boite({ nextTurn: [msg('a')], nextStep: [msg('s1'), msg('s2')] })
  ok('unknown identity: clear refusal', b.inbox.move('zz', 'a') === undefined)
  ok('unknown target: clear refusal', b.inbox.move('a', 'zz') === undefined)
  ok('crossing lanes: explicit refusal', b.inbox.move('a', 's1') === 'cross-lane')
  ok('the step lane can be reordered too', b.inbox.move('s2', 's1') === 'moved' && ordre(b.state, 'next-step') === 's2,s1')
  ok('a lane loses nothing when reordered', b.state['next-turn'].length === 1 && b.state['next-step'].length === 2)
}

// ── 2. the wire schema really exported by the installed package ───────────────
{
  const m = await import(`file://${TYPERT_HOST}`)
  const param = m.TYPERT.invocations.find((x) => x.method === 'updateQueue').parameters[0]
  const schema = param.codec.create()
  const base = { sessionId: 's1', itemId: 'i1' }
  const cas = [
    ['move with beforeId', { ...base, action: { kind: 'move', beforeId: 'i2' } }, true],
    ['move with null beforeId (end of queue)', { ...base, action: { kind: 'move', beforeId: null } }, true],
    ['move without beforeId', { ...base, action: { kind: 'move' } }, false],
    ['move with a non-text beforeId', { ...base, action: { kind: 'move', beforeId: 42 } }, false],
    ['edit (unchanged)', { ...base, action: { kind: 'edit', content: [{ type: 'text', text: 'salut' }] } }, true],
    ['remove (unchanged)', { ...base, action: { kind: 'remove' } }, true],
    ['steer (unchanged)', { ...base, action: { kind: 'steer' } }, true],
    ['unknown action', { ...base, action: { kind: 'nope' } }, false],
  ]
  for (const [nom, valeur, attendu] of cas) {
    const obtenu = schema.safeParse(valeur).success
    ok(`wire schema — ${nom}`, obtenu === attendu, obtenu ? 'accepted' : 'refused')
  }
}

// ── 3. the copies of the contract must stay in agreement ──────────────────────
const lire = (p) => readFileSync(p, 'utf8')
{
  const copies = [
    ['host codec', TYPERT_HOST, `'kind': z.literal("move").readonly(),`],
    ['remote client codec', TYPERT_CLIENT, `'kind': z.literal("move").readonly(),`],
    ['browser client', REMOTE_CLIENT, `"kind": literal("move").readonly()`],
  ]
  for (const [nom, chemin, marque] of copies) {
    const src = lire(chemin)
    ok(`contract copy — ${nom} knows move`, src.includes(marque), chemin.replace(`${racine}/`, ''))
    ok(`contract copy — ${nom} types beforeId as text or null`,
      /move"\)\.readonly\(\),[\s\S]{0,80}beforeId['"]?:\s*(?:z\.)?union\(\[(?:z\.)?string\(\), (?:z\.)?(?:null\(\)|literal\(null\))\]\)/.test(src))
  }
  const src = lire(CONTRÔLEUR)
  ok('the host handles the move case', /case "move": \{/.test(src))
  ok('the host calls the queue method', /agent\.inbox\.move\(request\.itemId, request\.action\.beforeId\)/.test(src))
  ok('the host refuses crossing lanes', src.includes('session/queue-move-across-lanes'))
  const corps = src.slice(src.indexOf('async updateQueue(request)'), src.indexOf('cancel(request)'))
  ok('the switch still ends with assertNever', /default: assertNever\(request\.action, "queue action"\);\n\t\t}/.test(corps))
  const loop = lire(AGENT_LOOP)
  ok('the move method lives in the inbox', /move\(messageId, beforeId\) \{/.test(loop))
  ok('the removal done by a move cancels nothing (discardRemoved off)', /this\.mutate\(source\.target, source\.index, 1, \[\], false\)/.test(loop))
}

// ── 4. the client: the handle, the gesture and the probe that protects it ─────
//  These checks do not judge the rendering (it was proven in the real page): they
//  establish that the client wiring is still there after a DSH update, which
//  rewrites these files and would silently take the feature away.
{
  const src = lire(CLIENT_CONVERSATION)
  ok('the client sends the move action', /kind: "move"/.test(src))
  ok('the client probes the host before showing a handle', /function queueMoveSupported\(updateQueue\)/.test(src) && /queue-item-not-found/.test(src))
  ok('the probe is cached for the page', /let queueMoveProbe = null;/.test(src))
  ok('the handle only appears with several messages', /moveReady && queue\.length > 1/.test(src))
  ok('the drop indicator is set on the targeted row', /dropBefore/.test(src) && /dropEnd/.test(src))
  ok('the band of not-yet-admitted messages is refused', /data-pending-row/.test(src) && /dropRefused/.test(src))
  ok('the followed row is dimmed', /rowDragging/.test(src))
  ok('the handle is a real control, labelled', /"aria-label": t\("queue\.reorder"\)/.test(src))
  ok('both labels exist (zh and en)', (src.match(/"queue\.reorder":/g) ?? []).length === 2 && (src.match(/"queue\.moveFailed":/g) ?? []).length === 2)
  ok('Alt+arrow moves from the keyboard', /altKey/.test(src) && /deplacerAuClavier/.test(src))
  ok('the CSS of the handle and of the seams ships with the component',
    /_7yHdaG_grip\{/.test(src) && /_7yHdaG_dropBefore\{/.test(src) && /"grip": "_7yHdaG_grip"/.test(src))
}

// ── 4 bis. the seam of the gesture, extracted from the bundle and tested ──────
//  These assertions do not read the text: they EVALUATE the shipped function
//  against a fake geometry, without React. They guard the defect repaired on
//  2026-09-23 — `cibleDeDepot` returned `null` as soon as the pointer went past
//  the top of a row, and `peindreDepot` took advantage of it to forget the gesture
//  (`setDrag(null)`): going from one row to the next, or simply moving down the
//  first one, silently killed the drag. Four of these eight assertions fail on the
//  old code (dead bands, lower half, above the list, indicator): measured on
//  2026-09-23 on the previous block, 30 ordinates lost between y = 88 and 135.
{
  /** The text of `const X = (…) => { … }`, braces balanced. */
  const extraireFleche = (src, entete) => {
    const debut = src.indexOf(entete)
    if (debut < 0) throw new Error('seam not found in the bundle: ' + entete)
    let profondeur = 0
    for (let j = src.indexOf('{', debut); j < src.length; j += 1) {
      if (src[j] === '{') profondeur += 1
      else if (src[j] === '}') {
        profondeur -= 1
        if (profondeur === 0) return src.slice(debut, j + 1)
      }
    }
    throw new Error('seam not closed: ' + entete)
  }
  const src = lire(CLIENT_CONVERSATION)
  const corpsCible = extraireFleche(src, 'const cibleDeDepot = (y) => {')
  const corpsPeinture = extraireFleche(src, 'const peindreDepot = (id, y) => {')
  /** Two 36 px rows stacked from y = 100, an optional waiting band right under
   *  them: the same geometry as a real queue. */
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
  ok('no dead band loses the gesture target', mortes.length === 0, mortes.slice(0, 6).join(',') + (mortes.length > 6 ? '…' : ''))
  ok('the upper half of a row drops before it', seam(cible, geo.haut + 5) === 'a', seam(cible, geo.haut + 5))
  ok('the lower half drops before the next one', seam(cible, geo.haut + 35) === 'b', seam(cible, geo.haut + 35))
  ok('under the last row, the drop is at the end of the queue', seam(cible, geo.bas + 5) === 'fin', seam(cible, geo.bas + 5))
  ok('above the list, the first seam is kept', seam(cible, geo.haut - 10) === 'a', seam(cible, geo.haut - 10))
  const pendante = { getBoundingClientRect: () => ({ top: 172, height: 36 }) }
  const cibleAvecAttente = couture(geometrie(pendante))
  ok('the band of not-yet-admitted messages is refused, not forgotten', seam(cibleAvecAttente, 190) === 'refus', seam(cibleAvecAttente, 190))
  ok('above the band, the seam is still offered', seam(cibleAvecAttente, 105) === 'a', seam(cibleAvecAttente, 105))
  const peintures = []
  const peindre = new Function('listRef', 'setDrag', `${corpsCible}\n${corpsPeinture}\nreturn peindreDepot;`)({ current: geo.liste }, (v) => peintures.push(v))
  peindre('a', geo.haut + 35)
  ok('the indicator does not let go of the row when the seam is missing',
    peintures.length === 1 && peintures[0] !== null && peintures[0].id === 'a' && peintures[0].atEnd !== true,
    JSON.stringify(peintures))
}

console.log(`${total} assertions pass.`)
