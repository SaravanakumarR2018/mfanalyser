# FolioVista repository instructions

## Scope and authority

- This file applies to the entire repository. There are currently no nested
  `AGENTS.md` or `AGENTS.override.md` files.
- Treat commit `865aa11` and tag `working-version-11` as the minimum product
  baseline unless the user explicitly designates a newer baseline.
- Preserve unrelated user changes in a dirty worktree. Do not stage, commit,
  discard, or rewrite user work unless the user asks.
- `TESTING.md` and the READMEs under `tests/` are the authoritative testing
  documentation. The root `README.md` still contains vinext starter material
  and is not authoritative for the FolioVista regression commands.

## Product purpose

FolioVista is a privacy-first mutual-fund Consolidated Account Statement (CAS)
analyzer for detailed CAMS and KFintech PDF statements. The application parses
the statement locally in the browser, reconciles it, optionally applies
official AMFI NAV data, and presents an interactive portfolio dashboard. It is
for tracking and visualization, not investment advice.

Non-negotiable product promises:

- The CAS PDF and its password stay in browser memory and are never uploaded.
- Portfolio contents are not stored in cookies, Web Storage, IndexedDB, Cache
  Storage, a service worker, D1, R2, application logs, or analytics.
- Only read-only NAV requests may leave the browser after parsing.
- Values shown as exact, live, daily, transaction-derived, or unavailable must
  retain those meanings. Do not silently estimate missing financial data.
- Statement totals must reconcile before a real portfolio is rendered.

## Technology and runtime

- Node.js `>=22.13.0`; npm and `package-lock.json` are the package-management
  contract.
- TypeScript, React 19, Next App Router APIs, and ESM (`"type": "module"`).
- vinext/Vite builds the Next-compatible application for a Cloudflare Worker.
- Styling is primarily the hand-authored `app/globals.css`, with Tailwind
  imported through PostCSS.
- PDF parsing uses `pdfjs-dist`; the browser worker is the vendored
  `public/pdf.worker.min.mjs` file.
- Playwright plus axe-core provides browser, responsive, accessibility, and
  visual regression coverage.
- Optional Drizzle/D1 and ChatGPT sign-in scaffolding exists but the current
  FolioVista flow does not persist portfolios or require authentication.

## Repository map

### Application and domain

- `app/page.tsx` renders the client application in `app/FolioVista.tsx`.
- `app/layout.tsx` owns metadata and the `en-IN` document shell.
- `app/FolioVista.tsx` owns landing/upload/password state, dashboard state,
  import/reset behavior, background-history progress, holdings, drawers, and
  portfolio summary UI.
- `app/cas-parser.ts` owns the central `Portfolio`, fund, folio, closed-fund,
  transaction, and timeline types; local pdf.js parsing; reconciliation; CAS
  normalization; and deterministic demo data.
- `app/nav-service.ts` parses latest AMFI text, applies live NAV values, loads
  historical NAVs with bounded concurrency/retries/cancellation, and enriches
  the portfolio timeline.
- `app/timeline-service.ts` reconstructs units and invested value through time,
  merges exact/transaction/daily/live points, and refuses unreconstructable or
  incomplete dates.
- `app/fund-stack-service.ts` owns XIRR/absolute-return calculations, active and
  closed fund stack models, period rebasing/cash flows, shared scales, hit
  testing, and reconciliation diagnostics.
- `app/nav-activity-service.ts` combines official daily NAVs, transaction NAVs,
  purchase/redemption activity, and the latest marker for fund/folio drawers.
- `app/fund-comparison-service.ts` deduplicates active/closed CAS schemes,
  loads every selected scheme from its earliest published NAV, normalizes each
  fund independently to ₹100 at its own inception and again at its first exact
  observation in every selected range, preserves custom calendar windows when
  selections change, builds the shared vertical scale, and resolves exact-date
  single-fund comparison tooltips without estimating missing observations.
- `app/chart-scale.ts`, `app/chart-lens.ts`, `app/range-window.ts`, and
  `app/vertical-range.ts` contain pure chart geometry and range calculations.
- `app/allocation-model.ts` owns deterministic allocation percentages, donut
  arc geometry, slice offsets, and viewport-safe outside-tooltip placement
  without mutating portfolio inputs.
- `app/fund-sort.ts` and `app/formatters.ts` contain deterministic sorting and
  Indian-rupee formatting helpers.

### UI and charts

- `app/PortfolioChart.tsx` renders the portfolio value/invested journey on a
  canvas with period, zoom, horizontal-range, keyboard, tooltip, and invested
  series controls.
- `app/FundStackChart.tsx`, `app/FundStackPanel.tsx`, and
  `app/VerticalScaleControl.tsx` render synchronized value, invested,
  contribution, and period-change stacks with horizontal/vertical ranges,
  magnification, selection, rankings, and cash-flow context.
