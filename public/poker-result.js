// Render only cards present in the server-authorized showdown and its own board.
export function handBreakdown(result,board=[]){
 const hole=result.hand||[],available=new Map([...board,...hole].map(c=>[c.id,c]));
 const ids=result.cardIds||[],cards=ids.map(id=>available.get(id)).filter(Boolean);
 if(cards.length!==5||new Set(ids).size!==5)return null;
 const holeIds=new Set(hole.map(c=>c.id)),used=cards.filter(c=>holeIds.has(c.id)).length;
 return{cards:cards.map(c=>({card:c,source:holeIds.has(c.id)?'Hole':'Board'})),used,
   summary:used===0?'Plays the board':`${used} hole ${used===1?'card':'cards'} + ${5-used} board cards`};
}
export function madeHand(result,board,card,esc){
 const made=handBreakdown(result,board);if(!made)return '';
 return `<section class="poker-made" aria-label="Best five cards"><div class="poker-made-label"><strong>Best five</strong><span>${esc(made.summary)}</span></div><div class="poker-made-cards">${made.cards.map(({card:c,source})=>`<div class="made-card ${source==='Hole'?'from-hole':'from-board'}" data-made-id="${esc(c.id)}"><div>${card(c)}</div><small>${source}</small></div>`).join('')}</div></section>`;
}
