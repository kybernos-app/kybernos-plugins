// kybernos-mobile: the phone's service worker. It is the only thing between the DSH page (in an iframe of the phone
// page) and the network: every request of that page is handed to the phone page, which encrypts it for the computer.
//
//   · hashed files (`/assets/<name>-<hash>.js`, the plugin bundles with `&rev=`) are cached: the first load is megabytes,
//     the next ones are almost free;
//   · gzip answers are decompressed here, so the page sees ordinary bytes;
//   · the HTML of the DSH page gets a small WebSocket shim: DSH's streaming socket (`/api/remote.mux`) cannot be
//     intercepted by a service worker, so the page's own `WebSocket` is replaced by one that talks to the phone page.
const SHIM = `<script>(()=>{
const pend=new Map();let n=0;
class TWS extends EventTarget{
 constructor(url,protocols){super();this.url=String(url);this.readyState=0;this.binaryType='blob';this.protocol='';this.extensions='';this.bufferedAmount=0;
  this._id='w'+(++n)+'-'+Math.random().toString(36).slice(2);pend.set(this._id,this);
  const u=new URL(this.url,location.href);
  parent.postMessage({kbws:'open',id:this._id,path:u.pathname+u.search,protocols:protocols===undefined?[]:[].concat(protocols)},location.origin)}
 send(d){
  if(this.readyState!==1)throw new DOMException('not open','InvalidStateError');
  if(typeof d==='string'){parent.postMessage({kbws:'msg',id:this._id,text:d},location.origin);return}
  let buf=null;
  if(d instanceof ArrayBuffer)buf=d.slice(0);
  else if(ArrayBuffer.isView(d))buf=d.buffer.slice(d.byteOffset,d.byteOffset+d.byteLength);
  else if(d instanceof Blob){d.arrayBuffer().then((b)=>{if(this.readyState===1)parent.postMessage({kbws:'msg',id:this._id,bin:b},location.origin,[b])});return}
  if(buf!==null)parent.postMessage({kbws:'msg',id:this._id,bin:buf},location.origin,[buf])}
 close(code){if(this.readyState>=2)return;this.readyState=2;parent.postMessage({kbws:'close',id:this._id,code:code},location.origin)}
 _fire(type,init){const ev=type==='message'?new MessageEvent('message',init):type==='close'?new CloseEvent('close',init):new Event(type);
  const h=this['on'+type];if(typeof h==='function')h.call(this,ev);this.dispatchEvent(ev)}
}
TWS.CONNECTING=0;TWS.OPEN=1;TWS.CLOSING=2;TWS.CLOSED=3;
window.addEventListener('message',(ev)=>{
 if(ev.origin!==location.origin)return;const d=ev.data;if(!d||typeof d.kbws!=='string')return;const s=pend.get(d.id);if(!s)return;
 if(d.kbws==='open'){s.readyState=1;s.protocol=d.protocol||'';s._fire('open',{})}
 else if(d.kbws==='msg'){let data;
  if(typeof d.text==='string')data=d.text;
  else data=s.binaryType==='arraybuffer'?d.bin:new Blob([d.bin]);
  s._fire('message',{data})}
 else if(d.kbws==='close'){s.readyState=3;pend.delete(d.id);s._fire('close',{code:d.code||1006,reason:'',wasClean:d.code===1000})}
});
window.WebSocket=TWS;
})()</script>`

const CACHE = 'kbmr-assets-v1'
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

const cacheable = (u) => /\/assets\/[^/]+-[A-Za-z0-9_-]{6,}\.[a-z0-9]+$/u.test(u.pathname) || /[?&]rev=[0-9a-f]{6,}/u.test(u.search)

self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url)
  if (u.origin !== self.location.origin) return
  if (u.pathname === '/sw.js' || u.pathname.startsWith('/__kb') || u.pathname === '/ws') return
  e.respondWith(handle(e.request, u))
})

async function handle (req, u) {
  const canCache = req.method === 'GET' && cacheable(u)
  if (canCache) {
    try { const hit = await (await caches.open(CACHE)).match(req.url); if (hit) return hit } catch (err) { /* no cache storage: go to the network */ }
  }
  const res = await tunnel(req, u)
  if (canCache && res.status === 200) {
    try { (await caches.open(CACHE)).put(req.url, res.clone()) } catch (err) { /* quota or private mode */ }
  }
  return res
}

async function tunnel (req, u) {
  const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const shell = all.find((c) => new URL(c.url).pathname.startsWith('/__kb'))
  if (!shell) return new Response('phone page not open', { status: 503 })
  const body = (req.method === 'GET' || req.method === 'HEAD') ? null : await req.arrayBuffer()
  const headers = {}
  req.headers.forEach((v, k) => { headers[k] = v })
  const ch = new MessageChannel()
  shell.postMessage({ t: 'req', method: req.method, path: u.pathname + u.search, headers, body }, body === null ? [ch.port2] : [ch.port2, body])
  req.signal && req.signal.addEventListener('abort', () => { try { ch.port1.postMessage({ t: 'cancel' }) } catch (err) { /* closed */ } })
  return new Promise((resolve) => {
    let head = null
    let ctrl = null
    let html = null
    ch.port1.onmessage = (m) => {
      const d = m.data
      if (d.t === 'res') {
        head = d
        const type = String(d.headers['content-type'] || '')
        const noBody = d.status === 204 || d.status === 304 || req.method === 'HEAD'
        if (noBody) { resolve(new Response(null, { status: d.status, headers: d.headers })); return }
        if (/text\/html/iu.test(type)) { html = []; return }
        const src = new ReadableStream({ start (c) { ctrl = c } })
        const out = d.enc === 'gzip' && typeof DecompressionStream === 'function' ? src.pipeThrough(new DecompressionStream('gzip')) : src
        resolve(new Response(out, { status: d.status, headers: d.headers }))
      } else if (d.t === 'chunk') {
        const u8 = new Uint8Array(d.buf)
        if (html) html.push(u8)
        else if (ctrl) ctrl.enqueue(u8)
      } else if (d.t === 'end') {
        if (html) {
          let n = 0
          for (const p of html) n += p.length
          const joined = new Uint8Array(n)
          let o = 0
          for (const p of html) { joined.set(p, o); o += p.length }
          const finish = (bytes) => {
            let text = new TextDecoder().decode(bytes)
            const i = text.search(/<head[^>]*>/iu)
            if (i >= 0) { const j = text.indexOf('>', i) + 1; text = text.slice(0, j) + SHIM + text.slice(j) } else text = SHIM + text
            resolve(new Response(text, { status: head.status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } }))
          }
          if (head.enc === 'gzip' && typeof DecompressionStream === 'function') {
            new Response(new Blob([joined]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer().then((b) => finish(new Uint8Array(b)), () => finish(joined))
          } else finish(joined)
        } else if (ctrl) { try { ctrl.close() } catch (err) { /* cancelled */ } }
      }
    }
  })
}
