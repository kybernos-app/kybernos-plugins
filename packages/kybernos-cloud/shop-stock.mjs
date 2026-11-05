// Kaby reads and sets the stock of the person's trial shop: `shop_list` and `shop_stock` (docs/dev/shop-poc-contract.md). The shop is the one the person sees in their Telegram Mini App
// (docs/etudes/2026-11-05-shop-in-chat-central-core.md): it lives on the server, keyed by their Kaby account, so what Kaby sets is what the Mini App shows and the other way round.
// This file owns what Kaby may ask (a product by a part of its name, a number to set or to add) and what it is told back, in one plain sentence. Pure: the network is given by `deps`,
// so the tools are tested without DSH and without a server. The trial is a walking skeleton: three products, in the server's memory, no money.
import { dataLine } from './kyby-identity.mjs'

/** The most a stock may hold (the server clamps to the same). */
export const MAX_STOCK = 100_000

const out = () => ({
  schema: { type: 'object', additionalProperties: true, properties: { ok: { type: 'boolean' }, text: { type: 'string' } }, required: ['ok', 'text'] },
  render: (args, v) => [{ type: 'text', text: String(v.text) }]
})

const whole = (v) => typeof v === 'number' && Number.isInteger(v) && Math.abs(v) <= MAX_STOCK

/** What the person is asked, in their own words, when the turn's gate asks before a stock changes. */
export const shopShown = (args) => {
  const a = args !== null && typeof args === 'object' ? args : {}
  const product = dataLine(a.product, 60)
  if (whole(a.set)) return `Set the stock of ${product} to ${a.set}`
  if (whole(a.delta)) return `${a.delta < 0 ? 'Remove' : 'Add'} ${Math.abs(a.delta)} ${a.delta < 0 ? 'from' : 'to'} the stock of ${product}`
  return `Change the stock of ${product}`
}

/** The products, as lines Kaby can read: the words are the server's data, so each is bounded and flattened. */
const lines = (products) => products.slice(0, 50).map((p) => `${dataLine(p.name, 80)} (id ${dataLine(p.id, 16)}): ${Number.isFinite(p.stock) ? p.stock : '?'} in stock, ${dataLine(p.price, 20)}`).join('\n')
const productsOf = (res) => (res !== null && res !== undefined && res.body !== null && typeof res.body === 'object' && Array.isArray(res.body.products)
  ? res.body.products.filter((p) => p !== null && typeof p === 'object' && typeof p.name === 'string' && typeof p.id === 'string')
  : null)

/** What the server's answer means for Kaby, as one sentence it can pass on. */
export const sayShop = (res) => {
  const status = res !== null && res !== undefined && typeof res.status === 'number' ? res.status : 0
  const body = res !== null && res !== undefined && res.body !== null && typeof res.body === 'object' ? res.body : {}
  const code = typeof body.error === 'string' && /^[a-z_]{3,40}$/u.test(body.error) ? body.error : ''
  if (status === 200) {
    const products = productsOf(res)
    if (products === null) return { ok: false, text: 'The shop answered with something unreadable. Say so in one line.' }
    if (Array.isArray(body.several) && body.several.length > 0) {
      return { ok: false, text: 'Several products fit: ' + body.several.slice(0, 10).map((n) => dataLine(n, 60)).join('; ') + '. Nothing was changed: ask the person which one.' }
    }
    const c = body.changed
    if (c !== null && typeof c === 'object' && typeof c.name === 'string' && Number.isFinite(c.before) && Number.isFinite(c.after)) {
      return { ok: true, text: `${dataLine(c.name, 80)}: stock ${c.before} → ${c.after}.` + (c.before === c.after ? ' (Nothing moved: the stock cannot go below 0.)' : '') }
    }
    return { ok: true, text: products.length === 0 ? 'The shop has no product yet.' : lines(products) }
  }
  if (code === 'not_asked_here') return { ok: false, text: 'The shop is reached from Kaby\'s chat on the phone (Telegram or WhatsApp), not from here. Say so in one line.' }
  if (status === 0 && code === '') return { ok: false, text: 'The Kybernos server did not answer. Say so, and try again in a minute.' }
  const sentences = {
    invalid_change: 'Give either a number to set or a number to add, not both.',
    rate_limited: 'Too many shop calls in a minute: wait a moment, then try again.'
  }
  if (sentences[code] !== undefined) return { ok: false, text: sentences[code] }
  if (status === 404 || code === 'not_found') return { ok: false, text: 'No such product in the shop, or the trial shop is not available on this server. Read the list first, and say so if it is empty.' }
  if (status === 400) return { ok: false, text: 'The shop refused that number: a stock is a whole number between 0 and ' + MAX_STOCK + '.' }
  if (status === 401 || status === 403) return { ok: false, text: 'This computer cannot reach the shop from here (' + (code || 'refused') + '). Say so in one line.' }
  return { ok: false, text: 'The shop could not be reached (' + (code !== '' ? code : 'http ' + status) + '). Say so in one line; do not look for another way.' }
}

