// What a cloud computer's turn gate lets through without a question, beyond the fixed list of read tools (index.js, TURN_GATE_SAFE_TOOLS).
//
// A shell command that only SHOWS names and numbers: `ls -la /home/node`, `df -h`, `date`. Asking the person to tap for each of those made a short task (« what is in my workspace? »)
// a string of taps (measured on the dev server, 2026-11-20, through the MCP door: the user stopped the test, « we cannot go on validating each time »). The rule is deliberately small and
// closed, because the question is the last line of defence against an instruction planted in a page that an outside assistant relays:
//   - simple commands only: no pipe, no `&` alone, no redirection, no substitution, no quote, no variable, no glob, no newline. Any character outside a short alphabet means « ask ».
//     Several of them may be chained with `;` or `&&` (`ls -la ~; df -h`: models write one line, not five) when EACH one passes on its own; a section title `echo "=== Disk ==="` (a quoted plain
//     literal, nothing to expand) is one too. A chain with one command outside the list is asked as a whole.
//   - the command is in a short list and each of its flags is a short letter flag (`-la`, `-h`); no long flags, no flag that takes a value, none that changes the machine (`date -s`).
//   - `sleep N` (N a whole number up to 120) is the one way a turn waits for the sub-agents it started.
//   - none of them reads the CONTENT of a file (no `cat`, `head`, `grep`, `find`: `read`, `grep` and `glob` are already tools that pass, and `find -exec` runs anything).
// Pure: no I/O. A turn an entrance filter found suspect (`strict`) never uses this: the gate asks for every call there.

const MAX_LENGTH = 300
const MAX_CHAIN = 6
// `echo "=== Disk ==="`: the text between quotes is letters, digits, spaces and a few marks; no `$`, backtick, backslash or `!`, so nothing is expanded, and there is no flag and no redirection.
const ECHO_LITERAL = /^echo (?:"[A-Za-z0-9 =:.,_/+-]{0,80}"|'[A-Za-z0-9 =:.,_/+-]{0,80}')$/
// Letters, digits and the few punctuation marks of a path; one leading `~` for the home folder. Spaces separate the words.
const ALPHABET = /^[ A-Za-z0-9_./@%+,:=~-]+$/
const PATH_WORD = /^~?[A-Za-z0-9_./@%+,:=-]*$/
const SHORT_FLAGS = /^-[A-Za-z0-9]{1,12}$/

/** The commands, with what each may be given. `paths`: names of files or folders may follow. `flags`: a test on the flag's letters (all short flags pass it or the call is asked). */
const COMMANDS = Object.freeze({
  ls: { paths: true, flags: () => true },
  pwd: { paths: false, flags: () => true },
  whoami: { paths: false, flags: () => true },
  uname: { paths: false, flags: () => true },
  uptime: { paths: false, flags: () => true },
  nproc: { paths: false, flags: () => true },
  free: { paths: false, flags: () => true },
  df: { paths: true, flags: () => true },
  du: { paths: true, flags: () => true },
  stat: { paths: true, flags: () => true },
  file: { paths: true, flags: () => true },
  id: { paths: false, flags: () => true },
  // `date -s` sets the clock; only the display flags are known to be harmless, and a `+format` word is allowed.
  date: { paths: false, flags: (f) => f === '-u' || f === '-I' || f === '-R', format: true },
  // `hostname name` renames the machine: no word at all.
  hostname: { paths: false, flags: () => false },
  // Waiting for a sub-agent the turn started (measured through the MCP door, 2026-11-20: `sleep 45; echo waited`): one whole number of seconds, nothing else. It changes nothing, and a turn is time-limited anyway.
  sleep: { paths: false, flags: () => false, seconds: true }
})
const MAX_SLEEP_SECONDS = 120

/** True when `command` is made only of the closed read-only shell commands above, alone or chained with `;` or `&&`. Anything else, however harmless it looks, is false: a false is only a question. */
export function shellIsReadOnly (command) {
  if (typeof command !== 'string' || command.length === 0 || command.length > MAX_LENGTH) return false
  // The cut is made on `;` and `&&` first: a quote that holds one of them splits the literal and fails below (asked), never the other way round.
  const parts = command.split(/;|&&/)
  if (parts.length > MAX_CHAIN) return false
  return parts.every((part) => simpleCommandIsReadOnly(part.trim()))
}

function simpleCommandIsReadOnly (command) {
  if (ECHO_LITERAL.test(command)) return true
  if (command.length === 0 || !ALPHABET.test(command)) return false
  const words = command.split(' ').filter((w) => w !== '')
  if (words.length === 0) return false
  const rule = Object.prototype.hasOwnProperty.call(COMMANDS, words[0]) ? COMMANDS[words[0]] : null
  if (rule === null) return false
  let formats = 0
  for (const word of words.slice(1)) {
    if (word.startsWith('-')) {
      if (!SHORT_FLAGS.test(word) || !rule.flags(word)) return false
    } else if (word.startsWith('+') && rule.format === true) {
      formats += 1
      if (formats > 1 || !/^\+[%A-Za-z0-9:_.,-]{1,40}$/.test(word)) return false
    } else if (rule.seconds === true) {
      if (words.length !== 2 || !/^[0-9]{1,3}$/.test(word) || Number(word) > MAX_SLEEP_SECONDS) return false
    } else if (!rule.paths || !PATH_WORD.test(word)) {
      return false
    }
  }
  // `sleep` alone is an error of the shell, not a wait: a question like any other doubt.
  if (rule.seconds === true && words.length !== 2) return false
  return true
}
