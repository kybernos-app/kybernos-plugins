// Lancement de `dsh --profile headless --json` et lecture du flux d'événements.
//
// Vérifié sur DSH 0.1.6-alpha.2, séquence réelle :
//   {"type":"session","sessionId":…,"cwd":…}
//   {"type":"status","phase":"turn_start"|"step_start"|"step_end"|"turn_end",…}
//   {"type":"text","text":…}          (messages assistant validés)
//   {"type":"final","text":…}         (réponse finale, non tronquée)
// Types additionnels documentés : "thinking", "tool_call", "tool_result", "error".

import { spawn } from 'node:child_process';

const KILL_GRACE_MS = 5000;

/**
 * Parse un flux de lignes NDJSON et appelle onEvent pour chaque événement valide.
 * Renvoie { feed(chunk) } — les lignes incomplètes sont conservées.
 */
export function createEventParser(onEvent = () => {}) {
  let buffer = '';
  const state = { nonJsonLines: 0, events: 0 };
  return {
    state,
    feed(chunk) {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        let event = null;
        try {
          event = JSON.parse(line);
        } catch {
          state.nonJsonLines += 1;
          continue;
        }
        state.events += 1;
        onEvent(event);
      }
    },
    flush() {
      const line = buffer.trim();
      buffer = '';
      if (!line) return;
      try {
        const event = JSON.parse(line);
        state.events += 1;
        onEvent(event);
      } catch {
        state.nonJsonLines += 1;
      }
    },
  };
}

/**
 * Exécute une tâche en mode headless.
 * @returns {Promise<{ok:boolean, exitCode:number|null, sessionId:string|null, final:string,
 *   error:object|null, turnEnd:object|null, usage:object|null, stderr:string,
 *   durationMs:number, timedOut:boolean, aborted:boolean, events:object[]}>}
 */
export async function runHeadless({
  task,
  sessionId = null,
  cwd = process.cwd(),
  dshBin = 'dsh',
  dshArgsPrefix = [],
  profile = 'headless',
  extraArgs = [],
  timeoutMs = 15 * 60 * 1000,
  onEvent = () => {},
  signal = null,
  env = process.env,
} = {}) {
  const args = [...dshArgsPrefix, '--profile', profile, '--json'];
  if (sessionId) args.push('--session-id', String(sessionId));
  args.push(...extraArgs);
  args.push('-'); // la tâche arrive par stdin

  const startedAt = Date.now();
  const events = [];
  let resolvedSessionId = sessionId ? String(sessionId) : null;
  let final = '';
  let error = null;
  let turnEnd = null;
  let usage = null;
  let timedOut = false;
  let aborted = false;
  let stderr = '';

  const parser = createEventParser((event) => {
    events.push(event);
    if (event.type === 'session' && event.sessionId) resolvedSessionId = String(event.sessionId);
    if (event.type === 'final' && typeof event.text === 'string') final = event.text;
    if (event.type === 'error') error = event;
    if (event.type === 'status' && event.phase === 'turn_end') turnEnd = event;
    if (event.type === 'status' && event.usage) usage = event.usage;
    try {
      onEvent(event);
    } catch {
      /* un consommateur fautif ne doit pas casser le run */
    }
  });

  const child = spawn(dshBin, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => parser.feed(chunk));
  child.stderr.on('data', (chunk) => {
    if (stderr.length < 20000) stderr += chunk;
  });

  let settled = false;
  let exitCode = null;
  let killTimer = null;

  const kill = (sig) => {
    try {
      child.kill(sig);
    } catch {
      /* déjà mort */
    }
  };

  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    kill('SIGTERM');
    killTimer = setTimeout(() => kill('SIGKILL'), KILL_GRACE_MS);
  }, timeoutMs);

  const onAbort = () => {
    aborted = true;
    kill('SIGTERM');
    killTimer = setTimeout(() => kill('SIGKILL'), KILL_GRACE_MS);
  };
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    child.stdin.end(String(task ?? ''), 'utf8');
  } catch {
    /* le process a pu mourir aussitôt */
  }

  const closed = new Promise((resolve) => {
    child.on('close', (code) => {
      exitCode = code;
      resolve();
    });
    child.on('error', (err) => {
      error = { type: 'error', message: `spawn ${dshBin}: ${err.message}` };
      resolve();
    });
  });

  await closed;
  settled = true;
  clearTimeout(timeoutTimer);
  if (killTimer) clearTimeout(killTimer);
  if (signal) signal.removeEventListener('abort', onAbort);
  parser.flush();

  const turnFailed = Boolean(turnEnd && turnEnd.reason && turnEnd.reason.kind && turnEnd.reason.kind !== 'completed');
  const ok = !settled ? false : exitCode === 0 && !error && !turnFailed && !timedOut && !aborted;

  return {
    ok,
    exitCode,
    sessionId: resolvedSessionId,
    final,
    error,
    turnEnd,
    usage,
    stderr: stderr.trim(),
    durationMs: Date.now() - startedAt,
    timedOut,
    aborted,
    events,
  };
}
