// Finstagram front end. Plain JS, no build step. Talks to /api/feed when the
// little server is running, falls back to a static feed.json otherwise.

const FEED_URLS = ['api/feed', 'feed.json'];
const STORE_LIKES = 'finsta.likes';
const STORE_SAVED = 'finsta.saved';
const STORE_SEEN = 'finsta.seenTopics';

/* ---------- icons (inline SVG, Instagram-ish line style) ---------- */
const I = {
  home: '<svg viewBox="0 0 24 24"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5.5v-6h-5v6H4a1 1 0 0 1-1-1z"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.6-9.2C1 8.3 3 4.5 6.8 4.5c2 0 3.6 1.2 5.2 3 1.6-1.8 3.2-3 5.2-3 3.8 0 5.8 3.8 4.4 7.3C19.5 16.4 12 21 12 21z"/></svg>',
  heartFill: '<svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.6-9.2C1 8.3 3 4.5 6.8 4.5c2 0 3.6 1.2 5.2 3 1.6-1.8 3.2-3 5.2-3 3.8 0 5.8 3.8 4.4 7.3C19.5 16.4 12 21 12 21z"/></svg>',
  comment: '<svg viewBox="0 0 24 24"><path d="M21 12a8.5 8.5 0 0 1-12.6 7.4L3 21l1.6-5.4A8.5 8.5 0 1 1 21 12z"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M21 3 3 10.5l7.5 3 3 7.5z"/><path d="M21 3 10.5 13.5"/></svg>',
  bookmark: '<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4.5L6 21z"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="6" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18" cy="12" r="1.7"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.5 1.5"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
};

/* ---------- state ---------- */
const state = {
  feed: null,
  error: null,
  loading: true,
  view: 'home',
  topicFilter: null,
  query: '',
  likes: new Set(load(STORE_LIKES, [])),
  saved: new Map(Object.entries(load(STORE_SAVED, {}))),
  seenTopics: new Set(load(STORE_SEEN, [])),
  expanded: new Set(),
};

function load(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
}
function persist() {
  try {
    localStorage.setItem(STORE_LIKES, JSON.stringify([...state.likes]));
    localStorage.setItem(STORE_SAVED, JSON.stringify(Object.fromEntries(state.saved)));
    localStorage.setItem(STORE_SEEN, JSON.stringify([...state.seenTopics]));
  } catch { /* private mode etc. */ }
}

const $view = document.getElementById('view');
const $toast = document.getElementById('toast');
const $refresh = document.getElementById('refresh-btn');
const $reader = document.getElementById('reader');
$refresh.innerHTML = I.refresh;

/* ---------- helpers ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const topicOf = (id) => state.feed?.topics.find((t) => t.id === id) || { name: id, emoji: '✨', gradient: ['#405de6', '#e1306c'] };
const gradVars = (t) => `--g1:${t.gradient[0]};--g2:${t.gradient[1]}`;
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

function timeAgo(iso) {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`;
  return `${Math.floor(s / 86400 / 7)}w`;
}
function longDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}
function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => $toast.classList.remove('show'), 1800);
}

/* ---------- data ---------- */
async function loadFeed({ refresh = false } = {}) {
  state.loading = true;
  state.error = null;
  render();
  $refresh.classList.add('spinning');
  const errors = [];
  for (const base of FEED_URLS) {
    const url = refresh && base.startsWith('api') ? `${base}?refresh=1&_=${Date.now()}` : `${base}?_=${Date.now()}`;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`${base}: HTTP ${res.status}`);
      const feed = await res.json();
      if (!Array.isArray(feed.posts)) throw new Error(`${base}: not a feed`);
      state.feed = feed;
      state.loading = false;
      $refresh.classList.remove('spinning');
      render();
      return;
    } catch (e) {
      errors.push(e.message);
    }
  }
  state.loading = false;
  state.error = errors.join('\n');
  $refresh.classList.remove('spinning');
  render();
}

/* ---------- rendering ---------- */
function renderTabs() {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === state.view));
  const savedCount = state.saved.size;
  const savedTab = document.querySelector('.tab[data-view="saved"]');
  savedTab.querySelector('.dotcount')?.remove();
  if (savedCount) savedTab.insertAdjacentHTML('beforeend', `<span class="dotcount">${savedCount}</span>`);
}

