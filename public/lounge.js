import {portrait,emotes} from './profiles.js';
import {getMix,setMix,updateScore,playSound} from './audio.js';
import {commentFor} from './personality.js';
import {openCinema,syncCinema,cinemaTalk} from './cinema.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let options,drawer,resultPanel,chatRoom=null,chatCursor=0,chatLoading=false,chatAgain=false,chatOpen=false,messages=[],muted=new Set(),seen=new Set(),recent=new Map(),replayIndex=0,replayStep=0;
let settings={scale:'auto',effects:'full',shake:false,cards:1};try{settings={...settings,...JSON.parse(localStorage.getItem('venatus-experience')||'{}')};muted=new Set(JSON.parse(localStorage.getItem('venatus-muted-players')||'[]'));}catch{}
export function toolbar(){return '<div class="experience-toolbar"><button type="button" data-lounge="chat" aria-label="Open table chat">Chat <span class="chat-unread"></span></button><button type="button" data-lounge="emotes" aria-label="Send a reaction">☺ React</button><button type="button" data-lounge="results">Last result</button><button type="button" data-lounge="settings" aria-label="Display and sound settings">⚙</button><button type="button" data-lounge="fullscreen" aria-label="Toggle fullscreen">⛶</button></div>';}
export function presentationControls(room,viewer){
  const p=room.state?.presentation;if(!p)return '';
  const ready=p.ready?.includes(viewer),required=p.required||[],can=required.includes(viewer);
  const label=room.game==='poker'?'Next hand':room.game==='ohhell'?'Next round':'Continue';
  return `<div class="moment-result" role="status"><span>${p.manual?'Take your time':`${p.ready?.length||0} / ${required.length} ready`}</span>${can?`<button class="primary" data-lounge="ready" ${ready?'disabled':''}>${ready?'Ready ✓':label}</button>`:''}<small>${p.manual?'Continue when you have seen the result.':'The next turn starts after everyone is ready or the countdown ends.'}</small></div>`;
}
function applySettings(){const root=document.documentElement;root.dataset.uiScale=settings.scale;root.dataset.effects=settings.effects;root.style.setProperty('--card-adjust',String(settings.cards));root.dataset.screenShake=String(settings.shake);try{localStorage.setItem('venatus-experience',JSON.stringify(settings));}catch{}}
function eventFor(room){const g=room?.state;if(!g)return null;const name=id=>room.players.find(p=>p.id===id)?.name||'Player';
  if(room.game==='poker'&&g.lastResult?.handNumber===g.handNumber){const pots=g.lastResult.pots.filter(p=>!p.uncalled),winners=[...new Set(pots.flatMap(p=>p.winners))],split=pots.some(p=>p.winners.length>1);return {id:`${room.id}:${g.lastResult.id||g.handNumber}`,family:'poker',trigger:split?'split_pot':'public_win',title:winners.length===1?`${name(winners[0])} takes it`:split?'Split pot':'Pots awarded',sub:`Hand ${g.handNumber} · ${g.lastResult.pot.toLocaleString()} chips`,room:structuredClone(room)};}
  if(room.game==='bluff'&&g.reveal){const v=g.reveal;return {id:`${room.id}:bluff:${v.id||g.presentation?.id||g.moves}`,family:v.lied?'caught':'honest',title:v.lied?'Caught bluffing!':'The cards were honest',sub:`${name(v.collector)} takes ${v.collectedCount||v.count||v.cards.length} cards`,room:structuredClone(room)};}
  if(g.phase==='finished'||g.phase==='round-end'){const winner=g.roundWinner||g.winner,winners=g.phase==='finished'&&g.winners?.length>1?g.winners:null;return {id:`${room.id}:${room.started||''}:${room.game}:${g.round||g.handNumber||0}:${g.phase}`,family:room.game,title:winners?`${winners.map(name).join(' & ')} tie`:winner?`${name(winner)} wins`:'Round complete',sub:g.round?`Round ${g.round}`:'Well played.',room:structuredClone(room)};}
  return null;
}
function cinematic(event){openCinema(event,{settings,card:options.card,ready:presentationId=>options.submitAction({type:'ready',presentationId})});}
export function syncLounge(previous,room){
  syncCinema(room);
  // Rebuild results from the authorized server history after reload or reconnect.
  if(room?.state){
    const entries=room.game==='poker'?(room.state.recentResults||[]).map(r=>eventFor({...room,state:{...room.state,handNumber:r.handNumber,lastResult:r,board:r.board,showdown:r.showdown,hand:r.ownHand}})):room.game==='bluff'?(room.state.recentReveals||[]).map(r=>eventFor({...room,state:{...room.state,reveal:r}})):[];
    const list=recent.get(room.id)||[];for(const entry of entries.filter(Boolean))if(!list.some(e=>e.id===entry.id))list.unshift(entry);recent.set(room.id,list.slice(0,20));
  }
  updateScore(room);const event=eventFor(room);
  if(event&&!seen.has(event.id)){seen.add(event.id);if(seen.size>200)seen.delete(seen.values().next().value);const list=recent.get(room.id)||[];if(!list.some(e=>e.id===event.id))list.unshift(event);recent.set(room.id,list.slice(0,20));if(previous?.id===room.id){cinematic(event);}}
  if(chatRoom!==room?.id){chatRoom=room?.id||null;chatCursor=0;messages=[];if(drawer)renderMessages();}
  if(room&&(chatOpen||room.botChatSeq!==previous?.botChatSeq))refreshChat();
}
function renderMessages(){if(!drawer)return;const list=drawer.querySelector('.chat-messages'),nearBottom=list.scrollHeight-list.scrollTop-list.clientHeight<80;
  const state=options.getState(),host=state.room?.host===state.user?.id;
  list.innerHTML=messages.filter(m=>!muted.has(m.userId)).map(m=>`<article class="chat-message" data-message-id="${m.id}">${portrait({avatar:m.avatar,name:m.name,id:m.userId})}<div><header><b>${esc(m.name)}</b><time>${new Date(m.at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</time></header><p class="${m.type==='emote'?'chat-emote':''}">${m.type==='emote'?emotes[m.emote]||'✦':esc(m.text)}</p><span class="chat-message-tools">${m.userId!==state.user?.id?`<button type="button" data-mute-player="${esc(m.userId)}">Mute</button>`:''}${host?`<button type="button" data-delete-message="${m.id}">Remove</button>`:''}</span></div></article>`).join('')||'<p class="chat-empty">The table is yours. Say hello.</p>';
  if(nearBottom)list.scrollTop=list.scrollHeight;
}
export async function refreshChat(){
  const state=options?.getState();if(!state?.user||state.page!=='room'||!state.roomId)return;if(chatLoading){chatAgain=true;return;}
  const room=state.roomId;chatLoading=true;
  try{const data=await options.api(`/api/rooms/${encodeURIComponent(room)}/chat`);if(options.getState().roomId!==room)return;
    const fresh=data.messages.filter(m=>m.id>chatCursor);messages=data.messages;chatCursor=data.cursor||0;renderMessages();
    for(const message of fresh.slice(-3))if(!muted.has(message.userId)&&Date.now()-message.at<10000){
      if(message.bot&&!cinemaTalk(message)){document.querySelector('.bot-comment-toast')?.remove();const bubble=document.createElement('aside');bubble.className='bot-comment-toast';bubble.setAttribute('role','status');bubble.innerHTML=`${portrait({avatar:message.avatar,name:message.name})}<div><strong>${esc(message.name)} · Bot</strong><p>${esc(message.text)}</p></div><button aria-label="Dismiss comment">×</button>`;bubble.querySelector('button').onclick=()=>bubble.remove();document.body.append(bubble);setTimeout(()=>bubble.remove(),6500);}
      if(message.type==='emote'){const seat=[...document.querySelectorAll('[data-seat],[data-seat-id]')].find(s=>(s.dataset.seat||s.dataset.seatId)===message.userId);if(seat){const bubble=document.createElement('span');bubble.className='seat-emote';bubble.textContent=emotes[message.emote]||'✦';seat.append(bubble);setTimeout(()=>bubble.remove(),3200);}}
    }
    if(!chatOpen&&fresh.length&&fresh.some(m=>m.userId!==state.user.id))document.querySelectorAll('.chat-unread').forEach(el=>el.textContent='•');
  }catch(error){if(chatOpen)drawer.querySelector('.chat-error').textContent=error.message;}finally{chatLoading=false;if(chatAgain){chatAgain=false;queueMicrotask(refreshChat);}}
}
async function sendMessage(body){const state=options.getState();if(!state.roomId)throw new Error('Join a table to chat.');await options.api(`/api/rooms/${encodeURIComponent(state.roomId)}/chat`,body);await refreshChat();}
function openChat(){chatOpen=true;drawer.hidden=false;drawer.querySelector('.chat-error').textContent='';document.querySelectorAll('.chat-unread').forEach(el=>el.textContent='');
  const room=options.getState().room,g=room?.state,event=room&&eventFor(room);let trigger=event?.trigger||({caught:'bluff_caught',honest:'honest_claim',rummy:'valid_declaration'})[event?.family]||(event?'public_win':'round_start');
  if(!event&&room?.game==='chromatic'){if(g.pendingPenalty)trigger='draw_stack';else if(g.topCard?.value==='reverse')trigger='reverse';else if(Object.values(g.counts||{}).includes(1))trigger='one_card';}
  if(!event&&room?.game==='poker'&&g.events?.at(-1)?.action==='allin')trigger='public_all_in';
  const extra=room?commentFor(room.game,trigger,event?.id||`${room.id}:${g?.moves||0}`):'';
  drawer.querySelector('.chat-quips').innerHTML=['Nice hand','Well played','One more?',extra].filter(Boolean).map(text=>`<button type="button" data-quip="${esc(text)}">${esc(text)}</button>`).join('');refreshChat();drawer.querySelector('input').focus();}
