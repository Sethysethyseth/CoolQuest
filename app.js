/* CoolQuest — multiplayer word-tracing game.
 * Networking: peer-to-peer via PeerJS. The host's browser runs the authoritative
 * game; every other player connects to it with a 4-letter room code. */
(() => {
'use strict';

// =====================================================================
// Dictionary
// =====================================================================
if (!window.GLYPH_WORDS) {
  const m = document.getElementById('homeMsg');
  if (m) m.textContent = "The dictionary file (words.js) didn't load. Make sure it was uploaded next to index.html.";
  throw new Error('words.js missing');
}
const WORDS = window.GLYPH_WORDS.split(' ');          // sorted, lowercase
const WORDSET = new Set(WORDS);
function hasPrefix(p) {
  let lo = 0, hi = WORDS.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (WORDS[m] < p) lo = m + 1; else hi = m; }
  return lo < WORDS.length && WORDS[lo].startsWith(p);
}

// =====================================================================
// Rules
// =====================================================================
const SIZE = 5, N = SIZE * SIZE;
const PREFIX = 'coolquest-v1-';
// WebRTC connection helpers. STUN lets browsers find each other; TURN relays the
// traffic when a direct connection is blocked (mobile data, school/work Wi-Fi,
// strict routers). Without TURN, joining across networks can hang on "Searching…".
// Paste your TURN credentials into TURN_SERVERS (free tier at metered.ca:
// Dashboard -> TURN Server -> copy the iceServers entries with username/credential).
const TURN_SERVERS = [
  // { urls: 'turn:global.relay.metered.ca:80',                username: 'PASTE', credential: 'PASTE' },
  // { urls: 'turn:global.relay.metered.ca:443',               username: 'PASTE', credential: 'PASTE' },
  // { urls: 'turns:global.relay.metered.ca:443?transport=tcp', username: 'PASTE', credential: 'PASTE' },
];
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
  ...TURN_SERVERS
];
const PEER_OPTS = { debug: 0, config: { iceServers: ICE_SERVERS } };
const GEM_CAP = 10;
const LONG_BONUS = 10, LONG_LEN = 6;
const COST = { shuffle: 1, swap: 3, hint: 4 };
// letter: [value, weight]
const LETTERS = {
  a:[1,9], b:[4,2], c:[4,2.4], d:[3,4], e:[1,12], f:[5,2], g:[3,3], h:[4,2.4], i:[1,8.5],
  j:[8,0.5], k:[6,1], l:[2,4], m:[4,2.4], n:[2,6], o:[1,8], p:[4,2], q:[9,0.4], r:[2,6],
  s:[2,5], t:[2,6], u:[3,4], v:[5,1.6], w:[5,1.8], x:[8,0.5], y:[4,2], z:[9,0.5]
};
const VAL = Object.fromEntries(Object.entries(LETTERS).map(([k, v]) => [k, v[0]]));
const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);
const ALPHA = 'abcdefghijklmnopqrstuvwxyz'.split('');

const NB = [];
for (let i = 0; i < N; i++) {
  const r = Math.floor(i / SIZE), c = i % SIZE, list = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue;
    const rr = r + dr, cc = c + dc;
    if (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE) list.push(rr * SIZE + cc);
  }
  NB.push(list);
}
const adjacent = (a, b) => NB[a].includes(b);

function weighted(keys) {
  let total = 0; for (const k of keys) total += LETTERS[k][1];
  let r = Math.random() * total;
  for (const k of keys) { r -= LETTERS[k][1]; if (r <= 0) return k; }
  return keys[keys.length - 1];
}
const VOWEL_KEYS = ALPHA.filter(l => VOWELS.has(l));
const CONS_KEYS = ALPHA.filter(l => !VOWELS.has(l));
function drawLetter(vowelCount) {
  if (vowelCount < 7 && Math.random() < 0.65) return weighted(VOWEL_KEYS);
  if (vowelCount > 10) return weighted(CONS_KEYS);
  return weighted(ALPHA);
}

function scorePath(board, path) {
  let sum = 0, mult = 1;
  for (const i of path) {
    const t = board[i]; let v = VAL[t.l];
    if (t.m === 'DL') v *= 2; else if (t.m === 'TL') v *= 3;
    if (t.m === 'DW') mult *= 2;
    sum += v;
  }
  return sum * mult + (path.length >= LONG_LEN ? LONG_BONUS : 0);
}
const pathWord = (board, path) => path.map(i => board[i].l).join('');
function validPathShape(path) {
  if (!Array.isArray(path) || path.length < 1 || path.length > N) return false;
  const seen = new Set();
  for (let k = 0; k < path.length; k++) {
    const i = path[k];
    if (!Number.isInteger(i) || i < 0 || i >= N || seen.has(i)) return false;
    if (k && !adjacent(path[k - 1], i)) return false;
    seen.add(i);
  }
  return true;
}

function solveBest(board, minLen) {
  let best = null;
  const used = new Array(N).fill(false), path = [];
  function dfs(i, word) {
    if (!hasPrefix(word)) return;
    if (word.length >= minLen && WORDSET.has(word)) {
      const pts = scorePath(board, path);
      if (!best || pts > best.pts) best = { word, path: path.slice(), pts };
    }
    for (const j of NB[i]) if (!used[j]) {
      used[j] = true; path.push(j);
      dfs(j, word + board[j].l);
      path.pop(); used[j] = false;
    }
  }
  for (let i = 0; i < N; i++) { used[i] = true; path.push(i); dfs(i, board[i].l); path.pop(); used[i] = false; }
  return best;
}

// =====================================================================
// Host engine (authoritative)
// =====================================================================
const COLORS = ['#5ef2d6', '#ff8a5c', '#b48cff', '#ffd45e', '#ff6fa8', '#6fb6ff', '#9be36b', '#ff5e6c'];
const SETTING_OPTS = {
  rounds: [[3, '3'], [5, '5'], [7, '7'], [10, '10']],
  minLen: [[2, '2'], [3, '3'], [4, '4']],
  timer: [[0, 'Off'], [45, '45s'], [60, '60s'], [90, '90s']]
};

