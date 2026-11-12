# NEMOB AI Gateway

Central, säker ingång för AI-assistenter (ChatGPT, Claude, Grok …) till
Nordic E-Mobilitys system. Byggd ovanpå befintliga Netlify Functions och
datakällor: inga kopior av kunddata, inget nytt ärendesystem. Första
versionen (2026-11-12) har tre läsverktyg och en testbar
tillgänglighetsstatus. Kod: `netlify/functions/ai-gateway.mjs`,
`_shared/ai-auth.mjs`, `_shared/ai-audit.mjs`, `_shared/ai-tools.mjs`,
`_shared/elks-calls.mjs`, `_shared/presence.mjs`. Tester: `npm run test:ai`.

## Arkitektur

```
AI-klient ──Bearer──▶ /api/ai/mcp  (MCP, JSON-RPC)   ─┐
                      /api/ai/tools/:name (REST)      ├─▶ auth → scope → rate limit → validering → verktyg → revisionslogg
                      /api/ai/oauth/token (OAuth CC)  ─┘
Verktyg läser: workshop-cases (Blobs), 46elks /a1/calls (paginerat), godkännandekön (/api/approvals-logik), presence (Blobs)
```

- **Ingen ADMIN_TOKEN utåt.** Varje AI-klient har egen identitet, egen
  hemlighet och egna scopes. Servern lagrar bara SHA-256-hashen.
- **Fail-closed.** Saknas klientregistret svarar allt 503. Fel nyckel 401.
  Saknat scope 403. Över gränsen 429. Argumentfel 400.
- **Revisionslogg** (`ai-gateway-audit`, 180 dagar): klient, sätt, verktyg,
  maskerade argument, utfall, antal, tid. Aldrig hemligheter, aldrig
  kunddata ur svaren.
- **Rate limit** per klient och minut (`rpm` i klientposten, standard 60).
- **Privat/LVU-material** finns inte i Netlify-lagringen och nås aldrig
  härifrån. Ärendesvaren är en fältvitlista (inga anteckningar, media,
  verkstadskommentarer, kuponger).

## Miljövariabler (Netlify, server-side)

| Variabel | Innehåll |
|---|---|
| `AI_GATEWAY_CLIENTS` | JSON-array med klienter: `[{ "id": "claude", "label": "Claude Desktop", "secretHash": "sha256:…", "scopes": ["cases:read", …], "rpm": 60 }]` |
| `AI_GATEWAY_SIGNING_SECRET` | lång slumpsträng; signerar OAuth-åtkomsttoken (60 min) |
| `PRESENCE_ROUTING_ENABLED` | **sätts inte än.** När den är `1` efter separat godkännande får telefonroutingen följa presence |

Skapa en klient lokalt (skriver inget till servern):

```bash
node scripts/ai-gateway-client.mjs claude "Claude Desktop" --scopes cases:read,calls:read,overview:read,presence:read,presence:write
```

Skriptet skriver ut JSON-posten (till `AI_GATEWAY_CLIENTS`) och API-nyckeln
`claude.<secret>` en enda gång.

## Scopes

| Scope | Ger |
|---|---|
| `cases:read` | `search_customer` |
| `calls:read` | `search_calls` |
| `overview:read` | `get_business_overview` |
| `presence:read` | `get_presence` |
| `presence:write` | `set_presence` |
| `admin:propose` | reserverat: föreslå godkännandepliktiga åtgärder (inget verktyg än) |

Rekommenderad fördelning: assistenter som Sebastian använder själv får alla
fem första; en ren rapportklient får bara `overview:read`.

## Autentisering

**API-nyckel (rekommenderas där klienten kan sätta header):**
`Authorization: Bearer <client_id>.<secret>`.

