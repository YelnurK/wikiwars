// Picks the start article (A) and the target article (B) for a round.
//
// Targets come from "pools": thousands of well-known articles per category,
// taken live from English Wikipedia's Vital articles lists, translated to the
// game language and cached on disk in ./cache. Built-in seeds are the backup.
//
// Easy / Medium: B from a pool, A found by walking BACKWARDS from B through
//   "What links here", so a route of at most 2 / 3 clicks is guaranteed.
// Hard: A and B are two famous articles from DIFFERENT categories
//   (e.g. Brown bear -> Elizabeth II). Long races, no guaranteed par.
// Impossible: A is a random article from anywhere, B from a pool.

const fs = require('fs');
const path = require('path');
const { CATEGORIES } = require('./seeds');

const LANGS = [
  { id: 'kk', label: 'Қазақша', english: 'Kazakh' },
  { id: 'ru', label: 'Русский', english: 'Russian' },
  { id: 'en', label: 'English', english: 'English' },
];

const DIFFICULTIES = [
  { id: 'easy', label: 'Easy', desc: 'Famous target, reachable in 2 clicks', mode: 'walk', steps: 2, finalTop: 0.35, midTop: 0.5, time: 240 },
  { id: 'medium', label: 'Medium', desc: 'Reachable in 3 clicks', mode: 'walk', steps: 3, finalTop: 0.6, midTop: 0.6, time: 360 },
  { id: 'hard', label: 'Hard', desc: 'Two famous articles from different topics', mode: 'cross', time: 600 },
  { id: 'impossible', label: 'Impossible', desc: 'Random start from anywhere in Wikipedia', mode: 'random', time: 900 },
];

const MIN_LEN = { en: 8000, ru: 12000, kk: 4000 };
const POOL_TTL = 14 * 24 * 3600 * 1000;
const CACHE_DIR = path.join(__dirname, 'cache');
const VITAL_ROOT = 'Wikipedia:Vital articles/Level/4/';

const BAD_TITLE = new RegExp([
  '^\\d', '^[IVXLC]+ (век|ғасыр|century)',
  '^(List|Lists|Outline|Index|Glossary|Timeline) of', '^Список', 'тізімі', '^Хронология',
  '\\((disambiguation|значения|айрық)',
  'ISBN', 'ISSN', 'Digital object identifier', 'Wikidata', 'Bibcode', 'PubMed', 'JSTOR', 'OCLC',
  'Integrated Authority File', 'Virtual International Authority', 'Library of Congress',
  'Международный стандартный', 'Цифровой идентификатор', 'Geographic coordinate', 'Coordinated Universal Time',
  '^UTC', 'Time zone', 'Часовой пояс', 'Всемирное координированное', 'Географические координаты',
].join('|'), 'i');

// Wikimedia asks every client to name itself and give a contact (User-Agent policy).
const CONTACT = process.env.WIKI_CONTACT || 'https://github.com/YelnurK/wikiwars';
const UA = `WikiWars/1.2 (${CONTACT}; two-player Wikipedia race game)`;

function wikiBase(lang) {
  return process.env.WIKI_BASE ? `${process.env.WIKI_BASE}/${lang}` : `https://${lang}.wikipedia.org`;
}

// ---------------- polite request queue ----------------
// Wikimedia's robot policy for clients without an account: ONE request at a time,
// fewer than 5 per second, and a 5-second pause after a request that took over 1 s.
// Every server-side call goes through this queue. Requests made while a game is
// waiting go first; background list-building (warm-up) waits its turn.

const { AsyncLocalStorage } = require('async_hooks');
const background = new AsyncLocalStorage();
const MIN_GAP = Number(process.env.WIKI_MIN_GAP_MS || 300);
const SLOW_MS = 1000, SLOW_PAUSE = 5000;
const queue = { high: [], low: [] };
let busy = false, readyAt = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const inBackground = fn => background.run(true, fn);