function resultBody(event){const room=event.room,g=room.state,name=id=>esc(room.players.find(p=>p.id===id)?.name||'Player'),card=options.card;
  if(room.game==='poker')return `<div class="replay-board">${g.board.map(c=>card(c)).join('')}</div>${Object.entries(g.showdown||{}).map(([id,s])=>`<div class="replay-hand"><strong>${name(id)} · ${esc(s.name)}</strong><div>${s.hand.map(c=>card(c)).join('')}</div></div>`).join('')}<div class="replay-pots">${g.lastResult.pots.map((p,i)=>`<p><strong>${p.uncalled?'Uncalled return':i===0?'Main pot':'Side pot'}</strong> ${p.amount} → ${p.winners.map(name).join(' / ')}</p>`).join('')}</div>`;
  if(room.game==='bluff'){const v=g.reveal||g.lastReveal;return `<p>${name(v.player)} claimed ${v.count||v.cards.length} × ${esc(v.rank||v.cards[0]?.rank||'cards')}. ${name(v.challenger)} called.</p><div class="replay-board">${v.cards.map(c=>card(c)).join('')}</div><p>${name(v.collector)} collected the pile.</p>`;}
  return `<p>${esc(event.sub)}</p>${g.scores?`<div class="result-scores">${Object.entries(g.scores).map(([id,score])=>`<p>${name(id)} <strong>${score}</strong></p>`).join('')}</div>`:''}`;
}
function showResults(index=0){const state=options.getState(),list=recent.get(state.roomId)||[];replayIndex=index;
  if(!resultPanel){resultPanel=document.createElement('aside');resultPanel.className='result-drawer';resultPanel.setAttribute('aria-label','Previous results');document.body.append(resultPanel);}resultPanel.hidden=false;
  if(!list.length){resultPanel.innerHTML='<header><h2>Last result</h2><button data-close-results aria-label="Close results">×</button></header><p>Completed results will stay here while you play at this table.</p>';return;}
  const event=list[Math.max(0,Math.min(index,list.length-1))],events=event.room.state.lastResult?.events||[];replayStep=events.length-1;
  resultPanel.innerHTML=`<header><h2>${esc(event.title)}</h2><button data-close-results aria-label="Close results">×</button></header><div class="result-replay">${resultBody(event)}</div>${events.length?`<div class="replay-step"><button data-replay-step="-1" aria-label="Previous action">←</button><strong>Result</strong><button data-replay-step="1" aria-label="Next action">→</button></div>`:''}<div class="result-pagination">${list.map((_,i)=>`<button type="button" data-result-index="${i}" aria-pressed="${i===index}">${i===0?'Latest':i+1}</button>`).join('')}</div><button type="button" data-replay-scene="${index}">Replay moment</button>`;
}
function showSettings(){const mix=getMix();options.openModal('Make yourself comfortable',`<div class="stack experience-settings"><fieldset><legend>Interface size</legend><div class="setting-segments">${['auto','compact','comfortable','large'].map(value=>`<button type="button" data-setting="scale" data-value="${value}" aria-pressed="${settings.scale===value}">${value[0].toUpperCase()+value.slice(1)}</button>`).join('')}</div></fieldset><label>Card size<input type="range" data-setting-range="cards" min=".8" max="1.35" step=".05" value="${settings.cards}"></label><fieldset><legend>Animation</legend><div class="setting-segments">${['full','subtle','off'].map(value=>`<button type="button" data-setting="effects" data-value="${value}" aria-pressed="${settings.effects===value}">${value[0].toUpperCase()+value.slice(1)}</button>`).join('')}</div></fieldset>${[['master','Master'],['music','Music'],['effects','Effects']].map(([key,label])=>`<label>${label}<input type="range" data-mix="${key}" min="0" max="1" step=".05" value="${mix[key]}"></label>`).join('')}<button type="button" data-mix-quiet aria-pressed="${mix.quiet}">Quiet Discord mix ${mix.quiet?'✓':''}</button><small>Music follows the table. All controls stay available with sound and animation off.</small></div>`);}
export function installLounge(config){options=config;applySettings();drawer=document.createElement('aside');drawer.className='table-chat';drawer.hidden=true;drawer.setAttribute('aria-label','Table chat');drawer.innerHTML=`<header><h2>Table talk</h2><button type="button" data-chat-close aria-label="Close table chat">×</button></header><div class="chat-messages" role="log" aria-live="polite"></div><div class="chat-quips">${['Nice hand','No way','Well played','One more?'].map(text=>`<button type="button" data-quip="${text}">${text}</button>`).join('')}</div><div class="emote-picker">${emotes.map((emote,i)=>`<button type="button" data-send-emote="${i}" aria-label="${['Love','Star','Surprised','Good game','Coffee','Watching','Applause','Laugh','Shocked','Fire','Sparkle','Handshake'][i]}">${emote}</button>`).join('')}</div><form id="chat-form"><input name="message" maxlength="240" placeholder="Say something…" aria-label="Message" autocomplete="off"><button type="submit" aria-label="Send message">↑</button></form><p class="chat-error" role="alert"></p><button type="button" class="subtle" data-clear-muted>Unmute all players</button>`;document.body.append(drawer);
  document.addEventListener('click',async event=>{const b=event.target.closest('button');if(!b)return;try{
    const action=b.dataset.lounge;
    if(action==='chat'||action==='emotes')openChat();
    if(action==='settings')showSettings();
    if(action==='results')showResults();
    if(action==='ready'){const p=options.getState().room?.state?.presentation;if(p)await options.submitAction({type:'ready',presentationId:p.id});}
    if(action==='fullscreen'){if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}
    if(b.hasAttribute('data-chat-close')){drawer.hidden=true;chatOpen=false;}
    if(b.hasAttribute('data-send-emote'))await sendMessage({emote:Number(b.dataset.sendEmote)});
    if(b.dataset.quip)await sendMessage({text:b.dataset.quip});
    if(b.dataset.mutePlayer){muted.add(b.dataset.mutePlayer);localStorage.setItem('venatus-muted-players',JSON.stringify([...muted]));renderMessages();}
    if(b.hasAttribute('data-clear-muted')){muted.clear();localStorage.removeItem('venatus-muted-players');renderMessages();}
    if(b.dataset.deleteMessage){await sendMessage({deleteId:Number(b.dataset.deleteMessage)});}
    if(b.dataset.setting){settings[b.dataset.setting]=b.dataset.value;applySettings();b.parentElement.querySelectorAll('button').forEach(s=>s.setAttribute('aria-pressed',String(s===b)));}
    if(b.hasAttribute('data-mix-quiet')){const quiet=!getMix().quiet;setMix({quiet});b.setAttribute('aria-pressed',String(quiet));b.textContent=`Quiet Discord mix ${quiet?'✓':''}`;}
    if(b.dataset.resultIndex!==undefined)showResults(Number(b.dataset.resultIndex));
    if(b.hasAttribute('data-close-results'))resultPanel.hidden=true;
    if(b.dataset.replayStep){const item=(recent.get(options.getState().roomId)||[])[replayIndex],g=item?.room.state,events=g?.lastResult?.events||[];replayStep=Math.max(0,Math.min(events.length-1,replayStep+Number(b.dataset.replayStep)));const e=events[replayStep];if(e){resultPanel.querySelector('.replay-step strong').textContent=`${replayStep+1} / ${events.length} · ${e.kind}`;if(e.kind==='result')resultPanel.querySelector('.result-replay').innerHTML=resultBody(item);else{const board=[...events.slice(0,replayStep+1)].reverse().find(e=>e.kind==='board')?.board||[];const name=item.room.players.find(p=>p.id===e.player)?.name||'';resultPanel.querySelector('.result-replay').innerHTML=`<p>${e.kind==='action'?`${esc(name)} · ${esc(e.action)}${e.amount?' · '+e.amount:''}`:e.kind==='board'?esc(e.street):'Cards dealt'}</p><div class="replay-board">${board.map(c=>options.card(c)).join('')}</div><p>Your cards</p><div class="replay-board">${(g.lastResult.ownHand||g.hand||[]).map(c=>options.card(c)).join('')}</div>`;}}}
    if(b.dataset.replayScene!==undefined){const entry=(recent.get(options.getState().roomId)||[])[Number(b.dataset.replayScene)];if(entry){document.querySelector('#modal').close();cinematic(entry);}}
  }catch(error){options.toast(error.message);}});
  document.addEventListener('input',event=>{if(event.target.dataset.mix)setMix({[event.target.dataset.mix]:event.target.value});if(event.target.dataset.settingRange){settings[event.target.dataset.settingRange]=Number(event.target.value);applySettings();}});
  document.addEventListener('submit',async event=>{if(event.target.id!=='chat-form')return;event.preventDefault();const input=event.target.elements.message,text=input.value.trim();if(!text)return;const send=event.target.querySelector('button');send.disabled=true;try{await sendMessage({text});input.value='';drawer.querySelector('.chat-error').textContent='';}catch(error){drawer.querySelector('.chat-error').textContent=error.message;}finally{send.disabled=false;input.focus();}});
  setInterval(()=>{if(chatOpen)refreshChat();if(options.getState().page!=='room'){chatOpen=false;drawer.hidden=true;if(resultPanel)resultPanel.hidden=true;}},4000);
}
