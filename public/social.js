import { handTools, renderHand } from './experience.js';

const colours = { ruby:'Ruby', emerald:'Emerald', sapphire:'Sapphire', gold:'Gold' };
const colourName = key => colours[key] || 'Choose a colour';
const actionName = { skip:'Skip', reverse:'Reverse', draw2:'Draw two', wild:'Wild', wilddraw4:'Wild draw four' };

function colourChoices(game, action) {
  return `<fieldset class="colour-choices"><legend>Choose the colour</legend>${game.colors.filter(c => colours[c]).map(c =>
    `<button type="button" data-action="${action}" data-color="${c}" class="colour-choice ink-${c}"><i></i>${colours[c]}</button>`).join('')}</fieldset>`;
}

function colorControls(room, ui) {
  const g = room.state, own = g.turn === ui.state.user.id;
  if (g.phase === 'round-end') return '<button class="primary" data-action="chromatic-action" data-move="next-round">Deal next round</button>';
  if (g.phase === 'choose-color') return own ? colourChoices(g,'starting-colour') : '';
  const moves = [];
  const move = (key,label) => `<button data-action="chromatic-action" data-move="${key}">${label}</button>`;
  if (own && g.phase === 'challenge') moves.push(move('accept','Accept +4'),move('challenge','Challenge +4'));
  else if (own) {
    const chosen = g.hand.find(c => ui.state.selected.has(c.id));
    if (chosen?.color === 'wild') moves.push(colourChoices(g,'play-wild'));
    else moves.push(`<button class="primary" data-action="play-cards" ${chosen?'':'disabled'}>Play card</button>`);
    if (g.phase === 'drawn') moves.push(move('pass','Keep card & pass'));
    else moves.push(`<button data-action="draw-card">${g.pendingPenalty ? `Draw ${g.pendingPenalty} & skip` : 'Draw a card'}</button>`);
  }
  if (g.canDeclare) moves.push(move('declare','One card!'));
  if (g.catchablePlayer && g.catchablePlayer !== ui.state.user.id) {
    moves.push(`<button class="challenge-button" data-action="chromatic-action" data-move="catch" data-target="${ui.esc(g.catchablePlayer)}">Catch ${ui.name(g.catchablePlayer)}</button>`);
  }
  return moves.join('');
}

function bluffControls(room, ui) {
  const g = room.state, viewer = ui.state.user.id;
  if (g.phase === 'challenge') return g.lastPlay?.player !== viewer ? '<button class="challenge-button" data-action="challenge">Call bluff</button>' : '';
  if (g.turn !== viewer) return '';
  const count = ui.state.selected.size;
  const pick = g.requiredRank ? '' : `<label class="claim-picker">Claim rank <select id="bluff-rank">${g.ranks.map(r => `<option ${r===ui.claimRank?'selected':''}>${ui.esc(r)}</option>`).join('')}</select></label>`;
  return `${pick}<button class="primary" data-action="play-cards" ${count?'':'disabled'}>${count ? `Claim ${count} × ${ui.esc(g.requiredRank || ui.claimRank || g.ranks[0])}` : 'Select 1–4 cards'}</button>${g.houseRules==='street'?'<button data-action="bluff-skip">Skip turn</button>':''}`;
}

function bluffCenter(g, ui) {
  const { name, esc, card } = ui;
  const verdict = g.reveal;
  if (verdict?.cards?.length) return `<div class="bluff-verdict social-verdict" data-pile>
    <div class="revealed-cards">${verdict.cards.map(c => card(c)).join('')}</div>
    <div><small>${name(verdict.challenger)} called bluff</small><h3>${verdict.lied?'Caught bluffing':'An honest claim'}</h3>
    <p>${name(verdict.collector)} takes the pile.</p></div></div>`;
  const claim = g.lastPlay;
  const count = g.pileCount || 0;
  return `<div class="bluff-center"><div class="bluff-stack" data-pile>${count ? Array.from({length:Math.min(3,count)},()=>card(null)).join('') : '<span>Empty pile</span>'}</div>
    <div class="claim-details"><small>${claim ? `${name(claim.player)} claims` : g.requiredRank ? 'Rank in play' : 'Open rank'}</small>
    <h3>${claim ? `${claim.count} × ${esc(claim.rank)}` : esc(g.requiredRank || 'Any rank')}</h3>
    <p>${count} in the pile${g.skips ? ` · ${g.skips}/${g.players.length} skips` : ''}</p></div></div>`;
}

function colorCenter(g, ui, canDraw) {
  const top = g.topCard, value = actionName[top?.value] || top?.value || '';
  return `<div class="spectrum-center"><div class="deck-pair"><button type="button" class="spectrum-deck" data-action="draw-card" aria-label="Draw ${g.pendingPenalty || 'a'} card${g.pendingPenalty>1?'s':''}" ${canDraw?'':'disabled'}>${ui.card(null)}<span>Draw · ${g.drawCount}</span></button>
    <div class="spectrum-discard" data-pile>${ui.card(top)}<span>Discard</span></div></div>
    <div class="colour-status"><small>Active colour</small><h3><i></i>${colourName(g.activeColor)}</h3>
    <p><b class="play-direction" aria-hidden="true">${g.direction === -1 ? '↶':'↷'}</b>${g.direction === -1 ? 'Counterclockwise':'Clockwise'}</p>
    ${g.pendingPenalty ? `<strong class="stack-tag">+${g.pendingPenalty} stacked</strong>` : `<span class="top-value">${ui.esc(value)}</span>`}</div></div>`;
}