const Host = {
  S: null, conns: new Map(), tileSeq: 1, evSeq: 1, tick: null, skipTO: null,

  init(code) {
    this.S = {
      code, phase: 'lobby', hostPid: null,
      settings: { rounds: 5, minLen: 3, timer: 0 },
      players: [], board: [], round: 0, turnIdx: 0, turnEndsAt: 0, events: []
    };
    clearInterval(this.tick);
    this.tick = setInterval(() => this.onTick(), 300);
  },
  cur() { return this.S.players[this.S.turnIdx]; },
  player(pid) { return this.S.players.find(p => p.pid === pid); },
  tile(l, gem = false) { return { id: this.tileSeq++, l, g: gem, m: null }; },
  event(e) { e.seq = this.evSeq++; this.S.events.push(e); if (this.S.events.length > 8) this.S.events.shift(); },

  newBoard() {
    const b = []; let v = 0;
    for (let i = 0; i < N; i++) { const l = drawLetter(v); if (VOWELS.has(l)) v++; b.push(this.tile(l)); }
    const idx = [...Array(N).keys()].sort(() => Math.random() - 0.5);
    for (let k = 0; k < 10; k++) b[idx[k]].g = true;
    this.S.board = b;
  },
  placeMults() {
    const b = this.S.board;
    for (const t of b) t.m = null;
    const idx = [...Array(N).keys()].sort(() => Math.random() - 0.5);
    b[idx[0]].m = this.S.round >= 4 && this.S.round === this.S.settings.rounds ? 'TL' : 'DL';
    if (this.S.round >= 2) b[idx[1]].m = 'DW';
  },
  refill(path) {
    const b = this.S.board;
    let v = b.filter((t, i) => !path.includes(i) && VOWELS.has(t.l)).length;
    let gems = b.filter((t, i) => !path.includes(i) && t.g).length;
    for (const i of path) {
      const l = drawLetter(v); if (VOWELS.has(l)) v++;
      const g = gems < 11 && Math.random() < 0.42; if (g) gems++;
      b[i] = this.tile(l, g);
    }
  },

  addPlayer(pid, name) {
    let p = this.player(pid);
    if (p) { p.connected = true; if (name) p.name = name; return p; }
    if (this.S.players.length >= 8) return null;
    const used = new Set(this.S.players.map(q => q.color));
    p = { pid, name, color: COLORS.find(c => !used.has(c)) || COLORS[0], score: 0, gems: 3,
          connected: true, words: 0, best: null };
    this.S.players.push(p);
    if (this.S.phase !== 'lobby') this.event({ type: 'join', pid });
    return p;
  },
  dropPlayer(pid) {
    const p = this.player(pid); if (!p) return;
    if (this.S.phase === 'lobby') {
      this.S.players = this.S.players.filter(q => q !== p);
    } else {
      p.connected = false;
      if (this.cur() === p) this.scheduleSkip();
    }
    this.broadcast();
  },

  startGame() {
    const S = this.S;
    S.players = S.players.filter(p => p.connected);
    for (const p of S.players) { p.score = 0; p.gems = 3; p.words = 0; p.best = null; }
    S.round = 1; S.turnIdx = 0; S.phase = 'playing'; S.events = [];
    this.newBoard(); this.placeMults();
    this.event({ type: 'round', round: 1 });
    this.startTurn();
  },
  startTurn() {
    const S = this.S;
    S.turnEndsAt = S.settings.timer ? Date.now() + S.settings.timer * 1000 : 0;
    clearTimeout(this.skipTO);
    if (!this.cur().connected) this.scheduleSkip();
  },
  scheduleSkip() {
    clearTimeout(this.skipTO);
    this.skipTO = setTimeout(() => {
      if (this.S.phase === 'playing' && !this.cur().connected) {
        this.event({ type: 'pass', pid: this.cur().pid, why: 'away' });
        this.advance(); this.broadcast();
      }
    }, 1800);
  },
  advance() {
    const S = this.S;
    S.turnIdx++;
    if (S.turnIdx >= S.players.length) {
      S.turnIdx = 0; S.round++;
      if (S.round > S.settings.rounds) return this.endGame();
      this.placeMults();
      this.event({ type: 'round', round: S.round });
    }
    this.startTurn();
  },
  endGame() {
    const S = this.S;
    S.phase = 'over'; S.turnEndsAt = 0; S.round = S.settings.rounds;
    clearTimeout(this.skipTO);
    this.event({ type: 'over' });
  },
  onTick() {
    const S = this.S;
    if (S && S.phase === 'playing' && S.turnEndsAt && Date.now() > S.turnEndsAt) {
      this.event({ type: 'pass', pid: this.cur().pid, why: 'time' });
      this.advance(); this.broadcast();
    }
  },

  handle(pid, m) {
    const S = this.S, p = this.player(pid);
    const err = msg => this.sendTo(pid, { t: 'err', msg });
    if (!m || typeof m !== 'object') return;
    if (m.t === 'trace') {
      if (S.phase === 'playing' && this.cur() && this.cur().pid === pid && Array.isArray(m.path) && m.path.length <= N)
        this.relay(pid, { t: 'trace', pid, path: m.path.filter(Number.isInteger) });
      return;
    }
    if (!p) return;
    if (m.t === 'settings' && pid === S.hostPid && S.phase === 'lobby') {
      for (const k of Object.keys(SETTING_OPTS))
        if (m.settings && SETTING_OPTS[k].some(o => o[0] === m.settings[k])) S.settings[k] = m.settings[k];
      return this.broadcast();
    }
    if (m.t === 'start' && pid === S.hostPid && S.phase !== 'playing') { this.startGame(); return this.broadcast(); }
    if (m.t === 'lobby' && pid === S.hostPid && S.phase === 'over') {
      S.phase = 'lobby'; S.players = S.players.filter(q => q.connected); return this.broadcast();
    }

    if (S.phase !== 'playing') return;
    const mine = this.cur().pid === pid;
    if (!mine) return err("It's not your turn yet.");

    switch (m.t) {
      case 'submit': {
        if (!validPathShape(m.path)) return err('Those tiles are not connected.');
        const word = pathWord(S.board, m.path);
        if (word.length < S.settings.minLen) return err(`Words need at least ${S.settings.minLen} letters.`);
        if (!WORDSET.has(word)) return err(`"${word.toUpperCase()}" is not in the spellbook.`);
        const pts = scorePath(S.board, m.path);
        const gems = m.path.filter(i => S.board[i].g).length;
        const before = p.gems;
        p.gems = Math.min(GEM_CAP, p.gems + gems);
        p.score += pts; p.words++;
        if (!p.best || pts > p.best.pts) p.best = { word, pts };
        this.event({ type: 'cast', pid, word, pts, path: m.path, gems: p.gems - before,
                     letters: m.path.map(i => S.board[i].l) });
        this.refill(m.path);
        this.advance();
        return this.broadcast();
      }
      case 'pass':
        this.event({ type: 'pass', pid, why: 'chose' });
        this.advance();
        return this.broadcast();
      case 'shuffle': {
        if (p.gems < COST.shuffle) return err('Not enough crystals.');
        p.gems -= COST.shuffle;
        const letters = S.board.map(t => t.l).sort(() => Math.random() - 0.5);
        S.board.forEach((t, i) => { t.l = letters[i]; });
        this.event({ type: 'shuffle', pid });
        return this.broadcast();
      }
      case 'swap': {
        if (p.gems < COST.swap) return err('Not enough crystals.');
        if (!Number.isInteger(m.idx) || m.idx < 0 || m.idx >= N || !ALPHA.includes(m.letter)) return;
        if (S.board[m.idx].l === m.letter) return err('That tile already has that letter.');
        p.gems -= COST.swap;
        S.board[m.idx].l = m.letter;
        this.event({ type: 'swap', pid, idx: m.idx, letter: m.letter });
        return this.broadcast();
      }
      case 'hint': {
        if (p.gems < COST.hint) return err('Not enough crystals.');
        const best = solveBest(S.board, S.settings.minLen);
        if (!best) return err('No words found — try a shuffle.');
        p.gems -= COST.hint;
        this.event({ type: 'hint', pid });
        this.broadcast();
        return this.sendTo(pid, { t: 'hint', ...best });
      }
    }
  },

  snapshot() {
    const S = this.S;
    return JSON.parse(JSON.stringify({ ...S, turnMsLeft: S.turnEndsAt ? Math.max(0, S.turnEndsAt - Date.now()) : 0 }));
  },
  broadcast() {
    const msg = { t: 'state', s: this.snapshot() };
    for (const [, c] of this.conns) if (c.open) safeSend(c, msg);
    onMessage(msg);
  },
  sendTo(pid, msg) {
    if (pid === this.S.hostPid) return onMessage(msg);
    const c = this.conns.get(pid); if (c && c.open) safeSend(c, msg);
  },
  relay(fromPid, msg) {
    for (const [pid, c] of this.conns) if (pid !== fromPid && c.open) safeSend(c, msg);
    if (fromPid !== this.S.hostPid) onMessage(msg);
  }
};
function safeSend(c, msg) { try { c.send(msg); } catch (e) { /* closed */ } }

