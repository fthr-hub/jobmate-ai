# JobMate AI

Private Telegram Mini App for organizing job applications and preparing career documents.

## Daily workflow

1. Open the Mini App from the authorized Telegram bot.
2. Complete **Profil & CV** with accurate contact details, education, skills, and work history.
3. Paste a vacancy or upload a vacancy image in **Analisis AI**.
4. Use **Job Match** to compare one CV against 2–5 vacancies. Separate each vacancy with a line containing `---`.
5. Use **ATS Score Checker** to review a CV against one target vacancy. Treat the score as an estimate, not a hiring prediction.
6. Generate a tailored CV and application letter in **CV & Surat AI**. Review every date, company, role, and claim before using it.
7. Save important outputs in **Dokumen** and keep each application in **Lamaran**. New letters can be added to the tracker as Draft.
8. Use **Email & Follow-up** to paste a recruiter email, summarize it, or prepare a reply. Copy and send the reply manually after reviewing it.

## Main features

- Vacancy analysis from text or image.
- Job Intelligence zero-cost search links to Google Jobs, Indeed, JobStreet, LinkedIn, and company career-page searches.
- Cyber intelligence dashboard theme with a responsive vacancy scanner.
- Private professional profile.
- ATS-friendly CV and application-letter generation.
- ATS score estimation and multi-vacancy Job Match ranking.
- Application tracker with Draft, Applied, Interview, Accepted, and Rejected statuses.
- Private document center for generated text and uploaded PDF/DOC/DOCX files.
- Career chat and manual email summary/reply assistance.
- Export generated documents to TXT, DOCX, or print/save as PDF.

Job Intelligence builds public search links without a paid search API or extra D1 migration. Search results are supplied by Google and destination sites; JobMate does not claim vacancies are active. Candidate CV/contact data is not sent to search engines.

## AI limits

Daily quotas are per authenticated Telegram owner and reset at 00:00 WIB:
- Text analysis, ATS checker, CV/letter generation, and Job Match share 20 text requests/day.
- Image vacancy analysis: 10 requests/day.
- Career chat and manual email assistance share 30 chat requests/day.

A failed upstream AI request should release its reserved quota. Quotas are not a guarantee of Gemini availability; provider rate limits and service outages may still apply.

## Privacy and safety

- Private API routes require Telegram Mini App initData HMAC verification and the configured owner Telegram ID.
- Profile, application, and document records are scoped to the verified Telegram user ID.
- Do not paste passwords, OTP codes, or unrelated sensitive information into the app.
- AI output is a draft. Verify facts and edit before applying.
- Never add skills, certificates, dates, employers, responsibilities, or achievements that are not true.
- Email helper is manual-only. It does not connect to Gmail, read inboxes, or send messages.
- Google OAuth/Gmail sync is intentionally not part of the daily workflow and requires separate configuration before it can be activated.

## Operational health check\n\nThe public `GET /api/health` endpoint reports database connectivity and whether the Gemini and Telegram authentication bindings are configured. It returns `200` when those dependencies are ready and `503` with `status: degraded` when a required dependency is missing. This checks binding/configuration presence, not an actual Gemini generation request.\n\n## Development checks

The GitHub Actions workflow checks Worker syntax, Telegram authentication and route tests, and frontend inline-script syntax:

```sh
node --check src/index.js
node --test tests/telegram-auth.test.mjs
```

The Worker dashboard is embedded in `src/index.js` as `APP_HTML`; keep it identical to `public/index.html`. CI verifies this invariant.

## Deployment notes

- Production and staging use separate Cloudflare Workers and D1 databases.
- Keep `TELEGRAM_BOT_TOKEN`, `GEMINI_API_KEY`, and other credentials in Cloudflare Worker secrets only.
- Never commit secrets or send them in chat.
- Apply additive D1 migrations to the intended database before deploying schema-dependent changes.
- Job Intelligence free mode requires no paid search API key and no additional D1 migration. See `JOB_DISCOVERY_SETUP.md`.
- Run CI and staging checks before production deployment.
- The production deployment must be smoke-tested from the real Telegram Mini App; a successful upload/deployment alone does not prove end-to-end functionality.
