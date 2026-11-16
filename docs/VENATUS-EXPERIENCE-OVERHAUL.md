# Venatus experience overhaul — approved scope

Prepared 15 November 2026. Approved by the user, including the additional tactile controls overhaul. Implementation and verification are underway. See EXPERIENCE-RELEASE.md for delivered features and remaining validation; the scope below is not a claim that every release gate has passed.

## Direction

Build an expressive, illustrated multiplayer card lounge: substantial cards, memorable characters, tactile motion, situation-aware music, and readable dramatic moments. Preserve the Venatus logo and existing house rules. Use original art and audio with an indie arcade feel. Prioritize readability and social play throughout a two-hour Discord session.

Suggested art direction: **Venatus After Hours**. Ink-blue backgrounds, warm paper cards, vermilion, mint and electric violet accents; hand-inked animal and creature portraits; subtle print texture; bold compact headings and clear interface text. Table lighting and color change by game and public events. Pixel accents can appear in effects, but small text and suit markings remain crisp. The title is an internal art-direction name, not a new marketing tagline.

## Confirmed problems in the current code

- `public/interface.css` caps `.layout` at 1180 CSS pixels. Fixed small typography and a wide top bar compound the miniature central-column effect in the supplied 4K screenshots.
- `src/poker.js` sets a 15-second between-hands window, but accepts `next-hand` immediately from any seated player. `src/bots.js` chooses that action between hands. `src/server.js` lets a bot act after about 1400ms, subject to the server tick, which bypasses meaningful result-reading time.
- Bluff challenges immediately return to play. A following play or skip clears `reveal`. There is no protected verdict phase. Both bots and humans can make results disappear too early.
- Poker can run an all-in board through several streets inside one operation. A snapshot alone is insufficient to stage each reveal properly.
- Poker's evaluator returns a category and rank vector, but the private view has no current hand description or best-five card IDs. Showdown labeling is separate from live hand feedback.
- Avatars currently use initials. Sound consists of short synthesized effects. There is no complete profile-image, adaptive-music or table-chat system.
- Full-room HTML replacement and several CSS layers make animation continuity, focus and scaling fragile. Refactor these areas incrementally.
- The server currently cancels matches after one hour. Longer result windows increase the chance of hitting this policy; audit it and replace blanket cancellation for active sessions with safe, game-specific session limits.

These findings come from a local code audit. Competitive research below uses official product pages, help documentation and publisher materials, not a claim that every reference was personally played or performance-tested.

## Reference study and chosen adaptations

