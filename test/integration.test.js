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
import { postgresStorage } from './postgres-fixture.js';

const password = 'Venatus-test-password-42';

async function guestAccount(f, name) {
  const result = await f.request('/api/guest', { body: name === undefined ? {} : { name } });
  assert.equal(result.status, 200);
  assert.ok(result.cookie);
  assert.equal(result.body.user.role, 'guest');
  assert.equal(result.body.user.password, undefined);
  return { ...result.body.user, cookie: result.cookie };
}

test('guest entry keeps a browser identity and private table permissions without credentials', async t => {
  const f = await fixture(t, false);
  const blank = await guestAccount(f);
  assert.equal(blank.name, 'Guest');
  for (const name of ['<script>', 'A'.repeat(17), 123, null]) {
    assert.equal((await f.request('/api/guest', { body: { name } })).status, 400);
  }
  const first = await guestAccount(f, 'Friends');
  const second = await guestAccount(f, 'Friends');
  assert.notEqual(first.id, second.id);
  const retry = await f.request('/api/guest', { cookie: first.cookie, body: { name: 'New name', role: 'superadmin' } });
  assert.equal(retry.body.user.id, first.id);
  assert.equal(retry.body.user.name, first.name);
  assert.equal(retry.cookie, undefined);
  assert.equal((await f.request('/api/admin', { cookie: first.cookie })).status, 403);
  assert.equal((await f.request('/api/admin/event', { cookie: first.cookie, body: {} })).status, 403);
  assert.equal((await f.request(`/api/admin/user/${first.id}`, { cookie: f.owner.cookie, body: { role: 'moderator' } })).status, 400);
  let room = await f.ok('/api/tables', first.cookie, { name: 'Guest friends', game: 'poker', stake: 500, private: true });
  assert.equal((await f.request(`/api/tables/${room.id}`, { cookie: second.cookie })).status, 403);
  assert.equal((await f.request(`/api/tables/${room.id}/join`, { cookie: second.cookie, body: {} })).status, 403);
  assert.equal((await f.ok('/api/lobby', second.cookie)).tables.length, 0);
  room = await f.ok('/api/rooms/join', second.cookie, { code: room.code });
  assert.equal(room.players.length, 2);
  assert.notEqual(room.players[0].name, room.players[1].name, 'Duplicate nicknames are distinct at a table');
  room = await f.ok(`/api/tables/${room.id}/start`, first.cookie, {});
  assert.equal(room.state.hand.length, 2);
  assert.equal(room.state.hands, undefined);
  await f.restart();
  const me = await f.ok('/api/me', first.cookie);
  assert.equal(me.user.id, first.id);
  assert.deepEqual(me.activeTable, { id: room.id, context: 'casual' });
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM wallets').get()).n, 0);
  await f.ok(`/api/admin/user/${first.id}`, f.owner.cookie, { banned: true });
  assert.equal((await f.ok('/api/me', first.cookie)).user, null);
  assert.equal((await f.request('/api/lobby', { cookie: first.cookie })).status, 401);
});

test('saving a guest account preserves event chips and seats while replacing the session', async t => {
  const f = await fixture(t, false);
  const guest = await guestAccount(f, 'Temporary');
  const e = await f.ok('/api/admin/event', f.owner.cookie, { name: 'Guest night', startingChips: 1000, stakes: [100], games: ['poker'] });
  await f.ok(`/api/admin/event/${e.id}`, f.owner.cookie, { status: 'active' });
  await f.ok(`/api/events/${e.id}/join`, guest.cookie, {});
  const room = await f.ok('/api/tables', guest.cookie, { name: 'Saved seat', context: e.id, game: 'poker', stake: 100 });
  const before = (await f.ok(`/api/lobby?context=${e.id}`, guest.cookie)).wallet;
  assert.deepEqual(before, { available: 900, reserved: 100 });
  const occupied = await f.account('Existing Member');
  const rejected = await f.request('/api/register', { cookie: guest.cookie, body: { name: occupied.name, password } });
  assert.equal(rejected.status, 409);
  assert.equal((await f.ok('/api/me', guest.cookie)).user.role, 'guest');
  const saved = await f.request('/api/register', { cookie: guest.cookie, body: { name: 'Saved Member', password, role: 'superadmin' } });
  assert.equal(saved.status, 200);
  assert.ok(saved.cookie);
  assert.notEqual(saved.cookie, guest.cookie);
  assert.equal(saved.body.user.id, guest.id);
  assert.equal(saved.body.user.role, 'player');
  assert.equal((await f.ok('/api/me', guest.cookie)).user, null);
  assert.deepEqual((await f.ok(`/api/lobby?context=${e.id}`, saved.cookie)).wallet, before);
  const returned = await f.ok(`/api/tables/${room.id}`, saved.cookie);
  assert.equal(returned.host, guest.id);
  assert.equal(returned.players[0].name, 'Saved Member');
  const login = await f.request('/api/login', { body: { name: 'Saved Member', password } });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.id, guest.id);
  await f.ok(`/api/events/${e.id}/join`, login.cookie, {});
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE user_id=? AND context=? AND reason='allocation'").get(guest.id, e.id)).n, 1);
  assert.equal((await f.ok('/api/guest', saved.cookie, {})).user.id, guest.id);
});

