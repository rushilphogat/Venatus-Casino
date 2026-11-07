# Architecture
One Node 22+ process serves vanilla HTML/CSS/JS and authenticated WebSockets. SQLite WAL stores users, hashed sessions, context wallets, immutable ledger, events, persisted room snapshots and audit records. Actions run synchronously in a transaction; game engines are pure JSON transitions. Clients receive personalized snapshots. Single replica deployment with persistent disk; TLS via reverse proxy. No cloud service or payment dependency.

## Boundaries
- `src/games.js`: routing plus Bluff and legacy Chromatic. `chromatic.js`, `poker.js`, `ohhell.js`, `rummy.js`: pure transitions and personalized views. Server-only crypto shuffle.
- `src/backup.js`: consistent SQLite snapshot and integrity verification.
- `src/server.js`: HTTP/WS transport, authentication, migration/schema, transactional economy, rooms, events and administration.
- `public/`: no build tooling or external font/network dependency; native browser WebSockets, SVG/CSS cards and Web Audio.
- `test/`: Node test runner, isolated SQLite files, real HTTP/WebSocket clients and randomized game simulations.

## Integrity
Available chips become reserved on seating; reserved chips represent committed stakes once play starts. Winner payouts and reservation removal happen in the same SQLite transaction as the final room state, so no separately visible unsettled balance exists. Ledger uniqueness keys cover allocation, per-seat reservation generations, refunds and settlement. Repeated actions are keyed per room/user; expected room versions reject stale actions. Owner corrections link ledger references to audit records.

Authentication is checked after asynchronous request-body reads to avoid stale-privilege races. Session tokens are random and only their SHA-256 digests are stored; passwords use salted scrypt. Cookies are HttpOnly/SameSite=Strict and Secure in production. Production requires an explicit HTTPS ORIGIN and setup secret. Only refresh signals traverse WS; authenticated HTTP snapshots contain the requesting player's hand. No hidden game state is broadcast.

Active room queries use an expression index so the timer avoids scanning historical snapshots. All durable state lives on one local disk; horizontal replicas are unsupported. Browser test aliases isolate cookies while reaching the same local server.

Event schedules and caps live in event_options, linked to events. Wallet count defines registration count; cap checks and allocations share a transaction. The timer and mutation path apply overdue schedule transitions. Registration arms automatic starts; paused events do not auto-resume. End deadlines close active, paused or registering events. Poker settlement validates every payout and total conservation; cancellation refunds only the current hand while keeping previous results.