**OAuth 2.0 client credentials:** `POST /api/ai/oauth/token`
(`application/x-www-form-urlencoded` eller JSON, alternativt HTTP Basic):
`grant_type=client_credentials&client_id=…&client_secret=…&scope=cases:read calls:read`
→ `{ access_token, token_type: "Bearer", expires_in: 3600, scope }`.
Token kan bara få en delmängd av klientens scopes.

**Stöds inte än:** OAuth authorization code med dynamisk klientregistrering
(det claude.ai:s och ChatGPT:s inbyggda "connectors" kräver). Se
kontobegränsningar nedan. `/api/ai/.well-known` visar vad som stöds.

## Verktyg (kontrakt)

Alla svar är JSON med `status: "ok" | "not_configured" | "failed" | "invalid" | "rejected" | "partial"`.

### `search_calls` — scope `calls:read`
In: `{ phone?, from?, to?, direction?: "incoming"|"outgoing"|"all", limit?: 1–200 }`.
Fönster: standard 30 dagar, max 90. Hämtar 46elks `/a1/calls` sida för sida
(`next` → `?start=`), filtrerar på nummer (matchar uppringare och uppringd).
Ut: `{ window, filter, summary: { total, incoming, outgoing, answered, missed, voicemail, nova, byDay }, calls: [ { id, at, direction, from, to, durationSec, outcome, outcomeLabel, hasRecording, legs } ], truncated, pagesFetched }`.
`outcome`: `missed | noanswer | answered | sebastian | workshop | nova | voicemail`.

### `search_customer` — scope `cases:read`
In: `{ query (≥2 tecken), onlyOpen?, limit?: 1–50 }`. Träffar på telefon (slutsiffror),
namn, e-post, modell/märke, tjänst, serviceNumber eller ärende-id.
Ut: `{ query, total, cases: [ { id, serviceNumber, status, open, service, vehicle, customer { name, phone, email }, source, bookingMode, bookingRequest, preferredDate, payment { status, amount }, estimatedValue, lastInboundAt, lastTimeline[3], createdAt, updatedAt } ], truncated }`.

### `get_business_overview` — scope `overview:read`
In: `{ days?: 1–30 }`. Ut: `{ approvals: { counts, partial, items[≤15] }, cases: { open, byStatus, readyForPickup, waitingCustomer, unanswered }, upcomingBookings: { days, count, items }, priorityCases[≤10], presence, note }`.
Godkännanden utförs i NEMOB OS/admin – aldrig via gatewayen.

### `get_presence` — scope `presence:read`
Ut: `{ presence: { status, label, until, remainingMinutes, note, setBy, setAt, routing: { mode, plan, applied, dryRun }, recentHistory }, autoReset, routingEnabled, statuses }`.

### `set_presence` — scope `presence:write`
In: `{ status: available_workshop | nova_only | unavailable, untilMinutes?: 1–10080, until?: ISO, note? }`.
`nova_only` och `unavailable` **kräver** sluttid. Skrivningen är versionerad
(etag), historiken (max 50) loggar varje ändring med vem/när/från-till, och
en passerad sluttid återställer automatiskt till `available_workshop` vid
nästa läsning eller skrivning (`by: "auto_reset"`).
Ut: `{ previous, routingApplied: false, dryRun, presence }`.
**Routing:** `routing.plan` beskriver avsedd koppling; den faktiska
telefonroutingen (voice-simple) ändras inte förrän `PRESENCE_ROUTING_ENABLED`
sätts efter ett separat uppdrag med testad fallback. Tills dess är allt
dry-run och verifierbart i historiken.

## MCP

Endpoint `POST /api/ai/mcp`, Streamable HTTP utan SSE (GET ger 405),
protokollversion `2025-03-26`. Metoder: `initialize`, `notifications/initialized`,
`ping`, `tools/list` (bara verktyg klienten har scope för), `tools/call`
(`structuredContent` + text). Batch stöds. Fel: `-32601` okänd metod,
`-32602` okänt verktyg/argumentfel, `-32603` internt; saknat scope och rate
limit returneras som `isError: true` i resultatet så att assistenten kan
förklara för användaren.

