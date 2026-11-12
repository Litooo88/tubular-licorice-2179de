// Klientauth för AI Gateway: register, API-nyckel, client-credentials-token, scopes, utgång.
import assert from "node:assert/strict";
import test from "node:test";

import { authenticate, hashSecret, hasScope, issueToken, loadClients, newSecret, verifyApiKey, verifyToken, ALL_SCOPES } from "../netlify/functions/_shared/ai-auth.mjs";

const secret = newSecret();
const registry = JSON.stringify([
  { id: "claude", label: "Claude Desktop", secretHash: hashSecret(secret), scopes: ["cases:read", "calls:read", "overview:read", "presence:read"], rpm: 30 },
  { id: "ops", secretHash: hashSecret("ops-secret"), scopes: ["presence:write", "presence:read"] },
  { id: "trasig", secretHash: "inte-en-hash", scopes: ["cases:read"] },
  { id: "av", secretHash: hashSecret("x"), scopes: ["cases:read"], disabled: true },
]);
const req = (auth) => new Request("https://x/api/ai/tools", { headers: auth ? { Authorization: auth } : {} });

test("loadClients: validerar poster, okända scopes filtreras, trasig hash ignoreras", () => {
  const loaded = loadClients(registry);
  assert.equal(loaded.ok, true);
  assert.deepEqual(loaded.clients.map((c) => c.id), ["claude", "ops", "av"]);
  assert.equal(loaded.clients[0].rpm, 30);
  assert.equal(loadClients("").ok, false);
  assert.equal(loadClients("{inte json").ok, false);
  assert.equal(loadClients(JSON.stringify([{ id: "x", secretHash: hashSecret("s"), scopes: ["cases:read", "hitta-på"] }])).clients[0].scopes.length, 1);
  assert.ok(ALL_SCOPES.includes("admin:propose"));
});

test("verifyApiKey: rätt hemlighet ger klienten, fel/avstängd/okänd ger null, tidssäkert format", () => {
  const { clients } = loadClients(registry);
  assert.equal(verifyApiKey(clients, `claude.${secret}`)?.id, "claude");
  assert.equal(verifyApiKey(clients, "claude.fel"), null);
  assert.equal(verifyApiKey(clients, `okand.${secret}`), null);
  assert.equal(verifyApiKey(clients, "av.x"), null, "avstängd klient");
  assert.equal(verifyApiKey(clients, "utan-punkt"), null);
  assert.equal(verifyApiKey(clients, ""), null);
});

test("authenticate: 503 utan register, 401 utan/med fel Bearer, principal med scopes", () => {
  const { clients } = loadClients(registry);
  assert.equal(authenticate(req(`Bearer claude.${secret}`), { clients: [] }).status, 503);
  assert.equal(authenticate(req(""), { clients }).status, 401);
  assert.equal(authenticate(req("Basic abc"), { clients }).status, 401);
  assert.equal(authenticate(req("Bearer claude.nej"), { clients }).status, 401);
  const ok = authenticate(req(`Bearer claude.${secret}`), { clients });
  assert.equal(ok.ok, true);
  assert.equal(ok.principal.via, "api_key");
  assert.equal(hasScope(ok.principal, "cases:read"), true);
  assert.equal(hasScope(ok.principal, "presence:write"), false);
});

test("OAuth client credentials: token med delmängd av scopes, verifiering, utgång, manipulering", () => {
  const { clients } = loadClients(registry);
  const client = clients[0];
  const signing = "test-signing-secret";
  const now = Date.parse("2026-11-12T10:00:00Z");
  const issued = issueToken({ client, scopes: ["cases:read", "presence:write"], now, secret: signing });
  assert.equal(issued.ok, true);
  assert.equal(issued.scope, "cases:read", "presence:write är inte tillåtet för klienten och faller bort");
  assert.equal(issued.expires_in, 3600);
  const verified = verifyToken(issued.access_token, { clients, now: now + 1000, secret: signing });
  assert.equal(verified.client.id, "claude");
  assert.deepEqual(verified.scopes, ["cases:read"]);
  assert.equal(verifyToken(issued.access_token, { clients, now: now + 3601 * 1000, secret: signing }), null, "utgången");
  assert.equal(verifyToken(issued.access_token, { clients, now, secret: "annan-nyckel" }), null, "fel signeringsnyckel");
  const [p, body, sig] = issued.access_token.split(".");
  const tampered = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), scp: ["presence:write"] })).toString("base64url");
  assert.equal(verifyToken(`${p}.${tampered}.${sig}`, { clients, now, secret: signing }), null, "manipulerad payload");
  assert.equal(issueToken({ client, scopes: ["presence:write"], now, secret: signing }).error, "invalid_scope");
  assert.equal(issueToken({ client, now, secret: "" }).error, "server_error");
  // Hela tokenen fungerar som Bearer via authenticate.
  const old = process.env.AI_GATEWAY_SIGNING_SECRET;
  process.env.AI_GATEWAY_SIGNING_SECRET = signing;
  try {
    const auth = authenticate(req(`Bearer ${issued.access_token}`), { clients, now: now + 5000 });
    assert.equal(auth.ok, true);
    assert.equal(auth.principal.via, "oauth_token");
  } finally {
    if (old === undefined) delete process.env.AI_GATEWAY_SIGNING_SECRET; else process.env.AI_GATEWAY_SIGNING_SECRET = old;
  }
});
