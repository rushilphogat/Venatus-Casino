import test from 'node:test';
import assert from 'node:assert/strict';
import {createPoker,actPoker,tickPoker,viewPoker,evaluateHand} from '../src/poker.js';
import {createGame,actGame,tickGame,viewGame} from '../src/games.js';
import {createOhHell,actOhHell,tickOhHell,viewOhHell} from '../src/ohhell.js';
import {botAction} from '../src/bots.js';

const suits={s:'spades',h:'hearts',c:'clubs',d:'diamonds'};
const cards=text=>text.split(' ').map(token=>({id:token,rank:token.slice(0,-1),suit:suits[token.at(-1)]}));
const foldToResult=options=>{
  let g=createPoker(['a','b','c'],0,options);
  g=actPoker(g,g.turn,{type:'fold'},1);
  return actPoker(g,g.turn,{type:'fold'},2);
};

test('Poker advances on a strict human majority with bots already ready',()=>{
  let g=foldToResult({humanPlayers:['a','b']});
  assert.deepEqual(g.presentation.ready,['c']);
  assert.equal(botAction(viewPoker(g,'c')),null);
  assert.equal(g.presentation.maximumUntil,20002);
  assert.throws(()=>actPoker(g,'c',{type:'ready'},3),/human/);
  g=actPoker(g,'a',{type:'ready'},3);assert.equal(g.handNumber,1);
  g=actPoker(g,'b',{type:'ready'},4);assert.equal(g.handNumber,2);
  assert.equal(g.presentation,null);
});

test('Unready humans get exactly twenty seconds; old solo manual option cannot extend it',()=>{
  let multi=foldToResult({humanPlayers:['a','b']});
  multi=actPoker(multi,'a',{type:'ready'},3);
  assert.equal(tickPoker(multi,20001),multi);
  assert.equal(tickPoker(multi,20002).handNumber,2);
  let solo=foldToResult({humanPlayers:['a'],manualResults:true});
  assert.deepEqual(solo.presentation.ready,['b','c']);
  assert.equal(solo.presentation.manual,false);
  assert.equal(tickPoker(solo,20002).handNumber,2);
  solo=actPoker(solo,'a',{type:'continue'},3);assert.equal(solo.handNumber,2);
});

test('All-in runout reveals no future cards until each server deadline, settles only once',()=>{
  let g=createPoker(['a','b'],0);
  g=actPoker(g,'a',{type:'allin'},1);g=actPoker(g,'b',{type:'call'},2);
  assert.equal(g.phase,'runout');
  assert.equal(viewPoker(g,'a').board.length,0);
  const turnCard=g.deck.at(-6),riverCard=g.deck.at(-8);
  for(const count of [3,4,5]){
    assert.equal(tickPoker(g,g.deadline-1),g);
    g=tickPoker(g,g.deadline);
    const v=viewPoker(g,'a');assert.equal(v.board.length,count);
    assert.equal(v.legalActions.length,0);
    assert.equal(Object.values(g.contributions).reduce((a,b)=>a+b,0),500);
    assert.deepEqual(v.showdown,{});
    assert.equal('deck' in v,false);assert.equal('hands' in v,false);
    if(count===3){assert.ok(!JSON.stringify(v).includes(turnCard.id));assert.ok(!JSON.stringify(v).includes(riverCard.id));}
  }
  g=tickPoker(g,g.deadline);
  assert.equal(Object.values(g.stacks).reduce((a,b)=>a+b,0),500);
  const total=Object.values(g.stacks).reduce((a,b)=>a+b,0);
  if(g.phase==='between-hands')g=tickPoker(g,g.deadline);
  assert.equal(Object.values(g.stacks).reduce((a,b)=>a+b,0),total);
});

