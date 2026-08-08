const AMFI_NAV_URL = "https://portal.amfiindia.com/spages/NAVAll.txt";

export async function GET() {
  try {
    const upstream = await fetch(AMFI_NAV_URL, {
      headers: { Accept: "text/plain" },
    });
    if (!upstream.ok) {
      return Response.json(
        { error: "The official AMFI NAV service is temporarily unavailable." },
        { status: 502 },
      );
    }
    const body = await upstream.text();
    return new Response(body, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=900, s-maxage=900",
      },
    });
  } catch {
    return Response.json(
      { error: "The official AMFI NAV service could not be reached." },
      { status: 502 },
    );
  }
}
