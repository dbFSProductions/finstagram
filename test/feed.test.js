import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFeed, stripHtml, canonicalUrl, allocateQuotas, selectPosts } from '../src/feed.js';
import { extractOgImage } from '../src/images.js';
import { startMockFeeds } from './mock-feeds.js';

test('stripHtml flattens markup and entities', () => {
  assert.equal(stripHtml('<p>Hello &amp; <b>world</b>&hellip;</p><script>x()</script>'), 'Hello & world…');
});

test('canonicalUrl drops tracking params, hash and www', () => {
  assert.equal(canonicalUrl('https://www.Example.com/a/?utm_source=x&id=2#frag'), 'https://example.com/a/?id=2');
});

test('extractOgImage prefers og:image and resolves relative urls', () => {
  const html = '<html><head><meta name="twitter:image" content="/tw.jpg"><meta property="og:image" content="/og.jpg"></head></html>';
  assert.equal(extractOgImage(html, 'https://site.test/post/1'), 'https://site.test/og.jpg');
  assert.equal(extractOgImage('<html></html>', 'https://site.test/'), null);
});

test('allocateQuotas is proportional, capped by supply, and sums to the target', () => {
  const buckets = [
    { id: 'a', weight: 6, items: Array(100).fill(0) },
    { id: 'b', weight: 2, items: Array(100).fill(0) },
    { id: 'c', weight: 4, items: Array(3).fill(0) },
    { id: 'd', weight: 4, items: [] },
  ];
  const q = allocateQuotas(buckets, 40);
  assert.equal([...q.values()].reduce((s, n) => s + n, 0), 40);
  assert.equal(q.get('c'), 3);
  assert.equal(q.has('d'), false);
  assert.ok(q.get('a') > q.get('b'));
});

test('selectPosts returns exactly N and never two same-topic posts back to back when supply allows', () => {
  const mk = (topic, n) => Array.from({ length: n }, (_, i) => ({ id: `${topic}${i}`, topic, source: `s${i % 3}`, score: -i }));
  const buckets = [
    { id: 'x', weight: 1, items: mk('x', 30) },
    { id: 'y', weight: 1, items: mk('y', 30) },
    { id: 'z', weight: 1, items: mk('z', 30) },
  ];
  const posts = selectPosts(buckets, 40);
  assert.equal(posts.length, 40);
  for (let i = 1; i < posts.length; i++) assert.notEqual(posts[i].topic, posts[i - 1].topic, `adjacent same topic at ${i}`);
});

test('buildFeed pulls mock feeds end to end', async () => {
  const mock = await startMockFeeds();
  try {
    const logs = [];
    const feed = await buildFeed({ interestsFile: mock.interestsFile, images: false, log: (m) => logs.push(m) });
    assert.ok(feed.posts.length > 20, `got ${feed.posts.length} posts`);
    assert.ok(feed.posts.length <= 40);
    assert.equal(feed.sources.failed.length, feed.topics.length, 'one dead feed per topic is reported');
    const ids = new Set(feed.posts.map((p) => p.id));
    assert.equal(ids.size, feed.posts.length, 'no duplicate posts');
    const arxiv = feed.posts.find((p) => p.source.startsWith('arXiv'));
    assert.ok(arxiv, 'arXiv item present');
    assert.ok(!/Announce Type/.test(arxiv.summary), 'arXiv boilerplate stripped');
    assert.ok(arxiv.author, 'arXiv author kept');
    assert.ok(feed.posts.some((p) => p.image), 'images extracted from media:content / html');
    assert.ok(feed.posts.some((p) => p.audio), 'podcast enclosure detected');
    assert.ok(feed.topics.every((t) => t.count > 0), 'every topic represented: ' + JSON.stringify(feed.topics.map((t) => [t.id, t.count])));
    for (const p of feed.posts) {
      assert.match(p.url, /^https?:\/\//);
      assert.ok(p.title && p.source && p.topic);
    }
  } finally {
    await mock.close();
  }
});
