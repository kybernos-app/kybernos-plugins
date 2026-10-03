#!/usr/bin/env node
// Faux `dsh --profile headless --json` pour les tests : aucun modèle, aucun coût.
//
// Comportements déclenchés par le texte de la tâche :
//   "ÉCHEC"   → turn_end reason aborted, exit 1
//   "LENT"    → attend 5 s avant de répondre (test du délai dépassé)
//   "FICHIER" → la réponse finale contient un marqueur [[send-file:./rapport.txt]]
// Adopte --session-id s'il est fourni, sinon génère session-fake-0001.

import process from 'node:process';

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', async () => {
  const args = process.argv.slice(2);
  const idx = args.indexOf('--session-id');
  const adopted = idx >= 0 ? args[idx + 1] : null;
  const sessionId = adopted || 'session-fake-0001';

  const fail = input.includes('ÉCHEC') || process.env.FAKE_DSH_FAIL === '1';
  if (input.includes('LENT')) await new Promise((resolve) => setTimeout(resolve, 5000));

  const text = fail
    ? ''
    : input.includes('FICHIER')
      ? `voici le rapport\n[[send-file:./rapport.txt]]`
      : `écho: ${input.trim()}`;

  const events = [
    { type: 'session', sessionId, cwd: process.cwd() },
    { type: 'status', phase: 'turn_start', turn: 1 },
    { type: 'status', phase: 'step_start', turn: 1, step: 1 },
    { type: 'tool_call', name: 'run_code' },
    { type: 'text', text: 'mi-parcours' },
    { type: 'status', phase: 'step_end', turn: 1, step: 1, usage: { totalTokens: 42 } },
    { type: 'status', phase: 'turn_end', turn: 1, reason: { kind: fail ? 'aborted' : 'completed' } },
    { type: 'final', text },
  ];
  for (const event of events) process.stdout.write(`${JSON.stringify(event)}\n`);
  if (fail) process.stderr.write('fake-dsh: tour interrompu\n');
  process.exitCode = fail ? 1 : 0;
});
