// The entrypoint's two questions about a machine's identity, answered by computer-identity.mjs (the one place that knows what a valid identity is):
//
//   node identity.mjs has   exit 0 when the machine has one (in its environment, or on its volume from a claim), 1 when it has not
//   node identity.mjs env   the `export` lines that give a process the identity its environment lacks (nothing for a machine made the old way)
//
// Both read DSH_HOME and the environment, run as the unprivileged user, and print nothing but those lines: the shell evaluates them, so every value was checked against a
// closed alphabet first (computer-identity.mjs, shellExports).
import { identityOf, shellExports } from './computer-identity.mjs'

const home = String(process.env.DSH_HOME || '')
const which = process.argv[2]
if (which === 'has') process.exit(identityOf(process.env, home).source === null ? 1 : 0)
else if (which === 'env') {
  const lines = shellExports(process.env, home)
  if (lines !== '') console.log(lines)
} else {
  console.error('usage: identity.mjs has | env')
  process.exit(2)
}
