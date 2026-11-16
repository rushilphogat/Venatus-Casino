// Original Venatus arrangements, synthesized locally. No recordings or external services.
const defaults={master:.55,music:.28,effects:.65,muted:false,quiet:false};
let prefs={...defaults};try{prefs={...prefs,...JSON.parse(localStorage.getItem('venatus-mix')||'{}')};}catch{}
let ctx,master,musicBus,effectBus,filter,delay,noise,step=0,next=0,started=false,tension=0,theme=0,activeVoices=0;
const themes=[
  {bpm:88,chords:[[45,52,55,59],[41,48,52,57],[48,55,59,62],[43,50,53,57]],melody:[76,null,71,72,null,67,71,null,74,72,null,71,67,null,64,67]},
  {bpm:102,chords:[[50,57,60,64],[46,53,57,62],[48,55,58,62],[45,52,55,61]],melody:[77,76,null,72,74,null,69,72,76,null,74,72,69,67,null,69]},
  {bpm:80,chords:[[48,55,58,62],[44,51,55,60],[46,53,56,60],[43,50,53,59]],melody:[74,null,70,67,null,72,70,null,67,65,null,62,65,null,67,null]},
  {bpm:94,chords:[[52,59,62,66],[48,55,59,64],[50,57,60,64],[47,54,57,63]],melody:[78,null,74,71,73,null,69,71,76,74,null,71,69,null,66,69]}
];
const frequency=m=>440*2**((m-69)/12);
export const getMix=()=>({...prefs});
export function setMix(values){for(const [key,value]of Object.entries(values))if(key in defaults)prefs[key]=typeof defaults[key]==='boolean'?Boolean(value):Math.max(0,Math.min(1,Number(value)||0));try{localStorage.setItem('venatus-mix',JSON.stringify(prefs));}catch{}applyMix();}
function applyMix(){if(!ctx)return;const now=ctx.currentTime;master.gain.setTargetAtTime(prefs.muted||document.hidden?0:prefs.master,now,.12);musicBus.gain.setTargetAtTime(prefs.music*(prefs.quiet?.38:1),now,.3);effectBus.gain.setTargetAtTime(prefs.effects*(prefs.quiet?.65:1),now,.12);}
function boot(){
  if(ctx)return;const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return;
  ctx=new Audio();master=ctx.createGain();const compressor=ctx.createDynamicsCompressor();compressor.threshold.value=-18;compressor.ratio.value=3;master.connect(compressor);compressor.connect(ctx.destination);
  musicBus=ctx.createGain();effectBus=ctx.createGain();filter=ctx.createBiquadFilter();filter.type='lowpass';filter.frequency.value=4200;musicBus.connect(filter);filter.connect(master);effectBus.connect(master);
  delay=ctx.createDelay(.8);delay.delayTime.value=.34;const feedback=ctx.createGain();feedback.gain.value=.18;delay.connect(feedback);feedback.connect(delay);delay.connect(musicBus);
  noise=ctx.createBuffer(1,ctx.sampleRate,ctx.sampleRate);const data=noise.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;
  applyMix();next=ctx.currentTime+.1;
}
function voice(midi,at,duration,gain,type='sine',bus=musicBus,echo=false){
  if(!ctx||activeVoices>60)return;activeVoices++;
  const osc=ctx.createOscillator(),env=ctx.createGain();osc.type=type;osc.frequency.value=frequency(midi);
  env.gain.setValueAtTime(.0001,at);env.gain.exponentialRampToValueAtTime(Math.max(.0002,gain),at+.018);env.gain.exponentialRampToValueAtTime(.0001,at+duration);
  osc.connect(env);env.connect(bus);if(echo)env.connect(delay);osc.start(at);osc.stop(at+duration+.02);osc.onended=()=>{activeVoices--;osc.disconnect();env.disconnect();};
}
function percussion(at,kind,gain,bus=musicBus){
  if(kind==='kick'){const o=ctx.createOscillator(),g=ctx.createGain();o.frequency.setValueAtTime(105,at);o.frequency.exponentialRampToValueAtTime(38,at+.13);g.gain.setValueAtTime(gain,at);g.gain.exponentialRampToValueAtTime(.0001,at+.19);o.connect(g);g.connect(bus);o.start(at);o.stop(at+.2);o.onended=()=>{o.disconnect();g.disconnect();};return;}
  const source=ctx.createBufferSource(),f=ctx.createBiquadFilter(),env=ctx.createGain();source.buffer=noise;f.type=kind==='hat'?'highpass':'bandpass';f.frequency.value=kind==='hat'?6500:1800;const dur=kind==='hat'?.045:.13;
  env.gain.setValueAtTime(gain,at);env.gain.exponentialRampToValueAtTime(.0001,at+dur);source.connect(f);f.connect(env);env.connect(bus);source.start(at,Math.random()*.5,dur);source.onended=()=>{source.disconnect();f.disconnect();env.disconnect();};
}
function schedule(){
  if(!ctx||ctx.state!=='running')return;
  if(next<ctx.currentTime-.2)next=ctx.currentTime+.03;
  const t=themes[theme],beat=60/t.bpm;
  while(next<ctx.currentTime+.15){
    const bar=Math.floor(step/8),chord=t.chords[Math.floor(bar/2)%4],pos=step%8;
    if(!prefs.muted&&!document.hidden&&prefs.music>0){
      if(pos===0){for(const n of chord.slice(1))voice(n+12,next,beat*3.8,.017,'triangle');voice(chord[0]-12,next,beat*1.6,.11);}
      if(pos===4)voice(chord[0]-12,next,beat*.8,.07);
      if(pos===0||pos===4)percussion(next,'kick',.075+tension*.035);
      if(pos===2||pos===6)percussion(next,'snare',.028+tension*.018);
      if(pos%2===0||tension>.4)percussion(next,'hat',pos%2?.012:.018);
      // A complete phrase breathes every other bar instead of looping a notification melody.
      const note=t.melody[step%16];if(note!==null&&(bar%4!==3||tension>.5))voice(note,next,beat*.85,.025,'sine',musicBus,true);
      if(tension>.45&&pos%2===1)voice(chord[(pos+bar)%4]+12,next,beat*.5,.017*tension,'triangle',musicBus,true);
    }
    step++;next+=beat/2+(step%2?.012:-.012);
  }
}
export function updateScore(room){
  const g=room?.state;theme=({poker:0,chromatic:1,bluff:2,rummy:3,ohhell:3})[room?.game]??0;
  tension=!g?0:(g.presentation||['challenge','runout'].includes(g.phase))?.9:g.type==='poker'?Math.min(.8,(g.pot||0)/Math.max(1,(g.bigBlind||1)*30)):g.pendingPenalty?.8:Math.min(...Object.values(g.counts||{x:10}))<=2?.65:.15;
  if(filter&&ctx)filter.frequency.setTargetAtTime(2800+tension*2500,ctx.currentTime,1.5);
}
export function playSound(kind='tap'){
  try{
    if(!started||prefs.muted)return;boot();if(!ctx||ctx.state!=='running')return;const at=ctx.currentTime+.004;
    if(['deal','draw','place','chips','tap'].includes(kind)){
      percussion(at,kind==='chips'?'hat':'snare',kind==='tap'?.035:.08,effectBus);
      if(kind==='chips'){voice(87+Math.random()*4,at,.13,.05,'sine',effectBus);voice(94,at+.025,.08,.025,'sine',effectBus);}
      if(kind==='tap')voice(53+Math.random()*2,at,.055,.045,'triangle',effectBus);
      return;
    }
    const notes=({win:[60,64,67,72],error:[43,42],turn:[72,79],exposed:[48,55,60,63],honest:[67,64,60],reverse:[64,71,64],skip:[74,62],stack:[48,55,60,67],wild:[60,64,67,71],collect:[67,72,76]})[kind]||[67];
    notes.forEach((note,i)=>voice(note,at+i*.11,.38,.065,'triangle',effectBus));
  }catch{/* Audio must never block a move. */}
}
export function installAudio(){
  const unlock=()=>{started=true;try{boot();ctx?.resume().catch(()=>{});}catch{}};
  document.addEventListener('pointerdown',unlock,{once:true});document.addEventListener('keydown',unlock,{once:true});
  document.addEventListener('visibilitychange',()=>{applyMix();if(ctx)next=ctx.currentTime+.05;});
  setInterval(schedule,80);
}
