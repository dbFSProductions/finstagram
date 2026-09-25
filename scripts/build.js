// Static build: writes public/feed.json so the app can be hosted anywhere
// (GitHub Pages, a folder on your Mac, a Pi on the shelf) with no server.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFeed } from '../src/feed.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public', 'feed.json');
const feed = await buildFeed({ interestsFile: process.env.INTERESTS_FILE || path.join(root, 'interests.json') });
await fs.writeFile(out, JSON.stringify(feed));
console.error(`Wrote ${feed.posts.length} posts → ${path.relative(process.cwd(), out)}`);
if (feed.posts.length === 0) process.exit(1);
