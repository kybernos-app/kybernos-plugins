// egress.sh: the rules a cloud computer holds for its outbound traffic, read as TEXT (recette L3-12 and L3-28, decision DL-14).
//
// There is no Linux and no `nft` where this runs, and nothing here loads a rule into a kernel: `nft` and `getent` are stand-ins on the PATH. The first records the file it is asked to load
// (so the test reads exactly what would have been loaded, in the order it would have been read: nftables takes the first rule that matches), the second answers from a table of names.
// What is proven is the TEXT of the policy, in each of the three modes. NOT proven here, and to be done on a Linux machine before the image ships: that nftables accepts this text, and that
// a computer in each mode still resolves names and still reaches the platform (`nft -c -f` on the generated file, then one machine of each mode on Fly).
//
// The faults it keeps out (egress.sh, before the fix):
//  - L3-12: `udp dport 53 accept` and `tcp dport 53 accept` with no address: in the strictest mode ALL of port 53, TCP included, left for any address (an exfiltration channel that survives the
//    strictest policy: the files, tokens and memories of the volume could go out to a server of the attacker's choosing on port 53);
//  - L3-28: the refusal of the private ranges was written for the `public` mode only, while the header promises it in every mode: in `list` a permitted name that answers 169.254.169.254
//    (the metadata service) or a private address was accepted.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = join(dirname(fileURLToPath(import.meta.url)), 'egress.sh')
// The shell the image runs the script with is dash or busybox ash (`sh egress.sh` in entrypoint.sh); KB_TEST_SH=/bin/dash plays the same rows with it.
const SH = process.env.KB_TEST_SH || '/bin/sh'

const PRIVATE_V4 = '    ip daddr { 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, 100.64.0.0/10, 127.0.0.0/8 } drop'
const PRIVATE_V6 = '    ip6 daddr { fc00::/7, fe80::/10 } drop'
// The only rules allowed to match every address, and why: the machine's own loopback, the link's housekeeping (ICMP types that carry no payload of ours), and the replies of the gate
// (a packet that leaves FROM the port the gate listens on; nothing else listens there).
const UNCONDITIONED = [
  '    oifname "lo" accept',
  '    icmpv6 type { nd-router-solicit, nd-neighbor-solicit, nd-neighbor-advert, packet-too-big, destination-unreachable, time-exceeded } accept',
  '    icmp type { destination-unreachable, time-exceeded } accept',
  '    tcp sport 3080 accept',
]

/** A throw-away machine: the stand-ins on a PATH of their own, a resolv.conf, a table of names, and where the loaded rules are kept. */
const machine = ({ hosts = {}, resolv = 'nameserver fdaa::3\n', nftExit = 0, sleeps = 'none' } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'kb-egress-'))
  const bin = join(dir, 'bin')
  const loads = join(dir, 'loads')
  mkdirSync(bin)
  mkdirSync(loads)
  const put = (name, text) => { writeFileSync(join(bin, name), text); chmodSync(join(bin, name), 0o755) }
  // nft: keeps a copy of every file it is asked to load, numbered, and answers with the exit code of the case.
  put('nft', `#!/bin/sh
[ "$1" = "-f" ] || exit 2
n=$(cat "${loads}/count" 2>/dev/null || echo 0)
n=$((n + 1))
echo "$n" > "${loads}/count"
cp "$2" "${loads}/$n.nft"
echo "$2" > "${loads}/path-$n"
exit ${nftExit}
`)
  // getent: `getent ahosts <name>` answers one line per address, as glibc does.
  const table = join(dir, 'hosts.txt')
  writeFileSync(table, Object.entries(hosts).flatMap(([name, addrs]) => addrs.map((a) => name + ' ' + a)).join('\n') + '\n')
  put('getent', `#!/bin/sh
[ "$1" = "ahosts" ] || exit 2
awk -v h="$2" '$1 == h { print $2 " STREAM " h }' "${table}"
`)
  // sleep: the minute between two refreshes. 'none' ends the refresh loop at once (the first sleep fails); 'once' lets exactly one refresh happen, after running the hook of the case.
  const hook = join(dir, 'hook.sh')
  writeFileSync(hook, '')
  put('sleep', sleeps === 'once'
    ? `#!/bin/sh
c=$(cat "${dir}/sleeps" 2>/dev/null || echo 0)
echo $((c + 1)) > "${dir}/sleeps"
[ "$c" -eq 0 ] || exit 1
. "${hook}"
exit 0
`
    : '#!/bin/sh\nexit 1\n')
  const resolvFile = join(dir, 'resolv.conf')
  if (resolv !== null) writeFileSync(resolvFile, resolv)
  const rulesFile = join(dir, 'rules.nft')
  const run = (mode, env = {}) => {
    // The stand-ins first; the system's own sed, sort, awk and tr after them. No `nft` anywhere else: the real one would be a different story.
    const out = spawnSync(SH, [script], {
      env: { PATH: bin + ':/usr/bin:/bin', KYBERNOS_EGRESS_MODE: mode, KYBERNOS_RESOLV_CONF: resolvFile, KYBERNOS_EGRESS_RULES_FILE: rulesFile, ...env },
      encoding: 'utf8', timeout: 20000,
    })
    return out
  }
  const loaded = (n = 1) => readFileSync(join(loads, n + '.nft'), 'utf8')
  const count = () => { try { return Number(readFileSync(join(loads, 'count'), 'utf8')) } catch (e) { return 0 } }
  const loadedPath = (n = 1) => readFileSync(join(loads, 'path-' + n), 'utf8').trim()
  return { dir, run, loaded, count, loadedPath, rulesFile, resolvFile, hook }
}

