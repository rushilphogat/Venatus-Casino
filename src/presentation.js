const PACES = { quick: .75, standard: 1, relaxed: 1.4 };
export function configurePresentation(game, options = {}) {
  game.pace = Object.hasOwn(PACES, options.pace) ? options.pace : 'standard';
  game.humanPlayers = Array.isArray(options.humanPlayers)
    ? [...new Set(options.humanPlayers.filter(id => game.players.includes(id)))] : [...game.players];
  game.manualResults = false;
}
export const paced = (game, milliseconds) => Math.round(milliseconds * (PACES[game.pace] || 1));
export const revealLimit = kind => ['poker-showdown','poker-uncontested','match-win'].includes(kind) ? 20000 : 7000;
// Human votes determine the majority; bots are ready from the outset.
// Normalize persisted presentations too, including obsolete solo manual holds.
export function syncPresentation(game) {
  const p=game.presentation;if(!p)return null;
  p.required=[...new Set((game.humanPlayers||game.players).filter(id=>game.players.includes(id)))];
  p.bots=game.players.filter(id=>!p.required.includes(id));
  p.ready=[...new Set([...(p.ready||[]).filter(id=>game.players.includes(id)),...p.bots])];
  p.majority=Math.floor(p.required.length/2)+1;
  p.minimumUntil=p.startedAt;p.maximumUntil=p.startedAt+revealLimit(p.kind);p.manual=false;
  const ready=p.required.filter(id=>p.ready.includes(id)).length;
  game.deadline=!p.required.length||ready>=p.majority?p.startedAt:p.maximumUntil;
  return p;
}
export function beginPresentation(game, kind, now) {
  game.presentationSequence=(game.presentationSequence||0)+1;
  game.presentation={id:`${game.type}:${now}:${game.presentationSequence}:${kind}`,kind,startedAt:now,ready:[]};
  return syncPresentation(game);
}
export function readyPresentation(game, id, now) {
  const p=syncPresentation(game);
  if(!p||!p.required.includes(id))throw new Error('Only a seated human can continue this result');
  if(!p.ready.includes(id))p.ready.push(id);
  return presentationComplete(game,now);
}
export function presentationComplete(game, now) {
  const p=syncPresentation(game);
  return !p||!p.required.length||p.required.filter(id=>p.ready.includes(id)).length>=p.majority||now>=p.maximumUntil;
}
export const presentationView = game => game.presentation ? structuredClone(game.presentation) : null;
