// Motion renderer, Canvas 2D: paints the primitives of one frame (see engine.mjs `evaluate`).
//
//   paint(ctx, frame, opts)   opts: { width, height }   pixel size of the target canvas
//                                   { images }           Map of src -> drawable (ImageBitmap, <img>, canvas)
//
// Knows nothing about scenes, keyframes or params: only rect, circle, line, poly, text and image. That is
// what lets the same frame be painted on screen, into the exporter, or onto a recording context in a test.
//
// Keep this file free of `import`: scripts/build.mjs pastes it into the browser bundle.

function gradientFor (ctx, fill, box) {
  const g = fill.gradient
  const a = ((g.angle === undefined ? 90 : g.angle) * Math.PI) / 180 // 0 = left to right, 90 = top to bottom
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  const half = (Math.abs(Math.cos(a)) * box.w + Math.abs(Math.sin(a)) * box.h) / 2
  const dx = Math.cos(a) * half
  const dy = Math.sin(a) * half
  const lg = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy)
  for (const [at, color] of g.stops) lg.addColorStop(Math.min(1, Math.max(0, at)), color)
  return lg
}

function styleOf (ctx, fill, box) {
  if (fill !== null && typeof fill === 'object' && fill.gradient) return gradientFor(ctx, fill, box)
  return fill
}

function roundRectPath (ctx, x, y, w, h, r) {
  ctx.beginPath()
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  if (rr <= 0) { ctx.rect(x, y, w, h); return }
  if (typeof ctx.roundRect === 'function') { ctx.roundRect(x, y, w, h, rr); return }
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

function fillStroke (ctx, op, box) {
  if (op.fill !== null && op.fill !== undefined) { ctx.fillStyle = styleOf(ctx, op.fill, box); ctx.fill() }
  if (op.stroke !== null && op.stroke !== undefined && op.lw > 0) {
    ctx.strokeStyle = styleOf(ctx, op.stroke, box)
    ctx.lineWidth = op.lw
    ctx.lineJoin = 'round'
    ctx.lineCap = op.cap || 'round'
    ctx.stroke()
  }
}

function drawText (ctx, op) {
  const lines = op.text.split('\n')
  let size = op.size
  const font = (s) => `${Math.round(op.weight)} ${s}px ${op.css}`
  ctx.font = font(size)
  if ('letterSpacing' in ctx) ctx.letterSpacing = op.tracking ? `${op.tracking}px` : '0px'
  let widest = 0
  for (const l of lines) widest = Math.max(widest, ctx.measureText(l).width)
  if (widest > op.maxW && widest > 0) { size = (size * op.maxW) / widest; ctx.font = font(size) }
  ctx.textAlign = op.align
  ctx.textBaseline = 'middle'
  const lh = size * op.lineHeight
  const w = Math.min(widest, op.maxW)
  const x0 = op.align === 'left' ? 0 : op.align === 'right' ? -w : -w / 2
  ctx.fillStyle = styleOf(ctx, op.fill, { x: x0, y: -lh * lines.length / 2, w: Math.max(1, w), h: Math.max(1, lh * lines.length) })
  const top = -((lines.length - 1) * lh) / 2
  lines.forEach((l, i) => ctx.fillText(l, op.x, op.y + top + i * lh))
}

function drawImage (ctx, op, images) {
  const img = images && images.get ? images.get(op.src) : null
  if (!img) return
  const iw = img.naturalWidth || img.width || 1
  const ih = img.naturalHeight || img.height || 1
  ctx.save()
  roundRectPath(ctx, op.x, op.y, op.w, op.h, op.r || 0)
  ctx.clip()
  let dw = op.w
  let dh = op.h
  if (op.fit !== 'stretch') {
    const k = op.fit === 'cover' ? Math.max(op.w / iw, op.h / ih) : Math.min(op.w / iw, op.h / ih)
    dw = iw * k
    dh = ih * k
  }
  ctx.drawImage(img, op.x + (op.w - dw) / 2, op.y + (op.h - dh) / 2, dw, dh)
  ctx.restore()
}

export function paint (ctx, frame, opts) {
  const o = opts || {}
  const sx = (o.width || frame.width) / frame.width
  const sy = (o.height || frame.height) / frame.height
  ctx.setTransform(sx, 0, 0, sy, 0, 0)
  ctx.globalAlpha = 1
  ctx.fillStyle = styleOf(ctx, frame.background, { x: 0, y: 0, w: frame.width, h: frame.height })
  ctx.fillRect(0, 0, frame.width, frame.height)
  for (const op of frame.ops) {
    ctx.save()
    ctx.transform(op.m[0], op.m[1], op.m[2], op.m[3], op.m[4], op.m[5])
    ctx.globalAlpha = Math.max(0, Math.min(1, op.alpha))
    if (op.op === 'rect') {
      roundRectPath(ctx, op.x, op.y, op.w, op.h, op.r)
      fillStroke(ctx, op, { x: op.x, y: op.y, w: op.w, h: op.h })
    } else if (op.op === 'circle') {
      ctx.beginPath()
      ctx.arc(op.x, op.y, op.r, 0, Math.PI * 2)
      fillStroke(ctx, op, { x: op.x - op.r, y: op.y - op.r, w: op.r * 2, h: op.r * 2 })
    } else if (op.op === 'line') {
      ctx.beginPath()
      ctx.moveTo(op.x1, op.y1)
      ctx.lineTo(op.x2, op.y2)
      ctx.strokeStyle = op.stroke
      ctx.lineWidth = op.lw
      ctx.lineCap = op.cap
      ctx.stroke()
    } else if (op.op === 'poly') {
      ctx.beginPath()
      const p = op.pts
      let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity
      for (let i = 0; i < p.length; i += 2) {
        if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[i], p[i + 1])
        x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1])
      }
      if (op.closed) ctx.closePath()
      fillStroke(ctx, op, { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) })
    } else if (op.op === 'text') {
      drawText(ctx, op)
    } else if (op.op === 'image') {
      drawImage(ctx, op, o.images)
    }
    ctx.restore()
  }
  ctx.globalAlpha = 1
}

/** The image files a frame (or a whole scene's frames) wants loaded before it can be painted. */
export function imagesOf (scene) {
  const out = []
  const walk = (layers) => {
    for (const l of layers || []) {
      if (l.type === 'image' && typeof l.src === 'string' && l.src !== '' && !out.includes(l.src)) out.push(l.src)
      if (l.layers) walk(l.layers)
    }
  }
  walk(scene.layers)
  return out
}
