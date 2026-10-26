// A stand-in for the system proxy of a device cloud: it answers 503 to every request and every CONNECT, and prints what it was asked. An app that sends its requests to its own loopback through it
// never gets an answer (seen on a BrowserStack Pixel 9). Used by emu-android.sh (scenario S6); the emulator reaches the Mac at 10.0.2.2.
//   node mobile/tests/stub-proxy.mjs [port]
import { createServer } from 'node:http'

const port = Number(process.argv[2] ?? 8899)
const server = createServer((req, res) => { console.log('proxy saw ' + req.method + ' ' + req.url); res.writeHead(503, { 'content-type': 'text/plain', via: '1.1 stub-proxy' }); res.end('proxy: unavailable') })
server.on('connect', (req, socket) => { console.log('proxy saw CONNECT ' + req.url); socket.end('HTTP/1.1 503 Service Unavailable\r\nVia: 1.1 stub-proxy\r\n\r\n') })
server.listen(port, '0.0.0.0', () => console.log('stub proxy on ' + port))
