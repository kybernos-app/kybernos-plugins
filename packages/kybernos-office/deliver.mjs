// The `deliver_files` tool: files the model made for the person appear as cards in the chat, and a click opens them in the right-hand panel (Word, Excel, PDF and
// Markdown files in our editors, anything else in DSH's own preview). DSH's own `present` tool does the same but only some presets carry it (the `minimal` preset does
// not), so without this a chat that wrote five files said where they were and showed nothing. The card itself is DSH's: it is drawn from a `deliverables/presented` record
// of the session, which this tool writes exactly as `present` does (after the call's result, so the card matches the recorded call).
//
// Pure: the services it needs (`fs`, `agents`, `workingDirectory`) are handed in, so the test runs without DSH.

export const TOOL = 'deliver_files'
export const MAX_FILES = 8

export const DESCRIPTION = 'Shows the files you made for the person as cards in the chat. One click opens a card in the right-hand panel, where Word (.docx), Excel (.xlsx), PDF and Markdown files '
  + 'can be read and edited (other files are previewed). Call it ONCE, at the end of the turn, with the final files: for every document, spreadsheet, slide deck, PDF, mockup or report you '
  + 'made, instead of only writing their paths in your message. Make NEW files for each request, in a folder named after the subject and today\'s date: never hand over files that '
  + 'earlier chats left in the folder, unless the person asked for those. Paths are relative to the working folder; at most ' + MAX_FILES + ' files per call.'

export const PARAMETERS = {
  files: {
    type: 'array',
    required: true,
    description: 'The final files, the most important first. Each: { path, description? } — a short line saying what the file is.',
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: { type: 'string', required: true, description: 'Path of an existing regular file; relative paths start from the working folder.' },
        description: { type: 'string', description: 'What the file is, in a few words, in the person\'s language.' }
      }
    }
  }
}

const plain = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The tool's definition, in the « spec » form the host turns into `defineTool`. `services()` hands back what is needed at call time (or null while DSH has not started them). */
export function deliverTool (services) {
  /** Deliveries waiting for their result: the card is written once the call is recorded, as `present` does. */
  const pending = new WeakMap()
  return {
    pending,
    options: {
      name: TOOL,
      description: DESCRIPTION,
      parameters: PARAMETERS,
      render: (_args, value) => [{ type: 'text', text: plain(value) && Array.isArray(value.files) ? value.files.map((f) => 'Delivered ' + f.path).join('\n') : String(value) }],
      execute: async (args, exec) => {
        const svc = services()
        if (svc === null) throw new Error('deliver_files is not ready: DSH has not started the services it needs')
        if (!plain(exec) || !plain(exec.agent) || !plain(exec.agent.session)) throw new Error('deliver_files needs a chat session')
        const files = plain(args) && Array.isArray(args.files) ? args.files : []
        if (files.length === 0 || files.length > MAX_FILES) throw new Error('deliver_files takes 1 to ' + MAX_FILES + ' files')
        const boundary = svc.agents.turnBoundaryOf(exec.agent.session)
        if (!plain(boundary) || boundary.openTurnStartSeq === null || boundary.openTurnStartSeq === undefined) throw new Error('deliver_files needs an open turn')
        const cwd = await svc.workingDirectory.ensure(exec.agent, exec.signal)
        const given = []
        for (const file of files) {
          if (!plain(file) || typeof file.path !== 'string' || file.path.trim() === '') throw new Error('deliver_files needs a path for each file')
          const entry = await svc.fs.lstat(file.path, { cwd }, exec.signal)
          if (entry !== undefined && entry.type !== 'file') throw new Error('Cannot deliver ' + file.path + ': not a regular file')
          const target = await svc.fs.resolve(file.path, { cwd, signal: exec.signal })
          const info = await svc.fs.stat(target, exec.signal)
          if (info === undefined) throw new Error('Cannot deliver ' + file.path + ': file not found. Check the path, create the file if needed, and retry.')
          if (info.type !== 'file') throw new Error('Cannot deliver ' + file.path + ': not a regular file')
          const out = { path: svc.fs.processPath(target) }
          if (typeof file.description === 'string' && file.description.trim() !== '') out.description = file.description.trim()
          given.push(out)
        }
        if (exec.signal !== undefined && exec.signal !== null && typeof exec.signal.throwIfAborted === 'function') exec.signal.throwIfAborted()
        pending.set(exec, { session: exec.agent.session, turn: boundary.lastTurn, files: given })
        return { turn: boundary.lastTurn, files: given }
      }
    }
  }
}

/** The `tools/result` observer: once the call succeeded, write the record the card is drawn from. Returns whether a card was written. */
export function writeCard (pending, exec, result) {
  const delivery = pending.get(exec)
  pending.delete(exec)
  if (delivery === undefined || (plain(result) && result.isError === true)) return false
  delivery.session.append('deliverables/presented', { turn: delivery.turn, callId: exec.callId, files: delivery.files })
  return true
}
