# Finstagram

An Instagram-looking feed of the things you actually care about, and nothing else.
It pulls real posts from RSS feeds for each of your interests, mixes them into
**exactly 40 posts**, and then stops. No infinite scroll. When you reach the end
you get the "You're all caught up" screen and your afternoon back.

Interests out of the box: AI, physics (string theory, quantum mechanics, relativity),
philosophy, ancient Chinese thought (Confucius, Laozi, Zhuangzi, the Warring States),
Zen, home electronics (Raspberry Pi, Daisy Seed, Arduino), history (Rome, Spain,
empires in general), guitar effects, language and etymology (Romance languages especially),
personal productivity and men's tailored fashion. Adding more is a JSON edit. Each
build also throws in one wildcard interest drawn from where those overlap, and a
card nudging you towards your Catalan practice app.

## Run it

```bash
npm install
npm start
```

Then open <http://localhost:3040> in Safari. The first load pulls every feed
(15 to 30 seconds), after which the feed is cached for 30 minutes. The refresh
button at the top right, or the button at the end of the feed, forces a fresh pull.

On an iPhone on the same Wi-Fi, open `http://<your-mac's-name>.local:3040`, tap
Share, then **Add to Home Screen**. It runs full screen like a real app, with
Safari's Web Share sheet wired to the paper-plane icon.

Options:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3040` | Port to listen on |
| `FEED_TTL_MINUTES` | `30` | How long a built feed is reused before re-pulling |
| `INTERESTS_FILE` | `./interests.json` | Alternative interests file |

## No server at all

`npm run build` writes `public/feed.json`. The `public/` folder is then a static
site: host it anywhere (GitHub Pages, a Raspberry Pi, a folder on your Mac) and
the app reads the JSON directly. The build also captures each post's article into
`public/articles/<id>.json`, so the reader view works on a static host too; a
page that couldn't be read at build time falls back to a link to the original site.
The included workflow in `.github/workflows/pages.yml` rebuilds the feed every two
hours and publishes to GitHub Pages, if you turn Pages on for the repo
(Settings → Pages → Source: GitHub Actions).

With no server there is nothing to pull on demand, so on the static site the
refresh button becomes **Check for new posts**: it fetches the latest built
`feed.json`, swaps it in if it's newer, and otherwise tells you when it was built
and roughly when the next build is due (the workflow passes its cron to the build
as `FEED_SCHEDULE`, so the two stay in step).

## Adding an interest

Everything lives in `interests.json`. A topic looks like this:

```json
{
  "id": "synths",
  "name": "Synths",
  "emoji": "🎛️",
  "gradient": ["#ff512f", "#dd2476"],
  "weight": 3,
  "boost": ["Eurorack", "Moog", "modular"],
  "feeds": [
    "https://example.com/feed.xml",
    { "url": "https://broad-site.com/feed/", "name": "Broad Site", "include": ["synth", "modular"] }
  ]
}
```

* `weight` is the topic's share of the 40 slots relative to the others.
* `boost` keywords push matching posts up within a topic.
* A feed can be a plain URL, or an object with a display `name` and an `include`
  list, which keeps only items mentioning one of those words. That's how a broad
  feed like Aeon or Hackaday gets narrowed to what you want.
* Topic order is priority order when the same article shows up in two topics.

Restart the server (or re-run `npm run build`) and the new interest appears in
the story row at the top. Feeds that don't answer are skipped and listed under
the Interests tab, so a dead URL never breaks the app.

## Practice cards and wildcards

Two more sections in `interests.json`, both optional:

**`cards`** are nudges towards another app. Each has a `url`, a `cta` and a list of
`messages`; every build picks one message and drops it into the feed as a card
near the top. The one shipped points at Xerra, the Catalan pronunciation trainer
from `listen-record-learn`, and its messages mention things you can only do over
there (road mode, level 2, favourites) so the itch has somewhere to go.

**`wildcards`** are interests that sit *between* two of your real ones, each with
`between: [id, id]` and a one-line `why`. Every build draws one at random and
gives it `slots` posts (one by default), labelled "Because you like X and Y",
so the feed has a small surprise in it each time. The shipped set was written by
looking at where the existing interests overlap: AI ∩ philosophy is minds and
machines, electronics ∩ guitar effects is synth DIY, Zen ∩ productivity is slow
living, and so on. Add your own the same way; a wildcard is just a topic with two
extra fields.

Both ride on top of the 40, not inside it.

## How the 40 are chosen

1. Every feed is fetched in parallel, items older than `maxAgeDays` are dropped,
   and duplicates (same URL or title) are removed.
2. Each item gets a score: newer is better, and `boost` keyword hits add to it.
3. The 40 slots are split between topics in proportion to `weight`, capped by
   how much each topic actually has.
4. Within a topic, sources take turns so one prolific blog can't hog the slots.
5. Topics are interleaved so neighbouring posts are about different things.
6. Posts without a picture get the article's Open Graph image; if there's none,
   they render as a typographic card in the topic's colours.

## What the buttons do

* **Double-tap** a post, or tap the heart, to like it. Likes are stored in the browser.
* **Bookmark** keeps a post past the next refresh. Saved posts live under the bookmark tab.
* **Paper plane** opens the iOS share sheet (or copies the link on desktop).
* **Speech bubble**, the picture, the title, or the ⋯ menu open the article in the
  built-in reader: the page is fetched (by the server, or at build time for the
  static site) and reduced to just the body text and pictures, so no cookie wall,
  no ad slots. The link icon at the top of the reader, or **Read on …** under a
  post, opens the original site instead.
* **Story circles** at the top filter the feed to one interest. Tap **All** to go back.
* **Search** shows the whole feed as a grid and filters it as you type.
* **Interests** shows every topic, how many posts it got, and which sources answered.

## Development

```bash
npm test        # unit tests plus an end-to-end run against a local mock feed server
npm run dev     # server with auto-restart on file changes
```

No build step and no front-end dependencies: `public/` is plain HTML, CSS and JS.
