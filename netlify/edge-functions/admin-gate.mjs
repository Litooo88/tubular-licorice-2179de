// Åtkomstgrind för interna driftgränssnitt (webbaudit 2026-07-24, åtgärd 22).
// Kör som Netlify Edge Function FÖRE statisk servering: HTML:en för admin-,
// verkstads- och POS-vyerna lämnas inte ut utan giltig inloggning.
//
// - Samma nyckel som personalen redan använder i verktygen (ADMIN_TOKEN).
// - Cookien innehåller ALDRIG själva token — bara ett SHA-256-fingeravtryck,
//   så en läckt cookie kan inte användas mot API:erna (de kräver rå token).
// - Saknas ADMIN_TOKEN i miljön släpps trafiken igenom som tidigare
//   (not_configured-läge enligt CLAUDE.md) i stället för att låsa ute alla.
//
// Körs i Deno (Edge) — endast webbstandard-API:er, inga Node-moduler.

const COOKIE_NAME = "nemob_admin_gate";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 dagar

const sha256Hex = async (value) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

// Konstanttidsjämförelse av hex-strängar (lika längd garanterad av sha256Hex).
const timingSafeEqualHex = (a, b) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
};

const readCookie = (request) => {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE_NAME) return rest.join("=");
  }
  return "";
};

const loginPage = (message = "") => `<!DOCTYPE html>
<html lang="sv">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>Personalinloggning | Nordic E-Mobility</title>
<style>
body{margin:0;font-family:Inter,Arial,sans-serif;background:#050605;color:#fff;min-height:100vh;display:grid;place-items:center}
.card{width:min(400px,92vw);border:1px solid #28322a;background:#101410;border-radius:10px;padding:28px}
h1{font-size:20px;margin:0 0 6px}
p{color:#aeb8b0;font-size:14px;line-height:1.5;margin:0 0 16px}
input{width:100%;box-sizing:border-box;background:#181d19;border:1px solid #343f36;border-radius:8px;color:#fff;padding:13px 14px;font:inherit;margin-bottom:12px}
input:focus{outline:none;border-color:#00c853}
button{width:100%;min-height:44px;border:0;border-radius:8px;background:#00c853;color:#021006;font:inherit;font-weight:800;cursor:pointer}
.err{color:#ff8a80;font-size:13px;margin:0 0 12px}
.small{color:#6d786f;font-size:12px;margin-top:14px}
</style>
</head>
<body>
<div class="card">
<h1>Personalinloggning</h1>
<p>Den h&auml;r sidan &auml;r intern. Ange verkstadens admin-nyckel f&ouml;r att forts&auml;tta.</p>
${message ? `<p class="err">${message}</p>` : ""}
<form method="POST" autocomplete="off">
<label for="gateToken" style="position:absolute;left:-9999px">Admin-nyckel</label>
<input id="gateToken" name="gate-token" type="password" required placeholder="Admin-nyckel" autofocus>
<button type="submit">Logga in</button>
</form>
<p class="small">&Auml;r du kund? G&aring; till <a href="/" style="color:#7ee2a8">nordicemobility.se</a> eller ring 010-138 54 98.</p>
</div>
</body>
</html>`;

const htmlResponse = (body, status = 200, extraHeaders = {}) =>
  new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      ...extraHeaders,
    },
  });

export default async (request, context) => {
  const adminToken = Netlify.env.get("ADMIN_TOKEN") || "";
  if (!adminToken) {
    // not_configured: bete dig som innan grinden fanns, lås inte ute någon.
    return context.next();
  }

  const expectedCookie = await sha256Hex(`${COOKIE_NAME}:${adminToken}`);
  const providedCookie = readCookie(request);
  const authenticated = providedCookie && timingSafeEqualHex(providedCookie, expectedCookie);

  if (request.method === "POST" && !authenticated) {
    let provided = "";
    try {
      const form = await request.formData();
      provided = String(form.get("gate-token") || "").trim();
    } catch {
      provided = "";
    }
    const providedHash = await sha256Hex(provided);
    const expectedHash = await sha256Hex(adminToken);
    if (provided && timingSafeEqualHex(providedHash, expectedHash)) {
      const url = new URL(request.url);
      return new Response(null, {
        status: 303,
        headers: {
          Location: url.pathname + url.search,
          "Set-Cookie": `${COOKIE_NAME}=${expectedCookie}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`,
          "Cache-Control": "no-store",
        },
      });
    }
    return htmlResponse(loginPage("Fel nyckel. F&ouml;rs&ouml;k igen."), 401);
  }

  if (!authenticated) {
    return htmlResponse(loginPage(), 401);
  }

  const response = await context.next();
  // Internsidor ska aldrig indexeras eller cachas publikt.
  const headers = new Headers(response.headers);
  headers.set("X-Robots-Tag", "noindex, nofollow");
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, { status: response.status, headers });
};

export const config = {
  path: [
    "/admin",
    "/admin/*",
    "/workshop",
    "/workshop/*",
    "/checkout",
    "/checkout/*",
    "/prices",
    "/prices/*",
    "/quick-price",
    "/quick-price/*",
  ],
};
