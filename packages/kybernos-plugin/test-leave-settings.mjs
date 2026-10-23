// A button on a Settings page that opens another page of the app must leave Settings first: Settings is a full-window screen that stays on top, so the page opened
// behind it was invisible and the button looked dead (« Open the journal » on Learned skills, « Open Connectors » on Connectors; found by the dead-click probe,
// scripts/check-dead-clicks-live.mjs, 2026-10-23). The two ways in, window.__KB_OPEN__ and the kb-open-resources bridge, both call kbLeaveSettings().
// It extracts the KB-LEAVE-SETTINGS block of client.js (a browser bundle with no exports) and runs it against a stand-in document.
// Usage: node packages/kybernos-plugin/test-leave-settings.mjs   (exit 0 = everything passes)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(fileURLToPath(new URL('./client.js', import.meta.url)), 'utf8')
let fails = 0
const check = (label, ok, detail) => { if (ok) console.log('ok  ', label); else { fails += 1; console.log('FAIL', label, detail === undefined ? '' : JSON.stringify(detail)) } }

const parts = src.split('// KB-LEAVE-SETTINGS-BEGIN')
check('exactly one KB-LEAVE-SETTINGS block in client.js', parts.length === 2)
const block = parts[1].split('// KB-LEAVE-SETTINGS-END')[0]

const run = (navCell) => {
  const sent = []
  const doc = {
    querySelector: (sel) => (sel === 'button[class*="navCell"]' ? navCell : null),
    dispatchEvent: (e) => { sent.push(e); return true }
  }
  class KeyboardEvent { constructor (type, init) { this.type = type; this.key = init && init.key; this.bubbles = init && init.bubbles } }
  const api = new Function('document', 'KeyboardEvent', block + '\nreturn { kbSettingsOpen, kbLeaveSettings }')(doc, KeyboardEvent)
  return { api, sent }
}
{
  const { api, sent } = run({ getClientRects: () => [{ width: 10 }] })
  check('Settings open (a nav cell is drawn): it is left through Escape on the document, like « Back to workspace »', api.kbLeaveSettings() === true && sent.length === 1 && sent[0].type === 'keydown' && sent[0].key === 'Escape' && sent[0].bubbles === true, sent)
}
{
  const { api, sent } = run(null)
  check('Settings not open: nothing is sent (a chat card must never press Escape in a chat)', api.kbLeaveSettings() === false && sent.length === 0, sent)
}
{
  const { api, sent } = run({ getClientRects: () => [] })
  check('a nav cell that is not drawn (a hidden menu) does not count as Settings being open', api.kbSettingsOpen() === false && api.kbLeaveSettings() === false && sent.length === 0)
}
{
  const throwing = new Function('document', 'KeyboardEvent', block + '\nreturn kbLeaveSettings')({ querySelector: () => { throw new Error('no document') } }, class {})
  check('a document that throws is not Settings being open, and nothing throws', throwing() === false)
}
{
  const open = src.slice(src.indexOf('const kbOpenPage = (patch) => {'), src.indexOf('Object.defineProperty(kbOpenPage'))
  check('window.__KB_OPEN__ leaves Settings before it sets the page', /kbLeaveSettings\(\)\s*\n\s*set\(patch\)/.test(open), open.slice(0, 200))
  const bridge = src.slice(src.indexOf("window.addEventListener('kb-open-resources'"), src.indexOf("window.addEventListener('kb-accept-text'"))
  check('the kb-open-resources bridge (Open Connectors, a chat card) leaves Settings before it sets the view', /kbLeaveSettings\(\)[\s\S]*set\(\{ view \}\)/.test(bridge), bridge.slice(0, 200))
  check('both Settings and Escape are the shell\'s own path: kbCloseSettings still dispatches the same Escape', /const kbCloseSettings = \(\) => \{\s*try \{\s*document\.dispatchEvent\(new KeyboardEvent\('keydown', \{ key: 'Escape', bubbles: true \}\)\)/.test(src))
}
console.log(fails === 0 ? '\nall good' : '\n' + fails + ' FAILED')
process.exit(fails === 0 ? 0 : 1)
