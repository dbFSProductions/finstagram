// Static build: writes public/feed.json so the app can be hosted anywhere
// (GitHub Pages, a folder on your Mac, a Pi on the shelf) with no server.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildFeed } from '../src/feed.js';
import { prefetchArticles } from '../src/article.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public', 'feed.json');
const feed = await buildFeed({ interestsFile: process.env.INTERESTS_FILE || path.join(root, 'interests.json') });
// The cron the static site is rebuilt on (set by the Pages workflow), so the app can say when the next build is due.
if (process.env.FEED_SCHEDULE) feed.schedule = process.env.FEED_SCHEDULE;
// Fingerprint of the front end that shipped with this feed, so a phone holding an older app.js knows to reload.
feed.appVersion = createHash('sha1').update(await fs.readFile(path.join(root, 'public', 'app.js'))).digest('hex').slice(0, 12);
await fs.writeFile(out, JSON.stringify(feed));
console.error(`Wrote ${feed.postCount} posts (+${feed.posts.length - feed.postCount} extras) → ${path.relative(process.cwd(), out)}`);
if (feed.postCount === 0) process.exit(1);
await prefetchArticles(feed.posts, path.join(root, 'public', 'articles'), { log: console.error });
