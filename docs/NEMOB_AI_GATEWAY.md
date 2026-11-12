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
  utfall, antal, tid. Argument lagras utan personuppgifter: telefonliknande
  fält maskeras (`070…233`), fritext (`query`, `note` …) lagras bara som
  `{ kind, len, hash }`, och IP lagras som HMAC-hash med dagssalt
  (`ipHash`), aldrig som adress. Aldrig hemligheter, aldrig kunddata ur svaren.
- **Rate limit** per klient och minut (`rpm` i klientposten, standard 60).
  **Fail-closed:** går räknaren inte att nå, eller ger den versionerade
  uppdateringen ett misslyckat resultat (`storage_error`, `unversioned`,
  `conflict` efter omförsök, overifierat skapande), nekas anropet med
  `503 rate_limit_unavailable` – en externt nåbar gateway med kunddata får
  aldrig bli obegränsad. Svaret bär `reason` i loggen.
- **Privat/LVU-material** finns inte i Netlify-lagringen och nås aldrig
  härifrån. Ärendesvaren är en fältvitlista (inga anteckningar, media,
  verkstadskommentarer, kuponger).

## Konfiguration (Blobs via admin-token – rekommenderat)

**Varför inte miljövariabler:** när gatewayens tre variabler lades till i
Netlify (2026-11-12) föll alla deployer i uppladdningen av de gamla
v1-funktionerna (HTTP 400). Orsaken är Lambdas 4 KB-gräns för miljö-
variabler; sajten ligger redan nära taket (Google-nyckel, Stripe m.m.).
Konfigurationen lever därför i storen `ai-gateway-config` och sätts med
företagets admin-token server-till-server (Sebastian eller NEMOB OS, aldrig
en AI-klient):

```
GET  /api/ai/config            (x-admin-token) → status utan hemligheter: { source, clients[], ready, oauthReady, hasSigningSecret, hasOwnerSecret, oauthScopes }
POST /api/ai/config            (x-admin-token) → { clients?, ownerPin?, signingSecret?, oauthScopes? }
  clients:       hela listan (ersätter): [ { id, label?, secretHash | secret, scopes[], rpm?, disabled? } ]
                 (`secret` hashas av servern; `node scripts/ai-gateway-client.mjs` ger färdiga poster)
  ownerPin:      ägar-PIN ≥ 12 tecken, lagras bara som SHA-256-hash
  signingSecret: "generate" (rekommenderat) eller egen sträng ≥ 32 tecken
  oauthScopes:   tak för dynamiska klienter, standard alla fem
```

Ändringar slår igenom direkt (cache 60 s per funktionsinstans), ingen deploy
behövs. Miljövariablerna nedan fungerar fortfarande som alternativ för lokal
utveckling och tester och har då företräde.

## Miljövariabler (alternativ, lokal utveckling)

| Variabel | Innehåll |
|---|---|
| `AI_GATEWAY_CLIENTS` | JSON-array med klienter: `[{ "id": "claude", "label": "Claude Desktop", "secretHash": "sha256:…", "scopes": ["cases:read", …], "rpm": 60 }]` |
| `AI_GATEWAY_SIGNING_SECRET` | lång slumpsträng; signerar OAuth-åtkomsttoken (60 min) |
| `PRESENCE_ROUTING_ENABLED` | **sätts inte än.** När den är `1` efter separat godkännande får telefonroutingen följa presence |
| `AI_GATEWAY_OWNER_SECRET` | ägar-PIN för OAuth-samtycket (bara Sebastian). Utan den är authorization-code-flödet avstängt |
| `AI_GATEWAY_OAUTH_SCOPES` | valfritt tak för vad dynamiska klienter kan få (mellanslagsseparerat); standard alla fem |

Skapa en klient lokalt (skriver inget till servern; posten läggs i `POST /api/ai/config` eller i env):

```bash
node scripts/ai-gateway-client.mjs claude "Claude Desktop" --scopes cases:read,calls:read,overview:read,presence:read,presence:write
```

Skriptet skriver ut JSON-posten (till `AI_GATEWAY_CLIENTS`) och API-nyckeln
`claude.<secret>` en enda gång.

## Behörighetsmodell (scopes)

Varje scope ger exakt den information och de åtgärder som behövs – inte mer:

