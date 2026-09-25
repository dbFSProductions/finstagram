// Finstagram feed engine.
// Reads interests.json, pulls every feed, normalises items into "posts",
// scores them, and picks a fixed number (40 by default) with a healthy
// spread across topics and sources. No infinite scroll, ever.

import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import Parser from 'rss-parser';
import { enrichImages } from './images.js';

const USER_AGENT = 'Finstagram/0.1 (+personal feed reader; RSS)';
const FEED_TIMEOUT_MS = 15000;
const MAX_ITEMS_PER_FEED = 40;
const SUMMARY_MAX = 320;

const parser = new Parser({
  timeout: FEED_TIMEOUT_MS,
  customFields: {
    item: [
      ['media:content', 'mediaContent', { keepArray: true }],
      ['media:thumbnail', 'mediaThumbnail', { keepArray: true }],
      ['media:group', 'mediaGroup'],
      ['content:encoded', 'contentEncoded'],
      ['itunes:image', 'itunesImage'],
      ['itunes:duration', 'itunesDuration'],
      ['dc:creator', 'dcCreator'],
    ],
  },
});

export async function loadInterests(file = path.resolve('interests.json')) {
  const raw = await fs.readFile(file, 'utf8');
  const cfg = JSON.parse(raw);
  if (!Array.isArray(cfg.topics) || cfg.topics.length === 0) {
    throw new Error(`${file}: "topics" must be a non-empty array`);
  }
  cfg.postCount = Number(cfg.postCount) || 40;
  cfg.maxAgeDays = Number(cfg.maxAgeDays) || 21;
  cfg.topics.forEach(normaliseTopic);
  const ids = new Set(cfg.topics.map((t) => t.id));
  cfg.wildcards = {
    slots: Number(cfg.wildcards?.slots) > 0 ? Number(cfg.wildcards.slots) : 1,
    topics: (Array.isArray(cfg.wildcards?.topics) ? cfg.wildcards.topics : []).map((t) => {
      normaliseTopic(t);
      t.between = (Array.isArray(t.between) ? t.between : []).filter((id) => ids.has(id));
      t.why = t.why || '';
      return t;
    }),
  };
  cfg.cards = (Array.isArray(cfg.cards) ? cfg.cards : []).filter((c) => c && c.id && /^https?:\/\//i.test(c.url || '')).map((c) => ({
    id: c.id,
    name: c.name || c.id,
    emoji: c.emoji || '✨',
    gradient: Array.isArray(c.gradient) && c.gradient.length === 2 ? c.gradient : ['#405de6', '#e1306c'],
    url: c.url,
    cta: c.cta || 'Open',
    messages: (Array.isArray(c.messages) ? c.messages : []).filter((m) => m && m.title),
  }));
  return cfg;
}

function normaliseTopic(t) {
  if (!t.id || !t.name) throw new Error(`Every topic needs an id and a name: ${JSON.stringify(t)}`);
  t.weight = Number(t.weight) > 0 ? Number(t.weight) : 1;
  t.emoji = t.emoji || '✨';
  t.gradient = Array.isArray(t.gradient) && t.gradient.length === 2 ? t.gradient : ['#405de6', '#e1306c'];
  t.boost = Array.isArray(t.boost) ? t.boost : [];
  t.feeds = (t.feeds || []).map((f) => (typeof f === 'string' ? { url: f } : f)).filter((f) => f && f.url);
}

const pick = (arr, random) => arr[Math.min(arr.length - 1, Math.floor(random() * arr.length))];

/* ---------- fetching ---------- */

