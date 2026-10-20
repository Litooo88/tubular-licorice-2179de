// Hela kedjan mot en lokal Blobs-server: ett SMS skickas via loggedSms och
// hamnar i sms-log, och /api/kommunikation läser alla källor och svarar med
// översikten. 46elks mockas; inget lämnar maskinen.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { getStore, setEnvironmentContext } from "@netlify/blobs";
import { BlobsServer } from "@netlify/blobs/server";

test("kommunikation: SMS loggas med exakt text och syns i översikten", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "blobs-"));
  const server = new BlobsServer({ directory: dir, token: "mock", port: 0 });
  const { port } = await server.start();
  const url = `http://localhost:${port}`;
  setEnvironmentContext({ siteID: "site", token: "mock", edgeURL: url, uncachedEdgeURL: url });
  const realFetch = globalThis.fetch;
  const env = { ADMIN_TOKEN: "adm", ELKS_USERNAME: "u", ELKS_PASSWORD: "p", SEBASTIAN_SMS_TO: "+46700243319" };
  const oldEnv = { ...process.env };
  Object.assign(process.env, env);
  t.after(async () => { globalThis.fetch = realFetch; process.env = oldEnv; await server.stop(); await rm(dir, { recursive: true, force: true }); });

  const now = Date.now();
  const at = (minAgo) => new Date(now - minAgo * 60e3).toISOString();
  const elks = (minAgo) => at(minAgo).replace("Z", "");
  const sentSms = [];
  globalThis.fetch = async (input, init = {}) => {
    const u = String(input);
    if (!u.includes("api.46elks.com")) return realFetch(input, init);
    const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    if (u.endsWith("/a1/sms") && init.method === "POST") {
      const p = new URLSearchParams(String(init.body));
      sentSms.push(Object.fromEntries(p));
      return ok({ id: "sms-new", to: p.get("to"), status: "created" });
    }
    if (u.includes("/a1/sms?")) return ok({ data: [
      { id: "sms-new", direction: "outgoing", to: "+46704444444", created: elks(1), cost: 3500 },
      { id: "in1", direction: "incoming", from: "+46704444444", created: elks(30), message: "Hej, scootern luktar bränt när jag laddar. Ring mig!" },
    ] });
    if (u.includes("/a1/calls?")) return ok({ data: [{ id: "c1", direction: "incoming", from: "+46709999999", to: "+46101385498", created: elks(10), duration: 0, legs: [] }] });
    if (u.endsWith("/a1/me")) return ok({ balance: 1612345 });
    return new Response("{}", { status: 404 });
  };

  await getStore({ name: "workshop-cases", consistency: "strong" }).setJSON("c1", { id: "c1", serviceNumber: "NE-1042", status: "repairing", customer: { name: "Erik Ek", phone: "0704444444" } });
  await getStore({ name: "voice-agent-calls", consistency: "strong" }).setJSON("n1", { id: "n1", at: at(5), channel: "web", durationSec: 0, summary: "Frågade om öppettider." });

  // Ett utskick via den riktiga avsändaren + loggomslutningen.
  const { postSms } = await import("../netlify/functions/_shared/sms.mjs");
  const { loggedSms, readSmsLog } = await import("../netlify/functions/_shared/comm-log.mjs");
  const res = await loggedSms("case-sms", postSms)({ to: "0704444444", message: "Hej Erik! Din scooter är klar i morgon." });
  assert.equal(res.status, "sent");
  assert.equal(sentSms[0].dontlog, "message"); // utskicket i sig är oförändrat
  const log = await readSmsLog(now - 3600e3);
  assert.equal(log.length, 1);
  assert.deepEqual([log[0].to, log[0].source, log[0].message, log[0].providerId], ["+46704444444", "case-sms", "Hej Erik! Din scooter är klar i morgon.", "sms-new"]);

  const { default: handler } = await import("../netlify/functions/kommunikation.mjs");
  assert.equal((await handler(new Request("https://x/api/kommunikation"))).status, 401);
  const r = await handler(new Request("https://x/api/kommunikation?days=30", { headers: { "x-admin-token": "adm" } }));
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.balanceSek, 161.23);
  assert.deepEqual([d.sources.elksCalls, d.sources.elksSms], ["ok", "ok"]);
  const erik = d.contacts.find((c) => c.phone === "+46704444444");
  assert.equal(erik.tier, "active");
  assert.ok(erik.signals.some((s) => s.key === "safety"));
  // Utskicket från 46elks (utan text) har fått texten från loggen.
  const out = erik.events.find((e) => e.dir === "out");
  assert.equal(out.text, "Hej Erik! Din scooter är klar i morgon.");
  assert.equal(out.sourceLabel, "Manuellt SMS från ärende");
  assert.equal(erik.waiting, false); // vi svarade efter kundens SMS
  assert.deepEqual(d.lists.active, [erik.key]);
  assert.ok(d.contacts.find((c) => c.phone === "+46709999999").waiting); // missat samtal
  assert.equal(d.today.nova.chats, 1);

  // Markera som hanterad.
  const h = await handler(new Request("https://x/api/kommunikation/handled", { method: "POST", headers: { "x-admin-token": "adm", "Content-Type": "application/json" }, body: JSON.stringify({ phone: "0709999999" }) }));
  assert.equal(h.status, 200);
  const d2 = await (await handler(new Request("https://x/api/kommunikation", { headers: { "x-admin-token": "adm" } }))).json();
  assert.equal(d2.contacts.find((c) => c.phone === "+46709999999").waiting, false);
});