const NAMES = {
  'api.kybernos.example': ['203.0.113.10', '2001:db8:1::10'],
  'docs.example': ['198.51.100.7'],
  // A permitted name whose DNS answers what a hostile owner would make it answer (L3-28): the metadata service, a private address, a 6PN-looking one, a loopback.
  'rebinding.example': ['169.254.169.254', '10.0.0.5', '192.168.1.20', 'fdaa:0:1::5', '127.0.0.1', '100.64.3.3'],
}
const ENV = { KYBERNOS_API: 'https://api.kybernos.example', KYBERNOS_EGRESS_ALLOW: 'docs.example,rebinding.example' }
const lines = (text) => text.split('\n')
const accepts = (text) => lines(text).filter((l) => /\baccept$/.test(l))
const firstIndex = (text, pred) => lines(text).findIndex(pred)

for (const mode of ['closed', 'list', 'public']) {
  test(mode + ': the policy and its frame', () => {
    const m = machine({ hosts: NAMES })
    const r = m.run(mode, ENV)
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.match(r.stdout, new RegExp('\\[egress\\] mode ' + mode + ' held'))
    assert.equal(m.count() >= 1, true, 'the rules were handed to nft')
    const text = m.loaded(1)
    assert.match(text, mode === 'public' ? /policy accept;/ : /policy drop;/)
    assert.ok(text.startsWith('add table inet kbguard\ndelete table inet kbguard\ntable inet kbguard {\n'), 'the table is replaced whole, atomically')
  })

  test(mode + ': no rule lets a port through to every address (L3-12)', () => {
    const m = machine({ hosts: NAMES })
    assert.equal(m.run(mode, ENV).status, 0)
    const text = m.loaded(1)
    const loose = accepts(text).filter((l) => !/\bdaddr\b/.test(l) && !UNCONDITIONED.includes(l))
    assert.deepEqual(loose, [], 'every accept names an address, except the four housekeeping lines')
    assert.deepEqual(lines(text).filter((l) => /dport 53/.test(l) && !/\bdaddr\b/.test(l)), [], 'port 53 is never open to every address')
    // And the four housekeeping lines are all there (the machine loses its resolver without neighbour discovery) and are not more than that.
    for (const l of UNCONDITIONED) assert.ok(lines(text).includes(l), 'missing: ' + l)
    assert.equal(accepts(text).filter((l) => !/\bdaddr\b/.test(l)).length, UNCONDITIONED.length)
  })

  test(mode + ': DNS goes to the resolver, over UDP and over TCP, and to no other address (L3-12)', () => {
    const m = machine({ hosts: NAMES })
    assert.equal(m.run(mode, ENV).status, 0)
    const dns = lines(m.loaded(1)).filter((l) => /dport 53/.test(l))
    assert.deepEqual(dns, ['    ip6 daddr fdaa::3 udp dport 53 accept', '    ip6 daddr fdaa::3 tcp dport 53 accept'])
  })

  test(mode + ': the private ranges are refused (L3-28), after what may sit inside them and before the names a person allowed', () => {
    const m = machine({ hosts: NAMES })
    assert.equal(m.run(mode, ENV).status, 0)
    const text = m.loaded(1)
    assert.equal(lines(text).filter((l) => l === PRIVATE_V4).length, 1, 'the IPv4 ranges, once')
    assert.equal(lines(text).filter((l) => l === PRIVATE_V6).length, 1, 'the IPv6 ranges, once')
    const drop4 = firstIndex(text, (l) => l === PRIVATE_V4)
    const drop6 = firstIndex(text, (l) => l === PRIVATE_V6)
    // Before the drops: the resolver and the platform (Fly's resolver, fdaa::3, is itself inside fc00::/7).
    for (const needle of ['ip6 daddr fdaa::3 udp dport 53 accept', 'ip6 daddr fdaa::3 tcp dport 53 accept', 'ip daddr 203.0.113.10 tcp dport { 443 } accept', 'ip6 daddr 2001:db8:1::10 tcp dport { 443 } accept']) {
      const at = firstIndex(text, (l) => l.trim() === needle)
      assert.ok(at > 0 && at < drop4 && at < drop6, needle + ' comes before the refusal of the private ranges (' + at + ' / ' + drop4 + ')')
    }
    // After the drops: every rule for a name a person allowed, so that nothing a name answers can reach a private address.
    const named = lines(text).map((l, i) => [l, i]).filter(([l]) => /tcp dport \{ 80, 443 \} accept/.test(l))
    if (mode === 'list') {
      assert.ok(named.length >= 1, 'the names that were allowed are there')
      for (const [l, i] of named) assert.ok(i > drop4 && i > drop6, l.trim() + ' comes after the drops')
    } else {
      assert.deepEqual(named, [], 'a mode that allows no names writes no rule for them')
    }
  })
}

