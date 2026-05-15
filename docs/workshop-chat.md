# Workshop chat

Public workshop chat is installed through `/assets/workshop-chat.js`.

## What it does

- Adds a fixed `Chatta med verkstaden` button on public pages.
- Collects topic, message, name, phone, and vehicle/model.
- Sends the message to `POST /api/workshop-chat`.
- Creates a `website_chat` case in the existing Netlify Blobs `workshop-cases` store.
- Sends an internal SMS alert to Lennart and Sebastian through 46elks.
- Assigns battery/electrical/error-code topics to Sebastian and simpler workshop topics to Lennart.
- The SMS alert links directly to `/admin/?case=<case-id>&tab=contact`.
- Admin contact cards include a `Svara på chatt / SMS` box that sends a 46elks SMS reply to the customer.

## Where it is installed

The script tag is included before `</body>` on customer-facing `index.html` pages:

```html
<script src="/assets/workshop-chat.js" defer></script>
```

It is intentionally not installed on `/admin/`, `/workshop/`, `/checkout/`, `/quick-price/`, or `/prices/`.

## Environment variables

The function reuses existing 46elks SMS variables:

- `ELKS_USERNAME` or `SMS_API_USERNAME`
- `ELKS_PASSWORD` or `SMS_API_PASSWORD`
- `SMS_FROM`
- `WORKSHOP_SMS_TO`

Optional chat-specific override:

- `WORKSHOP_CHAT_SMS_TO` - comma/space separated extra recipients for chat alerts.

## Current limitation

This version is a high-converting chat intake and SMS reply flow. Lennart answers by opening the case link from the SMS alert, using the `Svara på chatt / SMS` box in `/admin/`, calling the customer, or using the existing admin SMS tools.

True two-way live messaging inside the widget needs a second step:

- add operator reply UI in admin/workshop
- store chat replies on `case.chat.messages`
- let the widget poll a public thread token for replies
- optionally add browser push notifications for Lennart