// =====================================================================
// Networking
// =====================================================================
const Net = { peer: null, conn: null, isHost: false, code: '', pid: '', retries: 0, closing: false };

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
};
const randId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const CODE_CHARS = 'BCDFGHJKLMNPQRSTVWXZ';
const randCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');

function myName() { return (els.nameInput.value.trim() || 'Wizard').slice(0, 16); }

function createRoom(attempt = 0) {
  if (!window.Peer) return homeMsg('Could not load the networking library. Check your connection.');
  teardown();
  const code = randCode();
  homeMsg('Opening a portal…');
  Net.isHost = true; Net.code = code; Net.pid = 'host-' + randId();
  const peer = new Peer(PREFIX + code, PEER_OPTS);
  Net.peer = peer;
  const stall = setTimeout(() => {
    if (peer === Net.peer && !peer.open) homeMsg("Couldn't reach the matchmaking server. Check your connection or try another network, then click Create again.");
  }, 12000);
  peer.on('open', () => {
    clearTimeout(stall);
    Host.init(code);
    Host.S.hostPid = Net.pid;
    Host.addPlayer(Net.pid, myName());
    me.pid = Net.pid;
    homeMsg('');
    setRoomInUrl(code);
    Host.broadcast();
  });
  peer.on('connection', conn => {
    conn.on('data', d => {
      if (d && d.t === 'hello') {
        const pid = typeof d.pid === 'string' && d.pid.length < 40 ? d.pid : randId();
        const old = Host.conns.get(pid);
        if (old && old !== conn) { old.__replaced = true; try { old.close(); } catch (e) {} }
        conn.__pid = pid;
        const p = Host.addPlayer(pid, String(d.name || 'Wizard').trim().slice(0, 16) || 'Wizard');
        if (!p) { safeSend(conn, { t: 'err', msg: 'That room is full (8 wizards max).', fatal: true }); return; }
        Host.conns.set(pid, conn);
        safeSend(conn, { t: 'welcome', pid });
        Host.broadcast();
        return;
      }
      if (conn.__pid) Host.handle(conn.__pid, d);
    });
    conn.on('close', () => {
      if (conn.__pid && !conn.__replaced && Host.conns.get(conn.__pid) === conn) {
        Host.conns.delete(conn.__pid);
        Host.dropPlayer(conn.__pid);
      }
    });
  });
  peer.on('disconnected', () => { if (!Net.closing && peer === Net.peer) try { peer.reconnect(); } catch (e) {} });
  peer.on('error', e => {
    if (e.type === 'unavailable-id' && attempt < 4) return createRoom(attempt + 1);
    if (e.type === 'peer-unavailable') return;
    homeMsg('Network trouble: ' + (e.type || e.message));
  });
}

