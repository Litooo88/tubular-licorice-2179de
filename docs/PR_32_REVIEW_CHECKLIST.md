## PR #32 Review Checklist

### Build/test

* npm run build
* npm run verify:checkout-products
* nemob-callflow npm run check

### Manual admin test

* Open /admin
* Verify AI Kontrolltorn appears
* Verify missing token blocks AI calls
* Verify ai-daily-brief can be called with token
* Verify E-Wheels E16 quote test works
* Verify missed-call SMS draft test works
* Verify SMS draft is not sent
* Verify timeline tab appears on case cards
* Verify internal note can be created
* Verify SMS draft status can be changed
* Verify no real SMS sending exists in this PR

### Security

* x-admin-token required for AI/admin functions
* ADMIN_TOKEN compared server-side
* no secrets in frontend
* no Supabase
* no Claude code imported directly
* no production deploy requested

### Merge condition

Do not merge until either:

* Netlify preview is verified, or
* local Netlify test is verified and accepted manually.

## Local Netlify verification

* Date/time: 2026-06-16 05:22:31 +02:00
* Netlify CLI version: `netlify-cli/26.1.0 win32-x64 node-v24.16.0`
* Local URL: `http://localhost:8899`

### Commands

* `git status --short`
* `git branch --show-current`
* `git log --oneline -5`
* `npm run build`
* `npm run verify:checkout-products`
* `nemob-callflow npm run check`
* `npx netlify --version`
  * Result: timed out locally while resolving/running through `npx`.
* `npx --yes -p netlify-cli netlify --version`
  * Result: `netlify-cli/26.1.0 win32-x64 node-v24.16.0`
* `npx --yes -p netlify-cli netlify dev --offline --port 8899 --skip-gitignore`

### Endpoints tested

* `GET /admin/`
  * Result: `200`
  * `AI Kontrolltorn` present: yes
  * `Timeline` present in admin source: yes
* `GET /.netlify/functions/ai-daily-brief` without token
  * Result: `401 Unauthorized`
* `POST /.netlify/functions/ai-quote` without token
  * Result: `401 Unauthorized`
* `POST /.netlify/functions/ai-sms-draft` without token
  * Result: `401 Unauthorized`
* `GET /.netlify/functions/ai-daily-brief` with `x-admin-token: local-test-token`
  * Result: blocked by local Netlify Blobs environment
* `POST /.netlify/functions/ai-quote` with `x-admin-token: local-test-token`
  * Result: blocked by local Netlify Blobs environment
* `POST /.netlify/functions/ai-sms-draft` with `x-admin-token: local-test-token`
  * Result: blocked by local Netlify Blobs environment

### UI flows tested

* Opened `/admin/` through local Netlify dev.
* Verified AI Kontrolltorn markup is present.
* Verified Timeline markup is present in admin source.
* Verified missing token blocks AI function calls at function boundary with
  `401 Unauthorized`.

### Results

* `npm run build`: pass.
* `npm run verify:checkout-products`: pass.
* `nemob-callflow npm run check`: pass.
* Netlify dev started locally and served `/admin/`.
* `ADMIN_TOKEN` was loaded from a temporary local `.env` for verification.
* No real SMS sending was observed or triggered.
* Authenticated AI function execution could not be completed locally because
  Netlify Blobs was not configured for the local function runtime.

### Blockers

Authenticated AI/admin functions that use `@netlify/blobs` returned:

```text
MissingBlobsEnvironmentError: The environment has not been configured to use Netlify Blobs. To use it manually, supply the following properties when creating a store: siteID, token
```

This blocks full local verification of:

* `ai-daily-brief`
* `ai-quote`
* `ai-sms-draft`
* timeline event creation
* internal note creation
* SMS draft status changes

### Merge recommendation

Do not merge PR #32 yet. Merge should wait until either:

* Netlify preview deploy is available and verified, or
* local Netlify Blobs configuration is fixed and the authenticated AI/timeline
  flows are verified manually.

## Local storage fallback verification

* Date/time: 2026-06-16 05:35:14 +02:00
* Netlify CLI version: `netlify-cli/26.1.0 win32-x64 node-v24.16.0`
* Local URL: `http://localhost:8899`
* Runtime env used locally:
  * `NORDIC_LOCAL_STORAGE_FALLBACK=1`
  * `ADMIN_TOKEN=test-token`

