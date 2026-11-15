import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {socialRoom} from '../public/social.js';
import {specialRoom} from '../public/special.js';
import {orderedHand,handTools,renderHand} from '../public/experience.js';
import {createGame,viewGame} from '../src/games.js';
function client(){
 const app={innerHTML:''},modal={innerHTML:'',showModal(){},close(){}};
 const document={querySelector:s=>s==='#app'?app:modal,addEventListener(){},querySelectorAll:()=>[]};
 const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/boot\(\);\s*$/,'');
 const ctx=vm.createContext({document,location:{search:''},URLSearchParams,localStorage:{getItem:()=>null},window:{},setInterval:()=>0,clearInterval(){},setTimeout:()=>0,clearTimeout(){},specialRoom,orderedHand,handTools,renderHand,handleExperienceAction:()=>false,installHandDrag(){},console,socialRoom,installSpecialInput(){}});
 vm.runInContext(source+'\nglobalThis.ui={state,renderRoom,renderLobby,renderEvents,createTable,applyRoom};',ctx);
 ctx.ui.state.user={id:'a',name:'Alice',role:'player'};
 return {...ctx.ui,app,modal};
}
test('casual and event lobbies show distinct economies',()=>{
 const c=client();c.state.lobby={events:[],tables:[],wallet:{available:9999},settings:{},leaderboard:[]};c.renderLobby();
 assert.match(c.app.innerHTML,/Card room/);assert.doesNotMatch(c.app.innerHTML,/9,999/);
 c.state.context='event';c.state.lobby.events=[{id:'event',name:'Friday',status:'active',games:['poker'],stakes:[100]}];c.renderLobby();assert.match(c.app.innerHTML,/9,999/);
 c.renderEvents();assert.match(c.app.innerHTML,/Casino events/);
});
test('all games render real private views and expose leave controls',()=>{
 const c=client();
 for(const game of ['bluff','chromatic','poker','ohhell','rummy']){
  const g=createGame(game,['a','b','c'],Date.now(),{buyIn:100,houseRules:'street'});
  c.state.room={id:game,game,name:'Test',context:'casual',practice:true,stake:100,status:'playing',host:'a',players:['a','b','c'].map(id=>({id,name:id})),state:viewGame(g,'a')};
  c.renderRoom();assert.match(c.app.innerHTML,/data-action="leave-table"/);assert.doesNotMatch(c.app.innerHTML,/undefined/);
 }
});
test('table creation distinguishes casual scoring from poker stack and event stake',()=>{
 const c=client();c.state.lobby={events:[]};c.createTable('chromatic');assert.match(c.modal.innerHTML,/name="stake" type="hidden" value="0"/);c.createTable('poker');assert.match(c.modal.innerHTML,/Starting stack/);
});

test('an older refresh cannot overwrite a confirmed game action',()=>{
  const c=client();
  c.state.page='room';c.state.roomId='current';
  const latest={id:'current',version:12,state:{phase:'play'}};
  c.state.room=latest;
  c.applyRoom({id:'current',version:11,state:{phase:'draw'}});
  assert.equal(c.state.room,latest);
  c.applyRoom({id:'different',version:99});
  assert.equal(c.state.room,latest);
});
test('Poker creation filters zero-stake presets from event choices',()=>{
  const c=client();c.state.context='event';c.state.lobby={events:[{id:'event',stakes:[0,50,100]}]};
  c.createTable('poker');assert.doesNotMatch(c.modal.innerHTML,/<option value="0">/);assert.match(c.modal.innerHTML,/<option value="50">/);
});

test('a changed legal hand clears a selection that can no longer be played',()=>{
  const c=client(),g=createGame('chromatic',['a','b','c'],Date.now(),{houseRules:'street'});
  const view=viewGame(g,'a');view.legalCardIds=[];
  c.state.room={id:'changed-hand',game:'chromatic',name:'Cards',practice:true,status:'playing',host:'a',players:['a','b','c'].map(id=>({id,name:id})),state:view};
  c.state.selected.add(view.hand[0].id);
  c.renderRoom();
  assert.equal(c.state.selected.size,0);
});
