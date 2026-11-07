import test from 'node:test';
import assert from 'node:assert/strict';
import {createOhHell as create,actOhHell as act,viewOhHell as view,tickOhHell as tick,trickWinner,legalTrickCards,legalBids} from '../src/ohhell.js';
const players=['a','b','c'];
const c=(rank,suit='clubs')=>({id:suit+rank,rank,suit});
test('Oh Hell follow-suit rules and trump evaluation',()=>{
 const g=create(players,0);g.hands.a=[c('A'),c('2','hearts')];g.trick=[{player:'b',card:c('3')}];
 assert.deepEqual(legalTrickCards(g,'a').map(c=>c.rank),['A']);
 assert.equal(trickWinner([{player:'a',card:c('A')},{player:'b',card:c('2','hearts')},{player:'c',card:c('K','hearts')}],'hearts'),'c');
 assert.equal(trickWinner([{player:'a',card:c('4')},{player:'b',card:c('A','spades')}],'hearts'),'a');
});
test('Oh Hell dealer hook and out-of-turn validation',()=>{
 let g=create(players,0);g=act(g,'a',{type:'bid',amount:0},1);g=act(g,'b',{type:'bid',amount:0},2);
 assert.deepEqual(legalBids(g),[0]);assert.throws(()=>act(g,'c',{type:'bid',amount:1},3));
 assert.throws(()=>act(g,'a',{type:'bid',amount:0},3));
});
test('40 complete Oh Hell matches score exact bids, conserve cards and protect hands',()=>{
 for(let n=0;n<40;n++){
  let g=create(players,0),now=1,moves=0;
  while(g.phase!=='finished'&&moves++<600){
   const v=view(g,g.turn);assert.equal('hands' in v,false);
   const cards=[...g.stock,g.trumpCard,...g.taken,...g.trick.map(p=>p.card),...Object.values(g.hands).flat()];assert.equal(new Set(cards.map(c=>c.id)).size,52);
   const a=g.phase==='round-end'?{type:'next-round'}:g.phase==='bid'?{type:'bid',amount:v.legalBids[Math.floor(Math.random()*v.legalBids.length)]}:{type:'play',cards:[v.legalCardIds[Math.floor(Math.random()*v.legalCardIds.length)]]};
   g=act(g,g.turn,a,now++);
  }
  assert.equal(g.phase,'finished');assert.equal(g.history.length,9);assert.ok(g.winners.length);
  for(const p of players)assert.equal(g.scores[p],g.history.reduce((sum,r)=>sum+(r.bids[p]===r.tricks[p]?10+r.bids[p]:0),0));
 }
});
test('Oh Hell timeout chooses a legal bid and card',()=>{
 let g=create(players,0);for(let i=0;i<10;i++)g=tick(g,g.deadline);assert.ok(g.round>=2);
});
