// Bot decisions are made from the same player-private view sent to a human.
// Keep strategy here free of any access to engine state, deck, or other hands.
import { analyzeRummy } from './rummy.js';
import { evaluateHand } from './poker.js';

const LEVEL = { easy: 0, medium: 1, hard: 2 };
const bounded = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const rankValue = rank => ({ A: 14, K: 13, Q: 12, J: 11 })[rank] || Number(rank) || 0;
const rankOrder = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];

function pokerStrength(view) {
  const hand = view.hand || [];
  if (hand.length !== 2) return 0.35;
  const [a,b] = hand;
  const hi = Math.max(rankValue(a.rank), rankValue(b.rank));
  const lo = Math.min(rankValue(a.rank), rankValue(b.rank));
  const pair = a.rank === b.rank;
  const suited = a.suit === b.suit;
  const gap = hi - lo - 1;
  if (view.board?.length >= 3) {
    const { rank } = evaluateHand([...hand, ...view.board]);
    const base = [0.17,0.37,0.58,0.71,0.79,0.84,0.93,0.98,0.995][rank[0]] ?? 0.25;
    const kicker = (rank[1] || 7) / 1400 + (rank[2] || 0) / 20000;
    // On the flop/turn, a weak made hand should not be treated as a lock.
    const drawCredit = view.board.length < 5 && rank[0] < 4 ? 0.035 : 0;
    return bounded(base + kicker + drawCredit, 0.05, 0.999);
  }
  if (pair) return bounded(0.49 + (hi - 2) * 0.027, 0.49, 0.82);
  let strength = 0.19 + (hi - 2) * 0.023 + (lo - 2) * 0.009;
  if (suited) strength += 0.055;
  if (gap === 0) strength += 0.035;
  else if (gap === 1) strength += 0.018;
  else if (gap >= 4) strength -= 0.035;
  if (hi === 14 && lo >= 10) strength += 0.07;
  return bounded(strength, 0.12, 0.72);
}

function pokerAction(v, random, level) {
  if (v.phase === 'between-hands') return { type: 'next-hand' };
  const actions = new Set(v.legalActions || []);
  if (!actions.size) return null;
  const can = type => actions.has(type);
  if (can('check') && !can('raise')) return { type: 'check' };

  const strength = pokerStrength(v);
  const call = Math.max(0, v.toCall || 0);
  const pot = Math.max(0, v.pot || 0);
  const odds = call ? call / (pot + call) : 0;
  const cautious = [0.11, 0.055, 0.015][level];
  const callBar = bounded(odds + cautious + (v.street === 'preflop' ? 0.035 : 0), 0.14, 0.88);

  if (can('raise') && strength > [0.84,0.73,0.65][level] + (call ? 0.05 : 0) && random() > [0.45,0.24,0.08][level]) {
    const min = Math.max(1, Math.ceil(v.minRaise || 1));
      const max = Math.floor(v.maxRaise || min);
      if (max > 0) {
      const potSized = Math.ceil((v.bets?.[v.turn] || 0) + Math.max(v.bigBlind || 1, pot * [0.4,0.55,0.7][level]));
        // A short all-in may legally be smaller than the normal minimum raise.
        const amount = max < min ? max : bounded(potSized, min, max);
        return { type: 'raise', amount };
    }
  }
  if (can('call') && strength >= callBar) return { type: 'call' };
  if (can('check')) return { type: 'check' };
  if (can('call') && strength >= callBar * 0.78 && random() > [0.45,0.25,0.1][level]) return { type: 'call' };
  if (can('allin') && strength > [0.82,0.7,0.61][level] && random() > [0.65,0.4,0.22][level]) return { type: 'allin' };
  return can('fold') ? { type: 'fold' } : can('call') ? { type: 'call' } : null;
}

function ohHellBid(v, level) {
  const trump = v.trumpCard?.suit;
  let estimate = 0;
  for (const card of v.hand || []) {
    const r = rankValue(card.rank);
    if (card.suit === trump) estimate += 0.32 + ((r - 2) / 12) * 0.5;
    else if (r === 14) estimate += 0.56;
    else if (r === 13) estimate += 0.29;
    else if (r === 12) estimate += 0.16;
    else if (r === 11) estimate += 0.08;
  }
  // A hand with several trump cards is stronger than the sum of small trumps.
  const trumps = (v.hand || []).filter(c => c.suit === trump).length;
  estimate += Math.max(0, trumps - 1) * 0.12;
  estimate = bounded(estimate * [0.82,1,1.04][level], 0, v.handSize || 0);
  const legal = v.legalBids || [];
  if (!legal.length) return { type: 'bid', amount: 0 };
  return { type: 'bid', amount: legal.reduce((best, bid) =>
    Math.abs(bid - estimate) < Math.abs(best - estimate) ? bid : best, legal[0]) };
}

