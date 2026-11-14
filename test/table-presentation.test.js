import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,actGame,viewGame} from '../src/games.js';
import {specialRoom,specialTransitionSound} from '../public/special.js';

const ids=['a','b','c'];
const people=ids.map(id=>({id,name:id.toUpperCase()}));
function snapshot(g,version,viewer='a') {
  return {id:g.type,game:g.type,version,players:people,state:viewGame(g,viewer),practice:true,status:g.phase==='finished'?'finished':'playing',name:'Game night',host:'a',stake:100};
}
function render(room,viewer='a'){
  return specialRoom(room,{
    state:{user:{id:viewer},selected:new Set()},card:c=>c?.rank||'back',esc:String,fmt:String,header:()=>'',footer:()=>'',connection:()=>'',gameName:String
  });
}
test('Poker only animates confirmed bets and actual recipients when the pot settles',()=>{
  let g=createGame('poker',ids,0,{buyIn:100});
  const before=snapshot(g,1,g.turn),controls=render(before,g.turn);
  assert.match(controls,/id="bet-slider"/);assert.match(controls,/aria-label="Dealer"/);
  assert.equal(specialTransitionSound(before,before),null);
  g=actGame(g,g.turn,{type:'call'},1);
  const call=snapshot(g,2);
  assert.equal(specialTransitionSound(before,call),'chips');
  g=actGame(g,g.turn,{type:'fold'},2);
  const fold=snapshot(g,3);
  assert.equal(specialTransitionSound(call,fold),'place');
  g=actGame(g,g.turn,{type:'fold'},3);
  const won=snapshot(g,4);
  assert.equal(specialTransitionSound(fold,won),'collect');
  assert.match(render(won),/Main pot/);assert.match(render(won),/winning hand stays private/);
});
test('Oh Hell bid pad matches server bids and a completed trick heads to its winner',()=>{
  let g=createGame('ohhell',ids,0),version=0;
  while(g.phase==='bid') {
    const snap=snapshot(g,version++,g.turn),html=render(snap,g.turn);
    assert.deepEqual([...html.matchAll(/data-move="bid" data-amount="(\d+)"/g)].map(m=>Number(m[1])),snap.state.legalBids);
    g=actGame(g,g.turn,{type:'bid',amount:snap.state.legalBids[0]},1);
  }
  for(let i=0;i<3;i++){
    const before=snapshot(g,version++);
    const card=viewGame(g,g.turn).legalCardIds[0];
    g=actGame(g,g.turn,{type:'play',cards:[card]},2);
    const after=snapshot(g,version++);
    assert.equal(specialTransitionSound(before,after),i===2?'collect':'place');
    assert.match(render(after),/data-trick-card="/);
    if(i===2)assert.match(render(after),new RegExp('Last trick · '+g.lastTrickWinner.toUpperCase()));
  }
});
test('Rummy draw and discard motions use observer-visible changes and checked meld feedback',()=>{
  let g=createGame('rummy',ids,0);
  const before=snapshot(g,1,'b');
  g=actGame(g,g.turn,{type:'draw',source:'stock'},1);
  const draw=snapshot(g,2,'b');
  assert.equal(specialTransitionSound(before,draw),'draw');
  const picked=g.drawnCardId;
  const privateCheck=actGame(g,g.turn,{type:'analyze',cards:[picked]},1);
  assert.match(render(snapshot(privateCheck,3)),/Last group check/);
  assert.doesNotMatch(render(snapshot(privateCheck,3,'b'),'b'),/Last group check/);
  g=actGame(g,g.turn,{type:'discard',cards:[picked]},2);
  const discard=snapshot(g,4,'b');
  assert.equal(specialTransitionSound(draw,discard),'place');
  assert.equal(discard.state.topCard.id,picked);
});
