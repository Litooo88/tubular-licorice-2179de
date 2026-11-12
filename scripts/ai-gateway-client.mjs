#!/usr/bin/env node
// Skapar en klientpost för NEMOB AI Gateway (körs lokalt, skriver inget till servern).
//
//   node scripts/ai-gateway-client.mjs <id> [label] --scopes cases:read,calls:read,...
//
// Skriver ut (1) JSON-posten att lägga i env AI_GATEWAY_CLIENTS i Netlify och
// (2) API-nyckeln `<id>.<secret>` EN gång. Hemligheten sparas aldrig i repot;
// servern får bara SHA-256-hashen. Tappas nyckeln: skapa en ny post.
import { hashSecret, newSecret, ALL_SCOPES } from "../netlify/functions/_shared/ai-auth.mjs";

const args = process.argv.slice(2);
const id = String(args[0] || "").replace(/[^A-Za-z0-9_-]/g, "");
if (!id) {
  console.error("Användning: node scripts/ai-gateway-client.mjs <id> [label] --scopes a,b,c");
  console.error(`Scopes: ${ALL_SCOPES.join(", ")}`);
  process.exit(1);
}
const scopeFlag = args.indexOf("--scopes");
const scopes = (scopeFlag >= 0 ? String(args[scopeFlag + 1] || "") : "cases:read,calls:read,overview:read,presence:read").split(",").map((s) => s.trim()).filter((s) => ALL_SCOPES.includes(s));
const label = args.slice(1).filter((a, i) => !(scopeFlag >= 0 && (i + 1 === scopeFlag || i + 1 === scopeFlag + 1))).join(" ").trim();
const secret = newSecret();
const entry = { id, label: label || id, secretHash: hashSecret(secret), scopes, rpm: 60 };
console.log("\n1) Lägg till i AI_GATEWAY_CLIENTS (JSON-array) i Netlify → Environment variables:\n");
console.log(JSON.stringify(entry));
console.log("\n2) API-nyckel till klienten (visas bara nu, lagra i klientens hemlighetsfält):\n");
console.log(`${id}.${secret}`);
console.log("\nAnvänd som header: Authorization: Bearer <nyckeln ovan>");
console.log("Sätt också AI_GATEWAY_SIGNING_SECRET (valfri lång slumpsträng) för OAuth-token.\n");
