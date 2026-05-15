# 46elks voice fallback

## Current goal

Catch workshop calls when Sebastian cannot answer.

Flow:

1. Customer calls the 46elks workshop number.
2. 46elks calls Sebastian for 18 seconds.
3. If Sebastian is busy or does not answer, 46elks calls Lennart for 18 seconds.
4. If Lennart also misses the call, the webhook attempts to send a missed-call SMS to Sebastian or the configured workshop SMS recipients.

## Number

Current 46elks fixed voice number:

- `+46101385498`

## 46elks dashboard setup

Open the number in 46elks and set:

- `voice_start`: `https://www.nordicemobility.se/api/voice-start`
- Name/label: `Nordic voice fallback`

Save changes, then test with real calls.

## Netlify environment variables

The function has safe defaults for the current workshop setup, but these env vars can override it later:

- `VOICE_CALLER_ID` - 46elks number shown to Sebastian/Lennart. Default: `+46101385498`.
- `VOICE_SEBASTIAN_PHONE` - Sebastian mobile, configured in Netlify env. No private mobile fallback is stored in the repo.
- `VOICE_LENNART_PHONE` - Lennart mobile, configured in Netlify env. No private mobile fallback is stored in the repo.
- `VOICE_TIMEOUT_SECONDS` - seconds per person. Default: `18`.
- `VOICE_MISSED_SMS_TO` - comma-separated missed-call SMS recipients. Fallback: `WORKSHOP_SMS_TO`, then the public workshop number if nothing else is configured.

Missed-call SMS uses existing 46elks SMS env vars:

- `ELKS_USERNAME`
- `ELKS_PASSWORD`
- `SMS_FROM`

## Test script

1. Save the `voice_start` URL in 46elks.
2. Call `+46101385498` from a non-workshop phone.
3. Let Sebastian answer and confirm the call connects.
4. Call again and let Sebastian ignore it.
5. Confirm Lennart's phone rings and shows the workshop number.
6. Call again and let both ignore it.
7. Confirm the missed-call entry appears in 46elks call history.
8. If SMS env vars are configured, confirm Sebastian receives a missed-call SMS.

## Important operational note

Sebastian and Lennart should save `+46101385498` as `Nordic verkstad` or similar. Then they know every forwarded call is a customer/workshop call.

## Phase 2 ideas

- Add a spoken prompt.
- Add voicemail/recording with GDPR wording.
- Log call attempts into Netlify Blobs or Google Sheets.
- Show missed calls inside `/admin/`.
