import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/server.js';

// Run with an installed Playwright + Chrome. PLAYWRIGHT_MODULE may point to a
// file URL for an external copy, without adding a production dependency.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const games = process.argv.slice(2);
const directory = await mkdtemp(join(tmpdir(), 'venatus-browser-'));
const token = randomUUID();
const server = await createApp({ dbPath:join(directory,'test.sqlite'), databaseUrl:'', setupToken:token, secureCookies:false });
await new Promise(resolve => server.server.listen(0,'127.0.0.1',resolve));
const origin = 'http://127.0.0.1:'+server.server.address().port;
let browser;
const errors = new Set();
const captures = process.env.VENATUS_QA_CAPTURES;
const action = (page, name) => page.locator('[data-action="'+name+'"]:enabled').first();
const move = (page, name) => page.locator('[data-move="'+name+'"]:enabled').first();
const get = async (page, path) => {
  const response = await page.request.get(origin+path);
  assert.equal(response.status(),200,path);
  return response.json();
};
const read = async (player, room) => get(player.page,'/api/tables/'+room);
async function seat(game, index, code) {
  const mobile=index===1;
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:900},isMobile:mobile,hasTouch:mobile});
  const page=await context.newPage();
  page.setDefaultTimeout(8500);
  await page.addInitScript(() => {
    window.motionEvents = { css:0, web:0 };
    document.addEventListener('animationstart',()=>window.motionEvents.css++);
    const animate=Element.prototype.animate;
    Element.prototype.animate=function(...args) { window.motionEvents.web++; return animate.apply(this,args); };
  });
  page.on('pageerror', e=>errors.add(e.message));
  page.on('console', m=>{if(m.type()==='error'&&!m.text().includes('favicon'))errors.add(m.text())});
  page.on('response',r=>{if(r.url().startsWith(origin) && r.status()>=400 && !r.url().includes('favicon'))errors.add(r.status()+' '+r.url().slice(origin.length));});
  await page.goto(origin+(code?'/?join='+code:'/'));
  const name='QA '+game+' '+index;
  await page.locator('#auth-form input[name=name]').fill(name);
  assert.equal(await page.locator('#auth-form input[type=password]').count(),0,'guest entry includes password');
  await page.getByRole('button',{name:/play as guest|join table as guest/i}).click();
  if(code) await page.locator('.room-code').first().waitFor();
  else await page.locator('[data-action=create-table]').first().waitFor();
  const me=await get(page,'/api/me');
  assert.ok(me.user?.id);
  return {page,id:me.user.id,context};
}
async function clickMove(player, room, control) {
  const responsePromise=player.page.waitForResponse(r=>r.request().method()==='POST' && r.url().endsWith('/'+room+'/action'));
  if(await player.page.evaluate(()=>navigator.maxTouchPoints>0))await control.tap();
  else await control.click();
  const response=await responsePromise;
  assert.equal(response.status(),200,'legal move rejected: '+await response.text());
  return response.json();
}
async function select(player, id) {
  await player.page.locator('[data-action=select-card][data-id="'+id+'"]:enabled').click();
}
async function measure(player, game, display) {
  const {page}=player;
  await page.locator('.game-room .hand').first().waitFor();
  const metrics=await page.evaluate(()=>({
    width:innerWidth, pageWidth:document.documentElement.scrollWidth,
    handCards:document.querySelectorAll('.hand [data-hand-id],.hand > .playing-card').length,
    table:!!document.querySelector('.felt,.social-mat'), controls:!!document.querySelector('.game-actions'),
    handBottom:document.querySelector('.hand').getBoundingClientRect().bottom,
    actionTop:document.querySelector('.game-actions').getBoundingClientRect().top,
    actionHeight:document.querySelector('.game-actions').getBoundingClientRect().height
  }));
  assert.equal(metrics.width,page.viewportSize().width,game+' '+display+' viewport expanded');
  assert.ok(metrics.pageWidth<=metrics.width+1,game+' '+display+' page overflow '+JSON.stringify(metrics));
  assert.ok(metrics.table&&metrics.controls,game+' missing table or controls');
  if(metrics.actionHeight>0)assert.ok(metrics.actionTop>=metrics.handBottom-1,game+' '+display+' actions overlap the hand '+JSON.stringify(metrics));
  if(captures)await page.screenshot({path:join(captures,game+'-'+display+'.png'),fullPage:true,animations:'disabled'});
}
async function scenario(game) {
  const players=[];
  try {
    const host=await seat(game,0);
    players.push(host);
    const page=host.page;
    await page.locator('[data-action=create-table][data-game="'+game+'"]').click();
    const form=page.locator('#create-table-form');
    await form.locator('[name=private]').check();
    await form.locator('button').last().click();
    const code=(await page.locator('.room-code').first().innerText()).trim();
    players.push(await seat(game,1,code));
    if(['bluff','ohhell'].includes(game)) players.push(await seat(game,2,code));
    const r=(await get(page,'/api/me')).activeTable.id;
    await action(page,'start-table').click();
    await Promise.all(players.map(p=>p.page.locator('.game-room .hand').first().waitFor()));
    await measure(host,game,'desktop'); await measure(players[1],game,'mobile');
    const savedHand=(await read(players[1],r)).state.hand.map(c=>c.id);
    await players[1].page.reload();
    await players[1].page.locator('.game-room .hand').first().waitFor();
    assert.deepEqual((await read(players[1],r)).state.hand.map(c=>c.id),savedHand,'guest seat not restored');
    const getActor=async()=>{const s=(await read(host,r)).state;return players.find(p=>p.id===s.turn);};
    let actor=await getActor();
    if(game==='poker'){
      // Call/check all streets. Only public showdown data can appear on the result screen.
      let final;
      for(let i=0;i<16;i++){
        actor=await getActor();
        const s=(await read(actor,r)).state;
        if(s.phase==='between-hands'||s.phase==='finished'){final=s;break;}
        await clickMove(actor,r,move(actor.page,s.legalActions.includes('check')?'check':'call'));
      }
      assert.equal(final?.board.length,5,'missing river');
      assert.ok(Object.keys(final.showdown).length>=2,'missing showdown');
      await host.page.getByRole('heading',{name:'Showdown',exact:true}).waitFor();
    } else if(game==='rummy'){
      await clickMove(actor,r,actor.page.locator('[data-move=draw][data-source=stock]:enabled').first());
      let s=(await read(actor,r)).state;assert.equal(s.hand.length,14);
      await action(actor.page,'hand-sort').click();
      await select(actor,s.hand[0].id);
      await clickMove(actor,r,move(actor.page,'analyze'));
      assert.ok((await read(actor,r)).state.analysis);
      await select(actor,s.hand[0].id);
      await clickMove(actor,r,move(actor.page,'discard'));
      actor=await getActor();await clickMove(actor,r,move(actor.page,'drop'));
      assert.equal((await read(host,r)).status,'finished');
    } else if(game==='ohhell'){
      for(let i=0;i<players.length;i++){actor=await getActor();await clickMove(actor,r,move(actor.page,'bid'));}
      for(let i=0;i<players.length;i++){
        actor=await getActor();const s=(await read(actor,r)).state;await select(actor,s.legalCardIds[0]);
        await clickMove(actor,r,move(actor.page,'play'));
      }
      const s=(await read(host,r)).state;assert.equal(s.phase,'round-end');assert.ok(s.lastTrickWinner);
    } else if(game==='bluff'){
      const s=(await read(actor,r)).state;
      await select(actor,s.hand[0].id);await select(actor,s.hand[1].id);
      const challenge=await clickMove(actor,r,action(actor.page,'play-cards'));assert.equal(challenge.state.phase,'challenge');
      const other=players.find(p=>p.id!==actor.id);
      const called=await clickMove(other,r,action(other.page,'challenge'));assert.equal(called.state.reveal.cards.length,2);
      actor=await getActor();await clickMove(actor,r,action(actor.page,'bluff-skip'));
    } else if(game==='chromatic'){
      let plays=0;
      for(let i=0;i<7&&plays<2;i++){
        actor=await getActor();const s=(await read(actor,r)).state;
        if(s.phase==='choose-color')await clickMove(actor,r,actor.page.locator('[data-action=starting-colour]:enabled,[data-move=choose-color]:enabled').first());
        else if(s.phase==='challenge')await clickMove(actor,r,move(actor.page,'accept'));
        else if(s.legalCardIds.length){await select(actor,s.legalCardIds[0]);await clickMove(actor,r,actor.page.locator('[data-action=play-wild]:enabled,[data-action=play-cards]:enabled').first());plays++;}
        else if(s.phase==='drawn')await clickMove(actor,r,move(actor.page,'pass'));
        else await clickMove(actor,r,action(actor.page,'draw-card'));
      }
      assert.ok(plays>0,'no cards played');
    }
    const motion = await page.evaluate(()=>window.motionEvents);
    assert.ok(motion.css+motion.web>0,game+' had no visual feedback');
    if((await read(host,r)).status==='playing'){
      const before=(await read(host,r)).state.hand.map(c=>c.id).sort();
      await page.reload();await page.locator('.game-room .hand').first().waitFor();
      assert.deepEqual((await read(host,r)).state.hand.map(c=>c.id).sort(),before,'hand changed on reconnect');
    }
    await action(page,'leave-table').click();
    if(await page.locator('[data-action=confirm-leave]').isVisible())await action(page,'confirm-leave').click();
    await page.locator('[data-action=create-table]').first().waitFor();
    console.log(game+' passed guest invite, live moves, desktop/mobile layout and exit; animations (CSS/WAAPI) '+motion.css+'/'+motion.web);
  } finally {await Promise.all(players.map(p=>p.context.close()));}
}
async function guestEventJourney(ownerCookie) {
  const request=async(path,body)=>{
    const response=await fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,Cookie:ownerCookie},body:JSON.stringify(body)});
    assert.equal(response.status,200,await response.clone().text());return response.json();
  };
  const event=await request('/api/admin/event',{name:'Guest invite test',startingChips:1000,stakes:[100],games:['poker']});
  await request('/api/admin/event/'+event.id,{status:'active'});
  await request('/api/events/'+event.id+'/join',{});
  const room=await request('/api/tables',{name:'Guest event table',game:'poker',context:event.id,stake:100,private:true});
  const guest=await seat('event',0);
  try {
    await guest.page.goto(origin+'/?join='+room.code);
    await action(guest.page,'accept-event-invite').waitFor();
    let lobby=await get(guest.page,'/api/lobby?context='+event.id);
    assert.equal(lobby.participating,false,'invitation allocated chips before consent');
    await action(guest.page,'accept-event-invite').click();
    await guest.page.locator('.room-code').first().waitFor();
    lobby=await get(guest.page,'/api/lobby?context='+event.id);
    assert.deepEqual(lobby.wallet,{available:900,reserved:100});
    await action(guest.page,'save-guest').click();
    const form=guest.page.locator('#save-guest-form');
    await form.locator('[name=name]').fill('Saved browser guest');
    await form.locator('[name=password]').fill(randomUUID());
    await form.locator('button').click();
    await form.waitFor({state:'hidden'});
    const me=await get(guest.page,'/api/me');
    assert.equal(me.user.id,guest.id);assert.equal(me.user.role,'player');
    assert.deepEqual((await get(guest.page,'/api/lobby?context='+event.id)).wallet,{available:900,reserved:100});
    await guest.page.reload();await guest.page.locator('.room-code').first().waitFor();
    assert.equal((await get(guest.page,'/api/me')).activeTable.id,room.id);
    console.log('Guest event invite consent, wallet reservation, saving account and seat recovery passed');
  } finally {await guest.context.close();}
}
async function sixSeatLayout(game) {
  const contexts=[];
  try {
    let table;
    for(let i=0;i<6;i++) {
      const context=await browser.newContext({viewport:{width:1440,height:900}});contexts.push(context);
      const guest=await context.request.post(origin+'/api/guest',{data:{name:'Friend '+i}});assert.equal(guest.status(),200);
      const response=await context.request.post(origin+(i?'/api/tables/'+table.id+'/join':'/api/tables'),{data:i?{}:{name:'Six friends',game,context:'casual',stake:game==='poker'?250:0,capacity:6}});
      assert.equal(response.status(),200,await response.text());if(!i)table=await response.json();
    }
    const start=await contexts[0].request.post(origin+'/api/tables/'+table.id+'/start',{data:{}});assert.equal(start.status(),200);
    const page=await contexts[0].newPage();page.on('pageerror',e=>errors.add(e.message));
    await page.goto(origin);await page.locator('.game-room .hand').first().waitFor();
    await measure({page},game,'six-desktop');
    await page.setViewportSize({width:390,height:844});await measure({page},game,'six-mobile');
    console.log(game+' six-seat desktop/mobile layout passed');
  } finally {await Promise.all(contexts.map(c=>c.close()));}
}

try {
  browser=await chromium.launch({channel:process.env.CHROME_CHANNEL||'chrome',headless:true});
  const setup=await fetch(origin+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({token,name:'Test owner',password:randomUUID()})});
  assert.equal(setup.status,200);
  const ownerCookie=setup.headers.get('set-cookie').split(';')[0];
  if(captures)await mkdir(captures,{recursive:true});
  for(const game of games.length?games:['poker','chromatic','rummy','bluff','ohhell'])await scenario(game);
  if(!games.length) {await guestEventJourney(ownerCookie);for(const game of ['poker','rummy','ohhell'])await sixSeatLayout(game);}
  assert.deepEqual([...errors].filter(e=>!e.includes('404 (Not Found)')),[],'browser or resource errors');
} finally {
  await browser?.close();await server.close();await rm(directory,{recursive:true,force:true});
}
