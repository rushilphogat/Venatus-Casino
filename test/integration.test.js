import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import WebSocket from 'ws';
import { createApp } from '../src/server.js';

const password = 'Venatus-test-password-42';

test('scheduled events enforce participant limits, start and end with exactly-once refunds',async t=>{
  const f=await fixture(t),a=await f.account('Scheduled Alice'),b=await f.account('Scheduled Bob'),c=await f.account('Scheduled Cara');
  const settings={name:'Scheduled club',startingChips:1000,stakes:[100],games:['poker'],participantLimit:2,startsAt:Date.now()+60000,endsAt:Date.now()+120000};
  assert.equal((await f.request('/api/admin/event',{cookie:f.owner.cookie,body:{...settings,endsAt:settings.startsAt-1}})).status,400);
  const e=await f.ok('/api/admin/event',f.owner.cookie,settings);
  await f.ok(`/api/admin/event/${e.id}`,f.owner.cookie,{status:'registration'});
  await Promise.all([a,b].map(p=>f.ok(`/api/events/${e.id}/join`,p.cookie,{})));
  assert.equal((await f.request(`/api/events/${e.id}/join`,{cookie:c.cookie,body:{}})).status,400);
  await f.ok(`/api/events/${e.id}/join`,a.cookie,{});
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM wallets WHERE context=?').get(e.id).n,2);
  f.db.prepare('UPDATE event_options SET starts_at=? WHERE event_id=?').run(Date.now()-1,e.id);
  const r=await f.ok('/api/tables',a.cookie,{name:'Scheduled poker',game:'poker',stake:100,context:e.id});
  await f.ok(`/api/tables/${r.id}/join`,b.cookie,{});await f.ok(`/api/tables/${r.id}/start`,a.cookie,{});
  assert.equal((await f.ok(`/api/lobby?context=${e.id}`,a.cookie)).events.find(x=>x.id===e.id).status,'active');
  f.db.prepare('UPDATE event_options SET ends_at=? WHERE event_id=?').run(Date.now()-1,e.id);
  for(let n=0;n<30;n++){if((await f.ok(`/api/tables/${r.id}`,a.cookie)).status==='canceled')break;await new Promise(resolve=>setTimeout(resolve,20));}
  assert.equal((await f.ok(`/api/tables/${r.id}`,a.cookie)).status,'canceled');
  for(const p of [a,b])assert.deepEqual((await f.ok(`/api/lobby?context=${e.id}`,p.cookie)).wallet,{available:1000,reserved:0});
  await f.restart();
  assert.equal((await f.ok(`/api/lobby?context=${e.id}`,a.cookie)).events.find(x=>x.id===e.id).status,'completed');
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='event-scheduled-status' AND target=?").get(e.id).n,2);
});

async function newGame(f, game, count=2) {
  const players=[]; for(let i=0;i<count;i++) players.push(await f.account(`${game} Player ${i}`));
  let room=await f.ok('/api/tables',players[0].cookie,{name:`${game} integration`,game,stake:100,context:'casual'});
  for(const p of players.slice(1))await f.ok(`/api/tables/${room.id}/join`,p.cookie,{});
  room=await f.ok(`/api/tables/${room.id}/start`,players[0].cookie,{});
  const view=p=>f.ok(`/api/tables/${room.id}`,p.cookie);
  const act=async(p,action)=>{const r=await view(p);return f.ok(`/api/tables/${room.id}/action`,p.cookie,{actionId:randomUUID(),expectedVersion:r.version,action});};
  return {players,room,view,act};
}

