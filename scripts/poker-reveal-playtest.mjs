import {createApp} from '../src/server.js';import {createPoker,actPoker,viewPoker} from '../src/poker.js';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import assert from 'node:assert/strict';
const suits={s:'spades',h:'hearts',c:'clubs',d:'diamonds'},cards=text=>text.split(' ').map(t=>({id:t,rank:t.slice(0,-1),suit:suits[t.at(-1)]}));
function fixture(n,a,b,board){let g=createPoker(['a','b'],Date.now());g.hands={a:cards(a),b:cards(b)};g.board=cards(board);g.street='river';g.currentBet=0;g.bets={a:0,b:0};g.pending=['a','b'];g.turn='a';g.stacks={a:210,b:210};g.contributions={a:40,b:40};g=actPoker(g,'a',{type:'check'});g=actPoker(g,'b',{type:'check'});return{id:'fixture-'+n,started:100,viewerId:'a',game:'poker',status:'playing',players:[{id:'a',name:'Fox',avatar:{kind:'preset',id:0}},{id:'b',name:'Owl',avatar:{kind:'preset',id:4}}],state:viewPoker(g,'a')};}
const fixtures=[fixture(1,'Ac Kh','9d Qc','Ah Ad 9c 9s 2h'),fixture(2,'Ah Kh','Ac Ad','2h 5h 9h 9c 3s'),fixture(3,'10c 3c','Qh Jh','As Kd Qc Jd 10h')];
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright'),dir=await mkdtemp(join(tmpdir(),'venatus-evidence-')),out='work/poker-evidence-captures';await mkdir(out,{recursive:true});
const app=await createApp({dbPath:join(dir,'db.sqlite'),databaseUrl:'',secureCookies:false});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto('http://127.0.0.1:'+app.server.address().port);await page.locator('#auth-form [type=submit]').click();await page.locator('.game-picker').waitFor();
 // Let the initial WebSocket/lobby refresh finish before injecting standalone evidence fixtures.
 await page.locator('.connection:not(.disconnected)').waitFor();await page.waitForLoadState('networkidle');
 for(const [i,room] of fixtures.entries()){
  // Use a fresh display deadline; the evidence itself comes from the real engine.
  room.state.presentation.maximumUntil=Date.now()+20000;
  await page.evaluate(async room=>{const {syncLounge}=await import('/lounge.js');syncLounge({id:room.id},room);},room);
  await page.locator('[data-cinema-skip]').click();
  for(const [id,result]of Object.entries(room.state.lastResult.showdown)){
   const panel=page.locator(`[data-showdown-player="${id}"]`);
   assert.deepEqual(await panel.locator('[data-made-id]').evaluateAll(nodes=>nodes.map(n=>n.dataset.madeId)),result.cardIds);
   assert.deepEqual(await panel.locator('.cinema-hole [data-card-id]').evaluateAll(nodes=>nodes.map(n=>n.dataset.cardId)),result.hand.map(c=>c.id));
   await panel.locator('[data-best-board]').click();
   const expected=room.state.board.filter(c=>result.cardIds.includes(c.id)).map(c=>c.id);
   assert.deepEqual(await page.locator('.cinema-board .board-used [data-card-id]').evaluateAll(nodes=>nodes.map(n=>n.dataset.cardId)),expected);
  }
  for(const [width,height]of [[390,844],[1920,1080],[3840,2160]]){
   await page.setViewportSize({width,height});assert.ok(await page.locator('.cinema').evaluate(el=>el.scrollWidth<=innerWidth+1));
   const clipped=await page.locator('.poker-made .playing-card').evaluateAll(nodes=>nodes.some(n=>{const r=n.getBoundingClientRect();return [...n.querySelectorAll('.corner')].some(c=>{const b=c.getBoundingClientRect();return b.bottom>r.bottom+1||b.right>r.right+1;});}));assert.equal(clipped,false);
   if(i===0)await page.screenshot({path:join(out,'full-house-'+width+'.png')});
  }
  if(i===2)assert.equal(await page.getByText('Plays the board',{exact:true}).count(),2);
  await page.locator('[data-cinema-close]').click();
 }
 const replay=await page.evaluate(async room=>{
  const {openCinema,syncCinema}=await import('/cinema.js');let votes=0;room.state.presentation.maximumUntil=1;
  openCinema({id:'old',family:'poker',title:'Old hand',sub:'Replay',room},{replay:true,settings:{effects:'off'},card:c=>`<div class="playing-card" data-card-id="${c.id}">${c.rank}</div>`,ready:async()=>votes++});
  syncCinema({...room,state:{...room.state,presentation:{id:'LIVE',required:['a'],ready:[],maximumUntil:2}}});
  const open=!!document.querySelector('.cinema[open]');document.querySelector('[data-cinema-ready]').click();return{open,votes,closed:!document.querySelector('.cinema')};
 },fixtures[0]);assert.deepEqual(replay,{open:true,votes:0,closed:true});assert.deepEqual(errors,[]);
 console.log('PASS: actual engine hole cards and best-five evidence, per-player board highlights, plays-board ties, phone/HD/4K card bounds, replay cannot vote on live hand');
}finally{await browser.close();await app.close();await rm(dir,{recursive:true,force:true});}
