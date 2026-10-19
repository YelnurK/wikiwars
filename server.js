// WikiWars server. No dependencies: run `node server.js` (Node 18+).
// Rooms live in memory; players get live updates over Server-Sent Events.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { generatePair, warmUp, LANGS, DIFFICULTIES, CATEGORIES } = require('./generator');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');

// ---- Game tuning ----
const ABILITIES = {
  blur: { label: 'Blur', charges: 2, duration: 2500 },
  blackout: { label: 'Blackout', charges: 2, duration: 3000, flicker: 500 },
  rewind: { label: 'Rewind', charges: 1, steps: 2 },
};
const ABILITY_COOLDOWN = 8000;   // ms between any two abilities from the same player
const COUNTDOWN = 4000;          // ms between "pages picked" and "GO"
const FORFEIT_AFTER = 45000;     // ms a player may be disconnected mid-race
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I / O, they look like 1 / 0

const rooms = new Map();

// ---------- helpers ----------
const now = () => Date.now();
const norm = t => {
  const s = String(t || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};
function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 6; i++) c += CODE_LETTERS[crypto.randomInt(CODE_LETTERS.length)];
    if (!rooms.has(c)) return c;
  }
}
const newId = () => crypto.randomBytes(6).toString('hex');
const newToken = () => crypto.randomBytes(18).toString('hex');
const cleanName = n => String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20);

function validSettings(s, fallback) {
  const out = { ...(fallback || { lang: 'kk', categories: CATEGORIES.map(c => c.id), difficulty: 'medium' }) };
  if (s && LANGS.some(l => l.id === s.lang)) out.lang = s.lang;
  if (s && DIFFICULTIES.some(d => d.id === s.difficulty)) out.difficulty = s.difficulty;
  if (s && Array.isArray(s.categories)) {
    const cats = s.categories.filter(c => CATEGORIES.some(k => k.id === c));
    if (cats.length) out.categories = [...new Set(cats)];
  }
  return out;
}

function makePlayer(name, host) {
  return {
    id: newId(), token: newToken(), name, host, connected: false, disconnectedAt: now(),
    path: [], clicks: 0, navSeq: 0, charges: {}, cooldownUntil: 0, wins: 0,
  };
}

function snapshot(room) {
  return {
    code: room.code,
    phase: room.phase,
    settings: room.settings,
    error: room.error || null,
    players: room.players.map(p => ({
      id: p.id, name: p.name, host: p.host, connected: p.connected, path: p.path, clicks: p.clicks,
      navSeq: p.navSeq, charges: p.charges, cooldownUntil: p.cooldownUntil, wins: p.wins,
    })),
    round: room.round && {
      start: room.round.start, target: room.round.target, par: room.round.par, category: room.round.category,
      startsAt: room.round.startsAt, endsAt: room.round.endsAt, number: room.round.number,
      route: room.phase === 'finished' ? room.round.route : null,
    },
    result: room.result,
    serverNow: now(),
  };
}

function send(res, event, data) {
  try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch (_) { /* closed */ }
}
function broadcast(room) {
  room.lastActive = now();
  const snap = snapshot(room);
  for (const res of room.clients.values()) send(res, 'state', snap);
}
function emit(room, event, data, onlyTo) {
  for (const [pid, res] of room.clients) if (!onlyTo || onlyTo === pid) send(res, event, data);
}

function opponentOf(room, player) { return room.players.find(p => p.id !== player.id); }

function clearTimers(room) {
  for (const t of room.timers) clearTimeout(t);
  room.timers = [];
}

function finishRound(room, winner, reason) {
  if (room.phase !== 'playing' && room.phase !== 'countdown') return;
  clearTimers(room);
  room.phase = 'finished';
  if (winner) winner.wins++;
  room.result = {
    winnerId: winner ? winner.id : null,
    reason, // 'reached' | 'timeout' | 'forfeit'
    durationMs: Math.max(0, now() - room.round.startsAt),
  };
  broadcast(room);
}

async function startRound(room) {
  clearTimers(room);
  room.phase = 'generating';
  room.error = null;
  room.result = null;
  const token = room.genToken = newId();
  broadcast(room);
  try {
    const pair = await generatePair(room.settings, room.usedTargets);
    if (room.genToken !== token || room.phase !== 'generating') return;
    room.usedTargets.add(pair.target);
    const t = now();
    room.round = {
      number: (room.round ? room.round.number : 0) + 1,
      start: pair.start, target: pair.target, par: pair.par, route: pair.route, category: pair.category,
      startsAt: t + COUNTDOWN, endsAt: t + COUNTDOWN + pair.time * 1000,
    };
    for (const p of room.players) {
      p.path = [pair.start];
      p.clicks = 0;
      p.navSeq++;
      p.cooldownUntil = 0;
      p.charges = Object.fromEntries(Object.entries(ABILITIES).map(([k, a]) => [k, a.charges]));
    }
    room.phase = 'countdown';
    room.timers.push(setTimeout(() => { if (room.phase === 'countdown') { room.phase = 'playing'; broadcast(room); } }, COUNTDOWN));
    room.timers.push(setTimeout(() => finishRound(room, null, 'timeout'), room.round.endsAt - t));
    broadcast(room);
  } catch (e) {
    if (room.genToken !== token) return;
    console.error('[generate]', e.message);
    room.phase = 'lobby';
    room.error = `Couldn't pick articles: ${e.message}`;
    broadcast(room);
  }
}

