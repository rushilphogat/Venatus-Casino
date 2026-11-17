import assert from 'node:assert/strict';import {evaluateHand} from '../src/poker.js';
const ranks=['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const deck=['clubs','diamonds','hearts','spades'].flatMap(suit=>ranks.map((rank,i)=>({id:suit+rank,rank,suit,n:i+2})));
function reference(cards){
 const ns=cards.map(c=>c.n).sort((a,b)=>b-a),counts=new Map();ns.forEach(n=>counts.set(n,(counts.get(n)||0)+1));
 const groups=[...counts].sort((a,b)=>b[1]-a[1]||b[0]-a[0]);
 const straight=nums=>{const set=new Set(nums);if(set.has(14))set.add(1);for(let n=14;n>=5;n--)if([0,1,2,3,4].every(d=>set.has(n-d)))return n;return 0;};
 const flush=['clubs','diamonds','hearts','spades'].map(s=>cards.filter(c=>c.suit===s).map(c=>c.n).sort((a,b)=>b-a)).find(a=>a.length>=5);
 if(flush&&straight(flush))return[8,straight(flush)];
 if(groups[0][1]===4)return[7,groups[0][0],ns.find(n=>n!==groups[0][0])];
 const trips=groups.filter(g=>g[1]>=3).map(g=>g[0]),pairs=groups.filter(g=>g[1]>=2).map(g=>g[0]);
 if(trips.length&&pairs.some(n=>n!==trips[0]))return[6,trips[0],Math.max(...pairs.filter(n=>n!==trips[0]))];
 if(flush)return[5,...flush.slice(0,5)];if(straight(ns))return[4,straight(ns)];
 if(trips.length)return[3,trips[0],...ns.filter(n=>n!==trips[0]).slice(0,2)];
 pairs.sort((a,b)=>b-a);if(pairs.length>=2)return[2,...pairs.slice(0,2),ns.find(n=>!pairs.slice(0,2).includes(n))];
 if(pairs.length)return[1,pairs[0],...ns.filter(n=>n!==pairs[0]).slice(0,3)];return[0,...ns.slice(0,5)];
}
let seed=79;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
for(let i=0;i<10000;i++){const pool=[...deck],hand=[];for(let j=0;j<7;j++)hand.push(pool.splice(Math.floor(random()*pool.length),1)[0]);const result=evaluateHand(hand);assert.deepEqual(result.rank,reference(hand));assert.deepEqual(evaluateHand(result.bestFive).rank,result.rank);assert.deepEqual(evaluateHand([...hand].reverse()).rank,result.rank);}
console.log('PASS: 10,000 seeded seven-card hands match independent rank evaluator, best-five evidence and reversed input order');
if(process.argv.includes('--exhaustive')){
 const totals=Array(9).fill(0),choose=(n,k)=>{let x=1;for(let i=1;i<=k;i++)x=x*(n-i+1)/i;return Math.round(x);};
 for(let a=0;a<48;a++)for(let b=a+1;b<49;b++)for(let c=b+1;c<50;c++)for(let d=c+1;d<51;d++)for(let e=d+1;e<52;e++)totals[evaluateHand([deck[a],deck[b],deck[c],deck[d],deck[e]]).rank[0]]++;
 const expected=[(choose(13,5)-10)*(4**5-4),13*choose(4,2)*choose(12,3)*4**3,choose(13,2)*choose(4,2)**2*11*4,13*choose(4,3)*choose(12,2)*4**2,10*(4**5-4),4*(choose(13,5)-10),13*choose(4,3)*12*choose(4,2),13*48,40];
 assert.deepEqual(totals,expected);console.log('PASS: all '+choose(52,5)+' five-card deals match independently derived category counts',totals);
}