function joinRoom(code) {
  code = (code || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (code.length !== 4) return homeMsg('Room codes are 4 letters.');
  if (!window.Peer) return homeMsg('Could not load the networking library. Check your connection.');
  teardown();
  Net.isHost = false; Net.code = code;
  Net.pid = store.get('gb-pid-' + code) || randId();
  store.set('gb-pid-' + code, Net.pid);
  homeMsg('Searching for room ' + code + '…');
  const peer = new Peer(undefined, PEER_OPTS);
  Net.peer = peer;
  const stall = setTimeout(() => {
    if (peer !== Net.peer || Net.everConnected) return;
    homeMsg(peer.open
      ? `Found room ${code} but couldn't link to the host. One of your networks is blocking direct connections. Try again, or switch one player to a different network (e.g. a phone hotspot).`
      : "Couldn't reach the matchmaking server. Check your connection, then try Join again.");
  }, 15000);
  peer.on('open', () => connectToHost());
  peer.on('close', () => clearTimeout(stall));
  peer.on('error', e => {
    if (e.type === 'peer-unavailable') {
      if (Net.conn && Net.everConnected) return scheduleReconnect();
      homeMsg(`No room called ${code}. Check the code with your host.`);
      teardown();
      return;
    }
    if (e.type === 'network' || e.type === 'server-error') return scheduleReconnect();
    homeMsg('Network trouble: ' + (e.type || e.message));
  });
  peer.on('disconnected', () => { if (!Net.closing && peer === Net.peer) try { peer.reconnect(); } catch (er) {} });
}
function connectToHost() {
  const conn = Net.peer.connect(PREFIX + Net.code, { reliable: true });
  Net.conn = conn;
  conn.on('open', () => {
    Net.retries = 0; Net.everConnected = true;
    safeSend(conn, { t: 'hello', pid: Net.pid, name: myName() });
    hideToastKey('reconnect');
  });
  conn.on('data', onMessage);
  conn.on('close', () => { if (!Net.closing && conn === Net.conn) scheduleReconnect(); });
}
function scheduleReconnect() {
  if (Net.closing || Net.isHost) return;
  if (Net.retries++ > 12) { toast('Lost the host. The room may have closed.', 'bad'); return goHome(); }
  toast('Connection lost — reconnecting…', 'warn', 'reconnect');
  setTimeout(() => {
    if (Net.closing || !Net.peer) return;
    if (Net.peer.disconnected) { try { Net.peer.reconnect(); } catch (e) {} }
    connectToHost();
  }, 1500);
}
function teardown() {
  Net.closing = true;
  try { Net.conn && Net.conn.close(); } catch (e) {}
  try { Net.peer && Net.peer.destroy(); } catch (e) {}
  if (Net.isHost) { clearInterval(Host.tick); Host.conns.clear(); }
  Net.peer = null; Net.conn = null; Net.retries = 0; Net.everConnected = false;
  Net.closing = false;
}
function send(m) {
  if (Net.isHost) return Host.handle(Net.pid, m);
  if (Net.conn && Net.conn.open) safeSend(Net.conn, m);
}
function setRoomInUrl(code) {
  try { const u = new URL(location.href); u.searchParams.set('room', code); history.replaceState(null, '', u); } catch (e) {}
}
function inviteLink() {
  try { const u = new URL(location.href); u.search = ''; u.hash = ''; u.searchParams.set('room', Net.code); return u.toString(); }
  catch (e) { return Net.code; }
}

// =====================================================================
// Client state + message handling
// =====================================================================
const me = { pid: '' };
let S = null;                 // latest snapshot
let lastSeq = 0;
let path = [];                // my current trace
let hint = null;              // {path, word, pts}
let swapPick = false;
let otherTrace = null;        // {pid, path}
let deadline = 0;

function onMessage(m) {
  if (!m) return;
  switch (m.t) {
    case 'welcome': me.pid = m.pid; break;
    case 'state': applyState(m.s); break;
    case 'trace': otherTrace = { pid: m.pid, path: m.path }; drawPath(); break;
    case 'err':
      toast(m.msg, 'bad'); sfx.bad();
      if (m.fatal) goHome();
      break;
    case 'hint':
      hint = { path: m.path, word: m.word, pts: m.pts };
      toast(`Hint: ${m.word.toUpperCase()} for ${m.pts}`, 'good');
      drawPath();
      break;
  }
}

function applyState(s) {
  const prev = S;
  S = s;
  deadline = s.turnMsLeft ? Date.now() + s.turnMsLeft : 0;
  if (!me.pid) me.pid = Net.pid;
  const myTurnNow = isMyTurn();
  const turnChanged = !prev || prev.turnIdx !== s.turnIdx || prev.round !== s.round || prev.phase !== s.phase;
  if (turnChanged) { path = []; hint = null; otherTrace = null; swapPick = false; closePicker(); }

  if (s.phase === 'lobby') { show('lobby'); renderLobby(); lastSeq = maxSeq(s); closeModal(els.overModal); return; }
  show('game');
  const fresh = s.events.filter(e => e.seq > lastSeq);
  const firstLoad = lastSeq === 0 && prev?.phase !== 'playing';
  lastSeq = maxSeq(s);
  renderGame(prev, firstLoad ? [] : fresh);
  if (s.phase === 'over') setTimeout(showResults, firstLoad ? 0 : 1400);
  else closeModal(els.overModal);
  if (turnChanged && myTurnNow && s.phase === 'playing') { sfx.turn(); banner('Your turn'); }
}
const maxSeq = s => s.events.reduce((a, e) => Math.max(a, e.seq), 0);
const isMyTurn = () => S && S.phase === 'playing' && S.players[S.turnIdx] && S.players[S.turnIdx].pid === me.pid;
const playerBy = pid => S && S.players.find(p => p.pid === pid);
const myPlayer = () => playerBy(me.pid);

// =====================================================================
// DOM
// =====================================================================
const $ = id => document.getElementById(id);
const els = {};
['nameInput', 'createBtn', 'codeInput', 'joinBtn', 'howBtn', 'homeMsg', 'lobbyCode', 'copyLinkBtn', 'lobbyPlayers',
 'settingsBox', 'startBtn', 'lobbyMsg', 'leaveLobbyBtn', 'roundPips', 'roomTag', 'muteBtn', 'playerList', 'wordBar',
 'wordText', 'wordPts', 'boardWrap', 'pathSvg', 'board', 'fxLayer', 'turnBanner', 'clearBtn', 'castBtn', 'toasts',
 'overModal', 'winnerName', 'podium', 'againBtn', 'homeBtn', 'overMsg', 'pickerModal', 'letterGrid', 'pickerCancel',
 'howModal', 'howClose'].forEach(id => { els[id] = $(id); });

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function show(name) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('active', s.id === 'screen-' + name);
}
function homeMsg(t) { els.homeMsg.textContent = t; }
function openModal(m) { m.classList.add('open'); }
function closeModal(m) { m.classList.remove('open'); }

