// storage-health: POST verifierar onlyIfNew OCH onlyIfMatch var för sig mot
// en separat probe-store; GET skriver inget och visar bara cachat resultat.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { getStore, setEnvironmentContext } from "@netlify/blobs";
import { BlobsServer } from "@netlify/blobs/server";
import { resetVerification, setProbeStoreFactory } from "../netlify/functions/_shared/case-store.mjs";
import { pinTestEnv } from "./_test-env.mjs";


test("storage-health: POST kör proben, GET är läsande, utan token 401", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "blobs-health-"));
  const server = new BlobsServer({ directory: dir, token: "mock", port: 0 });
  const { port } = await server.start();
  const url = `http://localhost:${port}`;
  setEnvironmentContext({ siteID: "site", token: "mock", edgeURL: url, uncachedEdgeURL: url });
  resetVerification();
  setProbeStoreFactory(() => getStore({ name: "case-store-probe", consistency: "strong" }));
  const restoreEnv = pinTestEnv();
  t.after(async () => { restoreEnv(); await server.stop(); await rm(dir, { recursive: true, force: true }); });

  const { default: handler } = await import("../netlify/functions/storage-health.mjs");
  assert.equal((await handler(new Request("https://x/api/storage-health"))).status, 401);

  const get = await handler(new Request("https://x/api/storage-health", { headers: { "x-admin-token": "adm" } }));
  const before = await get.json();
  assert.equal(before.readOnly, true);
  assert.equal(before.conditionalWrites, null, "GET har inte skrivit något");
  assert.equal(before.conditionalWritesSource, "none");
  assert.equal(before.unversionedWritesAllowed, false);

  const post = await handler(new Request("https://x/api/storage-health", { method: "POST", headers: { "x-admin-token": "adm" } }));
  const result = await post.json();
  assert.equal(result.readOnly, false);
  assert.equal(result.conditionalWritesSource, "probe");
  assert.equal(result.conditionalWrites.ok, true, JSON.stringify(result.conditionalWrites));
  assert.deepEqual(result.conditionalWrites.steps, { onlyIfNewCreate: true, onlyIfNewDuplicate: true, etagOnRead: true, onlyIfMatchStale: true, onlyIfMatchFresh: true, valueAfterFresh: true });
  assert.equal(result.warnings.length, 0);
  // Proben städar efter sig: inga kvarvarande nycklar i probe-storen.
  assert.equal((await getStore({ name: "case-store-probe", consistency: "strong" }).list()).blobs.length, 0);
  // Ingen kunddata rörs: workshop-cases är fortfarande tom.
  assert.equal((await getStore({ name: "workshop-cases", consistency: "strong" }).list()).blobs.length, 0);
});
