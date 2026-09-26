// Finstagram server: serves the app and a cached 40-post feed.
//   npm start            → http://localhost:3040
//   PORT=8080 npm start  → custom port
//   FEED_TTL_MINUTES=30  → how long a built feed is reused before re-pulling

import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFeed } from './src/feed.js';
import { fetchArticle } from './src/article.js';
import { loadHistory, excludeSet, recordServed, saveHistory } from './src/history.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3040;
const TTL_MS = (Number(process.env.FEED_TTL_MINUTES) || 30) * 60 * 1000;
const INTERESTS = process.env.INTERESTS_FILE || path.join(__dirname, 'interests.json');
const CACHE_DIR = path.join(__dirname, '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'feed.json');
const HISTORY_FILE = path.join(CACHE_DIR, 'history.json');   // every post ever served, so a refresh replaces all of them

let cached = null;      // last good feed
let building = null;    // in-flight build promise

async function loadDiskCache() {
  try {
    const feed = JSON.parse(await fs.readFile(CACHE_FILE, 'utf8'));
    if (feed?.posts?.length) cached = feed;
  } catch { /* no cache yet */ }
}

function isFresh(feed) {
  return feed && Date.now() - Date.parse(feed.generatedAt) < TTL_MS;
}

async function rebuild() {
  if (building) return building;
  building = (async () => {
    try {
      const history = await loadHistory(HISTORY_FILE);
      const feed = await buildFeed({ interestsFile: INTERESTS, exclude: excludeSet(history) });
      if (feed.posts.length || !cached) {
        cached = feed;
        await fs.mkdir(CACHE_DIR, { recursive: true });
        await fs.writeFile(CACHE_FILE, JSON.stringify(feed));
        await saveHistory(HISTORY_FILE, recordServed(history, feed));
      }
      return cached;
    } finally {
      building = null;
    }
  })();
  return building;
}

async function getFeed({ refresh = false } = {}) {
  if (!refresh && isFresh(cached)) return cached;
  if (cached && !refresh) {
    rebuild().catch((e) => console.error('background rebuild failed:', e.message)); // serve stale, refresh behind
    return cached;
  }
  return rebuild();
}

const app = express();
app.disable('x-powered-by');

app.get('/api/feed', async (req, res) => {
  try {
    const feed = await getFeed({ refresh: 'refresh' in req.query });
    res.set('cache-control', 'no-store');
    res.json(feed);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/* ---------- reader view ---------- */

const ARTICLE_TTL_MS = 6 * 60 * 60 * 1000;
const ARTICLE_CACHE_MAX = 300;
const articles = new Map();   // url -> { at, promise }

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
}

// Only fetch pages the feed itself pointed at: a post in the current feed, or
// (for saved posts that have since rotated out) a host one of the sources uses.
function allowedArticleUrl(id, url) {
  const post = id && cached?.posts.find((p) => p.id === id);
  if (post) return post.url;
  if (!/^https?:\/\//i.test(url || '')) return null;
  const host = hostOf(url);
  const known = new Set([...(cached?.posts || []).map((p) => hostOf(p.url)), ...(cached?.sources?.ok || []).map((s) => hostOf(s.url))]);
  return host && known.has(host) ? url : null;
}

function getArticle(url) {
  const hit = articles.get(url);
  if (hit && Date.now() - hit.at < ARTICLE_TTL_MS) return hit.promise;
  const promise = fetchArticle(url).catch((err) => { articles.delete(url); throw err; });
  articles.set(url, { at: Date.now(), promise });
  if (articles.size > ARTICLE_CACHE_MAX) articles.delete(articles.keys().next().value);
  return promise;
}

app.get('/api/article', async (req, res) => {
  const url = allowedArticleUrl(String(req.query.id || ''), String(req.query.url || ''));
  res.set('cache-control', 'no-store');
  if (!url) return res.status(404).json({ error: 'Not a post in this feed' });
  try {
    res.json(await getArticle(url));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, cachedPosts: cached?.posts?.length || 0, generatedAt: cached?.generatedAt || null, building: !!building });
});

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

await loadDiskCache();
app.listen(PORT, () => {
  console.log(`Finstagram → http://localhost:${PORT}`);
  if (!isFresh(cached)) rebuild().catch((e) => console.error('initial build failed:', e.message));
});
