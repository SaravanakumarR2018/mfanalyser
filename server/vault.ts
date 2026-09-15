import { scrypt, randomBytes, createHash, timingSafeEqual } from "node:crypto";

// Accounts are independent of the deployment and Sites/ChatGPT identity.
export interface VaultEnv { DB: D1Database; BUCKET: R2Bucket }
type User = { id: string; username: string; active_statement_id: string | null };
type Statement = { id: string; user_id: string; filename: string; pdf_key: string; portfolio_key: string; bytes: number; created_at: number };
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const MAX_PDF = 30 * 1024 * 1024;
const MAX_SNAPSHOT = 8 * 1024 * 1024;
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(value, {
  status, headers: { "Cache-Control": "no-store, private", "Vary": "Cookie", "X-Content-Type-Options": "nosniff", ...headers },
});
function cookieName(request: Request) { return new URL(request.url).protocol === "https:" ? "__Host-foliovista" : "foliovista-local"; }
function cookie(request: Request, token: string, age = SESSION_SECONDS) {
  return `${cookieName(request)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}
function tokenFrom(request: Request) {
  return request.headers.get("cookie")?.split(";").map(v => v.trim()).find(v => v.startsWith(`${cookieName(request)}=`))?.split("=")[1] ?? "";
}
function derive(password: string, salt: string): Promise<Buffer> {
  // OWASP scrypt profile with 16 MiB working memory, suitable for Workers.
  return new Promise((resolve, reject) => scrypt(password, salt, 32, { N: 16384, r: 8, p: 5, maxmem: 32 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt-v1$${salt}$${(await derive(password, salt)).toString("hex")}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const [version, salt, hash] = encoded.split("$");
  if (version !== "scrypt-v1" || !/^[a-f0-9]{32}$/.test(salt ?? "") || !/^[a-f0-9]{64}$/.test(hash ?? "")) return false;
  return timingSafeEqual(await derive(password, salt), Buffer.from(hash, "hex"));
}
async function currentUser(request: Request, db: D1Database): Promise<User | null> {
  const token = tokenFrom(request);
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  return db.prepare("SELECT u.id, u.username, u.active_statement_id FROM users u JOIN sessions s ON s.user_id = u.id WHERE s.token_hash = ? AND s.expires_at > ?")
    .bind(digest(token), Date.now()).first<User>();
}
function limitedBody(request: Request, max: number) {
  if (Number(request.headers.get("content-length")) > max) throw new HttpError(413, "Upload is too large.");
  if (!request.body) throw new HttpError(400, "Request body is required.");
  const reader = request.body.getReader();
  let size = 0;
  // Bound chunked requests without making an extra full-size PDF copy.
  return new Response(new ReadableStream({
    async pull(controller) {
      const { value, done } = await reader.read();
      if (done) { controller.close(); return; }
      size += value.length;
      if (size > max) { await reader.cancel(); controller.error(new HttpError(413, "Upload is too large.")); return; }
      controller.enqueue(value);
    },
    cancel(reason) { return reader.cancel(reason); },
  }), { headers: { "Content-Type": request.headers.get("content-type") ?? "" } });
}
async function rateLimit(db: D1Database, key: string, max: number) {
  const now = Date.now();
  const row = await db.prepare(`INSERT INTO auth_limits (key, attempts, expires_at) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET attempts = CASE WHEN expires_at <= ? THEN 1 ELSE attempts + 1 END,
    expires_at = CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END RETURNING attempts`)
    .bind(digest(key), now + 15 * 60 * 1000, now, now).first<{ attempts: number }>();
  if (!row || row.attempts > max) throw new HttpError(429, "Too many attempts. Please try again in 15 minutes.");
}
async function authenticate(request: Request, env: VaultEnv, register: boolean) {
  await rateLimit(env.DB, `ip:${request.headers.get("cf-connecting-ip") ?? "local"}`, 30);
  let data: { username?: unknown; password?: unknown };
  try { data = JSON.parse(await (await limitedBody(request, 4096)).text()); }
  catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, "Enter a username and password."); }
  const username = typeof data?.username === "string" ? data.username.trim().toLowerCase() : "";
  const password = typeof data?.password === "string" ? data.password : "";
  if (!/^[a-z0-9_.-]{3,40}$/.test(username) || password.length < 12 || password.length > 128) {
    throw new HttpError(400, "Use a username of 3–40 letters, numbers, dots, underscores or hyphens and a password of 12–128 characters.");
  }
  await rateLimit(env.DB, `user:${username}`, 10);
  let user = await env.DB.prepare("SELECT id, username, password_hash FROM users WHERE username = ?").bind(username).first<User & { password_hash: string }>();
  if (register) {
    const hash = await hashPassword(password);
    if (user) throw new HttpError(409, "This username is unavailable. Choose another or sign in.");
    const id = crypto.randomUUID();
    const inserted = await env.DB.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(username) DO NOTHING RETURNING id").bind(id, username, hash, Date.now()).first();
    if (!inserted) throw new HttpError(409, "This username is unavailable. Choose another or sign in.");
    user = { id, username, password_hash: hash, active_statement_id: null };
  } else {
    const encoded = user?.password_hash ?? `scrypt-v1$${"0".repeat(32)}$${"0".repeat(64)}`;
    const valid = await verifyPassword(password, encoded);
    if (!user || !valid) throw new HttpError(401, "Username or password is incorrect.");
  }
  const token = randomBytes(32).toString("hex");
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ? OR token_hash = ?").bind(Date.now(), digest(tokenFrom(request))),
    env.DB.prepare("DELETE FROM auth_limits WHERE expires_at <= ?").bind(Date.now()),
    env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(digest(token), user.id, Date.now() + SESSION_SECONDS * 1000),
  ]);
  return json({ user: { username: user.username } }, 200, { "Set-Cookie": cookie(request, token) });
}
function publicStatement(row: Statement) { return { id: row.id, filename: row.filename, bytes: row.bytes, createdAt: row.created_at }; }

export async function handleVault(request: Request, env: VaultEnv): Promise<Response> {
  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/vault\/?/, "");
    if (!["GET", "POST", "DELETE"].includes(request.method)) throw new HttpError(405, "Method not allowed.");
    if (request.method !== "GET" && (request.headers.get("origin") !== url.origin || request.headers.get("x-foliovista-request") !== "1")) {
      throw new HttpError(403, "Please make this request from FolioVista.");
    }
    if (path === "session" && request.method === "GET" && !tokenFrom(request)) return json({ user: null });
    if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new HttpError(400, "Use HTTPS to access saved accounts.");
    if (!env.DB || !env.BUCKET) throw new HttpError(503, "Saved accounts are unavailable. Guest analysis is still available.");
    if (["login", "register"].includes(path) && request.method === "POST") return await authenticate(request, env, path === "register");
    if (path === "logout" && request.method === "POST") {
      await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(digest(tokenFrom(request))).run();
      return json({ ok: true }, 200, { "Set-Cookie": cookie(request, "", 0) });
    }
    const user = await currentUser(request, env.DB);
    if (path === "session" && request.method === "GET") return json({ user: user ? { username: user.username } : null });
    if (!user) throw new HttpError(401, "Please sign in again. Your saved statements are still safe.");
    const expectedAccount = request.headers.get("x-foliovista-account");
    if (expectedAccount && expectedAccount !== user.username) throw new HttpError(409, "The signed-in account changed in another tab. Reload before saving or opening statements.");
    if (path === "statements" && request.method === "GET") {
      const rows = await env.DB.prepare("SELECT * FROM statements WHERE user_id = ? ORDER BY created_at DESC, id DESC").bind(user.id).all<Statement>();
      return json({ statements: rows.results.map(publicStatement), activeStatementId: user.active_statement_id });
    }
    if (path === "statements" && request.method === "POST") {
      await rateLimit(env.DB, `upload:${user.id}`, 30);
      let form: FormData;
      try { form = await limitedBody(request, MAX_PDF + MAX_SNAPSHOT + 64 * 1024).formData(); }
      catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, "Send a PDF and its analysed portfolio."); }
      const file = form.get("file");
      const snapshot = form.get("portfolio");
      const id = form.get("id");
      if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id)) throw new HttpError(400, "Invalid upload identifier.");
      if (!(file instanceof File) || file.size > MAX_PDF || file.size < 5 || !file.name.toLowerCase().endsWith(".pdf") || await file.slice(0, 5).text() !== "%PDF-") throw new HttpError(400, "Choose a PDF up to 30 MB.");
      if (typeof snapshot !== "string" || new TextEncoder().encode(snapshot).length > MAX_SNAPSHOT) throw new HttpError(400, "The analysed portfolio is too large or missing.");
      let portfolio;
      try { portfolio = JSON.parse(snapshot); } catch { throw new HttpError(400, "Invalid portfolio."); }
      if (portfolio?.version !== 1 || portfolio?.portfolio?.source !== "cas" || !Array.isArray(portfolio.portfolio.funds) || !Array.isArray(portfolio.portfolio.timeline) || !Array.isArray(portfolio.portfolio.closedFunds)) throw new HttpError(400, "Analyse the CAS before saving it.");
      const existing = await env.DB.prepare("SELECT * FROM statements WHERE id = ? AND user_id = ?").bind(id, user.id).first<Statement>();
      if (existing) return json({ statement: publicStatement(existing) });
      const prefix = `${user.id}/${id}/${crypto.randomUUID()}`;
      const pdfKey = `${prefix}/statement.pdf`;
      const portfolioKey = `${prefix}/portfolio.json`;
      const createdAt = Date.now();
      try {
        await env.BUCKET.put(pdfKey, file.stream(), { httpMetadata: { contentType: "application/pdf" } });
        await env.BUCKET.put(portfolioKey, snapshot, { httpMetadata: { contentType: "application/json" } });
        await env.DB.batch([
          env.DB.prepare("INSERT INTO statements (id, user_id, filename, pdf_key, portfolio_key, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, user.id, file.name.slice(0, 200), pdfKey, portfolioKey, file.size, createdAt),
          env.DB.prepare("UPDATE users SET active_statement_id = ? WHERE id = ?").bind(id, user.id),
        ]);
      } catch (error) {
        // Do not delete bytes referenced by a possibly committed transaction.
        const committed = await env.DB.prepare("SELECT * FROM statements WHERE id = ? AND user_id = ?").bind(id, user.id).first<Statement>();
        if (!committed || committed.pdf_key !== pdfKey) await env.BUCKET.delete([pdfKey, portfolioKey]);
        if (committed) return json({ statement: publicStatement(committed) });
        throw error;
      }
      return json({ statement: { id, filename: file.name.slice(0, 200), bytes: file.size, createdAt } }, 201);
    }
    const match = path.match(/^statements\/([a-f0-9-]{36})(?:\/(pdf|activate))?$/);
    if (!match) throw new HttpError(404, "Not found.");
    const row = await env.DB.prepare("SELECT * FROM statements WHERE id = ? AND user_id = ?").bind(match[1], user.id).first<Statement>();
    if (!row) throw new HttpError(404, "Statement not found.");
    if (match[2] === "activate" && request.method === "POST") {
      await env.DB.prepare("UPDATE users SET active_statement_id = ? WHERE id = ?").bind(row.id, user.id).run();
      return json({ ok: true });
    }
    if (request.method === "GET" && match[2] !== "activate") {
      const pdf = match[2] === "pdf";
      const object = await env.BUCKET.get(pdf ? row.pdf_key : row.portfolio_key);
      if (!object) throw new HttpError(503, "This saved statement could not be loaded. Please retry.");
      return new Response(object.body, { headers: {
        "Content-Type": pdf ? "application/pdf" : "application/json", "Cache-Control": "no-store, private", "Vary": "Cookie", "X-Content-Type-Options": "nosniff",
        ...(pdf ? { "Content-Disposition": `attachment; filename="statement.pdf"; filename*=UTF-8''${encodeURIComponent(row.filename)}` } : {}),
      } });
    }
    if (!match[2] && request.method === "DELETE") {
      await env.BUCKET.delete([row.pdf_key, row.portfolio_key]);
      await env.DB.batch([
        env.DB.prepare("DELETE FROM statements WHERE id = ? AND user_id = ?").bind(row.id, user.id),
        env.DB.prepare("UPDATE users SET active_statement_id = (SELECT id FROM statements WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 1) WHERE id = ? AND active_statement_id = ?").bind(user.id, user.id, row.id),
      ]);
      return json({ ok: true });
    }
    throw new HttpError(405, "Method not allowed.");
  } catch (error) {
    if (!(error instanceof HttpError)) console.error("Vault storage operation failed");
    return json({ error: error instanceof HttpError ? error.message : "Saved storage is temporarily unavailable. Please retry; guest analysis is still available." }, error instanceof HttpError ? error.status : 503);
  }
}
