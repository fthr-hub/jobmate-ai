# JobMate AI — Security setup

This branch adds Telegram Mini App authentication to the private API.

## Required Cloudflare secret

The Worker expects the bot token in the secret binding named `TELEGRAM_BOT_TOKEN`. Never put the bot token in source code, `wrangler.jsonc`, browser JavaScript, GitHub, or chat messages.

Set the secret from the Cloudflare Worker settings (Settings → Variables and Secrets → Add → Secret) or with Wrangler when you are ready to deploy:

```sh
npx wrangler secret put TELEGRAM_BOT_TOKEN
```

**Important:** changing a Worker secret through Wrangler publishes a new Worker version. Do not run this command until the code has been reviewed and a deployment is explicitly approved.

The owner check requires `OWNER_TELEGRAM_ID` as a Worker environment variable. Set it to the numeric Telegram ID of the one authorized account in Cloudflare Worker settings. The Worker fails closed if it is missing. Do not commit this identifier to source control.

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

## Current production pre-check (read-only)

The current production Worker version's bindings include `GEMINI_API_KEY`, but not `TELEGRAM_BOT_TOKEN`. The Telegram secret must therefore be added before the authenticated build can be deployed. Adding a Worker secret publishes a new version, so wait for explicit deployment approval.

A read-only D1 inspection confirmed there are currently zero rows under the legacy `telegram_id='personal'` identity and zero rows under the configured owner identity in `users`, `profiles`, `applications`, and `documents`. No legacy-row migration is currently required. No database writes were performed during this inspection.

## AI usage limits

The private API now enforces daily limits per verified Telegram account (UTC day):

- Text vacancy analysis: 20 requests/day.
- Image vacancy analysis: 10 requests/day.
- Both counters are incremented atomically in D1 to avoid parallel requests bypassing the limit.
- `GET /api/ai-usage` (and the existing `GET /api/image-usage` compatibility route) reports both counters.
- The old IP-based `image_usage` table is no longer used by the updated Worker; it is left untouched for safe rollback.

Before deploying this branch, apply the additive migration to the intended D1 database:

```sh
npx wrangler d1 migrations apply jobmate-ai-db --remote
```

The migration creates only the new `ai_usage` table and does not modify or delete existing user, profile, application, or document records. Do not run it against production until deployment is explicitly approved and the target database is confirmed.
