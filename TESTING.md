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
