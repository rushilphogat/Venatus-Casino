# Experience implementation — updated 17 November 2026

## Delivered

- Responsive ink-blue/paper styling and illustrated portrait seats, scalable cards and interface preferences. Replaced the old fixed content/table caps; consolidated legacy CSS into a cascade layer.
- Buttons with press depth, focus and confirmation feedback; larger sliders with fill and readout; keyboard-capable choice menus; segmented seats/bots/pace; paired number steppers and poker bet presets.
- Win reveals have a twenty-second maximum; Bluff verdicts and Oh Hell trick/round reveals have a seven-second maximum. Continue is available immediately and a strict majority of seated humans advances play early. Bots are automatically ready but cannot outvote the humans. These caps include animation time and do not change with table pace; old solo manual holds are normalized. Full win animations run five seconds and mid-game animations 2.2 seconds, with sound cues following their beats. Finished-match overlays dismiss within twenty seconds without starting another match.
- Private poker hand description and scoped best-five highlighting that survives refresh. Reveals and replays show each player's exact best five with hole/board sources, kickers and per-player board highlights. Board-only ties are labelled. Durable recent poker/Bluff results and authorized action-by-action replay are isolated from live Continue voting. Each main/side pot is rendered separately, including uncalled returns.
- Twenty-four preset avatars, stable initial assignment, custom upload/crop and persistent thumbnails; guest identity preserved on account conversion.
- Table-member chat, quick comments, 12 reactions, local mute, host removal, rate limits and independent chat sequence numbers. Actual bot seats now react automatically to public events, with cooldowns and durable chat records. Replies appear over the table or inside the cinematic, as well as in chat.
- Fifteen scene motifs with staged card flips, winner focus, separate pot awards, full-screen presentation, skip and reduced-motion support. Result evidence excludes private opponent cards.
- Card corner symbols stay inside their faces, including small cards in replays and game tables. Reveal controls, player names and award panels wrap within narrow screens. Chat messages and input fields use explicit contrasting colours; bot popups wrap long messages and are suppressed while chat is open.
- Five jazz/electronic arrangements using the user's ChatGPT melody response, electric piano, plucked bass, vibraphone, pads, percussion and stereo reverb. Public events select lounge, play, pressure, suspense and release; reveal cues follow cinematic beats. Separate music/effects/master controls and quiet Discord mix remain available. Samples are synthesized locally and cached with bounded voices; no remote music service.
- Chromatic ends after a single round, including legacy round-end snapshots. Finished tables are excluded from the active lobby and display a result state instead of a disabled In progress button.
- Rummy declaration preview, grouping persistence and drawn-card cue; retained Oh Hell tricks and scoring; existing street Chromatic stacking unchanged.

## Verification

- All 129 regression tests passed, including exact poker evidence, replay cache isolation, private Rummy draw cues, majority voting, duplicate votes, bot readiness, legacy timing normalization, single-round Chromatic, finished-table filtering and public-event bot comments.
- The evaluator passed independent category-count verification over all 2,598,960 five-card hands and a separate direct-ranking comparison on 10,000 seeded seven-card hands. See BUG-AUDIT-2026-11-17.md for reproduced issues and fixes.
- All 44 PostgreSQL-compatible integration checks passed, including additive schema initialization, avatar/chat and bot-comment persistence, permissions and settlement.
- Browser playthroughs exercised all five games on desktop and phone; separate interaction checks cover keyboard/pointer slider input, synchronized steppers, disabled bot counts, custom avatar upload/reload, chat escaping/removal, preference persistence and reduced motion.
- Overflow checks at 3840, 3440, 3072, 2560, 1920, 1366, 768, 390 and 360 CSS-pixel widths. CSS viewport simulation is not a measurement of physical monitor DPI or every mobile browser.
- All 15 cinematic motifs exercised in a local fixture; each poker pot retained and private cards excluded. Local fixture captures are separate from live multiplayer tests.
- Additional six-seat layout checks across all five games at 360, 390, 768, 1440 and 3840 CSS pixels verify card bounds and page overflow. Long chat messages and popup suppression are covered; measured chat input and message contrast exceeds 12:1. Cinematic checks verify automatic twenty/seven-second dismissal and reduced motion.
- Six offline soundtrack renders checked for finite output, audible signal, headroom and bounded cache. A local browser check exercises real audio unlock, scheduling and reveal cues; frame timings describe that test machine only.

## Remaining quality work

- A literal two-hour mixed-human/bot soak with live resource monitoring has not been completed. The active-two-hour-table regression verifies removal of the previous one-hour cutoff; it is not a two-hour soak.
- Device-specific frame-rate, touch keyboard and screen-reader testing remain. No universal 60-fps claim.
- Current animations use DOM/CSS and the existing snapshot UI. Stable keyed updates can be expanded further; the application is not being described as a complete AA game engine rewrite.
- Creative scenes are working adaptations of selected concepts, not frame-for-frame implementations of every storyboard beat. Bot dialogue uses authored public-event rules; it is not an LLM conversation and never speaks as a human player. Additional animated portrait work remains optional polish.

## Release operations

Publish only application assets, source, tests and documentation to the existing GitHub main branch with an expected-head lease. Existing free Render service and Neon database remain in use. No secrets, local database, source atlas PNG or QA workspace are uploaded. Schema additions are backward compatible; previous application commit remains the rollback baseline.
