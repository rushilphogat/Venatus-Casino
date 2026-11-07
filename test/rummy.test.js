import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyMeld,analyzeRummy,createRummy,actRummy,tickRummy,viewRummy} from '../src/rummy.js';
const c=(rank,suit='clubs',copy=0)=>({id:`${copy}-${suit}-${rank}`,rank,suit});
const winning=()=>[c('A'),c('2'),c('3'),c('5','hearts'),c('6','hearts'),c('7','hearts'),c('9','clubs'),c('9','hearts'),c('9','spades'),c('J','spades'),c('Q','spades'),c('K','spades'),c('A','spades')];
test('Rummy pure/impure runs and sets enforce suit, rank and ace boundaries',()=>{
 assert.equal(classifyMeld([c('A'),c('2'),c('3')],'7'),'pure');
 assert.equal(classifyMeld([c('Q'),c('K'),c('A')],'7'),'pure');
 assert.equal(classifyMeld([c('K'),c('A'),c('2')],'7'),null);
 assert.equal(classifyMeld([c('5'),c('7'),c('JOKER','joker')],'7'),'sequence');
 assert.equal(classifyMeld([c('9'),c('9','hearts'),c('9','spades')],'7'),'set');
 assert.equal(classifyMeld([c('9'),c('9','clubs',1),c('9','spades')],'7'),null);
 assert.equal(classifyMeld([c('JOKER','joker'),c('JOKER','joker',1),c('7')],'7'),null);
});
test('Rummy checks every card, two sequences and one pure sequence',()=>{
 const hand=winning();const result=analyzeRummy(hand,'8');assert.equal(result.valid,true);assert.equal(result.penalty,0);assert.equal(result.groups.flatMap(g=>g.cards).length,13);
 assert.equal(analyzeRummy(hand.slice(1),'8').valid,false);
 hand[5]=c('JOKER','joker');assert.equal(analyzeRummy(hand,'8').valid,true);
 assert.throws(()=>analyzeRummy([...hand.slice(0,12),hand[0]],'8'),/distinct/);
});
test('Rummy rejects deceptive sets without required sequences and caps penalty at 80',()=>{
 const hand=['A','K','Q','J'].flatMap(rank=>['clubs','hearts','spades'].map(suit=>c(rank,suit))).concat(c('10','diamonds'));
 // This hand has potential long runs: replace ranks to leave only sets.
 const sets=['2','5','8','J'].flatMap(rank=>['clubs','hearts','spades'].map(suit=>c(rank,suit))).concat(c('K','diamonds'));
 assert.equal(analyzeRummy(sets,'A').valid,false);assert.ok(analyzeRummy(hand,'2').penalty<=80);
});
test('Rummy authoritative declaration settles only a fully valid 13-card hand',()=>{
 let g=createRummy(['a','b'],0);g.phase='discard';g.turn='a';g.wildRank='8';g.hands.a=[...winning(),c('4','diamonds')];
 assert.throws(()=>actRummy(g,'a',{type:'declare',cards:[g.hands.a[0].id]},1),/Invalid declaration/);
 const done=actRummy(g,'a',{type:'declare',cards:[c('4','diamonds').id]},1);assert.equal(done.phase,'finished');assert.equal(done.winner,'a');assert.equal(done.penalties.a,0);
 assert.equal(g.hands.a.length,14);assert.equal('stock' in viewRummy(done,'b'),false);
});
test('Rummy 108-card inventory survives draws, discards and timeouts with private hands',()=>{
 let g=createRummy(['a','b','c'],0);
 for(let n=0;n<120;n++){
   const cards=[g.indicator,...g.stock,...g.discard,...Object.values(g.hands).flat()];assert.equal(cards.length,108);assert.equal(new Set(cards.map(c=>c.id)).size,108);
   assert.equal(viewRummy(g,g.turn).hand.length,13);g=tickRummy(g,g.deadline);
 }
 assert.equal('hands' in viewRummy(g,'a'),false);
});
test('Rummy drop values and joker-discard pickup restrictions',()=>{
 let g=createRummy(['a','b'],0);g.discard=[c('JOKER','joker')];assert.throws(()=>actRummy(g,'a',{type:'draw',source:'discard'},1),/Jokers/);
 const done=actRummy(g,'a',{type:'drop'},1);assert.equal(done.winner,'b');assert.equal(done.penalties.a,20);
});