test('poker HTTP cashout and cancellation preserve completed hands and settle once',async t=>{
  const f=await fixture(t),g=await newGame(f,'poker');
  let r=await g.view(g.players[0]);
  const actor=g.players.find(p=>p.id===r.state.turn);
  await g.act(actor,{type:'fold'});
  r=await g.view(actor);assert.equal(r.state.phase,'between-hands');
  const stacks={...r.state.stacks};assert.notEqual(stacks[actor.id],100);
  const board=(await f.ok('/api/lobby',actor.cookie)).leaderboard;
  for(const p of g.players)assert.equal(board.find(x=>x.id===p.id).balance,9900+stacks[p.id]);
  await g.act(actor,{type:'next-hand'});
  await f.ok(`/api/admin/table/${r.id}`,f.owner.cookie,{operation:'cancel'});
  await f.ok(`/api/admin/table/${r.id}`,f.owner.cookie,{operation:'cancel'});
  for(const p of g.players)assert.deepEqual((await f.ok('/api/lobby',p.cookie)).wallet,{available:9900+stacks[p.id],reserved:0});
  // Reuse the same accounts to test normal cashout through the public API.
  const second=await f.ok('/api/tables',actor.cookie,{name:'Cashout',game:'poker',stake:100,context:'casual'});
  const other=g.players.find(p=>p.id!==actor.id);await f.ok(`/api/tables/${second.id}/join`,other.cookie,{});
  await f.ok(`/api/tables/${second.id}/start`,actor.cookie,{});
  for(const action of [{type:'request-cashout'},{type:'fold'}]){
    const current=await f.ok(`/api/tables/${second.id}`,actor.cookie);
    const p=g.players.find(p=>p.id===current.state.turn);
    await f.ok(`/api/tables/${second.id}/action`,p.cookie,{actionId:randomUUID(),expectedVersion:current.version,action});
  }
  assert.equal((await f.ok(`/api/tables/${second.id}`,actor.cookie)).status,'finished');
  let total=0;for(const p of g.players){const w=(await f.ok('/api/lobby',p.cookie)).wallet;assert.equal(w.reserved,0);total+=w.available;}assert.equal(total,20000);
});

test('Oh Hell completes nine rounds over HTTP with private hands and exact payouts',async t=>{
  const f=await fixture(t),g=await newGame(f,'ohhell',3);let r=await g.view(g.players[0]);
  for(let n=0;n<300&&r.status==='playing';n++){
    const p=g.players.find(p=>p.id===r.state.turn);r=await g.view(p);const s=r.state;
    assert.equal(s.hands,undefined);
    await g.act(p,s.phase==='round-end'?{type:'next-round'}:s.phase==='bid'?{type:'bid',amount:s.legalBids[0]}:{type:'play',cards:[s.legalCardIds[0]]});
    r=await g.view(p);
  }
  assert.equal(r.status,'finished');assert.equal(r.state.history.length,9);
  let sum=0;for(const p of g.players){const w=(await f.ok('/api/lobby',p.cookie)).wallet;assert.equal(w.reserved,0);sum+=w.available;}assert.equal(sum,30000);
});

test('Rummy HTTP draw, analysis, discard, drop and settlement keep hands private',async t=>{
  const f=await fixture(t),g=await newGame(f,'rummy');let r=await g.view(g.players[0]);
  const first=g.players.find(p=>p.id===r.state.turn),other=g.players.find(p=>p.id!==first.id);
  await g.act(first,{type:'draw',source:'stock'});r=await g.view(first);
  assert.equal(r.state.hand.length,14);assert.equal((await g.view(other)).state.hand.length,13);
  await g.act(first,{type:'analyze',cards:[r.state.hand[0].id]});
  assert.ok((await g.view(first)).state.analysis);assert.equal((await g.view(other)).state.analysis,null);
  await g.act(first,{type:'discard',cards:[r.state.hand[0].id]});
  await g.act(other,{type:'drop'});r=await g.view(first);assert.equal(r.status,'finished');assert.equal(r.payout,200);
  assert.deepEqual((await f.ok('/api/lobby',first.cookie)).wallet,{available:10100,reserved:0});
  assert.deepEqual((await f.ok('/api/lobby',other.cookie)).wallet,{available:9900,reserved:0});
});