- `app/NavActivityChart.tsx` renders official/transaction NAV activity inside
  fund and folio drawers.
- `app/FundComparisonChart.tsx` renders the final dashboard comparison with a
  searchable native-checkbox picker, normalized multi-fund lines, exact-date
  tooltips, line focus, keyboard inspection, preserved horizontal and shared
  vertical ranges, and retry states.
- `app/InteractiveDonut.tsx` and `app/DragScrollRegion.tsx` provide the shared
  accessible allocation/concentration slice interactions, collision-free
  portal tooltips, and the pointer- and keyboard-scrollable all-fund ranking
  surface.
- Canvas elements expose accessible names and stable `data-*` diagnostics used
  by browser tests. Preserve or deliberately update those contracts when chart
  behavior changes.
- `app/globals.css` contains the design tokens, complete landing/dashboard
  layout, drawer/chart styles, breakpoints, and reduced-motion CSS.

### Network and platform boundaries

- `app/api/nav/route.ts` proxies the latest official AMFI `NAVAll.txt`, returns
  safe 502 responses, and publishes a 15-minute cache contract.
- `app/api/nav-history/route.ts` validates scheme/date query parameters,
  requests the mfapi.in mirror, verifies the returned scheme identity, filters
  observations, and publishes explicit cache/error contracts.
- These routes must remain read-only. Never include CAS text, PDF bytes,
  passwords, folio data, or portfolio values in their URLs, bodies, headers, or
  logs.
- `vite.config.ts` configures vinext, local NAV proxy rewrites, Cloudflare
  bindings, and polling under the Codex macOS sandbox.
- `worker/index.ts` is the Cloudflare entry point and image-optimization path.
- `build/sites-vite-plugin.ts` packages `.openai/hosting.json` and migrations in
  the build output.
- `.openai/hosting.json` currently sets both D1 and R2 to `null`.
- `db/schema.ts` is intentionally empty. `examples/d1/` is opt-in example code,
  not an active FolioVista data store.
- `app/chatgpt-auth.ts` is optional Sites authentication scaffolding. Do not
  create application routes for reserved sign-in, sign-out, or callback paths.

### Tests

- `tests/data/` contains native Node regression tests for CAS parsing,
  reconciliation, calculations, chart models, NAV refresh/history behavior,
  API routes, and independent verifier/mutation cases.
- `tests/daily-nav.test.ts` contains the original calculation and daily-NAV
  contracts and is part of the data gate.
- `tests/rendered-html.test.mjs` validates the production-rendered HTML shell.
- `tests/e2e/` contains real-browser tests using generated synthetic PDFs and
  intercepted deterministic AMFI responses. It covers landing, input errors,
  encrypted PDFs, the full CAS/NAV lifecycle, privacy, state reset, holdings,
  transactions, charts, drawers, keyboard use, responsive layouts,
  accessibility, visual regions, and independent adversarial cases.
- `playwright.config.ts` runs desktop Chromium, mobile Chromium, desktop
  Firefox, and desktop WebKit. It starts or reuses a server on port 3001 unless
  `PLAYWRIGHT_BASE_URL` is provided.
- The 22 screenshot goldens are Chromium/Darwin-specific and must be treated as
  reviewed artifacts, not regenerated casually.
- All CAS fixtures must remain synthetic. Never check in a real or merely
  redacted investor statement.

## Actual application data lifecycle

Preserve and test every applicable transition:

1. The landing page accepts a PDF up to 30 MB or deterministic demo data.
2. pdf.js reads the file in memory, reports per-page progress, and can request a
   local password. File bytes are zeroed after parsing.
3. The parser recognizes detailed CAMS/KFintech text, masks folio identifiers,
   extracts holdings/transactions/closed funds, and reconciles summary value and
   cost totals at paise precision.
4. For a real CAS, `Landing.processFile` awaits the latest-NAV refresh before
   showing the first dashboard. Working-version-11 does not render a separate
   CAS-only dashboard while the latest request is pending.
5. A successful latest-NAV refresh values matched active funds and folios using
   their CAS unit balances, enriches scheme codes, preserves unmatched funds on
   partial coverage, and appends/replaces one live endpoint.
6. A failed or unusable latest-NAV response falls back to the reconciled CAS
   valuation with an explicit error and does not begin daily-history loading.
7. After the first dashboard render, eligible daily histories load in the
   background. Existing controls remain usable, progress is reported, stale
   history work is aborted/ignored on reset, and only complete same-day
   portfolio observations are added.
