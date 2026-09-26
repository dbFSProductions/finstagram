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

test('exclude keeps served posts out until the feeds run dry, then backfills flagged repeats', async () => {
  const mock = await startMockFeeds();
  try {
    const opts = { interestsFile: mock.interestsFile, images: false, log: () => {}, postCount: 10, random: () => 0.5 };
    const real = (p) => p.kind !== 'card';
    const served = new Set();
    let sawRepeats = false;
    for (let round = 0; round < 8 && !sawRepeats; round++) {
      const feed = await buildFeed({ ...opts, exclude: new Set(served) });
      const core = feed.posts.filter(real);
      assert.equal(feed.postCount, 10, `round ${round} still fills all slots`);
      for (const p of core) {
        if (p.repeat) assert.ok(served.has(p.id), `round ${round}: repeat ${p.id} was served before`);
        else assert.ok(!served.has(p.id), `round ${round}: fresh ${p.id} never served before`);
      }
      assert.equal(feed.fresh + feed.repeats, feed.postCount);
      if (feed.repeats) {
        sawRepeats = true;
        assert.ok(feed.fresh > 0 || served.size >= core.length, 'repeats only appear once the unseen pool is short');
        assert.ok(core.findIndex((p) => p.repeat) >= feed.fresh, 'unseen posts come before the repeats');
      } else {
        assert.equal(feed.repeats, 0);
      }
      core.forEach((p) => served.add(p.id));
    }
    assert.ok(sawRepeats, 'the mock pool is small enough to run dry within a few rounds');
  } finally {
    await mock.close();
  }
});

test('history remembers served posts, ignores cards, and prunes old entries', async () => {
  const { loadHistory, excludeSet, recordServed } = await import('../src/history.js');
  const h = await loadHistory('/nonexistent/finsta-history.json');
  const day = 864e5;
  recordServed(h, { posts: [{ id: 'old' }, { id: 'card-x', kind: 'card' }] }, Date.now() - 90 * day);
  assert.deepEqual([...excludeSet(h)], ['old']);
  recordServed(h, { posts: [{ id: 'new' }] });
  assert.deepEqual([...excludeSet(h)], ['new'], '90-day-old entry pruned, card never recorded');
});

test('buildFeed pulls mock feeds end to end', async () => {
  const mock = await startMockFeeds();
  try {
    const logs = [];
    const feed = await buildFeed({ interestsFile: mock.interestsFile, images: false, log: (m) => logs.push(m), random: () => 0.42 });
    const regular = feed.posts.filter((p) => !p.kind && !p.wildcard);
    assert.ok(regular.length > 20, `got ${regular.length} posts`);
    assert.ok(regular.length <= 40);
    assert.equal(feed.postCount, regular.length);
    assert.equal(feed.sources.failed.length, feed.topics.length, 'one dead feed per topic is reported');
    const ids = new Set(feed.posts.map((p) => p.id));
    assert.equal(ids.size, feed.posts.length, 'no duplicate posts');

    const wildTopic = feed.topics.find((t) => t.wildcard);
    assert.equal(wildTopic?.id, 'wild-synth-diy', 'the wildcard interest is listed');
    assert.deepEqual(wildTopic.between, ['electronics', 'guitar']);
    const wildPosts = feed.posts.filter((p) => p.wildcard);
    assert.equal(wildPosts.length, 1, 'exactly one wildcard slot');
    assert.deepEqual(wildPosts[0].wildcard.between, ['Electronics', 'Guitar FX'], 'wildcard names the topics it sits between');
    assert.ok(feed.posts.indexOf(wildPosts[0]) >= 2, 'wildcard is not at the very top');
    assert.equal(feed.topics.filter((t) => !t.wildcard).some((t) => t.id === 'wild-synth-diy'), false);

    const cards = feed.posts.filter((p) => p.kind === 'card');
    assert.equal(cards.length, 1, 'one practice card');
    assert.equal(cards[0].source, 'Xerra');
    assert.match(cards[0].url, /listen-record-learn/);
    assert.ok(cards[0].title && cards[0].cta, 'card has a message and a call to action');
    assert.ok(feed.posts.indexOf(cards[0]) >= 2 && feed.posts.indexOf(cards[0]) <= 12, 'card lands near the top');
    const arxiv = feed.posts.find((p) => p.source.startsWith('arXiv'));
    assert.ok(arxiv, 'arXiv item present');
    assert.ok(!/Announce Type/.test(arxiv.summary), 'arXiv boilerplate stripped');
    assert.ok(arxiv.author, 'arXiv author kept');
    assert.ok(feed.posts.some((p) => p.image), 'images extracted from media:content / html');
    assert.ok(feed.posts.some((p) => p.audio), 'podcast enclosure detected');
    assert.ok(feed.topics.every((t) => t.count > 0), 'every topic represented: ' + JSON.stringify(feed.topics.map((t) => [t.id, t.count])));
    for (const p of feed.posts) {
      assert.match(p.url, /^https?:\/\//);
      assert.ok(p.title && p.source && (p.topic || p.kind === 'card'));
    }
  } finally {
    await mock.close();
  }
});
