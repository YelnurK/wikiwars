# WikiWars

Two players race from article **A** to article **B** using only the blue links inside Wikipedia,
while sabotaging each other with Blur, Blackout and Rewind.

## Run it

1. Install Node.js 18 or newer (https://nodejs.org). No `npm install` is needed: there are no dependencies.
2. Double-click `start.bat` (Windows) or run `node server.js` in this folder.
3. Open http://localhost:3000.

The console also prints a `Same Wi-Fi` address such as `http://192.168.1.23:3000`.
Your friend opens that address on their device, clicks **Join with code** and types the room code.
To play over the internet, deploy the folder to any Node host (Render, Railway, Fly.io…); it reads `PORT` from the environment.

## How it works

| Piece | File |
| --- | --- |
| Rooms, 6-letter codes, live updates (Server-Sent Events), abilities, timers | `server.js` |
| Picking A and B per category, language and difficulty, target cache | `generator.js` |
| Categories and built-in backup lists (edit freely) | `seeds.js` |
| Interface, Wikipedia rendering, effects | `public/` |

**Picking articles.** Targets come from English Wikipedia's *Vital articles* lists (about 10,000 of the most
important articles), split into 18 categories: rulers and leaders, historical events, scientists, writers and
artists, philosophers, sports stars, countries and cities, mountains and rivers, animals and plants, science,
space, technology, art and films, food, sports and games, religion and mythology, society, and Kazakhstan.
Titles are translated to Kazakh or Russian through Wikipedia's language links and cached in `cache/` for two
weeks, so the first game in a new language takes a few seconds longer. If Wikipedia's lists can't be loaded,
the built-in lists in `seeds.js` are used and retried an hour later.

**Wikipedia's request limits.** Wikimedia lets anonymous clients make one request at a time and fewer than
five per second. The server sends every Wikipedia request through one queue that follows those limits,
waits out a `429 Too Many Requests` answer and then tries again, and serves a waiting game before background
list-building. A new server starts rounds from the built-in lists right away while the full lists load in
the background, which takes a few minutes. Set `WIKI_CONTACT` to your own URL or email to change the contact
in the `User-Agent` header.

| Difficulty | Start → target | Time |
| --- | --- | --- |
| Easy | Route of at most 2 clicks guaranteed | 4 min |
| Medium | Route of at most 3 clicks guaranteed | 6 min |
| Hard | Two famous articles from different categories (e.g. Brown bear → Elizabeth II) | 10 min |
| Impossible | Random article from anywhere → target from your categories | 15 min |

**Abilities** (tuning lives at the top of `server.js`):

| Ability | Effect | Charges |
| --- | --- | --- |
| Blur | Opponent's page is blurred for 2.5 s | 2 |
| Blackout | Opponent's page flickers black every 0.5 s for 3 s | 2 |
| Rewind | Opponent is sent back two links in their path | 1 |

There's an 8-second cooldown between any two abilities. Keys 1, 2 and 3 trigger them.

Rooms live in memory, so restarting the server clears them.
