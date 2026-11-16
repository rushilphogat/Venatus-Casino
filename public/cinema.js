import {portrait} from './profiles.js';
import {sceneFor,commentFor} from './personality.js';
import {scoreMoment} from './audio.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let active=null;
export function cinemaTalk(message){
  if(!active)return false;
  let target=active.dialog.querySelector('.cinema-talk');if(!target){target=document.createElement('p');target.className='cinema-talk';target.setAttribute('role','status');active.dialog.querySelector('.cinema-heading').append(target);}
  target.textContent=`${message.name} · Bot: ${message.text}`;return true;
}
export function closeCinema(){if(!active)return;const a=active;active=null;for(const timer of a.timers)clearTimeout(timer);clearInterval(a.clock);a.stopScore?.();a.dialog.close();a.dialog.remove();if(a.focus?.isConnected)a.focus.focus({preventScroll:true});}
export function syncCinema(room){
  if(!active)return;
  if(room?.id!==active.event.room.id||room.started!==active.event.room.started){closeCinema();return;}
  const old=active.event.room.state.presentation,current=room.state?.presentation;
  if(old&&current?.id!==old.id&&room.state?.phase!=='finished'){closeCinema();return;}
  active.room=room;active.refresh();
}
function evidence(event,card){
  const g=event.room.state,name=id=>esc(event.room.players.find(p=>p.id===id)?.name||'Player');
  if(event.family==='poker'){
    const r=g.lastResult,winners=new Set(r.pots.filter(p=>!p.uncalled).flatMap(p=>p.winners)),showdown=r.showdown||{};
    const hands=Object.entries(showdown).sort(([a],[b])=>Number(winners.has(b))-Number(winners.has(a))).map(([id,result])=>{
      const p=event.room.players.find(p=>p.id===id),best=new Set(result.cardIds||[]);
      return `<article class="cinema-hand ${winners.has(id)?'awarded':''}"><header>${portrait(p)}<div><strong>${name(id)}</strong><span>${esc(result.description||result.name)}</span></div>${winners.has(id)?'<b class="award-mark">WIN</b>':''}</header><div class="cinema-hole">${result.hand.map(c=>`<div class="${best.has(c.id)?'best-card':''}">${card(c)}</div>`).join('')}<span class="cinema-hand-type">${esc(result.name)}</span></div></article>`;
    }).join('');
    return `<section class="cinema-board" aria-label="Community cards">${r.board.map((c,i)=>`<div class="reveal-card" style="--i:${i}">${card(c)}<span class="reveal-back">V</span></div>`).join('')}</section>${hands?`<section class="cinema-hands" aria-label="Revealed hands">${hands}</section>`:''}<section class="cinema-awards" aria-label="Pot awards">${r.pots.map((p,i)=>`<div><small>${p.uncalled?'Uncalled return':i===0?'Main pot':`Side pot ${i}`}</small><strong>${p.winners.map(name).join(' / ')}</strong><b>${p.amount.toLocaleString()} <span>chips</span></b></div>`).join('')}</section>`;
  }
  if(['caught','honest'].includes(event.family)){
    const r=g.reveal||g.lastReveal;return `<div class="cinema-claim"><span>${name(r.player)} claimed</span><strong>${r.count||r.cards.length} × ${esc(r.rank)}</strong><small>${name(r.challenger)} called</small></div><section class="cinema-board">${r.cards.map((c,i)=>`<div class="reveal-card" style="--i:${i}">${card(c)}<span class="reveal-back">?</span></div>`).join('')}</section><section class="cinema-awards"><div><small>${event.family==='caught'?'Bluff exposed':'Claim verified'}</small><strong>${name(r.collector)} collects the pile</strong><b>${r.collectedCount||r.cards.length} <span>cards</span></b></div></section>`;
  }
  const winner=event.room.players.find(p=>p.id===(g.roundWinner||g.winner));return `<section class="cinema-winner">${winner?portrait(winner):''}${g.topCard?`<div class="reveal-card">${card(g.topCard)}<span class="reveal-back">V</span></div>`:''}</section><section class="cinema-awards">${Object.entries(g.scores||{}).map(([id,score])=>`<div><strong>${name(id)}</strong><b>${score} <span>points</span></b></div>`).join('')}</section>`;
}
export function openCinema(event,options){
  closeCinema();
  const subtle=options.settings.effects!=='full'||matchMedia('(prefers-reduced-motion: reduce)').matches;
  const uncontested=event.family==='poker'&&!Object.keys(event.room.state.lastResult?.showdown||{}).length;
  const midgame=event.room.status!=='finished'&&(['caught','honest'].includes(event.family)||event.room.state.phase==='round-end');
  const duration=subtle||uncontested?0:midgame?2200:5000,concept=sceneFor(event),dialog=document.createElement('dialog');
  dialog.className=`cinema cinema-${event.family} cinema-${concept.id}${duration?'':' cinema-still'}`;dialog.dataset.shot='0';dialog.dataset.scene=concept.id;dialog.setAttribute('aria-labelledby','cinema-title');
  const caption=commentFor(event.room.game,event.trigger||({caught:'bluff_caught',honest:'honest_claim',rummy:'valid_declaration'})[event.family]||'public_win',event.id);
  dialog.innerHTML=`<div class="cinema-light" aria-hidden="true"></div><div class="cinema-grain" aria-hidden="true"></div><header class="cinema-header"><span>${esc(event.sub)}</span><button data-cinema-close aria-label="Return to table">Back to table ↗</button></header><div class="cinema-body"><div class="cinema-heading"><span class="cinema-kicker">${event.family==='poker'?'THE SHOWDOWN':['caught','honest'].includes(event.family)?'CARDS ON THE TABLE':'THE FINAL CARD'}</span><h2 id="cinema-title">${duration?(event.family==='poker'?'Showdown':'The reveal'):esc(event.title)}</h2><p class="cinema-caption">${esc(caption)}</p></div>${evidence(event,options.card)}<div class="cinema-confetti" aria-hidden="true">${Array.from({length:18},(_,i)=>`<i style="--i:${i}">${['♠','♦','♥','♣'][i%4]}</i>`).join('')}</div></div><footer class="cinema-footer"><span class="cinema-time" role="status"></span><div><button data-cinema-skip ${duration?'':'hidden'}>Show result now</button><button class="primary" data-cinema-ready hidden>Ready for next hand</button><button data-cinema-done>Back to table</button></div></footer>`;
  const focus=document.activeElement;document.body.append(dialog);dialog.showModal();
  const a={event,options,dialog,focus,room:event.room,timers:[],refresh:null,finished:duration===0,expiresAt:Date.now()+(midgame?7000:20000)};active=a;
  const ready=dialog.querySelector('[data-cinema-ready]'),skip=dialog.querySelector('[data-cinema-skip]'),status=dialog.querySelector('.cinema-time');
  const finish=()=>{if(active!==a)return;for(const t of a.timers)clearTimeout(t);a.timers=[];a.finished=true;dialog.dataset.shot='4';dialog.querySelector('h2').textContent=event.title;skip.hidden=true;a.refresh();};
  a.refresh=()=>{
    if(active!==a)return;const p=a.room.status==='playing'?a.room.state?.presentation:null,can=p?.required?.includes(a.room.viewerId);ready.hidden=!!p&&!can;
    const hasReadied=can&&p.ready?.includes(a.room.viewerId);ready.disabled=!!hasReadied;ready.textContent=hasReadied?'Ready ✓':'Continue';
    const max=Math.max(0,Math.ceil(((p?.maximumUntil||a.expiresAt)-Date.now())/1000));
    if(max===0){closeCinema();return;}
    const votes=p?.required.filter(id=>p.ready.includes(id)).length||0;
    status.textContent=p?`${votes}/${p.majority||Math.floor(p.required.length/2)+1} votes · ${max}s left${p.bots?.length?' · Bots ready':''}`:`${max}s · Continue to return to the table`;
  };
  dialog.querySelector('[data-cinema-close]').onclick=closeCinema;dialog.querySelector('[data-cinema-done]').onclick=closeCinema;
  dialog.addEventListener('cancel',event=>{event.preventDefault();closeCinema();});skip.onclick=()=>{a.stopScore?.();scoreMoment('resolve');finish();};
  ready.onclick=async()=>{if(a.room.status!=='playing'||!a.room.state.presentation){closeCinema();return;}ready.disabled=true;try{await options.ready(a.room.state.presentation.id);}catch(error){status.textContent=error.message;ready.disabled=false;}};
  a.stopScore=scoreMoment(event.family,duration);
  if(duration){for(const [fraction,shot,title]of [[.2,'1','Cards revealed'],[.45,'2',event.title],[.7,'3',event.title]])a.timers.push(setTimeout(()=>{if(active===a){dialog.dataset.shot=shot;dialog.querySelector('h2').textContent=title;}},duration*fraction));a.timers.push(setTimeout(finish,duration));}else finish();
  a.clock=setInterval(a.refresh,250);a.refresh();
}
