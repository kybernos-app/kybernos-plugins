// Tables app server (stack: tables). The app contract of the apps runtime: `PORT` from the environment, listening on 127.0.0.1, a line on stdout once it does.
// The routes are in app.mjs; kybernos-db is read through lib/db.mjs.
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { buildApp } from './app.mjs'
import { loadConfig } from './lib/boot.mjs'

const config = loadConfig(process.env, dirname(fileURLToPath(import.meta.url)))
const built = await buildApp(config)
const server = serve({ fetch: built.app.fetch, port: config.port, hostname: config.host }, (info) => console.log('listening ' + info.port))

const stop = () => server.close(() => { built.close(); process.exit(0) })
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
