// Kaby runs the person's trial shop: `shop_list`, `shop_stock`, `shop_define` (name, products with a price and a cost), `shop_connect` (the merchant's Stripe link) and `shop_photo` (the photos the person sent
// in the chat, retouched and put on their products) (docs/dev/shop-poc-contract.md). The shop is the one the person sees in their Telegram Mini App
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
/** The most photos one `shop_photo` call may carry: the person is asked once, the server allows 60 calls a minute and each photo takes two. */
export const MAX_PHOTOS = 6
/** The looks a photo may be given (shop-photo.mjs holds what each one does). */
export const LOOKS = ['natural', 'bright', 'vivid']
const PHOTO_NAME = /^ph\d{1,6}$/u

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
  if (tool === 'shop_photo') {
    const items = (Array.isArray(a.photos) ? a.photos : []).filter((p) => p !== null && typeof p === 'object')
    const names = items.slice(0, 5).map((p) => dataLine(p.product, 40)).filter((n) => n !== '')
    const n = items.length
    return `Put ${n === 1 ? 'the photo' : n + ' photos'} you sent on the shop` + (names.length > 0 ? ': ' + names.join(', ') + (n > 5 ? ` (+${n - 5} more)` : '') : '')
  }
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
  return `${dataLine(p.name, 80)} (id ${dataLine(p.id, 16)}): ${Number.isFinite(p.stock) ? p.stock : '?'} in stock, ${dataLine(p.price, 20)}${cost}, ${p.photo === true ? 'with a photo' : 'no photo'}`
}).join('\n')
const productsOf = (res) => (res !== null && res !== undefined && res.body !== null && typeof res.body === 'object' && Array.isArray(res.body.products)
  ? res.body.products.filter((p) => p !== null && typeof p === 'object' && typeof p.name === 'string' && typeof p.id === 'string')
  : null)
/** Said to Kaby wherever it reads the shop: the person is never asked to approve a shell command to check a window (they cannot judge it), the shop's own answer says where it stands. */
const NO_COMMAND_CHECK = 'Do not check the window or a photo with a shell command (curl and the like): the person would be asked to approve a command they cannot judge. What you got back already says where the shop stands; give them the address and let them open it.'
const addressOf = (v) => (typeof v === 'string' && /^https:\/\/[^\s<>]{4,400}$/u.test(v) ? v : '')
/** Where the shop stands, in one sentence: its window and whether a card can be charged. */
const shopSentence = (shop) => {
  if (shop === null || typeof shop !== 'object') return ''
  const name = dataLine(shop.name, 60)
  const url = addressOf(shop.url) !== '' ? dataLine(shop.url, 300) : ''
  const waiting = (Array.isArray(shop.photos_waiting) ? shop.photos_waiting : []).filter((n) => typeof n === 'string' && PHOTO_NAME.test(n)).slice(0, 12)
  const photos = waiting.length > 0 ? ` Photos the person sent that no product has yet: ${waiting.join(', ')} (kept two hours). Ask which product each one is for, then use shop_photo.` : ''
  if (name === '') return 'The shop is still the demo (three sample products): it has no address yet. Define it with shop_define.' + photos
  const stripe = shop.payable === true ? 'card payments are open'
    : shop.connected === true ? 'a Stripe account was made but the owner has not finished there yet (card payments closed)'
    : 'not connected to Stripe yet (card payments closed)'
  return `Shop "${name}"` + (url !== '' ? `, window ${url}` : '') + `: ${stripe}.` + photos + (url !== '' ? ' ' + NO_COMMAND_CHECK : '')
}

