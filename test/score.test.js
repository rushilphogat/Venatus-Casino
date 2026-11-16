import test from 'node:test';import assert from 'node:assert/strict';
import {scores,musicState} from '../public/score.js';
test('five composed scores have bounded playable notes and breathing room',()=>{
 assert.equal(Object.keys(scores).length,5);for(const score of Object.values(scores)){assert.equal(score.chords.length,8);assert.ok(score.bpm>=70&&score.bpm<=120);for(const melody of score.melody){assert.equal(melody.length,16);assert.ok(melody.filter(n=>n===null).length>=6);assert.ok(melody.every(n=>n===null||Number.isInteger(n)&&n>=60&&n<=84));}}
});
test('music follows public pressure, suspense and resolution without reading hidden hands',()=>{
 const poker={game:'poker',status:'playing',state:{phase:'play',pot:200,bigBlind:4,hand:[{rank:'A'}]}};
 assert.equal(musicState(poker).mode,'pressure');assert.deepEqual(musicState(poker),musicState({...poker,state:{...poker.state,hand:[{rank:'2'}]}}));
 poker.state.phase='runout';assert.equal(musicState(poker).mode,'suspense');poker.state.phase='between-hands';assert.equal(musicState(poker).mode,'release');
 assert.equal(musicState({game:'chromatic',status:'playing',state:{phase:'play',counts:{a:1,b:5}}}).mode,'pressure');
 assert.equal(musicState({game:'bluff',status:'playing',state:{phase:'challenge'}}).mode,'suspense');
});
