# Optional saved CAS accounts

The landing page offers **Analyse without login** (the original in-memory flow)
and **Analyse with login**. Accounts use a case-insensitive username and a
12–128 character password. Multiple accounts and multiple CAS PDFs per account
are supported. No default passwords are seeded. Email recovery is not included.

Signed-in uploads save the original PDF and a version-1 reconciled CAS snapshot
in private R2. Parsing and PDF decryption still happen in the browser; the PDF
password is never sent or saved. The snapshot lets encrypted PDFs reopen without
asking for their password. The server can read saved PDFs/analysis; this is not
end-to-end encryption. Guest data never enters these endpoints.

New uploads become the active statement without erasing earlier files. Opening
a library entry makes it active for the next login. Restore refreshes prices
through the existing NAV flow; it does not overwrite the saved CAS valuations.
Delete removes the original bytes and snapshot. Upload failures retain the
previous saved statement and show **Not saved** with an in-tab retry. Retries use
the same upload ID to avoid duplicate files after an uncertain response.

## Durable resources and releases

D1 holds users, versioned scrypt hashes (N=16384, r=8, p=5), hashed opaque session
tokens, active statement IDs, ownership metadata and persistent rate limits.
Sessions last 30 days and are revoked on logout. HTTPS cookies are Secure,
HttpOnly, SameSite=Strict and use the `__Host-` prefix. Mutations check same-origin
and a custom request header; all account responses prohibit caching. Every file
read, download, selection and deletion checks the session owner in D1.

The database and bucket must outlive Workers deployments. Keep their identities
stable for main, apply only pending migrations, and deploy new code against those
same bindings. Password hashing needs no per-deployment secret, so a build cannot
invalidate accounts. Keep the same production domain for uninterrupted cookies;
on a new domain users can log in again to the same data if bindings are reused.

**Sites:** preserve the existing Site/project identity and the logical `DB` and
`BUCKET` declarations in `.openai/hosting.json`. Sites owns resource provisioning
and applies packaged Drizzle migrations. Do not create a new Site for each main
deployment. Use a separate Site/resources for branch previews.

**Direct Cloudflare Workers from GitHub/CI:** create one production D1 database
and one private R2 bucket once, or reuse existing ones. Disable public bucket
access. Record the real values in the main build environment:

| Setting | Value |
| --- | --- |
| `FOLIOVISTA_ENVIRONMENT` | `production` |
| `FOLIOVISTA_WORKER_NAME` | Existing production Worker name |
| `FOLIOVISTA_D1_ID` | Stable production database UUID |
| `FOLIOVISTA_D1_NAME` | Stable production database name |
| `FOLIOVISTA_R2_BUCKET` | Stable private production bucket name |

For preview branches, use `preview` and a different Worker, database and bucket.
Do not expose production credentials or resource bindings to untrusted PR jobs.
The Vite config rejects partially specified direct deployments. Without these
values the generated config is local/Sites scaffolding and must not be deployed
directly to production.

Run `npm test`, then build with the chosen environment values. After the existing
release approval, apply migrations and deploy that exact output:

```sh
npx wrangler d1 migrations apply DB --remote --config dist/server/wrangler.json
npx wrangler deploy --config dist/server/wrangler.json
```

The generated config must contain the expected real database UUID and bucket
name before either command. Keep existing migrations immutable and add new ones
with `npm run db:generate`. Never drop tables or buckets as part of deployment.
Use an adequate Workers CPU allowance for password hashing. R2 and D1 operations
can fail independently: upload writes bytes before publishing metadata; an
ambiguous database outcome preserves potentially committed bytes. Orphan cleanup
must only delete keys proven unreferenced, never all files with an old build ID.

## Local development and verification

Local bindings persist under `.wrangler/`; they are separate from production.
Run `npm run db:local`, then start `npm run dev`. The setup command applies only
pending local migrations to the same `.wrangler/state` used by the Vite plugin.
Do not delete `.wrangler` when testing restart persistence.
On Windows, the existing npm scripts require Git Bash as npm's script shell.

`tests/data/vault.test.ts` runs generated migrations in real SQLite and tests
account ownership, session renewal/revocation/expiry, brute-force limits, CSRF,
multiple files, idempotent upload, restore selection and storage failure behavior.
Existing guest privacy and financial regression tests remain authoritative.

Before production release, verify two accounts using synthetic PDFs: upload two
files under one account, reopen both, sign out, confirm isolation from the second
account, then redeploy to the same resources and log in again. Confirm private
PDF downloads, delete behavior and a visible failure when storage is unavailable.
Never use real customer statements in automated tests or release artifacts.

References: [D1 environments](https://developers.cloudflare.com/d1/configuration/environments/),
[Workers crypto support](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/).
