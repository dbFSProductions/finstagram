// Finstagram server: serves the app and a cached 40-post feed.
//   npm start            → http://localhost:3040
//   PORT=8080 npm start  → custom port
//   FEED_TTL_MINUTES=30  → how long a built feed is reused before re-pulling

import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFeed } from './src/feed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3040;
const TTL_MS = (Number(process.env.FEED_TTL_MINUTES) || 30) * 60 * 1000;
const INTERESTS = process.env.INTERESTS_FILE || path.join(__dirname, 'interests.json');
const CACHE_DIR = path.join(__dirname, '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'feed.json');

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
      const feed = await buildFeed({ interestsFile: INTERESTS });
      if (feed.posts.length || !cached) {
        cached = feed;
        await fs.mkdir(CACHE_DIR, { recursive: true });
        await fs.writeFile(CACHE_FILE, JSON.stringify(feed));
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

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, cachedPosts: cached?.posts?.length || 0, generatedAt: cached?.generatedAt || null, building: !!building });
});

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

await loadDiskCache();
app.listen(PORT, () => {
  console.log(`Finstagram → http://localhost:${PORT}`);
  if (!isFresh(cached)) rebuild().catch((e) => console.error('initial build failed:', e.message));
});