function ohHellPlay(v, random, level) {
  const legal = new Set(v.legalCardIds || []);
  const hand = (v.hand || []).filter(c => legal.has(c.id));
  if (!hand.length) return null;
  const currentTricks = v.tricks?.[v.turn] || 0;
  const target = v.bids?.[v.turn] || 0;
  const mustWin = currentTricks < target;
  const trump = v.trumpCard?.suit;
  const trick = v.trick || [];
  const leadSuit = trick[0]?.card.suit;
  const cardStrength = c => (c.suit === trump ? 100 : c.suit === leadSuit || !leadSuit ? 50 : 0) + rankValue(c.rank);
  const strongestSoFar = trick.reduce((best,p) => !best || cardStrength(p.card) > cardStrength(best.card) ? p : best, null);
  const isLast = trick.length === (v.players?.length || 0) - 1;
  if (mustWin && strongestSoFar) {
    const winners = hand.filter(c => cardStrength(c) > cardStrength(strongestSoFar.card));
    if (winners.length) return { type: 'play', cards: [winners.sort((a,b) => cardStrength(a)-cardStrength(b))[0].id] };
  }
  if (isLast && strongestSoFar) {
    const winners = hand.filter(c => cardStrength(c) > cardStrength(strongestSoFar.card));
    if (mustWin && winners.length) return { type: 'play', cards: [winners.sort((a,b) => cardStrength(a)-cardStrength(b))[0].id] };
    if (!mustWin && !winners.length) return { type: 'play', cards: [hand.sort((a,b) => cardStrength(a)-cardStrength(b))[0].id] };
  }
  // On lead, use likely winners only when behind the bid; otherwise preserve them.
  const sorted = [...hand].sort((a,b) => cardStrength(a)-cardStrength(b));
  if (!trick.length && mustWin) {
    const leadIndex = level === 0 && sorted.length > 1 && random() < 0.45 ? Math.max(0, sorted.length - 2) : sorted.length - 1;
    return { type: 'play', cards: [sorted[leadIndex].id] };
  }
  return { type: 'play', cards: [sorted[0].id] };
}

function chromaticColor(hand, colors, activeColor, hard) {
  const counts = Object.fromEntries(colors.map(color => [color, hand.filter(c => c.color === color).length]));
  return [...colors].sort((a,b) => counts[b]-counts[a] || (hard && a === activeColor ? -1 : 0))[0] || colors[0];
}

function chromaticAction(v, random, level) {
  if (v.phase === 'round-end') return { type: 'next-round' };
  const color = chromaticColor(v.hand || [], v.colors || [], v.activeColor, level === 2);
  if (v.phase === 'challenge') {
    // The legality evidence is deliberately private to the challenged player.
    // Other bots cannot inspect the offender's hidden hand and should mostly accept.
    if (v.evidence?.illegal) return { type: 'challenge' };
    return level === 2 && random() < 0.08 ? { type: 'challenge' } : { type: 'accept' };
  }
  if (v.phase === 'choose-color') return { type: 'choose-color', color };
  if (v.canDeclare && v.catchablePlayer === v.turn) return { type: 'declare' };
  if (v.catchablePlayer && v.catchablePlayer !== v.turn && level > 0) return { type: 'catch', target: v.catchablePlayer };

  const legal = new Set(v.legalCardIds || []);
  const cards = (v.hand || []).filter(c => legal.has(c.id));
  if (v.phase === 'drawn' && cards.length && cards[0].color === 'wild' && random() < [0.72,0.43,0.18][level]) return { type: 'pass' };
  if (cards.length) {
    const nextCount = v.counts?.[v.players?.[(v.players.indexOf(v.turn)+1) % v.players.length]] || 0;
    const sortValue = c => {
      const wildCost = c.value === 'wilddraw4' ? 100 : c.value === 'wild' ? 80 : 0;
      const actionBonus = ['skip','reverse','draw2'].includes(c.value) ? (nextCount <= 2 ? -30 : -8) : 0;
      const colorKeep = c.color === color ? -12 : 0;
      return wildCost + actionBonus + colorKeep + (c.value === '0' ? -1 : 0);
    };
    const card = [...cards].sort((a,b) => sortValue(a)-sortValue(b))[0];
    const declare = (v.hand || []).length === 2;
    return { type: 'play', cards: [card.id], color: card.color === 'wild' ? color : undefined, declare };
  }
  return { type: v.phase === 'drawn' ? 'pass' : 'draw' };
}

