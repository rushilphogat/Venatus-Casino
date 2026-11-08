import test from 'node:test';
import assert from 'node:assert/strict';
import {specialRoom} from '../public/special.js';
test('poker reveals new cards once and identifies showdown winners without folded cards',()=>{
 const c=id=>({id,rank:'A',suit:'S'});
 const g={turn:'a',phase:'between-hands',street:'river',handNumber:1,board:[1,2,3,4,5].map(c),pot:0,smallBlind:1,bigBlind:2,stacks:{a:200,b:0,c:100},folded:{c:true},hand:[c('private')],legalActions:[],lastResult:{handNumber:1,pot:200,pots:[{amount:200,winners:['a']}]},showdown:{a:{name:'Flush',hand:[c('a1'),c('a2')]},b:{name:'One pair',hand:[c('b1'),c('b2')]}}};
 const room={id:'ui-reveal',game:'poker',status:'playing',state:g,players:['a','b','c'].map(id=>({id,name:id})),stake:100,name:'Test'};
 const ui={state:{user:{id:'a'},selected:new Set()},card:c=>`<div class="playing-card">${c?.id||'back'}</div>`,esc:String,fmt:String,header:()=>'',footer:()=>'',connection:()=>'',gameName:()=> 'Poker'};
 const first=specialRoom(room,ui);assert.match(first,/is-revealing/);assert.match(first,/POT WINNER/);assert.match(first,/Flush/);assert.match(first,/HAND POT AWARDED/);
 assert.doesNotMatch(specialRoom(room,ui),/is-revealing/);
 g.showdown={};g.lastResult.pots=[{amount:200,winners:['a']}];
 assert.match(specialRoom(room,ui),/winning hand stays private/);
});

