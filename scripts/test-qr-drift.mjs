// The QR encoder lives twice, on purpose: bundles do not import each other (each ships alone in its archive), so kybernos-cloud keeps a
// byte-for-byte copy of kybernos-mobile's. This test is the only thing that lets them part.
//
//   node scripts/test-qr-drift.mjs     (exit 0 = identical)
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages')
const a = readFileSync(join(root, 'kybernos-mobile', 'qr.mjs'), 'utf8')
const b = readFileSync(join(root, 'kybernos-cloud', 'qr.mjs'), 'utf8')
if (a !== b) {
  console.error('FAIL kybernos-cloud/qr.mjs differs from kybernos-mobile/qr.mjs: copy the one you edited over the other')
  process.exit(1)
}
console.log('ok   the two QR encoders are identical (' + a.length + ' bytes)')