function schedule(fn) {
  return new Promise((resolve, reject) => {
    (background.getStore() ? queue.low : queue.high).push({ fn, resolve, reject });
    pump();
  });
}
async function pump() {
  if (busy) return;
  const job = queue.high.shift() || queue.low.shift();
  if (!job) return;
  busy = true;
  const wait = readyAt - Date.now();
  if (wait > 0) await sleep(wait);
  const t0 = Date.now();
  try { job.resolve(await job.fn()); } catch (e) { job.reject(e); }
  const took = Date.now() - t0;
  readyAt = Math.max(readyAt, Date.now() + (took > SLOW_MS ? SLOW_PAUSE : MIN_GAP));
  busy = false;
  pump();
}
function pauseAll(ms) { readyAt = Math.max(readyAt, Date.now() + ms); }

class WikiBusy extends Error {}

async function api(lang, params) {
  const url = new URL(wikiBase(lang) + '/w/api.php');
  const all = { format: 'json', formatversion: '2', maxlag: 5, ...params };
  for (const [k, v] of Object.entries(all)) url.searchParams.set(k, String(v));
  const backoff = [2000, 5000, 10000, 20000];
  let lastErr;
  for (let attempt = 0; attempt <= backoff.length; attempt++) {
    try {
      return await schedule(async () => {
        const res = await fetch(url, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA }, signal: AbortSignal.timeout(20000) });
        if (res.status === 429 || res.status === 503) {
          const ra = Number(res.headers.get('retry-after'));
          const ms = Math.min(60000, Math.max(backoff[Math.min(attempt, backoff.length - 1)], ra > 0 ? ra * 1000 : 0));
          pauseAll(ms); // everyone waits, not only this request
          throw new WikiBusy(`Wikipedia answered ${res.status}`);
        }
        if (!res.ok) throw new Error(`Wikipedia answered ${res.status}`);
        const data = await res.json();
        if (data.error && data.error.code === 'maxlag') { pauseAll(5000); throw new WikiBusy('Wikipedia is lagging'); }
        if (data.error) { const e = new Error(data.error.info || data.error.code); e.final = true; throw e; }
        return data;
      });
    } catch (e) {
      lastErr = e;
      if (e.final) throw e;
      if (!(e instanceof WikiBusy)) await sleep(1000 * (attempt + 1)); // network hiccup
    }
  }
  if (lastErr instanceof WikiBusy) {
    throw new WikiBusy('Wikipedia is limiting requests right now. Wait a minute and press Start again.');
  }
  throw lastErr;
}

const rand = n => Math.floor(Math.random() * n);
const pickOne = arr => arr[rand(arr.length)];
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function pickTop(cands, frac) {
  const sorted = cands.slice().sort((a, b) => b.length - a.length);
  const n = Math.max(Math.min(5, sorted.length), Math.ceil(sorted.length * frac));
  return pickOne(sorted.slice(0, n));
}
function goodPage(p, minLen) {
  return p && !p.missing && !p.invalid && p.ns === 0 && !(p.pageprops && 'disambiguation' in p.pageprops)
    && !BAD_TITLE.test(p.title) && (p.length || 0) >= minLen;
}
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

// ---------------- target pools ----------------

// English titles from one Vital-articles source: { page, sections?, notSections? }
const vitalCache = new Map();
function vitalTitles(src) {
  const key = JSON.stringify([src.page, String(src.sections || ''), String(src.notSections || '')]);
  if (!vitalCache.has(key)) {
    const p = (async () => {
      const page = VITAL_ROOT + src.page;
      const titles = new Set();
      const addLinks = async (pageTitle, section) => {
        const data = await api('en', { action: 'parse', page: pageTitle, prop: 'links', redirects: 1, ...(section != null ? { section } : {}) });
        for (const l of data.parse.links || []) {
          const t = l.title || l['*'];
          if (l.ns === 0 && l.exists !== false && !('missing' in l) && t && !BAD_TITLE.test(t)) titles.add(t);
        }
      };
      let picked = [];
      if (src.sections) {
        const sec = await api('en', { action: 'parse', page, prop: 'sections', redirects: 1 });
        let takenLevel = null;
        for (const s of sec.parse.sections || []) {
          const lvl = Number(s.toclevel) || 1;
          if (takenLevel != null && lvl > takenLevel) continue; // inside a section we already take whole
          takenLevel = null;
          const line = String(s.line || '').replace(/<[^>]+>/g, '');
          if (src.sections.test(line) && !(src.notSections && src.notSections.test(line))) {
            picked.push(s); takenLevel = lvl;
          }
        }
      }
      if (src.sections && picked.length) {
        await mapLimit(picked, 3, s => {
          const idx = String(s.index);
          if (idx.startsWith('T-')) return addLinks(s.fromtitle || page, idx.slice(2));
          return addLinks(page, idx);
        });
      }
      if (titles.size < 30) await addLinks(page, null); // section names changed? take the whole topic page
      return [...titles];
    })();
    vitalCache.set(key, p);
    p.catch(() => vitalCache.delete(key));
  }
  return vitalCache.get(key);
}

