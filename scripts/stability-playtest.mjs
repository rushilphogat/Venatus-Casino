import {createApp} from '../src/server.js';
import {createGame,actGame,tickGame,viewGame} from '../src/games.js';
import {botAction} from '../src/bots.js';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright'),dir=await mkdtemp(join(tmpdir(),'venatus-stability-')),out='work/stability-matrix';await mkdir(out,{recursive:true});
const token=randomUUID(),app=await createApp({dbPath:join(dir,'db.sqlite'),databaseUrl:'',secureCookies:false,setupToken:token,tickMs:3600000,apiLimit:100000});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+app.server.address().port,browser=await chromium.launch({channel:'chrome',headless:true}),issues=[],coverage=[],errors=[];
const owner=await browser.newContext(),page=await owner.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(8000);
const post=async(ctx,path,data)=>{const r=await ctx.request.post(origin+path,{data});assert.equal(r.status(),200,await r.text());return r.json();};
async function audit(label,views=[[390,844],[768,1024],[1440,900]]){
 for(const [width,height]of views){await page.setViewportSize({width,height});await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(100);
 const result=await page.evaluate(()=>{
  const issues=[],visible=el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden';
  if(document.documentElement.scrollWidth>innerWidth+1)issues.push({kind:'page-overflow',documentWidth:document.documentElement.scrollWidth,elements:[...document.querySelectorAll('main *')].filter(el=>visible(el)&&el.getBoundingClientRect().right>innerWidth+1).slice(0,6).map(el=>el.tagName+'.'+el.className)});
  for(const el of document.querySelectorAll('dialog[open],.table-chat:not([hidden]),.result-drawer:not([hidden])')){const r=el.getBoundingClientRect();if(r.left< -1||r.right>innerWidth+1||r.top< -1||r.bottom>innerHeight+1)issues.push({kind:'panel-outside',element:el.className,rect:{left:r.left,right:r.right,top:r.top,bottom:r.bottom}});}
  const target=document.querySelector('.felt .poker-board,.felt .rummy-stage,.felt .trick-stage');if(target){const a=target.getBoundingClientRect();for(const seat of document.querySelectorAll('.felt .seat')){const b=seat.getBoundingClientRect();if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>3&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>3)issues.push({kind:'seat-center-overlap',seat:seat.textContent.trim()});}}
  for(const card of document.querySelectorAll('.trick-play .playing-card')){const r=card.getBoundingClientRect();if(r.height<r.width*1.3||r.height>r.width*1.6)issues.push({kind:'distorted-trick-card',width:r.width,height:r.height});}
  return issues;
 });issues.push(...result.map(x=>({label,width,...x})));coverage.push(label+'@'+width);await page.screenshot({path:join(out,label+'-'+width+'.png'),fullPage:true,animations:'disabled'});
 }
}
async function nav(action,extra=''){await page.locator(`[data-action=${action}]${extra}`).first().click();await page.waitForTimeout(100);}
function fixtures(type,ids){let now=Date.now(),g=createGame(type,ids,now,{buyIn:250,houseRules:'street',humanPlayers:ids}),list=[],seen=new Set();const take=label=>{if(!seen.has(label)){seen.add(label);list.push([label,structuredClone(g)]);}};
 take(g.phase);
 if(type==='bluff'){
  g=actGame(g,ids[0],{type:'play',rank:g.hands[ids[0]][0].rank,cards:g.hands[ids[0]].slice(0,4).map(c=>c.id)},++now);take('challenge');g=actGame(g,ids[1],{type:'challenge'},++now);take('reveal');g=tickGame(g,g.deadline);take('after-reveal');
  let last=createGame(type,ids,now,{houseRules:'street'});last.hands[ids[0]]=last.hands[ids[0]].slice(0,1);last=actGame(last,ids[0],{type:'play',rank:last.hands[ids[0]][0].rank,cards:[last.hands[ids[0]][0].id]},++now);g=tickGame(last,last.deadline);take('finished');
 }else if(type==='rummy'){
  g=actGame(g,g.turn,{type:'draw'},++now);take('discard');g=actGame(g,g.turn,{type:'analyze',cards:[g.hands[g.turn][0].id]},++now);take('analysis');g=actGame(g,g.turn,{type:'discard',cards:[g.hands[g.turn][0].id]},++now);
  for(let i=0;i<ids.length-1;i++)g=actGame(g,g.turn,{type:'drop'},++now);take('finished');
 }else{
  for(let n=0;n<1800&&g.phase!=='finished';n++){
   if(g.presentation||g.phase==='round-end'){now=g.deadline;g=tickGame(g,now);}
   else {const v=viewGame(g,g.turn);let a=type==='poker'?{type:v.legalActions.includes('check')?'check':'call'}:botAction(v,()=>.5,'medium');if(!a){now=g.deadline;g=tickGame(g,now);}else g=actGame(g,g.turn,a,++now);}
   take(type==='poker'?g.phase==='play'?g.street:g.phase:g.pendingPenalty?'stack':g.phase);
   if(type==='poker'&&g.phase==='between-hands'){g=actGame(g,ids[0],{type:'cashout'},now+1);take('finished');break;}
  }
 }
 if(type==='poker'){
  g=createGame(type,ids,now,{buyIn:250,humanPlayers:ids});for(let i=0;i<ids.length;i++)g=actGame(g,g.turn,{type:'allin'},++now);take('all-in-preflop');
  while(g.phase==='runout'){g=tickGame(g,g.deadline);take('all-in-'+g.street+(g.phase==='runout'?'':'-result'));}
  g=createGame(type,ids,now,{buyIn:250,humanPlayers:ids});while(g.phase==='play')g=actGame(g,g.turn,{type:'fold'},++now);take('uncontested');
 }
 if(type==='chromatic'&&!seen.has('choose-color')){
  for(let n=0;n<1000;n++){g=createGame(type,ids,now,{houseRules:'street'});if(g.phase==='choose-color')break;}assert.equal(g.phase,'choose-color');take('choose-color');
 }
 for(const [,state] of list){if(state.deadline)state.deadline=Date.now()+600000;if(state.presentation){state.presentation.startedAt=Date.now();state.presentation.minimumUntil=Date.now();state.presentation.maximumUntil=Date.now()+20000;}}
 // Keep the final fixture as a completed match for result drawer checks.
 list.sort((a,b)=>Number(a[0]==='finished')-Number(b[0]==='finished'));
 return list;
}
try{
 await page.goto(origin);await page.locator('#auth-form').waitFor();await audit('entry');
 for(const mode of ['login','register','setup']){const button=page.locator(`[data-action=auth-mode][data-mode=${mode}]`);if(await button.count()){await button.click();await audit('auth-'+mode);}}
 const me=(await post(owner,'/api/setup',{name:'Audit Owner',password:'Audit-test-password-42',token})).user;
 const people=[{ctx:owner,id:me.id}];for(let i=1;i<6;i++){const ctx=await browser.newContext(),u=(await post(ctx,'/api/guest',{name:'Player '+i})).user;people.push({ctx,id:u.id});}
 for(const [i,p]of people.entries())await post(p.ctx,'/api/profile',{displayName:'LongPlayerNameNoSpaces'+i});
 let event=await post(owner,'/api/admin/event',{name:'EventWithAVeryLongUnbrokenTitle'.repeat(2),startingChips:10000,stakes:[100,250],games:['bluff','chromatic','poker','rummy','ohhell']});await post(owner,'/api/admin/event/'+event.id,{status:'active'});
 await page.goto(origin);await page.locator('.game-picker').waitFor();await audit('lobby');await nav('events');await audit('events');await nav('navigate','[data-page=history]');await audit('activity');await nav('navigate','[data-page=admin]');await page.locator('#event-form').waitFor();await audit('admin');
 await page.locator('[data-action=configure-event]').first().click();await audit('event-settings');await page.keyboard.press('Escape');await nav('casual');await page.locator('.game-picker').waitFor();
 await page.locator('[data-profile]').click();await page.locator('#profile-form').waitFor();await audit('profile');await page.keyboard.press('Escape');await page.locator('[data-action=create-table]').click();await audit('create-table');await page.keyboard.press('Escape');
 for(const type of ['poker','bluff','chromatic','rummy','ohhell']){
  let r=await post(owner,'/api/tables',{name:'TableWithLongUnbrokenName'.repeat(2).slice(0,48),game:type,stake:type==='poker'?250:0,capacity:6});for(const p of people.slice(1))await post(p.ctx,`/api/tables/${r.id}/join`,{});
  await page.goto(origin);await page.locator('[data-action=start-table]').waitFor();await audit(type+'-waiting');
  r=await post(owner,`/api/tables/${r.id}/start`,{});await page.locator('.game-room').waitFor();
  const list=fixtures(type,people.map(p=>p.id));
  for(const [label,g] of list){
   const stored=JSON.parse((await app.storage.get('SELECT data FROM rooms WHERE id=?',r.id)).data);stored.state=g;stored.status=g.phase==='finished'?'finished':'playing';stored.settled=g.phase==='finished';stored.finished=g.phase==='finished'?Date.now():null;stored.version++;stored.started++;
   await app.storage.run('UPDATE rooms SET data=? WHERE id=?',JSON.stringify(stored),r.id);
   const response=page.waitForResponse(res=>res.url()===origin+`/api/tables/${r.id}`);await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await response;await page.waitForTimeout(100);
   if(await page.locator('.cinema[open]').count()){await audit(type+'-'+label+'-cinema');await page.locator('[data-cinema-close]').click();}
   await audit(type+'-'+label);
   if(['river','challenge','stack','discard','trick-end'].includes(label)){
    await page.evaluate(()=>document.documentElement.style.setProperty('--card-adjust','1.35'));
    await audit(type+'-'+label+'-large-cards',[[3840,2160],[1440,900],[768,1024],[844,390],[390,844]]);
    await page.evaluate(()=>document.documentElement.style.setProperty('--card-adjust','1'));
   }
  }
  await page.locator('[data-lounge=chat]').first().click();await audit(type+'-chat');await page.locator('[data-chat-close]').click();await page.locator('[data-lounge=results]').click();await audit(type+'-results');if(type==='bluff')assert.match(await page.locator('.result-replay').innerText(),/stood without a challenge/);await page.locator('[data-close-results]').click();
  await page.locator('[data-lounge=settings]').first().click();await audit(type+'-settings');await page.keyboard.press('Escape');await page.locator('[data-action=rules]').first().click();await audit(type+'-rules');await page.keyboard.press('Escape');
  const stored=JSON.parse((await app.storage.get('SELECT data FROM rooms WHERE id=?',r.id)).data);stored.status='canceled';stored.settled=true;await app.storage.run('UPDATE rooms SET data=? WHERE id=?',JSON.stringify(stored),r.id);
  console.log(type+' states: '+list.map(([label])=>label).join(', '));
 }
}finally{await writeFile(join(out,'report.json'),JSON.stringify({coverage,issues,errors},null,2));await browser.close();await app.close();await rm(dir,{recursive:true,force:true});}
console.log(JSON.stringify({screens:coverage.length,issues,errors},null,2));if(issues.length||errors.length)process.exitCode=1;