function bluffChallenge(v, random, level) {
  const last = v.lastPlay;
  if (!last) return null;
  const rank = last.rank || v.requiredRank;
  const own = (v.hand || []).filter(c => c.rank === rank).length;
  const count = last.count || 1;
  if (count > Math.max(0, 4 - own)) return { type: 'challenge' };
  const targetCount = v.counts?.[last.player] || 0;
  const danger = (count >= 2 ? 0.2 : 0) + (targetCount <= 1 ? 0.2 : 0) + own * 0.11;
  return random() < bounded(danger * [0.25,0.65,1.05][level], 0.01, 0.68) ? { type: 'challenge' } : null;
}

function bluffAction(v, random, level) {
  if (v.phase === 'challenge') return bluffChallenge(v, random, level);
  const hand = v.hand || [];
  if (!hand.length) return { type: 'skip' };
  let rank = v.requiredRank;
  if (v.houseRules === 'street' && !rank) {
    rank = [...rankOrder].sort((a,b) => hand.filter(c => c.rank === b).length - hand.filter(c => c.rank === a).length)[0];
  }
  rank ||= rankOrder[0];
  const matching = hand.filter(c => c.rank === rank);
  if (matching.length) return { type: 'play', rank, cards: matching.slice(0,4).map(c => c.id) };
  if (v.houseRules === 'street' && v.requiredRank) return { type: 'play', rank, cards: [hand[0].id] };
  // In the rotating-rank variant a card must be played, so a bluff is forced.
  return { type: 'play', rank, cards: [hand[0].id] };
}

function rummyDraw(v, level) {
  const hand = v.hand || [];
  if (!v.canTakeDiscard || !v.topCard) return { type: 'draw', source: 'stock' };
  const before = analyzeRummy(hand, v.wildRank).penalty;
  const extended = [...hand, v.topCard];
  const after = Math.min(...extended.map(discard => analyzeRummy(extended.filter(c => c.id !== discard.id), v.wildRank).penalty));
  const connects = hand.some(c => c.suit === v.topCard.suit && Math.abs(rankValue(c.rank)-rankValue(v.topCard.rank)) <= 2 || c.rank === v.topCard.rank);
  return { type: 'draw', source: (after < before || (connects && level > 0)) ? 'discard' : 'stock' };
}

function rummyDiscard(v, level) {
  const hand = v.hand || [];
  if (!hand.length) return null;
  let best = null;
  for (const card of hand) {
    const remaining = hand.filter(c => c.id !== card.id);
    const analysis = analyzeRummy(remaining, v.wildRank);
    if (analysis.valid) return { type: 'declare', cards: [card.id] };
    const wild = card.rank === 'JOKER' || card.rank === v.wildRank;
    const partners = remaining.filter(other => other.suit === card.suit && Math.abs(rankValue(other.rank)-rankValue(card.rank)) <= 2 || other.rank === card.rank).length;
    const score = analysis.penalty + (wild ? [2,3,4][level] : 0) + Math.min(partners,2) * [0.75,1.5,2.25][level];
    if (!best || score < best.score) best = { card, score };
  }
  return { type: 'discard', cards: [best.card.id] };
}

export function botAction(view, random = Math.random, difficulty = 'medium') {
  const level = LEVEL[difficulty] ?? LEVEL.medium;
  if (view.type === 'poker') return pokerAction(view, random, level);
  if (view.type === 'ohhell') {
    if (view.phase === 'round-end') return { type: 'next-round' };
    return view.phase === 'bid' ? ohHellBid(view, level) : ohHellPlay(view, random, level);
  }
  if (view.type === 'chromatic') return chromaticAction(view, random, level);
  if (view.type === 'bluff') return bluffAction(view, random, level);
  if (view.phase === 'draw') return rummyDraw(view, level);
  return rummyDiscard(view, level);
}
