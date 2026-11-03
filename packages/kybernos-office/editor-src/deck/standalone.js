// The runtime of a generated deck file, inlined at the end of its body: navigation, steps, transitions, grid, presenter view, charts, full screen, print.
// No editing here (a file is edited in the Kybernos editor), no network, no storage.
import './deck-base.css'
import './deck-print.css'
import { detectLang } from './i18n.js'
import { start } from './runtime.js'

const run = () => { start({ edit: false, framed: false, lang: detectLang() }) }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run)
else run()
