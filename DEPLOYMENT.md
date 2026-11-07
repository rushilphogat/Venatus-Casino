# Deployment

The application requires one continuously running Node 22.13+ server, WebSocket support, and a persistent local disk. Do not run multiple replicas against independent SQLite files. This is a deployable package, not evidence of a public deployment.

## Run

Install dependencies with `npm ci`, then run `npm start`. Set `PORT` (default 3000), `HOST` (use `0.0.0.0` in a container), and a cryptographically random `OWNER_SETUP_TOKEN` in the hosting service's secret manager. Set `ORIGIN` to the exact HTTPS origin used by visitors, with no trailing slash. Never put the setup token in source control or a URL.

The owner setup form uses the token to create the first owner account. Owner credentials are chosen in that form. Keep OWNER_SETUP_TOKEN in the hosting secret store: the current production startup requires it even after provisioning, while the setup endpoint refuses to create another owner. Preserve the SQLite data directory across restarts and deployments.

## Requested domain: casino.venatus.in

Public DNS checked on 7 November 2026: venatus.in uses Cloudflare nameservers; casino.venatus.in has no current A record. Hosting has not yet been selected or deployed, and DNS has not been changed.

Production settings for the selected host:

- ORIGIN=https://casino.venatus.in (no trailing slash)
- NODE_ENV=production
- HOST=0.0.0.0
- DATA_DIR=/app/data, mounted on persistent storage
- PORT supplied by the host, or 3000
- OWNER_SETUP_TOKEN generated privately and saved in the host's secret store
- One running instance; health-check path /health; WebSocket upgrades supported

Deploy and verify the service before attaching its custom domain. Add only the host-provided DNS records for the casino subdomain in Cloudflare; preserve existing root-domain, mail and other records. Verify domain ownership, HTTPS issuance, login, live multiplayer and persistence before sharing the address. Local account data is not uploaded unless intentionally migrated; a fresh hosted database requires owner setup.

## Container

Build with `docker build -t venatus-casino .`. Mount a persistent volume at `/app/data`, forward port 3000, provide the environment through the hosting service, and place the server behind an HTTPS reverse proxy. The proxy must forward WebSocket upgrades and allow long-lived connections. Keep the service to one replica. Docker execution and public deployment must be verified on the chosen host; this document does not claim those checks ran.

## Backups and recovery

Run `npm run backup` for a verified SQLite VACUUM INTO snapshot, which includes committed WAL data while the server runs. Backups default to data/backups; pass a new path after `--` to use another destination. Existing files are never overwritten. Alternatively use a host snapshot while the service is stopped. Do not copy only the main database file while WAL writes are active. Encrypt backups and restrict access: they contain account and session records. Retain the database, WAL and SHM files together for filesystem snapshots. Test restoration in an isolated environment before relying on a backup policy.

Monitor server error logs, disk usage and process health. Do not log passwords, session cookies or setup tokens. Apply dependency updates and operating-system security patches. On incident, use owner controls to stop new games and safely cancel/refund affected matches; preserve the database and audit trail for investigation.

## Before inviting players

Verify HTTPS and secure session cookies, owner permissions, three independent devices in a Bluff game, reconnect behavior, event wallets and cancellation refunds at the actual hosted URL. Check that the hosting service retains its data volume when redeploying. Configure uptime monitoring and backups. No paid hosting has been provisioned by this project.

To restore locally: stop the server, preserve the current entire data directory as a separate recovery copy, and restore the chosen snapshot as casino.sqlite in a fresh data directory. Start with DATA_DIR pointing to that directory. Never combine a restored database with old WAL/SHM files. Verify accounts, wallets and records before resuming play. The automated backup test opens the saved snapshot and verifies its committed data; full operational restore drills remain your deployment responsibility.