test('guest event invitations preview allocation and register only on explicit admission', async t => {
  const f = await fixture(t, false);
  const host = await guestAccount(f, 'Host');
  const friend = await guestAccount(f, 'Friend');
  const late = await guestAccount(f, 'Late');
  const e = await f.ok('/api/admin/event', f.owner.cookie, { name: 'Invitation event', startingChips: 1000, stakes: [100], games: ['poker'], participantLimit: 2 });
  await f.ok(`/api/admin/event/${e.id}`, f.owner.cookie, { status: 'active' });
  await f.ok(`/api/events/${e.id}/join`, host.cookie, {});
  const room = await f.ok('/api/tables', host.cookie, { name: 'Invited table', context: e.id, game: 'poker', stake: 100, private: true, capacity: 2 });
  const preview = await f.ok('/api/rooms/join', friend.cookie, { code: room.code, previewEvent: true });
  assert.deepEqual(preview.registration, { name: e.name, startingChips: 1000, stake: 100 });
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM wallets WHERE user_id=?').get(friend.id)).n, 0);
  await f.ok(`/api/admin/event/${e.id}`, f.owner.cookie, { operation: 'configure', registrationOpen: false });
  assert.equal((await f.request('/api/rooms/join', { cookie: friend.cookie, body: { code: room.code, registerForEvent: true } })).status, 400);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM wallets WHERE user_id=?').get(friend.id)).n, 0);
  await f.ok(`/api/admin/event/${e.id}`, f.owner.cookie, { operation: 'configure', registrationOpen: true });
  const joined = await f.ok('/api/rooms/join', friend.cookie, { code: room.code, registerForEvent: true });
  assert.equal(joined.id, room.id);
  assert.deepEqual((await f.ok(`/api/lobby?context=${e.id}`, friend.cookie)).wallet, { available: 900, reserved: 100 });
  await f.ok('/api/rooms/join', friend.cookie, { code: room.code, registerForEvent: true });
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE user_id=? AND reason='allocation'").get(friend.id)).n, 1);
  assert.equal((await f.request('/api/rooms/join', { cookie: late.cookie, body: { code: room.code, registerForEvent: true } })).status, 400);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM wallets WHERE user_id=?').get(late.id)).n, 0);
  await f.db.prepare('UPDATE event_options SET participant_limit=? WHERE event_id=?').run(3, e.id);
  const full = await f.request('/api/rooms/join', { cookie: late.cookie, body: { code: room.code, registerForEvent: true } });
  assert.equal(full.status, 400);
  assert.match(full.body.error, /not accepting players/);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM wallets WHERE user_id=?').get(late.id)).n, 0, 'Failed seat admission rolls back registration');
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM ledger WHERE user_id=?').get(late.id)).n, 0);
});

test('concurrent guest saves cannot create a second account or abandon the original seat', async t => {
  const f = await fixture(t, false);
  const guest = await guestAccount(f, 'Concurrent');
  const room = await f.ok('/api/tables', guest.cookie, { name: 'Keep my seat', game: 'poker', stake: 100 });
  const results = await Promise.all(['Saved first', 'Saved second'].map(name =>
    f.request('/api/register', { cookie: guest.cookie, body: { name, password } })
  ));
  const successful = results.filter(r => r.status === 200);
  assert.equal(successful.length, 1);
  assert.equal(successful[0].body.user.id, guest.id);
  assert.ok(results.some(r => [401, 409].includes(r.status)));
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM users').get()).n, 2);
  assert.deepEqual((await f.ok('/api/me', successful[0].cookie)).activeTable, { id: room.id, context: 'casual' });
});

