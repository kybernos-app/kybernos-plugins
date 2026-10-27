// Web app server (stack: web). Serves ./public and delegates /api/* to api.js, on the PORT the
// runtime gives. Template shell — the hardened server (Hono, Better-Auth, strict uploads, CSRF,
// rate limiting) lands with the foundation batch; do not grow security in this file.
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const api = require('./api.js')

const port = Number(process.env.PORT || 0)
const ROOT = path.join(__dirname, 'public')
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' }

const serveStatic = (req, res) => {
  const url = decodeURIComponent(String(req.url || '/').split('?')[0])
  let file = path.normalize(path.join(ROOT, url))
  if (file !== ROOT && file.startsWith(ROOT + path.sep) !== true) { res.writeHead(403, { 'content-type': 'text/plain' }); res.end('forbidden'); return }
  if (fs.existsSync(file) === true && fs.statSync(file).isDirectory() === true) file = path.join(file, 'index.html')
  if (fs.existsSync(file) !== true) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('not found'); return }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
}

http.createServer((req, res) => {
  const url = String(req.url || '/')
  if (url === '/api' || url.startsWith('/api/')) { api.handle(req, res, url); return }
  serveStatic(req, res)
}).listen(port, '127.0.0.1', () => console.log('listening ' + port))
