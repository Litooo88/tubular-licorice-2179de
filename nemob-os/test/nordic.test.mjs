import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchNordicBrief } from "../lib/nordic.mjs";

const PAYLOAD = {
  generated_at: "2026-07-12T06:00:00.000Z",
  todays_bookings: [],
  open_jobs: [],
  overdue_offers_count: 1,
  unpaid_invoices_count: 2,
  week_revenue_sek: 9800,
  new_bookings_since_yesterday: 3,
};

const okFetch = async () => new Response(JSON.stringify(PAYLOAD), { status: 200 });

test("utan NORDIC_BRIEF_URL => not_configured", async () => {
  const result = await fetchNordicBrief({ env: {} });
  assert.equal(result.status, "not_configured");
});

test("lyckad hämtning ger ok + mappad brief och skriver cache", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nemob-nordic-"));
  const cachePath = join(dir, "cache.json");
  try {
    const result = await fetchNordicBrief({
      cachePath,
      fetchImpl: okFetch,
      env: { NORDIC_BRIEF_URL: "https://example.invalid/hemlig" },
    });
    assert.equal(result.status, "ok");
    assert.equal(result.brief.weekRevenueSek.value, 9800);

    // Källan nere efteråt => down + cachead data, och felkoden är generisk.
    const down = await fetchNordicBrief({
      cachePath,
      fetchImpl: async () => { throw new Error("connect ECONNREFUSED https://example.invalid/hemlig"); },
      env: { NORDIC_BRIEF_URL: "https://example.invalid/hemlig" },
    });
    assert.equal(down.status, "down");
    assert.equal(down.code, "unreachable");
    assert.equal(down.cache.brief.weekRevenueSek.value, 9800);
    // URL:en får ALDRIG läcka i svaret.
    assert.ok(!JSON.stringify(down).includes("hemlig"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("http-fel ger down med statuskod, utan URL-läckage", async () => {
  const result = await fetchNordicBrief({
    fetchImpl: async () => new Response("nope", { status: 503 }),
    env: { NORDIC_BRIEF_URL: "https://example.invalid/hemlig" },
  });
  assert.equal(result.status, "down");
  assert.equal(result.code, "http_503");
  assert.ok(!JSON.stringify(result).includes("hemlig"));
});

test("ogiltig JSON ger down/invalid_json", async () => {
  const result = await fetchNordicBrief({
    fetchImpl: async () => new Response("<html>", { status: 200 }),
    env: { NORDIC_BRIEF_URL: "https://example.invalid/hemlig" },
  });
  assert.equal(result.status, "down");
  assert.equal(result.code, "invalid_json");
});
