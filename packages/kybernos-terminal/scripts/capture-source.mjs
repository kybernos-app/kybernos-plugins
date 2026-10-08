// Capture d'un bloc bash réel de la GUI DSH — source de vérité de la maquette
// terminal-code-block. Auth par cookie signé (cookieDeSession), jamais par token URL.
import { connect, findPage, cookieDeSession } from '/Users/miled/dyad-apps/dsh-kybernos/scripts/cdp-lib.mjs'

const out = process.argv[2] ?? '/Users/miled/dyad-apps/dsh-kybernos/docs/handoff/terminal-code-block/maquette-v1/source-ecran-reel.png'

const c = await findPage({ needMarkers: null })
if (!c) { console.error('aucune page DSH ouverte dans le Chrome de debug'); process.exit(1) }

const s = cookieDeSession('127.0.0.1:3080')
await c.send('Network.enable')
await c.send('Network.setCookie', { name: s.nom, value: s.valeur, domain: '127.0.0.1', path: '/' })

const probe = await c.evalJs(`(() => {
  const blocks = [...document.querySelectorAll('div.md-code-block')]
  const hit = blocks.find(b => {
    const banner = b.querySelector('[data-code-block-banner]')
    const info = banner && banner.firstElementChild ? banner.firstElementChild.textContent.trim().toLowerCase() : ''
    return info === 'bash'
  })
  if (!hit) return null
  const r = hit.getBoundingClientRect()
  return JSON.stringify({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), total: blocks.length })
})()`, 8000)
if (!probe.val) { console.error('aucun bloc bash trouvé — ' + (probe.err ?? 'null')); process.exit(1) }
const rect = JSON.parse(probe.val)
console.log('bloc trouvé', JSON.stringify(rect))

await c.send('Page.enable')
await c.send('Page.bringToFront')
await new Promise(r => setTimeout(r, 500))
const shot = await c.send('Page.captureScreenshot', { format: 'png', clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: 2 } })
if (!shot.result || !shot.result.data) { console.error('capture échouée'); process.exit(1) }
const { writeFileSync } = await import('node:fs')
writeFileSync(out, Buffer.from(shot.result.data, 'base64'))
console.log('capture →', out)
c.close()
