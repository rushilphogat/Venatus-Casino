// Hand order is presentation only: all moves still use server-issued card IDs.
let handLayout = { room: null, ids: [] };
let arranging=false, marked=new Set(), groups=[];
const rankValue = c => ({A:1,J:11,Q:12,K:13}[c.rank] || Number(c.rank) || 99);
export function orderedHand(room, hand = room.state.hand) {
  if (handLayout.room !== room.id) {handLayout = {room:room.id, ids:[]};arranging=false;marked=new Set();groups=[];}
  const byId = new Map(hand.map(c => [c.id,c]));
  handLayout.ids = [...handLayout.ids.filter(id => byId.has(id)), ...hand.filter(c => !handLayout.ids.includes(c.id)).map(c=>c.id)];
  return handLayout.ids.map(id=>byId.get(id));
}
export function handTools(room) {
  if(room.state) orderedHand(room);
  if (!['rummy','ohhell','bluff'].includes(room.game)) return '';
  return `<div class="hand-tools" aria-label="Arrange your hand"><span>${arranging?'Arrange mode · select cards to group':'Arrange hand'}</span><button data-action="hand-sort" data-sort="suit">By suit</button><button data-action="hand-sort" data-sort="rank">By rank</button><button data-action="hand-arrange" aria-pressed="${arranging}">${arranging?'Done arranging':'Arrange / group'}</button>${arranging?`<button data-action="hand-group" ${marked.size<2?'disabled':''}>Group ${marked.size||''} cards</button>`:''}<button data-action="hand-move" data-direction="-1" aria-label="Move selected card left">← Move</button><button data-action="hand-move" data-direction="1" aria-label="Move selected card right">Move →</button></div>`;
}
export function renderHand(room,card,esc,selectable,disabled=()=>false) {
  const cards=orderedHand(room); let prior=-1;
  return cards.map(c=>{const group=groups.findIndex(ids=>ids.includes(c.id)),start=group>=0&&group!==prior;prior=group;
    return `<span class="hand-card ${start?'group-start':''} ${marked.has(c.id)&&arranging?'arrange-marked':''}" draggable="true" data-hand-id="${esc(c.id)}" ${arranging?`role="button" tabindex="0" data-action="hand-mark" data-id="${esc(c.id)}" aria-pressed="${marked.has(c.id)}" aria-label="Select ${esc(c.rank+' '+c.suit)} for arrangement"`:''}>${card(c,!arranging&&selectable,disabled(c))}</span>`;
  }).join('');
}
export function handleExperienceAction(button, room, selected, render) {
  if (!room?.state) return false;
  if (button.dataset.action === 'bet-preset') {
    const input = document.querySelector('#bet-amount');
    if (input) { input.value = Math.max(Number(input.min),Math.min(Number(input.max),Number(button.dataset.amount))); input.dispatchEvent(new Event('input',{bubbles:true})); input.focus(); }
    return true;
  }
  if (!['hand-sort','hand-move','hand-arrange','hand-mark','hand-group'].includes(button.dataset.action)) return false;
  const cards = orderedHand(room);
  if(button.dataset.action==='hand-arrange') {arranging=!arranging;marked.clear();selected.clear();}
  else if(button.dataset.action==='hand-mark') {const id=button.dataset.id;if(cards.some(c=>c.id===id)){if(marked.has(id))marked.delete(id);else marked.add(id);}}
  else if(button.dataset.action==='hand-group') {const ids=cards.filter(c=>marked.has(c.id)).map(c=>c.id);if(ids.length>1){groups=groups.map(g=>g.filter(id=>!marked.has(id))).filter(g=>g.length);groups.push(ids);handLayout.ids=[...cards.filter(c=>!marked.has(c.id)).map(c=>c.id),...ids];marked.clear();}}
  else if (button.dataset.action === 'hand-sort') {
    const suit = c=>String(c.suit||c.color||'');
    cards.sort((a,b)=>button.dataset.sort==='rank'?rankValue(a)-rankValue(b)||suit(a).localeCompare(suit(b)):suit(a).localeCompare(suit(b))||rankValue(a)-rankValue(b));
    handLayout.ids=cards.map(c=>c.id);
  } else {
    const id=[...(arranging?marked:selected)][0], from=handLayout.ids.indexOf(id), to=from+Number(button.dataset.direction);
    if(from>=0&&to>=0&&to<cards.length) [handLayout.ids[from],handLayout.ids[to]]=[handLayout.ids[to],handLayout.ids[from]];
  }
  render(); return true;
}
export function installHandDrag(getRoom, render) {
  let dragged=null;
  document.addEventListener('dragstart',event=>{
    const card=event.target.closest('.hand [data-hand-id]');
    dragged=card?.dataset.handId||null;
    if(dragged) {event.dataTransfer.setData('text/plain',dragged);event.dataTransfer.effectAllowed='move';}
  });
  document.addEventListener('dragover',event=>{if(dragged&&event.target.closest('.hand [data-hand-id]'))event.preventDefault();});
  document.addEventListener('drop',event=>{
    const target=event.target.closest('.hand [data-hand-id]'), room=getRoom();
    if(!dragged||!target||!room)return;
    event.preventDefault(); orderedHand(room);
    const from=handLayout.ids.indexOf(dragged), to=handLayout.ids.indexOf(target.dataset.handId);
    if(from>=0&&to>=0) {handLayout.ids.splice(from,1);handLayout.ids.splice(to,0,dragged);render();}
    dragged=null;
  });
  document.addEventListener('dragend',()=>{dragged=null;});
  document.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)&&event.target.matches('[data-action="hand-mark"]')){event.preventDefault();event.target.click();}});
}
