import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateHand,settlePots,createPoker as create,actPoker as act,viewPoker as view,tickPoker as tick} from '../src/poker.js';
const suits={c:'clubs',d:'diamonds',h:'hearts',s:'spades'};
const cards=text=>text.split(' ').map(t=>({id:t,rank:t.slice(0,-1),suit:suits[t.at(-1)]}));
test('Holdem evaluator covers every rank, wheel, kickers and best five of seven',()=>{
 const hands=['As Jc 9h 6d 2c','As Ac 9h 6d 2c','As Ac 9h 9d 2c','As Ac Ah 6d 2c','As 2c 3h 4d 5c','As Js 9s 6s 2s','As Ac Ah 6d 6c','As Ac Ah Ad 2c','9s 10s Js Qs Ks'];
 hands.forEach((s,i)=>assert.equal(evaluateHand(cards(s)).rank[0],i));
 assert.deepEqual(evaluateHand(cards(hands[4])).rank,[4,5]);
 assert.deepEqual(evaluateHand(cards('Ac Ad Kh Qs 8h 7c 2c')).rank,[1,14,13,12,8]);
 assert.deepEqual(evaluateHand(cards('As Ks Qs Js 10s 2c 3h')).rank,[8,14]);
});
test('Holdem side pots return uncalled amounts and exclude folded contenders',()=>{
 const players=['a','b','c'],contrib={a:50,b:100,c:200},ranks={a:[3,14],b:[2,14,13],c:[1,14]};
 assert.deepEqual(settlePots(players,contrib,{},ranks).payouts,{a:150,b:100,c:100});
 assert.deepEqual(settlePots(players,contrib,{a:true},ranks).payouts,{a:0,b:250,c:100});
 assert.deepEqual(settlePots(players,{a:3,b:3,c:3},{c:true},{a:[0,14],b:[0,14]},['b','c','a']).payouts,{a:4,b:5,c:0});
});
test('Holdem heads-up blinds and action order; check cannot replace a call',()=>{
 let g=create(['a','b'],0);assert.equal(g.smallBlindPlayer,'a');assert.equal(g.bigBlindPlayer,'b');assert.equal(g.turn,'a');
 assert.throws(()=>act(g,'a',{type:'check'},1),/call/);
 g=act(g,'a',{type:'call'},1);assert.equal(g.turn,'b');g=act(g,'b',{type:'check'},2);
 assert.equal(g.street,'flop');assert.equal(g.turn,'b');assert.equal(g.board.length,3);
 assert.equal('deck' in view(g,'a'),false);assert.equal('hands' in view(g,'a'),false);
});
test('Holdem short all-in does not reopen prior callers and illegal minimum raises fail',()=>{
 let g=create(['a','b','c'],0,{buyIn:100});g.stacks.c=28;
 assert.throws(()=>act(g,'a',{type:'raise',amount:3},1),/minimum/);
 g=act(g,'a',{type:'raise',amount:20},1);g=act(g,'b',{type:'call'},2);g=act(g,'c',{type:'allin'},3);
 assert.equal(g.currentBet,30);assert.equal(g.turn,'a');assert.ok(!view(g,'a').legalActions.includes('raise'));
 assert.throws(()=>act(g,'a',{type:'raise',amount:60},4),/reopened/);
 g=act(g,'a',{type:'call'},4);g=act(g,'b',{type:'call'},5);assert.equal(g.street,'flop');
});
test('Holdem fold payout, repeated deals and safe cashout preserve exact stacks',()=>{
 let g=create(['a','b','c'],0);g=act(g,g.turn,{type:'fold'},1);g=act(g,g.turn,{type:'fold'},2);assert.equal(g.phase,'between-hands');
 assert.equal(Object.values(g.stacks).reduce((a,b)=>a+b),750);const dealer=g.dealer;
 g=act(g,'a',{type:'next-hand'},3);assert.notEqual(g.dealer,dealer);
 g=act(g,'b',{type:'request-cashout'},4);while(g.phase==='play')g=act(g,g.turn,{type:'fold'},5);
 assert.equal(g.phase,'finished');assert.equal(Object.values(g.payouts).reduce((a,b)=>a+b),750);
});
test('Holdem equal all-ins run board automatically; timeout uses legal check/fold',()=>{
 let g=create(['a','b'],0);g=act(g,'a',{type:'allin'},1);g=act(g,'b',{type:'call'},2);
 assert.equal(g.board.length,5);assert.ok(['finished','between-hands'].includes(g.phase));assert.equal(Object.values(g.stacks).reduce((a,b)=>a+b),500);
 const fresh=create(['a','b'],0);assert.ok(['between-hands','finished'].includes(tick(fresh,fresh.deadline).phase));
});
test('80 simulated Holdem sessions exercise legal raises, all-ins, multiple streets and exact chip conservation',()=>{
 for(let n=0;n<80;n++){
  const players=['a','b','c','d'];let g=create(players,0),time=1,moves=0;
  while(g.phase!=='finished'&&moves++<1500){
   const v=view(g,g.turn);let a;
   if(g.phase==='between-hands')a={type:'next-hand'};
   else if(v.legalActions.includes('allin')&&Math.random()<.12)a={type:'allin'};
   else if(v.legalActions.includes('raise')&&v.minRaise<=v.maxRaise&&Math.random()<.25)a={type:'raise',amount:v.minRaise};
   else a={type:Math.random()<.12?'fold':v.legalActions.includes('check')?'check':'call'};
   g=act(g,g.turn,a,time++);
   assert.equal(Object.values(g.stacks).reduce((a,b)=>a+b,0)+Object.values(g.contributions).reduce((a,b)=>a+b,0),1000);
   assert.ok(Object.values(g.stacks).every(n=>Number.isSafeInteger(n)&&n>=0));
  }
  assert.equal(g.phase,'finished');assert.equal(Object.values(g.payouts).reduce((a,b)=>a+b),1000);
 }
});