### Why fallback was needed

Local Netlify dev loaded the functions and enforced auth correctly, but
authenticated AI/admin functions failed before fallback because `@netlify/blobs`
had no local Blobs runtime configuration and threw `MissingBlobsEnvironmentError`.

Netlify Blobs remains the production storage path. The fallback is only enabled
when `NORDIC_LOCAL_STORAGE_FALLBACK=1` is set explicitly and stores local test
data under `.local/nordic-storage/`, which is gitignored.

### Endpoints tested with fallback

* `GET /admin/`
  * Result: `200`
  * `AI Kontrolltorn` present: yes
  * `Timeline` present in admin source: yes
* `GET /.netlify/functions/ai-daily-brief` without token
  * Result: `401 Unauthorized`
* `POST /.netlify/functions/ai-quote` without token
  * Result: `401 Unauthorized`
* `POST /.netlify/functions/ai-sms-draft` without token
  * Result: `401 Unauthorized`
* `GET /.netlify/functions/case-events?caseId=local_case_pr32` without token
  * Result: `401 Unauthorized`
* `GET /.netlify/functions/sms-drafts?caseId=local_case_pr32` without token
  * Result: `401 Unauthorized`
* `GET /.netlify/functions/ai-daily-brief` with `x-admin-token: test-token`
  * Result: `200`
  * Dry-run mode: yes
* `POST /.netlify/functions/ai-quote` with `x-admin-token: test-token`
  * Result: `201`
  * E-Wheels E16 start price: `395`
  * E-Wheels E16 range: `595-1995`
  * Requires diagnosis: yes
  * Dry-run mode: yes
* `POST /.netlify/functions/ai-sms-draft` with `x-admin-token: test-token`
  * Result: `201`
  * SMS draft created and linked to local test case.
  * No real SMS sending was attempted.
* `POST /.netlify/functions/case-events` with `x-admin-token: test-token`
  * Result: `201`
  * Internal note event created for local test case.
* `GET /.netlify/functions/case-events?caseId=local_case_pr32` with
  `x-admin-token: test-token`
  * Result: `200`
  * Returned both internal note and AI suggestion events.
* `GET /.netlify/functions/sms-drafts?caseId=local_case_pr32` with
  `x-admin-token: test-token`
  * Result: `200`
  * Returned local SMS draft.
* `PATCH /.netlify/functions/sms-drafts` with `x-admin-token: test-token`
  * Result: `200`
  * Status changes verified: `approved`, `rejected`, `dry_run`
  * `sent` remained `false`.

### Results

* `npm run build`: pass.
* `npm run verify:checkout-products`: pass.
* `nemob-callflow npm run check`: pass.
* Local fallback unblocked authenticated function verification.
* Auth is enforced before customer/admin data is returned.
* No real SMS sending exists in this PR path.

### Merge recommendation after fallback

PR #32 is locally verified with explicit storage fallback. Because no Netlify
preview/status is available, merge is recommended only if this local Netlify
verification is manually accepted as satisfying the PR merge condition.

## Production dry-run smoke test support

* Date/time: 2026-06-16 15:09:10 +02:00

Authenticated production smoke tests need to verify AI functions without
creating persistent Netlify Blobs data. `ai-quote` and POST `ai-daily-brief`
normally create `ai_recommendations`, so explicit dry-run support is required
for safe production verification.

Dry-run still requires `x-admin-token` and `ADMIN_TOKEN`. It is enabled only
when one of these flags is sent:

* request body `dryRun: true`
* request body `previewOnly: true`
* query string `dryRun=1`

When dry-run is active:

* `ai-quote` runs deterministic price logic and skips `ai_recommendations` and
  `case_events` writes.
* `ai-daily-brief` returns the normal brief response and skips
  `ai_recommendations` writes for POST smoke tests.
* Responses include `dryRun: true` and `writesSkipped` when writes were
  intentionally bypassed.
* No SMS send path is used.

This mode is intended only for production smoke testing and does not change the
default behavior when dry-run flags are absent.
