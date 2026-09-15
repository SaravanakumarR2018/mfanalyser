# FolioVista regression framework

The regression baseline is commit `865aa11` (`working-version-11`). The test
framework protects that behavior without changing application source.

## Required merge check

```sh
npm test
```

That command runs, in order:

1. Data, parser, NAV, API-route, calculation, chart-model, and verifier tests
   with aggregate coverage gates of 97% lines, 80% branches, and 90% functions.
2. A production build plus server-rendered HTML contract tests.
3. Playwright semantic and visual tests across desktop Chromium, mobile
   Chromium, Firefox, and WebKit.

Optional saved-account coverage adds five backend tests (generated migrations
executed against SQLite) and two real-browser account flows per project.
`test:ui` and `test:ui:desktop` first apply pending **local-only** D1 migrations;
an explicit `PLAYWRIGHT_BASE_URL` leaves external database setup to its owner.
Account browser fixtures use unique synthetic usernames and synthetic PDFs, and
delete their uploaded statements after verification. Production is never used.
The guest request/storage audits remain unchanged. Account keyboard controls
precede the original landing navigation in Tab order.

Donut keyboard focus and pointer hover have separate state, with a regression
check for a delayed pointer exit after focus moves. Animated-slice hover checks
target the middle of the ring. Responsive tooltip sweeps run as separate tests
per viewport, retaining every slice and geometry assertion without extending
timeouts. The comparison lifecycle test observes the brief completion notice in
the browser before releasing its network gate. Its adjacent World Bank request
uses synthetic inflation data, matching the existing public-data test boundary.
Vite ignores generated traces, reports, coverage, scratch files and local
Wrangler state so test output cannot trigger application reloads or race report
cleanup during a long browser run.
Chromium visual baselines include both macOS and Windows captures. New platform
references do not replace another platform's reviewed images or relax the
existing screenshot comparison tolerance.

Install the browser runtimes once on a new development machine:

```sh
npm run test:ui:install
```

## Faster feedback

```sh
npm run test:data
npm run test:data:coverage
npm run test:render
npm run test:ui:desktop
npm run test:ui
```

Playwright starts the app on port 3001 when it is not already running. Set
`PLAYWRIGHT_PORT` to choose another test-owned port, or set
`PLAYWRIGHT_BASE_URL` to test an already-running instance.

Visual baselines may be regenerated only for an intentional reviewed UI change:

```sh
npm run test:ui:update
```

Never update screenshots merely to make a failing test green. Inspect the HTML
report and retained trace, screenshot, and video under `playwright-report/` and
`test-results/` first.

## Detailed contracts and known baseline defects

- Data stages and calculation coverage: [`tests/data/README.md`](tests/data/README.md)
- UI, browser, responsive, accessibility, and visual coverage: [`tests/e2e/README.md`](tests/e2e/README.md)

All CAS fixtures are synthetic and generated in memory. No investor statement
or personal financial data is stored in the repository.
