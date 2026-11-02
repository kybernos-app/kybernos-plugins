// What the agent needs to know about the files a scene points at: does a model have an animation, what is it called, how
// long is a Lottie. Pure: bytes or text in, a small description out. Nothing here executes or renders anything.

const MAGIC_GLB = 0x46546c67 // "glTF"
const CHUNK_JSON = 0x4e4f534a // "JSON"

/** Header and JSON chunk of a binary glTF: animations (name and length), meshes, skins, materials. */
export function inspectGlb (bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 20) return { ok: false, message: 'Not a .glb file (too short).' }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (dv.getUint32(0, true) !== MAGIC_GLB) return { ok: false, message: 'Not a .glb file (wrong header). Only binary glTF (.glb) is supported.' }
  if (dv.getUint32(4, true) !== 2) return { ok: false, message: 'Only glTF version 2 is supported.' }
  const len = dv.getUint32(12, true)
  const type = dv.getUint32(16, true)
  if (type !== CHUNK_JSON || 20 + len > bytes.length) return { ok: false, message: 'The .glb file is damaged (no JSON chunk).' }
  let json
  try { json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + len))) } catch (e) { return { ok: false, message: 'The .glb file is damaged (unreadable JSON).' } }
  const accessors = Array.isArray(json.accessors) ? json.accessors : []
  const animations = (Array.isArray(json.animations) ? json.animations : []).map((a, i) => {
    let seconds = 0
    for (const s of Array.isArray(a.samplers) ? a.samplers : []) {
      const acc = accessors[s.input]
      if (acc && Array.isArray(acc.max) && Number.isFinite(acc.max[0])) seconds = Math.max(seconds, acc.max[0])
    }
    return { name: typeof a.name === 'string' && a.name !== '' ? a.name : `animation_${i}`, seconds: Math.round(seconds * 100) / 100 }
  })
  const count = (k) => (Array.isArray(json[k]) ? json[k].length : 0)
  // buffers and images that live OUTSIDE the file: never loaded (a model may not make the browser fetch anything)
  const external = [...(Array.isArray(json.buffers) ? json.buffers : []), ...(Array.isArray(json.images) ? json.images : [])].filter((x) => x && typeof x.uri === 'string' && !/^data:/i.test(x.uri)).length
  return { ok: true, animations, meshes: count('meshes'), skins: count('skins'), materials: count('materials'), nodes: count('nodes'), externalFiles: external }
}

/** A Lottie file: size, frame rate, length, layers, and whether it carries expressions (which are never run here). */
export function inspectLottie (text) {
  let d
  try { d = JSON.parse(String(text)) } catch (e) { return { ok: false, message: 'Not a Lottie file (invalid JSON).' } }
  if (d === null || typeof d !== 'object' || !Array.isArray(d.layers) || !Number.isFinite(d.fr) || !Number.isFinite(d.op)) return { ok: false, message: 'Not a Lottie file (it needs layers, fr and op).' }
  const ip = Number.isFinite(d.ip) ? d.ip : 0
  const externalImages = (Array.isArray(d.assets) ? d.assets : []).filter((a) => a && typeof a.p === 'string' && a.p !== '' && !/^data:/i.test(a.p)).length
  return {
    ok: true, fps: d.fr, seconds: Math.round(((d.op - ip) / d.fr) * 100) / 100, width: d.w || null, height: d.h || null, layers: d.layers.length,
    expressions: /"x"\s*:\s*"/.test(String(text)), externalImages,
  }
}