test('scheduled events enforce participant limits, start and end with exactly-once refunds',async t=>{
  const f=await fixture(t),a=await f.account('Scheduled Alice'),b=await f.account('Scheduled Bob'),c=await f.account('Scheduled Cara');
  const settings={name:'Scheduled club',startingChips:1000,stakes:[100],games:['poker'],participantLimit:2,startsAt:Date.now()+60000,endsAt:Date.now()+120000};
  assert.equal((await f.request('/api/admin/event',{cookie:f.owner.cookie,body:{...settings,endsAt:settings.startsAt-1}})).status,400);
  const e=await f.ok('/api/admin/event',f.owner.cookie,settings);
  await f.ok(`/api/admin/event/${e.id}`,f.owner.cookie,{status:'registration'});
  await Promise.all([a,b].map(p=>f.ok(`/api/events/${e.id}/join`,p.cookie,{})));
  assert.equal((await f.request(`/api/events/${e.id}/join`,{cookie:c.cookie,body:{}})).status,400);
  await f.ok(`/api/events/${e.id}/join`,a.cookie,{});
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM wallets WHERE context=?').get(e.id)).n,2);
  (await f.db.prepare('UPDATE event_options SET starts_at=? WHERE event_id=?').run(Date.now()-1,e.id));
  const r=await f.ok('/api/tables',a.cookie,{name:'Scheduled poker',game:'poker',stake:100,context:e.id});
  await f.ok(`/api/tables/${r.id}/join`,b.cookie,{});await f.ok(`/api/tables/${r.id}/start`,a.cookie,{});
  assert.equal((await f.ok(`/api/lobby?context=${e.id}`,a.cookie)).events.find(x=>x.id===e.id).status,'active');
  (await f.db.prepare('UPDATE event_options SET ends_at=? WHERE event_id=?').run(Date.now()-1,e.id));
  for(let n=0;n<30;n++){if((await f.ok(`/api/tables/${r.id}`,a.cookie)).status==='canceled')break;await new Promise(resolve=>setTimeout(resolve,20));}
  assert.equal((await f.ok(`/api/tables/${r.id}`,a.cookie)).status,'canceled');
  for(const p of [a,b])assert.deepEqual((await f.ok(`/api/lobby?context=${e.id}`,p.cookie)).wallet,{available:1000,reserved:0});
  await f.restart();
  assert.equal((await f.ok(`/api/lobby?context=${e.id}`,a.cookie)).events.find(x=>x.id===e.id).status,'completed');
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='event-scheduled-status' AND target=?").get(e.id)).n,2);
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
  const stored = JSON.parse((await f.db.prepare('SELECT data FROM rooms WHERE id=?').get(r.id)).data);
  stored.started = Date.now() - 3600001;
  (await f.db.prepare('UPDATE rooms SET data=? WHERE id=?').run(JSON.stringify(stored), r.id));
  for (let n=0;n<30;n++) {
    if ((await f.ok(`/api/tables/${r.id}`, a.cookie)).status === 'canceled') break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal((await f.ok(`/api/tables/${r.id}`, a.cookie)).status, 'canceled');
  await f.ok(`/api/admin/table/${r.id}`, f.owner.cookie, { operation: 'cancel' });
  for (const p of [a,b]) assert.deepEqual((await f.ok('/api/lobby', p.cookie)).wallet, { available: 10000, reserved: 0 });
});

async function fixture(t, legacy = true) {
  const directory = await mkdtemp(join(tmpdir(), 'venatus-test-'));
  const dbPath = join(directory, 'casino.sqlite');
  const setupToken = randomUUID();
  let app;
  let base;
  async function start() {
    app = await createApp({ dbPath, databaseUrl: '', setupToken, secureCookies: false, tickMs: 50, apiLimit: 100000,
      ...(process.env.VENATUS_TEST_POSTGRES === '1' ? {storageFactory:()=>postgresStorage(join(directory,'postgres'))} : {}) });
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
    const payload=contentType.includes('application/json')?await response.json():await response.text();
    // Seed pre-migration rooms to preserve regression coverage of existing wallet-backed casual games.
    if(legacy&&path==='/api/tables'&&response.ok&&(!body.context||body.context==='casual')&&body.practice===undefined){const stored=JSON.parse((await app.db.prepare('SELECT data FROM rooms WHERE id=?').get(payload.id)).data);stored.practice=false;stored.stake=body.stake;await app.db.prepare('UPDATE rooms SET data=? WHERE id=?').run(JSON.stringify(stored),stored.id);const uid=stored.players[0].id;await app.db.prepare('UPDATE wallets SET available=available-?,reserved=reserved+? WHERE user_id=? AND context=?').run(body.stake,body.stake,uid,'casual');await app.db.prepare('INSERT INTO ledger VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),Date.now(),uid,'casual',-body.stake,body.stake,'reserve',stored.id+':1');payload.practice=false;payload.stake=body.stake;}
    return {
      status: response.status,
      body: payload,
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
    if(legacy){await app.db.prepare('INSERT INTO wallets VALUES(?,?,?,?)').run(result.body.user.id,'casual',10000,0);await app.db.prepare('INSERT INTO ledger VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),Date.now(),result.body.user.id,'casual',10000,0,'allocation','casual');}
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
  const action = { actionId: randomUUID(), expectedVersion: own.version, action: { type: 'play', rank:own.state.requiredRank || 'A', cards: [own.state.hand[0].id] } };
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
  assert.deepEqual((await f.ok('/api/me',player.cookie)).activeTable,{id:table.id,context:'casual'});
  assert.equal((await f.request('/api/me')).body.activeTable,null);
});

for (const game of ['bluff','chromatic','poker','ohhell','rummy']) test(`${game} active state and private hands survive restart without timing out during downtime`,async t=>{
  const f=await fixture(t),g=await newGame(f,game,['bluff','ohhell'].includes(game)?3:2);
  const before=await g.view(g.players[0]);
  const row=await f.db.prepare('SELECT data FROM rooms WHERE id=?').get(before.id);
  const saved=JSON.parse(row.data);
  saved.savedAt=Date.now()-2*60*60000; saved.started=saved.savedAt-60000;
  // Keep the running timer away from this fixture until restart.
  saved.state.deadline=Date.now()+60000;
  await f.db.prepare('UPDATE rooms SET data=? WHERE id=?').run(JSON.stringify(saved),saved.id);
  await f.restart();
  const after=await g.view(g.players[0]);
  assert.equal(after.status,'playing'); assert.ok(after.state.deadline>Date.now());
  const expected={...before.state,deadline:after.state.deadline};
  assert.deepEqual(after.state,expected);
  assert.equal(after.state.hands,undefined);
  assert.deepEqual((await f.ok('/api/me',g.players[0].cookie)).activeTable,{id:after.id,context:'casual'});
  await f.ok(`/api/admin/table/${after.id}`,f.owner.cookie,{operation:'cancel'});
  for(const p of g.players) assert.deepEqual((await f.ok('/api/lobby',p.cookie)).wallet,{available:10000,reserved:0});
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
  const settlementCount = (await f.db.prepare("SELECT count(*) AS n FROM ledger WHERE reason='settlement' AND reference=?").get(tableId)).n;
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
    await f.ok(`/api/tables/${table.id}/action`, player.cookie, { actionId: randomUUID(), expectedVersion: own.version, action: { type: 'play', rank:own.state.requiredRank || 'A', cards: own.state.hand.slice(0, 4).map(c => c.id) } });
    const challenged = await f.ok(`/api/tables/${table.id}`, player.cookie);
    assert.equal(challenged.state.phase, 'challenge');
    assert.equal(challenged.status, 'playing', 'Final cards cannot pay out until challenge window closes');
    // Only the test clock is accelerated. Cards, actions and payouts remain untouched.
    const row = (await f.db.prepare('SELECT data FROM rooms WHERE id=?').get(table.id));
    const room = JSON.parse(row.data);
    room.state.deadline = Date.now() - 1;
    (await f.db.prepare('UPDATE rooms SET data=? WHERE id=?').run(JSON.stringify(room), table.id));
    for (let wait = 0; wait < 40; wait++) {
      await new Promise(resolve => setTimeout(resolve, 10));
      const current = JSON.parse((await f.db.prepare('SELECT data FROM rooms WHERE id=?').get(table.id)).data);
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
  const wallet = (await f.db.prepare('SELECT available,reserved FROM wallets WHERE user_id=? AND context=?').get(player.id, 'casual'));
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
  const beforeLedger = (await f.db.prepare('SELECT count(*) AS n FROM ledger').get()).n;
  const beforeAudit = (await f.db.prepare('SELECT count(*) AS n FROM audit').get()).n;
  assert.ok(beforeLedger > 0 && beforeAudit > 0);
  await assert.rejects(async () => (await f.db.prepare('UPDATE ledger SET delta=99999').run()), /append-only/);
  await assert.rejects(async () => (await f.db.prepare('DELETE FROM ledger').run()), /append-only/);
  await assert.rejects(async () => (await f.db.prepare("UPDATE audit SET detail='{}'").run()), /append-only/);
  await assert.rejects(async () => (await f.db.prepare('DELETE FROM audit').run()), /append-only/);
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM ledger').get()).n, beforeLedger);
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM audit').get()).n, beforeAudit);
});

test('clients cannot assign privileges, balances, pot values or game outcomes', async t => {
  const f = await fixture(t,false);
  const registered = await f.request('/api/register', { body: { name: 'Forged Fields', password, role: 'superadmin', balance: 900000, available: 900000 } });
  assert.ok(registered.status >= 200 && registered.status < 300);
  assert.equal(registered.body.user.role, 'player');
  const player = { ...registered.body.user, cookie: registered.cookie };
  const opponent = await f.account('Fair Opponent');
  assert.equal((await f.ok('/api/lobby', player.cookie)).wallet.available, 0);
  const table = await f.ok('/api/tables', player.cookie, { name: 'Honest Pot', game: 'chromatic', context: 'casual', stake: 250,practice:true,
    pot: 999999, players: [{ id: 'forged' }], state: { phase: 'finished', winner: player.id }, winner: player.id, balance: 999999 });
  assert.equal(table.pot, 0);
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
  assert.equal(wallet.available, 0);
  assert.equal(wallet.reserved, 0);
  assert.equal((await f.db.prepare("SELECT count(*) AS n FROM ledger WHERE reason='settlement'").get()).n, 0);
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
  const rows = (await f.db.prepare("SELECT reason,count(*) AS n FROM ledger WHERE user_id=? AND reason IN ('reserve','refund') GROUP BY reason").all(player.id));
  assert.equal(rows.find(row => row.reason === 'reserve').n, 3);
  assert.equal(rows.find(row => row.reason === 'refund').n, 3);
});

test('practice bots in every game never touch wallets and leaving cancels a solo practice room', async t=>{
  const f=await fixture(t),p=await f.account('Practice Player');
  for(const game of ['bluff','chromatic','poker','ohhell','rummy']) {
    const r=await f.ok('/api/tables',p.cookie,{name:'Practice '+game,game,stake:game==='poker'?137:0,practice:true,bots:2});
    assert.equal(r.practice,true);assert.equal(r.players.filter(p=>p.bot).length,2);
    const started=await f.ok(`/api/tables/${r.id}/start`,p.cookie,{});assert.equal(started.status,'playing');
    await f.ok(`/api/tables/${r.id}/leave`,p.cookie,{});
    assert.equal((await f.ok(`/api/tables/${r.id}`,p.cookie)).status,'canceled');
    assert.deepEqual((await f.ok('/api/lobby',p.cookie)).wallet,{available:10000,reserved:0});
  }
  assert.equal((await f.request('/api/tables',{cookie:p.cookie,body:{name:'No farming',game:'poker',stake:100,bots:2,context:'not-an-event'}})).status,400);
});

test('active leave frees the player, protects committed stakes and rejects further play',async t=>{
  const f=await fixture(t),g=await newGame(f,'chromatic'),p=g.players[0],other=g.players[1];
  await f.ok(`/api/tables/${g.room.id}/leave`,p.cookie,{});
  assert.equal((await f.ok('/api/me',p.cookie)).activeTable,null);
  assert.deepEqual((await f.ok('/api/lobby',p.cookie)).wallet,{available:9900,reserved:100});
  const r=await g.view(p);assert.equal(r.state,null);assert.equal(r.players.find(x=>x.id===p.id).left,true);
  assert.equal((await f.request(`/api/tables/${r.id}/action`,{cookie:p.cookie,body:{actionId:randomUUID(),expectedVersion:r.version,action:{type:'draw'}}})).status,403);
  await f.ok('/api/tables',p.cookie,{name:'New seat',game:'bluff',stake:7});
  await f.ok(`/api/tables/${r.id}/leave`,other.cookie,{});
  assert.deepEqual((await f.ok('/api/lobby',other.cookie)).wallet,{available:10000,reserved:0});
  assert.deepEqual((await f.ok('/api/lobby',p.cookie)).wallet,{available:9993,reserved:7});
});

test('modern casual tables persist across rematches, invites, bots and host controls without wallets',async t=>{
  const f=await fixture(t,false),a=await f.account('Modern Host'),b=await f.account('Modern Friend'),c=await f.account('Late Friend');
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM wallets').get()).n,0);
  let r=await f.ok('/api/tables',a.cookie,{name:'Always open',game:'poker',stake:1000,capacity:3,smallBlind:15,bigBlind:30});
  assert.equal(r.practice,true);assert.equal(r.capacity,3);
  await f.ok(`/api/tables/${r.id}/join`,b.cookie,{});
  r=await f.ok(`/api/tables/${r.id}/start`,a.cookie,{});assert.equal(r.state.smallBlind,15);assert.equal(r.state.bigBlind,30);
  const actor=r.state.turn===a.id?a:b;
  r=await f.ok(`/api/tables/${r.id}/action`,actor.cookie,{actionId:randomUUID(),expectedVersion:r.version,action:{type:'fold'}});
  r=await f.ok(`/api/tables/${r.id}/action`,a.cookie,{actionId:randomUUID(),expectedVersion:r.version,action:{type:'cashout'}});
  assert.equal(r.status,'finished');
  await f.ok('/api/rooms/join',c.cookie,{code:r.code});
  assert.equal((await f.request(`/api/tables/${r.id}/manage`,{cookie:b.cookie,body:{operation:'rematch'}})).status,403);
  r=await f.ok(`/api/tables/${r.id}/manage`,a.cookie,{operation:'rematch'});assert.equal(r.status,'waiting');assert.equal(r.players.length,3);
  await f.ok(`/api/tables/${r.id}/leave`,c.cookie,{});
  r=await f.ok(`/api/tables/${r.id}/manage`,a.cookie,{operation:'fill-bots',difficulty:'hard'});assert.equal(r.players.filter(p=>p.bot).length,1);
  const bot=r.players.find(p=>p.bot);assert.equal(bot.difficulty,'hard');
  await f.ok(`/api/tables/${r.id}/manage`,a.cookie,{operation:'remove-bot',botId:bot.id});
  await f.ok(`/api/tables/${r.id}/manage`,a.cookie,{operation:'close'});
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM wallets').get()).n,0);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM ledger').get()).n,0);
});

test('event range, private invitations, independent wallets and final standings remain authoritative',async t=>{
  const f=await fixture(t,false),a=await f.account('Event Alice'),b=await f.account('Event Bob'),c=await f.account('Event Cara');
  const e=await f.ok('/api/admin/event',f.owner.cookie,{name:'Modern Event',description:'Club night',startingChips:1000,stakes:[0,100],minStake:0,maxStake:500,games:['poker','chromatic','bluff','ohhell','rummy']});
  await f.ok(`/api/admin/event/${e.id}`,f.owner.cookie,{status:'active'});
  await Promise.all([a,b].map(p=>f.ok(`/api/events/${e.id}/join`,p.cookie,{})));
  await f.ok(`/api/events/${e.id}/join`,a.cookie,{});
  const e2=await f.ok('/api/admin/event',f.owner.cookie,{name:'Second Event',startingChips:2000,stakes:[100],games:['poker']});await f.ok(`/api/admin/event/${e2.id}`,f.owner.cookie,{status:'active'});await f.ok(`/api/events/${e2.id}/join`,a.cookie,{});
  const edit=await f.ok(`/api/admin/event/${e.id}`,f.owner.cookie,{operation:'configure',registrationOpen:false,endsAt:Date.now()+3600000});assert.equal(edit.registrationOpen,false);assert.equal(edit.description,'Club night');
  assert.equal((await f.request(`/api/events/${e.id}/join`,{cookie:c.cookie,body:{}})).status,400);
  let r=await f.ok('/api/tables',a.cookie,{name:'Private event table',context:e.id,private:true,game:'poker',stake:137,smallBlind:3,bigBlind:6});
  assert.equal((await f.request('/api/rooms/join',{cookie:c.cookie,body:{code:r.code}})).status,400);
  await f.ok('/api/rooms/join',b.cookie,{code:r.code});
  assert.deepEqual((await f.ok(`/api/lobby?context=${e.id}`,a.cookie)).wallet,{available:863,reserved:137});
  assert.deepEqual((await f.ok(`/api/lobby?context=${e2.id}`,a.cookie)).wallet,{available:2000,reserved:0});
  r=await f.ok(`/api/tables/${r.id}/start`,a.cookie,{});const actor=r.state.turn===a.id?a:b;
  r=await f.ok(`/api/tables/${r.id}/action`,actor.cookie,{actionId:randomUUID(),expectedVersion:r.version,action:{type:'fold'}});
  r=await f.ok(`/api/tables/${r.id}/action`,a.cookie,{actionId:randomUUID(),expectedVersion:r.version,action:{type:'cashout'}});
  let standings=(await f.ok(`/api/lobby?context=${e.id}`,a.cookie)).leaderboard;assert.equal(standings.reduce((n,p)=>n+p.balance,0),2000);assert.equal(standings[0].gamesPlayed,1);assert.equal(standings[0].profit,standings[0].balance-1000);
  assert.equal((await f.request('/api/tables',{cookie:a.cookie,body:{name:'Bot farming',context:e.id,game:'poker',stake:100,bots:1}})).status,400);
  await f.ok(`/api/admin/event/${e.id}`,f.owner.cookie,{status:'completed'});standings=(await f.ok(`/api/lobby?context=${e.id}`,f.owner.cookie)).leaderboard;
  await f.ok(`/api/admin/user/${b.id}`,f.owner.cookie,{banned:true});
  assert.deepEqual((await f.ok(`/api/lobby?context=${e.id}`,f.owner.cookie)).leaderboard,standings);
  assert.equal((await f.request(`/api/admin/user/${a.id}`,{cookie:f.owner.cookie,body:{context:e.id,adjustment:10,reason:'Must remain locked'}})).status,400);
  assert.equal((await f.request(`/api/admin/event/${e.id}`,{cookie:f.owner.cookie,body:{operation:'configure',registrationOpen:true}})).status,400);
  await f.restart();assert.deepEqual((await f.ok(`/api/lobby?context=${e.id}`,f.owner.cookie)).leaderboard,standings);
});

test('casual Poker adds and replaces seats between hands without resetting stacks',async t=>{
  const f=await fixture(t,false),a=await f.account('Seat Host'),b=await f.account('Seat Friend'),c=await f.account('Seat Arrival');
  let r=await f.ok('/api/tables',a.cookie,{name:'Flexible poker',game:'poker',stake:1000,capacity:4});await f.ok(`/api/tables/${r.id}/join`,b.cookie,{});r=await f.ok(`/api/tables/${r.id}/start`,a.cookie,{});
  const actor=r.state.turn===a.id?a:b;r=await f.ok(`/api/tables/${r.id}/action`,actor.cookie,{actionId:randomUUID(),expectedVersion:r.version,action:{type:'fold'}});const stacks={...r.state.stacks};
  r=await f.ok(`/api/tables/${r.id}/manage`,a.cookie,{operation:'add-bot'});const bot=r.players.find(p=>p.bot);assert.equal(r.state.stacks[bot.id],1000);assert.equal(r.state.stacks[a.id],stacks[a.id]);
  r=await f.ok('/api/rooms/join',c.cookie,{code:r.code});assert.equal(r.state.stacks[c.id],1000);
  r=await f.ok(`/api/tables/${r.id}/manage`,a.cookie,{operation:'remove-bot',botId:bot.id});assert.equal(r.state.stacks[bot.id],undefined);assert.equal(r.state.stacks[b.id],stacks[b.id]);
  r=await f.ok(`/api/tables/${r.id}/action`,a.cookie,{actionId:randomUUID(),expectedVersion:r.version,action:{type:'cashout'}});assert.equal(r.status,'finished');assert.equal(Object.values(r.state.payouts).reduce((a,b)=>a+b,0),3000);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM wallets').get()).n,0);
});
