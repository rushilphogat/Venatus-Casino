// Only this explicit public projection reaches the dialogue selector. No hand contents, deck or RNG state.
const lines={
  round_start:['Cards out. Good luck, everyone.','One more round? I am in.','Alright, let’s play.'],
  public_all_in:['That is the whole stack.','All in? Now I’m watching.','Okay. Big moment.'],
  public_win:['Nice hand.','Well played.','That one is yours.'],
  split_pot:['A little for everyone.','We can share this one.','A diplomatic result.'],
  bluff_caught:['The cards tell a different story.','That story did not hold up.','The evidence has entered the room.'],
  honest_claim:['The claim checks out.','Truth, neatly folded.','The cards backed that up.'],
  draw_stack:['That stack is getting serious.','The draw pile has company.','One more layer to the pile.'],
  reverse:['Other way around, then.','The arrow changed its mind.','A very civilized U-turn.'],
  one_card:['One card left. Eyes on the table.','Down to one.','This is getting close.'],
  valid_declaration:['That all fits. Nicely done.','The declaration holds.','Everything in its proper place.'],
  exact_bid:['Right on the number.','That prediction landed.','Exactly as called.']
};
const hash=s=>[...String(s)].reduce((h,c)=>(h*31+c.charCodeAt(0))>>>0,0);
export function publicTalkState(room){
  const g=room.state;if(!g)return null;
  return {game:room.game,started:room.started,phase:g.phase,round:g.round||g.handNumber||1,moves:g.moves||0,
    result:g.lastResult?.id,reveal:g.reveal?.id,lied:g.reveal?.lied,penalty:g.pendingPenalty||0,
    top:g.discard?.at(-1)?.id,topValue:g.discard?.at(-1)?.value,direction:g.direction,
    counts:g.hands?Object.fromEntries(g.players.map(id=>[id,g.hands[id]?.length||0])):{},
    action:g.events?.at(-1)?.kind==='action'?g.events.at(-1):null,
    winner:g.roundWinner||g.winner,winners:g.lastResult?.pots?.filter(p=>!p.uncalled).flatMap(p=>p.winners)||[],
    split:g.lastResult?.pots?.some(p=>!p.uncalled&&p.winners.length>1),
    exact:g.type==='ohhell'&&g.phase==='round-end'?g.players.filter(id=>g.bids[id]===g.tricks[id]):[]};
}
export function chooseBotComment(room,now=Date.now()){
  const next=publicTalkState(room),bots=room.players.filter(p=>p.bot&&!p.left);
  if(!next||!bots.length||room.status==='canceled')return null;
  const memory=room.botTalk||{},prev=memory.snapshot;room.botTalk={...memory,snapshot:next};
  let trigger=null;
  if(next.game==='poker'&&next.result&&next.result!==prev?.result)trigger=next.split?'split_pot':'public_win';
  else if(next.game==='bluff'&&next.reveal&&next.reveal!==prev?.reveal)trigger=next.lied?'bluff_caught':'honest_claim';
  else if(next.phase==='finished'&&prev?.phase!=='finished')trigger=next.game==='rummy'?'valid_declaration':'public_win';
  else if(next.action?.action==='allin'&&next.action.id!==prev?.action?.id)trigger='public_all_in';
  else if(next.game==='chromatic'&&next.penalty>(prev?.penalty||0))trigger='draw_stack';
  else if(next.game==='chromatic'&&next.topValue==='reverse'&&next.top!==prev?.top&&prev)trigger='reverse';
  else if(next.game==='chromatic'&&Object.entries(next.counts).some(([id,n])=>n===1&&prev?.counts?.[id]!==1))trigger='one_card';
  else if(next.exact.length&&next.phase!==prev?.phase)trigger='exact_bid';
  else if(!prev||prev.started!==next.started||prev.round!==next.round)trigger='round_start';
  if(!trigger)return null;
  const major=['public_win','split_pot','bluff_caught','honest_claim','valid_declaration','public_all_in'].includes(trigger);
  if(memory.at&&now-memory.at<(major?1500:9000))return null;
  const seed=`${room.id}:${next.started}:${next.round}:${next.moves}:${trigger}`,speaker=bots[hash(seed)%bots.length];
  const pool=lines[trigger].filter(text=>text!==memory.text),text=pool[hash(seed+'line')%pool.length];
  room.botTalk.at=now;room.botTalk.text=text;
  return {at:now,userId:speaker.id,name:speaker.name,bot:true,type:'text',text,trigger};
}
