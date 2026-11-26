// ═══════════════════════════════════════════════════════════════════════════
// kybernos-guard — Pass 1 deterministic security rules (pure, linear-time).
//
// Zero LLM calls, < 2 ms per tool call, zero nested quantifiers (ReDoS-safe):
//   1. Secret leak detection & masking (API keys, tokens, private keys);
//   2. Destructive / exfiltration shell command classification (block / ask);
//   3. Self-protection & sensitive system write guard;
//   4. Prompt-injection detection in untrusted external tool outputs.
//
// Never returns raw secret values in match objects or audit records.
// ═══════════════════════════════════════════════════════════════════════════

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const str = (v) => (typeof v === 'string' ? v : '')

export const MAX_SCAN_CHARS = 128 * 1024

export const SHELL_TOOLS = new Set(['bash', 'pwsh', 'terminal_send'])
export const FILE_WRITE_TOOLS = new Set([
  'write', 'write_file', 'file_write',
  'edit', 'edit_file', 'file_edit',
  'multi_edit', 'multiedit',
  'str_replace', 'str_replace_editor',
  'apply_patch', 'delete_file', 'remove_file'
])
export const OUTBOUND_TOOLS = new Set([
  'web_fetch', 'fetch', 'http_request', 'connections_execute',
  'send_email', 'email_send', 'send_message', 'slack_post', 'telegram_send'
])
export const UNTRUSTED_OUTPUT_TOOLS = new Set([
  'web_fetch', 'web_search', 'websearch', 'search_web', 'fetch',
  'connections_execute', 'browser_navigate', 'browser_read', 'browser_extract'
])

export const isOutboundTool = (name) => {
  const n = str(name).toLowerCase()
  return OUTBOUND_TOOLS.has(n) || n.startsWith('mcp__') || n.startsWith('http_') || n.startsWith('browser_')
}

export const isBrowserTool = (name) => {
  const n = str(name).toLowerCase()
  return (
    n.startsWith('mcp__playwright-mcp__') ||
    n.startsWith('mcp__chrome-devtools') ||
    n.startsWith('mcp__browser') ||
    n.startsWith('browser_') ||
    n.startsWith('playwright_')
  )
}

export const isUntrustedOutputTool = (name) => {
  const n = str(name).toLowerCase()
  return UNTRUSTED_OUTPUT_TOOLS.has(n) || n.startsWith('mcp__') || isBrowserTool(n)
}