async function fetchText(url, { timeoutMs = FEED_TIMEOUT_MS } = {}) {
  const res = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// Some feeds ship bare "&" in text, which is invalid XML. Retry once with them escaped.
async function parseFeed(xml) {
  try {
    return await parser.parseString(xml);
  } catch (err) {
    const fixed = xml.replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;');
    if (fixed === xml) throw err;
    return parser.parseString(fixed);
  }
}

// One network request per unique URL, even if two topics share a feed.
function makeFeedFetcher(log) {
  const inflight = new Map();
  return (url) => {
    if (!inflight.has(url)) {
      inflight.set(
        url,
        fetchText(url)
          .then(parseFeed)
          .then((parsed) => ({ ok: true, parsed }))
          .catch((err) => {
            log(`  ✗ ${url} — ${err.message}`);
            return { ok: false, error: err.message };
          }),
      );
    }
    return inflight.get(url);
  };
}

/* ---------- text helpers ---------- */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

// rss-parser sometimes yields { _: 'text', $: {attrs} } objects or arrays instead of strings.
function asText(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join(', ');
  if (typeof v === 'object') return asText(v._ ?? v.name ?? v['#'] ?? '');
  return String(v);
}

export function stripHtml(html = '') {
  return asText(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(?:p|div|li|h\d|tr|blockquote|section|figcaption)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, e) => ENTITIES[e.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanSummary(text, title) {
  let s = stripHtml(text);
  // arXiv RSS: "arXiv:2409.01234v1 Announce Type: new  Abstract: ..."
  s = s.replace(/^arXiv:\S+\s+Announce Type:\s*\S+\s*/i, '').replace(/^Abstract:\s*/i, '');
  // Feeds that repeat the title as the first sentence of the description.
  if (title && s.toLowerCase().startsWith(title.toLowerCase())) s = s.slice(title.length).replace(/^[\s:.\-–—]+/, '');
  s = s.replace(/\s*(Read more|Continue reading|The post .* appeared first on .*)\.?$/i, '').trim();
  if (s.length > SUMMARY_MAX) {
    s = s.slice(0, SUMMARY_MAX);
    s = s.slice(0, Math.max(s.lastIndexOf(' '), SUMMARY_MAX - 40)) + '…';
  }
  return s;
}

export function canonicalUrl(url = '') {
  try {
    const u = new URL(url);
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_|ref$|source$)/i.test(k)) u.searchParams.delete(k);
    }
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    let s = u.toString();
    if (s.endsWith('/')) s = s.slice(0, -1);
    return s;
  } catch {
    return url;
  }
}

function titleKey(title = '') {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80);
}

/* ---------- images ---------- */

const BAD_IMAGE = /(feedburner\.com\/~|\/pixel|1x1|spacer|gravatar|emoji|\.svg(\?|$)|doubleclick|stat\.|\/track|blank\.gif|feeds\.wordpress\.com\/.*\/i\/)/i;
const IMG_TAG = /<img[^>]+src\s*=\s*["']([^"']+)["'][^>]*>/i;

