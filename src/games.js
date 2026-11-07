import { randomInt } from 'node:crypto';
import { createChromatic, actChromatic, tickChromatic, viewChromatic } from './chromatic.js';
import { createOhHell, actOhHell, tickOhHell, viewOhHell } from './ohhell.js';
import { createRummy, actRummy, tickRummy, viewRummy } from './rummy.js';
import { createPoker, actPoker, tickPoker, viewPoker } from './poker.js';

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const COLORS = ['emerald', 'ruby', 'gold', 'sapphire'];
const TURN_MS = 30000;
const CHALLENGE_MS = 8000;

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function shuffle(cards) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

function nextPlayer(game, from = game.turn, distance = 1) {
  const index = game.players.indexOf(from);
  return game.players[(index + distance * (game.direction ?? 1) + game.players.length * 4) % game.players.length];
}

function startTurn(game, player, now) {
  game.turn = player;
  game.phase = 'play';
  game.deadline = now + TURN_MS;
}

function finish(game, winner) {
  game.winner = winner;
  game.phase = 'finished';
  game.deadline = null;
  game.message = 'The hand is complete. The winner receives the pot.';
}

export function createGame(type, playerIds, now = Date.now(), options = {}) {
  if (type === 'ohhell') return createOhHell(playerIds, now);
  if (type === 'rummy') return createRummy(playerIds, now);
  if (type === 'poker') return createPoker(playerIds, now, options);
  if (type === 'chromatic') return createChromatic(playerIds, now);
  requireCondition(['bluff', 'chromatic'].includes(type), 'Unknown game');
  requireCondition(Array.isArray(playerIds) && playerIds.every(id => typeof id === 'string' && id.length && !['__proto__', 'constructor', 'prototype'].includes(id)), 'Invalid player identifiers');
  requireCondition(new Set(playerIds).size === playerIds.length, 'Players must be unique');
  requireCondition(playerIds.length >= (type === 'bluff' ? 3 : 2) && playerIds.length <= 6, 'Incorrect player count');
  const game = { type, players: [...playerIds], turn: playerIds[0], phase: 'play', winner: null,
    deadline: now + TURN_MS, hands: Object.fromEntries(playerIds.map(id => [id, []])), message: 'The cards are dealt. Your table is ready.', moves: 0 };
  if (type === 'bluff') {
    const deck = shuffle(['clubs', 'diamonds', 'hearts', 'spades'].flatMap(suit => RANKS.map(rank => ({ id: `${suit}-${rank}`, rank, suit }))));
    deck.forEach((card, i) => game.hands[playerIds[i % playerIds.length]].push(card));
    Object.assign(game, { rankIndex: 0, pile: [], lastPlay: null, reveal: null });
  } else {
    let serial = 0;
    const deck = [];
    for (const color of COLORS) {
      for (const value of ['0', ...Array.from({ length: 9 }, (_, i) => String(i + 1)), 'skip', 'reverse', 'draw2']) {
        for (let n = 0; n < (value === '0' ? 1 : 2); n++) deck.push({ id: `c${serial++}`, color, value });
      }
    }
    for (let n = 0; n < 8; n++) deck.push({ id: `c${serial++}`, color: 'wild', value: 'wild' });
    shuffle(deck);
    playerIds.forEach(id => { game.hands[id] = deck.splice(0, 7); });
    const opening = deck.findIndex(card => /^\d$/.test(card.value));
    const top = deck.splice(opening, 1)[0];
    Object.assign(game, { drawPile: deck, discard: [top], activeColor: top.color, direction: 1 });
  }
  return game;
}

function selectedCards(game, userId, ids, max) {
  requireCondition(Array.isArray(ids) && ids.length >= 1 && ids.length <= max && new Set(ids).size === ids.length, `Select 1–${max} distinct cards`);
  const hand = game.hands[userId];
  const cards = ids.map(id => hand.find(card => card.id === id));
  requireCondition(cards.every(Boolean), 'You do not hold those cards');
  return cards;
}

function removeCards(game, userId, cards) {
  const ids = new Set(cards.map(card => card.id));
  game.hands[userId] = game.hands[userId].filter(card => !ids.has(card.id));
}

function advanceBluff(game, now) {
  const player = game.lastPlay.player;
  game.rankIndex = (game.rankIndex + 1) % RANKS.length;
  game.lastPlay = null;
  startTurn(game, nextPlayer(game, player), now);
}

function bluffAction(game, userId, action, now) {
  if (action.type === 'challenge') {
    requireCondition(game.phase === 'challenge' && game.lastPlay, 'There is no declaration to challenge');
    const play = game.lastPlay;
    requireCondition(userId !== play.player, 'You cannot challenge yourself');
    const lied = play.cards.some(card => card.rank !== play.rank);
    const collector = lied ? play.player : userId;
    game.reveal = { cards: play.cards, player: play.player, challenger: userId, lied, collector };
    game.hands[collector].push(...game.pile);
    game.pile = [];
    game.message = lied ? 'Bluff exposed. The player takes the pile.' : 'An honest declaration. The challenger takes the pile.';
    if (!game.hands[play.player].length) finish(game, play.player);
    else advanceBluff(game, now);
    return;
  }
  requireCondition(action.type === 'play', 'Unknown action');
  requireCondition(game.phase === 'play' && game.turn === userId, 'It is not your turn');
  const cards = selectedCards(game, userId, action.cards, 4);
  removeCards(game, userId, cards);
  game.pile.push(...cards);
  game.lastPlay = { player: userId, cards, rank: RANKS[game.rankIndex] };
  game.reveal = null;
  game.phase = 'challenge';
  game.deadline = now + CHALLENGE_MS;
  game.message = `${cards.length} card${cards.length === 1 ? '' : 's'} declared as ${RANKS[game.rankIndex]}. Challenge now or let the declaration stand.`;
}

