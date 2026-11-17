import { handTools, renderHand, handleExperienceAction, installHandDrag } from '/experience.js';
import { specialRoom, animateSpecialTransition, specialTransitionSound, installSpecialInput } from '/special.js';
import { socialRoom, socialTransition, animateSocialTransition, updateSocialSelection } from '/social.js';
import { portrait, installProfiles } from '/profiles.js';
import { installControls } from '/controls.js';
import { installAudio, playSound, setMix, getMix } from '/audio.js';
import { installLounge, syncLounge, refreshChat, toolbar } from '/lounge.js';
const app = document.querySelector('#app');
const modal = document.querySelector('#modal');
const state = { user: null, setupRequired: false, context: 'casual', page: 'lobby', roomId: null, room: null, lobby: null, admin: null, selected: new Set(), connected: false, authMode: 'guest', busy: false, lobbyGame: 'poker' };
let pendingInvite = new URLSearchParams(location.search).get('join') || '';
if (!/^[A-F0-9]{12}$/i.test(pendingInvite)) pendingInvite = '';
let audioPrefs = { muted: false, volume: .3 };
try { audioPrefs = { ...audioPrefs, ...JSON.parse(localStorage.getItem('venatus-sound') || '{}') }; } catch {}
const fmt = n => Number(n || 0).toLocaleString('en-IN');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const gameName = game => ({bluff:'Bluff',chromatic:'Chromatic',poker: "Texas Hold’em",ohhell:'Oh Hell',rummy:'Indian Rummy'}[game] || game);
const eventTransitions = {draft:['registration','active','canceled'],registration:['active','canceled'],active:['paused','completed','canceled'],paused:['active','completed','canceled'],completed:['archived'],canceled:['archived'],archived:[]};
const adminRole = () => ['superadmin', 'moderator', 'admin'].includes(state.user?.role);
const initials = name => String(name || '?').slice(0, 2).toUpperCase();
let socket, refreshTimeout, toastTimeout, audioContext, reconnectTimeout;
let reconnectAttempts = 0;
let claimRank = 'A';
let serverClockOffset = 0;
let savingAccount = false;

