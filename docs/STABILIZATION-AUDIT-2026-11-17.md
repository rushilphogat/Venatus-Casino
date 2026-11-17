# Stabilization audit — 17 November 2026

## Architecture and risk map

- Node HTTP/WebSocket server owns authorization, room versions, scheduled moves, settlements and bot decisions. Clients receive private game views and refresh snapshots after WebSocket notifications.
- Five isolated game engines use copy-on-action state. SQLite serializes mutations locally; PostgreSQL uses transactions plus an advisory lock. Room state and chip ledger changes share transactions.
- Browser screens use full DOM renders. Shared controls, chat/results, cinematics and audio maintain independent state. CSS combines a legacy layer with current unlayered overrides.
- Highest-risk boundaries: concurrent actions and stale snapshots; pause/restart/deadline transitions; asynchronous panels after navigation; form drafts during redraws; shared card geometry and large text; complete game/settlement transitions.

## Coverage plan and baseline

- Baseline: 133 regression tests pass; all five games pass real multiplayer browser journeys, guest invite/account recovery and six-seat checks. Shared controls/avatar/chat/preferences pass.
- Expand screen coverage: entry/login/setup, lobby/events/activity/admin, creation/waiting, rules/profile/settings/chat/results, all five games' action and result phases. Desktop, tablet and mobile; supplementary 4K and large-card settings.
- Expand multiplayer checks: concurrent/duplicate/stale actions, disconnect/reconnect, room exits, pauses, failed requests and PostgreSQL persistence.
- Fix reproduced defects in focused batches, then rerun the expanded matrix and previously passing suites. Record limitations explicitly.

## Bug checklist

All confirmed issues below are fixed and locally verified. P2 denotes a visible or functional defect that disrupts a supported flow without corrupting balances or exposing private cards.

| ID | Severity | Reproduction | Root cause / fix | Verification |
|---|---|---|---|---|
| A01 | P2 | Use accepted long unbroken event/table names; open Events, Control room or a table at 390px. Controls and content extend beyond the screen. | Flex items retain intrinsic minimum width; titles cannot wrap. Allow those items to shrink and wrap; wrap admin action rows. | Long-name fixtures across entry, admin, lobby and all five games; no document overflow. |
| A02 | P2 | Start a six-player Poker table at 768px; community cards are covered by side seats. Desktop top seat can cover street labels. | Radial seating remains enabled where the available width is insufficient. Use existing grid seating through 1199px and remove the board's upward translation. | Six-player street/runout states at phone, tablet and desktop. |
| A03 | P2 | Complete a six-player Oh Hell trick, especially with long names; trick cards extend into seats. | Name width expands each trick item and the entire center. Bound trick width, truncate labels and preserve card aspect ratio. | Full trick at 390/768/1440/3840px, including explicit card-proportion assertions. |
| A04 | P2 | Set card size to 135% on a 1440px Poker or Rummy table. Center cards/labels overlap top or bottom seats. | Felt height did not account for the card-size preference. Give desktop tables a minimum height derived from card height and seat clearance. | Enlarged-card screenshot matrix including 4K, desktop, tablet and landscape/portrait phones. |
| A05 | P2 | Win Bluff with an unchallenged last card, then open Last result. It throws an error or displays an older challenge's evidence. | Result renderer assumes every win has a reveal and falls back to unrelated lastReveal. Render the public final claim when no active reveal exists. | Automated regression with and without stale previous evidence; real browser result drawer after engine-generated win. |
| A06 | P2 | Rotate/resize during a card flight; an old-position animation extends outside the new viewport. | Flying overlays retain absolute coordinates from the previous viewport. Remove ephemeral flight overlays on resize. | Repeated viewport changes during Bluff transitions; no horizontal overflow. |
| A07 | P2 | Open chat or Last result, then navigate to Events. The drawer remains on the new screen until a polling interval. | Room-independent panels were cleared by a four-second timer. Clear immediately on leaving the room/session or cancellation. Reject delayed chat responses using page, viewer, room and generation checks; clear old drafts. | Three-browser test with deliberately delayed chat response; immediate drawer closure and no stale message insertion. |
| A08 | P2 | Pause Poker during a reveal. Continue remains enabled and the cinematic countdown continues. | Presentation controls ignored paused room status. Disable voting while paused, show a paused label, retain the cinematic and restore controls on resume. | Actual admin pause/resume through HTTP and browser assertions for cinematic and inline controls. |

