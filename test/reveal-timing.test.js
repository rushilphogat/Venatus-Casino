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

test('Poker Ready cannot shorten readable minimum, needs all humans, and bots cannot auto-deal',()=>{
  let g=foldToResult({humanPlayers:['a','b']});
  const resultHand=g.handNumber,min=g.presentation.minimumUntil;
  assert.equal(botAction(viewPoker(g,'c')),null);
  g=actPoker(g,'a',{type:'next-hand'},3);
  g=actPoker(g,'b',{type:'ready'},4);
  assert.equal(g.handNumber,resultHand);
  assert.equal(tickPoker(g,min-1),g);
  assert.throws(()=>actPoker(g,'c',{type:'ready'},5),/human/);
  g=tickPoker(g,min);
  assert.equal(g.handNumber,resultHand+1);
  assert.equal(g.presentation,null);
});

test('Poker unready humans receive maximum hold and solo manual waits for Continue',()=>{
  let multi=foldToResult({humanPlayers:['a','b']});
  const max=multi.presentation.maximumUntil;
  multi=actPoker(multi,'a',{type:'ready'},3);
  multi=tickPoker(multi,multi.deadline);
  assert.equal(multi.phase,'between-hands');
  assert.equal(multi.deadline,max);
  multi=tickPoker(multi,max);
  assert.equal(multi.handNumber,2);
  let solo=foldToResult({humanPlayers:['a'],manualResults:true});
  solo=tickPoker(solo,solo.presentation.maximumUntil);
  assert.equal(solo.handNumber,1);
  assert.equal(solo.phase,'between-hands');
  solo=actPoker(solo,'a',{type:'continue'},solo.presentation.minimumUntil+1);
  assert.equal(solo.handNumber,2);
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

test('Bluff verdict survives bot/human attempts to advance and remains in history afterwards',()=>{
  let g=createGame('bluff',['a','b','c'],0,{houseRules:'street',humanPlayers:['a','b']});
  g.hands.a=cards('Ks 2c');g.hands.b=cards('Ah 3s');
  g=actGame(g,'a',{type:'play',cards:['Ks'],rank:'A'},1);
  g=actGame(g,'b',{type:'challenge'},2);
  assert.equal(g.phase,'reveal');assert.equal(g.reveal.collectedCount,1);
  assert.equal(g.presentation.minimumUntil,10502);
  assert.equal(botAction(viewGame(g,'c')),null);
  assert.throws(()=>actGame(g,'b',{type:'play',cards:['Ah'],rank:'K'},3),/Review/);
  g=actGame(g,'a',{type:'ready'},4);g=actGame(g,'b',{type:'ready'},5);
  assert.equal(g.phase,'reveal');
  g=tickGame(g,g.presentation.minimumUntil);
  assert.equal(g.phase,'play');assert.equal(g.turn,'b');assert.equal(g.declaredRank,null);
  const result=structuredClone(g.lastReveal);
  g=actGame(g,'b',{type:'play',cards:['Ah'],rank:'A'},8003);
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
