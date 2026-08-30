# FolioVista working-version-11 UI regression suite

This suite treats commit `865aa11` / tag `working-version-11` as the minimum product contract. It drives the real browser UI and does not import or replace production React components.

## Run modes

- `npm run test:ui:install` — one-time browser runtime installation on a new machine.
- `npm run test:ui` — all semantic and visual UI checks on desktop Chromium, mobile Chromium, Firefox, and WebKit.
- `npm run test:ui:desktop` — fast desktop-Chromium feedback.
- `npm run test:ui:update` — deliberately regenerate visual baselines after reviewing an intentional UI change.

Local Playwright execution is serialized so repeated full gates do not trip
macOS headless-browser rendezvous limits; CI retains two-worker parallelism.

The suite contains 72 scenarios. Across the four configured projects that is
288 executions: 265 ordinary passes, 12 expected-failure executions for three
confirmed baseline defects, and 11 intentional project skips. Playwright reports
the ordinary and expected-failure outcomes together as 277 passed with zero
unexpected failures.

## Coverage map

| Area | Regression contract |
| --- | --- |
| Landing | Title, privacy promises, navigation anchors, preview, chooser, drag state, drop validation, non-PDF, oversized PDF, malformed PDF, processing progress |
| Real CAS integration | A generated standards-compliant PDF is loaded by pdf.js, text-extracted, parsed, reconciled, converted into holdings/transactions/timeline data, and rendered |
| Protected CAS | A generated encrypted PDF prompts locally, rejects a wrong password without leaving the page, and renders after the correct password |
| NAV lifecycle | Delayed latest NAV, successful live valuation, scheme mismatch, endpoint failure, daily-history enrichment, history mismatch/retries, exact observation counts, stacked history, stale-request abort, floating progress-bar pointer enter/traverse/leave behavior |
| Privacy | Browser request audit proves CAS bytes are never posted or requested by URL; only GET/HEAD requests occur during analysis; reload and storage audits prove the portfolio is absent from cookies, Web Storage, IndexedDB, Cache Storage, and service workers |
| Re-entry | Import another CAS, background-request cancellation, state preservation during enrichment, demo rerun, full reload/no persistence |
| Summary | Exact and compact values, invested/gain/returns, fund/folio counts, largest allocation, valuation source and dates, plus immediate category-slice tooltips and reversible animated selection |
| Holdings | Search/no-results, all sortable financial columns and `aria-sort`, mouse/keyboard row activation, folio expansion, fund/folio drawers |
| Transactions | Long 25-row CAS, initial 20-row batch, explicit load-more, full history and earliest-date completion |
| Secondary content | Closed-fund proceeds/gain, preserved allocation list, animated category/fund donuts, all-fund concentration ranking, pointer-drag and keyboard scrolling, metric explanations |
| Portfolio chart | Canvas pixels, point metadata, period buttons, zoom, X endpoints, draggable/keyboard window, invested-series toggle, pointer tooltip |
| Fund stack | Reconciliation tolerance, four-view multiselect, shared Y scale, period-change/cash-flow panel, X/Y sliders, reset, keyboard ranking, canvas pixels |
| Normalized fund comparison | Real multi-scheme CAS parsing, full histories queued behind floater-backed daily enrichment and then preloaded while the card remains offscreen, separate inline comparison progress, all eligible histories from 1900 with a pre-2013 observation preserved end to end, thin resting lines with bold hover/selection emphasis, independent ₹100 rebasing at every fund's first exact observation inside the selected period/range, mirrored left/right Y axes showing indexed rupees and signed percentage change from ₹100, custom horizontal-window and locked-fund preservation across range/selection changes, shared vertical min/max/window drag/keyboard/reset controls, earliest-to-latest full timeline, unavailable schemes, active/closed defaults, searchable native checkboxes with a left-aligned All funds checkbox, nearby-line pointer discovery plus free vertical plot tracking for a selected fund with an exact-date guide/marker/single-fund tooltip that follows its point smoothly with placement hysteresis, switches sides to avoid every line, and falls back to the nearest safe chart edge, line focus/dimming/reset, 1Y/3Y/5Y/8Y/10Y/All and range controls, absent legend tiles/investment markers, partial/total failure retry, cached successes, delayed-load selection races, request privacy, axe, responsive containment, and chart/picker/tooltip goldens |
| India inflation context | Near-viewport browser-only World Bank request, exact latest-30 observation rendering, public-request privacy, highlights, keyboard year inspection, responsive containment, failure isolation, and retry |
| Magnifier | Enable/disable state, range control availability, magnification, size, synchronized metadata, pointer drag |
| Drawer NAV chart | Default invested-period view and an off-by-default compact full-history switch, preserved CAS investment markers, atomic loading transition, retry/fallback, request reuse, period/range controls, observation metadata, rendered pixels, responsive containment, empty transaction state |
| Accessibility | Axe WCAG A/AA scans, accessible control/canvas names, keyboard activation, modal semantics, slider names/orientation, named donut slices, and closed/open-tooltip contrast |
| Responsive | 320, 390, 768, and 1440 px layouts, horizontal-overflow checks, every allocation/concentration slice tooltip fully inside the viewport with zero donut overlap, mobile drawer scrolling |
| Visual | Reviewed landing, summary, metric, portfolio-chart, stack-chart, allocation/concentration, selected-slice tooltip, and normalized-comparison goldens for desktop and mobile Chromium |
| Independent verifier | Partial-NAV value preservation, missing-warning behavior, password flow, persistence, modal keyboard behavior, concurrent-upload sequencing, and an interactive-readiness smoke budget |

