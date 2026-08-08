const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const schemeCode = params.get("sd_id") ?? "";
  const from = params.get("from_date") ?? "";
  const to = params.get("to_date") ?? "";
  const fromTime = new Date(`${from}T00:00:00Z`).getTime();
  const toTime = new Date(`${to}T00:00:00Z`).getTime();
  const days = (toTime - fromTime) / 86_400_000;
  if (
    !/^\d{1,12}$/.test(schemeCode)
    || !ISO_DATE.test(from)
    || !ISO_DATE.test(to)
    || from > to
    || !Number.isFinite(days)
    || days > 370
  ) {
    return Response.json({ error: "Invalid AMFI history request." }, { status: 400 });
  }

  const upstream = new URL("https://www.amfiindia.com/api/nav-history");
  upstream.searchParams.set("query_type", "historical_period");
  upstream.searchParams.set("from_date", from);
  upstream.searchParams.set("to_date", to);
  upstream.searchParams.set("sd_id", schemeCode);

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 35_000);
  try {
    const response = await fetch(upstream, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      return Response.json({ error: "AMFI history is temporarily unavailable." }, { status: 502 });
    }
    return new Response(await response.text(), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=86400, s-maxage=604800",
      },
    });
  } catch {
    return Response.json({ error: "AMFI history is temporarily unavailable." }, { status: 502 });
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