| Reference | Evidence and design lesson | Venatus application |
|---|---|---|
| [Balatro](https://store.steampowered.com/app/2379780/Balatro/) | Publisher describes hand-crafted pixel art, CRT treatment, synthwave music and escalating combinations. | Cohesive audiovisual identity, tactile card motion, rising musical energy and layered payoff effects. Create original assets; keep reading surfaces sharp. |
| [PokerStars hand strength](https://www.pokerstars.com/help/articles/hand-strength-rm-pm/) and [replayer](https://www.pokerstars.com/help/articles/replay-feature/11030/) | Current-hand feedback near betting controls and a dedicated previous-hand replay. | Always-visible private hand label, best-five highlighting, explicit pot recipients, reopenable results and replay. |
| [UNO Mobile](https://www.letsplayuno.com/) and [its rules](https://www.letsplayuno.com/m/support/rules.html) | A colorful social presentation and explicit special-card mechanics, including stacking variants. | Distinct action-card effects, clear direction and draw-debt feedback, visible one-card moments. Retain Venatus's exact approved stacking behavior rather than importing other house rules. |
| [RummyCircle](https://www.rummycircle.com/how-to-play-rummy/rummy-rules.html) | Clear distinction between draw piles, sets, pure sequences and declaration requirements. | Spatial grouping, visible joker, readable meld validity and a declaration preview. Adapt explanations to our implemented rules. |
| [Liar's Bar](https://store.steampowered.com/app/3097560/Liars_Bar/) | Character-led multiplayer bluffing around claims, challenges and consequences. | Claim/challenger focus, suspense, expressive portraits and theatrical verdicts. This is an adjacent bluffing reference, not an identical ruleset. |
| [CardGames.io Oh Hell](https://cardgames.io/ohhell/) | Visible trump, bidding, score table, speed controls, private tables and rematches. | Persistent bid-versus-tricks score, last-trick review, adjustable pace and easy rematch. |
| [Hearthstone](https://news.blizzard.com/en-us/article/24290432/36-2-patch-notes) | Official cosmetics include animated entrances, expressive emotes and unique gameplay animations. | A small coordinated set of avatar reactions, entrances and outcome animations. |

The adaptation column is the proposed design judgment. Reference rules, copyrighted characters, soundtracks and commercial progression systems are not part of the implementation.

## 1. Responsive game shell

- Replace the narrow document layout with a viewport-aware game stage. Use the available width and height, with limits derived from readable cards and comfortable reach, not a single fixed desktop width.
- Desktop composition: compact top strip; players arranged around the table; central board/pile; your hand and action dock anchored below; collapsible chat/results rail to the right. Important actions remain in the visible viewport at standard desktop scale.
- Large screens: enlarge cards, seat portraits, type, chip values and controls together. Target approximately 85–94% usable viewport width for the whole shell. Keep form fields and long text at readable line lengths.
- Prototype 4K sizes around 180–230 CSS-pixel-tall hand cards and 22–28px primary interface text at a 3840×2160 CSS viewport. These are starting targets for visual QA, not a universal size multiplier. Long hands fan or scroll with every rank exposed.
- Browser/OS scaling changes the CSS viewport. Validate native 4K, 125%, 150% and 200% effective scaling, plus 1440p, 1080p, ultrawide, laptop, tablet and phones. Do not infer physical monitor size from resolution.
- Offer Auto / Compact / Comfortable / Large interface size, a separate card-size adjustment, and fullscreen. Remember the choice per device. Browser zoom remains supported.
- Mobile: shallow opponent arc, large active pile, thumb-reachable actions, expandable hand groups and bottom-sheet chat. Phone keyboard opening must not obscure the composer or accidental game controls.
- Lobby: five distinctive illustrated game selectors and one useful table browser. Empty states lead directly to Play with bots or Invite friends. Keep guest entry optional and retain owner/event controls.

## 2. Shared pacing and protected reveals

Introduce server-owned presentation phases, event IDs and timestamps. Resolve chips/rules transactionally, then present the committed result. The next actionable turn begins after the protected phase. Bots, human clicks and reconnects must obey the same gates.

Proposed default timings, to tune through playtesting:

| Moment | Default |
|---|---|
| Routine card movement | 180–350ms |
| Bot decision | 1.8–3.2s, independent of hidden information |
| Bluff challenge opportunity | 10s |
| Bluff verdict | About 2s suspense/reveal, then at least 6s readable result |
| Poker ordinary showdown | About 3s staged reveal, then at least 8s readable result |
| Poker all-in runout / side pots | Separately staged streets; extra time for multiple pots, bounded total presentation |
| Oh Hell trick result | 1.2–1.8s before collection |
| Round/session result | 8–12s shared reading time; summary remains available |

- For solo-with-bots tables, default to manual Continue after significant outcomes. Offer automatic continuation in settings. Inactivity handling is separate from presentation timing.
- For multiplayer, everyone sees the same result phase. After the minimum reading time, all connected seated humans can mark Ready; otherwise continue at a bounded maximum, initially 20s for ordinary results and 30s for complex side pots. Bots do not shorten this window. Departures/disconnections cannot deadlock it.
- Host chooses Relaxed / Standard / Quick before play; defaults favor Standard. Publish exact effective timings in room settings. A player can reduce their visual effects without changing shared turn clocks.
- Separate local Skip animation from Next hand. Skip jumps to the readable outcome and cannot advance the game alone.
- Persist a Last result panel and a bounded session timeline. Replays show only information that viewer was entitled to see. Folded poker hands and unrevealed Bluff cards remain private.
- Reload/reconnect into the current phase at its correct elapsed position. Skip stale decorative sequences, retain summaries and never replay chip settlement.

## 3. Poker

- Display “Your hand: Two pair — aces and tens” next to your hole cards. At preflop describe the two-card holding, such as “Pocket queens” or “Ace high”; do not imply a five-card evaluation exists yet.
- From the flop onward, evaluate only your hole cards plus the visible board. Return best-five card IDs and tie-break information through the private view. Highlight those five cards on hover/tap, including when the board itself supplies the hand. No opponent-card inference or win-probability claim.
- Show clear check/call amounts, total raise, minimum raise, own committed bet and stack. Preserve half-pot/pot sizing fixes and keyboard focus. Add a deliberate confirmation for a full-stack commitment when configured.
- Arrange players around the table with dealer/blind markers and visible bet movement. Keep your cards persistent through results.
- Stage all-ins through flop, turn and river with a short anticipation beat. Reveal eligible hands, highlight the winning five, identify the deciding kicker where relevant, award the main pot and each side pot visibly, and distinguish uncalled returns from wins.
- Handle ties and multiple pot winners without a misleading single-winner banner. Uncontested pots never turn over folded cards.
- Add previous-hand results and a step-through authorized replay; replay is informational and never blocks live turn controls.

## 4. Bluff

- Keep the declared rank prominent, a claim such as “Mira claims 3 × Queens”, the pile count, and a visible challenge timer.
- Separate claim composition from submission: select cards, see count, choose rank only when the rules permit, then throw the cards. Keep Skip explicit.
- Use a protected challenge scene: claimant and challenger portrait focus → card spread → Caught / Honest verdict → pile transfers to the correct player → clear indication that the rank can reset.
- Retain the approved street rules: rank persists until everyone skips or a challenge resolves. Effects must describe the actual result, including a truthful final play winning the game.
- After the scene, leave a compact summary available with the claim, revealed cards, challenger, collector and transferred count. Bot pacing uses exactly the same presentation protection as PvP.

## 5. Chromatic, Rummy and Oh Hell

**Chromatic:** preserve +2 on +2 and +4 on either +2 or +4, along with all other currently implemented street rules. Put accumulated draw debt at the center; indicate valid responses before selection. Animate reverse direction around seats, skip across the affected player, and stack increments as one readable counter. Add a clear one-card call and distinct last-card finish. Color is reinforced with symbols. No silent jump-in, 7–0, forced-play or challenge-rule changes.

**Rummy:** drag cards into visible groups with touch and keyboard alternatives; mark pure sequence, sequence, set and unfinished group privately; preserve groups through draw/reconnect; keep wild joker visible; make the drawn card easy to locate. Provide Analyze, declaration preview, penalty explanation and ordered round results. Avoid a large cinematic on every draw or ordinary meld rearrangement.

**Oh Hell:** show trump, bid, tricks taken and tricks remaining throughout the round. Keep legal follow-suit cards obvious. Animate tricks toward their winner, retain the previous trick, and show why the current trick was won. Present round scoring as bid versus actual with an explainable score change. Retain the existing bidding and scoring rules.

## 6. Avatars and personality

- Initial collection: 24 original cohesive illustrated avatars, including cats, foxes, frogs, owls, capybaras, small robots and friendly spirits. Produce one consistent art sheet before building all assets.
- Assign a random preset once when a profile/guest is created, then persist it. Existing profiles receive a stable assignment. Never reroll on render or reconnect. Avoid duplicate bot portraits within a table where possible.
- Profile picker supports presets, randomize, custom image upload, crop, preview, save and removal. Guests get the same immediate customization and retain it when saving their account.
- Proposed upload pipeline: accept JPEG/PNG/WebP, validate actual decoded contents and dimensions, cap input size, strip metadata and re-encode to a small 256×256 thumbnail with a strict byte cap. Serve through a dedicated route; no raw HTML/SVG uploads or remote tracking-image URLs.
- Store one capped thumbnail per profile in persistent PostgreSQL initially, outside room snapshots. Use versioned URLs and cache headers. Measure storage growth; do not rely on Render's local filesystem for uploads.
- Preset portraits receive a few subtle reactions. Uploaded photos use expressive frames/emote stickers without altering the user's face. Bots remain clearly labeled and never impersonate humans.

## 7. Table chat, comments and emotes

- Add a real table chat channel with unread counts, readable timestamps and short messages. Chat is a collapsible rail on desktop and a drawer on phones.
- Provide quick comments (“Nice hand”, “No way”, “Well played”, “One more?”) and an initial 12 illustrated emotes. Bubbles originate at the speaker's seat and expire; a persistent transcript remains accessible.
- Reactions can attach to a recent public outcome. Bots may use occasional rule-based comments derived only from public events; no LLM calls or hidden-card commentary.
- Escape content, enforce table membership, cap message length, rate-limit and include mute/block controls and host moderation. Separate chat sequence numbers from game action versions, so a message cannot invalidate a card play.
- No built-in voice dependency; Discord remains useful for voice. Avoid persistent spectators commenting into an active competitive hand unless explicitly supported later.

## 8. Animation and cinematics

Build a reusable event-driven animation director with small/medium/major intensity. Shared server events choose a deterministic variation ID, so participants see the same narrative without sharing private data.

- Small: tactile lift, card spring, hover tilt, deal arc, chip click, suit highlight.
- Medium: reverse sweep, draw-stack escalation, trick collection, portrait response, pot movement.
- Major: showdown, exposed bluff, round victory, comeback and rare hand.
- Create three variations per major outcome family at first. Example poker variations: spotlight/five-card fan, chip cascade, graphic victory stamp. Bluff: comic freeze-frame, detective spotlight, paper-tear verdict. Chromatic: color burst, domino finish, stage-light sweep.
- Maintain a recent-variation history to avoid immediate repeats. Weight selection by public outcome and intensity. Never celebrate losses or uncalled bet returns as wins.
- Use brief 2D/2.5D push-ins, card close-ups, layered portraits, light and particles for cinematic moments. Reserve longer sequences for major outcomes; routine play stays responsive.
- Cinematic duration and readable hold are separate. Controls reappear with the result, and the player knows when the next turn starts.
- Effects levels: Full / Subtle / Off, plus reduced-motion support, independent screen-shake toggle and no rapid flashes. All outcomes remain understandable without sound or motion.

## 9. Sound and adaptive music

- Create or license cohesive audio with a documented asset manifest. Do not copy reference-game soundtracks or add paid services without approval.
- Initial scope: four musical themes with compatible calm/tension/payoff layers, plus short victory, loss, reveal and transition stingers. Use original musical stems or properly licensed recordings; avoid presenting generic alert tones as finished sound design.
- Crossfade layers on public events: lobby, ordinary play, growing pot, all-in, Bluff challenge, Chromatic one-card moment and match finish. Hidden hand strength must never alter public music or effects.
- Add several variants for card slides, chips, draw piles, buttons and reveals, with bounded pitch/volume variation and no harsh repetitive alert loop.
- Separate Music / Effects / Master controls. Start audio after a user gesture, remember preferences, fade when backgrounded, and offer a quiet Discord mix. Do not claim automatic Discord speech ducking without microphone integration.
- Lazy-load audio after entering a game. Keep card controls usable if audio fails to load. Track compressed asset size and simultaneous voices.

## 10. Implementation structure

- Preserve the Node/ws, transactional storage and server-authoritative game engines. Add explicit presentation state and durable bounded public outcome records; private replay data remains separately authorized.
- Introduce stable keyed table components so updates preserve cards, focus, selection, scroll and animations. Consolidate overlapping CSS into tokens, shell, components and per-game scenes as each area migrates.
- Use DOM/SVG/Web Animations for readable, accessible cards and controls. Add a canvas overlay only for particles and heavier visual effects if profiling justifies it. No full engine rewrite is required to begin.
- Model the flow as action → atomic rules/settlement → authorized event → protected presentation → next decision. A frontend animation completion callback is never the authority for settlement or turn advancement.
- Add bounded event sequence catch-up to the current refresh/snapshot protocol so short-lived outcomes cannot be skipped by a slow fetch. Deduplicate by event ID, and keep latest-state recovery authoritative.
- Extend SQLite and PostgreSQL schemas with versioned migrations for profiles, settings and bounded chat/outcome history. Avatar routes use dedicated upload limits; do not increase every API request limit globally.
- Validate resource usage on existing hosting. No new always-on paid infrastructure, live AI chatter, or continuous DB writes for animation frames.

## Execution order after approval

1. **Visual foundation and vertical slice.** Build the responsive shell, one approved-style portrait/card set, and a complete poker/Bluff outcome sequence locally. Include 4K and mobile captures, initial audio and exact pacing behavior. This establishes the quality bar before multiplying assets.
2. **Timing and poker.** Protected server phases, safe bot progression, current-hand evaluation, side-pot presentation, runout staging and replay. Add focused regression tests.
3. **Bluff and shared table experience.** Protected verdicts, claim composer, avatars, profile uploads, chat and shared social controls.
4. **Remaining games.** Chromatic effects/debt clarity, Rummy grouping/declaration, Oh Hell bids/trick/scoring. Preserve house rules and privacy.
5. **Complete audiovisual library.** Finish portrait collection, animation variants and adaptive music. Add low-motion and low-performance alternatives.
6. **Hardening and release.** Full functional, privacy, persistence, accessibility, responsive and two-hour mixed-human/bot testing. Publish only completed, validated portions with rollback available.

Steps are implementation milestones, not calendar promises. Reuse the existing tests and working infrastructure. Delegate only bounded independent work when it reduces cost, keep overlapping files with one owner, and avoid repeated broad audits.

## Acceptance and release gates

- At native 3840×2160 and effective scaled viewports the game fills a deliberate stage, with readable cards, avatars and controls. Verify 3440×1440, 2560×1440, 1920×1080, 1366×768, tablet and 390×844/360px phone layouts. No clipped actions, unintended page-wide horizontal overflow, or modal/keyboard overlap.
- Poker and Bluff results remain readable for the configured minimum even when bots or human clients immediately request another action. Test concurrent Ready requests, host departure, timeout, disconnect, server recovery and reduced-motion mode.
- Private poker hand descriptions pass all categories, wheel straights, board-only hands and kicker ties. Best-five highlighting matches evaluator output. No hidden cards appear in socket messages, music triggers, effects, replays or logs.
- Side-pot and repeated-event tests prove settlement is applied once. Bluff truth/lie/final-card/skip outcomes and all existing street stacking rules remain correct.
- Avatar uploads reject malformed, oversized and unsupported files; thumbnails survive redeploy; guest conversion preserves identity and avatar. Chat cannot inject markup or desynchronize game actions.
- Target smooth 60fps standard desktop animation and a responsive reduced-effects path on lower-powered phones. Measure actual frame time and input delay during effects; revise targets based on test devices rather than claiming universal performance.
- Keyboard and touch can reach every action. Color is not the sole game signal. Focus, selection and hand order survive updates. Motion and audio preferences persist.
- Run the current automated suite and PostgreSQL integration suite plus new regression tests. Exercise all five games with several browser clients, simulate latency/reconnection, and run a two-hour mixed-player soak session with resource monitoring.
- Record captures/video of 4K poker showdown, Bluff verdict, Chromatic stack chain and mobile play. Report exactly what was tested; do not describe an unplayed or partially completed feature as finished.

## Approval recorded

The user approved this scope with **Venatus After Hours** as the art direction and added responsive buttons, substantial sliders, segmented choices and improved number controls. The user also requested meaningful credit savings through optional regular-ChatGPT creative handoffs. Two returned responses were curated into CREATIVE-SELECTION.json; executable event handling remains locally implemented and tested.
