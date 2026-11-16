import {createApp} from '../src/server.js';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE),dir=await mkdtemp(join(tmpdir(),'venatus-scenes-'));
const app=await createApp({dbPath:join(dir,'db.sqlite'),databaseUrl:'',secureCookies:false});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await mkdir('work/overhaul-captures',{recursive:true});
 await page.goto('http://127.0.0.1:'+app.server.address().port);await page.locator('#auth-form [name=name]').fill('Scenes');await page.locator('#auth-form [type=submit]').click();await page.locator('.game-picker').waitFor();
 const results=await page.evaluate(async()=>{
  const {syncLounge}=await import('/lounge.js');const variants=[];
  const cards=[{id:'shown-ace',rank:'A',suit:'spades'},{id:'shown-king',rank:'K',suit:'hearts'},{id:'shown-queen',rank:'Q',suit:'clubs'},{id:'shown-jack',rank:'J',suit:'diamonds'},{id:'shown-ten',rank:'10',suit:'spades'}];
  for(const family of ['poker','caught','honest','chromatic','rummy'])for(let n=1;n<=3;n++){
   const room={id:'fixture-'+family,game:['caught','honest'].includes(family)?'bluff':family,players:[{id:'a',name:'Fox'},{id:'b',name:'Owl'}],state:{type:family,phase:'finished',round:n,handNumber:n,moves:n,winner:'a',scores:{a:40,b:10},hand:[{id:'SECRET',rank:'2',suit:'hearts'}]}};
   if(family==='poker')room.state.lastResult={id:'result-'+n,handNumber:n,pot:120,board:cards,showdown:{a:{hand:cards.slice(0,2),name:'Straight'}},pots:[{amount:80,winners:['a']},{amount:40,winners:['b']}]};
   if(['caught','honest'].includes(family))room.state.reveal={id:'challenge-'+n,lied:family==='caught',collector:'b',player:'a',challenger:'b',cards:cards.slice(0,2),count:2,collectedCount:6,rank:'A'};
   if(family==='chromatic')room.state.topCard={id:'color-public',color:'red',value:'5'};
   syncLounge({id:room.id},room);const scene=document.querySelector('.scene-overlay');variants.push({id:scene?.dataset.scene,privateCount:scene?.querySelectorAll('[data-card-id=SECRET]').length,pots:scene?.querySelectorAll('.scene-pot').length});
  }return variants;
 });assert.equal(new Set(results.map(v=>v.id)).size,15);assert.ok(results.every(v=>v.privateCount===0));assert.ok(results.slice(0,3).every(v=>v.pots===2));
 await page.waitForTimeout(700);await page.screenshot({path:'work/overhaul-captures/creative-scene.png'});
 await page.locator('.scene-skip').click();assert.equal(await page.locator('.scene-overlay').count(),0);assert.deepEqual(errors,[]);console.log('PASS: 15 public-only scene variants, independent side-pot rows, private-card exclusion, skip cleanup');
}finally{await browser.close();await app.close();await rm(dir,{recursive:true,force:true});}

