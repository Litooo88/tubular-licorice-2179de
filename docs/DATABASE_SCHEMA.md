# Database Schema

## Nuläge

Ops-systemet använder idag huvudsakligen schemalösa JSON-dokument i Netlify
Blobs. Det finns ingen `storage.ts`, ingen Supabase-databas och inga
databasmigrationer för workshop-cases.

Separata Cloudflare Worker-delen har en D1-migration:
`nemob-callflow/migrations/0001_init.sql`, som skapar `call_log`.

## Mål

Planerad målplattform är Supabase/Postgres eller motsvarande relationsdatabas.
Alla schemaändringar ska göras med versionshanterade migrationer. RLS ska
skydda kunddata och operativa actions.

## Planerade tabeller

### customers

- `id uuid primary key`
- `name text`
- `phone_e164 text`
- `email text`
- `preferred_contact text`
- `consent_metadata jsonb`
- `created_at`, `updated_at`

Index på normaliserat telefonnummer och e-post.

### service_cases

- `id uuid primary key`
- `customer_id uuid references customers`
- `status text`
- `source`, `channel`, `priority`
- `service_type`, `vehicle_model`, `problem_description`
- `assigned_to`, `preferred_date`, `intake_at`, `promised_at`
- `estimated_value`, `approved_amount`, `final_amount`
- `created_at`, `updated_at`, `closed_at`

Status ska följa `docs/ADMIN_WORKFLOW.md`.

### case_events

- `id uuid primary key`
- `service_case_id uuid references service_cases`
- `event_type text`
- `actor_type text`
- `actor_id text`
- `payload jsonb`
- `created_at`

Append-only audit trail för status, kontakt, godkännande och viktiga actions.

### sms_drafts

- `id uuid primary key`
- `service_case_id uuid references service_cases`
- `direction text`
- `recipient_phone_e164 text`
- `body text`
- `status text`
- `risk_level text`
- `requires_approval boolean`
- `approved_by`, `approved_at`, `sent_at`
- `provider_message_id text`
- `created_at`

### call_logs

- `id uuid primary key`
- `provider_call_id text unique`
- `customer_id uuid nullable`
- `service_case_id uuid nullable`
- `caller_e164 text`
- `status`, `route`, `answered_by`
- `duration_seconds integer`
- `recording_url text nullable`
- `occurred_at`, `created_at`

### part_needs

- `id uuid primary key`
- `service_case_id uuid references service_cases`
- `part_name`, `part_number`, `supplier`
- `quantity integer`
- `estimated_cost numeric`
- `status text`
- `requires_approval boolean`
- `approved_by`, `approved_at`
- `ordered_at`, `received_at`

Köp över 500 kr kräver alltid godkännande.

### price_rules

- `id uuid primary key`
- `sku text unique`
- `category`, `name`, `unit`
- `price numeric`
- `vat_rate numeric`
- `active boolean`
- `conditions jsonb`
- `fortnox_article_number text`
- `valid_from`, `valid_to`, `updated_at`

### ai_recommendations

- `id uuid primary key`
- `service_case_id uuid nullable`
- `kind text`
- `risk_level text`
- `input_refs jsonb`
- `recommendation jsonb`
- `requires_approval boolean`
- `status text`
- `reviewed_by`, `reviewed_at`
- `created_at`

AI-resultat ska vara spårbara och aldrig vara auktoritativ ärendedata.

### payments

- `id uuid primary key`
- `service_case_id uuid references service_cases`
- `amount numeric`
- `currency text default 'SEK'`
- `method text`
- `status text`
- `provider`, `provider_reference`
- `verified_by`, `verified_at`
- `created_at`, `updated_at`

Betald status får endast sättas efter verifiering.

## Relationer

- En kund kan ha flera serviceärenden.
- Ett serviceärende kan ha många events, SMS-utkast, reservdelsbehov,
  AI-rekommendationer och betalningar.
- Samtalsloggar kan kopplas till kund och/eller ärende efter matchning.

## Migreringsregler

- Ändra inte Blob-dokument och relationsschema samtidigt utan dual-write eller
  tydlig cutover-plan.
- Migrera statusar med explicit mappning från nuvarande värden.
- Bevara original-ID och timeline vid import.
- Verifiera antal, totalsummor och relationer före borttagning av gammal data.
- Lägg alla nya integrationer i dry-run tills auth, RLS och audit-logg är
  verifierade.
