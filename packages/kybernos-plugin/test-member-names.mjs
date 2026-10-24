#!/usr/bin/env node
/** The Share panel names the members the server names (T1-5, 2026-10-24). The host used to keep a member's id and role only, so every member but the person was
 *  « Member 3f2a91c0 ». The host now keeps `name` and `email` (kybernos-cloud/test-cloud-host.mjs, « members read »); this file pins the panel's rule: the person is
 *  « you », anyone else is their name, else their e-mail, and only a member the server names no further is « Member » + the start of the id.
 *
 *  Usage: node packages/kybernos-plugin/test-member-names.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')
const at = src.indexOf('const nomMembre = (m) =>')
assert.ok(at > 0, 'nomMembre exists')
const end = src.indexOf('\n', at)
const nomMembre = new Function('moi', 'T', src.slice(at, end) + '\nreturn nomMembre')
const T = (key) => ({ 'kbsd.you': 'You', 'kbsd.member': 'Member' })[key] || key
const me = { id: 'u-me', name: 'Ada Lovelace', email: 'ada@example.test' }
const name = nomMembre(me, T)

assert.equal(name({ user_id: 'u-me' }), 'Ada Lovelace', 'the person: their own name')
assert.equal(name({ user_id: 'u-1', name: 'Bob Martin', email: 'bob@example.test' }), 'Bob Martin', 'another member: the name the server sends')
assert.equal(name({ user_id: 'u-2', email: 'carol@example.test' }), 'carol@example.test', 'no name: the e-mail')
assert.equal(name({ user_id: '3f2a91c0-1111-4222-8333-444455556666' }), 'Member 3f2a91c0', 'neither: « Member » and the start of the id, as before')
assert.equal(nomMembre({ id: 'u-me' }, T)({ user_id: 'u-me' }), 'You', 'the person with no name or e-mail at all is « you »')
console.log('  ✓ the Share panel names members by name, then e-mail, then the id')
console.log('\n1 check passed')
