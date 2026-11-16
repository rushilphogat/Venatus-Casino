const PACES = { quick: .75, standard: 1, relaxed: 1.4 };

export function configurePresentation(game, options = {}) {
  game.pace = Object.hasOwn(PACES, options.pace) ? options.pace : 'standard';
  game.humanPlayers = Array.isArray(options.humanPlayers)
    ? [...new Set(options.humanPlayers.filter(id => game.players.includes(id)))] : [...game.players];
  game.manualResults = Boolean(options.manualResults ?? options.manualContinue);
}

export const paced = (game, milliseconds) => Math.round(milliseconds * (PACES[game.pace] || 1));

export function beginPresentation(game, kind, now, minimum = 8000, maximum = 20000) {
  const required = (game.humanPlayers || game.players).filter(id => game.players.includes(id));
  const manual = Boolean(game.manualResults && required.length === 1);
  game.presentationSequence = (game.presentationSequence || 0) + 1;
  const id = `${game.type}:${now}:${game.presentationSequence}:${kind}`;
  // Cinematic time and reading time are separate; Quick never shortens reading below these floors.
  const major = !['ohhell-trick','poker-uncontested'].includes(kind);
  const cinematicMs = kind==='poker-showdown'?7000:6000;
  const readingMs = kind==='poker-showdown'?18000:10000;
  const protectedMinimum = major ? cinematicMs + Math.max(readingMs,paced(game,minimum)) : paced(game,minimum);
  game.presentation = { id, kind, startedAt: now, minimumUntil: now + protectedMinimum,
    maximumUntil: now + (manual ? 86400000 : Math.max(protectedMinimum+8000,paced(game,maximum))), required, ready: [], manual };
  game.deadline = game.presentation.minimumUntil;
  return game.presentation;
}

// An early Ready records intent, but cannot shorten the minimum readable hold.
export function readyPresentation(game, id, now) {
  const p = game.presentation;
  if (!p || !p.required.includes(id)) throw new Error('Only a seated human can continue this result');
  if (!p.ready.includes(id)) p.ready.push(id);
  return presentationComplete(game, now);
}

export function presentationComplete(game, now) {
  const p = game.presentation;
  if (!p) return true;
  if (now < p.minimumUntil) return false;
  const everyoneReady = p.required.length > 0 && p.required.every(id => p.ready.includes(id));
  if (everyoneReady || (!p.manual && now >= p.maximumUntil)) return true;
  // A solo result waits for Continue. Re-arm rather than repeatedly ticking a past deadline.
  if (p.manual && now >= p.maximumUntil) p.maximumUntil = now + 86400000;
  game.deadline = p.maximumUntil;
  return false;
}

export const presentationView = game => game.presentation ? structuredClone(game.presentation) : null;
