import test from 'node:test';
import assert from 'node:assert/strict';
import {comments,scenes,sceneFor,commentFor} from '../public/personality.js';
import {beginPresentation,configurePresentation} from '../src/presentation.js';
test('curated scenes cycle deterministically through three variants per public family',()=>{
  for(const family of ['poker','caught','honest','chromatic','rummy']){
    const picked=new Set();for(let round=1;round<=3;round++){
      const event={family,room:{id:'same-table',state:{round}}};const scene=sceneFor(event);picked.add(scene.id);
      assert.equal(sceneFor(structuredClone(event)).id,scene.id);assert.ok(scene.durationMs<=2500);
      assert.equal(sceneFor({...event,room:{...event.room,state:{...event.room.state,hand:['private cards changed']}}}).id,scene.id);
    }assert.equal(picked.size,3);
  }assert.equal(scenes.length,15);
});
test('quick comments are bounded and only selected for their exact public event',()=>{
  for(const c of comments){assert.ok(c.text.length<=48);assert.ok(['poker','bluff','chromatic','rummy','ohhell'].includes(c.game));assert.ok(!/[<>]/.test(c.text));}
  assert.equal(commentFor('bluff','private_hand_strength','seed'),'');
  assert.ok(comments.some(c=>c.trigger==='honest_claim'&&c.text===commentFor('bluff','honest_claim','seed')));
});
test('reveal caps are fixed across every table pace',()=>{
  for(const pace of ['quick','standard','relaxed']){
    const game={type:'bluff',players:['a','b']};configurePresentation(game,{pace});
    for(const kind of ['bluff-verdict','ohhell-trick','ohhell-round']){
      const p=beginPresentation(game,kind,100);assert.equal(p.minimumUntil,100);assert.equal(p.maximumUntil,7100);
    }
    for(const kind of ['poker-showdown','poker-uncontested','match-win'])assert.equal(beginPresentation(game,kind,100).maximumUntil,20100);
  }
});
