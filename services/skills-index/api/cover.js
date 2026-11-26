// The second Vercel function of the project: the pictures of the Featured picks. The logic is in ../relay-core.mjs (pure and tested); this
// file only reads the files that ship with the deployment (covers/, see vercel.json `includeFiles`). No token, no network.
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cover } from '../relay-core.mjs'

// The bundled folder is found from the project root (what Vercel runs a function from) or from this file, whichever has it.
const FOLDERS = [join(process.cwd(), 'covers'), join(dirname(fileURLToPath(import.meta.url)), '..', 'covers')]
const read = async (id) => {
  for (const dir of FOLDERS) {
    try { return await readFile(join(dir, id + '.webp')) } catch (e) { /* the next folder */ }
  }
  return null
}

export default async function handler (req, res) {
  const out = await cover({ method: req.method, url: req.url }, { read })
  res.statusCode = out.status
  for (const [name, value] of Object.entries(out.headers)) res.setHeader(name, value)
  res.end(req.method === 'HEAD' ? undefined : out.body)
}
