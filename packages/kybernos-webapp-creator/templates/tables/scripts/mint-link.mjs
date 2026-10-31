// mint-link.mjs — mints the one-time link that signs the owner in (and creates them on the first use). It lives 10 minutes and works once.
//
//   node scripts/mint-link.mjs <public address> [owner e-mail]
//
// It reads the same secrets the server does (KB_BOOT_KEY from the environment, else <data>/secrets.json), so run it where the app runs. The link is the only thing printed.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mintOpenToken } from '../lib/bootstrap.mjs'
import { loadConfig } from '../lib/boot.mjs'

const [origin, email] = process.argv.slice(2)
if (origin === undefined || !/^https?:\/\//.test(origin)) {
  console.error('usage: node scripts/mint-link.mjs <public address, e.g. https://team.example.com> [owner e-mail]')
  process.exit(2)
}
const config = loadConfig(process.env, join(dirname(fileURLToPath(import.meta.url)), '..'), { needPort: false })
console.log(origin.replace(/\/$/, '') + '/open?t=' + encodeURIComponent(mintOpenToken({ key: config.bootKey, email })))
