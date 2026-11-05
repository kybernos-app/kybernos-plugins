// Kaby runs the person's trial shop: `shop_list`, `shop_stock`, `shop_define` (name, products with a price and a cost) and `shop_connect` (the merchant's Stripe link) (docs/dev/shop-poc-contract.md). The shop is the one the person sees in their Telegram Mini App
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

/** The most products one call may carry (the server clamps to the same). */
export const MAX_PRODUCTS = 50
/** The most a price or a cost may be, in euros (the server clamps to the same). */
export const MAX_EUR = 100_000
/** Stripe's smallest charge. */
export const MIN_PRICE_EUR = 0.5

const eur = (v) => (typeof v === 'number' && Number.isFinite(v) ? `${Number(v.toFixed(2))} €` : '')
const sentenceProducts = (list) => {
  const items = (Array.isArray(list) ? list : []).filter((p) => p !== null && typeof p === 'object')
  const shown = items.slice(0, 5).map((p) => `${dataLine(p.name, 40)}${eur(p.price_eur) === '' ? '' : ' ' + eur(p.price_eur)}`)
  return shown.join(', ') + (items.length > 5 ? ` (+${items.length - 5} more)` : '')
}

/** What the person is asked, in their own words, when the turn's gate asks before the shop changes. */
export const shopShown = (args, tool = 'shop_stock') => {
  const a = args !== null && typeof args === 'object' ? args : {}
  if (tool === 'shop_connect') return 'Ask Stripe for the link where the shop\'s owner fills in their payment details (test mode)'
  if (tool === 'shop_define') {
    const name = dataLine(a.name, 60)
    const products = sentenceProducts(a.products)
    return (name !== '' ? `Set up the shop "${name}"` : 'Update the shop') + (products !== '' ? ': ' + products : '')
  }
  const product = dataLine(a.product, 60)
  if (whole(a.set)) return `Set the stock of ${product} to ${a.set}`
  if (whole(a.delta)) return `${a.delta < 0 ? 'Remove' : 'Add'} ${Math.abs(a.delta)} ${a.delta < 0 ? 'from' : 'to'} the stock of ${product}`
  return `Change the stock of ${product}`
}

/** The products, as lines Kaby can read: the words are the server's data, so each is bounded and flattened. The merchant's own cost and margin are for Kaby, never for a client. */
const lines = (products) => products.slice(0, 50).map((p) => {
  const cost = typeof p.cost === 'string' ? `, cost ${dataLine(p.cost, 20)}` + (Number.isFinite(p.margin_pct) ? `, margin ${p.margin_pct}%` : '') : ''
  return `${dataLine(p.name, 80)} (id ${dataLine(p.id, 16)}): ${Number.isFinite(p.stock) ? p.stock : '?'} in stock, ${dataLine(p.price, 20)}${cost}`
}).join('\n')
const productsOf = (res) => (res !== null && res !== undefined && res.body !== null && typeof res.body === 'object' && Array.isArray(res.body.products)
  ? res.body.products.filter((p) => p !== null && typeof p === 'object' && typeof p.name === 'string' && typeof p.id === 'string')
  : null)
const addressOf = (v) => (typeof v === 'string' && /^https:\/\/[^\s<>]{4,400}$/u.test(v) ? v : '')
/** Where the shop stands, in one sentence: its window and whether a card can be charged. */
const shopSentence = (shop) => {
  if (shop === null || typeof shop !== 'object') return ''
  const name = dataLine(shop.name, 60)
  const url = addressOf(shop.url) !== '' ? dataLine(shop.url, 300) : ''
  if (name === '') return 'The shop is still the demo (three sample products): it has no address yet. Define it with shop_define.'
  const stripe = shop.payable === true ? 'card payments are open'
    : shop.connected === true ? 'a Stripe account was made but the owner has not finished there yet (card payments closed)'
    : 'not connected to Stripe yet (card payments closed)'
  return `Shop "${name}"` + (url !== '' ? `, window ${url}` : '') + `: ${stripe}.`
}

