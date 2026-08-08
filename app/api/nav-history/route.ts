const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const schemeCode = params.get("sd_id") ?? "";
  const from = params.get("from_date") ?? "";
  const to = params.get("to_date") ?? "";
  if (!/^\d{1,12}$/.test(schemeCode) || !ISO_DATE.test(from) || !ISO_DATE.test(to) || from > to) {
    return Response.json({ error: "Invalid AMFI history request." }, { status: 400 });
  }

  const upstream = new URL("https://www.amfiindia.com/api/nav-history");
  upstream.searchParams.set("query_type", "historical_period");
  upstream.searchParams.set("from_date", from);
  upstream.searchParams.set("to_date", to);
  upstream.searchParams.set("sd_id", schemeCode);

  try {
    const response = await fetch(upstream, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) {
      return Response.json({ error: "AMFI history is temporarily unavailable." }, { status: 502 });
    }
    return new Response(await response.text(), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch {
    return Response.json({ error: "AMFI history is temporarily unavailable." }, { status: 502 });
  }
}