async function api(path, body) {
  const sentAt = Date.now();
  const response = await fetch(path, { credentials: 'same-origin', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
  const data = await response.json().catch(() => ({}));
  if(Number.isFinite(data.serverTime))serverClockOffset=data.serverTime-(sentAt+Date.now())/2;
  if (!response.ok) {
    if (response.status === 401 && state.user) { state.user = null; socket?.close(); renderAuth(); }
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}
function toast(message) {
  const target = document.querySelector('#toast');
  target.textContent = message; target.classList.add('show');
  clearTimeout(toastTimeout); toastTimeout = setTimeout(() => target.classList.remove('show'), 4500);
}
function sound(kind = 'tap') { playSound(kind); }
const paths = {
  S: 'M20 2C15 10 3 15 3 24a10 10 0 0 0 17 7c-1 5-3 8-7 11h14c-4-3-6-6-7-11a10 10 0 0 0 17-7C37 15 25 10 20 2Z',
  H: 'M20 40C16 35 3 25 3 14 3 1 18 0 20 10 23 0 37 1 37 14c0 11-13 21-17 26Z',
  D: 'M20 2 37 22 20 42 3 22Z',
  C: 'M20 3a9 9 0 0 0-7 15C1 12-2 30 10 31c4 0 7-2 9-5-1 7-3 12-7 16h16c-4-4-6-9-7-16 2 3 5 5 9 5 12-1 9-19-3-13a9 9 0 0 0-7-15Z'
};
function suitSvg(suit, className = '') {
  const key = ({ spades: 'S', hearts: 'H', diamonds: 'D', clubs: 'C', spade: 'S', heart: 'H', diamond: 'D', club: 'C' }[suit] || String(suit).toUpperCase());
  return `<svg class="${className}" viewBox="0 0 40 44" aria-hidden="true"><path d="${paths[key] || paths.S}"/></svg>`;
}
function card(c, interactive = false, disabled = false) {
  if (!c) return '<div class="playing-card back" aria-label="Face-down card"></div>';
  const colorCard = c.color !== undefined;
  const joker=c.rank==='JOKER';
  const rank = c.rank || c.value;
  const suit = c.suit || '';
  const red = /^(H|D|hearts?|diamonds?)$/i.test(suit);
  const selected = interactive && state.selected.has(c.id);
  const color = ({ruby:'red',emerald:'green',sapphire:'blue',gold:'yellow'}[c.color] || (['red','green','blue','yellow','wild'].includes(c.color) ? c.color : 'wild'));
  const label = joker?'Printed joker':colorCard ? `${c.color} ${rank}` : `${rank} of ${suit}`;
  const cls = `playing-card ${colorCard ? `color-${color}` : red ? 'red' : ''} ${selected ? 'selected' : ''}`;
  const tag = interactive ? 'button' : 'div';
  const value = joker?'JK':({ skip: '⊘', reverse: '↔', draw2: '+2', wild: 'W', wilddraw4: '+4' }[rank] || rank);
  return `<${tag} class="${cls}" data-card-id="${esc(c.id)}" ${interactive ? `data-action="select-card" data-id="${esc(c.id)}" aria-pressed="${selected}" ${disabled ? 'disabled' : ''}` : ''} aria-label="${esc(label)}"><span class="corner">${esc(value)}${colorCard||joker ? '' : suitSvg(suit)}</span>${joker?'<svg class="center-suit" viewBox="0 0 40 44" aria-hidden="true"><path d="M20 3 25 15 38 17 28 26 31 40 20 33 9 40 12 26 2 17 15 15Z"/></svg>':colorCard ? `<span class="center-value">${esc(value)}</span>` : suitSvg(suit, 'center-suit')}<span class="corner bottom">${esc(value)}${colorCard||joker ? '' : suitSvg(suit)}</span></${tag}>`;
}
function brand() { return '<div class="brand"><img src="/logo.png" alt="Venatus logo"><div><strong>VENATUS</strong><span>CASINO</span></div></div>'; }
function header() {
  return `<header class="topbar">${brand()}${state.user ? `<nav class="nav" aria-label="Main navigation"><button data-action="casual" class="${state.page === 'lobby' || state.page === 'room' ? 'active' : ''}">Card room</button><button data-action="events">Events</button><button data-action="navigate" data-page="history" class="${state.page === 'history' ? 'active' : ''}">Activity</button>${adminRole() ? `<button data-action="navigate" data-page="admin" class="${state.page === 'admin' ? 'active' : ''}">Control room</button>` : ''}</nav><div class="account"><button class="profile-button" data-profile aria-label="Edit your player">${portrait(state.user)}<span class="account-name">${esc(state.user.name)}</span></button>${state.user.role==='guest'?'<button class="subtle" data-action="save-guest">Save account</button>':''}<button class="subtle" data-action="logout">${state.user.role==='guest'?'Exit guest':'Sign out'}</button></div>` : ''}</header>`;
}
function footer() {
  return `<footer class="footer"><span>Venatus · Virtual chips</span>${state.user ? `<div class="sound-controls"><button data-action="mute" aria-label="${getMix().muted?'Unmute':'Mute'} sound">Sound ${getMix().muted?'off':'on'}</button><button data-lounge="settings">Display & sound</button></div>` : ''}</footer>`;
}
function renderAuth() {
  const mode = state.authMode;
  const guest = mode === 'guest';
  const invite = Boolean(pendingInvite);
  const guestForm = `<label><span>Nickname <small>(optional)</small></span><input name="name" autocomplete="nickname" maxlength="16" placeholder="What should friends call you?"></label>`;
  const credentials = `<label>Player name<input name="name" autocomplete="username" minlength="3" maxlength="24" required></label><label>Password<input name="password" type="password" autocomplete="${mode==='login'?'current-password':'new-password'}" minlength="${mode==='login'?1:12}" maxlength="128" required></label>`;
  const primary = guest ? (invite ? 'Join table as guest' : 'Play as guest') : mode==='register' ? 'Create account' : mode==='setup' ? 'Create owner account' : 'Sign in';
  app.innerHTML = `${header()}<main class="entry"><section class="entry-form">
    <h1>${guest ? invite?'Join table':'Play as guest' : mode==='login'?'Sign in':mode==='register'?'Create account':'Owner setup'}</h1>
    <div class="auth-tabs" aria-label="Entry options">${[['guest','Guest'],['login','Sign in'],['register','Register']].map(([value,label])=>`<button data-action="auth-mode" data-mode="${value}" class="${mode===value?'active':''}" aria-pressed="${mode===value}">${label}</button>`).join('')}</div>
    <form id="auth-form" class="stack">${guest?guestForm:credentials}
      ${mode==='setup'?'<label>Owner setup token<input name="token" type="password" required autocomplete="off"></label>':''}
      <p class="form-error" role="alert"></p><button class="primary" type="submit">${primary}</button>
    </form>
    <p class="entry-note">${guest?'Guest access lasts seven days in this browser. Save an account later to keep your progress.':mode==='register'?'Use at least 12 characters for your password.':mode==='setup'?'Use the token in your server configuration.':''}</p>
    ${state.setupRequired&&mode!=='setup'?'<button class="subtle small" data-action="auth-mode" data-mode="setup">Owner setup</button>':''}
  </section></main>${footer()}`;
}
function connection() { return `<span class="connection ${state.connected ? '' : 'disconnected'}"><i class="dot"></i>${state.connected ? 'Connected' : 'Reconnecting'}</span>`; }
const gameCatalog = [
  {id:'poker',name:'Poker',variant:'No-limit Hold’em',seats:'2–6'},
  {id:'chromatic',name:'Chromatic',variant:'Street UNO',seats:'2–6'},
  {id:'rummy',name:'Rummy',variant:'13-card Indian Rummy',seats:'2–6'},
  {id:'bluff',name:'Bluff',variant:'Same-rank street rules',seats:'3–6'},
  {id:'ohhell',name:'Oh Hell',variant:'Trick-taking',seats:'3–6'}
];
function availableStakes(game, event) {
  const minimum=game==='poker'?10:0;
  return event?.stakes?.filter(value=>value>=minimum) || [];
}
function tableRow(table) {
  const own=table.players?.some(p=>p.id===state.user.id && !p.left);
  const left=table.players?.some(p=>p.id===state.user.id && p.left);
  const count=table.players?.length||0, capacity=table.capacity||6;
  const ended=['finished','canceled'].includes(table.status);
  const status=ended?(table.status==='finished'?'Finished':'Closed'):table.status==='paused'?'Paused':table.joinable?'Open':count>=capacity?'Full':'In play';
  return `<tr><td><strong>${esc(table.name)}</strong>${table.private?'<small>Private table</small>':''}</td>
    <td><span class="table-status ${table.joinable?'is-open':''}">${status}</span></td>
    <td>${count}<span class="muted"> / ${capacity}</span></td><td class="number">${table.practice && table.game!=='poker'?'—':fmt(table.stake)}</td>
    <td><button data-action="join-table" data-id="${esc(table.id)}" ${left || !own && (ended||!table.joinable)?'disabled':''}>${own?(ended?'Results':'Return'):ended?'Finished':table.joinable?'Join':status}</button></td></tr>`;
}
function renderLobby() {
  const data=state.lobby;if(!data)return;
  const events=data.events||[], event=events.find(e=>e.id===state.context);
  const game=gameCatalog.find(g=>g.id===state.lobbyGame)||gameCatalog[0];
  const tables=(data.tables||[]).filter(t=>t.game===game.id && ['waiting','playing','paused'].includes(t.status));
  const settings=data.settings||{};
  const configured=settings[game.id]!==false && !settings.maintenance;
  const stakeAllowed=!event || (event.minStake!==undefined ? event.maxStake>=(game.id==='poker'?10:0) : availableStakes(game.id,event).length>0);
  const enabled=configured && stakeAllowed && (!event || event.status==='active' && event.games.includes(game.id) && data.participating);
  const reason=!configured?'Unavailable':!stakeAllowed?'Stake unavailable':event&&!event.games.includes(game.id)?'Outside event':event&&event.status!=='active'?'Event '+event.status:event&&!data.participating?'Join event to play':'';
  app.innerHTML=`${header()}<main class="layout cardroom">
    <div class="lobby-heading"><h1>${event?esc(event.name):'Card room'}</h1><div class="lobby-tools">
      <label class="sr-only" for="context">Playing mode</label><select id="context"><option value="casual">Casual play</option>${events.map(e=>`<option value="${esc(e.id)}" ${e.id===state.context?'selected':''}>${esc(e.name)}</option>`).join('')}</select>
      <button data-action="join-code">Join by code</button></div></div>
    ${settings.announcement?`<p class="announcement" role="status">${esc(settings.announcement)}</p>`:''}
    ${data.activeTable && !tables.some(t=>t.id===data.activeTable.id)?`<div class="return-strip"><span>At <strong>${esc(data.activeTable.name)}</strong> · ${gameName(data.activeTable.game)}</span><button data-action="return-table" data-id="${esc(data.activeTable.id)}">Return to table</button></div>`:''}
    ${event?`<div class="event-wallet"><div><strong>${fmt(data.wallet?.available)} chips</strong><span>${fmt(data.wallet?.reserved)} in play</span></div><span>${esc(event.status)}</span>${!data.participating?`<button class="primary" data-action="join-event" ${event.registrationOpen===false || !['registration','active'].includes(event.status)?'disabled':''}>Join event</button>`:''}</div>`:''}
    <nav class="game-picker" aria-label="Select game">${gameCatalog.map(g=>`<button data-action="lobby-game" data-game="${g.id}" aria-pressed="${g.id===game.id}" class="${g.id===game.id?'selected':''}">${g.name}</button>`).join('')}</nav>
    <div class="lobby-columns ${event?'with-standings':''}"><section class="table-browser" aria-label="${game.name} tables">
      <div class="table-browser-head"><div><h2>${game.name}</h2><p>${game.variant} · ${game.seats} players</p></div>
        <div class="table-tools"><button class="subtle" data-action="rules" data-game="${game.id}">Rules</button><button class="primary" data-action="create-table" data-game="${game.id}" ${enabled?'':'disabled'}>Create table</button></div></div>
      ${reason?`<p class="availability" role="status">${reason}</p>`:''}
      ${tables.length?`<div class="table-wrap"><table class="data-table live-tables"><thead><tr><th>Table</th><th>Status</th><th>Seats</th><th>${game.id==='poker'?'Buy-in':'Stake'}</th><th><span class="sr-only">Join table</span></th></tr></thead><tbody>${tables.map(tableRow).join('')}</tbody></table></div>`:'<div class="tables-empty"><p>No tables yet.</p><span>Create one to invite friends or play with bots.</span></div>'}
    </section>${event?`<aside class="standings"><h2>Standings</h2>${(data.leaderboard||[]).map((p,i)=>`<div class="standing-row"><span>${i+1}</span><strong>${esc(p.name)}</strong><span class="number">${fmt(p.balance)}</span></div>`).join('')||'<p>Results appear after players join.</p>'}</aside>`:''}</div>
    <div class="lobby-connection">${connection()}</div>
  </main>${footer()}`;
}
function playerName(id) { return state.room?.players?.find(p => p.id === id)?.name || 'Player'; }
function chromaticScore(g) {
  return `${g.pendingPenalty ? `<div class="penalty-banner" role="status"><strong>+${g.pendingPenalty}</strong><span>THE STACK IS GROWING<br><small>${g.penaltyKind === 'draw2' ? 'Play +2 or +4' : 'Play +4'} — or collect the stack and skip.</small></span></div>` : ''}<div class="row wrap score-strip" style="justify-content:center">Round ${g.round} · First to ${g.targetScore}${g.players.map(id=>`<span class="badge">${esc(playerName(id))}: ${g.scores[id]}</span>`).join('')}</div>${g.evidence ? `<div class="panel"><p>Private challenge evidence: ${g.evidence.illegal ? 'matching color found' : 'Wild +4 was legal'}.</p><div class="hand">${g.evidence.cards.map(c=>card(c)).join('')}</div></div>` : ''}`;
}
function chromaticControls(g, playable) {
  const own = g.turn === state.user.id && playable;
  const move = (name,label,enabled=true,target='') => `<button data-action="chromatic-action" data-move="${name}" data-target="${esc(target)}" ${enabled && playable ? '' : 'disabled'}>${label}</button>`;
  const color = `<select id="wild-color" aria-label="Wild card colour">${g.colors.map(c=>`<option value="${c}">${c}</option>`).join('')}</select>`;
  if(g.phase === 'round-end') return move('next-round','Deal next round');
  if(g.phase === 'choose-color') return color + move('choose-color','Choose starting color',own);
  let controls = '';
  if(g.phase === 'challenge') controls += move('accept','Accept +4',own)+move('challenge','Challenge +4',own);
  else controls += `<button class="primary" data-action="play-cards" ${own && state.selected.size ? '' : 'disabled'}>Play card</button>${color}` + (g.phase === 'drawn' ? move('pass','Keep card & pass',own) : `<button data-action="draw-card" ${own ? '' : 'disabled'}>${g.pendingPenalty ? `Draw ${g.pendingPenalty} & skip` : 'Draw a card'}</button>`);
  controls += move('declare','One card!',g.canDeclare);
  if(g.catchablePlayer && g.catchablePlayer !== state.user.id) controls += move('catch',`Catch ${esc(playerName(g.catchablePlayer))}`,true,g.catchablePlayer);
  return controls;
}
function hostControls(room) {
  if(room.host!==state.user.id)return '';
  return `<div class="host-controls">${room.state&&room.code?'<button data-action="copy-link">Copy invite</button>':''}
    ${room.practice?`<div class="host-bots"><label class="sr-only" for="host-bot-difficulty">Bot difficulty</label><select id="host-bot-difficulty">${['easy','medium','hard'].map(level=>`<option value="${level}" ${level===(room.botDifficulty||'medium')?'selected':''}>${level[0].toUpperCase()+level.slice(1)} bots</option>`).join('')}</select>
    <button data-action="host-operation" data-operation="add-bot" ${room.players.length>=(room.capacity||6)?'disabled':''}>Add bot</button>
    <button data-action="host-operation" data-operation="fill-bots" ${room.players.length>=(room.capacity||6)?'disabled':''}>Fill seats</button></div>`:''}
    <button class="subtle" data-action="close-table">Close table</button></div>`;
}
function waitingRoom(room) {
  const min=['bluff','ohhell'].includes(room.game)?3:2, host=room.host===state.user.id;
  return `${header()}<main class="layout waiting-room"><div class="room-top"><div><button class="subtle" data-action="navigate" data-page="lobby">← Lobby</button><h1>${esc(room.name)}</h1><p>${gameName(room.game)}${room.game==='poker'?' · '+fmt(room.stake)+' chips':''}</p></div><button data-action="leave-table">Leave table</button></div>
    <div class="waiting-columns"><section><div class="section-head"><h2>Players</h2><span>${room.players.length} / ${room.capacity||6}</span></div>
    <ul class="player-roster">${room.players.map(p=>`<li>${portrait(p)}<strong>${esc(p.name)}</strong><span>${p.id===room.host?'Host':p.bot?'Bot':p.online===false?'Offline':'Ready'}</span>${host&&p.bot?`<button class="subtle" data-action="host-operation" data-operation="remove-bot" data-id="${esc(p.id)}" aria-label="Remove ${esc(p.name)}">Remove</button>`:''}</li>`).join('')}</ul>${hostControls(room)}</section>
    <aside class="invite-controls"><h2>Invite players</h2><button class="primary" data-action="copy-link">Copy invite link</button><div class="invite-code"><span class="room-code">${esc(room.code)}</span><button class="subtle" data-action="copy-code">Copy code</button></div>
    <div class="start-controls">${host?`<button class="primary" data-action="start-table" ${room.players.length<min?'disabled':''}>Deal the cards</button>${room.players.length<min?`<p>Add ${min-room.players.length} more player${min-room.players.length===1?'':'s'} to start.</p>`:''}`:'<p>Waiting for the host to deal.</p>'}</div></aside></div>${connection()}</main>${footer()}`;
}
function renderRoom() {
  const room = state.room; if (!room) return;
  state.selected=new Set([...state.selected].filter(id=>room.state?.hand?.some(c=>c.id===id) &&
    (!['chromatic','ohhell'].includes(room.game) || !room.state.legalCardIds || room.state.legalCardIds.includes(id))));
  if (room.status === 'canceled') {
    app.innerHTML = `${header()}<main class="layout"><div class="eyebrow">Table closed</div><h1>${esc(room.name)}</h1><p>${room.practice?'This casual table is closed. No wallet chips were used.':'The match was canceled. Your chips have been returned to your wallet; completed poker hands retain their results.'}</p><button class="primary" data-action="navigate" data-page="lobby">Return to the casino</button></main>${footer()}`;
    return;
  }
  if(!room.state && room.status==='waiting') {app.innerHTML=waitingRoom(room);return;}
  if (room.state && (room.game==='bluff' || room.game==='chromatic' && room.state.rulesVersion===2)) {
    const arrangeOpen = Boolean(document.querySelector('.social-arrange')?.open);
    app.innerHTML=socialRoom(room,{state,card,esc,fmt,header,footer,connection,gameName,claimRank,arrangeOpen});
    updateTimer();return;
  }
  if (room.state && ['poker','ohhell','rummy'].includes(room.game)) { app.innerHTML = specialRoom(room,{state,card,esc,fmt,header,footer,connection,gameName,hostControls}); updateTimer(); return; }
  const game = room.state;
  const waiting = !game;
  const myTurn = game?.turn === state.user.id && ['play','drawn'].includes(game?.phase) && room.status === 'playing';
  const min = ['bluff','ohhell'].includes(room.game) ? 3 : 2;
  const selectedIds = new Set((game?.hand || []).map(c => c.id));
  state.selected = new Set([...state.selected].filter(id => selectedIds.has(id)));
  const finished = game?.phase === 'finished';
  const playable = game && !finished && room.status === 'playing';
  const challenge = playable && game.phase === 'challenge' && game.turn !== state.user.id;
  app.innerHTML = `${header()}<main class="layout game-room game-${room.game}"><div class="room-top"><div><button class="subtle" data-action="navigate" data-page="lobby" style="padding-left:0">← Back to the casino</button><div class="eyebrow">${gameName(room.game)} · ${room.practice ? 'CASUAL · Table chips only' : room.context === 'casual' ? 'Casual room' : 'Event room'}</div><h2>${esc(room.name)}</h2></div><div class="room-meta">${room.practice?(room.game==='poker'?`<span>Starting stack <strong>${fmt(room.stake)}</strong></span>`:'<span>Scoring only</span>'):`<span>Ante <strong>${fmt(room.stake)}</strong></span>`}<button class="subtle" data-action="rules" data-game="${room.game}">Rules</button><button data-action="leave-table">Leave table</button></div></div>${room.status === 'canceled' ? '<div class="win-banner">This table was canceled. Stakes were returned.</div>' : ''}${room.status === 'paused' ? '<div class="win-banner">The host has paused this table.</div>' : ''}${finished ? `<div class="win-banner">${!game.winner ? 'The round is a draw. Stakes returned.' : game.winner === state.user.id ? 'A hand beautifully played. You win.' : `${esc(playerName(game.winner))} takes the pot.`} <span class="small">${fmt(room.pot)} chips</span></div>` : ''}<section class="felt"><div class="seats">${room.players.map(p => `<div class="seat ${game?.turn === p.id && !finished ? 'active' : ''}"><div class="avatar">${esc(initials(p.name))}</div><div class="seat-name">${esc(p.name)}${p.id === state.user.id ? ' · You' : ''}${p.bot ? ' · Bot' : p.left ? ' · Autoplay' : p.online===false && p.id!==state.user.id ? ' · Offline' : ''}</div><div class="seat-count">${waiting ? p.id === room.host ? 'TABLE HOST' : 'READY TO PLAY' : `${game.counts?.[p.id] ?? 0} CARDS`}</div></div>`).join('')}</div>${waiting ? `<div class="waiting-center"><h2>Good company is on its way.</h2><p>${room.players.length} of ${room.capacity||6} seats taken. ${Math.max(0, min - room.players.length)} more needed to deal.</p>${room.code ? `<p>Invite friends with room code</p><div class="room-code">${esc(room.code)}</div><button class="subtle small" data-action="copy-code">Copy code</button><button class="subtle small" data-action="copy-link">Copy invite link</button>` : '<p>Friends can find this table in the lobby.</p>'}${room.host === state.user.id ? `${hostControls(room)}<div><button class="primary" data-action="start-table" ${room.players.length < min ? 'disabled' : ''}>Deal the cards</button></div>` : '<p>Waiting for the host to deal.</p>'}</div>` : `<div class="table-center"><div class="pile">${game.topCard ? card(game.topCard) : card(null) + card(null)}</div><div>${room.practice?'':`<div class="pot-label">The pot</div><div class="pot-value number">${fmt(room.pot)}</div>`}<div class="declaration">${room.game === 'bluff' ? `${fmt(game.pileCount)} cards in the pile<br>Rank stays <strong>${esc(game.requiredRank || 'your choice')}</strong>${game.lastPlay ? `<p class="claim">${esc(playerName(game.lastPlay.player))} claims ${game.lastPlay.count} × ${esc(game.lastPlay.rank)}</p>` : ''}` : `Current colour: <strong>${esc(game.activeColor || game.topCard?.color || '')}</strong><p>${game.direction===-1?'← Counterclockwise':'Clockwise →'}</p>`}</div></div></div>`}<div class="table-watermark">VENATUS CASINO</div></section>${game ? `<div class="turn-bar"><strong>${finished ? 'Round complete' : room.status === 'paused' ? 'Play paused' : game.phase === 'challenge' ? 'Believe it. Or call their bluff.' : myTurn ? 'Your hand. Your move.' : `${esc(playerName(game.turn))} is thinking.`}</strong>${!finished ? `<span class="timer" data-deadline="${Number(game.deadline) || 0}"></span>` : ''}<p>${esc(game.message || '')}</p>${game.reveal?.cards?.length ? `<section class="bluff-verdict" aria-live="polite"><strong>${game.reveal.lied ? "Caught bluffing" : "The cards were honest"}</strong><p>${esc(playerName(game.reveal.collector))} collects the pile.</p><div class="reveal">${game.reveal.cards.map(c => card(c)).join('')}</div></section>` : ''}</div>${room.game === 'chromatic' && game.rulesVersion === 2 ? chromaticScore(game) : ''}${handTools(room)}<div class="hand-label">Your hand · ${game.hand?.length || 0} cards${room.game === 'chromatic' && myTurn ? ' · Matching cards are available to select' : ''}</div><div class="hand">${renderHand(room,card,esc,true,c=>!myTurn || (room.game === 'chromatic' && (game.rulesVersion === 2 ? !game.legalCardIds.includes(c.id) : c.color !== 'wild' && c.color !== game.activeColor && c.value !== game.topCard?.value)))}</div><div class="game-actions">${finished ? `${room.practice && room.host===state.user.id?'<button class="primary" data-action="rematch">Play again</button>':''}<button data-action="leave-table">Leave table</button>` : room.game === 'chromatic' && game.rulesVersion === 2 ? chromaticControls(game, playable) : `<button class="primary" data-action="play-cards" ${myTurn && state.selected.size ? '' : 'disabled'}>${room.game === 'bluff' ? `Play ${state.selected.size || ''} card${state.selected.size === 1 ? '' : 's'}` : 'Play card'}</button>${room.game === 'chromatic' ? `<select id="wild-color" aria-label="Wild card colour"><option value="ruby">Ruby</option><option value="emerald">Emerald</option><option value="sapphire">Sapphire</option><option value="gold">Gold</option></select><button data-action="draw-card" ${myTurn ? '' : 'disabled'}>Draw a card</button>` : `<label>Declare rank <select id="bluff-rank" ${!myTurn || game.requiredRank ? 'disabled' : ''}>${(game.ranks || [game.requiredRank]).map(rank => `<option ${rank === game.requiredRank ? 'selected' : ''}>${esc(rank)}</option>`).join('')}</select></label><button data-action="bluff-skip" ${myTurn ? '' : 'disabled'}>Skip turn</button><button class="danger" data-action="challenge" ${challenge ? '' : 'disabled'}>Call bluff</button>`}`}</div>` : ''}<div class="row between"><span class="small muted">${room.practice ? 'Casual table · No wallet rewards or losses.' : waiting ? 'Your ante is reserved until the match starts.' : 'Your committed chips settle when the match ends.'}</span>${connection()}</div></main>${footer()}`;
  updateTimer();
}
function renderEvents() {
  const events=state.lobby?.events||[];
  app.innerHTML=`${header()}<main class="layout event-index"><h1>Casino events</h1>${events.length?events.map(e=>`<article class="event-row"><div><h2>${esc(e.name)}</h2><p>${e.startsAt?esc(new Date(e.startsAt).toLocaleString()):'Host starts the event'} · ${e.participants||0} players</p>${e.description?`<p>${esc(e.description)}</p>`:''}</div><span>${esc(e.status)}</span><button data-action="open-event" data-id="${esc(e.id)}">${['completed','canceled','archived'].includes(e.status)?'Results':'Open'}</button></article>`).join(''):'<p class="tables-empty">No events scheduled.</p>'}</main>${footer()}`;
}
function renderHistory() {
  const history=state.lobby?.history||[];
  app.innerHTML=`${header()}<main class="layout history"><h1>Your activity</h1>${history.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>Table</th><th>Result</th><th>Chips</th><th>Date</th></tr></thead><tbody>${history.map(h=>`<tr><td>${esc(h.name)}<small>${gameName(h.game)}</small></td><td>${h.status==='canceled'?'Closed':h.state?.winner===state.user.id?'Won':h.state?.winner?'Lost':'Finished'}</td><td class="number">${h.practice?'—':fmt(h.payout)}</td><td>${h.finished?esc(new Date(h.finished).toLocaleDateString()):'—'}</td></tr>`).join('')}</tbody></table></div>`:'<p class="tables-empty">No completed games yet.</p>'}</main>${footer()}`;
}
function renderAdmin() {
  const data = state.admin; if (!data) return;
  const stats = data.stats || {}, settings = data.settings || {};
  const owner = state.user.role === 'superadmin';
  app.innerHTML = `${header()}<main class="layout"><div class="section-head"><div><div class="eyebrow">${owner ? 'Super Admin' : 'Moderation'} · Control room</div><h2>Control room</h2></div><button data-action="refresh-admin">Refresh dashboard</button><a href="/api/admin/export?context=${encodeURIComponent(state.context)}">Export results ↗</a></div><div class="stat-grid">${[['Registered players', stats.users], ['Players online', stats.online], ['Active tables', stats.tables], ['Completed matches', stats.matches]].map(([label, value]) => `<div class="stat"><div class="value number">${fmt(value)}</div><div class="label">${label}</div></div>`).join('')}</div><div class="admin-grid"><section class="panel"><h2>Create event</h2>${owner ? '<form id="event-form" class="stack event-form"><label class="full-width">Event name<input name="name" required maxlength="80" placeholder="Friday at the card room"></label><label>Starting chips<input name="startingChips" type="number" min="100" max="1000000" step="1" value="10000" required></label><label>Stake presets (comma separated)<input name="stakes" value="100,250,500" required></label><label>Minimum stake<input name="minStake" type="number" min="0" max="100000" placeholder="Use presets only"></label><label>Maximum stake<input name="maxStake" type="number" min="0" max="100000" placeholder="Use presets only"></label><label class="full-width">Description<input name="description" maxlength="1000" placeholder="Tell players about the event"></label><label>Participant limit (optional)<input name="participantLimit" type="number" min="2" max="10000" placeholder="Unlimited"></label><label>Automatic start (local time)<input name="startsAt" type="datetime-local"></label><label>Automatic end (local time)<input name="endsAt" type="datetime-local"></label><p class="small full-width">Open registration to arm the schedule. Leave times blank to start and end manually.</p><label class="check"><input type="checkbox" name="bluff" checked> Bluff</label><label class="check"><input type="checkbox" name="chromatic" checked> Chromatic</label><label class="check"><input type="checkbox" name="poker" checked> Poker</label><label class="check"><input type="checkbox" name="ohhell" checked> Oh Hell</label><label class="check"><input type="checkbox" name="rummy" checked> Rummy</label><p class="form-error full-width" role="alert"></p><button class="primary full-width">Create event</button></form>' : '<p class="small">Event creation is managed by the owner.</p>'}</section><section class="panel"><h2>House settings</h2>${owner ? `<form id="settings-form" class="stack"><label>Starting casual chips<input name="startingChips" type="number" min="100" max="1000000" value="${Number(settings.startingChips) || 10000}" required></label><label class="check"><input type="checkbox" name="bluff" ${settings.bluff !== false ? 'checked' : ''}> Open Bluff tables</label><label class="check"><input type="checkbox" name="chromatic" ${settings.chromatic !== false ? 'checked' : ''}> Open Chromatic tables</label>${['poker','ohhell','rummy'].map(g=>`<label class="check"><input type="checkbox" name="${g}" ${settings[g] !== false ? 'checked' : ''}> Open ${gameName(g)} tables</label>`).join('')}<label>Lobby announcement<input name="announcement" maxlength="400" value="${esc(settings.announcement || '')}" placeholder="A message for the club"></label><label class="check"><input type="checkbox" name="maintenance" ${settings.maintenance ? 'checked' : ''}> Maintenance mode</label><p class="form-error" role="alert"></p><button>Save house settings</button></form>` : '<p class="small">House settings are managed by the owner.</p>'}</section></div><section class="panel admin-wide"><h2>Events</h2>${(data.events || []).map(e => `<div class="admin-event"><div>${esc(e.name)}<p class="small" style="margin:5px 0 0">${fmt(e.startingChips)} starting chips · ${esc(e.status)} · ${e.participants || 0}${e.participantLimit ? " / " + e.participantLimit : ""} participants</p><p class="small">${e.startsAt ? "Starts " + esc(new Date(e.startsAt).toLocaleString()) : "Manual start"} · ${e.endsAt ? "Ends " + esc(new Date(e.endsAt).toLocaleString()) : "Manual end"}</p></div>${owner ? `<button data-action="configure-event" data-id="${esc(e.id)}" ${['completed','canceled','archived'].includes(e.status)?'disabled':''}>Schedule & registration</button><select class="event-status" data-id="${esc(e.id)}" aria-label="Status of ${esc(e.name)}">${[e.status,...(eventTransitions[e.status] || [])].map(s => `<option ${s === e.status ? 'selected' : ''}>${s}</option>`).join('')}</select>` : ''}</div>`).join('') || '<p class="small">No events yet. Casual games remain available independently.</p>'}</section><section class="panel admin-wide"><div class="section-head"><h2>Players</h2><input id="player-search" placeholder="Find a player" aria-label="Find a player" style="max-width:240px"></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Player</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody>${(data.users || []).map(u => `<tr data-player-name="${esc(u.name.toLowerCase())}"><td>${esc(u.name)}</td><td>${esc(u.role)}</td><td>${u.banned ? 'Banned' : 'Active'}</td><td><button data-action="manage-player" data-id="${esc(u.id)}" ${u.role === 'superadmin' ? 'disabled' : ''}>Manage</button></td></tr>`).join('')}</tbody></table></div></section><section class="panel admin-wide"><h2>Tables</h2><div class="table-wrap"><table class="data-table"><thead><tr><th>Table</th><th>Game</th><th>Status</th><th>Actions</th></tr></thead><tbody>${(data.tables || []).filter(t => ['waiting','playing','paused'].includes(t.status)||t.practice&&t.status==='finished').map(t => `<tr><td>${esc(t.name)}</td><td>${gameName(t.game)}</td><td>${esc(t.status)}</td><td><div class="row"><button data-action="admin-table" data-id="${esc(t.id)}" data-operation="${t.status === 'paused' ? 'resume' : 'pause'}" ${t.status === 'waiting' ? 'disabled' : ''}>${t.status === 'paused' ? 'Resume' : 'Pause'}</button><button class="danger" data-action="admin-table" data-id="${esc(t.id)}" data-operation="cancel">Cancel & refund</button></div></td></tr>`).join('')}</tbody></table></div>${!data.tables?.length ? '<p class="small">No tables to manage.</p>' : ''}</section><div class="admin-grid admin-wide"><section class="panel"><h2>Chip circulation</h2>${(stats.chips || []).map(c => `<div class="admin-event"><span class="small">${esc(c.context)}</span><span class="gold number">${fmt(c.total)}</span></div>`).join('') || '<p class="small">No wallet balances yet.</p>'}<h3 style="margin-top:24px">Ledger</h3>${(data.ledger || []).slice(0, 15).map(l => `<div class="audit-row"><span class="gold">${Number(l.delta) >= 0 ? '+' : ''}${fmt(l.delta)}</span> · ${esc(l.reason)}<br><small>${esc(l.context)} · ${esc(l.reference || '')}</small></div>`).join('')}</section><section class="panel"><h2>Audit trail</h2>${(data.audit || []).slice(0, 25).map(a => `<div class="audit-row">${esc(a.action)} · ${esc(a.target || '')}<br><small>${esc(new Date(a.at).toLocaleString())} · ${esc(typeof a.detail === 'object' ? JSON.stringify(a.detail) : a.detail || '')}</small></div>`).join('') || '<p class="small">Administrative actions will appear here.</p>'}</section></div></main>${footer()}`;
}
function render() { if (state.user && state.page==='events') { renderEvents(); return; } if (!state.user) renderAuth(); else if (state.page === 'room') renderRoom(); else if (state.page === 'admin') renderAdmin(); else if (state.page === 'history') renderHistory(); else renderLobby(); }
let refreshing = false, needsRefresh = false;
function applyRoom(room) {
  if(state.page!=='room' || state.roomId!==room.id)return;
  if(state.room?.id===room.id && state.room.version>room.version)return;
  const previous=state.room;
  const alreadyRendered=Boolean(document.querySelector('.game-room'));
  const unchanged=previous?.id===room.id && previous.version===room.version;
  state.room=room;state.context=room.context;
  syncLounge(previous,room);
  if(unchanged && alreadyRendered && JSON.stringify(previous.players)===JSON.stringify(room.players))return;
  const scroll=document.querySelector('.hand')?.scrollLeft||0;
  const oldInput=document.querySelector('#bet-amount');
  const wager=oldInput?.value, focused=document.activeElement?.id;
  const sameTurn=previous?.id===room.id && previous.state?.turn===room.state?.turn && previous.state?.phase===room.state?.phase;
  renderRoom();
  const newInput=document.querySelector('#bet-amount');
  if(sameTurn && newInput && wager!==undefined) {
    newInput.value=wager;
    if(!newInput.validity.valid)newInput.value=newInput.min;
    document.querySelector('#bet-slider').value=newInput.value;
    if(focused==='bet-amount'||focused==='bet-slider')document.getElementById(focused)?.focus({preventScroll:true});
  }
  const hand=document.querySelector('.hand');if(hand)hand.scrollLeft=scroll;
  if (!unchanged) {
    const event=socialTransition(previous,room);
    const cue=event?.sound || specialTransitionSound(previous,room);
    if(previous?.id===room.id && previous.state?.winner!==room.state?.winner && room.state?.winner===state.user.id)sound('win');
    else if(cue)sound(cue);
    else if(previous?.id===room.id && previous.state?.turn!==room.state?.turn && room.state?.turn===state.user.id)sound('turn');
    animateSocialTransition(event);
    if(['poker','ohhell','rummy'].includes(room.game))animateSpecialTransition(previous,room);
  }
}
async function refresh() {
  if (!state.user || savingAccount) return;
  if (refreshing) { needsRefresh=true; return; }
  refreshing=true;
  const page=state.page, roomId=state.roomId, context=state.context;
  try {
    if (page==='room' && roomId) {
      const room=await api(`/api/tables/${encodeURIComponent(roomId)}`);
      if(state.page!==page || state.roomId!==roomId)return;
      applyRoom(room);
    } else {
      const data=page==='admin'?await api('/api/admin'):await api(`/api/lobby?context=${encodeURIComponent(context)}`);
      if(state.page!==page || state.context!==context)return;
      if(page==='admin')state.admin=data;else state.lobby=data;
      render();
    }
  } catch(error) { toast(error.message); }
  finally {refreshing=false;if(needsRefresh){needsRefresh=false;refresh();}}
}
function connect() {
  if (!state.user) return;
  clearTimeout(reconnectTimeout);
  socket?.close();
  const current = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
  socket = current;
  current.addEventListener('open', () => {
    if (socket !== current) return;
    reconnectAttempts = 0; state.connected = true; updateConnection(); refresh();
  });
  current.addEventListener('message', event => { const message=JSON.parse(event.data); if(message.type==='chat'){if(message.roomId===state.roomId)refreshChat();return;} if (socket !== current) return; if (state.page === 'admin') { const control = document.querySelector('[data-action=refresh-admin]'); if (control) control.textContent = 'Updates available · Refresh'; return; } clearTimeout(refreshTimeout); refreshTimeout = setTimeout(refresh, 80); });
  current.addEventListener('close', () => {
    if (socket !== current) return;
    state.connected = false; updateConnection();
    if (state.user) reconnectTimeout = setTimeout(connect, Math.min(15000,1000 * 2 ** Math.min(reconnectAttempts++,4)) + Math.random()*500);
  });
  current.addEventListener('error', () => {});
}
function updateConnection() { document.querySelectorAll('.connection').forEach(el => { el.classList.toggle('disconnected', !state.connected); el.innerHTML = `<i class="dot"></i>${state.connected ? 'Connected' : 'Reconnecting'}`; }); }
function updateTimer() {
  document.querySelectorAll('[data-deadline]').forEach(el => {
    const secs=Math.max(0,Math.ceil((Number(el.dataset.deadline)-Date.now()-serverClockOffset)/1000));
    const paused=state.room?.status==='paused';
    const p=state.room?.state?.presentation,now=Date.now()+serverClockOffset;
    el.textContent=paused?'Paused':p&&now>=p.minimumUntil?(p.manual?'Your pace':`${Math.max(0,Math.ceil((p.maximumUntil-now)/1000))}s`):`${secs}s`;
    el.classList.toggle('time-short',!paused && secs<=8);
    el.setAttribute('aria-label',paused?'Timer paused':`${secs} seconds remaining`);
  });
}
setInterval(updateTimer, 500);
function openModal(title, content) { modal.innerHTML = `<div class="modal-head"><h2>${title}</h2><button class="close" data-action="close-modal" aria-label="Close dialog">×</button></div>${content}`; modal.showModal(); }
function rules(game) {
  if (game === 'bluff') return openModal('Bluff · Street rules','<p>Choose a rank to open the pile. Select 1–4 cards and declare that many cards of the chosen rank, then play them face-down. You may tell the truth or bluff.</p><p>Everyone keeps declaring the same rank. On your turn, play or skip. After all players skip consecutively, the pile is cleared and the next player chooses a new rank.</p><p>After each play, other players have eight seconds to call bluff. A liar collects the whole pile; if the declaration was honest, the challenger collects it. Either challenge outcome resets the rank. The player after the declarer starts again.</p><p>Your final cards must survive the challenge window before you win the pot. A timed-out turn skips automatically.</p>');
  if (game === 'chromatic') return openModal('Chromatic · Street rules','<p>Match the colour or symbol. Reverse changes direction, Skip jumps a player, and Wild chooses the colour.</p><p><strong>Stack +2 on +2. Stack +4 on +2 or +4.</strong> You cannot put +2 on +4. If you cannot or do not want to stack, collect the total penalty and miss your turn. Street Wild +4 has no legality challenge.</p><p>Declare “One card!” as you play down to one. Opponents can catch a missed declaration for a two-card penalty. Normal draws allow you to play the drawn card if it matches, or keep it and pass.</p><p>First to play their last card wins this single-round match. A final penalty card makes the next player draw before round points are counted.</p>');
  const extra = {
    poker: '<p>No-limit Texas Hold’em for 2–6 players. Your buy-in becomes your table stack. Two private cards and five community cards form your best five-card hand.</p><ul><li>Small blind is 1% of the buy-in, rounded down (minimum 1); big blind is twice that. Raise amounts are total wagers for the current street.</li><li>All-ins create side pots. Short all-ins do not automatically reopen betting. Tied pots split, with odd chips awarded clockwise after the dealer.</li><li>Sessions last up to 10 hands. Any player can request cash-out after the current hand or cash out between hands. Each remaining stack returns to its owner.</li><li>Timeout checks when possible, otherwise folds. Cancellation refunds the interrupted hand’s bets and preserves completed hand results.</li></ul>',
    ohhell: '<p>Oh Hell for 3–6 players. Nine rounds deal 1, 2, 3, 4, 5, 4, 3, 2, then 1 card. The exposed card determines trump.</p><ul><li>Bid your expected tricks. The dealer bids last and cannot make the total bids equal the number of tricks.</li><li>Follow the led suit when you can. Highest trump wins; otherwise highest card of the led suit wins. The winner leads next.</li><li>An exact bid earns 10 plus the bid; a miss earns zero. Highest final score wins. Tied leaders split the pot; odd chips follow seating order.</li></ul>',
    rummy: '<p>13-card Indian Rummy for 2–6 players using two decks and four printed jokers. The indicator rank is also wild.</p><ul><li>Draw from stock or the discard pile, then discard one card. A discarded joker cannot be picked up.</li><li>Declare by selecting a discard that leaves all 13 cards in valid sets or sequences, including at least two sequences and one pure sequence. Aces may be low or high, without wrapping.</li><li>Check my groups privately finds a valid grouping or calculates penalty points. Invalid declarations are rejected.</li><li>Dropping before your first draw costs 20 penalty points; later drops cost 40. Other penalties are capped at 80. A valid declaration wins the round. Event tables award the pot to the winner.</li></ul>'
  };
  if (extra[game]) return openModal(`${gameName(game)} · The rules`, extra[game] + '<p>Free chips have no monetary value. Waiting rooms expire after 30 minutes; unresolved sessions are canceled after one hour.</p>');
  const bluff = '<p>A classic game of nerve for 3–6 players.</p><ul><li>All 52 cards are dealt. On your turn, play 1–4 cards face down, declaring the rank shown by the table. You may tell the truth—or bluff.</li><li>The declared rank moves from Ace through King, then returns to Ace.</li><li>After every play, other players have 8 seconds to call bluff. If any played card differs from the declared rank, the player takes the pile. Otherwise the challenger takes it.</li><li>Your last card must survive the challenge window before you win. The winner takes the entire pot.</li><li>On a turn timeout, the server plays a card for the absent player. Rejoin with the same account to recover your hand.</li></ul>';
  const chromatic = '<p>Classic UNO rules, with original Chromatic artwork. 2–6 players; seven cards each; first to 500 points wins the match and pot.</p><ul><li>Match color or value, or play a wild. A playable drawn card can be played immediately; no other card can be played after drawing. You may keep it and pass.</li><li>No stacking, jump-in, or 7–0 swaps. Two-player Reverse skips the opponent.</li><li>Wild +4 is legal only without a matching color. The recipient may challenge: guilty player draws four, otherwise challenger draws six. Evidence is private to the challenger.</li><li>Use One card! before playing down to one, or immediately afterward. Another player can catch a missed call for two penalty cards before the next turn begins.</li><li>Round winners score remaining numbers at face value, action cards at 20 and wilds at 50. Final draw penalties count before scoring. The next round starts after 15 seconds.</li></ul>';
  openModal(`${gameName(game)} · The rules`, `${game === 'bluff' ? bluff : chromatic}<p>Chips are free and have no monetary value. An administrator can cancel a disrupted match and refund its stakes. Waiting rooms expire after 30 minutes; unresolved matches are refunded after one hour from the deal.</p>`);
}
function createTable(game) {
  const event=state.lobby?.events?.find(e=>e.id===state.context);
  const min=Math.max(game==='poker'?10:0,event?.minStake||0);
  const presets=availableStakes(game,event);
  if(event && (event.maxStake!==undefined?event.maxStake<min:!presets.length))return toast('This event has no available stake for this game.');
  const minimumSeats=['bluff','ohhell'].includes(game)?3:2;
  const stake=event || game==='poker' ? `<label>${game==='poker'?(event?'Buy-in':'Starting stack'):'Stake'}<span class="input-unit">
    ${event && event.minStake===undefined?`<select name="stake">${presets.map(n=>`<option value="${n}">${fmt(n)}</option>`).join('')}</select>`:`<input name="stake" type="number" min="${min}" max="${event?.maxStake??100000}" value="${event?min:250}" step="1" required>`}<span>chips</span></span></label>`:'<input name="stake" type="hidden" value="0">';
  openModal('Create '+gameName(game),`<form id="create-table-form" class="stack">
    <input type="hidden" name="game" value="${game}">
    <label>Table name<input name="name" value="${esc(state.user.name)}’s table" maxlength="48" required></label>
    <div class="form-pair"><label>Seats<select name="capacity">${Array.from({length:7-minimumSeats},(_,i)=>i+minimumSeats).map(n=>`<option value="${n}" ${n===6?'selected':''}>${n}</option>`).join('')}</select></label>${stake}</div>
    ${!event?`<label>Bots<select name="bots"><option value="0">None</option>${[1,2,3,4,5].map(n=>`<option value="${n}">${n}</option>`).join('')}</select></label>`:''}
    ${game==='poker'?'<details class="setup-options"><summary>Set blinds</summary><div class="form-pair"><label>Small blind<input name="smallBlind" type="number" min="1" max="99999" placeholder="Auto"></label><label>Big blind<input name="bigBlind" type="number" min="2" max="100000" placeholder="Auto"></label></div></details>':''}
    <label>Table pace<select name="pace"><option value="relaxed">Relaxed</option><option value="standard" selected>Standard</option><option value="quick">Quick</option></select></label><label class="check"><input type="checkbox" name="private"> Private table · invite link required</label>
    <p class="form-error" role="alert"></p><button class="primary">Create table</button>
  </form>`);
}
function managePlayer(id) {
  const user = state.admin.users.find(u => u.id === id); if (!user) return;
  if (user.role === 'superadmin') { toast('The owner account is protected from changes here.'); return; }
  const owner = state.user.role === 'superadmin';
  openModal(`Manage ${esc(user.name)}`, `<form id="manage-player-form" data-id="${esc(id)}" class="stack"><label class="check"><input type="checkbox" name="banned" ${user.banned ? 'checked' : ''}> Ban this player</label><label class="check"><input type="checkbox" name="revoke"> Revoke all sessions</label>${owner ? `${user.role!=='guest'?`<label>Role<select name="role">${['player', 'moderator'].map(r => `<option ${user.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select></label>`: ''}<label>Chip adjustment (optional)<input name="adjustment" type="number" step="1" placeholder="Positive to issue, negative to remove"></label><label>Wallet context<select name="context"><option value="casual">Casual</option>${(state.admin.events || []).map(e => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('')}</select></label>` : ''}<label>Reason<input name="reason" required maxlength="200" placeholder="Recorded in the audit trail"></label><p class="small">Changes are recorded. A ban or session revocation will affect the player’s access.</p><p class="form-error" role="alert"></p><button class="primary">Confirm changes</button></form>`);
}
async function enterRoom(id) { state.roomId = id; state.page = 'room'; state.selected.clear(); await refresh(); }
async function submitAction(action) {
  if (state.busy) return;
  state.busy=true;
  document.querySelectorAll('.game-actions button, .pile-action, .spectrum-deck').forEach(b=>b.disabled=true);
  app.setAttribute('aria-busy','true');
  try {
    const room = await api(`/api/tables/${encodeURIComponent(state.roomId)}/action`, {actionId:crypto.randomUUID(),expectedVersion:state.room.version,action});
    if(['play','discard','draw','drop','next-round','next-hand','cashout','fold'].includes(action.type))state.selected.clear();
    applyRoom(room);
  } catch(error) {
    if(state.page==='room')renderRoom();
    throw error;
  } finally {state.busy=false;app.removeAttribute('aria-busy');}
}
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]'); if (!button || button.disabled) return;
  const action = button.dataset.action;
  try {
    if(handleExperienceAction(button,state.room,state.selected,renderRoom)) return;
    if(action==='lobby-game') {state.lobbyGame=button.dataset.game;renderLobby();}
    else if(action==='return-table') await enterRoom(button.dataset.id);
    else if(action==='events') { state.page='events'; state.context='casual'; await refresh(); }
    else if(action==='open-event') { state.context=button.dataset.id; state.page='lobby'; await refresh(); }
    else if(action==='casual') { state.context='casual'; state.page='lobby'; await refresh(); }
    else if (action === 'refresh-admin') await refresh();
    else if (action === 'reload') location.reload();
    else if (action === 'auth-mode') { state.authMode = button.dataset.mode; renderAuth(); }
    else if (action === 'close-modal') modal.close();
    else if (action === 'accept-event-invite') { button.disabled=true; try { await joinByCode(button.dataset.code, true); } finally {button.disabled=false;} }
    else if (action === 'navigate') { state.page = button.dataset.page; await refresh(); }
    else if (action === 'save-guest') {
      openModal('Save your guest seat', '<form id="save-guest-form" class="stack"><p>Choose a player name and password to keep this seat, your event chips and your history across devices.</p><label>Player name<input name="name" minlength="3" maxlength="24" required autocomplete="username"></label><label>Password<input name="password" type="password" minlength="12" maxlength="128" required autocomplete="new-password"></label><p class="form-error" role="alert"></p><button class="primary" type="submit">Save account</button></form>');
    } else if (action === 'logout' && state.user?.role==='guest') {
      openModal('End guest session?', '<p>Ending this session gives up access to this guest seat and its event chips. To keep them, close this dialog and choose Save account.</p><button data-action="confirm-logout">End guest session</button>');
    } else if (action === 'logout' || action === 'confirm-logout') {
      await api('/api/logout', {}); location.assign('/');
    }
    else if (action === 'rules') rules(button.dataset.game);
    else if (action === 'create-table') createTable(button.dataset.game);
    else if (action === 'join-code') openModal('Join by code', '<form id="join-code-form" class="stack"><label>Room code<input name="code" required maxlength="20" autocomplete="off" placeholder="Room code"></label><p class="form-error" role="alert"></p><button class="primary">Join table</button></form>');
    else if (action === 'join-table') { const room = await api(`/api/tables/${encodeURIComponent(button.dataset.id)}/join`, {}); await enterRoom(room.id || room.table?.id || button.dataset.id); }
    else if (action === 'join-event') { await api(`/api/events/${encodeURIComponent(state.context)}/join`, {}); toast('You’re on the guest list. Your event wallet is ready.'); await refresh(); }
    else if (action === 'host-operation' || action==='rematch' || action==='confirm-close-table') {
      button.disabled=true;
      try { await api(`/api/tables/${encodeURIComponent(state.roomId)}/manage`,{operation:action==='rematch'?'rematch':action==='confirm-close-table'?'close':button.dataset.operation,botId:button.dataset.id,difficulty:document.querySelector('#host-bot-difficulty')?.value||state.room.botDifficulty||'medium'});modal.close();await refresh(); }
      finally {button.disabled=false;}
    }
    else if(action==='close-table') openModal('Close this table?', '<p>This closes the room for everyone. Any unsettled event chips are returned according to the game’s settlement policy.</p><button class="danger" data-action="confirm-close-table">Close table</button>');
    else if (action === 'start-table') { await api(`/api/tables/${encodeURIComponent(state.roomId)}/start`, {}); sound('deal'); await refresh(); }
    else if (action === 'leave-table' && ['playing','paused'].includes(state.room?.status)) { openModal('Leave this table?', `<p>Autoplay will finish your seat. ${state.room.practice ? 'Practice chips have no wallet value.' : 'Your committed chips stay in the match and settle when it ends.'} You can join another table immediately.</p><button class="danger" data-action="confirm-leave">Leave and enable autoplay</button>`); }
    else if (action === 'leave-table' || action === 'confirm-leave') { modal.close(); await api(`/api/tables/${encodeURIComponent(state.roomId)}/leave`, {}); state.page = 'lobby'; state.roomId = null; state.room = null; await refresh(); }
    else if (action === 'copy-link') { const link = new URL('/', location.origin); link.searchParams.set('join', state.room.code); await navigator.clipboard.writeText(link.href); toast('Room link copied. Friends can join as guests.'); }
    else if (action === 'copy-code') { await navigator.clipboard.writeText(state.room.code); toast('Invitation code copied.'); }
    else if (action === 'select-card') { const id = button.dataset.id; if (state.selected.has(id)) state.selected.delete(id); else { if (state.room.game !== 'bluff') state.selected.clear(); if (state.room.game === 'bluff' && state.selected.size >= 4) return toast('Play up to four cards at a time.'); state.selected.add(id); } sound(); const scroll=document.querySelector('.hand')?.scrollLeft||0;
      if(document.querySelector('.social-room'))updateSocialSelection(state.room,state,esc,claimRank);
      else { renderRoom(); const hand=document.querySelector('.hand'); if(hand)hand.scrollLeft=scroll; }
    }
    else if (action === 'play-wild') await submitAction({type:'play',cards:[...state.selected],color:button.dataset.color});
    else if (action === 'starting-colour') await submitAction({type:'choose-color',color:button.dataset.color});
    else if (action === 'bluff-skip') await submitAction({type:'skip'});
    else if (action === 'play-cards') await submitAction({ type: 'play', cards: [...state.selected], ...(state.room.game === 'chromatic' ? { color: document.querySelector('#wild-color')?.value } : {rank:document.querySelector('#bluff-rank')?.value}) });
    else if (action === 'special-action') {
      if(button.dataset.move==='declare'){
        const discard=[...state.selected][0];if(!discard)return;
        await submitAction({type:'analyze',cards:[discard]});const g=state.room.state;
        openModal('Check your declaration',`<div class="declaration-preview"><strong>${g.analysis?.valid?'Your groups are valid':'This hand is not ready to declare'}</strong><div class="meld-strip">${(g.analysis?.groups||[]).map(group=>`<div><strong>${({pure:'Pure sequence',sequence:'Sequence',set:'Set'})[group.kind]}</strong>${group.cards.map(id=>g.hand.find(c=>c.id===id)).filter(Boolean).map(c=>esc(c.rank+' '+c.suit)).join(' · ')}</div>`).join('')}</div><p>Discarding ${esc(g.hand.find(c=>c.id===discard)?.rank||'')} · ${g.analysis?.penalty||0} penalty points</p><button class="primary" data-action="confirm-declaration" data-id="${esc(discard)}" ${g.analysis?.valid?'':'disabled'}>Declare hand</button></div>`);return;
      }
      const amount=document.querySelector('#bet-amount');
      if(button.dataset.move==='raise' && amount && !amount.reportValidity())return;
      await submitAction({type:button.dataset.move,cards:[...state.selected],source:button.dataset.source,amount:Number(button.dataset.amount ?? amount?.value ?? document.querySelector('#bid-amount')?.value)});
    }
    else if (action === 'chromatic-action') await submitAction({type:button.dataset.move,target:button.dataset.target,color:document.querySelector('#wild-color')?.value});
    else if(action==='confirm-declaration'){await submitAction({type:'declare',cards:[button.dataset.id]});modal.close();}
    else if (action === 'draw-card') await submitAction({ type: 'draw' });
    else if (action === 'challenge') await submitAction({ type: 'challenge', claimId:button.dataset.claimId });
    else if (action === 'mute') { audioPrefs.muted = !getMix().muted; setMix({muted:audioPrefs.muted}); localStorage.setItem('venatus-sound', JSON.stringify(audioPrefs)); button.textContent = `Sound ${audioPrefs.muted ? 'off' : 'on'}`; button.setAttribute('aria-label', `${audioPrefs.muted ? 'Unmute' : 'Mute'} sound`); sound(); }
    else if(action==='configure-event') {
      const e=state.admin.events.find(e=>e.id===button.dataset.id);
      const date=n=>{if(!n)return '';const d=new Date(n);d.setMinutes(d.getMinutes()-d.getTimezoneOffset());return d.toISOString().slice(0,16);};
      openModal('Schedule & registration',`<form id="configure-event-form" data-id="${esc(e.id)}" class="stack"><label>Description<input name="description" maxlength="1000" value="${esc(e.description||'')}"></label><label>Start time<input type="datetime-local" name="startsAt" ${['draft','registration'].includes(e.status)?'':'disabled'} value="${date(e.startsAt)}"></label><label>End time<input type="datetime-local" name="endsAt" value="${date(e.endsAt)}"></label><label class="check"><input name="registrationOpen" type="checkbox" ${e.registrationOpen!==false?'checked':''}> Allow new registrations</label><label>Minimum stake<input name="minStake" type="number" min="0" max="100000" value="${e.minStake??''}"></label><label>Maximum stake<input name="maxStake" type="number" min="0" max="100000" value="${e.maxStake??''}"></label><p class="small">Existing tables retain their agreed stakes. Event bots are disabled to protect standings.</p><p class="form-error" role="alert"></p><button class="primary">Save event settings</button></form>`);
    }
    else if (action === 'manage-player') managePlayer(button.dataset.id);
    else if (action === 'admin-table') {
      const operation = button.dataset.operation;
      if (operation === 'cancel') openModal('Cancel and refund this table?', `<p>Fixed antes are refunded. Poker returns remaining stacks and current bets, preserving completed hands. This action is recorded in the audit trail.</p><button class="danger" data-action="confirm-cancel" data-id="${esc(button.dataset.id)}">Confirm cancellation</button>`);
      else { await api(`/api/admin/table/${encodeURIComponent(button.dataset.id)}`, { operation }); await refresh(); }
    } else if (action === 'confirm-event') { await api(`/api/admin/event/${encodeURIComponent(button.dataset.id)}`, { status: button.dataset.status }); modal.close(); toast('Event closed. Unfinished stakes refunded.'); await refresh(); }
    else if (action === 'confirm-cancel') { await api(`/api/admin/table/${encodeURIComponent(button.dataset.id)}`, { operation: 'cancel' }); modal.close(); toast('Table canceled. Stakes refunded.'); await refresh(); }
  } catch (error) { sound('error'); toast(error.message); if (state.page === 'room') refresh(); }
});
document.addEventListener('submit', async event => {
  const form = event.target; if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  const values = new FormData(form); const error = form.querySelector('.form-error'); const submit = form.querySelector('button[type="submit"],button:not([type])');
  if (error) error.textContent = ''; if (submit) submit.disabled = true;
  try {
    if (form.id === 'auth-form') {
      await api(`/api/${state.authMode}`, Object.fromEntries(values));
      const me = await api('/api/me'); state.user = me.user; state.setupRequired = me.setupRequired; state.context = 'casual'; state.page = 'lobby'; restoreSeat(me); await refresh(); connect(); await joinInvitation();
    } else if (form.id === 'save-guest-form') {
      savingAccount = true;
      clearTimeout(refreshTimeout);clearTimeout(reconnectTimeout);
      const oldSocket=socket;socket=null;oldSocket?.close();
      try {
        // Finish reads using the old cookie before rotating the guest session.
        while(refreshing) await new Promise(resolve=>setTimeout(resolve,20));
        const result=await api('/api/register',Object.fromEntries(values));
        state.user=result.user;modal.close();
        toast('Account saved. You can sign in on another device.');
      } finally {savingAccount=false;connect();await refresh();}
    } else if (form.id === 'create-table-form') {
      const result = await api('/api/tables', { name: values.get('name'), game: values.get('game'), stake: Number(values.get('stake')), private: values.has('private'), context: state.context, capacity: Number(values.get('capacity')||6), ...(values.get('smallBlind')?{smallBlind:Number(values.get('smallBlind'))}:{}), ...(values.get('bigBlind')?{bigBlind:Number(values.get('bigBlind'))}:{}), bots: Number(values.get('bots') || 0), pace:values.get('pace')||'standard', manualResults:values.has('manualResults'), practice: state.context==='casual' });
      modal.close(); await enterRoom(result.id || result.table?.id);
    } else if (form.id === 'join-code-form') {
      modal.close(); await joinByCode(String(values.get('code')).trim().toUpperCase());
    } else if (form.id === 'event-form') {
      await api('/api/admin/event', { name: values.get('name'), description:values.get('description')||'', ...(values.get('minStake')!==''&&values.get('minStake')!==null?{minStake:Number(values.get('minStake')),maxStake:Number(values.get('maxStake'))}:{}), participantLimit: values.get('participantLimit') ? Number(values.get('participantLimit')) : null, startsAt: values.get('startsAt') ? new Date(values.get('startsAt')).getTime() : null, endsAt: values.get('endsAt') ? new Date(values.get('endsAt')).getTime() : null, startingChips: Number(values.get('startingChips')), stakes: String(values.get('stakes')).split(',').map(s => Number(s.trim())), games: ['bluff', 'chromatic', 'poker', 'ohhell', 'rummy'].filter(g => values.has(g)) }); toast('Event created. Open registration when you’re ready.'); await refresh();
    } else if(form.id==='configure-event-form') {
      const schedule = {};
      for (const field of ['startsAt','endsAt']) {
        const input = form.elements.namedItem(field);
        if (!input.disabled && input.value !== input.defaultValue) schedule[field] = input.value ? new Date(input.value).getTime() : null;
      }
      await api(`/api/admin/event/${encodeURIComponent(form.dataset.id)}`, {operation:'configure',description:values.get('description'),registrationOpen:values.has('registrationOpen'),...schedule,...(values.get('minStake')!==''?{minStake:Number(values.get('minStake')),maxStake:Number(values.get('maxStake'))}:{})});modal.close();await refresh();
    } else if (form.id === 'settings-form') {
      await api('/api/admin/settings', { startingChips: Number(values.get('startingChips')), bluff: values.has('bluff'), chromatic: values.has('chromatic'), poker:values.has('poker'), ohhell:values.has('ohhell'), rummy:values.has('rummy'), maintenance: values.has('maintenance'), announcement: values.get('announcement') || '' }); toast('House settings saved.'); await refresh();
    } else if (form.id === 'manage-player-form') {
      const body = { banned: values.has('banned'), revoke: values.has('revoke'), reason: values.get('reason') };
      if (values.has('role')) body.role = values.get('role');
      if (values.get('adjustment') !== null && values.get('adjustment') !== '') { body.adjustment = Number(values.get('adjustment')); body.context = values.get('context'); }
      await api(`/api/admin/user/${encodeURIComponent(form.dataset.id)}`, body); modal.close(); toast('Player changes recorded.'); await refresh();
    }
  } catch (err) { if (error) error.textContent = err.message; else toast(err.message); sound('error'); }
  finally { if (submit) submit.disabled = false; }
});
document.addEventListener('change', async event => {
  try {
    if (event.target.id === 'bluff-rank') {claimRank=event.target.value;updateSocialSelection(state.room,state,esc,claimRank);}
    if(event.target.name==='capacity' && event.target.form?.id==='create-table-form') {
      const bots=event.target.form.elements.namedItem('bots');
      if(bots){const max=Number(event.target.value)-1;for(const option of bots.options)option.disabled=Number(option.value)>max;bots.value=String(Math.min(Number(bots.value),max));}
    }
    if (event.target.id === 'context') { state.context = event.target.value; await refresh(); }
    if (event.target.classList.contains('event-status')) {
      const id = event.target.dataset.id, status = event.target.value;
      if (['completed','canceled'].includes(status)) {
        openModal('Close this event?', `<p>Unfinished matches will be canceled and their stakes refunded. The event will move to ${esc(status)}. This action is recorded.</p><button class="danger" data-action="confirm-event" data-id="${esc(id)}" data-status="${esc(status)}">Confirm event closure</button>`);
        event.target.value = state.admin.events.find(e => e.id === id).status;
      } else { await api(`/api/admin/event/${encodeURIComponent(id)}`, { status }); toast('Event status updated.'); await refresh(); }
    }
    if (event.target.id === 'sound-volume') { audioPrefs.volume = Number(event.target.value); localStorage.setItem('venatus-sound', JSON.stringify(audioPrefs)); sound(); }
  } catch (error) { toast(error.message); await refresh(); }
});
document.addEventListener('input', event => {
  if (event.target.id === 'player-search') document.querySelectorAll('[data-player-name]').forEach(row => row.hidden = !row.dataset.playerName.includes(event.target.value.toLowerCase()));
});
installSpecialInput();
installHandDrag(()=>state.room,renderRoom);
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.user) refresh(); });
async function joinByCode(code, registerForEvent = false) {
  const result = await api('/api/rooms/join', { code, previewEvent:true, registerForEvent });
  if (result.registration) {
    const e = result.registration;
    openModal('Join ' + esc(e.name), `<p>You will receive ${fmt(e.startingChips)} event chips. This table’s stake is ${fmt(e.stake)} chips.</p><button class="primary" data-action="accept-event-invite" data-code="${esc(code)}">Register and take a seat</button>`);
    return;
  }
  if (modal.open) modal.close();
  await enterRoom(result.id);
  if (pendingInvite) { pendingInvite=''; history.replaceState(null,'','/'); }
}
async function joinInvitation() {
  if (!pendingInvite || !state.user) return;
  try { await joinByCode(pendingInvite); }
  catch (error) { toast(error.message); }
}
async function boot() {
  installAudio();installControls({sound});
  installProfiles({api,openModal,toast,getUser:()=>state.user,onSaved:async profile=>{Object.assign(state.user,{name:profile.displayName,avatar:profile.avatar});render();await refresh();}});
  installLounge({api,openModal,toast,card,submitAction,getState:()=>state});
  try { const me = await api('/api/me'); state.user = me.user; state.setupRequired = me.setupRequired; if (state.user) { restoreSeat(me); await refresh(); connect(); await joinInvitation(); } else { renderAuth(); } }
  catch (error) { app.innerHTML = `<main class="initial">${brand()}<h2>The card room is resting.</h2><p>${esc(error.message)}</p><button data-action="reload">Try again</button></main>`; }
}
function restoreSeat(me) {
  if (me.activeTable && !pendingInvite) { state.roomId=me.activeTable.id; state.context=me.activeTable.context; state.page='room'; }
}
boot();
