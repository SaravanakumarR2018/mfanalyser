# Data regression suite

This suite captures the data behavior at the `working-version-11` baseline. All
CAS fixtures are synthetic PDFs assembled in memory; no real investor data is
stored in the repository.

Run it with:

```sh
npm run test:data
```

The test-only ESM loader exists because application source uses extensionless
TypeScript imports that the production bundler resolves, while native Node ESM
does not.

## Coverage matrix

| Stage | Regression contracts |
| --- | --- |
| Baseline/demo | Portfolio/fund/folio totals, exact endpoint, NAV coverage, stack reconciliation |
| CAS input gates | File type, 30 MB limit, non-CAS PDF, missing summary, missing holdings |
| CAS parse and normalization | Synthetic PDF extraction, masked folios, same-ISIN folio grouping, transaction labels and balances, fund ordering/category/house inference, closed-fund realization |
| CAS reconciliation | Current-value and cost-only mismatch rejection, paise-level totals |
| Initial CAS state | Statement valuation source/date, exact endpoint, active invested/cost basis, closed gains, zero NAV coverage |
| Latest NAV parsing | Header/malformed rows, both AMFI ISIN columns, duplicate-date precedence, invalid NAV/date filtering |
| Latest NAV application | Full and partial matches, mixed publication dates, stale data, zero matches, malformed/non-OK response, closed-fund enrichment, folio propagation |
| Latest NAV reruns | Immutable input and single replaced live endpoint (no duplicate point) |
| Daily history orchestration | Both API payload shapes, invested-period and on-demand full-scheme requests, concurrency progress, shared-scheme deduplication, Retry-After, missing scheme codes, endpoint reconciliation, cancellation, completed rerun no-op |
| Daily valuation | Exact units by date and folio, no estimation for missing same-day NAV, no history when closing balances cannot reconcile, exact/live endpoint precedence |
| Transactions and NAV chart | Same-day aggregation, purchases vs redemptions, official vs transaction NAV provenance, latest marker, earliest-published full-history range, invalid input filtering |
| Fund NAV comparison | Order-independent active/closed scheme deduplication, daily-history completion gating followed by offscreen preload, bounded full-history loading for all 30 schemes from 1900 with exact 1990 observations retained, partial failure/cancellation, thin resting versus bold emphasized line contracts, per-fund inception and selected-range rebasing to 100, calendar-window preservation across selection changes, shared vertical-scale/window math, full earliest-to-latest union timeline, exact single-fund hover lookup, derived-value finite guards, no interpolation or forward-fill |
| Portfolio/fund calculations | Absolute return, XIRR gain/loss/unavailable cases, active-folio completeness, closed-fund cash flows |
| Chart/model calculations | Empty/constant scale, non-finite inputs, fund stacks, closed funds, contribution reconciliation, deterministic sorting and immutability |
| Allocation visualization | Exact portfolio shares, invalid/non-positive filtering, immutable inputs, finite SVG donut paths, deterministic radial selection offsets, and viewport-safe tooltip placement with zero donut overlap |
| Server proxies | Latest NAV pass-through/cache contract; history query validation, upstream identity validation, record filtering, cache contract, safe 502 errors |

## Baseline issues found (production code intentionally unchanged)

1. **Cost-only reconciliation errors report the wrong difference.** A synthetic
   statement whose market value matches but whose cost total differs is correctly
   rejected, but the message says `value differs by ₹0.00` because it always
   formats `valueDifference`, not `costDifference`.
2. **Calendar dates are syntax-checked but not calendar-validated.** Values such
   as `2026-02-31` pass NAV normalization and history-route validation. An invalid
   CAS NAV month can yield an empty holding `navDate`; `buildHoldingTimeline`
   then attempts to format an invalid `Date` when it needs the synthetic one-year
   baseline.
3. **A reconciled zero-value/zero-cost CAS can reach the dashboard with no active
   funds.** Several allocation percentages divide by `portfolio.currentValue`,
   producing `NaN%` for that accepted edge case.
4. **Same-day reconstruction depends on source order.** Transactions are sorted
   only by date. If two same-holding transactions on one date are supplied in a
   different order, the selected closing balance/NAV changes. Normal CAS parsing
   currently preserves PDF order, but any future normalization must retain a
   stable intra-day sequence or aggregate explicitly.
5. **Latest-NAV fetch rejection leaves its 15-second timeout scheduled.** The
   timer is cleared after a resolved fetch, but not from a `finally`, so an early
   network rejection retains the timer until it fires.
6. **Cross-view semantic decision needed.** The portfolio headline reports active
   invested amount, while the fund-stack `invested` total subtracts realized gain
   from closed funds. Existing baseline tests preserve this, but the two values
   intentionally do not reconcile when closed funds have gains/losses.
7. **Mid-flight history cancellation exposes an implementation-specific error.**
   A request cancelled after fetching has started can surface the underlying
   browser/fetch abort text instead of the stable `History load cancelled.`
   message returned when the signal is already aborted at entry.

These findings are recorded rather than fixed because this activity is limited
to test infrastructure and must not modify production behavior.