function render() {
  renderTabs();

  if (state.error && !state.feed) return ($view.innerHTML = renderError());
  if (state.loading && !state.feed) return ($view.innerHTML = renderSkeleton());
  switch (state.view) {
    case 'search': return ($view.innerHTML = renderSearch());
    case 'liked': return ($view.innerHTML = renderCollection('liked'));
    case 'saved': return ($view.innerHTML = renderCollection('saved'));
    case 'me': return ($view.innerHTML = renderProfile());
    default: return ($view.innerHTML = renderHome());
  }
}

function renderSkeleton() {
  const one = `<div class="skel"><div class="skel-head"><div class="circle"></div><div class="bar" style="width:120px"></div></div><div class="block"></div><div class="skel-body"><div class="bar" style="width:40%"></div><div class="bar" style="width:85%"></div><div class="bar" style="width:60%"></div></div></div>`;
  return `<div class="stories">${Array.from({ length: 6 }, () => `<div class="story"><div class="skel"><div class="circle" style="width:66px;height:66px"></div></div></div>`).join('')}</div>${one}${one}${one}`;
}

function renderError() {
  return `<div class="empty"><div class="glyph">📡</div><h2>Couldn't load your feed</h2>
    <p>Start the server with <code>npm start</code>, or build a static <code>feed.json</code> with <code>npm run build</code>.</p>
    <pre>${esc(state.error)}</pre><button class="btn" data-action="reload">Try again</button></div>`;
}

function renderStories() {
  const { topics, posts } = state.feed;
  const all = `<a class="story ${state.topicFilter ? '' : 'active'}" data-action="filter" data-topic="" href="#home">
      <div class="story-ring"><div class="story-avatar" style="--g1:#f9ce34;--g2:#6228d7">✨</div></div>
      <div class="story-name">All</div><div class="story-count">${posts.length}</div></a>`;
  return `<section class="stories" aria-label="Interests">${all}${topics.map((t) => `
    <a class="story ${state.topicFilter === t.id ? 'active' : state.seenTopics.has(t.id) ? 'seen' : ''}" data-action="filter" data-topic="${t.id}" href="#home">
      <div class="story-ring"><div class="story-avatar" style="${gradVars(t)}">${t.emoji}</div></div>
      <div class="story-name">${esc(t.name)}</div><div class="story-count">${t.count}</div></a>`).join('')}</section>`;
}

function renderHome() {
  const { posts } = state.feed;
  const shown = state.topicFilter ? posts.filter((p) => p.topic === state.topicFilter) : posts;
  const note = state.topicFilter
    ? `<div class="filter-note"><span>${topicOf(state.topicFilter).emoji} ${shown.length} ${esc(topicOf(state.topicFilter).name)} post${shown.length === 1 ? '' : 's'}</span><button data-action="filter" data-topic="">Show all</button></div>`
    : '';
  return `${renderStories()}${note}<div class="feed">${shown.map(renderPost).join('')}${renderCaughtUp(shown)}</div>`;
}

function renderCaughtUp(shown) {
  if (!shown.length) return `<div class="empty"><div class="glyph">🫥</div><h2>Nothing here right now</h2><p>None of this interest's feeds had anything recent. Pull fresh posts, or check its sources under Interests.</p></div>`;
  const dated = state.feed.posts.map((p) => p.publishedAt).filter(Boolean).map(Date.parse);
  const oldest = dated.length ? Math.max(1, Math.round((Date.now() - Math.min(...dated)) / 864e5)) : null;
  const span = oldest ? ` from the last ${oldest === 1 ? 'day' : `${oldest} days`}` : '';
  const what = state.topicFilter ? `all ${shown.length} ${esc(topicOf(state.topicFilter).name)} posts` : `all ${state.feed.posts.length} posts`;
  return `<div class="caught-up"><div class="check"><div>${I.check}</div></div>
    <h2>You're all caught up</h2><p>You've seen ${what}${span}. That's the whole feed. Go build something.</p>
    <button class="btn" data-action="refresh">Pull fresh posts</button></div>`;
}

