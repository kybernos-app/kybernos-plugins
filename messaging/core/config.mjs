// Configuration du pont DSH ↔ messageries.
//
// Aucun secret n'est copié : le token reste dans le fichier .env existant
// (par défaut celui du projet Kybernos) et n'est lu qu'en mémoire.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function dshHome() {
  const fromEnv = process.env.DSH_HOME;
  return fromEnv && fromEnv.trim() ? fromEnv.trim() : path.join(os.homedir(), '.dsh');
}

export function bridgeHome() {
  return path.join(dshHome(), 'telegram-bridge');
}

export function defaultConfigPath() {
  return path.join(bridgeHome(), 'config.json');
}

/** Parse le sous-ensemble KEY=VALUE d'un fichier .env (commentaires et quotes simples gérés). */
export function parseEnvFile(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function readEnvFileIfAny(file) {
  if (!file) return null;
  try {
    return parseEnvFile(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function splitList(value) {
  return String(value || '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Résout la configuration effective.
 * Priorité du token : process.env > fichier .env.
 * Priorité du fichier .env : --env-file > TELEGRAM_ENV_FILE > config.json > défaut Kybernos.
 */
export function loadConfig({ configPath = defaultConfigPath(), env = process.env, envFile: envFileArg = null } = {}) {
  const notes = [];
  let fileConfig = {};
  let configFileErrorValue = null;
  try {
    fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') configFileErrorValue = `${configPath}: ${err.message}`;
  }
  const envFile = envFileArg || env.TELEGRAM_ENV_FILE || fileConfig.envFile || null;
  const fileEnv = readEnvFileIfAny(envFile);
  if (envFile && !fileEnv) notes.push(`fichier .env illisible ou absent: ${envFile}`);

  const token = env.TELEGRAM_BOT_TOKEN || (fileEnv && fileEnv.TELEGRAM_BOT_TOKEN) || null;
  const defaultChat = env.TELEGRAM_CHAT_ID || (fileEnv && fileEnv.TELEGRAM_CHAT_ID) || null;

  const allowed = new Set(splitList(env.TELEGRAM_ALLOWED_CHATS || (fileEnv && fileEnv.TELEGRAM_ALLOWED_CHATS)));
  if (defaultChat) allowed.add(String(defaultChat));
  for (const id of splitList(fileConfig.allowedChats)) allowed.add(String(id));

  return {
    configPath,
    configFileFound: Object.keys(fileConfig).length > 0,
    configFileError: configFileErrorValue,
    notes,
    envFile,
    envFileFound: Boolean(fileEnv),
    token,
    defaultChat: defaultChat ? String(defaultChat) : null,
    allowedChats: allowed,
    allowAll: env.TELEGRAM_ALLOW_ALL === '1' || fileConfig.allowAll === true,
    statePath: env.TELEGRAM_BRIDGE_STATE || fileConfig.statePath || path.join(bridgeHome(), 'state.json'),
    workspaceRoot: env.TELEGRAM_BRIDGE_WORKSPACES || fileConfig.workspaceRoot || path.join(bridgeHome(), 'workspaces'),
    dshBin: env.TELEGRAM_DSH_BIN || fileConfig.dshBin || process.env.DSH_BIN || 'dsh',
    dshProfile: env.TELEGRAM_DSH_PROFILE || fileConfig.dshProfile || 'headless',
    dshArgs: Array.isArray(fileConfig.dshArgs) ? fileConfig.dshArgs : [],
    timeoutMs: Number(env.TELEGRAM_TIMEOUT_MS || fileConfig.timeoutMs || 15 * 60 * 1000),
    minEditIntervalMs: Number(fileConfig.minEditIntervalMs || 1100),
    maxQueuePerChat: Number(fileConfig.maxQueuePerChat || 5),
  };
}

export function describeConfig(cfg) {
  return {
    envFile: cfg.envFile,
    envFileFound: cfg.envFileFound,
    token: cfg.token ? `présent (${String(cfg.token).length} caractères)` : 'ABSENT',
    defaultChat: cfg.defaultChat ? 'défini' : 'absent',
    allowedChats: cfg.allowedChats.size,
    allowAll: cfg.allowAll,
    statePath: cfg.statePath,
    workspaceRoot: cfg.workspaceRoot,
    dsh: `${cfg.dshBin} --profile ${cfg.dshProfile}`,
    timeoutMs: cfg.timeoutMs,
  };
}
