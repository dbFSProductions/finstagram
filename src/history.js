// Remembers which posts have already been handed out, so the next build can
// replace all of them instead of showing the same forty again.
// Stored as { served: { [postId]: isoTimeFirstServed } }.

import fs from 'node:fs/promises';
import path from 'node:path';

const KEEP_DAYS = 60;     // long past maxAgeDays, so an old post never sneaks back in
const MAX_ENTRIES = 5000;

export async function loadHistory(file) {
  try {
    const h = JSON.parse(await fs.readFile(file, 'utf8'));
    if (h && typeof h.served === 'object' && h.served) return h;
  } catch { /* first run, or unreadable: start clean */ }
  return { served: {} };
}

export function excludeSet(history) {
  return new Set(Object.keys(history?.served || {}));
}

export function recordServed(history, feed, now = Date.now()) {
  const stamp = new Date(now).toISOString();
  for (const p of feed.posts) {
    if (p.kind === 'card' || !p.id) continue;
    if (!history.served[p.id]) history.served[p.id] = stamp;
  }
  // Prune: drop anything older than KEEP_DAYS, then cap by dropping the oldest.
  const cutoff = now - KEEP_DAYS * 864e5;
  let entries = Object.entries(history.served).filter(([, t]) => Date.parse(t) >= cutoff);
  if (entries.length > MAX_ENTRIES) entries = entries.sort((a, b) => Date.parse(b[1]) - Date.parse(a[1])).slice(0, MAX_ENTRIES);
  history.served = Object.fromEntries(entries);
  return history;
}

export async function saveHistory(file, history) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(history));
}
