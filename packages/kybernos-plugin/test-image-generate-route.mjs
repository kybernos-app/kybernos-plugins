// The core's one-picture route (used by Settings › Kaby): pinned on the source, since the host half needs a running DSH.
//   node packages/kybernos-plugin/test-image-generate-route.mjs
import { readFileSync } from 'node:fs'

let fail = 0
const ok = (name, cond) => { if (cond !== true) { fail += 1; console.log('FAIL  ' + name) } else console.log('ok    ' + name) }

const src = readFileSync(new URL('./index.js', import.meta.url), 'utf8')
const at = src.indexOf("path: '/kybernos/image/generate'")
const route = at < 0 ? '' : src.slice(at, src.indexOf("'kybernos: route image/generate'", at))

ok('the route exists, once', at >= 0 && src.indexOf("path: '/kybernos/image/generate'", at + 1) < 0)
ok('it only answers POST', /req\.method !== 'POST'\) return sendJson\(res, 405/.test(route))
ok('it spends money, so it needs the page\'s own origin', route.indexOf('sameOriginStrict(req) === false') >= 0)
ok('its body is bounded and the prompt is 1 to 1500 characters', /readJsonBody\(req, 16384\)/.test(route) && /prompt\.length > 1500/.test(route))
ok('the model must be one of the configured image models', /kbImageModels\(null\)\.some\(\(m\) => m\.id === asked\)/.test(route))
ok('the size is one of three fixed sizes', /\['1024\*1024', '768\*1024', '1024\*768'\]/.test(route))
ok('it goes through the same call as the team portraits', route.indexOf('kbImageGen(prompt, model, size') >= 0)
ok('the picture comes back as a data URL with its real type', /image\/jpeg/.test(route) && /'data:' \+ mime \+ ';base64,'/.test(route))

process.exit(fail > 0 ? 1 : 0)
