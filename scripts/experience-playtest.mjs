import {createApp} from '../src/server.js';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE),dir=await mkdtemp(join(tmpdir(),'venatus-controls-'));
const app=await createApp({dbPath:join(dir,'db.sqlite'),databaseUrl:'',secureCookies:false,tickMs:1000});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1920,height:1080}}),base='http://127.0.0.1:'+app.server.address().port,errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(base);await page.locator('#auth-form [name=name]').fill('Controls');await page.locator('#auth-form [type=submit]').click();await page.locator('[data-action=create-table]').click();
 const group=name=>page.locator(`.segment-control:has(select[name=${name}])`);
 await group('capacity').getByRole('button',{name:'2',exact:true}).click();assert.equal(await page.locator('[name=capacity]').inputValue(),'2');assert.equal(await group('bots').getByRole('button',{name:'5',exact:true}).isDisabled(),true);
 await group('capacity').getByRole('button',{name:'6',exact:true}).click();await group('bots').getByRole('button',{name:'5',exact:true}).click();
 assert.equal(await page.locator('[name=bots]').inputValue(),'5');assert.equal(await group('bots').getByRole('button',{name:'5',exact:true}).getAttribute('aria-pressed'),'true');assert.equal(await group('bots').getByRole('button',{name:'None',exact:true}).getAttribute('aria-pressed'),'false');
 await page.locator('#create-table-form .primary').click();await page.locator('[data-action=start-table]').click();await page.locator('#bet-slider').waitFor({timeout:25000});
 const slider=page.locator('#bet-slider');await slider.focus();await page.keyboard.press('ArrowRight');assert.equal(await slider.inputValue(),await page.locator('#bet-amount').inputValue());
 const b=await slider.boundingBox();await page.mouse.move(b.x+b.width*.7,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width*.8,b.y+b.height/2,{steps:5});await page.mouse.up();
 assert.ok(Number(await slider.inputValue())>100);assert.equal(await slider.inputValue(),await page.locator('#bet-amount').inputValue());
 const before=Number(await slider.inputValue());await page.locator('.number-control:has(#bet-amount) [data-step="1"]').click();assert.equal(Number(await slider.inputValue()),before+1);
 await page.locator('[data-profile]').click();await page.locator('#avatar-file').setInputFiles('public/assets/avatars.webp');await page.locator('.crop-tools').waitFor();await page.locator('#avatar-zoom').focus();await page.keyboard.press('ArrowRight');await page.locator('#profile-form [type=submit]').click();await page.locator('#modal').waitFor({state:'hidden'});assert.ok(await page.locator('.profile-button img').count());await page.reload();await page.locator('.profile-button img').waitFor();
 await page.locator('[data-lounge=chat]').click();const hostile='<img src=x onerror=alert(1)>';await page.locator('#chat-form input').fill(hostile);await page.locator('#chat-form [type=submit]').click();await page.getByText(hostile,{exact:true}).waitFor();assert.equal(await page.locator('.chat-message p img').count(),0);await page.locator('[data-delete-message]').last().click();await page.getByText(hostile,{exact:true}).waitFor({state:'hidden'});await page.locator('[data-chat-close]').click();
 await page.locator('[data-lounge=settings]').first().click();await page.locator('[data-setting=effects][data-value=off]').click();await page.locator('[data-mix=music]').focus();await page.keyboard.press('Home');assert.equal(await page.locator('[data-mix=music]').inputValue(),'0');await page.keyboard.press('Escape');await page.reload();assert.equal(await page.locator('html').getAttribute('data-effects'),'off');
 for(const [width,height]of [[3840,2160],[3440,1440],[3072,1728],[2560,1440],[1920,1080],[1366,768],[768,1024],[390,844],[360,800]]){await page.setViewportSize({width,height});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`overflow at ${width}`);}
 await page.emulateMedia({reducedMotion:'reduce'});await page.locator('[data-lounge=settings]').first().click();await page.locator('[data-setting=effects][data-value=full]').click();await page.waitForTimeout(240);assert.equal(await page.locator('.control-hit').count(),0);
 assert.deepEqual(errors,[]);console.log('PASS: segments, disabled choices, slider keyboard/drag, paired steppers, custom avatar/reload, escaped chat/moderation, preferences, reduced motion and nine viewports');
}finally{await browser.close();await app.close();await rm(dir,{recursive:true,force:true});}

