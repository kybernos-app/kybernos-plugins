// db.mjs — the one place that imports kybernos-db. Everything else in this app asks for it from here, so the vendored copy and the repository layout are one decision.
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { pickDb } from './db-path.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const DB_DIR = pickDb(HERE, existsSync)
if (DB_DIR === null) throw new Error('kybernos-db not found: build this app with scripts/build-tables-app.mjs (it copies kybernos-db to vendor/kybernos-db)')

const load = (file) => import(pathToFileURL(join(DB_DIR, file)).href)
const [api, service, template, core, served] = await Promise.all([load('api.mjs'), load('agent/service.mjs'), load('template.mjs'), load('core/index.mjs'), load('serve-user-file.mjs')])

export const { makeApi } = api
export const { makeService } = service
export const { buildStructure } = template
export const { PROFILE_ID } = core
export const { userFileHeaders } = served
