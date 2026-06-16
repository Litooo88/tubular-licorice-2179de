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
