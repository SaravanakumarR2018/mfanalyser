import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;
// Sites injects resources from hosting.json. Direct Workers CI must explicitly
// select persistent resources; never infer production resource identity from SHA.
const directEnvironment = process.env.FOLIOVISTA_ENVIRONMENT;
const directKeys = ["FOLIOVISTA_WORKER_NAME", "FOLIOVISTA_D1_ID", "FOLIOVISTA_D1_NAME", "FOLIOVISTA_R2_BUCKET"];
if (directEnvironment && (!["production", "preview"].includes(directEnvironment) || directKeys.some(key => !process.env[key]))) {
  throw new Error("Direct Workers builds require production/preview FOLIOVISTA_ENVIRONMENT and explicit WORKER_NAME, D1_ID, D1_NAME and R2_BUCKET values prefixed with FOLIOVISTA_.");
}
if (!directEnvironment && directKeys.some(key => process.env[key])) {
  throw new Error("Set FOLIOVISTA_ENVIRONMENT explicitly when supplying direct Workers resources.");
}

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  ...(directEnvironment ? { name: process.env.FOLIOVISTA_WORKER_NAME } : {}),
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: directEnvironment ? process.env.FOLIOVISTA_D1_NAME! : "site-creator-d1",
          database_id: directEnvironment ? process.env.FOLIOVISTA_D1_ID! : SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
          // The generated Wrangler config lives in dist/server. The Sites
          // packaging plugin places migrations next to it in dist/.openai.
          migrations_dir: "../.openai/drizzle",
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: directEnvironment ? process.env.FOLIOVISTA_R2_BUCKET! : "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: {
      watch: {
        ...(isCodexSeatbeltSandbox ? { useFsEvents: false, usePolling: true } : {}),
        // Trace HTML and local database writes are not application edits. In a
        // long test run, watching them triggers reloads and races report cleanup.
        ignored: ["**/work/**", "**/test-results/**", "**/playwright-report/**", "**/coverage/**", "**/.wrangler/**"],
      },
      proxy: {
        "/api/nav": {
          target: "https://portal.amfiindia.com",
          changeOrigin: true,
          rewrite: () => "/spages/NAVAll.txt",
        },
      },
    },
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
