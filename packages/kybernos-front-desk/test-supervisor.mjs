// fd-supervisor.mjs: the life of the service process, over fakes (no real child, no network).
import { EventEmitter } from 'node:events'
import { mkdtempSync, existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { createConfigStore } from './fd-config.mjs'
import { createSupervisor, freePort } from './fd-supervisor.mjs'

let failed = 0
const ok = (name, cond, detail) => { console.log((cond ? '  ok   ' : '  FAIL ') + name + (cond || detail === undefined ? '' : '  -- ' + detail)); if (!cond) failed += 1 }

const KEY = 'sk-test-0123456789abcdef'
const setup = () => {
  const config = createConfigStore({ home: mkdtempSync(join(tmpdir(), 'kb-fd-sup-')) })
  config.write({ model: { baseUrl: 'https://gw.example/v1', name: 'm', apiKey: KEY } })
  return config
}

/** A fake world: processes that can be made to answer or die, a fetch that says what the "service" answers. */
const world = (config) => {
  const w = { spawned: [], alive: new Set(), answering: new Set(), killed: [], nextPid: 4000, exitOnSpawn: null, log: '' }
  w.spawn = (cmd, args, opts) => {
    const p = new EventEmitter()
    p.pid = w.nextPid++
    p.unref = () => {}
    w.spawned.push({ cmd, args, opts, pid: p.pid, proc: p })
    w.alive.add(p.pid)
    if (w.log) appendFileSync(config.logFile, w.log)
    if (w.exitOnSpawn !== null) setImmediate(() => { w.alive.delete(p.pid); p.emit('exit', w.exitOnSpawn, null) })
    else w.answeringPort = opts.env.FRONT_DESK_PORT
    return p
  }
  w.fetch = async (url, init) => {
    const port = Number(new URL(url).port)
    const auth = init && init.headers && init.headers.authorization
    if (auth !== 'Bearer ' + config.ownerToken()) return { status: 401, json: async () => ({}) }
    return w.answering.has(port) || String(port) === w.answeringPort ? { status: 200, json: async () => ({ shop: { slug: 'x' } }) } : Promise.reject(new Error('ECONNREFUSED'))
  }
  w.isAlive = (pid) => w.alive.has(pid)
  w.kill = (pid, sig) => { w.killed.push([pid, sig]); w.alive.delete(pid); const s = w.spawned.find((x) => x.pid === pid); if (s) setImmediate(() => s.proc.emit('exit', null, sig)); return true }
  return w
}
const make = (config, w, over = {}) => createSupervisor({ config, serviceDir: '/svc', spawn: w.spawn, fetchImpl: w.fetch, isAlive: w.isAlive, kill: w.kill, pickPort: async () => 8790, wait: () => new Promise((r) => setTimeout(r, 1)), startWaitMs: 300, stopWaitMs: 200, ...over })

// 1. not ready
{
  const config = createConfigStore({ home: mkdtempSync(join(tmpdir(), 'kb-fd-sup-')) })
  const w = world(config)
  const s = make(config, w)
  const r = await s.start()
  ok('not ready: no process is started, and it says what is missing', r.ok === false && r.error === 'not_ready' && r.missing.includes('model_key') && w.spawned.length === 0 && s.status().state === 'stopped')
}

// 2. a normal start
{
  const config = setup()
  const w = world(config)
  process.env.LEAK_ME = 'LEAK'
  const s = make(config, w)
  const r = await s.start()
  const sp = w.spawned[0]
  ok('start: one process, node + the service script, detached, output to a file', r.ok === true && w.spawned.length === 1 && sp.cmd === process.execPath && sp.args[0] === '/svc/bin/front-desk.mjs' && sp.opts.detached === true && typeof sp.opts.stdio[1] === 'number')
  ok('its environment is the hermetic one: the key and token it needs, nothing of the owner\'s', sp.opts.env.MODEL_API_KEY === KEY && sp.opts.env.FRONT_DESK_OWNER_TOKEN === config.ownerToken() && sp.opts.env.LEAK_ME === undefined)
  ok('it is told to listen on 127.0.0.1 only', sp.opts.env.FRONT_DESK_HOST === '127.0.0.1' && sp.opts.env.FRONT_DESK_PORT === '8790')
  ok('running: port, pid, a target for the proxy and the tools', s.status().state === 'running' && s.status().port === 8790 && s.status().pid === sp.pid && s.target().port === 8790 && s.target().token === config.ownerToken())
  ok('the pid file remembers it', JSON.parse(readFileSync(config.pidFile, 'utf8')).pid === sp.pid)
  ok('a second start does not start a second process', (await s.start()).ok === true && w.spawned.length === 1)
  ok('the starter fiche and the data folder were made', existsSync(config.ficheFile) && existsSync(config.dataDir))

  // stop
  const st = await s.stop()
  ok('stop: TERM to that process, state stopped, pid file gone, no target', st.ok && w.killed[0][0] === sp.pid && w.killed[0][1] === 'SIGTERM' && s.status().state === 'stopped' && !existsSync(config.pidFile) && s.target() === null)
  ok('a stop with nothing running is fine', (await s.stop()).ok === true)
}

// 3. it exits before answering: the log tail explains, secrets scrubbed
{
  const config = setup()
  const w = world(config)
  w.exitOnSpawn = 1
  w.log = 'front-desk: MODEL_BASE_URL, MODEL_API_KEY and MODEL_NAME are required\nfront-desk: bad key ' + KEY + ' and token ' + config.ownerToken() + '\n'
  const s = make(config, w)
  const r = await s.start()
  ok('a service that dies at start: failed, with the log tail', r.ok === false && r.error === 'start_failed' && s.status().state === 'failed' && /required/.test(r.detail))
  ok('no secret in what is reported', !JSON.stringify(r).includes(KEY) && !JSON.stringify(r).includes(config.ownerToken()) && !s.logs().includes(KEY) && !s.logs().includes(config.ownerToken()) && s.logs().includes('***'))
  ok('and no pid file is left', !existsSync(config.pidFile))
}

// 4. never answers: stopped, not left running
{
  const config = setup()
  const w = world(config)
  const s = make(config, w, { fetchImpl: async () => { throw new Error('ECONNREFUSED') }, startWaitMs: 60 })
  const r = await s.start()
  ok('a service that never answers is stopped and reported', r.ok === false && w.killed.length >= 1 && s.status().state === 'failed' && s.target() === null)
}

// 5. adoption of a service that outlived the last DSH
{
  const config = setup()
  const w = world(config)
  writeFileSync(config.pidFile, JSON.stringify({ pid: 777, port: 8801 }))
  w.alive.add(777); w.answering.add(8801)
  const s = make(config, w)
  const r = await s.start()
  ok('adopts a live service that answers the owner token: no second process', r.ok && r.adopted === true && w.spawned.length === 0 && s.status().port === 8801 && s.status().pid === 777)
  await s.stop()
  ok('and can stop it', w.killed.some((k) => k[0] === 777))
}
{
  const config = setup()
  const w = world(config)
  writeFileSync(config.pidFile, JSON.stringify({ pid: 778, port: 8802 }))
  w.alive.add(778) // alive, but it does not answer: not ours
  const s = make(config, w)
  await s.start()
  ok('a pid that is alive but does not answer is not adopted (a new process starts)', w.spawned.length === 1 && !w.killed.some((k) => k[0] === 778))
}
{
  const config = setup()
  const w = world(config)
  writeFileSync(config.pidFile, JSON.stringify({ pid: 779, port: 8803 }))
  const s = make(config, w)
  await s.start()
  ok('a stale pid file (process gone) is dropped and a new process starts', w.spawned.length === 1 && JSON.parse(readFileSync(config.pidFile, 'utf8')).pid === w.spawned[0].pid)
}

// 6. it dies while running
{
  const config = setup()
  const w = world(config)
  const s = make(config, w)
  await s.start()
  w.alive.delete(w.spawned[0].pid)
  w.spawned[0].proc.emit('exit', 137, null)
  ok('a service that stops by itself shows as failed, with no target', s.status().state === 'failed' && /137/.test(s.status().error) && s.target() === null && !existsSync(config.pidFile))
  const again = await s.start()
  ok('and can be started again', again.ok === true && w.spawned.length === 2)
}

// 7. one start at a time
{
  const config = setup()
  const w = world(config)
  const s = make(config, w)
  const [a, b] = await Promise.all([s.start(), s.start()])
  ok('two starts at once make one process', a.ok && b.ok && w.spawned.length === 1)
}

// 8. a real port
{
  const p = await freePort(0)
  ok('freePort gives a port', Number.isInteger(p) && p > 0)
  const busy = createServer()
  await new Promise((r) => busy.listen(0, '127.0.0.1', r))
  const taken = busy.address().port
  const q = await freePort(taken)
  ok('a busy preferred port is not returned', q !== taken && q > 0)
  busy.close()
}
delete process.env.LEAK_ME
process.exit(failed ? 1 : 0)