const langCache = new Map(); // `${lang}|${enTitle}` -> translated title or null
async function translate(enTitles, lang) {
  if (lang === 'en') return enTitles.slice();
  const todo = enTitles.filter(t => !langCache.has(`${lang}|${t}`));
  const batches = [];
  for (let i = 0; i < todo.length; i += 50) batches.push(todo.slice(i, i + 50));
  await mapLimit(batches, 4, async batch => {
    const data = await api('en', { action: 'query', titles: batch.join('|'), redirects: 1, prop: 'langlinks', lllang: lang, lllimit: 'max' });
    const q = data.query || {};
    const back = new Map(); // final title -> original titles
    const follow = t => {
      let x = t;
      for (const n of q.normalized || []) if (n.from === x) x = n.to;
      for (const r of q.redirects || []) if (r.from === x) x = r.to;
      return x;
    };
    for (const t of batch) { const f = follow(t); if (!back.has(f)) back.set(f, []); back.get(f).push(t); }
    for (const t of batch) langCache.set(`${lang}|${t}`, null);
    for (const p of q.pages || []) {
      const ll = (p.langlinks || []).find(l => l.lang === lang);
      const tr = ll ? (ll.title || ll['*']) : null;
      for (const orig of back.get(p.title) || []) langCache.set(`${lang}|${orig}`, tr);
    }
  });
  return [...new Set(enTitles.map(t => langCache.get(`${lang}|${t}`)).filter(t => t && !BAD_TITLE.test(t)))];
}

function readDisk(lang, catId) {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, `${lang}-${catId}.json`), 'utf8'));
    if (Array.isArray(d.titles) && d.titles.length) return d;
  } catch (_) { /* no cache yet */ }
  return null;
}
function writeDisk(lang, catId, titles, source) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(path.join(CACHE_DIR, `${lang}-${catId}.json`), JSON.stringify({ at: Date.now(), source, titles }));
  } catch (e) { console.warn('[cache] could not write', e.message); }
}

const poolMem = new Map();    // key -> { at, titles, source }
const poolBuilds = new Map(); // key -> Promise
function ttlOf(entry, catId) {
  // A backup-only list for a category that normally comes from Wikipedia is retried after an hour.
  const cat = CATEGORIES.find(c => c.id === catId);
  return entry.source === 'seeds' && cat && cat.vital ? 3600 * 1000 : POOL_TTL;
}
const refreshInBackground = (lang, catId) => inBackground(() => buildPool(lang, catId)).catch(() => {});

// fast = a game is waiting: never wait for a full build (hundreds of requests);
// use the category's built-in list now and let the full one load in the background.
async function poolFor(lang, catId, { fast = false } = {}) {
  const key = `${lang}:${catId}`;
  const mem = poolMem.get(key);
  if (mem && Date.now() - mem.at < ttlOf(mem, catId)) return mem.titles;
  if (mem) { refreshInBackground(lang, catId); return mem.titles; }
  const disk = readDisk(lang, catId);
  if (disk) {
    poolMem.set(key, disk);
    if (Date.now() - disk.at >= ttlOf(disk, catId)) refreshInBackground(lang, catId); // stale: use old list now
    return disk.titles;
  }
  if (!fast) return buildPool(lang, catId);
  refreshInBackground(lang, catId);
  return seedPool(lang, catId);
}