test('list: the rules of a name that answers private addresses all stand behind the drops; the public ones are accepted', () => {
  const m = machine({ hosts: NAMES })
  assert.equal(m.run('list', ENV).status, 0)
  const text = m.loaded(1)
  const drop = Math.max(firstIndex(text, (l) => l === PRIVATE_V4), firstIndex(text, (l) => l === PRIVATE_V6))
  const reachable = lines(text).slice(0, drop).filter((l) => /\baccept$/.test(l))
  // What can still be reached before the drops: housekeeping, the resolver, the platform. Never an address of the hostile name.
  for (const bad of ['169.254.169.254', '10.0.0.5', '192.168.1.20', 'fdaa:0:1::5', '127.0.0.1', '100.64.3.3']) assert.equal(reachable.some((l) => l.includes(bad)), false, bad + ' is not accepted before the drops')
  assert.ok(lines(text).some((l) => l.trim() === 'ip daddr 198.51.100.7 tcp dport { 80, 443 } accept'), 'a public allowed name is accepted')
})

test('the rules are written where KYBERNOS_EGRESS_RULES_FILE says, and that file is what nft is asked to load', () => {
  const m = machine({ hosts: NAMES })
  assert.equal(m.run('closed', ENV).status, 0)
  assert.equal(m.loadedPath(1), m.rulesFile)
  assert.equal(readFileSync(m.rulesFile, 'utf8'), m.loaded(1))
})

test('the platform\'s own address stays reachable even inside a private range (it is the one exception, by name)', () => {
  const m = machine({ hosts: { 'api.kybernos.example': ['fdaa:0:1::99', '10.1.2.3'] } })
  assert.equal(m.run('closed', { KYBERNOS_API: 'https://api.kybernos.example' }).status, 0)
  const text = m.loaded(1)
  const drop = firstIndex(text, (l) => l === PRIVATE_V4)
  for (const needle of ['ip6 daddr fdaa:0:1::99 tcp dport { 443 } accept', 'ip daddr 10.1.2.3 tcp dport { 443 } accept']) {
    const at = firstIndex(text, (l) => l.trim() === needle)
    assert.ok(at > 0 && at < drop, needle)
  }
})

test('the platform\'s port is the one of its address (http: 80, an explicit port: that one)', () => {
  const a = machine({ hosts: { 'api.kybernos.example': ['203.0.113.10'] } })
  assert.equal(a.run('closed', { KYBERNOS_API: 'http://api.kybernos.example' }).status, 0)
  assert.ok(lines(a.loaded(1)).includes('    ip daddr 203.0.113.10 tcp dport { 80 } accept'))
  const b = machine({ hosts: { 'api.kybernos.example': ['203.0.113.10'] } })
  assert.equal(b.run('closed', { KYBERNOS_API: 'https://api.kybernos.example:8443/v1' }).status, 0)
  assert.ok(lines(b.loaded(1)).includes('    ip daddr 203.0.113.10 tcp dport { 8443 } accept'))
})

