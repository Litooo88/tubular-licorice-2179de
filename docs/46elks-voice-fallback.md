# 46elks voice fallback

## Current goal

Catch workshop calls when Sebastian cannot answer.

Flow:

1. Customer calls the 46elks workshop number.
2. 46elks calls Sebastian for 18 seconds.
3. If Sebastian is busy or does not answer, 46elks calls Verkstaden for 18 seconds.
4. If Verkstaden also misses the call, the webhook attempts to send a missed-call SMS to Sebastian or the configured workshop SMS recipients.

## Number

Current 46elks fixed voice number:

- `+46101385498`

## Current production route

The live 46elks number currently uses the single-destination emergency route:

- `voice_start`: `https://www.nordicemobility.se/.netlify/functions/voice-simple`

`voice-simple` prefers `VOICE_PRIMARY_NUMBER`, then `VOICE_SEBASTIAN_PHONE`,
and finally the emergency number stored in the function. Do not remove the
emergency fallback until the production environment and a real test call have
both been verified.

If `VOICE_WEBHOOK_SECRET` is not configured, this initial route intentionally
remains available. A missing optional secret must never return `503` and take
the workshop phone offline.

## Two-destination fallback rollout

The richer Sebastian-to-Verkstaden flow is available at:

Open the number in 46elks and set:

- `voice_start`: `https://www.nordicemobility.se/api/voice-start?secret=<VOICE_WEBHOOK_SECRET>`
- Name/label: `Nordic voice fallback`

Do not switch 46elks to this URL until `VOICE_WEBHOOK_SECRET`,
`VOICE_SEBASTIAN_PHONE`, and `VOICE_WORKSHOP_PHONE` are configured in Netlify.
Save changes, then test with real calls.

## Netlify environment variables

The function is safe-by-default: it will not route calls or send missed-call SMS
until `VOICE_WEBHOOK_SECRET` is configured. These env vars control the live
flow:

- `VOICE_CALLER_ID` - 46elks number shown to Sebastian/Verkstaden. Default: `+46101385498`.
- `VOICE_WEBHOOK_SECRET` - required for `/api/voice-start` and signed callback
  URLs. The same value must be included in the 46elks URL as `?secret=...`.
  It is optional for the current `voice-simple` emergency route.
- `VOICE_SEBASTIAN_PHONE` - Sebastian mobile, configured in Netlify env. No private mobile fallback is stored in the repo.
- `VOICE_WORKSHOP_PHONE` - Verkstaden mobile, configured in Netlify env. No private mobile fallback is stored in the repo.
- `VOICE_TIMEOUT_SECONDS` - seconds per person. Default: `18`.
- `VOICE_MISSED_SMS_TO` - comma-separated missed-call SMS recipients. Fallback:
  `WORKSHOP_SMS_TO`. If neither is configured, no missed-call SMS is sent.

Missed-call SMS uses existing 46elks SMS env vars:

- `ELKS_USERNAME`
- `ELKS_PASSWORD`
- `SMS_FROM`

## Test script

1. POST to the selected production endpoint and require HTTP `200` plus a
   non-empty `connect` action. HTTP `200` with `hangup` is not a passing test.
2. Save the selected `voice_start` URL in 46elks.
3. Call `+46101385498` from a non-workshop phone.
4. Let Sebastian answer and confirm the call connects.
5. For `/api/voice-start`, call again and let Sebastian ignore it.
6. Confirm Verkstaden's phone rings and shows the workshop number.
7. Call again and let both ignore it.
8. Confirm the missed-call entry appears in 46elks call history.
9. If SMS env vars are configured, confirm Sebastian receives a missed-call SMS.

## Incident note: 2026-06-28

`VOICE_WEBHOOK_SECRET` was made mandatory in code before it was configured in
Netlify and before the 46elks URL included the secret. The production endpoint
therefore returned `503 VOICE_WEBHOOK_SECRET_MISSING`, which 46elks recorded as
`badsource / Failed to load source URL`. The forwarding number was also absent
from Netlify, so merely changing the response to HTTP `200` produced
`hangup: reject` instead of a call. The automated voice test now covers both
conditions and runs as part of every Netlify build.

## Important operational note

Sebastian and Verkstaden should save `+46101385498` as `Nordic verkstad` or similar. Then they know every forwarded call is a customer/workshop call.

## Phase 2 ideas

- Add a spoken prompt.
- Add voicemail/recording with GDPR wording.
- Log call attempts into Netlify Blobs or Google Sheets.
- Show missed calls inside `/admin/`.