function renderPost(p, { compact = false } = {}) {
  if (p.kind === 'card') return renderPracticeCard(p);
  const t = topicOf(p.topic);
  const liked = state.likes.has(p.id);
  const saved = state.saved.has(p.id);
  const expanded = state.expanded.has(p.id);
  const media = p.image
    ? `<img src="${esc(p.image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" >`
    : renderCard(p, t);
  const badge = p.audio ? `<span class="badge">🎧 Podcast</span>` : p.wildcard ? `<span class="badge">🎲 Wildcard</span>` : '';
  const sub = p.wildcard
    ? `🎲 Because you like ${p.wildcard.between.map(esc).join(' and ') || 'what you like'}`
    : [t.name, p.author ? esc(p.author) : null, host(p.url)].filter(Boolean).join(' · ');
  return `<article class="post ${p.wildcard ? 'wild' : ''}" id="post-${p.id}" data-id="${p.id}">
    <header class="post-head">
      <a class="avatar" style="${gradVars(t)}" data-action="filter" data-topic="${t.id}" href="#home" aria-label="${esc(t.name)}"><span>${t.emoji}</span></a>
      <div class="post-meta">
        <div class="post-source">${esc(p.source)} <span class="dot">·</span> <span class="dot">${timeAgo(p.publishedAt)}</span></div>
        <div class="post-sub">${sub}</div>
      </div>
      <button class="post-more" data-action="open" aria-label="Open article">${I.more}</button>
    </header>
    <a class="post-media ${p.image ? '' : 'square'}" href="${esc(p.url)}" target="_blank" rel="noopener" data-action="media">${media}${badge}<div class="big-heart">${I.heartFill}</div></a>
    <div class="post-actions">
      <button class="act like ${liked ? 'on' : ''}" data-action="like" aria-label="Like" aria-pressed="${liked}">${I.heart}</button>
      <button class="act" data-action="open" aria-label="Read">${I.comment}</button>
      <button class="act" data-action="share" aria-label="Share">${I.share}</button>
      <span class="spacer"></span>
      <button class="act save ${saved ? 'on' : ''}" data-action="save" aria-label="Save" aria-pressed="${saved}">${I.bookmark}</button>
    </div>
    <div class="post-body">
      ${liked ? `<div class="post-likes">Liked by you</div>` : ''}
      ${p.wildcard?.why ? `<div class="wild-why">${esc(p.wildcard.why)}</div>` : ''}
      <div class="post-caption"><b>${esc(p.source)}</b> <a href="${esc(p.url)}" data-action="open" class="title">${esc(p.title)}</a>
        ${p.summary ? `<div class="summary ${expanded ? '' : 'clamped'}">${esc(p.summary)}</div>${p.summary.length > 110 && !expanded ? `<button class="more-btn" data-action="expand">more</button>` : ''}` : ''}
      </div>
      ${p.audio && expanded ? `<div class="audio-wrap"><audio controls preload="none" src="${esc(p.audio)}"></audio></div>` : ''}
      <div class="post-links"><a href="${esc(p.url)}" target="_blank" rel="noopener">Read on ${esc(host(p.url))}</a></div>
      <div class="post-time">${longDate(p.publishedAt)}</div>
    </div>
  </article>`;
}

function renderCard(p, t) {
  return `<div class="post-card" style="${gradVars(t)}"><div class="emoji">${t.emoji}</div><div class="card-title">${esc(p.title)}</div><div class="card-source">${esc(p.source)}</div></div>`;
}

// A nudge towards another app (Xerra and friends). Plain links out, no reader, no like.
function renderPracticeCard(p) {
  const g = { gradient: p.gradient, emoji: p.emoji, name: p.source };
  return `<article class="post practice" id="post-${p.id}" data-id="${p.id}">
    <header class="post-head">
      <a class="avatar" style="${gradVars(g)}" href="${esc(p.url)}" target="_blank" rel="noopener" aria-label="${esc(p.source)}"><span>${p.emoji}</span></a>
      <div class="post-meta">
        <div class="post-source">${esc(p.source)} <span class="dot">·</span> <span class="dot">practice</span></div>
        <div class="post-sub">${esc(host(p.url))}</div>
      </div>
    </header>
    <a class="post-media square" href="${esc(p.url)}" target="_blank" rel="noopener">
      <div class="post-card" style="${gradVars(g)}"><div class="emoji">${p.emoji}</div><div class="card-title">${esc(p.title)}</div><div class="card-source">${esc(p.cta)} →</div></div>
    </a>
    <div class="post-body">
      <div class="post-caption"><b>${esc(p.source)}</b> ${esc(p.summary)}</div>
      <div class="post-links"><a class="btn" href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.cta)}</a></div>
    </div>
  </article>`;
}