// ---------- actions ----------
function handleAction(room, player, body) {
  const type = body.type;
  const isHost = player.host;

  if (type === 'settings') {
    if (!isHost) return { error: 'Only the host can change settings.' };
    if (!['lobby', 'finished'].includes(room.phase)) return { error: 'Not now.' };
    room.settings = validSettings(body.settings, room.settings);
    room.error = null;
    warmUp(room.settings);
    broadcast(room);
    return { ok: true };
  }

  if (type === 'start') {
    if (!isHost) return { error: 'Only the host can start.' };
    if (!['lobby', 'finished'].includes(room.phase)) return { error: 'A round is already running.' };
    if (room.players.length < 2) return { error: 'Wait for a second player to join.' };
    startRound(room);
    return { ok: true };
  }

  if (type === 'toLobby') {
    if (!isHost) return { error: 'Only the host can do that.' };
    if (room.phase !== 'finished') return { error: 'Not now.' };
    room.phase = 'lobby';
    broadcast(room);
    return { ok: true };
  }

  if (type === 'navigate') {
    if (room.phase !== 'playing' && !(room.phase === 'countdown' && now() >= room.round.startsAt)) return { error: 'The race is not running.' };
    const title = norm(body.title);
    const current = player.path[player.path.length - 1];
    if (!title) return { error: 'Bad link.' };
    if (norm(body.from) !== norm(current)) return { stale: true, navSeq: player.navSeq, current };
    if (title === norm(current)) return { ok: true, navSeq: player.navSeq };
    player.path.push(title);
    player.clicks++;
    player.navSeq++;
    if (title === norm(room.round.target)) {
      finishRound(room, player, 'reached');
    } else {
      broadcast(room);
    }
    return { ok: true, navSeq: player.navSeq };
  }

  if (type === 'ability') {
    const def = ABILITIES[body.kind];
    if (!def) return { error: 'Unknown ability.' };
    if (room.phase !== 'playing') return { error: 'Abilities work only during the race.' };
    if (!(player.charges[body.kind] > 0)) return { error: `No ${def.label} charges left.` };
    if (now() < player.cooldownUntil) return { error: 'Abilities are cooling down.' };
    const opp = opponentOf(room, player);
    if (!opp) return { error: 'No opponent.' };
    if (body.kind === 'rewind') {
      if (opp.path.length <= 1) return { error: 'Your rival is still on the start page.' };
      opp.path = opp.path.slice(0, Math.max(1, opp.path.length - def.steps));
      opp.navSeq++;
    }
    player.charges[body.kind]--;
    player.cooldownUntil = now() + ABILITY_COOLDOWN;
    emit(room, 'fx', { kind: body.kind, from: player.id, to: opp.id, duration: def.duration || 0, flicker: def.flicker || 0, at: now() });
    broadcast(room);
    return { ok: true };
  }

  if (type === 'scroll') {
    const opp = opponentOf(room, player);
    const ratio = Math.min(1, Math.max(0, Number(body.ratio) || 0));
    if (opp) emit(room, 'scroll', { id: player.id, ratio, navSeq: player.navSeq }, opp.id);
    return { ok: true };
  }

  if (type === 'leave') {
    removePlayer(room, player, 'left');
    return { ok: true };
  }

  return { error: 'Unknown action.' };
}

function removePlayer(room, player) {
  const res = room.clients.get(player.id);
  if (res) { room.clients.delete(player.id); try { res.end(); } catch (_) { /* ignore */ } }
  room.players = room.players.filter(p => p.id !== player.id);
  if (!room.players.length) { clearTimers(room); rooms.delete(room.code); return; }
  if (player.host) room.players[0].host = true;
  if (room.phase === 'playing' || room.phase === 'countdown') finishRound(room, room.players[0], 'forfeit');
  else if (room.phase === 'generating') { room.genToken = null; room.phase = 'lobby'; }
  broadcast(room);
}

