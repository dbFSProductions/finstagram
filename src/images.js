// Fills in a post's image from the article's Open Graph / Twitter card
// when the feed itself didn't carry one. Bounded, polite, best-effort.

const PAGE_TIMEOUT_MS = 8000;
const MAX_BYTES = 200 * 1024;
const CONCURRENCY = 6;
const SKIP_HOSTS = /(^|\.)(arxiv\.org|feedburner\.com|substack\.com)$/i;

const META_RE = /<meta\s+[^>]*?(?:property|name)\s*=\s*["'](og:image(?::secure_url)?|twitter:image(?::src)?)["'][^>]*>/gi;
const CONTENT_RE = /content\s*=\s*["']([^"']+)["']/i;

async function readHead(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; Finstagram/0.1; +personal feed reader)', accept: 'text/html,*/*;q=0.5' },
    signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    redirect: 'follow',
  });
  if (!res.ok || !/html/i.test(res.headers.get('content-type') || '')) return null;
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  while (total < MAX_BYTES) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  try { await reader.cancel(); } catch { /* ignore */ }
  return Buffer.concat(chunks).toString('utf8');
}

export function extractOgImage(html, baseUrl) {
  // Prefer og:image over twitter:image; first match of each wins.
  const found = {};
  for (const m of html.matchAll(META_RE)) {
    const key = m[1].toLowerCase().startsWith('og:') ? 'og' : 'tw';
    if (found[key]) continue;
    const c = m[0].match(CONTENT_RE);
    if (c) found[key] = c[1];
  }
  const raw = found.og || found.tw;
  if (!raw) return null;
  try { return new URL(raw.trim(), baseUrl).toString(); } catch { return null; }
}

export async function enrichImages(posts, { log = () => {} } = {}) {
  const todo = posts.filter((p) => !p.image && !p.kind && /^https?:\/\//.test(p.url) && !SKIP_HOSTS.test(safeHost(p.url)));
  if (!todo.length) return posts;
  log(`Looking up preview images for ${todo.length} posts…`);
  let idx = 0;
  let found = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, todo.length) }, async () => {
      while (idx < todo.length) {
        const post = todo[idx++];
        try {
          const html = await readHead(post.url);
          const img = html && extractOgImage(html, post.url);
          if (img) { post.image = img; found++; }
        } catch { /* best effort */ }
      }
    }),
  );
  log(`  found ${found}/${todo.length}`);
  return posts;
}

function safeHost(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}
