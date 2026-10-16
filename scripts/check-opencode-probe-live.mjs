// LIVE probe: asks the REAL OpenCode CLI of this machine whether it is installed and signed in (`opencode --version`, then
// `opencode models`; no model is called). It reports a fact about the machine, so it is not part of any gate: the hermetic
// version of the same logic, with a stand-in CLI in both states, is packages/dsh-subagent-maison/test-noyau.mjs.
//   node scripts/check-opencode-probe-live.mjs
// Exit 0 with a printed state (ready / not signed in / not installed); exit 1 only if the probe itself answers something
// it should never answer.
import { sonder } from '../packages/dsh-subagent-maison/noyau.mjs'

const s = await sonder({ produit: 'OpenCode', binaire: 'opencode', versionArgs: ['--version'], authArgs: ['models'], authOk: (code) => code === 0 })
const coherent = (s.pret === true && s.raison === 'pret') || (s.pret === false && (s.raison === 'non-connecte' || s.raison === 'binaire-absent'))
if (!coherent) { console.log('PROBE INCOHERENT — ' + JSON.stringify(s)); process.exit(1) }
if (s.raison === 'binaire-absent') console.log('OPENCODE — not installed on this machine (nothing to probe)')
else if (s.pret) console.log('OPENCODE — installed and signed in (' + s.version + ')')
else console.log('OPENCODE — installed (' + s.version + ') but NOT signed in: sign in with the CLI to use it as a worker')
