import test from 'node:test';
import assert from 'node:assert/strict';
import { runScenarios, SCENARIO_COUNT } from '../core/scenarios.mjs';

test('the five scenarios pass on their own', async () => {
  const results = await runScenarios();
  assert.equal(results.length, 5);
  assert.equal(SCENARIO_COUNT, 5);
  for (const r of results) assert.deepEqual(r.failures, [], r.name);
});
