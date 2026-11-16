import test from 'node:test';
import assert from 'node:assert/strict';
import {configurePresentation,beginPresentation,readyPresentation,presentationComplete,syncPresentation} from '../src/presentation.js';
test('three humans need two votes; duplicate votes and bot seats cannot form the majority',()=>{
 const g={type:'bluff',players:['a','b','c','bot1','bot2','bot3']};configurePresentation(g,{humanPlayers:['a','b','c']});
 beginPresentation(g,'bluff-verdict',100);
 assert.deepEqual(g.presentation.ready,['bot1','bot2','bot3']);assert.equal(presentationComplete(g,101),false);
 assert.equal(readyPresentation(g,'a',102),false);assert.equal(readyPresentation(g,'a',103),false);
 assert.equal(readyPresentation(g,'c',104),true);
});
test('legacy long holds normalize and departing humans leave the voting population',()=>{
 const g={players:['a','b','c'],humanPlayers:['a','b','c'],presentation:{id:'old',kind:'poker-showdown',startedAt:100,minimumUntil:30100,maximumUntil:86400100,manual:true,ready:['a']}};
 syncPresentation(g);assert.equal(g.deadline,20100);assert.equal(g.presentation.manual,false);
 assert.equal(presentationComplete(g,20099),false);assert.equal(presentationComplete(g,20100),true);
 g.humanPlayers=['a'];assert.equal(presentationComplete(g,102),true);
});
