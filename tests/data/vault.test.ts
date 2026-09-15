import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { handleVault, hashPassword, verifyPassword, type VaultEnv } from "../../server/vault";
type VaultPayload = { statement: { id: string }; statements: unknown[]; activeStatementId: string; version: number };

// Real SQLite executes the generated production schema and every prepared query.
// The object-store adapter lets tests inject failures without real investor data.
function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(new URL("../../drizzle/", import.meta.url)).filter(file => file.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(new URL(`../../drizzle/${file}`, import.meta.url), "utf8"));
  }
  class Query {
    sql: string;
    values: (string | number | null)[] = [];
    constructor(sql: string) { this.sql = sql; }
    bind(...values: (string | number | null)[]) { this.values = values; return this; }
    async first() { return sqlite.prepare(this.sql).get(...this.values) ?? null; }
    async all() { return { results: sqlite.prepare(this.sql).all(...this.values) }; }
    async run() { return sqlite.prepare(this.sql).run(...this.values); }
  }
  const objects = new Map<string, Uint8Array<ArrayBuffer>>();
  let failPut = false;
  const env = {
    DB: {
      prepare: (sql: string) => new Query(sql),
      batch: async (queries: Query[]) => {
        sqlite.exec("BEGIN");
        try { const result = []; for (const query of queries) result.push(await query.run()); sqlite.exec("COMMIT"); return result; }
        catch (error) { sqlite.exec("ROLLBACK"); throw error; }
      },
    },
    BUCKET: {
      put: async (key: string, data: BodyInit) => { if (failPut) throw new Error("injected"); objects.set(key, new Uint8Array(await new Response(data).arrayBuffer())); },
      get: async (key: string) => objects.has(key) ? { body: new Blob([objects.get(key)!]).stream() } : null,
      delete: async (keys: string | string[]) => { for (const key of [keys].flat()) objects.delete(key); },
    },
  } as unknown as VaultEnv;
  const request = (path: string, method = "GET", cookie = "", body?: BodyInit, origin = "https://folio.test") => handleVault(new Request(`https://folio.test/api/vault/${path}`, {
    method, body, headers: { cookie, origin, "X-FolioVista-Request": "1", "cf-connecting-ip": "127.0.0.1" },
  }), env);
  const credentials = (username: string, password = "synthetic-password-123") => JSON.stringify({ username, password });
  const register = async (username: string) => {
    const response = await request("register", "POST", "", credentials(username));
    assert.equal(response.status, 200, await response.clone().text());
    const cookie = response.headers.get("set-cookie")!;
    assert.match(cookie, /HttpOnly; SameSite=Strict/); assert.match(cookie, /; Secure/);
    return cookie.split(";")[0];
  };
  const upload = (id = crypto.randomUUID()) => {
    const body = new FormData();
    body.set("id", id);
    body.set("file", new File(["%PDF-1.7 synthetic fixture"], "synthetic.pdf", { type: "application/pdf" }));
    body.set("portfolio", JSON.stringify({ version: 1, portfolio: { source: "cas", funds: [], closedFunds: [], timeline: [] } }));
    return body;
  };
  return { env, sqlite, objects, request, register, upload, credentials, failUploads: () => { failPut = true; } };
}