// Sweep: forfeits for long disconnects, cleanup of idle rooms.
setInterval(() => {
  const t = now();
  for (const room of rooms.values()) {
    for (const p of room.players) {
      if (p.connected) continue;
      const gone = t - p.disconnectedAt;
      if ((room.phase === 'playing' || room.phase === 'countdown') && gone > FORFEIT_AFTER) {
        const opp = opponentOf(room, p);
        if (opp && opp.connected) finishRound(room, opp, 'forfeit');
      }
      if (room.phase !== 'playing' && gone > 10 * 60000) removePlayer(room, p);
    }
    if (rooms.has(room.code) && room.players.every(p => !p.connected) && t - room.lastActive > 30 * 60000) {
      clearTimers(room);
      rooms.delete(room.code);
    }
  }
}, 5000).unref();

// ---------- HTTP ----------
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 20000) { reject(new Error('too big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function auth(code, token) {
  const room = rooms.get(String(code || '').toUpperCase());
  if (!room) return {};
  const player = room.players.find(p => p.token === token);
  return { room, player };
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) {
      // Unknown paths fall back to the app (e.g. shared links like /?room=ABCDEF)
      return fs.readFile(path.join(PUBLIC, 'index.html'), (e2, html) => {
        if (e2) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': MIME['.html'] }); res.end(html);
      });
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': path.extname(file) === '.woff2' ? 'public, max-age=604800' : 'no-cache' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/api/meta' && req.method === 'GET') {
      return json(res, 200, {
        langs: LANGS, difficulties: DIFFICULTIES.map(({ id, label, desc, time, steps }) => ({ id, label, desc, time, steps })),
        categories: CATEGORIES.map(({ id, label }) => ({ id, label })), abilities: ABILITIES, abilityCooldown: ABILITY_COOLDOWN,
        wikiBase: process.env.WIKI_BASE || null,
      });
    }

    if (p === '/api/create' && req.method === 'POST') {
      const body = await readBody(req);
      const name = cleanName(body.name);
      if (!name) return json(res, 400, { error: 'Enter your name.' });
      const code = newCode();
      const host = makePlayer(name, true);
      const room = {
        code, phase: 'lobby', settings: validSettings(body.settings), players: [host], clients: new Map(),
        timers: [], round: null, result: null, usedTargets: new Set(), lastActive: now(), error: null,
      };
      rooms.set(code, room);
      warmUp(room.settings);
      console.log(`[room ${code}] created by ${name}`);
      return json(res, 200, { code, token: host.token, playerId: host.id });
    }

    if (p === '/api/join' && req.method === 'POST') {
      const body = await readBody(req);
      const name = cleanName(body.name);
      const code = String(body.code || '').toUpperCase().replace(/[^A-Z]/g, '');
      if (!name) return json(res, 400, { error: 'Enter your name.' });
      if (code.length !== 6) return json(res, 400, { error: 'Room codes have six letters.' });
      const room = rooms.get(code);
      if (!room) return json(res, 404, { error: `No room with code ${code}.` });
      if (room.players.length >= 2) return json(res, 409, { error: 'That room is already full.' });
      const player = makePlayer(name, false);
      room.players.push(player);
      if (room.phase === 'finished') room.phase = 'lobby';
      broadcast(room);
      console.log(`[room ${code}] ${name} joined`);
      return json(res, 200, { code, token: player.token, playerId: player.id });
    }

    if (p === '/api/events' && req.method === 'GET') {
      const { room, player } = auth(url.searchParams.get('code'), url.searchParams.get('token'));
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 2000\n\n');
      if (!room || !player) { send(res, 'gone', {}); return res.end(); }
      const old = room.clients.get(player.id);
      if (old && old !== res) { try { old.end(); } catch (_) { /* ignore */ } }
      room.clients.set(player.id, res);
      player.connected = true;
      broadcast(room);
      const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) { /* ignore */ } }, 20000);
      req.on('close', () => {
        clearInterval(ping);
        if (room.clients.get(player.id) === res) {
          room.clients.delete(player.id);
          player.connected = false;
          player.disconnectedAt = now();
          if (rooms.has(room.code)) broadcast(room);
        }
      });
      return;
    }

    if (p === '/api/action' && req.method === 'POST') {
      const body = await readBody(req);
      const { room, player } = auth(body.code, body.token);
      if (!room || !player) return json(res, 404, { error: 'Room not found.', gone: true });
      const out = handleAction(room, player, body);
      return json(res, out.error ? 400 : 200, out);
    }

    if (req.method === 'GET') return serveStatic(req, res, p);
    res.writeHead(404); res.end();
  } catch (e) {
    console.error(e);
    json(res, 500, { error: 'Server error.' });
  }
});

server.listen(PORT, () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log('\n  WikiWars is running');
  console.log(`  This computer:  http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  Same Wi-Fi:     http://${ip}:${PORT}`);
  console.log('');
});
