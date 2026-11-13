# Gameplay and help references

Research note for implementing familiar card-game flows. References below document real games or established rules. Treat interaction patterns as design evidence, not as permission to copy branding, artwork, or exact UI.

## Poker (Texas Hold'em)

- [PokerStars Learn: Texas Hold'em rules](https://www.pokerstars.com/poker/learn/lesson/texas-holdem-rules/) — rules tutorial with table screenshots labeled pre-flop, flop, turn, and river. Actionable flow: receive two private hole cards; act in order using fold/call/raise (check when no bet is outstanding); reveal three-card flop, then turn and river with betting rounds; showdown compares best five-card hand. Screenshot captions demonstrate betting controls and board progression.
- [PokerStars: Poker rules, betting actions and showdown](https://www.pokerstars.com/poker/games/rules/) — concise definitions of check, bet, call, raise, fold and all-in, plus button/blind position and betting rounds. Useful for contextual action labels and legal-action controls.
- [PokerStars: Texas Hold'em game page](https://www.pokerstars.com/poker/games/texas-holdem/) — overview plus free-to-play entry point; describes community-card progression and showdown.

**Limits:** Poker has several variants and betting structures. These are Hold'em references; decide and label the intended limit structure (e.g. no-limit) and table stakes. The free-play product page is not a static UI specification.

## 13-card Indian Rummy

- [RummyCircle: Rummy rules](https://www.rummycircle.com/how-to-play-rummy/rummy-rules.html) — rules/help page for the 13-card Indian format. Flow: draw from open or closed deck, discard one, arrange all 13 cards into sequences/sets, and declare only with two sequences including one pure sequence. Useful vocabulary and declaration validation.
- [RummyCircle: How to Play Rummy (video)](https://www.youtube.com/watch?v=qEixIL5uI6w) — official branded step-by-step tutorial; explicitly demonstrates starting with 13 cards and finishing by discarding the unwanted card and declaring. The associated tutorial is useful for dealing, hand organization, and declaration moments.
- [RummyCircle app listing](https://play.google.com/store/apps/details?id=com.games24x7.rummycircle.rummy&hl=en&gl=IN) — product description documents the key online actions: 13-card deal, pick from open/closed deck, and declare before opponents.

**Limits:** Indian Rummy rules, joker handling, turn timing, and scoring can vary by operator and table type. RummyCircle is a commercial product; use the core draw/discard/valid declaration loop while selecting one explicit ruleset for the game.

## Oh Hell

- [OhHell.app interactive walkthrough and rules](https://ohhell.app/rules) — interactive sample hand covers bidding, card play, and scoring. Flow: bid expected tricks, lead a card, follow suit if able, otherwise discard or trump, winner leads next trick, then score exact bids. Its site also links to quick play and room creation.
- [Pagat: Oh Hell rules](https://www.pagat.com/exact/ohhell.html) — detailed rules reference: deal schedule, turned-up trump, clockwise bidding, follow-suit play, trick winner, and scoring examples.
- [Trickster Cards: Oh Hell Basics](https://www.trickstercards.com/home/help/oh-hell-basics.html) — online-game help page; confirms bidding and trick loop, and offers an actual playable implementation context.

**Limits:** Deal schedules (ascending/descending), restrictions on dealer bids, and scoring differ by house rules. The walkthrough's defaults should be identified as one variant. Pagat is a rules compendium, not a single official governing body.

## Bluff / Cheat

- [Bicycle Cards: I Doubt It](https://bicyclecards.com/how-to-play/i-doubt-it) — established rules with explicit interaction steps. Players place 1–4 cards face down and announce the required rank; any player may call “I doubt it”; reveal the latest play and the challenge loser takes the pile. The page also specifies rank progression and end condition.
- [Pagat: Cheat / I Doubt It](https://www.pagat.com/beating/cheat.html) — compares variants and explains challenge timing and penalty; useful for avoiding conflation between sequential-rank play and same-rank bluff variants.
- [SnackTurn: Bluff online game and illustrated guide](https://snackturn.com/games/bluff/) — playable browser implementation with a rules/hand guide, giving a concrete digital interaction reference for face-down claims and challenge outcomes.

**Limits:** “Bluff,” “Cheat,” “Bullshit,” and “I Doubt It” can refer to different rule variants. Agree whether only the next player or anyone may challenge, how ranks advance, how many cards can be claimed, and who takes the pile. The SnackTurn version is one implementation, not universal rules.

## UNO

- [Mattel: UNO mobile game rules/help](https://prod-letsplayuno.mattel163.com/support/rules.html) — official digital rules/help. Flow: match the discard by color/number/symbol or play a wild; resolve action cards; draw when unable; call UNO at one card; Wild Draw Four challenge is supported. Particularly useful as a digital interaction reference for challenge prompts and action resolution.
- [Mattel: UNO instruction sheet (PDF)](https://service.mattel.com/instruction_sheets/K5847-0720.pdf) — physical-game rules: match by color, number, or character; draw and optionally play the drawn match; say UNO at one remaining card and apply the missed-call penalty.
- [Mattel product page: UNO card game](https://m.service.mattel.com/us/Technical/productDetail?prodno=FFK04&siteid=27) — official product summary confirms matching and draw-pile loop and links to instruction sheet.

**Limits:** UNO releases add or alter cards and rules, and stacking is a common house rule but not in the cited classic instruction sheet. Specify the deck/version, whether a drawn matching card may be played immediately, and Wild Draw Four challenge behavior. The mobile rules page describes the mobile implementation and may differ from a physical edition.

## Implementation cues across games

- Show only the legal actions for the current phase, explain why an action is unavailable, and advance phases only after server-side validation.
- Make game state legible at a glance: current actor, round/phase, public cards or discard/trick pile, and turn result.
- Keep private hands private; expose only public actions and outcomes. Use a short, contextual help panel to explain phase-specific actions rather than presenting the full rules every turn.
- State the chosen variant and scoring at room setup or in an always-accessible rules panel, especially for Rummy, Oh Hell, Bluff, and UNO.

## Distinct digital implementations (cross-check)

These entries are separate products from the rules references above. “Text/UI evidence” means the linked page exposed that information in searchable page text or labeled image captions; I did not visually inspect a full-resolution screenshot or operate a logged-in game client during this research.

### Poker

- [Replay Poker help: betting and raising](https://replayhelp.casino.org/hc/en-us/articles/360001879294-Betting-and-raising) — **help text with screenshot caption**. Documents the actual controls: Fold, Check/Call, Raise To/All In; optional quick-bet presets, slider, and amount text box; user selects a size then confirms with Raise To/All In. Strong actionable control reference.
- [Poker Now](https://www.pokernow.com/) — **playable product entry page**. Offers starting a game or joining community games; its [Clubs page](https://www.pokernow.com/clubs-landing) describes private-room creation, access controls, multiple tables, custom settings, and live ledger. Useful lobby/room flow, but page text does not document the in-hand control UI.

### 13-card Indian Rummy

- [RummyEasy: How to Play Indian Rummy](https://rummyeasy.com/how-to-play) — **interactive product/help page text** with card examples and explicit deal/turn/declaration steps. The product is single-player Indian Points Rummy; documents draw from open/closed pile, discard, meld validation, wild joker, and drop. Useful for a distinct digital hand-organization and rules presentation reference.
- [RummyEasy app listing](https://play.google.com/store/apps/details?id=com.rummyeasy.app) — **product listing** for its single-player implementation; not a screenshot inspection.
- **Junglee Rummy:** search surfaced a video titled [“How to play Junglee Rummy”](https://www.youtube.com/watch?v=IgLg1vVxIIM), but the page result did not establish an official publisher/channel or provide a verifiable UI walkthrough. Treat this as unverified, not as an inspected official reference.
- **RummyCulture:** no verifiable official gameplay/help page or current implementation was located in this pass. Do not infer current availability from similarly named third-party domains.

### Oh Hell

- [CardGames.io Oh Hell](https://cardgames.io/ohhell/) — **playable browser game; UI text exposed by page**. Visible controls include Deal, bid input, trump suit, cumulative score table, game speed, and multiplayer lobby/private table flow. The linked [CardGames.io tutorial video](https://www.youtube.com/watch?v=ABYyqZ5JoFY) is by CardGames.io and identifies its implementation as following a common variant.
- [PlayOK Oh Hell](https://www.playok.com/en/ohhell/) — **playable multiplayer product page**. Documents live opponents, game rooms, rankings, statistics, records, mobile support, and linked game rules; useful for lobby/competition patterns, not a verified in-hand screenshot.

### Bluff / Cheat

- [Wobblox Cheat](https://wobblox.com/games/cheat) — **playable browser game; UI text exposed by page**. Shows hand counts, pile, required rank, a “Call Cheat” affordance, and difficulty levels against AI. This directly supports a simple single-player turn/challenge interaction.
- [kawu Cheat](https://kawu.com/cheat) — **playable product description** says solo AI and friend-room multiplayer are supported; the page did not expose enough concrete interface detail to treat it as a screenshot reference.
- [SnackTurn Bluff](https://snackturn.com/games/bluff/) — **playable browser product with illustrated guide link**; documents 3–6 seats and face-down bluff/challenge loop. This is a distinct implementation from Wobblox/kawu; variant specifics may differ.

### UNO

- [Mattel163 UNO mobile-game rules](https://prod-letsplayuno.mattel163.com/support/rules.html) — **official digital-game help text**. Covers match/play, action resolution, UNO call, and Wild Draw Four challenge; useful as the interaction source for challenge prompts.
- [Ubisoft UNO](https://www.ubisoft.com/en-us/games/uno) — **official product description**. Documents solo/friends play, rule and cosmetic customization, and rotating events. Ubisoft's [Xbox manual](https://dlassets-ssl.xboxlive.com/public/content/36bf346f-23ff-4df8-850e-94530fb1b71b/GameManual/4747b7fc-d7c7-4568-bbf9-c16f14e088af/en-AU/index.html) distinguishes Classic matches from customizable house-rule matches and describes local/online modes. These pages support setup/mode flows, but no table screenshot was visually inspected.
- The cited Mattel paper instruction sheet remains the third reference for the physical version; it is rules documentation, not a digital implementation.

### Evidence boundary

The page text and captions above were inspected through web search/open results. No logged-in client was entered, no live round was played, and no screenshot was visually inspected. Links to playable games are provided for follow-up visual review; descriptions here avoid claiming direct observation beyond what the pages actually expose.