test("password hashes are salted and verify without retaining plaintext", async () => {
  const first = await hashPassword("synthetic-password-123");
  const second = await hashPassword("synthetic-password-123");
  assert.notEqual(first, second);
  assert.equal(await verifyPassword("synthetic-password-123", first), true);
  assert.equal(await verifyPassword("wrong-password-123", first), false);
  assert.equal(await verifyPassword("anything", "malformed"), false);
});
test("accounts and multiple statements survive new sessions and enforce ownership", async () => {
  const f = fixture();
  const alice = await f.register("alice"); const bob = await f.register("bob");
  const id = crypto.randomUUID();
  const switchedAccount = await handleVault(new Request("https://folio.test/api/vault/statements", {
    method: "POST", headers: { cookie: bob, origin: "https://folio.test", "X-FolioVista-Request": "1", "X-FolioVista-Account": "alice" }, body: f.upload(),
  }), f.env);
  assert.equal(switchedAccount.status, 409);
  assert.equal((await f.request("statements", "POST", alice, f.upload(id))).status, 201);
  assert.equal((await f.request("statements", "POST", alice, f.upload(id))).status, 200);
  assert.equal(f.objects.size, 2, "retry does not duplicate objects");
  const second = await (await f.request("statements", "POST", alice, f.upload())).json<VaultPayload>();
  assert.equal((await (await f.request("statements", "GET", alice)).json<VaultPayload>()).statements.length, 2);
  assert.equal((await (await f.request("statements", "GET", bob)).json<VaultPayload>()).statements.length, 0);
  for (const [suffix, method] of [["", "GET"], ["/pdf", "GET"], ["/activate", "POST"], ["", "DELETE"]]) {
    assert.equal((await f.request(`statements/${id}${suffix}`, method, bob)).status, 404);
    assert.equal((await f.request(`statements/${id}${suffix}`, method)).status, 401);
  }
  const saved = await f.request(`statements/${id}`, "GET", alice);
  assert.match(saved.headers.get("cache-control")!, /no-store/);
  assert.equal((await saved.json<VaultPayload>()).version, 1);
  assert.match(await (await f.request(`statements/${id}/pdf`, "GET", alice)).text(), /%PDF-1.7/);
  assert.equal((await f.request(`statements/${id}/activate`, "POST", alice)).status, 200);
  assert.equal((await f.request("logout", "POST", alice)).status, 200);
  assert.equal((await f.request("statements", "GET", alice)).status, 401);
  const login = await f.request("login", "POST", "", f.credentials("ALICE"));
  const newCookie = login.headers.get("set-cookie")!.split(";")[0];
  assert.notEqual(newCookie, alice);
  const list = await (await f.request("statements", "GET", newCookie)).json<VaultPayload>();
  assert.equal(list.activeStatementId, id);
  assert.equal(list.statements.length, 2);
  assert.equal((await f.request(`statements/${id}`, "DELETE", newCookie)).status, 200);
  assert.equal((await (await f.request("statements", "GET", newCookie)).json<VaultPayload>()).activeStatementId, second.statement.id);
  assert.equal(f.objects.size, 2);
  f.sqlite.exec("UPDATE sessions SET expires_at = 0");
  assert.equal((await f.request("statements", "GET", newCookie)).status, 401);
  f.sqlite.close();
});
test("authentication rejects forgery, weak credentials and repeated guesses", async () => {
  const f = fixture();
  await f.register("alice");
  assert.equal((await f.request("register", "POST", "", f.credentials("ALICE"))).status, 409);
  assert.equal((await f.request("register", "POST", "", f.credentials("eve", "short"))).status, 400);
  assert.equal((await f.request("login", "POST", "", "invalid-json")).status, 400);
  assert.equal((await f.request("login", "POST", "", f.credentials("alice"), "https://evil.test")).status, 403);
  assert.equal((await f.request("login", "POST", "", f.credentials("unknown"))).status, 401);
  for (let i = 0; i < 8; i++) assert.equal((await f.request("login", "POST", "", f.credentials("alice", "incorrect-password"))).status, 401);
  assert.equal((await f.request("login", "POST", "", f.credentials("alice"))).status, 429);
  assert.equal((await f.request("statements", "GET", "__Host-foliovista=forged")).status, 401);
  f.sqlite.close();
});
test("failed or invalid uploads do not replace the last saved statement", async () => {
  const f = fixture(); const alice = await f.register("alice");
  const saved = await (await f.request("statements", "POST", alice, f.upload())).json<VaultPayload>();
  const invalid = f.upload(); invalid.set("file", new File(["not a PDF"], "fake.pdf"));
  assert.equal((await f.request("statements", "POST", alice, invalid)).status, 400);
  const invalidPortfolio = f.upload(); invalidPortfolio.set("portfolio", "{}");
  assert.equal((await f.request("statements", "POST", alice, invalidPortfolio)).status, 400);
  const oversized = new Request("https://folio.test/api/vault/statements", {
    method: "POST", body: "x", headers: { cookie: alice, origin: "https://folio.test", "X-FolioVista-Request": "1", "Content-Length": "999999999" },
  });
  assert.equal((await handleVault(oversized, f.env)).status, 413);
  f.failUploads();
  assert.equal((await f.request("statements", "POST", alice, f.upload())).status, 503);
  const list = await (await f.request("statements", "GET", alice)).json<VaultPayload>();
  assert.equal(list.statements.length, 1); assert.equal(list.activeStatementId, saved.statement.id);
  assert.equal(f.objects.size, 2);
  f.sqlite.close();
});
test("guest session works without configured storage; saved mode fails explicitly", async () => {
  const request = new Request("https://folio.test/api/vault/session");
  assert.deepEqual(await (await handleVault(request, {} as VaultEnv)).json<VaultPayload>(), { user: null });
  assert.equal((await handleVault(new Request("https://folio.test/api/vault/statements"), {} as VaultEnv)).status, 503);
  assert.equal((await handleVault(new Request("http://folio.test/api/vault/statements"), {} as VaultEnv)).status, 400);
});
