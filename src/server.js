import http from 'node:http';
import { openStorage } from './storage.js';
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync, existsSync, writeFileSync, statSync } from 'node:fs';
import { dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { WebSocketServer } from 'ws';
import { createGame, actGame, tickGame, viewGame } from './games.js';
import { botAction } from './bots.js';
import sharp from 'sharp';

const scrypt = promisify(scryptCallback);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const digest = value => createHash('sha256').update(value).digest('hex');
const guestNickname = name => name.replace(/ #[0-9A-F]{6}$/, '');
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
const text = (value, min = 1, max = 80) => typeof value === 'string' && value.trim().length >= min && value.trim().length <= max;

export async function createApp({ dbPath = resolve(ROOT, 'data/casino.sqlite'), databaseUrl = process.env.DATABASE_URL, setupToken = process.env.OWNER_SETUP_TOKEN,
  secureCookies = process.env.NODE_ENV === 'production', origin = process.env.ORIGIN || process.env.RENDER_EXTERNAL_URL, tickMs = databaseUrl ? 1000 : 250, apiLimit = 600, storageFactory = openStorage } = {}) {
  const storage = await storageFactory({ dbPath, databaseUrl });
  const { db, get, all, run, tx } = storage;
  const profiles = new Map();
  const avatar = (id, profile = profiles.get(id)) => profile?.image_base64
    ? {kind:'upload',url:`/api/avatars/${encodeURIComponent(id)}?v=${profile.version}`}
    : {kind:'preset',id:profile?.preset ?? (parseInt(digest(id).slice(0,8),16)%24)};
  const profileView = (u, p = profiles.get(u.id)) => ({displayName:p?.display_name || (u.role==='guest'?guestNickname(u.name):u.name),avatar:avatar(u.id,p)});
  const publicUser = u => ({id:u.id,name:profileView(u).displayName,loginName:u.role==='guest'?guestNickname(u.name):u.name,role:u.role,avatar:avatar(u.id)});
  async function ensureProfile(id) {
    await run('INSERT INTO user_profiles(user_id,preset) VALUES(?,?) ON CONFLICT(user_id) DO NOTHING',id,randomBytes(1)[0]%24);
    const p=await get('SELECT * FROM user_profiles WHERE user_id=?',id); profiles.set(id,p); return p;
  }
  await tx(async()=>{for(const u of await all('SELECT id FROM users'))await ensureProfile(u.id);});
  const settings = async () => ({ poker:true, ohhell:true, rummy:true, ...JSON.parse((await get('SELECT data FROM settings WHERE id=1')).data) });
  const audit = async (actor, action, target, detail) => (await run('INSERT INTO audit VALUES(?,?,?,?,?,?)', randomUUID(), Date.now(), actor, action, target, JSON.stringify(detail)));
  const event = async id => { const e = (await get('SELECT * FROM events WHERE id=?', id)); if (!e) fail('Event not found', 404); const o=(await get('SELECT * FROM event_options WHERE event_id=?',id)); const meta=JSON.parse((await get('SELECT data FROM event_metadata WHERE event_id=?',id))?.data||'{}'); return { ...e, ...meta, startsAt:o?.starts_at??null, endsAt:o?.ends_at??null, participantLimit:o?.participant_limit??null, participants:(await get('SELECT COUNT(*) AS n FROM wallets WHERE context=?',id)).n, stakes: JSON.parse(e.stakes), games: JSON.parse(e.games) }; };
  const events = async () => await Promise.all((await all('SELECT id FROM events ORDER BY created DESC')).map(async e => (await event(e.id))));
  const rooms = async (activeOnly = false) => (await all(activeOnly ? "SELECT data FROM rooms WHERE json_extract(data,'$.status') IN ('waiting','playing','paused')" : 'SELECT data FROM rooms')).map(r => JSON.parse(r.data));
  const room = async id => { const r = (await get('SELECT data FROM rooms WHERE id=?', id)); if (!r) fail('Table not found', 404); return JSON.parse(r.data); };
  const save = async r => { syncPresentationHumans(r);r.version = (r.version || 0) + 1; r.savedAt = Date.now(); (await run('INSERT INTO rooms VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data', r.id, JSON.stringify(r))); return r; };
  const wallet = async (id, context) => (await get('SELECT available,reserved FROM wallets WHERE user_id=? AND context=?', id, context)) || { available: 0, reserved: 0 };
  const money = async (id, context, delta, reservedDelta, reason, reference) => {
    if ((await get('SELECT id FROM ledger WHERE user_id=? AND context=? AND reason=? AND reference=?', id, context, reason, reference))) return false;
    const w = (await wallet(id, context));
    if (!integer(w.available + delta, 0, 1e12) || !integer(w.reserved + reservedDelta, 0, 1e12)) fail('Insufficient chips or invalid balance');
    (await run('INSERT INTO wallets VALUES(?,?,?,?) ON CONFLICT(user_id,context) DO UPDATE SET available=excluded.available,reserved=excluded.reserved', id, context, w.available + delta, w.reserved + reservedDelta));
    (await run('INSERT INTO ledger VALUES(?,?,?,?,?,?,?,?)', randomUUID(), Date.now(), id, context, delta, reservedDelta, reason, reference));
    return true;
  };
  const initializeWallet = async (id, context, amount) => {
    if (!(await get('SELECT user_id FROM wallets WHERE user_id=? AND context=?', id, context))) (await money(id, context, amount, 0, 'allocation', context));
  };
  const connections = new Map();
  const seenHumans = new Map();
  function syncPresentationHumans(r) {
    if(!r.state)return;
    const ids=r.players.filter(p=>!p.bot&&!p.left).map(p=>p.id);
    r.state.humanPlayers=ids;
    const presentation=r.state.presentation;
    if(presentation){
      const connected=ids.filter(id=>connections.has(id));
      const required=connected.length?connected:ids;
      presentation.required=required;
      presentation.ready=presentation.ready.filter(id=>presentation.required.includes(id));
      const manual=r.manualResults!==false&&ids.length===1;
      if(presentation.manual&&!manual)presentation.maximumUntil=Math.max(presentation.minimumUntil,presentation.startedAt+Math.round(20000*({quick:.75,standard:1,relaxed:1.4}[r.pace]||1)));
      if(presentation.kind!=='ohhell-trick')presentation.manual=manual;
    }
  }
  function roomSeats(players) {
    const names = players.map(p => profiles.get(p.id)?.display_name || guestNickname(p.name));
    return players.map((p,i) => {
      if (p.bot) return {...p,avatar:{kind:'preset',id:p.avatarPreset??i%24}};
      const duplicate = names.some((n,j) => i !== j && n.toLowerCase() === names[i].toLowerCase());
      const name = duplicate ? (profiles.get(p.id)?.display_name ? names[i]+' · '+p.id.slice(0,4) : p.name) : names[i];
      return { ...p, name, avatar:avatar(p.id), online: connections.has(p.id) };
    });
  }
  const safeRoom = (r, user) => ({ serverTime:Date.now(),viewerId:user.id,started:r.started, id: r.id, name: r.name, game: r.game, context: r.context, stake: r.stake, status: r.status,
    joinable: acceptsSeat(r), practice:!!r.practice, capacity:r.capacity||6, botDifficulty:r.botDifficulty||'medium', pace:r.pace||'standard', manualResults:r.manualResults!==false, smallBlind:r.smallBlind, bigBlind:r.bigBlind, players: roomSeats(r.players), host: r.host, private: r.private, pot: r.stake * r.players.length, version: r.version, created: r.created, finished: r.finished, payout: r.payouts?.[user.id],
    code: r.players.some(p => p.id === user.id) ? r.code : undefined,
    state: r.state && r.players.some(p => p.id === user.id && !p.left) ? viewGame(r.state, user.id) : null });
  const betweenCasualHands = r => r.practice&&r.game==='poker'&&r.status==='playing'&&r.state?.phase==='between-hands';
  const acceptsSeat = r => r.players.length < (r.capacity || 6) &&
    (r.status === 'waiting' || (r.practice && r.status === 'finished') || betweenCasualHands(r));
  const syncPracticeSeats = r => {
    if(!betweenCasualHands(r))return;
    const g=r.state,ids=r.players.map(p=>p.id);
    for(const id of ids)if(!g.players.includes(id)){g.stacks[id]=r.stake;g.hands[id]=[];g.bets[id]=0;g.contributions[id]=0;g.folded[id]=true;}
    for(const id of g.players.filter(id=>!ids.includes(id)))for(const key of ['stacks','hands','bets','contributions','folded','actedAt','lastAction','showdown'])if(g[key])delete g[key][id];
    g.players=ids;g.pending=(g.pending||[]).filter(id=>ids.includes(id));if(!ids.includes(g.dealer))g.dealer=ids[0];if(!ids.includes(g.turn))g.turn=ids.find(id=>g.stacks[id]>0)||ids[0];if(!g.presentation)g.deadline=Date.now()+15000;
  };
  const bankroll = r => r.practice&&r.game==='poker'&&r.state ? Object.values(r.state.stacks).reduce((a,b)=>a+b,0)+Object.values(r.state.contributions).reduce((a,b)=>a+b,0) : r.stake*r.players.length;
  const finish = async r => {
    if (r.settled || r.state?.phase !== 'finished') return;
    const winner = r.state.winner;
    if (winner && !r.players.some(p => p.id === winner)) throw new Error('Engine returned unknown winner');
    const pot = bankroll(r);
    const winners = r.state.winners?.length ? r.state.winners : winner ? [winner] : [];
    if (winners.some(id => !r.players.some(p => p.id === id)) || new Set(winners).size !== winners.length) throw new Error('Invalid winners');
    const payouts = r.state.payouts || Object.fromEntries(r.players.map(p => [p.id, winners.length ? (winners.includes(p.id) ? Math.floor(pot / winners.length) + (winners.indexOf(p.id) < pot % winners.length ? 1 : 0) : 0) : r.stake]));
    if (Object.keys(payouts).length !== r.players.length || r.players.some(p => !integer(payouts[p.id], 0, pot)) || Object.values(payouts).reduce((a,b)=>a+b,0) !== pot) throw new Error('Payouts must conserve every committed chip');
    r.payouts = payouts;
    for (const p of r.players.filter(p=>!r.practice)) (await money(p.id, r.context, payouts[p.id], -r.stake, winners.length || r.state.payouts ? 'settlement' : 'draw-refund', r.id));
    r.settled = true; r.status = 'finished'; r.finished = Date.now();
    (await audit('system', 'match-settled', r.id, { winner, pot: r.stake * r.players.length }));
  };
  const cancel = async (r, actor = 'system', reason = 'Canceled') => {
    if (r.settled) return r;
    const payouts = Object.fromEntries(r.players.map(p => [p.id, r.game === 'poker' && r.state ? r.state.stacks[p.id] + r.state.contributions[p.id] : r.stake]));
    if (Object.values(payouts).some(n => !integer(n, 0, bankroll(r))) || Object.values(payouts).reduce((a,b)=>a+b,0) !== bankroll(r)) throw new Error('Cancellation must conserve chips');
    r.payouts = payouts;
    for (const p of r.players.filter(p=>!r.practice)) (await money(p.id, r.context, payouts[p.id], -r.stake, 'refund', `${r.id}:${r.seatVersions?.[p.id] || 0}`));
    r.settled = true; r.status = 'canceled'; r.finished = Date.now();
    (await audit(actor, 'table-canceled', r.id, { reason })); return (await save(r));
  };
  async function pauseRoom(r, byEvent) {
    const now = Date.now();
    r.status = 'paused';
    r.pausedByEvent = byEvent;
    r.pausedAt = now;
    r.pausedRemaining = Math.max(0, r.state.deadline - now);
    await save(r);
  }
  async function resumeRoom(r) {
    const now = Date.now();
    const pausedFor=Math.max(0, now - (r.pausedAt || r.savedAt || now));
    r.started += pausedFor;
    r.status = 'playing';
    r.pausedByEvent = false;
    r.state.deadline = now + (r.pausedRemaining ?? (r.state.phase === 'challenge' ? 8000 : 30000));
    if(r.state.presentation)for(const key of ['startedAt','minimumUntil','maximumUntil'])r.state.presentation[key]+=pausedFor;
    delete r.pausedAt;
    delete r.pausedRemaining;
    await save(r);
  }
  const scheduledEvents = async () => {
    let changed=false; const now=Date.now();
    for(const e of (await events())) {
      let status=null;
      if (['registration','active','paused'].includes(e.status) && e.endsAt && e.endsAt<=now) status='completed';
      else if(e.status==='registration' && e.startsAt && e.startsAt<=now) status='active';
      if(!status)continue;
      if(status==='completed')for(const r of (await rooms(true)).filter(r=>r.context===e.id))(await cancel(r,'system','Scheduled event end'));
      if(status==='completed')await run('INSERT INTO event_results VALUES(?,?) ON CONFLICT(event_id) DO NOTHING',e.id,JSON.stringify(await board(e.id)));
      (await run('UPDATE events SET status=? WHERE id=?',status,e.id));(await audit('system','event-scheduled-status',e.id,{before:e.status,after:status}));changed=true;
    }
    return changed;
  };
  // Restart recovery keeps durable state and gives the next player a fair fresh timer.
  (await tx(async () => { for (const r of (await rooms(true))) if (r.status === 'playing') {
    const now = Date.now();
    // Resume the match's safety budget from its last durable checkpoint.
    const downtime=Math.max(0, now - (r.savedAt || now));
    r.started += downtime;
    if(r.state.presentation){for(const key of ['startedAt','minimumUntil','maximumUntil'])r.state.presentation[key]+=downtime;r.state.deadline+=downtime;}
    else r.state.deadline = now + (r.state.phase === 'challenge' ? 10000 : 30000);
    r.lastHumanAt=now;
    await save(r);
  } }));
  const authenticate = async req => {
    const token = /(?:^|;\s*)venatus=([^;]+)/.exec(req.headers.cookie || '')?.[1];
    if (!token) return null;
    const user=(await get('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>? AND u.banned=0', digest(token), Date.now())) || null;
    if(user){seenHumans.set(user.id,Date.now());const p=await get('SELECT * FROM user_profiles WHERE user_id=?',user.id);if(p)profiles.set(user.id,p);else await ensureProfile(user.id);}
    return user;
  };
  const loginSession = async (res, user) => {
    const token = randomBytes(32).toString('hex');
    (await run('INSERT INTO sessions VALUES(?,?,?)', digest(token), user.id, Date.now() + 7 * 86400000));
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
  async function body(req, limit = 16384) {
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) fail('JSON request required', 415);
    let data = ''; for await (const chunk of req) { data += chunk; if (Buffer.byteLength(data) > limit) fail('Request too large', 413); }
    try { const b = JSON.parse(data || '{}'); if (!b || Array.isArray(b) || typeof b !== 'object') fail('JSON object required'); return b; } catch { fail('Invalid JSON'); }
  }
  const board = async context => {
    const frozen=await get('SELECT data FROM event_results WHERE event_id=?',context);if(frozen)return JSON.parse(frozen.data);
    const wins = new Map(), played=new Map();
    const allocation=context==='casual'?0:(await event(context)).startingChips;
    for(const r of (await rooms()).filter(r=>!r.practice&&r.context===context&&r.status==='finished'))for(const p of r.players)played.set(p.id,(played.get(p.id)||0)+1);
    for(const r of (await rooms()).filter(r=>!r.practice&&r.context===context&&r.status==='finished')) for(const id of r.state.winners?.length ? r.state.winners : r.state.winner ? [r.state.winner] : []) wins.set(id,(wins.get(id)||0)+1);
    const adjustments = new Map();
    for (const r of (await rooms(true))) if (!r.practice && r.context === context && r.game === 'poker' && r.state) for (const p of r.players) adjustments.set(p.id, (adjustments.get(p.id) || 0) + r.state.stacks[p.id] + r.state.contributions[p.id] - r.stake);
    return (await all(`SELECT u.name,u.id,w.available+w.reserved AS balance FROM wallets w JOIN users u ON u.id=w.user_id WHERE w.context=? AND u.banned=0`, context)).map(u => ({ ...u, balance: u.balance + (adjustments.get(u.id) || 0), wins: wins.get(u.id) || 0 })).sort((a,b)=>b.balance-a.balance || a.name.localeCompare(b.name)).map((p,i)=>({...p,rank:i+1,profit:p.balance-allocation,gamesPlayed:played.get(p.id)||0}));
  };
  await tx(async()=>{for(const e of await events())if(['completed','canceled','archived'].includes(e.status)&&!await get('SELECT event_id FROM event_results WHERE event_id=?',e.id))await run('INSERT INTO event_results VALUES(?,?)',e.id,JSON.stringify(await board(e.id)));});
  const eventMetadata = (b, previous={}) => {
    const meta={description:'',registrationOpen:true,botsAllowed:false,visibility:'public',...previous};
    if(b.description!==undefined){if(typeof b.description!=='string'||b.description.length>1000)fail('Description too long');meta.description=b.description.trim();}
    if(b.registrationOpen!==undefined){if(typeof b.registrationOpen!=='boolean')fail('Invalid registration setting');meta.registrationOpen=b.registrationOpen;}
    if(b.botsAllowed===true)fail('Competitive event bots are disabled to prevent chip farming');
    if(b.visibility!==undefined&&b.visibility!=='public')fail('Events use public discovery; tables may be private');
    if(b.minStake!==undefined||b.maxStake!==undefined){meta.minStake=b.minStake??meta.minStake;meta.maxStake=b.maxStake??meta.maxStake;if(!integer(meta.minStake,0,100000)||!integer(meta.maxStake,meta.minStake,100000))fail('Invalid event stake range');}
    return meta;
  };
  async function registerForEvent(userId, eventId) {
    const e = await event(eventId);
    if (!['registration', 'active'].includes(e.status)) fail('Registration is closed');
    const member = await get('SELECT user_id FROM wallets WHERE user_id=? AND context=?', userId, e.id);
    if (!member && e.registrationOpen === false) fail('Registration is closed');
    if (!member && e.participantLimit && e.participants >= e.participantLimit) fail('This event has reached its participant limit');
    await initializeWallet(userId, e.id, e.startingChips);
    return wallet(userId, e.id);
  }
  const canPlay = async (user, context, game, stake, isPrivate = false) => {
    const s = (await settings()); if (s.maintenance) fail('The casino is under maintenance');
    if (!['bluff', 'chromatic', 'poker', 'ohhell', 'rummy'].includes(game) || !s[game]) fail('This game is unavailable');
    if (!integer(stake, game==='poker'?10:0,100000))fail('Invalid ante or buy-in');
    if (context !== 'casual') {
      const e = (await event(context)); if (e.status !== 'active') fail('Event is not active');
      
      if (!e.games.includes(game) || (e.minStake!==undefined?stake<e.minStake||stake>e.maxStake:!e.stakes.includes(stake))) fail('Game or stake is not allowed in this event');
      if (!(await get('SELECT user_id FROM wallets WHERE user_id=? AND context=?', user.id, context))) fail('Join the event first');
    }
  };
  const freeSeat = async user => {
    if ((await rooms(true)).some(r => r.players.some(p => p.id === user.id&&!p.left))) fail('Leave or finish your current table first');
  };
  async function joinTable(r, user, code) {
    if(r.players.some(p=>p.id===user.id&&p.left))fail('This seat is on autopilot until the game ends');
    if (r.players.some(p => p.id === user.id)) return safeRoom(r, user);
    if (!acceptsSeat(r)) fail('Table is not accepting players');
    if (r.private && code !== r.code) fail('Room code required', 403);
    (await freeSeat(user)); (await canPlay(user, r.context, r.game, r.stake, r.private));
    r.seatVersions ||= {}; r.seatVersions[user.id] = (r.seatVersions[user.id] || 0) + 1;
    if(!r.practice)(await money(user.id, r.context, -r.stake, r.stake, 'reserve', `${r.id}:${r.seatVersions[user.id]}`));
    r.players.push({ id: user.id, name: user.name });syncPracticeSeats(r); (await save(r)); return safeRoom(r, user);
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
        const publicRoot=resolve(ROOT,'public'), file=resolve(publicRoot,'.'+decodeURIComponent(path==='/'?'/index.html':path));
        const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.svg':'image/svg+xml','.wav':'audio/wav','.mp3':'audio/mpeg','.ogg':'audio/ogg','.woff2':'font/woff2'}[extname(file).toLowerCase()];
        if(!file.startsWith(publicRoot+sep)||!mime||!existsSync(file)||!statSync(file).isFile())fail('Not found',404);
        const content = readFileSync(file);
        res.writeHead(200, { 'Content-Type':mime, 'Cache-Control':'no-cache' });
        return res.end(req.method === 'HEAD' ? undefined : content);
      }
      rate(req.socket.remoteAddress + ':api', 10000, 60000);
      if (!['GET', 'POST'].includes(req.method)) fail('Method not allowed', 405);
      if (!allowedOrigin(req)) fail('Origin not allowed', 403);
      let user = (await authenticate(req));
      if (path === '/api/me' && req.method === 'GET') {
        const seated = user && (await rooms(true)).find(r => r.players.some(p => p.id === user.id&&!p.left));
        return send({ user: user ? publicUser(user) : null, setupRequired: !(await get("SELECT id FROM users WHERE role='superadmin'")),
          activeTable: seated ? {id:seated.id, context:seated.context} : null });
      }
      const b = req.method === 'POST' ? await body(req,path==='/api/profile'?3*1024*1024:16384) : {};
      // Reading a streamed body yields to other requests. Recheck revoked sessions and roles.
      if (req.method === 'POST') user = (await authenticate(req));
      if (user) rate(user.id + ':api', apiLimit, 60000);
      if (path === '/api/guest' && req.method === 'POST') {
        if (user) return send({ user: publicUser(user) });
        rate(req.socket.remoteAddress + ':guest', 120, 15 * 60000);
        if ((await settings()).maintenance) fail('The casino is under maintenance');
        const nickname = typeof b.name === 'string' ? b.name.trim() : '';
        if ((b.name !== undefined && typeof b.name !== 'string') || !/^[\p{L}\p{N} _-]{0,16}$/u.test(nickname)) fail('Choose a nickname up to 16 letters, numbers, spaces, _ or -');
        // The tag distinguishes guests with the same nickname and cannot collide with a member name.
        const guest = { id: randomUUID(), role: 'guest' };
        await tx(async () => {
          do {
            guest.name = (nickname || 'Guest') + ' #' + randomBytes(3).toString('hex').toUpperCase();
          } while (await get('SELECT id FROM users WHERE name=?', guest.name));
          await run('INSERT INTO users VALUES(?,?,?,?,0,?)', guest.id, guest.name, '', guest.role, Date.now());
          await ensureProfile(guest.id);
          await loginSession(res, guest);
        });
        return send({ user: publicUser(guest) });
      }
      if (['/api/register', '/api/login', '/api/setup'].includes(path) && req.method === 'POST') {
        const upgradingGuest = path === '/api/register' && user?.role === 'guest' ? user.id : null;
        rate(req.socket.remoteAddress + ':auth', 300, 15 * 60000);
        if (!text(b.name, 3, 24) || !/^[\p{L}\p{N} _-]+$/u.test(b.name.trim())) fail('Use a 3–24 character name with letters, numbers, spaces, _ or -');
        if (typeof b.password !== 'string' || b.password.length < 12 || b.password.length > 128) fail('Use a password with 12–128 characters');
        const name = b.name.trim(); let account;
        rate(req.socket.remoteAddress + ':auth:' + name.toLowerCase(), 12, 15 * 60000);
        if (path === '/api/login') {
          account = (await get('SELECT * FROM users WHERE name=?', name));
          const [salt, encoded] = (account?.password || `${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
          const derived = await scrypt(b.password, salt, 64);
          account = (await get('SELECT * FROM users WHERE name=?', name));
          if (!timingSafeEqual(derived, Buffer.from(encoded, 'hex')) || !account || account.banned) fail('Invalid name or password', 401);
        } else {
          if ((await settings()).maintenance) fail('Registration is temporarily paused');
          if (path === '/api/setup' && (!setupToken || typeof b.token !== 'string' || !timingSafeEqual(Buffer.from(digest(b.token)), Buffer.from(digest(setupToken))))) fail('Invalid owner setup token', 403);
          const salt = randomBytes(16).toString('hex'); const hash = (await scrypt(b.password, salt, 64)).toString('hex');
          account = (await tx(async () => {
            if ((await get('SELECT id FROM users WHERE name=?', name))) fail('That name is already in use', 409);
            if (path === '/api/setup' && (await get("SELECT id FROM users WHERE role='superadmin'"))) fail('Owner has already been configured', 409);
            const guest = path === '/api/register' && await authenticate(req);
            if (upgradingGuest && (guest?.id !== upgradingGuest || guest.role !== 'guest')) fail('Guest account changed. Refresh to continue.',409);
            if (guest && guest.role === 'guest') {
              await run("UPDATE users SET name=?,password=?,role='player' WHERE id=?", name, `${salt}:${hash}`, guest.id);
              for (const r of await rooms()) {
                const seat = r.players.find(p => p.id === guest.id);
                if (seat && (!r.settled || (r.practice && r.status === 'finished'))) {
                  seat.name = name;
                  await save(r);
                }
              }
              await run('DELETE FROM sessions WHERE user_id=?',guest.id);
              await audit(guest.id,'account-created',guest.id,{ fromGuest:true });
              const converted = await get('SELECT * FROM users WHERE id=?', guest.id);
              await loginSession(res, converted);
              return converted;
            }
            const id = randomUUID(); const role = path === '/api/setup' ? 'superadmin' : 'player';
            (await run('INSERT INTO users VALUES(?,?,?,?,0,?)', id, name, `${salt}:${hash}`, role, Date.now()));
            await ensureProfile(id);
            (await audit(id, 'account-created', id, { role }));
            const created = await get('SELECT * FROM users WHERE id=?', id);
            await loginSession(res, created);
            return created;
          }));
        }
        if (path === '/api/login') await loginSession(res, account);
        (await broadcast()); return send({ user: publicUser(account) });
      }
      if (!user) fail('Sign in to continue', 401);
      const avatarMatch=/^\/api\/avatars\/([a-zA-Z0-9-]+)$/.exec(path);
      if(avatarMatch&&req.method==='GET'){
        const p=await get('SELECT image_base64,version FROM user_profiles WHERE user_id=?',avatarMatch[1]);
        if(!p?.image_base64)fail('Avatar not found',404);
        res.writeHead(200,{'Content-Type':'image/webp','Cache-Control':'private, max-age=3600','ETag':`"avatar-${avatarMatch[1]}-${p.version}"`});
        return res.end(Buffer.from(p.image_base64,'base64'));
      }
      if(path==='/api/profile'){
        if(req.method==='GET')return send({profile:profileView(user),user:publicUser(user)});
        rate(user.id+':profile',12,60000);
        if(b.displayName!==undefined&&(!text(b.displayName,1,24)||!/^[\p{L}\p{N} _-]+$/u.test(b.displayName.trim())))fail('Use 1–24 letters, numbers, spaces, _ or -');
        if(b.preset!==undefined&&!integer(b.preset,0,23))fail('Choose an available avatar');
        if(b.image!==undefined&&b.preset!==undefined)fail('Choose a preset or upload a picture');
        let image;
        if(b.image!==undefined){
          const m=typeof b.image==='string'&&/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(b.image);
          if(!m)fail('Upload a PNG, JPEG or WebP image');
          const bytes=Buffer.from(m[2],'base64');if(bytes.length>2*1024*1024)fail('Image must be smaller than 2 MB',413);
          try{
            const decoder=sharp(bytes,{limitInputPixels:4194304,failOn:'warning',animated:false}),metadata=await decoder.metadata();
            if(!['png','jpeg','webp'].includes(metadata.format)||metadata.pages>1||!metadata.width||!metadata.height)fail('Unsupported image');
            const normalized=await decoder.rotate().resize(256,256,{fit:'cover'}).webp({quality:80}).toBuffer();
            if(normalized.length>100*1024)fail('Image is too complex');image=normalized.toString('base64');
          }catch{fail('This image could not be decoded. Choose a PNG, JPEG or WebP under 4 megapixels.');}
        }
        await tx(async()=>{
          const fresh=await authenticate(req);if(!fresh)fail('Sign in to continue',401);user=fresh;
          const p=await ensureProfile(user.id);
          await run('UPDATE user_profiles SET display_name=?,preset=?,image_base64=?,version=? WHERE user_id=?',b.displayName?.trim()??p.display_name,b.preset??p.preset,b.preset!==undefined?null:image??p.image_base64,p.version+1,user.id);
          profiles.set(user.id,await get('SELECT * FROM user_profiles WHERE user_id=?',user.id));
        });
        await broadcast();return send({profile:profileView(user),user:publicUser(user)});
      }
      const chatMatch=/^\/api\/(?:rooms|tables)\/([^/]+)\/chat$/.exec(path);
      if(chatMatch){
        let r=await room(chatMatch[1]);
        const allowed=()=>r.players.some(p=>p.id===user.id&&!p.left);
        if(!allowed())fail('Only seated players can use table chat',403);
        const viewChat=async()=>({messages:(await all('SELECT data FROM chat_messages WHERE room_id=? ORDER BY seq',r.id)).map(row=>{const m=JSON.parse(row.data);return {...m,avatar:avatar(m.userId)};}),cursor:(await get('SELECT seq FROM chat_channels WHERE room_id=?',r.id))?.seq||0});
        if(req.method==='GET')return send(await viewChat());
        rate(user.id+':chat',12,15000);
        await tx(async()=>{
          user=await authenticate(req);if(!user)fail('Sign in to continue',401);
          r=await room(chatMatch[1]);if(!allowed())fail('Only seated players can use table chat',403);
          if(b.deleteId!==undefined){
            if(r.host!==user.id)fail('Only the host can remove messages',403);
            if(!integer(b.deleteId,1,1e9))fail('Invalid message');
            await run('DELETE FROM chat_messages WHERE room_id=? AND seq=?',r.id,b.deleteId);
            await run('UPDATE chat_channels SET seq=seq+1 WHERE room_id=?',r.id);return;
          }
          if(b.emote!==undefined&&!integer(b.emote,0,11))fail('Choose an available emote');
          if(b.emote===undefined&&!text(b.text,1,240))fail('Messages must have 1–240 characters');
          if(b.text!==undefined&&b.emote!==undefined)fail('Send a message or an emote');
          await run('INSERT INTO chat_channels VALUES(?,0) ON CONFLICT(room_id) DO NOTHING',r.id);
          await run('UPDATE chat_channels SET seq=seq+1 WHERE room_id=?',r.id);
          const seq=(await get('SELECT seq FROM chat_channels WHERE room_id=?',r.id)).seq;
          const message={id:seq,at:Date.now(),userId:user.id,name:publicUser(user).name,type:b.emote===undefined?'text':'emote',...(b.emote===undefined?{text:b.text.trim()}:{emote:b.emote})};
          await run('INSERT INTO chat_messages VALUES(?,?,?)',r.id,seq,JSON.stringify(message));
          await run('DELETE FROM chat_messages WHERE room_id=? AND seq<=?',r.id,seq-100);
        });
        for(const ws of wss.clients)if(ws.readyState===1&&r.players.some(p=>p.id===ws.userId&&!p.left))ws.send(JSON.stringify({type:'chat',roomId:r.id}));
        return send(await viewChat());
      }
      if (path === '/api/logout' && req.method === 'POST') {
        const token = /(?:^|;\s*)venatus=([^;]+)/.exec(req.headers.cookie || '')?.[1];
        if (token) (await run('DELETE FROM sessions WHERE token=?', digest(token)));
        res.setHeader('Set-Cookie', `venatus=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookies ? '; Secure' : ''}`);
        (await broadcast()); return send({ ok: true });
      }
      if (path === '/api/lobby' && req.method === 'GET') {
        const context = url.searchParams.get('context') || 'casual'; if (context !== 'casual') (await event(context));
        const activeTable = (await rooms(true)).find(r => r.players.some(p => p.id === user.id && !p.left));
        return send({ user: publicUser(user), context,
          activeTable: activeTable ? {id:activeTable.id,name:activeTable.name,game:activeTable.game,context:activeTable.context} : null, events: (await events()), wallet: (await wallet(user.id, context)), participating: !!(await get('SELECT user_id FROM wallets WHERE user_id=? AND context=?', user.id, context)), settings: (await settings()),
          tables: (await rooms()).filter(r => r.context === context && ((!r.private && (['waiting','playing','paused'].includes(r.status)||r.practice&&r.status==='finished')) || r.players.some(p => p.id === user.id))).slice(-100).map(r => safeRoom(r, user)),
          leaderboard: (await board(context)), history: (await rooms()).filter(r => r.context === context && r.settled && r.players.some(p => p.id === user.id)).slice(-20).reverse().map(r => safeRoom(r, user)) });
      }
      const tableMatch = /^\/api\/tables\/([^/]+)(?:\/(join|start|leave|action|manage))?$/.exec(path);
      if (tableMatch && req.method === 'GET' && !tableMatch[2]) {
        const r = (await room(tableMatch[1])); if (r.private && !r.players.some(p => p.id === user.id)) fail('Private table', 403);
        return send(safeRoom(r, user));
      }
      if (path === '/api/admin/export' && req.method === 'GET') {
        requireAdmin(user); const context = url.searchParams.get('context') || 'casual';
        const csvCell = value => `"${String(value).replace(/^[=+@-]/, "'$&").replaceAll('"', '""')}"`;
        const csv = 'Player,Balance,Wins\r\n' + (await board(context)).map(r => [r.name,r.balance,r.wins].map(csvCell).join(',')).join('\r\n');
        res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="venatus-standings.csv"', 'Cache-Control': 'no-store' }); return res.end(csv);
      }
      if (path === '/api/admin' && req.method === 'GET') {
        requireAdmin(user); const rr = (await rooms()); return send({ users: (await all('SELECT id,name,role,banned,created FROM users')), events: (await events()), tables: rr.map(r => safeRoom(r, user)),
          audit: (await all('SELECT * FROM audit ORDER BY at DESC LIMIT 100')), ledger: (await all('SELECT * FROM ledger ORDER BY at DESC LIMIT 200')), settings: (await settings()),
          stats: { users: (await get('SELECT COUNT(*) AS n FROM users')).n, online: new Set([...wss.clients].map(c => c.userId)).size,
            tables: rr.filter(r => !r.settled).length, matches: rr.filter(r => r.status === 'finished').length, events: (await events()).filter(e => e.status === 'active').length,
            chips: (await all('SELECT context,SUM(available+reserved) AS total FROM wallets GROUP BY context')) } });
      }
      if (req.method !== 'POST') fail('Not found', 404);
      const result = (await tx(async () => {
        user = await authenticate(req);
        if (!user) fail('Sign in to continue',401);
        (await scheduledEvents());
        const joinEvent = /^\/api\/events\/([^/]+)\/join$/.exec(path);
        if (joinEvent) return { wallet: await registerForEvent(user.id, joinEvent[1]) };
        if (path === '/api/tables') {
          if(b.stake!==undefined&&!integer(b.stake,0,100000))fail('Invalid stake');
          if(b.bots!==undefined&&!integer(b.bots,0,5))fail('Choose zero to five bots');
          if((b.bots||b.practice)&&b.context&&b.context!=='casual')fail('Bots are available only in casual play');
          b.practice=!b.context||b.context==='casual';if(b.practice&&b.game!=='poker')b.stake=0;
          const minimum=['bluff','ohhell'].includes(b.game)?3:2;
          if(b.capacity!==undefined&&!integer(b.capacity,minimum,6))fail('Invalid capacity');
          if((b.bots||0)+1>(b.capacity||6))fail('Bots exceed capacity');
          if(b.botDifficulty!==undefined&&!['easy','medium','hard'].includes(b.botDifficulty))fail('Invalid bot difficulty');
          if(b.pace!==undefined&&!['quick','standard','relaxed'].includes(b.pace))fail('Choose a valid pace');
          if(b.manualResults!==undefined&&typeof b.manualResults!=='boolean')fail('Invalid result setting');
          if(b.game==='poker'){const sb=b.smallBlind??Math.max(1,Math.floor(b.stake/100)),bb=b.bigBlind??sb*2;if(!integer(sb,1,b.stake)||!integer(bb,sb+1,b.stake))fail('Blinds must satisfy 1 <= small < big <= buy-in');b.smallBlind=sb;b.bigBlind=bb;}

          (await freeSeat(user)); const context = b.context || 'casual'; (await canPlay(user, context, b.game, b.stake, !!b.private));
          if (!text(b.name, 1, 48)) fail('Table name must have 1–48 characters');
          if ((await rooms(true)).length >= 100) fail('Table limit reached');
          const r = { id: randomUUID(), name: b.name.trim(), context, game: b.game, stake: b.stake, practice:b.practice, capacity:b.capacity||6, botDifficulty:b.botDifficulty||'medium',pace:b.pace||'standard',manualResults:b.manualResults!==false,smallBlind:b.smallBlind,bigBlind:b.bigBlind, private: !!b.private, code: randomBytes(6).toString('hex').toUpperCase(), host: user.id, players: [], state: null, status: 'waiting', settled: false, created: Date.now(), lastHumanAt:Date.now(), version: 0 };
          await joinTable(r,user,r.code);for(let i=0;i<(b.bots||0);i++)r.players.push({id:'bot-'+randomUUID(),name:'Bot '+(i+1),bot:true,avatarPreset:(i+7)%24,difficulty:r.botDifficulty});await save(r);return safeRoom(r,user);
        }
        if (path === '/api/rooms/join') {
          const r = (await rooms()).find(r => r.code === String(b.code).trim().toUpperCase() && (!r.settled || r.practice && r.status==='finished'));
          if (!r) fail('Room not found',404);
          if (r.context !== 'casual' && !(await get('SELECT user_id FROM wallets WHERE user_id=? AND context=?', user.id, r.context))) {
            if (b.registerForEvent === true) await registerForEvent(user.id, r.context);
            else if (b.previewEvent === true) {
              const e = await event(r.context);
              return { registration: { name:e.name, startingChips:e.startingChips, stake:r.stake } };
            }
          }
          return joinTable(r, user, r.code);
        }
        if (tableMatch) {
          const r = (await room(tableMatch[1])); const op = tableMatch[2];
          if (op === 'join') return (await joinTable(r, user, b.code));
          if (!r.players.some(p => p.id === user.id)) fail('You are not seated at this table', 403);
          if(op==='manage') {
            if(r.host!==user.id)fail('Only the host can manage this table',403);
            if(!['waiting','finished'].includes(r.status)&&!betweenCasualHands(r))fail('Manage seats between games');
            if(b.operation==='close'){if(r.settled&&!r.practice)return {ok:true};if(!r.settled)await cancel(r,user.id,'Host closed table');r.status='canceled';await save(r);return {ok:true};}
            if(!r.practice)fail('Bots and rematches are available in casual play');
            if(b.difficulty!==undefined&&!['easy','medium','hard'].includes(b.difficulty))fail('Invalid difficulty');
            if(b.operation==='rematch'){if(r.status!=='finished')fail('Finish current game first');for(const p of r.players.filter(p=>!p.bot&&!p.left))await freeSeat(p);r.players=r.players.filter(p=>!p.left);r.state=null;r.status='waiting';r.settled=false;r.payouts=null;r.finished=null;r.created=Date.now();r.botMovedAt=null;r.botChallengeChecked=null;}
            else if(b.operation==='remove-bot'){if(betweenCasualHands(r)&&r.players.length<=2)fail('Poker needs at least two seats');if(!r.players.some(p=>p.id===b.botId&&p.bot))fail('Bot not found');r.players=r.players.filter(p=>p.id!==b.botId);}
            else if(['add-bot','fill-bots'].includes(b.operation)){const n=b.operation==='fill-bots'?(r.capacity||6)-r.players.length:1;if(r.players.length+n>(r.capacity||6))fail('Table is full');for(let i=0;i<n;i++){const used=new Set(r.players.filter(p=>p.bot).map(p=>p.avatarPreset));const preset=Array.from({length:24},(_,j)=>(j+7)%24).find(id=>!used.has(id));r.players.push({id:'bot-'+randomUUID(),name:'Bot '+(r.players.length+1),bot:true,avatarPreset:preset,difficulty:b.difficulty||r.botDifficulty||'medium'});}}
            else fail('Unknown operation');syncPracticeSeats(r);await save(r);return safeRoom(r,user);
          }
          if (op === 'leave') {
            if(betweenCasualHands(r)){r.players=r.players.filter(p=>p.id!==user.id);syncPracticeSeats(r);if(r.players.length<2||!r.players.some(p=>!p.bot&&!p.left))await cancel(r,user.id,'Table emptied between hands');else{if(r.host===user.id)r.host=r.players.find(p=>!p.bot&&!p.left).id;await save(r);}return {ok:true};}
            if(['playing','paused'].includes(r.status)){r.players.find(p=>p.id===user.id).left=true;if(!r.players.some(p=>!p.bot&&!p.left))await cancel(r,user.id,'All human players left');else{if(r.host===user.id)r.host=r.players.find(p=>!p.bot&&!p.left).id;await save(r);}return {ok:true,autopilot:!r.settled};}
            if (!r.settled) { if(!r.practice)(await money(user.id, r.context, r.stake, -r.stake, 'refund', `${r.id}:${r.seatVersions?.[user.id] || 0}`)); r.players = r.players.filter(p => p.id !== user.id); if (!r.players.some(p=>!p.bot&&!p.left)) { r.status = 'canceled'; r.settled = true; } else if (r.host === user.id) r.host = r.players.find(p=>!p.bot&&!p.left).id; (await save(r)); }
            if(r.settled&&r.practice){r.players=r.players.filter(p=>p.id!==user.id);if(!r.players.some(p=>!p.bot&&!p.left))r.status='canceled';else if(r.host===user.id)r.host=r.players.find(p=>!p.bot&&!p.left).id;await save(r);}
            return {ok:true};
          }
          if (op === 'start') {
            if (r.host !== user.id) fail('Only the host can deal', 403);
            if (r.status !== 'waiting') fail('Match already started');
            for (const p of r.players.filter(p=>!p.bot)) { if ((await get('SELECT banned FROM users WHERE id=?', p.id)).banned) fail('A seated player is banned'); }
            (await canPlay(user, r.context, r.game, r.stake, r.private));
            if (r.players.length < (['bluff','ohhell'].includes(r.game) ? 3 : 2)) fail('More players are needed');
            r.state = createGame(r.game, r.players.map(p => p.id), Date.now(), {buyIn:r.stake,smallBlind:r.smallBlind,bigBlind:r.bigBlind,houseRules:'street',pace:r.pace||'standard',humanPlayers:r.players.filter(p=>!p.bot&&!p.left).map(p=>p.id),manualResults:r.manualResults!==false}); r.status = 'playing'; r.started = Date.now();r.lastHumanAt=Date.now(); (await save(r));
            (await audit(user.id, 'match-started', r.id, { game: r.game, players: r.players.map(p => p.id) })); return safeRoom(r, user);
          }
          if (op === 'action') {
            if(r.players.find(p=>p.id===user.id)?.left)fail('Your seat is on autopilot',403);
            if (!text(b.actionId, 8, 100)) fail('Action identifier required');
            if ((await get('SELECT action_id FROM actions WHERE room_id=? AND user_id=? AND action_id=?', r.id, user.id, b.actionId))) return safeRoom(r, user);
            if (r.status !== 'playing') fail('Match is not running');
            const readyForCurrent=b.action?.type==='ready'&&b.action.presentationId&&b.action.presentationId===r.state.presentation?.id;
            if (b.expectedVersion !== r.version&&!readyForCurrent) fail('The table changed. Refresh and try again.', 409);
            if (!b.action || typeof b.action !== 'object') fail('Action required');
            if (r.game === 'rummy' && ['analyze','declare'].includes(b.action.type)) rate(user.id + ':rummy-analysis', 30, 60000);
            syncPresentationHumans(r);r.lastHumanAt=Date.now();
            try { r.state = actGame(r.state, user.id, b.action); } catch (e) { fail(e.message); }
            (await finish(r)); (await save(r));
            (await run('INSERT INTO actions VALUES(?,?,?)', r.id, user.id, b.actionId)); return safeRoom(r, user);
          }
        }
        if (path.startsWith('/api/admin/')) {
          requireAdmin(user);
          if (path === '/api/admin/event') {
            requireOwner(user);const meta=eventMetadata(b);
            if (!text(b.name, 3, 80) || !integer(b.startingChips, 100, 1000000) || !Array.isArray(b.stakes) || !b.stakes.length || b.stakes.length > 20 || b.stakes.some(s => !integer(s, 0, b.startingChips)) || !Array.isArray(b.games) || !b.games.length || b.games.some(g => !['bluff','chromatic','poker','ohhell','rummy'].includes(g))) fail('Invalid event settings');
            const startsAt=b.startsAt??null, endsAt=b.endsAt??null, participantLimit=b.participantLimit??null;
            if(startsAt!==null&&!integer(startsAt,Date.now(),Date.now()+5*366*86400000) || endsAt!==null&&!integer(endsAt,Date.now()+1,Date.now()+5*366*86400000) || startsAt!==null&&endsAt!==null&&endsAt<=startsAt || participantLimit!==null&&!integer(participantLimit,2,10000))fail('Invalid event schedule or participant limit');
            const id = randomUUID(); (await run('INSERT INTO events VALUES(?,?,?,?,?,?,?)', id, b.name.trim(), 'draft', b.startingChips, JSON.stringify([...new Set(b.stakes)]), JSON.stringify([...new Set(b.games)]), Date.now()));
            (await run('INSERT INTO event_options VALUES(?,?,?,?)',id,startsAt,endsAt,participantLimit));
            await run('INSERT INTO event_metadata VALUES(?,?)',id,JSON.stringify(meta));
            (await audit(user.id, 'event-created', id, b)); return (await event(id));
          }
          const em = /^\/api\/admin\/event\/([^/]+)$/.exec(path);
          if (em) {
            requireOwner(user); const e = (await event(em[1]));
            if(b.operation==='configure'){
              if(['completed','canceled','archived'].includes(e.status))fail('Final event configuration is locked');
              const old=JSON.parse((await get('SELECT data FROM event_metadata WHERE event_id=?',e.id))?.data||'{}');const meta=eventMetadata(b,old);
              const startsAt=b.startsAt===undefined?e.startsAt:b.startsAt,endsAt=b.endsAt===undefined?e.endsAt:b.endsAt;
              if(b.startsAt!==undefined&&(!['draft','registration'].includes(e.status)||startsAt!==null&&!integer(startsAt,Date.now(),Date.now()+5*366*86400000)))fail('Start date can only change before the event starts');
              if(endsAt!==null&&(!integer(endsAt,Date.now()+1,Date.now()+5*366*86400000)||startsAt!==null&&endsAt<=startsAt))fail('Invalid end date');
              await run('INSERT INTO event_metadata VALUES(?,?) ON CONFLICT(event_id) DO UPDATE SET data=excluded.data',e.id,JSON.stringify(meta));
              await run('INSERT INTO event_options VALUES(?,?,?,?) ON CONFLICT(event_id) DO UPDATE SET starts_at=excluded.starts_at,ends_at=excluded.ends_at',e.id,startsAt,endsAt,e.participantLimit);
              await audit(user.id,'event-configured',e.id,b);return await event(e.id);
            }
            const transitions = { draft: ['registration','active','canceled'], registration: ['active','canceled'], active: ['paused','completed','canceled'], paused: ['active','completed','canceled'], completed: ['archived'], canceled: ['archived'], archived: [] };
            if (!transitions[e.status].includes(b.status)) fail('Invalid event transition');
            for (const r of (await rooms()).filter(r => r.context === e.id && !r.settled)) {
              if (['completed','canceled'].includes(b.status)) (await cancel(r, user.id, 'Event closed; unfinished stakes refunded'));
              else if (b.status === 'paused' && r.status === 'playing') await pauseRoom(r, true);
              else if (b.status === 'active' && r.status === 'paused' && r.pausedByEvent) await resumeRoom(r);
            }
            if(['completed','canceled'].includes(b.status))await run('INSERT INTO event_results VALUES(?,?) ON CONFLICT(event_id) DO NOTHING',e.id,JSON.stringify(await board(e.id)));
            (await run('UPDATE events SET status=? WHERE id=?', b.status, e.id)); (await audit(user.id, 'event-status', e.id, { before: e.status, after: b.status })); return (await event(e.id));
          }
          const um = /^\/api\/admin\/user\/([^/]+)$/.exec(path);
          if (um) {
            const target = (await get('SELECT * FROM users WHERE id=?', um[1])); if (!target) fail('Player not found', 404);
            if (target.role === 'superadmin') fail('Owner account cannot be modified here');
            if (b.role !== undefined) { requireOwner(user); if (target.role==='guest' || !['player','moderator'].includes(b.role)) fail('Only registered players can change role'); (await run('UPDATE users SET role=? WHERE id=?', b.role, target.id)); }
            if (b.banned !== undefined) {
              if (typeof b.banned !== 'boolean') fail('Invalid ban value');
              if (target.role === 'moderator') requireOwner(user);
              (await run('UPDATE users SET banned=? WHERE id=?', b.banned ? 1 : 0, target.id));
              if (b.banned) { (await run('DELETE FROM sessions WHERE user_id=?', target.id)); for (const r of (await rooms()).filter(r => !r.settled && r.players.some(p => p.id === target.id))) (await cancel(r, user.id, 'Participant banned; table refunded')); }
            }
            if (b.revoke) { if (target.role === 'moderator') requireOwner(user); (await run('DELETE FROM sessions WHERE user_id=?', target.id)); }
            if (b.adjustment !== undefined) {
              requireOwner(user); if (!integer(b.adjustment, -1000000, 1000000) || !b.adjustment || !text(b.reason, 5, 200)) fail('Valid chip adjustment and reason required');
              const context = b.context || 'casual'; if (context !== 'casual' && !['registration','active','paused'].includes((await event(context)).status)) fail('This event economy is frozen');
              if (!(await get('SELECT user_id FROM wallets WHERE user_id=? AND context=?', target.id, context))) fail('Player has no wallet in this economy');
              const correctionId = randomUUID();
              (await money(target.id, context, b.adjustment, 0, 'admin-adjustment', correctionId));
              (await audit(user.id, 'chip-correction', correctionId, { player: target.id, context, adjustment: b.adjustment, reason: b.reason }));
            }
            (await audit(user.id, 'player-updated', target.id, { before: publicUser(target), change: b })); return { ok: true };
          }
          const tm = /^\/api\/admin\/table\/([^/]+)$/.exec(path);
          if (tm) {
            const r = (await room(tm[1]));
            if (b.operation === 'cancel') (await cancel(r, user.id, 'Administrator canceled'));
            else if (b.operation === 'pause' && r.status === 'playing') await pauseRoom(r, false);
            else if (b.operation === 'resume' && r.status === 'paused') {
              if (r.context !== 'casual' && (await event(r.context)).status !== 'active') fail('Resume the event first');
              await resumeRoom(r);
            } else fail('Invalid table operation');
            (await audit(user.id, 'table-control', r.id, b)); return safeRoom(r, user);
          }
          if (path === '/api/admin/settings') {
            requireOwner(user); const s = (await settings());
            for (const k of ['bluff','chromatic','poker','ohhell','rummy','maintenance']) if (b[k] !== undefined) { if (typeof b[k] !== 'boolean') fail('Invalid setting'); s[k] = b[k]; }
            if (b.startingChips !== undefined) { if (!integer(b.startingChips, 100, 1000000)) fail('Invalid allocation'); s.startingChips = b.startingChips; }
            if (b.announcement !== undefined) { if (typeof b.announcement !== 'string' || b.announcement.length > 400) fail('Announcement too long'); s.announcement = b.announcement; }
            (await run('UPDATE settings SET data=? WHERE id=1', JSON.stringify(s))); (await audit(user.id, 'settings-updated', 'platform', s)); return s;
          }
        }
        fail('Not found', 404);
      }));
      (await broadcast()); send(result);
    } catch (e) {
      if (!e.status && !/constraint/i.test(e.message)) console.error('Request failed:', e.message);
      send({ error: e.status ? e.message : (/constraint/i.test(e.message) ? 'The operation conflicts with existing data' : 'The action could not be completed') }, e.status || 400);
    }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false });
  server.on('upgrade', async (req, socket, head) => {
    socket.on('error', () => {});
    try {
    const user = (await authenticate(req));
    if (req.url !== '/ws' || !user || !allowedOrigin(req) || wss.clients.size > 1000) { socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return socket.destroy(); }
    wss.handleUpgrade(req, socket, head, ws => {
      ws.userId = user.id; ws.request = req; ws.alive = true;
      ws.on('pong', () => { ws.alive = true; });
      ws.on('error', () => {});
      const count = connections.get(user.id) || 0;
      connections.set(user.id, count + 1);
      if (count === 0) notifyPresence();
      else ws.send(JSON.stringify({ type: 'refresh' }));
      ws.once('close', () => {
        const remaining = connections.get(user.id) - 1;
        if (remaining) connections.set(user.id, remaining);
        else { connections.delete(user.id); notifyPresence(); }
      });
    });
    } catch { socket.destroy(); }
  });
  function notifyPresence() {
    for (const ws of wss.clients) if (ws.readyState === 1) ws.send('{"type":"refresh"}');
  }
  async function broadcast() {
    try { for (const client of wss.clients) { if (!(await authenticate(client.request))) client.close(1008, 'Session expired'); else if (client.readyState === 1) client.send(JSON.stringify({ type: 'refresh' })); } }
    catch { for (const client of wss.clients) client.terminate(); }
  }
  let closing = false, ticking = null, heartbeating = null;
  let lastActivity = Date.now();
  // Stop polling remote storage when nobody is using the casino so Neon can suspend.
  server.on('request', req => { if (req.url?.startsWith('/api/')) lastActivity = Date.now(); });
  const timer = setInterval(() => {
    if (closing || ticking || (storage.kind === 'postgres' && !wss.clients.size && Date.now() - lastActivity > 60000)) return;
    ticking = tx(async () => {
      let changed = await scheduledEvents();
      // Read and mutate under the same lock: never overwrite a newer player action.
      for (const r of await rooms(true)) {
        if (r.status === 'waiting' && Date.now() - r.created > 30 * 60000) { await cancel(r,'system','Waiting room expired'); changed = true; }
        const humans=r.players.filter(p=>!p.bot&&!p.left);
        const lastHumanAt=Math.max(r.lastHumanAt||r.created,...humans.map(p=>seenHumans.get(p.id)||0));
        if (r.status === 'playing' && !humans.some(p=>connections.has(p.id)) && Date.now()-lastHumanAt>30*60000) {
          await cancel(r,'system','Table idle without human players for thirty minutes'); changed = true; continue;
        }
        if(r.status!=='playing')continue;
        syncPresentationHumans(r);
        const now=Date.now(),actor=r.players.find(p=>p.id===r.state.turn);
        const botDelay=Math.round((1800+parseInt(digest(`${r.id}:${r.state.moves}:${r.state.turn}:${r.state.phase}`).slice(0,6),16)%1401)*({quick:.75,standard:1,relaxed:1.4}[r.pace]||1));
        if (r.state.deadline <= now) {
          try { r.state = tickGame(r.state, now); }
          catch { await cancel(r,'system','Rules engine recovery refund'); changed = true; continue; }
          await finish(r); await save(r); changed = true; continue;
        }
        try{
          if(r.game==='bluff'&&r.state.phase==='challenge'&&now-(r.savedAt||0)>=botDelay&&r.botChallengeChecked!==r.state.moves){r.botChallengeChecked=r.state.moves;for(const p of r.players.filter(p=>(p.bot||p.left)&&p.id!==r.state.lastPlay.player)){const a=botAction(viewGame(r.state,p.id),Math.random,p.difficulty||'medium');if(a){r.state=actGame(r.state,p.id,a,now);break;}}await finish(r);await save(r);changed=true;continue;}
          if(actor&&(actor.bot||actor.left)&&r.state.phase!=='challenge'&&now-(r.botMovedAt||r.savedAt||0)>=botDelay){const a=botAction(viewGame(r.state,actor.id),Math.random,actor.difficulty||'medium');if(a){r.state=actGame(r.state,actor.id,a,now);r.botMovedAt=now;await finish(r);await save(r);changed=true;continue;}}
        }catch{await cancel(r,'system','Automated seat recovery');changed=true;continue;}
      }
      return changed;
    }).then(changed => changed ? broadcast() : undefined)
      .catch(() => console.error('Game timer delayed: database unavailable; saved state is unchanged.'))
      .finally(() => { ticking = null; });
  },tickMs);
  const heartbeat = setInterval(() => {
    if (closing || heartbeating || !wss.clients.size) return;
    heartbeating = (async () => {
      for (const ws of wss.clients) {
        if (!ws.alive || !await authenticate(ws.request)) { ws.terminate(); continue; }
        ws.alive = false; ws.ping();
      }
      await run('DELETE FROM sessions WHERE expires<?',Date.now());
      for (const [key,value] of rates) if (value.until < Date.now()) rates.delete(key);
    })().catch(() => console.error('Connection check delayed: database unavailable.')).finally(() => { heartbeating = null; });
  },30000);
  return { server, db, storage, close: async () => {
    closing = true; clearInterval(timer); clearInterval(heartbeat);
    for (const ws of wss.clients) ws.terminate(); wss.close();
    await new Promise(resolve => server.close(resolve));
    await Promise.allSettled([ticking,heartbeating]); await storage.close();
  } };

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
  if (process.env.NODE_ENV === 'production' && !/^https:\/\//.test(process.env.ORIGIN || process.env.RENDER_EXTERNAL_URL || '')) throw new Error('Set ORIGIN to the public HTTPS origin');
  const app = (await createApp({ dbPath: resolve(dataDir, 'casino.sqlite'), setupToken }));
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
