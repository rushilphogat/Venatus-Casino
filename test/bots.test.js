import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,viewGame,actGame,tickGame} from '../src/games.js';
import {botAction} from '../src/bots.js';
import {evaluateHand} from '../src/poker.js';
for(const type of ['bluff','chromatic','poker','ohhell','rummy']) test(`${type} bots use legal private-view actions`,()=>{
  let g=createGame(type,['a','b','c'],0,{buyIn:137,houseRules:'street'}),now=1;
  for(let i=0;i<150 && g.phase!=='finished';i++) {
    const view=viewGame(g,g.turn),a=botAction(view,()=>0.6);
    if(a)g=actGame(g,g.turn,a,now);
    else {now=g.deadline;g=tickGame(g,now);}
    now++;
  }
  assert.ok(g);
});

test('all difficulty levels return executable actions from their private views',()=>{
  for(const type of ['bluff','chromatic','poker','ohhell','rummy']) for(const difficulty of ['easy','medium','hard']) {
    let game=createGame(type,['a','b','c'],0,{buyIn:137,houseRules:'street'});
    const view=viewGame(game,game.turn), action=botAction(view,()=>0.4,difficulty);
    assert.ok(action,`${type}/${difficulty} should act on the opening turn`);
    assert.equal('hands' in view,false,`${type} view must not expose all hands`);
    assert.equal('deck' in view,false,`${type} view must not expose the deck`);
    assert.doesNotThrow(()=>actGame(game,game.turn,action,1),`${type}/${difficulty} action should be legal`);
  }
});

test('poker strategy values made hand strength against pot odds',()=>{
  const base={type:'poker',phase:'play',street:'flop',hand:[{rank:'A',suit:'spades'},{rank:'A',suit:'hearts'}],board:[{rank:'A',suit:'clubs'},{rank:'7',suit:'diamonds'},{rank:'2',suit:'hearts'}],
    legalActions:['fold','call','raise'],toCall:10,pot:100,minRaise:20,maxRaise:300,bigBlind:2,bets:{bot:0},turn:'bot'};
  assert.notEqual(botAction(base,()=>0.9,'hard').type,'fold');
  const weak={...base,hand:[{rank:'7',suit:'spades'},{rank:'2',suit:'hearts'}],board:[{rank:'A',suit:'clubs'},{rank:'K',suit:'diamonds'},{rank:'Q',suit:'hearts'}],toCall:250,pot:20};
  assert.equal(botAction(weak,()=>0.9,'hard').type,'fold');
  assert.equal(evaluateHand([...base.hand,...base.board]).name,'Three of a kind');
});

test('Oh Hell bids respond to trump strength and choose an available bid',()=>{
  const view={type:'ohhell',phase:'bid',handSize:3,turn:'bot',dealer:'other',trumpCard:{suit:'hearts'},
    hand:[{suit:'hearts',rank:'A'},{suit:'hearts',rank:'K'},{suit:'clubs',rank:'2'}],legalBids:[0,1,2,3]};
  const action=botAction(view,()=>0.5,'hard');
  assert.ok(view.legalBids.includes(action.amount));
  assert.ok(action.amount>=1);
});

test('Chromatic strategy preserves wilds when a regular legal card is available',()=>{
  const wild={id:'w',color:'wild',value:'wild'},number={id:'r',color:'ruby',value:'7'};
  const view={type:'chromatic',phase:'play',hand:[wild,number],colors:['ruby','emerald','sapphire','gold'],activeColor:'ruby',
    topCard:{color:'ruby',value:'2'},legalCardIds:['w','r'],counts:{bot:2,next:5},players:['bot','next'],turn:'bot'};
  const action=botAction(view,()=>0.9,'hard');
  assert.deepEqual(action.cards,['r']);
});

test('Rummy discards an unmatched high card ahead of an otherwise grouped hand',()=>{
  const cards=[];
  const add=(suit,ranks)=>ranks.forEach(rank=>cards.push({id:`${suit}-${rank}`,suit,rank}));
  add('hearts',['3','4','5']);add('spades',['7','8','9']);add('clubs',['Q','K','A']);add('diamonds',['2','3','4']);
  cards.push({id:'diamonds-10',suit:'diamonds',rank:'10'},{id:'clubs-9',suit:'clubs',rank:'9'});
  const view={type:'rummy',phase:'discard',hand:cards,wildRank:'JOKER'};
  const action=botAction(view,()=>0.5,'hard');
  assert.deepEqual(action,{type:'discard',cards:['diamonds-10']});
});

test('Bluff challenge logic can only use the bot hand and public claim',()=>{
  const view={type:'bluff',phase:'challenge',turn:'declarer',requiredRank:'A',
    hand:['clubs','diamonds','hearts','spades'].map(suit=>({id:`${suit}-A`,suit,rank:'A'})),
    counts:{declarer:2},lastPlay:{player:'declarer',rank:'A',count:1}};
  assert.deepEqual(botAction(view,()=>0.5,'easy'),{type:'challenge'});
});