/** What the server's answer means for Kaby, as one sentence it can pass on. `kind` is what was asked: `read`, `stock`, `define`, `connect`, `photo_get` (taking the person's photo) or `photo_put` (putting the retouched one on a product). */
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
    const ph = body.photo
    if (kind === 'photo_put' && ph !== null && typeof ph === 'object' && typeof ph.product === 'string') {
      const size = Number.isFinite(ph.width) && Number.isFinite(ph.height) ? `${ph.width}×${ph.height}, ${Math.max(1, Math.round((Number.isFinite(ph.bytes) ? ph.bytes : 0) / 1024))} KB` : 'saved'
      return { ok: true, text: `Photo of ${dataLine(ph.product, 80)} put on the shop (${size}): clients see it in the window now.` }
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
    payments_off: 'This server takes no payment: say so in one line.',
    not_a_photo: 'The server did not accept that picture (it must be a JPEG of 100 to 4096 pixels). Say so in one line.',
    photo_too_big: 'The retouched photo weighs more than the shop keeps (250 KB). Say so in one line.',
    photos_full: 'The shop holds as many photos as it may (2.5 MB in all): say so in one line, and that a photo can be replaced but not added.'
  }
  if (sentences[code] !== undefined) return { ok: false, text: sentences[code] }
  if (kind === 'photo_get' && (status === 404 || code === 'not_found')) return { ok: false, text: 'That photo is not there any more (a photo is kept two hours) or never arrived. Ask the person to send it again.' }
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
    description: 'Creates or updates the person\'s shop, the one their clients see at the address you get back: `name` (needed the first time) and `tagline` for the shop window, and `products`, each with a `price_eur` (what a client pays) and, when the person said it, a `cost_eur`. A product whose name the shop already has is updated, the others are added; the three demo products go away the first time. Put ALL the products in ONE call: the person is asked once. When the person gave you costs and no prices, first PROPOSE a price per product in your answer (the cost, the margin you chose and why, one line each) and wait for their yes before calling; never invent a cost. Photos are not set here: the person sends them in the chat, then you use shop_photo. ' + NO_COMMAND_CHECK,
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
    description: 'Asks Stripe for the link where the shop\'s owner fills in their details to be paid (test mode: Stripe\'s test data is enough). Returns a single-use link: give it to the person in your answer and ask them to tell you when they are done at Stripe. If a card can already be charged on the shop, it says so. The shop must be defined first (shop_define). Never enter payment details yourself. ' + NO_COMMAND_CHECK,
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    output: out(),
    async execute (args, exec) { return answer(await ask('/v1/computer/shop/connect', {}, exec, 'connect')) }
  }
  const photo = {
    name: 'shop_photo',
    description: 'Takes photos the person sent in the chat (they show as `[The person sent a photo: ph1]`, and `shop_list` names the ones no product has yet), retouches each one (turned upright, cropped square on the subject, the light lifted when the photo is dark, sharpened, location data removed, made small) and puts it on a product of the shop: clients see it in the window at once. `photos` is a list of `{ product, photo }` (`product` as in shop_stock, `photo` the name like ph1, `look` optionally natural, bright or vivid). Put ALL the photos in ONE call: the person is asked once. Only when the person said which photo is for which product (a caption counts); otherwise ask. This is a careful retouch of THEIR picture, not a new picture: it cannot change the background or invent anything, and a dark or blurred photo stays so, so say that plainly when a photo is poor and suggest they take it again in daylight. A photo is kept two hours: if one is gone, ask them to send it again. ' + NO_COMMAND_CHECK,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        photos: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_PHOTOS,
          description: 'The photos to put, one entry per photo.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              product: { type: 'string', description: 'The product, by the name the person uses (a part of the name is enough).' },
              photo: { type: 'string', pattern: '^ph[0-9]{1,6}$', description: 'The name of the photo in the person\'s message, for example ph1.' },
              look: { type: 'string', enum: LOOKS, description: 'natural (default): as it is, only lighter if it is dark. bright: lighter, for a dark room. vivid: richer colours, for food or flowers.' }
            },
            required: ['product', 'photo']
          }
        }
      },
      required: ['photos']
    },
    output: out(),
    async execute (args, exec) {
      const a = args !== null && typeof args === 'object' ? args : {}
      if (!Array.isArray(a.photos) || a.photos.length === 0) return { ok: false, text: 'Give `photos`: a list of { product, photo }, for example { product: "bougie", photo: "ph1" }.' }
      if (a.photos.length > MAX_PHOTOS) return { ok: false, text: 'At most ' + MAX_PHOTOS + ' photos in one call: do the others in a second call.' }
      const asked = []
      for (const p of a.photos) {
        const q = p !== null && typeof p === 'object' ? p : {}
        const product = typeof q.product === 'string' ? q.product.trim().slice(0, 80) : ''
        if (product === '') return { ok: false, text: 'Say which product each photo is for: its id or a part of its name.' }
        if (typeof q.photo !== 'string' || !PHOTO_NAME.test(q.photo)) return { ok: false, text: 'A photo is named like ph1, as in the person\'s message.' }
        if (q.look !== undefined && q.look !== null && !LOOKS.includes(q.look)) return { ok: false, text: 'The look is one of: ' + LOOKS.join(', ') + '.' }
        asked.push({ product, photo: q.photo, look: LOOKS.includes(q.look) ? q.look : 'natural' })
      }
      if (typeof deps.retouch !== 'function') return { ok: false, text: 'This computer has no picture library to retouch photos. Say so in one line.' }
      const lines = []
      let failed = 0
      for (const one of asked) {
        let res
        try { res = await deps.call('/v1/computer/shop/photo/raw', { photo: one.photo }, exec) } catch (e) { res = { status: 0, body: null } }
        const body = res !== null && res !== undefined && res.body !== null && typeof res.body === 'object' ? res.body : {}
        if (!(res !== null && res !== undefined && res.status === 200 && typeof body.jpeg_base64 === 'string' && body.jpeg_base64 !== '')) {
          const said = sayShop(res, 'photo_get')
          // The door is shut for every photo (no turn, no account, too many calls): say it once, do not knock again.
          const code = typeof body.error === 'string' ? body.error : ''
          const shut = res === null || res === undefined || res.status === 0 || res.status === 401 || res.status === 403 || res.status === 429 || code === 'not_asked_here'
          if (shut) return { ok: false, text: [...lines, `${one.photo}: ${said.text}`].join('\n') }
          lines.push(`${one.photo}: not done. ${said.text}`)
          failed += 1
          continue
        }
        let made
        try { made = await deps.retouch(Buffer.from(body.jpeg_base64, 'base64'), one.look) } catch (e) { made = { ok: false, why: 'failed' } }
        if (made === null || typeof made !== 'object' || made.ok !== true || !Buffer.isBuffer(made.jpeg)) {
          const reason = made !== null && typeof made === 'object' ? made.why : ''
          const why = reason === 'too_small' ? 'it is too small to be a shop photo (under 100 pixels)' : reason === 'too_heavy' ? 'it could not be made small enough for the shop' : 'it could not be read as a picture'
          lines.push(`${one.photo}: not done, ${why}. Ask the person to send it again.`)
          failed += 1
          continue
        }
        let put
        try { put = await deps.call('/v1/computer/shop/photo/put', { product: one.product, jpeg_base64: made.jpeg.toString('base64') }, exec) } catch (e) { put = { status: 0, body: null } }
        const said = sayShop(put, 'photo_put')
        const done = Number.isFinite(made.lifted) && made.lifted > 0 ? ` What was done: turned upright, cropped square, sharpened, light lifted by ${Math.round(made.lifted)}% (the photo was dark).` : ' What was done: turned upright, cropped square, sharpened; the light was left as it was.'
        lines.push(`${one.photo} → ${dataLine(one.product, 60)}: ` + (said.ok ? said.text + done : 'not done. ' + said.text))
        if (!said.ok) failed += 1
        // The shop cannot hold one more photo: the next ones would meet the same wall.
        if (put !== null && put !== undefined && put.body !== null && typeof put.body === 'object' && put.body.error === 'photos_full') break
      }
      return { ok: failed === 0, text: lines.join('\n') }
    }
  }
  return [list, stock, define, connect, photo]
}
