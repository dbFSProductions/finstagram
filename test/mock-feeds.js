// A tiny local RSS/Atom server used by the tests (and handy for a demo when
// you're offline). Every feed is fake sample content — nothing here is real.
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const now = Date.now();
const hoursAgo = (h) => new Date(now - h * 36e5).toUTCString();
const isoHoursAgo = (h) => new Date(now - h * 36e5).toISOString();
let imgBase = '';
const PIC = (seed) => `${imgBase}/img/${seed}.png`;

// Placeholder "photo": a gradient with a big number, so layouts can be checked offline.
function placeholderSvg(seed) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1000"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},70%,55%)"/><stop offset="1" stop-color="hsl(${(h + 60) % 360},70%,35%)"/></linearGradient></defs><rect width="800" height="1000" fill="url(#g)"/><circle cx="400" cy="430" r="170" fill="rgba(255,255,255,0.18)"/><text x="400" y="470" text-anchor="middle" font-family="Helvetica, Arial" font-size="110" fill="#fff" opacity="0.9">${seed.slice(-2)}</text></svg>`;
}

const SAMPLE = {
  ai: {
    'MIT Technology Review': [
      ['A new class of small models is quietly beating the giants at planning', 'Researchers show that a 3B-parameter model trained on synthetic search traces can out-plan far larger systems on long-horizon tasks.', true],
      ['What happens when every lab agrees on a safety benchmark', 'Five frontier labs signed on to a shared evaluation suite. Here is what it measures and what it conveniently leaves out.', true],
      ['The chip shortage nobody is talking about', 'High-bandwidth memory, not GPUs, is now the bottleneck for training runs.', false],
    ],
    'Simon Willison': [
      ['Running a coding agent on a Raspberry Pi 5 for a week', 'Notes on latency, tool calls, and why the SD card was the real problem.', false],
      ['Prompt caching changed how I write tools', 'A long system prompt is now cheap; here is how that reshapes agent design.', false],
    ],
    'arXiv cs.AI': [
      ['Self-Verifying Reasoning Agents via Latent Program Synthesis', 'arXiv:2609.01234v1 Announce Type: new Abstract: We propose an agent architecture that verifies its own reasoning by synthesising and executing latent programs.', false, 'Jane Doe, Wei Chen'],
    ],
  },
  physics: {
    'Quanta Magazine': [
      ['Physicists find a loophole in the black hole information paradox', 'A new calculation using island formulas suggests information escapes earlier than anyone expected.', true],
      ['The strange geometry hiding inside string theory\'s extra dimensions', 'Calabi–Yau manifolds are getting a machine-learning makeover.', true],
    ],
    'Not Even Wrong': [
      ['This week\'s hype', 'Another round of press releases claims a test of quantum gravity. It is not.', false],
    ],
    'arXiv hep-th': [
      ['Holographic Entanglement in de Sitter Space', 'arXiv:2609.04567v1 Announce Type: new Abstract: We study entanglement entropy in a holographic dual of de Sitter space and find a new class of extremal surfaces.', false, 'A. Author, B. Author'],
    ],
  },
  philosophy: {
    'Aeon': [
      ['Wittgenstein\'s ladder: why the best philosophy teaches you to throw it away', 'On the Tractatus, silence, and what it means to be shown rather than told.', true],
      ['Spinoza on freedom without free will', 'For Spinoza, understanding necessity is the only freedom worth having.', true],
    ],
    'Daily Nous': [
      ['Philosophers on the ethics of talking to machines', 'A roundup of recent takes on whether politeness to a chatbot is a virtue or a category error.', false],
    ],
  },
  china: {
    'Warp, Weft, and Way': [
      ['Mencius on the sprouts of virtue, revisited', 'Is the sprout metaphor developmental or normative? A close reading of 2A6.', false],
      ['Zhuangzi and the usefulness of the useless tree', 'A discussion of chapter 1 and what it says about ambition.', true],
    ],
    'The China History Podcast': [
      ['The Warring States, part 3: Qin gets serious', 'Shang Yang\'s reforms and the machine that ate the other six states.', false, null, true],
    ],
  },
  zen: {
    'Tricycle': [
      ['Dogen\'s instructions for the cook', 'The Tenzo Kyokun is about rice. It is also about everything else.', true],
      ['Just sitting, again', 'A teacher answers the question every beginner asks: what am I supposed to be doing?', false],
    ],
  },
  electronics: {
    'Raspberry Pi': [
      ['Pico 2 gets a new SDK release with better PIO tooling', 'Version 2.2 of the SDK ships with improved debugging for programmable I/O state machines.', true],
      ['Build a bedside e-paper dashboard with a Pi Zero 2 W', 'Weather, calendar and a poem of the day, refreshed every hour, on 0.3 W.', true],
    ],
    'Arduino': [
      ['Six ways to make a UNO R4 sing', 'From square waves to a surprisingly decent wavetable synth.', true],
    ],
    'Daisy Forum': [
      ['Stereo shimmer reverb on Daisy Seed — code and schematic', 'Finally got the pitch shifter into the feedback loop without artefacts. Sharing everything.', false],
      ['Daisy Patch SM: reading a 16-way rotary cleanly', 'Debounce is not the problem; the ADC ladder is.', false],
    ],
    'Hackaday': [
      ['A Raspberry Pi guitar pedal that runs Neural Amp Modeler', 'Low-latency audio on a Pi 5 with a cheap codec HAT, and it sounds great.', true],
    ],
  },
  history: {
    'Following Hadrian': [
      ['Walking the Roman aqueduct of Segovia at dawn', 'One hundred and sixty-seven arches, no mortar, and the light doing something special.', true],
      ['Mérida: the best-preserved Roman theatre in Hispania', 'Emerita Augusta was founded for veterans of the Cantabrian Wars. The theatre still hosts plays.', true],
    ],
    'History Today': [
      ['Why empires overreach', 'From Rome to Britain, the same pattern repeats: the periphery becomes the point.', false],
    ],
    'The History of Byzantium': [
      ['Episode 300 — The end of the beginning', 'Looking back on three hundred episodes of Rome that refused to fall.', false, null, true],
    ],
  },
  language: {
    'Language Log': [
      ['Why Spanish kept the Latin "f" that French threw away', 'Farina, harina, farine: one consonant, three answers, and a lot of Basque in the middle.', true],
      ['Etymology corner: "salary" and the salt myth', 'Roman soldiers were not paid in salt. Here is what the word actually did.', false],
    ],
    'Etymonline': [
      ['Word of the week: "amateur"', 'From Latin amator, one who loves. The sneer came later.', true],
    ],
  },
  productivity: {
    'Cal Newport': [
      ['On the slow productivity of medieval scribes', 'A scriptorium produced one book a year and changed Europe. Notes on pace.', false],
      ['Do less, then do it properly', 'Why the to-do list should get shorter, not longer, as you get better.', true],
    ],
    'Oliver Burkeman': [
      ['The joy of missing out on the feed', 'Four thousand weeks, and none of them owed to an algorithm.', false],
    ],
  },
  guitar: {
    'Delicious Audio': [
      ['The 10 best fuzz pedals released this year', 'Germanium is back, silicon never left, and one of these is built on a Daisy Seed.', true],
      ['Chase Bliss just made a tape delay that forgets on purpose', 'The new pedal degrades its own memory. It is glorious and slightly upsetting.', true],
    ],
    'Pedal of the Day': [
      ['DIY: a Tube Screamer clone with a proper bass control', 'Vero layout, parts list, and why the stock circuit is so bright.', false],
    ],
  },
};

function rss(topic, source, items) {
  const feedSlug = slug(source);
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel><title>${source}</title><link>https://example.com/${feedSlug}</link>
${items.map(([title, desc, withImage, author, audio], i) => {
  const url = `https://example.com/${feedSlug}/${slug(title)}`;
  const seed = `${feedSlug}-${i}`;
  const hours = Math.round(((i + 1) * 7 + feedSlug.length * 3) % 160) + 1;
  return `<item><title><![CDATA[${title}]]></title><link>${url}</link><guid>${url}</guid>
<pubDate>${hoursAgo(hours)}</pubDate>${author ? `<dc:creator>${author}</dc:creator>` : ''}
<description><![CDATA[<p>${desc}</p>${withImage ? `<img src="${PIC(seed)}" width="800" height="1000">` : ''}]]></description>
${withImage ? `<media:content url="${PIC(seed)}" medium="image"/>` : ''}
${audio ? `<enclosure url="https://example.com/${feedSlug}/ep-${i}.mp3" type="audio/mpeg" length="12345"/>` : ''}
</item>`;
}).join('\n')}
</channel></rss>`;
}

function atom(topic, source, items) {
  const feedSlug = slug(source);
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>${source}</title><link href="https://example.com/${feedSlug}"/>
${items.map(([title, desc, withImage], i) => {
  const url = `https://example.com/${feedSlug}/${slug(title)}`;
  const author = items[i][3];
  return `<entry><title>${title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</title><link href="${url}"/><id>${url}</id><updated>${isoHoursAgo((i + 2) * 9)}</updated>${author ? `<author><name>${author}</name></author>` : ''}
<content type="html">&lt;p&gt;${desc.replace(/&/g, '&amp;').replace(/</g, '&lt;')}&lt;/p&gt;${withImage ? `&lt;img src="${PIC(feedSlug + i)}"&gt;` : ''}</content></entry>`;
}).join('\n')}
</feed>`;
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

export async function startMockFeeds() {
  const routes = new Map();
  const topics = [];
  let useAtom = false;
  const server = http.createServer((req, res) => {
    const p = req.url.split('?')[0];
    const img = p.match(/^\/img\/(.+)\.png$/);
    if (img) { res.writeHead(200, { 'content-type': 'image/svg+xml' }); return res.end(placeholderSvg(img[1])); }
    const body = routes.get(p);
    if (!body) { res.writeHead(404); return res.end('nope'); }
    res.writeHead(200, { 'content-type': 'application/rss+xml' });
    res.end(body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  imgBase = baseUrl;
  for (const [topicId, sources] of Object.entries(SAMPLE)) {
    const feeds = [];
    for (const [source, items] of Object.entries(sources)) {
      const p = `/${topicId}/${slug(source)}.xml`;
      routes.set(p, (useAtom = !useAtom) ? atom(topicId, source, items) : rss(topicId, source, items));
      feeds.push({ url: p, name: source });
    }
    feeds.push({ url: `/${topicId}/dead.xml`, name: 'Dead feed' }); // always 404s
    topics.push({ id: topicId, feeds });
  }

  // Real interests.json for names/emoji/weights, mock URLs for feeds.
  const real = JSON.parse(await fs.readFile(new URL('../interests.json', import.meta.url), 'utf8'));
  const cfg = {
    ...real,
    maxAgeDays: 30,
    topics: real.topics.map((t) => ({ ...t, feeds: (topics.find((m) => m.id === t.id)?.feeds || []).map((f) => ({ ...f, url: baseUrl + f.url })) })),
  };
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'finsta-'));
  const interestsFile = path.join(dir, 'interests.json');
  await fs.writeFile(interestsFile, JSON.stringify(cfg, null, 2));

  return { baseUrl, interestsFile, close: () => new Promise((r) => server.close(r)) };
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const { baseUrl, interestsFile } = await startMockFeeds();
  console.log(`Mock feeds at ${baseUrl}\nINTERESTS_FILE=${interestsFile}`);
}
