import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the FolioVista browser-restore shell without flashing the landing page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>FolioVista — Mutual Fund CAS Dashboard<\/title>/i);
  assert.match(html, /<link[^>]+rel="icon"[^>]+href="\/favicon\.svg"[^>]+type="image\/svg\+xml"/i);
  assert.match(html, /<link[^>]+rel="shortcut icon"[^>]+href="\/favicon\.svg"/i);
  assert.match(html, /Opening FolioVista/);
  assert.match(html, /Checking this browser for your saved portfolio/);
  assert.doesNotMatch(html, /Choose statement/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|Building your site/i);
});

test("keeps the production site branded and free of starter-preview dependencies", async () => {
  const [page, layout, packageJson, favicon] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../public/favicon.svg", import.meta.url), "utf8"),
  ]);

  assert.match(page, /import FolioVista from "\.\/FolioVista"/);
  assert.match(page, /<FolioVista \/>/);
  assert.match(layout, /FolioVista — Mutual Fund CAS Dashboard/);
  assert.match(layout, /Your statement never leaves your browser/);
  assert.match(layout, /rel="icon" href="\/favicon\.svg" type="image\/svg\+xml"/);
  assert.match(layout, /rel="shortcut icon" href="\/favicon\.svg"/);
  assert.match(favicon, /<title>FolioVista<\/title>/);
  assert.match(favicon, /#0B1D2A/);
  assert.match(favicon, /#FF7A66/);
  assert.match(favicon, /#B9F8D3/);
  assert.doesNotMatch(page + layout + packageJson, /codex-preview|_sites-preview|react-loading-skeleton/i);
  await access(new URL("../public/og.png", import.meta.url));
});
