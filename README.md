# VENATUS CASINO

A working local release of the Venatus private card room, using the supplied logo unchanged. Free virtual chips only: no purchases, transfers, cash value, or prizes.

## Open the application

On Windows, double-click **Start-Venatus.cmd**. It starts the installed application and opens http://localhost:3000. Keep its server window open while playing. Node.js 22.13 or newer is required; dependencies are already installed in this checkout.

For a fresh source checkout: run `npm ci`, then `npm start`. To run checks: `npm test` and `npm run check`.

## Set up your owner account

1. Open the application and choose **Owner setup**.
2. Open `data/owner-setup-token.txt`, which is generated on the first local start. Copy its contents into the setup-token field.
3. Choose your owner name and a unique password of at least 12 characters. Keep both private. The setup token stops working once an owner exists.
4. Open **Control room** to create events, manage players and moderators, control tables, adjust chips with a reason, publish an announcement, and review the audit trail.

No owner password is embedded in the source. Test accounts used during development live in a separate QA database outside this application.

## Play

Create a player account, choose casual mode or an active event, and create or join a table. Bluff and Oh Hell need 3–6 people; Chromatic, Texas Hold’em and Indian Rummy need 2–6. Each person must sign in with their own account. Use separate browsers/profiles when testing on one computer; ordinary tabs share a login.

The ante is reserved when taking a seat. Leaving before the deal refunds it. The host deals once enough players join. Fixed-ante winners receive the pot; tied Oh Hell leaders split it. Poker returns each final stack. Cancellation refunds fixed antes; poker returns current bets and remaining stacks while preserving completed hands. Refreshing preserves the login and hand—choose **Return** on your table to resume.

The default server binds only to this computer. Online or LAN play needs an explicit network deployment; see **DEPLOYMENT.md**. A localhost link is not a public multiplayer deployment.

## Implemented

- Authoritative real multiplayer Bluff, classic-UNO Chromatic, Texas Hold’em, Oh Hell and Indian Rummy over HTTP actions and authenticated WebSocket updates.
- Persistent password accounts, revocable cookie sessions, one-time protected owner setup, player/moderator/owner permissions.
- Separate casual and event wallets, transactional reservations and payouts, duplicate-action rejection, immutable ledger and audit history.
- Event registration, start, pause, resume, close, cancel and archive, with optional schedules and participant caps. Closing refunds unfinished matches and freezes the event economy.
- Public/private casual tables, invitation codes, live standings, match history, turn deadlines and reconnect recovery.
- Player bans, moderator assignment, audited chip corrections, table pause/resume/refund, maintenance mode, announcements and CSV standings export.
- Responsive green-felt interface, vector cards, selection/deal/winner animations, reduced-motion support and persistent sound preferences.

## Scheduled events and backups

In Control room, optionally set participant limits and start/end times before creating an event. Times use your browser’s local timezone. Open registration to arm automatic starts. Blank times use manual controls. Scheduled endings close and refund unfinished tables; completed results remain. Keep the server running for transitions at their scheduled time. Overdue transitions are applied after restart.

Run `npm run backup` to create an integrity-checked snapshot under `data/backups`, or `npm run backup -- "C:\Backups\venatus.sqlite"` for a new destination. Existing files are never overwritten. Backups contain account/session records; keep them private. See DEPLOYMENT.md for restoration.

## Scope and operational limits

All five games are playable. MFA, OAuth, password recovery, advanced analytics, richer moderation and production monitoring remain future work. No prize feature is enabled.

The implementation uses compact JavaScript ESM rather than the specification's preferred TypeScript/React/PostgreSQL stack. It is designed for one Node process and one persistent SQLite disk; do not run multiple replicas against it. SQLite support in Node 22 is experimental. The application has not undergone independent penetration testing or large-scale load testing.

Passwords are hashed with scrypt. Administrators cannot alter ledger/audit rows through the application. A host with direct disk access can still modify or replace the database; keep backups and restrict host access.

See **GAME_RULES.md**, **ARCHITECTURE.md**, **PROJECT_STATUS.md**, and **DEPLOYMENT.md** for exact behavior and verification status.
