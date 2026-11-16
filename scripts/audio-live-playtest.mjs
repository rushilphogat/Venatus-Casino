import {createApp} from '../src/server.js';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const dir=await mkdtemp(join(tmpdir(),'venatus-live-audio-'));
const app=await createApp({dbPath:join(dir,'db.sqlite'),databaseUrl:'',secureCookies:false});
await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto('http://127.0.0.1:'+app.server.address().port);
 await page.locator('#auth-form [type=submit]').click();
 const metrics=await page.evaluate(async()=>{
  const audio=await import('/audio.js');const gaps=[],tasks=[];let previous=performance.now(),running=true;
  const observer=new PerformanceObserver(list=>tasks.push(...list.getEntries().map(e=>e.duration)));observer.observe({type:'longtask',buffered:false});
  function frame(now){gaps.push(now-previous);previous=now;if(running)requestAnimationFrame(frame);}requestAnimationFrame(frame);
  const cancel=audio.scoreMoment('poker',7000);
  await new Promise(r=>setTimeout(r,12000));cancel();running=false;observer.disconnect();
  gaps.sort((a,b)=>a-b);return{...audio.audioDiagnostics(),frames:gaps.length,p95FrameMs:gaps[Math.floor(gaps.length*.95)],maxFrameMs:Math.max(...gaps),longTasks:tasks.length,maxTaskMs:Math.max(0,...tasks)};
 });
 assert.equal(metrics.context,'running');assert.ok(metrics.cached>0&&metrics.cached<=72);assert.ok(metrics.voices<=64);assert.ok(metrics.frames>100);assert.deepEqual(errors,[]);
 console.log('Live audio with cinematic cue:',metrics);
 console.log('PASS: unlocked audio, scheduled soundtrack and reveal cues, bounded voices/cache, no browser errors. Frame timings are diagnostic for this machine only.');
}finally{await browser.close();await app.close();await rm(dir,{recursive:true,force:true});}