test('match safety limit refunds stuck matches once', async t => {
  const f = await fixture(t);
  const a = await f.account('Timeout Alice'), b = await f.account('Timeout Bob');
  const r = await f.ok('/api/tables', a.cookie, { name: 'Long match', game: 'chromatic', stake: 100, context: 'casual' });
  await f.ok(`/api/tables/${r.id}/join`, b.cookie, {});
  await f.ok(`/api/tables/${r.id}/start`, a.cookie, {});
  const stored = JSON.parse(f.db.prepare('SELECT data FROM rooms WHERE id=?').get(r.id).data);
  stored.started = Date.now() - 3600001;
  f.db.prepare('UPDATE rooms SET data=? WHERE id=?').run(JSON.stringify(stored), r.id);
  for (let n=0;n<30;n++) {
    if ((await f.ok(`/api/tables/${r.id}`, a.cookie)).status === 'canceled') break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal((await f.ok(`/api/tables/${r.id}`, a.cookie)).status, 'canceled');
  await f.ok(`/api/admin/table/${r.id}`, f.owner.cookie, { operation: 'cancel' });
  for (const p of [a,b]) assert.deepEqual((await f.ok('/api/lobby', p.cookie)).wallet, { available: 10000, reserved: 0 });
});

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'venatus-test-'));
  const dbPath = join(directory, 'casino.sqlite');
  const setupToken = randomUUID();
  let app;
  let base;
  async function start() {
    app = createApp({ dbPath, setupToken, secureCookies: false, tickMs: 50, apiLimit: 100000 });
    app.server.listen(0, '127.0.0.1');
    await once(app.server, 'listening');
    base = `http://127.0.0.1:${app.server.address().port}`;
  }
  await start();
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  async function request(path, { cookie = '', body, method = body === undefined ? 'GET' : 'POST', origin } = {}) {
    const response = await fetch(base + path, {
      method,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(origin ? { Origin: origin } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const contentType = response.headers.get('content-type') || '';
    return {
      status: response.status,
      body: contentType.includes('application/json') ? await response.json() : await response.text(),
      cookie: response.headers.get('set-cookie')?.split(';')[0],
    };
  }
  async function ok(path, cookie, body) {
    const result = await request(path, { cookie, body });
    assert.ok(result.status >= 200 && result.status < 300, `${path}: ${result.status} ${JSON.stringify(result.body)}`);
    return result.body;
  }
  async function account(name, owner = false) {
    const result = await request(owner ? '/api/setup' : '/api/register', { body: { name, password, ...(owner ? { token: setupToken } : {}) } });
    assert.ok(result.status >= 200 && result.status < 300, JSON.stringify(result.body));
    assert.ok(result.cookie, 'Authentication issues a cookie');
    return { cookie: result.cookie, ...result.body.user };
  }
  const owner = await account('Casino Owner', true);
  return { request, ok, account, owner, get server() { return app.server; }, get db() { return app.db; }, get base() { return base; }, async restart() { await app.close(); await start(); } };
}

test('owner setup is one-time; accounts authenticate and cannot access owner APIs', async t => {
  const f = await fixture(t);
  const player = await f.account('Alice');
  assert.equal((await f.ok('/api/me', player.cookie)).user.id, player.id);
  assert.equal((await f.request('/api/admin', { cookie: player.cookie })).status, 403);
  assert.equal((await f.request('/api/admin/event', { cookie: player.cookie, body: { name: 'Forged Event' } })).status, 403);
  assert.ok((await f.request('/api/setup', { body: { name: 'Imposter', password, token: 'wrong' } })).status >= 400);
  assert.ok((await f.request('/api/register', { body: { name: 'Alice', password } })).status >= 400);
  const wallet = await f.ok('/api/lobby?context=casual', player.cookie);
  assert.equal(wallet.wallet.available, 10000);
  const login = await f.request('/api/login', { body: { name: 'Alice', password } });
  assert.equal(login.status, 200);
  assert.equal((await f.ok('/api/lobby?context=casual', login.cookie)).wallet.available, 10000);
  assert.ok((await f.request('/api/login', { body: { name: 'Alice', password: 'incorrect-password' } })).status >= 400);
  await f.ok('/api/logout', login.cookie, {});
  assert.equal((await f.ok('/api/me', login.cookie)).user, null);
});

test('seat reservations cannot double spend and release exactly once', async t => {
  const f = await fixture(t);
  const player = await f.account('Reservation Player');
  const table = await f.ok('/api/tables', player.cookie, { name: 'Quiet Table', game: 'bluff', context: 'casual', stake: 250, private: false });
  let lobby = await f.ok('/api/lobby?context=casual', player.cookie);
  assert.equal(lobby.wallet.available, 9750);
  assert.equal(lobby.wallet.reserved, 250);
  await f.request(`/api/tables/${table.id}/join`, { cookie: player.cookie, body: {} });
  lobby = await f.ok('/api/lobby?context=casual', player.cookie);
  assert.equal(lobby.wallet.available + lobby.wallet.reserved, 10000);
  await f.ok(`/api/tables/${table.id}/leave`, player.cookie, {});
  await f.request(`/api/tables/${table.id}/leave`, { cookie: player.cookie, body: {} });
  lobby = await f.ok('/api/lobby?context=casual', player.cookie);
  assert.equal(lobby.wallet.available, 10000);
  assert.equal(lobby.wallet.reserved, 0);
  assert.ok((await f.request('/api/tables', { cookie: player.cookie, body: { game: 'bluff', name: 'Bad Stake', context: 'casual', stake: -50 } })).status >= 400);
});

test('three real clients receive private hands; actions are validated and idempotent; cancellation refunds', async t => {
  const f = await fixture(t);
  const players = await Promise.all(['Player One', 'Player Two', 'Player Three'].map(name => f.account(name)));
  const table = await f.ok('/api/tables', players[0].cookie, { name: 'The Green Room', game: 'bluff', context: 'casual', stake: 250 });
  assert.ok((await f.request(`/api/tables/${table.id}/start`, { cookie: players[0].cookie, body: {} })).status >= 400, 'Insufficient seats cannot start');
  for (const p of players.slice(1)) await f.ok(`/api/tables/${table.id}/join`, p.cookie, {});
  await f.ok(`/api/tables/${table.id}/start`, players[0].cookie, {});
  const snapshots = await Promise.all(players.map(p => f.ok(`/api/tables/${table.id}`, p.cookie)));
  assert.equal(snapshots.reduce((n, s) => n + s.state.hand.length, 0), 52);
  const allCardIds = snapshots.flatMap(s => s.state.hand.map(c => c.id));
  assert.equal(new Set(allCardIds).size, 52);
  for (const s of snapshots) {
    assert.equal(s.state.hands, undefined);
    assert.equal(s.state.deck, undefined);
    assert.equal(s.state.drawPile, undefined);
    assert.equal(s.pot, 750);
  }
  const turn = players.find(p => p.id === snapshots[0].state.turn);
  const nonTurn = players.find(p => p.id !== turn.id);
  const own = await f.ok(`/api/tables/${table.id}`, turn.cookie);
  const others = await f.ok(`/api/tables/${table.id}`, nonTurn.cookie);
  assert.ok((await f.request(`/api/tables/${table.id}/action`, { cookie: nonTurn.cookie, body: { actionId: randomUUID(), expectedVersion: others.version, action: { type: 'play', cards: [others.state.hand[0].id] } } })).status >= 400);
  assert.ok((await f.request(`/api/tables/${table.id}/action`, { cookie: turn.cookie, body: { actionId: randomUUID(), expectedVersion: own.version, action: { type: 'play', cards: [others.state.hand[0].id] } } })).status >= 400);
  const action = { actionId: randomUUID(), expectedVersion: own.version, action: { type: 'play', cards: [own.state.hand[0].id] } };
  await f.ok(`/api/tables/${table.id}/action`, turn.cookie, action);
  const after = await f.ok(`/api/tables/${table.id}`, turn.cookie);
  await f.ok(`/api/tables/${table.id}/action`, turn.cookie, action);
  const duplicate = await f.ok(`/api/tables/${table.id}`, turn.cookie);
  assert.equal(duplicate.state.hand.length, own.state.hand.length - 1);
  assert.deepEqual(duplicate.state.hand, after.state.hand);
  assert.equal(duplicate.state.phase, 'challenge');
  assert.ok((await f.request(`/api/tables/${table.id}/action`, { cookie: nonTurn.cookie, body: { actionId: randomUUID(), expectedVersion: own.version, action: { type: 'challenge' } } })).status >= 400, 'Delayed actions cannot apply to a newer revision');
  await f.ok(`/api/admin/table/${table.id}`, f.owner.cookie, { operation: 'cancel' });
  await f.request(`/api/admin/table/${table.id}`, { cookie: f.owner.cookie, body: { operation: 'cancel' } });
  for (const p of players) {
    const lobby = await f.ok('/api/lobby?context=casual', p.cookie);
    assert.equal(lobby.wallet.available, 10000);
    assert.equal(lobby.wallet.reserved, 0);
  }
});

test('private room codes gate admission and are absent from the public lobby', async t => {
  const f = await fixture(t);
  const host = await f.account('Private Host');
  const guest = await f.account('Private Guest');
  const table = await f.ok('/api/tables', host.cookie, { name: 'Invitation Only', game: 'bluff', context: 'casual', stake: 250, private: true });
  assert.ok(table.code);
  const lobby = await f.ok('/api/lobby?context=casual', guest.cookie);
  assert.ok(!JSON.stringify(lobby.tables).includes(table.code));
  assert.ok((await f.request(`/api/tables/${table.id}/join`, { cookie: guest.cookie, body: {} })).status >= 400);
  assert.ok((await f.request(`/api/tables/${table.id}/join`, { cookie: guest.cookie, body: { code: 'WRONGCODE' } })).status >= 400);
  await f.ok('/api/rooms/join', guest.cookie, { code: table.code });
  const joined = await f.ok(`/api/tables/${table.id}`, guest.cookie);
  assert.ok(joined.players.some(p => p.id === guest.id));
  assert.equal((await f.ok('/api/lobby?context=casual', guest.cookie)).wallet.available, 9750);
});

test('event wallets are isolated, allocations idempotent, completed event balances frozen', async t => {
  const f = await fixture(t);
  const player = await f.account('Event Player');
  const event = await f.ok('/api/admin/event', f.owner.cookie, { name: 'Autumn Invitational', startingChips: 5000, stakes: [250], games: ['bluff', 'chromatic'] });
  await f.ok(`/api/admin/event/${event.id}`, f.owner.cookie, { status: 'registration' });
  await f.ok(`/api/events/${event.id}/join`, player.cookie, {});
  await f.ok(`/api/events/${event.id}/join`, player.cookie, {});
  assert.equal((await f.ok(`/api/lobby?context=${event.id}`, player.cookie)).wallet.available, 5000);
  assert.equal((await f.ok('/api/lobby?context=casual', player.cookie)).wallet.available, 10000);
  await f.ok(`/api/admin/event/${event.id}`, f.owner.cookie, { status: 'active' });
  const table = await f.ok('/api/tables', player.cookie, { name: 'Event Room', game: 'bluff', context: event.id, stake: 250 });
  assert.equal((await f.ok(`/api/lobby?context=${event.id}`, player.cookie)).wallet.available, 4750);
  assert.equal((await f.ok('/api/lobby?context=casual', player.cookie)).wallet.available, 10000);
  await f.ok(`/api/admin/table/${table.id}`, f.owner.cookie, { operation: 'cancel' });
  await f.ok(`/api/admin/event/${event.id}`, f.owner.cookie, { status: 'completed' });
  assert.ok((await f.request('/api/tables', { cookie: player.cookie, body: { name: 'Late Room', game: 'bluff', context: event.id, stake: 250 } })).status >= 400);
  assert.ok((await f.request(`/api/admin/user/${player.id}`, { cookie: f.owner.cookie, body: { adjustment: 100, context: event.id, reason: 'Should not change final standings' } })).status >= 400);
});

test('administrative adjustments are recorded and bounded; session revocation works', async t => {
  const f = await fixture(t);
  const player = await f.account('Managed Player');
  assert.ok((await f.request(`/api/admin/user/${player.id}`, { cookie: f.owner.cookie, body: { adjustment: 100, context: 'casual' } })).status >= 400);
  await f.ok(`/api/admin/user/${player.id}`, f.owner.cookie, { adjustment: 100, context: 'casual', reason: 'Documented test correction' });
  assert.equal((await f.ok('/api/lobby?context=casual', player.cookie)).wallet.available, 10100);
  assert.ok((await f.request(`/api/admin/user/${player.id}`, { cookie: f.owner.cookie, body: { adjustment: -20000, context: 'casual', reason: 'Invalid overdraft' } })).status >= 400);
  const admin = await f.ok('/api/admin', f.owner.cookie);
  assert.ok(admin.audit.length > 0);
  assert.ok(admin.ledger.some(row => row.reason === 'admin-adjustment' && row.delta === 100));
  assert.ok(admin.audit.some(row => JSON.stringify(row).includes('Documented test correction')));
  await f.ok(`/api/admin/user/${player.id}`, f.owner.cookie, { revoke: true });
  assert.equal((await f.ok('/api/me', player.cookie)).user, null);
});

test('sessions, wallets and room seats survive server restart', async t => {
  const f = await fixture(t);
  const player = await f.account('Persistent Player');
  const table = await f.ok('/api/tables', player.cookie, { name: 'Persistent Table', game: 'bluff', context: 'casual', stake: 250 });
  await f.restart();
  assert.equal((await f.ok('/api/me', player.cookie)).user.id, player.id);
  const lobby = await f.ok('/api/lobby?context=casual', player.cookie);
  assert.equal(lobby.wallet.available, 9750);
  assert.equal(lobby.wallet.reserved, 250);
  assert.equal((await f.ok(`/api/tables/${table.id}`, player.cookie)).players[0].id, player.id);
});

test('authenticated WebSockets broadcast changes; alien origins are rejected', async t => {
  const f = await fixture(t);
  const player = await f.account('Live Player');
  const ws = new WebSocket(f.base.replace('http:', 'ws:') + '/ws', { headers: { Cookie: player.cookie, Origin: f.base } });
  t.after(() => ws.terminate());
  await once(ws, 'open');
  const message = once(ws, 'message');
  await f.ok('/api/tables', player.cookie, { name: 'Live Table', game: 'bluff', context: 'casual', stake: 250 });
  const [raw] = await message;
  assert.equal(JSON.parse(raw.toString()).type, 'refresh');
  const alien = new WebSocket(f.base.replace('http:', 'ws:') + '/ws', { headers: { Cookie: player.cookie, Origin: 'https://evil.invalid' } });
  t.after(() => alien.terminate());
  alien.on('error', () => {});
  const [, response] = await once(alien, 'unexpected-response');
  assert.equal(response.statusCode, 403);
  alien.terminate();
  assert.ok((await f.request('/api/tables', { cookie: player.cookie, origin: 'https://evil.invalid', body: { name: 'Cross Origin', game: 'bluff', context: 'casual', stake: 250 } })).status >= 400);
});

async function verifyPayout(f, tableId, players, stake) {
  const completed = await f.ok(`/api/tables/${tableId}`, players[0].cookie);
  assert.equal(completed.status, 'finished');
  assert.ok(players.some(p => p.id === completed.state.winner));
  // Repeated administrative cancellation must never refund an already paid pot.
  await f.ok(`/api/admin/table/${tableId}`, f.owner.cookie, { operation: 'cancel' });
  await f.restart();
  let total = 0;
  for (const player of players) {
    const { wallet } = await f.ok('/api/lobby?context=casual', player.cookie);
    assert.equal(wallet.reserved, 0);
    assert.equal(wallet.available, 10000 - stake + (player.id === completed.state.winner ? stake * players.length : 0));
    total += wallet.available;
  }
  assert.equal(total, players.length * 10000);
  const settlementCount = f.db.prepare("SELECT count(*) AS n FROM ledger WHERE reason='settlement' AND reference=?").get(tableId).n;
  assert.equal(settlementCount, players.length);
}

test('complete Bluff match through HTTP actions settles exactly once, including final challenge window', async t => {
  const f = await fixture(t);
  const players = await Promise.all(['Bluff A', 'Bluff B', 'Bluff C'].map(name => f.account(name)));
  const table = await f.ok('/api/tables', players[0].cookie, { name: 'Complete Bluff', game: 'bluff', context: 'casual', stake: 250 });
  for (const p of players.slice(1)) await f.ok(`/api/tables/${table.id}/join`, p.cookie, {});
  await f.ok(`/api/tables/${table.id}/start`, players[0].cookie, {});
  let turns = 0;
  for (; turns < 30; turns++) {
    const snapshot = await f.ok(`/api/tables/${table.id}`, players[0].cookie);
    if (snapshot.status === 'finished') break;
    const player = players.find(p => p.id === snapshot.state.turn);
    const own = await f.ok(`/api/tables/${table.id}`, player.cookie);
    await f.ok(`/api/tables/${table.id}/action`, player.cookie, { actionId: randomUUID(), expectedVersion: own.version, action: { type: 'play', cards: own.state.hand.slice(0, 4).map(c => c.id) } });
    const challenged = await f.ok(`/api/tables/${table.id}`, player.cookie);
    assert.equal(challenged.state.phase, 'challenge');
    assert.equal(challenged.status, 'playing', 'Final cards cannot pay out until challenge window closes');
    // Only the test clock is accelerated. Cards, actions and payouts remain untouched.
    const row = f.db.prepare('SELECT data FROM rooms WHERE id=?').get(table.id);
    const room = JSON.parse(row.data);
    room.state.deadline = Date.now() - 1;
    f.db.prepare('UPDATE rooms SET data=? WHERE id=?').run(JSON.stringify(room), table.id);
    for (let wait = 0; wait < 40; wait++) {
      await new Promise(resolve => setTimeout(resolve, 10));
      const current = JSON.parse(f.db.prepare('SELECT data FROM rooms WHERE id=?').get(table.id).data);
      if (current.state.phase !== 'challenge') break;
    }
  }
  assert.ok(turns < 30, 'Bluff ends after the final unchallenged play');
  await verifyPayout(f, table.id, players, 250);
});

test('complete Chromatic match through HTTP legal actions conserves chips and persists payout', async t => {
  const f = await fixture(t);
  const players = await Promise.all(['Chromatic A', 'Chromatic B'].map(name => f.account(name)));
  const table = await f.ok('/api/tables', players[0].cookie, { name: 'Complete Chromatic', game: 'chromatic', context: 'casual', stake: 250 });
  await f.ok(`/api/tables/${table.id}/join`, players[1].cookie, {});
  let snapshot = await f.ok(`/api/tables/${table.id}/start`, players[0].cookie, {});
  let turns = 0;
  for (; turns < 3000 && snapshot.status !== 'finished'; turns++) {
    const player = players.find(p => p.id === snapshot.state.turn);
    const own = await f.ok(`/api/tables/${table.id}`, player.cookie);
    const playable = own.state.hand.find(c => own.state.legalCardIds?.includes(c.id));
    const color = own.state.colors.reduce((best, candidate) => own.state.hand.filter(c => c.color === candidate).length > own.state.hand.filter(c => c.color === best).length ? candidate : best, own.state.colors[0]);
    const phase = own.state.phase;
    const action = phase === 'round-end' ? {type:'next-round'} : phase === 'choose-color' ? {type:'choose-color',color} : phase === 'challenge' ? {type:'accept'} : playable ? { type: 'play', cards: [playable.id], color, declare:true } : {type:phase==='drawn'?'pass':'draw'};
    snapshot = await f.ok(`/api/tables/${table.id}/action`, player.cookie, { actionId: randomUUID(), expectedVersion: own.version, action });
  }
  assert.ok(turns < 3000, 'Chromatic match terminates with legal client actions');
  await verifyPayout(f, table.id, players, 250);
});

async function streamedPost(f, t, path, cookie, body) {
  const payload = JSON.stringify(body);
  const marker = randomUUID();
  let observed;
  const started = new Promise(resolve => { observed = req => {
    if (req.headers['x-test-request'] === marker) {
      f.server.off('request', observed);
      resolve();
    }
  }; f.server.on('request', observed); });
  let request;
  const response = new Promise((resolve, reject) => {
    request = http.request(f.base + path, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), 'X-Test-Request': marker },
    }, res => {
      let text = '';
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
    });
    request.on('error', reject);
    request.write(payload.slice(0, 1));
  });
  t.after(() => { f.server.off('request', observed); request.destroy(); });
  await started;
  return async () => { request.end(payload.slice(1)); return response; };
}