// ── 1. Secret patterns (linear-time, bounded) ───────────────────────────────
export const SECRET_RULES = [
  { id: 'secret-private-key', label: 'private key block', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { id: 'secret-aws-key', label: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'secret-github-token', label: 'GitHub token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/ },
  { id: 'secret-anthropic-key', label: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { id: 'secret-openai-key', label: 'OpenAI/provider API key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/ },
  { id: 'secret-stripe-live', label: 'Stripe live key', re: /\b(?:sk|rk)_live_[0-9A-Za-z]{20,}\b/ },
  { id: 'secret-google-key', label: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: 'secret-slack-token', label: 'Slack token', re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/ },
  { id: 'secret-hf-token', label: 'HuggingFace token', re: /\bhf_[A-Za-z0-9]{25,}\b/ }
]

const clampScan = (text) => {
  const s = str(text)
  return s.length > MAX_SCAN_CHARS ? s.slice(0, MAX_SCAN_CHARS) : s
}

/** Scans text for high-confidence secrets. Returns matching rule metadata (never the secret itself). */
export function scanSecrets (text) {
  const hay = clampScan(text)
  if (hay === '') return []
  const hits = []
  for (const rule of SECRET_RULES) {
    if (rule.re.test(hay)) hits.push({ ruleId: rule.id, kind: 'secret', label: rule.label })
  }
  return hits
}

/** Redacts all matched secret literals from text for safe logging. */
export function maskSecrets (text) {
  let out = str(text)
  for (const rule of SECRET_RULES) {
    const g = new RegExp(rule.re.source, 'g')
    out = out.replace(g, '[REDACTED:' + rule.id + ']')
  }
  return out
}

// ── 2. Destructive & exfiltration shell rules ───────────────────────────────
const NETWORK_CMD_RE = /\b(?:curl|wget|nc|ncat|netcat|scp|rsync|sftp|ftp|telnet|socat)\b/i
const SENSITIVE_FILE_RE = /(?:^|[\s"'=:@])(?:~\/\.ssh\/|\/\.ssh\/|\$HOME\/\.ssh\/|~\/\.aws\/credentials|~\/\.netrc|~\/\.npmrc|\bid_rsa\b|\bid_ed25519\b|\.env(?:\.[a-z0-9_-]+)?(?=$|[\s"'|;&]))/i

export const COMMAND_RULES = [
  // Hard blocks (catastrophic or covert exfiltration)
  {
    id: 'cmd-rm-root-home',
    action: 'block',
    kind: 'destructive',
    re: /\brm\s+(?:-[A-Za-z]*[rf][A-Za-z]*\s+){1,3}(?:\/(?:\*|\s|$)|~(?:\/|\s|$)|\$HOME(?:\/|\s|$)|\/Users\/?\s|\/home\/?\s)/,
    reason: {
      en: 'Blocked destructive removal targeting root or home directory.',
      fr: 'Suppression destructrice visant la racine ou le dossier personnel bloquée.'
    }
  },
  {
    id: 'cmd-disk-wipe',
    action: 'block',
    kind: 'destructive',
    re: /\b(?:mkfs(?:\.[a-z0-9]+)?|wipefs|diskutil\s+eraseDisk|dd\s+[^\n]*\bof=\/dev\/)/i,
    reason: {
      en: 'Blocked raw disk or partition wipe command.',
      fr: 'Commande d’effacement de disque ou de partition bloquée.'
    }
  },
  {
    id: 'cmd-pipe-to-shell',
    action: 'block',
    kind: 'exfiltration',
    re: /\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh|dash|ksh)\b/i,
    reason: {
      en: 'Blocked remote script piped directly into a shell.',
      fr: 'Exécution directe d’un script distant envoyé dans un shell bloquée.'
    }
  },
  {
    id: 'cmd-fork-bomb',
    action: 'block',
    kind: 'destructive',
    re: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
    reason: {
      en: 'Blocked shell fork bomb pattern.',
      fr: 'Motif de fork bomb shell bloqué.'
    }
  },
  {
    id: 'cmd-chmod-root',
    action: 'block',
    kind: 'destructive',
    re: /\bchmod\s+(?:-R\s+)?777\s+(?:\/(?:\s|$)|~\/\.ssh)/,
    reason: {
      en: 'Blocked unsafe world-writable permissions on root or SSH directory.',
      fr: 'Permissions 777 dangereuses sur la racine ou ~/.ssh bloquées.'
    }
  },
  {
    id: 'cmd-self-tamper',
    action: 'block',
    kind: 'self-protection',
    re: /kybernos\/guard\/(?:settings|events)\./i,
    reason: {
      en: 'Blocked modification of kybernos-guard configuration or audit log.',
      fr: 'Modification de la configuration ou du journal de kybernos-guard bloquée.'
    }
  },

  // Human confirmation gates (irreversible or high-blast-radius)
  {
    id: 'cmd-git-force-push',
    action: 'ask',
    kind: 'destructive',
    re: /\bgit\s+(?:-[A-Za-z]\s+\S+\s+)*push\b[^\n]*(?:--force(?:-with-lease)?|\s-f(?:\s|$))/,
    reason: {
      en: 'Force-pushing git history requires confirmation.',
      fr: 'Forcer l’envoi de l’historique git demande confirmation.'
    }
  },
  {
    id: 'cmd-git-reset-hard',
    action: 'ask',
    kind: 'destructive',
    re: /\bgit\s+(?:-[A-Za-z]\s+\S+\s+)*(?:reset\s+--hard|clean\s+-[A-Za-z]*f[A-Za-z]*d|clean\s+-[A-Za-z]*d[A-Za-z]*f)/,
    reason: {
      en: 'Discarding uncommitted work with git reset --hard / git clean requires confirmation.',
      fr: 'Effacer le travail non committé avec git reset --hard / git clean demande confirmation.'
    }
  },
  {
    id: 'cmd-sql-destructive',
    action: 'ask',
    kind: 'destructive',
    re: /\b(?:DROP\s+(?:TABLE|DATABASE|SCHEMA)|TRUNCATE\s+TABLE)\b/i,
    reason: {
      en: 'Destructive SQL statement (DROP/TRUNCATE) requires confirmation.',
      fr: 'Requête SQL destructrice (DROP/TRUNCATE) soumise à confirmation.'
    }
  },
  {
    id: 'cmd-sudo',
    action: 'ask',
    kind: 'destructive',
    re: /(?:^|[;&|]\s*)sudo\s+/,
    reason: {
      en: 'Elevated command (sudo) requires confirmation.',
      fr: 'Commande avec droits administrateur (sudo) soumise à confirmation.'
    }
  },
  {
    id: 'cmd-rm-rf',
    action: 'ask',
    kind: 'destructive',
    re: /\brm\s+-[A-Za-z]*(?:r[A-Za-z]*f|f[A-Za-z]*r)[A-Za-z]*\s+/,
    reason: {
      en: 'Recursive forced deletion (rm -rf) requires confirmation.',
      fr: 'Suppression récursive forcée (rm -rf) soumise à confirmation.'
    }
  }
]

/** Classifies a shell command into block / ask / allow. Pure function. */
export function scanCommand (command, { blockSecrets = true } = {}) {
  const cmd = clampScan(command)
  if (cmd.trim() === '') return { action: 'allow', ruleId: null, kind: null, reason: null }

  // Secret exfiltration via network command -> hard block
  if (blockSecrets && NETWORK_CMD_RE.test(cmd)) {
    const secrets = scanSecrets(cmd)
    if (secrets.length > 0) {
      return {
        action: 'block',
        ruleId: 'cmd-secret-exfil',
        kind: 'secret',
        reason: {
          en: 'Blocked outbound shell command containing a secret (' + secrets[0].label + ').',
          fr: 'Commande réseau contenant un secret bloquée : ' + secrets[0].label
        }
      }
    }
    if (SENSITIVE_FILE_RE.test(cmd)) {
      return {
        action: 'block',
        ruleId: 'cmd-sensitive-file-exfil',
        kind: 'exfiltration',
        reason: {
          en: 'Blocked outbound shell command referencing sensitive credentials or SSH keys.',
          fr: 'Commande réseau référençant des identifiants sensibles ou clés SSH bloquée.'
        }
      }
    }
  }

  for (const rule of COMMAND_RULES) {
    if (rule.re.test(cmd)) {
      return { action: rule.action, ruleId: rule.id, kind: rule.kind, reason: rule.reason }
    }
  }
  return { action: 'allow', ruleId: null, kind: null, reason: null }
}

// ── 3. Protected write paths (self-protection & sensitive OS locations) ─────
const PROTECTED_WRITE_PATTERNS = [
  { id: 'write-guard-config', re: /(?:^|[\\/])kybernos[\\/]guard[\\/]/i, label: 'kybernos-guard config' },
  { id: 'write-ssh-dir', re: /(?:^~|[\\/])\.ssh(?:[\\/]|$)/, label: '~/.ssh directory' },
  { id: 'write-system-etc', re: /^\/(?:etc|System|usr\/bin|usr\/sbin)\//, label: 'system directory' }
]

const extractWritePaths = (name, args) => {
  const a = isObj(args) ? args : {}
  const out = []
  if (name === 'apply_patch') {
    for (const m of str(a.input ?? a.patch).matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)) {
      const p = m[1].trim()
      if (p !== '') out.push(p)
    }
    return out
  }
  if (name === 'str_replace_editor' && str(a.command) === 'view') return out
  for (const k of ['file_path', 'path', 'target_file', 'Path']) {
    const v = str(a[k]).trim()
    if (v !== '') out.push(v)
  }
  if (Array.isArray(a.edits)) {
    for (const e of a.edits) {
      if (isObj(e)) {
        const v = str(e.file_path ?? e.path).trim()
        if (v !== '') out.push(v)
      }
    }
  }
  return out
}

// ── 4. Prompt-injection detection on untrusted external tool outputs ────────
export const INJECTION_RULES = [
  { id: 'inj-ignore-instructions', re: /\b(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|prior|above|system)\s+(?:instructions|prompts|rules|directives)\b/i },
  { id: 'inj-role-override', re: /\byou\s+are\s+now\s+(?:in\s+)?(?:developer|dan|jailbreak|unrestricted|admin)\s+mode\b/i },
  { id: 'inj-system-spoof', re: /(?:<system-reminder>|<\|im_start\|>\s*system|###\s*SYSTEM\s+INSTRUCTION\b|\[SYSTEM\s+OVERRIDE\])/i },
  { id: 'inj-exfil-directive', re: /\b(?:reveal|print|dump|send|exfiltrate|upload)\s+(?:your\s+|the\s+(?:contents?\s+of\s+)?)?(?:system\s+prompt|api\s+keys?|secret\s+tokens?|credentials|\.env\b|~\/\.ssh\b)/i },
  { id: 'inj-hidden-exec', re: /\b(?:immediately\s+execute|run\s+this\s+shell\s+command\s+without\s+asking|silently\s+run)\b/i }
]

/** Scans untrusted external content for prompt-injection markers. Pure function. */
export function scanPromptInjection (text) {
  const hay = clampScan(text)
  if (hay === '') return []
  const hits = []
  for (const rule of INJECTION_RULES) {
    if (rule.re.test(hay)) hits.push({ ruleId: rule.id, kind: 'injection' })
  }
  return hits
}

// ── 4b. Browser MCP action guard (domain allowlist, sensitive actions, JS exfil) ─
const DOMAIN_PATTERN_RE = /^(?:\*\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/
const UNSAFE_BROWSER_SCHEME_RE = /^\s*(?:file|chrome|chrome-extension|edge|about|javascript|vbscript|data):/i
const BROWSER_NAV_ACTION_RE = /(?:navigate|goto|open_url|new_page|open_page|visit)$/i
const BROWSER_EVAL_ACTION_RE = /(?:evaluate|evaluate_script|run_code|execute_script|eval)$/i
const BROWSER_INTERACT_ACTION_RE = /(?:click|submit|fill_form|press_key|type|fill|select_option)$/i
const BROWSER_COOKIE_STORAGE_RE = /\b(?:document\.cookie|localStorage|sessionStorage|indexedDB)\b/i
const BROWSER_JS_EXFIL_RE = /\b(?:fetch|XMLHttpRequest|sendBeacon|WebSocket|new\s+Image)\b/i
const BROWSER_SENSITIVE_ACTION_RE = /\b(?:checkout|pay|payment|payer|paiement|billing|facturation|stripe\.com|paypal\.com|delete|remove|supprimer|effacer|confirm(?:er)?\s+(?:order|payment|transfer|delete)|commander|virement|wire\s+transfer|publish|publier|submit|soumettre|send\s+(?:email|message|money)|envoyer)\b/i

export function normaliseDomainPattern (raw) {
  const s = str(raw).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '')
  if (s === '' || s.length > 120) return null
  return DOMAIN_PATTERN_RE.test(s) ? s : null
}

/** True when hostname matches an exact domain or wildcard (*.example.com). */
export function matchDomain (hostname, pattern) {
  const host = str(hostname).trim().toLowerCase()
  const pat = normaliseDomainPattern(pattern)
  if (host === '' || pat === null) return false
  if (pat.startsWith('*.')) {
    const base = pat.slice(2)
    return host === base || host.endsWith('.' + base)
  }
  return host === pat
}

function extractBrowserUrls (args) {
  const a = isObj(args) ? args : {}
  const out = []
  for (const k of ['url', 'href', 'target', 'pageUrl', 'startUrl']) {
    const v = str(a[k]).trim()
    if (v !== '') out.push(v)
  }
  return out
}

/** Evaluates a browser MCP tool call (Playwright / Chrome DevTools). Pure function. */
export function evaluateBrowserAction (toolName, args, policy = DEFAULT_POLICY) {
  const name = str(toolName).trim()
  if (!isBrowserTool(name)) return { action: 'allow', ruleId: null, kind: null, reason: null }
  const a = isObj(args) ? args : {}
  const shortName = name.includes('__') ? name.slice(name.lastIndexOf('__') + 2) : name
  const urls = extractBrowserUrls(a)

  // 1. Hard-block unsafe browser schemes (file://, chrome://, javascript:, data:)
  for (const u of urls) {
    if (UNSAFE_BROWSER_SCHEME_RE.test(u)) {
      return {
        action: 'block',
        ruleId: 'browser-unsafe-scheme',
        kind: 'browser',
        reason: {
          en: 'Blocked browser navigation to a restricted scheme (file/chrome/javascript/data).',
          fr: 'Navigation navigateur vers un schéma restreint (file/chrome/javascript/data) bloquée.'
        }
      }
    }
  }

  // 2. Domain allowlist (enforced when non-empty)
  const allowList = Array.isArray(policy.browserAllowedDomains) ? policy.browserAllowedDomains : []
  if (allowList.length > 0 && (urls.length > 0 || BROWSER_NAV_ACTION_RE.test(shortName))) {
    for (const u of urls) {
      let host = ''
      try { host = new URL(u).hostname.toLowerCase() } catch { host = '' }
      if (host !== '' && !allowList.some((pat) => matchDomain(host, pat))) {
        return {
          action: 'block',
          ruleId: 'browser-domain-not-allowed',
          kind: 'browser',
          reason: {
            en: 'Blocked browser navigation outside allowed domains: ' + host,
            fr: 'Navigation navigateur hors des domaines autorisés bloquée : ' + host
          }
        }
      }
    }
  }

  // 3. Script evaluation in authenticated pages: block cookie/storage exfil, ask on other JS eval
  if (BROWSER_EVAL_ACTION_RE.test(shortName)) {
    const code = clampScan(str(a.function ?? a.expression ?? a.script ?? a.code ?? JSON.stringify(a)))
    if (BROWSER_COOKIE_STORAGE_RE.test(code) && BROWSER_JS_EXFIL_RE.test(code)) {
      return {
        action: 'block',
        ruleId: 'browser-cookie-exfil',
        kind: 'secret',
        reason: {
          en: 'Blocked browser script combining cookie/storage access with outbound network calls.',
          fr: 'Script navigateur combinant lecture de cookies/stockage et envoi réseau bloqué.'
        }
      }
    }
    return {
      action: 'ask',
      ruleId: 'browser-eval-script',
      kind: 'browser',
      reason: {
        en: 'Running custom JavaScript inside an authenticated browser page requires confirmation.',
        fr: 'Exécuter du JavaScript personnalisé dans une page authentifiée demande confirmation.'
      }
    }
  }

  // 4. Sensitive browser actions (payment, checkout, submit, delete, publish) -> mandatory confirmation
  if (BROWSER_INTERACT_ACTION_RE.test(shortName)) {
    const hint = clampScan([
      shortName,
      str(a.element), str(a.selector), str(a.label), str(a.text), str(a.ref), str(a.name),
      ...urls
    ].join(' '))
    if (/^(?:submit|fill_form)$/i.test(shortName) || BROWSER_SENSITIVE_ACTION_RE.test(hint)) {
      return {
        action: 'ask',
        ruleId: 'browser-sensitive-action',
        kind: 'browser',
        reason: {
          en: 'Sensitive browser action (form submit, payment, deletion, or publish) requires confirmation.',
          fr: 'Action navigateur sensible (envoi de formulaire, paiement, suppression ou publication) soumise à confirmation.'
        }
      }
    }
  }

  return { action: 'allow', ruleId: null, kind: null, reason: null }
}

// ── 5. Unified pre-execute evaluator ────────────────────────────────────────
export const DEFAULT_POLICY = Object.freeze({
  mode: 'enforce', // 'enforce' | 'audit' | 'off'
  blockSecrets: true,
  guardCommands: true,
  detectInjection: true,
  guardBrowser: true,
  browserAllowedDomains: [],
  allowRules: []
})

export function normalisePolicy (raw) {
  const o = isObj(raw) ? raw : {}
  const mode = o.mode === 'audit' || o.mode === 'off' ? o.mode : 'enforce'
  const allowRules = Array.isArray(o.allowRules)
    ? [...new Set(o.allowRules.filter((r) => typeof r === 'string' && /^[a-z0-9-]{2,48}$/.test(r)))].slice(0, 64)
    : []
  const browserAllowedDomains = Array.isArray(o.browserAllowedDomains)
    ? [...new Set(o.browserAllowedDomains.map(normaliseDomainPattern).filter(Boolean))].slice(0, 64)
    : []
  return {
    mode,
    blockSecrets: o.blockSecrets !== false,
    guardCommands: o.guardCommands !== false,
    detectInjection: o.detectInjection !== false,
    guardBrowser: o.guardBrowser !== false,
    browserAllowedDomains,
    allowRules
  }
}

/**
 * Evaluates a pending tool call before execution (`tools/pre-execute`).
 * Returns `{ action: 'allow'|'ask'|'block', ruleId, kind, reason }`.
 */
export function evaluatePreExecute (exec, policy = DEFAULT_POLICY) {
  const pol = normalisePolicy(policy)
  if (pol.mode === 'off' || !isObj(exec)) return { action: 'allow', ruleId: null, kind: null, reason: null }

  const name = str(exec.name).trim()
  const args = isObj(exec.arguments) ? exec.arguments : {}
  const allowed = new Set(pol.allowRules)

  // 1. Protected file writes (always enforced, cannot be silenced for self-protection)
  if (FILE_WRITE_TOOLS.has(name)) {
    for (const p of extractWritePaths(name, args)) {
      for (const pat of PROTECTED_WRITE_PATTERNS) {
        if (pat.re.test(p)) {
          return {
            action: 'block',
            ruleId: pat.id,
            kind: pat.id === 'write-guard-config' ? 'self-protection' : 'destructive',
            reason: {
              en: 'Blocked write to protected location (' + pat.label + ').',
              fr: 'Écriture dans un emplacement protégé bloquée : ' + pat.label
            }
          }
        }
      }
    }
  }

  // 2. Shell commands
  if (pol.guardCommands && SHELL_TOOLS.has(name)) {
    const cmd = str(name === 'terminal_send' ? args.text : args.command)
    const verdict = scanCommand(cmd, { blockSecrets: pol.blockSecrets })
    if (verdict.action !== 'allow') {
      if (verdict.action === 'ask' && allowed.has(verdict.ruleId)) {
        return { action: 'allow', ruleId: null, kind: null, reason: null }
      }
      return verdict
    }
  }

  // 3. Outbound tools carrying raw secrets
  if (pol.blockSecrets && isOutboundTool(name)) {
    let serialized = ''
    try { serialized = JSON.stringify(args) } catch { serialized = '' }
    const secrets = scanSecrets(serialized)
    if (secrets.length > 0) {
      return {
        action: 'block',
        ruleId: 'outbound-' + secrets[0].ruleId,
        kind: 'secret',
        reason: {
          en: 'Blocked outbound tool call containing a secret (' + secrets[0].label + ').',
          fr: 'Appel sortant contenant un secret bloqué : ' + secrets[0].label
        }
      }
    }
  }

  // 4. Browser MCP gating (Playwright / Chrome DevTools)
  if (pol.guardBrowser && isBrowserTool(name)) {
    const verdict = evaluateBrowserAction(name, args, pol)
    if (verdict.action !== 'allow') {
      if (verdict.action === 'ask' && allowed.has(verdict.ruleId)) {
        return { action: 'allow', ruleId: null, kind: null, reason: null }
      }
      return verdict
    }
  }

  return { action: 'allow', ruleId: null, kind: null, reason: null }
}
