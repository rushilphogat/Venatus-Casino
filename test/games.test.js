import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, actGame, tickGame, viewGame } from '../src/games.js';

const players = ['alice', 'bob', 'cara'];
const card = (id, rank = 'A') => ({ id, rank, suit: 'clubs' });
function inventory(game) {
  const cards = Object.values(game.hands).flat();
  cards.push(...(game.type === 'bluff' ? game.pile : [...game.drawPile, ...game.discard]));
  return cards.map(c => c.id).sort();
}

test('standard deck is complete, unique and fairly dealt for 3–6 seats', () => {
  for (let count = 3; count <= 6; count++) {
    const game = createGame('bluff', Array.from({ length: count }, (_, i) => `p${i}`), 0);
    assert.equal(inventory(game).length, 52);
    assert.equal(new Set(inventory(game)).size, 52);
    const counts = Object.values(game.hands).map(h => h.length);
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
  }
  assert.throws(() => createGame('bluff', ['a', 'b']), /count/);
  assert.throws(() => createGame('chromatic', ['a', 'a']), /distinct/);
});

test('shuffling varies decks, and players and views cannot mutate original state', () => {
  const game = createGame('bluff', players, 0);
  assert.notDeepEqual(game.hands, createGame('bluff', players, 0).hands);
  const view = viewGame(game, 'alice');
  view.hand[0].rank = 'changed';
  assert.notEqual(game.hands.alice[0].rank, 'changed');
  assert.equal(viewGame(game, 'spectator').hand.length, 0);
  assert.ok(!('hands' in view));
  const next = actGame(game, 'alice', { type: 'play', cards: [game.hands.alice[0].id] }, 1);
  assert.equal(game.phase, 'play');
  assert.equal(next.phase, 'challenge');
  const bobView = viewGame(next, 'bob');
  assert.ok(!('cards' in bobView.lastPlay));
  assert.ok(!JSON.stringify(bobView).includes(game.hands.alice[0].id));
});

test('Bluff rejects wrong turns, stolen cards, duplicates, self-challenges and late actions', () => {
  const game = createGame('bluff', players, 0);
  assert.throws(() => actGame(game, 'bob', { type: 'play', cards: [game.hands.bob[0].id] }, 1), /turn/);
  assert.throws(() => actGame(game, 'alice', { type: 'play', cards: [game.hands.bob[0].id] }, 1), /hold/);
  assert.throws(() => actGame(game, 'alice', { type: 'play', cards: [game.hands.alice[0].id, game.hands.alice[0].id] }, 1), /distinct/);
  assert.throws(() => actGame(game, 'alice', { type: 'play', cards: [game.hands.alice[0].id] }, 30000), /expired/);
  const next = actGame(game, 'alice', { type: 'play', cards: [game.hands.alice[0].id] }, 1);
  assert.throws(() => actGame(next, 'alice', { type: 'challenge' }, 2), /yourself/);
  assert.throws(() => actGame(next, 'intruder', { type: 'challenge' }, 2), /seated/);
});

test('caught final-card bluff collects entire pile and cannot win', () => {
  const game = createGame('bluff', players, 0);
  game.hands.alice = [card('lie', 'K')];
  game.pile = [card('older', '2')];
  const played = actGame(game, 'alice', { type: 'play', cards: ['lie'] }, 1);
  assert.equal(played.winner, null);
  const challenged = actGame(played, 'bob', { type: 'challenge' }, 2);
  assert.equal(challenged.winner, null);
  assert.equal(challenged.hands.alice.length, 2);
  assert.equal(challenged.turn, 'bob');
  assert.equal(challenged.rankIndex, 1);
  assert.equal(challenged.pile.length, 0);
  assert.equal(challenged.reveal.lied, true);
});

test('honest final card wins after failed challenge, with pile assigned to challenger', () => {
  const game = createGame('bluff', players, 0);
  game.hands.alice = [card('truth')];
  const previous = game.hands.bob.length;
  const next = actGame(actGame(game, 'alice', { type: 'play', cards: ['truth'] }, 1), 'bob', { type: 'challenge' }, 2);
  assert.equal(next.winner, 'alice');
  assert.equal(next.phase, 'finished');
  assert.equal(next.hands.bob.length, previous + 1);
  assert.throws(() => actGame(next, 'bob', { type: 'challenge' }, 3), /finished/);
});

test('unchallenged final card waits exactly until deadline and then wins', () => {
  const game = createGame('bluff', players, 0);
  game.hands.alice = [card('last', 'Q')];
  const next = actGame(game, 'alice', { type: 'play', cards: ['last'] }, 1);
  assert.equal(tickGame(next, 8000), next);
  assert.equal(tickGame(next, 8001).winner, 'alice');
  assert.equal(next.winner, null);
});

test('Bluff timeout creates a challenge window, then advances turn and rank', () => {
  const game = createGame('bluff', players, 0);
  const next = tickGame(game, 30000);
  assert.equal(next.phase, 'challenge');
  assert.equal(next.hands.alice.length, game.hands.alice.length - 1);
  const advanced = tickGame(next, 38000);
  assert.equal(advanced.turn, 'bob');
  assert.equal(viewGame(advanced, 'bob').requiredRank, '2');
  assert.deepEqual(inventory(advanced), inventory(game));
});

test('50 randomized Bluff matches with challenges finish and conserve every card', () => {
  for (let match = 0; match < 50; match++) {
    let now = 0;
    let game = createGame('bluff', players, now);
    const original = inventory(game);
    for (let move = 0; move < 4000 && game.phase !== 'finished'; move++) {
      if (game.phase === 'challenge') {
        if (Math.random() < 0.08) {
          const challenger = game.players.find(p => p !== game.lastPlay.player);
          game = actGame(game, challenger, { type: 'challenge' }, ++now);
        } else {
          now = game.deadline;
          game = tickGame(game, now);
        }
      } else {
        const hand = game.hands[game.turn];
        const count = Math.min(hand.length, 1 + Math.floor(Math.random() * 4));
        game = actGame(game, game.turn, { type: 'play', cards: hand.slice(0, count).map(c => c.id) }, ++now);
      }
      assert.deepEqual(inventory(game), original);
    }
    assert.equal(game.phase, 'finished', `match ${match} terminated`);
    assert.equal(game.hands[game.winner].length, 0);
  }
});
