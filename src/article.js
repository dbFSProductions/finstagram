// Reader view: fetches an article page and reduces it to its readable body
// with Mozilla's Readability, so a post can be read in-app without the
// source site's cookie wall, ad slots and navigation chrome.

import fs from 'node:fs/promises';
import path from 'node:path';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

const PAGE_TIMEOUT_MS = 12000;
const MAX_BYTES = 3 * 1024 * 1024;
const MIN_TEXT_LENGTH = 400;
// A browser-like UA: several publishers serve a stub (or a 403) to anything that isn't one.
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';

async function readPage(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'accept-language': 'en' },
    signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (!/html/i.test(res.headers.get('content-type') || '')) throw new Error('not an HTML page');
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
  return { html: Buffer.concat(chunks).toString('utf8'), finalUrl: res.url || url };
}

// Readability's own "unlikely candidate" list knows gdpr/banner/popup but not
// cookie/consent, and a consent wall that sits next to the article often
// survives as a sibling paragraph. Drop those containers up front.
const CONSENT_RE = /cookie|consent|gdpr/i;

export function extractArticle(html, url) {
  const { document } = parseHTML(html);
  for (const el of document.querySelectorAll('[id], [class]')) {
    if (el === document.body || el === document.documentElement) continue;
    if (CONSENT_RE.test(`${el.getAttribute('id') || ''} ${el.getAttribute('class') || ''}`)) el.remove();
  }
  let parsed;
  try { parsed = new Readability(document).parse(); } catch { return null; }
  if (!parsed?.content || (parsed.length || 0) < MIN_TEXT_LENGTH) return null;
  return {
    url,
    title: parsed.title || null,
    byline: parsed.byline || null,
    siteName: parsed.siteName || null,
    publishedTime: parsed.publishedTime || null,
    excerpt: parsed.excerpt || null,
    length: parsed.length,
    lang: parsed.lang || null,
    content: parsed.content,
  };
}

export async function fetchArticle(url) {
  const { html, finalUrl } = await readPage(url);
  const article = extractArticle(html, finalUrl);
  if (!article) throw new Error('no readable article found');
  return article;
}

// Static builds have no server to extract on demand, so capture every post's
// article at build time as <dir>/<post id>.json. Best effort: a page that
// can't be read is skipped and the app falls back to the original link.
export async function prefetchArticles(posts, dir, { log = () => {}, concurrency = 6 } = {}) {
  const todo = posts.filter((p) => !p.kind && /^https?:\/\//.test(p.url));
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  log(`Capturing articles for ${todo.length} posts…`);
  let idx = 0;
  let captured = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, todo.length) }, async () => {
      while (idx < todo.length) {
        const post = todo[idx++];
        try {
          const article = await fetchArticle(post.url);
          await fs.writeFile(path.join(dir, `${post.id}.json`), JSON.stringify(article));
          captured++;
        } catch (err) {
          log(`  ✗ ${post.url} — ${err.message}`);
        }
      }
    }),
  );
  log(`  captured ${captured}/${todo.length}`);
  return captured;
}