/** What the server's answer means for Kaby, as one sentence it can pass on. `kind` is what was asked: `read`, `stock`, `define` or `connect`. */
export const sayShop = (res, kind = 'read') => {
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
    const where = shopSentence(body.shop)
    const link = addressOf(body.url)
    if (kind === 'connect') {
      if (link !== '') return { ok: true, text: `Stripe link for the owner: ${dataLine(link, 400)} . It works once and opens Stripe's own page where they give their details (in test mode Stripe's test data is enough). Send it to the person in your answer and ask them to tell you when they are done. ${where}`.trim() }
      return { ok: true, text: `Card payments are already open on this shop. ${where}`.trim() }
    }
    if (kind === 'define') {
      const added = (Array.isArray(body.added) ? body.added : []).slice(0, 50).map((n) => dataLine(n, 60))
      const updated = (Array.isArray(body.updated) ? body.updated : []).slice(0, 50).map((n) => dataLine(n, 60))
      const said = 'Shop saved.' + (added.length > 0 ? ' Added: ' + added.join('; ') + '.' : '') + (updated.length > 0 ? ' Updated: ' + updated.join('; ') + '.' : '')
      return { ok: true, text: [said, where, lines(products)].filter((x) => x !== '').join('\n') }
    }
    return { ok: true, text: [where, products.length === 0 ? 'The shop has no product yet.' : lines(products)].filter((x) => x !== '').join('\n') }
  }
  if (code === 'not_asked_here') return { ok: false, text: 'The shop is reached from Kaby\'s chat on the phone (Telegram or WhatsApp), not from here. Say so in one line.' }
  if (status === 0 && code === '') return { ok: false, text: 'The Kybernos server did not answer. Say so, and try again in a minute.' }
  const sentences = {
    invalid_change: 'Give either a number to set or a number to add, not both.',
    rate_limited: 'Too many shop calls in a minute: wait a moment, then try again.',
    name_required: 'The first time, the shop needs a name: ask the person what to call it.',
    nothing_to_define: 'Give a name, a line for the window, or products.',
    shop_full: 'A shop holds at most ' + MAX_PRODUCTS + ' products.',
    shop_not_defined: 'The shop is not defined yet: call shop_define first (a name and the products), then ask for the Stripe link.',
    payments_off: 'This server takes no payment: say so in one line.'
  }
  if (sentences[code] !== undefined) return { ok: false, text: sentences[code] }
  if (code === 'payments_unavailable') return { ok: false, text: 'Stripe did not accept the request' + (typeof body.message === 'string' ? ': ' + dataLine(body.message, 200) : '') + '. Say so in one line; do not look for another way.' }
  if (status === 404 || code === 'not_found') return { ok: false, text: 'No such product in the shop, or the trial shop is not available on this server. Read the list first, and say so if it is empty.' }
  if (status === 400) return { ok: false, text: kind === 'define'
    ? 'The shop refused those values: a price is between ' + MIN_PRICE_EUR + ' and ' + MAX_EUR + ' euros, a cost between 0 and ' + MAX_EUR + ', a stock a whole number from 0 to ' + MAX_STOCK + ', at most ' + MAX_PRODUCTS + ' products.'
    : 'The shop refused that number: a stock is a whole number between 0 and ' + MAX_STOCK + '.' }
  if (status === 401 || status === 403) return { ok: false, text: 'This computer cannot reach the shop from here (' + (code || 'refused') + '). Say so in one line.' }
  return { ok: false, text: 'The shop could not be reached (' + (code !== '' ? code : 'http ' + status) + '). Say so in one line; do not look for another way.' }
}

/**
 * The tools. deps: `call(path, body, exec)` → `{ status, body }` (the host adds the computer's token and the turn it belongs to, and never throws: it answers `not_asked_here` where there is
 * no turn to speak for).
 */
