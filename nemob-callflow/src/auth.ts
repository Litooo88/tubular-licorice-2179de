import type { Env } from "./types";

function ipToInt(ip: string): number | null {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return parts.reduce((acc, part) => (acc << 8) + part, 0) >>> 0;
}

function ipInCidr(ip: string, cidr: string): boolean {
  const [rangeIp, bitsText] = cidr.trim().split("/");
  const ipInt = ipToInt(ip);
  const rangeInt = ipToInt(rangeIp);
  const bits = bitsText ? Number(bitsText) : 32;
  if (ipInt === null || rangeInt === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

export function ipAllowed(req: Request, env: Env): boolean {
  const allowlist = (env.ELKS_ALLOWED_IPS || "").split(",").map((item) => item.trim()).filter(Boolean);
  if (allowlist.length === 0) return true;
  const ip = req.headers.get("CF-Connecting-IP") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "";
  return allowlist.some((range) => {
    if (range.includes(":")) return ip.toLowerCase() === range.toLowerCase();
    return ipInCidr(ip, range);
  });
}

async function hmacSha256(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  const max = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let index = 0; index < max; index += 1) {
    diff |= (left[index] || 0) ^ (right[index] || 0);
  }
  return diff === 0;
}

export async function validateRequest(req: Request, env: Env, body: string): Promise<boolean> {
  if (!ipAllowed(req, env)) return false;
  if ((env.REQUIRE_ELKS_SIGNATURE || "false").toLowerCase() !== "true") return true;
  const secret = env.ELKS_WEBHOOK_SECRET || "";
  const provided = req.headers.get("x-elks-signature") || req.headers.get("x-nemob-signature") || "";
  if (!secret || !provided) return false;
  const expected = await hmacSha256(secret, body);
  return constantTimeEqual(provided.replace(/^sha256=/, ""), expected);
}