test('revoking a session rejects an already-started streamed action', async t => {
  const f = await fixture(t);
  const player = await f.account('Streaming Player');
  const finish = await streamedPost(f, t, '/api/tables', player.cookie, { name: 'Stale Session', game: 'bluff', context: 'casual', stake: 250 });
  await f.ok(`/api/admin/user/${player.id}`, f.owner.cookie, { revoke: true });
  assert.equal((await finish()).status, 401);
  const admin = await f.ok('/api/admin', f.owner.cookie);
  assert.ok(!admin.tables.some(table => table.name === 'Stale Session'));
  const wallet = f.db.prepare('SELECT available,reserved FROM wallets WHERE user_id=? AND context=?').get(player.id, 'casual');
  assert.equal(wallet.available, 10000);
  assert.equal(wallet.reserved, 0);
});

test('moderator demotion and session revocation invalidate pending administrative requests', async t => {
  const f = await fixture(t);
  const moderator = await f.account('Temporary Moderator');
  const target = await f.account('Protected Player');
  await f.ok(`/api/admin/user/${moderator.id}`, f.owner.cookie, { role: 'moderator' });
  await f.ok('/api/admin', moderator.cookie);
  assert.equal((await f.request(`/api/admin/user/${target.id}`, { cookie: moderator.cookie, body: { role: 'moderator' } })).status, 403);
  let finish = await streamedPost(f, t, `/api/admin/user/${target.id}`, moderator.cookie, { banned: true });
  await f.ok(`/api/admin/user/${moderator.id}`, f.owner.cookie, { role: 'player' });
  assert.equal((await finish()).status, 403);
  await f.ok(`/api/admin/user/${moderator.id}`, f.owner.cookie, { role: 'moderator' });
  finish = await streamedPost(f, t, `/api/admin/user/${target.id}`, moderator.cookie, { banned: true });
  await f.ok(`/api/admin/user/${moderator.id}`, f.owner.cookie, { revoke: true });
  assert.equal((await finish()).status, 401);
  const admin = await f.ok('/api/admin', f.owner.cookie);
  assert.equal(admin.users.find(user => user.id === target.id).banned, 0);
});

