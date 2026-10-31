// add-app.mjs — puts an app in the team space, for the local run: copies a db folder (`<dbs>/<db id>/`) under <data>/apps/<slug>/.
//
//   node scripts/add-app.mjs <slug> <path to the db folder>
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from '../lib/boot.mjs'
import { installApp } from '../lib/install.mjs'

const [slug, source] = process.argv.slice(2)
if (slug === undefined || source === undefined) {
  console.error('usage: node scripts/add-app.mjs <slug> <path to the db folder>')
  process.exit(2)
}
const config = loadConfig(process.env, join(dirname(fileURLToPath(import.meta.url)), '..'), { needPort: false })
const done = installApp(join(config.dataDir, 'apps'), slug, resolve(source))
console.log(done.ok ? 'added ' + slug : done.error)
process.exit(done.ok ? 0 : 1)