function turnInfo(room, ui) {
  const g = room.state, own = g.turn === ui.state.user.id;
  if (room.status === 'paused') return ['Table paused','Play resumes when the host restarts the clock.'];
  if (g.phase === 'finished') return [g.winner ? `${ui.name(g.winner)} wins` : 'Draw', room.practice ? 'Match complete' : `${ui.fmt(room.pot)} chips settled`];
  if (g.phase === 'round-end') return [`${ui.name(g.roundWinner)} wins round ${g.round}`, `+${g.roundPoints} points · first to ${g.targetScore}`];
  if (room.game==='bluff') {
    if (g.phase==='challenge') return [g.lastPlay.player === ui.state.user.id ? 'Your claim is on the table' : 'Do you believe the claim?', 'Call before time runs out, or let it stand.'];
    return [own?'Your declaration':`${ui.name(g.turn)} to declare`, g.requiredRank ? `Claim ${ui.esc(g.requiredRank)}${g.houseRules==='street'?' or skip':''}.` : 'Pick a rank and play one to four cards face-down.'];
  }
  if (g.phase==='challenge') return [own?'Accept or challenge the +4':`${ui.name(g.turn)} has a decision`,ui.esc(g.message)];
  if (g.phase==='choose-color') return [own?'Choose the opening colour':`${ui.name(g.turn)} chooses a colour`,'Opening wild'];
  if (g.phase==='drawn') return [own?'Play your drawn card or pass':`${ui.name(g.turn)} drew a playable card`, ui.esc(g.message)];
  if (g.pendingPenalty) return [own?`Stack or draw ${g.pendingPenalty}`:`${ui.name(g.turn)} faces +${g.pendingPenalty}`,g.penaltyKind==='draw2'?'Play +2 or +4 to pass the stack.':'Only +4 continues this stack.'];
  return [own?'Your move':`${ui.name(g.turn)} to play`,ui.esc(g.message)];
}

export function socialRoom(room, ui) {
  const g = room.state, bluff = room.game === 'bluff', viewer = ui.state.user.id;
  const live = room.status === 'playing', own = live && g.turn === viewer;
  const name = id => ui.esc(room.players.find(p=>p.id===id)?.name || 'Player');
  const h = {...ui,name};
  const over = g.phase === 'finished', [lead,detail] = turnInfo(room,h);
  const legal = c => g.rulesVersion === 2 ? g.legalCardIds.includes(c.id) : c.color === 'wild' || c.color === g.activeColor || c.value === g.topCard?.value;
  const controls = over ? `${room.practice && room.host===viewer?'<button class="primary" data-action="rematch">Play again</button>':''}<button data-action="leave-table">Leave table</button>` : !live ? '' : bluff ? bluffControls(room,h) : colorControls(room,h);
  return `${ui.header()}<main class="layout game-room social-room game-${room.game} ink-${colours[g.activeColor]?g.activeColor:'neutral'}">
    <div class="room-top"><div><button class="subtle" data-action="navigate" data-page="lobby">← Lobby</button><div class="eyebrow">${ui.gameName(room.game)} · ${room.practice?'Casual table':'Event table'}</div><h2>${ui.esc(room.name)}</h2></div>
    <div class="room-meta">${room.practice?'':`<span>Pot <b>${ui.fmt(room.pot)}</b></span>`}<button class="subtle" data-action="rules" data-game="${room.game}">Rules</button><button data-action="leave-table">Leave table</button></div></div>
    <section class="social-mat" aria-label="${ui.gameName(room.game)} table"><ul class="social-seats">${room.players.map(p => `<li data-seat="${ui.esc(p.id)}" class="${g.turn === p.id && !over ? 'seat-active':''}"><b>${name(p.id)}${p.id===viewer?' · You':''}</b><span>${p.left?'Autoplay · ':p.bot?'Bot · ':p.online===false && p.id!==viewer?'Offline · ':''}${g.counts[p.id]} cards${!bluff && g.scores?` · ${g.scores[p.id]} pts`:''}</span></li>`).join('')}</ul>
    ${bluff?bluffCenter(g,h):colorCenter(g,h,own && g.phase==='play')}<div class="social-caption">${bluff?'Bluff':g.round?`Round ${g.round} · First to ${g.targetScore}`:'Chromatic'}</div></section>
    <div class="social-turn" role="status"><div><strong>${lead}</strong><p>${detail}</p></div>${g.deadline && live ? `<span class="timer" data-deadline="${g.deadline}"></span>`:''}</div>
    ${g.evidence?`<details><summary>View private challenge evidence</summary><p>${g.evidence.illegal?'A matching colour was held.':'The wild draw four was legal.'}</p><div class="revealed-cards">${g.evidence.cards.map(c=>ui.card(c)).join('')}</div></details>`:''}
    <div class="social-hand-head"><span>Your hand · ${g.hand.length}</span>${bluff?`<details class="social-arrange" ${ui.arrangeOpen?'open':''}><summary>Arrange hand</summary>${handTools(room)}</details>`:''}</div>
    <div class="hand">${renderHand(room,ui.card,ui.esc,true,c=>!own || !['play','drawn'].includes(g.phase) || (!bluff && !legal(c)))}</div>
    <div class="game-actions social-actions">${controls}</div>
    ${ui.connection()}</main>${ui.footer()}`;
}

