import { mirrorDateToIso } from "../../nav-history-utils";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type MirrorResponse = {
  status?: string;
  meta?: { scheme_code?: string | number };
  data?: Array<{ date?: string; nav?: string | number }>;
};

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const schemeCode = params.get("sd_id") ?? "";
  const from = params.get("from_date") ?? "";
  const to = params.get("to_date") ?? "";
  if (
    !/^\d{1,12}$/.test(schemeCode)
    || !ISO_DATE.test(from)
    || !ISO_DATE.test(to)
    || from > to
  ) {
    return Response.json({ error: "Invalid AMFI history request." }, { status: 400 });
  }

  const upstream = new URL(`https://api.mfapi.in/mf/${schemeCode}`);
  upstream.searchParams.set("startDate", from);
  upstream.searchParams.set("endDate", to);

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(upstream, {
      headers: { accept: "application/json" },
      cache: "force-cache",
      signal: controller.signal,
    });
    if (!response.ok) {
      return Response.json({ error: "Published NAV history is temporarily unavailable." }, { status: 502 });
    }
    const payload = await response.json() as MirrorResponse;
    if (
      payload.status !== "SUCCESS"
      || String(payload.meta?.scheme_code ?? "") !== schemeCode
      || !Array.isArray(payload.data)
    ) {
      return Response.json({ error: "Published NAV history could not be read safely." }, { status: 502 });
    }
    const historicalRecords = payload.data.flatMap((record) => {
      const date = mirrorDateToIso(record.date ?? "");
      const nav = Number(record.nav);
      return date >= from && date <= to && Number.isFinite(nav) && nav > 0
        ? [{ date, nav }]
        : [];
    });
    return Response.json({
      data: { nav_groups: [{ historical_records: historicalRecords }] },
    }, {
      headers: { "cache-control": "public, max-age=86400, s-maxage=604800" },
    });
  } catch {
    return Response.json({ error: "Published NAV history is temporarily unavailable." }, { status: 502 });
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
