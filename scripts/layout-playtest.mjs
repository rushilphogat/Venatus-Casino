import {createApp} from '../src/server.js';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright'),dir=await mkdtemp(join(tmpdir(),'venatus-layout-'));
const app=await createApp({dbPath:join(dir,'db.sqlite'),databaseUrl:'',secureCookies:false});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+app.server.address().port,browser=await chromium.launch({channel:'chrome',headless:true}),out='work/layout-audit';await mkdir(out,{recursive:true});
try{
 for(const game of ['poker','bluff','chromatic','rummy','ohhell']){
  const context=await browser.newContext(),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const request=async(path,data)=>{const r=await context.request.post(origin+path,{data});assert.equal(r.status(),200,await r.text());return r.json();};
  await request('/api/guest',{name:'LongestNickname1'});
  const room=await request('/api/tables',{name:'Friends at a very long named table',game,stake:game==='poker'?250:0,bots:5,capacity:6});await request(`/api/tables/${room.id}/start`,{});
  await page.goto(origin);await page.locator('.game-room .hand').waitFor();
  await page.addLocatorHandler(page.locator('.cinema[open]'),async()=>page.locator('[data-cinema-close]').click());
  for(const [width,height]of [[360,740],[390,844],[768,1024],[1440,900],[3840,2160]]){
   await page.setViewportSize({width,height});
   const metrics=await page.evaluate(()=>{
    const bad=[];for(const card of document.querySelectorAll('.hand .playing-card,.poker-board .playing-card,.rummy-deck .playing-card')){
     const b=card.getBoundingClientRect();if(!b.width||getComputedStyle(card).visibility==='hidden')continue;
     for(const corner of card.querySelectorAll('.corner')){const c=corner.getBoundingClientRect();if(c.top<b.top-2||c.bottom>b.bottom+2||c.left<b.left-2||c.right>b.right+2)bad.push(card.getAttribute('aria-label'));}
    }
    return{overflow:document.documentElement.scrollWidth>innerWidth+1,corners:bad};
   });assert.equal(metrics.overflow,false,`${game} ${width} page overflow`);assert.deepEqual(metrics.corners,[],`${game} ${width} card symbols overflow`);
   if([390,1440].includes(width))await page.screenshot({path:join(out,`${game}-${width}.png`),fullPage:true,animations:'disabled'});
  }
  if(game==='poker'){
   await page.setViewportSize({width:390,height:844});await page.locator('[data-lounge=chat]').click();assert.equal(await page.locator('.bot-comment-toast').count(),0,'Popup must not cover open chat');await page.locator('#chat-form input').fill('A long message: '+ 'cards'.repeat(35));await page.locator('#chat-form [type=submit]').click();await page.locator('.chat-message p').last().waitFor();
   const contrast=await page.evaluate(()=>{
    const luminance=c=>{const rgb=c.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
    const ratio=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
    const input=getComputedStyle(document.querySelector('#chat-form input')),panel=getComputedStyle(document.querySelector('.table-chat')),message=getComputedStyle(document.querySelector('.chat-message p'));
    return{input:ratio(input.color,input.backgroundColor),message:ratio(message.color,panel.backgroundColor),overflow:document.querySelector('.table-chat').scrollWidth>document.querySelector('.table-chat').clientWidth+1};
   });assert.ok(contrast.input>=4.5&&contrast.message>=4.5,JSON.stringify(contrast));assert.equal(contrast.overflow,false);console.log('Chat contrast',contrast);await page.screenshot({path:join(out,'chat-phone.png')});
  }
  assert.deepEqual(errors,[]);console.log(game+': six seats, five viewport sizes, card bounds and no page overflow');await context.close();
 }
}finally{await browser.close();await app.close();await rm(dir,{recursive:true,force:true});}
