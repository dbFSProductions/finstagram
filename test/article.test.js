import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { extractArticle, fetchArticle, prefetchArticles } from '../src/article.js';

const PARA = '<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco.</p>';
const PAGE = `<!doctype html><html><head><title>A Story · Some Site</title><meta name="author" content="Jo Bloggs"></head><body>
  <div id="consent">We and our 1,247 partners use cookies to personalise content and ads, provide social media features and analyse our traffic. <button>Accept all cookies</button> <button>Manage preferences</button></div>
  <nav><a href="/">Home</a><a href="/news">News</a></nav>
  <article><h1>A Story</h1><p class="byline">By Jo Bloggs</p>${PARA.repeat(8)}<figure><img src="/pic.jpg"><figcaption>A picture</figcaption></figure></article>
  <aside class="advert">Buy now! Limited offer!</aside>
  <script>window.track = () => alert(1)</script>
</body></html>`;

test('extractArticle keeps the article body and drops chrome, adverts and scripts', () => {
  const a = extractArticle(PAGE, 'https://site.test/a-story');
  assert.ok(a, 'article extracted');
  assert.equal(a.url, 'https://site.test/a-story');
  assert.equal(a.byline, 'Jo Bloggs');
  assert.ok(a.length > 1000);
  assert.match(a.content, /Lorem ipsum dolor sit amet/);
  assert.match(a.content, /<figcaption>A picture<\/figcaption>/);
  assert.doesNotMatch(a.content, /Accept all cookies|partners use cookies/);
  assert.doesNotMatch(a.content, /Limited offer/);
  assert.doesNotMatch(a.content, /<script|alert\(/);
});

test('extractArticle returns null for pages with no real body', () => {
  assert.equal(extractArticle('<html><body><p>Please enable JavaScript.</p></body></html>', 'https://site.test/x'), null);
  assert.equal(extractArticle('', 'https://site.test/x'), null);
});

test('fetchArticle pulls a page over HTTP and rejects non-HTML responses', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/story') { res.setHeader('content-type', 'text/html; charset=utf-8'); return res.end(PAGE); }
    if (req.url === '/data') { res.setHeader('content-type', 'application/json'); return res.end('{}'); }
    res.statusCode = 404;
    res.end('nope');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const a = await fetchArticle(`${base}/story`);
    assert.match(a.content, /Lorem ipsum/);
    await assert.rejects(fetchArticle(`${base}/data`), /not an HTML page/);
    await assert.rejects(fetchArticle(`${base}/missing`), /HTTP 404/);

    const dir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'finsta-articles-')), 'articles');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'stale.json'), '{}');
    const posts = [
      { id: 'ok1', url: `${base}/story` },
      { id: 'gone', url: `${base}/missing` },
      { id: 'card-x', kind: 'card', url: `${base}/story` },
    ];
    const captured = await prefetchArticles(posts, dir, { concurrency: 2 });
    assert.equal(captured, 1);
    assert.deepEqual((await fs.readdir(dir)).sort(), ['ok1.json'], 'captures readable posts, skips failures and cards, clears stale files');
    assert.match(JSON.parse(await fs.readFile(path.join(dir, 'ok1.json'), 'utf8')).content, /Lorem ipsum/);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