// ---------- Lobby ----------
function renderLobby() {
  els.lobbyCode.textContent = S.code;
  els.lobbyPlayers.replaceChildren(...S.players.map(p => {
    const li = el('li', 'lp');
    li.append(avatar(p), el('span', 'lp-name', p.name));
    if (p.pid === S.hostPid) li.append(el('span', 'tag', 'Host'));
    if (p.pid === me.pid) li.append(el('span', 'tag tag-you', 'You'));
    return li;
  }));
  const host = Net.isHost;
  for (const seg of els.settingsBox.querySelectorAll('.seg')) {
    const key = seg.dataset.key;
    seg.replaceChildren(...SETTING_OPTS[key].map(([v, label]) => {
      const b = el('button', 'seg-btn' + (S.settings[key] === v ? ' on' : ''), label);
      b.disabled = !host;
      b.onclick = () => send({ t: 'settings', settings: { ...S.settings, [key]: v } });
      return b;
    }));
  }
  els.startBtn.style.display = host ? '' : 'none';
  els.lobbyMsg.textContent = host
    ? (S.players.length < 2 ? 'Share the code or invite link — or start solo to practice.' : 'Everyone here? Begin when ready.')
    : 'Waiting for the host to begin…';
}
function avatar(p) {
  const a = el('span', 'avatar', (p.name[0] || '?').toUpperCase());
  a.style.setProperty('--pc', p.color);
  return a;
}

// ---------- Game ----------
const tileEls = [];
function buildBoard() {
  for (let i = 0; i < N; i++) {
    const t = el('div', 'tile');
    t.dataset.i = i;
    t.innerHTML = '<span class="t-letter"></span><span class="t-val"></span><span class="t-gem"></span><span class="t-mult"></span>';
    els.board.append(t); tileEls.push(t);
  }
}

function renderGame(prev, events) {
  // header
  els.roomTag.textContent = 'Room ' + S.code;
  els.roundPips.replaceChildren(...Array.from({ length: S.settings.rounds }, (_, k) => {
    const d = el('span', 'pip' + (k + 1 < S.round ? ' done' : k + 1 === S.round ? ' now' : ''));
    d.textContent = k + 1; return d;
  }));
  renderPlayers();
  renderBoard(events);
  renderControls();
  drawPath();
  for (const e of events) playEvent(e, prev);
}

function renderPlayers() {
  const cur = S.players[S.turnIdx];
  const ranked = [...S.players].sort((a, b) => b.score - a.score);
  const leader = ranked[0] && ranked[0].score > 0 ? ranked[0].pid : null;
  els.playerList.replaceChildren(...S.players.map(p => {
    const card = el('div', 'pcard' + (cur === p && S.phase === 'playing' ? ' active' : '') + (p.connected ? '' : ' away'));
    card.style.setProperty('--pc', p.color);
    card.dataset.pid = p.pid;
    const top = el('div', 'pc-top');
    const nm = el('div', 'pc-name', p.name);
    if (p.pid === me.pid) nm.append(el('span', 'tag tag-you', 'You'));
    if (p.pid === leader) nm.append(el('span', 'crown', '♛'));
    top.append(avatar(p), nm);
    const score = el('div', 'pc-score', String(p.score));
    const gems = el('div', 'pc-gems');
    for (let k = 0; k < GEM_CAP; k++) gems.append(el('i', k < p.gems ? 'on' : ''));
    card.append(top, score, gems);
    if (cur === p && S.phase === 'playing') {
      const ring = el('div', 'pc-timer'); ring.innerHTML = '<i></i>'; card.append(ring);
    }
    if (!p.connected) card.append(el('div', 'pc-away', 'away'));
    return card;
  }));
}

function renderBoard(events) {
  const swappedIdx = new Set(events.filter(e => e.type === 'swap').map(e => e.idx));
  const shuffled = events.some(e => e.type === 'shuffle');
  S.board.forEach((t, i) => {
    const e = tileEls[i];
    const isNew = e.dataset.tid && +e.dataset.tid !== t.id;
    const letterChanged = e.dataset.l !== t.l;
    e.dataset.tid = t.id; e.dataset.l = t.l;
    e.querySelector('.t-letter').textContent = t.l === 'q' ? 'Q' : t.l.toUpperCase();
    e.querySelector('.t-val').textContent = VAL[t.l];
    e.classList.toggle('gem', !!t.g);
    e.classList.remove('m-DL', 'm-TL', 'm-DW');
    if (t.m) e.classList.add('m-' + t.m);
    e.querySelector('.t-mult').textContent = t.m === 'DW' ? '2×' : t.m || '';
    if (isNew) restartAnim(e, 'spawn', i);
    else if (shuffled && letterChanged) restartAnim(e, 'flip', i);
    else if (swappedIdx.has(i)) restartAnim(e, 'swapped', 0);
  });
}
function restartAnim(e, cls, i) {
  e.classList.remove('spawn', 'flip', 'swapped');
  e.style.setProperty('--d', ((i % SIZE) * 35 + Math.floor(i / SIZE) * 25) + 'ms');
  void e.offsetWidth;
  e.classList.add(cls);
}

function renderControls() {
  const mine = isMyTurn();
  const p = myPlayer();
  document.body.classList.toggle('my-turn', mine);
  els.castBtn.disabled = !mine;
  els.clearBtn.disabled = !mine;
  for (const b of document.querySelectorAll('.power')) {
    const k = b.dataset.power;
    b.disabled = !mine || (COST[k] && (!p || p.gems < COST[k]));
    if (k === 'swap' && b.disabled) swapPick = false;   // can't stay armed if unusable
  }
  for (const b of document.querySelectorAll('.power')) b.classList.toggle('armed', b.dataset.power === 'swap' && swapPick);
  updateWordBar();
}

function updateWordBar() {
  els.wordBar.className = 'word-bar';
  if (!S || S.phase !== 'playing') { els.wordText.textContent = ''; els.wordPts.textContent = ''; return; }
  const cur = S.players[S.turnIdx];
  if (swapPick) {
    els.wordText.textContent = 'Pick a tile to swap';
    els.wordPts.textContent = '';
    els.wordBar.classList.add('info');
    return;
  }
  if (!isMyTurn()) {
    const tp = otherTrace && otherTrace.pid === cur.pid ? otherTrace.path : [];
    const w = tp.filter(i => S.board[i]).map(i => S.board[i].l).join('');
    els.wordText.textContent = w ? w.toUpperCase() : `${cur.name} is spelling…`;
    els.wordText.style.color = w ? cur.color : '';
    els.wordPts.textContent = '';
    els.wordBar.classList.add('watch');
    return;
  }
  els.wordText.style.color = '';
  if (!path.length) {
    els.wordText.textContent = 'Trace a word';
    els.wordPts.textContent = '';
    els.wordBar.classList.add('idle');
    return;
  }
  const w = pathWord(S.board, path);
  const ok = w.length >= S.settings.minLen && WORDSET.has(w);
  els.wordText.textContent = w.toUpperCase();
  els.wordPts.textContent = ok ? '+' + scorePath(S.board, path) : '';
  els.wordBar.classList.add(ok ? 'valid' : 'invalid');
  els.castBtn.classList.toggle('ready', ok);
}

