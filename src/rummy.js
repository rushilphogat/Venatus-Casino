import { randomInt } from 'node:crypto';
const ranks=['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const suits=['clubs','diamonds','hearts','spades'];
const check=(ok,msg)=>{if(!ok)throw new Error(msg);};
const wild=(c,rank)=>c.rank==='JOKER'||c.rank===rank;
const points=(c,rank)=>wild(c,rank)?0:Math.min(c.rank==='A'?10:ranks.indexOf(c.rank)+1,10);
const shuffle=a=>{for(let i=a.length-1;i>0;i--){const j=randomInt(i+1);[a[i],a[j]]=[a[j],a[i]];}return a;};
export function classifyMeld(cards,wildRank){
  if(cards.length<3)return null;
  const noPrinted=cards.every(c=>c.rank!=='JOKER');
  const sequence=natural=>{
    if(!natural.length||new Set(natural.map(c=>c.suit)).size!==1||new Set(natural.map(c=>c.rank)).size!==natural.length)return false;
    return [false,true].some(high=>{
      const nums=natural.map(c=>c.rank==='A'&&high?14:ranks.indexOf(c.rank)+1).sort((a,b)=>a-b);
      return nums.at(-1)-nums[0]+1<=cards.length && cards.length<=13 && Math.max(nums.at(-1),cards.length)<=14;
    });
  };
  if(noPrinted && sequence(cards))return 'pure';
  const natural=cards.filter(c=>!wild(c,wildRank));
  if(sequence(natural))return 'sequence';
  if(cards.length<=4 && natural.length && new Set(natural.map(c=>c.rank)).size===1 && new Set(natural.map(c=>c.suit)).size===natural.length)return 'set';
  return null;
}
// Bitmask dynamic programming checks every legal partition; no greedy declaration shortcut.
export function analyzeRummy(hand,wildRank){
  check(hand.length<=13 && new Set(hand.map(c=>c.id)).size===hand.length,'Analyze at most 13 distinct cards');
  const n=hand.length,full=(1<<n)-1,byFirst=Array.from({length:n},()=>[]),cost=new Map();
  for(let mask=1;mask<=full;mask++){
    const cards=hand.filter((_,i)=>mask&(1<<i));const kind=classifyMeld(cards,wildRank);
    if(kind){const first=Math.clz32(mask&-mask)^31;byFirst[first].push({mask,kind});}
    cost.set(mask,cards.reduce((s,c)=>s+points(c,wildRank),0));
  }
  const memo=new Map();
  function solve(mask,pure,seq){
    if(!mask)return {penalty:pure&&seq>=2?0:1000,groups:[],covered:0};
    const key=`${mask}:${pure}:${Math.min(seq,2)}`;if(memo.has(key))return memo.get(key);
    const first=31-Math.clz32(mask&-mask),bit=1<<first;
    const skipped=solve(mask^bit,pure,seq);let best={penalty:points(hand[first],wildRank)+skipped.penalty,groups:skipped.groups,covered:skipped.covered};
    for(const meld of byFirst[first])if((meld.mask&mask)===meld.mask){
      const result=solve(mask^meld.mask,pure||meld.kind==='pure',seq+(meld.kind==='set'?0:1));
      const count=hand.filter((_,i)=>meld.mask&(1<<i)).length;
      if(result.penalty<best.penalty || (result.penalty===best.penalty && result.covered+count>best.covered))best={penalty:result.penalty,covered:result.covered+count,groups:[{kind:meld.kind,cards:hand.filter((_,i)=>meld.mask&(1<<i)).map(c=>c.id)},...result.groups]};
    }
    memo.set(key,best);return best;
  }
  const result=solve(full,false,0);
  const valid=n===13 && result.penalty===0 && result.groups.reduce((n,g)=>n+g.cards.length,0)===13;
  // Without two sequences, count all cards except an available pure sequence.
  let penalty=result.penalty;
  if(penalty>=1000){let saved=0;for(const group of byFirst.flat())if(group.kind==='pure')saved=Math.max(saved,cost.get(group.mask));penalty=(cost.get(full)||0)-saved;}
  return {valid,penalty:Math.min(80,penalty),groups:result.penalty>=1000?[]:result.groups};
}
const next=g=>{let i=g.players.indexOf(g.turn);do{i=(i+1)%g.players.length;}while(g.dropped[g.players[i]]);return g.players[i];};
function draw(g,id,source){
  if(source==='discard'){const c=g.discard.at(-1);check(c&&!wild(c,g.wildRank),'Jokers cannot be picked up from the discard pile');g.hands[id].push(g.discard.pop());return c;}
  check(source==='stock','Choose stock or discard');
  if(!g.stock.length&&g.discard.length>1){const top=g.discard.pop();g.stock=shuffle(g.discard);g.discard=[top];}
  check(g.stock.length,'No card is available; the table can be canceled and refunded');const c=g.stock.pop();g.hands[id].push(c);return c;
}
function finish(g,id){g.phase='finished';g.winner=id;g.deadline=null;g.penalties=Object.fromEntries(g.players.map(p=>[p,p===id?0:g.dropped[p]||analyzeRummy(g.hands[p],g.wildRank).penalty]));g.message='Rummy complete. The winner receives the pot; penalty points are recorded separately.';}
export function createRummy(players,now=Date.now()){
  check(players.length>=2&&players.length<=6&&new Set(players).size===players.length,'Rummy needs 2–6 distinct players');
  const deck=[];for(let d=0;d<2;d++){for(const suit of suits)for(const rank of ranks)deck.push({id:`${d}-${suit}-${rank}`,suit,rank});for(let j=0;j<2;j++)deck.push({id:`${d}-joker-${j}`,suit:'joker',rank:'JOKER'});}shuffle(deck);
  const indicator=deck.pop();const g={type:'rummy',players:[...players],hands:Object.fromEntries(players.map(p=>[p,deck.splice(0,13)])),indicator,wildRank:indicator.rank==='JOKER'?'A':indicator.rank,stock:deck,discard:[deck.pop()],turn:players[0],phase:'draw',deadline:now+30000,winner:null,moves:0,dropped:{},turns:Object.fromEntries(players.map(p=>[p,0])),analysis:{},message:'Draw from the stock or discard pile, then discard one card.'};return g;
}
export function actRummy(original,id,a,now=Date.now()){
  check(original.players.includes(id)&&!original.dropped[id],'Not an active player');check(original.phase!=='finished'&&now<original.deadline,'Action window ended');
  const g=structuredClone(original);check(id===g.turn,'Not your turn');
  if(a.type==='analyze'){
    const hand=g.hands[id].filter(c=>!a.cards?.includes(c.id));check(hand.length===13,'Choose one card to discard before checking 14 cards');g.analysis[id]=analyzeRummy(hand,g.wildRank);g.message=g.analysis[id].valid?'Your proposed hand is a valid declaration.':'The hand needs two sequences, including one pure sequence, and all 13 cards grouped.';return g;
  }
  if(a.type==='drop'){
    check(g.phase==='draw','Drop before drawing');g.dropped[id]=g.turns[id]?40:20;const active=g.players.filter(p=>!g.dropped[p]);if(active.length===1)finish(g,active[0]);else{g.turn=next(g);g.deadline=now+30000;}return g;
  }
  if(g.phase==='draw'){
    check(a.type==='draw','Draw a card first');g.drawnCardId=draw(g,id,a.source||'stock').id;g.phase='discard';g.message='Discard one card, or declare with a valid remaining 13-card hand.';
  }else{
    check(['discard','declare'].includes(a.type)&&Array.isArray(a.cards)&&a.cards.length===1,'Select one card to discard');
    const selected=g.hands[id].find(c=>c.id===a.cards[0]);check(selected,'You do not hold that card');
    const hand=g.hands[id].filter(c=>c.id!==selected.id);
    if(a.type==='declare')check(analyzeRummy(hand,g.wildRank).valid,'Invalid declaration: group all 13 cards with two sequences including a pure sequence');
    g.hands[id]=hand;g.discard.push(selected);g.turns[id]++;g.analysis[id]=null;
    if(a.type==='declare')finish(g,id);else{g.turn=next(g);g.phase='draw';g.message='Card discarded. Next player draws.';}
  }
  if(g.phase!=='finished')g.deadline=now+30000;g.moves++;return g;
}
export function tickRummy(original,now=Date.now()){
  if(original.phase==='finished'||now<original.deadline)return original;
  let g={...original,deadline:now+1};if(g.phase==='draw')g=actRummy(g,g.turn,{type:'draw',source:'stock'},now);
  return actRummy({...g,deadline:now+1},g.turn,{type:'discard',cards:[g.drawnCardId||g.hands[g.turn].at(-1).id]},now);
}
export function viewRummy(g,id){return {type:g.type,players:[...g.players],turn:g.turn,phase:g.phase,winner:g.winner,deadline:g.deadline,message:g.message,
  hand:structuredClone(g.hands[id]||[]),counts:Object.fromEntries(g.players.map(p=>[p,g.hands[p].length])),indicator:{...g.indicator},wildRank:g.wildRank,topCard:structuredClone(g.discard.at(-1)),stockCount:g.stock.length,dropped:{...g.dropped},penalties:g.penalties?{...g.penalties}:null,analysis:structuredClone(g.analysis[id]||null),canTakeDiscard:g.discard.length>0&&!wild(g.discard.at(-1),g.wildRank)};}
