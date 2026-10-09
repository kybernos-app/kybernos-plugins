// First-run convenience for the container: give DSH one workspace (a folder it can work in), so the first screen is
// the chat and not a folder picker.
//
//   node seed-workspace.mjs <workspace.json> <folder>
//
// DSH creates `<dsh home>/storages/workspace.json` at its first start with no workspace in it. This adds one only when
// the file has EXACTLY that empty shape (unit "workspace", version 2): a file with workspaces, or in another layout
// (a newer DSH), is left alone and DSH asks for a folder as it always does. It never throws.
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'

export function seedWorkspace (file, folder) {
  let doc
  try { doc = JSON.parse(readFileSync(file, 'utf8')) } catch (e) { return false }
  const empty = doc !== null && typeof doc === 'object' &&
    doc.unit?.name === 'workspace' && doc.unit?.version === 2 &&
    Array.isArray(doc.global?.workspaceIds) && doc.global.workspaceIds.length === 0 &&
    doc.tables?.workspaces !== null && typeof doc.tables?.workspaces === 'object' && Object.keys(doc.tables.workspaces).length === 0
  if (!empty) return false
  const id = randomUUID()
  const now = new Date().toISOString()
  doc.global.workspaceIds.push(id)
  doc.tables.workspaces[id] = { path: folder, title: basename(folder), sessionIds: [], createdAt: now, updatedAt: now }
  try { writeFileSync(file, JSON.stringify(doc)) } catch (e) { return false }
  return true
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [file, folder] = process.argv.slice(2)
  if (file && folder && seedWorkspace(file, folder)) console.log(`[entrypoint] first workspace: ${folder}`)
}
