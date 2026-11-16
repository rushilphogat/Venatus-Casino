import test from 'node:test';import assert from 'node:assert/strict';
import {chooseBotComment,publicTalkState} from '../src/table-talk.js';
const room=()=>({id:'room',status:'playing',game:'chromatic',started:1,players:[{id:'a',name:'Human'},{id:'b',name:'Fox',bot:true}],state:{type:'chromatic',players:['a','b'],phase:'play',round:1,moves:0,hands:{a:[{id:'SECRET'}],b:[{id:'PRIVATE'},{id:'HIDDEN'}]},discard:[{id:'top',value:'3'}],pendingPenalty:0}});
test('bot talk is derived from public facts, bounded and deduplicated across saves',()=>{
 const r=room(),hello=chooseBotComment(r,1000);assert.equal(hello.bot,true);assert.equal(hello.userId,'b');assert.equal(chooseBotComment(r,1100),null);
 assert.ok(!JSON.stringify(publicTalkState(r)).includes('SECRET'));r.state.pendingPenalty=6;r.state.moves=1;const stack=chooseBotComment(r,11000);assert.equal(stack.trigger,'draw_stack');assert.equal(chooseBotComment(r,21000),null);
 r.state.phase='finished';r.state.winner='a';const win=chooseBotComment(r,23000);assert.equal(win.trigger,'public_win');assert.equal(chooseBotComment(structuredClone(r),33000),null);
});
test('bots never speak for human-only or canceled tables, and reverse needs a new public card',()=>{
 const r=room();chooseBotComment(r,1000);r.state.discard=[{id:'reverse',value:'reverse'}];assert.equal(chooseBotComment(r,11000).trigger,'reverse');r.state.moves++;assert.equal(chooseBotComment(r,22000),null);
 r.status='canceled';assert.equal(chooseBotComment(r,33000),null);r.status='playing';r.players=r.players.filter(p=>!p.bot);assert.equal(chooseBotComment(r,44000),null);
});
