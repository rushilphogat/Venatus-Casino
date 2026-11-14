import {handTools,renderHand} from './experience.js';
function seatMarkup(room, ui) {
  const {state,esc,fmt}=ui, g=room.state, poker=room.game==='poker';
  const own=Math.max(0,room.players.findIndex(p=>p.id===state.user.id));
  const seats=room.players.slice(own).concat(room.players.slice(0,own));
  return seats.map((p,i)=>{
    const angle=i*2*Math.PI/seats.length;
    const style=`--seat-x:${(50-42*Math.sin(angle)).toFixed(2)}%;--seat-y:${(50+48*Math.cos(angle)).toFixed(2)}%`;
    const active=p.id===g.turn && room.status==='playing' && ['play','bid','draw','discard'].includes(g.phase);
    const tags=poker?[[g.dealer,'D','Dealer'],[g.smallBlindPlayer,'SB','Small blind'],[g.bigBlindPlayer,'BB','Big blind']].filter(([id])=>id===p.id):[];
    const label=p.left?'Autoplay':p.bot?'Bot':p.id===state.user.id?'You':p.online===false?'Offline':'';
    const count=poker?`${fmt(g.stacks[p.id])} chips`:g.dropped?.[p.id]?'Dropped':`${g.counts[p.id]} cards`;
    const bet=poker&&g.bets?.[p.id]>0?`<span class="seat-wager"><i></i>${fmt(g.bets[p.id])}</span>`:'';
    return `<div class="seat ${active?'active':''} ${poker&&g.folded[p.id]?'seat-folded':''}" data-seat-id="${esc(p.id)}" style="${style}"><div class="seat-name" title="${esc(p.name)}">${esc(p.name)}</div><div class="seat-count">${count}${label?' · '+label:''}</div><div class="seat-marks">${tags.map(([,tag,title])=>`<span class="dealer-mark" title="${title}" aria-label="${title}">${tag}</span>`).join('')}${bet}${poker&&g.folded[p.id]?'<small>Folded</small>':''}</div></div>`;
  }).join('');
}
function roundLedger(g, name, esc) {
  if(!g.history.length)return '';
  return `<details class="round-ledger"><summary>Round scores · ${g.history.length} completed</summary><div class="ledger-scroll"><table><thead><tr><th>Round</th>${g.players.map(id=>`<th scope="col">${esc(name(id))}</th>`).join('')}</tr></thead><tbody>${g.history.map((h,i)=>`<tr><th scope="row">${h.round}</th>${g.players.map(id=>`<td>${h.tricks[id]}/${h.bids[id]} <small>+${h.scores[id]-(g.history[i-1]?.scores[id]||0)}</small></td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
}
let pokerReveal = {key:null, board:0, showdown:false};
export function specialRoom(room, ui) {
  const {state,card,esc,fmt,header,footer,connection,gameName,hostControls=()=>''}=ui;
  const g=room.state, own=g.turn===state.user.id&&room.status==='playing', done=g.phase==='finished'||room.status==='canceled';
  const name=id=>room.players.find(p=>p.id===id)?.name||'Player';
  const button=(move,label,enabled=true,extra='')=>`<button data-action="special-action" data-move="${move}" ${extra} ${enabled&&room.status==='playing'?'':'disabled'}>${label}</button>`;
  let center='',status='',controls='';
  if(room.game==='poker'){
    const key=`${room.id}:${g.handNumber}`;
    const previous=pokerReveal.key===key?pokerReveal:{board:0,showdown:false};
    const shown=Object.entries(g.showdown||{});
    const settled=g.lastResult?.handNumber===g.handNumber;
    const winners=new Set(settled?g.lastResult.pots.filter(p=>!p.uncalled).flatMap(p=>p.winners):[]);
    const flip=(c,index,animate)=>`<div class="poker-flip ${animate?'is-revealing':''}" style="--reveal-delay:${index*140}ms"><div class="poker-flip-inner"><div class="poker-card-back" aria-hidden="true">${card(null)}</div><div class="poker-card-face">${card(c)}</div></div></div>`;
    center=`<div class="poker-center"><div class="poker-board" aria-label="Community cards">${Array.from({length:5},(_,i)=>`<div class="poker-board-slot"><span class="poker-street-label">${['Flop','Flop','Flop','Turn','River'][i]}</span>${g.board[i]?flip(g.board[i],Math.max(0,i-previous.board),i>=previous.board):'<div class="poker-empty-card" aria-label="Not dealt yet">♠</div>'}</div>`).join('')}</div><div class="poker-pot"><span>${settled?'HAND POT AWARDED':'IN THE POT'}</span><strong>${fmt(settled?g.lastResult.pot:g.pot)} <small>chips</small></strong><span>${esc(g.street)} · Hand ${g.handNumber} · Blinds ${g.smallBlind}/${g.bigBlind}</span></div></div>`;
    const wonBy=id=>(g.lastResult?.payouts?.[id]||0)-(g.lastResult?.pots||[]).filter(p=>p.uncalled&&p.winners.includes(id)).reduce((sum,p)=>sum+p.amount,0);
    status=settled?`<div class="pot-receipt"><strong>Hand ${g.handNumber} settled</strong><div>${g.lastResult.pots.map((p,i)=>`<span>${p.uncalled?'Uncalled return':i===0?'Main pot':'Side pot'} · ${fmt(p.amount)} → ${p.winners.map(name).map(esc).join(' / ')}</span>`).join('')}</div></div>`:'';
    if(shown.length)status+=`<section class="poker-showdown" aria-label="Showdown results"><div class="poker-showdown-heading"><span class="eyebrow">THE CARDS ARE ON THE TABLE</span><h2>Showdown</h2><p>${[...winners].map(id=>esc(name(id))).join(' & ')} ${winners.size>1?'win the pots':'wins the pot'}</p></div><div class="poker-showdown-grid">${shown.map(([id,s],index)=>`<article class="poker-result ${winners.has(id)?'is-winner':''}"><div class="poker-result-label">${winners.has(id)?'POT WINNER':'HAND REVEALED'}</div><h3>${esc(name(id))}${id===state.user.id?' · You':''}</h3><div class="poker-hole-cards">${s.hand.map((c,i)=>flip(c,index*2+i,!previous.showdown)).join('')}</div><strong class="poker-hand-name">${esc(s.name)}</strong>${winners.has(id)?`<span class="poker-winner-mark">Awarded ${fmt(wonBy(id))} chips</span>`:''}</article>`).join('')}</div><p class="small muted">Folded hands stay private. Pot-by-pot awards are listed above; uncalled wagers are returned separately.</p></section>`;
    else if(settled)status+='<div class="poker-uncontested">Everyone else folded. The winning hand stays private.</div>';
    pokerReveal={key,board:g.board.length,showdown:shown.length>0};
    if(g.phase==='between-hands')controls=button('next-hand','Deal next hand')+button('cashout','Cash out the table');
    else {
      controls=g.legalActions.filter(a=>a!=='raise').map(a=>button(a,a==='allin'?'All in':a==='call'?`Call ${g.toCall}`:a[0].toUpperCase()+a.slice(1),own)).join('');
      if(g.legalActions.includes('raise')&&g.minRaise<=g.maxRaise)controls+=`<div class="bet-sizing"><div class="bet-presets">${[["Min",g.minRaise],["½ pot",Math.round(g.pot/2)],["Pot",g.pot],["Max",g.maxRaise]].map(([label,n])=>`<button data-action="bet-preset" data-amount="${Math.max(g.minRaise,Math.min(n,g.maxRaise))}">${label}</button>`).join('')}</div><label class="bet-slide">Size<input id="bet-slider" type="range" min="${g.minRaise}" max="${g.maxRaise}" value="${g.minRaise}" step="1"></label><label>Total wager<input id="bet-amount" type="number" min="${g.minRaise}" max="${g.maxRaise}" value="${g.minRaise}" step="1"></label>${button('raise','Raise to amount',own)}</div>`;
      if(!g.cashoutRequested)controls+=button('request-cashout','Cash out after hand');
      else controls+='<span class="small muted">Cash-out requested · hand in progress</span>';
    }
  }else if(room.game==='ohhell'){
    const trick=g.trick.length?g.trick:g.lastTrick;
    center=`<div class="trick-stage"><div class="trump-tile"><span class="eyebrow">Trump · ${esc(g.trumpCard.suit)}</span>${card(g.trumpCard)}<span>Round ${g.round} / ${g.rounds}</span></div><div class="trick-cards"><p class="trick-title">${g.trick.length?`Follow ${esc(g.trick[0].card.suit)} · trick ${Object.values(g.tricks).reduce((a,b)=>a+b,0)+1}/${g.handSize}`:g.lastTrick.length?`Last trick · ${esc(name(g.lastTrickWinner))} took it`:'Make your bid'}</p><div class="row wrap">${trick.map(t=>`<div data-trick-card="${esc(t.card.id)}" class="trick-play ${!g.trick.length&&t.player===g.lastTrickWinner?'trick-winner':''}"><span>${esc(name(t.player))}</span>${card(t.card)}</div>`).join('')||`<div class="trick-empty">${g.handSize} tricks available<br><small>Predict how many you will take</small></div>`}</div></div></div>`;
    status=`<div class="bid-scoreboard" aria-label="Bids and scores">${g.players.map(id=>`<div class="bid-score ${g.bids[id]!==undefined&&g.tricks[id]===g.bids[id]?'on-target':''}"><strong>${esc(name(id))}</strong><div><b>${g.tricks[id]}</b><span> / ${g.bids[id]??'—'} bid</span></div><small>${g.scores[id]} points${g.bids[id]!==undefined&&g.tricks[id]>g.bids[id]?' · Over bid':''}</small></div>`).join('')}</div>`;
    status+=roundLedger(g,name,esc);
    if(g.phase==='bid')controls=own?`<div class="bid-pad" role="group" aria-label="Choose your bid"><strong>Bid tricks</strong>${g.legalBids.map(b=>button('bid',String(b),true,`data-amount="${b}" aria-label="Bid ${b} tricks"`)).join('')}</div>`:`<span class="small muted">Waiting for ${esc(name(g.turn))} to bid</span>`;
    else if(g.phase==='round-end')controls=button('next-round','Deal next round');
    else controls=button('play','Play selected card',own&&state.selected.size===1);
  }else{
    center=`<div class="rummy-stage"><div class="rummy-deck"><span class="eyebrow">Wild indicator</span>${card(g.indicator)}<small>Wild rank: ${esc(g.wildRank)}</small></div><button class="rummy-deck pile-action" data-action="special-action" data-move="draw" data-source="stock" ${own&&g.phase==='draw'?'':'disabled'} aria-label="Draw from closed stock">${card(null)}<strong>Closed deck</strong><small>${g.stockCount} cards</small></button><button class="rummy-deck pile-action" data-action="special-action" data-move="draw" data-source="discard" ${own&&g.phase==='draw'&&g.canTakeDiscard?'':'disabled'} aria-label="Take the open discard">${g.topCard?card(g.topCard):'<span class="discard-space"></span>'}<strong>Open discard</strong><small>${!g.topCard?'Empty':g.canTakeDiscard?'Face up':'Joker · locked'}</small></button></div>`;
    status=g.phase==='finished'?'':`<div class="rummy-objective"><strong>${own?(g.phase==='draw'?'Pick a pile':'Choose one discard'):`${esc(name(g.turn))} is ${g.phase==='draw'?'drawing':'discarding'}`}</strong><span>${g.phase==='draw'?'Build two sequences, including one pure sequence.':'Keep 13 cards in groups to declare.'}</span></div>`;
    if(g.analysis)status+=`<section class="meld-review" aria-label="Last group check"><div><strong>${g.analysis.valid?'Ready to declare':'Last group check'}</strong><span>${g.analysis.penalty} penalty points</span></div><div class="meld-strip">${g.analysis.groups.map(group=>`<div><small>${({pure:'Pure sequence',sequence:'Sequence',set:'Set'})[group.kind]}</small><span>${group.cards.map(id=>g.hand.find(c=>c.id===id)).filter(Boolean).map(c=>esc(c.rank+' '+c.suit)).join(' · ')}</span></div>`).join('')||'<p>Check for a pure sequence and a second sequence first.</p>'}</div></section>`;
    if(g.penalties)status+=`<p>Penalty points: ${Object.entries(g.penalties).map(([id,n])=>esc(name(id))+': '+n).join(' · ')}</p>`;
    if(g.phase==='draw')controls=button('analyze','Check my groups',own)+button('drop','Drop hand',own);
    else controls=button('discard','Discard selected',own&&state.selected.size===1)+button('analyze','Check remaining groups',own&&state.selected.size===1)+button('declare','Declare Rummy',own&&state.selected.size===1);
  }
  const selectable=room.game==='ohhell'?own&&g.phase==='play':room.game==='rummy'?own&&g.phase==='discard':false;
  const banner=done?`<div class="win-banner">${room.status==='canceled'?'Table canceled':room.game==='poker'?'Session settled':g.winners?.length>1?'Tied leaders split the pot':`${esc(name(g.winner))} wins`}. ${room.practice?(room.game==='poker'?'Final stacks settled.':'Final scores recorded.'):`Your wallet received ${fmt(room.payout)} chips.`}</div>`:room.status==='paused'?'<div class="win-banner">Play paused by an administrator.</div>':'';
  return `${header()}<main class="layout game-room game-${room.game}" data-game="${room.game}"><div class="room-top"><div><button data-action="navigate" data-page="lobby" class="subtle">← Back to the casino</button><div class="eyebrow">${gameName(room.game)}</div><h2>${esc(room.name)}</h2></div><div class="room-meta">${room.practice?'<span class="badge">Casual · table chips</span>':''}<button data-action="leave-table" class="subtle">Leave table</button>${room.practice&&room.game!=='poker'?'Scoring only':`${room.game==='poker'?room.practice?'Starting stack':'Buy-in':'Ante'} ${fmt(room.stake)}`}<button data-action="rules" data-game="${room.game}">Rules</button></div></div>${banner}${room.practice&&g.phase==='between-hands'?hostControls(room):''}
    <section class="felt"><div class="seats">${seatMarkup(room,ui)}</div><div class="table-center">${center}</div></section>
    <div class="turn-bar"><strong>${done?'Complete':g.phase==='between-hands'?'Hand complete':g.phase==='round-end'?'Round complete':own?'Your move':`${esc(name(g.turn))} to act`}</strong>${!done?`<span class="timer" data-deadline="${g.deadline}"></span>`:''}<p>${esc(g.message)}</p></div>${status}<div class="hand-label">Your private hand · ${g.hand.length} cards</div>${handTools(room)}<div class="hand">${renderHand(room,card,esc,selectable,c=>room.game==='ohhell'&&!g.legalCardIds.includes(c.id))}</div>
    <div class="game-actions">${done?`${room.practice&&room.host===state.user.id?'<button class="primary" data-action="rematch">Play again</button>':''}<button data-action="leave-table">Return to the casino →</button>`:controls}</div>${connection()}</main>${footer()}`;
}

export function installSpecialInput() {
  document.addEventListener('input', event => {
    const input = event.target;
    if (!['bet-slider','bet-amount'].includes(input.id) || !input.validity.valid || !input.value) return;
    const linked = document.getElementById(input.id === 'bet-slider' ? 'bet-amount' : 'bet-slider');
    if (linked) linked.value = input.value;
  });
}

// Movement is derived exclusively from the two confirmed, player-visible snapshots.
function tableMoves(previous, room) {
  if (!previous || previous.id !== room.id || previous.version === room.version || !room.state) return [];
  const before=previous.state, after=room.state;
  const seat=id=>`[data-seat-id="${selectorValue(id)}"]`;
  const pocket=id=>`[data-hand-id="${selectorValue(id)}"]`;
  const move=(kind,from,to)=>({kind,from,to});
  if (room.game==='poker') {
    const pot='.poker-pot';
    if (!before || before.handNumber!==after.handNumber) return room.players.filter(p=>after.counts[p.id]>0).map(p=>move('deal',pot,seat(p.id)));
    if (after.lastResult?.handNumber===after.handNumber && before.lastResult?.handNumber!==after.handNumber)
      return Object.entries(after.lastResult.payouts).filter(([,amount])=>amount>0).map(([id])=>move('award',pot,seat(id)));
    return room.players.flatMap(({id})=>{
      if (after.contributions[id]>before.contributions[id]) return [move('wager',seat(id),pot)];
      if (after.folded[id]&&!before.folded[id]) return [move('fold',seat(id),'.poker-board')];
      return [];
    });
  }
  if (!before) return [];
  if (room.game==='ohhell' && before.round===after.round) {
    if (after.lastTrick.length && before.lastTrick[0]?.card.id!==after.lastTrick[0].card.id && !after.trick.length)
      return after.lastTrick.map(t=>move('trick',`[data-trick-card="${selectorValue(t.card.id)}"]`,seat(after.lastTrickWinner)));
    return after.trick.filter(t=>!before.trick.some(old=>old.card.id===t.card.id)).map(t=>move('play',seat(t.player),`[data-trick-card="${selectorValue(t.card.id)}"]`));
  }
  if (room.game==='rummy') {
    const actor=before.turn;
    const discard='.rummy-deck[data-source="discard"]';
    if (after.counts[actor]===before.counts[actor]+1) {
      const drawn=after.hand.find(c=>!before.hand.some(old=>old.id===c.id));
      const from=before.topCard?.id!==after.topCard?.id && before.stockCount===after.stockCount?discard:'.rummy-deck[data-source="stock"]';
      return [move('draw',from,drawn?pocket(drawn.id):seat(actor))];
    }
    if (after.counts[actor]===before.counts[actor]-1 && after.topCard?.id!==before.topCard?.id)
      return [move('discard',seat(actor),discard)];
  }
  return [];
}

// IDs are server-generated. Escape the characters that have meaning inside a quoted attribute selector.
function selectorValue(id) { return String(id).replace(/["\\]/g,'\\$&'); }

export function specialTransitionSound(before,room) {
  const event=tableMoves(before,room)[0];
  return ({deal:'draw',award:'collect',wager:'chips',fold:'place',trick:'collect',play:'place',discard:'place',draw:'draw'})[event?.kind]||null;
}

export function animateSpecialTransition(before,room,root=document) {
  const stage=root.querySelector(`.game-${room.game} .felt`);
  if (!stage || !stage.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const stageBox=stage.getBoundingClientRect();
  const flights=tableMoves(before,room).map(event=>{
    const origin=root.querySelector(event.from),destination=root.querySelector(event.to);
    return origin&&destination?{...event,origin:origin.getBoundingClientRect(),destination:destination.getBoundingClientRect()}:null;
  }).filter(Boolean);
  flights.forEach(({kind,origin,destination},index)=>{
    const token=document.createElement('i');
    token.setAttribute('aria-hidden','true');
    token.className=`table-flight ${kind==='wager'||kind==='award'?'flight-chips':'flight-card'}`;
    const dx=destination.left+destination.width/2-origin.left-origin.width/2;
    const dy=destination.top+destination.height/2-origin.top-origin.height/2;
    token.style.left=`${origin.left+origin.width/2-stageBox.left-stage.clientLeft}px`;
    token.style.top=`${origin.top+origin.height/2-stageBox.top-stage.clientTop}px`;
    stage.append(token);
    const arc=Math.min(24,Math.hypot(dx,dy)*.13);
    const animation=token.animate([
      {transform:'translate(-50%, -50%) rotate(-9deg) scale(.8)',opacity:0},
      {offset:.15,opacity:1},
      {offset:.55,transform:`translate(calc(-50% + ${dx*.55}px),calc(-50% + ${dy*.55-arc}px)) rotate(4deg) scale(1)`},
      {transform:`translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) rotate(0) scale(.7)`,opacity:0}
    ],{duration:kind==='trick'||kind==='award'?490:330,delay:Math.min(index*30,120),easing:'cubic-bezier(.2,.7,.28,1)',fill:'both'});
    animation.onfinish=animation.oncancel=()=>token.remove();
  });
}
