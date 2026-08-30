import { mirrorDateToIso } from "../../nav-history-utils";

type UpstreamRecord = { date?: unknown; nav?: unknown };
type UpstreamPayload = {
  status?: unknown;
  meta?: { scheme_code?: unknown };
  data?: UpstreamRecord[] | {
    nav_groups?: Array<{ historical_records?: UpstreamRecord[] }>;
  };
};

const isIsoCalendarDate = (value: string) => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() === Number(match[2]) - 1
    && date.getUTCDate() === Number(match[3]);
};

const normalizeDate = (value: unknown) => {
  if (typeof value !== "string") return "";
  if (isIsoCalendarDate(value)) return value;
  const converted = mirrorDateToIso(value);
  return isIsoCalendarDate(converted) ? converted : "";
};

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const schemeCode = params.get("schemeCode") ?? "";
  const from = params.get("startDate") ?? "";
  const to = params.get("endDate") ?? "";
  if (!/^\d{1,12}$/.test(schemeCode) || !isIsoCalendarDate(from) || !isIsoCalendarDate(to) || from > to) {
    return Response.json({ error: "Invalid published NAV history request." }, { status: 400 });
  }

  const upstream = new URL(`https://api.mfapi.in/mf/${schemeCode}`);
  upstream.searchParams.set("startDate", from);
  upstream.searchParams.set("endDate", to);
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 30_000);
  try {
    // Cloudflare Workers rejects the unsupported `force-cache` subrequest mode.
    // Cache the normalized route response below instead of making the upstream
    // subrequest fail before it reaches the history provider.
    const response = await fetch(upstream, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      return Response.json({ error: "Published NAV history is temporarily unavailable." }, { status: 502 });
    }
    const payload = await response.json() as UpstreamPayload;
    const identity = String(payload.meta?.scheme_code ?? "");
    if ((identity && identity !== schemeCode) || (payload.status !== undefined && payload.status !== "SUCCESS")) {
      return Response.json({ error: "Published NAV history could not be read safely." }, { status: 502 });
    }
    const groupedRecords = !Array.isArray(payload.data) ? payload.data?.nav_groups : undefined;
    if (!Array.isArray(payload.data) && !Array.isArray(groupedRecords)) {
      return Response.json({ error: "Published NAV history could not be read safely." }, { status: 502 });
    }
    const records = Array.isArray(payload.data)
      ? payload.data
      : groupedRecords?.flatMap((group) => group.historical_records ?? []) ?? [];
    const historicalRecords = records.flatMap((record) => {
      const date = normalizeDate(record.date);
      const nav = Number(record.nav);
      return date >= from && date <= to && Number.isFinite(nav) && nav > 0 ? [{ date, nav }] : [];
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