function drawCards(game, player, count) {
  for (let n = 0; n < count; n++) {
    if (!game.drawPile.length && game.discard.length > 1) {
      const top = game.discard.pop();
      game.drawPile = shuffle(game.discard);
      game.discard = [top];
    }
    if (game.drawPile.length) game.hands[player].push(game.drawPile.pop());
  }
}

function chromaticAction(game, userId, action, now) {
  requireCondition(game.phase === 'play' && game.turn === userId, 'It is not your turn');
  if (action.type === 'draw') {
    drawCards(game, userId, 1);
    game.message = 'One card drawn. Play passes to the next player.';
    startTurn(game, nextPlayer(game), now);
    return;
  }
  requireCondition(action.type === 'play', 'Unknown action');
  const cards = selectedCards(game, userId, action.cards, 1);
  const card = cards[0];
  const top = game.discard.at(-1);
  requireCondition(card.color === 'wild' || card.color === game.activeColor || card.value === top.value, 'Match the active color or value');
  if (card.color === 'wild') requireCondition(COLORS.includes(action.color), 'Choose a wild color');
  removeCards(game, userId, cards);
  game.discard.push(card);
  game.activeColor = card.color === 'wild' ? action.color : card.color;
  let distance = 1;
  if (card.value === 'reverse') {
    game.direction *= -1;
    if (game.players.length === 2) distance = 2;
  }
  if (card.value === 'skip') distance = 2;
  if (card.value === 'draw2') {
    drawCards(game, nextPlayer(game), 2);
    distance = 2;
  }
  game.message = `${card.value === 'wild' ? 'Wild' : card.value} played. Active color: ${game.activeColor}.`;
  if (!game.hands[userId].length) finish(game, userId);
  else startTurn(game, nextPlayer(game, userId, distance), now);
}

export function actGame(original, userId, action, now = Date.now()) {
  if (original.type === 'ohhell') return actOhHell(original, userId, action, now);
  if (original.type === 'rummy') return actRummy(original, userId, action, now);
  if (original.type === 'poker') return actPoker(original, userId, action, now);
  if (original.type === 'chromatic' && original.rulesVersion === 2) return actChromatic(original, userId, action, now);
  requireCondition(original.players.includes(userId), 'You are not seated at this table');
  requireCondition(original.phase !== 'finished', 'The hand is finished');
  requireCondition(now < original.deadline, 'The action window has expired');
  requireCondition(action && typeof action === 'object', 'Invalid action');
  const game = structuredClone(original);
  if (game.type === 'bluff') bluffAction(game, userId, action, now);
  else chromaticAction(game, userId, action, now);
  game.moves++;
  return game;
}

export function tickGame(original, now = Date.now()) {
  if (original.type === 'ohhell') return tickOhHell(original, now);
  if (original.type === 'rummy') return tickRummy(original, now);
  if (original.type === 'poker') return tickPoker(original, now);
  if (original.type === 'chromatic' && original.rulesVersion === 2) return tickChromatic(original, now);
  if (original.phase === 'finished' || now < original.deadline) return original;
  const game = structuredClone(original);
  if (game.type === 'bluff' && game.phase === 'challenge') {
    const player = game.lastPlay.player;
    game.message = 'The declaration stands. The next rank is in play.';
    if (!game.hands[player].length) finish(game, player);
    else advanceBluff(game, now);
  } else if (game.type === 'bluff') {
    bluffAction(game, game.turn, { type: 'play', cards: [game.hands[game.turn][0].id] }, now);
    game.message = `Time expired. One card was declared as ${RANKS[game.rankIndex]}. The challenge window is open.`;
  } else {
    chromaticAction(game, game.turn, { type: 'draw' }, now);
    game.message = 'Time expired. A card was drawn and the turn passed.';
  }
  game.moves++;
  return game;
}

export function viewGame(game, userId) {
  if (game.type === 'ohhell') return viewOhHell(game, userId);
  if (game.type === 'rummy') return viewRummy(game, userId);
  if (game.type === 'poker') return viewPoker(game, userId);
  if (game.type === 'chromatic' && game.rulesVersion === 2) return viewChromatic(game, userId);
  const view = { type: game.type, players: [...game.players], turn: game.turn, phase: game.phase, winner: game.winner,
    deadline: game.deadline, message: game.message, moves: game.moves,
    hand: structuredClone(game.hands[userId] ?? []), counts: Object.fromEntries(game.players.map(id => [id, game.hands[id].length])) };
  if (game.type === 'bluff') Object.assign(view, { requiredRank: RANKS[game.rankIndex], pileCount: game.pile.length,
    lastPlay: game.lastPlay ? { player: game.lastPlay.player, rank: game.lastPlay.rank, count: game.lastPlay.cards.length } : null,
    reveal: structuredClone(game.reveal) });
  else Object.assign(view, { topCard: structuredClone(game.discard.at(-1)), activeColor: game.activeColor, direction: game.direction,
    drawCount: game.drawPile.length, discardCount: game.discard.length, colors: [...COLORS] });
  return view;
}