const seedMem = new Map();
async function seedPool(lang, catId) {
  const key = `${lang}:${catId}`;
  if (seedMem.has(key)) return seedMem.get(key);
  const cat = CATEGORIES.find(c => c.id === catId);
  const titles = cat ? await translate(cat.seeds, lang) : [];
  if (titles.length) seedMem.set(key, titles);
  return titles;
}
function buildPool(lang, catId) {
  const key = `${lang}:${catId}`;
  if (poolBuilds.has(key)) return poolBuilds.get(key);
  const p = (async () => {
    const cat = CATEGORIES.find(c => c.id === catId);
    if (!cat) return [];
    let en = [];
    let source = 'seeds';
    if (cat.vital) {
      try {
        const lists = await Promise.all(cat.vital.map(vitalTitles));
        en = [...new Set(lists.flat())];
        source = 'vital';
      } catch (e) {
        console.warn(`[pool ${key}] Vital articles unavailable (${e.message}); using built-in list`);
      }
    }
    en = [...new Set([...en, ...cat.seeds])];
    let titles = await translate(en, lang);
    if (!titles.length) throw new Error(`No ${cat.label} articles found in this language`);
    const entry = { at: Date.now(), titles, source };
    poolMem.set(key, entry);
    writeDisk(lang, catId, titles, source);
    console.log(`[pool ${key}] ${titles.length} targets (${source})`);
    return titles;
  })();
  poolBuilds.set(key, p);
  p.finally(() => poolBuilds.delete(key)).catch(() => {});
  return p;
}

// Prepare pools in the background so "Start race" is fast.
// Runs at low priority, one category after another; a game in progress is never slowed.
const warming = new Set();
function warmUp(settings) {
  const cats = (settings.categories && settings.categories.length ? settings.categories : CATEGORIES.map(c => c.id));
  const key = `${settings.lang}|${cats.join(',')}`;
  if (warming.has(key)) return;
  warming.add(key);
  inBackground(async () => {
    for (const c of cats) {
      try { await poolFor(settings.lang, c); } catch (e) { console.warn(`[warm ${settings.lang}:${c}]`, e.message); }
    }
  }).finally(() => warming.delete(key));
}

// ---------------- Wikipedia helpers ----------------

async function backNeighbors(lang, title, minLen) {
  const out = [];
  let cont = {};
  for (let page = 0; page < 2; page++) {
    const data = await api(lang, {
      action: 'query', generator: 'backlinks', gbltitle: title, gblnamespace: 0, gbllimit: 'max',
      gblfilterredir: 'nonredirects', prop: 'info|pageprops', ppprop: 'disambiguation', ...cont,
    });
    out.push(...((data.query && data.query.pages) || []));
    if (!data.continue || !data.continue.gblcontinue || out.length >= 600) break;
    cont = { gblcontinue: data.continue.gblcontinue, continue: data.continue.continue };
  }
  let good = out.filter(p => goodPage(p, minLen));
  if (good.length < 3) good = out.filter(p => goodPage(p, Math.floor(minLen / 3)));
  return { good, total: out.length };
}

async function linksDirectly(lang, from, to) {
  const data = await api(lang, { action: 'query', titles: from, prop: 'links', pltitles: to, plnamespace: 0, redirects: 1 });
  const p = (data.query.pages || [])[0];
  return !!(p && p.links && p.links.length);
}

async function pageInfo(lang, title) {
  const data = await api(lang, { action: 'query', titles: title, redirects: 1, prop: 'info|pageprops', ppprop: 'disambiguation' });
  const p = (data.query.pages || [])[0];
  return p && !p.missing && !(p.pageprops && 'disambiguation' in p.pageprops) ? p : null;
}

