// Where the service keeps what it must remember: conversations, what is known about a visitor, the budget ledger, idempotency
// results, approvals and the erasure log. Files under one directory (mode 0600, directory 0700) or, with `dir: null`, memory only
// (tests and a first try). Writes are synchronous and atomic (temp file + rename), so one process never interleaves two of them.
//
// Names and ids are validated before they touch a path: a visitor can never choose a file name.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const NAME = /^[a-z0-9_]{1,64}$/;
const need = (s, what) => { if (typeof s !== 'string' || !NAME.test(s)) throw new Error(`store: bad ${what}`); return s; };

/** A stable, path-safe id for any string (a channel sender, a visitor id). */
export const idFor = (s) => `h_${crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 32)}`;

export function createStore({ dir = null } = {}) {
  const docs = new Map();   // `${collection}/${id}` -> value (memory mode)
  const logs = new Map();   // name -> string[] of JSON lines (memory mode)
  if (dir) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  const file = (collection, id) => path.join(dir, need(collection, 'collection'), `${need(id, 'id')}.json`);
  const logFile = (name) => path.join(dir, `${need(name, 'log name')}.jsonl`);

  function writeAtomic(target, text) {
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, text, { mode: 0o600 });
    fs.renameSync(tmp, target);
  }

  return {
    persistent: !!dir,

    getDoc(collection, id) {
      if (!dir) { const v = docs.get(`${need(collection, 'collection')}/${need(id, 'id')}`); return v === undefined ? null : structuredClone(v); }
      try { return JSON.parse(fs.readFileSync(file(collection, id), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    },

    putDoc(collection, id, value) {
      if (!dir) { docs.set(`${need(collection, 'collection')}/${need(id, 'id')}`, structuredClone(value)); return; }
      writeAtomic(file(collection, id), JSON.stringify(value));
    },

    delDoc(collection, id) {
      if (!dir) return docs.delete(`${need(collection, 'collection')}/${need(id, 'id')}`);
      try { fs.unlinkSync(file(collection, id)); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
    },

    listDocs(collection) {
      if (!dir) {
        const prefix = `${need(collection, 'collection')}/`;
        return [...docs.entries()].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => ({ id: k.slice(prefix.length), value: structuredClone(v) }));
      }
      let names = [];
      try { names = fs.readdirSync(path.join(dir, need(collection, 'collection'))); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      return names.filter((n) => n.endsWith('.json')).map((n) => {
        const id = n.slice(0, -5);
        return { id, value: JSON.parse(fs.readFileSync(file(collection, id), 'utf8')) };
      });
    },

    appendLog(name, entry) {
      const line = JSON.stringify(entry);
      if (!dir) { const l = logs.get(need(name, 'log name')) || []; l.push(line); logs.set(name, l); return; }
      fs.appendFileSync(logFile(name), `${line}\n`, { mode: 0o600 });
    },

    /** The last `limit` entries of a log, oldest first. */
    readLog(name, limit = 100) {
      let lines;
      if (!dir) lines = logs.get(need(name, 'log name')) || [];
      else { try { lines = fs.readFileSync(logFile(name), 'utf8').split('\n').filter(Boolean); } catch (e) { if (e.code === 'ENOENT') return []; throw e; } }
      return lines.slice(-limit).map((l) => JSON.parse(l));
    },

    deleteLog(name) {
      if (!dir) return logs.delete(need(name, 'log name'));
      try { fs.unlinkSync(logFile(name)); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
    },
  };
}