## Verification and evidence

- `node --test test/*.test.js`: **134 passed, zero failures**. Includes complete randomized games, turn/rule rejection, side pots and chip conservation, private views, stale/duplicate/concurrent actions, auth/roles/session revocation, event isolation, persistence/restart, avatars, chat and reveal timing.
- `VENATUS_TEST_POSTGRES=1 node --test test/integration.test.js test/platform-social.test.js`: **46 passed, zero failures**, using the PostgreSQL storage adapter against PGlite, including schema constraints, ledger triggers, persistence and restart.
- `node scripts/check.js`: syntax checks include `.mjs` browser audits as well as `.js` code.
- `scripts/stability-playtest.mjs`: **256 screenshot/state/viewport checks, zero detected issues or page errors** in the final run. Entry/login/register/setup, lobby/events/activity/admin, profile/event/table configuration, waiting rooms, rules/settings/chat/results and gameplay states. Base sizes: 390×844, 768×1024 and 1440×900; enlarged cards additionally at 3840×2160 and 844×390. Includes all Poker streets, all-in runout, uncontested win and showdown; Bluff claims/verdict/unchallenged win; Chromatic draw/stack/opening wild/finish; Rummy draw/discard/analysis/finish; Oh Hell bid/trick/round/finish.
- State matrix uses actual engines and isolated local database fixtures to reach states efficiently. These fixtures are visual coverage, not a claim that every state was reached by manual clicking. Separate browser journeys and API/engine tests exercise real actions.
- `scripts/stability-network-playtest.mjs`: three separate browser contexts; forced offline/online WebSocket reconnection with intervening opponent play, current private hand and claim restored, successful challenge after reconnect, delayed chat/navigation, admin pause/resume, and recovery from a deliberately injected HTTP 503. All assertions pass.
- Existing `scripts/browser-playtest.mjs` and `scripts/experience-playtest.mjs` pass again: actual multiplayer actions in all five games, guest invite consent, saving an account and recovering its seat, six-seat layouts, sliders/steppers/keyboard, custom avatar upload/reload, escaped chat/moderation, reduced motion and nine viewport sizes.
- `scripts/poker-reveal-playtest.mjs` and `scripts/cinematic-playtest.mjs` pass: engine-generated hole-card/best-five evidence, per-player board highlights, board-only ties and replay isolation; 15 cinematic variants, visible evidence, side pots, 20-second win/7-second mid-game caps, HD/4K/phone and reduced motion. The evidence harness now waits for initial connection/refresh completion before injecting standalone fixtures; the first rerun exposed that test race after navigation cleanup became immediate.
- Local screenshots and machine-readable matrix report: `work/stability-matrix/`; network report and paused screenshot: `work/stability-network/`. Selected before/after screenshots were also visually inspected. These generated files are intentionally excluded from the repository.

## Limits

- No claim that every possible bug is eliminated. No further reproducible failures remained in the completed checks listed above.
- Browser testing uses Chrome on Windows with emulated viewport sizes, not physical iOS/Android devices or Safari/Firefox. Real-device touch, GPU/audio performance, screen-reader review and a real-time two-hour mixed-player soak remain unverified.
- Local fixtures exercise application persistence without touching production accounts, events or balances. PostgreSQL test coverage uses PGlite; cloud transport outages, Neon suspension/resume and multiple simultaneous server processes require separate environment tests.
- No rule changes, dependency upgrades, schema migrations or redesign were introduced in this pass.