## Anslutning per assistent

### Claude
- **Claude Code** (MCP, rekommenderas): `claude mcp add --transport http nemob https://www.nordicemobility.se/api/ai/mcp --header "Authorization: Bearer claude.<secret>"`.
- **Claude Desktop**: samma HTTP-MCP med header i konfigurationen (`mcpServers.nemob.url` + `headers.Authorization`), stöds i aktuella versioner.
- **claude.ai (webb/mobil) "Custom connectors"**: kräver OAuth authorization code med dynamisk registrering – **stöds inte i v1**. Sebastian kan tills vidare använda Claude Desktop/Code, eller så bygger vi auth-code-flödet som nästa steg.

### ChatGPT
- **Custom GPT med Actions**: importera `https://www.nordicemobility.se/api/ai/openapi.json`, autentisering "API Key" → Auth type **Bearer**, nyckel `chatgpt.<secret>`. Alla fem verktyg blir operationer. Kräver ChatGPT Plus/Team/Enterprise för att skapa GPT:er.
- **ChatGPT MCP-connectors (Developer mode)**: kräver OAuth eller oautentiserad server; oautentiserad MCP publiceras aldrig, så vänta på auth-code-flödet.

### Grok
- Ingen allmän MCP- eller Actions-anslutning för konsumentkonton vid skrivande stund (verifiera mot xAI:s aktuella dokumentation). Om xAI:s API med funktionsanrop används i egen klient: anropa REST-verktygen med Bearer-nyckel. Behandlas som "kontobegränsning" tills vidare.

### Egna skript och NEMOB OS
REST: `POST /api/ai/tools/<namn>` med JSON-body och Bearer-nyckel; `GET /api/ai/whoami` för att verifiera identitet och scopes.

## Verifiering efter deploy (läsande, inga kunddata ändras)

1. Sätt `AI_GATEWAY_CLIENTS` (minst en klient) och `AI_GATEWAY_SIGNING_SECRET` i Netlify. Före det svarar gatewayen 503 – avsiktligt.
2. `GET /api/ai/.well-known` → 200 (publik metadata). `GET /api/ai/tools` utan header → 401.
3. `GET /api/ai/whoami` med nyckel → klient och scopes.
4. `POST /api/ai/tools/get_presence` `{}` → `presence.status: available_workshop`, `routing.dryRun: true`.
5. `POST /api/ai/tools/search_calls` `{ "from": "<i går>" }` → `status: ok`, `pagesFetched ≥ 1`.
6. `POST /api/ai/tools/search_customer` `{ "query": "<känt testärende>" }` → vitlistade fält.
7. Kontrollera att `ai-gateway-audit` fått en rad per anrop (Netlify Blobs UI eller funktionsloggen `ai_gateway_call`).

## Risker och gränser

- **Ingen auth-code-OAuth än** → claude.ai- och ChatGPT-connectors kan inte ansluta; Claude Desktop/Code och ChatGPT Actions kan. Nästa steg om Sebastian vill ha mobilen: auth-code-flöde med PKCE och server-lagrade klienter.
- **API-nyckeln är långlivad.** Rotera genom att skapa en ny klientpost och ta bort den gamla; `disabled: true` stänger av direkt.
- **46elks-läsning** kostar en sida per 100 samtal (max 30 sidor/anrop). 90-dagarsfönstret är taket.
- **search_customer läser alla ärenden** (378 i dag, ~12 s i värsta fall på kall start). Ett index är nästa optimering, samma som för `/api/approvals`.
- **Presence styr inte telefonin** förrän separat godkänt – svaren säger det uttryckligen (`dryRun`).
- **Rate limit-räknaren** faller öppen vid lagringsfel (anropet släpps igenom och felet loggas) – medvetet val: skyddet mot missbruk får inte stoppa verksamheten.
- Gatewayen gör aldrig kundutskick och utför aldrig godkännanden.
