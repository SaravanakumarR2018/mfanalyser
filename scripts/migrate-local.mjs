import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

// Explicitly local, shared with the Cloudflare Vite plugin's development state.
// An externally supplied test server owns its own database setup.
if (!process.env.PLAYWRIGHT_BASE_URL) {
  mkdirSync("work", { recursive: true });
  writeFileSync("work/vault-local.json", JSON.stringify({
    name: "foliovista-local-migrations",
    compatibility_date: "2026-05-15",
    d1_databases: [{ binding: "DB", database_name: "site-creator-d1", database_id: "00000000-0000-4000-8000-000000000000", migrations_dir: resolve("drizzle") }],
  }));
  const result = spawnSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "d1", "migrations", "apply", "DB", "--local", "--config", "work/vault-local.json", "--persist-to", resolve(".wrangler/state")], {
    stdio: "inherit", env: { ...process.env, WRANGLER_LOG_PATH: resolve(".wrangler/logs"), WRANGLER_SEND_METRICS: "false" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