test('wallet ledger and administrative audit records reject updates and deletions', async t => {
  const f = await fixture(t);
  const beforeLedger = f.db.prepare('SELECT count(*) AS n FROM ledger').get().n;
  const beforeAudit = f.db.prepare('SELECT count(*) AS n FROM audit').get().n;
  assert.ok(beforeLedger > 0 && beforeAudit > 0);
  assert.throws(() => f.db.prepare('UPDATE ledger SET delta=99999').run(), /append-only/);
  assert.throws(() => f.db.prepare('DELETE FROM ledger').run(), /append-only/);
  assert.throws(() => f.db.prepare("UPDATE audit SET detail='{}'").run(), /append-only/);
  assert.throws(() => f.db.prepare('DELETE FROM audit').run(), /append-only/);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM ledger').get().n, beforeLedger);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM audit').get().n, beforeAudit);
});

test('clients cannot assign privileges, balances, pot values or game outcomes', async t => {
  const f = await fixture(t);
  const registered = await f.request('/api/register', { body: { name: 'Forged Fields', password, role: 'superadmin', balance: 900000, available: 900000 } });
  assert.ok(registered.status >= 200 && registered.status < 300);
  assert.equal(registered.body.user.role, 'player');
  const player = { ...registered.body.user, cookie: registered.cookie };
  const opponent = await f.account('Fair Opponent');
  assert.equal((await f.ok('/api/lobby', player.cookie)).wallet.available, 10000);
  const table = await f.ok('/api/tables', player.cookie, { name: 'Honest Pot', game: 'chromatic', context: 'casual', stake: 250,
    pot: 999999, players: [{ id: 'forged' }], state: { phase: 'finished', winner: player.id }, winner: player.id, balance: 999999 });
  assert.equal(table.pot, 250);
  assert.equal(table.state, null);
  assert.deepEqual(table.players.map(p => p.id), [player.id]);
  await f.ok(`/api/tables/${table.id}/join`, opponent.cookie, {});
  const started = await f.ok(`/api/tables/${table.id}/start`, player.cookie, {});
  const actor = started.state.turn === player.id ? player : opponent;
  const result = await f.ok(`/api/tables/${table.id}/action`, actor.cookie, { actionId: randomUUID(), expectedVersion: started.version,
    winner: player.id, balance: 999999, action: { type: 'draw', winner: player.id, payout: 999999, balance: 999999 } });
  assert.equal(result.status, 'playing');
  assert.equal(result.state.winner, null);
  const { wallet } = await f.ok('/api/lobby', player.cookie);
  assert.equal(wallet.available, 9750);
  assert.equal(wallet.reserved, 250);
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM ledger WHERE reason='settlement'").get().n, 0);
});