## Determinism

`helpers/cas-fixture.ts` and `helpers/fund-comparison-fixture.ts` construct CAS PDFs in memory. Their summaries, units, transaction cash flows, balances, NAVs, and market values reconcile. The comparison fixture deliberately includes three current matched schemes, one matched closed scheme with an exact 1990 inception observation, one unmatched scheme, four different inception dates, sparse published observations, and same-day purchase/redemption activity that the comparison intentionally does not render. Its pointer checks require the nearest hovered line to become the sole emphasized line until the pointer moves away or reaches another fund. Latest and historical AMFI responses are intercepted at the browser network boundary. This keeps the parser and application state transitions real while removing external availability and date drift from CI.

The visual checks freeze wall-clock time, request reduced motion, disable CSS animations during capture, and compare only stable component regions. Goldens are intentionally Chromium/Darwin-specific; Firefox and WebKit receive the full semantic suite.

## Actual tested state machine

The current application moves through: landing → local PDF parsing/progress →
latest-NAV success, partial success, or fallback → first dashboard render →
background daily-history enrichment → complete or incomplete history notice.
After that daily stage settles, full comparison histories preload automatically
without waiting for the comparison card to approach the viewport; this second
stage reports only inside the comparison card and never extends the floater.
Working-version-11 does **not** render a separate CAS-only dashboard before it
awaits the latest-NAV request; only daily-history enrichment happens after the
dashboard appears. The delayed-NAV tests preserve this observed behavior so a
future intentional extra stage is visible in review. Portfolio-wide background
history failures still have no standalone retry action today; retrying those
requires a new import.

Inside a matched fund or folio drawer, the NAV chart defaults to the investor's
CAS period. Turning on the compact **Full fund history** switch makes one read-only, cancellable
request for that public scheme's history from 1900 through the current NAV date.
The existing chart remains rendered during loading or failure; a successful
response switches atomically to the earliest published observation returned,
while the same CAS purchase markers, tooltips, periods, and range controls remain
available. A failed full-history request has an inline retry and never changes
portfolio valuation or stored state.

## Known working-version-11 product defects and risks

These are recorded rather than fixed because this activity is test-only:

1. The holdings structure uses `role="table"` but its data rows use `role="button"` and also contain an expand button. Axe reports the critical `aria-required-children` violation; the scan permits only that known critical ID and fails on every other critical violation.
2. The app requests `/favicon.ico`, which returns 404 even though `public/favicon.svg` exists. The browser-error guard ignores only that exact resource error and still fails on every other console/page error.
3. Fund/folio dialogs declare `aria-modal`, but opening does not transfer focus, Escape does not close them, and focus is not trapped/restored. This is a keyboard/screen-reader usability defect.
4. A completed background request marks the toast “Daily NAVs ready” even when all history attempts were incomplete; the valuation notice later reports the incomplete data correctly.
5. When only some schemes receive latest NAVs, the live notice does not expose `liveUpdateError`, so mixed coverage is easy to miss and the portfolio endpoint can combine dates.
6. Allocation percentage rendering divides by `portfolio.currentValue`; a valid zero-value/closed-only portfolio can render `NaN%`.
7. `prefers-reduced-motion` disables CSS motion, but the portfolio canvas still runs its JavaScript 720 ms interpolation.
8. The upload drop target remains active while an analysis is busy, so a second drop can start a competing import before the first finishes.

Defects 3, 5, and 8 also have explicit `test.fail` contracts in
`verifier-critical.spec.ts`. They run on all four browser projects: the gate
fails if they regress differently, and will report an unexpected pass when the
production defect is fixed so the expectation can be promoted to a normal
assertion.

## Testability limits / next hardening targets

- Production state is not dependency-injected. Network failures can be controlled at `/api/nav` and `/api/nav-history`, but parser internals cannot be paused at an exact page without using a multi-page fixture plus delayed NAV.
- Most selectors use accessible roles/names; a small number of chart/drawing assertions use stable existing classes and `data-*` diagnostics. Dedicated test IDs would reduce coupling if labels are redesigned.
- External AMFI availability is intentionally excluded from E2E. Server/data tests should own upstream schema checks, while this suite owns every browser state produced by those schemas.
- Screenshot goldens should only be updated after a human reviews the diffs; do not use update mode automatically in CI.
- Visual goldens are Chromium-only by design, the performance assertion is an interactive-readiness smoke rather than a Web Vitals/load test, and no automated browser suite replaces a real assistive-technology audit.
