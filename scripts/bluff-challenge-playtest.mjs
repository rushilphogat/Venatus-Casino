import {createApp} from '../src/server.js';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const dir=await mkdtemp(join(tmpdir(),'venatus-bluff-call-'));
const app=await createApp({dbPath:join(dir,'db.sqlite'),databaseUrl:'',secureCookies:false});
await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+app.server.address().port;
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  const people=[];
  for(const name of ['Declarer','Caller','Leaving']){
    const context=await browser.newContext();
    const response=await context.request.post(origin+'/api/guest',{data:{name}});
    assert.equal(response.status(),200);people.push({context,...(await response.json()).user});
  }
  const [a,b,c]=people;
  const post=async(p,path,data)=>{const r=await p.context.request.post(origin+path,{data});assert.equal(r.status(),200,await r.text());return r.json();};
  let room=await post(a,'/api/tables',{name:'Live challenge check',game:'bluff',stake:0,capacity:3});
  const path='/api/tables/'+room.id;
  for(const p of [b,c])await post(p,path+'/join',{});
  room=await post(a,path+'/start',{});
  const page=await b.context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.locator('.game-bluff').waitFor();
  room=await post(a,path+'/action',{expectedVersion:room.version,actionId:randomUUID(),action:{type:'play',rank:room.state.hand[0].rank,cards:[room.state.hand[0].id]}});
  const claimId=room.state.lastPlay.id;
  const call=page.locator('[data-action=challenge]');await call.waitFor();
  assert.equal(await call.getAttribute('data-claim-id'),claimId);
  // Reproduce the race after the click captures its version, before the POST reaches the server.
  await page.route('**'+path+'/action',async route=>{
    const payload=route.request().postDataJSON();
    assert.equal(payload.action.claimId,claimId);assert.equal(payload.expectedVersion,room.version);
    await post(c,path+'/leave',{});
    await route.continue();
  },{times:1});
  const responsePromise=page.waitForResponse(r=>r.url().endsWith(path+'/action')&&r.request().method()==='POST');
  await call.click();const response=await responsePromise;
  assert.equal(response.status(),200,await response.text());room=await response.json();
  assert.equal(room.state.reveal.challenger,b.id);assert.equal(room.state.reveal.lied,false);
  await page.locator('.cinema[open]').waitFor();
  const readyResponse=page.waitForResponse(r=>r.url().endsWith(path+'/action')&&r.request().method()==='POST');
  await page.locator('.cinema [data-cinema-ready]').click();assert.equal((await readyResponse).status(),200);
  await post(a,path+'/action',{expectedVersion:room.version,actionId:randomUUID(),action:{type:'ready',presentationId:room.state.presentation.id}});
  await page.locator('.bluff-center .claim-details h3').filter({hasText:'Any rank'}).waitFor();
  assert.equal(await page.locator('.social-verdict').count(),0);
  assert.equal(await page.locator('#toast').textContent(),'');assert.deepEqual(errors,[]);
  console.log('Bluff UI: call survives a concurrent table change; exact claim sent; verdict and Continue restore the open-rank table.');
} finally {await browser.close();await app.close();await rm(dir,{recursive:true,force:true});}
