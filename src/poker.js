import { randomInt } from 'node:crypto';
import { configurePresentation, paced, beginPresentation, readyPresentation, presentationComplete, presentationView } from './presentation.js';
const RANKS=['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const RANK_NAMES={2:'two',3:'three',4:'four',5:'five',6:'six',7:'seven',8:'eight',9:'nine',10:'ten',11:'jack',12:'queen',13:'king',14:'ace'};
const rankName=n=>RANK_NAMES[n]||String(n);
const rankPlural=n=>rankName(n)+(Number(n)===6?'es':'s');
const check=(ok,msg)=>{if(!ok)throw new Error(msg);};
const compare=(a,b)=>{for(let i=0;i<Math.max(a.length,b.length);i++){const d=(a[i]||0)-(b[i]||0);if(d)return d;}return 0;};
function five(cards){
 const nums=cards.map(c=>RANKS.indexOf(c.rank)+2).sort((a,b)=>b-a),counts=new Map();for(const n of nums)counts.set(n,(counts.get(n)||0)+1);
 const groups=[...counts].sort((a,b)=>b[1]-a[1]||b[0]-a[0]),flush=cards.every(c=>c.suit===cards[0].suit),unique=[...new Set(nums)];
 const straight=unique.length===5?(unique[0]-unique[4]===4?unique[0]:unique.join(',')==='14,5,4,3,2'?5:0):0;
 if(flush&&straight)return [8,straight];if(groups[0][1]===4)return [7,groups[0][0],groups[1][0]];
 if(groups[0][1]===3&&groups[1][1]===2)return [6,groups[0][0],groups[1][0]];
 if(flush)return [5,...nums];if(straight)return [4,straight];
 if(groups[0][1]===3)return [3,groups[0][0],...groups.slice(1).map(g=>g[0])];
 if(groups[0][1]===2&&groups[1][1]===2)return [2,Math.max(groups[0][0],groups[1][0]),Math.min(groups[0][0],groups[1][0]),groups[2][0]];
 if(groups[0][1]===2)return [1,groups[0][0],...groups.slice(1).map(g=>g[0])];return [0,...nums];
}
export function evaluateHand(cards){
 check(cards.length>=5&&cards.length<=7,'Evaluate five to seven cards');let rank=null,best=[];
 for(let a=0;a<cards.length-4;a++)for(let b=a+1;b<cards.length-3;b++)for(let c=b+1;c<cards.length-2;c++)for(let d=c+1;d<cards.length-1;d++)for(let e=d+1;e<cards.length;e++){
   const selected=[cards[a],cards[b],cards[c],cards[d],cards[e]],candidate=five(selected);if(!rank||compare(candidate,rank)>0){rank=candidate;best=selected;}
 }
 const name=['High card','One pair','Two pair','Three of a kind','Straight','Flush','Full house','Four of a kind','Straight flush'][rank[0]];
 const singular=rankName,plural=rankPlural;
 const description=[`${singular(rank[1])} high`,`${plural(rank[1])}, ${singular(rank[2])} kicker`,`${plural(rank[1])} and ${plural(rank[2])}`,`${plural(rank[1])}, ${singular(rank[2])} kicker`,`${singular(rank[1])} high`,`${singular(rank[1])} high`,`${plural(rank[1])} full of ${plural(rank[2])}`,`${plural(rank[1])}, ${singular(rank[2])} kicker`,`${singular(rank[1])} high`][rank[0]];
 return {rank,name,description,cardIds:best.map(c=>c.id)};
}

function currentHand(g,id){
 const hand=g.hands[id]||[];
 if(hand.length!==2)return null;
 if(g.board.length>=3){const {name,description,cardIds}=evaluateHand([...hand,...g.board]);return {name,description,cardIds};}
 const high=[...hand].sort((a,b)=>RANKS.indexOf(b.rank)-RANKS.indexOf(a.rank))[0].rank;
 const n=RANKS.indexOf(high)+2,label=rankName(n);
 return {name:hand[0].rank===hand[1].rank?`Pocket ${rankPlural(n)}`:`${label[0].toUpperCase()+label.slice(1)} high`,
   description:hand[0].rank===hand[1].rank?'Starting pair':hand[0].suit===hand[1].suit?'Suited starting cards':'Offsuit starting cards',cardIds:hand.map(c=>c.id)};
}

function record(g,kind,data={}){g.events||=[];g.eventSequence=(g.eventSequence||0)+1;g.events.push({id:`${g.handNumber}:${g.eventSequence}`,kind,...structuredClone(data)});if(g.events.length>120)g.events.shift();}
function resultView(result,id){if(!result)return null;const {privateHands,...publicResult}=result;return {...structuredClone(publicResult),ownHand:structuredClone(privateHands?.[id]||[])};}
export function settlePots(players,contributions,folded,ranks,order=players){
 const payouts=Object.fromEntries(players.map(p=>[p,0])),pots=[];let previous=0;
 for(const level of [...new Set(Object.values(contributions).filter(n=>n>0))].sort((a,b)=>a-b)){
  const contributors=players.filter(p=>contributions[p]>=level),amount=(level-previous)*contributors.length;previous=level;
  if(contributors.length===1){payouts[contributors[0]]+=amount;pots.push({amount,winners:[contributors[0]],uncalled:true});continue;}
  const eligible=contributors.filter(p=>!folded[p]);check(eligible.length,'A pot must have an eligible player');
  let best=eligible[0];for(const p of eligible)if(compare(ranks[p],ranks[best])>0)best=p;
  const winners=order.filter(p=>eligible.includes(p)&&compare(ranks[p],ranks[best])===0);const share=Math.floor(amount/winners.length);let remainder=amount%winners.length;
  for(const p of winners)payouts[p]+=share+(remainder-->0?1:0);pots.push({amount,winners});
 }
 return {payouts,pots};
}
const next=(g,id,predicate=()=>true)=>{let n=g.players.indexOf(id);for(let i=0;i<g.players.length;i++){n=(n+1)%g.players.length;if(predicate(g.players[n]))return g.players[n];}return null;};
const active=g=>g.players.filter(p=>!g.folded[p]);
const canAct=(g,p)=>!g.folded[p]&&g.stacks[p]>0;
const total=g=>Object.values(g.contributions).reduce((a,b)=>a+b,0);
function pay(g,id,amount){const n=Math.min(amount,g.stacks[id]);g.stacks[id]-=n;g.bets[id]+=n;g.contributions[id]+=n;}
function finish(g){
 g.phase='finished';g.payouts={...g.stacks};const max=Math.max(...Object.values(g.stacks));g.winners=g.players.filter(p=>g.stacks[p]===max);g.winner=g.winners.length===1?g.winners[0]:null;g.deadline=null;g.message='Session closed. Each player’s remaining stack returns to their wallet.';
}
function showdown(g,now){
 const live=active(g),ranks={};g.showdown={};
 for(const p of live){ranks[p]=live.length===1?[0]:evaluateHand([...g.hands[p],...g.board]).rank;if(live.length>1)g.showdown[p]={hand:structuredClone(g.hands[p]),...evaluateHand([...g.hands[p],...g.board])};}
 const order=[];let p=g.dealer;for(let i=0;i<g.players.length;i++){p=next(g,p);order.push(p);}
 const result=settlePots(g.players,g.contributions,g.folded,ranks,order);for(const p of g.players)g.stacks[p]+=result.payouts[p];
 record(g,'result',{pots:result.pots,showdown:g.showdown});
 g.lastResult={...result,id:`poker:${now}:${g.handNumber}`,pot:total(g),handNumber:g.handNumber,board:structuredClone(g.board),showdown:structuredClone(g.showdown),events:structuredClone(g.events),privateHands:structuredClone(g.hands)};
 g.recentResults||=[];g.recentResults.push(structuredClone(g.lastResult));g.recentResults=g.recentResults.slice(-10);
 g.contributions=Object.fromEntries(g.players.map(p=>[p,0]));g.bets={...g.contributions};g.currentBet=0;
 const extra=Math.max(0,result.pots.filter(p=>!p.uncalled).length-1)*2500;
 beginPresentation(g,live.length===1?'poker-uncontested':'poker-showdown',now,live.length===1?4500:11000+extra,Math.min(30000,20000+extra));
 if(g.cashoutRequested||g.handNumber>=10||g.players.filter(p=>g.stacks[p]>0).length<2)finish(g);
 else{g.phase='between-hands';g.turn=next(g,g.dealer,p=>g.stacks[p]>0);g.message='Hand settled. Review the result, then ready up.';}
}

function dealStreet(g){
 g.burn.push(g.deck.pop());const count=g.street==='preflop'?3:1;for(let i=0;i<count;i++)g.board.push(g.deck.pop());
 g.street={preflop:'flop',flop:'turn',turn:'river'}[g.street];g.bets=Object.fromEntries(g.players.map(p=>[p,0]));g.currentBet=0;g.lastRaise=g.bigBlind;g.actedAt={};g.lastAction={};
 record(g,'board',{street:g.street,board:g.board});
}
function advance(g,now){
 if(active(g).length===1){showdown(g,now);return;}
 const contenders=g.players.filter(p=>canAct(g,p));
 if(contenders.length<=1){const p=contenders[0];if(p&&g.bets[p]<g.currentBet&&g.pending.includes(p)){g.turn=p;g.deadline=now+30000;return;}}
 g.pending=g.pending.filter(p=>canAct(g,p));
 if(g.pending.length && contenders.length>1){g.turn=next(g,g.turn,p=>g.pending.includes(p));g.deadline=now+30000;return;}
 if(g.street==='river'){showdown(g,now);return;}
 if(contenders.length<=1){g.phase='runout';g.presentation=null;g.deadline=now+paced(g,1800);g.message='All in. Running out the board.';return;}
 dealStreet(g);g.pending=g.players.filter(p=>canAct(g,p));
 g.turn=g.dealer;
 if(g.pending.length<=1)advance(g,now);else{g.turn=next(g,g.dealer,p=>canAct(g,p));g.deadline=now+30000;}
}
function begin(g,now,first=false){
 if(!first)g.dealer=next(g,g.dealer,p=>g.stacks[p]>0);
 g.handNumber++;g.phase='play';g.street='preflop';g.winner=null;g.winners=[];g.board=[];g.burn=[];g.showdown={};g.cashoutRequested=false;g.presentation=null;g.events=[];g.eventSequence=0;
 g.deck=['clubs','diamonds','hearts','spades'].flatMap(suit=>RANKS.map(rank=>({id:suit+'-'+rank,suit,rank})));
 for(let i=51;i>0;i--){const j=randomInt(i+1);[g.deck[i],g.deck[j]]=[g.deck[j],g.deck[i]];}
 g.folded=Object.fromEntries(g.players.map(p=>[p,g.stacks[p]===0]));g.hands=Object.fromEntries(g.players.map(p=>[p,g.folded[p]?[]:[g.deck.pop(),g.deck.pop()]]));
 g.bets=Object.fromEntries(g.players.map(p=>[p,0]));g.contributions={...g.bets};g.actedAt={};g.lastAction={};g.lastRaise=g.bigBlind;
 const live=active(g);g.smallBlindPlayer=live.length===2?g.dealer:next(g,g.dealer,p=>!g.folded[p]);g.bigBlindPlayer=next(g,g.smallBlindPlayer,p=>!g.folded[p]);
 pay(g,g.smallBlindPlayer,g.smallBlind);pay(g,g.bigBlindPlayer,g.bigBlind);g.currentBet=g.bigBlind;g.pending=g.players.filter(p=>canAct(g,p));
 record(g,'deal',{dealer:g.dealer,smallBlindPlayer:g.smallBlindPlayer,bigBlindPlayer:g.bigBlindPlayer,smallBlind:g.smallBlind,bigBlind:g.bigBlind});
 g.turn=g.bigBlindPlayer;g.message=`Hand ${g.handNumber}. Blinds ${g.smallBlind}/${g.bigBlind}.`;advance(g,now);
}
export function createPoker(players,now=Date.now(),options={}){
 const {buyIn=250,smallBlind:configuredSmall,bigBlind:configuredBig}=options;
 check(players.length>=2&&players.length<=6&&new Set(players).size===players.length,'Poker needs 2–6 distinct players');check(Number.isSafeInteger(buyIn)&&buyIn>=10,'Invalid buy-in');
 const smallBlind=configuredSmall??Math.max(1,Math.floor(buyIn/100)),bigBlind=configuredBig??smallBlind*2;check(Number.isSafeInteger(smallBlind)&&Number.isSafeInteger(bigBlind)&&smallBlind>=1&&bigBlind>smallBlind&&bigBlind<=buyIn,'Invalid blinds');const g={type:'poker',players:[...players],stacks:Object.fromEntries(players.map(p=>[p,buyIn])),buyIn,smallBlind,bigBlind,dealer:players[0],handNumber:0,moves:0};configurePresentation(g,options);begin(g,now,true);return g;
}
function raiseAllowed(g,id){return g.players.some(p=>p!==id&&canAct(g,p)) && (g.actedAt[id]===undefined || (g.lastAction[id]==='check'&&g.actedAt[id]===0) || g.currentBet-g.actedAt[id]>=g.lastRaise);}
export function actPoker(original,id,a,now=Date.now()){
 check(original.players.includes(id),'Not seated');check(original.phase!=='finished'&&(now<original.deadline||original.presentation),'Action window ended');const g=structuredClone(original);
 if(a.type==='request-cashout'){if(g.phase==='between-hands')finish(g);else{g.cashoutRequested=true;g.message='Cash-out requested. This session will settle after the current hand.';}return g;}
 if(g.phase==='between-hands'){check(['cashout','next-hand','ready','continue'].includes(a.type),'Cash out or ready up');if(a.type==='cashout')finish(g);else if(g.presentation?readyPresentation(g,id,now):true)begin(g,now);return g;}
 check(g.phase==='play','Wait for the board reveal');
 check(id===g.turn&&canAct(g,id),'Not your turn');let type=a.type;const due=Math.max(0,g.currentBet-g.bets[id]),max=g.bets[id]+g.stacks[id];
 if(type==='allin'){if(max<=g.currentBet)type='call';else{type='raise';a={...a,amount:max};}}
 if(type==='fold')g.folded[id]=true;
 else if(type==='check')check(due===0,'You must call or fold');
 else if(type==='call'){check(due>0,'Nothing to call');pay(g,id,due);}
 else if(type==='raise'){
   check(raiseAllowed(g,id),'Betting has not reopened for you');
   check(Number.isSafeInteger(a.amount)&&a.amount>g.currentBet&&a.amount<=max,'Raise must be a total street wager within your stack');
   const increment=a.amount-g.currentBet;check(increment>=g.lastRaise||a.amount===max,'Raise is below the minimum');
   pay(g,id,a.amount-g.bets[id]);if(increment>=g.lastRaise)g.lastRaise=increment;g.currentBet=a.amount;
   g.pending=g.players.filter(p=>p!==id&&canAct(g,p)&&g.bets[p]<g.currentBet);
 }else throw new Error('Invalid poker action');
 record(g,'action',{player:id,action:type,amount:g.bets[id],street:g.street});
 g.pending=g.pending.filter(p=>p!==id);g.actedAt[id]=g.currentBet;g.lastAction[id]=type;g.message=`${type} accepted.`;g.moves++;advance(g,now);return g;
}
export function tickPoker(g,now=Date.now()){
 if(g.phase==='finished'||now<g.deadline)return g;
 if(g.phase==='runout'){const next=structuredClone(g);if(next.street==='river')showdown(next,now);else{dealStreet(next);next.deadline=now+paced(next,1800);next.message=`${next.street[0].toUpperCase()+next.street.slice(1)} revealed.`;}return next;}
 if(g.phase==='between-hands'){const next=structuredClone(g);if(presentationComplete(next,now))begin(next,now);return next;}
 return actPoker({...g,deadline:now+1},g.turn,{type:g.phase==='between-hands'?'next-hand':g.currentBet===g.bets[g.turn]?'check':'fold'},now);
}
export function viewPoker(g,id){
 const own=g.phase==='play'&&g.turn===id&&canAct(g,id),due=Math.max(0,g.currentBet-(g.bets[id]||0)),max=(g.bets[id]||0)+(g.stacks[id]||0),canRaise=own&&max>g.currentBet&&raiseAllowed(g,id);
 return {type:g.type,players:[...g.players],hand:structuredClone(g.hands[id]||[]),counts:Object.fromEntries(g.players.map(p=>[p,g.hands[p].length])),turn:g.turn,phase:g.phase,winner:g.winner,winners:g.winners,deadline:g.deadline,message:g.message,
  board:structuredClone(g.board),stacks:{...g.stacks},bets:{...g.bets},contributions:{...g.contributions},folded:{...g.folded},dealer:g.dealer,smallBlind:g.smallBlind,bigBlind:g.bigBlind,smallBlindPlayer:g.smallBlindPlayer,bigBlindPlayer:g.bigBlindPlayer,
  street:g.street,handNumber:g.handNumber,pot:total(g),toCall:Math.min(due,g.stacks[id]||0),minRaise:g.currentBet+g.lastRaise,maxRaise:max,showdown:structuredClone(g.showdown),lastResult:resultView(g.lastResult,id),recentResults:(g.recentResults||[]).map(result=>resultView(result,id)),payouts:g.payouts?{...g.payouts}:null,cashoutRequested:g.cashoutRequested,
  presentation:presentationView(g),currentHand:currentHand(g,id),events:structuredClone(g.events||[]),pace:g.pace,
  legalActions:own?['fold',due?'call':'check',...(canRaise?['raise']:[]),...(max<=g.currentBet||canRaise?['allin']:[])]:[]};
}
