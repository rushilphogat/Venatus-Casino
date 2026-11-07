# Free Render deployment

[Deploy to Render](https://render.com/deploy?repo=https://github.com/rushilphogat/Venatus-Casino)

1. Sign in to Render and open the deployment link. The repository's render.yaml creates one **Free** Docker web service, with no paid database or persistent disk.
2. Wait for the service to become Live, then open its HTTPS onrender.com address. The app automatically uses Render's RENDER_EXTERNAL_URL for its origin check.
3. Register a player name and password (at least 12 characters). Choose a game, create a private casual table, then click **Copy invite link**. Friends open that link, register or sign in, and automatically take a seat. Wait until everyone joins before dealing. Bluff/Oh Hell need 3–6 players; other games need 2–6.
4. Owner setup is optional for casual rooms. For administration, find OWNER_SETUP_TOKEN in the service's Environment settings; Render generates it privately. Use it on the Owner setup form and choose your own owner credentials. Keep the token private. After data resets, owner setup is needed again for admin features.

## Custom domain

Add casino.venatus.in in the service's custom-domain settings. Give the exact DNS records Render supplies to the colleague managing Cloudflare. When Render verifies the domain and issues HTTPS, set the service environment variable ORIGIN to https://casino.venatus.in (no trailing slash). Share links using that domain. Changing environment variables redeploys the service, so finish this before starting games.

## Temporary data is intentional

Free Render storage is ephemeral. Accounts, rooms, chips and results may disappear on restart, redeploy or service spin-down. Register again and create a new room when this happens. This can also interrupt a game in progress; the free tier provides no uninterrupted-session guarantee. Old room links do not survive a data reset.

Free services sleep after 15 minutes without incoming traffic, and startup can take about a minute. Open the site before inviting friends. Scheduled events only run while the server is running. No keep-alive workaround or paid resource is configured.

Documentation: https://render.com/docs/free and https://render.com/docs/blueprint-spec
