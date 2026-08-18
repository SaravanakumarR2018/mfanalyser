import assert from "node:assert/strict";
import test from "node:test";

import { GET as getLatestNav } from "../../app/api/nav/route.ts";

const withFetch = async <T>(replacement: typeof fetch, action: () => Promise<T>) => {
  const original = globalThis.fetch;
  globalThis.fetch = replacement;
  try {
    return await action();
  } finally {
    globalThis.fetch = original;
  }
};

test("latest NAV proxy returns official text with its cache and content contracts", async () => {
  const result = await withFetch(async (input, init) => {
    assert.equal(input, "https://portal.amfiindia.com/spages/NAVAll.txt");
    assert.deepEqual(init?.headers, { Accept: "text/plain" });
    return new Response("1001;INF000A00001;;Fund;12;02-Feb-2026");
  }, getLatestNav);

  assert.equal(result.status, 200);
  assert.equal(result.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(result.headers.get("cache-control"), "public, max-age=900, s-maxage=900");
  assert.equal(await result.text(), "1001;INF000A00001;;Fund;12;02-Feb-2026");
});

test("latest NAV proxy converts upstream status and network failures to safe 502 responses", async (context) => {
  await context.test("upstream status", async () => {
    const result = await withFetch(async () => new Response("down", { status: 503 }), getLatestNav);
    assert.equal(result.status, 502);
    assert.deepEqual(await result.json(), { error: "The official AMFI NAV service is temporarily unavailable." });
  });
  await context.test("network rejection", async () => {
    const result = await withFetch(async () => { throw new Error("private upstream detail"); }, getLatestNav);
    assert.equal(result.status, 502);
    assert.deepEqual(await result.json(), { error: "The official AMFI NAV service could not be reached." });
  });
});
