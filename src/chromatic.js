import { randomInt } from 'node:crypto';

export const COLORS = ['ruby', 'emerald', 'sapphire', 'gold'];
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const shuffle = cards => {
  for (let i = cards.length - 1; i > 0; i--) { const j = randomInt(i + 1); [cards[i], cards[j]] = [cards[j], cards[i]]; }
  return cards;
};
export function chromaticDeck() {
  const cards = [];
  for (const color of COLORS) for (const value of ['0','1','2','3','4','5','6','7','8','9','skip','reverse','draw2']) {
    for (let n = 0; n < (value === '0' ? 1 : 2); n++) cards.push({ id: `${color}-${value}-${n}`, color, value });
  }
  for (const value of ['wild','wilddraw4']) for (let n = 0; n < 4; n++) cards.push({ id: `${value}-${n}`, color: 'wild', value });
  return cards;
}
const next = (g, id = g.turn, distance = 1) => g.players[(g.players.indexOf(id) + distance * g.direction + g.players.length * 4) % g.players.length];
const start = (g, id, now, phase = 'play', ms = 30000) => { g.turn = id; g.phase = phase; g.deadline = now + ms; g.drawnCardId = null; };
const matches = (g, c) => g.pendingPenalty ? (c.value === 'wilddraw4' || (g.penaltyKind === 'draw2' && c.value === 'draw2')) : c.color === 'wild' || c.color === g.activeColor || c.value === g.discard.at(-1).value;
function draw(g, id, count) {
  const result = [];
  for (let n = 0; n < count; n++) {
    if (!g.drawPile.length && g.discard.length > 1) { const top = g.discard.pop(); g.drawPile = shuffle(g.discard); g.discard = [top]; }
    if (!g.drawPile.length) break;
    const c = g.drawPile.pop(); g.hands[id].push(c); result.push(c);
  }
  return result;
}
const value = c => c.color === 'wild' ? 50 : /^\d$/.test(c.value) ? Number(c.value) : 20;
function endRound(g, id, now) {
  g.roundWinner = id;
  g.roundPoints = g.players.filter(p => p !== id).reduce((sum, p) => sum + g.hands[p].reduce((s,c) => s + value(c), 0), 0);
  g.scores[id] += g.roundPoints; g.catchablePlayer = null; g.pendingDraw4 = null;
  if (g.scores[id] >= g.targetScore) { g.phase = 'finished'; g.winner = id; g.deadline = null; g.message = '500 points reached. The match winner receives the pot.'; }
  else { start(g, id, now, 'round-end', 15000); g.message = `Round complete: ${g.roundPoints} points awarded. Next round in 15 seconds.`; }
}
function deal(g, now) {
  g.round++; g.direction = 1; g.catchablePlayer = null; g.pendingDraw4 = null; g.evidence = null; g.announced = null; g.pendingPenalty = 0; g.penaltyKind = null;
  g.drawPile = shuffle(chromaticDeck()); g.discard = []; g.hands = Object.fromEntries(g.players.map(p => [p, []]));
  for (let n=0;n<7;n++) for (const p of g.players) draw(g,p,1);
  let top;
  do { top = g.drawPile.pop(); if (top.value === 'wilddraw4') { g.drawPile.unshift(top); shuffle(g.drawPile); } } while (top.value === 'wilddraw4');
  g.discard.push(top); g.activeColor = top.color === 'wild' ? null : top.color;
  const first = next(g, g.dealer); start(g, first, now); g.message = `Round ${g.round}. Seven cards dealt.`;
  if (top.value === 'wild') { g.phase = 'choose-color'; g.message = 'Opening wild: choose the starting color, then play.'; }
  if (top.value === 'reverse') { g.direction = -1; g.turn = g.dealer; }
  if (top.value === 'skip') g.turn = next(g, first);
  if (top.value === 'draw2') { draw(g, first, 2); g.turn = next(g, first); }
}
export function createChromatic(players, now = Date.now(), options = {}) {
  assert(Array.isArray(players) && players.length >= 2 && players.length <= 6 && new Set(players).size === players.length && players.every(p => typeof p === 'string' && p && !['__proto__','constructor','prototype'].includes(p)), 'Chromatic needs 2–6 distinct players');
  const g = { type: 'chromatic', rulesVersion: 2, players: [...players], dealer: players[randomInt(players.length)], round: 0,
    scores: Object.fromEntries(players.map(p => [p,0])), targetScore: 500, winner: null, moves: 0, houseRules: options.houseRules === 'street' ? 'street' : 'classic' };
  deal(g,now); return g;
}
function resolveDraw4(g, challenged, now) {
  const pending = g.pendingDraw4;
  g.catchablePlayer = null; g.announced = null;
  if (challenged) g.evidence = { viewer: pending.target, cards: pending.hand, illegal: pending.illegal, player: pending.player };
  const guilty = challenged && pending.illegal;
  draw(g, guilty ? pending.player : pending.target, guilty ? 4 : challenged ? 6 : 4);
  g.pendingDraw4 = null;
  g.message = guilty ? 'Challenge succeeded. The Wild +4 player draws four; the challenger may play.' : challenged ? 'Challenge failed. The challenger draws six and misses their turn.' : 'Four cards drawn. The next turn begins.';
  if (!g.hands[pending.player].length) endRound(g,pending.player,now);
  else start(g,guilty ? pending.target : next(g,pending.target),now);
}
function action(g,id,a,now) {
  if (a.type === 'catch') {
    assert(g.catchablePlayer === a.target && a.target !== id && g.hands[a.target]?.length === 1, 'No missed one-card declaration to catch');
    draw(g,a.target,2); g.catchablePlayer = null; g.message = 'Missed one-card declaration caught: two penalty cards.'; return;
  }
  if (a.type === 'declare') {
    assert(g.catchablePlayer === id || (g.turn === id && ['play','drawn'].includes(g.phase) && g.hands[id].length === 2), 'Declare when playing down to one card');
    if (g.catchablePlayer === id) g.catchablePlayer = null;
    g.announced = id; g.message = 'One card declared!'; return;
  }
  if (g.phase === 'round-end') {
    assert(a.type === 'next-round', 'Start the next round'); g.dealer = g.players[(g.players.indexOf(g.dealer)+1)%g.players.length]; deal(g,now); return;
  }
  assert(id === g.turn, 'It is not your turn');
  if (g.phase === 'challenge') {
    assert(['challenge','accept'].includes(a.type), 'Accept four cards or challenge the Wild +4');
    g.catchablePlayer = null; resolveDraw4(g,a.type === 'challenge',now); return;
  }
  if (g.phase === 'choose-color') {
    assert(a.type === 'choose-color' && COLORS.includes(a.color), 'Choose a starting color');
    g.activeColor = a.color; start(g,id,now); return;
  }
  if (a.type === 'pass') {
    assert(g.phase === 'drawn', 'You can pass only after drawing'); g.catchablePlayer = null; g.announced = null;
    start(g,next(g),now); g.message = 'The drawn card was kept. Turn passed.'; return;
  }
  if (a.type === 'draw') {
    assert(g.phase === 'play', 'You have already drawn'); g.catchablePlayer = null; g.announced = null; g.evidence = null;
    if (g.pendingPenalty) {
      const amount=g.pendingPenalty; draw(g,id,amount); g.pendingPenalty=0; g.penaltyKind=null;
      start(g,next(g),now); g.message=`${amount} penalty cards collected. Turn skipped.`; return;
    }
    const drawn = draw(g,id,1)[0];
    if (drawn && matches(g,drawn)) { start(g,id,now,'drawn'); g.drawnCardId = drawn.id; g.message = 'Play the drawn card, or keep it and pass.'; }
    else { start(g,next(g),now); g.message = drawn ? 'Card drawn. The next player takes their turn.' : 'No cards available to draw. Turn passed.'; }
    return;
  }
  assert(a.type === 'play' && ['play','drawn'].includes(g.phase), 'Invalid action');
  assert(Array.isArray(a.cards) && a.cards.length === 1, 'Select exactly one card');
  const c = g.hands[id].find(c => c.id === a.cards[0]); assert(c && matches(g,c), 'Play a matching card or a wild');
  assert(g.phase !== 'drawn' || c.id === g.drawnCardId, 'Only the card just drawn can be played');
  if (c.color === 'wild') assert(COLORS.includes(a.color), 'Choose a wild color');
  const illegal = c.value === 'wilddraw4' && g.hands[id].some(other => other.color === g.activeColor);
  g.catchablePlayer = null; g.evidence = null;
  g.hands[id] = g.hands[id].filter(other => other.id !== c.id); g.discard.push(c);
  g.activeColor = c.color === 'wild' ? a.color : c.color;
  if (g.hands[id].length === 1 && !a.declare && g.announced !== id) g.catchablePlayer = id;
  g.announced = null;
  if (g.houseRules === 'street' && ['draw2','wilddraw4'].includes(c.value)) {
    g.pendingPenalty=(g.pendingPenalty||0)+(c.value==='draw2'?2:4); g.penaltyKind=c.value;
    if (!g.hands[id].length) { draw(g,next(g,id),g.pendingPenalty); g.pendingPenalty=0; g.penaltyKind=null; endRound(g,id,now); }
    else { start(g,next(g,id),now); g.message=`Stack is +${g.pendingPenalty}. Stack a ${c.value==='draw2'?'+2 or +4':'+4'}, or draw the total and skip your turn.`; }
    return;
  }
  if (c.value === 'wilddraw4') {
    const target = next(g,id); g.pendingDraw4 = { player:id,target,illegal,hand:structuredClone(g.hands[id]) };
    start(g,target,now,'challenge',8000); g.message = 'Wild +4: accept four cards or challenge its legality.'; return;
  }
  let distance = 1;
  if (c.value === 'reverse') { g.direction *= -1; if(g.players.length === 2) distance = 2; }
  if (c.value === 'skip') distance = 2;
  if (c.value === 'draw2') { draw(g,next(g,id),2); distance = 2; }
  g.message = `${c.value} played. Active color: ${g.activeColor}.`;
  if (!g.hands[id].length) endRound(g,id,now); else start(g,next(g,id,distance),now);
}
export function actChromatic(original,id,a,now=Date.now()) {
  assert(original.players.includes(id), 'You are not seated'); assert(original.phase !== 'finished' && now < original.deadline, 'The action window has ended');
  assert(a && typeof a === 'object', 'Invalid action'); const g = structuredClone(original); action(g,id,a,now); g.moves++; return g;
}
export function tickChromatic(original,now=Date.now()) {
  if (original.phase === 'finished' || now < original.deadline) return original;
  const g = structuredClone(original);
  if(g.phase === 'challenge') resolveDraw4(g,false,now);
  else if(g.phase === 'round-end') { g.dealer=next(g,g.dealer); deal(g,now); }
  else if(g.phase === 'choose-color') { g.activeColor = COLORS[0]; start(g,g.turn,now); }
  else if(g.phase === 'drawn') action(g,g.turn,{type:'pass'},now);
  else { action(g,g.turn,{type:'draw'},now); if(g.phase === 'drawn') action(g,g.turn,{type:'pass'},now); }
  g.moves++; return g;
}
export function viewChromatic(g,id) {
  const hand = structuredClone(g.hands[id] || []);
  return { type:g.type,rulesVersion:2,players:[...g.players],turn:g.turn,phase:g.phase,winner:g.winner,deadline:g.deadline,message:g.message,moves:g.moves,
    houseRules:g.houseRules||'classic',pendingPenalty:g.pendingPenalty||0,penaltyKind:g.penaltyKind,
    hand,counts:Object.fromEntries(g.players.map(p=>[p,g.hands[p].length])),topCard:structuredClone(g.discard.at(-1)),activeColor:g.activeColor,direction:g.direction,
    colors:[...COLORS],drawCount:g.drawPile.length,discardCount:g.discard.length,scores:{...g.scores},targetScore:g.targetScore,round:g.round,roundWinner:g.roundWinner,roundPoints:g.roundPoints,
    legalCardIds:g.turn===id && ['play','drawn'].includes(g.phase) ? hand.filter(c=>matches(g,c) && (g.phase!=='drawn' || c.id===g.drawnCardId)).map(c=>c.id) : [],
    drawnCardId:g.turn===id ? g.drawnCardId : null,catchablePlayer:g.catchablePlayer,canDeclare:g.catchablePlayer===id || (g.turn===id && ['play','drawn'].includes(g.phase) && hand.length===2),
    pendingDraw4:g.pendingDraw4 ? {player:g.pendingDraw4.player,target:g.pendingDraw4.target} : null,
    evidence:g.evidence?.viewer===id ? structuredClone(g.evidence) : null };
}
