import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {createApp} from '../src/server.js';
import {postgresStorage} from './postgres-fixture.js';

async function fixture(t){
  const directory=await mkdtemp(join(tmpdir(),'venatus-social-'));let app,base;
  const start=async()=>{app=await createApp({dbPath:join(directory,'db.sqlite'),databaseUrl:'',secureCookies:false,tickMs:50,...(process.env.VENATUS_TEST_POSTGRES==='1'?{storageFactory:()=>postgresStorage(join(directory,'postgres'))}:{})});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');base=`http://127.0.0.1:${app.server.address().port}`;};
  await start();t.after(async()=>{await app.close();await rm(directory,{recursive:true,force:true});});
  async function request(path,cookie,body){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,body:r.headers.get('content-type')?.includes('application/json')?await r.json():Buffer.from(await r.arrayBuffer()),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
  async function ok(path,cookie,body){const r=await request(path,cookie,body);assert.equal(r.status,200,JSON.stringify(r.body));return r.body;}
  async function guest(name){const r=await request('/api/guest',null,{name});assert.equal(r.status,200);return{...r.body.user,cookie:r.cookie};}
  return{request,ok,guest,get app(){return app;},async restart(){await app.close();await start();}};
}

test('profile avatar and display name survive restart and guest conversion without changing login identity',async t=>{
  const f=await fixture(t),u=await f.guest('Alia');
  assert.equal(u.avatar.kind,'preset');assert.ok(u.avatar.id>=0&&u.avatar.id<24);
  const r=await f.ok('/api/tables',u.cookie,{name:'Friends',game:'bluff',stake:0,bots:2});
  assert.notEqual(r.players[1].avatar.id,r.players[2].avatar.id);
  const edited=await f.ok('/api/profile',u.cookie,{displayName:'Night Owl',preset:17});
  assert.equal(edited.user.name,'Night Owl');assert.equal(edited.user.loginName,'Alia');
  assert.equal((await f.ok(`/api/tables/${r.id}`,u.cookie)).players[0].name,'Night Owl');
  await f.restart();assert.deepEqual((await f.ok('/api/profile',u.cookie)).profile,edited.profile);
  const converted=await f.request('/api/register',u.cookie,{name:'Alia Member',password:'a-secure-example-password'});
  assert.equal(converted.status,200);assert.equal(converted.body.user.id,u.id);assert.equal(converted.body.user.name,'Night Owl');assert.equal(converted.body.user.loginName,'Alia Member');
  assert.equal((await f.ok('/api/profile',converted.cookie)).profile.avatar.id,17);
});

test('uploaded avatar is decoded, normalized and persisted with bounded format and size',async t=>{
  const f=await fixture(t),u=await f.guest('Artist');
  const input=await sharp({create:{width:400,height:200,channels:3,background:'#7f58b8'}}).png().toBuffer();
  const uploaded=await f.ok('/api/profile',u.cookie,{image:'data:image/png;base64,'+input.toString('base64')});
  assert.equal(uploaded.profile.avatar.kind,'upload');
  const image=await f.ok(uploaded.profile.avatar.url,u.cookie);const metadata=await sharp(image).metadata();
  assert.equal(metadata.width,256);assert.equal(metadata.height,256);assert.equal(metadata.format,'webp');assert.ok(image.length<=100*1024);
  await f.restart();assert.deepEqual(await f.ok(uploaded.profile.avatar.url,u.cookie),image);
  assert.equal((await f.request('/api/profile',u.cookie,{image:'data:image/png;base64,'+Buffer.from('<svg/>').toString('base64')})).status,400);
  assert.equal((await f.request('/api/profile',u.cookie,{image:'https://tracker.example/photo.png'})).status,400);
  assert.equal((await f.request('/api/profile',u.cookie,{preset:24})).status,400);
  assert.equal((await f.request('/api/profile',u.cookie,{displayName:'<script>'})).status,400);
  await f.ok('/api/profile',u.cookie,{preset:2});
  assert.equal((await f.request(uploaded.profile.avatar.url,u.cookie)).status,404);
});

test('table chat is private, bounded, moderated and independent from game versions',async t=>{
  const f=await fixture(t),a=await f.guest('Host'),b=await f.guest('Friend'),c=await f.guest('Outside');
  const r=await f.ok('/api/tables',a.cookie,{name:'Private table',game:'poker',stake:100,private:true});
  await f.ok('/api/rooms/join',b.cookie,{code:r.code});
  const before=await f.ok(`/api/tables/${r.id}`,a.cookie),path=`/api/rooms/${r.id}/chat`;
  assert.equal((await f.request(path,c.cookie)).status,403);
  assert.equal((await f.request(path,c.cookie,{text:'hello'})).status,403);
  const sent=await f.ok(path,a.cookie,{text:'<img src=x onerror=alert(1)>'});
  assert.equal(sent.messages[0].text,'<img src=x onerror=alert(1)>','Text remains data; the client must escape it');
  const emote=await f.ok(path,b.cookie,{emote:5});assert.equal(emote.messages[1].emote,5);
  const after=await f.ok(`/api/tables/${r.id}`,a.cookie);assert.equal(after.version,before.version);
  assert.equal((await f.request(path,b.cookie,{deleteId:1})).status,403);
  const moderated=await f.ok(path,a.cookie,{deleteId:1});assert.equal(moderated.messages.length,1);
  assert.equal((await f.request(path,a.cookie,{text:'x'.repeat(241)})).status,400);
  assert.equal((await f.request(path,a.cookie,{emote:12})).status,400);
  assert.equal((await f.request(path,a.cookie,{text:'Hi',emote:1})).status,400);
  await f.restart();assert.equal((await f.ok(path,b.cookie)).messages.length,1);
  await f.ok(`/api/tables/${r.id}/leave`,b.cookie,{});assert.equal((await f.request(path,b.cookie)).status,403);
});

test('active two-hour table is not refunded and Ready votes advance once and survive restart',async t=>{
  const f=await fixture(t),a=await f.guest('First'),b=await f.guest('Second');
  let r=await f.ok('/api/tables',a.cookie,{name:'Long session',game:'poker',stake:100,pace:'relaxed',manualResults:false});
  await f.ok(`/api/tables/${r.id}/join`,b.cookie,{});r=await f.ok(`/api/tables/${r.id}/start`,a.cookie,{});
  const stored=JSON.parse((await f.app.storage.get('SELECT data FROM rooms WHERE id=?',r.id)).data);stored.started=Date.now()-2*60*60000;
  await f.app.storage.run('UPDATE rooms SET data=? WHERE id=?',JSON.stringify(stored),r.id);
  await new Promise(resolve=>setTimeout(resolve,100));r=await f.ok(`/api/tables/${r.id}`,a.cookie);assert.equal(r.status,'playing');
  const actor=r.state.turn===a.id?a:b;
  r=await f.ok(`/api/tables/${r.id}/action`,actor.cookie,{expectedVersion:r.version,actionId:randomUUID(),action:{type:'fold'}});
  assert.equal(r.state.phase,'between-hands');assert.equal(r.state.presentation.manual,false);assert.equal(r.pace,'relaxed');
  const payload={expectedVersion:r.version,action:{type:'ready',presentationId:r.state.presentation.id}};
  await f.ok(`/api/tables/${r.id}/action`,a.cookie,{...payload,actionId:randomUUID()});
  const both=await f.ok(`/api/tables/${r.id}/action`,b.cookie,{...payload,actionId:randomUUID()});
  assert.equal(both.state.handNumber,2);assert.equal(both.state.presentation,null);
  await f.restart();const recovered=await f.ok(`/api/tables/${r.id}`,a.cookie);assert.equal(recovered.state.handNumber,2);assert.equal(recovered.state.presentation,null);
});

test('bot event comments are persisted once in the shared chat without changing state on reads',async t=>{
 const f=await fixture(t),u=await f.guest('Listener');let r=await f.ok('/api/tables',u.cookie,{name:'Table talk',game:'bluff',stake:0,bots:2});
 r=await f.ok(`/api/tables/${r.id}/start`,u.cookie,{});const before=r.version;
 let chat=await f.ok(`/api/tables/${r.id}/chat`,u.cookie);assert.equal(chat.messages.length,1);const message=chat.messages[0];assert.equal(message.bot,true);assert.equal(message.trigger,'round_start');assert.ok(r.players.some(p=>p.bot&&p.id===message.userId));assert.ok(r.botChatSeq>0);
 chat=await f.ok(`/api/tables/${r.id}/chat`,u.cookie);assert.equal(chat.messages.length,1);assert.equal((await f.ok(`/api/tables/${r.id}`,u.cookie)).version,before);
 await f.restart();chat=await f.ok(`/api/tables/${r.id}/chat`,u.cookie);assert.equal(chat.messages[0].id,message.id);assert.equal(chat.messages[0].text,message.text);
});

test('Bluff calls survive unrelated versions, resolve once and never challenge a newer claim',async t=>{
  const f=await fixture(t),a=await f.guest('Declarer'),b=await f.guest('Caller'),c=await f.guest('Leaving'),d=await f.guest('Other caller');
  let r=await f.ok('/api/tables',a.cookie,{name:'Challenge race',game:'bluff',stake:0,capacity:4});
  const path=`/api/tables/${r.id}`;
  for(const p of [b,c,d])await f.ok(path+'/join',p.cookie,{});
  r=await f.ok(path+'/start',a.cookie,{});
  const post=(p,version,action,actionId=randomUUID())=>f.request(path+'/action',p.cookie,{expectedVersion:version,actionId,action});
  r=(await post(a,r.version,{type:'play',rank:r.state.hand[0].rank,cards:[r.state.hand[0].id]})).body;
  const oldVersion=r.version,claimId=r.state.lastPlay.id;
  await f.ok(path+'/leave',c.cookie,{});
  const current=await f.ok(path,b.cookie);assert.ok(current.version>oldVersion);
  assert.equal((await post(b,oldVersion,{type:'challenge'})).status,409,'Unidentified stale actions still rejected');
  assert.equal((await post(b,current.version,{type:'challenge',claimId:'wrong'})).status,409);
  assert.equal((await post(a,oldVersion,{type:'challenge',claimId})).status,400,'Cannot challenge yourself');
  assert.equal((await post(c,oldVersion,{type:'challenge',claimId})).status,403,'Departed players cannot act');
  const ids=[randomUUID(),randomUUID()],callers=[b,d];
  const responses=await Promise.all(callers.map((p,i)=>post(p,oldVersion,{type:'challenge',claimId},ids[i])));
  assert.deepEqual(responses.map(x=>x.status).sort(),[200,409]);
  assert.match(responses.find(x=>x.status===409).body.error,/claim.*closed/);
  const winnerIndex=responses.findIndex(x=>x.status===200),won=responses[winnerIndex].body;
  assert.equal(won.state.phase,'reveal');assert.equal(won.state.reveal.collector,callers[winnerIndex].id);
  assert.equal(Object.values(won.state.counts).reduce((n,x)=>n+x,0),52);
  const duplicate=await post(callers[winnerIndex],oldVersion,{type:'challenge',claimId},ids[winnerIndex]);
  assert.equal(duplicate.status,200);assert.equal(duplicate.body.version,won.version);
  const ready={type:'ready',presentationId:won.state.presentation.id};
  await post(b,won.version,ready);r=(await post(d,won.version,ready)).body;
  assert.equal(r.state.phase,'play');assert.equal(r.state.reveal,null);assert.ok(r.state.lastReveal);
  r=await f.ok(path,b.cookie);
  const newer=(await post(b,r.version,{type:'play',rank:r.state.hand[0].rank,cards:[r.state.hand[0].id]})).body;
  assert.notEqual(newer.state.lastPlay.id,claimId);
  const delayed=await post(d,newer.version,{type:'challenge',claimId});
  assert.equal(delayed.status,409);assert.match(delayed.body.error,/claim.*closed/);
  assert.equal((await f.ok(path,d.cookie)).version,newer.version);
});

test('Bluff bot abstention does not change public version or invalidate a pending call',async t=>{
  const f=await fixture(t),a=await f.guest('Dealer'),b=await f.guest('Human caller');
  let r=await f.ok('/api/tables',a.cookie,{name:'Bot abstention',game:'bluff',stake:0,bots:2,capacity:4});
  const path=`/api/tables/${r.id}`;await f.ok(path+'/join',b.cookie,{});r=await f.ok(path+'/start',a.cookie,{});
  r=await f.ok(path+'/action',a.cookie,{expectedVersion:r.version,actionId:randomUUID(),action:{type:'play',rank:r.state.hand[0].rank,cards:[r.state.hand[0].id]}});
  t.mock.method(Math,'random',()=>.999);
  const stored=JSON.parse((await f.app.storage.get('SELECT data FROM rooms WHERE id=?',r.id)).data);
  stored.savedAt=Date.now()-4000;
  await f.app.storage.run('UPDATE rooms SET data=? WHERE id=?',JSON.stringify(stored),r.id);
  let checked;for(let i=0;i<80;i++){
    checked=JSON.parse((await f.app.storage.get('SELECT data FROM rooms WHERE id=?',r.id)).data);
    if(checked.botChallengeChecked===r.state.moves)break;
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  assert.equal(checked.botChallengeChecked,r.state.moves);assert.equal(checked.version,r.version);assert.equal(checked.savedAt,stored.savedAt);
  const result=await f.ok(path+'/action',b.cookie,{expectedVersion:r.version,actionId:randomUUID(),action:{type:'challenge',claimId:r.state.lastPlay.id}});
  assert.equal(result.state.phase,'reveal');assert.equal(result.state.reveal.challenger,b.id);
});
test('static assets are served inside public only, and profile JSON limit is isolated',async t=>{
  const f=await fixture(t),u=await f.guest('Files');
  assert.equal((await f.request('/logo.png',u.cookie)).status,200);
  assert.equal((await f.request('/src/server.js',u.cookie)).status,404);
  assert.equal((await f.request('/..%2f..%2fpackage.json',u.cookie)).status,404);
  assert.equal((await f.request('/api/profile',u.cookie,{image:'x'.repeat(3*1024*1024)})).status,413);
  assert.equal((await f.request('/api/tables',u.cookie,{name:'x'.repeat(17000)})).status,413);
});
