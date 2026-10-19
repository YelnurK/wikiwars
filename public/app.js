/* WikiWars client */
(() => {
  'use strict';

  const $ = s => document.querySelector(s);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const norm = t => { const s = String(t || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim(); return s.charAt(0).toUpperCase() + s.slice(1); };
  const last = a => a[a.length - 1];
  const fmtTime = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* ignore */ } },
    sget(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch (_) { return null; } },
    sset(k, v) { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* ignore */ } },
  };

  const ICONS = {
    blur: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M3 8h11M7 12h14M3 16h11"/></svg>',
    blackout: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>',
    rewind: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.5 6v12L3 12zM21 6v12l-8.5-6z"/></svg>',
  };
  const AB_ORDER = ['blur', 'blackout', 'rewind'];

  const S = {
    meta: null,
    session: store.sget('ww-session'), // { code, token, playerId }
    room: null,
    es: null,
    offset: 0,
    createSettings: null,
    me: { seq: -1, tok: 0, title: null, navigating: false, blurT: null },
    opp: { seq: -1, tok: 0, title: null, ratio: 0, blurT: null },
    resultsHidden: false,
    shownRound: 0,
  };
  const serverNow = () => Date.now() + S.offset;
  const myPlayer = () => S.room && S.room.players.find(p => p.id === S.session.playerId);
  const oppPlayer = () => S.room && S.room.players.find(p => p.id !== S.session.playerId);

  // ---------------- toast & modals ----------------
  let toastT;
  function toast(msg, ms = 2600) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms);
  }
  function openModal(id) {
    document.querySelectorAll('.modal').forEach(m => { m.hidden = true; });
    const m = document.getElementById(id); m.hidden = false;
    const f = m.querySelector('input:not([value]), input'); if (f && !f.value) setTimeout(() => f.focus(), 30);
  }
  function closeModals() { document.querySelectorAll('.modal').forEach(m => { m.hidden = true; }); }
  document.addEventListener('click', e => {
    const o = e.target.closest('[data-open]'); if (o) { openModal(o.dataset.open); return; }
    if (e.target.closest('[data-close]') || e.target.classList.contains('modal')) closeModals();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModals(); closePopover(); } });

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (_) {
      const ta = el('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.append(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (_) { /* ignore */ } ta.remove(); return ok;
    }
  }

  // ---------------- network ----------------
  async function postJSON(url, body) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let data = {}; try { data = await res.json(); } catch (_) { /* ignore */ }
    if (!res.ok && !data.error) data.error = `Server error (${res.status})`;
    return data;
  }
  async function act(type, extra = {}, quiet = false) {
    if (!S.session) return {};
    const r = await postJSON('/api/action', { code: S.session.code, token: S.session.token, type, ...extra }).catch(() => ({ error: 'Connection problem.' }));
    if (r.gone) { leaveLocal('That room no longer exists.'); return r; }
    if (r.error && !quiet) toast(r.error);
    return r;
  }

  function connect() {
    if (S.es) S.es.close();
    const { code, token } = S.session;
    const es = new EventSource(`/api/events?code=${encodeURIComponent(code)}&token=${encodeURIComponent(token)}`);
    S.es = es;
    es.addEventListener('state', e => {
      const room = JSON.parse(e.data);
      S.offset = room.serverNow - Date.now();
      S.room = room;
      render();
    });
    es.addEventListener('fx', e => handleFx(JSON.parse(e.data)));
    es.addEventListener('scroll', e => handleOppScroll(JSON.parse(e.data)));
    es.addEventListener('gone', () => leaveLocal('That room no longer exists.'));
  }

  function leaveLocal(msg) {
    if (S.es) { S.es.close(); S.es = null; }
    S.session = null; S.room = null; store.sset('ww-session', null);
    S.me = { seq: -1, tok: 0, title: null, navigating: false }; S.opp = { seq: -1, tok: 0, title: null, ratio: 0 };
    $('#me-body').innerHTML = ''; $('#opp-body').innerHTML = '';
    history.replaceState(null, '', '/');
    show('home');
    if (msg) toast(msg);
  }

  // ---------------- settings editor ----------------
  function renderSettings(container, settings, editable, onChange) {
    const m = S.meta;
    container.innerHTML = '';
    container.classList.toggle('locked', !editable);

    container.append(el('label', 'field-label', 'Wikipedia language'));
    const seg = el('div', 'seg');
    for (const l of m.langs) {
      const b = el('button', settings.lang === l.id ? 'on' : '');
      b.type = 'button'; b.dataset.v = l.id;
      b.append(document.createTextNode(l.label), el('small', null, l.english));
      if (editable) b.onclick = () => onChange({ ...settings, lang: l.id });
      seg.append(b);
    }
    container.append(seg);

    container.append(el('label', 'field-label', 'Categories'));
    const chips = el('div', 'chips');
    const allOn = settings.categories.length === m.categories.length;
    const all = el('button', 'all' + (allOn ? ' on' : ''), allOn ? 'All categories ✓' : 'Select all');
    all.type = 'button';
    if (editable) all.onclick = () => onChange({ ...settings, categories: allOn ? [m.categories[0].id] : m.categories.map(c => c.id) });
    chips.append(all);
    for (const c of m.categories) {
      const on = settings.categories.includes(c.id);
      const b = el('button', on ? 'on' : '', c.label); b.type = 'button';
      if (editable) b.onclick = () => {
        let cats = on ? settings.categories.filter(x => x !== c.id) : [...settings.categories, c.id];
        if (!cats.length) { toast('Pick at least one category.'); return; }
        onChange({ ...settings, categories: cats });
      };
      chips.append(b);
    }
    container.append(chips);

    container.append(el('label', 'field-label', 'Difficulty'));
    const diffs = el('div', 'diffs');
    for (const d of m.difficulties) {
      const b = el('button', settings.difficulty === d.id ? 'on' : ''); b.type = 'button'; b.dataset.v = d.id;
      b.append(el('b', null, d.label), el('small', null, d.desc), el('span', 'd-time', `${Math.round(d.time / 60)} min`));
      if (editable) b.onclick = () => onChange({ ...settings, difficulty: d.id });
      diffs.append(b);
    }
    container.append(diffs);
    const diffHint = {
      hard: 'Start and target come from different categories, for example Brown bear and Elizabeth II. Expect a long race.',
      impossible: 'You start on a random article from anywhere in Wikipedia. The target comes from your categories.',
    }[settings.difficulty];
    if (diffHint) container.append(el('p', 'hint', diffHint));
  }

  function drawCreateSettings() {
    renderSettings($('#create-settings'), S.createSettings, true, s => {
      S.createSettings = s; store.set('ww-settings', JSON.stringify(s)); drawCreateSettings();
    });
  }

  // ---------------- create / join ----------------
  async function createRoom() {
    const name = $('#create-name').value.trim();
    const errBox = $('#create-error'); errBox.hidden = true;
    if (!name) { errBox.textContent = 'Enter your name.'; errBox.hidden = false; $('#create-name').focus(); return; }
    store.set('ww-name', name);
    const btn = $('#btn-create'); btn.disabled = true; btn.textContent = 'Creating…';
    const r = await postJSON('/api/create', { name, settings: S.createSettings }).catch(() => ({ error: 'Cannot reach the server.' }));
    btn.disabled = false; btn.textContent = 'Create room';
    if (r.error) { errBox.textContent = r.error; errBox.hidden = false; return; }
    enterRoom(r);
  }

  function updateJoinBtn() {
    const code = $('#join-code').value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6);
    if ($('#join-code').value !== code) $('#join-code').value = code;
    document.querySelectorAll('#join-cells span').forEach((c, i) => { c.textContent = code[i] || ''; c.classList.toggle('active', i === Math.min(code.length, 5)); });
    $('#btn-join').disabled = code.length !== 6 || !$('#join-name').value.trim();
  }

  async function joinRoom() {
    const name = $('#join-name').value.trim();
    const code = $('#join-code').value.trim().toUpperCase();
    const errBox = $('#join-error'); errBox.hidden = true;
    if (!name || code.length !== 6) return;
    store.set('ww-name', name);
    const btn = $('#btn-join'); btn.disabled = true; btn.textContent = 'Joining…';
    const r = await postJSON('/api/join', { name, code }).catch(() => ({ error: 'Cannot reach the server.' }));
    btn.textContent = 'Join room'; updateJoinBtn();
    if (r.error) { errBox.textContent = r.error; errBox.hidden = false; return; }
    enterRoom(r);
  }

  function enterRoom(r) {
    S.session = { code: r.code, token: r.token, playerId: r.playerId };
    store.sset('ww-session', S.session);
    history.replaceState(null, '', `/?room=${r.code}`);
    closeModals();
    connect();
  }

  // ---------------- screens ----------------
  function show(name) {
    for (const s of ['home', 'lobby', 'game']) $(`#screen-${s}`).hidden = s !== name;
  }
  let currentScreen = 'home';

  function render() {
    const room = S.room; if (!room) return;
    const inGame = ['countdown', 'playing', 'finished'].includes(room.phase) || (room.phase === 'generating' && currentScreen === 'game');
    currentScreen = inGame ? 'game' : 'lobby';
    show(currentScreen);
    if (currentScreen === 'lobby') renderLobby(); else renderGame();
  }

  function renderLobby() {
    const room = S.room; const me = myPlayer(); if (!me) return;
    const tiles = $('#lobby-code');
    if (tiles.dataset.code !== room.code) {
      tiles.dataset.code = room.code; tiles.innerHTML = '';
      for (const ch of room.code) tiles.append(el('span', null, ch));
      tiles.setAttribute('aria-label', `Room code ${room.code.split('').join(' ')}`);
    }
    const vs = $('#lobby-players'); vs.innerHTML = '';
    const opp = room.players.find(p => p.id !== me.id);
    const panel = (p, side) => {
      const d = el('div', `vs-player ${side}`);
      d.append(el('div', 'vs-role', `${p.id === me.id ? 'You' : 'Rival'}${p.host ? ', host' : ''}`), el('div', 'vs-name', p.name));
      const meta = el('div', 'vs-meta');
      meta.append(el('span', 'net' + (p.connected ? '' : ' off'), p.connected ? 'Online' : 'Offline'));
      meta.append(el('span', null, `${p.wins} win${p.wins === 1 ? '' : 's'}`));
      d.append(meta);
      return d;
    };
    vs.append(panel(me, 'blue'), el('div', 'vs-mid', 'vs'));
    if (opp) vs.append(panel(opp, 'red'));
    else {
      const d = el('div', 'vs-player empty');
      d.append(el('div', 'vs-role', 'Rival'), el('div', 'vs-name', 'Waiting for someone to join'), el('div', 'vs-meta'));
      vs.append(d);
    }

    renderSettings($('#lobby-settings'), room.settings, me.host, s => act('settings', { settings: s }));
    $('#settings-note').textContent = me.host ? '' : 'set by the host';

    const err = $('#lobby-error'); err.hidden = !room.error; err.textContent = room.error || '';
    const btn = $('#btn-start'); const hint = $('#start-hint');
    const host = room.players.find(p => p.host);
    btn.hidden = !me.host;
    if (room.phase === 'generating') {
      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Picking articles…';
      hint.textContent = 'Finding a fair start and target on Wikipedia…';
    } else {
      btn.textContent = 'Start race';
      btn.disabled = room.players.length < 2;
      hint.textContent = me.host
        ? (room.players.length < 2 ? 'Send the code. You can start once your rival joins.' : 'Both players are here.')
        : `Waiting for ${host ? host.name : 'the host'} to start the race…`;
    }
  }

  // ---------------- game ----------------
  function buildAbilities() {
    const box = $('#abilities'); box.innerHTML = '';
    AB_ORDER.forEach((k, i) => {
      const def = S.meta.abilities[k];
      const b = el('button', 'ab'); b.type = 'button'; b.dataset.k = k;
      b.title = k === 'blur' ? 'Blur your rival\'s page for 2.5 s'
        : k === 'blackout' ? 'Flicker your rival\'s screen black for 3 s'
          : 'Send your rival back two links';
      b.innerHTML = `<span class="key">${i + 1}</span>${ICONS[k]}<span class="label">${def.label}</span><span class="pips"></span><span class="cd"></span>`;
      b.onclick = () => useAbility(k);
      box.append(b);
    });
  }

  function updateAbilities() {
    const room = S.room; const me = myPlayer(); if (!room || !me) return;
    const t = serverNow();
    const running = room.phase === 'playing' || (room.phase === 'countdown' && room.round && t >= room.round.startsAt);
    const cdLeft = Math.max(0, (me.cooldownUntil || 0) - t);
    document.querySelectorAll('.ab').forEach(b => {
      const k = b.dataset.k; const max = S.meta.abilities[k].charges; const left = (me.charges && me.charges[k]) || 0;
      const pips = b.querySelector('.pips');
      if (pips.childElementCount !== max || pips.dataset.left !== String(left)) {
        pips.innerHTML = ''; pips.dataset.left = left;
        for (let i = 0; i < max; i++) pips.append(el('i', i < left ? '' : 'used'));
      }
      b.disabled = !running || left <= 0 || cdLeft > 0;
      b.querySelector('.cd').style.width = cdLeft > 0 && left > 0 ? `${(cdLeft / S.meta.abilityCooldown) * 100}%` : '0';
    });
  }

  async function useAbility(k) {
    const btn = document.querySelector(`.ab[data-k="${k}"]`);
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    await act('ability', { kind: k });
    updateAbilities();
  }

  function crumbs(box, path, target) {
    box.innerHTML = '';
    path.forEach((t, i) => {
      if (i) box.append(el('i', null, '›'));
      box.append(el('span', norm(t) === norm(target) ? 't' : '', t));
    });
    box.scrollLeft = box.scrollWidth;
  }

  function renderGame() {
    const room = S.room; const me = myPlayer(); const opp = oppPlayer(); if (!me) return;
    if (!document.querySelector('.ab')) buildAbilities();
    const r = room.round;
    if (r) {
      $('#g-start').textContent = r.start; $('#g-target').textContent = r.target;
      $('#g-par').textContent = r.par ? `par ≤ ${r.par}` : 'no par';
      if (r.number !== S.shownRound) { S.shownRound = r.number; S.resultsHidden = false; closePopover(); }
    }
    $('#me-name').textContent = me.name; $('#me-clicks').textContent = me.clicks;
    crumbs($('#me-crumbs'), me.path, r && r.target);
    $('#opp-name').textContent = opp ? opp.name : '—'; $('#opp-clicks').textContent = opp ? opp.clicks : 0;
    $('#opp-live').classList.toggle('off', !(opp && opp.connected));
    $('#opp-live').lastChild.textContent = opp && opp.connected ? 'live' : 'offline';
    crumbs($('#opp-crumbs'), opp ? opp.path : [], r && r.target);
    updateAbilities();
    syncPanes();
    renderOverlay();
    renderResults();
  }

  // countdown / generating overlay
  function renderOverlay() {
    const room = S.room; const r = room.round; const ov = $('#g-overlay');
    if (room.phase === 'generating') {
      ov.hidden = false;
      $('#ov-eyebrow').textContent = 'Next round';
      const c = $('#ov-count'); c.className = 'count text'; c.innerHTML = '<span class="spinner"></span> Picking articles…';
      $('#ov-start').textContent = '…'; $('#ov-target').textContent = '…'; $('#ov-summary').innerHTML = '';
      return;
    }
    const t = serverNow();
    if (r && room.phase !== 'finished' && t < r.startsAt + 700) {
      ov.hidden = false;
      $('#ov-eyebrow').textContent = `Round ${r.number}. Get ready.`;
      const left = r.startsAt - t; const c = $('#ov-count');
      c.className = left > 0 ? 'count' : 'count text';
      c.textContent = left > 0 ? Math.ceil(left / 1000) : 'GO!';
      if ($('#ov-target').textContent !== r.target) {
        $('#ov-start').textContent = r.start; $('#ov-target').textContent = r.target;
        fillSummary($('#ov-summary'), room.settings.lang, r.target);
      }
    } else {
      ov.hidden = true;
    }
  }

  function renderResults() {
    const room = S.room; const box = $('#g-results'); const me = myPlayer();
    const pill = $('#show-results');
    if (room.phase !== 'finished' || !room.result) { box.hidden = true; if (pill) pill.remove(); return; }
    box.hidden = S.resultsHidden;
    if (S.resultsHidden && !pill) {
      const b = el('button', 'btn btn-blue', 'Show results'); b.id = 'show-results';
      Object.assign(b.style, { position: 'fixed', right: '18px', bottom: '18px', zIndex: 30 });
      b.onclick = () => { S.resultsHidden = false; b.remove(); renderResults(); };
      document.body.append(b);
    }
    if (!S.resultsHidden && pill) pill.remove();

    const res = room.result; const r = room.round;
    const winner = room.players.find(p => p.id === res.winnerId);
    const iWon = winner && winner.id === me.id;
    box.querySelector('.results').className = 'results ' + (!winner ? 'draw' : iWon ? 'win' : 'lose');
    $('#res-eyebrow').textContent = `Round ${r.number}, ${fmtTime(res.durationMs)}`;
    $('#res-title').textContent = !winner ? "Time's up" : iWon ? 'You won!' : `${winner.name} won`;
    $('#res-sub').textContent = res.reason === 'reached' ? `${winner.name} reached “${r.target}” in ${winner.clicks} click${winner.clicks === 1 ? '' : 's'}.`
      : res.reason === 'forfeit' ? (winner ? `The other player left the race.` : 'The race was abandoned.')
        : `Nobody reached “${r.target}” in time.`;
    const ps = $('#res-players'); ps.innerHTML = '';
    for (const p of room.players) {
      const card = el('div', 'res-player' + (p.id === me.id ? ' me' : ' rival'));
      const top = el('div', 'top');
      top.append(el('span', null, p.name + (p.id === me.id ? ' (you)' : '')));
      if (winner && p.id === winner.id) top.append(el('span', 'crown', 'Winner'));
      if (p.wins) top.append(el('span', 'wins', `${p.wins} win${p.wins > 1 ? 's' : ''}`));
      top.append(el('span', 'clicks', `${p.clicks} clicks`));
      const path = el('div', 'res-path');
      p.path.forEach((t, i) => { if (i) path.append(el('i', null, '→')); path.append(el('span', norm(t) === norm(r.target) ? 't' : '', t)); });
      card.append(top, path); ps.append(card);
    }
    const route = $('#res-route');
    route.innerHTML = '';
    if (r.route) { route.append(el('span', null, 'One possible route: ')); route.append(el('b', null, r.route.join(' → '))); }

    const actions = $('#res-actions'); actions.innerHTML = '';
    if (me.host) {
      const again = el('button', 'btn btn-blue', 'Play again'); again.onclick = () => act('start');
      const settings = el('button', 'btn btn-outline', 'Change settings'); settings.onclick = () => act('toLobby');
      actions.append(again, settings);
      if (room.players.length < 2) { again.disabled = true; }
    } else {
      actions.append(el('span', 'hint', 'Waiting for the host to start the next round…'));
    }
    const look = el('button', 'btn btn-quiet', 'Look at the pages'); look.onclick = () => { S.resultsHidden = true; renderResults(); };
    const leave = el('button', 'textlink', 'Leave room'); leave.onclick = leaveRoom;
    actions.append(look, leave);
  }

  // timer loop
  setInterval(() => {
    const room = S.room; if (!room || currentScreen !== 'game' || !room.round) return;
    const t = serverNow(); const r = room.round;
    const left = room.phase === 'finished' ? 0 : t < r.startsAt ? r.endsAt - r.startsAt : r.endsAt - t;
    const timer = $('#g-timer'); timer.textContent = fmtTime(left);
    timer.classList.toggle('low', room.phase === 'playing' && left < 30000);
    renderOverlay();
    updateAbilities();
  }, 200);

  // ---------------- Wikipedia ----------------
  const wikiBase = lang => S.meta.wikiBase ? `${S.meta.wikiBase}/${lang}` : `https://${lang}.wikipedia.org`;
  function apiUrl(lang, params) {
    const u = new URL(wikiBase(lang) + '/w/api.php');
    for (const [k, v] of Object.entries({ format: 'json', formatversion: 2, origin: '*', ...params })) u.searchParams.set(k, v);
    return u.toString();
  }
  async function getJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  const nsCache = {};
  const FALLBACK_NS = ['file', 'image', 'category', 'help', 'wikipedia', 'template', 'talk', 'user', 'portal', 'special', 'media', 'module', 'draft', 'mediawiki',
    'файл', 'изображение', 'категория', 'справка', 'википедия', 'шаблон', 'обсуждение', 'участник', 'портал', 'служебная', 'медиа', 'модуль', 'проект',
    'сурет', 'санат', 'анықтама', 'уикипедия', 'үлгі', 'талқылау', 'қатысушы', 'арнайы', 'таспа'];
  async function namespaces(lang) {
    if (nsCache[lang]) return nsCache[lang];
    const set = new Set(FALLBACK_NS);
    try {
      const d = await getJSON(apiUrl(lang, { action: 'query', meta: 'siteinfo', siprop: 'namespaces|namespacealiases' }));
      for (const ns of Object.values(d.query.namespaces || {})) {
        if (ns.id === 0) continue;
        if (ns.name) set.add(ns.name.toLowerCase());
        if (ns.canonical) set.add(ns.canonical.toLowerCase());
      }
      for (const a of d.query.namespacealiases || []) if (a.id !== 0) set.add((a.alias || a['*'] || '').toLowerCase());
      nsCache[lang] = set;
    } catch (_) { /* use fallback this time */ }
    return set;
  }

  const pageCache = new Map();
  async function fetchArticle(lang, title) {
    const key = `${lang}|${norm(title)}`;
    if (pageCache.has(key)) return pageCache.get(key);
    const p = (async () => {
      const d = await getJSON(apiUrl(lang, {
        action: 'parse', page: title, prop: 'text', redirects: 1, disableeditsection: 1, disablelimitreport: 1,
      }));
      if (d.error) throw new Error(d.error.info || 'Article not found');
      const text = typeof d.parse.text === 'string' ? d.parse.text : d.parse.text['*'];
      const art = { title: d.parse.title, html: text, lang };
      pageCache.set(`${lang}|${norm(art.title)}`, Promise.resolve(art));
      return art;
    })();
    pageCache.set(key, p);
    p.catch(() => pageCache.delete(key));
    return p;
  }

  const summaryCache = new Map();
  function fetchSummary(lang, title) {
    const key = `${lang}|${title}`;
    if (!summaryCache.has(key)) {
      summaryCache.set(key, getJSON(`${wikiBase(lang)}/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`).catch(() => null));
    }
    return summaryCache.get(key);
  }
  async function fillSummary(box, lang, title) {
    box.innerHTML = ''; box.className = 'summary noimg';
    box.dataset.title = title;
    const s = await fetchSummary(lang, title);
    if (!s || box.dataset.title !== title) return;
    box.innerHTML = '';
    const img = s.thumbnail && s.thumbnail.source;
    box.className = img ? 'summary' : 'summary noimg';
    if (img) { const i = el('img'); i.src = img; i.alt = ''; box.append(i); }
    const txt = el('div');
    if (s.description) txt.append(el('div', 'desc', s.description));
    txt.append(el('p', null, s.extract || ''));
    box.append(txt);
  }

  function titleFromHref(href, ns) {
    const m = href.match(/^\/wiki\/([^?]+)$/) || href.match(/^\.\/([^?]+)$/);
    if (!m) return null;
    try {
      const [pathPart, frag] = m[1].split('#');
      const title = decodeURIComponent(pathPart).replace(/_/g, ' ').trim();
      if (!title) return null;
      const i = title.indexOf(':');
      if (i > 0 && ns.has(title.slice(0, i).trim().toLowerCase())) return null;
      return { title, frag: frag ? decodeURIComponent(frag) : null };
    } catch (_) { return null; }
  }

  function buildArticle(art, ns, isTarget, visited) {
    const tpl = document.createElement('template');
    tpl.innerHTML = art.html;
    const root = tpl.content;
    root.querySelectorAll('script, meta, .mw-editsection, link[rel="stylesheet"]').forEach(e => e.remove());
    const base = wikiBase(art.lang);
    root.querySelectorAll('img').forEach(img => {
      const fix = u => u.startsWith('//') ? 'https:' + u : (u.startsWith('/') ? base + u : u);
      const src = img.getAttribute('src'); if (src) img.setAttribute('src', fix(src));
      const ss = img.getAttribute('srcset'); if (ss) img.setAttribute('srcset', ss.split(',').map(x => fix(x.trim())).join(', '));
      img.loading = 'lazy'; img.draggable = false;
    });
    const visitedSet = new Set(visited.map(norm));
    root.querySelectorAll('a').forEach(a => {
      const href = a.getAttribute('href') || '';
      a.removeAttribute('href');
      if (a.classList.contains('mw-selflink')) { a.classList.add('self'); return; }
      if (href.startsWith('#')) {
        a.classList.add('anchor');
        try { a.dataset.frag = decodeURIComponent(href.slice(1)); } catch (_) { a.dataset.frag = href.slice(1); }
        return;
      }
      const t = titleFromHref(href, ns);
      const cl = a.classList;
      const imageOnly = a.querySelector('img') && !a.textContent.trim();
      if (!t || cl.contains('new') || cl.contains('extiw') || cl.contains('external') || cl.contains('mw-file-description') || cl.contains('image') || imageOnly) {
        cl.add('dead'); if (cl.contains('new')) cl.add('was-red');
        return;
      }
      cl.add('wl'); a.dataset.t = t.title; if (t.frag) a.dataset.frag = t.frag;
      if (visitedSet.has(norm(t.title))) cl.add('visited');
    });
    const wrap = el('div', 'wiki'); wrap.lang = art.lang;
    const h = el('h1', 'wiki-title', art.title);
    if (isTarget) h.append(el('span', 'is-target', 'TARGET'));
    wrap.append(h, root);
    return wrap;
  }

  function scrollToFrag(body, frag) {
    if (!frag) return;
    const target = body.querySelector(`[id="${CSS.escape(frag)}"]`) || body.querySelector(`[id="${CSS.escape(frag.replace(/ /g, '_'))}"]`);
    if (target) body.scrollTop += target.getBoundingClientRect().top - body.getBoundingClientRect().top - 12;
  }

  function setLoading(side, on) {
    const bar = $(side === 'me' ? '#me-load' : '#opp-load');
    bar.classList.remove('on'); if (on) { void bar.offsetWidth; bar.classList.add('on'); }
    $(side === 'me' ? '#me-body' : '#opp-body').classList.toggle('loading', on);
  }

  async function loadPane(side, title, seq, frag) {
    const st = S[side]; st.seq = seq; const tok = ++st.tok;
    const body = $(side === 'me' ? '#me-body' : '#opp-body');
    const room = S.room; const lang = room.settings.lang;
    setLoading(side, true);
    try {
      const [art, ns] = await Promise.all([fetchArticle(lang, title), namespaces(lang)]);
      if (tok !== st.tok) return;
      const p = side === 'me' ? myPlayer() : oppPlayer();
      const isTarget = room.round && norm(art.title) === norm(room.round.target);
      body.innerHTML = '';
      body.append(buildArticle(art, ns, isTarget, p ? p.path : []));
      st.title = art.title;
      body.scrollTop = 0;
      if (side === 'me') scrollToFrag(body, frag);
      else applyOppScroll();
    } catch (e) {
      if (tok !== st.tok) return;
      body.innerHTML = '';
      const msg = el('div', 'pane-msg');
      msg.append(el('div', null, `Couldn't load “${title}” from Wikipedia. ${e.message || ''}`));
      if (side === 'me') {
        const retry = el('button', 'btn btn-outline btn-sm', 'Try again'); retry.style.marginTop = '12px';
        retry.onclick = () => loadPane(side, title, seq, frag);
        msg.append(retry);
      }
      body.append(msg);
    } finally {
      if (tok === st.tok) setLoading(side, false);
    }
  }

  function syncPanes() {
    const me = myPlayer(); const opp = oppPlayer();
    if (me && me.path.length && !S.me.navigating && me.navSeq !== S.me.seq) loadPane('me', last(me.path), me.navSeq);
    if (opp && opp.path.length && opp.navSeq !== S.opp.seq) { S.opp.ratio = 0; loadPane('opp', last(opp.path), opp.navSeq); }
  }

  // clicking links
  $('#me-body').addEventListener('click', e => {
    const a = e.target.closest('a'); if (!a) return;
    e.preventDefault();
    if (a.classList.contains('anchor')) { scrollToFrag($('#me-body'), a.dataset.frag); return; }
    if (a.classList.contains('wl')) { navigate(a.dataset.t, a.dataset.frag); return; }
    if (a.classList.contains('dead')) toast(a.classList.contains('was-red') ? 'Red links lead nowhere.' : 'Only blue article links count.', 1400);
  });

  async function navigate(title, frag) {
    const room = S.room; if (!room || !room.round) return;
    const t = serverNow();
    if (room.phase === 'finished') return;
    if (t < room.round.startsAt) { toast('Wait for GO!', 1200); return; }
    if (S.me.navigating) return;
    const me = myPlayer(); const from = last(me.path);
    S.me.navigating = true;
    const tok = ++S.me.tok;
    setLoading('me', true);
    try {
      const [art, ns] = await Promise.all([fetchArticle(room.settings.lang, title), namespaces(room.settings.lang)]);
      if (tok !== S.me.tok) return;
      if (norm(art.title) === norm(from)) { scrollToFrag($('#me-body'), frag); return; }
      const r = await act('navigate', { from, title: art.title });
      if (tok !== S.me.tok) return;
      if (r.stale) { S.me.navigating = false; loadPane('me', r.current, r.navSeq); return; }
      if (r.error) return;
      const body = $('#me-body');
      const isTarget = norm(art.title) === norm(room.round.target);
      body.innerHTML = '';
      body.append(buildArticle(art, ns, isTarget, [...me.path, art.title]));
      body.scrollTop = 0; scrollToFrag(body, frag);
      S.me.title = art.title; S.me.seq = r.navSeq;
    } catch (e) {
      toast(`Couldn't open “${title}”.`);
    } finally {
      if (tok === S.me.tok) setLoading('me', false);
      S.me.navigating = false;
      syncPanes();
    }
  }

  // scroll mirroring
  let scrollT = 0, scrollPending = false;
  $('#me-body').addEventListener('scroll', () => {
    if (!S.room || S.room.phase !== 'playing') return;
    if (scrollPending) return;
    scrollPending = true;
    const wait = Math.max(0, 250 - (Date.now() - scrollT));
    setTimeout(() => {
      scrollPending = false; scrollT = Date.now();
      const b = $('#me-body'); const max = b.scrollHeight - b.clientHeight;
      act('scroll', { ratio: max > 0 ? b.scrollTop / max : 0 }, true);
    }, wait);
  }, { passive: true });

  function handleOppScroll(d) {
    if (d.navSeq !== S.opp.seq) return;
    S.opp.ratio = d.ratio; applyOppScroll(true);
  }
  function applyOppScroll(smooth) {
    const b = $('#opp-body'); const max = b.scrollHeight - b.clientHeight;
    b.scrollTo({ top: S.opp.ratio * max, behavior: smooth ? 'smooth' : 'auto' });
  }

  // ---------------- abilities fx ----------------
  function banner(side, text, good) {
    const b = $(side === 'me' ? '#me-banner' : '#opp-banner');
    b.textContent = text; b.classList.toggle('good', !!good);
    b.classList.remove('on'); void b.offsetWidth; b.classList.add('on');
    clearTimeout(b._t); b._t = setTimeout(() => b.classList.remove('on'), 1800);
  }
  function applyBlur(side, ms) {
    const body = $(side === 'me' ? '#me-body' : '#opp-body'); const st = S[side];
    body.classList.add('fx-blur');
    clearTimeout(st.blurT); st.blurT = setTimeout(() => body.classList.remove('fx-blur'), ms);
  }
  function applyBlackout(side, ms, flicker) {
    const ov = $(side === 'me' ? '#me-black' : '#opp-black');
    const cycle = (flicker || 500) * 2;
    ov.classList.remove('on'); void ov.offsetWidth;
    ov.style.animationDuration = `${cycle}ms`;
    ov.style.animationIterationCount = String(Math.max(1, Math.round(ms / cycle)));
    ov.classList.add('on');
    clearTimeout(ov._t); ov._t = setTimeout(() => ov.classList.remove('on'), ms + 60);
  }
  function shake(side) {
    const pane = $(side === 'me' ? '#pane-me' : '#pane-opp');
    pane.classList.remove('shake'); void pane.offsetWidth; pane.classList.add('shake');
    setTimeout(() => pane.classList.remove('shake'), 500);
  }
  function handleFx(fx) {
    if (!S.session) return;
    const me = S.session.playerId;
    const from = S.room && S.room.players.find(p => p.id === fx.from);
    const fromName = from ? from.name : 'Your rival';
    const label = S.meta.abilities[fx.kind].label;
    const side = fx.to === me ? 'me' : fx.from === me ? 'opp' : null;
    if (!side) return;
    if (fx.kind === 'blur') applyBlur(side, fx.duration);
    if (fx.kind === 'blackout') applyBlackout(side, fx.duration, fx.flicker);
    if (fx.kind === 'rewind') shake(side);
    if (side === 'me') banner('me', fx.kind === 'rewind' ? `${fromName} rewound you 2 links!` : `${fromName} used ${label.toUpperCase()}!`);
    else banner('opp', `${label} sent ✓`, true);
  }

  document.addEventListener('keydown', e => {
    if (currentScreen !== 'game' || e.target.matches('input, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
    const i = ['1', '2', '3'].indexOf(e.key);
    if (i >= 0) { e.preventDefault(); useAbility(AB_ORDER[i]); }
  });

  // target popover
  let popover = null;
  function closePopover() { if (popover) { popover.remove(); popover = null; } }
  $('#g-target-btn').addEventListener('click', e => {
    e.stopPropagation();
    if (popover) { closePopover(); return; }
    const r = S.room && S.room.round; if (!r) return;
    popover = el('div', 'popover');
    popover.append(el('p', 'pop-label', 'Your target'), el('div', 'pop-title', r.target));
    const sum = el('div', 'summary noimg'); popover.append(sum);
    const rect = e.currentTarget.getBoundingClientRect();
    popover.style.top = `${rect.bottom + 8}px`;
    popover.style.left = `${Math.max(16, Math.min(rect.left, window.innerWidth - 396))}px`;
    document.body.append(popover);
    fillSummary(sum, S.room.settings.lang, r.target);
  });
  document.addEventListener('click', e => { if (popover && !popover.contains(e.target)) closePopover(); });

  async function leaveRoom() {
    await act('leave', {}, true);
    leaveLocal();
  }

  // ---------------- boot ----------------
  async function boot() {
    try {
      S.meta = await (await fetch('/api/meta')).json();
    } catch (_) {
      toast('Cannot reach the WikiWars server.', 8000); return;
    }
    const all = S.meta.categories.map(c => c.id);
    let saved = null; try { saved = JSON.parse(store.get('ww-settings', 'null')); } catch (_) { /* ignore */ }
    S.createSettings = {
      lang: saved && S.meta.langs.some(l => l.id === saved.lang) ? saved.lang : 'kk',
      categories: saved && Array.isArray(saved.categories) && saved.categories.filter(c => all.includes(c)).length ? saved.categories.filter(c => all.includes(c)) : all,
      difficulty: saved && S.meta.difficulties.some(d => d.id === saved.difficulty) ? saved.difficulty : 'easy',
    };
    drawCreateSettings();
    const name = store.get('ww-name', '');
    $('#create-name').value = name; $('#join-name').value = name;

    $('#btn-create').onclick = createRoom;
    $('#create-name').addEventListener('keydown', e => { if (e.key === 'Enter') createRoom(); });
    $('#join-code').addEventListener('input', updateJoinBtn);
    $('#join-code').addEventListener('focus', updateJoinBtn);
    $('#join-name').addEventListener('input', updateJoinBtn);
    $('#join-code').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });
    $('#btn-join').onclick = joinRoom;
    $('#btn-start').onclick = () => act('start');
    $('#btn-leave').onclick = leaveRoom;
    $('#btn-copy-code').onclick = async () => { if (await copyText(S.room.code)) toast('Code copied'); };
    $('#btn-copy-link').onclick = async () => { if (await copyText(`${location.origin}/?room=${S.room.code}`)) toast('Invite link copied'); };

    const qRoom = new URLSearchParams(location.search).get('room');
    if (S.session && (!qRoom || qRoom.toUpperCase() === S.session.code)) {
      connect();
    } else {
      S.session = null; store.sset('ww-session', null);
      show('home');
      if (qRoom) {
        $('#join-code').value = qRoom.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6);
        updateJoinBtn(); openModal('modal-join');
        if (name) $('#join-code').focus();
      }
    }
  }
  boot();
})();
