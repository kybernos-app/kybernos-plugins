#!/usr/bin/env node
/** The member cap of a team (GET /kybernos/team-cap) reads the right place on each engine (2026-11-18).
 *   - DSH up to 0.2.2-rc.1: `maxMembers` of the team service, and it wins when it is there;
 *   - DSH 0.2.2-rc.2 and later: no `maxMembers`, the cap is the subagent runtime's `maxActiveSubagents` (a live value, `.get()`);
 *   - nothing readable: `null`, never an invented number (the page then draws no denominator).
 *  Usage: node packages/kybernos-plugin/test-team-cap.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { capFromValue, capFromTeamService, capFromSubagentService, readTeamCap } from './team-cap.mjs'

const live = (n) => ({ get: () => n })
const services = (map) => (name) => { if (!(name in map)) throw new Error('no service ' + name); return map[name] }

// values
assert.equal(capFromValue(16), 16)
assert.equal(capFromValue('12'), 12)
assert.equal(capFromValue(7.9), 7)
for (const bad of [0, -1, NaN, Infinity, '', 'x', '1.5', null, undefined, {}, []]) assert.equal(capFromValue(bad), null, 'not a cap: ' + String(bad))
console.log('  ✓ a cap is a whole number of at least 1, nothing else')

// team service (DSH <= 0.2.2-rc.1)
assert.equal(capFromTeamService({ maxMembers: 16 }), 16)
assert.equal(capFromTeamService({ roster: { maxMembers: 9 } }), 9)
assert.equal(capFromTeamService({ config: { maxMembers: 8 } }), 8)
assert.equal(capFromTeamService({ roster: { config: { maxMembers: 5 } } }), 5)
assert.equal(capFromTeamService({ config: { maxTasks: 256 } }), null, 'the rc.2+ team service has no member cap')
for (const none of [null, undefined, 3, 'x']) assert.equal(capFromTeamService(none), null)
console.log('  ✓ the team service answers where the older engine puts maxMembers')

// subagent runtime (DSH >= 0.2.2-rc.2)
assert.equal(capFromSubagentService({ config: { maxActiveSubagents: live(20) } }), 20)
assert.equal(capFromSubagentService({ config: { maxActiveSubagents: 8 } }), 8)
assert.equal(capFromSubagentService({ config: { maxActiveSubagents: { get () { throw new Error('boom') } } } }), null, 'a live value that throws is not a cap')
assert.equal(capFromSubagentService({ config: { maxActiveSubagents: live(0) } }), null)
assert.equal(capFromSubagentService({ config: {} }), null)
for (const none of [null, undefined, {}, 4]) assert.equal(capFromSubagentService(none), null)
console.log('  ✓ the subagent runtime answers with its live maxActiveSubagents')

// the order
assert.equal(readTeamCap({ get: services({ agentTeams: { maxMembers: 16 }, subagents: { config: { maxActiveSubagents: live(20) } } }) }), 16,
  'on the older engine the team service wins, nothing changes')
assert.equal(readTeamCap({ get: services({ agentTeams: { config: { maxTasks: 256 } }, subagents: { config: { maxActiveSubagents: live(20) } } }) }), 20,
  'on 0.2.2-rc.2+ the team service has no cap: the subagent cap is used')
assert.equal(readTeamCap({ get: services({ subagents: { config: { maxActiveSubagents: live(12) } } }) }), 12, 'a missing team service does not stop the fallback')
assert.equal(readTeamCap({ get: services({ agentTeams: null }), bound: { maxMembers: 11 } }), 11, 'the service bound at boot is the second source')
assert.equal(readTeamCap({ get: services({ 'agent-team': { maxMembers: 6 } }) }), 6, 'the service registered under the plugin id is the third')
assert.equal(readTeamCap({ get: services({}) }), null, 'nothing readable: null, not a number made up')
assert.equal(readTeamCap({ get: () => { throw new Error('ctx is gone') } }), null, 'a throwing ctx.get gives null')
console.log('  ✓ the order is team service, bound service, plugin id, then the subagent runtime; nothing readable gives null')

console.log('\nteam-cap — all pass')