| Scope | Verktyg | Vad som syns / kan göras |
|---|---|---|
| `overview:read` | `get_business_overview` | Lägesbild: antal godkännanden per slag, ärenden per status, ärendenummer, tjänst, fordon, tider, betalstatus. **Inga kundnamn, telefonnummer, e-post eller meddelandetexter.** Svaret har `redacted: true`. |
| `cases:read` | `search_customer`, och fullt kundkort i `get_business_overview` | Vitlistade ärendefält inkl. kontaktuppgifter. Aldrig anteckningar, media, verkstadskommentarer, kuponger. |
| `calls:read` | `search_calls` | 46elks-samtal med nummer, tider, utfall. |
| `presence:read` | `get_presence`, presence-delen av översikten | Tillgänglighet och routingplan. Utan scopet: `presence: null`, `presenceOmitted: true`. |
| `presence:write` | `set_presence` | Ändra tillgänglighet (dry-run tills routing är aktiverad). |
| `admin:propose` | – | Reserverat: föreslå godkännandepliktiga åtgärder. Inget verktyg än. |

Rekommenderad fördelning: assistenter som Sebastian använder själv får
`cases:read calls:read overview:read presence:read presence:write`; en ren
rapportklient får bara `overview:read`. Testerna verifierar att en
`overview:read`-klient aldrig får namn, nummer, e-post eller kundtext.

## Autentisering

**API-nyckel (rekommenderas där klienten kan sätta header):**
`Authorization: Bearer <client_id>.<secret>`.

**OAuth 2.0 client credentials:** `POST /api/ai/oauth/token`
(`application/x-www-form-urlencoded` eller JSON, alternativt HTTP Basic):
`grant_type=client_credentials&client_id=…&client_secret=…&scope=cases:read calls:read`
→ `{ access_token, token_type: "Bearer", expires_in: 3600, scope }`.
Token kan bara få en delmängd av klientens scopes.

**OAuth 2.1 authorization code + PKCE + dynamisk klientregistrering** (nytt
2026-11-12, `_shared/ai-oauth.mjs`) – det ChatGPT:s och claude.ai:s
inbyggda MCP-connectors kräver:

1. Klienten läser `/.well-known/oauth-protected-resource` (RFC 9728) och
   `/.well-known/oauth-authorization-server` (RFC 8414); 401-svar bär
   `WWW-Authenticate: Bearer resource_metadata=…`.
2. `POST /api/ai/oauth/register` (RFC 7591): publik klient, bara https- eller
   localhost-redirects, `token_endpoint_auth_method: none`. En dynamisk
   klient har **inga** scopes förrän ägaren ger dem.
3. `GET /api/ai/oauth/authorize`: samtyckessida där **ägaren** anger ägar-PIN
   (env `AI_GATEWAY_OWNER_SECRET`, aldrig ADMIN_TOKEN) och bockar för scopes.
   Taket sätts av env `AI_GATEWAY_OAUTH_SCOPES` (standard alla fem). PKCE S256
   är obligatoriskt; `plain` avvisas. Samtyckesförsök är frekvensbegränsade
   per IP-hash (10/min).
4. `POST /api/ai/oauth/token` med `grant_type=authorization_code` +
   `code_verifier` → åtkomsttoken (60 min) + refresh token (30 dagar,
   roteras vid varje användning, gammal återkallas). Koden förbrukas
   versionerat FÖRE utfärdande och bränns även vid ett misslyckat byte; går
   markeringen inte att spara utfärdas inget. `grant_type=refresh_token`
   förnyar i fail-closed-ordning: den gamla tokenen återkallas versionerat
   först, sedan skapas den nya, sedan utfärdas åtkomsttoken. Ett lagringsfel
   kan därför aldrig lämna en återanvändbar refresh token (hotfix 2026-11-12).
6. **Återkallelse:** `POST /api/ai/oauth/clients` med
   `{ action: "list" | "revoke", owner_pin, client_id?, reason? }` (ägar-PIN,
   aldrig Bearer). En återkallad klient nekas refresh och nya koder direkt,
   och dess åtkomsttoken avvisas vid nästa anrop (401) trots giltig signatur.
5. Tokenens `sub` är `oauth:<client_id>`; scopes är de ägaren godkände.
   Revisionsloggen visar `via: oauth_code`.

Utan `AI_GATEWAY_OWNER_SECRET` svarar samtyckessidan 503 – flödet är avstängt.
`/api/ai/.well-known` visar vad som stöds.

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

### ChatGPT – vanlig konversation via MCP-connector (prioriterad väg)
ChatGPT:s aktuella integrationsväg för egna servrar är **MCP-connectors**
("Apps & Connectors", Developer mode), inte de äldre Custom GPT Actions.
Connectorn kräver OAuth authorization code med dynamisk registrering eller
en oautentiserad server – gatewayen stöder nu det förra och publiceras
aldrig oautentiserad.

1. ChatGPT → Settings → Apps & Connectors → aktivera **Developer mode**
   (kräver Plus/Pro, eller Team/Enterprise/Edu där en arbetsytans admin
   måste tillåta connectors och Developer mode). Gratiskonton kan inte.