function renderCollection(kind) {
  const posts = kind === 'liked'
    ? state.feed.posts.filter((p) => state.likes.has(p.id))
    : [...state.saved.values()].reverse();
  const title = kind === 'liked' ? 'Posts you liked' : 'Saved';
  if (!posts.length) {
    return `<div class="empty"><div class="glyph">${kind === 'liked' ? '♡' : '🔖'}</div><h2>${kind === 'liked' ? 'No likes yet' : 'Nothing saved yet'}</h2><p>${kind === 'liked' ? 'Double-tap a post you enjoy.' : 'Tap the bookmark on a post to keep it past the next refresh.'}</p></div>`;
  }
  return `<div class="section-title">${title} · ${posts.length}</div><div class="feed">${posts.map((p) => renderPost(p)).join('')}</div>`;
}

function renderSearch() {
  const q = state.query.trim().toLowerCase();
  const posts = state.feed.posts.filter((p) => p.kind !== 'card' && (!q || `${p.title} ${p.summary} ${p.source} ${topicOf(p.topic).name}`.toLowerCase().includes(q)));
  return `<div class="search-bar"><input type="search" id="q" placeholder="Search your ${state.feed.posts.length} posts" value="${esc(state.query)}" autocomplete="off" autocorrect="off" autocapitalize="off"></div>
    ${posts.length ? '' : `<div class="empty"><h2>No results</h2><p>Nothing in this feed matches “${esc(state.query)}”.</p></div>`}
    <div class="grid">${posts.map((p) => {
      const t = topicOf(p.topic);
      return `<a class="tile" href="#home" data-action="jump" data-id="${p.id}" style="${gradVars(t)}">${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}<div class="tile-text"><span>${esc(p.title)}</span></div><span class="tile-emoji">${t.emoji}</span></a>`;
    }).join('')}</div>`;
}

