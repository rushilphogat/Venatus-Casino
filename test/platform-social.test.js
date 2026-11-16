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
test('static assets are served inside public only, and profile JSON limit is isolated',async t=>{
  const f=await fixture(t),u=await f.guest('Files');
  assert.equal((await f.request('/logo.png',u.cookie)).status,200);
  assert.equal((await f.request('/src/server.js',u.cookie)).status,404);
  assert.equal((await f.request('/..%2f..%2fpackage.json',u.cookie)).status,404);
  assert.equal((await f.request('/api/profile',u.cookie,{image:'x'.repeat(3*1024*1024)})).status,413);
  assert.equal((await f.request('/api/tables',u.cookie,{name:'x'.repeat(17000)})).status,413);
});
