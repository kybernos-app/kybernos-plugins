// The door through which another bundle (Motion) adds a MiniApp player. `cd packages/kybernos-plugin && node test-miniapp-door.mjs`
// The block is run for real: it is cut out of client.js between its markers.
import { readFileSync } from 'node:fs'

let fail = 0
const ok = (name, cond, detail) => { if (!cond) { fail++; console.log('FAIL ' + name + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail))) } }
const src = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
const a = src.indexOf('// KB-MINIAPP-DOOR-BEGIN')
const b = src.indexOf('// KB-MINIAPP-DOOR-END')
ok('the door block exists', a > 0 && b > a)
const block = src.slice(src.indexOf('\n', a), b)
const run = (win, tables) => new Function('KB_MINIAPP_RENDERERS', 'KB_MINIAPP_COMPONENTS', 'window', block)(tables.r, tables.c, win)
const fresh = () => ({ r: { quiz: 'quiz', cards: 'cards' }, c: { quiz: () => 1, cards: () => 2, generic: () => 3 } })

{
  const t = fresh(); const win = {}
  run(win, t)
  const Player = () => 9
  ok('the door is exposed on window', typeof win.__KB_MINIAPP__.register === 'function')
  ok('a new renderer is registered in both tables', win.__KB_MINIAPP__.register('motion', Player) === true && t.r.motion === 'motion' && t.c.motion === Player)
  ok('a built-in renderer cannot be replaced', win.__KB_MINIAPP__.register('quiz', Player) === false && t.c.quiz !== Player)
  ok('the generic fallback cannot be replaced either', win.__KB_MINIAPP__.register('generic', Player) === false)
  ok('a bad name or a non-component is refused', win.__KB_MINIAPP__.register('Bad Name', Player) === false && win.__KB_MINIAPP__.register('x', 'nope') === false && win.__KB_MINIAPP__.register('', Player) === false)
  ok('a bundle can register again (hot reload)', win.__KB_MINIAPP__.register('motion', () => 10) === true)
}
{
  const t = fresh(); const P1 = () => 1; const P2 = () => 2
  const win = { __KB_MINIAPP_PENDING__: [['early', P1], ['quiz', P2], ['bad name', P2]] }
  run(win, t)
  ok('a registration queued before the core loaded is applied', t.c.early === P1 && t.r.early === 'early')
  ok('a queued attempt on a built-in is refused and the rest still go through', t.c.quiz !== P2 && t.c.early === P1)
  ok('the queue is emptied', Array.isArray(win.__KB_MINIAPP_PENDING__) && win.__KB_MINIAPP_PENDING__.length === 0)
}
{
  let threw = null
  try { run(Object.freeze({}), fresh()) } catch (e) { threw = e }
  ok('a window that refuses the assignment does not break the page', threw === null, threw && String(threw))
}
ok('players receive the file path and, on a card, compact', src.includes('const rendererProps = { text: text, name: name, path: path }') && src.includes('h(Comp, { text: texte, name: p0.name, path: p0.path, compact: true })'))

console.log(fail === 0 ? 'miniapp door: ok' : `${fail} failed`)
process.exit(fail ? 1 : 0)
