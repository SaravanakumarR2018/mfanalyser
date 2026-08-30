import assert from "node:assert/strict";
import test from "node:test";

import { GET as getLatestNav } from "../../app/api/nav/route.ts";
import { GET as getNavHistory } from "../../app/api/nav-history/route.ts";

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

test("history proxy normalizes current and legacy provider shapes behind one stable contract", async (context) => {
  for (const [name, payload] of [
    ["current array without status", {
      meta: { scheme_code: 1001 },
      data: [{ date: "02-02-2026", nav: "12.5" }, { date: "31-02-2026", nav: "99" }],
    }],
    ["grouped ISO records", {
      status: "SUCCESS",
      meta: { scheme_code: "1001" },
      data: { nav_groups: [{ historical_records: [{ date: "2026-02-01", nav: 12 }] }] },
    }],
  ] as const) {
    await context.test(name, async () => {
      const result = await withFetch(async (input, init) => {
        const url = new URL(String(input));
        assert.equal(url.origin + url.pathname, "https://api.mfapi.in/mf/1001");
        assert.equal(url.searchParams.get("startDate"), "2026-02-01");
        assert.equal(url.searchParams.get("endDate"), "2026-02-02");
        assert.equal(init?.cache, undefined);
        assert.ok(init?.signal instanceof AbortSignal);
        return Response.json(payload);
      }, () => getNavHistory(new Request(
        "https://example.test/api/nav-history?schemeCode=1001&startDate=2026-02-01&endDate=2026-02-02",
      )));
      assert.equal(result.status, 200);
      assert.equal(result.headers.get("cache-control"), "public, max-age=86400, s-maxage=604800");
      const body = await result.json() as { data: { nav_groups: Array<{ historical_records: unknown[] }> } };
      assert.equal(body.data.nav_groups[0].historical_records.length, 1);
    });
  }
});

test("history proxy rejects unsafe requests, identities, statuses, and upstream failures", async (context) => {
  const invalid = await getNavHistory(new Request(
    "https://example.test/api/nav-history?schemeCode=../1&startDate=2026-02-01&endDate=2026-02-02",
  ));
  assert.equal(invalid.status, 400);

  for (const [name, replacement] of [
    ["identity", async () => Response.json({ meta: { scheme_code: "1002" }, data: [] })],
    ["provider status", async () => Response.json({ status: "FAILED", meta: { scheme_code: "1001" }, data: [] })],
    ["HTTP status", async () => new Response("down", { status: 503 })],
    ["network", async () => { throw new Error("private upstream detail"); }],
  ] as Array<[string, typeof fetch]>) {
    await context.test(name, async () => {
      const result = await withFetch(replacement, () => getNavHistory(new Request(
        "https://example.test/api/nav-history?schemeCode=1001&startDate=2026-02-01&endDate=2026-02-02",
      )));
      assert.equal(result.status, 502);
      assert.match(JSON.stringify(await result.json()), /Published NAV history/);
    });
  }
});