test('the resolver is the machine\'s own: every nameserver of resolv.conf (an address only), else Fly\'s', () => {
  const m = machine({ hosts: NAMES, resolv: '# generated\nsearch internal\nnameserver fdaa::3\nnameserver   10.9.9.9   # the second\nnameserver fe80::1%eth0\nnameserver dns.example\n  nameserver 1.1.1.1\n;nameserver 6.6.6.6\n' })
  assert.equal(m.run('closed', ENV).status, 0)
  const dns = lines(m.loaded(1)).filter((l) => /dport 53/.test(l))
  assert.deepEqual(dns.sort(), [
    '    ip daddr 1.1.1.1 tcp dport 53 accept', '    ip daddr 1.1.1.1 udp dport 53 accept',
    '    ip daddr 10.9.9.9 tcp dport 53 accept', '    ip daddr 10.9.9.9 udp dport 53 accept',
    '    ip6 daddr fdaa::3 tcp dport 53 accept', '    ip6 daddr fdaa::3 udp dport 53 accept',
  ])
  for (const none of [null, '', '# nothing here\nsearch internal\n', 'nameserver dns.example\n']) {
    const bare = machine({ hosts: NAMES, resolv: none })
    assert.equal(bare.run('closed', ENV).status, 0)
    assert.deepEqual(lines(bare.loaded(1)).filter((l) => /dport 53/.test(l)), ['    ip6 daddr fdaa::3 udp dport 53 accept', '    ip6 daddr fdaa::3 tcp dport 53 accept'], 'no usable nameserver: Fly\'s own, ' + JSON.stringify(none))
  }
})

test('the resolver is read once, at the start: the minute\'s refresh does not read resolv.conf again', () => {
  // The refresh runs as root for the life of the machine, next to the agent's code. A resolv.conf that the agent managed to change after the start must not change the policy.
  const m = machine({ hosts: NAMES, sleeps: 'once' })
  writeFileSync(m.hook, `printf 'nameserver 203.0.113.66\\n' > "${m.resolvFile}"\n`)
  assert.equal(m.run('closed', ENV).status, 0)
  assert.equal(m.count(), 2, 'one load at the start, one at the minute')
  assert.equal(readFileSync(m.resolvFile, 'utf8'), 'nameserver 203.0.113.66\n', 'the file did change in between')
  assert.equal(m.loaded(2).includes('203.0.113.66'), false)
  assert.deepEqual(lines(m.loaded(2)).filter((l) => /dport 53/.test(l)), ['    ip6 daddr fdaa::3 udp dport 53 accept', '    ip6 daddr fdaa::3 tcp dport 53 accept'])
})

test('fail closed: a policy that cannot be loaded stops the start; so does a machine with no nft', () => {
  const broken = machine({ hosts: NAMES, nftExit: 1 })
  const r = broken.run('closed', ENV)
  assert.equal(r.status, 1)
  assert.match(r.stdout, /the policy could not be applied: stopping rather than running without it/)
  // No `nft` at all: a PATH that is an empty folder (never the system's, where a real nft could load a real policy into the machine that runs this test).
  const bare = machine({ hosts: NAMES })
  const empty = join(bare.dir, 'empty')
  mkdirSync(empty)
  const out = spawnSync(SH, [script], { env: { PATH: empty, KYBERNOS_EGRESS_MODE: 'closed', KYBERNOS_RESOLV_CONF: bare.resolvFile, KYBERNOS_EGRESS_RULES_FILE: bare.rulesFile }, encoding: 'utf8' })
  assert.equal(out.status, 1)
  assert.match(out.stdout, /nft is missing: cannot hold mode closed/)
  assert.equal(bare.count(), 0)
})

test('what was already true stays: no mode given, a guard turned off, an unknown mode', () => {
  const none = machine({ hosts: NAMES })
  const a = spawnSync(SH, [script], { env: { PATH: none.dir, KYBERNOS_RESOLV_CONF: none.resolvFile }, encoding: 'utf8' })
  assert.equal(a.status, 0)
  assert.match(a.stdout, /no policy was given: none applied/)
  const off = none.run('closed', { KYBERNOS_EGRESS_GUARD: 'off' })
  assert.equal(off.status, 0)
  assert.match(off.stdout, /NOT held/)
  assert.equal(none.count(), 0, 'nothing was loaded in either case')
  const odd = none.run('open', {})
  assert.equal(odd.status, 1)
  assert.match(odd.stdout, /unknown mode 'open'/)
})
