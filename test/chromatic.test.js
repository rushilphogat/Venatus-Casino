import test from 'node:test';
import assert from 'node:assert/strict';
import { createChromatic as create, actChromatic as act, tickChromatic as tick, viewChromatic as view, chromaticDeck } from '../src/chromatic.js';
const players=['a','b','c'];
const c=(id,color='ruby',value='3')=>({id,color,value});
function fixture() {
  const g=create(players,0); Object.assign(g,{turn:'a',phase:'play',direction:1,activeColor:'ruby',deadline:30000,discard:[c('top')],drawPile:Array.from({length:30},(_,i)=>c('d'+i,'sapphire','2')),hands:{a:[c('a'),c('a2','gold','8')],b:[c('b')],c:[c('c')]},scores:{a:0,b:0,c:0}}); return g;
}
test('classic deck has 108 cards, four ordinary wilds and four Wild +4 cards',()=>{
  const deck=chromaticDeck(); assert.equal(deck.length,108); assert.equal(new Set(deck.map(c=>c.id)).size,108);
  assert.equal(deck.filter(c=>c.value==='wild').length,4); assert.equal(deck.filter(c=>c.value==='wilddraw4').length,4);
});
test('draw allows only the newly drawn playable card, or a pass',()=>{
  const g=fixture(); g.drawPile.push(c('drawn','ruby','9'));
  const drawn=act(g,'a',{type:'draw'},1); assert.equal(drawn.phase,'drawn');
  assert.deepEqual(view(drawn,'a').legalCardIds,['drawn']);
  assert.throws(()=>act(drawn,'a',{type:'play',cards:['a']},2),/just drawn/);
  assert.equal(act(drawn,'a',{type:'pass'},2).turn,'b');
  assert.equal(act(drawn,'a',{type:'play',cards:['drawn']},2).turn,'b');
});
test('draw ends turn when unplayable, timeout never auto-plays a drawn card',()=>{
  const g=fixture(); assert.equal(act(g,'a',{type:'draw'},1).turn,'b');
  g.drawPile.push(c('d','ruby','9')); const result=tick(g,30000); assert.equal(result.turn,'b'); assert.equal(result.hands.a.length,3);
});
test('missing one-card call can be caught until next action, self declaration avoids penalty',()=>{
  const g=fixture(); let result=act(g,'a',{type:'play',cards:['a']},1);
  assert.equal(result.catchablePlayer,'a'); assert.equal(act(result,'c',{type:'catch',target:'a'},2).hands.a.length,3);
  result=act(result,'a',{type:'declare'},2); assert.equal(result.catchablePlayer,null);
  assert.throws(()=>act(result,'b',{type:'catch',target:'a'},3));
  assert.equal(act(g,'a',{type:'play',cards:['a'],declare:true},1).catchablePlayer,null);
});
test('draw-four bluff challenge reveals evidence only to challenger and retains their turn',()=>{
  const g=fixture(); g.hands.a=[c('wild','wild','wilddraw4'),c('match','ruby','8')];
  const pending=act(g,'a',{type:'play',cards:['wild'],color:'gold'},1);
  assert.equal(pending.phase,'challenge'); assert.equal(pending.turn,'b');
  assert.equal(view(pending,'b').evidence,null); assert.ok(!JSON.stringify(view(pending,'b')).includes('match'));
  assert.throws(()=>act(pending,'c',{type:'challenge'},2));
  const result=act(pending,'b',{type:'challenge'},2);
  assert.equal(result.hands.a.length,5); assert.equal(result.turn,'b'); assert.equal(view(result,'b').evidence.illegal,true);
  assert.equal(view(result,'c').evidence,null);
});
test('legal Wild +4 failed challenge draws six; acceptance draws four; no stacking',()=>{
  const g=fixture(); g.hands.a=[c('wild','wild','wilddraw4'),c('other','gold','8')];
  const pending=act(g,'a',{type:'play',cards:['wild'],color:'gold'},1);
  assert.equal(act(pending,'b',{type:'challenge'},2).hands.b.length,7);
  assert.equal(act(pending,'b',{type:'accept'},2).hands.b.length,5);
  assert.equal(act(pending,'b',{type:'accept'},2).turn,'c');
  assert.throws(()=>act(pending,'b',{type:'play',cards:['b']},2));
});
test('final +4 waits for resolution and counts drawn penalty cards in scoring',()=>{
  const g=fixture(); g.hands.a=[c('wild','wild','wilddraw4')];
  let result=act(g,'a',{type:'play',cards:['wild'],color:'gold'},1); assert.equal(result.winner,null);
  result=act(result,'b',{type:'accept'},2); assert.equal(result.phase,'round-end'); assert.equal(result.scores.a,14);
  assert.equal(result.roundWinner,'a');
});
test('scores carry between rounds and match ends at 500',()=>{
  const g=fixture(); g.hands.a=[c('a')]; g.scores.a=499;
  const result=act(g,'a',{type:'play',cards:['a']},1); assert.equal(result.phase,'finished'); assert.equal(result.winner,'a');
  g.scores.a=0; const round=act(g,'a',{type:'play',cards:['a']},1);
  const next=act(round,'b',{type:'next-round'},2); assert.equal(next.round,g.round+1); assert.equal(next.scores.a,6);
});
test('two-player reverse returns turn and draw-two skips recipient',()=>{
  const g=fixture(); g.players=['a','b']; delete g.hands.c;
  g.hands.a=[c('r','ruby','reverse'),c('other')]; assert.equal(act(g,'a',{type:'play',cards:['r']},1).turn,'a');
  g.hands.a=[c('d2','ruby','draw2'),c('other')]; const result=act(g,'a',{type:'play',cards:['d2']},1);
  assert.equal(result.turn,'a'); assert.equal(result.hands.b.length,3);
});
test('opening action cards, deck recycling and personalized views preserve inventory',()=>{
  for(let n=0;n<100;n++) {
    const g=create(players,0); assert.notEqual(g.discard[0].value,'wilddraw4');
    const cards=[...g.drawPile,...g.discard,...Object.values(g.hands).flat()]; assert.equal(new Set(cards.map(c=>c.id)).size,108);
    assert.ok(!('hands' in view(g,'a'))); assert.equal(view(g,'outsider').hand.length,0);
  }
});
test('30 full classic matches reach 500 points while conserving every card',()=>{
  for(let n=0;n<30;n++) {
    let g=create(players,0),time=1,moves=0;
    while(g.phase!=='finished' && moves++<10000){
      const v=view(g,g.turn); let a;
      if(g.phase==='round-end') a={type:'next-round'};
      else if(g.phase==='choose-color') a={type:'choose-color',color:'ruby'};
      else if(g.phase==='challenge') a={type:Math.random()<.3?'challenge':'accept'};
      else { const id=v.legalCardIds[0]; a=id?{type:'play',cards:[id],color:'ruby',declare:true}:{type:g.phase==='drawn'?'pass':'draw'}; }
      g=act(g,g.turn,a,time++);
      const cards=[...g.drawPile,...g.discard,...Object.values(g.hands).flat()]; assert.equal(cards.length,108); assert.equal(new Set(cards.map(c=>c.id)).size,108);
    }
    assert.equal(g.phase,'finished'); assert.ok(g.scores[g.winner]>=500);
  }
});
