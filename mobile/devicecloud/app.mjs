#!/usr/bin/env node
// Manage the builds stored at BrowserStack App Automate.
//   node mobile/devicecloud/app.mjs upload <file.ipa|file.apk> [custom_id]   prints the bs:// url
//   node mobile/devicecloud/app.mjs list                                      prints custom id and url of each stored app
//   node mobile/devicecloud/app.mjs delete <bs://id | id>                     removes one
//   node mobile/devicecloud/app.mjs devices [ios|android]                      lists the real devices the plan can use (name and OS version)
import { openAsBlob } from 'node:fs'
import { basename } from 'node:path'
import { api, loadEnv, requireEnv, redact } from './lib.mjs'

export const upload = async (file, customId) => {
  const form = new FormData()
  form.append('file', await openAsBlob(file), basename(file))
  if (customId) form.append('custom_id', customId)
  const r = await api('POST', '/app-automate/upload', { body: form, timeoutMs: 10 * 60 * 1000 })
  if (r.status !== 200 || !r.json?.app_url) throw new Error('upload failed: HTTP ' + r.status + ' ' + redact(r.text).slice(0, 200))
  return r.json.app_url
}
export const list = async () => {
  const r = await api('GET', '/app-automate/recent_apps')
  if (r.status !== 200) throw new Error('list failed: HTTP ' + r.status)
  return Array.isArray(r.json) ? r.json.map((a) => ({ customId: a.custom_id, url: a.app_url })) : []
}
export const devices = async (platform) => {
  const r = await api('GET', '/app-automate/devices.json')
  if (r.status !== 200 || !Array.isArray(r.json)) throw new Error('device list failed: HTTP ' + r.status)
  return r.json.filter((d) => platform === undefined || String(d.os).toLowerCase() === platform).map((d) => ({ name: d.device, os: d.os_version }))
}
export const remove = async (urlOrId) => {
  const r = await api('DELETE', '/app-automate/app/delete/' + String(urlOrId).replace(/^bs:\/\//, ''))
  if (r.status !== 200 || r.json?.success !== true) throw new Error('delete failed: HTTP ' + r.status + ' ' + redact(r.text).slice(0, 200))
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [cmd, a, b] = process.argv.slice(2)
  try {
    loadEnv(); requireEnv(['BROWSERSTACK_USERNAME', 'BROWSERSTACK_ACCESS_KEY'])
    if (cmd === 'upload' && a) console.log(await upload(a, b))
    else if (cmd === 'list') for (const x of await list()) console.log((x.customId ?? '-') + '  ' + x.url)
    else if (cmd === 'devices') for (const d of await devices(a)) console.log(d.name + '  ' + d.os)
    else if (cmd === 'delete' && a) { await remove(a); console.log('deleted ' + a) }
    else { console.error('usage: app.mjs upload <file> [custom_id] | list | devices [ios|android] | delete <bs://id>'); process.exit(2) }
  } catch (e) { console.error(redact(e.message)); process.exit(1) }
}
