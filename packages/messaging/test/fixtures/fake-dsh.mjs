#!/usr/bin/env node
// Fake `dsh --profile headless --json` for the tests: no model, no cost.
//
// Behaviours triggered by the text of the task:
//   "FAIL"    → turn_end reason aborted, exit 1
//   "SLOW"    → waits 5 s before answering (test of the timeout)
//   "FILE"    → the final answer contains a marker [[send-file:./report.txt]]
// Adopts --session-id when it is given, otherwise generates session-fake-0001.

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

  const fail = input.includes('FAIL') || process.env.FAKE_DSH_FAIL === '1';
  if (input.includes('SLOW')) await new Promise((resolve) => setTimeout(resolve, 5000));

  const text = fail
    ? ''
    : input.includes('FILE')
      ? `here is the report\n[[send-file:./report.txt]]`
      : `echo: ${input.trim()}`;

  const events = [
    { type: 'session', sessionId, cwd: process.cwd() },
    { type: 'status', phase: 'turn_start', turn: 1 },
    { type: 'status', phase: 'step_start', turn: 1, step: 1 },
    { type: 'tool_call', name: 'run_code' },
    { type: 'text', text: 'halfway' },
    { type: 'status', phase: 'step_end', turn: 1, step: 1, usage: { totalTokens: 42 } },
    { type: 'status', phase: 'turn_end', turn: 1, reason: { kind: fail ? 'aborted' : 'completed' } },
    { type: 'final', text },
  ];
  for (const event of events) process.stdout.write(`${JSON.stringify(event)}\n`);
  if (fail) process.stderr.write('fake-dsh: turn interrupted\n');
  process.exitCode = fail ? 1 : 0;
});
