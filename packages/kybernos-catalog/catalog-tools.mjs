// kybernos-catalog: the two tools an agent has on the Catalog. Built by hand, as `kybernos-memory` does: `defineTool` lives in a package a plugin cannot
// import, but `tools.register` only needs { name, description, parameters, output, execute }.
//
//   catalog_find    reads: nothing is written, nothing leaves the machine (free)
//   catalog_upsert  writes one item; DSH's own tool approval asks the person each time, and the journal of the base records the actor `agent`
//
// Neither tool sends anything or reaches the network. Both answer `{ ok: false, error }` instead of throwing, and `base_missing` when the shared base is absent.
const TEXT = (text) => [{ type: 'text', text }]

const money = (row) => (row.price_text !== '' ? row.price_text : (typeof row.price_num === 'number' ? String(row.price_num) : ''))
const line = (it) => '#' + it.id + ' ' + it.title + (it.subtitle !== '' ? ' (' + it.subtitle + ')' : '') + (it.type !== '' ? ' [' + it.type + (it.status !== '' ? '/' + it.status : '') + ']' : '') + (money(it) !== '' ? ' ' + money(it) : '') + (it.archived ? ' (archived)' : '') + (it.demo ? ' (sample)' : '')

export const findTool = (catalog) => ({
  name: 'catalog_find',
  description: 'Looks up items of the Catalog (the products, properties or jobs the person keeps in Kybernos). Reads only. Filter by words (q), by type key and by status key; at most 50 results. Archived items are left out unless include_archived is true.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      q: { type: 'string', description: 'Words to look for in the title and subtitle.' },
      type: { type: 'string', description: 'The key of a type, like "product".' },
      status: { type: 'string', description: 'The key of a status of that type.' },
      limit: { type: 'integer', description: 'How many items at most (1 to 50, default 20).' },
      include_archived: { type: 'boolean', description: 'Also return archived items.' },
    },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: { ok: { type: 'boolean' }, total: { type: 'integer' }, count: { type: 'integer' }, items: { type: 'array' }, error: { type: 'string' }, detail: { type: 'string' } },
      required: ['ok'],
    },
    render: (args, value) => TEXT(value.ok === true
      ? (value.count === 0 ? 'No item matches.' : value.items.map(line).join('\n') + (value.total > value.count ? '\n… ' + String(value.total - value.count) + ' more not shown.' : ''))
      : 'Catalog not read: ' + String(value.error) + (value.detail ? ' (' + String(value.detail) + ')' : '')),
  },
  async execute (args) {
    return catalog.find(args)
  },
})

export const upsertTool = (catalog) => ({
  name: 'catalog_upsert',
  description: 'Adds an item to the Catalog, or changes one when id is given. The person is asked to approve each call. A new item needs a title; its type and status must be keys the active template defines (the default type is "item" with statuses draft, live, archived). fields is merged into the stored fields (a null value clears one). Nothing is sent anywhere.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'integer', description: 'The id of an existing item to change. Leave out to add a new one.' },
      title: { type: 'string', description: 'The name of the item (1 to 200 characters). Required for a new item.' },
      subtitle: { type: 'string', description: 'A short second line (at most 200 characters).' },
      type: { type: 'string', description: 'The key of the type. Default for a new item: the first type of the template.' },
      status: { type: 'string', description: 'The key of a status of the type. Default for a new item: the first status.' },
      price_text: { type: 'string', description: 'The price as it is shown, like "€96" or "€2,450/mo" (at most 60 characters).' },
      price_num: { type: 'number', description: 'The same price as a number, or null.' },
      fields: { type: 'object', description: 'Values of the fields the type defines, by key.' },
    },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: { ok: { type: 'boolean' }, created: { type: 'boolean' }, item: { type: 'object' }, error: { type: 'string' }, detail: { type: 'string' } },
      required: ['ok'],
    },
    render: (args, value) => TEXT(value.ok === true
      ? (value.created ? 'Added ' : 'Updated ') + line(value.item)
      : 'Catalog not changed: ' + String(value.error) + (value.detail ? ' (' + String(value.detail) + ')' : '')),
  },
  async execute (args) {
    return catalog.upsert(args)
  },
})

export const catalogTools = (catalog) => [findTool(catalog), upsertTool(catalog)]