2. "Create" → namn `NEMOB`, MCP-server-URL
   `https://www.nordicemobility.se/api/ai/mcp`, autentisering **OAuth**.
   ChatGPT registrerar sig själv (`/api/ai/oauth/register`) och öppnar
   samtyckessidan.
3. Sebastian anger ägar-PIN och bockar för scopes. Efter redirect är
   connectorn klar; verktygen syns i konversationen ("Använd NEMOB: hur
   många missade samtal i går?").
4. Token förnyas automatiskt via refresh token (30 dagar rullande). Byt
   ägar-PIN eller ta bort connectorn i ChatGPT för att återkalla.

Kontobegränsningar: Developer mode och connectors är en konto-/arbetsyte-
inställning hos OpenAI och kan ändras; ChatGPT-appen för mobil använder
samma connectors när de väl är skapade på webben. Custom GPT Actions
(OpenAPI + API-nyckel) finns kvar som reservväg men är inte målbilden.

### Claude
- **claude.ai (webb/mobil) "Custom connectors"** (Pro/Max/Team/Enterprise):
  Settings → Connectors → Add custom connector → URL
  `https://www.nordicemobility.se/api/ai/mcp`. Samma OAuth-flöde som för
  ChatGPT (dynamisk registrering + ägar-PIN).
- **Claude Code**: `claude mcp add --transport http nemob https://www.nordicemobility.se/api/ai/mcp --header "Authorization: Bearer claude.<secret>"` (API-nyckel) eller utan header för OAuth.
- **Claude Desktop**: HTTP-MCP i konfigurationen, med header (API-nyckel) eller OAuth.

### Grok
- Ingen allmän MCP- eller Actions-anslutning för konsumentkonton vid skrivande stund (verifiera mot xAI:s aktuella dokumentation). Om xAI:s API med funktionsanrop används i egen klient: anropa REST-verktygen med Bearer-nyckel. Behandlas som "kontobegränsning" tills vidare.

### Egna skript och NEMOB OS
REST: `POST /api/ai/tools/<namn>` med JSON-body och Bearer-nyckel; `GET /api/ai/whoami` för att verifiera identitet och scopes.

## Verifiering efter deploy (läsande, inga kunddata ändras)

1. `POST /api/ai/config` med admin-token: klienter, `signingSecret: "generate"`, `ownerPin`. Före det svarar gatewayen 503 – avsiktligt. Kontrollera `GET /api/ai/config` → `ready: true`, `oauthReady: true`.
2. `GET /api/ai/.well-known` → 200 (publik metadata). `GET /api/ai/tools` utan header → 401.
3. `GET /api/ai/whoami` med nyckel → klient och scopes.
4. `POST /api/ai/tools/get_presence` `{}` → `presence.status: available_workshop`, `routing.dryRun: true`.
5. `POST /api/ai/tools/search_calls` `{ "from": "<i går>" }` → `status: ok`, `pagesFetched ≥ 1`.
6. `POST /api/ai/tools/search_customer` `{ "query": "<känt testärende>" }` → vitlistade fält.
7. Kontrollera att `ai-gateway-audit` fått en rad per anrop (Netlify Blobs UI eller funktionsloggen `ai_gateway_call`).

## Risker och gränser

- **OAuth-samtycket skyddas bara av ägar-PIN:en.** Välj en lång PIN, byt den om en enhet tappas; samtyckesförsök är begränsade till 10/min per IP-hash och loggas. Refresh tokens lever 30 dagar rullande – ta bort connectorn i klienten för att sluta förnya.
- **Dynamiska klienter är publika** (ingen klienthemlighet, PKCE i stället), vilket är standard för ChatGPT/claude.ai; redirect-URI:er låses vid registreringen till https/localhost.
- **API-nyckeln är långlivad.** Rotera genom att skapa en ny klientpost och ta bort den gamla; `disabled: true` stänger av direkt.
- **46elks-läsning** kostar en sida per 100 samtal (max 30 sidor/anrop). 90-dagarsfönstret är taket.
- **search_customer läser alla ärenden** (378 i dag, ~12 s i värsta fall på kall start). Ett index är nästa optimering, samma som för `/api/approvals`.
- **Presence styr inte telefonin** förrän separat godkänt – svaren säger det uttryckligen (`dryRun`).
- **Rate limit-räknaren** faller stängt vid lagringsfel (503 `rate_limit_unavailable`). Konsekvens: ett Blobs-avbrott stoppar AI-klienterna, inte verksamheten (admin/NEMOB OS berörs inte).
- **`set_presence` rapporterar aldrig applicerad routing.** `routing.applied` blir sant först när telefonikomponenten (framtida uppdrag) skriver `appliedAt`; env-flaggan ensam räcker inte. Verifierat i test med `PRESENCE_ROUTING_ENABLED=1`.
- Gatewayen gör aldrig kundutskick och utför aldrig godkännanden.