// ---------- Path drawing ----------
function center(i) {
  const t = tileEls[i];
  return [t.offsetLeft + t.offsetWidth / 2, t.offsetTop + t.offsetHeight / 2];
}
function drawPath() {
  if (!S || S.phase === 'lobby') return;
  const svg = els.pathSvg;
  svg.setAttribute('viewBox', `0 0 ${els.boardWrap.clientWidth} ${els.boardWrap.clientHeight}`);
  const cur = S.players[S.turnIdx];
  let p = [], color = '#5ef2d6', ghost = false;
  if (isMyTurn()) {
    p = path; color = myPlayer()?.color || color;
    if (!p.length && hint) { p = hint.path; ghost = true; }
  } else if (otherTrace && cur && otherTrace.pid === cur.pid) {
    p = otherTrace.path.filter(i => i >= 0 && i < N); color = cur.color;
  }
  const sel = new Set(p);
  tileEls.forEach((t, i) => {
    t.classList.toggle('sel', sel.has(i) && !ghost);
    t.classList.toggle('hinted', ghost && sel.has(i));
    t.classList.toggle('head', !ghost && p[p.length - 1] === i);
    t.style.setProperty('--pc', color);
  });
  const pts = p.map(center);
  svg.innerHTML = '';
  if (pts.length > 1) {
    const d = 'M' + pts.map(q => q.join(',')).join(' L');
    const glow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    glow.setAttribute('d', d); glow.setAttribute('class', 'trail-glow'); glow.style.stroke = color;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    line.setAttribute('d', d); line.setAttribute('class', 'trail' + (ghost ? ' ghost' : '')); line.style.stroke = color;
    svg.append(glow, line);
  }
  if (!isMyTurn() || !path.length) updateWordBar();
}

// ---------- Input ----------
let dragging = false, moved = false, downIdx = -1, tapSubmit = false;

function tileAt(x, y) {
  for (let i = 0; i < N; i++) {
    const r = tileEls[i].getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const rad = r.width * 0.46;
    if (Math.abs(x - cx) < rad && Math.abs(y - cy) < rad) {
      // a circular-ish hit zone makes diagonal drags reliable
      if (Math.hypot(x - cx, y - cy) < r.width * 0.56) return i;
    }
  }
  return -1;
}
function setPath(p) {
  path = p; hint = null;
  drawPath(); updateWordBar();
  sendTrace();
}
let traceTO = null, lastTraceSent = '';
function sendTrace() {
  clearTimeout(traceTO);
  traceTO = setTimeout(() => {
    const k = path.join(',');
    if (k !== lastTraceSent) { lastTraceSent = k; send({ t: 'trace', path }); }
  }, 40);
}

els.board.addEventListener('pointerdown', ev => {
  if (!isMyTurn()) return;
  const i = tileAt(ev.clientX, ev.clientY);
  if (i < 0) return;
  ev.preventDefault();
  if (swapPick) { openPicker(i); return; }
  try { els.board.setPointerCapture(ev.pointerId); } catch (e) {}
  dragging = true; moved = false; downIdx = i; tapSubmit = false;
  const last = path[path.length - 1];
  if (path.length && i === last) tapSubmit = true;
  else if (path.length && adjacent(last, i) && !path.includes(i)) { setPath([...path, i]); sfx.tick(path.length); }
  else { setPath([i]); sfx.tick(1); }
});
els.board.addEventListener('pointermove', ev => {
  if (!dragging) return;
  const i = tileAt(ev.clientX, ev.clientY);
  if (i < 0 || i === path[path.length - 1]) return;
  if (path.length > 1 && i === path[path.length - 2]) { moved = true; setPath(path.slice(0, -1)); sfx.tick(path.length); return; }
  if (!path.includes(i) && adjacent(path[path.length - 1], i)) { moved = true; setPath([...path, i]); sfx.tick(path.length); }
});
function endDrag() {
  if (!dragging) return;
  dragging = false;
  if (moved) { if (path.length >= 2) submit(); }
  else if (tapSubmit) submit();
}
els.board.addEventListener('pointerup', endDrag);
els.board.addEventListener('pointercancel', () => { dragging = false; });

function submit() {
  if (!isMyTurn() || !path.length) return;
  const w = pathWord(S.board, path);
  if (w.length < S.settings.minLen || !WORDSET.has(w)) {
    sfx.bad();
    els.boardWrap.classList.remove('shake'); void els.boardWrap.offsetWidth; els.boardWrap.classList.add('shake');
    toast(w.length < S.settings.minLen ? `Words need ${S.settings.minLen}+ letters.` : `"${w.toUpperCase()}" isn't in the spellbook.`, 'bad');
    setPath([]);
    return;
  }
  send({ t: 'submit', path });
}
els.castBtn.onclick = () => { if (!path.length && hint) { path = hint.path.slice(); } submit(); };
els.clearBtn.onclick = () => setPath([]);
document.addEventListener('keydown', ev => {
  if (ev.target.tagName === 'INPUT') return;
  // preventDefault stops Enter from also "clicking" whatever button has focus
  if (ev.key === 'Enter') {
    if (!document.getElementById('screen-game').classList.contains('active')) return;
    ev.preventDefault(); els.castBtn.click();
  }
  if (ev.key === 'Escape') { if (swapPick) { swapPick = false; renderControls(); } setPath([]); closePicker(); }
  if (ev.key === 'Backspace' && path.length) setPath(path.slice(0, -1));
});

for (const b of document.querySelectorAll('.power')) {
  b.onclick = () => {
    const k = b.dataset.power;
    if (!isMyTurn()) return;
    if (k === 'swap') { swapPick = !swapPick; setPath([]); renderControls(); return; }
    if (swapPick) { swapPick = false; closePicker(); renderControls(); }   // picking another power cancels Swap
    if (k === 'pass') { send({ t: 'pass' }); return; }
    send({ t: k });
  };
}
// Mouse clicks on game buttons shouldn't leave them focused (or start a text selection);
// keyboard Tab focus still works normally.
for (const b of [els.castBtn, els.clearBtn, ...document.querySelectorAll('.power')]) {
  b.addEventListener('mousedown', ev => ev.preventDefault());
}

