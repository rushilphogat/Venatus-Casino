import test from 'node:test';
import assert from 'node:assert/strict';
import {orderedHand,handleExperienceAction,renderHand} from '../public/experience.js';
test('hand organization preserves authoritative cards through sort, move, group, and draws',()=>{
 const hand=[{id:'a',rank:'K',suit:'S'},{id:'b',rank:'2',suit:'H'},{id:'c',rank:'3',suit:'H'}];
 const room={id:'layout-test',game:'rummy',state:{hand}}; const selected=new Set(['a']);let renders=0;
 const action=(name,data={})=>handleExperienceAction({dataset:{action:name,...data}},room,selected,()=>renders++);
 action('hand-sort',{sort:'rank'});assert.deepEqual(orderedHand(room).map(c=>c.id),['b','c','a']);
 action('hand-move',{direction:'-1'});assert.deepEqual(orderedHand(room).map(c=>c.id),['b','a','c']);
 action('hand-arrange');action('hand-mark',{id:'b'});action('hand-mark',{id:'c'});action('hand-group');
 assert.deepEqual(orderedHand(room).map(c=>c.id),['a','b','c']);assert.deepEqual([...selected],[], 'arrange mode must clear stale gameplay selection');
 assert.match(renderHand(room,c=>c.id,String,false),/group-start/);
 room.state.hand=[hand[1],{id:'d',rank:'4',suit:'H'}];assert.deepEqual(orderedHand(room).map(c=>c.id),['b','d']);
 assert.deepEqual(hand.map(c=>c.id),['a','b','c']);assert.equal(new Set(orderedHand(room).map(c=>c.id)).size,2);assert.ok(renders>=6);
});
