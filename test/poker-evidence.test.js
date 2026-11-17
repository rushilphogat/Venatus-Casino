import test from 'node:test';import assert from 'node:assert/strict';
import {createPoker,actPoker,evaluateHand,viewPoker} from '../src/poker.js';
import {handBreakdown,madeHand} from '../public/poker-result.js';
const suits={s:'spades',h:'hearts',d:'diamonds',c:'clubs'};
export const cards=text=>text.split(' ').map(t=>({id:t,rank:t.slice(0,-1),suit:suits[t.at(-1)]}));
function showdown(a,b,board){let g=createPoker(['a','b'],0);g.hands={a:cards(a),b:cards(b)};g.board=cards(board);g.street='river';g.bets={a:0,b:0};g.currentBet=0;g.pending=['a','b'];g.turn='a';g.stacks={a:210,b:210};g.contributions={a:40,b:40};g=actPoker(g,'a',{type:'check'},1);return actPoker(g,'b',{type:'check'},2);}
test('showdown full houses carry the exact five cards and their hole/board sources',()=>{
 const g=showdown('Ac Kh','9d Qc','Ah Ad 9c 9s 2h'),v=viewPoker(g,'a');
 assert.deepEqual(v.lastResult.pots[0].winners,['a']);
 const a=v.showdown.a,b=v.showdown.b;
 assert.equal(a.description,'aces full of nines');assert.equal(b.description,'nines full of aces');
 assert.deepEqual(new Set(a.cardIds),new Set(['Ac','Ah','Ad','9c','9s']));
 assert.deepEqual(new Set(b.cardIds),new Set(['9d','9c','9s','Ah','Ad']));
 for(const result of [a,b]){const breakdown=handBreakdown(result,v.board);assert.equal(breakdown.used,1);assert.equal(breakdown.cards.length,5);assert.deepEqual(evaluateHand(result.bestFive).rank,result.rank);}
 assert.doesNotMatch(madeHand(a,v.board,c=>c.id,x=>x),/Kh|Qc|2h/);
});
test('board quads use the correct kicker; a board straight does not invent hole-card contribution',()=>{
 let v=viewPoker(showdown('Ac 3c','Qh Jh','Ks Kd Kc Kh 2h'),'a');
 assert.deepEqual(v.lastResult.pots[0].winners,['a']);assert.equal(v.showdown.a.cardIds.at(-1),'Ac');assert.equal(v.showdown.b.cardIds.at(-1),'Qh');
 v=viewPoker(showdown('10c 3c','Qh Jh','As Kd Qc Jd 10h'),'a');
 assert.deepEqual(new Set(v.lastResult.pots[0].winners),new Set(['a','b']));
 for(const s of Object.values(v.showdown)){assert.equal(handBreakdown(s,v.board).summary,'Plays the board');assert.deepEqual(new Set(s.cardIds),new Set(v.board.map(c=>c.id)));}
});
test('wheel and royal flush are ordered correctly without mutating input cards',()=>{
 const input=cards('As 2h 5c 4s 3d Kc Qh'),before=structuredClone(input),r=evaluateHand(input);
 assert.deepEqual(r.bestFive.map(c=>c.rank),['5','4','3','2','A']);assert.deepEqual(input,before);
 assert.equal(evaluateHand(cards('As Ks Qs Js 10s 2d 3d')).name,'Royal flush');
 assert.equal(handBreakdown({hand:cards('As Ks'),cardIds:['As','Ks','SECRET','2h','3h']},cards('2h 3h 4h 5h 6h')),null);
});