// ---------- Swap picker ----------
let pickIdx = -1;
function openPicker(i) {
  pickIdx = i;
  els.letterGrid.replaceChildren(...ALPHA.map(l => {
    const b = el('button', 'lg-btn');
    b.innerHTML = `<b>${l.toUpperCase()}</b><small>${VAL[l]}</small>`;
    b.disabled = S.board[i].l === l;
    b.onclick = () => { send({ t: 'swap', idx: pickIdx, letter: l }); swapPick = false; closePicker(); renderControls(); };
    return b;
  }));
  openModal(els.pickerModal);
}
function closePicker() { closeModal(els.pickerModal); }
els.pickerCancel.onclick = () => { closePicker(); swapPick = false; renderControls(); };

// ---------- Events / FX ----------
function playEvent(e) {
  const p = playerBy(e.pid);
  switch (e.type) {
    case 'cast': {
      burst(e.path, p ? p.color : '#fff', e.pts);
      sfx.cast(e.pts);
      const who = e.pid === me.pid ? 'You' : (p ? p.name : 'Someone');
      toast(`${who} cast ${e.word.toUpperCase()} · +${e.pts}${e.gems ? `  ·  +${e.gems} ◆` : ''}`, 'cast', null, p && p.color);
      bumpScore(e.pid);
      break;
    }
    case 'shuffle': sfx.whoosh(); toast(`${nameOf(e.pid)} reshuffled the board`, 'info'); break;
    case 'swap': sfx.whoosh(); toast(`${nameOf(e.pid)} swapped a rune to ${e.letter.toUpperCase()}`, 'info'); break;
    case 'hint': if (e.pid !== me.pid) toast(`${nameOf(e.pid)} peeked at a hint`, 'info'); break;
    case 'pass': toast(e.why === 'time' ? `${nameOf(e.pid)} ran out of time` : e.why === 'away' ? `${nameOf(e.pid)} is away — skipped` : `${nameOf(e.pid)} passed`, 'info'); break;
    case 'round': if (e.round > 1) { banner(`Round ${e.round}` + (e.round === S.settings.rounds ? ' · Final' : '')); sfx.round(); } break;
    case 'join': toast(`${nameOf(e.pid)} joined the duel`, 'info'); break;
  }
}
function nameOf(pid) { return pid === me.pid ? 'You' : (playerBy(pid)?.name || 'Someone'); }
function bumpScore(pid) {
  const c = els.playerList.querySelector(`[data-pid="${CSS.escape(pid)}"] .pc-score`);
  if (c) { c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump'); }
}

function burst(p, color, pts) {
  const layer = els.fxLayer;
  const centers = p.map(center);
  centers.forEach(([x, y], k) => {
    for (let n = 0; n < 9; n++) {
      const s = el('i', 'spark');
      s.style.left = x + 'px'; s.style.top = y + 'px'; s.style.background = n % 3 ? color : '#fff6d8';
      layer.append(s);
      const a = Math.random() * Math.PI * 2, d = 30 + Math.random() * 70;
      s.animate([
        { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
        { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d}px)) scale(0)`, opacity: 0 }
      ], { duration: 600 + Math.random() * 400, delay: k * 40, easing: 'cubic-bezier(.2,.7,.3,1)' }).onfinish = () => s.remove();
    }
    const ring = el('i', 'ring'); ring.style.left = x + 'px'; ring.style.top = y + 'px'; ring.style.borderColor = color;
    layer.append(ring);
    ring.animate([{ transform: 'translate(-50%,-50%) scale(.3)', opacity: .9 }, { transform: 'translate(-50%,-50%) scale(1.6)', opacity: 0 }],
      { duration: 550, delay: k * 40, easing: 'ease-out' }).onfinish = () => ring.remove();
  });
  const mid = centers.reduce((a, c) => [a[0] + c[0] / centers.length, a[1] + c[1] / centers.length], [0, 0]);
  const f = el('div', 'float-pts', '+' + pts);
  f.style.left = mid[0] + 'px'; f.style.top = mid[1] + 'px'; f.style.color = color;
  layer.append(f);
  f.animate([
    { transform: 'translate(-50%,-30%) scale(.6)', opacity: 0 },
    { transform: 'translate(-50%,-80%) scale(1.15)', opacity: 1, offset: .25 },
    { transform: 'translate(-50%,-160%) scale(1)', opacity: 0 }
  ], { duration: 1500, easing: 'cubic-bezier(.2,.8,.3,1)' }).onfinish = () => f.remove();
}

function banner(text) {
  const b = els.turnBanner;
  b.textContent = text;
  b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
}

let toastKeys = {};
function toast(text, kind = 'info', key = null, color = null) {
  if (key && toastKeys[key]) toastKeys[key].remove();
  const t = el('div', 'toast toast-' + kind, text);
  if (color) t.style.setProperty('--pc', color);
  els.toasts.append(t);
  while (els.toasts.children.length > 4) els.toasts.firstChild.remove();
  if (key) toastKeys[key] = t;
  else setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, 3200);
}
function hideToastKey(key) { if (toastKeys[key]) { toastKeys[key].remove(); delete toastKeys[key]; } }

// ---------- Timer ----------
function timerLoop() {
  requestAnimationFrame(timerLoop);
  if (!S || S.phase !== 'playing') return;
  const ring = els.playerList.querySelector('.pcard.active .pc-timer i');
  if (!ring) return;
  if (!S.settings.timer || !deadline) { ring.parentElement.style.display = 'none'; return; }
  const left = Math.max(0, deadline - Date.now());
  const frac = left / (S.settings.timer * 1000);
  ring.style.width = (frac * 100) + '%';
  ring.parentElement.classList.toggle('low', left < 10000);
}
requestAnimationFrame(timerLoop);

// ---------- Results ----------
function showResults() {
  if (!S || S.phase !== 'over') return;
  const ranked = [...S.players].sort((a, b) => b.score - a.score);
  const top = ranked[0];
  const tie = ranked.length > 1 && ranked[1].score === top.score;
  els.winnerName.textContent = tie ? 'A tie!' : `${top.name} wins!`;
  els.winnerName.style.color = tie ? '' : top.color;
  els.podium.replaceChildren(...ranked.map((p, k) => {
    const li = el('li', 'pod' + (k === 0 ? ' first' : ''));
    li.style.setProperty('--pc', p.color);
    li.append(el('span', 'pod-rank', String(k + 1)), avatar(p));
    const info = el('div', 'pod-info');
    info.append(el('b', '', p.name), el('small', '', p.best ? `Best: ${p.best.word.toUpperCase()} (${p.best.pts})` : 'No words cast'));
    li.append(info, el('span', 'pod-score', String(p.score)));
    return li;
  }));
  els.againBtn.style.display = Net.isHost ? '' : 'none';
  els.overMsg.textContent = Net.isHost ? '' : 'Waiting for the host to start another duel…';
  if (!els.overModal.classList.contains('open')) { sfx.win(); openModal(els.overModal); }
}
els.againBtn.onclick = () => send({ t: 'start' });
els.homeBtn.onclick = () => goHome();

function goHome() {
  teardown();
  S = null; lastSeq = 0; path = []; hint = null;
  closeModal(els.overModal); closePicker();
  try { const u = new URL(location.href); u.searchParams.delete('room'); history.replaceState(null, '', u); } catch (e) {}
  show('home');
}

// ---------- Home wiring ----------
els.nameInput.value = store.get('gb-name') || '';
els.nameInput.addEventListener('input', () => store.set('gb-name', els.nameInput.value.trim()));
els.createBtn.onclick = () => { sfx.unlock(); createRoom(); };
els.joinBtn.onclick = () => { sfx.unlock(); joinRoom(els.codeInput.value); };
els.codeInput.addEventListener('input', () => { els.codeInput.value = els.codeInput.value.toUpperCase().replace(/[^A-Z]/g, ''); });
els.codeInput.addEventListener('keydown', e => { if (e.key === 'Enter') els.joinBtn.click(); });
els.startBtn.onclick = () => send({ t: 'start' });
els.leaveLobbyBtn.onclick = () => goHome();
els.copyLinkBtn.onclick = async () => {
  const link = inviteLink();
  try { await navigator.clipboard.writeText(link); els.copyLinkBtn.textContent = 'Copied!'; }
  catch (e) { prompt('Copy this invite link:', link); }
  setTimeout(() => { els.copyLinkBtn.textContent = 'Copy invite link'; }, 1600);
};
els.howBtn.onclick = () => openModal(els.howModal);
els.howClose.onclick = () => closeModal(els.howModal);
for (const m of [els.howModal]) m.addEventListener('click', e => { if (e.target === m) closeModal(m); });

try {
  const room = new URL(location.href).searchParams.get('room');
  if (room) {
    const code = room.toUpperCase().slice(0, 4);
    els.codeInput.value = code;
    if (store.get('gb-pid-' + code) && store.get('gb-name')) joinRoom(code);   // refreshed mid-game: rejoin
    else homeMsg('Enter your name and press Join.');
  }
} catch (e) {}

window.addEventListener('resize', () => drawPath());

// =====================================================================
// Sound (tiny WebAudio synth)
// =====================================================================
const sfx = (() => {
  let ctx = null, muted = store.get('gb-mute') === '1';
  const setIcon = () => { els.muteBtn.textContent = muted ? '🔇' : '🔊'; };
  setIcon();
  els.muteBtn.onclick = () => { muted = !muted; store.set('gb-mute', muted ? '1' : '0'); setIcon(); };
  function unlock() { try { if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state === 'suspended') ctx.resume(); } catch (e) {} }
  document.addEventListener('pointerdown', unlock, { once: true });
  function tone(f, dur = 0.12, type = 'sine', gain = 0.12, delay = 0, slide = 0) {
    if (muted || !ctx) return;
    const t0 = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(f * slide, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(ctx.destination); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
  return {
    unlock,
    tick: n => tone(392 * Math.pow(2, scale[Math.min(n - 1, scale.length - 1)] / 12), 0.09, 'triangle', 0.09),
    cast: pts => { const base = pts > 40 ? 523 : 440; [0, 4, 7, 12].forEach((s, k) => tone(base * Math.pow(2, s / 12), 0.35, 'sine', 0.1, k * 0.06)); tone(base * 2, 0.6, 'triangle', 0.05, 0.25); },
    bad: () => { tone(180, 0.18, 'sawtooth', 0.05, 0, 0.7); },
    turn: () => { tone(659, 0.2, 'sine', 0.08); tone(988, 0.35, 'sine', 0.07, 0.1); },
    round: () => { [0, 7, 12].forEach((s, k) => tone(330 * Math.pow(2, s / 12), 0.4, 'triangle', 0.07, k * 0.09)); },
    whoosh: () => tone(300, 0.3, 'triangle', 0.06, 0, 2.2),
    win: () => { [0, 4, 7, 12, 16, 19, 24].forEach((s, k) => tone(392 * Math.pow(2, s / 12), 0.5, 'sine', 0.08, k * 0.08)); }
  };
})();

// =====================================================================
// Background sky
// =====================================================================
(function sky() {
  const c = $('sky'), g = c.getContext('2d');
  let w, h, stars = [];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function resize() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    w = c.width = innerWidth * dpr; h = c.height = innerHeight * dpr;
    c.style.width = innerWidth + 'px'; c.style.height = innerHeight + 'px';
    stars = Array.from({ length: Math.round((innerWidth * innerHeight) / 5000) }, () => ({
      x: Math.random() * w, y: Math.random() * h, r: (Math.random() * 1.3 + 0.3) * dpr,
      s: Math.random() * 0.25 + 0.05, p: Math.random() * Math.PI * 2, gold: Math.random() < 0.15
    }));
  }
  function frame(t) {
    g.clearRect(0, 0, w, h);
    for (const s of stars) {
      if (!reduce) { s.y -= s.s; if (s.y < -4) { s.y = h + 4; s.x = Math.random() * w; } }
      const a = 0.35 + 0.65 * Math.abs(Math.sin(t / 1400 + s.p));
      g.globalAlpha = a;
      g.fillStyle = s.gold ? '#ffd98a' : '#cfd8ff';
      g.beginPath(); g.arc(s.x, s.y, s.r, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    requestAnimationFrame(frame);
  }
  addEventListener('resize', resize); resize(); requestAnimationFrame(frame);
})();

buildBoard();
// expose for debugging in the console
window.__cq = { Host, Net, get state() { return S; }, solveBest };
})();
