// hosting.mjs — the PORT through which Publish gets a team space to publish into, and the two implementations this repository has. The contract the real one (the server's
// team-space computer, L6) must keep is docs/dev/apps-hosting-port.md.
//
//   hosting = {
//     available(): boolean                  whether Publish is offered at all; false means no button, no card, no dead control
//     describe(): { name, pricePerMonth?, currency?, budget?, alwaysOn?, region? }     what the Publish card says about the space (plain data, no secret)
//     ensureSpace({ workspace }): Promise<{ ok: true, space: { id, url, bootKey } } | { ok: false, code, message }>
//     releaseSpace?(spaceId): Promise<{ ok: boolean }>     when the last app leaves a space (optional)
//   }
//
// The default answers `available: false`: the product shows no Publish control until a real hosting is wired. `envHosting` points at ONE space somebody already runs, from two
// environment variables; it is for development and self-hosting, it is chosen by the host process and never by a request, and it is not the default.
import { normalizeSpaceUrl } from './space.mjs'
import { hexKey } from './token.mjs'

const NOT_AVAILABLE = 'Publishing is not available yet.'

/** The hosting of a product that has none: nothing to publish into, so nothing is offered. */
export const unavailableHosting = () => Object.freeze({
  available: () => false,
  describe: () => ({ name: '' }),
  ensureSpace: async () => ({ ok: false, code: 'unavailable', message: NOT_AVAILABLE }),
})

/** What a card may show of a hosting's description: known keys, plain values, bounded. */
export function describeHosting (hosting) {
  let d = null
  try { d = hosting.describe() } catch (e) { d = null }
  const o = d !== null && typeof d === 'object' ? d : {}
  const text = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '')
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)
  const b = o.budget !== null && typeof o.budget === 'object' ? o.budget : null
  return {
    name: text(o.name, 80),
    pricePerMonth: num(o.pricePerMonth),
    currency: /^[A-Z]{3}$/.test(text(o.currency, 3)) ? o.currency : '',
    alwaysOn: o.alwaysOn === true,
    region: text(o.region, 40),
    budget: b === null ? null : { label: text(b.label, 80), remaining: num(b.remaining), enough: b.enough === false ? false : (b.enough === true ? true : null) },
  }
}

/**
 * A hosting that points at one team space somebody runs already (development, or self-hosting): `KYBERNOS_DB_SPACE_URL` (its origin) and `KYBERNOS_DB_SPACE_KEY` (its boot key,
 * hex). Without both, or with either unusable, it is the unavailable hosting. It makes no request itself: `ensureSpace` hands back the configured space.
 */
export function envHosting (env = process.env) {
  const url = normalizeSpaceUrl(env.KYBERNOS_DB_SPACE_URL)
  const key = typeof env.KYBERNOS_DB_SPACE_KEY === 'string' ? env.KYBERNOS_DB_SPACE_KEY.trim() : ''
  if (url === null || hexKey(key) === null) return unavailableHosting()
  const id = 'env-' + new URL(url).host.replace(/[^A-Za-z0-9-]/g, '-').slice(0, 40)
  return Object.freeze({
    available: () => true,
    describe: () => ({ name: 'Your own team space' }),
    ensureSpace: async () => ({ ok: true, space: { id, url, bootKey: key } }),
  })
}
