#!/usr/bin/env node
// Publishes a shelf release (the folder `scripts/templates-lot.mjs` builds: catalogue.json, shelf/<id>.webp, shelf/large/<id>.webp, shelf/video/<id>.mp4) to the public
// Tigris bucket on Fly.io that serves the examples of the new-chat page (docs/dev/templates-catalogue.md), then reads every file back WITHOUT credentials, as a machine would.
//
//   node scripts/templates-publish.mjs <release dir> [--env <file>] [--dry-run]
//
// Credentials: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_ENDPOINT_URL_S3 and BUCKET_NAME, from the environment or from `--env <file>` (lines `NAME=value` or `NAME: value`, as
// `fly storage create` prints them; keep that file outside git, mode 600). They are only used to sign the uploads and are never printed.
// The bucket holds the SUM of the releases (a file of an older lot stays), and the catalogue goes last, so it never names a file that is not there yet.
// The signing is AWS Signature V4, path-style, region `auto` (no SDK needed: this repo has no dependency for it).
import { createHash, createHmac } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
const dir = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--env')
const dry = args.includes('--dry-run')
const fail = (m) => { console.error(m); process.exit(1) }
if (dir === undefined) { console.error('usage: node scripts/templates-publish.mjs <release dir> [--env <file>] [--dry-run]'); process.exit(2) }
const release = resolve(dir)
if (!existsSync(join(release, 'catalogue.json'))) fail('no catalogue.json in ' + release + ': build the release with scripts/templates-lot.mjs first')

const env = Object.assign({}, process.env)
if (flag('--env') !== null) {
  for (const line of readFileSync(resolve(flag('--env')), 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*[=:]\s*(\S+)\s*$/.exec(line)
    if (m !== null) env[m[1]] = m[2]
  }
}
const need = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_ENDPOINT_URL_S3', 'BUCKET_NAME']
const missing = need.filter((k) => typeof env[k] !== 'string' || env[k] === '')
if (missing.length > 0 && !dry) fail('missing ' + missing.join(', ') + ' (environment or --env <file>)')
const endpoint = new URL(env.AWS_ENDPOINT_URL_S3 || 'https://fly.storage.tigris.dev')
if (endpoint.protocol !== 'https:') fail('the storage endpoint must be https')
const bucket = env.BUCKET_NAME || 'kybernos-templates'

const TYPES = { '.json': 'application/json', '.webp': 'image/webp', '.mp4': 'video/mp4' }
const walk = (base, rel = '') => readdirSync(join(base, rel)).flatMap((f) => {
  const r = rel === '' ? f : rel + '/' + f
  return statSync(join(base, r)).isDirectory() ? walk(base, r) : [r]
})
const files = walk(release).filter((f) => TYPES[f.slice(f.lastIndexOf('.'))] !== undefined && !f.startsWith('.'))
files.sort((a, b) => (a === 'catalogue.json') - (b === 'catalogue.json') || a.localeCompare(b))
if (files.length < 2 || files[files.length - 1] !== 'catalogue.json') fail('a release has a catalogue and at least one file under shelf/')

const sha = (d) => createHash('sha256').update(d).digest('hex')
const hmac = (k, d) => createHmac('sha256', k).update(d).digest()
/** The headers of one signed PUT (AWS Signature V4, path-style). */
const signed = (key, body, type, cache) => {
  const stamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
  const day = stamp.slice(0, 8)
  const headers = { 'cache-control': cache, 'content-type': type, host: endpoint.host, 'x-amz-content-sha256': sha(body), 'x-amz-date': stamp }
  const names = Object.keys(headers).sort()
  const path = '/' + bucket + '/' + key.split('/').map(encodeURIComponent).join('/')
  const canonical = ['PUT', path, '', names.map((n) => n + ':' + headers[n] + '\n').join(''), names.join(';'), headers['x-amz-content-sha256']].join('\n')
  const scope = day + '/auto/s3/aws4_request'
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha(canonical)].join('\n')
  const signingKey = hmac(hmac(hmac(hmac('AWS4' + env.AWS_SECRET_ACCESS_KEY, day), 'auto'), 's3'), 'aws4_request')
  headers.authorization = 'AWS4-HMAC-SHA256 Credential=' + env.AWS_ACCESS_KEY_ID + '/' + scope + ', SignedHeaders=' + names.join(';') + ', Signature=' + hmac(signingKey, toSign).toString('hex')
  return { url: endpoint.origin + path, headers }
}

const publicBase = 'https://' + bucket + '.' + endpoint.host + '/'
let bytes = 0
for (const f of files) {
  const body = readFileSync(join(release, f))
  bytes += body.length
  if (dry) { console.log('  would put ' + f + '  ' + Math.round(body.length / 1024) + ' KB'); continue }
  const type = TYPES[f.slice(f.lastIndexOf('.'))]
  const { url, headers } = signed(f, body, type, f === 'catalogue.json' ? 'public, max-age=300' : 'public, max-age=3600')
  const res = await fetch(url, { method: 'PUT', headers, body, redirect: 'manual', signal: AbortSignal.timeout(60000) })
  if (res.status !== 200) fail('PUT ' + f + ' answered ' + res.status + ': ' + (await res.text()).slice(0, 200).replace(/\s+/g, ' '))
  console.log('  put ' + f + '  ' + Math.round(body.length / 1024) + ' KB')
}
console.log((dry ? 'dry run: ' : 'uploaded ') + files.length + ' files, ' + (bytes / 1024 / 1024).toFixed(1) + ' MB, to ' + publicBase)
if (dry) process.exit(0)

// Read it all back the way a machine without credentials would: same bytes, the right type, public.
let bad = 0
for (const f of files) {
  const want = readFileSync(join(release, f))
  const res = await fetch(publicBase + f, { redirect: 'manual', signal: AbortSignal.timeout(30000) })
  const got = res.status === 200 ? Buffer.from(await res.arrayBuffer()) : null
  const type = (res.headers.get('content-type') || '').split(';')[0]
  if (got === null || !got.equals(want) || type !== TYPES[f.slice(f.lastIndexOf('.'))]) { bad += 1; console.log('  ✗ ' + f + ': status ' + res.status + ', type ' + type + (got !== null && !got.equals(want) ? ', bytes differ' : '')) }
}
if (bad > 0) fail(bad + ' of ' + files.length + ' files do not read back from the public address')
console.log('read back without credentials: ' + files.length + ' of ' + files.length + ' files, same bytes, right types')
