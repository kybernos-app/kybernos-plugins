// The file half of a ledger of the DSH home: the items read back through a validity filter, written atomically with mode 0600,
// one writer at a time (the chain is per process, as the rest of the home already assumes). suggestions.mjs and
// initiative-queue.mjs keep a ledger each and differ only in what an item is and in the rules of add / resolve.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** `file` is the whole path; `valid` keeps the items worth reading back. Returns `{ read, write, serial }`. */
export const makeLedgerFile = ({ file, valid }) => {
  let chain = Promise.resolve()
  const read = () => {
    try { const j = JSON.parse(readFileSync(file, 'utf8')); return Array.isArray(j.items) ? j.items.filter(valid) : [] } catch (e) { return [] }
  }
  const write = (items) => {
    mkdirSync(dirname(file), { recursive: true })
    const tmp = file + '.tmp-' + process.pid
    writeFileSync(tmp, JSON.stringify({ version: 1, items }, null, 2), { mode: 0o600 })
    renameSync(tmp, file)
  }
  const serial = (fn) => { const run = chain.then(fn, fn); chain = run.then(() => null, () => null); return run }
  return { read, write, serial }
}
