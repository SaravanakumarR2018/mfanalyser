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

test("server-renders the FolioVista landing page and privacy promise", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>FolioVista — Mutual Fund CAS Dashboard<\/title>/i);
  assert.match(html, /Your mutual funds,/);
  assert.match(html, /Choose statement/);
  assert.match(html, /Your PDF never leaves this device/);
  assert.match(html, /CAMS \+ KFintech/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|Building your site/i);
});

test("keeps the production site free of starter-preview dependencies", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /import FolioVista from "\.\/FolioVista"/);
  assert.match(page, /<FolioVista \/>/);
  assert.match(layout, /FolioVista — Mutual Fund CAS Dashboard/);
  assert.match(layout, /Your statement never leaves your browser/);
  assert.doesNotMatch(page + layout + packageJson, /codex-preview|_sites-preview|react-loading-skeleton/i);
  await access(new URL("../public/og.png", import.meta.url));
});
