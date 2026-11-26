// `window.__KB_ASK__` is the one door a page uses to open a chat with its first message written (never sent): the Tables page's « Modify view » goes through it.
// It must be the very function the feedback button uses, set once, guarded, and after that function is defined. client.js is a browser bundle with no exports,
// so the test reads its text.
// Usage: node packages/kybernos-plugin/test-ask-seam.mjs   (exit 0 = everything passes)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(fileURLToPath(new URL('./client.js', import.meta.url)), 'utf8')
let fails = 0
const check = (label, ok, detail) => { if (ok) console.log('ok  ', label); else { fails += 1; console.log('FAIL', label, detail === undefined ? '' : JSON.stringify(detail)) } }

const sets = src.split('window.__KB_ASK__ =').length - 1
check('__KB_ASK__ is set exactly once', sets === 1, sets)
const at = src.indexOf('window.__KB_ASK__ =')
const defined = src.indexOf('const kbStartChatText = ')
check('it is set after kbStartChatText exists', defined > 0 && at > defined)
check('it is set to kbStartChatText, not to a wrapper', /window\.__KB_ASK__ = kbStartChatText\b/.test(src))
const line = src.slice(src.lastIndexOf('\n', at) + 1, src.indexOf('\n', at))
check('it is guarded against a missing window and a throwing setter', /^\s*try \{ if \(typeof window !== 'undefined'\) window\.__KB_ASK__ = kbStartChatText \} catch \(e\)/.test(line), line)
check('the feedback button still shares the same function', src.includes('kbOpenFeedbackChat = kbStartChatText'))

process.exit(fails === 0 ? 0 : 1)
