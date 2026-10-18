// C-02: the Agent Teams pages only ask for the image of a team that carries one. The host's listing says so (`ui.avatar`, a path of the
// avatar store); before, every card, row and detail drew an <img> for /kybernos/avatar and the host answered 404 for each team without one
// (8 failing requests when Agent Teams opened). The route keeps its 404 for a direct call. Static checks on client.js (a browser bundle).
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const SRC = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
const HOST = readFileSync(new URL('./index.js', import.meta.url), 'utf8')
let fail = 0
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (cond ? '' : ' — ' + JSON.stringify(detail)))
  if (!cond) fail += 1
}

// the helper, cut out of client.js and run as it is
const at = SRC.indexOf('const kbHasAvatar = ')
const has = at < 0 ? null : vm.runInNewContext(SRC.slice(at, SRC.indexOf('\n', at)) + '\nkbHasAvatar')
ok('the helper exists', typeof has === 'function')
if (typeof has === 'function') {
  ok('a team whose listing names an avatar of the store has one', has({ avatar: '.kyber-avatars/beta.png.b64' }) === true)
  ok('a team with no avatar field, a null one or an empty one has none', has({}) === false && has({ avatar: null }) === false && has({ avatar: '' }) === false)
  ok('no sidecar entry at all (ui is null or undefined) is no avatar', has(null) === false && has(undefined) === false)
  ok('a path outside the avatar store is not trusted (the host would refuse it too)', has({ avatar: '../secret.png' }) === false && has({ avatar: 'x/.kyber-avatars/a.png' }) === false)
  ok('anything that is not a string is no avatar', has({ avatar: 1 }) === false && has({ avatar: {} }) === false && has('x') === false)
}

// every <img> that reads /kybernos/avatar sits behind it
const sites = [...SRC.matchAll(/h\('img', \{ src: kbAvatarUrl\(/g)].length
// (the detail page draws it once, in `avatarImg`, which its header and its Identity tab both call)
ok('there are three places that draw a team avatar (card, row, the detail\'s avatarImg)', sites === 3, sites)
const gated = [...SRC.matchAll(/kbHasAvatar\([^)]*\)[^?\n]*\? h\('img', \{ src: kbAvatarUrl\(/g)].length
ok('all three are asked only when the team has an avatar', gated === 3, gated)
ok('the detail also asks after a save in this session (avRev), so a fresh upload shows', (SRC.match(/kbHasAvatar\(kyber\.ui\) === true \|\| avRev > 0/g) || []).length === 1 && (SRC.match(/avatarImg\(\)/g) || []).length === 2)
ok('the route keeps its 404 for a direct call', /path: '\/kybernos\/avatar', handler/.test(HOST) && /res\.writeHead\(404\)/.test(HOST))

console.log(fail === 0 ? '\nOK' : '\n' + fail + ' failure(s)')
process.exit(fail === 0 ? 0 : 1)