export function createShopTools (deps) {
  const ask = async (path, body, exec, kind) => {
    let res
    try { res = await deps.call(path, body, exec) } catch (e) { res = { status: 0, body: null } }
    return sayShop(res, kind)
  }
  const answer = (said) => (said.ok === true ? { ok: true, text: said.text } : { ok: false, text: said.text })
  const list = {
    name: 'shop_list',
    description: 'Reads the person\'s shop: its name and window address, whether Stripe is connected, and each product with its id, stock, price, cost and margin. Changes nothing. Use it before changing a shop, or when the person asks what is left or how the shop stands.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    output: out(),
    async execute (args, exec) { return answer(await ask('/v1/computer/shop', {}, exec, 'read')) }
  }
  const stock = {
    name: 'shop_stock',
    description: 'Changes the stock of ONE product of the person\'s shop: give `set` (the new number) or `delta` (a number to add, negative to remove), never both. `product` is the id or a part of the name (accents and capitals do not matter). If several products fit, nothing changes and you are told which: ask the person. The person sees the new number in their shop at once.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        product: { type: 'string', description: 'The product, by the name the person uses: a part of the name is enough, for example "colombie". Prefer the name to the id: the person reads it in the question they are asked.' },
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
      return answer(await ask('/v1/computer/shop/stock', { product, ...(hasSet ? { set: a.set } : { delta: a.delta }) }, exec, 'stock'))
    }
  }
  const define = {
    name: 'shop_define',
    description: 'Creates or updates the person\'s shop, the one their clients see at the address you get back: `name` (needed the first time) and `tagline` for the shop window, and `products`, each with a `price_eur` (what a client pays) and, when the person said it, a `cost_eur`. A product whose name the shop already has is updated, the others are added; the three demo products go away the first time. Put ALL the products in ONE call: the person is asked once. When the person gave you costs and no prices, first PROPOSE a price per product in your answer (the cost, the margin you chose and why, one line each) and wait for their yes before calling; never invent a cost. Photos are not supported yet: if asked, say so in one line.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string', description: 'The shop\'s name (at most 60 characters). Needed the first time.' },
        tagline: { type: 'string', description: 'One line under the name in the shop window (at most 120 characters).' },
        products: {
          type: 'array',
          maxItems: MAX_PRODUCTS,
          description: 'The products to add or update, by name.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              name: { type: 'string', description: 'The product\'s name as clients read it.' },
              price_eur: { type: 'number', description: 'The price a client pays, in euros, at least ' + MIN_PRICE_EUR + ' (Stripe\'s minimum).' },
              cost_eur: { type: 'number', description: 'What one costs the person, in euros, only when they said it.' },
              stock: { type: 'integer', description: 'How many there are, from 0 to ' + MAX_STOCK + '. Leave it out to keep the number the shop has.' }
            },
            required: ['name', 'price_eur']
          }
        }
      }
    },
    output: out(),
    async execute (args, exec) {
      const a = args !== null && typeof args === 'object' ? args : {}
      const name = typeof a.name === 'string' ? a.name.trim().slice(0, 60) : ''
      const tagline = typeof a.tagline === 'string' ? a.tagline.trim().slice(0, 120) : undefined
      const given = a.products === undefined || a.products === null ? [] : a.products
      if (!Array.isArray(given)) return { ok: false, text: '`products` is a list of products, each with a name and a price_eur.' }
      if (given.length > MAX_PRODUCTS) return { ok: false, text: 'At most ' + MAX_PRODUCTS + ' products in one shop.' }
      const products = []
      for (const p of given) {
        const q = p !== null && typeof p === 'object' ? p : {}
        const pname = typeof q.name === 'string' ? q.name.trim().slice(0, 80) : ''
        if (pname === '') return { ok: false, text: 'Every product needs a name.' }
        if (typeof q.price_eur !== 'number' || !Number.isFinite(q.price_eur) || q.price_eur < MIN_PRICE_EUR || q.price_eur > MAX_EUR) return { ok: false, text: `The price of ${dataLine(pname, 40)} must be a number of euros between ${MIN_PRICE_EUR} and ${MAX_EUR}.` }
        const hasCost = q.cost_eur !== undefined && q.cost_eur !== null
        if (hasCost && (typeof q.cost_eur !== 'number' || !Number.isFinite(q.cost_eur) || q.cost_eur < 0 || q.cost_eur > MAX_EUR)) return { ok: false, text: `The cost of ${dataLine(pname, 40)} must be a number of euros between 0 and ${MAX_EUR}: leave it out if the person did not say it.` }
        const hasStock = q.stock !== undefined && q.stock !== null
        if (hasStock && !(whole(q.stock) && q.stock >= 0)) return { ok: false, text: `The stock of ${dataLine(pname, 40)} must be a whole number between 0 and ${MAX_STOCK}.` }
        products.push({ name: pname, price_eur: q.price_eur, ...(hasCost ? { cost_eur: q.cost_eur } : {}), ...(hasStock ? { stock: q.stock } : {}) })
      }
      if (name === '' && tagline === undefined && products.length === 0) return { ok: false, text: 'Give a name, a line for the window, or products.' }
      return answer(await ask('/v1/computer/shop/define', { ...(name !== '' ? { name } : {}), ...(tagline !== undefined ? { tagline } : {}), ...(products.length > 0 ? { products } : {}) }, exec, 'define'))
    }
  }
  const connect = {
    name: 'shop_connect',
    description: 'Asks Stripe for the link where the shop\'s owner fills in their details to be paid (test mode: Stripe\'s test data is enough). Returns a single-use link: give it to the person in your answer and ask them to tell you when they are done at Stripe. If a card can already be charged on the shop, it says so. The shop must be defined first (shop_define). Never enter payment details yourself.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    output: out(),
    async execute (args, exec) { return answer(await ask('/v1/computer/shop/connect', {}, exec, 'connect')) }
  }
  return [list, stock, define, connect]
}
