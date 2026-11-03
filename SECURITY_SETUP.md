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

The private build is currently deployed to the staging and production Workers. The production and staging binding lists were verified to contain the Telegram bot token and Gemini API key as secret bindings, plus the owner ID and the matching D1 database. Secret values were not read or exposed. Keep the checklist above for future rotations or deployments; verify the actual Telegram Mini App before declaring an end-to-end release complete.

## Current production pre-check (read-only)

Current deployment snapshot (2026-11-03): production Worker `jobmate-ai` version 33 and staging Worker `jobmate-ai-staging` version 29 are each deployed at 100% traffic. Both binding lists include `DB`, `GEMINI_API_KEY` (secret), `TELEGRAM_BOT_TOKEN` (secret), and `OWNER_TELEGRAM_ID`. The production D1 schema includes the daily `ai_usage` counters and Gmail OAuth tables; staging has the same tables. No secret values are read by the audit. Production D1 currently has no user/profile/application/document rows, so no user data was changed by this deployment.

A read-only D1 inspection confirmed there are currently zero rows under the legacy `telegram_id='personal'` identity and zero rows under the configured owner identity in `users`, `profiles`, `applications`, and `documents`. No legacy-row migration is currently required. No database writes were performed during this inspection.

## AI usage limits

The private API now enforces daily limits per verified Telegram account (Asia/Jakarta calendar day (WIB)):

- Text vacancy analysis: 20 requests/day.
- Image vacancy analysis: 10 requests/day.
- Both counters are incremented atomically in D1 to avoid parallel requests bypassing the limit.
- `GET /api/ai-usage` (and the existing `GET /api/image-usage` compatibility route) reports all counters and the next reset boundary is 00:00 WIB.
- The old IP-based `image_usage` table is no longer used by the updated Worker; it is left untouched for safe rollback.

Before deploying this branch, apply both additive migrations in order to the intended D1 database. Migration `0002_chat_usage.sql` adds a separate daily chat counter; it does not reset or delete existing usage rows:

```sh
npx wrangler d1 migrations apply jobmate-ai-db --remote
```

The migration creates only the new `ai_usage` table and does not modify or delete existing user, profile, application, or document records. Do not run it against production until deployment is explicitly approved and the target database is confirmed.


## Gmail connection (Google OAuth)

The Mini App Gmail tab uses Google's OAuth 2.0 authorization-code flow with PKCE. It requests the read-only Gmail scope only; JobMate does not send, delete, or modify messages.

Before enabling it on staging:

1. In Google Cloud Console, create/select a project and enable the Gmail API.
2. Configure the OAuth consent screen. While the app is in Testing, add the Google account that will connect as a test user.
3. Create an OAuth Client ID of type **Web application**.
4. Add this exact Authorized redirect URI:
   `https://jobmate-ai-staging.ahmadfathirasydiq.workers.dev/oauth/gmail/callback`
5. Add the following Worker secrets/variables to **jobmate-ai-staging** only:
   - `GOOGLE_CLIENT_ID` — OAuth client ID (non-secret variable is acceptable).
   - `GOOGLE_CLIENT_SECRET` — OAuth client secret (Secret).
   - `GMAIL_TOKEN_ENCRYPTION_KEY` — generate a random secret of at least 32 bytes; used to derive an AES-GCM key for encrypting OAuth tokens at rest.
6. Apply additive migration `0003_gmail_oauth.sql` to the staging D1 database before deploying the Gmail OAuth build.

The callback uses one-time, ten-minute OAuth state bound to the verified Telegram owner, PKCE S256, and HTTPS. Access/refresh tokens are encrypted with AES-GCM before storage. The database stores only ciphertext. Disconnecting removes the stored connection. Never put the Google client secret or encryption key in frontend code, source control, Telegram, or chat.

Google may require OAuth app verification before non-test users can authorize Gmail scopes. Keep the consent screen in Testing for the private owner-only app until verification/public distribution is actually needed. Do not request broader Gmail scopes without a clear feature requirement.

The Gmail integration is not active until the Google OAuth credentials and the staging D1 migration are configured. Production credentials, Worker, and database must remain untouched until staging validation is complete.
