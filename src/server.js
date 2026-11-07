import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { WebSocketServer } from 'ws';
import { createGame, actGame, tickGame, viewGame } from './games.js';

const scrypt = promisify(scryptCallback);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const digest = value => createHash('sha256').update(value).digest('hex');
const publicUser = u => ({ id: u.id, name: u.name, role: u.role });
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
const text = (value, min = 1, max = 80) => typeof value === 'string' && value.trim().length >= min && value.trim().length <= max;

export function createApp({ dbPath = resolve(ROOT, 'data/casino.sqlite'), setupToken = process.env.OWNER_SETUP_TOKEN,
  secureCookies = process.env.NODE_ENV === 'production', origin = process.env.ORIGIN, tickMs = 250, apiLimit = 600 } = {}) {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL COLLATE NOCASE UNIQUE,password TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'player',banned INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS wallets(user_id TEXT NOT NULL REFERENCES users(id),context TEXT NOT NULL,available INTEGER NOT NULL CHECK(available>=0),reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved>=0),PRIMARY KEY(user_id,context));
    CREATE TABLE IF NOT EXISTS ledger(id TEXT PRIMARY KEY,at INTEGER NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),context TEXT NOT NULL,delta INTEGER NOT NULL,reserved_delta INTEGER NOT NULL,reason TEXT NOT NULL,reference TEXT NOT NULL,UNIQUE(user_id,context,reason,reference));
    CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,name TEXT NOT NULL,status TEXT NOT NULL,startingChips INTEGER NOT NULL,stakes TEXT NOT NULL,games TEXT NOT NULL,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS event_options(event_id TEXT PRIMARY KEY REFERENCES events(id),starts_at INTEGER,ends_at INTEGER,participant_limit INTEGER);
    CREATE TABLE IF NOT EXISTS rooms(id TEXT PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS actions(room_id TEXT NOT NULL,user_id TEXT NOT NULL,action_id TEXT NOT NULL,PRIMARY KEY(room_id,user_id,action_id));
    CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,at INTEGER NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,target TEXT NOT NULL,detail TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL);
    CREATE TRIGGER IF NOT EXISTS ledger_no_update BEFORE UPDATE ON ledger BEGIN SELECT RAISE(ABORT,'Ledger is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS ledger_no_delete BEFORE DELETE ON ledger BEGIN SELECT RAISE(ABORT,'Ledger is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'Audit is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'Audit is append-only'); END;
    CREATE INDEX IF NOT EXISTS ledger_context ON ledger(context,at);
    CREATE INDEX IF NOT EXISTS rooms_status ON rooms(json_extract(data,'$.status'));
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);`);
  db.prepare('INSERT OR IGNORE INTO migrations VALUES(1,?)').run(Date.now());
  db.prepare('INSERT OR IGNORE INTO settings VALUES(1,?)').run(JSON.stringify({ bluff: true, chromatic: true, startingChips: 10000, maintenance: false, announcement: '' }));
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const tx = fn => { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  const settings = () => ({ poker:true, ohhell:true, rummy:true, ...JSON.parse(get('SELECT data FROM settings WHERE id=1').data) });
  const audit = (actor, action, target, detail) => run('INSERT INTO audit VALUES(?,?,?,?,?,?)', randomUUID(), Date.now(), actor, action, target, JSON.stringify(detail));
  const event = id => { const e = get('SELECT * FROM events WHERE id=?', id); if (!e) fail('Event not found', 404); const o=get('SELECT * FROM event_options WHERE event_id=?',id); return { ...e, startsAt:o?.starts_at??null, endsAt:o?.ends_at??null, participantLimit:o?.participant_limit??null, participants:get('SELECT COUNT(*) AS n FROM wallets WHERE context=?',id).n, stakes: JSON.parse(e.stakes), games: JSON.parse(e.games) }; };
  const events = () => all('SELECT id FROM events ORDER BY created DESC').map(e => event(e.id));
  const rooms = (activeOnly = false) => all(activeOnly ? "SELECT data FROM rooms WHERE json_extract(data,'$.status') IN ('waiting','playing','paused')" : 'SELECT data FROM rooms').map(r => JSON.parse(r.data));
  const room = id => { const r = get('SELECT data FROM rooms WHERE id=?', id); if (!r) fail('Table not found', 404); return JSON.parse(r.data); };
  const save = r => { r.version = (r.version || 0) + 1; run('INSERT INTO rooms VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data', r.id, JSON.stringify(r)); return r; };
  const wallet = (id, context) => get('SELECT available,reserved FROM wallets WHERE user_id=? AND context=?', id, context) || { available: 0, reserved: 0 };
  const money = (id, context, delta, reservedDelta, reason, reference) => {
    if (get('SELECT id FROM ledger WHERE user_id=? AND context=? AND reason=? AND reference=?', id, context, reason, reference)) return false;
    const w = wallet(id, context);
    if (!integer(w.available + delta, 0, 1e12) || !integer(w.reserved + reservedDelta, 0, 1e12)) fail('Insufficient chips or invalid balance');
    run('INSERT INTO wallets VALUES(?,?,?,?) ON CONFLICT(user_id,context) DO UPDATE SET available=excluded.available,reserved=excluded.reserved', id, context, w.available + delta, w.reserved + reservedDelta);
    run('INSERT INTO ledger VALUES(?,?,?,?,?,?,?,?)', randomUUID(), Date.now(), id, context, delta, reservedDelta, reason, reference);
    return true;
  };
  const initializeWallet = (id, context, amount) => {
    if (!get('SELECT user_id FROM wallets WHERE user_id=? AND context=?', id, context)) money(id, context, amount, 0, 'allocation', context);
  };
  const safeRoom = (r, user) => ({ id: r.id, name: r.name, game: r.game, context: r.context, stake: r.stake, status: r.status,
    players: r.players, host: r.host, private: r.private, pot: r.stake * r.players.length, version: r.version, created: r.created, finished: r.finished, payout: r.payouts?.[user.id],
    code: r.players.some(p => p.id === user.id) ? r.code : undefined,
    state: r.state && r.players.some(p => p.id === user.id) ? viewGame(r.state, user.id) : null });
  const finish = r => {
    if (r.settled || r.state?.phase !== 'finished') return;
    const winner = r.state.winner;
    if (winner && !r.players.some(p => p.id === winner)) throw new Error('Engine returned unknown winner');
    const pot = r.stake * r.players.length;
    const winners = r.state.winners?.length ? r.state.winners : winner ? [winner] : [];
    if (winners.some(id => !r.players.some(p => p.id === id)) || new Set(winners).size !== winners.length) throw new Error('Invalid winners');
    const payouts = r.state.payouts || Object.fromEntries(r.players.map(p => [p.id, winners.length ? (winners.includes(p.id) ? Math.floor(pot / winners.length) + (winners.indexOf(p.id) < pot % winners.length ? 1 : 0) : 0) : r.stake]));
    if (Object.keys(payouts).length !== r.players.length || r.players.some(p => !integer(payouts[p.id], 0, pot)) || Object.values(payouts).reduce((a,b)=>a+b,0) !== pot) throw new Error('Payouts must conserve every committed chip');
    r.payouts = payouts;
    for (const p of r.players) money(p.id, r.context, payouts[p.id], -r.stake, winners.length || r.state.payouts ? 'settlement' : 'draw-refund', r.id);
    r.settled = true; r.status = 'finished'; r.finished = Date.now();
    audit('system', 'match-settled', r.id, { winner, pot: r.stake * r.players.length });
  };
  const cancel = (r, actor = 'system', reason = 'Canceled') => {
    if (r.settled) return r;
    const payouts = Object.fromEntries(r.players.map(p => [p.id, r.game === 'poker' && r.state ? r.state.stacks[p.id] + r.state.contributions[p.id] : r.stake]));
    if (Object.values(payouts).some(n => !integer(n, 0, r.stake * r.players.length)) || Object.values(payouts).reduce((a,b)=>a+b,0) !== r.stake * r.players.length) throw new Error('Cancellation must conserve chips');
    r.payouts = payouts;
    for (const p of r.players) money(p.id, r.context, payouts[p.id], -r.stake, 'refund', `${r.id}:${r.seatVersions?.[p.id] || 0}`);
    r.settled = true; r.status = 'canceled'; r.finished = Date.now();
    audit(actor, 'table-canceled', r.id, { reason }); return save(r);
  };
  const scheduledEvents = () => {
    let changed=false; const now=Date.now();
    for(const e of events()) {
      let status=null;
      if (['registration','active','paused'].includes(e.status) && e.endsAt && e.endsAt<=now) status='completed';
      else if(e.status==='registration' && e.startsAt && e.startsAt<=now) status='active';
      if(!status)continue;
      if(status==='completed')for(const r of rooms(true).filter(r=>r.context===e.id))cancel(r,'system','Scheduled event end');
      run('UPDATE events SET status=? WHERE id=?',status,e.id);audit('system','event-scheduled-status',e.id,{before:e.status,after:status});changed=true;
    }
    return changed;
  };
  // Restart recovery keeps durable state and gives the next player a fair fresh timer.
  tx(() => { for (const r of rooms(true)) if (r.status === 'playing') { r.state.deadline = Date.now() + (r.state.phase === 'challenge' ? 8000 : 30000); save(r); } });
  const authenticate = req => {
    const token = /(?:^|;\s*)venatus=([^;]+)/.exec(req.headers.cookie || '')?.[1];
    if (!token) return null;
    return get('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>? AND u.banned=0', digest(token), Date.now()) || null;
  };
  const loginSession = (res, user) => {
    const token = randomBytes(32).toString('hex');
    run('INSERT INTO sessions VALUES(?,?,?)', digest(token), user.id, Date.now() + 7 * 86400000);
    res.setHeader('Set-Cookie', `venatus=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${secureCookies ? '; Secure' : ''}`);
  };
  const requireAdmin = user => { if (!['superadmin', 'moderator'].includes(user.role)) fail('Administrator access required', 403); };
  const requireOwner = user => { if (user.role !== 'superadmin') fail('Owner access required', 403); };
  const allowedOrigin = req => !req.headers.origin || req.headers.origin === (origin || `http://${req.headers.host}`);
  const rates = new Map();
  function rate(key, limit, period) {
    const now = Date.now(); let r = rates.get(key);
    if (!r || r.until < now) { r = { count: 0, until: now + period }; rates.set(key, r); }
    if (++r.count > limit) fail('Too many requests. Please wait and try again.', 429);
  }
  async function body(req) {
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) fail('JSON request required', 415);
    let data = ''; for await (const chunk of req) { data += chunk; if (Buffer.byteLength(data) > 16384) fail('Request too large', 413); }
    try { const b = JSON.parse(data || '{}'); if (!b || Array.isArray(b) || typeof b !== 'object') fail('JSON object required'); return b; } catch { fail('Invalid JSON'); }
  }
  const board = context => {
    const wins = new Map();
    for(const r of rooms().filter(r=>r.context===context&&r.status==='finished')) for(const id of r.state.winners?.length ? r.state.winners : r.state.winner ? [r.state.winner] : []) wins.set(id,(wins.get(id)||0)+1);
    const adjustments = new Map();
    for (const r of rooms(true)) if (r.context === context && r.game === 'poker' && r.state) for (const p of r.players) adjustments.set(p.id, (adjustments.get(p.id) || 0) + r.state.stacks[p.id] + r.state.contributions[p.id] - r.stake);
    return all(`SELECT u.name,u.id,w.available+w.reserved AS balance FROM wallets w JOIN users u ON u.id=w.user_id WHERE w.context=? AND u.banned=0`, context).map(u => ({ ...u, balance: u.balance + (adjustments.get(u.id) || 0), wins: wins.get(u.id) || 0 })).sort((a,b)=>b.balance-a.balance || a.name.localeCompare(b.name)).slice(0,100);
  };
  const canPlay = (user, context, game, stake, isPrivate = false) => {
    const s = settings(); if (s.maintenance) fail('The casino is under maintenance');
    if (!['bluff', 'chromatic', 'poker', 'ohhell', 'rummy'].includes(game) || !s[game]) fail('This game is unavailable');
    if (!integer(stake, 10, 100000)) fail('Stake must be between 10 and 100,000 chips');
    if (context !== 'casual') {
      const e = event(context); if (e.status !== 'active') fail('Event is not active');
      if (isPrivate) fail('Private tables are only available in casual mode');
      if (!e.games.includes(game) || !e.stakes.includes(stake)) fail('Game or stake is not allowed in this event');
      if (!get('SELECT user_id FROM wallets WHERE user_id=? AND context=?', user.id, context)) fail('Join the event first');
    }
  };
  const freeSeat = user => {
    if (rooms(true).some(r => r.players.some(p => p.id === user.id))) fail('Leave or finish your current table first');
  };
  function joinTable(r, user, code) {
    if (r.players.some(p => p.id === user.id)) return safeRoom(r, user);
    if (r.status !== 'waiting' || r.players.length >= 6) fail('Table is not accepting players');
    if (r.private && code !== r.code) fail('Room code required', 403);
    freeSeat(user); canPlay(user, r.context, r.game, r.stake, r.private);
    r.seatVersions ||= {}; r.seatVersions[user.id] = (r.seatVersions[user.id] || 0) + 1;
    money(user.id, r.context, -r.stake, r.stake, 'reserve', `${r.id}:${r.seatVersions[user.id]}`);
    r.players.push({ id: user.id, name: user.name }); save(r); return safeRoom(r, user);
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if (secureCookies) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    const send = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
    try {
      const url = new URL(req.url, 'http://localhost'); const path = url.pathname;
      if (path === '/health') return send({ status: 'ok' });
      if (!path.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') fail('Method not allowed', 405);
        const files = { '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/special.js':'special.js', '/style.css': 'style.css', '/logo.png': 'logo.png' };
        if (!files[path]) fail('Not found', 404);
        const content = readFileSync(resolve(ROOT, 'public', files[path]));
        res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' })[extname(files[path])], 'Cache-Control': 'no-cache' });
        return res.end(req.method === 'HEAD' ? undefined : content);
      }
      rate(req.socket.remoteAddress + ':api', 10000, 60000);
      if (!['GET', 'POST'].includes(req.method)) fail('Method not allowed', 405);
      if (!allowedOrigin(req)) fail('Origin not allowed', 403);
      let user = authenticate(req);
      if (path === '/api/me' && req.method === 'GET') return send({ user: user ? publicUser(user) : null, setupRequired: !get("SELECT id FROM users WHERE role='superadmin'") });
      const b = req.method === 'POST' ? await body(req) : {};
      // Reading a streamed body yields to other requests. Recheck revoked sessions and roles.
      if (req.method === 'POST') user = authenticate(req);
      if (user) rate(user.id + ':api', apiLimit, 60000);
      if (['/api/register', '/api/login', '/api/setup'].includes(path) && req.method === 'POST') {
        rate(req.socket.remoteAddress + ':auth', 300, 15 * 60000);
        if (!text(b.name, 3, 24) || !/^[\p{L}\p{N} _-]+$/u.test(b.name.trim())) fail('Use a 3–24 character name with letters, numbers, spaces, _ or -');
        if (typeof b.password !== 'string' || b.password.length < 12 || b.password.length > 128) fail('Use a password with 12–128 characters');
        const name = b.name.trim(); let account;
        rate(req.socket.remoteAddress + ':auth:' + name.toLowerCase(), 12, 15 * 60000);
        if (path === '/api/login') {
          account = get('SELECT * FROM users WHERE name=?', name);
          const [salt, encoded] = (account?.password || `${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
          const derived = await scrypt(b.password, salt, 64);
          account = get('SELECT * FROM users WHERE name=?', name);
          if (!timingSafeEqual(derived, Buffer.from(encoded, 'hex')) || !account || account.banned) fail('Invalid name or password', 401);
        } else {
          if (settings().maintenance) fail('Registration is temporarily paused');
          if (path === '/api/setup' && (!setupToken || typeof b.token !== 'string' || !timingSafeEqual(Buffer.from(digest(b.token)), Buffer.from(digest(setupToken))))) fail('Invalid owner setup token', 403);
          const salt = randomBytes(16).toString('hex'); const hash = (await scrypt(b.password, salt, 64)).toString('hex');
          account = tx(() => {
            if (get('SELECT id FROM users WHERE name=?', name)) fail('That name is already in use', 409);
            if (path === '/api/setup' && get("SELECT id FROM users WHERE role='superadmin'")) fail('Owner has already been configured', 409);
            const id = randomUUID(); const role = path === '/api/setup' ? 'superadmin' : 'player';
            run('INSERT INTO users VALUES(?,?,?,?,0,?)', id, name, `${salt}:${hash}`, role, Date.now());
            initializeWallet(id, 'casual', settings().startingChips); audit(id, 'account-created', id, { role });
            return get('SELECT * FROM users WHERE id=?', id);
          });
        }
        loginSession(res, account); broadcast(); return send({ user: publicUser(account) });
      }
      if (!user) fail('Sign in to continue', 401);
      if (path === '/api/logout' && req.method === 'POST') {
        const token = /(?:^|;\s*)venatus=([^;]+)/.exec(req.headers.cookie || '')?.[1];
        if (token) run('DELETE FROM sessions WHERE token=?', digest(token));
        res.setHeader('Set-Cookie', `venatus=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookies ? '; Secure' : ''}`);
        broadcast(); return send({ ok: true });
      }
      if (path === '/api/lobby' && req.method === 'GET') {
        const context = url.searchParams.get('context') || 'casual'; if (context !== 'casual') event(context);
        return send({ user: publicUser(user), context, events: events(), wallet: wallet(user.id, context), participating: !!get('SELECT user_id FROM wallets WHERE user_id=? AND context=?', user.id, context), settings: settings(),
          tables: rooms().filter(r => r.context === context && ((!r.private && ['waiting','playing','paused'].includes(r.status)) || r.players.some(p => p.id === user.id))).slice(-100).map(r => safeRoom(r, user)),
          leaderboard: board(context), history: rooms().filter(r => r.context === context && r.settled && r.players.some(p => p.id === user.id)).slice(-20).reverse().map(r => safeRoom(r, user)) });
      }
      const tableMatch = /^\/api\/tables\/([^/]+)(?:\/(join|start|leave|action))?$/.exec(path);
      if (tableMatch && req.method === 'GET' && !tableMatch[2]) {
        const r = room(tableMatch[1]); if (r.private && !r.players.some(p => p.id === user.id)) fail('Private table', 403);
        return send(safeRoom(r, user));
      }
      if (path === '/api/admin/export' && req.method === 'GET') {
        requireAdmin(user); const context = url.searchParams.get('context') || 'casual';
        const csvCell = value => `"${String(value).replace(/^[=+@-]/, "'$&").replaceAll('"', '""')}"`;
        const csv = 'Player,Balance,Wins\r\n' + board(context).map(r => [r.name,r.balance,r.wins].map(csvCell).join(',')).join('\r\n');
        res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="venatus-standings.csv"', 'Cache-Control': 'no-store' }); return res.end(csv);
      }
      if (path === '/api/admin' && req.method === 'GET') {
        requireAdmin(user); const rr = rooms(); return send({ users: all('SELECT id,name,role,banned,created FROM users'), events: events(), tables: rr.map(r => safeRoom(r, user)),
          audit: all('SELECT * FROM audit ORDER BY at DESC LIMIT 100'), ledger: all('SELECT * FROM ledger ORDER BY at DESC LIMIT 200'), settings: settings(),
          stats: { users: get('SELECT COUNT(*) AS n FROM users').n, online: new Set([...wss.clients].map(c => c.userId)).size,
            tables: rr.filter(r => !r.settled).length, matches: rr.filter(r => r.status === 'finished').length, events: events().filter(e => e.status === 'active').length,
            chips: all('SELECT context,SUM(available+reserved) AS total FROM wallets GROUP BY context') } });
      }
      if (req.method !== 'POST') fail('Not found', 404);
      const result = tx(() => {
        scheduledEvents();
        const joinEvent = /^\/api\/events\/([^/]+)\/join$/.exec(path);
        if (joinEvent) { const e = event(joinEvent[1]); if (!['registration','active'].includes(e.status)) fail('Registration is closed'); if(!get('SELECT user_id FROM wallets WHERE user_id=? AND context=?',user.id,e.id) && e.participantLimit && e.participants>=e.participantLimit)fail('This event has reached its participant limit'); initializeWallet(user.id, e.id, e.startingChips); return { wallet: wallet(user.id, e.id) }; }
        if (path === '/api/tables') {
          freeSeat(user); const context = b.context || 'casual'; canPlay(user, context, b.game, b.stake, !!b.private);
          if (!text(b.name, 1, 48)) fail('Table name must have 1–48 characters');
          if (rooms(true).length >= 100) fail('Table limit reached');
          const r = { id: randomUUID(), name: b.name.trim(), context, game: b.game, stake: b.stake, private: !!b.private, code: randomBytes(6).toString('hex').toUpperCase(), host: user.id, players: [], state: null, status: 'waiting', settled: false, created: Date.now(), version: 0 };
          return joinTable(r, user, r.code);
        }
        if (path === '/api/rooms/join') { const r = rooms().find(r => r.code === String(b.code).trim().toUpperCase() && !r.settled); if (!r) fail('Room not found', 404); return joinTable(r, user, r.code); }
        if (tableMatch) {
          const r = room(tableMatch[1]); const op = tableMatch[2];
          if (op === 'join') return joinTable(r, user, b.code);
          if (!r.players.some(p => p.id === user.id)) fail('You are not seated at this table', 403);
          if (op === 'leave') {
            if (['playing','paused'].includes(r.status)) fail('Finish the game first. Your seat is kept if you disconnect.');
            if (!r.settled) { money(user.id, r.context, r.stake, -r.stake, 'refund', `${r.id}:${r.seatVersions?.[user.id] || 0}`); r.players = r.players.filter(p => p.id !== user.id); if (!r.players.length) { r.status = 'canceled'; r.settled = true; } else if (r.host === user.id) r.host = r.players[0].id; save(r); }
            return { ok: true };
          }
          if (op === 'start') {
            if (r.host !== user.id) fail('Only the host can deal', 403);
            if (r.status !== 'waiting') fail('Match already started');
            for (const p of r.players) { if (get('SELECT banned FROM users WHERE id=?', p.id).banned) fail('A seated player is banned'); }
            canPlay(user, r.context, r.game, r.stake, r.private);
            if (r.players.length < (['bluff','ohhell'].includes(r.game) ? 3 : 2)) fail('More players are needed');
            r.state = createGame(r.game, r.players.map(p => p.id), Date.now(), {buyIn:r.stake}); r.status = 'playing'; r.started = Date.now(); save(r);
            audit(user.id, 'match-started', r.id, { game: r.game, players: r.players.map(p => p.id) }); return safeRoom(r, user);
          }
          if (op === 'action') {
            if (!text(b.actionId, 8, 100)) fail('Action identifier required');
            if (get('SELECT action_id FROM actions WHERE room_id=? AND user_id=? AND action_id=?', r.id, user.id, b.actionId)) return safeRoom(r, user);
            if (r.status !== 'playing') fail('Match is not running');
            if (b.expectedVersion !== r.version) fail('The table changed. Refresh and try again.', 409);
            if (!b.action || typeof b.action !== 'object') fail('Action required');
            if (r.game === 'rummy' && ['analyze','declare'].includes(b.action.type)) rate(user.id + ':rummy-analysis', 30, 60000);
            try { r.state = actGame(r.state, user.id, b.action); } catch (e) { fail(e.message); }
            finish(r); save(r);
            run('INSERT INTO actions VALUES(?,?,?)', r.id, user.id, b.actionId); return safeRoom(r, user);
          }
        }
        if (path.startsWith('/api/admin/')) {
          requireAdmin(user);
          if (path === '/api/admin/event') {
            requireOwner(user);
            if (!text(b.name, 3, 80) || !integer(b.startingChips, 100, 1000000) || !Array.isArray(b.stakes) || !b.stakes.length || b.stakes.length > 20 || b.stakes.some(s => !integer(s, 10, b.startingChips)) || !Array.isArray(b.games) || !b.games.length || b.games.some(g => !['bluff','chromatic','poker','ohhell','rummy'].includes(g))) fail('Invalid event settings');
            const startsAt=b.startsAt??null, endsAt=b.endsAt??null, participantLimit=b.participantLimit??null;
            if(startsAt!==null&&!integer(startsAt,Date.now(),Date.now()+5*366*86400000) || endsAt!==null&&!integer(endsAt,Date.now()+1,Date.now()+5*366*86400000) || startsAt!==null&&endsAt!==null&&endsAt<=startsAt || participantLimit!==null&&!integer(participantLimit,2,10000))fail('Invalid event schedule or participant limit');
            const id = randomUUID(); run('INSERT INTO events VALUES(?,?,?,?,?,?,?)', id, b.name.trim(), 'draft', b.startingChips, JSON.stringify([...new Set(b.stakes)]), JSON.stringify([...new Set(b.games)]), Date.now());
            run('INSERT INTO event_options VALUES(?,?,?,?)',id,startsAt,endsAt,participantLimit);
            audit(user.id, 'event-created', id, b); return event(id);
          }
          const em = /^\/api\/admin\/event\/([^/]+)$/.exec(path);
          if (em) {
            requireOwner(user); const e = event(em[1]);
            const transitions = { draft: ['registration','active','canceled'], registration: ['active','canceled'], active: ['paused','completed','canceled'], paused: ['active','completed','canceled'], completed: ['archived'], canceled: ['archived'], archived: [] };
            if (!transitions[e.status].includes(b.status)) fail('Invalid event transition');
            for (const r of rooms().filter(r => r.context === e.id && !r.settled)) {
              if (['completed','canceled'].includes(b.status)) cancel(r, user.id, 'Event closed; unfinished stakes refunded');
              else if (b.status === 'paused' && r.status === 'playing') { r.status = 'paused'; r.pausedByEvent = true; save(r); }
              else if (b.status === 'active' && r.status === 'paused' && r.pausedByEvent) { r.status = 'playing'; r.pausedByEvent = false; r.state.deadline = Date.now() + (r.state.phase === 'challenge' ? 8000 : 30000); save(r); }
            }
            run('UPDATE events SET status=? WHERE id=?', b.status, e.id); audit(user.id, 'event-status', e.id, { before: e.status, after: b.status }); return event(e.id);
          }
          const um = /^\/api\/admin\/user\/([^/]+)$/.exec(path);
          if (um) {
            const target = get('SELECT * FROM users WHERE id=?', um[1]); if (!target) fail('Player not found', 404);
            if (target.role === 'superadmin') fail('Owner account cannot be modified here');
            if (b.role !== undefined) { requireOwner(user); if (!['player','moderator'].includes(b.role)) fail('Invalid role'); run('UPDATE users SET role=? WHERE id=?', b.role, target.id); }
            if (b.banned !== undefined) {
              if (typeof b.banned !== 'boolean') fail('Invalid ban value');
              if (target.role === 'moderator') requireOwner(user);
              run('UPDATE users SET banned=? WHERE id=?', b.banned ? 1 : 0, target.id);
              if (b.banned) { run('DELETE FROM sessions WHERE user_id=?', target.id); for (const r of rooms().filter(r => !r.settled && r.players.some(p => p.id === target.id))) cancel(r, user.id, 'Participant banned; table refunded'); }
            }
            if (b.revoke) { if (target.role === 'moderator') requireOwner(user); run('DELETE FROM sessions WHERE user_id=?', target.id); }
            if (b.adjustment !== undefined) {
              requireOwner(user); if (!integer(b.adjustment, -1000000, 1000000) || !b.adjustment || !text(b.reason, 5, 200)) fail('Valid chip adjustment and reason required');
              const context = b.context || 'casual'; if (context !== 'casual' && !['registration','active','paused'].includes(event(context).status)) fail('This event economy is frozen');
              if (!get('SELECT user_id FROM wallets WHERE user_id=? AND context=?', target.id, context)) fail('Player has no wallet in this economy');
              const correctionId = randomUUID();
              money(target.id, context, b.adjustment, 0, 'admin-adjustment', correctionId);
              audit(user.id, 'chip-correction', correctionId, { player: target.id, context, adjustment: b.adjustment, reason: b.reason });
            }
            audit(user.id, 'player-updated', target.id, { before: publicUser(target), change: b }); return { ok: true };
          }
          const tm = /^\/api\/admin\/table\/([^/]+)$/.exec(path);
          if (tm) {
            const r = room(tm[1]);
            if (b.operation === 'cancel') cancel(r, user.id, 'Administrator canceled');
            else if (b.operation === 'pause' && r.status === 'playing') { r.status = 'paused'; r.pausedByEvent = false; save(r); }
            else if (b.operation === 'resume' && r.status === 'paused') {
              if (r.context !== 'casual' && event(r.context).status !== 'active') fail('Resume the event first');
              r.status = 'playing'; r.state.deadline = Date.now() + (r.state.phase === 'challenge' ? 8000 : 30000); save(r);
            } else fail('Invalid table operation');
            audit(user.id, 'table-control', r.id, b); return safeRoom(r, user);
          }
          if (path === '/api/admin/settings') {
            requireOwner(user); const s = settings();
            for (const k of ['bluff','chromatic','poker','ohhell','rummy','maintenance']) if (b[k] !== undefined) { if (typeof b[k] !== 'boolean') fail('Invalid setting'); s[k] = b[k]; }
            if (b.startingChips !== undefined) { if (!integer(b.startingChips, 100, 1000000)) fail('Invalid allocation'); s.startingChips = b.startingChips; }
            if (b.announcement !== undefined) { if (typeof b.announcement !== 'string' || b.announcement.length > 400) fail('Announcement too long'); s.announcement = b.announcement; }
            run('UPDATE settings SET data=? WHERE id=1', JSON.stringify(s)); audit(user.id, 'settings-updated', 'platform', s); return s;
          }
        }
        fail('Not found', 404);
      });
      broadcast(); send(result);
    } catch (e) {
      if (!e.status && !/constraint/i.test(e.message)) console.error('Request failed:', e.message);
      send({ error: e.status ? e.message : (/constraint/i.test(e.message) ? 'The operation conflicts with existing data' : 'The action could not be completed') }, e.status || 400);
    }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    const user = authenticate(req);
    if (req.url !== '/ws' || !user || !allowedOrigin(req) || wss.clients.size > 1000) { socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return socket.destroy(); }
    wss.handleUpgrade(req, socket, head, ws => { ws.userId = user.id; ws.request = req; ws.alive = true; ws.on('pong', () => { ws.alive = true; }); ws.on('error', () => {}); ws.send(JSON.stringify({ type: 'refresh' })); });
  });
  function broadcast() { for (const client of wss.clients) { if (!authenticate(client.request)) client.close(1008, 'Session expired'); else if (client.readyState === 1) client.send(JSON.stringify({ type: 'refresh' })); } }
  const timer = setInterval(() => {
    let changed = tx(scheduledEvents);
    for (const r of rooms(true)) {
      if (r.status === 'waiting' && Date.now() - r.created > 30 * 60000) { tx(() => cancel(r, 'system', 'Waiting room expired')); changed = true; }
      if (r.status === 'playing' && Date.now() - r.started > 60 * 60000) {
        tx(() => cancel(r, 'system', 'One-hour match limit reached; stakes refunded'));
        changed = true; continue;
      }
      if (r.status !== 'playing' || r.state.deadline > Date.now()) continue;
      try { tx(() => { r.state = tickGame(r.state, Date.now()); finish(r); save(r); }); changed = true; }
      catch (e) { console.error('Game timer recovery:', e.message); tx(() => cancel(room(r.id), 'system', 'Rules engine recovery refund')); changed = true; }
    }
    if (changed) broadcast();
  }, tickMs);
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) { if (!ws.alive || !authenticate(ws.request)) { ws.terminate(); continue; } ws.alive = false; ws.ping(); }
    run('DELETE FROM sessions WHERE expires<?', Date.now()); for (const [key, value] of rates) if (value.until < Date.now()) rates.delete(key);
  }, 30000);
  return { server, db, close: async () => { clearInterval(timer); clearInterval(heartbeat); for (const ws of wss.clients) ws.terminate(); wss.close(); await new Promise(resolve => server.close(resolve)); db.close(); } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dataDir = process.env.DATA_DIR || resolve(ROOT, 'data'); mkdirSync(dataDir, { recursive: true });
  let setupToken = process.env.OWNER_SETUP_TOKEN;
  if (!setupToken) {
    if (process.env.NODE_ENV === 'production') throw new Error('Set OWNER_SETUP_TOKEN before production startup');
    const tokenFile = resolve(dataDir, 'owner-setup-token.txt');
    if (!existsSync(tokenFile)) writeFileSync(tokenFile, randomBytes(32).toString('hex'), { mode: 0o600 });
    setupToken = readFileSync(tokenFile, 'utf8').trim();
  }
  if (process.env.NODE_ENV === 'production' && !/^https:\/\//.test(process.env.ORIGIN || '')) throw new Error('Set ORIGIN to the public HTTPS origin');
  const app = createApp({ dbPath: resolve(dataDir, 'casino.sqlite'), setupToken });
  const port = Number(process.env.PORT || 3000);
  app.server.listen(port, process.env.HOST || '127.0.0.1', () => {
    console.log(`Venatus Casino: http://localhost:${port}`);
    if (process.env.VENATUS_OPEN_BROWSER === '1' && process.platform === 'win32') {
      const opener = spawn('cmd.exe', ['/c', 'start', '', `http://localhost:${port}`], { windowsHide: true, stdio: 'ignore' });
      opener.on('error', () => console.log('Open the local URL above in your browser.'));
      opener.unref();
    }
  });
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => { await app.close(); process.exit(0); });
}