/**
 * The tools. deps: `call(path, body, exec)` → `{ status, body }` (the host adds the computer's token and the turn it belongs to, and never throws: it answers `not_asked_here` where there is
 * no turn to speak for).
 */
export function createShopTools (deps) {
  const ask = async (path, body, exec) => {
    let res
    try { res = await deps.call(path, body, exec) } catch (e) { res = { status: 0, body: null } }
    return sayShop(res)
  }
  const list = {
    name: 'shop_list',
    description: 'Reads the person\'s trial shop: each product with its id, its stock and its price. Changes nothing. Use it before changing a stock, or when the person asks what is left.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    output: out(),
    async execute (args, exec) {
      const said = await ask('/v1/computer/shop', {}, exec)
      return said.ok === true ? { ok: true, text: said.text } : { ok: false, text: said.text }
    }
  }
  const stock = {
    name: 'shop_stock',
    description: 'Changes the stock of ONE product of the person\'s trial shop: give `set` (the new number) or `delta` (a number to add, negative to remove), never both. `product` is the id or a part of the name (accents and capitals do not matter). If several products fit, nothing changes and you are told which: ask the person. The person sees the new number in their shop at once.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        product: { type: 'string', description: 'The product, by the name the person uses: a part of the name is enough, for example "colombie". Prefer the name to the id (eth, col, mil): the person reads it in the question they are asked.' },
        set: { type: 'integer', description: 'The new stock, from 0 to ' + MAX_STOCK + '.' },
        delta: { type: 'integer', description: 'A number to add to the stock (negative to remove).' }
      },
      required: ['product']
    },
    output: out(),
    async execute (args, exec) {
      const a = args !== null && typeof args === 'object' ? args : {}
      const product = typeof a.product === 'string' ? a.product.trim().slice(0, 80) : ''
      if (product === '') return { ok: false, text: 'Say which product: its id or a part of its name.' }
      const hasSet = a.set !== undefined && a.set !== null
      const hasDelta = a.delta !== undefined && a.delta !== null
      if (hasSet === hasDelta) return { ok: false, text: 'Give either `set` (the new number) or `delta` (a number to add), not both and not neither.' }
      if (hasSet && !(whole(a.set) && a.set >= 0)) return { ok: false, text: 'A stock is a whole number between 0 and ' + MAX_STOCK + '.' }
      if (hasDelta && !whole(a.delta)) return { ok: false, text: 'A number to add is a whole number (negative to remove).' }
      const said = await ask('/v1/computer/shop/stock', { product, ...(hasSet ? { set: a.set } : { delta: a.delta }) }, exec)
      return said.ok === true ? { ok: true, text: said.text } : { ok: false, text: said.text }
    }
  }
  return [list, stock]
}
