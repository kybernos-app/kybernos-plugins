// Build-time patch of the suite's page bundle (packages/kybernos-plugin/client.js) in the image: on a cloud computer the server's team
// console is not framed (the server only lets a page on the person's own machine frame it: « refused to connect »), the workspace settings
// page offers to open it in the browser instead. The flag comes from the cloud plugin's `/kybernos-cloud/server` (`computer`, true when the
// platform named the machine's id in its environment).
//
// The release the image is cloned from does not have it. Each replacement must find its anchor exactly once, or the BUILD FAILS: a release
// that changed these lines is a release to look at, not one to patch blind. A file that already has the change is left alone, and so is one that
// no longer frames the console at all (the read-only account frame left the page bundle: docs/dev/frame-removal.md). The day the image is cloned from such a
// release, this script, its line in the Dockerfile and the `computer` flag of the cloud plugin's `/kybernos-cloud/server` go.
//
//   node patch-console.mjs <path of client.js>
import { readFileSync, writeFileSync } from 'node:fs'

const file = process.argv[2]
if (file === undefined) { console.error('usage: node patch-console.mjs <client.js>'); process.exit(2) }
let s = readFileSync(file, 'utf8')
if (s.includes("'kbui.ws.computer.t'")) { console.log('[patch-console] already there: nothing to do'); process.exit(0) }
if (!s.includes('const KbWsConsole = ')) { console.log('[patch-console] this release no longer frames the console: nothing to do'); process.exit(0) }

const once = (anchor, replacement, what) => {
  const parts = s.split(anchor)
  if (parts.length !== 2) { console.error(`[patch-console] ${what}: anchor found ${parts.length - 1} times, expected once`); process.exit(1) }
  s = parts[0] + replacement + parts[1]
}

once("      'kbui.ws.retry': { kybernos: 'Réessayer', en: 'Try again' },\n",
  "      'kbui.ws.computer.t': { kybernos: 'La console se gère dans votre navigateur', en: 'The console is managed in your browser' },\n" +
  "      'kbui.ws.computer.d': { kybernos: 'Cet ordinateur cloud est le vôtre, mais la console du workspace ({host}) s\\'ouvre dans votre navigateur, avec votre connexion habituelle.', en: 'This cloud computer is yours, but the workspace console ({host}) opens in your own browser, signed in as usual.' },\n" +
  "      'kbui.ws.retry': { kybernos: 'Réessayer', en: 'Try again' },\n",
  'texts')

once("kbServer.gateway = typeof sv.gateway === 'string' ? sv.gateway : ''\n        }",
  "kbServer.gateway = typeof sv.gateway === 'string' ? sv.gateway : ''\n        }\n" +
  "        kbServer.computer = j !== null && j !== undefined && j.computer === true",
  'server load')

once("React.useEffect(() => { kbServerLoad().then(() => probe()) }, [])",
  "React.useEffect(() => { kbServerLoad().then(() => { if (kbServer.computer === true) setReach('computer'); else probe() }) }, [])",
  'probe')

once("      if (reach !== 'ok') {\n        let hote = kbWsConsole()\n        try { hote = new URL(kbWsConsole()).host } catch (e) { /* unreadable URL: we display it as is */ }\n",
  "      if (reach !== 'ok') {\n        let hote = kbWsConsole()\n        try { hote = new URL(kbWsConsole()).host } catch (e) { /* unreadable URL: we display it as is */ }\n" +
  "        // A cloud computer: the server's console refuses to be framed by a page that is not on the person's own machine, so it is not framed there\n" +
  "        // (a blank « refused to connect ») but opened in the person's browser, where they are signed in as usual.\n" +
  "        if (reach === 'computer') {\n" +
  "          return h('div', { className: 'kbwsif' },\n" +
  "            h('div', { className: 'kbwsif-down', role: 'status' },\n" +
  "              h('div', { className: 'kbwsif-downt' }, kbt('kbui.ws.computer.t')),\n" +
  "              h('p', { className: 'kbwsif-downd' }, kbt('kbui.ws.computer.d').replace('{host}', hote)),\n" +
  "              h('div', { className: 'kbwsif-downa' },\n" +
  "                h('a', { className: 'kb6-btn', href: kbConsoleUrl(dark), target: '_blank', rel: 'noopener noreferrer' }, kbt('kbui.ws.openbrowser')))))\n" +
  "        }\n",
  'render')

writeFileSync(file, s)
console.log('[patch-console] patched')
