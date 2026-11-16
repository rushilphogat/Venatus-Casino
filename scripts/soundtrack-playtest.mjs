import {createApp} from '../src/server.js';import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright'),dir=await mkdtemp(join(tmpdir(),'venatus-audio-'));const app=await createApp({dbPath:join(dir,'db.sqlite'),databaseUrl:'',secureCookies:false});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage(),out='work/soundtrack-captures';await mkdir(out,{recursive:true});
try{
 await page.goto('http://127.0.0.1:'+app.server.address().port);
 for(const [theme,mode,energy]of [['poker','play',.4],['chromatic','pressure',.9],['bluff','play',.3],['bluff','suspense',.9],['rummy','play',.3],['ohhell','play',.3]]){
  const result=await page.evaluate(async({theme,mode,energy})=>{
   const {renderScore}=await import('/audio.js');const ctx=new OfflineAudioContext(2,22050*26,22050);const rack=renderScore(ctx,theme,mode,energy),buffer=await ctx.startRendering();let max=0,sum=0;const pcm=new Int16Array(buffer.length*2);
   for(let i=0;i<buffer.length;i++)for(let c=0;c<2;c++){const v=buffer.getChannelData(c)[i];if(!Number.isFinite(v))throw Error('Nonfinite sample');max=Math.max(max,Math.abs(v));sum+=v*v;pcm[i*2+c]=Math.round(Math.max(-1,Math.min(1,v))*32767);}
   const bytes=new Uint8Array(pcm.buffer);let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));const metrics={peak:max,rms:Math.sqrt(sum/(buffer.length*2)),cache:rack.cached};rack.dispose();return{...metrics,data:btoa(binary)};
  },{theme,mode,energy});
  assert.ok(result.peak<.95,theme+' clips');assert.ok(result.rms>.002,theme+' is silent');assert.ok(result.cache<=72);
  const pcm=Buffer.from(result.data,'base64'),header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(pcm.length+36,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(2,22);header.writeUInt32LE(22050,24);header.writeUInt32LE(88200,28);header.writeUInt16LE(4,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40);await writeFile(join(out,theme+'-'+mode+'.wav'),Buffer.concat([header,pcm]));console.log(theme,mode,{peak:result.peak.toFixed(3),rms:result.rms.toFixed(3),cache:result.cache});
 }
 console.log('PASS: six offline renders, finite samples, audible output, peak headroom, bounded sample cache');
}finally{await browser.close();await app.close();await rm(dir,{recursive:true,force:true});}
