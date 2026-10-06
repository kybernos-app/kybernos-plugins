// The only Vercel function of the project. All the logic is in ../relay-core.mjs (pure and tested); this file wires the real
// network and the project's own OIDC token, which Vercel hands to a deployment and renews by itself.
import { getVercelOidcToken } from '@vercel/oidc'
import { relay } from '../relay-core.mjs'

export default async function handler (req, res) {
  const out = await relay({ method: req.method, url: req.url }, { fetch, getToken: getVercelOidcToken })
  res.statusCode = out.status
  for (const [name, value] of Object.entries(out.headers)) res.setHeader(name, value)
  res.end(req.method === 'HEAD' ? undefined : out.body)
}
