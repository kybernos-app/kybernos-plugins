#!/usr/bin/env node
/** Which account a connection is (2026-10-23): the host reads ONE label out of the `user_info` Composio keeps per account (an e-mail, else a name)
 *  and keeps nothing else of it. The shapes below are the ones the real answers have, measured on a connected account (values made up):
 *  Gmail `email` + `name`, Calendar `summary` (the address of the primary calendar), Drive `user.emailAddress`, Sheets `email`,
 *  Outlook `mail` + `user_principal_name`.
 *  Usage: node packages/kybernos-composio/test-identity.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { identityOf } from './index.js'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

assert.equal(identityOf({ email: 'ada@example.org', hosted_domain: {}, name: 'Ada', sub: '1234567890' }), 'ada@example.org')
assert.equal(identityOf({ kind: 'calendar#calendarList', etag: '"x"', summary: 'ada@example.org', description: '', timeZone: 'Europe/Paris', accessRole: 'owner', defaultReminders: [], nextPageToken: 'Cj0E=', items: [] }), 'ada@example.org')
assert.equal(identityOf({ user: { kind: 'drive#user', displayName: 'Ada L', photoLink: 'https://x/p', me: true, permissionId: '99', emailAddress: 'ada@example.org' } }), 'ada@example.org')
assert.equal(identityOf({ sub: '1234567890', picture: 'https://x/p', email: 'ada@example.org', email_verified: true }), 'ada@example.org')
assert.equal(identityOf({ display_name: 'Ada L', id: 'f3', mail: 'ada@corp.example', user_principal_name: 'ada.l@corp.example' }), 'ada@corp.example')
ok('the e-mail of each toolkit\'s own shape: Gmail, Calendar, Drive, Sheets, Outlook')

assert.equal(identityOf({ user_principal_name: 'ada.l@corp.example', display_name: 'Ada L' }), 'ada.l@corp.example')
assert.equal(identityOf({ login: 'ada-l', id: 7, avatar_url: 'https://x/a' }), 'ada-l')
assert.equal(identityOf({ display_name: 'Ada L', name: 'ignored' }), 'Ada L')
assert.equal(identityOf({ summary: 'Team calendar', name: 'Ada' }), 'Ada')
ok('no e-mail: a name (display name, name, login), and a calendar summary that is not an address is no identity')

assert.equal(identityOf(null), null)
assert.equal(identityOf(undefined), null)
assert.equal(identityOf('ada@example.org'), null)
assert.equal(identityOf([{ email: 'ada@example.org' }]), null)
assert.equal(identityOf({}), null)
assert.equal(identityOf({ sub: '1', picture: 'https://x/p', nextPageToken: 'tok', access_token: 'secret' }), null)
assert.equal(identityOf({ email: '   ' }), null)
assert.equal(identityOf({ email: 'not an address', mail: 'also not' }), null)
ok('nothing to say: null (ids, picture links, tokens and cursors are never an identity)')

assert.equal(identityOf({ a: { b: { email: 'deep@example.org' } } }), null)
assert.equal(identityOf({ list: [{ email: 'in-array@example.org' }] }), null)
ok('only the strings of user_info and of its objects one level down are looked at')

const long = 'x'.repeat(300)
assert.equal(identityOf({ name: long }).length, 120)
ok('a long value is cut')

console.log(pass + ' tests passed')
