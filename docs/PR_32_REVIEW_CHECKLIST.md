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
