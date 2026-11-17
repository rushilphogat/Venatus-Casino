import {createApp} from '../src/server.js';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const dir=await mkdtemp(join(tmpdir(),'venatus-network-')),token=randomUUID(),out='work/stability-network';await mkdir(out,{recursive:true});
const app=await createApp({dbPath:join(dir,'db.sqlite'),databaseUrl:'',setupToken:token,secureCookies:false,tickMs:3600000,apiLimit:100000});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+app.server.address().port,browser=await chromium.launch({channel:'chrome',headless:true}),errors=[],findings=[];
const contexts=await Promise.all([browser.newContext(),browser.newContext(),browser.newContext()]);
for(const c of contexts)await c.addInitScript(()=>{window.auditSockets=[];const Native=WebSocket;window.WebSocket=class extends Native{constructor(...args){super(...args);window.auditSockets.push(this);}};});
const pages=await Promise.all(contexts.map(c=>c.newPage()));for(const p of pages){p.setDefaultTimeout(8000);p.on('pageerror',e=>errors.push(e.message));}
const post=async(c,path,data)=>{const r=await c.request.post(origin+path,{data});assert.equal(r.status(),200,await r.text());return r.json();};
const get=async(c,path)=>(await c.request.get(origin+path)).json();
const check=(label,pass)=>{findings.push({label,pass});console.log(`${pass?'PASS':'FAIL'}: ${label}`);};
async function wake(p,id){const response=p.waitForResponse(r=>r.url()===origin+'/api/tables/'+id);await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await response;await p.waitForTimeout(120);}
try{
 const owner=(await post(contexts[0],'/api/setup',{name:'Network Owner',password:'Test-password-42',token})).user,guest=(await post(contexts[1],'/api/guest',{name:'Network Guest'})).user;
 const third=(await post(contexts[2],'/api/guest',{name:'Network Third'})).user;
 const players=[owner,guest,third],p=pages[0];let room=await post(contexts[0],'/api/tables',{name:'Network audit',game:'bluff',stake:0,capacity:3});for(const c of contexts.slice(1))await post(c,`/api/tables/${room.id}/join`,{});room=await post(contexts[0],`/api/tables/${room.id}/start`,{});
 await Promise.all(pages.map(async p=>{await p.goto(origin);await p.locator('.social-room').waitFor();await p.locator('.connection:not(.disconnected)').waitFor();}));
 await p.locator('[data-lounge=chat]').click();await p.locator('#chat-form input').fill('Unsent old table draft');
 let release;const delayed=new Promise(r=>release=r);let received;const requested=new Promise(r=>received=r);
 await p.route('**/api/rooms/*/chat',async route=>{received();await delayed;await route.fulfill({json:{messages:[{id:9999,userId:'bot',name:'Late bot',bot:true,type:'text',text:'Late reply from old table',at:Date.now()}],cursor:9999}});});
 await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await requested;
 await p.locator('[data-action=events]').click();await p.locator('h1').filter({hasText:'Casino events'}).waitFor();check('table chat hides immediately on navigation',!await p.locator('.table-chat').isVisible());release();await p.waitForTimeout(150);
 check('late chat response cannot appear outside table',!await p.locator('.bot-comment-toast').isVisible()&&await p.locator('.chat-message').filter({hasText:'Late reply from old table'}).count()===0);await p.unroute('**/api/rooms/*/chat');
 await p.reload();await p.locator('.social-room').waitFor();
 // Real connection loss, with an opponent action occurring while the client is offline.
 await contexts[0].setOffline(true);await p.evaluate(()=>window.auditSockets.forEach(s=>s.close()));await p.locator('.connection.disconnected').waitFor();
 let stored=JSON.parse((await app.storage.get('SELECT data FROM rooms WHERE id=?',room.id)).data);
 if(stored.state.turn===owner.id){
  // API transport advances the setup turn while this browser remains disconnected.
  room=await post(contexts[0],`/api/tables/${room.id}/action`,{actionId:randomUUID(),expectedVersion:stored.version,action:{type:'skip'}});
 }
 room=await get(contexts[1],'/api/tables/'+room.id);assert.equal(room.state.turn,guest.id);
 const claim=room.state.hand[0];room=await post(contexts[1],`/api/tables/${room.id}/action`,{actionId:randomUUID(),expectedVersion:room.version,action:{type:'play',rank:claim.rank,cards:[claim.id]}});
 await contexts[0].setOffline(false);await p.locator('.connection:not(.disconnected)').waitFor();await p.locator('[data-action=challenge]:not([disabled])').waitFor();
 const own=await get(contexts[0],'/api/tables/'+room.id);check('reconnect restores current claim and own private hand',await p.locator('[data-action=challenge]').getAttribute('data-claim-id')===own.state.lastPlay.id&&await p.locator('.hand [data-card-id]').count()===own.state.hand.length);
 await p.locator('[data-action=challenge]').click();await p.locator('.cinema[open]').waitFor();check('reconnected player can call bluff',true);await p.locator('[data-cinema-close]').click();
 await post(contexts[0],`/api/admin/table/${room.id}`,{operation:'cancel'});
 let poker=await post(contexts[0],'/api/tables',{name:'Pause audit',game:'poker',stake:100,capacity:2});await post(contexts[1],`/api/tables/${poker.id}/join`,{});poker=await post(contexts[0],`/api/tables/${poker.id}/start`,{});
 await p.reload();await p.locator('.game-poker').waitFor();const actor=players.findIndex(x=>x.id===poker.state.turn);poker=await post(contexts[actor],`/api/tables/${poker.id}/action`,{actionId:randomUUID(),expectedVersion:poker.version,action:{type:'fold'}});await p.locator('.cinema[open]').waitFor();
 await post(contexts[0],`/api/admin/table/${poker.id}`,{operation:'pause'});await wake(p,poker.id);
 check('paused cinema labels pause and disables continue',await p.locator('.cinema-time').innerText()==='Table paused'&&await p.locator('[data-cinema-ready]').isDisabled());await p.locator('[data-cinema-close]').click();
 check('paused result controls cannot submit ready actions',await p.locator('[data-lounge=ready]').isDisabled());await p.screenshot({path:join(out,'paused.png'),fullPage:true});
 await post(contexts[0],`/api/admin/table/${poker.id}`,{operation:'resume'});await wake(p,poker.id);check('resumed presentation enables continue',await p.locator('[data-lounge=ready]').isEnabled());
 await p.route('**/api/tables/'+poker.id,route=>route.fulfill({status:503,json:{error:'Audit temporary interruption'}}));await wake(p,poker.id);
 check('failed refresh preserves the current table and reports the failure',await p.locator('.game-poker').isVisible()&&await p.getByText('Audit temporary interruption',{exact:true}).isVisible());
 await p.unroute('**/api/tables/'+poker.id);await wake(p,poker.id);check('refresh recovers after a temporary API failure',await p.locator('[data-lounge=ready]').isEnabled());
 await p.locator('[data-lounge=results]').click();await p.locator('[data-action=events]').click();await p.locator('h1').filter({hasText:'Casino events'}).waitFor();check('result drawer hides immediately on navigation',!await p.locator('.result-drawer').isVisible());
 assert.deepEqual(errors,[]);
}finally{await writeFile(join(out,'report.json'),JSON.stringify({findings,errors},null,2));await browser.close();await app.close();await rm(dir,{recursive:true,force:true});}
assert.ok(findings.every(x=>x.pass),JSON.stringify(findings.filter(x=>!x.pass)));console.log('PASS: network and navigation audit');
