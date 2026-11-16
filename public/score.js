import {melodies} from './melodies.js';
// Original eight-bar arrangements. Each melody slot is a sixteenth note; null leaves room for the table.
export const scores={
 poker:{title:'Felt & Neon',bpm:86,swing:.13,chords:[[50,57,60,64,69],[43,53,59,64,69],[48,55,59,62,67],[45,55,61,64,70],[46,53,57,60,65],[40,50,55,58,62],[45,55,61,64,70],[50,57,60,64,69]],melody:[[76,null,null,72,null,null,69,null,72,null,74,null,null,null,69,null],[71,null,null,null,74,null,76,null,79,null,null,76,null,74,null,null],[76,null,74,null,71,null,null,null,67,null,null,71,74,null,null,null],[73,null,null,70,null,67,null,null,64,null,null,null,null,null,null,null]],lead:'keys'},
 chromatic:{title:'Side Street',bpm:112,swing:.045,chords:[[41,48,56,60,67],[44,51,55,58,63],[46,53,56,60,65],[48,55,58,64,68],[41,48,56,60,67],[49,56,60,63,68],[46,53,56,60,65],[48,55,58,64,68]],melody:[[72,null,75,null,null,79,77,null,75,null,null,72,null,68,null,null],[75,null,null,79,82,null,79,null,null,75,null,72,70,null,null,null],[77,null,80,null,77,null,null,72,75,null,72,null,null,null,68,null],[76,null,null,79,null,76,72,null,70,null,null,null,72,null,null,null]],lead:'pluck'},
 bluff:{title:'Tell Me Again',bpm:78,swing:.1,chords:[[48,55,58,62,67],[44,51,55,58,63],[41,48,56,60,65],[43,53,59,62,68],[48,55,58,62,67],[50,56,60,65,68],[43,53,59,62,68],[48,55,58,62,67]],melody:[[79,null,null,null,74,null,null,70,null,null,67,null,null,null,null,null],[75,null,null,70,null,null,null,null,67,null,null,null,63,null,null,null],[77,null,null,null,null,72,null,null,68,null,null,65,null,null,null,null],[74,null,null,71,null,null,68,null,67,null,null,null,null,null,null,null]],lead:'vibes'},
 rummy:{title:'Paper Planes',bpm:94,swing:.07,chords:[[41,48,52,55,60],[50,57,60,64,69],[43,53,57,62,65],[48,55,58,62,69],[45,52,55,59,64],[50,57,60,64,69],[43,53,57,62,65],[48,55,58,62,69]],melody:[[76,null,77,null,79,null,null,76,72,null,null,69,null,null,null,null],[77,null,null,76,72,null,69,null,null,null,72,null,76,null,null,null],[74,null,77,null,null,81,null,null,79,null,77,null,74,null,null,null],[76,null,null,74,null,72,null,null,69,null,67,null,null,null,null,null]],lead:'keys'},
 ohhell:{title:'Forecast',bpm:90,swing:.12,chords:[[43,50,53,57,62],[48,55,58,62,67],[41,51,57,60,65],[46,53,57,60,65],[39,46,50,53,58],[45,51,55,60,63],[38,48,54,57,63],[43,50,53,57,62]],melody:[[74,null,null,77,null,81,null,null,79,null,77,null,74,null,null,null],[79,null,null,77,74,null,null,70,null,null,67,null,70,null,null,null],[77,null,81,null,null,84,null,null,81,null,77,null,75,null,null,null],[74,null,null,72,null,69,null,null,65,null,null,null,null,null,null,null]],lead:'vibes'}
};
for(const [id,data]of Object.entries(melodies)){scores[id].responseMelody=scores[id].melody;scores[id].melody=data.bars;scores[id].title=data.title;}
export function musicState(room){
 const g=room?.state;if(!g||room.status==='waiting')return{theme:room?.game||'poker',mode:'lounge',energy:.15};
 if(room.status==='paused')return{theme:room.game,mode:'lounge',energy:.08};
 if(g.phase==='finished'||g.phase==='round-end'||g.phase==='between-hands'||g.phase==='reveal')return{theme:room.game,mode:'release',energy:.3};
 if(g.phase==='runout'||g.phase==='challenge')return{theme:room.game,mode:'suspense',energy:.9};
 if(room.game==='poker'){const ratio=(g.pot||0)/Math.max(1,(g.bigBlind||4)*24);return{theme:'poker',mode:ratio>.6?'pressure':'play',energy:Math.min(.85,.25+ratio*.55)};}
 if(room.game==='chromatic'){const near=Object.values(g.counts||{}).some(n=>n===1),debt=g.pendingPenalty||0;return{theme:'chromatic',mode:near||debt>=4?'pressure':'play',energy:near?.9:debt?Math.min(.85,.35+debt*.05):.35};}
 return{theme:room.game,mode:'play',energy:.3};
}
