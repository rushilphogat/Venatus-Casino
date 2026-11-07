import { randomInt } from 'node:crypto';
const RANKS=['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const SCHEDULE=[1,2,3,4,5,4,3,2,1];
const check=(ok,msg)=>{if(!ok)throw new Error(msg);};
const next=(g,p)=>g.players[(g.players.indexOf(p)+1)%g.players.length];
function round(g,now){
  const deck=['clubs','diamonds','hearts','spades'].flatMap(suit=>RANKS.map(rank=>({id:suit+'-'+rank,suit,rank})));
  for(let i=51;i>0;i--){const j=randomInt(i+1);[deck[i],deck[j]]=[deck[j],deck[i]];}
  g.round++;g.handSize=SCHEDULE[g.round-1];g.hands=Object.fromEntries(g.players.map(p=>[p,deck.splice(0,g.handSize)]));
  g.trumpCard=deck.shift();g.stock=deck;g.bids={};g.tricks=Object.fromEntries(g.players.map(p=>[p,0]));g.trick=[];g.lastTrick=[];g.taken=[];
  g.turn=next(g,g.dealer);g.phase='bid';g.deadline=now+30000;g.message=`Round ${g.round}: bid how many of ${g.handSize} tricks you will win.`;
}
export function createOhHell(players,now=Date.now()){
  check(players.length>=3 && players.length<=6 && new Set(players).size===players.length,'Oh Hell needs 3–6 distinct players');
  const g={type:'ohhell',players:[...players],dealer:players.at(-1),scores:Object.fromEntries(players.map(p=>[p,0])),round:0,winner:null,winners:[],moves:0,history:[]};round(g,now);return g;
}
export function legalBids(g){
  const bids=Array.from({length:g.handSize+1},(_,i)=>i);
  const total=Object.values(g.bids).reduce((a,b)=>a+b,0);
  return g.turn===g.dealer ? bids.filter(n=>n+total!==g.handSize) : bids;
}
export function legalTrickCards(g,id){
  const hand=g.hands[id]||[],suit=g.trick[0]?.card.suit;
  return suit && hand.some(c=>c.suit===suit)?hand.filter(c=>c.suit===suit):hand;
}
export function trickWinner(trick,trump){
  const lead=trick[0].card.suit;
  const strength=c=>(c.suit===trump?100:c.suit===lead?50:0)+RANKS.indexOf(c.rank);
  return trick.reduce((best,p)=>strength(p.card)>strength(best.card)?p:best).player;
}
export function actOhHell(original,id,a,now=Date.now()){
  check(original.players.includes(id),'Not seated');check(original.phase!=='finished' && now<original.deadline,'Action window ended');
  const g=structuredClone(original);
  if(g.phase==='round-end'){
    check(a.type==='next-round','Start next round');g.dealer=next(g,g.dealer);round(g,now);return g;
  }
  check(g.turn===id,'Not your turn');
  if(g.phase==='bid'){
    check(a.type==='bid' && legalBids(g).includes(a.amount),'Choose a legal bid; total bids cannot equal the tricks on the dealer’s bid');g.bids[id]=a.amount;
    g.turn=next(g,id);if(Object.keys(g.bids).length===g.players.length){g.phase='play';g.turn=next(g,g.dealer);g.message='Bids are locked. Follow the suit led when possible.';}
  }else{
    check(a.type==='play' && Array.isArray(a.cards) && a.cards.length===1,'Play one card');
    const card=legalTrickCards(g,id).find(c=>c.id===a.cards[0]);check(card,'You must follow suit if able');
    g.hands[id]=g.hands[id].filter(c=>c.id!==card.id);g.trick.push({player:id,card});g.turn=next(g,id);
    if(g.trick.length===g.players.length){
      const won=trickWinner(g.trick,g.trumpCard.suit);g.tricks[won]++;g.lastTrick=g.trick;g.taken.push(...g.trick.map(p=>p.card));g.trick=[];g.turn=won;g.lastTrickWinner=won;g.message='Trick complete. The winner leads.';
      if(g.players.every(p=>!g.hands[p].length)){
        for(const p of g.players)if(g.bids[p]===g.tricks[p])g.scores[p]+=10+g.bids[p];
        g.history.push({round:g.round,bids:{...g.bids},tricks:{...g.tricks},scores:{...g.scores}});
        if(g.round===SCHEDULE.length){const max=Math.max(...Object.values(g.scores));g.winners=g.players.filter(p=>g.scores[p]===max);g.winner=g.winners.length===1?g.winners[0]:null;g.phase='finished';g.deadline=null;g.message='Nine rounds complete. Highest score wins; tied leaders split the pot.';}
        else{g.phase='round-end';g.message='Round scored: exact bids earn 10 plus the bid. Misses earn zero.';}
      }
    }
  }
  if(g.phase!=='finished')g.deadline=now+(g.phase==='round-end'?15000:30000);g.moves++;return g;
}
export function tickOhHell(g,now=Date.now()){
  if(g.phase==='finished'||now<g.deadline)return g;
  const a=g.phase==='round-end'?{type:'next-round'}:g.phase==='bid'?{type:'bid',amount:legalBids(g)[0]}:{type:'play',cards:[legalTrickCards(g,g.turn)[0].id]};
  return actOhHell({...g,deadline:now+1},g.turn,a,now);
}
export function viewOhHell(g,id){
  return {type:g.type,players:[...g.players],turn:g.turn,phase:g.phase,winner:g.winner,winners:[...g.winners],deadline:g.deadline,message:g.message,
    hand:structuredClone(g.hands[id]||[]),counts:Object.fromEntries(g.players.map(p=>[p,g.hands[p].length])),trumpCard:{...g.trumpCard},trick:structuredClone(g.trick),lastTrick:structuredClone(g.lastTrick),lastTrickWinner:g.lastTrickWinner,
    round:g.round,rounds:SCHEDULE.length,handSize:g.handSize,bids:{...g.bids},tricks:{...g.tricks},scores:{...g.scores},history:structuredClone(g.history),dealer:g.dealer,
    legalBids:g.phase==='bid'&&g.turn===id?legalBids(g):[],legalCardIds:g.phase==='play'&&g.turn===id?legalTrickCards(g,id).map(c=>c.id):[]};
}
