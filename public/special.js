let pokerReveal = {key:null, board:0, showdown:false};
export function specialRoom(room, ui) {
  const {state,card,esc,fmt,header,footer,connection,gameName}=ui;
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
    center=`<div class="poker-center"><div class="poker-board" aria-label="Community cards">${Array.from({length:5},(_,i)=>`<div class="poker-board-slot"><span class="poker-street-label">${['Flop','Flop','Flop','Turn','River'][i]}</span>${g.board[i]?flip(g.board[i],Math.max(0,i-previous.board),i>=previous.board):'<div class="poker-empty-card" aria-label="Not dealt yet">♠</div>'}</div>`).join('')}</div><div class="poker-pot"><span>${settled?'HAND POT AWARDED':'IN THE POT'}</span><strong>${fmt(settled?g.lastResult.pot:g.pot)} <small>chips</small></strong><span>${esc(g.street)} · Blinds ${g.smallBlind}/${g.bigBlind}</span></div></div>`;
    status=`<p>Hand ${g.handNumber} of up to 10. ${g.cashoutRequested?'Cash-out requested: this session ends after this hand.':'Any player may cash out the table between hands.'}</p>`;
    if(g.lastResult)status+=`<p>Last hand: ${g.lastResult.pots.map(p=>`${fmt(p.amount)} to ${p.winners.map(name).map(esc).join(' / ')}${p.uncalled?' (uncalled return)':''}`).join(' · ')}</p>`;
    if(shown.length)status+=`<section class="poker-showdown" aria-label="Showdown results"><div class="poker-showdown-heading"><span class="eyebrow">THE CARDS ARE ON THE TABLE</span><h2>Showdown</h2><p>${[...winners].map(id=>esc(name(id))).join(' & ')} ${winners.size>1?'win the pots':'wins the pot'}</p></div><div class="poker-showdown-grid">${shown.map(([id,s],index)=>`<article class="poker-result ${winners.has(id)?'is-winner':''}"><div class="poker-result-label">${winners.has(id)?'POT WINNER':'HAND REVEALED'}</div><h3>${esc(name(id))}${id===state.user.id?' · You':''}</h3><div class="poker-hole-cards">${s.hand.map((c,i)=>flip(c,index*2+i,!previous.showdown)).join('')}</div><strong class="poker-hand-name">${esc(s.name)}</strong>${winners.has(id)?'<span class="poker-winner-mark">✦ Winning hand</span>':''}</article>`).join('')}</div><p class="small muted">Folded hands stay private. Pot-by-pot awards are listed above; uncalled wagers are returned separately.</p></section>`;
    else if(settled)status+='<div class="poker-uncontested">Everyone else folded. The winning hand stays private.</div>';
    pokerReveal={key,board:g.board.length,showdown:shown.length>0};
    if(g.phase==='between-hands')controls=button('next-hand','Deal next hand')+button('cashout','Cash out the table');
    else {
      controls=g.legalActions.filter(a=>a!=='raise').map(a=>button(a,a==='allin'?'All in':a==='call'?`Call ${g.toCall}`:a[0].toUpperCase()+a.slice(1),own)).join('');
      if(g.legalActions.includes('raise')&&g.minRaise<=g.maxRaise)controls+=`<label>Total wager<input id="bet-amount" type="number" min="${g.minRaise}" max="${g.maxRaise}" value="${g.minRaise}" step="1"></label>${button('raise','Raise to amount',own)}`;
      if(!g.cashoutRequested)controls+=button('request-cashout','Cash out after hand');
    }
  }else if(room.game==='ohhell'){
    const trick=g.trick.length?g.trick:g.lastTrick;
    center=`<div><p class="gold">Trump: ${esc(g.trumpCard.suit)} · Round ${g.round}/${g.rounds} · ${g.handSize} tricks</p><div class="row wrap" style="justify-content:center">${card(g.trumpCard)}${trick.map(t=>`<div><span class="small">${esc(name(t.player))}</span>${card(t.card)}</div>`).join('')}</div></div>`;
    status=`<div class="table-wrap"><table class="data-table"><tr><th>Player</th><th>Bid</th><th>Tricks</th><th>Score</th></tr>${g.players.map(id=>`<tr><td>${esc(name(id))}${id===g.dealer?' · Dealer':''}</td><td>${g.bids[id]??'—'}</td><td>${g.tricks[id]}</td><td>${g.scores[id]}</td></tr>`).join('')}</table></div>`;
    if(g.phase==='bid')controls=`<label>Your bid<select id="bid-amount" ${own?'':'disabled'}>${g.legalBids.map(b=>`<option value="${b}">${b}</option>`).join('')}</select></label>${button('bid','Lock bid',own)}`;
    else if(g.phase==='round-end')controls=button('next-round','Deal next round');
    else controls=button('play','Play selected card',own&&state.selected.size===1);
  }else{
    center=`<div><p class="gold">Wild rank: ${esc(g.wildRank)} · Stock: ${g.stockCount}</p><div class="row" style="justify-content:center"><div><p class="small">Wild indicator</p>${card(g.indicator)}</div><div><p class="small">Discard pile</p>${card(g.topCard)}</div></div></div>`;
    status='<p>13-card Indian Rummy: two sequences, including one pure sequence. Select your discard before declaring or checking a 14-card hand.</p>';
    if(g.analysis)status+=`<div class="panel"><strong>${g.analysis.valid?'Valid declaration':'Not yet a valid declaration'} · ${g.analysis.penalty} penalty points</strong>${g.analysis.groups.map(group=>`<p>${esc(group.kind)}: ${group.cards.map(id=>g.hand.find(c=>c.id===id)).filter(Boolean).map(c=>esc(c.rank+' '+c.suit)).join(' · ')}</p>`).join('')}</div>`;
    if(g.penalties)status+=`<p>Penalty points: ${Object.entries(g.penalties).map(([id,n])=>esc(name(id))+': '+n).join(' · ')}</p>`;
    if(g.phase==='draw')controls=button('draw','Draw from stock',own,'data-source="stock"')+button('draw','Take discard',own&&g.canTakeDiscard,'data-source="discard"')+button('analyze','Check my groups',own)+button('drop','Drop hand',own);
    else controls=button('discard','Discard selected',own&&state.selected.size===1)+button('analyze','Check remaining groups',own&&state.selected.size===1)+button('declare','Declare Rummy',own&&state.selected.size===1);
  }
  const selectable=room.game==='ohhell'?own&&g.phase==='play':room.game==='rummy'?own&&g.phase==='discard':false;
  const banner=done?`<div class="win-banner">${room.status==='canceled'?'Table canceled':room.game==='poker'?'Session settled':g.winners?.length>1?'Tied leaders split the pot':`${esc(name(g.winner))} wins`}. Your wallet received ${fmt(room.payout)} chips.</div>`:room.status==='paused'?'<div class="win-banner">Play paused by an administrator.</div>':'';
  return `${header()}<main class="layout game-room"><div class="room-top"><div><button data-action="navigate" data-page="lobby" class="subtle">← Back to the casino</button><div class="eyebrow">${gameName(room.game)}</div><h2>${esc(room.name)}</h2></div><div class="room-meta">${room.game==='poker'?'Buy-in':'Ante'} ${fmt(room.stake)}<button data-action="rules" data-game="${room.game}">Rules</button></div></div>${banner}
    <section class="felt"><div class="seats">${room.players.map(p=>`<div class="seat ${p.id===g.turn&&!done?'active':''}"><div class="avatar">${esc(p.name.slice(0,2))}</div><div class="seat-name">${esc(p.name)}${p.id===state.user.id?' · You':''}</div><div class="seat-count">${room.game==='poker'?`${fmt(g.stacks[p.id])} chips${g.folded[p.id]?' · Folded':''}${p.id===g.dealer?' · Dealer':''}`:g.dropped?.[p.id]?'Dropped':`${g.counts[p.id]} cards`}</div></div>`).join('')}</div><div class="table-center">${center}</div></section>
    <div class="turn-bar"><strong>${done?'Complete':own?'Your move':`${esc(name(g.turn))} to act`}</strong>${!done?`<span class="timer" data-deadline="${g.deadline}"></span>`:''}<p>${esc(g.message)}</p></div>${status}<div class="hand-label">Your private hand</div><div class="hand">${g.hand.map(c=>card(c,selectable,room.game==='ohhell'&&!g.legalCardIds.includes(c.id))).join('')}</div>
    <div class="game-actions">${done?'<button class="primary" data-action="leave-table">Return to the casino →</button>':controls}</div>${connection()}</main>${footer()}`;
}
