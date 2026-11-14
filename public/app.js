import { handTools, renderHand, handleExperienceAction, installHandDrag } from '/experience.js';
import { specialRoom, animateSpecialTransition, specialTransitionSound, installSpecialInput } from '/special.js';
import { socialRoom, socialTransition, animateSocialTransition, updateSocialSelection } from '/social.js';
const app = document.querySelector('#app');
const modal = document.querySelector('#modal');
const state = { user: null, setupRequired: false, context: 'casual', page: 'lobby', roomId: null, room: null, lobby: null, admin: null, selected: new Set(), connected: false, authMode: 'guest', busy: false };
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
function sound(kind = 'tap') {
  if (audioPrefs.muted) return;
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state !== 'running') {
      if (!navigator.userActivation?.hasBeenActive) return;
      audioContext.resume().catch(() => {});
    }
    const volume = Math.max(0,Math.min(1,Number(audioPrefs.volume)||0));
    const notes = {win:[523,659,784],error:[180,140],turn:[440,660],exposed:[220,440,660],honest:[330,220],reverse:[350,600,350],skip:[540,350],stack:[220,330,440],wild:[440,554,659],collect:[520,680]};
    const start = audioContext.currentTime;
    if (['deal','draw','place','chips'].includes(kind)) {
      const length = Math.floor(audioContext.sampleRate*.07);
      const buffer = audioContext.createBuffer(1,length,audioContext.sampleRate);
      const data=buffer.getChannelData(0);
      for(let i=0;i<length;i++)data[i]=(Math.random()*2-1)*Math.pow(1-i/length,2);
      const noise=audioContext.createBufferSource(), filter=audioContext.createBiquadFilter(), gain=audioContext.createGain();
      noise.buffer=buffer;filter.type='bandpass';filter.frequency.value=kind==='chips'?2600:1100;
      gain.gain.value=volume*.32;
      noise.connect(filter);filter.connect(gain);gain.connect(audioContext.destination);noise.start();
      return;
    }
    (notes[kind] || [480]).forEach((frequency,index) => {
      const osc=audioContext.createOscillator(), gain=audioContext.createGain(), at=start+index*.07;
      osc.type='sine';osc.frequency.value=frequency;
      gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(volume*.11,at+.006);gain.gain.exponentialRampToValueAtTime(.001,at+.12);
      osc.connect(gain);gain.connect(audioContext.destination);osc.start(at);osc.stop(at+.13);
    });
  } catch { /* Audio availability never blocks a game action. */ }
}
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
  const selected = state.selected.has(c.id);
  const color = ({ruby:'red',emerald:'green',sapphire:'blue',gold:'yellow'}[c.color] || (['red','green','blue','yellow','wild'].includes(c.color) ? c.color : 'wild'));
  const label = joker?'Printed joker':colorCard ? `${c.color} ${rank}` : `${rank} of ${suit}`;
  const cls = `playing-card ${colorCard ? `color-${color}` : red ? 'red' : ''} ${selected ? 'selected' : ''}`;
  const tag = interactive ? 'button' : 'div';
  const value = joker?'JK':({ skip: '⊘', reverse: '↔', draw2: '+2', wild: 'W', wilddraw4: '+4' }[rank] || rank);
  return `<${tag} class="${cls}" ${interactive ? `data-action="select-card" data-id="${esc(c.id)}" aria-pressed="${selected}" ${disabled ? 'disabled' : ''}` : ''} aria-label="${esc(label)}"><span class="corner">${esc(value)}${colorCard||joker ? '' : suitSvg(suit)}</span>${joker?'<svg class="center-suit" viewBox="0 0 40 44" aria-hidden="true"><path d="M20 3 25 15 38 17 28 26 31 40 20 33 9 40 12 26 2 17 15 15Z"/></svg>':colorCard ? `<span class="center-value">${esc(value)}</span>` : suitSvg(suit, 'center-suit')}<span class="corner bottom">${esc(value)}${colorCard||joker ? '' : suitSvg(suit)}</span></${tag}>`;
}
function brand() { return '<div class="brand"><img src="/logo.png" alt="Venatus logo"><div><strong>VENATUS</strong><span>CASINO</span></div></div>'; }
function header() {
  return `<header class="topbar">${brand()}${state.user ? `<nav class="nav" aria-label="Main navigation"><button data-action="casual" class="${state.page === 'lobby' || state.page === 'room' ? 'active' : ''}">Play games</button><button data-action="events">Casino events</button><button data-action="navigate" data-page="history" class="${state.page === 'history' ? 'active' : ''}">Your activity</button>${adminRole() ? `<button data-action="navigate" data-page="admin" class="${state.page === 'admin' ? 'active' : ''}">Control room</button>` : ''}</nav><div class="account"><div class="avatar">${esc(initials(state.user.name))}</div><span class="account-name small">${esc(state.user.name)}</span>${state.user.role==='guest'?'<button class="subtle" data-action="save-guest">Save account</button>':''}<button class="subtle" data-action="logout">${state.user.role==='guest'?'Exit guest':'Sign out'}</button></div>` : '<span class="badge">The private card room</span>'}</header>`;
}
function footer() {
  return `<footer class="footer"><span>VENATUS CASINO &nbsp; · &nbsp; Play for the pleasure of the game.</span><span>Free virtual chips. No purchases, transfers or cash value.</span>${state.user ? `<div class="sound-controls"><button data-action="mute" aria-label="${audioPrefs.muted ? 'Unmute' : 'Mute'} sound">Sound ${audioPrefs.muted ? 'off' : 'on'}</button><input id="sound-volume" type="range" min="0" max="1" step="0.05" value="${audioPrefs.volume}" aria-label="Sound volume"></div>` : ''}</footer>`;
}
function renderAuth() {
  const mode = state.authMode;
  const guest = mode === 'guest';
  const invite = Boolean(pendingInvite);
  const guestForm = `<label>Nickname <small>(optional)</small><input name="name" autocomplete="nickname" maxlength="16" placeholder="What should friends call you?"></label>`;
  const credentials = `<label>Player name<input name="name" autocomplete="username" minlength="3" maxlength="24" required></label><label>Password<input name="password" type="password" autocomplete="${mode==='login'?'current-password':'new-password'}" minlength="${mode==='login'?1:12}" maxlength="128" required></label>`;
  const primary = guest ? (invite ? 'Join table as guest' : 'Play as guest') : mode==='register' ? 'Create account' : mode==='setup' ? 'Create owner account' : 'Sign in';
  app.innerHTML = `${header()}<main class="auth-layout"><section class="auth-story"><div class="eyebrow">Venatus card room</div><h1>${invite?'Your seat is<br><em class="gold">waiting.</em>':'Cards on<br>the <em class="gold">table.</em>'}</h1><p>Poker, Rummy, Oh Hell, Bluff and Chromatic. Open a table or join your friends for a hand.</p><div class="mini-cards" aria-hidden="true">${card({rank:'A',suit:'S'})}${card({rank:'K',suit:'H'})}${card(null)}</div></section><section class="auth-card"><div class="auth-tabs" aria-label="Entry options">${[['guest','Guest'],['login','Sign in'],['register','Register']].map(([value,label])=>`<button data-action="auth-mode" data-mode="${value}" class="${mode===value?'active':''}" aria-pressed="${mode===value}">${label}</button>`).join('')}</div><h2>${guest ? invite?'Join your friends':'Take a seat' : mode==='login'?'Welcome back':mode==='register'?'Create your account':'Owner setup'}</h2><p class="small">${guest?'Your guest seat is saved in this browser for seven days.':mode==='login'?'Players and owners can use their existing account.':mode==='register'?'Keep your player identity across devices.':'Enter the setup token from your server configuration.'}</p><form id="auth-form" class="stack">${guest?guestForm:credentials}${mode==='setup'?'<label>Owner setup token<input name="token" type="password" required autocomplete="off"></label>':''}<p class="form-error" role="alert"></p><button class="primary" type="submit">${primary}</button></form>${state.setupRequired&&mode!=='setup'?'<button class="subtle small" data-action="auth-mode" data-mode="setup">Owner setup</button>':''}</section></main>`;
}
function connection() { return `<span class="connection ${state.connected ? '' : 'disconnected'}"><i class="dot"></i>${state.connected ? 'Live connection' : 'Reconnecting'}</span>`; }
function gameTile(game, title, sub, description) {
  const event = state.lobby?.events?.find(e => e.id === state.context);
  const enabled = state.lobby?.settings?.[game] !== false && !state.lobby?.settings?.maintenance && (!event || (event.status === 'active' && event.games.includes(game) && state.lobby.participating));
  return `<article class="game-card"><div class="game-copy"><div class="eyebrow">${sub}</div><h2>${title}</h2><p>${description}</p><div class="row"><button class="primary" data-action="create-table" data-game="${game}" ${enabled ? '' : 'disabled'}>${enabled ? 'Create a table' : 'Temporarily closed'} &nbsp; ↗</button><button class="subtle" data-action="rules" data-game="${game}">The rules</button></div></div><div class="game-art ${game === 'chromatic' ? 'chromatic-art' : ''}" aria-hidden="true">${game !== 'chromatic' ? card({ rank: 'A', suit: 'S' }) + card({ rank: 'Q', suit: 'H' }) : card({ color: 'red', value: '7' }) + card({ color: 'green', value: 'wild' })}</div></article>`;
}
function renderLobby() {
  const data = state.lobby;
  if (!data) return;
  const events = data.events || [];
  const activeEvent = events.find(e => e.id === state.context);
  const tables = (data.tables || []).filter(t => ['waiting','playing','paused'].includes(t.status)||t.practice&&t.status==='finished');
  const wallet = data.wallet || {};
  app.innerHTML = `${header()}<main class="layout"><section class="hero"><div><div class="eyebrow">Welcome to the club, ${esc(state.user.name)}</div><h1>The evening is <em class="gold">yours.</em></h1><p>A well-played hand. A beautifully told bluff.<br>Find your table and settle in.</p></div>${activeEvent ? `<aside class="wallet"><div class="eyebrow">${esc(activeEvent?.name || 'Event wallet')}</div><div class="balance number">${fmt(wallet.available)} <span class="small">CHIPS</span></div><div class="wallet-bottom"><span>Available to play</span><span>${fmt(wallet.reserved)} reserved</span></div></aside>` : '<aside class="wallet"><div class="eyebrow">CASUAL PLAY</div><h2>Your friends. Your table.</h2><p>No wallet required. Play with table chips and invite friends or add bots.</p></aside>'}</section>${data.settings?.announcement ? `<div class="panel small" style="margin-bottom:22px;padding:15px 20px">${esc(data.settings.announcement)}</div>` : ''}<section class="context-bar"><label class="hidden" for="context">Gaming context</label><select id="context"><option value="casual">Casual card room</option>${events.map(e => `<option value="${esc(e.id)}" ${e.id === state.context ? 'selected' : ''}>${esc(e.name)} · ${esc(e.status)}</option>`).join('')}</select>${state.context !== 'casual' ? `<button data-action="join-event" ${data.participating || activeEvent?.registrationOpen===false || !['registration','active'].includes(activeEvent?.status) ? 'disabled' : ''}>${data.participating ? 'Registered' : ['registration','active'].includes(activeEvent?.status) ? 'Join event' : 'Registration closed'}</button><span class="small muted">${esc(activeEvent?.status || '')}</span>` : '<span class="small muted">Your everyday escape.</span>'}<div class="right">${connection()}</div></section><section class="game-grid">${gameTile('bluff', 'The art of the bluff.', 'Bluff · 3–6 players', 'Keep a straight face. Shed your cards. Decide who deserves the benefit of the doubt.')}${gameTile('chromatic', 'Follow your colour.', 'Chromatic · Street UNO rules', 'Stack +2 and +4. Call your last card. Race to 500 points.')}${gameTile('poker','Play the player.','Texas Hold’em · 2–6 players','No-limit betting, community cards, and every chip on the line.')}${gameTile('ohhell','Call it precisely.','Oh Hell · 3–6 players','Bid your tricks. Follow suit. Make every prediction count.')}${gameTile('rummy','Find your sequence.','Indian Rummy · 2–6 players','Thirteen cards. Pure sequences, clever sets, and a perfect declaration.')}</section><div class="lower-grid"><section><div class="section-head"><h2>Find your company</h2><button class="subtle" data-action="join-code">Join with a code ↗</button></div>${tables.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Table / Game</th><th>Table stakes</th><th>Seats</th><th></th></tr></thead><tbody>${tables.map(t => `<tr><td><strong>${esc(t.name)}</strong><small>${gameName(t.game)} · ${esc(t.status)}${t.practice?' · Casual':''}</small></td><td class="number gold">${t.practice && t.game!=='poker' ? 'Scoring only' : fmt(t.stake)}</td><td>${t.players?.length || 0} / ${t.capacity||6}</td><td><button data-action="join-table" data-id="${esc(t.id)}" ${t.players?.some(p => p.id === state.user.id && p.left) || (!t.joinable && !t.players?.some(p => p.id === state.user.id)) ? 'disabled' : ''}>${t.players?.some(p => p.id === state.user.id) ? 'Return' : 'Take a seat'}</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty"><h3>Be the first at the table.</h3><p>Create a room above and invite your friends. Your next great hand starts with good company.</p><span class="badge">Friends or practice bots</span></div>'}</section>${activeEvent ? `<aside class="ranking"><div class="section-head"><h2>The leaderboard</h2><span class="badge">${state.context === 'casual' ? 'Casual' : activeEvent?.status==='completed'?'Final results':'Live event'}</span></div>${(data.leaderboard || []).map((p, i) => `<div class="rank-row"><span class="rank-no">${String(i + 1).padStart(2, '0')}</span><div>${esc(p.name)}<small>${fmt(p.wins)} wins · ${fmt(p.gamesPlayed)} games · ${p.profit>=0?'+':''}${fmt(p.profit)} chips</small></div><span class="rank-value">${fmt(p.balance)}</span></div>`).join('') || '<p class="small">The first chapter is still to be written.</p>'}<p class="small muted" style="font-size:9px;margin:20px 0 0">Available and reserved chips. Each event has its own standings.</p></aside>` : '<aside class="ranking"><h2>Host a game anytime</h2><p>Create a table, share its link, and fill empty seats with bots. Table chips stay at that table.</p><button data-action="events">Explore casino events →</button></aside>'}</div></main>${footer()}`;
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
  if(room.host!==state.user.id) return '';
  return `<div class="row wrap host-controls">${room.code?'<button data-action="copy-link">Copy invite link</button>':''}${room.practice?`<label>Bot level<select id="host-bot-difficulty"><option value="easy">Easy</option><option value="medium" selected>Medium</option><option value="hard">Hard</option></select></label><button data-action="host-operation" data-operation="add-bot" ${room.players.length>=(room.capacity||6)?'disabled':''}>Add bot</button><button data-action="host-operation" data-operation="fill-bots" ${room.players.length>=(room.capacity||6)?'disabled':''}>Fill empty seats</button>${room.players.filter(p=>p.bot).map(p=>`<button data-action="host-operation" data-operation="remove-bot" data-id="${esc(p.id)}">Remove ${esc(p.name)}</button>`).join('')}`:''}<button class="subtle" data-action="close-table">Close table</button></div>`;
}
function renderRoom() {
  const room = state.room; if (!room) return;
  state.selected=new Set([...state.selected].filter(id=>room.state?.hand?.some(c=>c.id===id)));
  if (room.status === 'canceled') {
    app.innerHTML = `${header()}<main class="layout"><div class="eyebrow">Table closed</div><h1>${esc(room.name)}</h1><p>${room.practice?'This casual table is closed. No wallet chips were used.':'The match was canceled. Your chips have been returned to your wallet; completed poker hands retain their results.'}</p><button class="primary" data-action="navigate" data-page="lobby">Return to the casino</button></main>${footer()}`;
    return;
  }
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
  app.innerHTML=`${header()}<main class="layout"><div class="eyebrow">COMPETE TOGETHER</div><h1>Casino events</h1><p>Each event has its own chips, tables and standings. Casual games are always separate.</p>${[['Live',['active','paused']],['Upcoming',['registration','draft']],['Results',['completed','canceled','archived']]].map(([title,statuses])=>`<section><h2>${title}</h2><div class="game-grid">${events.filter(e=>statuses.includes(e.status)).map(e=>`<article class="panel"><span class="badge">${esc(e.status)}</span><h2>${esc(e.name)}</h2><p>${e.startsAt?esc(new Date(e.startsAt).toLocaleString()):'Host-managed schedule'}${e.endsAt?' — '+esc(new Date(e.endsAt).toLocaleString()):''}</p><p>${fmt(e.startingChips)} starting event chips · ${e.participants||0} registered</p><p>${esc(e.description||'')}</p><p>${e.games.map(gameName).join(' · ')}</p><button data-action="open-event" data-id="${esc(e.id)}">${statuses.includes('completed')?'View results':'Open event'}</button></article>`).join('')||'<p class="small">No events in this section yet.</p>'}</div></section>`).join('')}</main>${footer()}`;
}
function renderHistory() {
  const history = state.lobby?.history || [];
  app.innerHTML = `${header()}<main class="layout history"><div class="eyebrow">Your time at the tables</div><h1>Every hand has a story.</h1><p class="small">Your recent matches in this gaming context.</p>${history.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Game / Table</th><th>Result</th><th>Chips</th><th>Played</th></tr></thead><tbody>${history.map(h => `<tr><td>${esc(h.name || gameName(h.game))}<small>${esc(h.game || '')}</small></td><td>${esc(h.status === 'canceled' ? 'Refunded' : h.state?.winner === state.user.id ? 'Won' : h.state?.winner ? 'Lost' : 'Draw')}</td><td class="number gold">${fmt(h.payout ?? (h.state?.winner === state.user.id ? h.pot : !h.state?.winner ? h.stake : 0))}</td><td>${h.finished ? esc(new Date(h.finished).toLocaleDateString()) : '—'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty"><h3>Your story starts at the table.</h3><p>Completed matches will appear here.</p><button class="primary" data-action="navigate" data-page="lobby">Find a game</button></div>'}</main>${footer()}`;
}
function renderAdmin() {
  const data = state.admin; if (!data) return;
  const stats = data.stats || {}, settings = data.settings || {};
  const owner = state.user.role === 'superadmin';
  app.innerHTML = `${header()}<main class="layout"><div class="section-head"><div><div class="eyebrow">${owner ? 'Super Admin' : 'Moderation'} · Control room</div><h2>The house, in order.</h2></div><button data-action="refresh-admin">Refresh dashboard</button><a href="/api/admin/export?context=${encodeURIComponent(state.context)}">Export results ↗</a></div><div class="stat-grid">${[['Registered players', stats.users], ['Players online', stats.online], ['Active tables', stats.tables], ['Completed matches', stats.matches]].map(([label, value]) => `<div class="stat"><div class="value number">${fmt(value)}</div><div class="label">${label}</div></div>`).join('')}</div><div class="admin-grid"><section class="panel"><h2>Create an occasion</h2>${owner ? '<form id="event-form" class="stack event-form"><label class="full-width">Event name<input name="name" required maxlength="80" placeholder="Friday at the card room"></label><label>Starting chips<input name="startingChips" type="number" min="100" max="1000000" step="1" value="10000" required></label><label>Stake presets (comma separated)<input name="stakes" value="100,250,500" required></label><label>Minimum stake<input name="minStake" type="number" min="0" max="100000" placeholder="Use presets only"></label><label>Maximum stake<input name="maxStake" type="number" min="0" max="100000" placeholder="Use presets only"></label><label class="full-width">Description<input name="description" maxlength="1000" placeholder="Tell players about the event"></label><label>Participant limit (optional)<input name="participantLimit" type="number" min="2" max="10000" placeholder="Unlimited"></label><label>Automatic start (local time)<input name="startsAt" type="datetime-local"></label><label>Automatic end (local time)<input name="endsAt" type="datetime-local"></label><p class="small full-width">Open registration to arm the schedule. Keep the local server running; overdue transitions are applied when it restarts. Blank times use manual controls.</p><label class="check"><input type="checkbox" name="bluff" checked> Bluff</label><label class="check"><input type="checkbox" name="chromatic" checked> Chromatic</label><label class="check"><input type="checkbox" name="poker" checked> Poker</label><label class="check"><input type="checkbox" name="ohhell" checked> Oh Hell</label><label class="check"><input type="checkbox" name="rummy" checked> Rummy</label><p class="form-error full-width" role="alert"></p><button class="primary full-width">Create event</button></form>' : '<p class="small">Event creation is managed by the owner.</p>'}</section><section class="panel"><h2>House settings</h2>${owner ? `<form id="settings-form" class="stack"><label>Starting casual chips<input name="startingChips" type="number" min="100" max="1000000" value="${Number(settings.startingChips) || 10000}" required></label><label class="check"><input type="checkbox" name="bluff" ${settings.bluff !== false ? 'checked' : ''}> Open Bluff tables</label><label class="check"><input type="checkbox" name="chromatic" ${settings.chromatic !== false ? 'checked' : ''}> Open Chromatic tables</label>${['poker','ohhell','rummy'].map(g=>`<label class="check"><input type="checkbox" name="${g}" ${settings[g] !== false ? 'checked' : ''}> Open ${gameName(g)} tables</label>`).join('')}<label>Lobby announcement<input name="announcement" maxlength="400" value="${esc(settings.announcement || '')}" placeholder="A message for the club"></label><label class="check"><input type="checkbox" name="maintenance" ${settings.maintenance ? 'checked' : ''}> Maintenance mode</label><p class="form-error" role="alert"></p><button>Save house settings</button></form>` : '<p class="small">House settings are managed by the owner.</p>'}</section></div><section class="panel admin-wide"><h2>Events</h2>${(data.events || []).map(e => `<div class="admin-event"><div>${esc(e.name)}<p class="small" style="margin:5px 0 0">${fmt(e.startingChips)} starting chips · ${esc(e.status)} · ${e.participants || 0}${e.participantLimit ? " / " + e.participantLimit : ""} participants</p><p class="small">${e.startsAt ? "Starts " + esc(new Date(e.startsAt).toLocaleString()) : "Manual start"} · ${e.endsAt ? "Ends " + esc(new Date(e.endsAt).toLocaleString()) : "Manual end"}</p></div>${owner ? `<button data-action="configure-event" data-id="${esc(e.id)}" ${['completed','canceled','archived'].includes(e.status)?'disabled':''}>Schedule & registration</button><select class="event-status" data-id="${esc(e.id)}" aria-label="Status of ${esc(e.name)}">${[e.status,...(eventTransitions[e.status] || [])].map(s => `<option ${s === e.status ? 'selected' : ''}>${s}</option>`).join('')}</select>` : ''}</div>`).join('') || '<p class="small">No events yet. Casual games remain available independently.</p>'}</section><section class="panel admin-wide"><div class="section-head"><h2>Players</h2><input id="player-search" placeholder="Find a player" aria-label="Find a player" style="max-width:240px"></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Player</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody>${(data.users || []).map(u => `<tr data-player-name="${esc(u.name.toLowerCase())}"><td>${esc(u.name)}</td><td>${esc(u.role)}</td><td>${u.banned ? 'Banned' : 'Active'}</td><td><button data-action="manage-player" data-id="${esc(u.id)}" ${u.role === 'superadmin' ? 'disabled' : ''}>Manage</button></td></tr>`).join('')}</tbody></table></div></section><section class="panel admin-wide"><h2>Tables</h2><div class="table-wrap"><table class="data-table"><thead><tr><th>Table</th><th>Game</th><th>Status</th><th>Actions</th></tr></thead><tbody>${(data.tables || []).filter(t => ['waiting','playing','paused'].includes(t.status)||t.practice&&t.status==='finished').map(t => `<tr><td>${esc(t.name)}</td><td>${gameName(t.game)}</td><td>${esc(t.status)}</td><td><div class="row"><button data-action="admin-table" data-id="${esc(t.id)}" data-operation="${t.status === 'paused' ? 'resume' : 'pause'}" ${t.status === 'waiting' ? 'disabled' : ''}>${t.status === 'paused' ? 'Resume' : 'Pause'}</button><button class="danger" data-action="admin-table" data-id="${esc(t.id)}" data-operation="cancel">Cancel & refund</button></div></td></tr>`).join('')}</tbody></table></div>${!data.tables?.length ? '<p class="small">No tables to manage.</p>' : ''}</section><div class="admin-grid admin-wide"><section class="panel"><h2>Chip circulation</h2>${(stats.chips || []).map(c => `<div class="admin-event"><span class="small">${esc(c.context)}</span><span class="gold number">${fmt(c.total)}</span></div>`).join('') || '<p class="small">No wallet balances yet.</p>'}<h3 style="margin-top:24px">Ledger</h3>${(data.ledger || []).slice(0, 15).map(l => `<div class="audit-row"><span class="gold">${Number(l.delta) >= 0 ? '+' : ''}${fmt(l.delta)}</span> · ${esc(l.reason)}<br><small>${esc(l.context)} · ${esc(l.reference || '')}</small></div>`).join('')}</section><section class="panel"><h2>Audit trail</h2>${(data.audit || []).slice(0, 25).map(a => `<div class="audit-row">${esc(a.action)} · ${esc(a.target || '')}<br><small>${esc(new Date(a.at).toLocaleString())} · ${esc(typeof a.detail === 'object' ? JSON.stringify(a.detail) : a.detail || '')}</small></div>`).join('') || '<p class="small">Administrative actions will appear here.</p>'}</section></div></main>${footer()}`;
}
function render() { if (state.user && state.page==='events') { renderEvents(); return; } if (!state.user) renderAuth(); else if (state.page === 'room') renderRoom(); else if (state.page === 'admin') renderAdmin(); else if (state.page === 'history') renderHistory(); else renderLobby(); }
let refreshing = false, needsRefresh = false;
async function refresh() {
  if (!state.user || savingAccount) return;
  if (refreshing) { needsRefresh=true; return; }
  refreshing=true;
  const page=state.page, roomId=state.roomId, context=state.context;
  try {
    if (page==='room' && roomId) {
      const room=await api(`/api/tables/${encodeURIComponent(roomId)}`);
      if(state.page!==page || state.roomId!==roomId)return;
      const previous=state.room;
      const alreadyRendered=Boolean(document.querySelector('.game-room'));
      const unchanged=previous?.id===room.id && previous.version===room.version;
      state.room=room;state.context=room.context;
      if(unchanged && alreadyRendered && JSON.stringify(previous.players)===JSON.stringify(room.players))return;
      const scroll=document.querySelector('.hand')?.scrollLeft||0;
      renderRoom();
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
    reconnectAttempts = 0; state.connected = true; state.selected.clear(); updateConnection(); refresh();
  });
  current.addEventListener('message', () => { if (socket !== current) return; if (state.page === 'admin') { const control = document.querySelector('[data-action=refresh-admin]'); if (control) control.textContent = 'Updates available · Refresh'; return; } clearTimeout(refreshTimeout); refreshTimeout = setTimeout(refresh, 80); });
  current.addEventListener('close', () => {
    if (socket !== current) return;
    state.connected = false; updateConnection();
    if (state.user) reconnectTimeout = setTimeout(connect, Math.min(15000,1000 * 2 ** Math.min(reconnectAttempts++,4)) + Math.random()*500);
  });
  current.addEventListener('error', () => {});
}
function updateConnection() { document.querySelectorAll('.connection').forEach(el => { el.classList.toggle('disconnected', !state.connected); el.innerHTML = `<i class="dot"></i>${state.connected ? 'Live connection' : 'Reconnecting'}`; }); }
function updateTimer() {
  document.querySelectorAll('[data-deadline]').forEach(el => {
    const secs=Math.max(0,Math.ceil((Number(el.dataset.deadline)-Date.now()-serverClockOffset)/1000));
    const paused=state.room?.status==='paused';
    el.textContent=paused?'Paused':`${secs}s`;
    el.classList.toggle('time-short',!paused && secs<=8);
    el.setAttribute('aria-label',paused?'Timer paused':`${secs} seconds remaining`);
  });
}
setInterval(updateTimer, 500);
function openModal(title, content) { modal.innerHTML = `<div class="modal-head"><h2>${title}</h2><button class="close" data-action="close-modal" aria-label="Close dialog">×</button></div>${content}`; modal.showModal(); }
function rules(game) {
  if (game === 'bluff') return openModal('Bluff · Street rules','<p>Choose a rank to open the pile. Select 1–4 cards and declare that many cards of the chosen rank, then play them face-down. You may tell the truth or bluff.</p><p>Everyone keeps declaring the same rank. On your turn, play or skip. After all players skip consecutively, the pile is cleared and the next player chooses a new rank.</p><p>After each play, other players have eight seconds to call bluff. A liar collects the whole pile; if the declaration was honest, the challenger collects it. Either challenge outcome resets the rank. The player after the declarer starts again.</p><p>Your final cards must survive the challenge window before you win the pot. A timed-out turn skips automatically.</p>');
  if (game === 'chromatic') return openModal('Chromatic · Street rules','<p>Match the colour or symbol. Reverse changes direction, Skip jumps a player, and Wild chooses the colour.</p><p><strong>Stack +2 on +2. Stack +4 on +2 or +4.</strong> You cannot put +2 on +4. If you cannot or do not want to stack, collect the total penalty and miss your turn. Street Wild +4 has no legality challenge.</p><p>Declare “One card!” as you play down to one. Opponents can catch a missed declaration for a two-card penalty. Normal draws allow you to play the drawn card if it matches, or keep it and pass.</p><p>First to 500 points wins the match and the pot. A final penalty card makes the next player draw before round points are counted.</p>');
  const extra = {
    poker: '<p>No-limit Texas Hold’em for 2–6 players. Your buy-in becomes your table stack. Two private cards and five community cards form your best five-card hand.</p><ul><li>Small blind is 1% of the buy-in, rounded down (minimum 1); big blind is twice that. Raise amounts are total wagers for the current street.</li><li>All-ins create side pots. Short all-ins do not automatically reopen betting. Tied pots split, with odd chips awarded clockwise after the dealer.</li><li>Sessions last up to 10 hands. Any player can request cash-out after the current hand or cash out between hands. Each remaining stack returns to its owner.</li><li>Timeout checks when possible, otherwise folds. Cancellation refunds the interrupted hand’s bets and preserves completed hand results.</li></ul>',
    ohhell: '<p>Oh Hell for 3–6 players. Nine rounds deal 1, 2, 3, 4, 5, 4, 3, 2, then 1 card. The exposed card determines trump.</p><ul><li>Bid your expected tricks. The dealer bids last and cannot make the total bids equal the number of tricks.</li><li>Follow the led suit when you can. Highest trump wins; otherwise highest card of the led suit wins. The winner leads next.</li><li>An exact bid earns 10 plus the bid; a miss earns zero. Highest final score wins. Tied leaders split the pot; odd chips follow seating order.</li></ul>',
    rummy: '<p>13-card Indian Rummy for 2–6 players using two decks and four printed jokers. The indicator rank is also wild.</p><ul><li>Draw from stock or the discard pile, then discard one card. A discarded joker cannot be picked up.</li><li>Declare by selecting a discard that leaves all 13 cards in valid sets or sequences, including at least two sequences and one pure sequence. Aces may be low or high, without wrapping.</li><li>Check my groups privately finds a valid grouping or calculates penalty points. Invalid declarations are rejected.</li><li>Dropping before your first draw costs 20 penalty points; later drops cost 40. Other penalties are capped at 80. Penalties are informational: this table uses a fixed ante, and the winner receives the pot.</li></ul>'
  };
  if (extra[game]) return openModal(`${gameName(game)} · The rules`, extra[game] + '<p>Free chips have no monetary value. Waiting rooms expire after 30 minutes; unresolved sessions are canceled after one hour.</p>');
  const bluff = '<p>A classic game of nerve for 3–6 players.</p><ul><li>All 52 cards are dealt. On your turn, play 1–4 cards face down, declaring the rank shown by the table. You may tell the truth—or bluff.</li><li>The declared rank moves from Ace through King, then returns to Ace.</li><li>After every play, other players have 8 seconds to call bluff. If any played card differs from the declared rank, the player takes the pile. Otherwise the challenger takes it.</li><li>Your last card must survive the challenge window before you win. The winner takes the entire pot.</li><li>On a turn timeout, the server plays a card for the absent player. Rejoin with the same account to recover your hand.</li></ul>';
  const chromatic = '<p>Classic UNO rules, with original Chromatic artwork. 2–6 players; seven cards each; first to 500 points wins the match and pot.</p><ul><li>Match color or value, or play a wild. A playable drawn card can be played immediately; no other card can be played after drawing. You may keep it and pass.</li><li>No stacking, jump-in, or 7–0 swaps. Two-player Reverse skips the opponent.</li><li>Wild +4 is legal only without a matching color. The recipient may challenge: guilty player draws four, otherwise challenger draws six. Evidence is private to the challenger.</li><li>Use One card! before playing down to one, or immediately afterward. Another player can catch a missed call for two penalty cards before the next turn begins.</li><li>Round winners score remaining numbers at face value, action cards at 20 and wilds at 50. Final draw penalties count before scoring. The next round starts after 15 seconds.</li></ul>';
  openModal(`${gameName(game)} · The rules`, `${game === 'bluff' ? bluff : chromatic}<p>Chips are free and have no monetary value. An administrator can cancel a disrupted match and refund its stakes. Waiting rooms expire after 30 minutes; unresolved matches are refunded after one hour from the deal.</p>`);
}
function createTable(game) {
  const event = state.lobby?.events?.find(e => e.id === state.context);
  const min = game === 'poker' ? 10 : 0;
  openModal('Your table. Your pace.', `<form id="create-table-form" class="stack"><input type="hidden" name="game" value="${game}"><label>Seats<select name="capacity">${Array.from({length:['bluff','ohhell'].includes(game)?4:5},(_,i)=>i+(['bluff','ohhell'].includes(game)?3:2)).map(n=>`<option value="${n}" ${n===6?'selected':''}>${n} players</option>`).join('')}</select></label><label>Table name<input name="name" value="${esc(state.user.name)}’s table" maxlength="48" required></label><label>${game === 'poker' ? event ? 'Buy-in' : 'Starting stack' : 'Optional event stake'} per player${event ? `${event.minStake!==undefined?`<input name="stake" type="number" min="${Math.max(min,event.minStake)}" max="${event.maxStake}" value="${Math.max(min,event.minStake)}" step="1" required>`:`<select name="stake">${event.stakes.map(n=>`<option value="${n}">${fmt(n)} chips</option>`).join('')}</select>`}` : game!=='poker' ? '<input name="stake" type="hidden" value="0"><span>Scoring only · no ante</span>' : `<input name="stake" type="number" min="${min}" max="100000" step="1" value="250" list="stake-presets" required><datalist id="stake-presets">${[min,100,250,500,1000,5000].map(n=>`<option value="${n}">`).join('')}</datalist>`}</label><p class="small">${event ? 'Stakes follow the event owner’s settings.' : game==='poker' ? 'Choose any whole-chip buy-in from 10 to 100,000.' : 'Casual card games use their own scores, with no wallet or ante.'}</p>${!event ? `<label>Computer opponents<select name="bots"><option value="0">Friends only</option>${[1,2,3,4,5].map(n=>`<option value="${n}">${n} bot${n>1?'s':''} · computer player</option>`).join('')}</select></label><p class="small">Casual tables have no wallet cost, rewards or event leaderboard impact. Friends can join open seats.</p><label class="check"><input type="checkbox" name="private"> Private room · join by code</label>` : ''}${game==='poker'?'<div class="row"><label>Small blind (optional)<input name="smallBlind" type="number" min="1" max="99999" placeholder="Automatic"></label><label>Big blind (optional)<input name="bigBlind" type="number" min="2" max="100000" placeholder="Automatic"></label></div>':''}${event?'<label class="check"><input type="checkbox" name="private"> Private event table · registered invitees only</label>':''}<p class="form-error" role="alert"></p><button class="primary">Create ${gameName(game)} table</button></form>`);
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
    await api(`/api/tables/${encodeURIComponent(state.roomId)}/action`, {actionId:crypto.randomUUID(),expectedVersion:state.room.version,action});
    state.selected.clear();
    await refresh();
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
    if(action==='events') { state.page='events'; state.context='casual'; await refresh(); }
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
    else if (action === 'join-code') openModal('An invitation to play.', '<form id="join-code-form" class="stack"><label>Room code<input name="code" required maxlength="20" autocomplete="off" placeholder="Enter your invitation code"></label><p class="form-error" role="alert"></p><button class="primary">Take a seat</button></form>');
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
    else if (action === 'special-action') await submitAction({type:button.dataset.move,cards:[...state.selected],source:button.dataset.source,amount:Number(button.dataset.amount ?? document.querySelector('#bet-amount')?.value ?? document.querySelector('#bid-amount')?.value)});
    else if (action === 'chromatic-action') await submitAction({type:button.dataset.move,target:button.dataset.target,color:document.querySelector('#wild-color')?.value});
    else if (action === 'draw-card') await submitAction({ type: 'draw' });
    else if (action === 'challenge') await submitAction({ type: 'challenge' });
    else if (action === 'mute') { audioPrefs.muted = !audioPrefs.muted; localStorage.setItem('venatus-sound', JSON.stringify(audioPrefs)); button.textContent = `Sound ${audioPrefs.muted ? 'off' : 'on'}`; button.setAttribute('aria-label', `${audioPrefs.muted ? 'Unmute' : 'Mute'} sound`); sound(); }
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
      const result = await api('/api/tables', { name: values.get('name'), game: values.get('game'), stake: Number(values.get('stake')), private: values.has('private'), context: state.context, capacity: Number(values.get('capacity')||6), ...(values.get('smallBlind')?{smallBlind:Number(values.get('smallBlind'))}:{}), ...(values.get('bigBlind')?{bigBlind:Number(values.get('bigBlind'))}:{}), bots: Number(values.get('bots') || 0), practice: state.context==='casual' });
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
  try { const me = await api('/api/me'); state.user = me.user; state.setupRequired = me.setupRequired; if (state.user) { restoreSeat(me); await refresh(); connect(); await joinInvitation(); } else { renderAuth(); } }
  catch (error) { app.innerHTML = `<main class="initial">${brand()}<h2>The card room is resting.</h2><p>${esc(error.message)}</p><button data-action="reload">Try again</button></main>`; }
}
function restoreSeat(me) {
  if (me.activeTable && !pendingInvite) { state.roomId=me.activeTable.id; state.context=me.activeTable.context; state.page='room'; }
}
boot();
