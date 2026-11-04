# JobMate AI — Job Discovery setup

Job Intelligence searches public web results through the Brave Search API. It does not scrape job boards indiscriminately and does not claim that a result is active merely because a search engine indexed it.

## Required configuration

1. Create a Brave Search API account and obtain a Web Search API subscription key from the official Brave Search API dashboard: https://brave.com/search/api/
2. Add the key to the **staging Worker** as a secret named `BRAVE_SEARCH_API_KEY`. Do not put it in source code, `wrangler.jsonc`, frontend JavaScript, GitHub, or chat.
3. Apply the additive D1 migration to the **staging database only**:

   ```sh
   npx wrangler d1 migrations apply jobmate-ai-staging --remote --config wrangler.staging.jsonc
   ```

4. Deploy the feature branch to the staging Worker only after the migration and secret are configured.
5. Open the real Telegram Mini App as the authorized owner and test search, source links, and the ATS handoff.
6. Do not promote to production until the staging smoke test is successful and production migration/secret changes are explicitly planned.

## Provider cost note

The current Brave Search pricing page lists Search at $5 per 1,000 requests and includes $5 in monthly credits. With JobMate's limit of 10 searches/day, 300 searches in a 30-day month would be about $1.50 at that listed rate, before any pricing changes or account-specific terms. Brave's setup flow requires activating a plan before creating an API key; check the dashboard before enabling it.

## Data quality behavior

- The provider is the Brave Search Web Search API. Search results are discovery leads, not verified vacancies.
- JobMate opens the public result page server-side and looks for Schema.org `JobPosting` JSON-LD metadata, with a short timeout and response-size limit.
- `METADATA JOBPOSTING TERBACA` means structured job metadata was found; it is **not** proof that the employer is still accepting applications.
- `TANGGAL KEDALUWARSA` is shown when a structured `validThrough` date is in the past.
- `PERLU VERIFIKASI` means structured metadata was unavailable or incomplete. The user must inspect the original source.
- Every result links to its original URL. JobMate does not fabricate employer names, salary, requirements, or application links.
- The current search quota is 10 searches per authenticated owner per WIB calendar day.

## Security

- The endpoint is behind the existing Telegram Mini App HMAC and owner-ID authentication.
- The Brave API key stays server-side as a Cloudflare Worker secret.
- Candidate profile data is not sent to Brave. The search query contains only the user-entered role/location filters.
- The result handoff to ATS Score Checker uses the profile already loaded in the private Mini App.
- Search result HTML is treated as untrusted input and rendered with DOM text nodes.
