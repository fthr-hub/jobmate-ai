# JobMate AI — Security setup

This branch adds Telegram Mini App authentication to the private API.

## Required Cloudflare secret

The Worker expects the bot token in the secret binding named `TELEGRAM_BOT_TOKEN`. Never put the bot token in source code, `wrangler.jsonc`, browser JavaScript, GitHub, or chat messages.

Set the secret from the Cloudflare Worker settings (Settings → Variables and Secrets → Add → Secret) or with Wrangler when you are ready to deploy:

```sh
npx wrangler secret put TELEGRAM_BOT_TOKEN
```

**Important:** changing a Worker secret through Wrangler publishes a new Worker version. Do not run this command until the code has been reviewed and a deployment is explicitly approved.

The owner check currently uses `OWNER_TELEGRAM_ID` if configured, otherwise the private owner ID already set in the Worker source. Do not change this value unless the intended owner account changes.

## Authentication behavior

- Browser sends the raw `Telegram.WebApp.initData` in `Authorization: tma ...`.
- Worker verifies Telegram's HMAC-SHA-256 signature using `TELEGRAM_BOT_TOKEN`.
- Worker rejects missing/invalid signatures and init data older than one hour.
- Worker checks that the signed Telegram user ID matches the owner ID.
- All private `/api/*` routes except `/api/health` require successful authentication.
- Database operations use the verified Telegram user ID instead of a hardcoded shared identity.
- No wildcard CORS headers are emitted.

## Pre-deployment checklist

1. Confirm the correct bot token is available in Cloudflare as `TELEGRAM_BOT_TOKEN`.
2. Confirm the Telegram bot's configured Mini App URL points to the intended Worker/domain.
3. Test from the actual Telegram account that owns the app.
4. Confirm unauthenticated requests to `/api/profile`, `/api/applications`, and `/api/documents` return HTTP 401.
5. Confirm the owner's Telegram session can read and write profile, CV, and application data.
6. Confirm a different Telegram account receives HTTP 401 and cannot access owner data.
7. Confirm analysis endpoints reject unauthenticated requests.
8. Verify existing owner data remains accessible before any production rollout.

Do not deploy until the secret is configured and the checks above pass. This branch has not been deployed.
