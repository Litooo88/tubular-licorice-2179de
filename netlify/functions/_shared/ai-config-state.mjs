// Aktiv konfiguration för AI Gateway (utan beroenden – importeras av ai-auth,
// ai-oauth och ai-audit). Värdena kommer antingen från miljövariabler (om
// AI_GATEWAY_CLIENTS är satt) eller från storen "ai-gateway-config" som
// ai-config.mjs läser in med `ensureGatewayConfig()` i början av varje anrop.
//
// Bakgrund (2026-11-12): när gatewayens tre variabler lades till i Netlify
// föll alla deployer i uppladdningen av de gamla v1-funktionerna (HTTP 400) –
// Lambdas 4 KB-gräns för miljövariabler. Konfigurationen lever därför i
// Blobs och sätts via POST /api/ai/config med admin-token; inga nya
// miljövariabler krävs.

const env = (name) => {
  try {
    return globalThis.Netlify?.env?.get?.(name) || process.env[name] || "";
  } catch {
    return process.env[name] || "";
  }
};
const clean = (value, max = 400) => String(value ?? "").trim().slice(0, max);

export const envConfig = () => ({
  source: "env",
  clientsRaw: clean(env("AI_GATEWAY_CLIENTS"), 50000),
  signingSecret: clean(env("AI_GATEWAY_SIGNING_SECRET")),
  ownerSecret: clean(env("AI_GATEWAY_OWNER_SECRET")), // klartext bara via env
  ownerSecretHash: "",
  oauthScopes: clean(env("AI_GATEWAY_OAUTH_SCOPES")),
});

let active = null;
// Sätts av ai-config.mjs efter läsning från Blobs. null = använd env.
export const setActiveConfig = (config) => { active = config; };
export const activeConfig = () => {
  const fromEnv = envConfig();
  if (fromEnv.clientsRaw) return fromEnv; // env har företräde (lokal utveckling, tester)
  return active || fromEnv;
};
