// Utilitaires de texte : découpage des messages et marqueurs de fichiers sortants.

import path from 'node:path';

/** Limite Telegram pour sendMessage/editMessageText. */
export const TELEGRAM_TEXT_LIMIT = 4096;

/**
 * Découpe un texte en morceaux <= limit, en privilégiant les frontières
 * naturelles (paragraphes, lignes, espaces) et en refermant les blocs de code
 * ouverts pour ne pas casser le rendu.
 */
export function splitMessage(text, limit = TELEGRAM_TEXT_LIMIT) {
  const value = String(text ?? '');
  if (!value) return [];
  if (value.length <= limit) return [value];

  const chunks = [];
  let rest = value;
  const fence = /^\s*```/;
  let openFence = false;

  while (rest.length > limit) {
    // Budget réduit si un bloc de code est ouvert : il faudra le refermer.
    const budget = openFence ? limit - 4 : limit;
    let cut = -1;
    for (const pattern of [/\n\n/g, /\n/g, / /g]) {
      pattern.lastIndex = 0;
      let match;
      let last = -1;
      while ((match = pattern.exec(rest)) !== null) {
        if (match.index <= budget) last = match.index;
        else break;
      }
      if (last > limit * 0.3) {
        cut = last;
        break;
      }
    }
    if (cut < 0) cut = budget;

    let head = rest.slice(0, cut).replace(/\s+$/, '');
    rest = rest.slice(cut).replace(/^\s+/, '');

    // Compte les clôtures ``` dans ce morceau pour savoir si on laisse un bloc ouvert.
    const fences = (head.match(/```/g) || []).length;
    if (fences % 2 === 1) {
      head += '\n```';
      openFence = true;
      rest = '```\n' + rest;
    } else {
      openFence = false;
    }
    chunks.push(head);
  }
  if (rest) chunks.push(rest);
  return chunks;
}

const MARKER = /\[\[\s*send-file\s*:\s*([^\]]+?)\s*\]\]/gi;

/**
 * Extrait les marqueurs [[send-file:/chemin]] d'une réponse et renvoie le texte
 * nettoyé + la liste des chemins. Un chemin relatif est résolu contre cwd.
 */
export function extractFileMarkers(text, cwd = process.cwd()) {
  const value = String(text ?? '');
  const files = [];
  const cleaned = value
    .replace(MARKER, (_, raw) => {
      const p = String(raw).trim().replace(/^["']|["']$/g, '');
      if (p) files.push(p);
      return '';
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text: cleaned, files: files.map((p) => (path.isAbsolute(p) ? p : path.resolve(cwd, p))) };
}

/** Résumé court d'une erreur pour un message de chat. */
export function shortError(err, max = 300) {
  const msg = err && err.message ? err.message : String(err);
  return msg.length > max ? `${msg.slice(0, max)}…` : msg;
}

/** Nettoie un nom de fichier reçu d'une plateforme (anti-traversée). */
export function safeFileName(name, fallback = 'fichier') {
  const base = String(name || '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    .replace(/[\u0000-\u001f]/g, '')
    .trim();
  return base || fallback;
}
