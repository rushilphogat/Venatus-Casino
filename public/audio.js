import {scores,musicState} from './score.js';
// Original arrangements and synthesized instrument samples. No network audio or per-play AI calls.
const defaults={master:.55,music:.38,effects:.65,muted:false,quiet:false};
let prefs={...defaults};try{prefs={...prefs,...JSON.parse(localStorage.getItem('venatus-mix')||'{}')};}catch{}
let engine,ctx,started=false,installed=false,next=0,step=0,state={theme:'poker',mode:'lounge',energy:.15},pending=state;
const hz=m=>440*2**((m-69)/12),clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
export const getMix=()=>({...prefs});
export const audioDiagnostics=()=>({theme:state.theme,mode:state.mode,context:ctx?.state||'locked',voices:engine?.voices||0,cached:engine?.cached||0});
export function setMix(values){for(const [key,value]of Object.entries(values))if(key in defaults)prefs[key]=typeof defaults[key]==='boolean'?Boolean(value):clamp(Number(value)||0,0,1);try{localStorage.setItem('venatus-mix',JSON.stringify(prefs));}catch{}applyMix();}
function random(seed){return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}

// Tine/FM keys, damped strings, modal metal and shaped acoustic transients.
export function createScoreEngine(context){
 const master=context.createGain(),limiter=context.createDynamicsCompressor();limiter.threshold.value=-9;limiter.knee.value=12;limiter.ratio.value=4;limiter.attack.value=.006;limiter.release.value=.18;master.connect(limiter);limiter.connect(context.destination);
 const music=context.createGain(),effects=context.createGain(),musicVolume=context.createGain(),effectsVolume=context.createGain(),duck=context.createGain(),tone=context.createBiquadFilter();tone.type='lowpass';tone.frequency.value=6800;
 music.connect(tone);tone.connect(musicVolume);musicVolume.connect(duck);duck.connect(master);effects.connect(effectsVolume);effectsVolume.connect(master);
 const verb=context.createConvolver(),wet=context.createGain();wet.gain.value=.15;const impulse=context.createBuffer(2,Math.floor(context.sampleRate*1.8),context.sampleRate),rnd=random(1907);
 for(let ch=0;ch<2;ch++){const data=impulse.getChannelData(ch);let low=0;for(let i=0;i<data.length;i++){low=low*.65+(rnd()*2-1)*.35;data[i]=low*Math.exp(-i/(context.sampleRate*.38));}}
 verb.buffer=impulse;music.connect(verb);verb.connect(wet);wet.connect(musicVolume);
 // Instrument samples use a fixed rate; the audio graph resamples natively.
 // This matches the rendered previews and halves first-note synthesis work on 44/48 kHz devices.
 const sampleRate=22050,cache=new Map(),sources=new Set();let voices=0;
 function sample(kind,midi=60){
  const key=kind+':'+midi;if(cache.has(key))return cache.get(key);
  const drum=['kick','snare','hat','brush','wood','card','chip','swell','impact'].includes(kind),duration=kind==='swell'?1.8:drum?(kind==='impact'?1.3:.5):kind==='pad'?3.5:2.6;
  const buffer=context.createBuffer(1,Math.ceil(duration*sampleRate),sampleRate),data=buffer.getChannelData(0),freq=hz(midi),rng=random(1234+midi*31+kind.length*101);let low=0,last=0,phase=0;
  const ring=kind==='bass'||kind==='pluck'?new Float32Array(Math.max(2,Math.floor(sampleRate/freq))):null;if(ring)for(let i=0;i<ring.length;i++)ring[i]=(rng()*2-1)*.5;
  for(let i=0;i<data.length;i++){
   const t=i/sampleRate,w=2*Math.PI*freq*t,n=rng()*2-1;low=low*.78+n*.22;const high=n-last;last=n;let v=0;
   if(kind==='keys')v=(Math.sin(w+1.5*Math.exp(-t*3.8)*Math.sin(2*w))*.65+Math.sin(w*1.003)*.16+Math.sin(w*7)*Math.exp(-t*12)*.06)*Math.exp(-t*1.7)*(1-Math.exp(-t*260));
   else if(kind==='vibes')v=(Math.sin(w)+.24*Math.sin(w*3.99)*Math.exp(-t*4)+.1*Math.sin(w*10.01)*Math.exp(-t*9))*Math.exp(-t*1.6)*(1-Math.exp(-t*240))*(.84+.16*Math.sin(2*Math.PI*5.2*t));
   else if(ring){const pos=i%ring.length,current=ring[pos];ring[pos]=(.5*(current+ring[(pos+1)%ring.length]))*(kind==='bass'?.9975:.993);v=current*(kind==='bass'?1.1:1.6)+(kind==='bass'?Math.sin(w)*.5*Math.exp(-t*2.4):0);}
   else if(kind==='pad')v=(Math.sin(w)+.32*Math.sin(w*1.004)+.25*Math.sin(w*.997)+.12*Math.sin(2*w))*.45*Math.min(1,t/.25)*Math.exp(-t*.7);
   else if(kind==='kick'||kind==='impact'){phase+=2*Math.PI*(kind==='impact'?36+80*Math.exp(-t*25):43+95*Math.exp(-t*32))/sampleRate;v=Math.sin(phase)*Math.exp(-t*(kind==='impact'?5:14))+low*.15*Math.exp(-t*80);}
   else if(kind==='snare')v=(high*.23+low*.55)*Math.exp(-t*23)+Math.sin(2*Math.PI*184*t)*.23*Math.exp(-t*35);
   else if(kind==='hat')v=(high*.18+Math.sin(2*Math.PI*8300*t)*.09)*Math.exp(-t*85);
   else if(kind==='brush')v=low*.55*Math.exp(-t*15)*(1-Math.exp(-t*150));
   else if(kind==='wood')v=(Math.sin(2*Math.PI*440*t)+.4*Math.sin(2*Math.PI*718*t))*Math.exp(-t*75)*.65;
   else if(kind==='card')v=(high*.2+low*.5)*Math.exp(-(((t-.026)/.021)**2))+Math.sin(2*Math.PI*130*t)*.16*Math.exp(-t*65);
   else if(kind==='chip')v=(Math.sin(2*Math.PI*2400*t)+.5*Math.sin(2*Math.PI*3371*t)+.24*Math.sin(2*Math.PI*5170*t))*Math.exp(-t*35)*.3;
   else if(kind==='swell')v=low*.6*Math.sin(Math.PI*Math.min(1,t/1.8))**2;
   data[i]=v*Math.min(1,(duration-t)/.03);
  }
  cache.set(key,buffer);if(cache.size>72)cache.delete(cache.keys().next().value);return buffer;
 }
 function note(kind,midi,at,length=.5,volume=.12,pan=0,fx=false){
  if(voices>=64&&!context.startRendering)return null;const source=context.createBufferSource(),gain=context.createGain(),stereo=context.createStereoPanner();source.buffer=sample(kind,midi);stereo.pan.value=clamp(pan,-1,1);
  const start=Math.max(context.currentTime,at),end=start+Math.min(length,source.buffer.duration);gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(volume,start+.008);gain.gain.setValueAtTime(volume,Math.max(start+.009,end-.06));gain.gain.linearRampToValueAtTime(0,end);
  source.connect(gain);gain.connect(stereo);stereo.connect(fx?effects:music);source.start(start);source.stop(end+.01);voices++;sources.add(source);source.onended=()=>{voices--;sources.delete(source);source.disconnect();gain.disconnect();stereo.disconnect();};return source;
 }
 function mix(p,hidden=false){const at=context.currentTime;master.gain.setTargetAtTime(p.muted||hidden?0:p.master,at,.12);musicVolume.gain.setTargetAtTime(p.music*3.3*(p.quiet?.4:1),at,.25);effectsVolume.gain.setTargetAtTime(p.effects*1.25*(p.quiet?.65:1),at,.12);}
 function setMood(energy,mode){tone.frequency.setTargetAtTime(mode==='suspense'?2400:4400+energy*2500,context.currentTime,.8);}
 function soften(value,seconds=.18){duck.gain.cancelScheduledValues(context.currentTime);duck.gain.setTargetAtTime(value,context.currentTime,seconds);}
 function dispose(){for(const source of sources)try{source.stop();}catch{}cache.clear();}
 return{note,mix,setMood,soften,dispose,get voices(){return voices;},get cached(){return cache.size;}};
}
function applyMix(){engine?.mix(prefs,document.hidden);}
function boot(){if(ctx)return;const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return;ctx=new Audio();engine=createScoreEngine(ctx);applyMix();next=ctx.currentTime+.08;}
function scheduleStep(rack,s,at,index){
 const score=scores[s.theme]||scores.poker,bar=Math.floor(index/16),pos=index%16,chord=score.chords[bar%score.chords.length],beat=60/score.bpm,e=s.energy;
 const lounge=s.mode==='lounge',suspense=s.mode==='suspense',release=s.mode==='release',phrase=Math.floor(bar/8)%4;
 if(pos===0&&!suspense){const inversion=bar%4===3?chord.slice(2).concat(chord[1]+12):chord.slice(1);inversion.forEach((m,i)=>rack.note('keys',m,at+i*.014,beat*2.8,.065+i*.003,(i-1.5)*.16));}
 if(!suspense&&[6,14].includes(pos)&&!lounge&&phrase!==3)chord.slice(2,5).forEach((m,i)=>rack.note('keys',m,at+i*.01,beat*.65,.037,(i-1)*.2));
 if(pos===0||pos===8)rack.note('bass',chord[0]-(s.theme==='chromatic'?0:12),at,beat*1.6,suspense?.15:.22,-.05);
 if(!lounge&&!release&&!suspense&&[6,12,15].includes(pos)){const bass=pos===15?(score.chords[(bar+1)%8][0]-13):pos===12?chord[1]-12:chord[0]-12;rack.note('bass',bass,at,beat*.55,.13,-.05);}
 if(pos===0&&bar%2===0)chord.slice(2,5).forEach((m,i)=>rack.note('pad',m,at,beat*4,.028*(suspense?1.5:1),(i-1)*.5));
 if(!lounge){
  if([0,8].includes(pos)||(s.theme==='chromatic'&&pos===11&&e>.5))rack.note('kick',40,at,.35,suspense?.14:.22);
  if([4,12].includes(pos)&&!suspense)rack.note(s.theme==='chromatic'?'snare':'brush',60,at,.25,release?.1:.2,.1);
  if(pos%2===0&&!suspense)rack.note('hat',60,at,.08,.08+(pos%4===2?.04:0),.3);
  if(e>.65&&pos%2===1)rack.note('hat',60,at,.06,.045,-.2);
 }
 const bank=phrase===2?score.responseMelody:score.melody,melody=bank[bar%bank.length],m=melody[pos];
 if(m!==null&&!suspense&&phrase!==3&&(!lounge||bar%2===0))rack.note(score.lead,m+(phrase===2&&pos<8?-12:0),at,beat*(pos%4===0?1.3:.65),lounge?.08:.13,.18);
 if(e>.6&&!release&&[3,7,11,15].includes(pos))rack.note('pluck',chord[2+(Math.floor(pos/4)%3)]+12,at,beat*.6,.07,-.25);
 if(bar%8===7&&[13,14,15].includes(pos)&&e>.5&&!release)rack.note('brush',60,at,.12,.08+(pos-13)*.03,(pos-14)*.3);
}
function schedule(){if(!ctx||ctx.state!=='running')return;if(next<ctx.currentTime-.25)next=ctx.currentTime+.05;while(next<ctx.currentTime+.14){if(step%16===0){state=pending;engine.setMood(state.energy,state.mode);}const score=scores[state.theme]||scores.poker;if(!prefs.muted&&!document.hidden&&prefs.music>0)scheduleStep(engine,state,next,step);const sixteenth=60/score.bpm/4;step++;next+=sixteenth*(step%2?1+score.swing:1-score.swing);}}
export function updateScore(room){pending=musicState(room);if(engine&&(pending.mode==='suspense'||pending.mode==='release')){state=pending;engine.setMood(state.energy,state.mode);}}
export function playSound(kind='tap'){
 try{if(!started||prefs.muted)return;boot();if(ctx?.state!=='running')return;const at=ctx.currentTime+.006;
  const sounds={tap:'wood',deal:'card',draw:'card',place:'card',chips:'chip',collect:'chip'};
  if(sounds[kind]){engine.note(sounds[kind],60,at,.25,kind==='tap'?.18:.32,0,true);if(kind==='chips'||kind==='collect')engine.note('chip',60,at+.065,.25,.16,.25,true);return;}
  const chord=(scores[state.theme]||scores.poker).chords[Math.floor(step/16)%8],notes=kind==='error'?[chord[0]+12,chord[0]+11]:kind==='turn'?[chord[2]+12]:kind==='exposed'?[chord[1],chord[2]+1,chord[4]]:kind==='reverse'?[chord[4],chord[2],chord[1]]:[chord[1],chord[2],chord[4]];
  notes.forEach((m,i)=>engine.note(kind==='turn'?'wood':'vibes',m,at+i*.12,.7,kind==='turn'?.12:.2,(i-1)*.15,true));
 }catch{/* Audio must never block a move. */}
}
export function scoreMoment(family,duration=0){
 if(!started||prefs.muted||!ctx||ctx.state!=='running')return()=>{};
 const timers=[],played=[],score=scores[state.theme]||scores.poker,chord=score.chords[Math.floor(step/16)%8];
 const play=(kind,m,offset,length,gain,pan=0)=>{const source=engine.note(kind,m,ctx.currentTime+offset,length,gain,pan,true);if(source)played.push(source);};
 const resolve=()=>{engine.soften(.55);chord.slice(1).forEach((m,i)=>{play('keys',m,.035*i,2,.17,(i-1.5)*.2);play('vibes',m+12,.11*i,1.6,.09,(i-1.5)*.25);});play('impact',38,0,1,.18);engine.soften(1,1.8);};
 if(family==='resolve'||!duration){resolve();return()=>{};}
 engine.soften(.22,.25);play('pad',chord[0],0,2.7,.13,-.3);play('pad',chord[1],0,2.7,.1,.3);play('swell',60,0,1.8,.16);
 timers.push(setTimeout(()=>{play('card',60,0,.3,.4);play('chip',60,.12,.3,.18);},1400));
 timers.push(setTimeout(()=>{play('impact',38,0,1.2,.23);chord.slice(1).forEach((m,i)=>play('vibes',m+12,i*.095,1.7,.14,(i-1.5)*.25));},3200));
 timers.push(setTimeout(resolve,Math.min(duration-500,5000)));
 return()=>{for(const timer of timers)clearTimeout(timer);for(const source of played)try{source.stop();}catch{}engine.soften(1,.5);};
}
export function installAudio(){if(installed)return;installed=true;const unlock=()=>{started=true;try{boot();ctx?.resume().catch(()=>{});}catch{}};document.addEventListener('pointerdown',unlock,{once:true});document.addEventListener('keydown',unlock,{once:true});document.addEventListener('visibilitychange',()=>{applyMix();if(ctx)next=ctx.currentTime+.05;});setInterval(schedule,30);}
// Offline rendering uses the live arrangement and instrument rack.
export function renderScore(context,theme='poker',mode='play',energy=.4){const rack=createScoreEngine(context);rack.mix({...defaults,master:.7,music:.65});rack.setMood(energy,mode);let at=.05,index=0;const score=scores[theme];while(at<context.length/context.sampleRate-2){scheduleStep(rack,{theme,mode,energy},at,index);index++;at+=60/score.bpm/4*(index%2?1+score.swing:1-score.swing);}return rack;}
