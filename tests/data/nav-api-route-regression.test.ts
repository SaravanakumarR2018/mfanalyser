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

test("history proxy rejects malformed parameters without contacting an upstream", async () => {
  const invalid = [
    "http://localhost/api/nav-history",
    "http://localhost/api/nav-history?sd_id=abc&from_date=2026-01-01&to_date=2026-02-01",
    "http://localhost/api/nav-history?sd_id=1001&from_date=01-01-2026&to_date=2026-02-01",
    "http://localhost/api/nav-history?sd_id=1001&from_date=2026-03-01&to_date=2026-02-01",
    "http://localhost/api/nav-history?sd_id=1234567890123&from_date=2026-01-01&to_date=2026-02-01",
  ];
  let calls = 0;
  await withFetch(async () => {
    calls += 1;
    return Response.json({});
  }, async () => {
    for (const url of invalid) {
      const result = await getNavHistory(new Request(url));
      assert.equal(result.status, 400, url);
      assert.deepEqual(await result.json(), { error: "Invalid AMFI history request." });
    }
  });
  assert.equal(calls, 0);
});

test("history proxy validates the upstream identity and filters its records into the public contract", async () => {
  const result = await withFetch(async (input, init) => {
    const url = input as URL;
    assert.equal(url.origin + url.pathname, "https://api.mfapi.in/mf/1001");
    assert.equal(url.searchParams.get("startDate"), "1900-01-01");
    assert.equal(url.searchParams.get("endDate"), "2026-02-02");
    assert.equal(init?.cache, "force-cache");
    assert.ok(init?.signal instanceof AbortSignal);
    return Response.json({
      status: "SUCCESS",
      meta: { scheme_code: 1001 },
      data: [
        { date: "01-01-1990", nav: "2" },
        { date: "01-01-2026", nav: "10" },
        { date: "02-02-2026", nav: 12 },
        { date: "31-12-1899", nav: 1 },
        { date: "31-12-2025", nav: 9 },
        { date: "03-02-2026", nav: 13 },
        { date: "bad", nav: 99 },
        { date: "10-01-2026", nav: 0 },
        { date: "11-01-2026", nav: "not-a-number" },
      ],
    });
  }, () => getNavHistory(new Request(
    "http://localhost/api/nav-history?sd_id=1001&from_date=1900-01-01&to_date=2026-02-02",
  )));

  assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "public, max-age=86400, s-maxage=604800");
  assert.deepEqual(await result.json(), {
    data: {
      nav_groups: [{
        historical_records: [
          { date: "1990-01-01", nav: 2 },
          { date: "2026-01-01", nav: 10 },
          { date: "2026-02-02", nav: 12 },
          { date: "2025-12-31", nav: 9 },
        ],
      }],
    },
  });
});

test("history proxy fails closed for non-OK, wrong-scheme, malformed, and rejected upstreams", async (context) => {
  const request = () => new Request(
    "http://localhost/api/nav-history?sd_id=1001&from_date=2026-01-01&to_date=2026-02-02",
  );
  const cases: Array<{ name: string; fetcher: typeof fetch; error: string }> = [
    {
      name: "non-OK",
      fetcher: async () => new Response("down", { status: 429 }),
      error: "Published NAV history is temporarily unavailable.",
    },
    {
      name: "wrong scheme",
      fetcher: async () => Response.json({ status: "SUCCESS", meta: { scheme_code: "9999" }, data: [] }),
      error: "Published NAV history could not be read safely.",
    },
    {
      name: "non-success status",
      fetcher: async () => Response.json({ status: "FAILURE", meta: { scheme_code: "1001" }, data: [] }),
      error: "Published NAV history could not be read safely.",
    },
    {
      name: "non-array data",
      fetcher: async () => Response.json({ status: "SUCCESS", meta: { scheme_code: "1001" }, data: {} }),
      error: "Published NAV history could not be read safely.",
    },
    {
      name: "network rejection",
      fetcher: async () => { throw new Error("private upstream detail"); },
      error: "Published NAV history is temporarily unavailable.",
    },
  ];

  for (const item of cases) {
    await context.test(item.name, async () => {
      const result = await withFetch(item.fetcher, () => getNavHistory(request()));
      assert.equal(result.status, 502);
      assert.deepEqual(await result.json(), { error: item.error });
    });
  }
});
