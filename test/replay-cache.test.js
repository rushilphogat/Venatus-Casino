import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
test('replay history replaces matching snapshots and does not retain another viewer private cards',()=>{
 const context=vm.createContext({localStorage:{getItem:()=>null},document:{querySelector:()=>null},structuredClone,syncCinema(){},updateScore(){}});
 const code=readFileSync(new URL('../public/lounge.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/export /g,'');
 vm.runInContext(code+'\nglobalThis.audit={syncLounge,recent};',context);
 const room=own=>({id:'table',viewerId:own,game:'poker',started:1,status:'playing',players:[{id:'a',name:'A'},{id:'b',name:'B'}],state:{handNumber:2,phase:'play',recentResults:[{id:'result',handNumber:1,pot:10,board:[],showdown:{},pots:[{amount:10,winners:['a']}],ownHand:[{id:own+'-private'}]}]}});
 context.audit.syncLounge(null,room('a'));assert.match(JSON.stringify(context.audit.recent.get('table')),/a-private/);
 const updated=room('a');updated.state.recentResults[0].ownHand=[];context.audit.syncLounge(null,updated);assert.doesNotMatch(JSON.stringify(context.audit.recent.get('table')),/a-private/);
 context.audit.syncLounge(null,room('b'));const history=JSON.stringify(context.audit.recent.get('table'));assert.match(history,/b-private/);assert.doesNotMatch(history,/a-private/);
});