test('Private hand names and best-five highlights use only own cards and visible board',()=>{
  const g=createPoker(['a','b'],0);
  g.hands.a=cards('As Ah');g.hands.b=cards('Kh Kc');
  assert.equal(viewPoker(g,'a').currentHand.name,'Pocket aces');
  assert.equal(viewPoker(g,'b').currentHand.name,'Pocket kings');
  g.board=cards('Ad 10h 10c');
  const v=viewPoker(g,'a');
  assert.equal(v.currentHand.name,'Full house');
  assert.equal(v.currentHand.description,'aces full of tens');
  assert.equal(v.currentHand.cardIds.length,5);
  assert.ok(!v.currentHand.cardIds.includes('Kh'));
  assert.equal(viewPoker(g,'spectator').currentHand,null);
  g.board=cards('2c 3s 4d 5h 6c');g.hands.a=cards('Kh Qh');
  assert.deepEqual(new Set(viewPoker(g,'a').currentHand.cardIds),new Set(g.board.map(c=>c.id)));
  assert.deepEqual(evaluateHand(cards('As 2c 3h 4d 5c Kh Qh')).rank,[4,5]);
  const tied=evaluateHand(cards('As Ah Ac Kd Kh Ks 2h'));
  assert.equal(tied.name,'Full house');assert.equal(tied.cardIds.length,5);
});

test('Poker replay keeps own folded cards private and never exposes privateHands map',()=>{
  let g=foldToResult({humanPlayers:['a']});
  const a=viewPoker(g,'a'),b=viewPoker(g,'b'),observer=viewPoker(g,'outsider');
  assert.deepEqual(a.lastResult.ownHand,g.hands.a);
  assert.deepEqual(b.lastResult.ownHand,g.hands.b);
  assert.deepEqual(observer.lastResult.ownHand,[]);
  assert.ok(!JSON.stringify(b.recentResults).includes(g.hands.a[0].id));
  assert.ok(!('privateHands' in a.lastResult));
  assert.deepEqual(a.lastResult.showdown,{});
  g=actPoker(g,'a',{type:'ready'},g.presentation.minimumUntil);
  assert.equal(g.handNumber,2);
  const after=viewPoker(g,'a');assert.deepEqual(after.recentResults[0].ownHand,a.lastResult.ownHand);
});

test('Bluff verdict advances on a majority and remains in history afterwards',()=>{
  let g=createGame('bluff',['a','b','c'],0,{houseRules:'street',humanPlayers:['a','b']});
  g.hands.a=cards('Ks 2c');g.hands.b=cards('Ah 3s');
  g=actGame(g,'a',{type:'play',cards:['Ks'],rank:'A'},1);
  g=actGame(g,'b',{type:'challenge'},2);
  assert.equal(g.phase,'reveal');assert.equal(g.reveal.collectedCount,1);
  assert.equal(g.presentation.maximumUntil,7002);assert.deepEqual(g.presentation.ready,['c']);
  assert.equal(tickGame(g,7001),g);assert.equal(tickGame(g,7002).phase,'play');
  assert.equal(botAction(viewGame(g,'c')),null);
  assert.throws(()=>actGame(g,'b',{type:'play',cards:['Ah'],rank:'K'},3),/Review/);
  g=actGame(g,'a',{type:'ready'},4);assert.equal(g.phase,'reveal');
  g=actGame(g,'b',{type:'ready'},5);
  assert.equal(g.phase,'play');assert.equal(g.turn,'b');assert.equal(g.declaredRank,null);
  const result=structuredClone(g.lastReveal);
  g=actGame(g,'b',{type:'play',cards:['Ah'],rank:'A'},6);
  assert.equal(g.reveal,null);assert.deepEqual(viewGame(g,'c').lastReveal,result);
});

test('Oh Hell completed trick remains on the table before collecting and scoring once',()=>{
  let g=createOhHell(['a','b','c'],0);
  for(const id of ['a','b','c'])g=actOhHell(g,id,{type:'bid',amount:0},1);
  for(let i=0;i<3;i++)g=actOhHell(g,g.turn,{type:'play',cards:[viewOhHell(g,g.turn).legalCardIds[0]]},2+i);
  assert.equal(g.phase,'trick-end');assert.equal(g.trick.length,3);assert.equal(g.taken.length,0);
  assert.equal(botAction(viewOhHell(g,g.turn)),null);
  assert.throws(()=>actOhHell(g,g.turn,{type:'play',cards:[]},5),/collected/);
  assert.equal(tickOhHell(g,g.deadline-1),g);
  g=tickOhHell(g,g.deadline);
  assert.equal(g.phase,'round-end');assert.equal(g.trick.length,0);assert.equal(g.taken.length,3);
  assert.equal(g.history.length,1);
  const scores={...g.scores};g=tickOhHell(g,g.presentation.minimumUntil);
  assert.deepEqual(g.scores,scores);assert.equal(g.history.length,1);
});