function firstImageFromHtml(html = '') {
  const m = String(html).match(IMG_TAG);
  if (!m) return null;
  const tag = m[0];
  const w = tag.match(/width\s*=\s*["']?(\d+)/i);
  const h = tag.match(/height\s*=\s*["']?(\d+)/i);
  if ((w && Number(w[1]) < 100) || (h && Number(h[1]) < 100)) return null;
  return m[1];
}

function pickImage(item) {
  const candidates = [];
  const enc = item.enclosure;
  if (enc?.url && (/^image\//i.test(enc.type || '') || /\.(jpe?g|png|webp|gif)(\?|$)/i.test(enc.url))) candidates.push(enc.url);
  const groupMedia = item.mediaGroup?.['media:content'];
  const media = [...(item.mediaContent || []), ...(Array.isArray(groupMedia) ? groupMedia : groupMedia ? [groupMedia] : [])];
  for (const m of media) {
    const a = m?.$ || m || {};
    if (a.url && (!a.medium || a.medium === 'image') && !/^video|^audio/i.test(a.type || '')) candidates.push(a.url);
  }
  for (const m of item.mediaThumbnail || []) {
    const a = m?.$ || m || {};
    if (a.url) candidates.push(a.url);
  }
  if (item.itunesImage?.$?.href) candidates.push(item.itunesImage.$.href);
  if (typeof item.itunesImage === 'string') candidates.push(item.itunesImage);
  const fromHtml = firstImageFromHtml(item.contentEncoded) || firstImageFromHtml(item.content) || firstImageFromHtml(item.summary);
  if (fromHtml) candidates.push(fromHtml);
  return candidates.find((u) => /^https?:\/\//i.test(u) && !BAD_IMAGE.test(u)) || null;
}

/* ---------- normalisation ---------- */

function sourceName(feedDef, parsed) {
  return feedDef.name || parsed?.title || safeHost(feedDef.url);
}

function safeHost(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function hasKeyword(text, keywords) {
  const t = text.toLowerCase();
  return keywords.some((k) => t.includes(String(k).toLowerCase()));
}

function countKeywords(text, keywords) {
  const t = text.toLowerCase();
  let n = 0;
  for (const k of keywords) if (t.includes(String(k).toLowerCase())) n++;
  return n;
}

function normaliseItem(item, feedDef, topic, parsed, now) {
  const title = stripHtml(item.title || '').slice(0, 200);
  const link = asText(item.link || item.guid).trim();
  if (!title || !/^https?:\/\//i.test(link)) return null;
  const body = item.contentEncoded || item.content || item.summary || item.contentSnippet || '';
  const summary = cleanSummary(body, title);
  const dateStr = item.isoDate || item.pubDate || item.published || item.updated;
  const published = dateStr ? new Date(dateStr) : null;
  const publishedAt = published && !Number.isNaN(published.getTime()) ? published.toISOString() : null;
  const author = stripHtml(item.creator || item.dcCreator || item.author || '').slice(0, 120) || null;
  const audio = item.enclosure?.url && /^audio\//i.test(item.enclosure.type || '') ? item.enclosure.url : null;
  const haystack = `${title} ${summary}`;
  if (Array.isArray(feedDef.include) && feedDef.include.length && !hasKeyword(haystack, feedDef.include)) return null;

  const ageHours = publishedAt ? Math.max(0, (now - Date.parse(publishedAt)) / 36e5) : 24 * 30;
  const boostHits = countKeywords(haystack, topic.boost);
  const score = -ageHours / 24 + Math.min(boostHits, 3) * 1.25;

  return {
    id: createHash('sha1').update(canonicalUrl(link)).digest('hex').slice(0, 12),
    topic: topic.id,
    source: sourceName(feedDef, parsed),
    sourceUrl: parsed?.link || feedDef.url,
    title,
    summary,
    url: link,
    image: pickImage(item),
    author,
    audio,
    publishedAt,
    score: Number(score.toFixed(3)),
  };
}

/* ---------- selection ---------- */

function roundRobinBySource(items, n) {
  const groups = new Map();
  for (const it of items) {
    if (!groups.has(it.source)) groups.set(it.source, []);
    groups.get(it.source).push(it);
  }
  // Sources ordered by their best item, so a strong source leads.
  const lanes = [...groups.values()].sort((a, b) => b[0].score - a[0].score);
  const out = [];
  let i = 0;
  while (out.length < n && lanes.some((l) => l.length)) {
    const lane = lanes[i % lanes.length];
    if (lane.length) out.push(lane.shift());
    i++;
  }
  return out;
}

export function allocateQuotas(topics, postCount) {
  const active = topics.filter((t) => t.items.length > 0);
  const quota = new Map(active.map((t) => [t.id, 0]));
  let remaining = postCount;
  // Repeatedly hand out slots in proportion to weight, capped by supply.
  while (remaining > 0) {
    const open = active.filter((t) => quota.get(t.id) < t.items.length);
    if (!open.length) break;
    const totalW = open.reduce((s, t) => s + t.weight, 0);
    const shares = open.map((t) => {
      const ideal = (t.weight / totalW) * remaining;
      const cap = t.items.length - quota.get(t.id);
      return { t, want: Math.min(cap, Math.floor(ideal)), frac: ideal - Math.floor(ideal), cap };
    });
    let given = 0;
    for (const s of shares) { quota.set(s.t.id, quota.get(s.t.id) + s.want); given += s.want; }
    if (given === 0) {
      // Everyone's ideal rounded to zero: hand single slots to the largest fractions.
      for (const s of shares.sort((a, b) => b.frac - a.frac)) {
        if (remaining - given <= 0) break;
        if (s.cap > s.want) { quota.set(s.t.id, quota.get(s.t.id) + 1); given++; }
      }
      if (given === 0) break;
    }
    remaining -= given;
  }
  return quota;
}

// Smooth weighted round-robin (the nginx algorithm): topics take turns in
// proportion to how many posts they were allotted, so neighbours differ.
function interleave(lanes) {
  const state = lanes.filter((l) => l.items.length).map((l) => ({ ...l, credit: 0 }));
  const total = state.reduce((s, l) => s + l.weight, 0);
  const out = [];
  while (state.some((l) => l.items.length)) {
    let best = null;
    for (const l of state) {
      if (!l.items.length) continue;
      l.credit += l.weight;
      if (!best || l.credit > best.credit) best = l;
    }
    best.credit -= total;
    out.push(best.items.shift());
  }
  return out;
}

export function selectPosts(topicBuckets, postCount) {
  const quota = allocateQuotas(topicBuckets, postCount);
  const lanes = topicBuckets
    .filter((t) => quota.get(t.id) > 0)
    .map((t) => {
      const items = roundRobinBySource([...t.items].sort((a, b) => b.score - a.score), quota.get(t.id));
      return { id: t.id, weight: items.length, items };
    });
  return interleave(lanes).slice(0, postCount);
}

/* ---------- main entry ---------- */

export async function buildFeed({ interestsFile, log = console.error, images = true, now = Date.now(), random = Math.random } = {}) {
  const cfg = await loadInterests(interestsFile);
  const fetchFeed = makeFeedFetcher(log);
  const cutoff = now - cfg.maxAgeDays * 864e5;
  const seenUrl = new Set();
  const seenTitle = new Set();
  const sources = { ok: [], failed: [] };

  // One wildcard interest per build, drawn from the intersections in interests.json.
  const wild = cfg.wildcards.topics.length ? pick(cfg.wildcards.topics, random) : null;
  const topics = wild ? [...cfg.topics, wild] : cfg.topics;

  log(`Pulling ${topics.reduce((n, t) => n + t.feeds.length, 0)} feeds across ${cfg.topics.length} topics${wild ? ` (wildcard: ${wild.name})` : ''}…`);

  const buckets = await Promise.all(
    topics.map(async (topic) => {
      const results = await Promise.all(topic.feeds.map(async (f) => ({ f, r: await fetchFeed(f.url) })));
      const items = [];
      for (const { f, r } of results) {
        if (!r.ok) { sources.failed.push({ topic: topic.id, url: f.url, error: r.error }); continue; }
        sources.ok.push({ topic: topic.id, url: f.url, name: sourceName(f, r.parsed), items: r.parsed.items?.length || 0 });
        for (const raw of (r.parsed.items || []).slice(0, MAX_ITEMS_PER_FEED)) {
          let post;
          try { post = normaliseItem(raw, f, topic, r.parsed, now); } catch { continue; }
          if (!post) continue;
          if (post.publishedAt && Date.parse(post.publishedAt) < cutoff) continue;
          items.push(post);
        }
      }
      return { id: topic.id, weight: topic.weight, items };
    }),
  );

  // Cross-topic dedupe, first topic wins (topic order in interests.json is priority order).
  for (const b of buckets) {
    b.items = b.items.filter((p) => {
      const u = canonicalUrl(p.url);
      const t = titleKey(p.title);
      if (seenUrl.has(u) || seenTitle.has(t)) return false;
      seenUrl.add(u);
      seenTitle.add(t);
      return true;
    });
  }

  const wildBucket = wild && buckets.find((b) => b.id === wild.id);
  let posts = selectPosts(buckets.filter((b) => b !== wildBucket), cfg.postCount);
  const postCount = posts.length;

  // Extras ride along on top of the 40: a wildcard post or two, and a card per configured app.
  // They land past the first couple of posts, never at the very top.
  const slot = () => Math.min(posts.length, 2 + Math.floor(random() * Math.max(1, Math.min(posts.length - 1, 10))));
  if (wildBucket?.items.length) {
    const between = wild.between.map((id) => cfg.topics.find((t) => t.id === id).name);
    const extras = roundRobinBySource([...wildBucket.items].sort((a, b) => b.score - a.score), cfg.wildcards.slots);
    for (const p of extras) posts.splice(slot(), 0, { ...p, wildcard: { between, why: wild.why } });
  }
  for (const card of cfg.cards) {
    const msg = card.messages.length ? pick(card.messages, random) : { title: card.name, text: '' };
    posts.splice(slot(), 0, {
      id: `card-${card.id}`, kind: 'card', topic: null, source: card.name, title: msg.title, summary: msg.text || '',
      url: card.url, emoji: card.emoji, gradient: card.gradient, cta: card.cta, image: null, author: null, audio: null, publishedAt: null, score: 0,
    });
  }

  if (images) posts = await enrichImages(posts, { log });

  const counts = Object.fromEntries(buckets.map((b) => [b.id, posts.filter((p) => p.topic === b.id).length]));
  const topicSummary = (t) => ({ id: t.id, name: t.name, emoji: t.emoji, gradient: t.gradient, count: counts[t.id] || 0, available: buckets.find((b) => b.id === t.id)?.items.length || 0 });
  const feed = {
    generatedAt: new Date(now).toISOString(),
    postCount,
    target: cfg.postCount,
    topics: [...cfg.topics.map(topicSummary), ...(wild ? [{ ...topicSummary(wild), wildcard: true, between: wild.between, why: wild.why }] : [])],
    posts,
    sources,
  };
  log(`Built ${postCount}/${cfg.postCount} posts (+${posts.length - postCount} extras) · ${sources.ok.length} feeds ok, ${sources.failed.length} failed`);
  return feed;
}