8. Once daily-history loading settles, the normalized fund comparison begins
   preloading every eligible scheme's full published history automatically,
   even while its card remains offscreen. This second stage has its own inline
   status and must not extend or reuse the daily-history floater.
9. Complete, incomplete, cancelled, and retry/no-op history outcomes retain the
   correct coverage and error state. Missing observations are skipped, never
   estimated.
10. Importing another CAS resets dashboard-only state. A full page reload returns
   to the landing page because no portfolio is persisted.
11. Demo data bypasses network refresh and is returned by identity.

## Financial and data invariants

- Money reconciliation uses integer paise where available. Do not replace it
  with loose floating-point comparisons.
- Active funds group by ISIN (falling back only when no ISIN exists); folios
  remain independently reconstructable and aggregate exactly to the fund.
- Closed folios for one scheme merge without losing proceeds, investment,
  realized gain, dates, labels, or folio count.
- Transaction signs matter: purchases/inflows are positive CAS amounts;
  redemptions/outflows are negative. XIRR converts these into investor cash-flow
  signs internally and adds the terminal value exactly once.
- Preserve statement, valuation, NAV, transaction, and historical dates as
  `YYYY-MM-DD` strings at domain boundaries.
- Latest NAV matching uses valid AMFI ISINs and never applies older NAV data over
  a newer statement NAV.
- A partial latest-NAV match must not invent coverage or replace unmatched fund
  values. Mixed publication dates and coverage must remain explicit.
- Historical loading is bounded to four concurrent schemes, deduplicates a
  shared scheme code, honors Retry-After for throttling, supports cancellation,
  and reconciles a live endpoint against history.
- Daily valuation requires reconstructable closing balances and an actual NAV
  for every held scheme on that date. Do not interpolate, forward-fill, or infer
  missing official NAV observations.
- Exact CAS/live endpoints and same-day transaction metadata take precedence
  when daily points are merged.
- Portfolio, fund-stack, and chart calculations should be deterministic and
  must not mutate their inputs.
- All fund-stack totals must reconcile to their component funds for value,
  invested, contribution, period change, and period cash flow within the
  existing tolerance.
- Unavailable returns remain unavailable (`null`/an em dash); do not convert
  missing cash-flow evidence into a numeric zero.

## Privacy, security, and failure handling

- Do not add portfolio persistence, telemetry, analytics, upload endpoints, or
  authentication requirements without explicit user approval and corresponding
  privacy/UI/test updates.
- Never print CAS text, raw PDF bytes, passwords, unmasked folio numbers, or
  personal financial values to the console, server logs, test reports, URLs, or
  exceptions.
- Keep NAV proxy errors safe and non-sensitive. Validate upstream status,
  identity, shape, dates, and positive finite NAV values before use.
- Preserve abort and timeout behavior for network work. New async flows need a
  sequence/abort guard so stale results cannot replace current state.
- Fail closed when a statement cannot be parsed or reconciled. Do not render a
  plausible-looking partial portfolio as successful.
- Treat invalid, zero, negative, NaN, and infinite financial inputs explicitly;
  they must not reach CSS percentages, canvas coordinates, or formatted dates.

## UI and accessibility expectations

- Maintain useful layouts at 320, 390, 768, and 1440 px without unintended
  viewport overflow.
- Every interactive control and canvas needs an accessible name and visible
  keyboard focus. Pointer-only behavior must have a keyboard path where
  applicable.
- Preserve semantic status/error announcements for parsing, password, latest
  NAV, background history, and incomplete/fallback states.
- Keep chart periods, horizontal/vertical ranges, tooltips, lens controls,
  stacked modes, rankings, and drawers synchronized with the underlying model.
- Background enrichment must not reset active chart controls, search, sorting,
  expansions, or selected fund/folio state.
- Prefer accessible roles and names in tests. Existing class and `data-*`
  selectors are allowed for canvas diagnostics and stable visual surfaces.
- A visual change requires human review of the image diff before updating
  goldens.

## Change discipline

- Read the relevant domain service and its tests before changing behavior. A UI
  number is usually derived in `cas-parser.ts`, `nav-service.ts`,
  `timeline-service.ts`, or `fund-stack-service.ts`, not only in the component.
- Keep pure financial/model logic outside React components when possible and
  cover it with data tests.
- When changing a domain type or semantic, update every parser/service/chart/UI
  consumer and its fixtures together.
- Do not edit generated or vendored files manually, especially
  `public/pdf.worker.min.mjs`, `package-lock.json`, build output, Playwright
  reports, or TypeScript build-info. Change the lockfile through npm only.
- Do not change coverage thresholds, remove assertions, add broad skips, loosen
  screenshot tolerances, or replace real parser/browser coverage with mocks to
  make a failure disappear.
- Do not change the working-version baseline label or known-issue expectations
  unless the user explicitly approves a new baseline or the underlying defect
  is intentionally fixed.
