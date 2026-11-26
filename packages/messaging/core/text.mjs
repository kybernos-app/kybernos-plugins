// Text utilities: message splitting and outgoing file markers.

import path from 'node:path';

/** Telegram limit for sendMessage/editMessageText. */
export const TELEGRAM_TEXT_LIMIT = 4096;

/**
 * Splits a text into chunks <= limit, preferring natural boundaries
 * (paragraphs, lines, spaces) and closing the open code blocks so the
 * rendering does not break.
 */
export function splitMessage(text, limit = TELEGRAM_TEXT_LIMIT) {
  const value = String(text ?? '');
  if (!value) return [];
  if (value.length <= limit) return [value];

  const chunks = [];
  let rest = value;
  let openFence = false;

  while (rest.length > limit) {
    // Smaller budget when a code block is open: it will have to be closed.
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

    // Counts the ``` fences in this chunk to know whether a block is left open.
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
 * Extracts the [[send-file:/path]] markers from an answer and returns the cleaned
 * text + the list of paths. A relative path is resolved against cwd.
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

/** Short summary of an error for a chat message. */
export function shortError(err, max = 300) {
  const msg = err && err.message ? err.message : String(err);
  return msg.length > max ? `${msg.slice(0, max)}…` : msg;
}

/** Cleans a file name received from a platform (no path traversal). */
export function safeFileName(name, fallback = 'file') {
  const base = String(name || '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    .replace(/[\u0000-\u001f]/g, '')
    .trim();
  return base || fallback;
}