async function backWalk(lang, target, diff, avoid) {
  const minLen = MIN_LEN[lang] || 6000;
  const used = new Set([target, ...avoid]);
  const chain = [target];
  let cur = target;
  for (let i = 0; i < diff.steps; i++) {
    const { good } = await backNeighbors(lang, cur, minLen);
    const cands = good.filter(p => !used.has(p.title));
    if (!cands.length) return null;
    const next = pickTop(cands, i === diff.steps - 1 ? diff.finalTop : diff.midTop);
    used.add(next.title);
    chain.unshift(next.title);
    cur = next.title;
  }
  return chain;
}

async function randomGoodArticle(lang, minLen, avoid) {
  for (let tries = 0; tries < 6; tries++) {
    const data = await api(lang, {
      action: 'query', generator: 'random', grnnamespace: 0, grnlimit: 30, prop: 'info|pageprops', ppprop: 'disambiguation',
    });
    const pages = ((data.query && data.query.pages) || []).filter(p => !p.redirect && goodPage(p, minLen) && !avoid.has(p.title));
    if (pages.length) return pickOne(pages).title;
  }
  return null;
}

// Pick a well-known article from one of `cats`, resolved to its real title.
async function pickFromPools(lang, cats, avoid) {
  for (let tries = 0; tries < 10; tries++) {
    const catId = cats[tries % cats.length];
    let pool;
    try { pool = await poolFor(lang, catId, { fast: true }); } catch (e) {
      if (e instanceof WikiBusy) throw e; console.warn(`[pool ${lang}:${catId}]`, e.message); continue; }
    const options = pool.filter(t => !avoid.has(t));
    if (!options.length) continue;
    const info = await pageInfo(lang, pickOne(options));
    if (!info || avoid.has(info.title) || BAD_TITLE.test(info.title)) continue;
    return { title: info.title, catId, length: info.length || 0 };
  }
  return null;
}

// ---------------- generation ----------------

async function generatePair(settings, usedTargets = new Set()) {
  const { lang } = settings;
  const diff = DIFFICULTIES.find(d => d.id === settings.difficulty) || DIFFICULTIES[1];
  const allCats = CATEGORIES.map(c => c.id);
  const chosen = settings.categories && settings.categories.length ? settings.categories : allCats;
  const minLen = MIN_LEN[lang] || 6000;

  let lastErr = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const pair = await tryPair(lang, diff, chosen, allCats, minLen, usedTargets);
      if (pair) return pair;
    } catch (e) {
      if (e instanceof WikiBusy) throw e; // already waited and retried; don't hammer Wikipedia
      lastErr = e;
      console.warn('[generate] attempt failed:', e.message);
    }
  }
  throw new Error(lastErr ? lastErr.message : 'Wikipedia did not give us a good pair of articles. Try again or pick more categories.');
}

async function tryPair(lang, diff, chosen, allCats, minLen, usedTargets) {
  const cats = shuffle(chosen);
  const target = await pickFromPools(lang, cats, usedTargets);
  if (!target) return null;

  if (diff.mode === 'walk') {
    const chain = await backWalk(lang, target.title, diff, usedTargets);
    if (!chain) return null;
    if (await linksDirectly(lang, chain[0], target.title)) return null;
    return { start: chain[0], target: target.title, par: diff.steps, route: chain, category: target.catId, time: diff.time };
  }

  let start = null;
  if (diff.mode === 'cross') {
    // Prefer a different topic for the start: the more distant, the longer the race.
    const others = shuffle(chosen.filter(c => c !== target.catId));
    const pool = others.length ? others : shuffle(allCats.filter(c => c !== target.catId));
    const s = await pickFromPools(lang, pool, new Set([...usedTargets, target.title]));
    start = s && s.title;
  } else {
    start = await randomGoodArticle(lang, minLen, new Set([...usedTargets, target.title]));
  }
  if (!start || start === target.title) return null;
  if (await linksDirectly(lang, start, target.title)) return null;
  return { start, target: target.title, par: null, route: null, category: target.catId, time: diff.time };
}

module.exports = { generatePair, warmUp, poolFor, LANGS, DIFFICULTIES, CATEGORIES, wikiBase };