export function updateSocialSelection(room, state, esc, claimRank, root=document) {
  const bar = root.querySelector('.social-actions');
  if (!bar || room.status !== 'playing' || !['play','drawn'].includes(room.state?.phase)) return;
  for (const el of root.querySelectorAll('.hand [data-action="select-card"]')) {
    const pressed = state.selected.has(el.dataset.id);
    el.classList.toggle('selected',pressed);
    el.setAttribute('aria-pressed',String(pressed));
  }
  const name = id => esc(room.players.find(p=>p.id===id)?.name || 'Player');
  const ui = {state,esc,claimRank,name};
  bar.innerHTML = room.game==='bluff' ? bluffControls(room,ui) : colorControls(room,ui);
}

export function socialTransition(previous, room) {
  const before=previous?.state, after=room?.state;
  if (!before || !after || previous.id!==room.id || !['bluff','chromatic'].includes(room.game) || before.moves===after.moves) return null;
  if (after.round!==before.round) return {kind:'deal',sound:'deal'};
  if (room.game==='bluff') {
    if (after.reveal && after.reveal!==before.reveal && (!before.reveal || before.reveal.cards.map(c=>c.id).join() !== after.reveal.cards.map(c=>c.id).join())) return {kind:'reveal',seat:after.reveal.collector,sound:after.reveal.lied?'exposed':'honest'};
    if (after.lastPlay && after.phase==='challenge' && after.pileCount>before.pileCount) return {kind:'place',seat:after.lastPlay.player,sound:'place'};
    return null;
  }
  if (after.topCard?.id!==before.topCard?.id) {
    const value=after.topCard?.value;
    const seat=before.moves+1===after.moves?before.turn:null;
    return {kind:value==='reverse'?'reverse':'place',seat,sound:({reverse:'reverse',skip:'skip',draw2:'stack',wilddraw4:'stack',wild:'wild'}[value] || 'place')};
  }
  const seat=after.players.find(id=>after.counts[id]>before.counts[id]);
  return seat?{kind:'draw',seat,sound:'draw'}:null;
}

export function animateSocialTransition(event, root=document) {
  if (!event || !root.querySelector || !globalThis.matchMedia || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const pile=root.querySelector('[data-pile]'), deck=root.querySelector('.spectrum-deck'), seat=Array.from(root.querySelectorAll('[data-seat]')).find(el=>el.dataset.seat===event.seat);
  if (!pile?.animate) return;
  const timing={duration:310,easing:'cubic-bezier(.2,.76,.25,1)'};
  if (event.kind==='deal') {
    root.querySelectorAll('.hand .hand-card').forEach((el,i)=>el.animate([{transform:'translateY(-20px) rotate(-7deg)',opacity:.2},{transform:'none',opacity:1}],{...timing,delay:Math.min(i,9)*22}));
    return;
  }
  if (event.kind==='reveal') pile.querySelectorAll('.playing-card').forEach((c,i)=>c.animate([{transform:'perspective(400px) rotateY(86deg)'},{transform:'perspective(400px) rotateY(0deg)'}],{...timing,delay:i*45}));
  if (event.kind==='reverse') root.querySelector('.play-direction')?.animate([{transform:'rotate(-150deg)'},{transform:'rotate(0)'}],timing);
  const incoming=event.kind==='place'||event.kind==='reverse';
  const origin=incoming?seat:event.kind==='draw'?deck:pile, dest=incoming?pile:seat;
  if (!origin || !dest) return;
  const a=origin.getBoundingClientRect(), b=dest.getBoundingClientRect(), mat=pile.closest('.social-mat');
  if(!mat)return;
  const m=mat.getBoundingClientRect(), token=document.createElement('i');
  token.className='flying-card';token.setAttribute('aria-hidden','true');
  token.style.left=(a.left+a.width/2-m.left)+'px';token.style.top=(a.top+a.height/2-m.top)+'px';
  mat.append(token);
  const dx=b.left+b.width/2-a.left-a.width/2, dy=b.top+b.height/2-a.top-a.height/2;
  const flight=token.animate([{transform:'translate(-50%,-50%) rotate(-12deg) scale(.65)',opacity:0},{offset:.16,opacity:.95},{transform:`translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) rotate(8deg) scale(.8)`,opacity:0}],{...timing,delay:event.kind==='reveal'?220:0,fill:'backwards'});
  flight.onfinish=flight.oncancel=()=>token.remove();
}