test('simultaneous seat requests cannot spend one wallet twice', async t => {
  const f = await fixture(t);
  const player = await f.account('Concurrent Player');
  const host = await f.account('Second Host');
  await f.ok(`/api/admin/user/${player.id}`, f.owner.cookie, { adjustment: -9750, context: 'casual', reason: 'Constrain wallet for concurrent reservation test' });
  const first = await f.ok('/api/tables', f.owner.cookie, { name: 'First Seat', game: 'bluff', context: 'casual', stake: 250 });
  const second = await f.ok('/api/tables', host.cookie, { name: 'Second Seat', game: 'bluff', context: 'casual', stake: 250 });
  const requests = await Promise.all([first, second].map(table => f.request(`/api/tables/${table.id}/join`, { cookie: player.cookie, body: {} })));
  assert.equal(requests.filter(result => result.status >= 200 && result.status < 300).length, 1);
  assert.equal(requests.filter(result => result.status >= 400).length, 1);
  const { wallet } = await f.ok('/api/lobby', player.cookie);
  assert.equal(wallet.available, 0);
  assert.equal(wallet.reserved, 250);
  const rooms = await Promise.all([first, second].map(table => f.ok(`/api/tables/${table.id}`, f.owner.cookie)));
  assert.equal(rooms.filter(room => room.players.some(p => p.id === player.id)).length, 1);
});

test('rejoining a waiting table creates a new reservation and exact refund each time', async t => {
  const f = await fixture(t);
  const player = await f.account('Returning Guest');
  const table = await f.ok('/api/tables', f.owner.cookie, { name: 'Return Table', game: 'bluff', context: 'casual', stake: 250 });
  for (let visit = 0; visit < 3; visit++) {
    await f.ok(`/api/tables/${table.id}/join`, player.cookie, {});
    let { wallet } = await f.ok('/api/lobby', player.cookie);
    assert.equal(wallet.available, 9750);
    assert.equal(wallet.reserved, 250);
    await f.ok(`/api/tables/${table.id}/leave`, player.cookie, {});
    ({ wallet } = await f.ok('/api/lobby', player.cookie));
    assert.equal(wallet.available, 10000);
    assert.equal(wallet.reserved, 0);
  }
  const rows = f.db.prepare("SELECT reason,count(*) AS n FROM ledger WHERE user_id=? AND reason IN ('reserve','refund') GROUP BY reason").all(player.id);
  assert.equal(rows.find(row => row.reason === 'reserve').n, 3);
  assert.equal(rows.find(row => row.reason === 'refund').n, 3);
});