- Keep documentation synchronized when commands, stages, test counts, or known
  limitations change.

## Mandatory regression validation

This section is mandatory for every agent making code changes.

### Full completion gate

- After the final edit to application code, tests, dependencies, public assets,
  build/runtime configuration, API routes, database/worker code, or behavior,
  run exactly:

  ```sh
  npm test
  ```

- `npm test` is the authoritative regression gate. It runs, in order:
  1. data/parser/calculation/NAV/API/verifier tests with aggregate coverage gates
     of 97% lines, 80% branches, and 90% functions;
  2. a production build and rendered-HTML contracts;
  3. Playwright semantic and visual tests across all four browser projects.
- Targeted commands are encouraged during development, but they do not replace
  the final `npm test` run.
- Do not report a code-changing task as complete unless `npm test` exits with
  code 0 after the final code change.
- If the gate fails, investigate and fix an in-scope regression. If it cannot be
  resolved safely, report the exact command, failing tests, and blocker; never
  imply that validation passed.
- On a clean machine, run `npm install` and then
  `npm run test:ui:install` once to install Chromium, Firefox, and WebKit.
  Browser installation is setup, not a substitute for `npm test`.

### Expected baseline result

The current full gate contains:

- 113 passing data tests;
- aggregate application coverage above the mandatory 97% lines, 80% branches,
  and 90% functions thresholds;
- 2 passing rendered-HTML tests after a successful production build;
- 284 Playwright executions: 261 ordinary passes, 12 expected-failure
  executions, and 11 intentional project skips, reported by Playwright as
  `273 passed, 11 skipped` with zero unexpected failures.

Test counts may grow as behavior grows. A smaller count is suspicious and must
be explained. The 12 expected-failure executions are three documented product
defects exercised across four projects: the missing partial-NAV warning, broken
dialog focus/Escape/restore behavior, and the concurrent-upload race. If one is
fixed, Playwright will report an unexpected pass; remove the matching
`test.fail`, promote it to a normal assertion, and update the documentation.

### Never hide regressions

- Do not update screenshots solely because a visual test failed.
- Do not weaken fixtures, assertions, timeouts, coverage thresholds, privacy
  audits, or cross-browser scope merely to obtain a green run.
- Do not mark a new failure as expected without reproducing it against the
  designated baseline and documenting why preserving that baseline behavior is
  intentional.
- Do not silently accept flaky behavior. Capture the trace/error, identify
  whether it is product or host infrastructure, and rerun only with a stated
  reason.

### Faster feedback commands

- `npm run test:data` — parser, calculations, models, NAV, routes, and verifiers.
- `npm run test:data:coverage` — the same data suite with enforced coverage.
- `npm run test:render` — production build plus rendered-HTML contracts.
- `npm run test:ui:desktop` — fast desktop Chromium browser feedback.
- `npm run test:ui` — complete four-project Playwright matrix.
- `npm run test:ui:update` — regenerate visual baselines only after an
  intentional, human-reviewed UI change.

### Lint and type-check caveats

- Run ESLint on authored files you changed, for example
  `npx eslint app tests playwright.config.ts`. Do not lint the vendored minified
  `public/pdf.worker.min.mjs`.
- At the baseline, repository-wide `npm run lint` is not a green gate because it
  includes that vendored worker and reports its minified code. Do not claim the
  repository-wide lint command passes unless its configuration is intentionally
  corrected.
- `npm run build` inside `npm test` is the supported build gate. Standalone
  `npx tsc --noEmit` currently exposes pre-existing vinext/Cloudflare and source
  typing issues; do not introduce new errors or claim that standalone type-check
  is clean without verifying it.

## Known baseline findings

- Read `tests/data/README.md` and `tests/e2e/README.md` before changing parser,
  NAV, lifecycle, chart, accessibility, or upload behavior. They document the
  confirmed version-11 defects and exact contracts retained by the suite.
- Known defects are not permission to add similar behavior. Avoid expanding
  their impact, and add a regression test when fixing one.
- The current lifecycle has no distinct CAS-only dashboard before latest NAV and
  no standalone retry control for failed daily history. Treat changes to those
  stages as intentional product changes requiring data and UI coverage.

## Completion report for future agents

For every code-changing task, the final response must state:

- the behavior and files changed;
- the exact final validation command (`npm test`);
- whether it passed, including data/build/render/UI summaries;
- any expected failures, skipped coverage, or environment limitation;
- confirmation that privacy and financial invariants were preserved when the
  change touches CAS, NAV, portfolio, or persistence behavior.

Do not commit, push, deploy, update a baseline, or regenerate reviewed visual
artifacts unless the user explicitly requests that action.