function renderProfile() {
  const f = state.feed;
  const okByTopic = (id) => f.sources.ok.filter((s) => s.topic === id);
  const badByTopic = (id) => f.sources.failed.filter((s) => s.topic === id);
  const totalSources = f.sources.ok.length + f.sources.failed.length;
  return `<div class="profile">
    <div class="profile-head">
      <div class="profile-avatar"><div>🪴</div></div>
      <div class="stats">
        <div><b>${f.postCount ?? f.posts.length}</b><span>posts</span></div>
        <div><b>${f.topics.filter((t) => !t.wildcard).length}</b><span>interests</span></div>
        <div><b>${f.sources.ok.length}</b><span>sources</span></div>
      </div>
    </div>
    <p class="bio"><b>Finstagram</b>Only the stuff you actually want. Forty posts, then it stops.<br><small>Feed built ${longDate(f.generatedAt)} at ${new Date(f.generatedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}${totalSources !== f.sources.ok.length ? ` · ${f.sources.failed.length} source${f.sources.failed.length === 1 ? '' : 's'} didn't answer` : ''}</small></p>
    <ul class="interest-list">${f.topics.map((t) => `
      <li class="interest">
        <a class="avatar" href="#home" data-action="filter" data-topic="${t.id}" style="${gradVars(t)}"><span>${t.emoji}</span></a>
        <div><div class="name">${esc(t.name)}${t.wildcard ? ' <span class="wild-tag">🎲 wildcard</span>' : ''}</div><div class="detail">${t.wildcard ? `${esc(t.why || 'This build\'s surprise.')}<br>` : ''}${okByTopic(t.id).length} source${okByTopic(t.id).length === 1 ? '' : 's'} · ${t.available} recent item${t.available === 1 ? '' : 's'}${badByTopic(t.id).length ? ` · <span style="color:var(--like)">${badByTopic(t.id).length} unreachable</span>` : ''}</div></div>
        <div class="num">${t.count}</div>
      </li>`).join('')}</ul>
    <details class="sources"><summary>Sources (${totalSources})</summary><ul>
      ${f.sources.ok.map((s) => `<li><span class="ok">●</span><span class="url">${esc(s.name)} — ${esc(host(s.url))} (${s.items})</span></li>`).join('')}
      ${f.sources.failed.map((s) => `<li><span class="bad">●</span><span class="url">${esc(host(s.url))} — ${esc(s.error)}</span></li>`).join('')}
    </ul></details>
    <p class="howto">To add an interest, add a topic to <code>interests.json</code> and restart the server (or re-run <code>npm run build</code>). Each topic just needs a name, an emoji, a couple of colours and some RSS feeds.</p>
  </div>`;
}

/* ---------- interactions ---------- */
function postFromEl(el) {
  const art = el.closest('.post');
  if (!art) return null;
  const id = art.dataset.id;
  return state.feed.posts.find((p) => p.id === id) || state.saved.get(id) || null;
}

function toggleLike(p, { force } = {}) {
  const on = force ?? !state.likes.has(p.id);
  if (on) state.likes.add(p.id); else state.likes.delete(p.id);
  persist();
  const art = document.getElementById(`post-${p.id}`);
  if (!art) return;
  const btn = art.querySelector('.act.like');
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-pressed', String(on));
  let likes = art.querySelector('.post-likes');
  if (on && !likes) art.querySelector('.post-body').insertAdjacentHTML('afterbegin', '<div class="post-likes">Liked by you</div>');
  if (!on && likes) likes.remove();
  if (on) {
    const big = art.querySelector('.big-heart');
    big.classList.remove('pop');
    void big.offsetWidth;
    big.classList.add('pop');
  }
}

function toggleSave(p) {
  const on = !state.saved.has(p.id);
  if (on) state.saved.set(p.id, p); else state.saved.delete(p.id);
  persist();
  const art = document.getElementById(`post-${p.id}`);
  const btn = art?.querySelector('.act.save');
  btn?.classList.toggle('on', on);
  btn?.setAttribute('aria-pressed', String(on));
  toast(on ? 'Saved' : 'Removed from saved');
  if (state.view === 'saved') render(); else renderTabs();
}

async function share(p) {
  const data = { title: p.title, text: `${p.title} — ${p.source}`, url: p.url };
  try {
    if (navigator.share) { await navigator.share(data); return; }
    await navigator.clipboard.writeText(p.url);
    toast('Link copied');
  } catch (e) {
    if (e?.name !== 'AbortError') toast('Could not share');
  }
}

/* ---------- reader view ---------- */
// Articles are fetched by the server and boiled down to their body text, so
// they open here instead of on the source site with its consent wall and ads.
// The extracted HTML is untrusted: it is rebuilt through an allowlist below.

const READER_TAGS = {
  p: [], br: [], hr: [], h1: [], h2: [], h3: [], h4: [], h5: [], h6: [],
  ul: [], ol: ['start'], li: [], dl: [], dt: [], dd: [],
  blockquote: [], pre: [], code: [], em: [], strong: [], b: [], i: [], u: [], s: [], mark: [], small: [], sup: [], sub: [], q: [], cite: [], abbr: ['title'],
  a: ['href', 'title'], img: ['src', 'alt', 'width', 'height'],
  figure: [], figcaption: [], table: [], thead: [], tbody: [], tfoot: [], tr: [], th: ['colspan', 'rowspan'], td: ['colspan', 'rowspan'],
  time: ['datetime'], div: [], section: [], article: [], span: [],
};
const READER_DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'select', 'textarea', 'svg', 'math', 'noscript', 'template', 'link', 'meta', 'video', 'audio', 'canvas', 'nav', 'aside', 'footer', 'header']);

function safeUrl(value, base) {
  try {
    const u = new URL(value, base);
    return /^https?:$/.test(u.protocol) ? u.href : null;
  } catch { return null; }
}

function sanitizeNode(node, base) {
  if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.data);
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const tag = node.localName;
  if (READER_DROP.has(tag)) return null;
  const attrs = READER_TAGS[tag];
  const out = attrs ? document.createElement(tag) : document.createDocumentFragment();
  if (attrs) {
    for (const name of attrs) {
      let v = node.getAttribute(name);
      if (v == null) continue;
      if (name === 'href' || name === 'src') v = safeUrl(v, base);
      if (v != null) out.setAttribute(name, v);
    }
    if (tag === 'a') { out.target = '_blank'; out.rel = 'noopener noreferrer'; }
    if (tag === 'img') {
      if (!out.getAttribute('src')) return null;
      out.loading = 'lazy';
      out.decoding = 'async';
      out.referrerPolicy = 'no-referrer';
    }
  }
  for (const child of node.childNodes) {
    const c = sanitizeNode(child, base);
    if (c) out.append(c);
  }
  return out;
}

function sanitizeArticle(html, base) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const frag = document.createDocumentFragment();
  for (const n of doc.body.childNodes) {
    const c = sanitizeNode(n, base);
    if (c) frag.append(c);
  }
  return frag;
}

let readerPost = null;

function readerShell(p, body) {
  const t = topicOf(p.topic);
  return `<div class="reader-sheet">
    <header class="reader-bar">
      <button class="icon-btn" data-reader="close" aria-label="Close">${I.close}</button>
      <div class="reader-host">${esc(host(p.url))}</div>
      <a class="icon-btn" href="${esc(p.url)}" target="_blank" rel="noopener" aria-label="Open original" title="Open original">${I.link}</a>
    </header>
    <div class="reader-scroll"><article class="reader-article">
      <div class="reader-kicker" style="${gradVars(t)}"><span class="reader-dot"></span>${esc(p.source)} · ${t.emoji} ${esc(t.name)}</div>
      <h1 class="reader-title">${esc(p.title)}</h1>
      <div class="reader-byline" id="reader-byline">${[p.author ? esc(p.author) : null, longDate(p.publishedAt)].filter(Boolean).join(' · ')}</div>
      <div class="reader-body" id="reader-body">${body}</div>
      <div class="reader-foot"><a class="btn ghost" href="${esc(p.url)}" target="_blank" rel="noopener">Read on ${esc(host(p.url))}</a></div>
    </article></div>
  </div>`;
}

function readerSkeleton() {
  return `<div class="reader-skel">${['92%', '100%', '78%', '96%', '60%', '100%', '88%'].map((w) => `<div class="bar" style="width:${w}"></div>`).join('')}</div>`;
}

function readerFallback(p, why) {
  return `<div class="reader-fallback"><div class="glyph">🪟</div><h2>Couldn't open this one here</h2>
    <p>${esc(why)}. You can still read it on the site.</p>
    <a class="btn" href="${esc(p.url)}" target="_blank" rel="noopener">Read on ${esc(host(p.url))}</a></div>`;
}

async function openReader(p) {
  if (!readerPost) history.pushState({ reader: p.id }, '', location.href);
  readerPost = p;
  $reader.innerHTML = readerShell(p, readerSkeleton());
  $reader.hidden = false;
  document.body.classList.add('no-scroll');
  $reader.querySelector('[data-reader="close"]').focus({ preventScroll: true });

  const NO_SERVER = 'The reader needs the Finstagram server running';
  let article;
  try {
    const res = await fetch(`api/article?id=${encodeURIComponent(p.id)}&url=${encodeURIComponent(p.url)}`, { cache: 'no-store' });
    if (!/json/i.test(res.headers.get('content-type') || '')) throw new Error(NO_SERVER); // static host: no API behind it
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    article = data;
  } catch (e) {
    if (readerPost !== p) return;
    $reader.querySelector('#reader-body').innerHTML = readerFallback(p, e instanceof TypeError ? NO_SERVER : e.message);
    $reader.querySelector('.reader-foot').remove();
    return;
  }
  if (readerPost !== p) return;
  const body = $reader.querySelector('#reader-body');
  const frag = sanitizeArticle(article.content, article.url || p.url);
  if (p.image && !frag.querySelector('img')) {
    const hero = document.createElement('img');
    hero.src = p.image; hero.alt = ''; hero.className = 'reader-hero'; hero.referrerPolicy = 'no-referrer';
    frag.prepend(hero);
  }
  body.replaceChildren(frag);
  const minutes = Math.max(1, Math.round((article.length || 0) / 1100));
  const byline = [article.byline || p.author, longDate(p.publishedAt || article.publishedTime), `${minutes} min read`].filter(Boolean);
  $reader.querySelector('#reader-byline').textContent = byline.join(' · ');
}

function closeReader({ pop = true } = {}) {
  if (!readerPost) return;
  readerPost = null;
  $reader.hidden = true;
  $reader.innerHTML = '';
  document.body.classList.remove('no-scroll');
  if (pop && history.state?.reader) history.back();
}

$reader.addEventListener('click', (e) => {
  if (e.target === $reader || e.target.closest('[data-reader="close"]')) closeReader();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeReader(); });
window.addEventListener('popstate', () => closeReader({ pop: false }));

function open(p) {
  openReader(p);
}

let tapTimer = null;
let lastTapId = null;
function onMediaClick(e, p) {
  e.preventDefault();
  if (tapTimer && lastTapId === p.id) {
    clearTimeout(tapTimer);
    tapTimer = null;
    toggleLike(p, { force: true });
    return;
  }
  lastTapId = p.id;
  tapTimer = setTimeout(() => { tapTimer = null; open(p); }, 260);
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  if (action === 'reload') return loadFeed();
  if (action === 'refresh') { toast('Pulling fresh posts…'); return loadFeed({ refresh: true }); }
  if (action === 'filter') {
    e.preventDefault();
    const id = el.dataset.topic || null;
    state.topicFilter = id;
    if (id) { state.seenTopics.add(id); persist(); }
    go('home');
    return;
  }
  if (action === 'jump') {
    e.preventDefault();
    state.topicFilter = null;
    go('home');
    const art = document.getElementById(`post-${el.dataset.id}`);
    if (art) {
      art.scrollIntoView({ block: 'start' });
      window.scrollBy(0, -(document.querySelector('.topbar').offsetHeight));
      art.classList.add('flash');
    }
    return;
  }
  const p = postFromEl(el);
  if (!p) return;
  if (action === 'like') return toggleLike(p);
  if (action === 'save') return toggleSave(p);
  if (action === 'share') return share(p);
  if (action === 'open') { e.preventDefault(); return open(p); }
  if (action === 'media') return onMediaClick(e, p);
  if (action === 'expand') {
    state.expanded.add(p.id);
    el.previousElementSibling.classList.remove('clamped');
    el.remove();
    if (p.audio) el.closest('.post-body').querySelector('.post-caption').insertAdjacentHTML('afterend', `<div class="audio-wrap"><audio controls preload="none" src="${esc(p.audio)}"></audio></div>`);
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id !== 'q') return;
  state.query = e.target.value;
  const grid = $view.querySelector('.grid');
  const tmp = document.createElement('div');
  tmp.innerHTML = renderSearch();
  grid.replaceWith(tmp.querySelector('.grid'));
  $view.querySelector('.empty')?.remove();
  const empty = tmp.querySelector('.empty');
  if (empty) $view.querySelector('.search-bar').insertAdjacentElement('afterend', empty);
});

$refresh.addEventListener('click', () => { toast('Pulling fresh posts…'); loadFeed({ refresh: true }); });

document.querySelectorAll('.tab').forEach((t) => {
  const v = t.dataset.view;
  t.innerHTML = v === 'me' ? '<div class="me-ring"><div>🪴</div></div>' : I[{ home: 'home', search: 'search', liked: 'heart', saved: 'bookmark' }[v]];
});

function go(view) {
  const same = state.view === view;
  state.view = view;
  if (location.hash !== `#${view}`) history.replaceState(null, '', `#${view}`);
  render();
  window.scrollTo({ top: 0 });
  $view.querySelector('.story.active')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  if (view === 'search' && !same) $view.querySelector('#q')?.focus({ preventScroll: true });
}

window.addEventListener('hashchange', () => {
  const v = location.hash.replace('#', '') || 'home';
  if (['home', 'search', 'liked', 'saved', 'me'].includes(v)) go(v);
});

// Preview images: fade in when loaded, swap in the gradient card when broken.
document.addEventListener('load', (e) => {
  if (e.target.tagName === 'IMG' && e.target.closest('.post-media')) e.target.classList.add('loaded');
}, true);
document.addEventListener('error', (e) => {
  const img = e.target;
  if (img.tagName !== 'IMG') return;
  const media = img.closest('.post-media');
  const p = postFromEl(img);
  if (media && p) {
    media.classList.add('square');
    media.innerHTML = renderCard(p, topicOf(p.topic)) + `<div class="big-heart">${I.heartFill}</div>`;
  } else if (img.closest('.tile')) {
    img.remove();
  }
}, true);

state.view = ['home', 'search', 'liked', 'saved', 'me'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home';
loadFeed();
