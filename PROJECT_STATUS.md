# Status — 6 November 2026

## Current local release
- Five playable games: Bluff, classic-UNO Chromatic, Texas Hold'em, Oh Hell and Indian Rummy. Exact variants and limits are in GAME_RULES.md.
- Venatus logo, responsive felt tables, private hands, rules, activity, standings and sound controls.
- Persistent accounts, protected owner setup, roles, session revocation, separate event wallets, append-only ledger/audit, transactional actions and settlement.
- Poker side pots and stack cashout; cancellation preserves completed hands. Tied Oh Hell leaders split the pot.
- Owner controls for events, game availability, players, chip corrections, tables, maintenance, announcements and CSV export.
- Optional event start/end times and participant caps. Open registration to arm automatic starts. Scheduled closure safely refunds unfinished tables. Times use browser-local input/display and epoch storage. The server must run; overdue transitions apply on restart.
- Local backup command creates a consistent SQLite snapshot, checks integrity and refuses overwrite.
- Windows launcher, source archive, lockfile and deployment documentation. Local only, as requested.

## Verification
- 58 automated tests: 36 game-engine tests, 21 HTTP/integration tests, one backup test.
- Simulations: 30 full 500-point Chromatic matches, 50 Bluff matches, 40 Oh Hell matches and 80 poker sessions. Rummy covers exact meld validation, declarations, drops, inventory and private analysis.
- Integration covers full matches and conservation, poker cancellation/cashout, nine Oh Hell rounds, Rummy actions, concurrent reservations, duplicate/stale actions, event schedules/caps, restart, authorization races, sessions and immutable records.
- Independent browser sessions verified poker call/check/all-in/showdown and payout; Rummy draw, private analysis, discard and drop settlement; three-player Oh Hell bidding/trick/scoring; classic Chromatic legal choices and synchronized turns.
- New event schedule and participant cap saved and registration armed through owner UI. Console inspection returned no errors. Desktop dashboard and mobile lobby had no horizontal overflow at tested widths.
- Earlier release browser checks completed three-player Bluff and event lifecycle flows. Earlier Chromatic browser completion used version 1; a full classic match is covered by HTTP tests, not claimed as a full browser playthrough.
- QA data remains in workspace work/browser-data, separate from deliverable data. No real owner credentials are embedded or provisioned.

## Remaining scope
- OAuth, MFA, password recovery, advanced analytics and expanded moderation remain unfinished.
- JavaScript/SQLite, single Node process; no TypeScript/PostgreSQL migration. Node 22 SQLite is experimental.
- No public deployment, Docker execution, physical-device verification, large-scale load test or independent security review performed.
- Standings return 100 entries, activity 20 matches, dashboard audit/ledger a recent window; full database records persist.
- Schedule editing after event creation, email notifications and external always-on scheduling are not implemented.

Next work: account recovery/MFA, fuller moderation and analytics. Public hosting remains deferred by user instruction.
